import { useEffect, useId, useState, type FormEvent } from 'react';
import { Bot, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { desktopBridge, type DesktopAiSettings, type DesktopBridge } from '../../lib/desktopClient';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';

interface DesktopAiSettingsPanelProps {
  guest?: boolean;
  bridge?: Pick<DesktopBridge, 'readAiSettings' | 'writeAiSettings' | 'testAiConnection'> | null;
}

function lastResultCopy(settings: DesktopAiSettings) {
  if (settings.lastResult === 'gemini') return 'A última resposta foi gerada pelo Gemini.';
  if (settings.lastResult === 'fallback') return 'A última resposta usou o texto automático de reserva, não IA generativa.';
  return 'Nenhuma geração registrada nesta sessão.';
}

export function DesktopAiSettingsPanel({ guest = false, bridge = desktopBridge }: DesktopAiSettingsPanelProps) {
  const id = useId();
  const [settings, setSettings] = useState<DesktopAiSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'loading' | 'saving' | 'testing' | 'removing' | 'disabling' | null>('loading');
  const [message, setMessage] = useState('Carregando configuração da IA…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!bridge) return;
    void bridge.readAiSettings().then((next) => {
      if (!active) return;
      setSettings(next);
      setMessage('Configuração carregada. Nenhuma chamada ao Gemini foi feita.');
    }).catch(() => {
      if (active) {
        setError('Não foi possível carregar a configuração da IA. Tente atualizar o status.');
        setMessage('Configuração indisponível. Nenhuma chamada ao Gemini foi feita.');
      }
    }).finally(() => {
      if (active) setBusy(null);
    });
    return () => { active = false; };
  }, [bridge]);

  if (!bridge) return null;

  async function refreshStatus() {
    if (!bridge || busy) return;
    setBusy('loading');
    setError(null);
    try {
      setSettings(await bridge.readAiSettings());
      setMessage('Status atualizado. Nenhuma chamada ao Gemini foi feita.');
    } catch {
      setError('Não foi possível atualizar o status da IA. Tente novamente.');
      setMessage('Status não atualizado. A configuração anterior foi preservada.');
    } finally {
      setBusy(null);
    }
  }

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedKey = apiKey.trim();
    setApiKey('');
    if (!bridge || guest || busy || !settings?.storageAvailable || !submittedKey) return;
    setBusy('saving');
    setError(null);
    try {
      setSettings(await bridge.writeAiSettings({ apiKey: submittedKey, enabled: true }));
      setMessage('Chave salva e Gemini ativado. As próximas respostas podem usar sua quota do Google.');
    } catch {
      setError('Não foi possível confirmar a ativação. A chave foi removida deste formulário; atualize o status antes de tentar novamente.');
      setMessage('Não foi possível confirmar a ativação. Atualize o status.');
    } finally {
      setBusy(null);
    }
  }

  async function updateActivation(enabled: boolean, removeKey = false) {
    if (!bridge || guest || busy || !settings?.configured) return;
    setBusy(removeKey ? 'removing' : 'disabling');
    setError(null);
    try {
      setSettings(await bridge.writeAiSettings({ enabled, ...(removeKey ? { removeKey: true } : {}) }));
      setApiKey('');
      setMessage(removeKey ? 'Chave removida deste computador. Gemini desativado.' : enabled
        ? 'Gemini ativado. As próximas respostas podem usar sua quota do Google.'
        : 'Gemini desativado. A chave permanece protegida neste computador.');
    } catch {
      setError('Não foi possível alterar a configuração da IA. Tente novamente.');
      setMessage('A alteração não foi confirmada. Atualize o status antes de tentar novamente.');
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    if (!bridge || guest || busy || !settings?.configured || !settings.enabled || !settings.storageAvailable) return;
    setBusy('testing');
    setError(null);
    setMessage('Testando conexão: uma solicitação será enviada ao Gemini…');
    try {
      const next = await bridge.testAiConnection();
      setSettings(next);
      if (next.lastResult === 'gemini') setMessage('Conexão validada: o Gemini respondeu ao teste.');
      else {
        setError('O Gemini não respondeu ao teste. Verifique sua conexão, a chave e a quota no Google AI Studio.');
        setMessage('Teste encerrado sem validar uma resposta do Gemini.');
      }
    } catch {
      setError('Não foi possível validar o Gemini. Verifique sua conexão, a chave e a quota no Google AI Studio.');
      setMessage('Teste encerrado sem validar uma resposta do Gemini.');
    } finally {
      setBusy(null);
    }
  }

  const status = !settings ? busy === 'loading' ? 'Carregando…' : 'Status indisponível' : !settings.configured ? 'Não configurado' : settings.enabled ? 'Gemini ativado' : 'Gemini desativado';
  const controlsDisabled = guest || Boolean(busy) || !settings;

  return (
    <section className="settings-section" id="settings-ai" aria-labelledby={`${id}-heading`} aria-busy={Boolean(busy)}>
      <header>
        <div><p className="eyebrow">RESPOSTAS AOS POSTS</p><h2 id={`${id}-heading`}>Inteligência artificial</h2></div>
        <Bot size={18} aria-hidden="true" />
      </header>
      <div className="setting-row settings-readonly-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span><strong>Gemini neste computador</strong><small>{settings ? `Modelo: ${settings.model}` : 'A configuração fica separada da carreira.'}</small></span>
        <Badge tone={settings?.configured && settings.enabled ? 'positive' : 'neutral'}>{status}</Badge>
      </div>
      <div className="setting-row settings-readonly-row">
        <span><strong>Última geração</strong><small>{settings ? lastResultCopy(settings) : 'Atualize o status para consultar o resultado.'}</small></span>
      </div>
      {settings?.lastError && <p className="settings-form-error" role="status">A última tentativa teve uma falha. O jogo usou ou poderá usar texto automático de reserva. Verifique a conexão, a chave e a quota do Gemini.</p>}
      {guest && <p className="settings-form-error" role="status">Você está conectado como convidado P2P. A IA da carreira é executada pelo anfitrião; somente ele pode configurar e testar o Gemini.</p>}
      {settings && !settings.storageAvailable && <p className="settings-form-error" role="status">A proteção de credenciais do sistema está indisponível. Não é possível salvar uma chave com segurança neste computador.</p>}
      <form onSubmit={(event) => void saveKey(event)}>
        <div className="settings-form">
          <label style={{ gridColumn: '1 / -1', minWidth: 0 }}>
            <span style={{ justifyContent: 'flex-start', gap: 6 }}><KeyRound size={13} aria-hidden="true" /> Sua chave da API Gemini</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              maxLength={512}
              disabled={controlsDisabled || !settings?.storageAvailable}
              onChange={(event) => setApiKey(event.target.value)}
              aria-describedby={`${id}-key-help`}
              placeholder={settings?.configured ? 'Chave salva. Cole outra apenas para substituir.' : 'Cole a chave do seu Google AI Studio'}
            />
          </label>
          <p id={`${id}-key-help`} style={{ gridColumn: '1 / -1', margin: 0, color: 'var(--ink-soft)', fontSize: 12, lineHeight: 1.6 }}>
            A chave é criptografada pela proteção do sistema operacional, separada do save, e nunca é exibida novamente. O campo é limpo ao salvar. Nenhuma chave é compartilhada com convidados P2P.
          </p>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="submit" variant="primary" loading={busy === 'saving'} disabled={controlsDisabled || !settings?.storageAvailable || !apiKey.trim()}>Salvar e ativar</Button>
            {settings?.configured && <Button type="button" disabled={controlsDisabled} loading={busy === 'disabling'} onClick={() => void updateActivation(!settings.enabled)}>{settings.enabled ? 'Desativar, manter chave' : 'Ativar chave salva'}</Button>}
            <Button type="button" variant="ghost" loading={busy === 'removing'} disabled={controlsDisabled || !settings?.configured} onClick={() => void updateActivation(false, true)}>Remover chave</Button>
          </div>
        </div>
      </form>
      <div className="setting-row settings-readonly-row" style={{ gap: 10 }}>
        <ShieldCheck size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0 }}><strong>Internet e uso da sua quota</strong><small>Posts e contexto fictício do clube são enviados ao Google, não o save inteiro. As solicitações podem consumir quota ou gerar custos conforme sua conta. No P2P, o anfitrião controla esse uso.</small></span>
      </div>
      <div style={{ padding: '0 14px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button type="button" loading={busy === 'testing'} disabled={controlsDisabled || !settings?.configured || !settings.enabled || !settings.storageAvailable} onClick={() => void testConnection()}>Testar conexão</Button>
        <Button type="button" variant="ghost" icon={<RefreshCw size={13} aria-hidden="true" />} loading={busy === 'loading'} disabled={Boolean(busy)} onClick={() => void refreshStatus()}>Atualizar status</Button>
      </div>
      <p style={{ margin: '0 14px 12px', color: 'var(--ink-soft)', fontSize: 12, lineHeight: 1.6 }}>“Testar conexão” faz uma chamada real ao Gemini. Salvar, ativar e atualizar o status não executam testes pagos automaticamente.</p>
      {error && <p className="settings-form-error" role="alert">{error}</p>}
      <footer><span role="status" aria-live="polite">{message}</span></footer>
    </section>
  );
}
