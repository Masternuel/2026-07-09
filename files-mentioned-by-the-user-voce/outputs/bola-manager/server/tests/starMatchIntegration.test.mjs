import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import { calculateStarImpact } from "../game/starImpact.mjs";
import { jsonRequest, startTestServer } from "./testHarness.mjs";

function connect(url, token = "owner-token") {
  return new Promise((resolve, reject) => {
    const client = createClient(url, {
      auth: { token },
      forceNew: true,
      reconnection: false,
      timeout: 1_000,
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function waitForRoomState(socket, predicate) {
  return new Promise((resolve) => {
    const handler = (room) => {
      if (!predicate(room)) return;
      socket.off("room:state", handler);
      resolve(room);
    };
    socket.on("room:state", handler);
  });
}

test("cada manager ve apenas a propria escalacao enquanto a partida usa ambas", async (context) => {
  const playersByClub = {
    AUR: [{ id: "aur-star", clubId: "AUR", name: "Estrela AUR", overall: 20, active: true, isStar: true }],
    SAN: [{ id: "san-star", clubId: "SAN", name: "Estrela SAN", overall: 20, active: true, isStar: true }],
  };
  const catalogStore = {
    source: "firestore",
    async listPlayers(clubId) {
      const players = playersByClub[clubId] ?? [];
      return { players, count: players.length, source: "firestore" };
    },
    async getStarImpact(clubId, options) {
      return calculateStarImpact(clubId, playersByClub[clubId] ?? [], options);
    },
  };
  const { server, url } = await startTestServer({ catalogStore });
  context.after(() => server.close());
  const owner = await connect(url);
  const second = await connect(url, "second-token");
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());
  const created = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Taticas privadas",
    clubId: "AUR",
    maxManagers: 2,
  });
  await second.timeout(1_000).emitWithAck("room:join", { code: created.room.code, clubId: "SAN" });
  const ownerSaved = await owner.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    lineupIds: ["aur-star"],
  });
  assert.deepEqual(ownerSaved.room.lineups.map((lineup) => lineup.managerId), ["uid-owner"]);

  const ownerState = waitForRoomState(owner, (room) => room.lineups[0]?.managerId === "uid-owner");
  const secondState = waitForRoomState(second, (room) => room.lineups[0]?.managerId === "uid-second");
  const secondSaved = await second.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    lineupIds: ["san-star"],
  });
  assert.deepEqual(secondSaved.room.lineups.map((lineup) => lineup.managerId), ["uid-second"]);
  assert.deepEqual((await ownerState).lineups.map((lineup) => lineup.managerId), ["uid-owner"]);
  assert.deepEqual((await secondState).lineups.map((lineup) => lineup.managerId), ["uid-second"]);

  const ownerSync = await owner.timeout(1_000).emitWithAck("room:sync", { code: created.room.code });
  const secondSync = await second.timeout(1_000).emitWithAck("room:sync", { code: created.room.code });
  assert.deepEqual(ownerSync.room.lineups.map((lineup) => lineup.managerId), ["uid-owner"]);
  assert.deepEqual(secondSync.room.lineups.map((lineup) => lineup.managerId), ["uid-second"]);

  const ownerRest = await (await jsonRequest(`${url}/api/rooms/${created.room.code}`, "owner-token")).json();
  const secondRest = await (await jsonRequest(`${url}/api/rooms`, "second-token")).json();
  assert.deepEqual(ownerRest.room.lineups.map((lineup) => lineup.managerId), ["uid-owner"]);
  assert.deepEqual(secondRest.rooms[0].lineups.map((lineup) => lineup.managerId), ["uid-second"]);
  assert.deepEqual(
    (await server.store.getRoom(created.room.code)).lineups.map((lineup) => lineup.managerId).sort(),
    ["uid-owner", "uid-second"],
  );

  await owner.timeout(1_000).emitWithAck("room:ready", { code: created.room.code, ready: true });
  await second.timeout(1_000).emitWithAck("room:ready", { code: created.room.code, ready: true });
  const ownerStartedEvent = new Promise((resolve) => owner.once("room:started", resolve));
  const secondStartedEvent = new Promise((resolve) => second.once("room:started", resolve));
  await owner.timeout(1_000).emitWithAck("room:start", { code: created.room.code });
  assert.deepEqual((await ownerStartedEvent).lineups.map((lineup) => lineup.managerId), ["uid-owner"]);
  assert.deepEqual((await secondStartedEvent).lineups.map((lineup) => lineup.managerId), ["uid-second"]);

  for (let index = 0; index < 4; index += 1) {
    const room = await server.store.getRoom(created.room.code);
    await server.store.completeMatch(room.code, room.currentFixtureId, {
      id: `skip-${index}`,
      homeTeam: "A",
      awayTeam: "B",
      score: [0, 0],
      statistics: {},
      skipped: true,
    });
  }
  const humanFixtureRoom = await server.store.getRoom(created.room.code);
  assert.deepEqual(humanFixtureRoom.fixtureSchedule
    .find((fixture) => fixture.fixtureId === humanFixtureRoom.currentFixtureId).managerIds.sort(), [
    "uid-owner", "uid-second",
  ]);
  await owner.timeout(1_000).emitWithAck("match:ready", { code: created.room.code, ready: true });
  const finished = new Promise((resolve) => owner.once("match:finished", resolve));
  const match = await second.timeout(1_000).emitWithAck("match:ready", {
    code: created.room.code,
    ready: true,
  });
  assert.equal(match.starImpact.home.lineupSource, "saved");
  assert.equal(match.starImpact.away.lineupSource, "saved");
  assert.equal(match.starImpact.home.playingStarCount, 1);
  assert.equal(match.starImpact.away.playingStarCount, 1);
  await finished;
});

