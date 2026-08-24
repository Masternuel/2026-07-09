import assert from "node:assert/strict";
import test from "node:test";
import {
  CoachEmploymentError,
  applyCoachInterviewGeneratedTurn,
  applyForCoachVacancy,
  appointCoach,
  coachEmploymentSnapshot,
  createCoachProposal,
  dismissCoach,
  ensureCoachEmploymentState,
  processCoachEmploymentDate,
  renewCoachContract,
  resignCoach,
  respondCoachBoardDecision,
  respondCoachInterview,
  respondCoachProposal,
  validateCoachEmploymentState,
} from "../game/coachEmployment.mjs";

const NOW = "2026-07-21T12:00:00.000Z";

function assignment(clubId, coachId) {
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
    coachId,
  };
}

function roomFixture() {
  return {
    code: "COACH01",
    currentSeason: 1,
    seasonYear: 2026,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastCompletedRound: { round: 4 },
    managers: [{ id: "human", name: "Emanuel", clubId: "A", ready: true }],
    lineups: [{ managerId: "human", clubId: "A", lineupIds: ["p1"] }],
    matchReadiness: { fixtureId: "r5", managerIds: ["human"] },
    competitionCatalog: [{
      id: "L1",
      name: "Liga",
      active: true,
      clubs: [
        { id: "A", name: "Aurora", reputation: 18 },
        { id: "B", name: "Boreal", reputation: 14 },
        { id: "C", name: "Celta", reputation: 10 },
      ],
    }],
    coachCareerState: {
      version: 1,
      awards: [{ id: "award-human", managerId: "human" }],
      coaches: [{
        id: "human",
        name: "Emanuel",
        managerType: "human",
        status: "employed",
        currentClubId: "A",
        assignments: [assignment("A", "human")],
      }, {
        id: "ai-b",
        name: "Tecnico Boreal",
        managerType: "ai",
        status: "employed",
        currentClubId: "B",
        assignments: [assignment("B", "ai-b")],
      }, {
        id: "ai-c",
        name: "Tecnico Celta",
        managerType: "ai",
        status: "employed",
        currentClubId: "C",
        assignments: [assignment("C", "ai-c")],
      }, {
        id: "free",
        name: "Treinador Livre",
        managerType: "ai",
        status: "unemployed",
        currentClubId: null,
        assignments: [],
      }],
    },
    clubCareerState: {
      currentDate: NOW,
      staffMembers: [{ id: "assistant-a", clubId: "A", role: "assistant_coach", name: "Auxiliar A", salary: 40_000 }],
    },
    marketState: {
      finances: [
        { clubId: "A", balance: 100_000_000 },
        { clubId: "B", balance: 80_000_000 },
        { clubId: "C", balance: 50_000_000 },
      ],
    },
    clubMoraleStates: [{ clubId: "A", score: 70 }, { clubId: "B", score: 45 }],
  };
}

function activeAppointments(room) {
  return room.coachEmploymentState.appointments.filter(({ status }) => status === "active");
}

function activeContracts(room) {
  return room.coachEmploymentState.contracts.filter(({ status }) => status === "active");
}

function marketOptions(config = {}) {
  return {
    minimumGames: 30,
    minimumVacancyDays: 2,
    autoDismissAI: false,
    autoDismissHuman: false,
    autoResignAI: false,
    coachMarketConfig: {
      interviewChance: 0,
      coachResponseDelayDays: 2,
      boardResponseDelayDays: 1,
      acceptanceScore: 35,
      counterScore: 20,
      ...config,
    },
  };
}

function progressApplicationToInterview(result, coachId, now = NOW) {
  const progressed = processCoachEmploymentDate(result.room, now, {
    minimumGames: 30,
    minimumVacancyDays: 0,
    autoDismissAI: false,
    autoDismissHuman: false,
    autoResignAI: false,
    coachMarketConfig: {
      searchDelayDays: 0,
      shortlistSize: 8,
      simultaneousOffersPerVacancy: 8,
      interviewChance: 100,
      interviewDelayDays: 1,
    },
  });
  const application = progressed.room.coachEmploymentState.applications.find(
    (candidate) => candidate.id === result.application.id,
  );
  const interview = progressed.room.coachEmploymentState.interviews.find(
    (candidate) => candidate.applicationId === result.application.id
      && candidate.coachId === coachId,
  );
  assert.ok(interview, "processo seletivo deve agendar entrevista antes da proposta");
  return { room: progressed.room, application, interview };
}

test("migra vinculos legados de forma pura, deterministica e preserva identidades", () => {
  const original = roomFixture();
  const before = structuredClone(original);
  const first = ensureCoachEmploymentState(original, { now: NOW });
  const repeated = ensureCoachEmploymentState(first, { now: NOW });

  assert.deepEqual(original, before, "migracao nao altera save recebido");
  assert.deepEqual(repeated, first);
  assert.equal(first.coachEmploymentState.version, 6);
  assert.equal(activeAppointments(first).length, 3);
  assert.equal(activeContracts(first).length, 3);
  assert.equal(first.coachEmploymentState.appointments.every(({ entryReason }) => entryReason === "season_start"), true);
  assert.deepEqual(first.coachCareerState.awards, before.coachCareerState.awards);
  assert.equal(first.coachCareerState.coaches.find(({ id }) => id === "free").currentClubId, null);
  assert.equal(validateCoachEmploymentState(first), true);

  const snapshot = coachEmploymentSnapshot(first, { coachId: "human", now: NOW });
  assert.deepEqual(snapshot.coaches.map(({ id }) => id), ["human"]);
  assert.equal(snapshot.contracts.length, 1);
  assert.deepEqual(snapshot.processedOperationIds, []);
});

test("demissao encerra contrato, limpa controle humano, paga multa e cria vaga com interino", () => {
  const input = roomFixture();
  const debits = [];
  const events = [];
  const result = dismissCoach(input, {
    operationId: "dismiss-human-001",
    coachId: "human",
    clubId: "A",
    reason: "performance_dismissal",
    penalty: 600_000,
  }, {
    now: NOW,
    debit: (_room, transaction) => debits.push(transaction),
    recordEvent: (_room, event) => events.push(event),
  });

  assert.equal(input.coachEmploymentState, undefined, "operacao e pura");
  assert.equal(result.coach.status, "dismissed");
  assert.equal(result.coach.currentClubId, null);
  assert.equal(result.room.managers[0].clubId, null);
  assert.deepEqual(result.room.lineups, []);
  assert.deepEqual(result.room.matchReadiness.managerIds, []);
  assert.equal(result.contract.status, "terminated");
  assert.equal(result.vacancy.status, "open");
  assert.equal(result.interimAppointment.role, "interim");
  assert.equal(activeAppointments(result.room).filter(({ clubId }) => clubId === "A").length, 1);
  assert.equal(debits[0].amount, 600_000);
  assert.deepEqual(events.map(({ type }) => type), ["COACH_DISMISSED", "COACH_INTERIM_APPOINTED"]);
  assert.equal(validateCoachEmploymentState(result.room), true);

  const repeated = dismissCoach(result.room, {
    operationId: "dismiss-human-001",
    coachId: "human",
  }, { now: NOW, debit: () => debits.push("duplicate") });
  assert.equal(repeated.duplicate, true);
  assert.equal(debits.length, 2);
  assert.equal(debits.find(({ category }) => category === "coach_termination")?.amount, 600_000);
  assert.equal(debits.find(({ category }) => category === "coach_interim_bonus")?.amount, 8_000);
  assert.deepEqual(ensureCoachEmploymentState(repeated.room, { now: NOW }), repeated.room, "reload nao ressuscita demitido");
});

