import { useEffect, useRef } from 'react';
import { Archive, ChevronRight, CircleOff, Database, MoveHorizontal, Search, Shield, Trash2, Trophy, UserRound, X } from 'lucide-react';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { ClubMark } from '../shared/ClubMark';
import { ResilientImage } from '../shared/ResilientImage';
import { StarPlayerMark } from '../shared/StarPlayerMark';
import type { EditorClub, EditorEntity, EditorLeague, EditorPlayer, EditorRecord, EditorTournament } from '../../types';

interface EditorEntityListProps {
  entity: EditorEntity;
  records: EditorRecord[];
  selectedId: string | null;
  selectedIds: ReadonlySet<string>;
  query: string;
  status: 'all' | 'active' | 'archived';
  contextualFilter: string;
  leagues: EditorLeague[];
  clubs: EditorClub[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  totalCount: number;
  bulkPending: boolean;
  onQueryChange: (query: string) => void;
  onStatusChange: (status: 'all' | 'active' | 'archived') => void;
  onContextualFilterChange: (value: string) => void;
  onSelect: (record: EditorRecord) => void;
  onToggleSelection: (record: EditorRecord) => void;
  onToggleVisible: (records: EditorRecord[], selected: boolean) => void;
  onClearSelection: () => void;
  onRequestBulkDelete: () => void;
  onLoadMore: () => void;
}

const entityCopy = {
  leagues: { singular: 'liga', plural: 'ligas' },
  clubs: { singular: 'clube', plural: 'clubes' },
  players: { singular: 'jogador', plural: 'jogadores' },
  tournaments: { singular: 'torneio', plural: 'torneios' },
} satisfies Record<EditorEntity, { singular: string; plural: string }>;

function leagueColumns(record: EditorLeague) {
  return (
    <>
      <td><span className="editor-table__country">{record.country}</span></td>
      <td>{record.division}</td>
      <td className="editor-table__numeric">Nível {record.level}</td>
    </>
  );
}

function clubColumns(record: EditorClub, leagues: EditorLeague[]) {
  const league = leagues.find((candidate) => candidate.id === record.leagueId);
  return (
    <>
      <td><span className="editor-table__country">{record.city || record.state || record.country}</span></td>
      <td>{league?.name ?? record.division ?? 'Sem liga'}</td>
      <td className="editor-table__numeric">REP {record.reputation}</td>
    </>
  );
}

function playerColumns(record: EditorPlayer, clubs: EditorClub[]) {
  const club = clubs.find((candidate) => candidate.id === record.clubId);
  return (
    <>
      <td><span className="editor-table__country">{club?.abbreviation || club?.name || 'Sem clube'}</span></td>
      <td>{record.position} · {record.age} anos</td>
      <td className="editor-table__numeric">OVR {record.overall}</td>
    </>
  );
}

function tournamentColumns(record: EditorTournament) {
  const format = record.format === 'league' ? 'Pontos corridos' : record.format === 'knockout' ? 'Mata-mata' : 'Grupos + mata-mata';
  return (
    <>
      <td><span className="editor-table__country">{format}</span></td>
      <td>{record.teamIds.length}/{record.teamCount} times</td>
      <td className="editor-table__numeric">{record.legs === 'double' ? 'IDA + VOLTA' : 'TURNO ÚNICO'}</td>
    </>
  );
}

function RecordIcon({ entity, record }: { entity: EditorEntity; record: EditorRecord }) {
  if (entity === 'clubs') {
    const club = record as EditorClub;
    return <ClubMark code={club.abbreviation || club.id.slice(0, 3)} color={club.colors[0]} darkThemeColor={club.darkThemeColor} lightThemeColor={club.lightThemeColor} imageUrl={club.crestImageUrl} size="sm" />;
  }
  if (entity === 'players') {
    const player = record as EditorPlayer;
    return <span className="editor-table__avatar editor-table__avatar--image"><ResilientImage src={player.avatarImageUrl} alt="" fallback={<UserRound size={15} />} /></span>;
  }
  if (entity === 'tournaments') {
    const tournament = record as EditorTournament;
    return <span className="editor-table__avatar editor-table__avatar--trophy"><ResilientImage src={tournament.trophyImageUrl} alt="" fallback={<Trophy size={15} />} /></span>;
  }
  return <span className="editor-table__avatar"><Shield size={15} /></span>;
}

function recordActionLabel(action: 'Editar' | 'Abrir', entity: EditorEntity, record: EditorRecord) {
  const starLabel = entity === 'players' && (record as EditorPlayer).isStar ? ', jogador estrela' : '';
  return `${action} ${record.name}${starLabel}`;
}

export function EditorEntityList({
  entity,
  records,
  selectedId,
  selectedIds,
  query,
  status,
  contextualFilter,
  leagues,
  clubs,
  loading,
  loadingMore,
  hasMore,
  totalCount,
  bulkPending,
  onQueryChange,
  onStatusChange,
  onContextualFilterChange,
  onSelect,
  onToggleSelection,
  onToggleVisible,
  onClearSelection,
  onRequestBulkDelete,
  onLoadMore,
}: EditorEntityListProps) {
  const copy = entityCopy[entity];
  const selectAllRef = useRef<HTMLInputElement>(null);
  const allVisibleSelected = records.length > 0 && records.every((record) => selectedIds.has(record.id));
  const someVisibleSelected = records.some((record) => selectedIds.has(record.id));
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);
  return (
    <section className="editor-list" aria-label={`Lista de ${copy.plural}`}>
      <div className="editor-list__tools">
        <label className="editor-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Buscar {copy.plural}</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={`Buscar ${copy.singular} pelo início do nome`}
          />
          {query && <kbd>{records.length}</kbd>}
        </label>
        <div className="editor-filters">
          <label>
            <span className="sr-only">Filtrar por situação</span>
            <select value={status} onChange={(event) => onStatusChange(event.target.value as typeof status)}>
              <option value="all">Todos os registros</option>
              <option value="active">Somente ativos</option>
              <option value="archived">Somente arquivados</option>
            </select>
          </label>
          {entity === 'clubs' && (
            <label>
              <span className="sr-only">Filtrar por liga</span>
              <select value={contextualFilter} onChange={(event) => onContextualFilterChange(event.target.value)}>
                <option value="">Todas as ligas</option>
                {leagues.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
              </select>
            </label>
          )}
          {entity === 'players' && (
            <label>
              <span className="sr-only">Filtrar por clube</span>
              <select value={contextualFilter} onChange={(event) => onContextualFilterChange(event.target.value)}>
                <option value="">Todos os clubes</option>
                {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {selectedIds.size > 0 && (
          <div className="editor-bulk-actions">
            <strong aria-live="polite">{selectedIds.size} selecionado{selectedIds.size === 1 ? '' : 's'}</strong>
            <span>Máximo de 100 por operação</span>
            <Button type="button" size="sm" variant="ghost" icon={<X size={13} />} disabled={bulkPending} onClick={onClearSelection}>Limpar</Button>
            <Button type="button" size="sm" variant="danger" icon={<Trash2 size={13} />} disabled={bulkPending} onClick={onRequestBulkDelete}>Excluir selecionados</Button>
          </div>
        )}
      </div>

      <p className="editor-table-scroll-hint" id="editor-table-scroll-hint" role="note">
        <MoveHorizontal size={15} aria-hidden="true" />
        <span><strong>Deslize para ver mais colunas.</strong> Ao abrir um registro, o formulário aparece logo abaixo.</span>
      </p>
      <div
        className="editor-table-wrap"
        role="region"
        aria-label={`Tabela rolável de ${copy.plural}`}
        aria-describedby="editor-table-scroll-hint"
        tabIndex={0}
      >
        <table className="editor-table">
          <thead>
            <tr>
              <th className="editor-table__checkbox">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={records.length === 0 || bulkPending}
                  aria-label={`Selecionar todos os ${copy.plural} exibidos`}
                  onChange={(event) => onToggleVisible(records, event.target.checked)}
                />
              </th>
              <th>{copy.singular}</th>
              <th>{entity === 'leagues' ? 'País' : entity === 'clubs' ? 'Sede' : entity === 'players' ? 'Clube' : 'Formato'}</th>
              <th>{entity === 'players' ? 'Perfil' : entity === 'tournaments' ? 'Participantes' : 'Vínculo'}</th>
              <th className="editor-table__numeric">Índice</th>
              <th>Status</th>
              <th><span className="sr-only">Abrir</span></th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const checked = selectedIds.has(record.id);
              const classes = [selectedId === record.id ? 'is-selected' : '', checked ? 'is-checked' : ''].filter(Boolean).join(' ');
              return (
              <tr key={record.id} className={classes || undefined}>
                <td className="editor-table__checkbox">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={bulkPending || (!checked && selectedIds.size >= 100)}
                    aria-label={`Selecionar ${record.name}`}
                    onChange={() => onToggleSelection(record)}
                  />
                </td>
                <td>
                  <button className="editor-table__select" onClick={() => onSelect(record)} aria-label={recordActionLabel('Editar', entity, record)}>
                    <RecordIcon entity={entity} record={record} />
                    <span>
                      <span className="editor-table__name-line">
                        <strong>{record.name}</strong>
                        {entity === 'players' && (record as EditorPlayer).isStar && <StarPlayerMark />}
                      </span>
                      <small>{record.id}</small>
                    </span>
                  </button>
                </td>
                {entity === 'leagues'
                  ? leagueColumns(record as EditorLeague)
                  : entity === 'clubs'
                    ? clubColumns(record as EditorClub, leagues)
                    : entity === 'players'
                      ? playerColumns(record as EditorPlayer, clubs)
                      : tournamentColumns(record as EditorTournament)}
                <td><Badge tone={record.active ? 'positive' : 'warning'} dot>{record.active ? 'Ativo' : 'Arquivado'}</Badge></td>
                <td><button className="editor-table__open" onClick={() => onSelect(record)} aria-label={recordActionLabel('Abrir', entity, record)}><ChevronRight size={15} /></button></td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && records.length === 0 && (
          <div className="editor-list__empty">
            {query || status !== 'all' || contextualFilter ? <CircleOff size={24} /> : <Database size={24} />}
            <strong>{query || status !== 'all' || contextualFilter ? 'Nenhum resultado' : `Nenhum ${copy.singular} cadastrado`}</strong>
            <p>{query || status !== 'all' || contextualFilter ? 'Ajuste a busca ou remova um filtro.' : `Use “Adicionar” para incluir o primeiro ${copy.singular}.`}</p>
          </div>
        )}
        {loading && (
          <div className="editor-list__loading" aria-live="polite">
            <span className="button-spinner" /> Sincronizando sua base…
          </div>
        )}
      </div>
      <footer className="editor-list__footer">
        <span><Database size={13} /> {records.length.toLocaleString('pt-BR')} exibidos de {totalCount.toLocaleString('pt-BR')}</span>
        {hasMore
          ? <Button type="button" size="sm" variant="ghost" loading={loadingMore} onClick={onLoadMore}>Carregar mais</Button>
          : <span><Archive size={13} /> Todos os resultados carregados</span>}
      </footer>
    </section>
  );
}
