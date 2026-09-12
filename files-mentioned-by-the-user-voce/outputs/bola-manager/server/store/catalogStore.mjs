import { randomUUID } from "node:crypto";
import { calculatePlayerOverall } from "../game/lineupStrength.mjs";
import { calculateStarImpact, sortPlayersForSelection } from "../game/starImpact.mjs";
import { tournamentConsistencySchema } from "../editorSchemas.mjs";
import {
  CATALOG_DATABASE_ENTITIES,
  MAX_CATALOG_DATABASE_BYTES,
  createCatalogDatabasePackage,
  parseCatalogDatabase,
  validateCatalogDatabaseReferences,
} from "../services/catalogDatabase.mjs";
import { canonicalChecksum } from "./roomPersistenceSections.mjs";
import {
  catalogDatabaseDocument,
  createGlobalCatalogGenerationFirestore,
  createScopedCatalogFirestore,
} from "./catalogScope.mjs";
import { commitCatalogGeneration } from "./catalogImportTransaction.mjs";

const COLLECTIONS = Object.freeze({
  leagues: "brasfootLeagues",
  clubs: "brasfootClubs",
  players: "brasfootPlayers",
  tournaments: "tournaments",
});

const MEDIA_FIELDS = Object.freeze({
  clubs: Object.freeze({ url: "crestImageUrl", path: "crestImagePath" }),
  players: Object.freeze({ url: "avatarImageUrl", path: "avatarImagePath" }),
  tournaments: Object.freeze({ url: "trophyImageUrl", path: "trophyImagePath" }),
});

const EDITOR_PAGE_LIMIT = 50;
const CATALOG_INITIALIZATION_LEASE_MS = 30 * 1000;
const CATALOG_INITIALIZATION_HEARTBEAT_MS = 10 * 1000;
const CATALOG_INITIALIZATION_POLL_MS = 100;
const CATALOG_INITIALIZATION_POLL_ATTEMPTS = 450;
const CATALOG_TRANSACTION_MAX_ITEMS = 390;
const CATALOG_TRANSACTION_MAX_BYTES = 8 * 1024 * 1024;

export class CatalogStoreError extends Error {
  constructor(message, code, status = 400, details) {
    super(message);
    this.name = "CatalogStoreError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function unavailableError() {
  return new CatalogStoreError(
    "Editor indisponivel sem Firestore configurado",
    "EDITOR_CATALOG_UNAVAILABLE",
    503,
  );
}

function notFoundError(entity, id) {
  return new CatalogStoreError(
    `Registro nao encontrado: ${entity}/${id}`,
    "EDITOR_RECORD_NOT_FOUND",
    404,
  );
}

function invalidCursorError() {
  return new CatalogStoreError("Cursor de paginacao invalido", "EDITOR_CURSOR_INVALID", 400);
}

function encodeCursor({ entity, id, query = null, clubId = null, scope = null }) {
  return Buffer.from(JSON.stringify({ entity, id, query, clubId, scope }), "utf8").toString("base64url");
}

function decodeCursor(value, expected) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object"
      || typeof parsed.id !== "string"
      || parsed.entity !== expected.entity
      || (parsed.query ?? null) !== (expected.query ?? null)
      || (parsed.clubId ?? null) !== (expected.clubId ?? null)
      || (parsed.scope ?? null) !== (expected.scope ?? null)) {
      throw invalidCursorError();
    }
    return parsed;
  } catch (error) {
    if (error instanceof CatalogStoreError) throw error;
    throw invalidCursorError();
  }
}

function snapshotRecord(document, entity) {
  const record = { ...document.data(), id: document.id };
  return entity === "players" ? {
    ...record,
    isStar: record.isStar === true,
    overall: calculatePlayerOverall(record, record.overall),
  } : record;
}

function sortRecords(records) {
  return records.sort((left, right) => (
    String(left.name ?? left.id).localeCompare(String(right.name ?? right.id), "pt-BR")
  ));
}

function tournamentParticipant(record) {
  const reputation = Number(record.reputation);
  const stadiumCapacity = Number(record.stadiumCapacity);
  return {
    id: record.id,
    name: record.name,
    abbreviation: record.abbreviation ?? "",
    colors: Array.isArray(record.colors) ? record.colors : [],
    ...(typeof record.darkThemeColor === "string" ? { darkThemeColor: record.darkThemeColor } : {}),
    ...(typeof record.lightThemeColor === "string" ? { lightThemeColor: record.lightThemeColor } : {}),
    country: record.country ?? null,
    division: record.division ?? null,
    leagueId: record.leagueId ?? null,
    reputation: Number.isFinite(reputation) ? Math.max(1, Math.min(20, reputation)) : 10,
    stadium: typeof record.stadium === "string" ? record.stadium : null,
    stadiumCapacity: Number.isInteger(stadiumCapacity) ? Math.max(0, stadiumCapacity) : 0,
    crestImageUrl: record.crestImageUrl ?? null,
    crestImagePath: record.crestImagePath ?? null,
  };
}

function competitionPrizeMoney(record) {
  const objectPrizes = [record?.prizes, record?.rewards, record?.awards]
    .filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const rankedPrize = [record?.prizes, record?.rewards, record?.awards]
    .filter(Array.isArray)
    .flat()
    .find((entry) => entry && typeof entry === "object" && (
      Number(entry.position) === 1
      || ["winner", "champion", "campeao", "campeão"].includes(
        String(entry.type ?? entry.place ?? entry.label ?? "").trim().toLocaleLowerCase("pt-BR"),
      )
    ));
  const configured = [
    record?.prizeMoney,
    record?.championPrize,
    record?.winnerPrize,
    record?.firstPlacePrize,
    record?.premioCampeao,
    record?.premiacaoCampeao,
    record?.prize,
    record?.premio,
    record?.premiacao,
    ...objectPrizes.flatMap((value) => [
      value.winner,
      value.champion,
      value.campeao,
      value.first,
      value[1],
    ]),
    rankedPrize?.amount,
    rankedPrize?.value,
    rankedPrize?.prizeMoney,
  ].map(Number).find((amount) => Number.isSafeInteger(amount) && amount > 0);
  return configured ?? 0;
}

