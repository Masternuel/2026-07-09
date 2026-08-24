import assert from "node:assert/strict";
import test from "node:test";
import {
  CENTRAL_EMPTY_MESSAGES,
  buildCentralSnapshot,
  selectActiveProjects,
  selectCareerNews,
  selectCoachCareerAlerts,
  selectClubFinance,
  selectCompetitionStatus,
  selectExpiringContracts,
  selectMarketNegotiations,
  selectNextFixture,
  selectRecentResults,
  selectStaffAlerts,
  selectSquadStatus,
} from "../game/centralSelectors.mjs";

function factualRoom() {
  return {
    code: "CENTRAL",
    currentSeason: 1,
    updatedAt: "2026-08-02T21:00:00.000Z",
    currentFixtureId: "managed-r2",
    completedFixtureIds: ["managed-r1"],
    competitionCatalog: [{
      id: "BRA-A",
      name: "Brasileirão Série A",
      clubs: [
        { id: "A", code: "AUR", name: "Aurora" },
        { id: "B", code: "BOR", name: "Boreal" },
        { id: "C", code: "CEL", name: "Celta" },
        { id: "D", code: "DEL", name: "Delta" },
      ],
    }],
    fixtureSchedule: [{
      fixtureId: "managed-r1",
      leagueFixtureId: "league-r1-a-b",
      leagueId: "BRA-A",
      round: 1,
      homeClubId: "A",
      homeTeam: "Aurora",
      awayClubId: "B",
      awayTeam: "Boreal",
      scheduledAt: "2026-07-26T19:00:00.000Z",
      competition: "Brasileirão Série A",
    }, {
      fixtureId: "managed-r2",
      leagueFixtureId: "league-r2-c-a",
      leagueId: "BRA-A",
      round: 2,
      homeClubId: "C",
      homeTeam: "Celta",
      awayClubId: "A",
      awayTeam: "Aurora",
      scheduledAt: "2026-08-09T19:00:00.000Z",
      competition: "Brasileirão Série A",
      homeStadium: "Estádio Central",
    }],
    leagueFixtureSchedule: [{
      leagueFixtureId: "league-r1-a-b", leagueId: "BRA-A", round: 1, homeClubId: "A", awayClubId: "B",
    }, {
      leagueFixtureId: "league-r1-c-d", leagueId: "BRA-A", round: 1, homeClubId: "C", awayClubId: "D",
    }, {
      leagueFixtureId: "league-r2-c-a", leagueId: "BRA-A", round: 2, homeClubId: "C", awayClubId: "A",
    }],
    leagueMatchResults: [{
      leagueFixtureId: "league-r1-a-b", score: [2, 0], completedAt: "2026-07-26T21:00:00.000Z",
    }, {
      leagueFixtureId: "league-r1-c-d", score: [1, 1], completedAt: "2026-07-26T21:00:00.000Z",
    }],
    completedMatches: [{
      id: "match-r1",
      fixtureId: "managed-r1",
      homeClubId: "A",
      awayClubId: "B",
      homeTeam: "Aurora",
      awayTeam: "Boreal",
      score: [2, 0],
      completedAt: "2026-07-26T21:00:00.000Z",
    }],
    clubMoraleStates: [{ clubId: "A", score: 74 }],
    playerStates: [{ playerId: "p1", condition: 68, morale: 61, injuryMatches: 2 }, {
      playerId: "p2", condition: 91, morale: 72, suspensionMatches: 1,
    }, { playerId: "p3", condition: 100, morale: 89 }],
    careerState: {
      players: [{
        id: "p1", name: "Ana", clubId: "A", position: "ATA",
        contract: { id: "contract-p1", clubId: "A", status: "active", endDate: "2026-10-01T00:00:00.000Z", wage: 20_000 },
      }, {
        id: "p2", name: "Bia", clubId: "A", position: "ZAG",
        contract: { id: "contract-p2", clubId: "A", status: "active", endSeason: 3, wage: 15_000 },
      }, {
        id: "p3", name: "Caio", clubId: "A", position: "GOL",
        contract: { id: "contract-p3", clubId: "A", status: "active", endSeason: 4, wage: 10_000 },
      }, {
        id: "other", name: "Davi", clubId: "B", position: "MEI",
        contract: { clubId: "B", status: "active", endSeason: 1 },
      }],
    },
    marketState: {
      finances: [{ clubId: "A", balance: 50_000_000, committed: 5_000_000, ledger: [] }],
      registrations: [],
      activeOffers: [{ id: "offer-1", status: "pending", buyerClubId: "A", sellerClubId: "B" }, {
        id: "offer-closed", status: "rejected", buyerClubId: "A", sellerClubId: "B",
      }],
      activeListings: [{ id: "listing-1", status: "open", sellerClubId: "A" }, {
        id: "listing-closed", status: "closed", sellerClubId: "A",
      }],
      scheduledTransfers: [{ id: "scheduled-1", status: "scheduled", fromClubId: "C", toClubId: "A" }],
    },
    clubCareerState: {
      currentDate: "2026-08-02T00:00:00.000Z",
      financialTransactions: [{
        id: "income-1", clubId: "A", direction: "income", amount: 10_000_000, originId: "match-r1",
      }, {
        id: "expense-1", clubId: "A", direction: "expense", amount: 2_000_000, originId: "salary-july",
      }, {
        id: "other-income", clubId: "B", direction: "income", amount: 999_000_000,
      }],
      financeProfiles: [{ clubId: "A", wageBudget: 2_000_000, payroll: 1_200_000, debt: 1_000_000 }],
      facilityProjects: [{
        id: "project-1", clubId: "A", type: "infrastructure", name: "Centro médico",
        status: "active", startedAt: "2026-07-01T00:00:00.000Z", expectedAt: "2026-08-12T00:00:00.000Z",
      }, {
        id: "project-complete", clubId: "A", status: "completed", completesAt: "2026-07-12T00:00:00.000Z",
      }, {
        id: "other-project", clubId: "B", status: "in_progress", completesAt: "2026-08-12T00:00:00.000Z",
      }],
      boardObjectives: [{ id: "objective-1", clubId: "A", title: "Classificar", status: "active", progress: 20 }],
      centralMessages: [{ id: "message-1", clubId: "A", title: "Reunião marcada", status: "unread", createdAt: "2026-08-01T12:00:00.000Z" }],
      staffAlerts: [{ id: "staff-alert-1", clubId: "A", type: "MEDICAL", status: "active", playerId: "p1" }],
      news: [{
        id: "news-1", eventId: "event-1", eventType: "MATCH_COMPLETED", title: "Vitória do Aurora",
        clubIds: ["A", "B"], publishedAt: "2026-07-26T21:01:00.000Z", readByManagerIds: ["manager-a"],
      }],
    },
  };
}

