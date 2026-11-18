import {
  appointCoach,
  dismissCoach,
  openCoachSuccession,
  resignCoach,
  retireCoach,
  separateCoachByAgreement,
} from "./coachEmployment.mjs";
import {
  calculateTerminationPenalty as calculateStaffTerminationPenalty,
  fireStaff,
  hireStaff,
  renewStaffContract,
  retireStaff,
  separateStaffByAgreement,
  setStaffCoachLink,
} from "./staffEngine.mjs";
import { migrateLegacyProfessionalLifecycle } from "./professionalLifecycleLegacyMigration.mjs";

const STATE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MONTH_DAYS = 30;
const MAX_MONEY = 2_000_000_000;

const PROFESSIONAL_TYPES = new Set(["coach", "staff"]);
const NOTICE_STATUSES = new Set(["active", "completed", "ended_early", "cancelled"]);
const RETIREMENT_STATUSES = new Set(["scheduled", "effective", "cancelled"]);
const RETIREMENT_KINDS = new Set(["future", "end_season", "end_contract", "immediate"]);
const AGREEMENT_STATUSES = new Set([
  "proposed",
  "countered",
  "accepted",
  "awaiting_signatures",
  "signed",
  "executed",
  "rejected",
  "cancelled",
  "expired",
]);
const AFFILIATION_TYPES = new Set(["independent", "personal_team", "coach_recommended", "inherited"]);
const STAFF_DEPARTURE_ACTIONS = new Set(["remain", "follow", "renegotiate", "notice", "dismiss"]);

const DEFAULT_CONFIG = Object.freeze({
  defaultNoticeDays: 30,
  maximumNoticeDays: 180,
  mutualAgreementValidityDays: 14,
  maximumMutualAgreementRounds: 6,
  retirementPostponeMinimumDays: 7,
  defaultSeasonLengthDays: 365,
  immediateNoticeCompensationRate: 1,
});

export class ProfessionalLifecycleError extends Error {
  constructor(message, code, status = 400, details = undefined) {
    super(message);
    this.name = "ProfessionalLifecycleError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function key(value) {
  return text(value).toLocaleUpperCase("pt-BR");
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.min(maximum, Math.max(minimum, Math.trunc(finite(value, fallback))));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function timestamp(value, fallback = null) {
  const source = value ?? fallback;
  if (source == null || source === "") return null;
  const parsed = source instanceof Date ? source : new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + integer(days, 0) * DAY_MS).toISOString();
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function stableId(prefix, ...parts) {
  return `${prefix}-${hash(parts.map(text).join("|"))}`;
}

function operationId(input, prefix, ...parts) {
  return text(input?.operationId ?? input?.requestId)
    || stableId(prefix, ...parts, input?.professionalId, input?.coachId, input?.staffId);
}

function professionalType(input) {
  const supplied = text(input?.professionalType ?? input?.type).toLocaleLowerCase("en-US");
  if (PROFESSIONAL_TYPES.has(supplied)) return supplied;
  if (text(input?.staffId)) return "staff";
  if (text(input?.coachId)) return "coach";
  return "";
}

function professionalId(input) {
  return text(input?.professionalId ?? input?.coachId ?? input?.staffId);
}

function normalizeConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_CONFIG,
    ...clone(source),
    defaultNoticeDays: integer(source.defaultNoticeDays, DEFAULT_CONFIG.defaultNoticeDays, 0, 180),
    maximumNoticeDays: integer(source.maximumNoticeDays, DEFAULT_CONFIG.maximumNoticeDays, 1, 365),
    mutualAgreementValidityDays: integer(
      source.mutualAgreementValidityDays,
      DEFAULT_CONFIG.mutualAgreementValidityDays,
      1,
      90,
    ),
    maximumMutualAgreementRounds: integer(
      source.maximumMutualAgreementRounds,
      DEFAULT_CONFIG.maximumMutualAgreementRounds,
      1,
      20,
    ),
    retirementPostponeMinimumDays: integer(
      source.retirementPostponeMinimumDays,
      DEFAULT_CONFIG.retirementPostponeMinimumDays,
      1,
      365,
    ),
    defaultSeasonLengthDays: integer(
      source.defaultSeasonLengthDays,
      DEFAULT_CONFIG.defaultSeasonLengthDays,
      30,
      730,
    ),
    immediateNoticeCompensationRate: clamp(
      source.immediateNoticeCompensationRate ?? DEFAULT_CONFIG.immediateNoticeCompensationRate,
      0,
      2,
    ),
  };
}

function normalizedFinancialTerms(value = {}) {
  return {
    compensation: integer(value.compensation ?? value.agreedCompensation, 0, 0, MAX_MONEY),
    waivedRate: clamp(value.waivedRate ?? value.penaltyWaiverRate, 0, 1),
    pendingBonuses: integer(value.pendingBonuses ?? value.bonusesDue, 0, 0, MAX_MONEY),
    temporaryBenefits: integer(value.temporaryBenefits ?? value.benefitsCost, 0, 0, MAX_MONEY),
    noticePay: integer(value.noticePay, 0, 0, MAX_MONEY),
    confidentiality: Boolean(value.confidentiality),
    preserveBonuses: value.preserveBonuses !== false,
    benefitsThrough: timestamp(value.benefitsThrough),
    marketRelease: value.marketRelease !== false,
    notes: text(value.notes) || null,
    reputationImpact: value.reputationImpact == null
      ? null
      : Math.round(clamp(value.reputationImpact, -100, 100) * 10) / 10,
  };
}

function normalizeNotice(value) {
  if (!value || typeof value !== "object") return null;
  const type = PROFESSIONAL_TYPES.has(value.professionalType) ? value.professionalType : null;
  const id = text(value.professionalId);
  const clubId = text(value.clubId);
  const startDate = timestamp(value.startDate ?? value.communicatedAt);
  const expectedEndDate = timestamp(value.expectedEndDate);
  if (!type || !id || !startDate || !expectedEndDate) return null;
  const status = NOTICE_STATUSES.has(value.status) ? value.status : "active";
  return {
    ...clone(value),
    id: text(value.id) || stableId("professional-notice", type, id, startDate),
    operationId: text(value.operationId) || null,
    professionalType: type,
    professionalId: id,
    role: text(value.role) || null,
    clubId: clubId || null,
    initiatedBy: ["professional", "club", "mutual"].includes(value.initiatedBy)
      ? value.initiatedBy
      : "mutual",
    reason: text(value.reason) || null,
    communicatedAt: timestamp(value.communicatedAt ?? startDate),
    startDate,
    durationDays: integer(value.durationDays, 0, 0, 365),
    expectedEndDate,
    endedAt: timestamp(value.endedAt),
    earlyExitAllowed: value.earlyExitAllowed !== false,
    interviewAllowed: value.interviewAllowed !== false,
    longTermDecisionApprovalRequired: value.longTermDecisionApprovalRequired !== false,
    earlyExitReasons: [...new Set((Array.isArray(value.earlyExitReasons) ? value.earlyExitReasons : [])
      .map(text).filter(Boolean))],
    compensation: normalizedFinancialTerms(value.compensation),
    status,
    endReason: text(value.endReason) || null,
    successorSearchId: text(value.successorSearchId) || null,
    substituteCoachId: text(value.substituteCoachId) || null,
    updatedAt: timestamp(value.updatedAt ?? value.communicatedAt ?? startDate),
  };
}

function normalizeRetirement(value) {
  if (!value || typeof value !== "object") return null;
  const type = PROFESSIONAL_TYPES.has(value.professionalType) ? value.professionalType : null;
  const id = text(value.professionalId);
  const announcedAt = timestamp(value.announcedAt);
  const effectiveAt = timestamp(value.effectiveAt);
  if (!type || !id || !announcedAt || !effectiveAt) return null;
  return {
    ...clone(value),
    id: text(value.id) || stableId("professional-retirement", type, id, announcedAt),
    operationId: text(value.operationId) || null,
    professionalType: type,
    professionalId: id,
    role: text(value.role) || null,
    clubId: text(value.clubId) || null,
    kind: retirementKind(value.kind ?? value.retirementType),
    announcedAt,
    effectiveAt,
    status: RETIREMENT_STATUSES.has(value.status) ? value.status : "scheduled",
    reason: text(value.reason) || null,
    cancelledAt: timestamp(value.cancelledAt),
    effectiveDate: timestamp(value.effectiveDate),
    postponementCount: integer(value.postponementCount, 0, 0, 100),
    previousEffectiveDates: [...new Set((Array.isArray(value.previousEffectiveDates)
      ? value.previousEffectiveDates : []).map(timestamp).filter(Boolean))],
    decisionFactors: value.decisionFactors && typeof value.decisionFactors === "object"
      ? clone(value.decisionFactors)
      : {},
    staffDecisions: clone(value.staffDecisions ?? value.commissionDecisions ?? []),
    successorSearchId: text(value.successorSearchId) || null,
    updatedAt: timestamp(value.updatedAt ?? announcedAt),
  };
}

function retirementKind(value) {
  const normalized = text(value).toLocaleLowerCase("en-US");
  if (normalized === "scheduled" || normalized === "planned") return "future";
  return RETIREMENT_KINDS.has(normalized) ? normalized : "future";
}

function normalizeAgreement(value) {
  if (!value || typeof value !== "object") return null;
  const type = PROFESSIONAL_TYPES.has(value.professionalType) ? value.professionalType : null;
  const id = text(value.professionalId);
  const proposedAt = timestamp(value.proposedAt);
  if (!type || !id || !proposedAt) return null;
  const signatures = value.signatures && typeof value.signatures === "object" ? value.signatures : {};
  return {
    ...clone(value),
    id: text(value.id) || stableId("professional-mutual", type, id, proposedAt),
    operationId: text(value.operationId) || null,
    professionalType: type,
    professionalId: id,
    role: text(value.role) || null,
    clubId: text(value.clubId) || null,
    proposedBy: value.proposedBy === "professional" ? "professional" : "club",
    nextResponder: value.nextResponder === "professional" ? "professional" : "club",
    status: AGREEMENT_STATUSES.has(value.status) ? value.status : "proposed",
    proposedAt,
    expiresAt: timestamp(value.expiresAt),
    departureDate: timestamp(value.departureDate ?? proposedAt),
    reason: text(value.reason) || null,
    staffDecisions: clone(value.staffDecisions ?? value.commissionDecisions ?? []),
    terms: normalizedFinancialTerms(value.terms),
    negotiationRound: integer(value.negotiationRound, 1, 1, 100),
    decisionHistory: (Array.isArray(value.decisionHistory) ? value.decisionHistory : [])
      .filter((entry) => entry && typeof entry === "object").map(clone),
    signatures: {
      club: timestamp(signatures.club),
      professional: timestamp(signatures.professional),
    },
    acceptedAt: timestamp(value.acceptedAt),
    signedAt: timestamp(value.signedAt),
    executedAt: timestamp(value.executedAt),
    rejectedAt: timestamp(value.rejectedAt),
    updatedAt: timestamp(value.updatedAt ?? proposedAt),
  };
}

function normalizeTransition(value) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.id);
  const type = text(value.type);
  const startedAt = timestamp(value.startedAt ?? value.occurredAt);
  if (!id || !type || !startedAt) return null;
  return {
    ...clone(value),
    id,
    operationId: text(value.operationId) || null,
    type,
    clubId: text(value.clubId) || null,
    coachId: text(value.coachId) || null,
    professionalIds: [...new Set((Array.isArray(value.professionalIds) ? value.professionalIds : [])
      .map(text).filter(Boolean))],
    startedAt,
    expectedEndAt: timestamp(value.expectedEndAt),
    endedAt: timestamp(value.endedAt),
    status: text(value.status) || "active",
    metadata: value.metadata && typeof value.metadata === "object" ? clone(value.metadata) : {},
  };
}

function normalizePreferredStaffEntry(value) {
  if (!value || typeof value !== "object") return null;
  const staffId = text(value.staffId ?? value.professionalId);
  if (!staffId) return null;
  const affiliationType = normalizeAffiliationType(
    value.affiliationType ?? value.linkType,
    "personal_team",
  );
  return {
    ...clone(value),
    staffId,
    role: text(value.role) || null,
    affiliationType,
    affinity: clamp(value.affinity ?? 50, 0, 100),
    trust: clamp(value.trust ?? value.affinity ?? 50, 0, 100),
    jobsTogether: integer(value.jobsTogether, 0, 0, 100),
    available: value.available !== false,
    estimatedMonthlyCost: integer(value.estimatedMonthlyCost ?? value.cost, 0, 0, MAX_MONEY),
    lastWorkedTogetherAt: timestamp(value.lastWorkedTogetherAt),
    updatedAt: timestamp(value.updatedAt),
  };
}

function normalizeAffiliationType(value, fallback = "independent") {
  const normalized = text(value).toLocaleLowerCase("en-US").replace(/[^a-z]+/g, "_");
  if (normalized === "personal_staff") return "personal_team";
  if (normalized === "recommended") return "coach_recommended";
  return AFFILIATION_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeTimelineEntry(value) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.id);
  const type = text(value.type);
  const occurredAt = timestamp(value.occurredAt);
  if (!id || !type || !occurredAt) return null;
  return {
    ...clone(value),
    id,
    operationId: text(value.operationId) || null,
    lifecycleId: text(value.lifecycleId) || null,
    type,
    professionalType: PROFESSIONAL_TYPES.has(value.professionalType) ? value.professionalType : null,
    professionalId: text(value.professionalId) || null,
    role: text(value.role) || null,
    clubId: text(value.clubId) || null,
    startedAt: timestamp(value.startedAt),
    endedAt: timestamp(value.endedAt),
    occurredAt,
    initiatedBy: text(value.initiatedBy) || null,
    reason: text(value.reason) || null,
    financialImpact: integer(value.financialImpact, 0, -MAX_MONEY, MAX_MONEY),
    reputationImpact: finite(value.reputationImpact, 0),
    relatedProfessionalIds: [...new Set((Array.isArray(value.relatedProfessionalIds)
      ? value.relatedProfessionalIds : []).map(text).filter(Boolean))],
    metadata: value.metadata && typeof value.metadata === "object" ? clone(value.metadata) : {},
  };
}

