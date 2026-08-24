import test from "node:test";
import assert from "node:assert/strict";

import { roomForViewer } from "../services/roomVisibility.mjs";

const NOW = "2026-08-10T12:00:00.000Z";

function privateRoom() {
  return {
    code: "BOLA-PRIV",
    managers: [
      { id: "manager-a", name: "Ana", clubId: "AUR" },
      { id: "manager-b", name: "Bia", clubId: "SAN" },
    ],
    competitionCatalog: [{
      id: "league-1",
      name: "Liga",
      clubs: [
        { id: "AUR", code: "AFC", name: "Aurora" },
        { id: "SAN", code: "SFC", name: "Santos" },
      ],
    }],
    lineups: [],
    clubCareerState: {
      version: 3,
      currentDate: NOW,
      financialTransactions: [
        { id: "tx-a", clubId: "Aurora", amount: 10 },
        { id: "tx-b-private", clubId: "SAN", amount: 999_999 },
      ],
      financialAggregates: {
        version: 1,
        monthly: [{ clubId: "AUR", periodKey: "2026-08", income: 10 }, { clubId: "SAN", periodKey: "2026-08", income: 999_999 }],
        yearly: [{ clubId: "AFC", year: 2026, income: 10 }, { clubId: "SFC", year: 2026, income: 999_999 }],
        totals: [{ clubId: "Aurora", income: 10 }, { clubId: "Santos", income: 999_999 }],
      },
      financeProfiles: [
        { clubId: "AFC", balance: 100, sponsors: [{ annualValue: 10 }] },
        { clubId: "Santos", balance: 999_999, sponsors: [{ annualValue: 888_888 }] },
      ],
      lastFinancialPeriodByClub: { AUR: "2026-08", SAN: "2026-08" },
      financialAlerts: [
        { id: "alert-a", clubId: "AUR", message: "alerta proprio" },
        { id: "alert-b-private", clubId: "SAN", message: "divida secreta" },
      ],
      clubFacilities: [
        {
          clubId: "AUR",
          stadium: { name: "Arena Aurora", capacity: 20_000, maintenanceCost: 123 },
          areas: [{ id: "analysis", level: 5 }, { id: "pitch", level: 2, maxLevel: 5 }],
        },
        {
          clubId: "SAN",
          stadium: {
            name: "Vila Publica",
            capacity: 16_000,
            maintenanceCost: 987_654,
            totalMatchRevenue: 456_789,
          },
          areas: [{ id: "analysis", level: 5, activeProjectId: "secret-project-b" }],
        },
      ],
      facilityProjects: [
        { id: "project-a", clubId: "AUR", areaId: "stands", cost: 10 },
        { id: "secret-project-b", clubId: "SAN", areaId: "analysis", cost: 999 },
      ],
      staffSchemaVersion: 2,
      staffMembers: [
        {
          id: "staff-a", clubId: "AUR", name: "Auxiliar A", salary: 20_000,
          professionalHistory: [{ clubId: "AUR" }],
        },
        {
          id: "staff-b-private", clubId: "SAN", name: "Auxiliar B", salary: 777_777,
          professionalHistory: [{ clubId: "SAN", reason: "segredo" }],
        },
      ],
      staffCandidates: [
        {
          id: "candidate-free", clubId: null, contractId: null, name: "Livre", salary: 30_000,
          status: "free_agent", professionalHistory: [{ clubId: "SAN", reason: "passado" }],
        },
        { id: "candidate-stale-private", clubId: "SAN", name: "Empregado", salary: 66_666 },
      ],
      staffContracts: [
        { id: "contract-a", staffId: "staff-a", clubId: "AUR", wage: 20_000 },
        { id: "contract-b-private", staffId: "staff-b-private", clubId: "SAN", wage: 777_777 },
      ],
      staffHistory: [
        { id: "history-a", clubId: "AUR", amount: 20_000 },
        { id: "history-b-private", clubId: "SAN", amount: 777_777 },
      ],
      staffEffectsByClub: {
        AUR: { tacticalAnalysisBonus: 1, sourceStaffIds: ["staff-a"] },
        SAN: { tacticalAnalysisBonus: 9, sourceStaffIds: ["staff-b-private"] },
      },
      staffInitializedClubIds: ["AUR", "SAN"],
      processedStaffOperationIds: ["hire-a", "hire-b-private"],
      events: [{ id: "private-event", payload: { opponentPayroll: 777_777 } }],
      news: [{
        id: "news-1",
        title: "Noticia publica",
        readByManagerIds: ["manager-a", "manager-b"],
        readAtByManagerId: { "manager-a": NOW, "manager-b": "2026-08-11T00:00:00.000Z" },
      }],
      processedEventIds: ["private-event"],
      futurePrivateAggregate: { secret: "must-not-leak" },
    },
    coachCareerState: {
      version: 1,
      coaches: [{
        id: "manager-a",
        name: "Ana",
        managerType: "human",
        status: "employed",
        currentClubId: "AUR",
        salary: 73_456_789,
        expectedSalary: 74_456_789,
        contractId: "PUBLIC_CAREER_CONTRACT_SECRET",
        privateClause: "PUBLIC_CAREER_PRIVATE_CLAUSE",
        assignments: [{
          clubId: "AUR",
          startedSeason: 1,
          startedRound: 1,
          startedAt: "2026-07-01T00:00:00.000Z",
          endedSeason: null,
          endedRound: null,
          endedAt: null,
          wage: 73_456_789,
          contractId: "PUBLIC_ASSIGNMENT_CONTRACT_SECRET",
        }],
      }],
      awards: [{ id: "coach-award-public", managerId: "manager-a", title: "Campeã" }],
    },
    coachEmploymentState: {
      version: 1,
      contracts: [{
        id: "coach-contract-private",
        coachId: "manager-a",
        clubId: "AUR",
        status: "active",
        salary: 73_456_789,
        privateClause: "EMPLOYMENT_SECRET_CONTRACT",
        endDate: "2029-12-31T00:00:00.000Z",
      }],
      proposals: [{
        id: "coach-proposal-private",
        coachId: "manager-b",
        targetManagerId: "manager-b",
        status: "pending",
        terms: { salary: 87_654_321 },
        message: "EMPLOYMENT_SECRET_PROPOSAL",
      }],
      interviews: [{
        id: "coach-interview-private",
        coachId: "manager-b",
        managerId: "manager-b",
        status: "awaiting_answers",
        answers: [{ questionId: "q1", text: "EMPLOYMENT_SECRET_INTERVIEW" }],
      }],
    },
    staffMembers: [{ id: "legacy-staff-b", clubId: "SAN", salary: 999_999 }],
    financialAlerts: [{ id: "legacy-alert-b", clubId: "SAN" }],
  };
}

