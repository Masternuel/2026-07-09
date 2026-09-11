import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, CalendarClock, Shield, Target, Trophy } from 'lucide-react';
import { enrichRankingPlayers, PlayerProfileHost } from '../../components/player/PlayerProfileHost';
import { Badge } from '../../components/shared/Badge';
import { ClubMark } from '../../components/shared/ClubMark';
import { ResilientImage } from '../../components/shared/ResilientImage';
import { useRankings } from '../../hooks/useRankings';
import { buildCompetitionClubMatches, type CompetitionClubIdentity } from '../../services/competitionClubService';
import type {
  ClubChoice,
  CompetitionFixture,
  CompetitionKnockoutStage,
  CompetitionStanding,
  CompetitionState,
  BolaSocket,
  Player,
  Room,
  Tournament,
} from '../../types';
import { buildSeasonTable, findRoomLeagueForClub } from '../../utils/leagueStandings';
import { getSeasonProgress } from '../../utils/seasonProgress';
import { CompetitionClubPage, type CompetitionClubTab } from './CompetitionClubPage';

interface CompetitionsViewProps {
  club: ClubChoice;
  room: Room | null;
  tournaments: Tournament[];
  loadingTournaments: boolean;
  tournamentError: string | null;
  clubs?: ClubChoice[];
  managerPlayers?: Player[];
  socket?: BolaSocket | null;
  managerId?: string;
  onRosterChanged?: () => void;
  onToast?: (message: string) => void;
}

interface ClubSelection {
  club: CompetitionClubIdentity;
  competitionId: string | null;
  competitionName: string;
  position: number | null;
}

