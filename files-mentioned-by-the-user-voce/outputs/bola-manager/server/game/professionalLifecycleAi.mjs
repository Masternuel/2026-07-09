import {
  calculateProfessionalCompensation,
  ensureProfessionalLifecycleState,
  proposeMutualSeparation,
  respondMutualSeparation,
  scheduleProfessionalRetirement,
  startProfessionalNotice,
} from "./professionalLifecycle.mjs";

const STATE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_MONEY = 2_000_000_000;
const LIVE_AGREEMENT_STATUSES = new Set([
  "proposed",
  "countered",
  "accepted",
  "awaiting_signatures",
  "signed",
]);

const DEFAULT_CONFIG = Object.freeze({
  coachRetirementAge: 68,
  coachRetirementScore: 70,
  staffRetirementAge: 67,
  staffRetirementScore: 70,
  boardMutualAgreementScore: 75,
  severeBoardExitScore: 94,
  coachNoticeScore: 55,
  agreementDecisionDelayDays: 1,
  preferredStaffRiskPerMember: 6,
  maximumAuditEntries: 5_000,
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
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

function clubKey(value) {
  return text(value).toLocaleUpperCase("pt-BR");
}

function normalizeConfig(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_CONFIG,
    ...clone(source),
    coachRetirementAge: integer(
      source.coachRetirementAge,
      DEFAULT_CONFIG.coachRetirementAge,
      55,
      90,
    ),
    coachRetirementScore: integer(
      source.coachRetirementScore,
      DEFAULT_CONFIG.coachRetirementScore,
      1,
      100,
    ),
    staffRetirementAge: integer(
      source.staffRetirementAge,
      DEFAULT_CONFIG.staffRetirementAge,
      50,
      90,
    ),
    staffRetirementScore: integer(
      source.staffRetirementScore,
      DEFAULT_CONFIG.staffRetirementScore,
      1,
      100,
    ),
    boardMutualAgreementScore: integer(
      source.boardMutualAgreementScore,
      DEFAULT_CONFIG.boardMutualAgreementScore,
      1,
      100,
    ),
    severeBoardExitScore: integer(
      source.severeBoardExitScore,
      DEFAULT_CONFIG.severeBoardExitScore,
      1,
      100,
    ),
    coachNoticeScore: integer(
      source.coachNoticeScore,
      DEFAULT_CONFIG.coachNoticeScore,
      1,
      100,
    ),
    agreementDecisionDelayDays: integer(
      source.agreementDecisionDelayDays,
      DEFAULT_CONFIG.agreementDecisionDelayDays,
      0,
      30,
    ),
    preferredStaffRiskPerMember: integer(
      source.preferredStaffRiskPerMember,
      DEFAULT_CONFIG.preferredStaffRiskPerMember,
      0,
      30,
    ),
    maximumAuditEntries: integer(
      source.maximumAuditEntries,
      DEFAULT_CONFIG.maximumAuditEntries,
      100,
      100_000,
    ),
  };
}

function lifecycleOptions(options, now) {
  return {
    ...options,
    now,
    config: options.lifecycleConfig,
  };
}

function normalizeAuditEntry(value) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.id);
  const occurredAt = timestamp(value.occurredAt);
  if (!id || !occurredAt) return null;
  return {
    ...clone(value),
    id,
    tickId: text(value.tickId) || null,
    operationId: text(value.operationId) || null,
    occurredAt,
    action: text(value.action) || "no_action",
    professionalType: ["coach", "staff"].includes(value.professionalType)
      ? value.professionalType
      : null,
    professionalId: text(value.professionalId) || null,
    clubId: text(value.clubId) || null,
    resultStatus: text(value.resultStatus) || null,
    reason: text(value.reason) || null,
    factors: value.factors && typeof value.factors === "object" ? clone(value.factors) : {},
  };
}

function ensureAiState(room, now, options = {}) {
  const source = room.professionalLifecycleAiState
    && typeof room.professionalLifecycleAiState === "object"
    ? room.professionalLifecycleAiState
    : {};
  const entries = (Array.isArray(source.audit) ? source.audit : [])
    .map(normalizeAuditEntry)
    .filter(Boolean);
  room.professionalLifecycleAiState = {
    ...clone(source),
    version: STATE_VERSION,
    currentDate: now,
    config: normalizeConfig({ ...source.config, ...options.config }),
    processedTickIds: [...new Set(
      (Array.isArray(source.processedTickIds) ? source.processedTickIds : [])
        .map(text)
        .filter(Boolean),
    )],
    audit: [...new Map(entries.map((entry) => [entry.id, entry])).values()],
  };
  return room.professionalLifecycleAiState;
}

function activeCoachAppointment(room, coachId) {
  return (room?.coachEmploymentState?.appointments ?? []).find((appointment) => (
    text(appointment?.coachId) === text(coachId)
      && appointment?.status === "active"
      && appointment?.role === "head_coach"
  )) ?? null;
}

