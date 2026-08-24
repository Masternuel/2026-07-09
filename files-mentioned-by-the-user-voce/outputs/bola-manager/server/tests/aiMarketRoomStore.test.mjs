import assert from "node:assert/strict";
import test from "node:test";
import { assertMarketIntegrity, ensureMarketState } from "../game/market.mjs";
import { resolveServerFixture } from "../game/fixtures.mjs";
import { listRoomPlayers } from "../game/roomRoster.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

const NOW = new Date("2026-07-18T12:00:00.000Z");
const MANAGER_ID = "human-manager";

function aiMarketCatalog() {
  const clubs = Array.from({ length: 6 }, (_, index) => ({
    id: `C${index + 1}`,
    name: `Clube ${index + 1}`,
    code: `C${index + 1}`,
    reputation: 12 + index,
    budget: 200_000_000,
    leagueId: "TEST-AI",
  }));
  const positions = ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MEI", "PD", "ATA", "PE"];
  const players = clubs.flatMap((club, clubIndex) => Array.from({ length: 20 }, (_, index) => ({
    id: `${club.id}-P${index + 1}`,
    clubId: club.id,
    currentClubId: club.id,
    ownerClubId: club.id,
    name: `${club.name} Jogador ${index + 1}`,
    position: positions[index % positions.length],
    age: 19 + (index % 13),
    overall: 9 + ((clubIndex + index) % 8),
    marketValue: 5_000_000 + ((clubIndex + index) % 8) * 1_000_000,
    wage: 30_000 + index * 1_000,
    active: true,
  })));
  const league = {
    id: "TEST-AI",
    name: "Liga IA",
    country: "Brasil",
    division: "Serie A",
    legs: "double",
    active: true,
    clubs,
  };
  return {
    league,
    players,
    async listCompetitionCatalog() {
      return [structuredClone(league)];
    },
    async listPlayers(clubId) {
      return {
        players: structuredClone(players.filter((player) => player.clubId === clubId)),
        count: players.filter((player) => player.clubId === clubId).length,
      };
    },
  };
}

async function setupRoom({ transferWindowOpen = true } = {}) {
  const persistence = new MemoryRoomPersistence();
  const catalog = aiMarketCatalog();
  const options = {
    persistence,
    catalogStore: catalog,
    codeFactory: () => "BOLA-AIMK",
    now: () => NOW,
  };
  const store = new RoomStore(options);
  const created = await store.createRoom({
    name: "Mercado autonomo",
    creatorId: MANAGER_ID,
    creatorName: "Humano",
    clubId: "C1",
    activeLeagues: ["TEST-AI"],
    seasonLength: 2,
    maxManagers: 1,
  });
  await store.setReady(created.code, MANAGER_ID, true);
  let room = await store.startRoom(created.code, MANAGER_ID);
  if (!transferWindowOpen) {
    await persistence.mutate(room.code, (current) => ({ ...current, transferWindowOpen: false }));
    room = await store.requireRoom(room.code);
  }
  return {
    catalog,
    persistence,
    room,
    store,
    reload: () => new RoomStore({ ...options, codeFactory: () => "BOLA-RLD2" }),
  };
}

async function playThroughRoundFour(store, initialRoom) {
  let room = initialRoom;
  for (let index = 0; index < 4; index += 1) {
    const fixture = resolveServerFixture(room);
    assert.ok(fixture);
    const completion = await store.completeMatch(room.code, fixture.fixtureId, {
      id: `human-ai-market-${index + 1}`,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      score: [1, 0],
      statistics: { home: { possession: 51 }, away: { possession: 49 } },
      skipped: false,
    });
    room = completion.room;
  }
  return room;
}

test("tick de mercado transfere somente entre IAs, usa invariantes e persiste no RoomStore", async () => {
  const harness = await setupRoom();
  const afterRoundFour = await playThroughRoundFour(harness.store, harness.room);
  const state = ensureMarketState(afterRoundFour, NOW);

  assert.equal(state.transactions.length, 1);
  const transaction = state.transactions[0];
  assert.equal(transaction.source, "ai");
  assert.notEqual(transaction.fromClubId, "C1");
  assert.notEqual(transaction.toClubId, "C1");
  assert.notEqual(transaction.fromClubId, transaction.toClubId);
  assert.equal(state.lastAiTransferTick.status, "completed");
  assert.equal(state.lastAiTransferTick.round, 4);
  assertMarketIntegrity(afterRoundFour, transaction.player.id, { transactionId: transaction.id });

  const persisted = await harness.persistence.get(afterRoundFour.code);
  const reloadedStore = harness.reload();
  const reloaded = await reloadedStore.requireRoom(afterRoundFour.code);
  assert.deepEqual(reloaded.marketState.transactions, persisted.marketState.transactions);
  assert.equal(reloaded.marketState.transactions[0].id, transaction.id);
  assertMarketIntegrity(reloaded, transaction.player.id, { transactionId: transaction.id });

  const [sellerRoster, buyerRoster, humanRoster] = await Promise.all([
    listRoomPlayers(harness.catalog, reloaded, transaction.fromClubId),
    listRoomPlayers(harness.catalog, reloaded, transaction.toClubId),
    listRoomPlayers(harness.catalog, reloaded, "C1"),
  ]);
  assert.equal(sellerRoster.players.some((player) => player.id === transaction.player.id), false);
  assert.equal(buyerRoster.players.filter((player) => player.id === transaction.player.id).length, 1);
  assert.equal(humanRoster.players.filter((player) => !player.academy).length, 20);
  assert.equal(humanRoster.players.some((player) => player.id === transaction.player.id), false);
});

test("janela fechada nao cria transferencia nem bloqueia o avanco da quarta rodada", async () => {
  const harness = await setupRoom({ transferWindowOpen: false });
  const afterRoundFour = await playThroughRoundFour(harness.store, harness.room);
  const state = ensureMarketState(afterRoundFour, NOW);

  assert.equal(afterRoundFour.completedMatches.length, 4);
  assert.equal(resolveServerFixture(afterRoundFour)?.round, 5);
  assert.equal(state.transactions.length, 0);
  assert.equal(state.lastAiTransferTick.status, "window-closed");
  assert.equal(state.lastAiTransferTick.round, 4);
});
