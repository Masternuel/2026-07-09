import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMarketLoans,
  cancelListing,
  createListing,
  createOffer,
  ensureMarketState,
  marketSnapshot,
  placeBid,
  registrationForPlayer,
  respondOffer,
  returnLoansForSeason,
  settleExpiredMarket,
} from "../game/market.mjs";

const MILLION = 1_000_000;
const START = new Date("2026-07-18T12:00:00.000Z");

function at(minutes) {
  return new Date(START.getTime() + minutes * 60_000);
}

function player(id, clubId, value = 20 * MILLION, extra = {}) {
  return {
    id,
    clubId,
    name: `Jogador ${id}`,
    position: "ATA",
    age: 24,
    overall: 10,
    value,
    active: true,
    ...extra,
  };
}

function createRoom() {
  return {
    code: "BOLA-MRKT",
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
    playerStates: [],
    clubMoraleStates: [],
    lineups: [],
    matchReadiness: {
      fixtureId: "fixture-1",
      managerIds: ["buyer", "seller", "rival"],
    },
  };
}

function finance(room, clubId) {
  return ensureMarketState(room, START).finances.find((item) => item.clubId === clubId);
}

test("IA aceita, contrapoe ou rejeita conforme o valor da oferta", async (t) => {
  const cases = [
    { name: "aceita pelo valor de mercado", amount: 20 * MILLION, status: "accepted" },
    { name: "contrapoe a partir de 85%", amount: 18 * MILLION, status: "countered" },
    { name: "rejeita oferta baixa", amount: 10 * MILLION, status: "rejected" },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const room = createRoom();
      const target = player(`ai-${scenario.status}`, "AI");
      room.playerStates.push({ playerId: target.id, clubId: "AI", condition: 100 });

      const result = createOffer(room, "buyer", {
        requestId: `request-${scenario.status}`,
        dealType: "transfer",
        amount: scenario.amount,
      }, target, START);

      assert.equal(result.offer.status, scenario.status);
      assert.equal(finance(room, "BUY").committed, 0);

      if (scenario.status === "accepted") {
        assert.ok(result.transaction);
        assert.equal(result.transaction.amount, 20 * MILLION);
        assert.equal(finance(room, "BUY").balance, 80 * MILLION);
        assert.equal(registrationForPlayer(room, target.id).currentClubId, "BUY");
        assert.equal(room.playerStates[0].clubId, "BUY");
      } else {
        assert.equal(result.transaction, null);
        assert.equal(finance(room, "BUY").balance, 100 * MILLION);
        assert.equal(registrationForPlayer(room, target.id), null);
      }

      if (scenario.status === "countered") {
        assert.equal(result.offer.counterAmount, 20 * MILLION);
      }
    });
  }
});

test("diretor reduz pedida implícita da IA sem alterar anúncio explícito", () => {
  const room = createRoom();
  room.clubCareerState = {
    staffMembers: [{
      id: "director-buy",
      clubId: "BUY",
      role: "football_director",
      status: "employed",
      attributes: { negotiation: 20 },
    }],
    staffContracts: [{
      id: "staff-contract-buy",
      staffId: "director-buy",
      clubId: "BUY",
      status: "active",
      wage: 100_000,
      endDate: "2027-12-31T23:59:59.999Z",
    }],
  };
  const aiTarget = player("ai-negotiated", "AI");
  room.playerStates.push({ playerId: aiTarget.id, clubId: "AI", condition: 100 });

  const negotiated = createOffer(room, "buyer", {
    requestId: "offer-with-director",
    dealType: "transfer",
    amount: 18_400_000,
  }, aiTarget, START);

  assert.equal(negotiated.offer.status, "accepted");
  assert.equal(negotiated.offer.negotiationBonusApplied, 0.08);
  assert.equal(negotiated.offer.baseAskingAmount, 20 * MILLION);
  assert.equal(negotiated.offer.effectiveAskingAmount, 18_400_000);
  assert.equal(negotiated.transaction.amount, 18_400_000);

  const listingRoom = createRoom();
  listingRoom.clubCareerState = structuredClone(room.clubCareerState);
  const listedTarget = player("listed-fixed-price", "SELL");
  const { listing } = createListing(listingRoom, "seller", {
    requestId: "fixed-price-listing",
    mode: "direct",
    dealType: "transfer",
    askingPrice: 20 * MILLION,
  }, listedTarget, START);
  const belowExplicitPrice = createOffer(listingRoom, "buyer", {
    requestId: "below-fixed-price",
    listingId: listing.id,
    dealType: "transfer",
    amount: 18_400_000,
  }, listedTarget, START);

  assert.equal(belowExplicitPrice.offer.status, "pending");
  assert.equal(belowExplicitPrice.offer.negotiationBonusApplied, 0);
  assert.equal(belowExplicitPrice.offer.baseAskingAmount, 20 * MILLION);
  assert.equal(belowExplicitPrice.offer.effectiveAskingAmount, 20 * MILLION);
});

