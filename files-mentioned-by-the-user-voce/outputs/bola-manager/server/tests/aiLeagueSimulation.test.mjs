import assert from "node:assert/strict";
import test from "node:test";
import { createLeagueFixtureSchedule, ensureFixtureSchedule, FIXTURE_SCHEDULE_VERSION } from "../game/fixtures.mjs";
import {
  estimateRoomDocumentBytes,
  MemoryRoomPersistence,
  ROOM_DOCUMENT_SAFE_BYTES,
} from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

function leagueCatalog(size = 6) {
  return [{
    id: "TEST-L1",
    name: "Liga de Teste",
    legs: "double",
    clubs: Array.from({ length: size }, (_, index) => ({
      id: `C${index + 1}`,
      name: `Clube ${index + 1}`,
      code: `C${index + 1}`,
      color: `#${String(index + 1).padStart(6, "0")}`,
      reputation: 10 + index,
      leagueId: "TEST-L1",
    })),
  }];
}

function rosterCatalog(leagues) {
  const positions = ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
  return {
    async listCompetitionCatalog() {
      return structuredClone(leagues);
    },
    async listPlayers(clubId) {
      const players = positions.map((position, index) => ({
        id: `${clubId}-P${index + 1}`,
        clubId,
        name: `${clubId} Jogador ${index + 1}`,
        position,
        overall: 10,
        condition: 100,
        active: true,
      }));
      return { players, count: players.length, source: "ai-league-test" };
    },
  };
}

function scheduleRoom(size) {
  return {
    managers: [{ id: "m1", clubId: "C1" }],
    competitionCatalog: leagueCatalog(size),
  };
}

function assertRoundRobin(size) {
  const schedule = createLeagueFixtureSchedule(scheduleRoom(size));
  assert.equal(schedule.length, size * (size - 1));
  const pairs = new Map();
  const clubsByRound = new Map();
  const homeCounts = new Map();
  for (const fixture of schedule) {
    assert.deepEqual(
      Object.keys(fixture).sort(),
      ["awayClubId", "homeClubId", "leagueFixtureId", "leagueId", "round", "scheduledAt"],
    );
    const pair = [fixture.homeClubId, fixture.awayClubId].sort().join("|");
    const meetings = pairs.get(pair) ?? [];
    meetings.push(`${fixture.homeClubId}>${fixture.awayClubId}`);
    pairs.set(pair, meetings);
    homeCounts.set(fixture.homeClubId, (homeCounts.get(fixture.homeClubId) ?? 0) + 1);
    if (!homeCounts.has(fixture.awayClubId)) homeCounts.set(fixture.awayClubId, 0);
    const roundClubs = clubsByRound.get(fixture.round) ?? new Set();
    assert.equal(roundClubs.has(fixture.homeClubId), false);
    assert.equal(roundClubs.has(fixture.awayClubId), false);
    roundClubs.add(fixture.homeClubId);
    roundClubs.add(fixture.awayClubId);
    clubsByRound.set(fixture.round, roundClubs);
  }
  assert.equal(clubsByRound.size, 2 * (size % 2 === 0 ? size - 1 : size));
  assert.equal(pairs.size, (size * (size - 1)) / 2);
  for (const [pair, meetings] of pairs) {
    assert.equal(meetings.length, 2, `par precisa jogar ida e volta: ${pair}`);
    assert.equal(new Set(meetings).size, 2, `mandos precisam ser invertidos: ${pair}`);
  }
  const homeValues = [...homeCounts.values()];
  assert.equal(homeValues.every((count) => count === size - 1), true);
}

test("round-robin completo funciona com quantidade par e impar", () => {
  assertRoundRobin(6);
  assertRoundRobin(5);
  assertRoundRobin(20);
});

