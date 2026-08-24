import assert from "node:assert/strict";
import test from "node:test";
import { ensureCoachEmploymentState } from "../game/coachEmployment.mjs";
import { buildCoachCareerSnapshot } from "../services/coachCareerSnapshot.mjs";

const NOW = "2026-07-22T12:00:00.000Z";

function assignment(clubId) {
  return {
    clubId,
    startedSeason: 1,
    startedRound: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedSeason: null,
    endedRound: null,
    endedAt: null,
    role: "head_coach",
    entryReason: "season_start",
  };
}

function roomFixture() {
  const seed = {
    code: "SNAPSHOT",
    currentSeason: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastCompletedRound: { round: 8 },
    managers: [
      { id: "manager-a", name: "Emanuel", clubId: "A" },
      { id: "manager-b", name: "Outro manager", clubId: "B" },
    ],
    competitionCatalog: [{
      id: "BR-A",
      name: "Brasileirão Série A",
      country: "Brasil",
      active: true,
      clubs: [
        { id: "A", name: "Aurora", code: "AUR", reputation: 70, color: "#123456", crestImageUrl: "https://img.test/a.png" },
        { id: "B", name: "Boreal", code: "BOR", reputation: 64, color: "#654321", crestImageUrl: "https://img.test/b.png" },
        { id: "C", name: "Celta", code: "CEL", reputation: 58, color: "#abcdef", crestImageUrl: "https://img.test/c.png" },
      ],
    }],
    coachCareerState: {
      version: 1,
      coaches: [{
        id: "manager-a",
        name: "Emanuel",
        managerType: "human",
        status: "employed",
        currentClubId: "A",
        reputation: 68,
        marketReputation: 71,
        assignments: [assignment("A")],
      }, {
        id: "manager-b",
        name: "Outro manager",
        managerType: "human",
        status: "employed",
        currentClubId: "B",
        reputation: 60,
        assignments: [assignment("B")],
      }],
    },
    clubCareerState: { currentDate: NOW },
    marketState: {
      finances: [
        { clubId: "A", balance: 50_000_000 },
        { clubId: "B", balance: 40_000_000 },
        { clubId: "C", balance: 30_000_000 },
      ],
    },
  };
  const room = ensureCoachEmploymentState(seed, { now: NOW });
  const managerContract = room.coachEmploymentState.contracts.find(({ coachId }) => coachId === "manager-a");
  managerContract.autonomyLevel = 64;
  managerContract.objectiveDifficultyAdjustment = 3;
  managerContract.sourceInterviewId = "interview-origin";
  managerContract.clauses = [{ description: "Autonomia protegida para a base" }];
  managerContract.objectives = [{
    id: "top-four",
    title: "Terminar no top 4",
    status: "active",
    difficultyAdjustment: 3,
  }];
  room.coachEmploymentState.proposals.push({
    id: "proposal-a",
    coachId: "manager-a",
    clubId: "C",
    offeringClubId: "C",
    role: "head_coach",
    wage: 250_000,
    durationYears: 3,
    terminationClause: 900_000,
    interviewId: "interview-proposal-a",
    autonomyDelta: 4,
    priorityDelta: 6,
    objectiveDifficultyDelta: 3,
    objectives: [{ id: "top-six", title: "Terminar no top 6", status: "active" }],
    guarantees: ["orçamento protegido"],
    status: "pending",
    message: "ONLY_A_PROPOSAL",
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: "2026-08-01T12:00:00.000Z",
  }, {
    id: "proposal-b",
    coachId: "manager-b",
    clubId: "C",
    offeringClubId: "C",
    wage: 999_999,
    durationYears: 5,
    status: "pending",
    message: "OTHER_COACH_SECRET",
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: "2026-08-01T12:00:00.000Z",
  });
  room.coachEmploymentState.vacancies.push({
    id: "vacancy-c",
    clubId: "C",
    status: "open",
    reason: "performance_dismissal",
    openedAt: NOW,
    closesAt: "2026-08-10T12:00:00.000Z",
    desiredProfile: {
      version: 3,
      revision: 2,
      tier: "competitive",
      strictness: 72,
      license: { minimum: "CONMEBOL Pro", acceptEquivalent: true, equivalents: ["UEFA Pro"] },
      experience: { minimumYears: 4, professionalYears: 2 },
      geography: { country: "Brasil", requiredLanguages: ["Português"] },
      salary: { ideal: 280_000, maximum: 350_000 },
      achievements: { promotions: 1, youthDevelopment: 60 },
      playingStyle: { preferred: ["possession"], preferredFormation: "4-3-3", youthUsage: "high" },
      squad: { averageAge: 24.5, youthTalents: 5, predominantFormation: "4-3-3" },
      countryKnowledge: { country: "Brasil", leagueRequired: true },
      weights: { license: 12, playingStyle: 18 },
      objective: "Classificar para competição continental",
      availableBudget: 30_000_000,
      squadSummary: "Elenco jovem e competitivo",
      interviewQuestions: [{ id: "private-question", preferredAnswer: "PROFILE_PREFERRED_ANSWER_SECRET" }],
    },
    candidateAssessments: {
      "manager-b": { score: 99, privateNote: "OTHER_CANDIDATE_ASSESSMENT_SECRET" },
    },
  });
  room.coachEmploymentState.applications.push({
    id: "application-a",
    vacancyId: "vacancy-c",
    clubId: "C",
    coachId: "manager-a",
    status: "interview",
    submittedAt: NOW,
    updatedAt: NOW,
    responseReason: "Perfil compatível",
    candidateAssessment: {
      eligible: true,
      score: 78,
      factors: [{ code: "playing_style", label: "Estilo de jogo", weight: 18, rawScore: 90, weightedScore: 16.2, detail: "Boa compatibilidade" }],
      hardBlockers: [],
      profileVersion: 3,
      evaluatedAt: NOW,
    },
  }, {
    id: "application-b",
    vacancyId: "vacancy-c",
    clubId: "C",
    coachId: "manager-b",
    status: "submitted",
    submittedAt: NOW,
    updatedAt: NOW,
    responseReason: "OTHER_APPLICATION_SECRET",
    candidateAssessment: {
      eligible: false,
      score: 99,
      factors: [{ code: "private", label: "OTHER_CANDIDATE_FACTOR_SECRET", weight: 100, rawScore: 99, weightedScore: 99 }],
      hardBlockers: [{ code: "private", label: "OTHER_CANDIDATE_BLOCKER_SECRET" }],
      profileVersion: 3,
      evaluatedAt: NOW,
    },
  });
  room.coachEmploymentState.interviews.push({
    id: "interview-a",
    applicationId: "application-a",
    coachId: "manager-a",
    clubId: "C",
    status: "pending",
    scheduledAt: NOW,
    expiresAt: "2026-08-02T12:00:00.000Z",
    mode: "dynamic",
    depth: "deep",
    source: "gemini",
    revision: 2,
    turnCount: 1,
    minTurns: 8,
    maxTurns: 12,
    currentQuestionId: "dynamic-q-2",
    transcript: [
      { id: "dynamic-q-1", questionId: "dynamic-q-1", role: "board", text: "Como pretende usar a base?", topic: "youth", createdAt: NOW },
      { id: "dynamic-a-1", questionId: "dynamic-q-1", role: "coach", text: "Com minutos progressivos e metas individuais.", topic: "youth", createdAt: NOW },
      { id: "dynamic-q-2", questionId: "dynamic-q-2", role: "board", text: "Como equilibraria isso com resultado imediato?", topic: "objectives", createdAt: NOW },
    ],
    memorySummary: "Compromisso com base e resultado progressivo.",
    relationshipImpact: { confidence: 3, credibility: 2, strategicAlignment: 76, culturalFit: 81, perceivedRisk: 24, expectedTenure: 74 },
    evaluation: {
      overall: 79,
      boardConfidence: 82,
      clubCompatibility: 80,
      squadCompatibility: 77,
      leadership: 75,
      tacticalVision: 84,
      financialAlignment: 73,
      longTermPotential: 86,
      culturalFit: 81,
      perceivedRisk: 24,
      strengths: ["Plano claro para jovens"],
      risks: ["Pressao por resultado imediato"],
      recommendation: "hire_with_reservations",
      summary: "Projeto consistente com pontos a negociar.",
    },
    questions: [{ id: "q-a", prompt: "Como deseja jogar?", topic: "tactics", preferredAnswer: "possession" }],
    answers: [],
  }, {
    id: "interview-b",
    applicationId: "application-b",
    coachId: "manager-b",
    clubId: "C",
    status: "completed",
    scheduledAt: NOW,
    completedAt: NOW,
    mode: "dynamic",
    transcript: [{ id: "secret-message", role: "board", text: "OTHER_TRANSCRIPT_SECRET", createdAt: NOW }],
    questions: [{ id: "q-b", prompt: "OTHER_INTERVIEW_SECRET", topic: "private", preferredAnswer: "secret" }],
    answers: [{ questionId: "q-b", text: "OTHER_ANSWER_SECRET" }],
  });
  room.coachEmploymentState.evaluations.push({
    id: "evaluation-a",
    coachId: "manager-a",
    clubId: "A",
    evaluatedAt: NOW,
    seasonNumber: 1,
    round: 8,
    games: 8,
    points: 16,
    score: 82,
    securityLevel: "very_secure",
    recommendation: "retain",
    factors: [{ code: "results_above_expectation", impact: 14 }],
    minimumGamesMet: true,
  }, {
    id: "evaluation-b",
    coachId: "manager-b",
    clubId: "B",
    evaluatedAt: NOW,
    seasonNumber: 1,
    round: 8,
    games: 8,
    points: 4,
    score: 10,
    securityLevel: "dismissal_imminent",
    recommendation: "dismiss",
    factors: [{ code: "OTHER_EVALUATION_SECRET", impact: -50 }],
    minimumGamesMet: true,
  });
  return room;
}

