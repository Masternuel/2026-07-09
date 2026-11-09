import { createHash, randomUUID } from "node:crypto";
import { LocalCatalog } from "./localCatalog.mjs";
import { preserveCareerCatalog, catalogCounts } from "./catalogImport.mjs";
import { CatalogStoreError } from "../server/store/catalogStore.mjs";
import { editorCreateSchemas, editorPatchSchemas, editorEntitySchema, editorRecordIdSchema } from "../server/editorSchemas.mjs";
import { calculatePlayerOverall } from "../server/game/lineupStrength.mjs";
import { CATALOG_DATABASE_ENTITIES, MAX_CATALOG_DATABASE_BYTES, createCatalogDatabasePackage, parseCatalogDatabase, validateCatalogDatabaseReferences } from "../server/services/catalogDatabase.mjs";
import { withoutClientMediaPaths } from "../server/services/mediaOwnership.mjs";

export const LOCAL_MEDIA_FIELDS = Object.freeze({ clubs: ["crestImageUrl", "crestImagePath"], players: ["avatarImageUrl", "avatarImagePath"], tournaments: ["trophyImageUrl", "trophyImagePath"] });
const fail = (message, code, status = 409) => { throw new CatalogStoreError(message, code, status); };
const key = (value) => String(value).toLocaleUpperCase("pt-BR");
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const find = (state, entity, id) => {
  editorEntitySchema.parse(entity); editorRecordIdSchema.parse(id);
  const record = state.catalog[entity].find((item) => item.id === id);
  if (!record) fail("Registro nao encontrado", "EDITOR_RECORD_NOT_FOUND", 404);
  return record;
};