function uniqueById(values) {
  return [...new Map(values.filter(Boolean).map((value) => [value.id, value])).values()];
}

function normalizePreferredStaffMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([coachId, entries]) => {
    const id = text(coachId);
    if (!id) return [];
    const normalized = uniqueById((Array.isArray(entries) ? entries : [])
      .map(normalizePreferredStaffEntry).filter(Boolean).map((entry) => ({ ...entry, id: entry.staffId })))
      .map(({ id: ignored, ...entry }) => entry);
    return [[id, normalized]];
  }));
}

function currentDate(room, supplied = null) {
  return timestamp(
    supplied
      ?? room?.professionalLifecycleState?.currentDate
      ?? room?.clubCareerState?.currentDate
      ?? room?.coachEmploymentState?.currentDate
      ?? room?.seasonStartedAt
      ?? room?.startedAt
      ?? room?.createdAt,
    new Date(),
  );
}

/** Clone and migrate the lifecycle aggregate without mutating its input. */
export function ensureProfessionalLifecycleState(roomValue, options = {}) {
  if (!roomValue || typeof roomValue !== "object" || Array.isArray(roomValue)) {
    throw new ProfessionalLifecycleError("Save invalido", "PROFESSIONAL_LIFECYCLE_ROOM_INVALID", 400);
  }
  const room = clone(roomValue);
  const source = room.professionalLifecycleState && typeof room.professionalLifecycleState === "object"
    ? room.professionalLifecycleState
    : {};
  const now = currentDate(room, options.now);
  const legacy = Number(source.legacyMigrationVersion ?? 0) >= 1
    ? {
      notices: [],
      retirements: [],
      mutualAgreements: [],
      transitions: [],
      timeline: [],
      processedOperationIds: [],
    }
    : migrateLegacyProfessionalLifecycle(room, { now });
  room.professionalLifecycleState = {
    ...clone(source),
    version: STATE_VERSION,
    legacyMigrationVersion: 1,
    currentDate: now,
    config: normalizeConfig({ ...source.config, ...options.config }),
    notices: uniqueById([
      ...(Array.isArray(source.notices) ? source.notices : []),
      ...legacy.notices,
    ].map(normalizeNotice).filter(Boolean)),
    retirements: uniqueById([
      ...(Array.isArray(source.retirements) ? source.retirements : []),
      ...legacy.retirements,
    ]
      .map(normalizeRetirement).filter(Boolean)),
    mutualAgreements: uniqueById([
      ...(Array.isArray(source.mutualAgreements) ? source.mutualAgreements : []),
      ...legacy.mutualAgreements,
    ]
      .map(normalizeAgreement).filter(Boolean)),
    transitions: uniqueById([
      ...(Array.isArray(source.transitions) ? source.transitions : []),
      ...legacy.transitions,
    ]
      .map(normalizeTransition).filter(Boolean)),
    preferredStaffByCoach: normalizePreferredStaffMap(source.preferredStaffByCoach),
    // Timeline and operation IDs are permanent audit ledgers: intentionally uncapped.
    timeline: uniqueById([
      ...(Array.isArray(source.timeline) ? source.timeline : []),
      ...legacy.timeline,
    ]
      .map(normalizeTimelineEntry).filter(Boolean)),
    processedOperationIds: [...new Set([
      ...(Array.isArray(source.processedOperationIds) ? source.processedOperationIds : []),
      ...legacy.processedOperationIds,
    ].map(text).filter(Boolean))],
  };
  validateProfessionalLifecycleState(room, { normalize: false });
  return room;
}

function activeContractFor(room, type, id, suppliedClubId = null) {
  const contracts = type === "coach"
    ? room?.coachEmploymentState?.contracts
    : room?.clubCareerState?.staffContracts;
  const identityField = type === "coach" ? "coachId" : "staffId";
  const clubId = text(suppliedClubId);
  return (Array.isArray(contracts) ? contracts : []).find((contract) => (
    text(contract?.[identityField]) === id
      && contract?.status === "active"
      && (!clubId || key(contract?.clubId) === key(clubId))
  )) ?? null;
}

function professionalContext(room, input, { activeRequired = true } = {}) {
  const type = professionalType(input);
  const id = professionalId(input);
  if (!type) throw new ProfessionalLifecycleError("Tipo profissional obrigatorio", "PROFESSIONAL_TYPE_REQUIRED", 400);
  if (!id) throw new ProfessionalLifecycleError("Profissional obrigatorio", "PROFESSIONAL_ID_REQUIRED", 400);
  if (type === "coach") {
    const coach = (room?.coachCareerState?.coaches ?? []).find((candidate) => text(candidate?.id) === id);
    if (!coach) throw new ProfessionalLifecycleError("Treinador nao encontrado", "PROFESSIONAL_COACH_NOT_FOUND", 404);
    const appointment = (room?.coachEmploymentState?.appointments ?? []).find((candidate) => (
      text(candidate?.coachId) === id && candidate?.status === "active"
    )) ?? null;
    const clubId = text(input?.clubId ?? appointment?.clubId ?? coach?.currentClubId) || null;
    const contract = activeContractFor(room, type, id, clubId);
    if (activeRequired && (!appointment || !clubId || !contract)) {
      throw new ProfessionalLifecycleError("Treinador sem vinculo ativo", "PROFESSIONAL_ACTIVE_LINK_NOT_FOUND", 409);
    }
    return {
      type,
      id,
      entity: coach,
      clubId,
      role: text(appointment?.role) || "head_coach",
      contract,
      appointment,
    };
  }
  const member = [
    ...(room?.clubCareerState?.staffMembers ?? []),
    ...(room?.clubCareerState?.staffCandidates ?? []),
  ].find((candidate) => text(candidate?.id) === id);
  if (!member) throw new ProfessionalLifecycleError("Membro da comissao nao encontrado", "PROFESSIONAL_STAFF_NOT_FOUND", 404);
  const clubId = text(input?.clubId ?? member?.clubId) || null;
  const contract = activeContractFor(room, type, id, clubId);
  if (activeRequired && (!clubId || !contract || member.status !== "employed")) {
    throw new ProfessionalLifecycleError("Membro sem vinculo ativo", "PROFESSIONAL_ACTIVE_LINK_NOT_FOUND", 409);
  }
  return {
    type,
    id,
    entity: member,
    clubId,
    role: text(member?.role) || "staff",
    contract,
    appointment: null,
  };
}

function assertLifecycleOwnership(record, input) {
  const expectedType = professionalType(input);
  const expectedId = professionalId(input);
  const expectedClubId = text(input?.clubId);
  if ((expectedType && record.professionalType !== expectedType)
    || (expectedId && record.professionalId !== expectedId)
    || (expectedClubId && record.clubId && key(record.clubId) !== key(expectedClubId))) {
    throw new ProfessionalLifecycleError(
      "Ciclo profissional pertence a outro vinculo",
      "PROFESSIONAL_LIFECYCLE_FORBIDDEN",
      403,
    );
  }
  return record;
}

function recordForOperation(state, id) {
  if (!state.processedOperationIds.includes(id)) return null;
  return [
    ...state.notices,
    ...state.retirements,
    ...state.mutualAgreements,
    ...state.transitions,
    ...state.timeline,
  ].find((record) => record.operationId === id) ?? null;
}

function duplicateOutcome(room, id) {
  const state = room.professionalLifecycleState;
  if (!state.processedOperationIds.includes(id)) return null;
  return { room, record: clone(recordForOperation(state, id)), duplicate: true, operationId: id };
}

function markProcessed(state, ...ids) {
  state.processedOperationIds = [...new Set([
    ...state.processedOperationIds,
    ...ids.map(text).filter(Boolean),
  ])];
}

function appendTimeline(state, input) {
  const entry = normalizeTimelineEntry({
    ...input,
    id: text(input.id) || stableId(
      "professional-timeline",
      input.operationId,
      input.type,
      input.lifecycleId,
      input.professionalType,
      input.professionalId,
    ),
  });
  if (!entry) throw new ProfessionalLifecycleError("Evento de auditoria invalido", "PROFESSIONAL_TIMELINE_INVALID", 500);
  const existing = state.timeline.find((candidate) => candidate.id === entry.id);
  if (existing) return existing;
  state.timeline.push(entry);
  return entry;
}

function roomFromOutcome(outcome, fallback) {
  if (outcome?.room && typeof outcome.room === "object") return outcome.room;
  if (outcome && typeof outcome === "object" && outcome.professionalLifecycleState) return outcome;
  return fallback;
}

function lifecycleSeasonProgress(room) {
  const rounds = (room?.leagueFixtureSchedule ?? [])
    .map((fixture) => integer(fixture?.round, 0, 0))
    .filter((round) => round > 0);
  const totalRounds = rounds.length > 0 ? Math.max(...rounds) : 0;
  const currentRound = integer(
    room?.lastCompletedRound?.round
      ?? room?.currentRound
      ?? room?.careerState?.currentRound,
    0,
    0,
  );
  return totalRounds > 0 ? clamp(currentRound / totalRounds, 0, 1) : 0.5;
}

function mutualAgreementReputationImpact(room, context, agreement) {
  const explicit = agreement?.terms?.reputationImpact;
  if (explicit != null && Number.isFinite(Number(explicit))) {
    return Math.round(clamp(explicit, -5, 2) * 10) / 10;
  }
  const reason = text(agreement?.reason).toLocaleLowerCase("pt-BR");
  const benign = [
    "health",
    "saude",
    "family",
    "famil",
    "personal",
    "aposent",
    "financial_crisis",
    "crise_financeira",
    "broken_promises",
    "promessas",
  ].some((token) => reason.includes(token));
  const conflict = [
    "conflict",
    "conflito",
    "disciplin",
    "aband",
    "breach",
    "quebra",
  ].some((token) => reason.includes(token));
  let impact = benign ? 0 : conflict ? -3 : -1;
  const progress = lifecycleSeasonProgress(room);
  if (!benign && progress > 0.12 && progress < 0.88) impact -= 1;
  const relationship = finite(
    context?.entity?.boardConfidence
      ?? context?.entity?.boardRelationship
      ?? context?.entity?.professionalTrust
      ?? context?.entity?.satisfaction
      ?? context?.entity?.affinity,
    50,
  );
  if (relationship >= 75) impact -= 1;
  if (relationship <= 25) impact += 1;
  const evaluations = room?.coachEmploymentState?.evaluations ?? [];
  const recent = evaluations
    .filter((entry) => text(entry?.coachId) === context.id)
    .sort((left, right) => text(right?.evaluatedAt).localeCompare(text(left?.evaluatedAt)))[0];
  const score = Number(recent?.score);
  if (Number.isFinite(score)) {
    if (score >= 70) impact -= 1;
    if (score < 35) impact += 1;
  }
  return integer(impact, -1, -4, 1);
}

function applyMutualAgreementReputation(room, context, agreement, now, operationIdValue) {
  const impact = mutualAgreementReputationImpact(room, context, agreement);
  const collection = context.type === "coach"
    ? room?.coachCareerState?.coaches
    : [
      ...(room?.clubCareerState?.staffMembers ?? []),
      ...(room?.clubCareerState?.staffCandidates ?? []),
    ];
  const professional = (collection ?? []).find((candidate) => text(candidate?.id) === context.id);
  if (!professional) return impact;
  const before = clamp(professional.reputation ?? 50, 0, 100);
  const after = clamp(before + impact, 0, 100);
  const applied = Math.round(after - before);
  professional.reputation = after;
  if (context.type === "coach") {
    professional.marketReputation = clamp(
      finite(professional.marketReputation, before) + applied,
      0,
      100,
    );
    professional.professionalTrust = clamp(
      finite(professional.professionalTrust, 80) + Math.min(0, applied),
      0,
      100,
    );
    const audit = {
      id: stableId("coach-conduct", operationIdValue, "mutual_agreement", context.id),
      type: "mutual_agreement",
      occurredAt: now,
      clubId: context.clubId,
      reasonCode: text(agreement?.reason) || "mutual_agreement",
      reasonLabel: "Saida por acordo mutuo",
      reputationDelta: applied,
      reputationBefore: before,
      reputationAfter: after,
      trustDelta: Math.min(0, applied),
      operationId: operationIdValue,
      metadata: {
        agreementId: agreement.id,
        seasonProgress: lifecycleSeasonProgress(room),
        negotiated: true,
      },
    };
    professional.careerConductHistory = [
      ...(professional.careerConductHistory ?? []).filter((entry) => entry?.id !== audit.id),
      audit,
    ].slice(-500);
    professional.reputationHistory = [
      ...(professional.reputationHistory ?? []).filter((entry) => entry?.id !== audit.id),
      audit,
    ].slice(-300);
  }
  return applied;
}

function successionFromOutcome(outcome) {
  return outcome?.vacancy?.id
    ?? outcome?.succession?.id
    ?? outcome?.transition?.id
    ?? null;
}

function transitionForOutcome(state, {
  operationId: id,
  type,
  clubId,
  coachId = null,
  professionalIds = [],
  startedAt,
  expectedEndAt = null,
  status = "active",
  metadata = {},
}) {
  const transition = normalizeTransition({
    id: stableId("professional-transition", id, type, clubId),
    operationId: id,
    type,
    clubId,
    coachId,
    professionalIds,
    startedAt,
    expectedEndAt,
    status,
    metadata,
  });
  const existing = state.transitions.find((candidate) => candidate.id === transition.id);
  if (existing) return existing;
  state.transitions.push(transition);
  return transition;
}

/**
 * Calculates severance without changing any aggregate.
 * Accepts either ({ contract, ...terms }) or (contract, terms).
 */