test("monta DTO completo do manager com clubes enriquecidos", () => {
  const room = roomFixture();
  const before = structuredClone(room);
  const snapshot = buildCoachCareerSnapshot(room, "manager-a", { now: NOW });

  assert.deepEqual(room, before, "builder não altera save recebido");
  assert.equal(snapshot.coach.id, "manager-a");
  assert.equal(snapshot.coach.name, "Emanuel");
  assert.equal(snapshot.coach.currentClubId, "A");
  assert.equal(snapshot.activeEmployment.club.name, "Aurora");
  assert.equal(snapshot.activeEmployment.club.competition, "Brasileirão Série A");
  assert.equal(snapshot.activeEmployment.club.country, "Brasil");
  assert.equal(snapshot.activeEmployment.contract.club.crestImageUrl, "https://img.test/a.png");
  assert.equal(snapshot.jobSecurity.score, 82);
  assert.equal(snapshot.jobSecurity.level, "very_safe");
  assert.equal(snapshot.jobSecurity.factors[0].label, "Resultados acima da expectativa");
  assert.equal(snapshot.assignments[0].club.id, "A");
  assert.equal(snapshot.assignments[0].clubId, "A");
  assert.equal(snapshot.assignments[0].country, "Brasil");
  assert.equal(snapshot.assignments[0].division, "Brasileirão Série A");
  assert.equal(Array.isArray(snapshot.assignments[0].contracts), true);
  assert.equal(Array.isArray(snapshot.assignments[0].renewals), true);
  assert.equal(Array.isArray(snapshot.assignments[0].achievements), true);
  assert.equal(snapshot.assignments[0].development.youthPromoted, 0);
  assert.equal(snapshot.contracts.length, 1);
  assert.equal(snapshot.activeEmployment.contract.autonomyLevel, 64);
  assert.equal(snapshot.activeEmployment.contract.objectiveDifficultyAdjustment, 3);
  assert.equal(snapshot.activeEmployment.contract.sourceInterviewId, "interview-origin");
  assert.deepEqual(snapshot.activeEmployment.contract.specialClauses, ["Autonomia protegida para a base"]);
  assert.equal(snapshot.activeEmployment.contract.objectives[0].difficultyAdjustment, 3);
  assert.deepEqual(snapshot.proposals.map(({ id }) => id), ["proposal-a"]);
  assert.equal(snapshot.proposals[0].terms.salary, 250_000);
  assert.equal(snapshot.proposals[0].terms.durationMonths, 36);
  assert.equal(snapshot.proposals[0].interviewId, "interview-proposal-a");
  assert.equal(snapshot.proposals[0].autonomyDelta, 4);
  assert.equal(snapshot.proposals[0].priorityDelta, 6);
  assert.equal(snapshot.proposals[0].objectiveDifficultyDelta, 3);
  assert.deepEqual(snapshot.applications.map(({ id }) => id), ["application-a"]);
  assert.deepEqual(snapshot.interviews.map(({ id }) => id), ["interview-a"]);
  assert.equal(snapshot.interviews[0].status, "awaiting_answers");
  assert.equal(snapshot.interviews[0].vacancyId, "vacancy-c");
  assert.equal(snapshot.interviews[0].questions[0].type, "choice");
  assert.equal(snapshot.interviews[0].questions[0].options.some(({ id }) => id === "adaptable"), true);
  assert.equal(snapshot.interviews[0].questions[0].options.some(({ id }) => id === "possession"), true);
  assert.equal(snapshot.interviews[0].mode, "generative");
  assert.equal(snapshot.interviews[0].depth, "deep");
  assert.equal(snapshot.interviews[0].source, "gemini");
  assert.equal(snapshot.interviews[0].transcript.length, 3);
  assert.equal(snapshot.interviews[0].transcript[1].questionId, "dynamic-q-1");
  assert.match(snapshot.interviews[0].memorySummary, /base e resultado/i);
  assert.equal(snapshot.interviews[0].currentQuestionId, "dynamic-q-2");
  assert.equal(snapshot.interviews[0].evaluation.recommendation, "hire_with_reservations");
  assert.equal(snapshot.interviews[0].relationshipImpact.credibilityDelta, 2);
  assert.equal(snapshot.vacancies.find(({ id }) => id === "vacancy-c").applicationId, "application-a");
  assert.equal(snapshot.vacancies.find(({ id }) => id === "vacancy-c").club.name, "Celta");
  const vacancy = snapshot.vacancies.find(({ id }) => id === "vacancy-c");
  assert.equal(vacancy.desiredProfile.license.minimum, "CONMEBOL_PRO");
  assert.equal(vacancy.desiredProfile.playingStyle.preferredFormation, "4-3-3");
  assert.equal(vacancy.candidateAssessment, undefined);
  assert.equal(snapshot.applications[0].candidateAssessment.score, 78);
  assert.equal(snapshot.applications[0].candidateAssessment.factors[0].weightedScore, 16.2);
  assert.equal(snapshot.news.some(({ kind }) => kind === "COACH_PROPOSAL_RECEIVED"), true);
  assert.equal(snapshot.updatedAt, NOW);
});

