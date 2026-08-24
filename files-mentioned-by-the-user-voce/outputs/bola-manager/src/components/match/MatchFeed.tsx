import { useEffect, useRef } from 'react';
import { AlertTriangle, ArrowRightLeft, Circle, Goal, ShieldAlert, Siren, Sparkles } from 'lucide-react';
import type { MatchEvent } from '../../types';

interface MatchFeedProps {
  events: MatchEvent[];
  finished: boolean;
}

const icons = {
  info: Circle,
  chance: Sparkles,
  'goal-home': Goal,
  'goal-away': Goal,
  card: ShieldAlert,
  sub: ArrowRightLeft,
  whistle: Siren,
  injury: AlertTriangle,
};

export function MatchFeed({ events, finished }: MatchFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const safeEvents = (Array.isArray(events) ? events : []).filter(
    (event): event is MatchEvent => Boolean(event && typeof event === 'object'),
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [safeEvents.length]);

  return (
    <div className="match-feed" ref={listRef} aria-live="polite">
      {safeEvents.map((event, index) => {
        const kind = typeof event.kind === 'string' && Object.hasOwn(icons, event.kind)
          ? event.kind as keyof typeof icons
          : 'info';
        const Icon = icons[kind] ?? Circle;
        const minute = typeof event.minute === 'number' && Number.isFinite(event.minute)
          ? Math.max(0, Math.trunc(event.minute))
          : 0;
        const text = typeof event.text === 'string' ? event.text : 'Evento da partida.';
        const score = Array.isArray(event.score)
          && event.score.length >= 2
          && typeof event.score[0] === 'number'
          && Number.isFinite(event.score[0])
          && typeof event.score[1] === 'number'
          && Number.isFinite(event.score[1])
          ? [Math.max(0, Math.trunc(event.score[0])), Math.max(0, Math.trunc(event.score[1]))] as const
          : null;
        return (
          <article className={`match-event match-event--${kind}`} key={`${minute}-${index}`}>
            <time>{String(minute).padStart(2, '0')}′</time>
            <span className="event-icon"><Icon size={14} /></span>
            <p>{text}</p>
            {score && <strong>{score[0]}–{score[1]}</strong>}
          </article>
        );
      })}
      {!finished && <div className="match-feed__typing"><span /><span /><span /> <small>A narração acompanha a jogada...</small></div>}
    </div>
  );
}
