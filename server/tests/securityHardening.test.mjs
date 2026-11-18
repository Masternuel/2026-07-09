import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { io } from "socket.io-client";
import { getServerConfig } from "../config.mjs";
import { RoomError } from "../store/roomStore.mjs";
import { publicError, correlationId } from "../infrastructure/publicErrors.mjs";
import { createOriginPolicy, parseTrustedProxies } from "../infrastructure/networkPolicy.mjs";
import { redactLogValue, stringifyRedacted } from "../infrastructure/redaction.mjs";
import { createStructuredLogger } from "../infrastructure/observability.mjs";
import { registerSafe } from "../sockets/helpers.mjs";
import { startTestServer } from "./testHarness.mjs";

const requestId = "security-regression-123";
const synthetic = "synthetic-private-value";
const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";
const sourceError = () => Object.assign(new Error(`Firestore bucket private-bucket /srv/private/file.mjs Redis EVAL redis://user:${synthetic}@private:6379 Cloudinary api_secret=${synthetic}`), {
  code: "INTERNAL_PROVIDER_ERROR", details: { path: "/srv/private/file.mjs", token: synthetic }, stack: "private stack",
});

test("public errors retain explicitly classified domain messages only", () => {
  const error = new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
  error.details = { bucket: "private-bucket", stack: "private stack" };
  assert.deepEqual(publicError(error, requestId), {
    status: 404, error: { code: "ROOM_NOT_FOUND", message: "Sala nao encontrada", requestId },
  });
  assert.equal(publicError(Object.assign(new Error(synthetic), { status: 400, code: "FAKE_DOMAIN" })).error.message, "Erro interno do servidor");
});

for (const provider of ["Redis EVAL", "Firebase Storage", "Cloudinary", "Gemini"]) {
  test(`unexpected ${provider} error never exposes message/details/stack/path`, () => {
    const error = sourceError();
    error.message += provider;
    error.expose = true;
    assert.deepEqual(publicError(error, requestId), {
      status: 500, error: { code: "SERVER_ERROR", message: "Erro interno do servidor", requestId },
    });
  });
}

test("controlled infrastructure codes cannot carry caller-supplied messages or details", () => {
  const error = Object.assign(sourceError(), { code: "REDIS_REQUIRED", status: 503 });
  const serialized = publicError(error, requestId);
  assert.equal(serialized.status, 503);
  assert.equal(serialized.error.code, "REDIS_REQUIRED");
  assert.equal(serialized.error.details, undefined);
  assert.ok(!JSON.stringify(serialized).includes(synthetic));
});

test("validation exposes bounded field paths, not raw schema/provider data", () => {
  const error = Object.assign(new Error("Dados de entrada invalidos"), {
    name: "ValidationError", status: 400,
    details: [{ path: "players.0.name", message: synthetic }, { path: "/srv/private", message: jwt }],
  });
  const serialized = publicError(error, requestId).error;
  assert.equal(serialized.code, "VALIDATION_ERROR");
  assert.equal(serialized.details[0].path, "players.0.name");
  assert.equal(serialized.details[1].path, "");
  assert.ok(!JSON.stringify(serialized).includes(synthetic));
});

test("correlation IDs reject header injection, JWTs and credential-shaped values", () => {
  assert.equal(correlationId(requestId), requestId);
  for (const value of [jwt, "Bearer secret", "id\r\nInjected: value", "AIza" + "a".repeat(35), ["id"], "a".repeat(129)]) {
    assert.match(correlationId(value), /^[a-f0-9-]{36}$/);
  }
});

for (const [label, value] of [
  ["Authorization", { authorization: `Bearer ${synthetic}` }],
  ["cookies", { headers: { cookie: `session=${synthetic}; second=${synthetic}` } }],
  ["Firebase JWT", { message: jwt }],
  ["Redis URL", { message: `rediss://user:${synthetic}@host:6379` }],
  ["Cloudinary URL", { message: `cloudinary://123:${synthetic}@cloud` }],
  ["Gemini query", { message: `https://generativelanguage.googleapis.com/test?key=${synthetic}&x=1` }],
  ["JSON message", { message: `{"api_secret":"${synthetic}", "id": 42}` }],
  ["request body", { body: { token: synthetic, nested: { password: synthetic } } }],
  ["PEM", { message: `-----BEGIN PRIVATE KEY-----\n${synthetic}\n-----END PRIVATE KEY-----` }],
]) {
  test(`central logging redacts synthetic ${label}`, () => {
    const logs = [];
    const logger = createStructuredLogger({ output: { info: (line) => logs.push(line) } });
    logger.info("diagnostic", value);
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].includes(synthetic));
    assert.ok(!logs[0].includes(jwt));
    assert.ok(logs[0].includes("[REDACTED]"));
  });
}

