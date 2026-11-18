import assert from "node:assert/strict";
import test from "node:test";
import { ensureCoachEmploymentState } from "../game/coachEmployment.mjs";
import {
  calculateTerminationPenalty as calculateStaffTerminationPenalty,
  ensureStaffState,
} from "../game/staffEngine.mjs";
import {
  calculateProfessionalCompensation,
  endProfessionalNoticeEarly,
  ensureProfessionalLifecycleState,
  hireCoachStaffPackage,
  processProfessionalLifecycleDate,
  professionalLifecycleSnapshot,
  proposeMutualSeparation,
  respondMutualSeparation,
  scheduleProfessionalRetirement,
  separateCoachStaffCollectively,
  setCoachPreferredStaff,
  startProfessionalNotice,
  updateProfessionalRetirement,
  validateProfessionalLifecycleState,
} from "../game/professionalLifecycle.mjs";

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
    code: "LIFECYCLE01",
    currentSeason: 1,
    seasonYear: 2026,
    seasonEndsAt: "2026-12-31T23:59:59.999Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastCompletedRound: { round: 4 },
    managers: [{ id: "human", name: "Emanuel", clubId: "A", ready: true }],
    lineups: [{ managerId: "human", clubId: "A", lineupIds: ["p1"] }],
    matchReadiness: { fixtureId: "r5", managerIds: ["human"] },
    competitionCatalog: [{
      id: "L1",
      name: "Liga",
      country: "Brasil",
      active: true,
      clubs: [
        { id: "A", name: "Aurora", country: "Brasil", reputation: 18 },
        { id: "B", name: "Boreal", country: "Argentina", reputation: 14 },
      ],
    }],
    coachCareerState: {
      version: 1,
      coaches: [{
        id: "human",
        name: "Emanuel",
        salary: 100_000,
        managerType: "human",
        status: "employed",
        currentClubId: "A",
        assignments: [assignment("A", "human")],
      }, {
        id: "ai-b",
        name: "Tecnico Boreal",
        salary: 80_000,
        managerType: "ai",
        status: "employed",
        currentClubId: "B",
        assignments: [assignment("B", "ai-b")],
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
      keepMe: { persistent: true },
    },
    marketState: {
      finances: [
        { clubId: "A", balance: 100_000_000 },
        { clubId: "B", balance: 80_000_000 },
      ],
    },
  };
  const employed = ensureCoachEmploymentState(base, { now: NOW });
  const staffed = ensureStaffState(employed, { now: NOW, candidateCountPerRole: 1 });
  return ensureProfessionalLifecycleState(staffed, { now: NOW });
}

function coach(room, id = "human") {
  return room.coachCareerState.coaches.find((candidate) => candidate.id === id);
}

function activeCoachContract(room, id = "human") {
  return room.coachEmploymentState.contracts.find((contract) => (
    contract.coachId === id && contract.status === "active"
  ));
}

function activeCoachAppointment(room, id = "human") {
  return room.coachEmploymentState.appointments.find((appointment) => (
    appointment.coachId === id && appointment.status === "active"
  ));
}

function memberAt(room, staffId) {
  return room.clubCareerState.staffMembers.find((member) => member.id === staffId);
}

function candidateAt(room, staffId) {
  return room.clubCareerState.staffCandidates.find((member) => member.id === staffId);
}

function employedStaffAt(room, clubId = "A") {
  return room.clubCareerState.staffMembers.find((member) => (
    member.clubId === clubId && member.status === "employed"
  ));
}

function staffHistoryFor(room, operationId) {
  return room.clubCareerState.staffHistory.find((event) => event.operationId === operationId);
}

test("aviso completo preserva vinculo ate a data e efetiva uma unica saida", () => {
  const input = roomFixture();
  const started = startProfessionalNotice(input, {
    operationId: "notice-complete:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    durationDays: 5,
  }, { now: NOW });

  assert.equal(activeCoachAppointment(started.room).status, "active");
  assert.equal(activeCoachContract(started.room).status, "active");
  assert.equal(started.notice.status, "active");
  assert.equal(input.professionalLifecycleState.notices.length, 0, "entrada permanece imutavel");

  const processed = processProfessionalLifecycleDate(started.room, later(5));
  const notice = processed.room.professionalLifecycleState.notices.find(({ id }) => id === started.notice.id);
  assert.equal(notice.status, "completed");
  assert.equal(activeCoachAppointment(processed.room), undefined);
  assert.equal(coach(processed.room).status, "unemployed");
  assert.equal(validateProfessionalLifecycleState(processed.room), true);
});

