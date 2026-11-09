import test from "node:test";
import assert from "node:assert/strict";
import { io as createClient } from "socket.io-client";
import { createClusterIdentity, validateClusterSigningKey } from "../infrastructure/clusterIdentity.mjs";
import { getServerConfig } from "../config.mjs";
import { startTestServer, fakeFirebase } from "./testHarness.mjs";

const KEY = "k".repeat(24) + "-cluster-signing-key-0123456789";
const OTHER_KEY = "o".repeat(24) + "-cluster-signing-key-0123456789";
const user = { uid: "owner", name: "Owner", email: "o@example.test", picture: null, editor: true, authType: "firebase" };

test("chave ausente desativa a assinatura e mantem o fallback", () => {
  assert.equal(createClusterIdentity(undefined), null);
  assert.equal(createClusterIdentity(""), null);
  assert.equal(getServerConfig({}).clusterSigningKey, "");
});

test("chave curta ou com espacos falha na inicializacao", () => {
  for (const value of ["curta", "a b".repeat(20), "x".repeat(513)]) {
    assert.throws(() => validateClusterSigningKey(value), /CLUSTER_SIGNING_KEY/);
    assert.throws(() => getServerConfig({ CLUSTER_SIGNING_KEY: value }), /CLUSTER_SIGNING_KEY/);
  }
  assert.equal(getServerConfig({ CLUSTER_SIGNING_KEY: KEY }).clusterSigningKey, KEY);
});

test("assinatura valida preserva identidade e nao inclui token", () => {
  const identity = createClusterIdentity(KEY, { now: () => 1_000 });
  const assertion = identity.sign({ ...user, token: "bearer-secret" });
  assert.equal(assertion.includes("bearer-secret"), false);
  assert.equal(Buffer.from(assertion.split(".")[0], "base64url").toString().includes("bearer-secret"), false);
  const verified = identity.verify(assertion);
  assert.deepEqual(verified.user, user);
  assert.equal(verified.expiresAt, 16_000);
});

test("assinatura adulterada, de outra chave, expirada ou malformada e rejeitada", () => {
  let clock = 1_000;
  const identity = createClusterIdentity(KEY, { now: () => clock });
  const assertion = identity.sign(user);
  const [payload, signature] = assertion.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({
    ...JSON.parse(Buffer.from(payload, "base64url").toString()), uid: "intruder",
  })).toString("base64url");
  const rejected = [
    `${forgedPayload}.${signature}`,
    createClusterIdentity(OTHER_KEY, { now: () => clock }).sign(user),
    `${payload}.${signature}.extra`,
    `${payload}.`,
    "",
    null,
    "x".repeat(5_000),
  ];
  for (const value of rejected) {
    assert.throws(() => identity.verify(value), { code: "INVALID_AUTH_TOKEN" });
  }
  clock += 15_001;
  assert.throws(() => identity.verify(assertion), { code: "INVALID_AUTH_TOKEN" });
});

test("assinatura com validade alem do TTL e rejeitada", () => {
  const future = createClusterIdentity(KEY, { now: () => 1_000, ttlMs: 60_000 }).sign(user);
  assert.throws(() => createClusterIdentity(KEY, { now: () => 1_000 }).verify(future), { code: "INVALID_AUTH_TOKEN" });
});

test("identidade demo nunca recebe permissao de editor", () => {
  const identity = createClusterIdentity(KEY);
  const verified = identity.verify(identity.sign({ ...user, authType: "demo", editor: true }));
  assert.equal(verified.user.editor, false);
});

async function realServer(t, env) {
  const firebase = fakeFirebase();
  const verified = [];
  firebase.auth.verifyIdToken = async (token) => {
    verified.push(token);
    return { uid: "owner", name: "Owner", exp: Math.floor(Date.now() / 1000) + 3600 };
  };
  let fence = 0;
  const { server, url } = await startTestServer({
    firebase, env, matchDelayMs: 60_000,
    distributedLocks: { acquire: async () => ({ token: `owner-${++fence}`, fence,
      renew: async () => true, release: async () => true }) },
  });
  let client;
  t.after(async () => { client?.disconnect(); await server.close(); });
  client = await new Promise((resolve, reject) => {
    const socket = createClient(url, { auth: { token: "valid" }, reconnection: false, transports: ["websocket"] });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
  const create = await client.timeout(1000).emitWithAck("room:create", { name: "Cluster assinado", clubId: "AUR" });
  const code = create.room.code;
  assert.equal((await client.timeout(1000).emitWithAck("room:ready", { code, ready: true })).ok, true);
  assert.equal((await client.timeout(1000).emitWithAck("room:start", { code })).ok, true);
  const start = await client.timeout(2000).emitWithAck("match:ready", { code, ready: true });
  assert.equal(start.ok, true);
  const handler = server.io.sockets.listeners("cluster:match-command")[0];
  const invoke = (auth) => new Promise((resolve) => handler({
    event: "match:speed", payload: { code, matchId: start.matchId, speed: 2 }, auth,
  }, resolve));
  return { server, code, start, invoke, verified };
}

test("com chave configurada o encaminhamento envia assercao assinada, nunca o token", async (t) => {
  const { server, code, start } = await realServer(t, { CLUSTER_SIGNING_KEY: KEY });
  const sent = [];
  server.io.serverSideEmitWithAck = async (event, request) => { sent.push({ event, request }); return []; };
  const [socket] = server.io.sockets.sockets.values();
  await socket.data.forwardEvent("match:speed", { code, matchId: start.matchId, speed: 2 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, "cluster:match-command");
  assert.equal(sent[0].request.auth.token, undefined);
  assert.equal(JSON.stringify(sent[0]).includes("valid"), false);
  const identity = createClusterIdentity(KEY);
  assert.equal(identity.verify(sent[0].request.auth.assertion).user.uid, "owner");
});

test("replica receptora aceita assercao valida sem reverificar token e rejeita forjadas", async (t) => {
  const { invoke, verified } = await realServer(t, { CLUSTER_SIGNING_KEY: KEY });
  const before = verified.length;
  const ok = await invoke({ assertion: createClusterIdentity(KEY).sign(user) });
  assert.equal(ok.response.ok, true);
  assert.equal(verified.length, before);
  const forged = await invoke({ assertion: createClusterIdentity(OTHER_KEY).sign(user) });
  assert.equal(forged.response.error.code, "INVALID_AUTH_TOKEN");
  const intruder = await invoke({ assertion: createClusterIdentity(KEY).sign({ ...user, uid: "intruder" }) });
  assert.equal(intruder.response.ok, false);
});

test("sem chave configurada a replica rejeita assercoes e mantem tokens", async (t) => {
  const { invoke } = await realServer(t, {});
  const rejected = await invoke({ assertion: createClusterIdentity(KEY).sign(user) });
  assert.equal(rejected.response.error.code, "AUTH_REQUIRED");
  assert.equal((await invoke({ token: "valid" })).response.ok, true);
});
