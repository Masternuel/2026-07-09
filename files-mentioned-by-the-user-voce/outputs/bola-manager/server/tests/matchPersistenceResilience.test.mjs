import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import {
  hydrateActiveMatchSession,
  serializeActiveMatchSession,
} from "../game/activeMatchSession.mjs";
import {
  FirestoreMatchSessionPersistence,
  MemoryMatchSessionPersistence,
} from "../store/matchSessionPersistence.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";
import { startTestServer } from "./testHarness.mjs";

function activeSession(persistenceSequence = 0) {
  return {
    code: "BOLA",
    persistenceSequence,
    phase: "running",
    fixture: { fixtureId: "fixture-1" },
    started: { id: "match-1", fixtureId: "fixture-1" },
    match: { id: "match-1", events: [], score: [0, 0] },
    events: [],
    speed: { rate: 1, baseDelayMs: 0 },
    homeRoster: { players: [] },
    awayRoster: { players: [] },
    halftime: {},
  };
}

test("snapshot preserva sequencia monotonicamente e aceita save legado", () => {
  const session = activeSession(7);
  const snapshot = serializeActiveMatchSession(session, () => new Date("2026-08-30T12:00:00Z"));
  assert.equal(snapshot._matchSequence, 7);
  assert.equal(typeof snapshot._matchGeneration, "string");
  assert.ok(snapshot._matchGeneration.length > 0);
  assert.equal(
    hydrateActiveMatchSession(snapshot, session.fixture, session.code).persistenceSequence,
    7,
  );

  delete snapshot._matchSequence;
  assert.equal(
    hydrateActiveMatchSession(snapshot, session.fixture, session.code).persistenceSequence,
    0,
  );
});

for (const [name, createPersistence] of [
  ["memoria", () => new MemoryMatchSessionPersistence()],
  ["Firestore", () => new FirestoreMatchSessionPersistence(createFakeFirestore())],
]) {
  test(`${name}: save atrasado nao sobrescreve snapshot mais novo`, async () => {
    const persistence = createPersistence();
    const ownership = { token: "replica-a", fence: 1 };
    await persistence.save({
      code: "BOLA",
      matchId: "match-1",
      _matchSequence: 2,
      nextEventIndex: 2,
    }, ownership);

    await assert.rejects(
      persistence.save({
        code: "BOLA",
        matchId: "match-1",
        _matchSequence: 1,
        nextEventIndex: 1,
      }, ownership),
      { code: "MATCH_SNAPSHOT_STALE" },
    );
    assert.equal((await persistence.get("BOLA")).nextEventIndex, 2);
  });
}

for (const [name, createPersistence] of [
  ["memoria", () => new MemoryMatchSessionPersistence()],
  ["Firestore", () => new FirestoreMatchSessionPersistence(createFakeFirestore())],
]) {
  test(`${name}: tombstone sem ownership bloqueia geracoes antigas do mesmo jogo`, async () => {
    const persistence = createPersistence();
    const oldGeneration = "attempt-old";
    await persistence.save({
      code: "BOLA",
      matchId: "match-1",
      _matchSequence: 5,
      _matchGeneration: oldGeneration,
    });
    await persistence.remove("BOLA", "match-1");

    await assert.rejects(
      persistence.save({
        code: "BOLA",
        matchId: "match-1",
        _matchSequence: 6,
        _matchGeneration: oldGeneration,
      }),
      { code: "MATCH_SNAPSHOT_STALE" },
    );
    await persistence.save({
      code: "BOLA",
      matchId: "match-1",
      _matchSequence: 1,
      _matchGeneration: "attempt-new",
    });
    assert.equal((await persistence.get("BOLA"))._matchGeneration, "attempt-new");
    await persistence.remove("BOLA", "match-1");
    await assert.rejects(
      persistence.save({
        code: "BOLA",
        matchId: "match-1",
        _matchSequence: 7,
        _matchGeneration: oldGeneration,
      }),
      { code: "MATCH_SNAPSHOT_STALE" },
    );
    await persistence.save({
      code: "BOLA",
      matchId: "match-1",
      _matchSequence: 1,
      _matchGeneration: "attempt-third",
    });
    assert.equal((await persistence.get("BOLA"))._matchGeneration, "attempt-third");
  });
}

test("Firestore interrompe operacao travada com erro tipado", async () => {
  const never = new Promise(() => {});
  const firestore = {
    collection() {
      return { doc: () => ({ get: () => never }) };
    },
    runTransaction() {
      return never;
    },
  };
  const persistence = new FirestoreMatchSessionPersistence(firestore, {
    operationTimeoutMs: 15,
  });

  await assert.rejects(
    persistence.get("BOLA"),
    { code: "MATCH_PERSISTENCE_TIMEOUT", status: 503 },
  );
  await assert.rejects(
    persistence.save({ code: "BOLA", matchId: "match-1", _matchSequence: 1 }),
    { code: "MATCH_PERSISTENCE_TIMEOUT", status: 503 },
  );
});

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

test("timeout de save nao prende fila e nova tentativa inicia partida", async (context) => {
  const backingStore = new MemoryMatchSessionPersistence();
  let saveCount = 0;
  const persistence = {
    get: (...args) => backingStore.get(...args),
    has: (...args) => backingStore.has(...args),
    remove: (...args) => backingStore.remove(...args),
    save(...args) {
      saveCount += 1;
      if (saveCount === 1) return new Promise(() => {});
      return backingStore.save(...args);
    },
  };
  const { server, url } = await startTestServer({
    matchSessionStore: persistence,
    matchDelayMs: 1_000,
    env: { MATCH_PERSISTENCE_TIMEOUT_MS: "20" },
  });
  context.after(() => server.close());
  const client = await connect(url);
  context.after(() => client.disconnect());

  const created = await client.timeout(1_000).emitWithAck("room:create", {
    name: "Fila recuperavel",
    clubId: "AUR",
  });
  await client.timeout(1_000).emitWithAck("room:ready", {
    code: created.room.code,
    ready: true,
  });
  await client.timeout(1_000).emitWithAck("room:start", { code: created.room.code });

  const failed = await client.timeout(1_000).emitWithAck("match:ready", {
    code: created.room.code,
    ready: true,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "MATCH_PERSISTENCE_TIMEOUT");

  const retried = await client.timeout(1_000).emitWithAck("match:ready", {
    code: created.room.code,
    ready: true,
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.started, true);
  assert.equal(saveCount, 2);
});