function activeContract(room, professionalType, professionalId, clubId = null) {
  const contracts = professionalType === "coach"
    ? room?.coachEmploymentState?.contracts
    : room?.clubCareerState?.staffContracts;
  const identityField = professionalType === "coach" ? "coachId" : "staffId";
  return (Array.isArray(contracts) ? contracts : []).find((contract) => (
    text(contract?.[identityField]) === text(professionalId)
      && contract?.status === "active"
      && (!clubId || clubKey(contract?.clubId) === clubKey(clubId))
  )) ?? null;
}

function isHumanCoach(room, coach) {
  if (coach?.managerType === "human") return true;
  return (room?.managers ?? []).some((manager) => (
    text(manager?.id ?? manager?.managerId) === text(coach?.id)
  ));
}

function isHumanControlledClub(room, clubId) {
  return (room?.managers ?? []).some((manager) => (
    clubKey(manager?.clubId) === clubKey(clubId)
  ));
}

function clubBalance(room, clubId) {
  const collections = [
    room?.marketState?.finances,
    room?.clubCareerState?.financeProfiles,
    room?.clubCareerState?.clubFinances,
    room?.clubFinances,
  ];
  for (const collection of collections) {
    const entry = (Array.isArray(collection) ? collection : []).find((candidate) => (
      clubKey(candidate?.clubId ?? candidate?.id) === clubKey(clubId)
    ));
    if (!entry) continue;
    const value = finite(
      entry.balance
        ?? entry.available
        ?? entry.cash
        ?? entry.currentBalance
        ?? entry.transferBudget,
      Number.NaN,
    );
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function latestCoachEvaluation(room, coachId, clubId) {
  return (room?.coachEmploymentState?.evaluations ?? [])
    .filter((entry) => (
      text(entry?.coachId) === text(coachId)
        && (!clubId || clubKey(entry?.clubId) === clubKey(clubId))
    ))
    .sort((left, right) => (
      new Date(right?.createdAt ?? right?.evaluatedAt ?? 0).getTime()
        - new Date(left?.createdAt ?? left?.evaluatedAt ?? 0).getTime()
        || integer(right?.round) - integer(left?.round)
    ))[0] ?? null;
}

function seasonProgress(room) {
  const currentRound = integer(
    room?.lastCompletedRound?.round
      ?? room?.currentRound
      ?? room?.round,
    0,
    0,
    500,
  );
  const scheduledMaximum = (room?.leagueFixtureSchedule ?? []).reduce((maximum, fixture) => (
    Math.max(maximum, integer(fixture?.round, 0, 0, 500))
  ), 0);
  const totalRounds = Math.max(
    scheduledMaximum,
    integer(room?.totalRounds ?? room?.seasonTotalRounds, 0, 0, 500),
  );
  return totalRounds > 0 ? clamp(currentRound / totalRounds, 0, 1) : 0.5;
}

function availableCoachSubstitutes(room, currentCoachId) {
  const retirementIds = new Set((room?.professionalLifecycleState?.retirements ?? [])
    .filter((record) => ["scheduled", "effective"].includes(record.status))
    .map((record) => text(record.professionalId)));
  return (room?.coachCareerState?.coaches ?? []).filter((coach) => (
    text(coach?.id)
      && text(coach?.id) !== text(currentCoachId)
      && coach?.managerType !== "human"
      && ["unemployed", "available", "free_agent"].includes(text(coach?.status).toLocaleLowerCase("en-US"))
      && !retirementIds.has(text(coach.id))
      && !text(coach.id).startsWith("interim-coach:")
  ));
}

function personalStaffRisk(room, coachId, clubId, config) {
  const preferred = room?.professionalLifecycleState?.preferredStaffByCoach?.[coachId] ?? [];
  const members = room?.clubCareerState?.staffMembers ?? [];
  const exposed = preferred.filter((entry) => {
    if (!["personal_team", "coach_recommended"].includes(entry?.affiliationType)) return false;
    const member = members.find((candidate) => text(candidate?.id) === text(entry?.staffId));
    return !member || !clubId || clubKey(member.clubId) === clubKey(clubId);
  });
  const personalCount = exposed.filter((entry) => entry.affiliationType === "personal_team").length;
  const recommendedCount = exposed.length - personalCount;
  const monthlyCost = exposed.reduce((total, entry) => (
    total + integer(entry.estimatedMonthlyCost, 0, 0, MAX_MONEY)
  ), 0);
  const scorePenalty = Math.min(
    30,
    personalCount * config.preferredStaffRiskPerMember
      + recommendedCount * Math.max(1, Math.round(config.preferredStaffRiskPerMember / 2)),
  );
  return {
    personalCount,
    recommendedCount,
    totalAtRisk: exposed.length,
    monthlyCost,
    scorePenalty,
    staffIds: exposed.map((entry) => text(entry.staffId)).filter(Boolean),
  };
}

function coachExperienceYears(coach, now) {
  if (Number.isFinite(Number(coach?.experienceYears))) {
    return integer(coach.experienceYears, 0, 0, 80);
  }
  const assignments = Array.isArray(coach?.assignments) ? coach.assignments : [];
  const starts = assignments
    .map((assignment) => timestamp(assignment?.startedAt))
    .filter(Boolean)
    .sort();
  if (!starts.length) return 0;
  return Math.max(0, Math.floor(
    (new Date(now).getTime() - new Date(starts[0]).getTime()) / (365.25 * DAY_MS),
  ));
}

function coachAge(coach, now) {
  if (Number.isFinite(Number(coach?.age))) return integer(coach.age, 0, 0, 100);
  const birthDate = timestamp(coach?.birthDate ?? coach?.dateOfBirth);
  if (!birthDate) return 0;
  return Math.max(0, Math.floor(
    (new Date(now).getTime() - new Date(birthDate).getTime()) / (365.25 * DAY_MS),
  ));
}

/**
 * Deterministic board assessment. It exposes every factor used by the AI so UI,
 * tests and audit tools can explain why a departure was (or was not) pursued.
 */
export function assessAiCoachLifecycle(roomValue, coachId, options = {}) {
  const now = timestamp(options.now, new Date());
  const room = ensureProfessionalLifecycleState(roomValue, { now, config: options.lifecycleConfig });
  const config = normalizeConfig(options.config);
  const coach = (room?.coachCareerState?.coaches ?? [])
    .find((candidate) => text(candidate?.id) === text(coachId));
  if (!coach) return null;
  const appointment = activeCoachAppointment(room, coach.id);
  if (!appointment) return null;
  const clubId = text(appointment.clubId);
  const contract = activeContract(room, "coach", coach.id, clubId);
  if (!contract) return null;
  const evaluation = latestCoachEvaluation(room, coach.id, clubId);
  const confidence = clamp(
    finite(
      evaluation?.boardSupport?.privateValue
        ?? coach.boardConfidence
        ?? coach.boardRelationship,
      evaluation?.score ?? 50,
    ),
    0,
    100,
  );
  const satisfaction = clamp(
    finite(coach.satisfaction ?? coach.projectSatisfaction, confidence),
    0,
    100,
  );
  const sportingImpact = clamp(finite(evaluation?.score, confidence), 0, 100);
  const substitutes = availableCoachSubstitutes(room, coach.id);
  const substituteAvailable = substitutes.length > 0;
  const progress = seasonProgress(room);
  const staffRisk = personalStaffRisk(room, coach.id, clubId, config);
  const compensation = calculateProfessionalCompensation({
    contract,
    now,
  });
  const balance = clubBalance(room, clubId);
  const affordabilityRatio = compensation.total > 0
    ? Math.max(0, balance / compensation.total)
    : Number.POSITIVE_INFINITY;
  const confidencePressure = Math.max(0, 40 - confidence) * 1.6;
  const performancePressure = Math.max(0, 45 - sportingImpact) * 0.8;
  const substituteImpact = substituteAvailable ? 10 : -18;
  const affordabilityImpact = affordabilityRatio >= 2
    ? 8
    : affordabilityRatio >= 1
      ? 2
      : -30;
  const seasonTimingImpact = progress >= 0.8 ? -8 : progress <= 0.2 ? -3 : 3;
  const boardExitScore = Math.round(clamp(
    (evaluation?.boardSupport?.realIntent === "dismiss"
      ? 78
      : evaluation?.boardSupport?.realIntent === "seek_replacement"
        ? 62
        : 35)
      + confidencePressure
      + performancePressure
      + substituteImpact
      + affordabilityImpact
      + seasonTimingImpact
      - staffRisk.scorePenalty,
    0,
    100,
  ));
  const finance = (room?.marketState?.finances ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(clubId)
  ));
  const morale = (room?.clubMoraleStates ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(clubId)
  ));
  const financialCrisis = balance < 0
    || finite(finance?.unpaidWages ?? finance?.overduePayroll ?? finance?.latePayrollMonths, 0) > 0;
  const moraleScore = Number.isFinite(Number(morale?.score)) ? clamp(morale.score, 0, 100) : null;
  const coachNoticeScore = Math.round(clamp(
    20
      + Math.max(0, 25 - satisfaction) * 2
      + (financialCrisis ? 25 : 0)
      + (moraleScore != null && moraleScore <= 25 ? 15 : 0),
    0,
    100,
  ));
  return {
    coachId: coach.id,
    clubId,
    confidence,
    satisfaction,
    sportingImpact,
    evaluationId: text(evaluation?.id) || null,
    compensation,
    clubBalance: balance,
    affordabilityRatio: Number.isFinite(affordabilityRatio)
      ? Math.round(affordabilityRatio * 100) / 100
      : null,
    substituteAvailable,
    substituteCoachIds: substitutes.map((candidate) => candidate.id),
    personalStaffRisk: staffRisk,
    seasonTiming: {
      progress: Math.round(progress * 1_000) / 1_000,
      impact: seasonTimingImpact,
    },
    boardExitScore,
    coachNoticeScore,
    financialCrisis,
    moraleScore,
  };
}

