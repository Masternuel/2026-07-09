import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import sharp from "sharp";
import { startLocalBackend } from "../localBackend.mjs";
import { openLocalDatabase } from "../localDatabase.mjs";
import { createStarterCatalog } from "../localCatalog.mjs";
import { LocalEditorCatalog } from "../localEditorCatalog.mjs";
import { createCatalogDatabasePackage } from "../../server/services/catalogDatabase.mjs";

const root = resolve(".tmp/local-editor-tests");
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const closers = new Map();
const initial = () => ({ profile: { uid: "local-editor", displayName: "Manager" }, catalog: createStarterCatalog(), rooms: { rooms: [], deletedCodes: [], creationReceipts: [], history: [] }, matches: [], news: { posts: [], operations: [] } });
async function directory(t) {
  await mkdir(root, { recursive: true }); const path = await mkdtemp(join(root, "run-"));
  t.after(async () => { await closers.get(path)?.(); closers.delete(path); const target = relative(root, path); assert.ok(target && !target.startsWith("..") && !target.includes(":")); await rm(path, { recursive: true, force: true }); });
  return path;
}
async function fixture(t) {
  const path = await directory(t); let backend = await startLocalBackend({ directory: path, logger: silent });
  closers.set(path, () => backend.close());
  const result = {
    path, get backend() { return backend; },
    async reopen() { await backend.close(); backend = await startLocalBackend({ directory: path, logger: silent }); },
    async request(route, { method = "GET", body, token, raw, mimeType } = {}) {
      const auth = token === null ? null : token ?? (await backend.session()).token;
      const response = await fetch(`${backend.origin}/api/editor/${route}`, { method, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body !== undefined || raw ? { "content-type": mimeType ?? (raw ? "application/octet-stream" : "application/json") } : {}) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
      return { status: response.status, value: await response.json() };
    },
  };
  return result;
}
const record = (id, name) => ({ id, name });
const tournament = (ids) => ({ id: "CUP", name: "Copa Local", format: "knockout", teamCount: 2, teamIds: ids, legs: "single", tiebreakers: ["penalties"], active: true });

async function readImage(url) {
  const response = await fetch(url);
  // Drain bodies before restarting the fixture; status alone leaves ownership
  // of the response stream with the global fetch connection pool.
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes, contentType: response.headers.get("content-type") };
}

test("local Editor: only authenticated owner can edit; peer cannot use owner catalog access", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("catalog", { token: null })).status, 401);
  assert.deepEqual((await f.request("access")).value, { canEdit: true });
  const token = f.backend.grantPeer({ uid: "peer-test", name: "Guest" });
  assert.deepEqual((await f.request("access", { token })).value, { canEdit: false });
  assert.equal((await f.request("catalog", { token })).status, 403);
  assert.equal((await f.request("leagues", { method: "POST", body: record("NO", "Denied"), token })).status, 403);
  assert.equal((await f.request("leagues", { method: "POST", body: record("NO", "Denied") })).value.error.code, "LOCAL_EDITOR_PEER_ACTIVE");
  f.backend.revokePeer(token);
  f.backend.setEditorPeerMode(() => "host");
  assert.equal((await f.request("leagues", { method: "POST", body: record("NO", "Denied") })).value.error.code, "LOCAL_EDITOR_PEER_ACTIVE");
  f.backend.setEditorPeerMode(() => "offline");
});

test("local Editor: leagues CRUD and turn count survive complete backend restart", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("leagues", { method: "POST", body: { ...record("NEW", "Liga Nova"), legs: "single" } })).status, 201);
  assert.equal((await f.request("leagues/NEW", { method: "PATCH", body: { name: "Liga Editada", legs: "double" } })).status, 200);
  await f.reopen();
  const league = (await f.request("leagues?query=Liga%20Editada")).value.records[0];
  assert.equal(league.id, "NEW"); assert.equal(league.legs, "double");
  assert.equal((await f.request("leagues/NEW", { method: "DELETE" })).status, 200);
  assert.equal((await f.request("leagues?query=Liga%20Editada")).value.count, 0);
});