test("migracao v2 preserva pares concluidos e preenche resultado compacto", () => {
  const room = {
    id: "legacy-v2",
    scheduleVersion: 2,
    currentSeason: 1,
    seasonYear: 2026,
    managers: [{ id: "m1", clubId: "C1" }],
    managerIds: ["m1"],
    competitionCatalog: leagueCatalog(4),
    fixtureSchedule: [
      { fixtureId: "abertura", leagueId: "TEST-L1", homeClubId: "C1", awayClubId: "C3", managerIds: ["m1"] },
      { fixtureId: "rodada-2", leagueId: "TEST-L1", homeClubId: "C2", awayClubId: "C1", managerIds: ["m1"] },
    ],
    completedFixtureIds: ["abertura"],
    completedMatches: [{
      id: "legacy-human", fixtureId: "abertura", score: [2, 1],
      completedAt: "2026-07-15T12:00:00.000Z", seasonNumber: 1, seasonYear: 2026,
    }],
    currentFixtureId: "rodada-2",
    matchReadiness: { fixtureId: "rodada-2", managerIds: [] },
  };
  assert.equal(ensureFixtureSchedule(room), true);
  assert.equal(room.scheduleCompatibility, "v2-preserved");
  assert.deepEqual(
    ["abertura", "rodada-2"].map((id) => room.fixtureSchedule.find((fixture) => fixture.fixtureId === id))
      .map((fixture) => [fixture.fixtureId, fixture.homeClubId, fixture.awayClubId]),
    [["abertura", "C1", "C3"], ["rodada-2", "C2", "C1"]],
  );
  assert.equal(room.fixtureSchedule.length, 6);
  assert.equal(Math.max(...room.fixtureSchedule.map((fixture) => fixture.round)), 6);
  assert.equal(room.leagueMatchResults.length, 1);
  assert.deepEqual(room.leagueMatchResults[0].score, [1, 2]);
  assert.equal(room.currentFixtureId, "rodada-3", "confronto preservado nao pode furar ordem cronologica");
});

async function startedTwoManagerRoom({ seasonLength = 1 } = {}) {
  const persistence = new MemoryRoomPersistence();
  const now = () => new Date("2026-07-16T12:00:00.000Z");
  const store = new RoomStore({
    persistence,
    now,
    codeFactory: () => "BOLA-AI01",
    catalogStore: rosterCatalog(leagueCatalog(6)),
  });
  const room = await store.createRoom({
    name: "Liga IA",
    creatorId: "m1",
    creatorName: "Um",
    clubId: "C1",
    activeLeagues: ["TEST-L1"],
    seasonLength,
    maxManagers: 2,
  });
  await store.joinRoom(room.code, { managerId: "m2", managerName: "Dois", clubId: "C2" });
  await store.setReady(room.code, "m1", true);
  await store.setReady(room.code, "m2", true);
  return { store, started: await store.startRoom(room.code, "m1"), now };
}

function humanResult(fixture, index = 1) {
  return {
    id: `human-${index}`,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    score: [index, 0],
    statistics: { home: { possession: 54 }, away: { possession: 46 } },
    skipped: false,
  };
}

test("primeiro jogo humano simula IAs, mantem outro manager pendente e fecha rodada no ultimo", async () => {
  const { store, started } = await startedTwoManagerRoom();
  const firstRoundHumans = started.fixtureSchedule.filter((fixture) => fixture.round === 1);
  assert.equal(firstRoundHumans.length, 2);

  const first = await store.completeMatch(
    started.code,
    firstRoundHumans[0].fixtureId,
    humanResult(firstRoundHumans[0]),
  );
  assert.equal(first.summary.roundSummary.matches.length, 3);
  assert.equal(first.summary.roundSummary.complete, false);
  assert.equal(first.summary.roundSummary.matches.filter((match) => match.source === "ai").length, 1);
  assert.equal(first.summary.roundSummary.matches.filter((match) => match.score === null).length, 1);
  assert.equal(first.room.completedFixtureIds.length, 1);
  assert.equal(first.room.completedMatches.length, 1);
  assert.equal(first.room.lastCompletedMatch.id, "human-1");
  assert.equal(first.room.leagueMatchResults.every(
    (entry) => Object.keys(entry).every((key) => ["leagueFixtureId", "score", "possession", "completedAt"].includes(key)),
  ), true);
  assert.equal(first.room.leagueMatchResults.every((entry) => (
    Array.isArray(entry.possession)
      && entry.possession.length === 2
      && entry.possession.every((value) => Number.isFinite(value))
  )), true);
  const humanLeagueResult = first.room.leagueMatchResults.find(
    (entry) => entry.leagueFixtureId === firstRoundHumans[0].leagueFixtureId,
  );
  assert.deepEqual(humanLeagueResult.possession, [54, 46]);

  const aiResult = first.room.leagueMatchResults.find(
    (entry) => entry.leagueFixtureId !== firstRoundHumans[0].leagueFixtureId,
  );
  const aiFixture = first.room.leagueFixtureSchedule.find(
    (fixture) => fixture.leagueFixtureId === aiResult.leagueFixtureId,
  );
  assert.equal([aiFixture.homeClubId, aiFixture.awayClubId].some((id) => ["C1", "C2"].includes(id)), false);

  const second = await store.completeMatch(
    started.code,
    firstRoundHumans[1].fixtureId,
    humanResult(firstRoundHumans[1], 2),
  );
  assert.equal(second.summary.roundSummary.complete, true);
  assert.equal(second.summary.roundSummary.matches.every((match) => Array.isArray(match.score)), true);
  assert.equal(second.room.leagueMatchResults.length, 3);
  assert.deepEqual(second.room.lastCompletedRound, second.summary.roundSummary);

  await assert.rejects(
    store.completeMatch(started.code, firstRoundHumans[1].fixtureId, humanResult(firstRoundHumans[1], 3)),
    { code: "FIXTURE_ALREADY_COMPLETED" },
  );
  assert.equal((await store.getRoom(started.code)).leagueMatchResults.length, 3);
});

