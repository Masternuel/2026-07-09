#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { initializeFirebaseAdmin } from "../server/config.mjs";

const attributeSchema = z.record(z.coerce.number().finite()).default({});
const recordIdSchema = z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().trim().min(1).max(128).refine((value) => !value.includes("/"), "ID nao pode conter /"));
const clubSchema = z.object({
  id: recordIdSchema,
  name: z.string().trim().min(1),
  abbreviation: z.string().trim().max(8).optional(),
  colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i, "cor deve usar #RRGGBB")).max(4).default([]),
  stadium: z.string().default("A definir"),
  reputation: z.coerce.number().min(1).max(20).default(10),
  division: z.string().default("Sem divisão"),
  country: z.string().default("Brasil"),
  state: z.string().nullable().optional(),
}).passthrough();
const playerSchema = z.object({
  id: recordIdSchema,
  clubId: recordIdSchema,
  name: z.string().trim().min(1),
  position: z.string().trim().min(1),
  age: z.coerce.number().int().min(14).max(60),
  nationality: z.string().default("Brasil"),
  shirtNumber: z.coerce.number().int().min(0).max(99).nullable().optional(),
  overall: z.coerce.number().finite().optional(),
  attributes: attributeSchema,
}).passthrough();
const competitionSchema = z.object({
  id: recordIdSchema,
  name: z.string().trim().min(1),
}).passthrough();
const datasetSchema = z.object({
  version: z.string().default("1"),
  clubs: z.array(clubSchema).default([]),
  players: z.array(playerSchema).default([]),
  leagues: z.array(competitionSchema).default([]),
  cups: z.array(competitionSchema).default([]),
}).strict();