test("transferencia humana aceita move jogador, saldos, escalacao e prontidao", () => {
  const room = createRoom();
  const target = player("human-transfer", "SELL", 25 * MILLION);
  room.playerStates.push({ playerId: target.id, clubId: "SELL", condition: 93 });
  room.lineups.push({
    managerId: "seller",
    clubId: "SELL",
    lineupIds: [target.id, "outro-jogador"],
  });

  const proposal = createOffer(room, "buyer", {
    requestId: "human-offer",
    dealType: "transfer",
    amount: 25 * MILLION,
  }, target, START);

  assert.equal(proposal.offer.status, "pending");
  assert.equal(finance(room, "BUY").committed, 25 * MILLION);

  const accepted = respondOffer(room, "seller", {
    requestId: "human-accept",
    offerId: proposal.offer.id,
    action: "accept",
  }, at(1));

  assert.equal(accepted.offer.status, "accepted");
  assert.equal(accepted.transaction.amount, 25 * MILLION);
  assert.equal(finance(room, "BUY").balance, 75 * MILLION);
  assert.equal(finance(room, "BUY").committed, 0);
  assert.equal(finance(room, "SELL").balance, 105 * MILLION);
  assert.equal(registrationForPlayer(room, target.id).permanentClubId, "BUY");
  assert.equal(registrationForPlayer(room, target.id).currentClubId, "BUY");
  assert.equal(room.playerStates[0].clubId, "BUY");
  assert.deepEqual(room.lineups[0].lineupIds, ["outro-jogador"]);
  assert.deepEqual(room.matchReadiness.managerIds, ["rival"]);
});

test("oferta humana pode ser rejeitada ou cancelada sem consumir saldo", () => {
  const room = createRoom();
  const target = player("human-close", "SELL");

  const rejectedProposal = createOffer(room, "buyer", {
    requestId: "offer-to-reject",
    amount: 12 * MILLION,
    dealType: "transfer",
  }, target, START);
  assert.equal(finance(room, "BUY").committed, 12 * MILLION);

  const rejected = respondOffer(room, "seller", {
    requestId: "reject-offer",
    offerId: rejectedProposal.offer.id,
    action: "reject",
  }, at(1));
  assert.equal(rejected.offer.status, "rejected");
  assert.equal(finance(room, "BUY").committed, 0);

  const cancelledProposal = createOffer(room, "buyer", {
    requestId: "offer-to-cancel",
    amount: 9 * MILLION,
    dealType: "transfer",
  }, target, at(2));
  assert.equal(finance(room, "BUY").committed, 9 * MILLION);

  const cancelled = respondOffer(room, "buyer", {
    requestId: "cancel-offer",
    offerId: cancelledProposal.offer.id,
    action: "cancel",
  }, at(3));
  assert.equal(cancelled.offer.status, "cancelled");
  assert.equal(cancelled.cancelled, true);
  assert.equal(finance(room, "BUY").balance, 100 * MILLION);
  assert.equal(finance(room, "BUY").committed, 0);
  assert.equal(room.marketState.transactions.length, 0);
});

