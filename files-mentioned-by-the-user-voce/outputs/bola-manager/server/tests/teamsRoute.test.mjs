import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createTeamsRouter } from "../routes/teams.mjs";

async function startTeamsServer(firestore, catalogStore) {
  const app = express();
  app.use("/api/teams", createTeamsRouter(firestore, catalogStore));
  app.use((error, _request, response, _next) => {
    response.status(error.status ?? 500).json({ error: { message: error.message } });
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

test("lista clubes com id canonico do documento e filtros validados", async (context) => {
  const calls = [];
  const query = {
    where(field, operator, value) {
      calls.push(["where", field, operator, value]);
      return this;
    },
    limit(value) {
      calls.push(["limit", value]);
      return this;
    },
    orderBy(field) {
      calls.push(["orderBy", String(field)]);
      return this;
    },
    startAfter(value) {
      calls.push(["startAfter", value]);
      return this;
    },
    async get() {
      return {
        docs: [{
          id: "santos-sp",
          data: () => ({
            id: "valor-adulterado",
            name: "Santos",
            abbreviation: "SAN",
            crestImageUrl: "https://cdn.example.com/santos.webp",
            crestImagePath: "editor-media/clubs/santos/crest.webp",
          }),
        }],
      };
    },
  };
  const firestore = {
    collection(name) {
      calls.push(["collection", name]);
      return query;
    },
  };
  const { server, url } = await startTeamsServer(firestore);
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${url}/api/teams?country=Brasil&division=Serie%20A&limit=1&cursor=anterior`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    teams: [{
      id: "santos-sp",
      name: "Santos",
      abbreviation: "SAN",
      crestImageUrl: "https://cdn.example.com/santos.webp",
      crestImagePath: "editor-media/clubs/santos/crest.webp",
    }],
    count: 1,
    nextCursor: "santos-sp",
    source: "firestore",
  });
  assert.deepEqual(calls, [
    ["collection", "brasfootClubs"],
    ["where", "country", "==", "Brasil"],
    ["where", "division", "==", "Serie A"],
    ["orderBy", "__name__"],
    ["startAfter", "anterior"],
    ["limit", 1],
  ]);
});

test("informa catalogo ausente sem Firestore", async (context) => {
  const { server, url } = await startTeamsServer(null);
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${url}/api/teams`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    teams: [],
    count: 0,
    nextCursor: null,
    source: "brasfoot-not-loaded",
  });
});

test("omite clubes arquivados e mantem registros legados sem active", async (context) => {
  const query = {
    orderBy() { return this; },
    limit() { return this; },
    async get() {
      return {
        docs: [
          { id: "ativo", data: () => ({ name: "Ativo", active: true }) },
          { id: "arquivado", data: () => ({ name: "Arquivado", active: false }) },
          { id: "legado", data: () => ({ name: "Legado" }) },
        ],
      };
    },
  };
  const { server, url } = await startTeamsServer({ collection: () => query });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${url}/api/teams`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.teams.map((team) => team.id), ["ativo", "legado"]);
  assert.equal(payload.count, 2);
});

test("expoe impacto de estrelas e devolve zeros quando o catalogo esta ausente", async (context) => {
  const expectedImpact = {
    clubId: "AUR",
    catalogPlayerCount: 4,
    starCount: 2,
    starPlayers: [{ id: "p1", name: "Craque" }, { id: "p2", name: "Camisa 10" }],
    playingStarCount: 2,
    playingStarPlayers: [{ id: "p1", name: "Craque" }, { id: "p2", name: "Camisa 10" }],
    matchStrengthBonus: 0.5,
    sponsorBoostPercent: 10,
    sponsorAnnualBonus: 5_000_000,
    source: "firestore",
  };
  const loaded = await startTeamsServer({}, {
    source: "firestore",
    async getStarImpact(clubId) {
      assert.equal(clubId, "AUR");
      return expectedImpact;
    },
  });
  context.after(() => new Promise((resolve) => loaded.server.close(resolve)));
  const response = await fetch(`${loaded.url}/api/teams/AUR/star-impact`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { impact: expectedImpact, source: "firestore" });

  const absent = await startTeamsServer(null);
  context.after(() => new Promise((resolve) => absent.server.close(resolve)));
  const fallback = await fetch(`${absent.url}/api/teams/AUR/star-impact`);
  assert.equal(fallback.status, 200);
  assert.deepEqual(await fallback.json(), {
    impact: {
      clubId: "AUR",
      catalogPlayerCount: 0,
      starCount: 0,
      starPlayers: [],
      playingStarCount: 0,
      playingStarPlayers: [],
      lineupSource: "deterministic-top11",
      matchStrengthBonus: 0,
      sponsorBoostPercent: 0,
      sponsorAnnualBonus: 0,
      source: "brasfoot-not-loaded",
    },
    source: "brasfoot-not-loaded",
  });

  const invalid = await fetch(`${absent.url}/api/teams/AUR%2FB/star-impact`);
  assert.equal(invalid.status, 400);
});

test("lista elenco ativo pelo endpoint com ordem e source fornecidos pelo catalogo", async (context) => {
  const players = [
    {
      id: "p2",
      clubId: "AUR",
      name: "Camisa 10",
      overall: 18,
      isStar: true,
      avatarImageUrl: "https://cdn.example.com/p2.webp",
      avatarImagePath: "editor-media/players/p2/avatar.webp",
    },
    { id: "p1", clubId: "AUR", name: "Volante", overall: 15, isStar: false },
  ];
  const loaded = await startTeamsServer({}, {
    async listPlayers(clubId) {
      assert.equal(clubId, "AUR");
      return { players, count: players.length, source: "firestore" };
    },
  });
  context.after(() => new Promise((resolve) => loaded.server.close(resolve)));

  const response = await fetch(`${loaded.url}/api/teams/AUR/players`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { players, count: 2, source: "firestore" });

  const absent = await startTeamsServer(null);
  context.after(() => new Promise((resolve) => absent.server.close(resolve)));
  assert.deepEqual(await (await fetch(`${absent.url}/api/teams/AUR/players`)).json(), {
    players: [], count: 0, source: "brasfoot-not-loaded",
  });
});
