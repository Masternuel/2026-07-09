import { AlertTriangle, Database, Pencil, Plus, Trash2, UserRound, UsersRound } from 'lucide-react';
import type { KeyboardEvent, Ref } from 'react';
import type { EditorClub, EditorPlayer } from '../../types';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { ClubMark } from '../shared/ClubMark';
import { ResilientImage } from '../shared/ResilientImage';
import { StarPlayerMark } from '../shared/StarPlayerMark';

export type EditorClubInspectorTab = 'details' | 'players';

interface EditorClubTabsProps {
  activeTab: EditorClubInspectorTab;
  playerCount: number | null;
  loading?: boolean;
  onChange: (tab: EditorClubInspectorTab) => void;
}

interface EditorClubRosterPanelProps {
  club: EditorClub;
  players: EditorPlayer[];
  playerCount: number | null;
  activeTab: EditorClubInspectorTab;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  pending: boolean;
  panelRef?: Ref<HTMLElement>;
  onTabChange: (tab: EditorClubInspectorTab) => void;
  onAdd: () => void;
  onEdit: (player: EditorPlayer) => void;
  onDelete: (player: EditorPlayer) => void;
  onLoadMore: () => void;
}

export function nextEditorClubInspectorTab(activeTab: EditorClubInspectorTab, key: string) {
  if (key === 'Home') return 'details';
  if (key === 'End') return 'players';
  if (key === 'ArrowLeft') return activeTab === 'details' ? 'players' : 'details';
  if (key === 'ArrowRight') return activeTab === 'players' ? 'details' : 'players';
  return null;
}

export function EditorClubTabs({ activeTab, playerCount, loading = false, onChange }: EditorClubTabsProps) {
  const countLabel = playerCount === null ? '…' : String(playerCount);
  const countAriaLabel = playerCount === null
    ? 'Quantidade de jogadores carregando'
    : `${playerCount} jogador${playerCount === 1 ? '' : 'es'}`;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const nextTab = nextEditorClubInspectorTab(activeTab, event.key);
    if (!nextTab) return;
    event.preventDefault();
    onChange(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`editor-club-${nextTab}-tab`)?.focus());
  }

  return (
    <div className="editor-club-tabs" role="tablist" aria-label="Seções do clube">
      <button
        id="editor-club-details-tab"
        type="button"
        role="tab"
        aria-selected={activeTab === 'details'}
        aria-controls="editor-club-details-panel"
        tabIndex={activeTab === 'details' ? 0 : -1}
        className={activeTab === 'details' ? 'is-active' : undefined}
        onClick={() => onChange('details')}
        onKeyDown={handleKeyDown}
      >
        Dados do clube
      </button>
      <button
        id="editor-club-players-tab"
        type="button"
        role="tab"
        aria-selected={activeTab === 'players'}
        aria-controls="editor-club-players-panel"
        tabIndex={activeTab === 'players' ? 0 : -1}
        className={activeTab === 'players' ? 'is-active' : undefined}
        onClick={() => onChange('players')}
        onKeyDown={handleKeyDown}
      >
        Jogadores <span aria-label={countAriaLabel} aria-live="polite">{loading && playerCount === null ? '…' : countLabel}</span>
      </button>
    </div>
  );
}

