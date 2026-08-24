import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import { DEFAULT_TACTIC_PLAN, FORMATION_ROLES } from "../game/tactics.mjs";
import { startTestServer } from "./testHarness.mjs";

function connect(url) {
  return new Promise((resolve, reject) => {
    const client = createClient(url, {
      auth: { token: "owner-token" },
      forceNew: true,
      reconnection: false,
      timeout: 1_000,
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function roster() {
  const starters = FORMATION_ROLES["4-3-3"].map((position, index) => ({
    id: `p${index + 1}`,
    clubId: "AUR",
    name: `Titular ${index + 1}`,
    position,
    active: true,
  }));
  return [
    ...starters,
    { id: "reserve", clubId: "AUR", name: "Reserva", position: "ATA", active: true },
    { id: "injured", clubId: "AUR", name: "Lesionado", position: "PD", active: true, injured: true },
  ];
}

test("lineup persiste plano e entrosamento, valida titulares e progride apos partida", async (context) => {
  const players = roster();
  const catalogStore = {
    source: "test",
    async listPlayers() {
      return { players, count: players.length, source: "test" };
    },
  };
  const { server, url } = await startTestServer({ catalogStore });
  context.after(() => server.close());
  const client = await connect(url);
  context.after(() => client.disconnect());
  const created = await client.timeout(1_000).emitWithAck("room:create", {
    name: "Entrosamento persistido",
    clubId: "AUR",
  });
  const code = created.room.code;
  const lineupIds = players.slice(0, 11).map((player) => player.id);
  const tacticPlan = structuredClone(DEFAULT_TACTIC_PLAN);

  const short = await client.timeout(1_000).emitWithAck("lineup:save", {
    code,
    lineupIds: lineupIds.slice(0, 10),
  });
  assert.equal(short.ok, false);
  assert.equal(short.error.code, "VALIDATION_ERROR");

  const noGoalkeeper = await client.timeout(1_000).emitWithAck("lineup:save", {
    code,
    lineupIds: ["reserve", ...lineupIds.slice(1)],
  });
  assert.equal(noGoalkeeper.ok, false);
  assert.equal(noGoalkeeper.error.code, "LINEUP_GOALKEEPER_COUNT");

  const unavailable = await client.timeout(1_000).emitWithAck("lineup:save", {
    code,
    lineupIds: [...lineupIds.slice(0, 10), "injured"],
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, "LINEUP_PLAYER_UNAVAILABLE");

  const first = await client.timeout(1_000).emitWithAck("lineup:save", {
    code,
    lineupIds,
    tactics: tacticPlan,
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first.lineup.tactics, tacticPlan);
  assert.equal(first.lineup.cohesion.exactPositionCount, 11);
  assert.equal(first.lineup.cohesion.outOfPositionCount, 0);

  const repeated = await client.timeout(1_000).emitWithAck("lineup:save", { code, lineupIds });
  assert.equal(repeated.ok, true);
  assert.deepEqual(repeated.lineup.tactics, tacticPlan);
  assert.equal(repeated.lineup.cohesion.score, first.lineup.cohesion.score);
  assert.equal(repeated.lineup.cohesion.stableMatches, 0);

  const misplacedIds = [...lineupIds];
  [misplacedIds[1], misplacedIds[9]] = [misplacedIds[9], misplacedIds[1]];
  const misplaced = await client.timeout(1_000).emitWithAck("lineup:save", {
    code,
    lineupIds: misplacedIds,
  });
  assert.equal(misplaced.ok, true);
  assert.equal(misplaced.warnings.length, 2);
  assert.equal(misplaced.lineup.cohesion.outOfPositionCount, 2);
  assert.ok(misplaced.lineup.cohesion.score < repeated.lineup.cohesion.score);

  const restored = await client.timeout(1_000).emitWithAck("lineup:save", { code, lineupIds });
  assert.equal(restored.ok, true);
  await client.timeout(1_000).emitWithAck("room:ready", { code, ready: true });
  const started = await client.timeout(1_000).emitWithAck("room:start", { code });
  const fixtureId = started.room.currentFixtureId;
  await server.store.completeMatch(code, fixtureId, {
    id: "cohesion-match",
    homeTeam: "Aurora",
    awayTeam: "Adversario",
    score: [1, 0],
    statistics: {},
    tacticalMatchup: {
      home: { edge: 0.2, modifier: 0.1 },
      away: { edge: -0.2, modifier: -0.1 },
      reasons: ["pressing-vs-build-up"],
    },
  });
  const completed = await server.store.getRoom(code);
  const savedLineup = completed.lineups.find((lineup) => lineup.managerId === "uid-owner");
  assert.equal(savedLineup.cohesion.exactPositionCount, 11);
  assert.equal(savedLineup.cohesion.outOfPositionCount, 0);
  assert.equal(savedLineup.cohesion.stableMatches, 1);
  assert.ok(savedLineup.cohesion.score > restored.lineup.cohesion.score);
  assert.deepEqual(completed.lastCompletedMatch.tacticalMatchup.reasons, ["pressing-vs-build-up"]);
});