function parseArguments(argv) {
  const options = { dryRun: true, input: null, batchSize: 400 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--commit") options.dryRun = false;
    else if (argument === "--input") options.input = argv[++index];
    else if (argument === "--batch-size") options.batchSize = Number.parseInt(argv[++index], 10);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Argumento desconhecido: ${argument}`);
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 450) {
    throw new Error("--batch-size deve estar entre 1 e 450");
  }
  return options;
}

function helpText() {
  return [
    "Importador normalizado da base Brasfoot para o Bola Manager",
    "",
    "Uso:",
    "  node scripts/import-brasfoot.mjs --dry-run --input ./data/brasfoot-normalized.json",
    "  BRASFOOT_IMPORT_PROVIDED_KEY=... node scripts/import-brasfoot.mjs --commit --input ./data/brasfoot-normalized.json",
    "",
    "O JSON deve conter: version, clubs, players, leagues e cups.",
    "Dry-run e o padrao. --commit exige Firebase Admin e chave administrativa.",
    "Este script NAO decodifica .dat. Use uma exportacao autorizada e auditada.",
  ].join("\n");
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toInternalAttribute(value) {
  const numeric = Number(value);
  const scaled = numeric <= 20 ? numeric : numeric / 5;
  return Math.max(1, Math.min(20, Math.round(scaled)));
}

function generatedAttribute(player, attributeName, overall) {
  const variance = (hashText(`${player.name}|${player.position}|${attributeName}`) % 7) - 3;
  return Math.max(1, Math.min(20, overall + variance));
}

function ageFactor(age) {
  if (age <= 21) return 1.25;
  if (age <= 29) return 1.1;
  if (age <= 32) return 0.85;
  return 0.6;
}

export function normalizeDataset(rawData) {
  const parsed = datasetSchema.parse(rawData);
  for (const [label, records] of [
    ["clubes", parsed.clubs],
    ["jogadores", parsed.players],
    ["ligas", parsed.leagues],
    ["copas", parsed.cups],
  ]) {
    const ids = new Set();
    for (const record of records) {
      const comparisonId = record.id.toLocaleUpperCase("pt-BR");
      if (ids.has(comparisonId)) throw new Error(`ID duplicado em ${label}: ${record.id}`);
      ids.add(comparisonId);
    }
  }
  const clubsById = new Map(parsed.clubs.map((club) => [club.id, club]));
  for (const player of parsed.players) {
    if (!clubsById.has(player.clubId)) {
      throw new Error(`Jogador ${player.id} referencia clube inexistente: ${player.clubId}`);
    }
  }
  const requiredAttributes = ["velocidade", "chute", "drible", "nocao", "defesa", "passe", "peBom", "peRuim"];
  const players = parsed.players.map((player) => {
    const sourceValues = Object.values(player.attributes).map(toInternalAttribute);
    const sourceOverall = player.overall == null
      ? sourceValues.reduce((sum, value) => sum + value, 0) / Math.max(1, sourceValues.length)
      : toInternalAttribute(player.overall);
    const overall = Math.max(1, Math.min(20, Math.round(sourceOverall || 10)));
    const attributes = Object.fromEntries(requiredAttributes.map((key) => [
      key,
      player.attributes[key] == null
        ? generatedAttribute(player, key, overall)
        : toInternalAttribute(player.attributes[key]),
    ]));
    const stars = Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, Math.ceil(value / 2)]));
    const clubReputation = clubsById.get(player.clubId)?.reputation ?? 10;
    const marketValue = Math.round(overall * ageFactor(player.age) * clubReputation * 100_000);
    return { ...player, overall, attributes, stars, marketValue };
  });
  return { ...parsed, players };
}

function summarize(data) {
  const playersWithoutClub = data.players.filter((player) => !data.clubs.some((club) => club.id === player.clubId));
  return {
    version: data.version,
    clubs: data.clubs.length,
    players: data.players.length,
    leagues: data.leagues.length,
    cups: data.cups.length,
    playersWithoutClub: playersWithoutClub.length,
  };
}

async function commitCollection(database, collectionName, records, batchSize) {
  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = database.batch();
    for (const record of records.slice(offset, offset + batchSize)) {
      batch.set(database.collection(collectionName).doc(record.id), record, { merge: true });
    }
    await batch.commit();
  }
}

function assertAdminAuthorization(env) {
  const expected = env.BRASFOOT_IMPORT_ADMIN_KEY;
  const provided = env.BRASFOOT_IMPORT_PROVIDED_KEY;
  if (!expected || !provided) {
    throw new Error("Importacao exige BRASFOOT_IMPORT_ADMIN_KEY e BRASFOOT_IMPORT_PROVIDED_KEY");
  }
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
    throw new Error("Chave administrativa de importacao invalida");
  }
}

export async function runImport(options, env = process.env) {
  if (!options.input) throw new Error("Informe o arquivo com --input CAMINHO");
  const inputPath = resolve(options.input);
  if (extname(inputPath).toLowerCase() === ".dat") {
    throw new Error("Arquivos .dat nao sao suportados: forneca JSON normalizado de uma exportacao autorizada");
  }
  if (extname(inputPath).toLowerCase() !== ".json") {
    throw new Error("O importador aceita somente arquivos .json normalizados");
  }
  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  const data = normalizeDataset(raw);
  const summary = summarize(data);
  if (options.dryRun) return { mode: "dry-run", inputPath, summary };

  assertAdminAuthorization(env);
  const firebase = await initializeFirebaseAdmin(env);
  if (!firebase.enabled) {
    throw new Error(`Firebase Admin indisponível: ${firebase.reason}`);
  }
  const { getFirestore } = await import("firebase-admin/firestore");
  const database = getFirestore(firebase.app);
  await commitCollection(database, "brasfootClubs", data.clubs, options.batchSize);
  await commitCollection(database, "brasfootPlayers", data.players, options.batchSize);
  await commitCollection(database, "brasfootLeagues", data.leagues, options.batchSize);
  await commitCollection(database, "brasfootCups", data.cups, options.batchSize);
  await database.collection("brasfootImports").doc("current").set({
    version: data.version,
    importedAt: new Date().toISOString(),
    summary,
  });
  return { mode: "import", inputPath, summary };
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(helpText());
    else console.log(JSON.stringify(await runImport(options), null, 2));
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Dataset inválido:", error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}
