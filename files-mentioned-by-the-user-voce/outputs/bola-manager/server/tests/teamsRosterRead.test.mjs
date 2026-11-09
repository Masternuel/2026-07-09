import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import express from "express";
import { createTeamsRouter } from "../routes/teams.mjs";
import { CatalogStore } from "../store/catalogStore.mjs";
import { catalogForOwner, rosterScopeForRequest } from "../store/catalogScope.mjs";
import { FirestoreRoomPersistence, MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { canonicalChecksum, splitRoomDomains } from "../store/roomPersistenceSections.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { listRoomPlayers } from "../game/roomRoster.mjs";
import { mergePlayerStates } from "../game/playerProgression.mjs";
import { ensureClubCareerSystems } from "../game/clubCareerSystem.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

const OWNER = "owner-roster", MEMBER = "member-roster", CODE = "BOLA-RSTR";
const now = () => new Date("2026-07-16T00:00:00.000Z");
const players = [
  { id: "stay", clubId: "AUR", name: "Titular", position: "ATA", age: 22, overall: 14, active: true },
  { id: "out", clubId: "AUR", name: "Emprestado", position: "MEI", age: 20, overall: 12, active: true },
  { id: "expired", clubId: "AUR", name: "Sem contrato", position: "ZAG", age: 30, overall: 12, active: true },
  { id: "in", clubId: "BOT", name: "Recebido", position: "VOL", age: 21, overall: 13, active: true },
];
function room(overrides = {}) {
  return {
    id: "save-roster", code: CODE, name: "Elenco", ownerId: OWNER, catalogOwnerId: OWNER,
    status: "active", currentSeason: 2, seasonLength: 3, seasonYear: 2026,
    createdAt: now().toISOString(), startedAt: now().toISOString(), seasonStartedAt: now().toISOString(),
    managerIds: [OWNER, MEMBER], managers: [{ id: OWNER, name: "Owner", clubId: "AUR" },
      { id: MEMBER, name: "Member", clubId: "BOT" }], activeLeagues: ["BR-A"],
    competitionCatalog: [{ id: "BR-A", name: "Liga", clubs: [{ id: "AUR", name: "Aurora" }, { id: "BOT", name: "Botafogo" }] }],
    tournamentCatalog: [], completedFixtureIds: ["played"], fixtureSchedule: [],
    careerState: { currentSeason: 2, players: [
      { ...players[0], contract: { clubId: "AUR", startSeason: 1, endSeason: 4, wage: 23000, status: "active" } },
      { ...players[1], contract: { clubId: "AUR", endSeason: 4, status: "active" } },
      { ...players[2], contract: { clubId: null, endSeason: 1, status: "expired" } },
      { ...players[3], contract: { clubId: "BOT", endSeason: 4, wage: 18000, status: "active" } },
      { id: "academy", clubId: "AUR", name: "Base", position: "PD", age: 17, overall: 9,
        academy: true, active: true, contract: { clubId: "AUR", endSeason: 4, status: "active" } },
    ], trainingPlans: [{ playerId: "academy", focus: "shooting" }] },
    marketState: { registrations: [
      { playerId: "out", originalClubId: "AUR", permanentClubId: "AUR", currentClubId: "BOT",
        playerSnapshot: players[1], loan: { id: "loan-out", lenderClubId: "AUR", borrowerClubId: "BOT", returnSeason: 3 } },
      { playerId: "in", originalClubId: "BOT", permanentClubId: "BOT", currentClubId: "AUR",
        playerSnapshot: players[3], loan: { id: "loan-in", lenderClubId: "BOT", borrowerClubId: "AUR", returnSeason: 3 } },
    ], transactions: [{ id: "private-history" }] },
    playerStates: [], clubMoraleStates: [{ clubId: "AUR", active: true, score: 75, playerDeltas: [] }],
    completedMatches: [{ fixtureId: "played", events: [{ text: "not needed" }] }],
    ...overrides,
  };
}
function seedCatalog(db, owner = OWNER, generation = null) {
  db.seed(`catalogDatabases/${owner}`, { initialized: true, status: "ready", activeGenerationId: generation });
  const prefix = `catalogDatabases/${owner}${generation ? `/generations/${generation}` : ""}`;
  for (const id of ["AUR", "BOT"]) db.seed(`${prefix}/brasfootClubs/${id}`, { id, name: id, leagueId: "BR-A", active: true });
  db.seed(`${prefix}/brasfootLeagues/BR-A`, { id: "BR-A", name: "Liga", country: "Brasil", active: true });
  for (const player of players) db.seed(`${prefix}/brasfootPlayers/${player.id}`, player);
}
async function setup(context, { legacy = false, value = room(), generation = null } = {}) {
  const db = createFakeFirestore();
  seedCatalog(db, OWNER, generation);
  const persistence = new FirestoreRoomPersistence(db);
  if (legacy) {
    const raw = JSON.stringify(value);
    db.seed(`rooms/${CODE}`, { code: CODE, managerIds: value.managerIds, roomStorageFormat: "gzip-json-v1",
      roomStorageRawBytes: Buffer.byteLength(raw), roomStoragePayload: gzipSync(Buffer.from(raw)).toString("base64") });
  } else await persistence.create(value);
  const catalog = new CatalogStore({ firestore: db, now });
  const store = new RoomStore({ persistence, catalogStore: catalog, now });
  let membership = 0;
  const original = store.requireMembershipPaths.bind(store);
  store.requireMembershipPaths = (...args) => { membership++; return original(...args); };
  store.requireMembership = () => { throw new Error("full membership must not run"); };
  const app = express();
  app.use((request, _response, next) => { request.user = { uid: request.headers["x-test-uid"] ?? MEMBER }; next(); });
  app.use("/api/teams", createTeamsRouter(db, catalog, store));
  app.use((error, _request, response, _next) => response.status(error.status ?? 500).json({ error: { code: error.code } }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  db.resetMetrics();
  return { db, persistence, catalog, store, membership: () => membership,
    read: (club = "AUR", uid = MEMBER, code = CODE) => fetch(`http://127.0.0.1:${server.address().port}/api/teams/${club}/players?roomCode=${code}`, { headers: { "x-test-uid": uid } }) };
}

test("elenco usa uma projecao autorizada sem hidratacao, transacao ou escrita", async (context) => {
  const fixture = await setup(context);
  const response = await fixture.read();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(new Set(result.players.map((player) => player.id)), new Set(["stay", "in", "academy"]));
  assert.equal(result.players.find((player) => player.id === "stay").contract.wage, 23000);
  assert.equal(result.players.find((player) => player.id === "in").contract.clubId, "BOT");
  assert.equal(result.players.find((player) => player.id === "in").clubId, "AUR");
  assert.equal(result.players.find((player) => player.id === "academy").training.focus, "shooting");
  assert.equal(fixture.membership(), 1);
  assert.equal(fixture.db.metrics.writeAttempts, 0);
  assert.equal(fixture.db.metrics.transactions, 0);
  const needed = splitRoomDomains(room()).sections.filter((section) => [
    "competitionCatalog", "tournamentCatalog", "careerState.players", "careerState.currentSeason", "careerState.trainingPlans",
    "marketState.registrations", "playerStates", "clubMoraleStates",
  ].includes(section.path));
  const catalogPlayerCount = players.filter((player) => player.clubId === "AUR").length;
  assert.equal(fixture.db.metrics.queryReads, 1);
  assert.equal(fixture.db.metrics.documentReads, 1 + needed.length + 2 + catalogPlayerCount);
  const after = fixture.db.metrics.documentReads;
  fixture.db.resetMetrics();
  await fixture.persistence.get(CODE);
  const full = fixture.db.metrics.documentReads;
  assert.ok(after < full * 3, "projection must cost less than the three former full save resolutions");
});

for (const [name, uid, code] of [["nao membro", "outsider", CODE], ["room inexistente", MEMBER, "BOLA-NONE"]]) {
  test(`IDOR rejeita ${name} antes do catalogo`, async (context) => {
    const fixture = await setup(context);
    const response = await fixture.read("AUR", uid, code);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "ROOM_NOT_FOUND");
    assert.equal(fixture.db.metrics.readPaths.some((path) => path.startsWith("catalogDatabases/")), false);
    assert.equal(fixture.db.metrics.writeAttempts, 0);
  });
}
test("IDOR nao mistura catalogo do membro nem clube de outro save; adversario permitido", async (context) => {
  const fixture = await setup(context);
  seedCatalog(fixture.db, MEMBER);
  fixture.db.seed(`catalogDatabases/${MEMBER}/brasfootClubs/FOREIGN`, { name: "Outro save" });
  const denied = await fixture.read("FOREIGN");
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).error.code, "EDITOR_RECORD_NOT_FOUND");
  const opponent = await fixture.read("BOT");
  assert.equal(opponent.status, 200);
  assert.equal(fixture.db.metrics.readPaths.some((path) => path.startsWith(`catalogDatabases/${MEMBER}/`)), false);
});