function hasActiveLifecycle(room, type, id) {
  const state = room.professionalLifecycleState;
  return state.notices.some((record) => (
    record.professionalType === type && record.professionalId === id && record.status === "active"
  )) || state.retirements.some((record) => (
    record.professionalType === type && record.professionalId === id && record.status === "scheduled"
  )) || state.mutualAgreements.some((record) => (
    record.professionalType === type
      && record.professionalId === id
      && LIVE_AGREEMENT_STATUSES.has(record.status)
  ));
}

function agreementReady(agreement, now, config) {
  const updated = timestamp(agreement.updatedAt ?? agreement.proposedAt, now);
  return new Date(now).getTime()
    >= new Date(updated).getTime() + config.agreementDecisionDelayDays * DAY_MS;
}

function agreementProfessionalIsAi(room, agreement) {
  if (agreement.professionalType === "staff") return true;
  const coach = (room?.coachCareerState?.coaches ?? [])
    .find((candidate) => text(candidate?.id) === text(agreement.professionalId));
  return Boolean(coach && !isHumanCoach(room, coach));
}

function agreementClubIsAi(room, agreement) {
  // The manager represents the coach in coach-career negotiations; the board
  // remains an independent AI counterparty. In staff negotiations the manager
  // represents the club, so only AI-controlled clubs answer automatically.
  if (agreement.professionalType === "coach") return true;
  return !isHumanControlledClub(room, agreement.clubId);
}

