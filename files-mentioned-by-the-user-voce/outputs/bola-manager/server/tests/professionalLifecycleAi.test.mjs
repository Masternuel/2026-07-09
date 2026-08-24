import assert from "node:assert/strict";
import test from "node:test";
import { ensureCoachEmploymentState } from "../game/coachEmployment.mjs";
import { ensureStaffState } from "../game/staffEngine.mjs";
import {
  ensureProfessionalLifecycleState,
  proposeMutualSeparation,
} from "../game/professionalLifecycle.mjs";
import {
  assessAiCoachLifecycle,
  professionalLifecycleAiSnapshot,
  runAiProfessionalLifecycleTick,
} from "../game/professionalLifecycleAi.mjs";

const NOW = "2026-07-21T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1_000;

function later(days) {
  return new Date(new Date(NOW).getTime() + days * DAY_MS).toISOString();
}

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
  const base = {
    code: "LIFECYCLE-AI",
    currentSeason: 1,
    seasonYear: 2026,
    totalRounds: 38,
    seasonEndsAt: "2026-12-31T23:59:59.999Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastCompletedRound: { round: 10 },
    managers: [{ id: "human", name: "Emanuel", clubId: "A", ready: true }],
    competitionCatalog: [{
      id: "L1",
      name: "Liga",
      country: "Brasil",
      active: true,
      clubs: [
        { id: "A", name: "Aurora", country: "Brasil", reputation: 18 },
        { id: "B", name: "Boreal", country: "Brasil", reputation: 14 },
      ],
    }],
    coachCareerState: {
      version: 1,
      coaches: [{
        id: "human",
        name: "Emanuel",
        age: 35,
        salary: 100_000,
        managerType: "human",
        status: "employed",
        currentClubId: "A",
        assignments: [assignment("A", "human")],
      }, {
        id: "ai-b",
        name: "Tecnico Boreal",
        age: 45,
        salary: 80_000,
        managerType: "ai",
        status: "employed",
        currentClubId: "B",
        boardConfidence: 60,
        satisfaction: 60,
        assignments: [assignment("B", "ai-b")],
      }, {
        id: "free",
        name: "Treinador Livre",
        age: 48,
        managerType: "ai",
        status: "unemployed",
        currentClubId: null,
        assignments: [],
      }],
    },
    clubCareerState: {
      currentDate: NOW,
    },
    marketState: {
      finances: [
        { clubId: "A", balance: 100_000_000 },
        { clubId: "B", balance: 80_000_000 },
      ],
    },
  };
  let room = ensureCoachEmploymentState(base, { now: NOW });
  room = ensureStaffState(room, { now: NOW, candidateCountPerRole: 1 });
  return ensureProfessionalLifecycleState(room, { now: NOW });
}

function coach(room, id = "ai-b") {
  return room.coachCareerState.coaches.find((candidate) => candidate.id === id);
}

function aiContract(room) {
  return room.coachEmploymentState.contracts.find((contract) => (
    contract.coachId === "ai-b" && contract.status === "active"
  ));
}

function addEvaluation(room, score) {
  room.coachEmploymentState.evaluations.push({
    id: `evaluation-${score}`,
    coachId: "ai-b",
    clubId: "B",
    score,
    round: 10,
    createdAt: NOW,
  });
}

test("dirigente pondera custo, impacto, staff, substituto, temporada e confianca", () => {
  const room = roomFixture();
  coach(room).boardConfidence = 8;
  coach(room).satisfaction = 55;
  addEvaluation(room, 12);
  const staff = room.clubCareerState.staffMembers.filter(({ clubId }) => clubId === "B").slice(0, 2);
  room.professionalLifecycleState.preferredStaffByCoach["ai-b"] = staff.map((member) => ({
    staffId: member.id,
    role: member.role,
    affiliationType: "personal_team",
    affinity: 90,
    trust: 90,
    jobsTogether: 2,
    available: false,
    estimatedMonthlyCost: member.salary,
    lastWorkedTogetherAt: null,
    updatedAt: NOW,
  }));

  const assessment = assessAiCoachLifecycle(room, "ai-b", { now: NOW });

  assert.ok(assessment.boardExitScore >= 75);
  assert.ok(assessment.compensation.total >= 0);
  assert.equal(assessment.sportingImpact, 12);
  assert.equal(assessment.personalStaffRisk.totalAtRisk, 2);
  assert.equal(assessment.substituteAvailable, true);
  assert.equal(assessment.seasonTiming.progress, 0.263);
  assert.equal(assessment.confidence, 8);
});

