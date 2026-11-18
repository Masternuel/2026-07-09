#!/usr/bin/env node
// Builds an offline Bola Manager database (Serie A-D) from API-Football.
// Output: a "bola-manager-database" JSON to import in Editor da Base -> Selecionar base exportada.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiFootballError, createApiFootballClient, createFileCache } from "../server/import/apiFootball/client.mjs";
import { buildCatalogRecords, divisionFor, standingsByTeam } from "../server/import/apiFootball/catalogBuilder.mjs";
import { createCatalogDatabasePackage } from "../server/services/catalogDatabase.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseArguments(argv, today = new Date()) {
  const options = { season: today.getFullYear(), out: null, cache: resolve(root, ".tmp/api-football-cache"), maxRequests: Infinity, partial: false, fill: true, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--season") options.season = Number.parseInt(argv[++index], 10);
    else if (argument === "--out") options.out = resolve(argv[++index]);
    else if (argument === "--cache") options.cache = resolve(argv[++index]);
    else if (argument === "--max-requests") options.maxRequests = Number.parseInt(argv[++index], 10);
    else if (argument === "--partial") options.partial = true;
    else if (argument === "--no-fill") options.fill = false;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Argumento desconhecido: ${argument}`);
  }
  if (!Number.isInteger(options.season) || options.season < 2000 || options.season > 2100) throw new Error("--season invalida");
  if (!(options.maxRequests > 0)) throw new Error("--max-requests deve ser positivo");
  options.out ??= resolve(root, `.tmp/api-football/bola-manager-base-${options.season}.json`);
  return options;
}

const HELP = `Atualiza a base do Bola Manager (Serie A, B, C e D) pela API-Football.

Uso: npm run catalog:update -- [--season 2026] [--out arquivo.json] [--partial] [--no-fill] [--max-requests N]

A chave vem de API_FOOTBALL_KEY (ambiente ou .env.local) e nunca e exibida.
Respostas ficam em cache (.tmp/api-football-cache): se a cota diaria acabar, rode de novo
no dia seguinte e o download continua de onde parou. --partial gera a base mesmo com
elencos faltando (completados com jogadores gerados). --no-fill nao gera jogadores.
Depois importe o arquivo em Editor da Base -> Selecionar base exportada.`;

function loadKey() {
  if (!process.env.API_FOOTBALL_KEY) {
    try { process.loadEnvFile(resolve(root, ".env.local")); } catch { /* optional file */ }
  }
  return process.env.API_FOOTBALL_KEY ?? "";
}

export async function downloadDivisions(client, season, { partial = false, log = () => {} } = {}) {
  const leagues = await client.get("/leagues", { country: "Brazil", season, type: "League" });
  const divisions = [];
  for (const item of leagues) {
    const division = divisionFor(item.league?.name);
    if (division && !divisions.some((entry) => entry.level === division.level)) divisions.push({ ...division, league: item.league });
  }
  if (!divisions.length) throw new ApiFootballError(`Nenhuma Serie A-D encontrada para ${season}`, "API_FOOTBALL_EMPTY");
  divisions.sort((a, b) => a.level - b.level);
  // Once the daily quota is gone, keep going from the cache only, so everything already
  // downloaded is still used and no request is wasted.
  let quota = null;
  const fetchStep = async (path, params) => {
    if (quota) return client.get(path, params, { cacheOnly: true });
    try { return await client.get(path, params); }
    catch (error) {
      if (error.code !== "API_FOOTBALL_QUOTA") throw error;
      quota = error;
      return null;
    }
  };
  for (const entry of divisions) {
    entry.teams = (await fetchStep("/teams", { league: entry.league.id, season })) ?? [];
    entry.squads = new Map();
    if (entry.teams.length) log(`${entry.division}: ${entry.teams.length} clubes`);
  }
  // Final table ranks club strength; optional, so a missing table only falls back to stadium size.
  for (const entry of divisions) {
    entry.standings = new Map();
    if (!entry.teams.length) continue;
    try {
      entry.standings = standingsByTeam((await fetchStep("/standings", { league: entry.league.id, season })) ?? []);
    } catch (error) {
      if (!["API_FOOTBALL_PLAN", "API_FOOTBALL_FAILED"].includes(error.code)) throw error;
      log(`${entry.division}: classificacao indisponivel (${error.message})`);
    }
  }
  for (const entry of divisions) {
    for (const { team } of entry.teams) {
      const response = await fetchStep("/players/squads", { team: team.id });
      if (response) entry.squads.set(team.id, response[0]?.players ?? []);
    }
  }
  const totalTeams = divisions.reduce((sum, entry) => sum + entry.teams.length, 0);
  const downloaded = divisions.reduce((sum, entry) => sum + entry.squads.size, 0);
  if (quota && !partial) {
    throw new ApiFootballError(`Cota diaria esgotada: ${downloaded} de ${totalTeams || "?"} elencos baixados. Rode de novo amanha; o que ja foi baixado fica no cache.`, "API_FOOTBALL_QUOTA", { downloaded, totalTeams });
  }
  return { divisions: divisions.filter((entry) => entry.teams.length), downloaded, totalTeams, incomplete: Boolean(quota) };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  const client = createApiFootballClient({ key: loadKey(), cache: createFileCache(options.cache), maxRequests: options.maxRequests });
  const { divisions, downloaded, totalTeams, incomplete } = await downloadDivisions(client, options.season, { partial: options.partial, log: console.log });
  const { records, report } = buildCatalogRecords(divisions, { fillSquads: options.fill });
  const database = createCatalogDatabasePackage(records);
  database.source = { provider: "API-Football", season: options.season, generatedRatings: true, incomplete };
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(database, null, 2)}\n`);
  for (const league of report.leagues) console.log(`  ${league.division}: ${league.clubs} clubes, ${league.players} jogadores`);
  console.log(`Elencos baixados: ${downloaded}/${totalTeams}. Jogadores gerados para completar elencos: ${report.generatedPlayers}.`);
  if (report.missingSquads.length) console.log(`Clubes sem elenco da API: ${report.missingSquads.length}`);
  // The API's remaining-requests header does not track the daily quota reliably; don't show it.
  console.log(`Consultas usadas nesta execucao: ${client.stats.requests} (respondidas pelo cache: ${client.stats.cacheHits})`);
  console.log(`Base gerada: ${options.out}`);
  console.log("Importe em Editor da Base -> Selecionar base exportada.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof ApiFootballError ? error.message : `Falha: ${error.message}`);
    process.exitCode = error?.code === "API_FOOTBALL_QUOTA" ? 2 : 1;
  });
}
