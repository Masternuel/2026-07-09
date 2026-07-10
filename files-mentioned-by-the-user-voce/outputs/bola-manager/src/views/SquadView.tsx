import { useMemo, useState } from 'react';
import { Activity, ArrowUpDown, ChevronDown, Filter, Search, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { PlayerModal } from '../components/squad/PlayerModal';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { ProgressBar } from '../components/shared/ProgressBar';
import { StarRating } from '../components/shared/StarRating';
import { players } from '../data/demoData';
import type { Player, PlayerPosition } from '../types';
import { average, cx, formatCurrency } from '../utils/formatters';

interface SquadViewProps {
  onToast: (message: string) => void;
}

type SortKey = 'name' | 'position' | 'age' | 'value' | 'condition' | 'rating';

const filterGroups: Array<{ label: string; values: PlayerPosition[] }> = [
  { label: 'Goleiros', values: ['GOL'] },
  { label: 'Defesa', values: ['ZAG', 'LD', 'LE'] },
  { label: 'Meio', values: ['VOL', 'MC', 'MEI'] },
  { label: 'Ataque', values: ['PD', 'PE', 'ATA'] },
];

function overall(player: Player): number {
  return average(Object.values(player.attributes));
}

export function SquadView({ onToast }: SquadViewProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('Todos');
  const [sortKey, setSortKey] = useState<SortKey>('rating');
  const [ascending, setAscending] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  const filteredPlayers = useMemo(() => {
    const selectedPositions = filterGroups.find((item) => item.label === group)?.values;
    return players
      .filter((player) => player.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))
      .filter((player) => !selectedPositions || selectedPositions.includes(player.position))
      .sort((a, b) => {
        let result = 0;
        if (sortKey === 'name') result = a.name.localeCompare(b.name, 'pt-BR');
        if (sortKey === 'position') result = a.position.localeCompare(b.position);
        if (sortKey === 'age') result = a.age - b.age;
        if (sortKey === 'value') result = a.value - b.value;
        if (sortKey === 'condition') result = a.condition - b.condition;
        if (sortKey === 'rating') result = overall(a) - overall(b);
        return ascending ? result : -result;
      });
  }, [ascending, group, query, sortKey]);

  function sort(key: SortKey) {
    if (sortKey === key) setAscending((value) => !value);
    else { setSortKey(key); setAscending(false); }
  }

  return (
    <main className="squad-view view-enter">
      <div className="view-heading">
        <div><p className="eyebrow">ELENCO PRINCIPAL · 20 ATLETAS</p><h1>Elenco</h1><p>Condição, atributos e disponibilidade antes da 14ª rodada.</p></div>
        <div className="view-heading__actions"><Button variant="secondary" icon={<Filter size={15} />}>Relatório do auxiliar</Button><Button variant="primary" icon={<Users size={15} />} onClick={() => onToast('Jogadores da base carregados no relatório.')}>Ver Sub-20</Button></div>
      </div>

      <section className="squad-overview">
        <div><span className="metric-icon"><ShieldCheck size={17} /></span><span><small>DISPONÍVEIS</small><strong>18 <em>/ 20</em></strong></span><Badge tone="positive">90%</Badge></div>
        <div><span className="metric-icon"><Activity size={17} /></span><span><small>CONDIÇÃO MÉDIA</small><strong>91,4%</strong></span><span className="metric-delta">+2,1%</span></div>
        <div><span className="metric-icon"><Sparkles size={17} /></span><span><small>VALOR DO ELENCO</small><strong>{formatCurrency(players.reduce((sum, player) => sum + player.value, 0))}</strong></span><span className="metric-delta">5º da liga</span></div>
        <div className="squad-depth"><span><small>PROFUNDIDADE</small><strong>2,0 por posição</strong></span><ProgressBar value={76} /></div>
      </section>

      <section className="squad-table-panel">
        <header className="squad-toolbar">
          <div className="position-tabs" role="tablist">
            {['Todos', ...filterGroups.map((item) => item.label)].map((label) => <button key={label} aria-selected={group === label} onClick={() => setGroup(label)}>{label}</button>)}
          </div>
          <label className="table-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar jogador" /><kbd>⌘ K</kbd></label>
        </header>
        <div className="table-scroll">
          <table className="squad-table">
            <thead>
              <tr>
                <th><button onClick={() => sort('name')}>Jogador <ArrowUpDown size={12} /></button></th>
                <th><button onClick={() => sort('position')}>Pos.</button></th>
                <th><button onClick={() => sort('age')}>Idade</button></th>
                <th>Vel.</th><th>Chute</th><th>Drible</th><th>Noção</th><th>Defesa</th><th>Passe</th>
                <th><button onClick={() => sort('condition')}>Condição</button></th>
                <th>Moral</th>
                <th><button onClick={() => sort('value')}>Valor</button></th>
                <th><span className="sr-only">Abrir</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.map((player) => {
                const statusTone = player.status === 'Disponível' ? 'positive' : player.status === 'Lesionado' ? 'danger' : 'warning';
                return (
                  <tr key={player.id} onClick={() => setSelectedPlayer(player)}>
                    <td><span className="player-number">{player.number}</span><span className="player-cell"><strong>{player.name}</strong><small>{player.role}</small></span>{player.status !== 'Disponível' && <Badge tone={statusTone}>{player.status}</Badge>}</td>
                    <td><span className={`position-tag position-tag--${player.position.toLowerCase()}`}>{player.position}</span></td>
                    <td>{player.age}</td>
                    {(['velocidade', 'chute', 'drible', 'nocao', 'defesa', 'passe'] as const).map((attribute) => <td key={attribute}><StarRating value={player.attributes[attribute]} compact /></td>)}
                    <td><span className={cx('condition-cell', player.condition < 75 && 'warning')}><i style={{ '--condition': `${player.condition}%` } as React.CSSProperties} />{player.condition}%</span></td>
                    <td><span className={`morale morale--${player.morale.toLowerCase()}`}>{player.morale}</span></td>
                    <td><strong className="money-cell">{formatCurrency(player.value)}</strong></td>
                    <td><button className="row-action" onClick={(event) => { event.stopPropagation(); setSelectedPlayer(player); }} aria-label={`Abrir perfil de ${player.name}`}><ChevronDown size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="table-footer"><span>Exibindo {filteredPlayers.length} de {players.length} atletas</span><span>Ordenado por <strong>{sortKey}</strong></span></footer>
      </section>

      <PlayerModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} onAction={(message) => { onToast(message); setSelectedPlayer(null); }} />
    </main>
  );
}