export class LocalEditorCatalog {
  constructor(database, ownerId, { canRead = () => false, assertEditable = () => {}, media } = {}) {
    this.database = database; this.ownerId = ownerId;
    this.canRead = canRead; this.assertEditable = assertEditable; this.media = media;
    this.backedUp = false; this.queue = Promise.resolve(); this.source = "local-disk";
  }
  forOwner(uid) {
    if (uid === this.ownerId) return this;
    // Preserve the synchronous scoped-adapter contract used by roster reads.
    // Each operation resolves the immutable archive from committed disk state.
    const read = (method, args) => this.database.read((state) => {
      const archived = Object.hasOwn(state.catalogArchives ?? {}, uid) ? state.catalogArchives[uid] : null;
      const records = archived ?? (this.canRead(uid) ? state.catalog : null);
      if (!records) fail("Catalogo local pertence a outro perfil", "ROOM_FORBIDDEN", 403);
      return new LocalCatalog(this.project(records), uid, undefined, { imported: Boolean(state.catalogImport) })[method](...args);
    });
    return Object.fromEntries(["ensureInitialized", "readInitialized", "get", "listTeams", "listCompetitionCatalog", "listActiveLeagues", "listActiveTournaments", "listPlayers", "getStarImpact"]
      .map((method) => [method, (...args) => read(method, args)]));
  }
  project(value) { return this.media ? this.media.project(value) : structuredClone(value); }
  async ensureInitialized() {}
  async readInitialized() {}
  async read(method, ...args) {
    return this.database.read((state) => new LocalCatalog(this.project(state.catalog), this.ownerId, undefined,
      { imported: Boolean(state.catalogImport) })[method](...args));
  }
  listTeams(...args) { return this.read("listTeams", ...args); }
  listCompetitionCatalog(...args) { return this.read("listCompetitionCatalog", ...args); }
  listActiveLeagues(...args) { return this.read("listActiveLeagues", ...args); }
  listActiveTournaments(...args) { return this.read("listActiveTournaments", ...args); }
  listPlayers(...args) { return this.read("listPlayers", ...args); }
  getStarImpact(...args) { return this.read("getStarImpact", ...args); }
  async get(entity, id) { return this.database.read((state) => this.project(find(state, entity, id))); }
  async list({ limit = 50 } = {}) {
    const pages = await Promise.all(CATALOG_DATABASE_ENTITIES.map((entity) => this.listPage(entity, { limit })));
    return { ...Object.fromEntries(pages.map((page) => [page.entity, page.records])), meta: Object.fromEntries(pages.map(({ records: _, ...page }) => [page.entity, page])) };
  }
  async listPage(entity, { limit = 50, cursor, query = "", clubId = "" } = {}) {
    editorEntitySchema.parse(entity);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail("Limite invalido", "EDITOR_FILTER_INVALID", 400);
    const scope = { entity, query, clubId, ownerId: this.ownerId };
    let after;
    if (cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (JSON.stringify(parsed.scope) !== JSON.stringify(scope) || typeof parsed.id !== "string") throw new Error();
        after = parsed.id;
      } catch { fail("Paginacao invalida; refaca a busca", "EDITOR_CURSOR_INVALID", 400); }
    }
    return this.database.read((state) => {
      const all = state.catalog[entity].filter((record) => (!query || key(record.name).startsWith(key(query))) && (!clubId || record.clubId === clubId))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR") || a.id.localeCompare(b.id));
      const previous = after ? all.findIndex((record) => record.id === after) : -1;
      if (after && previous < 0) fail("Paginacao desatualizada; refaca a busca", "EDITOR_CURSOR_INVALID", 400);
      const start = previous + 1; const records = all.slice(start, start + limit); const hasMore = start + limit < all.length;
      return { entity, records: this.project(records), count: all.length, returned: records.length, limit, hasMore,
        nextCursor: hasMore ? Buffer.from(JSON.stringify({ scope, id: records.at(-1).id })).toString("base64url") : null, filters: { query, clubId } };
    });
  }
  mutate(operation, { backup = false } = {}) {
    const pending = this.queue.then(() => this.database.transaction((state, context) => {
      this.assertEditable();
      if (state.matches.some((match) => match._matchRemoved !== true)) fail("Encerre a partida em andamento antes de editar a base", "LOCAL_EDITOR_MATCH_ACTIVE");
      const oldCatalog = structuredClone(state.catalog);
      const result = operation(state, context);
      // Validate complete references before publishing any local mutation.
      createCatalogDatabasePackage(state.catalog);
      validateCatalogDatabaseReferences(state.catalog);
      if (JSON.stringify(oldCatalog) !== JSON.stringify(state.catalog)) {
        const edited = state.catalog; state.catalog = oldCatalog;
        preserveCareerCatalog(state); state.catalog = edited;
      }
      state.catalogEditor = { updatedAt: new Date().toISOString(), revision: (state.catalogEditor?.revision ?? 0) + 1, backupFile: context.backupFile ?? state.catalogEditor?.backupFile };
      this.assertEditable();
      return result;
    }, { backup: backup || !this.backedUp })).then((result) => { this.backedUp = true; return this.project(result); });
    this.queue = pending.catch(() => {});
    return pending;
  }
  record(entity, input, uid, existing) {
    if (uid !== this.ownerId) fail("Acesso ao Editor nao autorizado", "EDITOR_FORBIDDEN", 403);
    const timestamp = new Date().toISOString();
    const fields = LOCAL_MEDIA_FIELDS[entity];
    const record = { ...existing, ...input, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp, updatedBy: uid };
    if (fields && !existing) record[fields[1]] = null;
    if (fields && record[fields[1]]) record[fields[0]] = this.media?.canonicalize(record[fields[0]]) ?? record[fields[0]];
    if (entity === "players") record.overall = calculatePlayerOverall(record, record.overall);
    return record;
  }
  create(entity, input, uid) {
    editorEntitySchema.parse(entity); input = editorCreateSchemas[entity].parse(withoutClientMediaPaths(input));
    return this.mutate((state) => {
      if (state.catalog[entity].some((item) => key(item.id) === key(input.id))) fail("ID ja cadastrado", "EDITOR_RECORD_EXISTS");
      const record = this.record(entity, input, uid); state.catalog[entity].push(record); return record;
    });
  }
  update(entity, id, changes, uid) {
    editorEntitySchema.parse(entity); changes = editorPatchSchemas[entity].parse(withoutClientMediaPaths(changes));
    return this.mutate((state) => {
      const existing = find(state, entity, id); const record = this.record(entity, changes, uid, existing);
      if (entity === "clubs" && record.active === false && state.catalog.tournaments.some((item) => item.active !== false && item.teamIds.includes(id))) fail("Clube participa de torneio ativo", "EDITOR_CLUB_IN_ACTIVE_TOURNAMENT");
      Object.assign(existing, record); return record;
    });
  }
  deleteMany(entity, ids) {
    editorEntitySchema.parse(entity);
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length) fail("Selecao invalida", "EDITOR_SELECTION_INVALID", 400);
    return this.mutate((state) => {
      const records = ids.map((id) => find(state, entity, id));
      for (const id of ids) {
        if (entity === "leagues" && state.catalog.clubs.some((item) => item.leagueId === id)) fail("Liga possui clubes vinculados", "EDITOR_LEAGUE_IN_USE");
        if (entity === "clubs" && state.catalog.tournaments.some((item) => item.teamIds.includes(id))) fail("Clube participa de torneio", "EDITOR_CLUB_IN_TOURNAMENT");
        if (entity === "clubs" && state.catalog.players.some((item) => item.clubId === id)) fail("Clube possui jogadores", "EDITOR_CLUB_IN_USE");
      }
      state.catalog[entity] = state.catalog[entity].filter((item) => !ids.includes(item.id));
      const pathField = LOCAL_MEDIA_FIELDS[entity]?.[1];
      const previousMedia = records.filter((item) => pathField && item[pathField]).map((item) => ({ path: item[pathField], entity, recordId: item.id }));
      return { deleted: true, ids, count: ids.length, previousPaths: previousMedia.map((item) => item.path), previousMedia };
    });
  }
  async delete(entity, id) {
    const result = await this.deleteMany(entity, [id]);
    return { deleted: true, id, previousPath: result.previousPaths[0] ?? null };
  }
  associateMedia(entity, id, media, uid) {
    return this.mutate((state) => {
      const record = find(state, entity, id); const fields = LOCAL_MEDIA_FIELDS[entity];
      const stored = state.catalogMedia?.[media.path];
      if (!fields || stored?.ownerId !== uid || stored?.entity !== entity || stored?.recordId !== id) fail("Imagem nao pertence ao registro", "EDITOR_MEDIA_OWNERSHIP_INVALID", 403);
      const previousPath = record[fields[1]] ?? null;
      Object.assign(record, this.record(entity, { [fields[0]]: this.media.canonicalize(media.url), [fields[1]]: media.path }, uid, record));
      return { record, previousPath };
    });
  }
  clearMedia(entity, id, uid) {
    return this.mutate((state) => {
      const record = find(state, entity, id); const fields = LOCAL_MEDIA_FIELDS[entity];
      if (!fields) fail("Entidade sem imagem", "EDITOR_MEDIA_ENTITY_INVALID", 400);
      const previousPath = record[fields[1]] ?? null;
      Object.assign(record, this.record(entity, { [fields[0]]: null, [fields[1]]: null }, uid, record));
      return { record, previousPath };
    });
  }
  async exportDatabase() {
    const result = await this.database.read((state) => createCatalogDatabasePackage(state.catalog));
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_CATALOG_DATABASE_BYTES) fail("Base excede 24 MB", "CATALOG_DATABASE_TOO_LARGE", 413);
    return result;
  }
  importBrasfootData({ data, runId }) {
    const records = { leagues: data.leagues, clubs: data.clubs, players: data.players, tournaments: [] };
    return this.importDatabase(createCatalogDatabasePackage(records), this.ownerId, { operationId: runId, mediaRecords: data.clubs });
  }
  importDatabase(value, uid, { operationId = randomUUID(), mediaRecords = [] } = {}) {
    const parsed = parseCatalogDatabase(value);
    if (typeof operationId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)) fail("Operacao invalida", "CATALOG_DATABASE_OPERATION_INVALID", 400);
    const checksum = digest(parsed.records);
    return this.mutate((state) => {
      const previous = state.catalogImportReceipts?.[operationId];
      if (previous) {
        if (previous.checksum !== checksum) fail("Operacao ja utilizada por outra base", "CATALOG_DATABASE_OPERATION_CONFLICT");
        return { ...previous.result, idempotent: true };
      }
      const previousMedia = [];
      for (const entity of CATALOG_DATABASE_ENTITIES) for (const incoming of parsed.records[entity]) {
        const index = state.catalog[entity].findIndex((record) => key(record.id) === key(incoming.id));
        const old = state.catalog[entity][index]; const fields = LOCAL_MEDIA_FIELDS[entity];
        const record = this.record(entity, incoming, uid, old);
        const importedMedia = entity === "clubs" ? mediaRecords.find((item) => item.id === incoming.id) : null;
        const asset = state.catalogMedia?.[importedMedia?.crestImagePath];
        if (fields && asset?.ownerId === uid && asset.entity === entity && asset.recordId === incoming.id) record[fields[1]] = importedMedia.crestImagePath;
        else if (fields && old?.[fields[1]] && old[fields[0]] === incoming[fields[0]]) record[fields[1]] = old[fields[1]];
        if (fields && old?.[fields[1]] && old[fields[1]] !== record[fields[1]]) previousMedia.push({ path: old[fields[1]], entity, recordId: old.id });
        if (index < 0) state.catalog[entity].push(record); else state.catalog[entity][index] = record;
      }
      const result = { imported: true, mode: "merge", revision: (state.catalogEditor?.revision ?? 0) + 1, counts: catalogCounts(parsed.records), total: Object.values(catalogCounts(parsed.records)).reduce((a, b) => a + b, 0), operationId, generationId: `local-${operationId}`, idempotent: false,
        previousMediaPaths: previousMedia.map((item) => item.path), previousMedia };
      state.catalogImportReceipts ??= {}; state.catalogImportReceipts[operationId] = { checksum, result };
      return result;
    }, { backup: true });
  }
}
