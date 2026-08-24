import { useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BriefcaseBusiness, CalendarDays, ChevronRight, CircleDollarSign, Crosshair, Gauge, Goal, Hammer, HeartPulse, MessageSquareWarning, Newspaper, ShieldCheck, Sparkles, TrendingUp, Users } from 'lucide-react';
import { Badge } from '../components/shared/Badge';
import { ClubMark } from '../components/shared/ClubMark';
import { Panel } from '../components/shared/Panel';
import { ProgressBar } from '../components/shared/ProgressBar';
import { TacticsField } from '../components/tactics/TacticsField';
import type { ServerMatchController } from '../hooks/useServerMatch';
import type {
  ClubChoice,
  ClubFinancialMonthlyAggregate,
  ClubFinancialTransaction,
  OpponentStudy,
  Player,
  Room,
  RoomLineup,
  RouteKey,
} from '../types';
import { average, formatCurrency } from '../utils/formatters';
import { buildSeasonTable, findRoomLeagueForClub } from '../utils/leagueStandings';
import { buildSavedLineup } from '../utils/playerRoster';
import { hasKnownCatalogField, knownPlayerCondition } from '../utils/playerDataAvailability';
import { playerMoraleScore } from '../utils/playerMorale';
import { getSeasonProgress } from '../utils/seasonProgress';
import { previewTeamCohesion } from '../utils/teamCohesion';
import { formationForPlan, tacticPlanForLineup, tacticPlanLabels } from '../utils/teamPlan';

interface HomeViewProps {
  players: Player[];
  savedLineup?: RoomLineup;
  savedLineupIds?: string[];
  opponentStudy?: OpponentStudy | null;
  onNavigate: (route: RouteKey) => void;
  onToast: (message: string) => void;
  club: ClubChoice;
  room: Room | null;
  managerId: string;
  onlineMatch: ServerMatchController | null;
}

interface CentralSection<T> {
  items: T[];
  empty: boolean;
  message: string | null;
}

interface CentralFixtureSnapshot {
  id: string;
  competitionName: string | null;
  stage: string | null;
  round: number | null;
  scheduledAt: string | null;
  homeClubId: string;
  homeClubName: string;
  awayClubId: string;
  awayClubName: string;
  venue: string | null;
}

interface CentralFinanceSnapshot {
  status: 'empty' | 'stable' | 'negative';
  balance: number | null;
  available: number | null;
  income: number | null;
  expense: number | null;
  netCashflow?: number | null;
  message: string | null;
}

interface CentralObjective {
  id?: string;
  title?: string;
  name?: string;
  description?: string;
  detail?: string;
  target?: string;
  progress?: number;
  status?: string;
}

interface CentralNewsItem {
  id: string;
  title?: string;
  summary?: string;
  content?: string;
  category?: string;
  publishedAt?: string;
  occurredAt?: string;
  date?: string;
  clubIds?: string[];
}

interface CentralOperationalItem {
  id?: string;
  type?: string;
  title?: string;
  name?: string;
  message?: string;
  playerName?: string;
  staffName?: string;
  areaId?: string;
  kind?: string;
  remainingDays?: number;
  player?: { name?: string };
}

interface CentralResultItem {
  id: string;
  competitionName?: string | null;
  round?: number | null;
  opponentClubName: string;
  goalsFor: number;
  goalsAgainst: number;
  outcome: 'win' | 'draw' | 'loss';
}

interface CentralSnapshot {
  asOf: string | null;
  nextFixture: CentralFixtureSnapshot | null;
  recentResults: CentralSection<CentralResultItem>;
  finance: CentralFinanceSnapshot;
  squad: {
    total: number;
    available: number;
    averageCondition: number | null;
    averageMorale: number | null;
    injured: unknown[];
    suspended: unknown[];
  };
  expiringContracts: CentralSection<CentralOperationalItem>;
  negotiations: CentralSection<CentralOperationalItem>;
  activeProjects: CentralSection<CentralOperationalItem>;
  messages: CentralSection<CentralOperationalItem>;
  administrativePending: CentralSection<CentralOperationalItem>;
  staffAlerts: CentralSection<CentralOperationalItem>;
  objectives: CentralSection<CentralObjective>;
  latestNews: CentralSection<CentralNewsItem>;
  emptyMessages: { nextFixture: string | null; finance: string | null };
}

