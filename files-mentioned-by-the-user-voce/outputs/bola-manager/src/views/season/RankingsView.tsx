import {
  Activity,
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Crown,
  Goal,
  History,
  Medal,
  RefreshCw,
  Scale,
  Search,
  Shield,
  Star,
  Target,
  Trophy,
  UserRound,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  RankingManagerProfile,
  type RankingProfilePlayer,
} from '../../components/rankings/RankingEntityProfiles';
import {
  enrichRankingPlayers,
  PlayerProfileHost,
} from '../../components/player/PlayerProfileHost';
import {
  RankingTable,
  type RankingColumn,
  type RankingSortDirection,
} from '../../components/rankings/RankingTable';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { ClubMark } from '../../components/shared/ClubMark';
import { Modal } from '../../components/shared/Modal';
import { ResilientImage } from '../../components/shared/ResilientImage';
import { useRankings } from '../../hooks/useRankings';
import {
  buildCompetitionClubMatches,
  type CompetitionClubIdentity,
} from '../../services/competitionClubService';
import type { BolaSocket, ClubChoice, Player, Room } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import {
  aggregateRankingManagerSeasonStats,
  filterRankingPlayers,
  localClubRanking,
  localManagerRanking,
  localPlayerRanking,
  managerInitials,
  playerRankingCategories,
  sortRankingManagers,
  sortRankingPlayersByCategory,
  type ClubRankingCategory,
  type ManagerRankingCategory,
  type PlayerRankingCategory,
  type RankingClub,
  type RankingFormResult,
  type RankingManager,
  type RankingPlayer,
  type RankingHistoryEntry,
  type RankingTimelineEntry,
  type RankingManagerPeriod,
  type RankingManagerStatus,
  type RankingManagerType,
} from '../../utils/rankings';
import { getSeasonProgress } from '../../utils/seasonProgress';
import { CompetitionClubPage, type CompetitionClubTab } from './CompetitionClubPage';

type RankingsTab = 'overview' | 'players' | 'clubs' | 'managers' | 'competitions' | 'history';
type ClubCategory = ClubRankingCategory | 'wins' | 'attack' | 'defense';
type AgeFilter = 'all' | 'u21' | '22-25' | '26-30' | '31+';
type ManagerTypeFilter = 'all' | RankingManagerType;

interface RankingsViewProps {
  players: Player[];
  club: ClubChoice;
  clubs?: ClubChoice[];
  room: Room | null;
  socket?: BolaSocket | null;
  managerId?: string;
  onRosterChanged?: () => void;
  onToast?: (message: string) => void;
}

interface PersistedRankingsState {
  tab: RankingsTab;
  playerCategory: PlayerRankingCategory;
  clubCategory: ClubCategory;
  managerCategory: ManagerRankingCategory;
  competitionId: string;
  season: string;
  historyRound: string;
  search: string;
  clubFilter: string;
  nationalityFilter: string;
  positionFilter: string;
  ageFilter: AgeFilter;
  playerPage: number;
  clubPage: number;
  managerPage: number;
  managerTypeFilter: ManagerTypeFilter;
  managerClubFilter: string;
  managerNationalityFilter: string;
  managerStatusFilter: '' | RankingManagerStatus;
  managerPeriod: RankingManagerPeriod;
  playerSort: { column: string; direction: RankingSortDirection };
  clubSort: { column: string; direction: RankingSortDirection };
  managerSort: { column: string; direction: RankingSortDirection };
  scrollY: number;
}

const tabs: Array<{ id: RankingsTab; label: string; icon: typeof Trophy }> = [
  { id: 'overview', label: 'Visão geral', icon: BarChart3 },
  { id: 'players', label: 'Jogadores', icon: Star },
  { id: 'clubs', label: 'Clubes', icon: Shield },
  { id: 'managers', label: 'Treinadores', icon: UserRound },
  { id: 'competitions', label: 'Competições', icon: Trophy },
  { id: 'history', label: 'Histórico', icon: History },
];

const clubCategories: Array<{ id: ClubCategory; label: string }> = [
  { id: 'squadValue', label: 'Valor do elenco' },
  { id: 'points', label: 'Campanha' },
  { id: 'wins', label: 'Vitórias' },
  { id: 'attack', label: 'Ataque' },
  { id: 'defense', label: 'Defesa' },
  { id: 'form', label: 'Forma recente' },
  { id: 'possession', label: 'Posse média' },
  { id: 'attendance', label: 'Público médio' },
  { id: 'payroll', label: 'Folha salarial' },
  { id: 'reputation', label: 'Reputação' },
];

const managerCategories: Array<{ id: ManagerRankingCategory; label: string }> = [
  { id: 'points', label: 'Pontos' },
  { id: 'wins', label: 'Vitórias' },
  { id: 'performance', label: 'Aproveitamento' },
  { id: 'rankingPoints', label: 'Pontos do ranking' },
  { id: 'titles', label: 'Títulos' },
  { id: 'reputation', label: 'Reputação' },
];

const PAGE_SIZE = 20;
const rankingTabIds = new Set<RankingsTab>(tabs.map((item) => item.id));
const playerCategoryIds = new Set<PlayerRankingCategory>(playerRankingCategories.map((item) => item.id));
const clubCategoryIds = new Set<ClubCategory>(clubCategories.map((item) => item.id));
const managerCategoryIds = new Set<ManagerRankingCategory>(managerCategories.map((item) => item.id));
const ageFilterIds = new Set<AgeFilter>(['all', 'u21', '22-25', '26-30', '31+']);
const managerTypeFilterIds = new Set<ManagerTypeFilter>(['all', 'human', 'ai']);
const managerStatusFilterIds = new Set<PersistedRankingsState['managerStatusFilter']>(['', 'employed', 'unemployed', 'dismissed']);
const managerPeriodIds = new Set<RankingManagerPeriod>(['current', 'last5', 'career']);

function storedString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function storedPage(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
}

function storedSort(value: unknown, fallback: PersistedRankingsState['playerSort']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const candidate = value as Partial<PersistedRankingsState['playerSort']>;
  return typeof candidate.column === 'string' && (candidate.direction === 'asc' || candidate.direction === 'desc')
    ? { column: candidate.column, direction: candidate.direction }
    : fallback;
}

function initialState(roomCode?: string | null): PersistedRankingsState {
  const fallback: PersistedRankingsState = {
    tab: 'overview',
    playerCategory: 'goals',
    clubCategory: 'squadValue',
    managerCategory: 'points',
    competitionId: '',
    season: 'current',
    historyRound: 'all',
    search: '',
    clubFilter: '',
    nationalityFilter: '',
    positionFilter: '',
    ageFilter: 'all',
    playerPage: 1,
    clubPage: 1,
    managerPage: 1,
    managerTypeFilter: 'all',
    managerClubFilter: '',
    managerNationalityFilter: '',
    managerStatusFilter: '',
    managerPeriod: 'current',
    playerSort: { column: 'goals', direction: 'desc' },
    clubSort: { column: 'squadValue', direction: 'desc' },
    managerSort: { column: 'points', direction: 'desc' },
    scrollY: 0,
  };
  if (typeof window === 'undefined' || !roomCode) return fallback;
  try {
    const raw = window.sessionStorage.getItem(`bola-manager:rankings:${roomCode}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedRankingsState>;
    const season = storedString(parsed.season, fallback.season);
    const historyRound = storedString(parsed.historyRound, fallback.historyRound);
    return {
      ...fallback,
      tab: rankingTabIds.has(parsed.tab as RankingsTab) ? parsed.tab as RankingsTab : fallback.tab,
      playerCategory: playerCategoryIds.has(parsed.playerCategory as PlayerRankingCategory) ? parsed.playerCategory as PlayerRankingCategory : fallback.playerCategory,
      clubCategory: clubCategoryIds.has(parsed.clubCategory as ClubCategory) ? parsed.clubCategory as ClubCategory : fallback.clubCategory,
      managerCategory: managerCategoryIds.has(parsed.managerCategory as ManagerRankingCategory) ? parsed.managerCategory as ManagerRankingCategory : fallback.managerCategory,
      competitionId: storedString(parsed.competitionId),
      season: season === 'current' || /^\d+$/.test(season) ? season : fallback.season,
      historyRound: historyRound === 'all' || /^[1-9]\d*$/.test(historyRound) ? historyRound : fallback.historyRound,
      search: storedString(parsed.search),
      clubFilter: storedString(parsed.clubFilter),
      nationalityFilter: storedString(parsed.nationalityFilter),
      positionFilter: storedString(parsed.positionFilter),
      ageFilter: ageFilterIds.has(parsed.ageFilter as AgeFilter) ? parsed.ageFilter as AgeFilter : fallback.ageFilter,
      playerPage: storedPage(parsed.playerPage),
      clubPage: storedPage(parsed.clubPage),
      managerPage: storedPage(parsed.managerPage),
      managerTypeFilter: managerTypeFilterIds.has(parsed.managerTypeFilter as ManagerTypeFilter) ? parsed.managerTypeFilter as ManagerTypeFilter : fallback.managerTypeFilter,
      managerClubFilter: storedString(parsed.managerClubFilter),
      managerNationalityFilter: storedString(parsed.managerNationalityFilter),
      managerStatusFilter: managerStatusFilterIds.has(parsed.managerStatusFilter as PersistedRankingsState['managerStatusFilter']) ? parsed.managerStatusFilter as PersistedRankingsState['managerStatusFilter'] : fallback.managerStatusFilter,
      managerPeriod: managerPeriodIds.has(parsed.managerPeriod as RankingManagerPeriod) ? parsed.managerPeriod as RankingManagerPeriod : fallback.managerPeriod,
      playerSort: storedSort(parsed.playerSort, fallback.playerSort),
      clubSort: storedSort(parsed.clubSort, fallback.clubSort),
      managerSort: storedSort(parsed.managerSort, fallback.managerSort),
      scrollY: Number.isFinite(Number(parsed.scrollY)) ? Math.max(0, Number(parsed.scrollY)) : 0,
    };
  } catch {
    return fallback;
  }
}

function normalizedKey(value: unknown) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function sameClub(left: unknown, right: unknown) {
  const leftKey = normalizedKey(left);
  return Boolean(leftKey && leftKey === normalizedKey(right));
}

function compactClubCode(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

function parseClubBudget(value: string | number | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : 0;
  if (!value) return 0;
  const normalized = value.toLocaleLowerCase('pt-BR').replace(/r\$|\s|\./g, '').replace(',', '.');
  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric)) return 0;
  if (/bi|bilh/.test(normalized)) return numeric * 1_000_000_000;
  if (/mi|milh/.test(normalized)) return numeric * 1_000_000;
  if (/mil/.test(normalized)) return numeric * 1_000;
  return numeric;
}

function clubReputation(value: number | null | undefined, stars: number | null | undefined) {
  const source = Number.isFinite(value)
    ? Number(value)
    : Number.isFinite(stars) ? Number(stars) * 20 : 60;
  const normalized = Number.isFinite(value) && source <= 20 ? source * 5 : source;
  return Math.max(1, Math.min(100, Math.round(normalized)));
}

function rankingClubIdentity(
  rankingClub: RankingClub,
  managerClub: ClubChoice,
  availableClubs: ClubChoice[],
  room: Room | null,
): CompetitionClubIdentity {
  const aliases = new Set([
    rankingClub.id,
    rankingClub.code,
    rankingClub.name,
  ].map(normalizedKey).filter(Boolean));
  const matches = (...values: Array<string | null | undefined>) => values
    .map(normalizedKey)
    .some((value) => Boolean(value && aliases.has(value)));
  const fullClub = [managerClub, ...availableClubs]
    .find((candidate) => matches(candidate.id, candidate.code, candidate.name));
  const catalogLeague = room?.competitionCatalog?.find((league) => (
    league.clubs.some((candidate) => matches(candidate.id, candidate.code, candidate.name))
  ));
  const catalogClub = catalogLeague?.clubs
    .find((candidate) => matches(candidate.id, candidate.code, candidate.name));
  const tournamentParticipant = room?.tournamentCatalog
    ?.flatMap((tournament) => tournament.participants)
    .find((candidate) => matches(candidate.id, candidate.abbreviation, candidate.name));
  const competitionParticipant = room?.competitionSeason?.competitions
    .flatMap((competition) => competition.participants)
    .find((candidate) => matches(candidate.id, candidate.name));
  const name = fullClub?.name
    || tournamentParticipant?.name
    || catalogClub?.name
    || competitionParticipant?.name
    || rankingClub.name;
  const reputation = clubReputation(
    rankingClub.reputation ?? tournamentParticipant?.reputation ?? catalogClub?.reputation,
    fullClub?.stars,
  );

  return {
    id: fullClub?.id || tournamentParticipant?.id || catalogClub?.id || competitionParticipant?.id || rankingClub.id,
    name,
    code: fullClub?.code || tournamentParticipant?.abbreviation || catalogClub?.code || rankingClub.code || compactClubCode(name),
    color: fullClub?.color || tournamentParticipant?.colors[0] || catalogClub?.color || rankingClub.color || '#c8ff3d',
    darkThemeColor: fullClub?.darkThemeColor ?? tournamentParticipant?.darkThemeColor ?? catalogClub?.darkThemeColor ?? rankingClub.darkThemeColor,
    lightThemeColor: fullClub?.lightThemeColor ?? tournamentParticipant?.lightThemeColor ?? catalogClub?.lightThemeColor ?? rankingClub.lightThemeColor,
    crestImageUrl: fullClub?.crestImageUrl ?? tournamentParticipant?.crestImageUrl ?? catalogClub?.crestImageUrl ?? rankingClub.crestImageUrl,
    country: fullClub?.country || tournamentParticipant?.country || rankingClub.country || catalogLeague?.country || 'País a definir',
    division: fullClub?.division || tournamentParticipant?.division || rankingClub.division || catalogLeague?.division || rankingClub.leagueName || 'Divisão a definir',
    reputation,
    stadium: fullClub?.stadium || tournamentParticipant?.stadium || catalogClub?.stadium || 'Estádio a definir',
    capacity: fullClub?.stadiumCapacity ?? tournamentParticipant?.stadiumCapacity ?? catalogClub?.stadiumCapacity ?? 0,
    city: fullClub?.city || tournamentParticipant?.country || rankingClub.country || catalogLeague?.country || 'Local a definir',
    budget: parseClubBudget(fullClub?.budget),
  };
}

function metric(value: number | null | undefined, digits = 0) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signed(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value > 0 ? `+${value}` : String(value);
}

function percentage(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`;
}

function displayDate(value: string | null | undefined) {
  if (!value) return 'Ainda não sincronizado';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Ainda não sincronizado';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function optionalHistoryInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function localSeasonHistory(room: Room | null): RankingHistoryEntry[] {
  return (room?.seasonHistory ?? []).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const seasonNumber = optionalHistoryInteger(source.seasonNumber ?? source.season) ?? index + 1;
    const directCompleted = optionalHistoryInteger(source.completedFixtureCount);
    const directMatches = optionalHistoryInteger(source.matchCount);
    const createdAt = [source.completedAt, source.createdAt, source.startedAt]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim())) ?? null;
    return [{
      id: `season-${seasonNumber}-${index}`,
      type: 'season',
      label: typeof source.label === 'string' && source.label.trim() ? source.label.trim() : null,
      seasonNumber,
      round: null,
      competitionId: null,
      playerId: null,
      clubId: null,
      managerId: null,
      position: null,
      value: null,
      createdAt,
      seasonYear: optionalHistoryInteger(source.seasonYear),
      completedFixtureCount: directCompleted ?? (Array.isArray(source.completedFixtureIds) ? source.completedFixtureIds.length : null),
      matchCount: directMatches ?? (Array.isArray(source.matchIds) ? source.matchIds.length : null),
    }];
  });
}

