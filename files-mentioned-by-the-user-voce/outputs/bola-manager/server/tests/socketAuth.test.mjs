import test from "node:test";
import assert from "node:assert/strict";
import { io as createClient } from "socket.io-client";
import { FIXTURE_SCHEDULE_VERSION } from "../game/fixtures.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { startTestServer } from "./testHarness.mjs";

function connect(url, auth) {
  return new Promise((resolve, reject) => {
    const client = createClient(url, { auth, forceNew: true, reconnection: false, timeout: 1_000 });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

async function createActiveRoom(client) {
  const created = await client.timeout(1_000).emitWithAck("room:create", {
    name: "Sala Socket",
    creatorId: "uid-atacante",
    creatorName: "Atacante",
    clubId: "AUR",
  });
  assert.equal(created.ok, true);
  const ready = await client.timeout(1_000).emitWithAck("room:ready", {
    code: created.room.code,
    managerId: "uid-atacante",
    ready: true,
  });
  assert.equal(ready.ok, true);
  const started = await client.timeout(1_000).emitWithAck("room:start", {
    code: created.room.code,
    managerId: "uid-atacante",
  });
  assert.equal(started.room.status, "active");
  return started.room;
}

test("Socket.IO rejeita handshake sem token", async (context) => {
  const { server, url } = await startTestServer();
  context.after(() => server.close());
  await assert.rejects(connect(url, {}), (error) => error.data?.code === "AUTH_REQUIRED");
});

test("partida persiste, rejeita replay e match:sync sobrevive a reinicio", async () => {
  const first = await startTestServer();
  let firstClient;
  let second;
  let secondClient;
  try {
    firstClient = await connect(first.url, { token: "owner-token" });
    const room = await createActiveRoom(firstClient);
    assert.equal(room.ownerId, "uid-owner");

    const malicious = await firstClient.timeout(1_000).emitWithAck("match:start", {
      code: room.code,
      homeTeam: "Time forjado",
    });
    assert.equal(malicious.ok, false);
    assert.equal(malicious.error.code, "VALIDATION_ERROR");

    const order = [];
    const finished = new Promise((resolve) => firstClient.once("match:finished", resolve));
    firstClient.once("match:started", () => order.push("started"));
    firstClient.once("match:event", () => order.push("event"));
    const matchAck = await firstClient.timeout(1_000).emitWithAck("match:ready", {
      code: room.code,
      fixtureId: "abertura",
      ready: true,
    });
    order.push("ack");
    const result = await finished;
    assert.equal(matchAck.ok, true);
    assert.deepEqual(order.slice(0, 3), ["ack", "started", "event"]);
    assert.equal(matchAck.started, true);
    assert.equal(result.homeTeam, "Aurora FC");
    assert.equal(result.awayTeam, "Palmeiras");
    assert.equal(result.code, room.code);
    assert.equal(result.nextFixtureId, "rodada-2");

    const persistedRoom = await first.store.getRoom(room.code);
    assert.deepEqual(persistedRoom.completedFixtureIds, ["abertura"]);
    assert.equal(persistedRoom.currentFixtureId, "rodada-2");
    assert.equal(persistedRoom.lastCompletedMatch.id, result.id);
    assert.equal(persistedRoom.lastCompletedMatch.code, room.code);
    assert.equal(persistedRoom.lastCompletedMatch.roomRevision, persistedRoom.revision);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const replay = await firstClient.timeout(1_000).emitWithAck("match:start", {
      code: room.code,
      fixtureId: "abertura",
    });
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, "FIXTURE_ALREADY_COMPLETED");

    firstClient.disconnect();
    firstClient = null;
    await first.server.close();
    second = await startTestServer({ store: first.store });
    secondClient = await connect(second.url, { token: "owner-token" });
    const sync = await secondClient.timeout(1_000).emitWithAck("match:sync", { code: room.code });
    assert.equal(sync.ok, true);
    assert.equal(sync.source, "persisted");
    assert.equal(sync.started, null);
    assert.deepEqual(sync.events, []);
    assert.equal(sync.result.id, result.id);
    assert.equal(sync.result.code, room.code);
    assert.equal(sync.result.fixtureId, "abertura");
    assert.equal(sync.result.nextFixtureId, "rodada-2");
  } finally {
    firstClient?.disconnect();
    secondClient?.disconnect();
    if (first.server.httpServer.listening) await first.server.close();
    if (second?.server.httpServer.listening) await second.server.close();
  }
});

test("match:sync devolve metadados e eventos enriquecidos da sessao viva", async (context) => {
  const { server, url } = await startTestServer({ matchDelayMs: 200 });
  context.after(() => server.close());
  const client = await connect(url, { token: "owner-token" });
  context.after(() => client.disconnect());
  const room = await createActiveRoom(client);

  const firstEvent = new Promise((resolve) => client.once("match:event", resolve));
  const finished = new Promise((resolve) => client.once("match:finished", resolve));
  const start = await client.timeout(1_000).emitWithAck("match:ready", { code: room.code, ready: true });
  const event = await firstEvent;
  const sync = await client.timeout(1_000).emitWithAck("match:sync", { code: room.code });

  assert.equal(start.ok, true);
  assert.equal(sync.ok, true);
  assert.equal(sync.source, "live");
  assert.equal(sync.started.id, start.matchId);
  assert.equal(sync.started.code, room.code);
  assert.equal(sync.events.length >= 1, true);
  assert.equal(sync.events[0].matchId, start.matchId);
  assert.equal(sync.events[0].code, room.code);
  assert.equal(sync.events[0].fixtureId, "abertura");
  assert.equal(event.matchId, start.matchId);
  assert.equal(event.code, room.code);
  assert.equal(sync.result, null);

  const skipped = await client.timeout(1_000).emitWithAck("match:skip", { code: room.code });
  assert.equal(skipped.ok, true);
  await finished;
});

test("partida transmite inicio, eventos e resultado para todos os managers", async (context) => {
  const { server, url } = await startTestServer();
  context.after(() => server.close());
  const owner = await connect(url, { token: "owner-token" });
  const second = await connect(url, { token: "second-token" });
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());

  const created = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Sala 1x1",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 2,
  });
  assert.equal(created.ok, true);

  const joined = await second.timeout(1_000).emitWithAck("room:join", {
    code: created.room.code,
    clubId: "SAN",
  });
  assert.equal(joined.ok, true);

  const ownerReady = await owner.timeout(1_000).emitWithAck("room:ready", {
    code: created.room.code,
    ready: true,
  });
  const secondReady = await second.timeout(1_000).emitWithAck("room:ready", {
    code: created.room.code,
    ready: true,
  });
  assert.equal(ownerReady.ok, true);
  assert.equal(secondReady.ok, true);

  const roomStarted = await owner.timeout(1_000).emitWithAck("room:start", { code: created.room.code });
  assert.equal(roomStarted.ok, true);
  assert.equal(roomStarted.room.fixtureSchedule[0].managerIds.length, 1);

  const premature = await owner.timeout(1_000).emitWithAck("match:start", { code: created.room.code });
  assert.equal(premature.ok, false);
  assert.equal(premature.error.code, "MATCH_MANAGERS_NOT_READY");

  const ownerStarted = new Promise((resolve) => owner.once("match:started", resolve));
  const secondStarted = new Promise((resolve) => second.once("match:started", resolve));
  const ownerEvent = new Promise((resolve) => owner.once("match:event", resolve));
  const secondEvent = new Promise((resolve) => second.once("match:event", resolve));
  const ownerFinished = new Promise((resolve) => owner.once("match:finished", resolve));
  const secondFinished = new Promise((resolve) => second.once("match:finished", resolve));

  let startedBeforeEveryoneWasReady = false;
  owner.once("match:started", () => { startedBeforeEveryoneWasReady = true; });
  const firstConfirmation = await owner.timeout(1_000).emitWithAck("match:ready", {
    code: created.room.code,
    ready: true,
  });
  assert.equal(firstConfirmation.ok, true);
  assert.equal(firstConfirmation.started, false);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(startedBeforeEveryoneWasReady, false);

  const start = await second.timeout(1_000).emitWithAck("match:ready", {
    code: created.room.code,
    ready: true,
  });
  assert.equal(start.ok, true);
  assert.equal(start.started, true);

  const [ownerStart, secondStart, firstOwnerEvent, firstSecondEvent, ownerResult, secondResult] = await Promise.all([
    ownerStarted,
    secondStarted,
    ownerEvent,
    secondEvent,
    ownerFinished,
    secondFinished,
  ]);

  assert.equal(ownerStart.id, start.matchId);
  assert.equal(ownerStart.code, created.room.code);
  assert.equal(secondStart.id, start.matchId);
  assert.equal(secondStart.code, created.room.code);
  assert.equal(firstOwnerEvent.matchId, start.matchId);
  assert.equal(firstOwnerEvent.code, created.room.code);
  assert.equal(firstSecondEvent.matchId, start.matchId);
  assert.equal(firstSecondEvent.code, created.room.code);
  assert.equal(ownerResult.id, start.matchId);
  assert.equal(ownerResult.code, created.room.code);
  assert.equal(secondResult.id, start.matchId);
  assert.equal(secondResult.code, created.room.code);
});

