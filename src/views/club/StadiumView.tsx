import { useState } from 'react';
import {
  Building2, CalendarClock, Check, ChevronRight, CircleDollarSign, Construction,
  Dumbbell, GraduationCap, HeartPulse, Lightbulb, ParkingCircle, ScanLine,
  RefreshCw, Search, Shield, ShoppingBag, Sparkles, Theater, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { Modal } from '../../components/shared/Modal';
import { ProgressBar } from '../../components/shared/ProgressBar';
import { useClubCareer } from '../../hooks/useClubCareer';
import { useMarket } from '../../hooks/useMarket';
import type { BolaSocket, ClubChoice, Room } from '../../types';
import { formatCurrency } from '../../utils/formatters';

interface StadiumViewProps {
  club: ClubChoice;
  room: Room | null;
  socket: BolaSocket | null;
  managerId: string;
  onToast: (message: string) => void;
}

const noop = () => {};
const areaIcons: Record<string, LucideIcon> = {
  stands: Building2, pitch: ScanLine, lighting: Lightbulb, coverage: Theater,
  security: Shield, comfort: Sparkles, parking: ParkingCircle, commercial: ShoppingBag,
  training: Dumbbell, academy: GraduationCap, medical: HeartPulse, analysis: Wrench,
  scouting: Search, recovery: HeartPulse, physiology: Dumbbell,
  administration: Building2, technology: Sparkles,
};

function daysRemaining(expectedAt: string, currentDate: string | undefined) {
  if (!currentDate) return null;
  const remaining = Date.parse(expectedAt) - Date.parse(currentDate);
  return Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining / 86_400_000)) : null;
}