test("saida antecipada calcula aviso indenizado e guarda substituto informado", () => {
  const started = startProfessionalNotice(roomFixture(), {
    operationId: "notice-early:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    durationDays: 30,
  }, { now: NOW });
  const ended = endProfessionalNoticeEarly(started.room, {
    operationId: "notice-early:end",
    noticeId: started.notice.id,
    substituteCoachId: "free",
    reason: "successor_available",
  }, { now: later(5) });

  assert.equal(ended.notice.status, "ended_early");
  assert.equal(ended.notice.substituteCoachId, "free");
  assert.equal(ended.notice.endReason, "successor_available");
  assert.ok(ended.compensation.noticePay > 0);
});

test("sucessor contratado antes do fim encerra aviso com rastreabilidade", () => {
  const started = startProfessionalNotice(roomFixture(), {
    operationId: "notice-successor:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    expectedEndDate: later(40),
  }, { now: NOW });
  const ended = endProfessionalNoticeEarly(started.room, {
    operationId: "notice-successor:end",
    noticeId: started.notice.id,
    substituteCoachId: "free",
    initiatedBy: "club",
    reason: "successor_started",
  }, { now: later(10) });
  const audit = ended.room.professionalLifecycleState.timeline.find(
    ({ operationId }) => operationId === "notice-successor:end",
  );

  assert.equal(ended.notice.status, "ended_early");
  assert.deepEqual(audit.relatedProfessionalIds, ["free"]);
  assert.equal(audit.initiatedBy, "club");
});

test("aviso iniciado pelo treinador termina como pedido de demissao", () => {
  const result = startProfessionalNotice(roomFixture(), {
    operationId: "notice-coach-resignation",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    initiatedBy: "professional",
    immediateExit: true,
    compensation: 100_000,
    reason: "new_challenge",
  }, { now: NOW });

  assert.equal(coach(result.room).status, "resigned");
  assert.equal(result.separation.events.some(({ type }) => type === "COACH_RESIGNED"), true);
  assert.equal(result.separation.events.some(({ type }) => type === "COACH_DISMISSED"), false);
  assert.equal(result.separation.financialTransactions[0]?.type, "income");
  assert.equal(coach(result.room).marketRestriction?.type, "voluntary_resignation");
  assert.equal(result.notice.compensation.compensation, 100_000);
});

test("aviso iniciado pelo clube termina como demissao e custo do clube", () => {
  const result = startProfessionalNotice(roomFixture(), {
    operationId: "notice-coach-dismissal",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    initiatedBy: "club",
    immediateExit: true,
    compensation: 180_000,
    reason: "board_restructure",
  }, { now: NOW });

  assert.equal(coach(result.room).status, "dismissed");
  assert.equal(result.separation.events.some(({ type }) => type === "COACH_DISMISSED"), true);
  assert.equal(result.separation.events.some(({ type }) => type === "COACH_RESIGNED"), false);
  assert.equal(result.separation.financialTransactions[0]?.type, "expense");
  assert.equal(result.compensation.total, 180_000);
});

test("aviso mutuo continua usando rescisao por acordo", () => {
  const result = startProfessionalNotice(roomFixture(), {
    operationId: "notice-coach-mutual",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    initiatedBy: "mutual",
    immediateExit: true,
    compensation: 75_000,
  }, { now: NOW });

  assert.equal(coach(result.room).status, "unemployed");
  assert.equal(
    result.separation.events.some(({ type }) => type === "COACH_MUTUAL_AGREEMENT_COMPLETED"),
    true,
  );
  assert.equal(result.compensation.total, 75_000);
});

test("aviso iniciado por staff registra saida voluntaria sem debito ao clube", () => {
  const room = roomFixture();
  const staff = employedStaffAt(room);
  const result = startProfessionalNotice(room, {
    operationId: "notice-staff-resignation",
    professionalType: "staff",
    professionalId: staff.id,
    clubId: "A",
    initiatedBy: "professional",
    immediateExit: true,
    reason: "personal_decision",
  }, { now: NOW });
  const separationOperationId = "notice-staff-resignation:immediate:separation";
  const history = staffHistoryFor(result.room, separationOperationId);

  assert.equal(candidateAt(result.room, staff.id).status, "free_agent");
  assert.equal(result.separation.event.type, "STAFF_RESIGNED");
  assert.equal(history.type, "STAFF_RESIGNED");
  assert.equal(result.separation.financialTransactions.length, 0);
  assert.equal(result.compensation.total, 0);
  assert.equal(result.separation.contract.lifecycleStatus, "terminated");
});

