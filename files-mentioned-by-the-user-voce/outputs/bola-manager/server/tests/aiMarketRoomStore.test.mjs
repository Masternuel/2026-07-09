import assert from "node:assert/strict";
import test from "node:test";
import { assertMarketIntegrity, ensureMarketState, MarketError, runAiTransferTick } from "../game/market.mjs";
import { createMetricsRegistry } from "../infrastructure/observability.mjs";
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

async function setupRoom({ transferWindowOpen = true, persistence = new MemoryRoomPersistence(), ...overrides } = {}) {
  const catalog = aiMarketCatalog();
  const options = {
    persistence,
    catalogStore: catalog,
    codeFactory: () => "BOLA-AIMK",
    now: () => NOW,
    ...overrides,
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

async function playThroughRoundFour(store, initialRoom, count = 4) {
  let room = initialRoom;
  for (let index = 0; index < count; index += 1) {
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

function observation() {
  const logs = [];
  const logger = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (event, fields) => logs.push({ level, event, ...fields })]));
  return { logs, logger, metrics: createMetricsRegistry() };
}

function nextCompletion(room) {
  const fixture = resolveServerFixture(room);
  return [room.code, fixture.fixtureId, {
    id: `market-round-${fixture.round}`, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
    score: [1, 0], statistics: { home: { possession: 51 }, away: { possession: 49 } }, skipped: false,
  }];
}

test("falha apos transferencia reverte negocio, salva partida e registra falha apos reload", async () => {
  const captured = observation();
  let partialDeal;
  let financesBefore;
  const harness = await setupRoom({ ...captured, aiMarketExecutor(current, input, now) {
    if (input.round !== 4) return runAiTransferTick(current, input, now);
    financesBefore = structuredClone(ensureMarketState(current, now).finances);
    const result = runAiTransferTick(current, input, now);
    partialDeal = structuredClone(current.marketState.transactions[0]);
    if (result.changed) throw new MarketError("private internal detail", "MARKET_INTEGRITY_HISTORY", 500);
    return result;
  } });
  const after = await playThroughRoundFour(harness.store, harness.room);
  assert.ok(partialDeal);
  assert.equal(after.completedMatches.length, 4);
  assert.equal(resolveServerFixture(after).round, 5);
  assert.equal(after.marketState.transactions.length, 0);
  assert.deepEqual(after.marketState.finances, financesBefore);
  assert.equal(after.marketState.registrations.some((entry) => entry.playerId === partialDeal.player.id), false);
  const receipt = after.marketState.aiTickRuns.at(-1);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.attemptCount, 1);
  assert.equal(receipt.error.category, "integrity");
  assert.equal(after.lastCompletedMatch.aiMarketTick.id, receipt.id);
  assert.equal(captured.logs.filter((event) => event.event === "ai_market.tick_finished" && event.status === "failed").length, 1);
  const reloaded = await harness.reload().requireRoom(after.code);
  assert.deepEqual(reloaded.marketState.aiTickRuns, after.marketState.aiTickRuns);
  assert.equal(reloaded.marketState.transactions.length, 0);
});

test("retry transiente apos negocio real nao duplica contratos nem debita duas vezes", async () => {
  const captured = observation();
  let attempts = 0;
  let balances;
  const harness = await setupRoom({ ...captured, aiMarketExecutor(current, input, now) {
    if (input.round === 4) {
      attempts += 1;
      const state = ensureMarketState(current, now);
      assert.equal(state.transactions.length, 0);
      if (attempts === 1) balances = structuredClone(state.finances);
      else assert.deepEqual(state.finances, balances);
    }
    const result = runAiTransferTick(current, input, now);
    if (input.round === 4 && attempts === 1) throw Object.assign(new Error("temporary"), { code: "ETIMEDOUT" });
    return result;
  } });
  const after = await playThroughRoundFour(harness.store, harness.room);
  assert.equal(attempts, 2);
  assert.equal(after.marketState.transactions.length, 1);
  assert.equal(after.marketState.aiTickRuns.at(-1).attemptCount, 2);
  assert.equal(after.marketState.aiTickRuns.at(-1).status, "succeeded");
  const transaction = after.marketState.transactions[0];
  assertMarketIntegrity(after, transaction.player.id, { transactionId: transaction.id });
  assert.equal(captured.metrics.snapshot().counters.find((entry) => entry.name === "ai_market_retries_total").value, 1);
});

