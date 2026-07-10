import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, ChevronRight, CircleDollarSign, CloudRain, Crosshair, Gauge, Goal, HeartPulse, Newspaper, ShieldCheck, Sparkles, TrendingUp, Users } from 'lucide-react';
import { Badge } from '../components/shared/Badge';
import { ClubMark } from '../components/shared/ClubMark';
import { Panel } from '../components/shared/Panel';
import { ProgressBar } from '../components/shared/ProgressBar';
import { TacticsField } from '../components/tactics/TacticsField';
import { formations } from '../constants/formations';
import { leagueTable, news, players } from '../data/demoData';
import type { RouteKey } from '../types';
import { formatCurrency } from '../utils/formatters';

interface HomeViewProps {
  onNavigate: (route: RouteKey) => void;
}

const startingEleven = [players[0], players[3], players[1], players[2], players[4], players[5], players[6], players[7], players[8], players[9], players[10]];

export function HomeView({ onNavigate }: HomeViewProps) {
  return (
    <main className="dashboard view-enter">
      <div className="dashboard-heading">
        <div><p className="eyebrow">QUARTA-FEIRA, 16 DE JULHO</p><h1>Bom jogo, Emanuel.</h1><p>O elenco está concentrado. Restam duas decisões antes do clássico.</p></div>
        <div className="dashboard-actions">
          <button onClick={() => onNavigate('calendar')}><CalendarDays size={15} /> Ver agenda</button>
          <button className="accent" onClick={() => onNavigate('match')}><Goal size={15} /> Ir para a partida</button>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="fixture-command">
          <div className="fixture-command__rail"><span>PRÓXIMO JOGO</span><i /></div>
          <div className="fixture-command__meta">
            <Badge tone="neutral">BRASILEIRÃO · RODADA 14</Badge>
            <span><CloudRain size={14} /> 17 °C · Chuva fraca</span>
            <span>Estádio Boreal · 36.250</span>
          </div>
          <div className="fixture-command__teams">
            <div className="fixture-team fixture-team--home"><ClubMark code="AUR" size="xl" /><div><strong>Aurora FC</strong><span>2º · 27 pontos</span></div></div>
            <div className="fixture-kickoff"><small>HOJE</small><strong>21:30</strong><span>em 48 minutos</span></div>
            <div className="fixture-team fixture-team--away"><ClubMark code="SAN" color="#dedede" size="xl" /><div><strong>Santos</strong><span>10º · 15 pontos</span></div></div>
          </div>
          <div className="fixture-command__intel">
            <div><span className="intel-icon"><Crosshair size={15} /></span><span><small>CHAVE DO JOGO</small><strong>Atacar o espaço nas costas do lateral-direito</strong></span></div>
            <div><span className="intel-icon"><ShieldCheck size={15} /></span><span><small>ESCALAÇÃO</small><strong>10 de 11 confirmados</strong></span></div>
            <button onClick={() => onNavigate('tactics')}>Revisar plano <ArrowRight size={15} /></button>
          </div>
        </section>

        <Panel title="Classificação" eyebrow="SÉRIE A · APÓS 13 RODADAS" action="Tabela completa" onAction={() => onNavigate('competitions')} className="table-panel">
          <div className="mini-table">
            <div className="mini-table__head"><span>#</span><span>CLUBE</span><span>J</span><span>SG</span><span>PTS</span></div>
            {leagueTable.slice(0, 6).map((team) => (
              <div key={team.code} className={team.code === 'AUR' ? 'highlight' : ''}>
                <span>{team.position}</span><span><i style={{ background: team.accent }} />{team.name}</span><span>{team.played}</span><span>{team.goalDifference > 0 ? '+' : ''}{team.goalDifference}</span><strong>{team.points}</strong>
              </div>
            ))}
          </div>
          <div className="position-gap"><span><TrendingUp size={14} /> A 2 pts da liderança</span><span>+5 pts sobre o G4</span></div>
        </Panel>

        <Panel title="Plano de jogo" eyebrow="4–3–3 · PRESSÃO ALTA" action="Editar" onAction={() => onNavigate('tactics')} className="tactic-snapshot">
          <TacticsField formation={formations[0]} lineup={startingEleven} compact />
          <div className="tactic-tags"><span><Gauge size={13} /> Ritmo alto</span><span><Crosshair size={13} /> Construção curta</span><span><Sparkles size={13} /> Mentalidade positiva</span></div>
        </Panel>

        <Panel title="Pulso do elenco" eyebrow="DISPONIBILIDADE" action="Ver elenco" onAction={() => onNavigate('squad')} className="squad-pulse">
          <div className="pulse-hero"><div className="pulse-score"><strong>91</strong><span>/100</span></div><div><strong>Prontos para competir</strong><p>Moral acima da média e carga equilibrada.</p></div></div>
          <div className="pulse-stats">
            <div><span><Users size={14} /> Disponíveis</span><strong>18<small>/20</small></strong><ProgressBar value={90} /></div>
            <div><span><HeartPulse size={14} /> Condição média</span><strong>92<small>%</small></strong><ProgressBar value={92} tone="info" /></div>
          </div>
          <div className="availability-row"><Badge tone="danger" dot>1 lesionado</Badge><Badge tone="warning" dot>1 suspenso</Badge><span>Último treino: recuperação</span></div>
        </Panel>

        <Panel title="Financeiro" eyebrow="JULHO · PROJEÇÃO" action="Detalhes" onAction={() => onNavigate('finance')} className="finance-pulse">
          <div className="finance-total"><span><small>SALDO OPERACIONAL</small><strong>{formatCurrency(28_400_000)}</strong></span><span className="trend positive"><ArrowUpRight size={13} /> 8,4%</span></div>
          <div className="cashflow-chart" aria-label="Receitas e despesas dos últimos seis meses">
            {[42, 54, 48, 66, 58, 78].map((value, index) => <span key={index} style={{ height: `${value}%` }}><i style={{ height: `${Math.max(20, value - 22)}%` }} /></span>)}
          </div>
          <div className="finance-legend"><span><i /> Receita <strong>R$ 31,2 mi</strong></span><span><i /> Despesa <strong>R$ 18,7 mi</strong></span></div>
        </Panel>

        <Panel title="Diretoria" eyebrow="OBJETIVOS DA TEMPORADA" className="objectives-panel">
          <div className="objective-row"><span className="objective-icon positive"><ShieldCheck size={15} /></span><span><strong>Classificar à Libertadores</strong><small>2º lugar · dentro da meta</small></span><Badge tone="positive">No rumo</Badge></div>
          <div className="objective-row"><span className="objective-icon"><CircleDollarSign size={15} /></span><span><strong>Equilibrar a folha salarial</strong><small>74% do limite utilizado</small></span><strong>74%</strong></div>
          <div className="objective-row"><span className="objective-icon warning"><ArrowDownRight size={15} /></span><span><strong>Promover 2 atletas da base</strong><small>1 de 2 promovidos</small></span><strong>50%</strong></div>
        </Panel>

        <Panel title="Sala de imprensa" eyebrow="RADAR DO CLUBE" action="Ver feed" onAction={() => onNavigate('news')} className="newsroom-panel">
          <article className="lead-news">
            <div className="lead-news__visual"><span>LINHA<br />DE FUNDO</span><i>14</i></div>
            <div><Badge tone="info">Análise</Badge><h3>{news[0].headline}</h3><p>{news[0].body}</p><span><Newspaper size={13} /> {news[0].source} · {news[0].time}</span></div>
          </article>
          <div className="news-headlines">
            {news.slice(1, 3).map((item) => <button key={item.id} onClick={() => onNavigate('news')}><span>{item.tag}</span><strong>{item.headline}</strong><ChevronRight size={14} /></button>)}
          </div>
        </Panel>
      </div>
    </main>
  );
}