type VisibleRoom = Room & { centralSnapshot?: CentralSnapshot };

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readableCentralValue(value: unknown): string | null {
  const text = nonEmptyText(value);
  if (!text) return null;
  const normalized = text.replaceAll('_', ' ').replaceAll('-', ' ').trim();
  return normalized
    ? normalized[0].toLocaleUpperCase('pt-BR') + normalized.slice(1).toLocaleLowerCase('pt-BR')
    : null;
}

function operationalItemLabel(item: CentralOperationalItem): string {
  const direct = nonEmptyText(
    item.message ?? item.title ?? item.name ?? item.playerName ?? item.staffName ?? item.player?.name,
  );
  if (direct) return direct;
  return readableCentralValue(item.areaId ?? item.kind ?? item.type) ?? 'Registro pendente';
}

function normalizedKey(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toLocaleLowerCase('pt-BR')
    : '';
}

function formatKnownCurrency(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatCurrency(value) : 'Não disponível';
}

function newsDateLabel(value: unknown): string {
  const date = new Date(typeof value === 'string' ? value : '');
  if (!Number.isFinite(date.getTime())) return 'Data não registrada';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(date).replace('.', '');
}

function newsDay(value: unknown): string {
  const date = new Date(typeof value === 'string' ? value : '');
  return Number.isFinite(date.getTime()) ? String(date.getDate()).padStart(2, '0') : '—';
}

function financePeriods(
  transactions: ClubFinancialTransaction[],
  aggregates: ClubFinancialMonthlyAggregate[] = [],
) {
  const buckets = new Map<string, { income: number; expense: number }>();
  for (const aggregate of aggregates) {
    const period = nonEmptyText(aggregate.periodKey)?.slice(0, 7);
    if (!period || !/^\d{4}-\d{2}$/.test(period)) continue;
    buckets.set(period, {
      income: Math.max(0, finiteNumber(aggregate.income) ?? 0),
      expense: Math.max(0, finiteNumber(aggregate.expenses) ?? 0),
    });
  }
  if (buckets.size > 0) {
    const periods = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-6);
    const maximum = Math.max(0, ...periods.flatMap(([, values]) => [values.income, values.expense]));
    return periods.map(([period, values]) => ({
      period,
      ...values,
      incomeHeight: maximum ? Math.round((values.income / maximum) * 100) : 0,
      expenseHeight: maximum ? Math.round((values.expense / maximum) * 100) : 0,
    }));
  }
  for (const transaction of transactions) {
    const amount = finiteNumber(transaction.amount);
    const occurredAt = transaction.occurredAt ?? transaction.completedAt;
    const date = new Date(occurredAt ?? '');
    if (amount === null || amount < 0 || !Number.isFinite(date.getTime())) continue;
    const period = transaction.periodKey?.slice(0, 7)
      ?? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const current = buckets.get(period) ?? { income: 0, expense: 0 };
    const direction = (transaction.direction ?? transaction.type ?? '').toLocaleLowerCase('pt-BR');
    if (direction === 'income') current.income += amount;
    if (direction === 'expense') current.expense += amount;
    buckets.set(period, current);
  }
  const periods = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-6);
  const maximum = Math.max(0, ...periods.flatMap(([, values]) => [values.income, values.expense]));
  return periods.map(([period, values]) => ({
    period,
    ...values,
    incomeHeight: maximum ? Math.round((values.income / maximum) * 100) : 0,
    expenseHeight: maximum ? Math.round((values.expense / maximum) * 100) : 0,
  }));
}