test("nomeacao de treinador empregado transfere vinculo, compensa origem e deixa interino", () => {
  const debits = [];
  const credits = [];
  const result = appointCoach(roomFixture(), {
    operationId: "appoint-ai-b-at-a",
    coachId: "ai-b",
    clubId: "A",
    wage: 250_000,
    durationYears: 3,
    compensation: 900_000,
    signingBonus: 100_000,
    terminationClause: 1_500_000,
    objectives: [{ id: "position", title: "Top 4", target: 4, type: "position" }],
  }, {
    now: NOW,
    debit: (_room, transaction) => debits.push(transaction),
    credit: (_room, transaction) => credits.push(transaction),
  });

  assert.equal(result.coach.currentClubId, "A");
  assert.equal(result.contract.wage, 250_000);
  assert.equal(result.contract.objectives[0].target, 4);
  assert.equal(activeAppointments(result.room).find(({ clubId }) => clubId === "B").role, "interim");
  assert.equal(activeAppointments(result.room).find(({ clubId }) => clubId === "A").coachId, "ai-b");
  assert.equal(activeContracts(result.room).filter(({ coachId }) => coachId === "ai-b").length, 1);
  assert.equal(debits.some(({ amount }) => amount === 1_000_000), true);
  assert.equal(credits[0].clubId, "B");
  assert.equal(credits[0].amount, 900_000);
  assert.equal(validateCoachEmploymentState(result.room), true);
});

test("proposta pode ser contraproposta, aceita uma vez e atualiza clube do humano", () => {
  let room = roomFixture();
  room.coachCareerState.coaches.push({
    id: "human-free", name: "Manager Livre", managerType: "human", status: "unemployed", currentClubId: null, assignments: [],
  });
  room.managers.push({ id: "human-free", name: "Manager Livre", clubId: null, ready: false });
  const offered = createCoachProposal(room, {
    operationId: "proposal-human-free",
    coachId: "human-free",
    clubId: "A",
    wage: 180_000,
    durationYears: 2,
    responseDays: 5,
  }, { now: NOW });
  assert.equal(offered.proposal.status, "pending");

  const countered = respondCoachProposal(offered.room, {
    operationId: "proposal-human-counter",
    proposalId: offered.proposal.id,
    action: "counter",
    wage: 220_000,
    durationYears: 3,
  }, { now: NOW });
  assert.equal(countered.proposal.status, "aguardando_resposta_diretoria");
  assert.equal(countered.proposal.pendingCounterproposal.wage, 220_000);

  assert.throws(
    () => respondCoachProposal(countered.room, {
      operationId: "proposal-human-accept-too-early",
      proposalId: offered.proposal.id,
      action: "accept",
    }, { now: NOW }),
    (error) => error instanceof CoachEmploymentError
      && error.code === "COACH_COUNTERPROPOSAL_AWAITING_BOARD",
  );

  const approved = respondCoachBoardDecision(countered.room, {
    operationId: "proposal-human-board-approve",
    proposalId: offered.proposal.id,
    action: "approve",
    responsibleId: "board:A",
    justification: "Termos compativeis com o projeto",
  }, { now: NOW });
  assert.equal(approved.proposal.status, "aprovada_diretoria");
  assert.equal(approved.proposal.wage, 220_000);

  const accepted = respondCoachProposal(approved.room, {
    operationId: "proposal-human-accept",
    proposalId: offered.proposal.id,
    action: "accept",
  }, { now: NOW });
  assert.equal(accepted.proposal.status, "accepted");
  assert.equal(accepted.room.managers.find(({ id }) => id === "human-free").clubId, "A");
  assert.equal(activeAppointments(accepted.room).find(({ clubId }) => clubId === "A").coachId, "human-free");
  assert.equal(validateCoachEmploymentState(accepted.room), true);

  const replay = respondCoachProposal(accepted.room, {
    operationId: "proposal-human-accept",
    proposalId: offered.proposal.id,
    action: "accept",
  }, { now: NOW });
  assert.equal(replay.duplicate, true);
  assert.equal(activeAppointments(replay.room).filter(({ clubId }) => clubId === "A").length, 1);
});

test("treinador nao pode responder proposta destinada a outro treinador", () => {
  const offered = createCoachProposal(roomFixture(), {
    operationId: "proposal-private-free",
    coachId: "free",
    clubId: "A",
    wage: 180_000,
  }, { now: NOW });

  assert.throws(
    () => respondCoachProposal(offered.room, {
      operationId: "proposal-hijack-human",
      coachId: "human",
      proposalId: offered.proposal.id,
      action: "accept",
    }, { now: NOW }),
    (error) => error instanceof CoachEmploymentError
      && error.code === "COACH_PROPOSAL_NOT_FOUND"
      && error.status === 404,
  );
  assert.equal(offered.room.coachEmploymentState.proposals.find(
    ({ id }) => id === offered.proposal.id,
  ).status, "pending");
});

test("candidatura e entrevista geram proposta conforme respostas persistidas", () => {
  const dismissed = resignCoach(roomFixture(), {
    operationId: "resign-ai-c",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });
  const applied = applyForCoachVacancy(dismissed.room, {
    operationId: "apply-free-at-c",
    vacancyId: dismissed.vacancy.id,
    coachId: "free",
  }, { now: NOW });
  const selected = progressApplicationToInterview(applied, "free");

  assert.equal(selected.application.status, "interview");
  assert.equal(selected.interview.status, "pending");
  const answered = respondCoachInterview(selected.room, {
    operationId: "interview-free-at-c",
    interviewId: selected.interview.id,
    decision: "accept",
    wage: 140_000,
    durationYears: 2,
    answers: selected.interview.questions.map((question) => ({
      questionId: question.id,
      answerId: question.preferredAnswer,
    })),
  }, { now: NOW });

  assert.equal(answered.interview.status, "accepted");
  assert.equal(answered.interview.answerCompatibilityScore, 100);
  assert.equal(
    answered.interview.compatibilityScore,
    Math.round((answered.interview.selectionScore * 0.7) + 30),
  );
  assert.equal(answered.application.status, "accepted");
  assert.equal(answered.proposal.status, "pending");
  assert.equal(answered.proposal.clubId, "C");
  assert.equal(answered.room.coachCareerState.coaches.find(({ id }) => id === "free").status, "negotiating");
});

test("entrevista ignora score enviado pelo cliente e bloqueia oferta abaixo da compatibilidade minima", () => {
  const dismissed = resignCoach(roomFixture(), {
    operationId: "resign-ai-c-spoofed-interview",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });
  const applied = applyForCoachVacancy(dismissed.room, {
    operationId: "apply-free-spoofed-interview",
    vacancyId: dismissed.vacancy.id,
    coachId: "free",
  }, { now: NOW });
  const selected = progressApplicationToInterview(applied, "free");
  const application = selected.room.coachEmploymentState.applications.find(
    ({ id }) => id === selected.application.id,
  );
  application.candidateAssessment.score = 0;

  const answered = respondCoachInterview(selected.room, {
    operationId: "interview-free-spoofed-score",
    interviewId: selected.interview.id,
    coachId: "free",
    decision: "accept",
    wage: 999_000_000,
    answers: selected.interview.questions.map((question) => ({
      questionId: question.id,
      score: 100,
    })),
  }, { now: NOW });

  assert.equal(answered.interview.answerCompatibilityScore, 0);
  assert.equal(answered.interview.compatibilityScore, 0);
  assert.equal(answered.interview.status, "rejected");
  assert.equal(answered.application.status, "rejected");
  assert.equal(answered.application.responseReason, "interview_incompatible");
  assert.equal(answered.proposal, null);
});

test("oferta aprovada na entrevista limita termos pela faixa salarial da vaga", () => {
  const dismissed = resignCoach(roomFixture(), {
    operationId: "resign-ai-c-clamped-interview",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });
  const applied = applyForCoachVacancy(dismissed.room, {
    operationId: "apply-free-clamped-interview",
    vacancyId: dismissed.vacancy.id,
    coachId: "free",
  }, { now: NOW });
  const selected = progressApplicationToInterview(applied, "free");
  const vacancy = selected.room.coachEmploymentState.vacancies.find(
    ({ id }) => id === dismissed.vacancy.id,
  );

  const answered = respondCoachInterview(selected.room, {
    operationId: "interview-free-clamped-terms",
    interviewId: selected.interview.id,
    coachId: "free",
    decision: "accept",
    wage: 999_000_000,
    durationYears: 10,
    terminationClause: 999_000_000,
    answers: selected.interview.questions.map((question) => ({
      questionId: question.id,
      answerId: question.preferredAnswer,
    })),
  }, { now: NOW });

  assert.equal(answered.interview.status, "accepted");
  assert.equal(answered.proposal.wage, vacancy.desiredProfile.salary.maximum);
  assert.equal(answered.proposal.durationYears, 5);
  assert.equal(answered.proposal.terminationClause, answered.proposal.wage * 24);
});

