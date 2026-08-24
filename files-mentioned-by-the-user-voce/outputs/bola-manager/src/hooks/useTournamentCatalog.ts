import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/apiClient';
import type { Tournament, TournamentFormat, TournamentLegs, TournamentTiebreaker } from '../types';
import { useAuth } from './useAuth';

interface TournamentResponse { tournaments?: unknown[]; source?: string; }
const formats: TournamentFormat[] = ['league', 'knockout', 'groups_knockout'];
const legs: TournamentLegs[] = ['single', 'double'];
const tiebreakers: TournamentTiebreaker[] = ['goal_difference', 'goals_scored', 'wins', 'head_to_head', 'fair_play', 'away_goals', 'extra_time', 'penalties', 'drawing_lots'];

function normalize(value: unknown): Tournament | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  const name = typeof record.name === 'string' ? record.name : '';
  if (!id || !name) return null;
  const format = formats.includes(record.format as TournamentFormat) ? record.format as TournamentFormat : 'league';
  const tournamentLegs = legs.includes(record.legs as TournamentLegs) ? record.legs as TournamentLegs : 'single';
  const teamIds = Array.isArray(record.teamIds) ? record.teamIds.filter((item): item is string => typeof item === 'string') : [];
  const participants = Array.isArray(record.participants) ? record.participants.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const participant = value as Record<string, unknown>;
    const participantId = typeof participant.id === 'string' ? participant.id : '';
    if (!participantId) return [];
    return [{
      id: participantId,
      name: typeof participant.name === 'string' ? participant.name : participantId,
      abbreviation: typeof participant.abbreviation === 'string' ? participant.abbreviation : participantId.slice(0, 3).toUpperCase(),
      colors: Array.isArray(participant.colors) ? participant.colors.filter((item): item is string => typeof item === 'string') : [],
      darkThemeColor: typeof participant.darkThemeColor === 'string' ? participant.darkThemeColor : null,
      lightThemeColor: typeof participant.lightThemeColor === 'string' ? participant.lightThemeColor : null,
      country: typeof participant.country === 'string' ? participant.country : null,
      division: typeof participant.division === 'string' ? participant.division : null,
      crestImageUrl: typeof participant.crestImageUrl === 'string' ? participant.crestImageUrl : null,
      crestImagePath: typeof participant.crestImagePath === 'string' ? participant.crestImagePath : null,
    }];
  }) : [];
  return {
    id, name, format, legs: tournamentLegs,
    teamCount: Number.isFinite(Number(record.teamCount)) ? Number(record.teamCount) : teamIds.length,
    tiebreakers: Array.isArray(record.tiebreakers) ? record.tiebreakers.filter((item): item is TournamentTiebreaker => tiebreakers.includes(item as TournamentTiebreaker)) : [],
    teamIds,
    trophyImageUrl: typeof record.trophyImageUrl === 'string' ? record.trophyImageUrl : null,
    trophyImagePath: typeof record.trophyImagePath === 'string' ? record.trophyImagePath : null,
    active: record.active !== false,
    participants,
  };
}

export function useTournamentCatalog(roomCode?: string | null) {
  const auth = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !auth.identity) { setTournaments([]); setLoading(false); return; }
    const controller = new AbortController();
    const normalizedRoomCode = roomCode?.trim();
    const endpoint = normalizedRoomCode
      ? `/api/tournaments?roomCode=${encodeURIComponent(normalizedRoomCode)}`
      : '/api/tournaments';
    setTournaments([]);
    setLoading(true); setError(null);
    void apiRequest<TournamentResponse>(endpoint, { identity: auth.identity, getIdToken: auth.getIdToken }, { signal: controller.signal })
      .then((payload) => { if (!controller.signal.aborted) setTournaments((payload.tournaments ?? []).flatMap((item) => { const tournament = normalize(item); return tournament ? [tournament] : []; })); })
      .catch((nextError: unknown) => { if (!(nextError instanceof DOMException && nextError.name === 'AbortError')) { setTournaments([]); setError(nextError instanceof Error ? nextError.message : 'Torneios personalizados indisponíveis.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [auth.getIdToken, auth.identity, auth.status, attempt, roomCode]);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  return useMemo(() => ({ tournaments, loading, error, refresh }), [tournaments, loading, error, refresh]);
}