function agreementAssessment(room, agreement, now, config) {
  const contract = activeContract(
    room,
    agreement.professionalType,
    agreement.professionalId,
    agreement.clubId,
  );
  const baseline = calculateProfessionalCompensation({ contract: contract ?? {}, now });
  const requested = integer(agreement?.terms?.compensation, 0, 0, MAX_MONEY);
  const balance = clubBalance(room, agreement.clubId);
  const coachAssessment = agreement.professionalType === "coach"
    ? assessAiCoachLifecycle(room, agreement.professionalId, { now, config })
    : null;
  const professional = agreement.professionalType === "coach"
    ? (room?.coachCareerState?.coaches ?? []).find((coach) => (
      text(coach?.id) === text(agreement.professionalId)
    ))
    : (room?.clubCareerState?.staffMembers ?? []).find((staff) => (
      text(staff?.id) === text(agreement.professionalId)
    ));
  const satisfaction = clamp(finite(
    professional?.satisfaction
      ?? professional?.projectSatisfaction
      ?? coachAssessment?.satisfaction,
    50,
  ), 0, 100);
  const desiredProfessionalCompensation = Math.round(
    baseline.total * clamp(0.65 + satisfaction / 200, 0.65, 1.15),
  );
  const affordable = requested <= Math.max(0, balance);
  return {
    baselineCompensation: baseline.total,
    requestedCompensation: requested,
    desiredProfessionalCompensation,
    clubBalance: balance,
    affordable,
    boardExitScore: coachAssessment?.boardExitScore ?? 60,
    satisfaction,
  };
}

function appendAudit(room, input) {
  const state = room.professionalLifecycleAiState;
  const entry = normalizeAuditEntry({
    ...input,
    id: input.id ?? stableId(
      "professional-ai-audit",
      input.tickId,
      input.operationId,
      input.action,
      input.professionalType,
      input.professionalId,
    ),
  });
  if (!entry || state.audit.some((candidate) => candidate.id === entry.id)) return entry;
  state.audit = [...state.audit, entry].slice(-state.config.maximumAuditEntries);
  return entry;
}

function resultStatus(room, type, id) {
  const state = room.professionalLifecycleState;
  const agreement = state.mutualAgreements.find((record) => (
    record.professionalType === type
      && record.professionalId === id
      && LIVE_AGREEMENT_STATUSES.has(record.status)
  ));
  if (agreement) return agreement.status;
  const retirement = state.retirements.find((record) => (
    record.professionalType === type && record.professionalId === id && record.status === "scheduled"
  ));
  if (retirement) return retirement.status;
  const notice = state.notices.find((record) => (
    record.professionalType === type && record.professionalId === id && record.status === "active"
  ));
  return notice?.status ?? null;
}

function pushDecision(room, decisions, input) {
  const entry = appendAudit(room, input);
  if (entry) decisions.push(clone(entry));
}

function applyLifecycleOutcome(room, outcome) {
  return outcome?.room && typeof outcome.room === "object" ? outcome.room : room;
}

