import { ensureCoachEmploymentState } from "./coachEmployment.mjs";
import { ensureStaffState, setStaffCoachLink } from "./staffEngine.mjs";

export const PROFESSIONAL_LEAVE_SCHEMA_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_MONEY = 2_000_000_000;
const PROFESSIONAL_TYPES = new Set(["coach", "staff"]);
const LEAVE_STATUSES = new Set([
  "scheduled",
  "active",
  "completed",
  "ended_early",
  "cancelled",
]);
const OPEN_LEAVE_STATUSES = new Set(["scheduled", "active"]);
const PAYMENT_TYPES = new Set(["full", "partial", "unpaid"]);
const INITIATORS = new Set([
  "professional",
  "club",
  "board",
  "medical_department",
  "system",
  "migration",
]);
const ACTING_STAFF_ROLES = new Set(["assistant_coach", "youth_coach"]);

export class ProfessionalLeaveError extends Error {
  constructor(message, code, status = 400, details = undefined) {
    super(message);
    this.name = "ProfessionalLeaveError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clone(value) {
  return structuredClone(value);
}

function text(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return text(value).toLocaleUpperCase("pt-BR");
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.round(number)))
    : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function timestamp(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    if (fallback === null || fallback === undefined) return null;
    return timestamp(fallback);
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ProfessionalLeaveError("Data invalida", "PROFESSIONAL_LEAVE_DATE_INVALID", 400, { value });
  }
  return date.toISOString();
}

function addDays(value, days) {
  return new Date(new Date(timestamp(value)).getTime() + integer(days, 0, 0, 3650) * DAY_MS).toISOString();
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableId(prefix, ...parts) {
  return `${prefix}-${hashText(parts.map(text).join("|")).toString(36)}`;
}

function uniqueById(values) {
  return [...new Map(values.filter(Boolean).map((value) => [value.id, value])).values()];
}

function operationId(input) {
  const id = text(input?.operationId ?? input?.requestId);
  if (!id) {
    throw new ProfessionalLeaveError(
      "Operacao sem identificador",
      "PROFESSIONAL_LEAVE_OPERATION_ID_REQUIRED",
      400,
    );
  }
  if (id.length > 128) {
    throw new ProfessionalLeaveError(
      "Identificador de operacao invalido",
      "PROFESSIONAL_LEAVE_OPERATION_ID_INVALID",
      400,
    );
  }
  return id;
}

function professionalType(value) {
  const type = text(value?.professionalType ?? value?.type).toLocaleLowerCase("en-US");
  return PROFESSIONAL_TYPES.has(type) ? type : null;
}

function professionalId(value) {
  return text(value?.professionalId ?? value?.coachId ?? value?.staffId);
}

function normalizedInitiator(value) {
  const initiator = text(value).toLocaleLowerCase("en-US");
  return INITIATORS.has(initiator) ? initiator : "professional";
}

function normalizePayment(value, contract = {}, startsAt = null, expectedEndAt = null) {
  const source = typeof value === "string"
    ? { type: value }
    : value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const typeCandidate = text(source.type ?? source.paymentType).toLocaleLowerCase("en-US");
  const type = PAYMENT_TYPES.has(typeCandidate) ? typeCandidate : "full";
  const defaultRate = type === "full" ? 1 : type === "unpaid" ? 0 : 0.5;
  const suppliedRate = finite(source.rate ?? source.paymentRate, defaultRate);
  const rate = type === "full"
    ? 1
    : type === "unpaid"
      ? 0
      : Math.round(clamp(suppliedRate, 0.01, 0.99) * 1000) / 1000;
  const monthlyWage = integer(source.monthlyWage ?? contract?.wage ?? contract?.salary, 0, 0, MAX_MONEY);
  const durationDays = startsAt && expectedEndAt
    ? Math.max(0, Math.ceil((new Date(expectedEndAt).getTime() - new Date(startsAt).getTime()) / DAY_MS))
    : 0;
  return {
    type,
    rate,
    monthlyWage,
    estimatedGross: integer(
      source.estimatedGross,
      Math.round(monthlyWage * rate * (durationDays / 30)),
      0,
      MAX_MONEY,
    ),
    actualGross: source.actualGross == null
      ? null
      : integer(source.actualGross, 0, 0, MAX_MONEY),
    paidByClub: source.paidByClub !== false,
    notes: text(source.notes) || null,
  };
}

function normalizeActingStaffBefore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    linkedCoachId: text(value.linkedCoachId) || null,
    affiliationType: text(value.affiliationType) || "independent",
    interimAssignment: value.interimAssignment && typeof value.interimAssignment === "object"
      ? clone(value.interimAssignment)
      : null,
  };
}

function normalizeLeave(value, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = professionalType(value);
  const id = professionalId(value);
  const clubId = text(value.clubId);
  if (!type || !id || !clubId) return null;
  const requestedAt = timestamp(value.requestedAt ?? value.createdAt, now);
  const startsAt = timestamp(value.startsAt ?? value.startDate ?? value.startedAt, requestedAt);
  const expectedEndAt = timestamp(
    value.expectedEndAt
      ?? value.endsAt
      ?? value.endDate
      ?? value.unavailableUntil,
    addDays(startsAt, 30),
  );
  const rawStatus = text(value.status).toLocaleLowerCase("en-US");
  const inferredStatus = value.cancelledAt
    ? "cancelled"
    : value.endedAt
      ? new Date(value.endedAt).getTime() < new Date(expectedEndAt).getTime()
        ? "ended_early"
        : "completed"
      : new Date(startsAt).getTime() > new Date(now).getTime()
        ? "scheduled"
        : "active";
  const status = LEAVE_STATUSES.has(rawStatus) ? rawStatus : inferredStatus;
  const leaveId = text(value.id) || stableId("professional-leave", type, id, clubId, startsAt);
  return {
    ...clone(value),
    id: leaveId,
    operationId: text(value.operationId) || null,
    professionalType: type,
    professionalId: id,
    clubId,
    contractId: text(value.contractId) || null,
    status,
    reason: text(value.reason ?? value.reasonCode) || "personal_leave",
    initiatedBy: normalizedInitiator(value.initiatedBy ?? value.startedBy),
    requestedAt,
    startsAt,
    expectedEndAt,
    activatedAt: timestamp(value.activatedAt ?? value.startedAt),
    endedAt: timestamp(value.endedAt),
    cancelledAt: timestamp(value.cancelledAt),
    endReason: text(value.endReason) || null,
    contractRemainsActive: true,
    payment: normalizePayment(value.payment ?? {
      type: value.paymentType,
      rate: value.paymentRate,
      monthlyWage: value.monthlyWage,
      actualGross: value.actualGross,
    }, value.contract, startsAt, expectedEndAt),
    previousProfessionalStatus: text(value.previousProfessionalStatus) || null,
    actingStaffId: text(value.actingStaffId ?? value.interimStaffId) || null,
    interimAssignmentId: text(value.interimAssignmentId) || null,
    actingStaffBefore: normalizeActingStaffBefore(value.actingStaffBefore),
    metadata: value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
      ? clone(value.metadata)
      : {},
  };
}