export function calculateProfessionalCompensation(contractOrInput = {}, suppliedTerms = {}) {
  const wrapped = contractOrInput?.contract
    ? { ...contractOrInput, ...suppliedTerms }
    : { ...suppliedTerms, contract: contractOrInput };
  const contract = wrapped.contract && typeof wrapped.contract === "object" ? wrapped.contract : {};
  const now = timestamp(wrapped.now, new Date());
  const endDate = timestamp(contract.endDate);
  const wage = integer(wrapped.wage ?? contract.wage ?? contract.salary, 0, 0, MAX_MONEY);
  const remainingDays = endDate
    ? Math.max(0, Math.ceil((new Date(endDate).getTime() - new Date(now).getTime()) / DAY_MS))
    : 0;
  const remainingMonths = Math.ceil(remainingDays / MONTH_DAYS);
  const remainingWages = Math.min(MAX_MONEY, remainingMonths * wage);
  const terminationRate = clamp(
    wrapped.terminationRate ?? contract.terminationRate ?? (contract.terminationClause ? 1 : 0.25),
    0,
    1,
  );
  const contractualBase = wrapped.baseCompensation != null
    ? integer(wrapped.baseCompensation, 0, 0, MAX_MONEY)
    : contract.terminationClause != null
      ? integer(contract.terminationClause, 0, 0, MAX_MONEY)
      : Math.round(remainingWages * terminationRate);
  const waivedRate = clamp(wrapped.waivedRate ?? wrapped.penaltyWaiverRate, 0, 1);
  const agreedBase = wrapped.compensation != null || wrapped.agreedCompensation != null
    ? integer(wrapped.compensation ?? wrapped.agreedCompensation, 0, 0, MAX_MONEY)
    : Math.round(contractualBase * (1 - waivedRate));
  const noticeDaysWaived = integer(wrapped.noticeDaysWaived, 0, 0, 365);
  const noticePay = wrapped.noticePay != null
    ? integer(wrapped.noticePay, 0, 0, MAX_MONEY)
    : Math.round((noticeDaysWaived / MONTH_DAYS) * wage * clamp(wrapped.noticeCompensationRate ?? 1, 0, 2));
  const pendingBonuses = integer(wrapped.pendingBonuses ?? wrapped.bonusesDue, 0, 0, MAX_MONEY);
  const temporaryBenefits = integer(wrapped.temporaryBenefits ?? wrapped.benefitsCost, 0, 0, MAX_MONEY);
  const total = Math.min(MAX_MONEY, agreedBase + noticePay + pendingBonuses + temporaryBenefits);
  return {
    amount: total,
    total,
    wage,
    remainingDays,
    remainingMonths,
    remainingWages,
    contractualBase,
    agreedBase,
    waivedRate,
    noticePay,
    pendingBonuses,
    temporaryBenefits,
  };
}

function openSuccessionFor(room, state, context, input, now, id, options) {
  if (context.type !== "coach" || input.openSuccession === false || !context.clubId) {
    return { room, state, outcome: null };
  }
  const outcome = openCoachSuccession(room, {
    coachId: context.id,
    clubId: context.clubId,
    operationId: `${id}:succession`,
    reason: text(input.reason) || "planned_professional_departure",
    effectiveAt: input.effectiveAt ?? input.expectedEndDate,
  }, { ...options, now });
  const nextRoom = roomFromOutcome(outcome, room);
  const nextState = nextRoom.professionalLifecycleState;
  const transition = transitionForOutcome(nextState, {
    operationId: `${id}:succession`,
    type: "succession_started",
    clubId: context.clubId,
    coachId: context.id,
    professionalIds: [context.id],
    startedAt: now,
    expectedEndAt: input.effectiveAt ?? input.expectedEndDate,
    metadata: { successionId: successionFromOutcome(outcome), reason: text(input.reason) || null },
  });
  return { room: nextRoom, state: nextState, outcome, transition };
}

function executeSeparation(room, context, input, now, id, options) {
  const shared = {
    professionalId: context.id,
    coachId: context.type === "coach" ? context.id : undefined,
    staffId: context.type === "staff" ? context.id : undefined,
    clubId: context.clubId,
    operationId: id,
    reason: text(input.reason) || "professional_lifecycle_separation",
    compensation: integer(input.compensation, 0, 0, MAX_MONEY),
    penalty: integer(input.compensation, 0, 0, MAX_MONEY),
    terms: clone(input.terms ?? {}),
    agreementTerms: clone(input.terms ?? {}),
    staffDecisions: clone(input.staffDecisions ?? input.commissionDecisions ?? []),
    effectiveAt: now,
  };
  if (context.type === "staff") {
    return separateStaffByAgreement(room, shared, { ...options, now });
  }
  const coachOutcome = separateCoachByAgreement(room, shared, { ...options, now });
  const coachRoom = roomFromOutcome(coachOutcome, room);
  const personalTeam = separateCoachPersonalTeam(
    coachRoom,
    context.id,
    context.clubId,
    `${id}:personal-team`,
    now,
    options,
    input,
  );
  return {
    ...coachOutcome,
    room: personalTeam.room,
    staffOutcomes: personalTeam.outcomes,
    relatedProfessionalIds: personalTeam.staffIds,
  };
}

function adaptedStaffResignationEvent(event, context, reason, now) {
  return {
    ...clone(event),
    id: stableId("staff-event", event?.operationId, "STAFF_RESIGNED"),
    type: "STAFF_RESIGNED",
    amount: 0,
    occurredAt: now,
    metadata: {
      ...(event?.metadata ?? {}),
      reason,
      lifecycleStatus: "terminated",
      departureKind: "voluntary_resignation",
      initiatedBy: "professional",
      compensation: 0,
      clubId: context.clubId,
    },
  };
}

/**
 * Staff engine has no public resignation command yet. Reuse its atomic contract
 * separation, but expose voluntary-exit semantics and never charge the club.
 */
function resignStaffFromNotice(room, context, input, now, id, options) {
  const reason = text(input.reason) || "staff_resignation_after_notice";
  const delegatedOptions = {
    ...options,
    recordCareerEvent: typeof options?.recordCareerEvent === "function"
      ? (targetRoom, event) => options.recordCareerEvent(
        targetRoom,
        adaptedStaffResignationEvent(event, context, reason, now),
      )
      : undefined,
  };
  const outcome = separateStaffByAgreement(room, {
    professionalId: context.id,
    staffId: context.id,
    clubId: context.clubId,
    operationId: id,
    reason,
    compensation: 0,
    agreementTerms: {
      ...(input.terms ?? {}),
      departureKind: "voluntary_resignation",
      initiatedBy: "professional",
    },
  }, { ...delegatedOptions, now });
  const nextRoom = roomFromOutcome(outcome, room);
  const event = adaptedStaffResignationEvent(outcome.event, context, reason, now);
  nextRoom.clubCareerState.staffHistory = (nextRoom.clubCareerState.staffHistory ?? []).map((entry) => (
    entry.operationId === id ? clone(event) : entry
  ));
  nextRoom.clubCareerState.staffContracts = (nextRoom.clubCareerState.staffContracts ?? []).map((contract) => (
    contract.id === outcome.contract?.id
      ? { ...contract, lifecycleStatus: "terminated", endReason: reason }
      : contract
  ));
  const contract = nextRoom.clubCareerState.staffContracts.find(
    (candidate) => candidate.id === outcome.contract?.id,
  ) ?? outcome.contract;
  return {
    ...outcome,
    room: nextRoom,
    contract: clone(contract),
    event,
    financialTransactions: [],
    compensation: 0,
    penalty: 0,
    departureKind: "resignation",
  };
}

function attachCoachPersonalTeam(outcome, fallbackRoom, context, id, now, options, departureInput = {}) {
  const coachRoom = roomFromOutcome(outcome, fallbackRoom);
  const personalTeam = separateCoachPersonalTeam(
    coachRoom,
    context.id,
    context.clubId,
    `${id}:personal-team`,
    now,
    options,
    departureInput,
  );
  return {
    ...outcome,
    room: personalTeam.room,
    staffOutcomes: personalTeam.outcomes,
    relatedProfessionalIds: personalTeam.staffIds,
  };
}

function executeNoticeSeparation(room, context, notice, input, now, id, options) {
  const initiatedBy = notice.initiatedBy;
  const shared = {
    professionalId: context.id,
    coachId: context.type === "coach" ? context.id : undefined,
    staffId: context.type === "staff" ? context.id : undefined,
    clubId: context.clubId,
    operationId: id,
    reason: text(input.reason) || "notice_completed",
    reasonCode: text(input.reasonCode) || undefined,
    compensation: integer(input.compensation, 0, 0, MAX_MONEY),
    penalty: integer(input.compensation, 0, 0, MAX_MONEY),
    terms: clone(input.terms ?? {}),
    agreementTerms: clone(input.terms ?? {}),
    staffDecisions: clone(input.staffDecisions ?? notice.staffDecisions ?? []),
    effectiveAt: now,
  };
  if (initiatedBy === "mutual") {
    return executeSeparation(room, context, shared, now, id, options);
  }
  if (context.type === "staff") {
    if (initiatedBy === "professional") {
      return resignStaffFromNotice(room, context, shared, now, id, options);
    }
    return fireStaff(room, {
      ...shared,
      mutualAgreement: false,
    }, { ...options, now });
  }
  const outcome = initiatedBy === "professional"
    ? resignCoach(room, shared, { ...options, now })
    : dismissCoach(room, shared, { ...options, now });
  return attachCoachPersonalTeam(outcome, room, context, id, now, options, input);
}

function separationFinancialImpact(outcome, fallback) {
  if (Number.isFinite(Number(outcome?.penalty))) {
    return integer(outcome.penalty, fallback, 0, MAX_MONEY);
  }
  if (Number.isFinite(Number(outcome?.compensation))) {
    return integer(outcome.compensation, fallback, 0, MAX_MONEY);
  }
  const transactions = outcome?.financialTransactions ?? outcome?.transactions ?? [];
  if (Array.isArray(transactions) && transactions.length > 0) {
    return Math.min(MAX_MONEY, transactions.reduce(
      (total, transaction) => total + integer(transaction?.amount, 0, 0, MAX_MONEY),
      0,
    ));
  }
  return integer(fallback, 0, 0, MAX_MONEY);
}

function suppliedStaffDepartureDecisions(input = {}) {
  const source = input.staffDecisions ?? input.decisions ?? [];
  if (Array.isArray(source)) return source.filter((entry) => entry && typeof entry === "object");
  if (!source || typeof source !== "object") return [];
  return Object.entries(source).map(([staffId, value]) => (
    value && typeof value === "object"
      ? { ...value, staffId: text(value.staffId) || staffId }
      : { staffId, action: value }
  ));
}

function staffDepartureAction(value, affiliationType) {
  const normalized = text(value).toLocaleLowerCase("en-US").replace(/[^a-z]+/g, "_");
  const aliases = {
    stay: "remain",
    retained: "remain",
    leave: "follow",
    follows_coach: "follow",
    renew: "renegotiate",
    negotiate: "renegotiate",
    serve_notice: "notice",
    fire: "dismiss",
    terminate: "dismiss",
  };
  const action = aliases[normalized] ?? normalized;
  if (!action) return affiliationType === "personal_team" ? "follow" : "remain";
  if (!STAFF_DEPARTURE_ACTIONS.has(action)) {
    throw new ProfessionalLifecycleError(
      "Decisao da comissao invalida",
      "PROFESSIONAL_STAFF_DEPARTURE_ACTION_INVALID",
      400,
      { action: value },
    );
  }
  return action;
}

function quoteCoachStaffDeparture(room, input, now) {
  const coachId = text(input.coachId);
  const clubId = text(input.clubId);
  if (!coachId || !clubId) throw new ProfessionalLifecycleError(
    "Treinador e clube sao obrigatorios",
    "PROFESSIONAL_STAFF_DEPARTURE_IDS_REQUIRED",
    400,
  );
  const coach = (room?.coachCareerState?.coaches ?? []).find((candidate) => text(candidate?.id) === coachId);
  if (!coach) throw new ProfessionalLifecycleError(
    "Treinador nao encontrado",
    "PROFESSIONAL_COACH_NOT_FOUND",
    404,
    { coachId },
  );
  const members = (room?.clubCareerState?.staffMembers ?? []).filter((member) => (
    !["retired", "free_agent", "dismissed"].includes(text(member?.status))
      && text(member?.linkedCoachId) === coachId
      && key(member?.clubId) === key(clubId)
      && activeContractFor(room, "staff", text(member?.id), clubId)
  ));
  const supplied = suppliedStaffDepartureDecisions(input);
  const suppliedIds = supplied.map((entry) => text(entry.staffId));
  if (suppliedIds.some((staffId) => !staffId) || new Set(suppliedIds).size !== suppliedIds.length) {
    throw new ProfessionalLifecycleError(
      "Decisoes da comissao possuem profissional invalido ou duplicado",
      "PROFESSIONAL_STAFF_DEPARTURE_DECISION_DUPLICATE",
      400,
    );
  }
  const linkedIds = new Set(members.map((member) => text(member.id)));
  const unknown = suppliedIds.find((staffId) => !linkedIds.has(staffId));
  if (unknown) throw new ProfessionalLifecycleError(
    "Profissional nao pertence a comissao vinculada",
    "PROFESSIONAL_STAFF_DEPARTURE_NOT_LINKED",
    409,
    { staffId: unknown, coachId, clubId },
  );
  const suppliedById = new Map(supplied.map((entry) => [text(entry.staffId), entry]));
  const decisions = members.map((member) => {
    const decision = suppliedById.get(text(member.id)) ?? {};
    const affiliationType = normalizeAffiliationType(member.affiliationType, "independent");
    const action = staffDepartureAction(decision.action ?? decision.decision, affiliationType);
    const contract = activeContractFor(room, "staff", text(member.id), clubId);
    const terminationPenalty = contract ? calculateStaffTerminationPenalty(contract, now) : 0;
    const wage = integer(decision.wage ?? contract?.wage ?? member.salary, 0, 0, 10_000_000);
    const compensation = action === "follow"
      ? (Object.prototype.hasOwnProperty.call(decision, "compensation")
        ? integer(decision.compensation, 0, 0, MAX_MONEY)
        : Math.round(terminationPenalty * 0.5))
      : action === "dismiss"
        ? terminationPenalty
        : action === "renegotiate"
          ? integer(decision.renewalBonus, Math.round(wage * 0.5), 0, MAX_MONEY)
          : action === "notice"
            ? integer(decision.compensation, 0, 0, MAX_MONEY)
            : 0;
    return {
      member: clone(member),
      contract: clone(contract),
      input: clone(decision),
      staffId: text(member.id),
      role: text(member.role) || "staff",
      affiliationType,
      action,
      decisionSource: suppliedById.has(text(member.id)) ? "explicit" : "affiliation_policy",
      terminationPenalty,
      compensation,
      wage,
    };
  });
  const estimatedTotal = decisions.reduce(
    (total, decision) => Math.min(MAX_MONEY, total + decision.compensation),
    0,
  );
  return { coach, coachId, clubId, decisions, estimatedTotal };
}

