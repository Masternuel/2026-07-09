import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, CheckCircle2, Database, File, FolderOpen, Image,
  ShieldAlert, UploadCloud, X, XCircle,
} from 'lucide-react';
import { ApiError, apiBinaryUpload, apiRequest, type ApiCredentials } from '../../lib/apiClient';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';

interface ImportLimits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; }
interface SessionResponse { sessionId: string; limits: ImportLimits; expiresAt: string; }
interface ImportPayload {
  sessionId?: string;
  runId?: string;
  summary?: Record<string, unknown>;
  report?: Record<string, unknown>;
  clubs?: unknown[];
  files?: unknown[];
}
interface SelectedImportFile { file: File; path: string; extension: 'ban' | 'cfg' | 'png'; }
type ImportStage = 'files' | 'uploading' | 'preview' | 'committing' | 'done';

interface BrasfootImportModalProps {
  open: boolean;
  credentials: ApiCredentials;
  onClose: () => void;
  onComplete: () => void;
}

const fallbackLimits: ImportLimits = { maxFiles: 200, maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 };

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  return `${(value / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function extensionOf(name: string): SelectedImportFile['extension'] | null {
  const extension = name.split('.').at(-1)?.toLocaleLowerCase('pt-BR');
  return extension === 'ban' || extension === 'cfg' || extension === 'png' ? extension : null;
}

function issueMessage(value: unknown) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return 'Ocorrência sem detalhes.';
  const item = value as Record<string, unknown>;
  const location = [item.file, item.path].find((part) => typeof part === 'string');
  const detail = [item.message, item.reason, item.code].find((part) => typeof part === 'string');
  if (typeof location === 'string' && typeof detail === 'string' && location !== detail) {
    return `${location}: ${detail}`;
  }
  if (typeof detail === 'string') return detail;
  if (typeof location === 'string') return location;
  return JSON.stringify(item);
}

function reportList(report: Record<string, unknown> | undefined, key: 'errors' | 'warnings') {
  const items = report?.[key];
  return Array.isArray(items) ? items.map(issueMessage) : [];
}

function summaryNumber(summary: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = summary?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      for (const nestedKey of ['imported', 'uploaded', 'matched', 'total', 'count', 'crests', 'images']) {
        const nestedValue = nested[nestedKey];
        if (typeof nestedValue === 'number' && Number.isFinite(nestedValue)) return nestedValue;
      }
    }
  }
  return 0;
}

function clubPreview(value: unknown) {
  const club = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const players = Array.isArray(club.players) ? club.players.length : Number(club.playerCount ?? club.playersCount ?? 0);
  return {
    id: String(club.id ?? club.abbreviation ?? 'CLB'),
    name: String(club.name ?? club.nome ?? 'Clube sem nome'),
    players: Number.isFinite(players) ? players : 0,
  };
}

export function BrasfootImportModal({ open, credentials, onClose, onComplete }: BrasfootImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [stage, setStage] = useState<ImportStage>('files');
  const [files, setFiles] = useState<SelectedImportFile[]>([]);
  const [selectionIssues, setSelectionIssues] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPayload | null>(null);
  const [result, setResult] = useState<ImportPayload | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Preparando sessão segura…');
  const [error, setError] = useState<string | null>(null);
  const [allowPartial, setAllowPartial] = useState(false);
  const [importAssets, setImportAssets] = useState(false);
  const [dragging, setDragging] = useState(false);

  const limits = session?.limits ?? fallbackLimits;
  const counts = useMemo(() => ({
    ban: files.filter((item) => item.extension === 'ban').length,
    cfg: files.filter((item) => item.extension === 'cfg').length,
    png: files.filter((item) => item.extension === 'png').length,
    bytes: files.reduce((total, item) => total + item.file.size, 0),
  }), [files]);
  const previewErrors = reportList(preview?.report, 'errors');
  const previewWarnings = reportList(preview?.report, 'warnings');
  const finalErrors = reportList(result?.report, 'errors');
  const previewClubs = (preview?.clubs ?? []).slice(0, 8).map(clubPreview);
  const previewAssets = preview?.report?.assets;
  const previewCrests = summaryNumber(
    previewAssets && typeof previewAssets === 'object' ? previewAssets as Record<string, unknown> : undefined,
    'shieldsFound', 'crests', 'images', 'count',
  );

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSession(null); setStage('files'); setFiles([]); setSelectionIssues([]); setPreview(null); setResult(null);
    setProgress(0); setError(null); setAllowPartial(false); setImportAssets(false); setStatusText('Preparando sessão segura…');
    void apiRequest<SessionResponse>('/api/editor/brasfoot-import/sessions', credentials, { method: 'POST', signal: controller.signal })
      .then((payload) => { if (!controller.signal.aborted) { setSession(payload); setStatusText('Sessão pronta para receber arquivos.'); } })
      .catch((nextError: unknown) => {
        if (!(nextError instanceof DOMException && nextError.name === 'AbortError')) {
          setError(nextError instanceof Error ? nextError.message : 'Não foi possível iniciar a importação.');
          setStatusText('Falha ao preparar a sessão.');
        }
      });
    return () => controller.abort();
  }, [credentials, open]);

  useEffect(() => setImportAssets(counts.png > 0), [counts.png]);

  function addFiles(list: FileList | File[]) {
    const nextIssues: string[] = [];
    const additions: SelectedImportFile[] = [];
    for (const file of Array.from(list)) {
      const extension = extensionOf(file.name);
      const path = (file.webkitRelativePath || file.name).replaceAll('\\', '/');
      if (!extension) { nextIssues.push(`${path}: formato não aceito.`); continue; }
      if (!file.size) { nextIssues.push(`${path}: arquivo vazio.`); continue; }
      if (file.size > limits.maxFileBytes) { nextIssues.push(`${path}: excede ${formatBytes(limits.maxFileBytes)}.`); continue; }
      additions.push({ file, path, extension });
    }
    const merged = new Map(files.map((item) => [item.path.toLocaleLowerCase('pt-BR'), item]));
    additions.forEach((item) => merged.set(item.path.toLocaleLowerCase('pt-BR'), item));
    const candidates = [...merged.values()];
    if (candidates.length > limits.maxFiles) {
      nextIssues.push(`Seleção excede o limite de ${limits.maxFiles} arquivos.`);
    } else if (candidates.reduce((total, item) => total + item.file.size, 0) > limits.maxTotalBytes) {
      nextIssues.push(`Seleção excede o limite total de ${formatBytes(limits.maxTotalBytes)}.`);
    } else {
      setFiles(candidates.sort((left, right) => left.path.localeCompare(right.path, 'pt-BR')));
    }
    setSelectionIssues(nextIssues);
    setError(null);
  }

  function removeFile(path: string) {
    setFiles((current) => current.filter((item) => item.path !== path));
    setSelectionIssues([]);
  }

  async function analyze() {
    if (!session || files.length === 0) return;
    if (counts.ban + counts.cfg === 0) {
      setError('Selecione ao menos um arquivo .ban ou .cfg com dados do Brasfoot.');
      return;
    }
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setStage('uploading'); setError(null); setProgress(0);
    const totalBytes = Math.max(1, counts.bytes);
    let completedBytes = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const item = files[index];
        setStatusText(`Enviando ${index + 1} de ${files.length}: ${item.file.name}`);
        const query = new URLSearchParams({ path: item.path });
        await apiBinaryUpload(`/api/editor/brasfoot-import/sessions/${encodeURIComponent(session.sessionId)}/files?${query}`, credentials, item.file, {
          method: 'PUT', contentType: 'application/octet-stream', signal: controller.signal,
          onProgress: (fileProgress) => setProgress(Math.round(((completedBytes + item.file.size * fileProgress / 100) / totalBytes) * 100)),
        });
        completedBytes += item.file.size;
      }
      setProgress(100); setStatusText('Arquivos enviados. Lendo times e jogadores…');
      const payload = await apiRequest<ImportPayload>(`/api/editor/brasfoot-import/sessions/${encodeURIComponent(session.sessionId)}/preview`, credentials, {
        method: 'POST', signal: controller.signal, timeoutMs: 120_000,
      });
      setPreview(payload); setAllowPartial(false); setStage('preview'); setStatusText('Análise concluída. Revise antes de importar.');
    } catch (nextError) {
      if (nextError instanceof DOMException && nextError.name === 'AbortError') return;
      setError(nextError instanceof Error ? nextError.message : 'Falha durante o envio ou análise.');
      const expiredSession = nextError instanceof ApiError
        && (nextError.status === 410 || nextError.code === 'BRASFOOT_IMPORT_SESSION_NOT_FOUND');
      setStatusText(expiredSession ? 'A sessão expirou. Feche e abra o importador novamente.' : 'A análise não foi concluída.');
      setStage('files');
    } finally {
      uploadAbortRef.current = null;
    }
  }

  async function commit() {
    if (!session || !preview) return;
    setStage('committing'); setError(null); setStatusText('Gravando dados no Firebase…');
    try {
      const payload = await apiRequest<ImportPayload>(`/api/editor/brasfoot-import/sessions/${encodeURIComponent(session.sessionId)}/commit`, credentials, {
        method: 'POST', body: { allowPartial, importAssets }, timeoutMs: 300_000,
      });
      setResult(payload); setStage('done'); setStatusText('Importação concluída.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Não foi possível gravar os dados no Firebase.');
      setStatusText('A importação não foi concluída. Revise as opções e tente novamente.');
      setStage('preview');
    }
  }

  function deleteSessionBestEffort() {
    if (!session?.sessionId) return Promise.resolve();
    return apiRequest(`/api/editor/brasfoot-import/sessions/${encodeURIComponent(session.sessionId)}`, credentials, { method: 'DELETE' }).then(() => undefined).catch(() => undefined);
  }

  function close() {
    if (stage === 'committing') return;
    uploadAbortRef.current?.abort();
    void deleteSessionBestEffort();
    onClose();
  }

  function finish() {
    void deleteSessionBestEffort().finally(onComplete);
  }

  const footer = stage === 'done' ? (
    <Button variant="primary" icon={<Check size={15} />} onClick={finish}>Concluir e atualizar Editor</Button>
  ) : stage === 'preview' ? (
    <><Button variant="ghost" onClick={close}>Cancelar</Button><Button variant="primary" icon={<Database size={15} />} disabled={previewErrors.length > 0 && !allowPartial} onClick={() => void commit()}>Importar para o Firebase</Button></>
  ) : stage === 'committing' ? (
    <Button variant="primary" loading>Importando para o Firebase</Button>
  ) : stage === 'uploading' ? (
    <><Button variant="ghost" onClick={close}>Cancelar envio</Button><Button variant="secondary" loading>Analisando arquivos</Button></>
  ) : (
    <><Button variant="ghost" onClick={close}>Cancelar</Button><Button variant="primary" icon={<UploadCloud size={15} />} disabled={!session || files.length === 0} onClick={() => void analyze()}>Enviar e analisar</Button></>
  );

  return (
    <Modal open={open} onClose={close} eyebrow="CENTRAL DE DADOS" title="Importar dados do Brasfoot" size="lg" footer={footer}>
      <div className="brasfoot-import">
        <ol className="brasfoot-import__steps" aria-label="Etapas da importação">
          {['Arquivos', 'Análise', 'Firebase'].map((label, index) => {
            const activeIndex = stage === 'files' ? 0 : stage === 'uploading' || stage === 'preview' ? 1 : 2;
            return <li key={label} className={index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-active' : undefined} aria-current={index === activeIndex ? 'step' : undefined}><span>{index < activeIndex ? <Check size={13} /> : index + 1}</span>{label}</li>;
          })}
        </ol>

        {error && <div className="brasfoot-import__error" role="alert"><XCircle size={17} /><span><strong>Não foi possível continuar</strong>{error}</span></div>}

        {stage === 'files' && <>
          <section
            className={`brasfoot-dropzone ${dragging ? 'is-dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
          >
            <UploadCloud size={31} /><p className="eyebrow">ARQUIVOS DO BRASFOOT</p><h3>Arraste os arquivos para esta área</h3>
            <p>O arquivo <strong>.ban</strong> contém time e elenco; <strong>.cfg</strong> melhora liga e país; <strong>.png</strong> adiciona o escudo.</p>
            <div><Button variant="secondary" icon={<File size={15} />} disabled={!session} onClick={() => fileInputRef.current?.click()}>Selecionar arquivos</Button><Button variant="ghost" icon={<FolderOpen size={15} />} disabled={!session} onClick={() => folderInputRef.current?.click()}>Selecionar pasta</Button></div>
            <input ref={fileInputRef} hidden type="file" multiple accept=".ban,.cfg,.png" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ''; }} />
            <input ref={folderInputRef} hidden type="file" multiple accept=".ban,.cfg,.png" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ''; }} />
          </section>
          <div className="brasfoot-import__limits"><span><ShieldAlert size={14} /> Limites do servidor</span><strong>{limits.maxFiles} arquivos</strong><strong>{formatBytes(limits.maxFileBytes)} por arquivo</strong><strong>{formatBytes(limits.maxTotalBytes)} no total</strong></div>
          <section className="brasfoot-files">
            <header><div><p className="eyebrow">SELEÇÃO ATUAL</p><h3>{files.length} arquivo(s) · {formatBytes(counts.bytes)}</h3></div><div><Badge tone="info">{counts.ban} BAN</Badge><Badge tone="neutral">{counts.cfg} CFG</Badge><Badge tone="positive">{counts.png} PNG</Badge></div></header>
            {selectionIssues.length > 0 && <div className="brasfoot-files__issues" role="alert">{selectionIssues.map((issue) => <p key={issue}><AlertTriangle size={13} /> {issue}</p>)}</div>}
            <div className="brasfoot-files__list">{files.map((item) => <div key={item.path}><span className={`is-${item.extension}`}>{item.extension === 'png' ? <Image size={14} /> : <File size={14} />}</span><span><strong>{item.file.name}</strong><small>{item.path} · {formatBytes(item.file.size)}</small></span><button onClick={() => removeFile(item.path)} aria-label={`Remover ${item.file.name}`}><X size={14} /></button></div>)}{files.length === 0 && <p className="brasfoot-files__empty">Nenhum arquivo selecionado ainda.</p>}</div>
          </section>
        </>}

        {stage === 'uploading' && <section className="brasfoot-import__working" aria-live="polite"><UploadCloud size={30} /><p className="eyebrow">UPLOAD E ANÁLISE</p><h3>{statusText}</h3><div><span style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong><p>Não feche esta janela enquanto os arquivos são enviados.</p></section>}

        {(stage === 'preview' || stage === 'committing') && preview && <>
          <section className="brasfoot-preview-summary"><header><div><p className="eyebrow">PRÉVIA DA IMPORTAÇÃO</p><h3>Revise os dados encontrados</h3></div><Badge tone={previewErrors.length ? 'warning' : 'positive'}>{previewErrors.length ? 'Requer atenção' : 'Pronto para importar'}</Badge></header><div>{[
            ['Clubes', summaryNumber(preview.summary, 'clubs', 'clubCount')], ['Jogadores', summaryNumber(preview.summary, 'players', 'playerCount')], ['Ligas', summaryNumber(preview.summary, 'leagues', 'leagueCount')], ['Escudos', previewCrests], ['Erros', previewErrors.length], ['Avisos', previewWarnings.length],
          ].map(([label, value]) => <span key={label as string}><small>{label}</small><strong>{Number(value).toLocaleString('pt-BR')}</strong></span>)}</div></section>
          <div className="brasfoot-preview-grid">
            <section><p className="eyebrow">AMOSTRA DE CLUBES</p><div className="brasfoot-preview-clubs">{previewClubs.map((club) => <div key={club.id}><span>{club.id.slice(0, 3).toUpperCase()}</span><strong>{club.name}</strong><small>{club.players} jogadores</small></div>)}{previewClubs.length === 0 && <p>Nenhum clube válido encontrado.</p>}</div></section>
            <aside><p className="eyebrow">RELATÓRIO</p>{previewErrors.map((item) => <p className="is-error" key={item}><XCircle size={13} /> {item}</p>)}{previewWarnings.map((item) => <p className="is-warning" key={item}><AlertTriangle size={13} /> {item}</p>)}{previewErrors.length === 0 && previewWarnings.length === 0 && <p className="is-success"><CheckCircle2 size={13} /> Nenhuma ocorrência encontrada.</p>}</aside>
          </div>
          <section className="brasfoot-import-options">
            {previewErrors.length > 0 && <label><input type="checkbox" checked={allowPartial} onChange={(event) => setAllowPartial(event.target.checked)} /><span><strong>Ignorar arquivos com erro e continuar</strong><small>Somente registros válidos serão gravados.</small></span></label>}
            <label className={!counts.png ? 'is-disabled' : undefined}><input type="checkbox" checked={importAssets} disabled={!counts.png} onChange={(event) => setImportAssets(event.target.checked)} /><span><strong>Enviar escudos encontrados</strong><small>{counts.png ? `${counts.png} imagem(ns) pronta(s) para o armazenamento configurado.` : 'Nenhum PNG foi selecionado.'}</small></span></label>
            <div><ShieldAlert size={15} /><span><strong>Atualização segura</strong> Registros com o mesmo ID serão atualizados. Os demais serão preservados.</span></div>
          </section>
        </>}

        {stage === 'done' && result && <section className="brasfoot-import-result"><span><CheckCircle2 size={29} /></span><p className="eyebrow">IMPORTAÇÃO CONCLUÍDA</p><h3>Dados gravados no Firebase</h3><p>O catálogo será atualizado assim que você concluir.</p><div>{[
          ['Clubes', summaryNumber(result.summary, 'clubs', 'clubsImported')], ['Jogadores', summaryNumber(result.summary, 'players', 'playersImported')], ['Ligas', summaryNumber(result.summary, 'leagues', 'leaguesImported')], ['Falhas', finalErrors.length],
        ].map(([label, value]) => <span key={label as string}><small>{label}</small><strong>{Number(value).toLocaleString('pt-BR')}</strong></span>)}</div><code>EXECUÇÃO · {result.runId ?? 'ID não informado'}</code></section>}
      </div>
    </Modal>
  );
}
