import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { FirestoreMatchSessionPersistence, MemoryMatchSessionPersistence } from "../store/matchSessionPersistence.mjs";
import { encodeMatchFields, decodeMatchFields } from "../store/matchFirestoreValues.mjs";
import { createFakeMatchFirestoreV1 } from "./helpers/fakeMatchFirestoreV1.mjs";
import { startMatchFirestoreServer } from "./helpers/matchFirestoreServer.mjs";
import { tacticPlanSchema } from "../schemas.mjs";
import { DEFAULT_TACTIC_PLAN, FORMATION_ROLES, applyPregameTacticsToFixture, validateLineupForFormation } from "../game/tactics.mjs";
import { REQUIRED_ATTRIBUTE_KEYS, calculateLineupAttributeProfile, applyLineupAttributeProfiles } from "../game/lineupStrength.mjs";
import { simulateMatch } from "../game/matchSimulator.mjs";
import { serializeActiveMatchSession, hydrateActiveMatchSession } from "../game/activeMatchSession.mjs";

const owner = { token: "replica-new", fence: 2 };
const snapshot = (sequence = 1) => ({
  version: 1, code: "BOLA", matchId: "match-1", fixtureId: "fixture-1",
  _matchSequence: sequence, _matchGeneration: "generation-1", phase: "halftime",
  match: { id: "match-1", score: [1, 0], events: [{ minute: 42, type: "goal", optional: null }] },
  homeRoster: { players: [{ id: "player-1", condition: 92.5, available: true }], knownIds: ["player-1"] },
  halftime: { requiredManagerIds: ["manager-1"], readyManagerIds: [], plans: [] },
  emittedEvents: [], nextEventIndex: sequence, speed: { rate: 1, baseDelayMs: 0 },
  createdAt: "2026-09-26T12:00:00.000Z", updatedAt: "2026-09-26T12:01:00.000Z",
});

test("v1: save/load/tombstone e documento wire equivalentes ao SDK anterior", async (t) => {
  const server = await startMatchFirestoreServer();
  const legacy = server.legacyClient();
  const store = new FirestoreMatchSessionPersistence(server.source);
  t.after(async () => { await store.close(); await legacy.terminate(); await server.close(); });
  const data = { ...snapshot(), numbers: [0, 1.25, Number.MAX_SAFE_INTEGER, NaN, Infinity], removed: undefined };
  const clean = { ...data }; delete clean.removed;
  const legacyRef = legacy.collection("activeMatches").doc("BOLA");
  const previous = await legacy.runTransaction(async (tx) => {
    const existing = await tx.get(legacyRef);
    assert.equal(existing.exists, false);
    const record = { ...clean, _matchOwnership: owner };
    tx.set(legacyRef, record);
    return record;
  });
  const writtenBefore = structuredClone(server.state.documents.get(legacyRef.path.replace(/^/, `${server.source.database}/documents/`)));
  const readBefore = (await legacyRef.get()).data();
  assert.deepEqual(await store.save(data, owner), previous);
  const name = `${server.source.database}/documents/activeMatches/BOLA`;
  // Both clients' protobuf writes are decoded by the same independent wire server.
  assert.deepEqual(server.state.documents.get(name), writtenBefore);
  assert.deepEqual(await store.get(" bola "), readBefore);
  assert.equal(await store.has("MISSING"), false);
  assert.equal(await store.remove("BOLA", "other", owner), false);
  assert.equal(await store.remove("BOLA", "match-1", owner), true);
  assert.equal(await store.get("BOLA"), null);
  assert.equal((await legacyRef.get()).data()._matchRemoved, true);
});

test("valores: round-trip plain data; SDK transforms/references nao sao silenciosamente convertidos", async () => {
  assert.deepEqual(decodeMatchFields(encodeMatchFields(snapshot())), snapshot());
  const server = await startMatchFirestoreServer();
  const legacy = server.legacyClient();
  const store = new FirestoreMatchSessionPersistence(server.source);
  try {
    for (const value of [new Date(), Timestamp.now(), FieldValue.serverTimestamp(), legacy.doc("a/b")]) {
      await assert.rejects(store.save({ ...snapshot(), unsupported: value }, owner), { code: "MATCH_PERSISTENCE_DATA_INVALID" });
    }
    assert.equal(server.calls.length, 0);
    assert.throws(() => encodeMatchFields({ array: [[1]] }), { code: "MATCH_PERSISTENCE_DATA_INVALID" });
  } finally { await store.close(); await legacy.terminate(); await server.close(); }
});