test("aviso iniciado pelo clube demite staff usando multa contratual", () => {
  const room = roomFixture();
  const staff = employedStaffAt(room);
  const result = startProfessionalNotice(room, {
    operationId: "notice-staff-dismissal",
    professionalType: "staff",
    professionalId: staff.id,
    clubId: "A",
    initiatedBy: "club",
    immediateExit: true,
    reason: "staff_restructure",
  }, { now: NOW });

  assert.equal(candidateAt(result.room, staff.id).status, "free_agent");
  assert.equal(result.separation.event.type, "STAFF_FIRED");
  assert.equal(result.separation.financialTransactions[0]?.type, "expense");
  assert.ok(result.compensation.total > 0);
});

test("aposentadoria no fim da temporada permanece agendada e depois aposenta", () => {
  const scheduled = scheduleProfessionalRetirement(roomFixture(), {
    operationId: "retirement-season:schedule",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    kind: "end_season",
  }, { now: NOW });

  assert.equal(scheduled.retirement.status, "scheduled");
  assert.equal(scheduled.retirement.effectiveAt, "2026-12-31T23:59:59.999Z");
  assert.equal(coach(scheduled.room).status, "retiring");

  const processed = processProfessionalLifecycleDate(
    scheduled.room,
    "2027-01-01T00:00:00.000Z",
  );
  assert.equal(coach(processed.room).status, "retired");
  assert.equal(processed.room.professionalLifecycleState.retirements[0].status, "effective");
});

test("aposentadoria imediata aceita alias retirementType", () => {
  const result = scheduleProfessionalRetirement(roomFixture(), {
    operationId: "retirement-immediate",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    retirementType: "immediate",
  }, { now: NOW });

  assert.equal(result.retirement.status, "effective");
  assert.equal(result.retirement.kind, "immediate");
  assert.equal(coach(result.room).status, "retired");
});

test("aposentadoria agendada pode ser adiada e cancelada", () => {
  const scheduled = scheduleProfessionalRetirement(roomFixture(), {
    operationId: "retirement-edit:schedule",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    retirementType: "scheduled",
    effectiveAt: later(60),
  }, { now: NOW });
  const postponed = updateProfessionalRetirement(scheduled.room, {
    operationId: "retirement-edit:postpone",
    retirementId: scheduled.retirement.id,
    action: "postpone",
    effectiveAt: later(90),
  }, { now: later(1) });
  const cancelled = updateProfessionalRetirement(postponed.room, {
    operationId: "retirement-edit:cancel",
    retirementId: scheduled.retirement.id,
    action: "cancel",
  }, { now: later(2) });

  assert.equal(postponed.retirement.kind, "future");
  assert.equal(postponed.retirement.postponementCount, 1);
  assert.deepEqual(postponed.retirement.previousEffectiveDates, [later(60)]);
  assert.equal(cancelled.retirement.status, "cancelled");
});

test("acordo aceito e assinado bilateralmente executa a rescisao", () => {
  const input = roomFixture();
  const reputationBefore = Number(coach(input).reputation ?? 50);
  const proposed = proposeMutualSeparation(input, {
    operationId: "mutual-accepted:propose",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    proposedBy: "club",
    departureDate: NOW,
    terms: { compensation: 200_000 },
  }, { now: NOW });
  const accepted = respondMutualSeparation(proposed.room, {
    operationId: "mutual-accepted:accept",
    agreementId: proposed.agreement.id,
    action: "accept",
    actor: "professional",
  }, { now: NOW });
  const signed = respondMutualSeparation(accepted.room, {
    operationId: "mutual-accepted:sign",
    agreementId: proposed.agreement.id,
    action: "sign",
    actor: "both",
  }, { now: NOW });

  assert.equal(signed.agreement.status, "executed");
  assert.equal(coach(signed.room).status, "unemployed");
  assert.ok(signed.agreement.signatures.club);
  assert.ok(signed.agreement.signatures.professional);
  const timeline = signed.room.professionalLifecycleState.timeline.find((entry) => (
    entry.type === "PROFESSIONAL_MUTUAL_SEPARATION_EXECUTED"
  ));
  assert.ok(timeline.reputationImpact < 0);
  assert.ok(timeline.reputationImpact >= -4);
  assert.equal(
    coach(signed.room).reputation,
    reputationBefore + timeline.reputationImpact,
  );
  assert.equal(
    coach(signed.room).careerConductHistory.at(-1).type,
    "mutual_agreement",
  );
});

