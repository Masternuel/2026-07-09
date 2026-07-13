import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BrasfootImportSessionService,
  normalizeBrasfootUploadPath,
} from "../services/brasfootImportSessions.mjs";
import { startTestServer } from "./testHarness.mjs";

const SESSION_ONE = "11111111-1111-4111-8111-111111111111";
const SESSION_TWO = "22222222-2222-4222-8222-222222222222";

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

test("rotas exigem Editor, mantem contrato flat, confirmam parcial e limpam sessao", async (context) => {
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
  const forbidden = await jsonRequest(`${url}/api/editor/brasfoot-import/sessions`, "owner-token", "POST");
  assert.equal(forbidden.status, 403);

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
