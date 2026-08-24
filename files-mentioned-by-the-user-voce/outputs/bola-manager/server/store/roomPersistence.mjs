import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  SAVE_DOCUMENT_SAFE_BYTES,
  SAVE_SCHEMA_VERSION,
  SAVE_STORAGE_FORMAT,
  assertSupportedSaveVersion,
  canonicalChecksum,
  checksum,
  contentPageId,
  decodeSectionPage,
  decodeSectionValue,
  encodeSectionValue,
  estimateSectionedDocumentBytes,
  metadataRoomFromDocument,
  persistenceError,
  rebuildRoomFromSections,
  roomMetadataDocument,
  sectionDocumentId,
  sectionPageId,
  splitRoomDomains,
  validateContentPageDocument,
  validateManifestPageReferences,
} from "./roomPersistenceSections.mjs";
import {
  PAGE_INDEX_FORMAT,
  buildPageIndex,
  iteratePageGraph,
  validatePageIndexNode,
  resolveAllPageIds,
  resolvePageGraph,
  resolvePageIdAt,
} from "./roomPersistencePageIndex.mjs";

export const ROOM_DOCUMENT_SAFE_BYTES = SAVE_DOCUMENT_SAFE_BYTES;

const ROOM_DOCUMENT_STORAGE_FORMAT = "gzip-json-v1";
const ROOM_DOCUMENT_CHUNKED_FORMAT = "gzip-json-chunks-v1";
// Kept only to decode the historical v1 format. New saves use dynamically
// paged catalog/career subcollections and do not have a fixed chunk ceiling.

function clone(value) {
  return value == null ? null : structuredClone(value);
}

export function estimateRoomDocumentBytes(room) {
  return estimateSectionedDocumentBytes(room);
}

function decodedRoomPayload(document, chunks = []) {
  if (document.roomStorageFormat === ROOM_DOCUMENT_STORAGE_FORMAT) {
    return document.roomStoragePayload;
  }
  if (document.roomStorageFormat !== ROOM_DOCUMENT_CHUNKED_FORMAT) return null;
  const expectedCount = Number(document.roomStorageChunkCount);
  const generation = String(document.roomStorageGeneration ?? "");
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || chunks.length !== expectedCount) {
    throw new Error("Quantidade de partes do payload nao confere");
  }
  const ordered = [...chunks].sort((left, right) => Number(left?.index) - Number(right?.index));
  for (let index = 0; index < ordered.length; index += 1) {
    const chunk = ordered[index];
    if (chunk?.roomCode !== document.code || chunk?.generation !== generation || chunk?.index !== index) {
      throw new Error("Parte do payload nao confere");
    }
  }
  const payload = ordered.map((chunk) => chunk.roomStorageChunkPayload).join("");
  const actualGeneration = createHash("sha256").update(payload).digest("hex").slice(0, 32);
  if (actualGeneration !== generation) throw new Error("Checksum das partes do payload nao confere");
  return payload;
}

export function roomFromDocument(document, chunks = []) {
  if (!document || document.roomStorageFormat === undefined || document.roomStorageFormat === null) {
    return clone(document);
  }
  if (![ROOM_DOCUMENT_STORAGE_FORMAT, ROOM_DOCUMENT_CHUNKED_FORMAT]
    .includes(document.roomStorageFormat)) {
    const error = new Error("Formato legado do save desconhecido");
    error.code = "ROOM_DOCUMENT_CORRUPT";
    error.status = 500;
    throw error;
  }
  try {
    const payload = decodedRoomPayload(document, chunks);
    const serialized = gunzipSync(Buffer.from(payload, "base64"))
      .toString("utf8");
    const expectedRawBytes = Number(document.roomStorageRawBytes);
    if (Number.isFinite(expectedRawBytes)
      && expectedRawBytes >= 0
      && Buffer.byteLength(serialized, "utf8") !== expectedRawBytes) {
      throw new Error("Tamanho descompactado do payload nao confere");
    }
    const room = JSON.parse(serialized);
    if (!room || room.code !== document.code) throw new Error("Codigo do payload nao confere");
    return room;
  } catch (cause) {
    const error = new Error("Save comprimido corrompido");
    error.code = "ROOM_DOCUMENT_CORRUPT";
    error.status = 500;
    error.cause = cause;
    throw error;
  }
}

function legacyChunkDescriptor(document) {
  if (document?.roomStorageFormat !== ROOM_DOCUMENT_CHUNKED_FORMAT) return null;
  const count = Number(document.roomStorageChunkCount);
  const generation = String(document.roomStorageGeneration ?? "");
  if (!Number.isInteger(count) || count < 1 || !generation) {
    const error = new Error("Manifesto do save comprimido corrompido");
    error.code = "ROOM_DOCUMENT_CORRUPT";
    error.status = 500;
    throw error;
  }
  return { code: document.code, generation, count };
}

function chunkReferences(collection, document) {
  const descriptor = legacyChunkDescriptor(document);
  if (!descriptor) return [];
  return Array.from({ length: descriptor.count }, (_, index) => collection.doc(
    `${descriptor.code}--${descriptor.generation}--${String(index).padStart(3, "0")}`,
  ));
}

async function roomFromStoredDocument(document, chunkLoader) {
  const references = chunkReferences(chunkLoader.collection, document);
  if (references.length === 0) return roomFromDocument(document);
  const snapshots = await Promise.all(references.map((reference) => chunkLoader.get(reference)));
  if (snapshots.some((snapshot) => !snapshot.exists)) {
    const error = new Error("Save comprimido incompleto");
    error.code = "ROOM_DOCUMENT_CORRUPT";
    error.status = 500;
    throw error;
  }
  return roomFromDocument(document, snapshots.map((snapshot) => snapshot.data()));
}

function isDeletedRoom(value) {
  return Boolean(value?.deleted === true);
}

function deletedRoom(code) {
  return { code, deleted: true };
}

function deletedRoomAuthorizationMetadata(document) {
  return {
    code: document?.code,
    ownerId: document?.ownerId ?? document?.deletedOwnerId,
    managerIds: Array.isArray(document?.managerIds)
      ? [...document.managerIds]
      : Array.isArray(document?.storageCleanupRecipients)
        ? [...document.storageCleanupRecipients]
        : [],
  };
}

function reservedCodeError(code) {
  const error = new Error(`Codigo de sala reservado: ${code}`);
  error.code = "ROOM_CODE_RESERVED";
  return error;
}

function deleteObjectPath(target, path) {
  const segments = String(path ?? "").split(".").filter(Boolean);
  if (!target || segments.length === 0) return;
  const parent = segments.slice(0, -1).reduce((value, segment) => value?.[segment], target);
  if (parent && typeof parent === "object") delete parent[segments.at(-1)];
}

function pathExcluded(path, excludedPaths) {
  return excludedPaths.some((excludedPath) => (
    path === excludedPath || path.startsWith(`${excludedPath}.`)
  ));
}

function withMetadataCounts(room, metadata) {
  const summary = metadataRoomFromDocument(metadata);
  if (!summary) return room;
  return {
    ...room,
    completedFixtureCount: summary.completedFixtureCount,
    completedMatchCount: summary.completedMatchCount,
    seasonHistoryCount: summary.seasonHistoryCount,
  };
}

const DERIVED_COUNT_PATHS = new Map([
  ["completedFixtureCount", "completedFixtureIds"],
  ["completedMatchCount", "completedMatches"],
  ["seasonHistoryCount", "seasonHistory"],
]);

function normalizedMutationPaths(paths) {
  return new Set((paths ?? [])
    .map((path) => String(path ?? "").trim())
    .filter(Boolean));
}

function roomWithoutDerivedCounts(room) {
  const next = clone(room);
  for (const field of DERIVED_COUNT_PATHS.keys()) delete next?.[field];
  return next;
}

function partialRoomSplit(room, requestedPaths, previousDocument = null) {
  const split = splitRoomDomains(roomWithoutDerivedCounts(room));
  const sections = split.sections.filter((section) => requestedPaths.has(section.path));
  const sectionByPath = new Map(sections.map((section) => [section.path, section]));
  const metadata = { ...split.metadata };
  for (const [countField, sectionPath] of DERIVED_COUNT_PATHS) {
    if (requestedPaths.has(sectionPath)) {
      const value = sectionByPath.get(sectionPath)?.value;
      metadata[countField] = Array.isArray(value) ? value.length : 0;
    } else {
      metadata[countField] = Number(previousDocument?.[countField] ?? 0);
    }
  }
  return { ...split, metadata, sections };
}

export class MemoryRoomPersistence {
  #rooms = new Map();
  #deletedCodes = new Set();

  constructor(initialRooms = []) {
    for (const room of initialRooms) {
      if (isDeletedRoom(room)) this.#deletedCodes.add(room.code);
      else this.#rooms.set(room.code, clone(room));
    }
  }

