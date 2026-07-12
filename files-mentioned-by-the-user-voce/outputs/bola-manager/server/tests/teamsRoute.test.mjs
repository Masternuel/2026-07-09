import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createTeamsRouter } from "../routes/teams.mjs";

async function startTeamsServer(firestore) {
  const app = express();
  app.use("/api/teams", createTeamsRouter(firestore));
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
          data: () => ({ id: "valor-adulterado", name: "Santos", abbreviation: "SAN" }),
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
    teams: [{ id: "santos-sp", name: "Santos", abbreviation: "SAN" }],
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
