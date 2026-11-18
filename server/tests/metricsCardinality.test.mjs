import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createHttpMetricsMiddleware, createMetricsRegistry } from "../infrastructure/observability.mjs";
import { createDistributedLock } from "../infrastructure/distributedLock.mjs";

test("milhares de salas, usuarios, eventos e erros nao criam labels livres", () => {
  const metrics = createMetricsRegistry();
  for (let i = 0; i < 10_000; i += 1) {
    metrics.increment("distributed_lock_acquired_total", 1, { resource: `match:PRIVATE-ROOM-${i}`, uid: `PRIVATE-${i}` });
    metrics.observe("socket_event_duration_ms", 2, { event: `PRIVATE-${i}`, status: "ok", token: `PRIVATE-${i}` });
    metrics.increment("match_persistence_failures_total", 1, { operation: "save", error: `PRIVATE-${i}` });
    metrics.increment(`PRIVATE-${i}`, 1, { room: i });
  }
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.registry.series, 3);
  assert.equal(snapshot.registry.droppedSamples, 10_000);
  assert.deepEqual(snapshot.counters[0].labels, { resource: "match" });
  assert.equal(snapshot.counters[0].value, 10_000);
  assert.equal(snapshot.summaries[0].count, 10_000);
  assert.equal(snapshot.summaries[0].sum, 20_000);
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
  assert.ok(JSON.stringify(snapshot).length < 1500);
});

test("teto global e por metrica descarta novas series, mas atualiza as existentes", () => {
  const metrics = createMetricsRegistry({ maxSeries: 3, maxSeriesPerMetric: 2 });
  metrics.increment("http_requests_total", 1, { status: 200 });
  metrics.increment("http_requests_total", 1, { status: 201 });
  metrics.increment("http_requests_total", 1, { status: 202 });
  metrics.setGauge("server_ready", 1);
  metrics.observe("http_request_duration_ms", 2);
  metrics.increment("http_requests_total", 5, { status: 200 });
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.registry.series, 3);
  assert.equal(snapshot.registry.droppedSamples, 2);
  assert.equal(snapshot.counters[0].value, 6);
  assert.equal(snapshot.summaries.length, 0);
  metrics.reset();
  assert.equal(metrics.snapshot().registry.series, 0);
  assert.equal(metrics.snapshot().registry.droppedSamples, 0);
  metrics.observe("http_request_duration_ms", 2);
  assert.equal(metrics.snapshot().summaries.length, 1);
});

test("limites invalidos nao desativam protecao; muitas combinacoes ficam limitadas", () => {
  for (const invalid of [0, -1, NaN, Infinity, "unlimited"]) {
    const snapshot = createMetricsRegistry({ maxSeries: invalid, maxSeriesPerMetric: invalid }).snapshot();
    assert.equal(snapshot.registry.maxSeries, 2048);
    assert.equal(snapshot.registry.maxSeriesPerMetric, 256);
  }
  const metrics = createMetricsRegistry({ maxSeries: 1e9, maxSeriesPerMetric: 1e9 });
  assert.equal(metrics.snapshot().registry.maxSeries, 4096);
  assert.equal(metrics.snapshot().registry.maxSeriesPerMetric, 512);
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    for (let status = 100; status < 600; status += 1) {
      metrics.increment("http_requests_total", 1, { method, route: "/api/rooms", status });
    }
  }
  assert.equal(metrics.snapshot().registry.series, 512);
  assert.equal(metrics.snapshot().registry.droppedSamples, 3500 - 512);
});

