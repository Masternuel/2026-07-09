import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../lib/apiClient';
import type {
  CoachApplication,
  CoachApplicationStatus,
  CoachBoardObjective,
  CoachCandidateAssessment,
  CoachCareerAlert,
  CoachCareerConductEntry,
  CoachCareerHistory,
  CoachCareerHistoryAchievement,
  CoachCareerHistoryContract,
  CoachCareerHistoryFinancialEntry,
  CoachCareerHistoryMetrics,
  CoachCareerHistoryNegotiation,
  CoachCareerHistoryReputationEntry,
  CoachCareerHistorySpell,
  CoachCareerHistorySummary,
  CoachCareerHistoryTimelineEntry,
  CoachCareerHistoryTitle,
  CoachCareerHistoryUnemploymentPeriod,
  CoachCareerTransition,
  CoachLifecycleSnapshot,
  CoachMutualAgreement,
  CoachNoticePeriod,
  CoachPreferredStaffMember,
  CoachProfessionalLeave,
  CoachRetirementPlan,
  CoachCareerSnapshot,
  CoachCareerTrust,
  CoachClubReference,
  CoachContract,
  CoachContractStatus,
  CoachContractTerms,
  CoachEmployment,
  CoachEmploymentHistoryEntry,
  CoachEmploymentStatus,
  CoachInterview,
  CoachInterviewAnswer,
  CoachInterviewDepth,
  CoachInterviewStatus,
  CoachJobSecurity,
  CoachJobSecurityFactor,
  CoachJobSecurityLevel,
  CoachMarketStage,
  CoachMarketRestriction,
  CoachGuaranteeEffect,
  CoachGuaranteeStatus,
  CoachProfile,
  CoachProposal,
  CoachProposalAvailableActions,
  CoachProposalDecision,
  CoachProposalDecisionLog,
  CoachProposalInformationRequest,
  CoachProposalKind,
  CoachProposalStatus,
  CoachResignationConsequences,
  CoachStructuredGuarantee,
  CoachVacancy,
  CoachVacancyDesiredProfile,
  CoachVacancyStatus,
  ProfessionalAffiliationType,
  ProfessionalLifecycleAction,
  ProfessionalLifecycleRecord,
  ProfessionalLifecycleStatus,
} from '../types';
import { useAuth } from './useAuth';

type UnknownRecord = Record<string, unknown>;

interface CoachCareerResponse {
  coachCareer?: unknown;
  career?: unknown;
  snapshot?: unknown;
}

export interface CoachRenewalExtras {
  signingBonus?: number;
  terminationClause?: number;
  releaseClause?: number;
  bonuses?: Record<string, number>;
  transferBudget?: number;
  sportingTargets?: string[];
  objectives?: string[];
  specialClauses?: string[];
}

export type CoachProposalNegotiationTerms = Partial<CoachContractTerms> & {
  signingBonus?: number;
  bonusTerms?: Record<string, number>;
};

export type CoachLifecyclePayload = Record<string, unknown>;

function compactLifecyclePayload(payload: CoachLifecyclePayload): CoachLifecyclePayload {
  return Object.fromEntries(Object.entries(payload).flatMap(([key, value]) => {
    if (typeof value !== 'string') return [[key, value]];
    const trimmed = value.trim();
    return trimmed ? [[key, trimmed]] : [];
  }));
}

export interface UseCoachCareerResult {
  snapshot: CoachCareerSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  mutationKey: string | null;
  refresh: () => void;
  respondToProposal: (proposalId: string, decision: CoachProposalDecision, terms?: CoachProposalNegotiationTerms) => Promise<CoachCareerSnapshot | null>;
  requestMoreTime: (proposalId: string) => Promise<CoachCareerSnapshot | null>;
  requestGuarantee: (proposalId: string, guarantee: string) => Promise<CoachCareerSnapshot | null>;
  provideProposalInformation: (proposalId: string, response: string) => Promise<CoachCareerSnapshot | null>;
  endNegotiation: (proposalId: string) => Promise<CoachCareerSnapshot | null>;
  applyToVacancy: (vacancyId: string, message?: string) => Promise<CoachCareerSnapshot | null>;
  answerInterview: (interviewId: string, answers: CoachInterviewAnswer[]) => Promise<CoachCareerSnapshot | null>;
  startInterview: (interviewId: string, depth: CoachInterviewDepth) => Promise<CoachCareerSnapshot | null>;
  answerInterviewTurn: (interviewId: string, message: string, currentQuestionId?: string | null) => Promise<CoachCareerSnapshot | null>;
  runLifecycleAction: (action: ProfessionalLifecycleAction, payload?: CoachLifecyclePayload) => Promise<CoachCareerSnapshot | null>;
  resign: (reason?: string, reasonCode?: string) => Promise<CoachCareerSnapshot | null>;
  renewContract: (years: number, salary?: number, extras?: CoachRenewalExtras) => Promise<CoachCareerSnapshot | null>;
  searchJobs: (active?: boolean) => Promise<CoachCareerSnapshot | null>;
}

const employmentStatuses: CoachEmploymentStatus[] = ['employed', 'unemployed', 'negotiating', 'notice', 'on_leave', 'dismissed', 'resigned', 'interim', 'awaiting_start', 'retiring', 'retired'];
const contractStatuses: CoachContractStatus[] = ['active', 'scheduled', 'expired', 'terminated', 'superseded', 'cancelled'];
const proposalStatuses: CoachProposalStatus[] = ['pending', 'accepted', 'rejected', 'countered', 'expired', 'withdrawn', 'aguardando_resposta_diretoria', 'aprovada_diretoria', 'informacoes_solicitadas', 'encerrado_vaga_preenchida'];
const proposalKinds: CoachProposalKind[] = ['hiring', 'renewal', 'precontract'];
const lifecycleStatuses: ProfessionalLifecycleStatus[] = [
  'draft', 'proposed', 'countered', 'accepted', 'signed',
  'active', 'completed', 'cancelled', 'rejected', 'postponed',
];
const affiliationTypes: ProfessionalAffiliationType[] = [
  'independent', 'personal_team', 'personal_staff', 'coach_recommended', 'inherited',
];
const marketStages: CoachMarketStage[] = ['interest', 'interview', 'coach_review', 'club_review', 'agreement', 'completed', 'closed'];
const vacancyStatuses: CoachVacancyStatus[] = ['open', 'shortlisting', 'interviewing', 'filled', 'expired', 'cancelled'];
const applicationStatuses: CoachApplicationStatus[] = ['submitted', 'shortlisted', 'interview', 'interview_completed', 'offered', 'accepted', 'rejected', 'withdrawn', 'contratado', 'encerrado_vaga_preenchida'];
const interviewStatuses: CoachInterviewStatus[] = ['pending', 'scheduled', 'awaiting_answers', 'completed', 'accepted', 'rejected', 'expired', 'cancelled', 'contratado', 'encerrado_vaga_preenchida'];
const guaranteeStatuses: CoachGuaranteeStatus[] = ['requested', 'pending_formalization', 'formalized', 'in_progress', 'fulfilled', 'waived', 'breached', 'rejected', 'cancelled', 'overdue', 'solicitada', 'pendente_formalizacao', 'formalizada', 'em_andamento', 'cumprida', 'rejeitada', 'cancelada', 'vencida'];
const securityLevels: CoachJobSecurityLevel[] = ['untouchable', 'very_safe', 'safe', 'stable', 'under_observation', 'pressured', 'very_pressured', 'at_risk', 'imminent'];
const securityTrends = ['rising', 'stable', 'falling'] as const;

