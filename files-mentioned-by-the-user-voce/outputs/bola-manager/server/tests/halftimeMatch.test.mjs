import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import { calculateStarImpact } from "../game/starImpact.mjs";
import { startTestServer } from "./testHarness.mjs";
import { MemoryMatchSessionPersistence } from "../store/matchSessionPersistence.mjs";

const STARTING_LINEUP_SIZE = 11;

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

function delay(milliseconds = 30) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function nextEvent(socket, eventName, predicate = () => true, timeoutMs = 2_000) {
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

function createPlayers(clubId) {
  return Array.from({ length: 17 }, (_, index) => ({
    id: `${clubId.toLowerCase()}-${String(index + 1).padStart(2, "0")}`,
    clubId,
    name: `${clubId} Jogador ${index + 1}`,
    overall: 90 - index,
    active: true,
    injured: false,
    suspended: false,
    isStar: index === 0,
  }));
}

function testCatalog() {
  const playersByClub = {
    AUR: createPlayers("AUR"),
    SAN: createPlayers("SAN"),
  };
  return {
    playersByClub,
    store: {
      source: "test",
      async listPlayers(clubId) {
        const players = playersByClub[clubId] ?? [];
        return { players, count: players.length, source: "test" };
      },
      async getStarImpact(clubId, options) {
        return calculateStarImpact(clubId, playersByClub[clubId] ?? [], options);
      },
    },
  };
}

function startingIds(playersByClub, clubId) {
  return playersByClub[clubId].slice(0, STARTING_LINEUP_SIZE).map((player) => player.id);
}

function lineupWithSubstitutions(playersByClub, clubId, count = 1, offset = 0) {
  const initial = startingIds(playersByClub, clubId);
  const bench = playersByClub[clubId].slice(
    STARTING_LINEUP_SIZE + offset,
    STARTING_LINEUP_SIZE + offset + count,
  ).map((player) => player.id);
  return [...initial.slice(0, initial.length - count), ...bench];
}

async function createActiveRoom({ owner, second = null, playersByClub, name = "Teste de intervalo" }) {
  const created = await owner.timeout(1_000).emitWithAck("room:create", {
    name,
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

  const ownerLineup = await owner.timeout(1_000).emitWithAck("lineup:save", {
    code,
    lineupIds: startingIds(playersByClub, "AUR"),
  });
  assert.equal(ownerLineup.ok, true);
  if (second) {
    const secondLineup = await second.timeout(1_000).emitWithAck("lineup:save", {
      code,
      lineupIds: startingIds(playersByClub, "SAN"),
    });
    assert.equal(secondLineup.ok, true);
  }

  const ownerReady = await owner.timeout(1_000).emitWithAck("room:ready", { code, ready: true });
  assert.equal(ownerReady.ok, true);
  if (second) {
    const secondReady = await second.timeout(1_000).emitWithAck("room:ready", { code, ready: true });
    assert.equal(secondReady.ok, true);
  }

  const started = await owner.timeout(1_000).emitWithAck("room:start", { code });
  assert.equal(started.ok, true);
  assert.equal(started.room.status, "active");
  return started.room;
}

async function advanceToHumanFixture(store, code) {
  let room = await store.getRoom(code);
  while (room.currentFixtureId) {
    const current = room.fixtureSchedule.find((fixture) => fixture.fixtureId === room.currentFixtureId);
    if (current?.managerIds.length === 2) return room;
    await store.completeMatch(code, room.currentFixtureId, {
      id: `advance-${room.currentFixtureId}`,
      homeTeam: current?.homeTeam ?? "Mandante",
      awayTeam: current?.awayTeam ?? "Visitante",
      score: [0, 0],
      statistics: {},
      skipped: true,
    });
    room = await store.getRoom(code);
  }
  throw new Error("Fixture entre os dois managers nao encontrada");
}

async function startMatchAndWaitForHalftime({ observer, readyClients, code }) {
  const halftimePromise = nextEvent(observer, "match:halftime");
  let started = null;
  for (const client of readyClients) {
    const acknowledgement = await client.timeout(1_000).emitWithAck("match:ready", { code, ready: true });
    assert.equal(acknowledgement.ok, true);
    if (acknowledgement.started) started = acknowledgement;
  }
  assert.ok(started, "o ultimo manager pronto deve iniciar a partida");
  const halftime = await halftimePromise;
  assert.equal(halftime.code, code);
  assert.equal(halftime.matchId, started.matchId);
  assert.equal(halftime.status, "paused");
  return { started, halftime };
}

function tacticalPlan(playersByClub, clubId, {
  count = 1,
  offset = 0,
  mentality = "positive",
  instruction = "high-line",
} = {}) {
  return {
    lineupIds: lineupWithSubstitutions(playersByClub, clubId, count, offset),
    tactics: { mentality, instruction },
  };
}

test("sync sem partida viva permanece idle e nao bloqueia o proximo pronto", async (context) => {
  const catalog = testCatalog();
  const { server, url } = await startTestServer({ catalogStore: catalog.store });
  context.after(() => server.close());
  const owner = await connect(url);
  context.after(() => owner.disconnect());
  const room = await createActiveRoom({ owner, playersByClub: catalog.playersByClub });

  const synced = await owner.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(synced.ok, true);
  assert.equal(synced.source, "idle");
  assert.equal(synced.phase, "idle");
  assert.equal(synced.started, null);
  assert.equal(synced.halftime, null);
});

test("snapshot inconsistente e descartado sem bloquear permanentemente a sala", async (context) => {
  const catalog = testCatalog();
  let snapshot = null;
  let removed = false;
  const activeMatches = {
    async get() { return snapshot ? structuredClone(snapshot) : null; },
    async has() { return Boolean(snapshot); },
    async save(session) { snapshot = structuredClone(session); return structuredClone(session); },
    async remove() { removed = true; snapshot = null; return true; },
  };
  const { server, store, url } = await startTestServer({
    catalogStore: catalog.store,
    matchSessionStore: activeMatches,
  });
  context.after(() => server.close());
  const owner = await connect(url);
  const second = await connect(url, "second-token");
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());
  const initial = await createActiveRoom({
    owner,
    second,
    playersByClub: catalog.playersByClub,
  });
  const room = await advanceToHumanFixture(store, initial.code);
  await store.setMatchReady(room.code, "uid-owner", true, room.currentFixtureId);
  await store.setMatchReady(room.code, "uid-second", true, room.currentFixtureId);

  snapshot = {
    version: 1,
    code: "OUTRA-SALA",
    fixtureId: "fixture-inexistente",
    matchId: "match-corrompida",
    match: { id: "match-corrompida" },
  };
  const rejected = await owner.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "ACTIVE_MATCH_RECOVERY_FAILED");
  assert.equal(removed, true);
  assert.deepEqual((await store.getRoom(room.code)).matchReadiness.managerIds, []);

  const firstReady = await owner.timeout(1_000).emitWithAck("match:ready", {
    code: room.code,
    ready: true,
  });
  assert.equal(firstReady.ok, true);
  assert.equal(firstReady.started, false);
  const lastReady = await second.timeout(1_000).emitWithAck("match:ready", {
    code: room.code,
    ready: true,
  });
  assert.equal(lastReady.ok, true);
  assert.equal(lastReady.started, true);
});

test("reinicio no intervalo restaura eventos, plano, velocidade e prontidao", async () => {
  const catalog = testCatalog();
  const activeMatches = new MemoryMatchSessionPersistence();
  let first = await startTestServer({
    catalogStore: catalog.store,
    matchSessionStore: activeMatches,
    matchDelayMs: 0,
  });
  let owner = await connect(first.url);
  let second = await connect(first.url, "second-token");
  let restarted = null;
  let restartedOwner = null;
  let restartedSecond = null;

  try {
    const initial = await createActiveRoom({
      owner,
      second,
      playersByClub: catalog.playersByClub,
      name: "Partida recuperavel",
    });
    const room = await advanceToHumanFixture(first.store, initial.code);
    const { started } = await startMatchAndWaitForHalftime({
      observer: owner,
      readyClients: [owner, second],
      code: room.code,
    });
    const plan = tacticalPlan(catalog.playersByClub, "AUR", {
      mentality: "attacking",
      instruction: "exploit-right",
    });
    const saved = await owner.timeout(1_000).emitWithAck("match:halftime-plan", {
      code: room.code,
      matchId: started.matchId,
      ...plan,
    });
    assert.equal(saved.ok, true);
    const speed = await owner.timeout(1_000).emitWithAck("match:speed", {
      code: room.code,
      matchId: started.matchId,
      speed: 3,
    });
    assert.equal(speed.ok, true);
    const firstReady = await owner.timeout(1_000).emitWithAck("match:halftime-ready", {
      code: room.code,
      matchId: started.matchId,
      ready: true,
    });
    assert.equal(firstReady.resumed, false);

    const persistedBeforeRestart = await activeMatches.get(room.code);
    assert.equal(persistedBeforeRestart.phase, "halftime");
    assert.deepEqual(persistedBeforeRestart.halftime.readyManagerIds, ["uid-owner"]);
    assert.equal(persistedBeforeRestart.halftime.plans.length, 1);
    assert.equal(persistedBeforeRestart.speed.rate, 3);
    assert.equal(persistedBeforeRestart.emittedEvents.at(-1).type, "halftime");
    await activeMatches.save({ ...persistedBeforeRestart, code: room.code.toLowerCase() });

    owner.disconnect();
    second.disconnect();
    owner = null;
    second = null;
    await first.server.close();

    restarted = await startTestServer({
      store: first.store,
      catalogStore: catalog.store,
      matchSessionStore: activeMatches,
      matchDelayMs: 0,
    });
    restartedOwner = await connect(restarted.url);
    restartedSecond = await connect(restarted.url, "second-token");
    const eventsAfterRestart = [];
    restartedOwner.on("match:event", (event) => eventsAfterRestart.push(event));
    const ownerSync = await restartedOwner.timeout(1_000).emitWithAck("match:sync", { code: room.code });
    const secondSync = await restartedSecond.timeout(1_000).emitWithAck("match:sync", { code: room.code });
    assert.equal(ownerSync.source, "live");
    assert.equal(ownerSync.phase, "halftime");
    assert.equal(ownerSync.started.code, room.code);
    assert.equal(ownerSync.started.id, started.matchId);
    assert.equal(ownerSync.events.length, persistedBeforeRestart.emittedEvents.length);
    assert.deepEqual(ownerSync.halftime.readyManagerIds, ["uid-owner"]);
    assert.deepEqual(ownerSync.halftime.ownPlan.lineupIds, plan.lineupIds);
    assert.equal(ownerSync.speed.rate, 3);
    assert.equal(secondSync.halftime.ownPlan, null);

    const finished = nextEvent(restartedOwner, "match:finished", () => true, 3_000);
    const lastReady = await restartedSecond.timeout(1_000).emitWithAck("match:halftime-ready", {
      code: room.code,
      matchId: started.matchId,
      ready: true,
    });
    assert.equal(lastReady.ok, true);
    assert.equal(lastReady.resumed, true);
    assert.equal((await finished).id, started.matchId);
    assert.equal(eventsAfterRestart.length > 0, true);
    assert.equal(eventsAfterRestart.every((event) => event.minute > 45), true);
    assert.equal(await activeMatches.get(room.code), null);
  } finally {
    owner?.disconnect();
    second?.disconnect();
    restartedOwner?.disconnect();
    restartedSecond?.disconnect();
    if (first.server.httpServer.listening) await first.server.close();
    if (restarted?.server.httpServer.listening) await restarted.server.close();
  }
});

test("snapshot legado sem manager nao fica travado no intervalo apos reinicio", async () => {
  const catalog = testCatalog();
  const activeMatches = new MemoryMatchSessionPersistence();
  let first = await startTestServer({
    catalogStore: catalog.store,
    matchSessionStore: activeMatches,
    matchDelayMs: 0,
  });
  let owner = await connect(first.url);
  let restarted = null;
  let restartedOwner = null;

  try {
    const room = await createActiveRoom({ owner, playersByClub: catalog.playersByClub });
    const { started } = await startMatchAndWaitForHalftime({
      observer: owner,
      readyClients: [owner],
      code: room.code,
    });
    const snapshot = await activeMatches.get(room.code);
    await activeMatches.save({
      ...snapshot,
      homeManagerId: null,
      awayManagerId: null,
      halftime: {
        ...snapshot.halftime,
        requiredManagerIds: [],
        readyManagerIds: [],
        plans: [],
      },
    });

    owner.disconnect();
    owner = null;
    await first.server.close();

    restarted = await startTestServer({
      store: first.store,
      catalogStore: catalog.store,
      matchSessionStore: activeMatches,
      matchDelayMs: 0,
    });
    restartedOwner = await connect(restarted.url);
    const finished = nextEvent(restartedOwner, "match:finished", () => true, 3_000);
    const synced = await restartedOwner.timeout(1_000).emitWithAck("match:sync", { code: room.code });
    assert.equal(synced.ok, true);
    assert.equal(synced.phase, "running");
    assert.equal(synced.started.id, started.matchId);
    assert.equal((await finished).id, started.matchId);
    assert.equal(await activeMatches.get(room.code), null);
  } finally {
    owner?.disconnect();
    restartedOwner?.disconnect();
    if (first.server.httpServer.listening) await first.server.close();
    if (restarted?.server.httpServer.listening) await restarted.server.close();
  }
});

test("skip acelera somente ate 45 e um unico humano libera o segundo tempo", async (context) => {
  const catalog = testCatalog();
  const { server, url } = await startTestServer({ catalogStore: catalog.store, matchDelayMs: 5_000 });
  context.after(() => server.close());
  const owner = await connect(url);
  context.after(() => owner.disconnect());
  const room = await createActiveRoom({ owner, playersByClub: catalog.playersByClub });

  const halftimePromise = nextEvent(owner, "match:halftime");
  const finishedPromise = nextEvent(owner, "match:finished");
  const eventsAfterHalftime = [];
  let halftimeSeen = false;
  owner.on("match:event", (event) => {
    if (halftimeSeen && event.minute > 45) eventsAfterHalftime.push(event);
  });

  const start = await owner.timeout(1_000).emitWithAck("match:ready", { code: room.code, ready: true });
  assert.equal(start.ok, true);
  assert.equal(start.started, true);
  const skipped = await owner.timeout(1_000).emitWithAck("match:skip", { code: room.code });
  assert.equal(skipped.ok, true);

  const halftime = await halftimePromise;
  halftimeSeen = true;
  assert.equal(halftime.requiredCount, 1);
  assert.deepEqual(halftime.requiredManagerIds, ["uid-owner"]);
  assert.equal(halftime.readyCount, 0);
  assert.equal(halftime.allReady, false);
  assert.equal("ownPlan" in halftime, false, "broadcast publico nao deve carregar plano privado");

  const skipAtHalftime = await owner.timeout(1_000).emitWithAck("match:skip", { code: room.code });
  assert.equal(skipAtHalftime.ok, false);
  assert.equal(skipAtHalftime.error.code, "HALFTIME_ACTIVE");
  await delay();
  assert.deepEqual(eventsAfterHalftime, [], "skip nao pode atravessar a pausa do intervalo");

  const resumedEvent = nextEvent(owner, "match:resumed");
  const ready = await owner.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: start.matchId,
    ready: true,
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.resumed, true);
  assert.equal(ready.halftime.allReady, true);
  assert.equal(ready.halftime.participant, true);
  assert.equal((await resumedEvent).matchId, start.matchId);
  const result = await finishedPromise;
  assert.equal(result.id, start.matchId);
  assert.equal(eventsAfterHalftime.length > 0, true);
});

