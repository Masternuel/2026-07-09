import type { MatchEvent, MatchEventKind, ServerMatchEvent, ServerMatchEventType } from '../types';

const kindByType: Record<ServerMatchEventType, MatchEventKind> = {
  kickoff: 'info',
  attack: 'chance',
  goal: 'goal-home',
  save: 'chance',
  foul: 'info',
  corner: 'chance',
  'yellow-card': 'card',
  'red-card': 'card',
  halftime: 'whistle',
  post: 'chance',
  injury: 'injury',
  substitution: 'sub',
  penalty: 'chance',
  var: 'info',
  fulltime: 'whistle',
};

export function toClientMatchEvent(event: ServerMatchEvent, homeTeam: string): MatchEvent {
  const kind = event.type === 'goal'
    ? event.team === homeTeam ? 'goal-home' : 'goal-away'
    : kindByType[event.type];
  return {
    minute: event.minute,
    kind,
    text: event.text,
    score: event.score,
  };
}
