import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { PAGE_INDEX_FORMAT, buildPageIndex } from "./roomPersistencePageIndex.mjs";

export const SAVE_SCHEMA_VERSION = 2;
export const SAVE_STORAGE_FORMAT = "firestore-sections-v2";
export const SAVE_DOCUMENT_SAFE_BYTES = 850_000;

const DIRECT_JSON_BYTES = 300_000;
const ARRAY_PAGE_TARGET_BYTES = 240_000;
const PAGE_PAYLOAD_CHARACTERS = 500_000;

const ROOM_METADATA_FIELDS = new Set([
  "id",
  "code",
  "name",
  "ownerId",
  "catalogOwnerId",
  "status",
  "managerIds",
  "managers",
  "activeLeagues",
  "seasonLength",
  "unlimitedSeasons",
  "currentSeason",
  "seasonYear",
  "seasonStartedAt",
  "careerCompleted",
  "careerCompletedAt",
  "maxManagers",
  "createdAt",
  "updatedAt",
  "startedAt",
  "revision",
  "version",
  "currentFixtureId",
  "scheduleVersion",
  "scheduleIssue",
]);

// These aggregates have independently changing branches. Splitting one level
// prevents a market update, for example, from rewriting every career player.
const COMPOSITE_SECTION_FIELDS = new Set([
  "careerState",
  "clubCareerState",
  "coachCareerState",
  "coachEmploymentState",
  "professionalLifecycleState",
  "professionalLeaveState",
  "marketState",
  "careerNewsState",
  "careerEventState",
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function json(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw persistenceError("SAVE_SECTION_INVALID", "Secao do save invalida");
  return serialized;
}

function jsonBytes(value) {
  return Buffer.byteLength(typeof value === "string" ? value : json(value), "utf8");
}

export function checksum(value) {
  return createHash("sha256").update(typeof value === "string" ? value : json(value)).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalChecksum(value) {
  return createHash("sha256").update(json(canonicalValue(value))).digest("hex");
}

export function persistenceError(code, message, status = 500, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

export function assertSupportedSaveVersion(document) {
  const rawVersion = document?.saveSchemaVersion;
  const version = rawVersion === undefined || rawVersion === null ? 1 : Number(rawVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw persistenceError(
      "SAVE_SCHEMA_VERSION_INVALID",
      "A versao do schema deste save e invalida",
      500,
      { saveSchemaVersion: rawVersion },
    );
  }
  if (version > SAVE_SCHEMA_VERSION) {
    throw persistenceError(
      "SAVE_SCHEMA_VERSION_UNSUPPORTED",
      "Este save foi criado por uma versao mais nova do Bola Manager",
      409,
      { saveSchemaVersion: version, supportedVersion: SAVE_SCHEMA_VERSION },
    );
  }
  return version;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sectionDomain(path) {
  const root = String(path).split(".", 1)[0];
  return root === "competitionCatalog"
    || root === "tournamentCatalog"
    || root.toLocaleLowerCase("en-US").includes("catalog")
    ? "catalog"
    : "career";
}

export function sectionKey(path) {
  return createHash("sha256").update(String(path)).digest("hex").slice(0, 24);
}

export function sectionDocumentId(path, generation) {
  return `${sectionKey(path)}--${String(generation)}`;
}

export function sectionPageId(index) {
  return String(index).padStart(8, "0");
}

export function contentPageId(page) {
  const pageChecksum = String(page?.checksum ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(pageChecksum)) {
    throw persistenceError("SAVE_SECTION_INVALID", "Pagina do save sem checksum valido");
  }
  return pageChecksum.toLocaleLowerCase("en-US");
}

export function validateContentPageDocument(pageId, page) {
  const expectedId = String(pageId ?? "").trim().toLocaleLowerCase("en-US");
  if (!/^[a-f0-9]{64}$/.test(expectedId) || contentPageId(page) !== expectedId) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Identidade da pagina do save nao confere");
  }
  // Validates the payload itself, not only the checksum copied into the
  // document. The physical document omits the logical array index.
  decodePagePayload({ ...page, index: 0 });
  return page;
}

export function roomMetadata(room) {
  const metadata = {};
  for (const [field, value] of Object.entries(room ?? {})) {
    if (ROOM_METADATA_FIELDS.has(field) && value !== undefined) metadata[field] = clone(value);
  }
  return metadata;
}

export function roomMetadataDocument(room) {
  return {
    ...roomMetadata(room),
    managerIds: Array.isArray(room?.managerIds) ? [...room.managerIds] : [],
    completedFixtureCount: Array.isArray(room?.completedFixtureIds) ? room.completedFixtureIds.length : 0,
    completedMatchCount: Array.isArray(room?.completedMatches) ? room.completedMatches.length : 0,
    seasonHistoryCount: Array.isArray(room?.seasonHistory) ? room.seasonHistory.length : 0,
  };
}

export function metadataRoomFromDocument(document) {
  if (!document || document.deleted === true) return null;
  return {
    ...roomMetadata(document),
    completedFixtureCount: Number(document.completedFixtureCount ?? 0),
    completedMatchCount: Number(document.completedMatchCount ?? 0),
    seasonHistoryCount: Number(document.seasonHistoryCount ?? 0),
  };
}

export function splitRoomDomains(room) {
  if (!room || typeof room !== "object" || !String(room.code ?? "").trim()) {
    throw persistenceError("SAVE_INVALID", "Save invalido", 400);
  }
  const sections = [];
  const containers = [];
  for (const [field, value] of Object.entries(room)) {
    if (ROOM_METADATA_FIELDS.has(field) || value === undefined) continue;
    if (COMPOSITE_SECTION_FIELDS.has(field) && isPlainObject(value)) {
      containers.push({ path: field, kind: "object" });
      for (const [child, childValue] of Object.entries(value)) {
        if (childValue === undefined) continue;
        sections.push({
          path: `${field}.${child}`,
          domain: sectionDomain(field),
          value: clone(childValue),
        });
      }
      continue;
    }
    sections.push({ path: field, domain: sectionDomain(field), value: clone(value) });
  }
  sections.sort((left, right) => left.path.localeCompare(right.path));
  containers.sort((left, right) => left.path.localeCompare(right.path));
  return { metadata: roomMetadataDocument(room), containers, sections };
}

function setSectionPath(target, path, value) {
  const separator = path.indexOf(".");
  if (separator < 0) {
    target[path] = clone(value);
    return;
  }
  const root = path.slice(0, separator);
  const child = path.slice(separator + 1);
  if (!isPlainObject(target[root])) target[root] = {};
  target[root][child] = clone(value);
}

export function rebuildRoomFromSections(metadata, containers, sections) {
  const room = roomMetadata(metadata);
  for (const container of containers ?? []) {
    if (!container?.path || container.kind !== "object") {
      throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Manifesto de containers do save corrompido");
    }
    room[container.path] = {};
  }
  for (const section of sections ?? []) {
    if (!section?.path) throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Secao sem caminho");
    setSectionPath(room, section.path, section.value);
  }
  return room;
}

function encodedPage(value, index, itemCount = undefined) {
  const serialized = json(value);
  const rawBytes = Buffer.byteLength(serialized, "utf8");
  const compressed = gzipSync(Buffer.from(serialized, "utf8")).toString("base64");
  const useGzip = compressed.length < serialized.length;
  const page = {
    index,
    encoding: useGzip ? "gzip-json" : "json",
    payload: useGzip ? compressed : serialized,
    checksum: checksum(serialized),
    rawBytes,
    ...(itemCount === undefined ? {} : { itemCount }),
  };
  return jsonBytes(page) <= SAVE_DOCUMENT_SAFE_BYTES ? page : null;
}

function arrayPages(value) {
  const groups = [];
  let current = [];
  let currentBytes = 2;
  for (const item of value) {
    const itemBytes = jsonBytes(item) + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && currentBytes + itemBytes > ARRAY_PAGE_TARGET_BYTES) {
      groups.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length > 0 || value.length === 0) groups.push(current);
  const pages = groups.map((items, index) => encodedPage(items, index, items.length));
  return pages.every(Boolean) ? pages : null;
}

function fragmentPages(serialized) {
  const compressed = gzipSync(Buffer.from(serialized, "utf8")).toString("base64");
  const pages = [];
  for (let offset = 0; offset < compressed.length; offset += PAGE_PAYLOAD_CHARACTERS) {
    const payload = compressed.slice(offset, offset + PAGE_PAYLOAD_CHARACTERS);
    pages.push({ index: pages.length, encoding: "gzip-json-fragment", payload, checksum: checksum(payload) });
  }
  return pages;
}

export function encodeSectionValue(path, domain, value) {
  const serialized = json(value);
  const rawBytes = Buffer.byteLength(serialized, "utf8");
  const valueChecksum = checksum(value);
  if (rawBytes <= DIRECT_JSON_BYTES) {
    return {
      manifest: {
        path,
        domain,
        format: "json-v2",
        payload: serialized,
        checksum: valueChecksum,
        rawBytes,
        pageCount: 0,
      },
      pages: [],
    };
  }
  if (Array.isArray(value)) {
    const pages = arrayPages(value);
    if (pages) {
      return {
        manifest: {
          path,
          domain,
          format: "json-array-pages-v2",
          checksum: valueChecksum,
          rawBytes,
          itemCount: value.length,
          pageCount: pages.length,
        },
        pages,
      };
    }
  }
  const compressed = gzipSync(Buffer.from(serialized, "utf8")).toString("base64");
  if (compressed.length <= PAGE_PAYLOAD_CHARACTERS) {
    return {
      manifest: {
        path,
        domain,
        format: "gzip-json-v2",
        payload: compressed,
        checksum: valueChecksum,
        rawBytes,
        pageCount: 0,
      },
      pages: [],
    };
  }
  const pages = fragmentPages(serialized);
  return {
    manifest: {
      path,
      domain,
      format: "gzip-json-fragments-v2",
      checksum: valueChecksum,
      rawBytes,
      pageCount: pages.length,
    },
    pages,
  };
}

export function withContentPageReferences(manifest, pages) {
  if (!Array.isArray(pages) || pages.length === 0) return { ...manifest };
  return {
    ...manifest,
    pageDocumentIds: pages.map(contentPageId),
  };
}

function decodePagePayload(page) {
  if (!page || !Number.isInteger(Number(page.index)) || typeof page.payload !== "string") {
    throw persistenceError("SAVE_INCOMPLETE", "Pagina do save ausente ou invalida");
  }
  if (page.encoding === "gzip-json-fragment") {
    if (checksum(page.payload) !== page.checksum) {
      throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Checksum da pagina do save nao confere");
    }
    return page.payload;
  }
  let serialized;
  try {
    serialized = page.encoding === "gzip-json"
      ? gunzipSync(Buffer.from(page.payload, "base64")).toString("utf8")
      : page.encoding === "json" ? page.payload : null;
  } catch (cause) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Pagina compactada do save corrompida", 500, { cause });
  }
  if (serialized === null || checksum(serialized) !== page.checksum) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Checksum da pagina do save nao confere");
  }
  try {
    return JSON.parse(serialized);
  } catch (cause) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "JSON da pagina do save corrompido", 500, { cause });
  }
}