test("partida entre humanos espera os dois managers no intervalo", async (context) => {
  const catalog = testCatalog();
  const { server, store, url } = await startTestServer({ catalogStore: catalog.store });
  context.after(() => server.close());
  const owner = await connect(url);
  const second = await connect(url, "second-token");
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());
  const initialRoom = await createActiveRoom({ owner, second, playersByClub: catalog.playersByClub });
  const room = await advanceToHumanFixture(store, initialRoom.code);
  const fixture = room.fixtureSchedule.find((candidate) => candidate.fixtureId === room.currentFixtureId);
  assert.deepEqual([...fixture.managerIds].sort(), ["uid-owner", "uid-second"]);

  const { started, halftime } = await startMatchAndWaitForHalftime({
    observer: owner,
    readyClients: [owner, second],
    code: room.code,
  });
  assert.equal(halftime.requiredCount, 2);
  assert.deepEqual([...halftime.requiredManagerIds].sort(), ["uid-owner", "uid-second"]);

  let resumed = false;
  let finished = false;
  owner.once("match:resumed", () => { resumed = true; });
  owner.once("match:finished", () => { finished = true; });
  const ownerReady = await owner.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.matchId,
    ready: true,
  });
  assert.equal(ownerReady.ok, true);
  assert.equal(ownerReady.resumed, false);
  assert.equal(ownerReady.halftime.readyCount, 1);
  assert.equal(ownerReady.halftime.allReady, false);
  await delay();
  assert.equal(resumed, false);
  assert.equal(finished, false);

  const resumedPromise = nextEvent(owner, "match:resumed");
  const finishedPromise = nextEvent(owner, "match:finished");
  const secondReady = await second.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.matchId,
    ready: true,
  });
  assert.equal(secondReady.ok, true);
  assert.equal(secondReady.resumed, true);
  assert.equal(secondReady.halftime.readyCount, 2);
  assert.equal(secondReady.halftime.allReady, true);
  assert.equal((await resumedPromise).matchId, started.matchId);
  assert.equal((await finishedPromise).id, started.matchId);
});