test("contraproposta altera termos, rodada e responsavel", () => {
  const proposed = proposeMutualSeparation(roomFixture(), {
    operationId: "mutual-counter:propose",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    proposedBy: "club",
    terms: {
      compensation: 100_000,
      preserveBonuses: false,
      notes: "manter plano de saude por sessenta dias",
      reputationImpact: -1.5,
    },
  }, { now: NOW });
  const countered = respondMutualSeparation(proposed.room, {
    operationId: "mutual-counter:respond",
    agreementId: proposed.agreement.id,
    action: "counter",
    actor: "professional",
    terms: { compensation: 350_000 },
  }, { now: later(1) });

  assert.equal(countered.agreement.status, "countered");
  assert.equal(countered.agreement.negotiationRound, 2);
  assert.equal(countered.agreement.nextResponder, "club");
  assert.equal(countered.agreement.terms.compensation, 350_000);
  assert.equal(countered.agreement.terms.preserveBonuses, false);
  assert.equal(countered.agreement.terms.notes, "manter plano de saude por sessenta dias");
  assert.equal(countered.agreement.terms.reputationImpact, -1.5);
});

test("recusa encerra acordo sem desligar profissional", () => {
  const proposed = proposeMutualSeparation(roomFixture(), {
    operationId: "mutual-reject:propose",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    proposedBy: "club",
  }, { now: NOW });
  const rejected = respondMutualSeparation(proposed.room, {
    operationId: "mutual-reject:respond",
    agreementId: proposed.agreement.id,
    action: "reject",
    actor: "professional",
  }, { now: later(1) });

  assert.equal(rejected.agreement.status, "rejected");
  assert.equal(activeCoachAppointment(rejected.room).status, "active");
  assert.equal(activeCoachContract(rejected.room).status, "active");
});

test("indenizacao combina clausula, renuncia, aviso, bonus e beneficios", () => {
  const result = calculateProfessionalCompensation({
    contract: {
      wage: 100_000,
      endDate: later(90),
      terminationClause: 250_000,
    },
    now: NOW,
    waivedRate: 0.2,
    noticeDaysWaived: 30,
    pendingBonuses: 20_000,
    temporaryBenefits: 10_000,
  });

  assert.equal(result.contractualBase, 250_000);
  assert.equal(result.agreedBase, 200_000);
  assert.equal(result.noticePay, 100_000);
  assert.equal(result.total, 330_000);
});

test("staff independente permanece no clube quando treinador sai", () => {
  const input = roomFixture();
  const staff = input.clubCareerState.staffMembers.find(({ clubId }) => clubId === "A");
  const linked = setCoachPreferredStaff(input, {
    operationId: "independent:link",
    coachId: "human",
    staffId: staff.id,
    clubId: "A",
    affiliationType: "independent",
  }, { now: NOW });
  const exited = startProfessionalNotice(linked.room, {
    operationId: "independent:coach-exit",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    immediateExit: true,
  }, { now: later(1) });

  assert.equal(memberAt(exited.room, staff.id).status, "employed");
  assert.equal(memberAt(exited.room, staff.id).clubId, "A");
});

test("staff personal_team acompanha treinador na saida", () => {
  const input = roomFixture();
  const staff = input.clubCareerState.staffMembers.find(({ clubId }) => clubId === "A");
  const linked = setCoachPreferredStaff(input, {
    operationId: "personal-team:link",
    coachId: "human",
    staffId: staff.id,
    clubId: "A",
    affiliationType: "personal_team",
  }, { now: NOW });
  const exited = startProfessionalNotice(linked.room, {
    operationId: "personal-team:coach-exit",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    immediateExit: true,
  }, { now: later(1) });

  assert.equal(memberAt(exited.room, staff.id), undefined);
  assert.equal(candidateAt(exited.room, staff.id).status, "free_agent");
  assert.deepEqual(exited.separation.relatedProfessionalIds, [staff.id]);
  const timelineTypes = exited.room.professionalLifecycleState.timeline.map(({ type }) => type);
  assert.ok(timelineTypes.includes("STAFF_FOLLOWED_COACH"));
  assert.ok(timelineTypes.includes("STAFF_TEAM_DISSOLVED"));
});

