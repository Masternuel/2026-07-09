import assert from "node:assert/strict";
import test from "node:test";
import { getServerConfig } from "../config.mjs";
import { MAX_EDITOR_MEDIA_BYTES } from "../services/catalogMedia.mjs";
import { CatalogStore } from "../store/catalogStore.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";
import { fakeFirebase, jsonRequest, startTestServer } from "./testHarness.mjs";

function fakeFirestore() {
  const data = new Map();
  const operations = { getAll: [], queries: [] };
  const records = (name) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name);
  };
  const snapshot = (reference) => ({
    id: reference.id,
    ref: reference,
    exists: records(reference.collectionName).has(reference.id),
    data: () => structuredClone(records(reference.collectionName).get(reference.id)),
  });
  const document = (collectionName, id) => ({
    collectionName,
    id,
    async get() {
      return snapshot(this);
    },
  });
  const buildQuery = (collectionName, options = {}) => {
    const state = {
      filters: [], orderField: null, startAtValue: null, endAtValue: null,
      startAfterDocument: null, maximum: Infinity, ...options,
    };
    const matchingEntries = ({ applyLimit = true } = {}) => {
      let entries = [...records(collectionName)].filter(([, record]) => state.filters.every(({ field, operator, value }) => (
        operator === "array-contains"
          ? Array.isArray(record[field]) && record[field].includes(value)
          : record[field] === value
      )));
      if (state.orderField) {
        entries.sort(([leftId, left], [rightId, right]) => {
          const leftValue = String(left[state.orderField] ?? "");
          const rightValue = String(right[state.orderField] ?? "");
          if (leftValue < rightValue) return -1;
          if (leftValue > rightValue) return 1;
          return leftId.localeCompare(rightId);
        });
      }
      if (state.startAtValue != null) {
        entries = entries.filter(([, record]) => String(record[state.orderField] ?? "") >= state.startAtValue);
      }
      if (state.endAtValue != null) {
        entries = entries.filter(([, record]) => String(record[state.orderField] ?? "") <= state.endAtValue);
      }
      if (state.startAfterDocument) {
        const index = entries.findIndex(([id]) => id === state.startAfterDocument.id);
        entries = index >= 0 ? entries.slice(index + 1) : [];
      }
      return applyLimit ? entries.slice(0, state.maximum) : entries;
    };
    return {
      where(field, operator, value) {
        assert.ok(["==", "array-contains"].includes(operator));
        return buildQuery(collectionName, { ...state, filters: [...state.filters, { field, operator, value }] });
      },
      orderBy(field) {
        return buildQuery(collectionName, { ...state, orderField: field });
      },
      startAt(value) {
        return buildQuery(collectionName, { ...state, startAtValue: value });
      },
      endAt(value) {
        return buildQuery(collectionName, { ...state, endAtValue: value });
      },
      startAfter(documentSnapshot) {
        return buildQuery(collectionName, { ...state, startAfterDocument: documentSnapshot });
      },
      limit(limitValue) {
        return buildQuery(collectionName, { ...state, maximum: limitValue });
      },
      count() {
        return {
          async get() {
            return { data: () => ({ count: matchingEntries({ applyLimit: false }).length }) };
          },
        };
      },
      async get() {
        operations.queries.push({
          collectionName,
          filters: structuredClone(state.filters),
          orderField: state.orderField,
          maximum: state.maximum,
        });
        const docs = matchingEntries().map(([id]) => snapshot(document(collectionName, id)));
        return { docs, empty: docs.length === 0 };
      },
    };
  };
  const firestore = {
    operations,
    failCatalogTransactionAt: null,
    catalogTransactionCount: 0,
    collection(name) {
      const query = buildQuery(name);
      return {
        ...query,
        doc(id) {
          return document(name, id);
        },
      };
    },
    async getAll(...references) {
      operations.getAll.push(references.map((reference) => `${reference.collectionName}/${reference.id}`));
      return references.map(snapshot);
    },
    async runTransaction(operation) {
      let touchedCatalogRecord = false;
      const result = await operation({
        async get(target) {
          return target.get();
        },
        async getAll(...references) {
          operations.getAll.push(references.map((reference) => `${reference.collectionName}/${reference.id}`));
          return references.map(snapshot);
        },
        set(reference, value) {
          if (/^catalogDatabases\/[^/]+\/(brasfootLeagues|brasfootClubs|brasfootPlayers|tournaments)$/.test(reference.collectionName)) {
            touchedCatalogRecord = true;
          }
          records(reference.collectionName).set(reference.id, structuredClone(value));
        },
        update(reference, changes) {
          const current = records(reference.collectionName).get(reference.id);
          records(reference.collectionName).set(reference.id, { ...current, ...structuredClone(changes) });
        },
        delete(reference) {
          records(reference.collectionName).delete(reference.id);
        },
      });
      if (touchedCatalogRecord) {
        firestore.catalogTransactionCount += 1;
        if (firestore.catalogTransactionCount === firestore.failCatalogTransactionAt) {
          firestore.failCatalogTransactionAt = null;
          throw new Error("falha simulada durante importacao");
        }
      }
      return result;
    },
  };
  return firestore;
}

function fakeBucket() {
  const saved = new Map();
  const deleted = [];
  const bucket = {
    name: "bola-manager-test.appspot.com",
    saved,
    deleted,
    failNextSave: false,
    failNextDelete: false,
    file(path) {
      return {
        async getMetadata() {
          if (!saved.has(path)) throw Object.assign(new Error("not found"), { code: 404 });
          return [{ ...saved.get(path).options.metadata, generation: "1" }];
        },
        async save(bytes, options) {
          if (bucket.failNextSave) {
            bucket.failNextSave = false;
            throw Object.assign(new Error("fake storage failure"), { code: "storage-failed" });
          }
          saved.set(path, { bytes: Buffer.from(bytes), options: structuredClone(options) });
        },
        async delete() {
          if (bucket.failNextDelete) {
            bucket.failNextDelete = false;
            throw new Error("fake delete failure");
          }
          deleted.push(path);
          saved.delete(path);
        },
      };
    },
  };
  return bucket;
}

function league(id = "BR-A") {
  return { id, name: "Brasileirao", country: "Brasil", level: 1, division: "Serie A", active: true };
}

function club(id = "AUR", leagueId = "BR-A") {
  return {
    id,
    name: "Aurora FC",
    abbreviation: "AUR",
    colors: ["#bfff00", "#101414"],
    darkThemeColor: "#e7e7e7",
    lightThemeColor: "#171a17",
    stadium: "Estadio Aurora",
    stadiumCapacity: 36_250,
    reputation: 14,
    division: "Serie A",
    country: "Brasil",
    state: "SP",
    city: "Santos",
    leagueId,
    budget: 25_000_000,
    active: true,
  };
}

