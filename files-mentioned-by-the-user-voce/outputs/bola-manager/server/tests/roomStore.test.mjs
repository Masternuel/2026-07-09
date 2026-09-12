import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_SCHEDULE_VERSION, resolveServerFixture } from "../game/fixtures.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomError, RoomStore } from "../store/roomStore.mjs";

function createStore() {
  return new RoomStore({
    persistence: new MemoryRoomPersistence(),
    codeFactory: () => "BOLA-T3ST",
    now: () => new Date("2026-07-09T20:00:00.000Z"),
  });
}

function createRoom(store) {
  return store.createRoom({
    name: "Noite dos Managers",
    creatorId: "manager-1",
    creatorName: "Emanuel",
    clubId: "AUR",
    activeLeagues: ["BR-A", "BR-B"],
    seasonLength: 3,
    maxManagers: 4,
  });
}

test("cria, entra, confirma managers e inicia uma sala", async () => {
  const store = createStore();
  const created = await createRoom(store);
  assert.equal(created.code, "BOLA-T3ST");
  assert.equal(created.status, "waiting");
  assert.equal(created.revision, 1);

  const joined = await store.joinRoom(created.code, {
    managerId: "manager-2",
    managerName: "Joao",
    clubId: "SAN",
  });
  assert.equal(joined.managers.length, 2);
  assert.equal(joined.revision, 2);

  await store.setReady(created.code, "manager-1", true);
  await store.setReady(created.code, "manager-2", true);
  const started = await store.startRoom(created.code, "manager-1");
  assert.equal(started.status, "active");
  assert.equal(started.revision, 5);
  assert.equal(started.startedAt, "2026-07-09T20:00:00.000Z");
});

test("impede dois managers de escolherem o mesmo clube", async () => {
  const store = createStore();
  const room = await createRoom(store);
  await assert.rejects(
    store.joinRoom(room.code, {
      managerId: "manager-2",
      managerName: "Carol",
      clubId: "AUR",
    }),
    (error) => error instanceof RoomError && error.code === "CLUB_UNAVAILABLE" && error.status === 409,
  );
  await assert.rejects(
    store.joinRoom(room.code, {
      managerId: "manager-3",
      managerName: "Bia",
      clubId: "aur",
    }),
    (error) => error instanceof RoomError && error.code === "CLUB_UNAVAILABLE" && error.status === 409,
  );
});

test("exige clube, prontidao de todos e permissao do criador", async () => {
  const store = createStore();
  const room = await createRoom(store);
  await store.joinRoom(room.code, { managerId: "manager-2", managerName: "Carol" });

  await assert.rejects(store.setReady(room.code, "manager-2", true), { code: "CLUB_REQUIRED" });
  await assert.rejects(store.startRoom(room.code, "manager-2"), { code: "OWNER_REQUIRED" });

  await store.setReady(room.code, "manager-1", true);
  await assert.rejects(store.startRoom(room.code, "manager-1"), { code: "MANAGERS_NOT_READY" });
});

test("retorna snapshots e lista somente salas privadas do manager", async () => {
  const store = createStore();
  const room = await createRoom(store);
  room.name = "Nome adulterado";
  room.managers[0].ready = true;

  const stored = await store.getRoom(room.code);
  assert.equal(stored.name, "Noite dos Managers");
  assert.equal(stored.managers[0].ready, false);
  assert.equal((await store.listRoomsForManager("manager-1")).length, 1);
  assert.equal((await store.listRoomsForManager("intruso")).length, 0);
});

