import assert from "node:assert/strict";
import test from "node:test";
import {
  CoachEmploymentError,
  applyForCoachVacancy,
  createCoachProposal,
  ensureCoachEmploymentState,
  processCoachEmploymentDate,
  respondCoachBoardDecision,
  respondCoachInterview,
  respondCoachProposal,
} from "../game/coachEmployment.mjs";

const NOW = "2026-07-21T12:00:00.000Z";
const DUE_AT = "2026-08-15T12:00:00.000Z";

function assignment(clubId, coachId) {
  return {
    clubId,
    coachId,
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
  const employed = (id, name, clubId) => ({
    id,
    name,
    managerType: id === "human" ? "human" : "ai",
    status: "employed",
    currentClubId: clubId,
    assignments: [assignment(clubId, id)],
  });
  const available = (id, name) => ({
    id,
    name,
    managerType: "ai",
    status: "unemployed",
    currentClubId: null,
    assignments: [],
    licenseTier: "PRO",
    languages: ["pt"],
    nationality: "Brasil",
    experienceYears: 12,
    professionalExperienceYears: 10,
    achievements: { nationalTitles: 1 },
  });

  return {
    code: "NEGOTIATION01",
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
      coaches: [
        employed("human", "Emanuel", "A"),
        employed("ai-b", "Tecnico Boreal", "B"),
        employed("ai-c", "Tecnico Celta", "C"),
        available("selected", "Candidato Contratado"),
        available("competitor", "Candidato Concorrente"),
        available("preclosed", "Candidato Encerrado"),
      ],
    },
    clubCareerState: { currentDate: NOW, staffMembers: [] },
    marketState: {
      finances: [
        { clubId: "A", balance: 100_000_000 },
        { clubId: "B", balance: 80_000_000 },
        { clubId: "C", balance: 50_000_000 },
      ],
    },
  };
}

function roomWithVacancy() {
  const room = ensureCoachEmploymentState(roomFixture(), { now: NOW });
  room.coachEmploymentState.vacancies.push({
    id: "vacancy-a",
    clubId: "A",
    status: "open",
    reason: "recruitment_test",
    openedAt: NOW,
    closesAt: "2026-09-01T12:00:00.000Z",
    recruiterId: "recruiter-a",
    operationId: "open-vacancy-a",
  });
  return room;
}

function offeredProposal() {
  return createCoachProposal(roomWithVacancy(), {
    operationId: "offer-selected",
    coachId: "selected",
    clubId: "A",
    vacancyId: "vacancy-a",
    wage: 150_000,
    durationYears: 2,
    terminationClause: 1_000_000,
  }, { now: NOW });
}

function counteredProposal(overrides = {}) {
  const offered = offeredProposal();
  return respondCoachProposal(offered.room, {
    operationId: overrides.operationId ?? "counter-selected",
    proposalId: offered.proposal.id,
    coachId: "selected",
    action: "counter",
    wage: overrides.wage ?? 180_000,
    durationYears: overrides.durationYears ?? 3,
    terminationClause: overrides.terminationClause ?? 1_500_000,
    signingBonus: overrides.signingBonus ?? 75_000,
    reason: overrides.reason ?? "Ajuste ao projeto esportivo",
    guarantees: overrides.guarantees,
  }, { now: NOW });
}

function assertDomainError(code) {
  return (error) => error instanceof CoachEmploymentError && error.code === code;
}

function applyCandidate(room, coachId) {
  return applyForCoachVacancy(room, {
    operationId: `apply-${coachId}`,
    vacancyId: "vacancy-a",
    coachId,
  }, { now: NOW });
}

function decideInterview(room, coachId, decision) {
  const application = room.coachEmploymentState.applications.find((candidate) => (
    candidate.vacancyId === "vacancy-a" && candidate.coachId === coachId
  ));
  const interview = room.coachEmploymentState.interviews.find((candidate) => (
    candidate.applicationId === application?.id
  ));
  assert.ok(application, `candidatura de ${coachId} deveria existir`);
  assert.ok(interview, `entrevista de ${coachId} deveria ser agendada após a triagem`);
  return respondCoachInterview(room, {
    operationId: `interview-${coachId}-${decision}`,
    interviewId: interview.id,
    coachId,
    decision,
    wage: 160_000,
    durationYears: 2,
    answers: decision === "accept"
      ? interview.questions.map((question) => ({
        questionId: question.id,
        answerId: question.preferredAnswer,
      }))
      : [],
  }, { now: NOW });
}

