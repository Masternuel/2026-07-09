import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createRoomsRouter } from "../routes/rooms.mjs";
import { jsonRequest } from "./testHarness.mjs";

const USER = Object.freeze({ uid: "uid-career-owner", name: "Manager Carreira" });

function visibleRoom() {
  return {
    id: "room-career",
    code: "BOLA-CR01",
    ownerId: USER.uid,
    managerIds: [USER.uid],
    managers: [{ id: USER.uid, name: USER.name, clubId: "A" }],
    lineups: [],
    careerState: { players: [{ id: "A-P1" }] },
    playerStates: [{ playerId: "A-P1" }],
    marketState: { listings: [] },
  };
}

function fakeStore() {
  const calls = [];
  const store = {
    calls,
    async getCareerSnapshot(code, managerId) {
      calls.push({ method: "getCareerSnapshot", code, managerId });
      return {
        currentSeason: 2,
        players: [{ id: "A-P1", clubId: "A", academy: false }],
        trainingPlans: [],
        nationalSquads: [],
        lastSummary: null,
      };
    },
    async setTrainingPlan(code, managerId, input) {
      calls.push({ method: "setTrainingPlan", code, managerId, input });
      return visibleRoom();
    },
    async renewPlayerContract(code, managerId, input) {
      calls.push({ method: "renewPlayerContract", code, managerId, input });
      return visibleRoom();
    },
    async promoteAcademyPlayer(code, managerId, input) {
      calls.push({ method: "promoteAcademyPlayer", code, managerId, input });
      return visibleRoom();
    },
  };
  return store;
}

async function routeHarness(context) {
  const store = fakeStore();
  const app = express();
  app.use(express.json());
  app.use("/api/rooms", (request, response, next) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (token !== "career-token") {
      response.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Autenticacao obrigatoria" } });
      return;
    }
    request.user = USER;
    next();
  }, createRoomsRouter(store));
  app.use((error, _request, response, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    response.status(status).json({
      error: {
        code: error.code || (error.name === "ValidationError" ? "VALIDATION_ERROR" : "SERVER_ERROR"),
        message: status >= 500 ? "Erro interno do servidor" : error.message,
        details: error.details,
      },
    });
  });
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return { store, url: `http://127.0.0.1:${address.port}` };
}

test("GET career exige auth, normaliza codigo e usa identidade autenticada", async (context) => {
  const { store, url } = await routeHarness(context);

  const anonymous = await jsonRequest(`${url}/api/rooms/BOLA-CR01/career`);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, "AUTH_REQUIRED");

  const invalidToken = await jsonRequest(`${url}/api/rooms/BOLA-CR01/career`, "wrong-token");
  assert.equal(invalidToken.status, 401);

  const response = await jsonRequest(`${url}/api/rooms/bola-cr01/career`, "career-token");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    career: {
      currentSeason: 2,
      players: [{ id: "A-P1", clubId: "A", academy: false }],
      trainingPlans: [],
      nationalSquads: [],
      lastSummary: null,
    },
  });
  assert.deepEqual(store.calls, [{
    method: "getCareerSnapshot",
    code: "BOLA-CR01",
    managerId: USER.uid,
  }]);
});

test("rotas de treino, renovacao e promocao validam/coercem payload", async (context) => {
  const { store, url } = await routeHarness(context);

  const training = await jsonRequest(`${url}/api/rooms/BOLA-CR01/career/training`, "career-token", {
    method: "PUT",
    body: { playerId: "A-P1", focus: "technical", intensity: "high" },
  });
  assert.equal(training.status, 200);
  const trainingBody = await training.json();
  assert.equal(trainingBody.room.code, "BOLA-CR01");
  assert.equal("careerState" in trainingBody.room, false, "estado interno nao pode vazar na resposta");
  assert.equal("playerStates" in trainingBody.room, false);
  assert.equal("marketState" in trainingBody.room, false);

  const renewal = await jsonRequest(`${url}/api/rooms/BOLA-CR01/career/contracts/renew`, "career-token", {
    method: "POST",
    body: { playerId: "A-P1", years: "4", wage: "25000" },
  });
  assert.equal(renewal.status, 200);

  const promotion = await jsonRequest(`${url}/api/rooms/BOLA-CR01/career/academy/promote`, "career-token", {
    method: "POST",
    body: { playerId: "A-Y1" },
  });
  assert.equal(promotion.status, 200);

  assert.deepEqual(store.calls, [
    {
      method: "setTrainingPlan",
      code: "BOLA-CR01",
      managerId: USER.uid,
      input: { playerId: "A-P1", focus: "technical", intensity: "high", active: true },
    },
    {
      method: "renewPlayerContract",
      code: "BOLA-CR01",
      managerId: USER.uid,
      input: { playerId: "A-P1", years: 4, wage: 25_000 },
    },
    {
      method: "promoteAcademyPlayer",
      code: "BOLA-CR01",
      managerId: USER.uid,
      input: { playerId: "A-Y1", years: 3 },
    },
  ]);
});

test("payloads invalidos retornam VALIDATION_ERROR antes de chamar store", async (context) => {
  const { store, url } = await routeHarness(context);
  const cases = [
    {
      path: "career/training",
      method: "PUT",
      body: { playerId: "A-P1", focus: "magia", intensity: "high" },
      issuePath: "focus",
    },
    {
      path: "career/contracts/renew",
      method: "POST",
      body: { playerId: "A-P1", years: 9, wage: 25_000 },
      issuePath: "years",
    },
    {
      path: "career/academy/promote",
      method: "POST",
      body: { playerId: "A-Y1", years: 3, admin: true },
      issuePath: "",
    },
  ];

  for (const entry of cases) {
    const response = await jsonRequest(`${url}/api/rooms/BOLA-CR01/${entry.path}`, "career-token", {
      method: entry.method,
      body: entry.body,
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error.code, "VALIDATION_ERROR");
    assert.equal(payload.error.details.some((issue) => issue.path === entry.issuePath), true);
  }

  const invalidCode = await jsonRequest(`${url}/api/rooms/invalido/career`, "career-token");
  assert.equal(invalidCode.status, 400);
  assert.equal((await invalidCode.json()).error.code, "VALIDATION_ERROR");
  assert.deepEqual(store.calls, []);
});