test("valores: somente -0 vira zero canonico sem mutar numeros pequenos ou o original", () => {
  const values = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-300, -1e-300];
  const original = { numbers: values, nested: { zero: -0 } };
  const before = structuredClone(original);
  const encoded = encodeMatchFields(original);
  const decoded = decodeMatchFields(encoded);
  assert.deepEqual(original, before);
  assert.equal(Object.is(original.numbers[1], -0), true);
  assert.equal(Object.is(original.nested.zero, -0), true);
  assert.deepEqual(encoded.numbers.arrayValue.values.slice(0, 2), [{ integerValue: "0" }, { integerValue: "0" }]);
  for (let index = 0; index < values.length; index += 1) {
    assert.equal(Object.is(decoded.numbers[index], index === 1 ? 0 : values[index]), true);
  }
  assert.equal(Object.is(decoded.nested.zero, 0), true);
  assert.equal(Object.is(decodeMatchFields({ old: { doubleValue: -0 } }).old, -0), true);
});

test("v1: tatica real gera -0, persistencia canoniza somente o wire e le legado doubleValue=-0", async (t) => {
  const plan = tacticPlanSchema.parse({
    ...structuredClone(DEFAULT_TACTIC_PLAN), mentality: "cautious",
    teamInstructions: { pressureLine: "very-low", width: "very-narrow", tempo: "normal", pressing: "intense", offensiveTransition: "build-up", defensiveTransition: "regroup" },
  });
  const roster = (side) => {
    const players = FORMATION_ROLES["4-3-3"].map((position, index) => ({
      id: `${side}-${index}`, name: `Jogador ${index}`, position, active: true,
      attributes: Object.fromEntries(REQUIRED_ATTRIBUTE_KEYS.map((key) => [key, 10])),
    }));
    return { clubId: side, source: "catalog", players, initialLineupIds: players.map((player) => player.id), knownIds: new Set(players.map((player) => player.id)), editable: true };
  };
  const homeRoster = roster("home");
  const awayRoster = roster("away");
  assert.equal(validateLineupForFormation(plan, homeRoster.initialLineupIds, homeRoster.players).valid, true);
  const attributes = (value) => calculateLineupAttributeProfile(value.players, { lineupIds: value.initialLineupIds });
  const fixture = { fixtureId: "fixture-zero", homeTeam: "Casa", awayTeam: "Fora", homeStrength: 10, awayStrength: 10, seed: "zero-regression" };
  const adjustedFixture = {
    ...applyPregameTacticsToFixture(applyLineupAttributeProfiles(fixture, attributes(homeRoster), attributes(awayRoster)),
      { tactics: plan }, { tactics: structuredClone(DEFAULT_TACTIC_PLAN) }, homeRoster, awayRoster),
    simulationVersion: 2, roomCode: "ZERO", homeRoster: homeRoster.players, awayRoster: awayRoster.players,
  };
  const match = { ...simulateMatch(adjustedFixture), fixtureId: fixture.fixtureId };
  const data = serializeActiveMatchSession({
    code: "ZERO", fixture, started: { id: match.id, fixtureId: fixture.fixtureId }, match, adjustedFixture,
    events: [], speed: { rate: 1, baseDelayMs: 0 }, homeRoster, awayRoster, halftime: {},
  });
  const before = structuredClone(data);
  const zero = (value) => value.adjustedFixture.homeTacticalProfile.fatigueSecondHalfModifier;
  assert.equal(Object.is(zero(data), -0), true);
  const server = await startMatchFirestoreServer();
  const store = new FirestoreMatchSessionPersistence(server.source);
  const legacy = server.legacyClient();
  t.after(async () => { await store.close(); await legacy.terminate(); await server.close(); });
  await store.save(data, owner);
  const name = `${server.source.database}/documents/activeMatches/ZERO`;
  const wireZero = () => server.state.documents.get(name).adjustedFixture.mapValue.fields.homeTacticalProfile.mapValue.fields.fatigueSecondHalfModifier;
  assert.deepEqual(wireZero(), { integerValue: "0", valueType: "integerValue" });
  const expected = { ...structuredClone(data), _matchOwnership: owner };
  expected.adjustedFixture.homeTacticalProfile.fatigueSecondHalfModifier = 0;
  assert.deepEqual(await store.get("ZERO"), expected);
  assert.equal(hydrateActiveMatchSession(await store.get("ZERO"), fixture).match.id, match.id);
  assert.deepEqual(data, before);
  assert.equal(Object.is(zero(data), -0), true);
  await legacy.doc("activeMatches/ZERO").set({ ...data, _matchOwnership: owner });
  assert.equal(Object.is(wireZero().doubleValue, -0), true);
  assert.equal(Object.is(zero((await legacy.doc("activeMatches/ZERO").get()).data()), -0), true);
  const loaded = await store.get("ZERO");
  assert.deepEqual(loaded, expected);
  assert.equal(hydrateActiveMatchSession(loaded, fixture).match.id, match.id);
  await store.save(loaded, owner);
  assert.deepEqual(wireZero(), { integerValue: "0", valueType: "integerValue" });
  assert.equal(Object.is(zero(data), -0), true);
});

