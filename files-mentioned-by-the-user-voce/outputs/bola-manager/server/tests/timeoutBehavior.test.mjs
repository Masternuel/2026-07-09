import assert from "node:assert/strict";
import test from "node:test";
import { createExpressAuthMiddleware, createSocketAuthMiddleware } from "../auth.mjs";
import { registerSafe } from "../sockets/helpers.mjs";
import { startTestServer } from "./testHarness.mjs";

test("autenticacao HTTP e Socket falha de forma limitada quando Firebase trava", async () => {
  const auth = { verifyIdToken: () => new Promise(() => {}) };
  const request = { headers: { authorization: "Bearer token" } };
  const httpError = await new Promise((resolve) => {
    createExpressAuthMiddleware({ auth, timeoutMs: 5 })(request, {}, resolve);
  });
  assert.equal(httpError.code, "AUTH_UNAVAILABLE");
  assert.equal(httpError.status, 503);

  const socket = { handshake: { auth: { token: "token" } }, data: {} };
  const socketError = await new Promise((resolve) => {
    createSocketAuthMiddleware({ auth, timeoutMs: 5 })(socket, resolve);
  });
  assert.equal(socketError.data.code, "AUTH_UNAVAILABLE");
  assert.equal(socketError.data.status, 503);
});

test("autenticacao distingue falha transitória de token inválido", async () => {
  const verify = async (error) => {
    const request = { headers: { authorization: "Bearer token" } };
    return new Promise((resolve) => {
      const auth = { verifyIdToken: () => Promise.reject(error) };
      createExpressAuthMiddleware({ auth })(request, {}, resolve);
    });
  };

  const unavailable = await verify(Object.assign(new Error("Firebase indisponível"), { code: "auth/internal-error" }));
  assert.equal(unavailable.code, "AUTH_UNAVAILABLE");
  assert.equal(unavailable.status, 503);

  const invalid = await verify(Object.assign(new Error("Token expirado"), { code: "auth/id-token-expired" }));
  assert.equal(invalid.code, "INVALID_AUTH_TOKEN");
  assert.equal(invalid.status, 401);
});

test("ACK de Socket nao espera trabalho de broadcast posterior", async () => {
  const handlers = new Map();
  const socket = {
    id: "socket-test",
    data: {},
    on: (event, handler) => handlers.set(event, handler),
    emit() {},
  };
  let receivedPayload;
  let backgroundStarted = false;
  registerSafe(socket, "room:test", async (payload) => {
    receivedPayload = payload;
    return {
      room: { code: "BOLA-TEST" },
      afterAcknowledgement: () => {
        backgroundStarted = true;
        return new Promise(() => {});
      },
    };
  });

  const acknowledgement = await new Promise((resolve) => {
    handlers.get("room:test")({ value: 1, _requestId: "request-test" }, resolve);
  });
  assert.equal(acknowledgement.ok, true);
  assert.equal(acknowledgement.room.code, "BOLA-TEST");
  assert.deepEqual(receivedPayload, { value: 1 });
  assert.equal(backgroundStarted, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(backgroundStarted, true);
});

test("forward entre replicas preserva requestId", async () => {
  const handlers = new Map();
  let forwardedPayload;
  const socket = {
    id: "socket-forward",
    data: {
      forwardEvent: async (_eventName, payload) => {
        forwardedPayload = payload;
        return { ok: true };
      },
    },
    on: (event, handler) => handlers.set(event, handler),
    emit() {},
  };
  registerSafe(socket, "match:test", async () => {
    const error = new Error("Partida em outra replica");
    error.code = "MATCH_IN_PROGRESS";
    throw error;
  });

  const acknowledgement = await new Promise((resolve) => {
    handlers.get("match:test")({ code: "BOLA", _requestId: "trace-forward" }, resolve);
  });
  assert.equal(acknowledgement.ok, true);
  assert.deepEqual(forwardedPayload, { code: "BOLA", _requestId: "trace-forward" });
});

test("HTTP registra inicio, lentidao e fim com o mesmo requestId", async (context) => {
  const events = [];
  const logger = Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [
    level,
    (event, fields = {}) => events.push({ level, event, ...fields }),
  ]));
  const { server, url } = await startTestServer({
    structuredLogger: logger,
    env: { HTTP_SLOW_MS: "5" },
    readinessCheck: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true, dependencies: {} };
    },
  });
  context.after(() => server.close());

  const response = await fetch(`${url}/ready`, {
    headers: { "X-Request-Id": "request-observability" },
  });
  assert.equal(response.status, 200);
  await response.json();
  assert.deepEqual(
    events.filter((entry) => entry.requestId === "request-observability").map((entry) => entry.event),
    ["http.request_start", "http.request_slow", "http.request_end"],
  );
});
