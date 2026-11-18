// State shape, normalization, snapshot and validation of coach employment.
// Split from coachEmployment.mjs (audit Q-02); declarations are unchanged.
import { normalizeCoachJobSecurityState } from "../coachJobSecurity.mjs";
import { DEFAULT_COACH_SELECTION_WEIGHTS, buildDesiredCoachProfile, normalizeVacancyDesiredProfile } from "../coachCandidateScoring.mjs";
import { normalizeCoachConductConfig } from "../coachCareerConduct.mjs";
import { synchronizeCoachCareerHistory } from "../coachCareerHistory.mjs";

const COACH_EMPLOYMENT_VERSION = 6;

export const DAY_MS = 24 * 60 * 60 * 1_000;

export const MAX_MONEY = 2_000_000_000;

export const RETENTION = Object.freeze({
  contracts: 500,
  proposals: 300,
  vacancies: 200,
  applications: 300,
  interviews: 300,
  appointments: 500,
  evaluations: 300,
  guarantees: 500,
  notifications: 1_000,
  processedOperationIds: 1_000,
});

const COACH_STATUSES = new Set([
  "employed",
  "unemployed",
  "negotiating",
  "notice",
  "on_leave",
  "retiring",
  "dismissed",
  "resigned",
  "interim",
  "awaiting_start",
  "retired",
]);

const CONTRACT_STATUSES = new Set(["active", "scheduled", "expired", "terminated", "replaced", "cancelled"]);

const APPOINTMENT_STATUSES = new Set(["active", "scheduled", "ended", "activated", "cancelled"]);

const PROPOSAL_STATUSES = new Set([
  "pending",
  "aguardando_resposta_diretoria",
  "aprovada_diretoria",
  "informacoes_solicitadas",
  "encerrado_vaga_preenchida",
  "accepted",
  "rejected",
  "expired",
  "withdrawn",
]);

const VACANCY_STATUSES = new Set(["open", "filled", "expired", "cancelled"]);

const APPLICATION_STATUSES = new Set([
  "submitted", "shortlisted", "interview", "interview_completed", "offered", "accepted", "rejected", "withdrawn",
  "contratado", "encerrado_vaga_preenchida",
]);

const INTERVIEW_STATUSES = new Set([
  "pending", "completed", "accepted", "rejected", "expired",
  "contratado", "encerrado_vaga_preenchida",
]);

const INTERVIEW_MODES = new Set(["legacy", "generative", "fallback"]);

export const INTERVIEW_DEPTHS = new Set(["quick", "standard", "deep"]);

const INTERVIEW_SOURCES = new Set(["gemini", "fallback", "legacy"]);

const INTERVIEW_RECOMMENDATIONS = new Set([
  "hire", "hire_with_reservations", "negotiate", "observe", "reject",
]);

export const INTERVIEW_METRIC_KEYS = Object.freeze([
  "boardConfidence",
  "clubCompatibility",
  "squadCompatibility",
  "leadership",
  "tacticalVision",
  "financialAlignment",
  "longTermPotential",
  "culturalFit",
  "credibility",
  "perceivedRisk",
]);

export const GUARANTEE_STATUSES = new Set([
  "requested", "formalized", "fulfilled", "overdue", "breached", "waived",
]);

export const ACTIVE_PROPOSAL_STATUSES = new Set([
  "pending", "aguardando_resposta_diretoria", "aprovada_diretoria", "informacoes_solicitadas",
]);

export const PROPOSAL_KINDS = new Set(["hiring", "renewal", "precontract"]);

const MARKET_STAGES = new Set([
  "interest",
  "interview",
  "coach_review",
  "club_review",
  "agreement",
  "completed",
  "closed",
]);

const DEFAULT_MARKET_CONFIG = Object.freeze({
  shortlistSize: 3,
  simultaneousOffersPerVacancy: 2,
  searchDelayDays: 2,
  interviewChance: 55,
  interviewDelayDays: 1,
  coachResponseDelayDays: 2,
  boardResponseDelayDays: 2,
  proposalValidityDays: 10,
  maxNegotiationRounds: 4,
  acceptanceScore: 64,
  counterScore: 46,
  renewalWindowDays: 120,
  preContractWindowDays: 180,
  renewalMinimumScore: 60,
  minimumCandidateScore: 35,
  selectionWeights: DEFAULT_COACH_SELECTION_WEIGHTS,
});

export class CoachEmploymentError extends Error {
  constructor(message, code, status = 400, details = undefined) {
    super(message);
    this.name = "CoachEmploymentError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function identifier(value) {
  return String(value ?? "").trim();
}

export function clubKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

export function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(number)))
    : fallback;
}

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizedMarketConfig(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    shortlistSize: integer(source.shortlistSize, DEFAULT_MARKET_CONFIG.shortlistSize, 1, 8),
    simultaneousOffersPerVacancy: integer(
      source.simultaneousOffersPerVacancy,
      DEFAULT_MARKET_CONFIG.simultaneousOffersPerVacancy,
      1,
      5,
    ),
    searchDelayDays: integer(source.searchDelayDays, DEFAULT_MARKET_CONFIG.searchDelayDays, 0, 30),
    interviewChance: integer(source.interviewChance, DEFAULT_MARKET_CONFIG.interviewChance, 0, 100),
    interviewDelayDays: integer(source.interviewDelayDays, DEFAULT_MARKET_CONFIG.interviewDelayDays, 0, 14),
    coachResponseDelayDays: integer(
      source.coachResponseDelayDays,
      DEFAULT_MARKET_CONFIG.coachResponseDelayDays,
      0,
      30,
    ),
    boardResponseDelayDays: integer(
      source.boardResponseDelayDays,
      DEFAULT_MARKET_CONFIG.boardResponseDelayDays,
      0,
      30,
    ),
    proposalValidityDays: integer(source.proposalValidityDays, DEFAULT_MARKET_CONFIG.proposalValidityDays, 2, 45),
    maxNegotiationRounds: integer(source.maxNegotiationRounds, DEFAULT_MARKET_CONFIG.maxNegotiationRounds, 1, 10),
    acceptanceScore: integer(source.acceptanceScore, DEFAULT_MARKET_CONFIG.acceptanceScore, 35, 95),
    counterScore: integer(source.counterScore, DEFAULT_MARKET_CONFIG.counterScore, 20, 90),
    renewalWindowDays: integer(source.renewalWindowDays, DEFAULT_MARKET_CONFIG.renewalWindowDays, 14, 365),
    preContractWindowDays: integer(source.preContractWindowDays, DEFAULT_MARKET_CONFIG.preContractWindowDays, 30, 365),
    renewalMinimumScore: integer(source.renewalMinimumScore, DEFAULT_MARKET_CONFIG.renewalMinimumScore, 35, 95),
    minimumCandidateScore: integer(
      source.minimumCandidateScore,
      DEFAULT_MARKET_CONFIG.minimumCandidateScore,
      0,
      100,
    ),
    selectionWeights: normalizeVacancyDesiredProfile({
      weights: source.selectionWeights ?? DEFAULT_MARKET_CONFIG.selectionWeights,
    }).weights,
  };
}

export function timestamp(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new CoachEmploymentError("Data invalida", "COACH_DATE_INVALID", 400);
  }
  return date.toISOString();
}

export function nullableTimestamp(value) {
  if (value == null || value === "") return null;
  return timestamp(value);
}

export function addDays(value, days) {
  return new Date(new Date(timestamp(value)).getTime() + integer(days, 0) * DAY_MS).toISOString();
}

function addYears(value, years) {
  const date = new Date(timestamp(value));
  date.setUTCFullYear(date.getUTCFullYear() + integer(years, 1, 1, 10));
  return date.toISOString();
}

export function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deterministicId(prefix, seed) {
  return `${prefix}-${hashText(seed).toString(36)}`;
}

export function operationId(input) {
  const id = identifier(input?.operationId ?? input?.requestId);
  if (!id) {
    throw new CoachEmploymentError("Operacao exige operationId", "COACH_OPERATION_ID_REQUIRED", 400);
  }
  return id;
}

export function careerDate(room, supplied) {
  return timestamp(
    supplied
      ?? room?.clubCareerState?.currentDate
      ?? room?.seasonStartedAt
      ?? room?.startedAt
      ?? room?.createdAt
      ?? new Date(),
  );
}

export function seasonNumber(room) {
  return integer(room?.currentSeason, 1, 1);
}

export function completedRound(room) {
  const direct = integer(room?.lastCompletedRound?.round, -1, -1);
  if (direct >= 0) return direct;
  return (Array.isArray(room?.leagueMatchResults) ? room.leagueMatchResults : []).reduce((maximum, result) => {
    const fixture = (room?.leagueFixtureSchedule ?? []).find((candidate) => (
      identifier(candidate?.leagueFixtureId) === identifier(result?.leagueFixtureId)
    ));
    return Math.max(maximum, integer(fixture?.round, 0));
  }, 0);
}

export function normalizedObjectives(value) {
  return (Array.isArray(value) ? value : []).slice(0, 20).map((objective, index) => {
    if (typeof objective === "string") {
      return { id: `objective-${index + 1}`, title: identifier(objective), target: null, status: "active" };
    }
    return {
      ...(objective && typeof objective === "object" ? clone(objective) : {}),
      id: identifier(objective?.id) || `objective-${index + 1}`,
      title: identifier(objective?.title ?? objective?.name) || `Objetivo ${index + 1}`,
      target: Number.isFinite(Number(objective?.target)) ? Number(objective.target) : null,
      status: identifier(objective?.status) || "active",
    };
  });
}

function normalizeDecisionHistory(value) {
  return (Array.isArray(value) ? value : []).slice(-100).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    return [{
      ...clone(entry),
      id: identifier(entry.id) || deterministicId("coach-decision", `${entry.operationId ?? "legacy"}|${index}`),
      action: identifier(entry.action) || "status_change",
      responsibleId: identifier(entry.responsibleId ?? entry.actorId) || "system",
      responsibleRole: identifier(entry.responsibleRole ?? entry.actorRole) || "system",
      decidedAt: nullableTimestamp(entry.decidedAt ?? entry.occurredAt ?? entry.createdAt),
      justification: identifier(entry.justification ?? entry.reason) || null,
      previousStatus: identifier(entry.previousStatus) || null,
      newStatus: identifier(entry.newStatus) || null,
      negotiatedValues: entry.negotiatedValues && typeof entry.negotiatedValues === "object"
        ? clone(entry.negotiatedValues)
        : {},
      conditions: Array.isArray(entry.conditions) ? clone(entry.conditions).slice(0, 30) : [],
      operationId: identifier(entry.operationId) || null,
    }];
  });
}

export function normalizeGuarantee(value) {
  if (!value || typeof value !== "object") return null;
  const proposalId = identifier(value.proposalId);
  const coachId = identifier(value.coachId);
  const description = identifier(value.description ?? value.text ?? value.label);
  if (!proposalId || !coachId || !description) return null;
  const status = GUARANTEE_STATUSES.has(value.status) ? value.status : "requested";
  const effects = Array.isArray(value.effects)
    ? value.effects.filter((effect) => effect && typeof effect === "object").map(clone).slice(0, 20)
    : value.effects && typeof value.effects === "object" ? [clone(value.effects)] : [];
  const history = normalizeDecisionHistory(value.history ?? value.decisionHistory);
  return {
    ...clone(value),
    id: identifier(value.id) || deterministicId("coach-guarantee", `${proposalId}|${description}`),
    proposalId,
    vacancyId: identifier(value.vacancyId) || null,
    applicationId: identifier(value.applicationId) || null,
    coachId,
    clubId: identifier(value.clubId) || null,
    description,
    responsibleId: identifier(value.responsibleId) || "board",
    responsibleRole: identifier(value.responsibleRole) || "board",
    dueAt: nullableTimestamp(value.dueAt),
    status,
    mandatory: value.mandatory !== false,
    blocksCompletion: value.blocksCompletion !== false,
    effects,
    createdAt: nullableTimestamp(value.createdAt),
    updatedAt: nullableTimestamp(value.updatedAt ?? value.createdAt),
    formalizedAt: nullableTimestamp(value.formalizedAt),
    completedAt: nullableTimestamp(value.completedAt),
    history,
    decisionHistory: clone(history),
    operationId: identifier(value.operationId) || null,
  };
}