  async create(room) {
    if (this.#rooms.has(room.code) || this.#deletedCodes.has(room.code)) return false;
    this.#rooms.set(room.code, clone(room));
    return true;
  }

  async get(code) {
    return clone(this.#rooms.get(code));
  }

  async getPartial(code, { excludePaths = [] } = {}) {
    const source = this.#rooms.get(code);
    const room = clone(source);
    if (!room) return null;
    for (const path of excludePaths) deleteObjectPath(room, path);
    return withMetadataCounts(room, roomMetadataDocument(source));
  }

  async getPaths(code, paths = []) {
    const room = clone(this.#rooms.get(code));
    if (!room) return null;
    const requested = new Set(paths.map((path) => String(path ?? "").trim()).filter(Boolean));
    const split = splitRoomDomains(room);
    return withMetadataCounts(rebuildRoomFromSections(
      split.metadata,
      [],
      split.sections.filter((section) => requested.has(section.path)),
    ), split.metadata);
  }

  async getSectionTail(code, path) {
    const room = this.#rooms.get(code);
    if (!room) return null;
    const section = splitRoomDomains(room).sections.find((candidate) => candidate.path === path);
    if (!section || !Array.isArray(section.value)) return null;
    return clone(section.value.at(-1) ?? null);
  }

  async save(room) {
    if (this.#deletedCodes.has(room.code)) throw reservedCodeError(room.code);
    this.#rooms.set(room.code, clone(room));
  }

  async mutate(code, mutation) {
    const reserved = this.#deletedCodes.has(code);
    const current = reserved ? null : clone(this.#rooms.get(code));
    const next = mutation(current);
    if (next === undefined) return current;
    if (reserved) throw reservedCodeError(code);
    this.#rooms.set(code, clone(next));
    return clone(next);
  }

  async mutatePaths(code, _paths, mutation) {
    return this.mutate(code, mutation);
  }

  async remove(code, authorize) {
    const current = clone(this.#rooms.get(code));
    authorize(current);
    this.#rooms.delete(code);
    this.#deletedCodes.add(code);
    return clone(current);
  }

  async listByManager(managerId) {
    return [...this.#rooms.values()]
      .filter((room) => room.managerIds.includes(managerId))
      .map(clone);
  }

  async listMetadataByManager(managerId) {
    return [...this.#rooms.values()]
      .filter((room) => room.managerIds.includes(managerId))
      .map((room) => metadataRoomFromDocument(roomMetadataDocument(room)));
  }

  async getMetadata(code) {
    const room = this.#rooms.get(code);
    return room ? metadataRoomFromDocument(roomMetadataDocument(room)) : null;
  }

  async getDeletionMetadata(code) {
    return this.getMetadata(code);
  }

  async getSection(code, path, { page = null } = {}) {
    const room = this.#rooms.get(code);
    if (!room) return null;
    const section = splitRoomDomains(room).sections.find((candidate) => candidate.path === path);
    if (!section) return null;
    if (page === null) return clone(section.value);
    const encoded = encodeSectionValue(section.path, section.domain, section.value);
    if (encoded.manifest.format !== "json-array-pages-v2") {
      throw persistenceError("SAVE_SECTION_NOT_PAGEABLE", "Esta secao nao possui paginas independentes", 409);
    }
    const index = Number(page);
    const selected = encoded.pages[index];
    if (!selected) return { items: [], page: index, pageCount: encoded.pages.length, hasMore: false };
    return {
      items: decodeSectionPage(encoded.manifest, selected),
      page: index,
      pageCount: encoded.pages.length,
      hasMore: index + 1 < encoded.pages.length,
    };
  }
}

const SECTION_WRITE_BATCH_SIZE = 350;
const SECTION_READ_BATCH_SIZE = 200;
const MUTATION_MAX_ATTEMPTS = 5;
const SECTION_CONTENT_PAGES_COLLECTION = "sectionPages";
const SECTION_PAGE_INDEX_COLLECTION = "sectionPageIndexes";
const DOMAIN_PAGE_STORAGE_FORMAT = "domain-content-addressed-v1";
const DOMAIN_CONTENT_PAGE_PREFIX = "page--";
const DOMAIN_PAGE_INDEX_PREFIX = "page-index--";
const SAVE_MAINTENANCE_LEASE_MS = 10 * 60_000;
const STORAGE_SCAN_PAGE_SIZE = 200;
const STORAGE_MAINTENANCE_COLLECTION = "maintenance";
const STORAGE_WRITER_STATE_DOCUMENT = "storage-writers";
const STORAGE_WRITER_LEASE_PREFIX = "storage-writer--";
const STORAGE_GC_MARK_PREFIX = "gc-mark--";
const STORAGE_GC_SWEEP_BATCH_SIZE = 100;
const STORAGE_GC_HEARTBEAT_MS = Math.floor(SAVE_MAINTENANCE_LEASE_MS / 3);

function isV2Document(document) {
  return Number(document?.saveSchemaVersion) === SAVE_SCHEMA_VERSION
    && document?.saveStorageFormat === SAVE_STORAGE_FORMAT;
}

function assertV2DocumentIntegrity(document) {
  assertSupportedSaveVersion(document);
  if (Number(document?.saveSchemaVersion) === SAVE_SCHEMA_VERSION && !isV2Document(document)) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Save v2 possui formato invalido");
  }
  if (!isV2Document(document)) return;
  const { saveCommitId, ...base } = document;
  // Canonical hashing avoids depending on Firestore field ordering. Accept the
  // first v2 writer's insertion-order hash so already-created saves stay valid.
  if (!saveCommitId
    || (canonicalChecksum(base) !== saveCommitId && checksum(base) !== saveCommitId)) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Checksum dos metadados do save nao confere");
  }
}

function storageToken(document) {
  if (!document) return null;
  if (isV2Document(document)) return String(document.saveCommitId ?? "");
  return checksum(document);
}

function sectionDescriptors(document, field = "roomSections") {
  const descriptors = document?.[field];
  if (descriptors === undefined && field === "previousRoomSections") return [];
  if (!Array.isArray(descriptors)) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Manifesto de secoes do save corrompido");
  }
  const paths = new Set();
  return descriptors.map((descriptor) => {
    if (!descriptor?.path
      || !["catalog", "career"].includes(descriptor.domain)
      || !descriptor.documentId
      || !descriptor.checksum
      || (descriptor.manifestChecksum !== undefined
        && !/^[a-f0-9]{64}$/i.test(String(descriptor.manifestChecksum)))
      || paths.has(descriptor.path)) {
      throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Descritor de secao do save corrompido");
    }
    paths.add(descriptor.path);
    return descriptor;
  });
}

function rootDocumentForV2(room, split, descriptors, previousDescriptors = [], migration = undefined) {
  const base = {
    ...split.metadata,
    saveSchemaVersion: SAVE_SCHEMA_VERSION,
    saveStorageFormat: SAVE_STORAGE_FORMAT,
    roomContainers: split.containers,
    roomSections: descriptors,
    previousRoomSections: previousDescriptors,
    ...(migration ? { saveMigration: migration } : {}),
  };
  const saveCommitId = canonicalChecksum(base);
  const document = { ...base, saveCommitId };
  const bytes = Buffer.byteLength(JSON.stringify(document), "utf8");
  if (bytes > ROOM_DOCUMENT_SAFE_BYTES) {
    throw persistenceError(
      "SAVE_METADATA_TOO_LARGE",
      "Os metadados do save excederam o limite seguro",
      409,
      { estimatedBytes: bytes },
    );
  }
  return document;
}

function documentWithMaintenanceLease(document, lease = null) {
  const { saveCommitId: _previousCommit, saveMaintenanceLease: _previousLease, ...base } = document;
  const nextBase = lease ? { ...base, saveMaintenanceLease: lease } : base;
  return { ...nextBase, saveCommitId: canonicalChecksum(nextBase) };
}

function activeMaintenanceLease(document, now = Date.now()) {
  const lease = document?.saveMaintenanceLease;
  if (!lease?.id || !Number.isFinite(Date.parse(lease.expiresAt))) return null;
  return Date.parse(lease.expiresAt) > now ? lease : null;
}

function assertMaintenanceAvailable(document) {
  if (activeMaintenanceLease(document)) {
    throw persistenceError(
      "SAVE_MAINTENANCE_BUSY",
      "O save esta passando por manutencao de armazenamento",
      409,
    );
  }
}

function storageWriterStateReference(rootReference) {
  return rootReference.collection(STORAGE_MAINTENANCE_COLLECTION).doc(STORAGE_WRITER_STATE_DOCUMENT);
}

function storageWriterLeaseReference(rootReference, leaseId) {
  return rootReference.collection(STORAGE_MAINTENANCE_COLLECTION)
    .doc(`${STORAGE_WRITER_LEASE_PREFIX}${leaseId}`);
}

function activeStorageWriterState(state, now = Date.now()) {
  const count = Number(state?.activeLeaseCount ?? 0);
  const expiresAt = Date.parse(state?.activeUntil);
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(expiresAt) || expiresAt <= now) {
    return null;
  }
  return { count, expiresAt };
}

function assertStorageWritersAvailable(state) {
  if (activeStorageWriterState(state)) {
    throw persistenceError(
      "SAVE_MAINTENANCE_BUSY",
      "O save possui uma gravacao de armazenamento em andamento",
      409,
    );
  }
}

function storageWriterStateAfterAcquire(state, expiresAt) {
  const active = activeStorageWriterState(state);
  return {
    activeLeaseCount: (active?.count ?? 0) + 1,
    activeUntil: new Date(Math.max(active?.expiresAt ?? 0, Date.parse(expiresAt))).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function releaseStorageWriterInTransaction(
  transaction,
  stateReference,
  leaseReference,
  stateSnapshot,
  leaseSnapshot,
  leaseId,
  { required = false } = {},
) {
  const lease = leaseSnapshot.exists ? leaseSnapshot.data() : null;
  if (lease?.id !== leaseId) {
    if (required) {
      throw persistenceError("SAVE_WRITE_CONFLICT", "Lease de gravacao do save foi perdido", 409);
    }
    return false;
  }
  const state = stateSnapshot.exists ? stateSnapshot.data() : null;
  const count = Number(state?.activeLeaseCount ?? 0);
  if (Number.isInteger(count) && count > 1) {
    transaction.set(stateReference, {
      ...state,
      activeLeaseCount: count - 1,
      updatedAt: new Date().toISOString(),
    });
  } else {
    transaction.delete(stateReference);
  }
  transaction.delete(leaseReference);
  return true;
}

async function acquireStorageWriterLease(
  firestore,
  rootReference,
  { expectedToken, operation, requireMissing = false },
) {
  const leaseId = createHash("sha256")
    .update(`${rootReference.path}:${operation}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 32);
  const stateReference = storageWriterStateReference(rootReference);
  const leaseReference = storageWriterLeaseReference(rootReference, leaseId);
  const expiresAt = new Date(Date.now() + SAVE_MAINTENANCE_LEASE_MS).toISOString();
  let acquired = false;
  try {
    await firestore.runTransaction(async (transaction) => {
      const [rootSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(rootReference),
        transaction.get(stateReference),
      ]);
      const current = rootSnapshot.exists ? rootSnapshot.data() : null;
      if (requireMissing && current) return;
      if (isDeletedRoom(current)) throw reservedCodeError(current?.code ?? rootReference.id);
      if (!requireMissing && storageToken(current) !== expectedToken) {
        throw persistenceError("SAVE_WRITE_CONFLICT", "O save foi alterado simultaneamente", 409);
      }
      if (current) {
        assertV2DocumentIntegrity(current);
        assertMaintenanceAvailable(current);
      }
      const state = stateSnapshot.exists ? stateSnapshot.data() : null;
      transaction.set(stateReference, storageWriterStateAfterAcquire(state, expiresAt));
      transaction.create(leaseReference, {
        id: leaseId,
        operation,
        expectedToken: expectedToken ?? null,
        acquiredAt: new Date().toISOString(),
        expiresAt,
      });
      acquired = true;
    });
  } catch (error) {
    // A lease transaction can commit while its ACK is lost. The unique lease
    // document is authoritative; continuing keeps its acquired protection.
    const leaseSnapshot = await leaseReference.get().catch(() => null);
    if (leaseSnapshot?.exists && leaseSnapshot.data()?.id === leaseId) acquired = true;
    else throw error;
  }
  return acquired ? { id: leaseId, stateReference, leaseReference } : null;
}

async function renewStorageWriterLease(firestore, lease) {
  if (!lease) return;
  const now = Date.now();
  const expiresAt = new Date(now + SAVE_MAINTENANCE_LEASE_MS).toISOString();
  await firestore.runTransaction(async (transaction) => {
    const [stateSnapshot, leaseSnapshot] = await Promise.all([
      transaction.get(lease.stateReference),
      transaction.get(lease.leaseReference),
    ]);
    const currentLease = leaseSnapshot.exists ? leaseSnapshot.data() : null;
    const currentLeaseExpiresAt = Date.parse(currentLease?.expiresAt);
    const state = stateSnapshot.exists ? stateSnapshot.data() : null;
    const active = activeStorageWriterState(state, now);
    if (currentLease?.id !== lease.id
      || !Number.isFinite(currentLeaseExpiresAt)
      || currentLeaseExpiresAt <= now
      || !active) {
      throw persistenceError("SAVE_WRITE_CONFLICT", "Lease de gravacao do save foi perdido", 409);
    }
    transaction.set(lease.stateReference, {
      activeLeaseCount: active.count,
      activeUntil: new Date(Math.max(active.expiresAt, Date.parse(expiresAt))).toISOString(),
      updatedAt: new Date().toISOString(),
    });
    transaction.set(lease.leaseReference, { ...currentLease, expiresAt, renewedAt: new Date().toISOString() });
  });
}

async function releaseStorageWriterLease(firestore, lease) {
  if (!lease) return;
  await firestore.runTransaction(async (transaction) => {
    const [stateSnapshot, leaseSnapshot] = await Promise.all([
      transaction.get(lease.stateReference),
      transaction.get(lease.leaseReference),
    ]);
    releaseStorageWriterInTransaction(
      transaction,
      lease.stateReference,
      lease.leaseReference,
      stateSnapshot,
      leaseSnapshot,
      lease.id,
    );
  });
}

function sectionReference(rootReference, descriptor) {
  return rootReference.collection(descriptor.domain).doc(descriptor.documentId);
}

function manifestPageStorage(manifest) {
  if (manifest?.pageStorageFormat === undefined) return null;
  if (manifest.pageStorageFormat !== DOMAIN_PAGE_STORAGE_FORMAT
    || !["catalog", "career"].includes(manifest.domain)) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Localizacao das paginas da secao invalida");
  }
  return manifest.domain;
}

function contentPageReference(rootReference, pageId, manifest = null) {
  const domain = manifestPageStorage(manifest);
  return domain
    ? rootReference.collection(domain).doc(`${DOMAIN_CONTENT_PAGE_PREFIX}${pageId}`)
    : rootReference.collection(SECTION_CONTENT_PAGES_COLLECTION).doc(pageId);
}

function pageIndexReference(rootReference, nodeId, manifest = null) {
  const domain = manifestPageStorage(manifest);
  return domain
    ? rootReference.collection(domain).doc(`${DOMAIN_PAGE_INDEX_PREFIX}${nodeId}`)
    : rootReference.collection(SECTION_PAGE_INDEX_COLLECTION).doc(nodeId);
}

async function readReferences(firestore, references, onProgress = null) {
  const snapshots = [];
  for (let offset = 0; offset < references.length; offset += SECTION_READ_BATCH_SIZE) {
    const batch = references.slice(offset, offset + SECTION_READ_BATCH_SIZE);
    const result = typeof firestore.getAll === "function"
      ? await firestore.getAll(...batch)
      : await Promise.all(batch.map((reference) => reference.get()));
    snapshots.push(...result);
    if (onProgress) await onProgress();
  }
  return snapshots;
}

async function applyWrites(firestore, writes, onProgress = null) {
  for (let offset = 0; offset < writes.length; offset += SECTION_WRITE_BATCH_SIZE) {
    const operations = writes.slice(offset, offset + SECTION_WRITE_BATCH_SIZE);
    if (typeof firestore.batch === "function") {
      const batch = firestore.batch();
      for (const operation of operations) {
        if (operation.type === "delete") batch.delete(operation.reference);
        else batch.set(operation.reference, operation.data);
      }
      await batch.commit();
    } else {
      await Promise.all(operations.map((operation) => (
        operation.type === "delete"
          ? operation.reference.delete()
          : operation.reference.set(operation.data)
      )));
    }
    if (onProgress) await onProgress();
  }
}

async function existingContentPageIds(firestore, rootReference, pages, manifest, onProgress = null) {
  if (pages.length === 0) return { valid: new Set(), existing: new Set() };
  const references = pages.map((page) => (
    contentPageReference(rootReference, contentPageId(page), manifest)
  ));
  const snapshots = await readReferences(firestore, references, onProgress);
  const valid = new Set();
  const existing = new Set();
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    const pageId = contentPageId(pages[index]);
    existing.add(pageId);
    const expected = { ...pages[index] };
    delete expected.index;
    try {
      validateContentPageDocument(pageId, snapshot.data());
      if (canonicalChecksum(snapshot.data()) === canonicalChecksum(expected)) {
        valid.add(pageId);
      }
    } catch {
      // A deterministic rewrite repairs a corrupted blob without changing its
      // identity; any generation referencing this ID expects exactly this data.
    }
  });
  return { valid, existing };
}

async function existingPageIndexNodeIds(firestore, rootReference, nodes, manifest, onProgress = null) {
  if (nodes.length === 0) return { valid: new Set(), existing: new Set() };
  const references = nodes.map(({ id }) => pageIndexReference(rootReference, id, manifest));
  const snapshots = await readReferences(firestore, references, onProgress);
  const valid = new Set();
  const existing = new Set();
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    existing.add(nodes[index].id);
    try {
      validatePageIndexNode(snapshot.data(), { id: nodes[index].id });
      valid.add(nodes[index].id);
    } catch {
      // Content-addressed index nodes are safe to restore in place.
    }
  });
  return { valid, existing };
}

function manifestPageIndexDescriptor(manifest) {
  const hasIndex = manifest?.pageIndexRootId !== undefined
    || manifest?.pageIndexDepth !== undefined
    || manifest?.pageIndexFormat !== undefined;
  if (!hasIndex) return null;
  if (manifest.pageIndexFormat !== PAGE_INDEX_FORMAT || Array.isArray(manifest.pageDocumentIds)) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Indice de paginas da secao corrompido");
  }
  return {
    rootId: manifest.pageIndexRootId,
    depth: manifest.pageIndexDepth,
    pageCount: Number(manifest.pageCount ?? 0),
  };
}

async function contentPageIdsForManifest(firestore, rootReference, manifest, onProgress = null) {
  const indexDescriptor = manifestPageIndexDescriptor(manifest);
  if (indexDescriptor) {
    const loadOne = async (nodeId) => {
      const snapshot = await pageIndexReference(rootReference, nodeId, manifest).get();
      if (onProgress) await onProgress();
      return snapshot.exists ? snapshot.data() : null;
    };
    const loadMany = async (nodeIds) => {
      const snapshots = await readReferences(
        firestore,
        nodeIds.map((nodeId) => pageIndexReference(rootReference, nodeId, manifest)),
        onProgress,
      );
      return snapshots.map((snapshot) => snapshot.exists ? snapshot.data() : null);
    };
    return resolveAllPageIds(indexDescriptor, loadOne, loadMany);
  }
  return validateManifestPageReferences(manifest);
}

async function pageGraphForManifest(firestore, rootReference, manifest) {
  const indexDescriptor = manifestPageIndexDescriptor(manifest);
  if (!indexDescriptor) {
    return {
      pageIds: validateManifestPageReferences(manifest) ?? [],
      nodeIds: [],
    };
  }
  const loadOne = async (nodeId) => {
    const snapshot = await pageIndexReference(rootReference, nodeId, manifest).get();
    return snapshot.exists ? snapshot.data() : null;
  };
  const loadMany = async (nodeIds) => {
    const snapshots = await readReferences(
      firestore,
      nodeIds.map((nodeId) => pageIndexReference(rootReference, nodeId, manifest)),
    );
    return snapshots.map((snapshot) => snapshot.exists ? snapshot.data() : null);
  };
  return resolvePageGraph(indexDescriptor, loadOne, loadMany);
}

async function contentPageIdForManifestAt(rootReference, manifest, index) {
  const indexDescriptor = manifestPageIndexDescriptor(manifest);
  if (indexDescriptor) {
    return resolvePageIdAt(indexDescriptor, index, async (nodeId) => {
      const snapshot = await pageIndexReference(rootReference, nodeId, manifest).get();
      return snapshot.exists ? snapshot.data() : null;
    });
  }
  return validateManifestPageReferences(manifest)?.[index] ?? null;
}

async function pageGraphForManifestInTransaction(transaction, rootReference, manifest) {
  const indexDescriptor = manifestPageIndexDescriptor(manifest);
  if (!indexDescriptor) {
    return {
      pageIds: validateManifestPageReferences(manifest) ?? [],
      nodeIds: [],
    };
  }
  const loadOne = async (nodeId) => {
    const snapshot = await transaction.get(pageIndexReference(rootReference, nodeId, manifest));
    return snapshot.exists ? snapshot.data() : null;
  };
  const loadMany = async (nodeIds) => {
    const references = nodeIds.map((nodeId) => pageIndexReference(rootReference, nodeId, manifest));
    const snapshots = typeof transaction.getAll === "function"
      ? await transaction.getAll(...references)
      : await Promise.all(references.map((reference) => transaction.get(reference)));
    return snapshots.map((snapshot) => snapshot.exists ? snapshot.data() : null);
  };
  return resolvePageGraph(indexDescriptor, loadOne, loadMany);
}

async function protectedBlobPathsInTransaction(transaction, rootReference, domains) {
  const protectedPaths = new Set();
  for (const domain of domains) {
    const query = rootReference.collection(domain)
      .where("saveSchemaVersion", "==", SAVE_SCHEMA_VERSION);
    const manifestSnapshots = await transaction.get(query);
    for (const snapshot of manifestSnapshots.docs) {
      const manifest = snapshot.data();
      if (manifestPageStorage(manifest) !== domain || manifest.domain !== domain) {
        throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Manifesto de armazenamento em dominio invalido");
      }
      const graph = await pageGraphForManifestInTransaction(
        transaction,
        rootReference,
        manifest,
      );
      for (const pageId of graph.pageIds) {
        protectedPaths.add(contentPageReference(rootReference, pageId, manifest).path);
      }
      for (const nodeId of graph.nodeIds) {
        protectedPaths.add(pageIndexReference(rootReference, nodeId, manifest).path);
      }
    }
  }
  return protectedPaths;
}

/**
 * Removes only blobs that were absent before this staging attempt. Every
 * manifest is read in the same transaction that performs deletion, so a
 * concurrent staged/published generation either protects its shared blobs or
 * conflicts and makes Firestore retry against the newer manifest set.
 */
async function cleanupFailedStageBlobs(firestore, rootReference, references) {
  const unique = new Map((references ?? []).map((reference) => [reference.path, reference]));
  const candidates = [...unique.values()];
  for (let offset = 0; offset < candidates.length; offset += SECTION_WRITE_BATCH_SIZE) {
    const group = candidates.slice(offset, offset + SECTION_WRITE_BATCH_SIZE);
    const domains = new Set(group.map((reference) => {
      const relative = reference.path.slice(rootReference.path.length + 1);
      return relative.split("/")[0];
    }));
    await firestore.runTransaction(async (transaction) => {
      const protectedPaths = await protectedBlobPathsInTransaction(
        transaction,
        rootReference,
        domains,
      );
      for (const reference of group) {
        if (!protectedPaths.has(reference.path)) transaction.delete(reference);
      }
    });
  }
}

async function stageSection(firestore, rootReference, section, generation, writerLease = null) {
  const renewLease = writerLease
    ? () => renewStorageWriterLease(firestore, writerLease)
    : null;
  if (renewLease) await renewLease();
  const encoded = encodeSectionValue(section.path, section.domain, section.value);
  const pageIndex = buildPageIndex(encoded.pages.map(contentPageId));
  const documentId = sectionDocumentId(section.path, generation);
  const manifest = {
    ...encoded.manifest,
    ...(pageIndex.pageCount > 0 ? { pageStorageFormat: DOMAIN_PAGE_STORAGE_FORMAT } : {}),
    ...(pageIndex.pageCount > 0 ? {
      pageIndexFormat: PAGE_INDEX_FORMAT,
      pageIndexRootId: pageIndex.rootId,
      pageIndexDepth: pageIndex.depth,
    } : {}),
    generation,
    saveSchemaVersion: SAVE_SCHEMA_VERSION,
  };
  const descriptor = {
    path: section.path,
    domain: section.domain,
    documentId,
    checksum: encoded.manifest.checksum,
    format: encoded.manifest.format,
    pageCount: encoded.manifest.pageCount,
    rawBytes: encoded.manifest.rawBytes,
    manifestChecksum: canonicalChecksum(manifest),
  };
  const reference = sectionReference(rootReference, descriptor);
  const existingPageState = await existingContentPageIds(
    firestore,
    rootReference,
    encoded.pages,
    manifest,
    renewLease,
  );
  const pageWritesById = new Map();
  for (const page of encoded.pages) {
    const pageId = contentPageId(page);
    if (existingPageState.valid.has(pageId) || pageWritesById.has(pageId)) continue;
    const { index: _pagePosition, ...content } = page;
    pageWritesById.set(pageId, {
      type: "set",
      reference: contentPageReference(rootReference, pageId, manifest),
      data: content,
    });
  }
  const existingIndexState = await existingPageIndexNodeIds(
    firestore,
    rootReference,
    pageIndex.nodes,
    manifest,
    renewLease,
  );
  const indexWrites = pageIndex.nodes
    .filter(({ id }) => !existingIndexState.valid.has(id))
    .map(({ id, node }) => ({
      type: "set",
      reference: pageIndexReference(rootReference, id, manifest),
      data: node,
    }));
  try {
    await applyWrites(firestore, [...pageWritesById.values(), ...indexWrites], renewLease);
    if (renewLease) await renewLease();
    await reference.set(manifest);
  } catch (error) {
    await cleanupDescriptors(firestore, rootReference, [descriptor]).catch(() => {});
    const newlyCreatedBlobReferences = [
      ...[...pageWritesById.entries()]
        .filter(([id]) => !existingPageState.existing.has(id))
        .map(([, write]) => write.reference),
      ...indexWrites
        .filter((write) => !existingIndexState.existing.has(write.reference.id.replace(
          DOMAIN_PAGE_INDEX_PREFIX,
          "",
        )))
        .map((write) => write.reference),
    ];
    await cleanupFailedStageBlobs(
      firestore,
      rootReference,
      newlyCreatedBlobReferences,
    ).catch(() => {});
    throw error;
  }
  return descriptor;
}

async function loadSectionManifest(rootReference, descriptor) {
  const reference = sectionReference(rootReference, descriptor);
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    throw persistenceError("SAVE_INCOMPLETE", `Save incompleto: secao ${descriptor.path} ausente`);
  }
  const manifest = snapshot.data();
  manifestPageStorage(manifest);
  if (descriptor.manifestChecksum
    && canonicalChecksum(manifest) !== String(descriptor.manifestChecksum).toLocaleLowerCase("en-US")) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", `Checksum do manifesto ${descriptor.path} nao confere`);
  }
  if (manifest.path !== descriptor.path
    || manifest.domain !== descriptor.domain
    || manifest.checksum !== descriptor.checksum) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", `Manifesto da secao ${descriptor.path} nao confere`);
  }
  const pageCount = Number(manifest.pageCount ?? 0);
  if (!Number.isInteger(pageCount) || pageCount < 0) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", `Paginas da secao ${descriptor.path} invalidas`);
  }
  return { manifest, reference, pageCount };
}

async function loadSection(firestore, rootReference, descriptor, onProgress = null) {
  const { manifest, reference, pageCount } = await loadSectionManifest(rootReference, descriptor);
  if (onProgress) await onProgress();
  const contentPageIds = await contentPageIdsForManifest(
    firestore,
    rootReference,
    manifest,
    onProgress,
  );
  const pageReferences = contentPageIds
    ? contentPageIds.map((pageId) => contentPageReference(rootReference, pageId, manifest))
    : Array.from({ length: pageCount }, (_, index) => (
      reference.collection("pages").doc(sectionPageId(index))
    ));
  const pageSnapshots = await readReferences(firestore, pageReferences, onProgress);
  if (pageSnapshots.some((pageSnapshot) => !pageSnapshot.exists)) {
    throw persistenceError("SAVE_INCOMPLETE", `Save incompleto: pagina da secao ${descriptor.path} ausente`);
  }
  const pages = pageSnapshots.map((pageSnapshot, index) => ({
    ...(contentPageIds
      ? validateContentPageDocument(contentPageIds[index], pageSnapshot.data())
      : pageSnapshot.data()),
    ...(contentPageIds ? { index } : {}),
  }));
  return { path: descriptor.path, value: decodeSectionValue(manifest, pages), manifest, reference };
}

async function cleanupDescriptors(firestore, rootReference, descriptors) {
  const unique = new Map((descriptors ?? []).map((descriptor) => [
    `${descriptor.domain}/${descriptor.documentId}`,
    descriptor,
  ]));
  const writes = [];
  for (const descriptor of unique.values()) {
    const reference = sectionReference(rootReference, descriptor);
    const snapshot = await reference.get().catch(() => null);
    const manifest = snapshot?.exists ? snapshot.data() : null;
    // Early v2 saves kept pages below each manifest. Content-addressed pages
    // live in a shared collection and must never be removed with a generation.
    if (manifest
      && !Array.isArray(manifest.pageDocumentIds)
      && !manifest.pageIndexRootId) {
      const pageCount = Number(manifest.pageCount ?? descriptor.pageCount ?? 0);
      if (Number.isInteger(pageCount) && pageCount > 0) {
        for (let index = 0; index < pageCount; index += 1) {
          writes.push({
            type: "delete",
            reference: reference.collection("pages").doc(sectionPageId(index)),
          });
        }
      }
    }
    // Paginas v2 sao imutaveis e enderecadas por conteudo. Elas podem ser
    // compartilhadas por geracoes; nunca sao apagadas junto do manifesto.
    // Um GC dedicado pode remover paginas sem referencia fora do hot path.
    writes.push({ type: "delete", reference });
  }
  await applyWrites(firestore, writes);
}

const STORAGE_SUBCOLLECTIONS = Object.freeze([
  "catalog",
  "career",
  SECTION_CONTENT_PAGES_COLLECTION,
  SECTION_PAGE_INDEX_COLLECTION,
]);

async function validatedContentReferences(
  firestore,
  rootReference,
  manifest,
  pageIds,
  sectionPath,
) {
  if (pageIds.length === 0) return [];
  const references = pageIds.map((pageId) => contentPageReference(rootReference, pageId, manifest));
  const snapshots = await readReferences(firestore, references);
  if (snapshots.some((snapshot) => !snapshot.exists)) {
    throw persistenceError("SAVE_INCOMPLETE", `Save incompleto: pagina da secao ${sectionPath} ausente`);
  }
  snapshots.forEach((snapshot, index) => {
    validateContentPageDocument(pageIds[index], snapshot.data());
  });
  return references;
}

async function* iterateReachableStorageReferences(
  firestore,
  rootReference,
  document,
  heartbeat = async () => {},
) {
  const descriptors = new Map([
    ...sectionDescriptors(document),
    ...sectionDescriptors(document, "previousRoomSections"),
  ].map((descriptor) => [descriptorStorageKey(descriptor), descriptor]));

  for (const descriptor of descriptors.values()) {
    await heartbeat();
    const { manifest, reference } = await loadSectionManifest(rootReference, descriptor);
    yield reference;
    const indexDescriptor = manifestPageIndexDescriptor(manifest);
    if (!indexDescriptor) {
      const pageIds = validateManifestPageReferences(manifest) ?? [];
      for (let offset = 0; offset < pageIds.length; offset += SECTION_READ_BATCH_SIZE) {
        await heartbeat();
        const group = pageIds.slice(offset, offset + SECTION_READ_BATCH_SIZE);
        for (const contentReference of await validatedContentReferences(
          firestore,
          rootReference,
          manifest,
          group,
          descriptor.path,
        )) yield contentReference;
      }
      continue;
    }

    const pendingPageIds = [];
    const flushPages = async () => {
      if (pendingPageIds.length === 0) return [];
      const group = pendingPageIds.splice(0, pendingPageIds.length);
      await heartbeat();
      return validatedContentReferences(
        firestore,
        rootReference,
        manifest,
        group,
        descriptor.path,
      );
    };
    const loadNode = async (nodeId) => {
      await heartbeat();
      const snapshot = await pageIndexReference(rootReference, nodeId, manifest).get();
      return snapshot.exists ? snapshot.data() : null;
    };
    for await (const entry of iteratePageGraph(indexDescriptor, loadNode)) {
      if (entry.type === "page") {
        pendingPageIds.push(entry.id);
        if (pendingPageIds.length < SECTION_READ_BATCH_SIZE) continue;
        for (const contentReference of await flushPages()) yield contentReference;
      } else {
        for (const contentReference of await flushPages()) yield contentReference;
        yield pageIndexReference(rootReference, entry.id, manifest);
      }
    }
    for (const contentReference of await flushPages()) yield contentReference;
  }
}

function storageGcMarkReference(rootReference, targetPath) {
  const id = createHash("sha256").update(targetPath).digest("hex");
  return rootReference.collection(STORAGE_MAINTENANCE_COLLECTION)
    .doc(`${STORAGE_GC_MARK_PREFIX}${id}`);
}

async function writeStorageGcMarks(firestore, rootReference, leaseId, references) {
  const expiresAt = new Date(Date.now() + SAVE_MAINTENANCE_LEASE_MS * 2).toISOString();
  await applyWrites(firestore, references.map((reference) => ({
    type: "set",
    reference: storageGcMarkReference(rootReference, reference.path),
    data: { leaseId, targetPath: reference.path, expiresAt },
  })));
}

async function visitQueryPages(baseQuery, visitor, pageSize = STORAGE_SCAN_PAGE_SIZE) {
  let cursor = null;
  while (true) {
    let query = baseQuery.orderBy("__name__").limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) return;
    await visitor(snapshot.docs);
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < pageSize) return;
  }
}

async function visitCollectionPages(collection, visitor, pageSize = STORAGE_SCAN_PAGE_SIZE) {
  return visitQueryPages(collection, visitor, pageSize);
}

async function normalizeDeletedAuthorizationFields(firestore, reference) {
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists ? snapshot.data() : null;
    if (!isDeletedRoom(current) || (!current.ownerId && !Array.isArray(current.managerIds))) return;
    const authorization = deletedRoomAuthorizationMetadata(current);
    const { ownerId: _ownerId, managerIds: _managerIds, ...normalized } = current;
    transaction.set(reference, {
      ...normalized,
      deletedOwnerId: authorization.ownerId,
      storageCleanupRecipients: authorization.managerIds,
    });
  });
}

async function renewMaintenanceLease(firestore, rootReference, leaseId, phase) {
  let renewedDocument;
  await firestore.runTransaction(async (transaction) => {
    const writerStateReference = storageWriterStateReference(rootReference);
    const [snapshot, writerStateSnapshot] = await Promise.all([
      transaction.get(rootReference),
      transaction.get(writerStateReference),
    ]);
    const current = snapshot.exists ? snapshot.data() : null;
    if (!isV2Document(current) || current.saveMaintenanceLease?.id !== leaseId) {
      throw persistenceError("SAVE_MAINTENANCE_BUSY", "Lease de manutencao do save foi perdido", 409);
    }
    const writerState = writerStateSnapshot.exists ? writerStateSnapshot.data() : null;
    assertStorageWritersAvailable(writerState);
    const lease = {
      ...current.saveMaintenanceLease,
      phase,
      expiresAt: new Date(Date.now() + SAVE_MAINTENANCE_LEASE_MS).toISOString(),
    };
    renewedDocument = documentWithMaintenanceLease(current, lease);
    transaction.set(rootReference, renewedDocument);
  });
  return renewedDocument;
}

async function markReachableStorage(
  firestore,
  rootReference,
  document,
  leaseId,
  heartbeat,
) {
  const buffer = new Map();
  let markedCount = 0;
  const flush = async () => {
    if (buffer.size === 0) return;
    const references = [...buffer.values()];
    buffer.clear();
    await heartbeat();
    await writeStorageGcMarks(firestore, rootReference, leaseId, references);
    markedCount += references.length;
  };
  for await (const reference of iterateReachableStorageReferences(
    firestore,
    rootReference,
    document,
    heartbeat,
  )) {
    buffer.set(reference.path, reference);
    if (buffer.size >= SECTION_WRITE_BATCH_SIZE) await flush();
  }
  await flush();
  return markedCount;
}

async function sweepStorageCollection(
  firestore,
  rootReference,
  collection,
  leaseId,
) {
  let deletedCount = 0;
  await visitCollectionPages(collection, async (page) => {
    for (let offset = 0; offset < page.length; offset += STORAGE_GC_SWEEP_BATCH_SIZE) {
      const candidates = page.slice(offset, offset + STORAGE_GC_SWEEP_BATCH_SIZE);
      let deletedInTransaction = 0;
      let deletedCandidates = [];
      await firestore.runTransaction(async (transaction) => {
        const writerStateReference = storageWriterStateReference(rootReference);
        const [rootSnapshot, writerStateSnapshot, markSnapshots] = await Promise.all([
          transaction.get(rootReference),
          transaction.get(writerStateReference),
          typeof transaction.getAll === "function"
            ? transaction.getAll(...candidates.map((candidate) => (
                storageGcMarkReference(rootReference, candidate.ref.path)
              )))
            : Promise.all(candidates.map((candidate) => transaction.get(
                storageGcMarkReference(rootReference, candidate.ref.path),
              ))),
        ]);
        const current = rootSnapshot.exists ? rootSnapshot.data() : null;
        if (!isV2Document(current) || current.saveMaintenanceLease?.id !== leaseId) {
          throw persistenceError("SAVE_MAINTENANCE_BUSY", "Lease de manutencao do save foi perdido", 409);
        }
        assertStorageWritersAvailable(writerStateSnapshot.exists ? writerStateSnapshot.data() : null);
        const stale = candidates.filter((candidate, index) => {
          const mark = markSnapshots[index]?.exists ? markSnapshots[index].data() : null;
          return mark?.leaseId !== leaseId || mark?.targetPath !== candidate.ref.path;
        });
        deletedInTransaction = stale.length;
        deletedCandidates = stale;
        for (const candidate of stale) transaction.delete(candidate.ref);
        transaction.set(rootReference, documentWithMaintenanceLease(current, {
          ...current.saveMaintenanceLease,
          phase: "sweep",
          expiresAt: new Date(Date.now() + SAVE_MAINTENANCE_LEASE_MS).toISOString(),
        }));
      });
      deletedCount += deletedInTransaction;
      if (["catalog", "career"].includes(collection.id)) {
        for (const candidate of deletedCandidates) {
          if (candidate.ref.id.startsWith(DOMAIN_CONTENT_PAGE_PREFIX)
            || candidate.ref.id.startsWith(DOMAIN_PAGE_INDEX_PREFIX)) continue;
          await visitCollectionPages(candidate.ref.collection("pages"), async (nestedPage) => {
            await applyWrites(firestore, nestedPage.map((snapshot) => ({
              type: "delete",
              reference: snapshot.ref,
            })));
            deletedCount += nestedPage.length;
          });
        }
      }
    }
  });
  return deletedCount;
}

function isStorageWriterLeaseReference(reference) {
  return reference?.id?.startsWith(STORAGE_WRITER_LEASE_PREFIX) === true;
}

async function deleteExpiredStorageWriterLeases(
  firestore,
  rootReference,
  leaseId,
  references,
) {
  let deletedCount = 0;
  for (let offset = 0; offset < references.length; offset += STORAGE_GC_SWEEP_BATCH_SIZE) {
    const candidates = references.slice(offset, offset + STORAGE_GC_SWEEP_BATCH_SIZE);
    let deletedInTransaction = 0;
    await firestore.runTransaction(async (transaction) => {
      const [rootSnapshot, leaseSnapshots] = await Promise.all([
        transaction.get(rootReference),
        typeof transaction.getAll === "function"
          ? transaction.getAll(...candidates)
          : Promise.all(candidates.map((reference) => transaction.get(reference))),
      ]);
      const current = rootSnapshot.exists ? rootSnapshot.data() : null;
      if (!isV2Document(current) || current.saveMaintenanceLease?.id !== leaseId) {
        throw persistenceError("SAVE_MAINTENANCE_BUSY", "Lease de manutencao do save foi perdido", 409);
      }
      const now = Date.now();
      const expired = leaseSnapshots.filter((snapshot) => {
        if (!snapshot.exists || !isStorageWriterLeaseReference(snapshot.ref)) return false;
        const expiresAt = Date.parse(snapshot.data()?.expiresAt);
        return !Number.isFinite(expiresAt) || expiresAt <= now;
      });
      for (const snapshot of expired) transaction.delete(snapshot.ref);
      transaction.set(rootReference, documentWithMaintenanceLease(current, {
        ...current.saveMaintenanceLease,
        phase: "writer-cleanup",
        expiresAt: new Date(now + SAVE_MAINTENANCE_LEASE_MS).toISOString(),
      }));
      deletedInTransaction = expired.length;
    });
    deletedCount += deletedInTransaction;
  }
  return deletedCount;
}

async function cleanupExpiredStorageWriterLeases(firestore, rootReference, leaseId) {
  const collection = rootReference.collection(STORAGE_MAINTENANCE_COLLECTION);
  let cursor = null;
  let deferredWriterReference = null;
  let deletedCount = 0;
  while (true) {
    let query = collection.orderBy("__name__").limit(STORAGE_SCAN_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) {
      if (deferredWriterReference) {
        deletedCount += await deleteExpiredStorageWriterLeases(
          firestore,
          rootReference,
          leaseId,
          [deferredWriterReference],
        );
      }
      return deletedCount;
    }

    const tail = snapshot.docs.at(-1);
    const candidates = [
      ...(deferredWriterReference ? [deferredWriterReference] : []),
      ...snapshot.docs.slice(0, -1)
        .map(({ ref }) => ref)
        .filter(isStorageWriterLeaseReference),
    ];
    if (candidates.length > 0) {
      deletedCount += await deleteExpiredStorageWriterLeases(
        firestore,
        rootReference,
        leaseId,
        candidates,
      );
    }

    cursor = tail;
    if (snapshot.size < STORAGE_SCAN_PAGE_SIZE) {
      if (isStorageWriterLeaseReference(tail.ref)) {
        deletedCount += await deleteExpiredStorageWriterLeases(
          firestore,
          rootReference,
          leaseId,
          [tail.ref],
        );
      }
      return deletedCount;
    }
    // Keep the cursor document alive until the next page has been fetched.
    // This avoids skipping documents while the collection is being cleaned.
    deferredWriterReference = isStorageWriterLeaseReference(tail.ref) ? tail.ref : null;
  }
}

async function cleanupStorageGcMarks(firestore, rootReference, leaseId) {
  const collection = rootReference.collection(STORAGE_MAINTENANCE_COLLECTION);
  await visitCollectionPages(collection, async (page) => {
    const markReferences = page
      .filter((snapshot) => snapshot.ref.id.startsWith(STORAGE_GC_MARK_PREFIX))
      .map((snapshot) => snapshot.ref);
    for (let offset = 0; offset < markReferences.length; offset += STORAGE_GC_SWEEP_BATCH_SIZE) {
      const references = markReferences.slice(offset, offset + STORAGE_GC_SWEEP_BATCH_SIZE);
      await firestore.runTransaction(async (transaction) => {
        const snapshots = typeof transaction.getAll === "function"
          ? await transaction.getAll(...references)
          : await Promise.all(references.map((reference) => transaction.get(reference)));
        const now = Date.now();
        snapshots.forEach((snapshot) => {
          if (!snapshot.exists) return;
          const mark = snapshot.data();
          const expired = Number.isFinite(Date.parse(mark?.expiresAt))
            && Date.parse(mark.expiresAt) <= now;
          if (mark?.leaseId === leaseId || expired) transaction.delete(snapshot.ref);
        });
      });
    }
  });
}

async function releaseMaintenanceLease(firestore, rootReference, leaseId) {
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rootReference);
    const current = snapshot.exists ? snapshot.data() : null;
    if (!isV2Document(current) || current.saveMaintenanceLease?.id !== leaseId) return;
    transaction.set(rootReference, documentWithMaintenanceLease(current));
  });
}

async function deleteRoomStorageDocuments(firestore, rootReference, payloadCollection, rootDocument) {
  const legacyDescriptors = new Map();
  const rememberLegacyPayload = (document) => {
    const descriptor = legacyChunkDescriptor(document);
    if (!descriptor) return;
    legacyDescriptors.set(`${descriptor.code}:${descriptor.generation}`, descriptor);
  };
  rememberLegacyPayload(rootDocument);
  for (const descriptor of rootDocument?.storageCleanupLegacyPayloads ?? []) {
    rememberLegacyPayload(descriptor);
  }
  let deletedCount = 0;
  for (const name of [
    ...STORAGE_SUBCOLLECTIONS,
    "migrations",
    STORAGE_MAINTENANCE_COLLECTION,
  ]) {
    const collection = rootReference.collection(name);
    await visitCollectionPages(collection, async (page) => {
      const writes = [];
      for (const snapshot of page) {
        if (snapshot.data()?.sourceDocument) rememberLegacyPayload(snapshot.data().sourceDocument);
        // Early v2 generations nested pages below manifests. Firestore does not
        // cascade-delete subcollections, so tombstoning must remove them too.
        if (["catalog", "career"].includes(name)
          && !snapshot.ref.id.startsWith(DOMAIN_CONTENT_PAGE_PREFIX)
          && !snapshot.ref.id.startsWith(DOMAIN_PAGE_INDEX_PREFIX)) {
          await visitCollectionPages(snapshot.ref.collection("pages"), async (nestedPage) => {
            await applyWrites(firestore, nestedPage.map((nested) => ({
              type: "delete",
              reference: nested.ref,
            })));
            deletedCount += nestedPage.length;
          });
        }
        writes.push({ type: "delete", reference: snapshot.ref });
      }
      await applyWrites(firestore, writes);
      deletedCount += writes.length;
    });
  }

  for (const descriptor of legacyDescriptors.values()) {
    for (let offset = 0; offset < descriptor.count; offset += SECTION_WRITE_BATCH_SIZE) {
      const writes = [];
      const end = Math.min(descriptor.count, offset + SECTION_WRITE_BATCH_SIZE);
      for (let index = offset; index < end; index += 1) {
        writes.push({
          type: "delete",
          reference: payloadCollection.doc(
            `${descriptor.code}--${descriptor.generation}--${String(index).padStart(3, "0")}`,
          ),
        });
      }
      await applyWrites(firestore, writes);
      deletedCount += writes.length;
    }
  }
  return deletedCount;
}

async function legacyPayloadCleanupDescriptors(rootReference, rootDocument) {
  const descriptors = new Map();
  const remember = (document) => {
    const source = legacyChunkDescriptor(document);
    if (!source) return;
    // Validate before committing the tombstone. A malformed legacy descriptor
    // must not make the original save unreachable.
    const descriptor = {
      code: source.code,
      roomStorageFormat: ROOM_DOCUMENT_CHUNKED_FORMAT,
      roomStorageGeneration: source.generation,
      roomStorageChunkCount: source.count,
    };
    descriptors.set(`${descriptor.code}:${descriptor.roomStorageGeneration}`, descriptor);
  };
  remember(rootDocument);
  await visitCollectionPages(rootReference.collection("migrations"), async (page) => {
    for (const snapshot of page) remember(snapshot.data()?.sourceDocument);
  });
  return [...descriptors.values()];
}

async function finalizeDeletedRoom(firestore, reference, cleanupId) {
  try {
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? snapshot.data() : null;
      if (!isDeletedRoom(current) || current.storageCleanupId !== cleanupId) return;
      if (current.storageCleanupPending !== true) return;
      const {
        storageCleanupLegacyPayloads: _legacyPayloads,
        ownerId: _legacyOwnerId,
        managerIds: _legacyManagerIds,
        ...completed
      } = current;
      const authorization = deletedRoomAuthorizationMetadata(current);
      transaction.set(reference, {
        ...completed,
        storageCleanupPending: false,
        deletedOwnerId: authorization.ownerId,
        storageCleanupRecipients: authorization.managerIds,
      });
    });
  } catch (error) {
    // A transaction ACK can be lost after Firestore committed it. Re-read the
    // tombstone before reporting failure so deletion remains idempotent.
    const snapshot = await reference.get().catch(() => null);
    const current = snapshot?.exists ? snapshot.data() : null;
    if (isDeletedRoom(current)
      && current.storageCleanupId === cleanupId
      && current.storageCleanupPending === false) return;
    throw error;
  }
}

function descriptorStorageKey(descriptor) {
  return `${descriptor.domain}/${descriptor.documentId}`;
}

function referencedDescriptorKeys(document) {
  if (!isV2Document(document)) return new Set();
  return new Set([
    ...sectionDescriptors(document),
    ...sectionDescriptors(document, "previousRoomSections"),
  ].map(descriptorStorageKey));
}

/**
 * Firestore may apply a transaction and still return an unavailable/deadline
 * error while acknowledging it. Re-read the root before removing staging: the
 * root is the source of truth, and every descriptor reachable from its current
 * or rollback generation must survive.
 */
async function reconcileAmbiguousCommit(
  firestore,
  rootReference,
  expectedSaveCommitId,
  stagedDescriptors,
) {
  let snapshot;
  try {
    snapshot = await rootReference.get();
  } catch {
    // If reconciliation itself is unavailable, leaking immutable staging is
    // safer than deleting data that an acknowledged root may reference.
    return { status: "unknown", currentDocument: null };
  }
  const currentDocument = snapshot.exists ? snapshot.data() : null;
  if (currentDocument?.saveCommitId === expectedSaveCommitId) {
    return { status: "committed", currentDocument };
  }

  let referenced;
  try {
    referenced = referencedDescriptorKeys(currentDocument);
  } catch {
    // A malformed/unreadable root cannot prove that staging is unreachable.
    return { status: "unknown", currentDocument };
  }
  const unreferenced = stagedDescriptors.filter(
    (descriptor) => !referenced.has(descriptorStorageKey(descriptor)),
  );
  await cleanupDescriptors(firestore, rootReference, unreferenced).catch(() => {});
  return { status: "not-committed", currentDocument };
}

async function loadV2Room(firestore, rootReference, document, paths = null) {
  assertSupportedSaveVersion(document);
  if (!isV2Document(document)) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Save v2 possui formato invalido");
  }
  const requested = paths ? new Set(paths) : null;
  const descriptors = sectionDescriptors(document)
    .filter((descriptor) => !requested || requested.has(descriptor.path));
  const sections = [];
  // Concurrency is bounded to avoid an unbounded request burst for future schemas.
  for (let offset = 0; offset < descriptors.length; offset += 20) {
    const group = descriptors.slice(offset, offset + 20);
    sections.push(...await Promise.all(group.map((descriptor) => (
      loadSection(firestore, rootReference, descriptor)
    ))));
  }
  const room = rebuildRoomFromSections(
    document,
    requested ? [] : document.roomContainers,
    sections,
  );
  return requested ? withMetadataCounts(room, document) : room;
}


async function loadV2RoomExcluding(firestore, rootReference, document, excludedPaths = []) {
  assertV2DocumentIntegrity(document);
  const excluded = [...new Set(excludedPaths.map((path) => String(path ?? "").trim()).filter(Boolean))];
  const descriptors = sectionDescriptors(document).filter(
    (descriptor) => !pathExcluded(descriptor.path, excluded),
  );
  const sections = [];
  for (let offset = 0; offset < descriptors.length; offset += 20) {
    const group = descriptors.slice(offset, offset + 20);
    sections.push(...await Promise.all(group.map((descriptor) => (
      loadSection(firestore, rootReference, descriptor)
    ))));
  }
  return withMetadataCounts(rebuildRoomFromSections(
    document,
    (document.roomContainers ?? []).filter((container) => !pathExcluded(container.path, excluded)),
    sections,
  ), document);
}

async function validateStagedSections(
  firestore,
  rootReference,
  sections,
  descriptors,
  writerLease = null,
) {
  const expected = new Map(sections.map((section) => [section.path, checksum(section.value)]));
  const renewLease = writerLease
    ? () => renewStorageWriterLease(firestore, writerLease)
    : null;
  for (let offset = 0; offset < descriptors.length; offset += 20) {
    if (renewLease) await renewLease();
    const group = descriptors.slice(offset, offset + 20);
    const loaded = [];
    for (const descriptor of group) {
      loaded.push(await loadSection(firestore, rootReference, descriptor, renewLease));
    }
    for (const section of loaded) {
      if (checksum(section.value) !== expected.get(section.path)) {
        throw persistenceError("SAVE_MIGRATION_VALIDATION_FAILED", `Validacao da secao ${section.path} falhou`);
      }
    }
  }
}

export class FirestoreRoomPersistence {
  #collection;
  #firestore;
  #garbageJobs = new Map();
  #payloadCollection;

  constructor(firestore, { collectionName = "rooms", payloadCollectionName = "roomPayloads" } = {}) {
    if (!firestore) throw new Error("Firestore e obrigatorio");
    this.#firestore = firestore;
    this.#collection = firestore.collection(collectionName);
    this.#payloadCollection = firestore.collection(payloadCollectionName);
  }

  #scheduleGarbageCollection(code) {
    const existing = this.#garbageJobs.get(code);
    if (existing) return existing;
    let job;
    job = new Promise((resolve) => setImmediate(resolve))
      .then(async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            return await this.#collectGarbageNow(code);
          } catch (error) {
            if (error?.code !== "SAVE_MAINTENANCE_BUSY" || attempt === 2) throw error;
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          }
        }
        return { deletedCount: 0, reachableCount: 0 };
      })
      .finally(() => {
        if (this.#garbageJobs.get(code) === job) this.#garbageJobs.delete(code);
      });
    this.#garbageJobs.set(code, job);
    // Background maintenance must not create an unhandled rejection, but the
    // original promise stays rejecting so an explicit collectGarbage() call can
    // observe corruption or an active writer instead of receiving false success.
    void job.catch(() => {});
    return job;
  }

  async create(room) {
    const reference = this.#collection.doc(room.code);
    const existing = await reference.get();
    if (existing.exists) return false;
    const writerLease = await acquireStorageWriterLease(this.#firestore, reference, {
      expectedToken: null,
      operation: "create-save",
      requireMissing: true,
    });
    if (!writerLease) return false;
    const split = splitRoomDomains(room);
    const generation = createHash("sha256")
      .update(`${room.code}:${Date.now()}:${Math.random()}`)
      .digest("hex").slice(0, 24);
    const descriptors = [];
    let expectedSaveCommitId = null;
    try {
      for (const section of split.sections) {
        descriptors.push(await stageSection(
          this.#firestore,
          reference,
          section,
          generation,
          writerLease,
        ));
      }
      await validateStagedSections(
        this.#firestore,
        reference,
        split.sections,
        descriptors,
        writerLease,
      );
      const document = rootDocumentForV2(room, split, descriptors);
      expectedSaveCommitId = document.saveCommitId;
      let created;
      try {
        created = await this.#firestore.runTransaction(async (transaction) => {
          const [snapshot, stateSnapshot, leaseSnapshot] = await Promise.all([
            transaction.get(reference),
            transaction.get(writerLease.stateReference),
            transaction.get(writerLease.leaseReference),
          ]);
          if (snapshot.exists) {
            releaseStorageWriterInTransaction(
              transaction,
              writerLease.stateReference,
              writerLease.leaseReference,
              stateSnapshot,
              leaseSnapshot,
              writerLease.id,
              { required: true },
            );
            return false;
          }
          releaseStorageWriterInTransaction(
            transaction,
            writerLease.stateReference,
            writerLease.leaseReference,
            stateSnapshot,
            leaseSnapshot,
            writerLease.id,
            { required: true },
          );
          transaction.set(reference, document);
          return true;
        });
      } catch (error) {
        const reconciliation = await reconcileAmbiguousCommit(
          this.#firestore,
          reference,
          document.saveCommitId,
          descriptors,
        );
        if (reconciliation.status === "committed") {
          this.#scheduleGarbageCollection(room.code);
          return true;
        }
        throw error;
      }
      if (!created) {
        await reconcileAmbiguousCommit(
          this.#firestore,
          reference,
          document.saveCommitId,
          descriptors,
        );
      }
      // Also sweeps blobs left by an interrupted/concurrent create attempt for
      // this code. Current and rollback generations stay marked.
      this.#scheduleGarbageCollection(room.code);
      return created;
    } catch (error) {
      // Staging failures and ambiguous transaction failures use the same safe
      // reachability check. Never blindly remove a possibly committed manifest.
      const reconciliation = await reconcileAmbiguousCommit(
        this.#firestore,
        reference,
        expectedSaveCommitId,
        descriptors,
      );
      if (reconciliation.status === "committed") {
        this.#scheduleGarbageCollection(room.code);
        return true;
      }
      throw error;
    } finally {
      await releaseStorageWriterLease(this.#firestore, writerLease).catch(() => {});
    }
  }

  async get(code) {
    const reference = this.#collection.doc(code);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await reference.get();
      const stored = snapshot.exists ? snapshot.data() : null;
      if (!stored || isDeletedRoom(stored)) return null;
      assertV2DocumentIntegrity(stored);
      if (!isV2Document(stored)) {
        await this.#migrateLegacy(reference, stored);
        continue;
      }
      try {
        return await loadV2Room(this.#firestore, reference, stored);
      } catch (error) {
        if (error?.code !== "SAVE_INCOMPLETE" || attempt === 2) throw error;
        // A reader may have observed a root immediately before a concurrent
        // generation swap. Re-read the small root and retry, never mix versions.
      }
    }
    throw persistenceError("SAVE_INCOMPLETE", "Nao foi possivel obter uma geracao consistente do save");
  }

  async save(room) {
    const reference = this.#collection.doc(room.code);
    for (let attempt = 0; attempt < MUTATION_MAX_ATTEMPTS; attempt += 1) {
      const snapshot = await reference.get();
      const stored = snapshot.exists ? snapshot.data() : null;
      if (stored && isDeletedRoom(stored)) throw reservedCodeError(room.code);
      if (stored) {
        assertV2DocumentIntegrity(stored);
        assertMaintenanceAvailable(stored);
      }
      if (stored && !isV2Document(stored)) {
        await this.#migrateLegacy(reference, stored);
        continue;
      }
      if (stored && Number(room?.revision) <= Number(stored?.revision)) {
        throw persistenceError(
          "SAVE_WRITE_CONFLICT",
          "O snapshot informado esta desatualizado",
          409,
          { expectedRevisionGreaterThan: Number(stored?.revision), receivedRevision: room?.revision },
        );
      }
      await this.#commitV2(reference, room, stored);
      return;
    }
  }

  async mutate(code, mutation) {
    const reference = this.#collection.doc(code);
    for (let attempt = 0; attempt < MUTATION_MAX_ATTEMPTS; attempt += 1) {
      const snapshot = await reference.get();
      const stored = snapshot.exists ? snapshot.data() : null;
      const reserved = isDeletedRoom(stored);
      if (reserved) {
        const next = mutation(null);
        if (next === undefined) return null;
        throw reservedCodeError(code);
      }
      if (stored) {
        assertV2DocumentIntegrity(stored);
        assertMaintenanceAvailable(stored);
      }
      if (stored && !isV2Document(stored)) {
        await this.#migrateLegacy(reference, stored);
        continue;
      }
      let current;
      try {
        current = stored ? await loadV2Room(this.#firestore, reference, stored) : null;
      } catch (error) {
        if (error?.code === "SAVE_INCOMPLETE" && attempt + 1 < MUTATION_MAX_ATTEMPTS) continue;
        throw error;
      }
      const next = mutation(clone(current));
      if (next === undefined) return current;
      try {
        await this.#commitV2(reference, next, stored);
        return clone(next);
      } catch (error) {
        if (error?.code !== "SAVE_WRITE_CONFLICT" || attempt + 1 >= MUTATION_MAX_ATTEMPTS) throw error;
      }
    }
    throw persistenceError("SAVE_WRITE_CONFLICT", "O save foi alterado simultaneamente", 409);
  }

  async mutatePaths(code, paths, mutation) {
    const reference = this.#collection.doc(code);
    const requestedPaths = normalizedMutationPaths(paths);
    for (let attempt = 0; attempt < MUTATION_MAX_ATTEMPTS; attempt += 1) {
      const snapshot = await reference.get();
      const stored = snapshot.exists ? snapshot.data() : null;
      const reserved = isDeletedRoom(stored);
      if (reserved) {
        const next = mutation(null);
        if (next === undefined) return null;
        throw reservedCodeError(code);
      }
      if (stored) {
        assertV2DocumentIntegrity(stored);
        assertMaintenanceAvailable(stored);
      }
      if (stored && !isV2Document(stored)) {
        await this.#migrateLegacy(reference, stored);
        continue;
      }
      let current;
      try {
        current = stored
          ? await loadV2Room(this.#firestore, reference, stored, [...requestedPaths])
          : null;
      } catch (error) {
        if (error?.code === "SAVE_INCOMPLETE" && attempt + 1 < MUTATION_MAX_ATTEMPTS) continue;
        throw error;
      }
      const next = mutation(clone(current));
      if (next === undefined) return current;
      try {
        const committedDocument = await this.#commitV2Paths(
          reference,
          next,
          stored,
          requestedPaths,
        );
        return withMetadataCounts(clone(next), committedDocument);
      } catch (error) {
        if (error?.code !== "SAVE_WRITE_CONFLICT" || attempt + 1 >= MUTATION_MAX_ATTEMPTS) throw error;
      }
    }
    throw persistenceError("SAVE_WRITE_CONFLICT", "O save foi alterado simultaneamente", 409);
  }

  async #commitV2Paths(reference, room, previousDocument, requestedPaths) {
    const expectedToken = storageToken(previousDocument);
    const writerLease = await acquireStorageWriterLease(this.#firestore, reference, {
      expectedToken,
      operation: "commit-save-paths",
    });
    try {
    const split = partialRoomSplit(room, requestedPaths, previousDocument);
    const previousDescriptors = previousDocument ? sectionDescriptors(previousDocument) : [];
    const previousByPath = new Map(previousDescriptors.map((descriptor) => [descriptor.path, descriptor]));
    const nextByPath = new Map(split.sections.map((section) => [section.path, section]));
    const generation = createHash("sha256")
      .update(`${room.code}:${Date.now()}:${Math.random()}`)
      .digest("hex").slice(0, 24);
    const descriptors = previousDescriptors.filter(
      (descriptor) => !requestedPaths.has(descriptor.path),
    );
    const stagedSections = [];
    const stagedDescriptors = [];
    try {
      for (const path of requestedPaths) {
        const section = nextByPath.get(path);
        if (!section) continue;
        const previous = previousByPath.get(path);
        const nextChecksum = checksum(section.value);
        if (previous?.checksum === nextChecksum && previous.domain === section.domain) {
          descriptors.push(previous);
        } else {
          const descriptor = await stageSection(
            this.#firestore,
            reference,
            section,
            generation,
            writerLease,
          );
          descriptors.push(descriptor);
          stagedSections.push(section);
          stagedDescriptors.push(descriptor);
        }
      }
      await validateStagedSections(
        this.#firestore,
        reference,
        stagedSections,
        stagedDescriptors,
        writerLease,
      );
    } catch (error) {
      await reconcileAmbiguousCommit(
        this.#firestore,
        reference,
        null,
        stagedDescriptors,
      );
      this.#scheduleGarbageCollection(room.code);
      throw error;
    }
    descriptors.sort((left, right) => left.path.localeCompare(right.path));
    const containersByPath = new Map((previousDocument?.roomContainers ?? []).map(
      (container) => [container.path, container],
    ));
    for (const container of split.containers) containersByPath.set(container.path, container);
    split.containers = [...containersByPath.values()]
      .sort((left, right) => left.path.localeCompare(right.path));
    const document = rootDocumentForV2(
      room,
      split,
      descriptors,
      previousDescriptors,
      previousDocument?.saveMigration,
    );
    try {
      await this.#firestore.runTransaction(async (transaction) => {
        const [snapshot, stateSnapshot, leaseSnapshot] = await Promise.all([
          transaction.get(reference),
          transaction.get(writerLease.stateReference),
          transaction.get(writerLease.leaseReference),
        ]);
        const currentDocument = snapshot.exists ? snapshot.data() : null;
        if (isDeletedRoom(currentDocument)) throw reservedCodeError(room.code);
        assertMaintenanceAvailable(currentDocument);
        if (storageToken(currentDocument) !== expectedToken) {
          throw persistenceError("SAVE_WRITE_CONFLICT", "O save foi alterado simultaneamente", 409);
        }
        releaseStorageWriterInTransaction(
          transaction,
          writerLease.stateReference,
          writerLease.leaseReference,
          stateSnapshot,
          leaseSnapshot,
          writerLease.id,
          { required: true },
        );
        transaction.set(reference, document);
      });
    } catch (error) {
      const reconciliation = await reconcileAmbiguousCommit(
        this.#firestore,
        reference,
        document.saveCommitId,
        stagedDescriptors,
      );
      if (reconciliation.status !== "committed") throw error;
    }
    const currentIds = new Set(descriptors.map(descriptorStorageKey));
    const immediatePreviousIds = new Set(previousDescriptors.map(descriptorStorageKey));
    const stale = sectionDescriptors(previousDocument ?? {}, "previousRoomSections")
      .filter((descriptor) => {
        const id = descriptorStorageKey(descriptor);
        return !currentIds.has(id) && !immediatePreviousIds.has(id);
      });
    await cleanupDescriptors(this.#firestore, reference, stale).catch(() => {});
    if (stale.length > 0) this.#scheduleGarbageCollection(room.code);
    return document;
    } finally {
      await releaseStorageWriterLease(this.#firestore, writerLease).catch(() => {});
    }
  }

  async #commitV2(reference, room, previousDocument) {
    const expectedToken = storageToken(previousDocument);
    const writerLease = await acquireStorageWriterLease(this.#firestore, reference, {
      expectedToken,
      operation: "commit-save",
    });
    try {
    const split = splitRoomDomains(room);
    const previousDescriptors = previousDocument ? sectionDescriptors(previousDocument) : [];
    const previousByPath = new Map(previousDescriptors.map((descriptor) => [descriptor.path, descriptor]));
    const generation = createHash("sha256")
      .update(`${room.code}:${Date.now()}:${Math.random()}`)
      .digest("hex").slice(0, 24);
    const descriptors = [];
    const stagedSections = [];
    const stagedDescriptors = [];
    try {
      for (const section of split.sections) {
        const previous = previousByPath.get(section.path);
        const nextChecksum = checksum(section.value);
        if (previous?.checksum === nextChecksum && previous.domain === section.domain) {
          descriptors.push(previous);
        } else {
          const descriptor = await stageSection(
            this.#firestore,
            reference,
            section,
            generation,
            writerLease,
          );
          descriptors.push(descriptor);
          stagedSections.push(section);
          stagedDescriptors.push(descriptor);
        }
      }
      await validateStagedSections(
        this.#firestore,
        reference,
        stagedSections,
        stagedDescriptors,
        writerLease,
      );
    } catch (error) {
      await reconcileAmbiguousCommit(
        this.#firestore,
        reference,
        null,
        stagedDescriptors,
      );
      this.#scheduleGarbageCollection(room.code);
      throw error;
    }
    const document = rootDocumentForV2(
      room,
      split,
      descriptors,
      previousDescriptors,
      previousDocument?.saveMigration,
    );
    try {
      await this.#firestore.runTransaction(async (transaction) => {
        const [snapshot, stateSnapshot, leaseSnapshot] = await Promise.all([
          transaction.get(reference),
          transaction.get(writerLease.stateReference),
          transaction.get(writerLease.leaseReference),
        ]);
        const currentDocument = snapshot.exists ? snapshot.data() : null;
        if (isDeletedRoom(currentDocument)) throw reservedCodeError(room.code);
        assertMaintenanceAvailable(currentDocument);
        if (storageToken(currentDocument) !== expectedToken) {
          throw persistenceError("SAVE_WRITE_CONFLICT", "O save foi alterado simultaneamente", 409);
        }
        releaseStorageWriterInTransaction(
          transaction,
          writerLease.stateReference,
          writerLease.leaseReference,
          stateSnapshot,
          leaseSnapshot,
          writerLease.id,
          { required: true },
        );
        transaction.set(reference, document);
      });
    } catch (error) {
      const reconciliation = await reconcileAmbiguousCommit(
        this.#firestore,
        reference,
        document.saveCommitId,
        stagedDescriptors,
      );
      if (reconciliation.status !== "committed") throw error;
    }
    const currentIds = new Set(descriptors.map((descriptor) => (
      `${descriptor.domain}/${descriptor.documentId}`
    )));
    const immediatePreviousIds = new Set(previousDescriptors.map((descriptor) => (
      `${descriptor.domain}/${descriptor.documentId}`
    )));
    const stale = sectionDescriptors(previousDocument ?? {}, "previousRoomSections")
      .filter((descriptor) => {
        const id = `${descriptor.domain}/${descriptor.documentId}`;
        return !currentIds.has(id) && !immediatePreviousIds.has(id);
      });
    await cleanupDescriptors(this.#firestore, reference, stale).catch(() => {});
    if (stale.length > 0) this.#scheduleGarbageCollection(room.code);
    } finally {
      await releaseStorageWriterLease(this.#firestore, writerLease).catch(() => {});
    }
  }

  async collectGarbage(code) {
    const scheduled = this.#garbageJobs.get(code);
    return scheduled ?? this.#collectGarbageNow(code);
  }

  async #collectGarbageNow(code) {
    const reference = this.#collection.doc(code);
    let snapshot = await reference.get();
    let document = snapshot.exists ? snapshot.data() : null;
    if (!document || isDeletedRoom(document)) return { deletedCount: 0, reachableCount: 0 };
    assertV2DocumentIntegrity(document);
    if (!isV2Document(document)) {
      await this.#migrateLegacy(reference, document);
      snapshot = await reference.get();
      document = snapshot.exists ? snapshot.data() : null;
    }
    if (!isV2Document(document)) {
      throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Save nao pode ser preparado para manutencao");
    }

    const leaseId = createHash("sha256")
      .update(`${code}:gc:${Date.now()}:${Math.random()}`)
      .digest("hex")
      .slice(0, 32);
    let leasedDocument;
    try {
      await this.#firestore.runTransaction(async (transaction) => {
        const writerStateReference = storageWriterStateReference(reference);
        const [latest, writerStateSnapshot] = await Promise.all([
          transaction.get(reference),
          transaction.get(writerStateReference),
        ]);
        const current = latest.exists ? latest.data() : null;
        if (!current || isDeletedRoom(current)) return;
        assertV2DocumentIntegrity(current);
        assertMaintenanceAvailable(current);
        const writerState = writerStateSnapshot.exists ? writerStateSnapshot.data() : null;
        assertStorageWritersAvailable(writerState);
        if (writerStateSnapshot.exists) transaction.delete(writerStateReference);
        leasedDocument = documentWithMaintenanceLease(current, {
          id: leaseId,
          operation: "storage-gc",
          phase: "mark",
          baseSaveCommitId: current.saveCommitId,
          expiresAt: new Date(Date.now() + SAVE_MAINTENANCE_LEASE_MS).toISOString(),
        });
        transaction.set(reference, leasedDocument);
      });
    } catch (error) {
      // The lease transaction may commit while its ACK is lost. Reconcile from
      // the authoritative root so the successful GC still reaches its finally
      // block and never leaves the save locked until lease expiry.
      const latest = await reference.get().catch(() => null);
      const current = latest?.exists ? latest.data() : null;
      if (!isV2Document(current) || current.saveMaintenanceLease?.id !== leaseId) throw error;
      assertV2DocumentIntegrity(current);
      leasedDocument = current;
    }
    if (!leasedDocument) return { deletedCount: 0, reachableCount: 0 };

    let lastHeartbeatAt = Date.now();
    let phase = "mark";
    const heartbeat = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastHeartbeatAt < STORAGE_GC_HEARTBEAT_MS) return;
      leasedDocument = await renewMaintenanceLease(
        this.#firestore,
        reference,
        leaseId,
        phase,
      );
      lastHeartbeatAt = now;
    };
    try {
      await cleanupExpiredStorageWriterLeases(this.#firestore, reference, leaseId);
      await heartbeat(true);
      // Mark completes fully before sweep. Any missing/corrupt live node aborts
      // closed: no storage document is deleted from a damaged save.
      const reachableCount = await markReachableStorage(
        this.#firestore,
        reference,
        leasedDocument,
        leaseId,
        heartbeat,
      );
      phase = "sweep";
      await heartbeat(true);
      let deletedCount = 0;
      for (const name of STORAGE_SUBCOLLECTIONS) {
        deletedCount += await sweepStorageCollection(
          this.#firestore,
          reference,
          reference.collection(name),
          leaseId,
        );
      }
      return { deletedCount, reachableCount };
    } finally {
      await releaseMaintenanceLease(this.#firestore, reference, leaseId).catch(() => {});
      await cleanupStorageGcMarks(this.#firestore, reference, leaseId).catch(() => {});
    }
  }

  async remove(code, authorize) {
    const reference = this.#collection.doc(code);
    const snapshot = await reference.get();
    const rootDocument = snapshot.exists ? snapshot.data() : null;
    if (!rootDocument) {
      authorize(null);
      return null;
    }
    if (isDeletedRoom(rootDocument)) {
      const authorizationMetadata = deletedRoomAuthorizationMetadata(rootDocument);
      authorize(clone(authorizationMetadata));
      if (rootDocument.storageCleanupPending === true) {
        await deleteRoomStorageDocuments(
          this.#firestore,
          reference,
          this.#payloadCollection,
          rootDocument,
        );
        await finalizeDeletedRoom(
          this.#firestore,
          reference,
          rootDocument.storageCleanupId,
        );
      }
      return clone(authorizationMetadata);
    }
    assertV2DocumentIntegrity(rootDocument);
    assertMaintenanceAvailable(rootDocument);
    const current = isV2Document(rootDocument)
      ? metadataRoomFromDocument(rootDocument)
      : await roomFromStoredDocument(rootDocument, {
          collection: this.#payloadCollection,
          get: (chunkReference) => chunkReference.get(),
        });
    authorize(clone(current));
    const expectedToken = storageToken(rootDocument);
    const deletedAt = new Date().toISOString();
    const storageCleanupId = createHash("sha256")
      .update(`${code}:delete:${deletedAt}:${Math.random()}`)
      .digest("hex")
      .slice(0, 32);
    const storageCleanupLegacyPayloads = await legacyPayloadCleanupDescriptors(
      reference,
      rootDocument,
    );
    const authorizationMetadata = deletedRoomAuthorizationMetadata(current);
    await this.#firestore.runTransaction(async (transaction) => {
      const writerStateReference = storageWriterStateReference(reference);
      const [latest, writerStateSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(writerStateReference),
      ]);
      const latestDocument = latest.exists ? latest.data() : null;
      assertMaintenanceAvailable(latestDocument);
      if (storageToken(latestDocument) !== expectedToken) {
        throw persistenceError("SAVE_WRITE_CONFLICT", "O save foi alterado simultaneamente", 409);
      }
      const writerState = writerStateSnapshot.exists ? writerStateSnapshot.data() : null;
      assertStorageWritersAvailable(writerState);
      if (writerStateSnapshot.exists) transaction.delete(writerStateReference);
      transaction.set(reference, {
        ...deletedRoom(code),
        saveSchemaVersion: SAVE_SCHEMA_VERSION,
        deletedAt,
        previousSaveCommitId: expectedToken,
        storageCleanupId,
        storageCleanupPending: true,
        deletedOwnerId: authorizationMetadata.ownerId,
        storageCleanupRecipients: authorizationMetadata.managerIds,
        ...(storageCleanupLegacyPayloads.length > 0 ? { storageCleanupLegacyPayloads } : {}),
      });
    });
    await deleteRoomStorageDocuments(
      this.#firestore,
      reference,
      this.#payloadCollection,
      rootDocument,
    );
    await finalizeDeletedRoom(this.#firestore, reference, storageCleanupId);
    return clone(current);
  }

  async listByManager(managerId) {
    const query = this.#collection.where("managerIds", "array-contains", managerId);
    const codes = [];
    await visitQueryPages(query, async (documents) => {
      for (const snapshot of documents) {
        const document = snapshot.data();
        if (isDeletedRoom(document)) {
          await normalizeDeletedAuthorizationFields(this.#firestore, snapshot.ref);
        } else {
          assertV2DocumentIntegrity(document);
          codes.push(document.code);
        }
      }
    });
    return Promise.all(codes.map((code) => this.get(code)));
  }

  async listMetadataByManager(managerId) {
    const rooms = [];
    const query = this.#collection.where("managerIds", "array-contains", managerId);
    await visitQueryPages(query, async (documents) => {
      for (const snapshot of documents) {
        const document = snapshot.data();
        if (isDeletedRoom(document)) {
          // Tombstones created before v2 cleanup metadata was isolated still
          // match the managerIds index. Normalize once so future listings do
          // not read or bill those deleted saves forever.
          await normalizeDeletedAuthorizationFields(this.#firestore, snapshot.ref);
          continue;
        }
        assertV2DocumentIntegrity(document);
        rooms.push(metadataRoomFromDocument(document));
      }
    });
    return rooms;
  }

  async getMetadata(code) {
    const snapshot = await this.#collection.doc(code).get();
    if (!snapshot.exists || isDeletedRoom(snapshot.data())) return null;
    assertV2DocumentIntegrity(snapshot.data());
    return metadataRoomFromDocument(snapshot.data());
  }

  async getDeletionMetadata(code) {
    const snapshot = await this.#collection.doc(code).get();
    if (!snapshot.exists) return null;
    const document = snapshot.data();
    if (isDeletedRoom(document)) return deletedRoomAuthorizationMetadata(document);
    assertV2DocumentIntegrity(document);
    return metadataRoomFromDocument(document);
  }

  async getPartial(code, { excludePaths = [] } = {}) {
    const reference = this.#collection.doc(code);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await reference.get();
      const stored = snapshot.exists ? snapshot.data() : null;
      if (!stored || isDeletedRoom(stored)) return null;
      assertV2DocumentIntegrity(stored);
      if (!isV2Document(stored)) {
        await this.#migrateLegacy(reference, stored);
        continue;
      }
      try {
        return await loadV2RoomExcluding(this.#firestore, reference, stored, excludePaths);
      } catch (error) {
        if (error?.code !== "SAVE_INCOMPLETE" || attempt === 2) throw error;
      }
    }
    throw persistenceError("SAVE_INCOMPLETE", "Nao foi possivel obter uma geracao consistente do save");
  }

  async getPaths(code, paths = []) {
    const reference = this.#collection.doc(code);
    const requestedPaths = [...new Set(paths.map((path) => String(path ?? "").trim()).filter(Boolean))];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await reference.get();
      const stored = snapshot.exists ? snapshot.data() : null;
      if (!stored || isDeletedRoom(stored)) return null;
      assertV2DocumentIntegrity(stored);
      if (!isV2Document(stored)) {
        await this.#migrateLegacy(reference, stored);
        continue;
      }
      try {
        return await loadV2Room(this.#firestore, reference, stored, requestedPaths);
      } catch (error) {
        if (error?.code !== "SAVE_INCOMPLETE" || attempt === 2) throw error;
      }
    }
    throw persistenceError("SAVE_INCOMPLETE", "Nao foi possivel obter uma geracao consistente do save");
  }

  async getSectionTail(code, path) {
    const reference = this.#collection.doc(code);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await reference.get();
      const stored = snapshot.exists ? snapshot.data() : null;
      if (!stored || isDeletedRoom(stored)) return null;
      assertV2DocumentIntegrity(stored);
      if (!isV2Document(stored)) {
        await this.#migrateLegacy(reference, stored);
        continue;
      }
      const descriptor = sectionDescriptors(stored).find((candidate) => candidate.path === path);
      if (!descriptor) return null;
      try {
        const section = await loadSectionManifest(reference, descriptor);
        if (section.manifest.format !== "json-array-pages-v2") {
          const loaded = await loadSection(this.#firestore, reference, descriptor);
          return Array.isArray(loaded.value) ? clone(loaded.value.at(-1) ?? null) : null;
        }
        const pageCount = Number(section.manifest.pageCount ?? 0);
        if (pageCount < 1) return null;
        const index = pageCount - 1;
        const contentPageId = await contentPageIdForManifestAt(reference, section.manifest, index);
        const pageReference = contentPageId
          ? contentPageReference(reference, contentPageId, section.manifest)
          : section.reference.collection("pages").doc(sectionPageId(index));
        const pageSnapshot = await pageReference.get();
        if (!pageSnapshot.exists) {
          throw persistenceError("SAVE_INCOMPLETE", `Save incompleto: ultima pagina da secao ${path} ausente`);
        }
        const pageDocument = contentPageId
          ? validateContentPageDocument(contentPageId, pageSnapshot.data())
          : pageSnapshot.data();
        const items = decodeSectionPage(section.manifest, {
          ...pageDocument,
          ...(contentPageId ? { index } : {}),
        });
        return Array.isArray(items) ? clone(items.at(-1) ?? null) : null;
      } catch (error) {
        if (error?.code !== "SAVE_INCOMPLETE" || attempt === 2) throw error;
      }
    }
    throw persistenceError("SAVE_INCOMPLETE", "Nao foi possivel obter uma geracao consistente do save");
  }

  async getSection(code, path, { page = null } = {}) {
    const reference = this.#collection.doc(code);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const snapshot = await reference.get();
        const stored = snapshot.exists ? snapshot.data() : null;
        if (!stored || isDeletedRoom(stored)) return null;
        assertV2DocumentIntegrity(stored);
        if (!isV2Document(stored)) {
          await this.#migrateLegacy(reference, stored);
          continue;
        }
        const descriptor = sectionDescriptors(stored).find((candidate) => candidate.path === path);
        if (!descriptor) return null;
        if (page === null) {
          const section = await loadSection(this.#firestore, reference, descriptor);
          return clone(section.value);
        }
        const section = await loadSectionManifest(reference, descriptor);
        if (section.manifest.format !== "json-array-pages-v2") {
          throw persistenceError("SAVE_SECTION_NOT_PAGEABLE", "Esta secao nao possui paginas independentes", 409);
        }
        const index = Number(page);
        if (!Number.isInteger(index) || index < 0) {
          throw persistenceError("SAVE_PAGE_INVALID", "Pagina do save invalida", 400);
        }
        if (index >= Number(section.manifest.pageCount)) {
          return { items: [], page: index, pageCount: Number(section.manifest.pageCount), hasMore: false };
        }
        const pageDocumentId = await contentPageIdForManifestAt(reference, section.manifest, index);
        const pageReference = pageDocumentId
          ? contentPageReference(reference, pageDocumentId, section.manifest)
          : section.reference.collection("pages").doc(sectionPageId(index));
        const pageSnapshot = await pageReference.get();
        if (!pageSnapshot.exists) {
          throw persistenceError("SAVE_INCOMPLETE", `Save incompleto: pagina ${index} da secao ${path} ausente`);
        }
        const pageDocument = pageDocumentId
          ? validateContentPageDocument(pageDocumentId, pageSnapshot.data())
          : pageSnapshot.data();
        return {
          items: decodeSectionPage(section.manifest, {
            ...pageDocument,
            ...(pageDocumentId ? { index } : {}),
          }),
          page: index,
          pageCount: Number(section.manifest.pageCount),
          hasMore: index + 1 < Number(section.manifest.pageCount),
        };
      } catch (error) {
        if (error?.code !== "SAVE_INCOMPLETE" || attempt === 2) throw error;
        // Root/manifest may have changed between reads. Retry from the root so
        // a section is never assembled from two generations.
      }
    }
    throw persistenceError("SAVE_INCOMPLETE", "Nao foi possivel obter uma geracao consistente da secao");
  }

  async #migrateLegacy(reference, legacyDocument) {
    assertV2DocumentIntegrity(legacyDocument);
    const sourceToken = storageToken(legacyDocument);
    const writerLease = await acquireStorageWriterLease(this.#firestore, reference, {
      expectedToken: sourceToken,
      operation: "migrate-save-v1-v2",
    });
    const renewLease = () => renewStorageWriterLease(this.#firestore, writerLease);
    try {
    const legacyRoom = await roomFromStoredDocument(legacyDocument, {
      collection: this.#payloadCollection,
      get: (chunkReference) => chunkReference.get(),
    });
    const split = splitRoomDomains(legacyRoom);
    const migrationId = createHash("sha256")
      .update(`${legacyRoom.code}:${sourceToken}`)
      .digest("hex").slice(0, 32);
    // Record id is deterministic for audit/idempotency. Manifest generation is
    // unique so concurrent migration attempts cannot delete each other's data.
    const migrationGeneration = createHash("sha256")
      .update(`${migrationId}:${Date.now()}:${Math.random()}`)
      .digest("hex").slice(0, 24);
    const descriptors = [];
    let expectedSaveCommitId = null;
    try {
      for (const section of split.sections) {
        descriptors.push(await stageSection(
          this.#firestore,
          reference,
          section,
          migrationGeneration,
          writerLease,
        ));
      }
      await validateStagedSections(
        this.#firestore,
        reference,
        split.sections,
        descriptors,
        writerLease,
      );
    const reconstructedSections = [];
    for (const descriptor of descriptors) {
      reconstructedSections.push(await loadSection(
        this.#firestore,
        reference,
        descriptor,
        renewLease,
      ));
    }
    const reconstructed = rebuildRoomFromSections(
      split.metadata,
      split.containers,
      reconstructedSections,
    );
    if (canonicalChecksum(reconstructed) !== canonicalChecksum(legacyRoom)) {
      throw persistenceError("SAVE_MIGRATION_VALIDATION_FAILED", "A comparacao do save migrado falhou");
    }
    const backupReference = reference.collection("migrations").doc(`legacy-${migrationId}`);
    await renewLease();
    await backupReference.set({
      migrationId,
      sourceToken,
      sourceFormat: legacyDocument.roomStorageFormat ?? "json-v1",
      sourceDocument: clone(legacyDocument),
      createdAt: new Date().toISOString(),
      validated: true,
    });
    const migration = {
      id: migrationId,
      sourceSchemaVersion: Number(legacyDocument.saveSchemaVersion ?? 1),
      sourceFormat: legacyDocument.roomStorageFormat ?? "json-v1",
      sourceToken,
      backupPath: `migrations/legacy-${migrationId}`,
      sectionCount: descriptors.length,
      completedAt: new Date().toISOString(),
    };
    const document = rootDocumentForV2(legacyRoom, split, descriptors, [], migration);
      expectedSaveCommitId = document.saveCommitId;
      let committed;
      try {
        committed = await this.#firestore.runTransaction(async (transaction) => {
          const [snapshot, stateSnapshot, leaseSnapshot] = await Promise.all([
            transaction.get(reference),
            transaction.get(writerLease.stateReference),
            transaction.get(writerLease.leaseReference),
          ]);
          const current = snapshot.exists ? snapshot.data() : null;
          if (storageToken(current) !== sourceToken) {
            if (isV2Document(current)) {
              releaseStorageWriterInTransaction(
                transaction,
                writerLease.stateReference,
                writerLease.leaseReference,
                stateSnapshot,
                leaseSnapshot,
                writerLease.id,
                { required: true },
              );
              return false;
            }
            throw persistenceError("SAVE_WRITE_CONFLICT", "O save mudou durante a migracao", 409);
          }
          releaseStorageWriterInTransaction(
            transaction,
            writerLease.stateReference,
            writerLease.leaseReference,
            stateSnapshot,
            leaseSnapshot,
            writerLease.id,
            { required: true },
          );
          transaction.set(reference, document);
          return true;
        });
      } catch (error) {
        const reconciliation = await reconcileAmbiguousCommit(
          this.#firestore,
          reference,
          document.saveCommitId,
          descriptors,
        );
        if (reconciliation.status === "committed"
          || isV2Document(reconciliation.currentDocument)) {
          this.#scheduleGarbageCollection(legacyRoom.code);
          return;
        }
        throw error;
      }
      if (!committed) {
        await reconcileAmbiguousCommit(
          this.#firestore,
          reference,
          document.saveCommitId,
          descriptors,
        );
      }
      this.#scheduleGarbageCollection(legacyRoom.code);
    } catch (error) {
      const reconciliation = await reconcileAmbiguousCommit(
        this.#firestore,
        reference,
        expectedSaveCommitId,
        descriptors,
      );
      if (reconciliation.status === "committed"
        || isV2Document(reconciliation.currentDocument)) {
        this.#scheduleGarbageCollection(legacyRoom.code);
        return;
      }
      throw error;
    }
    } finally {
      await releaseStorageWriterLease(this.#firestore, writerLease).catch(() => {});
    }
  }
}

export function createRoomPersistence({ firestore, mode, nodeEnv, allowDemoAuth }) {
  if (mode === "memory") {
    if (nodeEnv === "production" || (!allowDemoAuth && nodeEnv !== "test")) {
      throw new Error("RoomStore em memoria exige ALLOW_DEMO_AUTH=true fora dos testes");
    }
    return new MemoryRoomPersistence();
  }
  if (mode !== "firestore") throw new Error(`ROOM_STORE invalido: ${mode}`);
  if (!firestore) {
    throw new Error("Firestore nao configurado; use ALLOW_DEMO_AUTH=true para o modo local explicito");
  }
  return new FirestoreRoomPersistence(firestore);
}
