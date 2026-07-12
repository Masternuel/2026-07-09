import { useEffect, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { Toast } from './components/shared/Toast';
import { clubByCode, defaultClub } from './constants/clubs';
import { useAuth } from './hooks/useAuth';
import { useClubCatalog } from './hooks/useClubCatalog';
import { useRoom } from './hooks/useRoom';
import { useServerMatch } from './hooks/useServerMatch';
import { useSocket } from './hooks/useSocket';
import type { AppStage, ClubChoice, RouteKey } from './types';
import { EntryView } from './views/EntryView';
import { HomeView } from './views/HomeView';
import { LobbyView } from './views/LobbyView';
import { MatchView } from './views/MatchView';
import { PressConferenceView } from './views/PressConferenceView';
import { SquadView } from './views/SquadView';
import { TacticsView } from './views/TacticsView';
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

function sameClubId(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLocaleUpperCase('pt-BR') === right.toLocaleUpperCase('pt-BR'));
}

function sameFixtureId(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLocaleLowerCase('pt-BR') === right.toLocaleLowerCase('pt-BR'));
}

function sameTeamName(left: string | null | undefined, right: string | null | undefined) {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
  return Boolean(left && right && normalize(left) === normalize(right));
}

function App() {
  const auth = useAuth();
  const clubCatalog = useClubCatalog();
  const realtime = useSocket({
    enabled: auth.status === 'authenticated',
    identity: auth.identity,
    getIdToken: auth.getIdToken,
  });
  const rooms = useRoom(realtime.socket, realtime.state);
  const onlineMatch = useServerMatch(
    realtime.socket,
    rooms.room,
    auth.identity?.mode === 'firebase' && rooms.room?.status === 'active',
  );
  const [stage, setStage] = useState<AppStage>('entry');
  const [route, setRoute] = useState<RouteKey>('home');
  const [club, setClub] = useState<ClubChoice>(defaultClub);
  const [toast, setToast] = useState<string | null>(null);
  const currentFixture = rooms.room?.fixtureSchedule?.find((fixture) => sameFixtureId(fixture.fixtureId, rooms.room?.currentFixtureId)) ?? null;
  const managerClubId = rooms.room?.managers.find((manager) => manager.id === auth.identity?.uid)?.clubId ?? club.id;
  const completedFixtureIds = new Set((rooms.room?.completedFixtureIds ?? []).map((fixtureId) => fixtureId.toLocaleLowerCase('pt-BR')));
  const managerFixture = rooms.room?.fixtureSchedule?.find((fixture) => (
    !completedFixtureIds.has(fixture.fixtureId.toLocaleLowerCase('pt-BR'))
    && (sameClubId(fixture.homeClubId, managerClubId) || sameClubId(fixture.awayClubId, managerClubId))
  )) ?? null;
  const opponentName = managerFixture
    ? sameClubId(managerFixture.homeClubId, managerClubId)
      ? managerFixture.awayTeam
      : managerFixture.homeTeam
    : 'próximo adversário';
  const finishedFixture = rooms.room?.fixtureSchedule?.find((fixture) => sameFixtureId(fixture.fixtureId, onlineMatch.result?.fixtureId)) ?? null;
  const managerInFinishedMatch = Boolean(onlineMatch.result && (
    (finishedFixture && (sameClubId(finishedFixture.homeClubId, managerClubId) || sameClubId(finishedFixture.awayClubId, managerClubId)))
    || sameTeamName(onlineMatch.result.homeTeam, club.name)
    || sameTeamName(onlineMatch.result.awayTeam, club.name)
  ));

  useEffect(() => {
    if (auth.status === 'authenticated' && stage === 'entry') setStage('lobby');
    if (auth.status === 'anonymous') setStage('entry');
  }, [auth.status, stage]);

  useEffect(() => {
    if (!auth.identity || !rooms.room) return;
    const manager = rooms.room.managers.find((candidate) => candidate.id === auth.identity?.uid);
    if (manager?.clubId) setClub(clubByCode(manager.clubId, clubCatalog.clubs));
    if (rooms.room.status === 'active' && stage === 'lobby') {
      setStage('game');
      setRoute('home');
    }
  }, [rooms.room, auth.identity, stage, clubCatalog.clubs]);

  useEffect(() => {
    if (stage !== 'game' || onlineMatch.phase !== 'running') return;
    setRoute('match');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [stage, onlineMatch.phase, onlineMatch.match?.id]);

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
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    const serverMatch = auth.identity?.mode === 'firebase' ? onlineMatch : null;
    const homeView = <HomeView onNavigate={navigate} onToast={showToast} club={club} room={rooms.room} managerId={auth.identity?.uid ?? ''} onlineMatch={serverMatch} />;
    switch (route) {
      case 'home': return homeView;
      case 'squad': return <SquadView onToast={showToast} />;
      case 'tactics': return <TacticsView club={club} opponentName={opponentName} onToast={showToast} />;
      case 'calendar': return <CalendarView room={rooms.room} onNavigate={navigate} />;
      case 'competitions': return <CompetitionsView club={club} room={rooms.room} />;
      case 'market': return <MarketView onToast={showToast} />;
      case 'finance': return <FinanceView onToast={showToast} />;
      case 'stadium': return <StadiumView onToast={showToast} />;
      case 'rankings': return <RankingsView />;
      case 'news': return <NewsView onToast={showToast} />;
      case 'staff': return <StaffView onToast={showToast} />;
      case 'reports': return <ReportsView />;
      case 'match': return <MatchView onToast={showToast} onNavigate={navigate} onlineMatch={serverMatch} room={rooms.room} club={club} />;
      case 'press-conference': return managerInFinishedMatch
        ? <PressConferenceView result={onlineMatch.result} club={club} onComplete={() => { onlineMatch.reset(); navigate('home'); showToast('Coletiva encerrada. Próxima rodada liberada.'); }} />
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
      {stage === 'entry' && <EntryView onAuthenticated={() => setStage('lobby')} />}
      {stage === 'lobby' && auth.identity && (
        <LobbyView
          clubs={clubCatalog.clubs}
          catalogLoading={clubCatalog.loading}
          catalogSource={clubCatalog.source}
          catalogError={clubCatalog.error}
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
          onEnterGame={() => { setStage('game'); setRoute('home'); }}
          onClubSelected={setClub}
          onToast={showToast}
        />
      )}
      {stage === 'game' && auth.identity && (
        <AppShell
          route={route}
          club={club}
          manager={auth.identity}
          nextFixture={currentFixture}
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
          {renderRoute()}
        </AppShell>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

export default App;
