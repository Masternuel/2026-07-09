import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMarketLoans,
  assertMarketIntegrity,
  createOffer,
  ensureMarketState,
  executeAiTransfer,
  exerciseLoanOption,
  processScheduledTransfers,
  reconcileMarketCareerState,
  registrationForPlayer,
  respondOffer,
} from "../game/market.mjs";
import { processCareerSeasonTransition } from "../game/playerCareerEngine.mjs";

const MILLION = 1_000_000;
const START = new Date("2026-07-18T12:00:00.000Z");

function at(minutes) {
  return new Date(START.getTime() + minutes * 60_000);
}

function createRoom() {
  return {
    code: "BOLA-CONSISTENCY",
    status: "active",
    currentSeason: 1,
    competitionCatalog: [{
      id: "BR-A",
      name: "Liga de teste",
      clubs: [
        { id: "BUY", name: "Comprador FC", budget: 100 * MILLION, reputation: 10 },
        { id: "SELL", name: "Vendedor FC", budget: 80 * MILLION, reputation: 10 },
        { id: "RIV", name: "Rival FC", budget: 90 * MILLION, reputation: 10 },
        { id: "AI", name: "Clube IA", budget: 70 * MILLION, reputation: 10 },
      ],
    }],
    managers: [
      { id: "buyer", name: "Buyer", clubId: "BUY" },
      { id: "seller", name: "Seller", clubId: "SELL" },
      { id: "rival", name: "Rival", clubId: "RIV" },
    ],
    careerState: {
      currentSeason: 1,
      players: [],
      transferHistory: [],
    },
    playerCompetitionRegistrations: [],
    playerStates: [],
    clubMoraleStates: [],
    lineups: [],
    matchReadiness: {
      fixtureId: "fixture-1",
      managerIds: ["buyer", "seller", "rival"],
    },
  };
}

function createPlayer(id, clubId, value = 20 * MILLION, extra = {}) {
  const contract = clubId
    ? {
      id: `contract-${id}-old`,
      clubId,
      startSeason: 1,
      endSeason: 3,
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2028-12-31T23:59:59.999Z",
      wage: 90_000,
      status: "active",
    }
    : {
      id: `contract-${id}-free`,
      clubId: null,
      wage: 75_000,
      status: "free_agent",
    };
  return {
    id,
    name: `Jogador ${id}`,
    clubId,
    currentClubId: clubId,
    ownerClubId: clubId,
    position: "ATA",
    age: 24,
    overall: 10,
    value,
    wage: contract.wage,
    active: true,
    contract,
    contractHistory: [],
    transferHistory: [],
    competitionRegistrations: clubId ? [{
      id: `old:${id}`,
      competitionId: "BR-A",
      playerId: id,
      clubId,
      seasonNumber: 1,
      status: "active",
    }] : [],
    ...extra,
  };
}

function registerCareerPlayer(room, player, { lineupManagerId = null } = {}) {
  room.careerState.players.push(structuredClone(player));
  if (player.clubId) {
    room.playerStates.push({ playerId: player.id, clubId: player.clubId, condition: 100 });
    room.playerCompetitionRegistrations.push(...structuredClone(player.competitionRegistrations ?? []));
  }
  if (lineupManagerId) {
    room.lineups.push({
      managerId: lineupManagerId,
      clubId: player.clubId,
      lineupIds: [player.id, "outro-jogador"],
    });
  }
  return player;
}

function finance(room, clubId) {
  return ensureMarketState(room, START).finances.find((item) => item.clubId === clubId);
}

function careerPlayer(room, playerId) {
  return room.careerState.players.find((candidate) => candidate.id === playerId);
}

function offersFor(room, playerId) {
  return room.marketState.activeOffers.filter((offer) => offer.player.id === playerId);
}