test("scope imutavel por request e sem cache entre usuarios/saves", async (context) => {
  const fixture = await setup(context);
  const request = { user: { uid: MEMBER }, query: { roomCode: CODE } };
  const scope = await rosterScopeForRequest(fixture.catalog, fixture.store, request, "AUR");
  assert.equal(scope.uid, MEMBER);
  assert.equal(scope.saveId, "save-roster");
  assert.ok(Object.isFrozen(scope.room.careerState.players[0].contract));
  assert.throws(() => { scope.room.careerState.players[0].contract.wage = 1; }, TypeError);
  await assert.rejects(rosterScopeForRequest(fixture.catalog, fixture.store, { ...request, user: { uid: "outsider" } }, "AUR"), { code: "ROOM_NOT_FOUND" });
});

test("leituras concorrentes durante maintenance lease nao escrevem nem ignoram lock de escrita", async (context) => {
  const fixture = await setup(context);
  const root = fixture.db.read(`rooms/${CODE}`);
  const { saveCommitId: _old, ...document } = root;
  document.saveMaintenanceLease = { id: "maintenance-test", expiresAt: new Date(Date.now() + 60000).toISOString() };
  fixture.db.seed(`rooms/${CODE}`, { ...document, saveCommitId: canonicalChecksum(document) });
  const before = fixture.db.dump();
  const responses = await Promise.all([fixture.read(), fixture.read("BOT")]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(fixture.membership(), 2);
  assert.equal(fixture.db.metrics.writeAttempts, 0);
  assert.deepEqual(fixture.db.dump(), before);
  await assert.rejects(fixture.persistence.mutate(CODE, (value) => value), { code: "SAVE_MAINTENANCE_BUSY" });
});

test("save comprimido legado conserva DTO de contratos/loans/base sem migracao", async (context) => {
  const fixture = await setup(context, { legacy: true });
  const before = fixture.db.dump();
  const response = await fixture.read();
  assert.equal(response.status, 200);
  const result = await response.json();
  const expected = await listRoomPlayers(await catalogForOwner(fixture.catalog, OWNER), room(), "AUR");
  assert.deepEqual(result.players.map(({ morale, moraleScore, ...player }) => player),
    mergePlayerStates(expected.players, room(), "AUR").map((player) => { const { morale, moraleScore, ...value } = player; return value; }));
  assert.equal(fixture.db.read(`rooms/${CODE}`).saveSchemaVersion, undefined);
  assert.deepEqual(fixture.db.dump(), before);
});

test("bootstrap de carreira legado gera os mesmos contratos e jovens apenas em memoria", async (context) => {
  const value = room({ completedFixtureIds: [], marketState: { registrations: [] } });
  delete value.careerState;
  const fixture = await setup(context, { legacy: true, value });
  const before = fixture.db.dump();
  const memory = new MemoryRoomPersistence();
  await memory.create(value);
  const previous = new RoomStore({ persistence: memory, catalogStore: fixture.catalog, now });
  const oldRoom = await previous.requireMembership(CODE, MEMBER);
  const expected = await listRoomPlayers(await catalogForOwner(fixture.catalog, OWNER), oldRoom, "AUR");
  fixture.db.resetMetrics();
  const response = await fixture.read();
  assert.equal(response.status, 200);
  const actual = await response.json();
  const withoutMorale = ({ morale, moraleScore, ...player }) => player;
  assert.deepEqual(actual.players.map(withoutMorale), JSON.parse(JSON.stringify(
    mergePlayerStates(expected.players, oldRoom, "AUR").map(withoutMorale))));
  assert.equal(actual.players.filter((player) => player.academy).length, 2);
  assert.equal(fixture.db.metrics.writeAttempts, 0);
  assert.deepEqual(fixture.db.dump(), before);
});

for (const format of ["raw", "chunks"]) {
  test(`projecao read-only aceita legado ${format} sem alterar documento ou payload`, async () => {
    const db = createFakeFirestore();
    const value = room();
    if (format === "raw") db.seed(`rooms/${CODE}`, value);
    else {
      const serialized = JSON.stringify(value);
      const payload = gzipSync(Buffer.from(serialized)).toString("base64");
      const generation = createHash("sha256").update(payload).digest("hex").slice(0, 32);
      const size = Math.ceil(payload.length / 2);
      db.seed(`rooms/${CODE}`, { code: CODE, roomStorageFormat: "gzip-json-chunks-v1",
        roomStorageRawBytes: Buffer.byteLength(serialized), roomStorageGeneration: generation, roomStorageChunkCount: 2 });
      for (let index = 0; index < 2; index++) db.seed(`roomPayloads/${CODE}--${generation}--${String(index).padStart(3, "0")}`,
        { roomCode: CODE, generation, index, roomStorageChunkPayload: payload.slice(index * size, (index + 1) * size) });
    }
    const persistence = new FirestoreRoomPersistence(db);
    const before = db.dump();
    const result = await persistence.getPaths(CODE, ["careerState.players", "marketState.registrations"], { readOnly: true });
    assert.deepEqual(result.careerState.players, value.careerState.players);
    assert.deepEqual(result.marketState.registrations, value.marketState.registrations);
    assert.equal(result.completedMatches, undefined);
    assert.equal(db.metrics.writeAttempts, 0);
    assert.deepEqual(db.dump(), before);
  });
}

test("catalogo nao inicializado falha fechado sem iniciar copia/manutencao no GET", async (context) => {
  const fixture = await setup(context);
  fixture.db.seed(`catalogDatabases/${OWNER}`, { initialized: false, status: "initializing" });
  fixture.db.resetMetrics();
  const response = await fixture.read();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "CATALOG_DATABASE_NOT_INITIALIZED");
  assert.equal(fixture.db.metrics.writeAttempts, 0);
  assert.equal(fixture.db.metrics.queryReads, 0);
});