test("partida IA da rodada atualiza progressao individual da base do criador", async () => {
  const persistence = new MemoryRoomPersistence();
  const positions = ["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "MC", "MEI", "PE", "ATA", "PD", "ATA"];
  const catalogStore = {
    async listCompetitionCatalog() { return leagueCatalog(6); },
    async listPlayers(clubId) {
      return {
        players: positions.map((position, index) => ({
          id: `${clubId}-P${index + 1}`,
          clubId,
          name: `${clubId} Jogador ${index + 1}`,
          position,
          overall: 10 + (index % 5),
          condition: 100,
          active: true,
        })),
      };
    },
  };
  const store = new RoomStore({
    persistence,
    now: () => new Date("2026-07-16T12:00:00.000Z"),
    codeFactory: () => "BOLA-AIP2",
    catalogStore,
  });
  const room = await store.createRoom({
    name: "Liga IA com atletas", creatorId: "m1", creatorName: "Um", clubId: "C1",
    activeLeagues: ["TEST-L1"], seasonLength: 1, maxManagers: 2,
  });
  await store.joinRoom(room.code, { managerId: "m2", managerName: "Dois", clubId: "C2" });
  await store.setReady(room.code, "m1", true);
  await store.setReady(room.code, "m2", true);
  const started = await store.startRoom(room.code, "m1");
  const fixture = started.fixtureSchedule.find((candidate) => candidate.round === 1);
  const completion = await store.completeMatch(
    started.code,
    fixture.fixtureId,
    humanResult(fixture),
  );
  const aiStates = completion.room.playerStates.filter(
    (state) => !["C1", "C2"].includes(state.clubId),
  );
  assert.equal(aiStates.length > 0, true);
  assert.equal(aiStates.some((state) => state.seasonStats.appearances === 1), true);
  assert.equal(aiStates.some((state) => state.condition < 100), true);
});

test("liga somente IA avanca rodada a rodada junto da liga do manager", async () => {
  const primary = leagueCatalog(4)[0];
  const secondary = {
    id: "TEST-L2",
    name: "Liga paralela",
    clubs: Array.from({ length: 4 }, (_, index) => ({
      id: `D${index + 1}`,
      name: `Paralelo ${index + 1}`,
      code: `D${index + 1}`,
      reputation: 8 + index,
      leagueId: "TEST-L2",
    })),
  };
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    now: () => new Date("2026-07-16T12:00:00.000Z"),
    codeFactory: () => "BOLA-PAR1",
    catalogStore: rosterCatalog([primary, secondary]),
  });
  const room = await store.createRoom({
    name: "Ligas paralelas", creatorId: "m1", creatorName: "Um", clubId: "C1",
    activeLeagues: ["TEST-L1", "TEST-L2"], seasonLength: 1, maxManagers: 1,
  });
  await store.setReady(room.code, "m1", true);
  const started = await store.startRoom(room.code, "m1");
  const fixture = started.fixtureSchedule.find((candidate) => candidate.round === 1);
  const completion = await store.completeMatch(
    started.code,
    fixture.fixtureId,
    humanResult(fixture),
  );
  const parallelRoundOne = completion.room.leagueFixtureSchedule.filter(
    (candidate) => candidate.leagueId === "TEST-L2" && candidate.round === 1,
  );
  const parallelLater = completion.room.leagueFixtureSchedule.filter(
    (candidate) => candidate.leagueId === "TEST-L2" && candidate.round > 1,
  );
  assert.equal(parallelRoundOne.every((candidate) => completion.room.leagueMatchResults.some(
    (result) => result.leagueFixtureId === candidate.leagueFixtureId,
  )), true);
  assert.equal(parallelLater.every((candidate) => !completion.room.leagueMatchResults.some(
    (result) => result.leagueFixtureId === candidate.leagueFixtureId,
  )), true);
});

