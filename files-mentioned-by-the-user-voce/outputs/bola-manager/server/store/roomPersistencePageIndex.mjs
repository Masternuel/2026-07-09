import { createHash } from "node:crypto";

export const PAGE_INDEX_FORMAT = "content-page-index-v1";
export const PAGE_INDEX_FANOUT = 64;

function indexError(code, message, status = 500, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalJson(value) {
  const serialized = JSON.stringify(canonicalValue(value));
  if (serialized === undefined) {
    throw indexError("SAVE_SECTION_INVALID", "Indice de paginas invalido");
  }
  return serialized;
}

function normalizeContentPageId(value, label = "pagina", code = "SAVE_SECTION_INVALID") {
  const id = String(value ?? "").trim().toLocaleLowerCase("en-US");
  if (!/^[a-f0-9]{64}$/.test(id)) {
    throw indexError(code, `Identificador de ${label} invalido`);
  }
  return id;
}

function assertSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw indexError("SAVE_DOCUMENT_CORRUPT", `${label} invalido no indice de paginas`);
  }
  return value;
}

export function pageIndexNodeId(node) {
  return createHash("sha256").update(canonicalJson(node)).digest("hex");
}

export function validatePageIndexDescriptor(descriptor) {
  if (!isPlainObject(descriptor)) {
    throw indexError("SAVE_DOCUMENT_CORRUPT", "Descritor do indice de paginas ausente");
  }
  const pageCount = assertSafeInteger(descriptor.pageCount, "Quantidade de paginas");
  const depth = assertSafeInteger(descriptor.depth, "Profundidade");
  if (pageCount === 0) {
    if (depth !== 0 || (descriptor.rootId !== null && descriptor.rootId !== undefined)) {
      throw indexError("SAVE_DOCUMENT_CORRUPT", "Indice vazio possui raiz ou profundidade invalida");
    }
    return { rootId: null, depth: 0, pageCount: 0 };
  }
  if (depth < 1) {
    throw indexError("SAVE_DOCUMENT_CORRUPT", "Indice preenchido sem profundidade valida");
  }
  return {
    rootId: normalizeContentPageId(descriptor.rootId, "raiz do indice", "SAVE_DOCUMENT_CORRUPT"),
    depth,
    pageCount,
  };
}

export function validatePageIndexNode(node, expected = {}) {
  if (!isPlainObject(node) || node.format !== PAGE_INDEX_FORMAT) {
    throw indexError("SAVE_DOCUMENT_CORRUPT", "Documento do indice de paginas invalido");
  }
  const level = assertSafeInteger(node.level, "Nivel");
  const startIndex = assertSafeInteger(node.startIndex, "Indice inicial");
  const pageCount = assertSafeInteger(node.pageCount, "Quantidade de paginas", 1);
  const kind = String(node.kind ?? "");

  if (kind === "leaf") {
    if (level !== 0 || !Array.isArray(node.pageIds)
      || node.pageIds.length < 1 || node.pageIds.length > PAGE_INDEX_FANOUT
      || node.pageIds.length !== pageCount || node.children !== undefined) {
      throw indexError("SAVE_DOCUMENT_CORRUPT", "Folha do indice de paginas corrompida");
    }
    for (const id of node.pageIds) normalizeContentPageId(id, "pagina", "SAVE_DOCUMENT_CORRUPT");
  } else if (kind === "branch") {
    if (level < 1 || !Array.isArray(node.children)
      || node.children.length < 1 || node.children.length > PAGE_INDEX_FANOUT
      || node.pageIds !== undefined) {
      throw indexError("SAVE_DOCUMENT_CORRUPT", "Ramo do indice de paginas corrompido");
    }
    let cursor = startIndex;
    for (const child of node.children) {
      if (!isPlainObject(child)) {
        throw indexError("SAVE_DOCUMENT_CORRUPT", "Referencia filha do indice invalida");
      }
      normalizeContentPageId(child.id, "no filho", "SAVE_DOCUMENT_CORRUPT");
      const childStart = assertSafeInteger(child.startIndex, "Indice inicial filho");
      const childCount = assertSafeInteger(child.pageCount, "Quantidade de paginas filha", 1);
      if (childStart !== cursor) {
        throw indexError("SAVE_DOCUMENT_CORRUPT", "Filhos do indice nao cobrem paginas contiguas");
      }
      cursor += childCount;
      if (!Number.isSafeInteger(cursor)) {
        throw indexError("SAVE_DOCUMENT_CORRUPT", "Quantidade de paginas excede limite numerico seguro");
      }
    }
    if (cursor !== startIndex + pageCount) {
      throw indexError("SAVE_DOCUMENT_CORRUPT", "Contagem do ramo do indice nao confere");
    }
  } else {
    throw indexError("SAVE_DOCUMENT_CORRUPT", "Tipo de no do indice desconhecido");
  }

  if (expected.id !== undefined
    && pageIndexNodeId(node) !== normalizeContentPageId(expected.id, "no esperado", "SAVE_DOCUMENT_CORRUPT")) {
    throw indexError("SAVE_DOCUMENT_CORRUPT", "Checksum do indice de paginas nao confere");
  }
  if (expected.level !== undefined && level !== Number(expected.level)) {
    throw indexError("SAVE_DOCUMENT_CORRUPT", "Nivel do indice de paginas nao confere");
  }
  if (expected.startIndex !== undefined && startIndex !== Number(expected.startIndex)) {
    throw indexError("SAVE_DOCUMENT_CORRUPT", "Posicao do indice de paginas nao confere");
  }
  if (expected.pageCount !== undefined && pageCount !== Number(expected.pageCount)) {
    throw indexError("SAVE_DOCUMENT_CORRUPT", "Tamanho do indice de paginas nao confere");
  }

  return {
    ...node,
    level,
    startIndex,
    pageCount,
    ...(kind === "leaf"
      ? { pageIds: node.pageIds.map((id) => normalizeContentPageId(id, "pagina", "SAVE_DOCUMENT_CORRUPT")) }
      : {
          children: node.children.map((child) => ({
            id: normalizeContentPageId(child.id, "no filho", "SAVE_DOCUMENT_CORRUPT"),
            startIndex: child.startIndex,
            pageCount: child.pageCount,
          })),
        }),
  };
}