function assertPermanentTransferState(room, playerId, clubId) {
  const registration = registrationForPlayer(room, playerId);
  assert.ok(registration, "registro de mercado deve existir");
  assert.equal(registration.currentClubId, clubId);
  assert.equal(registration.permanentClubId, clubId);
  assert.equal(registration.loan, null);

  const records = room.careerState.players.filter((candidate) => candidate.id === playerId);
  assert.equal(records.length, 1, "jogador deve existir uma unica vez na carreira");
  const current = records[0];
  assert.equal(current.clubId, clubId);
  assert.equal(current.currentClubId, clubId);
  assert.equal(current.ownerClubId, clubId);
  assert.equal(current.contract.clubId, clubId);
  assert.equal(current.contract.status, "active");
  assert.equal(
    (current.contractHistory ?? []).filter((contract) => contract.status === "active").length,
    0,
    "historico nao pode conter outro contrato ativo",
  );
  assert.equal(
    room.playerCompetitionRegistrations
      .filter((entry) => entry.playerId === playerId)
      .every((entry) => entry.clubId === clubId),
    true,
    "inscricoes antigas devem ser removidas",
  );
  assert.equal(
    (room.playerStates ?? []).filter((state) => state.playerId === playerId).length <= 1,
    true,
    "estado de runtime nao pode duplicar",
  );
  assertMarketIntegrity(room, playerId);
  return { registration, player: current };
}

test("compra e venda humana sincronizam elenco, contrato, inscricoes, historico e financas", () => {
  const room = createRoom();
  room.transferWindows = [{
    seasonNumber: 1,
    startsAt: at(-60).toISOString(),
    endsAt: at(60).toISOString(),
  }];
  const target = registerCareerPlayer(
    room,
    createPlayer("human-transfer", "SELL", 25 * MILLION),
    { lineupManagerId: "seller" },
  );

  const buyerProposal = createOffer(room, "buyer", {
    requestId: "human-buy",
    dealType: "transfer",
    amount: 25 * MILLION,
    contractTerms: { wage: 180_000, durationSeasons: 4 },
  }, target, START);
  const rivalProposal = createOffer(room, "rival", {
    requestId: "rival-buy",
    dealType: "transfer",
    amount: 22 * MILLION,
  }, target, at(1));

  const accepted = respondOffer(room, "seller", {
    requestId: "seller-accepts",
    offerId: buyerProposal.offer.id,
    action: "accept",
  }, at(2));

  assert.equal(accepted.offer.status, "accepted");
  assert.equal(rivalProposal.offer.status, "cancelled");
  assert.equal(rivalProposal.offer.reservedAmount, 0);
  assert.equal(offersFor(room, target.id).some((offer) => ["pending", "countered"].includes(offer.status)), false);
  assert.deepEqual(room.lineups[0].lineupIds, ["outro-jogador"]);
  assert.deepEqual(room.matchReadiness.managerIds, ["rival"]);

  assert.equal(finance(room, "BUY").balance, 75 * MILLION);
  assert.equal(finance(room, "BUY").committed, 0);
  assert.equal(finance(room, "SELL").balance, 105 * MILLION);
  assert.equal(finance(room, "RIV").balance, 90 * MILLION);
  assert.equal(finance(room, "RIV").committed, 0);
  assert.equal(finance(room, "BUY").ledger.at(-1).type, "expense");
  assert.equal(finance(room, "SELL").ledger.at(-1).type, "income");

  const synchronized = assertPermanentTransferState(room, target.id, "BUY");
  assert.equal(synchronized.player.contract.wage, 180_000);
  assert.equal(synchronized.player.contract.startSeason, 1);
  assert.equal(synchronized.player.contract.endSeason, 4);
  assert.equal(synchronized.player.contract.startDate, at(2).toISOString());
  assert.ok(Date.parse(synchronized.player.contract.endDate) > Date.parse(synchronized.player.contract.startDate));
  assert.equal(synchronized.player.contractHistory.length, 1);
  assert.equal(synchronized.player.contractHistory[0].status, "terminated");
  assert.equal(synchronized.player.contractHistory[0].clubId, "SELL");
  assert.equal(synchronized.player.transferHistory.at(-1).fromClubId, "SELL");
  assert.equal(synchronized.player.transferHistory.at(-1).toClubId, "BUY");
  assert.equal(synchronized.player.transferHistory.at(-1).amount, 25 * MILLION);
  assert.equal(room.careerState.transferHistory.at(-1).id, accepted.transaction.id);
});