function orderedPages(manifest, pages) {
  const expected = Number(manifest?.pageCount);
  if (!Number.isInteger(expected) || expected < 0 || pages.length !== expected) {
    throw persistenceError("SAVE_INCOMPLETE", "Save incompleto: quantidade de paginas nao confere");
  }
  const ordered = [...pages].sort((left, right) => Number(left?.index) - Number(right?.index));
  for (let index = 0; index < ordered.length; index += 1) {
    if (Number(ordered[index]?.index) !== index) {
      throw persistenceError("SAVE_INCOMPLETE", "Save incompleto: pagina ausente");
    }
  }
  return ordered;
}

export function validateManifestPageReferences(manifest) {
  const pageCount = Number(manifest?.pageCount ?? 0);
  const ids = manifest?.pageDocumentIds;
  if (ids === undefined) return null;
  if (!Array.isArray(ids)
    || ids.length !== pageCount
    || ids.some((id) => !/^[a-f0-9]{64}$/i.test(String(id)))) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Referencias de paginas do save corrompidas");
  }
  return ids.map((id) => String(id).toLocaleLowerCase("en-US"));
}

export function decodeSectionValue(manifest, pages = []) {
  if (!manifest?.path || !manifest?.format || !manifest?.checksum) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Manifesto de secao corrompido");
  }
  let value;
  try {
    if (manifest.format === "json-v2") {
      value = JSON.parse(manifest.payload);
    } else if (manifest.format === "gzip-json-v2") {
      value = JSON.parse(gunzipSync(Buffer.from(manifest.payload, "base64")).toString("utf8"));
    } else if (manifest.format === "json-array-pages-v2") {
      value = orderedPages(manifest, pages).flatMap((page) => {
        const items = decodePagePayload(page);
        if (!Array.isArray(items)) throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Pagina de lista invalida");
        return items;
      });
      if (value.length !== Number(manifest.itemCount)) {
        throw persistenceError("SAVE_INCOMPLETE", "Save incompleto: itens da secao nao conferem");
      }
    } else if (manifest.format === "gzip-json-fragments-v2") {
      const payload = orderedPages(manifest, pages).map(decodePagePayload).join("");
      value = JSON.parse(gunzipSync(Buffer.from(payload, "base64")).toString("utf8"));
    } else {
      throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Formato de secao desconhecido");
    }
  } catch (cause) {
    if (cause?.code) throw cause;
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Secao do save corrompida", 500, { cause });
  }
  if (checksum(value) !== manifest.checksum) {
    throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Checksum da secao do save nao confere");
  }
  return value;
}

