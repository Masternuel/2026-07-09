import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileSignature,
  History,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  UserRoundSearch,
  X,
} from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { ClubMark } from '../../components/shared/ClubMark';
import { Modal } from '../../components/shared/Modal';
import { Panel } from '../../components/shared/Panel';
import { useCoachCareer } from '../../hooks/useCoachCareer';
import type {
  CoachApplication,
  CoachCandidateAssessment,
  CoachCareerHistorySummary,
  CoachCareerHistorySpell,
  CoachCareerHistoryTimelineEntry,
  CoachCareerHistoryTitle,
  CoachCareerSnapshot,
  CoachContractTerms,
  CoachEmploymentStatus,
  CoachInterview,
  CoachInterviewAnswer,
  CoachInterviewDepth,
  CoachJobSecurity,
  CoachProposal,
  CoachVacancy,
  ProfessionalLifecycleAction,
  ProfessionalNoticeType,
  ProfessionalRetirementType,
} from '../../types';

type CareerTab = 'overview' | 'proposals' | 'vacancies' | 'interviews' | 'history';

interface CoachCareerViewProps {
  roomCode?: string | null;
  revision?: number;
  onToast?: (message: string) => void;
}

type DynamicCoachProposal = CoachProposal & {
  kind?: 'hiring' | 'renewal' | 'precontract' | string;
  marketStage?: string | null;
  nextActionAt?: string | null;
  lastActionAt?: string | null;
  maxNegotiationRounds?: number | null;
  interviewCompatibility?: number | null;
  decisionScore?: number | null;
  decisionReason?: string | null;
  decisionFactors?: Array<{
    id?: string;
    code?: string;
    label?: string;
    value?: number | null;
    detail?: string | null;
  }>;
  competingOfferCount?: number | null;
  competingProposalIds?: string[];
};

const employmentLabels: Record<CoachEmploymentStatus, string> = {
  employed: 'Empregado',
  unemployed: 'Sem clube',
  negotiating: 'Em negociação',
  notice: 'Aviso prévio',
  on_leave: 'Afastado',
  dismissed: 'Demitido',
  resigned: 'Pediu demissão',
  interim: 'Treinador interino',
  awaiting_start: 'Aguardando início',
  retiring: 'Aposentadoria anunciada',
  retired: 'Aposentado',
};

const proposalLabels = {
  pending: 'Aguardando resposta',
  accepted: 'Aceita',
  rejected: 'Recusada',
  countered: 'Contraproposta enviada',
  expired: 'Expirada',
  withdrawn: 'Negociação encerrada',
  aguardando_resposta_diretoria: 'Aguardando resposta da diretoria',
  aprovada_diretoria: 'Contraproposta aprovada',
  informacoes_solicitadas: 'Diretoria solicitou informações',
  encerrado_vaga_preenchida: 'Encerrada: vaga preenchida',
} as const;

const proposalKindLabels: Record<string, string> = {
  hiring: 'Proposta de contratação',
  renewal: 'Proposta de renovação',
  precontract: 'Proposta de pré-contrato',
};

const proposalKindEyebrows: Record<string, string> = {
  hiring: 'CONVITE OFICIAL',
  renewal: 'RENOVAÇÃO CONTRATUAL',
  precontract: 'PRÉ-CONTRATO',
};

const marketStageLabels: Record<string, string> = {
  interest: 'Mapeamento de interesse',
  interview: 'Entrevista',
  coach_review: 'Análise do treinador',
  club_review: 'Análise da diretoria',
  agreement: 'Acordo em formalização',
  completed: 'Processo concluído',
  closed: 'Processo encerrado',
};

const decisionReasonLabels: Record<string, string> = {
  agreement_reached: 'Acordo alcançado entre clube e treinador.',
  best_available_offer: 'Melhor projeto entre as propostas disponíveis.',
  renewal_best_project: 'Continuidade escolhida como melhor projeto para a carreira.',
  conditions_need_improvement: 'Condições precisam melhorar para haver acordo.',
  comparing_competing_offers: 'Treinador está comparando propostas concorrentes.',
  proposal_deadline_expired: 'Prazo da proposta terminou sem acordo.',
  candidate_rejected: 'Treinador recusou as condições apresentadas.',
  candidate_withdrew: 'Treinador desistiu da negociação.',
  lower_ranked_competing_offer: 'Outra proposta foi considerada mais atraente.',
  vacancy_filled: 'Clube preencheu a vaga com outro treinador.',
  max_rounds_reached: 'Limite de rodadas da negociação foi atingido.',
};

const activeProposalStatuses = new Set<CoachProposal['status']>([
  'pending',
  'countered',
  'aguardando_resposta_diretoria',
  'aprovada_diretoria',
  'informacoes_solicitadas',
]);

const vacancyLabels = {
  open: 'Candidaturas abertas',
  shortlisting: 'Analisando candidatos',
  interviewing: 'Entrevistas em andamento',
  filled: 'Vaga preenchida',
  expired: 'Candidaturas encerradas',
  cancelled: 'Processo cancelado',
} as const;

const applicationLabels = {
  submitted: 'Candidatura enviada',
  shortlisted: 'Na lista final',
  interview: 'Convite para entrevista',
  interview_completed: 'Entrevista concluída',
  offered: 'Proposta recebida',
  accepted: 'Candidatura aceita',
  rejected: 'Candidatura recusada',
  withdrawn: 'Candidatura retirada',
  contratado: 'Contratado',
  encerrado_vaga_preenchida: 'Encerrado: vaga preenchida',
} as const;

const interviewLabels = {
  pending: 'Entrevista pronta para iniciar',
  scheduled: 'Entrevista agendada',
  awaiting_answers: 'Aguardando suas respostas',
  completed: 'Entrevista concluída',
  accepted: 'Aprovado na entrevista',
  rejected: 'Não selecionado',
  expired: 'Prazo encerrado',
  cancelled: 'Entrevista cancelada',
  contratado: 'Contratado',
  encerrado_vaga_preenchida: 'Encerrada: vaga preenchida',
} as const;

