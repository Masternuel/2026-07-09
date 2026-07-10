import { useState } from 'react';
import { BellRing, Clock3, Gavel, MessageSquareText, Search, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { Modal } from '../../components/shared/Modal';
import { StarRating } from '../../components/shared/StarRating';
import { formatCurrency } from '../../utils/formatters';

interface MarketViewProps { onToast: (message: string) => void; }

const targets = [
  { id: 'm1', name: 'Arthur Viana', pos: 'ZAG', age: 23, club: 'Athletico-PR', value: 32_000_000, ask: 38_000_000, rating: 8.1, deadline: '01:42:18', bids: 4, status: 'Leilão' },
  { id: 'm2', name: 'Gabriel Sena', pos: 'MC', age: 21, club: 'Bahia', value: 27_000_000, ask: 29_500_000, rating: 7.9, deadline: '05:18:44', bids: 2, status: 'Leilão' },
  { id: 'm3', name: 'Lorenzo Martín', pos: 'ATA', age: 25, club: 'Lanús', value: 41_000_000, ask: 48_000_000, rating: 8.6, deadline: 'A negociar', bids: 0, status: 'Direta' },
  { id: 'm4', name: 'Caíque Lopes', pos: 'LD', age: 19, club: 'Coritiba', value: 12_000_000, ask: 16_000_000, rating: 7.3, deadline: '08:03:21', bids: 1, status: 'Leilão' },
];

export function MarketView({ onToast }: MarketViewProps) {
  const [selected, setSelected] = useState<(typeof targets)[number] | null>(null);
  const [offer, setOffer] = useState('40000000');
  const [watch, setWatch] = useState<string[]>(['m3']);
  const [tab, setTab] = useState('oportunidades');

  function submitBid() {
    if (!selected) return;
    onToast(`Lance de ${formatCurrency(Number(offer))} enviado por ${selected.name}.`);
    setSelected(null);
  }

  return <main className="secondary-view view-enter"><div className="view-heading"><div><p className="eyebrow">JANELA ABERTA · RESTAM 16 DIAS</p><h1>Mercado</h1><p>Leilões entre managers, negociações diretas e oportunidades monitoradas.</p></div><div className="market-budget"><small>ORÇAMENTO PARA CONTRATAÇÕES</small><strong>{formatCurrency(72_400_000)}</strong><span>R$ 18,6 mi comprometidos</span></div></div>
    <div className="market-tabs"><button aria-selected={tab === 'oportunidades'} onClick={() => setTab('oportunidades')}>Oportunidades <span>14</span></button><button aria-selected={tab === 'negociacoes'} onClick={() => setTab('negociacoes')}>Negociações <span>3</span></button><button aria-selected={tab === 'observacao'} onClick={() => setTab('observacao')}>Observação <span>{watch.length}</span></button><label><Search size={15} /><input placeholder="Buscar jogador, clube ou posição" /></label></div>
    <div className="market-layout"><section className="auction-board"><header><div><p className="eyebrow">DESTAQUES DA REDE</p><h2>{tab === 'negociacoes' ? 'Conversas em andamento' : tab === 'observacao' ? 'Sua lista de observação' : 'Leilões e oportunidades'}</h2></div><Badge tone="positive" dot>Mercado ao vivo</Badge></header>{targets.filter((target) => tab !== 'observacao' || watch.includes(target.id)).map((target) => <article className="market-player" key={target.id}><div className="market-player__identity"><span className="market-shirt">{target.pos}<i>{target.age}</i></span><span><strong>{target.name}</strong><small>{target.club} · {target.age} anos</small></span></div><div><small>AVALIAÇÃO</small><StarRating value={target.rating} compact /></div><div><small>VALOR ESTIMADO</small><strong>{formatCurrency(target.value)}</strong></div><div className="auction-clock"><small>{target.status === 'Leilão' ? 'ENCERRA EM' : 'TIPO'}</small><strong><Clock3 size={13} /> {target.deadline}</strong></div><div className="market-actions"><button className={watch.includes(target.id) ? 'watched' : ''} onClick={() => setWatch((items) => items.includes(target.id) ? items.filter((id) => id !== target.id) : [...items, target.id])} aria-label="Alternar observação"><BellRing size={15} /></button><Button variant={target.status === 'Leilão' ? 'primary' : 'secondary'} size="sm" onClick={() => { setSelected(target); setOffer(String(target.ask + 1_000_000)); }} icon={target.status === 'Leilão' ? <Gavel size={14} /> : <MessageSquareText size={14} />}>{target.status === 'Leilão' ? `Dar lance · ${target.bids}` : 'Negociar'}</Button></div></article>)}</section>
      <aside className="market-sidebar"><section><p className="eyebrow">INTELIGÊNCIA DE MERCADO</p><h3>Seu elenco precisa de...</h3><div className="need-item urgent"><span>ZAG</span><div><strong>Construtor canhoto</strong><small>Prioridade alta · 8 opções</small></div></div><div className="need-item"><span>ATA</span><div><strong>Avançado de rotação</strong><small>Prioridade média · 12 opções</small></div></div><Button variant="ghost" icon={<Sparkles size={14} />}>Abrir relatório de scout</Button></section><section><p className="eyebrow">MOVIMENTO DA SALA</p>{[['Carol A.', 'ofertou R$ 37 mi por Arthur Viana', 'há 2 min'], ['João R.', 'listou Lucas Braga', 'há 8 min'], ['CPU · Bahia', 'recusou proposta por Gabriel', 'há 14 min']].map(([name, text, time]) => <div className="market-activity" key={time}><span className="avatar">{name.slice(0, 2).toUpperCase()}</span><p><strong>{name}</strong> {text}<small>{time}</small></p></div>)}</section><section className="fair-play"><ShieldCheck size={17} /><span><strong>Fair play financeiro</strong><small>Margem segura de R$ 42 mi</small></span><Badge tone="positive">Regular</Badge></section></aside>
    </div>
    <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.status === 'Leilão' ? 'Fazer lance' : 'Iniciar negociação'} eyebrow={selected ? `${selected.name} · ${selected.club}` : ''} footer={<><Button variant="ghost" onClick={() => setSelected(null)}>Cancelar</Button><Button variant="primary" onClick={submitBid}>{selected?.status === 'Leilão' ? 'Confirmar lance' : 'Enviar proposta'}</Button></>}>{selected && <div className="bid-form"><div className="bid-summary"><span><small>VALOR ESTIMADO</small><strong>{formatCurrency(selected.value)}</strong></span><span><small>LANCE MÍNIMO</small><strong>{formatCurrency(selected.ask)}</strong></span></div><label><span>SUA OFERTA</span><input type="number" min={selected.ask} step="500000" value={offer} onChange={(event) => setOffer(event.target.value)} /><small>Seu saldo após a oferta: {formatCurrency(72_400_000 - Number(offer))}</small></label><label className="medical-clause"><input type="checkbox" defaultChecked /><span><strong>Condicionar ao exame médico</strong><small>Obrigatório para concluir a contratação.</small></span></label><div className="bid-alert"><TrendingUp size={15} /> Este valor supera o maior lance atual em R$ 1 mi.</div></div>}</Modal>
  </main>;
}
