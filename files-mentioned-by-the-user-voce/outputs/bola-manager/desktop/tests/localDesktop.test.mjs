import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import { request as httpRequest } from "node:http";
import { openLocalDatabase } from "../localDatabase.mjs";
import { createFileStores } from "../fileStores.mjs";
import { startLocalBackend } from "../localBackend.mjs";
import { createStarterCatalog } from "../localCatalog.mjs";
import { createAiTacticPlan, DEFAULT_TACTIC_PLAN, FORMATION_ROLES } from "../../server/game/tactics.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../.tmp/desktop-tests");
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const initial = () => ({ profile: { uid: "local-test", displayName: "Manager" }, catalog: createStarterCatalog(), rooms: { rooms: [], deletedCodes: [], creationReceipts: [], history: [] }, matches: [], news: { posts: [], operations: [] } });

test("desktop: entrosamento e familiaridade sobrevivem salvar, alternar e reiniciar", async (t) => {
  const directory = await fixture(t);
  let backend = await startLocalBackend({ directory, logger: silent });
  let client;
  try {
    const session = await backend.session();
    const room = await backend.server.store.createRoom({ creatorId: session.identity.uid, creatorName: session.identity.displayName, name: "Entrosamento local", clubId: "AUR", activeLeagues: ["BR-A"], maxManagers: 1, seasonLength: 1 });
    const players = await backend.database.read((state) => state.catalog.players.filter((player) => player.clubId === "AUR"));
    const used = new Set();
    const lineupIds = FORMATION_ROLES["4-3-3"].map((position) => {
      const player = players.find((candidate) => candidate.position === position && !used.has(candidate.id));
      assert.ok(player, `Starter needed: ${position}`);
      used.add(player.id);
      return player.id;
    });
    const tactics = structuredClone(DEFAULT_TACTIC_PLAN);
    const openSocket = async (current) => {
      client = io(current.origin, { transports: ["websocket"], reconnection: false, auth: { token: (await current.session()).token }, extraHeaders: { Origin: current.origin } });
      await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
    };
    const save = async (plan) => {
      const result = await client.timeout(5000).emitWithAck("lineup:save", { code: room.code, lineupIds, tactics: plan });
      assert.equal(result.ok, true, result.error?.code);
      return result.lineup.cohesion;
    };
    await openSocket(backend);
    const initialState = await save(tactics);
    for (const mentality of ["cautious", "positive", "balanced", "positive"]) {
      const changed = await save({ ...tactics, mentality });
      assert.equal(changed.score, initialState.score);
      assert.equal(changed.acquiredScore, initialState.acquiredScore);
    }
    const alternative = { ...tactics, formationId: "4-4-2" };
    const unfamiliar = await save(alternative);
    assert.ok(unfamiliar.score < initialState.score);
    client.close(); client = null;
    await backend.close();
    backend = await startLocalBackend({ directory, logger: silent });
    const restored = (await backend.server.store.getRoom(room.code)).lineups[0].cohesion;
    assert.deepEqual(restored.familiarity, unfamiliar.familiarity);
    assert.equal(restored.acquiredScore, initialState.acquiredScore);
    assert.equal(restored.score, unfamiliar.score);
    await openSocket(backend);
    assert.equal((await save(alternative)).score, unfamiliar.score);
    const reverted = await save(tactics);
    assert.equal(reverted.score, initialState.score);
    assert.deepEqual(reverted.familiarity, initialState.familiarity);
  } finally { client?.close(); await backend.close(); }
});
async function fixture(t) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  t.after(async () => {
    const inside = relative(root, resolve(directory));
    assert.ok(inside && !inside.startsWith("..") && !inside.includes(":"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("file: atomic commit, concurrent mutations and numeric parity survive reload", async (t) => {
  const directory = await fixture(t);
  let database = await openLocalDatabase(directory, initial());
  await database.transaction((state) => { state.counter = 0; state.values = [-0, Number.MIN_VALUE, -Number.MIN_VALUE, new Date("2026-01-01")]; });
  await Promise.all(Array.from({ length: 8 }, () => database.transaction((state) => { state.counter += 1; })));
  await database.close();
  database = await openLocalDatabase(directory, initial());
  try {
    const saved = await database.read((state) => state);
    assert.equal(saved.counter, 8);
    assert.ok(Object.is(saved.values[0], -0));
    assert.equal(saved.values[1], Number.MIN_VALUE);
    assert.equal(saved.values[2], -Number.MIN_VALUE);
    assert.ok(saved.values[3] instanceof Date);
  } finally { await database.close(); }
});

test("file: failed disk write cannot change committed memory or the existing save", async (t) => {
  const directory = await fixture(t);
  let database = await openLocalDatabase(directory, initial());
  await database.close();
  const before = await readFile(join(directory, "career.bolasave"));
  database = await openLocalDatabase(directory, initial(), { atomicWrite: async () => { throw Object.assign(new Error("Disk full"), { code: "ENOSPC" }); } });
  try {
    await assert.rejects(database.transaction((state) => { state.profile.displayName = "Uncommitted"; }), { code: "ENOSPC" });
    assert.equal(await database.read((state) => state.profile.displayName), "Manager");
    assert.deepEqual(await readFile(database.path), before);
  } finally { await database.close(); }
});

test("file: concurrent shutdown callers wait for the same pending commit and lock release", async (t) => {
  const directory = await fixture(t);
  const database = await openLocalDatabase(directory, initial());
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  const saving = database.transaction(async (state) => { await gate; state.profile.displayName = "Saved before shutdown"; });
  const first = database.close();
  const second = database.close();
  assert.equal(first, second);
  await assert.rejects(database.read((state) => state), { code: "LOCAL_SAVE_CLOSED" });
  unblock();
  await Promise.all([saving, first, second]);
  const reopened = await openLocalDatabase(directory, initial());
  try { assert.equal(await reopened.read((state) => state.profile.displayName), "Saved before shutdown"); }
  finally { await reopened.close(); }
});

test("file: corrupt saves fail closed without overwriting them", async (t) => {
  const directory = await fixture(t);
  const database = await openLocalDatabase(directory, initial());
  await database.close();
  const bytes = await readFile(database.path);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(database.path, bytes);
  await assert.rejects(openLocalDatabase(directory, initial()), { code: "LOCAL_SAVE_CORRUPT" });
  assert.deepEqual(await readFile(database.path), bytes);
});

test("file: only one process/session can open the save", async (t) => {
  const directory = await fixture(t);
  const database = await openLocalDatabase(directory, initial());
  try { await assert.rejects(openLocalDatabase(directory, initial()), { code: "LOCAL_SAVE_LOCKED" }); }
  finally { await database.close(); }
  const reopened = await openLocalDatabase(directory, initial());
  await reopened.close();
});

test("file: room deletion tombstones and match history persist", async (t) => {
  const directory = await fixture(t);
  let database = await openLocalDatabase(directory, initial());
  let { persistence } = createFileStores(database);
  const room = { id: "room-local", code: "BOLA-AAAA", managerIds: ["local-test"] };
  await persistence.create(room);
  await persistence.matchHistory.put(room, { id: "match-local", orderKey: "1", detailsAvailable: true, score: [1, 0] });
  await database.close();
  database = await openLocalDatabase(directory, initial());
  persistence = createFileStores(database).persistence;
  try {
    assert.deepEqual((await persistence.matchHistory.get(room, "match-local")).score, [1, 0]);
    await persistence.remove(room.code, () => {});
    assert.equal(await persistence.create(room), false);
    assert.equal(await persistence.matchHistory.get(room, "match-local"), null);
  } finally { await database.close(); }
  database = await openLocalDatabase(directory, initial());
  try { assert.equal(await createFileStores(database).persistence.create(room), false); }
  finally { await database.close(); }
});

test("file: match sequence/fencing and removal tombstones survive reload", async (t) => {
  const directory = await fixture(t);
  let database = await openLocalDatabase(directory, initial());
  const first = { token: "owner-a", fence: 1 };
  const second = { token: "owner-b", fence: 2 };
  const session = { code: "BOLA-AAAA", matchId: "match-local", _matchGeneration: "generation-local", _matchSequence: 1 };
  await createFileStores(database).matchSessionStore.save(session, first);
  await createFileStores(database).matchSessionStore.save({ ...session, _matchSequence: 2 }, second);
  await database.close();
  database = await openLocalDatabase(directory, initial());
  const { matchSessionStore } = createFileStores(database);
  try {
    await assert.rejects(matchSessionStore.save(session, first), { code: "MATCH_OWNERSHIP_LOST" });
    assert.equal((await matchSessionStore.get(session.code))._matchSequence, 2);
    await matchSessionStore.remove(session.code, session.matchId, second);
  } finally { await database.close(); }
  database = await openLocalDatabase(directory, initial());
  try {
    const store = createFileStores(database).matchSessionStore;
    assert.equal(await store.get(session.code), null);
    await assert.rejects(store.save(session, first), { code: "MATCH_OWNERSHIP_LOST" });
  } finally { await database.close(); }
});

test("file: news and preferences are durable", async (t) => {
  const directory = await fixture(t);
  let database = await openLocalDatabase(directory, initial());
  const post = await createFileStores(database).newsStore.create({ roomCode: "BOLA-AAAA", authorId: "local-test", authorName: "Manager", clubId: "AUR", body: "Vamos time" });
  await database.transaction((state) => { state.profile.preferences = { theme: "light" }; });
  await database.close();
  database = await openLocalDatabase(directory, initial());
  try {
    assert.equal((await createFileStores(database).newsStore.get("BOLA-AAAA", post.id)).body, "Vamos time");
    assert.equal(await database.read((state) => state.profile.preferences.theme), "light");
  } finally { await database.close(); }
});

test("desktop: loopback only, authenticated HTTP/Socket.IO, blocked origins, career reload", async (t) => {
  const directory = await fixture(t);
  let backend = await startLocalBackend({ directory, logger: silent });
  let client;
  try {
    const session = await backend.session();
    assert.equal(backend.server.httpServer.address().address, "127.0.0.1");
    assert.equal(backend.server.config.allowDemoAuth, false);
    assert.equal(backend.server.firebase.enabled, false);
    assert.equal(backend.server.redisRuntime.enabled, false);
    const headers = { Authorization: `Bearer ${session.token}` };
    assert.equal((await fetch(`${backend.origin}/api/rooms`)).status, 401);
    assert.equal((await fetch(`${backend.origin}/api/rooms`, { headers: { "x-demo-user-id": session.identity.uid } })).status, 401);
    assert.equal((await fetch(`${backend.origin}/api/rooms`, { headers: { ...headers, Origin: "https://untrusted.invalid" } })).status, 403);
    const spoofedHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(`${backend.origin}/api/rooms`, { headers: { ...headers, Host: "attacker.invalid" } }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      request.once("error", reject);
      request.end();
    });
    assert.equal(spoofedHostStatus, 403);
    const leagues = await (await fetch(`${backend.origin}/api/leagues`, { headers })).json();
    assert.ok(leagues.leagues.length > 0);
    const response = await fetch(`${backend.origin}/api/rooms`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Carreira offline", clubId: "AUR", activeLeagues: ["BR-A"], seasonLength: 1, maxManagers: 1 }) });
    assert.equal(response.status, 201, await response.clone().text());
    const { room } = await response.json();
    const rosterResponse = await fetch(`${backend.origin}/api/teams/AUR/players?roomCode=${room.code}`, { headers });
    assert.equal(rosterResponse.status, 200);
    assert.equal((await rosterResponse.json()).players.length, 20);
    client = io(backend.origin, { transports: ["websocket"], reconnection: false, auth: { token: session.token }, extraHeaders: { Origin: backend.origin } });
    await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
    const joined = await client.timeout(5000).emitWithAck("room:join", { code: room.code, clubId: "AUR" });
    assert.equal(joined.ok, true);
    await backend.server.store.setReady(room.code, session.identity.uid, true, "AUR");
    const started = await backend.server.store.startRoom(room.code, session.identity.uid);
    assert.equal(started.status, "active");
    const players = await backend.database.read((state) => state.catalog.players.filter((player) => player.clubId === "AUR"));
    const lineup = players.slice(0, 11).map((player) => player.id);
    const tactics = createAiTacticPlan(players, lineup);
    await backend.server.store.saveLineup(room.code, session.identity.uid, "AUR", lineup, tactics);
    client.close(); client = null;
    await backend.updateProfile("Manager Local");
    await backend.writePreferences({ theme: "light" });
    await backend.close();
    backend = await startLocalBackend({ directory, logger: silent });
    const next = await backend.session();
    assert.equal(next.identity.uid, session.identity.uid);
    assert.equal(next.identity.displayName, "Manager Local");
    assert.notEqual(next.token, session.token);
    const saved = await (await fetch(`${backend.origin}/api/rooms`, { headers: { Authorization: `Bearer ${next.token}` } })).json();
    assert.equal(saved.rooms.length, 1);
    assert.equal(saved.rooms[0].code, room.code);
    const restored = await backend.server.store.getRoom(room.code);
    assert.equal(restored.status, "active");
    assert.deepEqual(restored.lineups[0].lineupIds, lineup);
    assert.deepEqual(restored.lineups[0].tactics, tactics);
    assert.deepEqual(await backend.readPreferences(), { theme: "light" });
    assert.equal((await fetch(`${backend.origin}/api/rooms`, { headers })).status, 401);
  } finally { client?.close(); await backend.close(); }
});