test("encerramento do servidor cancela sessao de partida viva", async () => {
  const { server, url } = await startTestServer({ matchDelayMs: 5_000 });
  const client = await connect(url, { token: "owner-token" });
  try {
    const room = await createActiveRoom(client);
    const firstEvent = new Promise((resolve) => client.once("match:event", resolve));
    await client.timeout(1_000).emitWithAck("match:ready", { code: room.code, ready: true });
    await firstEvent;
    let timeout;
    try {
      await Promise.race([
        server.close(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("close timeout")), 1_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    assert.equal(server.httpServer.listening, false);
  } finally {
    client.disconnect();
    if (server.httpServer.listening) await server.close();
  }
});

test("room:delete exige owner, oculta sala de intruso e avisa todos os managers", async (context) => {
  const { server, store, url } = await startTestServer();
  context.after(() => server.close());
  const owner = await connect(url, { token: "owner-token" });
  const second = await connect(url, { token: "second-token" });
  const intruder = await connect(url, { token: "intruder-token" });
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());
  context.after(() => intruder.disconnect());

  const created = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Save descartavel",
    clubId: "AUR",
  });
  assert.equal(created.ok, true);
  const joined = await second.timeout(1_000).emitWithAck("room:join", {
    code: created.room.code,
    clubId: "SAN",
  });
  assert.equal(joined.ok, true);

  const hidden = await intruder.timeout(1_000).emitWithAck("room:delete", { code: created.room.code });
  assert.equal(hidden.ok, false);
  assert.equal(hidden.error.code, "ROOM_NOT_FOUND");
  const forbidden = await second.timeout(1_000).emitWithAck("room:delete", { code: created.room.code });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.error.code, "OWNER_REQUIRED");

  const ownerDeleted = new Promise((resolve) => owner.once("room:deleted", resolve));
  const secondDeleted = new Promise((resolve) => second.once("room:deleted", resolve));
  const deletion = await owner.timeout(1_000).emitWithAck("room:delete", { code: created.room.code });
  assert.equal(deletion.ok, true);
  assert.equal(deletion.code, created.room.code);
  assert.deepEqual(await Promise.all([ownerDeleted, secondDeleted]), [
    { code: created.room.code },
    { code: created.room.code },
  ]);
  assert.equal(await store.getRoom(created.room.code), null);
  assert.equal(server.io.sockets.adapter.rooms.has(`room:${created.room.code}`), false);

  let leakedState = null;
  owner.once("room:state", (room) => { leakedState = room; });
  server.io.to(`room:${created.room.code}`).emit("room:state", {
    ...created.room,
    name: "Save novo secreto",
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(leakedState, null);

  const reused = await intruder.timeout(1_000).emitWithAck("room:create", {
    name: "Tentativa de reutilizar codigo",
    clubId: "PAL",
  });
  assert.equal(reused.ok, false);
  assert.equal(reused.error.code, "CODE_EXHAUSTED");
});

test("room:delete rejeita exclusao durante partida em andamento", async (context) => {
  const { server, store, url } = await startTestServer({ matchDelayMs: 5_000 });
  context.after(() => server.close());
  const owner = await connect(url, { token: "owner-token" });
  context.after(() => owner.disconnect());
  const room = await createActiveRoom(owner);

  const started = await owner.timeout(1_000).emitWithAck("match:ready", { code: room.code, ready: true });
  assert.equal(started.ok, true);
  assert.equal(started.started, true);
  const deletion = await owner.timeout(1_000).emitWithAck("room:delete", { code: room.code });
  assert.equal(deletion.ok, false);
  assert.equal(deletion.error.code, "MATCH_IN_PROGRESS");
  assert.equal(deletion.error.message, "A partida em andamento precisa terminar antes de excluir a temporada");
  assert.equal((await store.getRoom(room.code)).code, room.code);
});

test("room:delete bloqueia corrida com o ultimo match:ready", async (context) => {
  const base = new MemoryRoomPersistence();
  let releaseRemove;
  let signalRemove;
  const removeReleased = new Promise((resolve) => { releaseRemove = resolve; });
  const removeStarted = new Promise((resolve) => { signalRemove = resolve; });
  const persistence = {
    create: (...args) => base.create(...args),
    get: (...args) => base.get(...args),
    save: (...args) => base.save(...args),
    mutate: (...args) => base.mutate(...args),
    listByManager: (...args) => base.listByManager(...args),
    remove: async (...args) => {
      signalRemove();
      await removeReleased;
      return base.remove(...args);
    },
  };
  const store = new RoomStore({
    persistence,
    codeFactory: () => "BOLA-RACE",
  });
  const { server, url } = await startTestServer({ store, matchDelayMs: 5_000 });
  context.after(() => releaseRemove());
  context.after(() => server.close());
  const owner = await connect(url, { token: "owner-token" });
  const second = await connect(url, { token: "second-token" });
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());

  const created = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Save com corrida",
    clubId: "AUR",
  });
  await second.timeout(1_000).emitWithAck("room:join", { code: created.room.code, clubId: "SAN" });
  await owner.timeout(1_000).emitWithAck("room:ready", { code: created.room.code, ready: true });
  await second.timeout(1_000).emitWithAck("room:ready", { code: created.room.code, ready: true });
  await owner.timeout(1_000).emitWithAck("room:start", { code: created.room.code });
  const ownerMatchReady = await owner.timeout(1_000).emitWithAck("match:ready", {
    code: created.room.code,
    ready: true,
  });
  assert.equal(ownerMatchReady.ok, true);
  assert.equal(ownerMatchReady.started, false);

  let matchStarted = false;
  owner.once("match:started", () => { matchStarted = true; });
  const deletionPromise = owner.timeout(1_000).emitWithAck("room:delete", { code: created.room.code });
  await removeStarted;
  const lastReady = await second.timeout(1_000).emitWithAck("match:ready", {
    code: created.room.code,
    ready: true,
  });
  assert.equal(lastReady.ok, false);
  assert.equal(lastReady.error.code, "ROOM_NOT_FOUND");

  releaseRemove();
  const deletion = await deletionPromise;
  assert.equal(deletion.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(matchStarted, false);
  assert.equal(await store.getRoom(created.room.code), null);
});

