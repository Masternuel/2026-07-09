import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Database, Infinity as InfinityIcon, Link2, LockKeyhole, Plus, Radio, Save, Settings2, Zap } from 'lucide-react';
import { SaveManager } from '../components/lobby/SaveManager';
import { DesktopPeerPanel } from '../components/lobby/DesktopPeerPanel';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { ClubMark } from '../components/shared/ClubMark';
import { CountryFlag } from '../components/shared/CountryFlag';
import { BrandLogo } from '../components/shared/BrandLogo';
import type { ClubOption } from '../constants/clubs';
import type { ClubCatalogSource } from '../hooks/useClubCatalog';
import type { SocketState } from '../hooks/useSocket';
import type { ClubChoice, LeagueChoice, ManagerIdentity, Room, RoomCreatePayload } from '../types';
import { defaultLeagueIds, groupLeaguesByCountry, initialOpenCountryKey, resolveLeagueSelectionAfterCatalogChange } from '../utils/leagueCountryGroups';

export type LobbyPanelId = 'saves' | 'create' | 'join';

export interface LobbyViewProps {
  clubs: ClubOption[];
  leagues: LeagueChoice[];
  catalogLoading: boolean;
  catalogSource: ClubCatalogSource;
  catalogError: string | null;
  leagueCatalogLoading: boolean;
  leagueCatalogError: string | null;
  identity: ManagerIdentity;
  room: Room | null;
  savedRooms: Room[];
  connectionState: SocketState;
  loading: boolean;
  pending: boolean;
  error: string | null;
  onBack: () => void | Promise<void>;
  onDeselectRoom: () => void;
  onCreate: (payload: RoomCreatePayload) => Promise<Room>;
  onJoin: (code: string) => Promise<Room>;
  onSelectSave: (code: string) => Promise<Room>;
  onDeleteSave: (code: string) => Promise<void>;
  onReady: (ready: boolean, clubId?: string) => Promise<Room>;
  onStart: () => Promise<Room>;
  onEnterGame: () => void;
  onOpenEditor: () => void;
  onRefreshCatalog: () => void;
  onClubSelected: (club: ClubChoice) => void;
  onToast: (message: string) => void;
  /** Optional composition surface; the standalone lobby keeps its original contract. */
  embedded?: boolean;
  panel?: LobbyPanelId;
  onPanelChange?: (panel: LobbyPanelId) => void;
  showPeerPanel?: boolean;
}

const lobbyTabs = ['saves', 'create', 'join'] as const;

function identifierKey(value: string | null | undefined) {
  return String(value ?? '').trim().toLocaleUpperCase('pt-BR');
}

function countryPanelId(countryKey: string) {
  const suffix = countryKey.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-');
  return `league-country-${suffix || 'unknown'}`;
}

function divisionDescriptor(league: LeagueChoice) {
  const division = league.division.trim();
  if (division && identifierKey(division) !== identifierKey(league.name)) {
    return /^\d+$/.test(division) ? `Nível ${division}` : division;
  }
  return `Nível ${league.level}`;
}

