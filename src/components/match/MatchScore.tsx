import { MapPin, Radio } from 'lucide-react';
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
  homeDarkThemeColor?: string | null;
  homeLightThemeColor?: string | null;
  awayDarkThemeColor?: string | null;
  awayLightThemeColor?: string | null;
  homeCrestImageUrl?: string | null;
  awayCrestImageUrl?: string | null;
  stadium?: string | null;
  stadiumCapacity?: number | null;
  competition: string;
  roundLabel: string;
  homeFormation?: string;
  awayFormation?: string;
}

function scorerLabel(event: MatchEvent, fallbackTeam: string): string {
  const structuredScorer = typeof event.scorer === 'string' ? event.scorer.trim() : '';
  const description = typeof event.text === 'string'
    ? event.text.replace(/^GO+L!\s*/i, '').trim()
    : '';
  const legacyScorer = description
    .split(/\s+(?:cabeceia|bate|cobra|finaliza|aproveita|marca|desvia|converte)\b/i)[0]
    ?.split(/\s+/)
    .slice(0, 4)
    .join(' ');
  const playerName = structuredScorer || legacyScorer || fallbackTeam;
  const assist = typeof event.assist === 'string' && event.assist.trim()
    ? ` (assist. ${event.assist.trim()})`
    : '';
  const minute = typeof event.minute === 'number' && Number.isFinite(event.minute)
    ? Math.max(0, Math.trunc(event.minute))
    : 0;
  return `${playerName} ${minute}′${assist}`;
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
  homeDarkThemeColor,
  homeLightThemeColor,
  awayDarkThemeColor,
  awayLightThemeColor,
  homeCrestImageUrl,
  awayCrestImageUrl,
  stadium,
  stadiumCapacity,
  competition,
  roundLabel,
  homeFormation = 'A confirmar',
  awayFormation = 'A confirmar',
}: MatchScoreProps) {
  const safeEvents = (Array.isArray(events) ? events : []).filter(
    (event): event is MatchEvent => Boolean(event && typeof event === 'object'),
  );
  const homeScorers = safeEvents
    .filter((event) => event.kind === 'goal-home')
    .map((event) => scorerLabel(event, homeTeam));
  const awayScorers = safeEvents
    .filter((event) => event.kind === 'goal-away')
    .map((event) => scorerLabel(event, awayTeam));
  const phase = finished ? 'Resultado final' : minute < 45 ? '1º tempo' : minute === 45 ? 'Intervalo' : '2º tempo';
  const stadiumName = typeof stadium === 'string' && stadium.trim() ? stadium.trim() : 'Estádio a definir';
  const numericCapacity = Number(stadiumCapacity);
  const venue = Number.isFinite(numericCapacity) && numericCapacity > 0
    ? `${stadiumName} · ${new Intl.NumberFormat('pt-BR').format(Math.trunc(numericCapacity))}`
    : stadiumName;

  return (
    <section className="match-scoreboard">
      <div className="score-context"><span className={finished ? 'finished' : ''}><Radio size={13} /> {finished ? 'ENCERRADO' : 'AO VIVO'}</span><strong>{competition.toLocaleUpperCase('pt-BR')} · {roundLabel.toLocaleUpperCase('pt-BR')}</strong><span><MapPin size={13} /> {venue}</span></div>
      <div className="score-main">
        <div className="score-team score-team--home"><div><strong>{homeTeam}</strong><span>Mandante · {homeFormation}</span></div><ClubMark code={homeCode} color={homeColor} darkThemeColor={homeDarkThemeColor} lightThemeColor={homeLightThemeColor} imageUrl={homeCrestImageUrl} size="lg" /></div>
        <div className="score-center"><span>{finished ? 'FIM' : minute === 45 ? 'INT' : `${minute}′`}</span><strong>{score[0]}<i>—</i>{score[1]}</strong><small>{phase}</small></div>
        <div className="score-team score-team--away"><ClubMark code={awayCode} color={awayColor} darkThemeColor={awayDarkThemeColor} lightThemeColor={awayLightThemeColor} imageUrl={awayCrestImageUrl} size="lg" /><div><strong>{awayTeam}</strong><span>Visitante · {awayFormation}</span></div></div>
      </div>
      {(homeScorers.length > 0 || awayScorers.length > 0) && <div className="score-scorers">{homeScorers.length > 0 && <span><i /> {homeScorers.join(' · ')}</span>}{awayScorers.length > 0 && <span className="score-scorers__away">{awayScorers.join(' · ')} <i /></span>}</div>}
    </section>
  );
}
