import test from "node:test";
import assert from "node:assert/strict";
import { createExpressAuthMiddleware, createSocketAuthMiddleware } from "../auth.mjs";
import { fakeFirebase, startTestServer, jsonRequest } from "./testHarness.mjs";

for (const [providerCode, code, status] of [
  [null, null, 200],
  ["auth/argument-error", "INVALID_AUTH_TOKEN", 401],
  ["auth/id-token-expired", "AUTH_TOKEN_EXPIRED", 401],
  ["auth/id-token-revoked", "AUTH_TOKEN_REVOKED", 401],
  ["auth/user-disabled", "AUTH_USER_DISABLED", 401],
  ["auth/unavailable", "AUTH_UNAVAILABLE", 503],
]) {
  test(`HTTP/Socket.IO compartilham revogacao e classificacao: ${providerCode ?? "valido"}`, async () => {
    const auth = { async verifyIdToken(_token, checkRevoked) {
      assert.equal(checkRevoked, true);
      if (providerCode) throw Object.assign(new Error("internal-secret-provider"), { code: providerCode });
      return { uid: "owner", exp: Math.floor(Date.now() / 1000) + 3600 };
    } };
    const request = { headers: { authorization: "Bearer token" } };
    const error = await new Promise((resolve) => createExpressAuthMiddleware({ auth })(request, {}, resolve));
    const socket = { handshake: { auth: { token: "token" } }, data: {} };
    const socketError = await new Promise((resolve) => createSocketAuthMiddleware({ auth })(socket, resolve));
    if (code) {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(socketError.data.code, code);
      assert.equal(request.user, undefined);
      assert.doesNotMatch(JSON.stringify([error, socketError]), /internal-secret-provider/);
    } else {
      assert.equal(error, undefined);
      assert.equal(socketError, undefined);
      assert.equal(request.user.uid, "owner");
    }
  });
}

test("HTTP timeout Firebase permanece limitado e nao autentica", async () => {
  const request = { headers: { authorization: "Bearer token" } };
  const started = Date.now();
  const error = await new Promise((resolve) => createExpressAuthMiddleware({
    auth: { verifyIdToken: () => new Promise(() => {}) }, timeoutMs: 10,
  })(request, {}, resolve));
  assert.equal(error.code, "AUTH_UNAVAILABLE");
  assert.equal(error.status, 503);
  assert.equal(request.user, undefined);
  assert.ok(Date.now() - started < 1_000);
});

test("todas as familias HTTP privadas rejeitam revogacao; health e readiness continuam publicos", async (context) => {
  const firebase = fakeFirebase();
  firebase.auth.verifyIdToken = async (_token, revoked) => {
    assert.equal(revoked, true);
    throw Object.assign(new Error("provider-private-detail"), { code: "auth/id-token-revoked" });
  };
  const { server, url } = await startTestServer({ firebase });
  context.after(() => server.close());
  for (const family of ["rooms", "teams", "leagues", "tournaments", "matches", "market", "scouting", "news", "editor"]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const response = await jsonRequest(`${url}/api/${family}/test`, "revoked", { method });
      assert.equal(response.status, 401, `${method} ${family}`);
      assert.equal((await response.json()).error.code, "AUTH_TOKEN_REVOKED");
    }
  }
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/ready`)).status, 200);
});
