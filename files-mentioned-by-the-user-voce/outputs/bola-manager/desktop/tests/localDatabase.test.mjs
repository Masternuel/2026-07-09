import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openLocalDatabase, renameWithRetry, rotateSessionBackup } from "../localDatabase.mjs";
import { removeFixtureDirectory } from "./helpers/fixtureCleanup.mjs";

const root = resolve(".tmp/local-database-tests");
const initial = () => ({
  profile: { uid: "local-db-test", displayName: "Manager", preferences: { volume: 0.5 } },
  catalog: { clubs: [{ id: "AUR", name: "Aurora" }] },
  rooms: { rooms: [], deletedCodes: [], creationReceipts: [], history: [] },
  matches: [],
  news: { posts: [], operations: [] },
  catalogMedia: { "m.png": { id: "m", bytes: Buffer.from([1, 2, 3]) } },
});

async function database(t, options) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  const db = await openLocalDatabase(directory, initial(), options);
  t.after(async () => { await db.close().catch(() => undefined); await removeFixtureDirectory(root, directory); });
  return { db, directory };
}

test("D-01: read sees the committed state without cloning it whole", async (t) => {
  const { db } = await database(t);
  assert.equal(await db.read((state) => Object.isFrozen(state) && Object.isFrozen(state.profile)), true);
  assert.equal(await db.read(async (state) => state.profile.displayName), "Manager");
});

test("D-01: a reader that mutates state fails and nothing changes in memory or on disk", async (t) => {
  const { db } = await database(t);
  const before = await readFile(db.path);
  await assert.rejects(db.read((state) => { state.profile.displayName = "Intruso"; }), TypeError);
  await assert.rejects(db.read((state) => { state.rooms.rooms.push({ code: "X" }); }), TypeError);
  assert.equal(await db.read((state) => state.profile.displayName), "Manager");
  assert.equal(await db.read((state) => state.rooms.rooms.length), 0);
  assert.deepEqual(await readFile(db.path), before);
});

test("D-01: read results are clones and transactions still commit", async (t) => {
  const { db } = await database(t);
  const profile = await db.read((state) => state.profile);
  profile.displayName = "Alterado fora";
  profile.preferences.volume = 1;
  assert.deepEqual(await db.read((state) => state.profile), initial().profile);
  await db.transaction((state) => { state.profile.displayName = "Novo"; });
  assert.equal(await db.read((state) => state.profile.displayName), "Novo");
  assert.equal(await db.read((state) => Object.isFrozen(state.profile)), true);
  const bytes = await db.read((state) => state.catalogMedia["m.png"].bytes);
  bytes[0] = 99;
  assert.equal((await db.read((state) => state.catalogMedia["m.png"].bytes))[0], 1);
});

test("copy-on-write: a transaction copies only the sections it touches", async (t) => {
  const { db, directory } = await database(t);
  let catalogBefore; let roomsBefore;
  await db.read((state) => { catalogBefore = state.catalog; roomsBefore = state.rooms; });
  await db.transaction((state) => { state.rooms.rooms.push({ code: "BOLA-AAAA" }); });
  let catalogAfter; let roomsAfter;
  await db.read((state) => { catalogAfter = state.catalog; roomsAfter = state.rooms; });
  assert.equal(catalogAfter, catalogBefore, "untouched catalog keeps the committed object");
  assert.notEqual(roomsAfter, roomsBefore);
  assert.equal(Object.isFrozen(roomsAfter.rooms[0]), true);
  await db.close();
  const reopened = await openLocalDatabase(directory, initial());
  t.after(() => reopened.close().catch(() => undefined));
  assert.deepEqual(await reopened.read((state) => state.rooms.rooms), [{ code: "BOLA-AAAA" }]);
  assert.deepEqual(await reopened.read((state) => state.catalog), initial().catalog);
});

test("copy-on-write: replaced, added and deleted sections persist; a failed transaction changes nothing", async (t) => {
  const { db, directory } = await database(t);
  const before = await readFile(db.path);
  await assert.rejects(db.transaction((state) => { state.catalog.clubs.push({ id: "X" }); throw new Error("abort"); }), /abort/);
  assert.deepEqual(await readFile(db.path), before);
  assert.deepEqual(await db.read((state) => state.catalog), initial().catalog);
  await db.transaction((state) => {
    state.catalog = { clubs: [{ id: "NEW", name: "Novo" }] };
    state.catalogImport = { source: "test" };
    delete state.catalogMedia;
  });
  await db.close();
  const reopened = await openLocalDatabase(directory, initial());
  t.after(() => reopened.close().catch(() => undefined));
  assert.deepEqual(await reopened.read((state) => state.catalog), { clubs: [{ id: "NEW", name: "Novo" }] });
  assert.deepEqual(await reopened.read((state) => state.catalogImport), { source: "test" });
  assert.equal(await reopened.read((state) => Object.hasOwn(state, "catalogMedia")), false);
});

test("copy-on-write: peek reads a section without copying it, then the operation's own copy", async (t) => {
  const { db } = await database(t);
  let committedRooms;
  await db.read((state) => { committedRooms = state.rooms; });
  await db.transaction((state, { peek }) => {
    assert.equal(peek("rooms"), committedRooms, "untouched: the frozen committed section");
    state.rooms = { ...peek("rooms"), rooms: [{ code: "BOLA-PEEK" }] };
    assert.equal(peek("rooms"), state.rooms, "after a write: the operation's value");
    assert.equal(peek("profile").uid, "local-db-test");
  });
  assert.deepEqual(await db.read((state) => state.rooms.rooms), [{ code: "BOLA-PEEK" }]);
  assert.deepEqual(await db.read((state) => state.rooms.history), []);
});

