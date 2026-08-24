import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import { createRoomSchema, parseOrThrow } from "../schemas.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { automaticallyReadyAtHalftime, startTestServer } from "./testHarness.mjs";

function storeWith(persistence = new MemoryRoomPersistence()) {
  return new RoomStore({
    persistence,
    codeFactory: () => "BOLA-CARR",
    now: () => new Date("2026-07-12T12:00:00.000Z"),
  });
}

async function createActiveCareer({ seasonLength = 1, unlimitedSeasons = false } = {}) {
  const store = storeWith();
  const room = await store.createRoom({
    name: "Carreira",
    creatorId: "manager-1",
    creatorName: "Manager",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength,
    unlimitedSeasons,
    maxManagers: 1,
  });
  await store.setReady(room.code, "manager-1", true);
  return { store, room: await store.startRoom(room.code, "manager-1") };
}

async function completeCurrentSeason(store, code, prefix) {
  const season = (await store.getRoom(code)).currentSeason;
  let completion;
  let index = 0;
  while ((await store.getRoom(code)).currentSeason === season) {
    const room = await store.getRoom(code);
    if (!room.currentFixtureId) break;
    const fixture = room.fixtureSchedule.find((candidate) => candidate.fixtureId === room.currentFixtureId);
    completion = await store.completeMatch(code, room.currentFixtureId, {
      id: `${prefix}-${index}`,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      score: [1, 0],
      statistics: { home: {}, away: {} },
      skipped: false,
    });
    index += 1;
  }
  return { completion, matchCount: index };
}

test("schema e criacao representam carreira ilimitada sem alterar seasonLength", async () => {
  const parsed = parseOrThrow(createRoomSchema, {
    name: "Carreira sem fim",
    activeLeagues: ["BR-A"],
    seasonLength: 3,
    unlimitedSeasons: true,
  });
  assert.equal(parsed.unlimitedSeasons, true);
  assert.equal(parseOrThrow(createRoomSchema, {
    name: "Carreira finita", activeLeagues: ["BR-A"], seasonLength: 3,
  }).unlimitedSeasons, false);

  const { room } = await createActiveCareer({ seasonLength: 1, unlimitedSeasons: true });
  assert.equal(room.seasonLength, 1);
  assert.equal(room.unlimitedSeasons, true);
  assert.equal(room.currentSeason, 1);
  assert.equal(room.seasonYear, 2026);
  assert.equal(room.careerCompleted, false);
});

test("carreira ilimitada arquiva temporada, persiste historico e abre calendario seguinte", async () => {
  const { store, room } = await createActiveCareer({ seasonLength: 1, unlimitedSeasons: true });
  await store.saveLineup(room.code, "manager-1", "AUR", ["p08"]);
  const fixtureCount = room.fixtureSchedule.length;
  const { completion, matchCount } = await completeCurrentSeason(store, room.code, "s1");
  const transitioned = completion.room;

  assert.equal(matchCount, fixtureCount);
  assert.equal(transitioned.currentSeason, 2);
  assert.equal(transitioned.seasonYear, 2027);
  assert.equal(transitioned.currentFixtureId, "abertura");
  assert.equal(transitioned.fixtureSchedule.length, fixtureCount);
  assert.deepEqual(transitioned.completedFixtureIds, []);
  assert.equal(transitioned.completedMatches.length, fixtureCount);
  assert.deepEqual(transitioned.lineups, []);
  assert.equal(transitioned.careerCompleted, false);
  assert.equal(transitioned.seasonHistory.length, 1);
  assert.equal(transitioned.seasonHistory[0].seasonNumber, 1);
  assert.equal(transitioned.seasonHistory[0].matchIds.length, fixtureCount);
  assert.equal(completion.summary.seasonNumber, 1);
  assert.equal(completion.summary.nextSeasonNumber, 2);
  assert.equal(completion.summary.nextFixtureId, "abertura");

  const persisted = await store.getRoom(room.code);
  assert.equal(persisted.currentSeason, 2);
  assert.equal(persisted.completedMatches.length, fixtureCount);
  assert.equal(persisted.completedMatches[0].seasonYear, 2026);
});