export function normalizeNotification(value) {
  if (!value || typeof value !== "object") return null;
  const type = identifier(value.type);
  if (!type) return null;
  return {
    ...clone(value),
    id: identifier(value.id) || deterministicId("coach-notification", `${type}|${value.operationId ?? value.createdAt ?? "legacy"}`),
    type,
    recipientId: identifier(value.recipientId) || null,
    recipientRole: identifier(value.recipientRole) || "coach",
    coachId: identifier(value.coachId) || null,
    clubId: identifier(value.clubId) || null,
    proposalId: identifier(value.proposalId) || null,
    vacancyId: identifier(value.vacancyId) || null,
    applicationId: identifier(value.applicationId) || null,
    guaranteeId: identifier(value.guaranteeId) || null,
    title: identifier(value.title) || "Atualizacao da carreira",
    message: identifier(value.message) || "Ha uma nova atualizacao.",
    createdAt: nullableTimestamp(value.createdAt),
    readAt: nullableTimestamp(value.readAt),
    operationId: identifier(value.operationId) || null,
  };
}

function normalizeAssignment(value) {
  const clubId = identifier(value?.clubId);
  if (!clubId) return null;
  return {
    ...(value && typeof value === "object" ? clone(value) : {}),
    clubId,
    startedSeason: integer(value?.startedSeason, 1, 1),
    startedRound: integer(value?.startedRound, 1, 1),
    startedAt: nullableTimestamp(value?.startedAt),
    endedSeason: value?.endedSeason == null ? null : integer(value.endedSeason, 1, 1),
    endedRound: value?.endedRound == null ? null : integer(value.endedRound, 0, 0),
    endedAt: nullableTimestamp(value?.endedAt),
    role: identifier(value?.role) || "head_coach",
    entryReason: identifier(value?.entryReason ?? value?.reason) || null,
    exitReason: identifier(value?.exitReason) || null,
    proposalId: identifier(value?.proposalId) || null,
    vacancyId: identifier(value?.vacancyId) || null,
    applicationId: identifier(value?.applicationId) || null,
  };
}

function normalizeCoachRestriction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const startsAt = nullableTimestamp(value.startsAt ?? value.startedAt);
  const endsAt = nullableTimestamp(value.endsAt ?? value.blockedUntil);
  if (!endsAt) return null;
  return {
    type: "voluntary_resignation",
    startsAt,
    endsAt,
    reasonCode: identifier(value.reasonCode) || "coach_resignation",
    reasonLabel: identifier(value.reasonLabel) || "Pedido de demissao",
    justCauseVerified: Boolean(value.justCauseVerified),
    signingBlocked: value.signingBlocked !== false,
    inactivityDays: integer(value.inactivityDays, 0, 0, 730),
    reputationDelta: integer(value.reputationDelta, 0, -100, 0),
    trustDelta: integer(value.trustDelta, 0, -100, 0),
    operationId: identifier(value.operationId) || null,
    completedAt: nullableTimestamp(value.completedAt),
  };
}

export function normalizeCoachAuditEntries(values, maximum = 300) {
  return (Array.isArray(values) ? values : []).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const occurredAt = nullableTimestamp(entry.occurredAt ?? entry.createdAt);
    return [{
      ...clone(entry),
      id: identifier(entry.id) || deterministicId("coach-audit", `${entry.type ?? "event"}|${occurredAt ?? index}`),
      type: identifier(entry.type) || "career_event",
      occurredAt,
      clubId: identifier(entry.clubId) || null,
      reasonCode: identifier(entry.reasonCode) || null,
      reasonLabel: identifier(entry.reasonLabel) || null,
      reputationDelta: integer(entry.reputationDelta, 0, -100, 100),
      reputationBefore: entry.reputationBefore == null ? null : clamp(finite(entry.reputationBefore), 0, 100),
      reputationAfter: entry.reputationAfter == null ? null : clamp(finite(entry.reputationAfter), 0, 100),
      trustDelta: integer(entry.trustDelta, 0, -100, 100),
      restrictionEndsAt: nullableTimestamp(entry.restrictionEndsAt),
      operationId: identifier(entry.operationId) || null,
    }];
  }).slice(-maximum);
}

export function normalizeCoachInterviewMemories(values, maximum = 100) {
  return (Array.isArray(values) ? values : []).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const interviewId = identifier(entry.interviewId);
    const clubId = identifier(entry.clubId);
    if (!interviewId || !clubId) return [];
    const occurredAt = nullableTimestamp(entry.occurredAt ?? entry.createdAt);
    return [{
      ...clone(entry),
      id: identifier(entry.id) || deterministicId("coach-interview-memory", `${interviewId}|${index}`),
      interviewId,
      clubId,
      summary: limitedInterviewText(entry.summary, 2_000) || null,
      commitments: (Array.isArray(entry.commitments) ? entry.commitments : [])
        .map((item) => limitedInterviewText(item?.title ?? item, 240)).filter(Boolean).slice(0, 20),
      contradictions: (Array.isArray(entry.contradictions) ? entry.contradictions : [])
        .map((item) => limitedInterviewText(item, 240)).filter(Boolean).slice(0, 20),
      questions: (Array.isArray(entry.questions) ? entry.questions : [])
        .map((item) => limitedInterviewText(item?.text ?? item?.prompt ?? item, 500)).filter(Boolean).slice(0, 40),
      evaluation: normalizeInterviewEvaluation(entry.evaluation, occurredAt),
      recommendation: INTERVIEW_RECOMMENDATIONS.has(identifier(entry.recommendation))
        ? identifier(entry.recommendation)
        : null,
      occurredAt,
      operationId: identifier(entry.operationId) || null,
    }];
  }).slice(-maximum);
}

function normalizeCoach(value) {
  const id = identifier(value?.id ?? value?.coachId ?? value?.managerId);
  if (!id) return null;
  const currentClubId = identifier(value?.currentClubId ?? value?.clubId) || null;
  const status = COACH_STATUSES.has(value?.status)
    ? value.status
    : currentClubId ? "employed" : "unemployed";
  const assignments = (Array.isArray(value?.assignments) ? value.assignments : [])
    .map(normalizeAssignment)
    .filter(Boolean);
  const uniqueAssignments = [...new Map(assignments.map((assignment) => [
    [
      clubKey(assignment.clubId),
      assignment.startedSeason,
      assignment.startedRound,
      assignment.startedAt ?? "",
    ].join("|"),
    assignment,
  ])).values()];
  return {
    ...(value && typeof value === "object" ? clone(value) : {}),
    id,
    name: identifier(value?.name ?? value?.fullName) || id,
    managerType: value?.managerType === "human" ? "human" : "ai",
    status,
    currentClubId,
    // Passagens fazem parte do livro-caixa permanente da carreira.
    assignments: uniqueAssignments,
    professionalTrust: clamp(finite(value?.professionalTrust, 80), 0, 100),
    marketRestriction: normalizeCoachRestriction(value?.marketRestriction),
    resignationHistory: normalizeCoachAuditEntries(value?.resignationHistory, 100),
    reputationHistory: normalizeCoachAuditEntries(value?.reputationHistory, 300),
    careerConductHistory: normalizeCoachAuditEntries(value?.careerConductHistory, 500),
    interviewMemories: normalizeCoachInterviewMemories(value?.interviewMemories, 100),
  };
}

function normalizeContract(value) {
  const coachId = identifier(value?.coachId);
  const clubId = identifier(value?.clubId);
  if (!coachId || !clubId) return null;
  const status = CONTRACT_STATUSES.has(value?.status) ? value.status : "active";
  return {
    ...(value && typeof value === "object" ? clone(value) : {}),
    id: identifier(value?.id) || deterministicId("coach-contract", `${coachId}|${clubId}|${value?.startDate ?? "legacy"}`),
    coachId,
    clubId,
    role: value?.role === "interim" ? "interim" : "head_coach",
    signedAt: nullableTimestamp(value?.signedAt ?? value?.startDate),
    startDate: nullableTimestamp(value?.startDate),
    endDate: nullableTimestamp(value?.endDate),
    wage: integer(value?.wage ?? value?.salary, 0, 0, 20_000_000),
    terminationClause: integer(value?.terminationClause ?? value?.releaseClause, 0, 0, MAX_MONEY),
    signingBonus: integer(value?.signingBonus, 0, 0, MAX_MONEY),
    compensation: integer(value?.compensation, 0, 0, MAX_MONEY),
    transferBudgetCommitment: value?.transferBudgetCommitment == null
      ? null
      : integer(value.transferBudgetCommitment, 0, 0, MAX_MONEY),
    autonomyLevel: Math.round(clamp(finite(value?.autonomyLevel, 50), 0, 100) * 10) / 10,
    objectiveDifficultyAdjustment: Math.round(clamp(finite(value?.objectiveDifficultyAdjustment), -15, 15) * 10) / 10,
    sourceInterviewId: identifier(value?.sourceInterviewId ?? value?.interviewId) || null,
    bonuses: value?.bonuses && typeof value.bonuses === "object" ? clone(value.bonuses) : {},
    guaranteeIds: Array.isArray(value?.guaranteeIds) ? value.guaranteeIds.map(identifier).filter(Boolean).slice(0, 50) : [],
    clauses: Array.isArray(value?.clauses) ? clone(value.clauses).slice(0, 50) : [],
    staffPackageCommitments: (Array.isArray(value?.staffPackageCommitments)
      ? value.staffPackageCommitments
      : []).filter((entry) => entry && typeof entry === "object").map(clone).slice(0, 20),
    objectives: normalizedObjectives(value?.objectives),
    renewalOption: Boolean(value?.renewalOption),
    renewalCount: integer(value?.renewalCount, 0, 0, 50),
    status,
    endedAt: nullableTimestamp(value?.endedAt),
    endReason: identifier(value?.endReason) || null,
    lifecycleStatus: ["standard", "notice", "retirement_pending", "mutual_agreement_pending"]
      .includes(identifier(value?.lifecycleStatus))
      ? identifier(value.lifecycleStatus)
      : "standard",
    noticeId: identifier(value?.noticeId) || null,
    retirementId: identifier(value?.retirementId) || null,
    mutualAgreementId: identifier(value?.mutualAgreementId) || null,
    operationId: identifier(value?.operationId) || null,
  };
}

export function normalizeAppointmentStatistics(value) {
  const source = value && typeof value === "object" ? value : {};
  const games = integer(source.games, 0, 0);
  const points = integer(source.points, 0, 0);
  const wins = integer(source.wins, 0, 0);
  const draws = integer(source.draws, 0, 0);
  const losses = integer(source.losses, 0, 0);
  return {
    games,
    points,
    wins,
    draws,
    losses,
    goalsFor: integer(source.goalsFor, 0, 0),
    goalsAgainst: integer(source.goalsAgainst, 0, 0),
    pointsPerGame: games > 0
      ? Math.round(clamp(finite(source.pointsPerGame, points / games), 0, 3) * 100) / 100
      : 0,
    updatedAt: nullableTimestamp(source.updatedAt),
  };
}

function normalizeAppointment(value) {
  const coachId = identifier(value?.coachId);
  const clubId = identifier(value?.clubId);
  if (!coachId || !clubId) return null;
  return {
    ...(value && typeof value === "object" ? clone(value) : {}),
    id: identifier(value?.id) || deterministicId("coach-appointment", `${coachId}|${clubId}|${value?.startedAt ?? "legacy"}`),
    coachId,
    clubId,
    contractId: identifier(value?.contractId) || null,
    role: value?.role === "interim" ? "interim" : "head_coach",
    status: APPOINTMENT_STATUSES.has(value?.status) ? value.status : "active",
    appointedAt: nullableTimestamp(value?.appointedAt ?? value?.startedAt),
    startedAt: nullableTimestamp(value?.startedAt),
    expectedStartAt: nullableTimestamp(value?.expectedStartAt),
    endedAt: nullableTimestamp(value?.endedAt),
    startedSeason: integer(value?.startedSeason, 1, 1),
    startedRound: integer(value?.startedRound, 1, 1),
    endedSeason: value?.endedSeason == null ? null : integer(value.endedSeason, 1, 1),
    endedRound: value?.endedRound == null ? null : integer(value.endedRound, 0, 0),
    entryReason: identifier(value?.entryReason) || "appointed",
    exitReason: identifier(value?.exitReason) || null,
    expectedEndAt: nullableTimestamp(value?.expectedEndAt),
    initialExpectedEndAt: nullableTimestamp(value?.initialExpectedEndAt ?? value?.expectedEndAt),
    temporaryWageBonus: integer(value?.temporaryWageBonus, 0, 0, MAX_MONEY),
    temporaryBonusPaidAt: nullableTimestamp(value?.temporaryBonusPaidAt),
    temporaryBonusTransactionId: identifier(value?.temporaryBonusTransactionId) || null,
    authorityLevel: Math.round(clamp(finite(value?.authorityLevel, value?.role === "interim" ? 55 : 100), 0, 100)),
    canBeConfirmed: value?.canBeConfirmed !== false,
    sourceStaffId: identifier(value?.sourceStaffId) || null,
    selectionScore: value?.selectionScore == null ? null : Math.round(clamp(finite(value.selectionScore), 0, 100) * 10) / 10,
    selectionReason: identifier(value?.selectionReason) || null,
    statistics: normalizeAppointmentStatistics(value?.statistics),
    extensionCount: integer(value?.extensionCount, 0, 0, 100),
    extensionHistory: (Array.isArray(value?.extensionHistory) ? value.extensionHistory : [])
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        operationId: identifier(entry.operationId) || null,
        previousExpectedEndAt: nullableTimestamp(entry.previousExpectedEndAt),
        expectedEndAt: nullableTimestamp(entry.expectedEndAt),
        extendedAt: nullableTimestamp(entry.extendedAt),
        reason: identifier(entry.reason) || "vacancy_still_open",
      }))
      .slice(-100),
    confirmedAt: nullableTimestamp(value?.confirmedAt),
    confirmedAppointmentId: identifier(value?.confirmedAppointmentId) || null,
    proposalId: identifier(value?.proposalId) || null,
    vacancyId: identifier(value?.vacancyId) || null,
    applicationId: identifier(value?.applicationId) || null,
    operationId: identifier(value?.operationId) || null,
  };
}