test("leilao libera o superado e liquida somente o maior lance", () => {
  const room = createRoom();
  const target = player("auction-player", "SELL");
  room.playerStates.push({ playerId: target.id, clubId: "SELL", condition: 100 });

  const { listing } = createListing(room, "seller", {
    requestId: "auction-listing",
    mode: "auction",
    dealType: "transfer",
    minimumBid: 15 * MILLION,
    expiresInHours: 1,
  }, target, START);

  placeBid(room, "buyer", {
    requestId: "buyer-bid",
    listingId: listing.id,
    amount: 15 * MILLION,
  }, at(1));
  assert.equal(finance(room, "BUY").committed, 15 * MILLION);

  const outbid = placeBid(room, "rival", {
    requestId: "rival-bid",
    listingId: listing.id,
    amount: 16 * MILLION,
  }, at(2));
  assert.equal(outbid.listing.bidCount, 2);
  assert.equal(outbid.listing.highestBid.managerId, "rival");
  assert.equal(finance(room, "BUY").committed, 0);
  assert.equal(finance(room, "RIV").committed, 16 * MILLION);

  const settled = settleExpiredMarket(room, at(61));
  assert.equal(settled.changed, true);
  assert.equal(settled.transactions.length, 1);
  assert.equal(settled.transactions[0].amount, 16 * MILLION);
  assert.equal(listing.status, "completed");
  assert.equal(finance(room, "RIV").balance, 74 * MILLION);
  assert.equal(finance(room, "RIV").committed, 0);
  assert.equal(finance(room, "SELL").balance, 96 * MILLION);
  assert.equal(registrationForPlayer(room, target.id).currentClubId, "RIV");
  assert.equal(room.playerStates[0].clubId, "RIV");
});

test("emprestimo retorna por rodadas, sem avancar duas vezes na mesma rodada", () => {
  const room = createRoom();
  const target = player("loan-rounds", "AI", 20 * MILLION, {
    wage: 123_456,
    contract: { clubId: "AI", wage: 123_456, status: "active" },
  });
  room.playerStates.push({ playerId: target.id, clubId: "AI", condition: 100 });

  const loan = createOffer(room, "buyer", {
    requestId: "loan-offer",
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: { durationRounds: 2, wageSharePercent: 60 },
  }, target, START);

  assert.equal(loan.offer.status, "accepted");
  assert.equal(registrationForPlayer(room, target.id).currentClubId, "BUY");
  assert.equal(registrationForPlayer(room, target.id).permanentClubId, "AI");
  assert.equal(registrationForPlayer(room, target.id).loan.remainingRounds, 2);
  assert.equal(marketSnapshot(room, "buyer").activeLoans[0].wage, 123_456);

  const firstRound = advanceMarketLoans(room, 1, 1, at(1));
  assert.equal(firstRound.changed, true);
  assert.equal(registrationForPlayer(room, target.id).loan.remainingRounds, 1);

  advanceMarketLoans(room, 1, 1, at(2));
  assert.equal(registrationForPlayer(room, target.id).loan.remainingRounds, 1);

  const secondRound = advanceMarketLoans(room, 1, 2, at(3));
  assert.equal(secondRound.changed, true);
  assert.equal(secondRound.returned.length, 1);
  assert.equal(registrationForPlayer(room, target.id).currentClubId, "AI");
  assert.equal(registrationForPlayer(room, target.id).loan, null);
  assert.equal(room.playerStates[0].clubId, "AI");
});

test("emprestimos avancam somente na liga do clube tomador", () => {
  const room = createRoom();
  room.competitionCatalog.push({
    id: "AR-A",
    name: "Liga argentina",
    clubs: [
      { id: "ARG", name: "Argentino FC", budget: 60 * MILLION, reputation: 10 },
      { id: "ARG-2", name: "Rival Argentino", budget: 50 * MILLION, reputation: 10 },
    ],
  });
  room.managers.push({ id: "arg-buyer", name: "Arg Buyer", clubId: "ARG" });
  const brazilian = player("loan-br", "AI");
  const argentine = player("loan-ar", "ARG-2");

  createOffer(room, "buyer", {
    requestId: "loan-br-offer",
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: { durationRounds: 3 },
  }, brazilian, START);
  createOffer(room, "arg-buyer", {
    requestId: "loan-ar-offer",
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: { durationRounds: 3 },
  }, argentine, START);

  advanceMarketLoans(room, 1, 1, at(1), "BR-A");
  assert.equal(registrationForPlayer(room, brazilian.id).loan.remainingRounds, 2);
  assert.equal(registrationForPlayer(room, argentine.id).loan.remainingRounds, 3);

  advanceMarketLoans(room, 1, 1, at(2), "AR-A");
  assert.equal(registrationForPlayer(room, brazilian.id).loan.remainingRounds, 2);
  assert.equal(registrationForPlayer(room, argentine.id).loan.remainingRounds, 2);

  advanceMarketLoans(room, 1, 1, at(3), "BR-A");
  assert.equal(registrationForPlayer(room, brazilian.id).loan.remainingRounds, 2);
});

