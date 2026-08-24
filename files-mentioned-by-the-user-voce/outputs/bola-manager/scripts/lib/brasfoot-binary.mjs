import { access, readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { JavaSerializationError, parseJavaSerialization } from "./java-serialization.mjs";

const MAX_SOURCE_FILES = 50_000;
const BRAZIL_COUNTRY_ID = 29;
const BRAZILIAN_STATE_CODES = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];
const CHARACTERISTICS = [
  "Colocacao", "Defesa de penalti", "Reflexo", "Saida do gol", "Armacao", "Cabeceio", "Cruzamento",
  "Desarme", "Drible", "Finalizacao", "Marcacao", "Passe", "Resistencia", "Velocidade",
];
const SOURCE_SHIRT_NUMBER_FIELDS = [
  "shirtNumber", "jerseyNumber", "numeroCamisa", "numero_camisa", "numCamisa", "camisa", "numero",
];
const SHIRT_NUMBER_PREFERENCES = {
  GOL: [1, 12, 22, 23, 24, 25, 30, 31, 40],
  LD: [2, 13, 14, 22, 23, 32],
  LE: [6, 16, 21, 26, 31, 36],
  ZAG: [3, 4, 5, 13, 14, 15, 24, 25, 33, 34],
  VOL: [5, 8, 15, 18, 20, 25],
  MC: [8, 10, 5, 15, 18, 20, 21, 28],
  MEI: [10, 8, 5, 18, 20, 21, 27, 28],
  PD: [7, 17, 19, 20, 23, 27],
  PE: [11, 7, 17, 19, 21, 27],
  ATA: [9, 11, 18, 19, 20, 21, 29, 30],
};
const ALL_SHIRT_NUMBERS = Array.from({ length: 99 }, (_item, index) => index + 1);
const CHARACTERISTIC_ATTRIBUTES = {
  0: ["defesa", "nocao", "posicionamentoGol"],
  1: ["defesa", "nocao", "penaltis"],
  2: ["defesa", "nocao", "reflexos"],
  3: ["defesa", "nocao", "saidaGol"],
  4: ["passe", "nocao"],
  5: ["nocao", "chute", "impulsao"],
  6: ["passe"],
  7: ["defesa"],
  8: ["drible"],
  9: ["chute"],
  10: ["defesa"],
  11: ["passe"],
  12: ["nocao", "defesa", "resistencia"],
  13: ["velocidade"],
};

function field(value, name, fallback = null) {
  return value?.$fields && Object.hasOwn(value.$fields, name) ? value.$fields[name] : fallback;
}

function listValues(value) {
  return Array.isArray(value?.$values) ? value.$values : [];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || minimum));
}

function safeId(value, fallback) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return normalized || fallback;
}

function stableHash(value, length = 20) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function normalizedSourcePath(root, filePath) {
  return relative(root, filePath).replaceAll("\\", "/").normalize("NFC").toLocaleLowerCase("pt-BR");
}

