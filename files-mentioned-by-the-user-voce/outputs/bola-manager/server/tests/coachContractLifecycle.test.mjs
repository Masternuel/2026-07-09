import assert from "node:assert/strict";
import test from "node:test";
import {
  CoachEmploymentError,
  applyForCoachVacancy,
  dismissCoach,
  ensureCoachEmploymentState,
  previewCoachResignation,
  processCoachEmploymentDate,
  renewCoachContract,
  resignCoach,
  respondCoachInterview,
  respondCoachProposal,
  validateCoachEmploymentState,
} from "../game/coachEmployment.mjs";

const NOW = "2026-07-21T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1_000;

const CONDUCT_CONFIG = Object.freeze({
  baseReputationPenalty: 4,
  pendingProjectPenalty: 3,
  earlyContractPenalty: 2,
  midSeasonPenalty: 2,
  repeatedResignationPenalty: 2,
  maximumReputationPenalty: 15,
  justifiedCauseMultiplier: 0.25,
  baseInactivityDays: 45,
  pendingProjectInactivityDays: 15,
  midSeasonInactivityDays: 10,
  repeatedResignationInactivityDays: 30,
  justifiedInactivityDays: 7,
  minimumInactivityDays: 7,
  maximumInactivityDays: 180,
  contractCompletionRecovery: 3,
  titleRecovery: 4,
});

function assignment(clubId, startedAt = "2026-01-01T00:00:00.000Z") {
  return {
    clubId,
    startedSeason: 1,
    startedRound: 1,
    startedAt,
    endedSeason: null,
    endedRound: null,
    endedAt: null,
    role: "head_coach",
    entryReason: "season_start",
  };
}

function coachProfile(id, name, managerType, clubId) {
  return {
    id,
    name,
    managerType,
    status: "employed",
    currentClubId: clubId,
    reputation: 70,
    marketReputation: 70,
    professionalTrust: 80,
    license: "CONMEBOL_PRO",
    experienceYears: 12,
    professionalExperienceYears: 10,
    domesticExperienceYears: 8,
    languages: ["Português"],
    nationality: "Brasil",
    expectedSalary: 100_000,
    preferredFormation: "4-3-3",
    style: "balanced",
    achievements: { nationalTitles: 2, cups: 1, promotions: 1, youthDevelopment: 75 },
    assignments: [assignment(clubId)],
  };
}

function roomFixture() {
  const room = ensureCoachEmploymentState({
    code: "COACH-LIFECYCLE",
    currentSeason: 1,
    seasonYear: 2026,
    totalRounds: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastCompletedRound: { round: 5 },
    managers: [{ id: "human", name: "Emanuel", clubId: "A", ready: true }],
    lineups: [{ managerId: "human", clubId: "A", lineupIds: ["p1"] }],
    matchReadiness: { fixtureId: "round-6", managerIds: ["human"] },
    competitionCatalog: [{
      id: "BR-A",
      name: "Liga Nacional",
      country: "Brasil",
      divisionOrder: 1,
      active: true,
      clubs: [
        { id: "A", code: "A", name: "Aurora", reputation: 70, country: "Brasil", leagueId: "BR-A" },
        { id: "B", code: "B", name: "Boreal", reputation: 65, country: "Brasil", leagueId: "BR-A" },
      ],
    }],
    coachCareerState: {
      version: 1,
      coaches: [
        coachProfile("human", "Emanuel", "human", "A"),
        coachProfile("ai-b", "Tecnico Boreal", "ai", "B"),
      ],
    },
    clubCareerState: { currentDate: NOW },
    marketState: {
      finances: [
        { clubId: "A", balance: 100_000_000 },
        { clubId: "B", balance: 100_000_000 },
      ],
    },
    clubMoraleStates: [
      { clubId: "A", score: 70 },
      { clubId: "B", score: 70 },
    ],
  }, { now: NOW });

  room.coachEmploymentState.conductConfig = { ...CONDUCT_CONFIG };
  for (const contract of room.coachEmploymentState.contracts.filter(({ status }) => status === "active")) {
    contract.startDate = "2026-01-01T00:00:00.000Z";
    contract.endDate = "2027-12-31T23:59:59.999Z";
    contract.wage = 100_000;
    contract.terminationClause = 600_000;
    contract.objectives = [{ id: "continental", label: "Classificar para torneio continental", status: "pending" }];
  }
  return room;
}

