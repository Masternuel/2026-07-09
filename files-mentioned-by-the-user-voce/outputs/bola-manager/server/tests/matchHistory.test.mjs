import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { FirestoreRoomPersistence, MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { assertMatchHistoryCapacity, enqueueMatchHistory, flushMatchHistory, historyPage, historyPageOptions, historyRecord, initializeMatchHistory } from "../store/matchHistory.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { roomForViewer } from "../services/roomVisibility.mjs";
import { resolveServerFixture } from "../game/fixtures.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";
import express from "express";
import { createMatchRouter } from "../routes/match.mjs";

const NOW = "2026-07-09T20:00:00.000Z";
function roomBase(overrides = {}) {
  return { id: "history-room", code: "BOLA-HIST", ownerId: "owner", name: "Historico", status: "active",
    managerIds: ["owner"], managers: [{ id: "owner", name: "Owner", clubId: "AUR" }],
    currentSeason: 1, seasonYear: 2026, revision: 1, version: 1, createdAt: NOW, updatedAt: NOW,
    completedMatches: [], completedFixtureIds: [], competitionCatalog: [], ...overrides };
}
function match(index = 1, overrides = {}) {
  return { id: `match-${index}`, fixtureId: `fixture-${index}`, homeClubId: "A", awayClubId: "B",
    homeTeam: "Clube A", awayTeam: "Clube B", completedAt: NOW, score: [1, 0],
    events: [{ minute: 32, type: "goal", playerId: "p1", text: "Gol real" }],
    statistics: { home: { shots: 5 }, away: { shots: 3 } },
    playerStatistics: { home: [{ playerId: "p1", goals: 1 }], away: [] },
    playerEffects: [{ playerId: "p2", yellowCards: 1 }], ...overrides };
}
const silent = { warn() {}, info() {}, error() {} };

for (const kind of ["memory", "firestore"]) {
  test(`${kind}: detalhes sobrevivem a recarga, compaction e mudanca de temporada`, async () => {
    const firestore = createFakeFirestore();
    const persistence = kind === "memory" ? new MemoryRoomPersistence() : new FirestoreRoomPersistence(firestore);
    const room = roomBase();
    initializeMatchHistory(room);
    enqueueMatchHistory(room, match());
    await persistence.create(room);
    await flushMatchHistory(persistence, room);
    const stored = await persistence.get(room.code);
    assert.deepEqual(stored.matchHistoryPending, []);
    stored.currentSeason = 2;
    stored.completedMatches = [];
    stored.lastCompletedMatch = match(2);
    stored.revision += 1;
    stored.version = stored.revision;
    await persistence.save(stored);
    const reloaded = kind === "memory" ? persistence : new FirestoreRoomPersistence(firestore);
    const detail = await reloaded.matchHistory.get(stored, historyRecord(room, match()).id);
    assert.deepEqual(detail.events, match().events);
    assert.deepEqual(detail.playerStatistics, match().playerStatistics);
    assert.deepEqual(detail.playerEffects, match().playerEffects);
    assert.equal(detail.seasonNumber, 1);
    await persistence.remove(room.code, () => {});
    await assert.rejects(persistence.matchHistory.put(room, detail), { code: "ROOM_NOT_FOUND" });
    assert.equal(await persistence.matchHistory.get(room, detail.id), null);
    if (kind === "firestore") assert.equal(firestore.paths().some((path) => path.includes("/matchHistory/")), false);
  });
}

test("pagina limitada, cursor estavel, sem duplicatas e restrito a sala", async () => {
  const room = roomBase();
  const persistence = new MemoryRoomPersistence([room]);
  for (let index = 0; index < 9; index += 1) await persistence.matchHistory.put(room, historyRecord(room, match(index)));
  let options = historyPageOptions(room.id, { limit: 3 });
  const seen = [];
  let page;
  do {
    page = historyPage(room.id, await persistence.matchHistory.list(room, options), [], options);
    seen.push(...page.items.map((entry) => entry.id));
    assert.ok(page.items.length <= 3);
    options = historyPageOptions(room.id, { limit: 3, cursor: page.nextCursor });
  } while (page.nextCursor);
  assert.equal(seen.length, 9);
  assert.equal(new Set(seen).size, 9);
  const first = historyPage(room.id, await persistence.matchHistory.list(room, { limit: 3 }), [], { limit: 3 });
  assert.throws(() => historyPageOptions("other-room", { cursor: first.nextCursor }), { code: "MATCH_HISTORY_CURSOR_INVALID" });
  for (const limit of [0, 51, -1, "x", "1.5", [1, 2]]) assert.throws(() => historyPageOptions(room.id, { limit }), { code: "MATCH_HISTORY_QUERY_INVALID" });
  assert.throws(() => historyPageOptions(room.id, { cursor: "garbage" }), { code: "MATCH_HISTORY_CURSOR_INVALID" });
});

test("Firestore: falha e ACK perdido mantem outbox; retry nao duplica", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = roomBase();
  enqueueMatchHistory(room, match());
  await persistence.create(room);
  firestore.failBeforeCommit();
  await assert.rejects(flushMatchHistory(persistence, room));
  assert.equal((await persistence.get(room.code)).matchHistoryPending.length, 1);
  assert.equal((await persistence.matchHistory.list(room, { limit: 20 })).length, 0);
  firestore.failAfterCommit(new Error("ACK perdido"), "transaction");
  await assert.rejects(flushMatchHistory(persistence, room), /ACK perdido/);
  assert.equal((await persistence.get(room.code)).matchHistoryPending.length, 1);
  const restarted = new FirestoreRoomPersistence(firestore);
  await Promise.all([flushMatchHistory(restarted, room), flushMatchHistory(persistence, room)]);
  assert.equal((await restarted.get(room.code)).matchHistoryPending.length, 0);
  assert.equal((await restarted.matchHistory.list(room, { limit: 20 })).length, 1);
});

