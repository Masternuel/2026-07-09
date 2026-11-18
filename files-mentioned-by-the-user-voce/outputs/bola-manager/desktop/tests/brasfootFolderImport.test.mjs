// Brasfoot folder import: country selection, real divisions, crests stored as local media.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { startLocalBackend } from "../localBackend.mjs";
import { openLocalDatabase } from "../localDatabase.mjs";
import { BRASFOOT_FOLDER_LIMITS, commitBrasfootFolder, prepareBrasfootFolder, previewBrasfootFolder, selectBrasfootRecords } from "../brasfootFolderImport.mjs";

const root = fileURLToPath(new URL("../../.tmp/brasfoot-folder-tests/", import.meta.url));
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

const attributes = { velocidade: 12, chute: 12, drible: 12, nocao: 12, defesa: 12, passe: 12, peBom: 12, peRuim: 8,
  forca: 12, resistencia: 12, impulsao: 12, reflexos: 3, posicionamentoGol: 3, saidaGol: 3, penaltis: 3 };

// What parseBrasfootSource returns for a small two-country base (clubs already placed).
async function fakeSource(path) {
  await mkdir(join(path, "teams", "escudos"), { recursive: true });
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: "#c92d35" } }).png().toBuffer();
  await writeFile(join(path, "teams", "escudos", "rubro.png"), png);
  await writeFile(join(path, "teams", "escudos", "quebrado.png"), Buffer.from("not a png"));
  const club = (id, name, country, leagueId, shield = null) => ({ id, name, abbreviation: id.slice(0, 3).toUpperCase(), colors: ["#c92d35"], stadium: "Estadio",
    reputation: 15, division: leagueId ? "Serie A" : "Sem divisao", country, state: null, leagueId, active: true,
    brasfootRaw: { c: 20 }, assets: shield ? { shield } : {} });
  const player = (id, clubId) => ({ id, clubId, name: `Jogador ${id}`, position: "MEI", age: 25, nationality: "BRA",
    shirtNumber: 10, overall: 12, attributes, isStar: false, brasfootRaw: { a: id } });
  return () => Promise.resolve({
    dataset: {
      version: "brasfoot-binary-1",
      leagues: [
        { id: "BRA-1", name: "Brasileirao", country: "BRA", level: 1, division: "Serie A", legs: "double", active: true, brasfootRaw: { nTimes: 2 } },
        { id: "ARG-1", name: "Primera", country: "ARG", level: 1, division: "Primera", legs: "double", active: true, brasfootRaw: { nTimes: 2 } },
      ],
      clubs: [
        club("rubro", "Rubro FC", "BRA", "BRA-1", "teams/escudos/rubro.png"),
        club("quebrado", "Escudo Quebrado", "BRA", "BRA-1", "teams/escudos/quebrado.png"),
        club("boca", "Boca", "ARG", "ARG-1"), club("river", "River", "ARG", "ARG-1"),
        club("solto", "Sem divisao FC", "BRA", null),
      ],
      players: [player("p1", "rubro"), player("p2", "quebrado"), player("p3", "boca"), player("p4", "river"), player("p5", "solto")],
      cups: [],
    },
    report: { errors: [] },
    assetRoot: path,
  });
}

test("brasfoot folder: preview lists only countries with clubs in divisions", async (t) => {
  const path = await directory(t);
  const candidate = await prepareBrasfootFolder(path, { parse: await fakeSource(path) });
  const preview = previewBrasfootFolder(candidate);
  assert.deepEqual(preview.countries.map((item) => [item.country, item.clubs, item.players, item.crests]), [["ARG", 2, 2, 0], ["BRA", 2, 2, 2]]);
  assert.deepEqual(preview.limits, BRASFOOT_FOLDER_LIMITS);
  assert.throws(() => selectBrasfootRecords(candidate.data, []), { code: "BRASFOOT_FOLDER_NOTHING_SELECTED" });
  assert.throws(() => selectBrasfootRecords(candidate.data, ["XYZ"]), { code: "BRASFOOT_FOLDER_NOTHING_SELECTED" });
});

test("brasfoot folder: commit imports chosen countries with crests and keeps existing careers", async (t) => {
  const path = await directory(t);
  const saves = join(path, "saves");
  let backend = await startLocalBackend({ directory: saves, logger: silent });
  const session = await backend.session();
  await backend.server.store.createRoom({ name: "Antes", creatorId: session.identity.uid, creatorName: "Manager", clubId: "AUR",
    activeLeagues: ["BR-A"], seasonLength: 1, maxManagers: 1 });
  await backend.close();

  const candidate = await prepareBrasfootFolder(path, { parse: await fakeSource(path) });
  const database = await openLocalDatabase(saves);
  let result;
  try { result = await commitBrasfootFolder(database, candidate, ["BRA"]); } finally { await database.close(); }
  assert.deepEqual(result.counts, { leagues: 1, clubs: 2, players: 2, tournaments: 0 });
  assert.equal(result.crests, 1);
  assert.equal(result.crestsFailed, 1, "an invalid image is skipped, not fatal");
  assert.equal(result.preservedCareers, 1);

  backend = await startLocalBackend({ directory: saves, logger: silent });
  try {
    const catalog = await backend.database.read((state) => state.catalog);
    assert.deepEqual(catalog.clubs.map((club) => club.id).sort(), ["quebrado", "rubro"]);
    assert.ok(catalog.clubs.every((club) => !("brasfootRaw" in club) && !("assets" in club)), "source-only fields are not saved");
    assert.ok(catalog.players.every((player) => !("brasfootRaw" in player)));
    const rubro = catalog.clubs.find((club) => club.id === "rubro");
    assert.match(rubro.crestImageUrl, /^http:\/\/127\.0\.0\.1\/desktop-media\/[a-f0-9-]{36}$/);
    assert.equal(catalog.clubs.find((club) => club.id === "quebrado").crestImageUrl, null);
    const crest = await fetch(rubro.crestImageUrl.replace("http://127.0.0.1", backend.origin));
    assert.equal(crest.status, 200);
    assert.equal(crest.headers.get("content-type"), "image/png");
    const status = await backend.catalogStatus();
    assert.equal(status.source, "local-import");
    assert.equal(status.preservedCareers, 1);
  } finally { await backend.close(); }
});

test("brasfoot folder: an expired preview is refused and the base is untouched", async (t) => {
  const path = await directory(t);
  const saves = join(path, "saves");
  const backend = await startLocalBackend({ directory: saves, logger: silent });
  await backend.close();
  const candidate = await prepareBrasfootFolder(path, { parse: await fakeSource(path), now: 0 });
  const database = await openLocalDatabase(saves);
  try {
    const before = await database.read((state) => state.catalog.clubs.length);
    await assert.rejects(commitBrasfootFolder(database, candidate, ["BRA"], { now: candidate.expiresAt }), { code: "LOCAL_IMPORT_EXPIRED" });
    assert.equal(await database.read((state) => state.catalog.clubs.length), before);
  } finally { await database.close(); }
});