for (const legacy of [false, true]) {
  test(`carreira vazia permanece vazia no DTO ${legacy ? "legado" : "v2"}`, async (context) => {
    const value = room({ careerState: {}, completedFixtureIds: [] });
    const fixture = await setup(context, { value, legacy });
    const response = await fixture.read();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.players.some((player) => player.academy), false);
    assert.equal(result.players.some((player) => player.contract), false);
    assert.equal(fixture.db.metrics.writeAttempts, 0);
  });
  test(`bootstrap ${legacy ? "legado" : "v2"} preserva qualidade de base/estrutura existente`, async (context) => {
    const value = room({ completedFixtureIds: [], marketState: { registrations: [] } });
    delete value.careerState;
    ensureClubCareerSystems(value, { now: now() });
    for (const facility of value.clubCareerState.clubFacilities) {
      facility.areas.find((area) => area.id === "academy").level = 4;
    }
    const fixture = await setup(context, { value, legacy });
    const memory = new MemoryRoomPersistence();
    await memory.create(value);
    const previous = new RoomStore({ persistence: memory, catalogStore: fixture.catalog, now });
    const oldRoom = await previous.requireMembership(CODE, MEMBER);
    const oldRoster = await listRoomPlayers(await catalogForOwner(fixture.catalog, OWNER), oldRoom, "AUR");
    fixture.db.resetMetrics();
    const before = fixture.db.dump();
    const response = await fixture.read();
    assert.equal(response.status, 200);
    const { players: actual } = await response.json();
    const withoutMorale = ({ morale, moraleScore, ...player }) => player;
    assert.deepEqual(actual.map(withoutMorale), JSON.parse(JSON.stringify(
      mergePlayerStates(oldRoster.players, oldRoom, "AUR").map(withoutMorale))));
    assert.equal(fixture.db.metrics.writeAttempts, 0);
    assert.deepEqual(fixture.db.dump(), before);
  });
}

test("geracao ativa do catalogo e indisponibilidade de importacao sao respeitadas", async (context) => {
  const fixture = await setup(context, { generation: "active-generation" });
  fixture.db.seed(`catalogDatabases/${OWNER}/brasfootPlayers/ghost`, { id: "ghost", clubId: "AUR", name: "Nao ativo" });
  const response = await fixture.read();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).players.some((player) => player.id === "ghost"), false);
  fixture.db.seed(`catalogDatabases/${OWNER}`, { initialized: true, status: "importing" });
  fixture.db.resetMetrics();
  assert.equal((await fixture.read()).status, 409);
  assert.equal(fixture.db.metrics.writeAttempts, 0);
});

test("dados corrompidos falham sem recovery com escrita em GET", async (context) => {
  const fixture = await setup(context);
  const root = fixture.db.read(`rooms/${CODE}`);
  fixture.db.seed(`rooms/${CODE}`, { ...root, name: "checksum adulterado" });
  const before = fixture.db.dump();
  const response = await fixture.read();
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "SAVE_DOCUMENT_CORRUPT");
  assert.equal(fixture.db.metrics.writeAttempts, 0);
  assert.deepEqual(fixture.db.dump(), before);
});
