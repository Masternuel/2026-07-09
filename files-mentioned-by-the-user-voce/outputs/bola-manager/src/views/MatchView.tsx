import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Clock3,
  FastForward,
  Flag,
  Goal,
  Pause,
  Play,
  Shield,
  SlidersHorizontal,
  Sparkles,
  SquareDashedBottom,
  Users,
} from 'lucide-react';
import { MatchFeed } from '../components/match/MatchFeed';
import { MatchScore } from '../components/match/MatchScore';
import { RoundResultsPanel } from '../components/match/RoundResultsPanel';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { Modal } from '../components/shared/Modal';
import { ProgressBar } from '../components/shared/ProgressBar';
import { matchEvents } from '../data/demoData';
import type { ServerMatchController } from '../hooks/useServerMatch';
import { knownPlayerCondition, playerShirtNumberLabel } from '../utils/playerDataAvailability';
import { buildAvailableLineupIds, isPlayerAvailableForLineup } from '../utils/playerRoster';
import { persistedTacticPlanForLineup, tacticPlanLabels } from '../utils/teamPlan';
import type {
  ClubChoice,
  HalftimeInstruction,
  HalftimeMentality,
  HalftimeTactics,
  MatchEvent,
  MatchSpeed,
  OpponentStudy,
  Player,
  Room,
  RoomLineup,
  RouteKey,
} from '../types';

interface MatchViewProps {
  players?: Player[];
  onToast: (message: string) => void;
  onNavigate: (route: RouteKey) => void;
  onlineMatch: ServerMatchController | null;
  room: Room | null;
  club: ClubChoice;
  managerId?: string;
  savedLineup?: RoomLineup;
  savedLineupIds?: string[];
  opponentStudy?: OpponentStudy | null;
  demoMode?: boolean;
}

interface MatchStatisticRow {
  label: string;
  home: string;
  away: string;
  homeWidth: number;
}

const mentalityOptions: Array<{ value: HalftimeMentality; label: string }> = [
  { value: 'cautious', label: 'Cautelosa' },
  { value: 'balanced', label: 'Equilibrada' },
  { value: 'positive', label: 'Positiva' },
  { value: 'attacking', label: 'Ofensiva' },
];

const instructionOptions: Array<{ value: HalftimeInstruction; label: string }> = [
  { value: 'keep-plan', label: 'Manter plano atual' },
  { value: 'exploit-right', label: 'Explorar lado direito' },
  { value: 'keep-possession', label: 'Manter a posse' },
  { value: 'high-line', label: 'Adiantar linhas' },
  { value: 'slow-tempo', label: 'Baixar o ritmo' },
];

function substitutionPlayerLabel(player: Player) {
  const condition = knownPlayerCondition(player);
  return `${playerShirtNumberLabel(player)} · ${player.name}${player.isStar ? ' ★' : ''} (${condition === null ? 'condição —' : `${condition}%`})`;
}

const matchSpeedOptions: Array<{ value: MatchSpeed; label: string }> = [
  { value: 0.5, label: 'x0,5' },
  { value: 1, label: 'x1' },
  { value: 2, label: 'x2' },
  { value: 3, label: 'x3' },
];

function matchSpeedLabel(speed: MatchSpeed): string {
  return matchSpeedOptions.find((option) => option.value === speed)?.label ?? `x${speed}`;
}

function shortTeamCode(teamName: string, fallback: string): string {
  const normalized = teamName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '');
  return normalized.slice(0, 3).toLocaleUpperCase('pt-BR') || fallback;
}

function sameFixtureId(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLocaleLowerCase('pt-BR') === right.toLocaleLowerCase('pt-BR'));
}

function roundLabel(fixtureId: string | null, round?: number): string {
  if (typeof round === 'number' && Number.isFinite(round) && round > 0) return `Rodada ${Math.trunc(round)}`;
  if (fixtureId === 'copa-ida') return 'Jogo de ida';
  const numberedRound = fixtureId?.match(/^rodada-(\d+)$/)?.[1];
  return numberedRound ? `Rodada ${numberedRound}` : 'Rodada a definir';
}

function countLineupChanges(initialLineupIds: readonly string[], lineupIds: readonly string[]): number {
  const currentIds = new Set(lineupIds);
  return initialLineupIds.filter((id) => !currentIds.has(id)).length;
}