test("manager fora da fixture nao altera nem bloqueia o intervalo", async (context) => {
  const catalog = testCatalog();
  const { server, url } = await startTestServer({ catalogStore: catalog.store });
  context.after(() => server.close());
  const owner = await connect(url);
  const second = await connect(url, "second-token");
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());
  const room = await createActiveRoom({ owner, second, playersByClub: catalog.playersByClub });

  // A primeira rodada do calendario padrao e AUR x IA; SAN apenas acompanha a transmissao.
  const { started, halftime } = await startMatchAndWaitForHalftime({
    observer: second,
    readyClients: [second, owner],
    code: room.code,
  });
  assert.deepEqual(halftime.requiredManagerIds, ["uid-owner"]);
  assert.equal(halftime.requiredCount, 1);

  const forbiddenPlan = await second.timeout(1_000).emitWithAck("match:halftime-plan", {
    code: room.code,
    matchId: started.matchId,
    ...tacticalPlan(catalog.playersByClub, "SAN"),
  });
  assert.equal(forbiddenPlan.ok, false);
  assert.equal(forbiddenPlan.error.code, "HALFTIME_NOT_PARTICIPANT");
  const forbiddenReady = await second.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.matchId,
    ready: true,
  });
  assert.equal(forbiddenReady.ok, false);
  assert.equal(forbiddenReady.error.code, "HALFTIME_NOT_PARTICIPANT");

  const spectatorSync = await second.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(spectatorSync.ok, true);
  assert.equal(spectatorSync.phase, "halftime");
  assert.equal(spectatorSync.halftime.participant, false);
  assert.equal(spectatorSync.halftime.ownPlan, null);

  const finishedPromise = nextEvent(second, "match:finished");
  const ownerReady = await owner.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.matchId,
    ready: true,
  });
  assert.equal(ownerReady.ok, true);
  assert.equal(ownerReady.resumed, true, "o espectador nao deve bloquear o reinicio");
  assert.equal((await finishedPromise).id, started.matchId);
});