function normalizeTimelineEntry(value, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = text(value.type);
  const leaveId = text(value.leaveId);
  const professionalTypeValue = professionalType(value);
  const professionalIdValue = professionalId(value);
  const operationIdValue = text(value.operationId);
  if (!type || !leaveId || !professionalTypeValue || !professionalIdValue || !operationIdValue) return null;
  const occurredAt = timestamp(value.occurredAt, now);
  return {
    ...clone(value),
    id: text(value.id) || stableId("professional-leave-event", operationIdValue, type, leaveId),
    operationId: operationIdValue,
    type,
    leaveId,
    professionalType: professionalTypeValue,
    professionalId: professionalIdValue,
    clubId: text(value.clubId) || null,
    contractId: text(value.contractId) || null,
    actingStaffId: text(value.actingStaffId) || null,
    occurredAt,
    initiatedBy: normalizedInitiator(value.initiatedBy),
    reason: text(value.reason) || null,
    metadata: value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
      ? clone(value.metadata)
      : {},
  };
}

function currentDate(room, supplied = null) {
  return timestamp(
    supplied
      ?? room?.professionalLeaveState?.currentDate
      ?? room?.professionalLifecycleState?.currentDate
      ?? room?.clubCareerState?.currentDate
      ?? room?.coachEmploymentState?.currentDate
      ?? room?.startedAt
      ?? room?.createdAt,
    new Date(),
  );
}

function activeCoachContract(room, coachId, clubId = null) {
  return (room?.coachEmploymentState?.contracts ?? []).find((contract) => (
    text(contract?.coachId) === text(coachId)
      && contract?.status === "active"
      && (!clubId || key(contract?.clubId) === key(clubId))
  )) ?? null;
}

function activeCoachAppointment(room, coachId, clubId = null) {
  return (room?.coachEmploymentState?.appointments ?? []).find((appointment) => (
    text(appointment?.coachId) === text(coachId)
      && appointment?.status === "active"
      && (!clubId || key(appointment?.clubId) === key(clubId))
  )) ?? null;
}

function activeStaffContract(room, staffId, clubId = null) {
  return (room?.clubCareerState?.staffContracts ?? []).find((contract) => (
    text(contract?.staffId) === text(staffId)
      && contract?.status === "active"
      && (!clubId || key(contract?.clubId) === key(clubId))
  )) ?? null;
}

function staffMember(room, staffId) {
  return (room?.clubCareerState?.staffMembers ?? []).find((member) => (
    text(member?.id) === text(staffId)
  )) ?? null;
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return new Date(leftStart).getTime() < new Date(rightEnd).getTime()
    && new Date(rightStart).getTime() < new Date(leftEnd).getTime();
}

function hasOverlappingStaffLeave(room, staffId, startsAt, expectedEndAt, excludeLeaveId = null) {
  return (room?.professionalLeaveState?.leaves ?? []).some((leave) => (
    leave.id !== excludeLeaveId
      && leave.professionalType === "staff"
      && leave.professionalId === staffId
      && OPEN_LEAVE_STATUSES.has(leave.status)
      && rangesOverlap(startsAt, expectedEndAt, leave.startsAt, leave.expectedEndAt)
  ));
}

function coachLeaveReservedForStaff(room, staffId, startsAt, expectedEndAt) {
  return (room?.professionalLeaveState?.leaves ?? []).find((leave) => (
    leave.professionalType === "coach"
      && leave.actingStaffId === staffId
      && OPEN_LEAVE_STATUSES.has(leave.status)
      && rangesOverlap(startsAt, expectedEndAt, leave.startsAt, leave.expectedEndAt)
  )) ?? null;
}

function coachEntity(room, coachId) {
  return (room?.coachCareerState?.coaches ?? []).find((coach) => (
    text(coach?.id) === text(coachId)
  )) ?? null;
}

function professionalContext(room, input) {
  const type = professionalType(input);
  const id = professionalId(input);
  if (!type) {
    throw new ProfessionalLeaveError(
      "Tipo profissional obrigatorio",
      "PROFESSIONAL_LEAVE_TYPE_REQUIRED",
      400,
    );
  }
  if (!id) {
    throw new ProfessionalLeaveError(
      "Profissional obrigatorio",
      "PROFESSIONAL_LEAVE_PROFESSIONAL_REQUIRED",
      400,
    );
  }
  if (type === "coach") {
    const entity = coachEntity(room, id);
    if (!entity) {
      throw new ProfessionalLeaveError("Treinador nao encontrado", "PROFESSIONAL_LEAVE_COACH_NOT_FOUND", 404);
    }
    const appointment = activeCoachAppointment(room, id, input?.clubId);
    const clubId = text(input?.clubId ?? appointment?.clubId ?? entity?.currentClubId);
    const contract = activeCoachContract(room, id, clubId);
    if (!appointment || !clubId || !contract) {
      throw new ProfessionalLeaveError(
        "Treinador sem vinculo ativo",
        "PROFESSIONAL_LEAVE_ACTIVE_LINK_NOT_FOUND",
        409,
      );
    }
    return { type, id, entity, clubId, contract, appointment };
  }
  const entity = staffMember(room, id);
  if (!entity) {
    throw new ProfessionalLeaveError(
      "Membro da comissao nao encontrado",
      "PROFESSIONAL_LEAVE_STAFF_NOT_FOUND",
      404,
    );
  }
  const clubId = text(input?.clubId ?? entity?.clubId);
  const contract = activeStaffContract(room, id, clubId);
  if (!clubId || !contract || !["employed", "on_leave"].includes(entity.status)) {
    throw new ProfessionalLeaveError(
      "Membro da comissao sem vinculo ativo",
      "PROFESSIONAL_LEAVE_ACTIVE_LINK_NOT_FOUND",
      409,
    );
  }
  if (entity.interimAssignment?.status === "active") {
    throw new ProfessionalLeaveError(
      "Interino ativo nao pode iniciar afastamento",
      "PROFESSIONAL_LEAVE_ACTIVE_INTERIM_CONFLICT",
      409,
      { staffId: id, clubId, interimAssignmentId: entity.interimAssignment.id ?? null },
    );
  }
  return { type, id, entity, clubId, contract, appointment: null };
}

