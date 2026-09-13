import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BrasfootImportSessionService,
  normalizeBrasfootUploadPath,
} from "../services/brasfootImportSessions.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";
import { startTestServer } from "./testHarness.mjs";

const SESSION_ONE = "11111111-1111-4111-8111-111111111111";
const SESSION_TWO = "22222222-2222-4222-8222-222222222222";

class MemoryBucket {
  constructor() {
    this.name = "test-bucket";
    this.objects = new Map();
  }

  file(path) {
    return {
      save: async (bytes) => this.objects.set(path, Buffer.from(bytes)),
      download: async () => {
        if (!this.objects.has(path)) {
          const error = new Error("Objeto ausente");
          error.code = 404;
          throw error;
        }
        return [Buffer.from(this.objects.get(path))];
      },
      delete: async ({ ignoreNotFound } = {}) => {
        if (!this.objects.delete(path) && !ignoreNotFound) throw new Error("Objeto ausente");
      },
    };
  }
}

function parsedSource(root, { withError = false } = {}) {
  const errors = withError
    ? [{ file: "teams/corrompido.ban", code: "BRASFOOT_PARSE_ERROR", message: "Arquivo corrompido" }]
    : [];
  return {
    dataset: {
      version: "editor-test-1",
      clubs: [{ id: "teste", name: "Teste FC", abbreviation: "TES", country: "Brasil", division: "Serie A" }],
      players: [{ id: "p1", clubId: "teste", name: "Atleta", position: "MC", age: 22, attributes: {} }],
      leagues: [],
      cups: [],
    },
    report: {
      sourceFormat: "brasfoot-java-serialization",
      inputPath: root,
      scanned: { ban: 2, cfg: 0 },
      success: { clubs: 1, players: 1, leagues: 0 },
      errors,
      warnings: [{ code: "TEST_WARNING", message: "Aviso de teste" }],
      duplicates: { clubs: [], clubNames: [], players: [], leagues: [] },
      corrupted: errors,
      assets: { shieldsFound: 0, shieldsMissing: 1, miniShieldsFound: 0, shirtsFound: 0 },
    },
    assetRoot: root,
  };
}

function request(url, token, { method = "GET", body, contentType } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (contentType) headers["content-type"] = contentType;
  return fetch(url, { method, headers, body });
}

function jsonRequest(url, token, method, body) {
  return request(url, token, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    contentType: body === undefined ? undefined : "application/json",
  });
}

test("normaliza arquivo individual e webkitRelativePath sem permitir traversal ou extensao arbitraria", () => {
  assert.equal(normalizeBrasfootUploadPath("santos.ban"), "teams/santos.ban");
  assert.equal(normalizeBrasfootUploadPath("liga.cfg"), "conf_ligas_nacionais/liga.cfg");
  assert.equal(normalizeBrasfootUploadPath("santos.png"), "teams/escudos/santos.png");
  assert.equal(normalizeBrasfootUploadPath("Brasfoot/Teams/santos.ban"), "teams/santos.ban");
  assert.equal(
    normalizeBrasfootUploadPath("Copa/conf_ligas_nacionais/brasil.cfg"),
    "conf_ligas_nacionais/brasil.cfg",
  );
  assert.throws(
    () => normalizeBrasfootUploadPath("../teams/santos.ban"),
    (error) => error.code === "BRASFOOT_IMPORT_PATH_INVALID",
  );
  assert.throws(
    () => normalizeBrasfootUploadPath("santos.exe"),
    (error) => error.code === "BRASFOOT_IMPORT_EXTENSION_INVALID",
  );
});

