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

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [events.length]);

  return (
    <div className="match-feed" ref={listRef} aria-live="polite">
      {events.map((event, index) => {
        const Icon = icons[event.kind];
        return (
          <article className={`match-event match-event--${event.kind}`} key={`${event.minute}-${index}`}>
            <time>{String(event.minute).padStart(2, '0')}′</time>
            <span className="event-icon"><Icon size={14} /></span>
            <p>{event.text}</p>
            {event.score && <strong>{event.score[0]}–{event.score[1]}</strong>}
          </article>
        );
      })}
      {!finished && <div className="match-feed__typing"><span /><span /><span /> <small>A narração acompanha a jogada...</small></div>}
    </div>
  );
}
