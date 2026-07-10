import test from "node:test";
import assert from "node:assert/strict";
import { FirestoreRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

function fakeFirestore() {
  const records = new Map();
  const metrics = { transactions: 0 };
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
      records.set(id, structuredClone(data));
    },
  });
  const collection = {
    doc: document,
    where(_field, _operator, managerId) {
      return {
        async get() {
          const docs = [...records.values()]
            .filter((room) => room.managerIds.includes(managerId))
            .map((room) => ({ data: () => structuredClone(room) }));
          return { docs };
        },
      };
    },
  };
  return {
    metrics,
    collection() { return collection; },
    async runTransaction(handler) {
      metrics.transactions += 1;
      return handler({
        get: (reference) => reference.get(),
        set: (reference, data) => reference.set(data),
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
  assert.equal(firestore.metrics.transactions, 3);
  assert.equal((await store.getRoom(room.code)).status, "active");
  assert.equal((await store.listRoomsForManager("uid-owner")).length, 1);
});