test("projecao inicial do viewer usa leitura parcial e omite estado pesado", async () => {
  const source = {
    id: "room-light",
    code: "BOLA-L1TE",
    name: "Sala leve",
    ownerId: "manager-1",
    managerIds: ["manager-1"],
    managers: [{ id: "manager-1", name: "Emanuel", clubId: "AUR" }],
    competitionCatalog: [{ id: "BR-A", clubs: [{ id: "AUR", name: "Aurora" }] }],
    fixtureSchedule: [],
    careerState: { players: [{ id: "p-1" }] },
    marketState: { transactions: [{ id: "tx-1" }] },
    coachEmploymentState: { negotiations: [{ id: "n-1" }] },
    professionalLifecycleState: { notices: [{ id: "notice-1" }] },
    professionalLeaveState: { leaves: [{ id: "leave-1" }] },
    seasonHistory: [{ season: 1 }],
    completedMatches: [{ id: "match-1" }],
  };
  let requested;
  const persistence = {
    async getPartial(code, options) {
      requested = { code, options };
      return structuredClone(source);
    },
    async get() {
      throw new Error("leitura completa nao deveria ocorrer");
    },
  };
  const store = new RoomStore({ persistence });

  const room = await store.requireViewerRoom("bola-l1te", "manager-1");

  assert.equal(requested.code, "BOLA-L1TE");
  assert.deepEqual(requested.options.excludePaths, [
    "careerState",
    "marketState",
    "coachEmploymentState",
    "professionalLifecycleState",
    "professionalLeaveState",
    "seasonHistory",
    "completedMatches",
    "matchHistoryPending",
    "matchHistoryVersion",
    "scoutingState",
    "tacticalStudyState",
  ]);
  assert.equal(room.competitionCatalog[0].id, "BR-A");
  for (const path of requested.options.excludePaths) assert.equal(path in room, false);
  assert.equal(source.careerState.players.length, 1, "a projecao nao altera o objeto persistido");
});

test("projecao inicial mantem seguranca e fallback para adapters antigos", async () => {
  let reads = 0;
  const persistence = {
    async get(code) {
      reads += 1;
      return {
        code,
        ownerId: "manager-1",
        managerIds: ["manager-1"],
        managers: [{ id: "manager-1", clubId: "AUR" }],
        careerState: { players: [{ id: "p-1" }] },
        seasonHistory: [{ season: 1 }],
        completedMatches: [{ id: "match-1" }],
      };
    },
  };
  const store = new RoomStore({ persistence });

  const room = await store.requireViewerRoom("bola-old1", "manager-1");
  assert.equal(room.code, "BOLA-OLD1");
  assert.equal("careerState" in room, false);
  assert.equal("seasonHistory" in room, false);
  assert.equal("completedMatches" in room, false);
  await assert.rejects(store.requireViewerRoom("BOLA-OLD1", "intruso"), {
    code: "ROOM_NOT_FOUND",
    status: 404,
  });
  assert.equal(reads, 2);
});