function vacancySelectionReady() {
  let room = roomWithVacancy();
  for (const coachId of ["selected", "competitor", "preclosed"]) {
    const submitted = applyCandidate(room, coachId);
    assert.equal(submitted.application.status, "submitted");
    assert.equal(submitted.interview, null);
    room = submitted.room;
  }

  const selection = processCoachEmploymentDate(room, NOW, {
    minimumVacancyDays: 0,
    coachMarketConfig: {
      shortlistSize: 8,
      simultaneousOffersPerVacancy: 5,
      minimumCandidateScore: 0,
      interviewChance: 100,
    },
  });
  const selected = decideInterview(selection.room, "selected", "accept");
  const competitor = decideInterview(selected.room, "competitor", "accept");
  const preclosed = decideInterview(competitor.room, "preclosed", "reject");

  return {
    room: preclosed.room,
    selected,
    competitor,
    preclosed,
  };
}

function fillPreparedVacancy(prepared = vacancySelectionReady()) {
  return respondCoachProposal(prepared.room, {
    operationId: "hire-selected",
    proposalId: prepared.selected.proposal.id,
    coachId: "selected",
    action: "accept",
  }, { now: NOW });
}

test("contraproposta fica aguardando resposta formal da diretoria", () => {
  const result = counteredProposal();
  const decision = result.proposal.decisionHistory.at(-1);
  const notification = result.room.coachEmploymentState.notifications.at(-1);

  assert.equal(result.proposal.status, "aguardando_resposta_diretoria");
  assert.equal(result.proposal.pendingCounterproposal.wage, 180_000);
  assert.equal(result.proposal.pendingCounterproposal.operationId, "counter-selected");
  assert.equal(decision.action, "counter");
  assert.equal(decision.previousStatus, "pending");
  assert.equal(decision.newStatus, "aguardando_resposta_diretoria");
  assert.equal(notification.type, "COACH_COUNTERPROPOSAL_AWAITING_BOARD");
  assert.equal(notification.recipientRole, "board");
});

test("diretoria aprova contraproposta e registra responsavel, horario e justificativa", () => {
  const countered = counteredProposal();
  const approved = respondCoachBoardDecision(countered.room, {
    operationId: "board-approve",
    proposalId: countered.proposal.id,
    action: "approve",
    responsibleId: "director-1",
    responsibleRole: "sporting_director",
    justification: "Termos cabem no orcamento",
  }, { now: NOW });
  const decision = approved.proposal.decisionHistory.at(-1);

  assert.equal(approved.proposal.status, "aprovada_diretoria");
  assert.equal(approved.proposal.wage, 180_000);
  assert.equal(approved.proposal.pendingCounterproposal, null);
  assert.deepEqual({
    action: decision.action,
    responsibleId: decision.responsibleId,
    responsibleRole: decision.responsibleRole,
    decidedAt: decision.decidedAt,
    justification: decision.justification,
    previousStatus: decision.previousStatus,
    newStatus: decision.newStatus,
  }, {
    action: "board_approve",
    responsibleId: "director-1",
    responsibleRole: "sporting_director",
    decidedAt: NOW,
    justification: "Termos cabem no orcamento",
    previousStatus: "aguardando_resposta_diretoria",
    newStatus: "aprovada_diretoria",
  });
});

test("diretoria rejeita contraproposta formalmente", () => {
  const countered = counteredProposal();
  const rejected = respondCoachBoardDecision(countered.room, {
    operationId: "board-reject",
    proposalId: countered.proposal.id,
    action: "reject",
    responsibleId: "director-2",
    justification: "Valor fora da politica salarial",
  }, { now: NOW });

  assert.equal(rejected.proposal.status, "rejected");
  assert.equal(rejected.proposal.responseReason, "Valor fora da politica salarial");
  assert.equal(rejected.proposal.decisionHistory.at(-1).action, "board_reject");
  assert.equal(rejected.room.coachEmploymentState.notifications.some(({ type }) => type === "COACH_BOARD_REJECT"), true);
  assert.equal(rejected.room.coachEmploymentState.notifications.some(({ type }) => type === "COACH_BOARD_RESPONSE_RECRUITER"), true);
});