test("local Editor: club, player and tournament forms retain full attributes and references", async (t) => {
  const f = await fixture(t);
  const create = (entity, body) => f.request(entity, { method: "POST", body });
  assert.equal((await create("clubs", { ...record("NEW", "Clube Novo"), leagueId: "BR-A", budget: 123456, stadium: "Arena Local", stadiumCapacity: 35000, colors: ["#aabbcc"], darkThemeColor: "#112233" })).status, 201);
  const seed = createStarterCatalog().players[0];
  const { createdAt, updatedAt, stars, marketValue, ...player } = seed;
  assert.equal((await create("players", { id: "NEW-P", clubId: "NEW", name: "Jovem Local", position: "ATA", age: 18, nationality: "BRA", shirtNumber: 99, attributes: player.attributes, isStar: true })).status, 201);
  assert.equal((await create("tournaments", tournament(["NEW", "AUR"]))).status, 201);
  assert.equal((await f.request("clubs/NEW", { method: "PATCH", body: { active: false } })).status, 409);
  assert.equal((await f.request("clubs/NEW", { method: "DELETE" })).value.error.code, "EDITOR_CLUB_IN_TOURNAMENT");
  assert.equal((await f.request("leagues/BR-A", { method: "DELETE" })).value.error.code, "EDITOR_LEAGUE_IN_USE");
  const saved = (await f.request("players?clubId=NEW")).value.records[0];
  assert.equal(saved.shirtNumber, 99); assert.equal(saved.isStar, true); assert.ok(saved.overall > 0);
  assert.equal((await f.request("players/NEW-P", { method: "PATCH", body: { clubId: "SAN", age: 19 } })).status, 200);
  assert.equal((await f.request("players?clubId=NEW")).value.count, 0);
});

test("local Editor: invalid IDs, attributes, dangling links and tournament rules do not change disk", async (t) => {
  const f = await fixture(t); const before = await readFile(f.backend.database.path);
  for (const body of [{ id: "../escape", name: "Invalid" }, { id: "BR-A", name: "Duplicate" }]) assert.ok((await f.request("leagues", { method: "POST", body })).status >= 400);
  assert.ok((await f.request("clubs", { method: "POST", body: { ...record("NEW", "Club"), leagueId: "MISSING" } })).status >= 400);
  assert.ok((await f.request("players/AUR-p01", { method: "PATCH", body: { attributes: { velocidade: 100 } } })).status >= 400);
  assert.ok((await f.request("tournaments", { method: "POST", body: { ...tournament(["AUR", "SAN"]), teamCount: 4 } })).status >= 400);
  assert.deepEqual(await readFile(f.backend.database.path), before);
});

test("local Editor: pagination, roster filtering and cursor isolation include all reserves", async (t) => {
  const f = await fixture(t);
  const first = (await f.request("players?limit=7&clubId=AUR")).value;
  const second = (await f.request(`players?limit=7&clubId=AUR&cursor=${first.nextCursor}`)).value;
  assert.equal(first.records.length, 7); assert.equal(first.count, 20); assert.equal(second.records.length, 7);
  assert.equal(new Set([...first.records, ...second.records].map((item) => item.id)).size, 14);
  assert.equal((await f.request(`players?limit=7&clubId=SAN&cursor=${first.nextCursor}`)).status, 400);
  assert.equal((await f.request("clubs?clubId=AUR")).status, 400);
});

test("local Editor: bulk deletion validates all records before removing any", async (t) => {
  const f = await fixture(t);
  for (const id of ["ONE", "TWO"]) await f.request("leagues", { method: "POST", body: record(id, id) });
  assert.equal((await f.request("leagues/bulk-delete", { method: "POST", body: { ids: ["ONE", "BR-A"] } })).status, 409);
  assert.equal((await f.request("leagues?query=ONE")).value.count, 1);
  assert.equal((await f.request("leagues/bulk-delete", { method: "POST", body: { ids: ["ONE", "TWO"] } })).value.count, 2);
});

test("local Editor: concurrent mutations serialize without losing either edit", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(["ONE", "TWO"].map((id) => f.request("leagues", { method: "POST", body: record(id, id) })));
  assert.deepEqual(results.map((item) => item.status), [201, 201]);
  assert.equal((await f.request("leagues")).value.count, 3);
});

test("local Editor: existing careers pin original catalog and backup, never change lineups or identity", async (t) => {
  const f = await fixture(t); const profile = (await f.backend.session()).identity.uid;
  await f.backend.database.transaction((state) => state.rooms.rooms.push({ code: "OLD", ownerId: profile, catalogOwnerId: profile, lineups: ["AUR-p01"] }));
  const before = await readFile(f.backend.database.path);
  await f.request("players/AUR-p01", { method: "PATCH", body: { name: "Nome Novo" } });
  const state = await f.backend.database.read((value) => value);
  const archive = state.rooms.rooms[0].catalogOwnerId;
  assert.notEqual(archive, profile); assert.equal(state.catalogArchives[archive].players[0].name, createStarterCatalog().players[0].name);
  assert.deepEqual(state.rooms.rooms[0].lineups, ["AUR-p01"]); assert.equal(state.profile.uid, profile);
  assert.deepEqual(await readFile(join(f.path, "backups", state.catalogEditor.backupFile)), before);
  await f.request("players/AUR-p01", { method: "PATCH", body: { name: "Outro Nome" } });
  assert.equal((await f.backend.database.read((value) => Object.keys(value.catalogArchives))).length, 1);
});