test("direct Error logging retains redacted diagnostics including causes and handles cycles", () => {
  const logs = [];
  const error = Object.assign(new Error(`api_key=${synthetic}`), { cause: new Error(`Bearer ${jwt}`) });
  error.circular = error;
  const logger = createStructuredLogger({ output: { error: (line) => logs.push(JSON.parse(line)) } });
  logger.error(error);
  assert.equal(logs[0].error.name, "Error");
  assert.ok(logs[0].error.stack);
  assert.ok(logs[0].error.cause);
  assert.ok(!JSON.stringify(logs).includes(synthetic));
  assert.ok(!JSON.stringify(logs).includes(jwt));
  assert.equal(redactLogValue({ token: synthetic }).token, "[REDACTED]");
});

test("import reports retain all entries and valid JSON while redacting credentials", () => {
  const report = { entries: Array.from({ length: 150 }, (_, id) => ({ id, message: `api_secret=${synthetic}` })) };
  const text = stringifyRedacted(report, 2);
  assert.equal(JSON.parse(text).entries.length, 150);
  assert.ok(!text.includes(synthetic));
});

test("HTTP and Socket ACK/no-ACK use the same public error and correlation ID", async (t) => {
  const logs = [];
  const output = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (line) => logs.push(line)]));
  const { server, store, url } = await startTestServer({ structuredLogger: createStructuredLogger({ output }) });
  t.after(() => server.close());
  store.listRoomsForManager = async () => { throw sourceError(); };
  server.io.on("connection", (socket) => registerSafe(socket, "security:test", async () => { throw sourceError(); }));
  const http = await fetch(`${url}/api/rooms`, { headers: { authorization: "Bearer owner-token", "x-request-id": requestId } });
  const body = await http.json();
  assert.equal(http.status, 500);
  assert.equal(http.headers.get("x-request-id"), requestId);
  const client = io(url, { transports: ["websocket"], auth: { token: "owner-token" }, reconnection: false });
  t.after(() => client.disconnect());
  await once(client, "connect");
  const ack = await client.timeout(1000).emitWithAck("security:test", { _requestId: requestId });
  assert.deepEqual(ack.error, body.error);
  const received = once(client, "server:error");
  client.emit("security:test", { _requestId: requestId });
  assert.deepEqual((await received)[0].error, body.error);
  assert.ok(logs.some((line) => line.includes(requestId) && line.includes("http.request_error")));
  assert.ok(!logs.join("").includes(synthetic));
  assert.ok(!logs.join("").includes("owner-token"));
});

test("request logging does not reflect raw paths, query, headers, body or unsafe request IDs", async (t) => {
  const logs = [];
  const output = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (line) => logs.push(line)]));
  const { server, url } = await startTestServer({ structuredLogger: createStructuredLogger({ output }) });
  t.after(() => server.close());
  await fetch(`${url}/unknown/${jwt}?key=${synthetic}`, { headers: { "x-request-id": jwt, cookie: `session=${synthetic}` } });
  assert.ok(!logs.join("").includes(synthetic));
  assert.ok(!logs.join("").includes(jwt));
});

test("forwarded errors from legacy replicas cannot bypass the public error policy", async () => {
  let handler;
  const emitted = [];
  const socket = {
    id: "legacy-forward", data: { forwardEvent: async () => ({ ok: false, error: sourceError() }) },
    on(_event, callback) { handler = callback; }, emit(event, data) { emitted.push({ event, data }); },
  };
  registerSafe(socket, "match:test", async () => { throw Object.assign(new Error("owned elsewhere"), { code: "MATCH_IN_PROGRESS" }); });
  const ack = await new Promise((resolve) => handler({ _requestId: requestId }, resolve));
  assert.deepEqual(ack.error, publicError(sourceError(), requestId).error);
  await handler({ _requestId: requestId });
  assert.deepEqual(emitted[0].data.error, ack.error);
});

