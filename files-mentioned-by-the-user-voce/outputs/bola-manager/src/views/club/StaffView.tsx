import { useMemo, useState, type CSSProperties } from 'react';
import {
  Activity,
  Award,
  Brain,
  BriefcaseBusiness,
  CalendarClock,
  ChartNoAxesCombined,
  Dumbbell,
  GraduationCap,
  HeartHandshake,
  HeartPulse,
  Search,
  Shield,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { Modal } from '../../components/shared/Modal';
import { ProgressBar } from '../../components/shared/ProgressBar';
import {
  useClubCareer,
  type CareerStaffContract,
  type CareerStaffMember,
} from '../../hooks/useClubCareer';
import type { BolaSocket, ClubChoice, Room } from '../../types';
import type {
  ProfessionalAffiliationType,
  ProfessionalLifecycleAction,
  ProfessionalNoticeType,
  ProfessionalRetirementType,
} from '../../types';
import { formatCurrency } from '../../utils/formatters';

interface StaffViewProps {
  club: ClubChoice;
  room: Room | null;
  socket: BolaSocket | null;
  managerId: string;
  onToast: (message: string) => void;
}

interface RoleMeta {
  label: string;
  icon: LucideIcon;
  color: string;
  attributes: string[];
}

type DialogState =
  | { kind: 'hire'; staffId: string | null }
  | { kind: 'manage'; staffId: string }
  | null;

const roleMetadata: Record<string, RoleMeta> = {
  assistant_coach: { label: 'Auxiliar técnico', icon: Brain, color: '#c8ff3d', attributes: ['tactical', 'coaching', 'manManagement'] },
  fitness_coach: { label: 'Preparador físico', icon: Dumbbell, color: '#66a3ff', attributes: ['fitness', 'coaching', 'motivation'] },
  goalkeeper_coach: { label: 'Treinador de goleiros', icon: Shield, color: '#e6b85c', attributes: ['goalkeeping', 'coaching', 'tactical'] },
  physiotherapist: { label: 'Fisioterapeuta', icon: HeartHandshake, color: '#d777ed', attributes: ['medical', 'fitness', 'manManagement'] },
  doctor: { label: 'Médico', icon: HeartPulse, color: '#5ad6a0', attributes: ['medical', 'analysis', 'manManagement'] },
  performance_analyst: { label: 'Analista de desempenho', icon: ChartNoAxesCombined, color: '#58b7ff', attributes: ['analysis', 'tactical', 'scouting'] },
  scout: { label: 'Olheiro', icon: Search, color: '#b98cff', attributes: ['scouting', 'analysis', 'negotiation'] },
  football_director: { label: 'Diretor de futebol', icon: BriefcaseBusiness, color: '#ff9f5a', attributes: ['negotiation', 'manManagement', 'scouting'] },
  youth_coach: { label: 'Treinador da base', icon: GraduationCap, color: '#71d7d0', attributes: ['youthDevelopment', 'coaching', 'motivation'] },
};

const fallbackRole: RoleMeta = {
  label: 'Profissional', icon: Activity, color: '#c8ff3d', attributes: ['coaching', 'analysis', 'motivation'],
};

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function initials(name: string) {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('pt-BR') || 'BM';
}

function roleFor(member: CareerStaffMember) {
  const meta = roleMetadata[member.role] ?? fallbackRole;
  return { ...meta, label: member.roleLabel || meta.label };
}

function attributeAverage(member: CareerStaffMember, keys: string[]) {
  const values = keys.map((key) => finiteOrNull(member.attributes?.[key]))
    .filter((value): value is number => value !== null && value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function memberRating(member: CareerStaffMember) {
  const reputation = finiteOrNull(member.reputation);
  if (reputation !== null && reputation > 0) return clamp(reputation / 10, 1, 10);
  const attributes = attributeAverage(member, roleFor(member).attributes);
  return attributes === null ? null : clamp(attributes / 2, 1, 10);
}

function knowledgePercent(member: CareerStaffMember) {
  const attributes = attributeAverage(member, roleFor(member).attributes);
  return attributes === null ? null : Math.round(clamp(attributes * 5, 0, 100));
}

function monthAndYear(value: string | null | undefined) {
  const date = new Date(value ?? '');
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
    : 'sem prazo';
}

function approximateTerminationFee(contract: CareerStaffContract | null, currentDate: string | undefined) {
  if (!contract) return 0;
  const start = Date.parse(currentDate ?? new Date().toISOString());
  const end = Date.parse(contract.endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const months = Math.min(96, Math.ceil((end - start) / (30 * 86_400_000)));
  return Math.round(months * contract.wage * clamp(finite(contract.terminationRate, 0.25), 0, 1));
}

function futureDateInput(days = 30, baseDate?: string | null) {
  const date = new Date(baseDate ?? '');
  if (!Number.isFinite(date.getTime())) date.setTime(Date.now());
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const affiliationLabels: Record<ProfessionalAffiliationType, string> = {
  independent: 'Contrato independente com o clube',
  personal_team: 'Equipe pessoal do treinador',
  personal_staff: 'Equipe pessoal do treinador',
  coach_recommended: 'Indicado pelo treinador',
  inherited: 'Herdado da comissão anterior',
};
const affiliationOptions: ProfessionalAffiliationType[] = [
  'independent',
  'personal_team',
  'coach_recommended',
  'inherited',
];

export function StaffView({ club, room, socket, managerId, onToast }: StaffViewProps) {
  const career = useClubCareer(room, socket, club.id, managerId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [years, setYears] = useState(3);
  const [wage, setWage] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [confirmFire, setConfirmFire] = useState(false);
  const [affiliationType, setAffiliationType] = useState<ProfessionalAffiliationType>('independent');
  const careerDate = career.state?.currentDate ?? null;
  const [lifecycleDate, setLifecycleDate] = useState(() => futureDateInput(30, careerDate));
  const [retirementDate, setRetirementDate] = useState(() => futureDateInput(120, careerDate));
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleCompensation, setLifecycleCompensation] = useState(0);
  const [noticeType, setNoticeType] = useState<ProfessionalNoticeType>('standard');
  const [retirementType, setRetirementType] = useState<ProfessionalRetirementType>('scheduled');
  const [pendingBonuses, setPendingBonuses] = useState(0);
  const [temporaryBenefits, setTemporaryBenefits] = useState(0);
  const [noticePay, setNoticePay] = useState(0);
  const [preserveBonuses, setPreserveBonuses] = useState(true);
  const [confidentiality, setConfidentiality] = useState(false);
  const [lifecycleNotes, setLifecycleNotes] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveStartDate, setLeaveStartDate] = useState(() => futureDateInput(0, careerDate));
  const [leaveEndDate, setLeaveEndDate] = useState(() => futureDateInput(30, careerDate));
  const [leavePaymentType, setLeavePaymentType] = useState<'full' | 'partial' | 'unpaid'>('full');
  const [leavePaymentRate, setLeavePaymentRate] = useState(50);
  const [leavePaymentNotes, setLeavePaymentNotes] = useState('');
  const [actingStaffId, setActingStaffId] = useState('');
  const [temporaryBonus, setTemporaryBonus] = useState(0);
  const [authorityLevel, setAuthorityLevel] = useState(50);
  const [packageMode, setPackageMode] = useState(false);
  const [packageCandidateIds, setPackageCandidateIds] = useState<string[]>([]);
  const [packageYears, setPackageYears] = useState(3);
  const [packageWage, setPackageWage] = useState(0);
  const [packageSigningBonus, setPackageSigningBonus] = useState(0);
  const [packageMaximumCost, setPackageMaximumCost] = useState(0);

  const selectedCandidate = dialog?.kind === 'hire' && dialog.staffId
    ? career.candidates.find((member) => member.id === dialog.staffId) ?? null
    : null;
  const selectedMember = dialog?.kind === 'manage'
    ? career.staff.find((member) => member.id === dialog.staffId) ?? null
    : null;
  const selectedContract = selectedMember ? career.contractForStaff(selectedMember.id) : null;
  const selectedLifecycle = selectedMember ? career.lifecycleForStaff(selectedMember.id) : [];
  const activeNotice = [...selectedLifecycle].reverse().find((entry) => (
    String(entry.kind ?? entry.metadata?.kind ?? entry.metadata?.type ?? '').includes('notice')
      || String(entry.id).includes('notice')
  ) && !['completed', 'cancelled', 'rejected'].includes(entry.status)) ?? null;
  const activeRetirement = [...selectedLifecycle].reverse().find((entry) => (
    String(entry.kind ?? entry.metadata?.kind ?? entry.metadata?.type ?? '').includes('retirement')
      || String(entry.id).includes('retirement')
  ) && !['completed', 'cancelled', 'rejected'].includes(entry.status)) ?? null;
  const activeAgreement = [...selectedLifecycle].reverse().find((entry) => (
    String(entry.kind ?? entry.metadata?.kind ?? entry.metadata?.type ?? '').includes('mutual')
      || String(entry.id).includes('agreement')
  ) && !['completed', 'cancelled', 'rejected'].includes(entry.status)) ?? null;
  const activeLeave = [...selectedLifecycle].reverse().find((entry) => (
    String(entry.kind ?? entry.metadata?.kind ?? entry.metadata?.type ?? '').includes('leave')
      || String(entry.id).includes('leave')
  ) && !['completed', 'cancelled', 'rejected'].includes(entry.status)) ?? null;
  const activeLeaveInternalStatus = String(activeLeave?.metadata?.internalStatus ?? activeLeave?.status ?? '');
  const agreementNextResponder = String(activeAgreement?.metadata?.nextResponder ?? '');
  const agreementSignatures = activeAgreement?.metadata?.signatures as Record<string, unknown> | undefined;
  const clubMayAnswerAgreement = agreementNextResponder === 'club';
  const clubMaySignAgreement = activeAgreement?.status === 'accepted' && !agreementSignatures?.club;
  const retirementNeedsDate = ['scheduled', 'planned'].includes(retirementType);
  const lifecycleTerms = {
    confidentiality,
    preserveBonuses,
    pendingBonuses,
    temporaryBenefits,
    noticePay,
    ...(lifecycleNotes.trim() ? { notes: lifecycleNotes.trim() } : {}),
  };
  const monthlyCostKnown = career.staff.every((member) => {
    const contract = career.contractForStaff(member.id);
    return Boolean(contract && finiteOrNull(contract.wage) !== null);
  });
  const monthlyCost = career.activeStaffContracts.reduce((sum, contract) => sum + finite(contract.wage), 0);
  const knownRatings = career.staff.map(memberRating).filter((value): value is number => value !== null);
  const quality = knownRatings.length
    ? knownRatings.reduce((sum, rating) => sum + rating, 0) / knownRatings.length
    : null;
  const trainingImpact = Math.max(0, Math.round((finite(career.staffEffects?.trainingDevelopmentMultiplier, 1) - 1) * 100));
  const injuryReduction = Math.max(0, Math.round((1 - finite(career.staffEffects?.injuryRiskMultiplier, 1)) * 100));
  const tacticalBonus = Math.max(0, finite(career.staffEffects?.tacticalAnalysisBonus));
  const highlight = useMemo(() => [...career.staff]
    .filter((member) => memberRating(member) !== null)
    .sort((left, right) => (memberRating(right) ?? 0) - (memberRating(left) ?? 0))[0] ?? null,
    [career.staff]);
  const packageCandidates = useMemo(() => career.candidates.filter((candidate) => (
    packageCandidateIds.includes(candidate.id)
  )), [career.candidates, packageCandidateIds]);
  const packageEstimatedCost = useMemo(() => packageCandidates.reduce((sum, candidate) => (
    sum
      + (packageWage > 0 ? packageWage : Math.max(0, finite(candidate.salary))) * 12
      + Math.max(0, packageSigningBonus)
  ), 0), [packageCandidates, packageSigningBonus, packageWage]);
  const packageCostExceeded = packageMaximumCost > 0 && packageEstimatedCost > packageMaximumCost;

  function closeDialog() {
    if (career.pending) return;
    setDialog(null);
    setConfirmFire(false);
  }

  function openCandidates() {
    setDialog({ kind: 'hire', staffId: null });
    setConfirmFire(false);
    setPackageMode(false);
    setPackageCandidateIds([]);
  }

  function selectCandidate(member: CareerStaffMember) {
    setDialog({ kind: 'hire', staffId: member.id });
    setYears(3);
    setWage(Math.max(1_000, Math.round(finite(member.salary, 1_000))));
    setBonus(Math.max(0, Math.round(finite(member.salary, 0))));
  }

  function manage(member: CareerStaffMember) {
    const contract = career.contractForStaff(member.id);
    setDialog({ kind: 'manage', staffId: member.id });
    setYears(3);
    setWage(Math.max(1_000, Math.round(finite(contract?.wage ?? member.salary, 1_000))));
    setBonus(Math.max(0, Math.round(finite(contract?.wage ?? member.salary, 0) * 0.5)));
    setAffiliationType(member.affiliationType === 'personal_staff'
      ? 'personal_team'
      : member.affiliationType ?? 'independent');
    setLifecycleDate(futureDateInput(30, career.state?.currentDate));
    setRetirementDate(futureDateInput(120, career.state?.currentDate));
    setLifecycleReason('');
    setLifecycleCompensation(Math.round(approximateTerminationFee(contract, career.state?.currentDate) * 0.5));
    setNoticeType('standard');
    setRetirementType('scheduled');
    setPendingBonuses(0);
    setTemporaryBenefits(0);
    setNoticePay(0);
    setPreserveBonuses(true);
    setConfidentiality(false);
    setLifecycleNotes('');
    setLeaveReason('');
    setLeaveStartDate(futureDateInput(0, career.state?.currentDate));
    setLeaveEndDate(futureDateInput(30, career.state?.currentDate));
    setLeavePaymentType('full');
    setLeavePaymentRate(50);
    setLeavePaymentNotes('');
    setActingStaffId('');
    setTemporaryBonus(0);
    setAuthorityLevel(50);
    setConfirmFire(false);
  }

  function togglePackageCandidate(staffId: string) {
    setPackageCandidateIds((current) => current.includes(staffId)
      ? current.filter((candidateId) => candidateId !== staffId)
      : [...current, staffId]);
  }

  async function submitHire() {
    if (!selectedCandidate) return;
    try {
      await career.hireStaff(selectedCandidate.id, { years, wage, signingBonus: bonus });
      setDialog(null);
      onToast(`${selectedCandidate.name} foi contratado e salvo na carreira.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível contratar o profissional.');
    }
  }

  async function submitPackageHire() {
    if (!packageCandidates.length || packageCostExceeded) return;
    try {
      await career.hireStaffPackage(packageCandidates.map((candidate) => ({
        staffId: candidate.id,
        years: packageYears,
        ...(packageWage > 0 ? { wage: packageWage } : {}),
        signingBonus: packageSigningBonus,
        affiliationType: 'personal_team',
      })), packageMaximumCost > 0 ? packageMaximumCost : undefined);
      setDialog(null);
      setPackageCandidateIds([]);
      onToast(`${packageCandidates.length} profissionais contratados em conjunto.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível contratar a comissão em conjunto.');
    }
  }

  async function submitRenewal() {
    if (!selectedMember) return;
    try {
      await career.renewStaff(selectedMember.id, { years, wage, renewalBonus: bonus });
      setDialog(null);
      onToast(`Contrato de ${selectedMember.name} renovado.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível renovar o contrato.');
    }
  }

  async function submitFire() {
    if (!selectedMember) return;
    if (!confirmFire) {
      setConfirmFire(true);
      return;
    }
    try {
      await career.fireStaff(selectedMember.id);
      setDialog(null);
      setConfirmFire(false);
      onToast(`${selectedMember.name} deixou a comissão técnica.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível encerrar o contrato.');
    }
  }

  async function submitLifecycle(action: ProfessionalLifecycleAction, payload: Record<string, unknown>, message: string) {
    if (!selectedMember) return;
    try {
      await career.runStaffLifecycle(selectedMember.id, action, payload);
      onToast(message);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível atualizar o ciclo profissional.');
    }
  }

  async function startLeave() {
    if (!selectedMember || !leaveReason.trim() || !leaveEndDate) return;
    const normalizedRate = leavePaymentType === 'full'
      ? 1
      : leavePaymentType === 'unpaid' ? 0 : clamp(leavePaymentRate / 100, 0, 1);
    await submitLifecycle('leave_start', {
      reason: leaveReason.trim(),
      startsAt: leaveStartDate || undefined,
      expectedEndAt: leaveEndDate,
      paymentType: leavePaymentType,
      paymentRate: normalizedRate,
      paymentNotes: leavePaymentNotes.trim() || undefined,
      actingStaffId: actingStaffId || undefined,
      temporaryBonus,
      authorityLevel,
    }, 'Afastamento profissional registrado.');
  }

  if (!career.state) {
    return <main className="secondary-view view-enter"><div className="view-heading"><div><p className="eyebrow">BASTIDORES</p><h1>Comissão técnica</h1><p>{career.error ?? 'Sincronizando profissionais da carreira…'}</p></div></div></main>;
  }

  const modalFooter = dialog?.kind === 'hire'
    ? <><Button variant="ghost" disabled={Boolean(career.pending)} onClick={closeDialog}>Fechar</Button>{packageMode
      ? <Button
          variant="primary"
          loading={career.pending === 'staff-package-hire'}
          disabled={packageCandidates.length === 0 || packageCostExceeded || packageYears < 1}
          onClick={() => void submitPackageHire()}
        >
          Contratar comissão ({packageCandidates.length})
        </Button>
      : selectedCandidate && <Button variant="primary" loading={career.pending === `hire:${selectedCandidate.id}`} disabled={years < 1 || wage < 1_000} onClick={() => void submitHire()}>Confirmar contratação</Button>}</>
    : dialog?.kind === 'manage' && selectedMember
      ? <><Button variant="ghost" disabled={Boolean(career.pending)} onClick={closeDialog}>Fechar</Button><Button variant="danger" loading={career.pending === `fire:${selectedMember.id}`} onClick={() => void submitFire()}>{confirmFire ? 'Confirmar demissão' : 'Demitir'}</Button><Button variant="primary" loading={career.pending === `renew:${selectedMember.id}`} disabled={years < 1 || wage < 1_000} onClick={() => void submitRenewal()}>Renovar contrato</Button></>
      : null;

  return <main className="secondary-view view-enter">
    <div className="view-heading"><div><p className="eyebrow">BASTIDORES · {career.staff.length} PROFISSIONAIS</p><h1>Comissão técnica</h1><p>A equipe multidisciplinar por trás do desempenho do {club.name}.</p></div><Button variant="primary" icon={<UsersRound size={15} />} disabled={!socket?.connected} onClick={openCandidates}>Contratar profissional</Button></div>
    {career.error && <p className="form-error" role="alert">{career.error}</p>}
    <section className="staff-summary"><div><Shield size={18} /><div><small>QUALIDADE DA COMISSÃO</small><strong>{quality !== null ? quality.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : 'Não informada'} {quality !== null && <em>/ 10</em>}</strong></div><Badge tone={career.staff.length ? 'positive' : 'warning'}>{career.staff.length ? `${career.activeStaffContracts.length} contratos ativos` : 'Comissão vazia'}</Badge><div className="staff-cost"><small>CUSTO MENSAL</small><strong>{monthlyCostKnown ? formatCurrency(monthlyCost) : 'Não informado'}</strong></div></div></section>

    {career.staff.length > 0 ? <div className="staff-grid">{career.staff.map((member) => {
      const meta = roleFor(member);
      const Icon = meta.icon;
      const contract = career.contractForStaff(member.id);
      const rating = memberRating(member);
      const knowledge = knowledgePercent(member);
      const satisfaction = finiteOrNull(member.satisfaction);
      return <article key={member.id} style={{ '--staff-color': meta.color } as CSSProperties}><header><span className="staff-avatar">{initials(member.name)}</span><span><small>{meta.label.toLocaleUpperCase('pt-BR')}</small><h2>{member.name}</h2></span><Badge tone="neutral">{rating === null ? 'Não informado' : rating.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</Badge></header><div className="professional-cycle-tags"><Badge tone="neutral">{affiliationLabels[member.affiliationType ?? 'independent']}</Badge>{member.status === 'on_leave' && <Badge tone="warning">Afastado</Badge>}{member.lifecycleStatus && <Badge tone="warning">{member.lifecycleStatus}</Badge>}{member.interimAssignment && <Badge tone="info">Interino</Badge>}</div><div className="staff-specialty"><Icon size={16} /><span><small>ESPECIALIDADE</small><strong>{member.specialties?.[0] ?? meta.label}</strong></span></div><dl><div><dt>Conhecimento</dt><dd>{knowledge === null ? 'Não informado' : `${knowledge}%`}</dd></div><div><dt>Satisfação</dt><dd>{satisfaction === null ? 'Não informada' : `${Math.round(clamp(satisfaction, 0, 100))}%`}</dd></div></dl>{knowledge === null ? <small>Atributos profissionais não cadastrados.</small> : <ProgressBar value={knowledge} />}<footer><span><CalendarClock size={13} /> Contrato: {monthAndYear(contract?.endDate)}</span><button onClick={() => manage(member)}>Gerenciar</button></footer></article>;
    })}</div> : <section className="staff-report"><div><UsersRound size={19} /><span><p className="eyebrow">COMISSÃO VAZIA</p><h2>Nenhum profissional contratado.</h2><p>Abra o mercado de profissionais para montar a comissão do clube.</p></span></div><Button variant="primary" onClick={openCandidates}>Buscar profissionais</Button></section>}

    {highlight && <section className="staff-report"><div><Sparkles size={19} /><span><p className="eyebrow">IMPACTO PERSISTENTE</p><h2>Treino +{trainingImpact}% · risco de lesão −{injuryReduction}%</h2><p>Análise tática +{tacticalBonus.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}. Os efeitos vêm dos atributos e contratos ativos.</p></span></div><div><Award size={18} /><span><small>DESTAQUE DA COMISSÃO</small><strong>{highlight.name}</strong><p>{highlight.specialties?.[0] ?? roleFor(highlight).label}</p></span></div><Badge tone="positive">Salvo no clube</Badge></section>}

    <Modal
      open={Boolean(dialog)}
      onClose={closeDialog}
      title={dialog?.kind === 'manage' ? selectedMember?.name ?? 'Gerenciar profissional' : selectedCandidate?.name ?? 'Mercado de profissionais'}
      eyebrow={dialog?.kind === 'manage' ? 'CONTRATO DA COMISSÃO' : 'CANDIDATOS LIVRES'}
      footer={modalFooter}
      size="lg"
    >
      {dialog?.kind === 'hire' && <div className="bid-form">
        <section className="professional-cycle-card">
          <div className="professional-cycle-card__heading">
            <span><small>FORMA DE CONTRATAÇÃO</small><strong>{packageMode ? 'Comissão em conjunto' : 'Profissional individual'}</strong></span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPackageMode((current) => !current);
                setDialog({ kind: 'hire', staffId: null });
                setPackageCandidateIds([]);
              }}
            >
              {packageMode ? 'Contratar individual' : 'Montar pacote'}
            </Button>
          </div>
          {packageMode && <p>Selecione vários profissionais. O servidor valida todo o custo e só confirma se o pacote inteiro puder ser contratado.</p>}
        </section>
        {career.candidates.length > 0 ? <div className="staff-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>{career.candidates.map((candidate) => {
          const meta = roleFor(candidate);
          const Icon = meta.icon;
          const rating = memberRating(candidate);
          const age = finiteOrNull(candidate.age);
          const packageSelected = packageCandidateIds.includes(candidate.id);
          const personalData = [
            typeof candidate.nationality === 'string' && candidate.nationality.trim() ? candidate.nationality.trim() : null,
            age !== null ? `${Math.round(age)} anos` : null,
          ].filter(Boolean).join(' · ');
          const selected = packageMode ? packageSelected : selectedCandidate?.id === candidate.id;
          return <article key={candidate.id} style={{ '--staff-color': meta.color, borderColor: selected ? meta.color : undefined } as CSSProperties}><header><span className="staff-avatar">{initials(candidate.name)}</span><span><small>{meta.label.toLocaleUpperCase('pt-BR')}</small><h2>{candidate.name}</h2></span><Badge tone="neutral">{rating === null ? 'Não informado' : rating.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</Badge></header><div className="staff-specialty"><Icon size={16} /><span><small>PRETENSÃO MENSAL</small><strong>{finiteOrNull(candidate.salary) === null ? 'Não informada' : formatCurrency(candidate.salary)}</strong></span></div><footer><span>{personalData || 'Dados pessoais não informados'}</span><button onClick={() => packageMode ? togglePackageCandidate(candidate.id) : selectCandidate(candidate)}>{selected ? 'Selecionado' : 'Selecionar'}</button></footer></article>;
        })}</div> : <div className="market-empty"><UsersRound size={22} /><strong>Nenhum candidato disponível</strong><small>Novos profissionais aparecerão quando o mercado for atualizado.</small></div>}
        {packageMode
          ? <section className="professional-cycle-card">
              <div className="professional-cycle-card__heading">
                <span><small>PACOTE SELECIONADO</small><strong>{packageCandidates.length} profissional(is) · estimativa {formatCurrency(packageEstimatedCost)}</strong></span>
                <Badge tone={packageCostExceeded ? 'warning' : 'positive'}>{packageCostExceeded ? 'Acima do teto' : 'Prévia válida'}</Badge>
              </div>
              <div className="market-form-grid">
                <label><span>DURAÇÃO DOS CONTRATOS</span><select value={packageYears} onChange={(event) => setPackageYears(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} temporada{value > 1 ? 's' : ''}</option>)}</select></label>
                <label><span>SALÁRIO ÚNICO (0 = pretensão)</span><input type="number" min="0" step="1000" value={packageWage} onChange={(event) => setPackageWage(Math.max(0, Number(event.target.value)))} /></label>
                <label><span>BÔNUS POR PROFISSIONAL</span><input type="number" min="0" step="1000" value={packageSigningBonus} onChange={(event) => setPackageSigningBonus(Math.max(0, Number(event.target.value)))} /></label>
                <label><span>TETO DO PRIMEIRO ANO (0 = sem teto)</span><input type="number" min="0" step="1000" value={packageMaximumCost} onChange={(event) => setPackageMaximumCost(Math.max(0, Number(event.target.value)))} /></label>
              </div>
              {packageCostExceeded && <div className="budget-warning">A estimativa ultrapassa o teto informado. Ajuste o pacote antes de confirmar.</div>}
            </section>
          : selectedCandidate && <><div className="bid-summary"><span><small>FUNÇÃO</small><strong>{roleFor(selectedCandidate).label}</strong></span><span><small>ESPECIALIDADE</small><strong>{selectedCandidate.specialties?.[0] ?? 'Não informada'}</strong></span></div><div className="market-form-grid"><label><span>DURAÇÃO</span><select value={years} onChange={(event) => setYears(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} temporada{value > 1 ? 's' : ''}</option>)}</select></label><label><span>SALÁRIO MENSAL</span><input type="number" min="1000" step="1000" value={wage} onChange={(event) => setWage(Math.max(0, Number(event.target.value)))} /></label></div><label><span>BÔNUS DE ASSINATURA</span><input type="number" min="0" step="1000" value={bonus} onChange={(event) => setBonus(Math.max(0, Number(event.target.value)))} /></label></>}
      </div>}

      {dialog?.kind === 'manage' && selectedMember && <div className="bid-form">
        <div className="bid-summary"><span><small>CONTRATO ATUAL</small><strong>Até {monthAndYear(selectedContract?.endDate)}</strong></span><span><small>SALÁRIO ATUAL</small><strong>{formatCurrency(selectedContract?.wage ?? selectedMember.salary)}</strong></span></div>
        <div className="market-form-grid"><label><span>NOVA DURAÇÃO</span><select value={years} onChange={(event) => setYears(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} temporada{value > 1 ? 's' : ''}</option>)}</select></label><label><span>NOVO SALÁRIO</span><input type="number" min="1000" step="1000" value={wage} onChange={(event) => setWage(Math.max(0, Number(event.target.value)))} /></label></div>
        <label><span>BÔNUS DE RENOVAÇÃO</span><input type="number" min="0" step="1000" value={bonus} onChange={(event) => setBonus(Math.max(0, Number(event.target.value)))} /></label>
        <section className="professional-cycle-card">
          <div className="professional-cycle-card__heading">
            <span><small>VÍNCULO PROFISSIONAL</small><strong>{affiliationLabels[affiliationType]}</strong></span>
            {selectedMember.interimAssignment && <Badge tone="warning">Interino</Badge>}
            {selectedMember.lifecycleStatus && <Badge tone="info">{selectedMember.lifecycleStatus}</Badge>}
          </div>
          <div className="market-form-grid">
            <label><span>RELAÇÃO COM O TREINADOR</span><select value={affiliationType} onChange={(event) => setAffiliationType(event.target.value as ProfessionalAffiliationType)}>{affiliationOptions.map((value) => <option key={value} value={value}>{affiliationLabels[value]}</option>)}</select></label>
            <Button size="sm" variant="ghost" loading={career.pending === `lifecycle:${selectedMember.id}:staff_link_update`} onClick={() => void submitLifecycle('staff_link_update', {
              affiliationType,
              linkedCoachId: ['personal_team', 'personal_staff', 'coach_recommended'].includes(affiliationType) ? managerId : null,
            }, 'Vínculo da comissão atualizado.')}>Salvar vínculo</Button>
          </div>
          {selectedMember.interimAssignment && <>
            <dl className="professional-cycle-facts"><div><dt>Interinidade</dt><dd>{monthAndYear(selectedMember.interimAssignment.startsAt)} · autoridade {selectedMember.interimAssignment.authorityLevel ?? 'não informada'}</dd></div></dl>
            {selectedMember.interimAssignment.status === 'active' && <div className="professional-cycle-actions">
              <Button size="sm" variant="primary" loading={career.pending === `lifecycle:${selectedMember.id}:interim_confirm`} onClick={() => void submitLifecycle('interim_confirm', {}, `${selectedMember.name} foi efetivado como treinador principal.`)}>Efetivar como treinador</Button>
            </div>}
          </>}
        </section>

        <section className="professional-cycle-card">
          <div className="professional-cycle-card__heading"><span><small>PLANEJAR SAÍDA</small><strong>Aviso, aposentadoria ou acordo negociado</strong></span></div>
          <div className="market-form-grid">
            <label><span>DATA DO AVISO / ACORDO</span><input type="date" value={lifecycleDate} onChange={(event) => setLifecycleDate(event.target.value)} /></label>
            <label><span>COMPENSAÇÃO PROPOSTA</span><input type="number" min="0" step="1000" value={lifecycleCompensation} onChange={(event) => setLifecycleCompensation(Math.max(0, Number(event.target.value)))} /></label>
            <label><span>MODALIDADE DO AVISO</span><select value={noticeType} onChange={(event) => setNoticeType(event.target.value as ProfessionalNoticeType)}><option value="standard">Aviso com prazo</option><option value="negotiated">Aviso negociado (acordo mútuo)</option><option value="immediate">Saída imediata</option></select></label>
            <label><span>MOMENTO DA APOSENTADORIA</span><select value={retirementType} onChange={(event) => setRetirementType(event.target.value as ProfessionalRetirementType)}><option value="scheduled">Data escolhida</option><option value="planned">Planejada</option><option value="end_season">Fim da temporada</option><option value="end_contract">Fim do contrato</option><option value="immediate">Imediata</option></select></label>
            <label><span>DATA DA APOSENTADORIA</span><input type="date" value={retirementDate} disabled={!retirementNeedsDate} onChange={(event) => setRetirementDate(event.target.value)} /></label>
            <label><span>BÔNUS PENDENTES</span><input type="number" min="0" step="1000" value={pendingBonuses} onChange={(event) => setPendingBonuses(Math.max(0, Number(event.target.value)))} /></label>
            <label><span>BENEFÍCIOS TEMPORÁRIOS</span><input type="number" min="0" step="1000" value={temporaryBenefits} onChange={(event) => setTemporaryBenefits(Math.max(0, Number(event.target.value)))} /></label>
            <label><span>INDENIZAÇÃO DO AVISO</span><input type="number" min="0" step="1000" value={noticePay} onChange={(event) => setNoticePay(Math.max(0, Number(event.target.value)))} /></label>
          </div>
          <label><span>MOTIVO / CONDIÇÕES</span><textarea rows={2} maxLength={240} value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} placeholder="Opcional" /></label>
          <label><span>OBSERVAÇÕES DO ACORDO</span><textarea rows={2} maxLength={500} value={lifecycleNotes} onChange={(event) => setLifecycleNotes(event.target.value)} placeholder="Cláusulas ou condições adicionais" /></label>
          <label className="professional-cycle-check"><input type="checkbox" checked={preserveBonuses} onChange={(event) => setPreserveBonuses(event.target.checked)} /><span>Preservar bônus pendentes</span></label>
          <label className="professional-cycle-check"><input type="checkbox" checked={confidentiality} onChange={(event) => setConfidentiality(event.target.checked)} /><span>Cláusula de confidencialidade</span></label>
          <div className="professional-cycle-actions">
            {!activeNotice
              ? <Button size="sm" variant="ghost" disabled={noticeType !== 'immediate' && !lifecycleDate} loading={career.pending === `lifecycle:${selectedMember.id}:notice_start`} onClick={() => void submitLifecycle('notice_start', {
                ...(noticeType === 'immediate' ? {} : { effectiveAt: lifecycleDate }),
                noticeType,
                immediateExit: noticeType === 'immediate',
                reason: lifecycleReason,
                terms: lifecycleTerms,
              }, noticeType === 'immediate' ? 'Saída imediata confirmada.' : 'Aviso prévio iniciado.')}>Iniciar aviso</Button>
              : <Button size="sm" variant="ghost" loading={career.pending === `lifecycle:${selectedMember.id}:notice_end_early`} onClick={() => void submitLifecycle('notice_end_early', { lifecycleId: activeNotice.id, reason: lifecycleReason }, 'Aviso encerrado antecipadamente.')}>Encerrar aviso</Button>}
            {!activeRetirement
              ? <Button size="sm" variant="ghost" disabled={retirementNeedsDate && !retirementDate} loading={career.pending === `lifecycle:${selectedMember.id}:retirement_announce`} onClick={() => void submitLifecycle('retirement_announce', {
                ...(retirementNeedsDate ? { effectiveAt: retirementDate } : {}),
                retirementType,
                reason: lifecycleReason,
              }, retirementType === 'immediate' ? 'Aposentadoria efetivada.' : 'Aposentadoria anunciada.')}>Anunciar aposentadoria</Button>
              : <><Button size="sm" variant="ghost" disabled={!retirementDate} loading={career.pending === `lifecycle:${selectedMember.id}:retirement_postpone`} onClick={() => void submitLifecycle('retirement_postpone', { lifecycleId: activeRetirement.id, effectiveAt: retirementDate }, 'Aposentadoria adiada.')}>Adiar aposentadoria</Button><Button size="sm" variant="ghost" loading={career.pending === `lifecycle:${selectedMember.id}:retirement_cancel`} onClick={() => void submitLifecycle('retirement_cancel', { lifecycleId: activeRetirement.id }, 'Aposentadoria cancelada.')}>Cancelar aposentadoria</Button></>}
          </div>
          <div className="professional-cycle-actions">
            {!activeAgreement
              ? <Button size="sm" disabled={!lifecycleDate} loading={career.pending === `lifecycle:${selectedMember.id}:mutual_agreement_propose`} onClick={() => void submitLifecycle('mutual_agreement_propose', { proposedExitAt: lifecycleDate, compensation: lifecycleCompensation, reason: lifecycleReason, terms: lifecycleTerms }, 'Proposta de acordo enviada.')}>Propor acordo mútuo</Button>
              : <>
                <Badge tone={activeAgreement.status === 'signed' ? 'positive' : 'warning'}>{activeAgreement.status} · rodada {Number(activeAgreement.negotiationRound ?? activeAgreement.metadata?.negotiationRound ?? 1)}</Badge>
                {clubMayAnswerAgreement && <Button size="sm" variant="ghost" disabled={!lifecycleDate} loading={career.pending === `lifecycle:${selectedMember.id}:mutual_agreement_counter`} onClick={() => void submitLifecycle('mutual_agreement_counter', { lifecycleId: activeAgreement.id, proposedExitAt: lifecycleDate, compensation: lifecycleCompensation, reason: lifecycleReason, terms: lifecycleTerms }, 'Contraproposta enviada.')}>Contrapor</Button>}
                {clubMayAnswerAgreement && <Button size="sm" variant="ghost" loading={career.pending === `lifecycle:${selectedMember.id}:mutual_agreement_accept`} onClick={() => void submitLifecycle('mutual_agreement_accept', { lifecycleId: activeAgreement.id }, 'Acordo aceito.')}>Aceitar</Button>}
                {clubMayAnswerAgreement && <Button size="sm" variant="ghost" loading={career.pending === `lifecycle:${selectedMember.id}:mutual_agreement_reject`} onClick={() => void submitLifecycle('mutual_agreement_reject', { lifecycleId: activeAgreement.id }, 'Acordo rejeitado.')}>Rejeitar</Button>}
                {clubMaySignAgreement && <Button size="sm" loading={career.pending === `lifecycle:${selectedMember.id}:mutual_agreement_sign`} onClick={() => void submitLifecycle('mutual_agreement_sign', { lifecycleId: activeAgreement.id }, 'Assinatura do clube registrada.')}>Assinar</Button>}
                {!clubMayAnswerAgreement && !clubMaySignAgreement && activeAgreement.status !== 'signed' && <Badge tone="neutral">Aguardando o profissional</Badge>}
              </>}
          </div>
        </section>
        <section className="professional-cycle-card">
          <div className="professional-cycle-card__heading">
            <span><small>AFASTAMENTO PROFISSIONAL</small><strong>{activeLeave ? `Situação: ${activeLeaveInternalStatus || activeLeave.status}` : 'Contrato preservado durante a ausência'}</strong></span>
            {activeLeave && <Badge tone={activeLeaveInternalStatus === 'active' ? 'warning' : 'info'}>{activeLeaveInternalStatus || activeLeave.status}</Badge>}
          </div>
          {!activeLeave ? <>
            <div className="market-form-grid">
              <label><span>INÍCIO</span><input type="date" value={leaveStartDate} onChange={(event) => setLeaveStartDate(event.target.value)} /></label>
              <label><span>RETORNO PREVISTO</span><input type="date" value={leaveEndDate} onChange={(event) => setLeaveEndDate(event.target.value)} /></label>
              <label><span>PAGAMENTO</span><select value={leavePaymentType} onChange={(event) => setLeavePaymentType(event.target.value as 'full' | 'partial' | 'unpaid')}><option value="full">Integral</option><option value="partial">Parcial</option><option value="unpaid">Sem remuneração</option></select></label>
              {leavePaymentType === 'partial' && <label><span>PERCENTUAL PAGO</span><input type="number" min="1" max="99" value={leavePaymentRate} onChange={(event) => setLeavePaymentRate(clamp(Number(event.target.value), 1, 99))} /></label>}
            </div>
            <label><span>MOTIVO</span><textarea rows={2} maxLength={500} value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} placeholder="Obrigatório" /></label>
            <label><span>OBSERVAÇÕES DO PAGAMENTO</span><textarea rows={2} maxLength={500} value={leavePaymentNotes} onChange={(event) => setLeavePaymentNotes(event.target.value)} placeholder="Opcional" /></label>
            <div className="professional-cycle-actions">
              <Button size="sm" disabled={!leaveReason.trim() || !leaveStartDate || !leaveEndDate} loading={career.pending === `lifecycle:${selectedMember.id}:leave_start`} onClick={() => void startLeave()}>Registrar afastamento</Button>
            </div>
          </> : <>
            <dl className="professional-cycle-facts">
              <div><dt>Período</dt><dd>{monthAndYear(String(activeLeave.metadata?.startsAt ?? activeLeave.startsAt ?? ''))} até {monthAndYear(String(activeLeave.metadata?.expectedEndAt ?? activeLeave.endsAt ?? ''))}</dd></div>
              <div><dt>Motivo</dt><dd>{String(activeLeave.reason ?? activeLeave.metadata?.reason ?? 'Não informado')}</dd></div>
            </dl>
            <div className="professional-cycle-actions">
              {activeLeaveInternalStatus === 'active' && <Button size="sm" loading={career.pending === `lifecycle:${selectedMember.id}:leave_end`} onClick={() => void submitLifecycle('leave_end', { lifecycleId: activeLeave.id, reason: 'Retorno antecipado' }, 'Retorno antecipado registrado.')}>Antecipar retorno</Button>}
              {['scheduled', 'active'].includes(activeLeaveInternalStatus) && <Button size="sm" variant="ghost" loading={career.pending === `lifecycle:${selectedMember.id}:leave_cancel`} onClick={() => void submitLifecycle('leave_cancel', { lifecycleId: activeLeave.id, reason: 'Afastamento cancelado' }, 'Afastamento cancelado.')}>Cancelar afastamento</Button>}
            </div>
          </>}
        </section>
        {confirmFire && <div className="budget-warning">Demissão comum, sem acordo negociado. Multa estimada: {formatCurrency(approximateTerminationFee(selectedContract, career.state?.currentDate))}. Confirme no botão abaixo.</div>}
      </div>}
    </Modal>
  </main>;
}