function signedTransactionAmount(transaction) {
  const amount = integer(transaction?.amount, 0, 0, MAX_MONEY);
  return ["income", "credit"].includes(text(transaction?.type ?? transaction?.direction).toLocaleLowerCase("en-US"))
    ? -amount
    : amount;
}

/**
 * Resolves every staff link on one working clone. Cost checks happen first and
 * external callbacks are published only after all individual decisions pass.
 */
export function separateCoachStaffCollectively(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  let room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  let state = room.professionalLifecycleState;
  const id = operationId(input, "professional-staff-departure", input.coachId, input.clubId, now);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const quote = quoteCoachStaffDeparture(room, input, now);
  const maximumCost = input.maximumCost ?? input.maximumTotalCost;
  if (maximumCost != null && quote.estimatedTotal > integer(maximumCost, 0, 0, MAX_MONEY)) {
    throw new ProfessionalLifecycleError(
      "Custo do desligamento coletivo excede o limite",
      "PROFESSIONAL_STAFF_DEPARTURE_BUDGET_EXCEEDED",
      409,
      { estimatedTotal: quote.estimatedTotal, maximumCost },
    );
  }
  const availableFunds = availableStaffPackageFunds(room, quote.clubId);
  if (availableFunds != null && quote.estimatedTotal > availableFunds) {
    throw new ProfessionalLifecycleError(
      "Clube nao possui caixa para resolver a comissao",
      "PROFESSIONAL_STAFF_DEPARTURE_FUNDS_INSUFFICIENT",
      409,
      { clubId: quote.clubId, estimatedTotal: quote.estimatedTotal, availableFunds },
    );
  }

  const bufferedTransactions = [];
  const bufferedEvents = [];
  const results = [];
  const delegatedOptions = {
    ...options,
    now,
    postFinancialTransaction: (_target, transaction) => bufferedTransactions.push(clone(transaction)),
    recordCareerEvent: (_target, event) => bufferedEvents.push(clone(event)),
  };

  for (const decision of quote.decisions) {
    const operation = `${id}:${decision.action}:${decision.staffId}`;
    let outcome;
    if (decision.action === "remain") {
      outcome = setStaffCoachLink(room, {
        staffId: decision.staffId,
        coachId: null,
        clubId: quote.clubId,
        affiliationType: normalizeAffiliationType(decision.input.affiliationTypeAfter, "independent"),
        operationId: operation,
      }, delegatedOptions);
    } else if (decision.action === "follow") {
      outcome = separateStaffByAgreement(room, {
        staffId: decision.staffId,
        clubId: quote.clubId,
        operationId: operation,
        reason: text(decision.input.reason) || "followed_departing_coach",
        compensation: decision.compensation,
        agreementTerms: {
          coachId: quote.coachId,
          affiliationType: decision.affiliationType,
          followsCoach: true,
          ...clone(decision.input.terms ?? {}),
        },
      }, delegatedOptions);
    } else if (decision.action === "renegotiate") {
      const renewed = renewStaffContract(room, {
        staffId: decision.staffId,
        clubId: quote.clubId,
        operationId: `${operation}:contract`,
        years: integer(decision.input.years, 2, 1, 8),
        wage: integer(decision.input.wage, decision.wage, 1_000, 10_000_000),
        renewalBonus: decision.compensation,
        bonuses: decision.input.bonuses,
        clauses: decision.input.clauses,
        benefits: decision.input.benefits,
      }, delegatedOptions);
      const unlinked = setStaffCoachLink(renewed.room, {
        staffId: decision.staffId,
        coachId: null,
        clubId: quote.clubId,
        affiliationType: normalizeAffiliationType(decision.input.affiliationTypeAfter, "independent"),
        operationId: `${operation}:unlink`,
      }, delegatedOptions);
      outcome = { ...renewed, room: unlinked.room, linkOutcome: unlinked };
    } else if (decision.action === "notice") {
      const notice = startProfessionalNotice(room, {
        operationId: `${operation}:notice`,
        professionalType: "staff",
        professionalId: decision.staffId,
        clubId: quote.clubId,
        initiatedBy: ["professional", "club", "mutual"].includes(decision.input.initiatedBy)
          ? decision.input.initiatedBy
          : "mutual",
        durationDays: integer(decision.input.durationDays, 30, 1, 180),
        reason: text(decision.input.reason) || "coach_departure_staff_notice",
        compensationTerms: {
          ...clone(decision.input.compensationTerms ?? {}),
          compensation: decision.compensation,
        },
        openSuccession: false,
      }, delegatedOptions);
      const unlinked = setStaffCoachLink(notice.room, {
        staffId: decision.staffId,
        coachId: null,
        clubId: quote.clubId,
        affiliationType: normalizeAffiliationType(decision.input.affiliationTypeAfter, "independent"),
        operationId: `${operation}:unlink`,
      }, delegatedOptions);
      outcome = { ...notice, room: unlinked.room, linkOutcome: unlinked };
    } else {
      outcome = fireStaff(room, {
        staffId: decision.staffId,
        clubId: quote.clubId,
        operationId: operation,
        reason: text(decision.input.reason) || "staff_restructure_after_coach_exit",
      }, delegatedOptions);
    }
    room = roomFromOutcome(outcome, room);
    results.push({ ...decision, member: undefined, contract: undefined, outcome });
  }

  state = room.professionalLifecycleState;
  for (const result of results) {
    const eventType = result.action === "follow"
      ? "STAFF_FOLLOWED_COACH"
      : ["remain", "renegotiate"].includes(result.action)
        ? "STAFF_RETAINED_AFTER_COACH_EXIT"
        : "STAFF_DEPARTURE_DECISION_APPLIED";
    appendTimeline(state, {
      operationId: `${id}:decision:${result.staffId}`,
      type: eventType,
      professionalType: "staff",
      professionalId: result.staffId,
      role: result.role,
      clubId: quote.clubId,
      occurredAt: now,
      initiatedBy: text(input.initiatedBy) || "club",
      reason: text(result.input.reason) || `coach_departure_${result.action}`,
      financialImpact: result.compensation,
      relatedProfessionalIds: [quote.coachId],
      metadata: {
        action: result.action,
        affiliationType: result.affiliationType,
        decisionSource: result.decisionSource,
        terminationPenalty: result.terminationPenalty,
      },
    });
    bufferedEvents.push({
      id: `${id}:decision:${result.staffId}:event`,
      operationId: `${id}:decision:${result.staffId}`,
      type: eventType,
      professionalType: "staff",
      professionalId: result.staffId,
      staffId: result.staffId,
      coachId: quote.coachId,
      clubId: quote.clubId,
      occurredAt: now,
      metadata: {
        action: result.action,
        affiliationType: result.affiliationType,
        decisionSource: result.decisionSource,
        terminationPenalty: result.terminationPenalty,
      },
    });
  }
  const actualCost = bufferedTransactions.reduce(
    (total, transaction) => total + signedTransactionAmount(transaction),
    0,
  );
  const transition = transitionForOutcome(state, {
    operationId: id,
    type: "coach_staff_departure_resolved",
    clubId: quote.clubId,
    coachId: quote.coachId,
    professionalIds: quote.decisions.map((decision) => decision.staffId),
    startedAt: now,
    status: "completed",
    metadata: {
      decisions: results.map((result) => ({
        staffId: result.staffId,
        action: result.action,
        affiliationType: result.affiliationType,
        compensation: result.compensation,
      })),
      estimatedTotal: quote.estimatedTotal,
      actualCost,
      availableFunds,
    },
  });
  if (quote.decisions.length > 0) appendTimeline(state, {
    operationId: `${id}:dissolved`,
    lifecycleId: transition.id,
    type: "STAFF_TEAM_DISSOLVED",
    professionalType: "coach",
    professionalId: quote.coachId,
    role: "head_coach",
    clubId: quote.clubId,
    occurredAt: now,
    initiatedBy: text(input.initiatedBy) || "club",
    reason: text(input.reason) || "head_coach_departure",
    financialImpact: actualCost,
    relatedProfessionalIds: quote.decisions.map((decision) => decision.staffId),
    metadata: { transitionId: transition.id },
  });
  if (quote.decisions.length > 0) bufferedEvents.push({
    id: `${id}:dissolved:event`,
    operationId: `${id}:dissolved`,
    type: "STAFF_TEAM_DISSOLVED",
    professionalType: "coach",
    professionalId: quote.coachId,
    coachId: quote.coachId,
    clubId: quote.clubId,
    occurredAt: now,
    metadata: {
      transitionId: transition.id,
      staffIds: quote.decisions.map((decision) => decision.staffId),
    },
  });
  markProcessed(state, id);
  state.currentDate = now;
  validateProfessionalLifecycleState(room, { normalize: false });

  for (const transaction of bufferedTransactions) {
    options.postFinancialTransaction?.(room, clone(transaction));
  }
  for (const event of bufferedEvents) options.recordCareerEvent?.(room, clone(event));
  return {
    room,
    coachId: quote.coachId,
    clubId: quote.clubId,
    decisions: results.map(({ outcome, input: decisionInput, ...result }) => ({
      ...clone(result),
      input: clone(decisionInput),
      outcome: clone(outcome),
    })),
    estimatedTotal: quote.estimatedTotal,
    actualCost,
    financialTransactions: clone(bufferedTransactions),
    events: clone(bufferedEvents),
    transition: clone(transition),
    duplicate: false,
  };
}

function separateCoachPersonalTeam(roomValue, coachId, clubId, operationPrefix, now, options, departureInput = {}) {
  const result = separateCoachStaffCollectively(roomValue, {
    ...clone(departureInput),
    operationId: operationPrefix,
    coachId,
    clubId,
  }, { ...options, now });
  return {
    room: result.room,
    outcomes: (result.decisions ?? []).map((decision) => decision.outcome),
    staffIds: (result.decisions ?? []).map((decision) => text(decision.staffId)).filter(Boolean),
    decisions: result.decisions ?? [],
    financialTransactions: result.financialTransactions ?? [],
  };
}

function finalizeNoticeMutable(room, state, notice, input, now, id, options) {
  if (notice.status !== "active") {
    return { room, state, notice, outcome: null, duplicate: true };
  }
  const context = professionalContext(room, {
    professionalType: notice.professionalType,
    professionalId: notice.professionalId,
    clubId: notice.clubId,
  });
  const early = new Date(now).getTime() < new Date(notice.expectedEndDate).getTime();
  if (early && !notice.earlyExitAllowed && input.force !== true) {
    throw new ProfessionalLifecycleError(
      "Aviso nao permite encerramento antecipado",
      "PROFESSIONAL_NOTICE_EARLY_EXIT_BLOCKED",
      409,
      { noticeId: notice.id },
    );
  }
  const remainingNoticeDays = early
    ? Math.max(0, Math.ceil((new Date(notice.expectedEndDate).getTime() - new Date(now).getTime()) / DAY_MS))
    : 0;
  const calculated = calculateProfessionalCompensation({
    contract: context.contract,
    now,
    compensation: input.compensation ?? notice.compensation.compensation,
    waivedRate: input.waivedRate ?? notice.compensation.waivedRate,
    pendingBonuses: input.pendingBonuses ?? notice.compensation.pendingBonuses,
    temporaryBenefits: input.temporaryBenefits ?? notice.compensation.temporaryBenefits,
    noticePay: input.noticePay ?? (early ? undefined : 0),
    noticeDaysWaived: early ? remainingNoticeDays : 0,
    noticeCompensationRate: state.config.immediateNoticeCompensationRate,
  });
  const outcome = executeNoticeSeparation(room, context, notice, {
    reason: text(input.reason) || (early ? "notice_ended_early" : "notice_completed"),
    compensation: calculated.total,
    terms: { ...notice.compensation, remainingNoticeDays, noticeId: notice.id },
  }, now, `${id}:separation`, options);
  const financialImpact = separationFinancialImpact(outcome, calculated.total);
  const effectiveCompensation = {
    ...calculated,
    amount: financialImpact,
    total: financialImpact,
  };
  const nextRoom = roomFromOutcome(outcome, room);
  const nextState = nextRoom.professionalLifecycleState;
  const nextNotice = nextState.notices.find((candidate) => candidate.id === notice.id);
  nextNotice.status = early ? "ended_early" : "completed";
  nextNotice.endedAt = now;
  nextNotice.endReason = text(input.reason) || (early ? "ended_early" : "notice_period_completed");
  nextNotice.compensation = {
    ...nextNotice.compensation,
    compensation: financialImpact,
    noticePay: effectiveCompensation.noticePay,
  };
  nextNotice.substituteCoachId = text(input.substituteCoachId) || nextNotice.substituteCoachId;
  nextNotice.updatedAt = now;
  appendTimeline(nextState, {
    operationId: id,
    lifecycleId: nextNotice.id,
    type: early ? "PROFESSIONAL_NOTICE_ENDED_EARLY" : "PROFESSIONAL_NOTICE_COMPLETED",
    professionalType: context.type,
    professionalId: context.id,
    role: context.role,
    clubId: context.clubId,
    startedAt: nextNotice.startDate,
    endedAt: now,
    occurredAt: now,
    initiatedBy: ["professional", "club", "mutual"].includes(input.initiatedBy)
      ? input.initiatedBy
      : notice.initiatedBy,
    reason: nextNotice.endReason,
    financialImpact,
    relatedProfessionalIds: [input.substituteCoachId].map(text).filter(Boolean),
    metadata: {
      remainingNoticeDays,
      compensation: effectiveCompensation,
      departureKind: notice.initiatedBy === "club"
        ? "dismissal"
        : notice.initiatedBy === "professional"
          ? "resignation"
          : "mutual_agreement",
    },
  });
  const interim = outcome?.interimAppointment;
  if (interim) transitionForOutcome(nextState, {
    operationId: `${id}:interim`,
    type: "assistant_or_emergency_interim_started",
    clubId: context.clubId,
    coachId: text(interim.coachId),
    professionalIds: [text(interim.coachId)].filter(Boolean),
    startedAt: now,
    expectedEndAt: null,
    metadata: { appointmentId: interim.id, sourceNoticeId: notice.id },
  });
  markProcessed(nextState, id);
  return {
    room: nextRoom,
    state: nextState,
    notice: nextNotice,
    outcome,
    compensation: effectiveCompensation,
    duplicate: false,
  };
}