test("agente livre recebe contrato unico e nao gera credito para vendedor inexistente", () => {
  const room = createRoom();
  const target = registerCareerPlayer(room, createPlayer("free-agent", null));

  const signed = createOffer(room, "buyer", {
    requestId: "sign-free-agent",
    dealType: "transfer",
    amount: MILLION,
    contractTerms: { wage: 125_000, durationSeasons: 2 },
  }, target, START);

  assert.equal(signed.offer.status, "accepted");
  assert.equal(signed.transaction.fromClubId, null);
  assert.equal(finance(room, "BUY").balance, 99 * MILLION);
  assert.equal(room.marketState.finances.some((item) => item.clubId === "__FREE_AGENT__"), false);
  const synchronized = assertPermanentTransferState(room, target.id, "BUY");
  assert.equal(synchronized.player.contract.wage, 125_000);
  assert.equal(synchronized.player.contract.endSeason, 2);
  assert.equal(synchronized.player.transferHistory.at(-1).eventType, "free-agent-signing");
});

test("emprestimo simples preserva proprietario e contrato principal e retorna automaticamente", () => {
  const room = createRoom();
  const target = registerCareerPlayer(room, createPlayer("simple-loan", "AI"));

  const result = createOffer(room, "buyer", {
    requestId: "simple-loan-offer",
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: { durationRounds: 2, wageSharePercent: 60 },
  }, target, START);

  assert.equal(result.offer.status, "accepted");
  let registration = registrationForPlayer(room, target.id);
  let current = careerPlayer(room, target.id);
  assert.equal(registration.permanentClubId, "AI");
  assert.equal(registration.currentClubId, "BUY");
  assert.equal(registration.loan.lenderClubId, "AI");
  assert.equal(registration.loan.borrowerClubId, "BUY");
  assert.equal(current.clubId, "BUY");
  assert.equal(current.ownerClubId, "AI");
  assert.equal(current.contract.clubId, "AI");
  assert.equal(current.contract.id, target.contract.id);
  assertMarketIntegrity(room, target.id);

  advanceMarketLoans(room, 1, 1, at(1));
  const returned = advanceMarketLoans(room, 1, 2, at(2));
  assert.equal(returned.changed, true);
  registration = registrationForPlayer(room, target.id);
  current = careerPlayer(room, target.id);
  assert.equal(registration.loan, null);
  assert.equal(registration.currentClubId, "AI");
  assert.equal(registration.permanentClubId, "AI");
  assert.equal(current.clubId, "AI");
  assert.equal(current.ownerClubId, "AI");
  assert.equal(current.contract.clubId, "AI");
  assert.equal(room.marketState.loanHistory.at(-1).status, "returned");
  assert.equal(current.transferHistory.at(-1).eventType, "loan-return");
  assertMarketIntegrity(room, target.id);
});

test("emprestimo projeta termino pela agenda do tomador e usa sete dias por rodada sem agenda", () => {
  const scheduledRoom = createRoom();
  const firstKickoff = new Date(START.getTime() + 4 * 24 * 60 * 60 * 1_000).toISOString();
  const secondKickoff = new Date(START.getTime() + 11 * 24 * 60 * 60 * 1_000).toISOString();
  scheduledRoom.leagueFixtureSchedule = [
    {
      leagueFixtureId: "buy-round-1",
      homeClubId: "BUY",
      awayClubId: "RIV",
      scheduledAt: firstKickoff,
    },
    {
      leagueFixtureId: "buy-round-2",
      homeClubId: "AI",
      awayClubId: "BUY",
      scheduledAt: secondKickoff,
    },
  ];
  const scheduledTarget = registerCareerPlayer(
    scheduledRoom,
    createPlayer("scheduled-loan-end", "AI"),
  );
  createOffer(scheduledRoom, "buyer", {
    requestId: "scheduled-loan-end-offer",
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: { durationRounds: 2 },
  }, scheduledTarget, START);
  assert.equal(registrationForPlayer(scheduledRoom, scheduledTarget.id).loan.endsAt, secondKickoff);

  const fallbackRoom = createRoom();
  const fallbackTarget = registerCareerPlayer(
    fallbackRoom,
    createPlayer("fallback-loan-end", "AI"),
  );
  createOffer(fallbackRoom, "buyer", {
    requestId: "fallback-loan-end-offer",
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: { durationRounds: 3 },
  }, fallbackTarget, START);
  assert.equal(
    registrationForPlayer(fallbackRoom, fallbackTarget.id).loan.endsAt,
    new Date(START.getTime() + 21 * 24 * 60 * 60 * 1_000).toISOString(),
  );
});