test("Engine.IO polling and upgrade responses receive security headers outside Express", async (t) => {
  const { server, url } = await startTestServer();
  t.after(() => server.close());
  const polling = await fetch(`${url}/socket.io/?EIO=4&transport=polling`);
  assert.equal(polling.status, 200);
  assert.equal(polling.headers.get("x-frame-options"), "DENY");
  assert.equal(polling.headers.get("x-content-type-options"), "nosniff");
  assert.match(polling.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const { WebSocket } = await import("ws");
  const websocket = new WebSocket(url.replace("http", "ws") + "/socket.io/?EIO=4&transport=websocket");
  t.after(() => websocket.close());
  const opened = once(websocket, "open");
  const [upgrade] = await once(websocket, "upgrade");
  assert.equal(upgrade.headers["x-frame-options"], "DENY");
  assert.equal(upgrade.headers["referrer-policy"], "no-referrer");
  await opened;
  websocket.close();
});

test("production rejects wildcard/malformed origins before dependency initialization", () => {
  for (const origin of ["*", "https://ok.example,*", "null", "https://user:password@host.example", "https://ok.example/path", "https://ok.example?query=1"]) {
    assert.throws(() => getServerConfig({ NODE_ENV: "production", CLIENT_ORIGIN: origin }), /CLIENT_ORIGIN/);
  }
  assert.equal(getServerConfig({ NODE_ENV: "production" }).clientOrigin, "");
});

test("development wildcard never enables credentials and absence of Origin does not reflect a header", () => {
  const policy = createOriginPolicy("*", "development");
  assert.equal(policy.cors.credentials, false);
  assert.equal(policy.allows("https://dev.example"), true);
  assert.equal(policy.allows("null"), false);
  policy.cors.origin(undefined, (error, origin) => { assert.equal(error, null); assert.equal(origin, false); });
});

test("HTTP CORS is exact, supports multiple origins, preflight and legitimate non-browser requests", async (t) => {
  const { server, url } = await startTestServer({ env: { NODE_ENV: "production", CLIENT_ORIGIN: "https://one.example,https://two.example" } });
  t.after(() => server.close());
  for (const origin of ["https://one.example", "https://two.example"]) {
    const response = await fetch(`${url}/health`, { headers: { origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  }
  for (const origin of ["https://one.example.evil.test", "https://evil.test", "null"]) {
    const response = await fetch(`${url}/api/rooms`, { headers: { origin, authorization: "Bearer owner-token" } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.ok((await response.json()).error.requestId);
  }
  const preflight = await fetch(`${url}/api/rooms`, { method: "OPTIONS", headers: { origin: "https://one.example", "access-control-request-method": "POST" } });
  assert.equal(preflight.status, 204);
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/api/rooms`, { headers: { origin: "https://one.example" } })).status, 401);
});

for (const transport of ["websocket", "polling"]) {
  test(`Socket.IO ${transport} rejects untrusted origins and accepts allowed/absent origins`, async (t) => {
    const { server, url } = await startTestServer({ env: { CLIENT_ORIGIN: "https://trusted.example" } });
    t.after(() => server.close());
    for (const origin of ["https://trusted.example", undefined, "https://evil.example"]) {
      const client = io(url, { transports: [transport], auth: { token: "owner-token" }, reconnection: false,
        ...(origin ? { extraHeaders: { origin } } : {}),
      });
      t.after(() => client.disconnect());
      const event = origin === "https://evil.example" ? "connect_error" : "connect";
      const result = new Promise((resolve, reject) => {
        client.once(event, resolve);
        client.once(event === "connect" ? "connect_error" : "connect", reject);
      });
      await result;
      assert.equal(client.connected, event === "connect");
      client.disconnect();
    }
  });
}

test("proxy config rejects hop counts, wildcards and universal networks", () => {
  assert.equal(parseTrustedProxies(undefined), false);
  assert.deepEqual(parseTrustedProxies("127.0.0.1,::1/128"), ["127.0.0.1", "::1/128"]);
  for (const value of ["1", "true", "*", "0.0.0.0/0", "::/0", "10.0.0.1/33", "host.example"]) {
    assert.throws(() => parseTrustedProxies(value), /TRUST_PROXY/);
  }
});

for (const trusted of [false, true]) {
  test(`forwarded IP/protocol trusted only with explicit proxy configuration: ${trusted}`, async (t) => {
    const keys = [];
    const rateLimiter = { async consume(key) { keys.push(key); return { allowed: true, limit: 10, remaining: 9, resetAt: new Date().toISOString() }; } };
    const { server, url } = await startTestServer({ rateLimiter, env: {
      NODE_ENV: "production", ENABLE_HSTS: "true", ...(trusted ? { TRUST_PROXY: "127.0.0.1/32" } : {}),
    } });
    t.after(() => server.close());
    for (const forged of ["198.51.100.11", "198.51.100.12"]) {
      const response = await fetch(`${url}/api/rooms`, { headers: {
        authorization: "Bearer owner-token", "x-forwarded-for": `192.0.2.1, ${forged}`, "x-forwarded-proto": "https",
      } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("strict-transport-security"), trusted ? "max-age=31536000" : null);
    }
    assert.deepEqual(keys, trusted ? ["http:198.51.100.11", "http:198.51.100.12"] : ["http:127.0.0.1", "http:127.0.0.1"]);
  });
}

test("headers cover success, auth error, not-found, CORS error and preflight without local HSTS", async (t) => {
  const { server, url } = await startTestServer({ env: { ENABLE_HSTS: "true", TRUST_PROXY: "127.0.0.1" } });
  t.after(() => server.close());
  for (const [path, options] of [["/health", {}], ["/api/rooms", {}], ["/unknown", {}],
    ["/api/rooms", { headers: { origin: "https://evil.example" } }],
    ["/api/rooms", { method: "OPTIONS", headers: { origin: "http://localhost:5191", "access-control-request-method": "POST" } }]]) {
    const response = await fetch(url + path, options);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(response.headers.get("content-security-policy"), /img-src 'self' blob:/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("permissions-policy"), /camera=\(\)/);
    assert.equal(response.headers.get("strict-transport-security"), null);
  }
});