/** Starts notice without ending the current contract, appointment or salary. */
export function startProfessionalNotice(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  let room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  let state = room.professionalLifecycleState;
  const requestedId = operationId(
    input,
    "professional-notice-start",
    professionalType(input),
    professionalId(input),
    now,
  );
  const alreadyProcessed = duplicateOutcome(room, requestedId);
  if (alreadyProcessed) return alreadyProcessed;
  const context = professionalContext(room, input);
  const id = operationId(input, "professional-notice-start", context.type, context.id, now);
  const active = state.notices.find((notice) => (
    notice.professionalType === context.type
      && notice.professionalId === context.id
      && notice.status === "active"
  ));
  if (active) throw new ProfessionalLifecycleError(
    "Profissional ja cumpre aviso",
    "PROFESSIONAL_NOTICE_ALREADY_ACTIVE",
    409,
    { noticeId: active.id },
  );
  const immediate = input.immediateExit === true || input.noticeType === "immediate";
  const durationDays = immediate ? 0 : integer(
    input.durationDays,
    state.config.defaultNoticeDays,
    0,
    state.config.maximumNoticeDays,
  );
  const expectedEndDate = timestamp(input.expectedEndDate)
    ?? addDays(now, durationDays);
  if (new Date(expectedEndDate).getTime() < new Date(now).getTime()) {
    throw new ProfessionalLifecycleError("Fim do aviso invalido", "PROFESSIONAL_NOTICE_DATE_INVALID", 400);
  }
  const notice = normalizeNotice({
    id: text(input.noticeId) || stableId("professional-notice", id, context.type, context.id),
    operationId: id,
    professionalType: context.type,
    professionalId: context.id,
    role: context.role,
    clubId: context.clubId,
    initiatedBy: input.initiatedBy,
    reason: input.reason,
    communicatedAt: now,
    startDate: now,
    durationDays,
    expectedEndDate,
    earlyExitAllowed: input.earlyExitAllowed,
    interviewAllowed: input.interviewAllowed,
    longTermDecisionApprovalRequired: input.longTermDecisionApprovalRequired,
    earlyExitReasons: input.earlyExitReasons,
    staffDecisions: clone(input.staffDecisions ?? input.commissionDecisions ?? []),
    compensation: input.compensationTerms ?? input,
    status: "active",
    updatedAt: now,
  });
  state.notices.push(notice);
  appendTimeline(state, {
    operationId: id,
    lifecycleId: notice.id,
    type: "PROFESSIONAL_NOTICE_STARTED",
    professionalType: context.type,
    professionalId: context.id,
    role: context.role,
    clubId: context.clubId,
    startedAt: now,
    endedAt: expectedEndDate,
    occurredAt: now,
    initiatedBy: notice.initiatedBy,
    reason: notice.reason,
    financialImpact: notice.compensation.compensation,
    metadata: {
      durationDays,
      earlyExitAllowed: notice.earlyExitAllowed,
      interviewAllowed: notice.interviewAllowed,
      longTermDecisionApprovalRequired: notice.longTermDecisionApprovalRequired,
    },
  });
  const succession = openSuccessionFor(room, state, context, {
    ...input,
    expectedEndDate,
  }, now, id, options);
  room = succession.room;
  state = succession.state;
  const persistedNotice = state.notices.find((candidate) => candidate.id === notice.id);
  persistedNotice.successorSearchId = successionFromOutcome(succession.outcome);
  markProcessed(state, id);
  if (immediate) {
    const finished = finalizeNoticeMutable(
      room,
      state,
      persistedNotice,
      { ...input, reason: input.reason ?? "immediate_notice_buyout", force: true },
      now,
      `${id}:immediate`,
      options,
    );
    validateProfessionalLifecycleState(finished.room, { normalize: false });
    return {
      room: finished.room,
      notice: clone(finished.notice),
      succession: clone(succession.outcome),
      separation: clone(finished.outcome),
      compensation: clone(finished.compensation),
      duplicate: false,
    };
  }
  state.currentDate = now;
  validateProfessionalLifecycleState(room, { normalize: false });
  return { room, notice: clone(persistedNotice), succession: clone(succession.outcome), duplicate: false };
}

/** Ends an active notice before its planned date and performs the actual separation. */
export function endProfessionalNoticeEarly(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  const room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  const state = room.professionalLifecycleState;
  const notice = text(input.noticeId)
    ? state.notices.find((candidate) => candidate.id === text(input.noticeId))
    : state.notices.find((candidate) => (
      candidate.professionalType === professionalType(input)
        && candidate.professionalId === professionalId(input)
        && candidate.status === "active"
    ));
  if (!notice) throw new ProfessionalLifecycleError("Aviso ativo nao encontrado", "PROFESSIONAL_NOTICE_NOT_FOUND", 404);
  assertLifecycleOwnership(notice, input);
  const id = operationId(input, "professional-notice-end", notice.id, now);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const result = finalizeNoticeMutable(room, state, notice, input, now, id, options);
  result.state.currentDate = now;
  validateProfessionalLifecycleState(result.room, { normalize: false });
  return {
    room: result.room,
    notice: clone(result.notice),
    separation: clone(result.outcome),
    compensation: clone(result.compensation),
    duplicate: false,
  };
}

function seasonEndDate(room, now, config) {
  const explicit = timestamp(room?.seasonEndsAt ?? room?.seasonEndDate ?? room?.careerState?.seasonEndsAt);
  if (explicit) return explicit;
  const fixtures = [
    ...(Array.isArray(room?.leagueFixtureSchedule) ? room.leagueFixtureSchedule : []),
    ...(Array.isArray(room?.tournamentFixtureSchedule) ? room.tournamentFixtureSchedule : []),
  ].map((fixture) => timestamp(fixture?.date ?? fixture?.scheduledAt)).filter(Boolean).sort();
  return fixtures.at(-1) ?? addDays(now, config.defaultSeasonLengthDays);
}

function retirementEffectiveDate(room, state, context, input, now) {
  const kind = retirementKind(input.kind ?? input.retirementType);
  if (kind === "immediate") return now;
  if (kind === "end_contract") {
    const value = timestamp(context.contract?.endDate);
    if (!value) throw new ProfessionalLifecycleError(
      "Contrato sem data final",
      "PROFESSIONAL_RETIREMENT_CONTRACT_DATE_MISSING",
      409,
    );
    return value;
  }
  if (kind === "end_season") return seasonEndDate(room, now, state.config);
  const value = timestamp(input.effectiveAt);
  if (!value) throw new ProfessionalLifecycleError(
    "Data de aposentadoria obrigatoria",
    "PROFESSIONAL_RETIREMENT_DATE_REQUIRED",
    400,
  );
  return value;
}

function executeRetirementMutable(room, state, retirement, now, id, options) {
  if (retirement.status !== "scheduled") {
    return { room, state, retirement, outcome: null, duplicate: true };
  }
  const context = professionalContext(room, {
    professionalType: retirement.professionalType,
    professionalId: retirement.professionalId,
    clubId: retirement.clubId,
  }, { activeRequired: false });
  const shared = {
    professionalId: context.id,
    coachId: context.type === "coach" ? context.id : undefined,
    staffId: context.type === "staff" ? context.id : undefined,
    clubId: context.clubId,
    operationId: `${id}:retire`,
    reason: retirement.reason ?? "retirement",
    effectiveAt: now,
  };
  let outcome = context.type === "coach"
    ? retireCoach(room, shared, { ...options, now })
    : retireStaff(room, shared, { ...options, now });
  let nextRoom = roomFromOutcome(outcome, room);
  if (context.type === "coach") {
    const personalTeam = separateCoachPersonalTeam(
      nextRoom,
      context.id,
      context.clubId,
      `${id}:personal-team`,
      now,
      options,
      { staffDecisions: clone(retirement.staffDecisions ?? []) },
    );
    nextRoom = personalTeam.room;
    outcome = {
      ...outcome,
      room: nextRoom,
      staffOutcomes: personalTeam.outcomes,
      relatedProfessionalIds: personalTeam.staffIds,
    };
  }
  const nextState = nextRoom.professionalLifecycleState;
  const next = nextState.retirements.find((candidate) => candidate.id === retirement.id);
  next.status = "effective";
  next.effectiveDate = now;
  next.updatedAt = now;
  for (const notice of nextState.notices.filter((candidate) => (
    candidate.status === "active"
      && candidate.professionalType === next.professionalType
      && candidate.professionalId === next.professionalId
  ))) {
    notice.status = "ended_early";
    notice.endedAt = now;
    notice.endReason = "retirement_effective";
    notice.updatedAt = now;
  }
  for (const agreement of nextState.mutualAgreements.filter((candidate) => (
    ["proposed", "countered", "accepted", "awaiting_signatures", "signed"].includes(candidate.status)
      && candidate.professionalType === next.professionalType
      && candidate.professionalId === next.professionalId
  ))) {
    agreement.status = "cancelled";
    agreement.updatedAt = now;
  }
  appendTimeline(nextState, {
    operationId: id,
    lifecycleId: next.id,
    type: "PROFESSIONAL_RETIREMENT_EFFECTIVE",
    professionalType: context.type,
    professionalId: context.id,
    role: context.role,
    clubId: context.clubId,
    startedAt: next.announcedAt,
    endedAt: now,
    occurredAt: now,
    initiatedBy: "professional",
    reason: next.reason,
    relatedProfessionalIds: outcome?.relatedProfessionalIds ?? [],
    metadata: { kind: next.kind, postponementCount: next.postponementCount },
  });
  const interim = outcome?.interimAppointment;
  if (interim) transitionForOutcome(nextState, {
    operationId: `${id}:interim`,
    type: "assistant_or_emergency_interim_started",
    clubId: context.clubId,
    coachId: text(interim.coachId),
    professionalIds: [text(interim.coachId)].filter(Boolean),
    startedAt: now,
    metadata: { appointmentId: interim.id, sourceRetirementId: next.id },
  });
  markProcessed(nextState, id);
  return { room: nextRoom, state: nextState, retirement: next, outcome, duplicate: false };
}

/** Announces immediate or planned retirement. */
export function scheduleProfessionalRetirement(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  let room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  let state = room.professionalLifecycleState;
  const requestedId = operationId(
    input,
    "professional-retirement-schedule",
    professionalType(input),
    professionalId(input),
    now,
  );
  const alreadyProcessed = duplicateOutcome(room, requestedId);
  if (alreadyProcessed) return alreadyProcessed;
  const context = professionalContext(room, input, { activeRequired: false });
  const id = operationId(input, "professional-retirement-schedule", context.type, context.id, now);
  const active = state.retirements.find((retirement) => (
    retirement.professionalType === context.type
      && retirement.professionalId === context.id
      && retirement.status === "scheduled"
  ));
  if (active) throw new ProfessionalLifecycleError(
    "Aposentadoria ja anunciada",
    "PROFESSIONAL_RETIREMENT_ALREADY_SCHEDULED",
    409,
    { retirementId: active.id },
  );
  const effectiveAt = retirementEffectiveDate(room, state, context, input, now);
  if (new Date(effectiveAt).getTime() < new Date(now).getTime()) {
    throw new ProfessionalLifecycleError(
      "Data de aposentadoria no passado",
      "PROFESSIONAL_RETIREMENT_DATE_INVALID",
      400,
    );
  }
  const kind = retirementKind(input.kind ?? input.retirementType);
  const retirement = normalizeRetirement({
    id: text(input.retirementId) || stableId("professional-retirement", id, context.type, context.id),
    operationId: id,
    professionalType: context.type,
    professionalId: context.id,
    role: context.role,
    clubId: context.clubId,
    kind,
    announcedAt: now,
    effectiveAt,
    status: "scheduled",
    reason: input.reason,
    decisionFactors: input.decisionFactors,
    staffDecisions: clone(input.staffDecisions ?? input.commissionDecisions ?? []),
    updatedAt: now,
  });
  state.retirements.push(retirement);
  appendTimeline(state, {
    operationId: id,
    lifecycleId: retirement.id,
    type: "PROFESSIONAL_RETIREMENT_ANNOUNCED",
    professionalType: context.type,
    professionalId: context.id,
    role: context.role,
    clubId: context.clubId,
    startedAt: now,
    endedAt: effectiveAt,
    occurredAt: now,
    initiatedBy: "professional",
    reason: retirement.reason,
    metadata: { kind: retirement.kind, decisionFactors: retirement.decisionFactors },
  });
  const succession = openSuccessionFor(room, state, context, {
    ...input,
    effectiveAt,
  }, now, id, options);
  room = succession.room;
  state = succession.state;
  const persisted = state.retirements.find((candidate) => candidate.id === retirement.id);
  persisted.successorSearchId = successionFromOutcome(succession.outcome);
  markProcessed(state, id);
  if (retirement.kind === "immediate") {
    const executed = executeRetirementMutable(room, state, persisted, now, `${id}:immediate`, options);
    executed.state.currentDate = now;
    validateProfessionalLifecycleState(executed.room, { normalize: false });
    return {
      room: executed.room,
      retirement: clone(executed.retirement),
      succession: clone(succession.outcome),
      retirementOutcome: clone(executed.outcome),
      duplicate: false,
    };
  }
  state.currentDate = now;
  validateProfessionalLifecycleState(room, { normalize: false });
  return { room, retirement: clone(persisted), succession: clone(succession.outcome), duplicate: false };
}

