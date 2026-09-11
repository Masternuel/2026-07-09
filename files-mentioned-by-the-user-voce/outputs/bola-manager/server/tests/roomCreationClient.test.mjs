import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../../src/lib/roomCreationOperation.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
const { createRoomOnce } = await import(moduleUrl);
const payload = { name: "Minha sala", activeLeagues: ["BR-B", "BR-A"] };
const room = { id: "room-1", code: "BOLA-0001" };
function storage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key), data };
}

test("cliente: cliques concorrentes compartilham promessa e uma unica emissao", async () => {
  const persisted = storage();
  let calls = 0;
  const send = async (body) => {
    calls++;
    assert.equal(persisted.data.values().next().value, body.operationId);
    assert.equal(body.requestId, body.operationId);
    return room;
  };
  const first = createRoomOnce("owner", payload, send, persisted);
  const second = createRoomOnce("owner", { ...payload, activeLeagues: ["BR-A", "BR-B"] }, send, persisted);
  assert.equal(first, second);
  assert.equal(await first, room);
  assert.equal(calls, 1);
  assert.equal(persisted.data.size, 0);
});

for (const code of ["SOCKET_ACK_TIMEOUT", "SOCKET_DISCONNECTED", "SERVER_ERROR"]) {
  test(`cliente: ${code} preserva ID; reload/reconnect reenvia mesma operacao`, async () => {
    const persisted = storage();
    let original;
    await assert.rejects(createRoomOnce("owner", payload, async (body) => {
      original = body.operationId;
      throw Object.assign(new Error(code), { code });
    }, persisted), { code });
    const reloaded = await import(`${moduleUrl}#${code}`);
    await reloaded.createRoomOnce("owner", payload, async (body) => {
      assert.equal(body.operationId, original);
      return room;
    }, persisted);
    assert.equal(persisted.data.size, 0);
  });
}

test("cliente: sucesso permite criacao intencional; payload e contas isolados", async () => {
  const persisted = storage();
  const ids = [];
  const send = async (body) => { ids.push(body.operationId); return room; };
  await createRoomOnce("owner", payload, send, persisted);
  await createRoomOnce("owner", payload, send, persisted);
  await createRoomOnce("other-owner", payload, send, persisted);
  await createRoomOnce("owner", { ...payload, name: "Outra sala" }, send, persisted);
  assert.equal(new Set(ids).size, 4);
});

test("cliente: falha de armazenamento bloqueia envio; nao degrada para ID volatil", () => {
  let calls = 0;
  assert.throws(() => createRoomOnce("owner", payload, async () => { calls++; return room; }, {
    getItem: () => null, setItem: () => { throw new Error("storage bloqueado"); }, removeItem() {},
  }), /storage bloqueado/);
  assert.equal(calls, 0);
});

test("cliente: IDs explicitos distintos nao sao fundidos nem apagados por resposta antiga", async () => {
  const persisted = storage();
  let release;
  const first = createRoomOnce("owner", { ...payload, operationId: "first" },
    () => new Promise((resolve) => { release = resolve; }), persisted);
  const second = createRoomOnce("owner", { ...payload, operationId: "second" },
    async () => { throw new Error("timeout"); }, persisted);
  await assert.rejects(second, /timeout/);
  release(room);
  await first;
  assert.equal([...persisted.data.values()][0], "second");
});

test("cliente: sala excluida libera nova tentativa intencional, sem retry automatico", async () => {
  const persisted = storage();
  let original;
  await assert.rejects(createRoomOnce("owner", payload, async (body) => {
    original = body.operationId;
    throw Object.assign(new Error("Sala excluida"), { code: "ROOM_CREATION_GONE" });
  }, persisted), { code: "ROOM_CREATION_GONE" });
  await createRoomOnce("owner", payload, async (body) => {
    assert.notEqual(body.operationId, original);
    return room;
  }, persisted);
});

test("hook integra a operacao persistente por identidade antes de room:create", async () => {
  const hookSource = await readFile(new URL("../../src/hooks/useRoom.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(hookSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sent = [];
  const imports = {
    react: { useCallback: (fn) => fn, useEffect() {}, useRef: (value) => ({ current: value }),
      useState: (value) => [value, () => {}] },
    './useAuth': { useAuth: () => ({ identity: { mode: 'firebase', uid: 'u1' }, getIdToken() {} }) },
    '../lib/apiClient': { ApiError: class extends Error {}, apiRequest() {} },
    '../lib/socketRequest': { SocketRequestError: class extends Error {},
      emitSocketRequest: async (_socket, event, body) => { sent.push({ event, body }); return { room }; } },
    '../lib/roomCreationOperation': { createRoomOnce: async (account, body, send) => {
      assert.equal(account, 'firebase:u1'); return send({ ...body, operationId: 'persistent-id' });
    } },
    '../utils/normalizeRoom': { normalizeRoomSnapshot: (value) => value, normalizeRoomSnapshots: (value) => value },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    assert.ok(imports[id], `Import inesperado: ${id}`); return imports[id];
  }, module, module.exports);
  const hook = module.exports.useRoom({ connected: true }, 'connected');
  await hook.createRoom(payload);
  assert.equal(sent[0].event, 'room:create');
  assert.equal(sent[0].body.operationId, 'persistent-id');
});
