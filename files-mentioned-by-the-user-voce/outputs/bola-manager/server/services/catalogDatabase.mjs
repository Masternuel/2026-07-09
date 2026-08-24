import { editorCreateSchemas } from "../editorSchemas.mjs";
import { calculatePlayerOverall } from "../game/lineupStrength.mjs";

export const CATALOG_DATABASE_FORMAT = "bola-manager-database";
export const CATALOG_DATABASE_VERSION = 1;
export const MAX_CATALOG_DATABASE_BYTES = 24 * 1024 * 1024;

export const CATALOG_DATABASE_ENTITIES = Object.freeze([
  "leagues",
  "clubs",
  "players",
  "tournaments",
]);

const MAX_RECORDS = Object.freeze({
  leagues: 500,
  clubs: 5_000,
  players: 100_000,
  tournaments: 1_000,
});

const CORE_FIELDS = Object.freeze({
  leagues: ["name", "country", "level", "division", "legs", "active"],
  clubs: [
    "name", "abbreviation", "colors", "darkThemeColor", "lightThemeColor", "stadium",
    "stadiumCapacity", "reputation", "division", "country", "state", "city", "leagueId", "budget",
    "crestImageUrl", "crestImagePath", "active",
  ],
  players: [
    "clubId", "name", "position", "age", "nationality", "shirtNumber", "overall",
    "attributes", "isStar", "avatarImageUrl", "avatarImagePath", "active",
  ],
  tournaments: [
    "name", "format", "teamCount", "legs", "tiebreakers", "teamIds",
    "trophyImageUrl", "trophyImagePath", "active",
  ],
});

const MEDIA_PATH_FIELDS = Object.freeze({
  clubs: "crestImagePath",
  players: "avatarImagePath",
  tournaments: "trophyImagePath",
});