export function normalizeProposal(value) {
  const coachId = identifier(value?.coachId);
  const clubId = identifier(value?.clubId ?? value?.offeringClubId);
  if (!coachId || !clubId) return null;
  const legacyCounter = value?.status === "countered";
  const status = legacyCounter
    ? "aguardando_resposta_diretoria"
    : PROPOSAL_STATUSES.has(value?.status) ? value.status : "pending";
  const kindValue = identifier(value?.kind ?? value?.proposalType).toLocaleLowerCase("pt-BR");
  const kind = PROPOSAL_KINDS.has(kindValue)
    ? kindValue
    : identifier(value?.sourceContractId ?? value?.renewalOfContractId) ? "renewal" : "hiring";
  const defaultMarketStage = ["accepted"].includes(status)
    ? "completed"
    : ["rejected", "expired", "withdrawn", "encerrado_vaga_preenchida"].includes(status)
      ? "closed"
      : ["aguardando_resposta_diretoria", "informacoes_solicitadas"].includes(status)
        ? "club_review"
        : "coach_review";
  const objectiveDifficultyDelta = Math.round(clamp(finite(value?.objectiveDifficultyDelta), -15, 15) * 10) / 10;
  const objectives = normalizedObjectives(value?.objectives).map((objective) => ({
    ...objective,
    difficultyAdjustment: Number.isFinite(Number(objective.difficultyAdjustment))
      ? clamp(Number(objective.difficultyAdjustment), -15, 15)
      : objectiveDifficultyDelta,
  }));
  const pendingCounterproposal = value?.pendingCounterproposal && typeof value.pendingCounterproposal === "object"
    ? {
      ...clone(value.pendingCounterproposal),
      wage: integer(value.pendingCounterproposal.wage, integer(value?.wage ?? value?.salary, 0), 0, 20_000_000),
      durationYears: integer(value.pendingCounterproposal.durationYears, integer(value?.durationYears ?? value?.years, 2), 1, 10),
      terminationClause: integer(value.pendingCounterproposal.terminationClause, integer(value?.terminationClause, 0), 0, MAX_MONEY),
      signingBonus: integer(value.pendingCounterproposal.signingBonus, integer(value?.signingBonus, 0), 0, MAX_MONEY),
      transferBudget: value.pendingCounterproposal.transferBudget == null
        ? value?.transferBudget == null ? null : integer(value.transferBudget, 0, 0, MAX_MONEY)
        : integer(value.pendingCounterproposal.transferBudget, 0, 0, MAX_MONEY),
      objectives: normalizedObjectives(value.pendingCounterproposal.objectives ?? value?.objectives),
      specialClauses: (Array.isArray(value.pendingCounterproposal.specialClauses)
        ? value.pendingCounterproposal.specialClauses
        : Array.isArray(value?.specialClauses) ? value.specialClauses : [])
        .map(identifier).filter(Boolean).slice(0, 20),
      guaranteeIds: Array.isArray(value.pendingCounterproposal.guaranteeIds)
        ? value.pendingCounterproposal.guaranteeIds.map(identifier).filter(Boolean).slice(0, 50)
        : [],
      submittedAt: nullableTimestamp(value.pendingCounterproposal.submittedAt ?? value?.updatedAt),
      operationId: identifier(value.pendingCounterproposal.operationId) || null,
    }
    : legacyCounter ? {
      wage: integer(value?.wage ?? value?.salary, 0, 0, 20_000_000),
      durationYears: integer(value?.durationYears ?? value?.years, 2, 1, 10),
      terminationClause: integer(value?.terminationClause, 0, 0, MAX_MONEY),
      signingBonus: integer(value?.signingBonus, 0, 0, MAX_MONEY),
      guaranteeIds: [],
      submittedAt: nullableTimestamp(value?.updatedAt ?? value?.createdAt),
      operationId: identifier(value?.operationId) || null,
      migratedLegacyCounter: true,
    } : null;
  return {
    ...(value && typeof value === "object" ? clone(value) : {}),
    id: identifier(value?.id) || deterministicId("coach-proposal", `${coachId}|${clubId}|${value?.createdAt ?? "legacy"}`),
    coachId,
    clubId,
    offeringClubId: clubId,
    vacancyId: identifier(value?.vacancyId) || null,
    applicationId: identifier(value?.applicationId) || null,
    interviewId: identifier(value?.interviewId) || null,
    kind,
    sourceContractId: identifier(value?.sourceContractId ?? value?.renewalOfContractId) || null,
    role: value?.role === "interim" ? "interim" : "head_coach",
    wage: integer(value?.wage ?? value?.salary, 0, 0, 20_000_000),
    durationYears: integer(value?.durationYears ?? value?.years, 2, 1, 10),
    terminationClause: integer(value?.terminationClause, 0, 0, MAX_MONEY),
    signingBonus: integer(value?.signingBonus, 0, 0, MAX_MONEY),
    compensation: integer(value?.compensation, 0, 0, MAX_MONEY),
    transferBudget: value?.transferBudget == null ? null : integer(value.transferBudget, 0, 0, MAX_MONEY),
    specialClauses: (Array.isArray(value?.specialClauses ?? value?.clauses)
      ? value.specialClauses ?? value.clauses
      : []).map(identifier).filter(Boolean).slice(0, 20),
    objectives,
    guaranteeIds: Array.isArray(value?.guaranteeIds) ? value.guaranteeIds.map(identifier).filter(Boolean).slice(0, 50) : [],
    status,
    marketStage: MARKET_STAGES.has(value?.marketStage) ? value.marketStage : defaultMarketStage,
    nextActionAt: nullableTimestamp(value?.nextActionAt),
    lastActionAt: nullableTimestamp(value?.lastActionAt ?? value?.updatedAt ?? value?.createdAt),
    maxNegotiationRounds: integer(value?.maxNegotiationRounds, DEFAULT_MARKET_CONFIG.maxNegotiationRounds, 1, 10),
    interviewCompatibility: value?.interviewCompatibility == null
      ? null
      : clamp(finite(value.interviewCompatibility), 0, 100),
    autonomyDelta: Math.round(clamp(finite(value?.autonomyDelta), -20, 20) * 10) / 10,
    priorityDelta: Math.round(clamp(finite(value?.priorityDelta), -25, 25) * 10) / 10,
    objectiveDifficultyDelta,
    decisionScore: value?.decisionScore == null ? null : clamp(finite(value.decisionScore), 0, 100),
    decisionReason: identifier(value?.decisionReason) || null,
    decisionFactors: (Array.isArray(value?.decisionFactors) ? value.decisionFactors : []).slice(0, 30).map((factor, index) => ({
      id: identifier(factor?.id) || `factor-${index + 1}`,
      code: identifier(factor?.code) || "general",
      label: identifier(factor?.label) || identifier(factor?.code) || "Fator",
      value: finite(factor?.value ?? factor?.impact, 0),
      detail: identifier(factor?.detail) || null,
    })),
    competingProposalIds: (Array.isArray(value?.competingProposalIds) ? value.competingProposalIds : [])
      .map(identifier)
      .filter(Boolean)
      .slice(0, 30),
    bonuses: value?.bonuses && typeof value.bonuses === "object" && !Array.isArray(value.bonuses)
      ? clone(value.bonuses)
      : {},
    availableBudget: value?.availableBudget == null ? null : integer(value.availableBudget, 0, 0, MAX_MONEY),
    boardExpectation: identifier(value?.boardExpectation) || null,
    clubSituation: identifier(value?.clubSituation) || null,
    message: identifier(value?.message) || null,
    createdAt: nullableTimestamp(value?.createdAt),
    updatedAt: nullableTimestamp(value?.updatedAt ?? value?.createdAt),
    expiresAt: nullableTimestamp(value?.expiresAt),
    plannedStartDate: nullableTimestamp(value?.plannedStartDate ?? value?.startDate),
    respondedAt: nullableTimestamp(value?.respondedAt),
    responseReason: identifier(value?.responseReason) || null,
    negotiationRound: integer(value?.negotiationRound, 0, 0, 10),
    pendingCounterproposal,
    informationRequest: value?.informationRequest && typeof value.informationRequest === "object"
      ? {
        ...clone(value.informationRequest),
        prompt: identifier(value.informationRequest.prompt ?? value.informationRequest.message) || null,
        requestedAt: nullableTimestamp(value.informationRequest.requestedAt),
        answeredAt: nullableTimestamp(value.informationRequest.answeredAt),
        answer: identifier(value.informationRequest.answer) || null,
      }
      : null,
    decisionHistory: normalizeDecisionHistory(value?.decisionHistory),
    closedAt: nullableTimestamp(value?.closedAt),
    closedReason: identifier(value?.closedReason) || null,
    closedBy: identifier(value?.closedBy) || null,
    operationId: identifier(value?.operationId) || null,
  };
}

function normalizeVacancy(value) {
  const clubId = identifier(value?.clubId);
  if (!clubId) return null;
  const desiredProfileSource = value?.desiredProfile;
  const hasDesiredProfile = desiredProfileSource
    && typeof desiredProfileSource === "object"
    && !Array.isArray(desiredProfileSource)
    && Object.keys(desiredProfileSource).length > 0;
  return {
    ...(value && typeof value === "object" ? clone(value) : {}),
    id: identifier(value?.id) || deterministicId("coach-vacancy", `${clubId}|${value?.openedAt ?? "legacy"}`),
    clubId,
    competitionId: identifier(value?.competitionId) || null,
    status: VACANCY_STATUSES.has(value?.status) ? value.status : "open",
    reason: identifier(value?.reason) || "coach_departure",
    openedAt: nullableTimestamp(value?.openedAt),
    closesAt: nullableTimestamp(value?.closesAt),
    filledAt: nullableTimestamp(value?.filledAt),
    interimCoachId: identifier(value?.interimCoachId) || null,
    appointedCoachId: identifier(value?.appointedCoachId) || null,
    filledProposalId: identifier(value?.filledProposalId) || null,
    filledApplicationId: identifier(value?.filledApplicationId) || null,
    closureOperationId: identifier(value?.closureOperationId) || null,
    marketStage: MARKET_STAGES.has(value?.marketStage) ? value.marketStage : "interest",
    searchStartedAt: nullableTimestamp(value?.searchStartedAt ?? value?.openedAt),
    lastMarketActionAt: nullableTimestamp(value?.lastMarketActionAt),
    shortlistCoachIds: (Array.isArray(value?.shortlistCoachIds) ? value.shortlistCoachIds : [])
      .map(identifier)
      .filter(Boolean)
      .slice(0, 20),
    desiredProfile: hasDesiredProfile
      ? normalizeVacancyDesiredProfile(desiredProfileSource)
      : null,
    operationId: identifier(value?.operationId) || null,
  };
}