function coach(room, coachId) {
  return room.coachCareerState.coaches.find(({ id }) => id === coachId);
}

function activeContract(room, coachId) {
  return room.coachEmploymentState.contracts.find(({ coachId: id, status }) => id === coachId && status === "active");
}

function domainError(code) {
  return (error) => error instanceof CoachEmploymentError && error.code === code;
}

test("saida voluntaria injustificada reduz reputacao e confianca e cria inatividade auditavel", () => {
  const room = roomFixture();
  const preview = previewCoachResignation(room, {
    coachId: "human",
    reasonCode: "new_challenge",
    reason: "Desejo assumir outro projeto",
  }, { now: NOW, conductConfig: CONDUCT_CONFIG });

  const result = resignCoach(room, {
    operationId: "resign-unjustified",
    coachId: "human",
    reasonCode: "new_challenge",
    reason: "Desejo assumir outro projeto",
  }, { now: NOW, conductConfig: CONDUCT_CONFIG });
  const updated = coach(result.room, "human");
  const event = result.events.find(({ type }) => type === "COACH_RESIGNED");

  assert.equal(preview.justCauseVerified, false);
  assert.equal(result.consequences.reputationDelta, -11);
  assert.equal(result.consequences.trustDelta, -17);
  assert.equal(result.consequences.inactivityDays, 66);
  assert.equal(updated.reputation, 59);
  assert.equal(updated.marketReputation, 59);
  assert.equal(updated.professionalTrust, 63);
  assert.equal(updated.marketRestriction.signingBlocked, true);
  assert.equal(updated.marketRestriction.endsAt, result.consequences.restrictionEndsAt);
  assert.equal(updated.resignationHistory.length, 1);
  assert.equal(updated.reputationHistory.length, 1);
  assert.equal(updated.careerConductHistory.at(-1).operationId, "resign-unjustified");
  assert.equal(event.payload.reputationDelta, -11);
  assert.equal(event.payload.inactivityDays, 66);
  assert.equal(validateCoachEmploymentState(result.room), true);
});

test("justa causa comprovada reduz perda, inatividade e compensacao", () => {
  const unjustifiedRoom = roomFixture();
  const unjustified = resignCoach(unjustifiedRoom, {
    operationId: "resign-no-proof",
    coachId: "human",
    reasonCode: "persistent_financial_crisis",
  }, { now: NOW, conductConfig: CONDUCT_CONFIG });

  const justifiedRoom = roomFixture();
  justifiedRoom.marketState.finances.find(({ clubId }) => clubId === "A").balance = -1;
  const justified = resignCoach(justifiedRoom, {
    operationId: "resign-with-proof",
    coachId: "human",
    reasonCode: "persistent_financial_crisis",
  }, { now: NOW, conductConfig: CONDUCT_CONFIG });

  assert.equal(unjustified.consequences.justCauseVerified, false);
  assert.equal(justified.consequences.justCauseVerified, true);
  assert.equal(justified.consequences.reputationDelta, -3);
  assert.equal(justified.consequences.inactivityDays, 7);
  assert.equal(justified.penalty, 90_000);
  assert.ok(Math.abs(justified.consequences.reputationDelta) < Math.abs(unjustified.consequences.reputationDelta));
  assert.ok(justified.consequences.inactivityDays < unjustified.consequences.inactivityDays);
  assert.ok(justified.penalty < unjustified.penalty);
  assert.deepEqual(justified.consequences.evidenceCodes, ["financial_crisis"]);
});

