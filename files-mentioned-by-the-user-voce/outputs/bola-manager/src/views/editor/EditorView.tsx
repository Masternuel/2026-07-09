import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Building2, Database, Download, Plus, RefreshCw, Shield, ShieldAlert, TriangleAlert, Trophy, Upload, UploadCloud, UsersRound } from 'lucide-react';
import { BrasfootImportModal } from '../../components/editor/BrasfootImportModal';
import { EditorBulkDeleteModal } from '../../components/editor/EditorBulkDeleteModal';
import { EditorClubRosterPanel, EditorClubTabs, type EditorClubInspectorTab } from '../../components/editor/EditorClubRosterPanel';
import { EditorDeleteModal } from '../../components/editor/EditorDeleteModal';
import { EditorEntityList } from '../../components/editor/EditorEntityList';
import { EditorRecordForm } from '../../components/editor/EditorRecordForm';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { useEditorCatalog } from '../../hooks/useEditorCatalog';
import { ApiError, type ApiCredentials } from '../../lib/apiClient';
import type { EditorClub, EditorEntity, EditorPlayer, EditorRecord, EditorTournament, ManagerIdentity } from '../../types';

interface EditorViewProps {
  identity: ManagerIdentity;
  getIdToken: ApiCredentials['getIdToken'];
  onBack: () => void;
  onToast: (message: string) => void;
}

interface EditorDeleteTarget {
  entity: EditorEntity;
  record: EditorRecord;
  returnToRoster: boolean;
}

const entities = [
  { key: 'leagues', label: 'Ligas', short: 'LIG', icon: Shield },
  { key: 'clubs', label: 'Clubes', short: 'CLB', icon: Building2 },
  { key: 'players', label: 'Jogadores', short: 'JOG', icon: UsersRound },
  { key: 'tournaments', label: 'Torneios', short: 'TRN', icon: Trophy },
] as const;

