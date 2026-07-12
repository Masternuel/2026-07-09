import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, Check, ChevronRight, Copy, Link2, LockKeyhole, Plus, Radio, Save, Settings2, Shield, Zap } from 'lucide-react';
import { SaveManager } from '../components/lobby/SaveManager';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { ClubMark } from '../components/shared/ClubMark';
import { clubByCode, type ClubOption } from '../constants/clubs';
import type { ClubCatalogSource } from '../hooks/useClubCatalog';
import type { SocketState } from '../hooks/useSocket';
import type { ClubChoice, ManagerIdentity, Room, RoomCreatePayload } from '../types';

interface LobbyViewProps {
  clubs: ClubOption[];
  catalogLoading: boolean;
  catalogSource: ClubCatalogSource;
  catalogError: string | null;
  identity: ManagerIdentity;
  room: Room | null;
  savedRooms: Room[];
  connectionState: SocketState;
  loading: boolean;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onDeselectRoom: () => void;
  onCreate: (payload: RoomCreatePayload) => Promise<Room>;
  onJoin: (code: string) => Promise<Room>;
  onSelectSave: (code: string) => Promise<Room>;
  onDeleteSave: (code: string) => Promise<void>;
  onReady: (ready: boolean, clubId?: string) => Promise<Room>;
  onStart: () => Promise<Room>;
  onEnterGame: () => void;
  onClubSelected: (club: ClubChoice) => void;
  onToast: (message: string) => void;
}

const lobbyTabs = ['saves', 'create', 'join'] as const;