function progressAgreement(roomValue, agreementInput, now, tickId, config, options, decisions) {
  let room = roomValue;
  let agreement = room.professionalLifecycleState.mutualAgreements
    .find((candidate) => candidate.id === agreementInput.id);
  if (!agreement || !agreementReady(agreement, now, config)) return room;
  const professionalAi = agreementProfessionalIsAi(room, agreement);
  const clubAi = agreementClubIsAi(room, agreement);
  const assessment = agreementAssessment(room, agreement, now, config);
  let action = null;
  let actor = null;
  let terms = null;
  let reason = null;

  if (["proposed", "countered"].includes(agreement.status)) {
    actor = agreement.nextResponder;
    if ((actor === "professional" && !professionalAi) || (actor === "club" && !clubAi)) return room;
    if (actor === "professional") {
      if (assessment.requestedCompensation >= assessment.desiredProfessionalCompensation) {
        action = "accept";
        reason = "ai_professional_terms_satisfactory";
      } else if (
        agreement.negotiationRound < room.professionalLifecycleState.config.maximumMutualAgreementRounds
        && assessment.requestedCompensation >= assessment.desiredProfessionalCompensation * 0.35
      ) {
        action = "counter";
        terms = {
          compensation: Math.round(assessment.desiredProfessionalCompensation * 0.9),
        };
        reason = "ai_professional_counter_compensation";
      } else {
        action = "reject";
        reason = "ai_professional_terms_insufficient";
      }
    } else if (
      assessment.affordable
      && (
        assessment.boardExitScore >= config.boardMutualAgreementScore
        || assessment.requestedCompensation <= assessment.baselineCompensation * 0.7
      )
    ) {
      action = "accept";
      reason = "ai_board_exit_cost_acceptable";
    } else if (
      assessment.clubBalance > 0
      && agreement.negotiationRound < room.professionalLifecycleState.config.maximumMutualAgreementRounds
      && assessment.boardExitScore >= 55
    ) {
      action = "counter";
      terms = {
        compensation: Math.max(
          0,
          Math.round(Math.min(
            assessment.clubBalance * 0.25,
            Math.max(assessment.baselineCompensation * 0.7, 0),
          )),
        ),
      };
      reason = "ai_board_counter_within_budget";
    } else {
      action = "reject";
      reason = assessment.affordable
        ? "ai_board_prefers_continuity"
        : "ai_board_cannot_fund_separation";
    }
  } else if (["accepted", "awaiting_signatures"].includes(agreement.status)) {
    const clubNeedsSignature = !agreement.signatures?.club && clubAi;
    const professionalNeedsSignature = !agreement.signatures?.professional && professionalAi;
    if (clubNeedsSignature && professionalNeedsSignature) actor = "both";
    else if (clubNeedsSignature) actor = "club";
    else if (professionalNeedsSignature) actor = "professional";
    if (!actor) return room;
    action = "sign";
    reason = "ai_bilateral_terms_formalized";
  } else {
    return room;
  }

  const operationId = `professional-ai-mutual:${agreement.id}:${agreement.status}:r${agreement.negotiationRound}:${action}:${actor}`;
  try {
    const outcome = respondMutualSeparation(room, {
      operationId,
      agreementId: agreement.id,
      action,
      actor,
      terms,
      reason,
    }, lifecycleOptions(options, now));
    room = applyLifecycleOutcome(room, outcome);
    ensureAiState(room, now, options);
    agreement = room.professionalLifecycleState.mutualAgreements
      .find((candidate) => candidate.id === agreement.id);
    pushDecision(room, decisions, {
      tickId,
      operationId,
      occurredAt: now,
      action: `mutual_${action}`,
      professionalType: agreement.professionalType,
      professionalId: agreement.professionalId,
      clubId: agreement.clubId,
      resultStatus: agreement.status,
      reason,
      factors: assessment,
    });
  } catch (error) {
    pushDecision(room, decisions, {
      tickId,
      operationId,
      occurredAt: now,
      action: "mutual_error",
      professionalType: agreement.professionalType,
      professionalId: agreement.professionalId,
      clubId: agreement.clubId,
      resultStatus: agreement.status,
      reason: text(error?.code ?? error?.message) || "unknown_error",
      factors: assessment,
    });
  }
  return room;
}

function retirementKindFor(contract, room) {
  const contractEnd = timestamp(contract?.endDate);
  const seasonEnd = timestamp(room?.seasonEndsAt);
  if (contractEnd && (!seasonEnd || new Date(contractEnd).getTime() <= new Date(seasonEnd).getTime())) {
    return "end_contract";
  }
  return seasonEnd ? "end_season" : "future";
}

function retirementEffectiveAt(contract, room, now) {
  return timestamp(contract?.endDate)
    ?? timestamp(room?.seasonEndsAt)
    ?? addDays(now, 180);
}

function coachAchievementCount(coach) {
  const direct = finite(
    coach?.careerStats?.titles
      ?? coach?.statistics?.titles
      ?? coach?.titlesWon
      ?? coach?.titleCount,
    Number.NaN,
  );
  if (Number.isFinite(direct)) return integer(direct, 0, 0, 200);
  return (Array.isArray(coach?.titles) ? coach.titles : Array.isArray(coach?.achievements) ? coach.achievements : [])
    .filter(Boolean).length;
}

function coachMarketInterest(room, coachId) {
  const activeStatuses = new Set([
    "draft",
    "sent",
    "pending",
    "countered",
    "accepted",
    "interview_scheduled",
    "interview_completed",
    "aguardando_resposta_diretoria",
  ]);
  return (room?.coachEmploymentState?.proposals ?? []).filter((proposal) => (
    text(proposal?.coachId) === text(coachId) && activeStatuses.has(text(proposal?.status))
  )).length;
}