test("S-10: rename retries transient Windows lock errors with bounded backoff", async () => {
  for (const code of ["EPERM", "EBUSY", "EACCES"]) {
    const waits = []; let calls = 0;
    await renameWithRetry("a", "b", {
      renameFile: async () => { if (++calls < 3) throw Object.assign(new Error(code), { code }); },
      wait: async (ms) => { waits.push(ms); },
    });
    assert.equal(calls, 3);
    assert.deepEqual(waits, [20, 40]);
  }
});

test("S-10: rename gives up after the attempt limit and never retries other errors", async () => {
  let calls = 0;
  const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
  await assert.rejects(renameWithRetry("a", "b", { renameFile: async () => { calls++; throw busy; }, wait: async () => {} }), (error) => error === busy);
  assert.equal(calls, 5);
  calls = 0;
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  await assert.rejects(renameWithRetry("a", "b", { renameFile: async () => { calls++; throw missing; }, wait: async () => {} }), (error) => error === missing);
  assert.equal(calls, 1);
});

test("S-10: a save commits when the final rename is briefly locked", async (t) => {
  let failures = 1;
  const renameFile = async (from, to) => {
    if (to.endsWith("career.bolasave") && failures-- > 0) throw Object.assign(new Error("locked"), { code: "EPERM" });
    return rename(from, to);
  };
  const { db, directory } = await database(t, { renameFile });
  failures = 1;
  await db.transaction((state) => { state.profile.displayName = "Persistido"; });
  await db.close();
  const reopened = await openLocalDatabase(directory, undefined);
  try { assert.equal(await reopened.read((state) => state.profile.displayName), "Persistido"); }
  finally { await reopened.close(); }
});

test("D-01: freezing never changes the on-disk byte format of saves or backups", async (t) => {
  const { db, directory } = await database(t);
  const before = await readFile(db.path);
  const { backupFile } = await db.transaction((state, { backupFile }) => { state.profile.displayName = "Formato"; return { backupFile }; }, { backup: true });
  assert.deepEqual(await readFile(join(directory, "backups", backupFile)), before, "backup must equal the previous save byte for byte");
  const expected = initial(); expected.profile.displayName = "Formato";
  await mkdir(root, { recursive: true });
  const fresh = await mkdtemp(join(root, "run-"));
  const reference = await openLocalDatabase(fresh, expected);
  try { assert.deepEqual(await readFile(db.path), await readFile(reference.path), "committed save must match an unfrozen encoding"); }
  finally { await reference.close(); await removeFixtureDirectory(root, fresh); }
});

async function rotationRoot(t) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  t.after(() => removeFixtureDirectory(root, directory));
  return directory;
}

test("rotation: a reopened save gets an exact-bytes copy; a new save gets none", async (t) => {
  const directory = await rotationRoot(t);
  const created = await openLocalDatabase(directory, initial(), { rotateBackups: { keep: 3 } });
  assert.equal(created.rotation, null);
  await created.transaction((state) => { state.profile.displayName = "Rotacionado"; });
  await created.close();
  const committed = await readFile(join(directory, "career.bolasave"));
  const reopened = await openLocalDatabase(directory, undefined, { rotateBackups: { keep: 3 } });
  try {
    assert.match(reopened.rotation.file, /^career-\d{8}T\d{9}Z-[0-9a-f]{8}\.bolasave$/);
    assert.deepEqual(await readFile(join(directory, "backups", "rotation", reopened.rotation.file)), committed);
    assert.equal(await reopened.read((state) => state.profile.displayName), "Rotacionado");
  } finally { await reopened.close(); }
});

test("rotation: keeps only the newest copies and never deletes foreign files", async (t) => {
  const directory = await rotationRoot(t);
  const rotation = join(directory, "backups", "rotation");
  await mkdir(rotation, { recursive: true });
  await writeFile(join(rotation, "notes.txt"), "keep me");
  await writeFile(join(rotation, "career-manual.bolasave"), "keep me too");
  let clock = Date.parse("2026-11-17T10:00:00.000Z");
  const names = [];
  for (let index = 0; index < 5; index += 1) {
    clock += 60_000;
    names.push((await rotateSessionBackup(directory, Buffer.from(`save-${index}`), { keep: 2, now: () => new Date(clock) })).file);
  }
  const left = (await readdir(rotation)).sort();
  assert.deepEqual(left, ["career-manual.bolasave", ...names.slice(-2), "notes.txt"].sort());
  assert.equal(String(await readFile(join(rotation, names.at(-1)))), "save-4");
  await assert.rejects(rotateSessionBackup(directory, Buffer.from("x"), { keep: 0 }), { code: "LOCAL_SAVE_ROTATION_INVALID" });
});

test("rotation: a failing backup never blocks opening the save", async (t) => {
  const directory = await rotationRoot(t);
  await (await openLocalDatabase(directory, initial())).close();
  const renameFile = async (from, to) => {
    if (to.includes(`${join("backups", "rotation")}`)) throw Object.assign(new Error("denied"), { code: "ENOSPC" });
    return rename(from, to);
  };
  const reopened = await openLocalDatabase(directory, undefined, { rotateBackups: { keep: 3 }, renameFile });
  try {
    assert.deepEqual(reopened.rotation, { error: "ENOSPC" });
    assert.equal(await reopened.read((state) => state.profile.uid), "local-db-test");
    assert.deepEqual((await readdir(join(directory, "backups", "rotation"))).filter((name) => name.endsWith(".bolasave")), []);
  } finally { await reopened.close(); }
});