test("treinador nao pode responder entrevista destinada a outro treinador", () => {
  const dismissed = resignCoach(roomFixture(), {
    operationId: "resign-ai-c-private-interview",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });
  const applied = applyForCoachVacancy(dismissed.room, {
    operationId: "apply-free-private-interview",
    vacancyId: dismissed.vacancy.id,
    coachId: "free",
  }, { now: NOW });
  const selected = progressApplicationToInterview(applied, "free");

  assert.throws(
    () => respondCoachInterview(selected.room, {
      operationId: "interview-hijack-human",
      coachId: "human",
      interviewId: selected.interview.id,
      decision: "accept",
      answers: [],
    }, { now: NOW }),
    (error) => error instanceof CoachEmploymentError
      && error.code === "COACH_INTERVIEW_NOT_FOUND"
      && error.status === 404,
  );
  assert.equal(selected.room.coachEmploymentState.interviews.find(
    ({ id }) => id === selected.interview.id,
  ).status, "pending");
});

test("entrevista generativa persiste turnos, avaliacao, efeitos e memoria com CAS", () => {
  const dismissed = resignCoach(roomFixture(), {
    operationId: "resign-ai-c-generated-interview",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });
  const applied = applyForCoachVacancy(dismissed.room, {
    operationId: "apply-free-generated-interview",
    vacancyId: dismissed.vacancy.id,
    coachId: "free",
  }, { now: NOW });
  const selected = progressApplicationToInterview(applied, "free");
  const started = applyCoachInterviewGeneratedTurn(selected.room, {
    operationId: "generated-interview-start",
    phase: "start",
    coachId: "free",
    interviewId: selected.interview.id,
    expectedRevision: 0,
    depth: "quick",
    contextSnapshot: { club: { id: "C" }, candidate: { id: "free" } },
    generated: {
      source: "gemini",
      model: "gemini-test",
      message: "Como pretende organizar os primeiros dias de trabalho?",
      topic: "objectives",
      shouldEnd: false,
    },
  }, { now: NOW });

  assert.equal(started.interview.depth, "quick");
  assert.equal(started.interview.minTurns, 2);
  assert.equal(started.interview.maxTurns, 4);
  assert.equal(started.interview.contextSnapshot.club.id, "C");
  assert.ok(started.interview.contextHash);
  assert.equal(started.interview.revision, 1);
  assert.equal(started.events[0].type, "COACH_INTERVIEW_STARTED");
  assert.throws(
    () => applyCoachInterviewGeneratedTurn(started.room, {
      operationId: "generated-interview-stale",
      phase: "answer",
      coachId: "free",
      interviewId: selected.interview.id,
      expectedRevision: 0,
      expectedQuestionId: started.interview.currentQuestionId,
      candidateMessage: "Resposta atrasada",
      generated: { source: "fallback", message: "Pergunta", shouldEnd: false },
    }, { now: NOW }),
    (error) => error instanceof CoachEmploymentError && error.code === "COACH_INTERVIEW_REVISION_CONFLICT",
  );

  const firstTurn = applyCoachInterviewGeneratedTurn(started.room, {
    operationId: "generated-interview-turn-1",
    phase: "answer",
    coachId: "free",
    interviewId: selected.interview.id,
    expectedRevision: 1,
    expectedQuestionId: started.interview.currentQuestionId,
    candidateMessage: "Vou avaliar elenco, alinhar metas e definir responsabilidades.",
    generated: {
      source: "gemini",
      model: "gemini-test",
      message: "Como equilibrara o projeto esportivo e o orcamento?",
      topic: "finance",
      shouldEnd: false,
      turnAnalysis: {
        confidenceDelta: 6,
        credibilityDelta: 4,
        strategicAlignment: 82,
        culturalFit: 76,
        perceivedRisk: 24,
        expectedTenure: 74,
      },
      memorySummary: "Candidato apresentou plano inicial objetivo.",
    },
  }, { now: NOW });

  assert.equal(firstTurn.interview.status, "pending");
  assert.equal(firstTurn.interview.turnCount, 1);
  assert.equal(firstTurn.interview.cumulativeMetrics.clubCompatibility, 82);
  assert.equal(firstTurn.interview.relationshipImpact.boardConfidenceDelta, 6);
  assert.equal(firstTurn.events[0].type, "COACH_INTERVIEW_TURN_RECORDED");

  const completed = applyCoachInterviewGeneratedTurn(firstTurn.room, {
    operationId: "generated-interview-turn-2",
    phase: "answer",
    coachId: "free",
    interviewId: selected.interview.id,
    expectedRevision: 2,
    expectedQuestionId: firstTurn.interview.currentQuestionId,
    candidateMessage: "Priorizarei contratacoes sustentaveis e metas mensuraveis.",
    generated: {
      source: "gemini",
      model: "gemini-test",
      message: "Obrigado. A diretoria concluiu a avaliacao.",
      topic: "closing",
      shouldEnd: true,
      turnAnalysis: {
        confidenceDelta: 5,
        credibilityDelta: 3,
        strategicAlignment: 86,
        culturalFit: 79,
        perceivedRisk: 20,
        expectedTenure: 80,
      },
      evaluation: {
        overall: 84,
        boardConfidence: 86,
        clubCompatibility: 88,
        squadCompatibility: 78,
        leadership: 82,
        tacticalVision: 80,
        financialAlignment: 85,
        longTermPotential: 83,
        strengths: ["Plano mensuravel", "Responsabilidade financeira"],
        risks: [],
        recommendation: "hire",
        summary: "Candidato alinhado ao projeto.",
      },
      negotiationEffects: {
        salaryMultiplier: 1.1,
        bonusMultiplier: 1.2,
        contractYearsDelta: 1,
        transferBudgetMultiplier: 1.05,
        autonomyDelta: 8,
        priorityDelta: 10,
        objectiveDifficultyDelta: 4,
        terminateNegotiation: false,
        objectives: ["Revisar trimestralmente a evolucao esportiva"],
        specialClauses: ["Autonomia esportiva sujeita a revisao da diretoria"],
      },
      memorySummary: "Prometeu metas mensuraveis e disciplina orcamentaria.",
    },
  }, { now: NOW });

  assert.equal(completed.interview.status, "accepted");
  assert.equal(completed.interview.evaluation.overallScore, 84);
  assert.equal(completed.interview.negotiationEffects.durationYearsDelta, 1);
  assert.equal(completed.interview.negotiationEffects.signingBonusMultiplier, 1.2);
  assert.equal(completed.proposal.durationYears, 3);
  assert.equal(completed.proposal.interviewCompatibility, completed.interview.compatibilityScore);
  assert.equal(completed.proposal.autonomyDelta, 8);
  assert.equal(completed.proposal.objectiveDifficultyDelta, 4);
  assert.equal(completed.proposal.objectives.some(({ title }) => /trimestralmente/i.test(title)), true);
  assert.equal(completed.proposal.specialClauses.some((clause) => /Autonomia esportiva/i.test(clause)), true);
  assert.equal(completed.application.shortlistScore > selected.application.shortlistScore, true);
  assert.equal(completed.events.some(({ type }) => type === "COACH_INTERVIEW_TURN_RECORDED"), true);
  assert.equal(completed.events.some(({ type }) => type === "COACH_INTERVIEW_ACCEPTED"), true);
  const coach = completed.room.coachCareerState.coaches.find(({ id }) => id === "free");
  const memory = coach.interviewMemories.find(({ interviewId }) => interviewId === selected.interview.id);
  assert.ok(memory);
  assert.equal(memory.questions.some((question) => /primeiros dias/i.test(question)), true);

  const appointed = respondCoachProposal(completed.room, {
    operationId: "accept-generated-interview-proposal",
    coachId: "free",
    proposalId: completed.proposal.id,
    action: "accept",
  }, { now: NOW });
  const activeContract = appointed.room.coachEmploymentState.contracts.find((contract) => (
    contract.coachId === "free" && contract.status === "active"
  ));
  assert.equal(activeContract.autonomyLevel, 58);
  assert.equal(activeContract.objectiveDifficultyAdjustment, 4);
  assert.equal(activeContract.sourceInterviewId, selected.interview.id);
  assert.equal(activeContract.objectives.some(({ title }) => /trimestralmente/i.test(title)), true);
  assert.equal(activeContract.clauses.some((clause) => /Autonomia esportiva/i.test(clause)), true);

  const replay = applyCoachInterviewGeneratedTurn(completed.room, {
    operationId: "generated-interview-turn-2",
    phase: "answer",
    coachId: "free",
    interviewId: selected.interview.id,
    expectedRevision: 2,
    expectedQuestionId: firstTurn.interview.currentQuestionId,
    candidateMessage: "Repetida",
    generated: { source: "fallback", message: "Repetida", shouldEnd: true },
  }, { now: NOW });
  assert.equal(replay.duplicate, true);
});