function rawLegacyLeaveMarkers(roomValue) {
  const result = [];
  for (const coach of roomValue?.coachCareerState?.coaches ?? []) {
    if (coach?.status !== "on_leave") continue;
    result.push({
      professionalType: "coach",
      professionalId: text(coach.id),
      clubId: text(coach.currentClubId),
      reason: text(coach.leaveReason) || "legacy_leave",
      startsAt: coach.leaveStartedAt ?? roomValue?.startedAt ?? roomValue?.createdAt,
      expectedEndAt: coach.leaveEndsAt,
      initiatedBy: "migration",
    });
  }
  for (const member of roomValue?.clubCareerState?.staffMembers ?? []) {
    if (member?.status !== "on_leave" && member?.availability?.status !== "on_leave") continue;
    result.push({
      professionalType: "staff",
      professionalId: text(member.id),
      clubId: text(member.clubId),
      contractId: text(member.contractId),
      reason: text(member?.availability?.reason) || "legacy_leave",
      startsAt: member?.availability?.availableFrom
        ?? member?.leaveStartedAt
        ?? roomValue?.startedAt
        ?? roomValue?.createdAt,
      expectedEndAt: member?.availability?.unavailableUntil ?? member?.leaveEndsAt,
      initiatedBy: "migration",
    });
  }
  return result.filter((entry) => entry.professionalId && entry.clubId);
}

function legacyLeaveSources(roomValue, source) {
  return [
    ...(Array.isArray(source?.leaves) ? source.leaves : []),
    ...(Array.isArray(roomValue?.professionalLeaves) ? roomValue.professionalLeaves : []),
    ...(Array.isArray(roomValue?.coachEmploymentState?.leaves) ? roomValue.coachEmploymentState.leaves : []),
    ...(Array.isArray(roomValue?.clubCareerState?.professionalLeaves)
      ? roomValue.clubCareerState.professionalLeaves
      : []),
    ...(Array.isArray(roomValue?.clubCareerState?.staffLeaves)
      ? roomValue.clubCareerState.staffLeaves
      : []),
  ];
}

function leaveIdentity(leave) {
  return `${leave.professionalType}:${leave.professionalId}`;
}

function clearStaleLeaveFlags(room, activeLeaves) {
  const activeIds = new Set(activeLeaves.map(leaveIdentity));
  room.coachCareerState.coaches = (room.coachCareerState.coaches ?? []).map((coach) => {
    if (activeIds.has(`coach:${coach.id}`)) return coach;
    return coach.status === "on_leave"
      ? { ...coach, status: coach.currentClubId ? "employed" : "unemployed" }
      : coach;
  });
  room.coachEmploymentState.contracts = (room.coachEmploymentState.contracts ?? []).map((contract) => (
    contract.status === "active" && !activeIds.has(`coach:${contract.coachId}`)
      ? {
        ...contract,
        onLeave: false,
        professionalLeaveId: null,
        leaveEndsAt: null,
      }
      : contract
  ));
  room.coachEmploymentState.appointments = (room.coachEmploymentState.appointments ?? []).map((appointment) => (
    appointment.status === "active" && !activeIds.has(`coach:${appointment.coachId}`)
      ? {
        ...appointment,
        onLeave: false,
        professionalLeaveId: null,
        leaveEndsAt: null,
      }
      : appointment
  ));
  room.clubCareerState.staffMembers = (room.clubCareerState.staffMembers ?? []).map((member) => (
    member.status === "on_leave" && !activeIds.has(`staff:${member.id}`)
      ? {
        ...member,
        status: member.clubId ? "employed" : "free_agent",
        availability: {
          ...(member.availability ?? {}),
          status: member.clubId ? "available" : "available",
          unavailableUntil: null,
          reason: null,
        },
      }
      : member
  ));
  room.clubCareerState.staffContracts = (room.clubCareerState.staffContracts ?? []).map((contract) => (
    contract.status === "active"
      && contract.lifecycleStatus === "on_leave"
      && !activeIds.has(`staff:${contract.staffId}`)
      ? { ...contract, lifecycleStatus: "active" }
      : contract
  ));
}

function applyLeaveFlags(room, leave) {
  if (leave.status !== "active") return room;
  if (leave.professionalType === "coach") {
    room.coachCareerState.coaches = (room.coachCareerState.coaches ?? []).map((coach) => (
      coach.id === leave.professionalId
        ? {
          ...coach,
          status: "on_leave",
          leaveReason: leave.reason,
          leaveStartedAt: leave.activatedAt ?? leave.startsAt,
          leaveEndsAt: leave.expectedEndAt,
        }
        : coach
    ));
    room.coachEmploymentState.contracts = (room.coachEmploymentState.contracts ?? []).map((contract) => (
      contract.status === "active" && contract.coachId === leave.professionalId
        ? {
          ...contract,
          onLeave: true,
          professionalLeaveId: leave.id,
          leaveEndsAt: leave.expectedEndAt,
        }
        : contract
    ));
    room.coachEmploymentState.appointments = (room.coachEmploymentState.appointments ?? []).map((appointment) => (
      appointment.status === "active" && appointment.coachId === leave.professionalId
        ? {
          ...appointment,
          onLeave: true,
          professionalLeaveId: leave.id,
          leaveEndsAt: leave.expectedEndAt,
          actingStaffId: leave.actingStaffId,
        }
        : appointment
    ));
    return room;
  }
  room.clubCareerState.staffMembers = (room.clubCareerState.staffMembers ?? []).map((member) => (
    member.id === leave.professionalId
      ? {
        ...member,
        status: "on_leave",
        availability: {
          ...(member.availability ?? {}),
          status: "on_leave",
          availableFrom: null,
          unavailableUntil: leave.expectedEndAt,
          reason: leave.reason,
        },
        updatedAt: leave.activatedAt ?? leave.startsAt,
      }
      : member
  ));
  room.clubCareerState.staffContracts = (room.clubCareerState.staffContracts ?? []).map((contract) => (
    contract.status === "active" && contract.staffId === leave.professionalId
      ? { ...contract, lifecycleStatus: "on_leave" }
      : contract
  ));
  return room;
}