function validExternalId(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function playerIdentity(player) {
  const externalId = validExternalId(field(player, "tid", 0));
  if (externalId != null) return `tid-${externalId}`;
  const fingerprint = [
    String(field(player, "a", "")).trim().normalize("NFC").toLocaleLowerCase("pt-BR"),
    field(player, "c", ""), field(player, "d", ""), field(player, "e", ""),
    field(player, "g", ""), field(player, "h", ""), field(player, "i", ""), field(player, "hash", ""),
  ].join("|");
  return `fp-${stableHash(fingerprint)}`;
}

function countryName(countryId, countriesById) {
  return countriesById.get(Number(countryId)) ?? (Number(countryId) === BRAZIL_COUNTRY_ID ? "BRA" : `PAIS-${countryId}`);
}

function stateCode(countryId, stateId) {
  if (stateId == null || stateId === "") return null;
  const numericCountry = Number(countryId);
  const numericState = Number(stateId);
  if (numericCountry === BRAZIL_COUNTRY_ID && Number.isInteger(numericState)) {
    return BRAZILIAN_STATE_CODES[numericState] ?? null;
  }
  return numericState > 0 ? String(numericState) : null;
}

function mapPosition(player) {
  const category = Number(field(player, "e", -1));
  const side = Number(field(player, "i", 0));
  const characteristics = [Number(field(player, "g", -1)), Number(field(player, "h", -1))];
  if (category === 0) return "GOL";
  if (category === 1) return side === 1 ? "LE" : "LD";
  if (category === 2) return "ZAG";
  if (category === 3) return "MEI";
  if (category === 4) {
    // O formato distingue apenas atacante e lado; Finalizacao e a melhor pista para centroavante.
    if (characteristics.includes(9)) return "ATA";
    return side === 1 ? "PE" : "PD";
  }
  return "MEI";
}

function sourceShirtNumber(player) {
  for (const name of SOURCE_SHIRT_NUMBER_FIELDS) {
    const numeric = Number(field(player, name, Number.NaN));
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 99) return numeric;
  }
  return null;
}

function allocateShirtNumbers(roster) {
  const sourceNumbers = roster.map(({ player }) => sourceShirtNumber(player));
  // Reserva primeiro os numeros realmente presentes na origem. Assim um fallback
  // gerado para atleta anterior nunca toma a camisa explicita de atleta posterior.
  const used = new Set(sourceNumbers.filter((number) => number != null));
  const assigned = [...sourceNumbers];
  // Primeira passagem usa somente camisas adequadas a cada posicao. Fallbacks
  // ficam para depois, evitando que um meia excedente tome a 9 do atacante.
  roster.forEach(({ player }, index) => {
    if (assigned[index] != null) return;
    const preferences = SHIRT_NUMBER_PREFERENCES[mapPosition(player)] ?? [];
    const generated = preferences.find((number) => !used.has(number)) ?? null;
    if (generated != null) used.add(generated);
    assigned[index] = generated;
  });
  assigned.forEach((number, index) => {
    if (number != null) return;
    const fallback = ALL_SHIRT_NUMBERS.find((candidate) => !used.has(candidate)) ?? null;
    if (fallback != null) used.add(fallback);
    assigned[index] = fallback;
  });
  return assigned;
}

function rawFields(value) {
  return Object.fromEntries(Object.entries(value?.$fields ?? {}).filter(([, item]) => (
    item == null || ["string", "number", "boolean"].includes(typeof item)
  )));
}

