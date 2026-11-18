// Installer builds can ship the real-club database (Serie A-D) as the starter catalog.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundledCatalog, readBundledCatalogBytes } from "../bundledCatalog.mjs";
import { startLocalBackend } from "../localBackend.mjs";
import { buildCatalogRecords } from "../../server/import/apiFootball/catalogBuilder.mjs";
import { createCatalogDatabasePackage } from "../../server/services/catalogDatabase.mjs";

const root = fileURLToPath(new URL("../../.tmp/bundled-catalog-tests/", import.meta.url));
const silent = { info() {}, warn() {}, error() {}, debug() {} };

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

function realClubBase() {
  const squad = (teamId) => Array.from({ length: 22 }, (_, index) => ({ id: teamId * 100 + index, name: `Atleta ${teamId}-${index}`, age: 20 + (index % 12), number: index + 1,
    position: ["Goalkeeper", "Defender", "Midfielder", "Attacker"][index % 4] }));
  const { records } = buildCatalogRecords([{ league: { id: 71 }, level: 1, division: "Serie A",
    teams: [1, 2].map((id) => ({ team: { id, name: `Clube Real ${id}` }, venue: { name: "Estadio", city: "Cidade", capacity: id * 10_000 } })),
    squads: new Map([[1, squad(1)], [2, squad(2)]]) }]);
  return createCatalogDatabasePackage(records);
}

test("bundled catalog: a valid file loads, missing or invalid files fall back to the starter", async (t) => {
  const path = await directory(t);
  const file = join(path, "base-brasil.json");
  assert.equal(loadBundledCatalog(null, silent), null);
  assert.equal(loadBundledCatalog(file, silent), null);
  assert.equal(readBundledCatalogBytes(file), null);
  await writeFile(file, JSON.stringify(realClubBase()));
  const catalog = loadBundledCatalog(file, silent);
  assert.equal(catalog.clubs.length, 2);
  assert.equal(catalog.players.length, 46); // 22 per club + 1 generated midfielder each (minimum 6)
  assert.deepEqual(catalog.tournaments, []);
  await writeFile(file, "{ nao e json");
  assert.equal(loadBundledCatalog(file, silent), null);
  await writeFile(file, JSON.stringify({ format: "outro", version: 1, records: {} }));
  assert.equal(loadBundledCatalog(file, silent), null);
});

test("bundled catalog: a new profile starts with the real clubs; status reports it", async (t) => {
  const path = await directory(t);
  const file = join(path, "base-brasil.json");
  await writeFile(file, JSON.stringify(realClubBase()));
  const backend = await startLocalBackend({ directory: join(path, "saves"), logger: silent, bundledCatalogPath: file });
  try {
    const clubs = await backend.database.read((state) => state.catalog.clubs.map((club) => club.name));
    assert.deepEqual(clubs, ["Clube Real 1", "Clube Real 2"]);
    const status = await backend.catalogStatus();
    assert.equal(status.bundledAvailable, true);
    assert.equal(status.counts.players, 46);
  } finally { await backend.close(); }
});

test("bundled catalog: an existing profile keeps its catalog (switching is an explicit import)", async (t) => {
  const path = await directory(t);
  const saves = join(path, "saves");
  let backend = await startLocalBackend({ directory: saves, logger: silent });
  const original = await backend.database.read((state) => state.catalog.clubs.length);
  await backend.close();
  const file = join(path, "base-brasil.json");
  await writeFile(file, JSON.stringify(realClubBase()));
  backend = await startLocalBackend({ directory: saves, logger: silent, bundledCatalogPath: file });
  try {
    assert.equal(await backend.database.read((state) => state.catalog.clubs.length), original);
    assert.equal((await backend.catalogStatus()).bundledAvailable, true);
  } finally { await backend.close(); }
});
