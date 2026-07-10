import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRightLeft, BarChart3, ChevronRight, CircleGauge, FastForward, Flag, Goal, Pause, Play, Shield, SlidersHorizontal, Sparkles, SquareDashedBottom } from 'lucide-react';
import { MatchFeed } from '../components/match/MatchFeed';
import { MatchScore } from '../components/match/MatchScore';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { Modal } from '../components/shared/Modal';
import { ProgressBar } from '../components/shared/ProgressBar';
import { matchEvents, players } from '../data/demoData';
import type { ServerMatchController } from '../hooks/useServerMatch';
import type { MatchEvent } from '../types';

interface MatchViewProps {
  onToast: (message: string) => void;
  onlineMatch: ServerMatchController | null;
}

export function MatchView({ onToast, onlineMatch }: MatchViewProps) {
  const [eventCount, setEventCount] = useState(2);
  const [running, setRunning] = useState(true);
  const [subOpen, setSubOpen] = useState(false);
  const [tacticOpen, setTacticOpen] = useState(false);
  const [outPlayer, setOutPlayer] = useState('p11');
  const [inPlayer, setInPlayer] = useState('p17');
  const [mentality, setMentality] = useState('Positiva');
  const [extraEvents, setExtraEvents] = useState<MatchEvent[]>([]);
  const [substitutionCount, setSubstitutionCount] = useState(0);
  const onlineStartRequested = useRef(false);

  const localFinished = eventCount >= matchEvents.length;
  const localRevealed = useMemo(() => [...matchEvents.slice(0, eventCount), ...extraEvents].sort((a, b) => a.minute - b.minute), [eventCount, extraEvents]);
  const finished = onlineMatch ? onlineMatch.phase === 'finished' : localFinished;
  const revealed = onlineMatch ? onlineMatch.events : localRevealed;
  const currentMinute = revealed.at(-1)?.minute ?? 0;
  const score = onlineMatch?.score ?? revealed.reduce<[number, number]>((latest, event) => event.score ?? latest, [0, 0]);
  const progress = Math.min(100, currentMinute / 0.9);

  useEffect(() => {
    if (onlineMatch || !running || finished) return;
    const timer = window.setInterval(() => setEventCount((count) => Math.min(matchEvents.length, count + 1)), 800);
    return () => window.clearInterval(timer);
  }, [finished, running, onlineMatch]);

  useEffect(() => {
    if (!onlineMatch || !onlineMatch.connected || onlineMatch.phase !== 'idle' || onlineStartRequested.current) return;
    onlineStartRequested.current = true;
    void onlineMatch.start().catch((nextError: unknown) => {
      onlineStartRequested.current = false;
      onToast(nextError instanceof Error ? nextError.message : 'Não foi possível iniciar a partida online.');
    });
  }, [onlineMatch, onlineMatch?.connected, onlineMatch?.phase, onToast]);

  function confirmSubstitution() {
    if (substitutionCount >= 5) {
      onToast('O limite de cinco substituições já foi utilizado.');
      setSubOpen(false);
      return;
    }
    const outgoing = players.find((player) => player.id === outPlayer)?.shortName ?? 'jogador';
    const incoming = players.find((player) => player.id === inPlayer)?.shortName ?? 'reserva';
    setExtraEvents((events) => [...events, { minute: Math.max(1, currentMinute), kind: 'sub', text: `SUBSTITUIÇÃO DO AURORA: sai ${outgoing}, entra ${incoming}.` }]);
    setSubstitutionCount((count) => count + 1);
    setSubOpen(false);
    onToast('Substituição enviada à beira do campo.');
  }

  async function skipToResult() {
    if (onlineMatch) {
      try {
        await onlineMatch.skip();
        onToast('O servidor concluiu a transmissão da partida.');
      } catch (nextError) {
        onToast(nextError instanceof Error ? nextError.message : 'Não foi possível pular a partida.');
      }
      return;
    }
    setEventCount(matchEvents.length);
    setRunning(false);
    onToast('Simulação concluída. Vitória do Aurora por 2 a 1.');
  }

  const homePossession = onlineMatch?.statistics?.home.possession ?? Math.round(52 + eventCount * 0.32);
  const awayPossession = onlineMatch?.statistics?.away.possession ?? 100 - homePossession;
  const statRows = onlineMatch?.statistics ? [
    ['Posse', `${homePossession}%`, `${awayPossession}%`, homePossession],
    ['Finalizações', String(onlineMatch.statistics.home.shots), String(onlineMatch.statistics.away.shots), 55],
    ['No alvo', String(onlineMatch.statistics.home.shotsOnTarget), String(onlineMatch.statistics.away.shotsOnTarget), 55],
    ['Escanteios', String(onlineMatch.statistics.home.corners), String(onlineMatch.statistics.away.corners), 55],
    ['Faltas', String(onlineMatch.statistics.home.fouls), String(onlineMatch.statistics.away.fouls), 50],
  ] : [
    ['Posse', `${homePossession}%`, `${awayPossession}%`, homePossession],
    ['Finalizações', String(Math.min(16, 3 + eventCount)), String(Math.min(10, 2 + Math.floor(eventCount * 0.55))), 62],
    ['No alvo', String(Math.min(7, 1 + Math.floor(eventCount * 0.45))), String(Math.min(4, Math.floor(eventCount * 0.3))), 65],
    ['Escanteios', String(Math.min(6, Math.floor(eventCount * 0.4))), String(Math.min(5, Math.floor(eventCount * 0.3))), 56],
    ['Faltas', String(Math.min(12, Math.floor(eventCount * 0.7))), String(Math.min(14, Math.floor(eventCount * 0.75))), 46],
  ];

  return (
    <main className="match-view view-enter">
      <MatchScore minute={currentMinute} score={score} finished={finished} events={revealed} />
      <div className="match-progress"><span style={{ width: `${progress}%` }} /><i style={{ left: `${progress}%` }} /></div>

      <div className="match-layout">
        <section className="commentary-panel">
          <header><div><p className="eyebrow">TRANSMISSÃO EM TEXTO</p><h2>Narração ao vivo</h2></div><button className="icon-button" onClick={() => setRunning((value) => !value)} disabled={finished || Boolean(onlineMatch)} aria-label={running ? 'Pausar narração' : 'Continuar narração'}>{running ? <Pause size={16} /> : <Play size={16} />}</button></header>
          <MatchFeed events={revealed} finished={finished} />
          {onlineMatch?.error && <div className="match-online-error" role="alert"><span>{onlineMatch.error}</span><button onClick={() => { onlineStartRequested.current = false; onlineMatch.reset(); }}>Tentar novamente</button></div>}
          <footer className="commentary-status"><span><i className={!finished ? 'pulse' : ''} /> {finished ? 'Partida encerrada' : onlineMatch ? 'Eventos autoritativos recebidos do servidor' : running ? 'Demonstração determinística em andamento' : 'Narração pausada'}</span><small>cadência: 800 ms</small></footer>
        </section>

        <aside className="match-analysis">
          <section className="live-stats">
            <header><div><p className="eyebrow">DADOS AO VIVO</p><h2>Estatísticas</h2></div><BarChart3 size={17} /></header>
            <div className="stats-clubs"><span><i className="aur" /> AUR</span><span>SAN <i className="san" /></span></div>
            {statRows.map(([label, home, away, width]) => <div className="stat-row" key={String(label)}><div><strong>{home}</strong><span>{label}</span><strong>{away}</strong></div><div className="split-bar"><span style={{ width: `${width}%` }} /><i style={{ width: `${100 - Number(width)}%` }} /></div></div>)}
          </section>

          <section className="momentum-panel">
            <header><p className="eyebrow">MOMENTO DA PARTIDA</p><Badge tone="positive">Aurora melhor</Badge></header>
            <div className="momentum-bars" aria-label="Gráfico de momento da partida">
              {[18, 32, 45, 62, 38, 74, 68, -22, -42, 55, 78, 86, 64, 92].map((value, index) => <span key={index} className={value < 0 ? 'away' : ''} style={{ height: `${Math.abs(value)}%` }} />)}
            </div>
            <div className="momentum-labels"><span>00′</span><span>45′</span><span>90′</span></div>
          </section>

          <section className="touchline-note"><Sparkles size={16} /><div><strong>Sugestão do auxiliar</strong><p>Leandro encontra espaço por dentro. Mantenha a amplitude do lado direito.</p></div><button aria-label="Aplicar sugestão" onClick={() => { setMentality('Ofensiva'); onToast('Instrução aplicada ao lado direito.'); }}><ChevronRight size={15} /></button></section>
        </aside>
      </div>

      <section className="match-controls">
        <div><span className="control-status"><Activity size={15} /> Intensidade <strong>Alta</strong></span><span className="control-status"><CircleGauge size={15} /> Ritmo <strong>Rápido</strong></span><span className="control-status"><Shield size={15} /> Substituições <strong>{substitutionCount}/5</strong></span></div>
        <div><Button icon={<ArrowRightLeft size={15} />} onClick={() => setSubOpen(true)} disabled={finished || substitutionCount >= 5 || Boolean(onlineMatch)}>Substituição</Button><Button icon={<SlidersHorizontal size={15} />} onClick={() => setTacticOpen(true)} disabled={finished}>Ajuste tático</Button><Button variant="danger" icon={<FastForward size={15} />} onClick={() => void skipToResult()} disabled={finished || onlineMatch?.phase === 'starting'}>Pular resultado</Button></div>
      </section>

      {finished && <section className="final-whistle"><span className="final-whistle__icon"><Goal size={22} /></span><div><p className="eyebrow">APITO FINAL</p><h2>{onlineMatch?.result ? `${onlineMatch.result.homeTeam} ${score[0]}–${score[1]} ${onlineMatch.result.awayTeam}.` : 'Vitória de clássico. Aurora 2–1 Santos.'}</h2><p>A imprensa já prepara a coletiva pós-jogo.</p></div><div className="final-whistle__actions"><Button icon={<Flag size={15} />} onClick={() => onToast('Coletiva pós-jogo preparada com 4 perguntas.')}>Ir para a coletiva</Button>{onlineMatch?.result?.nextFixtureId && <Button variant="primary" icon={<Play size={15} />} onClick={() => { onlineStartRequested.current = false; onlineMatch.reset(); }}>Próxima partida</Button>}</div></section>}

      <Modal open={subOpen} onClose={() => setSubOpen(false)} title="Fazer substituição" eyebrow={`AURORA FC · ${currentMinute} MIN · ${substitutionCount}/5`} footer={<><Button variant="ghost" onClick={() => setSubOpen(false)}>Cancelar</Button><Button variant="primary" onClick={confirmSubstitution} disabled={substitutionCount >= 5}>Confirmar troca</Button></>}>
        <div className="substitution-form"><label><span>SAI</span><select value={outPlayer} onChange={(event) => setOutPlayer(event.target.value)}>{players.slice(0, 11).map((player) => <option key={player.id} value={player.id}>{player.number} · {player.name} ({player.condition}%)</option>)}</select></label><span className="sub-arrow"><ArrowRightLeft size={18} /></span><label><span>ENTRA</span><select value={inPlayer} onChange={(event) => setInPlayer(event.target.value)}>{players.slice(11, 18).map((player) => <option key={player.id} value={player.id}>{player.number} · {player.name} ({player.condition}%)</option>)}</select></label></div>
      </Modal>

      <Modal open={tacticOpen} onClose={() => setTacticOpen(false)} title="Ajuste tático" eyebrow="INSTRUÇÕES À BEIRA DO CAMPO" footer={<><Button variant="ghost" onClick={() => setTacticOpen(false)}>Cancelar</Button><Button variant="primary" onClick={() => { setTacticOpen(false); onToast(`Mentalidade alterada para ${mentality.toLowerCase()}.`); }}>Enviar instrução</Button></>}>
        <div className="match-tactic-form"><label><span>MENTALIDADE</span><div>{['Cautelosa', 'Equilibrada', 'Positiva', 'Ofensiva'].map((item) => <button key={item} aria-pressed={mentality === item} onClick={() => setMentality(item)}>{item}</button>)}</div></label><label><span>INSTRUÇÃO RÁPIDA</span><select defaultValue="Explorar lado direito"><option>Explorar lado direito</option><option>Manter a posse</option><option>Adiantar linhas</option><option>Baixar o ritmo</option></select></label><div className="tactic-impact"><SquareDashedBottom size={19} /><span><strong>Impacto estimado</strong><small>+8% presença no terço final · +4% desgaste</small></span></div></div>
      </Modal>
    </main>
  );
}