const securityLabels: Record<CoachJobSecurityLevel, string> = {
  untouchable: 'Intocável',
  very_safe: 'Muito seguro',
  safe: 'Seguro',
  stable: 'Estável',
  under_observation: 'Sob observação',
  pressured: 'Pressionado',
  very_pressured: 'Muito pressionado',
  at_risk: 'Risco de demissão',
  imminent: 'Demissão iminente',
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function first(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nullableText(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function nullableLabel(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return nullableText(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: unknown, minimum: number, maximum: number, fallback = minimum): number {
  return Math.max(minimum, Math.min(maximum, finiteNumber(value, fallback)));
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  const source = record(value);
  if (!source) return [];
  return Object.entries(source).flatMap(([name, amount]) => {
    if (amount === undefined || amount === null || amount === false || amount === '') return [];
    return [`${name}: ${typeof amount === 'boolean' ? 'sim' : String(amount)}`];
  });
}

function labelList(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = text(value);
    return normalized ? [normalized] : [];
  }
  return list(value).flatMap((item) => {
    if (typeof item === 'string' || typeof item === 'number') {
      const normalized = String(item).trim();
      return normalized ? [normalized] : [];
    }
    const source = record(item);
    const normalized = source
      ? text(first(source.label, source.title, source.name, source.description, source.target))
      : '';
    return normalized ? [normalized] : [];
  });
}

function roleLabel(value: unknown): string {
  const role = text(value, 'head_coach');
  if (role === 'head_coach') return 'Treinador principal';
  if (role === 'interim') return 'Treinador interino';
  return role;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = text(value).toLocaleLowerCase('pt-BR').replace(/[\s-]+/g, '_') as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeClub(value: unknown, fallbackId = ''): CoachClubReference {
  const source = record(value) ?? {};
  const id = text(first(source.id, source.clubId), fallbackId);
  const name = text(first(source.name, source.clubName), id || 'Clube não informado');
  return {
    id,
    name,
    code: text(first(source.code, source.abbreviation, source.acronym), name.slice(0, 3).toUpperCase()),
    country: nullableText(first(source.country, source.countryName)),
    competition: nullableText(first(source.competition, source.league, source.division)),
    reputation: nullableNumber(source.reputation),
    crestImageUrl: nullableText(first(source.crestImageUrl, source.logoUrl, source.imageUrl)),
    primaryColor: nullableText(first(source.primaryColor, source.color, list(source.colors)[0])),
  };
}

function normalizeObjective(value: unknown, index: number): CoachBoardObjective {
  const source = record(value) ?? {};
  const rawStatus = text(source.status, 'pending').toLocaleLowerCase('pt-BR').replace(/[\s-]+/g, '_');
  const status: CoachBoardObjective['status'] = ['pending', 'on_track', 'completed', 'failed'].includes(rawStatus)
    ? rawStatus as CoachBoardObjective['status']
    : 'pending';
  return {
    id: text(source.id, `objective-${index + 1}`),
    label: text(first(source.label, source.name, source.title), 'Objetivo da diretoria'),
    description: nullableText(source.description),
    competition: nullableText(source.competition),
    target: nullableText(first(source.target, source.expectation)),
    progress: source.progress === undefined ? null : clamp(source.progress, 0, 100),
    status,
    weight: nullableNumber(source.weight),
    difficultyAdjustment: nullableNumber(source.difficultyAdjustment),
  };
}

function normalizeTerms(value: unknown): CoachContractTerms {
  const source = record(value) ?? {};
  const durationMonths = nullableNumber(first(source.durationMonths, source.duration, source.contractMonths));
  const contractYears = nullableNumber(first(source.contractYears, source.durationYears, source.years));
  return {
    salary: nullableNumber(first(source.salary, source.wage)),
    durationMonths: durationMonths ?? (contractYears === null ? null : contractYears * 12),
    startDate: nullableText(first(source.startDate, source.startsAt)),
    endDate: nullableText(first(source.endDate, source.endsAt)),
    releaseClause: nullableNumber(first(source.releaseClause, source.terminationClause, source.buyout)),
    transferBudget: nullableNumber(first(source.transferBudget, source.transferBudgetCommitment)),
    autonomyLevel: nullableNumber(source.autonomyLevel),
    objectiveDifficultyAdjustment: nullableNumber(source.objectiveDifficultyAdjustment),
    bonuses: stringList(source.bonuses),
    guarantees: stringList(source.guarantees),
    sportingTargets: labelList(first(source.sportingTargets, source.objectives, source.targets)),
    specialClauses: labelList(first(source.specialClauses, source.clauses)),
  };
}

function normalizeResignationConsequences(value: unknown): CoachResignationConsequences | null {
  const source = record(value);
  if (!source) return null;
  const inactivityDays = nullableNumber(first(source.inactivityDays, source.likelyUnemployedDays));
  const likelyUnemployedDays = nullableNumber(first(source.likelyUnemployedDays, source.inactivityDays));
  const reasonOptions = list(source.reasonOptions).flatMap((value) => {
    const option = record(value);
    const code = text(option?.code);
    if (!option || !code) return [];
    const optionInactivityDays = nullableNumber(first(option.inactivityDays, option.likelyUnemployedDays));
    return [{
      code,
      label: text(first(option.label, option.name), code.replaceAll('_', ' ')),
      justCause: bool(first(option.justCause, option.justCauseVerified)),
      justCauseVerified: bool(option.justCauseVerified),
      financialCost: nullableNumber(first(option.financialCost, option.compensation)),
      reputationDelta: nullableNumber(option.reputationDelta),
      trustDelta: nullableNumber(option.trustDelta),
      likelyUnemployedDays: nullableNumber(first(option.likelyUnemployedDays, option.inactivityDays)),
      inactivityDays: optionInactivityDays,
      restrictionEndsAt: nullableText(option.restrictionEndsAt),
      pendingProjectPenalty: bool(option.pendingProjectPenalty),
      boardReaction: nullableText(option.boardReaction),
      pendingObjectives: labelList(option.pendingObjectives),
    }];
  });
  return {
    financialCost: nullableNumber(first(source.financialCost, source.compensation)),
    reputationDelta: nullableNumber(source.reputationDelta),
    trustDelta: nullableNumber(source.trustDelta),
    likelyUnemployedDays,
    inactivityDays,
    restrictionEndsAt: nullableText(source.restrictionEndsAt),
    reasonCode: text(source.reasonCode, 'personal_reasons'),
    reasonLabel: text(source.reasonLabel, 'Motivos pessoais'),
    justCauseVerified: bool(source.justCauseVerified),
    pendingProjectPenalty: bool(source.pendingProjectPenalty),
    boardReaction: nullableText(source.boardReaction),
    pendingObjectives: labelList(source.pendingObjectives),
    reasonOptions,
  };
}

function normalizeMarketRestriction(value: unknown): CoachMarketRestriction | null {
  const source = record(value);
  if (!source) return null;
  const active = bool(source.active);
  return {
    active,
    type: 'voluntary_resignation',
    startsAt: nullableText(first(source.startsAt, source.startedAt)),
    endsAt: nullableText(first(source.endsAt, source.restrictionEndsAt)),
    remainingDays: Math.max(0, Math.trunc(finiteNumber(source.remainingDays))),
    canInterview: bool(source.canInterview, true),
    canSign: bool(source.canSign, !active),
    reasonCode: text(source.reasonCode, 'coach_resignation'),
    reasonLabel: text(source.reasonLabel, 'Pedido de demissão'),
    justCauseVerified: bool(source.justCauseVerified),
    offersReceived: Math.max(0, Math.trunc(finiteNumber(source.offersReceived))),
  };
}

function normalizeCareerTrust(value: unknown): CoachCareerTrust {
  const source = record(value) ?? (nullableNumber(value) === null ? {} : { score: value });
  const score = clamp(source.score, 0, 100, 80);
  return {
    score,
    voluntaryExitCount: Math.max(0, Math.trunc(finiteNumber(source.voluntaryExitCount))),
    completedContractCount: Math.max(0, Math.trunc(finiteNumber(source.completedContractCount))),
    label: text(source.label, score >= 85 ? 'Muito confiável' : score >= 70 ? 'Confiável' : score >= 50 ? 'Sob observação' : 'Histórico instável'),
  };
}

function normalizeCareerConductEntry(value: unknown, index: number): CoachCareerConductEntry | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id, `coach-conduct-${index + 1}`);
  const clubSource = first(source.club, source.clubId ? { id: source.clubId, name: source.clubName ?? source.clubId } : null);
  return {
    id,
    type: text(first(source.type, source.kind), 'career_event'),
    occurredAt: nullableText(first(source.occurredAt, source.createdAt, source.updatedAt)),
    club: clubSource ? normalizeClub(clubSource, text(source.clubId)) : null,
    reasonCode: nullableText(source.reasonCode),
    reasonLabel: nullableText(source.reasonLabel),
    reputationDelta: finiteNumber(source.reputationDelta),
    reputationBefore: nullableNumber(source.reputationBefore),
    reputationAfter: nullableNumber(source.reputationAfter),
    trustDelta: finiteNumber(source.trustDelta),
    restrictionEndsAt: nullableText(source.restrictionEndsAt),
  };
}

function normalizeContract(value: unknown): CoachContract | null {
  const source = record(value);
  if (!source) return null;
  const clubId = text(first(source.clubId, record(source.club)?.id));
  const id = text(source.id);
  if (!id || !clubId) return null;
  const rawStatus = text(source.status).toLocaleLowerCase('pt-BR');
  return {
    id,
    coachId: text(source.coachId),
    clubId,
    club: source.club ? normalizeClub(source.club, clubId) : null,
    role: roleLabel(source.role),
    status: enumValue(rawStatus === 'replaced' ? 'superseded' : rawStatus, contractStatuses, 'active'),
    ...normalizeTerms(first(source.terms, source)),
    objectives: list(source.objectives).map(normalizeObjective),
    renewalOption: bool(source.renewalOption),
    sourceInterviewId: nullableText(first(source.sourceInterviewId, source.interviewId)),
    terminationReason: nullableText(first(source.terminationReason, source.endReason)),
    createdAt: nullableText(first(source.createdAt, source.signedAt)),
    updatedAt: nullableText(source.updatedAt),
  };
}

function normalizeEmployment(value: unknown, contracts: CoachContract[]): CoachEmployment | null {
  const source = record(value);
  if (!source) return null;
  const clubSource = first(source.club, { id: source.clubId, name: source.clubName });
  const club = normalizeClub(clubSource, text(source.clubId));
  const id = text(source.id);
  if (!id || !club.id) return null;
  const contractId = nullableText(source.contractId);
  const contract = normalizeContract(source.contract)
    ?? contracts.find((item) => item.id === contractId || (item.clubId === club.id && item.status === 'active'))
    ?? null;
  return {
    id,
    coachId: text(source.coachId),
    clubId: club.id,
    club,
    role: roleLabel(source.role),
    status: enumValue(source.status, employmentStatuses, 'employed'),
    hiredAt: nullableText(first(source.hiredAt, source.appointedAt)),
    startsAt: nullableText(first(source.startsAt, source.startDate)),
    endsAt: nullableText(first(source.endsAt, source.endDate)),
    entryReason: nullableText(source.entryReason),
    exitReason: nullableText(source.exitReason),
    contractId: contractId ?? contract?.id ?? null,
    contract,
    objectives: list(first(source.objectives, contract?.objectives)).map(normalizeObjective),
    resignationConsequences: normalizeResignationConsequences(first(source.resignationConsequences, source.resignationPreview)),
  };
}

function normalizeSecurity(value: unknown): CoachJobSecurity | null {
  const source = record(value);
  if (!source) return null;
  const level = enumValue(source.level, securityLevels, 'stable');
  const normalizeTrend = (trend: unknown) => enumValue(trend, securityTrends, 'stable');
  const factors: CoachJobSecurityFactor[] = list(source.factors).map((value, index) => {
    const factor = record(value) ?? {};
    const impact = finiteNumber(factor.impact, 0);
    const rawTone = text(factor.tone).toLocaleLowerCase('pt-BR');
    return {
      id: text(factor.id, `factor-${index + 1}`),
      label: text(first(factor.label, factor.title), 'Avaliação da diretoria'),
      detail: nullableText(factor.detail),
      impact,
      tone: rawTone === 'positive' || rawTone === 'negative' || rawTone === 'neutral'
        ? rawTone
        : impact > 0 ? 'positive' : impact < 0 ? 'negative' : 'neutral',
    };
  });
  const trendSource = record(source.trend);
  const trend = trendSource ? {
    direction: normalizeTrend(trendSource.direction),
    delta: finiteNumber(trendSource.delta),
    label: text(trendSource.label, 'Estável'),
  } : null;
  const fanSource = record(source.fanSupport);
  const fanSupport = fanSource ? {
    value: clamp(fanSource.value, 0, 100, 50),
    state: text(fanSource.state, 'stable'),
    label: text(fanSource.label, 'Apoio moderado'),
    trend: normalizeTrend(fanSource.trend),
  } : null;
  const boardSource = record(source.boardSupport);
  const privateEstimateSource = record(boardSource?.privateEstimate);
  const privateEstimateMin = clamp(privateEstimateSource?.min, 0, 100, 0);
  const privateEstimateMax = clamp(privateEstimateSource?.max, 0, 100, 100);
  const boardSupport = boardSource ? {
    publicValue: clamp(boardSource.publicValue, 0, 100, 50),
    publicState: text(boardSource.publicState, 'stable'),
    publicLabel: text(boardSource.publicLabel, 'Apoio institucional'),
    privateEstimate: privateEstimateSource ? {
      min: Math.min(privateEstimateMin, privateEstimateMax),
      max: Math.max(privateEstimateMin, privateEstimateMax),
      label: text(privateEstimateSource.label, 'Estimativa indisponível'),
      source: text(privateEstimateSource.source, 'Análise interna'),
    } : null,
  } : null;
  const classicsSource = record(source.classics);
  const classics = classicsSource ? {
    played: Math.max(0, Math.round(finiteNumber(classicsSource.played))),
    wins: Math.max(0, Math.round(finiteNumber(classicsSource.wins))),
    draws: Math.max(0, Math.round(finiteNumber(classicsSource.draws))),
    losses: Math.max(0, Math.round(finiteNumber(classicsSource.losses))),
    winlessStreak: Math.max(0, Math.round(finiteNumber(classicsSource.winlessStreak))),
    heavyLosses: Math.max(0, Math.round(finiteNumber(classicsSource.heavyLosses))),
    eliminations: Math.max(0, Math.round(finiteNumber(classicsSource.eliminations))),
    impact: finiteNumber(classicsSource.impact),
  } : null;
  const relegationSource = record(source.relegation);
  const relegation = relegationSource ? {
    risk: clamp(relegationSource.risk, 0, 100),
    state: text(relegationSource.state, 'safe'),
    label: text(relegationSource.label, 'Sem risco imediato'),
    inZone: bool(relegationSource.inZone),
    consecutiveRounds: Math.max(0, Math.round(finiteNumber(relegationSource.consecutiveRounds))),
    confirmed: bool(relegationSource.confirmed),
    survivalSecured: bool(relegationSource.survivalSecured),
  } : null;
  const creditSource = record(source.accumulatedCredit);
  const accumulatedCredit = creditSource ? {
    value: clamp(creditSource.value, 0, 100, 50),
    label: text(creditSource.label, 'Crédito moderado'),
    delta: finiteNumber(creditSource.delta),
  } : null;
  const dimensions = list(source.dimensions).flatMap((value, index) => {
    const dimension = record(value);
    if (!dimension) return [];
    return [{
      id: text(dimension.id, `dimension-${index + 1}`),
      label: text(dimension.label, 'Dimensão avaliada'),
      value: clamp(dimension.value, 0, 100, 50),
      weight: Math.max(0, finiteNumber(dimension.weight)),
      trend: normalizeTrend(dimension.trend),
      justification: nullableText(dimension.justification),
      updatedAt: nullableText(dimension.updatedAt),
    }];
  });
  const activeUltimatums = list(source.activeUltimatums).flatMap((value, index) => {
    const ultimatum = record(value);
    if (!ultimatum) return [];
    return [{
      id: text(ultimatum.id, `ultimatum-${index + 1}`),
      status: text(ultimatum.status, 'active'),
      title: text(ultimatum.title, 'Ultimato da diretoria'),
      objective: text(ultimatum.objective, 'Recuperar o desempenho'),
      deadlineRound: nullableNumber(ultimatum.deadlineRound),
      progress: clamp(ultimatum.progress, 0, 100),
      consequence: text(ultimatum.consequence, 'O vínculo será reavaliado.'),
    }];
  });
  const recentHistory = list(source.recentHistory).flatMap((value, index) => {
    const entry = record(value);
    if (!entry) return [];
    const previousLevel = nullableText(entry.previousLevel);
    return [{
      id: text(entry.id, `security-history-${index + 1}`),
      occurredAt: nullableText(entry.occurredAt),
      previousLevel: previousLevel && securityLevels.includes(previousLevel as CoachJobSecurityLevel)
        ? previousLevel as CoachJobSecurityLevel
        : null,
      newLevel: enumValue(entry.newLevel, securityLevels, level),
      previousScore: nullableNumber(entry.previousScore),
      newScore: clamp(entry.newScore, 0, 100, 50),
      decision: text(entry.decision, 'Reavaliação da diretoria'),
    }];
  });
  return {
    score: clamp(first(source.score, source.value), 0, 100, 50),
    level,
    label: text(source.label, securityLabels[level]),
    updatedAt: nullableText(source.updatedAt),
    factors,
    trend,
    fanSupport,
    boardSupport,
    classics,
    relegation,
    accumulatedCredit,
    dimensions,
    activeUltimatums,
    recentHistory,
  };
}

function normalizeGuaranteeEffect(value: unknown, index: number): CoachGuaranteeEffect | null {
  if (typeof value === 'string') {
    return { id: `effect-${index + 1}`, type: 'note', label: value, description: null, value: null, applied: false };
  }
  const source = record(value);
  if (!source) return null;
  const rawValue = first(source.value, source.amount, source.enabled);
  const effectValue = typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
    ? rawValue
    : null;
  return {
    id: text(source.id, `effect-${index + 1}`),
    type: text(first(source.type, source.kind), 'action'),
    label: text(first(source.label, source.title, source.description), 'Efeito acordado'),
    description: nullableText(source.description),
    value: effectValue,
    applied: bool(first(source.applied, source.completed, source.active)),
  };
}

function normalizeGuarantee(value: unknown, index: number): CoachStructuredGuarantee | null {
  if (typeof value === 'string') {
    return {
      id: `legacy-guarantee-${index + 1}`,
      description: value,
      responsibleId: null,
      responsibleName: null,
      dueAt: null,
      status: 'requested',
      required: false,
      blocksCompletion: false,
      effects: [],
      createdAt: null,
      updatedAt: null,
    };
  }
  const source = record(value);
  if (!source) return null;
  const description = text(first(source.description, source.text, source.label, source.guarantee));
  if (!description) return null;
  const responsible = record(source.responsible) ?? {};
  const required = bool(first(source.required, source.mandatory, source.obligatory));
  return {
    id: text(source.id, `guarantee-${index + 1}`),
    description,
    responsibleId: nullableText(first(source.responsibleId, responsible.id)),
    responsibleName: nullableText(first(source.responsibleName, responsible.name, responsible.label, typeof source.responsible === 'string' ? source.responsible : null)),
    dueAt: nullableText(first(source.dueAt, source.deadline, source.expiresAt)),
    status: enumValue(source.status, guaranteeStatuses, 'requested'),
    required,
    blocksCompletion: bool(first(source.blocksCompletion, source.blocking), required),
    effects: list(first(source.effects, source.actions)).flatMap((effect, effectIndex) => {
      const normalized = normalizeGuaranteeEffect(effect, effectIndex);
      return normalized ? [normalized] : [];
    }),
    createdAt: nullableText(first(source.createdAt, source.requestedAt)),
    updatedAt: nullableText(source.updatedAt),
  };
}

function normalizeInformationRequest(value: unknown): CoachProposalInformationRequest | null {
  if (typeof value === 'string' && value.trim()) {
    return { id: 'information-request', question: value.trim(), requestedBy: null, requestedAt: null, response: null, respondedAt: null };
  }
  const source = record(value);
  if (!source) return null;
  const question = text(first(source.question, source.message, source.request));
  if (!question) return null;
  const requestedBy = record(source.requestedBy);
  return {
    id: text(source.id, 'information-request'),
    question,
    requestedBy: nullableText(first(source.requestedByName, requestedBy?.name, typeof source.requestedBy === 'string' ? source.requestedBy : null)),
    requestedAt: nullableText(first(source.requestedAt, source.createdAt)),
    response: nullableText(first(source.response, source.answer)),
    respondedAt: nullableText(source.respondedAt),
  };
}

function normalizeAvailableActions(value: unknown, status: CoachProposalStatus, source: UnknownRecord): CoachProposalAvailableActions {
  const actions = record(value) ?? {};
  const actionSet = new Set(stringList(value).map((action) => action.toLocaleLowerCase('pt-BR').replace(/[\s-]+/g, '_')));
  const defaultCandidateResponse = status === 'pending' || status === 'aprovada_diretoria';
  const explicit = (names: string[], fallback: boolean) => {
    const candidate = first(...names.flatMap((name) => [actions[name], source[name]]));
    if (candidate !== undefined && candidate !== null) return bool(candidate);
    if (actionSet.size) return names.some((name) => actionSet.has(name.toLocaleLowerCase('pt-BR').replace(/[\s-]+/g, '_')));
    return fallback;
  };
  return {
    accept: explicit(['accept', 'canAccept'], defaultCandidateResponse),
    reject: explicit(['reject', 'canReject'], defaultCandidateResponse),
    counter: explicit(['counter', 'negotiate', 'canCounter', 'canNegotiate'], defaultCandidateResponse),
    requestMoreTime: explicit(['requestMoreTime', 'request_more_time', 'extend', 'canRequestMoreTime'], defaultCandidateResponse),
    withdraw: explicit(['withdraw', 'end', 'canWithdraw'], ['countered', 'aguardando_resposta_diretoria', 'informacoes_solicitadas'].includes(status)),
    provideInformation: explicit(['provideInformation', 'provide_information', 'answer_information'], status === 'informacoes_solicitadas'),
  };
}

function normalizeDecision(value: unknown, index: number): CoachProposalDecisionLog | null {
  const source = record(value);
  if (!source) return null;
  const actor = record(first(source.actor, source.responsible)) ?? {};
  const termsSource = record(first(source.terms, source.negotiatedTerms, source.conditions));
  return {
    id: text(source.id, `decision-${index + 1}`),
    action: text(first(source.action, source.decision, source.type), 'status_updated'),
    actorId: nullableText(first(source.actorId, source.responsibleId, actor.id)),
    actorName: nullableText(first(source.actorName, source.responsibleName, source.responsible, actor.name)),
    actorRole: nullableText(first(source.actorRole, source.responsibleRole, actor.role)),
    justification: nullableText(first(source.justification, source.reason, source.message)),
    previousStatus: nullableText(first(source.previousStatus, source.fromStatus)),
    newStatus: text(first(source.newStatus, source.toStatus, source.status), 'pending'),
    terms: termsSource ? normalizeTerms(termsSource) : null,
    createdAt: nullableText(first(source.createdAt, source.decidedAt, source.timestamp)),
  };
}

function normalizeProposal(value: unknown): CoachProposal | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id);
  const club = normalizeClub(first(source.club, { id: source.clubId, name: source.clubName }), text(source.clubId));
  if (!id || !club.id) return null;
  const status = enumValue(source.status, proposalStatuses, 'pending');
  const terms = normalizeTerms(first(source.terms, source));
  const termsSource = record(source.terms);
  const structuredSource = list(first(source.guarantees, source.structuredGuarantees, termsSource?.guarantees));
  const guarantees = (structuredSource.length ? structuredSource : terms.guarantees).flatMap((guarantee, index) => {
    const normalized = normalizeGuarantee(guarantee, index);
    return normalized ? [normalized] : [];
  });
  const availableActions = normalizeAvailableActions(source.availableActions, status, source);
  return {
    id,
    vacancyId: nullableText(source.vacancyId),
    interviewId: nullableText(source.interviewId),
    kind: enumValue(first(source.kind, source.proposalType, source.sourceContractId ? 'renewal' : 'hiring'), proposalKinds, 'hiring'),
    sourceContractId: nullableText(first(source.sourceContractId, source.renewalOfContractId)),
    club,
    role: roleLabel(source.role),
    status,
    terms,
    objectives: list(source.objectives).map(normalizeObjective),
    availableBudget: nullableNumber(first(source.availableBudget, source.budget)),
    boardExpectation: nullableText(first(source.boardExpectation, source.expectation)),
    clubSituation: nullableText(source.clubSituation),
    deadline: nullableText(first(source.deadline, source.expiresAt)),
    proposedStartDate: nullableText(first(source.proposedStartDate, source.plannedStartDate, source.startDate)),
    compensationToCurrentClub: nullableNumber(first(source.compensationToCurrentClub, source.compensation)),
    message: nullableText(source.message),
    negotiationRound: Math.max(0, Math.trunc(finiteNumber(source.negotiationRound))),
    marketStage: enumValue(source.marketStage, marketStages, 'coach_review'),
    nextActionAt: nullableText(source.nextActionAt),
    lastActionAt: nullableText(first(source.lastActionAt, source.updatedAt, source.createdAt)),
    maxNegotiationRounds: Math.max(1, Math.trunc(finiteNumber(source.maxNegotiationRounds, 4))),
    interviewCompatibility: nullableNumber(source.interviewCompatibility),
    autonomyDelta: clamp(source.autonomyDelta, -20, 20, 0),
    priorityDelta: clamp(source.priorityDelta, -25, 25, 0),
    objectiveDifficultyDelta: clamp(source.objectiveDifficultyDelta, -15, 15, 0),
    decisionScore: nullableNumber(source.decisionScore),
    decisionReason: nullableText(first(source.decisionReason, source.responseReason)),
    decisionFactors: list(source.decisionFactors).map((factor, index) => {
      const item = record(factor) ?? {};
      return {
        id: text(first(item.id, item.code), `factor-${index + 1}`),
        code: text(item.code, 'general'),
        label: text(first(item.label, item.code), `Fator ${index + 1}`),
        value: finiteNumber(first(item.value, item.impact)),
        detail: nullableText(first(item.detail, item.description)),
      };
    }),
    competingOfferCount: Math.max(0, Math.trunc(finiteNumber(first(source.competingOfferCount, list(source.competingProposalIds).length)))),
    informationRequest: normalizeInformationRequest(first(source.informationRequest, source.requestedInformation)),
    availableActions,
    guarantees,
    decisionHistory: list(first(source.decisionHistory, source.decisions, source.auditTrail)).flatMap((decision, index) => {
      const normalized = normalizeDecision(decision, index);
      return normalized ? [normalized] : [];
    }),
    canNegotiate: availableActions.counter,
    canRequestMoreTime: availableActions.requestMoreTime,
    createdAt: nullableText(source.createdAt),
    updatedAt: nullableText(source.updatedAt),
  };
}