function key(value: string | null | undefined) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function compactCode(teamName: string) {
  return teamName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

function parseBudget(value: string | number | null | undefined) {
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

function reputationScore(value: number | null | undefined, stars: number | null | undefined) {
  const source = Number.isFinite(value) ? Number(value) : Number.isFinite(stars) ? Number(stars) * 20 : 0;
  const normalized = Number.isFinite(value) && source <= 20 ? source * 5 : source;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Data a definir';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(date).replace('.', '');
}

function formatName(format: Tournament['format']) {
  if (format === 'league') return 'Pontos corridos';
  if (format === 'knockout') return 'Mata-mata';
  return 'Grupos + mata-mata';
}

function statusLabel(state: CompetitionState | null) {
  if (!state) return 'Aguardando calendário';
  if (state.status === 'completed') return 'Encerrado';
  if (state.status === 'active') return 'Em andamento';
  return 'Programado';
}

function tiebreakerLabel(criterion: string) {
  const labels: Record<string, string> = {
    points: 'Pontos',
    goal_difference: 'Saldo de gols',
    goals_scored: 'Gols marcados',
    wins: 'Vitórias',
    head_to_head: 'Confronto direto',
    fair_play: 'Fair play',
    away_goals: 'Gols fora',
    extra_time: 'Prorrogação',
    penalties: 'Pênaltis',
    drawing_lots: 'Sorteio',
  };
  return labels[criterion] ?? criterion;
}

function CompetitionTable({
  title,
  standings,
  managedClubIds,
  presentClub,
  onClubSelect,
}: {
  title: string;
  standings: CompetitionStanding[];
  managedClubIds: Set<string>;
  presentClub: (clubId: string) => CompetitionClubIdentity;
  onClubSelect: (club: CompetitionClubIdentity, position: number | null, trigger: HTMLElement) => void;
}) {
  return (
    <section className="standings-panel">
      <header><div><p className="eyebrow">CLASSIFICAÇÃO</p><h2>{title}</h2></div><Badge tone="info">{standings.length} times</Badge></header>
      <div className="full-table">
        <div className="full-table__head"><span>POS</span><span>CLUBE</span><span>J</span><span>V</span><span>E</span><span>D</span><span>SG</span><span>GP</span><span>PTS</span></div>
        {standings.map((row) => {
          const team = presentClub(row.clubId);
          return (
            <button
              type="button"
              key={row.clubId}
              className={`competition-team-row${managedClubIds.has(key(row.clubId)) ? ' highlight' : ''}`}
              onClick={(event) => onClubSelect(team, row.position, event.currentTarget)}
              aria-label={`Abrir detalhes de ${team.name}`}
            >
              <span>{row.position}</span>
              <span><ClubMark code={team.code} color={team.color} darkThemeColor={team.darkThemeColor} lightThemeColor={team.lightThemeColor} imageUrl={team.crestImageUrl} size="sm" /><strong>{team.name}</strong></span>
              <span>{row.played}</span><span>{row.wins}</span><span>{row.draws}</span><span>{row.losses}</span>
              <span>{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</span><span>{row.goalsFor}</span><strong>{row.points}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function scoreForTie(stage: CompetitionKnockoutStage, tieId: string, fixtures: CompetitionFixture[]) {
  const tie = stage.ties.find((candidate) => candidate.id === tieId);
  if (!tie?.homeClubId || !tie.awayClubId) return null;
  if (tie.aggregate) return tie.aggregate;
  const total: [number, number] = [0, 0];
  let hasResult = false;
  for (const fixtureId of tie.fixtureIds) {
    const fixture = fixtures.find((candidate) => candidate.id === fixtureId);
    if (!fixture?.result) continue;
    hasResult = true;
    if (fixture.homeClubId === tie.homeClubId) {
      total[0] += fixture.result.score[0];
      total[1] += fixture.result.score[1];
    } else {
      total[0] += fixture.result.score[1];
      total[1] += fixture.result.score[0];
    }
  }
  return hasResult ? total : null;
}

function KnockoutBracket({
  stage,
  fixtures,
  presentClub,
  onClubSelect,
}: {
  stage: CompetitionKnockoutStage;
  fixtures: CompetitionFixture[];
  presentClub: (clubId: string) => CompetitionClubIdentity;
  onClubSelect: (club: CompetitionClubIdentity, position: number | null, trigger: HTMLElement) => void;
}) {
  return (
    <section className="bracket-panel">
      <header><div><p className="eyebrow">CHAVE REAL</p><h2>Mata-mata</h2></div><Badge tone={stage.status === 'completed' ? 'positive' : 'warning'}>{stage.status === 'completed' ? 'Concluído' : 'Em disputa'}</Badge></header>
      <div className="bracket">
        {stage.rounds.map((round) => (
          <div className="bracket-round" key={round.number}>
            <span>{round.name.toUpperCase()}</span>
            {round.tieIds.map((tieId) => {
              const tie = stage.ties.find((candidate) => candidate.id === tieId);
              const home = tie?.homeClubId ? presentClub(tie.homeClubId) : null;
              const away = tie?.awayClubId ? presentClub(tie.awayClubId) : null;
              const aggregate = scoreForTie(stage, tieId, fixtures);
              return (
                <div className="tie" key={tieId}>
                  <p>{home ? <button type="button" className="tie-team-button" onClick={(event) => onClubSelect(home, null, event.currentTarget)}>{home.name}{tie?.winnerClubId === tie?.homeClubId ? ' ✓' : ''}</button> : <strong>A definir</strong>}<span>{aggregate?.[0] ?? '—'}</span></p>
                  <p>{away ? <button type="button" className="tie-team-button" onClick={(event) => onClubSelect(away, null, event.currentTarget)}>{away.name}{tie?.winnerClubId === tie?.awayClubId ? ' ✓' : ''}</button> : <strong>A definir</strong>}<span>{aggregate?.[1] ?? '—'}</span></p>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

export function CompetitionsView({
  club,
  room,
  tournaments,
  loadingTournaments,
  tournamentError,
  clubs = [],
  managerPlayers = [],
  socket = null,
  managerId = '',
  onRosterChanged = () => undefined,
  onToast = () => undefined,
}: CompetitionsViewProps) {
  const [competition, setCompetition] = useState('league');
  const [selectedClub, setSelectedClub] = useState<ClubSelection | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [clubTab, setClubTab] = useState<CompetitionClubTab>('overview');
  const returnScrollRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const roomTournamentCatalog = room?.tournamentCatalog ?? [];
  const tournamentById = new Map<string, Tournament>();
  for (const tournament of [...tournaments, ...roomTournamentCatalog]) tournamentById.set(key(tournament.id), tournament);
  const competitionStates = room?.competitionSeason?.competitions ?? [];
  const selectableTournamentIds: string[] = [];
  const seenTournamentIds = new Set<string>();
  for (const id of [...roomTournamentCatalog.map((item) => item.id), ...competitionStates.map((item) => item.id)]) {
    const normalized = key(id);
    if (!normalized || seenTournamentIds.has(normalized)) continue;
    seenTournamentIds.add(normalized);
    selectableTournamentIds.push(id);
  }
  if (!room && !selectableTournamentIds.length) {
    for (const tournament of tournaments) selectableTournamentIds.push(tournament.id);
  }
  const selectedTournamentId = competition.startsWith('tournament:') ? competition.slice('tournament:'.length) : null;
  const selectedTournament = selectedTournamentId ? tournamentById.get(key(selectedTournamentId)) ?? null : null;
  const selectedState = selectedTournamentId
    ? competitionStates.find((state) => key(state.id) === key(selectedTournamentId)) ?? null
    : null;

  useEffect(() => {
    if (competition !== 'league' && (!selectedTournamentId || !selectableTournamentIds.some((id) => key(id) === key(selectedTournamentId)))) {
      setCompetition('league');
    }
  }, [competition, selectableTournamentIds, selectedTournamentId]);

  const clubIds = new Set([club.id, club.code].map(key));
  const roomLeague = findRoomLeagueForClub(room, club);
  const relatedFixtures = (room?.fixtureSchedule ?? []).filter((fixture) => (
    clubIds.has(key(fixture.homeClubId)) || clubIds.has(key(fixture.awayClubId))
  ));
  const leagueName = roomLeague?.name || club.leagueName || relatedFixtures[0]?.competition || 'Liga';
  const leagueDivision = roomLeague?.division || club.division || leagueName;
  const leagueCountry = roomLeague?.country || club.country || 'País a definir';
  const completed = new Set((room?.completedFixtureIds ?? []).map(key));
  const season = getSeasonProgress(room);
  const standings = room ? buildSeasonTable(room, roomLeague?.id ?? club.leagueId) : [];
  const scheduledOpponents = relatedFixtures
    .filter((fixture) => !completed.has(key(fixture.fixtureId)))
    .slice(0, 3)
    .map((fixture) => {
      const atHome = clubIds.has(key(fixture.homeClubId));
      const name = atHome ? fixture.awayTeam : fixture.homeTeam;
      return {
        id: atHome ? fixture.awayClubId : fixture.homeClubId,
        code: (atHome ? fixture.awayCode : fixture.homeCode) || compactCode(name),
        color: (atHome ? fixture.awayColor : fixture.homeColor) || '#ddd',
        darkThemeColor: atHome ? fixture.awayDarkThemeColor : fixture.homeDarkThemeColor,
        lightThemeColor: atHome ? fixture.awayLightThemeColor : fixture.homeLightThemeColor,
        crestImageUrl: atHome ? fixture.awayCrestImageUrl : fixture.homeCrestImageUrl,
        name,
        venue: atHome ? 'C' : 'F',
        detail: fixture.scheduledAt ? formatDate(fixture.scheduledAt) : `Rodada ${fixture.round}`,
      };
    });

  const presentClub = (clubId: string): CompetitionClubIdentity => {
    const normalizedId = key(clubId);
    const rich = selectedTournament?.participants.find((participant) => key(participant.id) === normalizedId);
    const catalogLeague = room?.competitionCatalog?.find((league) => league.clubs.some((candidate) => key(candidate.id) === normalizedId || key(candidate.code) === normalizedId));
    const catalogClub = catalogLeague?.clubs.find((candidate) => key(candidate.id) === normalizedId || key(candidate.code) === normalizedId);
    const fullClub = clubs.find((candidate) => key(candidate.id) === normalizedId || key(candidate.code) === normalizedId)
      ?? (key(club.id) === normalizedId || key(club.code) === normalizedId ? club : null);
    const engineParticipant = selectedState?.participants.find((participant) => key(participant.id) === normalizedId);
    const name = fullClub?.name || rich?.name || catalogClub?.name || engineParticipant?.name || clubId;
    const reputation = reputationScore(rich?.reputation ?? catalogClub?.reputation, fullClub?.stars);
    const configuredBudget = parseBudget(fullClub?.budget);
    return {
      id: fullClub?.id || rich?.id || catalogClub?.id || engineParticipant?.id || clubId,
      name,
      code: fullClub?.code || rich?.abbreviation || catalogClub?.code || compactCode(name),
      color: fullClub?.color || rich?.colors[0] || catalogClub?.color || '#6b7280',
      darkThemeColor: fullClub?.darkThemeColor ?? rich?.darkThemeColor ?? catalogClub?.darkThemeColor ?? null,
      lightThemeColor: fullClub?.lightThemeColor ?? rich?.lightThemeColor ?? catalogClub?.lightThemeColor ?? null,
      crestImageUrl: fullClub?.crestImageUrl ?? rich?.crestImageUrl ?? catalogClub?.crestImageUrl ?? null,
      country: fullClub?.country || rich?.country || catalogLeague?.country || 'País a definir',
      division: fullClub?.division || rich?.division || catalogLeague?.division || selectedTournament?.name || leagueDivision,
      reputation,
      stadium: fullClub?.stadium || rich?.stadium || catalogClub?.stadium || 'Estádio a definir',
      capacity: fullClub?.stadiumCapacity ?? rich?.stadiumCapacity ?? catalogClub?.stadiumCapacity ?? 0,
      city: fullClub?.city || rich?.country || catalogLeague?.country || 'Local a definir',
      budget: configuredBudget,
    };
  };

  const selectedDefinition = selectedTournament ?? (selectedState ? {
    id: selectedState.id,
    name: selectedState.name,
    format: selectedState.format,
    teamCount: selectedState.participants.length,
    legs: selectedState.legs,
    tiebreakers: selectedState.tiebreakers.filter((criterion) => criterion !== 'points'),
    teamIds: selectedState.participants.map((participant) => participant.id),
    trophyImageUrl: null,
    trophyImagePath: null,
    active: true,
    participants: [],
  } as Tournament : null);
  const leagueStage = selectedState?.stages.find((stage) => stage.type === 'league');
  const groupsStage = selectedState?.stages.find((stage) => stage.type === 'groups');
  const knockoutStage = selectedState?.stages.find((stage) => stage.type === 'knockout');
  const visibleFixtures = selectedState ? [
    ...selectedState.fixtures.filter((fixture) => fixture.status === 'completed').slice(-3),
    ...selectedState.fixtures.filter((fixture) => fixture.status === 'scheduled').slice(0, 5),
  ] : [];
  const winner = selectedState?.winnerClubId ? presentClub(selectedState.winnerClubId) : null;
  const activeCompetitionId = competition === 'league'
    ? roomLeague?.id ?? club.leagueId ?? null
    : selectedTournamentId;
  const activeCompetitionName = competition === 'league'
    ? leagueName
    : selectedDefinition?.name || selectedState?.name || 'Competição';
  const competitionRankings = useRankings(
    room?.code,
    club.id,
    room?.revision ?? 0,
    activeCompetitionId,
  );
  const selectedPublicSnapshot = useMemo(() => {
    if (!selectedClub || !competitionRankings.rankings) return null;
    const aliases = new Set([
      selectedClub.club.id,
      selectedClub.club.code,
      selectedClub.club.name,
    ].map(key).filter(Boolean));
    return competitionRankings.rankings.clubs.find((candidate) => (
      [candidate.id, candidate.code, candidate.name]
        .map(key)
        .some((alias) => aliases.has(alias))
    )) ?? null;
  }, [competitionRankings.rankings, selectedClub]);
  const profilePlayers = useMemo(
    () => enrichRankingPlayers(competitionRankings.rankings?.players ?? [], managerPlayers),
    [competitionRankings.rankings?.players, managerPlayers],
  );

  function openClubDetails(identity: CompetitionClubIdentity, position: number | null, trigger: HTMLElement) {
    returnScrollRef.current = window.scrollY;
    returnFocusRef.current = trigger;
    setSelectedClub({
      club: identity,
      competitionId: activeCompetitionId,
      competitionName: activeCompetitionName,
      position,
    });
    setClubTab('overview');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  }

  function closeClubDetails() {
    setSelectedPlayerId(null);
    setSelectedClub(null);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: returnScrollRef.current, behavior: 'auto' });
      returnFocusRef.current?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    if (!selectedClub) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.modal-backdrop')) return;
      setSelectedClub(null);
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: returnScrollRef.current, behavior: 'auto' });
        returnFocusRef.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedClub]);

  const selectedClubMatches = useMemo(() => selectedClub
    ? buildCompetitionClubMatches(room, selectedClub.club.id, selectedClub.competitionId)
    : [], [room, selectedClub?.club.id, selectedClub?.competitionId]);

  return (
    <main className="secondary-view view-enter">
      {selectedClub && (
        <CompetitionClubPage
          club={selectedClub.club}
          managerClubId={club.id}
          roomCode={room?.code}
          revision={room?.revision ?? 0}
          currentSeason={room?.currentSeason ?? 1}
          competitionName={selectedClub.competitionName}
          position={selectedPublicSnapshot?.position ?? selectedClub.position}
          fixtures={selectedClubMatches}
          publicSnapshot={selectedPublicSnapshot}
          historyEntries={competitionRankings.rankings?.history ?? []}
          activeTab={clubTab}
          onTabChange={setClubTab}
          onPlayerSelect={setSelectedPlayerId}
          onBack={closeClubDetails}
        />
      )}
      <PlayerProfileHost
        playerId={selectedPlayerId}
        players={profilePlayers}
        room={room}
        socket={socket}
        managerId={managerId}
        currentClubId={club.id}
        onRosterChanged={onRosterChanged}
        onClose={() => setSelectedPlayerId(null)}
        onToast={onToast}
      />
      <div className="competition-index" hidden={Boolean(selectedClub)}>
      <div className="view-heading">
        <div><p className="eyebrow">{leagueCountry} · CALENDÁRIO</p><h1>Competições</h1><p>Tabelas, chaves e jogos reais do {club.name}.</p></div>
        <div className="competition-picker">
          <button aria-selected={competition === 'league'} onClick={() => setCompetition('league')}><Shield size={15} /> {leagueName}</button>
          {selectableTournamentIds.map((id) => {
            const state = competitionStates.find((item) => key(item.id) === key(id));
            const tournament = tournamentById.get(key(id));
            return <button key={id} aria-selected={key(selectedTournamentId) === key(id)} onClick={() => setCompetition(`tournament:${id}`)}><Trophy size={15} /> {tournament?.name || state?.name || id}</button>;
          })}
        </div>
      </div>
      {loadingTournaments && !roomTournamentCatalog.length && <div className="custom-tournament-status" aria-live="polite"><span className="button-spinner" /> Carregando torneios personalizados…</div>}
      {tournamentError && !roomTournamentCatalog.length && <div className="custom-tournament-status is-error" role="status">{tournamentError}</div>}

      {competition === 'league' ? (
        <div className="competition-layout">
          <section className="standings-panel">
            <header><div><p className="eyebrow">{leagueDivision} · CLASSIFICAÇÃO</p><h2>{season.completedRounds ? `Após ${season.completedRounds} ${season.completedRounds === 1 ? 'rodada' : 'rodadas'}` : 'Classificação inicial'}</h2></div><Badge tone={season.completedRounds ? 'positive' : 'info'}>{season.completedRounds ? <><ArrowUp size={12} /> Tabela atualizada</> : season.hasSchedule ? <><CalendarClock size={12} /> Rodada {season.currentRound}</> : <><CalendarClock size={12} /> Calendário pendente</>}</Badge></header>
            <div className="full-table">
              <div className="full-table__head"><span>POS</span><span>CLUBE</span><span>J</span><span>V</span><span>E</span><span>D</span><span>SG</span><span>FORMA</span><span>PTS</span></div>
              {standings.map((team) => {
                const identity = presentClub(team.clubId ?? team.code);
                return (
                  <button
                    type="button"
                    key={team.clubId ?? team.code}
                    className={`competition-team-row${clubIds.has(key(team.clubId ?? team.code)) ? ' highlight' : ''}`}
                    onClick={(event) => openClubDetails(identity, team.position, event.currentTarget)}
                    aria-label={`Abrir detalhes de ${team.name}`}
                  >
                    <span>{team.position}</span>
                    <span><ClubMark code={team.code} color={team.accent} darkThemeColor={team.darkThemeColor} lightThemeColor={team.lightThemeColor} imageUrl={team.crestImageUrl} size="sm" /><strong>{team.name}</strong></span>
                    <span>{team.played}</span><span>{team.wins}</span><span>{team.draws}</span><span>{team.losses}</span><span>{team.goalDifference > 0 ? '+' : ''}{team.goalDifference}</span>
                    <span className="form-dots">{team.form.map((result, index) => <i key={index} className={result.toLowerCase()}>{result}</i>)}</span><strong>{team.points}</strong>
                  </button>
                );
              })}
            </div>
          </section>
          <aside className="competition-sidebar">
            <section><p className="eyebrow">ANDAMENTO REAL</p><div className="projection-ring" style={{ background: `conic-gradient(var(--accent) 0 ${season.percent}%, #292d31 ${season.percent}%)` }}><span><strong>{season.percent}%</strong><small>CONCLUÍDO</small></span></div><h3>Rodada {season.currentRound} de {season.totalRounds}</h3><p>{season.completedRounds} partidas do manager concluídas nesta temporada.</p></section>
            <section><p className="eyebrow">PRÓXIMOS ADVERSÁRIOS</p>{scheduledOpponents.length ? scheduledOpponents.map((opponent) => <button type="button" className="next-opponent competition-opponent-button" key={`${opponent.code}-${opponent.detail}`} onClick={(event) => openClubDetails(presentClub(opponent.id), null, event.currentTarget)}><ClubMark code={opponent.code} color={opponent.color} darkThemeColor={opponent.darkThemeColor} lightThemeColor={opponent.lightThemeColor} imageUrl={opponent.crestImageUrl} size="sm" /><span><strong>{opponent.name}</strong><small>{opponent.detail}</small></span><strong>{opponent.venue}</strong></button>) : <p className="form-note">Nenhum adversário pendente.</p>}</section>
          </aside>
        </div>
      ) : selectedDefinition ? (
        <section className="custom-tournament-panel">
          <header>
            <div className="custom-tournament-trophy"><ResilientImage src={selectedDefinition.trophyImageUrl} alt={`Troféu de ${selectedDefinition.name}`} fallback={<Trophy size={34} />} /></div>
            <div><p className="eyebrow">TORNEIO DO SAVE · {statusLabel(selectedState).toUpperCase()}</p><h2>{selectedDefinition.name}</h2><p>{formatName(selectedDefinition.format)} · {selectedDefinition.legs === 'double' ? 'ida e volta' : 'jogo único'}{winner ? ` · Campeão: ${winner.name}` : ''}</p></div>
            <Badge tone={selectedState?.status === 'completed' ? 'positive' : selectedState?.status === 'active' ? 'info' : 'warning'}>{statusLabel(selectedState)}</Badge>
          </header>

          {!selectedState ? (
            <div className="custom-tournament-body">
              <section><p className="eyebrow">PARTICIPANTES</p><div className="custom-tournament-teams">{selectedDefinition.participants.map((participant, index) => <button type="button" key={participant.id} onClick={(event) => openClubDetails(presentClub(participant.id), null, event.currentTarget)}><span>{String(index + 1).padStart(2, '0')}</span><ClubMark code={participant.abbreviation || compactCode(participant.name)} color={participant.colors[0] || '#c8ff3d'} darkThemeColor={participant.darkThemeColor} lightThemeColor={participant.lightThemeColor} imageUrl={participant.crestImageUrl} size="sm" /><strong>{participant.name}</strong><small>{participant.division || participant.country || 'Divisão a definir'}</small></button>)}</div><p className="form-note">Calendário ainda não foi gerado para este save.</p></section>
              <aside><p className="eyebrow">REGULAMENTO</p><dl><div><dt>Formato</dt><dd>{formatName(selectedDefinition.format)}</dd></div><div><dt>Turnos</dt><dd>{selectedDefinition.legs === 'double' ? 'Ida e volta' : 'Jogo único'}</dd></div><div><dt>Times</dt><dd>{selectedDefinition.teamCount}</dd></div></dl></aside>
            </div>
          ) : (
            <>
              <div className="custom-tournament-body">
                <section>
                  {leagueStage && <CompetitionTable title={selectedDefinition.name} standings={leagueStage.standings} managedClubIds={clubIds} presentClub={presentClub} onClubSelect={openClubDetails} />}
                  {groupsStage?.groups.map((group) => <CompetitionTable key={group.id} title={`${group.name} · ${groupsStage.qualifiersPerGroup} classificam`} standings={group.standings} managedClubIds={clubIds} presentClub={presentClub} onClubSelect={openClubDetails} />)}
                  {!leagueStage && !groupsStage && !knockoutStage && <p className="form-note">Fases ainda não disponíveis.</p>}
                </section>
                <aside>
                  <p className="eyebrow">JOGOS</p>
                  {visibleFixtures.length ? visibleFixtures.map((fixture) => {
                    const home = presentClub(fixture.homeClubId);
                    const away = presentClub(fixture.awayClubId);
                    return <div className="next-opponent" key={fixture.id}><Target size={16} /><span><span className="competition-fixture-clubs"><button type="button" onClick={(event) => openClubDetails(home, null, event.currentTarget)}>{home.name}</button><i>×</i><button type="button" onClick={(event) => openClubDetails(away, null, event.currentTarget)}>{away.name}</button></span><small>{fixture.result ? `${fixture.result.score[0]}–${fixture.result.score[1]} · ${fixture.stageId}` : `${formatDate(fixture.scheduledAt)} · ${fixture.stageId}`}</small></span><strong>{fixture.status === 'completed' ? 'F' : `R${fixture.round}`}</strong></div>;
                  }) : <p className="form-note">Nenhum jogo disponível.</p>}
                  <p className="eyebrow">DESEMPATE</p><ol>{selectedState.tiebreakers.map((criterion) => <li key={criterion}>{tiebreakerLabel(criterion)}</li>)}</ol>
                </aside>
              </div>
              {knockoutStage && <KnockoutBracket stage={knockoutStage} fixtures={selectedState.fixtures} presentClub={presentClub} onClubSelect={openClubDetails} />}
            </>
          )}
        </section>
      ) : (
        <section className="continental-empty"><Trophy size={34} /><p className="eyebrow">COMPETIÇÕES DO SAVE</p><h2>Nenhum torneio personalizado ativo.</h2><p>Ative um torneio no Editor para gerar calendário, classificação e chave reais.</p></section>
      )}
      </div>
    </main>
  );
}
