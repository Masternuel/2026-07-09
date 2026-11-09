import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import { WebSocket } from "ws";
import { io } from "socket.io-client";
import { getServerConfig } from "../config.mjs";
import { createSecurityHeaders } from "../infrastructure/httpSecurity.mjs";
import { createStagingProxyDiagnostics, getStagingDiagnosticsConfig } from "../infrastructure/stagingProxyDiagnostics.mjs";
import { startTestServer } from "./testHarness.mjs";
import { createStructuredLogger } from "../infrastructure/observability.mjs";

const staging = {
  NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "staging", RAILWAY_SERVICE_NAME: "backend-staging",
  CLIENT_ORIGIN: "https://frontend.example", ENABLE_HSTS: "true", STAGING_HTTPS_ORIGIN: "https://backend.example",
};
const runId = "security-validation-proxy-test";
function requestWithHost(url, options) {
  return new Promise((resolve, reject) => {
    get(url, options, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.once("end", () => resolve({ status: response.statusCode,
        headers: { get: (name) => response.headers[name] ?? null }, text: async () => body }));
      response.once("error", reject);
    }).once("error", reject);
  });
}
function assertHeaders(get) {
  assert.equal(get("strict-transport-security"), "max-age=86400");
  assert.equal(get("x-frame-options"), "DENY");
  assert.equal(get("x-content-type-options"), "nosniff");
  assert.equal(get("referrer-policy"), "no-referrer");
  assert.equal(get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=()");
  assert.equal(get("content-security-policy"), "img-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

test("HTTPS-only staging HSTS does not trust forwarded protocol or change Express IP", async (t) => {
  const keys = [];
  const rateLimiter = { async consume(key) { keys.push(key); return { allowed: true, limit: 20, remaining: 10, resetAt: new Date().toISOString() }; } };
  const { server, url } = await startTestServer({ env: staging, rateLimiter });
  t.after(() => server.close());
  assert.equal(server.app.get("trust proxy"), false);
  for (const proto of ["http", "https"]) {
    const response = await requestWithHost(`${url}/api/rooms`, { headers: {
      host: "backend.example", "x-forwarded-proto": proto, "x-forwarded-for": "198.51.100.17", authorization: "Bearer owner-token",
    } });
    assert.equal(response.status, 200);
    assertHeaders((name) => response.headers.get(name));
  }
  assert.deepEqual(keys, ["http:127.0.0.1", "http:127.0.0.1"]);
});

test("HSTS stays opt-in and scoped to the explicit staging hostname", () => {
  for (const [overrides, host] of [[{ ENABLE_HSTS: "false" }, "backend.example"], [{ NODE_ENV: "test" }, "backend.example"], [{}, "unrelated.example"]]) {
    const headers = createSecurityHeaders(getServerConfig({ ...staging, ...overrides }))({ headers: { host }, socket: {} });
    assert.equal(headers["Strict-Transport-Security"], undefined);
  }
});

test("HTTPS-only ingress configuration rejects other environments, services and malformed origins", () => {
  for (const changes of [{ RAILWAY_ENVIRONMENT_NAME: "production" }, { RAILWAY_SERVICE_NAME: "other" },
    ...["http://backend.example", "https://backend.example/", "https://user:pass@backend.example", "https://backend.example/path"].map((origin) => ({ STAGING_HTTPS_ORIGIN: origin }))]) {
    assert.throws(() => getServerConfig({ ...staging, ...changes }), /STAGING_HTTPS_ORIGIN/);
  }
});

test("HTTP success, auth refusal, CORS refusal, 404 and Engine.IO HTTP errors share all headers", async (t) => {
  const { server, url } = await startTestServer({ env: staging });
  t.after(() => server.close());
  for (const [path, origin] of [["/"], ["/health"], ["/ready"], ["/api/rooms"], ["/missing"],
    ["/socket.io/?EIO=4&transport=invalid"], ["/socket.io/?EIO=4&transport=polling", "https://evil.example"]]) {
    const response = await requestWithHost(url + path, { headers: { host: "backend.example", ...(origin ? { origin } : {}) } });
    assertHeaders((name) => response.headers.get(name));
    if (origin) assert.equal(response.headers.get("access-control-allow-origin"), null);
    await response.text();
  }
});

for (const origin of ["https://evil.example", "null", "http://frontend.example"]) {
  test(`refused WebSocket Origin ${origin}: one HTTP 400 with shared headers`, async (t) => {
    const { server, url } = await startTestServer({ env: staging });
    t.after(() => server.close());
    const result = await new Promise((resolve, reject) => {
      const socket = new WebSocket(url.replace("http", "ws") + "/socket.io/?EIO=4&transport=websocket", {
        headers: { host: "backend.example", origin }, handshakeTimeout: 3000,
      });
      socket.on("error", () => {});
      socket.once("open", () => { socket.close(); reject(new Error("Denied origin upgraded")); });
      socket.once("unexpected-response", (_request, response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.once("end", () => { resolve({ status: response.statusCode, headers: response.headers, body }); socket.terminate(); });
        response.once("error", reject);
      });
    });
    assert.equal(result.status, 400);
    assertHeaders((name) => result.headers[name]);
    assert.equal(result.headers["access-control-allow-origin"], undefined);
    assert.equal(result.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(result.body, "Forbidden origin");
  });
}

test("valid Engine.IO upgrade includes headers and is still processed by the real engine", async (t) => {
  const { server, url } = await startTestServer({ env: staging });
  t.after(() => server.close());
  const socket = new WebSocket(url.replace("http", "ws") + "/socket.io/?EIO=4&transport=websocket", {
    headers: { host: "backend.example", origin: staging.CLIENT_ORIGIN },
  });
  t.after(() => socket.close());
  const message = once(socket, "message");
  const [response] = await once(socket, "upgrade");
  assert.equal(response.statusCode, 101);
  assertHeaders((name) => response.headers[name]);
  assert.match(String((await message)[0]), /^0\{"sid":/);
  socket.close();
});

for (const authenticated of [false, true]) {
  test(`Socket.IO namespace authentication remains enforced: token=${authenticated}`, async (t) => {
    const { server, url } = await startTestServer({ env: staging });
    t.after(() => server.close());
    const socket = io(url, { transports: ["websocket"], reconnection: false, auth: authenticated ? { token: "owner-token" } : {},
      extraHeaders: { origin: staging.CLIENT_ORIGIN, host: "backend.example" } });
    t.after(() => socket.disconnect());
    const result = await new Promise((resolve) => {
      socket.once("connect", () => resolve({ connected: true }));
      socket.once("connect_error", (error) => resolve({ connected: false, code: error.data?.code }));
    });
    assert.equal(result.connected, authenticated);
    if (!authenticated) assert.equal(result.code, "AUTH_REQUIRED");
    socket.disconnect();
  });
}

test("proxy diagnostics require explicit staging identity, bounded expiry and run-id", () => {
  assert.equal(getStagingDiagnosticsConfig({}), null);
  const env = { ...staging, STAGING_PROXY_DIAGNOSTICS: "true", STAGING_PROXY_DIAGNOSTICS_RUN_ID: runId,
    STAGING_PROXY_DIAGNOSTICS_UNTIL: new Date(2000).toISOString() };
  assert.deepEqual(getStagingDiagnosticsConfig(env, 1000), { runId, until: 2000 });
  for (const changes of [{ RAILWAY_ENVIRONMENT_NAME: "production" }, { RAILWAY_SERVICE_NAME: "other" },
    { STAGING_PROXY_DIAGNOSTICS_RUN_ID: "unscoped" }, { STAGING_PROXY_DIAGNOSTICS_UNTIL: "invalid" },
    { STAGING_PROXY_DIAGNOSTICS_UNTIL: new Date(3_602_000).toISOString() }]) {
    assert.throws(() => getStagingDiagnosticsConfig({ ...env, ...changes }, 1000), /STAGING_PROXY_DIAGNOSTICS/);
  }
});

test("diagnostics are scoped, expire, cap events and never log sensitive headers or public addresses", () => {
  let now = 1000;
  const logs = [];
  const middleware = createStagingProxyDiagnostics({ config: { runId, until: 2000 }, now: () => now,
    instanceId: "replica-test", logger: { info: (_event, fields) => logs.push(fields) } });
  const request = { socket: { remoteAddress: "10.2.3.4" }, ip: "8.8.8.8", protocol: "http", secure: false,
    headers: { "x-request-id": `${runId}-baseline`, authorization: "secret-sentinel", cookie: "secret-sentinel",
      "x-forwarded-for": "198.51.100.17, 8.8.8.8", "x-forwarded-proto": "http", forwarded: "for=198.51.100.17;proto=http" } };
  let next = 0;
  middleware({ ...request, headers: {} }, {}, () => next++);
  middleware(request, {}, () => next++);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].remoteAddress, "10.2.3.4");
  assert.equal(logs[0].xffCount, 2);
  assert.deepEqual(logs[0].xffSyntheticPositions, [{ index: 0, value: "198.51.100.17" }]);
  assert.equal(logs[0].forwardedContainsSynthetic, true);
  assert.doesNotMatch(JSON.stringify(logs), /secret-sentinel|8\.8\.8\.8|authorization|cookie/i);
  now = 2000;
  middleware(request, {}, () => next++);
  assert.equal(logs.length, 1);
  now = 1000;
  for (let i = 0; i < 60; i++) middleware(request, {}, () => next++);
  assert.equal(logs.length, 48);
  assert.equal(next, 63);
});

test("real Express diagnostics ignore spoofed forwarding with trust proxy false", async (t) => {
  const logs = [];
  const output = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (line) => logs.push(JSON.parse(line))]));
  const { server, url } = await startTestServer({ structuredLogger: createStructuredLogger({ output }), env: {
    ...staging, STAGING_PROXY_DIAGNOSTICS: "true", STAGING_PROXY_DIAGNOSTICS_RUN_ID: runId,
    STAGING_PROXY_DIAGNOSTICS_UNTIL: new Date(Date.now() + 60_000).toISOString(),
  } });
  t.after(() => server.close());
  for (const [index, headers] of [{}, { "x-forwarded-for": "198.51.100.17, 203.0.113.29", "x-forwarded-proto": "https" },
    { forwarded: "for=198.51.100.17;proto=https" }].entries()) {
    await fetch(`${url}/health`, { headers: { ...headers, "x-request-id": `${runId}-${index}` } });
  }
  const diagnostics = logs.filter((entry) => entry.event === "staging.proxy_diagnostic");
  assert.equal(diagnostics.length, 3);
  for (const row of diagnostics) {
    assert.equal(row.ip, "127.0.0.1");
    assert.equal(row.remoteAddress, "127.0.0.1");
    assert.equal(row.ipEqualsPeer, true);
    assert.equal(row.protocol, "http");
    assert.equal(row.secure, false);
  }
  assert.deepEqual(diagnostics.map((row) => row.xffCount), [0, 2, 0]);
  assert.equal(diagnostics[2].forwardedContainsSynthetic, true);
});