export function LobbyView(props: LobbyViewProps) {
  const local = props.identity.mode === 'local';
  const peer = props.identity.mode === 'peer';
  const desktop = local || peer;
  const [uncontrolledTab, setTab] = useState<LobbyPanelId>('saves');
  const tab = props.panel ?? uncontrolledTab;
  const [roomName, setRoomName] = useState('Noite dos Managers');
  const [selectedClub, setSelectedClub] = useState('');
  const [seasonLength, setSeasonLength] = useState('3');
  const [maxManagers, setMaxManagers] = useState(local ? '1' : '6');
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<string[]>(() => defaultLeagueIds(props.leagues));
  const [openCountryKey, setOpenCountryKey] = useState<string | null>(() => (
    initialOpenCountryKey(groupLeaguesByCountry(props.leagues), defaultLeagueIds(props.leagues))
  ));
  const previousDefaultLeagueIds = useRef(defaultLeagueIds(props.leagues));
  const leagueSelectionEdited = useRef(false);

  const leagueCountryGroups = useMemo(() => groupLeaguesByCountry(props.leagues), [props.leagues]);

  const currentManager = props.room?.managers.find((manager) => manager.id === props.identity.uid);
  const activeLeagueKeys = useMemo(
    () => new Set((props.room?.activeLeagues ?? []).map(identifierKey)),
    [props.room?.activeLeagues],
  );
  const roomClubs = useMemo(() => {
    if (!props.room || activeLeagueKeys.size === 0) return props.clubs;
    return props.clubs.filter((club) => Boolean(club.leagueId && activeLeagueKeys.has(identifierKey(club.leagueId))));
  }, [props.room, props.clubs, activeLeagueKeys]);
  const selected = useMemo(
    () => roomClubs.find((club) => identifierKey(club.id) === identifierKey(selectedClub)) ?? null,
    [selectedClub, roomClubs],
  );
  const selectedExists = selected !== null;
  const restoringSavedClub = Boolean(
    currentManager?.clubId
    && !selectedExists
    && (props.catalogLoading || props.leagueCatalogLoading),
  );
  const isOwner = props.room?.ownerId === props.identity.uid;
  const allReady = Boolean(props.room?.managers.length && props.room.managers.every((manager) => manager.ready));
  const selectedUnderfilledLeagues = props.leagues.filter((league) => (
    selectedLeagueIds.includes(league.id) && league.clubCount === 1
  ));
  const selectedClubCount = props.leagues.reduce((total, league) => (
    selectedLeagueIds.includes(league.id) ? total + league.clubCount : total
  ), 0);
  const selectableLeagueCount = props.leagues.filter((league) => league.clubCount > 0).length;

  useEffect(() => {
    if (peer || (desktop && tab === 'join')) setTab('saves');
  }, [desktop, peer, tab]);

  useEffect(() => {
    if (props.room) return;
    const previousDefaults = previousDefaultLeagueIds.current;
    previousDefaultLeagueIds.current = defaultLeagueIds(props.leagues);
    setSelectedLeagueIds((current) => resolveLeagueSelectionAfterCatalogChange(
      current,
      previousDefaults,
      props.leagues,
      leagueSelectionEdited.current,
    ));
  }, [props.leagues, props.room]);

  useEffect(() => {
    setOpenCountryKey((current) => (
      current && leagueCountryGroups.some((group) => group.key === current)
        ? current
        : initialOpenCountryKey(leagueCountryGroups, selectedLeagueIds)
    ));
  }, [leagueCountryGroups, selectedLeagueIds]);

  useEffect(() => {
    const savedClubId = currentManager?.clubId;
    setSelectedClub((current) => {
      if (savedClubId) return savedClubId;
      return roomClubs.some((club) => identifierKey(club.id) === identifierKey(current))
        ? current
        : '';
    });
  }, [currentManager?.clubId, roomClubs]);

  function toggleLeague(leagueId: string) {
    leagueSelectionEdited.current = true;
    setSelectedLeagueIds((current) => current.includes(leagueId)
      ? current.filter((candidate) => candidate !== leagueId)
      : [...current, leagueId]);
  }

  async function createRoom() {
    if (peer) return;
    if (selectedLeagueIds.length === 0) {
      props.onToast('Selecione pelo menos uma liga para criar a temporada.');
      return;
    }
    const unlimitedSeasons = seasonLength === 'unlimited';
    const finiteSeasonLength = ['1', '3', '5'].includes(seasonLength) ? Number(seasonLength) : 1;
    try {
      await props.onCreate({
        name: roomName,
        activeLeagues: [...selectedLeagueIds],
        seasonLength: unlimitedSeasons ? 1 : finiteSeasonLength,
        unlimitedSeasons,
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
    if (!selectedExists || !selected) {
      props.onToast('Nenhum clube está disponível nas ligas ativas desta sala.');
      return;
    }
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
      props.onToast(selected ? `Temporada iniciada com o ${selected.name}.` : 'Temporada iniciada.');
    } catch {
      // O hook mantém a mensagem de erro visível.
    }
  }

  async function copyCode() {
    if (!props.room) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(props.room.code);
      props.onToast(desktop ? 'ID da carreira copiado. Para convidar, use o painel P2P.' : 'Código da sala copiado.');
    } catch {
      props.onToast('Cópia automática indisponível. Selecione o código e copie manualmente.');
    }
  }

  function changeTab(nextTab: typeof lobbyTabs[number], focus = false) {
    setTab(nextTab);
    props.onPanelChange?.(nextTab);
    if (focus) window.requestAnimationFrame(() => document.getElementById(`lobby-tab-${nextTab}`)?.focus());
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const tabs: ReadonlyArray<(typeof lobbyTabs)[number]> = peer ? ['saves'] : desktop ? lobbyTabs.filter((value) => value !== 'join') : lobbyTabs;
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    changeTab(tabs[nextIndex], true);
  }

  const connectionLabel = props.connectionState === 'connected'
    ? local ? 'MOTOR LOCAL CONECTADO' : peer ? 'P2P · ANFITRIÃO CONECTADO' : 'TEMPO REAL CONECTADO'
    : props.connectionState === 'connecting' ? peer ? 'CONECTANDO AO ANFITRIÃO' : 'CONECTANDO AO SERVIDOR' : peer ? 'ANFITRIÃO DESCONECTADO · CARREIRA PAUSADA' : 'DESCONECTADO / RECONECTANDO';

  const Root = props.embedded ? 'div' : 'main';

  return (
    <Root className={`lobby-screen${props.embedded ? ' lobby-screen--embedded' : ''}`}>
      {!props.embedded && <header className="lobby-header">
        <button onClick={props.room ? props.onDeselectRoom : props.onBack} className="back-button">
          <ArrowLeft size={17} /> {props.room ? peer ? 'Conexão P2P' : 'Meus saves' : 'Sair'}
        </button>
        <div className="lobby-wordmark"><BrandLogo /></div>
        <div className="lobby-header__right">
          {!desktop && <button className="lobby-editor-button" onClick={props.onOpenEditor}><Database size={14} /> Editor da Base</button>}
          <div className="connection-status"><span /> {connectionLabel}</div>
        </div>
      </header>}

      {!props.room ? (
        <section className="lobby-setup">
          {!props.embedded && <div className="lobby-intro">
            <p className="eyebrow">{local ? 'CARREIRA LOCAL · P2P' : peer ? 'CONVIDADO P2P' : 'SALA PRIVADA'}</p>
            <h1>{local ? <>Sua carreira.<br />Seu computador.</> : peer ? <>Sua equipe.<br />A mesma carreira.</> : <>Monte sua mesa<br />de managers.</>}</h1>
            <p>{local ? 'Saves locais e motor completo. A base inicial contém jogadores fictícios; bases importadas preservam seu catálogo. Jogue solo ou convide amigos por conexão direta LAN/VPN.' : peer ? 'Você joga na carreira do anfitrião, com a base escolhida por ele. Ele mantém o save e precisa permanecer conectado.' : 'Crie uma temporada para comandar com os amigos ou entre usando um código de convite.'}</p>
            <div className="lobby-facts">
              <span><Radio size={17} /><strong>{desktop ? 'P2P direto' : 'Tempo real'}</strong><small>{desktop ? 'LAN/VPN · sem servidor pago' : 'Partidas e mercado sincronizados'}</small></span>
              <span><LockKeyhole size={17} /><strong>{desktop ? 'Save no anfitrião' : 'Sala fechada'}</strong><small>{desktop ? 'Somente amigos de confiança' : 'Somente managers convidados'}</small></span>
            </div>
          </div>}

          <div className="lobby-config">
            {!props.embedded && <div className={`segmented-control${!desktop ? ' segmented-control--three' : ''}`} role="tablist" aria-label="Gerenciar saves">
              <button id="lobby-tab-saves" role="tab" aria-controls="lobby-panel-saves" aria-selected={tab === 'saves'} tabIndex={tab === 'saves' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => changeTab('saves')}><Save size={15} /> {peer ? 'Carreira remota' : 'Meus saves'}</button>
              {!peer && <button id="lobby-tab-create" role="tab" aria-controls="lobby-panel-create" aria-selected={tab === 'create'} tabIndex={tab === 'create' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => changeTab('create')}><Plus size={15} /> {local ? 'Nova carreira' : 'Criar sala'}</button>}
              {!desktop && <button id="lobby-tab-join" role="tab" aria-controls="lobby-panel-join" aria-selected={tab === 'join'} tabIndex={tab === 'join' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => changeTab('join')}><Link2 size={15} /> Entrar</button>}
            </div>}

            {props.error && <p className="form-error" role="alert">{props.error}</p>}
            {props.loading && <p className="form-note">{local ? 'Lendo saves neste computador…' : peer ? 'Consultando a carreira do anfitrião…' : 'Buscando suas salas salvas no servidor…'}</p>}

            <div id="lobby-panel-saves" role={props.embedded ? undefined : 'tabpanel'} aria-labelledby={props.embedded ? undefined : 'lobby-tab-saves'} hidden={tab !== 'saves'}>
              {peer ? <div className="desktop-peer-empty"><h2>Carreira do anfitrião</h2><p>Use o pareamento abaixo para conectar ou reconectar. Apenas o anfitrião cria, mantém e exclui este save.</p></div> : <SaveManager
                saves={props.savedRooms}
                identity={props.identity}
                pending={props.pending}
                onSelect={props.onSelectSave}
                onDelete={props.onDeleteSave}
                onCreateNew={() => changeTab('create')}
                onToast={props.onToast}
              />}
            </div>
            {!peer && <div id="lobby-panel-create" role={props.embedded ? undefined : 'tabpanel'} aria-labelledby={props.embedded ? undefined : 'lobby-tab-create'} hidden={tab !== 'create'}>
              <div className="setup-form">
                <label><span>Nome da temporada</span><input value={roomName} onChange={(event) => setRoomName(event.target.value)} /></label>
                <div className="form-grid">
                  <label><span>Duração</span><select value={seasonLength} aria-describedby={seasonLength === 'unlimited' ? 'unlimited-season-note' : undefined} onChange={(event) => setSeasonLength(event.target.value)}><option value="1">1 temporada</option><option value="3">3 temporadas</option><option value="5">5 temporadas</option><option value="unlimited">Temporadas ilimitadas</option></select></label>
                  <label><span>Máx. managers</span><select value={maxManagers} onChange={(event) => setMaxManagers(event.target.value)}>{local && <option value="1">1 · Offline</option>}<option value="4">4{local ? ' · P2P' : ''}</option><option value="6">6{local ? ' · P2P' : ''}</option><option value="8">8{local ? ' · P2P' : ''}</option></select></label>
                </div>
                {seasonLength === 'unlimited' && <p className="unlimited-season-note" id="unlimited-season-note" role="note"><InfinityIcon size={15} aria-hidden="true" /> A carreira gera uma nova temporada automaticamente após a última rodada.</p>}
                <fieldset className="league-selector">
                  <legend>Ligas ativas</legend>
                  <div className="league-selector__countries">
                    {leagueCountryGroups.map((group) => {
                      const expanded = openCountryKey === group.key;
                      const panelId = countryPanelId(group.key);
                      const headingId = `${panelId}-heading`;
                      const selectedCount = group.leagues.filter((league) => selectedLeagueIds.includes(league.id)).length;
                      return (
                        <section className={`league-country${expanded ? ' league-country--open' : ''}`} key={group.key}>
                          <button
                            id={headingId}
                            className="league-country__trigger"
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            onClick={() => setOpenCountryKey((current) => current === group.key ? null : group.key)}
                          >
                            <span className="league-country__identity">
                              <strong>
                                <CountryFlag className="league-country__flag" country={group.key} />
                                <span className="league-country__name">{group.label}</span>
                              </strong>
                              <small>{selectedCount}/{group.leagues.length} {group.leagues.length === 1 ? 'divisão selecionada' : 'divisões selecionadas'}</small>
                            </span>
                            <span className="league-country__clubs">{group.clubCount} {group.clubCount === 1 ? 'clube' : 'clubes'}</span>
                            <ChevronDown className="league-country__chevron" size={16} aria-hidden="true" />
                          </button>
                          <div className="league-country__divisions" id={panelId} role="region" aria-labelledby={headingId} hidden={!expanded}>
                            {group.leagues.map((league) => {
                              const unavailable = league.clubCount === 0;
                              return (
                                <label className={`league-division-row${unavailable ? ' league-division-row--disabled' : ''}`} key={league.id}>
                                  <input
                                    type="checkbox"
                                    checked={selectedLeagueIds.includes(league.id)}
                                    disabled={props.pending || props.leagueCatalogLoading || unavailable}
                                    onChange={() => toggleLeague(league.id)}
                                  />
                                  <span className="league-division-row__identity">
                                    <strong>{league.name}</strong>
                                    <small>{divisionDescriptor(league)}</small>
                                  </span>
                                  <span className="league-division-row__clubs">{league.clubCount} {league.clubCount === 1 ? 'clube' : 'clubes'}</span>
                                </label>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  {!props.leagues.length && <p className="form-note">Nenhuma liga ativa foi encontrada no catálogo.</p>}
                  {props.leagues.length > 0 && (
                    <p className="league-selector__summary" role="status" aria-live="polite">
                      <strong>{selectedLeagueIds.length}</strong> de {selectableLeagueCount} divisões disponíveis · {selectedClubCount} {selectedClubCount === 1 ? 'clube' : 'clubes'} no save
                    </p>
                  )}
                </fieldset>
                {props.leagueCatalogLoading && <p className="form-note">Atualizando ligas disponíveis…</p>}
                {props.leagueCatalogError && <div className="form-note" role="alert"><span>{props.leagueCatalogError}</span> <Button size="sm" variant="ghost" onClick={props.onRefreshCatalog}>Tentar novamente</Button></div>}
                {selectedUnderfilledLeagues.length > 0 && <p className="form-note" role="note">{selectedUnderfilledLeagues.map((league) => league.name).join(', ')} precisa de pelo menos mais um clube ativo {desktop ? 'na base' : 'no Editor'} para iniciar partidas.</p>}
                {!selectedLeagueIds.length && <p className="form-error" role="alert">Selecione pelo menos uma liga.</p>}
                <Button variant="primary" loading={props.pending || props.leagueCatalogLoading} disabled={props.pending || props.leagueCatalogLoading || !props.leagues.length || !selectedLeagueIds.length} onClick={() => void createRoom()} icon={<ChevronRight size={16} />}>Criar e escolher clube</Button>
              </div>
            </div>}
            {!desktop && <div id="lobby-panel-join" role={props.embedded ? undefined : 'tabpanel'} aria-labelledby={props.embedded ? undefined : 'lobby-tab-join'} hidden={tab !== 'join'}>
              <form className="setup-form" onSubmit={(event) => void submitJoin(event)}>
                <label><span>Código do convite</span><input name="roomCode" className="room-input" placeholder="BOLA-XXXX" maxLength={9} required /></label>
                <p className="form-note"><LockKeyhole size={14} /> O código possui o formato BOLA-XXXX.</p>
                <Button variant="primary" type="submit" loading={props.pending} disabled={props.pending} icon={<ChevronRight size={16} />}>Localizar sala</Button>
              </form>
            </div>}
            {desktop && props.showPeerPanel !== false && <DesktopPeerPanel identity={props.identity} />}
          </div>
        </section>
      ) : (
        <section className="room-layout">
          <div className="room-main">
            <div className="room-title-row">
              <div><p className="eyebrow">TEMPORADA PRIVADA · REVISÃO {props.room.revision}</p><h1>{props.room.name}</h1></div>
              <button className="room-code" onClick={() => void copyCode()}><span>{desktop ? 'ID DA CARREIRA · NÃO É CONVITE' : 'CÓDIGO DA SALA'}</span><strong>{props.room.code}</strong><Copy size={15} /></button>
            </div>

            {props.error && <p className="form-error" role="alert">{props.error}</p>}
            <div className="club-selection">
              <header><div><h2>Escolha seu clube</h2><p>{desktop ? 'A base inicial contém jogadores fictícios; bases importadas preservam seu catálogo. Reservas sincronizadas pelo anfitrião.' : 'Clubes confirmados por outro manager ficam bloqueados em tempo real.'}</p></div><Badge tone="info">{props.catalogLoading || props.leagueCatalogLoading ? 'Atualizando…' : `${roomClubs.length} clubes · ${local ? 'base local' : peer ? 'anfitrião' : props.catalogSource === 'firestore' ? 'servidor' : 'demonstração explícita'}`}</Badge></header>
              {(props.catalogError || props.leagueCatalogError) && <div className="form-note" role="alert"><span>{props.catalogError ?? props.leagueCatalogError}</span> <Button size="sm" variant="ghost" onClick={props.onRefreshCatalog}>Tentar novamente</Button></div>}
              <div className="club-list">
                {roomClubs.map((club) => {
                  const holder = props.room?.managers.find((manager) => manager.id !== props.identity.uid && manager.clubId === club.id);
                  const available = !holder;
                  return (
                    <button key={club.id} disabled={!available || Boolean(currentManager?.ready)} className={club.id === selectedClub ? 'selected' : ''} onClick={() => setSelectedClub(club.id)}>
                      <ClubMark code={club.code} color={club.color} darkThemeColor={club.darkThemeColor} lightThemeColor={club.lightThemeColor} imageUrl={club.crestImageUrl} />
                      <span className="club-list__name"><strong>{club.name}</strong><small>{[club.leagueName, club.city].filter(Boolean).join(' · ')}</small></span>
                      <span className="club-list__metric"><small>FORÇA</small><strong>{club.stars.toFixed(1)} ★</strong></span>
                      <span className="club-list__metric"><small>CAIXA</small><strong>{club.budget}</strong></span>
                      <span className="club-list__status">{available ? club.id === selectedClub ? <Check size={15} /> : 'Livre' : 'Escolhido'}</span>
                    </button>
                  );
                })}
                {!roomClubs.length && <p className="form-note">Nenhum clube ativo pertence às ligas selecionadas para esta sala.</p>}
              </div>
            </div>
          </div>

          <aside className="room-sidebar">
            <header><p className="eyebrow">VESTIÁRIO</p><h2>Managers <span>{props.room.managers.length}/{props.room.maxManagers}</span></h2></header>
            <div className="manager-list">
              {props.room.managers.map((manager, index) => {
                const managerClub = manager.clubId
                  ? props.clubs.find((candidate) => identifierKey(candidate.id) === identifierKey(manager.clubId))
                  : null;
                const clubLabel = manager.clubId
                  ? managerClub?.name ?? `Clube ${manager.clubId} indisponível`
                  : 'Escolhendo clube';
                return <div key={manager.id}>
                  <span className={`avatar ${index % 2 ? 'avatar--blue' : ''}`}>{manager.name.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{manager.name}</strong><small>{clubLabel}{manager.id === props.identity.uid ? ' · Você' : ''}</small></span>
                  <Badge tone={manager.ready ? 'positive' : 'warning'} dot>{manager.ready ? 'Pronto' : 'Escolhendo'}</Badge>
                </div>;
              })}
              {props.room.managers.length < props.room.maxManagers && <div className="invite-slot"><Plus size={15} /> Aguardando manager</div>}
            </div>
            <div className="room-rules">
              <h3><Settings2 size={15} /> Regras da sala</h3>
              <dl><div><dt>Temporadas</dt><dd>{props.room.unlimitedSeasons ? '∞ Ilimitadas' : props.room.seasonLength}</dd></div><div><dt>Ligas</dt><dd>{props.room.activeLeagues.length}</dd></div><div><dt>Status</dt><dd>{props.room.status === 'active' ? 'Em andamento' : 'Preparação'}</dd></div></dl>
            </div>

            {props.room.status === 'active' ? (
              <Button variant="primary" onClick={props.onEnterGame} icon={<Zap size={16} />}>Entrar na temporada</Button>
            ) : !currentManager?.ready ? (
              <Button variant="primary" loading={props.pending || props.catalogLoading || props.leagueCatalogLoading} disabled={props.pending || props.catalogLoading || props.leagueCatalogLoading || restoringSavedClub || !selectedExists} onClick={() => void confirmClub()} icon={<Check size={16} />}>{restoringSavedClub ? 'Carregando clube salvo' : selected ? `Confirmar ${selected.name}` : roomClubs.length ? 'Selecione um clube' : 'Nenhum clube disponível'}</Button>
            ) : isOwner && allReady ? (
              <Button variant="primary" loading={props.pending} disabled={props.pending} onClick={() => void startSeason()} icon={<Zap size={16} />}>Iniciar temporada</Button>
            ) : (
              <Button variant="secondary" loading={props.pending} disabled={props.pending} onClick={() => void props.onReady(false)}>Alterar escolha</Button>
            )}
            <p className="room-hint">{allReady ? 'Todos estão prontos. O criador pode iniciar.' : 'O calendário avança quando todos os managers confirmam.'}</p>
            {desktop && props.showPeerPanel !== false && <DesktopPeerPanel identity={props.identity} room={props.room} />}
          </aside>
        </section>
      )}
    </Root>
  );
}