test("inatividade permite candidatura e entrevista, bloqueia assinatura e libera ao expirar", () => {
  const vacated = dismissCoach(roomFixture(), {
    operationId: "dismiss-ai-b-for-vacancy",
    coachId: "ai-b",
    reason: "board_dismissal",
    penalty: 0,
  }, { now: NOW });
  const resigned = resignCoach(vacated.room, {
    operationId: "resign-before-application",
    coachId: "human",
    reasonCode: "new_challenge",
  }, { now: NOW, conductConfig: CONDUCT_CONFIG });
  const vacancy = resigned.room.coachEmploymentState.vacancies.find(({ clubId, status }) => (
    clubId === "B" && status === "open"
  ));
  assert.ok(vacancy);

  vacancy.desiredProfile = {
    ...vacancy.desiredProfile,
    strictness: 20,
    license: { minimum: "C", acceptEquivalent: true, equivalents: [] },
    experience: { minimumYears: 0, professionalYears: 0, currentDivisionYears: 0 },
    achievements: { nationalTitles: 0, cups: 0, promotions: 0, youthDevelopment: 0 },
    salary: { minimum: 50_000, ideal: 100_000, maximum: 300_000, flexible: true },
  };

  const applied = applyForCoachVacancy(resigned.room, {
    operationId: "apply-during-restriction",
    coachId: "human",
    vacancyId: vacancy.id,
    message: "Disponivel para conversar",
  }, { now: NOW });
  assert.equal(applied.application.status, "submitted");

  const progressed = processCoachEmploymentDate(applied.room, NOW, {
    minimumGames: 30,
    minimumVacancyDays: 0,
    autoDismissAI: false,
    autoDismissHuman: false,
    autoResignAI: false,
    autoRenewAI: false,
    coachMarketConfig: {
      searchDelayDays: 0,
      shortlistSize: 8,
      simultaneousOffersPerVacancy: 8,
      interviewChance: 100,
      interviewDelayDays: 0,
    },
  });
  const interview = progressed.room.coachEmploymentState.interviews.find(({ applicationId }) => (
    applicationId === applied.application.id
  ));
  assert.ok(interview);

  const interviewed = respondCoachInterview(progressed.room, {
    operationId: "interview-during-restriction",
    coachId: "human",
    interviewId: interview.id,
    decision: "accept",
    answers: interview.questions.map((question) => ({
      questionId: question.id,
      answerId: question.preferredAnswer,
    })),
    proposalExpiresAt: new Date(new Date(resigned.consequences.restrictionEndsAt).getTime() + 2 * DAY_MS).toISOString(),
  }, { now: NOW });
  assert.ok(interviewed.proposal);

  assert.throws(() => respondCoachProposal(interviewed.room, {
    operationId: "sign-during-restriction",
    coachId: "human",
    proposalId: interviewed.proposal.id,
    action: "accept",
  }, { now: NOW }), domainError("COACH_MARKET_RESTRICTION_ACTIVE"));

  const afterRestriction = new Date(new Date(resigned.consequences.restrictionEndsAt).getTime() + 1_000).toISOString();
  const released = processCoachEmploymentDate(interviewed.room, afterRestriction, {
    minimumGames: 30,
    autoDismissAI: false,
    autoDismissHuman: false,
    autoResignAI: false,
    autoRenewAI: false,
  });
  assert.equal(coach(released.room, "human").marketRestriction.signingBlocked, false);
  assert.equal(released.events.some(({ type }) => type === "COACH_MARKET_RESTRICTION_COMPLETED"), true);

  const signed = respondCoachProposal(released.room, {
    operationId: "sign-after-restriction",
    coachId: "human",
    proposalId: interviewed.proposal.id,
    action: "accept",
  }, { now: afterRestriction });
  assert.equal(activeContract(signed.room, "human").clubId, "B");
});