test("local Editor: active match prevents catalog and image writes", async (t) => {
  const f = await fixture(t);
  await f.backend.database.transaction((state) => state.matches.push({ id: "active" }));
  assert.equal((await f.request("leagues", { method: "POST", body: record("NEW", "New") })).value.error.code, "LOCAL_EDITOR_MATCH_ACTIVE");
  const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: "red" } }).png().toBuffer();
  assert.equal((await f.request("media?entity=clubs&id=AUR&kind=crest", { method: "POST", raw: image, mimeType: "image/png" })).value.error.code, "LOCAL_EDITOR_MATCH_ACTIVE");
  assert.deepEqual(await f.backend.database.read((state) => state.catalogMedia ?? {}), {});
});

test("local Editor: gameplay reads old and new career catalogs correctly without restarting", async (t) => {
  const f = await fixture(t); const session = await f.backend.session();
  const create = (name) => f.backend.server.store.createRoom({ name, creatorId: session.identity.uid,
    creatorName: "Manager", clubId: "AUR", activeLeagues: ["BR-A"], seasonLength: 1, maxManagers: 1 });
  const old = await create("Carreira anterior");
  assert.equal((await f.request("players/AUR-p01", { method: "PATCH", body: { name: "Base Editada" } })).status, 200);
  const current = await create("Carreira nova");
  for (const [room, name] of [[old, createStarterCatalog().players[0].name], [current, "Base Editada"]]) {
    const response = await fetch(`${f.backend.origin}/api/teams/AUR/players?roomCode=${room.code}`, { headers: { authorization: `Bearer ${session.token}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).players.find((player) => player.id === "AUR-p01").name, name);
  }
});

test("local Editor: JSON merge/export is compatible, idempotent and transactional", async (t) => {
  const f = await fixture(t);
  const original = (await f.request("database/export")).value;
  const imported = structuredClone(original); imported.records.players[0].name = "Importado Local";
  const send = (value, id) => f.request(`database/import?mode=merge&operationId=${id}`, { method: "POST", raw: Buffer.from(JSON.stringify(value)) });
  assert.equal((await send(imported, "import-one")).status, 200);
  assert.equal((await send(imported, "import-one")).value.idempotent, true);
  const conflict = structuredClone(imported); conflict.records.players[0].age += 1;
  assert.equal((await send(conflict, "import-one")).status, 409);
  const before = await readFile(f.backend.database.path);
  const invalid = structuredClone(imported); invalid.records.players[0].clubId = "MISSING";
  assert.ok((await send(invalid, "invalid")).status >= 400);
  assert.deepEqual(await readFile(f.backend.database.path), before);
  const exported = (await f.request("database/export")).value;
  assert.equal(exported.format, original.format); assert.equal(exported.records.players[0].name, "Importado Local");
});

test("local Editor: upload, display, replace, restart and remove images locally", async (t) => {
  const phase = (name) => t.diagnostic(`Editor image phase: ${name}`);
  const f = await fixture(t);
  const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: "red" } }).png().toBuffer();
  const upload = (bytes = image) => f.request("media?entity=clubs&id=AUR&kind=crest", { method: "POST", raw: bytes, mimeType: "image/png" });
  const first = await upload(); assert.equal(first.status, 201, `initial upload: ${first.value.error?.code ?? first.status}`);
  phase('uploaded');
  assert.equal(new URL(first.value.record.crestImageUrl).origin, f.backend.origin);
  const original = await readImage(first.value.record.crestImageUrl);
  assert.equal(original.status, 200, 'initial image GET');
  assert.equal(original.contentType, 'image/png');
  assert.equal((await sharp(original.bytes).metadata()).width, 8);
  assert.ok((await f.request("media?entity=clubs&id=AUR&kind=crest", { method: "POST", raw: Buffer.from("bad"), mimeType: "image/png" })).status >= 400);
  await f.reopen();
  phase('reopened');
  const saved = (await f.request("clubs?query=Aurora")).value.records[0];
  assert.equal(new URL(saved.crestImageUrl).origin, f.backend.origin);
  const restored = await readImage(saved.crestImageUrl);
  assert.equal(restored.status, 200, 'image GET after restart');
  assert.deepEqual(restored.bytes, original.bytes);
  const replacement = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'blue' } }).png().toBuffer();
  const second = await upload(replacement); assert.equal(second.status, 201, `replacement upload: ${second.value.error?.code ?? second.status}`);
  phase('replaced');
  const replaced = await readImage(second.value.record.crestImageUrl);
  assert.equal(replaced.status, 200);
  assert.notDeepEqual(replaced.bytes, original.bytes);
  assert.equal((await readImage(new URL(new URL(first.value.record.crestImageUrl).pathname, f.backend.origin))).status, 404, 'old image GET after replacement');
  assert.equal((await f.request("media?entity=clubs&id=AUR", { method: "DELETE" })).value.record.crestImageUrl, null);
  assert.equal(await f.backend.database.read((state) => Object.keys(state.catalogMedia).length), 0);
  assert.equal((await readImage(second.value.record.crestImageUrl)).status, 404);
});

test("local Editor: image ownership is checked and archived career images are retained", async (t) => {
  const f = await fixture(t);
  const image = await sharp({ create: { width: 4, height: 4, channels: 4, background: "blue" } }).png().toBuffer();
  const first = (await f.request("media?entity=clubs&id=AUR", { method: "POST", raw: image, mimeType: "image/png" })).value;
  await f.backend.database.transaction((state) => state.rooms.rooms.push({ code: "OLD", ownerId: state.profile.uid }));
  await f.request("media?entity=clubs&id=AUR", { method: "DELETE" });
  assert.equal((await readImage(first.record.crestImageUrl)).status, 200);
  const state = await f.backend.database.read((value) => value);
  const catalog = new LocalEditorCatalog(f.backend.database, state.profile.uid);
  await assert.rejects(catalog.associateMedia("clubs", "SAN", first.media, state.profile.uid), { code: "EDITOR_MEDIA_OWNERSHIP_INVALID" });
});

test("local Editor: failed atomic disk write rolls back catalog, archives and metadata", async (t) => {
  const path = await directory(t); let rejectWrite = false;
  const database = await openLocalDatabase(path, initial(), { atomicWrite: async () => { if (rejectWrite) throw Object.assign(new Error("Disk failure"), { code: "TEST_DISK_FAILURE" }); } });
  closers.set(path, () => database.close());
  const catalog = new LocalEditorCatalog(database, "local-editor");
  rejectWrite = true;
  await assert.rejects(catalog.create("leagues", record("NEW", "New"), "local-editor"), { code: "TEST_DISK_FAILURE" });
  assert.equal(await database.read((state) => state.catalog.leagues.length), 1);
  assert.equal(await database.read((state) => state.catalogEditor), undefined);
});

function javaObject(className, fields) {
  const utf = (text) => { const bytes = Buffer.from(text); const size = Buffer.alloc(2); size.writeUInt16BE(bytes.length); return Buffer.concat([size, bytes]); };
  const count = Buffer.alloc(2); count.writeUInt16BE(fields.length);
  const definitions = fields.map(([type, name]) => Buffer.concat([Buffer.from(type), utf(name), ...(type === "L" ? [Buffer.from([0x74]), utf("Ljava/lang/String;")] : [])]));
  const values = fields.map(([type, _, value]) => { if (type === "L") return Buffer.concat([Buffer.from([0x74]), utf(value)]); const bytes = Buffer.alloc(4); bytes.writeInt32BE(value); return bytes; });
  return Buffer.concat([Buffer.from([0xac, 0xed, 0x00, 0x05, 0x73, 0x72]), utf(className), Buffer.from("0000000000000001", "hex"), Buffer.from([0x02]), count, ...definitions, Buffer.from([0x78, 0x70]), ...values]);
}

test("local Editor: real Brasfoot binary upload, preview, commit and session cleanup use original parser", async (t) => {
  const f = await fixture(t);
  const session = (await f.request("brasfoot-import/sessions", { method: "POST" })).value;
  const base = `brasfoot-import/sessions/${session.sessionId}`;
  const bytes = javaObject("e.t", [["I", "a", 29], ["L", "d", "local-team"], ["L", "e", "Clube Brasfoot Local"]]);
  assert.equal((await f.request(`${base}/files?path=teste_bra.ban`, { method: "PUT", raw: bytes })).status, 201);
  assert.equal((await f.request(`${base}/files?path=../escape.ban`, { method: "PUT", raw: bytes })).status, 400);
  const preview = await f.request(`${base}/preview`, { method: "POST" });
  assert.equal(preview.status, 200); assert.equal(preview.value.summary.clubs, 1);
  const committed = await f.request(`${base}/commit`, { method: "POST", body: { allowPartial: false, importAssets: false } });
  assert.equal(committed.status, 200, JSON.stringify(committed.value));
  assert.equal((await f.request("clubs?query=Clube%20Brasfoot%20Local")).value.count, 1);
  assert.equal((await f.request(`${base}/preview`, { method: "POST" })).status, 404);
  await f.reopen();
  assert.equal((await f.request("clubs?query=Clube%20Brasfoot%20Local")).value.count, 1);
  const folders = await readdir(join(f.path, "imports"));
  assert.equal(folders.length, 0);
});