function normalizedTextList(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = text(value);
    return normalized ? [normalized] : [];
  }
  return list(value).map((item) => text(item)).filter(Boolean);
}

function normalizeDesiredCoachProfile(value: unknown): CoachVacancyDesiredProfile | null {
  const source = record(value);
  if (!source) return null;
  const license = record(source.license) ?? {};
  const experience = record(source.experience) ?? {};
  const geography = record(source.geography) ?? {};
  const salary = record(source.salary) ?? {};
  const achievements = record(source.achievements) ?? {};
  const playingStyle = record(source.playingStyle) ?? {};
  const squad = record(source.squad) ?? {};
  const countryKnowledge = record(source.countryKnowledge) ?? {};
  const weightSource = record(source.weights) ?? {};
  const weights = Object.fromEntries(Object.entries(weightSource).flatMap(([code, rawValue]) => {
    const value = nullableNumber(rawValue);
    return code && value !== null ? [[code, Math.max(0, value)]] : [];
  }));
  return {
    version: Math.max(1, Math.trunc(finiteNumber(source.version, 1))),
    revision: Math.max(1, Math.trunc(finiteNumber(source.revision, 1))),
    tier: text(source.tier, 'established'),
    strictness: text(source.strictness, 'balanced'),
    license: {
      minimum: text(first(license.minimum, source.licenseTier), 'B'),
      allowEquivalent: bool(license.allowEquivalent, true),
      acceptedEquivalent: normalizedTextList(first(license.acceptedEquivalent, source.equivalentLicenses)),
    },
    experience: {
      minimumYears: Math.max(0, finiteNumber(experience.minimumYears)),
      youthYears: Math.max(0, finiteNumber(experience.youthYears)),
      professionalYears: Math.max(0, finiteNumber(experience.professionalYears)),
      internationalYears: Math.max(0, finiteNumber(experience.internationalYears)),
      currentDivisionYears: Math.max(0, finiteNumber(experience.currentDivisionYears)),
    },
    geography: {
      country: nullableText(geography.country),
      preferredNationality: nullableText(geography.preferredNationality),
      acceptedNationalities: normalizedTextList(geography.acceptedNationalities),
      requiredLanguage: nullableText(geography.requiredLanguage),
      acceptedLanguages: normalizedTextList(geography.acceptedLanguages),
      regionalExperiencePreferred: bool(geography.regionalExperiencePreferred, true),
    },
    salary: {
      minimum: Math.max(0, finiteNumber(salary.minimum)),
      ideal: Math.max(0, finiteNumber(salary.ideal)),
      maximum: Math.max(0, finiteNumber(salary.maximum)),
      flexibility: clamp(salary.flexibility, 0, 1, 0.25),
    },
    achievements: {
      minimumNationalTitles: Math.max(0, Math.trunc(finiteNumber(achievements.minimumNationalTitles))),
      minimumCups: Math.max(0, Math.trunc(finiteNumber(achievements.minimumCups))),
      minimumContinentalTitles: Math.max(0, Math.trunc(finiteNumber(achievements.minimumContinentalTitles))),
      minimumPromotions: Math.max(0, Math.trunc(finiteNumber(achievements.minimumPromotions))),
      prioritizeYouthDevelopment: bool(achievements.prioritizeYouthDevelopment),
      prioritizeLeagueSurvival: bool(achievements.prioritizeLeagueSurvival),
    },
    playingStyle: {
      preferred: normalizedTextList(first(playingStyle.preferred, source.style, source.playStyle)),
      accepted: normalizedTextList(playingStyle.accepted),
      preferredFormation: nullableText(first(playingStyle.preferredFormation, source.preferredFormation)),
      acceptedFormations: normalizedTextList(playingStyle.acceptedFormations),
      trainingIntensity: text(playingStyle.trainingIntensity, 'normal'),
      youthUsage: text(playingStyle.youthUsage, 'balanced'),
    },
    squad: {
      playerCount: Math.max(0, Math.trunc(finiteNumber(squad.playerCount))),
      averageAge: Math.max(0, finiteNumber(squad.averageAge)),
      averageOverall: clamp(squad.averageOverall, 0, 100, 50),
      averagePotential: clamp(squad.averagePotential, 0, 100, 50),
      youngTalentCount: Math.max(0, Math.trunc(finiteNumber(squad.youngTalentCount))),
      youthShare: clamp(squad.youthShare, 0, 1),
      predominantFormation: text(squad.predominantFormation, '4-3-3'),
      attackingScore: clamp(squad.attackingScore, 0, 100, 50),
      defendingScore: clamp(squad.defendingScore, 0, 100, 50),
      paceScore: clamp(squad.paceScore, 0, 100, 50),
      possessionScore: clamp(squad.possessionScore, 0, 100, 50),
      rebuilding: bool(squad.rebuilding),
    },
    countryKnowledge: {
      minimum: clamp(countryKnowledge.minimum, 0, 100, 30),
      priorWorkPreferred: bool(countryKnowledge.priorWorkPreferred, true),
      languageRequired: bool(countryKnowledge.languageRequired),
    },
    weights,
    objective: nullableText(source.objective),
    availableBudget: nullableNumber(source.availableBudget),
    squadSummary: nullableText(source.squadSummary),
    reason: nullableText(source.reason),
    generatedAt: nullableText(source.generatedAt),
  };
}