test("falha ao limpar outbox nao perde dados; reconciliacao preserva novas entradas", async () => {
  const room = roomBase();
  enqueueMatchHistory(room, match());
  const persistence = new MemoryRoomPersistence([room]);
  const mutate = persistence.mutatePaths.bind(persistence);
  persistence.mutatePaths = async () => { throw new Error("Falha ao limpar"); };
  await assert.rejects(flushMatchHistory(persistence, room), /Falha ao limpar/);
  assert.equal((await persistence.get(room.code)).matchHistoryPending.length, 1);
  assert.equal((await persistence.matchHistory.list(room, { limit: 20 })).length, 1);
  persistence.mutatePaths = mutate;
  await persistence.mutate(room.code, (current) => { enqueueMatchHistory(current, match(2)); return current; });
  await flushMatchHistory(persistence, room);
  assert.equal((await persistence.get(room.code)).matchHistoryPending[0].fixtureId, "fixture-2");
});

test("Firestore: pagina grande fragmentada e corrupcao nao viram historico vazio", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = roomBase();
  await persistence.create(room);
  const record = historyRecord(room, match(1, { events: [{ text: randomBytes(600_000).toString("base64") }] }));
  await persistence.matchHistory.put(room, record);
  assert.deepEqual(await persistence.matchHistory.get(room, record.id), record);
  const pages = firestore.paths().filter((path) => path.includes(`/matchHistory/${record.id}/pages/`) && !path.endsWith("/manifest"));
  assert.ok(pages.length >= 2);
  await firestore.doc(pages[0]).delete();
  await assert.rejects(persistence.matchHistory.get(room, record.id), { code: "MATCH_HISTORY_CORRUPT" });
});

test("arquivo completo e imutavel; resumo legado nao sobrescreve eventos", async () => {
  const room = roomBase();
  const persistence = new MemoryRoomPersistence([room]);
  const record = historyRecord(room, match());
  await persistence.matchHistory.put(room, record);
  await persistence.matchHistory.put(room, { ...record, detailsAvailable: false, events: undefined });
  assert.deepEqual((await persistence.matchHistory.get(room, record.id)).events, record.events);
  await assert.rejects(persistence.matchHistory.put(room, { ...record, score: [8, 0] }), { code: "MATCH_HISTORY_CONFLICT" });
});

test("saves legados preservam ultimo jogo e identificam eventos ja descartados", async () => {
  const room = roomBase({ completedMatches: [match(1, { events: undefined }), match(2, { events: undefined })], lastCompletedMatch: match(2) });
  const persistence = new MemoryRoomPersistence([room]);
  const store = new RoomStore({ persistence, logger: silent });
  await assert.rejects(store.getMatchHistory(room.code, "intruso"), { code: "ROOM_NOT_FOUND" });
  assert.equal((await persistence.get(room.code)).matchHistoryVersion, undefined);
  const page = await store.getMatchHistory(room.code, "owner");
  assert.equal(page.items.length, 2);
  assert.equal(page.items.filter((entry) => entry.detailsAvailable).length, 1);
  assert.equal(page.pendingArchiveCount, 0);
  const detail = await store.getMatchHistoryDetail(room.code, "owner", page.items.find((entry) => entry.detailsAvailable).id);
  assert.deepEqual(detail.events, match(2).events);
  assert.equal(detail.strengthProfile, undefined);
  await assert.rejects(store.getMatchHistoryDetail(room.code, "intruso", detail.id), { code: "ROOM_NOT_FOUND" });
  await assert.rejects(store.getMatchHistoryDetail(room.code, "owner", "../other"), { code: "MATCH_HISTORY_ID_INVALID" });
  await assert.rejects(store.getMatchHistoryDetail(room.code, "owner", "a".repeat(64)), { code: "MATCH_HISTORY_NOT_FOUND" });
});

