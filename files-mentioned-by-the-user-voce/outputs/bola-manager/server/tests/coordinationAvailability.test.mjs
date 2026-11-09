import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import { Adapter } from "socket.io-adapter";
import { createBolaManagerServer } from "../index.mjs";
import { createDisabledRedisRuntime } from "../infrastructure/redisRuntime.mjs";
import { registerSafe } from "../sockets/helpers.mjs";
import { createCoordinationGuard } from "../infrastructure/coordinationAvailability.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";
import { fakeFirebase, jsonRequest, startTestServer } from "./testHarness.mjs";

function runtime(values = new Map()) {
  const command = {
    isReady: true,
    failure: false,
    async ping() { return "PONG"; },
    async set(key, value, { NX } = {}) {
      if (this.failure) throw new Error("redis://internal:secret@private:6379 unavailable");
      if (NX && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async incr(key) { const next = Number(values.get(key) ?? 0) + 1; values.set(key, next); return next; },
    async eval(script, { keys: [key], arguments: args }) {
      if (this.failure) throw new Error("redis://internal:secret@private:6379 unavailable");
      if (script.includes("rate-limit:fixed-window")) return [await this.incr(key), Number(args[1])];
      if (values.get(key) !== args[0]) return 0;
      if (script.includes("lock:release")) values.delete(key);
      return 1;
    },
  };
  return {
    enabled: true, client: command, publisher: { isReady: true }, subscriber: { isReady: true },
    async ping() { return { ok: this.client.isReady && this.publisher.isReady && this.subscriber.isReady }; },
    async close() {},
  };
}

async function start(context, redisRuntime, env = {}) {
  // Sem store injetado: executa a exigencia real de coordenacao em producao.
  const server = await createBolaManagerServer({
    env: { NODE_ENV: "production", ROOM_STORE: "firestore", CLIENT_ORIGIN: "https://test.example", ...env },
    firebase: fakeFirebase({ firestore: createFakeFirestore() }), redisRuntime,
    socketAdapterFactory: () => Adapter,
    logger: { error() {}, warn() {}, info() {} },
  });
  context.after(() => server.close());
  await new Promise((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}

function connect(context, url) {
  const client = createClient(url, { transports: ["websocket"], auth: { token: "owner-token" }, reconnection: false, forceNew: true, timeout: 1_000 });
  context.after(() => client.disconnect());
  return new Promise((resolve, reject) => {
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

test("producao sem Redis: HTTP 503 e handshake rejeitado antes dos handlers", async (context) => {
  const { server, url } = await start(context, createDisabledRedisRuntime("failed"));
  let reached = 0;
  server.store.joinRoom = async () => { reached += 1; };
  await assert.rejects(connect(context, url), (error) => error.data?.code === "REDIS_REQUIRED" && !/secret|6379/.test(error.message));
  const response = await jsonRequest(`${url}/api/rooms`, "owner-token");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "REDIS_REQUIRED");
  assert.equal(reached, 0);
  assert.equal(server.io.of("/").sockets.size, 0);
});

test("Redis obrigatorio cai apos conectar: comandos e HTTP bloqueados, recuperacao funciona", async (context) => {
  const redis = runtime();
  const { server, url } = await start(context, redis);
  const client = await connect(context, url);
  const created = await client.timeout(1_000).emitWithAck("room:create", { name: "Segura" });
  assert.equal(created.ok, true, JSON.stringify(created));
  let reached = 0;
  const original = server.store.requireViewerRoom.bind(server.store);
  server.store.requireViewerRoom = async (...args) => { reached += 1; return original(...args); };
  for (const role of ["client", "publisher", "subscriber"]) {
    redis[role].isReady = false;
    const result = await client.timeout(1_000).emitWithAck("room:sync", { code: created.room.code });
    assert.equal(result.error.code, "REDIS_REQUIRED");
    assert.equal(reached, 0);
    assert.equal((await jsonRequest(`${url}/api/rooms`, "owner-token")).status, 503);
    await assert.rejects(connect(context, url), (error) => error.data?.code === "REDIS_REQUIRED");
    redis[role].isReady = true;
  }
  redis.client.failure = true;
  const failedCommand = await client.timeout(1_000).emitWithAck("room:sync", { code: created.room.code });
  assert.equal(failedCommand.error.code, "REDIS_REQUIRED");
  assert.equal(/secret|private|6379/.test(JSON.stringify(failedCommand)), false);
  assert.equal(reached, 0);
  await assert.rejects(connect(context, url), (error) => error.data?.code === "REDIS_REQUIRED" && !/secret|6379/.test(error.message));
  const failedHttp = await jsonRequest(`${url}/api/rooms`, "owner-token");
  assert.equal(failedHttp.status, 503);
  assert.equal(/secret|private|6379/.test(await failedHttp.text()), false);
  redis.client.failure = false;
  assert.equal((await client.timeout(1_000).emitWithAck("room:sync", { code: created.room.code })).ok, true);
  assert.equal(reached, 1);
});

test("duas replicas usam os mesmos contadores e exclusao mutua sem fallback local", async (context) => {
  const shared = new Map();
  const first = await start(context, runtime(shared), { RATE_LIMIT_SOCKET_MAX: "2" });
  const second = await start(context, runtime(shared), { RATE_LIMIT_SOCKET_MAX: "2" });
  const left = await connect(context, first.url);
  const right = await connect(context, second.url);
  assert.equal((await left.timeout(1_000).emitWithAck("room:create", { name: "Primeira" })).ok, true);
  assert.equal((await right.timeout(1_000).emitWithAck("room:create", { name: "Segunda" })).ok, true);
  const third = await left.timeout(1_000).emitWithAck("room:create", { name: "Bloqueado" });
  assert.equal(third.error.code, "RATE_LIMITED");
  const held = await first.server.distributedLocks.acquire("security-test", { waitTimeoutMs: 0 });
  await assert.rejects(second.server.distributedLocks.acquire("security-test", { waitTimeoutMs: 0 }), { code: "DISTRIBUTED_LOCK_TIMEOUT" });
  await held.release();
  const next = await second.server.distributedLocks.acquire("security-test", { waitTimeoutMs: 0 });
  assert.ok(next.fencingToken > held.fencingToken);
  await next.release();
});

test("comando encaminhado revalida coordenacao apos autorizacao assincrona", async () => {
  const redis = runtime();
  const guard = createCoordinationGuard({ required: true, runtime: redis, locks: { acquire() {} }, rateLimiter: { consume() {} } });
  let handler;
  let reached = 0;
  const proxy = {
    data: { assertCoordinationAvailable: guard, async authorize() { redis.subscriber.isReady = false; } },
    on(_event, callback) { handler = callback; },
  };
  registerSafe(proxy, "match:sync", async () => { reached += 1; });
  const response = await new Promise((resolve) => handler({}, resolve));
  assert.equal(response.error.code, "REDIS_REQUIRED");
  assert.equal(reached, 0);
});

test("runtime pronto nao dispensa locks e rate limiter obrigatorios", () => {
  const redis = runtime();
  const locks = { acquire() {} };
  const rateLimiter = { consume() {} };
  for (const missing of [{ locks: null, rateLimiter }, { locks, rateLimiter: null }]) {
    assert.throws(createCoordinationGuard({ required: true, runtime: redis, ...missing }), { code: "REDIS_REQUIRED" });
  }
});

for (const nodeEnv of ["development", "test"]) {
  test(`${nodeEnv} sem Redis obrigatorio preserva funcionamento local`, async (context) => {
    const { server, url } = await startTestServer({ env: { NODE_ENV: nodeEnv }, redisRuntime: createDisabledRedisRuntime() });
    context.after(() => server.close());
    const client = await connect(context, url);
    assert.equal((await client.timeout(1_000).emitWithAck("room:create", { name: "Local" })).ok, true);
  });
}