function historyMetrics(entry: RankingHistoryEntry): Array<{ label: string; value: string }> {
  const metrics: Array<{ label: string; value: string }> = [];
  if (entry.round !== null) metrics.push({ label: 'Rodada', value: String(entry.round) });
  if (entry.position !== null) metrics.push({ label: 'Posição', value: `${entry.position}º` });
  if (entry.value !== null) metrics.push({ label: 'Valor', value: entry.value.toLocaleString('pt-BR') });
  if (entry.seasonYear !== null) metrics.push({ label: 'Ano', value: String(entry.seasonYear) });
  if (entry.completedFixtureCount !== null) metrics.push({ label: 'Concluídas', value: String(entry.completedFixtureCount) });
  if (entry.matchCount !== null && entry.matchCount !== entry.completedFixtureCount) {
    metrics.push({ label: 'Partidas', value: String(entry.matchCount) });
  }
  if (!metrics.length && entry.seasonNumber !== null) {
    metrics.push({ label: 'Temporada', value: String(entry.seasonNumber) });
  }
  return metrics.slice(0, 3);
}

function timelinePosition(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'â€”' : `${value}Âº`;
}

function TimelineEvolution({
  entries,
  historyRound,
  onRoundChange,
  clubName,
  competitionName,
  seasonLabel,
  totalClubs,
}: {
  entries: RankingTimelineEntry[];
  historyRound: string;
  onRoundChange: (round: string) => void;
  clubName: string;
  competitionName: string;
  seasonLabel: string;
  totalClubs: number;
}) {
  const rounds = [...new Set(entries.map((entry) => entry.round))].sort((left, right) => left - right);
  const effectiveRound = historyRound === 'all' || rounds.includes(Number(historyRound)) ? historyRound : 'all';
  const visibleEntries = effectiveRound === 'all'
    ? entries
    : entries.filter((entry) => entry.round === Number(effectiveRound));
  const positions = entries.map((entry) => entry.position);
  const rises = entries.map((entry) => entry.positionChange).filter((value): value is number => value !== null && value > 0);
  const drops = entries.map((entry) => entry.positionChange).filter((value): value is number => value !== null && value < 0);
  const bestPosition = positions.length ? Math.min(...positions) : null;
  const worstPosition = positions.length ? Math.max(...positions) : null;
  const biggestRise = rises.length ? Math.max(...rises) : null;
  const biggestDrop = drops.length ? Math.abs(Math.min(...drops)) : null;
  const leaderRounds = new Set(entries.filter((entry) => entry.position === 1).map((entry) => entry.round)).size;
  const maxPosition = Math.max(1, totalClubs, ...positions);
  const chartWidth = Math.max(520, 80 + Math.max(1, visibleEntries.length - 1) * 58);
  const chartHeight = 220;
  const chartLeft = 42;
  const chartRight = 24;
  const chartTop = 24;
  const chartBottom = 42;
  const plotWidth = chartWidth - chartLeft - chartRight;
  const plotHeight = chartHeight - chartTop - chartBottom;
  const pointFor = (entry: RankingTimelineEntry, index: number) => ({
    x: visibleEntries.length <= 1 ? chartLeft + plotWidth / 2 : chartLeft + index * plotWidth / (visibleEntries.length - 1),
    y: maxPosition <= 1 ? chartTop + plotHeight / 2 : chartTop + (entry.position - 1) * plotHeight / (maxPosition - 1),
  });
  const chartPoints = visibleEntries.map(pointFor);
  const positionTicks = [...new Set([1, Math.max(1, Math.ceil(maxPosition / 2)), maxPosition])];

  return <section className="rankings-history-timeline" aria-labelledby="rankings-history-title">
    <header className="rankings-history-timeline__header">
      <div>
        <span className="eyebrow">EVOLUÃ‡ÃƒO REAL POR RODADA</span>
        <h2 id="rankings-history-title">{clubName}</h2>
        <p>{competitionName} Â· {seasonLabel} Â· {entries.length} snapshots preservados</p>
      </div>
      <label className="rankings-control rankings-history-timeline__round">
        <span>Rodada</span>
        <select value={effectiveRound} onChange={(event) => onRoundChange(event.target.value)}>
          <option value="all">Todas as rodadas</option>
          {rounds.map((round) => <option value={String(round)} key={round}>Rodada {round}</option>)}
        </select>
      </label>
    </header>

    <dl className="rankings-history-summary">
      <div><dt>Melhor posiÃ§Ã£o</dt><dd>{timelinePosition(bestPosition)}</dd></div>
      <div><dt>Pior posiÃ§Ã£o</dt><dd>{timelinePosition(worstPosition)}</dd></div>
      <div><dt>Maior subida</dt><dd className={biggestRise ? 'rankings-number--positive' : ''}>{biggestRise ? `+${biggestRise}` : 'â€”'}</dd></div>
      <div><dt>Maior queda</dt><dd className={biggestDrop ? 'rankings-number--negative' : ''}>{biggestDrop ? `-${biggestDrop}` : 'â€”'}</dd></div>
      <div><dt>Rodadas lÃ­der</dt><dd>{leaderRounds}</dd></div>
    </dl>

    <article className="rankings-history-chart">
      <header><div><h3>PosiÃ§Ã£o na tabela</h3><p>Quanto mais alto o ponto, melhor a colocaÃ§Ã£o.</p></div><Badge tone="info">{effectiveRound === 'all' ? 'Temporada' : `Rodada ${effectiveRound}`}</Badge></header>
      <div className="rankings-history-chart__viewport">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ minWidth: `${chartWidth}px` }} role="img" aria-label={`EvoluÃ§Ã£o de ${clubName} na tabela`}>
          <title>{`EvoluÃ§Ã£o de ${clubName}: ${visibleEntries.map((entry) => `rodada ${entry.round}, ${entry.position}Âº`).join('; ')}`}</title>
          {positionTicks.map((position) => {
            const y = maxPosition <= 1 ? chartTop + plotHeight / 2 : chartTop + (position - 1) * plotHeight / (maxPosition - 1);
            return <g key={position}>
              <line className="rankings-history-chart__grid" x1={chartLeft} x2={chartWidth - chartRight} y1={y} y2={y} />
              <text className="rankings-history-chart__axis" x={chartLeft - 9} y={y + 4} textAnchor="end">{position}Âº</text>
            </g>;
          })}
          {chartPoints.length > 1 && <polyline className="rankings-history-chart__line" points={chartPoints.map((point) => `${point.x},${point.y}`).join(' ')} />}
          {visibleEntries.map((entry, index) => {
            const point = chartPoints[index];
            return <g className="rankings-history-chart__marker" key={entry.id}>
              <circle cx={point.x} cy={point.y} r="5"><title>{`Rodada ${entry.round}: ${entry.position}Âº, ${entry.points} pontos`}</title></circle>
              <text x={point.x} y={chartHeight - 14} textAnchor="middle">R{entry.round}</text>
            </g>;
          })}
        </svg>
      </div>
    </article>

    <article className="rankings-history-table-card">
      <header><div><h3>Campanha por rodada</h3><p>{effectiveRound === 'all' ? 'Todos os snapshots preservados no save.' : `Dados após a rodada ${effectiveRound}.`}</p></div></header>
      <div className="rankings-history-table-wrap">
        <table className="rankings-history-table">
          <caption>HistÃ³rico de posiÃ§Ãµes e campanha de {clubName}</caption>
          <thead><tr><th scope="col">Rodada</th><th scope="col">Pos.</th><th scope="col">VariaÃ§Ã£o</th><th scope="col">J</th><th scope="col">V</th><th scope="col">E</th><th scope="col">D</th><th scope="col">SG</th><th scope="col">Pts</th></tr></thead>
          <tbody>{visibleEntries.map((entry) => <tr key={entry.id}>
            <th scope="row">{entry.round}</th>
            <td><strong>{timelinePosition(entry.position)}</strong></td>
            <td className={entry.positionChange && entry.positionChange > 0 ? 'rankings-number--positive' : entry.positionChange && entry.positionChange < 0 ? 'rankings-number--negative' : ''}>{entry.positionChange === null ? 'â€”' : signed(entry.positionChange)}</td>
            <td>{entry.played}</td><td>{entry.wins}</td><td>{entry.draws}</td><td>{entry.losses}</td><td>{signed(entry.goalDifference)}</td><td><strong>{entry.points}</strong></td>
          </tr>)}</tbody>
        </table>
      </div>
    </article>
  </section>;
}

function formPoints(form: RankingFormResult[]) {
  return form.reduce((total, result) => total + (result === 'W' ? 3 : result === 'D' ? 1 : 0), 0);
}

function FormStrip({ form }: { form: RankingFormResult[] }) {
  if (!form.length) return <span className="rankings-unavailable">—</span>;
  return <span className="rankings-form" aria-label="Forma recente">
    {form.slice(-5).map((result, index) => <i className={result === 'W' ? 'is-win' : result === 'D' ? 'is-draw' : 'is-loss'} key={`${result}-${index}`}>{result === 'W' ? 'V' : result === 'D' ? 'E' : 'D'}</i>)}
  </span>;
}

function RankingAvatar({ player }: { player: Pick<RankingPlayer, 'avatarImageUrl' | 'name'> }) {
  return <span className="rankings-avatar">
    <ResilientImage src={player.avatarImageUrl} alt={`Foto de ${player.name}`} fallback={<span>{managerInitials(player.name)}</span>} />
  </span>;
}

function PlayerEntity({ player, rank }: { player: RankingPlayer; rank: number }) {
  return <span className="rankings-entity">
    <span className="rankings-entity__rank">{rank}</span>
    <RankingAvatar player={player} />
    <span className="rankings-entity__copy"><strong>{player.name}</strong><small>{player.clubName || 'Clube não informado'}</small></span>
  </span>;
}

function ClubEntity({ candidate, rank }: { candidate: RankingClub; rank: number }) {
  return <span className="rankings-entity">
    <span className="rankings-entity__rank">{rank}</span>
    <ClubMark code={candidate.code} color={candidate.color} darkThemeColor={candidate.darkThemeColor} lightThemeColor={candidate.lightThemeColor} imageUrl={candidate.crestImageUrl} size="sm" />
    <span className="rankings-entity__copy"><strong>{candidate.name}</strong><small>{candidate.leagueName || candidate.division || 'Competição atual'}</small></span>
  </span>;
}

function ManagerEntity({ manager, rank }: { manager: RankingManager; rank: number }) {
  const kind = manager.isViewer ? 'VOCÊ' : manager.managerType === 'ai' ? 'IA' : 'JOGADOR';
  return <span className="rankings-entity">
    <span className="rankings-entity__rank">{rank}</span>
    <span className="rankings-avatar"><span>{managerInitials(manager.name)}</span></span>
    <span className="rankings-entity__copy"><strong>{manager.name}<i className={`rankings-manager-kind is-${manager.isViewer ? 'viewer' : manager.managerType}`}>{kind}</i></strong><small>{manager.clubName || 'Sem clube'}</small></span>
  </span>;
}

function managerStatusLabel(status: RankingManagerStatus | null) {
  if (status === 'employed') return 'Empregado';
  if (status === 'unemployed') return 'Sem clube';
  if (status === 'dismissed') return 'Demitido';
  return 'Não informado';
}

function managerPeriodLabel(period: RankingManagerPeriod) {
  if (period === 'last5') return 'Últimos cinco jogos';
  if (period === 'career') return 'Histórico completo';
  return 'Temporada atual';
}

function managerForPeriod(manager: RankingManager, period: RankingManagerPeriod): RankingManager | null {
  if (period === 'current') return manager;
  if (period === 'last5') {
    const results = (manager.matchHistory.length ? manager.matchHistory : manager.recentResults).slice(0, 5);
    if (!results.length) return null;
    const wins = results.filter((result) => result.result === 'W').length;
    const draws = results.filter((result) => result.result === 'D').length;
    const losses = results.filter((result) => result.result === 'L').length;
    const goalsFor = results.reduce((total, result) => total + result.goalsFor, 0);
    const goalsAgainst = results.reduce((total, result) => total + result.goalsAgainst, 0);
    const points = wins * 3 + draws;
    return {
      ...manager,
      played: results.length,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      goalDifference: goalsFor - goalsAgainst,
      points,
      performancePercent: results.length ? points / (results.length * 3) * 100 : 0,
      recentForm: results.map((result) => result.result).filter((result): result is RankingFormResult => result !== null),
    };
  }
  const seasonStats = aggregateRankingManagerSeasonStats(manager.seasonStats);
  if (!seasonStats.length) return null;
  const played = seasonStats.reduce((total, entry) => total + entry.played, 0);
  const wins = seasonStats.reduce((total, entry) => total + entry.wins, 0);
  const draws = seasonStats.reduce((total, entry) => total + entry.draws, 0);
  const losses = seasonStats.reduce((total, entry) => total + entry.losses, 0);
  const goalsFor = seasonStats.reduce((total, entry) => total + entry.goalsFor, 0);
  const goalsAgainst = seasonStats.reduce((total, entry) => total + entry.goalsAgainst, 0);
  const points = seasonStats.reduce((total, entry) => total + entry.points, 0);
  const rankingPointValues = seasonStats.map((entry) => entry.rankingPoints).filter((value): value is number => value !== null);
  return {
    ...manager,
    played,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    points,
    performancePercent: played ? points / (played * 3) * 100 : 0,
    titles: seasonStats.reduce((total, entry) => total + entry.titles, 0),
    rankingPoints: rankingPointValues.length
      ? rankingPointValues.reduce((total, value) => total + value, 0)
      : null,
  };
}