function optionLabel<T extends string>(options: Array<{ value: T; label: string }>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function finiteValue(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function authoritativeStatistic(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function statisticRow(
  label: string,
  homeValue: unknown,
  awayValue: unknown,
  suffix = '',
): MatchStatisticRow | null {
  const home = authoritativeStatistic(homeValue);
  const away = authoritativeStatistic(awayValue);
  if (home === null || away === null) return null;
  const total = home + away;
  return {
    label,
    home: `${home}${suffix}`,
    away: `${away}${suffix}`,
    homeWidth: total > 0 ? Math.min(100, Math.max(0, (home / total) * 100)) : 50,
  };
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function scoreTuple(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  return [finiteValue(value[0], fallback[0]), finiteValue(value[1], fallback[1])];
}

function safeMentality(value: unknown): HalftimeMentality {
  return mentalityOptions.some((option) => option.value === value)
    ? value as HalftimeMentality
    : 'balanced';
}

function safeInstruction(value: unknown): HalftimeInstruction {
  return instructionOptions.some((option) => option.value === value)
    ? value as HalftimeInstruction
    : 'keep-plan';
}

export function MatchView({
  players = [],
  onToast,
  onNavigate,
  onlineMatch,
  room,
  club,
  managerId = '',
  savedLineup,
  savedLineupIds,
  opponentStudy,
  demoMode = false,
}: MatchViewProps) {
  const [eventCount, setEventCount] = useState(2);
  const [running, setRunning] = useState(true);
  const [subOpen, setSubOpen] = useState(false);
  const [tacticOpen, setTacticOpen] = useState(false);
  const [outPlayer, setOutPlayer] = useState('');
  const [inPlayer, setInPlayer] = useState('');
  const [mentality, setMentality] = useState<HalftimeMentality>(() => safeMentality(savedLineup?.tactics?.mentality));
  const [instruction, setInstruction] = useState<HalftimeInstruction>('keep-plan');
  const [extraEvents, setExtraEvents] = useState<MatchEvent[]>([]);
  const [substitutionCount, setSubstitutionCount] = useState(0);
  const [halftimeLineupIds, setHalftimeLineupIds] = useState<string[]>([]);

  const fixtureIdCandidate = onlineMatch
    ? onlineMatch.result?.fixtureId ?? onlineMatch.match?.fixtureId ?? null
    : room?.currentFixtureId ?? null;
  const fixtureId = typeof fixtureIdCandidate === 'string' ? fixtureIdCandidate : null;
  const roomFixtures = Array.isArray(room?.fixtureSchedule) ? room.fixtureSchedule : [];
  const fixture = fixtureId
    ? roomFixtures.find((candidate) => sameFixtureId(candidate.fixtureId, fixtureId))
    : undefined;
  const matchDescriptor = onlineMatch?.result ?? onlineMatch?.match;
  const homeTeam = nonEmptyString(matchDescriptor?.homeTeam, nonEmptyString(fixture?.homeTeam, 'Mandante'));
  const awayTeam = nonEmptyString(matchDescriptor?.awayTeam, nonEmptyString(fixture?.awayTeam, 'Visitante'));
  const clubIds = [club.id, club.code].map((identifier) => identifier.toLocaleUpperCase('pt-BR'));
  const homeIsManagedClub = clubIds.includes(fixture?.homeClubId?.toLocaleUpperCase('pt-BR') ?? '') || homeTeam === club.name;
  const awayIsManagedClub = clubIds.includes(fixture?.awayClubId?.toLocaleUpperCase('pt-BR') ?? '') || awayTeam === club.name;
  const managedClubInFixture = homeIsManagedClub || awayIsManagedClub;
  const homeCode = fixture?.homeCode || (homeIsManagedClub ? club.code : shortTeamCode(homeTeam, 'MAN'));
  const awayCode = fixture?.awayCode || (awayIsManagedClub ? club.code : shortTeamCode(awayTeam, 'VIS'));
  const homeColor = fixture?.homeColor || (homeIsManagedClub ? club.color : '#9ba3ad');
  const awayColor = fixture?.awayColor || (awayIsManagedClub ? club.color : '#dedede');
  const homeDarkThemeColor = fixture?.homeDarkThemeColor ?? (homeIsManagedClub ? club.darkThemeColor : null);
  const homeLightThemeColor = fixture?.homeLightThemeColor ?? (homeIsManagedClub ? club.lightThemeColor : null);
  const awayDarkThemeColor = fixture?.awayDarkThemeColor ?? (awayIsManagedClub ? club.darkThemeColor : null);
  const awayLightThemeColor = fixture?.awayLightThemeColor ?? (awayIsManagedClub ? club.lightThemeColor : null);
  const homeCrestImageUrl = fixture?.homeCrestImageUrl ?? (homeIsManagedClub ? club.crestImageUrl : null);
  const awayCrestImageUrl = fixture?.awayCrestImageUrl ?? (awayIsManagedClub ? club.crestImageUrl : null);
  const stadium = fixture?.homeStadium ?? (homeIsManagedClub ? club.stadium : null);
  const stadiumCapacity = fixture?.homeStadiumCapacity ?? (homeIsManagedClub ? club.stadiumCapacity : 0);
  const competition = nonEmptyString(fixture?.competition, 'Competição a definir');
  const matchRoundLabel = roundLabel(fixtureId, fixture?.round);
  const opponentClubId = homeIsManagedClub ? fixture?.awayClubId : fixture?.homeClubId;
  const opponentPreview = (room?.tacticPreviews ?? []).find((preview) => (
    typeof opponentClubId === 'string'
    && preview.clubId.toLocaleUpperCase('pt-BR') === opponentClubId.toLocaleUpperCase('pt-BR')
  ));
  const fixtureStudy = opponentStudy && sameFixtureId(opponentStudy.fixtureId, fixtureId)
    ? opponentStudy
    : null;
  const managedTacticPlan = persistedTacticPlanForLineup(savedLineup);
  const managedFormation = managedTacticPlan?.formationId ?? 'A confirmar';
  const managedTacticLabels = managedTacticPlan ? tacticPlanLabels(managedTacticPlan) : null;
  const opponentFormation = opponentPreview?.formationId ?? fixtureStudy?.probableFormation ?? 'A confirmar';
  const homeFormation = matchDescriptor?.homeFormation
    ?? (homeIsManagedClub ? managedFormation : opponentFormation);
  const awayFormation = matchDescriptor?.awayFormation
    ?? (awayIsManagedClub ? managedFormation : opponentFormation);
  const roundSummary = onlineMatch?.result?.roundSummary ?? (onlineMatch ? room?.lastCompletedRound : null);

  const initialLineupIds = useMemo(
    () => buildAvailableLineupIds(players, savedLineup?.lineupIds ?? savedLineupIds),
    [players, savedLineup?.lineupIds, savedLineupIds],
  );
  const initialLineupKey = initialLineupIds.join('|');
  const activeLineupIds = halftimeLineupIds.length ? halftimeLineupIds : initialLineupIds;
  const activeLineupKey = activeLineupIds.join('|');
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const starterPlayers = activeLineupIds.flatMap((id) => {
    const player = playersById.get(id);
    return player ? [player] : [];
  });
  const activeLineupSet = new Set(activeLineupIds);
  const reservePlayers = players.filter((player) => isPlayerAvailableForLineup(player) && !activeLineupSet.has(player.id));

  const localFinished = demoMode && eventCount >= matchEvents.length;
  const localRevealed = useMemo(
    () => demoMode ? [...matchEvents.slice(0, eventCount), ...extraEvents].sort((a, b) => a.minute - b.minute) : [],
    [demoMode, eventCount, extraEvents],
  );
  const finished = onlineMatch ? onlineMatch.phase === 'finished' : localFinished;
  const revealed = onlineMatch
    ? (Array.isArray(onlineMatch.events) ? onlineMatch.events : [])
    : localRevealed;
  const currentMinute = revealed.at(-1)?.minute ?? 0;
  const revealedScore = revealed.reduce<[number, number]>((latest, event) => (
    Array.isArray(event?.score) ? scoreTuple(event.score, latest) : latest
  ), [0, 0]);
  const score = scoreTuple(onlineMatch?.score, revealedScore);
  const progress = Math.min(100, currentMinute / 0.9);
  const isHalftime = onlineMatch?.phase === 'halftime';
  const activeMatchSpeed = onlineMatch?.speed?.rate ?? 1;
  const activeMatchSpeedLabel = matchSpeedLabel(activeMatchSpeed);
  const isRoomOwner = Boolean(managerId && room?.ownerId === managerId);
  const canControlMatchSpeed = Boolean(
    onlineMatch
    && isRoomOwner
    && onlineMatch.connected
    && (onlineMatch.phase === 'running' || onlineMatch.phase === 'halftime')
    && onlineMatch.speedPending === null,
  );
  const halftime = onlineMatch?.halftime ?? null;
  const requiredManagerIds = Array.isArray(halftime?.requiredManagerIds)
    ? stringArray(halftime.requiredManagerIds)
    : stringArray(fixture?.managerIds);
  const readyManagerIds = stringArray(halftime?.readyManagerIds);
  const roomManagers = Array.isArray(room?.managers) ? room.managers : [];
  const halftimeReadyCount = Math.max(0, Math.trunc(finiteValue(halftime?.readyCount, readyManagerIds.length)));
  const halftimeRequiredCount = Math.max(0, Math.trunc(finiteValue(halftime?.requiredCount, requiredManagerIds.length)));
  const isHalftimeParticipant = Boolean(managerId && (halftime?.participant ?? requiredManagerIds.includes(managerId)));
  const isHalftimeReady = Boolean(managerId && readyManagerIds.includes(managerId));
  const halftimeResuming = halftime?.status === 'resuming' || halftime?.allReady === true;
  const canEditHalftime = Boolean(
    isHalftime
    && halftime
    && isHalftimeParticipant
    && !isHalftimeReady
    && !halftimeResuming
    && !onlineMatch?.halftimePending,
  );
  const persistedSubstitutionCount = finiteValue(halftime?.ownPlan?.substitutionCount, substitutionCount);
  const displaySubstitutionCount = onlineMatch
    ? Math.max(0, Math.trunc(persistedSubstitutionCount))
    : substitutionCount;
  const readinessManagers = requiredManagerIds.map((id) => ({
    id,
    name: roomManagers.find((manager) => manager.id === id)?.name ?? 'Manager',
    ready: readyManagerIds.includes(id),
  }));
  const tactics: HalftimeTactics = { mentality, instruction };

  useEffect(() => {
    if (!onlineMatch || onlineMatch.phase !== 'halftime') return;
    const ownPlan = onlineMatch.halftime?.ownPlan;
    const preferredLineupIds = Array.isArray(ownPlan?.lineupIds)
      ? stringArray(ownPlan.lineupIds)
      : savedLineup?.lineupIds ?? savedLineupIds;
    const nextLineupIds = buildAvailableLineupIds(players, preferredLineupIds);
    setHalftimeLineupIds(nextLineupIds);
    setSubstitutionCount(Math.max(0, Math.trunc(finiteValue(
      ownPlan?.substitutionCount,
      countLineupChanges(initialLineupIds, nextLineupIds),
    ))));
    if (ownPlan?.tactics && typeof ownPlan.tactics === 'object') {
      setMentality(safeMentality(ownPlan.tactics.mentality));
      setInstruction(safeInstruction(ownPlan.tactics.instruction));
    } else {
      setMentality(safeMentality(savedLineup?.tactics?.mentality));
      setInstruction('keep-plan');
    }
  }, [onlineMatch?.match?.id, onlineMatch?.phase, onlineMatch?.halftime?.ownPlan?.savedAt, initialLineupKey, savedLineup?.tactics?.mentality]);

  useEffect(() => {
    const starters = starterPlayers;
    const reserves = reservePlayers;
    setOutPlayer((current) => starters.some((player) => player.id === current) ? current : starters.at(-1)?.id ?? '');
    setInPlayer((current) => reserves.some((player) => player.id === current) ? current : reserves[0]?.id ?? '');
  }, [players, activeLineupKey]);

  useEffect(() => {
    if (!onlineMatch || canEditHalftime) return;
    setSubOpen(false);
    setTacticOpen(false);
  }, [onlineMatch, canEditHalftime]);

  useEffect(() => {
    if (onlineMatch || !demoMode || !running || finished) return;
    const timer = window.setInterval(() => setEventCount((count) => Math.min(matchEvents.length, count + 1)), 800);
    return () => window.clearInterval(timer);
  }, [demoMode, finished, running, onlineMatch]);

  async function confirmSubstitution() {
    if (!onlineMatch && displaySubstitutionCount >= 5) {
      onToast('O limite de cinco substituições já foi utilizado.');
      setSubOpen(false);
      return;
    }
    const outgoing = playersById.get(outPlayer)?.shortName ?? 'jogador';
    const incoming = playersById.get(inPlayer)?.shortName ?? 'reserva';
    if (onlineMatch) {
      if (!canEditHalftime) {
        onToast(isHalftimeReady ? 'Cancele sua prontidão antes de alterar o time.' : 'As alterações online são liberadas somente no intervalo.');
        return;
      }
      const nextLineupIds = activeLineupIds.map((id) => id === outPlayer ? inPlayer : id);
      const nextPlayers = nextLineupIds.map((id) => playersById.get(id)).filter((player): player is Player => Boolean(player));
      const goalkeeperCount = nextPlayers.filter((player) => player.position === 'GOL').length;
      if (nextPlayers.length !== nextLineupIds.length || goalkeeperCount !== 1 || nextPlayers[0]?.position !== 'GOL') {
        onToast('A escalação precisa manter exatamente um goleiro na posição GOL.');
        return;
      }
      const nextSubstitutionCount = countLineupChanges(initialLineupIds, nextLineupIds);
      if (nextSubstitutionCount > 5) {
        onToast('O limite de cinco substituições já foi utilizado.');
        return;
      }
      try {
        const savedPlan = await onlineMatch.saveHalftimePlan(nextLineupIds, tactics);
        setHalftimeLineupIds(nextLineupIds);
        setSubstitutionCount(savedPlan.ownPlan?.substitutionCount ?? nextSubstitutionCount);
        setSubOpen(false);
        onToast(`Troca salva para o segundo tempo: sai ${outgoing}, entra ${incoming}.`);
      } catch (nextError) {
        onToast(nextError instanceof Error ? nextError.message : 'Não foi possível salvar a substituição.');
      }
      return;
    }
    setExtraEvents((events) => [...events, { minute: Math.max(1, currentMinute), kind: 'sub', text: `SUBSTITUIÇÃO DO ${club.name.toLocaleUpperCase('pt-BR')}: sai ${outgoing}, entra ${incoming}.` }]);
    setHalftimeLineupIds((current) => (current.length ? current : initialLineupIds).map((id) => id === outPlayer ? inPlayer : id));
    setSubstitutionCount((count) => count + 1);
    setSubOpen(false);
    onToast('Substituição enviada à beira do campo.');
  }

  async function confirmTactics() {
    if (onlineMatch) {
      if (!canEditHalftime) {
        onToast(isHalftimeReady ? 'Cancele sua prontidão antes de alterar a tática.' : 'As alterações online são liberadas somente no intervalo.');
        return;
      }
      try {
        await onlineMatch.saveHalftimePlan(activeLineupIds, tactics);
        setTacticOpen(false);
        onToast(`Plano do segundo tempo salvo: mentalidade ${optionLabel(mentalityOptions, mentality).toLowerCase()}.`);
      } catch (nextError) {
        onToast(nextError instanceof Error ? nextError.message : 'Não foi possível salvar o ajuste tático.');
      }
      return;
    }
    setTacticOpen(false);
    onToast(`Mentalidade alterada para ${optionLabel(mentalityOptions, mentality).toLowerCase()}.`);
  }

  async function toggleHalftimeReady() {
    if (!onlineMatch || !halftime || !isHalftimeParticipant) return;
    try {
      const response = await onlineMatch.setHalftimeReady(!isHalftimeReady);
      if (response.resumed) onToast('Todos estão prontos. O segundo tempo começou.');
      else onToast(isHalftimeReady ? 'Prontidão cancelada. Você pode editar o plano novamente.' : 'Pronto confirmado. Aguardando os outros managers.');
    } catch (nextError) {
      onToast(nextError instanceof Error ? nextError.message : 'Não foi possível atualizar sua prontidão.');
    }
  }

  function closeTacticModal() {
    if (onlineMatch) {
      setMentality(safeMentality(halftime?.ownPlan?.tactics?.mentality ?? savedLineup?.tactics?.mentality));
      setInstruction(halftime?.ownPlan?.tactics ? safeInstruction(halftime.ownPlan.tactics.instruction) : 'keep-plan');
    }
    setTacticOpen(false);
  }

  async function skipToResult() {
    if (onlineMatch) {
      if (!isRoomOwner) {
        onToast('Somente o criador da sala pode pular o resultado.');
        return;
      }
      try {
        await onlineMatch.skip();
        onToast('O servidor concluiu a transmissão da partida.');
      } catch (nextError) {
        onToast(nextError instanceof Error ? nextError.message : 'Não foi possível pular a partida.');
      }
      return;
    }
    if (!demoMode) return;
    setEventCount(matchEvents.length);
    setRunning(false);
    onToast(`Simulação concluída. Vitória do ${club.name} por 2 a 1.`);
  }

  async function changeMatchSpeed(nextSpeed: MatchSpeed) {
    if (!onlineMatch || !isRoomOwner || nextSpeed === activeMatchSpeed) return;
    try {
      const confirmed = await onlineMatch.setSpeed(nextSpeed);
      onToast(`Velocidade da simulação alterada para ${matchSpeedLabel(confirmed.rate)}.`);
    } catch (nextError) {
      onToast(nextError instanceof Error ? nextError.message : 'Não foi possível alterar a velocidade.');
    }
  }

  const statisticsRecord = recordValue(onlineMatch?.statistics);
  const homeStatistics = recordValue(statisticsRecord?.home);
  const awayStatistics = recordValue(statisticsRecord?.away);
  const statRows = [
    statisticRow('Posse', homeStatistics?.possession, awayStatistics?.possession, '%'),
    statisticRow('Finalizações', homeStatistics?.shots, awayStatistics?.shots),
    statisticRow('No alvo', homeStatistics?.shotsOnTarget, awayStatistics?.shotsOnTarget),
    statisticRow('Escanteios', homeStatistics?.corners, awayStatistics?.corners),
    statisticRow('Faltas', homeStatistics?.fouls, awayStatistics?.fouls),
  ].filter((row): row is MatchStatisticRow => row !== null);

  if (room?.scheduleIssue && !fixture && !matchDescriptor) {
    return (
      <main className="match-view view-enter">
        <section className="match-waiting" role="alert">
          <Shield size={34} />
          <p className="eyebrow">CALENDÁRIO PENDENTE</p>
          <h1>Partida ainda não disponível</h1>
          <p>{room.scheduleIssue.message}. Adicione outro time à mesma liga no Editor e abra este save novamente.</p>
          <Button variant="primary" onClick={() => onNavigate('home')}>Voltar à Central</Button>
        </section>
      </main>
    );
  }

  if (!onlineMatch && !demoMode) {
    return (
      <main className="match-view view-enter">
        <section className="match-waiting" role="status">
          <Shield size={34} />
          <p className="eyebrow">TRANSMISSÃO INDISPONÍVEL</p>
          <h1>Nenhuma partida autoritativa em andamento</h1>
          <p>{fixture
            ? `${homeTeam} × ${awayTeam} · ${competition} · ${matchRoundLabel}`
            : 'Aguarde o servidor disponibilizar uma partida válida para esta sala.'}</p>
          <Button variant="primary" onClick={() => onNavigate('home')}>Voltar à Central</Button>
        </section>
      </main>
    );
  }

  if (onlineMatch && onlineMatch.phase !== 'running' && onlineMatch.phase !== 'halftime' && onlineMatch.phase !== 'finished') {
    return (
      <main className="match-view view-enter">
        <section className="match-waiting" aria-live="polite">
          <Shield size={34} />
          <p className="eyebrow">PRÉ-JOGO MULTIPLAYER</p>
          <h1>{onlineMatch.phase === 'syncing' ? 'Sincronizando a rodada…' : 'Aguardando os managers.'}</h1>
          <p>Confirme “Estou pronto” na Central. A transmissão começa somente quando todos confirmarem.</p>
          {onlineMatch.error && <div className="match-online-error" role="alert"><span>{onlineMatch.error}</span><button onClick={onlineMatch.reset}>Limpar erro</button></div>}
          <Button variant="primary" onClick={() => onNavigate('home')}>Voltar à Central</Button>
        </section>
      </main>
    );
  }

  return (
    <main className="match-view view-enter">
      <MatchScore
        minute={currentMinute}
        score={score}
        finished={finished}
        events={revealed}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        homeCode={homeCode}
        awayCode={awayCode}
        homeColor={homeColor}
        awayColor={awayColor}
        homeDarkThemeColor={homeDarkThemeColor}
        homeLightThemeColor={homeLightThemeColor}
        awayDarkThemeColor={awayDarkThemeColor}
        awayLightThemeColor={awayLightThemeColor}
        homeCrestImageUrl={homeCrestImageUrl}
        awayCrestImageUrl={awayCrestImageUrl}
        stadium={stadium}
        stadiumCapacity={stadiumCapacity}
        competition={competition}
        roundLabel={matchRoundLabel}
        homeFormation={homeFormation}
        awayFormation={awayFormation}
      />
      <div className="match-progress"><span style={{ width: `${progress}%` }} /><i style={{ left: `${progress}%` }} /></div>

      {isHalftime && (
        <section className="halftime-panel" role="status" aria-live="polite" aria-atomic="true">
          <header className="halftime-panel__header">
            <span className="halftime-panel__icon"><Clock3 size={24} /></span>
            <div>
              <p className="eyebrow">INTERVALO · 45′</p>
              <h2>{halftimeResuming ? 'Preparando o segundo tempo' : 'Partida pausada para ajustes'}</h2>
              <p>{halftimeResuming ? 'Todos confirmaram. O servidor está aplicando os planos.' : 'A bola só volta a rolar quando todos os managers desta partida estiverem prontos.'}</p>
            </div>
            <Badge tone={halftimeResuming ? 'positive' : 'warning'}>{halftimeReadyCount}/{halftimeRequiredCount} prontos</Badge>
          </header>

          <div className="halftime-panel__body">
            <div className="halftime-readiness">
              <div className="halftime-readiness__title"><Users size={17} /><strong>Prontidão dos managers</strong></div>
              <ul aria-label="Prontidão dos managers para o segundo tempo">
                {readinessManagers.map((manager) => (
                  <li key={manager.id} className={manager.ready ? 'is-ready' : ''}>
                    <span>{manager.name}{manager.id === managerId ? ' (você)' : ''}</span>
                    <strong>{manager.ready ? <><CheckCircle2 size={15} /> Pronto</> : 'Ajustando'}</strong>
                  </li>
                ))}
              </ul>
              {!readinessManagers.length && <p className="halftime-readiness__sync">Sincronizando os participantes do intervalo…</p>}
            </div>

            <div className="halftime-actions">
              {isHalftimeParticipant ? (
                <>
                  <div className="halftime-plan-summary">
                    <span><small>ALTERAÇÕES</small><strong>{displaySubstitutionCount}/5 substituições</strong></span>
                    <span><small>MENTALIDADE</small><strong>{optionLabel(mentalityOptions, mentality)}</strong></span>
                    <span><small>INSTRUÇÃO</small><strong>{optionLabel(instructionOptions, instruction)}</strong></span>
                  </div>
                  {isHalftimeReady && <p className="halftime-ready-note"><CheckCircle2 size={16} /> Seu plano está confirmado. Cancele o pronto para fazer novas alterações.</p>}
                  <div className="halftime-actions__buttons">
                    <Button icon={<ArrowRightLeft size={16} />} onClick={() => setSubOpen(true)} disabled={!canEditHalftime || reservePlayers.length < 1}>Fazer substituição</Button>
                    <Button icon={<SlidersHorizontal size={16} />} onClick={() => setTacticOpen(true)} disabled={!canEditHalftime}>Ajustar tática</Button>
                    <Button
                      variant={isHalftimeReady ? 'ghost' : 'primary'}
                      icon={<CheckCircle2 size={16} />}
                      loading={onlineMatch?.halftimePending === 'ready'}
                      onClick={() => void toggleHalftimeReady()}
                      disabled={!halftime || halftimeResuming || onlineMatch?.halftimePending === 'plan'}
                    >
                      {isHalftimeReady ? 'Cancelar pronto' : 'Estou pronto para o 2º tempo'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="halftime-spectator">
                  <Shield size={22} />
                  <div><strong>Você está acompanhando esta partida.</strong><p>Somente os managers dos clubes em campo fazem ajustes e confirmam a prontidão.</p></div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="match-layout">
        <section className="commentary-panel">
          <header><div><p className="eyebrow">TRANSMISSÃO EM TEXTO</p><h2>Narração ao vivo</h2></div><button className="icon-button" onClick={() => setRunning((value) => !value)} disabled={finished || Boolean(onlineMatch)} aria-label={running ? 'Pausar narração' : 'Continuar narração'}>{running ? <Pause size={16} /> : <Play size={16} />}</button></header>
          <MatchFeed events={revealed} finished={finished} />
          {onlineMatch?.error && <div className="match-online-error" role="alert"><span>{onlineMatch.error}</span><button onClick={onlineMatch.reset}>Limpar erro</button></div>}
          <footer className="commentary-status"><span><i className={!finished && !isHalftime ? 'pulse' : ''} /> {finished ? 'Partida encerrada' : isHalftime ? 'Intervalo: simulação pausada pelo servidor' : onlineMatch ? 'Eventos autoritativos recebidos do servidor' : running ? 'Demonstração determinística em andamento' : 'Narração pausada'}</span><small>{onlineMatch ? finished ? 'transmissão encerrada' : `${isHalftime ? 'pausada' : 'velocidade'} · ${activeMatchSpeedLabel}` : 'modo demo explícito · cadência: 800 ms'}</small></footer>
        </section>

        <aside className="match-analysis">
          <section className="live-stats">
            <header><div><p className="eyebrow">DADOS AO VIVO</p><h2>Estatísticas</h2></div><BarChart3 size={17} /></header>
            <div className="stats-clubs"><span><i style={{ background: homeColor }} /> {homeCode}</span><span>{awayCode} <i style={{ background: awayColor }} /></span></div>
            {statRows.length > 0
              ? statRows.map(({ label, home, away, homeWidth }) => <div className="stat-row" key={label}><div><strong>{home}</strong><span>{label}</span><strong>{away}</strong></div><div className="split-bar"><span style={{ width: `${homeWidth}%` }} /><i style={{ width: `${100 - homeWidth}%` }} /></div></div>)
              : <p className="match-data-unavailable" role="status">Estatísticas ainda não disponíveis.</p>}
          </section>

          <section className="touchline-note"><Sparkles size={16} /><div><strong>Sugestão do auxiliar</strong><p>{fixtureStudy?.recommendations[0]?.detail ?? 'Revise o plano conforme o momento e as características reais das equipes.'}</p></div><button disabled={Boolean(onlineMatch) && !canEditHalftime} aria-label="Revisar plano sugerido" onClick={() => { if (onlineMatch) setTacticOpen(true); else onNavigate('tactics'); }}><ChevronRight size={15} /></button></section>
        </aside>
      </div>

      <section className="match-controls">
        <div className="match-controls__status"><span className="control-status"><Activity size={15} /> Pressão <strong>{managedTacticLabels?.pressure.replace('Pressão ', '') ?? 'A confirmar'}</strong></span><span className="control-status"><CircleGauge size={15} /> Ritmo <strong>{managedTacticLabels?.tempo ?? 'A confirmar'}</strong></span><span className="control-status"><Shield size={15} /> Substituições <strong>{displaySubstitutionCount}/5</strong></span></div>
        {onlineMatch && (onlineMatch.phase === 'running' || onlineMatch.phase === 'halftime') && (
          <fieldset
            className="match-speed-control"
            disabled={!canControlMatchSpeed}
            aria-busy={onlineMatch.speedPending !== null}
            aria-describedby={!isRoomOwner ? 'match-speed-owner-note' : undefined}
          >
            <legend>Velocidade da simulação <strong>{activeMatchSpeedLabel}</strong></legend>
            <div className="match-speed-control__options">
              {matchSpeedOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={onlineMatch.speedPending === option.value ? 'is-pending' : undefined}
                  aria-label={`Velocidade da simulação ${option.label}`}
                  aria-pressed={activeMatchSpeed === option.value}
                  disabled={!canControlMatchSpeed}
                  onClick={() => void changeMatchSpeed(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {!isRoomOwner && <small id="match-speed-owner-note" className="match-speed-control__owner-note"><Shield size={12} aria-hidden="true" /> Controlada pelo criador da sala. Somente o criador da sala pode alterar a velocidade.</small>}
          </fieldset>
        )}
        <div className="match-controls__actions"><Button icon={<ArrowRightLeft size={15} />} onClick={() => setSubOpen(true)} disabled={finished || (!onlineMatch && displaySubstitutionCount >= 5) || (Boolean(onlineMatch) && !canEditHalftime) || reservePlayers.length < 1}>Substituição</Button><Button icon={<SlidersHorizontal size={15} />} onClick={() => setTacticOpen(true)} disabled={finished || (Boolean(onlineMatch) && !canEditHalftime)}>Ajuste tático</Button><Button variant="danger" icon={<FastForward size={15} />} onClick={() => void skipToResult()} disabled={finished || onlineMatch?.phase === 'starting' || isHalftime || (Boolean(onlineMatch) && !isRoomOwner)}>Pular resultado</Button></div>
      </section>

      {finished && roundSummary && (
        <RoundResultsPanel summary={roundSummary} managedClubIds={[club.id, club.code]} />
      )}

      {finished && <section className="final-whistle"><span className="final-whistle__icon"><Goal size={22} /></span><div><p className="eyebrow">APITO FINAL</p><h2>{homeTeam} {score[0]}–{score[1]} {awayTeam}.</h2><p>{managedClubInFixture ? 'A imprensa já prepara a coletiva pós-jogo.' : 'Partida dos outros managers encerrada.'}</p></div><div className="final-whistle__actions"><Button variant="primary" icon={<Flag size={15} />} onClick={() => { if (onlineMatch && !managedClubInFixture) onlineMatch.reset(); onNavigate(managedClubInFixture ? 'press-conference' : 'home'); }}>{managedClubInFixture ? 'Ir para a coletiva' : 'Voltar à central'}</Button></div></section>}

      <Modal open={subOpen} onClose={() => setSubOpen(false)} title="Fazer substituição" eyebrow={`${club.name.toLocaleUpperCase('pt-BR')} · ${currentMinute} MIN · ${displaySubstitutionCount}/5`} footer={<><Button variant="ghost" onClick={() => setSubOpen(false)}>Cancelar</Button><Button variant="primary" loading={onlineMatch?.halftimePending === 'plan'} onClick={() => void confirmSubstitution()} disabled={(!onlineMatch && displaySubstitutionCount >= 5) || !outPlayer || !inPlayer || (Boolean(onlineMatch) && !canEditHalftime)}>Confirmar troca</Button></>}>
        <div className="substitution-form"><label><span>SAI</span><select value={outPlayer} onChange={(event) => setOutPlayer(event.target.value)}>{starterPlayers.map((player) => <option key={player.id} value={player.id}>{substitutionPlayerLabel(player)}</option>)}</select></label><span className="sub-arrow"><ArrowRightLeft size={18} /></span><label><span>ENTRA</span><select value={inPlayer} onChange={(event) => setInPlayer(event.target.value)}>{reservePlayers.map((player) => <option key={player.id} value={player.id}>{substitutionPlayerLabel(player)}</option>)}</select></label></div>
      </Modal>

      <Modal open={tacticOpen} onClose={closeTacticModal} title="Ajuste tático" eyebrow={isHalftime ? 'PLANO PARA O SEGUNDO TEMPO' : 'INSTRUÇÕES À BEIRA DO CAMPO'} footer={<><Button variant="ghost" onClick={closeTacticModal}>Cancelar</Button><Button variant="primary" loading={onlineMatch?.halftimePending === 'plan'} onClick={() => void confirmTactics()} disabled={Boolean(onlineMatch) && !canEditHalftime}>Salvar plano</Button></>}>
        <div className="match-tactic-form"><label><span>MENTALIDADE</span><div>{mentalityOptions.map((item) => <button key={item.value} type="button" aria-pressed={mentality === item.value} onClick={() => setMentality(item.value)}>{item.label}</button>)}</div></label><label><span>INSTRUÇÃO RÁPIDA</span><select value={instruction} onChange={(event) => setInstruction(event.target.value as HalftimeInstruction)}>{instructionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="tactic-impact"><SquareDashedBottom size={19} /><span><strong>Impacto estimado no segundo tempo</strong><small>O servidor combina a instrução, a mentalidade e os jogadores escolhidos.</small></span></div></div>
      </Modal>
    </main>
  );
}
