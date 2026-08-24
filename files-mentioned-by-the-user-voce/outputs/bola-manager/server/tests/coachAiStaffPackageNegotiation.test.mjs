import assert from "node:assert/strict";
import test from "node:test";
import {
  CoachEmploymentError,
  createCoachProposal,
  ensureCoachEmploymentState,
  processCoachEmploymentDate,
  respondCoachProposal,
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

function roomFixture(balance = 50_000_000) {
  return {
    code: "AI-STAFF-PACKAGE",
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
        { id: "C", name: "Celta", reputation: 16 },
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
        id: "ai-c",
        name: "Treinador Celta",
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
        expectedSalary: 120_000,
        reputation: 70,
        assignments: [],
      }],
    },
    clubCareerState: {
      currentDate: NOW,
      staffMembers: [],
      staffCandidates: [{
        id: "preferred-assistant",
        name: "Auxiliar Preferido",
        role: "assistant_coach",
        salary: 50_000,
        status: "free_agent",
      }],
      staffContracts: [],
    },
    professionalLifecycleState: {
      preferredStaffByCoach: {
        free: [{
          staffId: "preferred-assistant",
          role: "assistant_coach",
          affiliationType: "personal_team",
          affinity: 90,
          trust: 90,
          jobsTogether: 3,
          available: true,
          estimatedMonthlyCost: 50_000,
        }],
      },
    },
    marketState: {
      finances: [
        { clubId: "A", balance: 40_000_000, committed: 0 },
        { clubId: "C", balance, committed: 0 },
      ],
    },
  };
}

function marketOptions() {
  return {
    minimumGames: 30,
    minimumVacancyDays: 30,
    autoDismissAI: false,
    autoDismissHuman: false,
    autoResignAI: false,
    coachMarketConfig: {
      coachResponseDelayDays: 2,
      boardResponseDelayDays: 1,
      acceptanceScore: 35,
      counterScore: 20,
      interviewChance: 0,
    },
  };
}

function offeredProposal(room = roomFixture()) {
  return createCoachProposal(room, {
    operationId: "preferred-staff-offer",
    coachId: "free",
    clubId: "C",
    wage: 300_000,
    durationYears: 3,
    responseDays: 20,
  }, { now: NOW });
}

test("IA com comissao pessoal nao pode aceitar proposta sem garantia aprovada", () => {
  const offered = offeredProposal();
  assert.throws(
    () => respondCoachProposal(offered.room, {
      operationId: "preferred-staff-bypass",
      proposalId: offered.proposal.id,
      action: "accept",
    }, { now: NOW }),
    (error) => error instanceof CoachEmploymentError
      && error.code === "COACH_STAFF_PACKAGE_GUARANTEE_REQUIRED"
      && error.details.firstYearCost === 650_000,
  );
  assert.equal(offered.proposal.status, "pending");
  assert.equal(validateCoachEmploymentState(offered.room), true);
});