function player(id = "AUR-9", clubId = "AUR") {
  return {
    id,
    clubId,
    name: "Lucas Braga",
    position: "ATA",
    age: 24,
    nationality: "Brasil",
    shirtNumber: 9,
    overall: 16,
    attributes: {
      velocidade: 17,
      chute: 16,
      drible: 15,
      nocao: 14,
      defesa: 8,
      passe: 14,
      peBom: 18,
      peRuim: 9,
    },
    active: true,
  };
}

function tournament(id = "COPA-AUR", teamIds = ["AUR"]) {
  return {
    id,
    name: "Copa Aurora",
    format: "knockout",
    teamCount: 2,
    legs: "single",
    tiebreakers: ["extra_time", "penalties"],
    teamIds,
    active: false,
  };
}

test("config normaliza UIDs administrativos sem duplicatas", () => {
  assert.deepEqual(
    getServerConfig({ EDITOR_ADMIN_UIDS: " uid-a,uid-b, uid-a ,," }).editorAdminUids,
    ["uid-a", "uid-b"],
  );
  assert.equal(getServerConfig({}).allowLocalEditor, false);
  assert.equal(getServerConfig({ ALLOW_LOCAL_EDITOR: "true" }).allowLocalEditor, false);
  assert.equal(
    getServerConfig({ NODE_ENV: "development", ALLOW_LOCAL_EDITOR: "true" }).allowLocalEditor,
    true,
  );
  assert.equal(
    getServerConfig({ NODE_ENV: "production", ALLOW_LOCAL_EDITOR: "true" }).allowLocalEditor,
    false,
  );
});

test("retoma automaticamente uma base que fica abandonada durante a espera", async () => {
  const firestore = fakeFirestore();
  const ownerId = "uid-orphan";
  await firestore.runTransaction(async (transaction) => {
    transaction.set(firestore.collection("catalogDatabases").doc(ownerId), {
      ownerId,
      initialized: false,
      status: "initializing",
      initializationId: "attempt-that-crashed",
      initializationStartedAt: "2026-07-15T02:14:00.000Z",
      initializationHeartbeatAt: "2026-07-15T02:14:00.000Z",
    });
    transaction.set(firestore.collection("brasfootLeagues").doc("BR-A"), league());
    transaction.set(firestore.collection("brasfootClubs").doc("AUR"), club());
    transaction.set(firestore.collection("brasfootPlayers").doc("AUR-9"), player());
  });

  let clockReads = 0;
  const catalog = new CatalogStore({
    firestore,
    now: () => new Date(clockReads++ === 0
      ? "2026-07-15T02:14:00.000Z"
      : "2026-07-15T02:14:31.000Z"),
  }).forOwner(ownerId);
  await catalog.ensureInitialized();

  const metadata = await firestore.collection("catalogDatabases").doc(ownerId).get();
  assert.equal(metadata.data().initialized, true);
  assert.equal(metadata.data().status, "ready");
  assert.deepEqual(metadata.data().counts, {
    leagues: 1,
    clubs: 1,
    players: 1,
    tournaments: 0,
  });
  assert.equal((await catalog.collection("leagues").doc("BR-A").get()).exists, true);
  assert.equal((await catalog.collection("clubs").doc("AUR").get()).exists, true);
  assert.equal((await catalog.collection("players").doc("AUR-9").get()).exists, true);
});

test("Editor libera uma base isolada para toda conta Firebase em producao", async (context) => {
  const firestore = fakeFirestore();
  const { server, url } = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { NODE_ENV: "production", EDITOR_ADMIN_UIDS: "uid-admin", ALLOW_LOCAL_EDITOR: "true" },
  });
  context.after(() => server.close());

  for (const token of ["editor-token", "admin-token", "owner-token", "string-editor-token"]) {
    const response = await jsonRequest(`${url}/api/editor/access`, token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { canEdit: true });
    const catalog = await jsonRequest(`${url}/api/editor/catalog`, token);
    assert.equal(catalog.status, 200);
  }
});

test("Editor pessoal independe de bypass local e nunca libera demo", async (context) => {
  const firestore = fakeFirestore();
  const closedServer = await startTestServer({ firebase: fakeFirebase({ firestore }) });
  context.after(() => closedServer.server.close());
  assert.deepEqual(
    await (await jsonRequest(`${closedServer.url}/api/editor/access`, "owner-token")).json(),
    { canEdit: true },
  );
  assert.equal(
    (await jsonRequest(`${closedServer.url}/api/editor/catalog`, "owner-token")).status,
    200,
  );

  const localServer = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { ALLOW_LOCAL_EDITOR: "true" },
  });
  context.after(() => localServer.server.close());
  assert.deepEqual(
    await (await jsonRequest(`${localServer.url}/api/editor/access`, "owner-token")).json(),
    { canEdit: true },
  );

  const demoServer = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { ALLOW_DEMO_AUTH: "true", ALLOW_LOCAL_EDITOR: "true" },
  });
  context.after(() => demoServer.server.close());
  const demoHeaders = { "x-demo-user-id": "demo-1", "x-demo-user-name": "Demo" };
  const access = await fetch(`${demoServer.url}/api/editor/access`, { headers: demoHeaders });
  assert.deepEqual(await access.json(), { canEdit: false });
  const catalog = await fetch(`${demoServer.url}/api/editor/catalog`, { headers: demoHeaders });
  assert.equal(catalog.status, 403);
  assert.equal((await catalog.json()).error.code, "EDITOR_FORBIDDEN");
});

