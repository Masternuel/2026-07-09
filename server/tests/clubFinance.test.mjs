import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ClubFinanceError,
  aggregateCashflow,
  availableBalance,
  calculateMonthlyMaintenance,
  calculateMonthlyPayroll,
  creditFinance,
  debitFinance,
  ensureClubFinanceState,
  ensureFinanceAccount,
  getFinanceAccount,
  getFinancialAggregates,
  mirrorSettledFinancialTransaction,
  processMonthlyClubFinance,
  releaseFinance,
  reserveFinance,
} from "../game/clubFinance.mjs";

const MILLION = 1_000_000;

function roomFixture() {
  const preservedFacilities = [{ clubId: "SAN", areas: [{ id: "pitch", level: 2 }] }];
  const preservedEvents = [{ id: "existing-event" }];
  return {
    id: "save-finance",
    currentSeason: 1,
    competitionCatalog: [{
      id: "BR-A",
      clubs: [
        { id: "SAN", name: "Santos", budget: 100 * MILLION, reputation: 16 },
        { id: "PAL", name: "Palmeiras", budget: 80 * MILLION, reputation: 17 },
      ],
    }],
    managers: [{ id: "manager-1", clubId: "SAN" }],
    careerState: {
      players: [
        { id: "P1", clubId: "SAN", wage: 100_000, contract: { clubId: "SAN", wage: 120_000, status: "active" } },
        { id: "P2", clubId: "SAN", wage: 80_000, contract: { clubId: "SAN", wage: 80_000, status: "active" } },
        { id: "P3", clubId: "PAL", wage: 90_000, contract: { clubId: "PAL", wage: 90_000, status: "active" } },
        { id: "P4", clubId: "SAN", wage: 70_000, contract: { clubId: null, wage: 70_000, status: "free_agent" } },
      ],
    },
    clubCareerState: {
      currentDate: "2026-07-01T00:00:00.000Z",
      clubFacilities: preservedFacilities,
      domainEvents: preservedEvents,
    },
  };
}

test("ensure usa marketState.finances como conta canonica e preserva outros modulos", () => {
  const room = roomFixture();
  const facilities = room.clubCareerState.clubFacilities;
  const events = room.clubCareerState.domainEvents;

  const state = ensureClubFinanceState(room, new Date("2026-07-01T00:00:00.000Z"));
  const account = ensureFinanceAccount(room, "san");

  assert.equal(account, room.marketState.finances.find((finance) => finance.clubId === "SAN"));
  assert.equal(account.balance, 100 * MILLION);
  assert.equal(getFinanceAccount(room, "SAN"), account);
  assert.equal(availableBalance(account), 100 * MILLION);
  assert.equal(room.clubCareerState.clubFacilities, facilities);
  assert.equal(room.clubCareerState.domainEvents, events);
  assert.deepEqual(state.financialTransactions, []);
  assert.deepEqual(state.financeProfiles.map((profile) => profile.clubId), ["SAN"]);
  assert.deepEqual(state.lastFinancialPeriodByClub, {});
  assert.equal(state.financialOriginArchive.count, 0);
  assert.deepEqual(state.financialOriginArchive.buckets, {});
});