test("comissao resolve decisoes individuais por vinculo e calcula custo total", () => {
  const input = roomFixture();
  const staff = input.clubCareerState.staffMembers.filter(({ clubId }) => clubId === "A").slice(0, 5);
  assert.equal(staff.length, 5);
  let room = input;
  for (const [index, member] of staff.entries()) {
    room = setCoachPreferredStaff(room, {
      operationId: `individual-decisions:link:${member.id}`,
      coachId: "human",
      staffId: member.id,
      clubId: "A",
      affiliationType: index === 1 ? "personal_team" : "independent",
    }, { now: NOW }).room;
  }
  const followContract = room.clubCareerState.staffContracts.find((contract) => (
    contract.staffId === staff[1].id && contract.status === "active"
  ));
  const expectedFollowCost = Math.round(calculateStaffTerminationPenalty(followContract, NOW) * 0.5);
  const callbacks = { transactions: [], events: [] };
  const result = separateCoachStaffCollectively(room, {
    operationId: "individual-decisions:resolve",
    coachId: "human",
    clubId: "A",
    staffDecisions: [
      { staffId: staff[0].id, action: "remain" },
      { staffId: staff[1].id, action: "follow" },
      {
        staffId: staff[2].id,
        action: "renegotiate",
        years: 2,
        wage: Math.max(20_000, staff[2].salary + 1_000),
        renewalBonus: 0,
      },
      { staffId: staff[3].id, action: "notice", durationDays: 10 },
      { staffId: staff[4].id, action: "dismiss" },
    ],
  }, {
    now: NOW,
    postFinancialTransaction: (_room, transaction) => callbacks.transactions.push(transaction),
    recordCareerEvent: (_room, event) => callbacks.events.push(event),
  });

  assert.equal(memberAt(result.room, staff[0].id).linkedCoachId, null);
  assert.equal(candidateAt(result.room, staff[1].id).status, "free_agent");
  assert.equal(memberAt(result.room, staff[2].id).linkedCoachId, null);
  assert.equal(memberAt(result.room, staff[2].id).salary, Math.max(20_000, staff[2].salary + 1_000));
  assert.equal(memberAt(result.room, staff[3].id).status, "employed");
  assert.ok(result.room.professionalLifecycleState.notices.some((notice) => (
    notice.professionalId === staff[3].id && notice.status === "active"
  )));
  assert.equal(candidateAt(result.room, staff[4].id).status, "free_agent");
  assert.equal(result.estimatedTotal, expectedFollowCost + result.decisions[4].compensation);
  assert.equal(result.actualCost, result.financialTransactions.reduce(
    (total, transaction) => total + transaction.amount,
    0,
  ));
  const timelineTypes = result.room.professionalLifecycleState.timeline.map(({ type }) => type);
  assert.ok(timelineTypes.includes("STAFF_RETAINED_AFTER_COACH_EXIT"));
  assert.ok(timelineTypes.includes("STAFF_FOLLOWED_COACH"));
  assert.ok(timelineTypes.includes("STAFF_TEAM_DISSOLVED"));
  assert.ok(callbacks.events.some(({ type }) => type === "STAFF_RETAINED_AFTER_COACH_EXIT"));
  assert.ok(callbacks.events.some(({ type }) => type === "STAFF_FOLLOWED_COACH"));
  assert.ok(callbacks.events.some(({ type }) => type === "STAFF_TEAM_DISSOLVED"));

  const transactionCount = callbacks.transactions.length;
  const eventCount = callbacks.events.length;
  const timelineCount = result.room.professionalLifecycleState.timeline.length;
  const repeated = separateCoachStaffCollectively(result.room, {
    operationId: "individual-decisions:resolve",
    coachId: "human",
    clubId: "A",
    staffDecisions: [],
  }, {
    now: NOW,
    postFinancialTransaction: (_room, transaction) => callbacks.transactions.push(transaction),
    recordCareerEvent: (_room, event) => callbacks.events.push(event),
  });
  assert.equal(repeated.duplicate, true);
  assert.equal(callbacks.transactions.length, transactionCount);
  assert.equal(callbacks.events.length, eventCount);
  assert.equal(repeated.room.professionalLifecycleState.timeline.length, timelineCount);
});

test("comissao afastada tambem resolve vinculo quando treinador sai", () => {
  const input = roomFixture();
  const staff = input.clubCareerState.staffMembers.find(({ clubId }) => clubId === "A");
  const linked = setCoachPreferredStaff(input, {
    operationId: "on-leave-departure:link",
    coachId: "human",
    staffId: staff.id,
    clubId: "A",
    affiliationType: "personal_team",
  }, { now: NOW });
  const away = linked.room.clubCareerState.staffMembers.find(({ id }) => id === staff.id);
  away.status = "on_leave";
  away.availability = { status: "on_leave", reason: "medical_leave", effectiveAt: later(20) };

  const result = separateCoachStaffCollectively(linked.room, {
    operationId: "on-leave-departure:resolve",
    coachId: "human",
    clubId: "A",
  }, { now: NOW });

  assert.equal(memberAt(result.room, staff.id), undefined);
  assert.equal(candidateAt(result.room, staff.id).status, "free_agent");
  assert.equal(result.decisions[0].action, "follow");
});