export function normalizeApplication(value) {
  const coachId = identifier(value?.coachId);
  const clubId = identifier(value?.clubId);
  const vacancyId = identifier(value?.vacancyId);
  if (!coachId || !clubId || !vacancyId) return null;
  return {
    ...(value && typeof value === "object" ? clone(value) : {}),
    id: identifier(value?.id) || deterministicId("coach-application", `${vacancyId}|${coachId}`),
    vacancyId,
    clubId,
    coachId,
    status: APPLICATION_STATUSES.has(value?.status) ? value.status : "submitted",
    submittedAt: nullableTimestamp(value?.submittedAt),
    updatedAt: nullableTimestamp(value?.updatedAt ?? value?.submittedAt),
    interestScore: clamp(finite(value?.interestScore, 50), 0, 100),
    shortlistScore: clamp(finite(value?.shortlistScore ?? value?.interestScore, 50), 0, 100),
    candidateAssessment: value?.candidateAssessment && typeof value.candidateAssessment === "object"
      ? clone(value.candidateAssessment)
      : null,
    responseReason: identifier(value?.responseReason) || null,
    closedAt: nullableTimestamp(value?.closedAt),
    closedReason: identifier(value?.closedReason) || null,
    closedBy: identifier(value?.closedBy) || null,
    decisionHistory: normalizeDecisionHistory(value?.decisionHistory),
    operationId: identifier(value?.operationId) || null,
  };
}

export function limitedInterviewText(value, maximum = 1_200) {
  return identifier(value).slice(0, maximum);
}

export function interviewDepthLimits(depth) {
  if (depth === "quick") return { minimum: 2, maximum: 4 };
  if (depth === "deep") return { minimum: 4, maximum: 12 };
  return { minimum: 3, maximum: 8 };
}

export function normalizeInterviewMetrics(value, fallback = 50) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(INTERVIEW_METRIC_KEYS.map((metric) => [
    metric,
    Math.round(clamp(finite(source[metric], fallback), 0, 100) * 10) / 10,
  ]));
}

export function normalizeInterviewRelationshipImpact(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const directDelta = (rawValue) => Number.isFinite(Number(rawValue))
    ? (Number(rawValue) - 50) * 0.1
    : 0;
  return {
    boardConfidenceDelta: Math.round(clamp(finite(
      source.boardConfidenceDelta ?? source.confidenceDelta ?? source.confidence,
    ), -20, 20) * 10) / 10,
    credibilityDelta: Math.round(clamp(finite(
      source.credibilityDelta ?? source.credibility,
    ), -20, 20) * 10) / 10,
    strategicAlignmentDelta: Math.round(clamp(finite(
      source.strategicAlignmentDelta,
      directDelta(source.strategicAlignment),
    ), -20, 20) * 10) / 10,
    culturalCompatibilityDelta: Math.round(clamp(finite(
      source.culturalCompatibilityDelta,
      directDelta(source.culturalFit ?? source.culturalCompatibility),
    ), -20, 20) * 10) / 10,
    perceivedRiskDelta: Math.round(clamp(finite(
      source.perceivedRiskDelta,
      directDelta(source.perceivedRisk),
    ), -20, 20) * 10) / 10,
    expectedTenureDelta: Math.round(clamp(finite(
      source.expectedTenureDelta,
      directDelta(source.expectedTenure),
    ), -20, 20) * 10) / 10,
  };
}

export function normalizeInterviewNegotiationEffects(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const bonusMultiplier = finite(value.bonusMultiplier, 1);
  return {
    salaryMultiplier: Math.round(clamp(finite(value.salaryMultiplier, 1), 0.8, 1.25) * 1_000) / 1_000,
    durationYearsDelta: integer(value.durationYearsDelta ?? value.contractYearsDelta, 0, -1, 2),
    signingBonusMultiplier: Math.round(clamp(finite(value.signingBonusMultiplier, bonusMultiplier), 0, 2) * 1_000) / 1_000,
    performanceBonusMultiplier: Math.round(clamp(finite(value.performanceBonusMultiplier, bonusMultiplier), 0, 2) * 1_000) / 1_000,
    terminationClauseMultiplier: Math.round(clamp(finite(value.terminationClauseMultiplier, 1), 0.5, 1.5) * 1_000) / 1_000,
    transferBudgetMultiplier: Math.round(clamp(finite(value.transferBudgetMultiplier, 1), 0.75, 1.25) * 1_000) / 1_000,
    objectives: (Array.isArray(value.objectives) ? value.objectives : [])
      .map((entry) => limitedInterviewText(entry?.title ?? entry?.name ?? entry, 180))
      .filter(Boolean)
      .slice(0, 10),
    specialClauses: (Array.isArray(value.specialClauses) ? value.specialClauses : [])
      .map((entry) => limitedInterviewText(entry, 180))
      .filter(Boolean)
      .slice(0, 10),
    autonomyDelta: Math.round(clamp(finite(value.autonomyDelta), -20, 20) * 10) / 10,
    priorityDelta: Math.round(clamp(finite(value.priorityDelta), -25, 25) * 10) / 10,
    objectiveDifficultyDelta: Math.round(clamp(finite(value.objectiveDifficultyDelta), -15, 15) * 10) / 10,
    terminateNegotiation: Boolean(value.terminateNegotiation),
  };
}

export function normalizeInterviewEvaluation(value, now = null, fallbackScore = 50) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const overallScore = Math.round(clamp(finite(
    value.overallScore ?? value.overall ?? value.score,
    fallbackScore,
  ), 0, 100) * 10) / 10;
  const recommendationValue = identifier(value.recommendation).toLocaleLowerCase("en-US");
  return {
    overallScore,
    metrics: normalizeInterviewMetrics(value.metrics ?? value, overallScore),
    strengths: (Array.isArray(value.strengths) ? value.strengths : [])
      .map((entry) => limitedInterviewText(entry, 240)).filter(Boolean).slice(0, 10),
    risks: (Array.isArray(value.risks) ? value.risks : [])
      .map((entry) => limitedInterviewText(entry, 240)).filter(Boolean).slice(0, 10),
    recommendation: INTERVIEW_RECOMMENDATIONS.has(recommendationValue)
      ? recommendationValue
      : overallScore >= 72 ? "hire" : overallScore >= 55 ? "hire_with_reservations" : "reject",
    summary: limitedInterviewText(value.summary, 1_500) || null,
    generatedAt: nullableTimestamp(value.generatedAt ?? now),
  };
}

export function normalizeInterviewTurnAnalysis(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const confidenceDelta = Math.round(clamp(finite(
    value.confidenceDelta ?? value.relationshipImpact?.boardConfidenceDelta,
  ), -15, 15) * 10) / 10;
  const credibilityDelta = Math.round(clamp(finite(
    value.credibilityDelta ?? value.relationshipImpact?.credibilityDelta,
  ), -15, 15) * 10) / 10;
  const directMetrics = {
    boardConfidence: 50 + (confidenceDelta * 2),
    clubCompatibility: value.strategicAlignment,
    longTermPotential: value.expectedTenure,
    culturalFit: value.culturalFit,
    credibility: 50 + (credibilityDelta * 2),
    perceivedRisk: value.perceivedRisk,
  };
  return {
    metrics: normalizeInterviewMetrics(value.metrics ?? directMetrics),
    relationshipImpact: normalizeInterviewRelationshipImpact(value.relationshipImpact ?? {
      confidenceDelta,
      credibilityDelta,
      strategicAlignment: value.strategicAlignment,
      culturalFit: value.culturalFit,
      perceivedRisk: value.perceivedRisk,
      expectedTenure: value.expectedTenure,
    }),
    confidenceDelta,
    credibilityDelta,
    strategicAlignment: Math.round(clamp(finite(value.strategicAlignment, 50), 0, 100) * 10) / 10,
    culturalFit: Math.round(clamp(finite(value.culturalFit, 50), 0, 100) * 10) / 10,
    perceivedRisk: Math.round(clamp(finite(value.perceivedRisk, 50), 0, 100) * 10) / 10,
    expectedTenure: Math.round(clamp(finite(value.expectedTenure, 50), 0, 100) * 10) / 10,
    notes: (Array.isArray(value.notes) ? value.notes : [])
      .map((entry) => limitedInterviewText(entry, 240)).filter(Boolean).slice(0, 8),
  };
}

function normalizeInterviewTranscript(value) {
  return (Array.isArray(value) ? value : []).slice(-80).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const roleValue = identifier(entry.role).toLocaleLowerCase("en-US");
    const role = roleValue === "candidate" ? "coach" : roleValue;
    const text = limitedInterviewText(entry.text ?? entry.message, 2_000);
    if (!text || !["board", "coach"].includes(role)) return [];
    return [{
      ...clone(entry),
      id: identifier(entry.id) || deterministicId("coach-interview-message", `${entry.operationId ?? "legacy"}|${index}|${role}`),
      role,
      text,
      topic: limitedInterviewText(entry.topic, 80) || "general",
      questionId: identifier(entry.questionId) || null,
      createdAt: nullableTimestamp(entry.createdAt ?? entry.occurredAt),
      turn: integer(entry.turn, Math.floor(index / 2) + 1, 1, 100),
      analysis: normalizeInterviewTurnAnalysis(entry.analysis),
      operationId: identifier(entry.operationId) || null,
    }];
  });
}

export function normalizeInterview(value) {
  const coachId = identifier(value?.coachId);
  const clubId = identifier(value?.clubId);
  if (!coachId || !clubId) return null;
  const depthValue = identifier(value?.depth).toLocaleLowerCase("en-US");
  const depth = INTERVIEW_DEPTHS.has(depthValue) ? depthValue : "standard";
  const limits = interviewDepthLimits(depth);
  const transcript = normalizeInterviewTranscript(value?.transcript);
  const modeValue = identifier(value?.mode).toLocaleLowerCase("en-US");
  const sourceValue = identifier(value?.source).toLocaleLowerCase("en-US");
  const turnCount = integer(
    value?.turnCount,
    transcript.filter((entry) => entry.role === "coach").length,
    0,
    100,
  );
  const minTurns = integer(value?.minTurns, limits.minimum, 1, 20);
  const maxTurns = Math.max(minTurns, integer(value?.maxTurns, limits.maximum, 1, 20));
  return {
    ...(value && typeof value === "object" ? clone(value) : {}),
    id: identifier(value?.id) || deterministicId("coach-interview", `${value?.applicationId ?? "direct"}|${coachId}|${clubId}`),
    applicationId: identifier(value?.applicationId) || null,
    proposalId: identifier(value?.proposalId) || null,
    vacancyId: identifier(value?.vacancyId) || null,
    coachId,
    clubId,
    status: INTERVIEW_STATUSES.has(value?.status) ? value.status : "pending",
    scheduledAt: nullableTimestamp(value?.scheduledAt),
    expiresAt: nullableTimestamp(value?.expiresAt),
    completedAt: nullableTimestamp(value?.completedAt),
    mode: INTERVIEW_MODES.has(modeValue) ? modeValue : transcript.length ? "generative" : "legacy",
    depth,
    source: INTERVIEW_SOURCES.has(sourceValue) ? sourceValue : value?.source == null ? null : "fallback",
    model: limitedInterviewText(value?.model, 120) || null,
    transcript,
    currentQuestionId: identifier(value?.currentQuestionId) || null,
    turnCount,
    minTurns,
    maxTurns,
    contextSnapshot: value?.contextSnapshot && typeof value.contextSnapshot === "object" && !Array.isArray(value.contextSnapshot)
      ? clone(value.contextSnapshot)
      : {},
    contextHash: identifier(value?.contextHash) || null,
    cumulativeMetrics: normalizeInterviewMetrics(value?.cumulativeMetrics),
    evaluation: normalizeInterviewEvaluation(value?.evaluation, value?.completedAt ?? null),
    relationshipImpact: normalizeInterviewRelationshipImpact(value?.relationshipImpact),
    negotiationEffects: normalizeInterviewNegotiationEffects(value?.negotiationEffects),
    memorySummary: limitedInterviewText(value?.memorySummary, 2_000) || null,
    revision: integer(value?.revision, 0, 0, 10_000),
    effectsAppliedAt: nullableTimestamp(value?.effectsAppliedAt),
    effectsAppliedOperationId: identifier(value?.effectsAppliedOperationId) || null,
    questions: (Array.isArray(value?.questions) ? value.questions : []).slice(0, 20).map((question, index) => ({
      id: identifier(question?.id) || `question-${index + 1}`,
      topic: identifier(question?.topic) || "general",
      prompt: identifier(question?.prompt ?? question?.question) || `Pergunta ${index + 1}`,
      preferredAnswer: identifier(question?.preferredAnswer) || null,
    })),
    answers: (Array.isArray(value?.answers) ? clone(value.answers) : []).slice(0, 20),
    compatibilityScore: value?.compatibilityScore == null ? null : clamp(finite(value.compatibilityScore), 0, 100),
    closedAt: nullableTimestamp(value?.closedAt),
    closedReason: identifier(value?.closedReason) || null,
    closedBy: identifier(value?.closedBy) || null,
    decisionHistory: normalizeDecisionHistory(value?.decisionHistory),
    operationId: identifier(value?.operationId) || null,
  };
}

