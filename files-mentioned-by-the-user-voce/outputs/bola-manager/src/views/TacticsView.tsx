import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ClipboardCheck, EyeOff, GripVertical, RotateCcw, Save, Shield, Sparkles, Target, Users } from 'lucide-react';
import { InstructionsPanel, type InstructionKey, type InstructionValues } from '../components/tactics/InstructionsPanel';
import { TacticsField } from '../components/tactics/TacticsField';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { StarPlayerMark } from '../components/shared/StarPlayerMark';
import { formations } from '../constants/formations';
import type { ClubChoice, LineupSaveResponse, Player } from '../types';
import { average } from '../utils/formatters';
import { buildSavedLineup, createBench } from '../utils/playerRoster';

interface TacticsViewProps {
  players: Player[];
  club: ClubChoice;
  opponentName?: string;
  savedLineupIds?: string[];
  onSaveLineup?: (lineupIds: string[]) => Promise<LineupSaveResponse>;
  onToast: (message: string) => void;
}

const initialInstructions: InstructionValues = {
  pressureLine: 'Alta', width: 'Ampla', tempo: 'Rápido', pressing: 'Intensa', offensiveTransition: 'Construir', defensiveTransition: 'Pressão imediata',
};

export function TacticsView({ players, club, opponentName = 'Santos', savedLineupIds, onSaveLineup, onToast }: TacticsViewProps) {
  const savedLineupKey = savedLineupIds?.join('\u0000') ?? '';
  const initialSquad = useMemo(() => {
    const lineup = buildSavedLineup(players, formations[0], savedLineupIds);
    return { lineup, bench: createBench(players, lineup) };
  }, [players, savedLineupKey]);
  const [formationId, setFormationId] = useState('4-3-3');
  const [lineup, setLineup] = useState<Array<Player | undefined>>(() => initialSquad.lineup);
  const [bench, setBench] = useState<Player[]>(() => initialSquad.bench);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [mentality, setMentality] = useState('Positiva');
  const [dirty, setDirty] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [secret, setSecret] = useState(true);
  const [panelTab, setPanelTab] = useState<'team' | 'individual' | 'setpieces'>('team');

  const formation = formations.find((item) => item.id === formationId) ?? formations[0];
  const teamRating = useMemo(() => average(lineup.flatMap((player) => (
    player ? [average(Object.values(player.attributes))] : []
  ))), [lineup]);
  const selectedPlayer = selectedSlot === null ? undefined : lineup[selectedSlot];

  useEffect(() => {
    setLineup(initialSquad.lineup);
    setBench(initialSquad.bench);
    setSelectedSlot(null);
  }, [initialSquad]);

  function swap(from: number, to: number) {
    setLineup((current) => {
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    setDirty(true);
  }

  function selectFromBench(player: Player) {
    if (selectedSlot === null) {
      onToast('Selecione uma posição no campo para fazer a troca.');
      return;
    }
    const outgoing = lineup[selectedSlot];
    setLineup((current) => current.map((item, index) => index === selectedSlot ? player : item));
    setBench((current) => outgoing
      ? current.map((item) => item.id === player.id ? outgoing : item)
      : current.filter((item) => item.id !== player.id));
    setSelectedSlot(null);
    setDirty(true);
  }

  function changeInstruction(key: InstructionKey, value: string) {
    setInstructions((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function save() {
    const lineupIds = lineup.flatMap((player) => player ? [player.id] : []).slice(0, 11);
    if (lineupIds.length === 0) {
      onToast('Defina pelo menos um jogador no campo antes de salvar.');
      return;
    }
    if (!onSaveLineup) {
      setDirty(false);
      onToast(`Plano “${club.name} vertical” salvo localmente.`);
      return;
    }
    setSavePending(true);
    try {
      await onSaveLineup(lineupIds);
      setDirty(false);
      onToast(`Plano “${club.name} vertical” salvo para a sala.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível salvar a escalação.');
    } finally {
      setSavePending(false);
    }
  }

  function restore() {
    setFormationId('4-3-3');
    setLineup(initialSquad.lineup);
    setBench(initialSquad.bench);
    setSelectedSlot(null);
    setInstructions(initialInstructions);
    setMentality('Positiva');
    setDirty(false);
  }

  return (
    <main className="tactics-view view-enter">
      <div className="view-heading tactics-heading">
        <div><p className="eyebrow">PLANO DE JOGO · VERSÃO 08</p><h1>Táticas</h1><p>Estrutura dinâmica, funções e comportamento sem a bola.</p></div>
        <div className="view-heading__actions"><Button variant="secondary" icon={<RotateCcw size={15} />} onClick={restore}>Restaurar</Button><Button variant="primary" loading={savePending} icon={dirty ? <Save size={15} /> : <Check size={15} />} onClick={() => void save()}>{dirty ? 'Salvar alterações' : 'Plano salvo'}</Button></div>
      </div>

      <div className="tactics-workspace">
        <section className="formation-board">
          <header className="formation-toolbar">
            <div className="formation-select"><span>FORMAÇÃO</span><select value={formationId} onChange={(event) => { setFormationId(event.target.value); setDirty(true); }}>{formations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.description}</option>)}</select><ChevronDown size={14} /></div>
            <div className="mentality-switch"><span>MENTALIDADE</span>{['Cautelosa', 'Equilibrada', 'Positiva', 'Ofensiva'].map((item) => <button key={item} aria-pressed={mentality === item} onClick={() => { setMentality(item); setDirty(true); }}>{item}</button>)}</div>
            <Badge tone="positive" dot>Entrosamento 88%</Badge>
          </header>

          <div className="field-stage">
            <div className="field-stage__label"><span><Target size={14} /> Ataque</span><span>ARRASTE PARA TROCAR POSIÇÕES</span></div>
            <TacticsField formation={formation} lineup={lineup} onSwap={swap} selectedIndex={selectedSlot} onSelect={(index) => setSelectedSlot(index === selectedSlot ? null : index)} />
            <div className="field-stage__label field-stage__label--bottom"><span><Shield size={14} /> Defesa</span><span>{club.name.toUpperCase()} · MANDO DE CAMPO</span></div>
          </div>

          <div className="bench">
            <header><span><Users size={14} /> BANCO DE RESERVAS</span><small>Selecione uma posição e toque no reserva</small></header>
            <div className="bench-list">
              {bench.map((player) => (
                <button key={player.id} onClick={() => selectFromBench(player)}><GripVertical size={13} /><span className="bench-number">{player.number}</span><span><span className="bench-player__name"><strong>{player.shortName}</strong>{player.isStar && <StarPlayerMark />}</span><small>{player.position} · {player.condition}%</small></span><strong>{average(Object.values(player.attributes)).toFixed(1)}</strong></button>
              ))}
            </div>
          </div>
        </section>

        <aside className="tactic-controls">
          <div className="tactic-score">
            <div><span>IDENTIDADE DO PLANO</span><strong>{teamRating.toFixed(1)}</strong><small>/10</small></div>
            <dl><div><dt>Com a bola</dt><dd>8,4</dd></div><div><dt>Sem a bola</dt><dd>8,8</dd></div><div><dt>Transição</dt><dd>8,6</dd></div></dl>
          </div>
          <div className="control-tabs">
            <button aria-selected={panelTab === 'team'} onClick={() => setPanelTab('team')}>Equipe</button>
            <button aria-selected={panelTab === 'individual'} onClick={() => setPanelTab('individual')}>Individuais</button>
            <button aria-selected={panelTab === 'setpieces'} onClick={() => setPanelTab('setpieces')}>Bola parada</button>
          </div>
          {panelTab === 'team' && <InstructionsPanel values={instructions} onChange={changeInstruction} />}
          {panelTab === 'individual' && (
            <div className="individual-panel">
              <p>Selecione um atleta no campo para definir a função individual.</p>
              {selectedSlot !== null && selectedPlayer ? <div className="selected-player-instruction"><span className="avatar">{selectedPlayer.number}</span><span><strong>{selectedPlayer.name}</strong><small>{formation.slots[selectedSlot].role}</small></span></div> : <div className="empty-instruction"><Users size={22} /><strong>Nenhum atleta selecionado</strong><span>Toque em uma posição do campo.</span></div>}
              <label><span>Com a bola</span><select defaultValue="Apoiar por dentro"><option>Apoiar por dentro</option><option>Dar amplitude</option><option>Atacar o espaço</option></select></label>
              <label><span>Sem a bola</span><select defaultValue="Pressionar mais"><option>Pressionar mais</option><option>Guardar posição</option><option>Marcação individual</option></select></label>
            </div>
          )}
          {panelTab === 'setpieces' && (
            <div className="setpiece-panel"><ClipboardCheck size={25} /><h3>Bolas paradas</h3><p>Defina cobradores e movimentos ensaiados para o clássico.</p>{['Escanteio ofensivo', 'Falta frontal', 'Tiro de meta'].map((item, index) => <button key={item}><span><strong>{item}</strong><small>{index === 0 ? 'Curto · 3 variações' : index === 1 ? 'Igor Sampaio' : 'Saída curta'}</small></span><ChevronDown size={14} /></button>)}</div>
          )}
          <label className="secret-tactic"><span><EyeOff size={15} /><span><strong>Tática secreta</strong><small>Ocultar plano dos outros managers</small></span></span><input type="checkbox" checked={secret} onChange={(event) => setSecret(event.target.checked)} /><i /></label>
          <div className="assistant-note"><Sparkles size={16} /><div><strong>Leitura do auxiliar</strong><p>O {opponentName} cede espaço entre lateral e zagueiro. A amplitude do 4–3–3 favorece seus pontas.</p></div></div>
        </aside>
      </div>
    </main>
  );
}