function normalizeCandidateAssessment(value: unknown): CoachCandidateAssessment | null {
  const source = record(value);
  if (!source) return null;
  const factors = list(source.factors).flatMap((rawFactor) => {
    const factor = record(rawFactor);
    if (!factor) return [];
    const code = text(factor.code);
    if (!code) return [];
    return [{
      code,
      label: text(first(factor.label, factor.code), code),
      weight: Math.max(0, finiteNumber(factor.weight)),
      rawScore: clamp(factor.rawScore, 0, 100, 0),
      weightedScore: finiteNumber(factor.weightedScore),
      detail: nullableText(factor.detail),
    }];
  });
  const hardBlockers = list(source.hardBlockers).flatMap((rawBlocker) => {
    if (typeof rawBlocker === 'string') {
      const code = text(rawBlocker);
      return code ? [{ code, label: code, detail: null }] : [];
    }
    const blocker = record(rawBlocker);
    if (!blocker) return [];
    const code = text(blocker.code);
    return code ? [{
      code,
      label: text(first(blocker.label, blocker.code), code),
      detail: nullableText(blocker.detail),
    }] : [];
  });
  return {
    eligible: bool(source.eligible, hardBlockers.length === 0),
    score: clamp(source.score, 0, 100),
    factors,
    hardBlockers,
    profileVersion: Math.max(1, Math.trunc(finiteNumber(source.profileVersion, 1))),
    evaluatedAt: nullableText(source.evaluatedAt),
  };
}

function normalizeVacancy(value: unknown): CoachVacancy | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id);
  const club = normalizeClub(first(source.club, { id: source.clubId, name: source.clubName }), text(source.clubId));
  if (!id || !club.id) return null;
  return {
    id,
    club,
    status: enumValue(source.status, vacancyStatuses, 'open'),
    marketStage: enumValue(source.marketStage, marketStages, 'interest'),
    shortlistCount: Math.max(0, Math.trunc(finiteNumber(first(source.shortlistCount, list(source.shortlistCoachIds).length)))),
    searchStartedAt: nullableText(first(source.searchStartedAt, source.openedAt, source.createdAt)),
    lastMarketActionAt: nullableText(source.lastMarketActionAt),
    competition: nullableText(first(source.competition, club.competition)),
    country: nullableText(first(source.country, club.country)),
    financialSituation: nullableText(source.financialSituation),
    currentPosition: nullableText(source.currentPosition),
    objective: nullableText(source.objective),
    availableBudget: nullableNumber(first(source.availableBudget, source.budget)),
    squadSummary: nullableText(first(source.squadSummary, source.squad)),
    reason: nullableText(source.reason),
    deadline: nullableText(first(source.deadline, source.applicationDeadline, source.closesAt)),
    interestLevel: nullableNumber(first(source.interestLevel, source.interest)),
    applicationId: nullableText(source.applicationId),
    desiredProfile: normalizeDesiredCoachProfile(source.desiredProfile),
    createdAt: nullableText(first(source.createdAt, source.openedAt)),
  };
}

function normalizeApplication(value: unknown): CoachApplication | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id);
  const vacancyId = text(source.vacancyId);
  if (!id || !vacancyId) return null;
  return {
    id,
    vacancyId,
    club: source.club ? normalizeClub(source.club, text(source.clubId)) : null,
    status: enumValue(source.status, applicationStatuses, 'submitted'),
    message: nullableText(source.message),
    submittedAt: nullableText(first(source.submittedAt, source.createdAt)),
    updatedAt: nullableText(source.updatedAt),
    feedback: nullableText(first(source.feedback, source.responseReason)),
    closedAt: nullableText(first(source.closedAt, source.endedAt)),
    closureReason: nullableText(first(source.closureReason, source.closeReason)),
    closedBy: nullableText(first(source.closedBy, source.closedByName)),
    candidateAssessment: normalizeCandidateAssessment(source.candidateAssessment),
  };
}