/** Clone, migrate and normalize leave state without mutating input save. */
export function ensureProfessionalLeaveState(roomValue, options = {}) {
  if (!roomValue || typeof roomValue !== "object" || Array.isArray(roomValue)) {
    throw new ProfessionalLeaveError("Save invalido", "PROFESSIONAL_LEAVE_ROOM_INVALID", 400);
  }
  const requestedNow = currentDate(roomValue, options.now);
  const source = roomValue.professionalLeaveState
    && typeof roomValue.professionalLeaveState === "object"
    && !Array.isArray(roomValue.professionalLeaveState)
    ? clone(roomValue.professionalLeaveState)
    : {};
  const markers = rawLegacyLeaveMarkers(roomValue);
  let room = ensureCoachEmploymentState(roomValue, { now: requestedNow });
  room = ensureStaffState(room, {
    now: requestedNow,
    candidateCountPerRole: options.candidateCountPerRole ?? 0,
  });
  const leaves = uniqueById(legacyLeaveSources(roomValue, source)
    .map((leave) => normalizeLeave(leave, requestedNow))
    .filter(Boolean));
  for (const marker of markers) {
    if (leaves.some((leave) => (
      leave.professionalType === marker.professionalType
        && leave.professionalId === marker.professionalId
    ))) continue;
    const contract = marker.professionalType === "coach"
      ? activeCoachContract(room, marker.professionalId, marker.clubId)
      : activeStaffContract(room, marker.professionalId, marker.clubId);
    if (!contract) continue;
    const startsAt = timestamp(marker.startsAt, requestedNow);
    const expectedEndAt = timestamp(marker.expectedEndAt, addDays(startsAt, 30));
    leaves.push(normalizeLeave({
      ...marker,
      id: stableId("professional-leave", "legacy", marker.professionalType, marker.professionalId),
      operationId: `professional-leave:migration:${marker.professionalType}:${marker.professionalId}`,
      contractId: contract.id,
      status: "active",
      requestedAt: startsAt,
      startsAt,
      activatedAt: startsAt,
      expectedEndAt,
      metadata: { migratedFromLegacyStatus: true },
    }, requestedNow));
  }
  room.professionalLeaveState = {
    ...source,
    version: PROFESSIONAL_LEAVE_SCHEMA_VERSION,
    currentDate: requestedNow,
    leaves: uniqueById(leaves),
    timeline: uniqueById((Array.isArray(source.timeline) ? source.timeline : [])
      .map((entry) => normalizeTimelineEntry(entry, requestedNow))
      .filter(Boolean)),
    processedOperationIds: [...new Set((Array.isArray(source.processedOperationIds)
      ? source.processedOperationIds
      : []).map(text).filter(Boolean))],
  };
  const activeLeaves = room.professionalLeaveState.leaves.filter((leave) => leave.status === "active");
  clearStaleLeaveFlags(room, activeLeaves);
  for (const leave of activeLeaves) applyLeaveFlags(room, leave);
  validateProfessionalLeaveState(room, { normalize: false, now: requestedNow });
  return room;
}

function markProcessed(state, id) {
  state.processedOperationIds = [...new Set([...state.processedOperationIds, text(id)].filter(Boolean))];
}

function duplicateOutcome(room, id) {
  if (!room.professionalLeaveState.processedOperationIds.includes(id)) return null;
  const event = [...room.professionalLeaveState.timeline]
    .reverse()
    .find((candidate) => candidate.operationId === id) ?? null;
  const leave = event
    ? room.professionalLeaveState.leaves.find((candidate) => candidate.id === event.leaveId) ?? null
    : room.professionalLeaveState.leaves.find((candidate) => candidate.operationId === id) ?? null;
  return {
    room,
    leave: leave ? clone(leave) : null,
    events: event ? [clone(event)] : [],
    duplicate: true,
    operationId: id,
  };
}

function appendTimeline(room, leave, {
  operationId: id,
  type,
  occurredAt,
  initiatedBy = leave.initiatedBy,
  reason = leave.reason,
  metadata = {},
}) {
  const state = room.professionalLeaveState;
  const entry = normalizeTimelineEntry({
    id: stableId("professional-leave-event", id, type, leave.id),
    operationId: id,
    type,
    leaveId: leave.id,
    professionalType: leave.professionalType,
    professionalId: leave.professionalId,
    clubId: leave.clubId,
    contractId: leave.contractId,
    actingStaffId: leave.actingStaffId,
    occurredAt,
    initiatedBy,
    reason,
    metadata,
  }, occurredAt);
  const existing = state.timeline.find((candidate) => candidate.id === entry.id);
  if (existing) return existing;
  state.timeline.push(entry);
  return entry;
}

function emitEvents(room, events, options) {
  for (const event of events) options.recordCareerEvent?.(room, clone(event));
}

function findEligibleActingStaff(room, leave, requestedId = null, {
  allowRequestedFallback = false,
} = {}) {
  const members = room?.clubCareerState?.staffMembers ?? [];
  const eligible = members.filter((member) => (
    key(member?.clubId) === key(leave.clubId)
      && ACTING_STAFF_ROLES.has(member?.role)
      && member?.status === "employed"
      && (!member?.interimAssignment || member.interimAssignment.status === "ended")
      && (() => {
        const contract = activeStaffContract(room, member.id, leave.clubId);
        return Boolean(contract)
          && (!contract.startDate
            || new Date(contract.startDate).getTime() <= new Date(leave.startsAt).getTime())
          && (!contract.endDate
            || new Date(contract.endDate).getTime() >= new Date(leave.expectedEndAt).getTime())
          && !hasOverlappingStaffLeave(
            room,
            member.id,
            leave.startsAt,
            leave.expectedEndAt,
            leave.id,
          );
      })()
  ));
  if (requestedId) {
    const requested = eligible.find((member) => member.id === requestedId);
    if (requested) return requested;
    if (!allowRequestedFallback) {
      throw new ProfessionalLeaveError(
        "Interino solicitado indisponivel",
        "PROFESSIONAL_LEAVE_INTERIM_UNAVAILABLE",
        409,
        { actingStaffId: requestedId, clubId: leave.clubId },
      );
    }
  }
  return eligible.sort((left, right) => (
    (right.attributes?.manManagement ?? 0) - (left.attributes?.manManagement ?? 0)
      || (right.attributes?.tactical ?? 0) - (left.attributes?.tactical ?? 0)
      || left.id.localeCompare(right.id)
  ))[0] ?? null;
}