const guaranteeLabels: Record<string, string> = {
  requested: 'Solicitada',
  pending_formalization: 'Aguardando formalização',
  formalized: 'Formalizada',
  in_progress: 'Em andamento',
  fulfilled: 'Cumprida',
  waived: 'Dispensada',
  breached: 'Descumprida',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
  overdue: 'Vencida',
  solicitada: 'Solicitada',
  pendente_formalizacao: 'Aguardando formalização',
  formalizada: 'Formalizada',
  em_andamento: 'Em andamento',
  cumprida: 'Cumprida',
  rejeitada: 'Rejeitada',
  cancelada: 'Cancelada',
  vencida: 'Vencida',
};

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Não informado';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function optionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitLines(value: string) {
  return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Não informada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function isPast(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function dynamicProposal(proposal: CoachProposal): DynamicCoachProposal {
  return proposal as DynamicCoachProposal;
}

function isActiveProposal(proposal: CoachProposal) {
  return activeProposalStatuses.has(proposal.status) && !isPast(proposal.deadline);
}

function proposalKind(proposal: CoachProposal) {
  const value = dynamicProposal(proposal).kind;
  return value && proposalKindLabels[value] ? value : 'hiring';
}

function proposalKindLabel(proposal: CoachProposal) {
  return proposalKindLabels[proposalKind(proposal)] ?? 'Proposta profissional';
}

function proposalKindEyebrow(proposal: CoachProposal) {
  return proposalKindEyebrows[proposalKind(proposal)] ?? 'PROPOSTA PROFISSIONAL';
}

function marketStageLabel(value: string | null | undefined) {
  if (!value) return 'Negociação aberta';
  return marketStageLabels[value] ?? value.replaceAll('_', ' ');
}

function decisionReasonLabel(value: string | null | undefined) {
  if (!value) return null;
  return decisionReasonLabels[value] ?? value.replaceAll('_', ' ');
}

function competingOfferCount(proposal: CoachProposal) {
  const dynamic = dynamicProposal(proposal);
  if (typeof dynamic.competingOfferCount === 'number' && Number.isFinite(dynamic.competingOfferCount)) {
    return Math.max(0, Math.trunc(dynamic.competingOfferCount));
  }
  return new Set(dynamic.competingProposalIds ?? []).size;
}

function proposalProgressCopy(proposal: CoachProposal, expired: boolean) {
  const dynamic = dynamicProposal(proposal);
  if (expired || !isActiveProposal(proposal)) return null;
  if (proposalKind(proposal) === 'renewal') {
    return {
      title: 'Renovação pendente',
      copy: 'Contrato atual continua válido. Novo vínculo só será criado quando treinador e diretoria chegarem a um acordo.',
    };
  }
  if (proposalKind(proposal) === 'precontract') {
    return {
      title: 'Pré-contrato em negociação',
      copy: 'A chegada futura permanece condicionada ao acordo final e à ausência de vínculo conflitante.',
    };
  }
  if (dynamic.marketStage === 'club_review' || proposal.status === 'aguardando_resposta_diretoria' || proposal.status === 'countered') {
    return {
      title: 'Diretoria analisa contraproposta',
      copy: 'Contratação só será concluída após resposta formal e aceite definitivo das condições.',
    };
  }
  return {
    title: marketStageLabel(dynamic.marketStage),
    copy: dynamic.nextActionAt
      ? `Próxima movimentação prevista para ${formatDate(dynamic.nextActionAt)}.`
      : 'Negociação aberta. Clube e treinador ainda podem alterar condições ou encerrar o processo.',
  };
}

function proposalTone(status: CoachProposal['status'] | string): 'neutral' | 'positive' | 'warning' | 'danger' | 'info' {
  if (status === 'accepted' || status === 'aprovada_diretoria') return 'positive';
  if (status === 'rejected' || status === 'expired' || status === 'withdrawn') return 'danger';
  if (status === 'encerrado_vaga_preenchida') return 'neutral';
  if (status === 'countered' || status === 'aguardando_resposta_diretoria') return 'info';
  return 'warning';
}

function guaranteeTone(status: string): 'neutral' | 'positive' | 'warning' | 'danger' | 'info' {
  if (status === 'fulfilled' || status === 'cumprida') return 'positive';
  if (['breached', 'rejected', 'cancelled', 'overdue', 'rejeitada', 'cancelada', 'vencida'].includes(status)) return 'danger';
  if (status === 'waived') return 'neutral';
  if (status === 'formalized' || status === 'formalizada' || status === 'in_progress' || status === 'em_andamento') return 'info';
  return 'warning';
}

function decisionActionLabel(value: string) {
  const labels: Record<string, string> = {
    counter: 'Contraproposta enviada',
    counter_approved: 'Contraproposta aprovada',
    approve_counter: 'Contraproposta aprovada',
    counter_rejected: 'Contraproposta recusada',
    reject_counter: 'Contraproposta recusada',
    revised_offer: 'Nova proposta apresentada',
    new_proposal: 'Nova proposta apresentada',
    request_information: 'Mais informações solicitadas',
    provide_information: 'Informações enviadas',
    accept: 'Proposta aceita',
    reject: 'Proposta recusada',
    withdraw: 'Negociação encerrada',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}

function proposalStatusLabel(value: string | null) {
  if (!value) return 'Início';
  return proposalLabels[value as keyof typeof proposalLabels] ?? value.replaceAll('_', ' ');
}

function vacancyTone(status: CoachVacancy['status']): 'neutral' | 'positive' | 'warning' | 'danger' | 'info' {
  if (status === 'open') return 'positive';
  if (status === 'shortlisting' || status === 'interviewing') return 'info';
  if (status === 'cancelled' || status === 'expired') return 'danger';
  return 'neutral';
}

function applicationTone(status: CoachApplication['status']): 'neutral' | 'positive' | 'warning' | 'danger' | 'info' {
  if (status === 'offered' || status === 'accepted' || status === 'contratado') return 'positive';
  if (status === 'interview' || status === 'shortlisted' || status === 'interview_completed') return 'info';
  if (status === 'rejected' || status === 'withdrawn' || status === 'encerrado_vaga_preenchida') return 'danger';
  return 'warning';
}

function clubMarkProps(club: { code: string; primaryColor: string | null; crestImageUrl: string | null }) {
  return { code: club.code, color: club.primaryColor ?? '#c8ff3d', imageUrl: club.crestImageUrl };
}

function EmptyState({ icon: Icon, title, children }: { icon: typeof BriefcaseBusiness; title: string; children: string }) {
  return (
    <div className="coach-career-empty">
      <span><Icon size={24} /></span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function securityTrendSymbol(direction: 'rising' | 'stable' | 'falling') {
  if (direction === 'rising') return '↑';
  if (direction === 'falling') return '↓';
  return '→';
}

function securityMetricTone(value: number, inverse = false) {
  const normalized = inverse ? 100 - value : value;
  if (normalized < 35) return 'danger';
  if (normalized < 60) return 'warning';
  return 'positive';
}

function SecurityTrend({ direction, label, delta }: { direction: 'rising' | 'stable' | 'falling'; label: string; delta?: number }) {
  return (
    <span className={`coach-career-security-trend coach-career-security-trend--${direction}`}>
      {securityTrendSymbol(direction)} {label}{delta !== undefined && delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(1)})` : ''}
    </span>
  );
}

function JobSecurityPanel({ security }: { security: CoachJobSecurity }) {
  const scoreTone = securityMetricTone(security.score);
  const privateEstimate = security.boardSupport?.privateEstimate ?? null;
  const hasIndicators = Boolean(
    security.fanSupport
    || security.boardSupport
    || security.relegation
    || security.accumulatedCredit,
  );
  const positiveFactors = security.factors.filter((factor) => factor.tone === 'positive');
  const negativeFactors = security.factors.filter((factor) => factor.tone === 'negative');
  const neutralFactors = security.factors.filter((factor) => factor.tone === 'neutral');
  const orderedFactors = [...negativeFactors, ...positiveFactors, ...neutralFactors];

  return (
    <>
      <div className="coach-career-security__summary">
        <div className={`coach-career-security__score coach-career-security__score--${scoreTone}`}>
          <strong>{Math.round(security.score)}</strong><span>/100</span>
        </div>
        <div className="coach-career-security__status">
          <Badge tone={scoreTone}>{security.label}</Badge>
          {security.trend && <SecurityTrend direction={security.trend.direction} label={security.trend.label} delta={security.trend.delta} />}
          <p>Atualizado em {formatDate(security.updatedAt)}</p>
        </div>
      </div>
      <div className="coach-career-security__bar" aria-label={`Segurança no cargo: ${Math.round(security.score)} de 100`}>
        <span style={{ width: `${security.score}%` }} />
      </div>

      {security.activeUltimatums.map((ultimatum) => (
        <article key={ultimatum.id} className="coach-career-ultimatum" role="status">
          <header><span><AlertTriangle size={15} /></span><div><strong>{ultimatum.title}</strong><p>{ultimatum.objective}</p></div><Badge tone="danger">{ultimatum.status}</Badge></header>
          <div className="coach-career-ultimatum__progress"><span style={{ width: `${ultimatum.progress}%` }} /></div>
          <footer><span>{Math.round(ultimatum.progress)}% concluído</span><span>{ultimatum.deadlineRound === null ? 'Prazo não informado' : `Até a rodada ${Math.round(ultimatum.deadlineRound)}`}</span></footer>
          <p className="coach-career-ultimatum__consequence">Consequência: {ultimatum.consequence}</p>
        </article>
      ))}

      {hasIndicators && (
        <div className="coach-career-security-metrics">
          {security.fanSupport && (
            <article className={`coach-career-security-metric coach-career-security-metric--${securityMetricTone(security.fanSupport.value)}`}>
              <span>Torcida</span><strong>{security.fanSupport.label}</strong><small>{Math.round(security.fanSupport.value)}/100 · {securityTrendSymbol(security.fanSupport.trend)}</small>
            </article>
          )}
          {security.boardSupport && (
            <article className={`coach-career-security-metric coach-career-security-metric--${securityMetricTone(security.boardSupport.publicValue)}`}>
              <span>Apoio público</span><strong>{security.boardSupport.publicLabel}</strong><small>{Math.round(security.boardSupport.publicValue)}/100 · declaração oficial</small>
            </article>
          )}
          {privateEstimate && (
            <article className="coach-career-security-metric coach-career-security-metric--estimate">
              <span>Confiança interna estimada</span><strong>{privateEstimate.label}</strong><small>Faixa {Math.round(privateEstimate.min)}–{Math.round(privateEstimate.max)} · {privateEstimate.source}</small>
            </article>
          )}
          {security.relegation && (
            <article className={`coach-career-security-metric coach-career-security-metric--${securityMetricTone(security.relegation.risk, true)}`}>
              <span>Risco de rebaixamento</span><strong>{security.relegation.label}</strong><small>{Math.round(security.relegation.risk)}%{security.relegation.inZone ? ` · Z-4 há ${security.relegation.consecutiveRounds} rodada(s)` : ''}</small>
            </article>
          )}
          {security.accumulatedCredit && (
            <article className={`coach-career-security-metric coach-career-security-metric--${securityMetricTone(security.accumulatedCredit.value)}`}>
              <span>Crédito acumulado</span><strong>{security.accumulatedCredit.label}</strong><small>{Math.round(security.accumulatedCredit.value)}/100 · {security.accumulatedCredit.delta > 0 ? '+' : ''}{security.accumulatedCredit.delta.toFixed(1)}</small>
            </article>
          )}
        </div>
      )}

      {security.classics && security.classics.played > 0 && (
        <div className="coach-career-security-classics">
          <span><Trophy size={15} /></span>
          <div><strong>Desempenho em clássicos</strong><p>{security.classics.wins}V · {security.classics.draws}E · {security.classics.losses}D{security.classics.winlessStreak > 0 ? ` · ${security.classics.winlessStreak} sem vencer` : ''}</p></div>
          <small>{security.classics.heavyLosses} goleada(s) · {security.classics.eliminations} eliminação(ões)</small>
          <em className={security.classics.impact < 0 ? 'is-negative' : 'is-positive'}>{security.classics.impact > 0 ? '+' : ''}{security.classics.impact}</em>
        </div>
      )}

      {security.dimensions.length > 0 && (
        <details className="coach-career-security-details">
          <summary>Como a diretoria avalia ({security.dimensions.length} dimensões)</summary>
          <div className="coach-career-security-dimensions">
            {security.dimensions.map((dimension) => (
              <article key={dimension.id}>
                <header><strong>{dimension.label}</strong><span>{Math.round(dimension.value)}/100 · peso {dimension.weight <= 1 ? Math.round(dimension.weight * 100) : Math.round(dimension.weight)}%</span></header>
                <div><span style={{ width: `${dimension.value}%` }} /></div>
                <p>{securityTrendSymbol(dimension.trend)} {dimension.justification ?? 'Sem justificativa publicada.'}</p>
              </article>
            ))}
          </div>
        </details>
      )}

      {orderedFactors.length > 0 && (
        <details className="coach-career-security-details" open>
          <summary>Fatores da avaliação ({orderedFactors.length})</summary>
          <ul className="coach-career-factors">
            {orderedFactors.map((factor) => (
              <li key={factor.id} className={`coach-career-factor--${factor.tone}`}>
                <span>{factor.tone === 'positive' ? '+' : factor.tone === 'negative' ? '−' : '•'}</span>
                <div><strong>{factor.label}</strong>{factor.detail && <p>{factor.detail}</p>}</div>
                <em>{factor.impact > 0 ? '+' : ''}{factor.impact}</em>
              </li>
            ))}
          </ul>
        </details>
      )}

      {security.recentHistory.length > 0 && (
        <details className="coach-career-security-details">
          <summary>Histórico recente ({security.recentHistory.length})</summary>
          <ol className="coach-career-security-history">
            {security.recentHistory.map((entry) => (
              <li key={entry.id}>
                <span>{entry.newScore >= (entry.previousScore ?? entry.newScore) ? '↑' : '↓'}</span>
                <div><strong>{entry.decision}</strong><p>{entry.previousScore === null ? `${Math.round(entry.newScore)}/100` : `${Math.round(entry.previousScore)} → ${Math.round(entry.newScore)}`}</p></div>
                <time>{formatDate(entry.occurredAt)}</time>
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

function OverviewTab({
  snapshot,
  mutationKey,
  onSearch,
  onOpenRenew,
  onOpenResign,
}: {
  snapshot: CoachCareerSnapshot;
  mutationKey: string | null;
  onSearch: () => void;
  onOpenRenew: () => void;
  onOpenResign: () => void;
}) {
  const { coach, activeEmployment, jobSecurity } = snapshot;
  const contract = activeEmployment?.contract ?? snapshot.contracts.find((item) => item.status === 'active') ?? null;
  const pendingProposals = snapshot.proposals.filter(isActiveProposal).length;
  const pendingRenewal = snapshot.proposals.find((item) => proposalKind(item) === 'renewal' && isActiveProposal(item)) ?? null;
  return (
    <div className="coach-career-overview">
      <section className={`coach-career-hero ${activeEmployment ? '' : 'coach-career-hero--unemployed'}`}>
        <div className="coach-career-hero__identity">
          {activeEmployment
            ? <ClubMark {...clubMarkProps(activeEmployment.club)} size="xl" />
            : <span className="coach-career-hero__avatar"><BriefcaseBusiness size={29} /></span>}
          <div>
            <p className="eyebrow">CARREIRA PROFISSIONAL</p>
            <h2>{coach.name}</h2>
            <p>{activeEmployment
              ? `${activeEmployment.role} · ${activeEmployment.club.name}`
              : 'Disponível para um novo projeto'}</p>
          </div>
        </div>
        <div className="coach-career-hero__actions">
          <Badge tone={snapshot.careerTrust.score >= 70 ? 'positive' : snapshot.careerTrust.score >= 50 ? 'warning' : 'danger'}>
            Confiança {snapshot.careerTrust.score}/100 · {snapshot.careerTrust.label}
          </Badge>
          <Badge tone={activeEmployment ? 'positive' : 'warning'} dot>{employmentLabels[activeEmployment?.status ?? coach.status]}</Badge>
          {!activeEmployment && (
            <Button icon={<Search size={15} />} loading={mutationKey === 'search'} onClick={onSearch}>Procurar emprego</Button>
          )}
        </div>
      </section>

      {snapshot.marketRestriction?.active && (
        <section className="coach-career-restriction" role="status">
          <CalendarClock size={19} />
          <div>
            <strong>Período obrigatório sem assinar contrato</strong>
            <p>
              {snapshot.marketRestriction.remainingDays} dia(s) restantes, até {formatDate(snapshot.marketRestriction.endsAt)}.
              Você pode receber interesse e participar de entrevistas, mas só poderá assinar depois da restrição.
            </p>
          </div>
          <Badge tone="warning">{snapshot.marketRestriction.offersReceived} oferta(s) no período</Badge>
        </section>
      )}

      <div className="coach-career-metrics">
        <article><Sparkles size={18} /><span>Reputação no mercado</span><strong>{coach.marketReputation}/100</strong></article>
        <article><CircleDollarSign size={18} /><span>Expectativa salarial</span><strong>{formatMoney(coach.expectedSalary)}</strong></article>
        <article><FileSignature size={18} /><span>Propostas ativas</span><strong>{pendingProposals}</strong></article>
        <article><Building2 size={18} /><span>Clubes interessados</span><strong>{coach.interestedClubs.length}</strong></article>
      </div>

      {activeEmployment && (
        <div className="coach-career-overview__grid">
          <Panel title="Vínculo atual" eyebrow="CONTRATO" className="coach-career-contract-panel">
            <dl className="coach-career-detail-list">
              <div><dt>Clube</dt><dd>{activeEmployment.club.name}</dd></div>
              <div><dt>Início</dt><dd>{formatDate(contract?.startDate ?? activeEmployment.startsAt)}</dd></div>
              <div><dt>Término</dt><dd>{formatDate(contract?.endDate ?? activeEmployment.endsAt)}</dd></div>
              <div><dt>Salário</dt><dd>{formatMoney(contract?.salary)}</dd></div>
              <div><dt>Multa rescisória</dt><dd>{formatMoney(contract?.releaseClause)}</dd></div>
              <div><dt>Orçamento prometido</dt><dd>{formatMoney(contract?.transferBudget)}</dd></div>
              <div><dt>Autonomia</dt><dd>{contract?.autonomyLevel === null || contract?.autonomyLevel === undefined ? 'Não informada' : `${Math.round(contract.autonomyLevel)}/100`}</dd></div>
              <div><dt>Ajuste de exigência</dt><dd>{contract?.objectiveDifficultyAdjustment === null || contract?.objectiveDifficultyAdjustment === undefined ? 'Sem ajuste' : signedValue(contract.objectiveDifficultyAdjustment)}</dd></div>
              <div><dt>Origem das condições</dt><dd>{contract?.sourceInterviewId ? 'Entrevista com a diretoria' : 'Negociação contratual'}</dd></div>
              <div><dt>Motivo da nomeação</dt><dd>{activeEmployment.entryReason ?? 'Não informado'}</dd></div>
            </dl>
            {contract?.specialClauses.length ? (
              <ul className="coach-career-mini-list">{contract.specialClauses.map((clause) => <li key={clause}><FileSignature size={13} />{clause}</li>)}</ul>
            ) : null}
            {pendingRenewal && (
              <div className="coach-career-negotiation-state" role="status">
                <Clock3 size={16} />
                <div><strong>Renovação pendente</strong><p>{marketStageLabel(dynamicProposal(pendingRenewal).marketStage)} · rodada {pendingRenewal.negotiationRound}/{dynamicProposal(pendingRenewal).maxNegotiationRounds ?? 4}. Contrato atual não muda antes do acordo.</p></div>
              </div>
            )}
            <div className="coach-career-panel-actions">
              <Button size="sm" icon={<FileSignature size={14} />} loading={mutationKey === 'renew'} disabled={!contract || Boolean(pendingRenewal)} onClick={onOpenRenew}>{pendingRenewal ? 'Renovação pendente' : 'Conversar sobre renovação'}</Button>
              <Button size="sm" variant="danger" icon={<X size={14} />} loading={mutationKey === 'resign'} onClick={onOpenResign}>Pedir demissão</Button>
            </div>
          </Panel>

          <Panel title="Segurança no cargo" eyebrow="AVALIAÇÃO DA DIRETORIA" className="coach-career-security-panel">
            {jobSecurity ? (
              <JobSecurityPanel security={jobSecurity} />
            ) : <EmptyState icon={ShieldAlert} title="Avaliação indisponível">A diretoria ainda não publicou uma avaliação para este vínculo.</EmptyState>}
          </Panel>
        </div>
      )}

      <div className="coach-career-overview__grid">
        <Panel title="Objetivos da diretoria" eyebrow="TEMPORADA">
          {activeEmployment?.objectives.length ? (
            <div className="coach-career-objectives">
              {activeEmployment.objectives.map((objective) => (
                <article key={objective.id}>
                  <div><Target size={16} /><strong>{objective.label}</strong><Badge tone={objective.status === 'completed' ? 'positive' : objective.status === 'failed' ? 'danger' : objective.status === 'on_track' ? 'info' : 'neutral'}>{objective.status === 'on_track' ? 'No caminho' : objective.status === 'completed' ? 'Concluído' : objective.status === 'failed' ? 'Falhou' : 'Pendente'}</Badge></div>
                  {(objective.target || objective.description) && <p>{objective.target ?? objective.description}</p>}
                  {objective.difficultyAdjustment !== null && objective.difficultyAdjustment !== 0 && <p>Exigência ajustada pela entrevista: {signedValue(objective.difficultyAdjustment)}</p>}
                  {objective.progress !== null && <div className="coach-career-objective__progress"><span style={{ width: `${objective.progress}%` }} /></div>}
                </article>
              ))}
            </div>
          ) : <EmptyState icon={Target} title="Sem objetivos ativos">Os próximos objetivos aparecerão quando uma diretoria definir as metas do trabalho.</EmptyState>}
        </Panel>

        <Panel title="Atualizações da carreira" eyebrow="ALERTAS">
          {snapshot.news.length ? (
            <div className="coach-career-alerts">
              {snapshot.news.slice(0, 5).map((alert) => (
                <article key={alert.id} className={`coach-career-alert coach-career-alert--${alert.tone}`}>
                  <span>{alert.tone === 'danger' || alert.tone === 'warning' ? <AlertTriangle size={16} /> : <BadgeCheck size={16} />}</span>
                  <div><strong>{alert.title}</strong><p>{alert.message}</p><time>{formatDate(alert.createdAt)}</time></div>
                </article>
              ))}
            </div>
          ) : <EmptyState icon={BadgeCheck} title="Tudo em dia">Não há alertas pendentes na sua carreira.</EmptyState>}
        </Panel>
      </div>
    </div>
  );
}

const terminalLifecycleStatuses = new Set(['completed', 'cancelled', 'rejected']);

function lifecycleDateInput(days = 30) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function LifecyclePanel({
  snapshot,
  mutationKey,
  onAction,
}: {
  snapshot: CoachCareerSnapshot;
  mutationKey: string | null;
  onAction: (action: ProfessionalLifecycleAction, payload: Record<string, unknown>, success: string) => void;
}) {
  const lifecycle = snapshot.lifecycle ?? {
    notices: [], retirements: [], mutualAgreements: [], leaves: [], transitions: [], preferredStaff: [],
  };
  const activeNotice = [...lifecycle.notices].reverse().find((entry) => !terminalLifecycleStatuses.has(entry.status)) ?? null;
  const activeRetirement = [...lifecycle.retirements].reverse().find((entry) => !terminalLifecycleStatuses.has(entry.status)) ?? null;
  const activeAgreement = [...lifecycle.mutualAgreements].reverse().find((entry) => !terminalLifecycleStatuses.has(entry.status)) ?? null;
  const activeLeave = [...lifecycle.leaves].reverse().find((entry) => (
    entry.leaveStatus === 'scheduled' || entry.leaveStatus === 'active'
  )) ?? null;
  const [effectiveAt, setEffectiveAt] = useState(lifecycleDateInput);
  const [retirementAt, setRetirementAt] = useState(() => lifecycleDateInput(120));
  const [leaveStartsAt, setLeaveStartsAt] = useState(() => lifecycleDateInput(0));
  const [leaveEndsAt, setLeaveEndsAt] = useState(() => lifecycleDateInput(30));
  const [leavePaymentType, setLeavePaymentType] = useState<'full' | 'partial' | 'unpaid'>('full');
  const [leavePaymentRate, setLeavePaymentRate] = useState('50');
  const [reason, setReason] = useState('');
  const [compensation, setCompensation] = useState('0');
  const [noticeType, setNoticeType] = useState<ProfessionalNoticeType>('standard');
  const [retirementType, setRetirementType] = useState<ProfessionalRetirementType>('scheduled');
  const [confidentiality, setConfidentiality] = useState(false);
  const [preserveBonuses, setPreserveBonuses] = useState(true);
  const [pendingBonuses, setPendingBonuses] = useState('0');
  const [temporaryBenefits, setTemporaryBenefits] = useState('0');
  const [noticePay, setNoticePay] = useState('0');
  const [termsNotes, setTermsNotes] = useState('');
  const [preferredStaffId, setPreferredStaffId] = useState('');
  const busy = mutationKey?.startsWith('lifecycle:') ?? false;
  const activeEmployment = Boolean(snapshot.activeEmployment);
  const agreementNextResponder = String(activeAgreement?.metadata?.nextResponder ?? '');
  const agreementSignatures = activeAgreement?.metadata?.signatures as Record<string, unknown> | undefined;
  const mayAnswerAgreement = agreementNextResponder === 'professional';
  const maySignAgreement = activeAgreement?.status === 'accepted'
    && !agreementSignatures?.professional;
  const retirementNeedsDate = ['scheduled', 'planned'].includes(retirementType);
  const financialTerms = {
    confidentiality,
    preserveBonuses,
    pendingBonuses: Math.max(0, Number(pendingBonuses) || 0),
    temporaryBenefits: Math.max(0, Number(temporaryBenefits) || 0),
    noticePay: Math.max(0, Number(noticePay) || 0),
    ...(termsNotes.trim() ? { notes: termsNotes.trim() } : {}),
  };

  return (
    <section className="coach-career-lifecycle" aria-labelledby="coach-lifecycle-title">
      <header className="coach-career-lifecycle__header">
        <div><p className="eyebrow">CICLO PROFISSIONAL</p><h2 id="coach-lifecycle-title">Planejamento de vínculo e comissão</h2><p>Aviso prévio, afastamento, aposentadoria e acordos só produzem efeito após confirmação do servidor.</p></div>
        <div className="professional-cycle-tags">
          {activeNotice && <Badge tone="warning">Aviso até {formatDate(activeNotice.endsAt ?? activeNotice.effectiveAt)}</Badge>}
          {activeRetirement && <Badge tone="info">Aposentadoria {formatDate(activeRetirement.retirementAt)}</Badge>}
          {activeAgreement && <Badge tone={activeAgreement.status === 'signed' ? 'positive' : 'warning'}>Acordo {activeAgreement.status}</Badge>}
          {activeLeave && <Badge tone="warning">{activeLeave.leaveStatus === 'scheduled' ? 'Afastamento programado' : 'Afastado'} até {formatDate(activeLeave.expectedEndAt)}</Badge>}
          {!activeNotice && !activeRetirement && !activeAgreement && !activeLeave && <Badge tone="neutral">Sem transição ativa</Badge>}
        </div>
      </header>

      <div className="coach-career-lifecycle__form">
        <label>Data do aviso / acordo<input type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /></label>
        <label>Compensação<input type="number" min="0" step="1000" value={compensation} onChange={(event) => setCompensation(event.target.value)} /></label>
        <label>Motivo / condições<input maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Opcional" /></label>
        <label>Bônus pendentes<input type="number" min="0" step="1000" value={pendingBonuses} onChange={(event) => setPendingBonuses(event.target.value)} /></label>
        <label>Benefícios temporários<input type="number" min="0" step="1000" value={temporaryBenefits} onChange={(event) => setTemporaryBenefits(event.target.value)} /></label>
        <label>Indenização do aviso<input type="number" min="0" step="1000" value={noticePay} onChange={(event) => setNoticePay(event.target.value)} /></label>
        <label>Observações do acordo<input maxLength={500} value={termsNotes} onChange={(event) => setTermsNotes(event.target.value)} placeholder="Cláusulas ou condições adicionais" /></label>
        <label className="professional-cycle-check"><input type="checkbox" checked={preserveBonuses} onChange={(event) => setPreserveBonuses(event.target.checked)} /><span>Preservar bônus pendentes</span></label>
      </div>

      <div className="coach-career-lifecycle__grid">
        <article className="professional-cycle-card">
          <div className="professional-cycle-card__heading"><span><small>AVISO PRÉVIO</small><strong>{activeNotice ? `Em andamento · ${activeNotice.durationDays ?? '—'} dias` : 'Nenhum aviso ativo'}</strong></span><CalendarClock size={18} /></div>
          <label>Modalidade<select value={noticeType} onChange={(event) => setNoticeType(event.target.value as ProfessionalNoticeType)}><option value="standard">Aviso com prazo</option><option value="negotiated">Aviso negociado (acordo mútuo)</option><option value="immediate">Saída imediata</option></select></label>
          {activeNotice
            ? <><dl className="professional-cycle-facts"><div><dt>Início</dt><dd>{formatDate(activeNotice.startsAt)}</dd></div><div><dt>Saída prevista</dt><dd>{formatDate(activeNotice.endsAt ?? activeNotice.effectiveAt)}</dd></div><div><dt>Compensação</dt><dd>{formatMoney(activeNotice.compensation)}</dd></div></dl><small>O encerramento antecipado exige um sucessor com nomeação e contrato confirmados.</small><Button size="sm" variant="ghost" disabled={busy || !activeNotice.earlyExitAllowed} loading={mutationKey === 'lifecycle:notice_end_early'} onClick={() => onAction('notice_end_early', { lifecycleId: activeNotice.id, reason }, 'Aviso prévio encerrado antecipadamente.')}>Encerrar com sucessor contratado</Button></>
            : <Button size="sm" variant="ghost" disabled={busy || !activeEmployment || (noticeType !== 'immediate' && !effectiveAt)} loading={mutationKey === 'lifecycle:notice_start'} onClick={() => onAction('notice_start', {
              ...(noticeType === 'immediate' ? {} : { effectiveAt }),
              noticeType,
              immediateExit: noticeType === 'immediate',
              reason,
              terms: financialTerms,
            }, noticeType === 'immediate' ? 'Saída imediata confirmada.' : 'Aviso prévio iniciado.')}>Iniciar aviso prévio</Button>}
        </article>

        <article className="professional-cycle-card">
          <div className="professional-cycle-card__heading"><span><small>APOSENTADORIA</small><strong>{activeRetirement ? `${activeRetirement.retirementType} · ${activeRetirement.status}` : 'Sem plano anunciado'}</strong></span><History size={18} /></div>
          <label>Momento<select value={retirementType} onChange={(event) => setRetirementType(event.target.value as ProfessionalRetirementType)}><option value="scheduled">Data escolhida</option><option value="planned">Planejada</option><option value="end_season">Fim da temporada</option><option value="end_contract">Fim do contrato</option><option value="immediate">Imediata</option></select></label>
          <label>Data da aposentadoria<input type="date" value={retirementAt} disabled={!retirementNeedsDate} onChange={(event) => setRetirementAt(event.target.value)} /></label>
          <div className="professional-cycle-actions">
            {!activeRetirement
              ? <Button size="sm" variant="ghost" disabled={busy || (retirementNeedsDate && !retirementAt)} loading={mutationKey === 'lifecycle:retirement_announce'} onClick={() => onAction('retirement_announce', {
                ...(retirementNeedsDate ? { effectiveAt: retirementAt } : {}),
                retirementType,
                reason,
              }, retirementType === 'immediate' ? 'Aposentadoria efetivada.' : 'Aposentadoria anunciada.')}>Anunciar</Button>
              : <>
                <Button size="sm" variant="ghost" disabled={busy || !activeRetirement.canPostpone || !retirementAt} loading={mutationKey === 'lifecycle:retirement_postpone'} onClick={() => onAction('retirement_postpone', { lifecycleId: activeRetirement.id, effectiveAt: retirementAt }, 'Aposentadoria adiada.')}>Adiar</Button>
                <Button size="sm" variant="ghost" disabled={busy || !activeRetirement.canCancel} loading={mutationKey === 'lifecycle:retirement_cancel'} onClick={() => onAction('retirement_cancel', { lifecycleId: activeRetirement.id }, 'Aposentadoria cancelada.')}>Cancelar</Button>
              </>}
          </div>
        </article>

        <article className="professional-cycle-card">
          <div className="professional-cycle-card__heading"><span><small>ACORDO MÚTUO</small><strong>{activeAgreement ? `${activeAgreement.status} · rodada ${activeAgreement.negotiationRound}` : 'Sem negociação ativa'}</strong></span><FileSignature size={18} /></div>
          <label className="professional-cycle-check"><input type="checkbox" checked={confidentiality} onChange={(event) => setConfidentiality(event.target.checked)} /><span>Cláusula de confidencialidade</span></label>
          <div className="professional-cycle-actions">
            {!activeAgreement
              ? <Button size="sm" disabled={busy || !activeEmployment || !effectiveAt} loading={mutationKey === 'lifecycle:mutual_agreement_propose'} onClick={() => onAction('mutual_agreement_propose', { proposedExitAt: effectiveAt, compensation: Number(compensation) || 0, reason, terms: financialTerms }, 'Proposta de acordo enviada.')}>Propor acordo</Button>
              : <>
                {['proposed', 'countered'].includes(activeAgreement.status) && mayAnswerAgreement && <Button size="sm" variant="ghost" disabled={busy || !effectiveAt} loading={mutationKey === 'lifecycle:mutual_agreement_counter'} onClick={() => onAction('mutual_agreement_counter', { lifecycleId: activeAgreement.id, proposedExitAt: effectiveAt, compensation: Number(compensation) || 0, reason, terms: financialTerms }, 'Contraproposta enviada.')}>Contrapor</Button>}
                {['proposed', 'countered'].includes(activeAgreement.status) && mayAnswerAgreement && <Button size="sm" variant="ghost" disabled={busy} loading={mutationKey === 'lifecycle:mutual_agreement_accept'} onClick={() => onAction('mutual_agreement_accept', { lifecycleId: activeAgreement.id }, 'Acordo aceito.')}>Aceitar</Button>}
                {['proposed', 'countered'].includes(activeAgreement.status) && mayAnswerAgreement && <Button size="sm" variant="ghost" disabled={busy} loading={mutationKey === 'lifecycle:mutual_agreement_reject'} onClick={() => onAction('mutual_agreement_reject', { lifecycleId: activeAgreement.id }, 'Acordo rejeitado.')}>Rejeitar</Button>}
                {maySignAgreement && <Button size="sm" disabled={busy} loading={mutationKey === 'lifecycle:mutual_agreement_sign'} onClick={() => onAction('mutual_agreement_sign', { lifecycleId: activeAgreement.id }, 'Sua assinatura foi registrada.')}>Assinar acordo</Button>}
                {!mayAnswerAgreement && !maySignAgreement && activeAgreement.status !== 'signed' && <Badge tone="neutral">Aguardando a outra parte</Badge>}
              </>}
          </div>
        </article>

        <article className="professional-cycle-card">
          <div className="professional-cycle-card__heading"><span><small>AFASTAMENTO TEMPORÁRIO</small><strong>{activeLeave ? (activeLeave.leaveStatus === 'scheduled' ? 'Aguardando início' : 'Em andamento') : 'Nenhum afastamento aberto'}</strong></span><Clock3 size={18} /></div>
          {activeLeave
            ? <>
              <dl className="professional-cycle-facts">
                <div><dt>Início</dt><dd>{formatDate(activeLeave.startsAt)}</dd></div>
                <div><dt>Retorno previsto</dt><dd>{formatDate(activeLeave.expectedEndAt)}</dd></div>
                <div><dt>Pagamento</dt><dd>{activeLeave.payment?.type === 'unpaid' ? 'Não remunerado' : activeLeave.payment?.type === 'partial' ? `${Math.round((activeLeave.payment?.rate ?? 0) * 100)}% do salário` : 'Integral'}</dd></div>
                <div><dt>Contrato</dt><dd>{activeLeave.contractRemainsActive ? 'Permanece ativo' : 'A verificar'}</dd></div>
              </dl>
              <div className="professional-cycle-actions">
                {activeLeave.leaveStatus === 'scheduled'
                  ? <Button size="sm" variant="ghost" disabled={busy} loading={mutationKey === 'lifecycle:leave_cancel'} onClick={() => onAction('leave_cancel', { lifecycleId: activeLeave.id, reason: reason || 'Afastamento cancelado' }, 'Afastamento cancelado.')}>Cancelar afastamento</Button>
                  : <Button size="sm" variant="ghost" disabled={busy} loading={mutationKey === 'lifecycle:leave_end'} onClick={() => onAction('leave_end', { lifecycleId: activeLeave.id, reason: reason || 'Retorno antecipado' }, 'Retorno antecipado confirmado.')}>Antecipar retorno</Button>}
              </div>
            </>
            : <>
              <label>Início<input type="date" value={leaveStartsAt} onChange={(event) => setLeaveStartsAt(event.target.value)} /></label>
              <label>Retorno previsto<input type="date" value={leaveEndsAt} onChange={(event) => setLeaveEndsAt(event.target.value)} /></label>
              <label>Pagamento<select value={leavePaymentType} onChange={(event) => setLeavePaymentType(event.target.value as 'full' | 'partial' | 'unpaid')}><option value="full">Integral</option><option value="partial">Parcial</option><option value="unpaid">Não remunerado</option></select></label>
              {leavePaymentType === 'partial' && <label>Percentual<input type="number" min="1" max="99" value={leavePaymentRate} onChange={(event) => setLeavePaymentRate(event.target.value)} /></label>}
              <Button size="sm" variant="ghost" disabled={busy || !activeEmployment || !reason.trim() || !leaveStartsAt || !leaveEndsAt || leaveEndsAt <= leaveStartsAt} loading={mutationKey === 'lifecycle:leave_start'} onClick={() => onAction('leave_start', {
                startsAt: leaveStartsAt,
                expectedEndAt: leaveEndsAt,
                reason: reason.trim(),
                paymentType: leavePaymentType,
                ...(leavePaymentType === 'partial' ? { paymentRate: Math.max(0.01, Math.min(0.99, Number(leavePaymentRate) / 100 || 0.5)) } : {}),
              }, 'Afastamento registrado. O contrato permanece ativo.')}>Registrar afastamento</Button>
            </>}
        </article>
      </div>

      <article className="professional-cycle-card coach-career-preferred-staff">
        <div className="professional-cycle-card__heading"><span><small>COMISSÃO PREFERENCIAL</small><strong>{lifecycle.preferredStaff.length} profissional(is) de confiança</strong></span><Sparkles size={18} /></div>
        <div className="coach-career-preferred-staff__list">
          {lifecycle.preferredStaff.map((member) => <span key={member.staffId}><strong>{member.name}</strong><small>{member.roleLabel ?? member.role}{member.affinity !== null ? ` · afinidade ${Math.round(member.affinity)}%` : ''}</small><button type="button" disabled={busy} onClick={() => onAction('preferred_staff_update', { staffId: member.staffId, preferred: false }, `${member.name} removido da comissão preferencial.`)} aria-label={`Remover ${member.name}`}><X size={13} /></button></span>)}
          {!lifecycle.preferredStaff.length && <p>Nenhum profissional marcado. Use o ID exibido na comissão técnica.</p>}
        </div>
        <div className="professional-cycle-inline-form"><input value={preferredStaffId} onChange={(event) => setPreferredStaffId(event.target.value)} placeholder="ID do profissional" /><Button size="sm" variant="ghost" disabled={busy || !preferredStaffId.trim()} loading={mutationKey === 'lifecycle:preferred_staff_update'} onClick={() => {
          const staffId = preferredStaffId.trim();
          onAction('preferred_staff_update', { staffId, preferred: true }, 'Comissão preferencial atualizada.');
          setPreferredStaffId('');
        }}>Adicionar</Button></div>
      </article>

      {lifecycle.transitions.length > 0 && <div className="coach-career-lifecycle__timeline">{[...lifecycle.transitions].slice(-3).reverse().map((entry) => <span key={entry.id}><Badge tone="neutral">{entry.status}</Badge><strong>{entry.title}</strong><small>{formatDate(entry.createdAt)}{entry.description ? ` · ${entry.description}` : ''}</small></span>)}</div>}
    </section>
  );
}

function ProposalsTab({
  snapshot,
  mutationKey,
  onRespond,
  onMoreTime,
  onNegotiate,
  onEndNegotiation,
  onProvideInformation,
}: {
  snapshot: CoachCareerSnapshot;
  mutationKey: string | null;
  onRespond: (proposal: CoachProposal, decision: 'accept' | 'reject') => void;
  onMoreTime: (proposal: CoachProposal) => void;
  onNegotiate: (proposal: CoachProposal) => void;
  onEndNegotiation: (proposal: CoachProposal) => void;
  onProvideInformation: (proposal: CoachProposal) => void;
}) {
  if (!snapshot.proposals.length) return <EmptyState icon={FileSignature} title="Nenhuma proposta recebida">Os convites compatíveis com seu perfil e sua reputação aparecerão aqui.</EmptyState>;
  return (
    <div className="coach-career-card-grid">
      {snapshot.proposals.map((proposal) => {
        const dynamic = dynamicProposal(proposal);
        const expired = isPast(proposal.deadline);
        const busy = mutationKey?.includes(proposal.id) ?? false;
        const progress = proposalProgressCopy(proposal, expired);
        const competitors = competingOfferCount(proposal);
        const maxRounds = dynamic.maxNegotiationRounds ?? 4;
        const decisionFactors = dynamic.decisionFactors ?? [];
        const actions = expired ? {
          accept: false, reject: false, counter: false, requestMoreTime: false, withdraw: false, provideInformation: false,
        } : proposal.availableActions;
        const hasActions = Object.values(actions).some(Boolean);
        return (
          <article className="coach-career-card coach-career-proposal" key={proposal.id}>
            <header>
              <ClubMark {...clubMarkProps(proposal.club)} size="lg" />
              <div><p className="eyebrow">{proposalKindEyebrow(proposal)}</p><h3>{proposal.club.name}</h3><p>{proposalKindLabel(proposal)} · {proposal.role}</p></div>
              <Badge tone={proposalTone(expired ? 'expired' : proposal.status)}>{expired ? 'Expirada' : proposalStatusLabel(proposal.status)}</Badge>
            </header>
            <div className="coach-career-card__facts">
              <span><CircleDollarSign size={14} /> Salário<strong>{formatMoney(proposal.terms.salary)}</strong></span>
              <span><CalendarClock size={14} /> Duração<strong>{proposal.terms.durationMonths ? `${Math.round(proposal.terms.durationMonths / 12)} ano(s)` : 'A negociar'}</strong></span>
              <span><ClipboardCheck size={14} /> Etapa<strong>{marketStageLabel(dynamic.marketStage)}</strong></span>
              <span><RefreshCw size={14} /> Rodadas de negociação<strong>{proposal.negotiationRound}/{maxRounds}</strong></span>
              <span><TrendingUp size={14} /> Orçamento<strong>{formatMoney(proposal.availableBudget)}</strong></span>
              <span><CircleDollarSign size={14} /> Verba prometida<strong>{formatMoney(proposal.terms.transferBudget)}</strong></span>
              <span><Building2 size={14} /> Concorrência<strong>{competitors > 0 ? `${competitors} outra${competitors > 1 ? 's' : ''} proposta${competitors > 1 ? 's' : ''}` : 'Sem oferta concorrente'}</strong></span>
              <span><MessageSquareText size={14} /> Entrevista<strong>{dynamic.interviewCompatibility === null || dynamic.interviewCompatibility === undefined ? 'Não realizada' : `${Math.round(dynamic.interviewCompatibility)}% compatível`}</strong></span>
              {proposal.interviewId && <span><Sparkles size={14} /> Autonomia<strong>{signedValue(proposal.autonomyDelta)}</strong></span>}
              {proposal.interviewId && <span><TrendingUp size={14} /> Prioridade<strong>{signedValue(proposal.priorityDelta)}</strong></span>}
              {proposal.interviewId && <span><Target size={14} /> Exigência das metas<strong>{signedValue(proposal.objectiveDifficultyDelta)}</strong></span>}
              <span><Clock3 size={14} /> Prazo<strong>{formatDate(proposal.deadline)}</strong></span>
            </div>
            {(proposal.boardExpectation || proposal.clubSituation || proposal.message || dynamic.decisionReason || decisionFactors.length > 0) && (
              <div className="coach-career-card__copy">
                {proposal.boardExpectation && <p><strong>Expectativa:</strong> {proposal.boardExpectation}</p>}
                {proposal.clubSituation && <p><strong>Situação:</strong> {proposal.clubSituation}</p>}
                {proposal.message && <p>{proposal.message}</p>}
                {dynamic.decisionReason && <p><strong>Motivo da decisão:</strong> {decisionReasonLabel(dynamic.decisionReason)}{dynamic.decisionScore !== null && dynamic.decisionScore !== undefined ? ` (${Math.round(dynamic.decisionScore)}/100)` : ''}</p>}
                {decisionFactors.length > 0 && <p><strong>Fatores avaliados:</strong> {decisionFactors.slice(0, 5).map((factor) => `${factor.label ?? factor.code ?? 'Fator'}${typeof factor.value === 'number' ? ` (${factor.value > 0 ? '+' : ''}${factor.value})` : ''}${factor.detail ? ` — ${factor.detail}` : ''}`).join(' · ')}</p>}
              </div>
            )}
            {proposal.objectives.length > 0 && (
              <ul className="coach-career-mini-list">{proposal.objectives.slice(0, 3).map((objective) => <li key={objective.id}><Target size={13} />{objective.label}</li>)}</ul>
            )}
            {proposal.terms.specialClauses.length > 0 && (
              <ul className="coach-career-mini-list">{proposal.terms.specialClauses.slice(0, 3).map((clause) => <li key={clause}><FileSignature size={13} />{clause}</li>)}</ul>
            )}
            {progress && (
              <div className="coach-career-negotiation-state" role="status"><Clock3 size={16} /><div><strong>{progress.title}</strong><p>{progress.copy}</p></div></div>
            )}
            {proposal.informationRequest && (
              <div className="coach-career-information-request">
                <MessageSquareText size={17} />
                <div><strong>Informação solicitada pela diretoria</strong><p>{proposal.informationRequest.question}</p>{proposal.informationRequest.requestedAt && <time>{formatDate(proposal.informationRequest.requestedAt)}</time>}</div>
                {actions.provideInformation && <Button size="sm" icon={<Send size={14} />} disabled={busy} onClick={() => onProvideInformation(proposal)}>Responder</Button>}
              </div>
            )}
            {proposal.guarantees.length > 0 && (
              <section className="coach-career-guarantees" aria-label="Garantias negociadas">
                <header><strong>Garantias negociadas</strong><span>{proposal.guarantees.length}</span></header>
                {proposal.guarantees.map((item) => (
                  <article key={item.id}>
                    <div><strong>{item.description}</strong><Badge tone={guaranteeTone(item.status)}>{guaranteeLabels[item.status] ?? item.status.replaceAll('_', ' ')}</Badge></div>
                    <dl>
                      <div><dt>Responsável</dt><dd>{item.responsibleName ?? 'A definir'}</dd></div>
                      <div><dt>Prazo</dt><dd>{formatDate(item.dueAt)}</dd></div>
                    </dl>
                    {item.blocksCompletion && <p className="coach-career-guarantee-block"><ShieldAlert size={13} /> Obrigatória: bloqueia a conclusão até ser formalizada.</p>}
                    {item.effects.length > 0 && <ul>{item.effects.map((effect) => <li key={effect.id}><Check size={12} />{effect.label}{effect.value !== null ? `: ${String(effect.value)}` : ''}</li>)}</ul>}
                  </article>
                ))}
              </section>
            )}
            {proposal.decisionHistory.length > 0 && (
              <details className="coach-career-decision-history">
                <summary>Trilha da negociação ({proposal.decisionHistory.length})</summary>
                <ol>{proposal.decisionHistory.map((decision) => (
                  <li key={decision.id}>
                    <span />
                    <div><strong>{decisionActionLabel(decision.action)}</strong><p>{proposalStatusLabel(decision.previousStatus)} → {proposalStatusLabel(decision.newStatus)}</p>{decision.justification && <em>{decision.justification}</em>}<small>{decision.actorName ?? 'Rotina da diretoria'}{decision.actorRole ? ` · ${decision.actorRole}` : ''} · {formatDate(decision.createdAt)}</small></div>
                  </li>
                ))}</ol>
              </details>
            )}
            {hasActions && (
              <footer>
                {actions.accept && <Button size="sm" variant="primary" icon={<Check size={14} />} loading={busy && mutationKey === `proposal:${proposal.id}`} onClick={() => onRespond(proposal, 'accept')}>Aceitar</Button>}
                {actions.counter && <Button size="sm" icon={<MessageSquareText size={14} />} disabled={busy} onClick={() => onNegotiate(proposal)}>Negociar</Button>}
                {actions.requestMoreTime && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMoreTime(proposal)}>Pedir prazo</Button>}
                {actions.provideInformation && !proposal.informationRequest && <Button size="sm" icon={<Send size={14} />} disabled={busy} onClick={() => onProvideInformation(proposal)}>Enviar informações</Button>}
                {actions.reject && <Button size="sm" variant="danger" icon={<X size={14} />} disabled={busy} onClick={() => onRespond(proposal, 'reject')}>Recusar</Button>}
                {actions.withdraw && <Button size="sm" variant="danger" icon={<X size={14} />} disabled={busy} onClick={() => onEndNegotiation(proposal)}>Encerrar negociação</Button>}
              </footer>
            )}
          </article>
        );
      })}
    </div>
  );
}

const vacancyTierLabels: Record<string, string> = {
  elite: 'Elite',
  established: 'Consolidado',
  development: 'Desenvolvimento',
  small: 'Clube emergente',
};

const vacancyStrictnessLabels: Record<string, string> = {
  strict: 'Seleção rigorosa',
  balanced: 'Seleção equilibrada',
  flexible: 'Perfil flexível',
};

const coachStyleLabels: Record<string, string> = {
  attacking: 'Ofensivo',
  counter_attack: 'Contra-ataque',
  high_press: 'Pressão alta',
  possession: 'Posse de bola',
  solid_defense: 'Defesa sólida',
};

function coachStyleLabel(value: string): string {
  return coachStyleLabels[value] ?? value.replaceAll('_', ' ');
}

function VacancyProfileSummary({
  vacancy,
  assessment = null,
}: {
  vacancy: CoachVacancy;
  assessment?: CoachCandidateAssessment | null;
}) {
  const profile = vacancy.desiredProfile;
  if (!profile) return null;
  const preferredStyles = profile.playingStyle.preferred.map(coachStyleLabel).join(', ');
  const requiredAchievements = [
    profile.achievements.minimumNationalTitles > 0 ? `${profile.achievements.minimumNationalTitles} título(s) nacional(is)` : null,
    profile.achievements.minimumCups > 0 ? `${profile.achievements.minimumCups} copa(s)` : null,
    profile.achievements.minimumContinentalTitles > 0 ? `${profile.achievements.minimumContinentalTitles} título(s) continental(is)` : null,
    profile.achievements.minimumPromotions > 0 ? `${profile.achievements.minimumPromotions} acesso(s)` : null,
  ].filter(Boolean);
  const visibleFactors = assessment?.factors
    .filter((factor) => factor.weight > 0)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 6) ?? [];
  return (
    <section className="coach-career-vacancy-profile">
      <header>
        <div>
          <strong>Perfil desejado</strong>
          <span>{vacancyStrictnessLabels[profile.strictness] ?? profile.strictness}</span>
        </div>
        <Badge tone={profile.strictness === 'strict' ? 'warning' : 'info'}>
          {vacancyTierLabels[profile.tier] ?? profile.tier}
        </Badge>
      </header>
      <div className="coach-career-vacancy-profile__facts">
        <span>Licença mínima<strong>{profile.license.minimum}{profile.license.allowEquivalent ? ' ou equivalente' : ''}</strong></span>
        <span>Experiência<strong>{profile.experience.minimumYears} anos</strong></span>
        <span>Faixa salarial<strong>{formatMoney(profile.salary.minimum)} – {formatMoney(profile.salary.maximum)}</strong></span>
        <span>Estilo<strong>{preferredStyles || 'Adaptável'}</strong></span>
        <span>Formação<strong>{profile.playingStyle.preferredFormation ?? 'Sem preferência'}</strong></span>
        <span>Idioma<strong>{profile.geography.requiredLanguage?.toUpperCase() ?? 'Não obrigatório'}</strong></span>
      </div>
      {(requiredAchievements.length > 0 || profile.achievements.prioritizeYouthDevelopment || profile.achievements.prioritizeLeagueSurvival) && (
        <p>
          <strong>Prioridades:</strong>{' '}
          {[
            ...requiredAchievements,
            profile.achievements.prioritizeYouthDevelopment ? 'desenvolvimento de jovens' : null,
            profile.achievements.prioritizeLeagueSurvival ? 'experiência contra rebaixamento' : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {assessment && (
        <div className={`coach-career-candidate-fit${assessment.eligible ? ' is-eligible' : ' is-blocked'}`}>
          <header>
            <span>{assessment.eligible ? <BadgeCheck size={15} /> : <ShieldAlert size={15} />} Compatibilidade do seu perfil</span>
            <strong>{Math.round(assessment.score)}%</strong>
          </header>
          {assessment.hardBlockers.length > 0 && (
            <ul>
              {assessment.hardBlockers.map((blocker) => (
                <li key={blocker.code}>{blocker.label}{blocker.detail ? `: ${blocker.detail}` : ''}</li>
              ))}
            </ul>
          )}
          {visibleFactors.length > 0 && (
            <div className="coach-career-candidate-fit__factors">
              {visibleFactors.map((factor) => (
                <span key={factor.code}>
                  {factor.label}
                  <strong>{Math.round(factor.rawScore)}%</strong>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function VacanciesTab({
  snapshot,
  mutationKey,
  onSearch,
  onApply,
}: {
  snapshot: CoachCareerSnapshot;
  mutationKey: string | null;
  onSearch: () => void;
  onApply: (vacancy: CoachVacancy) => void;
}) {
  const applications = new Map(snapshot.applications.map((application) => [application.vacancyId, application]));
  return (
    <>
      <div className="coach-career-list-toolbar">
        <div><p className="eyebrow">MERCADO DE TREINADORES</p><strong>{snapshot.vacancies.length} processo(s) disponível(is)</strong></div>
        <Button size="sm" icon={<Search size={14} />} loading={mutationKey === 'search'} onClick={onSearch}>Atualizar busca</Button>
      </div>
      {!snapshot.vacancies.length ? <EmptyState icon={UserRoundSearch} title="Nenhuma vaga disponível">Ative a busca de emprego para acompanhar os próximos processos seletivos.</EmptyState> : (
        <div className="coach-career-card-grid">
          {snapshot.vacancies.map((vacancy) => {
            const application = applications.get(vacancy.id);
            const open = vacancy.status === 'open' && !isPast(vacancy.deadline);
            return (
              <article className="coach-career-card coach-career-vacancy" key={vacancy.id}>
                <header>
                  <ClubMark {...clubMarkProps(vacancy.club)} size="lg" />
                  <div><p className="eyebrow">{vacancy.country ?? 'PAÍS NÃO INFORMADO'} · {vacancy.competition ?? 'COMPETIÇÃO NÃO INFORMADA'}</p><h3>{vacancy.club.name}</h3><p>{vacancy.reason ?? 'Clube em busca de treinador'}</p></div>
                  <Badge tone={vacancyTone(vacancy.status)}>{vacancyLabels[vacancy.status]}</Badge>
                </header>
                <div className="coach-career-card__facts">
                  <span><Trophy size={14} /> Posição<strong>{vacancy.currentPosition ?? 'Não informada'}</strong></span>
                  <span><Sparkles size={14} /> Reputação<strong>{vacancy.club.reputation ?? '—'}</strong></span>
                  <span><CircleDollarSign size={14} /> Orçamento<strong>{formatMoney(vacancy.availableBudget)}</strong></span>
                  <span><Clock3 size={14} /> Candidaturas até<strong>{formatDate(vacancy.deadline)}</strong></span>
                </div>
                <div className="coach-career-card__copy">
                  <p><strong>Objetivo:</strong> {vacancy.objective ?? 'Será definido durante a entrevista'}</p>
                  <p><strong>Finanças:</strong> {vacancy.financialSituation ?? 'Não divulgadas'}</p>
                  {vacancy.squadSummary && <p><strong>Elenco:</strong> {vacancy.squadSummary}</p>}
                </div>
                <VacancyProfileSummary vacancy={vacancy} assessment={application?.candidateAssessment} />
                <div className="coach-career-interest">
                  <span>Interesse no seu perfil</span><strong>{vacancy.interestLevel === null ? 'Não avaliado' : `${Math.round(vacancy.interestLevel)}%`}</strong>
                  {vacancy.interestLevel !== null && <div><span style={{ width: `${Math.max(0, Math.min(100, vacancy.interestLevel))}%` }} /></div>}
                </div>
                <footer>
                  {application
                    ? <Badge tone={applicationTone(application.status)}><ClipboardCheck size={13} /> {applicationLabels[application.status]}</Badge>
                    : <Button size="sm" variant="primary" icon={<Send size={14} />} disabled={!open} loading={mutationKey === `vacancy:${vacancy.id}`} onClick={() => onApply(vacancy)}>{open ? 'Candidatar-se' : 'Candidaturas encerradas'}</Button>}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

const interviewDepthOptions: Array<{ id: CoachInterviewDepth; label: string; detail: string }> = [
  { id: 'quick', label: 'Rápida', detail: 'Conversa objetiva e adaptativa' },
  { id: 'standard', label: 'Padrão', detail: 'Análise contextual equilibrada' },
  { id: 'deep', label: 'Profunda', detail: 'Mais temas e aprofundamentos' },
];

const interviewMetricLabels: Record<string, string> = {
  boardConfidence: 'Confiança da diretoria',
  clubCompatibility: 'Compatibilidade com o clube',
  squadCompatibility: 'Compatibilidade com o elenco',
  leadership: 'Liderança',
  tacticalVision: 'Visão tática',
  financialAlignment: 'Alinhamento financeiro',
  longTermPotential: 'Potencial de longo prazo',
  culturalFit: 'Compatibilidade cultural',
  credibility: 'Credibilidade',
  perceivedRisk: 'Risco percebido',
};

const interviewRecommendationLabels = {
  hire: 'Contratar',
  hire_with_reservations: 'Contratar com ressalvas',
  negotiate: 'Negociar melhores condições',
  observe: 'Manter em observação',
  reject: 'Não contratar',
} as const;

const relationshipLabels: Record<string, string> = {
  boardConfidenceDelta: 'Confiança da diretoria',
  credibilityDelta: 'Credibilidade',
  strategicAlignmentDelta: 'Alinhamento estratégico',
  culturalCompatibilityDelta: 'Compatibilidade cultural',
  perceivedRiskDelta: 'Risco percebido',
  expectedTenureDelta: 'Expectativa de permanência',
};

function isDynamicInterview(interview: CoachInterview): boolean {
  return interview.mode !== 'legacy';
}

function isFinishedInterview(interview: CoachInterview): boolean {
  return Boolean(interview.evaluation) || ['completed', 'accepted', 'rejected', 'expired', 'cancelled', 'contratado', 'encerrado_vaga_preenchida'].includes(interview.status);
}

function signedValue(value: number): string {
  return `${value > 0 ? '+' : ''}${Math.round(value)}`;
}

function DynamicInterviewPanel({
  interview,
  depth,
  message,
  loading,
  onDepthChange,
  onMessageChange,
  onStart,
  onSend,
}: {
  interview: CoachInterview;
  depth: CoachInterviewDepth;
  message: string;
  loading: boolean;
  onDepthChange: (depth: CoachInterviewDepth) => void;
  onMessageChange: (message: string) => void;
  onStart: () => void;
  onSend: () => void;
}) {
  const finished = isFinishedInterview(interview);
  const started = interview.transcript.length > 0 || Boolean(interview.currentQuestionId) || finished;
  const lastBoardMessage = [...interview.transcript].reverse().find((entry) => entry.role === 'board');
  const canReply = !finished && started && Boolean(interview.currentQuestionId ?? lastBoardMessage?.id);
  const recommendation = interview.evaluation?.recommendation;
  const recommendationTone = recommendation === 'hire'
    ? 'positive'
    : recommendation === 'reject' ? 'danger' : 'warning';

  return (
    <div className="coach-career-interview-chat">
      {!started && (
        <section className="coach-career-interview-setup">
          <MessageSquareText size={28} />
          <div>
            <h3>Defina a profundidade da conversa</h3>
            <p>A diretoria adaptará as próximas perguntas às suas respostas e ao momento do clube.</p>
          </div>
          <div className="coach-career-interview-depth" role="radiogroup" aria-label="Profundidade da entrevista">
            {interviewDepthOptions.map((option) => (
              <button type="button" key={option.id} role="radio" aria-checked={depth === option.id} onClick={() => onDepthChange(option.id)}>
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>
          <Button variant="primary" icon={<MessageSquareText size={14} />} loading={loading} onClick={onStart}>Iniciar entrevista</Button>
        </section>
      )}

      {started && (
        <>
          <header className="coach-career-interview-chat__header">
            <div><span>Conversa em andamento</span><strong>{interview.turnCount} {interview.turnCount === 1 ? 'resposta' : 'respostas'}</strong></div>
            <div className="coach-career-interview-progress" aria-label={`Etapa ${interview.turnCount}; duração adaptativa`}>
              <span style={{ width: `${finished ? 100 : Math.min(92, Math.max(8, (interview.turnCount / Math.max(1, interview.minTurns + 1)) * 72))}%` }} />
            </div>
            <Badge tone={interview.source === 'fallback' ? 'warning' : finished ? 'positive' : 'info'}>
              {interview.source === 'fallback' ? 'Modo de contingência' : finished ? 'Concluída' : interview.depth === 'quick' ? 'Rápida' : interview.depth === 'deep' ? 'Profunda' : 'Padrão'}
            </Badge>
          </header>

          <div className="coach-career-interview-transcript" aria-live="polite">
            {interview.transcript.map((entry) => (
              <article className={`coach-career-interview-message coach-career-interview-message--${entry.role}`} key={entry.id}>
                <div>
                  <strong>{entry.role === 'board' ? 'Diretoria' : 'Você'}</strong>
                  {entry.topic && <span>{entry.topic.replaceAll('_', ' ')}</span>}
                </div>
                <p>{entry.text}</p>
              </article>
            ))}
            {loading && <div className="coach-career-interview-thinking"><LoaderCircle className="spin" size={16} /> A diretoria está analisando sua resposta…</div>}
          </div>

          {!finished && (
            <div className="coach-career-interview-composer">
              <textarea
                rows={4}
                maxLength={1500}
                value={message}
                disabled={loading || !canReply}
                placeholder={canReply ? 'Responda com suas próprias palavras…' : 'Aguardando a próxima pergunta…'}
                onChange={(event) => onMessageChange(event.target.value)}
              />
              <div><span>{message.length}/1500</span><Button variant="primary" icon={<Send size={14} />} loading={loading} disabled={!canReply || message.trim().length < 2} onClick={onSend}>Enviar resposta</Button></div>
            </div>
          )}

          {interview.evaluation && (
            <section className="coach-career-interview-evaluation">
              <header>
                <div><p className="eyebrow">AVALIAÇÃO FINAL</p><h3>{interview.evaluation.overallScore}/100</h3></div>
                <Badge tone={recommendationTone}>{recommendation ? interviewRecommendationLabels[recommendation] : 'Em análise'}</Badge>
              </header>
              {interview.evaluation.summary && <p className="coach-career-interview-evaluation__summary">{interview.evaluation.summary}</p>}
              {interview.memorySummary && <p className="coach-career-interview-evaluation__summary"><strong>Memória da diretoria:</strong> {interview.memorySummary}</p>}
              <div className="coach-career-interview-metrics">
                {Object.entries(interview.evaluation.metrics).map(([name, score]) => (
                  <div key={name}><span>{interviewMetricLabels[name] ?? name}</span><strong>{Math.round(score)}</strong><i><span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></i></div>
                ))}
              </div>
              {(interview.evaluation.strengths.length > 0 || interview.evaluation.risks.length > 0) && (
                <div className="coach-career-interview-findings">
                  <div><strong>Pontos fortes</strong>{interview.evaluation.strengths.length ? <ul>{interview.evaluation.strengths.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nenhum destaque registrado.</p>}</div>
                  <div><strong>Riscos</strong>{interview.evaluation.risks.length ? <ul>{interview.evaluation.risks.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nenhum risco relevante.</p>}</div>
                </div>
              )}
              {interview.relationshipImpact && (
                <div className="coach-career-interview-impact">
                  <strong>Impacto na relação</strong>
                  <div>{Object.entries(interview.relationshipImpact).map(([name, value]) => <span key={name}>{relationshipLabels[name] ?? name}<b className={value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : ''}>{signedValue(value)}</b></span>)}</div>
                </div>
              )}
              {interview.negotiationEffects && (
                <details className="coach-career-interview-negotiation">
                  <summary>Impactos previstos na negociação</summary>
                  <div>
                    <span>Salário <b>{Math.round((interview.negotiationEffects.salaryMultiplier - 1) * 100)}%</b></span>
                    <span>Duração <b>{signedValue(interview.negotiationEffects.durationYearsDelta)} ano(s)</b></span>
                    <span>Orçamento <b>{Math.round((interview.negotiationEffects.transferBudgetMultiplier - 1) * 100)}%</b></span>
                    <span>Autonomia <b>{signedValue(interview.negotiationEffects.autonomyDelta)}</b></span>
                    <span>Prioridade <b>{signedValue(interview.negotiationEffects.priorityDelta)}</b></span>
                    <span>Exigência das metas <b>{signedValue(interview.negotiationEffects.objectiveDifficultyDelta)}</b></span>
                  </div>
                  {interview.negotiationEffects.terminateNegotiation && <p><strong>Decisão:</strong> a diretoria encerrou a negociação após a entrevista.</p>}
                  {interview.negotiationEffects.objectives.length > 0 && <p><strong>Objetivos:</strong> {interview.negotiationEffects.objectives.join(' · ')}</p>}
                  {interview.negotiationEffects.specialClauses.length > 0 && <p><strong>Cláusulas:</strong> {interview.negotiationEffects.specialClauses.join(' · ')}</p>}
                </details>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function InterviewsTab({
  snapshot,
  mutationKey,
  onAnswer,
}: {
  snapshot: CoachCareerSnapshot;
  mutationKey: string | null;
  onAnswer: (interview: CoachInterview) => void;
}) {
  if (!snapshot.interviews.length && !snapshot.applications.length) return <EmptyState icon={MessageSquareText} title="Nenhum processo em andamento">Entrevistas e o andamento das suas candidaturas aparecerão aqui.</EmptyState>;
  return (
    <div className="coach-career-processes">
      {snapshot.interviews.length > 0 && (
        <Panel title="Entrevistas" eyebrow="PROCESSOS SELETIVOS">
          <div className="coach-career-process-list">
            {snapshot.interviews.map((interview) => {
              const dynamic = isDynamicInterview(interview);
              const canAnswer = dynamic
                ? !isPast(interview.deadline)
                : (interview.status === 'pending' || interview.status === 'scheduled' || interview.status === 'awaiting_answers') && interview.questions.length > 0 && !isPast(interview.deadline);
              const canOpen = dynamic || canAnswer;
              const actionLabel = dynamic
                ? isFinishedInterview(interview) ? 'Ver entrevista' : interview.transcript.length > 0 ? 'Continuar' : 'Iniciar'
                : 'Responder';
              return (
                <article key={interview.id}>
                  <ClubMark {...clubMarkProps(interview.club)} size="md" />
                  <div><strong>{interview.club.name}</strong><p>{interviewLabels[interview.status]} · prazo {formatDate(interview.deadline)}</p>{interview.outcome && <em>{interview.outcome}</em>}</div>
                  {interview.compatibility !== null && <Badge tone={interview.compatibility >= 70 ? 'positive' : interview.compatibility >= 45 ? 'warning' : 'danger'}>{Math.round(interview.compatibility)}% compatível</Badge>}
                  {canOpen && <Button size="sm" icon={<MessageSquareText size={14} />} loading={mutationKey?.endsWith(`:${interview.id}`)} onClick={() => onAnswer(interview)}>{actionLabel}</Button>}
                </article>
              );
            })}
          </div>
        </Panel>
      )}
      {snapshot.applications.length > 0 && (
        <Panel title="Minhas candidaturas" eyebrow="ACOMPANHAMENTO">
          <div className="coach-career-process-list">
            {snapshot.applications.map((application) => (
              <article key={application.id}>
                <span className="coach-career-process-icon"><ClipboardCheck size={17} /></span>
                <div><strong>{application.club?.name ?? 'Processo seletivo'}</strong><p>{application.closedAt ? `Encerrada em ${formatDate(application.closedAt)}` : `Enviada em ${formatDate(application.submittedAt)}`}</p>{application.feedback && <em>{application.feedback}</em>}{application.closureReason && <em>Motivo: {application.closureReason}{application.closedBy ? ` · ${application.closedBy}` : ''}</em>}</div>
                <Badge tone={applicationTone(application.status)}>{applicationLabels[application.status]}</Badge>
              </article>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

type CareerHistorySection = 'summary' | 'timeline' | 'clubs' | 'statistics' | 'titles' | 'negotiations' | 'reputation' | 'achievements' | 'financial';

const careerHistorySections: Array<{ id: CareerHistorySection; label: string }> = [
  { id: 'summary', label: 'Resumo' },
  { id: 'timeline', label: 'Linha do tempo' },
  { id: 'clubs', label: 'Clubes' },
  { id: 'statistics', label: 'Estatísticas' },
  { id: 'titles', label: 'Títulos' },
  { id: 'negotiations', label: 'Negociações' },
  { id: 'reputation', label: 'Reputação' },
  { id: 'achievements', label: 'Conquistas' },
  { id: 'financial', label: 'Histórico financeiro' },
];

function historyNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function historyPercentage(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${historyNumber(value, value % 1 === 0 ? 0 : 1)}%`;
}

function historyMoney(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : formatMoney(value);
}

function historyDate(value: string | null | undefined) {
  return value ? formatDate(value) : '—';
}

function historyLabel(value: string | null | undefined, fallback = '—') {
  if (!value?.trim()) return fallback;
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase('pt-BR'));
}

function dateDistanceDays(startedAt: string | null, endedAt: string | null) {
  if (!startedAt) return null;
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

function historyDuration(days: number | null | undefined, startedAt?: string | null, endedAt?: string | null) {
  const total = days ?? dateDistanceDays(startedAt ?? null, endedAt ?? null);
  if (total === null || total === undefined || !Number.isFinite(total)) return '—';
  const years = Math.floor(total / 365);
  const months = Math.floor((total % 365) / 30);
  const remainingDays = Math.floor(total % 30);
  const parts = [
    years > 0 ? `${years} ${years === 1 ? 'ano' : 'anos'}` : '',
    months > 0 ? `${months} ${months === 1 ? 'mês' : 'meses'}` : '',
    years === 0 && remainingDays > 0 ? `${remainingDays} ${remainingDays === 1 ? 'dia' : 'dias'}` : '',
  ].filter(Boolean);
  return parts.join(' e ') || '0 dias';
}

function legacyCareerSpell(assignment: CoachCareerSnapshot['assignments'][number], index: number): CoachCareerHistorySpell {
  const matches = assignment.matches ?? (
    assignment.wins !== null && assignment.draws !== null && assignment.losses !== null
      ? assignment.wins + assignment.draws + assignment.losses
      : null
  );
  const winRate = matches && assignment.wins !== null ? (assignment.wins / matches) * 100 : null;
  const titleEntries: CoachCareerHistoryTitle[] = assignment.titles.map((title, titleIndex) => ({
    id: `${assignment.id}:title:${titleIndex}`,
    name: title,
    type: null,
    competition: null,
    season: null,
    wonAt: null,
    club: assignment.club,
  }));
  return {
    ...assignment,
    id: assignment.id || `legacy-assignment-${index + 1}`,
    country: assignment.club.country,
    division: assignment.club.competition,
    durationDays: dateDistanceDays(assignment.startedAt, assignment.endedAt),
    startedSeason: null,
    endedSeason: null,
    initialSalary: null,
    finalSalary: null,
    reputationStart: null,
    reputationEnd: null,
    metrics: {
      matches,
      wins: assignment.wins,
      draws: assignment.draws,
      losses: assignment.losses,
      goalsFor: null,
      goalsAgainst: null,
      goalDifference: null,
      points: null,
      pointsPerGame: null,
      winRate,
      longestWinningStreak: null,
      longestWinlessStreak: null,
    },
    contracts: [],
    renewals: [],
    titleEntries,
    achievements: [],
    development: {
      youthPromoted: null,
      signings: null,
      sales: null,
      squadValueStart: null,
      squadValueEnd: null,
    },
  };
}

function sumKnown(values: Array<number | null | undefined>) {
  const known = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}

function historySearchKey(value: unknown) {
  const serialized = typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? ''
      : JSON.stringify(value);
  return serialized
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function HistoryTab({ snapshot }: { snapshot: CoachCareerSnapshot }) {
  const [section, setSection] = useState<CareerHistorySection>('summary');
  const [query, setQuery] = useState('');
  const selectHistorySection = (next: CareerHistorySection) => {
    setSection(next);
    requestAnimationFrame(() => document.getElementById(`career-history-tab-${next}`)?.focus());
  };
  const handleHistoryTabsKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const currentIndex = careerHistorySections.findIndex((item) => item.id === section);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % careerHistorySections.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + careerHistorySections.length) % careerHistorySections.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = careerHistorySections.length - 1;
    else return;
    event.preventDefault();
    selectHistorySection(careerHistorySections[nextIndex].id);
  };
  const permanent = snapshot.careerHistory;
  const spells = [...(permanent?.spells.length ? permanent.spells : snapshot.assignments.map(legacyCareerSpell))]
    .sort((left, right) => (right.startedAt ?? '').localeCompare(left.startedAt ?? ''));
  const legacyNegotiations = snapshot.proposals.flatMap((proposal) => (
    (proposal.decisionHistory ?? []).map((decision, decisionIndex) => ({
      proposal,
      decision,
      reason: decision.justification
        ?? (decisionIndex === proposal.decisionHistory.length - 1 ? decisionReasonLabel(dynamicProposal(proposal).decisionReason) : null),
    }))
  )).sort((left, right) => (right.decision.createdAt ?? '').localeCompare(left.decision.createdAt ?? ''));
  const fallbackTimeline: CoachCareerHistoryTimelineEntry[] = [
    ...spells.flatMap((spell) => [
      {
        id: `${spell.id}:start`,
        type: 'appointment',
        title: `Início no ${spell.club.name}`,
        description: spell.entryReason,
        occurredAt: spell.startedAt,
        season: spell.startedSeason,
        club: spell.club,
        country: spell.country,
        division: spell.division,
        reputationDelta: null,
        financialImpact: spell.initialSalary,
      },
      ...(spell.endedAt ? [{
        id: `${spell.id}:end`,
        type: 'departure',
        title: `Saída do ${spell.club.name}`,
        description: spell.exitReason,
        occurredAt: spell.endedAt,
        season: spell.endedSeason,
        club: spell.club,
        country: spell.country,
        division: spell.division,
        reputationDelta: spell.reputationStart !== null && spell.reputationEnd !== null ? spell.reputationEnd - spell.reputationStart : null,
        financialImpact: null,
      }] : []),
    ]),
    ...snapshot.careerAudit.map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: entry.reasonLabel ?? historyLabel(entry.type),
      description: entry.restrictionEndsAt ? `Restrição de assinatura até ${historyDate(entry.restrictionEndsAt)}` : null,
      occurredAt: entry.occurredAt,
      season: null,
      club: entry.club,
      country: entry.club?.country ?? null,
      division: entry.club?.competition ?? null,
      reputationDelta: entry.reputationDelta,
      financialImpact: null,
    })),
  ];
  const timeline = [...(permanent?.timeline.length ? permanent.timeline : fallbackTimeline)]
    .sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? ''));
  const titles = spells.flatMap((spell) => spell.titleEntries.length
    ? spell.titleEntries
    : spell.titles.map((title, index) => ({
      id: `${spell.id}:fallback-title:${index}`,
      name: title,
      type: null,
      competition: null,
      season: null,
      wonAt: null,
      club: spell.club,
    })));
  const matches = sumKnown(spells.map((spell) => spell.metrics.matches));
  const wins = sumKnown(spells.map((spell) => spell.metrics.wins));
  const draws = sumKnown(spells.map((spell) => spell.metrics.draws));
  const losses = sumKnown(spells.map((spell) => spell.metrics.losses));
  const goalsFor = sumKnown(spells.map((spell) => spell.metrics.goalsFor));
  const goalsAgainst = sumKnown(spells.map((spell) => spell.metrics.goalsAgainst));
  const fallbackSummary: Partial<CoachCareerHistorySummary> = {
    clubs: new Set(spells.map((spell) => spell.club.id).filter(Boolean)).size || null,
    countries: new Set(spells.map((spell) => spell.country).filter(Boolean)).size || null,
    seasons: new Set(spells.flatMap((spell) => [spell.startedSeason, spell.endedSeason]).filter(Boolean)).size || null,
    careerDays: sumKnown(spells.map((spell) => spell.durationDays)),
    matches,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor !== null && goalsAgainst !== null ? goalsFor - goalsAgainst : null,
    points: sumKnown(spells.map((spell) => spell.metrics.points)),
    pointsPerGame: matches && spells.some((spell) => spell.metrics.points !== null)
      ? (sumKnown(spells.map((spell) => spell.metrics.points)) ?? 0) / matches
      : null,
    winRate: matches && wins !== null ? (wins / matches) * 100 : null,
    titles: titles.length || null,
    promotions: permanent?.achievements.filter((entry) => /promotion|acesso/iu.test(entry.type)).length ?? null,
    relegations: permanent?.achievements.filter((entry) => /relegation|rebaix/iu.test(entry.type)).length ?? null,
    dismissals: spells.filter((spell) => /dismiss|demit/iu.test(spell.exitReason ?? '')).length,
    resignations: spells.filter((spell) => /resign|pedido de demissão|demissão voluntária/iu.test(spell.exitReason ?? '')).length,
    renewals: spells.reduce((total, spell) => total + spell.renewals.length, 0),
    proposalsAccepted: snapshot.proposals.filter((proposal) => proposal.status === 'accepted').length,
    proposalsRejected: snapshot.proposals.filter((proposal) => proposal.status === 'rejected').length,
    interviews: snapshot.interviews.length,
    unemploymentDays: sumKnown(permanent?.unemploymentPeriods.map((period) => period.durationDays) ?? []),
  };
  const summary = permanent?.summary;
  const summaryValue = (key: keyof CoachCareerHistorySummary) => {
    const richValue = summary?.[key];
    return typeof richValue === 'number' ? richValue : fallbackSummary[key];
  };
  const hasHistory = Boolean(
    spells.length
    || timeline.length
    || permanent?.negotiations.length
    || permanent?.achievements.length
    || permanent?.financialHistory.length
    || snapshot.careerAudit.length
    || legacyNegotiations.length
  );
  const queryKey = historySearchKey(query.trim());
  const matchesQuery = (...values: unknown[]) => (
    !queryKey || values.some((value) => historySearchKey(value).includes(queryKey))
  );
  const visibleSpells = spells.filter((spell) => matchesQuery(
    spell.club.name,
    spell.country,
    spell.division,
    spell.role,
    spell.entryReason,
    spell.exitReason,
    spell.startedAt,
    spell.endedAt,
    spell.titleEntries.map((title) => title.name),
  ));
  const visibleTimeline = timeline.filter((entry) => matchesQuery(
    entry.type,
    entry.title,
    entry.description,
    entry.club?.name,
    entry.country,
    entry.division,
    entry.season,
    entry.occurredAt,
  ));
  const visibleTitles = titles.filter((title) => matchesQuery(
    title.name,
    title.type,
    title.competition,
    title.club?.name,
    title.season,
    title.wonAt,
  ));
  const visibleNegotiations = (permanent?.negotiations ?? []).filter((negotiation) => matchesQuery(
    negotiation.type,
    negotiation.status,
    negotiation.outcome,
    negotiation.description,
    negotiation.club?.name,
    negotiation.occurredAt,
  ));
  const visibleLegacyNegotiations = legacyNegotiations.filter(({ proposal, decision, reason }) => matchesQuery(
    proposal.club.name,
    proposal.kind,
    decision.action,
    decision.previousStatus,
    decision.newStatus,
    reason,
    decision.createdAt,
  ));
  const visibleReputation = (permanent?.reputationHistory ?? []).filter((entry) => matchesQuery(
    entry.reason,
    entry.club?.name,
    entry.country,
    entry.scope,
    entry.season,
    entry.occurredAt,
  ));
  const visibleAchievements = (permanent?.achievements ?? []).filter((achievement) => matchesQuery(
    achievement.type,
    achievement.title,
    achievement.description,
    achievement.club?.name,
    achievement.season,
    achievement.occurredAt,
  ));
  const visibleFinancialHistory = (permanent?.financialHistory ?? []).filter((entry) => matchesQuery(
    entry.type,
    entry.description,
    entry.club?.name,
    entry.occurredAt,
  ));

  if (!hasHistory) {
    return <EmptyState icon={History} title="Histórico ainda vazio">Clubes, negociações, decisões, estatísticas e motivos de saída serão preservados ao longo da carreira.</EmptyState>;
  }

  return (
    <div className="coach-career-history-view">
      <nav
        className="coach-career-history-tabs"
        role="tablist"
        aria-label="Seções do histórico da carreira"
        onKeyDown={handleHistoryTabsKeyDown}
      >
        {careerHistorySections.map((item) => (
          <button
            key={item.id}
            id={`career-history-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            aria-controls={`career-history-panel-${item.id}`}
            tabIndex={section === item.id ? 0 : -1}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {section !== 'summary' && (
        <label className="coach-career-history-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Pesquisar no histórico</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar clube, evento, título ou motivo…"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa">
              <X size={14} />
            </button>
          )}
        </label>
      )}

      <section
        id={`career-history-panel-${section}`}
        className="coach-career-history-section"
        role="tabpanel"
        aria-labelledby={`career-history-tab-${section}`}
      >
        {section === 'summary' && (
          <div className="coach-career-processes">
            <div className="coach-career-history-summary">
              <article><BriefcaseBusiness size={18} /><span>Clubes</span><strong>{historyNumber(summaryValue('clubs'))}</strong></article>
              <article><Building2 size={18} /><span>Países</span><strong>{historyNumber(summaryValue('countries'))}</strong></article>
              <article><CalendarClock size={18} /><span>Tempo de carreira</span><strong>{historyDuration(summaryValue('careerDays'))}</strong></article>
              <article><Target size={18} /><span>Jogos</span><strong>{historyNumber(summaryValue('matches'))}</strong></article>
              <article><TrendingUp size={18} /><span>Vitórias</span><strong>{historyNumber(summaryValue('wins'))}</strong></article>
              <article><BadgeCheck size={18} /><span>Aproveitamento</span><strong>{historyPercentage(summaryValue('winRate'))}</strong></article>
              <article><Trophy size={18} /><span>Títulos</span><strong>{historyNumber(summaryValue('titles'))}</strong></article>
              <article><Clock3 size={18} /><span>Sem clube</span><strong>{historyDuration(summaryValue('unemploymentDays'))}</strong></article>
            </div>
            <div className="coach-career-history-summary coach-career-history-summary--stats" aria-label="Marcos consolidados da carreira">
              <article><span className="coach-career-history-glyph">T</span><span>Temporadas</span><strong>{historyNumber(summaryValue('seasons'))}</strong></article>
              <article><span className="coach-career-history-glyph">F</span><span>Finais disputadas</span><strong>{historyNumber(summaryValue('finals'))}</strong></article>
              <article><Trophy size={18} /><span>Finais vencidas</span><strong>{historyNumber(summaryValue('finalsWon'))}</strong></article>
              <article><TrendingUp size={18} /><span>Promoções</span><strong>{historyNumber(summaryValue('promotions'))}</strong></article>
              <article><span className="coach-career-history-glyph">↓</span><span>Rebaixamentos</span><strong>{historyNumber(summaryValue('relegations'))}</strong></article>
              <article><ShieldAlert size={18} /><span>Demissões</span><strong>{historyNumber(summaryValue('dismissals'))}</strong></article>
              <article><span className="coach-career-history-glyph">S</span><span>Pedidos de demissão</span><strong>{historyNumber(summaryValue('resignations'))}</strong></article>
              <article><RefreshCw size={18} /><span>Renovações</span><strong>{historyNumber(summaryValue('renewals'))}</strong></article>
              <article><Check size={18} /><span>Propostas aceitas</span><strong>{historyNumber(summaryValue('proposalsAccepted'))}</strong></article>
              <article><X size={18} /><span>Propostas recusadas</span><strong>{historyNumber(summaryValue('proposalsRejected'))}</strong></article>
              <article><MessageSquareText size={18} /><span>Entrevistas</span><strong>{historyNumber(summaryValue('interviews'))}</strong></article>
            </div>

            {permanent?.unemploymentPeriods.length ? (
              <Panel title="Períodos sem clube" eyebrow="TRAJETÓRIA PROFISSIONAL COMPLETA">
                <div className="coach-career-unemployment-list">
                  {permanent.unemploymentPeriods.map((period) => (
                    <article key={period.id}>
                      <Clock3 size={17} />
                      <div>
                        <strong>{historyDate(period.startedAt)} — {period.endedAt ? historyDate(period.endedAt) : 'presente'}</strong>
                        <p>{period.reason ?? 'Período entre trabalhos'} · {historyDuration(period.durationDays, period.startedAt, period.endedAt)}</p>
                      </div>
                      <dl>
                        <div><dt>Entrevistas</dt><dd>{historyNumber(period.interviews)}</dd></div>
                        <div><dt>Propostas</dt><dd>{historyNumber(period.proposals)}</dd></div>
                        <div><dt>Recusas</dt><dd>{historyNumber(period.refusals)}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              </Panel>
            ) : null}

            {snapshot.careerAudit.length > 0 && (
              <Panel title="Conduta e reputação" eyebrow="AUDITORIA PERMANENTE DA CARREIRA">
                <div className="coach-career-process-list">
                  {snapshot.careerAudit.map((entry) => (
                    <article key={entry.id}>
                      <span className="coach-career-process-icon"><ShieldAlert size={17} /></span>
                      <div>
                        <strong>{entry.reasonLabel ?? historyLabel(entry.type)}</strong>
                        <p>{entry.club?.name ?? 'Carreira do treinador'} · {historyDate(entry.occurredAt)}</p>
                        {entry.restrictionEndsAt && <em>Restrição de assinatura até {historyDate(entry.restrictionEndsAt)}</em>}
                      </div>
                      <Badge tone={entry.reputationDelta < 0 ? 'danger' : entry.reputationDelta > 0 ? 'positive' : 'neutral'}>
                        Rep. {entry.reputationDelta > 0 ? '+' : ''}{entry.reputationDelta}
                      </Badge>
                      <Badge tone={entry.trustDelta < 0 ? 'warning' : entry.trustDelta > 0 ? 'positive' : 'neutral'}>
                        Conf. {entry.trustDelta > 0 ? '+' : ''}{entry.trustDelta}
                      </Badge>
                    </article>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        )}

        {section === 'timeline' && (
          visibleTimeline.length ? (
            <ol className="coach-career-permanent-timeline">
              {visibleTimeline.map((entry) => (
                <li key={entry.id}>
                  <span aria-hidden="true" />
                  <article>
                    <header>
                      <div>
                        <p className="eyebrow">{historyLabel(entry.type)}</p>
                        <h3>{entry.title}</h3>
                      </div>
                      <time dateTime={entry.occurredAt ?? undefined}>{historyDate(entry.occurredAt)}</time>
                    </header>
                    <p>{entry.club?.name ?? 'Carreira do treinador'}{entry.season ? ` · Temporada ${entry.season}` : ''}</p>
                    {(entry.country || entry.division) && <p>{[entry.country, entry.division].filter(Boolean).join(' · ')}</p>}
                    {entry.description && <em>{entry.description}</em>}
                    <footer>
                      {entry.reputationDelta !== null && (
                        <Badge tone={entry.reputationDelta > 0 ? 'positive' : entry.reputationDelta < 0 ? 'danger' : 'neutral'}>
                          Reputação {entry.reputationDelta > 0 ? '+' : ''}{entry.reputationDelta}
                        </Badge>
                      )}
                      {entry.financialImpact !== null && <Badge tone="neutral">{historyMoney(entry.financialImpact)}</Badge>}
                    </footer>
                  </article>
                </li>
              ))}
            </ol>
          ) : <EmptyState icon={History} title="Linha do tempo vazia">Os eventos cronológicos da carreira aparecerão aqui.</EmptyState>
        )}

        {section === 'clubs' && (
          visibleSpells.length ? (
            <div className="coach-career-club-spells">
              {visibleSpells.map((spell) => (
                <article key={spell.id}>
                  <header>
                    <ClubMark {...clubMarkProps(spell.club)} size="lg" />
                    <div>
                      <p className="eyebrow">{spell.role}</p>
                      <h3>{spell.club.name}</h3>
                      <p>{[spell.country, spell.division].filter(Boolean).join(' · ') || 'País e divisão não informados'}</p>
                    </div>
                    <Badge tone={spell.endedAt ? 'neutral' : 'positive'}>{spell.endedAt ? 'Encerrado' : 'Atual'}</Badge>
                  </header>
                  <div className="coach-career-spell-period">
                    <span><CalendarClock size={15} />{historyDate(spell.startedAt)} — {spell.endedAt ? historyDate(spell.endedAt) : 'presente'}</span>
                    <strong>{historyDuration(spell.durationDays, spell.startedAt, spell.endedAt)}</strong>
                  </div>
                  <dl className="coach-career-spell-facts">
                    <div><dt>Jogos</dt><dd>{historyNumber(spell.metrics.matches)}</dd></div>
                    <div><dt>V-E-D</dt><dd>{historyNumber(spell.metrics.wins)}-{historyNumber(spell.metrics.draws)}-{historyNumber(spell.metrics.losses)}</dd></div>
                    <div><dt>Gols pró / contra</dt><dd>{historyNumber(spell.metrics.goalsFor)} / {historyNumber(spell.metrics.goalsAgainst)}</dd></div>
                    <div><dt>Pontos por jogo</dt><dd>{historyNumber(spell.metrics.pointsPerGame, 2)}</dd></div>
                    <div><dt>Maior sequência de vitórias</dt><dd>{historyNumber(spell.metrics.longestWinningStreak)}</dd></div>
                    <div><dt>Maior sequência sem vencer</dt><dd>{historyNumber(spell.metrics.longestWinlessStreak)}</dd></div>
                    <div><dt>Salário inicial</dt><dd>{historyMoney(spell.initialSalary)}</dd></div>
                    <div><dt>Salário final</dt><dd>{historyMoney(spell.finalSalary)}</dd></div>
                  </dl>
                  {(spell.entryReason || spell.exitReason) && (
                    <div className="coach-career-history__reasons">
                      {spell.entryReason && <p><strong>Entrada:</strong> {spell.entryReason}</p>}
                      {spell.exitReason && <p><strong>Saída:</strong> {spell.exitReason}</p>}
                    </div>
                  )}
                  {(spell.development.youthPromoted !== null || spell.development.signings !== null || spell.development.sales !== null) && (
                    <div className="coach-career-spell-development">
                      <strong>Desenvolvimento do elenco</strong>
                      <span>Base promovida: {historyNumber(spell.development.youthPromoted)}</span>
                      <span>Contratações: {historyNumber(spell.development.signings)}</span>
                      <span>Vendas: {historyNumber(spell.development.sales)}</span>
                      <span>Valor: {historyMoney(spell.development.squadValueStart)} → {historyMoney(spell.development.squadValueEnd)}</span>
                    </div>
                  )}
                  {spell.titleEntries.length > 0 && (
                    <ul className="coach-career-history__titles">
                      {spell.titleEntries.map((title) => <li key={title.id}><Trophy size={13} />{title.name}</li>)}
                    </ul>
                  )}
                  {spell.achievements.some((achievement) => !spell.titleEntries.some((title) => (
                    title.id === achievement.id || title.name === achievement.title
                  ))) && (
                    <ul className="coach-career-history__titles">
                      {spell.achievements.filter((achievement) => !spell.titleEntries.some((title) => (
                        title.id === achievement.id || title.name === achievement.title
                      ))).map((achievement) => (
                        <li key={achievement.id}><Sparkles size={13} />{achievement.title}</li>
                      ))}
                    </ul>
                  )}
                  {spell.contracts.length > 0 && (
                    <details className="coach-career-spell-contracts">
                      <summary>{spell.contracts.length} {spell.contracts.length === 1 ? 'contrato' : 'contratos'} · {spell.renewals.length} {spell.renewals.length === 1 ? 'renovação' : 'renovações'}</summary>
                      <div>
                        {spell.contracts.map((contract) => (
                          <article key={contract.id}>
                            <strong>{historyDate(contract.startDate)} — {historyDate(contract.endDate)}</strong>
                            <span>{historyMoney(contract.salary)} / mês</span>
                            <span>{historyLabel(contract.status)}</span>
                            {contract.endReason && <em>{contract.endReason}</em>}
                          </article>
                        ))}
                      </div>
                    </details>
                  )}
                </article>
              ))}
            </div>
          ) : <EmptyState icon={Building2} title="Nenhuma passagem registrada">Os clubes comandados aparecerão aqui.</EmptyState>
        )}

        {section === 'statistics' && (
          <div className="coach-career-processes">
            <div className="coach-career-history-summary coach-career-history-summary--stats">
              <article><Target size={18} /><span>Jogos</span><strong>{historyNumber(summaryValue('matches'))}</strong></article>
              <article><TrendingUp size={18} /><span>Vitórias</span><strong>{historyNumber(summaryValue('wins'))}</strong></article>
              <article><span className="coach-career-history-glyph">E</span><span>Empates</span><strong>{historyNumber(summaryValue('draws'))}</strong></article>
              <article><span className="coach-career-history-glyph">D</span><span>Derrotas</span><strong>{historyNumber(summaryValue('losses'))}</strong></article>
              <article><BadgeCheck size={18} /><span>Aproveitamento</span><strong>{historyPercentage(summaryValue('winRate'))}</strong></article>
              <article><span className="coach-career-history-glyph">PPG</span><span>Pontos por jogo</span><strong>{historyNumber(summaryValue('pointsPerGame'), 2)}</strong></article>
              <article><span className="coach-career-history-glyph">GP</span><span>Gols marcados</span><strong>{historyNumber(summaryValue('goalsFor'))}</strong></article>
              <article><span className="coach-career-history-glyph">GC</span><span>Gols sofridos</span><strong>{historyNumber(summaryValue('goalsAgainst'))}</strong></article>
            </div>
            <div className="coach-career-history-table-wrap">
              <table className="coach-career-history-table">
                <caption>Desempenho por passagem</caption>
                <thead><tr><th>Clube</th><th>Jogos</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>PPG</th><th>Aprov.</th></tr></thead>
                <tbody>
                  {visibleSpells.map((spell) => (
                    <tr key={spell.id}>
                      <th scope="row">{spell.club.name}</th>
                      <td>{historyNumber(spell.metrics.matches)}</td>
                      <td>{historyNumber(spell.metrics.wins)}</td>
                      <td>{historyNumber(spell.metrics.draws)}</td>
                      <td>{historyNumber(spell.metrics.losses)}</td>
                      <td>{historyNumber(spell.metrics.goalsFor)}</td>
                      <td>{historyNumber(spell.metrics.goalsAgainst)}</td>
                      <td>{historyNumber(spell.metrics.goalDifference)}</td>
                      <td>{historyNumber(spell.metrics.pointsPerGame, 2)}</td>
                      <td>{historyPercentage(spell.metrics.winRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {section === 'titles' && (
          visibleTitles.length ? (
            <div className="coach-career-title-grid">
              {visibleTitles.map((title) => (
                <article key={title.id}>
                  <span><Trophy size={22} /></span>
                  <div>
                    <p className="eyebrow">{title.type ? historyLabel(title.type) : 'TÍTULO'}</p>
                    <h3>{title.name}</h3>
                    <p>{title.club?.name ?? 'Clube não informado'}{title.season ? ` · Temporada ${title.season}` : ''}</p>
                    {title.wonAt && <time dateTime={title.wonAt}>{historyDate(title.wonAt)}</time>}
                  </div>
                </article>
              ))}
            </div>
          ) : <EmptyState icon={Trophy} title="Nenhum título registrado">Conquistas oficiais aparecerão aqui.</EmptyState>
        )}

        {section === 'negotiations' && (
          visibleNegotiations.length ? (
            <div className="coach-career-process-list coach-career-permanent-list">
              {[...visibleNegotiations].sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')).map((negotiation) => (
                <article key={negotiation.id}>
                  {negotiation.club ? <ClubMark {...clubMarkProps(negotiation.club)} size="md" /> : <span className="coach-career-process-icon"><FileSignature size={17} /></span>}
                  <div>
                    <strong>{historyLabel(negotiation.type)} · {negotiation.club?.name ?? 'Clube não informado'}</strong>
                    <p>{historyDate(negotiation.occurredAt)}{negotiation.expiresAt ? ` · prazo ${historyDate(negotiation.expiresAt)}` : ''}</p>
                    {negotiation.description && <em>{negotiation.description}</em>}
                    {negotiation.outcome && <em>Resultado: {negotiation.outcome}</em>}
                  </div>
                  <div className="coach-career-negotiation-values">
                    <strong>{historyMoney(negotiation.salary)}</strong>
                    <span>{negotiation.durationMonths === null ? '—' : `${historyNumber(negotiation.durationMonths)} meses`}</span>
                  </div>
                  <Badge tone={/accept|contrat|acord|renov/iu.test(negotiation.status) ? 'positive' : /reject|recus|expir|cancel/iu.test(negotiation.status) ? 'danger' : 'neutral'}>
                    {historyLabel(negotiation.status)}
                  </Badge>
                </article>
              ))}
            </div>
          ) : visibleLegacyNegotiations.length ? (
            <div className="coach-career-process-list coach-career-permanent-list">
              {visibleLegacyNegotiations.map(({ proposal, decision, reason }) => (
                <article key={`${proposal.id}:${decision.id}`}>
                  <ClubMark {...clubMarkProps(proposal.club)} size="md" />
                  <div>
                    <strong>{decisionActionLabel(decision.action)} · {proposal.club.name}</strong>
                    <p>{proposalKindLabel(proposal)} · {proposalStatusLabel(decision.previousStatus)} → {proposalStatusLabel(decision.newStatus)}</p>
                    {reason && <em>{reason}</em>}
                    <p>{decision.actorName ?? 'Rotina do mercado'}{decision.actorRole ? ` · ${decision.actorRole}` : ''} · {historyDate(decision.createdAt)}</p>
                  </div>
                  <Badge tone={proposalTone(decision.newStatus)}>{proposalStatusLabel(decision.newStatus)}</Badge>
                </article>
              ))}
            </div>
          ) : <EmptyState icon={FileSignature} title="Nenhuma negociação registrada">Interesses, entrevistas, propostas e contrapropostas aparecerão aqui.</EmptyState>
        )}

        {section === 'reputation' && (
          visibleReputation.length ? (
            <div className="coach-career-reputation-list">
              {[...visibleReputation].sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')).map((entry) => (
                <article key={entry.id}>
                  <span className={entry.delta !== null && entry.delta < 0 ? 'is-negative' : 'is-positive'}><TrendingUp size={17} /></span>
                  <div>
                    <strong>{entry.reason ?? 'Atualização de reputação'}</strong>
                    <p>{entry.club?.name ?? entry.country ?? 'Carreira'}{entry.scope ? ` · ${historyLabel(entry.scope)}` : ''} · {historyDate(entry.occurredAt)}</p>
                  </div>
                  <dl>
                    <div><dt>Antes</dt><dd>{historyNumber(entry.before, 1)}</dd></div>
                    <div><dt>Depois</dt><dd>{historyNumber(entry.after, 1)}</dd></div>
                  </dl>
                  <Badge tone={entry.delta !== null && entry.delta > 0 ? 'positive' : entry.delta !== null && entry.delta < 0 ? 'danger' : 'neutral'}>
                    {entry.delta === null ? '—' : `${entry.delta > 0 ? '+' : ''}${historyNumber(entry.delta, 1)}`}
                  </Badge>
                </article>
              ))}
            </div>
          ) : !queryKey && snapshot.reputationHistory.length ? (
            <div className="coach-career-process-list coach-career-permanent-list">
              {snapshot.reputationHistory.map((entry) => (
                <article key={entry.id}>
                  <span className="coach-career-process-icon"><TrendingUp size={17} /></span>
                  <div><strong>{entry.reasonLabel ?? historyLabel(entry.type)}</strong><p>{entry.club?.name ?? 'Carreira'} · {historyDate(entry.occurredAt)}</p></div>
                  <Badge tone={entry.reputationDelta > 0 ? 'positive' : entry.reputationDelta < 0 ? 'danger' : 'neutral'}>{entry.reputationDelta > 0 ? '+' : ''}{entry.reputationDelta}</Badge>
                </article>
              ))}
            </div>
          ) : <EmptyState icon={TrendingUp} title="Sem histórico de reputação">A evolução nacional e internacional aparecerá aqui.</EmptyState>
        )}

        {section === 'achievements' && (
          visibleAchievements.length ? (
            <div className="coach-career-achievement-grid">
              {[...visibleAchievements].sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')).map((achievement) => (
                <article key={achievement.id}>
                  <span><Sparkles size={19} /></span>
                  <div>
                    <p className="eyebrow">{historyLabel(achievement.type)}</p>
                    <h3>{achievement.title}</h3>
                    <p>{achievement.club?.name ?? 'Carreira'}{achievement.season ? ` · Temporada ${achievement.season}` : ''}</p>
                    {achievement.description && <em>{achievement.description}</em>}
                  </div>
                  {achievement.value !== null && <strong>{historyNumber(achievement.value)}</strong>}
                </article>
              ))}
            </div>
          ) : <EmptyState icon={Sparkles} title="Nenhuma conquista especial">Promoções, recordes e marcos de desenvolvimento aparecerão aqui.</EmptyState>
        )}

        {section === 'financial' && (
          visibleFinancialHistory.length ? (
            <div className="coach-career-history-table-wrap">
              <table className="coach-career-history-table">
                <caption>Contratos, salários, bônus e movimentações da carreira</caption>
                <thead><tr><th>Data</th><th>Clube</th><th>Evento</th><th>Salário</th><th>Valor</th><th>Detalhes</th></tr></thead>
                <tbody>
                  {[...visibleFinancialHistory].sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')).map((entry) => (
                    <tr key={entry.id}>
                      <td>{historyDate(entry.occurredAt)}</td>
                      <th scope="row">{entry.club?.name ?? '—'}</th>
                      <td>{historyLabel(entry.type)}</td>
                      <td>{historyMoney(entry.salary)}</td>
                      <td>{historyMoney(entry.amount)}</td>
                      <td>{entry.description ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={CircleDollarSign} title="Histórico financeiro vazio">Salários, bônus, renovações e indenizações aparecerão aqui.</EmptyState>
        )}
      </section>
    </div>
  );
}

export function CoachCareerView({ roomCode, revision = 0, onToast }: CoachCareerViewProps) {
  const career = useCoachCareer(roomCode, revision, Boolean(roomCode));
  const [tab, setTab] = useState<CareerTab>('overview');
  const [proposal, setProposal] = useState<CoachProposal | null>(null);
  const [informationProposal, setInformationProposal] = useState<CoachProposal | null>(null);
  const [vacancy, setVacancy] = useState<CoachVacancy | null>(null);
  const [interview, setInterview] = useState<CoachInterview | null>(null);
  const [resignOpen, setResignOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [salary, setSalary] = useState('');
  const [years, setYears] = useState('2');
  const [guarantee, setGuarantee] = useState('');
  const [informationResponse, setInformationResponse] = useState('');
  const [applicationMessage, setApplicationMessage] = useState('');
  const [resignReason, setResignReason] = useState('');
  const [resignReasonCode, setResignReasonCode] = useState('personal_reasons');
  const [signingBonus, setSigningBonus] = useState('');
  const [performanceBonus, setPerformanceBonus] = useState('');
  const [transferBudget, setTransferBudget] = useState('');
  const [terminationClause, setTerminationClause] = useState('');
  const [renewObjectives, setRenewObjectives] = useState('');
  const [renewClauses, setRenewClauses] = useState('');
  const [interviewAnswers, setInterviewAnswers] = useState<Record<string, string>>({});
  const [interviewDepth, setInterviewDepth] = useState<CoachInterviewDepth>('standard');
  const [interviewMessage, setInterviewMessage] = useState('');

  const pendingCount = career.snapshot?.proposals.filter(isActiveProposal).length ?? 0;
  const openVacancies = career.snapshot?.vacancies.filter((item) => item.status === 'open').length ?? 0;
  const pendingInterviews = career.snapshot?.interviews.filter((item) => item.status === 'pending' || item.status === 'scheduled' || item.status === 'awaiting_answers').length ?? 0;
  const tabs = useMemo(() => [
    { id: 'overview' as const, label: 'Visão geral', icon: BriefcaseBusiness, count: 0 },
    { id: 'proposals' as const, label: 'Propostas', icon: FileSignature, count: pendingCount },
    { id: 'vacancies' as const, label: 'Vagas', icon: UserRoundSearch, count: openVacancies },
    { id: 'interviews' as const, label: 'Entrevistas', icon: MessageSquareText, count: pendingInterviews },
    { id: 'history' as const, label: 'Histórico', icon: History, count: 0 },
  ], [openVacancies, pendingCount, pendingInterviews]);

  async function run(action: () => Promise<unknown>, success: string, after?: () => void) {
    try {
      await action();
      after?.();
      onToast?.(success);
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
    }
  }

  function openProposal(nextProposal: CoachProposal) {
    setProposal(nextProposal);
    setSalary(nextProposal.terms.salary?.toString() ?? '');
    setYears(nextProposal.terms.durationMonths ? Math.max(1, Math.round(nextProposal.terms.durationMonths / 12)).toString() : '2');
    setSigningBonus('');
    setPerformanceBonus('');
    setTransferBudget(nextProposal.terms.transferBudget?.toString() ?? '');
    setTerminationClause(nextProposal.terms.releaseClause?.toString() ?? '');
    setRenewObjectives(nextProposal.terms.sportingTargets.join('\n'));
    setRenewClauses(nextProposal.terms.specialClauses.join('\n'));
    setGuarantee('');
  }

  function openInformationRequest(nextProposal: CoachProposal) {
    setInformationProposal(nextProposal);
    setInformationResponse(nextProposal.informationRequest?.response ?? '');
  }

  function openInterview(nextInterview: CoachInterview) {
    setInterview(nextInterview);
    setInterviewAnswers(Object.fromEntries(nextInterview.answers.map((answer) => [answer.questionId, answer.optionId ?? answer.text ?? ''])));
    setInterviewDepth(nextInterview.depth);
    setInterviewMessage('');
  }

  if (!roomCode) {
    return <main className="secondary-view coach-career-view view-enter"><EmptyState icon={BriefcaseBusiness} title="Carreira indisponível">Entre em um save para consultar sua carreira de treinador.</EmptyState></main>;
  }

  if (career.loading && !career.snapshot) {
    return <main className="secondary-view coach-career-view view-enter"><div className="coach-career-loading" aria-live="polite"><LoaderCircle className="spin" size={25} /><strong>Sincronizando sua carreira…</strong><p>Carregando vínculos, propostas e processos seletivos.</p></div></main>;
  }

  if (career.error && !career.snapshot) {
    return (
      <main className="secondary-view coach-career-view view-enter">
        <div className="coach-career-error" role="alert"><AlertTriangle size={26} /><strong>Não foi possível abrir sua carreira</strong><p>{career.error}</p><Button icon={<RefreshCw size={14} />} onClick={career.refresh}>Tentar novamente</Button></div>
      </main>
    );
  }

  if (!career.snapshot) {
    return <main className="secondary-view coach-career-view view-enter"><EmptyState icon={BriefcaseBusiness} title="Carreira ainda não criada">O servidor ainda não registrou um perfil de treinador para este save.</EmptyState></main>;
  }

  const snapshot = career.snapshot;
  const activeInterview = interview
    ? snapshot.interviews.find((item) => item.id === interview.id) ?? interview
    : null;
  const consequences = snapshot.activeEmployment?.resignationConsequences;
  const activeContract = snapshot.activeEmployment?.contract ?? snapshot.contracts.find((item) => item.status === 'active') ?? null;
  const selectedResignationReason = consequences?.reasonOptions.find((item) => item.code === resignReasonCode) ?? null;
  const selectedResignationConsequences = selectedResignationReason ?? consequences;
  const invalidRenewalMoney = [signingBonus, performanceBonus, transferBudget, terminationClause].some((value) => (
    value.trim() !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)
  ));
  const allInterviewAnswersPresent = activeInterview?.questions.every((question) => Boolean(interviewAnswers[question.id]?.trim())) ?? false;
  const dynamicInterviewLoading = activeInterview
    ? career.mutationKey === `interview-start:${activeInterview.id}` || career.mutationKey === `interview-turn:${activeInterview.id}`
    : false;
  const activeInterviewQuestionId = activeInterview?.currentQuestionId
    ?? [...(activeInterview?.transcript ?? [])].reverse().find((entry) => entry.role === 'board')?.id
    ?? null;

  async function runDynamicInterviewMutation(action: () => Promise<CoachCareerSnapshot | null>, success: string) {
    if (!activeInterview) return;
    try {
      const nextSnapshot = await action();
      const refreshedInterview = nextSnapshot?.interviews.find((item) => item.id === activeInterview.id);
      if (refreshedInterview) setInterview(refreshedInterview);
      setInterviewMessage('');
      onToast?.(success);
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : 'Não foi possível continuar a entrevista.');
    }
  }

  return (
    <main className="secondary-view coach-career-view view-enter">
      <div className="view-heading coach-career-heading">
        <div><p className="eyebrow">TRAJETÓRIA PROFISSIONAL</p><h1>Carreira do treinador</h1><p>Gerencie seu vínculo, propostas e próximos passos sem perder o histórico.</p></div>
        <Button size="sm" variant="ghost" icon={<RefreshCw className={career.refreshing ? 'spin' : ''} size={14} />} disabled={career.refreshing || Boolean(career.mutationKey)} onClick={career.refresh}>{career.refreshing ? 'Atualizando' : 'Atualizar'}</Button>
      </div>

      {career.error && <div className="coach-career-inline-error" role="alert"><AlertTriangle size={15} /><span>{career.error}</span></div>}

      <nav className="coach-career-tabs" role="tablist" aria-label="Seções da carreira">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button type="button" role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}>
            <Icon size={15} />{label}{count > 0 && <span>{count}</span>}
          </button>
        ))}
      </nav>

      <section className="coach-career-tab-panel" role="tabpanel">
        {tab === 'overview' && <><OverviewTab snapshot={snapshot} mutationKey={career.mutationKey} onSearch={() => void run(() => career.searchJobs(true), 'Busca de emprego atualizada.')} onOpenRenew={() => {
          setYears('2');
          setSalary(activeContract?.salary?.toString() ?? '');
          setSigningBonus('');
          setPerformanceBonus('');
          setTransferBudget(activeContract?.transferBudget?.toString() ?? '');
          setTerminationClause(activeContract?.releaseClause?.toString() ?? '');
          setRenewObjectives(activeContract?.sportingTargets.join('\n') ?? '');
          setRenewClauses(activeContract?.specialClauses.join('\n') ?? '');
          setRenewOpen(true);
        }} onOpenResign={() => { setResignReasonCode(consequences?.reasonCode ?? 'personal_reasons'); setResignReason(''); setResignOpen(true); }} /><LifecyclePanel snapshot={snapshot} mutationKey={career.mutationKey} onAction={(action, payload, success) => void run(() => career.runLifecycleAction(action, payload), success)} /></>}
        {tab === 'proposals' && <ProposalsTab snapshot={snapshot} mutationKey={career.mutationKey} onRespond={(item, decision) => void run(() => career.respondToProposal(item.id, decision), decision === 'accept' ? `Proposta do ${item.club.name} aceita.` : 'Proposta recusada.')} onMoreTime={(item) => void run(() => career.requestMoreTime(item.id), 'Solicitação de prazo enviada.')} onNegotiate={openProposal} onEndNegotiation={(item) => void run(() => career.endNegotiation(item.id), 'Negociação encerrada.')} onProvideInformation={openInformationRequest} />}
        {tab === 'vacancies' && <VacanciesTab snapshot={snapshot} mutationKey={career.mutationKey} onSearch={() => void run(() => career.searchJobs(true), 'Vagas atualizadas.')} onApply={(item) => { setVacancy(item); setApplicationMessage(''); }} />}
        {tab === 'interviews' && <InterviewsTab snapshot={snapshot} mutationKey={career.mutationKey} onAnswer={openInterview} />}
        {tab === 'history' && <HistoryTab snapshot={snapshot} />}
      </section>

      <Modal
        open={Boolean(proposal)}
        onClose={() => !career.mutationKey && setProposal(null)}
        title={proposal ? `Negociar com ${proposal.club.name}` : 'Negociar proposta'}
        eyebrow="CONTRAPROPOSTA"
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setProposal(null)} disabled={Boolean(career.mutationKey)}>Cancelar</Button><Button variant="primary" icon={<Send size={14} />} loading={proposal ? career.mutationKey === `proposal:${proposal.id}` : false} disabled={!proposal || invalidRenewalMoney || (salary !== '' && (!Number.isFinite(Number(salary)) || Number(salary) < 1_000)) || Number(years) < 1 || (Boolean(guarantee.trim()) && guarantee.trim().length < 2)} onClick={() => proposal && void run(() => career.respondToProposal(proposal.id, 'counter', {
          ...(salary !== '' ? { salary: Number(salary) } : {}),
          durationMonths: Number(years) * 12,
          signingBonus: optionalNumber(signingBonus),
          releaseClause: optionalNumber(terminationClause),
          transferBudget: optionalNumber(transferBudget),
          sportingTargets: splitLines(renewObjectives),
          specialClauses: splitLines(renewClauses),
          ...(optionalNumber(performanceBonus) !== undefined ? { bonusTerms: { performance: optionalNumber(performanceBonus)! } } : {}),
          ...(guarantee.trim() ? { guarantees: [guarantee.trim()] } : {}),
        }), 'Contraproposta enviada para análise da diretoria.', () => setProposal(null))}>Enviar contraproposta</Button></>}
      >
        {proposal && <div className="coach-career-form">
          <p>Altere os termos. A contraproposta será avaliada formalmente e poderá receber nova oferta, recusa ou pedido de esclarecimento.</p>
          <div className="coach-career-form-grid">
            <label>Salário mensal<input type="number" min="1000" step="1000" value={salary} onChange={(event) => setSalary(event.target.value)} /></label>
            <label>Duração do contrato<select value={years} onChange={(event) => setYears(event.target.value)}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} ano{value > 1 ? 's' : ''}</option>)}</select></label>
            <label>Bônus de assinatura<input type="number" min="0" step="1000" value={signingBonus} onChange={(event) => setSigningBonus(event.target.value)} placeholder="Sem bônus" /></label>
            <label>Bônus por desempenho<input type="number" min="0" step="1000" value={performanceBonus} onChange={(event) => setPerformanceBonus(event.target.value)} placeholder="Sem bônus" /></label>
            <label>Multa rescisória<input type="number" min="0" step="1000" value={terminationClause} onChange={(event) => setTerminationClause(event.target.value)} /></label>
            <label>Orçamento de transferências<input type="number" min="0" step="10000" value={transferBudget} onChange={(event) => setTransferBudget(event.target.value)} placeholder="A negociar" /></label>
          </div>
          <label>Metas esportivas <span>uma por linha</span><textarea rows={3} maxLength={800} value={renewObjectives} onChange={(event) => setRenewObjectives(event.target.value)} /></label>
          <label>Cláusulas específicas <span>uma por linha</span><textarea rows={3} maxLength={800} value={renewClauses} onChange={(event) => setRenewClauses(event.target.value)} /></label>
          <label>Garantia desejada<textarea rows={3} maxLength={240} placeholder="Ex.: orçamento mínimo para contratações" value={guarantee} onChange={(event) => setGuarantee(event.target.value)} /></label>
        </div>}
      </Modal>

      <Modal
        open={Boolean(informationProposal)}
        onClose={() => !career.mutationKey && setInformationProposal(null)}
        title={informationProposal ? `Responder ao ${informationProposal.club.name}` : 'Responder à diretoria'}
        eyebrow="INFORMAÇÕES SOLICITADAS"
        footer={<><Button variant="ghost" onClick={() => setInformationProposal(null)} disabled={Boolean(career.mutationKey)}>Responder depois</Button><Button variant="primary" icon={<Send size={14} />} loading={informationProposal ? career.mutationKey === `proposal-information:${informationProposal.id}` : false} disabled={!informationProposal || informationResponse.trim().length < 2} onClick={() => informationProposal && void run(() => career.provideProposalInformation(informationProposal.id, informationResponse), 'Informações enviadas à diretoria.', () => setInformationProposal(null))}>Enviar resposta</Button></>}
      >
        {informationProposal && <div className="coach-career-form"><div className="coach-career-information-question"><strong>Pergunta da diretoria</strong><p>{informationProposal.informationRequest?.question ?? 'A diretoria pediu informações adicionais para continuar a negociação.'}</p></div><label>Sua resposta<textarea rows={6} maxLength={800} value={informationResponse} onChange={(event) => setInformationResponse(event.target.value)} placeholder="Forneça os detalhes solicitados." /></label></div>}
      </Modal>

      <Modal
        open={Boolean(vacancy)}
        onClose={() => !career.mutationKey && setVacancy(null)}
        title={vacancy ? `Candidatura ao ${vacancy.club.name}` : 'Enviar candidatura'}
        eyebrow="VAGA DE TREINADOR"
        footer={<><Button variant="ghost" onClick={() => setVacancy(null)} disabled={Boolean(career.mutationKey)}>Cancelar</Button><Button variant="primary" icon={<Send size={14} />} disabled={Boolean(applicationMessage.trim()) && applicationMessage.trim().length < 2} loading={vacancy ? career.mutationKey === `vacancy:${vacancy.id}` : false} onClick={() => vacancy && void run(() => career.applyToVacancy(vacancy.id, applicationMessage), 'Candidatura enviada.', () => setVacancy(null))}>Enviar candidatura</Button></>}
      >
        {vacancy && (
          <div className="coach-career-form">
            <p>A candidatura será analisada pelo perfil completo da vaga. Requisitos obrigatórios podem impedir o avanço.</p>
            <VacancyProfileSummary vacancy={vacancy} />
            <label>
              Mensagem à diretoria
              <textarea rows={5} maxLength={500} placeholder="Explique por que seu perfil combina com este projeto." value={applicationMessage} onChange={(event) => setApplicationMessage(event.target.value)} />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(activeInterview)}
        onClose={() => !career.mutationKey && setInterview(null)}
        title={activeInterview ? `Entrevista com ${activeInterview.club.name}` : 'Entrevista'}
        eyebrow="PROCESSO SELETIVO"
        size="lg"
        footer={activeInterview && isDynamicInterview(activeInterview)
          ? <Button variant="ghost" onClick={() => setInterview(null)} disabled={Boolean(career.mutationKey)}>{isFinishedInterview(activeInterview) ? 'Fechar' : 'Responder depois'}</Button>
          : <><Button variant="ghost" onClick={() => setInterview(null)} disabled={Boolean(career.mutationKey)}>Responder depois</Button><Button variant="primary" icon={<Send size={14} />} disabled={!allInterviewAnswersPresent} loading={activeInterview ? career.mutationKey === `interview:${activeInterview.id}` : false} onClick={() => activeInterview && void run(() => career.answerInterview(activeInterview.id, activeInterview.questions.map((question): CoachInterviewAnswer => ({ questionId: question.id, ...(question.type === 'choice' ? { optionId: interviewAnswers[question.id] } : { text: interviewAnswers[question.id] }) }))), 'Entrevista respondida.', () => setInterview(null))}>Enviar respostas</Button></>}
      >
        {activeInterview && (isDynamicInterview(activeInterview)
          ? <DynamicInterviewPanel
              interview={activeInterview}
              depth={interviewDepth}
              message={interviewMessage}
              loading={dynamicInterviewLoading}
              onDepthChange={setInterviewDepth}
              onMessageChange={setInterviewMessage}
              onStart={() => void runDynamicInterviewMutation(
                () => career.startInterview(activeInterview.id, interviewDepth),
                'Entrevista iniciada.',
              )}
              onSend={() => void runDynamicInterviewMutation(
                () => career.answerInterviewTurn(activeInterview.id, interviewMessage, activeInterviewQuestionId),
                'Resposta enviada.',
              )}
            />
          : <div className="coach-career-interview-form">{activeInterview.questions.map((question, index) => <fieldset key={question.id}><legend><span>{index + 1}</span>{question.prompt}</legend>{question.helpText && <p>{question.helpText}</p>}{question.type === 'choice' ? <div className="coach-career-interview-options">{question.options.map((option) => <label key={option.id}><input type="radio" name={`question-${question.id}`} value={option.id} checked={interviewAnswers[question.id] === option.id} onChange={() => setInterviewAnswers((current) => ({ ...current, [question.id]: option.id }))} /><span>{option.label}</span></label>)}</div> : <textarea rows={4} maxLength={160} value={interviewAnswers[question.id] ?? ''} onChange={(event) => setInterviewAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />}</fieldset>)}</div>)}
      </Modal>

      <Modal
        open={renewOpen}
        onClose={() => !career.mutationKey && setRenewOpen(false)}
        title="Conversar sobre renovação"
        eyebrow="CONTRATO ATUAL"
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setRenewOpen(false)} disabled={Boolean(career.mutationKey)}>Cancelar</Button><Button variant="primary" icon={<FileSignature size={14} />} loading={career.mutationKey === 'renew'} disabled={Number(years) < 1 || invalidRenewalMoney || (salary !== '' && (!Number.isFinite(Number(salary)) || Number(salary) < 1_000))} onClick={() => void run(() => career.renewContract(Number(years), salary === '' ? undefined : Number(salary), {
          signingBonus: optionalNumber(signingBonus),
          ...(optionalNumber(performanceBonus) !== undefined ? { bonuses: { performance: optionalNumber(performanceBonus)! } } : {}),
          transferBudget: optionalNumber(transferBudget),
          terminationClause: optionalNumber(terminationClause),
          sportingTargets: splitLines(renewObjectives),
          specialClauses: splitLines(renewClauses),
        }), 'Pedido de renovação enviado para negociação.', () => setRenewOpen(false))}>Enviar proposta</Button></>}
      >
        <div className="coach-career-form">
          <p>Nada será renovado imediatamente. A diretoria poderá aceitar, recusar ou enviar contraproposta conforme resultados, confiança, caixa e ofertas concorrentes.</p>
          <div className="coach-career-form-grid">
            <label>Duração desejada<select value={years} onChange={(event) => setYears(event.target.value)}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} ano{value > 1 ? 's' : ''}</option>)}</select></label>
            <label>Salário mensal<input type="number" min="1000" step="1000" value={salary} onChange={(event) => setSalary(event.target.value)} placeholder="Manter salário atual" /></label>
            <label>Bônus de assinatura<input type="number" min="0" step="1000" value={signingBonus} onChange={(event) => setSigningBonus(event.target.value)} placeholder="Sem bônus" /></label>
            <label>Bônus por desempenho<input type="number" min="0" step="1000" value={performanceBonus} onChange={(event) => setPerformanceBonus(event.target.value)} placeholder="Sem bônus" /></label>
            <label>Multa rescisória<input type="number" min="0" step="1000" value={terminationClause} onChange={(event) => setTerminationClause(event.target.value)} placeholder="A negociar" /></label>
            <label>Orçamento para transferências<input type="number" min="0" step="10000" value={transferBudget} onChange={(event) => setTransferBudget(event.target.value)} placeholder="A negociar" /></label>
          </div>
          <label>Metas esportivas <span>uma por linha</span><textarea rows={4} maxLength={800} value={renewObjectives} onChange={(event) => setRenewObjectives(event.target.value)} placeholder={'Classificar para competição continental\nDesenvolver jogadores da base'} /></label>
          <label>Cláusulas específicas <span>uma por linha</span><textarea rows={4} maxLength={800} value={renewClauses} onChange={(event) => setRenewClauses(event.target.value)} placeholder={'Garantia de orçamento mínimo\nBônus por título'} /></label>
        </div>
      </Modal>

      <Modal
        open={resignOpen}
        onClose={() => !career.mutationKey && setResignOpen(false)}
        title="Confirmar pedido de demissão"
        eyebrow="DECISÃO DE CARREIRA"
        footer={<><Button variant="ghost" onClick={() => setResignOpen(false)} disabled={Boolean(career.mutationKey)}>Continuar no clube</Button><Button variant="danger" icon={<X size={14} />} disabled={Boolean(resignReason.trim()) && resignReason.trim().length < 2} loading={career.mutationKey === 'resign'} onClick={() => void run(() => career.resign(resignReason, resignReasonCode), 'Pedido de demissão registrado com consequências.', () => setResignOpen(false))}>Pedir demissão</Button></>}
      >
        <div className="coach-career-resign">
          <div className="coach-career-warning"><AlertTriangle size={18} /><p>Esta ação encerra seu vínculo, reduz reputação e confiança e pode impedir nova assinatura por um período. A mesma regra vale para treinadores da IA.</p></div>
          <label>Motivo principal<select value={resignReasonCode} onChange={(event) => setResignReasonCode(event.target.value)}>{consequences?.reasonOptions.map((option) => <option key={option.code} value={option.code}>{option.label}{option.justCause ? ' · possível justa causa' : ''}</option>)}</select></label>
          {selectedResignationReason?.justCause && <div className="coach-career-information-question"><strong>{selectedResignationReason.justCauseVerified ? 'Justa causa comprovada' : 'Justa causa precisa ser comprovada'}</strong><p>{selectedResignationReason.justCauseVerified ? 'Os dados atuais do clube comprovam o motivo. A prévia abaixo já inclui a redução das penalidades.' : 'O servidor verificará salários atrasados, crise financeira, promessas quebradas ou ambiente instável. Sem evidência, a penalidade integral será aplicada.'}</p></div>}
          <dl className="coach-career-detail-list">
            <div><dt>Custo financeiro estimado</dt><dd>{formatMoney(selectedResignationConsequences?.financialCost)}</dd></div>
            <div><dt>Impacto na reputação</dt><dd>{selectedResignationConsequences?.reputationDelta === null || selectedResignationConsequences?.reputationDelta === undefined ? 'Não informado' : `${selectedResignationConsequences.reputationDelta > 0 ? '+' : ''}${selectedResignationConsequences.reputationDelta}`}</dd></div>
            <div><dt>Impacto na confiança</dt><dd>{selectedResignationConsequences?.trustDelta === null || selectedResignationConsequences?.trustDelta === undefined ? 'Não informado' : `${selectedResignationConsequences.trustDelta > 0 ? '+' : ''}${selectedResignationConsequences.trustDelta}`}</dd></div>
            <div><dt>Reação da diretoria</dt><dd>{selectedResignationConsequences?.boardReaction ?? 'Será avaliada ao confirmar'}</dd></div>
            <div><dt>Período estimado sem assinar</dt><dd>{selectedResignationConsequences?.likelyUnemployedDays === null || selectedResignationConsequences?.likelyUnemployedDays === undefined ? 'Indefinido' : `${selectedResignationConsequences.likelyUnemployedDays} dias`}</dd></div>
            <div><dt>Restrição até</dt><dd>{selectedResignationConsequences?.restrictionEndsAt ? formatDate(selectedResignationConsequences.restrictionEndsAt) : 'Não informada'}</dd></div>
            <div><dt>Saída durante projeto</dt><dd>{selectedResignationConsequences?.pendingProjectPenalty ? 'Penalidade aplicada' : 'Sem penalidade adicional'}</dd></div>
          </dl>
          {selectedResignationConsequences?.pendingObjectives.length ? <div className="coach-career-pending-objectives"><strong>Objetivos ainda pendentes</strong><ul>{selectedResignationConsequences.pendingObjectives.map((objective) => <li key={objective}>{objective}</li>)}</ul></div> : null}
          <label>Detalhes da saída<textarea rows={4} maxLength={240} value={resignReason} onChange={(event) => setResignReason(event.target.value)} placeholder="Opcional: explique sua decisão." /></label>
        </div>
      </Modal>
    </main>
  );
}