function normalizeInterview(value: unknown): CoachInterview | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id);
  const club = normalizeClub(first(source.club, { id: source.clubId, name: source.clubName }), text(source.clubId));
  if (!id || !club.id) return null;
  const rawDepth = text(source.depth).toLocaleLowerCase('pt-BR');
  const depth: CoachInterviewDepth = rawDepth === 'quick' || rawDepth === 'deep' ? rawDepth : 'standard';
  const questions = list(source.questions).flatMap((value, index) => {
    const question = record(value);
    if (!question) return [];
    const questionId = text(question.id, `question-${index + 1}`);
    const options = list(first(question.options, question.answerOptions, question.answers)).flatMap((option, optionIndex) => {
      const optionSource = record(option);
      if (typeof option === 'string') return [{ id: `option-${optionIndex + 1}`, label: option }];
      if (!optionSource) return [];
      return [{ id: text(optionSource.id, `option-${optionIndex + 1}`), label: text(first(optionSource.label, optionSource.text), `Opção ${optionIndex + 1}`) }];
    });
    return [{
      id: questionId,
      prompt: text(first(question.prompt, question.question, question.text), 'Pergunta da diretoria'),
      helpText: nullableText(question.helpText),
      type: question.type === 'text' || options.length === 0 ? 'text' as const : 'choice' as const,
      options,
    }];
  });
  const answers: CoachInterviewAnswer[] = list(source.answers).flatMap((value) => {
    const answer = record(value);
    const questionId = text(answer?.questionId);
    if (!answer || !questionId) return [];
    return [{ questionId, optionId: nullableText(answer.optionId) ?? undefined, text: nullableText(answer.text) ?? undefined }];
  });
  const transcript = list(first(source.transcript, source.messages)).flatMap((value, index) => {
    const entry = record(value);
    if (!entry) return [];
    const rawRole = text(first(entry.role, entry.authorRole)).toLocaleLowerCase('pt-BR');
    const role = ['coach', 'candidate', 'manager', 'user'].includes(rawRole) ? 'coach' as const : 'board' as const;
    const entryText = text(first(entry.text, entry.message, entry.content));
    if (!entryText) return [];
    return [{
      id: text(entry.id, `interview-message-${index + 1}`),
      questionId: nullableText(entry.questionId),
      role,
      text: entryText,
      topic: nullableText(entry.topic),
      createdAt: nullableText(first(entry.createdAt, entry.sentAt, entry.timestamp)),
      turn: Math.max(0, Math.trunc(finiteNumber(first(entry.turn, entry.turnNumber), index + 1))),
    }];
  });
  const rawMode = text(source.mode).toLocaleLowerCase('pt-BR');
  const rawSource = text(first(source.source, source.provider)).toLocaleLowerCase('pt-BR');
  const mode: CoachInterview['mode'] = rawMode === 'fallback' || rawSource === 'fallback'
    ? 'fallback'
    : rawMode === 'generative' || rawMode === 'dynamic' || transcript.length > 0
      ? 'generative'
      : 'legacy';
  const interviewSource: CoachInterview['source'] = rawSource === 'gemini' || rawSource === 'fallback' || rawSource === 'legacy'
    ? rawSource
    : mode === 'legacy' ? 'legacy' : null;
  const evaluationSource = record(source.evaluation);
  const metricSource = record(evaluationSource?.metrics) ?? {};
  const metric = (name: string, ...aliases: unknown[]) => clamp(first(metricSource[name], ...aliases), 0, 100, 0);
  const recommendationValues = ['hire', 'hire_with_reservations', 'negotiate', 'observe', 'reject'] as const;
  const evaluation: CoachInterview['evaluation'] = evaluationSource ? {
    overallScore: clamp(first(evaluationSource.overallScore, evaluationSource.overall, source.compatibility), 0, 100, 0),
    metrics: {
      boardConfidence: metric('boardConfidence', evaluationSource.boardConfidence),
      clubCompatibility: metric('clubCompatibility', evaluationSource.clubCompatibility),
      squadCompatibility: metric('squadCompatibility', evaluationSource.squadCompatibility),
      leadership: metric('leadership', evaluationSource.leadership),
      tacticalVision: metric('tacticalVision', evaluationSource.tacticalVision),
      financialAlignment: metric('financialAlignment', evaluationSource.financialAlignment),
      longTermPotential: metric('longTermPotential', evaluationSource.longTermPotential),
      culturalFit: metric('culturalFit', evaluationSource.culturalFit),
      credibility: metric('credibility', evaluationSource.credibility),
      perceivedRisk: metric('perceivedRisk', evaluationSource.perceivedRisk),
    },
    strengths: labelList(evaluationSource.strengths),
    risks: labelList(evaluationSource.risks),
    recommendation: enumValue(evaluationSource.recommendation, recommendationValues, 'observe'),
    summary: nullableText(evaluationSource.summary),
    generatedAt: nullableText(first(evaluationSource.generatedAt, evaluationSource.createdAt)),
  } : null;
  const relationshipSource = record(first(source.relationshipImpact, evaluationSource?.relationshipImpact));
  const relationshipImpact: CoachInterview['relationshipImpact'] = relationshipSource ? {
    boardConfidenceDelta: clamp(relationshipSource.boardConfidenceDelta, -20, 20, 0),
    credibilityDelta: clamp(relationshipSource.credibilityDelta, -20, 20, 0),
    strategicAlignmentDelta: clamp(relationshipSource.strategicAlignmentDelta, -20, 20, 0),
    culturalCompatibilityDelta: clamp(relationshipSource.culturalCompatibilityDelta, -20, 20, 0),
    perceivedRiskDelta: clamp(relationshipSource.perceivedRiskDelta, -20, 20, 0),
    expectedTenureDelta: clamp(relationshipSource.expectedTenureDelta, -20, 20, 0),
  } : null;
  const negotiationSource = record(first(source.negotiationEffects, evaluationSource?.negotiationEffects));
  const negotiationEffects: CoachInterview['negotiationEffects'] = negotiationSource ? {
    salaryMultiplier: clamp(negotiationSource.salaryMultiplier, 0.85, 1.15, 1),
    durationYearsDelta: clamp(first(negotiationSource.durationYearsDelta, negotiationSource.contractYearsDelta), -1, 2, 0),
    signingBonusMultiplier: clamp(first(negotiationSource.signingBonusMultiplier, negotiationSource.bonusMultiplier), 0, 2, 1),
    performanceBonusMultiplier: clamp(first(negotiationSource.performanceBonusMultiplier, negotiationSource.bonusMultiplier), 0, 2, 1),
    terminationClauseMultiplier: clamp(negotiationSource.terminationClauseMultiplier, 0.5, 1.5, 1),
    transferBudgetMultiplier: clamp(negotiationSource.transferBudgetMultiplier, 0.75, 1.25, 1),
    autonomyDelta: clamp(negotiationSource.autonomyDelta, -20, 20, 0),
    priorityDelta: clamp(negotiationSource.priorityDelta, -25, 25, 0),
    objectiveDifficultyDelta: clamp(negotiationSource.objectiveDifficultyDelta, -15, 15, 0),
    terminateNegotiation: Boolean(negotiationSource.terminateNegotiation),
    objectives: labelList(negotiationSource.objectives),
    specialClauses: labelList(negotiationSource.specialClauses),
  } : null;
  const defaultTurns = depth === 'quick' ? { min: 3, max: 5 } : depth === 'deep' ? { min: 8, max: 12 } : { min: 5, max: 8 };
  const minTurns = Math.max(1, Math.trunc(finiteNumber(source.minTurns, defaultTurns.min)));
  const maxTurns = Math.max(minTurns, Math.trunc(finiteNumber(source.maxTurns, defaultTurns.max)));
  return {
    id,
    vacancyId: nullableText(source.vacancyId),
    proposalId: nullableText(source.proposalId),
    club,
    status: enumValue(source.status, interviewStatuses, 'scheduled'),
    scheduledAt: nullableText(source.scheduledAt),
    deadline: nullableText(first(source.deadline, source.expiresAt)),
    questions,
    answers,
    mode,
    depth,
    source: interviewSource,
    transcript,
    currentQuestionId: nullableText(first(source.currentQuestionId, record(source.currentQuestion)?.id)),
    turnCount: Math.max(0, Math.trunc(finiteNumber(source.turnCount, transcript.filter((entry) => entry.role === 'coach').length))),
    minTurns,
    maxTurns,
    revision: Math.max(0, Math.trunc(finiteNumber(source.revision))),
    memorySummary: nullableText(source.memorySummary),
    evaluation,
    relationshipImpact,
    negotiationEffects,
    compatibility: nullableNumber(first(source.compatibility, source.compatibilityScore)),
    outcome: nullableText(source.outcome),
    updatedAt: nullableText(first(source.updatedAt, evaluation?.generatedAt, transcript.at(-1)?.createdAt)),
  };
}

function normalizeAssignment(value: unknown, index: number): CoachEmploymentHistoryEntry | null {
  const source = record(value);
  if (!source) return null;
  const club = normalizeClub(first(source.club, { id: source.clubId, name: source.clubName }), text(source.clubId));
  if (!club.id) return null;
  return {
    id: text(source.id, `assignment-${index + 1}`),
    club,
    role: roleLabel(source.role),
    status: enumValue(source.status, employmentStatuses, source.endedAt ? 'unemployed' : 'employed'),
    startedAt: nullableText(first(source.startedAt, source.startDate, source.hiredAt)),
    endedAt: nullableText(first(source.endedAt, source.endDate)),
    entryReason: nullableText(source.entryReason),
    exitReason: nullableText(source.exitReason),
    matches: nullableNumber(source.matches),
    wins: nullableNumber(source.wins),
    draws: nullableNumber(source.draws),
    losses: nullableNumber(source.losses),
    titles: stringList(source.titles),
  };
}

function normalizeOptionalClub(value: unknown): CoachClubReference | null {
  const source = record(value);
  if (!source) return null;
  const club = normalizeClub(value);
  return club.id || text(first(source.name, source.clubName)) ? club : null;
}

function normalizeCareerMetrics(value: unknown): CoachCareerHistoryMetrics {
  const source = record(value) ?? {};
  return {
    matches: nullableNumber(first(source.matches, source.games, source.played)),
    wins: nullableNumber(source.wins),
    draws: nullableNumber(source.draws),
    losses: nullableNumber(source.losses),
    goalsFor: nullableNumber(first(source.goalsFor, source.gf, source.scored)),
    goalsAgainst: nullableNumber(first(source.goalsAgainst, source.ga, source.conceded)),
    goalDifference: nullableNumber(first(source.goalDifference, source.gd)),
    points: nullableNumber(source.points),
    pointsPerGame: nullableNumber(first(source.pointsPerGame, source.ppg)),
    winRate: nullableNumber(first(source.winRate, source.winPercentage)),
    longestWinningStreak: nullableNumber(first(source.longestWinningStreak, source.maxWinningStreak, source.bestWinStreak)),
    longestWinlessStreak: nullableNumber(first(source.longestWinlessStreak, source.maxWinlessStreak, source.worstWinlessStreak)),
  };
}