test("falha durante desligamento coletivo reverte todos os membros e callbacks", () => {
  const input = roomFixture();
  const staff = input.clubCareerState.staffMembers.filter(({ clubId }) => clubId === "A").slice(0, 2);
  let room = input;
  for (const member of staff) {
    room = setCoachPreferredStaff(room, {
      operationId: `collective-rollback:link:${member.id}`,
      coachId: "human",
      staffId: member.id,
      clubId: "A",
      affiliationType: "personal_team",
    }, { now: NOW }).room;
  }
  room = startProfessionalNotice(room, {
    operationId: "collective-rollback:existing-notice",
    professionalType: "staff",
    professionalId: staff[1].id,
    clubId: "A",
    initiatedBy: "mutual",
    durationDays: 20,
  }, { now: NOW }).room;
  const before = structuredClone(room);
  const transactions = [];
  const events = [];

  assert.throws(() => separateCoachStaffCollectively(room, {
    operationId: "collective-rollback:resolve",
    coachId: "human",
    clubId: "A",
    staffDecisions: [
      { staffId: staff[0].id, action: "dismiss" },
      { staffId: staff[1].id, action: "notice", durationDays: 10 },
    ],
  }, {
    now: NOW,
    postFinancialTransaction: (_room, transaction) => transactions.push(transaction),
    recordCareerEvent: (_room, event) => events.push(event),
  }), (error) => {
    assert.equal(error.code, "PROFESSIONAL_NOTICE_ALREADY_ACTIVE");
    return true;
  });
  assert.deepEqual(room, before);
  assert.deepEqual(transactions, []);
  assert.deepEqual(events, []);
});

test("saida do treinador promove auxiliar interino e registra transicao", () => {
  const exited = startProfessionalNotice(roomFixture(), {
    operationId: "interim:coach-exit",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    immediateExit: true,
  }, { now: NOW });
  const transitions = exited.room.professionalLifecycleState.transitions;

  assert.equal(exited.separation.interimAppointment.role, "interim");
  assert.ok(transitions.some(({ type }) => type === "assistant_or_emergency_interim_started"));
});

test("pacote conjunto contrata, vincula e persiste todos os profissionais", () => {
  const input = roomFixture();
  const candidates = input.clubCareerState.staffCandidates.slice(0, 2);
  const result = hireCoachStaffPackage(input, {
    operationId: "package:success",
    coachId: "human",
    clubId: "A",
    members: candidates.map((candidate, index) => ({
      staffId: candidate.id,
      wage: Math.max(20_000, candidate.salary),
      years: 2,
      signingBonus: 0,
      affiliationType: index === 0 ? "personal_team" : "recommended",
    })),
  }, { now: NOW });

  assert.equal(result.members.length, 2);
  assert.equal(result.contracts.length, 2);
  for (const candidate of candidates) {
    const hired = memberAt(result.room, candidate.id);
    assert.equal(hired.clubId, "A");
    assert.equal(hired.linkedCoachId, "human");
  }
  assert.equal(result.room.professionalLifecycleState.preferredStaffByCoach.human.length, 2);
});

test("pacote conjunto valida vinculo ou nomeia treinador e comissao atomicamente", () => {
  const input = roomFixture();
  const before = structuredClone(input);
  const candidate = input.clubCareerState.staffCandidates[0];
  assert.throws(() => hireCoachStaffPackage(input, {
    operationId: "joint-package:missing-coach-link",
    coachId: "free",
    clubId: "A",
    members: [{ staffId: candidate.id, years: 2 }],
  }, { now: NOW }), (error) => {
    assert.equal(error.code, "PROFESSIONAL_COACH_NOT_AT_CLUB");
    return true;
  });
  assert.deepEqual(input, before);

  const coachTransactions = [];
  const coachEvents = [];
  const staffTransactions = [];
  const staffEvents = [];
  const callbacks = {
    now: NOW,
    debit: (_room, transaction) => coachTransactions.push(transaction),
    credit: (_room, transaction) => coachTransactions.push(transaction),
    recordEvent: (_room, event) => coachEvents.push(event),
    postFinancialTransaction: (_room, transaction) => staffTransactions.push(transaction),
    recordCareerEvent: (_room, event) => staffEvents.push(event),
  };
  assert.throws(() => hireCoachStaffPackage(input, {
    operationId: "joint-package:budget-rollback",
    coachId: "free",
    clubId: "A",
    appointCoach: true,
    coachTerms: { wage: 90_000, durationYears: 2, signingBonus: 0 },
    maximumFirstYearCost: 1,
    members: [{ staffId: candidate.id, years: 2, signingBonus: 0 }],
  }, callbacks), (error) => {
    assert.equal(error.code, "PROFESSIONAL_STAFF_PACKAGE_BUDGET_EXCEEDED");
    return true;
  });
  assert.deepEqual(input, before);
  assert.deepEqual(coachTransactions, []);
  assert.deepEqual(coachEvents, []);
  assert.deepEqual(staffTransactions, []);
  assert.deepEqual(staffEvents, []);

  const result = hireCoachStaffPackage(input, {
    operationId: "joint-package:appoint",
    coachId: "free",
    clubId: "A",
    appointCoach: true,
    coachTerms: {
      wage: 90_000,
      durationYears: 2,
      signingBonus: 0,
    },
    members: [{
      staffId: candidate.id,
      wage: Math.max(20_000, candidate.salary),
      years: 2,
      signingBonus: 0,
      affiliationType: "personal_team",
    }],
  }, callbacks);

  assert.equal(result.coachAppointed, true);
  assert.equal(result.coach.id, "free");
  assert.equal(result.coachAppointment.clubId, "A");
  assert.equal(result.coachAppointment.status, "active");
  assert.equal(result.coachContract.status, "active");
  assert.equal(memberAt(result.room, candidate.id).linkedCoachId, "free");
  assert.equal(activeCoachAppointment(result.room, "human"), undefined);
  assert.equal(activeCoachAppointment(result.room, "free").clubId, "A");
  assert.ok(coachEvents.some(({ type }) => type === "COACH_APPOINTED"));
  assert.ok(staffEvents.some(({ type }) => type === "STAFF_HIRED"));
  assert.equal(result.transition.metadata.coachAppointed, true);
  assert.deepEqual(input, before, "entrada permanece imutavel apos transacao conjunta");
});