test("mutacoes simples usam secoes pontuais sem hidratar historicos pesados", async () => {
  let source = {
    id: "room-paths",
    code: "BOLA-P4TH",
    name: "Sala por secoes",
    ownerId: "manager-1",
    catalogOwnerId: "manager-1",
    status: "waiting",
    managerIds: ["manager-1"],
    managers: [{
      id: "manager-1",
      name: "Emanuel",
      clubId: "AUR",
      ready: false,
      joinedAt: "2026-07-09T19:00:00.000Z",
    }],
    activeLeagues: ["BR-A"],
    seasonLength: 3,
    maxManagers: 4,
    createdAt: "2026-07-09T19:00:00.000Z",
    updatedAt: "2026-07-09T19:00:00.000Z",
    revision: 1,
    version: 1,
    currentFixtureId: null,
    competitionCatalog: [{
      id: "BR-A",
      clubs: [{ id: "AUR", name: "Aurora" }, { id: "SAN", name: "Santos" }],
    }],
    lineups: [],
    matchReadiness: { fixtureId: null, managerIds: ["manager-1"] },
    seasonHistory: Array.from({ length: 10_000 }, (_, index) => ({ season: index + 1 })),
    completedMatches: Array.from({ length: 10_000 }, (_, index) => ({ id: `match-${index}` })),
  };
  const metadataFields = [
    "id", "code", "name", "ownerId", "catalogOwnerId", "status", "managerIds", "managers",
    "activeLeagues", "seasonLength", "maxManagers", "createdAt", "updatedAt", "revision",
    "version", "currentFixtureId",
  ];
  const mutationPaths = [];
  const projectionRequests = [];
  let fullMutations = 0;
  const persistence = {
    async mutate() {
      fullMutations += 1;
      throw new Error("mutacao completa nao deveria ocorrer");
    },
    async mutatePaths(code, paths, mutation) {
      assert.equal(code, source.code);
      mutationPaths.push([...paths]);
      const current = {};
      for (const field of metadataFields) current[field] = structuredClone(source[field]);
      for (const path of paths) {
        if (source[path] !== undefined) current[path] = structuredClone(source[path]);
      }
      assert.equal(current.seasonHistory, undefined);
      assert.equal(current.completedMatches, undefined);
      const next = mutation(current);
      if (next !== undefined) source = { ...source, ...structuredClone(next) };
      return structuredClone(next ?? current);
    },
    async getPartial(code, options) {
      assert.equal(code, source.code);
      projectionRequests.push([...options.excludePaths]);
      const projection = structuredClone(source);
      for (const path of options.excludePaths) delete projection[path];
      return projection;
    },
  };
  const store = new RoomStore({
    persistence,
    now: () => new Date("2026-07-09T20:00:00.000Z"),
  });

  const joined = await store.joinRoom(source.code, {
    managerId: "manager-2",
    managerName: "Joao",
    clubId: "SAN",
  });
  const ready = await store.setReady(source.code, "manager-1", true);
  const lineup = await store.saveLineup(source.code, "manager-1", "AUR", ["p-1"]);
  source.matchReadiness = { fixtureId: null, managerIds: ["manager-2"] };
  const cleared = await store.clearMatchReadiness(source.code);

  assert.equal(fullMutations, 0);
  assert.deepEqual(mutationPaths, [
    ["competitionCatalog", "lineups"],
    [],
    ["lineups", "matchReadiness"],
    ["matchReadiness"],
  ]);
  assert.equal(projectionRequests.length, 4);
  assert.equal(joined.managers.length, 2);
  assert.equal(ready.managers[0].ready, true);
  assert.deepEqual(lineup.lineups[0].lineupIds, ["p-1"]);
  assert.deepEqual(cleared.matchReadiness.managerIds, []);
  assert.equal(cleared.revision, 5);
  for (const room of [joined, ready, lineup, cleared]) {
    assert.equal("seasonHistory" in room, false);
    assert.equal("completedMatches" in room, false);
  }
});

test("MemoryRoomPersistence oferece mesma projecao parcial sem alterar save", async () => {
  const source = {
    code: "BOLA-MEM1",
    managerIds: ["manager-1"],
    careerState: { players: [{ id: "p-1" }], contracts: [{ id: "c-1" }] },
    marketState: { transactions: [{ id: "tx-1" }], finances: [{ clubId: "AUR" }] },
    completedMatches: [{ id: "match-1" }],
  };
  const persistence = new MemoryRoomPersistence([source]);

  const partial = await persistence.getPartial(source.code, {
    excludePaths: ["careerState", "marketState.transactions", "completedMatches"],
  });

  assert.equal("careerState" in partial, false);
  assert.equal("completedMatches" in partial, false);
  assert.equal(partial.completedMatchCount, 1);
  assert.equal(partial.seasonHistoryCount, 0);
  assert.deepEqual(partial.marketState, { finances: [{ clubId: "AUR" }] });
  assert.deepEqual(await persistence.get(source.code), source);
});

test("join de manager existente em sala ativa e resume somente leitura", async () => {
  const store = createStore();
  const room = await createRoom(store);
  await store.setReady(room.code, "manager-1", true);
  await store.startRoom(room.code, "manager-1");
  const active = await store.getRoom(room.code);
  const resumed = await store.joinRoom(room.code, {
    managerId: "manager-1",
    managerName: "Nome adulterado",
    clubId: "SAN",
  });
  assert.equal(resumed.status, "active");
  assert.equal(resumed.managers.length, 1);
  assert.equal(resumed.managers[0].name, "Emanuel");
  assert.equal(resumed.managers[0].clubId, "AUR");
  assert.equal(resumed.revision, active.revision);
});