test("opcao de compra converte emprestimo em transferencia definitiva", () => {
  const room = createRoom();
  const target = registerCareerPlayer(room, createPlayer("loan-option", "AI"));

  createOffer(room, "buyer", {
    requestId: "loan-option-offer",
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: { durationRounds: 5, purchaseOption: 15 * MILLION },
    contractTerms: { wage: 150_000, durationSeasons: 5 },
  }, target, START);
  const converted = exerciseLoanOption(room, "buyer", {
    requestId: "exercise-option",
    playerId: target.id,
  }, at(1));

  assert.equal(converted.transaction.eventType, "loan-option");
  assert.equal(converted.transaction.amount, 15 * MILLION);
  assert.equal(finance(room, "BUY").balance, 83 * MILLION);
  assert.equal(finance(room, "AI").balance, 87 * MILLION);
  assert.equal(finance(room, "BUY").committed, 0);
  assert.equal(room.marketState.loanHistory.at(-1).status, "converted");
  const synchronized = assertPermanentTransferState(room, target.id, "BUY");
  assert.equal(synchronized.player.contract.wage, 150_000);
  assert.equal(synchronized.player.transferHistory.at(-1).eventType, "loan-option");
});

test("obrigacao de compra e executada automaticamente no fim do emprestimo", () => {
  const room = createRoom();
  const target = registerCareerPlayer(room, createPlayer("loan-obligation", "AI"));

  createOffer(room, "buyer", {
    requestId: "loan-obligation-offer",
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: { durationRounds: 1, purchaseObligation: 15 * MILLION },
  }, target, START);

  assert.equal(finance(room, "BUY").balance, 98 * MILLION);
  assert.equal(finance(room, "BUY").committed, 15 * MILLION);
  const finished = advanceMarketLoans(room, 1, 1, at(1));
  assert.equal(finished.changed, true);
  assert.equal(finance(room, "BUY").balance, 83 * MILLION);
  assert.equal(finance(room, "BUY").committed, 0);
  assert.equal(finance(room, "AI").balance, 87 * MILLION);
  assert.equal(room.marketState.transactions.at(-1).eventType, "loan-obligation");
  assert.equal(room.marketState.loanHistory.at(-1).status, "converted");
  assertPermanentTransferState(room, target.id, "BUY");
});

test("transferencia para a proxima temporada fica reservada e so muda o clube ao processar", () => {
  const room = createRoom();
  const target = registerCareerPlayer(room, createPlayer("future-transfer", "SELL", 18 * MILLION));

  const proposal = createOffer(room, "buyer", {
    requestId: "future-offer",
    dealType: "transfer",
    amount: 18 * MILLION,
    contractTerms: { wage: 140_000, durationSeasons: 3, effectiveSeason: 2 },
  }, target, START);
  const accepted = respondOffer(room, "seller", {
    requestId: "future-accept",
    offerId: proposal.offer.id,
    action: "accept",
  }, at(1));

  assert.equal(accepted.transaction.status, "scheduled");
  assert.equal(registrationForPlayer(room, target.id), null);
  assert.equal(careerPlayer(room, target.id).clubId, "SELL");
  assert.equal(finance(room, "BUY").balance, 100 * MILLION);
  assert.equal(finance(room, "BUY").committed, 18 * MILLION);
  assert.equal(finance(room, "SELL").balance, 80 * MILLION);

  assert.equal(room.currentSeason, 1, "RoomStore processa acordos antes de incrementar a temporada");
  const processed = processScheduledTransfers(room, 2, at(2));
  assert.equal(processed.changed, true);
  assert.equal(processed.completed.length, 1);
  assert.equal(finance(room, "BUY").balance, 82 * MILLION);
  assert.equal(finance(room, "BUY").committed, 0);
  assert.equal(finance(room, "SELL").balance, 98 * MILLION);
  const synchronized = assertPermanentTransferState(room, target.id, "BUY");
  assert.equal(synchronized.player.contract.startSeason, 2);
  assert.equal(synchronized.player.contract.endSeason, 4);
  assert.equal(synchronized.player.competitionRegistrations[0].seasonNumber, 2);
  assert.equal(
    room.playerCompetitionRegistrations.find((entry) => entry.playerId === target.id).seasonNumber,
    2,
  );
  assert.equal(room.marketState.scheduledTransfers[0].status, "completed");
});