test("snapshot da Central agrega somente fatos reais e nao altera a sala", () => {
  const room = factualRoom();
  const before = structuredClone(room);
  const snapshot = buildCentralSnapshot(room, { clubId: "AUR", managerId: "manager-a" });

  assert.deepEqual(room, before, "seletores devem ser puros");
  assert.equal(snapshot.clubId, "AUR");
  assert.equal(snapshot.asOf, "2026-08-02T00:00:00.000Z");
  assert.deepEqual(snapshot.finance, {
    status: "negative",
    balance: 50_000_000,
    committed: 5_000_000,
    available: 45_000_000,
    transferBudget: 45_000_000,
    transferAvailable: 45_000_000,
    wageBudget: 2_000_000,
    payroll: 45_000,
    debt: 1_000_000,
    income: 10_000_000,
    expense: 2_000_000,
    netCashflow: 8_000_000,
    transactionCount: 2,
    message: null,
  });
  assert.equal(snapshot.nextFixture.id, "managed-r2");
  assert.equal(snapshot.nextFixture.opponentClubName, "Celta");
  assert.equal(snapshot.nextFixture.isHome, false);
  assert.equal(snapshot.recentResults.items.length, 1, "resultado gerenciado nao duplica o resultado da liga");
  assert.equal(snapshot.recentResults.items[0].outcome, "win");
  assert.equal(snapshot.squad.total, 3);
  assert.equal(snapshot.squad.available, 1);
  assert.equal(snapshot.injuries.items[0].name, "Ana");
  assert.equal(snapshot.suspensions.items[0].name, "Bia");
  assert.equal(snapshot.squad.averageCondition, 86);
  assert.equal(snapshot.expiringContracts.items.length, 1);
  assert.equal(snapshot.expiringContracts.items[0].playerName, "Ana");
  assert.deepEqual(snapshot.negotiations.items.map((item) => item.kind).sort(), ["listing", "offer", "scheduled_transfer"]);
  assert.equal(snapshot.activeProjects.items.length, 1);
  assert.equal(snapshot.activeProjects.items[0].remainingDays, 10);
  assert.equal(snapshot.objectives.items[0].id, "objective-1");
  assert.equal(snapshot.messages.items[0].id, "message-1");
  assert.equal(snapshot.staffAlerts.items[0].id, "staff-alert-1");
  assert.equal(snapshot.competitionStatus.position, 1);
  assert.equal(snapshot.competitionStatus.points, 3);
  assert.equal(snapshot.latestNews.items[0].title, "Vitória do Aurora");
  assert.equal(snapshot.latestNews.items[0].read, true);
  assert.equal(snapshot.administrativePending.items.some((item) => item.type === "CONTRACTS_EXPIRING"), true);
});