/** Cancels or postpones an announced retirement before it becomes effective. */
export function updateProfessionalRetirement(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  const room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  const state = room.professionalLifecycleState;
  const retirement = state.retirements.find((candidate) => candidate.id === text(input.retirementId));
  if (!retirement) throw new ProfessionalLifecycleError("Aposentadoria nao encontrada", "PROFESSIONAL_RETIREMENT_NOT_FOUND", 404);
  assertLifecycleOwnership(retirement, input);
  const id = operationId(input, "professional-retirement-update", retirement.id, input.action, now);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  if (retirement.status !== "scheduled") throw new ProfessionalLifecycleError(
    "Aposentadoria nao pode mais ser alterada",
    "PROFESSIONAL_RETIREMENT_NOT_EDITABLE",
    409,
  );
  const action = text(input.action).toLocaleLowerCase("en-US");
  if (action === "cancel") {
    retirement.status = "cancelled";
    retirement.cancelledAt = now;
    retirement.updatedAt = now;
    appendTimeline(state, {
      operationId: id,
      lifecycleId: retirement.id,
      type: "PROFESSIONAL_RETIREMENT_CANCELLED",
      professionalType: retirement.professionalType,
      professionalId: retirement.professionalId,
      role: retirement.role,
      clubId: retirement.clubId,
      occurredAt: now,
      initiatedBy: "professional",
      reason: text(input.reason) || "retirement_cancelled",
      metadata: { previousEffectiveAt: retirement.effectiveAt },
    });
  } else if (action === "postpone") {
    const effectiveAt = timestamp(input.effectiveAt);
    const minimum = addDays(now, state.config.retirementPostponeMinimumDays);
    if (!effectiveAt || new Date(effectiveAt).getTime() < new Date(minimum).getTime()) {
      throw new ProfessionalLifecycleError(
        `Nova data deve respeitar ${state.config.retirementPostponeMinimumDays} dias`,
        "PROFESSIONAL_RETIREMENT_POSTPONE_DATE_INVALID",
        400,
      );
    }
    const previousEffectiveAt = retirement.effectiveAt;
    retirement.previousEffectiveDates = [...new Set([...retirement.previousEffectiveDates, previousEffectiveAt])];
    retirement.effectiveAt = effectiveAt;
    retirement.postponementCount += 1;
    retirement.updatedAt = now;
    appendTimeline(state, {
      operationId: id,
      lifecycleId: retirement.id,
      type: "PROFESSIONAL_RETIREMENT_POSTPONED",
      professionalType: retirement.professionalType,
      professionalId: retirement.professionalId,
      role: retirement.role,
      clubId: retirement.clubId,
      occurredAt: now,
      initiatedBy: "professional",
      reason: text(input.reason) || "retirement_postponed",
      metadata: { previousEffectiveAt, effectiveAt, postponementCount: retirement.postponementCount },
    });
  } else {
    throw new ProfessionalLifecycleError("Acao invalida", "PROFESSIONAL_RETIREMENT_ACTION_INVALID", 400);
  }
  markProcessed(state, id);
  state.currentDate = now;
  validateProfessionalLifecycleState(room, { normalize: false });
  return { room, retirement: clone(retirement), duplicate: false };
}

function appendAgreementDecision(agreement, input, now, id) {
  const decision = {
    id: stableId("professional-mutual-decision", agreement.id, id, input.action),
    operationId: id,
    action: text(input.action),
    actor: text(input.actor) || "system",
    occurredAt: now,
    previousStatus: text(input.previousStatus) || null,
    newStatus: agreement.status,
    reason: text(input.reason) || null,
    terms: input.terms ? normalizedFinancialTerms(input.terms) : null,
  };
  agreement.decisionHistory = uniqueById([...agreement.decisionHistory, decision]);
  return decision;
}

/** Opens a negotiated mutual-separation process; it never terminates the contract immediately. */
export function proposeMutualSeparation(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  let room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  let state = room.professionalLifecycleState;
  const requestedId = operationId(
    input,
    "professional-mutual-propose",
    professionalType(input),
    professionalId(input),
    now,
  );
  const alreadyProcessed = duplicateOutcome(room, requestedId);
  if (alreadyProcessed) return alreadyProcessed;
  const context = professionalContext(room, input);
  const id = operationId(input, "professional-mutual-propose", context.type, context.id, now);
  const active = state.mutualAgreements.find((agreement) => (
    agreement.professionalType === context.type
      && agreement.professionalId === context.id
      && ["proposed", "countered", "accepted", "awaiting_signatures", "signed"].includes(agreement.status)
  ));
  if (active) throw new ProfessionalLifecycleError(
    "Ja existe acordo em negociacao",
    "PROFESSIONAL_MUTUAL_AGREEMENT_ALREADY_ACTIVE",
    409,
    { agreementId: active.id },
  );
  const proposedBy = input.proposedBy === "professional" ? "professional" : "club";
  const departureDate = timestamp(input.departureDate, now);
  if (new Date(departureDate).getTime() < new Date(now).getTime()) {
    throw new ProfessionalLifecycleError("Data de saida invalida", "PROFESSIONAL_MUTUAL_DATE_INVALID", 400);
  }
  const agreement = normalizeAgreement({
    id: text(input.agreementId) || stableId("professional-mutual", id, context.type, context.id),
    operationId: id,
    professionalType: context.type,
    professionalId: context.id,
    role: context.role,
    clubId: context.clubId,
    proposedBy,
    nextResponder: proposedBy === "club" ? "professional" : "club",
    status: "proposed",
    proposedAt: now,
    expiresAt: timestamp(input.expiresAt)
      ?? addDays(now, state.config.mutualAgreementValidityDays),
    departureDate,
    reason: input.reason,
    staffDecisions: clone(input.staffDecisions ?? input.commissionDecisions ?? []),
    terms: input.terms ?? input,
    negotiationRound: 1,
    decisionHistory: [],
    signatures: {},
    updatedAt: now,
  });
  agreement.decisionHistory.push({
    id: stableId("professional-mutual-decision", agreement.id, id, "propose"),
    operationId: id,
    action: "propose",
    actor: proposedBy,
    occurredAt: now,
    previousStatus: null,
    newStatus: "proposed",
    reason: agreement.reason,
    terms: clone(agreement.terms),
  });
  state.mutualAgreements.push(agreement);
  appendTimeline(state, {
    operationId: id,
    lifecycleId: agreement.id,
    type: "PROFESSIONAL_MUTUAL_SEPARATION_PROPOSED",
    professionalType: context.type,
    professionalId: context.id,
    role: context.role,
    clubId: context.clubId,
    startedAt: now,
    endedAt: departureDate,
    occurredAt: now,
    initiatedBy: proposedBy,
    reason: agreement.reason,
    financialImpact: agreement.terms.compensation,
    metadata: { terms: agreement.terms, expiresAt: agreement.expiresAt },
  });
  const succession = openSuccessionFor(room, state, context, {
    ...input,
    effectiveAt: departureDate,
    openSuccession: input.openSuccession === true,
  }, now, id, options);
  room = succession.room;
  state = succession.state;
  markProcessed(state, id);
  state.currentDate = now;
  validateProfessionalLifecycleState(room, { normalize: false });
  return {
    room,
    agreement: clone(state.mutualAgreements.find((candidate) => candidate.id === agreement.id)),
    duplicate: false,
  };
}

function agreementByInput(state, input) {
  if (text(input.agreementId)) {
    return state.mutualAgreements.find((candidate) => candidate.id === text(input.agreementId)) ?? null;
  }
  const type = professionalType(input);
  const id = professionalId(input);
  return state.mutualAgreements.find((candidate) => (
    candidate.professionalType === type
      && candidate.professionalId === id
      && ["proposed", "countered", "accepted", "awaiting_signatures", "signed"].includes(candidate.status)
  )) ?? null;
}

function executeAgreementMutable(room, state, agreement, now, id, options) {
  if (agreement.status !== "signed") {
    throw new ProfessionalLifecycleError("Acordo ainda nao foi assinado", "PROFESSIONAL_MUTUAL_NOT_SIGNED", 409);
  }
  const context = professionalContext(room, {
    professionalType: agreement.professionalType,
    professionalId: agreement.professionalId,
    clubId: agreement.clubId,
  });
  const calculated = calculateProfessionalCompensation({
    contract: context.contract,
    now,
    ...agreement.terms,
  });
  const outcome = executeSeparation(room, context, {
    reason: agreement.reason ?? "mutual_agreement",
    compensation: calculated.total,
    terms: { ...agreement.terms, agreementId: agreement.id },
    staffDecisions: clone(agreement.staffDecisions ?? []),
  }, now, `${id}:separation`, options);
  const nextRoom = roomFromOutcome(outcome, room);
  const reputationImpact = applyMutualAgreementReputation(
    nextRoom,
    context,
    agreement,
    now,
    id,
  );
  const nextState = nextRoom.professionalLifecycleState;
  const next = nextState.mutualAgreements.find((candidate) => candidate.id === agreement.id);
  next.status = "executed";
  next.executedAt = now;
  next.updatedAt = now;
  for (const notice of nextState.notices.filter((candidate) => (
    candidate.status === "active"
      && candidate.professionalType === next.professionalType
      && candidate.professionalId === next.professionalId
  ))) {
    notice.status = "ended_early";
    notice.endedAt = now;
    notice.endReason = "mutual_agreement";
    notice.updatedAt = now;
  }
  appendTimeline(nextState, {
    operationId: id,
    lifecycleId: next.id,
    type: "PROFESSIONAL_MUTUAL_SEPARATION_EXECUTED",
    professionalType: context.type,
    professionalId: context.id,
    role: context.role,
    clubId: context.clubId,
    startedAt: next.proposedAt,
    endedAt: now,
    occurredAt: now,
    initiatedBy: "mutual",
    reason: next.reason,
    financialImpact: calculated.total,
    reputationImpact,
    relatedProfessionalIds: outcome?.relatedProfessionalIds ?? [],
    metadata: { terms: next.terms, compensation: calculated, reputationImpact },
  });
  const interim = outcome?.interimAppointment;
  if (interim) transitionForOutcome(nextState, {
    operationId: `${id}:interim`,
    type: "assistant_or_emergency_interim_started",
    clubId: context.clubId,
    coachId: text(interim.coachId),
    professionalIds: [text(interim.coachId)].filter(Boolean),
    startedAt: now,
    metadata: { appointmentId: interim.id, sourceAgreementId: next.id },
  });
  markProcessed(nextState, id);
  return {
    room: nextRoom,
    state: nextState,
    agreement: next,
    outcome,
    compensation: calculated,
    reputationImpact,
  };
}

/**
 * Advances an agreement through counter, accept, reject and bilateral signature.
 * Departure occurs only after both signatures and on/after departureDate.
 */