test("trocar de save remove o socket do canal anterior", async (context) => {
  const codes = ["BOLA-SV01", "BOLA-SV02"];
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    codeFactory: () => codes.shift() ?? "BOLA-SV03",
  });
  const { server, url } = await startTestServer({ store });
  context.after(() => server.close());
  const owner = await connect(url, { token: "owner-token" });
  context.after(() => owner.disconnect());

  const first = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Primeiro save",
    clubId: "AUR",
  });
  const second = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Segundo save",
    clubId: "SAN",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(server.io.sockets.adapter.rooms.get(`room:${first.room.code}`)?.has(owner.id) ?? false, false);
  assert.equal(server.io.sockets.adapter.rooms.get(`room:${second.room.code}`)?.has(owner.id) ?? false, true);

  const syncFirst = await owner.timeout(1_000).emitWithAck("match:sync", { code: first.room.code });
  assert.equal(syncFirst.ok, true);
  assert.equal(server.io.sockets.adapter.rooms.get(`room:${first.room.code}`)?.has(owner.id) ?? false, true);
  assert.equal(server.io.sockets.adapter.rooms.get(`room:${second.room.code}`)?.has(owner.id) ?? false, false);
  const syncSecond = await owner.timeout(1_000).emitWithAck("match:sync", { code: second.room.code });
  assert.equal(syncSecond.ok, true);
  assert.equal(server.io.sockets.adapter.rooms.get(`room:${first.room.code}`)?.has(owner.id) ?? false, false);
  assert.equal(server.io.sockets.adapter.rooms.get(`room:${second.room.code}`)?.has(owner.id) ?? false, true);

  let leakedState = null;
  owner.once("room:state", (room) => { leakedState = room; });
  server.io.to(`room:${first.room.code}`).emit("room:state", first.room);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(leakedState, null);
});