test("IA contrapoe pacote estruturado, diretoria formaliza e contrato expoe compromisso", () => {
  const offered = offeredProposal();
  const countered = processCoachEmploymentDate(
    offered.room,
    "2026-07-23T12:00:00.000Z",
    marketOptions(),
  );
  const pending = countered.room.coachEmploymentState.proposals.find(
    ({ id }) => id === offered.proposal.id,
  );
  const guarantee = countered.room.coachEmploymentState.guarantees.find(
    ({ proposalId }) => proposalId === offered.proposal.id,
  );

  assert.equal(pending.status, "aguardando_resposta_diretoria");
  assert.equal(pending.decisionReason, "required_personal_staff_package");
  assert.deepEqual(pending.pendingCounterproposal.guaranteeIds, [guarantee.id]);
  assert.equal(guarantee.kind, "staff_package");
  assert.equal(guarantee.status, "requested");
  assert.equal(guarantee.mandatory, true);
  assert.equal(guarantee.blocksCompletion, true);
  assert.deepEqual(guarantee.staffPackage.staffIds, ["preferred-assistant"]);
  assert.equal(guarantee.staffPackage.monthlyCost, 50_000);
  assert.equal(guarantee.staffPackage.firstYearCost, 650_000);
  assert.equal(guarantee.effects[0].action, "hire_coach_staff_package");
  assert.equal(
    countered.events.find(({ type }) => type === "COACH_PROPOSAL_COUNTERED")
      .payload.staffPackage.firstYearCost,
    650_000,
  );

  const approved = processCoachEmploymentDate(
    countered.room,
    "2026-07-24T12:00:00.000Z",
    marketOptions(),
  );
  const approvedProposal = approved.room.coachEmploymentState.proposals.find(
    ({ id }) => id === offered.proposal.id,
  );
  const formalized = approved.room.coachEmploymentState.guarantees.find(
    ({ id }) => id === guarantee.id,
  );
  const boardDecision = approvedProposal.decisionHistory.at(-1);

  assert.equal(approvedProposal.status, "aprovada_diretoria");
  assert.equal(formalized.status, "formalized");
  assert.ok(formalized.formalizedAt);
  assert.equal(boardDecision.action, "board_approve");
  assert.equal(boardDecision.negotiatedValues.boardDecisionContext.staffPackageFirstYearCost, 650_000);
  assert.deepEqual(boardDecision.conditions, [guarantee.id]);

  const signed = processCoachEmploymentDate(
    approved.room,
    "2026-07-26T12:00:00.000Z",
    marketOptions(),
  );
  const accepted = signed.room.coachEmploymentState.proposals.find(
    ({ id }) => id === offered.proposal.id,
  );
  const contract = signed.room.coachEmploymentState.contracts.find(
    ({ coachId, status }) => coachId === "free" && status === "active",
  );

  assert.equal(accepted.status, "accepted");
  assert.ok(contract);
  assert.deepEqual(contract.guaranteeIds, [guarantee.id]);
  assert.equal(contract.staffPackageCommitments.length, 1);
  assert.equal(contract.staffPackageCommitments[0].action, "hire_coach_staff_package");
  assert.deepEqual(contract.staffPackageCommitments[0].staffIds, ["preferred-assistant"]);
  assert.equal(contract.staffPackageCommitments[0].firstYearCost, 650_000);
  assert.equal(validateCoachEmploymentState(signed.room), true);

  const reloaded = ensureCoachEmploymentState(
    JSON.parse(JSON.stringify(signed.room)),
    { now: "2026-07-26T12:00:00.000Z" },
  );
  const persistedContract = reloaded.coachEmploymentState.contracts.find(
    ({ id }) => id === contract.id,
  );
  assert.deepEqual(persistedContract.staffPackageCommitments, contract.staffPackageCommitments);
});

test("diretoria recusa pacote acima do caixa e registra recusa auditavel", () => {
  const offered = offeredProposal(roomFixture(1_000_000));
  const countered = processCoachEmploymentDate(
    offered.room,
    "2026-07-23T12:00:00.000Z",
    marketOptions(),
  );
  const guarantee = countered.room.coachEmploymentState.guarantees.find(
    ({ proposalId }) => proposalId === offered.proposal.id,
  );
  const rejected = processCoachEmploymentDate(
    countered.room,
    "2026-07-24T12:00:00.000Z",
    marketOptions(),
  );
  const proposal = rejected.room.coachEmploymentState.proposals.find(
    ({ id }) => id === offered.proposal.id,
  );
  const waived = rejected.room.coachEmploymentState.guarantees.find(
    ({ id }) => id === guarantee.id,
  );
  const decision = proposal.decisionHistory.at(-1);

  assert.equal(proposal.status, "rejected");
  assert.match(proposal.responseReason, /pacote da comissao/i);
  assert.equal(decision.action, "board_reject");
  assert.equal(decision.negotiatedValues.boardDecisionContext.availableFunds, 1_000_000);
  assert.equal(decision.negotiatedValues.boardDecisionContext.requiredReserve, 1_550_000);
  assert.equal(decision.negotiatedValues.boardDecisionContext.staffPackageFirstYearCost, 650_000);
  assert.deepEqual(decision.conditions, [guarantee.id]);
  assert.equal(waived.status, "waived");
  assert.equal(waived.history.at(-1).action, "guarantee_waived");
  assert.match(waived.history.at(-1).justification, /pacote da comissao/i);
  assert.equal(rejected.room.coachEmploymentState.appointments.some(
    ({ coachId, status }) => coachId === "free" && status === "active",
  ), false);
  assert.equal(validateCoachEmploymentState(rejected.room), true);
});
