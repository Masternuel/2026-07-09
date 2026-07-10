import { CloudRain, Radio } from 'lucide-react';
import type { MatchEvent } from '../../types';
import { ClubMark } from '../shared/ClubMark';

interface MatchScoreProps {
  minute: number;
  score: [number, number];
  finished: boolean;
  events: MatchEvent[];
}

function scorerLabel(event: MatchEvent): string {
  if (event.kind === 'goal-away') return `Santos ${event.minute}′`;
  const description = event.text.replace(/^GO+L!\s*/i, '');
  const playerName = description.split(/\s+/).slice(0, 2).join(' ');
  return `${playerName || 'Aurora FC'} ${event.minute}′`;
}

export function MatchScore({ minute, score, finished, events }: MatchScoreProps) {
  const homeScorers = events.filter((event) => event.kind === 'goal-home').map(scorerLabel);
  const awayScorers = events.filter((event) => event.kind === 'goal-away').map(scorerLabel);
  const phase = finished ? 'Resultado final' : minute < 45 ? '1º tempo' : minute === 45 ? 'Intervalo' : '2º tempo';

  return (
    <section className="match-scoreboard">
      <div className="score-context"><span className={finished ? 'finished' : ''}><Radio size={13} /> {finished ? 'ENCERRADO' : 'AO VIVO'}</span><strong>BRASILEIRÃO · RODADA 14</strong><span><CloudRain size={13} /> Estádio Boreal · 17 °C</span></div>
      <div className="score-main">
        <div className="score-team score-team--home"><div><strong>Aurora FC</strong><span>Mandante · 4–3–3</span></div><ClubMark code="AUR" size="lg" /></div>
        <div className="score-center"><span>{finished ? 'FIM' : minute === 45 ? 'INT' : `${minute}′`}</span><strong>{score[0]}<i>—</i>{score[1]}</strong><small>{phase}</small></div>
        <div className="score-team score-team--away"><ClubMark code="SAN" color="#e6e6e6" size="lg" /><div><strong>Santos</strong><span>Visitante · 4–2–3–1</span></div></div>
      </div>
      {(homeScorers.length > 0 || awayScorers.length > 0) && <div className="score-scorers">{homeScorers.length > 0 && <span><i /> {homeScorers.join(' · ')}</span>}{awayScorers.length > 0 && <span className="score-scorers__away">{awayScorers.join(' · ')} <i /></span>}</div>}
    </section>
  );
}
