import { canonicalChecksum, decodeSectionValueAsync, encodeSectionValueAsync, persistenceError } from "./roomPersistenceSections.mjs";

export const MATCH_HISTORY_COLLECTION = "matchHistory";
export const MATCH_HISTORY_PATHS = ["matchHistoryPending", "matchHistoryVersion"];
const MAX_PENDING_DETAILS = 512;
const FLUSH_BATCH_SIZE = 25;
const MAX_ARCHIVE_PAGES = 16;
const DETAIL_FIELDS = ["events", "statistics", "playerStatistics", "playerEffects", "simulationVersion", "rosterMode", "rosterCoverage"];
const SUMMARY_FIELDS = ["fixtureId", "homeClubId", "awayClubId", "homeTeam", "awayTeam", "score", "completedAt", "scheduledAt", "seasonNumber", "seasonYear", "competition", "competitionId", "round", "source"];

function pick(value, fields) {
  return Object.fromEntries(fields.filter((key) => value[key] !== undefined).map((key) => [key, structuredClone(value[key])]));
}

function historyError(code, message, status = 500) {
  return persistenceError(code, message, status);
}

export function historyRecord(room, match, fixture = null) {
  if (!match || !(match.fixtureId || match.id || fixture)) return null;
  const base = {
    ...pick(fixture ?? {}, SUMMARY_FIELDS),
    ...pick(match, SUMMARY_FIELDS),
    fixtureId: fixture?.competitionFixtureId ?? fixture?.leagueFixtureId ?? match.fixtureId ?? fixture?.fixtureId ?? match.id,
    competitionId: match.competitionId ?? fixture?.competitionId ?? fixture?.tournamentId ?? fixture?.leagueId ?? null,
    seasonNumber: match.seasonNumber ?? room.currentSeason ?? 1,
    seasonYear: match.seasonYear ?? room.seasonYear ?? null,
    source: fixture ? "ai" : "manager",
    completedAt: match.completedAt ?? room.updatedAt ?? room.createdAt ?? null,
  };
  const id = canonicalChecksum([room.id ?? room.code, base.seasonNumber, base.competitionId, base.fixtureId, base.homeClubId ?? base.homeTeam, base.awayClubId ?? base.awayTeam]);
  const timestamp = Date.parse(base.scheduledAt ?? base.completedAt);
  const orderKey = `${String(base.seasonNumber).padStart(6, "0")}:${String(Number.isFinite(timestamp) ? timestamp : 0).padStart(16, "0")}:${id}`;
  return { ...base, ...pick(match, DETAIL_FIELDS), id, orderKey, detailsAvailable: Array.isArray(match.events) };
}

export function historySummary(record) {
  return pick(record, ["id", "orderKey", "detailsAvailable", ...SUMMARY_FIELDS]);
}

export function enqueueMatchHistory(room, match, fixture = null) {
  const record = historyRecord(room, match, fixture);
  if (!record) return;
  room.matchHistoryPending ??= [];
  const existing = room.matchHistoryPending.find((entry) => entry.id === record.id);
  if (existing) {
    if (!existing.detailsAvailable && record.detailsAvailable) Object.assign(existing, record);
    return;
  }
  room.matchHistoryPending.push(record);
}

export function assertMatchHistoryCapacity(room) {
  if ((room.matchHistoryPending ?? []).filter((entry) => entry.detailsAvailable).length >= MAX_PENDING_DETAILS) {
    throw historyError("MATCH_HISTORY_BACKLOG", "O arquivo de partidas esta indisponivel. Tente novamente antes de avancar os jogos", 503);
  }
}

export function initializeMatchHistory(room) {
  if (room.matchHistoryVersion === 1) return;
  if (room.matchHistoryVersion !== undefined) throw historyError("MATCH_HISTORY_VERSION_UNSUPPORTED", "Versao de historico nao suportada", 409);
  // Old summaries remain honest: discarded events cannot be reconstructed.
  for (const match of room.completedMatches ?? []) enqueueMatchHistory(room, match);
  enqueueMatchHistory(room, room.lastCompletedMatch);
  room.matchHistoryVersion = 1;
}