function normalizeCareerContract(value: unknown, index: number): CoachCareerHistoryContract | null {
  const source = record(value);
  if (!source) return null;
  return {
    id: text(source.id, `career-contract-${index + 1}`),
    startDate: nullableText(first(source.startDate, source.startedAt)),
    endDate: nullableText(first(source.endDate, source.endsAt)),
    endedAt: nullableText(first(source.endedAt, source.terminatedAt)),
    salary: nullableNumber(first(source.salary, source.wage)),
    signingBonus: nullableNumber(first(source.signingBonus, source.bonus)),
    releaseClause: nullableNumber(first(source.releaseClause, source.terminationClause, source.buyout)),
    status: nullableText(source.status),
    endReason: nullableText(first(source.endReason, source.terminationReason, source.reason)),
    clauses: labelList(first(source.clauses, source.specialClauses)),
  };
}

function normalizeCareerTitle(value: unknown, index: number): CoachCareerHistoryTitle | null {
  if (typeof value === 'string') {
    const name = text(value);
    return name ? {
      id: `career-title-${index + 1}-${name}`,
      name,
      type: null,
      competition: null,
      season: null,
      wonAt: null,
      club: null,
    } : null;
  }
  const source = record(value);
  if (!source) return null;
  const name = text(first(source.name, source.title, source.competitionName), 'Título');
  return {
    id: text(source.id, `career-title-${index + 1}-${name}`),
    name,
    type: nullableText(first(source.type, source.kind)),
    competition: nullableText(first(source.competition, source.competitionName)),
    season: nullableLabel(first(source.season, source.seasonLabel, source.seasonYear, source.seasonNumber)),
    wonAt: nullableText(first(source.wonAt, source.occurredAt, source.date)),
    club: normalizeOptionalClub(first(source.club, source.clubId ? { id: source.clubId, name: source.clubName } : null)),
  };
}

function normalizeCareerAchievement(value: unknown, index: number): CoachCareerHistoryAchievement | null {
  if (typeof value === 'string') {
    const title = text(value);
    return title ? {
      id: `career-achievement-${index + 1}-${title}`,
      type: 'achievement',
      title,
      description: null,
      occurredAt: null,
      season: null,
      club: null,
      value: null,
    } : null;
  }
  const source = record(value);
  if (!source) return null;
  const title = text(first(source.title, source.name, source.label), 'Conquista');
  return {
    id: text(source.id, `career-achievement-${index + 1}-${title}`),
    type: text(first(source.type, source.kind), 'achievement'),
    title,
    description: nullableText(first(source.description, source.detail, source.reason)),
    occurredAt: nullableText(first(source.occurredAt, source.achievedAt, source.date)),
    season: nullableLabel(first(source.season, source.seasonLabel, source.seasonYear, source.seasonNumber)),
    club: normalizeOptionalClub(first(source.club, source.clubId ? { id: source.clubId, name: source.clubName } : null)),
    value: nullableNumber(first(source.value, source.amount, source.count)),
  };
}

function normalizeCareerSpell(value: unknown, index: number): CoachCareerHistorySpell | null {
  const source = record(value);
  const assignment = normalizeAssignment(value, index);
  if (!source || !assignment) return null;
  const metrics = normalizeCareerMetrics(first(source.metrics, source.statistics, source.stats, source));
  const titleEntries = list(first(source.titleEntries, source.titles)).flatMap((item, titleIndex) => {
    const title = normalizeCareerTitle(item, titleIndex);
    return title ? [title] : [];
  });
  const achievements = list(source.achievements).flatMap((item, achievementIndex) => {
    const achievement = normalizeCareerAchievement(item, achievementIndex);
    return achievement ? [achievement] : [];
  });
  const contracts = list(first(source.contracts, source.contractHistory)).flatMap((item, contractIndex) => {
    const contract = normalizeCareerContract(item, contractIndex);
    return contract ? [contract] : [];
  });
  const renewals = list(source.renewals).flatMap((item, renewalIndex) => {
    const renewal = normalizeCareerContract(item, renewalIndex);
    return renewal ? [renewal] : [];
  });
  const development = record(first(source.development, source.squadDevelopment)) ?? {};
  return {
    ...assignment,
    matches: metrics.matches ?? assignment.matches,
    wins: metrics.wins ?? assignment.wins,
    draws: metrics.draws ?? assignment.draws,
    losses: metrics.losses ?? assignment.losses,
    titles: titleEntries.length ? titleEntries.map((title) => title.name) : assignment.titles,
    country: nullableText(first(source.country, source.countryName, assignment.club.country)),
    division: nullableText(first(source.division, source.competition, source.league, assignment.club.competition)),
    durationDays: nullableNumber(first(source.durationDays, source.exactDurationDays)),
    startedSeason: nullableLabel(first(source.startedSeason, source.startSeason, source.seasonStarted)),
    endedSeason: nullableLabel(first(source.endedSeason, source.endSeason, source.seasonEnded)),
    initialSalary: nullableNumber(first(source.initialSalary, source.startSalary, contracts[0]?.salary)),
    finalSalary: nullableNumber(first(source.finalSalary, source.endSalary, contracts.at(-1)?.salary)),
    reputationStart: nullableNumber(first(source.reputationStart, source.startReputation)),
    reputationEnd: nullableNumber(first(source.reputationEnd, source.endReputation)),
    metrics: {
      ...metrics,
      matches: metrics.matches ?? assignment.matches,
      wins: metrics.wins ?? assignment.wins,
      draws: metrics.draws ?? assignment.draws,
      losses: metrics.losses ?? assignment.losses,
    },
    contracts,
    renewals,
    titleEntries,
    achievements,
    development: {
      youthPromoted: nullableNumber(first(development.youthPromoted, development.academyPromotions)),
      signings: nullableNumber(first(development.signings, development.playersSigned)),
      sales: nullableNumber(first(development.sales, development.playersSold)),
      squadValueStart: nullableNumber(first(development.squadValueStart, development.startValue)),
      squadValueEnd: nullableNumber(first(development.squadValueEnd, development.endValue)),
    },
  };
}

function normalizeCareerSummary(value: unknown): CoachCareerHistorySummary {
  const source = record(value) ?? {};
  return {
    ...normalizeCareerMetrics(source),
    clubs: nullableNumber(first(source.clubs, source.clubsManaged, source.clubCount)),
    countries: nullableNumber(first(source.countries, source.countriesWorked, source.countryCount)),
    seasons: nullableNumber(first(source.seasons, source.seasonsPlayed, source.seasonCount)),
    careerDays: nullableNumber(first(source.careerDays, source.durationDays)),
    titles: nullableNumber(first(source.titles, source.titleCount)),
    promotions: nullableNumber(source.promotions),
    relegations: nullableNumber(source.relegations),
    finals: nullableNumber(source.finals),
    finalsWon: nullableNumber(first(source.finalsWon, source.wonFinals)),
    dismissals: nullableNumber(source.dismissals),
    resignations: nullableNumber(source.resignations),
    renewals: nullableNumber(source.renewals),
    proposalsAccepted: nullableNumber(first(source.proposalsAccepted, source.acceptedProposals)),
    proposalsRejected: nullableNumber(first(source.proposalsRejected, source.rejectedProposals)),
    interviews: nullableNumber(source.interviews),
    unemploymentDays: nullableNumber(first(source.unemploymentDays, source.unemployedDays, source.daysUnemployed)),
  };
}

function normalizeCareerTimelineEntry(value: unknown, index: number): CoachCareerHistoryTimelineEntry | null {
  const source = record(value);
  if (!source) return null;
  const type = text(first(source.type, source.eventType, source.kind), 'event');
  return {
    id: text(source.id, `career-timeline-${index + 1}`),
    type,
    title: text(first(source.title, source.event, source.label), type.replaceAll('_', ' ')),
    description: nullableText(first(source.description, source.detail, source.message)),
    occurredAt: nullableText(first(source.occurredAt, source.createdAt, source.date)),
    season: nullableLabel(first(source.season, source.seasonLabel, source.seasonYear, source.seasonNumber)),
    club: normalizeOptionalClub(first(source.club, source.clubId ? { id: source.clubId, name: source.clubName } : null)),
    country: nullableText(first(source.country, source.countryName)),
    division: nullableText(first(source.division, source.competition, source.league)),
    reputationDelta: nullableNumber(source.reputationDelta),
    financialImpact: nullableNumber(first(source.financialImpact, source.amount)),
  };
}

function normalizeCareerNegotiation(value: unknown, index: number): CoachCareerHistoryNegotiation | null {
  const source = record(value);
  if (!source) return null;
  return {
    id: text(source.id, `career-negotiation-${index + 1}`),
    type: text(first(source.type, source.kind, source.action), 'proposal'),
    status: text(first(source.status, source.outcome), 'recorded'),
    outcome: nullableText(first(source.outcome, source.decision, source.reason)),
    occurredAt: nullableText(first(source.occurredAt, source.createdAt, source.date)),
    expiresAt: nullableText(first(source.expiresAt, source.deadline)),
    club: normalizeOptionalClub(first(source.club, source.clubId ? { id: source.clubId, name: source.clubName } : null)),
    salary: nullableNumber(first(source.salary, record(source.terms)?.salary)),
    durationMonths: nullableNumber(first(source.durationMonths, record(source.terms)?.durationMonths)),
    description: nullableText(first(source.description, source.detail, source.justification)),
    proposalId: nullableText(source.proposalId),
    interviewId: nullableText(source.interviewId),
  };
}

function normalizeCareerReputation(value: unknown, index: number): CoachCareerHistoryReputationEntry | null {
  const source = record(value);
  if (!source) return null;
  const delta = nullableNumber(first(source.delta, source.reputationDelta));
  const before = nullableNumber(first(source.before, source.previousReputation, source.reputationBefore));
  const after = nullableNumber(first(source.after, source.reputation, source.reputationAfter));
  return {
    id: text(source.id, `career-reputation-${index + 1}`),
    occurredAt: nullableText(first(source.occurredAt, source.createdAt, source.date)),
    season: nullableLabel(first(source.season, source.seasonLabel, source.seasonYear, source.seasonNumber)),
    club: normalizeOptionalClub(first(source.club, source.clubId ? { id: source.clubId, name: source.clubName } : null)),
    country: nullableText(first(source.country, source.countryName)),
    scope: nullableText(first(source.scope, source.level)),
    before: before ?? (after !== null && delta !== null ? after - delta : null),
    after: after ?? (before !== null && delta !== null ? before + delta : null),
    delta,
    reason: nullableText(first(source.reason, source.reasonLabel, source.description, source.type)),
  };
}

function normalizeCareerFinancial(value: unknown, index: number): CoachCareerHistoryFinancialEntry | null {
  const source = record(value);
  if (!source) return null;
  return {
    id: text(source.id, `career-financial-${index + 1}`),
    type: text(first(source.type, source.kind), 'contract'),
    occurredAt: nullableText(first(source.occurredAt, source.createdAt, source.date)),
    club: normalizeOptionalClub(first(source.club, source.clubId ? { id: source.clubId, name: source.clubName } : null)),
    salary: nullableNumber(first(source.salary, source.wage)),
    amount: nullableNumber(first(source.amount, source.value, source.bonus)),
    description: nullableText(first(source.description, source.detail, source.reason)),
    contractId: nullableText(source.contractId),
  };
}