test("arquivo indisponivel permite consultar detalhes pendentes e alerta sem perder fonte", async () => {
  const room = roomBase();
  initializeMatchHistory(room);
  enqueueMatchHistory(room, match());
  const persistence = new MemoryRoomPersistence([room]);
  persistence.matchHistory.put = async () => { throw new Error("offline"); };
  const store = new RoomStore({ persistence, logger: silent });
  const page = await store.getMatchHistory(room.code, "owner");
  assert.equal(page.items.length, 1);
  assert.equal(page.archiveError.code, "MATCH_HISTORY_WRITE_FAILED");
  const detail = await store.getMatchHistoryDetail(room.code, "owner", page.items[0].id);
  assert.deepEqual(detail.events, match().events);
  assert.equal((await persistence.get(room.code)).matchHistoryPending.length, 1);
  const visible = roomForViewer(await persistence.get(room.code), "owner");
  assert.equal(visible.matchHistoryPending, undefined);
});

test("partidas de temporadas diferentes nao colidem e fila tem protecao de tamanho", () => {
  const room = roomBase();
  enqueueMatchHistory(room, match());
  room.currentSeason = 2;
  enqueueMatchHistory(room, match());
  assert.equal(room.matchHistoryPending.length, 2);
  for (let index = 2; index < 512; index += 1) enqueueMatchHistory(room, match(index));
  assert.throws(() => assertMatchHistoryCapacity(room), { code: "MATCH_HISTORY_BACKLOG" });
  assert.equal(room.matchHistoryPending.length, 512);
  // A large, valid calendar batch is not rolled back mid-simulation.
  enqueueMatchHistory(room, match(513));
  assert.equal(room.matchHistoryPending.length, 513);
});

test("RoomStore arquiva resultado humano e jogos IA sem crescer broadcast", async () => {
  const persistence = new MemoryRoomPersistence();
  const clubs = ["AUR", "B", "C", "D"].map((id) => ({ id, code: id, name: `Clube ${id}`, reputation: 12, budget: 10_000_000, leagueId: "TEST-HISTORY" }));
  const positions = ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MEI", "PD", "ATA", "PE"];
  const catalogStore = {
    async listCompetitionCatalog() { return [{ id: "TEST-HISTORY", name: "Liga", active: true, legs: "double", clubs }]; },
    async listPlayers(clubId) { return { players: positions.map((position, index) => ({ id: `${clubId}-${index}`, clubId, name: `${clubId} ${index}`, position, overall: 12, age: 25, active: true })), count: 11 }; },
  };
  const store = new RoomStore({ persistence, catalogStore, logger: silent, codeFactory: () => "BOLA-HIST", now: () => new Date(NOW) });
  const created = await store.createRoom({ name: "Historico", creatorId: "owner", creatorName: "Owner", clubId: "AUR", activeLeagues: ["TEST-HISTORY"], seasonLength: 2, maxManagers: 1 });
  await store.setReady(created.code, "owner", true);
  let room = await store.startRoom(created.code, "owner");
  const fixture = resolveServerFixture(room);
  const result = match(1, { fixtureId: fixture.fixtureId, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, playerStatistics: { home: [], away: [] }, playerEffects: [] });
  const originalMutate = persistence.mutate.bind(persistence);
  const beforeFailure = await persistence.get(room.code);
  const beforeArchive = await persistence.matchHistory.list(room, { limit: 50 });
  persistence.mutate = async (code, mutation) => { mutation(await persistence.get(code)); throw new Error("Commit falhou"); };
  await assert.rejects(store.completeMatch(room.code, fixture.fixtureId, result), /Commit falhou/);
  assert.deepEqual(await persistence.get(room.code), beforeFailure);
  assert.deepEqual(await persistence.matchHistory.list(room, { limit: 50 }), beforeArchive);
  persistence.mutate = originalMutate;
  const completion = await store.completeMatch(room.code, fixture.fixtureId, result);
  room = completion.room;
  const summary = room.completedMatches.find((entry) => entry.id === result.id);
  assert.equal(summary.events, undefined);
  const page = await store.getMatchHistory(room.code, "owner", { limit: 50 });
  const human = page.items.find((entry) => entry.fixtureId === fixture.fixtureId);
  assert.ok(human?.detailsAvailable);
  assert.ok(page.items.some((entry) => entry.source === "ai" && entry.detailsAvailable));
  assert.deepEqual((await store.getMatchHistoryDetail(room.code, "owner", human.id)).events, result.events);
  assert.equal(roomForViewer(room, "owner").matchHistoryPending, undefined);
});