function setCoachActingStaff(roomValue, leaveId, operationIdValue, now, options = {}) {
  let room = roomValue;
  let leave = room.professionalLeaveState.leaves.find((candidate) => candidate.id === leaveId);
  if (!leave || leave.professionalType !== "coach") return { room, leave };
  const acting = findEligibleActingStaff(room, leave, leave.actingStaffId, {
    allowRequestedFallback: options.allowRequestedFallback === true,
  });
  if (!acting) {
    if (options.allowMissingInterim === true) {
      leave.actingStaffId = null;
      leave.interimAssignmentId = null;
      leave.metadata = {
        ...(leave.metadata ?? {}),
        interimUnavailableAt: now,
      };
      return { room, leave };
    }
    throw new ProfessionalLeaveError(
      "Clube sem profissional apto para assumir interinamente",
      "PROFESSIONAL_LEAVE_INTERIM_UNAVAILABLE",
      409,
      { clubId: leave.clubId },
    );
  }
  leave.actingStaffBefore = {
    linkedCoachId: acting.linkedCoachId ?? null,
    affiliationType: acting.affiliationType ?? "independent",
    interimAssignment: acting.interimAssignment ? clone(acting.interimAssignment) : null,
  };
  leave.actingStaffId = acting.id;
  const interimAssignment = {
    id: stableId("staff-interim", leave.id, acting.id),
    clubId: leave.clubId,
    role: "acting_head_coach",
    startedAt: now,
    expectedEndAt: leave.expectedEndAt,
    status: "active",
    temporaryBonus: integer(options.temporaryBonus ?? leave.metadata?.temporaryBonus, 0, 0, MAX_MONEY),
    authorityLevel: integer(options.authorityLevel ?? leave.metadata?.authorityLevel, 65, 0, 100),
    sourceCoachId: leave.professionalId,
  };
  const outcome = setStaffCoachLink(room, {
    operationId: `${operationIdValue}:acting`,
    staffId: acting.id,
    linkedCoachId: leave.professionalId,
    affiliationType: acting.affiliationType,
    interimAssignment,
  }, { now });
  room = outcome.room;
  leave = room.professionalLeaveState.leaves.find((candidate) => candidate.id === leaveId);
  leave.interimAssignmentId = interimAssignment.id;
  if (interimAssignment.temporaryBonus > 0) {
    const transactionId = `professional-leave:${leave.id}:interim-bonus`;
    options.postFinancialTransaction?.(room, {
      id: transactionId,
      operationId: transactionId,
      originId: transactionId,
      clubId: leave.clubId,
      direction: "expense",
      type: "expense",
      category: "staff_interim_bonus",
      amount: interimAssignment.temporaryBonus,
      occurredAt: now,
      staffId: acting.id,
      contractId: activeStaffContract(room, acting.id, leave.clubId)?.id ?? null,
      description: "Bonus temporario por comando interino",
      source: "professional-leave",
      metadata: {
        leaveId: leave.id,
        coachId: leave.professionalId,
        interimAssignmentId: interimAssignment.id,
      },
    });
    leave.metadata = {
      ...(leave.metadata ?? {}),
      interimBonusTransactionId: transactionId,
    };
  }
  return { room, leave };
}

function restoreCoachActingStaff(roomValue, leaveId, operationIdValue, now) {
  let room = roomValue;
  let leave = room.professionalLeaveState.leaves.find((candidate) => candidate.id === leaveId);
  if (!leave?.actingStaffId) return { room, leave };
  const acting = staffMember(room, leave.actingStaffId);
  if (!acting) return { room, leave };
  const before = leave.actingStaffBefore ?? {};
  const currentAssignment = acting.interimAssignment;
  const hasBefore = Boolean(leave.actingStaffBefore);
  const outcome = setStaffCoachLink(room, {
    operationId: `${operationIdValue}:acting:end`,
    staffId: acting.id,
    linkedCoachId: hasBefore ? before.linkedCoachId : acting.linkedCoachId,
    affiliationType: hasBefore ? before.affiliationType : acting.affiliationType,
    interimAssignment: before.interimAssignment ?? (
      currentAssignment
        ? {
          ...currentAssignment,
          status: "ended",
          endedAt: now,
          endsAt: now,
          endReason: "professional_returned",
        }
        : null
    ),
  }, { now });
  room = outcome.room;
  leave = room.professionalLeaveState.leaves.find((candidate) => candidate.id === leaveId);
  return { room, leave };
}

function activateLeave(roomValue, leaveId, operationIdValue, now, options = {}) {
  let room = roomValue;
  let leave = room.professionalLeaveState.leaves.find((candidate) => candidate.id === leaveId);
  if (!leave) {
    throw new ProfessionalLeaveError("Afastamento nao encontrado", "PROFESSIONAL_LEAVE_NOT_FOUND", 404);
  }
  if (leave.status === "active") return { room, leave, event: null };
  if (leave.status !== "scheduled") {
    throw new ProfessionalLeaveError(
      "Afastamento nao pode ser iniciado",
      "PROFESSIONAL_LEAVE_STATUS_INVALID",
      409,
      { status: leave.status },
    );
  }
  professionalContext(room, leave);
  if (leave.professionalType === "coach") {
    ({ room, leave } = setCoachActingStaff(room, leaveId, operationIdValue, now, options));
  }
  leave.status = "active";
  leave.activatedAt = now;
  applyLeaveFlags(room, leave);
  const event = appendTimeline(room, leave, {
    operationId: operationIdValue,
    type: "PROFESSIONAL_LEAVE_STARTED",
    occurredAt: now,
    metadata: {
      startsAt: leave.startsAt,
      expectedEndAt: leave.expectedEndAt,
      payment: clone(leave.payment),
      actingStaffId: leave.actingStaffId,
      contractRemainsActive: true,
    },
  });
  return { room, leave, event };
}