function finiteNonNegative(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function projectStatus(status: 'active' | 'completed' | 'cancelled') {
  if (status === 'active') return { label: 'EM ANDAMENTO', badge: 'Em andamento', tone: 'warning' as const };
  if (status === 'completed') return { label: 'CONCLUÍDA', badge: 'Concluída', tone: 'positive' as const };
  return { label: 'CANCELADA', badge: 'Cancelada', tone: 'danger' as const };
}

export function StadiumView({ club, room, socket, managerId, onToast }: StadiumViewProps) {
  const career = useClubCareer(room, socket, club.id, managerId);
  const market = useMarket(room, socket, managerId, noop);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const facility = career.facility;
  const stadium = facility?.stadium;
  const selectedArea = facility?.areas.find((area) => area.id === selectedId) ?? null;
  const selectedQuote = selectedArea?.nextUpgradeQuote ?? null;
  const cashAvailable = market.snapshot?.finance.cashAvailable ?? null;
  const financeLoaded = cashAvailable !== null;

  async function approveUpgrade() {
    if (!selectedArea) return;
    try {
      const project = await career.startUpgrade(selectedArea.id, { noticeApproval: true });
      setSelectedId(null);
      onToast(`${project.name}: obra iniciada e salva na carreira.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível iniciar a obra.');
    }
  }

  if (!facility || !stadium) {
    const configuredName = typeof club.stadium === 'string' ? club.stadium.trim() : '';
    const configuredCapacity = finiteNonNegative(club.stadiumCapacity);
    if (configuredName) {
      return <main className="secondary-view view-enter">
        <div className="view-heading"><div><p className="eyebrow">PATRIMÔNIO DO CLUBE</p><h1>Infraestrutura</h1><p>{career.error ?? 'Sincronizando patrimônio da carreira…'}</p></div></div>
        <section className="stadium-hero">
          <div className="stadium-visual"><div className="stadium-pitch"><span /><i /></div><div className="stand stand--north" /><div className="stand stand--south" /><div className="stadium-label"><span>{configuredName.toLocaleUpperCase('pt-BR')}</span><strong>{configuredCapacity === null ? 'Não informada' : new Intl.NumberFormat('pt-BR').format(configuredCapacity)}</strong><small>capacidade</small></div></div>
          <div className="stadium-info"><Badge tone="neutral">Sincronizando carreira</Badge><h2>{configuredName}</h2><p>Casa do {club.name} · dados cadastrados no Editor.</p></div>
        </section>
      </main>;
    }
    return <main className="secondary-view view-enter"><div className="view-heading"><div><p className="eyebrow">PATRIMÔNIO DO CLUBE</p><h1>Infraestrutura</h1><p>{career.error ?? 'Sincronizando patrimônio da carreira…'}</p></div></div></main>;
  }

  const capacity = finiteNonNegative(stadium.capacity);
  const averageAttendance = finiteNonNegative(stadium.averageAttendance);
  const averageMatchRevenue = finiteNonNegative(stadium.averageMatchRevenue);
  const pitchQuality = finiteNonNegative(stadium.pitchQuality);
  const condition = finiteNonNegative(stadium.condition);
  const matchesHosted = finiteNonNegative(stadium.matchesHosted);
  const stadiumName = typeof stadium.name === 'string' && stadium.name.trim()
    ? stadium.name.trim()
    : 'Estádio sem nome cadastrado';
  const occupancy = capacity !== null && capacity > 0 && averageAttendance !== null
    ? Math.round(averageAttendance / capacity * 100)
    : null;
  return <main className="secondary-view view-enter">
    <div className="view-heading"><div><p className="eyebrow">PATRIMÔNIO DO CLUBE</p><h1>Infraestrutura</h1><p>{stadiumName}, centro de treinamento e base integrados ao save.</p></div><div className="infra-budget"><small>CAIXA DISPONÍVEL</small><strong>{financeLoaded ? formatCurrency(cashAvailable) : market.loading ? 'Sincronizando…' : 'Indisponível'}</strong>{market.syncing && financeLoaded && <small>Atualizando caixa…</small>}</div></div>
    {market.error && <div className="market-error" role="alert"><span>{market.error}</span><Button size="sm" variant="secondary" onClick={() => void market.refresh()} icon={<RefreshCw size={14} />}>Tentar novamente</Button></div>}
    {!market.loading && !market.error && !financeLoaded && <div className="market-error" role="status"><span>O caixa do clube ainda não foi carregado. Sincronize antes de aprovar uma obra.</span><Button size="sm" variant="secondary" onClick={() => void market.refresh()} icon={<RefreshCw size={14} />}>Sincronizar caixa</Button></div>}
    {career.error && <p className="form-error" role="alert">{career.error}</p>}
    <section className="stadium-hero">
      <div className="stadium-visual"><div className="stadium-pitch"><span /><i /></div><div className="stand stand--north" /><div className="stand stand--south" /><div className="stadium-label"><span>{stadiumName.toLocaleUpperCase('pt-BR')}</span><strong>{capacity === null ? 'Não informada' : new Intl.NumberFormat('pt-BR').format(capacity)}</strong><small>capacidade</small></div></div>
      <div className="stadium-info"><Badge tone={career.activeProjects.length ? 'warning' : 'positive'} dot>{career.activeProjects.length ? `${career.activeProjects.length} obra(s) em andamento` : 'Operação normal'}</Badge><h2>{stadiumName}</h2><p>Casa do {club.name} · {matchesHosted === null ? 'histórico de jogos não informado' : matchesHosted > 0 ? `${matchesHosted} jogos registrados no save` : 'aguardando o primeiro jogo em casa'}.</p><dl><div><dt>Bilheteria média / jogo</dt><dd>{averageMatchRevenue === null ? 'Não informada' : formatCurrency(averageMatchRevenue)}</dd></div><div><dt>Qualidade do gramado</dt><dd>{pitchQuality === null ? 'Não informada' : `${pitchQuality}%`}</dd></div><div><dt>Conservação</dt><dd>{condition === null ? 'Não informada' : `${condition}%`}</dd></div></dl>{occupancy === null ? <small>OCUPAÇÃO MÉDIA · Não informada</small> : <><ProgressBar value={occupancy} label="Ocupação média" /><small>OCUPAÇÃO MÉDIA · {occupancy}%</small></>}</div>
    </section>
    {(['stadium', 'infrastructure'] as const).map((category) => <section className="upgrade-section" key={category}><header><div><p className="eyebrow">{category === 'stadium' ? 'DIA DE JOGO' : 'DESENVOLVIMENTO'}</p><h2>{category === 'stadium' ? 'Estádio' : 'Estrutura do clube'}</h2></div><Badge tone="neutral">Níveis 0—5</Badge></header><div className="upgrade-grid">
      {facility.areas.filter((area) => area.category === category).map((area) => {
        const Icon = areaIcons[area.id] ?? Building2;
        const project = career.activeProjects.find((candidate) => candidate.areaId === area.id);
        const quote = area.nextUpgradeQuote;
        const remainingDays = project ? daysRemaining(project.expectedAt, career.state?.currentDate) : null;
        return <article key={area.id}><span className="upgrade-icon"><Icon size={20} /></span><div><span className="upgrade-level">{[1, 2, 3, 4, 5].map((dot) => <i key={dot} className={dot <= area.level ? 'active' : ''} />)} NÍVEL {area.level}</span><h3>{area.name}</h3><p>{area.benefitLabel}</p></div>{project || area.upgradeStatus === 'active' ? <Badge tone="warning"><Construction size={12} /> {project ? remainingDays === null ? 'Prazo não informado' : `${remainingDays} dias` : 'Em andamento'}</Badge> : area.upgradeStatus === 'max' ? <Badge tone="positive"><Check size={12} /> Máximo</Badge> : quote ? <button onClick={() => setSelectedId(area.id)}><span><small>PRÓXIMO NÍVEL</small><strong>{formatCurrency(quote.cost)}</strong></span><ChevronRight size={15} /></button> : <Badge tone="neutral">Indisponível</Badge>}</article>;
      })}
    </div></section>)}
    {career.projects.length > 0 && <section className="upgrade-section"><header><div><p className="eyebrow">HISTÓRICO PERSISTENTE</p><h2>Obras da carreira</h2></div></header><div className="upgrade-grid">{career.projects.slice(-6).reverse().map((project) => {
      const status = projectStatus(project.status);
      const remainingDays = project.status === 'active' ? daysRemaining(project.expectedAt, career.state?.currentDate) : null;
      return <article key={project.id}><span className="upgrade-icon"><Construction size={20} /></span><div><span className="upgrade-level">{status.label}</span><h3>{project.name}</h3><p>Nível {project.fromLevel} → {project.toLevel} · {formatCurrency(project.cost)}</p></div><Badge tone={status.tone}>{project.status === 'active' ? remainingDays === null ? 'Prazo não informado' : `${remainingDays} dias` : status.badge}</Badge></article>;
    })}</div></section>}
    <Modal open={Boolean(selectedArea && selectedQuote)} onClose={() => setSelectedId(null)} title={`Melhorar ${selectedArea?.name ?? ''}`} eyebrow="APROVAÇÃO DE INVESTIMENTO" footer={<><Button variant="ghost" onClick={() => setSelectedId(null)}>Cancelar</Button><Button variant="primary" onClick={() => void approveUpgrade()} disabled={Boolean(!selectedQuote || cashAvailable === null || selectedQuote.cost > cashAvailable || career.pending)}>Aprovar obra</Button></>}>
      {selectedArea && selectedQuote && <div className="upgrade-modal"><span className="construction-icon"><Construction size={27} /></span><p>A obra elevará <strong>{selectedArea.name}</strong> ao nível {selectedQuote.nextLevel}. O avanço acontece pelo calendário, mesmo sem abrir esta tela.</p><dl><div><dt><CircleDollarSign size={14} /> Custo</dt><dd>{formatCurrency(selectedQuote.cost)}</dd></div><div><dt><CalendarClock size={14} /> Prazo</dt><dd>{selectedQuote.durationDays} dias</dd></div><div><dt><Sparkles size={14} /> Impacto</dt><dd>{selectedQuote.benefitLabel}</dd></div></dl>{cashAvailable === null ? <div className="budget-warning">Caixa indisponível. Sincronize os dados financeiros antes de aprovar.</div> : selectedQuote.cost > cashAvailable && <div className="budget-warning">Saldo disponível no caixa insuficiente para esta obra.</div>}</div>}
    </Modal>
  </main>;
}