test("pacote usa salario e bonus reais quando omitidos e valida teto antes de contratar", () => {
  const input = roomFixture();
  const before = structuredClone(input);
  const candidate = input.clubCareerState.staffCandidates[0];
  const expectedFirstYearCost = candidate.salary * 13;
  const transactions = [];
  const events = [];
  const options = {
    now: NOW,
    postFinancialTransaction: (_room, transaction) => transactions.push(transaction),
    recordCareerEvent: (_room, event) => events.push(event),
  };

  assert.throws(() => hireCoachStaffPackage(input, {
    operationId: "package:real-fallback:blocked",
    coachId: "human",
    clubId: "A",
    maximumFirstYearCost: expectedFirstYearCost - 1,
    members: [{ staffId: candidate.id, years: 2 }],
  }, options), (error) => {
    assert.equal(error.code, "PROFESSIONAL_STAFF_PACKAGE_BUDGET_EXCEEDED");
    assert.equal(error.details.estimatedTotal, expectedFirstYearCost);
    return true;
  });
  assert.deepEqual(input, before);
  assert.deepEqual(transactions, []);
  assert.deepEqual(events, []);

  const result = hireCoachStaffPackage(input, {
    operationId: "package:real-fallback:success",
    coachId: "human",
    clubId: "A",
    maximumFirstYearCost: expectedFirstYearCost,
    members: [{ staffId: candidate.id, years: 2 }],
  }, options);
  const quoted = result.transition.metadata.memberCosts[0];

  assert.equal(result.contracts[0].wage, candidate.salary);
  assert.equal(result.financialTransactions[0].amount, candidate.salary);
  assert.equal(quoted.wage, candidate.salary);
  assert.equal(quoted.signingBonus, candidate.salary);
  assert.equal(quoted.buyout, 0);
  assert.equal(quoted.firstYearCost, expectedFirstYearCost);

  const transactionCount = transactions.length;
  const eventCount = events.length;
  const repeated = hireCoachStaffPackage(result.room, {
    operationId: "package:real-fallback:success",
    coachId: "human",
    clubId: "A",
    maximumFirstYearCost: expectedFirstYearCost,
    members: [{ staffId: candidate.id, years: 2 }],
  }, options);
  assert.equal(repeated.duplicate, true);
  assert.equal(transactions.length, transactionCount);
  assert.equal(events.length, eventCount);
});