export function historyPageOptions(roomId, { limit = 20, cursor } = {}) {
  if (!/^[0-9]+$/.test(String(limit)) || Number(limit) < 1 || Number(limit) > 50) {
    throw historyError("MATCH_HISTORY_QUERY_INVALID", "Use um limite entre 1 e 50 partidas", 400);
  }
  let before = null;
  if (cursor !== undefined && cursor !== null) {
    try {
      if (typeof cursor !== "string" || cursor.length > 1024) throw new Error();
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (parsed.version !== 1 || parsed.roomId !== roomId || !/^\d{6}:\d{16}:[a-f0-9]{64}$/.test(parsed.before)) throw new Error();
      before = parsed.before;
    } catch {
      throw historyError("MATCH_HISTORY_CURSOR_INVALID", "Pagina de historico invalida para esta sala", 400);
    }
  }
  return { limit: Number(limit), before };
}

export function historyPage(roomId, archived, pending, { limit, before }) {
  const merged = new Map(archived.map((record) => [record.id, record]));
  for (const record of pending) {
    if ((!before || record.orderKey < before) && (!merged.has(record.id) || record.detailsAvailable)) merged.set(record.id, historySummary(record));
  }
  const records = [...merged.values()].sort((a, b) => b.orderKey.localeCompare(a.orderKey));
  const items = records.slice(0, limit);
  return {
    items,
    nextCursor: records.length > limit ? Buffer.from(JSON.stringify({ version: 1, roomId, before: items.at(-1).orderKey })).toString("base64url") : null,
    pendingArchiveCount: pending.length,
  };
}

export function assertHistoryId(id) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw historyError("MATCH_HISTORY_ID_INVALID", "Identificador de partida invalido", 400);
}

