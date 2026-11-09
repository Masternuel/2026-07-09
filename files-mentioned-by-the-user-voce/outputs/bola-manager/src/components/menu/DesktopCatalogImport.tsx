import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Database, FileJson, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  desktopBridge,
  type DesktopBridge,
  type DesktopCatalogCounts,
  type DesktopCatalogPreview,
  type DesktopCatalogStatus,
} from '../../lib/desktopClient';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';

type ImportAction = 'browser' | 'preview' | 'cancel' | 'commit';
const countLabels = { leagues: 'Ligas', clubs: 'Clubes', players: 'Jogadores', tournaments: 'Torneios' } as const;

export function localCatalogOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function catalogDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Data não informada';
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function CatalogCounts({ counts }: { counts: DesktopCatalogCounts }) {
  return <dl className="catalog-counts">{(Object.keys(countLabels) as (keyof DesktopCatalogCounts)[]).map((key) => (
    <div key={key}><dt>{countLabels[key]}</dt><dd>{counts[key].toLocaleString('pt-BR')}</dd></div>
  ))}</dl>;
}

export function DesktopCatalogImport({ bridge = desktopBridge }: { bridge?: DesktopBridge | null }) {
  const [status, setStatus] = useState<DesktopCatalogStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(Boolean(bridge));
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusRevision, setStatusRevision] = useState(0);
  const [origin, setOrigin] = useState('http://localhost:5173');
  const [pending, setPending] = useState<ImportAction | null>(null);
  const [preview, setPreview] = useState<DesktopCatalogPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef<ImportAction | null>(null);
  const previewRef = useRef<DesktopCatalogPreview | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (previewRef.current && inFlight.current !== 'commit') {
        void bridge?.catalogCancel(previewRef.current.id).catch(() => undefined);
      }
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    setStatusLoading(true);
    setStatusFailed(false);
    void bridge.catalogStatus().then((next) => {
      if (active) setStatus(next);
    }).catch(() => {
      if (active) setStatusFailed(true);
    }).finally(() => {
      if (active) setStatusLoading(false);
    });
    return () => { active = false; };
  }, [bridge, statusRevision]);

  function startAction(action: ImportAction) {
    if (!bridge || inFlight.current) return false;
    inFlight.current = action;
    setPending(action);
    setError(null);
    setNotice(null);
    return true;
  }

  function finishAction() {
    inFlight.current = null;
    if (mounted.current) setPending(null);
  }

  async function openBrowser() {
    if (!bridge || inFlight.current) return;
    const localOrigin = localCatalogOrigin(origin);
    if (!localOrigin) {
      setError('Informe somente um endereço local, como http://localhost:5173, sem caminho, parâmetros ou dados de acesso.');
      return;
    }
    if (!startAction('browser')) return;
    try {
      await bridge.catalogOpenBrowser(localOrigin);
      if (mounted.current) setNotice('Continue no navegador: entre com Google e baixe a base. Seu perfil no launcher continua local.');
    } catch {
      if (mounted.current) setError('Não foi possível abrir a página de exportação. Confira o endereço e se a versão web antiga está em execução.');
    } finally {
      finishAction();
    }
  }

  async function selectFile() {
    if (!bridge || !startAction('preview')) return;
    try {
      const next = await bridge.catalogPreview();
      if (!mounted.current) {
        if (next) void bridge.catalogCancel(next.id).catch(() => undefined);
        return;
      }
      if (next) {
        previewRef.current = next;
        setPreview(next);
        setAcknowledged(false);
      }
    } catch {
      if (mounted.current) setError('Não foi possível validar esta base. Selecione um JSON exportado pelo Editor e confira se o arquivo está completo.');
    } finally {
      finishAction();
    }
  }

  async function cancelPreview() {
    if (!bridge || !previewRef.current || !startAction('cancel')) return;
    try {
      await bridge.catalogCancel(previewRef.current.id);
    } catch {
      if (mounted.current) setError('Não foi possível descartar a prévia. Confira a base ativa antes de selecionar o arquivo novamente.');
    } finally {
      previewRef.current = null;
      if (mounted.current) { setPreview(null); setAcknowledged(false); setStatusRevision((value) => value + 1); }
      finishAction();
    }
  }

  async function commitPreview() {
    if (!bridge || !previewRef.current || !acknowledged || !startAction('commit')) return;
    try {
      await bridge.catalogCommit(previewRef.current.id);
      if (mounted.current) setNotice('Base importada. O launcher está reiniciando para usar o catálogo local.');
      // The main process reloads the launcher. Keep controls locked until that happens.
    } catch {
      if (mounted.current) setError('Não foi possível concluir a importação. Cancele esta prévia e confira a base ativa antes de selecionar o arquivo novamente.');
      finishAction();
    }
  }

  if (!bridge) return (
    <section className="desktop-catalog-import" aria-labelledby="desktop-catalog-import-title">
      <header className="desktop-catalog-import__heading"><div><p className="eyebrow">DO GOOGLE PARA O COMPUTADOR</p><h2 id="desktop-catalog-import-title">Trazer sua base</h2></div><Database size={22} aria-hidden="true" /></header>
      <p className="catalog-subtle">A importação está disponível apenas no launcher desktop, com o perfil local. No launcher, use Abrir Editor para editar o catálogo deste computador.</p>
    </section>
  );

  return (
    <section className="desktop-catalog-import" aria-labelledby="desktop-catalog-import-title">
      <header className="desktop-catalog-import__heading"><div><p className="eyebrow">DO GOOGLE PARA O COMPUTADOR</p><h2 id="desktop-catalog-import-title">Trazer sua base</h2><p>Uma cópia do seu catálogo para iniciar novas carreiras offline. Sem sincronização.</p></div><Badge tone="info">Importação local</Badge></header>

      <section className="desktop-catalog-import__active" aria-label="Catálogo local ativo" aria-busy={statusLoading}>
        <header><span><Database size={16} aria-hidden="true" /> Base ativa neste computador</span>{status && <Badge tone={status.source === 'local-import' ? 'positive' : 'neutral'}>{status.source === 'local-import' ? 'Base importada' : 'Base inicial'}</Badge>}</header>
        {statusLoading ? <p className="catalog-subtle" role="status">Consultando a base local…</p> : statusFailed ? <div className="catalog-feedback catalog-feedback--error" role="alert"><p>Não foi possível consultar a base ativa.</p><Button size="sm" onClick={() => setStatusRevision((value) => value + 1)} disabled={Boolean(pending)}>Tentar novamente</Button></div> : status ? <>
          <CatalogCounts counts={status.counts} />
          <p className="catalog-subtle">{status.source === 'local-import' ? `Importada em ${catalogDate(status.importedAt)}.` : 'Catálogo inicial do launcher.'} {status.preservedCareers.toLocaleString('pt-BR')} carreira(s) preservada(s) neste computador.</p>
        </> : <p className="catalog-subtle">Nenhuma informação de catálogo disponível.</p>}
      </section>

      <ol className="desktop-catalog-import__steps">
        <li><span className="catalog-step-index" aria-hidden="true">01</span><div>
          <h3>Exporte no navegador</h3>
          <p>A versão web antiga precisa estar em execução neste computador, configurada com o mesmo projeto Firebase. Entre com a conta Google que contém sua base.</p>
          <label className="catalog-origin" htmlFor="catalog-web-origin"><span>Endereço da versão web antiga</span><input id="catalog-web-origin" type="url" autoComplete="off" spellCheck={false} value={origin} onChange={(event) => setOrigin(event.target.value)} disabled={Boolean(pending)} aria-describedby="catalog-origin-hint" /></label>
          <p id="catalog-origin-hint" className="catalog-subtle">Somente endereços locais (localhost, 127.0.0.1 ou [::1]). O login acontece fora do launcher.</p>
          <Button icon={<ArrowUpRight size={16} aria-hidden="true" />} loading={pending === 'browser'} disabled={Boolean(pending)} onClick={() => void openBrowser()}>Entrar com Google no navegador</Button>
        </div></li>
        <li><span className="catalog-step-index" aria-hidden="true">02</span><div>
          <h3>Selecione e confira a cópia</h3>
          <p>Depois do download, selecione o arquivo JSON para validar e revisar o conteúdo. Se já possui uma base exportada pelo Editor, pode começar por aqui.</p>
          <Button variant="primary" icon={<FileJson size={16} aria-hidden="true" />} loading={pending === 'preview'} disabled={Boolean(pending) || statusLoading || statusFailed || !status} onClick={() => void selectFile()}>Selecionar base exportada</Button>
          <p className="catalog-subtle">Nada muda até a sua confirmação na próxima janela.</p>
        </div></li>
      </ol>

      <aside className="catalog-safety"><ShieldCheck size={20} aria-hidden="true" /><p>O catálogo ativo é substituído somente para <strong>novas carreiras</strong>. As carreiras existentes mantêm sua base anterior. Um backup local completo é criado automaticamente antes da importação.</p></aside>
      {error && !preview && <p className="catalog-feedback catalog-feedback--error" role="alert">{error}</p>}
      {notice && !preview && <p className="catalog-feedback" role="status">{notice}</p>}

      <Modal open={Boolean(preview)} title="Confirmar importação da base" eyebrow="ÚLTIMA CONFERÊNCIA" onClose={() => void cancelPreview()} footer={<><Button disabled={Boolean(pending)} loading={pending === 'cancel'} onClick={() => void cancelPreview()}>Cancelar</Button><Button variant="primary" icon={<Check size={16} aria-hidden="true" />} disabled={!acknowledged || Boolean(pending)} loading={pending === 'commit'} onClick={() => void commitPreview()}>Confirmar importação</Button></>}>
        {preview && <div className="catalog-confirmation" aria-busy={pending === 'commit'}>
          <p className="catalog-confirmation__intro">O arquivo foi validado. Confira o catálogo que será usado nas próximas carreiras:</p>
          <CatalogCounts counts={preview.counts} />
          <p className="catalog-subtle">Arquivo de {(preview.bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB · Prévia válida até {catalogDate(preview.expiresAt)}.</p>
          <aside className="catalog-safety"><ShieldCheck size={20} aria-hidden="true" /><p><strong>{preview.existingCareers.toLocaleString('pt-BR')} carreira(s) existente(s) preservada(s).</strong> Elas continuam com a base anterior. A importação cria um backup local completo antes de substituir o catálogo ativo para novas carreiras.</p></aside>
          <aside className="catalog-safety catalog-safety--warning"><TriangleAlert size={20} aria-hidden="true" /><p><strong>Esta cópia não migra saves da nuvem nem arquivos binários de imagens.</strong> Referências de imagens podem exigir conexão com a internet. A base remota não será alterada; seu perfil no launcher permanece local.</p></aside>
          <label className="catalog-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={Boolean(pending)} /><span>Entendi que esta base substituirá o catálogo ativo para novas carreiras.</span></label>
          {error && <p className="catalog-feedback catalog-feedback--error" role="alert">{error}</p>}
          {pending === 'commit' && <p className="catalog-feedback" role="status">{notice || 'Criando o backup e importando a base. Aguarde o reinício do launcher…'}</p>}
        </div>}
      </Modal>
    </section>
  );
}