test("diretoria apresenta nova proposta com novos valores", () => {
  const countered = counteredProposal();
  const newOffer = respondCoachBoardDecision(countered.room, {
    operationId: "board-new-offer",
    proposalId: countered.proposal.id,
    action: "new_offer",
    responsibleId: "director-3",
    justification: "Oferta intermediaria",
    wage: 165_000,
    durationYears: 4,
    signingBonus: 25_000,
  }, { now: NOW });

  assert.equal(newOffer.proposal.status, "pending");
  assert.equal(newOffer.proposal.wage, 165_000);
  assert.equal(newOffer.proposal.durationYears, 4);
  assert.equal(newOffer.proposal.signingBonus, 25_000);
  assert.equal(newOffer.proposal.pendingCounterproposal, null);
  assert.equal(newOffer.proposal.decisionHistory.at(-1).action, "board_new_offer");
});

test("contraproposta pendente bloqueia a conclusao da negociacao", () => {
  const countered = counteredProposal();
  const before = structuredClone(countered.room);

  assert.throws(() => respondCoachProposal(countered.room, {
    operationId: "accept-before-board",
    proposalId: countered.proposal.id,
    coachId: "selected",
    action: "accept",
  }, { now: NOW }), assertDomainError("COACH_COUNTERPROPOSAL_AWAITING_BOARD"));
  assert.deepEqual(countered.room, before);
});

test("garantia e estruturada, vinculada e produz efeito real nos termos", () => {
  const countered = counteredProposal({
    operationId: "counter-with-structured-guarantee",
    guarantees: [{
      description: "Piso salarial acordado",
      responsibleId: "finance-director",
      responsibleRole: "finance",
      dueAt: DUE_AT,
      mandatory: true,
      blocksCompletion: true,
    }],
  });
  const requested = countered.room.coachEmploymentState.guarantees[0];

  assert.deepEqual({
    proposalId: requested.proposalId,
    vacancyId: requested.vacancyId,
    coachId: requested.coachId,
    clubId: requested.clubId,
    responsibleId: requested.responsibleId,
    dueAt: requested.dueAt,
    status: requested.status,
  }, {
    proposalId: countered.proposal.id,
    vacancyId: "vacancy-a",
    coachId: "selected",
    clubId: "A",
    responsibleId: "finance-director",
    dueAt: DUE_AT,
    status: "requested",
  });

  const approved = respondCoachBoardDecision(countered.room, {
    operationId: "formalize-structured-guarantee",
    proposalId: countered.proposal.id,
    action: "approve",
    responsibleId: "director-4",
    guaranteeResolutions: [{
      guaranteeId: requested.id,
      status: "formalized",
      responsibleId: "finance-director",
      dueAt: DUE_AT,
      effects: [{ type: "salary_adjustment", amount: 210_000 }],
      justification: "Garantia incorporada a proposta",
    }],
  }, { now: NOW });

  assert.equal(approved.guarantees[0].status, "formalized");
  assert.equal(approved.guarantees[0].formalizedAt, NOW);
  assert.deepEqual(approved.guarantees[0].effects, [{ type: "salary_adjustment", amount: 210_000 }]);
  assert.equal(approved.proposal.wage, 210_000, "efeito estruturado altera a proposta final");
});

test("garantia obrigatoria nao formalizada bloqueia a conclusao", () => {
  const countered = counteredProposal({
    operationId: "counter-mandatory-guarantee",
    guarantees: [{
      description: "Clausula obrigatoria",
      responsibleId: "legal-director",
      dueAt: DUE_AT,
      mandatory: true,
      blocksCompletion: true,
    }],
  });
  const approved = respondCoachBoardDecision(countered.room, {
    operationId: "approve-with-unresolved-guarantee",
    proposalId: countered.proposal.id,
    action: "approve",
    responsibleId: "director-5",
  }, { now: NOW });
  const before = structuredClone(approved.room);

  assert.throws(() => respondCoachProposal(approved.room, {
    operationId: "accept-unresolved-guarantee",
    proposalId: approved.proposal.id,
    coachId: "selected",
    action: "accept",
  }, { now: NOW }), assertDomainError("COACH_GUARANTEE_BLOCKS_COMPLETION"));
  assert.deepEqual(approved.room, before);
});