const AUDIT_FIELDS = new Set(["createdAt", "updatedAt", "updatedBy"]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_RECORD_BYTES = 512 * 1024;

export class CatalogDatabaseError extends Error {
  constructor(message, code, status = 400, details) {
    super(message);
    this.name = "CatalogDatabaseError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

function fail(message, code, details) {
  throw new CatalogDatabaseError(message, code, 400, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeJsonValue(value, path = "record", depth = 0) {
  if (depth > 16) fail("Registro excede a profundidade permitida", "CATALOG_DATABASE_RECORD_INVALID", { path });
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 10_000) fail("Lista muito grande no registro", "CATALOG_DATABASE_RECORD_INVALID", { path });
    return value.map((item, index) => safeJsonValue(item, `${path}.${index}`, depth + 1));
  }
  if (!isPlainObject(value)) fail("Valor invalido no registro", "CATALOG_DATABASE_RECORD_INVALID", { path });
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) continue;
    result[key] = safeJsonValue(item, `${path}.${key}`, depth + 1);
  }
  return result;
}

function normalizedKey(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function normalizeRecord(entity, rawRecord, index) {
  if (!isPlainObject(rawRecord)) {
    fail("Registro da base precisa ser um objeto", "CATALOG_DATABASE_RECORD_INVALID", { entity, index });
  }
  const mediaPathField = MEDIA_PATH_FIELDS[entity];
  const exportableRecord = {};
  for (const [key, value] of Object.entries(rawRecord)) {
    if (AUDIT_FIELDS.has(key) || key === mediaPathField || UNSAFE_KEYS.has(key)) continue;
    exportableRecord[key] = value;
  }
  if (mediaPathField) exportableRecord[mediaPathField] = null;
  const safeRecord = safeJsonValue(exportableRecord, `${entity}.${index}`);
  const recordBytes = Buffer.byteLength(JSON.stringify(safeRecord), "utf8");
  if (recordBytes > MAX_RECORD_BYTES) {
    fail("Registro excede o limite de 512 KB", "CATALOG_DATABASE_RECORD_TOO_LARGE", {
      entity, index, maximumBytes: MAX_RECORD_BYTES, receivedBytes: recordBytes,
    });
  }
  const coreInput = { id: safeRecord.id };
  for (const field of CORE_FIELDS[entity]) {
    if (Object.hasOwn(safeRecord, field)) coreInput[field] = safeRecord[field];
  }
  if (mediaPathField) coreInput[mediaPathField] = null;
  const parsed = editorCreateSchemas[entity].safeParse(coreInput);
  if (!parsed.success) {
    fail("Registro invalido na base importada", "CATALOG_DATABASE_RECORD_INVALID", {
      entity,
      index,
      id: safeRecord.id ?? null,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const extras = { ...safeRecord };
  delete extras.id;
  for (const field of AUDIT_FIELDS) delete extras[field];
  if (mediaPathField) delete extras[mediaPathField];
  const normalized = {
    ...extras,
    ...parsed.data,
    ...(mediaPathField ? { [mediaPathField]: null } : {}),
  };
  return entity === "players"
    ? { ...normalized, overall: calculatePlayerOverall(normalized, normalized.overall) }
    : normalized;
}

function assertUniqueIds(entity, records) {
  const ids = new Map();
  for (const record of records) {
    const key = normalizedKey(record.id);
    if (ids.has(key)) {
      fail("A base contem IDs duplicados", "CATALOG_DATABASE_DUPLICATE_ID", {
        entity,
        ids: [ids.get(key), record.id],
      });
    }
    ids.set(key, record.id);
  }
  return ids;
}

function canonicalizeReferences(records) {
  const leagueIds = assertUniqueIds("leagues", records.leagues);
  const clubIds = assertUniqueIds("clubs", records.clubs);
  assertUniqueIds("players", records.players);
  assertUniqueIds("tournaments", records.tournaments);

  for (const club of records.clubs) {
    if (!club.leagueId) continue;
    const leagueId = leagueIds.get(normalizedKey(club.leagueId));
    if (!leagueId) {
      fail("Clube referencia uma liga ausente", "CATALOG_DATABASE_REFERENCE_INVALID", {
        entity: "clubs", id: club.id, field: "leagueId", reference: club.leagueId,
      });
    }
    club.leagueId = leagueId;
  }
  for (const player of records.players) {
    const clubId = clubIds.get(normalizedKey(player.clubId));
    if (!clubId) {
      fail("Jogador referencia um clube ausente", "CATALOG_DATABASE_REFERENCE_INVALID", {
        entity: "players", id: player.id, field: "clubId", reference: player.clubId,
      });
    }
    player.clubId = clubId;
  }
  const clubsById = new Map(records.clubs.map((club) => [club.id, club]));
  for (const tournament of records.tournaments) {
    tournament.teamIds = tournament.teamIds.map((teamId) => {
      const clubId = clubIds.get(normalizedKey(teamId));
      if (!clubId) {
        fail("Torneio referencia um clube ausente", "CATALOG_DATABASE_REFERENCE_INVALID", {
          entity: "tournaments", id: tournament.id, field: "teamIds", reference: teamId,
        });
      }
      if (tournament.active === true && clubsById.get(clubId)?.active !== true) {
        fail("Torneio ativo referencia um clube inativo", "CATALOG_DATABASE_REFERENCE_INVALID", {
          entity: "tournaments", id: tournament.id, field: "teamIds", reference: teamId,
        });
      }
      return clubId;
    });
  }
}

export function parseCatalogDatabase(value) {
  if (!isPlainObject(value)) fail("Arquivo de base invalido", "CATALOG_DATABASE_INVALID");
  if (value.format !== CATALOG_DATABASE_FORMAT) {
    fail("Este arquivo nao e uma base do Bola Manager", "CATALOG_DATABASE_FORMAT_INVALID");
  }
  if (value.version !== CATALOG_DATABASE_VERSION) {
    fail("Versao da base nao suportada", "CATALOG_DATABASE_VERSION_UNSUPPORTED", {
      supported: CATALOG_DATABASE_VERSION,
      received: value.version ?? null,
    });
  }
  if (!isPlainObject(value.records)) fail("A base nao contem registros", "CATALOG_DATABASE_RECORDS_REQUIRED");

  const records = {};
  for (const entity of CATALOG_DATABASE_ENTITIES) {
    const source = value.records[entity];
    if (!Array.isArray(source)) {
      fail("Colecao ausente na base", "CATALOG_DATABASE_COLLECTION_REQUIRED", { entity });
    }
    if (source.length > MAX_RECORDS[entity]) {
      fail("Colecao excede o limite de registros", "CATALOG_DATABASE_TOO_MANY_RECORDS", {
        entity, maximum: MAX_RECORDS[entity], received: source.length,
      });
    }
    records[entity] = source.map((record, index) => normalizeRecord(entity, record, index));
  }
  canonicalizeReferences(records);
  return {
    format: CATALOG_DATABASE_FORMAT,
    version: CATALOG_DATABASE_VERSION,
    records,
  };
}

export function createCatalogDatabasePackage(records, now = new Date()) {
  const normalizedRecords = Object.fromEntries(CATALOG_DATABASE_ENTITIES.map((entity) => [
    entity,
    (records[entity] ?? []).map((record, index) => normalizeRecord(entity, record, index)),
  ]));
  canonicalizeReferences(normalizedRecords);
  const countries = [...new Set([
    ...normalizedRecords.leagues.map((record) => record.country),
    ...normalizedRecords.clubs.map((record) => record.country),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right, "pt-BR"));
  return {
    format: CATALOG_DATABASE_FORMAT,
    version: CATALOG_DATABASE_VERSION,
    exportedAt: now.toISOString(),
    application: "Bola Manager",
    summary: {
      countries,
      counts: Object.fromEntries(CATALOG_DATABASE_ENTITIES.map((entity) => [entity, normalizedRecords[entity].length])),
    },
    records: normalizedRecords,
  };
}