test("emprestimos restantes retornam na virada de temporada", () => {
  const room = createRoom();
  const target = player("loan-season", "AI");

  createOffer(room, "buyer", {
    requestId: "season-loan-offer",
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: { durationRounds: 10 },
  }, target, START);

  const result = returnLoansForSeason(room, 2, at(5));
  assert.equal(result.changed, true);
  assert.equal(result.returned.length, 1);
  assert.equal(registrationForPlayer(room, target.id).currentClubId, "AI");
  assert.equal(registrationForPlayer(room, target.id).loan, null);
});

test("requestId torna oferta e aceite idempotentes", () => {
  const room = createRoom();
  const target = player("idempotent-player", "SELL");
  const input = {
    requestId: "same-offer-request",
    dealType: "transfer",
    amount: 11 * MILLION,
  };

  const first = createOffer(room, "buyer", input, target, START);
  const duplicate = createOffer(room, "buyer", input, target, at(1));

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.offer.id, first.offer.id);
  assert.equal(room.marketState.activeOffers.length, 1);
  assert.equal(finance(room, "BUY").committed, 11 * MILLION);

  const response = {
    requestId: "same-accept-request",
    offerId: first.offer.id,
    action: "accept",
  };
  const accepted = respondOffer(room, "seller", response, at(2));
  const duplicateAccepted = respondOffer(room, "seller", response, at(3));

  assert.equal(duplicateAccepted.duplicate, true);
  assert.equal(duplicateAccepted.transaction.id, accepted.transaction.id);
  assert.equal(room.marketState.transactions.length, 1);
  assert.equal(finance(room, "BUY").balance, 89 * MILLION);
  assert.equal(finance(room, "SELL").balance, 91 * MILLION);
  assert.equal(finance(room, "BUY").committed, 0);
});

test("jogador anunciado exige o listing e leilao aceita somente lance", () => {
  const room = createRoom();
  const target = player("auction-guard", "SELL");
  const { listing } = createListing(room, "seller", {
    requestId: "guard-listing",
    mode: "auction",
    dealType: "transfer",
    minimumBid: 10 * MILLION,
  }, target, START);

  assert.throws(
    () => createOffer(room, "buyer", {
      requestId: "guard-private-offer",
      playerId: target.id,
      dealType: "transfer",
      amount: 20 * MILLION,
    }, target, at(1)),
    (error) => error.code === "MARKET_LISTING_REQUIRED",
  );
  assert.throws(
    () => createOffer(room, "buyer", {
      requestId: "guard-auction-offer",
      playerId: target.id,
      listingId: listing.id,
      dealType: "transfer",
      amount: 20 * MILLION,
    }, target, at(1)),
    (error) => error.code === "MARKET_BID_REQUIRED",
  );
  assert.equal(listing.status, "open");
  assert.equal(room.marketState.activeOffers.length, 0);
});

test("emprestimo anunciado preserva termos do vendedor e usa valor final como taxa", () => {
  const room = createRoom();
  const target = player("listed-loan", "SELL");
  const { listing } = createListing(room, "seller", {
    requestId: "listed-loan-create",
    mode: "direct",
    dealType: "loan",
    askingPrice: 2 * MILLION,
    loanTerms: {
      fee: 500_000,
      wageSharePercent: 80,
      durationRounds: 2,
      purchaseOption: 15 * MILLION,
    },
  }, target, START);

  assert.equal(listing.loanTerms.fee, 2 * MILLION);
  const result = createOffer(room, "buyer", {
    requestId: "listed-loan-buy",
    playerId: target.id,
    listingId: listing.id,
    dealType: "loan",
    amount: 2 * MILLION,
    loanTerms: {
      fee: 1,
      wageSharePercent: 0,
      durationRounds: 100,
      purchaseOption: 1,
    },
  }, target, at(1));

  assert.equal(result.offer.status, "accepted");
  assert.deepEqual(result.transaction.loanTerms, {
    fee: 2 * MILLION,
    wageSharePercent: 80,
    durationRounds: 2,
    purchaseOption: 15 * MILLION,
  });
  assert.deepEqual(registrationForPlayer(room, target.id).loan.terms, result.transaction.loanTerms);
  assert.equal(registrationForPlayer(room, target.id).loan.fee, 2 * MILLION);
});

