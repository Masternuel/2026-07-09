import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openLocalDatabase, renameWithRetry } from "../localDatabase.mjs";
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