test("efeito generativo terminateNegotiation encerra e rejeita imediatamente", () => {
  const dismissed = resignCoach(roomFixture(), {
    operationId: "resign-ai-c-terminated-interview",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });
  const applied = applyForCoachVacancy(dismissed.room, {
    operationId: "apply-free-terminated-interview",
    vacancyId: dismissed.vacancy.id,
    coachId: "free",
  }, { now: NOW });
  const selected = progressApplicationToInterview(applied, "free");
  const started = applyCoachInterviewGeneratedTurn(selected.room, {
    operationId: "terminated-interview-start",
    phase: "start",
    coachId: "free",
    interviewId: selected.interview.id,
    expectedRevision: 0,
    depth: "deep",
    generated: {
      source: "fallback",
      message: "Qual e sua expectativa para o cargo?",
      topic: "objectives",
      shouldEnd: false,
    },
  }, { now: NOW });
  const terminated = applyCoachInterviewGeneratedTurn(started.room, {
    operationId: "terminated-interview-answer",
    phase: "answer",
    coachId: "free",
    interviewId: selected.interview.id,
    expectedRevision: 1,
    expectedQuestionId: started.interview.currentQuestionId,
    candidateMessage: "Nao aceito negociar esses objetivos.",
    generated: {
      source: "fallback",
      message: "A diretoria encerrou a conversa.",
      topic: "closing",
      shouldEnd: false,
      turnAnalysis: {
        confidenceDelta: -12,
        credibilityDelta: -8,
        strategicAlignment: 10,
        culturalFit: 20,
        perceivedRisk: 90,
        expectedTenure: 5,
      },
      negotiationEffects: {
        salaryMultiplier: 1,
        bonusMultiplier: 1,
        contractYearsDelta: 0,
        transferBudgetMultiplier: 1,
        autonomyDelta: 0,
        priorityDelta: -25,
        objectiveDifficultyDelta: 0,
        terminateNegotiation: true,
      },
    },
  }, { now: NOW });

  assert.equal(terminated.interview.status, "rejected");
  assert.equal(terminated.interview.turnCount, 1);
  assert.equal(terminated.interview.negotiationEffects.terminateNegotiation, true);
  assert.equal(terminated.application.status, "rejected");
  assert.equal(terminated.proposal, null);
});

test("aviso previo respeita permissao real para candidatura e entrevista", () => {
  const dismissed = resignCoach(roomFixture(), {
    operationId: "resign-ai-c-notice-permission",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });
  dismissed.room.professionalLifecycleState = {
    notices: [{
      id: "notice-free",
      professionalType: "coach",
      professionalId: "free",
      clubId: null,
      status: "active",
      interviewAllowed: false,
    }],
  };

  assert.throws(
    () => applyForCoachVacancy(dismissed.room, {
      operationId: "apply-free-notice-forbidden",
      vacancyId: dismissed.vacancy.id,
      coachId: "free",
    }, { now: NOW }),
    (error) => error instanceof CoachEmploymentError
      && error.code === "COACH_NOTICE_INTERVIEW_FORBIDDEN",
  );

  dismissed.room.professionalLifecycleState.notices[0].interviewAllowed = true;
  const applied = applyForCoachVacancy(dismissed.room, {
    operationId: "apply-free-notice-allowed",
    vacancyId: dismissed.vacancy.id,
    coachId: "free",
  }, { now: NOW });
  const selected = progressApplicationToInterview(applied, "free");
  selected.room.professionalLifecycleState.notices[0].interviewAllowed = false;

  assert.throws(
    () => respondCoachInterview(selected.room, {
      operationId: "answer-free-notice-forbidden",
      coachId: "free",
      interviewId: selected.interview.id,
      answers: [],
      decision: "continue",
    }, { now: NOW }),
    (error) => error instanceof CoachEmploymentError
      && error.code === "COACH_NOTICE_INTERVIEW_FORBIDDEN",
  );
});

test("renovacao cria proposta, substitui contrato so no aceite e expira vinculo sem duplicar", () => {
  const opened = renewCoachContract(roomFixture(), {
    operationId: "renew-human-001",
    coachId: "human",
    clubId: "A",
    initiatedBy: "club",
    wage: 300_000,
    durationYears: 1,
    endDate: "2026-07-22T00:00:00.000Z",
    renewalBonus: 50_000,
  }, { now: NOW });
  assert.equal(opened.previousContract.status, "active");
  assert.equal(opened.contract, null);
  assert.equal(opened.proposal.kind, "renewal");
  assert.equal(opened.proposal.status, "pending");
  assert.equal(activeContracts(opened.room).filter(({ coachId }) => coachId === "human").length, 1);

  const renewed = respondCoachProposal(opened.room, {
    operationId: "accept-renew-human-001",
    coachId: "human",
    proposalId: opened.proposal.id,
    action: "accept",
  }, { now: "2026-07-21T13:00:00.000Z" });
  assert.equal(renewed.room.coachEmploymentState.contracts.find(
    ({ id }) => id === opened.previousContract.id,
  ).status, "replaced");
  assert.equal(renewed.contract.status, "active");
  assert.equal(activeContracts(renewed.room).filter(({ coachId }) => coachId === "human").length, 1);
  activeContracts(renewed.room).find(({ coachId }) => coachId === "human").endDate = "2026-07-22T00:00:00.000Z";

  const offered = createCoachProposal(renewed.room, {
    operationId: "short-proposal",
    coachId: "free",
    clubId: "B",
    wage: 100_000,
    expiresAt: "2026-07-21T18:00:00.000Z",
  }, { now: NOW });
  const processed = processCoachEmploymentDate(offered.room, "2026-07-23T00:00:00.000Z", {
    autoDismissAI: false,
  });
  const expiredProposal = processed.room.coachEmploymentState.proposals.find(({ id }) => id === offered.proposal.id);
  const human = processed.room.coachCareerState.coaches.find(({ id }) => id === "human");

  assert.equal(expiredProposal.status, "expired");
  assert.equal(human.status, "unemployed");
  assert.equal(processed.room.managers.find(({ id }) => id === "human").clubId, null);
  assert.equal(activeAppointments(processed.room).find(({ clubId }) => clubId === "A").role, "interim");
  assert.equal(validateCoachEmploymentState(processed.room), true);

  const replay = processCoachEmploymentDate(processed.room, "2026-07-23T00:00:00.000Z", { autoDismissAI: false });
  assert.equal(replay.events.length, 0);
  assert.equal(replay.duplicate, true);
});