test("listing e oferta expirados nao podem concluir negocio", () => {
  const listingRoom = createRoom();
  const listedPlayer = player("expired-listing", "SELL");
  const { listing } = createListing(listingRoom, "seller", {
    requestId: "expired-listing-create",
    mode: "direct",
    dealType: "transfer",
    askingPrice: 20 * MILLION,
    expiresInHours: 1,
  }, listedPlayer, START);

  assert.throws(
    () => createOffer(listingRoom, "buyer", {
      requestId: "expired-listing-buy",
      playerId: listedPlayer.id,
      listingId: listing.id,
      dealType: "transfer",
      amount: 20 * MILLION,
    }, listedPlayer, at(61)),
    (error) => error.code === "MARKET_LISTING_EXPIRED",
  );

  const offerRoom = createRoom();
  const offeredPlayer = player("expired-offer", "SELL");
  const proposal = createOffer(offerRoom, "buyer", {
    requestId: "expired-offer-create",
    playerId: offeredPlayer.id,
    dealType: "transfer",
    amount: 10 * MILLION,
  }, offeredPlayer, START);

  assert.throws(
    () => respondOffer(offerRoom, "seller", {
      requestId: "expired-offer-accept",
      offerId: proposal.offer.id,
      action: "accept",
    }, at(48 * 60 + 1)),
    (error) => error.code === "MARKET_OFFER_EXPIRED",
  );
  assert.equal(offerRoom.marketState.transactions.length, 0);
  assert.equal(finance(offerRoom, "BUY").balance, 100 * MILLION);
});

test("migracao preserva registrations legados em objeto e procura ID sem diferenciar caixa", () => {
  const room = createRoom();
  room.marketState = {
    version: 1,
    registrations: {
      "Legacy-Player": {
        originalClubId: "SELL",
        permanentClubId: "BUY",
        currentClubId: "BUY",
        playerSnapshot: { name: "Legado", clubId: "BUY", overall: 11 },
      },
    },
  };

  const state = ensureMarketState(room, START);
  assert.equal(state.registrations.length, 1);
  assert.equal(state.registrations[0].playerId, "Legacy-Player");
  assert.equal(state.registrations[0].playerSnapshot.id, "Legacy-Player");
  assert.equal(registrationForPlayer(room, "legacy-player").currentClubId, "BUY");
  assert.equal(registrationForPlayer(room, "LEGACY-PLAYER").permanentClubId, "BUY");
});

test("orcamento persistente limita mercado, snapshot e saldo restante", () => {
  const room = createRoom();
  room.clubCareerState = {
    financeProfiles: [
      { clubId: "BUY", transferBudget: 10 * MILLION, wageBudget: 5 * MILLION },
      { clubId: "AI", transferBudget: 2 * MILLION, wageBudget: 5 * MILLION },
    ],
  };
  const expensive = player("budget-blocked", "AI", 11 * MILLION);
  const initialFinance = marketSnapshot(room, "buyer").finance;
  assert.equal(initialFinance.cashAvailable, 100 * MILLION);
  assert.equal(initialFinance.transferBudget, 10 * MILLION);
  assert.equal(initialFinance.transferAvailable, 10 * MILLION);
  assert.equal(initialFinance.wageBudget, 5 * MILLION);
  assert.equal(initialFinance.available, initialFinance.transferAvailable);
  assert.throws(() => createOffer(room, "buyer", {
    requestId: "budget-blocked-offer",
    dealType: "transfer",
    amount: 11 * MILLION,
  }, expensive, START), (error) => error.code === "MARKET_BUDGET_INSUFFICIENT");

  const affordable = player("budget-accepted", "AI", 10 * MILLION);
  createOffer(room, "buyer", {
    requestId: "budget-accepted-offer",
    dealType: "transfer",
    amount: 10 * MILLION,
  }, affordable, at(1));
  const buyerProfile = room.clubCareerState.financeProfiles.find(({ clubId }) => clubId === "BUY");
  const sellerProfile = room.clubCareerState.financeProfiles.find(({ clubId }) => clubId === "AI");
  assert.equal(buyerProfile.transferBudget, 0);
  assert.equal(sellerProfile.transferBudget, 12 * MILLION);
  assert.equal(marketSnapshot(room, "buyer").finance.available, 0);
});

