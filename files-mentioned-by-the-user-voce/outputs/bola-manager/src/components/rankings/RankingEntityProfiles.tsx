import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  BadgeDollarSign,
  BarChart3,
  Binoculars,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Contact,
  Eye,
  FileSearch,
  Flag,
  HandCoins,
  HeartHandshake,
  History,
  Landmark,
  ListPlus,
  MessageCircle,
  Scale,
  Shield,
  Shirt,
  Star,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  WalletCards,
} from 'lucide-react';
import type { Player, Room } from '../../types';
import { aggregateRankingManagerSeasonStats } from '../../utils/rankings';
import type { RankingClub, RankingHistoryEntry, RankingManager, RankingPlayer } from '../../utils/rankings';
import { buildSeasonTable } from '../../utils/leagueStandings';
import { buildCompetitionClubMatches } from '../../services/competitionClubService';
import type { CompetitionClubMatch } from '../../services/competitionClubService';
import { formatCurrency } from '../../utils/formatters';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { ClubMark } from '../shared/ClubMark';
import { Modal } from '../shared/Modal';
import { ResilientImage } from '../shared/ResilientImage';

type UnknownRecord = Record<string, unknown>;

export type RankingOfferType = 'transfer' | 'loan';
export type RankingPlayerAction = 'report' | 'compare';
export type RankingClubTab = 'overview' | 'squad' | 'tactics' | 'calendar' | 'statistics' | 'finances' | 'history';
type RankingManagerProfileTab = 'summary' | 'career' | 'statistics' | 'achievements' | 'reputation';
export type RankingProfilePlayer = RankingPlayer & {
  potential?: number | null;
  value?: number | null;
  condition?: number | null;
  morale?: string | null;
  status?: string | null;
  negotiability?: string | null;
  loanAvailable?: boolean | null;
  attributes?: Partial<Player['attributes']> | null;
  contract?: {
    startSeason?: number | null;
    endSeason?: number | null;
    wage?: number | null;
    status?: string | null;
  } | null;
};

export interface RankingPlayerOfferState {
  available: boolean;
  loading: boolean;
  syncing: boolean;
  pending: boolean;
  error: string | null;
  blockedReason: string | null;
  listingId: string | null;
  listingMode: 'direct' | 'auction' | null;
  dealType: RankingOfferType | null;
  suggestedAmount: number | null;
}

export interface RankingPlayerProfileProps {
  player: RankingProfilePlayer | null;
  currentClubId?: string | null;
  comparisonPlayers?: RankingProfilePlayer[];
  ownClub?: boolean;
  untradeable?: boolean;
  offerState?: RankingPlayerOfferState;
  onClose: () => void;
  onOffer?: (
    player: RankingProfilePlayer,
    type: RankingOfferType,
    amount: number,
    purchaseOption: number | null,
  ) => void | Promise<void>;
  additionalContent?: ReactNode;
}

export interface RankingManagerProfileProps {
  manager: RankingManager | null;
  comparisonManager?: RankingManager | null;
  room?: Room | null;
  historyEntries?: RankingHistoryEntry[];
  currentManagerId?: string | null;
  historicalSeasonNumber?: number | null;
  historicalSeasonYear?: number | null;
  historicalCompetitionName?: string | null;
  onClose: () => void;
}

export interface RankingClubDetailProps {
  club: RankingClub | null;
  players: RankingProfilePlayer[];
  room: Room | null;
  competitionId?: string | null;
  competitionName?: string | null;
  historyEntries?: RankingHistoryEntry[];
  activeTab?: RankingClubTab;
  onTabChange?: (tab: RankingClubTab) => void;
  onPlayerSelect?: (player: RankingProfilePlayer) => void;
  onBack: () => void;
}

const clubTabs: Array<{ id: RankingClubTab; label: string; icon: typeof Trophy }> = [
  { id: 'overview', label: 'Visão geral', icon: Eye },
  { id: 'squad', label: 'Elenco', icon: Users },
  { id: 'tactics', label: 'Tática', icon: Shield },
  { id: 'calendar', label: 'Calendário', icon: CalendarDays },
  { id: 'statistics', label: 'Estatísticas', icon: BarChart3 },
  { id: 'finances', label: 'Finanças', icon: WalletCards },
  { id: 'history', label: 'Histórico', icon: History },
];

const managerProfileTabs: Array<{ id: RankingManagerProfileTab; label: string; icon: typeof Trophy }> = [
  { id: 'summary', label: 'Resumo', icon: UserRound },
  { id: 'career', label: 'Linha do tempo', icon: History },
  { id: 'statistics', label: 'Estatísticas', icon: BarChart3 },
  { id: 'achievements', label: 'Títulos e conquistas', icon: Trophy },
  { id: 'reputation', label: 'Reputação', icon: Activity },
];

function handleManagerProfileTabKey(
  event: KeyboardEvent<HTMLButtonElement>,
  currentTab: RankingManagerProfileTab,
  selectTab: (tab: RankingManagerProfileTab) => void,
) {
  const currentIndex = managerProfileTabs.findIndex((tab) => tab.id === currentTab);
  let nextIndex: number | null = null;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % managerProfileTabs.length;
  if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + managerProfileTabs.length) % managerProfileTabs.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = managerProfileTabs.length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  const nextTab = managerProfileTabs[nextIndex]?.id;
  if (!nextTab) return;
  selectTab(nextTab);
  window.requestAnimationFrame(() => document.getElementById(`manager-profile-tab-${nextTab}`)?.focus());
}

const playerTabs = ['summary', 'attributes', 'statistics', 'contract'] as const;
type PlayerTab = typeof playerTabs[number];

const playerTabLabels: Record<PlayerTab, string> = {
  summary: 'Resumo',
  attributes: 'Atributos',
  statistics: 'Estatísticas',
  contract: 'Contrato',
};

const attributeLabels: Record<string, string> = {
  chute: 'Chute',
  drible: 'Drible',
  nocao: 'Noção',
  defesa: 'Defesa',
  passe: 'Passe',
  peBom: 'Pé bom',
  peRuim: 'Pé ruim',
  velocidade: 'Velocidade',
  forca: 'Força',
  resistencia: 'Resistência',
  impulsao: 'Impulsão',
  reflexos: 'Reflexos',
  posicionamentoGol: 'Posicionamento',
  saidaGol: 'Saída do gol',
  penaltis: 'Pênaltis',
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown): number | null {
  const parsed = number(value);
  return parsed === null ? null : Math.max(0, Math.trunc(parsed));
}

function key(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '--';
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts.at(-1)?.[0] ?? '' : parts[0]?.[1] ?? ''}`.toLocaleUpperCase('pt-BR');
}

function displayNumber(value: number | null | undefined, suffix = ''): string {
  return Number.isFinite(value) ? `${Number(value).toLocaleString('pt-BR')}${suffix}` : 'Indisponível';
}

function displayDate(value: string | null | undefined): string {
  if (!value) return 'Data não informada';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'Data não informada';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
}

function publicMetric(value: number | null | undefined, maximumFractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { maximumFractionDigits });
}

function publicPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${publicMetric(value, 1)}%`;
}

function periodDurationDays(startedAt: string | null | undefined, endedAt: string | null | undefined): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function publicDuration(days: number | null | undefined, startedAt?: string | null, endedAt?: string | null): string {
  const total = days ?? periodDurationDays(startedAt, endedAt);
  if (total === null || total === undefined || !Number.isFinite(total)) return '—';
  const years = Math.floor(total / 365);
  const months = Math.floor((total % 365) / 30);
  const remainingDays = Math.floor(total % 30);
  const parts = [
    years ? `${years} ${years === 1 ? 'ano' : 'anos'}` : '',
    months ? `${months} ${months === 1 ? 'mês' : 'meses'}` : '',
    !years && remainingDays ? `${remainingDays} ${remainingDays === 1 ? 'dia' : 'dias'}` : '',
  ].filter(Boolean);
  return parts.join(' e ') || '0 dias';
}