function publicTournament(record, participantsById) {
  const teamIds = Array.isArray(record.teamIds) ? record.teamIds : [];
  const prizeMoney = competitionPrizeMoney(record);
  return {
    id: record.id,
    name: record.name,
    format: record.format,
    teamCount: record.teamCount,
    legs: record.legs,
    tiebreakers: Array.isArray(record.tiebreakers) ? record.tiebreakers : [],
    teamIds,
    trophyImageUrl: record.trophyImageUrl ?? null,
    trophyImagePath: record.trophyImagePath ?? null,
    ...(prizeMoney > 0 ? { prizeMoney } : {}),
    active: true,
    participants: teamIds.map((id) => participantsById.get(id)).filter(Boolean),
  };
}

function recordIsActive(record) {
  return record.active !== false;
}

function initializationLeaseExpired(metadata, timestamp) {
  const leaseTimestamp = Date.parse(
    metadata?.initializationHeartbeatAt
    ?? metadata?.initializationStartedAt
    ?? "",
  );
  const nowTimestamp = Date.parse(timestamp);
  return !Number.isFinite(leaseTimestamp)
    || !Number.isFinite(nowTimestamp)
    || nowTimestamp - leaseTimestamp >= CATALOG_INITIALIZATION_LEASE_MS;
}

