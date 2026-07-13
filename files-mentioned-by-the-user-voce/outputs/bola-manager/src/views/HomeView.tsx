import { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, ChevronRight, CircleDollarSign, CloudRain, Crosshair, Gauge, Goal, HeartPulse, Newspaper, ShieldCheck, Sparkles, TrendingUp, Users } from 'lucide-react';
import { Badge } from '../components/shared/Badge';
import { ClubMark } from '../components/shared/ClubMark';
import { Panel } from '../components/shared/Panel';
import { ProgressBar } from '../components/shared/ProgressBar';
import { TacticsField } from '../components/tactics/TacticsField';
import { formations } from '../constants/formations';
import { leagueTable, news } from '../data/demoData';
import type { ServerMatchController } from '../hooks/useServerMatch';
import type { ClubChoice, Player, Room, RouteKey } from '../types';
import { average, formatCurrency } from '../utils/formatters';
import { buildSavedLineup } from '../utils/playerRoster';

interface HomeViewProps {
  players: Player[];
  savedLineupIds?: string[];
  onNavigate: (route: RouteKey) => void;
  onToast: (message: string) => void;
  club: ClubChoice;
  room: Room | null;
  managerId: string;
  onlineMatch: ServerMatchController | null;
}

function compactTeamCode(teamName: string) {
  return teamName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

function sameClub(left: string | undefined, club: ClubChoice) {
  const normalized = left?.toLocaleUpperCase('pt-BR');
  return normalized === club.id.toLocaleUpperCase('pt-BR') || normalized === club.code.toLocaleUpperCase('pt-BR');
}

function sameFixtureId(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLocaleLowerCase('pt-BR') === right.toLocaleLowerCase('pt-BR'));
}