test("contrato cumprido recupera reputacao uma vez e expira sem duplicar auditoria", () => {
  const room = roomFixture();
  const current = activeContract(room, "human");
  current.endDate = "2026-07-22T12:00:00.000Z";
  const before = coach(room, "human").reputation;
  const asOf = "2026-07-23T12:00:00.000Z";

  const expired = processCoachEmploymentDate(room, asOf, {
    minimumGames: 30,
    autoDismissAI: false,
    autoDismissHuman: false,
    autoResignAI: false,
    autoRenewAI: false,
    conductConfig: CONDUCT_CONFIG,
  });
  const updated = coach(expired.room, "human");
  assert.equal(updated.reputation, before + CONDUCT_CONFIG.contractCompletionRecovery);
  assert.equal(updated.status, "unemployed");
  assert.equal(expired.room.coachEmploymentState.contracts.find(({ id }) => id === current.id).status, "expired");
  assert.equal(updated.reputationHistory.filter(({ type }) => type === "contract_completed").length, 1);
  assert.equal(expired.events.some(({ type }) => type === "COACH_REPUTATION_RECOVERED"), true);

  const replay = processCoachEmploymentDate(expired.room, asOf, {
    minimumGames: 30,
    autoDismissAI: false,
    autoDismissHuman: false,
    autoResignAI: false,
    autoRenewAI: false,
    conductConfig: CONDUCT_CONFIG,
  });
  assert.equal(coach(replay.room, "human").reputation, updated.reputation);
  assert.equal(coach(replay.room, "human").reputationHistory.filter(({ type }) => type === "contract_completed").length, 1);
});

test("renovacao persiste todos os termos somente depois do aceite", () => {
  const room = roomFixture();
  const previous = activeContract(room, "human");
  const objectives = [
    { id: "top-four", label: "Terminar entre os quatro primeiros", status: "pending", target: 4 },
    { id: "youth", label: "Promover dois jovens", status: "pending", target: 2 },
  ];
  const opened = renewCoachContract(room, {
    operationId: "renew-complete-terms",
    coachId: "human",
    clubId: "A",
    initiatedBy: "club",
    wage: 350_000,
    durationYears: 3,
    terminationClause: 0,
    signingBonus: 50_000,
    transferBudget: 20_000_000,
    bonuses: { title: 500_000, qualification: 150_000 },
    objectives,
    specialClauses: ["Revisao salarial anual", "Orcamento protegido"],
    responseDays: 20,
  }, { now: NOW });

  assert.equal(opened.contract, null);
  assert.equal(activeContract(opened.room, "human").id, previous.id);
  assert.equal(opened.proposal.transferBudget, 20_000_000);
  assert.deepEqual(opened.proposal.specialClauses, ["Revisao salarial anual", "Orcamento protegido"]);
  opened.room.coachEmploymentState.guarantees.push({
    id: "guarantee-renewal-budget",
    proposalId: opened.proposal.id,
    coachId: "human",
    clubId: "A",
    description: "Manter investimento minimo na base",
    status: "formalized",
    mandatory: true,
    blocksCompletion: true,
    effects: [{ type: "contract_clause", description: "Investimento minimo anual na base" }],
    createdAt: NOW,
    updatedAt: NOW,
    operationId: "renew-complete-terms",
  });
  opened.room.coachEmploymentState.proposals
    .find(({ id }) => id === opened.proposal.id)
    .guaranteeIds.push("guarantee-renewal-budget");

  const renewed = respondCoachProposal(opened.room, {
    operationId: "accept-complete-renewal",
    coachId: "human",
    proposalId: opened.proposal.id,
    action: "accept",
  }, { now: "2026-07-22T12:00:00.000Z" });
  const contract = renewed.contract;

  assert.equal(contract.wage, 350_000);
  assert.equal(contract.terminationClause, 0);
  assert.equal(contract.signingBonus, 50_000);
  assert.equal(contract.transferBudgetCommitment, 20_000_000);
  assert.deepEqual(contract.bonuses, { title: 500_000, qualification: 150_000 });
  assert.deepEqual(contract.guaranteeIds, ["guarantee-renewal-budget"]);
  assert.deepEqual(contract.clauses, [
    "Revisao salarial anual",
    "Orcamento protegido",
    {
      guaranteeId: "guarantee-renewal-budget",
      description: "Investimento minimo anual na base",
      mandatory: true,
    },
  ]);
  assert.deepEqual(contract.objectives.map(({ id, target }) => ({ id, target })), objectives.map(({ id, target }) => ({ id, target })));
  assert.equal(contract.renewalCount, 1);
  assert.equal(renewed.room.coachEmploymentState.contracts.find(({ id }) => id === previous.id).status, "replaced");
  assert.equal(renewed.financialTransactions.find(({ category }) => category === "coach_contract_renewal").amount, 50_000);
  assert.equal(validateCoachEmploymentState(renewed.room), true);
});