test("tipo, valores finitos, overflow e snapshots mutaveis nao corrompem o registro", () => {
  const metrics = createMetricsRegistry();
  for (const value of [NaN, Infinity, -Infinity, "invalid", undefined, null, {}]) metrics.observe("http_request_duration_ms", value);
  metrics.increment("event_loop_lag_ms");
  metrics.increment("socket_connections_total", -1);
  metrics.increment("socket_connections_total", Number.MAX_VALUE);
  metrics.increment("socket_connections_total", Number.MAX_VALUE);
  metrics.observe("http_request_duration_ms", Number.MAX_VALUE);
  metrics.observe("http_request_duration_ms", Number.MAX_VALUE);
  metrics.setGauge("event_loop_lag_ms", 12);
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.registry.droppedSamples, 11);
  assert.equal(snapshot.counters[0].value, Number.MAX_VALUE);
  assert.equal(snapshot.summaries[0].count, 1);
  snapshot.counters[0].labels.room = "PRIVATE";
  snapshot.summaries[0].labels.route = "PRIVATE";
  snapshot.gauges[0].value = Infinity;
  assert.ok(!JSON.stringify(metrics.snapshot()).includes("PRIVATE"));
  assert.equal(metrics.snapshot().gauges[0].value, 12);
});

test("ordem e labels desconhecidos nao duplicam series ou executam toString de objetos", () => {
  const metrics = createMetricsRegistry();
  metrics.increment("socket_events_total", 1, { event: "room:create", status: "ok", roomId: "PRIVATE" });
  metrics.increment("socket_events_total", 1, { status: "ok", event: "room:create", email: "PRIVATE" });
  metrics.increment("socket_events_total", 1, { status: { toString() { throw new Error("must not run"); } }, event: "x".repeat(10000) });
  assert.equal(metrics.snapshot().registry.series, 2);
  assert.equal(metrics.snapshot().counters[0].value, 2);
  assert.deepEqual(metrics.snapshot().counters[1].labels, { event: "other", status: "other" });
});

test("Express agrega rotas com parametros e baseUrl dinamico, queries e 404 sem vazar IDs", async (context) => {
  const metrics = createMetricsRegistry();
  const app = express();
  app.use(createHttpMetricsMiddleware(metrics));
  const router = express.Router();
  router.get("/matches/:matchId", (_request, response) => response.sendStatus(200));
  app.use("/api/rooms/:code", router);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  for (let i = 0; i < 30; i += 1) {
    await (await fetch(`${url}/api/rooms/PRIVATE-${i}/matches/PRIVATE-${i}?secret=PRIVATE`)).text();
    await (await fetch(`${url}/PRIVATE-${i}`)).text();
  }
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.registry.series, 4);
  assert.deepEqual(snapshot.counters.map((metric) => metric.labels.route).sort(), ["/api/rooms", "unmatched"]);
  assert.ok(snapshot.counters.every((metric) => metric.value === 30));
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
});

test("locks mantem chaves exclusivas e fencing; somente categorias chegam ao coletor", async () => {
  const values = new Map();
  const fences = new Map();
  const calls = [];
  const client = {
    async set(key, owner) { if (values.has(key)) return null; values.set(key, owner); return "OK"; },
    async incr(key) { const next = (fences.get(key) ?? 0) + 1; fences.set(key, next); return next; },
    async eval(script, { keys: [key], arguments: [owner] }) {
      if (values.get(key) !== owner) return 0;
      if (script.includes("lock:release")) values.delete(key);
      return 1;
    },
  };
  const metrics = Object.fromEntries(["increment", "observe"].map((type) => [type, (...args) => calls.push(args)]));
  const locks = createDistributedLock({ client, metrics, defaultWaitTimeoutMs: 0 });
  const first = await locks.acquire("match:PRIVATE-A");
  const second = await locks.acquire("match:PRIVATE-B");
  assert.notEqual(first.key, second.key);
  await first.renew();
  await assert.rejects(locks.acquire("match:PRIVATE-A"), { code: "DISTRIBUTED_LOCK_TIMEOUT" });
  await first.release();
  const renewed = await locks.acquire("match:PRIVATE-A");
  assert.equal(renewed.fencingToken, first.fencingToken + 1);
  values.delete(second.key);
  await assert.rejects(second.renew(), { code: "DISTRIBUTED_LOCK_LOST" });
  await renewed.release();
  assert.ok(!JSON.stringify(calls).includes("PRIVATE"));
  assert.ok(calls.every(([, , labels]) => labels.resource === "match"));
});