test("reconexao no segundo tempo recupera o plano privado aplicado", async (context) => {
  const catalog = testCatalog();
  const { server, url } = await startTestServer({ catalogStore: catalog.store, matchDelayMs: 100 });
  context.after(() => server.close());
  let owner = await connect(url);
  context.after(() => owner?.disconnect());
  const room = await createActiveRoom({ owner, playersByClub: catalog.playersByClub });
  const { started } = await startMatchAndWaitForHalftime({
    observer: owner,
    readyClients: [owner],
    code: room.code,
  });
  const plan = tacticalPlan(catalog.playersByClub, "AUR", {
    mentality: "balanced",
    instruction: "keep-plan",
  });
  const saved = await owner.timeout(1_000).emitWithAck("match:halftime-plan", {
    code: room.code,
    matchId: started.matchId,
    ...plan,
  });
  assert.equal(saved.ok, true);

  const resumed = nextEvent(owner, "match:resumed");
  const ready = await owner.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.matchId,
    ready: true,
  });
  assert.equal(ready.ok, true);
  await resumed;

  owner.disconnect();
  owner = await connect(url);
  const synced = await owner.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(synced.ok, true);
  assert.equal(synced.source, "live");
  assert.equal(synced.phase, "running");
  assert.equal(synced.halftime.participant, true);
  assert.equal(synced.halftime.ownPlan.substitutionCount, 1);
  assert.deepEqual(synced.halftime.ownPlan.lineupIds, plan.lineupIds);
});