test("gera jogos contra IA e reinicia prontidao a cada rodada", async () => {
  const store = createStore();
  const room = await createRoom(store);
  await store.joinRoom(room.code, {
    managerId: "manager-2",
    managerName: "Joao",
    clubId: "SAN",
  });
  await store.setReady(room.code, "manager-1", true);
  await store.setReady(room.code, "manager-2", true);
  const started = await store.startRoom(room.code, "manager-1");

  assert.equal(started.fixtureSchedule[0].fixtureId, "abertura");
  assert.equal(started.fixtureSchedule[0].round, 1);
  assert.equal(started.currentFixtureId, "abertura");
  assert.equal(started.scheduleVersion, FIXTURE_SCHEDULE_VERSION);
  assert.equal(started.fixtureSchedule[0].managerIds.length, 1);
  assert.equal(started.fixtureSchedule.some((fixture) => fixture.managerIds.length === 2), true);
  assert.equal(started.fixtureSchedule.filter((fixture) => fixture.managerIds.length === 1).length >= 4, true);

  const firstReady = await store.setMatchReady(room.code, "manager-1", true);
  assert.deepEqual(firstReady.matchReadiness.managerIds, ["manager-1"]);
  const allReady = await store.setMatchReady(room.code, "manager-2", true);
  assert.deepEqual(new Set(allReady.matchReadiness.managerIds), new Set(["manager-1", "manager-2"]));

  const completed = await store.completeMatch(room.code, "abertura", {
    id: "match-ia",
    homeTeam: started.fixtureSchedule[0].homeTeam,
    awayTeam: started.fixtureSchedule[0].awayTeam,
    score: [1, 0],
    statistics: { home: { possession: 51 }, away: { possession: 49 } },
    skipped: false,
  });
  assert.equal(completed.room.currentFixtureId, "rodada-2");
  assert.equal(completed.room.matchReadiness.fixtureId, "rodada-2");
  assert.deepEqual(completed.room.matchReadiness.managerIds, []);
  assert.equal(completed.summary.code, room.code);
});

test("migra save legado ou malformado e ignora fixtureId legado durante prontidao", async () => {
  const legacyRoom = {
    id: "legacy-room",
    code: "BOLA-LGCY",
    name: "Save legado",
    ownerId: "manager-1",
    status: "active",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 2,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    startedAt: "2026-07-01T00:00:00.000Z",
    revision: 8,
    version: 8,
    scheduleVersion: FIXTURE_SCHEDULE_VERSION,
    currentFixtureId: "copa-ida",
    fixtureSchedule: [{
      fixtureId: "copa-ida",
      round: 3,
      competition: "Brasileirao",
      homeClubId: "PAL",
      awayClubId: "pal",
      homeTeam: "Palmeiras",
      awayTeam: "Palmeiras",
      homeManagerId: null,
      awayManagerId: null,
      managerIds: [],
    }],
    matchReadiness: { fixtureId: "copa-ida", managerIds: ["manager-1", "manager-2"] },
    completedFixtureIds: ["ABERTURA", "RODADA-2"],
    completedMatches: [],
    lastCompletedMatch: null,
    managerIds: ["manager-1", "manager-2"],
    managers: [
      { id: "manager-1", name: "Emanuel", clubId: "AUR", ready: true, joinedAt: "2026-07-01T00:00:00.000Z" },
      { id: "manager-2", name: "Joao", clubId: "SAN", ready: true, joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
  };
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence([legacyRoom]),
    now: () => new Date("2026-07-11T00:00:00.000Z"),
  });

  const migrated = await store.setMatchReady(legacyRoom.code, "manager-1", true, "copa-ida");
  assert.equal(migrated.scheduleVersion, FIXTURE_SCHEDULE_VERSION);
  assert.equal(migrated.currentFixtureId, "rodada-3");
  assert.equal(migrated.matchReadiness.fixtureId, "rodada-3");
  assert.deepEqual(migrated.matchReadiness.managerIds, ["manager-1"]);
  assert.equal(migrated.fixtureSchedule.length > 6, true);
  assert.equal(migrated.fixtureSchedule.every(
    (fixture) => fixture.homeClubId.toUpperCase() !== fixture.awayClubId.toUpperCase(),
  ), true);
  assert.equal((await store.getRoom(legacyRoom.code)).currentFixtureId, "rodada-3");
});