test("titulo atual recupera reputacao imediatamente e uma unica vez", () => {
  const room = roomFixture();
  room.competitionSeason = {
    winners: [{
      id: "winner-national-cup-2026",
      tournamentId: "national-cup",
      clubId: "A",
    }],
  };
  const before = coach(room, "human").reputation;
  const progressed = processCoachEmploymentDate(room, NOW, {
    conductOnly: true,
    conductConfig: CONDUCT_CONFIG,
  });

  assert.equal(coach(progressed.room, "human").reputation, before + CONDUCT_CONFIG.titleRecovery);
  assert.equal(progressed.events.some(({ type }) => type === "COACH_REPUTATION_RECOVERED"), true);
  assert.equal(coach(progressed.room, "human").reputationHistory.filter(({ type }) => type === "title_won").length, 1);

  const replay = processCoachEmploymentDate(progressed.room, NOW, {
    conductOnly: true,
    conductConfig: CONDUCT_CONFIG,
  });
  assert.equal(coach(replay.room, "human").reputation, before + CONDUCT_CONFIG.titleRecovery);
  assert.equal(coach(replay.room, "human").reputationHistory.filter(({ type }) => type === "title_won").length, 1);
});

test("renuncia autonoma da IA usa mesmas consequencias calculadas para qualquer treinador", () => {
  const room = roomFixture();
  room.marketState.finances.find(({ clubId }) => clubId === "B").balance = -1;
  room.coachEmploymentState.evaluations.push(...[1, 2, 3].map((round) => ({
    id: `ai-b-financial-pressure-${round}`,
    coachId: "ai-b",
    clubId: "B",
    evaluatedAt: `2026-07-${16 + round}T12:00:00.000Z`,
    seasonNumber: 1,
    round,
    games: 6 + round,
    points: 3 + round,
    position: 8,
    expectedPosition: 4,
    score: 40,
    securityLevel: "pressured",
    recommendation: "review",
    factors: [{ code: "financial_pressure", impact: -5 }],
    minimumGamesMet: true,
    operationId: `ai-b-financial-pressure-${round}`,
  })));
  const expected = previewCoachResignation(room, {
    coachId: "ai-b",
    reasonCode: "persistent_financial_crisis",
  }, { now: NOW, conductConfig: CONDUCT_CONFIG });

  const processed = processCoachEmploymentDate(room, NOW, {
    minimumGames: 30,
    autoDismissAI: false,
    autoDismissHuman: false,
    autoRenewAI: false,
    conductConfig: CONDUCT_CONFIG,
  });
  const updated = coach(processed.room, "ai-b");
  const event = processed.events.find(({ type, coachId }) => type === "COACH_RESIGNED" && coachId === "ai-b");

  assert.ok(event);
  assert.equal(event.payload.source, "autonomous_ai_lifecycle");
  assert.equal(event.payload.justCauseVerified, expected.justCauseVerified);
  assert.equal(event.payload.reputationDelta, expected.reputationDelta);
  assert.equal(event.payload.inactivityDays, expected.inactivityDays);
  assert.equal(updated.marketRestriction.endsAt, expected.restrictionEndsAt);
  assert.equal(updated.resignationHistory.length, 1);
  assert.equal(updated.reputation, 70 + expected.reputationDelta);
  assert.equal(validateCoachEmploymentState(processed.room), true);
});
