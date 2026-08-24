import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createRoomsRouter } from "../routes/rooms.mjs";
import { jsonRequest } from "./testHarness.mjs";

const USER = Object.freeze({ uid: "uid-coach", name: "Treinador" });

function room() {
  return {
    id: "room-coach",
    code: "BOLA-C0A1",
    ownerId: USER.uid,
    managerIds: [USER.uid],
    managers: [{ id: USER.uid, name: USER.name, clubId: "SAN" }],
    lineups: [],
    revision: 2,
  };
}

function snapshot() {
  return {
    coach: { id: USER.uid, name: USER.name, status: "employed", currentClubId: "SAN" },
    activeEmployment: { id: "job-1", coachId: USER.uid, clubId: "SAN", status: "employed" },
    contracts: [],
    proposals: [],
    vacancies: [],
    applications: [],
    interviews: [],
    assignments: [],
    news: [],
  };
}

function fakeStore() {
  const calls = [];
  const result = () => ({ room: room(), coachCareer: snapshot() });
  return {
    calls,
    async getCoachCareerSnapshot(code, managerId) {
      calls.push({ method: "get", code, managerId });
      return snapshot();
    },
    async respondCoachProposal(code, managerId, id, input) {
      calls.push({ method: "proposal", code, managerId, id, input }); return result();
    },
    async respondCoachBoardDecision(code, managerId, id, input) {
      calls.push({ method: "board", code, managerId, id, input }); return result();
    },
    async applyForCoachVacancy(code, managerId, id, input) {
      calls.push({ method: "vacancy", code, managerId, id, input }); return result();
    },
    async respondCoachInterview(code, managerId, id, input) {
      calls.push({ method: "interview", code, managerId, id, input }); return result();
    },
    async startCoachInterview(code, managerId, id, input) {
      calls.push({ method: "interview-start", code, managerId, id, input }); return result();
    },
    async answerCoachInterviewTurn(code, managerId, id, input) {
      calls.push({ method: "interview-turn", code, managerId, id, input }); return result();
    },
    async renewCoachContract(code, managerId, input) {
      calls.push({ method: "renew", code, managerId, input }); return result();
    },
    async resignCoach(code, managerId, input) {
      calls.push({ method: "resign", code, managerId, input }); return result();
    },
    async setCoachJobSearch(code, managerId, input) {
      calls.push({ method: "search", code, managerId, input }); return result();
    },
  };
}

async function harness(context) {
  const store = fakeStore();
  const app = express();
  app.use(express.json());
  app.use("/api/rooms", (request, response, next) => {
    if (request.headers.authorization !== "Bearer coach-token") {
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
        code: error.name === "ValidationError" ? "VALIDATION_ERROR" : error.code ?? "SERVER_ERROR",
        message: error.message,
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
  return { store, url: `http://127.0.0.1:${server.address().port}` };
}

test("coach-career usa a identidade autenticada e nao expoe estado interno", async (context) => {
  const { store, url } = await harness(context);
  const unauthorized = await jsonRequest(`${url}/api/rooms/BOLA-C0A1/coach-career`);
  assert.equal(unauthorized.status, 401);

  const response = await jsonRequest(`${url}/api/rooms/bola-c0a1/coach-career`, "coach-token");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.coachCareer.coach.id, USER.uid);
  assert.deepEqual(store.calls, [{ method: "get", code: "BOLA-C0A1", managerId: USER.uid }]);
});

test("coach-career valida e encaminha propostas, vagas, entrevistas e contrato", async (context) => {
  const { store, url } = await harness(context);
  const request = (path, body) => jsonRequest(`${url}/api/rooms/BOLA-C0A1/coach-career/${path}`, "coach-token", {
    method: "POST",
    body: { requestId: `request-${path.replace(/[^a-z]/gi, "-")}`, ...body },
  });

  assert.equal((await request("proposals/P1/respond", { action: "counter", salary: 250_000 })).status, 200);
  assert.equal((await request("proposals/P1/board-response", {
    action: "new_offer",
    responsible: "Diretoria",
    justification: "Novo limite aprovado",
    salary: 275_000,
    signingBonus: 300_000,
  })).status, 200);
  assert.equal((await request("vacancies/V1/apply", { message: "Projeto compativel" })).status, 200);
  assert.equal((await request("interviews/I1/respond", { answers: [{ questionId: "style", answerId: "balanced" }] })).status, 200);
  assert.equal((await request("interviews/I2/start", { depth: "deep" })).status, 200);
  assert.equal((await request("interviews/I2/turn", {
    message: "Quero construir um projeto competitivo usando a base.",
    currentQuestionId: "question-1",
    expectedRevision: 1,
  })).status, 200);
  assert.equal((await request("contracts/renew", { years: "3", salary: "300000" })).status, 200);
  assert.equal((await request("resign", { reason: "Fim de ciclo" })).status, 200);
  assert.equal((await request("search", { active: true })).status, 200);

  assert.deepEqual(store.calls.map((entry) => entry.method), [
    "proposal", "board", "vacancy", "interview", "interview-start", "interview-turn", "renew", "resign", "search",
  ]);
  assert.equal(store.calls[0].input.salary, 250_000);
  assert.equal(store.calls[1].input.salary, 275_000);
  assert.equal(store.calls[1].input.signingBonus, 300_000);
  assert.equal(store.calls[6].input.years, 3);
  assert.equal(store.calls[5].input.expectedRevision, 1);

  const invalid = await request("proposals/P1/respond", { action: "counter" });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "VALIDATION_ERROR");
});