test("CRUD lista catalogo, registra auditoria, mantem ID imutavel e permite arquivar", async (context) => {
  const firestore = fakeFirestore();
  const catalogStore = new CatalogStore({
    firestore,
    now: () => new Date("2026-07-12T15:30:00.000Z"),
  });
  const { server, url } = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    catalogStore,
    env: { ALLOW_LOCAL_EDITOR: "true" },
  });
  context.after(() => server.close());

  for (const [entity, body] of [
    ["leagues", league()],
    ["clubs", club()],
    ["players", player()],
    ["tournaments", tournament()],
  ]) {
    const response = await jsonRequest(`${url}/api/editor/${entity}`, "owner-token", { method: "POST", body });
    assert.equal(response.status, 201);
    const record = (await response.json()).record;
    assert.equal(record.id, body.id);
    assert.equal(record.createdAt, "2026-07-12T15:30:00.000Z");
    assert.equal(record.updatedAt, record.createdAt);
    assert.equal(record.updatedBy, "uid-owner");
    if (entity === "players") {
      assert.equal(record.isStar, false);
      assert.equal(record.overall, 15);
      assert.deepEqual(
        Object.fromEntries([
          "forca", "resistencia", "impulsao", "reflexos", "posicionamentoGol", "saidaGol", "penaltis",
        ].map((key) => [key, record.attributes[key]])),
        {
          forca: 10,
          resistencia: 10,
          impulsao: 10,
          reflexos: 10,
          posicionamentoGol: 10,
          saidaGol: 10,
          penaltis: 10,
        },
      );
    }
    if (entity === "clubs") {
      assert.equal(record.crestImagePath, null);
      assert.deepEqual(record.colors, ["#bfff00", "#101414"]);
      assert.equal(record.darkThemeColor, "#e7e7e7");
      assert.equal(record.lightThemeColor, "#171a17");
      assert.equal(record.stadium, "Estadio Aurora");
      assert.equal(record.stadiumCapacity, 36_250);
    }
    if (entity === "players") assert.equal(record.avatarImagePath, null);
    if (entity === "tournaments") assert.equal(record.trophyImagePath, null);
  }

  const catalog = await (await jsonRequest(`${url}/api/editor/catalog`, "owner-token")).json();
  assert.deepEqual(catalog.leagues.map((record) => record.id), ["BR-A"]);
  assert.deepEqual(catalog.clubs.map((record) => record.id), ["AUR"]);
  assert.deepEqual(catalog.players.map((record) => record.id), ["AUR-9"]);
  assert.deepEqual(catalog.tournaments.map((record) => record.id), ["COPA-AUR"]);
  assert.equal(catalog.clubs[0].stadium, "Estadio Aurora");
  assert.equal(catalog.clubs[0].stadiumCapacity, 36_250);
  assert.deepEqual(
    Object.fromEntries(Object.entries(catalog.clubs[0]).filter(([key]) => (
      ["colors", "darkThemeColor", "lightThemeColor"].includes(key)
    ))),
    { colors: ["#bfff00", "#101414"], darkThemeColor: "#e7e7e7", lightThemeColor: "#171a17" },
  );
  assert.deepEqual(catalog.meta.players, {
    count: 1,
    returned: 1,
    limit: 50,
    nextCursor: null,
    hasMore: false,
    filters: { query: null, clubId: null },
  });

  const recalculated = await jsonRequest(`${url}/api/editor/players/AUR-9`, "owner-token", {
    method: "PATCH",
    body: { overall: 1, attributes: { ...player().attributes, chute: 20 } },
  });
  assert.equal(recalculated.status, 200);
  assert.equal((await recalculated.json()).record.overall, 16);

  const recolored = await jsonRequest(`${url}/api/editor/clubs/AUR`, "owner-token", {
    method: "PATCH",
    body: {
      colors: ["#ffffff", "#101414", "#112233"],
      darkThemeColor: "#f0f0f0",
      lightThemeColor: "#202420",
    },
  });
  assert.equal(recolored.status, 200);
  assert.deepEqual(
    Object.fromEntries(Object.entries((await recolored.json()).record).filter(([key]) => (
      ["colors", "darkThemeColor", "lightThemeColor"].includes(key)
    ))),
    { colors: ["#ffffff", "#101414", "#112233"], darkThemeColor: "#f0f0f0", lightThemeColor: "#202420" },
  );

  const invalidThemeColor = await jsonRequest(`${url}/api/editor/clubs/AUR`, "owner-token", {
    method: "PATCH",
    body: { darkThemeColor: "branco" },
  });
  assert.equal(invalidThemeColor.status, 400);
  assert.equal((await invalidThemeColor.json()).error.code, "VALIDATION_ERROR");

  const renovatedStadium = await jsonRequest(`${url}/api/editor/clubs/AUR`, "owner-token", {
    method: "PATCH",
    body: { stadium: "Arena Aurora", stadiumCapacity: 42_500 },
  });
  assert.equal(renovatedStadium.status, 200);
  assert.deepEqual(
    Object.fromEntries(Object.entries((await renovatedStadium.json()).record)
      .filter(([key]) => ["stadium", "stadiumCapacity"].includes(key))),
    { stadium: "Arena Aurora", stadiumCapacity: 42_500 },
  );

  const invalidStadiumCapacity = await jsonRequest(`${url}/api/editor/clubs/AUR`, "owner-token", {
    method: "PATCH",
    body: { stadiumCapacity: 500_001 },
  });
  assert.equal(invalidStadiumCapacity.status, 400);
  assert.equal((await invalidStadiumCapacity.json()).error.code, "VALIDATION_ERROR");

  const competitionCatalog = await catalogStore.forOwner("uid-owner").listCompetitionCatalog();
  const publicAurora = competitionCatalog[0].clubs.find((item) => item.id === "AUR");
  assert.equal(publicAurora.stadium, "Arena Aurora");
  assert.equal(publicAurora.stadiumCapacity, 42_500);

  const legacyClub = club("LEG");
  delete legacyClub.darkThemeColor;
  delete legacyClub.lightThemeColor;
  delete legacyClub.stadiumCapacity;
  const legacyResponse = await jsonRequest(`${url}/api/editor/clubs`, "owner-token", {
    method: "POST",
    body: { ...legacyClub, name: "Clube legado" },
  });
  assert.equal(legacyResponse.status, 201);
  const legacyRecord = (await legacyResponse.json()).record;
  assert.equal(legacyRecord.darkThemeColor, null);
  assert.equal(legacyRecord.lightThemeColor, null);
  assert.equal(legacyRecord.stadiumCapacity, 0);

  const invalidTournamentPatch = await jsonRequest(
    `${url}/api/editor/tournaments/COPA-AUR`,
    "owner-token",
    { method: "PATCH", body: { tiebreakers: ["away_goals"] } },
  );
  assert.equal(invalidTournamentPatch.status, 400);
  assert.equal((await invalidTournamentPatch.json()).error.code, "EDITOR_TOURNAMENT_INVALID");

  const renamed = await jsonRequest(`${url}/api/editor/players/AUR-9`, "owner-token", {
    method: "PATCH",
    body: { name: "Lucas Nogueira", active: false, isStar: true },
  });
  assert.equal(renamed.status, 200);
  assert.deepEqual(
    Object.fromEntries(Object.entries((await renamed.json()).record)
      .filter(([key]) => ["id", "name", "active", "isStar"].includes(key))),
    { id: "AUR-9", name: "Lucas Nogueira", active: false, isStar: true },
  );

  const immutableId = await jsonRequest(`${url}/api/editor/players/AUR-9`, "owner-token", {
    method: "PATCH",
    body: { id: "OUTRO" },
  });
  assert.equal(immutableId.status, 400);
  assert.equal((await immutableId.json()).error.code, "VALIDATION_ERROR");

  const removed = await jsonRequest(`${url}/api/editor/players/AUR-9`, "owner-token", { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { deleted: true, id: "AUR-9", mediaRemoved: true });
});

