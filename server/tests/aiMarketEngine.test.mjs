import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMarketIntegrity,
  ensureMarketState,
  registrationForPlayer,
  runAiTransferTick,
  scoreAiMarketMethodPreference,
  scoreAiTransferFit,
} from "../game/market.mjs";

const NOW = new Date("2026-08-01T12:00:00.000Z");
const MILLION = 1_000_000;

function makePlayer(id, clubId, extra = {}) {
  return {
    id,
    clubId,
    currentClubId: clubId,
    ownerClubId: clubId,
    name: `Jogador ${id}`,
    position: "ATA",
    age: 24,
    overall: 12,
    potential: 14,
    marketValue: 8 * MILLION,
    wage: 25_000,
    active: true,
    ...extra,
  };
}

function makeRoom({
  freeAgent = false,
  seed = "room-ai-engine",
  maxSquadSize = 40,
  wageBudget = null,
  aiClubCount = 3,
} = {}) {
  const clubs = ["HUM", ...Array.from({ length: aiClubCount }, (_, index) => `AI${index + 1}`)]
    .map((id, index) => ({
    id,
    name: id,
    reputation: 12 + index,
    budget: 250 * MILLION,
  }));
  const players = clubs.flatMap((club) => Array.from({ length: 20 }, (_, index) => makePlayer(
    `${club.id}-P${index + 1}`,
    club.id,
    index === 0 ? { age: 20, potential: 17, overall: 11 } : {},
  )));
  const agent = makePlayer("FREE-1", null, {
    contract: { clubId: null, status: "free_agent", wage: 20_000 },
    ownerClubId: null,
    currentClubId: null,
  });
  return {
    room: {
      id: seed,
      code: seed,
      status: "active",
      currentSeason: 1,
      seasonTotalRounds: 38,
      transferWindowOpen: true,
      maxSquadSize,
      competitionCatalog: [{ id: "L1", name: "Liga", active: true, clubs }],
      managers: [{ id: "human", name: "Humano", clubId: "HUM" }],
      careerState: { players: [...players, ...(freeAgent ? [agent] : [])] },
      ...(wageBudget === null ? {} : {
        clubCareerState: {
          financeProfiles: clubs.map((club) => ({
            clubId: club.id,
            transferBudget: club.budget,
            wageBudget,
            financeLimitsVersion: 1,
          })),
        },
      }),
      playerStates: [],
      lineups: [],
      clubMoraleStates: [],
      playerCompetitionRegistrations: [],
    },
    players,
    agent,
  };
}

function tick(room, players, method = null, round = 1) {
  return runAiTransferTick(room, {
    players,
    seasonNumber: 1,
    round,
    leagueId: "L1",
    intervalRounds: 1,
    ...(method ? { preferredMethod: method } : {}),
  }, NOW);
}

function balances(room) {
  return Object.fromEntries(ensureMarketState(room, NOW).finances.map((finance) => [
    finance.clubId,
    finance.balance,
  ]));
}

function currentRoster(room, clubId) {
  return room.careerState.players.filter((player) => player.currentClubId === clubId);
}