export function normalizeEvaluation(value) {
  const coachId = identifier(value?.coachId);
  const clubId = identifier(value?.clubId);
  if (!coachId || !clubId) return null;
  const legacyLevels = {
    very_secure: "very_safe",
    secure: "safe",
    under_review: "under_observation",
    dismissal_risk: "at_risk",
    dismissal_imminent: "imminent",
  };
  const score = clamp(finite(value?.score, 50), 0, 100);
  const suppliedLevel = identifier(value?.securityLevel) || "stable";
  const legacyDerived = !Array.isArray(value?.dimensions);
  return {
    ...(value && typeof value === "object" ? clone(value) : {}),
    id: identifier(value?.id) || deterministicId("coach-evaluation", `${coachId}|${clubId}|${value?.evaluatedAt ?? "legacy"}`),
    coachId,
    clubId,
    appointmentId: identifier(value?.appointmentId) || null,
    role: value?.role === "interim" ? "interim" : "head_coach",
    evaluatedAt: nullableTimestamp(value?.evaluatedAt),
    seasonNumber: integer(value?.seasonNumber, 1, 1),
    round: integer(value?.round, 0, 0),
    games: integer(value?.games, 0, 0),
    points: integer(value?.points, 0, 0),
    wins: integer(value?.wins, 0, 0),
    draws: integer(value?.draws, 0, 0),
    losses: integer(value?.losses, 0, 0),
    goalsFor: integer(value?.goalsFor, 0, 0),
    goalsAgainst: integer(value?.goalsAgainst, 0, 0),
    position: value?.position == null ? null : integer(value.position, 1, 1),
    expectedPosition: value?.expectedPosition == null ? null : integer(value.expectedPosition, 1, 1),
    score,
    securityLevel: legacyLevels[suppliedLevel] ?? suppliedLevel,
    securityLabel: identifier(value?.securityLabel) || null,
    recommendation: identifier(value?.recommendation) || "retain",
    factors: Array.isArray(value?.factors) ? clone(value.factors).slice(0, 30) : [],
    positiveFactors: Array.isArray(value?.positiveFactors)
      ? clone(value.positiveFactors).slice(0, 20)
      : (Array.isArray(value?.factors) ? clone(value.factors).filter((factor) => finite(factor?.impact, 0) > 0).slice(0, 20) : []),
    negativeFactors: Array.isArray(value?.negativeFactors)
      ? clone(value.negativeFactors).slice(0, 20)
      : (Array.isArray(value?.factors) ? clone(value.factors).filter((factor) => finite(factor?.impact, 0) < 0).slice(0, 20) : []),
    dimensions: Array.isArray(value?.dimensions) ? clone(value.dimensions).slice(0, 30) : [],
    trend: value?.trend && typeof value.trend === "object"
      ? clone(value.trend)
      : { direction: "stable", delta: 0, label: "Histórico anterior sem tendência detalhada" },
    fanSupport: value?.fanSupport && typeof value.fanSupport === "object" ? clone(value.fanSupport) : null,
    boardSupport: value?.boardSupport && typeof value.boardSupport === "object" ? clone(value.boardSupport) : null,
    classics: value?.classics && typeof value.classics === "object" ? clone(value.classics) : null,
    relegation: value?.relegation && typeof value.relegation === "object" ? clone(value.relegation) : null,
    accumulatedCredit: value?.accumulatedCredit && typeof value.accumulatedCredit === "object"
      ? clone(value.accumulatedCredit)
      : null,
    memory: Array.isArray(value?.memory) ? clone(value.memory).slice(-50) : [],
    activeUltimatum: value?.activeUltimatum && typeof value.activeUltimatum === "object"
      ? clone(value.activeUltimatum)
      : null,
    ultimatumOutcome: identifier(value?.ultimatumOutcome) || null,
    legacyDerived: Boolean(value?.legacyDerived ?? legacyDerived),
    minimumGamesMet: Boolean(value?.minimumGamesMet),
    operationId: identifier(value?.operationId) || null,
  };
}

function uniqueById(values) {
  const result = new Map();
  for (const value of values) {
    if (value?.id) result.set(value.id, value);
  }
  return [...result.values()];
}

export function catalogClubs(room) {
  const result = new Map();
  const add = (club, competition = {}) => {
    const id = identifier(club?.id ?? club?.code);
    if (!id || club?.active === false) return;
    const record = { ...clone(club), id, competitionId: identifier(competition?.id) || null };
    for (const alias of [id, club?.code, club?.name]) {
      if (identifier(alias)) result.set(clubKey(alias), record);
    }
  };
  for (const competition of Array.isArray(room?.competitionCatalog) ? room.competitionCatalog : []) {
    if (competition?.active === false) continue;
    for (const club of Array.isArray(competition?.clubs) ? competition.clubs : []) add(club, competition);
  }
  for (const tournament of Array.isArray(room?.tournamentCatalog) ? room.tournamentCatalog : []) {
    if (tournament?.active === false) continue;
    for (const club of Array.isArray(tournament?.participants) ? tournament.participants : []) add(club, tournament);
  }
  for (const manager of Array.isArray(room?.managers) ? room.managers : []) {
    const id = identifier(manager?.clubId);
    if (id && !result.has(clubKey(id))) result.set(clubKey(id), { id, name: id, competitionId: null });
  }
  return result;
}

function distinctClubs(room) {
  return [...new Map([...catalogClubs(room).values()].map((club) => [clubKey(club.id), club])).values()];
}

export function canonicalClubId(room, value) {
  const supplied = identifier(value);
  if (!supplied) return null;
  return catalogClubs(room).get(clubKey(supplied))?.id ?? supplied;
}

function coachMetadata(club) {
  const value = club?.headCoach ?? club?.coach ?? club?.manager ?? club?.managerProfile;
  if (typeof value === "string") return { name: identifier(value) };
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ensureCoachIdentities(room, now) {
  const state = room.coachCareerState && typeof room.coachCareerState === "object"
    ? clone(room.coachCareerState)
    : { version: 1, coaches: [] };
  const coaches = new Map((Array.isArray(state.coaches) ? state.coaches : [])
    .map(normalizeCoach)
    .filter(Boolean)
    .map((coach) => [coach.id, coach]));
  const clubs = distinctClubs(room);
  const claimed = new Set([...coaches.values()].map((coach) => clubKey(coach.currentClubId)).filter(Boolean));

  for (const manager of Array.isArray(room?.managers) ? room.managers : []) {
    const id = identifier(manager?.id);
    if (!id) continue;
    const existing = coaches.get(id);
    const currentClubId = canonicalClubId(room, manager?.clubId);
    const coach = normalizeCoach({
      ...existing,
      id,
      name: identifier(manager?.name) || existing?.name || "Manager",
      managerType: "human",
      currentClubId,
      status: currentClubId ? "employed" : (existing?.status ?? "unemployed"),
      assignments: existing?.assignments ?? [],
    });
    coaches.set(id, coach);
    if (coach.currentClubId) {
      const claimedClub = clubKey(coach.currentClubId);
      for (const other of coaches.values()) {
        if (other.id === coach.id || other.managerType === "human" || clubKey(other.currentClubId) !== claimedClub) continue;
        other.currentClubId = null;
        other.status = "unemployed";
        const activeAssignment = [...(other.assignments ?? [])].reverse().find((assignment) => !assignment.endedAt);
        if (activeAssignment) {
          activeAssignment.endedAt = now;
          activeAssignment.endedSeason = seasonNumber(room);
          activeAssignment.endedRound = completedRound(room);
          activeAssignment.exitReason = "human_manager_claim";
        }
      }
      claimed.add(claimedClub);
    }
  }

  for (const club of clubs) {
    if (claimed.has(clubKey(club.id))) continue;
    const metadata = coachMetadata(club);
    const sourceId = identifier(metadata?.id ?? metadata?.coachId ?? metadata?.managerId) || club.id;
    const id = sourceId.toLocaleLowerCase("pt-BR").startsWith("ai-coach:") ? sourceId : `ai-coach:${sourceId}`;
    const existing = coaches.get(id);
    if (existing) continue;
    coaches.set(id, normalizeCoach({
      ...metadata,
      id,
      name: identifier(metadata?.name ?? metadata?.fullName) || `Treinador de ${identifier(club.name) || club.id}`,
      managerType: "ai",
      currentClubId: club.id,
      status: "employed",
      assignments: [{
        clubId: club.id,
        startedSeason: seasonNumber(room),
        startedRound: 1,
        startedAt: now,
        endedSeason: null,
        endedRound: null,
        endedAt: null,
        role: "head_coach",
        entryReason: "legacy_import",
        exitReason: null,
      }],
    }));
    claimed.add(clubKey(club.id));
  }

  room.coachCareerState = {
    ...state,
    version: integer(state.version, 1, 1),
    coaches: [...coaches.values()].sort((left, right) => left.id.localeCompare(right.id, "pt-BR")),
  };
  return room.coachCareerState.coaches;
}

function normalizedState(value, now) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? clone(value) : {};
  const proposals = uniqueById((Array.isArray(source.proposals) ? source.proposals : []).map(normalizeProposal).filter(Boolean));
  const guarantees = uniqueById((Array.isArray(source.guarantees) ? source.guarantees : []).map(normalizeGuarantee).filter(Boolean));
  const evaluations = uniqueById((Array.isArray(source.evaluations) ? source.evaluations : [])
    .map(normalizeEvaluation)
    .filter(Boolean));
  let jobSecurity = normalizeCoachJobSecurityState(source.jobSecurity);
  for (const evaluation of evaluations) {
    const historyId = `${evaluation.id}:security-history`;
    if (jobSecurity.history.some((entry) => (
      entry.id === historyId
      || entry.evaluationId === evaluation.id
      || (
        identifier(entry.coachId) === evaluation.coachId
        && identifier(entry.clubId) === evaluation.clubId
        && (!evaluation.appointmentId || identifier(entry.appointmentId) === evaluation.appointmentId)
        && nullableTimestamp(entry.occurredAt) === nullableTimestamp(evaluation.updatedAt ?? evaluation.evaluatedAt)
        && finite(entry.newScore, -1) === evaluation.score
      )
    ))) continue;
    jobSecurity.history.push({
      id: historyId,
      evaluationId: evaluation.id,
      coachId: evaluation.coachId,
      clubId: evaluation.clubId,
      appointmentId: evaluation.appointmentId,
      occurredAt: evaluation.updatedAt ?? evaluation.evaluatedAt ?? now,
      previousLevel: null,
      newLevel: evaluation.securityLevel,
      previousScore: null,
      newScore: evaluation.score,
      factors: clone(evaluation.factors),
      fanSupport: clone(evaluation.fanSupport),
      boardPublicSupport: finite(evaluation.boardSupport?.publicValue, 50),
      boardPrivateConfidence: finite(evaluation.boardSupport?.privateValue, evaluation.score),
      relegation: clone(evaluation.relegation),
      classics: clone(evaluation.classics),
      accumulatedCredit: clone(evaluation.accumulatedCredit),
      decision: evaluation.recommendation,
      legacyDerived: Boolean(evaluation.legacyDerived),
    });
  }
  jobSecurity = normalizeCoachJobSecurityState(jobSecurity);
  for (const proposal of proposals) {
    const legacyGuarantees = Array.isArray(proposal.guarantees) ? proposal.guarantees : [];
    for (const [index, raw] of legacyGuarantees.entries()) {
      const description = identifier(typeof raw === "string" ? raw : raw?.description);
      if (!description) continue;
      const guarantee = normalizeGuarantee({
        ...(raw && typeof raw === "object" ? raw : {}),
        id: deterministicId("coach-guarantee", `${proposal.id}|legacy|${index}|${description}`),
        proposalId: proposal.id,
        vacancyId: proposal.vacancyId,
        applicationId: proposal.applicationId,
        coachId: proposal.coachId,
        clubId: proposal.clubId,
        description,
        responsibleId: proposal.clubId,
        responsibleRole: "board",
        status: "requested",
        mandatory: false,
        blocksCompletion: false,
        createdAt: proposal.updatedAt ?? proposal.createdAt ?? now,
        updatedAt: proposal.updatedAt ?? proposal.createdAt ?? now,
        operationId: proposal.operationId,
      });
      if (guarantee && !guarantees.some((candidate) => candidate.id === guarantee.id)) guarantees.push(guarantee);
      if (guarantee && !proposal.guaranteeIds.includes(guarantee.id)) proposal.guaranteeIds.push(guarantee.id);
    }
    delete proposal.guarantees;
    if (proposal.pendingCounterproposal) {
      proposal.pendingCounterproposal.guaranteeIds = [...new Set([
        ...proposal.pendingCounterproposal.guaranteeIds,
        ...proposal.guaranteeIds,
      ])].slice(0, 50);
    }
  }
  return {
    ...source,
    version: COACH_EMPLOYMENT_VERSION,
    currentDate: nullableTimestamp(source.currentDate) ?? now,
    marketConfig: normalizedMarketConfig(source.marketConfig),
    conductConfig: normalizeCoachConductConfig(source.conductConfig),
    contracts: uniqueById((Array.isArray(source.contracts) ? source.contracts : []).map(normalizeContract).filter(Boolean)),
    proposals,
    vacancies: uniqueById((Array.isArray(source.vacancies) ? source.vacancies : []).map(normalizeVacancy).filter(Boolean)),
    applications: uniqueById((Array.isArray(source.applications) ? source.applications : []).map(normalizeApplication).filter(Boolean)),
    interviews: uniqueById((Array.isArray(source.interviews) ? source.interviews : []).map(normalizeInterview).filter(Boolean)),
    appointments: uniqueById((Array.isArray(source.appointments) ? source.appointments : []).map(normalizeAppointment).filter(Boolean)),
    evaluations,
    jobSecurity,
    guarantees,
    notifications: uniqueById((Array.isArray(source.notifications) ? source.notifications : []).map(normalizeNotification).filter(Boolean)),
    processedOperationIds: [...new Set((Array.isArray(source.processedOperationIds) ? source.processedOperationIds : [])
      .map(identifier)
      .filter(Boolean))],
  };
}