test("v1: fencing/sequence/geracao e codigos de erro preservados", async (t) => {
  const server = await startMatchFirestoreServer();
  const store = new FirestoreMatchSessionPersistence(server.source);
  t.after(async () => { await store.close(); await server.close(); });
  const memory = new MemoryMatchSessionPersistence();
  for (const target of [memory, store]) {
    await target.save(snapshot(1), { token: "old", fence: 1 });
    await target.save(snapshot(3), owner);
    await assert.rejects(target.save(snapshot(4), { token: "old", fence: 1 }), { code: "MATCH_OWNERSHIP_LOST", status: 409 });
    await assert.rejects(target.remove("BOLA", "match-1", { token: "old", fence: 1 }), { code: "MATCH_OWNERSHIP_LOST" });
    await assert.rejects(target.save(snapshot(2), owner), { code: "MATCH_SNAPSHOT_STALE" });
    await assert.rejects(target.save(snapshot(4), { token: "conflict", fence: 2 }), { code: "MATCH_OWNERSHIP_LOST" });
  }
  assert.deepEqual(await store.get("BOLA"), await memory.get("BOLA"));
});

test("v1: duas transacoes concorrentes, ABORTED refaz leitura e impede lost update", async (t) => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  const server = await startMatchFirestoreServer({ after: async (method, call) => {
    if (method === "getDocument" && call.request.transaction?.length && ++reads <= 2) {
      if (reads === 2) release();
      await barrier;
    }
  } });
  server.state.seed("BOLA", { ...snapshot(1), _matchOwnership: { token: "old", fence: 1 } });
  const first = new FirestoreMatchSessionPersistence(server.source);
  const second = new FirestoreMatchSessionPersistence(server.source);
  t.after(async () => { await first.close(); await second.close(); await server.close(); });
  const results = await Promise.allSettled([
    first.save(snapshot(2), { token: "old", fence: 1 }), second.save(snapshot(3), owner),
  ]);
  assert.equal(results[1].status, "fulfilled");
  if (results[0].status === "rejected") assert.equal(results[0].reason.code, "MATCH_OWNERSHIP_LOST");
  assert.equal((await second.get("BOLA"))._matchSequence, 3);
  assert.ok(server.calls.filter((c) => c.method === "beginTransaction").length >= 3);
  const commits = server.calls.filter((c) => c.method === "commit");
  assert.ok(commits.every((c) => c.request.transaction?.length));
});

test("v1: falha antes do commit faz rollback e nao modifica documento", async (t) => {
  const server = await startMatchFirestoreServer();
  server.state.seed("BOLA", { ...snapshot(3), _matchOwnership: owner });
  const before = structuredClone([...server.state.documents]);
  const store = new FirestoreMatchSessionPersistence(server.source);
  t.after(async () => { await store.close(); await server.close(); });
  await assert.rejects(store.save(snapshot(1), owner), { code: "MATCH_SNAPSHOT_STALE" });
  assert.deepEqual([...server.state.documents], before);
  assert.equal(server.calls.filter((c) => c.method === "commit").length, 0);
  assert.equal(server.calls.filter((c) => c.method === "rollback").length, 1);
  assert.equal(server.state.transactions.size, 0);
});

