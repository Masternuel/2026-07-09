import { useEffect, useRef, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { Toast } from './components/shared/Toast';
import { useAuth } from './hooks/useAuth';
import { useClubCatalog } from './hooks/useClubCatalog';
import { useCareerState } from './hooks/useCareerState';
import { useLeagueCatalog } from './hooks/useLeagueCatalog';
import { usePlayerCatalog } from './hooks/usePlayerCatalog';
import { useOpponentStudy } from './hooks/useOpponentStudy';
import { useRealtimeNotifications } from './hooks/useRealtimeNotifications';
import { useTournamentCatalog } from './hooks/useTournamentCatalog';
import { useRoom } from './hooks/useRoom';
import { useServerMatch } from './hooks/useServerMatch';
import { useSocket } from './hooks/useSocket';
import { apiRequest } from './lib/apiClient';
import type {
  AppStage,
  ClubChoice,
  PressConferenceAnswerInput,
  PressConferenceSubmissionResponse,
  RouteKey,
} from './types';
import { EntryView } from './views/EntryView';
import { HomeView } from './views/HomeView';
import { LobbyView } from './views/LobbyView';
import { MatchView } from './views/MatchView';
import { PressConferenceView } from './views/PressConferenceView';
import { SquadView } from './views/SquadView';
import { TacticsView } from './views/TacticsView';
import { CoachCareerView } from './views/coach/CoachCareerView';
import { EditorView } from './views/editor/EditorView';
import { FinanceView } from './views/club/FinanceView';
import { MarketView } from './views/club/MarketView';
import { StadiumView } from './views/club/StadiumView';
import { StaffView } from './views/club/StaffView';
import { ConfigView } from './views/media/ConfigView';
import { NewsView } from './views/media/NewsView';
import { CalendarView } from './views/season/CalendarView';
import { CompetitionsView } from './views/season/CompetitionsView';
import { RankingsView } from './views/season/RankingsView';
import { ReportsView } from './views/season/ReportsView';

function sameClubId(left: unknown, right: unknown) {
  return typeof left === 'string'
    && typeof right === 'string'
    && left.toLocaleUpperCase('pt-BR') === right.toLocaleUpperCase('pt-BR');
}

function sameFixtureId(left: unknown, right: unknown) {
  return typeof left === 'string'
    && typeof right === 'string'
    && left.toLocaleLowerCase('pt-BR') === right.toLocaleLowerCase('pt-BR');
}

function sameTeamName(left: unknown, right: unknown) {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
  return typeof left === 'string'
    && typeof right === 'string'
    && normalize(left) === normalize(right);
}

const unavailableClub: ClubChoice = {
  id: '',
  name: 'Clube indisponível',
  code: 'CLB',
  city: 'Local não informado',
  stars: 0,
  budget: 'Não informado',
  color: '#6b7280',
};

function pressConferenceToast(response?: PressConferenceSubmissionResponse) {
  if (!response) return 'Coletiva encerrada. Próxima rodada liberada.';
  if (response.alreadySubmitted) return 'Esta coletiva já estava registrada. Repercussões preservadas.';
  const delta = response.effects?.squadMoraleDelta ?? 0;
  const affectedPlayers = response.effects?.playerMoraleChanges?.length ?? 0;
  const morale = delta > 0
    ? `Moral do elenco +${delta}.`
    : delta < 0
      ? `Moral do elenco ${delta}.`
      : 'Moral do elenco mantida.';
  const players = affectedPlayers > 0
    ? ` ${affectedPlayers} jogador${affectedPlayers === 1 ? '' : 'es'} recebeu${affectedPlayers === 1 ? '' : 'ram'} ajuste adicional por setor.`
    : '';
  return `Coletiva registrada. ${morale}${players} Repercussão publicada no feed.`;
}

function App() {
  const auth = useAuth();
  const realtime = useSocket({
    enabled: auth.status === 'authenticated',
    identity: auth.identity,
    getIdToken: auth.getIdToken,
  });
  const rooms = useRoom(realtime.socket, realtime.state);
  const [stage, setStage] = useState<AppStage>('entry');
  const [route, setRoute] = useState<RouteKey>('home');
  const roomCode = rooms.room?.code;
  useRealtimeNotifications({
    socket: realtime.socket,
    roomCode,
    managerId: auth.identity?.uid,
  });
  const careerState = useCareerState(
    roomCode,
    rooms.room?.status === 'active' && stage === 'game' && route === 'squad',
  );
  const leagueCatalog = useLeagueCatalog(roomCode);
  const clubCatalog = useClubCatalog(leagueCatalog.leagues, roomCode);
  const onlineMatch = useServerMatch(
    realtime.socket,
    rooms.room,
    auth.status === 'authenticated' && rooms.room?.status === 'active',
  );
  const [club, setClub] = useState<ClubChoice>(unavailableClub);
  const playerCatalog = usePlayerCatalog(club, roomCode);
  const opponentStudy = useOpponentStudy(
    roomCode,
    rooms.room?.revision ?? 0,
    rooms.room?.status === 'active' && stage === 'game',
  );
  const tournamentCatalog = useTournamentCatalog(roomCode);
  const [toast, setToast] = useState<string | null>(null);
  const refreshedResultKeyRef = useRef<string | null>(null);
  const roomManagers = Array.isArray(rooms.room?.managers) ? rooms.room.managers : [];
  const roomFixtures = Array.isArray(rooms.room?.fixtureSchedule) ? rooms.room.fixtureSchedule : [];
  const roomLineups = Array.isArray(rooms.room?.lineups) ? rooms.room.lineups : [];
  const managerRecord = roomManagers.find((manager) => manager.id === auth.identity?.uid) ?? null;
  const managerClubId = managerRecord?.clubId ?? null;
  const hasManagerClub = Boolean(managerClubId);
  const managerLineup = roomLineups.find((lineup) => lineup.managerId === auth.identity?.uid);
  const managerLineupIds = managerLineup?.lineupIds;
  const completedFixtureIds = new Set(
    (Array.isArray(rooms.room?.completedFixtureIds) ? rooms.room.completedFixtureIds : [])
      .filter((fixtureId): fixtureId is string => typeof fixtureId === 'string')
      .map((fixtureId) => fixtureId.toLocaleLowerCase('pt-BR')),
  );
  const managerFixture = roomFixtures.find((fixture) => (
    typeof fixture.fixtureId === 'string'
    && !completedFixtureIds.has(fixture.fixtureId.toLocaleLowerCase('pt-BR'))
    && (sameClubId(fixture.homeClubId, managerClubId) || sameClubId(fixture.awayClubId, managerClubId))
  )) ?? null;
  const opponentName = managerFixture
    ? sameClubId(managerFixture.homeClubId, managerClubId)
      ? managerFixture.awayTeam
      : managerFixture.homeTeam
    : 'próximo adversário';
  const finishedFixture = roomFixtures.find((fixture) => sameFixtureId(fixture.fixtureId, onlineMatch.result?.fixtureId)) ?? null;
  const lastCompletedMatch = rooms.room?.lastCompletedMatch;
  const persistedFinishedMatch = lastCompletedMatch?.id === onlineMatch.result?.id
    ? lastCompletedMatch
    : null;
  const resultPressSubmissions = Array.isArray(onlineMatch.result?.pressConferenceSubmissions)
    ? onlineMatch.result.pressConferenceSubmissions.filter((submission) => submission && typeof submission === 'object')
    : [];
  const persistedPressSubmissions = Array.isArray(persistedFinishedMatch?.pressConferenceSubmissions)
    ? persistedFinishedMatch.pressConferenceSubmissions.filter((submission) => submission && typeof submission === 'object')
    : [];
  const pressConferenceAlreadySubmitted = Boolean(auth.identity?.uid && [
    ...resultPressSubmissions,
    ...persistedPressSubmissions,
  ].some((submission) => submission.managerId === auth.identity?.uid));
  const managerInFinishedMatch = Boolean(onlineMatch.result && (
    (finishedFixture && (sameClubId(finishedFixture.homeClubId, managerClubId) || sameClubId(finishedFixture.awayClubId, managerClubId)))
    || sameTeamName(onlineMatch.result.homeTeam, club.name)
    || sameTeamName(onlineMatch.result.awayTeam, club.name)
  ) && hasManagerClub && !pressConferenceAlreadySubmitted);

  useEffect(() => {
    if (auth.status === 'authenticated' && stage === 'entry') setStage('lobby');
    if (auth.status === 'anonymous') setStage('entry');
  }, [auth.status, stage]);

  useEffect(() => {
    if (!auth.identity || !rooms.room) {
      setClub(unavailableClub);
      return;
    }
    const managers = Array.isArray(rooms.room.managers) ? rooms.room.managers : [];
    const manager = managers.find((candidate) => candidate?.id === auth.identity?.uid);
    if (manager?.clubId) {
      const normalizedClubId = manager.clubId.trim().toLocaleUpperCase('pt-BR');
      const catalogClub = clubCatalog.clubs.find((candidate) => (
        candidate.id.trim().toLocaleUpperCase('pt-BR') === normalizedClubId
        || candidate.code.trim().toLocaleUpperCase('pt-BR') === normalizedClubId
      ));
      const roomLeague = rooms.room.competitionCatalog?.find((league) => (
        league.clubs.some((candidate) => (
          candidate.id.trim().toLocaleUpperCase('pt-BR') === normalizedClubId
          || candidate.code.trim().toLocaleUpperCase('pt-BR') === normalizedClubId
        ))
      ));
      const roomClub = roomLeague?.clubs.find((candidate) => (
        candidate.id.trim().toLocaleUpperCase('pt-BR') === normalizedClubId
        || candidate.code.trim().toLocaleUpperCase('pt-BR') === normalizedClubId
      ));
      setClub(catalogClub ?? (roomClub ? {
        id: roomClub.id,
        name: roomClub.name,
        code: roomClub.code,
        city: 'Local não informado',
        stars: Math.max(0, Math.min(5, Number(roomClub.reputation) / 20)),
        budget: 'Não informado',
        color: roomClub.color || '#6b7280',
        darkThemeColor: roomClub.darkThemeColor,
        lightThemeColor: roomClub.lightThemeColor,
        crestImageUrl: roomClub.crestImageUrl,
        stadium: roomClub.stadium,
        stadiumCapacity: roomClub.stadiumCapacity,
        leagueId: roomLeague?.id,
        leagueName: roomLeague?.name,
        division: roomLeague?.division,
        country: roomLeague?.country,
      } : { ...unavailableClub, id: manager.clubId, code: manager.clubId.slice(0, 8).toUpperCase() }));
    } else {
      setClub(unavailableClub);
    }
    if (rooms.room.status === 'active' && stage === 'lobby') {
      setStage('game');
      setRoute(manager?.clubId ? 'home' : 'coach-career');
    }
  }, [rooms.room, auth.identity, stage, clubCatalog.clubs]);

  useEffect(() => {
    if (stage !== 'game' || rooms.room?.status !== 'active' || hasManagerClub) return;
    if (route !== 'coach-career' && route !== 'news' && route !== 'rankings' && route !== 'settings') {
      setRoute('coach-career');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [hasManagerClub, rooms.room?.status, route, stage]);

  useEffect(() => {
    if (!hasManagerClub || stage !== 'game' || (onlineMatch.phase !== 'running' && onlineMatch.phase !== 'halftime')) return;
    setRoute('match');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [hasManagerClub, stage, onlineMatch.phase, onlineMatch.match?.id]);

  useEffect(() => {
    const resultId = onlineMatch.result?.id;
    const fixtureId = onlineMatch.result?.fixtureId ?? onlineMatch.match?.fixtureId;
    if (!roomCode || !resultId) return;
    const resultKey = `${roomCode}:${fixtureId ?? 'sem-fixture'}:${resultId}`;
    if (refreshedResultKeyRef.current === resultKey) return;
    refreshedResultKeyRef.current = resultKey;
    playerCatalog.refresh();
  }, [onlineMatch.match?.fixtureId, onlineMatch.result?.fixtureId, onlineMatch.result?.id, playerCatalog.refresh, roomCode]);

  useEffect(() => {
    if (stage !== 'game' || rooms.room) return;
    onlineMatch.reset();
    setStage('lobby');
    setRoute('home');
  }, [stage, rooms.room, onlineMatch.reset]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function showToast(message: string) {
    setToast(message);
  }

  function navigate(next: RouteKey) {
    if (!hasManagerClub && !['coach-career', 'news', 'rankings', 'settings'].includes(next)) {
      setRoute('coach-career');
      showToast('Assuma um clube para abrir esta area.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function refreshMarketData() {
    playerCatalog.refresh();
    careerState.refresh();
  }

  async function leaveSession() {
    rooms.clearRoom();
    setStage('entry');
    setRoute('home');
    await auth.signOut();
  }

  function returnToSaves() {
    rooms.clearRoom();
    onlineMatch.reset();
    setStage('lobby');
    setRoute('home');
  }

  function renderRoute() {
    const serverMatch = auth.identity ? onlineMatch : null;
    if (!hasManagerClub && !['coach-career', 'news', 'rankings', 'settings'].includes(route)) {
      return <CoachCareerView roomCode={roomCode} revision={rooms.room?.revision ?? 0} onToast={showToast} />;
    }
    const homeView = <HomeView players={playerCatalog.players} savedLineup={managerLineup} savedLineupIds={managerLineupIds} opponentStudy={opponentStudy.study} onNavigate={navigate} onToast={showToast} club={club} room={rooms.room} managerId={auth.identity?.uid ?? ''} onlineMatch={serverMatch} />;
    switch (route) {
      case 'home': return homeView;
      case 'coach-career': return <CoachCareerView roomCode={roomCode} revision={rooms.room?.revision ?? 0} onToast={showToast} />;
      case 'squad': return <SquadView players={playerCatalog.players} club={club} room={rooms.room} socket={realtime.socket} managerId={auth.identity?.uid ?? ''} careerState={careerState} onRosterChanged={refreshMarketData} onToast={showToast} />;
      case 'tactics': return <TacticsView players={playerCatalog.players} club={club} room={rooms.room} socket={realtime.socket} managerId={auth.identity?.uid ?? ''} onRosterChanged={refreshMarketData} opponentName={opponentName} opponentStudy={opponentStudy.study} opponentStudyLoading={opponentStudy.loading} opponentStudyError={opponentStudy.error} studyDepth={opponentStudy.depth} onStudyDepthChange={opponentStudy.setDepth} savedLineup={managerLineup} savedLineupIds={managerLineupIds} currentSeason={rooms.room?.currentSeason} onSaveLineup={serverMatch?.saveLineup} onToast={showToast} />;
      case 'calendar': return <CalendarView room={rooms.room} managerClubId={managerClubId} onNavigate={navigate} />;
      case 'competitions': return <CompetitionsView club={club} room={rooms.room} tournaments={tournamentCatalog.tournaments} loadingTournaments={tournamentCatalog.loading} tournamentError={tournamentCatalog.error} clubs={clubCatalog.clubs} managerPlayers={playerCatalog.players} socket={realtime.socket} managerId={auth.identity?.uid ?? ''} onRosterChanged={refreshMarketData} onToast={showToast} />;
      case 'market': return <MarketView
        room={rooms.room}
        club={club}
        players={playerCatalog.players}
        socket={realtime.socket}
        managerId={auth.identity?.uid ?? ''}
        onRosterChanged={refreshMarketData}
        onToast={showToast}
      />;
      case 'finance': return <FinanceView
        club={club}
        room={rooms.room}
        roomCode={roomCode}
        socket={realtime.socket}
        managerId={auth.identity?.uid ?? ''}
        players={playerCatalog.players}
        onRosterChanged={refreshMarketData}
        onToast={showToast}
      />;
      case 'stadium': return <StadiumView club={club} room={rooms.room} socket={realtime.socket} managerId={auth.identity?.uid ?? ''} onToast={showToast} />;
      case 'rankings': return <RankingsView
        players={playerCatalog.players}
        club={club}
        clubs={clubCatalog.clubs}
        room={rooms.room}
        socket={realtime.socket}
        managerId={auth.identity?.uid ?? ''}
        onRosterChanged={refreshMarketData}
        onToast={showToast}
      />;
      case 'news': return <NewsView onToast={showToast} room={rooms.room} socket={realtime.socket} club={club} managerId={auth.identity?.uid ?? ''} />;
      case 'staff': return <StaffView club={club} room={rooms.room} socket={realtime.socket} managerId={auth.identity?.uid ?? ''} onToast={showToast} />;
      case 'reports': return <ReportsView room={rooms.room} club={club} players={playerCatalog.players} />;
      case 'match': return <MatchView players={playerCatalog.players} savedLineup={managerLineup} savedLineupIds={managerLineupIds} opponentStudy={opponentStudy.study} managerId={auth.identity?.uid ?? ''} onToast={showToast} onNavigate={navigate} onlineMatch={serverMatch} room={rooms.room} club={club} />;
      case 'press-conference': return managerInFinishedMatch
        ? <PressConferenceView
            result={onlineMatch.result}
            club={club}
            onSubmit={async (answers: PressConferenceAnswerInput[]) => {
              if (!auth.identity || !roomCode || !onlineMatch.result?.id) {
                throw new Error('A partida encerrada não está disponível para registrar a coletiva.');
              }
              return apiRequest<PressConferenceSubmissionResponse>(
                `/api/news/${encodeURIComponent(roomCode)}/press-conferences`,
                { identity: auth.identity, getIdToken: auth.getIdToken },
                {
                  method: 'POST',
                  body: { matchId: onlineMatch.result.id, answers },
                  timeoutMs: 30_000,
                },
              );
            }}
            onComplete={(response) => {
              playerCatalog.refresh();
              onlineMatch.reset();
              navigate('home');
              showToast(pressConferenceToast(response));
            }}
          />
        : homeView;
      case 'settings': return <ConfigView onToast={showToast} />;
      default: return homeView;
    }
  }

  if (auth.status === 'loading') {
    return <main className="auth-loading-screen" aria-live="polite"><span className="button-spinner" /> Conectando ao Firebase…</main>;
  }

  return (
    <>
      {(stage === 'entry' || !auth.identity) && <EntryView onAuthenticated={() => setStage('lobby')} />}
      {stage === 'lobby' && auth.identity && (
        <LobbyView
          clubs={clubCatalog.clubs}
          leagues={leagueCatalog.leagues}
          catalogLoading={clubCatalog.loading}
          catalogSource={clubCatalog.source}
          catalogError={clubCatalog.error}
          leagueCatalogLoading={leagueCatalog.loading}
          leagueCatalogError={leagueCatalog.error}
          identity={auth.identity}
          room={rooms.room}
          savedRooms={rooms.savedRooms}
          connectionState={realtime.state}
          loading={rooms.loading}
          pending={rooms.pending}
          error={rooms.error ?? realtime.error}
          onBack={() => void leaveSession()}
          onDeselectRoom={rooms.clearRoom}
          onCreate={rooms.createRoom}
          onJoin={rooms.joinRoom}
          onSelectSave={rooms.selectRoom}
          onDeleteSave={rooms.deleteRoom}
          onReady={rooms.setReady}
          onStart={rooms.startRoom}
          onEnterGame={() => { setStage('game'); setRoute(hasManagerClub ? 'home' : 'coach-career'); }}
          onOpenEditor={() => { rooms.clearRoom(); setStage('editor'); }}
          onRefreshCatalog={() => { leagueCatalog.refresh(); clubCatalog.refresh(); }}
          onClubSelected={setClub}
          onToast={showToast}
        />
      )}
      {stage === 'editor' && auth.identity && (
        <EditorView
          identity={auth.identity}
          getIdToken={auth.getIdToken}
          onBack={() => { leagueCatalog.refresh(); clubCatalog.refresh(); playerCatalog.refresh(); tournamentCatalog.refresh(); setStage('lobby'); }}
          onToast={showToast}
        />
      )}
      {stage === 'game' && auth.identity && (
        <AppShell
          route={route}
          club={club}
          manager={auth.identity}
          room={rooms.room}
          nextFixture={managerFixture}
          hasClub={hasManagerClub}
          commitmentLabel={onlineMatch.phase === 'finished'
            ? managerInFinishedMatch
              ? 'Coletiva pós-jogo pendente'
              : 'Rodada concluída · liberar próxima'
            : undefined}
          onNavigate={(next) => {
            if (next === 'match' && onlineMatch.phase === 'finished') {
              if (managerInFinishedMatch) navigate('press-conference');
              else {
                onlineMatch.reset();
                navigate('home');
              }
              return;
            }
            navigate(next);
          }}
          onExit={returnToSaves}
        >
          {hasManagerClub && playerCatalog.loading && (
            <div className="form-note" role="status">Carregando o elenco real do clube…</div>
          )}
          {hasManagerClub && playerCatalog.error && (
            <div className="form-error" role="alert">
              <span>{playerCatalog.error}</span>{' '}
              <button type="button" onClick={playerCatalog.refresh}>Tentar novamente</button>
            </div>
          )}
          {renderRoute()}
        </AppShell>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

export default App;