async function activeRoom(client) {
  const created = await client.timeout(1_000).emitWithAck("room:create", {
    name: "Sala das Estrelas",
    clubId: "AUR",
  });
  await client.timeout(1_000).emitWithAck("room:ready", { code: created.room.code, ready: true });
  const started = await client.timeout(1_000).emitWithAck("room:start", { code: created.room.code });
  return started.room;
}

function stars(clubId, count) {
  return calculateStarImpact(clubId, Array.from({ length: count }, (_, index) => ({
    id: `${clubId}-${index}`,
    name: `Estrela ${index}`,
    isStar: true,
    active: true,
  })));
}

test("lineup:save aceita IDs demo canonicos, persiste snapshot e valida payload", async (context) => {
  const catalogStore = {
    source: "demo-fallback",
    async listPlayers() {
      return { players: [], count: 0, source: "demo-fallback" };
    },
    async getStarImpact(clubId, options) {
      return calculateStarImpact(clubId, [], options);
    },
  };
  const { server, url } = await startTestServer({ catalogStore });
  context.after(() => server.close());
  const client = await connect(url);
  context.after(() => client.disconnect());
  const created = await client.timeout(1_000).emitWithAck("room:create", {
    name: "Escalacao demo",
    clubId: "AUR",
  });
  const lineupIds = Array.from({ length: 11 }, (_, index) => `p${String(index + 1).padStart(2, "0")}`);
  const saved = await client.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    lineupIds,
  });

  assert.equal(saved.ok, true);
  assert.equal(saved.source, "demo-fallback");
  assert.deepEqual(saved.lineup.lineupIds, lineupIds);
  assert.deepEqual(saved.room.lineups, [saved.lineup]);
  assert.deepEqual((await server.store.getRoom(created.room.code)).lineups, [saved.lineup]);

  const tooMany = await client.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    lineupIds: [...lineupIds, "p12"],
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error.code, "VALIDATION_ERROR");
  const invalidPlayer = await client.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    lineupIds: ["p21"],
  });
  assert.equal(invalidPlayer.ok, false);
  assert.equal(invalidPlayer.error.code, "LINEUP_PLAYER_NOT_IN_CLUB");
  const forgedClub = await client.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    clubId: "SAN",
    lineupIds: ["p01"],
  });
  assert.equal(forgedClub.ok, false);
  assert.equal(forgedClub.error.code, "VALIDATION_ERROR");
});