test("fallback demo remove o buff quando uma estrela sai no intervalo", async (context) => {
  const demoStars = [
    { id: "p08", clubId: "AUR", name: "Igor Sampaio", active: true, isStar: true },
    { id: "p10", clubId: "AUR", name: "Felipe Rocha", active: true, isStar: true },
  ];
  const catalogStore = {
    source: "demo-fallback",
    async listPlayers() {
      return { players: [], count: 0, source: "demo-fallback" };
    },
    async getStarImpact(clubId, options) {
      return calculateStarImpact(clubId, clubId === "AUR" ? demoStars : [], options);
    },
  };
  const { server, url } = await startTestServer({ catalogStore });
  context.after(() => server.close());
  const owner = await connect(url);
  context.after(() => owner.disconnect());
  const created = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Estrelas demo no intervalo",
    clubId: "AUR",
  });
  const initialLineup = Array.from(
    { length: STARTING_LINEUP_SIZE },
    (_, index) => `p${String(index + 1).padStart(2, "0")}`,
  );
  const saved = await owner.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    lineupIds: initialLineup,
  });
  assert.equal(saved.ok, true);
  await owner.timeout(1_000).emitWithAck("room:ready", { code: created.room.code, ready: true });
  const active = await owner.timeout(1_000).emitWithAck("room:start", { code: created.room.code });

  const halftimePromise = nextEvent(owner, "match:halftime");
  const finishedPromise = nextEvent(owner, "match:finished");
  const started = await owner.timeout(1_000).emitWithAck("match:ready", {
    code: active.room.code,
    ready: true,
  });
  await halftimePromise;
  const secondHalfLineup = initialLineup.map((playerId) => playerId === "p08" ? "p12" : playerId);
  const plan = await owner.timeout(1_000).emitWithAck("match:halftime-plan", {
    code: active.room.code,
    matchId: started.matchId,
    lineupIds: secondHalfLineup,
    tactics: { mentality: "balanced", instruction: "keep-plan" },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.halftime.ownPlan.substitutionCount, 1);
  await owner.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: active.room.code,
    matchId: started.matchId,
    ready: true,
  });
  const result = await finishedPromise;
  assert.equal(result.halftimeAdjustments.homeTacticalModifier, -0.25);
  assert.equal(
    result.halftimeAdjustments.homeModifier,
    result.halftimeAdjustments.homeTacticalModifier + result.halftimeAdjustments.homePhysicalModifier,
  );
});