test("snapshot vazio usa estados vazios claros sem preencher numeros ou alertas", () => {
  const room = { code: "EMPTY", clubCareerState: { unrelated: true } };
  const first = buildCentralSnapshot({ room, clubId: "SEM", managerId: "m1" });
  const second = buildCentralSnapshot({ room, clubId: "SEM", managerId: "m1" });

  assert.deepEqual(first, second, "mesma entrada gera mesmo painel");
  assert.equal(first.asOf, null);
  assert.equal(first.finance.balance, null);
  assert.equal(first.finance.status, "empty");
  assert.equal(first.nextFixture, null);
  assert.equal(first.emptyMessages.nextFixture, CENTRAL_EMPTY_MESSAGES.nextFixture);
  assert.equal(first.recentResults.empty, true);
  assert.equal(first.squad.total, 0);
  assert.equal(first.squad.averageCondition, null);
  assert.equal(first.injuries.message, "Nenhum jogador lesionado");
  assert.equal(first.suspensions.message, "Nenhum jogador suspenso");
  assert.equal(first.expiringContracts.message, "Não há contratos próximos do fim");
  assert.equal(first.negotiations.message, "Nenhuma negociação em andamento");
  assert.equal(first.activeProjects.message, "Nenhuma obra em andamento");
  assert.equal(first.administrativePending.message, "Nenhuma pendência no momento");
  assert.equal(first.competitionStatus.empty, true);
  assert.equal(first.latestNews.message, "Nenhuma notícia da carreira");
  assert.deepEqual(room, { code: "EMPTY", clubCareerState: { unrelated: true } });
});

test("financeiro da Central compartilha saldo canonico do mercado e alerta apenas quando negativo", () => {
  const room = factualRoom();
  let finance = selectClubFinance(room, "A");
  assert.equal(finance.balance, room.marketState.finances[0].balance);
  assert.equal(finance.available, room.marketState.finances[0].balance - room.marketState.finances[0].committed);

  room.marketState.finances[0].balance = -500;
  room.marketState.finances[0].committed = 0;
  finance = selectClubFinance(room, "A");
  const snapshot = buildCentralSnapshot(room, { clubId: "A" });
  assert.equal(finance.status, "negative");
  assert.equal(snapshot.administrativePending.items.some((item) => item.type === "FINANCE_NEGATIVE"), true);
});

test("Central exibe alerta financeiro persistido mesmo com saldo nao negativo", () => {
  const room = factualRoom();
  room.clubCareerState.financialAlerts = [{
    id: "finance-alert:A:2026-08",
    clubId: "A",
    type: "monthly_budget_insufficient",
    periodKey: "2026-08",
    occurredAt: "2026-08-31T23:59:59.000Z",
    message: "Saldo insuficiente para fechar as obrigacoes mensais.",
  }];

  const snapshot = buildCentralSnapshot(room, { clubId: "A" });

  assert.equal(snapshot.administrativePending.empty, false);
  assert.equal(snapshot.administrativePending.items[0].id, "finance-alert:A:2026-08");
});