function assessCoachRetirement(room, coach, contract, now, config) {
  const age = coachAge(coach, now);
  const experienceYears = coachExperienceYears(coach, now);
  const ageScore = Math.max(0, age - 60) * 8;
  const experienceScore = Math.max(0, experienceYears - 25) * 1.5;
  const health = clamp(finite(
    coach?.professionalHealth
      ?? coach?.health
      ?? coach?.wellbeing,
    100 - finite(coach?.accumulatedWear ?? coach?.burnout ?? coach?.fatigue, 0),
  ), 0, 100);
  const healthWearScore = Math.max(0, 75 - health) * 0.35;
  const contractEnd = timestamp(contract?.endDate);
  const contractDaysRemaining = contractEnd
    ? Math.ceil((new Date(contractEnd).getTime() - new Date(now).getTime()) / DAY_MS)
    : null;
  const contractScore = contractDaysRemaining == null
    ? 0
    : contractDaysRemaining <= 0
      ? 12
      : contractDaysRemaining <= 180
        ? 7
        : contractDaysRemaining >= 730
          ? -5
          : 0;
  const achievements = coachAchievementCount(coach);
  const legacyScore = Math.min(6, achievements * 0.75);
  const marketInterest = coachMarketInterest(room, coach?.id);
  const marketInterestPenalty = Math.min(16, marketInterest * 4);
  const reputation = clamp(finite(coach?.reputation ?? coach?.marketReputation, 50), 0, 100);
  const reputationPenalty = reputation >= 80 ? 5 : reputation >= 65 ? 2 : 0;
  const latestEvaluation = latestCoachEvaluation(room, coach?.id, contract?.clubId);
  const recentPerformance = latestEvaluation == null
    ? null
    : clamp(finite(latestEvaluation.score, 50), 0, 100);
  const resultWearScore = recentPerformance != null && recentPerformance < 35 ? 6 : 0;
  const unemployedSince = timestamp(
    coach?.unemployedSince
      ?? coach?.availableSince
      ?? coach?.lastClubEndedAt,
  );
  const unemploymentDays = unemployedSince
    ? Math.max(0, Math.floor((new Date(now).getTime() - new Date(unemployedSince).getTime()) / DAY_MS))
    : 0;
  const unemploymentScore = Math.min(18, Math.floor(unemploymentDays / 90) * 2);
  const personalObjectiveScore = ["retire", "retirement", "encerrar_carreira"].includes(
    text(coach?.personalObjective ?? coach?.careerObjective ?? coach?.retirementIntent).toLocaleLowerCase("pt-BR"),
  ) ? 20 : 0;
  const retirementScore = Math.round(clamp(
    ageScore
      + experienceScore
      + healthWearScore
      + contractScore
      + legacyScore
      + resultWearScore
      + unemploymentScore
      + personalObjectiveScore
      - marketInterestPenalty
      - reputationPenalty,
    0,
    100,
  ));
  return {
    age,
    experienceYears,
    ageScore,
    experienceScore,
    professionalHealth: Math.round(health),
    healthWearScore: Math.round(healthWearScore * 10) / 10,
    contractDaysRemaining,
    contractScore,
    achievements,
    legacyScore: Math.round(legacyScore * 10) / 10,
    marketInterest,
    marketInterestPenalty,
    reputation,
    reputationPenalty,
    recentPerformance,
    resultWearScore,
    unemploymentDays,
    unemploymentScore,
    personalObjectiveScore,
    retirementScore,
    eligible: age >= config.coachRetirementAge
      && retirementScore >= config.coachRetirementScore,
  };
}

function assessStaffRetirement(staff, contract, now, config) {
  const age = integer(staff?.age, 0, 0, 100);
  const experienceYears = integer(
    staff?.experienceYears
      ?? staff?.careerYears
      ?? staff?.yearsExperience,
    Math.max(0, age - 25),
    0,
    80,
  );
  const health = clamp(finite(
    staff?.professionalHealth
      ?? staff?.health
      ?? staff?.wellbeing,
    100 - finite(staff?.accumulatedWear ?? staff?.burnout ?? staff?.fatigue, 0),
  ), 0, 100);
  const satisfaction = clamp(finite(staff?.satisfaction, 60), 0, 100);
  const reputation = clamp(finite(staff?.reputation, 50), 0, 100);
  const contractEnd = timestamp(contract?.endDate);
  const contractDaysRemaining = contractEnd
    ? Math.ceil((new Date(contractEnd).getTime() - new Date(now).getTime()) / DAY_MS)
    : null;
  const ageScore = Math.max(0, age - 60) * 9;
  const experienceScore = Math.max(0, experienceYears - 30);
  const healthWearScore = Math.max(0, 75 - health) * 0.35;
  const dissatisfactionScore = Math.max(0, 35 - satisfaction) * 0.2;
  const contractScore = contractDaysRemaining != null && contractDaysRemaining <= 180 ? 7 : 0;
  const marketValuePenalty = reputation >= 80 ? 5 : reputation >= 65 ? 2 : 0;
  const personalTeamPenalty = ["personal_team", "personal_staff"].includes(text(staff?.affiliationType))
    ? 3
    : 0;
  const retirementScore = Math.round(clamp(
    ageScore
      + experienceScore
      + healthWearScore
      + dissatisfactionScore
      + contractScore
      - marketValuePenalty
      - personalTeamPenalty,
    0,
    100,
  ));
  return {
    age,
    retirementAge: config.staffRetirementAge,
    experienceYears,
    professionalHealth: Math.round(health),
    satisfaction: Math.round(satisfaction),
    reputation: Math.round(reputation),
    contractDaysRemaining,
    role: text(staff?.role) || "staff",
    affiliationType: text(staff?.affiliationType) || "independent",
    ageScore,
    experienceScore,
    healthWearScore: Math.round(healthWearScore * 10) / 10,
    dissatisfactionScore: Math.round(dissatisfactionScore * 10) / 10,
    contractScore,
    marketValuePenalty,
    personalTeamPenalty,
    retirementScore,
    eligible: age >= config.staffRetirementAge
      && retirementScore >= config.staffRetirementScore,
  };
}

