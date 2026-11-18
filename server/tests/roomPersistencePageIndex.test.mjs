import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PAGE_INDEX_FANOUT,
  buildPageIndex,
  iteratePageGraph,
  pageIndexNodeId,
  resolveAllPageIds,
  resolvePageGraph,
  resolvePageIdAt,
  validatePageIndexNode,
} from "../store/roomPersistencePageIndex.mjs";

function pageId(index) {
  return createHash("sha256").update(`content-page-${index}`).digest("hex");
}

function loaderFor(index, omitted = new Set()) {
  const documents = new Map(index.nodes.map(({ id, node }) => [id, structuredClone(node)]));
  for (const id of omitted) documents.delete(id);
  return {
    documents,
    load: async (id) => structuredClone(documents.get(id) ?? null),
  };
}

test("constroi indice Merkle deterministico com documentos limitados", async () => {
  const ids = Array.from({ length: 20_000 }, (_, index) => pageId(index));
  const first = buildPageIndex(ids);
  const second = buildPageIndex(ids);

  assert.equal(first.rootId, second.rootId);
  assert.equal(first.depth, 3);
  assert.equal(first.pageCount, ids.length);
  assert.deepEqual(first.nodes, second.nodes);
  assert.ok(first.nodes.length > Math.ceil(ids.length / PAGE_INDEX_FANOUT));
  for (const { id, node } of first.nodes) {
    assert.equal(pageIndexNodeId(node), id);
    assert.ok((node.pageIds ?? node.children).length <= PAGE_INDEX_FANOUT);
    assert.ok(Buffer.byteLength(JSON.stringify(node), "utf8") < 16_000);
    validatePageIndexNode(node, { id });
  }

  const { load } = loaderFor(first);
  assert.deepEqual(await resolveAllPageIds(first, load), ids);
  const graph = await resolvePageGraph(first, load);
  assert.deepEqual(graph.pageIds, ids);
  assert.deepEqual(new Set(graph.nodeIds), new Set(first.nodes.map(({ id }) => id)));
  for (const page of [0, 63, 64, 4_095, 4_096, ids.length - 1]) {
    assert.equal(await resolvePageIdAt(first, page, load), ids[page]);
  }
});

test("resolve arvore completa em lotes por nivel sem consultas N+1", async () => {
  const ids = Array.from({ length: 20_000 }, (_, index) => pageId(index));
  const index = buildPageIndex(ids);
  const { documents } = loaderFor(index);
  let batches = 0;
  const resolved = await resolveAllPageIds(
    index,
    async () => assert.fail("loader individual nao deve ser usado"),
    async (nodeIds) => {
      batches += 1;
      return nodeIds.map((id) => structuredClone(documents.get(id) ?? null));
    },
  );
  assert.deepEqual(resolved, ids);
  assert.equal(batches, index.depth);
});

test("percorre indice grande em stream sem materializar o grafo", async () => {
  const ids = Array.from({ length: 20_000 }, (_, index) => pageId(index));
  const index = buildPageIndex(ids);
  const { load } = loaderFor(index);
  const resolvedPages = [];
  const resolvedNodes = [];
  for await (const entry of iteratePageGraph(index, load)) {
    if (entry.type === "page") resolvedPages.push(entry.id);
    else resolvedNodes.push(entry.id);
  }
  assert.deepEqual(resolvedPages, ids);
  assert.deepEqual(new Set(resolvedNodes), new Set(index.nodes.map(({ id }) => id)));
});

test("append reutiliza nos imutaveis fora do caminho alterado", () => {
  const before = buildPageIndex(Array.from({ length: 5_000 }, (_, index) => pageId(index)));
  const after = buildPageIndex(Array.from({ length: 5_001 }, (_, index) => pageId(index)));
  const beforeIds = new Set(before.nodes.map(({ id }) => id));
  const reused = after.nodes.filter(({ id }) => beforeIds.has(id));

  assert.ok(reused.length >= before.nodes.length - before.depth);
  assert.notEqual(after.rootId, before.rootId);
});

test("indice vazio nao cria documentos e rejeita pagina", async () => {
  const index = buildPageIndex([]);
  assert.deepEqual(index, { rootId: null, depth: 0, pageCount: 0, nodes: [] });
  assert.deepEqual(await resolveAllPageIds(index, async () => assert.fail("nao deve carregar")), []);
  await assert.rejects(resolvePageIdAt(index, 0, async () => null), { code: "SAVE_PAGE_OUT_OF_RANGE" });
});

test("detecta no ausente e conteudo adulterado", async (t) => {
  const index = buildPageIndex(Array.from({ length: 200 }, (_, page) => pageId(page)));
  const root = index.nodes.find(({ id }) => id === index.rootId).node;

  await t.test("ausente", async () => {
    const missingId = root.children[0].id;
    const { load } = loaderFor(index, new Set([missingId]));
    await assert.rejects(resolveAllPageIds(index, load), { code: "SAVE_INCOMPLETE" });
  });

  await t.test("adulterado", async () => {
    const { documents, load } = loaderFor(index);
    const changed = structuredClone(documents.get(index.rootId));
    changed.pageCount -= 1;
    documents.set(index.rootId, changed);
    await assert.rejects(resolveAllPageIds(index, load), { code: "SAVE_DOCUMENT_CORRUPT" });
  });
});

test("detecta ramo que aponta para subarvore em posicao errada", async () => {
  const index = buildPageIndex(Array.from({ length: 130 }, (_, page) => pageId(page)));
  const { documents, load } = loaderFor(index);
  const originalRoot = documents.get(index.rootId);
  assert.equal(originalRoot.kind, "branch");

  const maliciousRoot = structuredClone(originalRoot);
  [maliciousRoot.children[0].id, maliciousRoot.children[1].id] = [
    maliciousRoot.children[1].id,
    maliciousRoot.children[0].id,
  ];
  const maliciousRootId = pageIndexNodeId(maliciousRoot);
  documents.set(maliciousRootId, maliciousRoot);

  const descriptor = { ...index, rootId: maliciousRootId };
  await assert.rejects(resolveAllPageIds(descriptor, load), { code: "SAVE_DOCUMENT_CORRUPT" });
  await assert.rejects(resolvePageIdAt(descriptor, 0, load), { code: "SAVE_DOCUMENT_CORRUPT" });
});

test("rejeita ids, descritores e referencias estruturais invalidos", async () => {
  assert.throws(() => buildPageIndex(["nao-e-sha256"]), { code: "SAVE_SECTION_INVALID" });
  await assert.rejects(
    resolveAllPageIds({ rootId: null, depth: 1, pageCount: 0 }, async () => null),
    { code: "SAVE_DOCUMENT_CORRUPT" },
  );
  await assert.rejects(
    resolveAllPageIds({ rootId: pageId(1), depth: 0, pageCount: 1 }, async () => null),
    { code: "SAVE_DOCUMENT_CORRUPT" },
  );
});