function consecutiveWins(manager: RankingManager) {
  let total = 0;
  for (const result of [...manager.recentForm].reverse()) {
    if (result !== 'W') break;
    total += 1;
  }
  return total;
}

function medalClass(index: number) {
  if (index === 0) return 'is-gold';
  if (index === 1) return 'is-silver';
  if (index === 2) return 'is-bronze';
  return '';
}

function HighlightCard({
  label,
  icon,
  entity,
  detail,
  metricValue,
  metricLabel,
  evolution,
  onClick,
  featured = false,
}: {
  label: string;
  icon: ReactNode;
  entity: ReactNode;
  detail: string;
  metricValue: string;
  metricLabel: string;
  evolution?: string;
  onClick?: () => void;
  featured?: boolean;
}) {
  return <button type="button" className={`rankings-highlight${featured ? ' is-featured' : ''}`} onClick={onClick} disabled={!onClick}>
    <span className="rankings-highlight__label">{label}{icon}</span>
    <span className="rankings-highlight__entity">{entity}<span><strong>{detail}</strong><small>{metricLabel}</small></span></span>
    <span className="rankings-highlight__metric"><strong>{metricValue}</strong><ChevronRight size={15} /></span>
    <small className="rankings-highlight__evolution">{evolution ?? 'Sem comparação anterior'}</small>
  </button>;
}

function rankEvolution(change: number | null | undefined) {
  if (change === null || change === undefined || !Number.isFinite(change)) return undefined;
  if (change === 0) return 'Sem mudança na rodada';
  return change > 0 ? `▲ ${change} posição${change === 1 ? '' : 'ões'}` : `▼ ${Math.abs(change)} posição${change === -1 ? '' : 'ões'}`;
}

function PlayerStatsNotice({ rankings }: { rankings: ReturnType<typeof useRankings>['rankings'] }) {
  const meta = rankings?.meta;
  if (!meta || meta.playerStatsScope === 'local-season' || meta.playerStatsScope === 'competition' && meta.playerStatsComplete) {
    return null;
  }
  if (meta.playerStatsScope === 'unavailable') {
    return <div className="rankings-inline-status is-warning" role="status">
      Estatísticas individuais ocultadas: este save antigo contém partidas de mais de uma competição sem separar os números por torneio. Clubes e campanhas continuam corretos.
    </div>;
  }
  if (meta.playerStatsScope === 'season-legacy') {
    return <div className="rankings-inline-status" role="status">
      Save antigo: estatísticas individuais vieram do total da temporada porque somente esta competição possui partidas concluídas.
    </div>;
  }
  return <div className="rankings-inline-status is-warning" role="status">
    Estatísticas individuais parciais: {meta.playerStatsTrackedMatches} partidas rastreadas
    {meta.playerStatsUntrackedMatches > 0 ? ` e ${meta.playerStatsUntrackedMatches} sem dados individuais` : ''}.
  </div>;
}

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return <div className="rankings-pagination">
    <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}><ChevronLeft size={15} /></button>
    <span>Página {page} de {pages}</span>
    <button type="button" aria-label="Próxima página" disabled={page >= pages} onClick={() => onChange(Math.min(pages, page + 1))}><ChevronRight size={15} /></button>
  </div>;
}

function Skeleton() {
  return <div className="rankings-skeleton" aria-label="Carregando rankings" role="status">
    <div className="rankings-skeleton__header" />
    <div className="rankings-skeleton__grid"><div className="rankings-skeleton__card" /><div className="rankings-skeleton__card" /><div className="rankings-skeleton__card" /></div>
  </div>;
}

function CategoryBar<T extends string>({ items, value, onChange, label }: {
  items: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return <>
    <div className="rankings-category-bar" role="toolbar" aria-label={label}>
      {items.map((item) => <button type="button" className={item.id === value ? 'is-active' : ''} aria-pressed={item.id === value} key={item.id} onClick={() => onChange(item.id)}>{item.label}</button>)}
    </div>
    <label className="rankings-control rankings-category-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {items.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select>
    </label>
  </>;
}

function sortClubs(clubs: RankingClub[], category: ClubCategory) {
  return [...clubs].sort((left, right) => {
    if (category === 'squadValue') return right.squadValue - left.squadValue || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'averagePlayerValue') return (right.averagePlayerValue ?? -1) - (left.averagePlayerValue ?? -1) || right.squadValue - left.squadValue;
    if (category === 'payroll') return (right.payroll ?? -1) - (left.payroll ?? -1) || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'reputation') return (right.reputation ?? -1) - (left.reputation ?? -1) || right.squadValue - left.squadValue;
    if (category === 'wins') return right.wins - left.wins || right.points - left.points || right.goalDifference - left.goalDifference;
    if (category === 'attack') return right.goalsFor - left.goalsFor || right.goalDifference - left.goalDifference || right.points - left.points;
    if (category === 'defense') return Number(right.played > 0) - Number(left.played > 0) || left.goalsAgainst - right.goalsAgainst || right.goalDifference - left.goalDifference;
    if (category === 'form') return formPoints(right.recentForm) - formPoints(left.recentForm) || right.points - left.points;
    return right.points - left.points || right.wins - left.wins || right.goalDifference - left.goalDifference || right.goalsFor - left.goalsFor;
  });
}

function ageRange(ageFilter: AgeFilter) {
  if (ageFilter === 'u21') return { ageMax: 21, u21: true };
  if (ageFilter === '22-25') return { ageMin: 22, ageMax: 25 };
  if (ageFilter === '26-30') return { ageMin: 26, ageMax: 30 };
  if (ageFilter === '31+') return { ageMin: 31 };
  return {};
}

