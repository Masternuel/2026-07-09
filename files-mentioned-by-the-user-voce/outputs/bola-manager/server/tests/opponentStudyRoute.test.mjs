import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { FORMATION_ROLES } from "../game/tactics.mjs";
import { REQUIRED_ATTRIBUTE_KEYS } from "../game/lineupStrength.mjs";
import { createRoomsRouter } from "../routes/rooms.mjs";
import { jsonRequest } from "./testHarness.mjs";

const ROOM_CODE = "BOLA-STDY";

function attributes(value, overrides = {}) {
  return Object.fromEntries(
    REQUIRED_ATTRIBUTE_KEYS.map((attribute) => [attribute, overrides[attribute] ?? value]),
  );
}

function opponentRoster() {
  return FORMATION_ROLES["4-4-2"].map((position, index) => ({
    id: `opp-${index + 1}`,
    clubId: "OPP",
    name: position === "ATA" && index === 9 ? "Artilheiro Real" : `Atleta ${index + 1}`,
    position,
    overall: position === "ATA" && index === 9 ? 19 : 12,
    active: true,
    attributes: attributes(position === "ATA" && index === 9 ? 18 : 11, {
      chute: position === "ATA" && index === 9 ? 20 : 11,
      nocao: position === "ATA" && index === 9 ? 19 : 11,
    }),
  }));
}

function studyRoom() {
  const roster = opponentRoster();
  return {
    code: ROOM_CODE,
    ownerId: "owner-1",
    catalogOwnerId: "database-owner",
    managers: [
      { id: "owner-1", name: "Emanuel", clubId: "VIEW" },
      { id: "opponent-1", name: "Adversario", clubId: "OPP" },
    ],
    completedFixtureIds: [],
    fixtureSchedule: [{
      fixtureId: "fixture-study-1",
      homeClubId: "VIEW",
      awayClubId: "OPP",
      homeTeam: "Clube do Manager",
      awayTeam: "Clube Real",
    }],
    competitionCatalog: [{
      id: "league-1",
      name: "Liga Teste",
      clubs: [
        { id: "VIEW", name: "Clube do Manager", code: "VIE" },
        { id: "OPP", name: "Clube Real", code: "REA" },
      ],
    }],
    lineups: [{
      managerId: "opponent-1",
      clubId: "OPP",
      lineupIds: roster.map((player) => player.id),
      tactics: {
        formationId: "5-4-1",
        mentality: "attacking",
        secret: true,
        secretMarker: "PLANO_SECRETO_NAO_PODE_VAZAR",
        teamInstructions: {
          pressureLine: "very-high",
          pressing: "aggressive",
          tempo: "very-fast",
        },
      },
    }],
  };
}

async function routeHarness(context) {
  const room = studyRoom();
  const roster = opponentRoster();
  const calls = { membership: [], owners: [], rosterClubs: [] };
  const store = {
    async requireMembership(code, managerId) {
      calls.membership.push({ code, managerId });
      if (!room.managers.some((manager) => manager.id === managerId)) {
        const error = new Error("Manager nao pertence a sala");
        error.code = "ROOM_MEMBERSHIP_REQUIRED";
        error.status = 403;
        throw error;
      }
      return structuredClone(room);
    },
  };
  const catalogStore = {
    forOwner(ownerId) {
      calls.owners.push(ownerId);
      return {
        async ensureInitialized() {},
        async listPlayers(clubId) {
          calls.rosterClubs.push(clubId);
          const players = clubId === "OPP" ? structuredClone(roster) : [];
          return { players, count: players.length, source: "catalog-test" };
        },
      };
    },
  };
  const app = express();
  app.use("/api/rooms", (request, response, next) => {
    const users = {
      "owner-token": { uid: "owner-1", name: "Emanuel" },
      "intruder-token": { uid: "intruder", name: "Intruso" },
    };
    request.user = users[request.headers.authorization?.replace(/^Bearer\s+/i, "")];
    if (!request.user) {
      response.status(401).json({ error: { code: "AUTH_REQUIRED" } });
      return;
    }
    next();
  }, createRoomsRouter(store, catalogStore));
  app.use((error, _request, response, _next) => {
    response.status(error.status ?? 500).json({
      error: { code: error.code ?? "SERVER_ERROR", message: error.message },
    });
  });

  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return { calls, url: `http://127.0.0.1:${server.address().port}` };
}

test("GET opponent-study exige autenticacao e membership antes de acessar a base", async (context) => {
  const { calls, url } = await routeHarness(context);

  const anonymous = await jsonRequest(`${url}/api/rooms/${ROOM_CODE}/opponent-study`);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, "AUTH_REQUIRED");

  const denied = await jsonRequest(
    `${url}/api/rooms/${ROOM_CODE}/opponent-study?depth=deep`,
    "intruder-token",
  );
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "ROOM_MEMBERSHIP_REQUIRED");
  assert.deepEqual(calls.owners, [], "intruso nao pode abrir a base pessoal do dono");
  assert.deepEqual(calls.rosterClubs, []);
});

test("GET opponent-study usa profundidade e elenco real sem revelar tatica secreta", async (context) => {
  const { calls, url } = await routeHarness(context);

  const quickResponse = await jsonRequest(
    `${url}/api/rooms/bola-stdy/opponent-study?depth=quick`,
    "owner-token",
  );
  assert.equal(quickResponse.status, 200);
  const quick = (await quickResponse.json()).study;

  const deepResponse = await jsonRequest(
    `${url}/api/rooms/${ROOM_CODE}/opponent-study?depth=deep`,
    "owner-token",
  );
  assert.equal(deepResponse.status, 200);
  const deepBody = await deepResponse.json();
  const deep = deepBody.study;

  assert.equal(quick.depth, "quick");
  assert.equal(deep.depth, "deep");
  assert.ok(deep.confidence > quick.confidence);
  assert.ok(Number.isFinite(deep.estimatedStudyHours));
  assert.ok(deep.estimatedStudyHours > quick.estimatedStudyHours);
  assert.ok(deep.scoutingSpeedMultiplier >= 0.7 && deep.scoutingSpeedMultiplier <= 1);
  assert.equal(deep.fixtureId, "fixture-study-1");
  assert.equal(deep.opponentClubId, "OPP");
  assert.equal(deep.opponentName, "Clube Real");
  assert.equal(deep.probableLineup.length, 11);
  assert.ok(deep.probableLineup.every((player) => player.id.startsWith("opp-")));
  assert.equal(deep.dangerousPlayers[0].name, "Artilheiro Real");

  assert.equal(deep.source, "estimated");
  assert.equal(deep.probableFormation, "4-3-3", "plano secreto nao pode ser inferido da escalação autoritativa");
  const serialized = JSON.stringify(deepBody);
  assert.doesNotMatch(serialized, /5-4-1|PLANO_SECRETO_NAO_PODE_VAZAR|very-high|very-fast/);

  assert.deepEqual(calls.owners, ["database-owner", "database-owner"]);
  assert.deepEqual(calls.rosterClubs, ["OPP", "OPP"]);
  assert.deepEqual(calls.membership, [
    { code: ROOM_CODE, managerId: "owner-1" },
    { code: ROOM_CODE, managerId: "owner-1" },
  ]);
});
