import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../localDatabase.mjs";
import { createStarterCatalog, LocalCatalog } from "../localCatalog.mjs";
import { startLocalBackend } from "../localBackend.mjs";
import { CATALOG_PREVIEW_TTL_MS, catalogExportAddress, prepareCatalogImport, previewCatalogImport, commitCatalogImport, requireCatalogImportMode } from "../catalogImport.mjs";
import { createCatalogDatabasePackage, MAX_CATALOG_DATABASE_BYTES } from "../../server/services/catalogDatabase.mjs";

const root = fileURLToPath(new URL("../../.tmp/catalog-import-tests/", import.meta.url));
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const initial = () => ({ profile: { uid: "local-import", displayName: "Manager" }, catalog: createStarterCatalog(),
  rooms: { rooms: [], deletedCodes: [], creationReceipts: [], history: [] }, matches: [], news: { posts: [], operations: [] } });
const json = (value) => Buffer.from(JSON.stringify(value));
const pack = () => createCatalogDatabasePackage(createStarterCatalog());
async function directory(t) {
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "run-"));
  t.after(async () => {
    const inside = relative(root, resolve(path));
    assert.ok(inside && !inside.startsWith("..") && !inside.includes(":"));
    await rm(path, { recursive: true, force: true });
  });
  return path;
}

test("import: browser URL accepts only explicit web origins, never credentials or commands", () => {
  assert.equal(catalogExportAddress("http://localhost:5173"), "http://localhost:5173/desktop-export");
  assert.equal(catalogExportAddress("http://127.0.0.1:5173/"), "http://127.0.0.1:5173/desktop-export");
  assert.equal(catalogExportAddress("http://[::1]:5173/"), "http://[::1]:5173/desktop-export");
  assert.equal(catalogExportAddress("https://example.test/"), "https://example.test/desktop-export");
  for (const value of [null, {}, "file:///secret", "javascript:alert(1)", "http://evil.test", "http://localhost.evil.test",
    "http://127.0.0.2", "https://user:pass@example.test", "http://localhost:5173/?token=secret", "http://localhost:5173/#secret",
    "http://localhost:5173/other", "ftp://localhost"]) assert.throws(() => catalogExportAddress(value), { code: "LOCAL_IMPORT_ORIGIN_INVALID" });
});

test("import: validates original Editor format, IDs, links and counts without exporting raw metadata", () => {
  const source = pack();
  source.credentials = { token: "never-persist" };
  const candidate = prepareCatalogImport(json(source), { now: 1000 });
  assert.equal(candidate.expiresAt, 1000 + CATALOG_PREVIEW_TTL_MS);
  assert.deepEqual(candidate.records, source.records);
  assert.equal(candidate.credentials, undefined);
  const preview = previewCatalogImport(candidate, 2);
  assert.equal(preview.existingCareers, 2);
  assert.equal(preview.counts.players, 320);
  assert.equal(preview.records, undefined);
  assert.equal(preview.digest, undefined);
  assert.equal(candidate.records.players[0].id, source.records.players[0].id);
  assert.equal(candidate.records.players[0].shirtNumber, source.records.players[0].shirtNumber);
});

test("import: invalid/oversized/empty data and dangling references cannot be staged", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(MAX_CATALOG_DATABASE_BYTES + 1)]) {
    assert.throws(() => prepareCatalogImport(bytes), { code: "LOCAL_IMPORT_SIZE_INVALID" });
  }
  for (const bytes of [Buffer.from("{"), Buffer.from([0xff])]) assert.throws(() => prepareCatalogImport(bytes), { code: "LOCAL_IMPORT_JSON_INVALID" });
  assert.throws(() => prepareCatalogImport(json({ rooms: [] })), { code: "CATALOG_DATABASE_FORMAT_INVALID" });
  const empty = pack(); empty.records = { leagues: [], clubs: [], players: [], tournaments: [] };
  assert.throws(() => prepareCatalogImport(json(empty)), { code: "LOCAL_IMPORT_EMPTY" });
  const broken = pack(); broken.records.players[0].clubId = "NOT-PRESENT";
  assert.throws(() => prepareCatalogImport(json(broken)), { code: "CATALOG_DATABASE_REFERENCE_INVALID" });
});

