import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_SCHEDULE_VERSION } from "../game/fixtures.mjs";
import { FirestoreRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

function fakeFirestore() {
  const records = new Map();
  const metrics = { transactions: 0, deletes: 0, tombstones: 0 };
  const document = (id) => ({
    id,
    async create(data) {
      if (records.has(id)) {
        const error = new Error("exists");
        error.code = 6;
        throw error;
      }
      records.set(id, structuredClone(data));
    },
    async get() {
      return { exists: records.has(id), data: () => structuredClone(records.get(id)) };
    },
    async set(data) {
      if (data?.deleted === true) metrics.tombstones += 1;
      records.set(id, structuredClone(data));
    },
    async delete() {
      metrics.deletes += 1;
      records.delete(id);
    },
  });
  const collection = {
    doc: document,
    where(_field, _operator, managerId) {
      return {
        async get() {
          const docs = [...records.values()]
            .filter((room) => room.managerIds?.includes(managerId))
            .map((room) => ({ data: () => structuredClone(room) }));
          return { docs };
        },
      };
    },
  };
  return {
    metrics,
    seed(id, data) { records.set(id, structuredClone(data)); },
    read(id) { return structuredClone(records.get(id)); },
    collection() { return collection; },
    async runTransaction(handler) {
      metrics.transactions += 1;
      return handler({
        get: (reference) => reference.get(),
        set: (reference, data) => reference.set(data),
        delete: (reference) => reference.delete(),
      });
    },
  };
}

test("adapter Firestore usa transacoes e persiste revisoes monotonicamente", async () => {
  const firestore = fakeFirestore();
  const store = new RoomStore({
    persistence: new FirestoreRoomPersistence(firestore),
    codeFactory: () => "BOLA-F1RE",
    now: () => new Date("2026-07-10T01:00:00.000Z"),
  });
  const room = await store.createRoom({
    name: "Sala Firestore",
    creatorId: "uid-owner",
    creatorName: "Owner",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 4,
  });
  const ready = await store.setReady(room.code, "uid-owner", true);
  const started = await store.startRoom(room.code, "uid-owner");
  const completion = await store.completeMatch(room.code, "abertura", {
    id: "match-firestore",
    homeTeam: "Aurora FC",
    awayTeam: "Santos",
    score: [2, 1],
    statistics: { home: { possession: 55 }, away: { possession: 45 } },
    skipped: false,
  });

  assert.equal(ready.revision, 2);
  assert.equal(started.revision, 3);
  assert.equal(completion.room.revision, 4);
  assert.equal(completion.room.currentFixtureId, "rodada-2");
  assert.equal(completion.summary.fixtureId, "abertura");
  assert.equal(completion.summary.code, room.code);
  assert.equal(firestore.metrics.transactions, 3);
  assert.equal((await store.getRoom(room.code)).status, "active");
  assert.equal((await store.listRoomsForManager("uid-owner")).length, 1);

  const deleted = await store.deleteRoom(room.code, "uid-owner");
  assert.equal(deleted.code, room.code);
  assert.equal(await store.getRoom(room.code), null);
  assert.deepEqual(await store.listRoomsForManager("uid-owner"), []);
  assert.equal(firestore.metrics.transactions, 4);
  assert.equal(firestore.metrics.deletes, 0);
  assert.equal(firestore.metrics.tombstones, 1);
  assert.deepEqual(firestore.read(room.code), { code: room.code, deleted: true });
  await assert.rejects(store.createRoom({
    name: "Sala reaproveitada",
    creatorId: "uid-owner",
    creatorName: "Owner",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 4,
  }), { code: "CODE_EXHAUSTED" });
});

test("migra calendario legado dentro da transacao Firestore", async () => {
  const firestore = fakeFirestore();
  const legacyRoom = {
    id: "firestore-legacy",
    code: "BOLA-MIGR",
    name: "Firestore legado",
    ownerId: "uid-owner",
    status: "active",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    startedAt: "2026-07-01T00:00:00.000Z",
    revision: 7,
    version: 7,
    currentFixtureId: "copa-ida",
    completedFixtureIds: ["ABERTURA", "RODADA-2"],
    completedMatches: [],
    lastCompletedMatch: null,
    managerIds: ["uid-owner"],
    managers: [{
      id: "uid-owner",
      name: "Owner",
      clubId: "SAN",
      ready: true,
      joinedAt: "2026-07-01T00:00:00.000Z",
    }],
  };
  firestore.seed(legacyRoom.code, legacyRoom);
  const store = new RoomStore({
    persistence: new FirestoreRoomPersistence(firestore),
    now: () => new Date("2026-07-11T00:00:00.000Z"),
  });

  const migrated = await store.setMatchReady(legacyRoom.code, "uid-owner", true, "copa-ida");
  assert.equal(migrated.scheduleVersion, FIXTURE_SCHEDULE_VERSION);
  assert.equal(migrated.currentFixtureId, "rodada-3");
  assert.deepEqual(migrated.matchReadiness.managerIds, ["uid-owner"]);
  assert.equal(firestore.metrics.transactions, 1);
  assert.equal(firestore.read(legacyRoom.code).scheduleVersion, FIXTURE_SCHEDULE_VERSION);
  assert.equal(firestore.read(legacyRoom.code).currentFixtureId, "rodada-3");
});