test("placares IA usam seed estavel e independem de revision", async () => {
  const { started, now } = await startedTwoManagerRoom();
  const firstFixture = started.fixtureSchedule[0];
  const changedRevision = structuredClone(started);
  changedRevision.revision += 99;
  changedRevision.version = changedRevision.revision;
  const firstStore = new RoomStore({ persistence: new MemoryRoomPersistence([started]), now });
  const secondStore = new RoomStore({ persistence: new MemoryRoomPersistence([changedRevision]), now });

  const first = await firstStore.completeMatch(started.code, firstFixture.fixtureId, humanResult(firstFixture));
  const second = await secondStore.completeMatch(started.code, firstFixture.fixtureId, humanResult(firstFixture));
  const humanLeagueFixtureId = firstFixture.leagueFixtureId;
  assert.deepEqual(
    first.room.leagueMatchResults.filter((entry) => entry.leagueFixtureId !== humanLeagueFixtureId),
    second.room.leagueMatchResults.filter((entry) => entry.leagueFixtureId !== humanLeagueFixtureId),
  );
});

test("liga impar conclui rodada de BYE composta somente por IA", async () => {
  const catalog = leagueCatalog(3);
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    now: () => new Date("2026-07-16T12:00:00.000Z"),
    codeFactory: () => "BOLA-ODD1",
    catalogStore: rosterCatalog(catalog),
  });
  const room = await store.createRoom({
    name: "Liga impar", creatorId: "m1", creatorName: "Um", clubId: "C1",
    activeLeagues: ["TEST-L1"], seasonLength: 1, maxManagers: 1,
  });
  await store.setReady(room.code, "m1", true);
  let active = await store.startRoom(room.code, "m1");
  assert.equal(active.fixtureSchedule.length, 4);
  assert.equal(active.leagueFixtureSchedule.length, 6);
  for (let index = 0; index < 4; index += 1) {
    const fixture = active.fixtureSchedule.find((candidate) => candidate.fixtureId === active.currentFixtureId);
    active = (await store.completeMatch(room.code, fixture.fixtureId, humanResult(fixture, index + 1))).room;
  }
  assert.equal(active.careerCompleted, true);
  assert.equal(active.leagueMatchResults.length, 6);
  const managedIds = new Set(active.fixtureSchedule.map((fixture) => fixture.leagueFixtureId));
  const aiOnly = active.leagueMatchResults.find((result) => !managedIds.has(result.leagueFixtureId));
  assert.ok(aiOnly);
  const fixture = active.leagueFixtureSchedule.find((candidate) => candidate.leagueFixtureId === aiOnly.leagueFixtureId);
  assert.equal([fixture.homeClubId, fixture.awayClubId].includes("C1"), false);
});

test("liga impar simula rodada de BYE intermediaria antes do proximo jogo humano", async () => {
  const catalog = leagueCatalog(5);
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    now: () => new Date("2026-07-16T12:00:00.000Z"),
    codeFactory: () => "BOLA-ODD5",
    catalogStore: rosterCatalog(catalog),
  });
  const room = await store.createRoom({
    name: "Liga impar cinco", creatorId: "m1", creatorName: "Um", clubId: "C1",
    activeLeagues: ["TEST-L1"], seasonLength: 1, maxManagers: 1,
  });
  await store.setReady(room.code, "m1", true);
  let active = await store.startRoom(room.code, "m1");
  assert.deepEqual(active.fixtureSchedule.map((fixture) => fixture.round), [1, 2, 4, 5, 6, 7, 9, 10]);

  for (let index = 0; index < 2; index += 1) {
    const fixture = active.fixtureSchedule.find((candidate) => candidate.fixtureId === active.currentFixtureId);
    const completion = await store.completeMatch(room.code, fixture.fixtureId, humanResult(fixture, index + 1));
    active = completion.room;
    if (index === 1) assert.equal(completion.summary.roundSummary.round, 2);
  }

  const roundThreeIds = active.leagueFixtureSchedule
    .filter((fixture) => fixture.round === 3)
    .map((fixture) => fixture.leagueFixtureId);
  assert.equal(roundThreeIds.length, 2);
  assert.equal(roundThreeIds.every((id) => (
    active.leagueMatchResults.some((result) => result.leagueFixtureId === id)
  )), true);
  assert.equal(active.currentFixtureId, active.fixtureSchedule.find((fixture) => fixture.round === 4).fixtureId);
});