test("import: expiry does not mutate state or create backup", async (t) => {
  const path = await directory(t);
  const database = await openLocalDatabase(path, initial());
  try {
    const before = await readFile(database.path);
    const candidate = prepareCatalogImport(json(pack()), { now: 1000 });
    await assert.rejects(commitCatalogImport(database, candidate, { now: candidate.expiresAt }), { code: "LOCAL_IMPORT_EXPIRED" });
    assert.deepEqual(await readFile(database.path), before);
    assert.ok(!(await readdir(path)).includes("backups"));
  } finally { await database.close(); }
});

test("import: full backup and archived catalog preserve careers, matches, identity and preferences", async (t) => {
  const path = await directory(t);
  const state = initial();
  state.profile.preferences = { theme: "dark" };
  state.rooms.rooms.push({ code: "BOLA-TEST", ownerId: state.profile.uid, catalogOwnerId: state.profile.uid, lineups: [{ playerIds: ["AUR-p01"] }] });
  state.matches.push({ code: "BOLA-TEST", score: [1, 0], _matchRemoved: true });
  const database = await openLocalDatabase(path, state);
  const before = await readFile(database.path);
  const imported = pack(); imported.records.players[0].name = "Jogador da conta Google";
  const candidate = prepareCatalogImport(json(imported));
  let result;
  try {
    result = await commitCatalogImport(database, candidate);
    const saved = await database.read((value) => value);
    assert.equal(result.preservedCareers, 1);
    assert.deepEqual(saved.profile, state.profile);
    assert.deepEqual(saved.matches, state.matches);
    assert.deepEqual(saved.rooms.rooms[0].lineups, state.rooms.rooms[0].lineups);
    assert.deepEqual(saved.news, state.news);
    assert.deepEqual(saved.catalog, candidate.records);
    assert.deepEqual(saved.catalogArchives[saved.rooms.rooms[0].catalogOwnerId], state.catalog);
    assert.equal(saved.catalogImport.backupFile, result.backupFile);
    assert.deepEqual(await readFile(join(path, "backups", result.backupFile)), before);
  } finally { await database.close(); }
  const restored = await openLocalDatabase(path);
  try { assert.deepEqual(await restored.read((value) => value.catalog), candidate.records); }
  finally { await restored.close(); }
  const recovery = join(path, "recovery"); await mkdir(recovery);
  await copyFile(join(path, "backups", result.backupFile), join(recovery, "career.bolasave"));
  const backup = await openLocalDatabase(recovery);
  try { assert.deepEqual(await backup.read((value) => value), state); }
  finally { await backup.close(); }
});

test("import: write failure preserves disk/memory and a usable pre-import backup", async (t) => {
  const path = await directory(t);
  let database = await openLocalDatabase(path, initial()); await database.close();
  const before = await readFile(database.path);
  database = await openLocalDatabase(path, undefined, { atomicWrite: async () => { throw Object.assign(new Error(), { code: "ENOSPC" }); } });
  try {
    await assert.rejects(commitCatalogImport(database, prepareCatalogImport(json(pack()))), { code: "ENOSPC" });
    assert.deepEqual(await database.read((state) => state), initial());
    assert.deepEqual(await readFile(database.path), before);
    const files = await readdir(join(path, "backups"));
    assert.equal(files.length, 1);
    assert.deepEqual(await readFile(join(path, "backups", files[0])), before);
  } finally { await database.close(); }
});

test("import: unknown career catalog aborts before backup or modification", async (t) => {
  const path = await directory(t);
  const state = initial(); state.rooms.rooms.push({ code: "BOLA-TEST", ownerId: "unknown" });
  const database = await openLocalDatabase(path, state);
  try {
    await assert.rejects(commitCatalogImport(database, prepareCatalogImport(json(pack()))), { code: "LOCAL_IMPORT_CAREER_UNKNOWN" });
    assert.deepEqual(await database.read((value) => value), state);
    assert.ok(!(await readdir(path)).includes("backups"));
  } finally { await database.close(); }
});

