import { CloudRain, Radio } from 'lucide-react';
import type { MatchEvent } from '../../types';
import { ClubMark } from '../shared/ClubMark';

interface MatchScoreProps {
  minute: number;
  score: [number, number];
  finished: boolean;
  events: MatchEvent[];
  homeTeam: string;
  awayTeam: string;
  homeCode: string;
  awayCode: string;
  homeColor?: string;
  awayColor?: string;
  competition: string;
  roundLabel: string;
}

function scorerLabel(event: MatchEvent, fallbackTeam: string): string {
  const description = event.text.replace(/^GO+L!\s*/i, '');
  const playerName = description.split(/\s+/).slice(0, 2).join(' ');
  return `${playerName || fallbackTeam} ${event.minute}′`;
}

export function MatchScore({
  minute,
  score,
  finished,
  events,
  homeTeam,
  awayTeam,
  homeCode,
  awayCode,
  homeColor,
  awayColor,
  competition,
  roundLabel,
}: MatchScoreProps) {
  const homeScorers = events
    .filter((event) => event.kind === 'goal-home')
    .map((event) => scorerLabel(event, homeTeam));
  const awayScorers = events
    .filter((event) => event.kind === 'goal-away')
    .map((event) => scorerLabel(event, awayTeam));
  const phase = finished ? 'Resultado final' : minute < 45 ? '1º tempo' : minute === 45 ? 'Intervalo' : '2º tempo';

  return (
    <section className="match-scoreboard">
      <div className="score-context"><span className={finished ? 'finished' : ''}><Radio size={13} /> {finished ? 'ENCERRADO' : 'AO VIVO'}</span><strong>{competition.toLocaleUpperCase('pt-BR')} · {roundLabel.toLocaleUpperCase('pt-BR')}</strong><span><CloudRain size={13} /> Estádio Boreal · 17 °C</span></div>
      <div className="score-main">
        <div className="score-team score-team--home"><div><strong>{homeTeam}</strong><span>Mandante · 4–3–3</span></div><ClubMark code={homeCode} color={homeColor} size="lg" /></div>
        <div className="score-center"><span>{finished ? 'FIM' : minute === 45 ? 'INT' : `${minute}′`}</span><strong>{score[0]}<i>—</i>{score[1]}</strong><small>{phase}</small></div>
        <div className="score-team score-team--away"><ClubMark code={awayCode} color={awayColor} size="lg" /><div><strong>{awayTeam}</strong><span>Visitante · 4–2–3–1</span></div></div>
      </div>
      {(homeScorers.length > 0 || awayScorers.length > 0) && <div className="score-scorers">{homeScorers.length > 0 && <span><i /> {homeScorers.join(' · ')}</span>}{awayScorers.length > 0 && <span className="score-scorers__away">{awayScorers.join(' · ')} <i /></span>}</div>}
    </section>
  );
}
