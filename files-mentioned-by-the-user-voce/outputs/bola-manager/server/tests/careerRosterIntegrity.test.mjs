import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

const OWNER_ID = "roster-owner";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const POSITIONS = ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];

function leagueCatalog() {
  return [{
    id: "TEST-L1",
    name: "Liga de integridade",
    country: "Brasil",
    division: "Serie A",
    legs: "double",
    clubs: ["A", "B"].map((id) => ({
      id,
      name: `Clube ${id}`,
      code: id,
      leagueId: "TEST-L1",
      reputation: 10,
      budget: 20_000_000,
      active: true,
    })),
  }];
}

function roster(clubId) {
  return POSITIONS.map((position, index) => ({
    id: `${clubId}-P${index + 1}`,
    clubId,
    name: `${clubId} Jogador ${index + 1}`,
    position,
    age: 20 + index,
    nationality: "BRA",
    overall: 10,
    potential: 13,
    condition: 100,
    active: true,
  }));
}

function completeRoster(clubId) {
  const players = roster(clubId);
  return { players, count: players.length, source: "integrity-test" };
}

function catalog(provider) {
  return {
    async listCompetitionCatalog() {
      return structuredClone(leagueCatalog());
    },
    async listPlayers(clubId) {
      return provider(clubId);
    },
  };
}

async function readyCareer({
  provider = completeRoster,
  persistence = new MemoryRoomPersistence(),
  careerRosterPolicy = { maxAttempts: 3, timeoutMs: 20, retryDelayMs: 0 },
} = {}) {
  const options = {
    persistence,
    catalogStore: catalog(provider),
    codeFactory: () => "BOLA-RST1",
    now: () => new Date(NOW),
    careerRosterPolicy,
  };
  const store = new RoomStore(options);
  const room = await store.createRoom({
    name: "Carreira integra",
    creatorId: OWNER_ID,
    creatorName: "Manager",
    clubId: "A",
    activeLeagues: ["TEST-L1"],
    seasonLength: 2,
    maxManagers: 1,
  });
  await store.setReady(room.code, OWNER_ID, true);
  return { store, persistence, options, room: await store.requireRoom(room.code) };
}

function matchResult(room, sequence) {
  const fixture = room.fixtureSchedule.find(({ fixtureId }) => fixtureId === room.currentFixtureId);
  assert.ok(fixture);
  return {
    id: `roster-result-${sequence}`,
    fixtureId: fixture.fixtureId,
    homeClubId: fixture.homeClubId,
    awayClubId: fixture.awayClubId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    score: [1, 0],
    statistics: { home: {}, away: {} },
    events: [],
    playerStatistics: { home: [], away: [] },
    skipped: false,
  };
}

test("nao inicia carreira quando um clube obrigatorio nao tem roster", async () => {
  const context = await readyCareer({
    provider: (clubId) => (clubId === "B"
      ? { players: [], count: 0, source: "integrity-test" }
      : completeRoster(clubId)),
  });

  await assert.rejects(
    context.store.startRoom(context.room.code, OWNER_ID),
    { code: "CAREER_ROSTER_MISSING", status: 409 },
  );
  const persisted = await context.persistence.get(context.room.code);
  assert.equal(persisted.status, "waiting");
  assert.equal(persisted.careerState, null);
});

test("timeout de roster usa retry limitado e nao salva estado parcial", async () => {
  let attempts = 0;
  const context = await readyCareer({
    provider: (clubId) => {
      if (clubId !== "A") return completeRoster(clubId);
      attempts += 1;
      return new Promise(() => {});
    },
    careerRosterPolicy: { maxAttempts: 2, timeoutMs: 5, retryDelayMs: 0 },
  });

  await assert.rejects(
    context.store.startRoom(context.room.code, OWNER_ID),
    { code: "CAREER_ROSTER_LOAD_TIMEOUT", status: 503 },
  );
  assert.equal(attempts, 2);
  const persisted = await context.persistence.get(context.room.code);
  assert.equal(persisted.status, "waiting");
  assert.equal(persisted.careerState, null);
});

