const DAY_MS = 24 * 60 * 60 * 1_000;

export const DEFAULT_COACH_CONDUCT_CONFIG = Object.freeze({
  baseReputationPenalty: 4,
  pendingProjectPenalty: 3,
  earlyContractPenalty: 2,
  midSeasonPenalty: 2,
  repeatedResignationPenalty: 2,
  maximumReputationPenalty: 15,
  justifiedCauseMultiplier: 0.25,
  baseInactivityDays: 45,
  pendingProjectInactivityDays: 15,
  midSeasonInactivityDays: 10,
  repeatedResignationInactivityDays: 30,
  justifiedInactivityDays: 7,
  minimumInactivityDays: 7,
  maximumInactivityDays: 180,
  goodEvaluationRecovery: 1,
  excellentEvaluationRecovery: 2,
  contractCompletionRecovery: 3,
  titleRecovery: 4,
  longTenureRecovery: 1,
  evaluationRecoveryIntervalRounds: 5,
});

export const COACH_RESIGNATION_REASONS = Object.freeze({
  personal_reasons: { label: "Motivos pessoais", justCause: false },
  new_challenge: { label: "Novo desafio profissional", justCause: false },
  sporting_disagreement: { label: "Divergencia esportiva", justCause: false },
  family_reasons: { label: "Motivos familiares", justCause: false },
  health_reasons: { label: "Motivos de saude", justCause: false },
  prolonged_squad_unrest: { label: "Ambiente interno deteriorado", justCause: false },
  prolonged_board_conflict: { label: "Conflito prolongado com a diretoria", justCause: false },
  persistent_financial_crisis: { label: "Crise financeira persistente", justCause: true },
  unpaid_wages: { label: "Salarios atrasados", justCause: true },
  broken_promises: { label: "Promessas contratuais descumpridas", justCause: true },
  toxic_environment: { label: "Ambiente extremamente instavel", justCause: true },
  board_breach: { label: "Quebra contratual da diretoria", justCause: true },
  coach_resignation: { label: "Pedido de demissao", justCause: false },
});

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

function normalizeReputation100(value, fallback = 50) {
  if (value === null || value === undefined || value === "") {
    return clamp(finite(fallback, 50), 0, 100);
  }
  const score = finite(value, fallback);
  return score > 0 && score <= 20
    ? clamp(score * 5, 0, 100)
    : clamp(score, 0, 100);
}

function coachReputation100(coach, fallback = 50) {
  const marketReputation = coach?.marketReputation;
  const legacyReputation = coach?.reputation;
  return normalizeReputation100(
    marketReputation == null || (
      finite(marketReputation, 0) === 0
        && finite(legacyReputation, 0) > 0
    )
      ? legacyReputation
      : marketReputation,
    fallback,
  );
}

