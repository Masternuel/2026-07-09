import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { DesktopPeerPanel } from '../components/lobby/DesktopPeerPanel';
import { CareerOverview } from '../components/menu/CareerOverview';
import { CreditsPage } from '../components/menu/CreditsPage';
import { EditorAvailabilityPage } from '../components/menu/EditorAvailabilityPage';
import { ExitMenuModal } from '../components/menu/ExitMenuModal';
import { HistoryPage } from '../components/menu/HistoryPage';
import { MainMenuLayout } from '../components/menu/MainMenuLayout';
import { MultiplayerPage } from '../components/menu/MultiplayerPage';
import { ProfilePage } from '../components/menu/ProfilePage';
import { getMenuCapabilities, latestAuthorizedSave, sortAuthorizedSaves, type MainMenuPageId } from '../components/menu/mainMenuModel';
import { Button } from '../components/shared/Button';
import { LobbyView, type LobbyPanelId, type LobbyViewProps } from './LobbyView';
import { ConfigView } from './media/ConfigView';

export interface MainMenuViewProps extends LobbyViewProps {
  page: MainMenuPageId;
  onPageChange: (page: MainMenuPageId) => void;
}

/** Pre-game composition only. Room state and all career operations remain owned by App/useRoom. */
export function MainMenuView(props: MainMenuViewProps) {
  const capabilities = getMenuCapabilities(props.identity.mode);
  const saves = useMemo(() => sortAuthorizedSaves(props.savedRooms, props.identity), [props.savedRooms, props.identity]);
  const latest = useMemo(() => latestAuthorizedSave(saves, props.identity), [saves, props.identity]);
  const [continuing, setContinuing] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const actionInFlight = useRef(false);
  const busy = props.pending || continuing;
  const continueReason = props.loading ? 'Consultando saves…' : !capabilities.canResume ? 'Retome pelo anfitrião, em Multiplayer.' : !latest ? 'Nenhum save disponível nesta identidade.' : '';
  const canContinue = !props.loading && capabilities.canResume && Boolean(latest);
  const panel: LobbyPanelId = props.page === 'new-game' && capabilities.canCreate ? 'create' : props.page === 'multiplayer' && capabilities.webRooms ? 'join' : 'saves';
  const showLobby = Boolean(props.room) || props.page === 'new-game' && capabilities.canCreate || props.page === 'career' && capabilities.canResume || props.page === 'multiplayer' && capabilities.webRooms;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('main-menu-content')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.page, props.room?.code]);

  async function continueCareer() {
    if (actionInFlight.current || busy || !canContinue || !latest || props.room) return;
    actionInFlight.current = true;
    setContinuing(true);
    props.onPageChange('continue');
    try {
      const room = await props.onSelectSave(latest.code);
      props.onToast(`${room.name} carregado.`);
    } catch (error) {
      props.onToast(error instanceof Error ? error.message : 'Não foi possível retomar a carreira.');
    } finally {
      actionInFlight.current = false;
      setContinuing(false);
      props.onPageChange('career');
    }
  }

  function navigate(page: MainMenuPageId) {
    if (props.room || continuing || exiting) return;
    if (page === 'continue') { void continueCareer(); return; }
    if (page === 'new-game' && !capabilities.canCreate) return;
    props.onPageChange(page);
  }

  function deselectRoom() {
    props.onDeselectRoom();
    props.onPageChange(props.identity.mode === 'peer' ? 'multiplayer' : 'career');
  }

  async function confirmExit() {
    if (exiting) return;
    setExiting(true);
    try {
      if (capabilities.desktop) window.close();
      else await props.onBack();
      setExitOpen(false);
    } catch (error) {
      props.onToast(error instanceof Error ? error.message : 'Não foi possível encerrar a sessão.');
    } finally {
      setExiting(false);
    }
  }

  return <>
    <MainMenuLayout identity={props.identity} page={props.page} connectionState={props.connectionState} canContinue={canContinue} continueReason={continueReason} pending={busy || exiting} sessionSelected={Boolean(props.room)} onNavigate={navigate} onExit={() => setExitOpen(true)}>
      {!props.room && props.error && <p className="form-error main-menu__error" role="alert">{props.error}</p>}
      {props.room ? <div className="menu-session-back"><Button variant="ghost" disabled={busy} icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={deselectRoom}>Voltar ao menu</Button><span>Finalize a preparação ou entre na temporada selecionada.</span></div> : <>
        {props.page === 'career' && <CareerOverview identity={props.identity} latest={latest} clubs={props.clubs} loading={props.loading} pending={busy} continueReason={continueReason} onContinue={() => void continueCareer()} onNavigate={navigate} />}
        {props.page === 'new-game' && <header className="menu-page-heading"><div><p className="eyebrow">CONFIGURE SUA TEMPORADA</p><h1>Novo Jogo</h1><p>{capabilities.canCreate ? 'Escolha a duração e as ligas. Na próxima etapa, você reserva seu clube.' : 'O anfitrião cria a carreira compartilhada. Conecte-se em Multiplayer.'}</p></div><Plus size={23} aria-hidden="true" /></header>}
        {props.page === 'continue' && <div className="menu-empty" role="status" aria-live="polite"><span className="button-spinner" /><h1>{continuing ? 'Retomando sua carreira…' : 'Continuar carreira'}</h1><p>{continuing ? 'Carregando o save mais recente disponível para esta identidade.' : continueReason || 'Use Continuar para retomar o save mais recente.'}</p></div>}
        {props.page === 'multiplayer' && <MultiplayerPage identity={props.identity} pending={busy} onCreate={() => navigate('new-game')} />}
        {props.page === 'editor' && <EditorAvailabilityPage identity={props.identity} onOpen={() => { if (capabilities.canEdit) props.onOpenEditor(); }} />}
        {props.page === 'settings' && <ConfigView onToast={props.onToast} showPeerPanel={false} embedded />}
        {props.page === 'profile' && <ProfilePage identity={props.identity} saveCount={saves.length} onSettings={() => navigate('settings')} />}
        {props.page === 'history' && <HistoryPage saves={saves} loading={props.loading} />}
        {props.page === 'credits' && <CreditsPage />}
      </>}
      <div hidden={!showLobby} className={`main-menu__lobby main-menu__lobby--${panel}`}>
        <LobbyView {...props} embedded panel={panel} savedRooms={saves} pending={busy || props.loading} error={props.room ? props.error : null} showPeerPanel={false} onDeselectRoom={deselectRoom} onPanelChange={(next) => navigate(next === 'create' ? 'new-game' : next === 'join' ? 'multiplayer' : 'career')} />
      </div>
      {capabilities.desktopPeer && <div className="main-menu__peer" hidden={!props.room && props.page !== 'multiplayer'}><DesktopPeerPanel identity={props.identity} room={props.room} /></div>}
    </MainMenuLayout>
    <ExitMenuModal open={exitOpen} desktop={capabilities.desktop} pending={exiting} onCancel={() => setExitOpen(false)} onConfirm={() => void confirmExit()} />
  </>;
}