test("preenchimento da vaga encerra todos os processos concorrentes ativos", () => {
  const prepared = vacancySelectionReady();
  const filled = fillPreparedVacancy(prepared);
  const state = filled.room.coachEmploymentState;
  const competitorApplication = state.applications.find(({ coachId }) => coachId === "competitor");
  const competitorInterview = state.interviews.find(({ coachId }) => coachId === "competitor");
  const competitorProposal = state.proposals.find(({ coachId }) => coachId === "competitor");

  assert.equal(state.vacancies.find(({ id }) => id === "vacancy-a").status, "filled");
  assert.equal(competitorApplication.status, "encerrado_vaga_preenchida");
  assert.equal(competitorInterview.status, "encerrado_vaga_preenchida");
  assert.equal(competitorProposal.status, "encerrado_vaga_preenchida");
  assert.equal(competitorApplication.closedAt, NOW);
  assert.equal(competitorApplication.closedReason, "vacancy_filled");
  assert.equal(competitorApplication.closedBy, "hire-selected");
  assert.equal(competitorApplication.decisionHistory.at(-1).action, "vacancy_filled");
});

test("processo do candidato escolhido permanece contratado", () => {
  const prepared = vacancySelectionReady();
  const filled = fillPreparedVacancy(prepared);
  const state = filled.room.coachEmploymentState;

  assert.equal(state.applications.find(({ coachId }) => coachId === "selected").status, "contratado");
  assert.equal(state.interviews.find(({ coachId }) => coachId === "selected").status, "contratado");
  assert.equal(state.proposals.find(({ id }) => id === prepared.selected.proposal.id).status, "accepted");
  assert.equal(state.vacancies.find(({ id }) => id === "vacancy-a").appointedCoachId, "selected");
});

test("candidatura tardia entra na triagem mesmo com ofertas ativas sem duplicar processo", () => {
  const prepared = vacancySelectionReady();
  prepared.room.coachCareerState.coaches.push({
    id: "late",
    name: "Candidato Tardio",
    managerType: "ai",
    status: "unemployed",
    currentClubId: null,
    assignments: [],
    licenseTier: "PRO",
    languages: ["pt"],
    nationality: "Brasil",
    experienceYears: 12,
    professionalExperienceYears: 10,
    achievements: { nationalTitles: 1 },
  });
  const submitted = applyCandidate(prepared.room, "late");
  assert.equal(submitted.application.status, "submitted");
  assert.equal(
    submitted.room.coachEmploymentState.proposals.some(({ status }) => status === "pending"),
    true,
  );

  const selected = processCoachEmploymentDate(submitted.room, NOW, {
    minimumVacancyDays: 0,
    coachMarketConfig: {
      shortlistSize: 8,
      simultaneousOffersPerVacancy: 5,
      minimumCandidateScore: 0,
      interviewChance: 100,
    },
  });
  const lateApplications = selected.room.coachEmploymentState.applications
    .filter(({ coachId }) => coachId === "late");
  const lateInterviews = selected.room.coachEmploymentState.interviews
    .filter(({ coachId }) => coachId === "late");

  assert.equal(lateApplications.length, 1);
  assert.equal(lateApplications[0].status, "interview");
  assert.equal(lateInterviews.length, 1);

  const repeated = processCoachEmploymentDate(selected.room, NOW, {
    minimumVacancyDays: 0,
    coachMarketConfig: {
      shortlistSize: 8,
      minimumCandidateScore: 0,
      interviewChance: 100,
    },
  });
  assert.equal(
    repeated.room.coachEmploymentState.applications.filter(({ coachId }) => coachId === "late").length,
    1,
  );
  assert.equal(
    repeated.room.coachEmploymentState.interviews.filter(({ coachId }) => coachId === "late").length,
    1,
  );
});