test("calendario e tabela hidratam resultados compactos da IA usando a fixture", () => {
  const room = factualRoom();
  const cResults = selectRecentResults(room, "C");
  const dStatus = selectCompetitionStatus(room, "D");

  assert.equal(cResults.length, 1);
  assert.equal(cResults[0].opponentClubName, "Delta");
  assert.equal(cResults[0].outcome, "draw");
  assert.deepEqual(cResults[0].score, [1, 1]);
  assert.equal(dStatus.played, 1);
  assert.equal(dStatus.points, 1);
});

test("proxima fixture respeita currentFixtureId e ignora partidas concluidas", () => {
  const room = factualRoom();
  assert.equal(selectNextFixture(room, "Aurora").id, "managed-r2");
  room.completedFixtureIds.push("managed-r2");
  room.leagueMatchResults.push({ leagueFixtureId: "league-r2-c-a", score: [0, 0], completedAt: "2026-08-09T21:00:00.000Z" });
  assert.equal(selectNextFixture(room, "Aurora"), null);
});

test("elenco considera registro de emprestimo, runtime, contrato por data e por temporada", () => {
  const room = factualRoom();
  room.careerState.players.push({
    id: "loaned", name: "Emprestada", clubId: "B", position: "MEI",
    contract: { clubId: "B", status: "active", endSeason: 1 },
  });
  room.marketState.registrations.push({ playerId: "loaned", permanentClubId: "B", currentClubId: "A" });
  const squad = selectSquadStatus(room, "A");
  const contracts = selectExpiringContracts(room, "A", { squad, asOf: "2026-08-02T00:00:00.000Z" });

  assert.equal(squad.total, 4);
  assert.equal(squad.players.some((player) => player.id === "loaned"), true);
  assert.deepEqual(contracts.map((contract) => contract.playerId).sort(), ["loaned", "p1"]);
});

test("negociacoes, obras e noticias filtram clube e estados terminais", () => {
  const room = factualRoom();
  assert.deepEqual(selectMarketNegotiations(room, "A").map((item) => item.id).sort(), [
    "listing-1", "offer-1", "scheduled-1",
  ]);
  assert.deepEqual(selectActiveProjects(room, "A").map((item) => item.id), ["project-1"]);
  assert.equal(selectCareerNews(room, "B", "manager-b")[0].read, false);
  assert.deepEqual(selectCareerNews(room, "C", "manager-b"), []);
});

test("alertas da comissao derivam somente contratos e satisfacao reais", () => {
  const room = factualRoom();
  room.clubCareerState.staffMembers = [{
    id: "staff-low",
    clubId: "A",
    name: "Renata",
    role: "fitness_coach",
    satisfaction: 30,
  }, {
    id: "staff-ok",
    clubId: "A",
    name: "Claudio",
    role: "assistant_coach",
    satisfaction: 80,
  }, {
    id: "staff-other",
    clubId: "B",
    name: "Outra",
    satisfaction: 10,
  }];
  room.clubCareerState.staffContracts = [{
    id: "staff-contract-low",
    staffId: "staff-low",
    clubId: "A",
    status: "active",
    endDate: "2026-08-12T00:00:00.000Z",
  }, {
    id: "staff-contract-future",
    staffId: "staff-ok",
    clubId: "A",
    status: "active",
    endDate: "2028-08-12T00:00:00.000Z",
  }];

  const alerts = selectStaffAlerts(room, "A", { asOf: "2026-08-02T00:00:00.000Z" });

  assert.deepEqual(alerts.map((alert) => alert.type).sort(), [
    "MEDICAL",
    "STAFF_CONTRACT_EXPIRING",
    "STAFF_DISSATISFIED",
  ]);
  assert.equal(alerts.find((alert) => alert.type === "STAFF_CONTRACT_EXPIRING").remainingDays, 10);
  assert.equal(alerts.find((alert) => alert.type === "STAFF_DISSATISFIED").staffName, "Renata");
  assert.equal(alerts.some((alert) => alert.staffId === "staff-other"), false);
});

