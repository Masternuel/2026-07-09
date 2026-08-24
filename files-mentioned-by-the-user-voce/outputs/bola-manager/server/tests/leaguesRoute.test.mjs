import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createLeaguesRouter } from "../routes/leagues.mjs";
import { CatalogStore } from "../store/catalogStore.mjs";

function fakeFirestore(seed) {
  const collections = new Map(Object.entries(seed).map(([name, records]) => [
    name,
    new Map(records.map(({ id, ...record }) => [id, record])),
  ]));
  return {
    collection(name) {
      return {
        async get() {
          const docs = [...(collections.get(name) ?? [])].map(([id, record]) => ({
            id,
            data: () => structuredClone(record),
          }));
          return { docs, empty: docs.length === 0 };
        },
      };
    },
  };
}

function competitionFirestore() {
  return fakeFirestore({
    brasfootLeagues: [
      { id: "ENG-PL", name: "Liga Inglesa", country: "Inglaterra", level: 1, division: "Premier League", active: true },
      { id: "LEGACY", name: "Liga Legada", country: "Portugal", level: 1, division: "Primeira Liga" },
      { id: "ARCHIVED", name: "Liga Arquivada", country: "Brasil", level: 2, division: "Serie B", active: false },
    ],
    brasfootClubs: [
      { id: "CHE", name: "Chelsea", abbreviation: "CHE", colors: ["#034694"], darkThemeColor: "#66a3ff", lightThemeColor: "#034694", reputation: 18, budget: 180_000_000, stadium: "Stamford Bridge", stadiumCapacity: 40_341, crestImageUrl: "https://cdn.example.com/chelsea.png", leagueId: "ENG-PL", active: true },
      { id: "ARS", name: "Arsenal", abbreviation: "ARS", colors: ["#ef0107"], reputation: 17, stadium: "Emirates Stadium", stadiumCapacity: 60_704, leagueId: "eng-pl" },
      { id: "LIV", name: "Liverpool", abbreviation: "LIV", colors: ["#c8102e"], reputation: 18, leagueId: "ENG-PL", active: false },
      { id: "POR", name: "Porto", abbreviation: "POR", colors: ["#003da5"], reputation: 16, leagueId: "LEGACY", active: true },
      { id: "BAD", name: "Clube Arquivado", abbreviation: "BAD", colors: ["#111111"], reputation: 8, leagueId: "ARCHIVED", active: true },
    ],
  });
}

async function startLeaguesServer(catalogStore) {
  const app = express();
  app.use("/api/leagues", createLeaguesRouter(catalogStore));
  app.use((error, _request, response, _next) => {
    response.status(error.status ?? 500).json({ error: { message: error.message } });
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test("lista apenas ligas ativas, preserva legadas e conta clubes ativos", async () => {
  const store = new CatalogStore({ firestore: competitionFirestore() });
  assert.deepEqual(await store.listActiveLeagues(), {
    leagues: [
      { id: "ENG-PL", name: "Liga Inglesa", country: "Inglaterra", level: 1, division: "Premier League", active: true, clubCount: 2 },
      { id: "LEGACY", name: "Liga Legada", country: "Portugal", level: 1, division: "Primeira Liga", active: true, clubCount: 1 },
    ],
    count: 2,
    source: "firestore",
  });
  assert.deepEqual(await new CatalogStore().listActiveLeagues(), {
    leagues: [], count: 0, source: "brasfoot-not-loaded",
  });
});

test("monta snapshots por liga com somente clubes ativos e campos publicos", async () => {
  const store = new CatalogStore({ firestore: competitionFirestore() });
  assert.deepEqual(await store.listCompetitionCatalog(["eng-pl", "ARCHIVED"]), [{
    id: "ENG-PL",
    name: "Liga Inglesa",
    country: "Inglaterra",
    level: 1,
    division: "Premier League",
    legs: "double",
    clubs: [
      { id: "ARS", name: "Arsenal", code: "ARS", color: "#ef0107", reputation: 17, budget: 0, stadium: "Emirates Stadium", stadiumCapacity: 60_704, crestImageUrl: null, leagueId: "ENG-PL" },
      { id: "CHE", name: "Chelsea", code: "CHE", color: "#034694", darkThemeColor: "#66a3ff", lightThemeColor: "#034694", reputation: 18, budget: 180_000_000, stadium: "Stamford Bridge", stadiumCapacity: 40_341, crestImageUrl: "https://cdn.example.com/chelsea.png", leagueId: "ENG-PL" },
    ],
  }]);
  assert.deepEqual((await store.listCompetitionCatalog()).map((league) => league.id), ["ENG-PL", "LEGACY"]);
  assert.deepEqual(await store.listCompetitionCatalog([]), []);
  assert.deepEqual(await new CatalogStore().listCompetitionCatalog(), []);
});

test("GET / devolve listActiveLeagues sem alterar o contrato", async (context) => {
  const expected = {
    leagues: [{ id: "ENG-PL", name: "Liga Inglesa", active: true, clubCount: 2 }],
    count: 1,
    source: "firestore",
  };
  let calls = 0;
  const { server, url } = await startLeaguesServer({
    async listActiveLeagues() {
      calls += 1;
      return expected;
    },
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${url}/api/leagues`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  assert.equal(calls, 1);
});

test("membro da sala consulta a base do criador em vez da propria base", async (context) => {
  const resolvedOwners = [];
  const catalogs = {
    "uid-owner": {
      async ensureInitialized() {},
      async listActiveLeagues() {
        return { leagues: [{ id: "ES-1", name: "La Liga" }], count: 1, source: "firestore" };
      },
    },
    "uid-second": {
      async ensureInitialized() {},
      async listActiveLeagues() {
        return { leagues: [{ id: "BR-A", name: "Brasileirao" }], count: 1, source: "firestore" };
      },
    },
  };
  const catalogStore = {
    forOwner(ownerId) {
      resolvedOwners.push(ownerId);
      return catalogs[ownerId];
    },
  };
  const roomStore = {
    async requireMembership(code, userId) {
      assert.equal(code, "BOLA-SPAIN");
      if (userId !== "uid-second") {
        const error = new Error("Sala nao encontrada");
        error.status = 404;
        throw error;
      }
      return { code, ownerId: "uid-owner", catalogOwnerId: "uid-owner" };
    },
  };
  const app = express();
  app.use((request, _response, next) => {
    request.user = { uid: String(request.headers["x-test-user"] ?? "") };
    next();
  });
  app.use("/api/leagues", createLeaguesRouter(catalogStore, roomStore));
  app.use((error, _request, response, _next) => {
    response.status(error.status ?? 500).json({ error: { message: error.message } });
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/api/leagues`;

  const personal = await (await fetch(url, { headers: { "x-test-user": "uid-second" } })).json();
  assert.deepEqual(personal.leagues.map((league) => league.id), ["BR-A"]);
  const room = await (await fetch(`${url}?roomCode=BOLA-SPAIN`, {
    headers: { "x-test-user": "uid-second" },
  })).json();
  assert.deepEqual(room.leagues.map((league) => league.id), ["ES-1"]);
  assert.deepEqual(resolvedOwners, ["uid-second", "uid-owner"]);

  const denied = await fetch(`${url}?roomCode=BOLA-SPAIN`, {
    headers: { "x-test-user": "uid-intruder" },
  });
  assert.equal(denied.status, 404);
});
