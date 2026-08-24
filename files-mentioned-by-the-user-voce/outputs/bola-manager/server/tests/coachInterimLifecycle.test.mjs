import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmInterimCoach,
  ensureCoachEmploymentState,
  processCoachEmploymentDate,
  resignCoach,
  validateCoachEmploymentState,
} from "../game/coachEmployment.mjs";

const NOW = "2026-07-21T12:00:00.000Z";

function assignment(clubId, coachId) {
  return {
    clubId,
    coachId,
    role: "head_coach",
    entryReason: "season_start",
    startedSeason: 1,
    startedRound: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedSeason: null,
    endedRound: null,
    endedAt: null,
  };
}

function roomFixture() {
  return {
    code: "INTERIM01",
    currentSeason: 1,
    seasonYear: 2026,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastCompletedRound: { round: 4 },
    managers: [],
    competitionCatalog: [{
      id: "L1",
      name: "Liga",
      active: true,
      clubs: [
        { id: "A", name: "Aurora", reputation: 18 },
        { id: "B", name: "Boreal", reputation: 14 },
      ],
    }],
    coachCareerState: {
      version: 1,
      coaches: [{
        id: "ai-a",
        name: "Treinador Aurora",
        managerType: "ai",
        status: "employed",
        currentClubId: "A",
        assignments: [assignment("A", "ai-a")],
      }, {
        id: "ai-b",
        name: "Treinador Boreal",
        managerType: "ai",
        status: "employed",
        currentClubId: "B",
        assignments: [assignment("B", "ai-b")],
      }],
    },
    clubCareerState: {
      currentDate: NOW,
      staffMembers: [{
        id: "assistant-best",
        clubId: "B",
        role: "assistant_coach",
        name: "Auxiliar Melhor",
        status: "employed",
        salary: 40_000,
        reputation: 72,
        affinity: 80,
        satisfaction: 90,
        attributes: { tactical: 18, coaching: 17, manManagement: 18, motivation: 16 },
        availability: { status: "available" },
      }, {
        id: "assistant-unavailable",
        clubId: "B",
        role: "assistant_coach",
        name: "Auxiliar Afastado",
        status: "on_leave",
        salary: 70_000,
        reputation: 99,
        attributes: { tactical: 20, coaching: 20, manManagement: 20, motivation: 20 },
        availability: { status: "on_leave" },
      }, {
        id: "youth-low",
        clubId: "B",
        role: "youth_coach",
        name: "Treinador da Base",
        status: "employed",
        salary: 25_000,
        reputation: 45,
        attributes: { tactical: 10, coaching: 11, manManagement: 9, motivation: 10 },
        availability: { status: "available" },
      }],
    },
    marketState: {
      finances: [{ clubId: "A", balance: 100_000_000 }, { clubId: "B", balance: 80_000_000 }],
    },
    clubMoraleStates: [{ clubId: "A", score: 70 }, { clubId: "B", score: 65 }],
  };
}

function createInterim() {
  return resignCoach(roomFixture(), {
    operationId: "interim-resignation",
    coachId: "ai-b",
    clubId: "B",
    reason: "end_of_cycle",
  }, {
    now: NOW,
    autoDismissAI: false,
    autoResignAI: false,
  });
}

function activeAt(room, clubId) {
  return room.coachEmploymentState.appointments.find((appointment) => (
    appointment.status === "active" && appointment.clubId === clubId
  ));
}

test("promove auxiliar elegivel mais bem ranqueado e paga bonus uma unica vez", () => {
  const outcome = createInterim();
  const interim = outcome.interimAppointment;
  assert.equal(interim.role, "interim");
  assert.equal(interim.sourceStaffId, "assistant-best");
  assert.equal(interim.selectionReason, "best_eligible_staff_member");
  assert.ok(interim.selectionScore > 0);
  assert.equal(interim.startedAt, NOW);
  assert.ok(interim.expectedEndAt);
  assert.equal(interim.initialExpectedEndAt, interim.expectedEndAt);
  assert.equal(interim.temporaryWageBonus, 8_000);
  assert.equal(interim.authorityLevel, 55);
  assert.equal(interim.canBeConfirmed, true);
  assert.ok(interim.temporaryBonusPaidAt);
  const bonus = outcome.financialTransactions.find(({ category }) => category === "coach_interim_bonus");
  assert.equal(bonus?.amount, 8_000);
  assert.equal(bonus?.id, interim.temporaryBonusTransactionId);

  const replay = resignCoach(outcome.room, {
    operationId: "interim-resignation",
    coachId: "ai-b",
  }, { now: NOW });
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.financialTransactions, []);
  assert.equal(validateCoachEmploymentState(replay.room), true);
});

test("interino recebe estatisticas e avaliacao exclusivas sem efetivacao automatica", () => {
  const started = createInterim();
  started.room.lastCompletedRound = { round: 6 };
  started.room.leagueFixtureSchedule = [
    { leagueFixtureId: "r5", leagueId: "L1", round: 5, homeClubId: "B", awayClubId: "A" },
    { leagueFixtureId: "r6", leagueId: "L1", round: 6, homeClubId: "A", awayClubId: "B" },
  ];
  started.room.leagueMatchResults = [
    { leagueFixtureId: "r5", score: [2, 0] },
    { leagueFixtureId: "r6", score: [1, 1] },
  ];
  const processed = processCoachEmploymentDate(started.room, "2026-07-22T12:00:00.000Z", {
    minimumGames: 1,
    minimumVacancyDays: 999,
    autoDismissAI: false,
    autoResignAI: false,
    autoRenewAI: false,
  });
  const interim = activeAt(processed.room, "B");
  assert.equal(interim.role, "interim");
  assert.deepEqual(interim.statistics, {
    games: 2,
    points: 4,
    wins: 1,
    draws: 1,
    losses: 0,
    goalsFor: 3,
    goalsAgainst: 1,
    pointsPerGame: 2,
    updatedAt: "2026-07-22T12:00:00.000Z",
  });
  const evaluation = processed.room.coachEmploymentState.evaluations.find(({ appointmentId }) => (
    appointmentId === interim.id
  ));
  assert.equal(evaluation?.role, "interim");
  assert.equal(evaluation?.games, 2);
  assert.equal(evaluation?.wins, 1);
  assert.equal(processed.events.some(({ type }) => type === "COACH_INTERIM_EVALUATED"), true);
  assert.equal(processed.events.some(({ type }) => type === "COACH_INTERIM_CONFIRMED"), false);
  assert.equal(processed.financialTransactions.some(({ category }) => category === "coach_interim_bonus"), false);
});