function normalized(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function entitySingular(entity: EditorEntity) {
  return entity === 'leagues' ? 'Liga' : entity === 'clubs' ? 'Clube' : entity === 'players' ? 'Jogador' : 'Torneio';
}

function entityPlural(entity: EditorEntity) {
  return entity === 'leagues' ? 'ligas' : entity === 'clubs' ? 'clubes' : entity === 'players' ? 'jogadores' : 'torneios';
}

function exportFilename(filename: string | null) {
  const safeName = filename?.split(/[\\/]/).pop()?.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim();
  return safeName || `bola-manager-base-${new Date().toISOString().slice(0, 10)}.json`;
}

export function EditorView({ identity, getIdToken, onBack, onToast }: EditorViewProps) {
  const credentials = useMemo<ApiCredentials>(() => ({ identity, getIdToken }), [identity, getIdToken]);
  const editor = useEditorCatalog(credentials);
  const [entity, setEntity] = useState<EditorEntity>('clubs');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'archived'>('all');
  const [contextualFilter, setContextualFilter] = useState('');
  const [mode, setMode] = useState<'empty' | 'create' | 'edit'>('empty');
  const [selected, setSelected] = useState<EditorRecord | null>(null);
  const [clubInspectorTab, setClubInspectorTab] = useState<EditorClubInspectorTab>('details');
  const [clubRosterMode, setClubRosterMode] = useState<'list' | 'create' | 'edit'>('list');
  const [clubRosterPlayer, setClubRosterPlayer] = useState<EditorPlayer | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<EditorDeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [databaseProgress, setDatabaseProgress] = useState<number | null>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const databaseInputRef = useRef<HTMLInputElement>(null);
  const requestedQuery = query.trim() || null;
  const requestedClubId = entity === 'players' ? contextualFilter || null : null;
  const serverFiltersMatch = editor.pages[entity].filters.query === requestedQuery
    && editor.pages[entity].filters.clubId === requestedClubId;
  const selectedClub = entity === 'clubs' && mode === 'edit' && selected ? selected as EditorClub : null;
  const rosterFiltersMatch = Boolean(selectedClub)
    && editor.pages.players.filters.query === null
    && editor.pages.players.filters.clubId === selectedClub?.id;
  const clubRosterPlayers = useMemo(
    () => selectedClub
      ? editor.catalog.players.filter((player) => player.clubId === selectedClub.id)
      : [],
    [editor.catalog.players, selectedClub],
  );
  const clubRosterCount = rosterFiltersMatch ? editor.pages.players.count : null;

  useEffect(() => {
    const currentFilters = editor.pages[entity].filters;
    if (currentFilters.query === requestedQuery && currentFilters.clubId === requestedClubId) return;
    const timer = window.setTimeout(() => {
      void editor.search(entity, { query: requestedQuery, clubId: requestedClubId }).catch(() => {});
    }, 280);
    return () => window.clearTimeout(timer);
  }, [editor.search, editor.pages, entity, requestedClubId, requestedQuery]);

  useEffect(() => {
    if (!selectedClub || clubInspectorTab !== 'players' || rosterFiltersMatch) return;
    void editor.search('players', { clubId: selectedClub.id }).catch(() => {});
  }, [clubInspectorTab, editor.search, rosterFiltersMatch, selectedClub]);

  const rawRecords = editor.catalog[entity] as EditorRecord[];
  const records = useMemo(() => {
    const needle = normalized(query.trim());
    return rawRecords.filter((record) => {
      if (status === 'active' && !record.active) return false;
      if (status === 'archived' && record.active) return false;
      if (entity === 'clubs' && contextualFilter && (record as EditorClub).leagueId !== contextualFilter) return false;
      if (entity === 'players' && contextualFilter && (record as EditorPlayer).clubId !== contextualFilter) return false;
      if (!needle) return true;
      const extras = entity === 'clubs'
        ? `${(record as EditorClub).abbreviation} ${(record as EditorClub).city} ${(record as EditorClub).country}`
        : entity === 'players'
          ? `${(record as EditorPlayer).nationality} ${(record as EditorPlayer).position}`
          : entity === 'tournaments'
            ? `${(record as EditorTournament).format} ${(record as EditorTournament).teamIds.join(' ')}`
            : '';
      return normalized(`${record.id} ${record.name} ${extras}`).includes(needle);
    }).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  }, [contextualFilter, entity, query, rawRecords, status]);
  const selectedRecords = useMemo(
    () => rawRecords.filter((record) => selectedIds.has(record.id)),
    [rawRecords, selectedIds],
  );

  function revealInspector() {
    window.requestAnimationFrame(() => {
      const inspector = inspectorRef.current;
      if (!inspector) return;
      if (window.matchMedia('(max-width: 1220px)').matches) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        inspector.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
      inspector.focus({ preventScroll: true });
    });
  }

  function resetClubInspector() {
    setClubInspectorTab('details');
    setClubRosterMode('list');
    setClubRosterPlayer(null);
  }

  function changeEntity(nextEntity: EditorEntity) {
    setEntity(nextEntity);
    setQuery('');
    setStatus('all');
    setContextualFilter('');
    setMode('empty');
    setSelected(null);
    resetClubInspector();
    clearBulkSelection();
  }

  function clearBulkSelection() {
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);
    setBulkDeleteError(null);
  }

  function toggleBulkSelection(record: EditorRecord) {
    if (!selectedIds.has(record.id) && selectedIds.size >= 100) {
      onToast('Selecione no máximo 100 registros por operação.');
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(record.id)) next.delete(record.id);
      else next.add(record.id);
      return next;
    });
  }

  function toggleVisibleSelection(visibleRecords: EditorRecord[], shouldSelect: boolean) {
    const visibleIds = new Set(visibleRecords.map((record) => record.id));
    if (!shouldSelect) {
      setSelectedIds((current) => new Set([...current].filter((id) => !visibleIds.has(id))));
      return;
    }
    const next = new Set(selectedIds);
    let reachedLimit = false;
    for (const record of visibleRecords) {
      if (next.has(record.id)) continue;
      if (next.size >= 100) {
        reachedLimit = true;
        break;
      }
      next.add(record.id);
    }
    setSelectedIds(next);
    if (reachedLimit) onToast('Foram selecionados os primeiros 100 registros exibidos.');
  }

  function selectRecord(record: EditorRecord) {
    setSelected(record);
    setMode('edit');
    if (entity === 'clubs') resetClubInspector();
    revealInspector();
  }

  function changeClubInspectorTab(tab: EditorClubInspectorTab) {
    setClubInspectorTab(tab);
    setClubRosterMode('list');
    setClubRosterPlayer(null);
    revealInspector();
  }

  async function saveRecord(record: EditorRecord, mediaFile: File | null, onProgress: (progress: number) => void) {
    let saved: EditorRecord;
    try {
      saved = mode === 'create'
        ? await editor.createRecord(entity, record)
        : await editor.updateRecord(entity, record);
    } catch {
      // O hook mantém a mensagem detalhada da API na tela.
      return null;
    }
    setSelected(saved);
    setMode('edit');
    if (mediaFile && entity !== 'leagues') {
      try {
        const withMedia = await editor.uploadMedia(entity, saved.id, mediaFile, onProgress);
        setSelected(withMedia);
        onToast(`${entitySingular(entity)} e imagem salvos na sua base.`);
        return withMedia;
      } catch (error) {
        onToast(`${entitySingular(entity)} salvo, mas a imagem não pôde ser enviada. Tente novamente.`);
        throw error;
      }
    }
    onToast(`${entitySingular(entity)} ${mode === 'create' ? 'adicionado' : 'atualizado'} na sua base.`);
    return saved;
  }

  async function removeMedia(record: EditorRecord) {
    if (entity === 'leagues') return record;
    try {
      const saved = await editor.removeMedia(entity, record.id);
      setSelected(saved);
      onToast(`Imagem de ${record.name} removida.`);
      return saved;
    } catch {
      return null;
    }
  }

  async function refreshClubRoster(clubId: string) {
    await editor.search('players', { clubId }).catch(() => {});
  }

  async function saveClubRosterPlayer(record: EditorRecord, mediaFile: File | null, onProgress: (progress: number) => void) {
    if (!selectedClub) return null;
    const player = { ...(record as EditorPlayer), clubId: selectedClub.id };
    let saved: EditorPlayer;
    try {
      saved = (clubRosterMode === 'create'
        ? await editor.createRecord('players', player)
        : await editor.updateRecord('players', player)) as EditorPlayer;
    } catch {
      return null;
    }
    setClubRosterMode('edit');
    setClubRosterPlayer(saved);
    if (mediaFile) {
      try {
        saved = await editor.uploadMedia('players', saved.id, mediaFile, onProgress) as EditorPlayer;
        setClubRosterPlayer(saved);
      } catch (error) {
        onToast('Jogador salvo, mas a imagem não pôde ser enviada. Tente novamente.');
        throw error;
      }
    }
    const created = clubRosterMode === 'create';
    setClubRosterMode('list');
    setClubRosterPlayer(null);
    revealInspector();
    await refreshClubRoster(selectedClub.id);
    onToast(`Jogador ${created ? 'adicionado ao' : 'atualizado no'} elenco de ${selectedClub.name}.`);
    return saved;
  }

  async function removeClubRosterMedia(record: EditorRecord) {
    try {
      const saved = await editor.removeMedia('players', record.id) as EditorPlayer;
      setClubRosterPlayer(saved);
      if (selectedClub) await refreshClubRoster(selectedClub.id);
      onToast(`Imagem de ${record.name} removida.`);
      return saved;
    } catch {
      return null;
    }
  }

  async function archiveClubRosterPlayer(record: EditorPlayer) {
    try {
      await editor.updateRecord('players', { ...record, active: false });
      setClubRosterMode('list');
      setClubRosterPlayer(null);
      revealInspector();
      setDeleteTarget(null);
      setDeleteError(null);
      if (selectedClub) await refreshClubRoster(selectedClub.id);
      onToast(`${record.name} foi arquivado na sua base.`);
    } catch {
      // The hook keeps the detailed API error visible.
    }
  }

  async function archiveRecord(record: EditorRecord) {
    try {
      const saved = await editor.updateRecord(entity, { ...record, active: false });
      setSelected(saved);
      setMode('edit');
      setDeleteTarget(null);
      setDeleteError(null);
      onToast(`${record.name} foi arquivado na sua base.`);
    } catch {
      // O hook mantém a mensagem detalhada da API na tela.
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await editor.deleteRecord(deleteTarget.entity, deleteTarget.record.id);
      onToast(`${deleteTarget.record.name} foi excluído da sua base.`);
      if (!deleteTarget.returnToRoster && deleteTarget.entity === entity && selected?.id === deleteTarget.record.id) {
        setSelected(null);
        setMode('empty');
      }
      if (deleteTarget.returnToRoster) {
        setClubRosterMode('list');
        setClubRosterPlayer(null);
        revealInspector();
        if (selectedClub) await refreshClubRoster(selectedClub.id);
      } else if (deleteTarget.entity === entity) {
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(deleteTarget.record.id);
          return next;
        });
      }
      setDeleteTarget(null);
      setDeleteError(null);
    } catch (nextError) {
      setDeleteError(nextError instanceof ApiError
        ? nextError.message
        : 'Não foi possível excluir este registro. Tente novamente.');
    }
  }

  function openDelete(targetEntity: EditorEntity, record: EditorRecord, returnToRoster = false) {
    setDeleteError(null);
    setDeleteTarget({ entity: targetEntity, record, returnToRoster });
  }

  function closeDelete() {
    setDeleteError(null);
    setDeleteTarget(null);
  }

  async function archiveDeleteTarget() {
    if (!deleteTarget) return;
    if (deleteTarget.returnToRoster && deleteTarget.entity === 'players') {
      await archiveClubRosterPlayer(deleteTarget.record as EditorPlayer);
      return;
    }
    await archiveRecord(deleteTarget.record);
  }

  async function confirmBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkDeleteError(null);
    try {
      const result = await editor.deleteRecords(entity, ids);
      if (selected && ids.includes(selected.id)) {
        setSelected(null);
        setMode('empty');
      }
      clearBulkSelection();
      const label = ids.length === 1 ? entitySingular(entity).toLowerCase() : entityPlural(entity);
      const removedLabel = entity === 'leagues'
        ? result.count === 1 ? 'excluída' : 'excluídas'
        : result.count === 1 ? 'excluído' : 'excluídos';
      onToast(`${result.count} ${label} ${removedLabel} da sua base.${result.failedMediaCount ? ` ${result.failedMediaCount} imagem(ns) não puderam ser removidas.` : ''}`);
    } catch (nextError) {
      setBulkDeleteError(nextError instanceof ApiError
        ? nextError.message
        : 'Não foi possível excluir os registros selecionados. Tente novamente.');
    }
  }

  async function exportBase() {
    try {
      const download = await editor.exportDatabase();
      const objectUrl = URL.createObjectURL(download.blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = exportFilename(download.filename);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      onToast('Sua base foi exportada em um arquivo JSON.');
    } catch (nextError) {
      onToast(nextError instanceof ApiError ? nextError.message : 'Não foi possível exportar sua base.');
    }
  }

  async function importBase(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase('pt-BR').endsWith('.json')) {
      onToast('Selecione um arquivo de base no formato JSON.');
      return;
    }
    setDatabaseProgress(0);
    try {
      await editor.importDatabase(file, setDatabaseProgress);
      setSelected(null);
      setMode('empty');
      setQuery('');
      setContextualFilter('');
      resetClubInspector();
      clearBulkSelection();
      onToast('Base importada e combinada com seus registros atuais.');
    } catch (nextError) {
      onToast(nextError instanceof ApiError ? nextError.message : 'Não foi possível importar esta base.');
    } finally {
      setDatabaseProgress(null);
    }
  }

  const syncLabel = editor.loading
    ? 'Sincronizando catálogo'
    : editor.error
      ? 'Falha na sincronização'
      : editor.lastSyncedAt
        ? `Sincronizado às ${editor.lastSyncedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
        : 'Aguardando sincronização';

  return (
    <main className="editor-screen">
      <header className="editor-global-header">
        <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> Voltar aos saves</button>
        <div className="editor-wordmark"><span className="wordmark-glyph"><Shield size={17} /></span><span>BOLA <strong>MANAGER</strong></span><i /></div>
        <div className="editor-global-header__title"><span>MINHA CONTA</span><strong>Editor da Base</strong></div>
        <Badge tone="info" dot>Minha base</Badge>
        <div className={`editor-sync ${editor.error ? 'is-error' : ''}`}><span /> {syncLabel}</div>
      </header>

      {editor.access === 'denied' ? (
        <section className="editor-access-state">
          <span><ShieldAlert size={25} /></span>
          <p className="eyebrow">ACESSO RESTRITO</p>
          <h1>Editor indisponível para esta conta</h1>
          <p>{editor.accessReason ?? 'Sua conta não possui acesso à base de dados pessoal.'}</p>
          <Button variant="secondary" icon={<ArrowLeft size={15} />} onClick={onBack}>Voltar aos saves</Button>
        </section>
      ) : editor.access === 'error' ? (
        <section className="editor-access-state">
          <span className="is-danger"><TriangleAlert size={25} /></span>
          <p className="eyebrow">SERVIÇO INDISPONÍVEL</p>
          <h1>Não foi possível validar o acesso</h1>
          <p>{editor.error}</p>
          <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={editor.retryAccess}>Tentar novamente</Button>
        </section>
      ) : (
        <>
          <section className="editor-summary" aria-label="Resumo do catálogo">
            <div className="editor-summary__heading"><Database size={17} /><span><strong>Minha base</strong><small>Clubes, ligas e jogadores da sua conta</small></span></div>
            {entities.map(({ key, label }) => (
              <div key={key} className="editor-summary__metric"><span>{label}</span><strong>{editor.counts[key].toLocaleString('pt-BR')}</strong><small>{editor.catalog[key].length.toLocaleString('pt-BR')} carregados</small></div>
            ))}
            <div className="editor-summary__warning"><TriangleAlert size={16} /><span><strong>Base compartilhável</strong><small>Exporte para compartilhar ou importe para combinar registros.</small></span></div>
          </section>

          {editor.error && (
            <div className="editor-api-error" role="alert">
              <TriangleAlert size={16} /><span>{editor.error}</span>
              <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void editor.refresh()}>Tentar novamente</Button>
            </div>
          )}

          <section className="editor-workspace">
            <nav className="editor-entity-rail" aria-label="Entidades do catálogo">
              <div className="editor-entity-rail__label">ENTIDADES</div>
              {entities.map(({ key, label, short, icon: Icon }) => (
                <button key={key} className={entity === key ? 'is-active' : undefined} onClick={() => changeEntity(key)}>
                  <Icon size={17} /><span><strong>{label}</strong><small>{editor.counts[key]} registros</small></span><em>{short}</em>
                </button>
              ))}
              <div className="editor-entity-rail__foot"><ShieldAlert size={14} /><span>Operações auditadas</span></div>
            </nav>

            <div className="editor-catalog-panel">
              <header className="editor-catalog-panel__header">
                <div><p className="eyebrow">CATÁLOGO / {entitySingular(entity).toUpperCase()}</p><h1>{entities.find((item) => item.key === entity)?.label}</h1></div>
                <div className="editor-catalog-panel__actions">
                  <input
                    ref={databaseInputRef}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      void importBase(file);
                    }}
                  />
                  <Button
                    variant="secondary"
                    icon={<Download size={15} />}
                    loading={editor.databaseAction === 'exporting'}
                    disabled={editor.loading || editor.pending || editor.databaseAction !== null}
                    onClick={() => void exportBase()}
                  >Exportar base</Button>
                  <Button
                    variant="secondary"
                    icon={<Upload size={15} />}
                    loading={editor.databaseAction === 'importing'}
                    disabled={editor.loading || editor.pending || editor.databaseAction !== null}
                    onClick={() => databaseInputRef.current?.click()}
                  >{editor.databaseAction === 'importing' && databaseProgress !== null ? `Importando ${databaseProgress}%` : 'Importar base'}</Button>
                  <Button variant="secondary" icon={<UploadCloud size={15} />} disabled={editor.loading || editor.pending || editor.databaseAction !== null} onClick={() => setImportOpen(true)}>Importar Brasfoot</Button>
                  <Button variant="primary" icon={<Plus size={15} />} disabled={editor.loading || editor.pending || editor.databaseAction !== null} onClick={() => { setSelected(null); setMode('create'); resetClubInspector(); revealInspector(); }}>Adicionar</Button>
                </div>
              </header>
              <EditorEntityList
                entity={entity}
                records={records}
                selectedId={selected?.id ?? null}
                selectedIds={selectedIds}
                query={query}
                status={status}
                contextualFilter={contextualFilter}
                leagues={editor.catalog.leagues}
                clubs={editor.catalog.clubs}
                loading={editor.loading || editor.pageLoading[entity]}
                loadingMore={editor.pageLoading[entity] && editor.catalog[entity].length > 0}
                hasMore={serverFiltersMatch && editor.pages[entity].hasMore}
                totalCount={editor.pages[entity].count}
                bulkPending={editor.pending || editor.databaseAction !== null}
                onQueryChange={(value) => { setQuery(value); clearBulkSelection(); }}
                onStatusChange={(value) => { setStatus(value); clearBulkSelection(); }}
                onContextualFilterChange={(value) => { setContextualFilter(value); clearBulkSelection(); }}
                onSelect={selectRecord}
                onToggleSelection={toggleBulkSelection}
                onToggleVisible={toggleVisibleSelection}
                onClearSelection={clearBulkSelection}
                onRequestBulkDelete={() => { setBulkDeleteError(null); setBulkDeleteOpen(true); }}
                onLoadMore={() => void editor.loadMore(entity).catch(() => {})}
              />
            </div>

            {selectedClub && clubInspectorTab === 'players' ? (
              clubRosterMode === 'list' ? (
                <EditorClubRosterPanel
                  club={selectedClub}
                  players={clubRosterPlayers}
                  playerCount={clubRosterCount}
                  activeTab={clubInspectorTab}
                  loading={!editor.error && (!rosterFiltersMatch || (editor.pageLoading.players && clubRosterPlayers.length === 0))}
                  loadingMore={editor.pageLoading.players && clubRosterPlayers.length > 0}
                  hasMore={rosterFiltersMatch && editor.pages.players.hasMore}
                  error={editor.error}
                  pending={editor.pending || editor.databaseAction !== null}
                  panelRef={inspectorRef}
                  onTabChange={changeClubInspectorTab}
                  onAdd={() => { setClubRosterPlayer(null); setClubRosterMode('create'); revealInspector(); }}
                  onEdit={(player) => { setClubRosterPlayer(player); setClubRosterMode('edit'); revealInspector(); }}
                  onDelete={(player) => openDelete('players', player, true)}
                  onLoadMore={() => void editor.loadMore('players').catch(() => {})}
                />
              ) : (
                <EditorRecordForm
                  key={`club-player-${selectedClub.id}-${clubRosterMode}-${clubRosterPlayer?.id ?? 'new'}`}
                  entity="players"
                  mode={clubRosterMode}
                  record={clubRosterPlayer}
                  leagues={editor.catalog.leagues}
                  clubs={editor.catalog.clubs}
                  pending={editor.pending || editor.databaseAction !== null}
                  panelRef={inspectorRef}
                  initialClubId={selectedClub.id}
                  lockedClubId={selectedClub.id}
                  headerSlot={<EditorClubTabs activeTab="players" playerCount={clubRosterCount} loading={editor.pageLoading.players} onChange={changeClubInspectorTab} />}
                  tabPanelId="editor-club-players-panel"
                  tabLabelledBy="editor-club-players-tab"
                  onSubmit={saveClubRosterPlayer}
                  onRemoveMedia={removeClubRosterMedia}
                  onCancel={() => { setClubRosterPlayer(null); setClubRosterMode('list'); revealInspector(); }}
                  onArchive={(record) => archiveClubRosterPlayer(record as EditorPlayer)}
                  onDelete={(record) => openDelete('players', record, true)}
                />
              )
            ) : (
              <EditorRecordForm
                key={`record-${entity}-${mode}-${selected?.id ?? 'new'}`}
                entity={entity}
                mode={mode}
                record={selected}
                leagues={editor.catalog.leagues}
                clubs={editor.catalog.clubs}
                pending={editor.pending || editor.databaseAction !== null}
                panelRef={inspectorRef}
                headerSlot={selectedClub ? <EditorClubTabs activeTab="details" playerCount={clubRosterCount} loading={!rosterFiltersMatch} onChange={changeClubInspectorTab} /> : undefined}
                tabPanelId={selectedClub ? 'editor-club-details-panel' : undefined}
                tabLabelledBy={selectedClub ? 'editor-club-details-tab' : undefined}
                onSubmit={saveRecord}
                onRemoveMedia={removeMedia}
                onCancel={() => { setSelected(null); setMode('empty'); resetClubInspector(); }}
                onArchive={archiveRecord}
                onDelete={(record) => openDelete(entity, record)}
              />
            )}
          </section>
        </>
      )}

      <EditorDeleteModal
        entity={deleteTarget?.entity ?? entity}
        record={deleteTarget?.record ?? null}
        pending={editor.pending || editor.databaseAction !== null}
        error={deleteError}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        onArchive={archiveDeleteTarget}
      />
      <EditorBulkDeleteModal
        entity={entity}
        records={selectedRecords}
        selectedCount={selectedIds.size}
        open={bulkDeleteOpen}
        pending={editor.pending || editor.databaseAction !== null}
        error={bulkDeleteError}
        onClose={() => { if (!editor.pending) { setBulkDeleteOpen(false); setBulkDeleteError(null); } }}
        onConfirm={confirmBulkDelete}
      />
      <BrasfootImportModal
        open={importOpen}
        credentials={credentials}
        onClose={() => setImportOpen(false)}
        onComplete={() => {
          setImportOpen(false);
          setQuery('');
          setContextualFilter('');
          resetClubInspector();
          void editor.refresh();
          onToast('Importação concluída. Catálogo do Editor atualizado.');
        }}
      />
    </main>
  );
}