function compactTeamCode(teamName: unknown) {
  if (typeof teamName !== 'string') return 'ADV';
  return teamName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

function sameClub(left: unknown, club: ClubChoice) {
  const normalized = typeof left === 'string' ? left.toLocaleUpperCase('pt-BR') : null;
  return normalized === club.id.toLocaleUpperCase('pt-BR') || normalized === club.code.toLocaleUpperCase('pt-BR');
}

function sameFixtureId(left: unknown, right: unknown) {
  return typeof left === 'string'
    && typeof right === 'string'
    && left.toLocaleLowerCase('pt-BR') === right.toLocaleLowerCase('pt-BR');
}

function stadiumLabel(name: unknown, capacity: unknown) {
  const stadiumName = typeof name === 'string' && name.trim() ? name.trim() : 'Estádio a definir';
  const numericCapacity = Number(capacity);
  return Number.isFinite(numericCapacity) && numericCapacity > 0
    ? `${stadiumName} · ${new Intl.NumberFormat('pt-BR').format(Math.trunc(numericCapacity))}`
    : stadiumName;
}

function fixtureKickoff(value: string | null | undefined) {
  const date = new Date(value ?? '');
  if (!Number.isFinite(date.getTime())) {
    return { heading: 'DATA DA PARTIDA A DEFINIR', day: 'AGENDA', time: '--:--', detail: 'horário pendente' };
  }
  const heading = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  }).format(date).toLocaleUpperCase('pt-BR');
  const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
    .format(date).replace('.', '').toLocaleUpperCase('pt-BR');
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return { heading, day, time, detail: 'horário oficial' };
}

function moralePulseCopy(score: number, hasPlayers: boolean) {
  if (!hasPlayers) return { title: 'Elenco ainda não cadastrado', detail: 'Adicione jogadores no Editor da Base.' };
  if (score >= 85) return { title: 'Elenco empolgado', detail: 'A confiança está muito alta dentro do vestiário.' };
  if (score >= 65) return { title: 'Elenco confiante', detail: 'O ambiente está positivo e estável.' };
  if (score >= 45) return { title: 'Moral em atenção', detail: 'As próximas decisões podem mudar o ambiente.' };
  return { title: 'Vestiário sob pressão', detail: 'O grupo precisa de uma resposta positiva.' };
}

