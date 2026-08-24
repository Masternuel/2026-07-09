import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import { MatchPlayback } from "../game/matchSimulator.mjs";
import { automaticallyReadyAtHalftime, startTestServer } from "./testHarness.mjs";

const SPEEDS = [0.5, 1, 2, 3];

function connect(url, token = "owner-token") {
  return new Promise((resolve, reject) => {
    const client = createClient(url, {
      auth: { token },
      forceNew: true,
      reconnection: false,
      timeout: 1_000,
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function delay(milliseconds = 40) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function nextEvent(socket, eventName, predicate = () => true, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Tempo esgotado aguardando ${eventName}`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(eventName, handler);
      resolve(payload);
    };
    socket.on(eventName, handler);
  });
}

async function createActiveRoom(owner, second = null) {
  const created = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Controle de velocidade",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: second ? 2 : 1,
  });
  assert.equal(created.ok, true);
  const code = created.room.code;

  if (second) {
    const joined = await second.timeout(1_000).emitWithAck("room:join", { code, clubId: "SAN" });
    assert.equal(joined.ok, true);
  }
  assert.equal((await owner.timeout(1_000).emitWithAck("room:ready", { code, ready: true })).ok, true);
  if (second) {
    assert.equal((await second.timeout(1_000).emitWithAck("room:ready", { code, ready: true })).ok, true);
  }
  const started = await owner.timeout(1_000).emitWithAck("room:start", { code });
  assert.equal(started.ok, true);
  return started.room;
}

async function startLiveMatch({ owner, second = null, code }) {
  const startedEvent = nextEvent(owner, "match:started");
  if (second) {
    const firstReady = await second.timeout(1_000).emitWithAck("match:ready", { code, ready: true });
    assert.equal(firstReady.ok, true);
    assert.equal(firstReady.started, false);
  }
  const acknowledgement = await owner.timeout(1_000).emitWithAck("match:ready", { code, ready: true });
  assert.equal(acknowledgement.ok, true);
  assert.equal(acknowledgement.started, true);
  const started = await startedEvent;
  assert.equal(started.id, acknowledgement.matchId);
  return { acknowledgement, started };
}

async function advanceToHumanFixture(store, code) {
  let room = await store.getRoom(code);
  while (room.currentFixtureId) {
    const fixture = room.fixtureSchedule.find((candidate) => candidate.fixtureId === room.currentFixtureId);
    if (fixture?.managerIds.length === 2) return room;
    await store.completeMatch(code, room.currentFixtureId, {
      id: `advance-speed-${room.currentFixtureId}`,
      homeTeam: fixture?.homeTeam ?? "Mandante",
      awayTeam: fixture?.awayTeam ?? "Visitante",
      score: [0, 0],
      statistics: {},
      skipped: true,
    });
    room = await store.getRoom(code);
  }
  throw new Error("Fixture entre os managers nao encontrada");
}

function createFakeClock() {
  let currentTime = 0;
  let nextTimerId = 1;
  const timers = new Map();
  return {
    now: () => currentTime,
    setTimer(callback, milliseconds) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, dueAt: currentTime + milliseconds });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    nextDueAt() {
      return Math.min(...[...timers.values()].map((timer) => timer.dueAt));
    },
    async tick(milliseconds) {
      const target = currentTime + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= target)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        currentTime = timer.dueAt;
        timer.callback();
        await Promise.resolve();
      }
      currentTime = target;
      await Promise.resolve();
    },
  };
}

test("MatchPlayback aplica as quatro taxas e reprograma a espera atual", async () => {
  const clock = createFakeClock();
  const received = [];
  const playback = new MatchPlayback({
    id: "match-clock",
    events: [
      { id: "first", minute: 0, type: "kickoff" },
      { id: "second", minute: 3, type: "attack" },
    ],
  }, {
    delayMs: 800,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onEvent(event) {
      received.push(event.id);
    },
  });

  assert.equal(playback.rate, 1);
  assert.equal(playback.baseDelayMs, 800);
  for (const [rate, effectiveDelayMs] of [[2, 400], [3, 800 / 3], [1, 800], [0.5, 1_600]]) {
    assert.equal(playback.setSpeed(rate), true);
    assert.equal(playback.rate, rate);
    assert.equal(playback.effectiveDelayMs, effectiveDelayMs);
  }
  assert.equal(playback.setSpeed(0.5), false);
  for (const invalid of [0, 0.75, 4, Number.NaN]) {
    assert.throws(() => playback.setSpeed(invalid), RangeError);
  }

  const running = playback.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(received, ["first"]);
  assert.equal(clock.nextDueAt(), 1_600);

  await clock.tick(400);
  assert.deepEqual(received, ["first"]);
  assert.equal(playback.setSpeed(3), true);
  // Foram consumidos 200 ms-base em 0.5x; os 600 restantes levam 200 ms em 3x.
  assert.equal(clock.nextDueAt(), 600);
  await clock.tick(199);
  assert.deepEqual(received, ["first"]);
  await clock.tick(1);
  assert.deepEqual(received, ["first", "second"]);
  assert.equal((await running).emittedEvents, 2);
});

test("owner controla velocidade, sync reconecta e nao-owner nao altera nem pula", async (context) => {
  const baseDelayMs = 5_000;
  const { server, url } = await startTestServer({ matchDelayMs: baseDelayMs });
  context.after(() => server.close());
  let owner = await connect(url);
  const second = await connect(url, "second-token");
  context.after(() => owner?.disconnect());
  context.after(() => second.disconnect());
  const room = await createActiveRoom(owner, second);
  const { started } = await startLiveMatch({ owner, second, code: room.code });

  assert.deepEqual(started.speed, {
    code: room.code,
    matchId: started.id,
    rate: 1,
    baseDelayMs,
    effectiveDelayMs: baseDelayMs,
    changedBy: null,
    changedAt: null,
  });
  const initialSync = await second.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(initialSync.ok, true);
  assert.deepEqual(initialSync.speed, started.speed);

  let latestSpeed = started.speed;
  for (const rate of SPEEDS) {
    const ownerChanged = nextEvent(owner, "match:speed-changed", (speed) => speed.rate === rate);
    const secondChanged = nextEvent(second, "match:speed-changed", (speed) => speed.rate === rate);
    const updated = await owner.timeout(1_000).emitWithAck("match:speed", {
      code: room.code,
      matchId: started.id,
      speed: rate,
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.changed, true);
    assert.equal(updated.speed.rate, rate);
    assert.equal(updated.speed.baseDelayMs, baseDelayMs);
    assert.equal(updated.speed.effectiveDelayMs, baseDelayMs / rate);
    assert.equal(updated.speed.changedBy, "uid-owner");
    assert.equal(Number.isNaN(Date.parse(updated.speed.changedAt)), false);
    assert.deepEqual(await Promise.all([ownerChanged, secondChanged]), [updated.speed, updated.speed]);
    latestSpeed = updated.speed;
  }

  let duplicateBroadcasts = 0;
  const countDuplicate = () => { duplicateBroadcasts += 1; };
  owner.on("match:speed-changed", countDuplicate);
  second.on("match:speed-changed", countDuplicate);
  const idempotent = await owner.timeout(1_000).emitWithAck("match:speed", {
    code: room.code,
    matchId: started.id,
    speed: 3,
  });
  await delay();
  owner.off("match:speed-changed", countDuplicate);
  second.off("match:speed-changed", countDuplicate);
  assert.equal(idempotent.ok, true);
  assert.equal(idempotent.changed, false);
  assert.deepEqual(idempotent.speed, latestSpeed);
  assert.equal(duplicateBroadcasts, 0);

  for (const invalidSpeed of [0, 0.75, 4, "2"]) {
    const invalid = await owner.timeout(1_000).emitWithAck("match:speed", {
      code: room.code,
      matchId: started.id,
      speed: invalidSpeed,
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, "VALIDATION_ERROR");
  }
  const stale = await owner.timeout(1_000).emitWithAck("match:speed", {
    code: room.code,
    matchId: "match-anterior",
    speed: 2,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "MATCH_ID_MISMATCH");

  let deniedBroadcasts = 0;
  const countDenied = () => { deniedBroadcasts += 1; };
  owner.on("match:speed-changed", countDenied);
  second.on("match:speed-changed", countDenied);
  const forbiddenSpeed = await second.timeout(1_000).emitWithAck("match:speed", {
    code: room.code,
    matchId: started.id,
    speed: 2,
  });
  await delay();
  owner.off("match:speed-changed", countDenied);
  second.off("match:speed-changed", countDenied);
  assert.equal(forbiddenSpeed.ok, false);
  assert.equal(forbiddenSpeed.error.code, "OWNER_REQUIRED");
  assert.equal(deniedBroadcasts, 0);
  const unchanged = await second.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.deepEqual(unchanged.speed, latestSpeed);

  owner.disconnect();
  owner = await connect(url);
  const reconnected = await owner.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(reconnected.ok, true);
  assert.equal(reconnected.source, "live");
  assert.deepEqual(reconnected.speed, latestSpeed);
  assert.deepEqual(reconnected.started.speed, latestSpeed);

  let deniedSkips = 0;
  const countSkip = () => { deniedSkips += 1; };
  owner.on("match:skipped", countSkip);
  second.on("match:skipped", countSkip);
  const forbiddenSkip = await second.timeout(1_000).emitWithAck("match:skip", { code: room.code });
  await delay();
  assert.equal(forbiddenSkip.ok, false);
  assert.equal(forbiddenSkip.error.code, "OWNER_REQUIRED");
  assert.equal(deniedSkips, 0);

  automaticallyReadyAtHalftime(owner);
  const ownerSkipped = nextEvent(owner, "match:skipped");
  const finished = nextEvent(owner, "match:finished");
  const skipped = await owner.timeout(1_000).emitWithAck("match:skip", { code: room.code });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal((await ownerSkipped).code, room.code);
  assert.equal((await finished).id, started.id);
});

test("controles rejeitam a finalizacao e a partida seguinte volta para x1", async (context) => {
  const { server, store, url } = await startTestServer({ matchDelayMs: 0 });
  context.after(() => server.close());
  const owner = await connect(url);
  context.after(() => owner.disconnect());
  const room = await createActiveRoom(owner);

  const originalCompleteMatch = store.completeMatch.bind(store);
  let releaseCompletion;
  const completionGate = new Promise((resolve) => { releaseCompletion = resolve; });
  let holdCompletion = true;
  store.completeMatch = async (...args) => {
    if (holdCompletion) await completionGate;
    return originalCompleteMatch(...args);
  };

  automaticallyReadyAtHalftime(owner);
  const fulltime = nextEvent(owner, "match:event", (event) => event.type === "fulltime");
  const firstFinished = nextEvent(owner, "match:finished");
  const { started } = await startLiveMatch({ owner, code: room.code });
  await fulltime;

  let skippedBroadcasts = 0;
  const countSkipped = () => { skippedBroadcasts += 1; };
  owner.on("match:skipped", countSkipped);
  const lateSkip = await owner.timeout(1_000).emitWithAck("match:skip", { code: room.code });
  const lateSpeed = await owner.timeout(1_000).emitWithAck("match:speed", {
    code: room.code,
    matchId: started.id,
    speed: 2,
  });
  await delay();
  owner.off("match:skipped", countSkipped);

  assert.equal(lateSkip.ok, false);
  assert.equal(lateSkip.error.code, "MATCH_FINISHED");
  assert.equal(lateSpeed.ok, false);
  assert.equal(lateSpeed.error.code, "MATCH_FINISHED");
  assert.equal(skippedBroadcasts, 0);

  holdCompletion = false;
  releaseCompletion();
  const firstResult = await firstFinished;
  assert.equal(firstResult.id, started.id);
  assert.ok(firstResult.nextFixtureId, "a temporada deve manter uma proxima partida para validar o reset");

  automaticallyReadyAtHalftime(owner);
  const secondStartedEvent = nextEvent(owner, "match:started");
  const secondFinished = nextEvent(owner, "match:finished");
  const secondAcknowledgement = await owner.timeout(1_000).emitWithAck("match:ready", {
    code: room.code,
    fixtureId: firstResult.nextFixtureId,
    ready: true,
  });
  assert.equal(secondAcknowledgement.ok, true);
  assert.equal(secondAcknowledgement.started, true);
  const secondStarted = await secondStartedEvent;
  assert.notEqual(secondStarted.id, started.id);
  assert.equal(secondStarted.speed.rate, 1);
  assert.equal(secondStarted.speed.changedBy, null);
  assert.equal(secondStarted.speed.changedAt, null);
  assert.equal((await secondFinished).id, secondStarted.id);
});

test("velocidade muda no intervalo sem reiniciar ou apagar prontidao", async (context) => {
  const baseDelayMs = 300;
  const { server, store, url } = await startTestServer({ matchDelayMs: baseDelayMs });
  context.after(() => server.close());
  const owner = await connect(url);
  const second = await connect(url, "second-token");
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());
  const initialRoom = await createActiveRoom(owner, second);
  const room = await advanceToHumanFixture(store, initialRoom.code);
  const fixture = room.fixtureSchedule.find((candidate) => candidate.fixtureId === room.currentFixtureId);
  assert.deepEqual([...fixture.managerIds].sort(), ["uid-owner", "uid-second"]);

  const halftimePromise = nextEvent(owner, "match:halftime");
  const { started } = await startLiveMatch({ owner, second, code: room.code });
  const fast = await owner.timeout(1_000).emitWithAck("match:speed", {
    code: room.code,
    matchId: started.id,
    speed: 3,
  });
  assert.equal(fast.ok, true);
  assert.equal(fast.speed.effectiveDelayMs, 100);
  const halftime = await halftimePromise;
  assert.equal(halftime.requiredCount, 2);

  const firstReady = await owner.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.id,
    ready: true,
  });
  assert.equal(firstReady.ok, true);
  assert.equal(firstReady.resumed, false);
  assert.deepEqual(firstReady.halftime.readyManagerIds, ["uid-owner"]);

  let resumedEarly = false;
  const secondHalfEvents = [];
  owner.once("match:resumed", () => { resumedEarly = true; });
  owner.on("match:event", (event) => {
    if (event.minute > 45) secondHalfEvents.push(event);
  });
  const speedBroadcast = nextEvent(second, "match:speed-changed", (speed) => speed.rate === 0.5);
  const slowed = await owner.timeout(1_000).emitWithAck("match:speed", {
    code: room.code,
    matchId: started.id,
    speed: 0.5,
  });
  assert.equal(slowed.ok, true);
  assert.equal(slowed.changed, true);
  assert.equal(slowed.speed.effectiveDelayMs, 600);
  assert.deepEqual(await speedBroadcast, slowed.speed);

  const pausedSync = await second.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(pausedSync.phase, "halftime");
  assert.deepEqual(pausedSync.speed, slowed.speed);
  assert.deepEqual(pausedSync.halftime.readyManagerIds, ["uid-owner"]);
  assert.equal(pausedSync.halftime.readyCount, 1);
  assert.deepEqual(pausedSync.halftime.plansSavedManagerIds, []);
  await delay(60);
  assert.equal(resumedEarly, false);
  assert.deepEqual(secondHalfEvents, []);

  let resumedAt = 0;
  const resumed = new Promise((resolve) => {
    owner.once("match:resumed", (payload) => {
      resumedAt = performance.now();
      resolve(payload);
    });
  });
  const secondHalfEvent = nextEvent(owner, "match:event", (event) => event.minute > 45);
  const lastReady = await second.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.id,
    ready: true,
  });
  assert.equal(lastReady.ok, true);
  assert.equal(lastReady.resumed, true);
  assert.equal((await resumed).matchId, started.id);
  await secondHalfEvent;
  assert.equal(
    performance.now() - resumedAt >= 400,
    true,
    "o primeiro evento do segundo tempo deve respeitar 0.5x (600 ms efetivos)",
  );

  const runningSync = await owner.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(runningSync.phase, "running");
  assert.deepEqual(runningSync.speed, slowed.speed);
  const finished = nextEvent(owner, "match:finished");
  const skip = await owner.timeout(1_000).emitWithAck("match:skip", { code: room.code });
  assert.equal(skip.ok, true);
  assert.equal((await finished).id, started.id);
});