test("confirmacao explicita cria contrato principal, fecha vaga e e idempotente", () => {
  const started = createInterim();
  const interimId = started.interimAppointment.id;
  const confirmed = confirmInterimCoach(started.room, {
    operationId: "confirm-interim",
    appointmentId: interimId,
    clubId: "B",
    wage: 95_000,
    durationYears: 3,
    terminationClause: 600_000,
    signingBonus: 15_000,
  }, { now: "2026-07-23T12:00:00.000Z" });

  assert.equal(confirmed.interimAppointment.status, "ended");
  assert.equal(confirmed.interimAppointment.exitReason, "interim_confirmed");
  assert.equal(confirmed.interimAppointment.confirmedAppointmentId, confirmed.appointment.id);
  assert.equal(confirmed.appointment.role, "head_coach");
  assert.equal(confirmed.appointment.entryReason, "interim_confirmed");
  assert.equal(confirmed.appointment.sourceStaffId, "assistant-best");
  assert.equal(confirmed.contract.role, "head_coach");
  assert.equal(confirmed.contract.status, "active");
  assert.equal(confirmed.contract.wage, 95_000);
  assert.equal(confirmed.previousContract.status, "terminated");
  assert.equal(confirmed.vacancy.status, "filled");
  assert.equal(confirmed.events.some(({ type }) => type === "COACH_INTERIM_CONFIRMED"), true);
  assert.equal(confirmed.financialTransactions.find(({ category }) => category === "coach_hiring")?.amount, 15_000);
  assert.equal(confirmed.room.coachEmploymentState.appointments.filter(({ status, clubId }) => (
    status === "active" && clubId === "B"
  )).length, 1);
  assert.equal(confirmed.room.clubCareerState.staffMembers.find(({ id }) => id === "assistant-best")
    .availability.status, "head_coach");
  assert.equal(confirmed.room.clubCareerState.staffMembers.find(({ id }) => id === "assistant-best")
    .interimAssignment.status, "ended");
  assert.equal(confirmed.room.clubCareerState.staffMembers.find(({ id }) => id === "assistant-best")
    .interimAssignment.endReason, "promoted_to_head_coach");
  assert.equal(validateCoachEmploymentState(confirmed.room), true);

  const replay = confirmInterimCoach(confirmed.room, {
    operationId: "confirm-interim",
    appointmentId: interimId,
    clubId: "B",
  }, { now: "2026-07-23T12:00:00.000Z" });
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.financialTransactions, []);
  assert.equal(replay.room.coachEmploymentState.appointments.filter(({ status, clubId }) => (
    status === "active" && clubId === "B"
  )).length, 1);
});

test("prazo vencido prorroga interino com auditoria sem autoefetivar", () => {
  const started = createInterim();
  const interim = activeAt(started.room, "B");
  interim.expectedEndAt = "2026-07-22T12:00:00.000Z";
  interim.initialExpectedEndAt = interim.expectedEndAt;
  for (const coach of started.room.coachCareerState.coaches) {
    if (coach.id !== interim.coachId && coach.currentClubId == null) coach.status = "retired";
  }
  const processed = processCoachEmploymentDate(started.room, "2026-07-23T12:00:00.000Z", {
    interimExtensionDays: 30,
    minimumGames: 30,
    minimumVacancyDays: 999,
    autoDismissAI: false,
    autoResignAI: false,
    autoRenewAI: false,
  });
  const extended = activeAt(processed.room, "B");
  assert.equal(extended.role, "interim");
  assert.equal(extended.expectedEndAt, "2026-08-22T12:00:00.000Z");
  assert.equal(extended.extensionCount, 1);
  assert.equal(extended.extensionHistory.length, 1);
  assert.equal(extended.extensionHistory[0].previousExpectedEndAt, "2026-07-22T12:00:00.000Z");
  assert.equal(processed.room.coachEmploymentState.vacancies.find(({ clubId }) => clubId === "B").status, "open");
  assert.equal(processed.events.filter(({ type }) => type === "COACH_INTERIM_EXTENDED").length, 1);
  assert.equal(processed.events.some(({ type }) => type === "COACH_INTERIM_CONFIRMED"), false);

  const replay = processCoachEmploymentDate(processed.room, "2026-07-23T12:00:00.000Z", {
    interimExtensionDays: 30,
    minimumGames: 30,
    minimumVacancyDays: 999,
    autoDismissAI: false,
    autoResignAI: false,
    autoRenewAI: false,
  });
  assert.equal(activeAt(replay.room, "B").extensionCount, 1);
  assert.equal(replay.events.some(({ type }) => type === "COACH_INTERIM_EXTENDED"), false);
  assert.equal(validateCoachEmploymentState(replay.room), true);
});
