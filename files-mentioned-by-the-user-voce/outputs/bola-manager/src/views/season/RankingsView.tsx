import { Crown, Medal, Sparkles, TrendingUp } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { ClubMark } from '../../components/shared/ClubMark';
import { StarPlayerMark } from '../../components/shared/StarPlayerMark';
import type { ClubChoice, Player } from '../../types';
import { average, formatCurrency } from '../../utils/formatters';

interface RankingsViewProps {
  players: Player[];
  club: ClubChoice;
}

export function RankingsView({ players, club }: RankingsViewProps) {
  const playerRanks = [...players]
    .sort((left, right) => average(Object.values(right.attributes)) - average(Object.values(left.attributes)))
    .slice(0, 5);
  return <main className="secondary-view view-enter"><div className="view-heading"><div><p className="eyebrow">SALA · TEMPORADA 2026</p><h1>Rankings</h1><p>Quem está definindo a temporada dentro e fora de campo.</p></div><Badge tone="info"><TrendingUp size={12} /> Atualizado na rodada 13</Badge></div><div className="rankings-grid">
    <section className="ranking-feature"><header><p className="eyebrow">BOLA DE OURO · CORRIDA</p><h2>Melhores jogadores</h2></header>{playerRanks.map((player, index) => <div className={index === 0 ? 'leader' : ''} key={player.id}><span className="rank-number">{index + 1}</span><span className="avatar">{player.number}</span><span><span className="ranking-player-name"><strong>{player.name}</strong>{player.isStar && <StarPlayerMark />}</span><small>{club.name}</small></span><span><strong>{average(Object.values(player.attributes)).toFixed(2)}</strong><small>NOTA</small></span>{index === 0 && <Crown size={18} />}</div>)}</section>
    <section className="ranking-list"><header><p className="eyebrow">VALOR DE MERCADO</p><h2>Clubes</h2></header>{[['PAL', 'Palmeiras', 1_120_000_000, '#159761'], ['FLA', 'Flamengo', 1_040_000_000, '#d84545'], ['AUR', 'Aurora FC', 612_500_000, '#c8ff3d'], ['BOT', 'Botafogo', 588_000_000, '#eee'], ['BAH', 'Bahia', 514_000_000, '#3979d8']].map(([code, name, value, color], index) => <div key={String(code)}><span>{index + 1}</span><ClubMark code={String(code)} color={String(color)} size="sm" /><strong>{name}</strong><span>{formatCurrency(Number(value))}</span></div>)}</section>
    <section className="manager-ranking"><header><p className="eyebrow">HALL DA SALA</p><h2>Managers</h2></header><div className="manager-podium"><div><span className="avatar avatar--blue">JR</span><strong>João</strong><small>1.840 XP</small></div><div className="first"><Medal size={19} /><span className="avatar">EM</span><strong>Emanuel</strong><small>2.140 XP</small></div><div><span className="avatar avatar--red">CA</span><strong>Carol</strong><small>1.720 XP</small></div></div><dl><div><dt>Tática</dt><dd>8,4</dd></div><div><dt>Vestiário</dt><dd>7,8</dd></div><div><dt>Jovens</dt><dd>8,1</dd></div></dl><Badge tone="positive"><Sparkles size={12} /> Reputação nacional</Badge></section>
  </div></main>;
}