test("dirigente IA abre acordo mutuo e repetir o mesmo tick nao duplica", () => {
  const room = roomFixture();
  coach(room).boardConfidence = 5;
  addEvaluation(room, 10);

  const first = runAiProfessionalLifecycleTick(room, NOW);
  const agreement = first.room.professionalLifecycleState.mutualAgreements.find(
    ({ professionalId }) => professionalId === "ai-b",
  );
  const timelineLength = first.room.professionalLifecycleState.timeline.length;
  const second = runAiProfessionalLifecycleTick(first.room, NOW);

  assert.equal(agreement.status, "proposed");
  assert.ok(first.decisions.some(({ action }) => action === "mutual_proposed"));
  assert.equal(second.duplicate, true);
  assert.equal(second.room.professionalLifecycleState.timeline.length, timelineLength);
  assert.equal(
    professionalLifecycleAiSnapshot(second.room).processedTickIds.length,
    0,
    "snapshot nao expoe chaves internas de idempotencia",
  );
});

test("custo impagavel bloqueia rescisao mesmo com baixa confianca", () => {
  const room = roomFixture();
  coach(room).boardConfidence = 2;
  coach(room).satisfaction = 60;
  addEvaluation(room, 5);
  aiContract(room).terminationClause = 500_000_000;
  room.marketState.finances.find(({ clubId }) => clubId === "B").balance = 1_000;

  const result = runAiProfessionalLifecycleTick(room, NOW);
  const audit = result.room.professionalLifecycleAiState.audit.find(
    ({ professionalId }) => professionalId === "ai-b",
  );

  assert.equal(result.room.professionalLifecycleState.mutualAgreements.length, 0);
  assert.equal(audit.action, "no_action");
  assert.equal(audit.reason, "termination_cost_unaffordable");
  assert.equal(audit.factors.affordabilityRatio, 0);
});

test("treinador IA insatisfeito inicia aviso sem decisao instantanea", () => {
  const room = roomFixture();
  coach(room).boardConfidence = 75;
  coach(room).satisfaction = 5;
  addEvaluation(room, 75);

  const result = runAiProfessionalLifecycleTick(room, NOW);
  const notice = result.room.professionalLifecycleState.notices.find(
    ({ professionalId }) => professionalId === "ai-b",
  );

  assert.equal(notice.status, "active");
  assert.equal(notice.initiatedBy, "professional");
  assert.equal(notice.expectedEndDate, later(30));
  assert.ok(result.decisions.some(({ action }) => action === "notice_started"));
});

test("treinador veterano IA anuncia aposentadoria com fatores auditaveis", () => {
  const room = roomFixture();
  coach(room).age = 72;

  const result = runAiProfessionalLifecycleTick(room, NOW);
  const retirement = result.room.professionalLifecycleState.retirements.find(
    ({ professionalId }) => professionalId === "ai-b",
  );
  const audit = result.room.professionalLifecycleAiState.audit.find(
    ({ action, professionalId }) => action === "retirement_announced" && professionalId === "ai-b",
  );

  assert.equal(retirement.status, "scheduled");
  assert.equal(retirement.decisionFactors.age, 72);
  assert.equal(typeof retirement.decisionFactors.contractScore, "number");
  assert.equal(typeof retirement.decisionFactors.marketInterest, "number");
  assert.equal(typeof retirement.decisionFactors.professionalHealth, "number");
  assert.equal(audit.factors.eligible, true);
});