test("room:resume atrasado nao reentra no canal de save apagado", async (context) => {
  const base = new MemoryRoomPersistence();
  let holdNextGet = false;
  let releaseGet;
  let signalGet;
  const getReleased = new Promise((resolve) => { releaseGet = resolve; });
  const getStarted = new Promise((resolve) => { signalGet = resolve; });
  const persistence = {
    create: (...args) => base.create(...args),
    get: async (...args) => {
      const room = await base.get(...args);
      if (holdNextGet) {
        holdNextGet = false;
        signalGet();
        await getReleased;
      }
      return room;
    },
    save: (...args) => base.save(...args),
    mutate: (...args) => base.mutate(...args),
    listByManager: (...args) => base.listByManager(...args),
    remove: (...args) => base.remove(...args),
  };
  const store = new RoomStore({
    persistence,
    codeFactory: () => "BOLA-LATE",
  });
  const { server, url } = await startTestServer({ store });
  context.after(() => releaseGet());
  context.after(() => server.close());
  const owner = await connect(url, { token: "owner-token" });
  const second = await connect(url, { token: "second-token" });
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());

  const created = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Save atrasado",
    clubId: "AUR",
  });
  await second.timeout(1_000).emitWithAck("room:join", { code: created.room.code, clubId: "SAN" });

  holdNextGet = true;
  const resumePromise = second.timeout(1_000).emitWithAck("room:resume", { code: created.room.code });
  await getStarted;
  const deletion = await owner.timeout(1_000).emitWithAck("room:delete", { code: created.room.code });
  assert.equal(deletion.ok, true);
  releaseGet();
  const resume = await resumePromise;
  assert.equal(resume.ok, false);
  assert.equal(resume.error.code, "ROOM_NOT_FOUND");
  assert.equal(server.io.sockets.adapter.rooms.get(`room:${created.room.code}`)?.has(second.id) ?? false, false);
});