export function HomeView({ players, savedLineup, savedLineupIds, opponentStudy, onNavigate, onToast, club, room, managerId, onlineMatch }: HomeViewProps) {
  const [lineupSavePending, setLineupSavePending] = useState(false);
  const tacticPlan = tacticPlanForLineup(savedLineup);
  const activeFormation = formationForPlan(tacticPlan);
  const tacticLabels = tacticPlanLabels(tacticPlan);
  const startingEleven = buildSavedLineup(players, activeFormation, savedLineup?.lineupIds ?? savedLineupIds);
  const cohesionScore = savedLineup?.cohesion?.score ?? previewTeamCohesion(savedLineup, tacticPlan, startingEleven);
  const visibleRoom = room as VisibleRoom | null;
  const central = visibleRoom?.centralSnapshot ?? null;
  const careerState = room?.clubCareerState;
  const localAvailableCount = players.filter((player) => player.status === 'Disponível').length;
  const localInjuredCount = players.filter((player) => player.status === 'Lesionado').length;
  const localSuspendedCount = players.filter((player) => player.status === 'Suspenso').length;
  const squadTotal = central?.squad.total ?? players.length;
  const availableCount = central?.squad.available ?? localAvailableCount;
  const injuredCount = central?.squad.injured.length ?? localInjuredCount;
  const suspendedCount = central?.squad.suspended.length ?? localSuspendedCount;
  const knownConditions = players.flatMap((player) => {
    const condition = knownPlayerCondition(player);
    return condition === null ? [] : [condition];
  });
  const knownMoralePlayers = players.filter((player) => hasKnownCatalogField(player, 'morale'));
  const averageCondition = central?.squad.averageCondition
    ?? (knownConditions.length ? Math.round(average(knownConditions)) : null);
  const averageMorale = central?.squad.averageMorale
    ?? (knownMoralePlayers.length ? Math.round(average(knownMoralePlayers.map(playerMoraleScore))) : null);
  const moralePulse = moralePulseCopy(averageMorale ?? 0, squadTotal > 0);
  const activeTraining = players.find((player) => player.training?.active)?.training;
  const trainingLabel = activeTraining
    ? `Treino ativo: ${activeTraining.focus}`
    : 'Treino não registrado';
  const fixtures = Array.isArray(room?.fixtureSchedule) ? room.fixtureSchedule : [];
  const centralFixture = central?.nextFixture ?? null;
  const activeFixtureId = centralFixture?.id ?? room?.currentFixtureId ?? null;
  const currentFixture = fixtures.find((fixture) => sameFixtureId(fixture?.fixtureId, activeFixtureId));
  const fixtureHomeClubId = currentFixture?.homeClubId ?? centralFixture?.homeClubId ?? club.id;
  const fixtureAwayClubId = currentFixture?.awayClubId ?? centralFixture?.awayClubId ?? '';
  const kickoff = fixtureKickoff(currentFixture?.scheduledAt ?? centralFixture?.scheduledAt);
  const readiness = room && sameFixtureId(room.matchReadiness?.fixtureId, activeFixtureId) ? room.matchReadiness : null;
  const readyManagerIds = Array.isArray(readiness?.managerIds) ? readiness.managerIds : [];
  const readyCount = readyManagerIds.length;
  const fixtureManagerIds = currentFixture?.managerIds?.length
    ? currentFixture.managerIds
    : [currentFixture?.homeManagerId, currentFixture?.awayManagerId].filter((id): id is string => Boolean(id));
  const requiredCount = fixtureManagerIds.length || (onlineMatch ? 1 : 0);
  const managerReady = readyManagerIds.includes(managerId);
  const matchRunning = onlineMatch?.phase === 'running';
  const homeIsManagedClub = sameClub(fixtureHomeClubId, club);
  const awayIsManagedClub = sameClub(fixtureAwayClubId, club);
  const homeName = currentFixture?.homeTeam ?? centralFixture?.homeClubName ?? club.name;
  const awayName = currentFixture?.awayTeam ?? centralFixture?.awayClubName ?? 'Adversário a definir';
  const homeCode = currentFixture?.homeCode || (homeIsManagedClub ? club.code : compactTeamCode(homeName));
  const awayCode = currentFixture?.awayCode || (awayIsManagedClub ? club.code : compactTeamCode(awayName));
  const homeColor = currentFixture?.homeColor || (homeIsManagedClub ? club.color : '#c8ff3d');
  const awayColor = currentFixture?.awayColor || (awayIsManagedClub ? club.color : '#dedede');
  const homeDarkThemeColor = currentFixture?.homeDarkThemeColor ?? (homeIsManagedClub ? club.darkThemeColor : null);
  const homeLightThemeColor = currentFixture?.homeLightThemeColor ?? (homeIsManagedClub ? club.lightThemeColor : null);
  const awayDarkThemeColor = currentFixture?.awayDarkThemeColor ?? (awayIsManagedClub ? club.darkThemeColor : null);
  const awayLightThemeColor = currentFixture?.awayLightThemeColor ?? (awayIsManagedClub ? club.lightThemeColor : null);
  const homeCrestImageUrl = currentFixture?.homeCrestImageUrl ?? (homeIsManagedClub ? club.crestImageUrl : null);
  const awayCrestImageUrl = currentFixture?.awayCrestImageUrl ?? (awayIsManagedClub ? club.crestImageUrl : null);
  const homeStadium = currentFixture?.homeStadium ?? centralFixture?.venue ?? (homeIsManagedClub ? club.stadium : null);
  const homeStadiumCapacity = currentFixture?.homeStadiumCapacity ?? (homeIsManagedClub ? club.stadiumCapacity : 0);
  const roomLeague = findRoomLeagueForClub(room, club);
  const leagueName = roomLeague?.name || club.leagueName || club.division || 'Competição';
  const fixtureCompetitionName = currentFixture?.competition || centralFixture?.competitionName || leagueName;
  const season = getSeasonProgress(room);
  const standings = room ? buildSeasonTable(room, roomLeague?.id ?? club.leagueId) : [];
  const managerName = room?.managers.find((manager) => manager.id === managerId)?.name;
  const clubManagerKeys = new Set([club.id, club.code].map(normalizedKey));
  const controlsClub = (clubId: unknown) => room?.managers.some((manager) => (
    manager.clubId && normalizedKey(manager.clubId) === normalizedKey(clubId)
  )) ?? false;
  const homeController = controlsClub(fixtureHomeClubId) ? 'Controlado por manager' : centralFixture || currentFixture ? 'Controlado pela IA' : 'Clube do manager';
  const awayController = controlsClub(fixtureAwayClubId) ? 'Controlado por manager' : centralFixture || currentFixture ? 'Controlado pela IA' : 'Nenhuma partida agendada';
  const lineupCount = startingEleven.filter(Boolean).length;
  const financialTransactions = careerState?.financialTransactions ?? [];
  const cashflowPeriods = financePeriods(
    financialTransactions,
    careerState?.financialAggregates?.monthly ?? [],
  );
  const transactionIncome = financialTransactions
    .filter((transaction) => (transaction.direction ?? transaction.type) === 'income')
    .reduce((sum, transaction) => sum + Math.max(0, finiteNumber(transaction.amount) ?? 0), 0);
  const transactionExpense = financialTransactions
    .filter((transaction) => (transaction.direction ?? transaction.type) === 'expense')
    .reduce((sum, transaction) => sum + Math.max(0, finiteNumber(transaction.amount) ?? 0), 0);
  const financeIncome = central?.finance.income ?? (financialTransactions.length ? transactionIncome : null);
  const financeExpense = central?.finance.expense ?? (financialTransactions.length ? transactionExpense : null);
  const financeNet = central?.finance.netCashflow
    ?? (financeIncome !== null && financeExpense !== null ? financeIncome - financeExpense : null);
  const objectives = central?.objectives.items.filter((objective) => (
    nonEmptyText(objective.title ?? objective.name)
  )).slice(0, 3) ?? [];
  const recentResults = central?.recentResults.items.slice(0, 3) ?? [];
  const fallbackNews = (careerState?.news ?? []).filter((item) => (
    !item.clubIds?.length || item.clubIds.some((clubId) => clubManagerKeys.has(normalizedKey(clubId)))
  ));
  const clubNews = (central?.latestNews.items.length ? central.latestNews.items : fallbackNews)
    .filter((item) => nonEmptyText(item.title))
    .slice(0, 3);
  const leadNews = clubNews[0] ?? null;
  const leadNewsDate = leadNews?.publishedAt
    ?? (leadNews && 'occurredAt' in leadNews ? leadNews.occurredAt : undefined)
    ?? leadNews?.date;
  const leadNewsCategory = nonEmptyText(leadNews?.category) ?? 'Notícia';
  const operationalSections: Array<{
    key: string;
    title: string;
    section: CentralSection<CentralOperationalItem> | undefined;
    route: RouteKey | null;
    icon: typeof CalendarDays;
  }> = [
    { key: 'contracts', title: 'Contratos vencendo', section: central?.expiringContracts, route: 'squad', icon: CalendarDays },
    { key: 'negotiations', title: 'Negociações ativas', section: central?.negotiations, route: 'market', icon: BriefcaseBusiness },
    { key: 'projects', title: 'Obras em andamento', section: central?.activeProjects, route: 'stadium', icon: Hammer },
    { key: 'staff', title: 'Alertas da comissão', section: central?.staffAlerts, route: 'staff', icon: Users },
    { key: 'administrative', title: 'Pendências administrativas', section: central?.administrativePending, route: 'finance', icon: AlertTriangle },
    { key: 'messages', title: 'Mensagens da diretoria', section: central?.messages, route: null, icon: MessageSquareWarning },
  ];

  const readinessLabel = !onlineMatch
    ? 'Ir para a partida'
    : matchRunning
      ? 'Assistir partida'
      : lineupSavePending
        ? 'Salvando escalação…'
      : onlineMatch.readyPending
        ? 'Confirmando…'
        : room?.scheduleIssue
          ? 'Calendário indisponível'
        : !activeFixtureId
          ? 'Temporada concluída'
          : managerReady
            ? 'Cancelar pronto'
            : 'Estou pronto';

  async function handleMatchAction() {
    if (!onlineMatch || matchRunning) {
      onNavigate('match');
      return;
    }
    const ready = !managerReady;
    try {
      if (ready) {
        const lineupIds = startingEleven.flatMap((player) => player ? [player.id] : []).slice(0, 11);
        setLineupSavePending(true);
        await onlineMatch.saveLineup(lineupIds, tacticPlan);
        setLineupSavePending(false);
      }
      await onlineMatch.setReady(ready);
    } catch (nextError: unknown) {
      onToast(nextError instanceof Error ? nextError.message : 'Não foi possível confirmar sua prontidão.');
    } finally {
      setLineupSavePending(false);
    }
  }

  return (
    <main className="dashboard view-enter">
      <div className="dashboard-heading">
        <div><p className="eyebrow">{kickoff.heading}</p><h1>{managerName ? `Bom jogo, ${managerName}.` : 'Central do clube'}</h1><p>{centralFixture || currentFixture ? `${homeName} × ${awayName}` : (central?.emptyMessages.nextFixture ?? 'Nenhuma partida agendada')}</p></div>
        <div className="dashboard-actions">
          <button onClick={() => onNavigate('calendar')}><CalendarDays size={15} /> Ver agenda</button>
          <button className="accent" onClick={() => void handleMatchAction()} disabled={lineupSavePending || Boolean(onlineMatch?.readyPending) || (Boolean(onlineMatch) && !activeFixtureId)}><Goal size={15} /> {readinessLabel}</button>
        </div>
      </div>

      {room?.scheduleIssue && <p className="form-error" role="alert">{room.scheduleIssue.message}. Adicione outro time à mesma liga e abra este save novamente.</p>}

      <div className="dashboard-grid">
        <section className="fixture-command">
          <div className="fixture-command__meta">
            <Badge tone="neutral">{fixtureCompetitionName} · {(currentFixture?.stage ?? centralFixture?.stage) ? (currentFixture?.stage ?? centralFixture?.stage)?.toLocaleUpperCase('pt-BR') : `RODADA ${currentFixture?.round ?? centralFixture?.round ?? season.currentRound}`}</Badge>
            {onlineMatch && requiredCount > 0 && <Badge tone={managerReady ? 'positive' : 'warning'}>{readyCount}/{requiredCount} MANAGERS PRONTOS</Badge>}
            <span>{stadiumLabel(homeStadium, homeStadiumCapacity)}</span>
          </div>
          <div className="fixture-command__teams">
            <div className="fixture-team fixture-team--home"><ClubMark code={homeCode} color={homeColor} darkThemeColor={homeDarkThemeColor} lightThemeColor={homeLightThemeColor} imageUrl={homeCrestImageUrl} size="xl" /><div><strong>{homeName}</strong><span>{homeController}</span></div></div>
            <div className="fixture-kickoff"><small>{kickoff.day}</small><strong>{kickoff.time}</strong><span>{kickoff.detail}</span></div>
            <div className="fixture-team fixture-team--away"><ClubMark code={awayCode} color={awayColor} darkThemeColor={awayDarkThemeColor} lightThemeColor={awayLightThemeColor} imageUrl={awayCrestImageUrl} size="xl" /><div><strong>{awayName}</strong><span>{awayController}</span></div></div>
          </div>
          <div className="fixture-command__intel">
            <div><span className="intel-icon"><Crosshair size={15} /></span><span><small>CHAVE DO JOGO</small><strong>{opponentStudy?.recommendations[0]?.detail ?? 'Estudo do adversário ainda não disponível'}</strong></span></div>
            <div><span className="intel-icon"><ShieldCheck size={15} /></span><span><small>{onlineMatch ? 'PRONTIDÃO DA SALA' : 'ESCALAÇÃO'}</small><strong>{onlineMatch ? `${readyCount} de ${requiredCount} managers confirmados` : `${lineupCount} de 11 titulares definidos`}</strong></span></div>
            <button onClick={() => onNavigate('tactics')}>Revisar plano <ArrowRight size={15} /></button>
          </div>
        </section>

        <Panel title="Classificação" eyebrow={season.completedRounds ? `${leagueName} · APÓS ${season.completedRounds} ${season.completedRounds === 1 ? 'RODADA' : 'RODADAS'}` : `${leagueName} · INÍCIO DA TEMPORADA`} action="Tabela completa" onAction={() => onNavigate('competitions')} className="table-panel">
          <div className="mini-table">
            <div className="mini-table__head"><span>#</span><span>CLUBE</span><span>J</span><span>SG</span><span>PTS</span></div>
            {standings.slice(0, 6).map((team) => (
              <div key={team.clubId ?? team.code} className={sameClub(team.clubId ?? team.code, club) ? 'highlight' : ''}>
                <span>{team.position}</span><span><i style={{ background: team.accent }} />{team.name}</span><span>{team.played}</span><span>{team.goalDifference > 0 ? '+' : ''}{team.goalDifference}</span><strong>{team.points}</strong>
              </div>
            ))}
            {!standings.length && <div><span>—</span><span>Classificação ainda não disponível</span><span>—</span><span>—</span><strong>—</strong></div>}
          </div>
          <div className="position-gap"><span><TrendingUp size={14} /> {standings.length ? (season.completedRounds ? `${season.completedRounds} ${season.completedRounds === 1 ? 'rodada concluída' : 'rodadas concluídas'}` : 'Tabela zerada para a estreia') : 'Aguardando dados da competição'}</span>{standings.length > 0 && <span>Rodada {season.currentRound}</span>}</div>
          <div className="recent-results-mini">
            <header><strong>Últimos resultados</strong><span>{recentResults.length || '—'}</span></header>
            {recentResults.map((result) => (
              <div key={result.id}>
                <Badge tone={result.outcome === 'win' ? 'positive' : result.outcome === 'loss' ? 'danger' : 'warning'}>
                  {result.outcome === 'win' ? 'V' : result.outcome === 'loss' ? 'D' : 'E'}
                </Badge>
                <span><strong>{result.opponentClubName}</strong><small>{result.competitionName ?? leagueName}{result.round ? ` · R${result.round}` : ''}</small></span>
                <strong>{result.goalsFor} – {result.goalsAgainst}</strong>
              </div>
            ))}
            {!recentResults.length && <p>{central?.recentResults
              ? central.recentResults.message ?? 'Nenhum resultado registrado.'
              : 'Histórico de resultados ainda não carregado.'}</p>}
          </div>
        </Panel>

        <Panel title="Plano de jogo" eyebrow={`${activeFormation.name} · ${tacticLabels.pressure.toLocaleUpperCase('pt-BR')}`} action="Editar" onAction={() => onNavigate('tactics')} className="tactic-snapshot">
          <TacticsField formation={activeFormation} lineup={startingEleven} compact />
          <div className="tactic-tags"><span><Gauge size={13} /> Ritmo {tacticLabels.tempo.toLocaleLowerCase('pt-BR')}</span><span><Crosshair size={13} /> {tacticLabels.transition}</span><span><Sparkles size={13} /> Mentalidade {tacticLabels.mentality.toLocaleLowerCase('pt-BR')}</span><span><ShieldCheck size={13} /> Entrosamento {cohesionScore}%</span></div>
        </Panel>

        <Panel title="Pulso do elenco" eyebrow="MORAL E DISPONIBILIDADE" action="Ver elenco" onAction={() => onNavigate('squad')} className="squad-pulse">
          <div className="pulse-hero"><div className="pulse-score"><strong>{averageMorale ?? '—'}</strong><span>{averageMorale === null ? '' : '/100'}</span></div><div><strong>{moralePulse.title}</strong><p>{moralePulse.detail}</p></div></div>
          <div className="pulse-stats">
            <div><span><Users size={14} /> Disponíveis</span><strong>{availableCount}<small>/{squadTotal}</small></strong><ProgressBar value={squadTotal ? (availableCount / squadTotal) * 100 : 0} /></div>
            <div><span><HeartPulse size={14} /> Condição média</span><strong>{averageCondition ?? '—'}<small>{averageCondition === null ? '' : '%'}</small></strong><ProgressBar value={averageCondition ?? 0} tone="info" /></div>
          </div>
          <div className="availability-row"><Badge tone="danger" dot>{injuredCount} lesionado{injuredCount === 1 ? '' : 's'}</Badge><Badge tone="warning" dot>{suspendedCount} suspenso{suspendedCount === 1 ? '' : 's'}</Badge><span>{trainingLabel}</span></div>
        </Panel>

        <Panel title="Financeiro" eyebrow="DADOS PERSISTIDOS" action="Detalhes" onAction={() => onNavigate('finance')} className="finance-pulse">
          <div className="finance-total"><span><small>SALDO OPERACIONAL</small><strong>{formatKnownCurrency(central?.finance.balance)}</strong></span>{financeNet !== null && <span className={`trend${financeNet >= 0 ? ' positive' : ''}`}>{financeNet >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{formatCurrency(Math.abs(financeNet))}</span>}</div>
          <div className="cashflow-chart" aria-label="Receitas e despesas registradas">
            {cashflowPeriods.map((period) => <span key={period.period} title={period.period} style={{ height: '100%', background: 'transparent' }}><b aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, width: '42%', height: `${period.incomeHeight}%`, background: 'var(--accent)' }} /><i style={{ height: `${period.expenseHeight}%` }} /></span>)}
            {!cashflowPeriods.length && <small>Sem movimentações financeiras registradas.</small>}
          </div>
          <div className="finance-legend"><span><i /> Receita <strong>{formatKnownCurrency(financeIncome)}</strong></span><span><i /> Despesa <strong>{formatKnownCurrency(financeExpense)}</strong></span></div>
        </Panel>

        <Panel title="Diretoria" eyebrow="OBJETIVOS DA TEMPORADA" className="objectives-panel">
          {objectives.map((objective, index) => {
            const title = nonEmptyText(objective.title ?? objective.name)!;
            const detail = nonEmptyText(objective.description ?? objective.detail ?? objective.target);
            const progress = finiteNumber(objective.progress);
            const status = nonEmptyText(objective.status);
            return <div className="objective-row" key={objective.id ?? `${title}:${index}`}><span className={`objective-icon${index === 0 ? ' positive' : index === 2 ? ' warning' : ''}`}>{index === 0 ? <ShieldCheck size={15} /> : index === 1 ? <CircleDollarSign size={15} /> : <ArrowDownRight size={15} />}</span><span><strong>{title}</strong>{detail && <small>{detail}</small>}</span>{status ? <Badge tone="neutral">{status}</Badge> : progress !== null ? <strong>{Math.round(progress)}%</strong> : null}</div>;
          })}
          {!objectives.length && <div className="objective-row"><span className="objective-icon"><ShieldCheck size={15} /></span><span><strong>{central?.objectives
            ? central.objectives.message ?? 'Nenhum objetivo cadastrado'
            : 'Objetivos ainda não carregados'}</strong></span></div>}
        </Panel>

        <Panel title="Sala de imprensa" eyebrow="RADAR DO CLUBE" action="Ver feed" onAction={() => onNavigate('news')} className="newsroom-panel">
          {leadNews ? <article className="lead-news">
            <div className="lead-news__visual"><span>{leadNewsCategory.toLocaleUpperCase('pt-BR')}</span><i>{newsDay(leadNewsDate)}</i></div>
            <div><Badge tone="info">{leadNewsCategory}</Badge><h3>{leadNews.title}</h3><p>{leadNews.summary ?? leadNews.content ?? 'Conteúdo não registrado.'}</p><span><Newspaper size={13} /> {newsDateLabel(leadNewsDate)}</span></div>
          </article> : <article className="lead-news"><div className="lead-news__visual"><span>SEM NOTÍCIAS</span><i>—</i></div><div><Badge tone="neutral">Feed</Badge><h3>{central?.latestNews.message ?? 'Nenhuma notícia da carreira'}</h3><p>Os fatos da temporada aparecerão aqui quando forem registrados.</p></div></article>}
          <div className="news-headlines">
            {clubNews.slice(1, 3).map((item) => <button key={item.id} onClick={() => onNavigate('news')}><span>{item.category ?? 'Notícia'}</span><strong>{item.title}</strong><ChevronRight size={14} /></button>)}
          </div>
        </Panel>

        <Panel title="Pendências do clube" eyebrow="DADOS FACTUAIS DA CARREIRA" className="central-operations-panel">
          <div className="central-operations-grid">
            {operationalSections.map(({ key, title, section, route, icon: Icon }) => {
              const count = section?.items.length ?? 0;
              const firstItem = section?.items[0];
              const description = firstItem
                ? operationalItemLabel(firstItem)
                : section
                  ? section.message ?? 'Nenhum registro pendente.'
                  : 'Dados ainda não carregados.';
              return (
                <button
                  key={key}
                  className="central-operation-row"
                  type="button"
                  disabled={!route}
                  onClick={() => route && onNavigate(route)}
                >
                  <span className="central-operation-row__icon"><Icon size={15} /></span>
                  <span><strong>{title}</strong><small>{description}</small></span>
                  <Badge tone={!section ? 'neutral' : count > 0 ? 'warning' : 'positive'}>{!section ? '—' : count > 0 ? count : 'OK'}</Badge>
                  {route && <ChevronRight size={14} />}
                </button>
              );
            })}
          </div>
        </Panel>
      </div>
    </main>
  );
}