test("avaliacao exige minimo de jogos e usa resultados reais, sem demitir por amostra curta", () => {
  const room = roomFixture();
  room.lastCompletedRound = { round: 2 };
  room.leagueFixtureSchedule = [{
    leagueFixtureId: "r1-a-b", leagueId: "L1", round: 1, homeClubId: "A", awayClubId: "B",
  }, {
    leagueFixtureId: "r2-c-a", leagueId: "L1", round: 2, homeClubId: "C", awayClubId: "A",
  }];
  room.leagueMatchResults = [
    { leagueFixtureId: "r1-a-b", score: [0, 3] },
    { leagueFixtureId: "r2-c-a", score: [2, 0] },
  ];

  const processed = processCoachEmploymentDate(room, "2026-08-01T00:00:00.000Z", {
    minimumGames: 5,
    autoDismissAI: true,
  });
  const humanEvaluation = processed.room.coachEmploymentState.evaluations.find(({ coachId }) => coachId === "human");
  assert.equal(humanEvaluation.games, 2);
  assert.equal(humanEvaluation.minimumGamesMet, false);
  assert.equal(humanEvaluation.recommendation, "insufficient_data");
  assert.equal(processed.room.coachCareerState.coaches.find(({ id }) => id === "human").currentClubId, "A");
});

test("mercado da IA convida humanos e inicia processo sem contratacao instantanea", () => {
  const vacancyOpened = resignCoach(roomFixture(), {
    operationId: "resign-ai-c-market",
    coachId: "ai-c",
    reason: "mutual_agreement",
  }, { now: NOW });
  vacancyOpened.room.coachEmploymentState.jobSearchByCoachId = {
    human: { active: true, updatedAt: NOW },
  };

  const invited = processCoachEmploymentDate(vacancyOpened.room, NOW, {
    minimumGames: 30,
    autoDismissAI: false,
    autoDismissHuman: false,
  });
  const invitation = invited.room.coachEmploymentState.applications.find((candidate) => (
    candidate.coachId === "human" && candidate.clubId === "C" && candidate.status === "submitted"
  ));
  assert.ok(invitation, "clube vago deve convidar manager para o processo seletivo");
  assert.equal(invited.room.coachEmploymentState.proposals.some(
    ({ coachId }) => coachId === "human",
  ), false, "convite nao pode pular diretamente para proposta");

  const staged = processCoachEmploymentDate(
    invited.room,
    "2026-07-23T12:00:00.000Z",
    marketOptions(),
  );
  const proposal = staged.room.coachEmploymentState.proposals.find((candidate) => (
    candidate.coachId === "human" && candidate.clubId === "C" && candidate.status === "pending"
  ));
  assert.ok(proposal, "candidato aprovado na triagem deve receber proposta");
  assert.equal(proposal.wage > 0, true);

  const declined = respondCoachProposal(staged.room, {
    operationId: "decline-human-c-market",
    coachId: "human",
    proposalId: proposal.id,
    action: "reject",
  }, { now: NOW });
  const continued = processCoachEmploymentDate(
    declined.room,
    "2026-07-24T12:00:00.000Z",
    marketOptions(),
  );
  const state = continued.room.coachEmploymentState;
  const activeAtC = activeAppointments(continued.room).find(({ clubId }) => clubId === "C");
  const applications = state.applications.filter(({ vacancyId }) => vacancyId === vacancyOpened.vacancy.id);
  const proposals = state.proposals.filter(({ vacancyId }) => vacancyId === vacancyOpened.vacancy.id);

  assert.equal(activeAtC.role, "interim");
  assert.equal(state.vacancies.find(({ id }) => id === vacancyOpened.vacancy.id).status, "open");
  assert.equal(applications.some(({ status }) => ["shortlisted", "offered"].includes(status)), true);
  assert.equal(proposals.some(({ status }) => status === "pending"), true);
  assert.equal(proposals.every(({ decisionHistory }) => decisionHistory.length > 0), true);
  assert.equal(continued.events.some(({ type }) => type === "COACH_APPOINTED"), false);
  assert.equal(validateCoachEmploymentState(continued.room), true);

  const reloaded = ensureCoachEmploymentState(JSON.parse(JSON.stringify(continued.room)), {
    now: "2026-07-24T12:00:00.000Z",
  });
  assert.deepEqual(reloaded.coachEmploymentState.proposals, state.proposals);
  assert.deepEqual(reloaded.coachEmploymentState.applications, state.applications);
});

test("mercado da IA negocia antes de contratar treinador empregado e pagar multa", () => {
  const room = roomFixture();
  room.coachCareerState.coaches.find(({ id }) => id === "free").status = "retired";
  room.coachCareerState.coaches.find(({ id }) => id === "ai-c").status = "retired";
  Object.assign(room.coachCareerState.coaches.find(({ id }) => id === "ai-b"), {
    licenseTier: "PRO",
    experienceYears: 16,
    professionalExperienceYears: 14,
    nationality: "Brasil",
    languages: ["pt"],
    reputation: 85,
    expectedSalary: 180_000,
    achievements: { nationalTitles: 2 },
  });
  const vacancyOpened = resignCoach(room, {
    operationId: "resign-human-ai-poaching",
    coachId: "human",
    reason: "end_of_cycle",
  }, { now: NOW });
  for (const contract of vacancyOpened.room.coachEmploymentState.contracts) {
    if (["ai-b", "ai-c"].includes(contract.coachId) && contract.status === "active") {
      contract.terminationClause = 750_000;
    }
  }

  const poachingOptions = marketOptions({
    shortlistSize: 1,
    simultaneousOffersPerVacancy: 1,
  });
  const staged = processCoachEmploymentDate(
    vacancyOpened.room,
    "2026-07-23T12:00:00.000Z",
    poachingOptions,
  );
  assert.equal(activeAppointments(staged.room).find(({ clubId }) => clubId === "A").role, "interim");
  assert.equal(staged.room.coachEmploymentState.proposals.some(({ clubId, status }) => (
    clubId === "A" && status === "pending"
  )), true);
  assert.equal(staged.events.some(({ type }) => type === "COACH_APPOINTED"), false);

  const agreed = processCoachEmploymentDate(
    staged.room,
    "2026-07-25T12:00:00.000Z",
    poachingOptions,
  );
  const atTarget = activeAppointments(agreed.room).find(({ clubId }) => clubId === "A");
  assert.ok(["ai-b", "ai-c"].includes(atTarget.coachId));
  const sourceClubId = atTarget.coachId === "ai-b" ? "B" : "C";
  assert.equal(activeAppointments(agreed.room).find(({ clubId }) => clubId === sourceClubId).role, "interim");
  const buyerTransaction = agreed.financialTransactions.find((transaction) => (
    transaction.clubId === "A" && transaction.category === "coach_hiring"
  ));
  assert.ok(buyerTransaction);
  assert.equal(buyerTransaction.metadata.compensation, 750_000);
  assert.equal(buyerTransaction.amount >= 750_000, true);
  assert.equal(agreed.financialTransactions.some((transaction) => (
    transaction.clubId === sourceClubId && transaction.amount === 750_000
  )), true);
  assert.equal(agreed.room.coachEmploymentState.proposals.some(({ status }) => status === "accepted"), true);
  assert.equal(validateCoachEmploymentState(agreed.room), true);
});