test("normaliza segurança enriquecida sem expor intenção privada da diretoria", () => {
  const room = roomFixture();
  const evaluation = room.coachEmploymentState.evaluations
    .find(({ coachId }) => coachId === "manager-a");
  Object.assign(evaluation, {
    appointmentId: "appointment-a",
    trend: { direction: "rising", delta: 6.4, label: "Confiança em alta" },
    fanSupport: { value: 74, state: "supportive", label: "Torcida ao lado", trend: "rising" },
    boardSupport: {
      publicValue: 68,
      publicState: "supportive",
      publicLabel: "Diretoria respalda o trabalho",
      privateValue: 987.123,
      privateState: "PRIVATE_BOARD_STATE_SECRET",
      privateLabel: "PRIVATE_BOARD_LABEL_SECRET",
      realIntent: "PRIVATE_REAL_INTENT_SECRET",
      privateEstimate: {
        min: 55,
        max: 70,
        label: "Confiança interna moderada",
        source: "Sinais apurados pelo staff",
      },
    },
    classics: {
      played: 5,
      wins: 3,
      draws: 1,
      losses: 1,
      winlessStreak: 0,
      heavyLosses: 0,
      eliminations: 1,
      impact: 7,
    },
    relegation: {
      risk: 12,
      state: "safe",
      label: "Distante da zona",
      inZone: false,
      consecutiveRounds: 0,
      confirmed: false,
      survivalSecured: false,
    },
    accumulatedCredit: { value: 77, label: "Crédito elevado", delta: 4.5 },
    dimensions: [{
      id: "results",
      label: "Resultados",
      value: 81,
      weight: 0.35,
      trend: "rising",
      justification: "Campanha acima da meta.",
      updatedAt: NOW,
      privateCalculation: "PRIVATE_DIMENSION_SECRET",
    }],
  });
  room.coachEmploymentState.jobSecurity.ultimatums.push({
    id: "ultimatum-a",
    coachId: "manager-a",
    clubId: "A",
    appointmentId: "appointment-a",
    status: "active",
    title: "Reação imediata",
    objective: { type: "points", label: "Somar quatro pontos", target: 4 },
    progress: 2,
    deadlineRound: 10,
    consequence: "Reunião extraordinária da diretoria",
    privateReason: "PRIVATE_ULTIMATUM_SECRET",
  });
  room.coachEmploymentState.jobSecurity.history.push({
    id: "security-history-a",
    coachId: "manager-a",
    clubId: "A",
    appointmentId: "appointment-a",
    occurredAt: NOW,
    previousLevel: "stable",
    newLevel: "very_secure",
    previousScore: 70,
    newScore: 82,
    decision: "Diretoria reforçou o respaldo",
    privateMinutes: "PRIVATE_MEETING_MINUTES_SECRET",
  });

  const snapshot = buildCoachCareerSnapshot(room, "manager-a", { now: NOW });
  const security = snapshot.jobSecurity;
  const serialized = JSON.stringify(security);

  assert.deepEqual(security.trend, { direction: "rising", delta: 6.4, label: "Confiança em alta" });
  assert.deepEqual(security.fanSupport, { value: 74, state: "supportive", label: "Torcida ao lado", trend: "rising" });
  assert.deepEqual(security.boardSupport, {
    publicValue: 68,
    publicState: "supportive",
    publicLabel: "Diretoria respalda o trabalho",
    privateEstimate: {
      min: 55,
      max: 70,
      label: "Confiança interna moderada",
      source: "Sinais apurados pelo staff",
    },
  });
  assert.equal(security.classics.played, 5);
  assert.equal(security.classics.wins, 3);
  assert.equal(security.relegation.risk, 12);
  assert.equal(security.accumulatedCredit.value, 77);
  assert.deepEqual(security.dimensions[0], {
    id: "results",
    label: "Resultados",
    value: 81,
    weight: 0.35,
    trend: "rising",
    justification: "Campanha acima da meta.",
    updatedAt: NOW,
  });
  assert.deepEqual(security.activeUltimatums, [{
    id: "ultimatum-a",
    status: "active",
    title: "Reação imediata",
    objective: "Somar quatro pontos",
    deadlineRound: 10,
    progress: 50,
    consequence: "Reunião extraordinária da diretoria",
  }]);
  assert.deepEqual(security.recentHistory, [{
    id: "security-history-a",
    occurredAt: NOW,
    previousLevel: "stable",
    newLevel: "very_safe",
    previousScore: 70,
    newScore: 82,
    decision: "Diretoria reforçou o respaldo",
  }]);
  for (const secret of [
    "privateValue",
    "privateState",
    "realIntent",
    "PRIVATE_BOARD_STATE_SECRET",
    "PRIVATE_BOARD_LABEL_SECRET",
    "PRIVATE_REAL_INTENT_SECRET",
    "PRIVATE_DIMENSION_SECRET",
    "PRIVATE_ULTIMATUM_SECRET",
    "PRIVATE_MEETING_MINUTES_SECRET",
    "987.123",
  ]) {
    assert.equal(serialized.includes(secret), false, `vazou dado interno da segurança: ${secret}`);
  }
});