export function LobbyView(props: LobbyViewProps) {
  const [tab, setTab] = useState<'saves' | 'create' | 'join'>('saves');
  const [roomName, setRoomName] = useState('Noite dos Managers');
  const [selectedClub, setSelectedClub] = useState(() => props.clubs[0]?.id ?? 'AUR');
  const [seasonLength, setSeasonLength] = useState('3');
  const [maxManagers, setMaxManagers] = useState('6');

  const currentManager = props.room?.managers.find((manager) => manager.id === props.identity.uid);
  const selected = useMemo(
    () => clubByCode(selectedClub, props.clubs),
    [selectedClub, props.clubs],
  );
  const selectedExists = props.clubs.some((club) => club.id === selectedClub);
  const restoringSavedClub = Boolean(currentManager?.clubId && !selectedExists);
  const isOwner = props.room?.ownerId === props.identity.uid;
  const allReady = Boolean(props.room?.managers.length && props.room.managers.every((manager) => manager.ready));

  useEffect(() => {
    const savedClubId = currentManager?.clubId;
    setSelectedClub((current) => {
      if (savedClubId) return savedClubId;
      return props.clubs.some((club) => club.id === current)
        ? current
        : props.clubs[0]?.id ?? current;
    });
  }, [currentManager?.clubId, props.clubs]);

  async function createRoom() {
    try {
      await props.onCreate({
        name: roomName,
        activeLeagues: ['BR-A', 'BR-B', 'AR-A'],
        seasonLength: Number(seasonLength),
        maxManagers: Number(maxManagers),
      });
      props.onToast('Sala criada. Agora escolha seu clube.');
    } catch {
      // O hook mantém a mensagem de erro visível.
    }
  }

  async function submitJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await props.onJoin(String(data.get('roomCode') ?? '').toUpperCase());
      props.onToast('Sala encontrada. Escolha seu clube.');
    } catch {
      // O hook mantém a mensagem de erro visível.
    }
  }

  async function confirmClub() {
    try {
      await props.onReady(true, selected.id);
      props.onClubSelected(selected);
      props.onToast(`${selected.name} reservado para você.`);
    } catch {
      // O hook mantém a mensagem de erro visível.
    }
  }

  async function startSeason() {
    try {
      await props.onStart();
      props.onToast(`Temporada iniciada com o ${selected.name}.`);
    } catch {
      // O hook mantém a mensagem de erro visível.
    }
  }

  function copyCode() {
    if (!props.room) return;
    void navigator.clipboard?.writeText(props.room.code);
    props.onToast('Código da sala copiado.');
  }

  function changeTab(nextTab: typeof lobbyTabs[number], focus = false) {
    setTab(nextTab);
    if (focus) window.requestAnimationFrame(() => document.getElementById(`lobby-tab-${nextTab}`)?.focus());
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = lobbyTabs.indexOf(tab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % lobbyTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + lobbyTabs.length) % lobbyTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = lobbyTabs.length - 1;
    else return;
    event.preventDefault();
    changeTab(lobbyTabs[nextIndex], true);
  }

  const connectionLabel = props.connectionState === 'connected'
    ? 'TEMPO REAL CONECTADO'
    : props.connectionState === 'connecting' ? 'CONECTANDO AO SERVIDOR' : 'MODO LOCAL / RECONECTANDO';

  return (
    <main className="lobby-screen">
      <header className="lobby-header">
        <button onClick={props.room ? props.onDeselectRoom : props.onBack} className="back-button">
          <ArrowLeft size={17} /> {props.room ? 'Meus saves' : 'Sair'}
        </button>
        <div className="lobby-wordmark"><span className="wordmark-glyph"><Shield size={17} /></span>BOLA<span>MANAGER</span></div>
        <div className="connection-status"><span /> {connectionLabel}</div>
      </header>

      {!props.room ? (
        <section className="lobby-setup">
          <div className="lobby-intro">
            <p className="eyebrow">SALA PRIVADA</p>
            <h1>Monte sua mesa<br />de managers.</h1>
            <p>Crie uma temporada para comandar com os amigos ou entre usando um código de convite.</p>
            <div className="lobby-facts">
              <span><Radio size={17} /><strong>Tempo real</strong><small>Partidas e mercado sincronizados</small></span>
              <span><LockKeyhole size={17} /><strong>Sala fechada</strong><small>Somente managers convidados</small></span>
            </div>
          </div>

          <div className="lobby-config">
            <div className="segmented-control segmented-control--three" role="tablist" aria-label="Gerenciar saves">
              <button id="lobby-tab-saves" role="tab" aria-controls="lobby-panel-saves" aria-selected={tab === 'saves'} tabIndex={tab === 'saves' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => changeTab('saves')}><Save size={15} /> Meus saves</button>
              <button id="lobby-tab-create" role="tab" aria-controls="lobby-panel-create" aria-selected={tab === 'create'} tabIndex={tab === 'create' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => changeTab('create')}><Plus size={15} /> Criar sala</button>
              <button id="lobby-tab-join" role="tab" aria-controls="lobby-panel-join" aria-selected={tab === 'join'} tabIndex={tab === 'join' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => changeTab('join')}><Link2 size={15} /> Entrar</button>
            </div>

            {props.error && <p className="form-error" role="alert">{props.error}</p>}
            {props.loading && <p className="form-note">Buscando suas salas salvas no servidor…</p>}

            <div id="lobby-panel-saves" role="tabpanel" aria-labelledby="lobby-tab-saves" hidden={tab !== 'saves'}>
              <SaveManager
                saves={props.savedRooms}
                identity={props.identity}
                pending={props.pending}
                onSelect={props.onSelectSave}
                onDelete={props.onDeleteSave}
                onCreateNew={() => changeTab('create')}
                onToast={props.onToast}
              />
            </div>
            <div id="lobby-panel-create" role="tabpanel" aria-labelledby="lobby-tab-create" hidden={tab !== 'create'}>
              <div className="setup-form">
                <label><span>Nome da temporada</span><input value={roomName} onChange={(event) => setRoomName(event.target.value)} /></label>
                <div className="form-grid">
                  <label><span>Duração</span><select value={seasonLength} onChange={(event) => setSeasonLength(event.target.value)}><option value="1">1 temporada</option><option value="3">3 temporadas</option><option value="5">5 temporadas</option></select></label>
                  <label><span>Máx. managers</span><select value={maxManagers} onChange={(event) => setMaxManagers(event.target.value)}><option>4</option><option>6</option><option>8</option></select></label>
                </div>
                <fieldset className="league-selector">
                  <legend>Ligas ativas</legend>
                  <label><input type="checkbox" defaultChecked /><span>BR</span> Brasil · Séries A e B</label>
                  <label><input type="checkbox" defaultChecked /><span>AR</span> Argentina · Primera</label>
                  <label><input type="checkbox" /><span>EU</span> Top 5 da Europa</label>
                </fieldset>
                <Button variant="primary" loading={props.pending} disabled={props.pending} onClick={() => void createRoom()} icon={<ChevronRight size={16} />}>Criar e escolher clube</Button>
              </div>
            </div>
            <div id="lobby-panel-join" role="tabpanel" aria-labelledby="lobby-tab-join" hidden={tab !== 'join'}>
              <form className="setup-form" onSubmit={(event) => void submitJoin(event)}>
                <label><span>Código do convite</span><input name="roomCode" className="room-input" placeholder="BOLA-XXXX" maxLength={9} required /></label>
                <p className="form-note"><LockKeyhole size={14} /> O código possui o formato BOLA-XXXX.</p>
                <Button variant="primary" type="submit" loading={props.pending} disabled={props.pending} icon={<ChevronRight size={16} />}>Localizar sala</Button>
              </form>
            </div>
          </div>
        </section>
      ) : (
        <section className="room-layout">
          <div className="room-main">
            <div className="room-title-row">
              <div><p className="eyebrow">TEMPORADA PRIVADA · REVISÃO {props.room.revision}</p><h1>{props.room.name}</h1></div>
              <button className="room-code" onClick={copyCode}><span>CÓDIGO DA SALA</span><strong>{props.room.code}</strong><Copy size={15} /></button>
            </div>

            {props.error && <p className="form-error" role="alert">{props.error}</p>}
            <div className="club-selection">
              <header><div><h2>Escolha seu clube</h2><p>Clubes confirmados por outro manager ficam bloqueados em tempo real.</p></div><Badge tone="info">{props.catalogLoading ? 'Atualizando…' : `${props.clubs.length} clubes · ${props.catalogSource === 'firestore' ? 'servidor' : 'demo'}`}</Badge></header>
              {props.catalogError && <p className="form-note">{props.catalogError}</p>}
              <div className="club-list">
                {props.clubs.map((club) => {
                  const holder = props.room?.managers.find((manager) => manager.id !== props.identity.uid && manager.clubId === club.id);
                  const available = !holder;
                  return (
                    <button key={club.id} disabled={!available || Boolean(currentManager?.ready)} className={club.id === selectedClub ? 'selected' : ''} onClick={() => setSelectedClub(club.id)}>
                      <ClubMark code={club.code} color={club.color} />
                      <span className="club-list__name"><strong>{club.name}</strong><small>{club.city}</small></span>
                      <span className="club-list__metric"><small>FORÇA</small><strong>{club.stars.toFixed(1)} ★</strong></span>
                      <span className="club-list__metric"><small>CAIXA</small><strong>{club.budget}</strong></span>
                      <span className="club-list__status">{available ? club.id === selectedClub ? <Check size={15} /> : 'Livre' : 'Escolhido'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <aside className="room-sidebar">
            <header><p className="eyebrow">VESTIÁRIO</p><h2>Managers <span>{props.room.managers.length}/{props.room.maxManagers}</span></h2></header>
            <div className="manager-list">
              {props.room.managers.map((manager, index) => (
                <div key={manager.id}>
                  <span className={`avatar ${index % 2 ? 'avatar--blue' : ''}`}>{manager.name.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{manager.name}</strong><small>{manager.clubId ? clubByCode(manager.clubId, props.clubs).name : 'Escolhendo clube'}{manager.id === props.identity.uid ? ' · Você' : ''}</small></span>
                  <Badge tone={manager.ready ? 'positive' : 'warning'} dot>{manager.ready ? 'Pronto' : 'Escolhendo'}</Badge>
                </div>
              ))}
              {props.room.managers.length < props.room.maxManagers && <div className="invite-slot"><Plus size={15} /> Aguardando manager</div>}
            </div>
            <div className="room-rules">
              <h3><Settings2 size={15} /> Regras da sala</h3>
              <dl><div><dt>Temporadas</dt><dd>{props.room.seasonLength}</dd></div><div><dt>Ligas</dt><dd>{props.room.activeLeagues.length}</dd></div><div><dt>Status</dt><dd>{props.room.status === 'active' ? 'Em andamento' : 'Preparação'}</dd></div></dl>
            </div>

            {props.room.status === 'active' ? (
              <Button variant="primary" onClick={props.onEnterGame} icon={<Zap size={16} />}>Entrar na temporada</Button>
            ) : !currentManager?.ready ? (
              <Button variant="primary" loading={props.pending || props.catalogLoading} disabled={props.pending || props.catalogLoading || restoringSavedClub} onClick={() => void confirmClub()} icon={<Check size={16} />}>{restoringSavedClub ? 'Carregando clube salvo' : `Confirmar ${selected.name}`}</Button>
            ) : isOwner && allReady ? (
              <Button variant="primary" loading={props.pending} disabled={props.pending} onClick={() => void startSeason()} icon={<Zap size={16} />}>Iniciar temporada</Button>
            ) : (
              <Button variant="secondary" loading={props.pending} disabled={props.pending} onClick={() => void props.onReady(false)}>Alterar escolha</Button>
            )}
            <p className="room-hint">{allReady ? 'Todos estão prontos. O criador pode iniciar.' : 'O calendário avança quando todos os managers confirmam.'}</p>
          </aside>
        </section>
      )}
    </main>
  );
}