test("mercado da IA ignora multa impagavel e negocia com alternativa disponivel", () => {
  const vacancyOpened = resignCoach(roomFixture(), {
    operationId: "resign-human-unaffordable-poaching",
    coachId: "human",
    reason: "end_of_cycle",
  }, { now: NOW });
  const finance = vacancyOpened.room.marketState.finances.find(({ clubId }) => clubId === "A");
  finance.balance = 4_000_000;
  finance.committed = 0;
  vacancyOpened.room.competitionCatalog[0].clubs.find(({ id }) => id === "A").reputation = 80;
  Object.assign(vacancyOpened.room.coachCareerState.coaches.find(({ id }) => id === "free"), {
    licenseTier: "PRO",
    experienceYears: 14,
    professionalExperienceYears: 12,
    nationality: "Brasil",
    languages: ["pt"],
    reputation: 82,
    expectedSalary: 120_000,
    achievements: { nationalTitles: 2 },
  });
  for (const contract of vacancyOpened.room.coachEmploymentState.contracts) {
    if (["ai-b", "ai-c"].includes(contract.coachId) && contract.status === "active") {
      contract.terminationClause = 5_000_000;
    }
  }

  const staged = processCoachEmploymentDate(
    vacancyOpened.room,
    "2026-07-23T12:00:00.000Z",
    marketOptions(),
  );
  const pending = staged.room.coachEmploymentState.proposals.find(({ clubId, coachId, status }) => (
    clubId === "A" && coachId === "free" && status === "pending"
  ));
  assert.ok(pending);
  assert.equal(activeAppointments(staged.room).find(({ clubId }) => clubId === "A").role, "interim");

  const agreed = processCoachEmploymentDate(
    staged.room,
    "2026-07-25T12:00:00.000Z",
    marketOptions(),
  );
  assert.equal(activeAppointments(agreed.room).find(({ clubId }) => clubId === "A").coachId, "free");
  const hiringTransaction = agreed.financialTransactions.find(({ category, clubId }) => (
    category === "coach_hiring" && clubId === "A"
  ));
  assert.ok(hiringTransaction);
  assert.equal(hiringTransaction.metadata.compensation, 0);
  assert.equal(validateCoachEmploymentState(agreed.room), true);
});

test("ticks datados levam propostas da IA a acordo, contraproposta ou rejeicao", () => {
  const scenarios = [{
    name: "agreement",
    wage: 300_000,
    config: { acceptanceScore: 35, counterScore: 20 },
    expectedStatus: "accepted",
    expectedAction: "accept",
  }, {
    name: "counter",
    wage: 170_000,
    config: { acceptanceScore: 95, counterScore: 20 },
    expectedStatus: "aguardando_resposta_diretoria",
    expectedAction: "counter",
  }, {
    name: "rejection",
    wage: 1_000,
    config: { acceptanceScore: 95, counterScore: 90 },
    expectedStatus: "rejected",
    expectedAction: "reject",
  }];

  for (const scenario of scenarios) {
    const vacancyOpened = resignCoach(roomFixture(), {
      operationId: `dated-${scenario.name}-vacancy`,
      coachId: "ai-c",
      reason: "end_of_cycle",
    }, { now: NOW });
    const offered = createCoachProposal(vacancyOpened.room, {
      operationId: `dated-${scenario.name}-offer`,
      coachId: "free",
      clubId: "C",
      vacancyId: vacancyOpened.vacancy.id,
      wage: scenario.wage,
      durationYears: 3,
      responseDays: 10,
    }, { now: NOW });

    assert.equal(offered.proposal.status, "pending");
    assert.equal(activeAppointments(offered.room).find(({ clubId }) => clubId === "C").role, "interim");

    const processed = processCoachEmploymentDate(
      offered.room,
      "2026-07-23T12:00:00.000Z",
      {
        ...marketOptions(scenario.config),
        minimumVacancyDays: 30,
      },
    );
    const proposal = processed.room.coachEmploymentState.proposals.find(({ id }) => id === offered.proposal.id);
    assert.equal(proposal.status, scenario.expectedStatus, scenario.name);
    assert.equal(proposal.decisionHistory.at(-1).action, scenario.expectedAction, scenario.name);
    assert.equal(proposal.decisionFactors.length > 0, true, scenario.name);

    const reloaded = ensureCoachEmploymentState(JSON.parse(JSON.stringify(processed.room)), {
      now: "2026-07-23T12:00:00.000Z",
    });
    const persisted = reloaded.coachEmploymentState.proposals.find(({ id }) => id === proposal.id);
    assert.equal(persisted.status, proposal.status, scenario.name);
    assert.deepEqual(persisted.decisionHistory, proposal.decisionHistory, scenario.name);
    assert.equal(validateCoachEmploymentState(reloaded), true);
  }
});

test("entrevista da IA persiste, influencia avaliacao e antecede proposta formal", () => {
  const vacancyOpened = resignCoach(roomFixture(), {
    operationId: "interview-market-vacancy",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });
  const free = vacancyOpened.room.coachCareerState.coaches.find(({ id }) => id === "free");
  free.reputation = 90;
  free.style = "possession";
  free.preferredFormation = "4-3-3";
  free.licenseTier = "PRO";
  free.experienceYears = 18;
  free.professionalExperienceYears = 16;
  free.nationality = "Brasil";
  free.languages = ["pt"];
  free.expectedSalary = 90_000;
  const vacancy = vacancyOpened.room.coachEmploymentState.vacancies.find(({ id }) => id === vacancyOpened.vacancy.id);
  vacancy.desiredProfile = {
    ...(vacancy.desiredProfile ?? {}),
    style: "possession",
    preferredFormation: "4-3-3",
  };
  const options = marketOptions({
    shortlistSize: 1,
    simultaneousOffersPerVacancy: 1,
    interviewChance: 100,
    interviewDelayDays: 1,
  });

  const shortlisted = processCoachEmploymentDate(
    vacancyOpened.room,
    "2026-07-23T12:00:00.000Z",
    options,
  );
  const pendingInterview = shortlisted.room.coachEmploymentState.interviews.find(({ vacancyId }) => (
    vacancyId === vacancy.id
  ));
  assert.ok(pendingInterview);
  assert.equal(pendingInterview.status, "pending");
  assert.equal(shortlisted.room.coachEmploymentState.proposals.some(({ vacancyId }) => vacancyId === vacancy.id), false);
  assert.equal(activeAppointments(shortlisted.room).find(({ clubId }) => clubId === "C").role, "interim");

  const reloaded = ensureCoachEmploymentState(JSON.parse(JSON.stringify(shortlisted.room)), {
    now: "2026-07-23T12:00:00.000Z",
  });
  const offered = processCoachEmploymentDate(reloaded, "2026-07-24T12:00:00.000Z", options);
  const interview = offered.room.coachEmploymentState.interviews.find(({ id }) => id === pendingInterview.id);
  const proposal = offered.room.coachEmploymentState.proposals.find(({ interviewId }) => interviewId === interview.id);
  assert.equal(interview.status, "accepted");
  assert.equal(interview.answers.length, interview.questions.length);
  assert.equal(interview.decisionHistory.at(-1).action, "interview_passed");
  assert.ok(proposal);
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.interviewCompatibility, interview.compatibilityScore);
  assert.equal(activeAppointments(offered.room).find(({ clubId }) => clubId === "C").role, "interim");

  const agreed = processCoachEmploymentDate(offered.room, "2026-07-26T12:00:00.000Z", options);
  const decided = agreed.room.coachEmploymentState.proposals.find(({ id }) => id === proposal.id);
  const interviewFactor = decided.decisionFactors.find(({ code }) => code === "interview");
  assert.equal(decided.status, "accepted");
  assert.ok(interviewFactor);
  assert.equal(interviewFactor.value > 0, true);
  assert.equal(activeAppointments(agreed.room).find(({ clubId }) => clubId === "C").coachId, "free");
});

