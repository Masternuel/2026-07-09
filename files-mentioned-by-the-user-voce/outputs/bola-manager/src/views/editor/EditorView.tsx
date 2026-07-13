import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Building2, Database, Plus, RefreshCw, Shield, ShieldAlert, TriangleAlert, Trophy, UploadCloud, UsersRound } from 'lucide-react';
import { BrasfootImportModal } from '../../components/editor/BrasfootImportModal';
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

export function EditorView({ identity, getIdToken, onBack, onToast }: EditorViewProps) {
  const credentials = useMemo<ApiCredentials>(() => ({ identity, getIdToken }), [identity, getIdToken]);
  const editor = useEditorCatalog(credentials);
  const [entity, setEntity] = useState<EditorEntity>('clubs');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'archived'>('all');
  const [contextualFilter, setContextualFilter] = useState('');
  const [mode, setMode] = useState<'empty' | 'create' | 'edit'>('empty');
  const [selected, setSelected] = useState<EditorRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EditorRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const inspectorRef = useRef<HTMLElement>(null);
  const requestedQuery = query.trim() || null;
  const requestedClubId = entity === 'players' ? contextualFilter || null : null;
  const serverFiltersMatch = editor.pages[entity].filters.query === requestedQuery
    && editor.pages[entity].filters.clubId === requestedClubId;

  useEffect(() => {
    const currentFilters = editor.pages[entity].filters;
    if (currentFilters.query === requestedQuery && currentFilters.clubId === requestedClubId) return;
    const timer = window.setTimeout(() => {
      void editor.search(entity, { query: requestedQuery, clubId: requestedClubId }).catch(() => {});
    }, 280);
    return () => window.clearTimeout(timer);
  }, [editor.search, editor.pages, entity, requestedClubId, requestedQuery]);

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

  function revealInspector() {
    if (!window.matchMedia('(max-width: 1220px)').matches) return;
    window.requestAnimationFrame(() => {
      const inspector = inspectorRef.current;
      if (!inspector) return;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      inspector.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      inspector.focus({ preventScroll: true });
    });
  }

  function changeEntity(nextEntity: EditorEntity) {
    setEntity(nextEntity);
    setQuery('');
    setStatus('all');
    setContextualFilter('');
    setMode('empty');
    setSelected(null);
  }

  function selectRecord(record: EditorRecord) {
    setSelected(record);
    setMode('edit');
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
        onToast(`${entitySingular(entity)} e imagem salvos no catálogo global.`);
        return withMedia;
      } catch (error) {
        onToast(`${entitySingular(entity)} salvo, mas a imagem não pôde ser enviada. Tente novamente.`);
        throw error;
      }
    }
    onToast(`${entitySingular(entity)} ${mode === 'create' ? 'adicionado' : 'atualizado'} no catálogo global.`);
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

  async function archiveRecord(record: EditorRecord) {
    try {
      const saved = await editor.updateRecord(entity, { ...record, active: false });
      setSelected(saved);
      setMode('edit');
      setDeleteTarget(null);
      setDeleteError(null);
      onToast(`${record.name} foi arquivado no catálogo global.`);
    } catch {
      // O hook mantém a mensagem detalhada da API na tela.
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await editor.deleteRecord(entity, deleteTarget.id);
      onToast(`${deleteTarget.name} foi excluído do catálogo global.`);
      if (selected?.id === deleteTarget.id) {
        setSelected(null);
        setMode('empty');
      }
      setDeleteTarget(null);
      setDeleteError(null);
    } catch (nextError) {
      setDeleteError(nextError instanceof ApiError
        ? nextError.message
        : 'Não foi possível excluir este registro. Tente novamente.');
    }
  }

  function openDelete(record: EditorRecord) {
    setDeleteError(null);
    setDeleteTarget(record);
  }

  function closeDelete() {
    setDeleteError(null);
    setDeleteTarget(null);
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
        <div className="editor-global-header__title"><span>ADMINISTRAÇÃO</span><strong>Editor da Base</strong></div>
        <Badge tone="info" dot>Catálogo global</Badge>
        <div className={`editor-sync ${editor.error ? 'is-error' : ''}`}><span /> {syncLabel}</div>
      </header>

      {editor.access === 'denied' ? (
        <section className="editor-access-state">
          <span><ShieldAlert size={25} /></span>
          <p className="eyebrow">ACESSO RESTRITO</p>
          <h1>Editor indisponível para esta conta</h1>
          <p>{editor.accessReason ?? 'Somente administradores da base podem alterar o catálogo global.'}</p>
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
            <div className="editor-summary__heading"><Database size={17} /><span><strong>Catálogo global</strong><small>Registros administrativos no servidor</small></span></div>
            {entities.map(({ key, label }) => (
              <div key={key} className="editor-summary__metric"><span>{label}</span><strong>{editor.counts[key].toLocaleString('pt-BR')}</strong><small>{editor.catalog[key].length.toLocaleString('pt-BR')} carregados</small></div>
            ))}
            <div className="editor-summary__warning"><TriangleAlert size={16} /><span><strong>Alterações são globais</strong><small>Arquivamentos e exclusões respeitam referências existentes.</small></span></div>
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
                  <Button variant="secondary" icon={<UploadCloud size={15} />} disabled={editor.loading || editor.pending} onClick={() => setImportOpen(true)}>Importar Brasfoot</Button>
                  <Button variant="primary" icon={<Plus size={15} />} disabled={editor.loading || editor.pending} onClick={() => { setSelected(null); setMode('create'); revealInspector(); }}>Adicionar</Button>
                </div>
              </header>
              <EditorEntityList
                entity={entity}
                records={records}
                selectedId={selected?.id ?? null}
                query={query}
                status={status}
                contextualFilter={contextualFilter}
                leagues={editor.catalog.leagues}
                clubs={editor.catalog.clubs}
                loading={editor.loading || editor.pageLoading[entity]}
                loadingMore={editor.pageLoading[entity] && editor.catalog[entity].length > 0}
                hasMore={serverFiltersMatch && editor.pages[entity].hasMore}
                totalCount={editor.pages[entity].count}
                onQueryChange={setQuery}
                onStatusChange={setStatus}
                onContextualFilterChange={setContextualFilter}
                onSelect={selectRecord}
                onLoadMore={() => void editor.loadMore(entity).catch(() => {})}
              />
            </div>

            <EditorRecordForm
              entity={entity}
              mode={mode}
              record={selected}
              leagues={editor.catalog.leagues}
              clubs={editor.catalog.clubs}
              pending={editor.pending}
              panelRef={inspectorRef}
              onSubmit={saveRecord}
              onRemoveMedia={removeMedia}
              onCancel={() => { setSelected(null); setMode('empty'); }}
              onArchive={archiveRecord}
              onDelete={openDelete}
            />
          </section>
        </>
      )}

      <EditorDeleteModal
        entity={entity}
        record={deleteTarget}
        pending={editor.pending}
        error={deleteError}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        onArchive={() => deleteTarget ? archiveRecord(deleteTarget) : Promise.resolve()}
      />
      <BrasfootImportModal
        open={importOpen}
        credentials={credentials}
        onClose={() => setImportOpen(false)}
        onComplete={() => {
          setImportOpen(false);
          setQuery('');
          setContextualFilter('');
          void editor.refresh();
          onToast('Importação concluída. Catálogo do Editor atualizado.');
        }}
      />
    </main>
  );
}