test("consulta HTTP autoriza sala, pagina resultados e fornece detalhes sem estado privado", async (t) => {
  const room = roomBase({ lastCompletedMatch: { ...match(), tacticalMatchup: { secret: true }, matchdayEconomies: [{ privateBudget: 100 }] } });
  const store = new RoomStore({ persistence: new MemoryRoomPersistence([room]), logger: silent });
  const app = express();
  app.use((request, response, next) => {
    if (!request.headers["x-test-user"]) return response.sendStatus(401);
    request.user = { uid: request.headers["x-test-user"] };
    next();
  });
  app.use("/api/matches", createMatchRouter(store));
  app.use((error, _request, response, _next) => response.status(error.status ?? 500).json({ code: error.code }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/matches/${room.code}/history`;
  assert.equal((await fetch(url)).status, 401);
  const get = (suffix = "", user = "owner") => fetch(`${url}${suffix}`, { headers: { "x-test-user": user } });
  assert.equal((await get("", "intruso")).status, 404);
  assert.equal((await get("?limit=51")).status, 400);
  const page = await (await get("?limit=1")).json();
  assert.equal(page.items.length, 1);
  const detail = await (await get(`/${page.items[0].id}`)).json();
  assert.deepEqual(detail.match.events, match().events);
  assert.equal(detail.match.tacticalMatchup, undefined);
  assert.equal(detail.match.matchdayEconomies, undefined);
});

test("Firestore: listas leem somente cabecalhos limitados, nunca eventos ou catalogo", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = roomBase();
  await persistence.create(room);
  const records = Array.from({ length: 8 }, (_, index) => historyRecord(room, match(index)));
  firestore.resetMetrics();
  await persistence.matchHistory.putBatch(room, records);
  assert.equal(firestore.metrics.transactionAttempts, 1);
  firestore.resetMetrics();
  const page = await persistence.matchHistory.list(room, { limit: 2 });
  assert.equal(page.length, 3);
  assert.ok(firestore.metrics.readPaths.every((path) => !path.includes("/pages/") && !path.includes("/catalog/")));
});

test("exclusao concorrente impede recriar arquivo em sala apagada", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = roomBase();
  await persistence.create(room);
  const original = firestore.runTransaction;
  let release;
  let signal;
  const gate = new Promise((resolve) => { release = resolve; });
  const reached = new Promise((resolve) => { signal = resolve; });
  let first = true;
  firestore.runTransaction = (callback, options) => original(async (transaction) => {
    const result = await callback(transaction);
    if (first) { first = false; signal(); await gate; }
    return result;
  }, options);
  const writing = persistence.matchHistory.put(room, historyRecord(room, match()));
  await reached;
  try {
    await persistence.remove(room.code, () => {});
  } finally { release(); }
  await assert.rejects(writing, { code: "ROOM_NOT_FOUND" });
  assert.equal(firestore.paths().some((path) => path.includes("/matchHistory/")), false);
});

test("partidas IA em copas diferentes nao compartilham identificador historico", () => {
  const room = roomBase();
  const fixture = { competitionFixtureId: "round-1-match-1", homeClubId: "A", awayClubId: "B", homeTeam: "A", awayTeam: "B" };
  enqueueMatchHistory(room, match(), { ...fixture, competitionId: "copa-1" });
  enqueueMatchHistory(room, match(), { ...fixture, competitionId: "copa-2" });
  assert.equal(room.matchHistoryPending.length, 2);
  assert.notEqual(room.matchHistoryPending[0].id, room.matchHistoryPending[1].id);
});

test("fila maior que um lote drena em segundo plano, inclusive apos reinicio", async () => {
  const room = roomBase();
  initializeMatchHistory(room);
  for (let index = 0; index < 80; index += 1) enqueueMatchHistory(room, match(index));
  const persistence = new MemoryRoomPersistence([room]);
  const store = new RoomStore({ persistence, logger: silent });
  const first = await store.getMatchHistory(room.code, "owner", { limit: 10 });
  assert.equal(first.items.length, 10);
  assert.ok(first.nextCursor);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    if (!(await persistence.get(room.code)).matchHistoryPending.length) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal((await persistence.get(room.code)).matchHistoryPending.length, 0);
  const restarted = new RoomStore({ persistence, logger: silent });
  const seen = new Set(first.items.map((entry) => entry.id));
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await restarted.getMatchHistory(room.code, "owner", { limit: 10, cursor });
    for (const entry of page.items) { assert.equal(seen.has(entry.id), false); seen.add(entry.id); }
    cursor = page.nextCursor;
  }
  assert.equal(seen.size, 80);
});

test("historico de versao futura nao sofre downgrade silencioso", () => {
  assert.throws(() => initializeMatchHistory(roomBase({ matchHistoryVersion: 2 })), { code: "MATCH_HISTORY_VERSION_UNSUPPORTED" });
});
