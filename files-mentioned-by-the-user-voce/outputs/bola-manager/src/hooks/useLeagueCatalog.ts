import { useCallback, useEffect, useMemo, useState } from 'react';
import { demoLeagueOptions } from '../constants/clubs';
import { apiRequest } from '../lib/apiClient';
import type { LeagueChoice } from '../types';
import { useAuth } from './useAuth';

interface LeaguesResponse {
  leagues?: unknown[];
  source?: string;
}

export type LeagueCatalogSource = 'firestore' | 'fallback';

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLeague(value: unknown): LeagueChoice | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.active === false) return null;
  const id = text(record.id);
  const name = text(record.name);
  if (!id || !name) return null;
  const level = Number(record.level);
  const clubCount = Number(record.clubCount);
  return {
    id,
    name,
    country: text(record.country) || 'País a definir',
    division: text(record.division) || name,
    level: Number.isInteger(level) && level > 0 ? level : 1,
    clubCount: Number.isInteger(clubCount) && clubCount >= 0 ? clubCount : 0,
  };
}

export function useLeagueCatalog(roomCode?: string | null) {
  const auth = useAuth();
  const [remoteLeagues, setRemoteLeagues] = useState<LeagueChoice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !auth.identity || auth.identity.mode !== 'firebase') {
      setRemoteLeagues([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const normalizedRoomCode = roomCode?.trim();
    const endpoint = normalizedRoomCode
      ? `/api/leagues?roomCode=${encodeURIComponent(normalizedRoomCode)}`
      : '/api/leagues';
    setRemoteLeagues([]);
    setLoaded(false);
    setLoading(true);
    setError(null);
    void apiRequest<LeaguesResponse>(endpoint, {
      identity: auth.identity,
      getIdToken: auth.getIdToken,
    }, { signal: controller.signal }).then((payload) => {
      if (controller.signal.aborted) return;
      const seen = new Set<string>();
      const leagues = (payload.leagues ?? []).flatMap((item) => {
        const league = normalizeLeague(item);
        const key = league?.id.toLocaleUpperCase('pt-BR');
        if (!league || !key || seen.has(key)) return [];
        seen.add(key);
        return [league];
      }).sort((left, right) => (
        left.country.localeCompare(right.country, 'pt-BR')
        || left.level - right.level
        || left.name.localeCompare(right.name, 'pt-BR')
      ));
      setRemoteLeagues(leagues);
      setLoaded(true);
    }).catch((nextError: unknown) => {
      if (nextError instanceof DOMException && nextError.name === 'AbortError') return;
      setRemoteLeagues([]);
      setLoaded(false);
      setError(roomCode
        ? 'As ligas da base do criador estão temporariamente indisponíveis.'
        : 'O catálogo de ligas está indisponível. Tente novamente.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [auth.status, auth.identity, auth.getIdToken, refreshToken, roomCode]);

  const refresh = useCallback(() => setRefreshToken((current) => current + 1), []);
  // Contas Firebase nunca recebem uma liga fictícia quando a API falha.
  const useFallback = auth.identity?.mode === 'demo';

  return useMemo(() => ({
    leagues: useFallback ? demoLeagueOptions : remoteLeagues,
    source: (useFallback ? 'fallback' : 'firestore') as LeagueCatalogSource,
    loaded: useFallback ? true : loaded,
    loading: useFallback ? false : loading,
    error: useFallback ? null : error,
    refresh,
  }), [remoteLeagues, useFallback, loaded, loading, error, refresh]);
}