test("treinador IA sem clube pode encerrar carreira considerando tempo fora do mercado", () => {
  const room = roomFixture();
  const freeCoach = coach(room, "free");
  freeCoach.age = 70;
  freeCoach.experienceYears = 32;
  freeCoach.unemployedSince = "2024-01-01T00:00:00.000Z";
  freeCoach.professionalHealth = 62;

  const result = runAiProfessionalLifecycleTick(room, NOW);
  const retirement = result.room.professionalLifecycleState.retirements.find(
    ({ professionalId }) => professionalId === "free",
  );

  assert.equal(retirement.status, "scheduled");
  assert.equal(retirement.clubId, null);
  assert.ok(retirement.decisionFactors.unemploymentDays > 365);
  assert.ok(retirement.decisionFactors.healthWearScore > 0);
  assert.equal(retirement.decisionFactors.eligible, true);
});

test("membro veterano da comissao anuncia aposentadoria e nao vira agente livre", () => {
  const room = roomFixture();
  const staff = room.clubCareerState.staffMembers.find(({ clubId }) => clubId === "B");
  staff.age = 70;

  const result = runAiProfessionalLifecycleTick(room, NOW);
  const retirement = result.room.professionalLifecycleState.retirements.find(
    ({ professionalType, professionalId }) => (
      professionalType === "staff" && professionalId === staff.id
    ),
  );

  assert.equal(retirement.status, "scheduled");
  assert.equal(retirement.decisionFactors.eligible, true);
  assert.equal(typeof retirement.decisionFactors.experienceYears, "number");
  assert.equal(typeof retirement.decisionFactors.professionalHealth, "number");
  assert.equal(
    result.room.clubCareerState.staffCandidates.some(({ id }) => id === staff.id),
    false,
  );
});

test("negociacao IA avanca em dias distintos ate aceite e assinatura bilateral", () => {
  const room = roomFixture();
  const contract = aiContract(room);
  const proposal = proposeMutualSeparation(room, {
    operationId: "ai-agreement:proposal",
    professionalType: "coach",
    professionalId: "ai-b",
    clubId: "B",
    proposedBy: "club",
    departureDate: later(10),
    terms: { compensation: Math.max(contract.terminationClause, contract.wage * 12) },
  }, { now: NOW });

  const accepted = runAiProfessionalLifecycleTick(proposal.room, later(1));
  let agreement = accepted.room.professionalLifecycleState.mutualAgreements.find(
    ({ id }) => id === proposal.agreement.id,
  );
  assert.equal(agreement.status, "accepted");

  const signed = runAiProfessionalLifecycleTick(accepted.room, later(2));
  agreement = signed.room.professionalLifecycleState.mutualAgreements.find(
    ({ id }) => id === proposal.agreement.id,
  );
  assert.equal(agreement.status, "signed");
  assert.ok(agreement.signatures.club);
  assert.ok(agreement.signatures.professional);
  assert.equal(agreement.decisionHistory.filter(({ action }) => action === "sign").length, 1);
});

test("IA nao responde nem assina em nome de clube controlado por humano", () => {
  const room = roomFixture();
  room.managers.push({ id: "director-b", name: "Diretor", clubId: "B" });
  const staff = room.clubCareerState.staffMembers.find(({ clubId }) => clubId === "B");
  assert.ok(staff);
  const proposal = proposeMutualSeparation(room, {
    operationId: "human-club:proposal",
    professionalType: "staff",
    professionalId: staff.id,
    clubId: "B",
    proposedBy: "professional",
    departureDate: later(10),
    terms: { compensation: 0 },
  }, { now: NOW });

  const result = runAiProfessionalLifecycleTick(proposal.room, later(1));
  const agreement = result.room.professionalLifecycleState.mutualAgreements.find(
    ({ id }) => id === proposal.agreement.id,
  );

  assert.equal(agreement.status, "proposed");
  assert.equal(agreement.nextResponder, "club");
  assert.deepEqual(agreement.signatures, { club: null, professional: null });
});
