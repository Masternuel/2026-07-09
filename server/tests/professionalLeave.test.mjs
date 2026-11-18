import assert from "node:assert/strict";
import test from "node:test";
import { ensureCoachEmploymentState } from "../game/coachEmployment.mjs";
import { ensureStaffState, processStaffContractExpirations } from "../game/staffEngine.mjs";
import {
  ProfessionalLeaveError,
  cancelProfessionalLeave,
  endProfessionalLeave,
  ensureProfessionalLeaveState,
  processProfessionalLeaveDate,
  professionalLeaveSnapshot,
  startProfessionalLeave,
  validateProfessionalLeaveState,
} from "../game/professionalLeave.mjs";

const NOW = "2026-07-28T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1_000;

function later(days) {
  return new Date(new Date(NOW).getTime() + days * DAY_MS).toISOString();
}

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

function rawFixture() {
  return {
    code: "LEAVE01",
    currentSeason: 1,
    seasonYear: 2026,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastCompletedRound: { round: 4 },
    managers: [{ id: "human", name: "Emanuel", clubId: "A", ready: true }],
    competitionCatalog: [{
      id: "L1",
      name: "Liga",
      country: "Brasil",
      active: true,
      clubs: [
        { id: "A", name: "Aurora", country: "Brasil", active: true },
        { id: "B", name: "Boreal", country: "Brasil", active: true },
      ],
    }],
    coachCareerState: {
      version: 1,
      coaches: [{
        id: "human",
        name: "Emanuel",
        managerType: "human",
        salary: 100_000,
        status: "employed",
        currentClubId: "A",
        assignments: [assignment("A", "human")],
      }, {
        id: "ai-b",
        name: "Tecnico Boreal",
        managerType: "ai",
        salary: 80_000,
        status: "employed",
        currentClubId: "B",
        assignments: [assignment("B", "ai-b")],
      }],
    },
    clubCareerState: { currentDate: NOW, keepMe: { value: 7 } },
    marketState: {
      finances: [
        { clubId: "A", balance: 50_000_000 },
        { clubId: "B", balance: 40_000_000 },
      ],
    },
  };
}

function roomFixture() {
  const employed = ensureCoachEmploymentState(rawFixture(), { now: NOW });
  const staffed = ensureStaffState(employed, { now: NOW, candidateCountPerRole: 0 });
  return ensureProfessionalLeaveState(staffed, { now: NOW });
}

function coach(room, coachId = "human") {
  return room.coachCareerState.coaches.find((candidate) => candidate.id === coachId);
}

function coachContract(room, coachId = "human") {
  return room.coachEmploymentState.contracts.find((contract) => (
    contract.coachId === coachId && contract.status === "active"
  ));
}

function coachAppointment(room, coachId = "human") {
  return room.coachEmploymentState.appointments.find((appointment) => (
    appointment.coachId === coachId && appointment.status === "active"
  ));
}

function staffAt(room, staffId) {
  return room.clubCareerState.staffMembers.find((member) => member.id === staffId);
}

function staffContract(room, staffId) {
  return room.clubCareerState.staffContracts.find((contract) => (
    contract.staffId === staffId && contract.status === "active"
  ));
}

function assistantAt(room, clubId = "A") {
  return room.clubCareerState.staffMembers.find((member) => (
    member.clubId === clubId && member.role === "assistant_coach"
  ));
}

test("ensure migra save antigo, preserva campos e nao muta entrada", () => {
  const raw = rawFixture();
  raw.coachCareerState.coaches[0] = {
    ...raw.coachCareerState.coaches[0],
    status: "on_leave",
    leaveReason: "medical",
    leaveStartedAt: NOW,
    leaveEndsAt: later(20),
  };
  const before = structuredClone(raw);
  const migrated = ensureProfessionalLeaveState(raw, { now: NOW });

  assert.deepEqual(raw, before);
  assert.equal(migrated.professionalLeaveState.version, 1);
  assert.equal(migrated.professionalLeaveState.leaves.length, 1);
  assert.equal(migrated.professionalLeaveState.leaves[0].metadata.migratedFromLegacyStatus, true);
  assert.equal(coach(migrated).status, "on_leave");
  assert.deepEqual(migrated.clubCareerState.keepMe, { value: 7 });
  assert.equal(validateProfessionalLeaveState(migrated), true);
});