test("prepareMatch migra save legado transacionalmente antes do match:start", async () => {
  const legacyRoom = {
    id: "legacy-start",
    code: "BOLA-OLD2",
    name: "Save antigo",
    ownerId: "manager-1",
    status: "active",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    startedAt: "2026-07-01T00:00:00.000Z",
    revision: 3,
    version: 3,
    currentFixtureId: "copa-ida",
    completedFixtureIds: ["abertura", "rodada-2"],
    completedMatches: [],
    lastCompletedMatch: null,
    managerIds: ["manager-1"],
    managers: [{ id: "manager-1", name: "Emanuel", clubId: "SAN", ready: true, joinedAt: "2026-07-01T00:00:00.000Z" }],
  };
  const store = new RoomStore({ persistence: new MemoryRoomPersistence([legacyRoom]) });

  const prepared = await store.prepareMatch(legacyRoom.code, "manager-1", "copa-ida");
  assert.equal(prepared.migrated, true);
  assert.equal(prepared.fixtureId, "rodada-3");
  assert.equal(prepared.room.currentFixtureId, "rodada-3");
  assert.equal(prepared.room.scheduleVersion, FIXTURE_SCHEDULE_VERSION);
  assert.deepEqual(prepared.room.matchReadiness.managerIds, []);
});

test("IDs de clubes preservam caixa, nunca geram self-match e oponentes avancam", async () => {
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    codeFactory: () => "BOLA-PAL1",
    now: () => new Date("2026-07-11T00:00:00.000Z"),
  });
  const room = await store.createRoom({
    name: "Palmeiras minusculo",
    creatorId: "manager-pal",
    creatorName: "Manager PAL",
    clubId: "pal",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 1,
  });
  await store.setReady(room.code, "manager-pal", true);
  let active = await store.startRoom(room.code, "manager-pal");
  assert.equal(active.fixtureSchedule.some(
    (fixture) => fixture.homeClubId === "pal" || fixture.awayClubId === "pal",
  ), true);
  assert.equal(active.fixtureSchedule.every(
    (fixture) => fixture.homeClubId.toUpperCase() !== fixture.awayClubId.toUpperCase(),
  ), true);

  const opponents = [];
  for (let index = 0; index < 3; index += 1) {
    const fixture = resolveServerFixture(active);
    opponents.push(fixture.homeClubId.toUpperCase() === "PAL"
      ? fixture.awayClubId.toUpperCase()
      : fixture.homeClubId.toUpperCase());
    const completion = await store.completeMatch(room.code, fixture.fixtureId.toUpperCase(), {
      id: `match-${index}`,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      score: [1, 0],
      statistics: { home: {}, away: {} },
      skipped: false,
    });
    active = completion.room;
  }
  assert.equal(new Set(opponents).size, 3);
  assert.deepEqual(opponents, ["FLA", "COR", "GRE"]);
});

test("somente owner exclui save e autorizacao nao revela sala a intruso", async () => {
  const store = createStore();
  const room = await createRoom(store);
  await store.joinRoom(room.code, {
    managerId: "manager-2",
    managerName: "Joao",
    clubId: "SAN",
  });

  await assert.rejects(
    store.deleteRoom(room.code, "intruso"),
    (error) => error instanceof RoomError && error.code === "ROOM_NOT_FOUND" && error.status === 404,
  );
  await assert.rejects(
    store.deleteRoom(room.code, "manager-2"),
    (error) => error instanceof RoomError && error.code === "OWNER_REQUIRED" && error.status === 403,
  );
  assert.equal((await store.getRoom(room.code)).code, room.code);

  const deleted = await store.deleteRoom(room.code.toLowerCase(), "manager-1");
  assert.equal(deleted.code, room.code);
  assert.equal(await store.getRoom(room.code), null);
  assert.deepEqual(await store.listRoomsForManager("manager-1"), []);
  assert.deepEqual(await store.listRoomsForManager("manager-2"), []);
  await assert.rejects(store.deleteRoom(room.code, "manager-1"), { code: "ROOM_NOT_FOUND", status: 404 });
  await assert.rejects(createRoom(store), { code: "CODE_EXHAUSTED", status: 503 });
});