export function respondMutualSeparation(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  let room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  let state = room.professionalLifecycleState;
  let agreement = agreementByInput(state, input);
  if (!agreement) throw new ProfessionalLifecycleError("Acordo nao encontrado", "PROFESSIONAL_MUTUAL_AGREEMENT_NOT_FOUND", 404);
  assertLifecycleOwnership(agreement, input);
  const action = text(input.action).toLocaleLowerCase("en-US");
  const actor = text(input.actor).toLocaleLowerCase("en-US");
  if (!["club", "professional", "both"].includes(actor)) {
    throw new ProfessionalLifecycleError("Responsavel invalido", "PROFESSIONAL_MUTUAL_ACTOR_INVALID", 400);
  }
  const id = operationId(input, "professional-mutual-respond", agreement.id, action, actor, now);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const previousStatus = agreement.status;
  if (action === "counter") {
    if (!["proposed", "countered"].includes(agreement.status)) throw new ProfessionalLifecycleError(
      "Acordo nao aceita contraproposta",
      "PROFESSIONAL_MUTUAL_COUNTER_BLOCKED",
      409,
    );
    if (actor !== agreement.nextResponder) throw new ProfessionalLifecycleError(
      "Contraproposta fora de turno",
      "PROFESSIONAL_MUTUAL_WRONG_RESPONDER",
      409,
    );
    if (agreement.negotiationRound >= state.config.maximumMutualAgreementRounds) {
      throw new ProfessionalLifecycleError("Limite de rodadas atingido", "PROFESSIONAL_MUTUAL_ROUND_LIMIT", 409);
    }
    agreement.status = "countered";
    agreement.terms = normalizedFinancialTerms({ ...agreement.terms, ...input.terms });
    agreement.departureDate = timestamp(input.departureDate, agreement.departureDate);
    agreement.negotiationRound += 1;
    agreement.nextResponder = actor === "club" ? "professional" : "club";
  } else if (action === "accept") {
    if (!["proposed", "countered"].includes(agreement.status)) throw new ProfessionalLifecycleError(
      "Acordo nao pode ser aceito",
      "PROFESSIONAL_MUTUAL_ACCEPT_BLOCKED",
      409,
    );
    if (actor !== agreement.nextResponder) throw new ProfessionalLifecycleError(
      "Aceite fora de turno",
      "PROFESSIONAL_MUTUAL_WRONG_RESPONDER",
      409,
    );
    agreement.status = "accepted";
    agreement.acceptedAt = now;
    agreement.nextResponder = null;
  } else if (action === "reject") {
    if (!["proposed", "countered", "accepted", "awaiting_signatures"].includes(agreement.status)) {
      throw new ProfessionalLifecycleError("Acordo ja encerrado", "PROFESSIONAL_MUTUAL_REJECT_BLOCKED", 409);
    }
    agreement.status = "rejected";
    agreement.rejectedAt = now;
    agreement.nextResponder = null;
  } else if (action === "sign") {
    if (!["accepted", "awaiting_signatures"].includes(agreement.status)) throw new ProfessionalLifecycleError(
      "Acordo precisa ser aceito antes da assinatura",
      "PROFESSIONAL_MUTUAL_SIGNATURE_BLOCKED",
      409,
    );
    if (actor === "both") {
      agreement.signatures.club = now;
      agreement.signatures.professional = now;
    } else {
      agreement.signatures[actor] = now;
    }
    if (agreement.signatures.club && agreement.signatures.professional) {
      agreement.status = "signed";
      agreement.signedAt = now;
    } else {
      agreement.status = "awaiting_signatures";
    }
  } else {
    throw new ProfessionalLifecycleError("Resposta invalida", "PROFESSIONAL_MUTUAL_ACTION_INVALID", 400);
  }
  agreement.updatedAt = now;
  appendAgreementDecision(agreement, {
    action,
    actor,
    previousStatus,
    reason: input.reason,
    terms: input.terms,
  }, now, id);
  appendTimeline(state, {
    operationId: id,
    lifecycleId: agreement.id,
    type: `PROFESSIONAL_MUTUAL_SEPARATION_${action.toLocaleUpperCase("en-US")}`,
    professionalType: agreement.professionalType,
    professionalId: agreement.professionalId,
    role: agreement.role,
    clubId: agreement.clubId,
    occurredAt: now,
    initiatedBy: actor,
    reason: text(input.reason) || agreement.reason,
    financialImpact: agreement.terms.compensation,
    metadata: {
      previousStatus,
      status: agreement.status,
      negotiationRound: agreement.negotiationRound,
      terms: agreement.terms,
      signatures: agreement.signatures,
    },
  });
  markProcessed(state, id);
  if (agreement.status === "signed"
    && new Date(agreement.departureDate).getTime() <= new Date(now).getTime()) {
    const executed = executeAgreementMutable(room, state, agreement, now, `${id}:execute`, options);
    room = executed.room;
    state = executed.state;
    agreement = executed.agreement;
  }
  state.currentDate = now;
  validateProfessionalLifecycleState(room, { normalize: false });
  return { room, agreement: clone(agreement), duplicate: false };
}

/** Records or updates a trusted member in the coach's personal staff network. */
export function setCoachPreferredStaff(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  let room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  let state = room.professionalLifecycleState;
  const coachId = text(input.coachId);
  const staffId = text(input.staffId);
  if (!coachId || !staffId) throw new ProfessionalLifecycleError(
    "Treinador e profissional sao obrigatorios",
    "PROFESSIONAL_PREFERRED_STAFF_IDS_REQUIRED",
    400,
  );
  const id = operationId(input, "professional-preferred-staff", coachId, staffId, now);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const previous = state.preferredStaffByCoach[coachId] ?? [];
  const removing = input.preferred === false;
  const entry = removing ? null : normalizePreferredStaffEntry({ ...input, updatedAt: now });
  state.preferredStaffByCoach[coachId] = previous.filter((candidate) => candidate.staffId !== staffId);
  if (entry) state.preferredStaffByCoach[coachId].push(entry);
  if (input.syncLink !== false) {
    const outcome = setStaffCoachLink(room, {
      staffId,
      coachId: removing ? null : coachId,
      clubId: text(input.clubId) || undefined,
      affiliationType: removing ? "independent" : entry.affiliationType,
      linkType: removing ? "independent" : entry.affiliationType,
      operationId: `${id}:link`,
    }, { ...options, now });
    room = roomFromOutcome(outcome, room);
    state = room.professionalLifecycleState;
  }
  appendTimeline(state, {
    operationId: id,
    type: removing ? "COACH_PREFERRED_STAFF_REMOVED" : "COACH_PREFERRED_STAFF_UPDATED",
    professionalType: "coach",
    professionalId: coachId,
    role: "head_coach",
    clubId: text(input.clubId) || null,
    occurredAt: now,
    initiatedBy: text(input.initiatedBy) || "coach",
    relatedProfessionalIds: [staffId],
    metadata: entry ? clone(entry) : { preferred: false },
  });
  markProcessed(state, id);
  state.currentDate = now;
  validateProfessionalLifecycleState(room, { normalize: false });
  return { room, coachId, preferredStaff: clone(state.preferredStaffByCoach[coachId]), duplicate: false };
}

function availableStaffPackageFunds(room, clubId) {
  const collections = [
    room?.marketState?.finances,
    room?.clubCareerState?.clubFinances,
    room?.clubFinances,
    room?.clubCareerState?.financeProfiles,
  ];
  for (const collection of collections) {
    const entry = (Array.isArray(collection) ? collection : []).find((candidate) => (
      key(candidate?.clubId ?? candidate?.id) === key(clubId)
    ));
    if (!entry) continue;
    const balance = finite(
      entry.balance ?? entry.cash ?? entry.currentBalance,
      Number.NaN,
    );
    if (Number.isFinite(balance)) {
      return Math.max(0, balance - Math.max(0, finite(entry.committed, 0)));
    }
    const available = finite(entry.available ?? entry.transferAvailable, Number.NaN);
    if (Number.isFinite(available)) return Math.max(0, available);
    const transferBudget = finite(entry.transferBudget, Number.NaN);
    if (Number.isFinite(transferBudget)) return Math.max(0, transferBudget);
  }
  return null;
}

function quoteStaffPackage(room, members, clubId, now) {
  const professionals = [
    ...(room?.clubCareerState?.staffMembers ?? []),
    ...(room?.clubCareerState?.staffCandidates ?? []),
  ];
  const contracts = room?.clubCareerState?.staffContracts ?? [];
  const quotedMembers = members.map((memberInput) => {
    const staffId = text(memberInput.staffId);
    const professional = professionals.find((candidate) => text(candidate?.id) === staffId);
    if (!professional) throw new ProfessionalLifecycleError(
      "Profissional da comissao nao encontrado",
      "PROFESSIONAL_STAFF_NOT_FOUND",
      404,
      { staffId },
    );
    if (professional.status === "retired") throw new ProfessionalLifecycleError(
      "Profissional aposentado nao pode integrar o pacote",
      "PROFESSIONAL_STAFF_RETIRED",
      409,
      { staffId },
    );
    if (professional.clubId && key(professional.clubId) === key(clubId)) {
      throw new ProfessionalLifecycleError(
        "Profissional ja pertence ao clube",
        "PROFESSIONAL_STAFF_ALREADY_AT_CLUB",
        409,
        { staffId, clubId },
      );
    }
    const activeContract = contracts.find((contract) => (
      text(contract?.staffId) === staffId
        && contract?.status === "active"
        && (!contract.endDate
          || new Date(contract.endDate).getTime() > new Date(now).getTime())
    )) ?? null;
    const wage = integer(
      memberInput.wage ?? activeContract?.wage ?? professional.salary,
      0,
      1_000,
      10_000_000,
    );
    const signingBonus = Object.prototype.hasOwnProperty.call(memberInput, "signingBonus")
      ? integer(memberInput.signingBonus, 0, 0, MAX_MONEY)
      : wage;
    const buyout = activeContract && professional.clubId
      ? calculateStaffTerminationPenalty(activeContract, now)
      : 0;
    const firstYearWages = Math.min(MAX_MONEY, wage * 12);
    const firstYearCost = Math.min(MAX_MONEY, firstYearWages + signingBonus + buyout);
    return {
      input: { ...memberInput, staffId, wage, signingBonus },
      professional,
      activeContract,
      wage,
      signingBonus,
      buyout,
      firstYearWages,
      firstYearCost,
    };
  });
  const estimatedTotal = quotedMembers.reduce(
    (total, quote) => Math.min(MAX_MONEY, total + quote.firstYearCost),
    0,
  );
  return { members: quotedMembers, estimatedTotal };
}

/**
 * Hires a staff package on one clone. Domain callbacks are buffered and applied
 * only after every hire/link succeeds, so a thrown operation leaves input intact.
 */