test("score estrategico e metadados da negociacao sao deterministas e limitados", () => {
  const player = makePlayer("FIT", "AI1", { position: "ZAG", overall: 15, potential: 18 });
  const context = {
    buyerClub: { id: "AI2", reputation: 15 },
    buyerRoster: [makePlayer("ATA", "AI2")],
    availableBudget: 100 * MILLION,
    wageBudget: 5 * MILLION,
    currentPayroll: MILLION,
  };
  assert.deepEqual(scoreAiTransferFit(player, context), scoreAiTransferFit(player, context));
  const rich = { buyerClub: context.buyerClub, availableBudget: 200 * MILLION };
  const constrained = { buyerClub: { id: "AI3", reputation: 9 }, availableBudget: 2 * MILLION };
  assert.ok(
    scoreAiMarketMethodPreference("negotiation", player, rich)
      > scoreAiMarketMethodPreference("loan", player, rich),
  );
  assert.ok(
    scoreAiMarketMethodPreference("loan", player, constrained)
      > scoreAiMarketMethodPreference("negotiation", player, constrained),
  );
  assert.ok(
    scoreAiMarketMethodPreference("free-agent", player, constrained)
      > scoreAiMarketMethodPreference("auction", player, constrained),
  );

  const { room, players } = makeRoom();
  const result = tick(room, players, "negotiation");
  assert.equal(result.status, "completed", JSON.stringify(result));
  const transaction = ensureMarketState(room, NOW).transactions.at(-1);
  assert.equal(transaction.source, "ai");
  assert.equal(transaction.method, "negotiation");
  assert.equal(transaction.decisionMetadata.strategyVersion, 3);
  assert.equal(transaction.decisionMetadata.tickKey, result.tickKey);
  assert.ok(transaction.negotiationHistory.length >= 2);
  assert.ok(transaction.negotiationHistory.length <= 8);
  assert.ok(transaction.negotiationLimits.roundsUsed <= transaction.negotiationLimits.maxRounds);
  assert.ok(transaction.contractNegotiationHistory.length >= 2);
  assert.ok(transaction.contractNegotiationLimits.roundsUsed <= transaction.contractNegotiationLimits.maxRounds);
  const contractAcceptance = transaction.contractNegotiationHistory.findLast((step) => step.action === "accept");
  assert.equal(transaction.contractTerms.wage, contractAcceptance.wage);
  assert.equal(transaction.contractTerms.durationSeasons, contractAcceptance.durationSeasons);
  assert.notEqual(transaction.fromClubId, "HUM");
  assert.notEqual(transaction.toClubId, "HUM");
  assert.ok(transaction.decisionMetadata.competitionCount >= 2);
  assert.ok(transaction.competingContractOffers.length >= 2);
  assert.equal(
    transaction.competingContractOffers.find((offer) => offer.clubId === transaction.toClubId).offerScore,
    Math.max(...transaction.competingContractOffers.map((offer) => offer.offerScore)),
  );
  assertMarketIntegrity(room, transaction.player.id, { transactionId: transaction.id });
});

test("emprestimo autonomo preserva dono, move registro e persiste em JSON", () => {
  const { room, players } = makeRoom();
  const before = balances(room);
  const result = tick(room, players, "loan", 2);
  assert.equal(result.status, "completed");
  assert.equal(result.method, "loan");
  const transaction = ensureMarketState(room, NOW).transactions.at(-1);
  const registration = registrationForPlayer(room, transaction.player.id);
  assert.equal(transaction.dealType, "loan");
  assert.equal(registration.permanentClubId, transaction.fromClubId);
  assert.equal(registration.currentClubId, transaction.toClubId);
  assert.equal(registration.loan.borrowerClubId, transaction.toClubId);
  assert.ok(registration.loan.remainingRounds >= 3);
  assert.notEqual(transaction.fromClubId, "HUM");
  assert.notEqual(transaction.toClubId, "HUM");
  const after = balances(room);
  assert.equal(after[transaction.toClubId], before[transaction.toClubId] - transaction.amount);
  assert.equal(after[transaction.fromClubId], before[transaction.fromClubId] + transaction.amount);
  assert.equal(currentRoster(room, transaction.toClubId).length, 21);
  assert.equal(currentRoster(room, transaction.fromClubId).length, 19);

  const reloaded = JSON.parse(JSON.stringify(room));
  const restored = registrationForPlayer(reloaded, transaction.player.id);
  assert.deepEqual(restored, registration);
  assert.equal(ensureMarketState(reloaded, NOW).aiMarketHistory.at(-1).method, "loan");
  assertMarketIntegrity(reloaded, transaction.player.id, { transactionId: transaction.id });
});

