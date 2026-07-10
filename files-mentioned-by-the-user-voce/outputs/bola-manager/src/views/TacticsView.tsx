import { useMemo, useState } from 'react';
import { Check, ChevronDown, ClipboardCheck, EyeOff, GripVertical, RotateCcw, Save, Shield, Sparkles, Target, Users } from 'lucide-react';
import { InstructionsPanel, type InstructionKey, type InstructionValues } from '../components/tactics/InstructionsPanel';
import { TacticsField } from '../components/tactics/TacticsField';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { formations } from '../constants/formations';
import { players } from '../data/demoData';
import type { Player } from '../types';
import { average } from '../utils/formatters';

interface TacticsViewProps {
  onToast: (message: string) => void;
}

const initialLineup = [players[0], players[3], players[1], players[2], players[4], players[5], players[6], players[7], players[8], players[9], players[10]];
const initialInstructions: InstructionValues = {
  pressureLine: 'Alta', width: 'Ampla', tempo: 'Rápido', pressing: 'Intensa', offensiveTransition: 'Construir', defensiveTransition: 'Pressão imediata',
};

export function TacticsView({ onToast }: TacticsViewProps) {
  const [formationId, setFormationId] = useState('4-3-3');
  const [lineup, setLineup] = useState<Player[]>(initialLineup);
  const [bench, setBench] = useState<Player[]>(players.slice(11, 18));
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [mentality, setMentality] = useState('Positiva');
  const [dirty, setDirty] = useState(false);
  const [secret, setSecret] = useState(true);
  const [panelTab, setPanelTab] = useState<'team' | 'individual' | 'setpieces'>('team');

  const formation = formations.find((item) => item.id === formationId) ?? formations[0];
  const teamRating = useMemo(() => average(lineup.map((player) => average(Object.values(player.attributes)))), [lineup]);

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
    setBench((current) => current.map((item) => item.id === player.id ? outgoing : item));
    setSelectedSlot(null);
    setDirty(true);
  }

  function changeInstruction(key: InstructionKey, value: string) {
    setInstructions((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function save() {
    setDirty(false);
    onToast('Plano “Aurora vertical” salvo para a sala.');
  }

  function restore() {
    setFormationId('4-3-3');
    setLineup(initialLineup);
    setBench(players.slice(11, 18));
    setSelectedSlot(null);
    setInstructions(initialInstructions);
    setMentality('Positiva');
    setDirty(false);
  }

  return (
    <main className="tactics-view view-enter">
      <div className="view-heading tactics-heading">
        <div><p className="eyebrow">PLANO DE JOGO · VERSÃO 08</p><h1>Táticas</h1><p>Estrutura dinâmica, funções e comportamento sem a bola.</p></div>
        <div className="view-heading__actions"><Button variant="secondary" icon={<RotateCcw size={15} />} onClick={restore}>Restaurar</Button><Button variant="primary" icon={dirty ? <Save size={15} /> : <Check size={15} />} onClick={save}>{dirty ? 'Salvar alterações' : 'Plano salvo'}</Button></div>
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
            <div className="field-stage__label field-stage__label--bottom"><span><Shield size={14} /> Defesa</span><span>AURORA FC · MANDO DE CAMPO</span></div>
          </div>

          <div className="bench">
            <header><span><Users size={14} /> BANCO DE RESERVAS</span><small>Selecione uma posição e toque no reserva</small></header>
            <div className="bench-list">
              {bench.map((player) => (
                <button key={player.id} onClick={() => selectFromBench(player)}><GripVertical size={13} /><span className="bench-number">{player.number}</span><span><strong>{player.shortName}</strong><small>{player.position} · {player.condition}%</small></span><strong>{average(Object.values(player.attributes)).toFixed(1)}</strong></button>
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
              {selectedSlot !== null ? <div className="selected-player-instruction"><span className="avatar">{lineup[selectedSlot].number}</span><span><strong>{lineup[selectedSlot].name}</strong><small>{formation.slots[selectedSlot].role}</small></span></div> : <div className="empty-instruction"><Users size={22} /><strong>Nenhum atleta selecionado</strong><span>Toque em uma posição do campo.</span></div>}
              <label><span>Com a bola</span><select defaultValue="Apoiar por dentro"><option>Apoiar por dentro</option><option>Dar amplitude</option><option>Atacar o espaço</option></select></label>
              <label><span>Sem a bola</span><select defaultValue="Pressionar mais"><option>Pressionar mais</option><option>Guardar posição</option><option>Marcação individual</option></select></label>
            </div>
          )}
          {panelTab === 'setpieces' && (
            <div className="setpiece-panel"><ClipboardCheck size={25} /><h3>Bolas paradas</h3><p>Defina cobradores e movimentos ensaiados para o clássico.</p>{['Escanteio ofensivo', 'Falta frontal', 'Tiro de meta'].map((item, index) => <button key={item}><span><strong>{item}</strong><small>{index === 0 ? 'Curto · 3 variações' : index === 1 ? 'Igor Sampaio' : 'Saída curta'}</small></span><ChevronDown size={14} /></button>)}</div>
          )}
          <label className="secret-tactic"><span><EyeOff size={15} /><span><strong>Tática secreta</strong><small>Ocultar plano dos outros managers</small></span></span><input type="checkbox" checked={secret} onChange={(event) => setSecret(event.target.checked)} /><i /></label>
          <div className="assistant-note"><Sparkles size={16} /><div><strong>Leitura do auxiliar</strong><p>O Santos cede espaço entre lateral e zagueiro. A amplitude do 4–3–3 favorece seus pontas.</p></div></div>
        </aside>
      </div>
    </main>
  );
}
