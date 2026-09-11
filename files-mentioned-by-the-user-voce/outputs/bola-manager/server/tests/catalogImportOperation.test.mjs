import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../../src/lib/catalogImportOperation.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { getCatalogImportOperation, completeCatalogImportOperation } = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("cliente reutiliza ID pendente por conta/conteudo mesmo apos reselecao e reload", async () => {
  const persisted = storage();
  const first = await getCatalogImportOperation("owner", new Blob(['{"database":1}']), persisted);
  const retry = await getCatalogImportOperation("owner", new Blob(['{"database":1}']), { ...persisted });
  assert.deepEqual(first, retry);
  assert.notEqual((await getCatalogImportOperation("other", new Blob(['{"database":1}']), persisted)).operationId, first.operationId);
  assert.notEqual((await getCatalogImportOperation("owner", new Blob(['{"database":2}']), persisted)).operationId, first.operationId);
});

test("confirmacao libera nova importacao intencional sem apagar outra operacao", async () => {
  const persisted = storage();
  const file = new Blob(["base"]);
  const first = await getCatalogImportOperation("owner", file, persisted);
  completeCatalogImportOperation(first, persisted);
  const second = await getCatalogImportOperation("owner", file, persisted);
  assert.notEqual(first.operationId, second.operationId);
  completeCatalogImportOperation(first, persisted);
  assert.equal(persisted.getItem(second.key), second.operationId);
});

test("falha ao persistir ID interrompe fluxo antes do upload", async () => {
  await assert.rejects(getCatalogImportOperation("owner", new Blob(["base"]), {
    getItem: () => null, setItem: () => { throw new Error("armazenamento bloqueado"); },
  }), /armazenamento bloqueado/);
});

test("arquivo excessivo e recusado antes de ler conteudo", async () => {
  await assert.rejects(getCatalogImportOperation("owner", {
    size: 24 * 1024 * 1024 + 1,
    arrayBuffer() { assert.fail("nao deveria ler arquivo excessivo"); },
  }, storage()), /24 MB/);
});

test("hook so confirma importacao depois do reload; falha reutiliza ID na nova tentativa", async () => {
  const hookSource = await readFile(new URL("../../src/hooks/useEditorCatalog.ts", import.meta.url), "utf8");
  const hookCode = ts.transpileModule(hookSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const persisted = storage();
  let failReload = true;
  const uploadedIds = [];
  const imports = {
    react: {
      useCallback: (callback) => callback,
      useMemo: (callback) => callback(),
      useEffect() {},
      useRef: (current) => ({ current }),
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    },
    "../lib/apiClient": {
      ApiError: class extends Error {},
      async apiBinaryUpload(url) {
        uploadedIds.push(new URL(url, "https://localhost").searchParams.get("operationId"));
        return { imported: true };
      },
      async apiRequest() {
        if (failReload) throw new Error("reload indisponivel");
        return { leagues: [], clubs: [], players: [], tournaments: [] };
      },
    },
    "../lib/catalogImportOperation": {
      getCatalogImportOperation: (owner, file) => getCatalogImportOperation(owner, file, persisted),
      completeCatalogImportOperation: (operation) => completeCatalogImportOperation(operation, persisted),
    },
    "../utils/playerRating": {},
    "../utils/editorGeography": {},
  };
  const exports = {};
  new Function("require", "exports", hookCode)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Dependencia inesperada: ${name}`);
    return imports[name];
  }, exports);
  const credentials = { identity: { uid: "owner" }, getIdToken: async () => "token" };
  const hook = exports.useEditorCatalog(credentials);
  await assert.rejects(hook.importDatabase(new Blob(["base"])), /reload indisponivel/);
  failReload = false;
  const remounted = exports.useEditorCatalog(credentials);
  await remounted.importDatabase(new Blob(["base"]));
  assert.equal(uploadedIds[0], uploadedIds[1]);
  await remounted.importDatabase(new Blob(["base"]));
  assert.notEqual(uploadedIds[1], uploadedIds[2]);
});