test("expõe ciclos profissionais privados e enriquece comissão preferida", () => {
  const room = roomFixture();
  room.clubCareerState.staffMembers = [{
    id: "assistant-a",
    name: "Renata Campos",
    role: "assistant_coach",
    roleLabel: "Auxiliar técnico",
    clubId: "A",
    status: "employed",
    salary: 40_000,
    affiliationType: "coach_recommended",
    linkedCoachId: "manager-a",
    affinity: 91,
    availability: { status: "employed" },
  }];
  room.clubCareerState.staffCandidates = [{
    id: "analyst-a",
    name: "Caio Nunes",
    role: "analyst",
    roleLabel: "Analista",
    status: "free_agent",
    salary: 25_000,
    availability: { status: "available" },
  }];
  room.clubCareerState.staffContracts = [{
    id: "staff-contract-a",
    staffId: "assistant-a",
    clubId: "A",
    status: "active",
    wage: 40_000,
  }];
  room.professionalLifecycleState = {
    version: 1,
    currentDate: NOW,
    notices: [{
      id: "notice-a",
      professionalType: "coach",
      professionalId: "manager-a",
      clubId: "A",
      initiatedBy: "professional",
      reason: "transição planejada",
      communicatedAt: "2026-07-01T12:00:00.000Z",
      startDate: "2026-07-01T12:00:00.000Z",
      durationDays: 30,
      expectedEndDate: "2026-07-31T12:00:00.000Z",
      endedAt: "2026-07-20T12:00:00.000Z",
      status: "ended_early",
      compensation: { compensation: 150_000 },
      updatedAt: "2026-07-20T12:00:00.000Z",
    }, {
      id: "notice-private-b",
      professionalType: "coach",
      professionalId: "manager-b",
      clubId: "B",
      reason: "PRIVATE_LIFECYCLE_B",
      startDate: "2026-07-01T12:00:00.000Z",
      expectedEndDate: "2026-08-01T12:00:00.000Z",
      status: "active",
    }],
    retirements: [{
      id: "retirement-a",
      professionalType: "coach",
      professionalId: "manager-a",
      clubId: "A",
      kind: "end_season",
      announcedAt: "2026-07-02T12:00:00.000Z",
      effectiveAt: "2026-12-20T12:00:00.000Z",
      status: "scheduled",
      postponementCount: 1,
      previousEffectiveDates: ["2026-11-30T12:00:00.000Z"],
    }],
    mutualAgreements: [{
      id: "agreement-a",
      professionalType: "coach",
      professionalId: "manager-a",
      clubId: "A",
      proposedBy: "professional",
      proposedAt: "2026-07-03T12:00:00.000Z",
      departureDate: "2026-07-18T12:00:00.000Z",
      executedAt: "2026-07-18T12:00:00.000Z",
      status: "executed",
      negotiationRound: 3,
      signatures: {
        club: "2026-07-17T12:00:00.000Z",
        professional: "2026-07-17T12:00:00.000Z",
      },
      terms: {
        compensation: 275_000,
        confidentiality: true,
        benefitsThrough: "2026-08-18T12:00:00.000Z",
      },
    }],
    transitions: [{
      id: "transition-a",
      type: "successor_search_opened",
      clubId: "A",
      coachId: "manager-a",
      professionalIds: ["manager-a"],
      startedAt: "2026-07-03T12:00:00.000Z",
      status: "active",
    }, {
      id: "transition-private-b",
      type: "PRIVATE_TRANSITION_B",
      clubId: "B",
      coachId: "manager-b",
      professionalIds: ["manager-b"],
      startedAt: "2026-07-03T12:00:00.000Z",
    }],
    preferredStaffByCoach: {
      "manager-a": [{
        staffId: "assistant-a",
        affinity: 88,
        estimatedMonthlyCost: 42_000,
      }, {
        staffId: "analyst-a",
        affiliationType: "personal_team",
        affinity: 76,
      }],
      "manager-b": [{
        staffId: "PRIVATE_STAFF_B",
      }],
    },
    timeline: [],
    processedOperationIds: [],
  };

  const snapshot = buildCoachCareerSnapshot(room, "manager-a", { now: NOW });
  const lifecycle = snapshot.lifecycle;

  assert.equal(lifecycle.notices.length, 1);
  assert.equal(lifecycle.notices[0].status, "completed");
  assert.equal(lifecycle.notices[0].startsAt, "2026-07-01T12:00:00.000Z");
  assert.equal(lifecycle.notices[0].endsAt, "2026-07-20T12:00:00.000Z");
  assert.equal(lifecycle.notices[0].metadata.expectedEndAt, "2026-07-31T12:00:00.000Z");
  assert.equal(lifecycle.notices[0].compensation, 150_000);
  assert.equal(lifecycle.retirements[0].status, "active");
  assert.equal(lifecycle.retirements[0].retirementType, "end_of_season");
  assert.equal(lifecycle.retirements[0].canPostpone, true);
  assert.equal(lifecycle.mutualAgreements[0].status, "completed");
  assert.equal(lifecycle.mutualAgreements[0].proposedBy, "coach");
  assert.equal(lifecycle.mutualAgreements[0].proposedExitAt, "2026-07-18T12:00:00.000Z");
  assert.equal(lifecycle.mutualAgreements[0].compensation, 275_000);
  assert.equal(lifecycle.mutualAgreements[0].confidentiality, true);
  assert.equal(lifecycle.mutualAgreements[0].benefitsUntil, "2026-08-18T12:00:00.000Z");
  assert.equal(lifecycle.transitions[0].professionalId, "manager-a");
  assert.equal(lifecycle.transitions[0].title, "Busca por sucessor iniciada");
  assert.deepEqual(lifecycle.preferredStaff.map(({ staffId }) => staffId), ["assistant-a", "analyst-a"]);
  assert.equal(lifecycle.preferredStaff[0].name, "Renata Campos");
  assert.equal(lifecycle.preferredStaff[0].roleLabel, "Auxiliar técnico");
  assert.equal(lifecycle.preferredStaff[0].estimatedCost, 42_000);
  assert.equal(lifecycle.preferredStaff[0].affiliationType, "coach_recommended");
  assert.equal(lifecycle.preferredStaff[1].name, "Caio Nunes");
  assert.equal(lifecycle.preferredStaff[1].availability, "available");
  assert.equal(JSON.stringify(lifecycle).includes("PRIVATE_LIFECYCLE_B"), false);
  assert.equal(JSON.stringify(lifecycle).includes("PRIVATE_TRANSITION_B"), false);
  assert.equal(JSON.stringify(lifecycle).includes("PRIVATE_STAFF_B"), false);
});