test("IA abre renovacao e altera contrato somente depois do acordo", () => {
  const room = ensureCoachEmploymentState(roomFixture(), { now: NOW });
  const previous = room.coachEmploymentState.contracts.find(({ coachId, status }) => coachId === "ai-b" && status === "active");
  previous.endDate = "2026-08-15T12:00:00.000Z";
  previous.wage = 100_000;
  previous.terminationClause = 600_000;
  room.coachEmploymentState.evaluations.push({
    id: "ai-b-renewal-evidence",
    coachId: "ai-b",
    clubId: "B",
    evaluatedAt: "2026-07-20T12:00:00.000Z",
    seasonNumber: 1,
    round: 3,
    games: 8,
    points: 15,
    position: 2,
    expectedPosition: 2,
    score: 75,
    securityLevel: "secure",
    recommendation: "retain",
    factors: [{ code: "results_above_expectation", impact: 8 }],
    minimumGamesMet: true,
    operationId: "ai-b-renewal-evidence",
  });

  const opened = processCoachEmploymentDate(room, NOW, marketOptions({
    renewalMinimumScore: 60,
  }));
  const renewal = opened.room.coachEmploymentState.proposals.find(({ kind, coachId }) => (
    kind === "renewal" && coachId === "ai-b"
  ));
  const unchanged = activeContracts(opened.room).find(({ coachId }) => coachId === "ai-b");
  assert.ok(renewal);
  assert.equal(renewal.status, "pending");
  assert.equal(renewal.sourceContractId, previous.id);
  assert.equal(renewal.decisionHistory[0].action, "renewal_offer_submitted");
  assert.deepEqual(renewal.decisionHistory[0].conditions, ["ai-b-renewal-evidence"]);
  assert.equal(unchanged.id, previous.id);
  assert.equal(opened.room.coachEmploymentState.contracts.find(({ id }) => id === previous.id).status, "active");
  assert.equal(opened.events.some(({ type }) => type === "COACH_CONTRACT_RENEWED"), false);

  const renewed = processCoachEmploymentDate(
    opened.room,
    "2026-07-23T12:00:00.000Z",
    marketOptions({ renewalMinimumScore: 60 }),
  );
  const contract = activeContracts(renewed.room).find(({ coachId }) => coachId === "ai-b");
  assert.notEqual(contract.id, previous.id);
  assert.equal(contract.renewalCount, 1);
  assert.equal(contract.wage, 105_000);
  assert.equal(new Date(contract.endDate).getTime() > new Date(previous.endDate).getTime(), true);
  assert.equal(renewed.room.coachEmploymentState.contracts.find(({ id }) => id === previous.id).status, "replaced");
  assert.equal(renewed.events.some(({ type, coachId }) => type === "COACH_CONTRACT_RENEWED" && coachId === "ai-b"), true);

  const replay = processCoachEmploymentDate(renewed.room, "2026-07-23T12:00:00.000Z", marketOptions({
    renewalMinimumScore: 60,
  }));
  assert.equal(replay.events.some(({ type }) => type === "COACH_CONTRACT_RENEWED"), false);
  assert.equal(activeContracts(replay.room).filter(({ coachId }) => coachId === "ai-b").length, 1);
});

test("IA pede demissao apenas apos crise de moral comprovada em tres avaliacoes", () => {
  const room = ensureCoachEmploymentState(roomFixture(), { now: NOW });
  room.clubMoraleStates.find(({ clubId }) => clubId === "B").score = 10;
  for (let round = 1; round <= 3; round += 1) {
    room.coachEmploymentState.evaluations.push({
      id: `ai-b-unrest-${round}`,
      coachId: "ai-b",
      clubId: "B",
      evaluatedAt: `2026-07-${16 + round}T12:00:00.000Z`,
      seasonNumber: 1,
      round,
      games: round + 5,
      points: round + 4,
      position: 3,
      expectedPosition: 2,
      score: 45,
      securityLevel: "pressured",
      recommendation: "retain",
      factors: [{ code: "squad_unrest", impact: -4 }],
      minimumGamesMet: true,
      operationId: `ai-b-unrest-${round}`,
    });
  }

  const resigned = processCoachEmploymentDate(room, NOW, {
    minimumGames: 30,
    autoDismissAI: false,
    autoDismissHuman: false,
  });
  const coach = resigned.room.coachCareerState.coaches.find(({ id }) => id === "ai-b");
  assert.equal(coach.status, "resigned");
  assert.equal(coach.currentClubId, null);
  assert.equal(activeAppointments(resigned.room).find(({ clubId }) => clubId === "B").role, "interim");
  const event = resigned.events.find(({ type, coachId }) => type === "COACH_RESIGNED" && coachId === "ai-b");
  assert.equal(event.payload.reason, "prolonged_squad_unrest");
  assert.deepEqual(event.payload.evidenceEvaluationIds, ["ai-b-unrest-1", "ai-b-unrest-2", "ai-b-unrest-3"]);
  assert.equal(resigned.financialTransactions.length, 1);
  assert.equal(resigned.financialTransactions[0].category, "coach_interim_bonus");
  assert.equal(validateCoachEmploymentState(resigned.room), true);

  const replay = processCoachEmploymentDate(resigned.room, NOW, {
    minimumGames: 30,
    autoDismissAI: false,
    autoDismissHuman: false,
  });
  assert.equal(replay.events.some(({ type, coachId }) => type === "COACH_RESIGNED" && coachId === "ai-b"), false);
});

test("IA com duas avaliacoes ruins e contexto normal nao pede demissao", () => {
  const room = ensureCoachEmploymentState(roomFixture(), { now: NOW });
  for (let round = 1; round <= 2; round += 1) {
    room.coachEmploymentState.evaluations.push({
      id: `ai-b-short-unrest-${round}`,
      coachId: "ai-b",
      clubId: "B",
      evaluatedAt: `2026-07-${18 + round}T12:00:00.000Z`,
      seasonNumber: 1,
      round,
      games: 8,
      points: 6,
      score: 35,
      securityLevel: "very_pressured",
      recommendation: "review",
      factors: [{ code: "squad_unrest", impact: -2 }],
      minimumGamesMet: true,
      operationId: `ai-b-short-unrest-${round}`,
    });
  }
  const processed = processCoachEmploymentDate(room, NOW, {
    minimumGames: 30,
    autoDismissAI: false,
    autoDismissHuman: false,
  });
  assert.equal(processed.room.coachCareerState.coaches.find(({ id }) => id === "ai-b").currentClubId, "B");
  assert.equal(processed.events.some(({ type, coachId }) => type === "COACH_RESIGNED" && coachId === "ai-b"), false);
});

test("demissao automatica da IA exige duas avaliacoes graves e paga rescisao", () => {
  const room = ensureCoachEmploymentState(roomFixture(), { now: NOW });
  const contract = activeContracts(room).find(({ coachId }) => coachId === "ai-b");
  contract.terminationClause = 500_000;
  room.coachEmploymentState.evaluations.push({
    id: "ai-b-previous-dismissal-risk",
    coachId: "ai-b",
    clubId: "B",
    evaluatedAt: "2026-07-20T12:00:00.000Z",
    seasonNumber: 1,
    round: 3,
    games: 3,
    points: 0,
    position: 3,
    expectedPosition: 2,
    score: 10,
    securityLevel: "dismissal_imminent",
    recommendation: "dismiss",
    factors: [{ code: "results_below_expectation", impact: -30 }],
    minimumGamesMet: true,
    operationId: "ai-b-previous-dismissal-risk",
  });
  room.clubMoraleStates.find(({ clubId }) => clubId === "B").score = 0;
  room.marketState.finances.find(({ clubId }) => clubId === "B").balance = -1;
  room.leagueFixtureSchedule = [
    { leagueFixtureId: "b-loss-1", leagueId: "L1", round: 1, homeClubId: "B", awayClubId: "A" },
    { leagueFixtureId: "b-loss-2", leagueId: "L1", round: 2, homeClubId: "C", awayClubId: "B" },
    { leagueFixtureId: "b-loss-3", leagueId: "L1", round: 3, homeClubId: "B", awayClubId: "A" },
  ];
  room.leagueMatchResults = [
    { leagueFixtureId: "b-loss-1", score: [0, 3] },
    { leagueFixtureId: "b-loss-2", score: [2, 0] },
    { leagueFixtureId: "b-loss-3", score: [0, 1] },
  ];

  const dismissed = processCoachEmploymentDate(room, NOW, {
    minimumGames: 1,
    autoDismissAI: true,
    autoDismissHuman: false,
    autoResignAI: false,
  });
  assert.equal(dismissed.room.coachCareerState.coaches.find(({ id }) => id === "ai-b").status, "dismissed");
  assert.equal(activeAppointments(dismissed.room).find(({ clubId }) => clubId === "B").role, "interim");
  assert.equal(dismissed.events.some(({ type, coachId }) => type === "COACH_DISMISSED" && coachId === "ai-b"), true);
  assert.equal(dismissed.financialTransactions.some(({ category, amount }) => (
    category === "coach_termination" && amount === 500_000
  )), true);
  assert.equal(validateCoachEmploymentState(dismissed.room), true);
});

