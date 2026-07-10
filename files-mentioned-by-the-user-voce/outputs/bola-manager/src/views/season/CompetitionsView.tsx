import { useState } from 'react';
import { ArrowUp, CalendarClock, Medal, Shield, Target, Trophy } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { ClubMark } from '../../components/shared/ClubMark';
import { leagueTable } from '../../data/demoData';

export function CompetitionsView() {
  const [competition, setCompetition] = useState<'league' | 'cup' | 'continental'>('league');
  return (
    <main className="secondary-view view-enter">
      <div className="view-heading"><div><p className="eyebrow">CALENDÁRIO NACIONAL</p><h1>Competições</h1><p>Tabelas, chaves e a corrida pelos objetivos do Aurora.</p></div><div className="competition-picker"><button aria-selected={competition === 'league'} onClick={() => setCompetition('league')}><Shield size={15} /> Brasileirão</button><button aria-selected={competition === 'cup'} onClick={() => setCompetition('cup')}><Trophy size={15} /> Copa do Brasil</button><button aria-selected={competition === 'continental'} onClick={() => setCompetition('continental')}><Medal size={15} /> Sul-Americana</button></div></div>
      {competition === 'league' ? (
        <div className="competition-layout">
          <section className="standings-panel"><header><div><p className="eyebrow">SÉRIE A · CLASSIFICAÇÃO</p><h2>Após 13 rodadas</h2></div><Badge tone="positive"><ArrowUp size={12} /> Aurora subiu 1 posição</Badge></header><div className="full-table"><div className="full-table__head"><span>POS</span><span>CLUBE</span><span>J</span><span>V</span><span>E</span><span>D</span><span>SG</span><span>FORMA</span><span>PTS</span></div>{leagueTable.map((team) => <div key={team.code} className={team.code === 'AUR' ? 'highlight' : ''}><span>{team.position}</span><span><ClubMark code={team.code} color={team.accent} size="sm" /><strong>{team.name}</strong></span><span>{team.played}</span><span>{team.wins}</span><span>{team.draws}</span><span>{team.losses}</span><span>{team.goalDifference > 0 ? '+' : ''}{team.goalDifference}</span><span className="form-dots">{team.form.map((result, index) => <i key={index} className={result.toLowerCase()}>{result}</i>)}</span><strong>{team.points}</strong></div>)}</div></section>
          <aside className="competition-sidebar"><section><p className="eyebrow">PROJEÇÃO</p><div className="projection-ring"><span><strong>74%</strong><small>LIBERTADORES</small></span></div><h3>Ritmo de 79 pontos</h3><p>Com o desempenho atual, o Aurora terminaria entre os três primeiros.</p></section><section><p className="eyebrow">PRÓXIMOS ADVERSÁRIOS</p>{[['SAN', 'Santos', '10º'], ['FLU', 'Fluminense', '9º'], ['BAH', 'Bahia', '5º']].map(([code, name, pos]) => <div className="next-opponent" key={code}><ClubMark code={code} color={code === 'BAH' ? '#3485df' : '#ddd'} size="sm" /><span><strong>{name}</strong><small>{pos} colocado</small></span><strong>{code === 'SAN' ? 'C' : code === 'FLU' ? 'F' : 'C'}</strong></div>)}</section><section className="top-scorer"><Target size={18} /><span><small>ARTILHEIRO DO AURORA</small><strong>Felipe Rocha · 9 gols</strong></span><Badge tone="warning">2º geral</Badge></section></aside>
        </div>
      ) : competition === 'cup' ? (
        <section className="bracket-panel"><header><div><p className="eyebrow">COPA DO BRASIL</p><h2>Oitavas de final</h2></div><Badge tone="warning"><CalendarClock size={12} /> Ida em 8 dias</Badge></header><div className="bracket"><div className="bracket-round"><span>OITAVAS</span>{[['AUR', 'Fortaleza'], ['Palmeiras', 'Cruzeiro'], ['Bahia', 'Flamengo'], ['Botafogo', 'Grêmio']].map(([a, b]) => <div className="tie" key={a}><p><strong>{a}</strong><span>—</span></p><p><strong>{b}</strong><span>—</span></p></div>)}</div><div className="bracket-round muted"><span>QUARTAS</span>{[1, 2].map((item) => <div className="tie" key={item}><p><strong>A definir</strong><span>—</span></p><p><strong>A definir</strong><span>—</span></p></div>)}</div><div className="bracket-round muted"><span>SEMIFINAL</span><div className="tie"><p><strong>A definir</strong><span>—</span></p><p><strong>A definir</strong><span>—</span></p></div></div></div></section>
      ) : (
        <section className="continental-empty"><Medal size={34} /><p className="eyebrow">COPA SUL-AMERICANA</p><h2>O Aurora entra na fase de grupos em 2027.</h2><p>A classificação continental depende da posição final no Brasileirão.</p><div><span><strong>74%</strong><small>chance de vaga</small></span><span><strong>6º</strong><small>corte estimado</small></span><span><strong>+5</strong><small>pontos de margem</small></span></div></section>
      )}
    </main>
  );
}
