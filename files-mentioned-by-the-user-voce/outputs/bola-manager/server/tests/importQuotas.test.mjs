import test from "node:test";
import assert from "node:assert/strict";
import { BrasfootImportSessionService } from "../services/brasfootImportSessions.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

function setup(context, overrides = {}) {
  const objects = new Map();
  const bucket = { fail: false, file(path) { return {
    async save(bytes) { objects.set(path, Buffer.from(bytes)); if (bucket.fail) { bucket.fail = false; throw new Error("upload failed"); } },
    async download() { return [objects.get(path)]; },
    async delete() { objects.delete(path); },
  }; } };
  const parseSource = async (root) => ({
    dataset: { clubs: [], players: [], leagues: [], cups: [] }, assetRoot: root,
    report: { sourceFormat: "test", scanned: {}, success: {}, errors: [], warnings: [], duplicates: {}, corrupted: [], assets: {} },
  });
  const options = {
    database: createFakeFirestore(), bucket, nodeEnv: "production", scheduleCleanup: false,
    parseSource, commitImport: async () => ({ runId: "ok" }), logger: { error() {} },
    ...overrides,
    limits: { maxActiveSessionsPerUser: 2, maxTotalBytes: 1024 * 1024, maxFileBytes: 1024, maxReservedBytesPerUser: 8 * 1024 * 1024, maxConcurrentProcessesPerUser: 1, ...overrides.limits },
  };
  const a = new BrasfootImportSessionService(options);
  const b = new BrasfootImportSessionService(options);
  context.after(async () => { await a.close(); await b.close(); });
  return { a, b, bucket, objects };
}
const quotaError = { code: "BRASFOOT_IMPORT_QUOTA_EXCEEDED" };
const upload = (service, session, ownerId = "A") => service.uploadFile({ sessionId: session.id, ownerId, path: "club.ban", bytes: Buffer.from("club") });

test("quota permite usuario abaixo do limite e reserva sessoes atomicamente entre replicas", async (context) => {
  const { a, b } = setup(context);
  const results = await Promise.allSettled([a, b, a, b].map((service) => service.createSession({ ownerId: "A" })));
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 2);
  assert.ok(results.filter((value) => value.status === "rejected").every((value) => value.reason.code === quotaError.code));
  await assert.rejects(b.createSession({ ownerId: "A" }), quotaError);
  assert.ok((await b.createSession({ ownerId: "B" })).id);
});

test("limite agregado de bytes reservados nao pode ser contornado por sessoes vazias", async (context) => {
  const { a, b } = setup(context, { limits: { maxActiveSessionsPerUser: 10, maxReservedBytesPerUser: 4 * 1024 * 1024 } });
  await a.createSession({ ownerId: "A" });
  await assert.rejects(b.createSession({ ownerId: "A" }), quotaError);
});

test("cancelamento remove blobs e libera quota para outra replica", async (context) => {
  const { a, b, objects } = setup(context, { limits: { maxActiveSessionsPerUser: 1 } });
  const session = await a.createSession({ ownerId: "A" });
  await upload(a, session);
  await b.deleteSession({ sessionId: session.id, ownerId: "A" });
  assert.equal(objects.size, 0);
  assert.ok((await b.createSession({ ownerId: "A" })).id);
});

test("expiracao limpa objetos antes de reutilizar a reserva em outra replica", async (context) => {
  let now = 1_000;
  const { a, b, objects } = setup(context, { now: () => now, limits: { ttlMs: 1_000, maxActiveSessionsPerUser: 1 } });
  const session = await a.createSession({ ownerId: "A" });
  await upload(a, session);
  now += 1_001;
  assert.ok((await b.createSession({ ownerId: "A" })).id);
  assert.equal(objects.size, 0);
});

test("falha de upload limpa escrita parcial e libera toda a reserva", async (context) => {
  const { a, b, bucket, objects } = setup(context, { limits: { maxActiveSessionsPerUser: 1 } });
  const session = await a.createSession({ ownerId: "A" });
  bucket.fail = true;
  await assert.rejects(upload(a, session), /upload failed/);
  assert.equal(objects.size, 0);
  await assert.rejects(upload(b, session), { code: "BRASFOOT_IMPORT_SESSION_NOT_FOUND" });
  assert.equal((await upload(b, await b.createSession({ ownerId: "A" }))).fileCount, 1);
});

test("processamento concorrente usa quota compartilhada e libera apos erro", async (context) => {
  let entered;
  let fail;
  const started = new Promise((resolve) => { entered = resolve; });
  const { a, b } = setup(context, { parseSource: async () => { entered(); return new Promise((_resolve, reject) => { fail = reject; }); } });
  const one = await a.createSession({ ownerId: "A" });
  const two = await b.createSession({ ownerId: "A" });
  await upload(a, one); await upload(b, two);
  const processing = a.preview({ sessionId: one.id, ownerId: "A" });
  const rejected = assert.rejects(processing, /parse failed/);
  await started;
  await assert.rejects(b.preview({ sessionId: two.id, ownerId: "A" }), quotaError);
  fail(new Error("parse failed"));
  await rejected;
  assert.equal((await upload(b, two)).fileCount, 1);
});

test("commit concluido remove sessao, previews e reserva", async (context) => {
  const { a, b, objects } = setup(context, { limits: { maxActiveSessionsPerUser: 1 } });
  const session = await a.createSession({ ownerId: "A" });
  await upload(a, session);
  await b.preview({ sessionId: session.id, ownerId: "A" });
  await a.commit({ sessionId: session.id, ownerId: "A" });
  assert.equal(objects.size, 0);
  assert.ok((await b.createSession({ ownerId: "A" })).id);
});

test("falha no commit libera sessao, processamento e bytes em outra replica", async (context) => {
  const { a, b, objects } = setup(context, {
    limits: { maxActiveSessionsPerUser: 1 }, commitImport: async () => { throw new Error("commit failed"); },
  });
  const session = await a.createSession({ ownerId: "A" });
  await upload(a, session);
  await b.preview({ sessionId: session.id, ownerId: "A" });
  await assert.rejects(a.commit({ sessionId: session.id, ownerId: "A" }), /commit failed/);
  assert.equal(objects.size, 0);
  assert.ok((await b.createSession({ ownerId: "A" })).id);
});

test("sessao antiga sem metadado de quota entra no calculo e nao cria bypass", async (context) => {
  const database = createFakeFirestore();
  await database.collection("brasfootImportSessions").doc("legacy").set({ ownerId: "A", expiresAt: Date.now() + 60_000, fileCount: 0, totalBytes: 0 });
  const { a } = setup(context, { database, limits: { maxActiveSessionsPerUser: 1 } });
  await assert.rejects(a.createSession({ ownerId: "A" }), quotaError);
});

test("desenvolvimento local tambem impede corrida de criacao e libera ao cancelar", async (context) => {
  const { a } = setup(context, { database: null, bucket: null, nodeEnv: "development", limits: { maxActiveSessionsPerUser: 1 } });
  const results = await Promise.allSettled([a.createSession({ ownerId: "A" }), a.createSession({ ownerId: "A" })]);
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  const session = results.find((value) => value.status === "fulfilled").value;
  await a.deleteSession({ sessionId: session.id, ownerId: "A" });
  assert.ok((await a.createSession({ ownerId: "A" })).id);
});