export function EditorClubRosterPanel({
  club,
  players,
  playerCount,
  activeTab,
  loading,
  loadingMore,
  hasMore,
  error,
  pending,
  panelRef,
  onTabChange,
  onAdd,
  onEdit,
  onDelete,
  onLoadMore,
}: EditorClubRosterPanelProps) {
  const roster = players.filter((player) => player.clubId === club.id);
  return (
    <aside className="editor-inspector editor-club-roster" ref={panelRef} tabIndex={-1} aria-label={`Jogadores do ${club.name}`}>
      <header className="editor-inspector__header editor-club-roster__identity">
        <ClubMark
          code={club.abbreviation || club.id.slice(0, 3)}
          color={club.colors[0]}
          darkThemeColor={club.darkThemeColor}
          lightThemeColor={club.lightThemeColor}
          imageUrl={club.crestImageUrl}
          size="sm"
        />
        <div>
          <p className="eyebrow">ELENCO DO CLUBE</p>
          <h2>{club.name}</h2>
        </div>
        <Badge tone="info">{error ? 'Indisponível' : playerCount === null ? 'Carregando…' : `${playerCount} jogador${playerCount === 1 ? '' : 'es'}`}</Badge>
      </header>
      <EditorClubTabs activeTab={activeTab} playerCount={playerCount} loading={loading} onChange={onTabChange} />

      <section
        id="editor-club-players-panel"
        className="editor-club-roster__panel"
        role="tabpanel"
        aria-labelledby="editor-club-players-tab"
        tabIndex={0}
      >
        <header className="editor-club-roster__toolbar">
          <span><UsersRound size={15} aria-hidden="true" /> <strong>{club.abbreviation || club.id}</strong> / plantel</span>
          <Button type="button" size="sm" variant="primary" icon={<Plus size={14} />} disabled={pending} onClick={onAdd}>
            Adicionar jogador
          </Button>
        </header>

        {error && !loading && (
          <div className="editor-club-roster__state is-error" role="alert">
            <AlertTriangle size={22} />
            <strong>Não foi possível carregar o elenco</strong>
            <p>{error}</p>
          </div>
        )}

        {loading && roster.length === 0 && (
          <div className="editor-club-roster__state" aria-live="polite">
            <span className="button-spinner" />
            <strong>Carregando jogadores…</strong>
            <p>Buscando o elenco vinculado a {club.name}.</p>
          </div>
        )}

        {!loading && !error && roster.length === 0 && (
          <div className="editor-club-roster__state" aria-live="polite">
            <Database size={23} />
            <strong>Este clube ainda não tem jogadores</strong>
            <p>Adicione o primeiro atleta sem sair do cadastro do clube.</p>
            <Button type="button" size="sm" variant="secondary" icon={<Plus size={14} />} onClick={onAdd}>Adicionar jogador</Button>
          </div>
        )}

        {roster.length > 0 && (
          <ul className="editor-club-roster__list" aria-label={`Elenco de ${club.name}`}>
            {roster.map((player) => (
              <li key={player.id} className={!player.active ? 'is-archived' : undefined}>
                <span className="editor-club-roster__avatar">
                  <ResilientImage src={player.avatarImageUrl} alt="" fallback={<UserRound size={17} />} />
                </span>
                <span className="editor-club-roster__player">
                  <span>
                    <strong>{player.name}</strong>
                    {player.isStar && <StarPlayerMark />}
                  </span>
                  <small>{player.position} · {player.age} anos · #{player.shirtNumber}</small>
                </span>
                <span className="editor-club-roster__overall"><small>OVR</small><strong>{player.overall}</strong></span>
                <Badge tone={player.active ? 'positive' : 'warning'} dot>{player.active ? 'Ativo' : 'Arquivado'}</Badge>
                <span className="editor-club-roster__actions">
                  <button type="button" onClick={() => onEdit(player)} disabled={pending} aria-label={`Editar ${player.name}`} title="Editar jogador"><Pencil size={14} /></button>
                  <button type="button" className="is-danger" onClick={() => onDelete(player)} disabled={pending} aria-label={`Excluir ${player.name}`} title="Excluir jogador"><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {roster.length > 0 && (
          <footer className="editor-club-roster__footer">
            <span>{playerCount === null ? `${roster.length} carregados` : `${roster.length} de ${playerCount} jogador${playerCount === 1 ? '' : 'es'}`}</span>
            {hasMore
              ? <Button type="button" size="sm" variant="ghost" loading={loadingMore} onClick={onLoadMore}>Carregar mais</Button>
              : <span>Elenco carregado</span>}
          </footer>
        )}
      </section>
    </aside>
  );
}