test("afastamento imediato do treinador preserva contrato e cria interino da comissao", () => {
  const input = roomFixture();
  const originalAssistant = assistantAt(input);
  const emitted = [];
  const result = startProfessionalLeave(input, {
    operationId: "leave-coach:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "medical_treatment",
    expectedEndAt: later(20),
    payment: { type: "partial", rate: 0.6 },
    temporaryBonus: 8_000,
  }, {
    now: NOW,
    recordCareerEvent: (_room, event) => emitted.push(event),
  });

  assert.equal(result.leave.status, "active");
  assert.equal(result.leave.payment.type, "partial");
  assert.equal(result.leave.payment.rate, 0.6);
  assert.equal(coach(result.room).status, "on_leave");
  assert.equal(coachContract(result.room).status, "active");
  assert.equal(coachContract(result.room).onLeave, true);
  assert.equal(coachAppointment(result.room).status, "active");
  assert.equal(coachAppointment(result.room).onLeave, true);
  assert.equal(result.leave.actingStaffId, originalAssistant.id);
  const acting = staffAt(result.room, result.leave.actingStaffId);
  assert.equal(acting.interimAssignment.status, "active");
  assert.equal(acting.interimAssignment.sourceCoachId, "human");
  assert.equal(acting.interimAssignment.temporaryBonus, 8_000);
  assert.equal(emitted.at(-1).type, "PROFESSIONAL_LEAVE_STARTED");
  assert.equal(input.professionalLeaveState.leaves.length, 0);
});

test("inicio e retorno sao idempotentes por operationId", () => {
  const started = startProfessionalLeave(roomFixture(), {
    operationId: "leave-idempotent:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "family_leave",
    durationDays: 10,
  }, { now: NOW });
  const retryStart = startProfessionalLeave(started.room, {
    operationId: "leave-idempotent:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "different_reason_ignored",
    durationDays: 60,
  }, { now: NOW });

  assert.equal(retryStart.duplicate, true);
  assert.equal(retryStart.leave.id, started.leave.id);
  assert.equal(retryStart.room.professionalLeaveState.leaves.length, 1);

  const ended = endProfessionalLeave(started.room, {
    operationId: "leave-idempotent:end",
    leaveId: started.leave.id,
    reason: "cleared_to_return",
  }, { now: later(5) });
  const retryEnd = endProfessionalLeave(ended.room, {
    operationId: "leave-idempotent:end",
    leaveId: started.leave.id,
  }, { now: later(6) });

  assert.equal(ended.leave.status, "ended_early");
  assert.equal(retryEnd.duplicate, true);
  assert.equal(retryEnd.leave.endedAt, later(5));
  assert.equal(ended.room.professionalLeaveState.timeline.length, 2);
});

test("retorno restaura treinador, contrato e vinculo anterior do interino", () => {
  const base = roomFixture();
  const assistant = assistantAt(base);
  assert.equal(assistant.linkedCoachId, null);
  const started = startProfessionalLeave(base, {
    operationId: "leave-restore:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "health",
    expectedEndAt: later(8),
  }, { now: NOW });
  const ended = endProfessionalLeave(started.room, {
    operationId: "leave-restore:end",
    leaveId: started.leave.id,
    reason: "medical_clearance",
  }, { now: later(8) });

  assert.equal(ended.leave.status, "completed");
  assert.equal(coach(ended.room).status, "employed");
  assert.equal(coachContract(ended.room).status, "active");
  assert.equal(coachContract(ended.room).onLeave, false);
  assert.equal(coachAppointment(ended.room).status, "active");
  assert.equal(coachAppointment(ended.room).actingStaffId, null);
  const restored = staffAt(ended.room, assistant.id);
  assert.equal(restored.linkedCoachId, null);
  assert.equal(restored.interimAssignment.status, "ended");
  assert.equal(restored.interimAssignment.endReason, "professional_returned");
  assert.ok(ended.leave.payment.actualGross > 0);
});

