import { useState } from 'react';
import { Building2, CalendarClock, Check, ChevronRight, CircleDollarSign, Construction, Dumbbell, GraduationCap, HeartPulse, Plane, ScanLine, ShoppingBag, Speaker, Sparkles, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { Modal } from '../../components/shared/Modal';
import { ProgressBar } from '../../components/shared/ProgressBar';
import { formatCurrency } from '../../utils/formatters';

interface StadiumViewProps { onToast: (message: string) => void; }
interface Upgrade { id: string; name: string; category: 'estádio' | 'estrutura'; icon: LucideIcon; level: number; cost: number; weeks: number; impact: string; }

const upgrades: Upgrade[] = [
  { id: 'stands', name: 'Arquibancadas', category: 'estádio', icon: Building2, level: 2, cost: 28_000_000, weeks: 12, impact: '+8.000 lugares' },
  { id: 'pitch', name: 'Gramado premium', category: 'estádio', icon: ScanLine, level: 2, cost: 7_500_000, weeks: 4, impact: '-18% lesões' },
  { id: 'store', name: 'Loja oficial', category: 'estádio', icon: ShoppingBag, level: 1, cost: 5_200_000, weeks: 6, impact: '+R$ 620 mil/mês' },
  { id: 'sound', name: 'Sistema de som', category: 'estádio', icon: Speaker, level: 1, cost: 3_800_000, weeks: 3, impact: '+4% moral torcida' },
  { id: 'training', name: 'Centro de treinamento', category: 'estrutura', icon: Dumbbell, level: 2, cost: 18_000_000, weeks: 10, impact: '+8% evolução' },
  { id: 'academy', name: 'Centro de formação', category: 'estrutura', icon: GraduationCap, level: 2, cost: 16_500_000, weeks: 9, impact: '+1 potencial base' },
  { id: 'medical', name: 'Departamento médico', category: 'estrutura', icon: HeartPulse, level: 1, cost: 11_000_000, weeks: 7, impact: '-22% recuperação' },
  { id: 'plane', name: 'Avião do clube', category: 'estrutura', icon: Plane, level: 0, cost: 32_000_000, weeks: 16, impact: '-12% fadiga viagem' },
];

export function StadiumView({ onToast }: StadiumViewProps) {
  const [levels, setLevels] = useState<Record<string, number>>(Object.fromEntries(upgrades.map((item) => [item.id, item.level])));
  const [selected, setSelected] = useState<Upgrade | null>(null);
  function upgrade() { if (!selected) return; setLevels((current) => ({ ...current, [selected.id]: Math.min(3, current[selected.id] + 1) })); onToast(`${selected.name}: melhoria aprovada pela diretoria.`); setSelected(null); }
  return <main className="secondary-view view-enter"><div className="view-heading"><div><p className="eyebrow">PATRIMÔNIO DO CLUBE</p><h1>Infraestrutura</h1><p>Estádio Boreal, centro de treinamento e a base do futuro.</p></div><div className="infra-budget"><small>ORÇAMENTO DISPONÍVEL</small><strong>{formatCurrency(18_000_000)}</strong></div></div>
    <section className="stadium-hero"><div className="stadium-visual"><div className="stadium-pitch"><span /><i /></div><div className="stand stand--north" /><div className="stand stand--south" /><div className="stadium-label"><span>ESTÁDIO BOREAL</span><strong>36.250</strong><small>capacidade</small></div></div><div className="stadium-info"><Badge tone="positive" dot>Operação normal</Badge><h2>Estádio Boreal</h2><p>Casa do Aurora desde 1998 · Ocupação média de 87% na temporada.</p><dl><div><dt>Bilheteria / jogo</dt><dd>{formatCurrency(2_800_000)}</dd></div><div><dt>Qualidade do gramado</dt><dd>92%</dd></div><div><dt>Satisfação da torcida</dt><dd>84%</dd></div></dl><ProgressBar value={87} label="Ocupação média" /><small>OCUPAÇÃO MÉDIA · 87%</small></div></section>
    {(['estádio', 'estrutura'] as const).map((category) => <section className="upgrade-section" key={category}><header><div><p className="eyebrow">{category === 'estádio' ? 'DIA DE JOGO' : 'DESENVOLVIMENTO'}</p><h2>{category === 'estádio' ? 'Estádio' : 'Estrutura do clube'}</h2></div><Badge tone="neutral">Níveis 0—3</Badge></header><div className="upgrade-grid">{upgrades.filter((item) => item.category === category).map((item) => { const level = levels[item.id]; return <article key={item.id}><span className="upgrade-icon"><item.icon size={20} /></span><div><span className="upgrade-level">{[1, 2, 3].map((dot) => <i key={dot} className={dot <= level ? 'active' : ''} />)} NÍVEL {level}</span><h3>{item.name}</h3><p>{item.impact}</p></div>{level >= 3 ? <Badge tone="positive"><Check size={12} /> Máximo</Badge> : <button onClick={() => setSelected(item)}><span><small>PRÓXIMO NÍVEL</small><strong>{formatCurrency(item.cost)}</strong></span><ChevronRight size={15} /></button>}</article>; })}</div></section>)}
    <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={`Melhorar ${selected?.name ?? ''}`} eyebrow="APROVAÇÃO DE INVESTIMENTO" footer={<><Button variant="ghost" onClick={() => setSelected(null)}>Cancelar</Button><Button variant="primary" onClick={upgrade} disabled={Boolean(selected && selected.cost > 18_000_000)}>Aprovar obra</Button></>}>{selected && <div className="upgrade-modal"><span className="construction-icon"><Construction size={27} /></span><p>A melhoria elevará <strong>{selected.name}</strong> ao nível {levels[selected.id] + 1}.</p><dl><div><dt><CircleDollarSign size={14} /> Custo</dt><dd>{formatCurrency(selected.cost)}</dd></div><div><dt><CalendarClock size={14} /> Prazo</dt><dd>{selected.weeks} semanas</dd></div><div><dt><Sparkles size={14} /> Impacto</dt><dd>{selected.impact}</dd></div></dl>{selected.cost > 18_000_000 && <div className="budget-warning">O orçamento atual é insuficiente. Redistribua verbas em Finanças.</div>}</div>}</Modal>
  </main>;
}