export function coachById(room, coachId) {
  const coach = (room?.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === identifier(coachId));
  if (!coach) throw new CoachEmploymentError("Treinador nao encontrado", "COACH_NOT_FOUND", 404, { coachId });
  if (!identifier(coach.name)) throw new CoachEmploymentError("Treinador sem nome", "COACH_NAME_REQUIRED", 409, { coachId });
  return coach;
}

export function activeAppointmentForCoach(state, coachId) {
  return state.appointments.find((appointment) => (
    appointment.coachId === identifier(coachId) && appointment.status === "active"
  )) ?? null;
}

export function activeAppointmentForClub(state, clubId) {
  const key = clubKey(clubId);
  return state.appointments.find((appointment) => (
    clubKey(appointment.clubId) === key && appointment.status === "active"
  )) ?? null;
}

export function activeContractForCoach(state, coachId) {
  return state.contracts.find((contract) => (
    contract.coachId === identifier(coachId) && contract.status === "active"
  )) ?? null;
}

export function activeProfessionalLifecycleRecord(room, collection, coachId) {
  return (room?.professionalLifecycleState?.[collection] ?? []).find((entry) => (
    entry?.professionalType === "coach"
      && identifier(entry?.professionalId) === identifier(coachId)
      && [
        "active",
        "announced",
        "scheduled",
        "accepted",
        "awaiting_signatures",
        "signed",
      ].includes(identifier(entry?.status))
  )) ?? null;
}

function coachLifecycleStatus(room, coachId) {
  if ((room?.professionalLeaveState?.leaves ?? []).some((entry) => (
    entry?.professionalType === "coach"
      && identifier(entry?.professionalId) === identifier(coachId)
      && entry?.status === "active"
  ))) return "on_leave";
  if (activeProfessionalLifecycleRecord(room, "notices", coachId)) return "notice";
  if (activeProfessionalLifecycleRecord(room, "retirements", coachId)) return "retiring";
  return null;
}

function currentAssignment(coach) {
  return (coach?.assignments ?? []).findLast((assignment) => assignment.endedSeason == null) ?? null;
}

function closeCareerAssignment(coach, room, now, reason) {
  const assignment = currentAssignment(coach);
  if (!assignment) return;
  assignment.endedSeason = seasonNumber(room);
  assignment.endedRound = completedRound(room);
  assignment.endedAt = now;
  assignment.exitReason = reason;
}

export function appendCareerAssignment(coach, appointment) {
  const active = currentAssignment(coach);
  if (active && clubKey(active.clubId) === clubKey(appointment.clubId)) return;
  coach.assignments = [...(coach.assignments ?? []), {
    clubId: appointment.clubId,
    startedSeason: appointment.startedSeason,
    startedRound: appointment.startedRound,
    startedAt: appointment.startedAt,
    endedSeason: null,
    endedRound: null,
    endedAt: null,
    role: appointment.role,
    entryReason: appointment.entryReason,
    exitReason: null,
  }];
}

function clearHumanControl(room, coachId) {
  const manager = (room.managers ?? []).find((candidate) => candidate.id === coachId);
  if (!manager) return;
  manager.clubId = null;
  manager.ready = false;
  room.lineups = (room.lineups ?? []).filter((lineup) => lineup.managerId !== coachId);
  if (Array.isArray(room.matchReadiness?.managerIds)) {
    room.matchReadiness.managerIds = room.matchReadiness.managerIds.filter((managerId) => managerId !== coachId);
  }
}

export function setHumanControl(room, coachId, clubId) {
  const manager = (room.managers ?? []).find((candidate) => candidate.id === coachId);
  if (!manager) return;
  if (clubKey(manager.clubId) !== clubKey(clubId)) {
    room.lineups = (room.lineups ?? []).filter((lineup) => lineup.managerId !== coachId);
    if (Array.isArray(room.matchReadiness?.managerIds)) {
      room.matchReadiness.managerIds = room.matchReadiness.managerIds.filter((managerId) => managerId !== coachId);
    }
  }
  manager.clubId = clubId;
  manager.ready = false;
}

export function closeAppointmentMutable(room, state, appointment, now, reason, coachStatus = "unemployed") {
  const coach = coachById(room, appointment.coachId);
  appointment.status = "ended";
  appointment.endedAt = now;
  appointment.endedSeason = seasonNumber(room);
  appointment.endedRound = completedRound(room);
  appointment.exitReason = reason;
  const contract = state.contracts.find((candidate) => candidate.id === appointment.contractId)
    ?? activeContractForCoach(state, appointment.coachId);
  if (contract?.status === "active") {
    contract.status = reason === "contract_expired" ? "expired" : "terminated";
    contract.endedAt = now;
    contract.endReason = reason;
  }
  closeCareerAssignment(coach, room, now, reason);
  coach.currentClubId = null;
  coach.status = coachStatus;
  clearHumanControl(room, coach.id);
  return { coach, contract };
}

export function eventRecord(type, operationIdValue, now, values = {}) {
  return {
    id: identifier(values.id) || operationIdValue,
    operationId: operationIdValue,
    type,
    aggregateType: "coach",
    aggregateId: identifier(values.coachId) || null,
    coachId: identifier(values.coachId) || null,
    clubId: identifier(values.clubId) || null,
    relatedClubId: identifier(values.relatedClubId) || null,
    contractId: identifier(values.contractId) || null,
    proposalId: identifier(values.proposalId) || null,
    vacancyId: identifier(values.vacancyId) || null,
    amount: integer(values.amount, 0, 0, MAX_MONEY),
    occurredAt: now,
    clubIds: [values.clubId, values.relatedClubId].map(identifier).filter(Boolean),
    payload: values.metadata && typeof values.metadata === "object" ? clone(values.metadata) : {},
  };
}

export function financeRecord(direction, category, operationIdValue, now, values = {}) {
  return {
    id: identifier(values.id) || `${operationIdValue}:${direction}:${identifier(values.clubId)}`,
    originId: operationIdValue,
    operationId: operationIdValue,
    direction,
    type: direction,
    category,
    amount: integer(values.amount, 0, 0, MAX_MONEY),
    clubId: identifier(values.clubId),
    relatedClubId: identifier(values.relatedClubId) || null,
    coachId: identifier(values.coachId) || null,
    occurredAt: now,
    date: now,
    description: identifier(values.description) || null,
    metadata: values.metadata && typeof values.metadata === "object" ? clone(values.metadata) : {},
  };
}

function compactRetainedEvaluation(evaluation) {
  return {
    id: evaluation.id,
    coachId: evaluation.coachId,
    clubId: evaluation.clubId,
    appointmentId: evaluation.appointmentId,
    role: evaluation.role,
    evaluatedAt: evaluation.evaluatedAt,
    updatedAt: evaluation.updatedAt,
    seasonNumber: evaluation.seasonNumber,
    round: evaluation.round,
    games: evaluation.games,
    points: evaluation.points,
    wins: evaluation.wins,
    draws: evaluation.draws,
    losses: evaluation.losses,
    goalsFor: evaluation.goalsFor,
    goalsAgainst: evaluation.goalsAgainst,
    position: evaluation.position,
    expectedPosition: evaluation.expectedPosition,
    score: evaluation.score,
    rawScore: evaluation.rawScore,
    securityLevel: evaluation.securityLevel,
    securityLabel: evaluation.securityLabel,
    recommendation: evaluation.recommendation,
    factors: (evaluation.factors ?? []).slice(0, 12).map((factor) => ({
      code: identifier(factor?.code ?? factor?.id) || "unknown",
      impact: Math.round(finite(factor?.impact, 0) * 10) / 10,
    })),
    minimumGamesMet: Boolean(evaluation.minimumGamesMet),
    ultimatumOutcome: evaluation.ultimatumOutcome ?? null,
    operationId: evaluation.operationId ?? evaluation.id,
    compacted: true,
  };
}

function retainState(state) {
  for (const [field, maximum] of Object.entries(RETENTION)) {
    if (field === "processedOperationIds") continue;
    if (field === "evaluations") {
      const perAppointment = new Map();
      for (const evaluation of state.evaluations ?? []) {
        const scope = identifier(evaluation.appointmentId)
          || `${identifier(evaluation.coachId)}:${clubKey(evaluation.clubId)}`;
        const bucket = perAppointment.get(scope) ?? [];
        bucket.push(evaluation);
        perAppointment.set(scope, bucket);
      }
      state.evaluations = [...perAppointment.values()]
        .flatMap((bucket) => {
          const retained = bucket.slice(-3);
          return retained.map((evaluation, index) => (
            index === retained.length - 1 ? evaluation : compactRetainedEvaluation(evaluation)
          ));
        })
        .sort((left, right) => String(left.evaluatedAt ?? "").localeCompare(String(right.evaluatedAt ?? "")))
        .slice(-maximum);
      continue;
    }
    state[field] = (state[field] ?? []).slice(-maximum);
  }
  state.processedOperationIds = state.processedOperationIds.slice(-RETENTION.processedOperationIds);
}

export function synchronizeCareerAndRetain(room, state, now) {
  synchronizeCoachCareerHistory(room, state, now);
  retainState(state);
}

export function contractTerms(room, coach, clubId, input, now, id, role = "head_coach") {
  const years = integer(input?.durationYears ?? input?.years, 2, 1, 10);
  const wage = integer(input?.wage ?? input?.salary ?? coach?.salary, 100_000, 1_000, 20_000_000);
  return normalizeContract({
    id: deterministicId("coach-contract", `${id}|${coach.id}|${clubId}`),
    coachId: coach.id,
    clubId,
    role,
    signedAt: now,
    startDate: input?.startDate ?? now,
    endDate: input?.endDate ?? addYears(input?.startDate ?? now, years),
    wage,
    terminationClause: input?.terminationClause ?? wage * 6,
    signingBonus: input?.signingBonus,
    compensation: input?.compensation,
    transferBudgetCommitment: input?.transferBudget ?? input?.transferBudgetCommitment,
    autonomyLevel: input?.autonomyLevel,
    objectiveDifficultyAdjustment: input?.objectiveDifficultyAdjustment,
    sourceInterviewId: input?.sourceInterviewId ?? input?.interviewId,
    bonuses: input?.bonuses,
    guaranteeIds: input?.guaranteeIds,
    clauses: input?.clauses,
    staffPackageCommitments: input?.staffPackageCommitments,
    objectives: input?.objectives,
    renewalOption: input?.renewalOption,
    renewalCount: input?.renewalCount,
    status: input?.status ?? "active",
    operationId: id,
  });
}

export function appointmentRecord(room, coachId, clubId, contractId, input, now, id, role = "head_coach") {
  return normalizeAppointment({
    id: deterministicId("coach-appointment", `${id}|${coachId}|${clubId}`),
    coachId,
    clubId,
    contractId,
    role,
    status: input?.status ?? "active",
    appointedAt: now,
    startedAt: input?.startDate ?? now,
    expectedStartAt: input?.expectedStartAt,
    startedSeason: seasonNumber(room),
    startedRound: completedRound(room) + 1,
    entryReason: input?.entryReason ?? "appointed",
    expectedEndAt: input?.expectedEndAt,
    temporaryWageBonus: input?.temporaryWageBonus,
    authorityLevel: input?.authorityLevel,
    canBeConfirmed: input?.canBeConfirmed,
    sourceStaffId: input?.sourceStaffId,
    selectionScore: input?.selectionScore,
    selectionReason: input?.selectionReason,
    proposalId: input?.proposalId,
    vacancyId: input?.vacancyId,
    applicationId: input?.applicationId,
    operationId: id,
  });
}