test("expõe detalhes enriquecidos da passagem sem quebrar assignments legados", () => {
  const room = roomFixture();
  const coach = room.coachCareerState.coaches.find(({ id }) => id === "manager-a");
  const currentContract = room.coachEmploymentState.contracts
    .find(({ coachId }) => coachId === "manager-a");
  Object.assign(currentContract, {
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2029-06-30T00:00:00.000Z",
    wage: 240_000,
    salary: 240_000,
    signingBonus: 100_000,
    terminationClause: 1_000_000,
    clauses: [{ description: "Autonomia na base" }],
    renewalCount: 1,
  });
  Object.assign(coach.assignments[0], {
    id: "spell-a",
    country: "Brasil",
    division: "Série A",
    durationDays: 202,
    durationMonths: 7,
    goalsFor: 18,
    goalsAgainst: 9,
    goalDifference: 9,
    points: 19,
    pointsPerGame: 2.375,
    winRate: 75,
    longestWinningStreak: 4,
    longestWinlessStreak: 2,
    reputationStart: 61,
    reputationEnd: 68,
    initialSalary: 180_000,
    finalSalary: 240_000,
    contractIds: ["contract-old", currentContract.id],
    contracts: [{
      id: "contract-old",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-06-30T00:00:00.000Z",
      endedAt: "2026-06-30T00:00:00.000Z",
      salary: 180_000,
      status: "replaced",
      endReason: "renewed_after_negotiation",
    }],
    renewals: [{
      id: "renewal-a",
      renewedAt: "2026-07-01T00:00:00.000Z",
      previousContractId: "contract-old",
      newContractId: currentContract.id,
      salary: 240_000,
      durationYears: 3,
    }],
    titles: [{
      id: "title-a",
      title: "Copa Nacional",
      competitionId: "CUP-A",
      seasonNumber: 1,
      wonAt: "2026-06-30T00:00:00.000Z",
    }],
    achievements: [{
      id: "achievement-a",
      type: "promotion",
      title: "Acesso à elite",
      occurredAt: "2026-06-30T00:00:00.000Z",
    }],
    development: {
      youthPlayerIds: ["youth-a", "youth-b", "youth-c"],
      signings: [{ id: "signing-a", playerName: "Jogador A" }],
      sales: [{ id: "sale-a", playerName: "Jogador B" }],
      squadValueStart: 50_000_000,
      squadValueEnd: 62_000_000,
    },
  });

  const snapshot = buildCoachCareerSnapshot(room, "manager-a", { now: NOW });
  const spell = snapshot.assignments.find(({ clubId }) => clubId === "A");

  assert.ok(spell);
  assert.equal(spell.country, "Brasil");
  assert.equal(spell.division, "Série A");
  assert.equal(spell.initialSalary, 180_000);
  assert.equal(spell.finalSalary, 240_000);
  assert.deepEqual(spell.contractIds, ["contract-old", currentContract.id]);
  assert.equal(spell.contracts[1].salary, 240_000);
  assert.deepEqual(spell.contracts[1].clauses, ["Autonomia na base"]);
  assert.equal(spell.renewals.at(-1).contractId, currentContract.id);
  assert.equal(spell.titles[0].name, "Copa Nacional");
  assert.equal(spell.achievements.some(({ title }) => title === "Copa Nacional"), true);
  assert.equal(spell.development.youthPromoted, 3);
  assert.equal(spell.development.signings, 1);
  assert.deepEqual(spell.development.importantSignings, ["Jogador A"]);
  assert.equal(spell.development.squadValueChange, 12_000_000);
});