function normalizedText(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function timestamp(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function normalizeCoachConductConfig(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    baseReputationPenalty: integer(source.baseReputationPenalty, DEFAULT_COACH_CONDUCT_CONFIG.baseReputationPenalty, 0, 20),
    pendingProjectPenalty: integer(source.pendingProjectPenalty, DEFAULT_COACH_CONDUCT_CONFIG.pendingProjectPenalty, 0, 15),
    earlyContractPenalty: integer(source.earlyContractPenalty, DEFAULT_COACH_CONDUCT_CONFIG.earlyContractPenalty, 0, 15),
    midSeasonPenalty: integer(source.midSeasonPenalty, DEFAULT_COACH_CONDUCT_CONFIG.midSeasonPenalty, 0, 15),
    repeatedResignationPenalty: integer(source.repeatedResignationPenalty, DEFAULT_COACH_CONDUCT_CONFIG.repeatedResignationPenalty, 0, 15),
    maximumReputationPenalty: integer(source.maximumReputationPenalty, DEFAULT_COACH_CONDUCT_CONFIG.maximumReputationPenalty, 1, 40),
    justifiedCauseMultiplier: clamp(finite(source.justifiedCauseMultiplier, DEFAULT_COACH_CONDUCT_CONFIG.justifiedCauseMultiplier), 0, 1),
    baseInactivityDays: integer(source.baseInactivityDays, DEFAULT_COACH_CONDUCT_CONFIG.baseInactivityDays, 0, 365),
    pendingProjectInactivityDays: integer(source.pendingProjectInactivityDays, DEFAULT_COACH_CONDUCT_CONFIG.pendingProjectInactivityDays, 0, 180),
    midSeasonInactivityDays: integer(source.midSeasonInactivityDays, DEFAULT_COACH_CONDUCT_CONFIG.midSeasonInactivityDays, 0, 180),
    repeatedResignationInactivityDays: integer(source.repeatedResignationInactivityDays, DEFAULT_COACH_CONDUCT_CONFIG.repeatedResignationInactivityDays, 0, 365),
    justifiedInactivityDays: integer(source.justifiedInactivityDays, DEFAULT_COACH_CONDUCT_CONFIG.justifiedInactivityDays, 0, 90),
    minimumInactivityDays: integer(source.minimumInactivityDays, DEFAULT_COACH_CONDUCT_CONFIG.minimumInactivityDays, 0, 90),
    maximumInactivityDays: integer(source.maximumInactivityDays, DEFAULT_COACH_CONDUCT_CONFIG.maximumInactivityDays, 1, 730),
    goodEvaluationRecovery: integer(source.goodEvaluationRecovery, DEFAULT_COACH_CONDUCT_CONFIG.goodEvaluationRecovery, 0, 10),
    excellentEvaluationRecovery: integer(source.excellentEvaluationRecovery, DEFAULT_COACH_CONDUCT_CONFIG.excellentEvaluationRecovery, 0, 15),
    contractCompletionRecovery: integer(source.contractCompletionRecovery, DEFAULT_COACH_CONDUCT_CONFIG.contractCompletionRecovery, 0, 20),
    titleRecovery: integer(source.titleRecovery, DEFAULT_COACH_CONDUCT_CONFIG.titleRecovery, 0, 20),
    longTenureRecovery: integer(source.longTenureRecovery, DEFAULT_COACH_CONDUCT_CONFIG.longTenureRecovery, 0, 10),
    evaluationRecoveryIntervalRounds: integer(
      source.evaluationRecoveryIntervalRounds,
      DEFAULT_COACH_CONDUCT_CONFIG.evaluationRecoveryIntervalRounds,
      1,
      38,
    ),
  };
}

export function inferCoachResignationReason(reasonCode, reasonText = "") {
  const explicit = normalizedText(reasonCode).replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  if (COACH_RESIGNATION_REASONS[explicit]) return explicit;
  const text = normalizedText(reasonText);
  if (/salari|pagamento/.test(text) && /atras|falta|nao/.test(text)) return "unpaid_wages";
  if (/promess|garantia|acordo/.test(text) && /quebr|descumpr|nao/.test(text)) return "broken_promises";
  if (/financeir|falencia|divida|caixa/.test(text)) return "persistent_financial_crisis";
  if (/toxic|instavel|vestiario|ambiente/.test(text)) return "toxic_environment";
  if (/diretoria|presidente/.test(text) && /conflit|quebr|ruptura/.test(text)) return "prolonged_board_conflict";
  if (/famil/.test(text)) return "family_reasons";
  if (/saude|medic/.test(text)) return "health_reasons";
  if (/novo desafio|outra oportunidade/.test(text)) return "new_challenge";
  return "coach_resignation";
}

export function activeCoachMarketRestriction(coach, asOf = new Date()) {
  const restriction = coach?.marketRestriction;
  if (!restriction || restriction.type !== "voluntary_resignation") return null;
  const now = new Date(asOf).getTime();
  const endsAt = new Date(restriction.endsAt ?? 0).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(endsAt) || endsAt <= now) return null;
  return {
    ...structuredClone(restriction),
    active: true,
    canInterview: true,
    canSign: false,
    remainingDays: Math.max(1, Math.ceil((endsAt - now) / DAY_MS)),
  };
}

export function coachCareerTrustSummary(coach) {
  const history = Array.isArray(coach?.resignationHistory) ? coach.resignationHistory : [];
  const assignments = Array.isArray(coach?.assignments) ? coach.assignments : [];
  const voluntaryExitCount = history.length;
  const completedContractCount = assignments.filter((assignment) => (
    ["contract_expired", "contract_completed"].includes(String(assignment?.exitReason ?? ""))
  )).length;
  const score = clamp(finite(coach?.professionalTrust, 80), 0, 100);
  return {
    score: Math.round(score),
    voluntaryExitCount,
    completedContractCount,
    label: score >= 85 ? "Muito confiavel" : score >= 70 ? "Confiavel" : score >= 50 ? "Sob observacao" : "Historico instavel",
  };
}

