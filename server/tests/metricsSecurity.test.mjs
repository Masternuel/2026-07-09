import assert from "node:assert/strict";
import test from "node:test";
import { getServerConfig } from "../config.mjs";
import { createMetricsHandler } from "../infrastructure/metricsEndpoint.mjs";
import { createMetricsRegistry } from "../infrastructure/observability.mjs";
import { startTestServer } from "./testHarness.mjs";

const TOKEN = "test-only-metrics-token-not-for-production";
const authorization = `Bearer ${TOKEN}`;

test("metrics desativado por padrao em todos os ambientes; segredo invalido falha sem vazar", () => {
  for (const NODE_ENV of ["development", "test", "production"]) {
    assert.equal(getServerConfig({ NODE_ENV }).metricsToken, "");
    assert.equal(getServerConfig({ NODE_ENV, METRICS_TOKEN: TOKEN }).metricsToken, TOKEN);
  }
  for (const METRICS_TOKEN of ["short-secret", " ", `${TOKEN} `, "a".repeat(257), `${TOKEN}\n`, "🔒".repeat(32)]) {
    assert.throws(() => getServerConfig({ METRICS_TOKEN }), (error) => {
      assert.equal(error.message, "METRICS_TOKEN deve conter 32 a 256 caracteres seguros, sem espacos");
      return true;
    });
  }
});

test("sem configuracao, metrics retorna 404 inclusive com identidade Firebase ou headers locais", async (context) => {
  const { server, url } = await startTestServer();
  context.after(() => server.close());
  for (const headers of [{}, { authorization: "Bearer admin-token" }, {
    authorization, "x-forwarded-for": "127.0.0.1", "x-user-id": "uid-admin",
  }]) {
    const result = await fetch(`${url}/metrics`, { headers });
    assert.equal(result.status, 404);
    assert.equal(result.headers.get("cache-control"), "no-store, private");
    assert.equal((await result.json()).counters, undefined);
  }
});

test("token proprio protege GET/HEAD; rejeicoes nao consultam snapshot nem vazam segredo", async (context) => {
  const metrics = createMetricsRegistry();
  const snapshot = metrics.snapshot;
  let reads = 0;
  metrics.snapshot = () => { reads += 1; return snapshot(); };
  const logs = [];
  const structuredLogger = Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [
    level, (...args) => logs.push(args),
  ]));
  const { server, url } = await startTestServer({ env: { METRICS_TOKEN: TOKEN }, metrics, structuredLogger });
  context.after(() => server.close());
  for (const header of [undefined, "Bearer owner-token", "Bearer admin-token", `Basic ${TOKEN}`,
    `Bearer ${TOKEN}wrong`, `Bearer ${TOKEN}, Bearer ${TOKEN}`, `Bearer ${"x".repeat(300)}`]) {
    const response = await fetch(`${url}/metrics?token=${TOKEN}`, {
      headers: header ? { authorization: header } : {},
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="metrics"');
    assert.ok(!JSON.stringify(await response.json()).includes(TOKEN));
  }
  assert.equal((await fetch(`${url}/metrics`, { method: "HEAD" })).status, 401);
  assert.equal(reads, 0);
  const response = await fetch(`${url}/metrics`, { headers: { authorization } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.match(response.headers.get("vary"), /Authorization/);
  const body = await response.json();
  assert.ok(Array.isArray(body.counters));
  assert.equal(body.registry.maxSeries, 2048);
  assert.ok(!JSON.stringify(body).includes(TOKEN));
  const head = await fetch(`${url}/metrics`, { method: "HEAD", headers: { authorization } });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(reads, 2);
  assert.ok(!JSON.stringify(logs).includes(TOKEN));
});

test("token de coleta nao autentica APIs; health/readiness preservados", async (context) => {
  const { server, url } = await startTestServer({
    env: { METRICS_TOKEN: TOKEN }, readinessCheck: async () => ({ ok: true, status: "ready" }),
  });
  context.after(() => server.close());
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/ready`)).status, 200);
  assert.equal((await fetch(`${url}/api/rooms`, { headers: { authorization } })).status, 401);
  const response = await fetch(`${url}/metrics`, { method: "POST", headers: { authorization } });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  const malformed = await fetch(`${url}/metrics`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "not-json",
  });
  assert.equal(malformed.status, 401, "autorizacao precede parsing do corpo");
});

function invoke(handler, { headers = {}, method = "GET" } = {}) {
  const response = {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    vary() {},
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
  handler({ headers, method }, response);
  return response;
}

test("limite de coleta tem memoria constante, renova janela e dispensa Redis/Firebase", () => {
  let time = 0;
  let snapshots = 0;
  const handler = createMetricsHandler({
    token: TOKEN, metrics: { snapshot: () => { snapshots += 1; return {}; } }, now: () => time, limit: 2,
  });
  for (let i = 0; i < 1000; i += 1) assert.equal(invoke(handler).statusCode, 401);
  assert.equal(invoke(handler, { headers: { authorization } }).statusCode, 200);
  assert.equal(invoke(handler, { headers: { authorization } }).statusCode, 200);
  const blocked = invoke(handler, { headers: { authorization } });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers["Retry-After"], 60);
  assert.equal(snapshots, 2);
  time = 60_000;
  assert.equal(invoke(handler, { headers: { authorization } }).statusCode, 200);
  assert.equal(snapshots, 3);
});

test("servidor aplica limite real de 60 coletas por minuto sem mapas por IP", async (context) => {
  const { server, url } = await startTestServer({ env: { METRICS_TOKEN: TOKEN } });
  context.after(() => server.close());
  for (let i = 0; i < 60; i += 1) {
    const response = await fetch(`${url}/metrics`, { headers: { authorization, "x-forwarded-for": `10.0.0.${i}` } });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  const response = await fetch(`${url}/metrics`, { headers: { authorization } });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal((await fetch(`${url}/health`)).status, 200);
});