function characteristicAttributes(player, overall, position) {
  const bonuses = {};
  for (const characteristic of [field(player, "g"), field(player, "h")]) {
    const characteristicId = Number(characteristic);
    const attributes = characteristicId === 5 && ["ZAG", "LD", "LE"].includes(position)
      ? ["nocao", "defesa", "impulsao"]
      : characteristicId === 12
        ? ["forca", "resistencia"]
        : CHARACTERISTIC_ATTRIBUTES[characteristicId] ?? [];
    for (const attribute of attributes) {
      bonuses[attribute] = (bonuses[attribute] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(bonuses).map(([attribute, occurrences]) => [
    attribute,
    clamp(overall + 1 + occurrences, 1, 20),
  ]));
}

function estimatedPlayerOverall(player, teamLevel) {
  // O .ban da base traz nivel do time e marcadores do jogador, mas nao grava
  // a forca/habilidades numericas criadas pelo motor ao iniciar uma carreira.
  const age = clamp(Math.round(Number(field(player, "d", 27))), 16, 40);
  const starterMultiplier = Number(field(player, "f", 0)) === 1 ? 1.2 : 1;
  const fameMultiplier = field(player, "j", false) === true
    ? 1.53
    : field(player, "b", false) === true ? 1.28 : 1;
  const rawHash = Number(field(player, "hash", 5));
  const hashVariation = Math.max(-5, Math.min(5, (Number.isFinite(rawHash) ? rawHash : 5) - 5));
  const rawStrength = Math.floor(
    2.17 * teamLevel * starterMultiplier * fameMultiplier
      - 0.28 * (age - 27) ** 2
      + hashVariation,
  );
  return clamp(Math.round(clamp(rawStrength, 1, 100) / 5), 1, 20);
}

function uniqueRoster(team) {
  const seenObjects = new Set();
  const seenKeys = new Set();
  const players = [];
  for (const rosterName of ["l", "m"]) {
    for (const player of listValues(field(team, rosterName))) {
      if (!player || typeof player !== "object" || player.$class !== "e.g" || seenObjects.has(player)) continue;
      seenObjects.add(player);
      const key = playerIdentity(player);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      players.push({ player, rosterName });
    }
  }
  return players;
}

export function mapBrasfootTeam(team, context = {}) {
  if (team?.$class !== "e.t") throw new Error(`Classe de time inesperada: ${team?.$class ?? "vazia"}`);
  const filenameStem = context.filenameStem ?? "";
  const sourceSlug = String(field(team, "d", filenameStem)).trim();
  // O nome do arquivo e unico na base; o slug interno tem copias antigas como "teste2 - Copia".
  const clubId = context.clubId ?? safeId(filenameStem, safeId(sourceSlug, "time"));
  const strength = clamp(field(team, "c", 10), 1, 25);
  const reputation = clamp(Math.round(strength * 0.8), 1, 20);
  const club = {
    id: clubId,
    name: String(field(team, "e", sourceSlug || filenameStem || "Time")).trim() || filenameStem || "Time",
    abbreviation: String(field(team, "e", sourceSlug || filenameStem || "Time")).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3).toUpperCase(),
    colors: [field(team, "cor1"), field(team, "cor2")].filter((color) => /^#[0-9a-f]{6}$/i.test(String(color))),
    stadium: String(field(team, "f", "A definir") || "A definir"),
    stadiumCapacity: Math.max(0, Number(field(team, "g", 0)) || 0),
    manager: String(field(team, "h", "") || ""),
    reputation,
    division: "Sem divisao",
    country: countryName(field(team, "a", 0), context.countriesById ?? new Map()),
    state: stateCode(field(team, "a", 0), field(team, "b", null)),
    city: null,
    budget: 0,
    active: field(team, "valid", true) !== false,
    leagueId: null,
    source: "brasfoot-java-serialization",
    brasfootSlug: sourceSlug,
    brasfootRaw: rawFields(team),
    assets: context.assets ?? {},
  };
  const roster = uniqueRoster(team);
  const shirtNumbers = allocateShirtNumbers(roster);
  const players = roster.map(({ player, rosterName }, index) => {
    const isStar = field(player, "b", false) === true;
    const worldStar = field(player, "j", false) === true;
    const overall = estimatedPlayerOverall(player, strength);
    const position = mapPosition(player);
    return {
      id: `${clubId}-${playerIdentity(player)}`,
      clubId,
      name: String(field(player, "a", `Jogador ${index + 1}`)).trim() || `Jogador ${index + 1}`,
      position,
      age: clamp(Math.round(Number(field(player, "d", 18))), 14, 60),
      nationality: countryName(field(player, "c", 0), context.countriesById ?? new Map()),
      shirtNumber: shirtNumbers[index],
      overall,
      attributes: characteristicAttributes(player, overall, position),
      isStar,
      worldStar,
      starter: Number(field(player, "f", 0)) === 1,
      preferredSide: Number(field(player, "i", 0)) === 1 ? "Esquerdo" : "Direito",
      characteristics: [field(player, "g"), field(player, "h")]
        .map((value) => CHARACTERISTICS[Number(value)])
        .filter(Boolean),
      active: true,
      source: "brasfoot-java-serialization",
      brasfootRoster: rosterName === "m" ? "youth" : "senior",
      brasfootRaw: rawFields(player),
    };
  });
  return { club, players };
}

export function mapBrasfootLeague(config, context = {}) {
  if (config?.$class !== "est.ConfigLigaType") {
    throw new Error(`Classe de liga inesperada: ${config?.$class ?? "vazia"}`);
  }
  const countryId = Number(field(config, "pais", 0));
  const country = context.countryCode ?? countryName(countryId, context.countriesById ?? new Map());
  const level = Math.max(1, Number(field(config, "divisao", 1)) || 1);
  const baseName = String(field(config, "nome", "Liga") || "Liga").trim();
  const divisionName = String(field(config, "nomeDivisao", "") || "").trim();
  return {
    id: `${safeId(country, "pais")}-${level}`.toUpperCase(),
    name: divisionName && !baseName.toLocaleLowerCase("pt-BR").includes(divisionName.toLocaleLowerCase("pt-BR"))
      ? `${baseName} - ${divisionName}`
      : baseName,
    country,
    countryId,
    level,
    division: divisionName || String(level),
    legs: field(config, "doisTurnos", true) === false ? "single" : "double",
    active: true,
    source: "brasfoot-java-serialization",
    brasfootRaw: rawFields(config),
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function directFiles(directory, extension) {
  if (!(await exists(directory))) return [];
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === extension)
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, "pt-BR"));
}

async function recursiveFiles(directory, extension) {
  if (!(await exists(directory))) return [];
  const result = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const filePath = join(current, entry.name);
      if (entry.isDirectory()) pending.push(filePath);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === extension) result.push(filePath);
      if (result.length > MAX_SOURCE_FILES) throw new Error("Origem Brasfoot excede o limite de arquivos");
    }
  }
  return result.sort((left, right) => left.localeCompare(right, "pt-BR"));
}