test("v1: deadline global inclui begin/read; liberar leitura apos timeout nao inicia commit", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let blocked;
  const arrived = new Promise((resolve) => { blocked = resolve; });
  const server = await startMatchFirestoreServer({ before: async (method) => {
    if (method === "beginTransaction") await delay(60);
    if (method === "getDocument") { blocked(); await gate; }
  } });
  const store = new FirestoreMatchSessionPersistence(server.source, { operationTimeoutMs: 400 });
  t.after(async () => { release(); await store.close(); await server.close(); });
  const started = performance.now();
  const operation = assert.rejects(store.save(snapshot(), owner), (error) => {
    assert.equal(error.code, "MATCH_PERSISTENCE_TIMEOUT");
    assert.equal(error.cause.code, "DEPENDENCY_TIMEOUT");
    assert.equal(error.commitOutcome, undefined);
    return true;
  });
  await arrived;
  await operation;
  assert.ok(performance.now() - started < 1500);
  const callsAtTimeout = server.calls.length;
  release();
  await delay(150); // Controlled post-timeout observation, not a product timeout.
  assert.equal(server.calls.length, callsAtTimeout);
  assert.equal(server.calls.filter((c) => c.method === "commit").length, 0);
  assert.equal(server.state.documents.size, 0);
  const [begin, read] = server.source.calls;
  assert.ok(read.timeout < begin.timeout - 40);
  assert.ok(Math.abs((begin.at + begin.timeout) - (read.at + read.timeout)) < 35);
});

test("v1: commit aceito com resposta perdida e indeterminado, sem retry/rollback cego", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const server = await startMatchFirestoreServer({ after: async (method) => { if (method === "commit") await gate; } });
  const store = new FirestoreMatchSessionPersistence(server.source, { operationTimeoutMs: 400 });
  t.after(async () => { release(); await store.close(); await server.close(); });
  await assert.rejects(store.save(snapshot(), owner), (error) => {
    assert.equal(error.code, "MATCH_PERSISTENCE_TIMEOUT");
    assert.equal(error.cause.code, "DEPENDENCY_TIMEOUT");
    assert.equal(error.commitOutcome, "unknown");
    return true;
  });
  assert.equal(server.state.documents.size, 1, "The server committed before timeout; cancellation is not rollback");
  const count = server.calls.length;
  release();
  await delay(150);
  assert.equal(server.calls.length, count);
  assert.equal(server.calls.filter((c) => c.method === "commit").length, 1);
  assert.equal(server.calls.filter((c) => c.method === "rollback").length, 0);
});

test("v1: auth lenta liberada apos deadline nao inicia request tardio", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let waiting;
  const arrived = new Promise((resolve) => { waiting = resolve; });
  const server = await startMatchFirestoreServer({ beforeHeaders: async () => { waiting(); await gate; } });
  const client = server.source.createClient();
  await client.initialize();
  server.source.createClient = () => client;
  const store = new FirestoreMatchSessionPersistence(server.source, { operationTimeoutMs: 300 });
  t.after(async () => { release(); await store.close(); await server.close(); });
  const operation = assert.rejects(store.save(snapshot(), owner), { code: "MATCH_PERSISTENCE_TIMEOUT" });
  await arrived;
  await operation;
  await store.close();
  release();
  await delay(150);
  assert.equal(server.source.calls.length, 1);
  assert.equal(server.calls.length, 0);
  assert.equal(server.connections.size, 0);
  assert.equal(server.state.documents.size, 0);
});

test("cleanup falho nao substitui MATCH_PERSISTENCE_TIMEOUT / DEPENDENCY_TIMEOUT", async () => {
  const source = createFakeMatchFirestoreV1({ intercept: () => new Promise(() => {}), closeError: Error("close fixture failure") });
  const store = new FirestoreMatchSessionPersistence(source, { operationTimeoutMs: 20 });
  await assert.rejects(store.get("BOLA"), (error) => {
    assert.equal(error.code, "MATCH_PERSISTENCE_TIMEOUT");
    assert.equal(error.cause.code, "DEPENDENCY_TIMEOUT");
    return true;
  });
  assert.equal(source.closed, 1);
  await store.close();
});

test("shutdown cancela operacao ativa e rejeita novos RPCs", async () => {
  const source = createFakeMatchFirestoreV1({ intercept: () => new Promise(() => {}) });
  const store = new FirestoreMatchSessionPersistence(source);
  const pending = assert.rejects(store.get("BOLA"), { code: "MATCH_PERSISTENCE_CLOSED" });
  await store.close();
  await pending;
  await assert.rejects(store.get("BOLA"), { code: "MATCH_PERSISTENCE_CLOSED" });
  assert.equal(source.calls.length, 1);
  assert.equal(source.closed, 1);
});