class FaultingPersistence extends MemoryRoomPersistence {
  fault = null;
  async mutate(code, mutation) {
    const fault = this.fault;
    this.fault = null;
    if (fault === "replay" || fault === "before-commit") {
      mutation(await this.get(code));
      if (fault === "before-commit") throw Object.assign(new Error("write unavailable"), { code: "ETIMEDOUT" });
    }
    const result = await super.mutate(code, mutation);
    if (fault === "ack-lost") throw Object.assign(new Error("ACK lost"), { code: "ETIMEDOUT" });
    return result;
  }
}

test("callback CAS reexecutado nao duplica efeitos, recibos, logs ou metricas", async () => {
  const captured = observation();
  const persistence = new FaultingPersistence();
  let runs = 0;
  const harness = await setupRoom({ ...captured, persistence, aiMarketExecutor(...args) {
    if (args[1].round === 4) runs += 1;
    return runAiTransferTick(...args);
  } });
  const before = await playThroughRoundFour(harness.store, harness.room, 3);
  persistence.fault = "replay";
  const { room } = await harness.store.completeMatch(...nextCompletion(before));
  assert.equal(runs, 2);
  assert.equal(room.marketState.transactions.length, 1);
  assert.equal(room.marketState.aiTickRuns.filter((entry) => entry.round === 4).length, 1);
  assert.equal(captured.logs.filter((entry) => entry.event === "ai_market.tick_started" && entry.round === 4).length, 1);
  assert.equal(captured.metrics.snapshot().counters.find((entry) => entry.name === "ai_market_ticks_total" && entry.labels.status === "succeeded").value, 1);
});

test("falha de persistencia nao confirma mercado; retry aplica uma unica vez", async () => {
  const captured = observation();
  const persistence = new FaultingPersistence();
  const harness = await setupRoom({ ...captured, persistence });
  const before = await playThroughRoundFour(harness.store, harness.room, 3);
  const completion = nextCompletion(before);
  persistence.fault = "before-commit";
  await assert.rejects(harness.store.completeMatch(...completion), { code: "ETIMEDOUT" });
  const failedSave = await persistence.get(before.code);
  assert.equal(failedSave.completedMatches.length, 3);
  assert.equal(failedSave.marketState.transactions.length, 0);
  assert.equal(failedSave.marketState.aiTickRuns.length, 3);
  assert.equal(captured.logs.at(-1).event, "ai_market.commit_failed");
  assert.equal(captured.logs.filter((entry) => entry.event === "ai_market.tick_finished" && entry.round === 4).length, 0);
  const after = await harness.store.completeMatch(...completion);
  assert.equal(after.room.marketState.transactions.length, 1);
  assert.equal(after.room.marketState.aiTickRuns.length, 4);
});

test("ACK perdido depois do commit mantem recibo e impede repetir transferencia", async () => {
  const captured = observation();
  const persistence = new FaultingPersistence();
  const harness = await setupRoom({ ...captured, persistence });
  const before = await playThroughRoundFour(harness.store, harness.room, 3);
  const completion = nextCompletion(before);
  persistence.fault = "ack-lost";
  await assert.rejects(harness.store.completeMatch(...completion), { code: "ETIMEDOUT" });
  const reloaded = await harness.reload().requireRoom(before.code);
  assert.equal(reloaded.marketState.aiTickRuns.at(-1).status, "succeeded");
  assert.equal(reloaded.marketState.transactions.length, 1);
  assert.equal(captured.logs.at(-1).commitStatus, "unconfirmed");
  await assert.rejects(harness.store.completeMatch(...completion), { code: "FIXTURE_ALREADY_COMPLETED" });
  assert.equal((await persistence.get(before.code)).marketState.transactions.length, 1);
});

test("duas instancias concorrentes confirmam um unico tick", async () => {
  const captured = observation();
  const harness = await setupRoom(captured);
  const before = await playThroughRoundFour(harness.store, harness.room, 3);
  const completion = nextCompletion(before);
  const second = harness.reload();
  const results = await Promise.allSettled([harness.store.completeMatch(...completion), second.completeMatch(...completion)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const saved = await harness.persistence.get(before.code);
  assert.equal(saved.marketState.transactions.length, 1);
  assert.equal(saved.marketState.aiTickRuns.filter((entry) => entry.round === 4).length, 1);
  assert.equal(captured.logs.filter((entry) => entry.event === "ai_market.tick_finished" && entry.round === 4).length, 1);
});
