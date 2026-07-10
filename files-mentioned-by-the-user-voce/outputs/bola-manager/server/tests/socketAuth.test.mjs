import test from "node:test";
import assert from "node:assert/strict";
import { io as createClient } from "socket.io-client";
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
  return created.room;
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
    const matchAck = await firstClient.timeout(1_000).emitWithAck("match:start", {
      code: room.code,
      fixtureId: "abertura",
    });
    order.push("ack");
    const result = await finished;
    assert.equal(matchAck.ok, true);
    assert.deepEqual(order.slice(0, 3), ["ack", "started", "event"]);
    assert.equal(result.homeTeam, "Aurora FC");
    assert.equal(result.nextFixtureId, "rodada-2");

    const persistedRoom = await first.store.getRoom(room.code);
    assert.deepEqual(persistedRoom.completedFixtureIds, ["abertura"]);
    assert.equal(persistedRoom.currentFixtureId, "rodada-2");
    assert.equal(persistedRoom.lastCompletedMatch.id, result.id);
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
  const start = await client.timeout(1_000).emitWithAck("match:start", { code: room.code });
  const event = await firstEvent;
  const sync = await client.timeout(1_000).emitWithAck("match:sync", { code: room.code });

  assert.equal(start.ok, true);
  assert.equal(sync.ok, true);
  assert.equal(sync.source, "live");
  assert.equal(sync.started.id, start.matchId);
  assert.equal(sync.events.length >= 1, true);
  assert.equal(sync.events[0].matchId, start.matchId);
  assert.equal(sync.events[0].fixtureId, "abertura");
  assert.equal(event.matchId, start.matchId);
  assert.equal(sync.result, null);

  const skipped = await client.timeout(1_000).emitWithAck("match:skip", { code: room.code });
  assert.equal(skipped.ok, true);
  await finished;
});

test("encerramento do servidor cancela sessao de partida viva", async () => {
  const { server, url } = await startTestServer({ matchDelayMs: 5_000 });
  const client = await connect(url, { token: "owner-token" });
  try {
    const room = await createActiveRoom(client);
    const firstEvent = new Promise((resolve) => client.once("match:event", resolve));
    await client.timeout(1_000).emitWithAck("match:start", { code: room.code });
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