test("sessao aplica TTL, rejeita arquivo vazio e limpa arquivos expirados", async () => {
  const parent = await mkdtemp(join(tmpdir(), "brasfoot-session-test-"));
  let now = Date.parse("2026-07-13T12:00:00.000Z");
  const service = new BrasfootImportSessionService({
    tempDirectory: parent,
    limits: { ttlMs: 1_000 },
    now: () => now,
    idFactory: () => SESSION_ONE,
    scheduleCleanup: false,
    allowLocalFallback: true,
  });
  try {
    const session = await service.createSession({ ownerId: "editor" });
    assert.equal(session.sessionId, SESSION_ONE);
    await assert.rejects(
      () => service.uploadFile({ sessionId: SESSION_ONE, ownerId: "editor", path: "vazio.ban", bytes: Buffer.alloc(0) }),
      (error) => error.code === "BRASFOOT_IMPORT_FILE_EMPTY",
    );
    await service.uploadFile({
      sessionId: SESSION_ONE,
      ownerId: "editor",
      path: "Brasfoot/Teams/valido.ban",
      bytes: Buffer.from("valido"),
    });
    now += 1_001;
    assert.equal(await service.cleanupExpired(), 1);
    await assert.rejects(
      () => service.deleteSession({ sessionId: SESSION_ONE, ownerId: "editor" }),
      (error) => error.code === "BRASFOOT_IMPORT_SESSION_NOT_FOUND",
    );
  } finally {
    await service.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test("shutdown aguarda commit Brasfoot em andamento", async () => {
  const parent = await mkdtemp(join(tmpdir(), "brasfoot-shutdown-test-"));
  let releaseCommit;
  let signalCommit;
  const commitReleased = new Promise((resolve) => { releaseCommit = resolve; });
  const commitStarted = new Promise((resolve) => { signalCommit = resolve; });
  const service = new BrasfootImportSessionService({
    database: {},
    tempDirectory: parent,
    idFactory: () => SESSION_ONE,
    parseSource: async (root) => parsedSource(root),
    normalize: (data) => structuredClone(data),
    commitImport: async () => {
      signalCommit();
      await commitReleased;
      return { runId: "shutdown-run", progress: { phase: "completed" } };
    },
    scheduleCleanup: false,
    allowLocalFallback: true,
  });
  try {
    await service.createSession({ ownerId: "editor" });
    await service.uploadFile({
      sessionId: SESSION_ONE,
      ownerId: "editor",
      path: "time.ban",
      bytes: Buffer.from("dados"),
    });
    await service.preview({ sessionId: SESSION_ONE, ownerId: "editor" });
    const committing = service.commit({ sessionId: SESSION_ONE, ownerId: "editor" });
    await commitStarted;
    let closed = false;
    const closing = service.close().then(() => { closed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false);
    releaseCommit();
    await Promise.all([committing, closing]);
    assert.equal(closed, true);
  } finally {
    releaseCommit?.();
    await service.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test("rotas exigem Firebase, mantem contrato flat, confirmam parcial e limpam sessao", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "brasfoot-route-test-"));
  const ids = [SESSION_ONE, SESSION_TWO];
  const commits = [];
  const service = new BrasfootImportSessionService({
    database: {},
    mediaService: { async upload() {}, async remove() {} },
    tempDirectory: parent,
    idFactory: () => ids.shift(),
    parseSource: async (root) => parsedSource(root, { withError: true }),
    normalize: (data) => structuredClone(data),
    commitImport: async (input) => {
      commits.push(input);
      return {
        runId: "route-import-run",
        progress: { phase: "completed", assets: { uploaded: 0 }, collections: {} },
      };
    },
    scheduleCleanup: false,
    logger: { error() {} },
    allowLocalFallback: true,
  });
  const { server, url } = await startTestServer({
    brasfootImportService: service,
    env: { NODE_ENV: "production", EDITOR_ADMIN_UIDS: "uid-admin" },
  });
  context.after(async () => {
    await server.close();
    await rm(parent, { recursive: true, force: true });
  });

  const unauthenticated = await jsonRequest(`${url}/api/editor/brasfoot-import/sessions`, null, "POST");
  assert.equal(unauthenticated.status, 401);
  const personalAccess = await jsonRequest(`${url}/api/editor/access`, "owner-token");
  assert.equal(personalAccess.status, 200);
  assert.deepEqual(await personalAccess.json(), { canEdit: true });

  const createdResponse = await jsonRequest(`${url}/api/editor/brasfoot-import/sessions`, "editor-token", "POST");
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.sessionId, SESSION_ONE);
  assert.equal(created.id, SESSION_ONE);
  assert.equal(created.limits.maxFiles, 200);

  const traversal = await request(
    `${url}/api/editor/brasfoot-import/sessions/${SESSION_ONE}/files?path=${encodeURIComponent("../teams/escape.ban")}`,
    "editor-token",
    { method: "PUT", body: Buffer.from("x"), contentType: "application/octet-stream" },
  );
  assert.equal(traversal.status, 400);
  assert.equal((await traversal.json()).error.code, "BRASFOOT_IMPORT_PATH_INVALID");

  const extension = await request(
    `${url}/api/editor/brasfoot-import/sessions/${SESSION_ONE}/files?path=${encodeURIComponent("malware.exe")}`,
    "editor-token",
    { method: "PUT", body: Buffer.from("x"), contentType: "application/octet-stream" },
  );
  assert.equal(extension.status, 415);
  assert.equal((await extension.json()).error.code, "BRASFOOT_IMPORT_EXTENSION_INVALID");

  const upload = await request(
    `${url}/api/editor/brasfoot-import/sessions/${SESSION_ONE}/files?path=${encodeURIComponent("Brasfoot/Teams/teste.ban")}`,
    "editor-token",
    { method: "PUT", body: Buffer.from("arquivo-valido"), contentType: "application/octet-stream" },
  );
  assert.equal(upload.status, 201);
  assert.equal((await upload.json()).file.path, "teams/teste.ban");

  const previewResponse = await jsonRequest(
    `${url}/api/editor/brasfoot-import/sessions/${SESSION_ONE}/preview`,
    "editor-token",
    "POST",
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.sessionId, SESSION_ONE);
  assert.equal(preview.summary.clubs, 1);
  assert.equal(preview.clubs[0].id, "teste");
  assert.equal(preview.files[0].path, "teams/teste.ban");
  assert.equal(Array.isArray(preview.report.errors), true);
  assert.equal(preview.report.errorCount, 1);

  const blocked = await jsonRequest(
    `${url}/api/editor/brasfoot-import/sessions/${SESSION_ONE}/commit`,
    "editor-token",
    "POST",
    { allowPartial: false, importAssets: false },
  );
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, "BRASFOOT_IMPORT_PARTIAL_CONFIRMATION_REQUIRED");

  const committedResponse = await jsonRequest(
    `${url}/api/editor/brasfoot-import/sessions/${SESSION_ONE}/commit`,
    "editor-token",
    "POST",
    { allowPartial: true, importAssets: true },
  );
  assert.equal(committedResponse.status, 200);
  const committed = await committedResponse.json();
  assert.equal(committed.sessionId, SESSION_ONE);
  assert.equal(committed.runId, "route-import-run");
  assert.equal(Array.isArray(committed.report.errors), true);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].options.allowPartial, true);
  assert.equal(commits[0].ownerId, "uid-editor");
  assert.equal(commits[0].options.skipAssets, false);
  assert.equal(commits[0].mediaService, service.mediaService);

  const afterCommit = await jsonRequest(
    `${url}/api/editor/brasfoot-import/sessions/${SESSION_ONE}/preview`,
    "editor-token",
    "POST",
  );
  assert.equal(afterCommit.status, 404);

  const second = await (await jsonRequest(
    `${url}/api/editor/brasfoot-import/sessions`,
    "editor-token",
    "POST",
  )).json();
  assert.equal(second.sessionId, SESSION_TWO);
  const deleted = await jsonRequest(
    `${url}/api/editor/brasfoot-import/sessions/${SESSION_TWO}`,
    "editor-token",
    "DELETE",
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { sessionId: SESSION_TWO, id: SESSION_TWO, deleted: true });
});