export function hireCoachStaffPackage(roomValue, input = {}, options = {}) {
  const now = currentDate(roomValue, options.now);
  let room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  let state = room.professionalLifecycleState;
  const coachId = text(input.coachId);
  const clubId = text(input.clubId);
  const members = Array.isArray(input.members) ? input.members : [];
  if (!coachId || !clubId || members.length === 0) throw new ProfessionalLifecycleError(
    "Pacote precisa de treinador, clube e profissionais",
    "PROFESSIONAL_STAFF_PACKAGE_INVALID",
    400,
  );
  const id = operationId(input, "professional-staff-package", coachId, clubId, now);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const staffIds = members.map((member) => text(member.staffId)).filter(Boolean);
  if (staffIds.length !== members.length || new Set(staffIds).size !== staffIds.length) {
    throw new ProfessionalLifecycleError(
      "Pacote possui profissional invalido ou duplicado",
      "PROFESSIONAL_STAFF_PACKAGE_DUPLICATE",
      400,
    );
  }
  const quote = quoteStaffPackage(room, members, clubId, now);
  const coach = (room?.coachCareerState?.coaches ?? []).find((candidate) => text(candidate?.id) === coachId);
  if (!coach) throw new ProfessionalLifecycleError(
    "Treinador nao encontrado",
    "PROFESSIONAL_COACH_NOT_FOUND",
    404,
    { coachId },
  );
  const activeAppointment = (room?.coachEmploymentState?.appointments ?? []).find((appointment) => (
    appointment?.status === "active" && text(appointment?.coachId) === coachId
  )) ?? null;
  const activeCoachContract = activeAppointment
    ? (room?.coachEmploymentState?.contracts ?? []).find((contract) => (
      contract?.status === "active"
        && text(contract?.coachId) === coachId
        && text(contract?.id) === text(activeAppointment.contractId)
    )) ?? null
    : null;
  const coachAlreadyLinked = Boolean(
    activeAppointment
      && activeCoachContract
      && key(activeAppointment.clubId) === key(clubId),
  );
  const shouldAppointCoach = input.appointCoach === true
    || (input.coachAppointment && typeof input.coachAppointment === "object")
    || (input.coachTerms && typeof input.coachTerms === "object");
  if (!coachAlreadyLinked && !shouldAppointCoach) throw new ProfessionalLifecycleError(
    "Treinador precisa estar vinculado ao clube ou ser nomeado pelo pacote",
    "PROFESSIONAL_COACH_NOT_AT_CLUB",
    409,
    { coachId, clubId, activeClubId: activeAppointment?.clubId ?? null },
  );

  const bufferedStaffTransactions = [];
  const bufferedStaffEvents = [];
  const bufferedCoachTransactions = [];
  const bufferedCoachEvents = [];
  let coachOutcome = null;
  if (!coachAlreadyLinked) {
    const coachTerms = input.coachAppointment && typeof input.coachAppointment === "object"
      ? input.coachAppointment
      : input.coachTerms && typeof input.coachTerms === "object"
        ? input.coachTerms
        : {};
    coachOutcome = appointCoach(room, {
      ...clone(coachTerms),
      coachId,
      clubId,
      operationId: `${id}:coach`,
      requestId: `${id}:coach`,
      entryReason: text(coachTerms.entryReason) || "joint_coach_staff_package",
    }, {
      ...options,
      now,
      debit: (_target, transaction) => bufferedCoachTransactions.push(clone(transaction)),
      credit: (_target, transaction) => bufferedCoachTransactions.push(clone(transaction)),
      recordEvent: (_target, event) => bufferedCoachEvents.push(clone(event)),
    });
    room = roomFromOutcome(coachOutcome, room);
  }
  const coachFirstYearCost = coachOutcome
    ? Math.min(MAX_MONEY, integer(coachOutcome.contract?.wage, 0, 0, MAX_MONEY) * 12
      + bufferedCoachTransactions
        .filter((transaction) => (
          key(transaction?.clubId) === key(clubId)
            && text(transaction?.type ?? transaction?.direction).toLocaleLowerCase("en-US") !== "income"
        ))
        .reduce((total, transaction) => Math.min(MAX_MONEY, total + integer(transaction?.amount)), 0))
    : 0;
  const estimatedTotal = Math.min(MAX_MONEY, quote.estimatedTotal + coachFirstYearCost);
  if (input.maximumFirstYearCost != null
    && estimatedTotal > integer(input.maximumFirstYearCost, 0, 0, MAX_MONEY)) {
    throw new ProfessionalLifecycleError(
      "Custo da comissao excede o orcamento",
      "PROFESSIONAL_STAFF_PACKAGE_BUDGET_EXCEEDED",
      409,
      { estimatedTotal, maximumFirstYearCost: input.maximumFirstYearCost },
    );
  }
  const availableFunds = availableStaffPackageFunds(room, clubId);
  if (availableFunds != null && estimatedTotal > availableFunds) {
    throw new ProfessionalLifecycleError(
      "Clube nao possui caixa para o pacote da comissao",
      "PROFESSIONAL_STAFF_PACKAGE_FUNDS_INSUFFICIENT",
      409,
      { clubId, estimatedTotal, availableFunds },
    );
  }
  const hired = [];
  const contracts = [];
  for (const memberQuote of quote.members) {
    const memberInput = memberQuote.input;
    const staffId = text(memberInput.staffId);
    const result = hireStaff(room, {
      ...memberInput,
      staffId,
      clubId,
      operationId: `${id}:hire:${staffId}`,
      requestId: `${id}:hire:${staffId}`,
    }, {
      now,
      postFinancialTransaction: (_target, transaction) => bufferedStaffTransactions.push(clone(transaction)),
      recordCareerEvent: (_target, event) => bufferedStaffEvents.push(clone(event)),
    });
    room = result.room;
    const affiliationType = normalizeAffiliationType(
      memberInput.affiliationType ?? memberInput.linkType,
      "personal_team",
    );
    const linkOutcome = setStaffCoachLink(room, {
      staffId,
      coachId,
      clubId,
      affiliationType,
      linkType: affiliationType,
      operationId: `${id}:link:${staffId}`,
    }, {
      ...options,
      now,
      postFinancialTransaction: (_target, transaction) => bufferedStaffTransactions.push(clone(transaction)),
      recordCareerEvent: (_target, event) => bufferedStaffEvents.push(clone(event)),
    });
    room = roomFromOutcome(linkOutcome, room);
    hired.push(clone(result.member));
    contracts.push(clone(result.contract));
  }
  const bufferedTransactions = [...bufferedCoachTransactions, ...bufferedStaffTransactions];
  const bufferedEvents = [...bufferedCoachEvents, ...bufferedStaffEvents];
  state = room.professionalLifecycleState;
  const previous = state.preferredStaffByCoach[coachId] ?? [];
  state.preferredStaffByCoach[coachId] = [
    ...previous.filter((entry) => !staffIds.includes(entry.staffId)),
    ...quote.members.map(({ input: member }) => normalizePreferredStaffEntry({
      ...member,
      staffId: member.staffId,
      affiliationType: normalizeAffiliationType(
        member.affiliationType ?? member.linkType,
        "personal_team",
      ),
      available: false,
      estimatedMonthlyCost: member.wage,
      updatedAt: now,
    })),
  ];
  const transition = transitionForOutcome(state, {
    operationId: id,
    type: "coach_staff_package_hired",
    clubId,
    coachId,
    professionalIds: [coachId, ...staffIds],
    startedAt: now,
    status: "completed",
    metadata: {
      staffIds,
      estimatedFirstYearCost: estimatedTotal,
      staffFirstYearCost: quote.estimatedTotal,
      coachFirstYearCost,
      coachAppointed: Boolean(coachOutcome),
      availableFunds,
      memberCosts: quote.members.map((member) => ({
        staffId: member.input.staffId,
        wage: member.wage,
        signingBonus: member.signingBonus,
        buyout: member.buyout,
        firstYearCost: member.firstYearCost,
      })),
    },
  });
  appendTimeline(state, {
    operationId: id,
    lifecycleId: transition.id,
    type: "COACH_STAFF_PACKAGE_HIRED",
    professionalType: "coach",
    professionalId: coachId,
    role: "head_coach",
    clubId,
    occurredAt: now,
    initiatedBy: text(input.initiatedBy) || "club",
    financialImpact: bufferedTransactions
      .filter((transaction) => key(transaction?.clubId) === key(clubId))
      .reduce((sum, transaction) => (
        sum + (["income", "credit"].includes(
          text(transaction?.type ?? transaction?.direction).toLocaleLowerCase("en-US"),
        ) ? -integer(transaction.amount) : integer(transaction.amount))
      ), 0),
    relatedProfessionalIds: staffIds,
    metadata: {
      staffIds,
      contracts: contracts.map((contract) => contract?.id).filter(Boolean),
      coachContractId: coachOutcome?.contract?.id ?? activeCoachContract?.id ?? null,
      coachAppointmentId: coachOutcome?.appointment?.id ?? activeAppointment?.id ?? null,
      coachAppointed: Boolean(coachOutcome),
    },
  });
  markProcessed(state, id);
  state.currentDate = now;
  validateProfessionalLifecycleState(room, { normalize: false });
  // Publish effects only after coach, all staff, links and lifecycle audit pass.
  for (const transaction of bufferedCoachTransactions) {
    if (text(transaction?.type ?? transaction?.direction).toLocaleLowerCase("en-US") === "income") {
      options.credit?.(room, clone(transaction));
    } else {
      options.debit?.(room, clone(transaction));
    }
  }
  for (const event of bufferedCoachEvents) options.recordEvent?.(room, clone(event));
  for (const transaction of bufferedStaffTransactions) {
    options.postFinancialTransaction?.(room, clone(transaction));
  }
  for (const event of bufferedStaffEvents) options.recordCareerEvent?.(room, clone(event));
  return {
    room,
    coach: clone(coachOutcome?.coach ?? coach),
    coachContract: clone(coachOutcome?.contract ?? activeCoachContract),
    coachAppointment: clone(coachOutcome?.appointment ?? activeAppointment),
    coachAppointed: Boolean(coachOutcome),
    members: hired,
    contracts,
    financialTransactions: bufferedTransactions,
    events: bufferedEvents,
    transition: clone(transition),
    duplicate: false,
  };
}

/** Executes dated lifecycle effects exactly once. */
export function processProfessionalLifecycleDate(roomValue, asOf = new Date(), options = {}) {
  const now = currentDate(roomValue, asOf);
  let room = ensureProfessionalLifecycleState(roomValue, { now, config: options.config });
  let state = room.professionalLifecycleState;
  const processed = [];
  const outcomes = [];

  for (const agreement of [...state.mutualAgreements]) {
    if (["proposed", "countered"].includes(agreement.status)
      && agreement.expiresAt
      && new Date(agreement.expiresAt).getTime() <= new Date(now).getTime()) {
      const id = `professional-mutual-expire:${agreement.id}:${agreement.expiresAt}`;
      if (!state.processedOperationIds.includes(id)) {
        agreement.status = "expired";
        agreement.updatedAt = now;
        appendAgreementDecision(agreement, {
          action: "expire",
          actor: "system",
          previousStatus: "proposed",
          reason: "deadline_expired",
        }, now, id);
        appendTimeline(state, {
          operationId: id,
          lifecycleId: agreement.id,
          type: "PROFESSIONAL_MUTUAL_SEPARATION_EXPIRED",
          professionalType: agreement.professionalType,
          professionalId: agreement.professionalId,
          role: agreement.role,
          clubId: agreement.clubId,
          occurredAt: now,
          initiatedBy: "system",
          reason: "deadline_expired",
        });
        markProcessed(state, id);
        processed.push(id);
      }
    }
    if (agreement.status !== "signed"
      || new Date(agreement.departureDate).getTime() > new Date(now).getTime()) continue;
    const id = `professional-mutual-execute:${agreement.id}:${agreement.departureDate}`;
    if (state.processedOperationIds.includes(id)) continue;
    const executed = executeAgreementMutable(room, state, agreement, now, id, options);
    room = executed.room;
    state = executed.state;
    outcomes.push({ type: "mutual_agreement", record: clone(executed.agreement), outcome: clone(executed.outcome) });
    processed.push(id);
  }

  for (const retirement of [...state.retirements]) {
    if (retirement.status !== "scheduled"
      || new Date(retirement.effectiveAt).getTime() > new Date(now).getTime()) continue;
    const id = `professional-retirement-execute:${retirement.id}:${retirement.effectiveAt}`;
    if (state.processedOperationIds.includes(id)) continue;
    const executed = executeRetirementMutable(room, state, retirement, now, id, options);
    room = executed.room;
    state = executed.state;
    outcomes.push({ type: "retirement", record: clone(executed.retirement), outcome: clone(executed.outcome) });
    processed.push(id);
  }

  for (const notice of [...state.notices]) {
    if (notice.status !== "active"
      || new Date(notice.expectedEndDate).getTime() > new Date(now).getTime()) continue;
    const id = `professional-notice-complete:${notice.id}:${notice.expectedEndDate}`;
    if (state.processedOperationIds.includes(id)) continue;
    const contextStillActive = (() => {
      try {
        professionalContext(room, {
          professionalType: notice.professionalType,
          professionalId: notice.professionalId,
          clubId: notice.clubId,
        });
        return true;
      } catch {
        return false;
      }
    })();
    if (!contextStillActive) {
      const current = state.notices.find((candidate) => candidate.id === notice.id);
      current.status = "completed";
      current.endedAt = now;
      current.endReason = "link_already_closed";
      current.updatedAt = now;
      markProcessed(state, id);
      processed.push(id);
      continue;
    }
    const executed = finalizeNoticeMutable(room, state, notice, {
      reason: "notice_period_completed",
      force: true,
    }, now, id, options);
    room = executed.room;
    state = executed.state;
    outcomes.push({ type: "notice", record: clone(executed.notice), outcome: clone(executed.outcome) });
    processed.push(id);
  }

  state.currentDate = now;
  validateProfessionalLifecycleState(room, { normalize: false });
  return { room, outcomes, processedOperationIds: processed, duplicate: processed.length === 0 };
}

/** Full internal snapshot. Transport layers should still apply viewer privacy. */
export function professionalLifecycleSnapshot(roomValue, options = {}) {
  const room = ensureProfessionalLifecycleState(roomValue, options);
  const state = room.professionalLifecycleState;
  const type = professionalType(options);
  const id = professionalId(options);
  const clubId = text(options.clubId);
  const matches = (record) => (
    (!type || record.professionalType === type)
      && (!id || record.professionalId === id)
      && (!clubId || key(record.clubId) === key(clubId))
  );
  return clone({
    ...state,
    notices: state.notices.filter(matches),
    retirements: state.retirements.filter(matches),
    mutualAgreements: state.mutualAgreements.filter(matches),
    transitions: state.transitions.filter((transition) => (
      (!clubId || key(transition.clubId) === key(clubId))
        && (!id || transition.coachId === id || transition.professionalIds.includes(id))
    )),
    timeline: state.timeline.filter((entry) => (
      (!type || entry.professionalType === type)
        && (!id || entry.professionalId === id || entry.relatedProfessionalIds.includes(id))
        && (!clubId || key(entry.clubId) === key(clubId))
    )),
    preferredStaffByCoach: id && type === "coach"
      ? { [id]: state.preferredStaffByCoach[id] ?? [] }
      : state.preferredStaffByCoach,
    processedOperationIds: [],
  });
}

function assertUniqueIds(values, code) {
  const ids = values.map((value) => value.id);
  if (new Set(ids).size !== ids.length) {
    throw new ProfessionalLifecycleError("IDs duplicados", code, 500);
  }
}

/** Validates lifecycle invariants; can validate a raw state with normalize:false. */
export function validateProfessionalLifecycleState(roomValue, options = {}) {
  const room = options.normalize === false
    ? roomValue
    : ensureProfessionalLifecycleState(roomValue, options);
  const state = room?.professionalLifecycleState;
  if (!state || state.version !== STATE_VERSION) {
    throw new ProfessionalLifecycleError("Estado de ciclos invalido", "PROFESSIONAL_LIFECYCLE_VERSION_INVALID", 500);
  }
  for (const [field, values] of [
    ["notices", state.notices],
    ["retirements", state.retirements],
    ["mutualAgreements", state.mutualAgreements],
    ["transitions", state.transitions],
    ["timeline", state.timeline],
  ]) {
    if (!Array.isArray(values)) throw new ProfessionalLifecycleError(
      `Colecao ${field} invalida`,
      "PROFESSIONAL_LIFECYCLE_COLLECTION_INVALID",
      500,
    );
    assertUniqueIds(values, `PROFESSIONAL_${field.toLocaleUpperCase("en-US")}_DUPLICATE_ID`);
  }
  if (new Set(state.processedOperationIds).size !== state.processedOperationIds.length) {
    throw new ProfessionalLifecycleError(
      "Operacoes processadas duplicadas",
      "PROFESSIONAL_PROCESSED_OPERATION_DUPLICATE",
      500,
    );
  }
  const activeKey = (record) => `${record.professionalType}:${record.professionalId}`;
  for (const collection of [
    state.notices.filter((record) => record.status === "active"),
    state.retirements.filter((record) => record.status === "scheduled"),
    state.mutualAgreements.filter((record) => (
      ["proposed", "countered", "accepted", "awaiting_signatures", "signed"].includes(record.status)
    )),
  ]) {
    const keys = collection.map(activeKey);
    if (new Set(keys).size !== keys.length) throw new ProfessionalLifecycleError(
      "Profissional possui dois ciclos ativos do mesmo tipo",
      "PROFESSIONAL_MULTIPLE_ACTIVE_LIFECYCLES",
      500,
    );
  }
  for (const agreement of state.mutualAgreements) {
    if (agreement.status === "signed" || agreement.status === "executed") {
      if (!agreement.signatures.club || !agreement.signatures.professional) {
        throw new ProfessionalLifecycleError(
          "Acordo assinado sem ambas as assinaturas",
          "PROFESSIONAL_MUTUAL_SIGNATURE_INTEGRITY",
          500,
          { agreementId: agreement.id },
        );
      }
    }
  }
  for (const [coachId, entries] of Object.entries(state.preferredStaffByCoach ?? {})) {
    if (!text(coachId) || !Array.isArray(entries)) throw new ProfessionalLifecycleError(
      "Rede profissional invalida",
      "PROFESSIONAL_PREFERRED_STAFF_INVALID",
      500,
    );
    const staffIds = entries.map((entry) => entry.staffId);
    if (new Set(staffIds).size !== staffIds.length) throw new ProfessionalLifecycleError(
      "Profissional duplicado na rede do treinador",
      "PROFESSIONAL_PREFERRED_STAFF_DUPLICATE",
      500,
      { coachId },
    );
  }
  return true;
}