test("afastamento futuro ativa e termina por processamento de data", () => {
  const scheduled = startProfessionalLeave(roomFixture(), {
    operationId: "leave-scheduled:create",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "planned_surgery",
    startsAt: later(3),
    expectedEndAt: later(7),
  }, { now: NOW });

  assert.equal(scheduled.leave.status, "scheduled");
  assert.equal(coach(scheduled.room).status, "employed");
  assert.equal(scheduled.events[0].type, "PROFESSIONAL_LEAVE_SCHEDULED");

  const activated = processProfessionalLeaveDate(scheduled.room, later(3));
  assert.equal(activated.activated.length, 1);
  assert.equal(coach(activated.room).status, "on_leave");
  assert.equal(coachContract(activated.room).status, "active");

  const completed = processProfessionalLeaveDate(activated.room, later(7));
  assert.equal(completed.completed.length, 1);
  assert.equal(coach(completed.room).status, "employed");
  assert.equal(completed.room.professionalLeaveState.leaves[0].status, "completed");

  const retry = processProfessionalLeaveDate(completed.room, later(7));
  assert.equal(retry.duplicate, true);
  assert.equal(retry.events.length, 0);
  assert.equal(retry.room.professionalLeaveState.timeline.length, 3);
});

test("salto de data usa inicio e retorno previstos e persiste custos do afastamento", () => {
  const transactions = [];
  const scheduled = startProfessionalLeave(roomFixture(), {
    operationId: "leave-jump:create",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "planned_treatment",
    startsAt: later(3),
    expectedEndAt: later(7),
    payment: { type: "partial", rate: 0.5 },
    temporaryBonus: 5_000,
  }, { now: NOW });

  const progressed = processProfessionalLeaveDate(scheduled.room, later(12), {
    postFinancialTransaction: (_room, transaction) => transactions.push(transaction),
  });
  const leave = progressed.room.professionalLeaveState.leaves[0];
  const timeline = progressed.room.professionalLeaveState.timeline;

  assert.equal(progressed.activated.length, 1);
  assert.equal(progressed.completed.length, 1);
  assert.equal(leave.status, "completed");
  assert.equal(leave.activatedAt, later(3));
  assert.equal(leave.endedAt, later(7));
  assert.equal(leave.payment.actualGross, 6_667);
  assert.equal(progressed.room.professionalLeaveState.currentDate, later(12));
  assert.equal(timeline.find(({ type }) => type === "PROFESSIONAL_LEAVE_STARTED").occurredAt, later(3));
  assert.equal(timeline.find(({ type }) => type === "PROFESSIONAL_LEAVE_COMPLETED").occurredAt, later(7));
  assert.deepEqual(
    transactions.map(({ category, amount, occurredAt }) => ({ category, amount, occurredAt })),
    [{
      category: "staff_interim_bonus",
      amount: 5_000,
      occurredAt: later(3),
    }, {
      category: "professional_leave_pay",
      amount: 6_667,
      occurredAt: later(7),
    }],
  );
});

test("staff fica on_leave com contrato ativo e cancelamento restaura disponibilidade", () => {
  const base = roomFixture();
  const physio = base.clubCareerState.staffMembers.find((member) => (
    member.clubId === "A" && member.role === "physiotherapist"
  ));
  const started = startProfessionalLeave(base, {
    operationId: "leave-staff:start",
    professionalType: "staff",
    professionalId: physio.id,
    clubId: "A",
    reason: "parental_leave",
    expectedEndAt: later(40),
    paymentType: "full",
  }, { now: NOW });

  assert.equal(staffAt(started.room, physio.id).status, "on_leave");
  assert.equal(staffAt(started.room, physio.id).availability.unavailableUntil, later(40));
  assert.equal(staffContract(started.room, physio.id).status, "active");
  assert.equal(staffContract(started.room, physio.id).lifecycleStatus, "on_leave");

  const cancelled = cancelProfessionalLeave(started.room, {
    operationId: "leave-staff:cancel",
    leaveId: started.leave.id,
    initiatedBy: "professional",
    reason: "leave_withdrawn",
  }, { now: later(2) });

  assert.equal(cancelled.leave.status, "cancelled");
  assert.equal(staffAt(cancelled.room, physio.id).status, "employed");
  assert.equal(staffAt(cancelled.room, physio.id).availability.status, "available");
  assert.equal(staffContract(cancelled.room, physio.id).status, "active");
  assert.equal(staffContract(cancelled.room, physio.id).lifecycleStatus, "active");
});

test("interino ativo nao pode iniciar afastamento proprio", () => {
  const started = startProfessionalLeave(roomFixture(), {
    operationId: "leave-interim-conflict:coach",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "medical",
    expectedEndAt: later(8),
  }, { now: NOW });

  assert.throws(() => startProfessionalLeave(started.room, {
    operationId: "leave-interim-conflict:staff",
    professionalType: "staff",
    professionalId: started.leave.actingStaffId,
    clubId: "A",
    reason: "personal",
    expectedEndAt: later(4),
  }, { now: NOW }), (error) => (
    error instanceof ProfessionalLeaveError
      && error.code === "PROFESSIONAL_LEAVE_ACTIVE_INTERIM_CONFLICT"
  ));
});