export class MemoryMatchHistory {
  #records = new Map();
  constructor(isActive = () => true) { this.isActive = isActive; }
  async put(room, record) {
    if (!this.isActive(room.code)) throw historyError("ROOM_NOT_FOUND", "Sala nao encontrada", 404);
    const key = `${room.id ?? room.code}:${record.id}`;
    const existing = this.#records.get(key);
    if (existing?.detailsAvailable) {
      if (record.detailsAvailable && canonicalChecksum(existing) !== canonicalChecksum(record)) throw historyError("MATCH_HISTORY_CONFLICT", "Detalhes da partida divergentes");
      return;
    }
    this.#records.set(key, structuredClone(record));
  }
  async list(room, { limit, before }) {
    const prefix = `${room.id ?? room.code}:`;
    return [...this.#records].filter(([key, record]) => key.startsWith(prefix) && (!before || record.orderKey < before))
      .map(([, record]) => historySummary(record)).sort((a, b) => b.orderKey.localeCompare(a.orderKey)).slice(0, limit + 1);
  }
  async get(room, id) { return structuredClone(this.#records.get(`${room.id ?? room.code}:${id}`) ?? null); }
  remove(room) {
    for (const key of this.#records.keys()) if (key.startsWith(`${room.id ?? room.code}:`)) this.#records.delete(key);
  }
}

export class FirestoreMatchHistory {
  constructor(firestore, collection) { this.firestore = firestore; this.collection = collection; }
  async put(room, record) {
    await this.putBatch(room, [record]);
  }
  async putBatch(room, records) {
    const root = this.collection.doc(room.code);
    const prepared = [];
    let batchBytes = 0;
    for (const record of records.slice(0, FLUSH_BATCH_SIZE)) {
      const encoded = await encodeSectionValueAsync("matchHistory", "career", record);
      if (encoded.pages.length > MAX_ARCHIVE_PAGES) throw historyError("MATCH_HISTORY_TOO_LARGE", "Detalhes da partida excedem o limite de arquivamento");
      const bytes = Buffer.byteLength(JSON.stringify(encoded), "utf8");
      if (prepared.length && batchBytes + bytes > 4_000_000) break;
      prepared.push({ record, encoded, recordChecksum: canonicalChecksum(record), reference: root.collection(MATCH_HISTORY_COLLECTION).doc(record.id) });
      batchBytes += bytes;
    }
    await this.firestore.runTransaction(async (transaction) => {
      const parent = await transaction.get(root);
      if (!parent.exists || parent.data().deleted || parent.data().id !== room.id) throw historyError("ROOM_NOT_FOUND", "Sala nao encontrada", 404);
      const previous = await Promise.all(prepared.map(({ reference }) => transaction.get(reference)));
      // Header + payload commit together. Deletion also touches the parent,
      // so an archive cannot reappear after a room has been tombstoned.
      for (const [index, { record, reference, encoded, recordChecksum }] of prepared.entries()) {
        const existing = previous[index].data();
        if (existing?.detailsAvailable) {
          if (record.detailsAvailable && existing.recordChecksum !== recordChecksum) throw historyError("MATCH_HISTORY_CONFLICT", "Detalhes da partida divergentes");
          continue;
        }
        transaction.set(reference, { ...historySummary(record), recordChecksum, manifestChecksum: canonicalChecksum(encoded.manifest) });
        transaction.set(reference.collection("pages").doc("manifest"), encoded.manifest);
        for (const [pageIndex, page] of encoded.pages.entries()) transaction.set(reference.collection("pages").doc(String(pageIndex)), page);
      }
    });
    return prepared.map(({ record }) => record);
  }
  async list(room, { limit, before }) {
    let query = this.collection.doc(room.code).collection(MATCH_HISTORY_COLLECTION).orderBy("orderKey", "desc");
    if (before) query = query.startAfter(before);
    const snapshots = await query.limit(limit + 1).get();
    return snapshots.docs.map((snapshot) => historySummary(snapshot.data()));
  }
  async get(room, id) {
    const reference = this.collection.doc(room.code).collection(MATCH_HISTORY_COLLECTION).doc(id);
    return this.firestore.runTransaction(async (transaction) => {
      const header = await transaction.get(reference);
      if (!header.exists) return null;
      const payload = await transaction.get(reference.collection("pages").doc("manifest"));
      const manifest = payload.data();
      if (!manifest || canonicalChecksum(manifest) !== header.data().manifestChecksum
        || !Number.isInteger(manifest.pageCount) || manifest.pageCount < 0 || manifest.pageCount > MAX_ARCHIVE_PAGES) {
        throw historyError("MATCH_HISTORY_CORRUPT", "Arquivo da partida incompleto ou corrompido");
      }
      const pages = await Promise.all(Array.from({ length: manifest.pageCount }, (_, index) => transaction.get(reference.collection("pages").doc(String(index)))));
      if (pages.some((page) => !page.exists)) throw historyError("MATCH_HISTORY_CORRUPT", "Pagina da partida ausente");
      const record = await decodeSectionValueAsync(manifest, pages.map((page) => page.data()));
      if (canonicalChecksum(record) !== header.data().recordChecksum) throw historyError("MATCH_HISTORY_CORRUPT", "Checksum da partida nao confere");
      return record;
    });
  }
}

export async function flushMatchHistory(persistence, room) {
  const pending = room.matchHistoryPending ?? [];
  if (!pending.length) return 0;
  const acknowledged = new Map();
  let failure;
  const batch = pending.slice(0, FLUSH_BATCH_SIZE);
  if (persistence.matchHistory.putBatch) {
    try {
      for (const record of await persistence.matchHistory.putBatch(room, batch)) acknowledged.set(record.id, canonicalChecksum(record));
    } catch (error) { failure = error; }
  } else {
    for (const record of batch) {
      try {
        await persistence.matchHistory.put(room, record);
        acknowledged.set(record.id, canonicalChecksum(record));
      } catch (error) { failure = error; break; }
    }
  }
  let remaining = pending.length;
  if (acknowledged.size) {
    await persistence.mutatePaths(room.code, ["matchHistoryPending"], (current) => {
      if (!current) throw historyError("ROOM_NOT_FOUND", "Sala nao encontrada", 404);
      current.matchHistoryPending = (current.matchHistoryPending ?? []).filter((record) => acknowledged.get(record.id) !== canonicalChecksum(record));
      remaining = current.matchHistoryPending.length;
      return current;
    });
  }
  if (failure) throw failure;
  return remaining;
}
