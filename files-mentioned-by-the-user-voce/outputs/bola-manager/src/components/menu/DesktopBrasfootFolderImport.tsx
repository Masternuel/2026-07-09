import { useRef, useState } from 'react';
import { Check, FolderOpen, ShieldCheck } from 'lucide-react';
import type { DesktopBridge, DesktopBrasfootPreview } from '../../lib/desktopClient';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';

const COUNTRY_NAMES: Record<string, string> = {
  BRA: 'Brasil', ARG: 'Argentina', URU: 'Uruguai', CHI: 'Chile', COL: 'Colômbia', PAR: 'Paraguai', PER: 'Peru',
  EQU: 'Equador', BOL: 'Bolívia', VEN: 'Venezuela', MEX: 'México', EUA: 'Estados Unidos', ING: 'Inglaterra',
  ESP: 'Espanha', ITA: 'Itália', ALE: 'Alemanha', FRA: 'França', POR: 'Portugal', HOL: 'Holanda', BEL: 'Bélgica',
  ESC: 'Escócia', TUR: 'Turquia', RUS: 'Rússia', JAP: 'Japão', ARA: 'Arábia Saudita',
};

export const countryLabel = (code: string) => COUNTRY_NAMES[code] ?? code;

type Action = 'preview' | 'cancel' | 'commit';

export function DesktopBrasfootFolderImport({ bridge, disabled = false }: { bridge: DesktopBridge; disabled?: boolean }) {
  const [preview, setPreview] = useState<DesktopBrasfootPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  if (!bridge.brasfootFolderPreview || !bridge.brasfootFolderCommit) return null;

  async function run(action: Action, task: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(action);
    setError(null);
    try { await task(); } finally { busy.current = false; setPending(null); }
  }

  const choose = () => run('preview', async () => {
    try {
      const next = await bridge.brasfootFolderPreview!();
      if (!next) return;
      setPreview(next);
      setSelected(new Set(next.countries.some((item) => item.country === 'BRA') ? ['BRA'] : next.countries.slice(0, 1).map((item) => item.country)));
    } catch {
      setError('Não foi possível ler esta pasta. Selecione a pasta onde o Brasfoot está instalado (com as pastas teams e conf_ligas_nacionais).');
    }
  });

  const close = () => run('cancel', async () => {
    if (preview) await bridge.brasfootFolderCancel?.(preview.id).catch(() => undefined);
    setPreview(null);
  });

  const totals = (preview?.countries ?? []).filter((item) => selected.has(item.country))
    .reduce((sum, item) => ({ clubs: sum.clubs + item.clubs, players: sum.players + item.players, crests: sum.crests + item.crests }), { clubs: 0, players: 0, crests: 0 });
  const tooLarge = Boolean(preview) && (totals.clubs > preview!.limits.clubs || totals.players > preview!.limits.players);

  const commit = () => run('commit', async () => {
    if (!preview || !selected.size || tooLarge) return;
    try { await bridge.brasfootFolderCommit!({ id: preview.id, countries: [...selected] }); }
    catch { setError('Não foi possível concluir a importação. A base anterior foi preservada.'); }
  });

  const toggle = (country: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(country)) next.delete(country); else next.add(country);
    return next;
  });

  return (
    <section className="desktop-catalog-import__active" aria-labelledby="desktop-brasfoot-folder-title">
      <header><span id="desktop-brasfoot-folder-title"><FolderOpen size={16} aria-hidden="true" /> Importar do Brasfoot instalado</span><Badge tone="info">Com escudos</Badge></header>
      <p className="catalog-subtle">Lê direto a pasta do Brasfoot neste computador: clubes nas divisões certas, elencos e escudos. Você escolhe os países; as notas são geradas pelo Bola Manager.</p>
      <Button icon={<FolderOpen size={16} aria-hidden="true" />} loading={pending === 'preview'} disabled={disabled || Boolean(pending)} onClick={() => void choose()}>Selecionar pasta do Brasfoot</Button>
      {pending === 'preview' && <p className="catalog-subtle" role="status">Lendo os times do Brasfoot… pode levar alguns segundos.</p>}
      {error && !preview && <p className="catalog-feedback catalog-feedback--error" role="alert">{error}</p>}

      <Modal open={Boolean(preview)} title="Escolha os países" eyebrow="IMPORTAR DO BRASFOOT" onClose={() => void close()} footer={<><Button disabled={Boolean(pending)} loading={pending === 'cancel'} onClick={() => void close()}>Cancelar</Button><Button variant="primary" icon={<Check size={16} aria-hidden="true" />} disabled={!selected.size || tooLarge || Boolean(pending)} loading={pending === 'commit'} onClick={() => void commit()}>Importar {selected.size} país(es)</Button></>}>
        {preview && <div className="catalog-confirmation" aria-busy={pending === 'commit'}>
          <p className="catalog-confirmation__intro">Somente clubes que estão em alguma divisão nacional aparecem aqui.</p>
          <div className="brasfoot-countries" role="group" aria-label="Países do Brasfoot">
            {preview.countries.map((item) => (
              <label key={item.country} className="catalog-acknowledgement">
                <input type="checkbox" checked={selected.has(item.country)} onChange={() => toggle(item.country)} disabled={Boolean(pending)} />
                <span><strong>{countryLabel(item.country)}</strong> · {item.leagues} divisão(ões) · {item.clubs.toLocaleString('pt-BR')} clubes · {item.players.toLocaleString('pt-BR')} jogadores · {item.crests.toLocaleString('pt-BR')} escudos</span>
              </label>
            ))}
          </div>
          <p className="catalog-subtle" role="status">Selecionado: {totals.clubs.toLocaleString('pt-BR')} clubes, {totals.players.toLocaleString('pt-BR')} jogadores, {totals.crests.toLocaleString('pt-BR')} escudos.{tooLarge ? ` Acima do limite (${preview.limits.clubs.toLocaleString('pt-BR')} clubes e ${preview.limits.players.toLocaleString('pt-BR')} jogadores): escolha menos países.` : ''}</p>
          <aside className="catalog-safety"><ShieldCheck size={20} aria-hidden="true" /><p>A base atual é substituída só para <strong>novas carreiras</strong>; as existentes continuam com a anterior. Um backup completo é criado antes. Os arquivos do Brasfoot não são alterados.</p></aside>
          {error && <p className="catalog-feedback catalog-feedback--error" role="alert">{error}</p>}
          {pending === 'commit' && <p className="catalog-feedback" role="status">Importando clubes e escudos. O launcher reinicia ao terminar…</p>}
        </div>}
      </Modal>
    </section>
  );
}