test("interino futuro precisa ter contrato durante todo o afastamento", () => {
  const room = roomFixture();
  const assistant = assistantAt(room);
  const contract = staffContract(room, assistant.id);
  contract.endDate = later(5);

  assert.throws(() => startProfessionalLeave(room, {
    operationId: "leave-future-interim-contract:create",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "planned_surgery",
    startsAt: later(2),
    expectedEndAt: later(8),
    actingStaffId: assistant.id,
  }, { now: NOW }), (error) => (
    error instanceof ProfessionalLeaveError
      && error.code === "PROFESSIONAL_LEAVE_INTERIM_UNAVAILABLE"
  ));
});

test("interino reservado nao pode agendar afastamento conflitante", () => {
  const coachLeave = startProfessionalLeave(roomFixture(), {
    operationId: "leave-future-interim-reservation:coach",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "planned_surgery",
    startsAt: later(3),
    expectedEndAt: later(8),
  }, { now: NOW });

  assert.throws(() => startProfessionalLeave(coachLeave.room, {
    operationId: "leave-future-interim-reservation:staff",
    professionalType: "staff",
    professionalId: coachLeave.leave.actingStaffId,
    clubId: "A",
    reason: "personal",
    startsAt: later(4),
    expectedEndAt: later(6),
  }, { now: NOW }), (error) => (
    error instanceof ProfessionalLeaveError
      && error.code === "PROFESSIONAL_LEAVE_FUTURE_INTERIM_CONFLICT"
  ));
});

test("processamento troca interino futuro indisponivel sem abortar a carreira", () => {
  const scheduled = startProfessionalLeave(roomFixture(), {
    operationId: "leave-interim-fallback:create",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "planned_surgery",
    startsAt: later(3),
    expectedEndAt: later(8),
  }, { now: NOW });
  const originalActingId = scheduled.leave.actingStaffId;
  const original = staffAt(scheduled.room, originalActingId);
  original.status = "retired";
  staffContract(scheduled.room, originalActingId).status = "terminated";

  const progressed = processProfessionalLeaveDate(scheduled.room, later(3));

  assert.equal(progressed.activated.length, 1);
  assert.notEqual(progressed.activated[0].actingStaffId, originalActingId);
  assert.equal(
    staffAt(progressed.room, progressed.activated[0].actingStaffId).interimAssignment.status,
    "active",
  );
});

test("falta total de interino futuro nao impede concluir data pulada", () => {
  const scheduled = startProfessionalLeave(roomFixture(), {
    operationId: "leave-no-interim-fallback:create",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "planned_surgery",
    startsAt: later(3),
    expectedEndAt: later(8),
  }, { now: NOW });
  for (const member of scheduled.room.clubCareerState.staffMembers) {
    if (member.clubId !== "A" || !["assistant_coach", "youth_coach"].includes(member.role)) continue;
    member.status = "retired";
    const contract = staffContract(scheduled.room, member.id);
    if (contract) contract.status = "terminated";
  }

  const progressed = processProfessionalLeaveDate(scheduled.room, later(10));
  const leave = progressed.room.professionalLeaveState.leaves[0];

  assert.equal(progressed.activated.length, 1);
  assert.equal(progressed.completed.length, 1);
  assert.equal(leave.status, "completed");
  assert.equal(leave.actingStaffId, null);
  assert.equal(leave.metadata.interimUnavailableAt, later(3));
});

test("scheduler conclui afastamento antes de expirar contrato na mesma data", () => {
  const room = roomFixture();
  const physio = room.clubCareerState.staffMembers.find((member) => (
    member.clubId === "A" && member.role === "physiotherapist"
  ));
  const contract = staffContract(room, physio.id);
  contract.endDate = later(5);
  const scheduled = startProfessionalLeave(room, {
    operationId: "leave-expiry-order:create",
    professionalType: "staff",
    professionalId: physio.id,
    clubId: "A",
    reason: "planned_treatment",
    startsAt: later(2),
    expectedEndAt: later(5),
  }, { now: NOW });

  const leaveProgress = processProfessionalLeaveDate(scheduled.room, later(5));
  assert.equal(leaveProgress.completed[0].endedAt, later(5));
  assert.equal(leaveProgress.completed[0].status, "completed");

  const expirations = processStaffContractExpirations(leaveProgress.room, { now: later(5) });
  assert.equal(
    expirations.room.clubCareerState.staffContracts.find(({ id }) => id === contract.id).status,
    "expired",
  );
  assert.equal(
    expirations.room.professionalLeaveState.leaves.find(({ id }) => id === scheduled.leave.id).status,
    "completed",
  );
});