function leaveActualGross(leave, endedAt) {
  const startedAt = leave.activatedAt ?? leave.startsAt;
  const days = Math.max(
    0,
    Math.ceil((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / DAY_MS),
  );
  return integer(
    Math.round(leave.payment.monthlyWage * leave.payment.rate * (days / 30)),
    0,
    0,
    MAX_MONEY,
  );
}

function completeLeave(roomValue, leaveId, operationIdValue, now, completionOptions = {}) {
  const {
    status = "completed",
    initiatedBy = "system",
    reason = "scheduled_return",
  } = completionOptions;
  let room = roomValue;
  let leave = room.professionalLeaveState.leaves.find((candidate) => candidate.id === leaveId);
  if (!leave) {
    throw new ProfessionalLeaveError("Afastamento nao encontrado", "PROFESSIONAL_LEAVE_NOT_FOUND", 404);
  }
  const wasActive = leave.status === "active";
  if (leave.status === "active" && leave.professionalType === "coach") {
    ({ room, leave } = restoreCoachActingStaff(room, leaveId, operationIdValue, now));
  }
  if (leave.status === "active") {
    if (leave.professionalType === "coach") {
      room.coachCareerState.coaches = room.coachCareerState.coaches.map((coach) => (
        coach.id === leave.professionalId
          ? {
            ...coach,
            status: coach.currentClubId ? "employed" : "unemployed",
            leaveReason: null,
            leaveStartedAt: null,
            leaveEndsAt: null,
          }
          : coach
      ));
      room.coachEmploymentState.contracts = room.coachEmploymentState.contracts.map((contract) => (
        contract.status === "active" && contract.coachId === leave.professionalId
          ? {
            ...contract,
            onLeave: false,
            professionalLeaveId: null,
            leaveEndsAt: null,
          }
          : contract
      ));
      room.coachEmploymentState.appointments = room.coachEmploymentState.appointments.map((appointment) => (
        appointment.status === "active" && appointment.coachId === leave.professionalId
          ? {
            ...appointment,
            onLeave: false,
            professionalLeaveId: null,
            leaveEndsAt: null,
            actingStaffId: null,
          }
          : appointment
      ));
    } else {
      room.clubCareerState.staffMembers = room.clubCareerState.staffMembers.map((member) => (
        member.id === leave.professionalId
          ? {
            ...member,
            status: "employed",
            availability: {
              ...(member.availability ?? {}),
              status: "available",
              availableFrom: now,
              unavailableUntil: null,
              reason: null,
            },
            updatedAt: now,
          }
          : member
      ));
      room.clubCareerState.staffContracts = room.clubCareerState.staffContracts.map((contract) => (
        contract.status === "active" && contract.staffId === leave.professionalId
          ? { ...contract, lifecycleStatus: "active" }
          : contract
      ));
    }
  }
  leave.status = status;
  leave.endedAt = now;
  leave.cancelledAt = status === "cancelled" ? now : null;
  leave.endReason = reason;
  leave.payment.actualGross = wasActive ? leaveActualGross(leave, now) : 0;
  if (leave.payment.paidByClub && leave.payment.actualGross > 0) {
    const transactionId = `professional-leave:${leave.id}:remuneration`;
    completionOptions.postFinancialTransaction?.(room, {
      id: transactionId,
      operationId: transactionId,
      originId: transactionId,
      clubId: leave.clubId,
      direction: "expense",
      type: "expense",
      category: "professional_leave_pay",
      amount: leave.payment.actualGross,
      occurredAt: now,
      ...(leave.professionalType === "staff" ? { staffId: leave.professionalId } : {}),
      contractId: leave.contractId,
      description: leave.payment.type === "partial"
        ? "Remuneracao parcial durante afastamento"
        : "Remuneracao durante afastamento",
      source: "professional-leave",
      metadata: {
        leaveId: leave.id,
        professionalType: leave.professionalType,
        professionalId: leave.professionalId,
        paymentType: leave.payment.type,
        paymentRate: leave.payment.rate,
      },
    });
    leave.metadata = {
      ...(leave.metadata ?? {}),
      remunerationTransactionId: transactionId,
    };
  }
  const eventType = status === "cancelled"
    ? "PROFESSIONAL_LEAVE_CANCELLED"
    : status === "ended_early"
      ? "PROFESSIONAL_LEAVE_ENDED_EARLY"
      : "PROFESSIONAL_LEAVE_COMPLETED";
  const event = appendTimeline(room, leave, {
    operationId: operationIdValue,
    type: eventType,
    occurredAt: now,
    initiatedBy,
    reason,
    metadata: {
      actualGross: leave.payment.actualGross,
      actingStaffId: leave.actingStaffId,
      contractRemainedActive: true,
    },
  });
  return { room, leave, event };
}

/** Schedule or immediately start a paid, partially paid or unpaid leave. */
export function startProfessionalLeave(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  let room = ensureProfessionalLeaveState(roomValue, { ...options, now });
  const id = operationId(input);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const context = professionalContext(room, input);
  const reason = text(input.reason ?? input.reasonCode);
  if (!reason) {
    throw new ProfessionalLeaveError(
      "Motivo do afastamento obrigatorio",
      "PROFESSIONAL_LEAVE_REASON_REQUIRED",
      400,
    );
  }
  const startsAt = timestamp(input.startsAt ?? input.startDate, now);
  const expectedEndAt = timestamp(
    input.expectedEndAt ?? input.endsAt ?? input.endDate,
    addDays(startsAt, input.durationDays ?? 30),
  );
  if (new Date(expectedEndAt).getTime() <= new Date(startsAt).getTime()) {
    throw new ProfessionalLeaveError(
      "Retorno deve ocorrer depois do inicio",
      "PROFESSIONAL_LEAVE_RANGE_INVALID",
      400,
    );
  }
  if (new Date(expectedEndAt).getTime() <= new Date(now).getTime()) {
    throw new ProfessionalLeaveError(
      "Afastamento ja encerrado",
      "PROFESSIONAL_LEAVE_ALREADY_ENDED",
      409,
    );
  }
  if (context.contract.endDate
    && new Date(expectedEndAt).getTime() > new Date(context.contract.endDate).getTime()) {
    throw new ProfessionalLeaveError(
      "Afastamento ultrapassa fim do contrato",
      "PROFESSIONAL_LEAVE_EXCEEDS_CONTRACT",
      409,
      { contractEndAt: context.contract.endDate, expectedEndAt },
    );
  }
  const existing = room.professionalLeaveState.leaves.find((leave) => (
    leave.professionalType === context.type
      && leave.professionalId === context.id
      && OPEN_LEAVE_STATUSES.has(leave.status)
  ));
  if (existing) {
    throw new ProfessionalLeaveError(
      "Profissional ja possui afastamento aberto",
      "PROFESSIONAL_LEAVE_ALREADY_OPEN",
      409,
      { leaveId: existing.id },
    );
  }
  if (context.type === "staff") {
    const reservedLeave = coachLeaveReservedForStaff(
      room,
      context.id,
      startsAt,
      expectedEndAt,
    );
    if (reservedLeave) {
      throw new ProfessionalLeaveError(
        "Profissional reservado para comando interino neste periodo",
        "PROFESSIONAL_LEAVE_FUTURE_INTERIM_CONFLICT",
        409,
        { staffId: context.id, leaveId: reservedLeave.id },
      );
    }
  }
  const leave = normalizeLeave({
    id: text(input.leaveId) || stableId("professional-leave", id, context.type, context.id),
    operationId: id,
    professionalType: context.type,
    professionalId: context.id,
    clubId: context.clubId,
    contractId: context.contract.id,
    status: "scheduled",
    reason,
    initiatedBy: normalizedInitiator(input.initiatedBy ?? input.startedBy),
    requestedAt: now,
    startsAt,
    expectedEndAt,
    payment: normalizePayment(input.payment ?? {
      type: input.paymentType,
      rate: input.paymentRate,
      notes: input.paymentNotes,
    }, context.contract, startsAt, expectedEndAt),
    previousProfessionalStatus: text(context.entity.status) || null,
    actingStaffId: text(input.actingStaffId) || null,
    metadata: {
      ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? clone(input.metadata)
        : {}),
      temporaryBonus: integer(input.temporaryBonus, 0, 0, MAX_MONEY),
      authorityLevel: integer(input.authorityLevel, 65, 0, 100),
    },
  }, now);
  if (leave.professionalType === "coach") {
    const acting = findEligibleActingStaff(room, leave, leave.actingStaffId);
    if (!acting) {
      throw new ProfessionalLeaveError(
        "Clube sem profissional apto para assumir interinamente",
        "PROFESSIONAL_LEAVE_INTERIM_UNAVAILABLE",
        409,
        { clubId: leave.clubId, expectedEndAt: leave.expectedEndAt },
      );
    }
    leave.actingStaffId = acting.id;
  }
  room.professionalLeaveState.leaves.push(leave);
  const events = [];
  if (new Date(startsAt).getTime() <= new Date(now).getTime()) {
    const activated = activateLeave(room, leave.id, id, now, options);
    room = activated.room;
    if (activated.event) events.push(activated.event);
  } else {
    const persisted = room.professionalLeaveState.leaves.find((candidate) => candidate.id === leave.id);
    events.push(appendTimeline(room, persisted, {
      operationId: id,
      type: "PROFESSIONAL_LEAVE_SCHEDULED",
      occurredAt: now,
      metadata: {
        startsAt,
        expectedEndAt,
        payment: clone(persisted.payment),
        contractRemainsActive: true,
      },
    }));
  }
  markProcessed(room.professionalLeaveState, id);
  room.professionalLeaveState.currentDate = now;
  validateProfessionalLeaveState(room, { normalize: false, now });
  emitEvents(room, events, options);
  const persisted = room.professionalLeaveState.leaves.find((candidate) => candidate.id === leave.id);
  return {
    room,
    leave: clone(persisted),
    events: clone(events),
    duplicate: false,
    operationId: id,
  };
}