test("snapshot da sala expoe somente agregados privados do clube do viewer", () => {
  const room = privateRoom();
  room.professionalLifecycleState = {
    notices: [{
      id: "notice-a",
      professionalType: "staff",
      professionalId: "staff-a",
      clubId: "AUR",
      status: "active",
      startDate: NOW,
      expectedEndDate: "2026-09-10T12:00:00.000Z",
    }, {
      id: "notice-b-private",
      professionalType: "staff",
      professionalId: "staff-b-private",
      clubId: "SAN",
      status: "active",
      startDate: NOW,
      expectedEndDate: "2026-09-10T12:00:00.000Z",
    }],
  };
  room.professionalLeaveState = {
    leaves: [{
      id: "leave-a",
      professionalType: "staff",
      professionalId: "staff-a",
      clubId: "AUR",
      contractId: "contract-a",
      status: "active",
      reason: "medical",
      requestedAt: NOW,
      startsAt: NOW,
      expectedEndAt: "2026-09-10T12:00:00.000Z",
      contractRemainsActive: true,
      payment: { type: "partial", rate: 0.6, monthlyWage: 20_000 },
    }, {
      id: "leave-b-private",
      professionalType: "staff",
      professionalId: "staff-b-private",
      clubId: "SAN",
      contractId: "contract-b-private",
      status: "active",
      reason: "PRIVATE_LEAVE_REASON",
      requestedAt: NOW,
      startsAt: NOW,
      expectedEndAt: "2026-09-10T12:00:00.000Z",
      contractRemainsActive: true,
      payment: { type: "full", rate: 1, monthlyWage: 777_777 },
    }],
  };
  const visible = roomForViewer(room, "manager-a");
  const state = visible.clubCareerState;

  assert.deepEqual(state.financialTransactions.map(({ id }) => id), ["tx-a"]);
  assert.deepEqual(state.financialAggregates.monthly.map(({ clubId }) => clubId), ["AUR"]);
  assert.deepEqual(state.financialAggregates.yearly.map(({ clubId }) => clubId), ["AFC"]);
  assert.deepEqual(state.financialAggregates.totals.map(({ clubId }) => clubId), ["Aurora"]);
  assert.deepEqual(state.financeProfiles.map(({ clubId }) => clubId), ["AFC"]);
  assert.deepEqual(Object.keys(state.lastFinancialPeriodByClub), ["AUR"]);
  assert.deepEqual(state.financialAlerts.map(({ id }) => id), ["alert-a"]);
  assert.deepEqual(state.facilityProjects.map(({ id }) => id), ["project-a"]);
  assert.deepEqual(state.staffMembers.map(({ id }) => id), ["staff-a"]);
  assert.deepEqual(state.staffContracts.map(({ id }) => id), ["contract-a"]);
  assert.deepEqual(state.staffHistory.map(({ id }) => id), ["history-a"]);
  assert.deepEqual(Object.keys(state.staffEffectsByClub), ["AUR"]);
  assert.deepEqual(state.professionalLifecycle.map(({ id }) => id), ["notice-a", "leave-a"]);
  assert.equal(state.professionalLifecycle[1].leaveStatus, "active");
  assert.equal(state.professionalLifecycle[1].contractRemainsActive, true);
  assert.equal("professionalLeaveState" in visible, false);
  assert.equal(JSON.stringify(visible).includes("PRIVATE_LEAVE_REASON"), false);

  const ownFacility = state.clubFacilities.find(({ clubId }) => clubId === "AUR");
  const opponentFacility = state.clubFacilities.find(({ clubId }) => clubId === "SAN");
  assert.equal(ownFacility.areas[0].level, 5);
  assert.equal(ownFacility.areas[0].upgradeStatus, "max");
  assert.equal(ownFacility.areas[0].nextUpgradeQuote, null);
  assert.deepEqual(ownFacility.areas[1].nextUpgradeQuote, {
    areaId: "pitch",
    name: "Gramado",
    category: "stadium",
    currentLevel: 2,
    nextLevel: 3,
    cost: 4_992_000,
    durationDays: 45,
    maintenanceIncrease: 65_000,
    benefit: "pitch",
    benefitLabel: "Menor risco de lesao",
  });
  assert.deepEqual(opponentFacility, {
    clubId: "SAN",
    stadium: { name: "Vila Publica", capacity: 16_000 },
  });

  assert.deepEqual(state.staffCandidates.map(({ id }) => id), ["candidate-free"]);
  assert.equal(state.staffCandidates[0].salary, 30_000, "pretensao de candidato livre continua publica");
  assert.deepEqual(state.staffCandidates[0].professionalHistory, []);
  assert.deepEqual(state.events, []);
  assert.deepEqual(state.processedEventIds, []);
  assert.deepEqual(state.processedStaffOperationIds, []);
  assert.equal("futurePrivateAggregate" in state, false, "campos futuros sao privados por padrao");
  assert.equal("staffMembers" in visible, false, "estado legado privado tambem e removido");
  assert.equal("financialAlerts" in visible, false);

  assert.deepEqual(state.news[0].readByManagerIds, ["manager-a"]);
  assert.deepEqual(state.news[0].readAtByManagerId, { "manager-a": NOW });
  assert.equal(room.clubCareerState.staffMembers.length, 2, "snapshot nao altera a sala persistida");
  assert.equal("nextUpgradeQuote" in room.clubCareerState.clubFacilities[0].areas[1], false);
});