test("solvencia considera doze meses de salario sem reservar committed apos aceite", () => {
  const offered = createCoachProposal(roomWithVacancy(), {
    operationId: "offer-insolvent",
    coachId: "selected",
    clubId: "A",
    vacancyId: "vacancy-a",
    wage: 10_000_000,
    durationYears: 2,
    signingBonus: 0,
    compensation: 0,
  }, { now: NOW });
  const beforeFinance = structuredClone(offered.room.marketState.finances.find(({ clubId }) => clubId === "A"));

  assert.throws(() => respondCoachProposal(offered.room, {
    operationId: "accept-insolvent",
    proposalId: offered.proposal.id,
    coachId: "selected",
    action: "accept",
  }, { now: NOW }), (error) => (
    error instanceof CoachEmploymentError
      && error.code === "COACH_PROPOSAL_BUDGET_CHANGED"
      && error.details.salaryCommitment === 120_000_000
  ));
  assert.deepEqual(
    offered.room.marketState.finances.find(({ clubId }) => clubId === "A"),
    beforeFinance,
  );

  const prepared = vacancySelectionReady();
  const committedBefore = prepared.room.marketState.finances.find(({ clubId }) => clubId === "A").committed;
  const filled = fillPreparedVacancy(prepared);
  assert.equal(
    filled.room.marketState.finances.find(({ clubId }) => clubId === "A").committed,
    committedBefore,
  );
});

test("processos encerrados antes do preenchimento nao sao alterados", () => {
  const prepared = vacancySelectionReady();
  const beforeApplication = structuredClone(prepared.room.coachEmploymentState.applications.find(({ coachId }) => coachId === "preclosed"));
  const beforeInterview = structuredClone(prepared.room.coachEmploymentState.interviews.find(({ coachId }) => coachId === "preclosed"));
  const filled = fillPreparedVacancy(prepared);
  const state = filled.room.coachEmploymentState;

  assert.deepEqual(state.applications.find(({ coachId }) => coachId === "preclosed"), beforeApplication);
  assert.deepEqual(state.interviews.find(({ coachId }) => coachId === "preclosed"), beforeInterview);
});

test("repetir a mesma operacao de preenchimento e idempotente", () => {
  const prepared = vacancySelectionReady();
  const filled = fillPreparedVacancy(prepared);
  const persisted = ensureCoachEmploymentState(filled.room, { now: NOW });
  const before = structuredClone(persisted);
  const notificationCount = persisted.coachEmploymentState.notifications.length;
  const decisionCount = persisted.coachEmploymentState.applications
    .flatMap(({ decisionHistory }) => decisionHistory).length;

  const repeated = respondCoachProposal(persisted, {
    operationId: "hire-selected",
    proposalId: prepared.selected.proposal.id,
    coachId: "selected",
    action: "accept",
  }, { now: NOW });

  assert.equal(repeated.duplicate, true);
  assert.deepEqual(repeated.room, before);
  assert.equal(repeated.room.coachEmploymentState.notifications.length, notificationCount);
  assert.equal(repeated.room.coachEmploymentState.applications.flatMap(({ decisionHistory }) => decisionHistory).length, decisionCount);
});

test("falha tardia na atualizacao preserva rollback completo do save recebido", () => {
  const countered = counteredProposal({
    operationId: "counter-before-rollback",
    guarantees: [{
      description: "Garantia sujeita a rollback",
      responsibleId: "legal-director",
      dueAt: DUE_AT,
      mandatory: true,
      blocksCompletion: true,
    }],
  });
  const before = structuredClone(countered.room);
  const guarantee = countered.room.coachEmploymentState.guarantees[0];

  assert.throws(() => respondCoachBoardDecision(countered.room, {
    operationId: "board-callback-failure",
    proposalId: countered.proposal.id,
    action: "approve",
    responsibleId: "director-rollback",
    guaranteeResolutions: [{
      guaranteeId: guarantee.id,
      status: "formalized",
      effects: [{ type: "salary_adjustment", amount: 250_000 }],
    }],
  }, {
    now: NOW,
    recordEvent: () => { throw new Error("audit store unavailable"); },
  }), /audit store unavailable/u);

  assert.deepEqual(countered.room, before);
  assert.equal(countered.room.coachEmploymentState.guarantees[0].status, "requested");
  assert.equal(countered.room.coachEmploymentState.processedOperationIds.includes("board-callback-failure"), false);
});