export function calculateCoachResignationConsequences(context = {}, value = {}) {
  const config = normalizeCoachConductConfig(value);
  const now = timestamp(context.now) ?? new Date().toISOString();
  const coach = context.coach ?? {};
  const contract = context.contract ?? {};
  const objectives = Array.isArray(contract.objectives) ? contract.objectives : [];
  const pendingObjectives = objectives.filter((objective) => !["completed", "fulfilled"].includes(String(objective?.status ?? "pending")));
  const remainingContractDays = contract.endDate
    ? Math.max(0, Math.ceil((new Date(contract.endDate).getTime() - new Date(now).getTime()) / DAY_MS))
    : 0;
  const seasonProgress = clamp(finite(context.seasonProgress, 0.5), 0, 1);
  const previousResignations = (Array.isArray(coach.resignationHistory) ? coach.resignationHistory : []).filter((entry) => {
    const occurredAt = new Date(entry?.occurredAt ?? 0).getTime();
    return Number.isFinite(occurredAt) && occurredAt >= new Date(now).getTime() - 3 * 365 * DAY_MS;
  }).length;
  const reasonCode = inferCoachResignationReason(context.reasonCode, context.reason);
  const reason = COACH_RESIGNATION_REASONS[reasonCode] ?? COACH_RESIGNATION_REASONS.coach_resignation;
  const verifiedJustCause = reason.justCause && context.justCauseEvidence === true;
  const midProject = pendingObjectives.length > 0 || remainingContractDays > 90;
  const midSeason = seasonProgress >= 0.1 && seasonProgress <= 0.9;
  const rawPenalty = config.baseReputationPenalty
    + (pendingObjectives.length > 0 ? config.pendingProjectPenalty : 0)
    + (remainingContractDays > 90 ? config.earlyContractPenalty : 0)
    + (midSeason ? config.midSeasonPenalty : 0)
    + Math.min(3, previousResignations) * config.repeatedResignationPenalty;
  const reputationPenalty = clamp(
    Math.round(rawPenalty * (verifiedJustCause ? config.justifiedCauseMultiplier : 1)),
    verifiedJustCause ? 0 : 1,
    config.maximumReputationPenalty,
  );
  const reputationDelta = -reputationPenalty;
  const trustPenalty = clamp(
    Math.round((reputationPenalty * 1.5) + (verifiedJustCause ? 0 : previousResignations * 3)),
    0,
    30,
  );
  let inactivityDays = config.baseInactivityDays
    + (midProject ? config.pendingProjectInactivityDays : 0)
    + (midSeason ? config.midSeasonInactivityDays : 0)
    + Math.min(3, previousResignations) * config.repeatedResignationInactivityDays
    - Math.round(Math.max(0, coachReputation100(coach) - 50) / 5);
  if (verifiedJustCause) inactivityDays = config.justifiedInactivityDays + previousResignations * config.minimumInactivityDays;
  inactivityDays = clamp(Math.round(inactivityDays), config.minimumInactivityDays, config.maximumInactivityDays);
  return {
    reasonCode,
    reasonLabel: reason.label,
    reasonText: String(context.reason ?? "").trim() || null,
    justCauseRequested: reason.justCause,
    justCauseVerified: verifiedJustCause,
    reputationDelta,
    trustDelta: -trustPenalty,
    inactivityDays,
    restrictionStartsAt: now,
    restrictionEndsAt: addDays(now, inactivityDays),
    pendingProjectPenalty: midProject,
    midSeasonPenalty: midSeason,
    previousResignations,
    remainingContractDays,
    pendingObjectives: pendingObjectives.map((objective) => String(objective?.label ?? objective?.description ?? objective?.id ?? "Objetivo pendente")),
    financialCost: integer(context.financialCost, 0, 0, 2_000_000_000),
  };
}

export function coachRecoveryDelta(kind, context = {}, value = {}) {
  const config = normalizeCoachConductConfig(value);
  if (kind === "contract_completed") return config.contractCompletionRecovery;
  if (kind === "title_won") return config.titleRecovery;
  if (kind === "long_tenure") return config.longTenureRecovery;
  if (kind === "evaluation") {
    const score = finite(context.score, 0);
    if (score >= 80) return config.excellentEvaluationRecovery;
    if (score >= 65) return config.goodEvaluationRecovery;
  }
  return 0;
}