test("histórico completo é privado, ordenado e idempotente após recarregar o save", () => {
  const room = roomFixture();
  const coach = room.coachCareerState.coaches.find(({ id }) => id === "manager-a");
  coach.assignments.push({
    ...assignment("C"),
    id: "past-spell-c",
    startedAt: "2025-01-01T00:00:00.000Z",
    endedSeason: 1,
    endedRound: 1,
    endedAt: "2025-12-31T00:00:00.000Z",
    exitReason: "contract_end",
  });
  coach.careerTimeline = [{
    id: "timeline-b",
    coachId: "manager-a",
    type: "TEST",
    occurredAt: "2026-07-20T10:00:00.000Z",
    title: "Segundo no desempate",
  }, {
    id: "timeline-a",
    coachId: "manager-a",
    type: "TEST",
    occurredAt: "2026-07-20T10:00:00.000Z",
    title: "Primeiro no desempate",
  }, {
    id: "timeline-private-b",
    coachId: "manager-b",
    type: "PRIVATE",
    occurredAt: "2026-07-21T10:00:00.000Z",
    title: "PRIVATE_LEDGER_B",
  }];
  const first = buildCoachCareerSnapshot(room, "manager-a", { now: NOW }).careerHistory;
  const reloaded = JSON.parse(JSON.stringify(room));
  const second = buildCoachCareerSnapshot(reloaded, "manager-a", { now: NOW }).careerHistory;

  assert.equal(first.coachId, "manager-a");
  assert.equal(first.generatedAt, NOW);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(first).includes("manager-b"), false);
  assert.equal(JSON.stringify(first).includes("OTHER_COACH_SECRET"), false);
  assert.equal(JSON.stringify(first).includes("PRIVATE_LEDGER_B"), false);
  assert.equal(Array.isArray(first.spells), true);
  assert.equal(Array.isArray(first.timeline), true);
  assert.equal(Array.isArray(first.negotiations), true);
  assert.equal(Array.isArray(first.reputationHistory), true);
  assert.equal(Array.isArray(first.financialHistory), true);
  assert.equal(Array.isArray(first.unemploymentPeriods), true);
  assert.equal(typeof first.summary.matches, "number");
  assert.equal(first.summary.clubs, first.summary.clubsManaged);
  assert.equal(first.summary.countries, first.summary.countriesWorked);
  assert.equal(first.summary.proposalsAccepted, first.summary.acceptedProposals);
  assert.equal(first.summary.proposalsRejected, first.summary.rejectedProposals);
  assert.equal(first.spells[0].clubId, "A");
  assert.equal(first.spells[0].club.name, "Aurora");
  assert.equal(first.spells.at(-1).clubId, "C");
  const tieEntries = first.timeline.filter(({ id }) => ["timeline-a", "timeline-b"].includes(id));
  assert.deepEqual(tieEntries.map(({ id }) => id), ["timeline-a", "timeline-b"]);

  for (const collection of [
    first.timeline,
    first.negotiations,
    first.reputationHistory,
    first.financialHistory,
  ]) {
    for (let index = 1; index < collection.length; index += 1) {
      const previous = collection[index - 1];
      const current = collection[index];
      const previousDate = String(previous.occurredAt ?? previous.createdAt ?? previous.date ?? "");
      const currentDate = String(current.occurredAt ?? current.createdAt ?? current.date ?? "");
      assert.equal(
        previousDate > currentDate || (
          previousDate === currentDate
          && String(previous.id ?? "").localeCompare(String(current.id ?? "")) <= 0
        ),
        true,
        "coleção de histórico fora da ordem canônica",
      );
    }
  }
});