test("viewer sem clube recebe somente informacao publica", () => {
  const visible = roomForViewer(privateRoom(), "spectator");
  const state = visible.clubCareerState;

  for (const field of [
    "financialTransactions", "financeProfiles", "financialAlerts", "facilityProjects",
    "staffMembers", "staffContracts", "staffHistory",
  ]) {
    assert.deepEqual(state[field], [], field);
  }
  assert.deepEqual(state.lastFinancialPeriodByClub, {});
  assert.deepEqual(state.financialAggregates.monthly, []);
  assert.deepEqual(state.financialAggregates.yearly, []);
  assert.deepEqual(state.financialAggregates.totals, []);
  assert.deepEqual(state.staffEffectsByClub, {});
  assert.deepEqual(state.clubFacilities[1], {
    clubId: "SAN",
    stadium: { name: "Vila Publica", capacity: 16_000 },
  });
  assert.deepEqual(state.news[0].readByManagerIds, []);
  assert.deepEqual(state.news[0].readAtByManagerId, {});
});

test("snapshot do viewer omite historicos extensos e preserva somente contagens", () => {
  const room = privateRoom();
  room.completedFixtureIds = ["F1", "F2", "F3"];
  room.completedMatches = Array.from({ length: 10_000 }, (_, index) => ({ id: `M${index}` }));
  room.seasonHistory = Array.from({ length: 120 }, (_, index) => ({ season: index + 1 }));
  room.careerState = { statistics: { payload: "privado" } };
  room.marketState = { transactions: [{ id: "tx-private" }] };

  const visible = roomForViewer(room, "manager-a");

  assert.equal("completedMatches" in visible, false);
  assert.equal("seasonHistory" in visible, false);
  assert.equal("careerState" in visible, false);
  assert.equal("marketState" in visible, false);
  assert.equal(visible.completedFixtureCount, 3);
  assert.equal(visible.completedMatchCount, 10_000);
  assert.equal(visible.seasonHistoryCount, 120);
  assert.equal(room.completedMatches.length, 10_000, "projecao nao altera o save");
});