test("carreira finita abre somente as temporadas configuradas e entao termina", async () => {
  const { store, room } = await createActiveCareer({ seasonLength: 2 });
  const first = await completeCurrentSeason(store, room.code, "finite-1");
  assert.equal(first.completion.room.currentSeason, 2);
  assert.equal(first.completion.room.careerCompleted, false);

  const second = await completeCurrentSeason(store, room.code, "finite-2");
  const finished = second.completion.room;
  assert.equal(finished.currentSeason, 2);
  assert.equal(finished.currentFixtureId, null);
  assert.equal(finished.careerCompleted, true);
  assert.equal(typeof finished.careerCompletedAt, "string");
  assert.equal(finished.seasonHistory.length, 2);
  assert.equal(finished.completedMatches.length, first.matchCount + second.matchCount);
});

test("save legado recebe estado de carreira e persiste migracao transacional", async () => {
  const original = await createActiveCareer({ seasonLength: 3 });
  const legacy = await original.store.getRoom(original.room.code);
  for (const key of [
    "unlimitedSeasons", "currentSeason", "seasonYear", "seasonStartedAt",
    "seasonHistory", "careerCompleted", "careerCompletedAt",
  ]) delete legacy[key];
  const persistence = new MemoryRoomPersistence([legacy]);
  const store = storeWith(persistence);

  const visible = await store.getRoom(legacy.code);
  assert.equal(visible.unlimitedSeasons, false);
  assert.equal(visible.currentSeason, 1);
  assert.equal(visible.seasonYear, 2026);
  const prepared = await store.prepareMatch(legacy.code, "manager-1", legacy.currentFixtureId);
  assert.equal(prepared.migrated, true);
  const persisted = await persistence.get(legacy.code);
  assert.equal(persisted.unlimitedSeasons, false);
  assert.equal(persisted.currentSeason, 1);
  assert.deepEqual(persisted.seasonHistory, []);
});

test("match:finished aponta primeiro jogo da nova temporada ilimitada", async (context) => {
  const { server, url } = await startTestServer();
  context.after(() => server.close());
  const client = await new Promise((resolve, reject) => {
    const socket = createClient(url, {
      auth: { token: "owner-token" }, forceNew: true, reconnection: false, timeout: 1_000,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
  context.after(() => client.disconnect());
  const created = await client.timeout(1_000).emitWithAck("room:create", {
    name: "Carreira Socket",
    clubId: "AUR",
    seasonLength: 1,
    unlimitedSeasons: true,
  });
  await client.timeout(1_000).emitWithAck("room:ready", { code: created.room.code, ready: true });
  await client.timeout(1_000).emitWithAck("room:start", { code: created.room.code });

  const scheduleLength = (await server.store.getRoom(created.room.code)).fixtureSchedule.length;
  for (let index = 0; index < scheduleLength - 1; index += 1) {
    const room = await server.store.getRoom(created.room.code);
    const fixture = room.fixtureSchedule.find((candidate) => candidate.fixtureId === room.currentFixtureId);
    await server.store.completeMatch(room.code, room.currentFixtureId, {
      id: `direct-${index}`,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      score: [0, 0],
      statistics: {},
      skipped: true,
    });
  }
  const finished = new Promise((resolve) => client.once("match:finished", resolve));
  automaticallyReadyAtHalftime(client);
  await client.timeout(1_000).emitWithAck("match:ready", { code: created.room.code, ready: true });
  const result = await finished;

  assert.equal(result.seasonNumber, 1);
  assert.equal(result.nextSeasonNumber, 2);
  assert.equal(result.nextSeasonYear, 2027);
  assert.equal(result.nextFixtureId, "abertura");
  const nextSeason = await server.store.getRoom(created.room.code);
  assert.equal(nextSeason.currentSeason, 2);
  assert.equal(nextSeason.currentFixtureId, "abertura");
});
