import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, Database, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { BrandLogo } from '../components/shared/BrandLogo';
import { useAuth } from '../hooks/useAuth';
import { ApiError, apiBlobDownload } from '../lib/apiClient';

type ExportAction = 'login' | 'export' | 'logout';

function exportFailure(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return 'Sua conta não pôde autorizar a exportação. Saia e entre novamente com a conta Google que contém sua base.';
  }
  return 'Não foi possível baixar a base. Confira sua conexão, se o servidor web está em execução e se ele usa o mesmo projeto Firebase da sua conta.';
}

export function DesktopExportView() {
  const auth = useAuth();
  const [pending, setPending] = useState<ExportAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const inFlight = useRef<ExportAction | null>(null);
  const mounted = useRef(false);
  const downloadController = useRef<AbortController | null>(null);
  const account = auth.identity?.mode === 'firebase' ? auth.identity : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; downloadController.current?.abort(); };
  }, []);

  function startAction(action: ExportAction) {
    if (inFlight.current) return false;
    inFlight.current = action;
    setPending(action);
    setError(null);
    auth.clearError();
    return true;
  }

  function finishAction() {
    inFlight.current = null;
    if (mounted.current) setPending(null);
  }

  async function signIn() {
    if (!auth.firebaseConfigured || !startAction('login')) return;
    try {
      await auth.signInGoogle();
      if (mounted.current) setDownloadRequested(false);
    } catch {
      if (mounted.current) setError('Não foi possível entrar com Google. Permita a janela de login, confira sua conexão e a configuração Firebase desta versão web.');
    } finally {
      finishAction();
    }
  }

  async function signOut() {
    if (!startAction('logout')) return;
    try {
      await auth.signOut();
      if (mounted.current) setDownloadRequested(false);
    } catch {
      if (mounted.current) setError('Não foi possível sair da conta. Feche esta página e confira sua sessão no navegador.');
    } finally {
      finishAction();
    }
  }

  async function downloadCatalog() {
    if (!account || !auth.firebaseConfigured || !startAction('export')) return;
    setDownloadRequested(false);
    const controller = new AbortController();
    downloadController.current = controller;
    try {
      const download = await apiBlobDownload('/api/editor/database/export', {
        identity: account,
        getIdToken: auth.getIdToken,
      }, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const objectUrl = URL.createObjectURL(download.blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'bola-manager-base.json';
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
      setDownloadRequested(true);
    } catch (nextError) {
      if (mounted.current && !controller.signal.aborted) setError(exportFailure(nextError));
    } finally {
      downloadController.current = null;
      finishAction();
    }
  }

  return (
    <main className="desktop-export" aria-labelledby="desktop-export-title">
      <header className="desktop-export__brand"><BrandLogo /><Badge tone="neutral">Versão web</Badge></header>
      <div className="desktop-export__layout">
        <section className="desktop-export__intro">
          <p className="eyebrow">UMA CÓPIA. NOVO PONTO DE PARTIDA.</p>
          <h1 id="desktop-export-title">Sua base,<br />agora <span>no desktop.</span></h1>
          <p>Exporte o catálogo da sua conta Google e leve o arquivo para o launcher. Depois da importação, novas carreiras usam a base local para jogar offline.</p>
          <ol className="desktop-export__guide"><li><span>01</span><div><strong>Entre na conta certa</strong><p>Use a conta Google que já possui sua base nesta versão web.</p></div></li><li><span>02</span><div><strong>Baixe o catálogo</strong><p>A exportação só começa quando você clicar em baixar.</p></div></li><li><span>03</span><div><strong>Volte ao launcher</strong><p>Abra Editor da Base e escolha “Selecionar base exportada”.</p></div></li></ol>
          <aside className="catalog-safety"><ShieldCheck size={21} aria-hidden="true" /><p>A base remota permanece intacta. Não há sincronização, transferência do seu perfil local ou migração de saves da nuvem.</p></aside>
        </section>

        <section className="desktop-export__panel" aria-labelledby="desktop-export-account-title">
          <header><Database size={22} aria-hidden="true" /><p className="eyebrow">EXPORTAÇÃO DO CATÁLOGO</p><h2 id="desktop-export-account-title">Da sua conta para um arquivo.</h2></header>
          {auth.status === 'loading' ? <p className="catalog-feedback" role="status">Verificando sua sessão Google…</p> : !auth.firebaseConfigured ? <div className="catalog-feedback catalog-feedback--error" role="alert"><h3>Firebase não configurado nesta versão web.</h3><p>Não é possível entrar ou exportar uma base aqui. Execute a versão web antiga com a configuração do mesmo projeto Firebase da sua conta e abra esta página novamente. O servidor web também precisa estar disponível.</p></div> : account ? <>
            <div className="desktop-export__account"><span className="desktop-export__account-icon"><UserRound size={22} aria-hidden="true" /></span><div><Badge tone="positive">Conta conectada</Badge><strong>{account.displayName}</strong><span>{account.email || 'Conta Google autenticada'}</span></div></div>
            <p className="catalog-subtle">Confira a conta acima antes de baixar. O arquivo contém apenas o catálogo de ligas, clubes, jogadores e torneios.</p>
            <Button variant="primary" className="desktop-export__download" icon={<ArrowDownToLine size={17} aria-hidden="true" />} loading={pending === 'export'} disabled={Boolean(pending)} onClick={() => void downloadCatalog()}>Baixar minha base (.json)</Button>
            <Button variant="ghost" icon={<LogOut size={15} aria-hidden="true" />} loading={pending === 'logout'} disabled={Boolean(pending)} onClick={() => void signOut()}>Sair da conta</Button>
          </> : <>
            <p className="desktop-export__signin-copy">Entre com Google para acessar seu catálogo individual. Este login acontece apenas no navegador.</p>
            <Button variant="secondary" className="desktop-export__google" loading={pending === 'login'} disabled={Boolean(pending)} onClick={() => void signIn()}><span className="google-g" aria-hidden="true">G</span>Entrar com Google</Button>
            <p className="catalog-subtle">A versão web e o servidor precisam usar o mesmo projeto Firebase da sua conta. Nenhum download será feito automaticamente.</p>
          </>}
          {pending === 'export' && <p className="catalog-feedback" role="status">Preparando uma cópia do catálogo. Aguarde o download…</p>}
          {(error || (auth.error && !pending)) && <p className="catalog-feedback catalog-feedback--error" role="alert">{error || 'Não foi possível verificar o acesso à conta. Confira a configuração Firebase e entre novamente.'}</p>}
          {downloadRequested && <div className="catalog-feedback catalog-feedback--success" role="status"><Check size={17} aria-hidden="true" /><p>Download solicitado. Volte ao launcher e selecione o JSON na pasta em que você o salvou.</p></div>}
          <footer className="desktop-export__scope"><strong>O que não acompanha o arquivo</strong><p>Saves da nuvem e arquivos binários de imagens não são exportados. Referências de imagens podem precisar de internet no desktop.</p></footer>
        </section>
      </div>
      <footer className="desktop-export__footer">Cópia manual do catálogo · Sem alteração na base remota · Sem sincronização</footer>
    </main>
  );
}