test("emprego privado do treinador nunca sai no snapshot e carreira publica permanece", () => {
  const room = privateRoom();
  const publicCareer = structuredClone(room.coachCareerState);
  const privateEmployment = structuredClone(room.coachEmploymentState);

  const visible = roomForViewer(room, "manager-a");
  const serialized = JSON.stringify(visible);

  assert.equal("coachEmploymentState" in visible, false);
  assert.equal(visible.coachCareerState.coaches[0].status, "employed");
  assert.deepEqual(visible.coachCareerState.awards, publicCareer.awards);
  assert.equal(serialized.includes("EMPLOYMENT_SECRET_CONTRACT"), false);
  assert.equal(serialized.includes("EMPLOYMENT_SECRET_PROPOSAL"), false);
  assert.equal(serialized.includes("EMPLOYMENT_SECRET_INTERVIEW"), false);
  assert.equal(serialized.includes("PUBLIC_CAREER_CONTRACT_SECRET"), false);
  assert.equal(serialized.includes("PUBLIC_CAREER_PRIVATE_CLAUSE"), false);
  assert.equal(serialized.includes("PUBLIC_ASSIGNMENT_CONTRACT_SECRET"), false);
  assert.equal(serialized.includes("coach-contract-private"), false);
  assert.equal(serialized.includes("coach-proposal-private"), false);
  assert.equal(serialized.includes("coach-interview-private"), false);
  assert.equal("salary" in visible.coachCareerState.coaches[0], false);
  assert.equal("expectedSalary" in visible.coachCareerState.coaches[0], false);
  assert.equal("wage" in visible.coachCareerState.coaches[0].assignments[0], false);
  assert.deepEqual(room.coachEmploymentState, privateEmployment, "filtro não altera o estado persistido");
  assert.deepEqual(room.coachCareerState, publicCareer);
});
