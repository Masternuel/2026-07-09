import type {
  MatchEvent,
  MatchEventKind,
  ServerMatchEvent,
  ServerMatchEventType,
  ServerMatchSubstitution,
} from '../types';

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

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNullableText(value: unknown): string | null | undefined {
  return value === null ? null : optionalText(value);
}

function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : undefined;
}

function normalizedSubstitution(value: unknown): ServerMatchSubstitution | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const playerOutId = optionalText(record.playerOutId);
  const playerOutName = optionalText(record.playerOutName);
  const playerInId = optionalText(record.playerInId);
  const playerInName = optionalText(record.playerInName);
  return playerOutId && playerOutName && playerInId && playerInName
    ? { playerOutId, playerOutName, playerInId, playerInName }
    : undefined;
}

export function toClientMatchEvent(event: ServerMatchEvent, homeTeam?: string | null): MatchEvent {
  const type = typeof event.type === 'string' && Object.hasOwn(kindByType, event.type)
    ? event.type as ServerMatchEventType
    : undefined;
  const side = event.side === 'home' || event.side === 'away' ? event.side : undefined;
  const eventTeam = optionalText(event.team);
  const normalizedHomeTeam = optionalText(homeTeam);
  const inferredGoalSide = eventTeam && normalizedHomeTeam
    ? eventTeam.toLocaleLowerCase('pt-BR') === normalizedHomeTeam.toLocaleLowerCase('pt-BR') ? 'home' : 'away'
    : undefined;
  const goalSide = side ?? inferredGoalSide;
  const kind = type === 'goal'
    ? goalSide === 'home' ? 'goal-home' : goalSide === 'away' ? 'goal-away' : 'info'
    : type ? kindByType[type] : 'info';
  const minute = nonNegativeInteger(event.minute) ?? 0;
  const score = Array.isArray(event.score) && event.score.length >= 2
    ? [
        nonNegativeInteger(event.score[0]) ?? 0,
        nonNegativeInteger(event.score[1]) ?? 0,
      ] as [number, number]
    : undefined;
  return {
    id: optionalText(event.id),
    minute,
    kind,
    text: typeof event.text === 'string' && event.text.trim() ? event.text : 'Evento da partida.',
    score,
    type,
    side,
    team: eventTeam,
    teamId: optionalText(event.teamId),
    playerId: optionalText(event.playerId),
    scorerId: optionalText(event.scorerId),
    scorer: optionalText(event.scorer),
    assist: optionalNullableText(event.assist),
    assistId: optionalNullableText(event.assistId),
    fouledPlayerId: optionalText(event.fouledPlayerId),
    severity: ['minor', 'moderate', 'severe'].includes(String(event.severity))
      ? event.severity
      : undefined,
    injuryMatches: nonNegativeInteger(event.injuryMatches),
    suspensionMatches: nonNegativeInteger(event.suspensionMatches),
    substitution: normalizedSubstitution(event.substitution),
  };
}