test("limite salarial bloqueia contrato acima da folha permitida", () => {
  const room = createRoom();
  room.clubCareerState = {
    financeProfiles: [{ clubId: "BUY", transferBudget: 100 * MILLION, wageBudget: 100_000 }],
  };
  const target = player("wage-blocked", "AI", 20 * MILLION, {
    wage: 250_000,
    contract: { clubId: "AI", wage: 250_000, status: "active" },
  });

  assert.throws(() => createOffer(room, "buyer", {
    requestId: "wage-blocked-offer",
    dealType: "transfer",
    amount: 20 * MILLION,
    contractTerms: { wage: 250_000, durationSeasons: 3 },
  }, target, START), (error) => error.code === "MARKET_WAGE_BUDGET_INSUFFICIENT");
  assert.equal(finance(room, "BUY").balance, 100 * MILLION);
  assert.equal(room.marketState.transactions.length, 0);
});

test("cancelar listing encerra ofertas vinculadas e libera todo valor reservado", () => {
  const room = createRoom();
  const target = player("cancel-linked", "SELL");
  const { listing } = createListing(room, "seller", {
    requestId: "cancel-linked-listing",
    mode: "direct",
    dealType: "transfer",
    askingPrice: 20 * MILLION,
  }, target, START);
  const proposal = createOffer(room, "buyer", {
    requestId: "cancel-linked-offer",
    playerId: target.id,
    listingId: listing.id,
    dealType: "transfer",
    amount: 10 * MILLION,
  }, target, at(1));
  assert.equal(proposal.offer.status, "pending");
  assert.equal(finance(room, "BUY").committed, 10 * MILLION);

  cancelListing(room, "seller", {
    requestId: "cancel-linked-action",
    listingId: listing.id,
  }, at(2));

  assert.equal(listing.status, "cancelled");
  assert.equal(proposal.offer.status, "cancelled");
  assert.equal(proposal.offer.reservedAmount, 0);
  assert.equal(finance(room, "BUY").committed, 0);
  assert.throws(
    () => respondOffer(room, "seller", {
      requestId: "cancel-linked-late-accept",
      offerId: proposal.offer.id,
      action: "accept",
    }, at(3)),
    (error) => error.code === "MARKET_OFFER_CLOSED",
  );
});

test("bloqueia oferta duplicada e limita propostas ativas por manager", () => {
  const room = createRoom();
  const target = player("quota-0", "SELL");
  createOffer(room, "buyer", {
    requestId: "quota-transfer-first",
    playerId: target.id,
    dealType: "transfer",
    amount: MILLION,
  }, target, START);

  assert.throws(
    () => createOffer(room, "buyer", {
      requestId: "quota-transfer-duplicate",
      playerId: target.id,
      dealType: "transfer",
      amount: 2 * MILLION,
    }, target, at(1)),
    (error) => error.code === "MARKET_OFFER_DUPLICATE",
  );

  const loanForSamePlayer = createOffer(room, "buyer", {
    requestId: "quota-loan-same-player",
    playerId: target.id,
    dealType: "loan",
    amount: MILLION,
  }, target, at(1));
  assert.equal(loanForSamePlayer.offer.status, "pending");

  for (let index = 1; index <= 18; index += 1) {
    const candidate = player(`quota-${index}`, "SELL");
    createOffer(room, "buyer", {
      requestId: `quota-request-${index}`,
      playerId: candidate.id,
      dealType: "transfer",
      amount: MILLION,
    }, candidate, at(index + 1));
  }
  assert.equal(room.marketState.activeOffers.filter((offer) => offer.status === "pending").length, 20);

  const overflow = player("quota-overflow", "SELL");
  assert.throws(
    () => createOffer(room, "buyer", {
      requestId: "quota-request-overflow",
      playerId: overflow.id,
      dealType: "transfer",
      amount: MILLION,
    }, overflow, at(30)),
    (error) => error.code === "MARKET_MANAGER_OFFER_LIMIT",
  );
});
