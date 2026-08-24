import { BarChart3, Goal, Scale, ShieldCheck, TrendingUp, Trophy } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import type { ClubChoice, Player, Room } from '../../types';
import { buildClubReport } from '../../utils/clubReport';
import { formatCurrency } from '../../utils/formatters';
import { hasKnownCatalogField } from '../../utils/playerDataAvailability';
import { playerPhysicalRating, playerPositionRating } from '../../utils/playerRating';

interface ReportsViewProps {
  room: Room | null;
  club: ClubChoice;
  players: Player[];
}

interface SquadLeader {
  player: Player;
  label: string;
  value: string;
  progress: number;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function decimal(value: number) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function safeName(player: Player) {
  return typeof player.name === 'string' && player.name.trim() ? player.name.trim() : 'Jogador sem nome';
}

function currentSquadLeaders(players: Player[]): SquadLeader[] {
  const roster = (Array.isArray(players) ? players : []).filter((player) => player && typeof player === 'object');
  if (!roster.length) return [];
  const highestValue = Math.max(1, ...roster.map((player) => Number(player.value) || 0));
  const categories = [
    {
      label: 'Nota posicional',
      eligible: (player: Player) => hasKnownCatalogField(player, 'attributes'),
      score: (player: Player) => playerPositionRating(player),
      value: (player: Player) => decimal(playerPositionRating(player)),
      progress: (player: Player) => playerPositionRating(player) * 10,
    },
    {
      label: 'Físico atual',
      eligible: (player: Player) => hasKnownCatalogField(player, 'attributes'),
      score: (player: Player) => playerPhysicalRating(player),
      value: (player: Player) => decimal(playerPhysicalRating(player)),
      progress: (player: Player) => playerPhysicalRating(player) * 10,
    },
    {
      label: 'Condição',
      eligible: (player: Player) => hasKnownCatalogField(player, 'condition'),
      score: (player: Player) => Number(player.condition) || 0,
      value: (player: Player) => `${Math.round(clampPercent(Number(player.condition)))}%`,
      progress: (player: Player) => Number(player.condition) || 0,
    },
    {
      label: 'Valor de mercado',
      eligible: (_player: Player) => true,
      score: (player: Player) => Number(player.value) || 0,
      value: (player: Player) => formatCurrency(Number(player.value) || 0),
      progress: (player: Player) => ((Number(player.value) || 0) / highestValue) * 100,
    },
  ];
  const used = new Set<string>();

  return categories.flatMap((category) => {
    const sorted = roster.filter(category.eligible).sort((left, right) => (
      category.score(right) - category.score(left)
      || safeName(left).localeCompare(safeName(right), 'pt-BR')
    ));
    const player = sorted.find((candidate) => !used.has(candidate.id)) ?? sorted[0];
    if (!player) return [];
    used.add(player.id);
    return [{
      player,
      label: category.label,
      value: category.value(player),
      progress: clampPercent(category.progress(player)),
    }];
  });
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function ReportsView({ room, club, players }: ReportsViewProps) {
  const report = buildClubReport(room, club);
  const leaders = currentSquadLeaders(players);
  const scaleMaximum = Math.max(1, ...report.matches.flatMap((match) => [match.goalsFor, match.goalsAgainst]));
  const chartTicks = [scaleMaximum, scaleMaximum * (2 / 3), scaleMaximum / 3, 0];
  const averageGoals = report.played ? report.goalsFor / report.played : 0;
  const averageAgainst = report.played ? report.goalsAgainst / report.played : 0;
  const hasMatches = report.played > 0;

  return <main className="secondary-view reports-view view-enter">
    <div className="view-heading">
      <div>
        <p className="eyebrow">CENTRO DE DESEMPENHO</p>
        <h1>Relatórios</h1>
        <p>{hasMatches
          ? `${report.played} ${report.played === 1 ? 'jogo analisado' : 'jogos analisados'} na temporada atual.`
          : 'A primeira análise será gerada após a estreia.'}</p>
      </div>
      <Badge tone={hasMatches ? 'positive' : 'info'}>
        <ShieldCheck size={12} /> {hasMatches ? 'Dados atualizados' : 'Aguardando estreia'}
      </Badge>
    </div>

    <section className="report-kpis">
      <div><span className="metric-icon"><BarChart3 size={17} /></span><span><small>JOGOS ANALISADOS</small><strong>{report.played}</strong><em>{report.wins}V · {report.draws}E · {report.losses}D</em></span></div>
      <div><span className="metric-icon"><Goal size={17} /></span><span><small>GOLS MARCADOS</small><strong>{report.goalsFor}</strong><em>{decimal(averageGoals)} por jogo</em></span></div>
      <div><span className="metric-icon"><ShieldCheck size={17} /></span><span><small>GOLS SOFRIDOS</small><strong>{report.goalsAgainst}</strong><em>{decimal(averageAgainst)} por jogo · {report.cleanSheets} sem sofrer</em></span></div>
      <div><span className="metric-icon"><Scale size={17} /></span><span><small>SALDO DE GOLS</small><strong>{signed(report.goalDifference)}</strong><em>{report.points} {report.points === 1 ? 'ponto' : 'pontos'} conquistados</em></span></div>
    </section>

    <div className="reports-layout">
      <section className="performance-chart">
        <header>
          <div><p className="eyebrow">CAMPANHA JOGO A JOGO</p><h2>Gols por rodada</h2></div>
          <div className="chart-legend"><span><i /> Marcados</span><span><i /> Sofridos</span></div>
        </header>
        {hasMatches ? <div className="line-chart">
          <div className="chart-y">{chartTicks.map((tick, index) => <span key={index}>{Number.isInteger(tick) ? tick : decimal(tick)}</span>)}</div>
          <div className="chart-bars">{report.matches.map((match) => <span key={match.fixtureId} title={`Rodada ${match.round}: ${match.goalsFor} a ${match.goalsAgainst}`}>
            <i style={{ height: `${(match.goalsFor / scaleMaximum) * 100}%` }} />
            <b style={{ height: `${(match.goalsAgainst / scaleMaximum) * 100}%` }} />
            <small>R{match.round}</small>
          </span>)}</div>
        </div> : <div className="line-chart report-chart-empty">
          <BarChart3 size={26} />
          <strong>Nenhum jogo concluído</strong>
          <span>O comparativo de gols aparecerá após a estreia do {club.name}.</span>
        </div>}
        <div className="insight-strip"><TrendingUp size={16} /><span><strong>{hasMatches ? 'Leitura da temporada' : 'Estreia pendente'}</strong><small>{hasMatches ? `Campanha atual: ${report.wins} vitórias, ${report.draws} empates e ${report.losses} derrotas.` : 'Nenhuma tendência é exibida sem uma partida concluída do clube.'}</small></span></div>
      </section>

      <aside className="report-leaders">
        <header><div><p className="eyebrow">REFERÊNCIAS DO ELENCO</p><h2>Destaques atuais</h2></div></header>
        {leaders.map((leader, index) => <div key={`${leader.label}-${leader.player.id}`}>
          <span className="leader-index">{String(index + 1).padStart(2, '0')}</span>
          <span><strong>{safeName(leader.player)}</strong><small>{leader.label}</small><i><b style={{ width: `${leader.progress}%` }} /></i></span>
          <strong>{leader.value}</strong>
        </div>)}
        {!leaders.length && <p className="report-leaders__empty">Nenhum jogador disponível no elenco atual.</p>}
      </aside>

      <section className="zone-report campaign-report">
        <header><div><p className="eyebrow">RESUMO DA TEMPORADA</p><h2>Campanha do {club.name}</h2></div></header>
        <div className="campaign-summary">
          <span className="campaign-points"><small>PONTOS</small><strong>{report.points}</strong><em>em {report.played} {report.played === 1 ? 'jogo' : 'jogos'}</em></span>
          <dl>
            <div><dt>Vitórias</dt><dd>{report.wins}</dd></div>
            <div><dt>Empates</dt><dd>{report.draws}</dd></div>
            <div><dt>Derrotas</dt><dd>{report.losses}</dd></div>
            <div><dt>Saldo</dt><dd>{signed(report.goalDifference)}</dd></div>
          </dl>
        </div>
        <p><Trophy size={14} /> {hasMatches ? `${report.cleanSheets} ${report.cleanSheets === 1 ? 'jogo sem sofrer gol' : 'jogos sem sofrer gols'} na campanha.` : 'Campanha ainda sem partidas concluídas.'}</p>
      </section>
    </div>
  </main>;
}