export function openVacancyMutable(room, state, clubId, reason, now, id) {
  const existing = state.vacancies.find((vacancy) => (
    clubKey(vacancy.clubId) === clubKey(clubId) && vacancy.status === "open"
  ));
  if (existing) return existing;
  const club = catalogClubs(room).get(clubKey(clubId));
  const desiredProfile = buildDesiredCoachProfile(room, state, clubId, reason, now);
  const vacancy = normalizeVacancy({
    id: deterministicId("coach-vacancy", `${id}|${clubId}`),
    clubId,
    competitionId: club?.competitionId,
    status: "open",
    reason,
    openedAt: now,
    closesAt: addDays(now, 21),
    desiredProfile,
    operationId: id,
  });
  state.vacancies.push(vacancy);
  return vacancy;
}

function staffInterimScore(member) {
  const attributes = member?.attributes && typeof member.attributes === "object" ? member.attributes : {};
  const attribute = (key, fallback = 10) => clamp(finite(attributes[key], fallback), 1, 20);
  const roleBase = member?.role === "assistant_coach" ? 24 : 12;
  const quality = (
    attribute("tactical") * 1.35
      + attribute("coaching") * 0.9
      + attribute("manManagement") * 1.1
      + attribute("motivation") * 0.65
  ) / 3.6;
  const reputation = clamp(finite(member?.reputation, 50), 0, 100) / 10;
  const affinity = clamp(finite(member?.affinity, 50), 0, 100) / 20;
  const satisfaction = clamp(finite(member?.satisfaction, 70), 0, 100) / 25;
  const experience = Math.min(8, integer(member?.sharedJobs, 0, 0) * 0.75
    + Math.max(0, finite(member?.age, 40) - 30) / 10);
  return Math.round(clamp(roleBase + quality * 2.1 + reputation + affinity + satisfaction + experience, 0, 100) * 10) / 10;
}

function eligibleInterimStaff(room, clubId, now) {
  const staffContracts = Array.isArray(room?.clubCareerState?.staffContracts)
    ? room.clubCareerState.staffContracts
    : [];
  const currentTime = new Date(now).getTime();
  return (room?.clubCareerState?.staffMembers ?? []).filter((member) => {
    if (clubKey(member?.clubId) !== clubKey(clubId)) return false;
    if (!["assistant_coach", "youth_coach"].includes(member?.role)) return false;
    if (member?.status && member.status !== "employed") return false;
    if (member?.interimAssignment?.status === "active") return false;
    const availability = identifier(member?.availability?.status);
    if (["retired", "suspended", "notice", "on_leave", "retiring", "unavailable"].includes(availability)) return false;
    const contract = staffContracts.find((candidate) => (
      identifier(candidate?.staffId) === identifier(member?.id)
        && clubKey(candidate?.clubId) === clubKey(clubId)
        && candidate?.status === "active"
    ));
    return !contract?.endDate || new Date(contract.endDate).getTime() > currentTime;
  }).sort((left, right) => (
    staffInterimScore(right) - staffInterimScore(left)
      || identifier(left.id).localeCompare(identifier(right.id), "pt-BR")
  ));
}

function interimIdentity(room, clubId, now, id) {
  const staff = eligibleInterimStaff(room, clubId, now)[0] ?? null;
  const coachId = staff ? `interim-coach:${staff.id}` : `interim-coach:${clubKey(clubId).toLocaleLowerCase("pt-BR")}`;
  let coach = (room.coachCareerState.coaches ?? []).find((candidate) => candidate.id === coachId);
  if (!coach) {
    coach = normalizeCoach({
      id: coachId,
      name: identifier(staff?.name) || `Interino de ${identifier(catalogClubs(room).get(clubKey(clubId))?.name) || clubId}`,
      managerType: "ai",
      status: "unemployed",
      currentClubId: null,
      assignments: [],
      salary: integer(staff?.salary, 50_000, 1_000, 20_000_000),
      reputation: integer(staff?.reputation, 45, 1, 100),
      attributes: staff?.attributes && typeof staff.attributes === "object" ? clone(staff.attributes) : {},
      sourceStaffId: staff?.id ?? null,
      createdByOperationId: id,
    });
    room.coachCareerState.coaches.push(coach);
  } else if (staff) {
    coach.name = identifier(staff.name) || coach.name;
    coach.salary = integer(staff.salary, integer(coach.salary, 50_000, 1_000, 20_000_000), 1_000, 20_000_000);
    coach.reputation = integer(staff.reputation, integer(coach.reputation, 45, 1, 100), 1, 100);
    coach.attributes = staff.attributes && typeof staff.attributes === "object"
      ? clone(staff.attributes)
      : coach.attributes ?? {};
    coach.sourceStaffId = staff.id;
  }
  return {
    coach,
    staff,
    selectionScore: staff ? staffInterimScore(staff) : null,
    selectionReason: staff ? "best_eligible_staff_member" : "emergency_club_interim",
  };
}

export function interimBonusTransactionMutable(appointment, now) {
  if (appointment?.role !== "interim" || appointment.status !== "active") return null;
  const amount = integer(appointment.temporaryWageBonus, 0, 0, MAX_MONEY);
  if (amount <= 0 || appointment.temporaryBonusPaidAt) return null;
  const transactionId = identifier(appointment.temporaryBonusTransactionId)
    || `${appointment.operationId ?? appointment.id}:temporary-bonus`;
  appointment.temporaryBonusTransactionId = transactionId;
  appointment.temporaryBonusPaidAt = now;
  return financeRecord("expense", "coach_interim_bonus", transactionId, now, {
    id: transactionId,
    clubId: appointment.clubId,
    coachId: appointment.coachId,
    amount,
    description: "Bonus temporario pela interinidade",
    metadata: {
      appointmentId: appointment.id,
      sourceStaffId: appointment.sourceStaffId,
      authorityLevel: appointment.authorityLevel,
    },
  });
}

export function createInterimMutable(room, state, clubId, reason, now, id, options = {}) {
  const active = activeAppointmentForClub(state, clubId);
  if (active) return {
    appointment: active,
    contract: activeContractForCoach(state, active.coachId),
    vacancy: null,
    event: null,
    transactions: [],
  };
  const selection = interimIdentity(room, clubId, now, id);
  const { coach } = selection;
  const previous = activeAppointmentForCoach(state, coach.id);
  if (previous) closeAppointmentMutable(room, state, previous, now, "interim_reassigned", "unemployed");
  const contract = contractTerms(room, coach, clubId, {
    wage: integer(coach?.salary, 50_000, 0, 20_000_000),
    durationYears: 1,
    endDate: null,
    terminationClause: 0,
    objectives: [],
  }, now, `${id}:interim`, "interim");
  contract.endDate = null;
  const appointment = appointmentRecord(room, coach.id, clubId, contract.id, {
    entryReason: "interim_after_departure",
    expectedEndAt: addDays(now, 90),
    temporaryWageBonus: Math.round(integer(coach?.salary, 50_000, 0, 20_000_000) * 0.2),
    authorityLevel: 55,
    canBeConfirmed: true,
    sourceStaffId: coach.sourceStaffId ?? null,
    selectionScore: selection.selectionScore,
    selectionReason: selection.selectionReason,
  }, now, `${id}:interim`, "interim");
  state.contracts.push(contract);
  state.appointments.push(appointment);
  coach.currentClubId = clubId;
  coach.status = "interim";
  appendCareerAssignment(coach, appointment);
  const vacancy = openVacancyMutable(room, state, clubId, reason, now, `${id}:vacancy`);
  vacancy.interimCoachId = coach.id;
  appointment.vacancyId = vacancy.id;
  if (selection.staff) {
    selection.staff.availability = {
      ...(selection.staff.availability && typeof selection.staff.availability === "object"
        ? selection.staff.availability
        : {}),
      status: "interim_head_coach",
      effectiveAt: now,
      reason: "promoted_to_interim",
    };
    selection.staff.interimAssignment = {
      id: deterministicId("staff-interim", `${appointment.id}|${selection.staff.id}`),
      clubId,
      role: "acting_head_coach",
      startedAt: now,
      startsAt: now,
      expectedEndAt: appointment.expectedEndAt,
      endedAt: null,
      endsAt: appointment.expectedEndAt,
      status: "active",
      endReason: null,
      temporaryBonus: appointment.temporaryWageBonus,
      authorityLevel: appointment.authorityLevel,
      sourceCoachId: null,
    };
    selection.staff.updatedAt = now;
    selection.staff.professionalHistory = [
      ...(Array.isArray(selection.staff.professionalHistory) ? selection.staff.professionalHistory : []),
      {
        id: deterministicId("staff-history", `${id}|${selection.staff.id}|interim`),
        type: "appointed_interim_head_coach",
        clubId,
        occurredAt: now,
        appointmentId: appointment.id,
        operationId: id,
      },
    ].slice(-500);
  }
  const bonusTransaction = options.payBonus === true
    ? interimBonusTransactionMutable(appointment, now)
    : null;
  const event = eventRecord("COACH_INTERIM_APPOINTED", `${id}:interim`, now, {
    coachId: coach.id,
    clubId,
    contractId: contract.id,
    vacancyId: vacancy.id,
    metadata: {
      reason,
      sourceStaffId: coach.sourceStaffId ?? null,
      selectionScore: selection.selectionScore,
      selectionReason: selection.selectionReason,
      expectedEndAt: appointment.expectedEndAt,
      temporaryWageBonus: appointment.temporaryWageBonus,
      authorityLevel: appointment.authorityLevel,
      canBeConfirmed: appointment.canBeConfirmed,
    },
  });
  return {
    appointment,
    contract,
    vacancy,
    event,
    transactions: bonusTransaction ? [bonusTransaction] : [],
  };
}

function repairAndSync(room, state, now) {
  const appointments = [...state.appointments]
    .filter((appointment) => appointment.status === "active")
    .sort((left, right) => (
      String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? ""))
        || right.id.localeCompare(left.id)
    ));
  const seenCoaches = new Set();
  const seenClubs = new Set();
  for (const appointment of appointments) {
    const coachId = appointment.coachId;
    const clubId = clubKey(appointment.clubId);
    if (!seenCoaches.has(coachId) && !seenClubs.has(clubId)) {
      seenCoaches.add(coachId);
      seenClubs.add(clubId);
      continue;
    }
    appointment.status = "ended";
    appointment.endedAt = appointment.endedAt ?? now;
    appointment.exitReason = appointment.exitReason ?? "migration_duplicate_link";
    const contract = state.contracts.find((candidate) => candidate.id === appointment.contractId);
    if (contract?.status === "active") {
      contract.status = "terminated";
      contract.endedAt = contract.endedAt ?? now;
      contract.endReason = contract.endReason ?? "migration_duplicate_link";
    }
  }
  const activeContractIds = new Set(state.appointments
    .filter((appointment) => appointment.status === "active")
    .map((appointment) => appointment.contractId));
  for (const contract of state.contracts) {
    if (contract.status === "active" && !activeContractIds.has(contract.id)) {
      contract.status = "terminated";
      contract.endedAt = contract.endedAt ?? now;
      contract.endReason = contract.endReason ?? "migration_orphan_contract";
    }
  }

  for (const coach of room.coachCareerState.coaches) {
    const appointment = activeAppointmentForCoach(state, coach.id);
    if (appointment) {
      coach.currentClubId = appointment.clubId;
      coach.status = coachLifecycleStatus(room, coach.id)
        ?? (appointment.role === "interim" ? "interim" : "employed");
      appendCareerAssignment(coach, appointment);
      setHumanControl(room, coach.id, appointment.clubId);
    } else {
      coach.currentClubId = null;
      const lifecycleStatus = coachLifecycleStatus(room, coach.id);
      if (lifecycleStatus) coach.status = lifecycleStatus;
      else if (!["dismissed", "resigned", "retired", "awaiting_start"].includes(coach.status)) coach.status = "unemployed";
    }
  }
}