test("exclusao em lote e atomica e respeita dependencias", async (context) => {
  const firestore = fakeFirestore();
  const { server, url } = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { NODE_ENV: "production" },
  });
  context.after(() => server.close());

  await jsonRequest(`${url}/api/editor/leagues`, "owner-token", { method: "POST", body: league() });
  await jsonRequest(`${url}/api/editor/clubs`, "owner-token", { method: "POST", body: club() });
  await jsonRequest(`${url}/api/editor/clubs`, "owner-token", {
    method: "POST",
    body: { ...club("LIVRE"), name: "Clube Livre", abbreviation: "LIV" },
  });
  await jsonRequest(`${url}/api/editor/players`, "owner-token", { method: "POST", body: player() });

  const missingPlayer = await jsonRequest(`${url}/api/editor/players/bulk-delete`, "owner-token", {
    method: "POST",
    body: { ids: ["AUR-9", "NAO-EXISTE"] },
  });
  assert.equal(missingPlayer.status, 404);
  assert.equal((await missingPlayer.json()).error.code, "EDITOR_RECORD_NOT_FOUND");
  const playersAfterMissing = await (await jsonRequest(
    `${url}/api/editor/players?clubId=AUR`,
    "owner-token",
  )).json();
  assert.deepEqual(playersAfterMissing.records.map((record) => record.id), ["AUR-9"]);

  const blockedClubs = await jsonRequest(`${url}/api/editor/clubs/bulk-delete`, "owner-token", {
    method: "POST",
    body: { ids: ["LIVRE", "AUR"] },
  });
  assert.equal(blockedClubs.status, 409);
  assert.equal((await blockedClubs.json()).error.code, "EDITOR_CLUB_IN_USE");
  const clubsAfterBlocked = await (await jsonRequest(`${url}/api/editor/clubs`, "owner-token")).json();
  assert.deepEqual(clubsAfterBlocked.records.map((record) => record.id).sort(), ["AUR", "LIVRE"]);

  await jsonRequest(`${url}/api/editor/players`, "owner-token", {
    method: "POST",
    body: { ...player("AUR-10"), name: "Bruno Lima", shirtNumber: 10 },
  });
  const removedPlayers = await jsonRequest(`${url}/api/editor/players/bulk-delete`, "owner-token", {
    method: "POST",
    body: { ids: ["AUR-9", "AUR-10"] },
  });
  assert.equal(removedPlayers.status, 200);
  assert.deepEqual(await removedPlayers.json(), {
    deleted: true,
    ids: ["AUR-9", "AUR-10"],
    count: 2,
    mediaRemoved: true,
    removedMediaCount: 0,
    failedMediaCount: 0,
  });
  assert.equal((await (await jsonRequest(
    `${url}/api/editor/players?clubId=AUR`,
    "owner-token",
  )).json()).count, 0);

  const duplicateIds = await jsonRequest(`${url}/api/editor/clubs/bulk-delete`, "owner-token", {
    method: "POST",
    body: { ids: ["AUR", "AUR"] },
  });
  assert.equal(duplicateIds.status, 400);
  assert.equal((await duplicateIds.json()).error.code, "VALIDATION_ERROR");
});