test("plano e privado, valida elenco, sobrevive reconexao e editar remove o pronto", async (context) => {
  const catalog = testCatalog();
  const { server, store, url } = await startTestServer({ catalogStore: catalog.store });
  context.after(() => server.close());
  let owner = await connect(url);
  const second = await connect(url, "second-token");
  context.after(() => owner?.disconnect());
  context.after(() => second.disconnect());
  const initialRoom = await createActiveRoom({ owner, second, playersByClub: catalog.playersByClub });
  const room = await advanceToHumanFixture(store, initialRoom.code);
  const { started } = await startMatchAndWaitForHalftime({
    observer: owner,
    readyClients: [owner, second],
    code: room.code,
  });

  const stale = await owner.timeout(1_000).emitWithAck("match:halftime-plan", {
    code: room.code,
    matchId: "match-stale",
    ...tacticalPlan(catalog.playersByClub, "AUR"),
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "MATCH_ID_MISMATCH");

  const invalid = await owner.timeout(1_000).emitWithAck("match:halftime-plan", {
    code: room.code,
    matchId: started.matchId,
    lineupIds: [...startingIds(catalog.playersByClub, "AUR").slice(0, 10), "forged-player"],
    tactics: { mentality: "positive", instruction: "high-line" },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "LINEUP_PLAYER_NOT_IN_CLUB");

  const tooMany = await owner.timeout(1_000).emitWithAck("match:halftime-plan", {
    code: room.code,
    matchId: started.matchId,
    ...tacticalPlan(catalog.playersByClub, "AUR", { count: 6 }),
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error.code, "HALFTIME_TOO_MANY_SUBSTITUTIONS");

  const firstPlan = tacticalPlan(catalog.playersByClub, "AUR", { offset: 0 });
  const saved = await owner.timeout(1_000).emitWithAck("match:halftime-plan", {
    code: room.code,
    matchId: started.matchId,
    ...firstPlan,
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.halftime.ownPlan.substitutionCount, 1);
  assert.deepEqual(saved.halftime.ownPlan.lineupIds, firstPlan.lineupIds);
  assert.deepEqual(saved.halftime.plansSavedManagerIds, ["uid-owner"]);

  const opponentSync = await second.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(opponentSync.phase, "halftime");
  assert.equal(opponentSync.halftime.participant, true);
  assert.equal(opponentSync.halftime.ownPlan, null);
  assert.equal("plans" in opponentSync.halftime, false);
  assert.equal(
    JSON.stringify(opponentSync).includes(firstPlan.lineupIds.at(-1)),
    false,
    "IDs da alteracao do adversario nao podem vazar pelo sync",
  );

  owner.disconnect();
  owner = await connect(url);
  const reconnectedSync = await owner.timeout(1_000).emitWithAck("match:sync", { code: room.code });
  assert.equal(reconnectedSync.ok, true);
  assert.equal(reconnectedSync.source, "live");
  assert.equal(reconnectedSync.phase, "halftime");
  assert.equal(reconnectedSync.halftime.participant, true);
  assert.deepEqual(reconnectedSync.halftime.ownPlan.lineupIds, firstPlan.lineupIds);
  assert.equal(reconnectedSync.halftime.ownPlan.substitutionCount, 1);

  const firstReady = await owner.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.matchId,
    ready: true,
  });
  assert.equal(firstReady.ok, true);
  assert.equal(firstReady.resumed, false);
  assert.deepEqual(firstReady.halftime.readyManagerIds, ["uid-owner"]);

  const editedPlan = tacticalPlan(catalog.playersByClub, "AUR", {
    offset: 1,
    mentality: "attacking",
    instruction: "exploit-right",
  });
  const edited = await owner.timeout(1_000).emitWithAck("match:halftime-plan", {
    code: room.code,
    matchId: started.matchId,
    ...editedPlan,
  });
  assert.equal(edited.ok, true);
  assert.equal(edited.halftime.readyCount, 0);
  assert.deepEqual(edited.halftime.readyManagerIds, []);
  assert.deepEqual(edited.halftime.ownPlan.lineupIds, editedPlan.lineupIds);

  await owner.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.matchId,
    ready: true,
  });
  const finishedPromise = nextEvent(owner, "match:finished");
  const secondReady = await second.timeout(1_000).emitWithAck("match:halftime-ready", {
    code: room.code,
    matchId: started.matchId,
    ready: true,
  });
  assert.equal(secondReady.ok, true);
  assert.equal(secondReady.resumed, true);
  assert.equal((await finishedPromise).id, started.matchId);
});