function reconcileHumanManagerClaims(room, state, now) {
  for (const manager of Array.isArray(room.managers) ? room.managers : []) {
    const coachId = identifier(manager?.id);
    const desiredClubId = canonicalClubId(room, manager?.clubId);
    if (!coachId || !desiredClubId) continue;
    const conflicts = state.appointments.filter((appointment) => (
      appointment.status === "active"
      && (
        (clubKey(appointment.clubId) === clubKey(desiredClubId) && appointment.coachId !== coachId)
        || (appointment.coachId === coachId && clubKey(appointment.clubId) !== clubKey(desiredClubId))
      )
    ));
    for (const appointment of conflicts) {
      appointment.status = "ended";
      appointment.endedAt = now;
      appointment.endedSeason = seasonNumber(room);
      appointment.endedRound = completedRound(room);
      appointment.exitReason = "migration_human_manager_claim";
      const contract = state.contracts.find((candidate) => candidate.id === appointment.contractId);
      if (contract?.status === "active") {
        contract.status = "terminated";
        contract.endedAt = now;
        contract.endReason = "migration_human_manager_claim";
      }
      const displaced = room.coachCareerState.coaches.find((coach) => coach.id === appointment.coachId);
      if (displaced) {
        closeCareerAssignment(displaced, room, now, "migration_human_manager_claim");
        if (displaced.id !== coachId) {
          displaced.currentClubId = null;
          displaced.status = "unemployed";
        }
      }
    }
  }
}

function seedLegacyLinks(room, state, now) {
  for (const coach of room.coachCareerState.coaches) {
    const clubId = canonicalClubId(room, coach.currentClubId);
    if (!clubId || activeAppointmentForCoach(state, coach.id) || activeAppointmentForClub(state, clubId)) continue;
    const assignment = currentAssignment(coach);
    const role = coach.status === "interim" ? "interim" : "head_coach";
    const id = `coach-legacy:${coach.id}:${clubKey(clubId)}`;
    const contract = normalizeContract({
      id: deterministicId("coach-contract", id),
      coachId: coach.id,
      clubId,
      role,
      signedAt: assignment?.startedAt ?? now,
      startDate: assignment?.startedAt ?? now,
      endDate: null,
      wage: integer(coach?.salary, 0, 0, 20_000_000),
      terminationClause: 0,
      objectives: [],
      status: "active",
      operationId: id,
    });
    const appointment = normalizeAppointment({
      id: deterministicId("coach-appointment", id),
      coachId: coach.id,
      clubId,
      contractId: contract.id,
      role,
      status: "active",
      appointedAt: assignment?.startedAt ?? now,
      startedAt: assignment?.startedAt ?? now,
      startedSeason: assignment?.startedSeason ?? seasonNumber(room),
      startedRound: assignment?.startedRound ?? 1,
      entryReason: assignment?.entryReason ?? "legacy_import",
      operationId: id,
    });
    state.contracts.push(contract);
    state.appointments.push(appointment);
  }
}

/** Clone, migrate and make coach employment authoritative without mutating the input room. */
export function ensureCoachEmploymentState(roomValue, options = {}) {
  const room = clone(roomValue ?? {});
  const now = careerDate(room, options.now);
  ensureCoachIdentities(room, now);
  const state = normalizedState(room.coachEmploymentState, now);
  room.coachEmploymentState = state;
  for (const vacancy of state.vacancies) {
    vacancy.desiredProfile = buildDesiredCoachProfile(
      room,
      state,
      vacancy.clubId,
      vacancy.reason,
      vacancy.openedAt ?? now,
      vacancy.desiredProfile,
    );
  }
  reconcileHumanManagerClaims(room, state, now);
  seedLegacyLinks(room, state, now);
  repairAndSync(room, state, now);
  for (const club of distinctClubs(room)) {
    if (activeAppointmentForClub(state, club.id)) continue;
    createInterimMutable(room, state, club.id, "migration_without_coach", now, `coach-migration:${clubKey(club.id)}`);
  }
  repairAndSync(room, state, now);
  state.currentDate = now;
  synchronizeCareerAndRetain(room, state, now);
  assertCoachEmploymentIntegrity(room, now);
  return room;
}

/** Internal/full snapshot; transport layers must still apply viewer privacy. */
export function coachEmploymentSnapshot(roomValue, options = {}) {
  const room = ensureCoachEmploymentState(roomValue, options);
  const state = room.coachEmploymentState;
  const coachId = identifier(options.coachId);
  const clubId = identifier(options.clubId);
  const matches = (entry) => (
    (!coachId || entry?.coachId === coachId)
      && (!clubId || clubKey(entry?.clubId ?? entry?.offeringClubId) === clubKey(clubId))
  );
  const securityClubIds = new Set(state.appointments.filter(matches).map((entry) => clubKey(entry.clubId)));
  const securityState = normalizeCoachJobSecurityState(state.jobSecurity);
  const scopeSecurity = Boolean(coachId || clubId);
  return clone({
    ...state,
    coaches: room.coachCareerState.coaches.filter((coach) => (
      (!coachId || coach.id === coachId) && (!clubId || clubKey(coach.currentClubId) === clubKey(clubId))
    )),
    contracts: state.contracts.filter(matches),
    proposals: state.proposals.filter(matches),
    vacancies: state.vacancies.filter((entry) => !clubId || clubKey(entry.clubId) === clubKey(clubId)),
    applications: state.applications.filter(matches),
    interviews: state.interviews.filter(matches),
    appointments: state.appointments.filter(matches),
    evaluations: state.evaluations.filter(matches),
    jobSecurity: {
      ...securityState,
      profiles: securityState.profiles.filter((entry) => !scopeSecurity || securityClubIds.has(clubKey(entry.clubId))),
      meetings: securityState.meetings.filter(matches),
      ultimatums: securityState.ultimatums.filter(matches),
      history: securityState.history.filter(matches),
      fanSupportByClubId: Object.fromEntries(Object.entries(securityState.fanSupportByClubId)
        .filter(([entryClubId]) => !scopeSecurity || securityClubIds.has(clubKey(entryClubId)))),
      processedSignalIds: [],
    },
    processedOperationIds: [],
  });
}

export function interviewCompatibility(interview, answers) {
  if (!interview.questions.length) return 50;
  const byId = new Map((Array.isArray(answers) ? answers : []).map((answer) => [identifier(answer?.questionId ?? answer?.id), answer]));
  const total = interview.questions.reduce((sum, question) => {
    const answer = byId.get(question.id);
    if (!answer) return sum;
    const value = identifier(answer.answerId ?? answer.optionId ?? answer.value ?? answer.text);
    return sum + (question.preferredAnswer && value === question.preferredAnswer ? 100 : value ? 55 : 0);
  }, 0);
  return Math.round(total / interview.questions.length);
}

function assertUniqueIds(collection, code) {
  const ids = collection.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new CoachEmploymentError("IDs duplicados no estado de treinadores", code, 500);
  }
}

export function assertCoachEmploymentIntegrity(room, now) {
  const state = room?.coachEmploymentState;
  if (!state || state.version !== COACH_EMPLOYMENT_VERSION) {
    throw new CoachEmploymentError("Estado de treinadores invalido", "COACH_STATE_VERSION_INVALID", 500);
  }
  for (const field of ["contracts", "proposals", "vacancies", "applications", "interviews", "appointments", "evaluations"]) {
    assertUniqueIds(state[field] ?? [], `COACH_${field.toLocaleUpperCase("en-US")}_DUPLICATE_ID`);
  }
  for (const field of ["profiles", "meetings", "ultimatums", "history"]) {
    assertUniqueIds(state.jobSecurity?.[field] ?? [], `COACH_JOB_SECURITY_${field.toLocaleUpperCase("en-US")}_DUPLICATE_ID`);
  }
  const coaches = room?.coachCareerState?.coaches ?? [];
  assertUniqueIds(coaches, "COACH_DUPLICATE_IDENTITY");
  for (const coach of coaches) {
    if (!identifier(coach.name)) throw new CoachEmploymentError("Treinador sem nome", "COACH_NAME_REQUIRED", 500, { coachId: coach.id });
  }
  const activeAppointments = state.appointments.filter((appointment) => appointment.status === "active");
  const activeContracts = state.contracts.filter((contract) => contract.status === "active");
  const scheduledAppointments = state.appointments.filter((appointment) => appointment.status === "scheduled");
  const scheduledContracts = state.contracts.filter((contract) => contract.status === "scheduled");
  for (const appointment of activeAppointments) {
    const sameCoach = activeAppointments.filter((candidate) => candidate.coachId === appointment.coachId);
    const sameClub = activeAppointments.filter((candidate) => clubKey(candidate.clubId) === clubKey(appointment.clubId));
    if (sameCoach.length !== 1) throw new CoachEmploymentError("Treinador com dois clubes", "COACH_MULTIPLE_ACTIVE_APPOINTMENTS", 500, { coachId: appointment.coachId });
    if (sameClub.length !== 1) throw new CoachEmploymentError("Clube com dois treinadores", "CLUB_MULTIPLE_ACTIVE_COACHES", 500, { clubId: appointment.clubId });
    const contract = activeContracts.find((candidate) => candidate.id === appointment.contractId);
    if (!contract || contract.coachId !== appointment.coachId || clubKey(contract.clubId) !== clubKey(appointment.clubId)) {
      throw new CoachEmploymentError("Contrato e nomeacao inconsistentes", "COACH_CONTRACT_APPOINTMENT_MISMATCH", 500, { appointmentId: appointment.id });
    }
    const coach = coaches.find((candidate) => candidate.id === appointment.coachId);
    if (!coach || clubKey(coach.currentClubId) !== clubKey(appointment.clubId)) {
      throw new CoachEmploymentError("Clube atual do treinador inconsistente", "COACH_CURRENT_CLUB_MISMATCH", 500, { coachId: appointment.coachId });
    }
  }
  for (const contract of activeContracts) {
    if (activeContracts.filter((candidate) => candidate.coachId === contract.coachId).length !== 1) {
      throw new CoachEmploymentError("Treinador com dois contratos ativos", "COACH_MULTIPLE_ACTIVE_CONTRACTS", 500, { coachId: contract.coachId });
    }
    if (!activeAppointments.some((appointment) => appointment.contractId === contract.id)) {
      throw new CoachEmploymentError("Contrato ativo sem nomeacao", "COACH_ORPHAN_ACTIVE_CONTRACT", 500, { contractId: contract.id });
    }
  }
  for (const appointment of scheduledAppointments) {
    if (scheduledAppointments.filter((candidate) => candidate.coachId === appointment.coachId).length !== 1) {
      throw new CoachEmploymentError("Treinador com dois compromissos futuros", "COACH_MULTIPLE_SCHEDULED_APPOINTMENTS", 500, {
        coachId: appointment.coachId,
      });
    }
    if (scheduledAppointments.filter((candidate) => clubKey(candidate.clubId) === clubKey(appointment.clubId)).length !== 1) {
      throw new CoachEmploymentError("Clube com dois treinadores futuros", "CLUB_MULTIPLE_SCHEDULED_COACHES", 500, {
        clubId: appointment.clubId,
      });
    }
    const contract = scheduledContracts.find((candidate) => candidate.id === appointment.contractId);
    if (!contract || contract.coachId !== appointment.coachId || clubKey(contract.clubId) !== clubKey(appointment.clubId)) {
      throw new CoachEmploymentError("Contrato futuro e nomeacao inconsistentes", "COACH_SCHEDULED_CONTRACT_MISMATCH", 500, {
        appointmentId: appointment.id,
      });
    }
  }
  for (const contract of scheduledContracts) {
    if (scheduledContracts.filter((candidate) => candidate.coachId === contract.coachId).length !== 1) {
      throw new CoachEmploymentError("Treinador com dois contratos futuros", "COACH_MULTIPLE_SCHEDULED_CONTRACTS", 500, {
        coachId: contract.coachId,
      });
    }
    if (!scheduledAppointments.some((appointment) => appointment.contractId === contract.id)) {
      throw new CoachEmploymentError("Contrato futuro sem nomeacao", "COACH_ORPHAN_SCHEDULED_CONTRACT", 500, {
        contractId: contract.id,
      });
    }
  }
  for (const club of distinctClubs(room)) {
    if (!activeAppointmentForClub(state, club.id)) {
      throw new CoachEmploymentError("Clube sem treinador ou interino", "CLUB_WITHOUT_COACH", 500, { clubId: club.id });
    }
  }
  for (const proposal of state.proposals) {
    if (ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
      && proposal.expiresAt
      && new Date(proposal.expiresAt).getTime() <= new Date(now).getTime()) {
      // Expiration is processed explicitly. Validation allows the persisted
      // instant before processCoachEmploymentDate runs, but acceptance rejects it.
      continue;
    }
  }
  return true;
}

export function validateCoachEmploymentState(roomValue, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = options.normalize === false ? roomValue : ensureCoachEmploymentState(roomValue, { now });
  return assertCoachEmploymentIntegrity(room, now);
}