test("exporta, compartilha e importa bases sem misturar donos nem transferir posse da imagem", async (context) => {
  const firestore = createFakeFirestore();
  const { server, url } = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { NODE_ENV: "production" },
  });
  context.after(() => server.close());

  await jsonRequest(`${url}/api/editor/leagues`, "editor-token", { method: "POST", body: {
    ...league("ES-1"), name: "La Liga", country: "Espanha", division: "Primera Division",
  } });
  await jsonRequest(`${url}/api/editor/clubs`, "editor-token", { method: "POST", body: {
    ...club("RMA", "ES-1"),
    name: "Real Madrid",
    country: "Espanha",
    division: "Primera Division",
    crestImageUrl: "https://cdn.example.com/real-madrid.png",
    crestImagePath: "editor-media/clubs/real-madrid/owner.png",
  } });
  await firestore.collection("catalogDatabases/uid-editor/brasfootClubs").doc("RMA").update({
    crestImagePath: "editor-media/clubs/real-madrid/owner.png",
  });
  await jsonRequest(`${url}/api/editor/players`, "editor-token", { method: "POST", body: {
    ...player("RMA-10", "RMA"), name: "Craque Espanhol", nationality: "Espanha", isStar: true,
  } });

  const exportedResponse = await jsonRequest(`${url}/api/editor/database/export`, "editor-token");
  assert.equal(exportedResponse.status, 200);
  assert.match(exportedResponse.headers.get("content-disposition"), /bola-manager-base-/);
  const database = await exportedResponse.json();
  assert.equal(database.format, "bola-manager-database");
  assert.equal(database.version, 1);
  assert.deepEqual(database.summary.countries, ["Espanha"]);
  assert.equal(database.records.clubs[0].stadium, "Estadio Aurora");
  assert.equal(database.records.clubs[0].stadiumCapacity, 36_250);
  assert.equal(database.records.players[0].attributes.reflexos, 10);
  assert.equal(database.records.players[0].attributes.resistencia, 10);
  database.records.players[0].shortName = "Craque";
  database.records.players[0].marketValue = 125_000_000;
  database.records.players[0].worldStar = true;
  database.records.clubs[0].crestImagePath = "editor-media/clubs/real-madrid/owner.png";
  const legacyDatabase = structuredClone(database);
  for (const key of [
    "forca", "resistencia", "impulsao", "reflexos", "posicionamentoGol", "saidaGol", "penaltis",
  ]) delete legacyDatabase.records.players[0].attributes[key];

  const restoredOwnBackup = await fetch(`${url}/api/editor/database/import?mode=merge`, {
    method: "POST",
    headers: {
      authorization: "Bearer editor-token",
      "content-type": "application/octet-stream",
    },
    body: Buffer.from(JSON.stringify(legacyDatabase)),
  });
  assert.equal(restoredOwnBackup.status, 200);
  const restoredOwnerCatalog = await (await jsonRequest(`${url}/api/editor/catalog`, "editor-token")).json();
  assert.equal(restoredOwnerCatalog.clubs[0].crestImagePath, "editor-media/clubs/real-madrid/owner.png");
  assert.equal(restoredOwnerCatalog.players[0].attributes.posicionamentoGol, 10);

  const failedDatabase = structuredClone(database);
  failedDatabase.records.clubs[0].name = "Nome que nao deve ser publicado";
  const originalBatch = firestore.batch.bind(firestore);
  firestore.batch = () => {
    const batch = originalBatch();
    const commit = batch.commit.bind(batch);
    batch.commit = () => {
      firestore.batch = originalBatch;
      firestore.failBeforeCommit(new Error("falha simulada durante staging"));
      return commit();
    };
    return batch;
  };
  const failedImport = await fetch(`${url}/api/editor/database/import?mode=merge`, {
    method: "POST",
    headers: {
      authorization: "Bearer editor-token",
      "content-type": "application/octet-stream",
    },
    body: Buffer.from(JSON.stringify(failedDatabase)),
  });
  assert.equal(failedImport.status, 500);
  const afterRollback = await (await jsonRequest(`${url}/api/editor/catalog`, "editor-token")).json();
  assert.equal(afterRollback.clubs[0].name, "Real Madrid");
  assert.equal(afterRollback.clubs[0].crestImagePath, "editor-media/clubs/real-madrid/owner.png");

  const importedResponse = await fetch(`${url}/api/editor/database/import?mode=merge`, {
    method: "POST",
    headers: {
      authorization: "Bearer second-token",
      "content-type": "application/octet-stream",
    },
    body: Buffer.from(JSON.stringify(database)),
  });
  assert.equal(importedResponse.status, 200);
  const imported = await importedResponse.json();
  assert.equal(imported.mode, "merge");
  assert.equal(imported.counts.players, 1);

  const recipientCatalog = await (await jsonRequest(`${url}/api/editor/catalog`, "second-token")).json();
  assert.deepEqual(recipientCatalog.leagues.map((item) => item.id), ["ES-1"]);
  assert.equal(recipientCatalog.clubs[0].crestImageUrl, "https://cdn.example.com/real-madrid.png");
  assert.equal(recipientCatalog.clubs[0].crestImagePath, null);
  assert.equal(recipientCatalog.clubs[0].stadium, "Estadio Aurora");
  assert.equal(recipientCatalog.clubs[0].stadiumCapacity, 36_250);
  assert.equal(recipientCatalog.players[0].shortName, "Craque");
  assert.equal(recipientCatalog.players[0].marketValue, 125_000_000);
  assert.equal(recipientCatalog.players[0].worldStar, true);
  assert.equal(recipientCatalog.players[0].attributes.forca, 10);
  assert.equal(recipientCatalog.players[0].attributes.reflexos, 10);

  await jsonRequest(`${url}/api/editor/clubs/RMA`, "second-token", {
    method: "PATCH", body: { name: "Real Madrid da copia" },
  });
  const sendImport = (query = "", body = database) => fetch(`${url}/api/editor/database/import${query}`, {
    method: "POST",
    headers: { authorization: "Bearer second-token", "content-type": "application/octet-stream" },
    body: Buffer.from(JSON.stringify(body)),
  });
  const retry = await sendImport();
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).idempotent, true);
  const afterRetry = await (await jsonRequest(`${url}/api/editor/catalog`, "second-token")).json();
  assert.equal(afterRetry.clubs[0].name, "Real Madrid da copia");
  const deliberate = await sendImport("?operationId=explicit-reimport");
  assert.equal(deliberate.status, 200);
  const deliberateResult = await deliberate.json();
  assert.equal(deliberateResult.operationId, "explicit-reimport");
  assert.equal(deliberateResult.idempotent, false);
  assert.notEqual(deliberateResult.generationId, imported.generationId);
  const idConflict = await sendImport("?operationId=explicit-reimport", failedDatabase);
  assert.equal(idConflict.status, 409);
  assert.equal((await idConflict.json()).error.code, "CATALOG_DATABASE_IMPORT_ID_CONFLICT");
  const invalidId = await sendImport("?operationId=invalid/path");
  assert.equal(invalidId.status, 400);
  assert.equal((await invalidId.json()).error.code, "CATALOG_DATABASE_IMPORT_ID_INVALID");
  const ownerCatalog = await (await jsonRequest(`${url}/api/editor/catalog`, "editor-token")).json();
  assert.equal(ownerCatalog.clubs[0].name, "Real Madrid");

  const invalid = { ...database, version: 99 };
  const invalidResponse = await fetch(`${url}/api/editor/database/import`, {
    method: "POST",
    headers: {
      authorization: "Bearer second-token",
      "content-type": "application/octet-stream",
    },
    body: Buffer.from(JSON.stringify(invalid)),
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).error.code, "CATALOG_DATABASE_VERSION_UNSUPPORTED");
});

test("Editor pagina e pesquisa por entidade sem carregar o catalogo inteiro", async (context) => {
  const firestore = fakeFirestore();
  const { server, url } = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { ALLOW_LOCAL_EDITOR: "true" },
  });
  context.after(() => server.close());

  await jsonRequest(`${url}/api/editor/leagues`, "owner-token", { method: "POST", body: league() });
  await jsonRequest(`${url}/api/editor/clubs`, "owner-token", { method: "POST", body: club() });
  await jsonRequest(`${url}/api/editor/clubs`, "owner-token", {
    method: "POST",
    body: { ...club("BOR"), name: "Boreal FC" },
  });
  for (const body of [
    { ...player("AUR-1"), name: "Ana Lima" },
    { ...player("AUR-2"), name: "Bruno Lima" },
    { ...player("BOR-1", "BOR"), name: "Bia Souza" },
  ]) {
    await jsonRequest(`${url}/api/editor/players`, "owner-token", { method: "POST", body });
  }

  const firstResponse = await jsonRequest(`${url}/api/editor/players?limit=1&clubId=AUR`, "owner-token");
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.count, 2);
  assert.equal(first.returned, 1);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.records.map((record) => record.id), ["AUR-1"]);
  assert.ok(first.nextCursor);

  const second = await (await jsonRequest(
    `${url}/api/editor/players?limit=1&clubId=AUR&cursor=${encodeURIComponent(first.nextCursor)}`,
    "owner-token",
  )).json();
  assert.equal(second.hasMore, false);
  assert.deepEqual(second.records.map((record) => record.id), ["AUR-2"]);

  const search = await (await jsonRequest(
    `${url}/api/editor/players?query=Bru&clubId=AUR`,
    "owner-token",
  )).json();
  assert.equal(search.count, 1);
  assert.deepEqual(search.records.map((record) => record.name), ["Bruno Lima"]);
  assert.equal(
    firestore.operations.queries.some((operation) => (
      operation.orderField === "name"
      && operation.filters.some((filter) => filter.field === "clubId")
    )),
    false,
  );

  const catalog = await (await jsonRequest(`${url}/api/editor/catalog?limit=1`, "owner-token")).json();
  assert.equal(catalog.players.length, 1);
  assert.equal(catalog.meta.players.count, 3);
  assert.equal(catalog.meta.players.hasMore, true);

  const invalidFilter = await jsonRequest(`${url}/api/editor/clubs?clubId=AUR`, "owner-token");
  assert.equal(invalidFilter.status, 400);
  assert.equal((await invalidFilter.json()).error.code, "EDITOR_FILTER_INVALID");
});