export function decodeSectionPage(manifest, page) {
  if (manifest?.format !== "json-array-pages-v2") {
    throw persistenceError("SAVE_SECTION_NOT_PAGEABLE", "Esta secao nao possui paginas independentes", 409);
  }
  const items = decodePagePayload(page);
  if (!Array.isArray(items)) throw persistenceError("SAVE_DOCUMENT_CORRUPT", "Pagina de lista invalida");
  return items;
}

export function estimateSectionedDocumentBytes(room) {
  const split = splitRoomDomains(room);
  let maximum = jsonBytes({
    ...split.metadata,
    saveSchemaVersion: SAVE_SCHEMA_VERSION,
    saveStorageFormat: SAVE_STORAGE_FORMAT,
    roomContainers: split.containers,
    roomSections: split.sections.map(({ path, domain, value }) => ({
      path,
      domain,
      checksum: checksum(value),
      documentId: sectionDocumentId(path, "0"),
    })),
  });
  for (const section of split.sections) {
    const encoded = encodeSectionValue(section.path, section.domain, section.value);
    const index = buildPageIndex(encoded.pages.map(contentPageId));
    const manifest = {
      ...encoded.manifest,
      ...(index.pageCount > 0 ? {
        pageIndexFormat: PAGE_INDEX_FORMAT,
        pageIndexRootId: index.rootId,
        pageIndexDepth: index.depth,
      } : {}),
    };
    maximum = Math.max(
      maximum,
      jsonBytes(manifest),
      ...encoded.pages.map((page) => {
        const { index: _pagePosition, ...content } = page;
        return jsonBytes(content);
      }),
      ...index.nodes.map(({ node }) => jsonBytes(node)),
    );
  }
  return maximum;
}
