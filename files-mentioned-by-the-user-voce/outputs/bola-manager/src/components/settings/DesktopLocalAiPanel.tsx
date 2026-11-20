import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Cpu, Download, RefreshCw } from 'lucide-react';
import { desktopBridge, type DesktopBridge, type DesktopLocalAiStatus } from '../../lib/desktopClient';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';

type LocalAiBridge = Pick<DesktopBridge, 'localAiStatus' | 'localAiDownload' | 'localAiCancel' | 'localAiSetEnabled' | 'localAiRemove'>;
type Busy = 'loading' | 'download' | 'cancel' | 'toggle' | 'remove' | null;

const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;

export function localAiBadge(status: DesktopLocalAiStatus | null) {
  if (!status) return { tone: 'neutral' as const, label: 'Carregando…' };
  if (status.downloading) return { tone: 'info' as const, label: `Baixando ${Math.floor((status.received / Math.max(1, status.bytes)) * 100)}%` };
  if (!status.installed) return { tone: 'neutral' as const, label: 'Não baixada' };
  return status.enabled ? { tone: 'positive' as const, label: 'Ativa' } : { tone: 'neutral' as const, label: 'Baixada, desativada' };
}

/** Optional on-device model for the social feed: no internet or cost per reply, light on the PC. */
export function DesktopLocalAiPanel({ guest = false, bridge = desktopBridge }: { guest?: boolean; bridge?: LocalAiBridge | null }) {
  const id = useId();
  const [status, setStatus] = useState<DesktopLocalAiStatus | null>(null);
  const [busy, setBusy] = useState<Busy>('loading');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const available = Boolean(bridge?.localAiStatus);

  const refresh = useCallback(async () => {
    if (!bridge?.localAiStatus) return;
    try { const next = await bridge.localAiStatus(); if (mounted.current) setStatus(next); }
    catch { if (mounted.current) setError('Não foi possível consultar a IA local.'); }
  }, [bridge]);

  useEffect(() => {
    mounted.current = true;
    void refresh().finally(() => { if (mounted.current) setBusy(null); });
    return () => { mounted.current = false; };
  }, [refresh]);

  // While downloading, follow progress once per second.
  useEffect(() => {
    if (!status?.downloading) return undefined;
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => window.clearInterval(timer);
  }, [status?.downloading, refresh]);

  if (!available || !bridge) return null;

  async function run(kind: Exclude<Busy, null>, task: () => Promise<DesktopLocalAiStatus>, failure: string) {
    if (busy) return;
    setBusy(kind); setError(null);
    try { const next = await task(); if (mounted.current) setStatus(next); }
    catch { if (mounted.current) setError(failure); }
    finally { if (mounted.current) setBusy(null); }
  }

  const badge = localAiBadge(status);
  const disabled = guest || Boolean(busy) || !status;
  const downloadFailed = status?.downloadError && status.downloadError !== 'LOCAL_AI_DOWNLOAD_CANCELLED';

  return (
    <section className="settings-section" id="settings-local-ai" aria-labelledby={`${id}-heading`} aria-busy={Boolean(busy)}>
      <header>
        <div><p className="eyebrow">SEM INTERNET · SEM CUSTO</p><h2 id={`${id}-heading`}>IA local</h2></div>
        <Cpu size={18} aria-hidden="true" />
      </header>
      <div className="setting-row settings-readonly-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span><strong>{status?.label ?? 'Modelo local'}{status ? ` · ${gigabytes(status.bytes)}` : ''}</strong><small>Escreve os comentários da torcida no seu computador. Tem prioridade sobre o Gemini quando ativada.</small></span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <div className="setting-row settings-readonly-row">
        <span><strong>Leve para o PC</strong><small>Usa no máximo {status?.threads ?? 2} núcleos do processador, só enquanto escreve (cerca de 5 a 20 s por rodada), em prioridade baixa. Ocupa ~2 GB de memória durante a escrita e libera tudo 90 s depois. Se falhar, o jogo segue com as respostas automáticas.</small></span>
      </div>
      {status?.downloading && (
        <div style={{ padding: '0 14px 12px' }}>
          <progress max={status.bytes} value={status.received} style={{ width: '100%' }} aria-label="Progresso do download da IA local" />
          <small style={{ color: 'var(--ink-soft)' }}>{gigabytes(status.received)} de {gigabytes(status.bytes)}</small>
        </div>
      )}
      {downloadFailed && <p className="settings-form-error" role="status">O download não terminou ou o arquivo não passou na verificação. Tente baixar de novo.</p>}
      {guest && <p className="settings-form-error" role="status">No P2P a IA roda no computador do anfitrião.</p>}
      <div style={{ padding: '0 14px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!status?.installed && !status?.downloading && <Button type="button" variant="primary" icon={<Download size={14} aria-hidden="true" />} loading={busy === 'download'} disabled={disabled}
          onClick={() => void run('download', () => bridge.localAiDownload!(), 'Não foi possível iniciar o download.')}>Baixar IA local{status ? ` (${gigabytes(status.bytes)})` : ''}</Button>}
        {status?.downloading && <Button type="button" loading={busy === 'cancel'} disabled={Boolean(busy)}
          onClick={() => void run('cancel', () => bridge.localAiCancel!(), 'Não foi possível cancelar.')}>Cancelar download</Button>}
        {status?.installed && <Button type="button" variant={status.enabled ? undefined : 'primary'} loading={busy === 'toggle'} disabled={disabled}
          onClick={() => void run('toggle', () => bridge.localAiSetEnabled!(!status.enabled), 'Não foi possível alterar a IA local.')}>{status.enabled ? 'Desativar IA local' : 'Ativar IA local'}</Button>}
        {status?.installed && <Button type="button" variant="ghost" loading={busy === 'remove'} disabled={disabled}
          onClick={() => void run('remove', () => bridge.localAiRemove!(), 'Não foi possível remover o modelo.')}>Remover modelo</Button>}
        <Button type="button" variant="ghost" icon={<RefreshCw size={13} aria-hidden="true" />} disabled={Boolean(busy)} onClick={() => void refresh()}>Atualizar</Button>
      </div>
      <p style={{ margin: '0 14px 12px', color: 'var(--ink-soft)', fontSize: 12, lineHeight: 1.6 }}>Download único de um modelo aberto (Qwen3, licença Apache 2.0), verificado por hash. Nada é enviado para a internet ao gerar respostas.</p>
      {error && <p className="settings-form-error" role="alert">{error}</p>}
    </section>
  );
}
