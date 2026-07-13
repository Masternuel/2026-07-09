import test from "node:test";
import assert from "node:assert/strict";
import { getServerConfig } from "../config.mjs";
import { jsonRequest, startTestServer } from "./testHarness.mjs";

test("bloqueia modo demo em producao", () => {
  assert.throws(
    () => getServerConfig({ NODE_ENV: "production", ALLOW_DEMO_AUTH: "true" }),
    /nunca pode ser ativado/,
  );
});

test("aceita dev e preview nos hosts locais por padrao", () => {
  const origins = getServerConfig({}).clientOrigin.split(",");
  assert.deepEqual(origins, [
    "http://localhost:5173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4173",
  ]);
});

test("health nao revela o provedor de conteudo social", async (context) => {
  const { server, url } = await startTestServer();
  context.after(() => server.close());

  const response = await jsonRequest(`${url}/health`);
  assert.equal(response.status, 200);
  assert.doesNotMatch(JSON.stringify(await response.json()), /gemini|socialAi|fallback/i);
});

test("rotas exigem token, sobrescrevem identidade e listam somente memberships", async (context) => {
  const { server, url } = await startTestServer();
  context.after(() => server.close());

  const unauthenticated = await jsonRequest(`${url}/api/rooms`);
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error.code, "AUTH_REQUIRED");

  const createResponse = await jsonRequest(`${url}/api/rooms`, "owner-token", {
    method: "POST",
    body: {
      name: "Sala autenticada",
      creatorId: "uid-atacante",
      creatorName: "Nome injetado",
      clubId: "AUR",
    },
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).room;
  assert.equal(created.ownerId, "uid-owner");
  assert.equal(created.managers[0].name, "Dona da Sala");

  const intruderList = await jsonRequest(`${url}/api/rooms`, "intruder-token");
  assert.deepEqual((await intruderList.json()).rooms, []);
  const hiddenRoom = await jsonRequest(`${url}/api/rooms/${created.code}`, "intruder-token");
  assert.equal(hiddenRoom.status, 404);

  const joinResponse = await jsonRequest(`${url}/api/rooms/${created.code}/join`, "second-token", {
    method: "POST",
    body: { managerId: "uid-atacante", managerName: "Nome injetado", clubId: "SAN" },
  });
  assert.equal(joinResponse.status, 200);
  const joined = (await joinResponse.json()).room;
  assert.equal(joined.managers.at(-1).id, "uid-second");
  assert.equal(joined.managers.at(-1).name, "Segundo Manager");

  const memberList = await jsonRequest(`${url}/api/rooms`, "second-token");
  assert.equal((await memberList.json()).rooms.length, 1);
});