function publicCareerStatus(status: RankingManager['status']): string {
  if (status === 'employed') return 'Em atividade';
  if (status === 'unemployed') return 'Sem clube';
  if (status === 'dismissed') return 'Encerrado';
  return '—';
}

function normalizedLabel(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function playerIsUntradeable(player: RankingProfilePlayer, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const status = normalizedLabel(`${player.negotiability ?? ''} ${player.status ?? ''}`);
  return status.includes('inegociavel') || status.includes('not_for_sale') || status.includes('not for sale');
}

function sameClub(left: unknown, right: unknown): boolean {
  return Boolean(key(left) && key(left) === key(right));
}

function rankPlayerMarketValue(player: RankingProfilePlayer): number | null {
  return number(player.value ?? player.marketValue);
}

function EmptyState({ icon: Icon = CircleAlert, title, detail }: {
  icon?: typeof CircleAlert;
  title: string;
  detail: string;
}) {
  return (
    <div className="rankings-empty-state" role="status">
      <Icon size={22} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function RankingPlayerProfile({
  player,
  currentClubId = null,
  comparisonPlayers = [],
  ownClub: explicitOwnClub,
  untradeable: explicitUntradeable,
  offerState,
  onClose,
  onOffer,
  additionalContent = null,
}: RankingPlayerProfileProps) {
  const [activeTab, setActiveTab] = useState<PlayerTab>('summary');
  const [offerType, setOfferType] = useState<RankingOfferType>('transfer');
  const [amount, setAmount] = useState('');
  const [purchaseOption, setPurchaseOption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [comparison, setComparison] = useState<RankingProfilePlayer | null>(null);
  const [reportRequested, setReportRequested] = useState(false);

  useEffect(() => {
    setActiveTab('summary');
    setPurchaseOption('');
    setFeedback(null);
    setComparison(null);
    setReportRequested(false);
  }, [player?.id]);

  useEffect(() => {
    setOfferType(offerState?.dealType ?? 'transfer');
    const marketValue = player ? rankPlayerMarketValue(player) : null;
    const suggestedAmount = offerState?.suggestedAmount ?? marketValue;
    setAmount(suggestedAmount === null ? '' : String(Math.max(0, suggestedAmount)));
  }, [offerState?.dealType, offerState?.listingId, offerState?.suggestedAmount, player?.id]);

  if (!player) return null;
  const selectedPlayer = player;

  const ownClub = explicitOwnClub ?? (sameClub(player.clubId, currentClubId) || sameClub(player.clubCode, currentClubId));
  const untradeable = playerIsUntradeable(player, explicitUntradeable);
  const attributes = Object.entries(player.attributes ?? {})
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
  const marketValue = rankPlayerMarketValue(player);
  const contract = player.contract ?? null;
  const contractWage = number(contract?.wage ?? player.wage);
  const statisticsAvailable = player.statisticsAvailable !== false;
  const comparisonPool = comparisonPlayers.filter((candidate) => (
    candidate.id !== player.id && (!currentClubId || sameClub(candidate.clubId, currentClubId))
  ));
  const hasScoutReportData = attributes.length > 0
    || player.overall !== null && player.overall !== undefined
    || player.potential !== null && player.potential !== undefined
    || statisticsAvailable && player.appearances > 0;
  const strongestAttributes = [...attributes]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([attribute, value]) => `${attributeLabels[attribute] ?? attribute} ${value.toFixed(1)}`);
  const effectiveOfferType = offerState?.dealType ?? offerType;
  const listedOnMarket = Boolean(offerState?.listingId);
  const untradeableForOffer = untradeable && !listedOnMarket;
  const loanUnavailable = effectiveOfferType === 'loan'
    && selectedPlayer.loanAvailable === false
    && !listedOnMarket;
  const marketAvailable = offerState ? offerState.available : Boolean(onOffer);
  const marketBusy = submitting || offerState?.pending === true;
  const offerDisabled = ownClub
    || untradeableForOffer
    || loanUnavailable
    || !onOffer
    || !marketAvailable
    || marketBusy;
  const offerStatusLabel = ownClub
    ? 'Jogador do seu clube'
    : untradeableForOffer
      ? 'Clube sinaliza que não aceita propostas'
      : offerState?.blockedReason
        ? offerState.blockedReason
        : offerState?.loading
          ? 'Sincronizando o mercado em tempo real…'
          : offerState?.error
            ? `Mercado indisponível: ${offerState.error}`
            : !marketAvailable
              ? 'Mercado em tempo real indisponível'
              : offerState?.listingId
                ? `Anúncio ${offerState.listingMode === 'direct' ? 'direto' : 'aberto'} vinculado à proposta`
                : offerState?.syncing
                  ? 'Mercado ao vivo · atualizando dados'
                  : 'Mercado ao vivo · valores validados pelo servidor';

  function runAction(action: RankingPlayerAction) {
    let actionFeedback = '';
    if (action === 'report') {
      setReportRequested(hasScoutReportData);
      actionFeedback = hasScoutReportData
        ? 'Relatório aberto com os dados confirmados disponíveis.'
        : 'Relatório indisponível: este jogador ainda não possui atributos ou estatísticas publicados.';
    }
    if (action === 'compare') {
      const candidate = [...comparisonPool].sort((left, right) => (
        Number(right.position === selectedPlayer.position) - Number(left.position === selectedPlayer.position)
        || Math.abs((left.overall ?? left.rating) - (selectedPlayer.overall ?? selectedPlayer.rating))
          - Math.abs((right.overall ?? right.rating) - (selectedPlayer.overall ?? selectedPlayer.rating))
      ))[0] ?? null;
      setComparison(candidate);
      actionFeedback = candidate
        ? 'Comparação aberta com jogador do seu elenco.'
        : 'Nenhum jogador disponível para comparação.';
    }
    setFeedback(actionFeedback);
  }

  async function submitOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ownClub) {
      setFeedback('Jogador já pertence ao seu clube.');
      return;
    }
    if (untradeableForOffer) {
      setFeedback(`${selectedPlayer.clubName} considera ${selectedPlayer.name} inegociável.`);
      return;
    }
    if (offerState?.blockedReason) {
      setFeedback(offerState.blockedReason);
      return;
    }
    if (!marketAvailable || offerState?.loading) {
      setFeedback(offerState?.error || 'Mercado em tempo real indisponível para esta ação.');
      return;
    }
    if (loanUnavailable) {
      setFeedback(`${selectedPlayer.clubName} não aceita empréstimo por este jogador.`);
      return;
    }
    const offerAmount = Number(amount);
    const optionValue = purchaseOption.trim() ? Number(purchaseOption) : null;
    if (!Number.isFinite(offerAmount) || offerAmount <= 0) {
      setFeedback('Informe um valor de oferta maior que zero.');
      return;
    }
    if (optionValue !== null && (!Number.isFinite(optionValue) || optionValue < 0)) {
      setFeedback('Opção de compra inválida.');
      return;
    }
    if (!onOffer) {
      setFeedback('Mercado em tempo real indisponível para esta ação.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      await onOffer(selectedPlayer, effectiveOfferType, offerAmount, effectiveOfferType === 'loan' ? optionValue : null);
      setFeedback(`Oferta de ${effectiveOfferType === 'loan' ? 'empréstimo' : 'transferência'} enviada.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível enviar a oferta.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={player.name} eyebrow={`${player.clubName} · ${player.position}`} size="lg">
      <article className="rankings-player-profile">
        <header className="rankings-player-profile__hero">
          <span className="rankings-player-profile__avatar">
            <ResilientImage
              src={player.avatarImageUrl}
              alt={`Foto de ${player.name}`}
              fallback={<span><UserRound size={28} /><strong>{initials(player.name)}</strong></span>}
            />
          </span>
          <div className="rankings-player-profile__identity">
            <span><Badge tone="info">{player.position}</Badge>{player.isStar && <Badge tone="danger"><Star size={11} fill="currentColor" /> Estrela</Badge>}{ownClub && <Badge tone="positive">Seu clube</Badge>}{untradeable && <Badge tone="warning">Inegociável</Badge>}</span>
            <h3>{player.name}</h3>
            <p>{player.nationality || 'Nacionalidade indisponível'}{player.age ? ` · ${player.age} anos` : ''}</p>
          </div>
          <dl className="rankings-player-profile__headline">
            <div><dt>OVERALL</dt><dd>{displayNumber(player.overall)}</dd></div>
            <div><dt>POTENCIAL</dt><dd>{displayNumber(player.potential)}</dd></div>
            <div><dt>VALOR</dt><dd>{marketValue === null ? 'Indisponível' : formatCurrency(marketValue)}</dd></div>
          </dl>
        </header>

        <nav className="rankings-player-profile__tabs" role="tablist" aria-label="Perfil do jogador">
          {playerTabs.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab} key={tab} onClick={() => setActiveTab(tab)}>{playerTabLabels[tab]}</button>)}
        </nav>

        <section className="rankings-player-profile__panel" role="tabpanel">
          {activeTab === 'summary' && (
            <dl className="rankings-player-profile__summary">
              <div><dt>Clube</dt><dd>{player.clubName}</dd></div>
              <div><dt>Posição</dt><dd>{player.position}</dd></div>
              <div><dt>Camisa</dt><dd>{displayNumber(player.shirtNumber)}</dd></div>
              <div><dt>Nota média</dt><dd>{displayNumber(player.averageRating)}</dd></div>
              <div><dt>Condição</dt><dd>{displayNumber(player.condition, '%')}</dd></div>
              <div><dt>Moral</dt><dd>{player.morale || 'Indisponível'}</dd></div>
            </dl>
          )}
          {activeTab === 'attributes' && (attributes.length
            ? <dl className="rankings-player-profile__attributes">{attributes.map(([attribute, value]) => <div key={attribute}><dt>{attributeLabels[attribute] ?? attribute}</dt><dd>{value.toFixed(1)}</dd></div>)}</dl>
            : <EmptyState icon={FileSearch} title="Atributos indisponíveis" detail="Snapshot atual de Rankings não fornece atributos deste jogador." />)}
          {activeTab === 'statistics' && (statisticsAvailable ? (
            <dl className="rankings-player-profile__statistics">
              <div><dt>Jogos</dt><dd>{player.appearances}</dd></div>
              <div><dt>Minutos</dt><dd>{displayNumber(player.minutes)}</dd></div>
              <div><dt>Gols</dt><dd>{player.goals}</dd></div>
              <div><dt>Gols sem pênalti</dt><dd>{displayNumber(player.nonPenaltyGoals)}</dd></div>
              <div><dt>Gols de pênalti</dt><dd>{displayNumber(player.penaltyGoals)}</dd></div>
              <div><dt>Assistências</dt><dd>{player.assists}</dd></div>
              <div><dt>Participações</dt><dd>{player.goals + player.assists}</dd></div>
              <div><dt>Nota média</dt><dd>{displayNumber(player.averageRating)}</dd></div>
              <div><dt>Cartões</dt><dd>{player.yellowCards === null || player.yellowCards === undefined ? 'Indisponível' : `${player.yellowCards} A · ${player.redCards ?? 0} V`}</dd></div>
            </dl>
          ) : <EmptyState
            icon={BarChart3}
            title="Estatísticas indisponíveis"
            detail={player.statisticsScope === 'unavailable'
              ? 'Este save não separa os números do jogador por competição. Valores zerados foram ocultados para não exibir dados falsos.'
              : 'A competição selecionada ainda não possui estatísticas confirmadas deste jogador.'}
          />)}
          {activeTab === 'contract' && (contract || contractWage !== null
            ? <dl className="rankings-player-profile__contract">
                <div><dt>Salário</dt><dd>{contractWage === null ? 'Indisponível' : formatCurrency(contractWage, false)}</dd></div>
                <div><dt>Início</dt><dd>{displayNumber(contract?.startSeason)}</dd></div>
                <div><dt>Fim</dt><dd>{displayNumber(contract?.endSeason)}</dd></div>
                <div><dt>Status</dt><dd>{contract?.status || player.status || 'Indisponível'}</dd></div>
              </dl>
            : <EmptyState icon={FileSearch} title="Contrato indisponível" detail="Nenhuma informação contratual foi publicada no snapshot." />)}
        </section>

        <section className="rankings-player-profile__actions" aria-label="Ações do jogador">
          <h4>Ações</h4>
          <div>
            <Button size="sm" variant="ghost" disabled title="Lista de observação ainda não possui persistência no servidor" icon={<ListPlus size={14} />}>Observação indisponível</Button>
            <Button size="sm" variant={reportRequested ? 'primary' : 'ghost'} aria-pressed={reportRequested} icon={<Binoculars size={14} />} onClick={() => runAction('report')}>{reportRequested ? 'Relatório aberto' : 'Abrir relatório'}</Button>
            <Button size="sm" variant="ghost" icon={<Scale size={14} />} onClick={() => runAction('compare')}>Comparar</Button>
            <Button size="sm" variant="ghost" disabled title="Registro de interesse ainda não possui persistência no servidor" icon={<HeartHandshake size={14} />}>Interesse indisponível</Button>
            <Button size="sm" variant="ghost" disabled title="Contato com jogador ainda não possui integração no servidor" icon={<Contact size={14} />}>Contato indisponível</Button>
          </div>
        </section>

        {reportRequested && <section className="rankings-player-profile__comparison" aria-label="Relatório do jogador">
          <h4><Binoculars size={14} /> Relatório disponível</h4>
          <dl className="rankings-player-profile__summary">
            <div><dt>Desempenho</dt><dd>{statisticsAvailable
              ? `${player.appearances} jogos · ${player.goals} gols · ${player.assists} assist.`
              : 'Estatísticas da competição indisponíveis'}</dd></div>
            <div><dt>Nível atual</dt><dd>{displayNumber(player.overall ?? player.rating)}</dd></div>
            <div><dt>Pontos fortes visíveis</dt><dd>{strongestAttributes.length ? strongestAttributes.join(' · ') : 'Atributos detalhados indisponíveis'}</dd></div>
          </dl>
          <p>Leitura baseada somente no snapshot atual. Informações não publicadas pelo save não são estimadas.</p>
        </section>}

        {comparison && <section className="rankings-player-profile__comparison"><h4><Scale size={14} /> Comparação</h4><div><span><strong>{player.name}</strong><small>{displayNumber(player.overall ?? player.rating)}</small></span><b>×</b><span><strong>{comparison.name}</strong><small>{displayNumber(comparison.overall ?? comparison.rating)}</small></span></div></section>}

        {additionalContent}

        <form className="rankings-player-profile__offer" onSubmit={(event) => void submitOffer(event)}>
          <header><BadgeDollarSign size={16} /><span><strong>Enviar proposta</strong><small>{offerStatusLabel}</small></span></header>
          <label><span>Tipo</span><select value={effectiveOfferType} disabled={offerDisabled || Boolean(offerState?.dealType)} onChange={(event) => setOfferType(event.target.value as RankingOfferType)}><option value="transfer">Transferência</option><option value="loan">Empréstimo</option></select></label>
          <label><span>Valor</span><input type="number" min="1" step="1000" value={amount} disabled={offerDisabled} onChange={(event) => setAmount(event.target.value)} /></label>
          {effectiveOfferType === 'loan' && <label><span>Opção de compra</span><input type="number" min="0" step="1000" value={purchaseOption} disabled={offerDisabled || loanUnavailable} onChange={(event) => setPurchaseOption(event.target.value)} placeholder="Opcional" /></label>}
          <Button type="submit" variant="primary" size="sm" loading={marketBusy} disabled={offerDisabled} icon={effectiveOfferType === 'loan' ? <HandCoins size={14} /> : <BadgeDollarSign size={14} />}>{offerState?.blockedReason ? 'Oferta indisponível' : marketAvailable ? 'Enviar oferta' : 'Mercado indisponível'}</Button>
        </form>
        {feedback && <p className="rankings-player-profile__feedback" role="status"><MessageCircle size={14} /> {feedback}</p>}
      </article>
    </Modal>
  );
}

function managerHistory(room: Room | null | undefined, managerId: string) {
  return (room?.seasonHistory ?? []).flatMap((item, index) => {
    const source = record(item);
    if (!source) return [];
    const managers = list(source.managerRankings ?? source.managers);
    const manager = managers.map(record).find((candidate) => key(candidate?.id ?? candidate?.managerId) === key(managerId));
    if (!manager) return [];
    return [{
      id: `${managerId}-${source.seasonNumber ?? index}`,
      season: integer(source.seasonNumber) ?? index + 1,
      position: integer(manager.position),
      points: integer(manager.points),
      played: integer(manager.played),
    }];
  });
}

export function RankingManagerProfile({
  manager,
  comparisonManager = null,
  room = null,
  historyEntries = [],
  currentManagerId = null,
  historicalSeasonNumber = null,
  historicalSeasonYear = null,
  historicalCompetitionName = null,
  onClose,
}: RankingManagerProfileProps) {
  const [activeTab, setActiveTab] = useState<RankingManagerProfileTab>('summary');

  useEffect(() => {
    setActiveTab('summary');
  }, [manager?.id]);

  if (!manager) return null;
  const isCurrent = manager.isViewer || sameClub(manager.id, currentManagerId);
  const performance = manager.played > 0 ? manager.performancePercent : null;
  const preview = room?.tacticPreviews?.find((candidate) => candidate.managerId === manager.id);
  const lineup = room?.lineups?.find((candidate) => candidate.managerId === manager.id);
  const formation = manager.preferredFormation ?? preview?.formationId ?? (isCurrent ? lineup?.tactics?.formationId : null) ?? null;
  const snapshotHistory = historyEntries.filter((entry) => sameClub(entry.managerId, manager.id));
  const history = managerHistory(room, manager.id);
  const seasonStats = aggregateRankingManagerSeasonStats(manager.seasonStats);
  const profileType = isCurrent ? 'Você' : manager.managerType === 'ai' ? 'IA' : 'Jogador';
  const status = manager.status === 'employed' ? 'Empregado' : manager.status === 'unemployed' ? 'Sem clube' : manager.status === 'dismissed' ? 'Demitido' : '—';
  const historicalPeriod = historicalSeasonNumber !== null || historicalSeasonYear !== null;
  const historicalSeasonLabel = historicalSeasonYear ?? historicalSeasonNumber;
  const campaignLabel = historicalPeriod
    ? `Campanha da temporada ${historicalSeasonLabel ?? 'selecionada'}`
    : 'Campanha atual';
  const matchHistory = manager.matchHistory.length ? manager.matchHistory : manager.recentResults;
  const careerPlayed = manager.careerHistory.reduce((total, entry) => total + entry.played, 0);
  const careerWins = manager.careerHistory.reduce((total, entry) => total + entry.wins, 0);
  const careerDraws = manager.careerHistory.reduce((total, entry) => total + entry.draws, 0);
  const careerLosses = manager.careerHistory.reduce((total, entry) => total + entry.losses, 0);
  const careerGoalsFor = manager.careerHistory.reduce((total, entry) => total + (entry.goalsFor ?? 0), 0);
  const careerGoalsAgainst = manager.careerHistory.reduce((total, entry) => total + (entry.goalsAgainst ?? 0), 0);
  const careerPoints = manager.careerHistory.reduce((total, entry) => total + entry.points, 0);
  const careerPromotions = manager.careerHistory.reduce((total, entry) => total + (entry.promotions ?? 0), 0);
  const careerRelegations = manager.careerHistory.reduce((total, entry) => total + (entry.relegations ?? 0), 0);
  const careerTitles = manager.titles ?? manager.careerHistory.reduce((total, entry) => total + entry.titles, 0);
  const careerDuration = manager.careerHistory.reduce((total, entry) => (
    total + (entry.durationDays ?? periodDurationDays(entry.startedAt, entry.endedAt) ?? 0)
  ), 0);
  const careerClubCount = new Set(manager.careerHistory.map((entry) => entry.clubId).filter(Boolean)).size;
  const careerCountryCount = new Set(manager.careerHistory.map((entry) => entry.country).filter(Boolean)).size;
  const careerPpg = careerPlayed > 0 ? careerPoints / careerPlayed : null;
  const careerWinRate = careerPlayed > 0 ? careerWins / careerPlayed * 100 : null;
  const achievements = [...manager.trophyHistory, ...manager.awards].filter((achievement, index, all) => (
    all.findIndex((candidate) => candidate.id === achievement.id && candidate.label === achievement.label) === index
  ));
  const comparisonMetrics = comparisonManager ? [
    ['Aproveitamento', performance === null ? '—' : `${performance.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`, comparisonManager.played ? `${comparisonManager.performancePercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'],
    ['Vitórias', String(manager.wins), String(comparisonManager.wins)],
    ['Títulos', displayNumber(manager.titles), displayNumber(comparisonManager.titles)],
    ['Pontos do ranking', displayNumber(manager.rankingPoints), displayNumber(comparisonManager.rankingPoints)],
    ['Reputação', displayNumber(manager.reputation), displayNumber(comparisonManager.reputation)],
  ] : [];

  return (
    <Modal open onClose={onClose} title={manager.name} eyebrow={historicalPeriod ? `Perfil histórico${historicalCompetitionName ? ` · ${historicalCompetitionName}` : ''}` : isCurrent ? 'Seu treinador' : 'Perfil do treinador'} size="lg">
      <article className="rankings-manager-profile">
        <header className="rankings-manager-profile__hero">
          <span className="rankings-manager-profile__avatar"><ResilientImage src={manager.avatarImageUrl} alt={`Foto de ${manager.name}`} fallback={<span>{initials(manager.name)}</span>} /></span>
          <div><span><Badge tone={manager.managerType === 'ai' ? 'info' : 'positive'}>{profileType}</Badge>{manager.isOwner && <Badge tone="warning">Criador da sala</Badge>}</span><h3>{manager.name}</h3><p>{manager.clubName || 'Sem clube registrado'}</p></div>
          {manager.clubCode && <ClubMark code={manager.clubCode} color={manager.clubColor ?? '#777777'} darkThemeColor={manager.clubDarkThemeColor} lightThemeColor={manager.clubLightThemeColor} imageUrl={manager.clubCrestImageUrl} size="lg" />}
        </header>

        <nav className="rankings-manager-profile__tabs" role="tablist" aria-label="Seções do perfil público do treinador">
          {managerProfileTabs.map((tab) => {
            const Icon = tab.icon;
            return <button key={tab.id} id={`manager-profile-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`manager-profile-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleManagerProfileTabKey(event, activeTab, setActiveTab)}><Icon size={14} />{tab.label}</button>;
          })}
        </nav>

        <div id={`manager-profile-panel-${activeTab}`} className="rankings-manager-profile__panel" role="tabpanel" aria-labelledby={`manager-profile-tab-${activeTab}`}>
          {activeTab === 'summary' && <div className="rankings-manager-profile__summary-tab">
            <section className="rankings-manager-profile__identity">
              <h4><UserRound size={15} /> Informações públicas</h4>
              <dl>
                <div><dt>Tipo</dt><dd>{profileType}</dd></div>
                <div><dt>Nacionalidade</dt><dd>{manager.nationality || '—'}</dd></div>
                <div><dt>Situação</dt><dd>{status}</dd></div>
                <div><dt>Estilo de jogo</dt><dd>{manager.style || '—'}</dd></div>
                <div><dt>Formação preferida</dt><dd>{formation || '—'}</dd></div>
                <div><dt>{historicalPeriod ? 'Clube no período' : 'Clube atual'}</dt><dd>{manager.clubName || 'Sem clube'}</dd></div>
              </dl>
            </section>
            <section className="rankings-manager-profile__campaign">
              <h4>{campaignLabel}</h4>
              <dl>
                <div><dt>Posição</dt><dd>{manager.position || '—'}</dd></div>
                <div><dt>Jogos</dt><dd>{manager.played}</dd></div>
                <div><dt>Vitórias</dt><dd>{manager.wins}</dd></div>
                <div><dt>Empates</dt><dd>{manager.draws}</dd></div>
                <div><dt>Derrotas</dt><dd>{manager.losses}</dd></div>
                <div><dt>Gols marcados</dt><dd>{manager.goalsFor}</dd></div>
                <div><dt>Gols sofridos</dt><dd>{manager.goalsAgainst}</dd></div>
                <div><dt>Saldo</dt><dd>{manager.goalDifference > 0 ? `+${manager.goalDifference}` : manager.goalDifference}</dd></div>
                <div><dt>Pontos</dt><dd>{manager.points}</dd></div>
                <div><dt>Aproveitamento</dt><dd>{publicPercent(performance)}</dd></div>
                <div><dt>Reputação</dt><dd>{publicMetric(manager.reputation, 1)}</dd></div>
                <div><dt>Títulos</dt><dd>{publicMetric(careerTitles)}</dd></div>
              </dl>
            </section>
            <section className="rankings-manager-profile__career-overview" aria-label="Resumo da carreira">
              <article><small>Clubes</small><strong>{manager.careerHistory.length ? careerClubCount || 1 : '—'}</strong></article>
              <article><small>Países</small><strong>{manager.careerHistory.length ? careerCountryCount || '—' : '—'}</strong></article>
              <article><small>Tempo de carreira</small><strong>{manager.careerHistory.length ? publicDuration(careerDuration) : '—'}</strong></article>
              <article><small>Jogos</small><strong>{manager.careerHistory.length ? publicMetric(careerPlayed) : publicMetric(manager.played)}</strong></article>
              <article><small>Aproveitamento</small><strong>{manager.careerHistory.length ? publicPercent(careerWinRate) : publicPercent(performance)}</strong></article>
              <article><small>Pontos por jogo</small><strong>{manager.careerHistory.length ? publicMetric(careerPpg, 2) : manager.played ? publicMetric(manager.points / manager.played, 2) : '—'}</strong></article>
              <article><small>Promoções</small><strong>{manager.careerHistory.length ? publicMetric(careerPromotions) : '—'}</strong></article>
              <article><small>Rebaixamentos</small><strong>{manager.careerHistory.length ? publicMetric(careerRelegations) : '—'}</strong></article>
            </section>
          </div>}

          {activeTab === 'career' && <section className="rankings-manager-profile__career">
            <h4><History size={15} /> Clubes e passagens</h4>
            {manager.careerHistory.length ? <ol>
              {[...manager.careerHistory].sort((left, right) => (right.startedAt ?? '').localeCompare(left.startedAt ?? '')).map((entry, index, all) => {
                const ppg = entry.pointsPerGame ?? (entry.played ? entry.points / entry.played : null);
                const winRate = entry.winRate ?? (entry.played ? entry.wins / entry.played * 100 : null);
                const goalDifference = (entry.goalsFor ?? 0) - (entry.goalsAgainst ?? 0);
                return <li key={entry.id}>
                  <span className="rankings-manager-profile__career-rail" aria-hidden="true"><b>{index + 1}</b>{index < all.length - 1 && <i />}</span>
                  <article>
                    <header>
                      <div><p className="eyebrow">{entry.role || 'Treinador principal'}</p><h5>{entry.clubName || 'Clube não informado'}</h5><p>{[entry.country, entry.division].filter(Boolean).join(' · ') || 'País e divisão não informados'}</p></div>
                      <Badge tone={entry.endedAt ? 'neutral' : 'positive'}>{entry.endedAt ? publicCareerStatus(entry.status) : 'Atual'}</Badge>
                    </header>
                    <div className="rankings-manager-profile__career-period"><span>{entry.startedAt ? displayDate(entry.startedAt) : '—'} — {entry.endedAt ? displayDate(entry.endedAt) : 'presente'}</span><strong>{publicDuration(entry.durationDays, entry.startedAt, entry.endedAt)}</strong></div>
                    <dl>
                      <div><dt>Jogos</dt><dd>{publicMetric(entry.played)}</dd></div>
                      <div><dt>V-E-D</dt><dd>{entry.wins}-{entry.draws}-{entry.losses}</dd></div>
                      <div><dt>GP / GC / SG</dt><dd>{publicMetric(entry.goalsFor)} / {publicMetric(entry.goalsAgainst)} / {goalDifference > 0 ? '+' : ''}{publicMetric(goalDifference)}</dd></div>
                      <div><dt>PPG</dt><dd>{publicMetric(ppg, 2)}</dd></div>
                      <div><dt>Aproveitamento</dt><dd>{publicPercent(winRate)}</dd></div>
                      <div><dt>Sequência de vitórias</dt><dd>{publicMetric(entry.longestWinningStreak)}</dd></div>
                      <div><dt>Sequência sem vencer</dt><dd>{publicMetric(entry.longestWinlessStreak)}</dd></div>
                      <div><dt>Títulos</dt><dd>{publicMetric(entry.titles)}</dd></div>
                      <div><dt>Promoções</dt><dd>{publicMetric(entry.promotions)}</dd></div>
                      <div><dt>Rebaixamentos</dt><dd>{publicMetric(entry.relegations)}</dd></div>
                      <div><dt>Reputação inicial</dt><dd>{publicMetric(entry.reputationStart, 1)}</dd></div>
                      <div><dt>Reputação final</dt><dd>{publicMetric(entry.reputationEnd, 1)}</dd></div>
                    </dl>
                    {(entry.entryReason || entry.exitReason) && <footer>{entry.entryReason && <p><strong>Entrada:</strong> {entry.entryReason}</p>}{entry.exitReason && <p><strong>Saída:</strong> {entry.exitReason}</p>}</footer>}
                  </article>
                </li>;
              })}
            </ol> : snapshotHistory.length ? <div className="rankings-manager-profile__history">{snapshotHistory.map((entry) => <article key={entry.id}><strong>{entry.label || `Temporada ${entry.seasonNumber ?? '—'}`}</strong><span>{entry.position ? `${entry.position}º lugar` : 'Posição indisponível'}{entry.value !== null ? ` · ${entry.value.toLocaleString('pt-BR')} pontos de ranking` : ''}{entry.round ? ` · rodada ${entry.round}` : ''}</span></article>)}</div> : history.length ? <div className="rankings-manager-profile__history">{history.map((entry) => <article key={entry.id}><strong>Temporada {entry.season}</strong><span>{entry.position ? `${entry.position}º lugar` : 'Posição indisponível'} · {entry.points ?? '—'} pts · {entry.played ?? '—'} jogos</span></article>)}</div> : <EmptyState icon={History} title="Histórico indisponível" detail="O save ainda não preserva campanhas anteriores deste treinador." />}
          </section>}

          {activeTab === 'statistics' && <div className="rankings-manager-profile__statistics-tab">
            <section className="rankings-manager-profile__career-overview" aria-label="Estatísticas totais da carreira">
              <article><small>Jogos</small><strong>{manager.careerHistory.length ? publicMetric(careerPlayed) : publicMetric(manager.played)}</strong></article>
              <article><small>Vitórias</small><strong>{manager.careerHistory.length ? publicMetric(careerWins) : publicMetric(manager.wins)}</strong></article>
              <article><small>Empates</small><strong>{manager.careerHistory.length ? publicMetric(careerDraws) : publicMetric(manager.draws)}</strong></article>
              <article><small>Derrotas</small><strong>{manager.careerHistory.length ? publicMetric(careerLosses) : publicMetric(manager.losses)}</strong></article>
              <article><small>Gols marcados</small><strong>{manager.careerHistory.length ? publicMetric(careerGoalsFor) : publicMetric(manager.goalsFor)}</strong></article>
              <article><small>Gols sofridos</small><strong>{manager.careerHistory.length ? publicMetric(careerGoalsAgainst) : publicMetric(manager.goalsAgainst)}</strong></article>
              <article><small>Saldo</small><strong>{manager.careerHistory.length ? `${careerGoalsFor - careerGoalsAgainst > 0 ? '+' : ''}${publicMetric(careerGoalsFor - careerGoalsAgainst)}` : `${manager.goalDifference > 0 ? '+' : ''}${publicMetric(manager.goalDifference)}`}</strong></article>
              <article><small>Pontos por jogo</small><strong>{manager.careerHistory.length ? publicMetric(careerPpg, 2) : manager.played ? publicMetric(manager.points / manager.played, 2) : '—'}</strong></article>
            </section>
            <section className="rankings-manager-profile__seasons">
              <h4><CalendarDays size={15} /> Estatísticas por temporada</h4>
              {seasonStats.length ? <div>
                <table>
                  <thead><tr><th>Temporada</th><th>Competição</th><th>Clube(s)</th><th>J</th><th>V/E/D</th><th>Gols</th><th>Pts</th><th>Aprov.</th><th>Ranking</th><th>Pos.</th></tr></thead>
                  <tbody>{seasonStats.map((entry) => <tr key={entry.id}>
                    <td>{entry.seasonYear ?? entry.seasonNumber ?? '—'}</td>
                    <td>{entry.competitionName || entry.competitionId || '—'}</td>
                    <td>{entry.clubName || '—'}</td>
                    <td>{entry.played}</td>
                    <td>{entry.wins}/{entry.draws}/{entry.losses}</td>
                    <td>{entry.goalsFor}–{entry.goalsAgainst}</td>
                    <td>{entry.points}</td>
                    <td>{entry.played ? publicPercent(entry.performancePercent) : '—'}</td>
                    <td>{publicMetric(entry.rankingPoints)}</td>
                    <td>{entry.position === null ? '—' : `${entry.position}º`}</td>
                  </tr>)}</tbody>
                </table>
              </div> : <EmptyState icon={CalendarDays} title="Estatísticas indisponíveis" detail="O save ainda não preserva campanhas separadas por temporada para este treinador." />}
            </section>
            <section className="rankings-manager-profile__recent">
              <h4><BarChart3 size={15} /> Partidas registradas</h4>
              {matchHistory.length ? <div>{matchHistory.slice(0, 20).map((result) => <article key={result.id}><span className={`is-${result.result === 'W' ? 'win' : result.result === 'D' ? 'draw' : 'loss'}`}>{result.result === 'W' ? 'V' : result.result === 'D' ? 'E' : 'D'}</span><strong>{result.goalsFor}–{result.goalsAgainst}</strong><p>{result.opponentName || 'Adversário não informado'}<small>{result.competitionName || 'Competição não informada'}{result.playedAt ? ` · ${displayDate(result.playedAt)}` : ''}</small></p></article>)}</div> : <EmptyState icon={BarChart3} title="Partidas indisponíveis" detail="O save não preservou partidas deste treinador." />}
            </section>
          </div>}

          {activeTab === 'achievements' && <div className="rankings-manager-profile__achievements-tab">
            <section className="rankings-manager-profile__career-overview" aria-label="Resumo de conquistas">
              <article><small>Títulos</small><strong>{publicMetric(careerTitles)}</strong></article>
              <article><small>Prêmios</small><strong>{publicMetric(manager.awards.length)}</strong></article>
              <article><small>Promoções</small><strong>{manager.careerHistory.length ? publicMetric(careerPromotions) : '—'}</strong></article>
              <article><small>Rebaixamentos</small><strong>{manager.careerHistory.length ? publicMetric(careerRelegations) : '—'}</strong></article>
            </section>
            <section className="rankings-manager-profile__achievements">
              <h4><Trophy size={15} /> Títulos e premiações</h4>
              {achievements.length ? <div>{achievements.map((achievement) => <article key={`${achievement.id}:${achievement.label}`}><Trophy size={14} /><span><strong>{achievement.label}</strong><small>{achievement.competitionName || 'Carreira'}{achievement.seasonYear ? ` · ${achievement.seasonYear}` : achievement.seasonNumber ? ` · temporada ${achievement.seasonNumber}` : ''}{achievement.awardedAt ? ` · ${displayDate(achievement.awardedAt)}` : ''}</small></span></article>)}</div> : <EmptyState icon={Trophy} title="Nenhum título registrado" detail="Nenhum título ou prêmio foi preservado para este treinador." />}
            </section>
            {(careerPromotions > 0 || careerRelegations > 0) && <section className="rankings-manager-profile__milestones">
              <h4><Star size={15} /> Marcos de carreira</h4>
              <div>{manager.careerHistory.filter((entry) => (entry.promotions ?? 0) > 0 || (entry.relegations ?? 0) > 0).map((entry) => <article key={`${entry.id}:milestones`}><strong>{entry.clubName || 'Clube não informado'}</strong><span>{(entry.promotions ?? 0) > 0 ? `${entry.promotions} promoção(ões)` : ''}{(entry.promotions ?? 0) > 0 && (entry.relegations ?? 0) > 0 ? ' · ' : ''}{(entry.relegations ?? 0) > 0 ? `${entry.relegations} rebaixamento(s)` : ''}</span></article>)}</div>
            </section>}
          </div>}

          {activeTab === 'reputation' && <div className="rankings-manager-profile__reputation-tab">
            <section className="rankings-manager-profile__reputation-summary">
              <article><small>Reputação atual</small><strong>{publicMetric(manager.reputation, 1)}</strong></article>
              <article><small>Pontos no ranking</small><strong>{publicMetric(manager.rankingPoints)}</strong></article>
              <article><small>Posição atual</small><strong>{manager.position ? `${manager.position}º` : '—'}</strong></article>
              <article><small>Variação</small><strong>{manager.positionChange === null ? '—' : manager.positionChange > 0 ? `+${manager.positionChange}` : publicMetric(manager.positionChange)}</strong></article>
            </section>
            <section className="rankings-manager-profile__reputation-history">
              <h4><TrendingUp size={15} /> Reputação por passagem</h4>
              {manager.careerHistory.some((entry) => entry.reputationStart !== null || entry.reputationEnd !== null) ? <div>{manager.careerHistory.map((entry) => {
                const delta = entry.reputationStart !== null && entry.reputationStart !== undefined && entry.reputationEnd !== null && entry.reputationEnd !== undefined
                  ? entry.reputationEnd - entry.reputationStart
                  : null;
                return <article key={`${entry.id}:reputation`}><div><strong>{entry.clubName || 'Clube não informado'}</strong><small>Temporada {entry.seasonYear ?? entry.seasonNumber ?? '—'}</small></div><span>{publicMetric(entry.reputationStart, 1)}</span><i aria-hidden="true">→</i><span>{publicMetric(entry.reputationEnd, 1)}</span><Badge tone={delta !== null && delta > 0 ? 'positive' : delta !== null && delta < 0 ? 'danger' : 'neutral'}>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${publicMetric(delta, 1)}`}</Badge></article>;
              })}</div> : <EmptyState icon={TrendingUp} title="Reputação histórica indisponível" detail="O save ainda não preserva a reputação no início e no fim de cada passagem." />}
            </section>
            <section className="rankings-manager-profile__trajectory">
              <h4><Activity size={15} /> Trajetória no ranking</h4>
              {manager.rankingTrajectory.length ? <div>{manager.rankingTrajectory.map((entry) => <article key={entry.id}><span>{entry.round ? `R${entry.round}` : entry.seasonNumber ? `T${entry.seasonNumber}` : 'Registro'}</span><strong>{entry.position ? `${entry.position}º` : '—'}</strong><small>{entry.positionChange === null ? 'Sem comparação' : entry.positionChange > 0 ? `Subiu ${entry.positionChange}` : entry.positionChange < 0 ? `Caiu ${Math.abs(entry.positionChange)}` : 'Manteve posição'}</small></article>)}</div> : <EmptyState icon={Activity} title="Trajetória indisponível" detail="Ainda não há snapshots de posição para este treinador." />}
            </section>
          </div>}
        </div>

        {comparisonManager && comparisonManager.id !== manager.id && <section className="rankings-manager-profile__comparison">
          <h4><Scale size={15} /> Comparação com {comparisonManager.isViewer ? 'você' : comparisonManager.name}</h4>
          <header><strong>{manager.name}</strong><span>×</span><strong>{comparisonManager.name}</strong></header>
          <dl>{comparisonMetrics.map(([label, left, right]) => <div key={label}><dd>{left}</dd><dt>{label}</dt><dd>{right}</dd></div>)}</dl>
        </section>}
      </article>
    </Modal>
  );
}

function clubCatalogEntry(room: Room | null, club: RankingClub) {
  const aliases = new Set([club.id, club.code, club.name].map(key).filter(Boolean));
  for (const league of room?.competitionCatalog ?? []) {
    const candidate = league.clubs.find((item) => aliases.has(key(item.id)) || aliases.has(key(item.code)) || aliases.has(key(item.name)));
    if (candidate) return { club: candidate, league };
  }
  return null;
}

function clubMatches(room: Room | null, club: RankingClub, competitionId?: string | null): CompetitionClubMatch[] {
  try {
    return buildCompetitionClubMatches(room, club.id, competitionId);
  } catch {
    return [];
  }
}

function aggregateClubMatches(matches: CompetitionClubMatch[], club: RankingClub) {
  const completed = matches.filter((match) => match.completed && match.score);
  return completed.reduce((summary, match) => {
    const home = sameClub(match.homeClubId, club.id) || sameClub(match.homeCode, club.code) || sameClub(match.homeName, club.name);
    const scored = match.score?.[home ? 0 : 1] ?? 0;
    const conceded = match.score?.[home ? 1 : 0] ?? 0;
    summary.played += 1;
    summary.goalsFor += scored;
    summary.goalsAgainst += conceded;
    if (scored > conceded) summary.wins += 1;
    else if (scored === conceded) summary.draws += 1;
    else summary.losses += 1;
    return summary;
  }, { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 });
}

function ClubMatchList({ matches }: { matches: CompetitionClubMatch[] }) {
  if (!matches.length) return <EmptyState icon={CalendarDays} title="Nenhuma partida" detail="Não há partidas registradas neste escopo." />;
  return <div className="rankings-club-matches">{matches.map((match) => <article key={match.id}><span><small>R{match.round || '—'}</small><strong>{match.homeName} {match.score ? `${match.score[0]}–${match.score[1]}` : '×'} {match.awayName}</strong></span><time>{displayDate(match.scheduledAt)}</time></article>)}</div>;
}

function clubHistory(room: Room | null, club: RankingClub) {
  const aliases = new Set([club.id, club.code, club.name].map(key).filter(Boolean));
  return (room?.seasonHistory ?? []).flatMap((item, index) => {
    const source = record(item);
    if (!source) return [];
    const events: string[] = [];
    for (const winnerValue of list(source.tournamentWinners)) {
      const winner = record(winnerValue);
      if (winner && aliases.has(key(winner.clubId))) events.push(`Campeão de ${text(winner.tournamentName ?? winner.tournamentId) ?? 'torneio registrado'}`);
    }
    for (const movementValue of list(source.promotionMovements)) {
      const movement = record(movementValue);
      if (!movement || !aliases.has(key(movement.clubId ?? movement.id))) continue;
      const label = text(movement.label ?? movement.type ?? movement.direction);
      events.push(label ? `Movimento de divisão: ${label}` : 'Movimento de divisão registrado');
    }
    if (!events.length) return [];
    return [{ id: `${club.id}-${source.seasonNumber ?? index}`, season: integer(source.seasonNumber) ?? index + 1, completedAt: text(source.completedAt), events }];
  });
}

export function RankingClubDetail({
  club,
  players,
  room,
  competitionId = null,
  competitionName = null,
  historyEntries = [],
  activeTab: controlledTab,
  onTabChange,
  onPlayerSelect,
  onBack,
}: RankingClubDetailProps) {
  const [internalTab, setInternalTab] = useState<RankingClubTab>('overview');
  const activeTab = controlledTab ?? internalTab;

  useEffect(() => {
    if (club) setInternalTab('overview');
  }, [club?.id]);

  const matches = useMemo(() => club ? clubMatches(room, club, competitionId) : [], [club, competitionId, room]);
  if (!club) return null;

  const catalog = clubCatalogEntry(room, club);
  const aliases = new Set([club.id, club.code, club.name].map(key).filter(Boolean));
  const squad = players.filter((player) => aliases.has(key(player.clubId)) || aliases.has(key(player.clubCode)) || aliases.has(key(player.clubName)));
  const standing = room && catalog
    ? buildSeasonTable(room, catalog.league.id).find((candidate) => aliases.has(key(candidate.clubId)) || aliases.has(key(candidate.code)) || aliases.has(key(candidate.name))) ?? null
    : null;
  const completed = matches.filter((match) => match.completed).sort((left, right) => (right.round - left.round)).slice(0, 5);
  const upcoming = matches.filter((match) => !match.completed).sort((left, right) => (left.round - right.round)).slice(0, 5);
  const matchStats = aggregateClubMatches(matches, club);
  const publishedStats = club.played > 0 ? {
    played: club.played,
    wins: club.wins,
    draws: club.draws,
    losses: club.losses,
    goalsFor: club.goalsFor,
    goalsAgainst: club.goalsAgainst,
    goalDifference: club.goalDifference,
    points: club.points,
  } : {
    ...matchStats,
    goalDifference: matchStats.goalsFor - matchStats.goalsAgainst,
    points: matchStats.wins * 3 + matchStats.draws,
  };
  const controllingManager = room?.managers.find((manager) => aliases.has(key(manager.clubId)));
  const tacticPreview = room?.tacticPreviews?.find((preview) => preview.managerId === controllingManager?.id);
  const tactic = tacticPreview ?? null;
  const wages = squad.map((player) => number(player.wage ?? player.contract?.wage)).filter((value): value is number => value !== null);
  const history = clubHistory(room, club);
  const snapshotHistory = historyEntries.filter((entry) => sameClub(entry.clubId, club.id));
  const reputation = number(club.reputation ?? catalog?.club.reputation);
  const stadium = text(catalog?.club.stadium);
  const capacity = integer(catalog?.club.stadiumCapacity);
  const resolvedCompetitionName = competitionName || club.leagueName || catalog?.league.name || 'Competição';
  const clubPosition = club.position ?? standing?.position ?? null;

  function selectTab(tab: RankingClubTab) {
    setInternalTab(tab);
    onTabChange?.(tab);
  }

  return (
    <section className="rankings-club-detail" aria-label={`Detalhes de ${club.name}`}>
      <header className="rankings-club-detail__topbar">
        <button type="button" onClick={onBack}><ArrowLeft size={15} /> Voltar aos Rankings</button>
        <nav aria-label="Navegação estrutural"><button type="button" onClick={onBack}>Rankings</button><ChevronRight size={12} /><span>{resolvedCompetitionName}</span><ChevronRight size={12} /><strong>{club.name}</strong></nav>
      </header>

      <section className="rankings-club-detail__hero">
        <ClubMark code={club.code} color={club.color} darkThemeColor={club.darkThemeColor} lightThemeColor={club.lightThemeColor} imageUrl={club.crestImageUrl} size="xl" />
        <div><p className="eyebrow">{club.country || catalog?.league.country || 'País indisponível'} · {club.division || catalog?.league.division || 'Divisão indisponível'}</p><h1>{club.name}</h1><p>{reputation === null ? 'Reputação indisponível' : `Reputação ${reputation}`}</p></div>
        <dl><div><dt>Posição</dt><dd>{clubPosition ? `${clubPosition}º` : 'Indisponível'}</dd></div><div><dt>Elenco</dt><dd>{club.playerCount}</dd></div><div><dt>Valor</dt><dd>{formatCurrency(club.squadValue)}</dd></div></dl>
      </section>

      <nav className="rankings-club-detail__tabs" role="tablist" aria-label="Seções do clube">
        {clubTabs.map((tab) => { const Icon = tab.icon; return <button type="button" role="tab" aria-selected={activeTab === tab.id} key={tab.id} onClick={() => selectTab(tab.id)}><Icon size={14} />{tab.label}</button>; })}
      </nav>

      <div className="rankings-club-detail__panel" role="tabpanel">
        {activeTab === 'overview' && <div className="rankings-club-overview">
          <section><h2>Dados do clube</h2><dl><div><dt><Flag size={13} /> País</dt><dd>{club.country || catalog?.league.country || 'Indisponível'}</dd></div><div><dt><Trophy size={13} /> Divisão</dt><dd>{club.division || catalog?.league.division || 'Indisponível'}</dd></div><div><dt><Building2 size={13} /> Estádio</dt><dd>{stadium || 'Indisponível'}{capacity !== null ? ` · ${capacity.toLocaleString('pt-BR')}` : ''}</dd></div><div><dt><Landmark size={13} /> Valor do elenco</dt><dd>{formatCurrency(club.squadValue)}</dd></div></dl></section>
          <section><h2>Últimos resultados</h2><ClubMatchList matches={completed} /></section>
          <section><h2>Próximos jogos</h2><ClubMatchList matches={upcoming} /></section>
        </div>}

        {activeTab === 'squad' && <section className="rankings-club-squad"><header><h2>Elenco disponível</h2><Badge tone="info">{squad.length} no snapshot</Badge></header>{squad.length ? <div className="rankings-club-squad__table"><div aria-hidden="true"><span>Jogador</span><span>Pos.</span><span>Jogos</span><span>Gols</span><span>Assist.</span><span>Overall</span><span>Valor</span></div>{squad.map((player) => <button type="button" key={player.id} onClick={() => onPlayerSelect?.(player)} disabled={!onPlayerSelect}><span><ResilientImage src={player.avatarImageUrl} alt={`Foto de ${player.name}`} fallback={<i>{initials(player.name)}</i>} /><strong>{player.name}</strong></span><span>{player.position}</span><span>{player.appearances}</span><span>{player.goals}</span><span>{player.assists}</span><span>{displayNumber(player.overall)}</span><span>{rankPlayerMarketValue(player) === null ? 'Indisponível' : formatCurrency(rankPlayerMarketValue(player) ?? 0)}</span></button>)}</div> : <EmptyState icon={Shirt} title="Elenco indisponível" detail="Nenhum jogador deste clube veio no snapshot atual de Rankings." />}</section>}

        {activeTab === 'tactics' && <section className="rankings-club-tactics"><h2>Tática registrada</h2>{tactic ? <dl><div><dt>Formação</dt><dd>{'formationId' in tactic ? tactic.formationId : 'Indisponível'}</dd></div><div><dt>Mentalidade</dt><dd>{tactic.mentality}</dd></div>{tacticPreview && <div><dt>Atualização</dt><dd>{displayDate(tacticPreview.updatedAt)}</dd></div>}</dl> : <EmptyState icon={Shield} title="Tática indisponível" detail="Nenhum plano público foi registrado para este clube." />}</section>}

        {activeTab === 'calendar' && <section className="rankings-club-calendar"><header><h2>Calendário</h2><Badge tone="info">{matches.length} jogos</Badge></header><ClubMatchList matches={matches} /></section>}

        {activeTab === 'statistics' && <section className="rankings-club-statistics"><h2>Estatísticas registradas</h2>{publishedStats.played > 0 ? <dl><div><dt>Jogos</dt><dd>{publishedStats.played}</dd></div><div><dt>Vitórias</dt><dd>{publishedStats.wins}</dd></div><div><dt>Empates</dt><dd>{publishedStats.draws}</dd></div><div><dt>Derrotas</dt><dd>{publishedStats.losses}</dd></div><div><dt>Gols marcados</dt><dd>{publishedStats.goalsFor}</dd></div><div><dt>Gols sofridos</dt><dd>{publishedStats.goalsAgainst}</dd></div><div><dt>Saldo</dt><dd>{publishedStats.goalDifference}</dd></div><div><dt>Pontos</dt><dd>{publishedStats.points}</dd></div></dl> : <EmptyState icon={BarChart3} title="Estatísticas insuficientes" detail="A competição ainda não possui resultados deste clube." />}</section>}

        {activeTab === 'finances' && <section className="rankings-club-finances"><h2>Finanças publicadas</h2><dl><div><dt>Valor do elenco</dt><dd>{formatCurrency(club.squadValue)}</dd></div><div><dt>Jogadores avaliados</dt><dd>{club.playerCount}</dd></div><div><dt>Valor médio</dt><dd>{club.averagePlayerValue !== null ? formatCurrency(club.averagePlayerValue) : club.playerCount > 0 ? formatCurrency(club.squadValue / club.playerCount) : 'Indisponível'}</dd></div><div><dt>Folha salarial conhecida</dt><dd>{club.payroll !== null ? formatCurrency(club.payroll, false) : wages.length ? formatCurrency(wages.reduce((sum, wage) => sum + wage, 0), false) : 'Indisponível'}</dd></div></dl><p><WalletCards size={14} /> Saldo e orçamento não são publicados pelo snapshot atual.</p></section>}

        {activeTab === 'history' && <section className="rankings-club-history"><h2>Histórico registrado</h2>{snapshotHistory.length ? snapshotHistory.map((entry) => <article key={entry.id}><span><strong>{entry.label || `Temporada ${entry.seasonNumber ?? '—'}`}</strong><small>{entry.round ? `Rodada ${entry.round}` : entry.createdAt ? displayDate(entry.createdAt) : 'Registro preservado'}</small></span>{entry.position !== null && <p>Posição: {entry.position}º</p>}</article>) : history.length ? history.map((entry) => <article key={entry.id}><span><strong>Temporada {entry.season}</strong><small>{entry.completedAt ? displayDate(entry.completedAt) : 'Encerrada'}</small></span><ul>{entry.events.map((event) => <li key={event}>{event}</li>)}</ul></article>) : <EmptyState icon={History} title="Histórico indisponível" detail="O save não contém títulos ou movimentos anteriores identificáveis deste clube." />}</section>}
      </div>
    </section>
  );
}
