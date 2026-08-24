import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoachProposal,
  processCoachEmploymentDate,
  validateCoachEmploymentState,
} from "../game/coachEmployment.mjs";
import { fulfillCoachStaffPackageCommitments } from "../game/coachStaffPackageFulfillment.mjs";
import { validateProfessionalLifecycleState } from "../game/professionalLifecycle.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

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
    code: "STAFF-FULFILLMENT",
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
        { clubId: "C", balance: 50_000_000, committed: 0 },
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

function acceptedRoom() {
  const offered = createCoachProposal(roomFixture(), {
    operationId: "preferred-staff-offer",
    coachId: "free",
    clubId: "C",
    wage: 300_000,
    durationYears: 3,
    responseDays: 20,
  }, { now: NOW });
  const countered = processCoachEmploymentDate(
    offered.room,
    "2026-07-23T12:00:00.000Z",
    marketOptions(),
  );
  const approved = processCoachEmploymentDate(
    countered.room,
    "2026-07-24T12:00:00.000Z",
    marketOptions(),
  );
  return processCoachEmploymentDate(
    approved.room,
    "2026-07-26T12:00:00.000Z",
    marketOptions(),
  ).room;
}

test("garantia formalizada contrata e vincula a comissao da IA uma unica vez", () => {
  const accepted = acceptedRoom();
  const originalGuarantee = accepted.coachEmploymentState.guarantees[0];
  const financialTransactions = [];
  const events = [];
  const options = {
    now: "2026-07-26T12:00:00.000Z",
    postFinancialTransaction: (_room, transaction) => financialTransactions.push(transaction),
    recordCareerEvent: (_room, event) => events.push(event),
  };

  const fulfilled = fulfillCoachStaffPackageCommitments(accepted, options);
  const member = fulfilled.room.clubCareerState.staffMembers.find(
    ({ id }) => id === "preferred-assistant",
  );
  const activeStaffContracts = fulfilled.room.clubCareerState.staffContracts.filter(
    ({ staffId, status }) => staffId === "preferred-assistant" && status === "active",
  );
  const guarantee = fulfilled.room.coachEmploymentState.guarantees.find(
    ({ id }) => id === originalGuarantee.id,
  );
  const coachContract = fulfilled.room.coachEmploymentState.contracts.find(
    ({ coachId, status }) => coachId === "free" && status === "active",
  );

  assert.equal(originalGuarantee.status, "formalized");
  assert.equal(member.clubId, "C");
  assert.equal(member.linkedCoachId, "free");
  assert.equal(member.affiliationType, "personal_team");
  assert.equal(activeStaffContracts.length, 1);
  assert.equal(guarantee.status, "fulfilled");
  assert.ok(guarantee.completedAt);
  assert.equal(coachContract.staffPackageCommitments[0].status, "fulfilled");
  assert.equal(financialTransactions.length, 1);
  assert.equal(events.some(({ type }) => type === "COACH_STAFF_PACKAGE_GUARANTEE_FULFILLED"), true);
  assert.equal(validateCoachEmploymentState(fulfilled.room), true);
  assert.equal(validateProfessionalLifecycleState(fulfilled.room), true);

  const transactionCount = financialTransactions.length;
  const eventCount = events.length;
  const duplicate = fulfillCoachStaffPackageCommitments(fulfilled.room, options);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.room, fulfilled.room);
  assert.equal(financialTransactions.length, transactionCount);
  assert.equal(events.length, eventCount);
  assert.equal(duplicate.room.clubCareerState.staffContracts.filter(
    ({ staffId, status }) => staffId === "preferred-assistant" && status === "active",
  ).length, 1);
});

test("falha no segundo compromisso nao publica callbacks nem altera o save", () => {
  const accepted = acceptedRoom();
  const contract = accepted.coachEmploymentState.contracts.find(
    ({ coachId, status }) => coachId === "free" && status === "active",
  );
  const firstGuarantee = accepted.coachEmploymentState.guarantees[0];
  const secondGuarantee = {
    ...structuredClone(firstGuarantee),
    id: "staff-package-guarantee-invalid",
    description: "Pacote invalido para testar rollback",
    effects: [{
      type: "staff_package",
      action: "hire_coach_staff_package",
      staffIds: ["missing-assistant"],
      members: [{ staffId: "missing-assistant", wage: 40_000 }],
    }],
  };
  accepted.coachEmploymentState.guarantees.push(secondGuarantee);
  contract.guaranteeIds.push(secondGuarantee.id);
  contract.staffPackageCommitments.push({
    guaranteeId: secondGuarantee.id,
    status: "formalized",
    action: "hire_coach_staff_package",
    staffIds: ["missing-assistant"],
    members: [{ staffId: "missing-assistant", wage: 40_000 }],
    firstYearCost: 520_000,
  });
  const callbacks = [];
  const options = {
    now: "2026-07-26T12:00:00.000Z",
    credit: () => callbacks.push("credit"),
    debit: () => callbacks.push("debit"),
    recordEvent: () => callbacks.push("coach-event"),
    postFinancialTransaction: () => callbacks.push("staff-transaction"),
    recordCareerEvent: () => callbacks.push("career-event"),
  };

  assert.throws(
    () => fulfillCoachStaffPackageCommitments(accepted, options),
    (error) => error?.code === "PROFESSIONAL_STAFF_NOT_FOUND",
  );
  assert.deepEqual(callbacks, []);
  assert.equal(accepted.clubCareerState.staffMembers.length, 0);
  assert.equal(accepted.clubCareerState.staffCandidates.length, 1);
  assert.equal(firstGuarantee.status, "formalized");
  assert.equal(contract.staffPackageCommitments[0].status, "formalized");
});

test("RoomStore cumpre pacote formalizado na mesma mutacao e persiste no reload", async () => {
  const accepted = acceptedRoom();
  accepted.code = "STAFF-FULFILL-RS";
  accepted.status = "active";
  accepted.ownerId = "viewer";
  accepted.managerIds = ["viewer"];
  accepted.managers = [{ id: "viewer", name: "Viewer", clubId: null }];
  accepted.revision = 1;
  accepted.version = 1;
  const persistence = new MemoryRoomPersistence([accepted]);
  const store = new RoomStore({
    persistence,
    now: () => new Date("2026-07-26T12:00:00.000Z"),
  });

  await store.markClubNewsRead(accepted.code, "viewer", { newsIds: [] });
  const persisted = await persistence.get(accepted.code);
  const member = persisted.clubCareerState.staffMembers.find(
    ({ id }) => id === "preferred-assistant",
  );
  const guarantee = persisted.coachEmploymentState.guarantees[0];
  const contract = persisted.coachEmploymentState.contracts.find(
    ({ coachId, status }) => coachId === "free" && status === "active",
  );

  assert.equal(member.clubId, "C");
  assert.equal(member.linkedCoachId, "free");
  assert.equal(guarantee.status, "fulfilled");
  assert.equal(contract.staffPackageCommitments[0].status, "fulfilled");
  assert.equal(persisted.clubCareerState.staffHistory.some(
    ({ type }) => type === "STAFF_HIRED",
  ), true);
  assert.equal(persisted.clubCareerState.events.some(
    ({ type }) => type === "COACH_STAFF_PACKAGE_GUARANTEE_FULFILLED",
  ), true);

  await store.markClubNewsRead(accepted.code, "viewer", { newsIds: [] });
  const reloaded = await persistence.get(accepted.code);
  assert.equal(reloaded.clubCareerState.staffContracts.filter(
    ({ staffId, status }) => staffId === "preferred-assistant" && status === "active",
  ).length, 1);
});