function storeNode(nodes, node) {
  const id = pageIndexNodeId(node);
  const previous = nodes.get(id);
  if (previous && canonicalJson(previous) !== canonicalJson(node)) {
    throw indexError("SAVE_DOCUMENT_CORRUPT", "Colisao no indice de paginas");
  }
  nodes.set(id, node);
  return { id, startIndex: node.startIndex, pageCount: node.pageCount, level: node.level };
}

export function buildPageIndex(contentPageIds) {
  if (!Array.isArray(contentPageIds)) {
    throw indexError("SAVE_SECTION_INVALID", "Lista de paginas do indice invalida", 400);
  }
  const pageIds = contentPageIds.map((id) => normalizeContentPageId(id));
  if (pageIds.length === 0) {
    return { rootId: null, depth: 0, pageCount: 0, nodes: [] };
  }

  const nodes = new Map();
  let currentLevel = [];
  for (let offset = 0; offset < pageIds.length; offset += PAGE_INDEX_FANOUT) {
    const ids = pageIds.slice(offset, offset + PAGE_INDEX_FANOUT);
    currentLevel.push(storeNode(nodes, {
      format: PAGE_INDEX_FORMAT,
      kind: "leaf",
      level: 0,
      startIndex: offset,
      pageCount: ids.length,
      pageIds: ids,
    }));
  }

  while (currentLevel.length > 1) {
    const nextLevel = [];
    for (let offset = 0; offset < currentLevel.length; offset += PAGE_INDEX_FANOUT) {
      const group = currentLevel.slice(offset, offset + PAGE_INDEX_FANOUT);
      const first = group[0];
      const last = group.at(-1);
      const pageCount = (last.startIndex + last.pageCount) - first.startIndex;
      nextLevel.push(storeNode(nodes, {
        format: PAGE_INDEX_FORMAT,
        kind: "branch",
        level: first.level + 1,
        startIndex: first.startIndex,
        pageCount,
        children: group.map(({ id, startIndex, pageCount: childPageCount }) => ({
          id,
          startIndex,
          pageCount: childPageCount,
        })),
      }));
    }
    currentLevel = nextLevel;
  }

  const root = currentLevel[0];
  return {
    rootId: root.id,
    depth: root.level + 1,
    pageCount: pageIds.length,
    nodes: [...nodes.entries()].map(([id, node]) => ({ id, node })),
  };
}

async function loadValidatedNode(loadNode, expected) {
  if (typeof loadNode !== "function") {
    throw indexError("SAVE_SECTION_INVALID", "Carregador do indice de paginas invalido", 400);
  }
  const node = await loadNode(expected.id);
  if (node === null || node === undefined) {
    throw indexError("SAVE_INCOMPLETE", "Save incompleto: no do indice de paginas ausente");
  }
  return validatePageIndexNode(node, expected);
}