async function discoverSource(inputPath) {
  const source = resolve(inputPath);
  const metadata = await stat(source);
  if (metadata.isFile()) {
    const extension = extname(source).toLowerCase();
    if (![".ban", ".cfg"].includes(extension)) throw new Error(`Formato Brasfoot nao suportado: ${extension || "sem extensao"}`);
    const parent = dirname(source);
    const root = basename(parent).toLowerCase() === "teams" || basename(parent).toLowerCase() === "conf_ligas_nacionais"
      ? dirname(parent)
      : parent;
    const auxiliaryCfg = extension === ".ban" ? await directFiles(join(root, "conf_ligas_nacionais"), ".cfg") : [];
    return { root, banFiles: extension === ".ban" ? [source] : [], cfgFiles: extension === ".cfg" ? [source] : [], auxiliaryCfg };
  }
  if (!metadata.isDirectory()) throw new Error("A origem Brasfoot precisa ser arquivo ou pasta");
  const folderName = basename(source).toLowerCase();
  if (folderName === "teams") {
    const root = dirname(source);
    return {
      root,
      banFiles: await recursiveFiles(source, ".ban"),
      cfgFiles: await directFiles(join(root, "conf_ligas_nacionais"), ".cfg"),
      auxiliaryCfg: [],
    };
  }
  const teamsDirectory = await exists(join(source, "teams")) ? join(source, "teams") : source;
  const configDirectory = await exists(join(source, "conf_ligas_nacionais")) ? join(source, "conf_ligas_nacionais") : source;
  return {
    root: source,
    banFiles: await recursiveFiles(teamsDirectory, ".ban"),
    cfgFiles: await directFiles(configDirectory, ".cfg"),
    auxiliaryCfg: [],
  };
}

function leagueConfigs(root) {
  if (root?.$class !== "est.ArrayLigaType") throw new Error(`Classe CFG inesperada: ${root?.$class ?? "vazia"}`);
  const arrayList = Object.values(root.$fields ?? {}).find((value) => value?.$class === "java.util.ArrayList");
  return listValues(arrayList).filter((value) => value?.$class === "est.ConfigLigaType");
}