test("partida usa estrela da escalacao salva mesmo quando seria reserva por overall", async (context) => {
  const regulars = Array.from({ length: 11 }, (_, index) => ({
    id: `r${index}`,
    clubId: "AUR",
    name: `Regular ${index}`,
    overall: 20 - index / 10,
    active: true,
    isStar: false,
  }));
  const reserveStar = {
    id: "star-low", clubId: "AUR", name: "Estrela", overall: 1, active: true, isStar: true,
  };
  const auroraPlayers = [...regulars, reserveStar];
  const catalogStore = {
    source: "firestore",
    async listPlayers(clubId) {
      return { players: clubId === "AUR" ? auroraPlayers : [], count: auroraPlayers.length, source: "firestore" };
    },
    async getStarImpact(clubId, options) {
      return calculateStarImpact(clubId, clubId === "AUR" ? auroraPlayers : [], options);
    },
  };
  const { server, url } = await startTestServer({ catalogStore });
  context.after(() => server.close());
  const client = await connect(url);
  context.after(() => client.disconnect());
  const created = await client.timeout(1_000).emitWithAck("room:create", {
    name: "Escalacao real",
    clubId: "AUR",
  });
  const lineupIds = [reserveStar.id, ...regulars.slice(0, 10).map((player) => player.id)];
  const saved = await client.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    lineupIds,
  });
  assert.equal(saved.ok, true);
  await client.timeout(1_000).emitWithAck("room:ready", { code: created.room.code, ready: true });
  const active = await client.timeout(1_000).emitWithAck("room:start", { code: created.room.code });
  const finished = new Promise((resolve) => client.once("match:finished", resolve));
  const start = await client.timeout(1_000).emitWithAck("match:ready", {
    code: active.room.code,
    ready: true,
  });

  assert.equal(start.ok, true);
  assert.equal(start.starImpact.home.lineupSource, "saved");
  assert.equal(start.starImpact.home.starCount, 1);
  assert.equal(start.starImpact.home.playingStarCount, 1);
  assert.equal(start.strengthProfile.home.starBonus, 0.25);
  await finished;
});

test("partida real aplica perfil de estrelas uma unica vez e persiste metadados", async (context) => {
  const catalogStore = {
    source: "test",
    async getStarImpact(clubId) {
      return stars(clubId, clubId === "AUR" ? 4 : 0);
    },
  };
  const { server, url } = await startTestServer({ catalogStore });
  context.after(() => server.close());
  const client = await connect(url);
  context.after(() => client.disconnect());
  const room = await activeRoom(client);
  const finished = new Promise((resolve) => client.once("match:finished", resolve));

  const start = await client.timeout(1_000).emitWithAck("match:ready", {
    code: room.code,
    ready: true,
  });
  assert.equal(start.ok, true);
  assert.equal(start.starImpact.home.starCount, 4);
  assert.equal(start.starImpact.away.starCount, 0);
  assert.equal(start.strengthProfile.home.starBonus, 1);
  assert.equal(
    start.strengthProfile.home.effective,
    start.strengthProfile.home.base + 1,
  );

  const result = await finished;
  assert.deepEqual(result.starImpact, start.starImpact);
  assert.deepEqual(result.strengthProfile, start.strengthProfile);
  assert.deepEqual((await server.store.getRoom(room.code)).lastCompletedMatch.starImpact, start.starImpact);
});

test("reserva matchSessions enquanto consulta assincrona impede inicio concorrente", async (context) => {
  let releaseLookup;
  let notifyLookup;
  const lookupStarted = new Promise((resolve) => { notifyLookup = resolve; });
  const lookupGate = new Promise((resolve) => { releaseLookup = resolve; });
  const catalogStore = {
    source: "test",
    async getStarImpact(clubId) {
      notifyLookup();
      await lookupGate;
      return stars(clubId, 0);
    },
  };
  const { server, url } = await startTestServer({ catalogStore });
  context.after(() => server.close());
  const client = await connect(url);
  context.after(() => client.disconnect());
  const room = await activeRoom(client);
  const finished = new Promise((resolve) => client.once("match:finished", resolve));

  const firstStart = client.timeout(1_000).emitWithAck("match:ready", { code: room.code, ready: true });
  await lookupStarted;
  const concurrent = await client.timeout(1_000).emitWithAck("match:ready", {
    code: room.code,
    ready: true,
  });
  assert.equal(concurrent.ok, false);
  assert.equal(concurrent.error.code, "MATCH_IN_PROGRESS");

  releaseLookup();
  const started = await firstStart;
  assert.equal(started.ok, true);
  await finished;
});
