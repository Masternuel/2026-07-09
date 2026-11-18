import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createMarketRouter } from "../routes/market.mjs";
import { registerMarketHandlers } from "../sockets/marketHandlers.mjs";

const CODE = "BOLA-MKT1";
const REQUEST_ID = "request-market-1";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("cliente reutiliza requestId da mesma intencao ate o servidor confirmar", async () => {
  const source = await readFile(path.join(projectRoot, "src/hooks/useMarket.ts"), "utf8");
  assert.match(source, /requestIdsRef = useRef\(new Map<string, string>\(\)\)/);
  assert.match(source, /requestIdsRef\.current\.get\(intent\)/);
  assert.match(source, /requestIdsRef\.current\.set\(intent, requestId\)/);
  assert.match(source, /requestIdsRef\.current\.delete\(intent\)/);
  assert.match(source, /runIdempotentMutation\(`offer:/);
  assert.match(source, /runIdempotentMutation\(`bid:/);
});

function socketHarness(store, matchSessions = new Map()) {
  const events = [];
  const socket = new EventEmitter();
  socket.data = { user: { uid: "uid-owner", name: "Owner" }, roomCodes: [] };
  socket.join = (channel) => events.push(["join", channel]);
  socket.leave = (channel) => events.push(["leave", channel]);
  const io = {
    to(channel) {
      return {
        emit(event, payload) {
          events.push(["broadcast", channel, event, payload]);
        },
      };
    },
  };
  registerMarketHandlers(io, socket, { store, matchSessions });
  return { socket, events };
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

test("socket de mercado deriva manager do token, valida payload e transmite invalidacao apos ack", async () => {
  const calls = [];
  const snapshot = { revision: 7, listings: [], offers: [] };
  const store = {
    async getMarketSnapshot(code, uid) {
      calls.push(["sync", code, uid]);
      return snapshot;
    },
    async createMarketOffer(code, uid, input) {
      calls.push(["offer", code, uid, input]);
      return { snapshot: { ...snapshot, revision: 8 }, revision: 8, offer: { id: "offer-1" } };
    },
  };
  const { socket, events } = socketHarness(store);

  const synced = await emitWithAck(socket, "market:sync", { code: "bola-mkt1" });
  assert.deepEqual(synced, { ok: true, snapshot });
  assert.deepEqual(calls[0], ["sync", CODE, "uid-owner"]);
  assert.deepEqual(events, [["join", `room:${CODE}`]]);

  const order = [];
  const acknowledged = await new Promise((resolve) => socket.emit("market:offer", {
    code: CODE,
    requestId: REQUEST_ID,
    playerId: "player-1",
    dealType: "transfer",
    amount: 12_000_000,
    message: "Proposta",
  }, (response) => {
    order.push("ack");
    resolve(response);
  }));
  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.revision, 8);
  assert.equal(Object.hasOwn(acknowledged, "afterAcknowledgement"), false);
  assert.equal(calls[1][0], "offer");
  assert.equal(calls[1][2], "uid-owner");
  assert.equal(Object.hasOwn(calls[1][3], "managerId"), false);
  assert.deepEqual(order, ["ack"]);
  assert.equal(events.some(([kind]) => kind === "broadcast"), false);

  await nextTask();
  const broadcast = events.find(([kind]) => kind === "broadcast");
  assert.deepEqual(broadcast, [
    "broadcast",
    `room:${CODE}`,
    "market:updated",
    { code: CODE, revision: 8, reason: "offer" },
  ]);

  const forged = await emitWithAck(socket, "market:offer", {
    code: CODE,
    requestId: "request-market-2",
    managerId: "uid-intruder",
    playerId: "player-1",
    dealType: "transfer",
    amount: 12_000_000,
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.error.code, "VALIDATION_ERROR");
  assert.equal(calls.length, 2);
});

test("mutações do mercado ficam bloqueadas durante partida", async () => {
  let called = false;
  const store = {
    async createMarketListing() {
      called = true;
      return { revision: 2 };
    },
  };
  const { socket, events } = socketHarness(store, new Map([[CODE, { phase: "running" }]]));
  const response = await emitWithAck(socket, "market:list", {
    code: CODE,
    requestId: REQUEST_ID,
    playerId: "player-1",
    mode: "auction",
    dealType: "transfer",
    minimumBid: 5_000_000,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "MATCH_IN_PROGRESS");
  assert.equal(called, false);
  await nextTask();
  assert.equal(events.some(([kind]) => kind === "broadcast"), false);
});

test("rota GET usa snapshot privado do RoomStore", async (context) => {
  const calls = [];
  const snapshot = { revision: 3, finance: { available: 40_000_000 }, offers: [] };
  const store = {
    async getMarketSnapshot(code, uid) {
      calls.push([code, uid]);
      return snapshot;
    },
  };
  const app = express();
  app.use((request, _response, next) => {
    request.user = { uid: "uid-owner" };
    next();
  });
  app.use("/api/market", createMarketRouter(store));
  app.use((error, _request, response, _next) => {
    response.status(error.status ?? 500).json({ error: { code: error.code, message: error.message } });
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/market/bola-mkt1`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { snapshot });
  assert.deepEqual(calls, [[CODE, "uid-owner"]]);
});

test("market:sync transmite settlement lazy uma vez e nao cria loop de invalidacao", async () => {
  let syncCount = 0;
  const snapshot = { revision: 12, listings: [], offers: [] };
  const store = {
    async getMarketSnapshot(code, uid, options) {
      assert.equal(code, CODE);
      assert.equal(uid, "uid-owner");
      assert.deepEqual(options, { withMetadata: true });
      syncCount += 1;
      return { snapshot, settlementChanged: syncCount === 1 };
    },
  };
  const { socket, events } = socketHarness(store);

  const first = await emitWithAck(socket, "market:sync", { code: CODE });
  assert.deepEqual(first, { ok: true, snapshot });
  assert.equal(events.filter(([kind]) => kind === "broadcast").length, 0);
  await nextTask();
  assert.deepEqual(events.filter(([kind]) => kind === "broadcast"), [[
    "broadcast",
    `room:${CODE}`,
    "market:updated",
    { code: CODE, revision: 12, reason: "settlement" },
  ]]);

  const second = await emitWithAck(socket, "market:sync", { code: CODE });
  assert.deepEqual(second, { ok: true, snapshot });
  await nextTask();
  assert.equal(syncCount, 2);
  assert.equal(events.filter(([kind]) => kind === "broadcast").length, 1);
});