async function readSerialized(filePath, options) {
  return parseJavaSerialization(await readFile(filePath), options);
}

function safeAssetSlug(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate === "." || candidate === ".." || candidate.includes("/") || candidate.includes("\\")) return null;
  return candidate;
}

async function assetMap(root, ...sourceSlugs) {
  const slugs = [...new Set(sourceSlugs.map(safeAssetSlug).filter(Boolean))];
  const directories = {
    shield: "escudos", miniShield: "escudosMini", shirt: "camisas", shirt2: "camisas2", shirt3: "camisas3",
  };
  const pairs = await Promise.all(Object.entries(directories).map(async ([name, directory]) => {
    for (const slug of slugs) {
      const filePath = join(root, "teams", directory, `${slug}.png`);
      if (await exists(filePath)) return [name, relative(root, filePath).replaceAll("\\", "/")];
    }
    return [name, null];
  }));
  return Object.fromEntries(pairs.filter(([, value]) => value));
}

function reportError(report, filePath, error, corrupted = false) {
  const entry = {
    file: relative(report.inputPath, filePath).replaceAll("\\", "/") || basename(filePath),
    code: error.code ?? "BRASFOOT_PARSE_ERROR",
    message: error.message,
  };
  report.errors.push(entry);
  if (corrupted) report.corrupted.push(entry);
}

export function planClubIds(filePaths, root, report) {
  const groups = new Map();
  for (const filePath of filePaths) {
    const filenameStem = basename(filePath, extname(filePath));
    const baseId = safeId(filenameStem, "time");
    if (!groups.has(baseId)) groups.set(baseId, []);
    groups.get(baseId).push(filePath);
  }
  const result = new Map();
  for (const [baseId, paths] of groups) {
    if (paths.length === 1) {
      result.set(paths[0], baseId);
      continue;
    }
    const collision = { baseId, files: [] };
    for (const filePath of paths) {
      const sourcePath = normalizedSourcePath(root, filePath);
      const resolvedId = `${baseId}-${stableHash(sourcePath, 16)}`;
      result.set(filePath, resolvedId);
      collision.files.push({
        resolvedId,
        file: relative(root, filePath).replaceAll("\\", "/"),
      });
    }
    report.duplicates.clubs.push(collision);
    report.warnings.push({ code: "DUPLICATE_CLUB_ID_RESOLVED", ...collision });
  }
  return result;
}