async function loadValidatedNodes(expectations, loadNode, loadNodes) {
  if (expectations.length === 0) return [];
  if (typeof loadNodes !== "function") {
    return Promise.all(expectations.map((expected) => loadValidatedNode(loadNode, expected)));
  }
  const values = await loadNodes(expectations.map(({ id }) => id));
  if (!Array.isArray(values) || values.length !== expectations.length) {
    throw indexError("SAVE_INCOMPLETE", "Save incompleto: lote do indice de paginas invalido");
  }
  return values.map((node, index) => {
    if (node === null || node === undefined) {
      throw indexError("SAVE_INCOMPLETE", "Save incompleto: no do indice de paginas ausente");
    }
    return validatePageIndexNode(node, expectations[index]);
  });
}

function rootExpectation(descriptor) {
  return {
    id: descriptor.rootId,
    level: descriptor.depth - 1,
    startIndex: 0,
    pageCount: descriptor.pageCount,
  };
}

export async function resolvePageGraph(descriptorInput, loadNode, loadNodes = null) {
  const descriptor = validatePageIndexDescriptor(descriptorInput);
  if (descriptor.pageCount === 0) return { pageIds: [], nodeIds: [] };

  const visited = new Set();
  const pageIds = [];
  let pending = [rootExpectation(descriptor)];
  while (pending.length > 0) {
    for (const expected of pending) {
      if (visited.has(expected.id)) {
        throw indexError("SAVE_DOCUMENT_CORRUPT", "Indice de paginas contem referencia duplicada");
      }
      visited.add(expected.id);
    }
    const nodes = await loadValidatedNodes(pending, loadNode, loadNodes);
    const next = [];
    for (const node of nodes) {
      if (node.kind === "leaf") {
        pageIds.push(...node.pageIds);
        continue;
      }
      next.push(...node.children.map((child) => ({
        id: child.id,
        level: node.level - 1,
        startIndex: child.startIndex,
        pageCount: child.pageCount,
      })));
    }
    pending = next;
  }
  if (pageIds.length !== descriptor.pageCount) {
    throw indexError("SAVE_INCOMPLETE", "Save incompleto: paginas do indice nao conferem");
  }
  return { pageIds, nodeIds: [...visited] };
}

export async function resolveAllPageIds(descriptorInput, loadNode, loadNodes = null) {
  const { pageIds } = await resolvePageGraph(descriptorInput, loadNode, loadNodes);
  return pageIds;
}

/**
 * Streams a validated Merkle page graph without retaining every node/page ID.
 * Node levels strictly decrease and child ranges are validated by
 * validatePageIndexNode, so cycles and overlapping coverage cannot form a
 * valid graph without a global visited set.
 */
export async function* iteratePageGraph(descriptorInput, loadNode) {
  const descriptor = validatePageIndexDescriptor(descriptorInput);
  if (descriptor.pageCount === 0) return;

  let resolvedPageCount = 0;
  const pending = [rootExpectation(descriptor)];
  while (pending.length > 0) {
    const expected = pending.pop();
    const node = await loadValidatedNode(loadNode, expected);
    yield { type: "node", id: expected.id };
    if (node.kind === "leaf") {
      resolvedPageCount += node.pageIds.length;
      for (const id of node.pageIds) yield { type: "page", id };
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      pending.push({
        id: child.id,
        level: node.level - 1,
        startIndex: child.startIndex,
        pageCount: child.pageCount,
      });
    }
  }
  if (resolvedPageCount !== descriptor.pageCount) {
    throw indexError("SAVE_INCOMPLETE", "Save incompleto: paginas do indice nao conferem");
  }
}

export async function resolvePageIdAt(descriptorInput, pageIndex, loadNode) {
  const descriptor = validatePageIndexDescriptor(descriptorInput);
  const index = Number(pageIndex);
  if (!Number.isSafeInteger(index) || index < 0 || index >= descriptor.pageCount) {
    throw indexError("SAVE_PAGE_OUT_OF_RANGE", "Pagina solicitada fora do intervalo", 404, {
      page: pageIndex,
      pageCount: descriptor.pageCount,
    });
  }

  let expected = rootExpectation(descriptor);
  while (true) {
    const node = await loadValidatedNode(loadNode, expected);
    if (node.kind === "leaf") {
      const pageId = node.pageIds[index - node.startIndex];
      if (!pageId) {
        throw indexError("SAVE_INCOMPLETE", "Save incompleto: pagina ausente no indice");
      }
      return pageId;
    }
    const child = node.children.find((candidate) => (
      index >= candidate.startIndex && index < candidate.startIndex + candidate.pageCount
    ));
    if (!child) {
      throw indexError("SAVE_DOCUMENT_CORRUPT", "Indice nao referencia pagina solicitada");
    }
    expected = {
      id: child.id,
      level: node.level - 1,
      startIndex: child.startIndex,
      pageCount: child.pageCount,
    };
  }
}
