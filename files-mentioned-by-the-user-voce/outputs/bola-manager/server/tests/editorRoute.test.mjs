import assert from "node:assert/strict";
import test from "node:test";
import { getServerConfig } from "../config.mjs";
import { MAX_EDITOR_MEDIA_BYTES } from "../services/catalogMedia.mjs";
import { CatalogStore } from "../store/catalogStore.mjs";
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
        operations.queries.push({ collectionName, filters: structuredClone(state.filters), maximum: state.maximum });
        const docs = matchingEntries().map(([id]) => snapshot(document(collectionName, id)));
        return { docs, empty: docs.length === 0 };
      },
    };
  };
  const firestore = {
    operations,
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
      return operation({
        async get(target) {
          return target.get();
        },
        async getAll(...references) {
          operations.getAll.push(references.map((reference) => `${reference.collectionName}/${reference.id}`));
          return references.map(snapshot);
        },
        set(reference, value) {
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
    stadium: "Estadio Aurora",
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

test("Editor preserva claim booleano, aceita UID configurado e nega demais em producao", async (context) => {
  const firestore = fakeFirestore();
  const { server, url } = await startTestServer({
    firebase: fakeFirebase({ firestore }),
    env: { NODE_ENV: "production", EDITOR_ADMIN_UIDS: "uid-admin", ALLOW_LOCAL_EDITOR: "true" },
  });
  context.after(() => server.close());

  for (const token of ["editor-token", "admin-token"]) {
    const response = await jsonRequest(`${url}/api/editor/access`, token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { canEdit: true });
  }

  for (const token of ["owner-token", "string-editor-token"]) {
    const access = await jsonRequest(`${url}/api/editor/access`, token);
    assert.deepEqual(await access.json(), { canEdit: false });
    const catalog = await jsonRequest(`${url}/api/editor/catalog`, token);
    assert.equal(catalog.status, 403);
    assert.equal((await catalog.json()).error.code, "EDITOR_FORBIDDEN");
  }
});

test("bypass local exige flag explicita e nunca libera demo", async (context) => {
  const firestore = fakeFirestore();
  const closedServer = await startTestServer({ firebase: fakeFirebase({ firestore }) });
  context.after(() => closedServer.server.close());
  assert.deepEqual(
    await (await jsonRequest(`${closedServer.url}/api/editor/access`, "owner-token")).json(),
    { canEdit: false },
  );
  assert.equal(
    (await jsonRequest(`${closedServer.url}/api/editor/catalog`, "owner-token")).status,
    403,
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
    if (entity === "players") assert.equal(record.isStar, false);
    if (entity === "clubs") assert.equal(record.crestImagePath, null);
    if (entity === "players") assert.equal(record.avatarImagePath, null);
    if (entity === "tournaments") assert.equal(record.trophyImagePath, null);
  }

  const catalog = await (await jsonRequest(`${url}/api/editor/catalog`, "owner-token")).json();
  assert.deepEqual(catalog.leagues.map((record) => record.id), ["BR-A"]);
  assert.deepEqual(catalog.clubs.map((record) => record.id), ["AUR"]);
  assert.deepEqual(catalog.players.map((record) => record.id), ["AUR-9"]);
  assert.deepEqual(catalog.tournaments.map((record) => record.id), ["COPA-AUR"]);
  assert.deepEqual(catalog.meta.players, {
    count: 1,
    returned: 1,
    limit: 50,
    nextCursor: null,
    hasMore: false,
    filters: { query: null, clubId: null },
  });

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

  const response = await jsonRequest(`${url}/api/tournaments`, "intruder-token");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.count, 1);
  assert.equal(payload.source, "firestore");
  assert.deepEqual(payload.tournaments.map((item) => item.id), ["COPA-AUR"]);
  assert.equal(payload.tournaments[0].trophyImageUrl, "https://cdn.example.com/copa.webp");
  assert.equal(payload.tournaments[0].participants[0].id, "AUR");
  assert.equal(payload.tournaments[0].participants[0].crestImageUrl, "https://cdn.example.com/aurora.webp");
  assert.deepEqual(firestore.operations.getAll.at(-1), ["brasfootClubs/AUR", "brasfootClubs/BOR"]);
  assert.equal(
    firestore.operations.queries.some((operation) => operation.collectionName === "brasfootClubs"),
    false,
  );
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

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xd9]);
  const webp = Buffer.from("RIFF0000WEBP", "ascii");
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
  assert.match(first.media.path, /^editor-media\/clubs\/[a-f0-9]{24}\/[a-f0-9-]+\.png$/);
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
  assert.equal(forbidden.status, 403);
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