test("agendamentos futuros contam vagas ja reservadas no elenco", () => {
  const room = createRoom();
  room.maxSquadSize = 1;
  const first = registerCareerPlayer(room, createPlayer("future-capacity-1", "SELL"));
  const second = registerCareerPlayer(room, createPlayer("future-capacity-2", "SELL"));

  executeAiTransfer(room, {
    requestId: "future-capacity-first",
    toClubId: "BUY",
    amount: 10 * MILLION,
    contractTerms: { effectiveSeason: 2 },
  }, first, START);
  const beforeSecond = structuredClone(room);

  assert.throws(
    () => executeAiTransfer(room, {
      requestId: "future-capacity-second",
      toClubId: "BUY",
      amount: 10 * MILLION,
      contractTerms: { effectiveSeason: 2 },
    }, second, at(1)),
    (error) => error.code === "MARKET_SQUAD_FULL",
  );
  assert.deepEqual(room, beforeSecond);
  assert.equal(room.marketState.scheduledTransfers.length, 1);
  assert.equal(finance(room, "BUY").committed, 10 * MILLION);
});

test("lote cancela agendamento sem vaga e ainda conclui os demais", () => {
  const room = createRoom();
  room.maxSquadSize = 1;
  const invalid = registerCareerPlayer(room, createPlayer("batch-full", "SELL"));
  const valid = registerCareerPlayer(room, createPlayer("batch-valid", "SELL"));

  executeAiTransfer(room, {
    requestId: "batch-full-scheduled",
    toClubId: "BUY",
    amount: 10 * MILLION,
    contractTerms: { effectiveSeason: 2 },
  }, invalid, START);
  executeAiTransfer(room, {
    requestId: "batch-valid-scheduled",
    toClubId: "RIV",
    amount: 12 * MILLION,
    contractTerms: { effectiveSeason: 2 },
  }, valid, at(1));
  registerCareerPlayer(room, createPlayer("buyer-filler", "BUY"));

  const processed = processScheduledTransfers(room, 2, at(2));

  assert.equal(processed.changed, true);
  assert.equal(processed.cancelled.length, 1);
  assert.equal(processed.cancelled[0].playerId, invalid.id);
  assert.equal(processed.cancelled[0].reason, "squad-full");
  assert.equal(processed.cancelled[0].errorCode, "MARKET_SQUAD_FULL");
  assert.equal(processed.completed.length, 1);
  assert.equal(processed.completed[0].player.id, valid.id);
  assert.equal(finance(room, "BUY").balance, 100 * MILLION);
  assert.equal(finance(room, "BUY").committed, 0);
  assert.equal(finance(room, "RIV").balance, 78 * MILLION);
  assert.equal(finance(room, "RIV").committed, 0);
  assert.equal(careerPlayer(room, invalid.id).clubId, "SELL");
  assert.equal(careerPlayer(room, valid.id).clubId, "RIV");
  assert.equal(
    room.marketState.transactions.find((entry) => entry.player.id === invalid.id).status,
    "cancelled",
  );
  assertPermanentTransferState(room, valid.id, "RIV");
});

