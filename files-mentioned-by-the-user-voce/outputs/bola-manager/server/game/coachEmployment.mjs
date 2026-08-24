import {
  evaluateCoachJobSecurity,
  normalizeCoachJobSecurityState,
} from "./coachJobSecurity.mjs";
import {
  DEFAULT_COACH_SELECTION_WEIGHTS,
  buildDesiredCoachProfile,
  evaluateCoachCandidate,
  normalizeCoachReputation100,
  normalizeVacancyDesiredProfile,
} from "./coachCandidateScoring.mjs";
import {
  activeCoachMarketRestriction,
  calculateCoachResignationConsequences,
  coachCareerTrustSummary,
  coachRecoveryDelta,
  inferCoachResignationReason,
  normalizeCoachConductConfig,
} from "./coachCareerConduct.mjs";
import { synchronizeCoachCareerHistory } from "./coachCareerHistory.mjs";

const COACH_EMPLOYMENT_VERSION = 6;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MIN_INTERVIEW_COMPATIBILITY = 45;
const MAX_MONEY = 2_000_000_000;
const RETENTION = Object.freeze({
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
const INTERVIEW_DEPTHS = new Set(["quick", "standard", "deep"]);
const INTERVIEW_SOURCES = new Set(["gemini", "fallback", "legacy"]);
const INTERVIEW_RECOMMENDATIONS = new Set([
  "hire", "hire_with_reservations", "negotiate", "observe", "reject",
]);
const INTERVIEW_METRIC_KEYS = Object.freeze([
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
const GUARANTEE_STATUSES = new Set([
  "requested", "formalized", "fulfilled", "overdue", "breached", "waived",
]);
const ACTIVE_APPLICATION_STATUSES = new Set(["submitted", "shortlisted", "interview", "interview_completed", "offered", "accepted"]);
const ACTIVE_INTERVIEW_STATUSES = new Set(["pending", "completed", "accepted"]);
const ACTIVE_PROPOSAL_STATUSES = new Set([
  "pending", "aguardando_resposta_diretoria", "aprovada_diretoria", "informacoes_solicitadas",
]);

const PROPOSAL_KINDS = new Set(["hiring", "renewal", "precontract"]);
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

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function identifier(value) {
  return String(value ?? "").trim();
}

function clubKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(number)))
    : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedMarketConfig(value = {}) {
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

function timestamp(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new CoachEmploymentError("Data invalida", "COACH_DATE_INVALID", 400);
  }
  return date.toISOString();
}

function nullableTimestamp(value) {
  if (value == null || value === "") return null;
  return timestamp(value);
}

function addDays(value, days) {
  return new Date(new Date(timestamp(value)).getTime() + integer(days, 0) * DAY_MS).toISOString();
}

function addYears(value, years) {
  const date = new Date(timestamp(value));
  date.setUTCFullYear(date.getUTCFullYear() + integer(years, 1, 1, 10));
  return date.toISOString();
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicId(prefix, seed) {
  return `${prefix}-${hashText(seed).toString(36)}`;
}

function operationId(input) {
  const id = identifier(input?.operationId ?? input?.requestId);
  if (!id) {
    throw new CoachEmploymentError("Operacao exige operationId", "COACH_OPERATION_ID_REQUIRED", 400);
  }
  return id;
}

function careerDate(room, supplied) {
  return timestamp(
    supplied
      ?? room?.clubCareerState?.currentDate
      ?? room?.seasonStartedAt
      ?? room?.startedAt
      ?? room?.createdAt
      ?? new Date(),
  );
}

function seasonNumber(room) {
  return integer(room?.currentSeason, 1, 1);
}

function completedRound(room) {
  const direct = integer(room?.lastCompletedRound?.round, -1, -1);
  if (direct >= 0) return direct;
  return (Array.isArray(room?.leagueMatchResults) ? room.leagueMatchResults : []).reduce((maximum, result) => {
    const fixture = (room?.leagueFixtureSchedule ?? []).find((candidate) => (
      identifier(candidate?.leagueFixtureId) === identifier(result?.leagueFixtureId)
    ));
    return Math.max(maximum, integer(fixture?.round, 0));
  }, 0);
}

function normalizedObjectives(value) {
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

function normalizeGuarantee(value) {
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

function normalizeNotification(value) {
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

function normalizeCoachAuditEntries(values, maximum = 300) {
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

function normalizeCoachInterviewMemories(values, maximum = 100) {
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

function normalizeAppointmentStatistics(value) {
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

function normalizeProposal(value) {
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

function normalizeApplication(value) {
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

function limitedInterviewText(value, maximum = 1_200) {
  return identifier(value).slice(0, maximum);
}

function interviewDepthLimits(depth) {
  if (depth === "quick") return { minimum: 2, maximum: 4 };
  if (depth === "deep") return { minimum: 4, maximum: 12 };
  return { minimum: 3, maximum: 8 };
}

function normalizeInterviewMetrics(value, fallback = 50) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(INTERVIEW_METRIC_KEYS.map((metric) => [
    metric,
    Math.round(clamp(finite(source[metric], fallback), 0, 100) * 10) / 10,
  ]));
}

function normalizeInterviewRelationshipImpact(value) {
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

function normalizeInterviewNegotiationEffects(value) {
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

function normalizeInterviewEvaluation(value, now = null, fallbackScore = 50) {
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

function normalizeInterviewTurnAnalysis(value) {
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

function normalizeInterview(value) {
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

function normalizeEvaluation(value) {
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

function catalogClubs(room) {
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

function canonicalClubId(room, value) {
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

function coachById(room, coachId) {
  const coach = (room?.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === identifier(coachId));
  if (!coach) throw new CoachEmploymentError("Treinador nao encontrado", "COACH_NOT_FOUND", 404, { coachId });
  if (!identifier(coach.name)) throw new CoachEmploymentError("Treinador sem nome", "COACH_NAME_REQUIRED", 409, { coachId });
  return coach;
}

function activeAppointmentForCoach(state, coachId) {
  return state.appointments.find((appointment) => (
    appointment.coachId === identifier(coachId) && appointment.status === "active"
  )) ?? null;
}

function activeAppointmentForClub(state, clubId) {
  const key = clubKey(clubId);
  return state.appointments.find((appointment) => (
    clubKey(appointment.clubId) === key && appointment.status === "active"
  )) ?? null;
}

function activeContractForCoach(state, coachId) {
  return state.contracts.find((contract) => (
    contract.coachId === identifier(coachId) && contract.status === "active"
  )) ?? null;
}

function activeProfessionalLifecycleRecord(room, collection, coachId) {
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

function assertCoachMayInterviewDuringNotice(room, coachId) {
  const notice = activeProfessionalLifecycleRecord(room, "notices", coachId);
  if (notice?.interviewAllowed === false) {
    throw new CoachEmploymentError(
      "O aviso previo atual nao permite entrevistas com outros clubes",
      "COACH_NOTICE_INTERVIEW_FORBIDDEN",
      409,
      { coachId: identifier(coachId), noticeId: notice.id },
    );
  }
}

function coachRetirementBlocksMarket(room, coachId) {
  return Boolean(activeProfessionalLifecycleRecord(room, "retirements", coachId));
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

function appendCareerAssignment(coach, appointment) {
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

function setHumanControl(room, coachId, clubId) {
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

function closeAppointmentMutable(room, state, appointment, now, reason, coachStatus = "unemployed") {
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

function coachConductConfig(state, options = {}) {
  return normalizeCoachConductConfig({
    ...(state?.conductConfig ?? {}),
    ...(options?.conductConfig && typeof options.conductConfig === "object" ? options.conductConfig : {}),
  });
}

function seasonProgressRatio(room) {
  const currentRound = completedRound(room);
  const schedule = Array.isArray(room?.leagueFixtureSchedule) ? room.leagueFixtureSchedule : [];
  const totalRounds = schedule.reduce((maximum, fixture) => (
    Math.max(maximum, integer(fixture?.round, 0, 0, 100))
  ), integer(room?.totalRounds ?? room?.seasonTotalRounds, 0, 0, 100));
  return totalRounds > 0 ? clamp(currentRound / totalRounds, 0, 1) : 0.5;
}

function resignationJustCauseEvidence(room, state, coach, appointment, reasonCode) {
  const finance = (room?.marketState?.finances ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(appointment.clubId)
  ));
  const morale = (room?.clubMoraleStates ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(appointment.clubId)
  ));
  const breachedGuarantees = state.guarantees.filter((guarantee) => (
    guarantee.coachId === coach.id
      && clubKey(guarantee.clubId) === clubKey(appointment.clubId)
      && ["overdue", "breached"].includes(guarantee.status)
  ));
  const unpaidWages = finite(finance?.unpaidWages ?? finance?.overduePayroll ?? finance?.latePayrollMonths, 0) > 0;
  const financialCrisis = Number.isFinite(Number(finance?.balance)) && Number(finance.balance) < 0;
  const toxicEnvironment = Number.isFinite(Number(morale?.score)) && Number(morale.score) <= 25;
  const boardTrust = Number(coach.boardConfidence ?? coach.boardRelationship ?? coach.satisfaction);
  const boardBreach = breachedGuarantees.length > 0 || (Number.isFinite(boardTrust) && boardTrust <= 10);
  const verified = (
    (reasonCode === "unpaid_wages" && unpaidWages)
    || (reasonCode === "persistent_financial_crisis" && financialCrisis)
    || (reasonCode === "broken_promises" && breachedGuarantees.length > 0)
    || (reasonCode === "toxic_environment" && toxicEnvironment)
    || (reasonCode === "board_breach" && boardBreach)
  );
  return {
    verified,
    codes: [
      ...(unpaidWages ? ["unpaid_wages"] : []),
      ...(financialCrisis ? ["financial_crisis"] : []),
      ...(breachedGuarantees.length ? ["breached_guarantees"] : []),
      ...(toxicEnvironment ? ["toxic_environment"] : []),
      ...(boardBreach ? ["board_breach"] : []),
    ],
    guaranteeIds: breachedGuarantees.map((guarantee) => guarantee.id),
  };
}

function appendCoachConductEntry(coach, entry) {
  const normalized = normalizeCoachAuditEntries([entry], 1)[0];
  if (!normalized) return null;
  coach.careerConductHistory = [
    ...(coach.careerConductHistory ?? []).filter((candidate) => candidate.id !== normalized.id),
    normalized,
  ].slice(-500);
  if (normalized.reputationDelta !== 0) {
    coach.reputationHistory = [
      ...(coach.reputationHistory ?? []).filter((candidate) => candidate.id !== normalized.id),
      normalized,
    ].slice(-300);
  }
  return normalized;
}

function applyCoachReputationChangeMutable(coach, input) {
  const requestedDelta = integer(input.delta, 0, -100, 100);
  const requestedTrustDelta = integer(input.trustDelta, requestedDelta, -100, 100);
  const before = normalizeCoachReputation100(coach.reputation ?? coach.marketReputation, 50);
  const marketBefore = normalizeCoachReputation100(coach.marketReputation ?? coach.reputation, before);
  const trustBefore = clamp(finite(coach.professionalTrust, 80), 0, 100);
  const after = clamp(before + requestedDelta, 0, 100);
  const trustAfter = clamp(trustBefore + requestedTrustDelta, 0, 100);
  const delta = Math.round(after - before);
  const trustDelta = Math.round(trustAfter - trustBefore);
  coach.reputation = after;
  coach.marketReputation = clamp(marketBefore + requestedDelta, 0, 100);
  coach.professionalTrust = trustAfter;
  return appendCoachConductEntry(coach, {
    id: deterministicId("coach-conduct", `${input.operationId}|${input.type}|${coach.id}`),
    type: input.type,
    occurredAt: input.occurredAt,
    clubId: input.clubId,
    reasonCode: input.reasonCode,
    reasonLabel: input.reasonLabel,
    reputationDelta: delta,
    reputationBefore: before,
    reputationAfter: after,
    trustDelta,
    restrictionEndsAt: input.restrictionEndsAt,
    operationId: input.operationId,
    metadata: input.metadata && typeof input.metadata === "object" ? clone(input.metadata) : {},
  });
}

function resignationPreview(room, state, coach, appointment, contract, input, now, options = {}) {
  const reasonCode = inferCoachResignationReason(input?.reasonCode, input?.reason);
  const evidence = resignationJustCauseEvidence(room, state, coach, appointment, reasonCode);
  const baseCost = integer(input?.compensation ?? contract?.terminationClause, 0, 0, MAX_MONEY);
  const initial = calculateCoachResignationConsequences({
    coach,
    appointment,
    contract,
    now,
    reasonCode,
    reason: input?.reason,
    seasonProgress: seasonProgressRatio(room),
    justCauseEvidence: evidence.verified,
    financialCost: baseCost,
  }, coachConductConfig(state, options));
  const financialCost = initial.justCauseVerified ? Math.round(baseCost * 0.15) : baseCost;
  return {
    ...initial,
    financialCost,
    evidenceCodes: evidence.codes,
    evidenceGuaranteeIds: evidence.guaranteeIds,
  };
}

function applyVoluntaryResignationConsequencesMutable(room, state, coach, appointment, contract, input, now, operationIdValue, options = {}) {
  const preview = resignationPreview(room, state, coach, appointment, contract, input, now, options);
  const record = applyCoachReputationChangeMutable(coach, {
    delta: preview.reputationDelta,
    trustDelta: preview.trustDelta,
    type: "voluntary_resignation",
    occurredAt: now,
    clubId: appointment.clubId,
    reasonCode: preview.reasonCode,
    reasonLabel: preview.reasonLabel,
    restrictionEndsAt: preview.restrictionEndsAt,
    operationId: operationIdValue,
    metadata: {
      justCauseVerified: preview.justCauseVerified,
      inactivityDays: preview.inactivityDays,
      financialCost: preview.financialCost,
      pendingProjectPenalty: preview.pendingProjectPenalty,
      midSeasonPenalty: preview.midSeasonPenalty,
      previousResignations: preview.previousResignations,
      evidenceCodes: preview.evidenceCodes,
    },
  });
  const consequences = {
    ...preview,
    reputationDelta: record?.reputationDelta ?? preview.reputationDelta,
    trustDelta: record?.trustDelta ?? preview.trustDelta,
  };
  coach.marketRestriction = {
    type: "voluntary_resignation",
    startsAt: consequences.restrictionStartsAt,
    endsAt: consequences.restrictionEndsAt,
    reasonCode: consequences.reasonCode,
    reasonLabel: consequences.reasonLabel,
    justCauseVerified: consequences.justCauseVerified,
    signingBlocked: true,
    inactivityDays: consequences.inactivityDays,
    reputationDelta: consequences.reputationDelta,
    trustDelta: consequences.trustDelta,
    operationId: operationIdValue,
    completedAt: null,
  };
  coach.resignationHistory = [...(coach.resignationHistory ?? []).filter((entry) => entry.id !== record.id), record].slice(-100);
  return consequences;
}

function assertCoachCanSign(coach, now) {
  if (["retired", "retiring"].includes(coach?.status)) {
    throw new CoachEmploymentError(
      "Treinador com aposentadoria confirmada nao pode assinar",
      "COACH_RETIREMENT_MARKET_BLOCK",
      409,
    );
  }
  const restriction = activeCoachMarketRestriction(coach, now);
  if (!restriction || restriction.signingBlocked === false) return;
  throw new CoachEmploymentError(
    `Treinador impedido de assinar ate ${restriction.endsAt}`,
    "COACH_MARKET_RESTRICTION_ACTIVE",
    409,
    {
      endsAt: restriction.endsAt,
      remainingDays: restriction.remainingDays,
      canInterview: true,
      canSign: false,
      reasonCode: restriction.reasonCode,
    },
  );
}

function applyCoachRecoveryMutable(state, coach, input, now, events, processed, options = {}) {
  const operationIdValue = identifier(input.operationId);
  if (!operationIdValue || hasProcessed(state, operationIdValue)) return null;
  const delta = coachRecoveryDelta(input.kind, input, coachConductConfig(state, options));
  if (delta <= 0) return null;
  const entry = applyCoachReputationChangeMutable(coach, {
    delta,
    trustDelta: Math.max(1, delta),
    type: input.kind,
    occurredAt: now,
    clubId: input.clubId,
    reasonCode: input.reasonCode ?? input.kind,
    reasonLabel: input.reasonLabel,
    operationId: operationIdValue,
    metadata: input.metadata,
  });
  events.push(eventRecord("COACH_REPUTATION_RECOVERED", operationIdValue, now, {
    coachId: coach.id,
    clubId: input.clubId,
    metadata: {
      source: input.kind,
      reputationDelta: entry?.reputationDelta ?? delta,
      reputationAfter: entry?.reputationAfter,
    },
  }));
  processed.push(operationIdValue);
  return entry;
}

function processCoachConductProgressMutable(room, state, now, options, events, processed) {
  for (const coach of room.coachCareerState?.coaches ?? []) {
    const restriction = coach.marketRestriction;
    if (restriction?.type === "voluntary_resignation"
      && !restriction.completedAt
      && new Date(restriction.endsAt ?? 0).getTime() <= new Date(now).getTime()) {
      const id = `coach-market-restriction-complete:${coach.id}:${restriction.endsAt}`;
      if (!hasProcessed(state, id)) {
        restriction.completedAt = now;
        restriction.signingBlocked = false;
        appendCoachConductEntry(coach, {
          id: deterministicId("coach-conduct", id),
          type: "market_restriction_completed",
          occurredAt: now,
          reasonCode: restriction.reasonCode,
          reasonLabel: "Periodo de inatividade concluido",
          restrictionEndsAt: restriction.endsAt,
          operationId: id,
        });
        appendNotification(state, {
          type: "COACH_MARKET_RESTRICTION_COMPLETED",
          recipientId: coach.id,
          recipientRole: "coach",
          coachId: coach.id,
          title: "Liberado para assinar",
          message: "Periodo obrigatorio sem clube concluido.",
        }, now, id);
        events.push(eventRecord("COACH_MARKET_RESTRICTION_COMPLETED", id, now, {
          coachId: coach.id,
          metadata: { restrictionEndsAt: restriction.endsAt },
        }));
        processed.push(id);
      }
    }
  }

  for (const appointment of state.appointments.filter((candidate) => (
    candidate.status === "active" && candidate.role === "head_coach"
  ))) {
    const startedAt = new Date(appointment.startedAt ?? appointment.appointedAt ?? now).getTime();
    const fullYears = Number.isFinite(startedAt)
      ? Math.min(10, Math.floor((new Date(now).getTime() - startedAt) / (365 * DAY_MS)))
      : 0;
    const coach = coachById(room, appointment.coachId);
    for (let year = 1; year <= fullYears; year += 1) {
      applyCoachRecoveryMutable(state, coach, {
        kind: "long_tenure",
        operationId: `coach-long-tenure:${appointment.id}:year-${year}`,
        clubId: appointment.clubId,
        reasonLabel: `${year} ano(s) de estabilidade profissional`,
        metadata: { appointmentId: appointment.id, completedYears: year },
      }, now, events, processed, options);
    }
  }

  const titleWinners = [];
  const seenTitles = new Set();
  const addTitleWinner = (winner, source, sourceSeason, index) => {
    const competitionId = identifier(winner?.tournamentId ?? winner?.competitionId ?? winner?.id) || `title-${index}`;
    const clubId = identifier(winner?.clubId ?? winner?.winnerClubId);
    const titleKey = `${sourceSeason}:${competitionId}:${clubId}`;
    if (!clubId || seenTitles.has(titleKey)) return;
    seenTitles.add(titleKey);
    titleWinners.push({ winner, source, sourceSeason, index, competitionId, clubId });
  };
  for (const [index, winner] of (room?.competitionSeason?.winners ?? []).entries()) {
    addTitleWinner(winner, "current", seasonNumber(room), index);
  }
  for (const [seasonIndex, season] of (room?.seasonHistory ?? []).entries()) {
    for (const [index, winner] of (season?.tournamentWinners ?? []).entries()) {
      addTitleWinner(winner, "archive", integer(season?.seasonNumber, seasonIndex + 1, 1), index);
    }
  }
  for (const [index, winner] of [
    ...(room?.competitionWinners ?? []),
    ...(room?.tournamentWinners ?? []),
  ].entries()) {
    addTitleWinner(winner, "legacy", integer(winner?.season, seasonNumber(room), 1), index);
  }

  for (const { winner, source, sourceSeason, index, competitionId, clubId } of titleWinners) {
    let coachId = identifier(winner?.coachId ?? winner?.managerId);
    if (!coachId && source === "current") {
      coachId = state.appointments
        .filter((appointment) => (
          appointment.role === "head_coach"
            && appointment.status === "active"
            && clubKey(appointment.clubId) === clubKey(clubId)
        ))
        .sort((left, right) => String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")))[0]?.coachId;
    }
    const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === coachId);
    if (!coach) continue;
    const winnerId = identifier(winner?.id)
      || `${competitionId}:${sourceSeason}:${clubId}:${index}`;
    applyCoachRecoveryMutable(state, coach, {
      kind: "title_won",
      operationId: `coach-title-recovery:${coach.id}:${winnerId}`,
      clubId,
      reasonLabel: "Titulo conquistado",
      metadata: { winnerId, competitionId, seasonNumber: sourceSeason, source },
    }, now, events, processed, options);
  }
}

function eventRecord(type, operationIdValue, now, values = {}) {
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

function proposalTerms(proposal, override = {}) {
  return {
    wage: integer(override.wage ?? proposal?.wage, 0, 0, 20_000_000),
    durationYears: integer(override.durationYears ?? proposal?.durationYears, 2, 1, 10),
    terminationClause: integer(override.terminationClause ?? proposal?.terminationClause, 0, 0, MAX_MONEY),
    signingBonus: integer(override.signingBonus ?? proposal?.signingBonus, 0, 0, MAX_MONEY),
    compensation: integer(override.compensation ?? proposal?.compensation, 0, 0, MAX_MONEY),
    transferBudget: override.transferBudget == null
      ? proposal?.transferBudget == null ? null : integer(proposal.transferBudget, 0, 0, MAX_MONEY)
      : integer(override.transferBudget, 0, 0, MAX_MONEY),
    autonomyDelta: Math.round(clamp(finite(override.autonomyDelta ?? proposal?.autonomyDelta), -20, 20) * 10) / 10,
    objectiveDifficultyDelta: Math.round(clamp(finite(
      override.objectiveDifficultyDelta ?? proposal?.objectiveDifficultyDelta,
    ), -15, 15) * 10) / 10,
    objectives: normalizedObjectives(override.objectives ?? proposal?.objectives),
    specialClauses: (Array.isArray(override.specialClauses ?? override.clauses)
      ? override.specialClauses ?? override.clauses
      : Array.isArray(proposal?.specialClauses) ? proposal.specialClauses : [])
      .map(identifier).filter(Boolean).slice(0, 20),
    bonuses: override.bonuses && typeof override.bonuses === "object"
      ? clone(override.bonuses)
      : proposal?.bonuses && typeof proposal.bonuses === "object" ? clone(proposal.bonuses) : {},
  };
}

function appendDecision(record, input, now, operationIdValue) {
  const previousStatus = identifier(input.previousStatus ?? record.status) || null;
  const newStatus = identifier(input.newStatus ?? record.status) || null;
  const decision = {
    id: deterministicId("coach-decision", `${operationIdValue}|${record.id}|${input.action}`),
    action: identifier(input.action) || "status_change",
    responsibleId: identifier(input.responsibleId) || "system",
    responsibleRole: identifier(input.responsibleRole) || "system",
    decidedAt: now,
    justification: identifier(input.justification) || null,
    previousStatus,
    newStatus,
    negotiatedValues: input.negotiatedValues && typeof input.negotiatedValues === "object"
      ? clone(input.negotiatedValues)
      : {},
    conditions: Array.isArray(input.conditions) ? clone(input.conditions).slice(0, 30) : [],
    operationId: operationIdValue,
  };
  record.decisionHistory = [...(record.decisionHistory ?? []).filter((entry) => entry.id !== decision.id), decision].slice(-100);
  if (Object.prototype.hasOwnProperty.call(record, "history")) {
    record.history = clone(record.decisionHistory);
  }
  return decision;
}

function appendNotification(state, input, now, operationIdValue) {
  const notification = normalizeNotification({
    ...input,
    id: identifier(input.id) || deterministicId(
      "coach-notification",
      `${operationIdValue}|${input.type}|${input.recipientRole}|${input.recipientId ?? ""}|${input.guaranteeId ?? ""}`,
    ),
    createdAt: now,
    operationId: operationIdValue,
  });
  if (!notification) return null;
  const existing = state.notifications.find((entry) => entry.id === notification.id);
  if (existing) return existing;
  state.notifications.push(notification);
  return notification;
}

function guaranteesForProposal(state, proposal) {
  const ids = new Set(proposal?.guaranteeIds ?? []);
  return state.guarantees.filter((guarantee) => guarantee.proposalId === proposal?.id || ids.has(guarantee.id));
}

function isStaffPackageGuarantee(guarantee) {
  const kind = identifier(guarantee?.kind ?? guarantee?.category).toLocaleLowerCase("en-US");
  return kind === "staff_package" || (guarantee?.effects ?? []).some((effect) => (
    identifier(effect?.type ?? effect?.kind).toLocaleLowerCase("en-US") === "staff_package"
  ));
}

function staffPackageFromGuarantee(guarantee) {
  if (!guarantee || !isStaffPackageGuarantee(guarantee)) return null;
  if (guarantee.staffPackage && typeof guarantee.staffPackage === "object") {
    return clone(guarantee.staffPackage);
  }
  const effect = (guarantee.effects ?? []).find((candidate) => (
    identifier(candidate?.type ?? candidate?.kind).toLocaleLowerCase("en-US") === "staff_package"
  ));
  if (!effect) return null;
  if (effect.staffPackage && typeof effect.staffPackage === "object") return clone(effect.staffPackage);
  return clone(effect);
}

function preferredPersonalStaffPackage(room, proposal, now) {
  const coach = (room?.coachCareerState?.coaches ?? []).find((candidate) => (
    identifier(candidate?.id) === identifier(proposal?.coachId)
  ));
  if (!coach || coach.managerType === "human") return null;
  const preferred = room?.professionalLifecycleState?.preferredStaffByCoach?.[coach.id];
  if (!Array.isArray(preferred) || preferred.length === 0) return null;
  const professionals = [
    ...(room?.clubCareerState?.staffMembers ?? []),
    ...(room?.clubCareerState?.staffCandidates ?? []),
  ];
  const contracts = room?.clubCareerState?.staffContracts ?? [];
  const seen = new Set();
  const members = [];
  for (const entry of preferred) {
    const affiliationType = identifier(entry?.affiliationType ?? entry?.linkType)
      .toLocaleLowerCase("en-US");
    if (!["personal_team", "personal_staff"].includes(affiliationType)) continue;
    const staffId = identifier(entry?.staffId ?? entry?.professionalId);
    if (!staffId || seen.has(staffId)) continue;
    seen.add(staffId);
    const professional = professionals.find((candidate) => identifier(candidate?.id) === staffId) ?? null;
    if (professional?.clubId && clubKey(professional.clubId) === clubKey(proposal.clubId)) continue;
    const activeContract = contracts.find((contract) => (
      identifier(contract?.staffId ?? contract?.professionalId) === staffId
        && contract?.status === "active"
        && (!contract.endDate || new Date(contract.endDate).getTime() > new Date(now).getTime())
    )) ?? null;
    const monthlyCost = integer(
      entry?.estimatedMonthlyCost
        ?? entry?.monthlyCost
        ?? activeContract?.wage
        ?? professional?.salary
        ?? professional?.wage,
      0,
      0,
      10_000_000,
    );
    const signingBonus = integer(entry?.signingBonus, monthlyCost, 0, MAX_MONEY);
    const buyout = professional?.clubId && clubKey(professional.clubId) !== clubKey(proposal.clubId)
      ? integer(
        entry?.buyout
          ?? activeContract?.terminationClause
          ?? activeContract?.releaseClause
          ?? activeContract?.compensation,
        0,
        0,
        MAX_MONEY,
      )
      : 0;
    const firstYearCost = Math.min(MAX_MONEY, monthlyCost * 12 + signingBonus + buyout);
    members.push({
      staffId,
      name: identifier(professional?.name ?? entry?.name) || staffId,
      role: identifier(entry?.role ?? professional?.role) || null,
      affiliationType: "personal_team",
      sourceClubId: identifier(professional?.clubId) || null,
      available: entry?.available !== false,
      recruitable: professional?.status !== "retired",
      monthlyCost,
      wage: monthlyCost,
      signingBonus,
      buyout,
      firstYearCost,
    });
  }
  if (members.length === 0) return null;
  const monthlyCost = members.reduce(
    (total, member) => Math.min(MAX_MONEY, total + member.monthlyCost),
    0,
  );
  const firstYearCost = members.reduce(
    (total, member) => Math.min(MAX_MONEY, total + member.firstYearCost),
    0,
  );
  const expectedHiringBy = addDays(proposal?.plannedStartDate ?? now, 30);
  return {
    version: 1,
    kind: "staff_package",
    coachId: coach.id,
    clubId: proposal.clubId,
    requiredByCoach: true,
    requestedAt: now,
    expectedHiringBy,
    staffIds: members.map((member) => member.staffId),
    headcount: members.length,
    monthlyCost,
    firstYearCost,
    members,
  };
}

function staffPackageCovers(packageValue, requiredPackage) {
  if (!packageValue || !requiredPackage) return false;
  const coveredIds = new Set((packageValue.staffIds ?? packageValue.members?.map((member) => member?.staffId) ?? [])
    .map(identifier).filter(Boolean));
  return requiredPackage.staffIds.every((staffId) => coveredIds.has(staffId));
}

function requiredStaffPackageGuarantee(state, proposal, requiredPackage, allowedStatuses = null) {
  return guaranteesForProposal(state, proposal).find((guarantee) => (
    isStaffPackageGuarantee(guarantee)
      && (!allowedStatuses || allowedStatuses.includes(guarantee.status))
      && staffPackageCovers(staffPackageFromGuarantee(guarantee), requiredPackage)
  )) ?? null;
}

function registerRequiredStaffPackageGuarantee(room, state, proposal, now, operationIdValue) {
  const staffPackage = preferredPersonalStaffPackage(room, proposal, now);
  if (!staffPackage) return { staffPackage: null, guarantee: null };
  const existing = requiredStaffPackageGuarantee(state, proposal, staffPackage);
  if (existing) return { staffPackage, guarantee: existing };
  const guarantee = registerProposalGuarantees(state, proposal, [{
    kind: "staff_package",
    category: "staff_package",
    description: `Contratar a comissao pessoal de ${staffPackage.headcount} profissional(is)`,
    staffPackage,
    dueAt: staffPackage.expectedHiringBy,
    mandatory: true,
    blocksCompletion: true,
    effects: [{
      type: "staff_package",
      action: "hire_coach_staff_package",
      coachId: staffPackage.coachId,
      clubId: staffPackage.clubId,
      staffIds: staffPackage.staffIds,
      members: staffPackage.members,
      monthlyCost: staffPackage.monthlyCost,
      firstYearCost: staffPackage.firstYearCost,
      maximumFirstYearCost: staffPackage.firstYearCost,
      expectedHiringBy: staffPackage.expectedHiringBy,
      staffPackage,
    }],
  }], now, operationIdValue, {
    status: "requested",
    mandatory: true,
    blocksCompletion: true,
    dueAt: staffPackage.expectedHiringBy,
  })[0] ?? null;
  return { staffPackage, guarantee };
}

function ensureRequiredStaffPackageApproved(room, state, proposal) {
  const requiredPackage = preferredPersonalStaffPackage(
    room,
    proposal,
    proposal?.updatedAt ?? state.currentDate ?? new Date().toISOString(),
  );
  if (!requiredPackage) return null;
  const approved = requiredStaffPackageGuarantee(
    state,
    proposal,
    requiredPackage,
    ["formalized", "fulfilled"],
  );
  if (approved) return approved;
  const requested = requiredStaffPackageGuarantee(state, proposal, requiredPackage);
  throw new CoachEmploymentError(
    requested
      ? "Pacote da comissao pessoal ainda nao foi aprovado pela diretoria"
      : "Treinador exige garantia para contratar sua comissao pessoal",
    requested
      ? "COACH_STAFF_PACKAGE_NOT_APPROVED"
      : "COACH_STAFF_PACKAGE_GUARANTEE_REQUIRED",
    409,
    {
      proposalId: proposal.id,
      guaranteeId: requested?.id ?? null,
      staffIds: requiredPackage.staffIds,
      monthlyCost: requiredPackage.monthlyCost,
      firstYearCost: requiredPackage.firstYearCost,
    },
  );
}

function refreshCoachMarketStatus(state, coach) {
  if (["notice", "retiring", "retired"].includes(coach.status)) return;
  if (coach.currentClubId) {
    const appointment = activeAppointmentForCoach(state, coach.id);
    coach.status = appointment?.role === "interim" ? "interim" : "employed";
    return;
  }
  coach.status = state.proposals.some((proposal) => (
    proposal.coachId === coach.id && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  )) ? "negotiating" : "unemployed";
}

function unresolvedMandatoryGuarantees(state, proposal) {
  return guaranteesForProposal(state, proposal).filter((guarantee) => (
    guarantee.mandatory
      && guarantee.blocksCompletion
      && !["formalized", "fulfilled", "waived"].includes(guarantee.status)
  ));
}

function ensureProposalCanComplete(room, state, proposal) {
  if (proposal.status === "aguardando_resposta_diretoria") {
    throw new CoachEmploymentError(
      "Contraproposta aguarda resposta da diretoria",
      "COACH_COUNTERPROPOSAL_AWAITING_BOARD",
      409,
      { proposalId: proposal.id },
    );
  }
  if (proposal.status === "informacoes_solicitadas") {
    throw new CoachEmploymentError(
      "A diretoria aguarda informacoes adicionais",
      "COACH_PROPOSAL_INFORMATION_REQUIRED",
      409,
      { proposalId: proposal.id },
    );
  }
  ensureRequiredStaffPackageApproved(room, state, proposal);
  const unresolved = unresolvedMandatoryGuarantees(state, proposal);
  if (unresolved.length > 0) {
    throw new CoachEmploymentError(
      "Garantia obrigatoria ainda nao foi formalizada",
      "COACH_GUARANTEE_BLOCKS_COMPLETION",
      409,
      { proposalId: proposal.id, guaranteeIds: unresolved.map((guarantee) => guarantee.id) },
    );
  }
  const scheduledCoachConflict = state.appointments.find((appointment) => (
    appointment.status === "scheduled"
      && appointment.coachId === proposal.coachId
      && appointment.proposalId !== proposal.id
  ));
  if (scheduledCoachConflict) {
    throw new CoachEmploymentError(
      "Treinador ja possui compromisso futuro",
      "COACH_SCHEDULED_APPOINTMENT_CONFLICT",
      409,
      { proposalId: proposal.id, appointmentId: scheduledCoachConflict.id },
    );
  }
  const scheduledClubConflict = state.appointments.find((appointment) => (
    appointment.status === "scheduled"
      && clubKey(appointment.clubId) === clubKey(proposal.clubId)
      && appointment.proposalId !== proposal.id
  ));
  if (scheduledClubConflict) {
    throw new CoachEmploymentError(
      "Clube ja possui treinador agendado",
      "CLUB_SCHEDULED_APPOINTMENT_CONFLICT",
      409,
      { proposalId: proposal.id, appointmentId: scheduledClubConflict.id },
    );
  }
}

function ensureClubCanFundProposal(room, state, proposal) {
  const funds = availableClubFunds(room, proposal.clubId);
  if (funds == null) return;
  const upfrontCost = integer(proposal.compensation, 0, 0, MAX_MONEY)
    + integer(proposal.signingBonus, 0, 0, MAX_MONEY);
  const salaryCommitment = salarySolvencyCostForTerms(proposal.wage, proposal.durationYears);
  const staffPackageFirstYearCost = guaranteesForProposal(state, proposal)
    .filter((guarantee) => ["formalized", "fulfilled"].includes(guarantee.status))
    .reduce((total, guarantee) => Math.min(
      MAX_MONEY,
      total + integer(staffPackageFromGuarantee(guarantee)?.firstYearCost, 0, 0, MAX_MONEY),
    ), 0);
  const required = Math.min(
    MAX_MONEY,
    upfrontCost + salaryCommitment + staffPackageFirstYearCost,
  );
  if (funds < required) {
    throw new CoachEmploymentError(
      "Clube nao possui saldo para concluir o acordo",
      "COACH_PROPOSAL_BUDGET_CHANGED",
      409,
      {
        proposalId: proposal.id,
        available: funds,
        required,
        upfrontCost,
        salaryCommitment,
        staffPackageFirstYearCost,
      },
    );
  }
}

function assertProposalVacancyOpen(state, proposal) {
  if (!proposal.vacancyId) return null;
  const vacancy = state.vacancies.find((candidate) => candidate.id === proposal.vacancyId);
  if (!vacancy) throw new CoachEmploymentError("Vaga nao encontrada", "COACH_VACANCY_NOT_FOUND", 404);
  if (vacancy.status !== "open") {
    throw new CoachEmploymentError("Vaga encerrada", "COACH_VACANCY_CLOSED", 409, {
      vacancyId: vacancy.id,
      status: vacancy.status,
    });
  }
  return vacancy;
}

function registerProposalGuarantees(state, proposal, values, now, operationIdValue, defaults = {}) {
  const source = (Array.isArray(values) ? values : values == null ? [] : [values]).slice(0, 20);
  const created = [];
  for (const [index, entry] of source.entries()) {
    const raw = entry && typeof entry === "object" ? entry : { description: entry };
    const description = identifier(raw.description ?? raw.text ?? raw.label);
    if (!description) continue;
    const guarantee = normalizeGuarantee({
      ...raw,
      id: identifier(raw.id) || deterministicId("coach-guarantee", `${operationIdValue}|${proposal.id}|${index}|${description}`),
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      applicationId: proposal.applicationId,
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      responsibleId: raw.responsibleId ?? defaults.responsibleId ?? proposal.clubId,
      responsibleRole: raw.responsibleRole ?? defaults.responsibleRole ?? "board",
      dueAt: raw.dueAt ?? defaults.dueAt,
      status: raw.status ?? defaults.status ?? "requested",
      mandatory: raw.mandatory ?? defaults.mandatory ?? true,
      blocksCompletion: raw.blocksCompletion ?? defaults.blocksCompletion ?? true,
      effects: raw.effects ?? defaults.effects ?? [],
      createdAt: raw.createdAt ?? now,
      updatedAt: now,
      operationId: operationIdValue,
    });
    if (!guarantee) continue;
    const existing = state.guarantees.find((candidate) => candidate.id === guarantee.id);
    if (!existing) state.guarantees.push(guarantee);
    const resolved = existing ?? guarantee;
    if (!proposal.guaranteeIds.includes(resolved.id)) proposal.guaranteeIds.push(resolved.id);
    created.push(resolved);
  }
  return created;
}

function contractGuaranteeTerms(state, proposal) {
  const guarantees = guaranteesForProposal(state, proposal).filter((guarantee) => (
    ["formalized", "fulfilled"].includes(guarantee.status)
  ));
  const clauses = guarantees.flatMap((guarantee) => guarantee.effects.flatMap((effect) => {
    if (effect?.type !== "contract_clause" && effect?.kind !== "contract_clause") return [];
    return [{
      guaranteeId: guarantee.id,
      description: identifier(effect.description ?? effect.clause) || guarantee.description,
      mandatory: guarantee.mandatory,
    }];
  }));
  const staffPackageCommitments = guarantees.flatMap((guarantee) => {
    const staffPackage = staffPackageFromGuarantee(guarantee);
    if (!staffPackage) return [];
    return [{
      guaranteeId: guarantee.id,
      status: guarantee.status,
      dueAt: guarantee.dueAt ?? staffPackage.expectedHiringBy ?? null,
      action: "hire_coach_staff_package",
      ...staffPackage,
    }];
  });
  return {
    guaranteeIds: guarantees.map((guarantee) => guarantee.id),
    clauses,
    staffPackageCommitments,
  };
}

function financeRecord(direction, category, operationIdValue, now, values = {}) {
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

function emitCallbacks(room, events, transactions, options) {
  for (const transaction of transactions) {
    if (transaction.amount <= 0) continue;
    if (transaction.direction === "income") options.credit?.(room, clone(transaction));
    else options.debit?.(room, clone(transaction));
  }
  for (const event of events) options.recordEvent?.(room, clone(event));
}

function hasProcessed(state, id) {
  return state.processedOperationIds.includes(id);
}

function markProcessed(state, ...ids) {
  state.processedOperationIds = [...new Set([
    ...state.processedOperationIds,
    ...ids.map(identifier).filter(Boolean),
  ])].slice(-RETENTION.processedOperationIds);
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

function synchronizeCareerAndRetain(room, state, now) {
  synchronizeCoachCareerHistory(room, state, now);
  retainState(state);
}

function duplicateResult(room, id) {
  const state = room.coachEmploymentState;
  if (!hasProcessed(state, id)) return null;
  const find = (field) => state[field]?.find((entry) => entry.operationId === id) ?? null;
  return {
    room,
    duplicate: true,
    operationId: id,
    contract: clone(find("contracts")),
    proposal: clone(find("proposals")),
    vacancy: clone(find("vacancies")),
    application: clone(find("applications")),
    interview: clone(find("interviews")),
    appointment: clone(find("appointments")),
    evaluation: clone(find("evaluations")),
    guarantee: clone(find("guarantees")),
    notification: clone(find("notifications")),
    events: [],
    financialTransactions: [],
  };
}

function contractTerms(room, coach, clubId, input, now, id, role = "head_coach") {
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

function appointmentRecord(room, coachId, clubId, contractId, input, now, id, role = "head_coach") {
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

function openVacancyMutable(room, state, clubId, reason, now, id) {
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

function interimBonusTransactionMutable(appointment, now) {
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

function createInterimMutable(room, state, clubId, reason, now, id, options = {}) {
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

function fillVacancyMutable(room, state, input, now, operationIdValue, events = []) {
  const clubId = canonicalClubId(room, input.clubId);
  const explicitVacancyId = identifier(input.vacancyId);
  const selectedProposalId = identifier(input.proposalId);
  const selectedApplicationId = identifier(input.applicationId);
  const coachId = identifier(input.coachId);
  const matching = state.vacancies.filter((vacancy) => (
    (explicitVacancyId ? vacancy.id === explicitVacancyId : clubKey(vacancy.clubId) === clubKey(clubId))
      && ["open", "filled"].includes(vacancy.status)
  ));
  if (explicitVacancyId && matching.length === 0) {
    throw new CoachEmploymentError("Vaga nao encontrada", "COACH_VACANCY_NOT_FOUND", 404, { vacancyId: explicitVacancyId });
  }

  for (const vacancy of matching) {
    if (vacancy.status === "filled") {
      if (vacancy.appointedCoachId !== coachId) {
        throw new CoachEmploymentError("Vaga ja preenchida", "COACH_VACANCY_ALREADY_FILLED", 409, {
          vacancyId: vacancy.id,
          appointedCoachId: vacancy.appointedCoachId,
        });
      }
      continue;
    }
    vacancy.status = "filled";
    vacancy.marketStage = "completed";
    vacancy.lastMarketActionAt = now;
    vacancy.filledAt = now;
    vacancy.appointedCoachId = coachId;
    vacancy.filledProposalId = selectedProposalId || null;
    const inferredApplication = state.applications.find((application) => (
      application.vacancyId === vacancy.id && application.coachId === coachId
    ));
    vacancy.filledApplicationId = selectedApplicationId || inferredApplication?.id || null;
    vacancy.closureOperationId = operationIdValue;

    for (const application of state.applications.filter((candidate) => candidate.vacancyId === vacancy.id)) {
      const hired = application.id === vacancy.filledApplicationId
        || (!vacancy.filledApplicationId && application.coachId === coachId);
      if (hired) {
        if (application.status !== "contratado") {
          const previousStatus = application.status;
          application.status = "contratado";
          application.updatedAt = now;
          application.closedAt = now;
          application.closedReason = "candidate_hired";
          application.closedBy = operationIdValue;
          appendDecision(application, {
            action: "candidate_hired",
            responsibleId: "system",
            responsibleRole: "system",
            previousStatus,
            newStatus: application.status,
            justification: "Vaga preenchida pelo candidato contratado",
          }, now, `${operationIdValue}:application:${application.id}`);
        }
      } else if (ACTIVE_APPLICATION_STATUSES.has(application.status)) {
        const previousStatus = application.status;
        application.status = "encerrado_vaga_preenchida";
        application.updatedAt = now;
        application.closedAt = now;
        application.closedReason = "vacancy_filled";
        application.closedBy = operationIdValue;
        appendDecision(application, {
          action: "vacancy_filled",
          responsibleId: "system",
          responsibleRole: "system",
          previousStatus,
          newStatus: application.status,
          justification: "Processo encerrado automaticamente porque a vaga foi preenchida",
        }, now, `${operationIdValue}:application:${application.id}`);
        appendNotification(state, {
          type: "COACH_APPLICATION_CLOSED_VACANCY_FILLED",
          recipientId: application.coachId,
          recipientRole: "coach",
          coachId: application.coachId,
          clubId: vacancy.clubId,
          vacancyId: vacancy.id,
          applicationId: application.id,
          title: "Processo seletivo encerrado",
          message: "A vaga foi preenchida por outro candidato.",
        }, now, `${operationIdValue}:application:${application.id}`);
      }
    }

    const applicationIds = new Set(state.applications
      .filter((application) => application.vacancyId === vacancy.id)
      .map((application) => application.id));
    for (const interview of state.interviews.filter((candidate) => (
      candidate.vacancyId === vacancy.id || applicationIds.has(candidate.applicationId)
    ))) {
      const hired = interview.coachId === coachId
        && (!vacancy.filledApplicationId || interview.applicationId === vacancy.filledApplicationId);
      if (hired) {
        if (interview.status !== "contratado") {
          const previousStatus = interview.status;
          interview.status = "contratado";
          interview.closedAt = now;
          interview.closedReason = "candidate_hired";
          interview.closedBy = operationIdValue;
          appendDecision(interview, {
            action: "candidate_hired", responsibleId: "system", responsibleRole: "system",
            previousStatus, newStatus: interview.status,
          }, now, `${operationIdValue}:interview:${interview.id}`);
        }
      } else if (ACTIVE_INTERVIEW_STATUSES.has(interview.status)) {
        const previousStatus = interview.status;
        interview.status = "encerrado_vaga_preenchida";
        interview.closedAt = now;
        interview.closedReason = "vacancy_filled";
        interview.closedBy = operationIdValue;
        appendDecision(interview, {
          action: "vacancy_filled", responsibleId: "system", responsibleRole: "system",
          previousStatus, newStatus: interview.status,
        }, now, `${operationIdValue}:interview:${interview.id}`);
      }
    }

    for (const proposal of state.proposals.filter((candidate) => (
      candidate.id !== selectedProposalId
        && (candidate.vacancyId === vacancy.id
          || (!candidate.vacancyId && clubKey(candidate.clubId) === clubKey(vacancy.clubId)))
    ))) {
      if (!ACTIVE_PROPOSAL_STATUSES.has(proposal.status)) continue;
      const previousStatus = proposal.status;
      proposal.status = "encerrado_vaga_preenchida";
      proposal.updatedAt = now;
      proposal.respondedAt = now;
      proposal.closedAt = now;
      proposal.closedReason = "vacancy_filled";
      proposal.closedBy = operationIdValue;
      proposal.pendingCounterproposal = null;
      appendDecision(proposal, {
        action: "vacancy_filled", responsibleId: "system", responsibleRole: "system",
        previousStatus, newStatus: proposal.status,
        justification: "Negociacao encerrada porque a vaga foi preenchida",
      }, now, `${operationIdValue}:proposal:${proposal.id}`);
      const candidateAlreadyNotified = state.applications.some((application) => (
        application.vacancyId === vacancy.id && application.coachId === proposal.coachId
      ));
      if (!candidateAlreadyNotified) {
        appendNotification(state, {
          type: "COACH_PROPOSAL_CLOSED_VACANCY_FILLED",
          recipientId: proposal.coachId,
          recipientRole: "coach",
          coachId: proposal.coachId,
          clubId: vacancy.clubId,
          proposalId: proposal.id,
          vacancyId: vacancy.id,
          title: "Negociacao encerrada",
          message: "A vaga foi preenchida por outro candidato.",
        }, now, `${operationIdValue}:proposal:${proposal.id}`);
      }
    }

    appendNotification(state, {
      type: "COACH_VACANCY_FILLED",
      recipientId: identifier(vacancy.recruiterId) || vacancy.clubId,
      recipientRole: identifier(vacancy.recruiterId) ? "recruiter" : "board",
      coachId,
      clubId: vacancy.clubId,
      vacancyId: vacancy.id,
      applicationId: vacancy.filledApplicationId,
      title: "Vaga preenchida",
      message: "Os demais processos seletivos foram encerrados automaticamente.",
    }, now, `${operationIdValue}:vacancy:${vacancy.id}`);
    events.push(eventRecord("COACH_VACANCY_FILLED", `${operationIdValue}:vacancy:${vacancy.id}`, now, {
      coachId,
      clubId: vacancy.clubId,
      proposalId: selectedProposalId,
      vacancyId: vacancy.id,
      metadata: { applicationId: vacancy.filledApplicationId },
    }));
  }
  return matching;
}

function appointmentFinancials(state, coach, targetClubId, input, now, id) {
  const sourceAppointment = activeAppointmentForCoach(state, coach.id);
  const sourceContract = sourceAppointment ? activeContractForCoach(state, coach.id) : null;
  const sourceClubId = sourceAppointment?.clubId ?? null;
  const compensation = sourceClubId && clubKey(sourceClubId) !== clubKey(targetClubId)
    ? integer(input?.compensation ?? sourceContract?.terminationClause, 0, 0, MAX_MONEY)
    : 0;
  const signingBonus = integer(input?.signingBonus, 0, 0, MAX_MONEY);
  const transactions = [];
  if (compensation + signingBonus > 0) transactions.push(financeRecord("expense", "coach_hiring", id, now, {
    id: `${id}:buyer`,
    clubId: targetClubId,
    relatedClubId: sourceClubId,
    coachId: coach.id,
    amount: compensation + signingBonus,
    description: `Contratacao de ${coach.name}`,
    metadata: { compensation, signingBonus },
  }));
  if (sourceClubId && compensation > 0) transactions.push(financeRecord("income", "coach_compensation", id, now, {
    id: `${id}:seller`,
    clubId: sourceClubId,
    relatedClubId: targetClubId,
    coachId: coach.id,
    amount: compensation,
    description: `Multa pela saida de ${coach.name}`,
  }));
  return { sourceAppointment, sourceContract, sourceClubId, compensation, signingBonus, transactions };
}

function performImmediateAppointment(room, state, input, now, id) {
  const coach = coachById(room, input.coachId);
  if (coach.status === "retired") throw new CoachEmploymentError("Treinador aposentado", "COACH_RETIRED", 409);
  const clubId = canonicalClubId(room, input.clubId);
  if (!clubId) throw new CoachEmploymentError("Clube obrigatorio", "COACH_CLUB_REQUIRED", 400);
  const activeAtTarget = activeAppointmentForClub(state, clubId);
  if (activeAtTarget?.coachId === coach.id && activeAtTarget.role === (input.role ?? "head_coach")) {
    throw new CoachEmploymentError("Treinador ja ocupa o cargo", "COACH_ALREADY_AT_CLUB", 409);
  }

  const finance = appointmentFinancials(state, coach, clubId, input, now, id);
  const events = [];
  const transactions = [...finance.transactions];
  if (activeAtTarget && activeAtTarget.coachId !== coach.id) {
    const targetContract = activeContractForCoach(state, activeAtTarget.coachId);
    const targetPenalty = activeAtTarget.role === "interim"
      ? 0
      : integer(targetContract?.terminationClause, 0, 0, MAX_MONEY);
    const previous = closeAppointmentMutable(room, state, activeAtTarget, now, "replaced_by_appointment", "dismissed");
    if (targetPenalty > 0) transactions.push(financeRecord("expense", "coach_termination", id, now, {
      id: `${id}:target-termination`, clubId, coachId: previous.coach.id, amount: targetPenalty,
      description: `Rescisao de ${previous.coach.name}`,
    }));
    events.push(eventRecord("COACH_REPLACED", `${id}:replaced`, now, {
      coachId: previous.coach.id, clubId, contractId: previous.contract?.id, amount: targetPenalty,
      relatedClubId: clubId, metadata: { replacementCoachId: coach.id },
    }));
  }

  if (finance.sourceAppointment && clubKey(finance.sourceClubId) !== clubKey(clubId)) {
    closeAppointmentMutable(room, state, finance.sourceAppointment, now, "coach_transfer", "unemployed");
    const interim = createInterimMutable(
      room,
      state,
      finance.sourceClubId,
      "coach_transfer",
      now,
      `${id}:source`,
      { payBonus: true },
    );
    if (interim.event) events.push(interim.event);
    transactions.push(...interim.transactions);
  }

  const role = input.role === "interim" ? "interim" : "head_coach";
  const contract = contractTerms(room, coach, clubId, input, now, id, role);
  const appointment = appointmentRecord(room, coach.id, clubId, contract.id, input, now, id, role);
  state.contracts.push(contract);
  state.appointments.push(appointment);
  coach.currentClubId = clubId;
  coach.status = role === "interim" ? "interim" : "employed";
  appendCareerAssignment(coach, appointment);
  setHumanControl(room, coach.id, clubId);
  fillVacancyMutable(room, state, {
    clubId,
    coachId: coach.id,
    vacancyId: input.vacancyId,
    proposalId: input.proposalId,
    applicationId: input.applicationId,
  }, now, id, events);
  events.push(eventRecord(role === "interim" ? "COACH_INTERIM_APPOINTED" : "COACH_APPOINTED", id, now, {
    coachId: coach.id,
    clubId,
    relatedClubId: finance.sourceClubId,
    contractId: contract.id,
    amount: finance.compensation + finance.signingBonus,
    metadata: {
      entryReason: appointment.entryReason,
      wage: contract.wage,
      endDate: contract.endDate,
      compensation: finance.compensation,
      signingBonus: finance.signingBonus,
      objectives: clone(contract.objectives),
      staffPackageCommitments: clone(contract.staffPackageCommitments),
    },
  }));
  return { coach, contract, appointment, events, transactions, compensation: finance.compensation };
}

function scheduleAppointmentMutable(room, state, input, now, id) {
  const coach = coachById(room, input.coachId);
  const clubId = canonicalClubId(room, input.clubId);
  const coachConflict = state.appointments.find((appointment) => (
    appointment.status === "scheduled" && appointment.coachId === coach.id
  ));
  const clubConflict = state.appointments.find((appointment) => (
    appointment.status === "scheduled" && clubKey(appointment.clubId) === clubKey(clubId)
  ));
  if (coachConflict || clubConflict) {
    throw new CoachEmploymentError("Compromisso futuro conflitante", "COACH_SCHEDULED_APPOINTMENT_CONFLICT", 409, {
      coachId: coach.id,
      clubId,
      appointmentId: coachConflict?.id ?? clubConflict?.id,
    });
  }
  const startDate = timestamp(input.startDate);
  const role = input.role === "interim" ? "interim" : "head_coach";
  const contract = contractTerms(room, coach, clubId, { ...input, status: "scheduled", startDate }, now, id, role);
  const appointment = appointmentRecord(room, coach.id, clubId, contract.id, {
    ...input,
    status: "scheduled",
    startDate,
    expectedStartAt: startDate,
  }, now, id, role);
  state.contracts.push(contract);
  state.appointments.push(appointment);
  if (!coach.currentClubId) coach.status = "awaiting_start";
  const events = [eventRecord("COACH_APPOINTMENT_SCHEDULED", id, now, {
    coachId: coach.id, clubId, contractId: contract.id, metadata: { startDate },
  })];
  fillVacancyMutable(room, state, {
    clubId,
    coachId: coach.id,
    vacancyId: input.vacancyId,
    proposalId: input.proposalId,
    applicationId: input.applicationId,
  }, now, id, events);
  return { coach, contract, appointment, events, transactions: [] };
}

function performAppointment(room, state, input, now, id) {
  assertCoachCanSign(coachById(room, input?.coachId), now);
  const startDate = nullableTimestamp(input?.startDate);
  return startDate && new Date(startDate).getTime() > new Date(now).getTime()
    ? scheduleAppointmentMutable(room, state, { ...input, startDate }, now, id)
    : performImmediateAppointment(room, state, input, now, id);
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

export function appointCoach(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const result = performAppointment(room, state, input, now, id);
  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, result.events, result.transactions, options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    coach: clone(result.coach),
    contract: clone(result.contract),
    appointment: clone(result.appointment),
    events: clone(result.events),
    financialTransactions: clone(result.transactions),
    compensation: result.compensation ?? 0,
    duplicate: false,
  };
}

/** Confirma um interino em contrato principal sem manter dois vinculos ativos. */
export function confirmInterimCoach(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) {
    const priorInterim = state.appointments.find((appointment) => appointment.confirmationOperationId === id) ?? null;
    const priorAppointment = state.appointments.find((appointment) => appointment.operationId === `${id}:head`) ?? null;
    return {
      ...duplicate,
      interimAppointment: clone(priorInterim),
      appointment: clone(priorAppointment),
      contract: clone(state.contracts.find((contract) => contract.id === priorAppointment?.contractId) ?? null),
    };
  }

  const appointmentId = identifier(input.appointmentId ?? input.interimAppointmentId);
  const coachId = identifier(input.coachId);
  const clubId = canonicalClubId(room, input.clubId);
  const interim = state.appointments.find((appointment) => (
    appointment.status === "active"
      && appointment.role === "interim"
      && (!appointmentId || appointment.id === appointmentId)
      && (!coachId || appointment.coachId === coachId)
      && (!clubId || clubKey(appointment.clubId) === clubKey(clubId))
  ));
  if (!interim) {
    throw new CoachEmploymentError("Interino ativo nao encontrado", "COACH_INTERIM_NOT_FOUND", 404, {
      appointmentId: appointmentId || null,
      coachId: coachId || null,
      clubId: clubId || null,
    });
  }
  if (!interim.canBeConfirmed) {
    throw new CoachEmploymentError("Interino nao pode ser efetivado", "COACH_INTERIM_CONFIRMATION_FORBIDDEN", 409, {
      appointmentId: interim.id,
    });
  }

  const coach = coachById(room, interim.coachId);
  assertCoachCanSign(coach, now);
  const interimContract = activeContractForCoach(state, coach.id);
  const vacancy = state.vacancies.find((candidate) => (
    candidate.status === "open" && clubKey(candidate.clubId) === clubKey(interim.clubId)
  )) ?? null;
  const transactions = [];
  const pendingBonus = interimBonusTransactionMutable(interim, now);
  if (pendingBonus) transactions.push(pendingBonus);
  interim.statistics = appointmentStatistics(room, interim, now);
  closeAppointmentMutable(room, state, interim, now, "interim_confirmed", "unemployed");
  interim.confirmedAt = now;
  interim.confirmationOperationId = id;

  const result = performImmediateAppointment(room, state, {
    coachId: coach.id,
    clubId: interim.clubId,
    vacancyId: vacancy?.id ?? interim.vacancyId,
    role: "head_coach",
    entryReason: "interim_confirmed",
    sourceStaffId: interim.sourceStaffId,
    wage: input.wage ?? input.salary ?? interimContract?.wage ?? coach.salary,
    durationYears: input.durationYears ?? input.years ?? 2,
    endDate: input.endDate,
    terminationClause: input.terminationClause,
    signingBonus: input.signingBonus,
    bonuses: input.bonuses,
    objectives: input.objectives,
    authorityLevel: 100,
    canBeConfirmed: false,
  }, now, `${id}:head`);
  interim.confirmedAppointmentId = result.appointment.id;
  result.appointment.sourceStaffId = interim.sourceStaffId;
  result.appointment.interimAppointmentId = interim.id;
  result.appointment.statistics = normalizeAppointmentStatistics({});

  const sourceStaff = (room?.clubCareerState?.staffMembers ?? []).find((member) => (
    identifier(member?.id) === interim.sourceStaffId
  ));
  if (sourceStaff) {
    sourceStaff.availability = {
      ...(sourceStaff.availability && typeof sourceStaff.availability === "object" ? sourceStaff.availability : {}),
      status: "head_coach",
      effectiveAt: now,
      reason: "promoted_from_interim",
    };
    sourceStaff.headCoachAppointmentId = result.appointment.id;
    if (sourceStaff.interimAssignment?.status === "active") {
      sourceStaff.interimAssignment = {
        ...sourceStaff.interimAssignment,
        status: "ended",
        endedAt: now,
        endsAt: now,
        endReason: "promoted_to_head_coach",
        confirmedAppointmentId: result.appointment.id,
      };
    }
    sourceStaff.updatedAt = now;
    sourceStaff.professionalHistory = [
      ...(Array.isArray(sourceStaff.professionalHistory) ? sourceStaff.professionalHistory : []),
      {
        id: deterministicId("staff-history", `${id}|${sourceStaff.id}`),
        type: "promoted_to_head_coach",
        clubId: interim.clubId,
        occurredAt: now,
        appointmentId: result.appointment.id,
        operationId: id,
      },
    ].slice(-500);
  }

  const events = [eventRecord("COACH_INTERIM_CONFIRMED", id, now, {
    coachId: coach.id,
    clubId: interim.clubId,
    contractId: result.contract.id,
    vacancyId: vacancy?.id ?? interim.vacancyId,
    metadata: {
      interimAppointmentId: interim.id,
      headCoachAppointmentId: result.appointment.id,
      sourceStaffId: interim.sourceStaffId,
      interimStatistics: clone(interim.statistics),
      wage: result.contract.wage,
      endDate: result.contract.endDate,
    },
  }), ...result.events];
  transactions.push(...result.transactions);
  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, transactions, options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    coach: clone(coach),
    interimAppointment: clone(interim),
    appointment: clone(result.appointment),
    previousContract: clone(interimContract),
    contract: clone(result.contract),
    vacancy: clone(vacancy),
    events: clone(events),
    financialTransactions: clone(transactions),
    duplicate: false,
  };
}

function closeRenewalNegotiationsForResignationMutable(state, coachId, contractId, now, operationIdValue) {
  for (const proposal of state.proposals.filter((candidate) => (
    candidate.coachId === coachId
      && candidate.kind === "renewal"
      && (!contractId || candidate.sourceContractId === contractId)
      && ACTIVE_PROPOSAL_STATUSES.has(candidate.status)
  ))) {
    const previousStatus = proposal.status;
    proposal.status = "withdrawn";
    proposal.marketStage = "closed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.nextActionAt = null;
    proposal.pendingCounterproposal = null;
    proposal.responseReason = "coach_resigned_during_renewal";
    proposal.decisionReason = proposal.responseReason;
    appendDecision(proposal, {
      action: "withdraw_after_resignation",
      responsibleId: coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      justification: "Pedido de demissao encerrou a negociacao de renovacao",
    }, now, `${operationIdValue}:renewal:${proposal.id}`);
  }
}

function resignCoachMutable(room, state, input, now, operationIdValue, options = {}) {
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  if (!appointment) throw new CoachEmploymentError("Treinador sem vinculo ativo", "COACH_ACTIVE_APPOINTMENT_NOT_FOUND", 409);
  const requestedClubId = canonicalClubId(room, input.clubId);
  if (requestedClubId && clubKey(requestedClubId) !== clubKey(appointment.clubId)) {
    throw new CoachEmploymentError("Treinador nao pertence ao clube", "COACH_CLUB_MISMATCH", 409);
  }
  const contract = activeContractForCoach(state, coach.id);
  const consequences = applyVoluntaryResignationConsequencesMutable(
    room,
    state,
    coach,
    appointment,
    contract,
    input,
    now,
    operationIdValue,
    options,
  );
  closeRenewalNegotiationsForResignationMutable(state, coach.id, contract?.id, now, operationIdValue);
  const closed = closeAppointmentMutable(room, state, appointment, now, consequences.reasonCode, "resigned");
  const interim = createInterimMutable(
    room,
    state,
    appointment.clubId,
    consequences.reasonCode,
    now,
    operationIdValue,
    { payBonus: true },
  );
  const transactions = consequences.financialCost > 0 ? [financeRecord(
    "income",
    "coach_resignation_compensation",
    operationIdValue,
    now,
    {
      clubId: appointment.clubId,
      coachId: coach.id,
      amount: consequences.financialCost,
      description: `Compensacao pela saida de ${coach.name}`,
      metadata: { justCauseVerified: consequences.justCauseVerified },
    },
  )] : [];
  transactions.push(...interim.transactions);
  const events = [eventRecord("COACH_RESIGNED", operationIdValue, now, {
    coachId: coach.id,
    clubId: appointment.clubId,
    contractId: contract?.id,
    vacancyId: interim.vacancy?.id,
    amount: consequences.financialCost,
    metadata: {
      reason: consequences.reasonCode,
      reasonLabel: consequences.reasonLabel,
      justCauseVerified: consequences.justCauseVerified,
      reputationDelta: consequences.reputationDelta,
      trustDelta: consequences.trustDelta,
      inactivityDays: consequences.inactivityDays,
      restrictionEndsAt: consequences.restrictionEndsAt,
      pendingProjectPenalty: consequences.pendingProjectPenalty,
      evidenceCodes: consequences.evidenceCodes,
    },
  })];
  if (interim.event) events.push(interim.event);
  appendNotification(state, {
    type: "COACH_RESIGNATION_CONSEQUENCES",
    recipientId: coach.id,
    recipientRole: "coach",
    coachId: coach.id,
    clubId: appointment.clubId,
    title: "Consequencias da saida",
    message: `Reputacao ${consequences.reputationDelta}; assinatura bloqueada por ${consequences.inactivityDays} dia(s).`,
  }, now, operationIdValue);
  return {
    coach: closed.coach,
    contract: closed.contract,
    appointment,
    interimAppointment: interim.appointment,
    vacancy: interim.vacancy,
    events,
    transactions,
    penalty: consequences.financialCost,
    consequences,
  };
}

function departCoach(roomValue, input, options, kind) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  if (kind === "resigned") {
    const result = resignCoachMutable(room, state, input, now, id, options);
    state.currentDate = now;
    assertCoachEmploymentIntegrity(room, now);
    emitCallbacks(room, result.events, result.transactions, options);
    markProcessed(state, id);
    synchronizeCareerAndRetain(room, state, now);
    return {
      room,
      coach: clone(result.coach),
      contract: clone(result.contract),
      appointment: clone(result.appointment),
      interimAppointment: clone(result.interimAppointment),
      vacancy: clone(result.vacancy),
      events: clone(result.events),
      financialTransactions: clone(result.transactions),
      penalty: result.penalty,
      consequences: clone(result.consequences),
      duplicate: false,
    };
  }
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  if (!appointment) throw new CoachEmploymentError("Treinador sem vinculo ativo", "COACH_ACTIVE_APPOINTMENT_NOT_FOUND", 409);
  const requestedClubId = canonicalClubId(room, input.clubId);
  if (requestedClubId && clubKey(requestedClubId) !== clubKey(appointment.clubId)) {
    throw new CoachEmploymentError("Treinador nao pertence ao clube", "COACH_CLUB_MISMATCH", 409);
  }
  const contract = activeContractForCoach(state, coach.id);
  const isMutualAgreement = kind === "mutual_agreement";
  const isRetirement = kind === "retired";
  const defaultPenalty = isRetirement ? 0 : contract?.terminationClause;
  const penalty = integer(input.compensation ?? input.penalty ?? defaultPenalty, 0, 0, MAX_MONEY);
  const clubId = appointment.clubId;
  const exitReason = identifier(input.reason)
    || (isRetirement ? "retirement" : isMutualAgreement ? "mutual_agreement" : "board_dismissal");
  const nextCoachStatus = isRetirement ? "retired" : isMutualAgreement ? "unemployed" : kind;
  const closed = closeAppointmentMutable(room, state, appointment, now, exitReason, nextCoachStatus);
  const interim = createInterimMutable(room, state, clubId, exitReason, now, id, { payBonus: true });
  const transactions = penalty > 0 ? [financeRecord(
    "expense",
    isMutualAgreement ? "coach_mutual_agreement" : isRetirement ? "coach_retirement" : "coach_termination",
    id,
    now,
    {
      clubId,
      coachId: coach.id,
      amount: penalty,
      description: isRetirement
        ? `Encerramento de carreira de ${coach.name}`
        : isMutualAgreement
          ? `Acordo de rescisao com ${coach.name}`
          : `Rescisao de ${coach.name}`,
    },
  )] : [];
  transactions.push(...interim.transactions);
  const departureEventType = isRetirement
    ? "COACH_RETIREMENT_EFFECTIVE"
    : isMutualAgreement ? "COACH_MUTUAL_AGREEMENT_COMPLETED" : "COACH_DISMISSED";
  const events = [eventRecord(departureEventType, id, now, {
    coachId: coach.id,
    clubId,
    contractId: contract?.id,
    vacancyId: interim.vacancy?.id,
    amount: penalty,
    metadata: {
      reason: exitReason,
      securityScore: input.securityScore ?? null,
      terms: input.terms && typeof input.terms === "object" ? clone(input.terms) : null,
    },
  })];
  if (interim.event) events.push(interim.event);
  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, transactions, options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    coach: clone(closed.coach),
    contract: clone(closed.contract),
    appointment: clone(appointment),
    interimAppointment: clone(interim.appointment),
    vacancy: clone(interim.vacancy),
    events: clone(events),
    financialTransactions: clone(transactions),
    penalty,
    duplicate: false,
  };
}

export function dismissCoach(roomValue, input = {}, options = {}) {
  return departCoach(roomValue, input, options, "dismissed");
}

export function resignCoach(roomValue, input = {}, options = {}) {
  return departCoach(roomValue, input, options, "resigned");
}

export function separateCoachByAgreement(roomValue, input = {}, options = {}) {
  return departCoach(roomValue, input, options, "mutual_agreement");
}

export function retireCoach(roomValue, input = {}, options = {}) {
  return departCoach(roomValue, input, options, "retired");
}

export function openCoachSuccession(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  if (!appointment) {
    throw new CoachEmploymentError("Treinador sem vinculo ativo", "COACH_ACTIVE_APPOINTMENT_NOT_FOUND", 409);
  }
  const requestedClubId = canonicalClubId(room, input.clubId);
  if (requestedClubId && clubKey(requestedClubId) !== clubKey(appointment.clubId)) {
    throw new CoachEmploymentError("Treinador nao pertence ao clube", "COACH_CLUB_MISMATCH", 409);
  }
  const vacancy = openVacancyMutable(
    room,
    state,
    appointment.clubId,
    identifier(input.reason) || "planned_succession",
    now,
    `${id}:vacancy`,
  );
  vacancy.plannedDepartureAt = nullableTimestamp(input.effectiveAt);
  vacancy.departingCoachId = coach.id;
  vacancy.successionPlanned = true;
  const event = eventRecord("COACH_SUCCESSION_SEARCH_STARTED", id, now, {
    coachId: coach.id,
    clubId: appointment.clubId,
    vacancyId: vacancy.id,
    metadata: {
      reason: identifier(input.reason) || "planned_succession",
      effectiveAt: vacancy.plannedDepartureAt,
    },
  });
  appendNotification(state, {
    type: "COACH_SUCCESSION_SEARCH_STARTED",
    recipientId: coach.id,
    recipientRole: "coach",
    coachId: coach.id,
    clubId: appointment.clubId,
    vacancyId: vacancy.id,
    title: "Planejamento de sucessao iniciado",
    message: vacancy.plannedDepartureAt
      ? `O clube iniciou a busca para a transicao em ${vacancy.plannedDepartureAt}.`
      : "O clube iniciou a busca por um sucessor.",
  }, now, id);
  state.currentDate = now;
  emitCallbacks(room, [event], [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  assertCoachEmploymentIntegrity(room, now);
  return {
    room,
    coach: clone(coach),
    vacancy: clone(vacancy),
    events: [clone(event)],
    financialTransactions: [],
    duplicate: false,
  };
}

export function previewCoachResignation(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  if (!appointment) return null;
  const contract = activeContractForCoach(state, coach.id);
  return clone(resignationPreview(room, state, coach, appointment, contract, input, now, options));
}

export function createCoachProposal(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const coach = coachById(room, input.coachId);
  if (coach.status === "retired") throw new CoachEmploymentError("Treinador aposentado", "COACH_RETIRED", 409);
  if (coachRetirementBlocksMarket(room, coach.id) || coach.status === "retiring") {
    throw new CoachEmploymentError(
      "Treinador ja anunciou aposentadoria",
      "COACH_RETIREMENT_MARKET_BLOCK",
      409,
    );
  }
  const clubId = canonicalClubId(room, input.clubId ?? input.offeringClubId);
  if (!clubId) throw new CoachEmploymentError("Clube obrigatorio", "COACH_CLUB_REQUIRED", 400);
  const activeContract = activeContractForCoach(state, coach.id);
  const linkedVacancy = identifier(input.vacancyId)
    ? state.vacancies.find((candidate) => candidate.id === identifier(input.vacancyId))
    : state.vacancies.find((candidate) => (
      candidate.status === "open" && clubKey(candidate.clubId) === clubKey(clubId)
    ));
  if (identifier(input.vacancyId) && (!linkedVacancy || linkedVacancy.status !== "open")) {
    throw new CoachEmploymentError("Vaga encerrada", "COACH_VACANCY_CLOSED", 409);
  }
  const proposalKind = PROPOSAL_KINDS.has(identifier(input.kind ?? input.proposalType))
    ? identifier(input.kind ?? input.proposalType)
    : "hiring";
  const coachInitiatedRenewal = proposalKind === "renewal" && input.initiatedBy === "coach";
  const requestedTerms = coachInitiatedRenewal ? {
    wage: integer(input.wage ?? input.salary, integer(activeContract?.wage, 0, 0, MAX_MONEY), 0, MAX_MONEY),
    durationYears: integer(input.durationYears ?? input.contractYears, 2, 1, 10),
    terminationClause: integer(input.terminationClause, integer(activeContract?.terminationClause, 0, 0, MAX_MONEY), 0, MAX_MONEY),
    signingBonus: integer(input.signingBonus, 0, 0, MAX_MONEY),
    compensation: 0,
    transferBudget: input.transferBudget == null
      ? (activeContract?.transferBudgetCommitment ?? activeContract?.transferBudget) == null
        ? null
        : integer(activeContract.transferBudgetCommitment ?? activeContract.transferBudget, 0, 0, MAX_MONEY)
      : integer(input.transferBudget, 0, 0, MAX_MONEY),
    bonuses: input.bonuses && typeof input.bonuses === "object" && !Array.isArray(input.bonuses)
      ? clone(input.bonuses)
      : activeContract?.bonuses && typeof activeContract.bonuses === "object" ? clone(activeContract.bonuses) : {},
    objectives: Array.isArray(input.objectives ?? activeContract?.objectives)
      ? (input.objectives ?? activeContract.objectives).map(identifier).filter(Boolean).slice(0, 20)
      : [],
    specialClauses: (Array.isArray(input.specialClauses ?? input.clauses)
      ? input.specialClauses ?? input.clauses
      : Array.isArray(activeContract?.clauses) ? activeContract.clauses : [])
      .map(identifier).filter(Boolean).slice(0, 20),
    guaranteeIds: [],
    submittedAt: now,
    operationId: id,
  } : null;
  const proposal = normalizeProposal({
    ...input,
    id: deterministicId("coach-proposal", `${id}|${coach.id}|${clubId}`),
    coachId: coach.id,
    clubId,
    vacancyId: linkedVacancy?.id ?? null,
    applicationId: input.applicationId,
    interviewId: input.interviewId,
    kind: proposalKind,
    sourceContractId: input.sourceContractId ?? input.renewalOfContractId,
    compensation: proposalKind === "renewal" || proposalKind === "precontract"
      ? input.compensation ?? 0
      : input.compensation ?? activeContract?.terminationClause ?? 0,
    status: coachInitiatedRenewal ? "aguardando_resposta_diretoria" : "pending",
    pendingCounterproposal: requestedTerms,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt ?? addDays(now, input.responseDays ?? 7),
    plannedStartDate: input.plannedStartDate ?? now,
    marketStage: coachInitiatedRenewal ? "club_review" : "coach_review",
    nextActionAt: input.nextActionAt ?? (coachInitiatedRenewal
      ? addDays(now, state.marketConfig.boardResponseDelayDays)
      : coach.managerType === "ai"
        ? addDays(now, state.marketConfig.coachResponseDelayDays)
        : now),
    lastActionAt: now,
    maxNegotiationRounds: input.maxNegotiationRounds ?? state.marketConfig.maxNegotiationRounds,
    bonuses: input.bonuses,
    availableBudget: input.availableBudget ?? availableClubFunds(room, clubId),
    boardExpectation: input.boardExpectation,
    clubSituation: input.clubSituation,
    message: input.message,
    operationId: id,
  });
  state.proposals.push(proposal);
  appendDecision(proposal, {
    action: coachInitiatedRenewal ? "renewal_requested" : proposal.kind === "renewal" ? "renewal_offer_submitted" : "offer_submitted",
    responsibleId: coachInitiatedRenewal ? coach.id : clubId,
    responsibleRole: coachInitiatedRenewal ? "candidate" : "board",
    previousStatus: null,
    newStatus: proposal.status,
    justification: input.reason ?? input.message,
    negotiatedValues: coachInitiatedRenewal ? requestedTerms : proposalTerms(proposal),
  }, now, `${id}:offer`);
  registerProposalGuarantees(state, proposal, input.guarantees, now, id, {
    status: "formalized",
    mandatory: false,
    blocksCompletion: false,
  });
  if (!coach.currentClubId) coach.status = "negotiating";
  const event = eventRecord("COACH_PROPOSAL_CREATED", id, now, {
    coachId: coach.id,
    clubId,
    relatedClubId: coach.currentClubId,
    proposalId: proposal.id,
    amount: proposal.compensation,
    metadata: { wage: proposal.wage, durationYears: proposal.durationYears, expiresAt: proposal.expiresAt },
  });
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, [event], [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return { room, proposal: clone(proposal), events: [clone(event)], financialTransactions: [], duplicate: false };
}

function closeProposalSelectionMutable(state, proposal, outcome, reason, now, operationIdValue) {
  const application = state.applications.find((candidate) => candidate.id === proposal.applicationId);
  if (application && ACTIVE_APPLICATION_STATUSES.has(application.status)) {
    const previousStatus = application.status;
    application.status = outcome === "withdrawn" ? "withdrawn" : "rejected";
    application.updatedAt = now;
    application.closedAt = now;
    application.closedReason = reason;
    application.closedBy = operationIdValue;
    application.responseReason = reason;
    appendDecision(application, {
      action: outcome === "withdrawn" ? "candidate_withdrew" : "proposal_closed",
      responsibleId: proposal.coachId,
      responsibleRole: outcome === "withdrawn" ? "candidate" : "system",
      previousStatus,
      newStatus: application.status,
      justification: reason,
    }, now, `${operationIdValue}:application`);
  }
  const interview = state.interviews.find((candidate) => candidate.id === proposal.interviewId);
  if (interview && ACTIVE_INTERVIEW_STATUSES.has(interview.status)) {
    const previousStatus = interview.status;
    interview.status = "rejected";
    interview.closedAt = now;
    interview.closedReason = reason;
    interview.closedBy = operationIdValue;
    appendDecision(interview, {
      action: "proposal_closed",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: interview.status,
      justification: reason,
    }, now, `${operationIdValue}:interview`);
  }
}

function closeCoachCompetingNegotiationsMutable(state, winner, now, operationIdValue, events) {
  const reason = winner.kind === "renewal" ? "coach_renewed_contract" : "coach_signed_elsewhere";
  for (const proposal of state.proposals) {
    if (proposal.id === winner.id || proposal.coachId !== winner.coachId || !ACTIVE_PROPOSAL_STATUSES.has(proposal.status)) continue;
    const previousStatus = proposal.status;
    proposal.status = "withdrawn";
    proposal.marketStage = "closed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = null;
    proposal.responseReason = reason;
    proposal.decisionReason = reason;
    proposal.closedAt = now;
    proposal.closedReason = reason;
    proposal.closedBy = operationIdValue;
    proposal.pendingCounterproposal = null;
    appendDecision(proposal, {
      action: "competing_offer_closed",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: proposal.status,
      justification: reason,
    }, now, `${operationIdValue}:competing:${proposal.id}`);
    appendNotification(state, {
      type: "COACH_COMPETING_NEGOTIATION_CLOSED",
      recipientId: proposal.clubId,
      recipientRole: "board",
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      title: "Negociacao concorrente encerrada",
      message: winner.kind === "renewal"
        ? "O treinador renovou com o clube atual."
        : "O treinador chegou a acordo com outro clube.",
    }, now, `${operationIdValue}:competing:${proposal.id}`);
    events.push(eventRecord("COACH_COMPETING_PROPOSAL_CLOSED", `${operationIdValue}:competing:${proposal.id}`, now, {
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      relatedClubId: winner.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      metadata: { reason, winningProposalId: winner.id },
    }));
  }

  for (const application of state.applications) {
    if (application.coachId !== winner.coachId || !ACTIVE_APPLICATION_STATUSES.has(application.status)) continue;
    if (application.id === winner.applicationId) continue;
    const previousStatus = application.status;
    application.status = "withdrawn";
    application.updatedAt = now;
    application.closedAt = now;
    application.closedReason = reason;
    application.closedBy = operationIdValue;
    appendDecision(application, {
      action: "competing_offer_closed",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: application.status,
      justification: reason,
    }, now, `${operationIdValue}:competing:application:${application.id}`);
  }
  for (const interview of state.interviews) {
    if (interview.coachId !== winner.coachId || !ACTIVE_INTERVIEW_STATUSES.has(interview.status)) continue;
    if (interview.id === winner.interviewId) continue;
    const previousStatus = interview.status;
    interview.status = "rejected";
    interview.closedAt = now;
    interview.closedReason = reason;
    interview.closedBy = operationIdValue;
    appendDecision(interview, {
      action: "competing_offer_closed",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: interview.status,
      justification: reason,
    }, now, `${operationIdValue}:competing:interview:${interview.id}`);
  }
}

function performRenewalAgreementMutable(room, state, proposal, now, operationIdValue, guaranteeTerms) {
  const coach = coachById(room, proposal.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  const previous = activeContractForCoach(state, coach.id);
  if (!appointment || !previous || clubKey(appointment.clubId) !== clubKey(proposal.clubId)) {
    throw new CoachEmploymentError("Contrato de renovacao nao esta mais ativo", "COACH_RENEWAL_CONTRACT_CHANGED", 409);
  }
  if (proposal.sourceContractId && previous.id !== proposal.sourceContractId) {
    throw new CoachEmploymentError("Contrato original da renovacao foi alterado", "COACH_RENEWAL_SOURCE_CHANGED", 409);
  }
  previous.status = "replaced";
  previous.endedAt = now;
  previous.endReason = "renewed_after_negotiation";
  const contract = contractTerms(room, coach, proposal.clubId, {
    wage: proposal.wage,
    durationYears: proposal.durationYears,
    terminationClause: proposal.terminationClause ?? previous.terminationClause,
    signingBonus: proposal.signingBonus,
    transferBudget: proposal.transferBudget,
    autonomyLevel: clamp(finite(previous.autonomyLevel, 50) + finite(proposal.autonomyDelta), 0, 100),
    objectiveDifficultyAdjustment: proposal.objectiveDifficultyDelta,
    sourceInterviewId: proposal.interviewId,
    bonuses: proposal.bonuses,
    guaranteeIds: guaranteeTerms.guaranteeIds,
    clauses: [...proposal.specialClauses, ...guaranteeTerms.clauses],
    staffPackageCommitments: guaranteeTerms.staffPackageCommitments,
    objectives: proposal.objectives.length ? proposal.objectives : previous.objectives,
    renewalOption: previous.renewalOption,
    renewalCount: previous.renewalCount + 1,
  }, now, operationIdValue, appointment.role);
  state.contracts.push(contract);
  appointment.contractId = contract.id;
  const transactions = proposal.signingBonus > 0 ? [financeRecord("expense", "coach_contract_renewal", operationIdValue, now, {
    clubId: proposal.clubId,
    coachId: coach.id,
    amount: proposal.signingBonus,
    description: `Renovacao negociada de ${coach.name}`,
  })] : [];
  const events = [eventRecord("COACH_CONTRACT_RENEWED", operationIdValue, now, {
    coachId: coach.id,
    clubId: proposal.clubId,
    contractId: contract.id,
    proposalId: proposal.id,
    amount: proposal.signingBonus,
    metadata: {
      source: "negotiated_coach_market",
      previousContractId: previous.id,
      wage: contract.wage,
      endDate: contract.endDate,
      negotiationRound: proposal.negotiationRound,
    },
  })];
  return { coach, appointment, contract, previousContract: previous, transactions, events };
}

export function respondCoachProposal(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const proposal = state.proposals.find((candidate) => candidate.id === identifier(input.proposalId));
  const actorCoachId = identifier(input.coachId);
  if (!proposal || (actorCoachId && proposal.coachId !== actorCoachId)) {
    throw new CoachEmploymentError("Proposta nao encontrada", "COACH_PROPOSAL_NOT_FOUND", 404);
  }
  if (!ACTIVE_PROPOSAL_STATUSES.has(proposal.status)) {
    throw new CoachEmploymentError("Proposta encerrada", "COACH_PROPOSAL_CLOSED", 409);
  }
  if (proposal.expiresAt && new Date(proposal.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Proposta expirada", "COACH_PROPOSAL_EXPIRED", 409);
  }
  const action = identifier(input.action).toLocaleLowerCase("pt-BR");
  const coach = coachById(room, proposal.coachId);
  const events = [];
  let appointmentResult = null;
  if (action === "accept") {
    assertProposalVacancyOpen(state, proposal);
    ensureProposalCanComplete(room, state, proposal);
    ensureClubCanFundProposal(room, state, proposal);
    if (!["pending", "aprovada_diretoria"].includes(proposal.status)) {
      throw new CoachEmploymentError("Proposta ainda nao pode ser aceita", "COACH_PROPOSAL_NOT_ACCEPTABLE", 409);
    }
    const previousStatus = proposal.status;
    const guaranteeTerms = contractGuaranteeTerms(state, proposal);
    appointmentResult = proposal.kind === "renewal"
      ? performRenewalAgreementMutable(room, state, proposal, now, id, guaranteeTerms)
      : performAppointment(room, state, {
        coachId: proposal.coachId,
        clubId: proposal.clubId,
        role: proposal.role,
        wage: proposal.wage,
        durationYears: proposal.durationYears,
        terminationClause: proposal.terminationClause,
        signingBonus: proposal.signingBonus,
        compensation: proposal.compensation,
        transferBudget: proposal.transferBudget,
        autonomyLevel: clamp(50 + finite(proposal.autonomyDelta), 0, 100),
        objectiveDifficultyAdjustment: proposal.objectiveDifficultyDelta,
        sourceInterviewId: proposal.interviewId,
        bonuses: proposal.bonuses,
        objectives: proposal.objectives,
        guaranteeIds: guaranteeTerms.guaranteeIds,
        clauses: [...proposal.specialClauses, ...guaranteeTerms.clauses],
        staffPackageCommitments: guaranteeTerms.staffPackageCommitments,
        startDate: proposal.plannedStartDate,
        entryReason: proposal.kind === "precontract" ? "precontract" : "accepted_proposal",
        proposalId: proposal.id,
        vacancyId: proposal.vacancyId,
        applicationId: proposal.applicationId,
      }, now, id);
    proposal.status = "accepted";
    proposal.marketStage = "completed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = null;
    proposal.decisionReason = identifier(input.reason) || "agreement_reached";
    proposal.pendingCounterproposal = null;
    appendDecision(proposal, {
      action: "accept",
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      negotiatedValues: proposalTerms(proposal),
      conditions: guaranteeTerms.guaranteeIds,
    }, now, id);
    events.push(...appointmentResult.events);
    closeCoachCompetingNegotiationsMutable(state, proposal, now, id, events);
    events.push(eventRecord("COACH_PROPOSAL_ACCEPTED", `${id}:accepted`, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      contractId: appointmentResult.contract?.id,
    }));
  } else if (["reject", "withdraw"].includes(action)) {
    const previousStatus = proposal.status;
    proposal.status = action === "withdraw" ? "withdrawn" : "rejected";
    proposal.marketStage = "closed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = null;
    proposal.responseReason = identifier(input.reason) || null;
    proposal.decisionReason = proposal.responseReason || (action === "withdraw" ? "candidate_withdrew" : "candidate_rejected");
    proposal.pendingCounterproposal = null;
    appendDecision(proposal, {
      action,
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      justification: proposal.responseReason,
    }, now, id);
    closeProposalSelectionMutable(state, proposal, proposal.status, proposal.decisionReason, now, id);
    refreshCoachMarketStatus(state, coach);
    events.push(eventRecord(action === "withdraw" ? "COACH_PROPOSAL_WITHDRAWN" : "COACH_PROPOSAL_REJECTED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      metadata: { reason: proposal.responseReason },
    }));
  } else if (["counter", "guarantee"].includes(action)) {
    if (!["pending", "aprovada_diretoria"].includes(proposal.status)) {
      throw new CoachEmploymentError("Contraproposta ja aguarda a diretoria", "COACH_COUNTERPROPOSAL_ALREADY_PENDING", 409);
    }
    assertProposalVacancyOpen(state, proposal);
    if (proposal.negotiationRound >= proposal.maxNegotiationRounds) {
      throw new CoachEmploymentError("Limite de rodadas da negociacao atingido", "COACH_NEGOTIATION_ROUND_LIMIT", 409);
    }
    const previousStatus = proposal.status;
    const guarantees = registerProposalGuarantees(
      state,
      proposal,
      input.guarantees ?? input.guarantee,
      now,
      id,
      { mandatory: true, blocksCompletion: true, status: "requested" },
    );
    proposal.status = "aguardando_resposta_diretoria";
    proposal.marketStage = "club_review";
    proposal.pendingCounterproposal = {
      ...proposalTerms(proposal, input),
      guaranteeIds: guarantees.map((guarantee) => guarantee.id),
      submittedAt: now,
      operationId: id,
    };
    proposal.negotiationRound += 1;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = addDays(now, state.marketConfig.boardResponseDelayDays);
    appendDecision(proposal, {
      action: "counter",
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      justification: input.reason,
      negotiatedValues: proposal.pendingCounterproposal,
      conditions: guarantees.map((guarantee) => guarantee.id),
    }, now, id);
    appendNotification(state, {
      type: "COACH_COUNTERPROPOSAL_AWAITING_BOARD",
      recipientId: proposal.clubId,
      recipientRole: "board",
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      title: "Contraproposta aguardando analise",
      message: "O candidato enviou novos valores ou condicoes.",
    }, now, id);
    events.push(eventRecord("COACH_PROPOSAL_COUNTERED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      metadata: {
        ...proposalTerms(proposal.pendingCounterproposal),
        guaranteeIds: guarantees.map((guarantee) => guarantee.id),
        negotiationRound: proposal.negotiationRound,
        status: proposal.status,
      },
    }));
  } else if (action === "provide_information") {
    if (proposal.status !== "informacoes_solicitadas") {
      throw new CoachEmploymentError("A diretoria nao solicitou informacoes", "COACH_INFORMATION_NOT_REQUESTED", 409);
    }
    const answer = identifier(input.information ?? input.message);
    if (!answer) throw new CoachEmploymentError("Informe a resposta", "COACH_INFORMATION_REQUIRED", 400);
    const previousStatus = proposal.status;
    proposal.informationRequest = {
      ...(proposal.informationRequest ?? {}),
      answer,
      answeredAt: now,
    };
    proposal.status = "aguardando_resposta_diretoria";
    proposal.marketStage = "club_review";
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = addDays(now, state.marketConfig.boardResponseDelayDays);
    appendDecision(proposal, {
      action: "provide_information",
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      justification: answer,
    }, now, id);
    appendNotification(state, {
      type: "COACH_INFORMATION_PROVIDED",
      recipientId: proposal.clubId,
      recipientRole: "board",
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      title: "Informacoes recebidas",
      message: "O candidato respondeu a solicitacao da diretoria.",
    }, now, id);
    events.push(eventRecord("COACH_PROPOSAL_INFORMATION_PROVIDED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
    }));
  } else if (action === "more_time") {
    proposal.expiresAt = addDays(proposal.expiresAt ?? now, input.extraDays ?? 3);
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    appendDecision(proposal, {
      action: "more_time",
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus: proposal.status,
      newStatus: proposal.status,
      negotiatedValues: { expiresAt: proposal.expiresAt },
    }, now, id);
    events.push(eventRecord("COACH_PROPOSAL_EXTENDED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      metadata: { expiresAt: proposal.expiresAt },
    }));
  } else {
    throw new CoachEmploymentError("Resposta de proposta invalida", "COACH_PROPOSAL_ACTION_INVALID", 400);
  }
  const transactions = appointmentResult?.transactions ?? [];
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, transactions, options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    proposal: clone(proposal),
    appointment: clone(appointmentResult?.appointment ?? null),
    contract: clone(appointmentResult?.contract ?? null),
    events: clone(events),
    financialTransactions: clone(transactions),
    duplicate: false,
  };
}

function resolveProposalGuarantees(state, proposal, resolutions, now, operationIdValue, responsible) {
  const byId = new Map((Array.isArray(resolutions) ? resolutions : []).map((resolution) => [
    identifier(resolution?.guaranteeId ?? resolution?.id),
    resolution,
  ]));
  const changed = [];
  for (const guarantee of guaranteesForProposal(state, proposal)) {
    const resolution = byId.get(guarantee.id);
    if (!resolution) continue;
    const nextStatus = GUARANTEE_STATUSES.has(resolution.status) ? resolution.status : guarantee.status;
    const previousStatus = guarantee.status;
    guarantee.status = nextStatus;
    guarantee.responsibleId = identifier(resolution.responsibleId) || guarantee.responsibleId;
    guarantee.responsibleRole = identifier(resolution.responsibleRole) || guarantee.responsibleRole;
    guarantee.dueAt = resolution.dueAt === undefined ? guarantee.dueAt : nullableTimestamp(resolution.dueAt);
    if (Array.isArray(resolution.effects)) guarantee.effects = clone(resolution.effects).slice(0, 20);
    guarantee.updatedAt = now;
    if (nextStatus === "formalized" && !guarantee.formalizedAt) guarantee.formalizedAt = now;
    if (["fulfilled", "waived", "breached"].includes(nextStatus)) guarantee.completedAt = now;
    appendDecision(guarantee, {
      action: `guarantee_${nextStatus}`,
      responsibleId: responsible.id,
      responsibleRole: responsible.role,
      previousStatus,
      newStatus: nextStatus,
      justification: resolution.justification,
      negotiatedValues: { dueAt: guarantee.dueAt, effects: guarantee.effects },
    }, now, `${operationIdValue}:guarantee:${guarantee.id}`);
    changed.push(guarantee);
  }
  return changed;
}

function applyGuaranteeEffectsToProposal(state, proposal) {
  for (const guarantee of guaranteesForProposal(state, proposal)) {
    if (!["formalized", "fulfilled"].includes(guarantee.status)) continue;
    for (const effect of guarantee.effects) {
      const type = identifier(effect?.type ?? effect?.kind);
      const amount = integer(effect?.amount ?? effect?.value, 0, 0, MAX_MONEY);
      if (type === "salary_adjustment" && amount > 0) proposal.wage = Math.min(20_000_000, amount);
      if (type === "signing_bonus" && amount > 0) proposal.signingBonus = amount;
      if (type === "termination_clause" && amount > 0) proposal.terminationClause = amount;
    }
  }
}

export function respondCoachBoardDecision(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const proposal = state.proposals.find((candidate) => candidate.id === identifier(input.proposalId));
  if (!proposal) throw new CoachEmploymentError("Proposta nao encontrada", "COACH_PROPOSAL_NOT_FOUND", 404);
  if (!["aguardando_resposta_diretoria", "informacoes_solicitadas"].includes(proposal.status)) {
    throw new CoachEmploymentError("Nao ha contraproposta pendente", "COACH_COUNTERPROPOSAL_NOT_PENDING", 409);
  }
  assertProposalVacancyOpen(state, proposal);
  if (proposal.expiresAt && new Date(proposal.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Proposta expirada", "COACH_PROPOSAL_EXPIRED", 409);
  }
  const action = identifier(input.action).toLocaleLowerCase("pt-BR");
  const responsible = {
    id: identifier(input.responsibleId) || `board:${proposal.clubId}`,
    role: identifier(input.responsibleRole) || "board",
  };
  const previousStatus = proposal.status;
  const events = [];
  const changedGuarantees = resolveProposalGuarantees(
    state,
    proposal,
    input.guaranteeResolutions,
    now,
    id,
    responsible,
  );

  if (action === "approve") {
    if (!proposal.pendingCounterproposal) {
      throw new CoachEmploymentError("Contraproposta sem termos", "COACH_COUNTERPROPOSAL_TERMS_MISSING", 409);
    }
    const approved = proposal.pendingCounterproposal;
    proposal.wage = approved.wage;
    proposal.durationYears = approved.durationYears;
    proposal.terminationClause = approved.terminationClause;
    proposal.signingBonus = approved.signingBonus;
    proposal.transferBudget = approved.transferBudget;
    proposal.objectives = normalizedObjectives(approved.objectives ?? proposal.objectives);
    proposal.specialClauses = (approved.specialClauses ?? proposal.specialClauses).map(identifier).filter(Boolean).slice(0, 20);
    proposal.bonuses = approved.bonuses && typeof approved.bonuses === "object" ? clone(approved.bonuses) : proposal.bonuses;
    proposal.status = "aprovada_diretoria";
    proposal.marketStage = "coach_review";
    proposal.nextActionAt = addDays(now, state.marketConfig.coachResponseDelayDays);
    proposal.pendingCounterproposal = null;
    proposal.informationRequest = null;
    applyGuaranteeEffectsToProposal(state, proposal);
  } else if (action === "reject") {
    proposal.status = "rejected";
    proposal.marketStage = "closed";
    proposal.nextActionAt = null;
    proposal.respondedAt = now;
    proposal.responseReason = identifier(input.justification) || "counterproposal_rejected";
    proposal.decisionReason = proposal.responseReason;
    proposal.pendingCounterproposal = null;
    closeProposalSelectionMutable(state, proposal, proposal.status, proposal.decisionReason, now, id);
    for (const guarantee of guaranteesForProposal(state, proposal)) {
      if (guarantee.status === "requested") {
        const guaranteePreviousStatus = guarantee.status;
        guarantee.status = "waived";
        guarantee.updatedAt = now;
        guarantee.completedAt = now;
        appendDecision(guarantee, {
          action: "guarantee_waived",
          responsibleId: responsible.id,
          responsibleRole: responsible.role,
          previousStatus: guaranteePreviousStatus,
          newStatus: guarantee.status,
          justification: proposal.responseReason,
          negotiatedValues: {
            dueAt: guarantee.dueAt,
            effects: guarantee.effects,
            staffPackage: staffPackageFromGuarantee(guarantee),
          },
        }, now, `${id}:guarantee:${guarantee.id}`);
        if (!changedGuarantees.some((candidate) => candidate.id === guarantee.id)) {
          changedGuarantees.push(guarantee);
        }
      }
    }
    const coach = coachById(room, proposal.coachId);
    refreshCoachMarketStatus(state, coach);
  } else if (action === "new_offer") {
    const terms = proposalTerms(proposal, input);
    Object.assign(proposal, terms);
    proposal.status = "pending";
    proposal.marketStage = "coach_review";
    proposal.negotiationRound = Math.min(proposal.maxNegotiationRounds, proposal.negotiationRound + 1);
    proposal.nextActionAt = addDays(now, state.marketConfig.coachResponseDelayDays);
    proposal.expiresAt = addDays(now, state.marketConfig.proposalValidityDays);
    proposal.pendingCounterproposal = null;
    proposal.informationRequest = null;
    applyGuaranteeEffectsToProposal(state, proposal);
  } else if (action === "request_information") {
    const prompt = identifier(input.informationRequest ?? input.message);
    if (!prompt) throw new CoachEmploymentError("Informe a solicitacao", "COACH_INFORMATION_REQUEST_REQUIRED", 400);
    proposal.status = "informacoes_solicitadas";
    proposal.marketStage = "coach_review";
    proposal.nextActionAt = null;
    proposal.informationRequest = {
      prompt,
      requestedAt: now,
      requestedBy: responsible.id,
      answer: null,
      answeredAt: null,
    };
  } else {
    throw new CoachEmploymentError("Decisao da diretoria invalida", "COACH_BOARD_DECISION_INVALID", 400);
  }

  proposal.updatedAt = now;
  proposal.lastActionAt = now;
  appendDecision(proposal, {
    action: `board_${action}`,
    responsibleId: responsible.id,
    responsibleRole: responsible.role,
    previousStatus,
    newStatus: proposal.status,
    justification: input.justification,
    negotiatedValues: {
      ...proposalTerms(proposal),
      boardDecisionContext: input.decisionContext && typeof input.decisionContext === "object"
        ? clone(input.decisionContext)
        : {},
    },
    conditions: changedGuarantees.map((guarantee) => guarantee.id),
  }, now, id);
  appendNotification(state, {
    type: `COACH_BOARD_${action.toLocaleUpperCase("en-US")}`,
    recipientId: proposal.coachId,
    recipientRole: "coach",
    coachId: proposal.coachId,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    vacancyId: proposal.vacancyId,
    title: action === "approve" ? "Contraproposta aprovada" : action === "reject"
      ? "Contraproposta recusada" : action === "new_offer" ? "Nova proposta da diretoria" : "Diretoria solicita informacoes",
    message: identifier(input.justification) || "A diretoria respondeu formalmente a negociacao.",
  }, now, id);
  const linkedVacancy = proposal.vacancyId
    ? state.vacancies.find((vacancy) => vacancy.id === proposal.vacancyId)
    : null;
  if (identifier(linkedVacancy?.recruiterId)) {
    appendNotification(state, {
      type: "COACH_BOARD_RESPONSE_RECRUITER",
      recipientId: linkedVacancy.recruiterId,
      recipientRole: "recruiter",
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      title: "Diretoria respondeu a negociacao",
      message: identifier(input.justification) || "A diretoria registrou uma decisao formal.",
    }, now, `${id}:recruiter`);
  }
  events.push(eventRecord(`COACH_BOARD_${action.toLocaleUpperCase("en-US")}`, id, now, {
    coachId: proposal.coachId,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    vacancyId: proposal.vacancyId,
    metadata: {
      responsibleId: responsible.id,
      responsibleRole: responsible.role,
      justification: identifier(input.justification) || null,
      previousStatus,
      newStatus: proposal.status,
      negotiatedValues: proposalTerms(proposal),
      guaranteeIds: changedGuarantees.map((guarantee) => guarantee.id),
      boardDecisionContext: input.decisionContext && typeof input.decisionContext === "object"
        ? clone(input.decisionContext)
        : {},
    },
  }));

  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    proposal: clone(proposal),
    guarantees: clone(guaranteesForProposal(state, proposal)),
    events: clone(events),
    financialTransactions: [],
    duplicate: false,
  };
}

export function applyForCoachVacancy(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const vacancy = state.vacancies.find((candidate) => candidate.id === identifier(input.vacancyId));
  if (!vacancy) throw new CoachEmploymentError("Vaga nao encontrada", "COACH_VACANCY_NOT_FOUND", 404);
  if (vacancy.status !== "open") throw new CoachEmploymentError("Vaga encerrada", "COACH_VACANCY_CLOSED", 409);
  if (vacancy.closesAt && new Date(vacancy.closesAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Vaga expirada", "COACH_VACANCY_EXPIRED", 409);
  }
  const coach = coachById(room, input.coachId);
  assertCoachMayInterviewDuringNotice(room, coach.id);
  if (state.applications.some((application) => (
    application.vacancyId === vacancy.id && application.coachId === coach.id
      && !["rejected", "withdrawn"].includes(application.status)
  ))) throw new CoachEmploymentError("Candidatura ja existe", "COACH_APPLICATION_DUPLICATE", 409);
  const assessment = coachMarketAssessment(room, state, coach, vacancy, now, state.marketConfig);
  if (!assessment.eligible) {
    throw new CoachEmploymentError(
      "Perfil nao atende aos requisitos obrigatorios da vaga",
      "COACH_VACANCY_REQUIREMENTS_NOT_MET",
      409,
      { hardBlockers: assessment.hardBlockers, score: assessment.score },
    );
  }
  if (!coachEligibleForVacancy(room, state, coach, vacancy, now, state.marketConfig)) {
    throw new CoachEmploymentError(
      "Treinador indisponivel para esta vaga",
      "COACH_VACANCY_CANDIDATE_UNAVAILABLE",
      409,
      { coachId: coach.id, vacancyId: vacancy.id },
    );
  }
  const application = normalizeApplication({
    id: deterministicId("coach-application", `${id}|${vacancy.id}|${coach.id}`),
    vacancyId: vacancy.id,
    clubId: vacancy.clubId,
    coachId: coach.id,
    status: "submitted",
    submittedAt: now,
    updatedAt: now,
    interestScore: assessment.score,
    shortlistScore: assessment.score,
    candidateAssessment: assessment,
    operationId: id,
  });
  state.applications.push(application);
  appendDecision(application, {
    action: "candidate_scored",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: null,
    newStatus: application.status,
    justification: `Compatibilidade calculada em ${assessment.score}/100`,
    negotiatedValues: {
      score: assessment.score,
      eligible: assessment.eligible,
      profileVersion: assessment.profileVersion,
    },
  }, now, `${id}:assessment`);
  const event = eventRecord("COACH_APPLICATION_SUBMITTED", id, now, {
    coachId: coach.id, clubId: vacancy.clubId, vacancyId: vacancy.id,
    metadata: {
      applicationId: application.id,
      shortlistScore: assessment.score,
      profileVersion: assessment.profileVersion,
      hardBlockers: assessment.hardBlockers,
    },
  });
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, [event], [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return { room, application: clone(application), interview: null, events: [clone(event)], duplicate: false };
}

function interviewCompatibility(interview, answers) {
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

function generatedInterviewDecision(evaluation, compatibilityScore) {
  const recommendation = identifier(evaluation?.recommendation);
  if (recommendation === "reject") return "reject";
  if (recommendation === "observe") return "complete";
  if (["hire", "hire_with_reservations", "negotiate"].includes(recommendation)) return "accept";
  return compatibilityScore >= MIN_INTERVIEW_COMPATIBILITY ? "accept" : "reject";
}

function mergeInterviewRelationshipImpact(currentValue, nextValue) {
  const current = normalizeInterviewRelationshipImpact(currentValue);
  const next = normalizeInterviewRelationshipImpact(nextValue);
  return Object.fromEntries(Object.keys(current).map((key) => [
    key,
    Math.round(clamp(current[key] + next[key], -20, 20) * 10) / 10,
  ]));
}

function applyInterviewRelationshipMutable(coach, interview, now, operationIdValue) {
  if (interview.effectsAppliedAt) return;
  const impact = normalizeInterviewRelationshipImpact(interview.relationshipImpact);
  const metrics = normalizeInterviewMetrics(interview.evaluation?.metrics ?? interview.cumulativeMetrics);
  const relationships = Array.isArray(coach.clubRelationships) ? coach.clubRelationships : [];
  const current = relationships.find((entry) => clubKey(entry?.clubId) === clubKey(interview.clubId)) ?? {};
  const boardDelta = clamp(impact.boardConfidenceDelta + ((metrics.boardConfidence - 50) * 0.08), -20, 20);
  const credibilityDelta = clamp(impact.credibilityDelta + ((metrics.credibility - 50) * 0.05), -20, 20);
  const relationship = {
    ...clone(current),
    clubId: interview.clubId,
    boardConfidence: Math.round(clamp(finite(current.boardConfidence, 50) + boardDelta, 0, 100) * 10) / 10,
    credibility: Math.round(clamp(finite(current.credibility, 50) + credibilityDelta, 0, 100) * 10) / 10,
    strategicAlignment: Math.round(clamp(
      finite(current.strategicAlignment, 50) + impact.strategicAlignmentDelta + ((metrics.clubCompatibility - 50) * 0.06),
      0,
      100,
    ) * 10) / 10,
    culturalCompatibility: Math.round(clamp(
      finite(current.culturalCompatibility, 50) + impact.culturalCompatibilityDelta + ((metrics.culturalFit - 50) * 0.06),
      0,
      100,
    ) * 10) / 10,
    perceivedRisk: Math.round(clamp(
      finite(current.perceivedRisk, 50) + impact.perceivedRiskDelta + ((metrics.perceivedRisk - 50) * 0.06),
      0,
      100,
    ) * 10) / 10,
    expectedTenure: Math.round(clamp(
      finite(current.expectedTenure, 50) + impact.expectedTenureDelta + ((metrics.longTermPotential - 50) * 0.06),
      0,
      100,
    ) * 10) / 10,
    interviewId: interview.id,
    updatedAt: now,
  };
  coach.clubRelationships = [
    ...relationships.filter((entry) => clubKey(entry?.clubId) !== clubKey(interview.clubId)),
    relationship,
  ].slice(-50);
  coach.credibility = Math.round(clamp(finite(coach.credibility, 50) + credibilityDelta, 0, 100) * 10) / 10;
  if (!coach.currentClubId || clubKey(coach.currentClubId) === clubKey(interview.clubId)) {
    coach.boardConfidence = relationship.boardConfidence;
    coach.boardRelationship = relationship.strategicAlignment;
  }

  const evaluation = normalizeInterviewEvaluation(interview.evaluation, now, interview.compatibilityScore ?? 50);
  const commitments = [
    ...(interview.negotiationEffects?.objectives ?? []),
    ...(interview.negotiationEffects?.specialClauses ?? []),
    ...(interview.transcript ?? [])
      .filter((entry) => entry.role === "coach" && /\b(vou|pretendo|compromet|prioriz|garant)/iu.test(entry.text))
      .map((entry) => entry.text),
  ].map((entry) => limitedInterviewText(entry, 240)).filter(Boolean).slice(0, 20);
  const contradictions = [
    ...(evaluation?.risks ?? []).filter((entry) => /contradi|inconsist|diverg/iu.test(entry)),
    ...(interview.transcript ?? [])
      .filter((entry) => entry.role === "board" && /contradi|inconsist|diferen.ca/iu.test(entry.text))
      .map((entry) => entry.text),
  ].map((entry) => limitedInterviewText(entry, 240)).filter(Boolean).slice(0, 20);
  const memory = normalizeCoachInterviewMemories([{
    id: deterministicId("coach-interview-memory", `${coach.id}|${interview.id}`),
    interviewId: interview.id,
    clubId: interview.clubId,
    summary: interview.memorySummary ?? evaluation?.summary,
    commitments,
    contradictions,
    questions: (interview.transcript ?? [])
      .filter((entry) => entry.role === "board" && entry.topic !== "closing")
      .map((entry) => entry.text),
    evaluation,
    recommendation: evaluation?.recommendation,
    occurredAt: now,
    operationId: operationIdValue,
  }], 1)[0];
  if (memory) {
    coach.interviewMemories = [
      ...(coach.interviewMemories ?? []).filter((entry) => entry.interviewId !== interview.id),
      memory,
    ].slice(-100);
  }
  interview.effectsAppliedAt = now;
  interview.effectsAppliedOperationId = operationIdValue;
}

function interviewAdjustedProposalTerms(room, vacancy, interview, input, suggestedWage) {
  const salary = vacancy?.desiredProfile?.salary ?? {};
  const minimumWage = Math.max(1_000, integer(salary.minimum, suggestedWage, 1_000, MAX_MONEY));
  const maximumWage = integer(salary.maximum, suggestedWage, minimumWage, MAX_MONEY);
  const effects = normalizeInterviewNegotiationEffects(
    input.negotiationEffects ?? interview.negotiationEffects,
  );
  const baseWage = finite(input.wage, suggestedWage);
  const wage = integer(
    effects ? baseWage * effects.salaryMultiplier : baseWage,
    suggestedWage,
    minimumWage,
    maximumWage,
  );
  const baseDuration = integer(input.durationYears, 2, 1, 5);
  const durationYears = integer(baseDuration + (effects?.durationYearsDelta ?? 0), baseDuration, 1, 5);
  const baseTerminationClause = finite(input.terminationClause, wage * 6);
  const terminationClause = integer(
    effects ? baseTerminationClause * effects.terminationClauseMultiplier : baseTerminationClause,
    wage * 6,
    0,
    Math.min(MAX_MONEY, wage * 24),
  );
  const baseSigningBonus = input.signingBonus == null ? wage : finite(input.signingBonus, wage);
  const signingBonus = effects
    ? integer(baseSigningBonus * effects.signingBonusMultiplier, 0, 0, MAX_MONEY)
    : integer(input.signingBonus, 0, 0, MAX_MONEY);
  const performanceBonus = effects
    ? integer(wage * effects.performanceBonusMultiplier, 0, 0, MAX_MONEY)
    : integer(input.bonuses?.performance, 0, 0, MAX_MONEY);
  const available = availableClubFunds(room, interview.clubId);
  const profileBudget = vacancy?.desiredProfile?.availableBudget;
  const baseTransferBudget = input.transferBudget ?? profileBudget;
  const adjustedTransferBudget = baseTransferBudget == null
    ? null
    : integer(
      finite(baseTransferBudget) * (effects?.transferBudgetMultiplier ?? 1),
      0,
      0,
      available == null ? MAX_MONEY : Math.min(MAX_MONEY, available),
    );
  const objectives = [
    ...(vacancy?.desiredProfile?.objectives?.length ? vacancy.desiredProfile.objectives : input.objectives ?? []),
    ...(effects?.objectives ?? []),
  ];
  return {
    wage,
    durationYears,
    terminationClause,
    signingBonus,
    transferBudget: adjustedTransferBudget,
    bonuses: {
      ...(input.bonuses && typeof input.bonuses === "object" ? clone(input.bonuses) : {}),
      ...(performanceBonus > 0 ? { performance: performanceBonus } : {}),
    },
    objectives,
    specialClauses: effects?.specialClauses ?? input.specialClauses ?? [],
    effects,
  };
}

export function respondCoachInterview(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const interview = state.interviews.find((candidate) => candidate.id === identifier(input.interviewId));
  const actorCoachId = identifier(input.coachId);
  if (!interview || (actorCoachId && interview.coachId !== actorCoachId)) {
    throw new CoachEmploymentError("Entrevista nao encontrada", "COACH_INTERVIEW_NOT_FOUND", 404);
  }
  assertCoachMayInterviewDuringNotice(room, interview.coachId);
  if (interview.status !== "pending") throw new CoachEmploymentError("Entrevista encerrada", "COACH_INTERVIEW_CLOSED", 409);
  if (interview.expiresAt && new Date(interview.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Entrevista expirada", "COACH_INTERVIEW_EXPIRED", 409);
  }
  interview.answers = clone(Array.isArray(input.answers) ? input.answers : []);
  const application = state.applications.find((candidate) => candidate.id === interview.applicationId) ?? null;
  const legacyAnswerCompatibility = interviewCompatibility(interview, interview.answers);
  const trustedAssessment = normalizeInterviewEvaluation(
    input.assessment,
    now,
    legacyAnswerCompatibility,
  );
  const answerCompatibility = trustedAssessment?.overallScore ?? legacyAnswerCompatibility;
  const selectionCompatibility = finite(application?.candidateAssessment?.score, answerCompatibility);
  interview.compatibilityScore = Math.round(clamp(
    trustedAssessment
      ? (selectionCompatibility * 0.3) + (answerCompatibility * 0.7)
      : (selectionCompatibility * 0.7) + (answerCompatibility * 0.3),
    0,
    100,
  ));
  interview.selectionScore = selectionCompatibility;
  interview.answerCompatibilityScore = answerCompatibility;
  if (trustedAssessment) {
    interview.evaluation = trustedAssessment;
    interview.cumulativeMetrics = normalizeInterviewMetrics(trustedAssessment.metrics, answerCompatibility);
    interview.relationshipImpact = normalizeInterviewRelationshipImpact(
      input.relationshipImpact ?? interview.relationshipImpact,
    );
    interview.negotiationEffects = normalizeInterviewNegotiationEffects(
      input.negotiationEffects ?? interview.negotiationEffects,
    );
    interview.memorySummary = limitedInterviewText(
      input.memorySummary ?? interview.memorySummary ?? trustedAssessment.summary,
      2_000,
    ) || null;
    if (application && interview.negotiationEffects?.priorityDelta) {
      application.interestScore = Math.round(clamp(
        finite(application.interestScore, selectionCompatibility) + interview.negotiationEffects.priorityDelta,
        0,
        100,
      ) * 10) / 10;
      application.shortlistScore = Math.round(clamp(
        finite(application.shortlistScore, selectionCompatibility) + interview.negotiationEffects.priorityDelta,
        0,
        100,
      ) * 10) / 10;
    }
  }
  interview.completedAt = now;
  const requestedDecision = identifier(input.decision).toLocaleLowerCase("pt-BR");
  const decision = interview.negotiationEffects?.terminateNegotiation
    ? "reject"
    : requestedDecision || generatedInterviewDecision(trustedAssessment, interview.compatibilityScore);
  const interviewPassed = interview.compatibilityScore >= MIN_INTERVIEW_COMPATIBILITY;
  const coach = coachById(room, interview.coachId);
  applyInterviewRelationshipMutable(coach, interview, now, id);
  let proposal = null;
  if (decision === "accept" && interviewPassed) {
    interview.status = "accepted";
    if (application) application.status = "accepted";
    const vacancy = state.vacancies.find((candidate) => (
      candidate.id === (application?.vacancyId ?? interview.vacancyId)
    )) ?? null;
    const suggestedWage = coachOfferWage(
      room,
      coach,
      interview.clubId,
      vacancy?.desiredProfile,
      state,
      now,
    );
    const terms = interviewAdjustedProposalTerms(room, vacancy, interview, input, suggestedWage);
    proposal = normalizeProposal({
      id: deterministicId("coach-proposal", `${id}|interview|${interview.id}`),
      coachId: interview.coachId,
      clubId: interview.clubId,
      vacancyId: application?.vacancyId ?? interview.vacancyId,
      applicationId: application?.id ?? interview.applicationId,
      interviewId: interview.id,
      wage: terms.wage,
      durationYears: terms.durationYears,
      terminationClause: terms.terminationClause,
      signingBonus: terms.signingBonus,
      transferBudget: terms.transferBudget,
      bonuses: terms.bonuses,
      objectives: terms.objectives,
      specialClauses: terms.specialClauses,
      interviewEvaluation: clone(interview.evaluation),
      interviewRelationshipImpact: clone(interview.relationshipImpact),
      interviewNegotiationEffects: clone(interview.negotiationEffects),
      interviewCompatibility: interview.compatibilityScore,
      autonomyDelta: interview.negotiationEffects?.autonomyDelta ?? 0,
      priorityDelta: interview.negotiationEffects?.priorityDelta ?? 0,
      objectiveDifficultyDelta: interview.negotiationEffects?.objectiveDifficultyDelta ?? 0,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: input.proposalExpiresAt ?? addDays(now, 7),
      plannedStartDate: input.plannedStartDate ?? now,
      availableBudget: availableClubFunds(room, interview.clubId),
      boardExpectation: vacancy?.desiredProfile?.expectation,
      clubSituation: vacancy?.reason,
      maxNegotiationRounds: state.marketConfig.maxNegotiationRounds,
      operationId: id,
    });
    state.proposals.push(proposal);
    if (!coach.currentClubId) coach.status = "negotiating";
  } else if (decision === "reject" || decision === "accept") {
    interview.status = "rejected";
    if (application) {
      application.status = "rejected";
      application.responseReason = decision === "accept"
        ? "interview_incompatible"
        : "candidate_rejected_interview";
    }
  } else {
    interview.status = "completed";
    if (application) application.status = "interview_completed";
  }
  if (application) application.updatedAt = now;
  appendDecision(interview, {
    action: proposal ? "interview_passed" : interview.status === "rejected" ? "interview_failed" : "interview_observed",
    responsibleId: interview.clubId,
    responsibleRole: "board",
    previousStatus: "pending",
    newStatus: interview.status,
    justification: trustedAssessment?.summary ?? `Compatibilidade ${interview.compatibilityScore}/100`,
    negotiatedValues: {
      compatibilityScore: interview.compatibilityScore,
      recommendation: trustedAssessment?.recommendation ?? null,
      negotiationEffects: clone(interview.negotiationEffects),
    },
  }, now, `${id}:interview`);
  const event = eventRecord(
    proposal ? "COACH_INTERVIEW_ACCEPTED" : interview.status === "rejected" ? "COACH_INTERVIEW_REJECTED" : "COACH_INTERVIEW_COMPLETED",
    id,
    now,
    {
      coachId: interview.coachId,
      clubId: interview.clubId,
      proposalId: proposal?.id,
      metadata: {
        interviewId: interview.id,
        compatibilityScore: interview.compatibilityScore,
        recommendation: interview.evaluation?.recommendation ?? null,
      },
    },
  );
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, [event], [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    interview: clone(interview),
    application: clone(application),
    proposal: clone(proposal),
    events: [clone(event)],
    duplicate: false,
  };
}

function updateInterviewCumulativeMetrics(interview, rawAnalysis, completedTurns) {
  if (!rawAnalysis || typeof rawAnalysis !== "object" || Array.isArray(rawAnalysis)) return;
  const current = normalizeInterviewMetrics(interview.cumulativeMetrics);
  const previousTurns = Math.max(0, completedTurns - 1);
  const rawMetrics = rawAnalysis.metrics && typeof rawAnalysis.metrics === "object"
    ? rawAnalysis.metrics
    : {
      clubCompatibility: rawAnalysis.strategicAlignment,
      longTermPotential: rawAnalysis.expectedTenure,
      culturalFit: rawAnalysis.culturalFit,
      perceivedRisk: rawAnalysis.perceivedRisk,
    };
  for (const metric of INTERVIEW_METRIC_KEYS) {
    if (!Number.isFinite(Number(rawMetrics[metric]))) continue;
    const next = clamp(Number(rawMetrics[metric]), 0, 100);
    current[metric] = Math.round(((current[metric] * previousTurns + next) / Math.max(1, completedTurns)) * 10) / 10;
  }
  if (Number.isFinite(Number(rawAnalysis.confidenceDelta))) {
    current.boardConfidence = Math.round(clamp(
      current.boardConfidence + Number(rawAnalysis.confidenceDelta),
      0,
      100,
    ) * 10) / 10;
  }
  if (Number.isFinite(Number(rawAnalysis.credibilityDelta))) {
    current.credibility = Math.round(clamp(
      current.credibility + Number(rawAnalysis.credibilityDelta),
      0,
      100,
    ) * 10) / 10;
  }
  interview.cumulativeMetrics = current;
}

function fallbackInterviewEvaluation(interview, now) {
  const metrics = normalizeInterviewMetrics(interview.cumulativeMetrics);
  const positiveKeys = INTERVIEW_METRIC_KEYS.filter((metric) => metric !== "perceivedRisk");
  const total = positiveKeys.reduce((sum, metric) => sum + metrics[metric], 100 - metrics.perceivedRisk);
  const overallScore = Math.round((total / (positiveKeys.length + 1)) * 10) / 10;
  return normalizeInterviewEvaluation({
    overallScore,
    metrics,
    strengths: positiveKeys
      .filter((metric) => metrics[metric] >= 70)
      .slice(0, 4)
      .map((metric) => metric),
    risks: metrics.perceivedRisk >= 60 ? ["Risco percebido acima do desejado pela diretoria"] : [],
    recommendation: overallScore >= 72 ? "hire" : overallScore >= 55 ? "hire_with_reservations" : "reject",
    summary: interview.memorySummary ?? `Entrevista concluida com avaliacao ${Math.round(overallScore)}/100.`,
    generatedAt: now,
  }, now, overallScore);
}

/**
 * Persists one trusted, server-generated interview turn. Gemini/network work
 * must happen before this pure domain operation; revision/question checks make
 * the later transaction safe against duplicated or stale responses.
 */
export function applyCoachInterviewGeneratedTurn(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const interviewId = identifier(input.interviewId);
  const interview = state.interviews.find((candidate) => candidate.id === interviewId);
  const actorCoachId = identifier(input.coachId);
  if (!interview || (actorCoachId && interview.coachId !== actorCoachId)) {
    throw new CoachEmploymentError("Entrevista nao encontrada", "COACH_INTERVIEW_NOT_FOUND", 404);
  }
  if (hasProcessed(state, id)) {
    const application = state.applications.find((candidate) => candidate.id === interview.applicationId) ?? null;
    const proposal = state.proposals.find((candidate) => candidate.interviewId === interview.id) ?? null;
    return {
      room,
      interview: clone(interview),
      application: clone(application),
      proposal: clone(proposal),
      events: [],
      duplicate: true,
    };
  }
  if (interview.status !== "pending") {
    throw new CoachEmploymentError("Entrevista encerrada", "COACH_INTERVIEW_CLOSED", 409);
  }
  if (interview.expiresAt && new Date(interview.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Entrevista expirada", "COACH_INTERVIEW_EXPIRED", 409);
  }
  if (!Number.isInteger(Number(input.expectedRevision)) || Number(input.expectedRevision) !== interview.revision) {
    throw new CoachEmploymentError(
      "Entrevista foi atualizada em outra sessao",
      "COACH_INTERVIEW_REVISION_CONFLICT",
      409,
      { expectedRevision: input.expectedRevision, currentRevision: interview.revision },
    );
  }
  const expectedQuestionId = identifier(input.expectedQuestionId) || null;
  if (expectedQuestionId !== interview.currentQuestionId) {
    throw new CoachEmploymentError(
      "Pergunta atual da entrevista foi alterada",
      "COACH_INTERVIEW_QUESTION_CONFLICT",
      409,
      { expectedQuestionId, currentQuestionId: interview.currentQuestionId },
    );
  }
  const phase = identifier(input.phase).toLocaleLowerCase("en-US");
  if (!['start', 'answer'].includes(phase)) {
    throw new CoachEmploymentError("Fase da entrevista invalida", "COACH_INTERVIEW_PHASE_INVALID", 400);
  }
  if (phase === "start" && (interview.currentQuestionId || interview.transcript.length > 0)) {
    throw new CoachEmploymentError("Entrevista ja iniciada", "COACH_INTERVIEW_ALREADY_STARTED", 409);
  }
  if (phase === "answer" && !interview.currentQuestionId) {
    throw new CoachEmploymentError("Entrevista ainda nao possui pergunta ativa", "COACH_INTERVIEW_QUESTION_REQUIRED", 409);
  }
  const candidateMessage = limitedInterviewText(input.candidateMessage, 2_000);
  if (phase === "answer" && !candidateMessage) {
    throw new CoachEmploymentError("Resposta do treinador e obrigatoria", "COACH_INTERVIEW_ANSWER_REQUIRED", 400);
  }
  const generated = input.generated && typeof input.generated === "object" && !Array.isArray(input.generated)
    ? input.generated
    : null;
  const boardMessage = limitedInterviewText(generated?.message, 2_000);
  if (!generated || !boardMessage) {
    throw new CoachEmploymentError("Resposta gerada invalida", "COACH_INTERVIEW_GENERATED_TURN_INVALID", 400);
  }
  const generatedSource = identifier(generated.source).toLocaleLowerCase("en-US");
  if (!["gemini", "fallback"].includes(generatedSource)) {
    throw new CoachEmploymentError("Fonte da entrevista invalida", "COACH_INTERVIEW_SOURCE_INVALID", 400);
  }

  if (phase === "start") {
    interview.questions = [];
    const requestedDepth = identifier(input.depth).toLocaleLowerCase("en-US");
    interview.depth = INTERVIEW_DEPTHS.has(requestedDepth) ? requestedDepth : interview.depth;
    const limits = interviewDepthLimits(interview.depth);
    interview.minTurns = limits.minimum;
    interview.maxTurns = limits.maximum;
    if (input.contextSnapshot && typeof input.contextSnapshot === "object" && !Array.isArray(input.contextSnapshot)) {
      interview.contextSnapshot = clone(input.contextSnapshot);
      interview.contextHash = hashText(JSON.stringify(interview.contextSnapshot)).toString(36);
    }
  }
  if (phase === "answer") {
    interview.turnCount += 1;
    interview.transcript.push({
      id: deterministicId("coach-interview-message", `${id}|candidate`),
      role: "coach",
      text: candidateMessage,
      topic: limitedInterviewText(generated.topic, 80) || "general",
      questionId: interview.currentQuestionId,
      createdAt: now,
      turn: interview.turnCount,
      analysis: null,
      operationId: id,
    });
    interview.answers.push({
      questionId: interview.currentQuestionId,
      text: candidateMessage,
      source: "coach",
    });
    updateInterviewCumulativeMetrics(interview, generated.turnAnalysis, interview.turnCount);
    const normalizedTurnAnalysis = normalizeInterviewTurnAnalysis(generated.turnAnalysis);
    interview.relationshipImpact = mergeInterviewRelationshipImpact(
      interview.relationshipImpact,
      normalizedTurnAnalysis?.relationshipImpact ?? generated.relationshipImpact,
    );
  }

  const canEnd = interview.turnCount >= interview.minTurns;
  const negotiationTerminated = Boolean(generated.negotiationEffects?.terminateNegotiation);
  const shouldEnd = negotiationTerminated || (Boolean(generated.shouldEnd) && canEnd);
  const boardMessageId = deterministicId("coach-interview-message", `${id}|board`);
  const turnAnalysis = normalizeInterviewTurnAnalysis(generated.turnAnalysis);
  interview.transcript.push({
    id: boardMessageId,
    role: "board",
    text: boardMessage,
    topic: limitedInterviewText(generated.topic, 80) || "general",
    questionId: null,
    createdAt: now,
    turn: Math.max(1, interview.turnCount + (phase === "start" ? 1 : 0)),
    analysis: turnAnalysis,
    operationId: id,
  });
  interview.transcript = interview.transcript.slice(-80);
  interview.currentQuestionId = shouldEnd ? null : boardMessageId;
  if (!shouldEnd) {
    interview.questions = [...interview.questions, {
      id: boardMessageId,
      topic: limitedInterviewText(generated.topic, 80) || "general",
      prompt: boardMessage,
      preferredAnswer: null,
    }].slice(-20);
  }
  interview.mode = generatedSource === "gemini" ? "generative" : "fallback";
  interview.source = generatedSource;
  interview.model = limitedInterviewText(generated.model, 120) || null;
  interview.negotiationEffects = normalizeInterviewNegotiationEffects(
    generated.negotiationEffects ?? interview.negotiationEffects,
  );
  interview.memorySummary = limitedInterviewText(
    generated.memorySummary ?? interview.memorySummary,
    2_000,
  ) || null;
  interview.revision += 1;
  interview.updatedAt = now;
  appendDecision(interview, {
    action: shouldEnd ? "generated_interview_completed" : phase === "start" ? "generated_interview_started" : "generated_interview_turn",
    responsibleId: interview.clubId,
    responsibleRole: "board",
    previousStatus: interview.status,
    newStatus: interview.status,
    justification: shouldEnd ? "Controlador encerrou a entrevista" : `Turno ${interview.turnCount}`,
    negotiatedValues: {
      revision: interview.revision,
      turnCount: interview.turnCount,
      source: interview.source,
      topic: limitedInterviewText(generated.topic, 80) || "general",
    },
  }, now, `${id}:turn`);
  const progressEvent = eventRecord(
    phase === "start" ? "COACH_INTERVIEW_STARTED" : "COACH_INTERVIEW_TURN_RECORDED",
    `${id}:progress`,
    now,
    {
      coachId: interview.coachId,
      clubId: interview.clubId,
      vacancyId: interview.vacancyId,
      metadata: {
        interviewId: interview.id,
        revision: interview.revision,
        turnCount: interview.turnCount,
        source: interview.source,
        completed: shouldEnd,
      },
    },
  );

  if (!shouldEnd) {
    assertCoachEmploymentIntegrity(room, now);
    emitCallbacks(room, [progressEvent], [], options);
    markProcessed(state, id);
    synchronizeCareerAndRetain(room, state, now);
    return {
      room,
      interview: clone(interview),
      application: clone(state.applications.find((candidate) => candidate.id === interview.applicationId) ?? null),
      proposal: null,
      events: [clone(progressEvent)],
      duplicate: false,
    };
  }

  const generatedEvaluation = generated.evaluation && typeof generated.evaluation === "object"
    ? {
      ...clone(generated.evaluation),
      metrics: {
        ...normalizeInterviewMetrics(interview.cumulativeMetrics),
        ...(generated.evaluation.metrics && typeof generated.evaluation.metrics === "object"
          ? clone(generated.evaluation.metrics)
          : {}),
        ...Object.fromEntries(INTERVIEW_METRIC_KEYS.flatMap((metric) => (
          Number.isFinite(Number(generated.evaluation[metric]))
            ? [[metric, Number(generated.evaluation[metric])]]
            : []
        ))),
      },
    }
    : null;
  const evaluation = normalizeInterviewEvaluation(
    generatedEvaluation,
    now,
    interview.compatibilityScore ?? 50,
  ) ?? fallbackInterviewEvaluation(interview, now);
  const decision = negotiationTerminated
    ? "reject"
    : generatedInterviewDecision(evaluation, evaluation.overallScore);
  const answers = interview.transcript.filter((entry) => entry.role === "coach").map((entry) => ({
    questionId: entry.questionId,
    text: entry.text,
    source: interview.source,
  }));
  emitCallbacks(room, [progressEvent], [], options);
  const completed = respondCoachInterview(room, {
    operationId: id,
    coachId: interview.coachId,
    interviewId: interview.id,
    answers,
    decision: decision === "complete" ? "" : decision,
    assessment: evaluation,
    relationshipImpact: interview.relationshipImpact,
    negotiationEffects: interview.negotiationEffects,
    memorySummary: interview.memorySummary,
    proposalExpiresAt: input.proposalExpiresAt,
    plannedStartDate: input.plannedStartDate,
  }, options);
  return {
    ...completed,
    events: [clone(progressEvent), ...(completed.events ?? [])],
  };
}

export function renewCoachContract(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  const previous = activeContractForCoach(state, coach.id);
  if (!appointment || !previous) throw new CoachEmploymentError("Contrato ativo nao encontrado", "COACH_ACTIVE_CONTRACT_NOT_FOUND", 409);
  const clubId = canonicalClubId(room, input.clubId ?? appointment.clubId);
  if (clubKey(clubId) !== clubKey(appointment.clubId)) {
    throw new CoachEmploymentError("Contrato pertence a outro clube", "COACH_CLUB_MISMATCH", 409);
  }
  const activeRenewal = state.proposals.find((proposal) => (
    proposal.kind === "renewal"
      && proposal.sourceContractId === previous.id
      && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  ));
  if (activeRenewal) {
    throw new CoachEmploymentError("Renovacao ja esta em negociacao", "COACH_RENEWAL_ALREADY_ACTIVE", 409, {
      proposalId: activeRenewal.id,
    });
  }
  const outcome = createCoachProposal(room, {
    ...input,
    operationId: id,
    coachId: coach.id,
    clubId,
    kind: "renewal",
    initiatedBy: input.initiatedBy ?? (coach.managerType === "human" ? "coach" : "club"),
    sourceContractId: previous.id,
    wage: input.wage ?? input.salary ?? previous.wage,
    terminationClause: input.terminationClause ?? previous.terminationClause,
    signingBonus: input.signingBonus ?? input.renewalBonus,
    bonuses: input.bonuses ?? previous.bonuses,
    objectives: input.objectives ?? previous.objectives,
    responseDays: input.responseDays ?? state.marketConfig.proposalValidityDays,
    boardExpectation: input.boardExpectation ?? "Acordar continuidade do projeto esportivo",
    clubSituation: input.clubSituation ?? "Renovacao de contrato vigente",
    message: input.message ?? "Negociacao de renovacao iniciada.",
    reason: input.reason ?? "renewal_negotiation_opened",
  }, { ...options, now });
  return {
    ...outcome,
    coach: clone(coach),
    appointment: clone(appointment),
    contract: null,
    previousContract: clone(previous),
  };
}

function fixturesAndResults(room) {
  const fixtures = new Map((Array.isArray(room?.leagueFixtureSchedule) ? room.leagueFixtureSchedule : [])
    .map((fixture) => [identifier(fixture?.leagueFixtureId), fixture]));
  return (Array.isArray(room?.leagueMatchResults) ? room.leagueMatchResults : []).flatMap((result) => {
    const fixture = fixtures.get(identifier(result?.leagueFixtureId));
    const score = Array.isArray(result?.score) ? result.score.map((value) => integer(value, 0, 0, 50)) : null;
    return fixture && score?.length >= 2 ? [{ fixture, result, score }] : [];
  });
}

function leagueForClub(room, clubId) {
  return (room?.competitionCatalog ?? []).find((competition) => (
    (competition?.clubs ?? []).some((club) => clubKey(club?.id ?? club?.code) === clubKey(clubId))
  )) ?? null;
}

function standingsFor(room, league) {
  const clubs = (league?.clubs ?? []).map((club) => identifier(club?.id ?? club?.code)).filter(Boolean);
  const rows = new Map(clubs.map((clubId) => [clubKey(clubId), {
    clubId, played: 0, points: 0, goalDifference: 0,
  }]));
  for (const { fixture, score } of fixturesAndResults(room)) {
    if (clubKey(fixture?.leagueId) !== clubKey(league?.id)) continue;
    const home = rows.get(clubKey(fixture.homeClubId));
    const away = rows.get(clubKey(fixture.awayClubId));
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.goalDifference += score[0] - score[1];
    away.goalDifference += score[1] - score[0];
    if (score[0] > score[1]) home.points += 3;
    else if (score[1] > score[0]) away.points += 3;
    else { home.points += 1; away.points += 1; }
  }
  return [...rows.values()].sort((left, right) => (
    right.points - left.points
      || right.goalDifference - left.goalDifference
      || left.clubId.localeCompare(right.clubId, "pt-BR")
  ));
}

function expectationFor(room, clubId, league, contract) {
  const clubs = [...(league?.clubs ?? [])].sort((left, right) => finite(right?.reputation) - finite(left?.reputation));
  const reputationRank = Math.max(1, clubs.findIndex((club) => clubKey(club?.id ?? club?.code) === clubKey(clubId)) + 1);
  const targetObjective = (contract?.objectives ?? []).find((objective) => (
    ["position", "league_position", "finish_position"].includes(identifier(objective?.type ?? objective?.id))
      && Number.isFinite(Number(objective?.target))
  ));
  const expectedPosition = targetObjective ? integer(targetObjective.target, reputationRank, 1) : reputationRank;
  const ratio = expectedPosition / Math.max(1, clubs.length);
  return {
    expectedPosition,
    expectedPointsPerGame: ratio <= 0.25 ? 1.9 : ratio <= 0.65 ? 1.4 : 1.05,
  };
}

function appointmentStatistics(room, appointment, now) {
  const league = leagueForClub(room, appointment.clubId);
  const startRound = integer(appointment.startedRound, 1, 1);
  const endRound = appointment.status === "active"
    ? Number.MAX_SAFE_INTEGER
    : integer(appointment.endedRound, completedRound(room), 0);
  const relevant = fixturesAndResults(room).filter(({ fixture }) => (
    clubKey(fixture?.leagueId) === clubKey(league?.id)
      && integer(fixture?.round, 0) >= startRound
      && integer(fixture?.round, 0) <= endRound
      && [fixture.homeClubId, fixture.awayClubId].some((clubId) => clubKey(clubId) === clubKey(appointment.clubId))
  ));
  const statistics = relevant.reduce((summary, { fixture, score }) => {
    const home = clubKey(fixture.homeClubId) === clubKey(appointment.clubId);
    const own = home ? score[0] : score[1];
    const rival = home ? score[1] : score[0];
    summary.games += 1;
    summary.goalsFor += own;
    summary.goalsAgainst += rival;
    if (own > rival) {
      summary.wins += 1;
      summary.points += 3;
    } else if (own === rival) {
      summary.draws += 1;
      summary.points += 1;
    } else summary.losses += 1;
    return summary;
  }, {
    games: 0,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
  });
  return normalizeAppointmentStatistics({
    ...statistics,
    pointsPerGame: statistics.games > 0 ? statistics.points / statistics.games : 0,
    updatedAt: now,
  });
}

function evaluateAppointment(room, state, appointment, now, minimumGames, id) {
  const league = leagueForClub(room, appointment.clubId);
  const rows = standingsFor(room, league);
  const rowIndex = rows.findIndex((row) => clubKey(row.clubId) === clubKey(appointment.clubId));
  const row = rows[rowIndex] ?? { played: 0, points: 0 };
  const relevant = fixturesAndResults(room).filter(({ fixture }) => (
    clubKey(fixture?.leagueId) === clubKey(league?.id)
      && integer(fixture?.round, 0) >= integer(appointment.startedRound, 1)
      && [fixture.homeClubId, fixture.awayClubId].some((clubId) => clubKey(clubId) === clubKey(appointment.clubId))
  ));
  const statistics = appointmentStatistics(room, appointment, now);
  appointment.statistics = statistics;
  const { games, points } = statistics;
  const contract = activeContractForCoach(state, appointment.coachId);
  const expectation = expectationFor(room, appointment.clubId, league, contract);
  const position = rowIndex >= 0 ? rowIndex + 1 : null;
  return evaluateCoachJobSecurity({
    room,
    employmentState: state,
    appointment,
    contract,
    league,
    standings: rows,
    relevantMatches: relevant,
    statistics,
    expectation,
    position,
    now,
    seasonNumber: seasonNumber(room),
    round: completedRound(room),
    minimumGames,
    evaluationId: id,
  });
}

function careerHistoryMarketSignals(room, state, coach, now = state?.currentDate) {
  // ensureCoachEmploymentState synchronizes this permanent ledger before any
  // market operation. Read it directly here: rebuilding a cloned full room for
  // every candidate made shortlist scans quadratic in save size.
  const spells = Array.isArray(coach?.assignments) ? coach.assignments : [];
  const reputation = Array.isArray(coach?.careerReputationHistory)
    ? coach.careerReputationHistory
    : [];
  const history = {
    version: coach?.careerHistoryVersion ?? null,
    updatedAt: coach?.careerHistoryUpdatedAt ?? now ?? null,
    coachId: coach?.id ?? null,
    summary: coach?.careerHistorySummary ?? {},
    assignments: spells,
    spells,
    matches: Array.isArray(coach?.careerMatchHistory) ? coach.careerMatchHistory : [],
    timeline: Array.isArray(coach?.careerTimeline) ? coach.careerTimeline : [],
    negotiations: Array.isArray(coach?.negotiationHistory) ? coach.negotiationHistory : [],
    reputationHistory: reputation,
    unemploymentPeriods: Array.isArray(coach?.unemploymentPeriods) ? coach.unemploymentPeriods : [],
  };
  const summary = history?.summary ?? {};
  const matches = Math.max(0, finite(summary.matches, 0));
  const pointsPerGame = matches > 0 ? finite(summary.pointsPerGame, 0) : null;
  const titles = Math.max(0, finite(summary.titles, 0));
  const renewals = Math.max(0, finite(summary.renewals, 0));
  const resignations = Math.max(0, finite(summary.resignations, 0));
  const dismissals = Math.max(0, finite(summary.dismissals, 0));
  const relegations = Math.max(0, finite(summary.relegations, 0));
  const completedContracts = spells.filter((spell) => (
    ["contract_expired", "contract_completed", "natural_end"].includes(identifier(spell?.exitReason))
  )).length;
  const longSpells = spells.filter((spell) => finite(spell?.durationDays, 0) >= 365).length;
  const performance = matches >= 5
    ? clamp(((pointsPerGame - 1.35) * 12) + Math.min(8, titles * 1.5), -8, 14)
    : Math.min(5, titles * 1.5);
  const reliability = clamp(
    (completedContracts * 2)
      + (renewals * 1.5)
      + Math.min(4, longSpells)
      - (resignations * 3.5)
      - (dismissals * 1.5),
    -14,
    10,
  );
  const risk = clamp(
    35
      + (resignations * 12)
      + (dismissals * 7)
      + (relegations * 4)
      - (completedContracts * 4)
      - (Math.min(4, longSpells) * 3),
    0,
    100,
  );
  const orderedReputation = [...reputation]
    .filter((entry) => Number.isFinite(Number(entry?.reputationAfter ?? entry?.value)))
    .sort((left, right) => String(left?.occurredAt ?? left?.date ?? "")
      .localeCompare(String(right?.occurredAt ?? right?.date ?? "")));
  const firstReputation = orderedReputation[0];
  const lastReputation = orderedReputation.at(-1);
  const reputationTrend = firstReputation && lastReputation
    ? clamp(
      finite(lastReputation.reputationAfter ?? lastReputation.value, 0)
        - finite(firstReputation.reputationAfter ?? firstReputation.value, 0),
      -20,
      20,
    )
    : 0;
  return {
    history,
    matches,
    pointsPerGame,
    titles,
    renewals,
    resignations,
    dismissals,
    completedContracts,
    longSpells,
    performance: Math.round(performance * 10) / 10,
    reliability: Math.round(reliability * 10) / 10,
    reputationTrend: Math.round(reputationTrend * 10) / 10,
    risk: Math.round(risk * 10) / 10,
    marketAdjustment: Math.round(clamp(performance + reliability + reputationTrend * 0.15, -24, 18) * 10) / 10,
    salaryMultiplier: clamp(
      1
        + Math.max(0, performance) * 0.012
        + Math.min(10, titles) * 0.01
        - Math.max(0, risk - 60) * 0.002,
      0.85,
      1.25,
    ),
    durationDelta: risk >= 65 ? -1 : risk <= 30 && longSpells > 0 ? 1 : 0,
  };
}

function coachMarketAssessment(room, state, coach, vacancy, now, config = state.marketConfig) {
  const assessment = evaluateCoachCandidate(room, state, coach, vacancy, now, {
    selectionWeights: config?.selectionWeights,
    activeSearch: state.jobSearchByCoachId?.[coach.id]?.active === true,
  });
  const trust = coachCareerTrustSummary(coach);
  const activeRestriction = activeCoachMarketRestriction(coach, now);
  const historySignals = careerHistoryMarketSignals(room, state, coach, now);
  const conductAdjustment = clamp(
    ((trust.score - 80) * 0.18) - (activeRestriction ? 2 : 0),
    -25,
    6,
  );
  const totalAdjustment = conductAdjustment + historySignals.marketAdjustment;
  return {
    ...assessment,
    score: Math.round(clamp(assessment.score + totalAdjustment, 0, 100) * 100) / 100,
    careerHistory: {
      summary: clone(historySignals.history?.summary ?? {}),
      risk: historySignals.risk,
      performance: historySignals.performance,
      reliability: historySignals.reliability,
      reputationTrend: historySignals.reputationTrend,
      evidence: {
        matches: historySignals.matches,
        titles: historySignals.titles,
        completedContracts: historySignals.completedContracts,
        longSpells: historySignals.longSpells,
        resignations: historySignals.resignations,
        dismissals: historySignals.dismissals,
      },
    },
    factors: [
      ...assessment.factors,
      {
        code: "career_reliability",
        label: "Confianca profissional",
        weight: 0,
        rawScore: trust.score,
        weightedScore: Math.round(conductAdjustment * 100) / 100,
        detail: `${trust.label}; ${trust.voluntaryExitCount} saida(s) voluntaria(s)`,
      },
      {
        code: "career_history",
        label: "Historico profissional",
        weight: 0,
        rawScore: Math.round(clamp(50 + historySignals.marketAdjustment * 2, 0, 100) * 100) / 100,
        weightedScore: historySignals.marketAdjustment,
        detail: `${historySignals.matches} jogo(s); ${historySignals.titles} titulo(s); risco ${historySignals.risk}/100`,
      },
    ],
  };
}

function latestCoachEvaluation(state, coachId) {
  return state.evaluations
    .filter((evaluation) => evaluation.coachId === coachId)
    .sort((left, right) => String(right.evaluatedAt ?? "").localeCompare(String(left.evaluatedAt ?? "")))[0] ?? null;
}

function coachEligibleForVacancy(room, state, coach, vacancy, now, config) {
  if (["retired", "retiring", "on_leave"].includes(coach.status)
    || coachRetirementBlocksMarket(room, coach.id)) return false;
  const vacancyOpenedAt = new Date(vacancy.openedAt ?? 0).getTime();
  const recentDeparture = [...(coach.assignments ?? [])].reverse().find((assignment) => (
    clubKey(assignment.clubId) === clubKey(vacancy.clubId)
      && assignment.exitReason
      && Number.isFinite(new Date(assignment.endedAt ?? 0).getTime())
      && new Date(assignment.endedAt ?? 0).getTime() >= vacancyOpenedAt - (180 * DAY_MS)
  ));
  if (recentDeparture) return false;
  if (clubKey(coach.currentClubId) === clubKey(vacancy.clubId)) return false;
  if (coach.currentClubId) {
    const activeContract = activeContractForCoach(state, coach.id);
    const remainingDays = activeContract?.endDate
      ? Math.ceil((new Date(activeContract.endDate).getTime() - new Date(now).getTime()) / DAY_MS)
      : Number.POSITIVE_INFINITY;
    const contractAvailable = remainingDays > 0 && remainingDays <= config.preContractWindowDays
      ? true
      : clubCanAffordCoachRelease(room, state, coach, vacancy.clubId);
    if (!contractAvailable) return false;
  }
  return coachMarketAssessment(room, state, coach, vacancy, now, config).eligible;
}

function marketProposalTiming(state, coach, now, config) {
  const contract = activeContractForCoach(state, coach.id);
  if (!contract?.endDate) return { kind: "hiring", plannedStartDate: now, compensation: contract?.terminationClause ?? 0 };
  const remainingDays = Math.ceil((new Date(contract.endDate).getTime() - new Date(now).getTime()) / DAY_MS);
  if (remainingDays > 0 && remainingDays <= config.preContractWindowDays) {
    return { kind: "precontract", plannedStartDate: contract.endDate, compensation: 0 };
  }
  return { kind: "hiring", plannedStartDate: now, compensation: contract.terminationClause ?? 0 };
}

function availableClubFunds(room, clubId) {
  const finance = (room?.marketState?.finances ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(clubId)
  ));
  if (!finance || !Number.isFinite(Number(finance.balance))) return null;
  return Math.max(0, Number(finance.balance) - Math.max(0, finite(finance.committed, 0)));
}

function salarySolvencyCostForTerms(wage, durationYears) {
  const monthlyWage = integer(wage, 0, 0, 20_000_000);
  const months = Math.min(12, integer(durationYears, 2, 1, 10) * 12);
  return Math.min(MAX_MONEY, monthlyWage * months);
}

function clubCanAffordCoachRelease(room, state, coach, targetClubId) {
  if (!coach.currentClubId || clubKey(coach.currentClubId) === clubKey(targetClubId)) return true;
  const funds = availableClubFunds(room, targetClubId);
  if (funds == null) return true;
  const contract = activeContractForCoach(state, coach.id);
  return funds >= integer(contract?.terminationClause, 0, 0, MAX_MONEY);
}

function coachOfferWage(room, coach, clubId, desiredProfile = null, state = null, now = null) {
  const club = catalogClubs(room).get(clubKey(clubId));
  const coachReputation = normalizeCoachReputation100(coach?.reputation, 45);
  const clubReputation = normalizeCoachReputation100(club?.reputation, 45);
  const fallback = Math.round((25_000 + coachReputation * 1_750 + clubReputation * 1_250) / 1_000) * 1_000;
  const salary = desiredProfile?.salary ?? {};
  const minimum = Math.max(1_000, integer(salary.minimum, Math.round(fallback * 0.75), 1_000, MAX_MONEY));
  const ideal = integer(salary.ideal, fallback, minimum, MAX_MONEY);
  const maximum = integer(salary.maximum, Math.round(fallback * 1.35), ideal, MAX_MONEY);
  const expected = integer(coach?.expectedSalary, ideal, 0, MAX_MONEY);
  const careerMultiplier = state
    ? careerHistoryMarketSignals(room, state, coach, now ?? state.currentDate).salaryMultiplier
    : 1;
  return Math.round(clamp(
    ((ideal * 0.65) + (expected * 0.35)) * careerMultiplier,
    minimum,
    maximum,
  ) / 1_000) * 1_000;
}

function vacancyAgeDays(vacancy, now) {
  const opened = new Date(vacancy.openedAt ?? now).getTime();
  return Math.max(0, Math.floor((new Date(now).getTime() - opened) / DAY_MS));
}

function activeCoachProposal(state, clubId, coachId = null) {
  return state.proposals.find((proposal) => (
    clubKey(proposal.clubId) === clubKey(clubId)
      && (!coachId || proposal.coachId === coachId)
      && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  )) ?? null;
}

function createDeterministicHumanInvitation(room, state, vacancy, now, events, processed) {
  const candidates = (room.coachCareerState?.coaches ?? [])
    .filter((coach) => {
      if (coach.managerType !== "human" || coach.status === "retired") return false;
      if (clubKey(coach.currentClubId) === clubKey(vacancy.clubId)) return false;
      if (!coachEligibleForVacancy(room, state, coach, vacancy, now, state.marketConfig)) return false;
      const search = state.jobSearchByCoachId?.[coach.id]?.active === true;
      const latest = state.evaluations
        .filter((evaluation) => evaluation.coachId === coach.id)
        .sort((left, right) => String(right.evaluatedAt ?? "").localeCompare(String(left.evaluatedAt ?? "")))[0];
      return search || (latest?.minimumGamesMet && latest.score >= 78);
    })
    .map((coach) => ({
      coach,
      assessment: coachMarketAssessment(room, state, coach, vacancy, now, state.marketConfig),
    }))
    .filter(({ assessment }) => (
      assessment.eligible && assessment.score >= state.marketConfig.minimumCandidateScore
    ))
    .sort((left, right) => right.assessment.score - left.assessment.score
      || left.coach.id.localeCompare(right.coach.id, "pt-BR"));
  const selected = candidates[0];
  if (!selected) return null;
  const { coach, assessment } = selected;
  if (state.applications.some((application) => (
    application.vacancyId === vacancy.id
      && application.coachId === coach.id
  ))) return null;
  if (activeCoachProposal(state, vacancy.clubId, coach.id)) return null;
  const id = `coach-invitation:s${seasonNumber(room)}:r${completedRound(room)}:${vacancy.id}:${coach.id}`;
  if (hasProcessed(state, id)) return null;
  const application = normalizeApplication({
    id: deterministicId("coach-application", `${vacancy.id}|${coach.id}`),
    vacancyId: vacancy.id,
    clubId: vacancy.clubId,
    coachId: coach.id,
    status: "submitted",
    submittedAt: now,
    updatedAt: now,
    interestScore: assessment.score,
    shortlistScore: assessment.score,
    candidateAssessment: assessment,
    operationId: id,
  });
  state.applications.push(application);
  vacancy.shortlistCoachIds = [...new Set([...vacancy.shortlistCoachIds, coach.id])].slice(0, 20);
  appendDecision(application, {
    action: "candidate_invited_to_process",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: null,
    newStatus: application.status,
    justification: `Clube convidou candidato com compatibilidade ${assessment.score}/100`,
    negotiatedValues: {
      score: assessment.score,
      profileVersion: assessment.profileVersion,
    },
  }, now, id);
  events.push(eventRecord("COACH_CANDIDATE_INVITED", id, now, {
    coachId: coach.id,
    clubId: vacancy.clubId,
    relatedClubId: coach.currentClubId,
    vacancyId: vacancy.id,
    metadata: {
      source: "ai_job_market_invitation",
      applicationId: application.id,
      shortlistScore: assessment.score,
      profileVersion: assessment.profileVersion,
    },
  }));
  processed.push(id);
  return application;
}

function coachMarketConfig(state, options = {}) {
  return normalizedMarketConfig({
    ...state.marketConfig,
    ...(options.coachMarketConfig && typeof options.coachMarketConfig === "object" ? options.coachMarketConfig : {}),
    ...(options.minimumVacancyDays != null ? { searchDelayDays: options.minimumVacancyDays } : {}),
    ...(options.aiRenewalWindowDays != null ? { renewalWindowDays: options.aiRenewalWindowDays } : {}),
    ...(options.aiRenewalMinimumScore != null ? { renewalMinimumScore: options.aiRenewalMinimumScore } : {}),
    ...(options.boardResponseDelayDays != null ? { boardResponseDelayDays: options.boardResponseDelayDays } : {}),
  });
}

function proposalForApplication(state, applicationId) {
  return state.proposals.find((proposal) => proposal.applicationId === applicationId) ?? null;
}

function interviewForApplication(state, applicationId) {
  return state.interviews.find((interview) => interview.applicationId === applicationId) ?? null;
}

function contextualAiInterviewQuestions(vacancy, application, coach, depth = "standard") {
  const profile = vacancy?.desiredProfile ?? {};
  const clubId = identifier(vacancy?.clubId) || "clube";
  const preferredStyle = identifier(profile.style ?? profile.playingStyle) || "modelo de jogo do clube";
  const preferredFormation = identifier(profile.preferredFormation ?? profile.formation) || "estrutura adaptavel";
  const objectives = normalizedObjectives(profile.objectives);
  const firstObjective = objectives[0]?.title ?? "os objetivos esportivos da temporada";
  const risks = (application?.candidateAssessment?.hardBlockers ?? [])
    .map((entry) => limitedInterviewText(entry?.label ?? entry?.code, 120))
    .filter(Boolean);
  const pool = [
    { topic: "objectives", prompt: `Qual plano pratico voce adotaria para cumprir ${firstObjective}?` },
    { topic: "tactics", prompt: `Como conciliaria ${preferredFormation} e ${preferredStyle} com o elenco atual?` },
    { topic: "squad", prompt: "Quais setores do elenco avaliaria primeiro e como corrigiria os desequilibrios encontrados?" },
    { topic: "leadership", prompt: `Como construiria confianca com diretoria e jogadores ao assumir o ${clubId}?` },
    { topic: "youth", prompt: "Que criterios usaria para promover jovens sem comprometer os resultados imediatos?" },
    { topic: "finance", prompt: "Como equilibraria ambicao esportiva, salarios e orcamento de transferencias?" },
    { topic: "pressure", prompt: `Como reagiria a uma sequencia ruim dentro das expectativas definidas para o ${clubId}?` },
    { topic: "adaptation", prompt: "Como pretende adaptar sua metodologia ao pais, idioma e cultura do clube?" },
    ...(risks.length ? [{
      topic: "risk",
      prompt: `Nossa analise apontou esta preocupacao: ${risks[0]}. Como pretende resolve-la?`,
    }] : []),
  ];
  const preferredAnswers = {
    objectives: "measurable_plan",
    tactics: "adaptable",
    squad: "evidence_based",
    leadership: "clear_accountability",
    youth: "develop",
    finance: "responsible",
    pressure: "balanced",
    adaptation: "learn_and_adapt",
    risk: "specific_mitigation",
  };
  const limits = interviewDepthLimits(depth);
  const desiredCount = Math.min(pool.length, Math.max(limits.minimum, depth === "deep" ? 7 : depth === "quick" ? 3 : 5));
  const seed = `${vacancy?.id}|${coach?.id}|${application?.candidateAssessment?.score ?? 50}`;
  return pool
    .map((question) => ({ question, order: hashText(`${seed}|${question.topic}`) }))
    .sort((left, right) => left.order - right.order || left.question.topic.localeCompare(right.question.topic, "pt-BR"))
    .slice(0, desiredCount)
    .map(({ question }, index) => ({
      id: deterministicId("coach-interview-question", `${seed}|${index}|${question.topic}`),
      topic: question.topic,
      prompt: question.prompt,
      preferredAnswer: preferredAnswers[question.topic] ?? "balanced",
    }));
}

function createAiInterviewMutable(state, vacancy, application, coach, now, config, events, processed) {
  const existing = interviewForApplication(state, application.id);
  if (existing) return existing;
  const id = `coach-ai-interview:${vacancy.id}:${coach.id}`;
  const profileQuestions = Array.isArray(vacancy.desiredProfile?.interviewQuestions)
    ? vacancy.desiredProfile.interviewQuestions
    : [];
  const contextSnapshot = {
    vacancy: {
      id: vacancy.id,
      clubId: vacancy.clubId,
      reason: vacancy.reason ?? null,
      desiredProfile: clone(vacancy.desiredProfile ?? {}),
    },
    candidate: {
      coachId: coach.id,
      reputation: finite(coach.reputation ?? coach.marketReputation, 50),
      professionalTrust: finite(coach.professionalTrust, 80),
      preferredFormation: identifier(coach.preferredFormation) || null,
      style: identifier(coach.style ?? coach.playingStyle) || null,
      experienceYears: finite(coach.experienceYears),
      achievements: clone(coach.achievements ?? {}),
      previousInterviewMemories: clone((coach.interviewMemories ?? []).slice(-10)),
    },
    candidateAssessment: clone(application.candidateAssessment ?? null),
  };
  const depth = "standard";
  const questions = profileQuestions.length > 0
    ? profileQuestions
    : contextualAiInterviewQuestions(vacancy, application, coach, depth);
  const interview = normalizeInterview({
    id: deterministicId("coach-interview", id),
    applicationId: application.id,
    vacancyId: vacancy.id,
    coachId: coach.id,
    clubId: vacancy.clubId,
    status: "pending",
    scheduledAt: now,
    expiresAt: addDays(now, Math.max(3, config.interviewDelayDays + 3)),
    mode: coach.managerType === "human" ? "generative" : "fallback",
    source: coach.managerType === "human" ? null : "fallback",
    depth,
    contextSnapshot,
    contextHash: hashText(JSON.stringify(contextSnapshot)).toString(36),
    questions,
    operationId: id,
  });
  state.interviews.push(interview);
  application.status = "interview";
  application.updatedAt = now;
  appendDecision(application, {
    action: "interview_scheduled",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: "shortlisted",
    newStatus: application.status,
    justification: "Entrevista incluida no processo seletivo",
  }, now, id);
  events.push(eventRecord("COACH_INTERVIEW_SCHEDULED", id, now, {
    coachId: coach.id,
    clubId: vacancy.clubId,
    vacancyId: vacancy.id,
    metadata: { applicationId: application.id, interviewId: interview.id },
  }));
  processed.push(id);
  return interview;
}

function createAiMarketProposalMutable(room, state, vacancy, application, coach, interview, now, config, events, processed) {
  const existing = proposalForApplication(state, application.id);
  if (existing) return existing;
  const id = `coach-ai-offer:${vacancy.id}:${coach.id}`;
  if (hasProcessed(state, id)) return null;
  const careerSignals = careerHistoryMarketSignals(room, state, coach, now);
  const baseWage = coachOfferWage(room, coach, vacancy.clubId, vacancy.desiredProfile, state, now);
  const wageVariation = ((hashText(`${id}|wage`) % 11) - 4) / 100;
  const salaryRange = vacancy.desiredProfile?.salary ?? {};
  const interviewEffects = normalizeInterviewNegotiationEffects(interview?.negotiationEffects);
  const wage = Math.round(clamp(
    baseWage * (1 + wageVariation) * (interviewEffects?.salaryMultiplier ?? 1),
    integer(salaryRange.minimum, 1_000, 1_000, MAX_MONEY),
    integer(salaryRange.maximum, MAX_MONEY, 1_000, MAX_MONEY),
  ) / 1_000) * 1_000;
  const currentContract = activeContractForCoach(state, coach.id);
  const timing = marketProposalTiming(state, coach, now, config);
  const durationYears = integer(
    2
      + (hashText(`${id}|duration`) % 2)
      + (interviewEffects?.durationYearsDelta ?? 0)
      + careerSignals.durationDelta,
    2,
    1,
    5,
  );
  const signingBonus = Math.round((
    wage
      * (1 + (hashText(`${id}|bonus`) % 3))
      * (interviewEffects?.signingBonusMultiplier ?? 1)
  ) / 1_000) * 1_000;
  const availableBudget = availableClubFunds(room, vacancy.clubId);
  const profileTransferBudget = vacancy.desiredProfile?.availableBudget;
  const transferBudget = profileTransferBudget == null
    ? null
    : integer(
      finite(profileTransferBudget) * (interviewEffects?.transferBudgetMultiplier ?? 1),
      0,
      0,
      availableBudget == null ? MAX_MONEY : Math.min(MAX_MONEY, availableBudget),
    );
  const proposal = normalizeProposal({
    id: deterministicId("coach-proposal", id),
    coachId: coach.id,
    clubId: vacancy.clubId,
    vacancyId: vacancy.id,
    applicationId: application.id,
    interviewId: interview?.id,
    kind: timing.kind,
    wage,
    durationYears,
    terminationClause: integer(
      wage * (6 + (hashText(`${id}|clause`) % 7)) * (interviewEffects?.terminationClauseMultiplier ?? 1),
      wage * 6,
      0,
      Math.min(MAX_MONEY, wage * 24),
    ),
    signingBonus,
    compensation: timing.compensation,
    bonuses: {
      title: Math.round((wage * 2) / 1_000) * 1_000,
      objective: Math.round(wage / 1_000) * 1_000,
      ...(interviewEffects ? {
        performance: Math.round((wage * interviewEffects.performanceBonusMultiplier) / 1_000) * 1_000,
      } : {}),
    },
    transferBudget,
    objectives: [
      ...(vacancy.desiredProfile?.objectives ?? []),
      ...(interviewEffects?.objectives ?? []),
    ],
    specialClauses: interviewEffects?.specialClauses ?? [],
    interviewEvaluation: clone(interview?.evaluation ?? null),
    interviewRelationshipImpact: clone(interview?.relationshipImpact ?? null),
    interviewNegotiationEffects: clone(interviewEffects),
    interviewCompatibility: interview?.compatibilityScore ?? null,
    autonomyDelta: interviewEffects?.autonomyDelta ?? 0,
    priorityDelta: interviewEffects?.priorityDelta ?? 0,
    objectiveDifficultyDelta: interviewEffects?.objectiveDifficultyDelta ?? 0,
    status: "pending",
    marketStage: "coach_review",
    createdAt: now,
    updatedAt: now,
    lastActionAt: now,
    nextActionAt: addDays(now, config.coachResponseDelayDays),
    expiresAt: addDays(now, config.proposalValidityDays),
    plannedStartDate: timing.plannedStartDate,
    maxNegotiationRounds: config.maxNegotiationRounds,
    availableBudget,
    boardExpectation: identifier(vacancy.desiredProfile?.expectation) || "Cumprir objetivos esportivos e financeiros",
    clubSituation: identifier(vacancy.reason) || "Vaga aberta",
    message: "Proposta formal criada apos analise do perfil do treinador.",
    careerRisk: careerSignals.risk,
    careerHistoryAssessment: {
      performance: careerSignals.performance,
      reliability: careerSignals.reliability,
      reputationTrend: careerSignals.reputationTrend,
      risk: careerSignals.risk,
      evidence: {
        matches: careerSignals.matches,
        titles: careerSignals.titles,
        completedContracts: careerSignals.completedContracts,
        resignations: careerSignals.resignations,
        dismissals: careerSignals.dismissals,
      },
    },
    operationId: id,
  });
  appendDecision(proposal, {
    action: "offer_submitted",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: null,
    newStatus: proposal.status,
    justification: interview ? "Proposta enviada apos entrevista" : "Proposta enviada apos analise da lista de candidatos",
    negotiatedValues: proposalTerms(proposal),
  }, now, `${id}:offer`);
  state.proposals.push(proposal);
  application.status = "offered";
  application.updatedAt = now;
  appendDecision(application, {
    action: "offer_submitted",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: interview ? "interview_completed" : "shortlisted",
    newStatus: application.status,
    justification: "Candidato avancou para negociacao contratual",
  }, now, `${id}:application`);
  if (!coach.currentClubId) coach.status = "negotiating";
  events.push(eventRecord("COACH_PROPOSAL_CREATED", id, now, {
    coachId: coach.id,
    clubId: vacancy.clubId,
    relatedClubId: coach.currentClubId,
    proposalId: proposal.id,
    vacancyId: vacancy.id,
    metadata: {
      source: "dynamic_ai_coach_market",
      applicationId: application.id,
      interviewId: interview?.id ?? null,
      expiresAt: proposal.expiresAt,
    },
  }));
  processed.push(id);
  return proposal;
}

function deterministicAiInterviewAnswer(question, coach) {
  const formation = identifier(coach.preferredFormation) || "uma estrutura adaptavel";
  const style = identifier(coach.style ?? coach.playingStyle) || "equilibrio entre os momentos do jogo";
  const answersByTopic = {
    objectives: `Vou transformar as metas em etapas mensuraveis, cobrando evolucao sem abandonar o projeto de longo prazo.`,
    youth: `Jovens terao minutos por merito, plano individual e apoio de atletas experientes.`,
    finance: `Trabalharei dentro do orcamento, priorizando reforcos que resolvam necessidades reais do elenco.`,
    tactics: `Partirei do ${formation}, com ${style}, mas ajustarei o plano aos jogadores e ao adversario.`,
    leadership: `Definirei regras claras, conversa direta e responsabilidade compartilhada no vestiario.`,
    pressure: `Assumo a pressao como parte do cargo e protejo o elenco sem fugir da responsabilidade.`,
  };
  return answersByTopic[identifier(question?.topic).toLocaleLowerCase("en-US")]
    ?? `Quero entender o contexto, alinhar expectativas com a diretoria e executar um plano coerente com o elenco.`;
}

function resolveAiInterviewsMutable(room, state, now, config, events, processed) {
  for (const interview of state.interviews) {
    if (interview.status !== "pending") continue;
    const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === interview.coachId);
    if (!coach || coach.managerType === "human") continue;
    const dueAt = addDays(interview.scheduledAt ?? now, config.interviewDelayDays);
    if (new Date(dueAt).getTime() > new Date(now).getTime()) continue;
    const id = `coach-ai-interview-response:${interview.id}`;
    if (hasProcessed(state, id)) continue;
    const vacancy = state.vacancies.find((candidate) => candidate.id === interview.vacancyId);
    const application = state.applications.find((candidate) => candidate.id === interview.applicationId);
    const assessment = application?.candidateAssessment
      ?? (vacancy ? coachMarketAssessment(room, state, coach, vacancy, now, config) : null);
    const selectionScore = finite(assessment?.score, 50);
    const communicationScore = clamp(
      normalizeCoachReputation100(
        coach.communication ?? coach.motivation ?? coach.mentality,
        55,
      )
        + ((hashText(`${id}|compatibility`) % 7) - 3),
      0,
      100,
    );
    interview.compatibilityScore = Math.round(clamp(
      (selectionScore * 0.7) + (communicationScore * 0.3),
      0,
      100,
    ));
    interview.selectionScore = selectionScore;
    interview.answerCompatibilityScore = communicationScore;
    interview.mode = "fallback";
    interview.source = "fallback";
    interview.model = null;
    interview.answers = interview.questions.map((question) => ({
      questionId: question.id,
      text: deterministicAiInterviewAnswer(question, coach),
      source: "ai_coach_profile",
    }));
    interview.transcript = interview.questions.flatMap((question, index) => {
      const turn = index + 1;
      const questionMessageId = deterministicId("coach-interview-message", `${id}|${question.id}|board`);
      return [{
        id: questionMessageId,
        role: "board",
        text: question.prompt,
        topic: question.topic,
        questionId: null,
        createdAt: now,
        turn,
        analysis: null,
        operationId: id,
      }, {
        id: deterministicId("coach-interview-message", `${id}|${question.id}|coach`),
        role: "coach",
        text: deterministicAiInterviewAnswer(question, coach),
        topic: question.topic,
        questionId: questionMessageId,
        createdAt: now,
        turn,
        analysis: null,
        operationId: id,
      }];
    }).slice(-80);
    interview.turnCount = interview.questions.length;
    interview.currentQuestionId = null;
    interview.revision += 1;
    interview.cumulativeMetrics = normalizeInterviewMetrics({
      boardConfidence: interview.compatibilityScore,
      clubCompatibility: selectionScore,
      squadCompatibility: finite(assessment?.factors?.find((factor) => factor.code === "squadCompatibility")?.rawScore, selectionScore),
      leadership: communicationScore,
      tacticalVision: normalizeCoachReputation100(coach.tacticalKnowledge ?? coach.tactics, communicationScore),
      financialAlignment: finite(assessment?.factors?.find((factor) => factor.code === "salary")?.rawScore, selectionScore),
      longTermPotential: normalizeCoachReputation100(coach.potential ?? coach.reputation, selectionScore),
      culturalFit: finite(assessment?.factors?.find((factor) => factor.code === "countryKnowledge")?.rawScore, selectionScore),
      credibility: normalizeCoachReputation100(coach.professionalTrust ?? coach.reputation, communicationScore),
      perceivedRisk: 100 - interview.compatibilityScore,
    }, interview.compatibilityScore);
    interview.evaluation = normalizeInterviewEvaluation({
      overallScore: interview.compatibilityScore,
      metrics: interview.cumulativeMetrics,
      strengths: interview.compatibilityScore >= 70 ? ["Perfil coerente com o projeto", "Comunicacao segura"] : [],
      risks: interview.compatibilityScore < 55 ? ["Compatibilidade abaixo do esperado pela diretoria"] : [],
      recommendation: interview.compatibilityScore >= 70
        ? "hire"
        : interview.compatibilityScore >= 45 ? "hire_with_reservations" : "reject",
      summary: `Entrevista simulada pelo perfil do treinador: ${interview.compatibilityScore}/100.`,
      generatedAt: now,
    }, now, interview.compatibilityScore);
    interview.relationshipImpact = normalizeInterviewRelationshipImpact({
      boardConfidenceDelta: clamp((interview.compatibilityScore - 50) * 0.12, -8, 8),
      credibilityDelta: clamp((communicationScore - 50) * 0.08, -5, 5),
      strategicAlignmentDelta: clamp((selectionScore - 50) * 0.08, -5, 5),
      culturalCompatibilityDelta: 0,
      perceivedRiskDelta: clamp((50 - interview.compatibilityScore) * 0.08, -5, 5),
      expectedTenureDelta: interview.compatibilityScore >= 70 ? 3 : 0,
    });
    interview.negotiationEffects = normalizeInterviewNegotiationEffects({
      salaryMultiplier: 1 + clamp((interview.compatibilityScore - 60) / 500, -0.08, 0.08),
      durationYearsDelta: interview.compatibilityScore >= 78 ? 1 : 0,
      signingBonusMultiplier: interview.compatibilityScore >= 72 ? 1.15 : 1,
      performanceBonusMultiplier: 1,
      terminationClauseMultiplier: 1,
      transferBudgetMultiplier: interview.compatibilityScore >= 75 ? 1.05 : 1,
      autonomyDelta: clamp((interview.compatibilityScore - 55) / 5, -8, 8),
      priorityDelta: clamp((interview.compatibilityScore - 60) / 4, -12, 12),
      objectiveDifficultyDelta: clamp((interview.compatibilityScore - 60) / 6, -8, 8),
      terminateNegotiation: interview.compatibilityScore < 45,
    });
    if (application && interview.negotiationEffects?.priorityDelta) {
      application.interestScore = Math.round(clamp(
        finite(application.interestScore, selectionScore) + interview.negotiationEffects.priorityDelta,
        0,
        100,
      ) * 10) / 10;
      application.shortlistScore = Math.round(clamp(
        finite(application.shortlistScore, selectionScore) + interview.negotiationEffects.priorityDelta,
        0,
        100,
      ) * 10) / 10;
    }
    interview.memorySummary = interview.evaluation.summary;
    interview.completedAt = now;
    interview.status = interview.compatibilityScore >= 45 ? "accepted" : "rejected";
    applyInterviewRelationshipMutable(coach, interview, now, id);
    appendDecision(interview, {
      action: interview.status === "accepted" ? "interview_passed" : "interview_failed",
      responsibleId: vacancy?.clubId ?? interview.clubId,
      responsibleRole: "board",
      previousStatus: "pending",
      newStatus: interview.status,
      justification: `Compatibilidade ${interview.compatibilityScore}/100`,
      negotiatedValues: { compatibilityScore: interview.compatibilityScore },
    }, now, id);
    if (application) {
      application.status = interview.status === "accepted" ? "interview_completed" : "rejected";
      application.updatedAt = now;
      application.responseReason = interview.status === "accepted" ? "interview_passed" : "interview_incompatible";
    }
    events.push(eventRecord("COACH_INTERVIEW_COMPLETED", id, now, {
      coachId: interview.coachId,
      clubId: interview.clubId,
      vacancyId: interview.vacancyId,
      metadata: { interviewId: interview.id, compatibilityScore: interview.compatibilityScore, outcome: interview.status },
    }));
    processed.push(id);
  }
}

function progressOpenCoachVacancy(room, state, vacancy, now, options, events, processed) {
  if (vacancy.status !== "open") return;
  const config = coachMarketConfig(state, options);
  if (vacancy.closesAt && new Date(vacancy.closesAt).getTime() <= new Date(now).getTime()) {
    const previousDeadline = vacancy.closesAt;
    const id = `coach-vacancy-search-extended:${vacancy.id}:${previousDeadline}`;
    vacancy.closesAt = addDays(now, Math.max(7, config.proposalValidityDays));
    vacancy.lastMarketActionAt = now;
    appendDecision(vacancy, {
      action: "search_deadline_extended",
      responsibleId: vacancy.clubId,
      responsibleRole: "board",
      previousStatus: vacancy.status,
      newStatus: vacancy.status,
      justification: "Busca continua porque nenhum acordo foi concluido",
      negotiatedValues: { previousDeadline, deadline: vacancy.closesAt },
    }, now, id);
    events.push(eventRecord("COACH_VACANCY_SEARCH_EXTENDED", id, now, {
      clubId: vacancy.clubId,
      vacancyId: vacancy.id,
      metadata: { previousDeadline, deadline: vacancy.closesAt },
    }));
    processed.push(id);
  }
  createDeterministicHumanInvitation(room, state, vacancy, now, events, processed);
  if (vacancyAgeDays(vacancy, now) < config.searchDelayDays) return;

  let applications = state.applications.filter((application) => application.vacancyId === vacancy.id);
  const activeApplicationExists = applications.some((application) => (
    ["shortlisted", "interview", "interview_completed", "offered", "accepted"].includes(application.status)
  ));
  const activeOfferExists = state.proposals.some((proposal) => (
    proposal.vacancyId === vacancy.id && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  ));
  const submittedApplications = applications.filter((application) => application.status === "submitted");
  if ((!activeApplicationExists && !activeOfferExists) || submittedApplications.length > 0) {
    const submittedByCoach = new Map(submittedApplications.map((application) => [application.coachId, application]));
    const existingByCoach = new Map(applications.map((application) => [application.coachId, application]));
    const previouslyConsidered = new Set(applications
      .filter((application) => application.status !== "submitted")
      .map((application) => application.coachId));
    const discoverAiCandidates = !activeApplicationExists && !activeOfferExists;
    const aiCandidates = discoverAiCandidates
      ? (room.coachCareerState?.coaches ?? [])
        .filter((coach) => (
          coach.managerType !== "human"
          && coach.status !== "retired"
          && !coach.id.startsWith("interim-coach:")
          && !previouslyConsidered.has(coach.id)
          && !submittedByCoach.has(coach.id)
          && coachEligibleForVacancy(room, state, coach, vacancy, now, config)
        ))
      : [];
    const submittedCandidates = submittedApplications.flatMap((application) => {
      const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === application.coachId);
      return coach ? [coach] : [];
    });
    const activeCandidates = applications
      .filter((application) => (
        application.status !== "submitted"
          && ["shortlisted", "interview", "interview_completed", "offered", "accepted"].includes(application.status)
      ))
      .flatMap((application) => {
        const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === application.coachId);
        return coach ? [coach] : [];
      });
    const assessedCandidates = [...new Map([...activeCandidates, ...submittedCandidates, ...aiCandidates]
      .map((coach) => [coach.id, coach])).values()]
      .map((coach) => ({
        coach,
        assessment: coachMarketAssessment(room, state, coach, vacancy, now, config),
      }))
      .sort((left, right) => right.assessment.score - left.assessment.score
        || left.coach.id.localeCompare(right.coach.id, "pt-BR"));
    const candidates = assessedCandidates
      .filter(({ assessment }) => (
        assessment.eligible && assessment.score >= config.minimumCandidateScore
      ))
      .slice(0, config.shortlistSize);
    const selectedCoachIds = new Set(candidates.map(({ coach }) => coach.id));

    for (const application of submittedApplications) {
      const candidate = assessedCandidates.find(({ coach }) => coach.id === application.coachId);
      if (candidate) {
        application.candidateAssessment = clone(candidate.assessment);
        application.interestScore = candidate.assessment.score;
        application.shortlistScore = candidate.assessment.score;
      }
      if (selectedCoachIds.has(application.coachId)) continue;
      const previousStatus = application.status;
      application.status = "rejected";
      application.updatedAt = now;
      application.closedAt = now;
      application.closedReason = candidate?.assessment?.eligible === false
        ? "mandatory_requirements_not_met"
        : "lower_ranked_candidate";
      application.responseReason = application.closedReason;
      appendDecision(application, {
        action: "candidate_not_shortlisted",
        responsibleId: vacancy.clubId,
        responsibleRole: "board",
        previousStatus,
        newStatus: application.status,
        justification: candidate?.assessment?.eligible === false
          ? `Requisitos obrigatorios nao atendidos: ${candidate.assessment.hardBlockers
              .map((blocker) => identifier(blocker?.label ?? blocker?.code ?? blocker))
              .filter(Boolean)
              .join(", ")}`
          : "Outros candidatos apresentaram maior compatibilidade com a vaga",
        negotiatedValues: {
          score: candidate?.assessment?.score ?? 0,
          hardBlockers: candidate?.assessment?.hardBlockers ?? [],
        },
      }, now, `coach-selection-rejected:${vacancy.id}:${application.coachId}:${now}`);
    }

    for (const { coach, assessment } of candidates) {
      const existingApplication = existingByCoach.get(coach.id);
      if (existingApplication && existingApplication.status !== "submitted") continue;
      const id = `coach-ai-shortlist:${vacancy.id}:${coach.id}`;
      const application = submittedByCoach.get(coach.id) ?? normalizeApplication({
          id: deterministicId("coach-application", `${vacancy.id}|${coach.id}`),
          vacancyId: vacancy.id,
          clubId: vacancy.clubId,
          coachId: coach.id,
          status: "submitted",
          submittedAt: now,
          updatedAt: now,
          operationId: id,
        });
      const previousStatus = application.status;
      application.status = "shortlisted";
      application.updatedAt = now;
      application.interestScore = assessment.score;
      application.shortlistScore = assessment.score;
      application.candidateAssessment = clone(assessment);
      if (!submittedByCoach.has(coach.id)) state.applications.push(application);
      appendDecision(application, {
        action: "candidate_shortlisted",
        responsibleId: vacancy.clubId,
        responsibleRole: "board",
        previousStatus,
        newStatus: application.status,
        justification: `Compatibilidade ponderada ${assessment.score}/100`,
        negotiatedValues: {
          score: assessment.score,
          profileVersion: assessment.profileVersion,
          factors: assessment.factors.map((factor) => ({
            code: factor.code,
            weightedScore: factor.weightedScore,
          })),
        },
      }, now, id);
      vacancy.shortlistCoachIds = [...new Set([...vacancy.shortlistCoachIds, coach.id])].slice(0, 20);
      events.push(eventRecord("COACH_CANDIDATE_SHORTLISTED", id, now, {
        coachId: coach.id,
        clubId: vacancy.clubId,
        vacancyId: vacancy.id,
        metadata: {
          applicationId: application.id,
          shortlistScore: assessment.score,
          profileVersion: assessment.profileVersion,
          factorCodes: assessment.factors.map((factor) => factor.code),
        },
      }));
      processed.push(id);
    }
    vacancy.searchStartedAt = vacancy.searchStartedAt ?? now;
    vacancy.lastMarketActionAt = now;
    vacancy.marketStage = candidates.length ? "interest" : "closed";
    applications = state.applications.filter((application) => application.vacancyId === vacancy.id);
  }

  const activeOffers = () => state.proposals.filter((proposal) => (
    proposal.vacancyId === vacancy.id && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  )).length;
  for (const application of [...applications]
    .sort((left, right) => right.shortlistScore - left.shortlistScore || left.id.localeCompare(right.id, "pt-BR"))) {
    if (activeOffers() >= config.simultaneousOffersPerVacancy) break;
    if (!["shortlisted", "interview_completed"].includes(application.status)) continue;
    const coach = coachById(room, application.coachId);
    const interview = interviewForApplication(state, application.id);
    if (application.status === "shortlisted" && !interview) {
      const interviewRoll = hashText(`${vacancy.id}|${coach.id}|interview`) % 100;
      if (interviewRoll < config.interviewChance) {
        createAiInterviewMutable(state, vacancy, application, coach, now, config, events, processed);
        vacancy.marketStage = "interview";
        vacancy.lastMarketActionAt = now;
        continue;
      }
    }
    if (interview && interview.status !== "accepted") continue;
    createAiMarketProposalMutable(room, state, vacancy, application, coach, interview, now, config, events, processed);
    vacancy.marketStage = "coach_review";
    vacancy.lastMarketActionAt = now;
  }
}

function activeTenureEvaluations(state, appointment) {
  const startedAt = new Date(appointment.startedAt ?? appointment.appointedAt ?? 0).getTime();
  const uniqueRounds = new Map();
  for (const evaluation of state.evaluations) {
    if (evaluation.coachId !== appointment.coachId
      || clubKey(evaluation.clubId) !== clubKey(appointment.clubId)
      || evaluation.minimumGamesMet !== true) continue;
    const evaluatedAt = new Date(evaluation.evaluatedAt ?? 0).getTime();
    if (Number.isFinite(startedAt) && evaluatedAt < startedAt) continue;
    uniqueRounds.set(`${evaluation.seasonNumber}:${evaluation.round}`, evaluation);
  }
  return [...uniqueRounds.values()].sort((left, right) => (
    String(left.evaluatedAt ?? "").localeCompare(String(right.evaluatedAt ?? ""))
      || left.id.localeCompare(right.id, "pt-BR")
  ));
}

function averageEvaluationScore(evaluations) {
  if (!evaluations.length) return 0;
  return evaluations.reduce((total, evaluation) => total + finite(evaluation.score, 0), 0) / evaluations.length;
}

function aiRenewalDecision(room, state, coach, appointment, contract, now, options) {
  if (coach.id.startsWith("interim-coach:")) return null;
  if (appointment.role !== "head_coach" || contract.role !== "head_coach" || !contract.endDate) return null;
  const remainingDays = Math.ceil((new Date(contract.endDate).getTime() - new Date(now).getTime()) / DAY_MS);
  const config = coachMarketConfig(state, options);
  const renewalWindowDays = config.renewalWindowDays;
  if (remainingDays <= 0 || remainingDays > renewalWindowDays) return null;
  if (state.proposals.some((proposal) => (
    proposal.kind === "renewal"
      && proposal.sourceContractId === contract.id
      && !["rejected", "expired", "withdrawn", "encerrado_vaga_preenchida"].includes(proposal.status)
  ))) return null;

  const evaluations = activeTenureEvaluations(state, appointment).slice(-2);
  const minimumScore = config.renewalMinimumScore;
  const latest = evaluations.at(-1);
  const averageScore = averageEvaluationScore(evaluations);
  const enoughEvidence = evaluations.length >= 2
    ? averageScore >= minimumScore
    : evaluations.length === 1 && latest.score >= minimumScore + 10;
  if (!latest || latest.recommendation !== "retain" || latest.score < minimumScore || !enoughEvidence) return null;

  const reserveMonths = integer(options.aiRenewalReserveMonths, 3, 0, 12);
  const available = availableClubFunds(room, appointment.clubId);
  if (available != null && available < contract.wage * reserveMonths) return null;
  return {
    averageScore,
    evidenceEvaluationIds: evaluations.map((evaluation) => evaluation.id),
    durationYears: averageScore >= 75 ? 2 : 1,
    wageIncreaseRate: averageScore >= 80 ? 0.08 : 0.05,
  };
}

function processAiContractRenewals(room, state, now, options, events, processed) {
  if (options.autoRenewAI === false) return;
  for (const appointment of state.appointments.filter((candidate) => (
    candidate.status === "active" && candidate.role === "head_coach"
  ))) {
    const coach = coachById(room, appointment.coachId);
    const previous = activeContractForCoach(state, coach.id);
    if (!previous) continue;
    const decision = aiRenewalDecision(room, state, coach, appointment, previous, now, options);
    if (!decision) continue;
    const id = `coach-ai-renewal-offer:${previous.id}`;
    if (hasProcessed(state, id)) continue;
    const wage = Math.max(1_000, Math.round((previous.wage * (1 + decision.wageIncreaseRate)) / 1_000) * 1_000);
    const config = coachMarketConfig(state, options);
    const proposal = normalizeProposal({
      id: deterministicId("coach-proposal", id),
      coachId: coach.id,
      clubId: appointment.clubId,
      kind: "renewal",
      sourceContractId: previous.id,
      wage,
      durationYears: decision.durationYears,
      terminationClause: Math.max(previous.terminationClause, wage * 6),
      bonuses: previous.bonuses,
      objectives: previous.objectives,
      status: "pending",
      marketStage: "coach_review",
      createdAt: now,
      updatedAt: now,
      lastActionAt: now,
      nextActionAt: addDays(now, config.coachResponseDelayDays),
      expiresAt: addDays(now, config.proposalValidityDays),
      plannedStartDate: now,
      maxNegotiationRounds: config.maxNegotiationRounds,
      availableBudget: availableClubFunds(room, appointment.clubId),
      boardExpectation: "Continuidade do trabalho e cumprimento dos objetivos",
      clubSituation: "Renovacao antes do fim do contrato",
      message: "O clube deseja renovar o vinculo.",
      operationId: id,
    });
    appendDecision(proposal, {
      action: "renewal_offer_submitted",
      responsibleId: appointment.clubId,
      responsibleRole: "board",
      previousStatus: null,
      newStatus: proposal.status,
      justification: "Renovacao proposta com base em desempenho persistido",
      negotiatedValues: proposalTerms(proposal),
      conditions: decision.evidenceEvaluationIds,
    }, now, `${id}:offer`);
    state.proposals.push(proposal);
    events.push(eventRecord("COACH_RENEWAL_NEGOTIATION_OPENED", id, now, {
      coachId: coach.id,
      clubId: appointment.clubId,
      contractId: previous.id,
      proposalId: proposal.id,
      metadata: {
        source: "dynamic_ai_coach_market",
        wage: proposal.wage,
        durationYears: proposal.durationYears,
        averageScore: Math.round(decision.averageScore),
        evidenceEvaluationIds: decision.evidenceEvaluationIds,
      },
    }));
    processed.push(id);
  }
}

function coachProposalDecision(room, state, coach, proposal, now = state.currentDate) {
  const clubs = catalogClubs(room);
  const targetClub = clubs.get(clubKey(proposal.clubId)) ?? {};
  const currentClub = coach.currentClubId ? clubs.get(clubKey(coach.currentClubId)) ?? {} : {};
  const careerSignals = careerHistoryMarketSignals(room, state, coach, now);
  const targetReputation = normalizeCoachReputation100(targetClub.reputation, 45);
  const currentReputation = coach.currentClubId
    ? normalizeCoachReputation100(currentClub.reputation, 45)
    : 35;
  const currentContract = activeContractForCoach(state, coach.id);
  const expectedWage = proposal.kind === "renewal"
    ? Math.max(
      1_000,
      finite(coach.expectedSalary, 0),
      finite(currentContract?.wage, 0),
    )
    : Math.max(
      1_000,
      finite(coach.expectedSalary, 0),
      finite(currentContract?.wage, 0),
      coachOfferWage(
        room,
        coach,
        proposal.clubId,
        state.vacancies.find((vacancy) => vacancy.id === proposal.vacancyId)?.desiredProfile,
        state,
        now,
      ),
    );
  const available = availableClubFunds(room, proposal.clubId);
  const latest = latestCoachEvaluation(state, coach.id);
  const targetLeague = leagueForClub(room, proposal.clubId);
  const sourceLeague = coach.currentClubId ? leagueForClub(room, coach.currentClubId) : null;
  const targetCountry = identifier(targetClub.country ?? targetLeague?.country);
  const coachCountry = identifier(coach.nationality ?? coach.country);
  const factors = [];
  const add = (code, label, value, detail = null) => factors.push({
    id: code,
    code,
    label,
    value: Math.round(value * 10) / 10,
    detail,
  });

  const variableBonuses = Object.values(proposal.bonuses ?? {}).reduce((total, value) => total + Math.max(0, finite(value, 0)), 0);
  const monthlyBonusValue = (proposal.signingBonus + variableBonuses) / Math.max(12, proposal.durationYears * 12);
  const salaryRatio = (proposal.wage + monthlyBonusValue) / expectedWage;
  add("salary", "Salario e bonus", clamp((salaryRatio - 1) * 48, -22, 22), `${Math.round(salaryRatio * 100)}% da expectativa`);
  add("club_reputation", "Reputacao do clube", clamp((targetReputation - currentReputation) * 0.38, -18, 20));
  const targetTier = finite(targetLeague?.divisionOrder ?? targetLeague?.tier ?? targetLeague?.level, 1);
  const sourceTier = finite(sourceLeague?.divisionOrder ?? sourceLeague?.tier ?? sourceLeague?.level, targetTier);
  add("division", "Nivel da divisao", clamp((sourceTier - targetTier) * 4, -8, 8));
  const squadStrength = normalizeCoachReputation100(
    targetClub.squadStrength ?? targetClub.overall ?? targetClub.reputation,
    targetReputation,
  );
  add("squad", "Qualidade do elenco", clamp((squadStrength - 50) * 0.12, -7, 8));
  const financeImpact = available == null
    ? 0
    : available >= proposal.wage * 24 ? 6 : available >= proposal.wage * 12 ? 2 : -10;
  add("financial_stability", "Estabilidade financeira", financeImpact, available == null ? "Nao divulgada" : `${Math.round(available / Math.max(1, proposal.wage))} salarios em caixa`);
  if (proposal.transferBudget != null) {
    const budgetRatio = available == null ? 1 : proposal.transferBudget / Math.max(1, available);
    add("transfer_budget", "Orcamento para transferencias", budgetRatio >= 0.35 ? 5 : budgetRatio >= 0.15 ? 2 : -4);
  }
  add("title_chance", "Chance de titulos", clamp((targetReputation - 55) * 0.1, -5, 6));
  const projectImpact = clamp((proposal.durationYears - 2) * 2, -2, 6) + Math.min(4, proposal.objectives.length);
  add("long_term_project", "Projeto de longo prazo", projectImpact);
  add("location", "Localizacao", coachCountry && targetCountry
    ? (clubKey(coachCountry) === clubKey(targetCountry) ? 4 : -2)
    : 0);
  const ambition = clamp(
    finite(coach.ambition, normalizeCoachReputation100(coach.reputation, 50)),
    0,
    100,
  );
  add("ambition", "Ambicao profissional", clamp((targetReputation - ambition) * 0.12, -7, 7));
  const formerSpell = (
    careerSignals.history?.spells
      ?? careerSignals.history?.assignments
      ?? []
  ).find((spell) => (
    clubKey(spell?.clubId ?? spell?.club?.id) === clubKey(proposal.clubId) && spell?.exitReason
  ));
  const formerExitReason = identifier(formerSpell?.exitReason);
  const relationshipImpact = !formerSpell
    ? 1
    : ["contract_expired", "contract_completed", "natural_end"].includes(formerExitReason)
      ? 4
      : ["coach_resignation", "resigned", "voluntary_resignation"].includes(formerExitReason)
        ? -10
        : formerExitReason.includes("dismiss") || formerExitReason.includes("replaced")
          ? -5
          : -2;
  add(
    "relationship",
    "Relacionamento anterior",
    relationshipImpact,
    formerSpell ? `Ultima saida: ${formerExitReason || "nao informada"}` : "Sem passagem anterior",
  );
  add(
    "career_performance",
    "Desempenho da carreira",
    clamp(careerSignals.performance * 0.55, -5, 8),
    `${careerSignals.matches} jogo(s); ${careerSignals.titles} titulo(s)`,
  );
  add(
    "career_reliability",
    "Estabilidade profissional",
    clamp(careerSignals.reliability * 0.6, -8, 6),
    `Risco profissional ${careerSignals.risk}/100`,
  );
  add(
    "reputation_trend",
    "Evolucao da reputacao",
    clamp(careerSignals.reputationTrend * 0.2, -4, 4),
  );
  if (proposal.interviewCompatibility != null) {
    add("interview", "Compatibilidade na entrevista", clamp((proposal.interviewCompatibility - 50) * 0.22, -11, 11));
  }
  if (proposal.kind === "renewal") {
    const continuity = latest?.minimumGamesMet
      ? clamp((latest.score - 50) * 0.25, -12, 12)
      : 1;
    add("continuity", "Continuidade e resultados", continuity);
    const morale = (room?.clubMoraleStates ?? []).find((entry) => clubKey(entry?.clubId) === clubKey(proposal.clubId));
    if (Number.isFinite(Number(morale?.score))) {
      add("internal_environment", "Ambiente interno", clamp((Number(morale.score) - 50) * 0.12, -7, 7));
    }
    const satisfaction = Number(coach.satisfaction ?? coach.boardConfidence ?? coach.boardRelationship);
    if (Number.isFinite(satisfaction)) {
      add("coach_satisfaction", "Satisfacao com o projeto", clamp((satisfaction - 50) * 0.16, -9, 8));
    }
    const breachedPromises = state.guarantees.filter((guarantee) => (
      guarantee.coachId === coach.id
        && clubKey(guarantee.clubId) === clubKey(proposal.clubId)
        && ["overdue", "breached"].includes(guarantee.status)
    )).length;
    if (breachedPromises > 0) add("broken_promises", "Promessas pendentes", -Math.min(18, breachedPromises * 6));
    const competingCount = state.proposals.filter((candidate) => (
      candidate.coachId === coach.id
        && candidate.id !== proposal.id
        && ACTIVE_PROPOSAL_STATUSES.has(candidate.status)
    )).length;
    if (competingCount > 0) add("external_interest", "Ofertas externas", -Math.min(8, competingCount * 3));
  } else if (coach.currentClubId && latest?.minimumGamesMet && latest.score >= 70) {
    add("current_stability", "Estabilidade no clube atual", -7);
  }
  const score = Math.round(clamp(50 + factors.reduce((total, factor) => total + factor.value, 0), 0, 100));
  return { score, factors, expectedWage };
}

function rejectAiCoachProposalMutable(room, state, proposal, coach, now, operationIdValue, reason, assessment, events, outcome = "rejected") {
  const previousStatus = proposal.status;
  proposal.status = outcome === "withdrawn" ? "withdrawn" : "rejected";
  proposal.marketStage = "closed";
  proposal.respondedAt = now;
  proposal.updatedAt = now;
  proposal.lastActionAt = now;
  proposal.nextActionAt = null;
  proposal.responseReason = reason;
  proposal.decisionReason = reason;
  proposal.decisionScore = assessment.score;
  proposal.decisionFactors = assessment.factors;
  appendDecision(proposal, {
    action: proposal.status === "withdrawn" ? "withdraw" : "reject",
    responsibleId: coach.id,
    responsibleRole: "candidate",
    previousStatus,
    newStatus: proposal.status,
    justification: reason,
    negotiatedValues: proposalTerms(proposal),
  }, now, operationIdValue);
  closeProposalSelectionMutable(state, proposal, proposal.status, reason, now, operationIdValue);
  refreshCoachMarketStatus(state, coach);
  events.push(eventRecord(proposal.status === "withdrawn" ? "COACH_PROPOSAL_WITHDRAWN" : "COACH_PROPOSAL_REJECTED", operationIdValue, now, {
    coachId: coach.id,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    vacancyId: proposal.vacancyId,
    metadata: { reason, decisionScore: assessment.score, source: "dynamic_ai_coach_market" },
  }));
}

function counterAiCoachProposalMutable(room, state, proposal, coach, now, operationIdValue, assessment, config, events) {
  const previousStatus = proposal.status;
  const concessionRate = clamp(proposal.negotiationRound * 0.025, 0, 0.12);
  const expected = Math.max(proposal.wage * 1.02, assessment.expectedWage * (1 - concessionRate));
  const staffDemand = registerRequiredStaffPackageGuarantee(
    room,
    state,
    proposal,
    now,
    `${operationIdValue}:staff-package`,
  );
  const packageOnlyCounter = Boolean(staffDemand.guarantee)
    && assessment.score >= config.acceptanceScore;
  const requestedWage = packageOnlyCounter
    ? proposal.wage
    : Math.min(
      20_000_000,
      Math.round(Math.max(expected, proposal.wage * (1.02 + (hashText(`${proposal.id}|counter`) % 5) / 100)) / 1_000) * 1_000,
    );
  const requestedBonus = packageOnlyCounter
    ? proposal.signingBonus
    : Math.max(proposal.signingBonus, Math.round(requestedWage / 1_000) * 1_000);
  const guaranteeIds = staffDemand.guarantee ? [staffDemand.guarantee.id] : [];
  proposal.status = "aguardando_resposta_diretoria";
  proposal.marketStage = "club_review";
  proposal.pendingCounterproposal = {
    ...proposalTerms(proposal, {
      wage: requestedWage,
      durationYears: Math.max(2, proposal.durationYears),
      signingBonus: requestedBonus,
    }),
    guaranteeIds,
    submittedAt: now,
    operationId: operationIdValue,
  };
  proposal.negotiationRound += 1;
  proposal.updatedAt = now;
  proposal.lastActionAt = now;
  proposal.nextActionAt = addDays(now, config.boardResponseDelayDays);
  proposal.decisionScore = assessment.score;
  proposal.decisionFactors = assessment.factors;
  proposal.decisionReason = staffDemand.guarantee
    ? "required_personal_staff_package"
    : "conditions_need_improvement";
  appendDecision(proposal, {
    action: "counter",
    responsibleId: coach.id,
    responsibleRole: "candidate",
    previousStatus,
    newStatus: proposal.status,
    justification: staffDemand.guarantee
      ? "Treinador exige a contratacao de sua comissao pessoal"
      : "Treinador solicita melhores condicoes",
    negotiatedValues: proposal.pendingCounterproposal,
    conditions: guaranteeIds,
  }, now, operationIdValue);
  events.push(eventRecord("COACH_PROPOSAL_COUNTERED", operationIdValue, now, {
    coachId: coach.id,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    vacancyId: proposal.vacancyId,
    metadata: {
      source: "dynamic_ai_coach_market",
      wage: requestedWage,
      signingBonus: requestedBonus,
      negotiationRound: proposal.negotiationRound,
      decisionScore: assessment.score,
      concessionRate,
      guaranteeIds,
      staffPackage: staffDemand.staffPackage ? {
        staffIds: staffDemand.staffPackage.staffIds,
        headcount: staffDemand.staffPackage.headcount,
        monthlyCost: staffDemand.staffPackage.monthlyCost,
        firstYearCost: staffDemand.staffPackage.firstYearCost,
        expectedHiringBy: staffDemand.staffPackage.expectedHiringBy,
      } : null,
    },
  }));
}

function acceptAiCoachProposalMutable(room, state, proposal, coach, now, operationIdValue, assessment, events, transactions) {
  assertProposalVacancyOpen(state, proposal);
  ensureProposalCanComplete(room, state, proposal);
  ensureClubCanFundProposal(room, state, proposal);
  const previousStatus = proposal.status;
  const guaranteeTerms = contractGuaranteeTerms(state, proposal);
  const outcome = proposal.kind === "renewal"
    ? performRenewalAgreementMutable(room, state, proposal, now, operationIdValue, guaranteeTerms)
    : performAppointment(room, state, {
      coachId: coach.id,
      clubId: proposal.clubId,
      role: proposal.role,
      wage: proposal.wage,
      durationYears: proposal.durationYears,
      terminationClause: proposal.terminationClause,
      signingBonus: proposal.signingBonus,
      compensation: proposal.compensation,
      transferBudget: proposal.transferBudget,
      autonomyLevel: clamp(50 + finite(proposal.autonomyDelta), 0, 100),
      objectiveDifficultyAdjustment: proposal.objectiveDifficultyDelta,
      sourceInterviewId: proposal.interviewId,
      bonuses: proposal.bonuses,
      guaranteeIds: guaranteeTerms.guaranteeIds,
      clauses: [...proposal.specialClauses, ...guaranteeTerms.clauses],
      staffPackageCommitments: guaranteeTerms.staffPackageCommitments,
      objectives: proposal.objectives,
      startDate: proposal.plannedStartDate,
      entryReason: proposal.kind === "precontract" ? "precontract" : "accepted_market_proposal",
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      applicationId: proposal.applicationId,
    }, now, operationIdValue);
  proposal.status = "accepted";
  proposal.marketStage = "completed";
  proposal.respondedAt = now;
  proposal.updatedAt = now;
  proposal.lastActionAt = now;
  proposal.nextActionAt = null;
  proposal.pendingCounterproposal = null;
  proposal.decisionScore = assessment.score;
  proposal.decisionFactors = assessment.factors;
  proposal.decisionReason = proposal.kind === "renewal" ? "renewal_best_project" : "best_available_offer";
  appendDecision(proposal, {
    action: "accept",
    responsibleId: coach.id,
    responsibleRole: "candidate",
    previousStatus,
    newStatus: proposal.status,
    justification: proposal.decisionReason,
    negotiatedValues: proposalTerms(proposal),
    conditions: guaranteeTerms.guaranteeIds,
  }, now, operationIdValue);
  events.push(...outcome.events);
  transactions.push(...outcome.transactions);
  closeCoachCompetingNegotiationsMutable(state, proposal, now, operationIdValue, events);
  events.push(eventRecord("COACH_PROPOSAL_ACCEPTED", `${operationIdValue}:accepted`, now, {
    coachId: coach.id,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    contractId: outcome.contract?.id,
    vacancyId: proposal.vacancyId,
    metadata: {
      decisionScore: assessment.score,
      source: "dynamic_ai_coach_market",
      staffPackageCommitments: guaranteeTerms.staffPackageCommitments,
    },
  }));
}

function processAiCoachNegotiationsMutable(room, state, now, options, events, transactions, processed) {
  const config = coachMarketConfig(state, options);
  const grouped = new Map();
  for (const proposal of state.proposals) {
    if (!["pending", "aprovada_diretoria"].includes(proposal.status)) continue;
    const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === proposal.coachId);
    if (!coach || coach.managerType === "human") continue;
    const list = grouped.get(coach.id) ?? [];
    list.push(proposal);
    grouped.set(coach.id, list);
  }

  for (const [coachId, proposals] of grouped) {
    const coach = coachById(room, coachId);
    const liveProposals = proposals.filter((proposal) => {
      if (!["pending", "aprovada_diretoria"].includes(proposal.status)) return false;
      if (!proposal.vacancyId) return true;
      return state.vacancies.some((vacancy) => vacancy.id === proposal.vacancyId && vacancy.status === "open");
    });
    const ranked = liveProposals.map((proposal) => ({
      proposal,
      assessment: coachProposalDecision(room, state, coach, proposal, now),
    })).sort((left, right) => right.assessment.score - left.assessment.score
      || left.proposal.id.localeCompare(right.proposal.id, "pt-BR"));
    for (const { proposal, assessment } of ranked) {
      proposal.decisionScore = assessment.score;
      proposal.decisionFactors = assessment.factors;
      proposal.competingProposalIds = ranked
        .filter((candidate) => candidate.proposal.id !== proposal.id)
        .map((candidate) => candidate.proposal.id);
    }

    const best = ranked[0];
    if (!best) continue;
    const proposal = best.proposal;
    const assessment = best.assessment;
    const dueAt = proposal.nextActionAt ?? addDays(proposal.updatedAt ?? proposal.createdAt ?? now, config.coachResponseDelayDays);
    if (new Date(dueAt).getTime() > new Date(now).getTime()) continue;
    const marketRestriction = activeCoachMarketRestriction(coach, now);
    if (marketRestriction && marketRestriction.signingBlocked !== false) {
      const restrictionId = `coach-signing-deferred:${proposal.id}:${marketRestriction.endsAt}`;
      proposal.nextActionAt = marketRestriction.endsAt;
      proposal.decisionReason = "market_restriction_active";
      if (!hasProcessed(state, restrictionId)) {
        appendDecision(proposal, {
          action: "signing_deferred",
          responsibleId: "system",
          responsibleRole: "system",
          previousStatus: proposal.status,
          newStatus: proposal.status,
          justification: `Assinatura bloqueada ate ${marketRestriction.endsAt}`,
          negotiatedValues: { restrictionEndsAt: marketRestriction.endsAt },
        }, now, restrictionId);
        events.push(eventRecord("COACH_SIGNING_DEFERRED", restrictionId, now, {
          coachId: coach.id,
          clubId: proposal.clubId,
          proposalId: proposal.id,
          metadata: { restrictionEndsAt: marketRestriction.endsAt },
        }));
        processed.push(restrictionId);
      }
      continue;
    }
    const id = `coach-ai-response:${proposal.id}:round-${proposal.negotiationRound}`;
    if (hasProcessed(state, id)) continue;
    const expiresSoon = proposal.expiresAt
      && new Date(proposal.expiresAt).getTime() - new Date(now).getTime() <= DAY_MS;
    const requiredStaffPackage = preferredPersonalStaffPackage(room, proposal, now);
    const approvedStaffPackage = requiredStaffPackage
      ? requiredStaffPackageGuarantee(
        state,
        proposal,
        requiredStaffPackage,
        ["formalized", "fulfilled"],
      )
      : null;
    const staffPackageNeedsBoardApproval = Boolean(requiredStaffPackage && !approvedStaffPackage);
    const coachWouldNegotiate = assessment.score >= config.counterScore
      || (expiresSoon && assessment.score >= config.counterScore - 5);
    if (
      staffPackageNeedsBoardApproval
      && coachWouldNegotiate
      && proposal.negotiationRound < proposal.maxNegotiationRounds
    ) {
      counterAiCoachProposalMutable(room, state, proposal, coach, now, id, assessment, config, events);
    } else if (staffPackageNeedsBoardApproval) {
      rejectAiCoachProposalMutable(
        room,
        state,
        proposal,
        coach,
        now,
        id,
        proposal.negotiationRound >= proposal.maxNegotiationRounds
          ? "required_staff_package_not_approved"
          : "project_below_expectations",
        assessment,
        events,
      );
    } else if (assessment.score >= config.acceptanceScore || (expiresSoon && assessment.score >= config.counterScore + 5)) {
      try {
        acceptAiCoachProposalMutable(room, state, proposal, coach, now, id, assessment, events, transactions);
      } catch (error) {
        if (error?.code !== "COACH_PROPOSAL_BUDGET_CHANGED") throw error;
        rejectAiCoachProposalMutable(
          room,
          state,
          proposal,
          coach,
          now,
          id,
          "club_budget_no_longer_available",
          assessment,
          events,
        );
      }
    } else if (assessment.score >= config.counterScore && proposal.negotiationRound < proposal.maxNegotiationRounds) {
      counterAiCoachProposalMutable(room, state, proposal, coach, now, id, assessment, config, events);
    } else {
      const withdrew = proposal.negotiationRound > 0
        && hashText(`${proposal.id}|${proposal.negotiationRound}|withdraw`) % 4 === 0;
      const reason = withdrew
        ? "coach_withdrew_after_failed_negotiation"
        : proposal.negotiationRound >= proposal.maxNegotiationRounds
          ? "negotiation_round_limit_without_agreement"
          : "project_below_expectations";
      rejectAiCoachProposalMutable(
        room,
        state,
        proposal,
        coach,
        now,
        id,
        reason,
        assessment,
        events,
        withdrew ? "withdrawn" : "rejected",
      );
    }
    processed.push(id);

    for (const alternative of ranked.slice(1)) {
      if (!ACTIVE_PROPOSAL_STATUSES.has(alternative.proposal.status)) continue;
      alternative.proposal.nextActionAt = addDays(now, 1);
      alternative.proposal.decisionReason = "comparing_competing_offers";
    }
  }
}

function aiResignationDecision(room, state, coach, appointment, now, options) {
  if (coach.managerType === "human" || coach.id.startsWith("interim-coach:") || appointment.role !== "head_coach") return null;
  const contract = activeContractForCoach(state, coach.id);
  if (!contract || (contract.endDate && new Date(contract.endDate).getTime() <= new Date(now).getTime())) return null;
  const requiredEvaluations = integer(options.aiResignationEvidenceCount, 3, 3, 8);
  const evaluations = activeTenureEvaluations(state, appointment).slice(-requiredEvaluations);
  if (evaluations.length < requiredEvaluations) return null;
  const averageScore = averageEvaluationScore(evaluations);
  const hasFactorThroughout = (code) => evaluations.every((evaluation) => (
    evaluation.factors.some((factor) => factor?.code === code && finite(factor?.impact, 0) < 0)
  ));
  const morale = (room?.clubMoraleStates ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(appointment.clubId)
  ));
  const finance = (room?.marketState?.finances ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(appointment.clubId)
  ));
  const boardTrust = Number(coach.boardConfidence ?? coach.boardRelationship ?? coach.satisfaction);

  let reason = null;
  if (Number.isFinite(Number(morale?.score))
    && Number(morale.score) <= 20
    && averageScore <= 55
    && hasFactorThroughout("squad_unrest")) {
    reason = "prolonged_squad_unrest";
  } else if (Number.isFinite(Number(finance?.balance))
    && Number(finance.balance) < 0
    && averageScore <= 45
    && hasFactorThroughout("financial_pressure")) {
    reason = "persistent_financial_crisis";
  } else if (Number.isFinite(boardTrust)
    && boardTrust <= 15
    && averageScore <= 40
    && evaluations.every((evaluation) => ["review", "dismiss"].includes(evaluation.recommendation))) {
    reason = "prolonged_board_conflict";
  }
  return reason ? {
    reason,
    averageScore,
    evidenceEvaluationIds: evaluations.map((evaluation) => evaluation.id),
    moraleScore: Number.isFinite(Number(morale?.score)) ? Number(morale.score) : null,
    financeBalance: Number.isFinite(Number(finance?.balance)) ? Number(finance.balance) : null,
    boardTrust: Number.isFinite(boardTrust) ? boardTrust : null,
  } : null;
}

function processAiVoluntaryResignations(room, state, now, options, events, transactions, processed) {
  if (options.autoResignAI === false) return;
  for (const appointment of state.appointments.filter((candidate) => (
    candidate.status === "active" && candidate.role === "head_coach"
  ))) {
    const coach = coachById(room, appointment.coachId);
    const decision = aiResignationDecision(room, state, coach, appointment, now, options);
    if (!decision) continue;
    const lastEvidenceId = decision.evidenceEvaluationIds.at(-1);
    const id = `coach-ai-resign:${coach.id}:${lastEvidenceId}`;
    if (hasProcessed(state, id)) continue;
    const contract = activeContractForCoach(state, coach.id);
    const outcome = resignCoachMutable(room, state, {
      coachId: coach.id,
      clubId: appointment.clubId,
      reasonCode: decision.reason,
      reason: decision.reason,
      compensation: contract?.terminationClause ?? 0,
    }, now, id, options);
    const resignationEvent = outcome.events.find((event) => event.type === "COACH_RESIGNED");
    if (resignationEvent) resignationEvent.payload = {
      ...resignationEvent.payload,
      source: "autonomous_ai_lifecycle",
      averageScore: Math.round(decision.averageScore),
      evidenceEvaluationIds: decision.evidenceEvaluationIds,
      moraleScore: decision.moraleScore,
      financeBalance: decision.financeBalance,
      boardTrust: decision.boardTrust,
    };
    events.push(...outcome.events);
    transactions.push(...outcome.transactions);
    processed.push(id);
  }
}

function automaticBoardDecisionInput(room, state, proposal, now, options) {
  if (proposal.status !== "aguardando_resposta_diretoria" || !proposal.pendingCounterproposal) return null;
  const delayDays = coachMarketConfig(state, options).boardResponseDelayDays;
  const updatedAt = new Date(proposal.updatedAt ?? proposal.createdAt ?? now).getTime();
  if (new Date(now).getTime() - updatedAt < delayDays * DAY_MS) return null;
  const requested = proposal.pendingCounterproposal;
  const available = availableClubFunds(room, proposal.clubId);
  const requestedGuarantees = guaranteesForProposal(state, proposal)
    .filter((guarantee) => guarantee.status === "requested");
  const staffPackageGuarantees = requestedGuarantees.filter(isStaffPackageGuarantee);
  const staffPackages = staffPackageGuarantees.map((guarantee) => ({
    guarantee,
    staffPackage: staffPackageFromGuarantee(guarantee),
  })).filter((entry) => entry.staffPackage);
  const staffPackageFirstYearCost = staffPackages.reduce(
    (total, entry) => Math.min(
      MAX_MONEY,
      total + integer(entry.staffPackage.firstYearCost, 0, 0, MAX_MONEY),
    ),
    0,
  );
  const staffPackageMonthlyCost = staffPackages.reduce(
    (total, entry) => Math.min(
      MAX_MONEY,
      total + integer(entry.staffPackage.monthlyCost, 0, 0, MAX_MONEY),
    ),
    0,
  );
  const unavailableStaffIds = [...new Set(staffPackages.flatMap(({ staffPackage }) => (
    (staffPackage.members ?? [])
      .filter((member) => member?.recruitable === false)
      .map((member) => identifier(member?.staffId))
      .filter(Boolean)
  )))];
  const requiredReserve = integer(proposal.compensation, 0, 0, MAX_MONEY)
    + integer(requested.signingBonus, 0, 0, MAX_MONEY)
    + integer(requested.wage, proposal.wage, 0, MAX_MONEY) * 3
    + staffPackageFirstYearCost;
  const decisionContext = {
    availableFunds: available,
    requiredReserve,
    coachCompensation: integer(proposal.compensation, 0, 0, MAX_MONEY),
    coachSigningBonus: integer(requested.signingBonus, 0, 0, MAX_MONEY),
    coachThreeMonthReserve: integer(requested.wage, proposal.wage, 0, MAX_MONEY) * 3,
    staffPackageGuaranteeIds: staffPackageGuarantees.map((guarantee) => guarantee.id),
    staffPackageHeadcount: staffPackages.reduce(
      (total, entry) => total + integer(entry.staffPackage.headcount, 0, 0, 100),
      0,
    ),
    staffPackageMonthlyCost,
    staffPackageFirstYearCost,
    unavailableStaffIds,
  };
  if (unavailableStaffIds.length > 0) {
    return {
      action: "reject",
      guaranteeResolutions: [],
      justification: "A diretoria recusou profissionais indisponiveis na comissao solicitada",
      decisionContext,
    };
  }
  if (available != null && available < requiredReserve) {
    return {
      action: "reject",
      guaranteeResolutions: [],
      justification: staffPackageFirstYearCost > 0
        ? "O pacote da comissao e as condicoes do treinador excedem o caixa disponivel"
        : "Condicoes excedem o orcamento disponivel",
      decisionContext,
    };
  }
  if (available != null && requested.transferBudget != null && requested.transferBudget > available) {
    return {
      action: "reject",
      guaranteeResolutions: [],
      justification: "Orcamento de transferencias solicitado excede a capacidade do clube",
      decisionContext,
    };
  }
  const sourceContract = proposal.kind === "renewal"
    ? state.contracts.find((contract) => contract.id === proposal.sourceContractId)
    : null;
  const baselineWage = Math.max(1, integer(sourceContract?.wage ?? proposal.wage, proposal.wage, 1, MAX_MONEY));
  const wageRatio = requested.wage / baselineWage;
  const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === proposal.coachId);
  const latest = latestCoachEvaluation(state, proposal.coachId);
  const performanceScore = latest?.minimumGamesMet ? latest.score : 50;
  const trustScore = coachCareerTrustSummary(coach).score;
  const acceptableIncrease = clamp(1.05 + Math.max(0, performanceScore - 50) / 200 + Math.max(0, trustScore - 70) / 300, 1.05, 1.4);
  const guaranteeResolutions = requestedGuarantees
    .map((guarantee) => ({
      guaranteeId: guarantee.id,
      status: "formalized",
      responsibleId: guarantee.responsibleId || proposal.clubId,
      responsibleRole: guarantee.responsibleRole || "board",
      dueAt: guarantee.dueAt
        ?? staffPackageFromGuarantee(guarantee)?.expectedHiringBy
        ?? addDays(now, 90),
      effects: guarantee.effects.length > 0 ? guarantee.effects : [{
        type: "contract_clause",
        description: guarantee.description,
      }],
      justification: isStaffPackageGuarantee(guarantee)
        ? `Pacote da comissao formalizado; custo estimado no primeiro ano: ${integer(
          staffPackageFromGuarantee(guarantee)?.firstYearCost,
          0,
          0,
          MAX_MONEY,
        )}`
        : "Garantia formalizada pela diretoria",
    }));
  if (wageRatio <= acceptableIncrease && requested.durationYears <= 5) {
    return {
      action: "approve",
      guaranteeResolutions,
      justification: `Condicoes aprovadas: desempenho ${Math.round(performanceScore)}/100 e confianca ${Math.round(trustScore)}/100`,
      decisionContext,
    };
  }
  if (wageRatio <= acceptableIncrease + 0.25) {
    return {
      action: "new_offer",
      wage: Math.round(((baselineWage * acceptableIncrease + requested.wage) / 2) / 1_000) * 1_000,
      durationYears: Math.min(requested.durationYears, 4),
      transferBudget: requested.transferBudget == null || available == null
        ? requested.transferBudget
        : Math.min(requested.transferBudget, Math.round(available * 0.7)),
      objectives: requested.objectives,
      specialClauses: requested.specialClauses,
      guaranteeResolutions,
      justification: `Diretoria ajusta pedido de ${Math.round((wageRatio - 1) * 100)}% sobre contrato atual`,
      decisionContext,
    };
  }
  return {
    action: "reject",
    guaranteeResolutions: [],
    justification: "Condicoes fora da politica financeira do clube",
    decisionContext,
  };
}

function processActiveInterimsMutable(room, state, now, options, events, transactions, processed) {
  const extensionDays = integer(options.interimExtensionDays, 30, 7, 180);
  const currentTime = new Date(now).getTime();
  for (const appointment of state.appointments.filter((candidate) => (
    candidate.status === "active" && candidate.role === "interim"
  ))) {
    const bonus = interimBonusTransactionMutable(appointment, now);
    if (bonus) {
      transactions.push(bonus);
      events.push(eventRecord("COACH_INTERIM_BONUS_PAID", bonus.operationId, now, {
        coachId: appointment.coachId,
        clubId: appointment.clubId,
        contractId: appointment.contractId,
        amount: bonus.amount,
        metadata: { appointmentId: appointment.id, sourceStaffId: appointment.sourceStaffId },
      }));
      processed.push(bonus.operationId);
    }

    if (!appointment.expectedEndAt || new Date(appointment.expectedEndAt).getTime() > currentTime) continue;
    const vacancy = state.vacancies.find((candidate) => (
      candidate.status === "open" && clubKey(candidate.clubId) === clubKey(appointment.clubId)
    ));
    if (!vacancy) continue;
    const previousExpectedEndAt = appointment.expectedEndAt;
    const id = `coach-interim-extension:${appointment.id}:${previousExpectedEndAt}`;
    if (hasProcessed(state, id)) continue;
    const extensionBase = new Date(Math.max(currentTime, new Date(previousExpectedEndAt).getTime())).toISOString();
    appointment.initialExpectedEndAt = appointment.initialExpectedEndAt ?? previousExpectedEndAt;
    appointment.expectedEndAt = addDays(extensionBase, extensionDays);
    appointment.extensionCount = integer(appointment.extensionCount, 0, 0, 100) + 1;
    appointment.extensionHistory = [
      ...(Array.isArray(appointment.extensionHistory) ? appointment.extensionHistory : []),
      {
        operationId: id,
        previousExpectedEndAt,
        expectedEndAt: appointment.expectedEndAt,
        extendedAt: now,
        reason: "vacancy_still_open",
      },
    ].slice(-100);
    appointment.statistics = appointmentStatistics(room, appointment, now);
    appendNotification(state, {
      type: "COACH_INTERIM_EXTENDED",
      recipientId: appointment.clubId,
      recipientRole: "board",
      coachId: appointment.coachId,
      clubId: appointment.clubId,
      vacancyId: vacancy.id,
      title: "Interinidade prorrogada",
      message: `A vaga segue aberta. Interinidade prorrogada por ${extensionDays} dia(s).`,
    }, now, id);
    events.push(eventRecord("COACH_INTERIM_EXTENDED", id, now, {
      coachId: appointment.coachId,
      clubId: appointment.clubId,
      contractId: appointment.contractId,
      vacancyId: vacancy.id,
      metadata: {
        appointmentId: appointment.id,
        previousExpectedEndAt,
        expectedEndAt: appointment.expectedEndAt,
        extensionDays,
        extensionCount: appointment.extensionCount,
        authorityLevel: appointment.authorityLevel,
        canBeConfirmed: appointment.canBeConfirmed,
        statistics: clone(appointment.statistics),
      },
    }));
    processed.push(id);
  }
}

export function processCoachEmploymentDate(roomValue, asOf = new Date(), options = {}) {
  const now = careerDate(roomValue, asOf);
  let room = ensureCoachEmploymentState(roomValue, { now });
  const events = [];
  const transactions = [];
  const processed = [];

  if (options.conductOnly !== true && options.autoRespondBoard !== false) {
    for (const proposal of [...room.coachEmploymentState.proposals]) {
      const decision = automaticBoardDecisionInput(room, room.coachEmploymentState, proposal, now, options);
      if (!decision) continue;
      const boardOperationId = `coach-board-auto:${proposal.id}:round-${proposal.negotiationRound}`;
      if (hasProcessed(room.coachEmploymentState, boardOperationId)) continue;
      const outcome = respondCoachBoardDecision(room, {
        operationId: boardOperationId,
        proposalId: proposal.id,
        responsibleId: `board:${proposal.clubId}`,
        responsibleRole: "board",
        ...decision,
      }, { now });
      room = outcome.room;
      events.push(...outcome.events);
      processed.push(boardOperationId);
    }
  }
  const state = room.coachEmploymentState;
  state.marketConfig = coachMarketConfig(state, options);
  state.conductConfig = coachConductConfig(state, options);
  processCoachConductProgressMutable(room, state, now, options, events, processed);

  if (options.conductOnly === true) {
    state.currentDate = now;
    assertCoachEmploymentIntegrity(room, now);
    emitCallbacks(room, events, transactions, options);
    markProcessed(state, ...processed);
    synchronizeCareerAndRetain(room, state, now);
    return {
      room,
      events: clone(events),
      financialTransactions: [],
      evaluations: [],
      processedOperationIds: clone(processed),
      duplicate: processed.length === 0,
    };
  }

  processActiveInterimsMutable(room, state, now, options, events, transactions, processed);

  // Interviews are resolved before expiration so a response due on the same
  // career date is not discarded by the generic expiry pass below.
  resolveAiInterviewsMutable(room, state, now, state.marketConfig, events, processed);

  for (const proposal of state.proposals) {
    if (!ACTIVE_PROPOSAL_STATUSES.has(proposal.status) || !proposal.expiresAt) continue;
    if (new Date(proposal.expiresAt).getTime() > new Date(now).getTime()) continue;
    const id = `coach-proposal-expire:${proposal.id}`;
    if (hasProcessed(state, id)) continue;
    const previousStatus = proposal.status;
    proposal.status = "expired";
    proposal.marketStage = "closed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = null;
    proposal.decisionReason = "proposal_deadline_expired";
    appendDecision(proposal, {
      action: "expire",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: proposal.status,
      justification: "Prazo da proposta encerrado sem acordo",
      negotiatedValues: proposalTerms(proposal),
    }, now, id);
    closeProposalSelectionMutable(state, proposal, proposal.status, proposal.decisionReason, now, id);
    const coach = coachById(room, proposal.coachId);
    refreshCoachMarketStatus(state, coach);
    events.push(eventRecord("COACH_PROPOSAL_EXPIRED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
    }));
    processed.push(id);
  }

  for (const guarantee of state.guarantees) {
    if (!guarantee.dueAt || ["fulfilled", "waived", "breached"].includes(guarantee.status)) continue;
    const remainingDays = Math.ceil((new Date(guarantee.dueAt).getTime() - new Date(now).getTime()) / DAY_MS);
    if (remainingDays >= 0 && remainingDays <= 7) {
      const id = `coach-guarantee-due:${guarantee.id}:${guarantee.dueAt}`;
      if (!hasProcessed(state, id)) {
        appendNotification(state, {
          type: "COACH_GUARANTEE_DUE_SOON",
          recipientId: guarantee.responsibleId,
          recipientRole: guarantee.responsibleRole,
          coachId: guarantee.coachId,
          clubId: guarantee.clubId,
          proposalId: guarantee.proposalId,
          vacancyId: guarantee.vacancyId,
          guaranteeId: guarantee.id,
          title: "Garantia proxima do vencimento",
          message: `Prazo em ${remainingDays} dia(s): ${guarantee.description}`,
        }, now, id);
        events.push(eventRecord("COACH_GUARANTEE_DUE_SOON", id, now, {
          coachId: guarantee.coachId,
          clubId: guarantee.clubId,
          proposalId: guarantee.proposalId,
          vacancyId: guarantee.vacancyId,
          metadata: { guaranteeId: guarantee.id, dueAt: guarantee.dueAt, remainingDays },
        }));
        processed.push(id);
      }
    } else if (remainingDays < 0 && guarantee.status !== "overdue") {
      const id = `coach-guarantee-overdue:${guarantee.id}:${guarantee.dueAt}`;
      if (!hasProcessed(state, id)) {
        const previousStatus = guarantee.status;
        guarantee.status = "overdue";
        guarantee.updatedAt = now;
        appendDecision(guarantee, {
          action: "deadline_overdue",
          responsibleId: "system",
          responsibleRole: "system",
          previousStatus,
          newStatus: guarantee.status,
          justification: "Prazo da garantia vencido",
        }, now, id);
        appendNotification(state, {
          type: "COACH_GUARANTEE_OVERDUE",
          recipientId: guarantee.responsibleId,
          recipientRole: guarantee.responsibleRole,
          coachId: guarantee.coachId,
          clubId: guarantee.clubId,
          proposalId: guarantee.proposalId,
          vacancyId: guarantee.vacancyId,
          guaranteeId: guarantee.id,
          title: "Garantia vencida",
          message: guarantee.description,
        }, now, id);
        events.push(eventRecord("COACH_GUARANTEE_OVERDUE", id, now, {
          coachId: guarantee.coachId,
          clubId: guarantee.clubId,
          proposalId: guarantee.proposalId,
          vacancyId: guarantee.vacancyId,
          metadata: { guaranteeId: guarantee.id, dueAt: guarantee.dueAt },
        }));
        processed.push(id);
      }
    }
  }

  for (const interview of state.interviews) {
    if (interview.status !== "pending" || !interview.expiresAt) continue;
    if (new Date(interview.expiresAt).getTime() > new Date(now).getTime()) continue;
    const id = `coach-interview-expire:${interview.id}`;
    if (hasProcessed(state, id)) continue;
    interview.status = "expired";
    interview.closedAt = now;
    interview.closedReason = "interview_deadline_expired";
    interview.closedBy = id;
    appendDecision(interview, {
      action: "expire",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus: "pending",
      newStatus: interview.status,
      justification: "Prazo da entrevista encerrado sem resposta",
    }, now, id);
    const application = state.applications.find((candidate) => candidate.id === interview.applicationId);
    if (application) application.status = "rejected";
    events.push(eventRecord("COACH_INTERVIEW_EXPIRED", id, now, {
      coachId: interview.coachId, clubId: interview.clubId,
      metadata: { interviewId: interview.id },
    }));
    processed.push(id);
  }

  for (const scheduled of state.appointments.filter((appointment) => appointment.status === "scheduled")) {
    const start = scheduled.expectedStartAt ?? scheduled.startedAt;
    if (!start || new Date(start).getTime() > new Date(now).getTime()) continue;
    const id = `coach-appointment-activate:${scheduled.id}`;
    if (hasProcessed(state, id)) continue;
    const scheduledContract = state.contracts.find((contract) => contract.id === scheduled.contractId);
    scheduled.status = "activated";
    if (scheduledContract) {
      scheduledContract.status = "replaced";
      scheduledContract.endedAt = now;
      scheduledContract.endReason = "scheduled_contract_activated";
    }
    const result = performImmediateAppointment(room, state, {
      coachId: scheduled.coachId,
      clubId: scheduled.clubId,
      proposalId: scheduled.proposalId,
      vacancyId: scheduled.vacancyId,
      applicationId: scheduled.applicationId,
      role: scheduled.role,
      wage: scheduledContract?.wage,
      endDate: scheduledContract?.endDate,
      terminationClause: scheduledContract?.terminationClause,
      signingBonus: scheduledContract?.signingBonus,
      compensation: scheduled.entryReason === "precontract" ? 0 : scheduledContract?.compensation,
      objectives: scheduledContract?.objectives,
      startDate: now,
      entryReason: scheduled.entryReason,
    }, now, id);
    events.push(...result.events);
    transactions.push(...result.transactions);
    processed.push(id);
  }

  processAiVoluntaryResignations(room, state, now, options, events, transactions, processed);
  processAiContractRenewals(room, state, now, options, events, processed);

  for (const contract of state.contracts.filter((candidate) => candidate.status === "active" && candidate.endDate)) {
    if (new Date(contract.endDate).getTime() > new Date(now).getTime()) continue;
    const id = `coach-contract-expire:${contract.id}`;
    if (hasProcessed(state, id)) continue;
    const appointment = activeAppointmentForCoach(state, contract.coachId);
    if (appointment) {
      const coach = coachById(room, contract.coachId);
      applyCoachRecoveryMutable(state, coach, {
        kind: "contract_completed",
        operationId: `${id}:reputation-recovery`,
        clubId: contract.clubId,
        reasonLabel: "Contrato cumprido ate o fim",
        metadata: { contractId: contract.id },
      }, now, events, processed, options);
      closeAppointmentMutable(room, state, appointment, now, "contract_expired", "unemployed");
      const interim = createInterimMutable(
        room,
        state,
        contract.clubId,
        "contract_expired",
        now,
        id,
        { payBonus: true },
      );
      events.push(eventRecord("COACH_CONTRACT_EXPIRED", id, now, {
        coachId: coach.id, clubId: contract.clubId, contractId: contract.id, vacancyId: interim.vacancy?.id,
      }));
      if (interim.event) events.push(interim.event);
      transactions.push(...interim.transactions);
    } else {
      contract.status = "expired";
      contract.endedAt = now;
      contract.endReason = "contract_expired";
    }
    processed.push(id);
  }

  const minimumGames = integer(options.minimumGames, 5, 1, 30);
  const round = completedRound(room);
  for (const appointment of state.appointments.filter((candidate) => candidate.status === "active")) {
    const id = `coach-evaluation:s${seasonNumber(room)}:r${round}:${appointment.id}`;
    if (state.evaluations.some((evaluation) => evaluation.id === id)) continue;
    const securityOutcome = evaluateAppointment(room, state, appointment, now, minimumGames, id);
    const evaluation = normalizeEvaluation(securityOutcome.evaluation);
    state.jobSecurity = securityOutcome.jobSecurityState;
    state.evaluations.push(evaluation);
    events.push(eventRecord(appointment.role === "interim" ? "COACH_INTERIM_EVALUATED" : "COACH_EVALUATED", id, now, {
      coachId: appointment.coachId,
      clubId: appointment.clubId,
      metadata: {
        appointmentId: appointment.id,
        role: appointment.role,
        score: evaluation.score,
        securityLevel: evaluation.securityLevel,
        recommendation: evaluation.recommendation,
        games: evaluation.games,
      },
    }));
    processed.push(id);
    for (const action of securityOutcome.actions ?? []) {
      if (hasProcessed(state, action.operationId)) continue;
      appendNotification(state, {
        type: action.type,
        recipientId: appointment.coachId,
        recipientRole: "coach",
        coachId: appointment.coachId,
        clubId: appointment.clubId,
        title: action.title,
        message: action.message,
      }, now, action.operationId);
      events.push(eventRecord(action.type, action.operationId, now, {
        coachId: appointment.coachId,
        clubId: appointment.clubId,
        metadata: {
          appointmentId: appointment.id,
          evaluationId: evaluation.id,
          ultimatumId: action.ultimatumId ?? null,
          meetingId: action.meetingId ?? null,
          score: evaluation.score,
          securityLevel: evaluation.securityLevel,
        },
      }));
      processed.push(action.operationId);
    }

    const coach = coachById(room, appointment.coachId);
    if (appointment.role === "interim") continue;
    const recoveryInterval = coachConductConfig(state, options).evaluationRecoveryIntervalRounds;
    if (evaluation.minimumGamesMet && evaluation.round > 0 && evaluation.round % recoveryInterval === 0) {
      applyCoachRecoveryMutable(state, coach, {
        kind: "evaluation",
        operationId: `${id}:reputation-recovery`,
        clubId: appointment.clubId,
        score: evaluation.score,
        reasonLabel: "Recuperacao por desempenho consistente",
        metadata: { evaluationId: evaluation.id, score: evaluation.score },
      }, now, events, processed, options);
    }
    const previousPoor = state.evaluations
      .filter((candidate) => candidate.coachId === coach.id && candidate.id !== id && candidate.minimumGamesMet)
      .slice(-1)[0];
    const dismissalEnabled = coach.managerType === "human"
      ? options.autoDismissHuman !== false
      : options.autoDismissAI !== false;
    const autoDismiss = dismissalEnabled
      && (
        evaluation.ultimatumOutcome === "failed"
        || (
          (evaluation.recommendation === "dismiss" || evaluation.score < 25)
          && previousPoor?.score < 25
        )
      );
    if (autoDismiss) {
      const dismissalId = `${id}:auto-dismiss`;
      const contract = activeContractForCoach(state, coach.id);
      const penalty = integer(contract?.terminationClause, 0, 0, MAX_MONEY);
      closeAppointmentMutable(room, state, appointment, now, "performance_dismissal", "dismissed");
      const interim = createInterimMutable(
        room,
        state,
        appointment.clubId,
        "performance_dismissal",
        now,
        dismissalId,
        { payBonus: true },
      );
      if (penalty > 0) transactions.push(financeRecord("expense", "coach_termination", dismissalId, now, {
        clubId: appointment.clubId, coachId: coach.id, amount: penalty,
      }));
      events.push(eventRecord("COACH_DISMISSED", dismissalId, now, {
        coachId: coach.id, clubId: appointment.clubId, contractId: contract?.id,
        vacancyId: interim.vacancy?.id, amount: penalty,
        metadata: { reason: "performance_dismissal", evaluationId: evaluation.id },
      }));
      if (interim.event) events.push(interim.event);
      transactions.push(...interim.transactions);
      processed.push(dismissalId);
    }
  }

  for (const vacancy of state.vacancies.filter((candidate) => candidate.status === "open")) {
    progressOpenCoachVacancy(room, state, vacancy, now, options, events, processed);
  }
  processAiCoachNegotiationsMutable(room, state, now, options, events, transactions, processed);

  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, transactions, options);
  markProcessed(state, ...processed);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    events: clone(events),
    financialTransactions: clone(transactions),
    evaluations: clone(state.evaluations.filter((evaluation) => processed.includes(evaluation.id))),
    processedOperationIds: clone(processed),
    duplicate: processed.length === 0,
  };
}

function assertUniqueIds(collection, code) {
  const ids = collection.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new CoachEmploymentError("IDs duplicados no estado de treinadores", code, 500);
  }
}

function assertCoachEmploymentIntegrity(room, now) {
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