test("agente livre recebe uma unica assinatura apesar de varios clubes concorrentes", () => {
  const { room, players, agent } = makeRoom({ freeAgent: true });
  const before = balances(room);
  const result = tick(room, players, "free-agent", 3);
  assert.equal(result.status, "completed");
  assert.equal(result.method, "free-agent");
  const state = ensureMarketState(room, NOW);
  const transaction = state.transactions.at(-1);
  assert.equal(transaction.fromClubId, null);
  assert.notEqual(transaction.toClubId, "HUM");
  assert.equal(state.transactions.filter((item) => item.player.id === agent.id).length, 1);
  assert.equal(registrationForPlayer(room, agent.id).currentClubId, transaction.toClubId);
  assert.ok(transaction.decisionMetadata.competitionCount >= 2);
  assert.ok(transaction.competingContractOffers.length >= 2);
  assert.equal(
    transaction.competingContractOffers.find((offer) => offer.clubId === transaction.toClubId).offerScore,
    Math.max(...transaction.competingContractOffers.map((offer) => offer.offerScore)),
  );
  assert.equal(balances(room)[transaction.toClubId], before[transaction.toClubId] - transaction.amount);

  const duplicate = tick(room, players, "free-agent", 3);
  assert.equal(duplicate.duplicate, true);
  const refreshed = ensureMarketState(room, NOW);
  assert.equal(refreshed.transactions.filter((item) => item.player.id === agent.id).length, 1);
  assert.equal(refreshed.aiMarketHistory.filter((item) => item.playerId === agent.id).length, 1);
});

test("leilao autonomo registra disputa auditavel sem envolver clube gerenciado", () => {
  const { room, players } = makeRoom();
  const before = balances(room);
  const result = tick(room, players, "auction", 4);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.method, "auction");
  const transaction = ensureMarketState(room, NOW).transactions.at(-1);
  assert.equal(transaction.method, "auction");
  assert.ok(transaction.listingId);
  assert.ok(transaction.auction.bidderCount >= 2);
  assert.equal(transaction.auction.bidCount, transaction.bidHistory.length);
  assert.ok(transaction.bidHistory.length <= transaction.auction.maxBids);
  assert.equal(transaction.bidHistory.at(-1).amount, transaction.amount);
  assert.equal(new Set(transaction.bidHistory.map((bid) => bid.bidderClubId)).size, transaction.auction.bidderCount);
  assert.notEqual(transaction.fromClubId, "HUM");
  assert.notEqual(transaction.toClubId, "HUM");
  assert.equal(transaction.decisionMetadata.method, "auction");
  const winnerMaximum = transaction.bidHistory.at(-1).maximumBid;
  const runnerUpMaximum = Math.max(...transaction.bidHistory.slice(0, -1).map((bid) => bid.maximumBid));
  assert.equal(transaction.amount, Math.min(
    winnerMaximum,
    Math.max(transaction.auction.reservePrice, runnerUpMaximum + transaction.auction.bidIncrement),
  ));
  const after = balances(room);
  assert.equal(after[transaction.toClubId], before[transaction.toClubId] - transaction.amount);
  assert.equal(after[transaction.fromClubId], before[transaction.fromClubId] + transaction.amount);
  assert.equal(
    ensureMarketState(room, NOW).activeListings.find((listing) => listing.id === transaction.listingId).status,
    "completed",
  );
  assertMarketIntegrity(room, transaction.player.id, { transactionId: transaction.id });
});

test("politica autonoma alcanca todos os metodos sem forcar o motor", () => {
  const methods = new Set();
  for (let index = 0; index < 64 && methods.size < 4; index += 1) {
    const { room, players } = makeRoom({ freeAgent: true, seed: `mix-${index}` });
    const result = tick(room, players, null, 5);
    if (result.status === "completed") methods.add(result.method);
  }
  assert.deepEqual([...methods].sort(), ["auction", "free-agent", "loan", "negotiation"]);
});

test("IA oferece e solicita emprestimos conforme sua estrategia", () => {
  const initiatives = new Set();
  for (let index = 0; index < 24 && initiatives.size < 2; index += 1) {
    const { room, players } = makeRoom({ seed: `loan-initiative-${index}` });
    const result = tick(room, players, "loan", 8);
    if (result.status === "completed") {
      initiatives.add(ensureMarketState(room, NOW).transactions.at(-1).decisionMetadata.initiative);
    }
  }
  assert.deepEqual([...initiatives].sort(), ["borrower-request", "lender-offer"]);
});