test("v1: shutdown saudavel nao deixa conexoes HTTP idle", async (t) => {
  const server = await startMatchFirestoreServer();
  t.after(() => server.close());
  const store = new FirestoreMatchSessionPersistence(server.source);
  await store.save(snapshot(), owner);
  assert.deepEqual(await store.get("BOLA"), { ...snapshot(), _matchOwnership: owner });
  const closed = [...server.connections].map((socket) => new Promise((resolve) => socket.once("close", resolve)));
  await store.close();
  await Promise.all(closed);
  assert.equal(server.connections.size, 0);
  assert.ok(server.requestHeaders.length >= 4);
  assert.ok(server.requestHeaders.every(({ connection }) => connection === "close"));
});

test("retry transacional limitado a cinco ABORTED, sem retry GAX", async () => {
  const source = createFakeMatchFirestoreV1({ intercept(method) {
    if (method === "commit") throw Object.assign(Error("fixture aborted"), { code: 10 });
  } });
  const store = new FirestoreMatchSessionPersistence(source);
  await assert.rejects(store.save(snapshot(), owner), { code: 10 });
  assert.equal(source.calls.filter(({ method }) => method === "commit").length, 5);
  assert.equal(source.calls.filter(({ method }) => method === "rollback").length, 5);
  assert.ok(source.calls.every(({ options }) => options.retry === null));
  assert.equal(source.transactions.size, 0);
  assert.equal(source.documents.size, 0);
  await store.close();
});

test("retry e backoff nao reiniciam budget global", async () => {
  const source = createFakeMatchFirestoreV1({ intercept(method) {
    if (method === "commit") throw Object.assign(Error("fixture aborted"), { code: 10 });
  } });
  const store = new FirestoreMatchSessionPersistence(source, { operationTimeoutMs: 90 });
  const started = performance.now();
  await assert.rejects(store.save(snapshot(), owner), { code: "MATCH_PERSISTENCE_TIMEOUT" });
  assert.ok(performance.now() - started < 1000);
  assert.ok(source.calls.filter(({ method }) => method === "commit").length < 5);
  const count = source.calls.length;
  await delay(100);
  assert.equal(source.calls.length, count);
  assert.ok(source.calls.every(({ at }) => at < started + 90));
  assert.equal(source.documents.size, 0);
  await store.close();
});

test("v1: PERMISSION_DENIED nao vira ausencia, sucesso ou fallback", async (t) => {
  const server = await startMatchFirestoreServer({ before() {
    throw Object.assign(Error("fixture denied"), { code: 7 });
  } });
  const store = new FirestoreMatchSessionPersistence(server.source);
  t.after(async () => { await store.close(); await server.close(); });
  for (const operation of [() => store.get("BOLA"), () => store.has("BOLA"), () => store.save(snapshot(), owner), () => store.remove("BOLA", "match-1", owner)]) {
    await assert.rejects(operation(), { code: 7 });
  }
  assert.equal(server.calls.length, 4);
  assert.equal(server.state.documents.size, 0);
});

const exec = promisify(execFile);
for (const mode of ["silent", "body", "refused"]) {
  test(`v1 SDK real: ${mode}, cleanup/socket/subprocesso naturais`, async () => {
    const fixture = new URL("./fixtures/matchFirestoreLifecycle.mjs", import.meta.url).href;
    const script = `import{runMatchFirestoreLifecycle}from ${JSON.stringify(fixture)};console.log(JSON.stringify(await runMatchFirestoreLifecycle(${JSON.stringify(mode)})));`;
    const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    const { stdout, stderr } = await exec(process.execPath, ["--input-type=module", "--eval", script], {
      env: { ...env, BOLA_ENV_FILES: "false", NODE_ENV: "test" }, windowsHide: true, timeout: 20_000,
    });
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.equal(result.socketsAfterClose, 0);
    assert.equal(result.rpcAfterDeadline, 0);
    assert.equal(result.rpcCount, 1);
    if (mode !== "refused") {
      assert.equal(result.errorCode, "MATCH_PERSISTENCE_TIMEOUT");
      assert.equal(result.causeCode, "DEPENDENCY_TIMEOUT");
      assert.equal(result.peakSockets, 1);
      assert.equal(result.socketsBeforeClose, 1);
      // Product remains 15s. 2s margin allows scheduling/CI and client shutdown;
      // parent watchdog includes Node startup. No retry or longer product timeout.
      assert.ok(result.elapsedMs >= 14_900 && result.elapsedMs < 17_000, JSON.stringify(result));
      assert.ok(result.cleanupMs < 1_000, JSON.stringify(result));
    } else {
      assert.equal(result.errorCode, "ECONNREFUSED");
      assert.ok(result.elapsedMs < 3_000, JSON.stringify(result));
    }
  });
}