test("base realista com 20 clubes e 30 jogadores inicia usando persistencia compactada", async () => {
  const catalog = leagueCatalog(20);
  const catalogStore = {
    async listCompetitionCatalog() { return structuredClone(catalog); },
    async listPlayers(clubId) {
      return {
        players: Array.from({ length: 30 }, (_, index) => ({
          id: `${clubId}-P${index + 1}`,
          clubId,
          name: `Jogador ${clubId} ${index + 1}`,
          position: ["GOL", "ZAG", "MC", "ATA"][index % 4],
          age: 18 + (index % 18),
          nationality: "Brasil",
          overall: 8 + (index % 9),
          potential: 10 + (index % 9),
          wage: 15_000 + (index * 500),
          active: true,
          attributes: {
            pace: 10 + (index % 6),
            strength: 9 + (index % 7),
            stamina: 11 + (index % 5),
            finishing: 8 + (index % 8),
            passing: 9 + (index % 7),
            tackling: 8 + (index % 6),
            positioning: 10 + (index % 5),
            handling: 7 + (index % 5),
          },
          contract: { clubId, startSeason: 1, endSeason: 3, wage: 15_000 + (index * 500) },
        })),
      };
    },
  };
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    codeFactory: () => "BOLA-REAL",
    catalogStore,
  });
  const room = await store.createRoom({
    name: "Base realista", creatorId: "m1", creatorName: "Um", clubId: "C1",
    activeLeagues: ["TEST-L1"], seasonLength: 1, maxManagers: 1,
  });
  await store.setReady(room.code, "m1", true);
  const started = await store.startRoom(room.code, "m1");

  assert.equal(started.status, "active");
  assert.equal(started.careerState.players.length, 640);
  assert.equal(started.leagueFixtureSchedule.length, 380);
  assert.equal(started.fixtureSchedule.length, 38);
  assert.ok(Buffer.byteLength(JSON.stringify(started), "utf8") > ROOM_DOCUMENT_SAFE_BYTES);
  assert.ok(estimateRoomDocumentBytes(started) < ROOM_DOCUMENT_SAFE_BYTES);
});

test("calendario enorme e bloqueado antes de ultrapassar documento Firestore", async () => {
  const catalog = leagueCatalog(100);
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    codeFactory: () => "BOLA-HUGE",
    catalogStore: rosterCatalog(catalog),
  });
  const room = await store.createRoom({
    name: "Liga enorme", creatorId: "m1", creatorName: "Um", clubId: "C1",
    activeLeagues: ["TEST-L1"], seasonLength: 1, maxManagers: 1,
  });
  await store.setReady(room.code, "m1", true);
  await assert.rejects(store.startRoom(room.code, "m1"), {
    code: "LEAGUE_SCHEDULE_TOO_LARGE",
    status: 409,
  });
});

test("rollover preserva ultimo roundSummary e limpa resultados da nova temporada", async () => {
  const { store, started } = await startedTwoManagerRoom({ seasonLength: 2 });
  let active = started;
  let finalSummary = null;
  for (let index = 0; index < started.fixtureSchedule.length; index += 1) {
    const fixture = active.fixtureSchedule.find((candidate) => candidate.fixtureId === active.currentFixtureId);
    const completion = await store.completeMatch(active.code, fixture.fixtureId, humanResult(fixture, index + 1));
    active = completion.room;
    finalSummary = completion.summary.roundSummary;
  }
  assert.equal(active.currentSeason, 2);
  assert.deepEqual(active.leagueMatchResults, []);
  assert.deepEqual(active.lastCompletedRound, finalSummary);
  assert.deepEqual(active.lastCompletedMatch.roundSummary, finalSummary);
  assert.equal(active.scheduleVersion, FIXTURE_SCHEDULE_VERSION);
  assert.equal(active.leagueFixtureSchedule.length > 0, true);
});