test("catalogo autenticado de torneios lista somente ativos com participantes e imagens", async (context) => {
  const firestore = fakeFirestore();
  const { server, url } = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { NODE_ENV: "production" },
  });
  context.after(() => server.close());

  await jsonRequest(`${url}/api/editor/leagues`, "editor-token", { method: "POST", body: league() });
  await jsonRequest(`${url}/api/editor/clubs`, "editor-token", {
    method: "POST",
    body: {
      ...club(),
      crestImageUrl: "https://cdn.example.com/aurora.webp",
      crestImagePath: "editor-media/clubs/aurora/crest.webp",
    },
  });
  await jsonRequest(`${url}/api/editor/clubs`, "editor-token", {
    method: "POST",
    body: { ...club("BOR"), name: "Boreal FC", leagueId: "BR-A" },
  });
  await jsonRequest(`${url}/api/editor/tournaments`, "editor-token", {
    method: "POST",
    body: {
      ...tournament("COPA-AUR", ["AUR", "BOR"]),
      active: true,
      trophyImageUrl: "https://cdn.example.com/copa.webp",
      trophyImagePath: "editor-media/tournaments/copa/trophy.webp",
    },
  });
  await jsonRequest(`${url}/api/editor/tournaments`, "editor-token", {
    method: "POST",
    body: { ...tournament("ARQUIVADO"), name: "Torneio Arquivado" },
  });

  const response = await jsonRequest(`${url}/api/tournaments`, "editor-token");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.count, 1);
  assert.equal(payload.source, "firestore");
  assert.deepEqual(payload.tournaments.map((item) => item.id), ["COPA-AUR"]);
  assert.equal(payload.tournaments[0].trophyImageUrl, "https://cdn.example.com/copa.webp");
  assert.equal(payload.tournaments[0].participants[0].id, "AUR");
  assert.equal(payload.tournaments[0].participants[0].crestImageUrl, "https://cdn.example.com/aurora.webp");
  assert.equal(payload.tournaments[0].participants[0].darkThemeColor, "#e7e7e7");
  assert.equal(payload.tournaments[0].participants[0].lightThemeColor, "#171a17");
  assert.deepEqual(firestore.operations.getAll.at(-1), [
    "catalogDatabases/uid-editor/brasfootClubs/AUR",
    "catalogDatabases/uid-editor/brasfootClubs/BOR",
  ]);
  assert.equal(
    firestore.operations.queries.some((operation) => (
      operation.collectionName === "catalogDatabases/uid-editor/brasfootClubs"
    )),
    false,
  );
  const isolated = await (await jsonRequest(`${url}/api/tournaments`, "intruder-token")).json();
  assert.equal(isolated.count, 0);
  assert.equal((await fetch(`${url}/api/tournaments`)).status, 401);
});

test("integridade bloqueia referencias inexistentes e exclusao de pais em uso", async (context) => {
  const firestore = fakeFirestore();
  const { server, url } = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { ALLOW_LOCAL_EDITOR: "true" },
  });
  context.after(() => server.close());

  const missingLeague = await jsonRequest(`${url}/api/editor/clubs`, "owner-token", {
    method: "POST",
    body: club("SEM-LIGA", "NAO-EXISTE"),
  });
  assert.equal(missingLeague.status, 409);
  assert.equal((await missingLeague.json()).error.code, "EDITOR_REFERENCE_NOT_FOUND");

  await jsonRequest(`${url}/api/editor/leagues`, "owner-token", { method: "POST", body: league() });
  await jsonRequest(`${url}/api/editor/clubs`, "owner-token", { method: "POST", body: club() });

  const incompleteActiveTournament = await jsonRequest(`${url}/api/editor/tournaments`, "owner-token", {
    method: "POST",
    body: { ...tournament("INCOMPLETO"), active: true },
  });
  assert.equal(incompleteActiveTournament.status, 400);

  await jsonRequest(`${url}/api/editor/clubs`, "owner-token", {
    method: "POST",
    body: { ...club("INATIVO"), name: "Clube Inativo", active: false },
  });
  const inactiveParticipant = await jsonRequest(`${url}/api/editor/tournaments`, "owner-token", {
    method: "POST",
    body: { ...tournament("TIME-INATIVO", ["AUR", "INATIVO"]), active: true },
  });
  assert.equal(inactiveParticipant.status, 409);
  assert.equal((await inactiveParticipant.json()).error.code, "EDITOR_TOURNAMENT_CLUB_INACTIVE");

  const missingTournamentClub = await jsonRequest(`${url}/api/editor/tournaments`, "owner-token", {
    method: "POST",
    body: tournament("SEM-TIME", ["NAO-EXISTE"]),
  });
  assert.equal(missingTournamentClub.status, 409);
  assert.equal((await missingTournamentClub.json()).error.code, "EDITOR_REFERENCE_NOT_FOUND");

  await jsonRequest(`${url}/api/editor/tournaments`, "owner-token", {
    method: "POST",
    body: tournament(),
  });

  await jsonRequest(`${url}/api/editor/clubs`, "owner-token", {
    method: "POST",
    body: { ...club("BOR"), name: "Boreal FC" },
  });
  await jsonRequest(`${url}/api/editor/tournaments`, "owner-token", {
    method: "POST",
    body: { ...tournament("ATIVO", ["AUR", "BOR"]), active: true },
  });
  const archiveActiveParticipant = await jsonRequest(`${url}/api/editor/clubs/BOR`, "owner-token", {
    method: "PATCH",
    body: { active: false },
  });
  assert.equal(archiveActiveParticipant.status, 409);
  assert.equal((await archiveActiveParticipant.json()).error.code, "EDITOR_CLUB_IN_ACTIVE_TOURNAMENT");

  const missingClub = await jsonRequest(`${url}/api/editor/players`, "owner-token", {
    method: "POST",
    body: player("SEM-CLUBE", "NAO-EXISTE"),
  });
  assert.equal(missingClub.status, 409);
  assert.equal((await missingClub.json()).error.code, "EDITOR_REFERENCE_NOT_FOUND");

  await jsonRequest(`${url}/api/editor/players`, "owner-token", { method: "POST", body: player() });
  const leagueInUse = await jsonRequest(`${url}/api/editor/leagues/BR-A`, "owner-token", { method: "DELETE" });
  assert.equal(leagueInUse.status, 409);
  assert.equal((await leagueInUse.json()).error.code, "EDITOR_LEAGUE_IN_USE");
  const clubInUse = await jsonRequest(`${url}/api/editor/clubs/AUR`, "owner-token", { method: "DELETE" });
  assert.equal(clubInUse.status, 409);
  assert.equal((await clubInUse.json()).error.code, "EDITOR_CLUB_IN_TOURNAMENT");

  await jsonRequest(`${url}/api/editor/tournaments/COPA-AUR`, "owner-token", { method: "DELETE" });
  await jsonRequest(`${url}/api/editor/tournaments/ATIVO`, "owner-token", { method: "DELETE" });
  const clubWithPlayer = await jsonRequest(`${url}/api/editor/clubs/AUR`, "owner-token", { method: "DELETE" });
  assert.equal(clubWithPlayer.status, 409);
  assert.equal((await clubWithPlayer.json()).error.code, "EDITOR_CLUB_IN_USE");
  await jsonRequest(`${url}/api/editor/players/AUR-9`, "owner-token", { method: "DELETE" });
  assert.equal((await jsonRequest(`${url}/api/editor/clubs/AUR`, "owner-token", { method: "DELETE" })).status, 200);
  assert.equal((await jsonRequest(`${url}/api/editor/clubs/BOR`, "owner-token", { method: "DELETE" })).status, 200);
  assert.equal((await jsonRequest(`${url}/api/editor/clubs/INATIVO`, "owner-token", { method: "DELETE" })).status, 200);
  assert.equal((await jsonRequest(`${url}/api/editor/leagues/BR-A`, "owner-token", { method: "DELETE" })).status, 200);
});