function catalogIdKey(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function leagueLegs(record) {
  if (record?.legs === "single" || record?.legs === "double") return record.legs;
  if (typeof record?.brasfootRaw?.doisTurnos === "boolean") {
    return record.brasfootRaw.doisTurnos ? "double" : "single";
  }
  return "double";
}

function publicLeague(record, clubCount) {
  const prizeMoney = competitionPrizeMoney(record);
  return {
    id: record.id,
    name: record.name ?? record.id,
    country: record.country ?? "",
    level: Number.isFinite(Number(record.level)) ? Number(record.level) : 1,
    division: record.division ?? "",
    ...(prizeMoney > 0 ? { prizeMoney } : {}),
    active: true,
    clubCount,
  };
}

function publicCompetitionClub(record) {
  const configuredColor = Array.isArray(record.colors)
    ? record.colors.find((color) => typeof color === "string" && color.trim())
    : null;
  const reputation = Number(record.reputation);
  const budget = Number(record.budget);
  const stadiumCapacity = Number(record.stadiumCapacity);
  const configuredCode = typeof record.abbreviation === "string" ? record.abbreviation.trim() : "";
  const configuredStadium = typeof record.stadium === "string" ? record.stadium.trim() : "";
  return {
    id: record.id,
    name: record.name ?? record.id,
    code: (configuredCode || record.id).slice(0, 8).toLocaleUpperCase("pt-BR"),
    color: configuredColor ?? "#c8ff3d",
    ...(typeof record.darkThemeColor === "string" ? { darkThemeColor: record.darkThemeColor } : {}),
    ...(typeof record.lightThemeColor === "string" ? { lightThemeColor: record.lightThemeColor } : {}),
    reputation: Number.isFinite(reputation) && reputation > 0 ? reputation : 10,
    budget: Number.isFinite(budget) && budget >= 0
      ? Math.min(2_000_000_000, Math.trunc(budget))
      : 0,
    stadium: configuredStadium || "A definir",
    stadiumCapacity: Number.isInteger(stadiumCapacity)
      && stadiumCapacity >= 0
      && stadiumCapacity <= 500_000
      ? stadiumCapacity
      : 0,
    crestImageUrl: typeof record.crestImageUrl === "string" ? record.crestImageUrl : null,
    leagueId: String(record.leagueId ?? "").trim(),
  };
}

async function loadActiveCompetitionRecords(firestore) {
  const [leaguesSnapshot, clubsSnapshot] = await Promise.all([
    firestore.collection(COLLECTIONS.leagues).get(),
    firestore.collection(COLLECTIONS.clubs).get(),
  ]);
  const leagues = leaguesSnapshot.docs
    .map((document) => snapshotRecord(document, "leagues"))
    .filter(recordIsActive);
  const activeLeagueIds = new Set(leagues.map((league) => catalogIdKey(league.id)));
  const clubs = clubsSnapshot.docs
    .map((document) => snapshotRecord(document, "clubs"))
    .filter(recordIsActive)
    .filter((club) => activeLeagueIds.has(catalogIdKey(club.leagueId)));
  return { leagues, clubs };
}

function selectedLeagueIds(leagueIds) {
  if (leagueIds === undefined || leagueIds === null) return null;
  const values = Array.isArray(leagueIds) ? leagueIds : [leagueIds];
  return new Set(values.map(catalogIdKey).filter(Boolean));
}

function transactionChunks(items, recordForItem = (item) => item.record) {
  const chunks = [];
  let chunk = [];
  let bytes = 0;
  for (const item of items) {
    let itemBytes = 1024;
    try {
      itemBytes += Buffer.byteLength(JSON.stringify(recordForItem(item) ?? null), "utf8");
    } catch {
      itemBytes += 512 * 1024;
    }
    if (chunk.length > 0 && (chunk.length >= CATALOG_TRANSACTION_MAX_ITEMS
      || bytes + itemBytes > CATALOG_TRANSACTION_MAX_BYTES)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(item);
    bytes += itemBytes;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

export class CatalogStore {
  constructor({
    firestore = null,
    rootFirestore = firestore,
    scopeFirestore = firestore,
    ownerId = null,
    now = () => new Date(),
  } = {}) {
    this.firestore = firestore;
    this.rootFirestore = rootFirestore;
    this.scopeFirestore = scopeFirestore;
    this.ownerId = ownerId;
    this.now = now;
    this.generationId = null;
  }

  get source() {
    return this.firestore ? "firestore" : "brasfoot-not-loaded";
  }

  forOwner(ownerId) {
    if (!this.rootFirestore) return this;
    const scopeFirestore = createScopedCatalogFirestore(this.rootFirestore, ownerId);
    return new CatalogStore({
      firestore: scopeFirestore,
      rootFirestore: this.rootFirestore,
      scopeFirestore,
      ownerId: String(ownerId),
      now: this.now,
    });
  }

  async ensureInitialized() {
    if (!this.rootFirestore) return this;
    if (!this.ownerId) {
      const current = await this.rootFirestore.collection("brasfootImports").doc("current").get();
      const generationId = current.data()?.activeGenerationId;
      this.firestore = generationId
        ? createGlobalCatalogGenerationFirestore(this.rootFirestore, generationId)
        : this.scopeFirestore;
      return this;
    }
    const metadataReference = catalogDatabaseDocument(this.rootFirestore, this.ownerId);
    const timestamp = this.now().toISOString();
    const initializationId = randomUUID();
    let shouldInitialize = false;
    let waitForInitialization = false;
    let activeGenerationId = null;
    await this.rootFirestore.runTransaction(async (transaction) => {
      shouldInitialize = false;
      waitForInitialization = false;
      const metadata = await transaction.get(metadataReference);
      if (metadata.exists && metadata.data()?.initialized === true) {
        activeGenerationId = metadata.data()?.activeGenerationId ?? null;
        if (metadata.data()?.status === "importing") {
          throw new CatalogStoreError(
            "A base esta sendo importada. Tente novamente em instantes",
            "CATALOG_DATABASE_IMPORT_IN_PROGRESS",
            409,
          );
        }
        if (metadata.data()?.status === "import_failed") {
          throw new CatalogStoreError(
            "A ultima importacao falhou e a base precisa ser recuperada",
            "CATALOG_DATABASE_RECOVERY_REQUIRED",
            503,
          );
        }
        return;
      }
      if (metadata.data()?.status === "initializing") {
        if (!initializationLeaseExpired(metadata.data(), timestamp)) {
          waitForInitialization = true;
          return;
        }
      }
      transaction.set(metadataReference, {
        ...(metadata.exists ? metadata.data() : {}),
        ownerId: this.ownerId,
        initialized: false,
        status: "initializing",
        initializationId,
        initializationStartedAt: timestamp,
        initializationHeartbeatAt: timestamp,
        updatedAt: timestamp,
      });
      shouldInitialize = true;
    });
    if (waitForInitialization) {
      for (let attempt = 0; attempt < CATALOG_INITIALIZATION_POLL_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, CATALOG_INITIALIZATION_POLL_MS));
        const current = await metadataReference.get();
        const currentData = current.data();
        if (currentData?.initialized === true && currentData?.status === "ready") {
          this.#useGeneration(currentData.activeGenerationId ?? null);
          return this;
        }
        if (["initialization_failed", "import_failed"].includes(currentData?.status)
          || currentData?.status !== "initializing"
          || initializationLeaseExpired(currentData, this.now().toISOString())) {
          return this.ensureInitialized();
        }
      }
      throw new CatalogStoreError(
        "A base continua sendo preparada. Tente novamente em instantes",
        "CATALOG_DATABASE_INITIALIZING",
        409,
      );
    }
    if (!shouldInitialize) {
      this.#useGeneration(activeGenerationId);
      return this;
    }

    let heartbeatInFlight = false;
    const refreshInitializationHeartbeat = async () => {
      await this.rootFirestore.runTransaction(async (transaction) => {
        const current = await transaction.get(metadataReference);
        if (current.data()?.initializationId !== initializationId) return;
        const heartbeatAt = this.now().toISOString();
        transaction.set(metadataReference, {
          ...current.data(),
          initializationHeartbeatAt: heartbeatAt,
          updatedAt: heartbeatAt,
        });
      });
    };
    const heartbeatTimer = setInterval(() => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = true;
      void refreshInitializationHeartbeat()
        .catch(() => {})
        .finally(() => { heartbeatInFlight = false; });
    }, CATALOG_INITIALIZATION_HEARTBEAT_MS);
    heartbeatTimer.unref?.();

    try {
      const globalCurrent = await this.rootFirestore.collection("brasfootImports").doc("current").get();
      const globalGenerationId = globalCurrent.data()?.activeGenerationId;
      const globalCatalog = globalGenerationId
        ? createGlobalCatalogGenerationFirestore(this.rootFirestore, globalGenerationId)
        : this.rootFirestore;
      const snapshots = await Promise.all(CATALOG_DATABASE_ENTITIES.map((entity) => (
        globalCatalog.collection(COLLECTIONS[entity]).get()
      )));
      await refreshInitializationHeartbeat();
      const operations = [];
      snapshots.forEach((snapshot, index) => {
        const entity = CATALOG_DATABASE_ENTITIES[index];
        const mediaPath = MEDIA_FIELDS[entity]?.path;
        for (const document of snapshot.docs) {
          const record = { ...document.data(), id: document.id };
          if (mediaPath) record[mediaPath] = null;
          operations.push({ reference: this.#collection(entity).doc(document.id), record });
        }
      });
      for (const chunk of transactionChunks(operations)) {
        await this.rootFirestore.runTransaction(async (transaction) => {
          const current = await transaction.get(metadataReference);
          if (current.data()?.initializationId !== initializationId) {
            throw new CatalogStoreError(
              "A preparacao desta base foi substituida por outra tentativa",
              "CATALOG_DATABASE_INITIALIZATION_REPLACED",
              409,
            );
          }
          for (const operation of chunk) transaction.set(operation.reference, operation.record);
          transaction.set(metadataReference, {
            ...current.data(),
            initializationHeartbeatAt: this.now().toISOString(),
            updatedAt: this.now().toISOString(),
          });
        });
      }
      await this.rootFirestore.runTransaction(async (transaction) => {
        const current = await transaction.get(metadataReference);
        if (current.data()?.initializationId !== initializationId) {
          throw new CatalogStoreError(
            "A preparacao desta base foi substituida por outra tentativa",
            "CATALOG_DATABASE_INITIALIZATION_REPLACED",
            409,
          );
        }
        transaction.set(metadataReference, {
          ownerId: this.ownerId,
          initialized: true,
          status: "ready",
          schemaVersion: 1,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          clonedFromLegacy: true,
          counts: Object.fromEntries(CATALOG_DATABASE_ENTITIES.map((entity, index) => (
            [entity, snapshots[index].docs.length]
          ))),
        });
      });
    } catch (error) {
      await this.rootFirestore.runTransaction(async (transaction) => {
        const current = await transaction.get(metadataReference);
        if (current.data()?.initializationId !== initializationId) return;
        transaction.set(metadataReference, {
          ...(current.exists ? current.data() : {}),
          initialized: false,
          status: "initialization_failed",
          initializationFailedAt: this.now().toISOString(),
          updatedAt: this.now().toISOString(),
        });
      }).catch(() => {});
      throw error;
    } finally {
      clearInterval(heartbeatTimer);
    }
    return this;
  }

  collection(entity) {
    return this.#collection(entity);
  }

  get importLogFirestore() {
    return this.scopeFirestore;
  }

  async importBrasfootData({ data, runId, batchSize = 400, onProgress = async () => {} }) {
    this.#assertAvailable();
    if (!this.ownerId || !this.rootFirestore) {
      throw new CatalogStoreError(
        "Importacao Brasfoot transacional exige uma base pessoal",
        "CATALOG_DATABASE_PERSONAL_REQUIRED",
        409,
      );
    }
    const result = await commitCatalogGeneration({
      rootFirestore: this.rootFirestore,
      metadataReference: catalogDatabaseDocument(this.rootFirestore, this.ownerId),
      sourceFirestoreForGeneration: (generationId) => generationId
        ? createScopedCatalogFirestore(this.rootFirestore, this.ownerId, generationId)
        : this.scopeFirestore,
      generationFirestoreForId: (generationId) => (
        createScopedCatalogFirestore(this.rootFirestore, this.ownerId, generationId)
      ),
      collectionPlan: [
        { collectionName: "brasfootClubs", records: data.clubs },
        { collectionName: "brasfootPlayers", records: data.players },
        { collectionName: "brasfootLeagues", records: data.leagues },
        { collectionName: "brasfootCups", records: data.cups },
        { collectionName: "tournaments", records: [] },
      ],
      runId,
      batchSize,
      now: this.now,
      onProgress,
      metadataCounts: (counts) => ({
        clubs: counts.brasfootClubs ?? 0,
        players: counts.brasfootPlayers ?? 0,
        leagues: counts.brasfootLeagues ?? 0,
        tournaments: counts.tournaments ?? 0,
      }),
    });
    this.#useGeneration(result.generationId);
    return result;
  }

  async exportDatabase() {
    this.#assertAvailable();
    const snapshots = await Promise.all(CATALOG_DATABASE_ENTITIES.map((entity) => (
      this.#collection(entity).get()
    )));
    const records = Object.fromEntries(CATALOG_DATABASE_ENTITIES.map((entity, index) => [
      entity,
      snapshots[index].docs.map((document) => snapshotRecord(document, entity)),
    ]));
    const database = createCatalogDatabasePackage(records, this.now());
    const bytes = Buffer.byteLength(JSON.stringify(database), "utf8");
    if (bytes > MAX_CATALOG_DATABASE_BYTES) {
      throw new CatalogStoreError(
        "A base excede 24 MB e ainda nao pode ser exportada em um unico arquivo",
        "CATALOG_DATABASE_EXPORT_TOO_LARGE",
        413,
        { maximumBytes: MAX_CATALOG_DATABASE_BYTES, receivedBytes: bytes },
      );
    }
    return database;
  }

  async importDatabase(databaseValue, updatedBy, { operationId, batchSize = 400, onProgress } = {}) {
    this.#assertAvailable();
    if (!this.ownerId || !this.rootFirestore) {
      throw new CatalogStoreError(
        "Importacao exige uma base pessoal",
        "CATALOG_DATABASE_PERSONAL_REQUIRED",
        409,
      );
    }
    const database = parseCatalogDatabase(databaseValue);
    const inputChecksum = canonicalChecksum(database);
    const runId = operationId ?? inputChecksum;
    if (typeof runId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) {
      throw new CatalogStoreError("Identificador de importacao invalido", "CATALOG_DATABASE_IMPORT_ID_INVALID", 400);
    }
    const metadataReference = catalogDatabaseDocument(this.rootFirestore, this.ownerId);
    const timestamp = this.now().toISOString();
    const counts = Object.fromEntries(CATALOG_DATABASE_ENTITIES.map((entity) => [entity, database.records[entity].length]));
    const entitiesByCollection = Object.fromEntries(Object.entries(COLLECTIONS).map(([entity, collection]) => [collection, entity]));
    try {
      const result = await commitCatalogGeneration({
        rootFirestore: this.rootFirestore,
        metadataReference,
        sourceFirestoreForGeneration: (generationId) => generationId
          ? createScopedCatalogFirestore(this.rootFirestore, this.ownerId, generationId) : this.scopeFirestore,
        generationFirestoreForId: (generationId) => createScopedCatalogFirestore(this.rootFirestore, this.ownerId, generationId),
        collectionPlan: [
          ...CATALOG_DATABASE_ENTITIES.map((entity) => ({ collectionName: COLLECTIONS[entity], records: database.records[entity] })),
          { collectionName: "brasfootCups", records: [] },
        ],
        runId, batchSize, now: this.now, onProgress,
        operationType: "json", inputChecksum,
        operationReference: metadataReference.collection("jsonImports").doc(runId),
        expectedGenerationId: this.generationId,
        verifyStaging: true,
        validateRecords: (collections) => validateCatalogDatabaseReferences(Object.fromEntries(
          CATALOG_DATABASE_ENTITIES.map((entity) => [entity, collections[COLLECTIONS[entity]]]),
        )),
        transformRecord: (collection, existing, record) => {
          const media = MEDIA_FIELDS[entitiesByCollection[collection]];
          return {
            ...record,
            createdAt: existing.createdAt || timestamp, updatedAt: timestamp, updatedBy,
            ...(media ? {
              [media.path]: (existing[media.url] ?? null) === (record[media.url] ?? null)
                ? existing[media.path] ?? null : null,
            } : {}),
          };
        },
        metadataCounts: (collectionCounts) => Object.fromEntries(CATALOG_DATABASE_ENTITIES.map(
          (entity) => [entity, collectionCounts[COLLECTIONS[entity]] ?? 0],
        )),
        activationMetadata: (completedAt) => ({
          ownerId: this.ownerId, initialized: true, status: "ready", lastImportAt: completedAt,
          lastImportBy: updatedBy, updatedAt: completedAt,
        }),
      });
      await this.ensureInitialized();
      return {
        imported: true, mode: "merge", revision: result.revision, counts,
        total: Object.values(counts).reduce((sum, count) => sum + count, 0),
        operationId: runId, generationId: result.generationId, idempotent: result.idempotent,
        // Older generations still reference their assets; never delete them on activation.
        previousMediaPaths: [],
      };
    } catch (error) {
      if (typeof error?.code === "string" && error.code.startsWith("BRASFOOT_IMPORT_"))
        error.code = error.code.replace("BRASFOOT_IMPORT_", "CATALOG_DATABASE_IMPORT_");
      throw error;
    }
  }

  async list({ limit = EDITOR_PAGE_LIMIT } = {}) {
    this.#assertAvailable();
    const pages = await Promise.all(Object.keys(COLLECTIONS).map((entity) => this.listPage(entity, { limit })));
    const catalog = Object.fromEntries(pages.map((page) => [page.entity, page.records]));
    catalog.meta = Object.fromEntries(pages.map(({ entity, records: _records, ...metadata }) => [entity, metadata]));
    return catalog;
  }

  async listPage(entityValue, {
    limit = EDITOR_PAGE_LIMIT,
    cursor = null,
    query: searchQuery = null,
    clubId: clubIdValue = null,
  } = {}) {
    const entity = String(entityValue);
    const collection = this.#collection(entity);
    const pageLimit = Math.max(1, Math.min(200, Number(limit) || EDITOR_PAGE_LIMIT));
    const query = searchQuery ? String(searchQuery).trim() : null;
    const clubId = clubIdValue ? this.#validId(clubIdValue) : null;
    if (clubId && entity !== "players") {
      throw new CatalogStoreError("clubId so pode filtrar jogadores", "EDITOR_FILTER_INVALID", 400);
    }

    // Rosters are intentionally paginated in memory. This avoids requiring a
    // composite Firestore index for clubId + name in every personal catalog.
    if (clubId) {
      const clubSnapshot = await collection.where("clubId", "==", clubId).get();
      const matchingDocuments = clubSnapshot.docs
        .filter((document) => !query || String(document.data()?.name ?? "").startsWith(query))
        .sort((left, right) => {
          const byName = String(left.data()?.name ?? "").localeCompare(
            String(right.data()?.name ?? ""),
            "pt-BR",
          );
          return byName || left.id.localeCompare(right.id, "pt-BR");
        });
      let startIndex = 0;
      if (cursor) {
        const decoded = decodeCursor(cursor, { entity, query, clubId, scope: this.ownerId });
        const cursorIndex = matchingDocuments.findIndex((document) => document.id === decoded.id);
        if (cursorIndex < 0) throw invalidCursorError();
        startIndex = cursorIndex + 1;
      }
      const pageDocuments = matchingDocuments.slice(startIndex, startIndex + pageLimit + 1);
      const hasMore = pageDocuments.length > pageLimit;
      const documents = pageDocuments.slice(0, pageLimit);
      const records = documents.map((document) => snapshotRecord(document, entity));
      return {
        entity,
        records,
        count: matchingDocuments.length,
        returned: records.length,
        limit: pageLimit,
        nextCursor: hasMore && documents.length > 0
          ? encodeCursor({ entity, id: documents.at(-1).id, query, clubId, scope: this.ownerId })
          : null,
        hasMore,
        filters: { query, clubId },
      };
    }

    let baseQuery = collection;
    baseQuery = baseQuery.orderBy("name");
    let filteredQuery = baseQuery;
    if (query) filteredQuery = filteredQuery.startAt(query).endAt(`${query}\uf8ff`);

    const aggregate = typeof filteredQuery.count === "function" ? await filteredQuery.count().get() : null;
    const count = aggregate ? Number(aggregate.data().count) : null;
    let pageQuery = baseQuery;
    if (cursor) {
      const decoded = decodeCursor(cursor, { entity, query, clubId, scope: this.ownerId });
      const cursorDocument = await collection.doc(decoded.id).get();
      if (!cursorDocument.exists) throw invalidCursorError();
      pageQuery = pageQuery.startAfter(cursorDocument);
    } else if (query) {
      pageQuery = pageQuery.startAt(query);
    }
    if (query) pageQuery = pageQuery.endAt(`${query}\uf8ff`);
    const snapshot = await pageQuery.limit(pageLimit + 1).get();
    const hasMore = snapshot.docs.length > pageLimit;
    const documents = snapshot.docs.slice(0, pageLimit);
    const records = documents.map((document) => snapshotRecord(document, entity));
    const nextCursor = hasMore && documents.length > 0
      ? encodeCursor({ entity, id: documents.at(-1).id, query, clubId, scope: this.ownerId })
      : null;
    return {
      entity,
      records,
      count,
      returned: records.length,
      limit: pageLimit,
      nextCursor,
      hasMore,
      filters: { query, clubId },
    };
  }

  async listActiveTournaments() {
    if (!this.firestore) return { tournaments: [], count: 0, source: this.source };
    const tournamentsSnapshot = await this.firestore
      .collection(COLLECTIONS.tournaments)
      .where("active", "==", true)
      .get();
    const tournamentRecords = tournamentsSnapshot.docs
      .map((document) => snapshotRecord(document, "tournaments"));
    const participantIds = [...new Set(tournamentRecords.flatMap((record) => (
      Array.isArray(record.teamIds) ? record.teamIds : []
    )))];
    const references = participantIds.map((id) => this.firestore.collection(COLLECTIONS.clubs).doc(id));
    const participantDocuments = references.length === 0
      ? []
      : typeof this.firestore.getAll === "function"
        ? await this.firestore.getAll(...references)
        : await Promise.all(references.map((reference) => reference.get()));
    const participantsById = new Map(participantDocuments
      .filter((document) => document.exists && document.data().active === true)
      .map((document) => {
        const club = snapshotRecord(document, "clubs");
        return [club.id, tournamentParticipant(club)];
      }));
    const tournaments = sortRecords(tournamentRecords.map((record) => publicTournament(record, participantsById)));
    return { tournaments, count: tournaments.length, source: "firestore" };
  }

  async listActiveLeagues() {
    if (!this.firestore) return { leagues: [], count: 0, source: this.source };
    const { leagues: activeLeagues, clubs } = await loadActiveCompetitionRecords(this.firestore);
    const clubCounts = new Map();
    for (const club of clubs) {
      const leagueId = catalogIdKey(club.leagueId);
      clubCounts.set(leagueId, (clubCounts.get(leagueId) ?? 0) + 1);
    }
    const leagues = sortRecords(activeLeagues.map((league) => (
      publicLeague(league, clubCounts.get(catalogIdKey(league.id)) ?? 0)
    )));
    return { leagues, count: leagues.length, source: "firestore" };
  }

  async listCompetitionCatalog(leagueIds) {
    if (!this.firestore) return [];
    const selection = selectedLeagueIds(leagueIds);
    if (selection?.size === 0) return [];
    const { leagues: activeLeagues, clubs: activeClubs } = await loadActiveCompetitionRecords(this.firestore);
    const leagues = activeLeagues.filter((league) => (
      selection === null || selection.has(catalogIdKey(league.id))
    ));
    return sortRecords(leagues.map((league) => {
      const leagueId = catalogIdKey(league.id);
      const prizeMoney = competitionPrizeMoney(league);
      const clubs = sortRecords(activeClubs
        .filter((club) => catalogIdKey(club.leagueId) === leagueId)
        .map((club) => ({ ...publicCompetitionClub(club), leagueId: league.id })));
      return {
        id: league.id,
        name: league.name ?? league.id,
        country: league.country ?? "",
        level: Number.isFinite(Number(league.level)) ? Math.max(1, Math.trunc(Number(league.level))) : 1,
        division: league.division ?? "",
        legs: leagueLegs(league),
        ...(prizeMoney > 0 ? { prizeMoney } : {}),
        clubs,
      };
    }));
  }

  async get(entity, idValue) {
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    const current = await collection.doc(id).get();
    if (!current.exists) throw notFoundError(entity, id);
    return snapshotRecord(current, entity);
  }

  async create(entity, input, updatedBy) {
    const collection = this.#collection(entity);
    const id = this.#validId(input?.id);
    const reference = collection.doc(id);
    const timestamp = this.now().toISOString();
    let record = {
      ...input,
      ...(entity === "players" ? { isStar: input?.isStar === true } : {}),
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy,
    };
    if (entity === "players") {
      record = { ...record, overall: calculatePlayerOverall(record, record.overall) };
    }
    this.#assertRecordConsistency(entity, record);

    await this.#runCatalogMutation(async (transaction) => {
      const current = await transaction.get(reference);
      if (current.exists) {
        throw new CatalogStoreError(
          `Ja existe um registro com o ID ${id}`,
          "EDITOR_RECORD_EXISTS",
          409,
        );
      }
      await this.#assertReferences(transaction, entity, record);
      transaction.set(reference, record);
    });
    return { ...record };
  }

  async getStarImpact(clubIdValue, { lineupIds } = {}) {
    const clubId = this.#validId(clubIdValue);
    if (!this.firestore) {
      return { ...calculateStarImpact(clubId, [], { lineupIds }), source: this.source };
    }
    const snapshot = await this.firestore
      .collection(COLLECTIONS.players)
      .where("clubId", "==", clubId)
      .get();
    const players = snapshot.docs.map((document) => snapshotRecord(document, "players"));
    return { ...calculateStarImpact(clubId, players, { lineupIds }), source: "firestore" };
  }

  async listPlayers(clubIdValue) {
    const clubId = this.#validId(clubIdValue);
    if (!this.firestore) {
      return { players: [], count: 0, source: this.source };
    }
    const snapshot = await this.firestore
      .collection(COLLECTIONS.players)
      .where("clubId", "==", clubId)
      .get();
    const players = sortPlayersForSelection(snapshot.docs
      .map((document) => snapshotRecord(document, "players"))
      .filter((player) => player.active !== false));
    return {
      players,
      count: players.length,
      source: "firestore",
    };
  }

  async update(entity, idValue, changes, updatedBy) {
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    if (Object.hasOwn(changes ?? {}, "id")) {
      throw new CatalogStoreError("O ID do registro e imutavel", "EDITOR_ID_IMMUTABLE", 400);
    }
    const reference = collection.doc(id);
    let result;

    await this.#runCatalogMutation(async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists) throw notFoundError(entity, id);
      const existing = snapshotRecord(current, entity);
      const timestamp = this.now().toISOString();
      result = {
        ...existing,
        ...changes,
        id,
        createdAt: existing.createdAt ?? timestamp,
        updatedAt: timestamp,
        updatedBy,
      };
      if (entity === "players") {
        result = { ...result, overall: calculatePlayerOverall(result, result.overall) };
      }
      this.#assertRecordConsistency(entity, result);
      await this.#assertReferences(transaction, entity, result);
      if (entity === "clubs" && result.active === false) {
        await this.#assertClubNotInActiveTournament(transaction, id);
      }
      const persistedChanges = {
        ...changes,
        ...(entity === "players" ? { overall: result.overall } : {}),
        ...(existing.createdAt ? {} : { createdAt: result.createdAt }),
        updatedAt: result.updatedAt,
        updatedBy,
      };
      transaction.update(reference, persistedChanges);
    });
    return { ...result };
  }

  async associateMedia(entity, idValue, media, updatedBy) {
    const fields = MEDIA_FIELDS[entity];
    if (!fields) {
      throw new CatalogStoreError("Entidade nao aceita imagem", "EDITOR_MEDIA_ENTITY_INVALID", 400);
    }
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    const reference = collection.doc(id);
    let result;
    let previousPath = null;

    await this.#runCatalogMutation(async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists) throw notFoundError(entity, id);
      const existing = snapshotRecord(current, entity);
      const timestamp = this.now().toISOString();
      previousPath = existing[fields.path] ?? null;
      const changes = {
        [fields.url]: media.url,
        [fields.path]: media.path,
        updatedAt: timestamp,
        updatedBy,
      };
      result = { ...existing, ...changes, id };
      transaction.update(reference, changes);
    });

    return { record: { ...result }, previousPath };
  }

  async clearMedia(entity, idValue, updatedBy) {
    const fields = MEDIA_FIELDS[entity];
    if (!fields) {
      throw new CatalogStoreError("Entidade nao aceita imagem", "EDITOR_MEDIA_ENTITY_INVALID", 400);
    }
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    const reference = collection.doc(id);
    let result;
    let previousPath = null;

    await this.#runCatalogMutation(async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists) throw notFoundError(entity, id);
      const existing = snapshotRecord(current, entity);
      const timestamp = this.now().toISOString();
      previousPath = existing[fields.path] ?? null;
      const changes = {
        [fields.url]: null,
        [fields.path]: null,
        updatedAt: timestamp,
        updatedBy,
      };
      result = { ...existing, ...changes, id };
      transaction.update(reference, changes);
    });

    return { record: { ...result }, previousPath };
  }

  async delete(entity, idValue) {
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    const reference = collection.doc(id);

    let previousPath = null;
    await this.#runCatalogMutation(async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists) throw notFoundError(entity, id);
      const mediaFields = MEDIA_FIELDS[entity];
      previousPath = mediaFields ? current.data()?.[mediaFields.path] ?? null : null;
      if (entity === "leagues") {
        await this.#assertNoDependents(
          transaction,
          "clubs",
          "leagueId",
          id,
          "EDITOR_LEAGUE_IN_USE",
          "Arquive a liga: ainda existem clubes vinculados a ela",
        );
      } else if (entity === "clubs") {
        await this.#assertNoDependents(
          transaction,
          "tournaments",
          "teamIds",
          id,
          "EDITOR_CLUB_IN_TOURNAMENT",
          "Remova o clube dos torneios antes de exclui-lo",
          "array-contains",
        );
        await this.#assertNoDependents(
          transaction,
          "players",
          "clubId",
          id,
          "EDITOR_CLUB_IN_USE",
          "Arquive o clube: ainda existem jogadores vinculados a ele",
        );
      }
      transaction.delete(reference);
    });
    return { deleted: true, id, previousPath };
  }

  async deleteMany(entity, idValues) {
    const collection = this.#collection(entity);
    const ids = idValues.map((value) => this.#validId(value));
    const references = ids.map((id) => collection.doc(id));
    const previousPaths = [];

    await this.#runCatalogMutation(async (transaction) => {
      const documents = typeof transaction.getAll === "function"
        ? await transaction.getAll(...references)
        : await Promise.all(references.map((reference) => transaction.get(reference)));
      for (let index = 0; index < documents.length; index += 1) {
        if (!documents[index].exists) throw notFoundError(entity, ids[index]);
      }

      // Firestore requires every read to happen before the first write.
      // Validate all dependencies first so the batch is all-or-nothing.
      for (const id of ids) {
        if (entity === "leagues") {
          await this.#assertNoDependents(
            transaction,
            "clubs",
            "leagueId",
            id,
            "EDITOR_LEAGUE_IN_USE",
            "Arquive a liga: ainda existem clubes vinculados a ela",
          );
        } else if (entity === "clubs") {
          await this.#assertNoDependents(
            transaction,
            "tournaments",
            "teamIds",
            id,
            "EDITOR_CLUB_IN_TOURNAMENT",
            "Remova o clube dos torneios antes de exclui-lo",
            "array-contains",
          );
          await this.#assertNoDependents(
            transaction,
            "players",
            "clubId",
            id,
            "EDITOR_CLUB_IN_USE",
            "Arquive o clube: ainda existem jogadores vinculados a ele",
          );
        }
      }

      const mediaFields = MEDIA_FIELDS[entity];
      documents.forEach((document, index) => {
        const previousPath = mediaFields ? document.data()?.[mediaFields.path] ?? null : null;
        if (previousPath) previousPaths.push(previousPath);
        transaction.delete(references[index]);
      });
    });

    return { deleted: true, ids, count: ids.length, previousPaths };
  }

  #assertAvailable() {
    if (!this.firestore) throw unavailableError();
  }

  async #runCatalogMutation(operation) {
    if (!this.ownerId || !this.rootFirestore) {
      return this.firestore.runTransaction(operation);
    }
    const metadataReference = catalogDatabaseDocument(this.rootFirestore, this.ownerId);
    return this.rootFirestore.runTransaction(async (transaction) => {
      const current = await transaction.get(metadataReference);
      const metadata = current.data() ?? {};
      if (metadata.importOperation || ["importing", "initializing"].includes(metadata.status)) {
        throw new CatalogStoreError(
          "A base esta em uma importacao exclusiva. Tente novamente em instantes",
          "CATALOG_DATABASE_IMPORT_IN_PROGRESS",
          409,
        );
      }
      if ((metadata.activeGenerationId ?? null) !== (this.generationId ?? null)) {
        throw new CatalogStoreError(
          "A base mudou; recarregue o Editor",
          "CATALOG_DATABASE_STALE",
          409,
        );
      }
      const result = await operation(transaction);
      const updatedAt = this.now().toISOString();
      transaction.set(metadataReference, {
        ...metadata,
        revision: Math.max(0, Number(metadata.revision) || 0) + 1,
        updatedAt,
      });
      return result;
    });
  }

  #useGeneration(generationId) {
    this.generationId = generationId ?? null;
    this.firestore = generationId
      ? createScopedCatalogFirestore(this.rootFirestore, this.ownerId, generationId)
      : this.scopeFirestore;
  }

  #collection(entity) {
    this.#assertAvailable();
    const collectionName = COLLECTIONS[entity];
    if (!collectionName) {
      throw new CatalogStoreError("Entidade do editor invalida", "EDITOR_ENTITY_INVALID", 400);
    }
    return this.firestore.collection(collectionName);
  }

  #validId(value) {
    const id = String(value ?? "").trim();
    if (!id || id.length > 128 || id.includes("/")) {
      throw new CatalogStoreError("ID de registro invalido", "EDITOR_ID_INVALID", 400);
    }
    return id;
  }

  async #assertReferences(transaction, entity, record) {
    if (entity === "tournaments") {
      const clubIds = record.teamIds ?? [];
      const references = clubIds.map((clubId) => this.#collection("clubs").doc(this.#validId(clubId)));
      const targets = references.length === 0
        ? []
        : typeof transaction.getAll === "function"
          ? await transaction.getAll(...references)
          : await Promise.all(references.map((reference) => transaction.get(reference)));
      for (let index = 0; index < targets.length; index += 1) {
        const clubId = clubIds[index];
        const target = targets[index];
        if (!target.exists) {
          throw new CatalogStoreError(
            `Referencia inexistente: clubs/${clubId}`,
            "EDITOR_REFERENCE_NOT_FOUND",
            409,
          );
        }
        if (record.active === true && target.data()?.active !== true) {
          throw new CatalogStoreError(
            `Torneio ativo referencia clube inativo: ${clubId}`,
            "EDITOR_TOURNAMENT_CLUB_INACTIVE",
            409,
            { clubId },
          );
        }
      }
      return;
    }
    let targetEntity;
    let targetId;
    if (entity === "clubs" && record.leagueId) {
      targetEntity = "leagues";
      targetId = record.leagueId;
    } else if (entity === "players" && record.clubId) {
      targetEntity = "clubs";
      targetId = record.clubId;
    } else {
      return;
    }
    const reference = this.#collection(targetEntity).doc(this.#validId(targetId));
    const target = await transaction.get(reference);
    if (!target.exists) {
      throw new CatalogStoreError(
        `Referencia inexistente: ${targetEntity}/${targetId}`,
        "EDITOR_REFERENCE_NOT_FOUND",
        409,
      );
    }
  }

  #assertRecordConsistency(entity, record) {
    if (entity !== "tournaments") return;
    const result = tournamentConsistencySchema.safeParse(record);
    if (!result.success) {
      throw new CatalogStoreError(
        "Configuracao de torneio invalida",
        "EDITOR_TOURNAMENT_INVALID",
        400,
        result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      );
    }
  }

  async #assertNoDependents(transaction, entity, field, id, code, message, operator = "==") {
    const query = this.#collection(entity).where(field, operator, id).limit(1);
    const snapshot = await transaction.get(query);
    if (!snapshot.empty) throw new CatalogStoreError(message, code, 409);
  }

  async #assertClubNotInActiveTournament(transaction, id) {
    const query = this.#collection("tournaments")
      .where("teamIds", "array-contains", id)
      .where("active", "==", true)
      .limit(1);
    const snapshot = await transaction.get(query);
    if (!snapshot.empty) {
      throw new CatalogStoreError(
        "Arquive o torneio ativo antes de arquivar este clube",
        "EDITOR_CLUB_IN_ACTIVE_TOURNAMENT",
        409,
      );
    }
  }
}