test("janela fechada, falha financeira e contrato invalido revertem a sala inteira", async (t) => {
  await t.test("janela fechada", () => {
    const room = createRoom();
    room.transferWindowOpen = false;
    const target = registerCareerPlayer(room, createPlayer("closed-window", "AI"));
    const before = structuredClone(room);

    assert.throws(
      () => createOffer(room, "buyer", {
        requestId: "closed-window-offer",
        dealType: "transfer",
        amount: 20 * MILLION,
      }, target, START),
      (error) => error.code === "MARKET_WINDOW_CLOSED",
    );
    assert.deepEqual(room, before);
  });

  await t.test("saldo insuficiente depois de iniciar a operacao", () => {
    const room = createRoom();
    const target = registerCareerPlayer(room, createPlayer("finance-failure", "AI", 150 * MILLION));
    const before = structuredClone(room);

    assert.throws(
      () => executeAiTransfer(room, {
        requestId: "ai-over-budget",
        toClubId: "BUY",
        amount: 101 * MILLION,
      }, target, START),
      (error) => error.code === "MARKET_BUDGET_INSUFFICIENT",
    );
    assert.deepEqual(room, before);
  });

  await t.test("termos contratuais invalidos", () => {
    const room = createRoom();
    const target = registerCareerPlayer(room, createPlayer("contract-failure", "AI"));
    const before = structuredClone(room);

    assert.throws(
      () => executeAiTransfer(room, {
        requestId: "ai-invalid-contract",
        toClubId: "BUY",
        amount: 20 * MILLION,
        contractTerms: { effectiveSeason: 3 },
      }, target, START),
      (error) => error.code === "MARKET_EFFECTIVE_SEASON_INVALID",
    );
    assert.deepEqual(room, before);
  });

  await t.test("falha de integridade depois de atualizar contrato e financas", () => {
    const room = createRoom();
    const target = registerCareerPlayer(room, createPlayer("late-contract-failure", "AI"));
    // Simula um save legado corrompido: a falha so aparece na verificacao final,
    // depois de o motor tentar contrato, inscricoes e lancamentos financeiros.
    room.careerState.players.push(structuredClone(target));
    const before = structuredClone(room);

    assert.throws(
      () => executeAiTransfer(room, {
        requestId: "ai-late-contract-failure",
        toClubId: "BUY",
        amount: 20 * MILLION,
      }, target, START),
      (error) => error.code === "MARKET_INTEGRITY_CAREER",
    );
    assert.deepEqual(room, before);
  });
});

test("vendedor obsoleto nao conclui negocio depois que jogador muda de clube", () => {
  const room = createRoom();
  const target = registerCareerPlayer(room, createPlayer("stale-seller", "SELL"));
  const proposal = createOffer(room, "buyer", {
    requestId: "stale-offer",
    dealType: "transfer",
    amount: 20 * MILLION,
  }, target, START);

  const moved = careerPlayer(room, target.id);
  moved.clubId = "RIV";
  moved.currentClubId = "RIV";
  moved.ownerClubId = "RIV";
  moved.contract = { ...moved.contract, clubId: "RIV" };
  room.playerStates[0].clubId = "RIV";
  const beforeResponse = structuredClone(room);

  assert.throws(
    () => respondOffer(room, "seller", {
      requestId: "stale-accept",
      offerId: proposal.offer.id,
      action: "accept",
    }, at(1)),
    (error) => error.code === "MARKET_PLAYER_CLUB_CHANGED",
  );
  assert.deepEqual(room, beforeResponse);
  assert.equal(careerPlayer(room, target.id).clubId, "RIV");
  assert.equal(registrationForPlayer(room, target.id), null);
  assert.equal(finance(room, "BUY").balance, 100 * MILLION);
  assert.equal(finance(room, "BUY").committed, 20 * MILLION);
});