test("Central deriva alertas privados e factuais da carreira do treinador", () => {
  const room = factualRoom();
  room.managers = [{ id: "manager-a", clubId: "A", coachId: "coach-human" }, {
    id: "manager-b", clubId: "B", coachId: "coach-other",
  }];
  room.coachEmploymentState = {
    version: 1,
    currentDate: "2026-08-02T00:00:00.000Z",
    coaches: [{
      id: "coach-human", managerId: "manager-a", managerType: "human", currentClubId: "A", name: "Marta",
    }, {
      id: "coach-other", managerId: "manager-b", managerType: "human", currentClubId: "B", name: "Caio",
    }],
    jobSecurity: [{
      coachId: "coach-human", clubId: "A", score: 22, level: "at_risk", label: "em risco",
      updatedAt: "2026-08-01T12:00:00.000Z",
    }],
    contracts: [{
      id: "coach-contract-a", coachId: "coach-human", clubId: "A", status: "active",
      endDate: "2026-08-22T00:00:00.000Z",
    }],
    proposals: [{
      id: "proposal-a", coachId: "coach-human", targetManagerId: "manager-a", status: "pending",
      club: { id: "C", name: "Celta" }, deadline: "2026-08-10T00:00:00.000Z",
      terms: { salary: 99_000_000 },
    }, {
      id: "proposal-private-other", coachId: "coach-other", targetManagerId: "manager-b", status: "pending",
      club: { id: "D", name: "Delta" }, terms: { salary: 1 },
    }],
    interviews: [{
      id: "interview-a", coachId: "coach-human", managerId: "manager-a", status: "awaiting_answers",
      club: { id: "C", name: "Celta" }, deadline: "2026-08-06T00:00:00.000Z",
    }],
    applications: [{
      id: "application-a", coachId: "coach-human", managerId: "manager-a", status: "shortlisted",
      club: { id: "D", name: "Delta" }, vacancyId: "vacancy-d",
    }],
  };

  const before = structuredClone(room);
  const alerts = selectCoachCareerAlerts(room, "A", "manager-a", {
    asOf: "2026-08-02T00:00:00.000Z",
  });
  const snapshot = buildCentralSnapshot(room, { clubId: "A", managerId: "manager-a" });

  assert.deepEqual(room, before, "seletor de carreira deve ser puro");
  assert.deepEqual(alerts.map((alert) => alert.type).sort(), [
    "COACH_APPLICATION_ACTIVE",
    "COACH_CONTRACT_EXPIRING",
    "COACH_INTERVIEW_ACTIVE",
    "COACH_JOB_SECURITY_LOW",
    "COACH_PROPOSAL_RECEIVED",
  ]);
  assert.equal(alerts.every((alert) => alert.route === "coach-career"), true);
  assert.equal(alerts.some((alert) => alert.id.includes("proposal-private-other")), false);
  const proposal = alerts.find((alert) => alert.type === "COACH_PROPOSAL_RECEIVED");
  assert.equal(proposal.title, "Proposta do Celta");
  assert.equal("terms" in proposal, false, "Central não expõe salário ou cláusulas");
  assert.equal(proposal.private, true);
  assert.equal(snapshot.coachCareerAlerts.empty, false);
  assert.equal(snapshot.coachCareerAlerts.items.length, 5);
});

test("Central ignora segurança estável e processos de treinador já encerrados", () => {
  const room = factualRoom();
  room.managers = [{ id: "manager-a", clubId: "A", coachId: "coach-human" }];
  room.coachEmploymentState = {
    currentDate: "2026-08-02T00:00:00.000Z",
    coaches: [{ id: "coach-human", managerId: "manager-a", managerType: "human", currentClubId: "A" }],
    jobSecurity: { coachId: "coach-human", clubId: "A", score: 82, level: "safe" },
    contracts: [{
      id: "contract-future", coachId: "coach-human", clubId: "A", status: "active",
      endDate: "2028-08-02T00:00:00.000Z",
    }],
    proposals: [{ id: "p1", coachId: "coach-human", managerId: "manager-a", status: "rejected" }],
    interviews: [{ id: "i1", coachId: "coach-human", managerId: "manager-a", status: "completed" }],
    applications: [{ id: "a1", coachId: "coach-human", managerId: "manager-a", status: "rejected" }],
  };

  assert.deepEqual(selectCoachCareerAlerts(room, "A", "manager-a"), []);
  assert.equal(buildCentralSnapshot(room, { clubId: "A", managerId: "manager-a" }).coachCareerAlerts.empty, true);
});