export function HomeView({ players, savedLineupIds, onNavigate, onToast, club, room, managerId, onlineMatch }: HomeViewProps) {
  const [lineupSavePending, setLineupSavePending] = useState(false);
  const startingEleven = buildSavedLineup(players, formations[0], savedLineupIds);
  const availableCount = players.filter((player) => player.status === 'Disponível').length;
  const injuredCount = players.filter((player) => player.status === 'Lesionado').length;
  const suspendedCount = players.filter((player) => player.status === 'Suspenso').length;
  const averageCondition = Math.round(average(players.map((player) => player.condition)));
  const currentFixture = room?.fixtureSchedule?.find((fixture) => sameFixtureId(fixture.fixtureId, room.currentFixtureId));
  const readiness = room && sameFixtureId(room.matchReadiness?.fixtureId, room.currentFixtureId) ? room.matchReadiness : null;
  const readyCount = readiness?.managerIds.length ?? 0;
  const requiredCount = room?.managers.length ?? 1;
  const managerReady = readiness?.managerIds.includes(managerId) ?? false;
  const matchRunning = onlineMatch?.phase === 'running';
  const homeCode = currentFixture ? (sameClub(currentFixture.homeClubId, club) ? club.code : compactTeamCode(currentFixture.homeTeam)) : club.code;
  const awayCode = currentFixture ? (sameClub(currentFixture.awayClubId, club) ? club.code : compactTeamCode(currentFixture.awayTeam)) : 'ADV';
  const homeName = currentFixture?.homeTeam ?? club.name;
  const awayName = currentFixture?.awayTeam ?? 'Adversário a definir';

  const readinessLabel = !onlineMatch
    ? 'Ir para a partida'
    : matchRunning
      ? 'Assistir partida'
      : lineupSavePending
        ? 'Salvando escalação…'
      : onlineMatch.readyPending
        ? 'Confirmando…'
        : !room?.currentFixtureId
          ? 'Temporada concluída'
          : managerReady
            ? 'Cancelar pronto'
            : 'Estou pronto';

  async function handleMatchAction() {
    if (!onlineMatch || matchRunning) {
      onNavigate('match');
      return;
    }
    const ready = !managerReady;
    try {
      if (ready && !savedLineupIds?.length) {
        const lineupIds = startingEleven.flatMap((player) => player ? [player.id] : []).slice(0, 11);
        setLineupSavePending(true);
        await onlineMatch.saveLineup(lineupIds);
        setLineupSavePending(false);
      }
      await onlineMatch.setReady(ready);
    } catch (nextError: unknown) {
      onToast(nextError instanceof Error ? nextError.message : 'Não foi possível confirmar sua prontidão.');
    } finally {
      setLineupSavePending(false);
    }
  }

  return (
    <main className="dashboard view-enter">
      <div className="dashboard-heading">
        <div><p className="eyebrow">QUARTA-FEIRA, 16 DE JULHO</p><h1>Bom jogo, Emanuel.</h1><p>O elenco está concentrado. Restam duas decisões antes do clássico.</p></div>
        <div className="dashboard-actions">
          <button onClick={() => onNavigate('calendar')}><CalendarDays size={15} /> Ver agenda</button>
          <button className="accent" onClick={() => void handleMatchAction()} disabled={lineupSavePending || Boolean(onlineMatch?.readyPending) || (Boolean(onlineMatch) && !room?.currentFixtureId)}><Goal size={15} /> {readinessLabel}</button>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="fixture-command">
          <div className="fixture-command__rail"><span>PRÓXIMO JOGO</span><i /></div>
          <div className="fixture-command__meta">
            <Badge tone="neutral">BRASILEIRÃO · RODADA {currentFixture?.round ?? 14}</Badge>
            {onlineMatch && <Badge tone={managerReady ? 'positive' : 'warning'}>{readyCount}/{requiredCount} MANAGERS PRONTOS</Badge>}
            <span><CloudRain size={14} /> 17 °C · Chuva fraca</span>
            <span>Estádio Boreal · 36.250</span>
          </div>
          <div className="fixture-command__teams">
            <div className="fixture-team fixture-team--home"><ClubMark code={homeCode} size="xl" /><div><strong>{homeName}</strong><span>{currentFixture ? (currentFixture.homeManagerId ? 'Controlado por manager' : 'Controlado pela IA') : '2º · 27 pontos'}</span></div></div>
            <div className="fixture-kickoff"><small>HOJE</small><strong>21:30</strong><span>em 48 minutos</span></div>
            <div className="fixture-team fixture-team--away"><ClubMark code={awayCode} color="#dedede" size="xl" /><div><strong>{awayName}</strong><span>{currentFixture ? (currentFixture.awayManagerId ? 'Controlado por manager' : 'Controlado pela IA') : '10º · 15 pontos'}</span></div></div>
          </div>
          <div className="fixture-command__intel">
            <div><span className="intel-icon"><Crosshair size={15} /></span><span><small>CHAVE DO JOGO</small><strong>Atacar o espaço nas costas do lateral-direito</strong></span></div>
            <div><span className="intel-icon"><ShieldCheck size={15} /></span><span><small>{onlineMatch ? 'PRONTIDÃO DA SALA' : 'ESCALAÇÃO'}</small><strong>{onlineMatch ? `${readyCount} de ${requiredCount} managers confirmados` : '10 de 11 confirmados'}</strong></span></div>
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
          <div className="pulse-hero"><div className="pulse-score"><strong>{averageCondition}</strong><span>/100</span></div><div><strong>{players.length ? 'Prontos para competir' : 'Elenco ainda não cadastrado'}</strong><p>{players.length ? 'Moral acima da média e carga equilibrada.' : 'Adicione jogadores no Editor da Base.'}</p></div></div>
          <div className="pulse-stats">
            <div><span><Users size={14} /> Disponíveis</span><strong>{availableCount}<small>/{players.length}</small></strong><ProgressBar value={players.length ? (availableCount / players.length) * 100 : 0} /></div>
            <div><span><HeartPulse size={14} /> Condição média</span><strong>{averageCondition}<small>%</small></strong><ProgressBar value={averageCondition} tone="info" /></div>
          </div>
          <div className="availability-row"><Badge tone="danger" dot>{injuredCount} lesionado{injuredCount === 1 ? '' : 's'}</Badge><Badge tone="warning" dot>{suspendedCount} suspenso{suspendedCount === 1 ? '' : 's'}</Badge><span>Último treino: recuperação</span></div>
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