test("pacote de profissional empregado usa salario contratual e inclui buyout", () => {
  const input = roomFixture();
  const professional = employedStaffAt(input, "B");
  const contract = input.clubCareerState.staffContracts.find((candidate) => (
    candidate.staffId === professional.id && candidate.status === "active"
  ));
  professional.salary = 1_000;
  const buyout = calculateStaffTerminationPenalty(contract, NOW);
  const expectedFirstYearCost = contract.wage * 13 + buyout;
  const before = structuredClone(input);

  assert.throws(() => hireCoachStaffPackage(input, {
    operationId: "package:buyout:blocked",
    coachId: "human",
    clubId: "A",
    maximumFirstYearCost: expectedFirstYearCost - 1,
    members: [{ staffId: professional.id, years: 2 }],
  }, { now: NOW }), (error) => {
    assert.equal(error.code, "PROFESSIONAL_STAFF_PACKAGE_BUDGET_EXCEEDED");
    assert.equal(error.details.estimatedTotal, expectedFirstYearCost);
    return true;
  });
  assert.deepEqual(input, before);

  const result = hireCoachStaffPackage(input, {
    operationId: "package:buyout:success",
    coachId: "human",
    clubId: "A",
    maximumFirstYearCost: expectedFirstYearCost,
    members: [{ staffId: professional.id, years: 2 }],
  }, { now: NOW });
  const quoted = result.transition.metadata.memberCosts[0];
  const buyer = result.financialTransactions.find((transaction) => (
    transaction.clubId === "A" && transaction.type === "expense"
  ));

  assert.equal(result.contracts[0].wage, contract.wage);
  assert.equal(quoted.wage, contract.wage);
  assert.equal(quoted.signingBonus, contract.wage);
  assert.equal(quoted.buyout, buyout);
  assert.equal(quoted.firstYearCost, expectedFirstYearCost);
  assert.equal(buyer.amount, contract.wage + buyout);
});

test("pacote sem caixa falha antes de mutacao, callback ou evento parcial", () => {
  const input = roomFixture();
  const candidate = input.clubCareerState.staffCandidates[0];
  const expectedFirstYearCost = candidate.salary * 13;
  const finance = input.marketState.finances.find(({ clubId }) => clubId === "A");
  finance.balance = expectedFirstYearCost - 1;
  finance.committed = 0;
  const before = structuredClone(input);
  const transactions = [];
  const events = [];

  assert.throws(() => hireCoachStaffPackage(input, {
    operationId: "package:funds:blocked",
    coachId: "human",
    clubId: "A",
    members: [{ staffId: candidate.id, years: 2 }],
  }, {
    now: NOW,
    postFinancialTransaction: (_room, transaction) => transactions.push(transaction),
    recordCareerEvent: (_room, event) => events.push(event),
  }), (error) => {
    assert.equal(error.code, "PROFESSIONAL_STAFF_PACKAGE_FUNDS_INSUFFICIENT");
    assert.equal(error.details.estimatedTotal, expectedFirstYearCost);
    assert.equal(error.details.availableFunds, expectedFirstYearCost - 1);
    return true;
  });

  assert.deepEqual(input, before);
  assert.deepEqual(transactions, []);
  assert.deepEqual(events, []);
});

test("falha no pacote coletivo reverte clone e nao publica efeitos parciais", () => {
  const input = roomFixture();
  const before = structuredClone(input);
  const candidate = input.clubCareerState.staffCandidates[0];
  const transactions = [];
  const events = [];

  assert.throws(() => hireCoachStaffPackage(input, {
    operationId: "package:rollback",
    coachId: "human",
    clubId: "A",
    members: [{
      staffId: candidate.id,
      wage: Math.max(20_000, candidate.salary),
      years: 2,
    }, {
      staffId: "staff-inexistente",
      wage: 30_000,
      years: 2,
    }],
  }, {
    now: NOW,
    postFinancialTransaction: (_room, transaction) => transactions.push(transaction),
    recordCareerEvent: (_room, event) => events.push(event),
  }));

  assert.deepEqual(input, before);
  assert.deepEqual(transactions, []);
  assert.deepEqual(events, []);
});

test("operationId repetido nao duplica pagamento, evento ou timeline", () => {
  const debits = [];
  const events = [];
  const options = {
    now: NOW,
    debit: (_room, transaction) => debits.push(transaction),
    recordEvent: (_room, event) => events.push(event),
  };
  const input = roomFixture();
  const first = startProfessionalNotice(input, {
    operationId: "idempotent:notice",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    immediateExit: true,
    compensation: 200_000,
  }, options);
  const debitCount = debits.length;
  const eventCount = events.length;
  const timelineCount = first.room.professionalLifecycleState.timeline.length;
  const repeated = startProfessionalNotice(first.room, {
    operationId: "idempotent:notice",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    immediateExit: true,
    compensation: 200_000,
  }, options);
  const snapshot = professionalLifecycleSnapshot(repeated.room, {
    professionalType: "coach",
    professionalId: "human",
  });

  assert.equal(repeated.duplicate, true);
  assert.equal(debits.length, debitCount);
  assert.equal(events.length, eventCount);
  assert.equal(repeated.room.professionalLifecycleState.timeline.length, timelineCount);
  assert.equal(snapshot.notices.length, 1);
  assert.deepEqual(snapshot.processedOperationIds, []);
});