test("bloqueia sobreposicao e periodo posterior ao contrato", () => {
  const started = startProfessionalLeave(roomFixture(), {
    operationId: "leave-validation:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "medical",
    expectedEndAt: later(10),
  }, { now: NOW });

  assert.throws(() => startProfessionalLeave(started.room, {
    operationId: "leave-validation:overlap",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "personal",
    expectedEndAt: later(15),
  }, { now: later(1) }), (error) => (
    error instanceof ProfessionalLeaveError
      && error.code === "PROFESSIONAL_LEAVE_ALREADY_OPEN"
  ));

  const staff = roomFixture();
  const member = assistantAt(staff);
  const contract = staffContract(staff, member.id);
  assert.throws(() => startProfessionalLeave(staff, {
    operationId: "leave-validation:contract",
    professionalType: "staff",
    professionalId: member.id,
    clubId: "A",
    reason: "long_leave",
    expectedEndAt: new Date(new Date(contract.endDate).getTime() + DAY_MS).toISOString(),
  }, { now: NOW }), (error) => (
    error instanceof ProfessionalLeaveError
      && error.code === "PROFESSIONAL_LEAVE_EXCEEDS_CONTRACT"
  ));
});

test("snapshot filtra clube, profissional, status e auditoria", () => {
  const coachLeave = startProfessionalLeave(roomFixture(), {
    operationId: "leave-snapshot:coach",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "medical",
    expectedEndAt: later(10),
  }, { now: NOW });
  const staff = coachLeave.room.clubCareerState.staffMembers.find((member) => (
    member.clubId === "B" && member.role === "doctor"
  ));
  const staffLeave = startProfessionalLeave(coachLeave.room, {
    operationId: "leave-snapshot:staff",
    professionalType: "staff",
    professionalId: staff.id,
    clubId: "B",
    reason: "personal",
    expectedEndAt: later(5),
  }, { now: NOW });

  const onlyA = professionalLeaveSnapshot(staffLeave.room, {
    clubId: "A",
    status: "active",
  });
  assert.equal(onlyA.leaves.length, 1);
  assert.equal(onlyA.leaves[0].professionalType, "coach");
  assert.equal(onlyA.timeline.length, 1);
  assert.equal(onlyA.summary.active, 1);
  assert.equal("processedOperationIds" in onlyA, false);

  const onlyStaffNoAudit = professionalLeaveSnapshot(staffLeave.room, {
    professionalType: "staff",
    professionalId: staff.id,
    includeTimeline: false,
  });
  assert.equal(onlyStaffNoAudit.leaves.length, 1);
  assert.equal(onlyStaffNoAudit.timeline.length, 0);
});

test("reload mantem afastamento, contrato e interino consistentes", () => {
  const started = startProfessionalLeave(roomFixture(), {
    operationId: "leave-reload:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "recovery",
    expectedEndAt: later(12),
  }, { now: NOW });
  const reloaded = ensureProfessionalLeaveState(
    JSON.parse(JSON.stringify(started.room)),
    { now: later(1) },
  );

  assert.equal(reloaded.professionalLeaveState.leaves[0].status, "active");
  assert.equal(coach(reloaded).status, "on_leave");
  assert.equal(coachContract(reloaded).status, "active");
  assert.equal(coachAppointment(reloaded).status, "active");
  assert.equal(
    staffAt(reloaded, started.leave.actingStaffId).interimAssignment.status,
    "active",
  );
  assert.equal(validateProfessionalLeaveState(reloaded), true);
});

test("falha de callback nao altera save recebido", () => {
  const input = roomFixture();
  const before = structuredClone(input);
  assert.throws(() => startProfessionalLeave(input, {
    operationId: "leave-callback:start",
    professionalType: "coach",
    professionalId: "human",
    clubId: "A",
    reason: "medical",
    expectedEndAt: later(4),
  }, {
    now: NOW,
    recordCareerEvent: () => {
      throw new Error("career event unavailable");
    },
  }), /career event unavailable/u);
  assert.deepEqual(input, before);
});
