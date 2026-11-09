import { createHash, randomUUID } from "node:crypto";
import { MAX_CATALOG_DATABASE_BYTES, CATALOG_DATABASE_ENTITIES, parseCatalogDatabase } from "../server/services/catalogDatabase.mjs";

export const CATALOG_PREVIEW_TTL_MS = 5 * 60_000;
const fail = (code) => { throw Object.assign(new Error("Importacao local indisponivel. A base anterior foi preservada."), { code }); };
export const catalogCounts = (records) => Object.fromEntries(CATALOG_DATABASE_ENTITIES.map((entity) => [entity, records[entity]?.length ?? 0]));

export async function requireCatalogImportMode(backend, peers) {
  if (peers.status().mode !== "offline") fail("LOCAL_IMPORT_PEER_ACTIVE");
  const active = await backend.database.read((state) => state.matches.some((match) => match._matchRemoved !== true));
  if (active) fail("LOCAL_IMPORT_MATCH_ACTIVE");
  if (peers.status().mode !== "offline") fail("LOCAL_IMPORT_PEER_ACTIVE");
}

export function catalogExportAddress(value) {
  if (typeof value !== "string" || value.length > 2048) fail("LOCAL_IMPORT_ORIGIN_INVALID");
  let url;
  try { url = new URL(value); } catch { fail("LOCAL_IMPORT_ORIGIN_INVALID"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") fail("LOCAL_IMPORT_ORIGIN_INVALID");
  return new URL("/desktop-export", url.origin).href;
}

export function prepareCatalogImport(bytes, { now = Date.now() } = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_CATALOG_DATABASE_BYTES) fail("LOCAL_IMPORT_SIZE_INVALID");
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("LOCAL_IMPORT_JSON_INVALID"); }
  const { records } = parseCatalogDatabase(value);
  if (!records.leagues.length || !records.clubs.length || !records.players.length) fail("LOCAL_IMPORT_EMPTY");
  // Only validated catalog records enter the database, never raw export metadata/auth.
  return { id: randomUUID(), records, bytes: bytes.byteLength, expiresAt: now + CATALOG_PREVIEW_TTL_MS,
    digest: createHash("sha256").update(JSON.stringify(records)).digest("hex") };
}

export function previewCatalogImport(candidate, existingCareers) {
  return { id: candidate.id, counts: catalogCounts(candidate.records), bytes: candidate.bytes,
    existingCareers, expiresAt: new Date(candidate.expiresAt).toISOString() };
}

// Existing careers keep their original catalog; Editor changes feed new careers.
export function preserveCareerCatalog(state) {
  const archives = state.catalogArchives ?? {};
  const archiveId = `local-catalog-${randomUUID()}`;
  let preservedCareers = 0;
  for (const room of state.rooms.rooms) {
    const owner = room.catalogOwnerId || room.ownerId;
    if (owner === state.profile.uid) {
      room.catalogOwnerId = archiveId;
      preservedCareers += 1;
    } else if (!Object.hasOwn(archives, owner)) fail("LOCAL_IMPORT_CAREER_UNKNOWN");
  }
  if (preservedCareers) archives[archiveId] = structuredClone(state.catalog);
  state.catalogArchives = archives;
  return preservedCareers;
}

export async function commitCatalogImport(database, candidate, { now = Date.now() } = {}) {
  if (!candidate || now >= candidate.expiresAt) fail("LOCAL_IMPORT_EXPIRED");
  return database.transaction((state, { backupFile }) => {
    const preservedCareers = preserveCareerCatalog(state);
    state.catalog = structuredClone(candidate.records);
    state.catalogImport = { importedAt: new Date(now).toISOString(), digest: candidate.digest, backupFile, source: "editor-json" };
    return { counts: catalogCounts(state.catalog), preservedCareers, backupFile };
  }, { backup: true });
}