test("upload de midia valida, associa ao registro e substitui o objeto anterior", async (context) => {
  const firestore = fakeFirestore();
  const bucket = fakeBucket();
  const catalogStore = new CatalogStore({
    firestore,
    now: () => new Date("2026-07-12T16:00:00.000Z"),
  });
  const { server, url } = await startTestServer({
    firebase: fakeFirebase({ firestore, bucket }),
    catalogStore,
    env: { NODE_ENV: "production" },
  });
  context.after(() => server.close());

  await jsonRequest(`${url}/api/editor/leagues`, "editor-token", { method: "POST", body: league() });
  await jsonRequest(`${url}/api/editor/clubs`, "editor-token", { method: "POST", body: club() });
  await jsonRequest(`${url}/api/editor/players`, "editor-token", { method: "POST", body: player() });
  await jsonRequest(`${url}/api/editor/tournaments`, "editor-token", { method: "POST", body: tournament() });

  const { png, jpeg, webp } = await import("./helpers/imageFixtures.mjs");
  const uploadEntity = ({
    entity = "clubs",
    recordId = "AUR",
    kind = "crest",
    body = png,
    contentType = "image/png",
    token = "editor-token",
  } = {}) => fetch(
    `${url}/api/editor/media?entity=${entity}&id=${encodeURIComponent(recordId)}&kind=${kind}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": contentType },
      body,
    },
  );

  const firstResponse = await uploadEntity();
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.match(first.media.path, /^editor-media\/clubs\/v2\/[a-f0-9]{24}\/[a-f0-9]{24}\/[a-f0-9-]+\.png$/);
  assert.equal(first.record.crestImagePath, first.media.path);
  assert.equal(first.record.crestImageUrl, first.media.url);
  assert.equal(first.previousMediaRemoved, true);
  assert.equal(bucket.saved.has(first.media.path), true);
  const firstMetadata = bucket.saved.get(first.media.path).options.metadata;
  assert.equal(firstMetadata.contentType, "image/png");
  assert.equal(firstMetadata.metadata.uploadedBy, "uid-editor");
  assert.equal(firstMetadata.metadata.mediaKind, "crest");

  const catalogAfterFirst = await (await jsonRequest(`${url}/api/editor/catalog`, "editor-token")).json();
  assert.equal(catalogAfterFirst.clubs[0].crestImagePath, first.media.path);

  const secondResponse = await uploadEntity();
  assert.equal(secondResponse.status, 201);
  const second = await secondResponse.json();
  assert.notEqual(second.media.path, first.media.path);
  assert.equal(second.record.crestImagePath, second.media.path);
  assert.equal(bucket.saved.has(first.media.path), false);
  assert.ok(bucket.deleted.includes(first.media.path));

  const playerImageResponse = await uploadEntity({
    entity: "players",
    recordId: "AUR-9",
    kind: "avatar",
    body: jpeg,
    contentType: "image/jpeg",
  });
  assert.equal(playerImageResponse.status, 201);
  const playerImage = await playerImageResponse.json();
  assert.equal(playerImage.record.avatarImagePath, playerImage.media.path);
  assert.match(playerImage.media.path, /\.jpg$/);

  for (const id of ["AUR-10", "AUR-11"]) {
    await jsonRequest(`${url}/api/editor/players`, "editor-token", {
      method: "POST",
      body: { ...player(id), name: `Jogador ${id}` },
    });
  }
  const deleteImageResponse = await uploadEntity({
    entity: "players", recordId: "AUR-10", kind: "avatar", body: jpeg, contentType: "image/jpeg",
  });
  const deleteImage = await deleteImageResponse.json();
  const deletePlayer = await jsonRequest(`${url}/api/editor/players/AUR-10`, "editor-token", { method: "DELETE" });
  assert.equal(deletePlayer.status, 200);
  assert.equal((await deletePlayer.json()).mediaRemoved, true);
  assert.equal(bucket.saved.has(deleteImage.media.path), false);

  const failedDeleteImageResponse = await uploadEntity({
    entity: "players", recordId: "AUR-11", kind: "avatar", body: jpeg, contentType: "image/jpeg",
  });
  const failedDeleteImage = await failedDeleteImageResponse.json();
  bucket.failNextDelete = true;
  const deletePlayerWithStorageFailure = await jsonRequest(
    `${url}/api/editor/players/AUR-11`,
    "editor-token",
    { method: "DELETE" },
  );
  assert.equal(deletePlayerWithStorageFailure.status, 200);
  assert.equal((await deletePlayerWithStorageFailure.json()).mediaRemoved, false);
  assert.equal(bucket.saved.has(failedDeleteImage.media.path), true);

  const trophyResponse = await uploadEntity({
    entity: "tournaments",
    recordId: "COPA-AUR",
    kind: "trophy",
    body: webp,
    contentType: "image/webp",
  });
  assert.equal(trophyResponse.status, 201);
  const trophy = await trophyResponse.json();
  assert.equal(trophy.record.trophyImageUrl, trophy.media.url);
  assert.match(trophy.media.path, /\.webp$/);

  const removePlayer = await fetch(
    `${url}/api/editor/media?entity=players&id=AUR-9&kind=avatar`,
    { method: "DELETE", headers: { authorization: "Bearer editor-token" } },
  );
  assert.equal(removePlayer.status, 200);
  const removedPlayer = await removePlayer.json();
  assert.equal(removedPlayer.record.avatarImageUrl, null);
  assert.equal(removedPlayer.record.avatarImagePath, null);
  assert.equal(removedPlayer.mediaRemoved, true);
  assert.equal(bucket.saved.has(playerImage.media.path), false);

  bucket.failNextDelete = true;
  const removeTrophy = await fetch(
    `${url}/api/editor/media?entity=tournaments&id=COPA-AUR&kind=trophy`,
    { method: "DELETE", headers: { authorization: "Bearer editor-token" } },
  );
  assert.equal(removeTrophy.status, 200);
  const removedTrophy = await removeTrophy.json();
  assert.equal(removedTrophy.record.trophyImageUrl, null);
  assert.equal(removedTrophy.record.trophyImagePath, null);
  assert.equal(removedTrophy.mediaRemoved, false);
  assert.equal(bucket.saved.has(trophy.media.path), true);

  const savedCount = bucket.saved.size;
  const missing = await uploadEntity({ recordId: "SEM-REGISTRO" });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "EDITOR_RECORD_NOT_FOUND");
  assert.equal(bucket.saved.size, savedCount);

  const forbidden = await uploadEntity({ token: "intruder-token" });
  assert.equal(forbidden.status, 404);
  assert.equal((await forbidden.json()).error.code, "EDITOR_RECORD_NOT_FOUND");
  assert.equal(bucket.saved.size, savedCount);

  const unsupported = await uploadEntity({ body: Buffer.from("gif"), contentType: "image/gif" });
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).error.code, "EDITOR_MEDIA_MIME_UNSUPPORTED");

  const mismatch = await uploadEntity({ body: Buffer.from("not a png") });
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, "EDITOR_MEDIA_MIME_MISMATCH");

  const tooLarge = await uploadEntity({ body: Buffer.alloc(MAX_EDITOR_MEDIA_BYTES + 1) });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, "EDITOR_MEDIA_TOO_LARGE");

  bucket.failNextSave = true;
  const storageFailure = await uploadEntity();
  assert.equal(storageFailure.status, 502);
  const storageFailureBody = await storageFailure.json();
  assert.equal(storageFailureBody.error.code, "EDITOR_MEDIA_UPLOAD_FAILED");
  assert.equal(storageFailureBody.error.message, "Firebase Storage nao conseguiu salvar a imagem");

  const withoutStorage = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    catalogStore,
    env: { NODE_ENV: "production" },
  });
  context.after(() => withoutStorage.server.close());
  const unavailable = await fetch(
    `${withoutStorage.url}/api/editor/media?entity=clubs&id=AUR&kind=crest`,
    {
      method: "POST",
      headers: { authorization: "Bearer editor-token", "content-type": "image/png" },
      body: png,
    },
  );
  assert.equal(unavailable.status, 503);
  const unavailableBody = await unavailable.json();
  assert.equal(unavailableBody.error.code, "EDITOR_MEDIA_STORAGE_UNAVAILABLE");
  assert.equal(unavailableBody.error.message, "Firebase Storage nao esta configurado no servidor");
});

test("valida campos e retorna 503 tipado quando Firestore nao esta configurado", async (context) => {
  const firestore = fakeFirestore();
  const validServer = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { ALLOW_LOCAL_EDITOR: "true" },
  });
  context.after(() => validServer.server.close());

  const invalidId = await jsonRequest(`${validServer.url}/api/editor/leagues`, "owner-token", {
    method: "POST",
    body: league("BR/A"),
  });
  assert.equal(invalidId.status, 400);
  assert.equal((await invalidId.json()).error.code, "VALIDATION_ERROR");
  const invalidPlayer = await jsonRequest(`${validServer.url}/api/editor/players`, "owner-token", {
    method: "POST",
    body: { ...player(), age: 8, attributes: { ...player().attributes, chute: 50 } },
  });
  assert.equal(invalidPlayer.status, 400);

  const invalidPosition = await jsonRequest(`${validServer.url}/api/editor/players`, "owner-token", {
    method: "POST",
    body: { ...player(), position: "Atacante" },
  });
  assert.equal(invalidPosition.status, 400);
  const incompleteAttributes = await jsonRequest(`${validServer.url}/api/editor/players`, "owner-token", {
    method: "POST",
    body: { ...player(), attributes: { velocidade: 10 } },
  });
  assert.equal(incompleteAttributes.status, 400);
  const extraAttribute = await jsonRequest(`${validServer.url}/api/editor/players`, "owner-token", {
    method: "POST",
    body: { ...player(), attributes: { ...player().attributes, reflexo: 20 } },
  });
  assert.equal(extraAttribute.status, 400);
  const invalidStar = await jsonRequest(`${validServer.url}/api/editor/players`, "owner-token", {
    method: "POST",
    body: { ...player(), isStar: "true" },
  });
  assert.equal(invalidStar.status, 400);

  for (const body of [
    { ...tournament(), teamIds: ["AUR", "AUR"] },
    { ...tournament(), legs: "single", tiebreakers: ["away_goals"] },
    { ...tournament(), tiebreakers: ["penalties", "extra_time"] },
    { ...tournament(), teamCount: 2, teamIds: ["A", "B", "C"] },
    { ...tournament(), active: true },
  ]) {
    const invalidTournament = await jsonRequest(`${validServer.url}/api/editor/tournaments`, "owner-token", {
      method: "POST",
      body,
    });
    assert.equal(invalidTournament.status, 400);
    assert.equal((await invalidTournament.json()).error.code, "VALIDATION_ERROR");
  }

  const noFirestore = await startTestServer({ env: { ALLOW_LOCAL_EDITOR: "true" } });
  context.after(() => noFirestore.server.close());
  const unavailable = await jsonRequest(`${noFirestore.url}/api/editor/catalog`, "owner-token");
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, "EDITOR_CATALOG_UNAVAILABLE");
});
