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