/** Finish an active leave early, or cancel a scheduled/active leave. */
export function endProfessionalLeave(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  let room = ensureProfessionalLeaveState(roomValue, { ...options, now });
  const id = operationId(input);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const leaveId = text(input.leaveId);
  const type = professionalType(input);
  const professional = professionalId(input);
  let leave = room.professionalLeaveState.leaves.find((candidate) => (
    (leaveId ? candidate.id === leaveId : true)
      && (type ? candidate.professionalType === type : true)
      && (professional ? candidate.professionalId === professional : true)
      && OPEN_LEAVE_STATUSES.has(candidate.status)
  ));
  if (!leave) {
    throw new ProfessionalLeaveError(
      "Afastamento aberto nao encontrado",
      "PROFESSIONAL_LEAVE_NOT_FOUND",
      404,
    );
  }
  const action = text(input.action).toLocaleLowerCase("en-US");
  const cancel = action === "cancel" || input.cancel === true;
  const terminalStatus = cancel
    ? "cancelled"
    : new Date(now).getTime() < new Date(leave.expectedEndAt).getTime()
      ? "ended_early"
      : "completed";
  const result = completeLeave(room, leave.id, id, now, {
    ...options,
    status: terminalStatus,
    initiatedBy: normalizedInitiator(input.initiatedBy ?? input.endedBy),
    reason: text(input.reason ?? input.endReason)
      || (cancel ? "leave_cancelled" : terminalStatus === "ended_early" ? "early_return" : "scheduled_return"),
  });
  room = result.room;
  leave = result.leave;
  markProcessed(room.professionalLeaveState, id);
  room.professionalLeaveState.currentDate = now;
  validateProfessionalLeaveState(room, { normalize: false, now });
  const events = result.event ? [result.event] : [];
  emitEvents(room, events, options);
  return {
    room,
    leave: clone(leave),
    events: clone(events),
    duplicate: false,
    operationId: id,
  };
}

export function cancelProfessionalLeave(roomValue, input = {}, options = {}) {
  return endProfessionalLeave(roomValue, { ...input, action: "cancel" }, options);
}

/** Activate and close due leaves. Safe to repeat for the same date. */
export function processProfessionalLeaveDate(roomValue, asOf = new Date(), options = {}) {
  const now = currentDate(roomValue, asOf);
  let room = ensureProfessionalLeaveState(roomValue, { ...options, now });
  const activated = [];
  const completed = [];
  const events = [];
  const dueStarts = room.professionalLeaveState.leaves
    .filter((leave) => (
      leave.status === "scheduled"
        && new Date(leave.startsAt).getTime() <= new Date(now).getTime()
    ))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id));
  for (const scheduled of dueStarts) {
    const id = `professional-leave:activate:${scheduled.id}:${scheduled.startsAt}`;
    if (room.professionalLeaveState.processedOperationIds.includes(id)) continue;
    const result = activateLeave(room, scheduled.id, id, scheduled.startsAt, {
      ...options,
      allowRequestedFallback: true,
      allowMissingInterim: true,
    });
    room = result.room;
    markProcessed(room.professionalLeaveState, id);
    if (result.event) events.push(result.event);
    activated.push(clone(result.leave));
  }
  const dueEnds = room.professionalLeaveState.leaves
    .filter((leave) => (
      leave.status === "active"
        && new Date(leave.expectedEndAt).getTime() <= new Date(now).getTime()
    ))
    .sort((left, right) => (
      left.expectedEndAt.localeCompare(right.expectedEndAt) || left.id.localeCompare(right.id)
    ));
  for (const active of dueEnds) {
    const id = `professional-leave:complete:${active.id}:${active.expectedEndAt}`;
    if (room.professionalLeaveState.processedOperationIds.includes(id)) continue;
    const result = completeLeave(room, active.id, id, active.expectedEndAt, {
      ...options,
      status: "completed",
      initiatedBy: "system",
      reason: "scheduled_return",
    });
    room = result.room;
    markProcessed(room.professionalLeaveState, id);
    if (result.event) events.push(result.event);
    completed.push(clone(result.leave));
  }
  room.professionalLeaveState.currentDate = now;
  validateProfessionalLeaveState(room, { normalize: false, now });
  emitEvents(room, events, options);
  return {
    room,
    activated,
    completed,
    events: clone(events),
    duplicate: activated.length === 0 && completed.length === 0,
  };
}