test("import: repeated imports keep each existing career on its original catalog", async (t) => {
  const path = await directory(t);
  const state = initial(); state.rooms.rooms.push({ code: "BOLA-OLD", ownerId: state.profile.uid });
  const database = await openLocalDatabase(path, state);
  try {
    const first = pack(); first.records.clubs[0].name = "Primeira base";
    await commitCatalogImport(database, prepareCatalogImport(json(first)));
    await database.transaction((next) => next.rooms.rooms.push({ code: "BOLA-NEW", ownerId: next.profile.uid }));
    const second = pack(); second.records.clubs[0].name = "Segunda base";
    await commitCatalogImport(database, prepareCatalogImport(json(second)));
    const saved = await database.read((value) => value);
    assert.equal(saved.catalog.clubs[0].name, "Segunda base");
    assert.equal(saved.catalogArchives[saved.rooms.rooms[0].catalogOwnerId].clubs[0].name, state.catalog.clubs[0].name);
    assert.equal(saved.catalogArchives[saved.rooms.rooms[1].catalogOwnerId].clubs[0].name, "Primeira base");
    assert.equal(Object.keys(saved.catalogArchives).length, 2);
  } finally { await database.close(); }
});

test("import: archived catalogs cannot alias mutable active records, unknown owners are rejected", async () => {
  const active = createStarterCatalog(); const archived = structuredClone(active);
  const catalog = new LocalCatalog(active, "local-owner", () => false, { archives: { "local-catalog-old": archived }, imported: true });
  active.players[0].name = "changed"; archived.players[0].name = "changed";
  const old = catalog.forOwner("local-catalog-old");
  assert.notEqual((await old.get("players", "AUR-p01")).name, "changed");
  const result = await catalog.get("players", "AUR-p01"); result.name = "changed";
  assert.notEqual((await catalog.get("players", "AUR-p01")).name, "changed");
  assert.throws(() => catalog.forOwner("stranger"), { code: "ROOM_FORBIDDEN" });
});

test("import: guests, hosts and live matches are blocked; pairing raced during check is blocked too", async () => {
  const backend = { database: { read: async (operation) => operation({ matches: [] }) } };
  for (const mode of ["host", "guest"]) await assert.rejects(requireCatalogImportMode(backend, { status: () => ({ mode }) }), { code: "LOCAL_IMPORT_PEER_ACTIVE" });
  await requireCatalogImportMode(backend, { status: () => ({ mode: "offline" }) });
  await assert.rejects(requireCatalogImportMode({ database: { read: async (operation) => operation({ matches: [{}] }) } },
    { status: () => ({ mode: "offline" }) }), { code: "LOCAL_IMPORT_MATCH_ACTIVE" });
  let checks = 0;
  await assert.rejects(requireCatalogImportMode(backend, { status: () => ({ mode: ++checks === 1 ? "offline" : "guest" }) }), { code: "LOCAL_IMPORT_PEER_ACTIVE" });
});

test("import: real local HTTP reload uses imported base for new careers, original base for old careers", async (t) => {
  const path = await directory(t);
  let backend = await startLocalBackend({ directory: path, logger: silent });
  const session = await backend.session();
  const room = await backend.server.store.createRoom({ name: "Antes da importacao", creatorId: session.identity.uid,
    creatorName: "Manager", clubId: "AUR", activeLeagues: ["BR-A"], seasonLength: 1, maxManagers: 1 });
  const originalName = (await backend.database.read((state) => state.catalog.players[0])).name;
  await backend.close();
  const database = await openLocalDatabase(path);
  const imported = pack(); imported.records.players[0].name = "Base recuperada";
  await commitCatalogImport(database, prepareCatalogImport(json(imported))); await database.close();
  backend = await startLocalBackend({ directory: path, logger: silent });
  try {
    const next = await backend.session();
    assert.equal(next.identity.uid, session.identity.uid);
    assert.notEqual(next.token, session.token);
    const headers = { Authorization: `Bearer ${next.token}` };
    const response = await fetch(`${backend.origin}/api/teams/AUR/players?roomCode=${room.code}`, { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).players.find((player) => player.id === "AUR-p01").name, originalName);
    const created = await backend.server.store.createRoom({ name: "Depois da importacao", creatorId: next.identity.uid,
      creatorName: "Manager", clubId: "AUR", activeLeagues: ["BR-A"], seasonLength: 1, maxManagers: 1 });
    const current = await fetch(`${backend.origin}/api/teams/AUR/players?roomCode=${created.code}`, { headers });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).players.find((player) => player.id === "AUR-p01").name, "Base recuperada");
    const status = await backend.catalogStatus();
    assert.equal(status.source, "local-import");
    assert.equal(status.preservedCareers, 1);
  } finally { await backend.close(); }
});