export async function parseBrasfootSource(inputPath, options = {}) {
  const discovered = await discoverSource(inputPath);
  const totalFiles = discovered.banFiles.length + discovered.cfgFiles.length + discovered.auxiliaryCfg.length;
  if (totalFiles > (options.maxFiles ?? MAX_SOURCE_FILES)) throw new Error("Origem Brasfoot excede o limite de arquivos");
  const report = {
    sourceFormat: "brasfoot-java-serialization",
    inputPath: resolve(inputPath),
    scanned: { ban: discovered.banFiles.length, cfg: discovered.cfgFiles.length },
    success: { clubs: 0, players: 0, leagues: 0 },
    errors: [],
    warnings: [],
    duplicates: { clubs: [], clubNames: [], players: [], leagues: [] },
    corrupted: [],
    assets: { shieldsFound: 0, shieldsMissing: 0, miniShieldsFound: 0, shirtsFound: 0 },
  };
  const parserOptions = {
    maxBytes: options.maxBytes ?? 32 * 1024 * 1024,
    maxDepth: options.maxDepth ?? 128,
    maxHandles: options.maxHandles ?? 250_000,
    maxArrayLength: options.maxArrayLength ?? 100_000,
  };
  const countriesById = new Map();
  const configs = [];
  const configFiles = [...discovered.cfgFiles, ...discovered.auxiliaryCfg];
  for (const filePath of configFiles) {
    try {
      const root = await readSerialized(filePath, parserOptions);
      const countryCode = safeId(basename(filePath, extname(filePath)), "pais").toUpperCase();
      const values = leagueConfigs(root);
      for (const config of values) {
        const countryId = Number(field(config, "pais", 0));
        if (countryId > 0 && !countriesById.has(countryId)) countriesById.set(countryId, countryCode);
        if (discovered.cfgFiles.includes(filePath)) configs.push({ config, countryCode, filePath });
      }
    } catch (error) {
      reportError(report, filePath, error, error instanceof JavaSerializationError);
    }
  }
  const leagues = [];
  const leagueIds = new Set();
  for (const { config, countryCode, filePath } of configs) {
    try {
      const league = mapBrasfootLeague(config, { countryCode, countriesById });
      const comparisonId = league.id.toLocaleUpperCase("pt-BR");
      if (leagueIds.has(comparisonId)) {
        report.duplicates.leagues.push({ id: league.id, file: relative(discovered.root, filePath).replaceAll("\\", "/") });
        continue;
      }
      leagueIds.add(comparisonId);
      leagues.push(league);
    } catch (error) {
      reportError(report, filePath, error);
    }
  }
  const clubs = [];
  const players = [];
  const plannedClubIds = planClubIds(discovered.banFiles, discovered.root, report);
  const clubIds = new Set();
  const clubsByName = new Map();
  const playerIds = new Set();
  let seniorPlayers = 0;
  let youthPlayers = 0;
  for (const filePath of discovered.banFiles) {
    try {
      const team = await readSerialized(filePath, parserOptions);
      const slug = String(field(team, "d", basename(filePath, extname(filePath))));
      const assets = await assetMap(discovered.root, slug, basename(filePath, extname(filePath)));
      const mapped = mapBrasfootTeam(team, {
        filenameStem: basename(filePath, extname(filePath)),
        clubId: plannedClubIds.get(filePath),
        countriesById,
        assets,
      });
      const comparisonId = mapped.club.id.toLocaleUpperCase("pt-BR");
      if (clubIds.has(comparisonId)) {
        throw new Error(`Planejamento gerou ID de clube duplicado: ${mapped.club.id}`);
      }
      clubIds.add(comparisonId);
      clubs.push(mapped.club);
      const comparisonName = mapped.club.name.toLocaleLowerCase("pt-BR");
      if (clubsByName.has(comparisonName)) {
        const duplicateName = {
          name: mapped.club.name,
          clubIds: [clubsByName.get(comparisonName), mapped.club.id],
          file: relative(discovered.root, filePath).replaceAll("\\", "/"),
        };
        report.duplicates.clubNames.push(duplicateName);
        report.warnings.push({ code: "DUPLICATE_CLUB_NAME", ...duplicateName });
      } else {
        clubsByName.set(comparisonName, mapped.club.id);
      }
      if (assets.shield) report.assets.shieldsFound += 1;
      else report.assets.shieldsMissing += 1;
      if (assets.miniShield) report.assets.miniShieldsFound += 1;
      if (assets.shirt || assets.shirt2 || assets.shirt3) report.assets.shirtsFound += 1;
      for (const player of mapped.players) {
        const playerComparisonId = player.id.toLocaleUpperCase("pt-BR");
        if (playerIds.has(playerComparisonId)) {
          report.duplicates.players.push({ id: player.id, clubId: mapped.club.id });
          continue;
        }
        playerIds.add(playerComparisonId);
        players.push(player);
        if (player.brasfootRoster === "youth") youthPlayers += 1;
        else seniorPlayers += 1;
      }
    } catch (error) {
      reportError(report, filePath, error, error instanceof JavaSerializationError);
    }
  }
  report.success = {
    clubs: clubs.length,
    players: players.length,
    seniorPlayers,
    youthPlayers,
    leagues: leagues.length,
  };
  return {
    dataset: { version: "brasfoot-binary-1", clubs, players, leagues, cups: [] },
    report,
    assetRoot: discovered.root,
  };
}