test("exibe segurança inicial determinística antes da primeira avaliação", () => {
  const room = roomFixture();
  room.coachEmploymentState.evaluations = room.coachEmploymentState.evaluations
    .filter(({ coachId }) => coachId !== "manager-a");
  const snapshot = buildCoachCareerSnapshot(room, "manager-a", { now: NOW });

  assert.equal(snapshot.jobSecurity.score, 55);
  assert.equal(snapshot.jobSecurity.level, "stable");
  assert.equal(snapshot.jobSecurity.factors[0].id, "initial_board_trust");
});

test("não vaza contrato, proposta, candidatura, entrevista ou avaliação de outro coach", () => {
  const snapshot = buildCoachCareerSnapshot(roomFixture(), "manager-a", { now: NOW });
  const serialized = JSON.stringify(snapshot);

  for (const secret of [
    "proposal-b",
    "application-b",
    "interview-b",
    "OTHER_COACH_SECRET",
    "OTHER_APPLICATION_SECRET",
    "OTHER_INTERVIEW_SECRET",
    "OTHER_ANSWER_SECRET",
    "OTHER_TRANSCRIPT_SECRET",
    "OTHER_EVALUATION_SECRET",
    "OTHER_CANDIDATE_ASSESSMENT_SECRET",
    "OTHER_CANDIDATE_FACTOR_SECRET",
    "OTHER_CANDIDATE_BLOCKER_SECRET",
    "PROFILE_PREFERRED_ANSWER_SECRET",
    "999999",
  ]) {
    assert.equal(serialized.includes(secret), false, `vazou dado privado: ${secret}`);
  }
  assert.equal(snapshot.contracts.every(({ coachId }) => coachId === "manager-a"), true);
  assert.equal(snapshot.coach.interestedClubs.some(({ id }) => id === "C"), true);
});

test("manager sem identidade persistida recebe perfil próprio vazio, nunca primeiro coach", () => {
  const room = roomFixture();
  room.managers.push({ id: "manager-new", name: "Novo treinador", clubId: null });
  const snapshot = buildCoachCareerSnapshot(room, "manager-new", { now: NOW });

  assert.equal(snapshot.coach.id, "manager-new");
  assert.equal(snapshot.coach.name, "Novo treinador");
  assert.equal(snapshot.activeEmployment, null);
  assert.deepEqual(snapshot.contracts, []);
  assert.deepEqual(snapshot.proposals, []);
  assert.deepEqual(snapshot.applications, []);
  assert.deepEqual(snapshot.interviews, []);
});

test("exige managerId explícito", () => {
  assert.throws(
    () => buildCoachCareerSnapshot(roomFixture(), "", { now: NOW }),
    /managerId é obrigatório/u,
  );
});
