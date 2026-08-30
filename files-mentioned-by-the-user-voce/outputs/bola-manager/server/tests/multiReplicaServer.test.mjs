import assert from "node:assert/strict";
import test from "node:test";
import { startTestServer } from "./testHarness.mjs";

test("liveness permanece ativo quando readiness das dependencias falha", async (context) => {
  const { server, url } = await startTestServer({
    readinessCheck: async () => ({
      ok: false,
      status: "not-ready",
      dependencies: { firestore: { ok: false, status: "unavailable" } },
    }),
  });
  context.after(() => server.close());

  const live = await fetch(`${url}/health`);
  const ready = await fetch(`${url}/ready`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).status, "alive");
  assert.equal(ready.status, 503);
  assert.deepEqual((await ready.json()).dependencies.firestore, {
    ok: false,
    status: "unavailable",
  });
});

test("rate limit HTTP e compartilhado entre duas instancias", async (context) => {
  const counts = new Map();
  const rateLimiter = {
    async consume(identity, { limit }) {
      const count = (counts.get(identity) ?? 0) + 1;
      counts.set(identity, count);
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterMs: count <= limit ? 0 : 1_000,
        resetAt: new Date(Date.now() + 1_000).toISOString(),
      };
    },
  };
  const first = await startTestServer({ rateLimiter, env: { RATE_LIMIT_HTTP_MAX: "2" } });
  const second = await startTestServer({ rateLimiter, env: { RATE_LIMIT_HTTP_MAX: "2" } });
  context.after(async () => Promise.all([first.server.close(), second.server.close()]));

  assert.equal((await fetch(`${first.url}/missing`)).status, 404);
  assert.equal((await fetch(`${second.url}/missing`)).status, 404);
  const blocked = await fetch(`${first.url}/missing`);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error.code, "RATE_LIMITED");
  assert.equal(blocked.headers.get("retry-after"), "1");
});

test("graceful shutdown e idempotente", async () => {
  const { server } = await startTestServer();
  const first = server.close();
  const second = server.close();
  await Promise.all([first, second]);
});

test("shutdown forcado termina no prazo configurado", async () => {
  const brasfootImportService = { close: () => new Promise(() => {}) };
  const { server } = await startTestServer({
    brasfootImportService,
    env: { SHUTDOWN_TIMEOUT_MS: "20" },
  });
  await assert.rejects(server.close(), { code: "SHUTDOWN_TIMEOUT" });
  await assert.rejects(server.close(), { code: "SHUTDOWN_TIMEOUT" });
});
