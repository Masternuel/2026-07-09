import { useEffect, useState } from 'react';
import { ArrowUp, CalendarClock, Medal, Shield, Target, Trophy } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { ClubMark } from '../../components/shared/ClubMark';
import { ResilientImage } from '../../components/shared/ResilientImage';
import { leagueTable } from '../../data/demoData';
import type { ClubChoice, Room, Tournament } from '../../types';

interface CompetitionsViewProps {
  club: ClubChoice;
  room: Room | null;
  tournaments: Tournament[];
  loadingTournaments: boolean;
  tournamentError: string | null;
}

function compactCode(teamName: string) {
  return teamName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

export function CompetitionsView({ club, room, tournaments, loadingTournaments, tournamentError }: CompetitionsViewProps) {
  const [competition, setCompetition] = useState<string>('league');
  const customTournament = tournaments.find((item) => item.id === competition) ?? null;
  useEffect(() => {
    if (!['league', 'cup', 'continental'].includes(competition) && !tournaments.some((item) => item.id === competition)) {
      setCompetition('league');
    }
  }, [competition, tournaments]);
  const clubIds = new Set([club.id, club.code].map((identifier) => identifier.toLocaleUpperCase('pt-BR')));
  const completed = new Set((room?.completedFixtureIds ?? []).map((fixtureId) => fixtureId.toLocaleLowerCase('pt-BR')));
  const scheduledOpponents = (room?.fixtureSchedule ?? [])
    .filter((fixture) => !completed.has(fixture.fixtureId.toLocaleLowerCase('pt-BR')))
    .filter((fixture) => clubIds.has(fixture.homeClubId.toLocaleUpperCase('pt-BR')) || clubIds.has(fixture.awayClubId.toLocaleUpperCase('pt-BR')))
    .slice(0, 3)
    .map((fixture) => {
      const atHome = clubIds.has(fixture.homeClubId.toLocaleUpperCase('pt-BR'));
      const name = atHome ? fixture.awayTeam : fixture.homeTeam;
      return { code: compactCode(name), name, venue: atHome ? 'C' : 'F', detail: `Rodada ${fixture.round}` };
    });
  const opponents = scheduledOpponents.length || room
    ? scheduledOpponents
    : [
        { code: 'SAN', name: 'Santos', venue: 'C', detail: '10º colocado' },
        { code: 'FLU', name: 'Fluminense', venue: 'F', detail: '9º colocado' },
        { code: 'BAH', name: 'Bahia', venue: 'C', detail: '5º colocado' },
      ];
  return (
    <main className="secondary-view view-enter">
      <div className="view-heading"><div><p className="eyebrow">CALENDÁRIO NACIONAL</p><h1>Competições</h1><p>Tabelas, chaves e a corrida pelos objetivos do {club.name}.</p></div><div className="competition-picker"><button aria-selected={competition === 'league'} onClick={() => setCompetition('league')}><Shield size={15} /> Brasileirão</button><button aria-selected={competition === 'cup'} onClick={() => setCompetition('cup')}><Trophy size={15} /> Copa do Brasil</button><button aria-selected={competition === 'continental'} onClick={() => setCompetition('continental')}><Medal size={15} /> Sul-Americana</button>{tournaments.map((tournament) => <button key={tournament.id} aria-selected={competition === tournament.id} onClick={() => setCompetition(tournament.id)}><Trophy size={15} /> {tournament.name}</button>)}</div></div>
      {loadingTournaments && <div className="custom-tournament-status" aria-live="polite"><span className="button-spinner" /> Carregando torneios personalizados…</div>}
      {tournamentError && <div className="custom-tournament-status is-error" role="status">{tournamentError}</div>}
      {customTournament ? (
        <section className="custom-tournament-panel">
          <header>
            <div className="custom-tournament-trophy"><ResilientImage src={customTournament.trophyImageUrl} alt={`Troféu de ${customTournament.name}`} fallback={<Trophy size={34} />} /></div>
            <div><p className="eyebrow">TORNEIO PERSONALIZADO</p><h2>{customTournament.name}</h2><p>{customTournament.format === 'league' ? 'Pontos corridos' : customTournament.format === 'knockout' ? 'Mata-mata' : 'Grupos + mata-mata'} · {customTournament.legs === 'double' ? 'turno e returno' : 'turno único'}</p></div>
            <Badge tone="positive">{customTournament.participants.length}/{customTournament.teamCount} times</Badge>
          </header>
          <div className="custom-tournament-body">
            <section><p className="eyebrow">PARTICIPANTES</p><div className="custom-tournament-teams">{customTournament.participants.map((participant, index) => <div key={participant.id}><span>{String(index + 1).padStart(2, '0')}</span><ClubMark code={participant.abbreviation || participant.id.slice(0, 3).toUpperCase()} color={participant.colors[0] || '#c8ff3d'} imageUrl={participant.crestImageUrl} size="sm" /><strong>{participant.name}</strong><small>{participant.division || participant.country || 'Divisão a definir'}</small></div>)}</div>{!customTournament.participants.length && <p className="form-note">Nenhum participante disponível no catálogo.</p>}</section>
            <aside><p className="eyebrow">REGULAMENTO</p><dl><div><dt>Formato</dt><dd>{customTournament.format === 'league' ? 'Pontos corridos' : customTournament.format === 'knockout' ? 'Mata-mata' : 'Grupos + mata-mata'}</dd></div><div><dt>Turnos</dt><dd>{customTournament.legs === 'double' ? 'Ida e volta' : 'Turno único'}</dd></div><div><dt>Times</dt><dd>{customTournament.teamCount}</dd></div></dl><p className="eyebrow">DESEMPATE</p><ol>{customTournament.tiebreakers.map((criterion) => <li key={criterion}>{criterion === 'goal_difference' ? 'Saldo de gols' : criterion === 'goals_scored' ? 'Gols marcados' : criterion === 'wins' ? 'Vitórias' : criterion === 'head_to_head' ? 'Confronto direto' : criterion === 'fair_play' ? 'Fair play' : criterion === 'away_goals' ? 'Gols fora' : criterion === 'extra_time' ? 'Prorrogação' : criterion === 'penalties' ? 'Pênaltis' : 'Sorteio'}</li>)}</ol></aside>
          </div>
        </section>
      ) : competition === 'league' ? (
        <div className="competition-layout">
          <section className="standings-panel"><header><div><p className="eyebrow">SÉRIE A · CLASSIFICAÇÃO</p><h2>Após 13 rodadas</h2></div><Badge tone="positive"><ArrowUp size={12} /> Aurora subiu 1 posição</Badge></header><div className="full-table"><div className="full-table__head"><span>POS</span><span>CLUBE</span><span>J</span><span>V</span><span>E</span><span>D</span><span>SG</span><span>FORMA</span><span>PTS</span></div>{leagueTable.map((team) => <div key={team.code} className={team.code === 'AUR' ? 'highlight' : ''}><span>{team.position}</span><span><ClubMark code={team.code} color={team.accent} size="sm" /><strong>{team.name}</strong></span><span>{team.played}</span><span>{team.wins}</span><span>{team.draws}</span><span>{team.losses}</span><span>{team.goalDifference > 0 ? '+' : ''}{team.goalDifference}</span><span className="form-dots">{team.form.map((result, index) => <i key={index} className={result.toLowerCase()}>{result}</i>)}</span><strong>{team.points}</strong></div>)}</div></section>
          <aside className="competition-sidebar"><section><p className="eyebrow">PROJEÇÃO</p><div className="projection-ring"><span><strong>74%</strong><small>LIBERTADORES</small></span></div><h3>Ritmo de 79 pontos</h3><p>Com o desempenho atual, o {club.name} terminaria entre os três primeiros.</p></section><section><p className="eyebrow">PRÓXIMOS ADVERSÁRIOS</p>{opponents.length ? opponents.map((opponent) => <div className="next-opponent" key={`${opponent.code}-${opponent.detail}`}><ClubMark code={opponent.code} color="#ddd" size="sm" /><span><strong>{opponent.name}</strong><small>{opponent.detail}</small></span><strong>{opponent.venue}</strong></div>) : <p className="form-note">Nenhum adversário pendente.</p>}</section><section className="top-scorer"><Target size={18} /><span><small>ARTILHEIRO DO {club.name.toUpperCase()}</small><strong>Felipe Rocha · 9 gols</strong></span><Badge tone="warning">2º geral</Badge></section></aside>
        </div>
      ) : competition === 'cup' ? (
        <section className="bracket-panel"><header><div><p className="eyebrow">COPA DO BRASIL</p><h2>Oitavas de final</h2></div><Badge tone="warning"><CalendarClock size={12} /> Ida em 8 dias</Badge></header><div className="bracket"><div className="bracket-round"><span>OITAVAS</span>{[['AUR', 'Fortaleza'], ['Palmeiras', 'Cruzeiro'], ['Bahia', 'Flamengo'], ['Botafogo', 'Grêmio']].map(([a, b]) => <div className="tie" key={a}><p><strong>{a}</strong><span>—</span></p><p><strong>{b}</strong><span>—</span></p></div>)}</div><div className="bracket-round muted"><span>QUARTAS</span>{[1, 2].map((item) => <div className="tie" key={item}><p><strong>A definir</strong><span>—</span></p><p><strong>A definir</strong><span>—</span></p></div>)}</div><div className="bracket-round muted"><span>SEMIFINAL</span><div className="tie"><p><strong>A definir</strong><span>—</span></p><p><strong>A definir</strong><span>—</span></p></div></div></div></section>
      ) : (
        <section className="continental-empty"><Medal size={34} /><p className="eyebrow">COPA SUL-AMERICANA</p><h2>O Aurora entra na fase de grupos em 2027.</h2><p>A classificação continental depende da posição final no Brasileirão.</p><div><span><strong>74%</strong><small>chance de vaga</small></span><span><strong>6º</strong><small>corte estimado</small></span><span><strong>+5</strong><small>pontos de margem</small></span></div></section>
      )}
    </main>
  );
}