test("fim do contrato invalida vinculo antigo e libera negociacoes pendentes", () => {
  const room = createRoom();
  const original = registerCareerPlayer(room, createPlayer("expired-registration", "AI"));
  executeAiTransfer(room, {
    requestId: "establish-registration-before-expiry",
    toClubId: "SELL",
    amount: 10 * MILLION,
  }, original, START);
  const target = careerPlayer(room, original.id);
  room.lineups.push({ managerId: "seller", clubId: "SELL", lineupIds: [target.id] });
  const proposal = createOffer(room, "buyer", {
    requestId: "offer-before-expiry",
    dealType: "transfer",
    amount: 20 * MILLION,
  }, target, START);
  const expired = careerPlayer(room, target.id);
  expired.clubId = null;
  expired.currentClubId = null;
  expired.ownerClubId = null;
  expired.contract = { ...expired.contract, clubId: null, status: "free_agent" };

  const result = reconcileMarketCareerState(room, at(1));
  const registration = registrationForPlayer(room, target.id);

  assert.equal(result.changed, true);
  assert.equal(registration.currentClubId, "__FREE_AGENT__");
  assert.equal(registration.permanentClubId, "__FREE_AGENT__");
  assert.equal(registration.contractId, null);
  assert.equal(proposal.offer.status, "cancelled");
  assert.equal(proposal.offer.reservedAmount, 0);
  assert.equal(finance(room, "BUY").committed, 0);
  assert.equal(room.playerCompetitionRegistrations.some((entry) => entry.playerId === target.id), false);
  assert.equal(room.playerStates.some((entry) => entry.playerId === target.id), false);
  assert.equal(room.lineups[0].lineupIds.includes(target.id), false);
});

test("transferencia IA usa os mesmos invariantes e sobrevive a serializacao do save", () => {
  const room = createRoom();
  const target = registerCareerPlayer(room, createPlayer("ai-transfer", "AI", 16 * MILLION));

  const result = executeAiTransfer(room, {
    requestId: "ai-to-rival",
    toClubId: "RIV",
    amount: 16 * MILLION,
    contractTerms: { wage: 110_000, durationSeasons: 4 },
  }, target, START);

  assert.equal(result.transaction.fromClubId, "AI");
  assert.equal(result.transaction.toClubId, "RIV");
  assert.equal(finance(room, "AI").balance, 86 * MILLION);
  assert.equal(finance(room, "RIV").balance, 74 * MILLION);
  assertPermanentTransferState(room, target.id, "RIV");

  const reloaded = JSON.parse(JSON.stringify(room));
  ensureMarketState(reloaded, at(1));
  const synchronized = assertPermanentTransferState(reloaded, target.id, "RIV");
  assert.equal(synchronized.player.contract.wage, 110_000);
  assert.equal(synchronized.player.contract.endSeason, 4);
  assert.equal(reloaded.marketState.transactions.length, 1);
  assert.equal(reloaded.careerState.transferHistory.length, 1);
  assert.equal(finance(reloaded, "AI").balance, 86 * MILLION);
  assert.equal(finance(reloaded, "RIV").balance, 74 * MILLION);
});

test("avanco de temporada preserva clube, contrato e historico da transferencia", () => {
  const room = createRoom();
  const target = registerCareerPlayer(room, createPlayer("season-transfer", "SELL", 16 * MILLION));
  executeAiTransfer(room, {
    requestId: "season-transfer-ai",
    toClubId: "BUY",
    amount: 16 * MILLION,
    contractTerms: { wage: 130_000, durationSeasons: 4 },
  }, target, START);
  const before = careerPlayer(room, target.id);

  const transition = processCareerSeasonTransition(room.careerState, {
    toSeason: 2,
    roster: room.careerState.players,
    clubs: room.competitionCatalog[0].clubs,
    youthCountPerClub: 0,
    nationalTeams: [],
    seed: "transfer-season-transition",
  });
  const after = transition.players.find((player) => player.id === target.id);

  assert.equal(after.clubId, "BUY");
  assert.equal(after.contract.clubId, "BUY");
  assert.equal(after.contract.id, before.contract.id);
  assert.equal(after.contract.transferId, before.contract.transferId);
  assert.equal(after.contract.startDate, before.contract.startDate);
  assert.equal(after.contract.endDate, before.contract.endDate);
  assert.deepEqual(after.contractHistory, before.contractHistory);
  assert.deepEqual(after.transferHistory, before.transferHistory);
});