function normalizeCareerUnemployment(value: unknown, index: number): CoachCareerHistoryUnemploymentPeriod | null {
  const source = record(value);
  if (!source) return null;
  return {
    id: text(source.id, `career-unemployment-${index + 1}`),
    startedAt: nullableText(first(source.startedAt, source.startDate)),
    endedAt: nullableText(first(source.endedAt, source.endDate)),
    durationDays: nullableNumber(first(source.durationDays, source.days)),
    reason: nullableText(first(source.reason, source.description)),
    interviews: nullableNumber(source.interviews),
    proposals: nullableNumber(source.proposals),
    refusals: nullableNumber(first(source.refusals, source.rejections)),
  };
}

function normalizeCareerHistory(value: unknown): CoachCareerHistory | undefined {
  const source = record(value);
  if (!source) return undefined;
  return {
    summary: normalizeCareerSummary(first(source.summary, source.aggregate, source.statistics)),
    timeline: list(first(source.timeline, source.events)).flatMap((item, index) => {
      const entry = normalizeCareerTimelineEntry(item, index);
      return entry ? [entry] : [];
    }),
    spells: list(first(source.spells, source.assignments, source.clubs)).flatMap((item, index) => {
      const spell = normalizeCareerSpell(item, index);
      return spell ? [spell] : [];
    }),
    negotiations: list(first(source.negotiations, source.negotiationHistory)).flatMap((item, index) => {
      const negotiation = normalizeCareerNegotiation(item, index);
      return negotiation ? [negotiation] : [];
    }),
    reputationHistory: list(first(source.reputationHistory, source.reputation)).flatMap((item, index) => {
      const entry = normalizeCareerReputation(item, index);
      return entry ? [entry] : [];
    }),
    achievements: list(source.achievements).flatMap((item, index) => {
      const achievement = normalizeCareerAchievement(item, index);
      return achievement ? [achievement] : [];
    }),
    financialHistory: list(first(source.financialHistory, source.finances)).flatMap((item, index) => {
      const entry = normalizeCareerFinancial(item, index);
      return entry ? [entry] : [];
    }),
    unemploymentPeriods: list(first(source.unemploymentPeriods, source.unemployment)).flatMap((item, index) => {
      const period = normalizeCareerUnemployment(item, index);
      return period ? [period] : [];
    }),
  };
}

function normalizeAlert(value: unknown, index: number): CoachCareerAlert | null {
  const source = record(value);
  if (!source) return null;
  const rawTone = text(source.tone, 'neutral').toLocaleLowerCase('pt-BR');
  return {
    id: text(source.id, `career-alert-${index + 1}`),
    kind: text(first(source.kind, source.type), 'career'),
    title: text(source.title, 'Atualização da carreira'),
    message: text(first(source.message, source.body), 'Há uma nova atualização na sua carreira.'),
    createdAt: nullableText(source.createdAt),
    read: bool(source.read),
    tone: ['neutral', 'positive', 'warning', 'danger', 'info'].includes(rawTone)
      ? rawTone as CoachCareerAlert['tone']
      : 'neutral',
  };
}

function normalizeLifecycleBase(
  value: unknown,
  index: number,
  kind: string,
): ProfessionalLifecycleRecord {
  const source = record(value) ?? {};
  const metadata = record(source.metadata) ?? {};
  return {
    id: text(source.id, `${kind}-${index + 1}`),
    professionalType: enumValue(source.professionalType, ['coach', 'staff'] as const, 'coach'),
    professionalId: text(first(source.professionalId, source.coachId, source.staffId)),
    clubId: nullableText(source.clubId),
    status: enumValue(source.status, lifecycleStatuses, 'active'),
    initiatedBy: text(first(source.initiatedBy, source.requestedBy, source.proposedBy), 'system'),
    reason: nullableText(first(source.reason, source.reasonLabel, source.description)),
    createdAt: nullableText(first(source.createdAt, source.announcedAt, source.notifiedAt)),
    updatedAt: nullableText(source.updatedAt),
    effectiveAt: nullableText(first(source.effectiveAt, source.exitAt, source.retirementAt, source.endsAt)),
    completedAt: nullableText(first(source.completedAt, source.endedAt, source.signedAt)),
    compensation: nullableNumber(first(source.compensation, source.compensationAmount, source.amount)),
    metadata,
  };
}

function normalizeNotice(value: unknown, index: number): CoachNoticePeriod {
  const source = record(value) ?? {};
  const base = normalizeLifecycleBase(source, index, 'notice');
  return {
    ...base,
    kind: 'notice',
    startsAt: nullableText(first(source.startsAt, source.startDate, source.notifiedAt, base.createdAt)),
    endsAt: nullableText(first(source.endsAt, source.endDate, source.plannedExitAt, base.effectiveAt)),
    durationDays: nullableNumber(first(source.durationDays, source.noticeDays)),
    earlyExitAllowed: bool(first(source.earlyExitAllowed, source.canEndEarly), true),
  };
}

function normalizeRetirement(value: unknown, index: number): CoachRetirementPlan {
  const source = record(value) ?? {};
  const base = normalizeLifecycleBase(source, index, 'retirement');
  return {
    ...base,
    kind: 'retirement',
    announcedAt: nullableText(first(source.announcedAt, source.createdAt)),
    retirementAt: nullableText(first(source.retirementAt, source.effectiveAt, source.endsAt)),
    retirementType: text(first(source.retirementType, source.mode), 'scheduled'),
    canCancel: bool(first(source.canCancel, source.cancellable), base.status !== 'completed'),
    canPostpone: bool(first(source.canPostpone, source.postponable), base.status !== 'completed'),
  };
}

function normalizeMutualAgreement(value: unknown, index: number): CoachMutualAgreement {
  const source = record(value) ?? {};
  const base = normalizeLifecycleBase(source, index, 'mutual-agreement');
  return {
    ...base,
    kind: 'mutual_agreement',
    negotiationRound: Math.max(1, Math.trunc(finiteNumber(first(source.negotiationRound, source.round), 1))),
    proposedBy: text(first(source.proposedBy, source.initiatedBy), 'coach'),
    proposedExitAt: nullableText(first(source.proposedExitAt, source.exitAt, source.effectiveAt)),
    confidentiality: bool(first(source.confidentiality, source.confidential)),
    benefitsUntil: nullableText(source.benefitsUntil),
    terms: record(first(source.terms, source.conditions)) ?? {},
  };
}

function normalizeLeave(value: unknown, index: number): CoachProfessionalLeave {
  const source = record(value) ?? {};
  const base = normalizeLifecycleBase(source, index, 'leave');
  const payment = record(source.payment);
  return {
    ...base,
    kind: 'leave',
    startsAt: nullableText(first(source.startsAt, source.startDate, source.activatedAt)),
    endsAt: nullableText(first(source.endsAt, source.endedAt, source.expectedEndAt)),
    expectedEndAt: nullableText(first(source.expectedEndAt, source.endDate, source.endsAt)),
    leaveStatus: text(first(source.leaveStatus, record(source.metadata)?.internalStatus, source.status), 'scheduled'),
    actingStaffId: nullableText(first(source.actingStaffId, record(source.metadata)?.actingStaffId)),
    contractRemainsActive: bool(source.contractRemainsActive, true),
    payment: payment
      ? {
        type: enumValue(payment.type, ['full', 'partial', 'unpaid'] as const, 'full'),
        rate: clamp(payment.rate, 0, 1, 1),
        monthlyWage: Math.max(0, finiteNumber(payment.monthlyWage, 0)),
        estimatedGross: Math.max(0, finiteNumber(payment.estimatedGross, 0)),
        actualGross: nullableNumber(payment.actualGross),
        paidByClub: bool(payment.paidByClub, true),
        notes: nullableText(payment.notes),
      }
      : null,
  };
}

function normalizeTransition(value: unknown, index: number): CoachCareerTransition {
  const source = record(value) ?? {};
  const base = normalizeLifecycleBase(source, index, 'transition');
  return {
    ...base,
    kind: text(first(source.kind, source.type), 'transition'),
    title: text(first(source.title, source.label), 'Transição profissional'),
    description: nullableText(first(source.description, source.message)),
  };
}

function normalizePreferredStaff(value: unknown, index: number): CoachPreferredStaffMember | null {
  const source = record(value);
  const staffId = source
    ? text(first(source.staffId, source.id, source.professionalId))
    : text(value);
  if (!staffId) return null;
  return {
    staffId,
    name: source ? text(source.name, staffId) : staffId,
    role: source ? text(first(source.role, source.position), 'staff') : 'staff',
    roleLabel: source ? nullableText(first(source.roleLabel, source.positionLabel)) : null,
    affinity: source ? nullableNumber(first(source.affinity, source.affinityScore)) : null,
    availability: source ? nullableText(first(source.availability, source.status)) : null,
    estimatedCost: source ? nullableNumber(first(source.estimatedCost, source.salary, source.wage)) : null,
    affiliationType: source
      ? enumValue(source.affiliationType, affiliationTypes, 'personal_staff')
      : 'personal_staff',
    linkedCoachId: source ? nullableText(source.linkedCoachId) : null,
  };
}

function normalizeCoachLifecycle(value: unknown): CoachLifecycleSnapshot {
  const source = record(value) ?? {};
  return {
    notices: list(first(source.notices, source.noticePeriods)).map(normalizeNotice),
    retirements: list(first(source.retirements, source.retirementPlans)).map(normalizeRetirement),
    mutualAgreements: list(first(source.mutualAgreements, source.agreements)).map(normalizeMutualAgreement),
    leaves: list(first(source.leaves, source.professionalLeaves)).map(normalizeLeave),
    transitions: list(first(source.transitions, source.history)).map(normalizeTransition),
    preferredStaff: list(first(source.preferredStaff, source.personalStaff)).flatMap((item, index) => {
      const member = normalizePreferredStaff(item, index);
      return member ? [member] : [];
    }),
  };
}

function normalizeCoach(value: unknown, fallbackCoachId: string): CoachProfile {
  const source = record(value) ?? {};
  const status = enumValue(source.status, employmentStatuses, 'unemployed');
  return {
    id: text(source.id, fallbackCoachId),
    name: text(source.name, 'Treinador'),
    nationality: nullableText(source.nationality),
    avatarImageUrl: nullableText(first(source.avatarImageUrl, source.avatarUrl)),
    license: nullableText(source.license),
    preferredFormation: nullableText(source.preferredFormation),
    style: nullableText(source.style),
    reputation: clamp(source.reputation, 0, 100, 0),
    marketReputation: clamp(first(source.marketReputation, source.reputation), 0, 100, 0),
    expectedSalary: nullableNumber(source.expectedSalary),
    winRate: nullableNumber(source.winRate),
    titles: Math.max(0, Math.trunc(finiteNumber(source.titles, 0))),
    status,
    currentClubId: nullableText(source.currentClubId),
    interestedClubs: list(source.interestedClubs).map((club) => normalizeClub(club)).filter((club) => club.id),
  };
}