test("resposta parcial e rejeitada depois dos retries", async () => {
  let attempts = 0;
  const context = await readyCareer({
    provider: (clubId) => {
      const response = completeRoster(clubId);
      if (clubId === "A") {
        attempts += 1;
        response.count += 1;
      }
      return response;
    },
    careerRosterPolicy: { maxAttempts: 2, timeoutMs: 20, retryDelayMs: 0 },
  });

  await assert.rejects(
    context.store.startRoom(context.room.code, OWNER_ID),
    { code: "CAREER_ROSTER_PARTIAL", status: 503 },
  );
  assert.equal(attempts, 2);
  assert.equal((await context.persistence.get(context.room.code)).status, "waiting");
});

test("falha transitoria recupera em retry e inicia a carreira", async () => {
  let attempts = 0;
  const context = await readyCareer({
    provider: (clubId) => {
      if (clubId === "A" && attempts++ === 0) {
        const error = new Error("Catalogo temporariamente indisponivel");
        error.code = "CATALOG_UNAVAILABLE";
        error.status = 503;
        throw error;
      }
      return completeRoster(clubId);
    },
  });

  const started = await context.store.startRoom(context.room.code, OWNER_ID);
  assert.equal(attempts, 2);
  assert.equal(started.status, "active");
  assert.ok(started.careerState.players.some(({ id }) => id === "A-P1"));
  assert.ok(started.careerState.players.some(({ id }) => id === "B-P1"));
});

test("retry transitorio esgotado preserva a sala em espera", async () => {
  let attempts = 0;
  const context = await readyCareer({
    provider: (clubId) => {
      if (clubId !== "A") return completeRoster(clubId);
      attempts += 1;
      const error = new Error("Catalogo indisponivel");
      error.code = "CATALOG_UNAVAILABLE";
      error.status = 503;
      throw error;
    },
  });

  await assert.rejects(
    context.store.startRoom(context.room.code, OWNER_ID),
    { code: "CAREER_ROSTER_LOAD_FAILED", status: 503 },
  );
  assert.equal(attempts, 3);
  const persisted = await context.persistence.get(context.room.code);
  assert.equal(persisted.status, "waiting");
  assert.equal(persisted.careerState, null);
});

test("roster validado e carreira persistida sobrevivem ao reload", async () => {
  const context = await readyCareer();
  const started = await context.store.startRoom(context.room.code, OWNER_ID);
  const reloadedStore = new RoomStore({ ...context.options, codeFactory: () => "BOLA-RLD1" });
  const reloaded = await reloadedStore.requireMembership(started.code, OWNER_ID);

  assert.equal(reloaded.status, "active");
  assert.equal(reloaded.careerState.players.filter(({ id }) => id === "A-P1").length, 1);
  assert.equal(reloaded.careerState.players.filter(({ id }) => id === "B-P1").length, 1);
});

test("transicao de temporada aborta sem roster e pode ser repetida apos recuperacao", async () => {
  let failTransition = false;
  const context = await readyCareer({
    provider: (clubId) => {
      if (failTransition) {
        const error = new Error("Catalogo indisponivel");
        error.code = "CATALOG_UNAVAILABLE";
        error.status = 503;
        throw error;
      }
      return completeRoster(clubId);
    },
    careerRosterPolicy: { maxAttempts: 2, timeoutMs: 20, retryDelayMs: 0 },
  });
  let active = await context.store.startRoom(context.room.code, OWNER_ID);
  let fixture = active.fixtureSchedule.find(({ fixtureId }) => fixtureId === active.currentFixtureId);
  active = (await context.store.completeMatch(
    active.code,
    fixture.fixtureId,
    matchResult(active, 1),
  )).room;
  const beforeFinal = await context.persistence.get(active.code);
  failTransition = true;
  fixture = active.fixtureSchedule.find(({ fixtureId }) => fixtureId === active.currentFixtureId);

  await assert.rejects(
    context.store.completeMatch(active.code, fixture.fixtureId, matchResult(active, 2)),
    { code: "CAREER_ROSTER_LOAD_FAILED", status: 503 },
  );
  const unchanged = await context.persistence.get(active.code);
  assert.equal(unchanged.currentSeason, 1);
  assert.deepEqual(unchanged.completedFixtureIds, beforeFinal.completedFixtureIds);
  assert.equal(unchanged.currentFixtureId, beforeFinal.currentFixtureId);

  failTransition = false;
  const transitioned = await context.store.completeMatch(
    active.code,
    fixture.fixtureId,
    matchResult(active, 3),
  );
  assert.equal(transitioned.room.currentSeason, 2);
  assert.equal(transitioned.room.careerState.currentSeason, 2);
});