test("Firestore e Storage compartilham upload, preview e commit entre replicas", async () => {
  const parent = await mkdtemp(join(tmpdir(), "brasfoot-distributed-test-"));
  const database = createFakeFirestore();
  const bucket = new MemoryBucket();
  const commits = [];
  const common = {
    database,
    bucket,
    tempDirectory: parent,
    parseSource: async (root) => {
      assert.equal((await readFile(join(root, "teams", "teste.ban"), "utf8")), "replica-a");
      return parsedSource(root);
    },
    normalize: (data) => structuredClone(data),
    commitImport: async (input) => {
      commits.push(input);
      return { runId: input.runId, generationId: "generation-shared", progress: { phase: "completed" } };
    },
    scheduleCleanup: false,
    nodeEnv: "production",
  };
  const replicaA = new BrasfootImportSessionService(common);
  const replicaB = new BrasfootImportSessionService(common);
  try {
    const created = await replicaA.createSession({ ownerId: "editor" });
    assert.equal(replicaA.storageMode, "firestore-storage");
    await replicaA.uploadFile({
      sessionId: created.id,
      ownerId: "editor",
      path: "teste.ban",
      bytes: Buffer.from("replica-a"),
    });
    await replicaA.close();

    const preview = await replicaB.preview({ sessionId: created.id, ownerId: "editor" });
    assert.equal(preview.summary.clubs, 1);
    const committed = await replicaB.commit({
      sessionId: created.id,
      ownerId: "editor",
      allowPartial: false,
      importAssets: false,
    });
    assert.equal(committed.generationId, "generation-shared");
    assert.equal(commits.length, 1);
    assert.equal(database.has(`brasfootImportSessions/${created.id}`), false);
    assert.equal(bucket.objects.size, 0);
  } finally {
    await replicaA.close();
    await replicaB.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test("lease distribuido impede operacoes simultaneas na mesma sessao", async () => {
  const parent = await mkdtemp(join(tmpdir(), "brasfoot-lease-test-"));
  const database = createFakeFirestore();
  const bucket = new MemoryBucket();
  let releaseParser;
  let parserStarted;
  const started = new Promise((resolve) => { parserStarted = resolve; });
  const parserGate = new Promise((resolve) => { releaseParser = resolve; });
  const options = {
    database,
    bucket,
    tempDirectory: parent,
    parseSource: async (root) => {
      parserStarted();
      await parserGate;
      return parsedSource(root);
    },
    normalize: (data) => structuredClone(data),
    scheduleCleanup: false,
    nodeEnv: "production",
  };
  const replicaA = new BrasfootImportSessionService(options);
  const replicaB = new BrasfootImportSessionService(options);
  try {
    const session = await replicaA.createSession({ ownerId: "editor" });
    await replicaA.uploadFile({
      sessionId: session.id,
      ownerId: "editor",
      path: "teste.ban",
      bytes: Buffer.from("lock"),
    });
    const previewing = replicaA.preview({ sessionId: session.id, ownerId: "editor" });
    await started;
    await assert.rejects(
      () => replicaB.uploadFile({
        sessionId: session.id,
        ownerId: "editor",
        path: "outro.ban",
        bytes: Buffer.from("concorrente"),
      }),
      (error) => error.code === "BRASFOOT_IMPORT_SESSION_BUSY",
    );
    releaseParser();
    await previewing;
    await replicaB.deleteSession({ sessionId: session.id, ownerId: "editor" });
  } finally {
    releaseParser?.();
    await replicaA.close();
    await replicaB.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test("producao rejeita fallback local sem Firestore e bucket", async () => {
  const service = new BrasfootImportSessionService({
    database: createFakeFirestore(),
    bucket: null,
    nodeEnv: "production",
    scheduleCleanup: false,
  });
  try {
    assert.equal(service.storageMode, "unavailable");
    await assert.rejects(
      () => service.createSession({ ownerId: "editor" }),
      (error) => error.code === "BRASFOOT_IMPORT_DISTRIBUTED_STORAGE_REQUIRED" && error.status === 503,
    );
  } finally {
    await service.close();
  }
});

test("replica limpa sessao distribuida expirada e seus blobs", async () => {
  const parent = await mkdtemp(join(tmpdir(), "brasfoot-cleanup-test-"));
  const database = createFakeFirestore();
  const bucket = new MemoryBucket();
  let now = Date.parse("2026-08-29T12:00:00.000Z");
  const options = {
    database,
    bucket,
    tempDirectory: parent,
    limits: { ttlMs: 1_000 },
    now: () => now,
    scheduleCleanup: false,
    nodeEnv: "production",
  };
  const replicaA = new BrasfootImportSessionService(options);
  const replicaB = new BrasfootImportSessionService(options);
  try {
    const session = await replicaA.createSession({ ownerId: "editor" });
    await replicaA.uploadFile({
      sessionId: session.id,
      ownerId: "editor",
      path: "teste.ban",
      bytes: Buffer.from("expira"),
    });
    assert.equal(bucket.objects.size, 1);
    now += 1_001;
    assert.equal(await replicaB.cleanupExpired(), 1);
    assert.equal(database.has(`brasfootImportSessions/${session.id}`), false);
    assert.equal(bucket.objects.size, 0);
  } finally {
    await replicaA.close();
    await replicaB.close();
    await rm(parent, { recursive: true, force: true });
  }
});
