import { useEffect, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { Toast } from './components/shared/Toast';
import { clubByCode, defaultClub } from './constants/clubs';
import { useAuth } from './hooks/useAuth';
import { useRoom } from './hooks/useRoom';
import { useServerMatch } from './hooks/useServerMatch';
import { useSocket } from './hooks/useSocket';
import type { AppStage, ClubChoice, RouteKey } from './types';
import { EntryView } from './views/EntryView';
import { HomeView } from './views/HomeView';
import { LobbyView } from './views/LobbyView';
import { MatchView } from './views/MatchView';
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

function App() {
  const auth = useAuth();
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

  useEffect(() => {
    if (auth.status === 'authenticated' && stage === 'entry') setStage('lobby');
    if (auth.status === 'anonymous') setStage('entry');
  }, [auth.status, stage]);

  useEffect(() => {
    if (!auth.identity || !rooms.room) return;
    const manager = rooms.room.managers.find((candidate) => candidate.id === auth.identity?.uid);
    if (manager?.clubId) setClub(clubByCode(manager.clubId));
    if (rooms.room.status === 'active' && stage === 'lobby') {
      setStage('game');
      setRoute('home');
    }
  }, [rooms.room, auth.identity, stage]);

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

  function renderRoute() {
    switch (route) {
      case 'home': return <HomeView onNavigate={navigate} />;
      case 'squad': return <SquadView onToast={showToast} />;
      case 'tactics': return <TacticsView onToast={showToast} />;
      case 'calendar': return <CalendarView />;
      case 'competitions': return <CompetitionsView />;
      case 'market': return <MarketView onToast={showToast} />;
      case 'finance': return <FinanceView onToast={showToast} />;
      case 'stadium': return <StadiumView onToast={showToast} />;
      case 'rankings': return <RankingsView />;
      case 'news': return <NewsView onToast={showToast} />;
      case 'staff': return <StaffView onToast={showToast} />;
      case 'reports': return <ReportsView />;
      case 'match': return <MatchView onToast={showToast} onlineMatch={auth.identity?.mode === 'firebase' ? onlineMatch : null} />;
      case 'settings': return <ConfigView onToast={showToast} />;
      default: return <HomeView onNavigate={navigate} />;
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
          identity={auth.identity}
          room={rooms.room}
          connectionState={realtime.state}
          loading={rooms.loading}
          pending={rooms.pending}
          error={rooms.error ?? realtime.error}
          onBack={() => void leaveSession()}
          onCreate={rooms.createRoom}
          onJoin={rooms.joinRoom}
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
          onNavigate={navigate}
          onExit={() => void leaveSession()}
        >
          {renderRoute()}
        </AppShell>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

export default App;