/**
 * Runs one stable AI lifecycle turn. Repeating the same tick is a no-op.
 *
 * Integration contract:
 *   { room, decisions, processedOperationIds, tickId, duplicate }
 */
export function runAiProfessionalLifecycleTick(roomValue, asOf = new Date(), options = {}) {
  const now = timestamp(asOf, new Date());
  let room = ensureProfessionalLifecycleState(roomValue, {
    now,
    config: options.lifecycleConfig,
  });
  let aiState = ensureAiState(room, now, options);
  const season = integer(room?.currentSeason ?? room?.seasonNumber, 1, 1, 10_000);
  const round = integer(room?.lastCompletedRound?.round ?? room?.currentRound, 0, 0, 1_000);
  const tickDate = now.slice(0, 10);
  const tickId = text(options.tickId)
    || `professional-lifecycle-ai:s${season}:r${round}:${tickDate}`;
  if (aiState.processedTickIds.includes(tickId)) {
    return {
      room,
      decisions: [],
      processedOperationIds: [],
      tickId,
      duplicate: true,
    };
  }
  const config = aiState.config;
  const decisions = [];
  const timelineBefore = new Set(room.professionalLifecycleState.processedOperationIds);

  for (const sourceAgreement of [...room.professionalLifecycleState.mutualAgreements]) {
    if (!LIVE_AGREEMENT_STATUSES.has(sourceAgreement.status) || sourceAgreement.status === "signed") continue;
    room = progressAgreement(room, sourceAgreement, now, tickId, config, options, decisions);
    aiState = ensureAiState(room, now, options);
  }

  for (const coach of [...(room?.coachCareerState?.coaches ?? [])]) {
    if (
      isHumanCoach(room, coach)
      || coach?.status === "retired"
      || text(coach?.id).startsWith("interim-coach:")
    ) continue;
    const appointment = activeCoachAppointment(room, coach.id);
    if (hasActiveLifecycle(room, "coach", coach.id)) continue;
    const clubId = text(appointment?.clubId ?? coach?.clubId) || null;
    const contract = activeContract(room, "coach", coach.id, clubId);
    const retirement = assessCoachRetirement(room, coach, contract, now, config);
    if (retirement.eligible) {
      const operationId = `professional-ai-retirement:coach:${coach.id}:s${season}`;
      const outcome = scheduleProfessionalRetirement(room, {
        operationId,
        professionalType: "coach",
        professionalId: coach.id,
        clubId,
        kind: retirementKindFor(contract, room),
        effectiveAt: retirementEffectiveAt(contract, room, now),
        reason: "ai_career_cycle_completed",
        decisionFactors: retirement,
      }, lifecycleOptions(options, now));
      room = applyLifecycleOutcome(room, outcome);
      ensureAiState(room, now, options);
      pushDecision(room, decisions, {
        tickId,
        operationId,
        occurredAt: now,
        action: "retirement_announced",
        professionalType: "coach",
        professionalId: coach.id,
        clubId,
        resultStatus: resultStatus(room, "coach", coach.id),
        reason: "ai_career_cycle_completed",
        factors: retirement,
      });
      continue;
    }
    if (!appointment || !contract) continue;

    const assessment = assessAiCoachLifecycle(room, coach.id, { now, config });
    if (!assessment) continue;
    const canFundExit = assessment.compensation.total === 0
      || assessment.clubBalance >= assessment.compensation.total;
    const boardAi = !isHumanControlledClub(room, clubId);
    const shouldProposeMutual = boardAi
      && canFundExit
      && (
        assessment.boardExitScore >= config.boardMutualAgreementScore
        && assessment.substituteAvailable
        || assessment.boardExitScore >= config.severeBoardExitScore
      );
    if (shouldProposeMutual) {
      const operationId = `professional-ai-mutual-propose:coach:${coach.id}:s${season}:r${round}`;
      const departureDate = addDays(now, Math.max(2, config.agreementDecisionDelayDays * 2));
      const outcome = proposeMutualSeparation(room, {
        operationId,
        professionalType: "coach",
        professionalId: coach.id,
        clubId,
        proposedBy: "club",
        departureDate,
        reason: "ai_board_structured_exit",
        terms: {
          compensation: assessment.compensation.total,
          marketRelease: true,
        },
        openSuccession: true,
      }, lifecycleOptions(options, now));
      room = applyLifecycleOutcome(room, outcome);
      ensureAiState(room, now, options);
      pushDecision(room, decisions, {
        tickId,
        operationId,
        occurredAt: now,
        action: "mutual_proposed",
        professionalType: "coach",
        professionalId: coach.id,
        clubId,
        resultStatus: resultStatus(room, "coach", coach.id),
        reason: "ai_board_structured_exit",
        factors: assessment,
      });
    } else if (assessment.coachNoticeScore >= config.coachNoticeScore) {
      const operationId = `professional-ai-notice:coach:${coach.id}:s${season}:r${round}`;
      const outcome = startProfessionalNotice(room, {
        operationId,
        professionalType: "coach",
        professionalId: coach.id,
        clubId,
        initiatedBy: "professional",
        durationDays: integer(options.noticeDays, 30, 7, 180),
        reason: assessment.financialCrisis
          ? "ai_coach_financial_instability"
          : "ai_coach_project_dissatisfaction",
        interviewAllowed: true,
        earlyExitAllowed: true,
      }, lifecycleOptions(options, now));
      room = applyLifecycleOutcome(room, outcome);
      ensureAiState(room, now, options);
      pushDecision(room, decisions, {
        tickId,
        operationId,
        occurredAt: now,
        action: "notice_started",
        professionalType: "coach",
        professionalId: coach.id,
        clubId,
        resultStatus: resultStatus(room, "coach", coach.id),
        reason: assessment.financialCrisis
          ? "ai_coach_financial_instability"
          : "ai_coach_project_dissatisfaction",
        factors: assessment,
      });
    } else {
      pushDecision(room, decisions, {
        tickId,
        occurredAt: now,
        action: "no_action",
        professionalType: "coach",
        professionalId: coach.id,
        clubId,
        resultStatus: null,
        reason: !canFundExit && assessment.boardExitScore >= config.boardMutualAgreementScore
          ? "termination_cost_unaffordable"
          : assessment.personalStaffRisk.totalAtRisk > 0
            ? "continuity_preferred_due_staff_risk"
            : "lifecycle_stable",
        factors: assessment,
      });
    }
  }

  for (const staff of [...(room?.clubCareerState?.staffMembers ?? [])]) {
    if (
      staff?.status !== "employed"
      || hasActiveLifecycle(room, "staff", staff.id)
    ) continue;
    const contract = activeContract(room, "staff", staff.id, staff.clubId);
    if (!contract) continue;
    const factors = assessStaffRetirement(staff, contract, now, config);
    if (!factors.eligible) continue;
    const operationId = `professional-ai-retirement:staff:${staff.id}:s${season}`;
    const outcome = scheduleProfessionalRetirement(room, {
      operationId,
      professionalType: "staff",
      professionalId: staff.id,
      clubId: staff.clubId,
      kind: retirementKindFor(contract, room),
      effectiveAt: retirementEffectiveAt(contract, room, now),
      reason: "ai_staff_career_cycle_completed",
      decisionFactors: factors,
    }, lifecycleOptions(options, now));
    room = applyLifecycleOutcome(room, outcome);
    ensureAiState(room, now, options);
    pushDecision(room, decisions, {
      tickId,
      operationId,
      occurredAt: now,
      action: "retirement_announced",
      professionalType: "staff",
      professionalId: staff.id,
      clubId: staff.clubId,
      resultStatus: resultStatus(room, "staff", staff.id),
      reason: "ai_staff_career_cycle_completed",
      factors,
    });
  }

  aiState = ensureAiState(room, now, options);
  if (!aiState.processedTickIds.includes(tickId)) aiState.processedTickIds.push(tickId);
  aiState.currentDate = now;
  const processedOperationIds = room.professionalLifecycleState.processedOperationIds
    .filter((id) => !timelineBefore.has(id));
  return {
    room,
    decisions: clone(decisions),
    processedOperationIds,
    tickId,
    duplicate: false,
  };
}

export function professionalLifecycleAiSnapshot(roomValue, options = {}) {
  const now = timestamp(options.now, new Date());
  const room = ensureProfessionalLifecycleState(roomValue, {
    now,
    config: options.lifecycleConfig,
  });
  const state = ensureAiState(room, now, options);
  const professionalType = text(options.professionalType);
  const professionalId = text(options.professionalId);
  const clubId = text(options.clubId);
  return clone({
    ...state,
    audit: state.audit.filter((entry) => (
      (!professionalType || entry.professionalType === professionalType)
        && (!professionalId || entry.professionalId === professionalId)
        && (!clubId || clubKey(entry.clubId) === clubKey(clubId))
    )),
    processedTickIds: [],
  });
}