test("credit/debit grava metadados completos e originId impede saldo duplicado", () => {
  const room = roomFixture();
  const income = creditFinance(room, {
    clubId: "SAN",
    operationId: "matchday:FIX-1",
    amount: 2 * MILLION,
    category: "matchday_revenue",
    description: "Bilheteria",
    relatedClubId: "PAL",
    competitionId: "BR-A",
    fixtureId: "FIX-1",
    periodKey: "2026-07",
    occurredAt: "2026-07-12T19:00:00.000Z",
    metadata: { attendance: 30_000 },
  });
  const duplicate = creditFinance(room, {
    clubId: "SAN",
    operationId: "matchday:FIX-1",
    amount: 2 * MILLION,
    category: "matchday_revenue",
  });
  const expense = debitFinance(room, {
    clubId: "SAN",
    originId: "facility:PROJECT-1",
    amount: 5 * MILLION,
    category: "stadium_investment",
    projectId: "PROJECT-1",
    occurredAt: "2026-07-13T12:00:00.000Z",
  });

  assert.equal(income.applied, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(expense.transaction.balanceBefore, 102 * MILLION);
  assert.equal(expense.transaction.balanceAfter, 97 * MILLION);
  assert.equal(room.marketState.finances.find((account) => account.clubId === "SAN").balance, 97 * MILLION);
  assert.equal(room.clubCareerState.financialTransactions.length, 2);
  assert.deepEqual(income.transaction.metadata, { attendance: 30_000 });
  assert.equal(income.transaction.relatedClubId, "PAL");
  assert.equal(income.transaction.matchId, "FIX-1");
  assert.equal(income.transaction.competitionId, "BR-A");
  assert.equal(expense.transaction.projectId, "PROJECT-1");
});

test("espelha liquidacao externa sem movimentar o saldo novamente", () => {
  const room = roomFixture();
  const account = ensureFinanceAccount(room, "SAN");
  account.balance -= 12 * MILLION;
  account.ledger.push({ id: "transfer-1", type: "expense", amount: 12 * MILLION });
  const settledBalance = account.balance;

  const first = mirrorSettledFinancialTransaction(room, {
    clubId: "SAN",
    operationId: "transfer-1",
    direction: "expense",
    amount: 12 * MILLION,
    category: "player_purchase",
    playerId: "P3",
    relatedClubId: "PAL",
    occurredAt: "2026-07-15T00:00:00.000Z",
  });
  const duplicate = mirrorSettledFinancialTransaction(room, {
    clubId: "SAN",
    operationId: "transfer-1",
    direction: "expense",
    amount: 12 * MILLION,
  });

  assert.equal(account.balance, settledBalance);
  assert.equal(first.applied, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(room.clubCareerState.financialTransactions.length, 1);
  assert.equal(first.transaction.metadata.settledExternally, true);
});

test("debito sem saldo falha sem alterar conta ou historico", () => {
  const room = roomFixture();
  const before = structuredClone(room);

  assert.throws(() => debitFinance(room, {
    clubId: "SAN",
    operationId: "too-expensive",
    amount: 101 * MILLION,
  }), (error) => error instanceof ClubFinanceError && error.code === "FINANCE_BUDGET_INSUFFICIENT");

  assert.equal(getFinanceAccount(room, "SAN").balance, 100 * MILLION);
  assert.deepEqual(room.clubCareerState.financialTransactions, []);
  assert.deepEqual(room.competitionCatalog, before.competitionCatalog);
});

test("reservas e liberacoes sao idempotentes e protegem saldo disponivel", () => {
  const room = roomFixture();
  const reserved = reserveFinance(room, {
    clubId: "SAN",
    operationId: "offer:1",
    amount: 30 * MILLION,
    category: "transfer_offer",
  });
  const duplicateReserve = reserveFinance(room, {
    clubId: "SAN",
    operationId: "offer:1",
    amount: 30 * MILLION,
  });

  assert.equal(reserved.account.committed, 30 * MILLION);
  assert.equal(duplicateReserve.duplicate, true);
  assert.equal(availableBalance(reserved.account), 70 * MILLION);
  assert.throws(() => debitFinance(room, {
    clubId: "SAN",
    operationId: "expense:blocked",
    amount: 71 * MILLION,
  }), (error) => error.code === "FINANCE_BUDGET_INSUFFICIENT");

  const released = releaseFinance(room, { clubId: "SAN", operationId: "offer:1" });
  const duplicateRelease = releaseFinance(room, { clubId: "SAN", operationId: "offer:1" });
  assert.equal(released.releasedAmount, 30 * MILLION);
  assert.equal(released.account.committed, 0);
  assert.equal(duplicateRelease.duplicate, true);
});

test("aggregateCashflow soma periodos e categorias reais", () => {
  const room = roomFixture();
  creditFinance(room, { clubId: "SAN", operationId: "july:sponsor", amount: 10 * MILLION, category: "sponsorship", periodKey: "2026-07", occurredAt: "2026-07-01" });
  debitFinance(room, { clubId: "SAN", operationId: "july:payroll", amount: 3 * MILLION, category: "payroll", periodKey: "2026-07", occurredAt: "2026-07-02" });
  creditFinance(room, { clubId: "SAN", operationId: "aug:sponsor", amount: 11 * MILLION, category: "sponsorship", periodKey: "2026-08", occurredAt: "2026-08-01" });
  creditFinance(room, { clubId: "PAL", operationId: "pal:sponsor", amount: 20 * MILLION, category: "sponsorship", periodKey: "2026-07", occurredAt: "2026-07-01" });

  const july = aggregateCashflow(room, { clubId: "SAN", periodKey: "2026-07" });
  assert.deepEqual({ income: july.income, expenses: july.expenses, net: july.net, count: july.count }, {
    income: 10 * MILLION,
    expenses: 3 * MILLION,
    net: 7 * MILLION,
    count: 2,
  });
  assert.deepEqual(july.byCategory.map((entry) => entry.category), ["payroll", "sponsorship"]);
  assert.equal(july.byPeriod[0].periodKey, "2026-07");
});

test("processamento mensal calcula folha, patrocinio e manutencao uma unica vez", () => {
  const room = roomFixture();
  const payroll = calculateMonthlyPayroll(room, "SAN");
  assert.deepEqual(payroll, { amount: 200_000, paidPlayers: 2 });

  const first = processMonthlyClubFinance(room, {
    clubId: "SAN",
    periodKey: "2026-07",
    sponsorIncome: 3 * MILLION,
    maintenance: 500_000,
    occurredAt: "2026-07-31T23:59:59.000Z",
  });
  const balanceAfter = first.account.balance;
  const repeated = processMonthlyClubFinance(room, {
    clubId: "SAN",
    periodKey: "2026-07",
    sponsorIncome: 3 * MILLION,
    maintenance: 500_000,
    occurredAt: "2026-07-31T23:59:59.000Z",
  });

  assert.equal(first.applied, true);
  assert.equal(first.transactions.length, 3);
  assert.equal(balanceAfter, 102_300_000);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.account.balance, balanceAfter);
  assert.equal(room.clubCareerState.lastFinancialPeriodByClub.SAN, "2026-07");
  assert.equal(aggregateCashflow(room, { clubId: "SAN", periodKey: "2026-07" }).net, 2_300_000);
});

test("fechamento mensal usa contratos ativos, direitos e divida persistida", () => {
  const room = roomFixture();
  const state = ensureClubFinanceState(room, "2026-07-01T00:00:00.000Z");
  ensureFinanceAccount(room, "SAN");
  const profile = state.financeProfiles.find(({ clubId }) => clubId === "SAN");
  Object.assign(profile, {
    sponsors: [{
      id: "sponsor-main",
      name: "Marca Real",
      annualValue: 12 * MILLION,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-12-31T23:59:59.000Z",
      status: "active",
    }],
    broadcastRights: {
      monthlyAmount: 2 * MILLION,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-12-31T23:59:59.000Z",
    },
    debts: 10 * MILLION,
    debtMonthlyPayment: 1 * MILLION,
  });

  const result = processMonthlyClubFinance(room, {
    clubId: "SAN",
    periodKey: "2026-08",
    sponsorBonus: 1 * MILLION,
    payroll: 0,
    maintenance: 0,
    occurredAt: "2026-08-31T23:59:59.000Z",
  });

  assert.equal(result.sponsorIncome, 2 * MILLION);
  assert.equal(result.broadcastIncome, 2 * MILLION);
  assert.equal(result.debtPayment, 1 * MILLION);
  assert.deepEqual(result.transactions.map(({ category }) => category), [
    "sponsorship",
    "broadcast_rights",
    "debt_payment",
  ]);
  assert.equal(
    room.clubCareerState.financeProfiles.find(({ clubId }) => clubId === "SAN").debts,
    9 * MILLION,
  );
  assert.equal(result.account.balance, 103 * MILLION);
});

test("manutencao usa custos persistidos de estadio e infraestrutura", () => {
  const room = roomFixture();
  room.clubCareerState.clubFacilities[0] = {
    clubId: "SAN",
    stadium: { maintenanceCost: 500_000 },
    areas: [{ id: "pitch", maintenanceCost: 60_000 }, { id: "medical", maintenanceCost: 40_000 }],
  };

  assert.equal(calculateMonthlyMaintenance(room, "SAN"), 600_000);
  const result = processMonthlyClubFinance(room, {
    clubId: "SAN",
    periodKey: "2026-08",
    sponsorIncome: 0,
    payroll: 0,
    occurredAt: "2026-08-31T23:59:59.000Z",
  });
  assert.equal(result.maintenance, 600_000);
  assert.equal(result.account.balance, 99_400_000);
});

test("falha mensal reverte perfil, conta e historico por completo", () => {
  const room = roomFixture();
  ensureClubFinanceState(room);
  const before = structuredClone(room);

  assert.throws(() => processMonthlyClubFinance(room, {
    clubId: "SAN",
    periodKey: "2026-07",
    sponsorIncome: 1 * MILLION,
    payroll: 99 * MILLION,
    maintenance: 3 * MILLION,
    occurredAt: "2026-07-31T23:59:59.000Z",
  }), (error) => error.code === "FINANCE_MONTHLY_BUDGET_INSUFFICIENT");

  assert.deepEqual(room, before);
});

test("historico detalhado e ledger possuem limites seguros", () => {
  const room = roomFixture();
  for (let index = 0; index < 520; index += 1) {
    creditFinance(room, {
      clubId: "SAN",
      operationId: `bounded:${index}`,
      amount: 1,
      category: "test",
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    });
  }
  const account = getFinanceAccount(room, "SAN");
  assert.equal(room.clubCareerState.financialTransactions.length, 500);
  assert.equal(account.ledger.length, 100);
  assert.equal(account.balance, 100 * MILLION + 520);
  const aggregates = getFinancialAggregates(room, "SAN");
  assert.equal(aggregates.total.income, 520);
  assert.equal(aggregates.total.count, 520);
  assert.equal(aggregates.total.byCategory.test.income, 520);
});

test("agregados financeiros sobrevivem a poda e reload sem duplicar", () => {
  const room = roomFixture();
  for (let index = 0; index < 520; index += 1) {
    const month = String((index % 12) + 1).padStart(2, "0");
    creditFinance(room, {
      clubId: "SAN",
      operationId: `aggregate:${index}`,
      amount: 10,
      category: index % 2 === 0 ? "sponsorship" : "matchday_revenue",
      periodKey: `2026-${month}`,
      occurredAt: `2026-${month}-15T12:00:00.000Z`,
    });
  }
  assert.equal(room.clubCareerState.financialTransactions.length, 500);
  const before = getFinancialAggregates(room, "SAN");
  const reloaded = structuredClone(room);
  ensureClubFinanceState(reloaded, "2027-01-01T00:00:00.000Z");
  const after = getFinancialAggregates(reloaded, "SAN");

  assert.deepEqual(after, before);
  assert.equal(after.total.income, 5_200);
  assert.equal(after.total.count, 520);
  const yearly = after.yearly.find(({ year }) => year === 2026);
  assert.equal(yearly.income, 5_200);
  assert.deepEqual(yearly.byCategory, {
    sponsorship: { income: 2_600, expenses: 0, count: 260 },
    matchday_revenue: { income: 2_600, expenses: 0, count: 260 },
  });
  assert.equal(after.monthly.reduce((sum, entry) => sum + entry.count, 0), 520);
});

test("migra categorias anuais antigas quando os meses preservados cobrem o total", () => {
  const room = roomFixture();
  room.clubCareerState.financialAggregates = {
    version: 1,
    monthly: [{
      clubId: "SAN",
      periodKey: "2026-07",
      income: 1_000,
      expenses: 250,
      count: 2,
      byCategory: {
        sponsorship: { income: 1_000, expenses: 0, count: 1 },
        maintenance: { income: 0, expenses: 250, count: 1 },
      },
    }],
    yearly: [{ clubId: "SAN", year: 2026, income: 1_000, expenses: 250, count: 2 }],
    totals: [{
      clubId: "SAN",
      income: 1_000,
      expenses: 250,
      count: 2,
      byCategory: {
        sponsorship: { income: 1_000, expenses: 0, count: 1 },
        maintenance: { income: 0, expenses: 250, count: 1 },
      },
    }],
  };

  const aggregates = getFinancialAggregates(room, "SAN");

  assert.deepEqual(aggregates.yearly[0].byCategory, {
    sponsorship: { income: 1_000, expenses: 0, count: 1 },
    maintenance: { income: 0, expenses: 250, count: 1 },
  });
});

test("retry continua idempotente depois da poda do historico e ledger", () => {
  const room = roomFixture();
  debitFinance(room, {
    clubId: "SAN",
    operationId: "retry:durable",
    amount: 1_000,
    category: "test",
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
  for (let index = 0; index < 520; index += 1) {
    creditFinance(room, {
      clubId: "SAN",
      operationId: `after-retry:${index}`,
      amount: 1,
      category: "test",
      occurredAt: new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString(),
    });
  }

  const account = getFinanceAccount(room, "SAN");
  const balanceBeforeRetry = account.balance;
  assert.equal(room.clubCareerState.financialTransactions.some(({ originId }) => originId === "retry:durable"), false);
  assert.equal(account.ledger.some(({ originId }) => originId === "retry:durable"), false);

  const retry = debitFinance(room, {
    clubId: "SAN",
    operationId: "retry:durable",
    amount: 1_000,
    category: "test",
  });

  assert.equal(retry.duplicate, true);
  assert.equal(retry.applied, false);
  assert.equal(retry.transaction.compacted, true);
  assert.equal(account.balance, balanceBeforeRetry);
  assert.equal(room.clubCareerState.financialTransactions.length, 500);
  assert.equal(account.ledger.length, 100);
  assert.equal(room.clubCareerState.financialOriginIndex.length, 521);
});

test("retry antigo continua idempotente depois da compactacao exata", () => {
  const room = roomFixture();
  const fingerprint = (originId) => createHash("sha256")
    .update(`SAN\0${originId}`)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
  const oldOriginId = "retry:archive-durable";
  room.clubCareerState = {
    financialOriginIndex: [
      fingerprint(oldOriginId),
      ...Array.from({ length: 4_095 }, (_, index) => fingerprint(`seed:${index}`)),
    ],
  };

  const firstNew = creditFinance(room, {
    clubId: "SAN",
    operationId: "after-origin-index-limit",
    amount: 1,
    category: "test",
  });
  const balanceBeforeRetry = firstNew.account.balance;
  const reloadedRoom = structuredClone(room);
  const retry = debitFinance(reloadedRoom, {
    clubId: "SAN",
    operationId: oldOriginId,
    amount: 10_000,
    category: "test",
  });

  assert.equal(retry.duplicate, true);
  assert.equal(retry.applied, false);
  assert.equal(retry.transaction.compacted, true);
  assert.equal(getFinanceAccount(reloadedRoom, "SAN").balance, balanceBeforeRetry);
  assert.equal(reloadedRoom.clubCareerState.financialOriginIndex.length, 4_096);
  assert.ok(reloadedRoom.clubCareerState.financialOriginArchive.count >= 1);
  assert.equal("financialOriginBloom" in reloadedRoom.clubCareerState, false);
});

test("seasonNumber e gravado e migrado por ano quando possivel", () => {
  const room = roomFixture();
  room.currentSeason = 3;
  room.clubCareerState.currentDate = "2028-07-01T00:00:00.000Z";
  const account = ensureFinanceAccount(room, "SAN", { now: "2028-07-01T00:00:00.000Z" });
  room.clubCareerState.financialTransactions = [{
    id: "legacy-2026",
    originId: "legacy-2026",
    operationId: "legacy-2026",
    clubId: "SAN",
    occurredAt: "2026-08-01T00:00:00.000Z",
  }];
  account.ledger = [{
    id: "legacy-2027",
    operationId: "legacy-2027",
    occurredAt: "2027-08-01T00:00:00.000Z",
  }];

  const state = ensureClubFinanceState(room, "2028-07-01T00:00:00.000Z");
  ensureFinanceAccount(room, "SAN", { now: "2028-07-01T00:00:00.000Z" });
  const current = creditFinance(room, {
    clubId: "SAN",
    operationId: "season-current",
    amount: 1,
    occurredAt: "2028-08-01T00:00:00.000Z",
  });

  assert.equal(state.financialTransactions.find(({ id }) => id === "legacy-2026").seasonNumber, 1);
  assert.equal(account.ledger.find(({ id }) => id === "legacy-2027").seasonNumber, 2);
  assert.equal(current.transaction.seasonNumber, 3);
  assert.equal(account.ledger.at(-1).seasonNumber, 3);
});

test("limites zerados de save antigo migram uma vez usando caixa e folha", () => {
  const room = roomFixture();
  room.clubCareerState.financeProfiles = [{ clubId: "SAN", transferBudget: 0, wageBudget: 0 }];

  ensureFinanceAccount(room, "SAN");
  let profile = room.clubCareerState.financeProfiles.find(({ clubId }) => clubId === "SAN");
  assert.equal(profile.transferBudget, 100 * MILLION);
  assert.ok(profile.wageBudget >= 200_000);
  assert.equal(profile.financeLimitsVersion, 1);

  profile.transferBudget = 0;
  ensureFinanceAccount(room, "SAN");
  profile = room.clubCareerState.financeProfiles.find(({ clubId }) => clubId === "SAN");
  assert.equal(profile.transferBudget, 0, "limite consumido nao pode ser recriado a cada leitura");
});

test("folha mensal divide salario de emprestado sem cobrar duas vezes", () => {
  const room = roomFixture();
  const player = room.careerState.players.find(({ id }) => id === "P1");
  player.clubId = "PAL";
  player.currentClubId = "PAL";
  ensureClubFinanceState(room);
  room.marketState.registrations.push({
    playerId: "P1",
    originalClubId: "SAN",
    permanentClubId: "SAN",
    currentClubId: "PAL",
    playerSnapshot: structuredClone(player),
    loan: {
      id: "loan-payroll",
      lenderClubId: "SAN",
      borrowerClubId: "PAL",
      terms: { wageSharePercent: 60 },
    },
  });

  assert.deepEqual(calculateMonthlyPayroll(room, "SAN"), { amount: 128_000, paidPlayers: 2 });
  assert.deepEqual(calculateMonthlyPayroll(room, "PAL"), { amount: 162_000, paidPlayers: 2 });
});