function sortedForTable<T>(
  items: T[],
  columns: RankingColumn<T>[],
  sort: { column: string; direction: RankingSortDirection },
) {
  const column = columns.find((candidate) => candidate.id === sort.column && candidate.sortable && candidate.value);
  if (!column?.value) return items;
  return [...items].sort((left, right) => {
    const leftValue = column.value?.(left);
    const rightValue = column.value?.(right);
    let result = 0;
    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') result = leftValue - rightValue;
    else result = String(leftValue).localeCompare(String(rightValue), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return sort.direction === 'asc' ? result : -result;
  });
}

function playerDefaultSort(category: PlayerRankingCategory) {
  const columns: Record<PlayerRankingCategory, string> = {
    goals: 'goals', assists: 'assists', contributions: 'goalContributions', rating: 'averageRating',
    minutes: 'minutes', appearances: 'appearances', keyPasses: 'keyPasses', tackles: 'tackles',
    saves: 'saves', cleanSheets: 'cleanSheets', cards: 'yellowCards',
  };
  return { column: columns[category], direction: 'desc' as RankingSortDirection };
}

function availablePlayerMetric(
  player: RankingProfilePlayer,
  value: number | null | undefined,
  digits = 0,
) {
  return player.statisticsAvailable ? metric(value, digits) : '—';
}

function playerStatValue(player: RankingProfilePlayer, value: number | null | undefined) {
  return player.statisticsAvailable ? value : null;
}

function playerColumns(category: PlayerRankingCategory): RankingColumn<RankingProfilePlayer>[] {
  const common: RankingColumn<RankingProfilePlayer>[] = [
    { id: 'player', label: 'Jogador', sortable: true, value: (item) => item.name, render: (item, index) => <PlayerEntity player={item} rank={index + 1} /> },
    { id: 'position', label: 'Pos.', sortable: true, value: (item) => item.position, render: (item) => item.position || '—' },
  ];
  const columns: Record<PlayerRankingCategory, RankingColumn<RankingProfilePlayer>[]> = {
    goals: [
      { id: 'appearances', label: 'J', sortable: true, value: (item) => playerStatValue(item, item.appearances), render: (item) => availablePlayerMetric(item, item.appearances) },
      { id: 'minutes', label: 'Min', sortable: true, value: (item) => playerStatValue(item, item.minutes), render: (item) => availablePlayerMetric(item, item.minutes) },
      { id: 'goals', label: 'Gols', sortable: true, value: (item) => playerStatValue(item, item.goals), render: (item) => <strong>{availablePlayerMetric(item, item.goals)}</strong> },
      { id: 'nonPenaltyGoals', label: 'Gols s/pên.', sortable: true, value: (item) => playerStatValue(item, item.nonPenaltyGoals), render: (item) => availablePlayerMetric(item, item.nonPenaltyGoals) },
      { id: 'minutesPerGoal', label: 'Min/gol', sortable: true, value: (item) => playerStatValue(item, item.minutesPerGoal), render: (item) => availablePlayerMetric(item, item.minutesPerGoal) },
      { id: 'assists', label: 'Assist.', sortable: true, value: (item) => playerStatValue(item, item.assists), render: (item) => availablePlayerMetric(item, item.assists) },
      { id: 'goalContributions', label: 'Part.', sortable: true, value: (item) => playerStatValue(item, item.goalContributions), render: (item) => availablePlayerMetric(item, item.goalContributions) },
      { id: 'averageRating', label: 'Nota média', sortable: true, value: (item) => playerStatValue(item, item.averageRating), render: (item) => availablePlayerMetric(item, item.averageRating, 2) },
    ],
    assists: [
      { id: 'appearances', label: 'J', sortable: true, value: (item) => playerStatValue(item, item.appearances), render: (item) => availablePlayerMetric(item, item.appearances) },
      { id: 'assists', label: 'Assist.', sortable: true, value: (item) => playerStatValue(item, item.assists), render: (item) => <strong>{availablePlayerMetric(item, item.assists)}</strong> },
      { id: 'keyPasses', label: 'Passes decisivos', sortable: true, value: (item) => playerStatValue(item, item.keyPasses), render: (item) => availablePlayerMetric(item, item.keyPasses) },
      { id: 'bigChancesCreated', label: 'Grandes chances', sortable: true, value: (item) => playerStatValue(item, item.bigChancesCreated), render: (item) => availablePlayerMetric(item, item.bigChancesCreated) },
      { id: 'minutesPerAssist', label: 'Min/assist.', sortable: true, value: (item) => playerStatValue(item, item.minutesPerAssist), render: (item) => availablePlayerMetric(item, item.minutesPerAssist) },
      { id: 'averageRating', label: 'Nota média', sortable: true, value: (item) => playerStatValue(item, item.averageRating), render: (item) => availablePlayerMetric(item, item.averageRating, 2) },
    ],
    contributions: [
      { id: 'goals', label: 'Gols', sortable: true, value: (item) => playerStatValue(item, item.goals), render: (item) => availablePlayerMetric(item, item.goals) },
      { id: 'assists', label: 'Assist.', sortable: true, value: (item) => playerStatValue(item, item.assists), render: (item) => availablePlayerMetric(item, item.assists) },
      { id: 'goalContributions', label: 'Participações', sortable: true, value: (item) => playerStatValue(item, item.goalContributions), render: (item) => <strong>{availablePlayerMetric(item, item.goalContributions)}</strong> },
      { id: 'contributionsPerGame', label: 'Por jogo', sortable: true, value: (item) => playerStatValue(item, item.contributionsPerGame), render: (item) => availablePlayerMetric(item, item.contributionsPerGame, 2) },
      { id: 'minutesPerContribution', label: 'Min/part.', sortable: true, value: (item) => playerStatValue(item, item.minutesPerContribution), render: (item) => availablePlayerMetric(item, item.minutesPerContribution) },
      { id: 'clubGoalParticipationPercent', label: '% gols clube', sortable: true, value: (item) => playerStatValue(item, item.clubGoalParticipationPercent), render: (item) => item.statisticsAvailable ? percentage(item.clubGoalParticipationPercent) : '—' },
    ],
    rating: [
      { id: 'appearances', label: 'J', sortable: true, value: (item) => playerStatValue(item, item.appearances), render: (item) => availablePlayerMetric(item, item.appearances) },
      { id: 'averageRating', label: 'Nota média', sortable: true, value: (item) => playerStatValue(item, item.averageRating), render: (item) => availablePlayerMetric(item, item.averageRating, 2) },
      { id: 'overall', label: 'Overall', sortable: true, value: (item) => item.overall, render: (item) => metric(item.overall, 1) },
      { id: 'minutes', label: 'Minutos', sortable: true, value: (item) => playerStatValue(item, item.minutes), render: (item) => availablePlayerMetric(item, item.minutes) },
    ],
    minutes: [
      { id: 'starts', label: 'Titular', sortable: true, value: (item) => playerStatValue(item, item.starts), render: (item) => availablePlayerMetric(item, item.starts) },
      { id: 'appearances', label: 'Jogos', sortable: true, value: (item) => playerStatValue(item, item.appearances), render: (item) => availablePlayerMetric(item, item.appearances) },
      { id: 'minutes', label: 'Minutos', sortable: true, value: (item) => playerStatValue(item, item.minutes), render: (item) => <strong>{availablePlayerMetric(item, item.minutes)}</strong> },
    ],
    appearances: [
      { id: 'appearances', label: 'Jogos', sortable: true, value: (item) => playerStatValue(item, item.appearances), render: (item) => <strong>{availablePlayerMetric(item, item.appearances)}</strong> },
      { id: 'starts', label: 'Titular', sortable: true, value: (item) => playerStatValue(item, item.starts), render: (item) => availablePlayerMetric(item, item.starts) },
      { id: 'minutes', label: 'Minutos', sortable: true, value: (item) => playerStatValue(item, item.minutes), render: (item) => availablePlayerMetric(item, item.minutes) },
    ],
    keyPasses: [
      { id: 'keyPasses', label: 'Passes decisivos', sortable: true, value: (item) => playerStatValue(item, item.keyPasses), render: (item) => availablePlayerMetric(item, item.keyPasses) },
      { id: 'bigChancesCreated', label: 'Grandes chances', sortable: true, value: (item) => playerStatValue(item, item.bigChancesCreated), render: (item) => availablePlayerMetric(item, item.bigChancesCreated) },
      { id: 'assists', label: 'Assist.', sortable: true, value: (item) => playerStatValue(item, item.assists), render: (item) => availablePlayerMetric(item, item.assists) },
    ],
    tackles: [
      { id: 'tackles', label: 'Desarmes', sortable: true, value: (item) => playerStatValue(item, item.tackles), render: (item) => availablePlayerMetric(item, item.tackles) },
      { id: 'appearances', label: 'Jogos', sortable: true, value: (item) => playerStatValue(item, item.appearances), render: (item) => availablePlayerMetric(item, item.appearances) },
      { id: 'averageRating', label: 'Nota média', sortable: true, value: (item) => playerStatValue(item, item.averageRating), render: (item) => availablePlayerMetric(item, item.averageRating, 2) },
    ],
    saves: [
      { id: 'saves', label: 'Defesas', sortable: true, value: (item) => playerStatValue(item, item.saves), render: (item) => availablePlayerMetric(item, item.saves) },
      { id: 'cleanSheets', label: 'Sem sofrer gols', sortable: true, value: (item) => playerStatValue(item, item.cleanSheets), render: (item) => availablePlayerMetric(item, item.cleanSheets) },
      { id: 'appearances', label: 'Jogos', sortable: true, value: (item) => playerStatValue(item, item.appearances), render: (item) => availablePlayerMetric(item, item.appearances) },
    ],
    cleanSheets: [
      { id: 'cleanSheets', label: 'Sem sofrer gols', sortable: true, value: (item) => playerStatValue(item, item.cleanSheets), render: (item) => availablePlayerMetric(item, item.cleanSheets) },
      { id: 'saves', label: 'Defesas', sortable: true, value: (item) => playerStatValue(item, item.saves), render: (item) => availablePlayerMetric(item, item.saves) },
      { id: 'appearances', label: 'Jogos', sortable: true, value: (item) => playerStatValue(item, item.appearances), render: (item) => availablePlayerMetric(item, item.appearances) },
    ],
    cards: [
      { id: 'yellowCards', label: 'Amarelos', sortable: true, value: (item) => playerStatValue(item, item.yellowCards), render: (item) => availablePlayerMetric(item, item.yellowCards) },
      { id: 'redCards', label: 'Vermelhos', sortable: true, value: (item) => playerStatValue(item, item.redCards), render: (item) => availablePlayerMetric(item, item.redCards) },
      { id: 'appearances', label: 'Jogos', sortable: true, value: (item) => playerStatValue(item, item.appearances), render: (item) => availablePlayerMetric(item, item.appearances) },
    ],
  };
  return [...common, ...columns[category]];
}

function clubColumns(): RankingColumn<RankingClub>[] {
  return [
    { id: 'club', label: 'Clube', sortable: true, value: (item) => item.name, render: (item, index) => <ClubEntity candidate={item} rank={index + 1} /> },
    { id: 'playerCount', label: 'Jog.', sortable: true, value: (item) => item.playerCount, render: (item) => item.playerCount },
    { id: 'played', label: 'J', sortable: true, value: (item) => item.played, render: (item) => item.played },
    { id: 'wins', label: 'V', sortable: true, value: (item) => item.wins, render: (item) => item.wins },
    { id: 'draws', label: 'E', sortable: true, value: (item) => item.draws, render: (item) => item.draws },
    { id: 'losses', label: 'D', sortable: true, value: (item) => item.losses, render: (item) => item.losses },
    { id: 'goalsFor', label: 'GP', sortable: true, value: (item) => item.goalsFor, render: (item) => item.goalsFor },
    { id: 'goalsAgainst', label: 'GC', sortable: true, value: (item) => item.goalsAgainst, render: (item) => item.goalsAgainst },
    { id: 'goalDifference', label: 'SG', sortable: true, value: (item) => item.goalDifference, render: (item) => signed(item.goalDifference) },
    { id: 'points', label: 'Pts', sortable: true, value: (item) => item.points, render: (item) => <strong>{item.points}</strong> },
    { id: 'squadValue', label: 'Valor', sortable: true, value: (item) => item.squadValue, render: (item) => formatCurrency(item.squadValue) },
    { id: 'valueChange', label: 'Δ valor', sortable: true, value: (item) => item.valueChange, render: (item) => item.valueChange === null ? '—' : `${signed(item.valueChange)}%` },
    { id: 'averagePlayerValue', label: 'Média/jog.', sortable: true, value: (item) => item.averagePlayerValue, render: (item) => item.averagePlayerValue === null ? '—' : formatCurrency(item.averagePlayerValue) },
    { id: 'payroll', label: 'Folha', sortable: true, value: (item) => item.payroll, render: (item) => item.payroll === null ? '—' : formatCurrency(item.payroll) },
    { id: 'possession', label: 'Posse', sortable: true, value: (item) => item.possessionPercent, render: (item) => item.possessionPercent === null ? '—' : percentage(item.possessionPercent) },
    { id: 'attendance', label: 'Público', sortable: true, value: (item) => item.averageAttendance, render: (item) => item.averageAttendance === null ? '—' : item.averageAttendance.toLocaleString('pt-BR') },
    { id: 'form', label: 'Forma', sortable: true, value: (item) => formPoints(item.recentForm), render: (item) => <FormStrip form={item.recentForm} /> },
    { id: 'reputation', label: 'Rep.', sortable: true, value: (item) => item.reputation, render: (item) => metric(item.reputation) },
  ];
}

function managerColumns(compareIds: string[] = [], onCompareToggle?: (manager: RankingManager) => void): RankingColumn<RankingManager>[] {
  const columns: RankingColumn<RankingManager>[] = [
    { id: 'manager', label: 'Treinador', sortable: true, value: (item) => item.name, render: (item) => <ManagerEntity manager={item} rank={item.position} /> },
    { id: 'type', label: 'Tipo', sortable: true, value: (item) => item.managerType, render: (item) => item.isViewer ? 'Você' : item.managerType === 'ai' ? 'IA' : 'Jogador' },
    { id: 'played', label: 'J', sortable: true, value: (item) => item.played, render: (item) => item.played },
    { id: 'wins', label: 'V', sortable: true, value: (item) => item.wins, render: (item) => item.wins },
    { id: 'draws', label: 'E', sortable: true, value: (item) => item.draws, render: (item) => item.draws },
    { id: 'losses', label: 'D', sortable: true, value: (item) => item.losses, render: (item) => item.losses },
    { id: 'performance', label: 'Aprov.', sortable: true, value: (item) => item.performancePercent, render: (item) => percentage(item.performancePercent) },
    { id: 'goalsFor', label: 'GP', sortable: true, value: (item) => item.goalsFor, render: (item) => item.goalsFor },
    { id: 'goalsAgainst', label: 'GC', sortable: true, value: (item) => item.goalsAgainst, render: (item) => item.goalsAgainst },
    { id: 'goalDifference', label: 'SG', sortable: true, value: (item) => item.goalDifference, render: (item) => signed(item.goalDifference) },
    { id: 'points', label: 'Pts', sortable: true, value: (item) => item.points, render: (item) => <strong>{item.points}</strong> },
    { id: 'form', label: 'Sequência', sortable: true, value: (item) => formPoints(item.recentForm), render: (item) => <FormStrip form={item.recentForm} /> },
    { id: 'preferredFormation', label: 'Formação', sortable: true, value: (item) => item.preferredFormation, render: (item) => item.preferredFormation || '—' },
    { id: 'reputation', label: 'Rep.', sortable: true, value: (item) => item.reputation, render: (item) => metric(item.reputation) },
    { id: 'titles', label: 'Títulos', sortable: true, value: (item) => item.titles, render: (item) => metric(item.titles) },
    { id: 'rankingPoints', label: 'Ranking', sortable: true, value: (item) => item.rankingPoints, render: (item) => metric(item.rankingPoints) },
    { id: 'rankChange', label: 'Δ pos.', sortable: true, value: (item) => item.positionChange ?? item.rankChange, render: (item) => signed(item.positionChange ?? item.rankChange) },
  ];
  if (onCompareToggle) columns.push({
    id: 'compare',
    label: 'Comparar',
    render: (item) => <button
      type="button"
      className={`rankings-compare-toggle${compareIds.includes(item.id) ? ' is-selected' : ''}`}
      aria-pressed={compareIds.includes(item.id)}
      onClick={(event) => {
        event.stopPropagation();
        onCompareToggle(item);
      }}
    >{compareIds.includes(item.id) ? 'Selecionado' : 'Selecionar'}</button>,
  });
  return columns;
}

function managerComparisonValue(manager: RankingManager, metricId: string) {
  if (metricId === 'performance') return manager.played ? percentage(manager.performancePercent) : '—';
  if (metricId === 'wins') return String(manager.wins);
  if (metricId === 'titles') return metric(manager.titles);
  if (metricId === 'rankingPoints') return metric(manager.rankingPoints);
  if (metricId === 'reputation') return metric(manager.reputation);
  if (metricId === 'attack') return manager.played ? (manager.goalsFor / manager.played).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—';
  if (metricId === 'defense') return manager.played ? (manager.goalsAgainst / manager.played).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—';
  if (metricId === 'formation') return manager.preferredFormation ?? '—';
  return '—';
}

function headToHead(manager: RankingManager, opponent: RankingManager) {
  const opponentClubIds = new Set([
    opponent.clubId,
    ...opponent.careerHistory.map((entry) => entry.clubId),
    ...opponent.seasonStats.map((entry) => entry.clubId),
  ].map(normalizedKey).filter(Boolean));
  const opponentClubNames = new Set([
    opponent.clubName,
    ...opponent.careerHistory.map((entry) => entry.clubName),
    ...opponent.seasonStats.map((entry) => entry.clubName),
  ].map(normalizedKey).filter(Boolean));
  const preservedResults = manager.matchHistory.length ? manager.matchHistory : manager.recentResults;
  const results = preservedResults.filter((result) => (
    (result.opponentManagerId && normalizedKey(result.opponentManagerId) === normalizedKey(opponent.id))
    || (!result.opponentManagerId && result.opponentId && opponentClubIds.has(normalizedKey(result.opponentId)))
    || (!result.opponentId && result.opponentName && opponentClubNames.has(normalizedKey(result.opponentName)))
  ));
  if (!results.length) return '—';
  const wins = results.filter((result) => result.result === 'W').length;
  const draws = results.filter((result) => result.result === 'D').length;
  const losses = results.filter((result) => result.result === 'L').length;
  return `${wins}V · ${draws}E · ${losses}D`;
}

function ManagerComparisonModal({ managers, onClose }: { managers: RankingManager[]; onClose: () => void }) {
  if (managers.length !== 2) return null;
  const metrics = [
    ['performance', 'Aproveitamento'],
    ['wins', 'Vitórias'],
    ['titles', 'Títulos'],
    ['rankingPoints', 'Pontuação'],
    ['reputation', 'Reputação'],
    ['attack', 'Gols por jogo'],
    ['defense', 'Gols sofridos por jogo'],
    ['formation', 'Formação mais usada'],
  ] as const;
  return <Modal open onClose={onClose} title="Comparar treinadores" eyebrow="DADOS REAIS DA CARREIRA" size="lg">
    <article className="rankings-manager-comparison">
      <header>
        {managers.map((manager) => <section key={manager.id}>
          <span className="rankings-avatar">{managerInitials(manager.name)}</span>
          <div><strong>{manager.name}</strong><small>{manager.clubName || 'Sem clube'}</small></div>
          <Badge tone={manager.managerType === 'ai' ? 'info' : 'positive'}>{manager.isViewer ? 'Você' : manager.managerType === 'ai' ? 'IA' : 'Jogador'}</Badge>
        </section>)}
      </header>
      <dl>
        {metrics.map(([id, label]) => <div key={id}>
          <dd>{managerComparisonValue(managers[0], id)}</dd>
          <dt>{label}</dt>
          <dd>{managerComparisonValue(managers[1], id)}</dd>
        </div>)}
        <div><dd>{headToHead(managers[0], managers[1])}</dd><dt>Confrontos diretos preservados</dt><dd>{headToHead(managers[1], managers[0])}</dd></div>
      </dl>
      <p>{headToHead(managers[0], managers[1]) === '—' && headToHead(managers[1], managers[0]) === '—' ? 'Save não possui confrontos diretos identificáveis no histórico preservado.' : 'Confronto direto considera todo o histórico real disponível para o mandato atual; não inventa partidas anteriores.'}</p>
    </article>
  </Modal>;
}

function ManagerSummaryCard({ label, manager, value, onClick }: { label: string; manager: RankingManager | null; value: string; onClick?: () => void }) {
  return <button type="button" className="rankings-manager-summary" onClick={onClick} disabled={!manager}>
    <small>{label}</small>
    <span><i>{manager ? managerInitials(manager.name) : '—'}</i><strong>{manager?.name ?? 'Sem dados'}</strong></span>
    <b>{manager ? value : '—'}</b>
  </button>;
}

function historicalManager(manager: RankingManager, seasonNumber: number, competitionId: string): RankingManager | null {
  const competitionKey = normalizedKey(competitionId);
  const entries = aggregateRankingManagerSeasonStats(manager.seasonStats.filter((entry) => (
    entry.seasonNumber === seasonNumber
    && (!competitionKey || normalizedKey(entry.competitionId) === competitionKey)
  )));
  if (!entries.length) return null;
  const played = entries.reduce((total, entry) => total + entry.played, 0);
  const wins = entries.reduce((total, entry) => total + entry.wins, 0);
  const draws = entries.reduce((total, entry) => total + entry.draws, 0);
  const losses = entries.reduce((total, entry) => total + entry.losses, 0);
  const goalsFor = entries.reduce((total, entry) => total + entry.goalsFor, 0);
  const goalsAgainst = entries.reduce((total, entry) => total + entry.goalsAgainst, 0);
  const points = entries.reduce((total, entry) => total + entry.points, 0);
  const trophies = manager.trophyHistory.filter((entry) => entry.seasonNumber === seasonNumber && (
    !competitionKey
    || normalizedKey(entry.competitionId) === competitionKey
    || entries.some((season) => normalizedKey(season.competitionName) === normalizedKey(entry.competitionName))
  ));
  const positions = entries.map((entry) => entry.position).filter((value): value is number => value !== null);
  const rankingPoints = entries.map((entry) => entry.rankingPoints).filter((value): value is number => value !== null);
  const careerClub = manager.careerHistory.find((entry) => entry.seasonNumber === seasonNumber && entries.some((season) => normalizedKey(season.clubId) === normalizedKey(entry.clubId)));
  return {
    ...manager,
    clubId: entries[0].clubId ?? manager.clubId,
    clubName: entries[0].clubName ?? careerClub?.clubName ?? entries[0].clubId ?? manager.clubName,
    played,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    points,
    performancePercent: played ? points / (played * 3) * 100 : 0,
    position: positions.at(-1) ?? 0,
    titles: trophies.length,
    rankingPoints: rankingPoints.length ? rankingPoints.reduce((total, value) => total + value, 0) : null,
    recentForm: [],
    recentResults: [],
    matchHistory: [],
  };
}

function ManagerHistorySection({ managers, seasonNumber, competitionId, onSelect }: { managers: RankingManager[]; seasonNumber: number; competitionId: string; onSelect: (manager: RankingManager) => void }) {
  const rows = managers.flatMap((manager) => {
    const entry = historicalManager(manager, seasonNumber, competitionId);
    return entry ? [entry] : [];
  });
  const ranked = sortRankingManagers(rows, 'rankingPoints');
  const champions = ranked.filter((manager) => (manager.titles ?? 0) > 0);
  const champion = champions.length === 1 ? champions[0] : null;
  const human = sortRankingManagers(ranked.filter((manager) => manager.managerType === 'human'), 'rankingPoints')[0] ?? null;
  const ai = sortRankingManagers(ranked.filter((manager) => manager.managerType === 'ai'), 'rankingPoints')[0] ?? null;
  const evolution = managers.flatMap((manager) => manager.rankingTrajectory.filter((entry) => entry.seasonNumber === seasonNumber && (!competitionId || normalizedKey(entry.competitionId) === normalizedKey(competitionId))).map((entry) => ({ manager, change: entry.positionChange }))).filter((entry) => entry.change !== null).sort((left, right) => (right.change ?? -Infinity) - (left.change ?? -Infinity))[0] ?? null;
  const titleCount = managers.reduce((total, manager) => total + manager.trophyHistory.filter((entry) => entry.seasonNumber === seasonNumber).length, 0);
  const awardCount = managers.reduce((total, manager) => total + manager.awards.filter((entry) => entry.seasonNumber === seasonNumber).length, 0);
  const commandedClubs = new Set(managers.flatMap((manager) => manager.careerHistory.filter((entry) => entry.seasonNumber === seasonNumber).map((entry) => entry.clubName ?? entry.clubId).filter((value): value is string => Boolean(value))));
  return <section className="rankings-manager-history" aria-labelledby="manager-history-title">
    <header><div><p className="eyebrow">TREINADORES · TEMPORADA {seasonNumber}</p><h2 id="manager-history-title">Histórico de treinadores</h2><p>Campanhas, vínculos, títulos e premiações preservados no save.</p></div><Badge tone="info">{rows.length} registros</Badge></header>
    {rows.length ? <>
      <div className="rankings-manager-history__summary">
        <ManagerSummaryCard label="Campeão" manager={champion} value={champion ? `${champion.points} pts` : '—'} onClick={champion ? () => onSelect(champion) : undefined} />
        <ManagerSummaryCard label="Melhor jogador" manager={human} value={human ? `${human.points} pts` : '—'} onClick={human ? () => onSelect(human) : undefined} />
        <ManagerSummaryCard label="Melhor IA" manager={ai} value={ai ? `${ai.points} pts` : '—'} onClick={ai ? () => onSelect(ai) : undefined} />
        <ManagerSummaryCard label="Maior evolução" manager={evolution?.manager ?? null} value={evolution?.change === null || evolution?.change === undefined ? '—' : signed(evolution.change)} onClick={evolution ? () => onSelect(evolution.manager) : undefined} />
        <article><small>Clubes comandados</small><strong>{commandedClubs.size || '—'}</strong></article>
        <article><small>Títulos preservados</small><strong>{titleCount || '—'}</strong></article>
        <article><small>Premiações preservadas</small><strong>{awardCount || '—'}</strong></article>
      </div>
      <article className="rankings-card"><RankingTable caption={`Ranking de treinadores da temporada ${seasonNumber}`} columns={managerColumns()} items={ranked} rowKey={(manager) => manager.id} sort={{ column: 'rankingPoints', direction: 'desc' }} onSortChange={() => undefined} onRowClick={onSelect} rowClassName={(manager, index) => `${medalClass(index)}${manager.isViewer ? ' is-managed' : ''}`} /></article>
    </> : <div className="rankings-empty-state" role="status"><strong>Histórico de treinadores indisponível</strong><span>Este save não preservou estatísticas por treinador nesta temporada. Nenhum valor foi inventado.</span></div>}
  </section>;
}

export function RankingsView({
  players,
  club,
  clubs = [],
  room,
  socket = null,
  managerId = '',
  onRosterChanged = () => undefined,
  onToast = () => undefined,
}: RankingsViewProps) {
  const [saved, setSaved] = useState(() => initialState(room?.code));
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedClub, setSelectedClub] = useState<RankingClub | null>(null);
  const [selectedManager, setSelectedManager] = useState<RankingManager | null>(null);
  const [selectedManagerHistoricalContext, setSelectedManagerHistoricalContext] = useState<{
    seasonNumber: number;
    seasonYear: number | null;
    competitionName: string | null;
  } | null>(null);
  const [compareManagerIds, setCompareManagerIds] = useState<string[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [clubDetailTab, setClubDetailTab] = useState<CompetitionClubTab>('overview');
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [playerSort, setPlayerSort] = useState(() => saved.playerSort);
  const [clubSort, setClubSort] = useState(() => saved.clubSort);
  const [managerSort, setManagerSort] = useState(() => saved.managerSort);
  const returnScrollRef = useRef(saved.scrollY);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousPlayerCategory = useRef(saved.playerCategory);
  const previousClubCategory = useRef(saved.clubCategory);
  const previousManagerCategory = useRef(saved.managerCategory);
  const season = getSeasonProgress(room);
  const remote = useRankings(room?.code, club.id, room?.revision ?? 0, saved.competitionId || null);
  const rankings = remote.rankings;
  const rawPlayers = rankings ? rankings.players : localPlayerRanking(players, club);
  const rawClubs = rankings ? rankings.clubs : localClubRanking(room, club, players);
  const rawManagers = rankings ? rankings.managers : localManagerRanking(room, managerId);
  const profilePlayers = useMemo(() => enrichRankingPlayers(rawPlayers, players), [players, rawPlayers]);
  const competitionName = rankings?.scope.competitionName ?? rankings?.scope.leagueName ?? club.leagueName ?? 'Competição atual';
  const currentRound = rankings?.meta.updatedRound ?? rankings?.meta.completedRounds ?? rankings?.meta.currentRound ?? rankings?.scope.round ?? season.completedRounds;
  const seasonStatus = rankings?.meta.seasonState ?? (room?.careerCompleted ? 'completed' : currentRound > 0 ? 'active' : 'not_started');
  const isArchivedSeason = saved.season !== 'current';
  const selectedSeasonNumber = saved.season === 'current'
    ? Math.max(1, Number(room?.currentSeason) || 1)
    : Math.max(1, Number(saved.season) || 1);
  const managerScope = useMemo(() => isArchivedSeason
    ? rawManagers.flatMap((manager) => {
      const archived = historicalManager(manager, selectedSeasonNumber, saved.competitionId || '');
      return archived ? [archived] : [];
    })
    : rawManagers, [isArchivedSeason, rawManagers, saved.competitionId, selectedSeasonNumber]);

  const playerFilter = ageRange(saved.ageFilter);
  const filteredPlayers = useMemo(() => filterRankingPlayers(profilePlayers, {
    search: saved.search,
    clubId: saved.clubFilter || null,
    nationality: saved.nationalityFilter || null,
    position: saved.positionFilter || null,
    ...playerFilter,
  }), [profilePlayers, saved.ageFilter, saved.clubFilter, saved.nationalityFilter, saved.positionFilter, saved.search]);
  const rankedPlayers = useMemo(() => sortedForTable(
    sortRankingPlayersByCategory(filteredPlayers, saved.playerCategory) as RankingProfilePlayer[],
    playerColumns(saved.playerCategory),
    playerSort,
  ), [filteredPlayers, playerSort, saved.playerCategory]);
  const playerPages = Math.max(1, Math.ceil(rankedPlayers.length / PAGE_SIZE));
  const playerPage = Math.min(saved.playerPage, playerPages);
  const visiblePlayers = rankedPlayers.slice((playerPage - 1) * PAGE_SIZE, playerPage * PAGE_SIZE);

  const searchKey = normalizedKey(saved.search);
  const filteredClubs = useMemo(() => rawClubs.filter((candidate) => !searchKey || normalizedKey(`${candidate.name} ${candidate.code} ${candidate.leagueName}`).includes(searchKey)), [rawClubs, searchKey]);
  const rankedClubs = useMemo(() => sortedForTable(sortClubs(filteredClubs, saved.clubCategory), clubColumns(), clubSort), [clubSort, filteredClubs, saved.clubCategory]);
  const clubPages = Math.max(1, Math.ceil(rankedClubs.length / PAGE_SIZE));
  const clubPage = Math.min(saved.clubPage, clubPages);
  const visibleClubs = rankedClubs.slice((clubPage - 1) * PAGE_SIZE, clubPage * PAGE_SIZE);

  const periodManagers = useMemo(() => managerScope.flatMap((manager) => {
    if (isArchivedSeason) return [manager];
    const periodManager = managerForPeriod(manager, saved.managerPeriod);
    return periodManager ? [periodManager] : [];
  }), [isArchivedSeason, managerScope, saved.managerPeriod]);
  const filteredManagers = useMemo(() => periodManagers.filter((candidate) => {
    if (searchKey && !normalizedKey(`${candidate.name} ${candidate.clubName} ${candidate.nationality}`).includes(searchKey)) return false;
    if (saved.managerTypeFilter !== 'all' && candidate.managerType !== saved.managerTypeFilter) return false;
    if (saved.managerClubFilter && ![candidate.clubId, candidate.clubCode, candidate.clubName].some((value) => normalizedKey(value) === normalizedKey(saved.managerClubFilter))) return false;
    if (saved.managerNationalityFilter && normalizedKey(candidate.nationality) !== normalizedKey(saved.managerNationalityFilter)) return false;
    if (saved.managerStatusFilter && candidate.status !== saved.managerStatusFilter) return false;
    return true;
  }), [periodManagers, saved.managerClubFilter, saved.managerNationalityFilter, saved.managerStatusFilter, saved.managerTypeFilter, searchKey]);
  const rankedManagers = useMemo(() => sortedForTable(sortRankingManagers(filteredManagers, saved.managerCategory), managerColumns(), managerSort), [filteredManagers, managerSort, saved.managerCategory]);
  const managerPages = Math.max(1, Math.ceil(rankedManagers.length / PAGE_SIZE));
  const managerPage = Math.min(saved.managerPage, managerPages);
  const visibleManagers = rankedManagers.slice((managerPage - 1) * PAGE_SIZE, managerPage * PAGE_SIZE);
  const comparedManagers = useMemo(() => compareManagerIds.flatMap((id) => {
    const manager = rankedManagers.find((candidate) => candidate.id === id) ?? managerScope.find((candidate) => candidate.id === id);
    return manager ? [manager] : [];
  }), [compareManagerIds, managerScope, rankedManagers]);

  const playersWithMatchStats = useMemo(() => profilePlayers.filter((player) => (
    player.statisticsAvailable && player.appearances > 0
  )), [profilePlayers]);
  const scorers = useMemo(() => sortRankingPlayersByCategory(playersWithMatchStats, 'goals') as RankingProfilePlayer[], [playersWithMatchStats]);
  const assistants = useMemo(() => sortRankingPlayersByCategory(playersWithMatchStats, 'assists') as RankingProfilePlayer[], [playersWithMatchStats]);
  const contributors = useMemo(() => sortRankingPlayersByCategory(playersWithMatchStats, 'contributions') as RankingProfilePlayer[], [playersWithMatchStats]);
  const ratedPlayers = useMemo(() => sortRankingPlayersByCategory(playersWithMatchStats.filter((player) => player.averageRating !== null), 'rating') as RankingProfilePlayer[], [playersWithMatchStats]);
  const keepers = useMemo(() => playersWithMatchStats.filter((player) => (
    normalizedKey(player.position).includes('gol') && player.saves !== null
  )).sort((left, right) => (right.saves ?? -1) - (left.saves ?? -1) || (right.cleanSheets ?? -1) - (left.cleanSheets ?? -1)), [playersWithMatchStats]);
  const valuableClubs = useMemo(() => sortClubs(rawClubs, 'squadValue'), [rawClubs]);
  const bestManagers = useMemo(() => sortRankingManagers(managerScope, 'rankingPoints'), [managerScope]);
  const bestSeasonManager = useMemo(() => sortRankingManagers(managerScope.filter((manager) => manager.rankingPoints !== null || manager.played > 0), 'rankingPoints')[0] ?? null, [managerScope]);
  const bestHumanManager = useMemo(() => sortRankingManagers(managerScope.filter((manager) => manager.managerType === 'human' && (manager.rankingPoints !== null || manager.played > 0)), 'rankingPoints')[0] ?? null, [managerScope]);
  const bestAIManager = useMemo(() => sortRankingManagers(managerScope.filter((manager) => manager.managerType === 'ai' && (manager.rankingPoints !== null || manager.played > 0)), 'rankingPoints')[0] ?? null, [managerScope]);
  const biggestManagerRise = useMemo(() => [...managerScope].filter((manager) => (manager.positionChange ?? manager.rankChange) !== null).sort((left, right) => (right.positionChange ?? right.rankChange ?? -Infinity) - (left.positionChange ?? left.rankChange ?? -Infinity))[0] ?? null, [managerScope]);
  const bestManagerPerformance = useMemo(() => sortRankingManagers(managerScope.filter((manager) => manager.played > 0), 'performance')[0] ?? null, [managerScope]);
  const mostTitledManager = useMemo(() => sortRankingManagers(managerScope.filter((manager) => (manager.titles ?? 0) > 0), 'titles')[0] ?? null, [managerScope]);
  const bestManagerStreak = useMemo(() => [...managerScope]
    .filter((manager) => consecutiveWins(manager) > 0)
    .sort((left, right) => consecutiveWins(right) - consecutiveWins(left))[0] ?? null, [managerScope]);

  const competitionOptions = useMemo(() => {
    if (rankings?.options.competitions.length) return rankings.options.competitions;
    return (room?.competitionCatalog ?? []).map((league) => ({ id: league.id, label: league.name, count: league.clubs.length }));
  }, [rankings?.options.competitions, room?.competitionCatalog]);
  const seasonOptions = useMemo(() => {
    const current = [{ id: 'current', label: `Temporada ${room?.currentSeason ?? 1} · ${room?.seasonYear ?? season.seasonYear}` }];
    const previous = (room?.seasonHistory ?? []).flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') return [];
      const source = entry as Record<string, unknown>;
      const seasonNumber = Number(source.seasonNumber ?? index + 1);
      const seasonYear = Number(source.seasonYear);
      if (!Number.isFinite(seasonNumber) || seasonNumber === room?.currentSeason) return [];
      return [{ id: String(seasonNumber), label: `Temporada ${seasonNumber}${Number.isFinite(seasonYear) ? ` · ${seasonYear}` : ''}` }];
    });
    return [...current, ...previous];
  }, [room?.currentSeason, room?.seasonHistory, room?.seasonYear, season.seasonYear]);
  const mergedHistory = useMemo(() => {
    const localEntries = localSeasonHistory(room);
    const remoteEntries = rankings?.history ?? [];
    if (!remoteEntries.length) return localEntries;

    const usedLocalEntries = new Set<number>();
    const merged = remoteEntries.map((entry, index) => {
      const localIndex = localEntries.findIndex((candidate, candidateIndex) => {
        if (usedLocalEntries.has(candidateIndex)) return false;
        if (entry.seasonNumber !== null && candidate.seasonNumber === entry.seasonNumber) return true;
        if (entry.seasonYear !== null && candidate.seasonYear === entry.seasonYear) return true;
        return entry.seasonNumber === null && entry.seasonYear === null && candidateIndex === index;
      });
      if (localIndex < 0) return entry;
      usedLocalEntries.add(localIndex);
      const fallback = localEntries[localIndex];
      return {
        ...entry,
        label: entry.label ?? fallback.label,
        seasonNumber: entry.seasonNumber ?? fallback.seasonNumber,
        createdAt: entry.createdAt ?? fallback.createdAt,
        seasonYear: entry.seasonYear ?? fallback.seasonYear,
        completedFixtureCount: entry.completedFixtureCount ?? fallback.completedFixtureCount,
        matchCount: entry.matchCount ?? fallback.matchCount,
      };
    });
    return [
      ...merged,
      ...localEntries.filter((_, index) => !usedLocalEntries.has(index)),
    ].sort((left, right) => (
      (right.seasonNumber ?? -1) - (left.seasonNumber ?? -1)
      || (right.seasonYear ?? -1) - (left.seasonYear ?? -1)
    ));
  }, [rankings?.history, room]);
  const selectedCompetitionKey = normalizedKey(
    saved.competitionId || (saved.season === 'current' ? rankings?.scope.competitionId : ''),
  );
  const controlledClubTimeline = useMemo(() => {
    const timeline = rankings?.timeline ?? [];
    const clubKeys = [club.id, club.code, club.name].map(normalizedKey).filter(Boolean);
    const matchesClub = (entry: RankingTimelineEntry) => [entry.entityId, entry.clubId, entry.clubCode, entry.label]
      .map(normalizedKey)
      .some((key) => Boolean(key && clubKeys.includes(key)));
    const seasonEntries = timeline.filter((entry) => (
      entry.type === 'club'
      && entry.seasonNumber === selectedSeasonNumber
      && matchesClub(entry)
    ));
    const selectedEntriesForCompetition = selectedCompetitionKey
      ? seasonEntries.filter((entry) => normalizedKey(entry.competitionId) === selectedCompetitionKey)
      : seasonEntries;
    const matchingEntries = selectedEntriesForCompetition.length || saved.season === 'current'
      ? selectedEntriesForCompetition
      : seasonEntries;
    const byCompetition = new Map<string, RankingTimelineEntry[]>();
    for (const entry of matchingEntries) {
      const key = normalizedKey(entry.competitionId);
      const entries = byCompetition.get(key) ?? [];
      entries.push(entry);
      byCompetition.set(key, entries);
    }
    const selectedEntries = [...byCompetition.values()].sort((left, right) => (
      right.length - left.length
      || Math.max(...right.map((entry) => entry.round)) - Math.max(...left.map((entry) => entry.round))
    ))[0] ?? [];
    const byRound = new Map(selectedEntries.map((entry) => [entry.round, entry]));
    return [...byRound.values()].sort((left, right) => left.round - right.round);
  }, [club.code, club.id, club.name, rankings?.timeline, saved.season, selectedCompetitionKey, selectedSeasonNumber]);
  const timelineCompetitionName = controlledClubTimeline[0]?.competitionName ?? competitionName;
  const timelineTotalClubs = useMemo(() => {
    const latest = controlledClubTimeline.at(-1);
    if (!latest) return rawClubs.length;
    const competitionKey = normalizedKey(latest.competitionId);
    const clubIds = new Set((rankings?.timeline ?? []).flatMap((entry) => (
      entry.type === 'club'
      && entry.seasonNumber === latest.seasonNumber
      && entry.round === latest.round
      && normalizedKey(entry.competitionId) === competitionKey
        ? [normalizedKey(entry.entityId)]
        : []
    )));
    return Math.max(1, clubIds.size || rawClubs.length);
  }, [controlledClubTimeline, rankings?.timeline, rawClubs.length]);
  const profileHistoryEntries = useMemo<RankingHistoryEntry[]>(() => {
    const latestByEntity = new Map<string, RankingTimelineEntry>();
    for (const entry of rankings?.timeline ?? []) {
      const key = [entry.type, entry.seasonNumber, normalizedKey(entry.competitionId), normalizedKey(entry.entityId)].join(':');
      const previous = latestByEntity.get(key);
      if (!previous || entry.round > previous.round) latestByEntity.set(key, entry);
    }
    const timelineEntries = [...latestByEntity.values()].map((entry): RankingHistoryEntry => ({
      id: `timeline:${entry.id}`,
      type: entry.type,
      label: `${entry.competitionName} · Temporada ${entry.seasonNumber}`,
      seasonNumber: entry.seasonNumber,
      round: entry.round,
      competitionId: entry.competitionId,
      playerId: null,
      clubId: entry.clubId,
      managerId: entry.managerId,
      position: entry.position,
      value: entry.rankingPoints,
      createdAt: null,
      seasonYear: entry.seasonYear,
      completedFixtureCount: null,
      matchCount: null,
    }));
    return [...(rankings?.history ?? []), ...timelineEntries];
  }, [rankings?.history, rankings?.timeline]);
  const selectedClubIdentity = useMemo(() => (
    selectedClub ? rankingClubIdentity(selectedClub, club, clubs, room) : null
  ), [club, clubs, room, selectedClub]);
  const selectedClubMatches = useMemo(() => (
    selectedClubIdentity
      ? buildCompetitionClubMatches(
        room,
        selectedClubIdentity.id,
        rankings?.scope.competitionId ?? saved.competitionId ?? null,
      )
      : []
  ), [rankings?.scope.competitionId, room, saved.competitionId, selectedClubIdentity]);
  const historyFallback = useMemo(() => {
    if (saved.season === 'current') return mergedHistory;
    return mergedHistory.filter((entry) => entry.seasonNumber === selectedSeasonNumber);
  }, [mergedHistory, saved.season, selectedSeasonNumber]);

  const clubFilterOptions = rankings?.options.clubs.length
    ? rankings.options.clubs
    : rawClubs.map((candidate) => ({ id: candidate.id, label: candidate.name, count: candidate.playerCount }));
  const nationalityOptions = rankings?.options.nationalities.length
    ? rankings.options.nationalities
    : [...new Set(profilePlayers.map((player) => player.nationality).filter((value): value is string => Boolean(value)))].sort().map((value) => ({ id: value, label: value, count: null }));
  const positionOptions = rankings?.options.positions.length
    ? rankings.options.positions
    : [...new Set(profilePlayers.map((player) => player.position).filter(Boolean))].sort().map((value) => ({ id: value, label: value, count: null }));
  const managerClubOptions = rankings?.options.managerClubs.length
    ? rankings.options.managerClubs
    : [...new Map(managerScope.filter((manager) => manager.clubId && manager.clubName).map((manager) => [manager.clubId as string, { id: manager.clubId as string, label: manager.clubName as string, count: null }])).values()];
  const managerNationalityOptions = rankings?.options.managerNationalities.length
    ? rankings.options.managerNationalities
    : [...new Set(managerScope.map((manager) => manager.nationality).filter((value): value is string => Boolean(value)))].sort().map((value) => ({ id: value, label: value, count: null }));

  useEffect(() => {
    if (!room?.code || typeof window === 'undefined') return;
    const state = { ...saved, scrollY: selectedClub ? returnScrollRef.current : window.scrollY };
    window.sessionStorage.setItem(`bola-manager:rankings:${room.code}`, JSON.stringify(state));
  }, [room?.code, saved, selectedClub]);

  useEffect(() => {
    if (typeof window === 'undefined' || saved.scrollY <= 0) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY }));
    return () => window.cancelAnimationFrame(frame);
    // Only restore once when the page is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (previousPlayerCategory.current === saved.playerCategory) return;
    previousPlayerCategory.current = saved.playerCategory;
    const nextSort = playerDefaultSort(saved.playerCategory);
    setPlayerSort(nextSort);
    setSaved((current) => ({ ...current, playerPage: 1, playerSort: nextSort }));
  }, [saved.playerCategory]);

  useEffect(() => {
    if (previousClubCategory.current === saved.clubCategory) return;
    previousClubCategory.current = saved.clubCategory;
    const column: Record<ClubCategory, string> = {
      points: 'points', squadValue: 'squadValue', averagePlayerValue: 'averagePlayerValue', payroll: 'payroll',
      reputation: 'reputation', form: 'form', possession: 'possession', attendance: 'attendance',
      wins: 'wins', attack: 'goalsFor', defense: 'goalsAgainst',
    };
    const nextSort = { column: column[saved.clubCategory], direction: (saved.clubCategory === 'defense' ? 'asc' : 'desc') as RankingSortDirection };
    setClubSort(nextSort);
    setSaved((current) => ({ ...current, clubPage: 1, clubSort: nextSort }));
  }, [saved.clubCategory]);

  useEffect(() => {
    if (previousManagerCategory.current === saved.managerCategory) return;
    previousManagerCategory.current = saved.managerCategory;
    const column: Record<ManagerRankingCategory, string> = { points: 'points', wins: 'wins', performance: 'performance', rankingPoints: 'rankingPoints', titles: 'titles', reputation: 'reputation' };
    const nextSort = { column: column[saved.managerCategory], direction: 'desc' as RankingSortDirection };
    setManagerSort(nextSort);
    setSaved((current) => ({ ...current, managerPage: 1, managerSort: nextSort }));
  }, [saved.managerCategory]);

  useEffect(() => {
    setSaved((current) => ({ ...current, playerPage: 1, clubPage: 1, managerPage: 1 }));
  }, [saved.ageFilter, saved.clubFilter, saved.managerClubFilter, saved.managerNationalityFilter, saved.managerPeriod, saved.managerStatusFilter, saved.managerTypeFilter, saved.nationalityFilter, saved.positionFilter, saved.search]);

  useEffect(() => {
    if (saved.historyRound === 'all') return;
    if (controlledClubTimeline.some((entry) => String(entry.round) === saved.historyRound)) return;
    setSaved((current) => ({ ...current, historyRound: 'all' }));
  }, [controlledClubTimeline, saved.historyRound]);

  function updatePlayerSort(sort: { column: string; direction: RankingSortDirection }) {
    setPlayerSort(sort);
    setSaved((current) => ({ ...current, playerSort: sort }));
  }

  function updateClubSort(sort: { column: string; direction: RankingSortDirection }) {
    setClubSort(sort);
    setSaved((current) => ({ ...current, clubSort: sort }));
  }

  function updateManagerSort(sort: { column: string; direction: RankingSortDirection }) {
    setManagerSort(sort);
    setSaved((current) => ({ ...current, managerSort: sort }));
  }

  function toggleManagerComparison(manager: RankingManager) {
    setCompareManagerIds((current) => current.includes(manager.id)
      ? current.filter((id) => id !== manager.id)
      : [...current.slice(-1), manager.id]);
  }

  function openManagerProfile(manager: RankingManager, historical = isArchivedSeason) {
    setSelectedManager(manager);
    setSelectedManagerHistoricalContext(historical ? {
      seasonNumber: selectedSeasonNumber,
      seasonYear: manager.seasonStats.find((entry) => entry.seasonNumber === selectedSeasonNumber)?.seasonYear ?? null,
      competitionName,
    } : null);
  }

  function closeManagerProfile() {
    setSelectedManager(null);
    setSelectedManagerHistoricalContext(null);
  }

  function setTab(tab: RankingsTab) {
    setSaved((current) => ({ ...current, tab }));
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    setTab(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  function openClub(candidate: RankingClub) {
    returnScrollRef.current = window.scrollY;
    setClubDetailTab('overview');
    setSelectedClub(candidate);
    window.scrollTo({ top: 0 });
  }

  function closeClub() {
    setSelectedClub(null);
    window.requestAnimationFrame(() => window.scrollTo({ top: returnScrollRef.current }));
  }

  function openSelectedClubPlayer(playerId: string) {
    setSelectedPlayerId(playerId);
  }

  if (selectedClub && selectedClubIdentity) {
    return <main className="secondary-view rankings-hub view-enter">
      <CompetitionClubPage
        club={selectedClubIdentity}
        managerClubId={club.id}
        roomCode={room?.code}
        currentSeason={room?.currentSeason ?? 1}
        competitionName={competitionName}
        position={selectedClub.position}
        fixtures={selectedClubMatches}
        publicSnapshot={selectedClub}
        historyEntries={profileHistoryEntries}
        activeTab={clubDetailTab}
        onTabChange={setClubDetailTab}
        onPlayerSelect={openSelectedClubPlayer}
        onBack={closeClub}
        originLabel="Rankings"
        backLabel="Voltar aos Rankings"
      />
      <PlayerProfileHost playerId={selectedPlayerId} players={profilePlayers} room={room} socket={socket} managerId={managerId} currentClubId={club.id} onRosterChanged={onRosterChanged} onClose={() => setSelectedPlayerId(null)} onToast={onToast} />
    </main>;
  }

  if (selectedClub) {
    return <main className="secondary-view rankings-hub view-enter">
      <section className="rankings-state">
        <div>
          <CircleHelp size={28} />
          <strong>Clube indisponível</strong>
          <p>Não foi possível preparar os dados deste clube.</p>
          <Button onClick={closeClub}>Voltar aos Rankings</Button>
        </div>
      </section>
    </main>;
  }

  const currentManager = managerScope.find((manager) => manager.isViewer || sameClub(manager.id, managerId));
  const filteredCurrentManager = rankedManagers.find((manager) => manager.isViewer || sameClub(manager.id, managerId));
  const currentManagerOutsidePage = filteredCurrentManager && !visibleManagers.some((manager) => manager.id === filteredCurrentManager.id);
  const selectedSeasonLabel = seasonOptions.find((option) => option.id === saved.season)?.label ?? `Temporada ${season.seasonYear}`;

  return <main className="secondary-view rankings-hub view-enter">
    <header className="rankings-header">
      <div className="rankings-header__copy">
        <p className="eyebrow">CENTRAL DE DESEMPENHO · {competitionName.toUpperCase()}</p>
        <h1>Rankings</h1>
        <p>Acompanhe os principais jogadores, clubes e treinadores da temporada.</p>
      </div>
      <div className="rankings-header__meta">
        <span><CalendarClock size={13} /><strong>{selectedSeasonLabel}</strong></span>
        <span><Activity size={13} /><strong>{currentRound > 0 ? `Atualizado após a rodada ${currentRound}` : 'Competição não iniciada'}</strong></span>
        <span><RefreshCw size={13} className={remote.refreshing ? 'spin' : ''} /><strong>{displayDate(rankings?.meta.updatedAt ?? rankings?.meta.generatedAt)}</strong></span>
      </div>
    </header>

    <section className="rankings-toolbar" aria-label="Escopo dos rankings">
      <label className="rankings-control"><span>Competição</span><select value={saved.competitionId} onChange={(event) => setSaved((current) => ({ ...current, competitionId: event.target.value, historyRound: 'all' }))}><option value="">Competição do meu clube</option>{competitionOptions.map((option) => <option value={option.id} key={option.id}>{option.label}{option.count !== null ? ` · ${option.count}` : ''}</option>)}</select></label>
      <label className="rankings-control"><span>Temporada</span><select value={saved.season} onChange={(event) => setSaved((current) => ({ ...current, season: event.target.value, historyRound: 'all', managerPeriod: 'current', tab: event.target.value === 'current' || current.tab === 'managers' ? current.tab : 'history' }))}>{seasonOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
      <label className="rankings-control rankings-search"><span>Buscar</span><Search size={14} /><input value={saved.search} onChange={(event) => setSaved((current) => ({ ...current, search: event.target.value }))} placeholder="Jogador, clube ou treinador" /></label>
      <Button variant="ghost" icon={<CircleHelp size={15} />} onClick={() => setMethodologyOpen(true)}>Metodologia</Button>
    </section>

    <nav className="rankings-tabs" role="tablist" aria-label="Seções dos rankings">
      {tabs.map((tab, index) => { const Icon = tab.icon; return <button type="button" role="tab" aria-selected={saved.tab === tab.id} tabIndex={saved.tab === tab.id ? 0 : -1} ref={(element) => { tabRefs.current[index] = element; }} onKeyDown={(event) => onTabKeyDown(event, index)} onClick={() => setTab(tab.id)} key={tab.id}><Icon size={14} />{tab.label}</button>; })}
    </nav>

    {remote.loading && !rankings ? <Skeleton /> : isArchivedSeason && saved.tab !== 'history' && saved.tab !== 'managers' ? (
      <section className="rankings-state"><div><History size={28} /><strong>{selectedSeasonLabel}</strong><p>O save preserva o resumo dessa temporada, mas não possui snapshots completos por rodada. Nenhum gráfico ou valor foi inventado.</p><Button onClick={() => setSaved((current) => ({ ...current, season: 'current', tab: 'overview' }))}>Voltar à temporada atual</Button></div></section>
    ) : <section className="rankings-panel" role="tabpanel">
      {remote.error && <div className="rankings-inline-status" role="status"><span>{remote.error}</span><button type="button" onClick={remote.refresh}>Tentar novamente</button></div>}
      {remote.refreshing && <div className="rankings-inline-status" role="status"><RefreshCw size={13} className="spin" /> Atualizando sem ocultar os dados atuais…</div>}
      {(saved.tab === 'overview' || saved.tab === 'players') && <PlayerStatsNotice rankings={rankings} />}

      {saved.tab === 'overview' && <>
        {seasonStatus === 'not_started' && <div className="rankings-inline-status" role="status">A competição ainda não começou. Valores de elenco e níveis atuais já podem ser consultados; estatísticas de partidas aparecerão após a estreia.</div>}
        {seasonStatus === 'completed' && <div className="rankings-inline-status" role="status">Temporada encerrada. Este é o registro final preservado no save.</div>}
        <div className="rankings-highlights">
          <HighlightCard featured label="Artilheiro da temporada" icon={<Target size={16} />} entity={scorers[0] ? <RankingAvatar player={scorers[0]} /> : <span className="rankings-avatar">—</span>} detail={scorers[0]?.name ?? 'Sem dados'} metricValue={scorers[0] ? String(scorers[0].goals) : '—'} metricLabel={scorers[0] ? `${scorers[0].appearances} jogos · gols` : 'Aguardando partidas'} evolution={rankEvolution(scorers[0]?.rankChange)} onClick={scorers[0] ? () => setSelectedPlayerId(scorers[0].id) : undefined} />
          <div className="rankings-highlights__secondary">
            <HighlightCard label="Líder de assistências" icon={<Goal size={14} />} entity={assistants[0] ? <RankingAvatar player={assistants[0]} /> : <span className="rankings-avatar">—</span>} detail={assistants[0]?.name ?? 'Sem dados'} metricValue={assistants[0] ? String(assistants[0].assists) : '—'} metricLabel={assistants[0] ? `${assistants[0].appearances} jogos · assistências` : 'Aguardando partidas'} evolution={rankEvolution(assistants[0]?.rankChange)} onClick={assistants[0] ? () => setSelectedPlayerId(assistants[0].id) : undefined} />
            <HighlightCard label="Melhor jogador" icon={<Crown size={14} />} entity={ratedPlayers[0] ? <RankingAvatar player={ratedPlayers[0]} /> : <span className="rankings-avatar">—</span>} detail={ratedPlayers[0]?.name ?? 'Sem nota média'} metricValue={ratedPlayers[0] ? metric(ratedPlayers[0].averageRating, 2) : '—'} metricLabel={ratedPlayers[0] ? 'nota média registrada' : 'Aguardando notas de partidas'} evolution={rankEvolution(ratedPlayers[0]?.rankChange)} onClick={ratedPlayers[0] ? () => setSelectedPlayerId(ratedPlayers[0].id) : undefined} />
            <HighlightCard label="Melhor goleiro" icon={<Shield size={14} />} entity={keepers[0] ? <RankingAvatar player={keepers[0]} /> : <span className="rankings-avatar">—</span>} detail={keepers[0]?.name ?? 'Sem estatística de goleiro'} metricValue={keepers[0] ? metric(keepers[0].saves) : '—'} metricLabel={keepers[0] ? 'defesas registradas' : 'Aguardando dados de partida'} evolution={rankEvolution(keepers[0]?.rankChange)} onClick={keepers[0] ? () => setSelectedPlayerId(keepers[0].id) : undefined} />
            <HighlightCard label="Clube mais valioso" icon={<WalletCards size={14} />} entity={valuableClubs[0] ? <ClubMark code={valuableClubs[0].code} color={valuableClubs[0].color} darkThemeColor={valuableClubs[0].darkThemeColor} lightThemeColor={valuableClubs[0].lightThemeColor} imageUrl={valuableClubs[0].crestImageUrl} size="sm" /> : <span className="rankings-avatar">—</span>} detail={valuableClubs[0]?.name ?? 'Sem dados'} metricValue={valuableClubs[0] ? formatCurrency(valuableClubs[0].squadValue) : '—'} metricLabel={valuableClubs[0] ? `${valuableClubs[0].playerCount} jogadores` : 'Elenco indisponível'} evolution={valuableClubs[0]?.valueChange === null || valuableClubs[0]?.valueChange === undefined ? undefined : `${signed(valuableClubs[0].valueChange)}% na rodada`} onClick={valuableClubs[0] ? () => openClub(valuableClubs[0]) : undefined} />
            <HighlightCard label="Melhor treinador" icon={<Medal size={14} />} entity={<span className="rankings-avatar">{bestManagers[0] ? managerInitials(bestManagers[0].name) : '—'}</span>} detail={bestManagers[0]?.name ?? 'Sem dados'} metricValue={bestManagers[0] ? `${bestManagers[0].rankingPoints ?? bestManagers[0].points} pts` : '—'} metricLabel={bestManagers[0] ? bestManagers[0].rankingPoints !== null ? 'pontos do ranking' : `${bestManagers[0].played} jogos` : 'Campanha indisponível'} evolution={rankEvolution(bestManagers[0]?.rankChange)} onClick={bestManagers[0] ? () => openManagerProfile(bestManagers[0]) : undefined} />
          </div>
        </div>

        <div className="rankings-overview-grid">
          <article className="rankings-card rankings-card--wide"><header className="rankings-card__header"><div><h2>Artilharia</h2><p>Gols registrados na competição.</p></div><Badge tone="warning">Top 5</Badge></header><RankingTable caption="Resumo da artilharia" columns={playerColumns('goals')} items={scorers.slice(0, 5)} rowKey={(item) => item.id} sort={playerDefaultSort('goals')} onSortChange={() => undefined} onRowClick={(item) => setSelectedPlayerId(item.id)} rowClassName={(item, index) => `${medalClass(index)}${sameClub(item.clubId, club.id) ? ' is-managed' : ''}`} /><footer className="rankings-card__footer"><p>Desempate: gols, minutos por gol, pênaltis, assistências e nota.</p><Button size="sm" variant="ghost" onClick={() => setSaved((current) => ({ ...current, tab: 'players', playerCategory: 'goals' }))}>Ver ranking completo</Button></footer></article>
          <article className="rankings-card"><header className="rankings-card__header"><div><h2>Líderes de assistências</h2><p>Criação registrada na temporada.</p></div><Badge tone="info">Top 5</Badge></header><RankingTable caption="Resumo de assistências" columns={playerColumns('assists')} items={assistants.slice(0, 5)} rowKey={(item) => item.id} sort={playerDefaultSort('assists')} onSortChange={() => undefined} onRowClick={(item) => setSelectedPlayerId(item.id)} rowClassName={(item, index) => `${medalClass(index)}${sameClub(item.clubId, club.id) ? ' is-managed' : ''}`} /><footer className="rankings-card__footer"><p>Traços indisponíveis aparecem como —.</p><Button size="sm" variant="ghost" onClick={() => setSaved((current) => ({ ...current, tab: 'players', playerCategory: 'assists' }))}>Ver ranking completo</Button></footer></article>
          <article className="rankings-card"><header className="rankings-card__header"><div><h2>Participações em gols</h2><p>Gols e assistências combinados.</p></div><Badge tone="positive">Top 5</Badge></header><RankingTable caption="Resumo de participações em gols" columns={playerColumns('contributions')} items={contributors.slice(0, 5)} rowKey={(item) => item.id} sort={playerDefaultSort('contributions')} onSortChange={() => undefined} onRowClick={(item) => setSelectedPlayerId(item.id)} rowClassName={(item, index) => `${medalClass(index)}${sameClub(item.clubId, club.id) ? ' is-managed' : ''}`} /><footer className="rankings-card__footer"><p>Percentual depende de estatística persistida.</p><Button size="sm" variant="ghost" onClick={() => setSaved((current) => ({ ...current, tab: 'players', playerCategory: 'contributions' }))}>Ver ranking completo</Button></footer></article>
          <article className="rankings-card"><header className="rankings-card__header"><div><h2>Clubes mais valiosos</h2><p>Valor real dos jogadores cadastrados.</p></div><Badge tone="info">Top 5</Badge></header><RankingTable caption="Resumo dos clubes mais valiosos" columns={clubColumns()} items={valuableClubs.slice(0, 5)} rowKey={(item) => item.id} sort={{ column: 'squadValue', direction: 'desc' }} onSortChange={() => undefined} onRowClick={(item) => openClub(item)} rowClassName={(_, index) => medalClass(index)} /><footer className="rankings-card__footer"><p>Variação só aparece quando o save preservar rodada anterior.</p><Button size="sm" variant="ghost" onClick={() => setSaved((current) => ({ ...current, tab: 'clubs', clubCategory: 'squadValue' }))}>Ver ranking completo</Button></footer></article>
          <article className="rankings-card"><header className="rankings-card__header"><div><h2>Ranking de treinadores</h2><p>Treinadores jogadores e IA da carreira.</p></div><Badge tone="positive">Top 5</Badge></header><RankingTable caption="Resumo dos treinadores" columns={managerColumns()} items={bestManagers.slice(0, 5)} rowKey={(item) => item.id} sort={{ column: 'rankingPoints', direction: 'desc' }} onSortChange={() => undefined} onRowClick={(item) => openManagerProfile(item)} rowClassName={(item, index) => `${medalClass(index)}${item.isViewer ? ' is-managed' : ''}`} /><footer className="rankings-card__footer"><p>Somente dados preservados no save.</p><Button size="sm" variant="ghost" onClick={() => setSaved((current) => ({ ...current, tab: 'managers' }))}>Ver ranking completo</Button></footer></article>
        </div>
      </>}

      {saved.tab === 'players' && <>
        <CategoryBar label="Categorias de jogadores" items={playerRankingCategories} value={saved.playerCategory} onChange={(playerCategory) => setSaved((current) => ({ ...current, playerCategory }))} />
        <details className="rankings-filters-shell">
          <summary><span>Filtros de jogadores</span><small>Clube, nacionalidade, posição e idade</small><ChevronRight size={16} /></summary>
          <div className="rankings-filters">
            <label className="rankings-control"><span>Clube</span><select value={saved.clubFilter} onChange={(event) => setSaved((current) => ({ ...current, clubFilter: event.target.value }))}><option value="">Todos</option>{clubFilterOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
            <label className="rankings-control"><span>Nacionalidade</span><select value={saved.nationalityFilter} onChange={(event) => setSaved((current) => ({ ...current, nationalityFilter: event.target.value }))}><option value="">Todas</option>{nationalityOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
            <label className="rankings-control"><span>Posição</span><select value={saved.positionFilter} onChange={(event) => setSaved((current) => ({ ...current, positionFilter: event.target.value }))}><option value="">Todas</option>{positionOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
            <label className="rankings-control"><span>Idade</span><select value={saved.ageFilter} onChange={(event) => setSaved((current) => ({ ...current, ageFilter: event.target.value as AgeFilter }))}><option value="all">Todas</option><option value="u21">Sub-21</option><option value="22-25">22–25</option><option value="26-30">26–30</option><option value="31+">31+</option></select></label>
            <label className="rankings-control"><span>Período</span><select value="season" disabled><option value="season">Temporada completa</option><option disabled>Últimos 5 · sem snapshot</option><option disabled>Últimos 10 · sem snapshot</option></select></label>
            <Button size="sm" variant="ghost" onClick={() => setSaved((current) => ({ ...current, clubFilter: '', nationalityFilter: '', positionFilter: '', ageFilter: 'all', search: '' }))}>Limpar filtros</Button>
          </div>
        </details>
        <article className="rankings-card"><header className="rankings-card__header"><div><h2>{playerRankingCategories.find((item) => item.id === saved.playerCategory)?.label}</h2><p>{rankedPlayers.length} jogadores no escopo atual.</p></div><Badge tone="info">Dados da temporada</Badge></header><RankingTable caption={`Ranking de ${saved.playerCategory}`} columns={playerColumns(saved.playerCategory)} items={visiblePlayers} rowKey={(item) => item.id} sort={playerSort} onSortChange={updatePlayerSort} onRowClick={(item) => setSelectedPlayerId(item.id)} rankOffset={(playerPage - 1) * PAGE_SIZE} rowClassName={(item, index) => `${medalClass((playerPage - 1) * PAGE_SIZE + index)}${sameClub(item.clubId, club.id) ? ' is-managed' : ''}`} emptyTitle="Nenhum jogador encontrado" emptyMessage="Ajuste os filtros ou aguarde estatísticas da competição." /><footer className="rankings-card__footer"><p>— significa que a métrica não é registrada pelo save atual.</p><Pagination page={playerPage} total={rankedPlayers.length} onChange={(page) => setSaved((current) => ({ ...current, playerPage: page }))} /></footer></article>
      </>}

      {saved.tab === 'clubs' && <>
        <CategoryBar label="Categorias de clubes" items={clubCategories} value={saved.clubCategory} onChange={(clubCategory) => setSaved((current) => ({ ...current, clubCategory }))} />
        <article className="rankings-card"><header className="rankings-card__header"><div><h2>Ranking de clubes</h2><p>{rankedClubs.length} clubes · {competitionName}</p></div><Badge tone="info">Clique para abrir o clube</Badge></header><RankingTable caption="Ranking completo de clubes" columns={clubColumns()} items={visibleClubs} rowKey={(item) => item.id} sort={clubSort} onSortChange={updateClubSort} onRowClick={(item) => openClub(item)} rankOffset={(clubPage - 1) * PAGE_SIZE} rowClassName={(item, index) => `${medalClass((clubPage - 1) * PAGE_SIZE + index)}${sameClub(item.id, club.id) || sameClub(item.code, club.code) ? ' is-managed' : ''}`} emptyTitle="Nenhum clube encontrado" emptyMessage="A competição selecionada não possui clubes disponíveis." /><footer className="rankings-card__footer"><p>Posse e público aparecem apenas quando registrados pelo motor da competição.</p><Pagination page={clubPage} total={rankedClubs.length} onChange={(page) => setSaved((current) => ({ ...current, clubPage: page }))} /></footer></article>
      </>}

      {saved.tab === 'managers' && <>
        <section className="rankings-manager-overview" aria-label="Visão geral dos treinadores">
          <ManagerSummaryCard label="Melhor treinador da temporada" manager={bestSeasonManager} value={bestSeasonManager?.rankingPoints !== null ? `${bestSeasonManager?.rankingPoints ?? '—'} pts ranking` : `${bestSeasonManager?.points ?? 0} pts`} onClick={bestSeasonManager ? () => openManagerProfile(bestSeasonManager) : undefined} />
          <ManagerSummaryCard label="Melhor treinador jogador" manager={bestHumanManager} value={bestHumanManager?.rankingPoints !== null ? `${bestHumanManager?.rankingPoints ?? '—'} pts ranking` : `${bestHumanManager?.points ?? 0} pts`} onClick={bestHumanManager ? () => openManagerProfile(bestHumanManager) : undefined} />
          <ManagerSummaryCard label="Melhor treinador da IA" manager={bestAIManager} value={bestAIManager?.rankingPoints !== null ? `${bestAIManager?.rankingPoints ?? '—'} pts ranking` : `${bestAIManager?.points ?? 0} pts`} onClick={bestAIManager ? () => openManagerProfile(bestAIManager) : undefined} />
          <ManagerSummaryCard label="Maior evolução no ranking" manager={biggestManagerRise} value={biggestManagerRise ? signed(biggestManagerRise.positionChange ?? biggestManagerRise.rankChange) : '—'} onClick={biggestManagerRise ? () => openManagerProfile(biggestManagerRise) : undefined} />
          <ManagerSummaryCard label="Melhor aproveitamento" manager={bestManagerPerformance} value={bestManagerPerformance ? percentage(bestManagerPerformance.performancePercent) : '—'} onClick={bestManagerPerformance ? () => openManagerProfile(bestManagerPerformance) : undefined} />
          <ManagerSummaryCard label="Mais títulos" manager={mostTitledManager} value={mostTitledManager?.titles === null ? '—' : String(mostTitledManager?.titles ?? 0)} onClick={mostTitledManager ? () => openManagerProfile(mostTitledManager) : undefined} />
          <ManagerSummaryCard label="Melhor sequência atual" manager={bestManagerStreak} value={bestManagerStreak ? `${consecutiveWins(bestManagerStreak)} vitórias` : '—'} onClick={bestManagerStreak ? () => openManagerProfile(bestManagerStreak) : undefined} />
        </section>
        <div className="rankings-manager-type-tabs" role="group" aria-label="Tipo de treinador">
          {([['all', 'Todos'], ['human', 'Jogadores'], ['ai', 'IA']] as const).map(([id, label]) => <button type="button" className={saved.managerTypeFilter === id ? 'is-active' : ''} aria-pressed={saved.managerTypeFilter === id} onClick={() => setSaved((current) => ({ ...current, managerTypeFilter: id }))} key={id}>{label}</button>)}
        </div>
        <CategoryBar label="Categorias de treinadores" items={managerCategories} value={saved.managerCategory} onChange={(managerCategory) => setSaved((current) => ({ ...current, managerCategory }))} />
        <details className="rankings-filters-shell" open>
          <summary><span>Filtros de treinadores</span><small>Clube, nacionalidade, situação e período</small><ChevronRight size={16} /></summary>
          <div className="rankings-filters rankings-manager-filters">
            <label className="rankings-control"><span>Clube</span><select value={saved.managerClubFilter} onChange={(event) => setSaved((current) => ({ ...current, managerClubFilter: event.target.value }))}><option value="">Todos</option>{managerClubOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
            <label className="rankings-control"><span>Nacionalidade</span><select value={saved.managerNationalityFilter} onChange={(event) => setSaved((current) => ({ ...current, managerNationalityFilter: event.target.value }))}><option value="">Todas</option>{managerNationalityOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
            <label className="rankings-control"><span>Situação</span><select value={saved.managerStatusFilter} onChange={(event) => setSaved((current) => ({ ...current, managerStatusFilter: event.target.value as PersistedRankingsState['managerStatusFilter'] }))}><option value="">Todas</option><option value="employed">Empregado</option><option value="unemployed">Sem clube</option><option value="dismissed">Demitido</option></select></label>
            <label className="rankings-control"><span>Período</span><select value={saved.managerPeriod} disabled={isArchivedSeason} onChange={(event) => setSaved((current) => ({ ...current, managerPeriod: event.target.value as RankingManagerPeriod }))}><option value="current">{isArchivedSeason ? 'Temporada selecionada' : 'Temporada atual'}</option><option value="last5">Últimos cinco jogos</option><option value="career">Histórico completo</option></select></label>
            <Button size="sm" variant="ghost" onClick={() => setSaved((current) => ({ ...current, managerTypeFilter: 'all', managerClubFilter: '', managerNationalityFilter: '', managerStatusFilter: '', managerPeriod: 'current', search: '' }))}>Limpar filtros</Button>
          </div>
        </details>
        <article className="rankings-card"><header className="rankings-card__header"><div><h2>Ranking de treinadores</h2><p>{rankedManagers.length} treinadores · {managerPeriodLabel(saved.managerPeriod)} · {competitionName}</p></div><Badge tone="info">Dados reais do save</Badge></header><RankingTable caption="Ranking completo de treinadores" columns={managerColumns(compareManagerIds, toggleManagerComparison)} items={visibleManagers} rowKey={(item) => item.id} sort={managerSort} onSortChange={updateManagerSort} onRowClick={(item) => openManagerProfile(item)} rankOffset={(managerPage - 1) * PAGE_SIZE} rowClassName={(item, index) => `${medalClass((managerPage - 1) * PAGE_SIZE + index)}${item.isViewer || sameClub(item.id, managerId) ? ' is-managed' : ''}`} emptyTitle={saved.managerPeriod !== 'current' ? 'Ainda não existem partidas suficientes para calcular o ranking' : 'Nenhum treinador encontrado'} emptyMessage={saved.managerTypeFilter === 'human' ? 'Nenhum treinador controlado por jogador nesta competição.' : saved.managerTypeFilter === 'ai' ? 'Nenhum treinador da IA encontrado.' : saved.managerPeriod === 'career' ? 'Este save ainda não preserva histórico completo dos treinadores.' : saved.managerPeriod === 'last5' ? 'Não há cinco jogos recentes preservados no snapshot selecionado.' : 'Ajuste os filtros ou selecione outra competição.'} />{currentManagerOutsidePage && filteredCurrentManager && <section className="rankings-own-position"><span>Sua posição</span><button type="button" onClick={() => openManagerProfile(filteredCurrentManager)}><ManagerEntity manager={filteredCurrentManager} rank={filteredCurrentManager.position} /><strong>{filteredCurrentManager.points} pts</strong></button></section>}<footer className="rankings-card__footer"><p>— significa que o dado não foi preservado no save.</p><Pagination page={managerPage} total={rankedManagers.length} onChange={(page) => setSaved((current) => ({ ...current, managerPage: page }))} /></footer></article>
        {compareManagerIds.length > 0 && <aside className="rankings-compare-dock" aria-live="polite"><span><Scale size={16} /><strong>{compareManagerIds.length}/2 treinadores selecionados</strong><small>{comparedManagers.map((manager) => manager.name).join(' × ') || 'Selecione na tabela'}</small></span><div><button type="button" onClick={() => setCompareManagerIds([])}>Limpar</button><Button size="sm" disabled={comparedManagers.length !== 2} onClick={() => setComparisonOpen(true)}>Comparar treinadores</Button></div></aside>}
      </>}

      {saved.tab === 'competitions' && <div className="rankings-competitions-grid">
        {competitionOptions.map((option) => <button type="button" className={`rankings-competition-card${saved.competitionId === option.id ? ' is-active' : ''}`} onClick={() => setSaved((current) => ({ ...current, competitionId: option.id, tab: 'overview' }))} key={option.id}><span><Trophy size={18} /></span><strong>{option.label}</strong><span>{option.count !== null ? `${option.count} clubes` : 'Abrir rankings específicos desta competição'}</span><ChevronRight size={16} /></button>)}
        {!competitionOptions.length && <section className="rankings-state"><div><Trophy size={28} /><strong>Nenhuma competição</strong><p>O save não possui um catálogo ativo para consulta.</p></div></section>}
      </div>}

      {saved.tab === 'history' && <>
        {controlledClubTimeline.length ? <TimelineEvolution
        entries={controlledClubTimeline}
        historyRound={saved.historyRound}
        onRoundChange={(historyRound) => setSaved((current) => ({ ...current, historyRound }))}
        clubName={club.name}
        competitionName={timelineCompetitionName}
        seasonLabel={selectedSeasonLabel}
        totalClubs={timelineTotalClubs}
      /> : <div className="rankings-history-grid">
        {historyFallback.map((entry) => {
          const metrics = historyMetrics(entry);
          return <article className="rankings-history-card" key={entry.id}>
            <span><History size={17} /></span>
            <strong>{entry.label || `Temporada ${entry.seasonNumber ?? '—'}`}</strong>
            <dl>{metrics.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
            <span>{entry.createdAt ? displayDate(entry.createdAt) : entry.round !== null || entry.position !== null || entry.value !== null ? 'Snapshot real preservado' : 'Resumo real do save; ranking por rodada não foi preservado.'}</span>
          </article>;
        })}
        {!historyFallback.length && <section className="rankings-state"><div><History size={28} /><strong>Histórico ainda vazio</strong><p>Snapshots por rodada não existem neste save. A tela não gera gráficos artificiais.</p></div></section>}
        </div>}
        <ManagerHistorySection
          managers={rawManagers}
          seasonNumber={selectedSeasonNumber}
          competitionId={saved.competitionId || rankings?.scope.competitionId || ''}
          onSelect={(manager) => openManagerProfile(manager, true)}
        />
      </>}
    </section>}

    <PlayerProfileHost playerId={selectedPlayerId} players={profilePlayers} room={room} socket={socket} managerId={managerId} currentClubId={club.id} onRosterChanged={onRosterChanged} onClose={() => setSelectedPlayerId(null)} onToast={onToast} />
    <RankingManagerProfile manager={selectedManager} comparisonManager={selectedManager && currentManager && selectedManager.id !== currentManager.id ? currentManager : null} room={room} historyEntries={profileHistoryEntries} currentManagerId={managerId} historicalSeasonNumber={selectedManagerHistoricalContext?.seasonNumber ?? null} historicalSeasonYear={selectedManagerHistoricalContext?.seasonYear ?? null} historicalCompetitionName={selectedManagerHistoricalContext?.competitionName ?? null} onClose={closeManagerProfile} />
    {comparisonOpen && <ManagerComparisonModal managers={comparedManagers} onClose={() => setComparisonOpen(false)} />}
    <Modal open={methodologyOpen} onClose={() => setMethodologyOpen(false)} title="Metodologia dos rankings" eyebrow="DADOS REAIS DO SAVE" size="lg">
      <div className="rankings-methodology">
        <section><h3>Artilharia</h3><ol><li>Mais gols.</li><li>Menos minutos por gol.</li><li>Menos gols de pênalti, quando registrados.</li><li>Mais assistências.</li><li>Maior nota média, quando registrada.</li></ol></section>
        <section><h3>Campanhas</h3><p>Pontos, vitórias, saldo de gols e gols marcados usam somente a competição selecionada. Novas partidas também persistem estatísticas individuais separadas por competição.</p></section>
        <section><h3>Treinadores</h3><p>O ranking usa a pontuação persistida pelo servidor, composta por campanha, dificuldade do elenco, evolução em relação à expectativa, vitórias contra adversários superiores e títulos. Reputação é apenas uma categoria de ordenação e não substitui o desempenho real.</p></section>
        <section><h3>Nota média</h3><p>Cálculo determinístico na escala de 1 a 10, usando gols, assistências, finalizações no alvo, defesas, jogos sem sofrer gol, cartões e minutos. Não há aleatoriedade.</p></section>
        <section><h3>Atualização</h3><p>A API recalcula os rankings após a revisão do save. Durante a atualização, o último snapshot continua visível.</p></section>
        <section><h3>Compatibilidade de saves</h3><ul><li>Save antigo com uma única competição concluída pode usar o total seguro da temporada.</li><li>Save antigo com várias competições e números misturados oculta estatísticas individuais, em vez de atribuí-las ao torneio errado.</li><li>Gols de pênalti, passes decisivos, desarmes, posse, público e reputação aparecem como — quando não persistidos.</li><li>Não há números ou gráficos gerados aleatoriamente.</li></ul></section>
      </div>
    </Modal>
  </main>;
}