/** Internal snapshot. Transport layer still decides viewer authorization. */
export function professionalLeaveSnapshot(roomValue, options = {}) {
  const room = ensureProfessionalLeaveState(roomValue, options);
  const type = professionalType(options);
  const id = professionalId(options);
  const clubId = text(options.clubId);
  const statuses = new Set((Array.isArray(options.statuses)
    ? options.statuses
    : options.status ? [options.status] : [])
    .map((status) => text(status).toLocaleLowerCase("en-US"))
    .filter((status) => LEAVE_STATUSES.has(status)));
  const matches = (entry) => (
    (!type || entry.professionalType === type)
      && (!id || entry.professionalId === id)
      && (!clubId || key(entry.clubId) === key(clubId))
      && (statuses.size === 0 || statuses.has(entry.status))
  );
  const leaves = room.professionalLeaveState.leaves.filter(matches);
  const leaveIds = new Set(leaves.map((leave) => leave.id));
  const timeline = options.includeTimeline === false
    ? []
    : room.professionalLeaveState.timeline.filter((event) => leaveIds.has(event.leaveId));
  return clone({
    version: room.professionalLeaveState.version,
    currentDate: room.professionalLeaveState.currentDate,
    leaves,
    timeline,
    summary: {
      total: leaves.length,
      scheduled: leaves.filter((leave) => leave.status === "scheduled").length,
      active: leaves.filter((leave) => leave.status === "active").length,
      completed: leaves.filter((leave) => leave.status === "completed").length,
      endedEarly: leaves.filter((leave) => leave.status === "ended_early").length,
      cancelled: leaves.filter((leave) => leave.status === "cancelled").length,
    },
  });
}

export function validateProfessionalLeaveState(roomValue, options = {}) {
  const room = options.normalize === false
    ? roomValue
    : ensureProfessionalLeaveState(roomValue, options);
  const state = room?.professionalLeaveState;
  if (!state || state.version !== PROFESSIONAL_LEAVE_SCHEMA_VERSION) {
    throw new ProfessionalLeaveError(
      "Estado de afastamentos invalido",
      "PROFESSIONAL_LEAVE_STATE_INVALID",
      500,
    );
  }
  const ids = new Set();
  const openByProfessional = new Set();
  const actingStaffIds = new Set();
  for (const leave of state.leaves) {
    if (ids.has(leave.id)) {
      throw new ProfessionalLeaveError(
        "Afastamento duplicado",
        "PROFESSIONAL_LEAVE_DUPLICATE",
        500,
        { leaveId: leave.id },
      );
    }
    ids.add(leave.id);
    if (!PROFESSIONAL_TYPES.has(leave.professionalType)
      || !LEAVE_STATUSES.has(leave.status)
      || !leave.professionalId
      || !leave.clubId
      || !leave.contractId) {
      throw new ProfessionalLeaveError(
        "Registro de afastamento invalido",
        "PROFESSIONAL_LEAVE_RECORD_INVALID",
        500,
        { leaveId: leave.id },
      );
    }
    if (new Date(leave.expectedEndAt).getTime() <= new Date(leave.startsAt).getTime()) {
      throw new ProfessionalLeaveError(
        "Periodo de afastamento invalido",
        "PROFESSIONAL_LEAVE_RANGE_INVALID",
        500,
        { leaveId: leave.id },
      );
    }
    if (!OPEN_LEAVE_STATUSES.has(leave.status)) continue;
    const identity = leaveIdentity(leave);
    if (openByProfessional.has(identity)) {
      throw new ProfessionalLeaveError(
        "Profissional com afastamentos simultaneos",
        "PROFESSIONAL_LEAVE_OVERLAP",
        500,
        { professionalType: leave.professionalType, professionalId: leave.professionalId },
      );
    }
    openByProfessional.add(identity);
    const contract = leave.professionalType === "coach"
      ? activeCoachContract(room, leave.professionalId, leave.clubId)
      : activeStaffContract(room, leave.professionalId, leave.clubId);
    if (!contract || contract.id !== leave.contractId) {
      throw new ProfessionalLeaveError(
        "Afastamento sem contrato ativo correspondente",
        "PROFESSIONAL_LEAVE_CONTRACT_MISMATCH",
        500,
        { leaveId: leave.id, contractId: leave.contractId },
      );
    }
    if (leave.status === "active" && leave.professionalType === "coach") {
      if (!activeCoachAppointment(room, leave.professionalId, leave.clubId)) {
        throw new ProfessionalLeaveError(
          "Treinador afastado sem nomeacao preservada",
          "PROFESSIONAL_LEAVE_APPOINTMENT_MISSING",
          500,
          { leaveId: leave.id },
        );
      }
      if (leave.actingStaffId) {
        if (actingStaffIds.has(leave.actingStaffId)) {
          throw new ProfessionalLeaveError(
            "Interino cobre dois afastamentos",
            "PROFESSIONAL_LEAVE_INTERIM_CONFLICT",
            500,
            { actingStaffId: leave.actingStaffId },
          );
        }
        actingStaffIds.add(leave.actingStaffId);
      }
    }
  }
  for (const event of state.timeline) {
    if (!ids.has(event.leaveId)) {
      throw new ProfessionalLeaveError(
        "Auditoria referencia afastamento inexistente",
        "PROFESSIONAL_LEAVE_AUDIT_ORPHAN",
        500,
        { eventId: event.id, leaveId: event.leaveId },
      );
    }
  }
  return true;
}