test("motor respeita limite de elenco e teto salarial reais", () => {
  const full = makeRoom({ maxSquadSize: 20, seed: "full-squads" });
  assert.equal(tick(full.room, full.players, "negotiation", 6).status, "no-deal");

  const capped = makeRoom({ wageBudget: 500_000, seed: "wage-capped" });
  assert.equal(tick(capped.room, capped.players, "negotiation", 7).status, "no-deal");
});

test("falha interna de integridade nao vira no-deal e reverte todo o tick", () => {
  const { room, players } = makeRoom({ seed: "corrupt-career" });
  room.careerState.players.push(...structuredClone(players.filter((player) => player.clubId !== "HUM")));
  const before = structuredClone(room);
  assert.throws(() => tick(room, players, "negotiation", 4), (error) => error.code === "MARKET_INTEGRITY_CAREER");
  assert.deepEqual(room, before);
});

test("mercado inclui outras ligas e respeita jogadores inegociaveis", () => {
  const crossLeague = makeRoom({ seed: "cross-league" });
  const clubs = crossLeague.room.competitionCatalog[0].clubs;
  crossLeague.room.competitionCatalog = [
    { id: "L1", name: "Liga humana", active: true, clubs: clubs.filter((club) => club.id === "HUM") },
    { id: "L2", name: "Liga IA", active: true, clubs: clubs.filter((club) => club.id !== "HUM") },
  ];
  const result = tick(crossLeague.room, crossLeague.players, "negotiation", 9);
  assert.equal(result.status, "completed");
  assert.ok(["AI1", "AI2", "AI3"].includes(result.fromClubId));
  assert.ok(["AI1", "AI2", "AI3"].includes(result.toClubId));

  const protectedRoom = makeRoom({ seed: "protected-players" });
  for (const player of protectedRoom.players) {
    if (player.clubId !== "HUM") player.notForSale = true;
  }
  assert.equal(tick(protectedRoom.room, protectedRoom.players, "negotiation", 10).status, "no-deal");
});

test("tick global nao duplica ligas e emprestimo respeita o calendario dos clubes", () => {
  const { room, players } = makeRoom({ seed: "global-calendar" });
  const clubs = room.competitionCatalog[0].clubs;
  room.competitionCatalog = [
    { id: "L1", active: true, clubs: clubs.filter((club) => ["HUM", "AI1"].includes(club.id)) },
    { id: "L2", active: true, clubs: clubs.filter((club) => ["AI2", "AI3"].includes(club.id)) },
  ];
  room.leagueFixtureSchedule = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `L1-${index + 1}`,
      leagueId: "L1",
      round: index + 1,
      homeClubId: "AI1",
      awayClubId: "HUM",
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `L2-${index + 1}`,
      leagueId: "L2",
      round: index + 1,
      homeClubId: "AI2",
      awayClubId: "AI3",
    })),
  ];
  for (const player of players) {
    if (["AI2", "AI3"].includes(player.clubId)) player.notForSale = true;
  }
  const result = tick(room, players, "loan", 1);
  assert.equal(result.status, "completed", JSON.stringify(result));
  const transaction = ensureMarketState(room, NOW).transactions.at(-1);
  assert.ok(transaction.loanTerms.durationRounds <= 5);
  const duplicate = runAiTransferTick(room, {
    players,
    seasonNumber: 1,
    round: 1,
    leagueId: "L2",
    intervalRounds: 1,
    preferredMethod: "loan",
  }, NOW);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.tickKey, "1:global:1");
});

test("mercado amplo conclui lote limitado sem repetir clubes ou jogadores", () => {
  const { room, players } = makeRoom({ aiClubCount: 10, seed: "market-batch" });
  const result = tick(room, players, null, 11);
  assert.equal(result.status, "completed");
  assert.equal(result.dealCount, 2);
  assert.equal(new Set(result.deals.map((deal) => deal.playerId)).size, result.dealCount);
  assert.equal(new Set(result.deals.flatMap((deal) => [deal.fromClubId, deal.toClubId])).size, result.dealCount * 2);
  assert.equal(ensureMarketState(room, NOW).transactions.length, result.dealCount);
});
