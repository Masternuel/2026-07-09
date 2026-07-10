import test from "node:test";
import assert from "node:assert/strict";
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