test("match:start migra save legado antes de resolver fixture", async (context) => {
  const legacyRoom = {
    id: "legacy-socket",
    code: "BOLA-LG01",
    name: "Save legado socket",
    ownerId: "uid-owner",
    status: "active",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    startedAt: "2026-07-01T00:00:00.000Z",
    revision: 5,
    version: 5,
    currentFixtureId: "copa-ida",
    completedFixtureIds: ["abertura", "rodada-2"],
    completedMatches: [],
    lastCompletedMatch: null,
    matchReadiness: { fixtureId: "copa-ida", managerIds: ["uid-owner"] },
    managerIds: ["uid-owner"],
    managers: [{
      id: "uid-owner",
      name: "Dona da Sala",
      clubId: "SAN",
      ready: true,
      joinedAt: "2026-07-01T00:00:00.000Z",
    }],
  };
  const store = new RoomStore({ persistence: new MemoryRoomPersistence([legacyRoom]) });
  const { server, url } = await startTestServer({ store });
  context.after(() => server.close());
  const owner = await connect(url, { token: "owner-token" });
  context.after(() => owner.disconnect());

  const migratedState = new Promise((resolve) => owner.once("room:state", resolve));
  const start = await owner.timeout(1_000).emitWithAck("match:start", {
    code: legacyRoom.code,
    fixtureId: "copa-ida",
  });
  const migrated = await migratedState;

  assert.equal(start.ok, false);
  assert.equal(start.error.code, "MATCH_MANAGERS_NOT_READY");
  assert.equal(migrated.scheduleVersion, FIXTURE_SCHEDULE_VERSION);
  assert.equal(migrated.currentFixtureId, "rodada-3");
  assert.deepEqual(migrated.matchReadiness.managerIds, []);
  assert.equal((await store.getRoom(legacyRoom.code)).currentFixtureId, "rodada-3");
});