export function normalizeCoachCareerSnapshot(value: unknown, fallbackCoachId = ''): CoachCareerSnapshot | null {
  const wrapper = record(value);
  const hasEnvelope = Boolean(wrapper && ('coachCareer' in wrapper || 'career' in wrapper || 'snapshot' in wrapper));
  const source = record(hasEnvelope ? first(wrapper?.coachCareer, wrapper?.career, wrapper?.snapshot) : value);
  if (!source) return null;
  const contracts = list(source.contracts).flatMap((item) => {
    const contract = normalizeContract(item);
    return contract ? [contract] : [];
  });
  return {
    coach: normalizeCoach(source.coach, fallbackCoachId),
    activeEmployment: normalizeEmployment(first(source.activeEmployment, source.employment), contracts),
    lifecycle: normalizeCoachLifecycle(source.lifecycle),
    marketRestriction: normalizeMarketRestriction(first(source.marketRestriction, source.signingRestriction)),
    careerTrust: normalizeCareerTrust(first(source.careerTrust, source.professionalTrust)),
    careerAudit: list(first(source.careerAudit, source.careerConductHistory)).flatMap((item, index) => {
      const entry = normalizeCareerConductEntry(item, index);
      return entry ? [entry] : [];
    }),
    reputationHistory: list(source.reputationHistory).flatMap((item, index) => {
      const entry = normalizeCareerConductEntry(item, index);
      return entry ? [entry] : [];
    }),
    jobSecurity: normalizeSecurity(source.jobSecurity),
    assignments: list(first(source.assignments, source.history)).flatMap((item, index) => {
      const assignment = normalizeAssignment(item, index);
      return assignment ? [assignment] : [];
    }),
    contracts,
    proposals: list(first(source.proposals, source.offers)).flatMap((item) => {
      const proposal = normalizeProposal(item);
      return proposal ? [proposal] : [];
    }),
    vacancies: list(source.vacancies).flatMap((item) => {
      const vacancy = normalizeVacancy(item);
      return vacancy ? [vacancy] : [];
    }),
    applications: list(source.applications).flatMap((item) => {
      const application = normalizeApplication(item);
      return application ? [application] : [];
    }),
    interviews: list(source.interviews).flatMap((item) => {
      const interview = normalizeInterview(item);
      return interview ? [interview] : [];
    }),
    news: list(first(source.news, source.alerts)).flatMap((item, index) => {
      const alert = normalizeAlert(item, index);
      return alert ? [alert] : [];
    }),
    careerHistory: normalizeCareerHistory(first(source.careerHistory, source.permanentHistory)),
    updatedAt: nullableText(source.updatedAt),
  };
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `coach-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useCoachCareer(roomCode?: string | null, revision = 0, enabled = true): UseCoachCareerResult {
  const auth = useAuth();
  const code = roomCode?.trim() ?? '';
  const [snapshot, setSnapshot] = useState<CoachCareerSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const mutationRef = useRef<string | null>(null);

  const requestSnapshot = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !code || auth.status !== 'authenticated' || !auth.identity) return null;
    const response = await apiRequest<CoachCareerResponse>(
      `/api/rooms/${encodeURIComponent(code)}/coach-career`,
      { identity: auth.identity, getIdToken: auth.getIdToken },
      { signal, timeoutMs: 30_000 },
    );
    return normalizeCoachCareerSnapshot(response, auth.identity.uid);
  }, [auth.getIdToken, auth.identity, auth.status, code, enabled]);

  useEffect(() => {
    if (!enabled || !code || auth.status !== 'authenticated' || !auth.identity) {
      setSnapshot(null);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading((current) => current || snapshot === null);
    setRefreshing(snapshot !== null);
    setError(null);
    void requestSnapshot(controller.signal).then((nextSnapshot) => {
      if (!controller.signal.aborted) setSnapshot(nextSnapshot);
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) {
        setError(requestError instanceof Error ? requestError.message : 'A carreira do treinador está indisponível.');
      }
    }).finally(() => {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    });
    return () => controller.abort();
  }, [auth.identity, auth.status, code, enabled, refreshToken, requestSnapshot, revision]);

  const refresh = useCallback(() => setRefreshToken((current) => current + 1), []);

  const mutate = useCallback(async (key: string, path: string, body: object) => {
    if (!code || auth.status !== 'authenticated' || !auth.identity) {
      throw new Error('A carreira do treinador não está disponível nesta sala.');
    }
    if (mutationRef.current) throw new Error('Aguarde a negociação em andamento.');
    mutationRef.current = key;
    setMutationKey(key);
    setError(null);
    try {
      const response = await apiRequest<CoachCareerResponse>(
        `/api/rooms/${encodeURIComponent(code)}/coach-career${path}`,
        { identity: auth.identity, getIdToken: auth.getIdToken },
        { method: 'POST', body: { ...body, requestId: requestId() }, timeoutMs: 30_000 },
      );
      const responseSnapshot = normalizeCoachCareerSnapshot(response, auth.identity.uid);
      if (responseSnapshot) setSnapshot(responseSnapshot);
      try {
        const refreshed = await requestSnapshot();
        if (refreshed) setSnapshot(refreshed);
        return refreshed ?? responseSnapshot;
      } catch (refreshError) {
        if (!responseSnapshot) throw refreshError;
        setError('A ação foi salva, mas a tela não conseguiu confirmar a atualização mais recente.');
        return responseSnapshot;
      }
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'O servidor não conseguiu atualizar a carreira.');
      throw mutationError;
    } finally {
      mutationRef.current = null;
      setMutationKey(null);
    }
  }, [auth.getIdToken, auth.identity, auth.status, code, requestSnapshot]);

  return useMemo(() => ({
    snapshot,
    loading,
    refreshing,
    error,
    mutationKey,
    refresh,
    respondToProposal: (proposalId: string, decision: CoachProposalDecision, terms?: CoachProposalNegotiationTerms) => mutate(
      `proposal:${proposalId}`,
      `/proposals/${encodeURIComponent(proposalId)}/respond`,
      {
        action: decision,
        ...(terms?.salary !== undefined && terms.salary !== null ? { salary: terms.salary } : {}),
        ...(terms?.durationMonths !== undefined && terms.durationMonths !== null
          ? { contractYears: Math.max(1, Math.round(terms.durationMonths / 12)) }
          : {}),
        ...(terms?.releaseClause !== undefined && terms.releaseClause !== null
          ? { terminationClause: terms.releaseClause }
          : {}),
        ...(terms?.transferBudget !== undefined && terms.transferBudget !== null
          ? { transferBudget: terms.transferBudget }
          : {}),
        ...(terms?.signingBonus !== undefined ? { signingBonus: terms.signingBonus } : {}),
        ...(terms?.sportingTargets !== undefined
          ? { objectives: terms.sportingTargets.map((target) => target.trim()).filter(Boolean) }
          : {}),
        ...(terms?.specialClauses !== undefined
          ? { specialClauses: terms.specialClauses.map((clause) => clause.trim()).filter(Boolean) }
          : {}),
        ...(terms?.bonusTerms !== undefined ? { bonuses: terms.bonusTerms } : {}),
        ...(terms?.guarantees?.[0]?.trim() ? { guarantee: terms.guarantees[0].trim() } : {}),
      },
    ),
    requestMoreTime: (proposalId: string) => mutate(
      `proposal-time:${proposalId}`,
      `/proposals/${encodeURIComponent(proposalId)}/respond`,
      { action: 'extend' },
    ),
    requestGuarantee: (proposalId: string, guarantee: string) => mutate(
      `proposal-guarantee:${proposalId}`,
      `/proposals/${encodeURIComponent(proposalId)}/respond`,
      { action: 'guarantee', guarantee: guarantee.trim() },
    ),
    provideProposalInformation: (proposalId: string, response: string) => mutate(
      `proposal-information:${proposalId}`,
      `/proposals/${encodeURIComponent(proposalId)}/respond`,
      { action: 'provide_information', information: response.trim() },
    ),
    endNegotiation: (proposalId: string) => mutate(
      `proposal-end:${proposalId}`,
      `/proposals/${encodeURIComponent(proposalId)}/respond`,
      { action: 'end' },
    ),
    applyToVacancy: (vacancyId: string, message?: string) => mutate(
      `vacancy:${vacancyId}`,
      `/vacancies/${encodeURIComponent(vacancyId)}/apply`,
      { ...(message?.trim() ? { message: message.trim() } : {}) },
    ),
    answerInterview: (interviewId: string, answers: CoachInterviewAnswer[]) => mutate(
      `interview:${interviewId}`,
      `/interviews/${encodeURIComponent(interviewId)}/respond`,
      { answers: answers.map((answer) => ({ questionId: answer.questionId, answerId: answer.optionId ?? answer.text ?? '' })) },
    ),
    startInterview: (interviewId: string, depth: CoachInterviewDepth) => mutate(
      `interview-start:${interviewId}`,
      `/interviews/${encodeURIComponent(interviewId)}/start`,
      { depth },
    ),
    answerInterviewTurn: (interviewId: string, message: string, currentQuestionId?: string | null) => mutate(
      `interview-turn:${interviewId}`,
      `/interviews/${encodeURIComponent(interviewId)}/turn`,
      {
        message: message.trim(),
        ...(currentQuestionId ? { currentQuestionId } : {}),
      },
    ),
    runLifecycleAction: (action: ProfessionalLifecycleAction, payload: CoachLifecyclePayload = {}) => mutate(
      `lifecycle:${action}`,
      '/lifecycle',
      { ...compactLifecyclePayload(payload), action },
    ),
    resign: (reason?: string, reasonCode?: string) => mutate(
      'resign',
      '/resign',
      {
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
        ...(reasonCode?.trim() ? { reasonCode: reasonCode.trim() } : {}),
      },
    ),
    renewContract: (years: number, salary?: number, extras?: CoachRenewalExtras) => {
      const sportingTargets = extras?.sportingTargets ?? extras?.objectives;
      const terminationClause = extras?.terminationClause ?? extras?.releaseClause;
      return mutate(
        'renew',
        '/contracts/renew',
        {
          years,
          ...(salary !== undefined ? { salary } : {}),
          ...(extras?.signingBonus !== undefined ? { signingBonus: extras.signingBonus } : {}),
          ...(terminationClause !== undefined ? { terminationClause } : {}),
          ...(extras?.bonuses !== undefined ? { bonuses: extras.bonuses } : {}),
          ...(extras?.transferBudget !== undefined ? { transferBudget: extras.transferBudget } : {}),
          ...(sportingTargets !== undefined
            ? { objectives: sportingTargets.map((target) => target.trim()).filter(Boolean) }
            : {}),
          ...(extras?.specialClauses !== undefined
            ? { specialClauses: extras.specialClauses.map((clause) => clause.trim()).filter(Boolean) }
            : {}),
        },
      );
    },
    searchJobs: (active = true) => mutate('search', '/search', { active }),
  }), [error, loading, mutate, mutationKey, refresh, refreshing, snapshot]);
}