test("interino nao e confirmado automaticamente sem acordo contratual", () => {
  const vacancyOpened = resignCoach(roomFixture(), {
    operationId: "resign-ai-c-for-interim-confirmation",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });
  vacancyOpened.room.coachCareerState.coaches.find(({ id }) => id === "free").status = "retired";

  const processed = processCoachEmploymentDate(vacancyOpened.room, "2026-08-12T12:00:00.000Z", {
    ...marketOptions({ interviewChance: 0 }),
    minimumVacancyDays: 7,
    confirmInterimAfterDays: 21,
  });
  const atClub = activeAppointments(processed.room).find(({ clubId }) => clubId === "C");
  assert.equal(atClub.role, "interim");
  assert.equal(atClub.entryReason, "interim_after_departure");
  assert.equal(processed.room.coachEmploymentState.vacancies.find(({ id }) => id === vacancyOpened.vacancy.id).status, "open");
  assert.equal(processed.events.some(({ type }) => type === "COACH_INTERIM_CONFIRMED"), false);
  assert.equal(validateCoachEmploymentState(processed.room), true);
});

test("clubes simultaneos competem pelo treinador e proposta perdedora e encerrada", () => {
  const first = resignCoach(roomFixture(), {
    operationId: "multi-vacancy-resign-b",
    coachId: "ai-b",
    reason: "end_of_cycle",
  }, { now: NOW });
  const second = resignCoach(first.room, {
    operationId: "multi-vacancy-resign-c",
    coachId: "ai-c",
    reason: "end_of_cycle",
  }, { now: NOW });

  for (const coach of second.room.coachCareerState.coaches) {
    if (["ai-b", "ai-c"].includes(coach.id)) coach.status = "retired";
  }
  const options = marketOptions({
    shortlistSize: 1,
    simultaneousOffersPerVacancy: 1,
    interviewChance: 0,
  });
  const staged = processCoachEmploymentDate(second.room, "2026-07-23T12:00:00.000Z", options);
  const competing = staged.room.coachEmploymentState.proposals.filter(({ coachId, status }) => (
    coachId === "free" && status === "pending"
  ));
  assert.equal(competing.length, 2);
  assert.equal(new Set(competing.map(({ clubId }) => clubId)).size, 2);
  assert.equal(competing.every(({ competingProposalIds }) => competingProposalIds.length === 1), true);
  assert.equal(activeAppointments(staged.room).filter(({ clubId, role }) => (
    ["B", "C"].includes(clubId) && role === "interim"
  )).length, 2);

  const agreed = processCoachEmploymentDate(staged.room, "2026-07-25T12:00:00.000Z", options);
  const resolved = agreed.room.coachEmploymentState.proposals.filter(({ id }) => (
    competing.some((proposal) => proposal.id === id)
  ));
  const winner = resolved.find(({ status }) => status === "accepted");
  const loser = resolved.find(({ status }) => status === "withdrawn");
  assert.ok(winner);
  assert.ok(loser);
  assert.equal(loser.closedReason, "coach_signed_elsewhere");
  assert.equal(loser.decisionHistory.at(-1).action, "competing_offer_closed");
  assert.equal(loser.competingProposalIds.includes(winner.id), true);
  assert.equal(activeAppointments(agreed.room).filter(({ coachId }) => coachId === "free").length, 1);
  assert.equal(agreed.room.coachEmploymentState.vacancies.filter(({ status }) => status === "filled").length, 1);
  assert.equal(agreed.room.coachEmploymentState.vacancies.filter(({ status }) => status === "open").length, 1);
  assert.equal(agreed.events.some(({ type }) => type === "COACH_COMPETING_PROPOSAL_CLOSED"), true);
  assert.equal(validateCoachEmploymentState(agreed.room), true);
});

test("mesma vaga resolve ofertas simultaneas de candidatos diferentes sem abortar", () => {
  const vacancyOpened = resignCoach(roomFixture(), {
    operationId: "same-vacancy-resign-human",
    coachId: "human",
    reason: "end_of_cycle",
  }, { now: NOW });
  const firstOffer = createCoachProposal(vacancyOpened.room, {
    operationId: "same-vacancy-offer-free",
    coachId: "free",
    clubId: "A",
    vacancyId: vacancyOpened.vacancy.id,
    wage: 500_000,
    signingBonus: 1_000_000,
    durationYears: 3,
    responseDays: 10,
  }, { now: NOW });
  const secondOffer = createCoachProposal(firstOffer.room, {
    operationId: "same-vacancy-offer-ai-b",
    coachId: "ai-b",
    clubId: "A",
    vacancyId: vacancyOpened.vacancy.id,
    wage: 500_000,
    signingBonus: 1_000_000,
    durationYears: 3,
    responseDays: 10,
  }, { now: NOW });
  const offerIds = [firstOffer.proposal.id, secondOffer.proposal.id];
  const dueOffers = secondOffer.room.coachEmploymentState.proposals.filter(({ id }) => offerIds.includes(id));
  assert.equal(dueOffers.length, 2);
  assert.equal(new Set(dueOffers.map(({ coachId }) => coachId)).size, 2);
  assert.equal(dueOffers.every(({ status, nextActionAt }) => (
    status === "pending" && nextActionAt === "2026-07-23T12:00:00.000Z"
  )), true);

  let processed;
  assert.doesNotThrow(() => {
    processed = processCoachEmploymentDate(
      secondOffer.room,
      "2026-07-23T12:00:00.000Z",
      {
        ...marketOptions({ acceptanceScore: 35, counterScore: 20 }),
        minimumVacancyDays: 30,
      },
    );
  });

  const targetAppointments = activeAppointments(processed.room).filter(({ clubId, role }) => (
    clubId === "A" && role === "head_coach"
  ));
  const resolvedOffers = processed.room.coachEmploymentState.proposals.filter(({ id }) => offerIds.includes(id));
  const winner = resolvedOffers.find(({ status }) => status === "accepted");
  const loser = resolvedOffers.find(({ status }) => status === "encerrado_vaga_preenchida");
  const vacancy = processed.room.coachEmploymentState.vacancies.find(({ id }) => id === vacancyOpened.vacancy.id);

  assert.equal(targetAppointments.length, 1);
  assert.ok(winner);
  assert.ok(loser);
  assert.equal(targetAppointments[0].coachId, winner.coachId);
  assert.equal(loser.closedReason, "vacancy_filled");
  assert.equal(loser.decisionHistory.at(-1).action, "vacancy_filled");
  assert.equal(vacancy.status, "filled");
  assert.equal(vacancy.appointedCoachId, winner.coachId);
  assert.equal(validateCoachEmploymentState(processed.room), true);
});

test("falha de callback ou estado duplicado nao corrompe save recebido", () => {
  const original = roomFixture();
  const before = structuredClone(original);
  assert.throws(() => dismissCoach(original, {
    operationId: "callback-failure",
    coachId: "human",
    penalty: 10_000,
  }, {
    now: NOW,
    debit: () => { throw new Error("finance offline"); },
  }), /finance offline/u);
  assert.deepEqual(original, before);

  const corrupt = ensureCoachEmploymentState(original, { now: NOW });
  corrupt.coachEmploymentState.appointments.push({
    ...structuredClone(activeAppointments(corrupt)[0]),
    id: "duplicate-active-appointment",
  });
  assert.throws(
    () => validateCoachEmploymentState(corrupt, { normalize: false, now: NOW }),
    (error) => error instanceof CoachEmploymentError && error.code === "COACH_MULTIPLE_ACTIVE_APPOINTMENTS",
  );
});
