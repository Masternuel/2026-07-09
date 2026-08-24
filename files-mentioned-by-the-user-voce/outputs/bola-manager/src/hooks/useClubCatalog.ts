import { useCallback, useEffect, useMemo, useState } from 'react';
import { clubOptions, type ClubOption } from '../constants/clubs';
import { apiRequest, type ApiCredentials } from '../lib/apiClient';
import type { LeagueChoice } from '../types';
import { useAuth } from './useAuth';

export type ClubCatalogSource = 'firestore' | 'fallback';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function trimmedText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function displayCode(value: unknown, name: string) {
  const source = trimmedText(value) || name;
  const normalized = source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return normalized.replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CLB';
}

function formatBudget(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'A definir';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 0,
  }).format(value);
}

export function normalizeClub(team: unknown, leaguesById: ReadonlyMap<string, LeagueChoice>): ClubOption | null {
  const record = asRecord(team);
  if (!record) return null;
  const id = trimmedText(record.id) ?? '';
  const name = trimmedText(record.name) ?? '';
  if (!id || id.length > 128 || !name) return null;
  const reputation = finiteNumber(record.reputation);
  const stars = reputation === null
    ? 0
    : Math.max(0, Math.min(5, Math.round(reputation / 2) / 2));
  const state = trimmedText(record.state);
  const country = trimmedText(record.country);
  const location = [state, country].filter((part): part is string => Boolean(part)).join(', ');
  const stadium = trimmedText(record.stadium);
  const city = trimmedText(record.city)
    || location
    || stadium
    || 'Local a definir';
  const primaryColor = (Array.isArray(record.colors)
    ? record.colors.map(trimmedText).find((color): color is string => Boolean(color && /^#[0-9a-f]{6}$/i.test(color)))
    : null) ?? '#6b7280';
  const leagueId = trimmedText(record.leagueId);
  const league = leagueId ? leaguesById.get(leagueId.toLocaleUpperCase('pt-BR')) : undefined;
  const configuredCapacity = finiteNumber(record.stadiumCapacity);
  return {
    id,
    name,
    code: displayCode(record.abbreviation, name),
    city,
    stars,
    budget: formatBudget(record.budget),
    color: primaryColor,
    darkThemeColor: trimmedText(record.darkThemeColor),
    lightThemeColor: trimmedText(record.lightThemeColor),
    crestImageUrl: trimmedText(record.crestImageUrl),
    stadium: stadium || 'A definir',
    stadiumCapacity: configuredCapacity !== null
      ? Math.max(0, Math.min(500_000, Math.trunc(configuredCapacity)))
      : 0,
    leagueId,
    leagueName: trimmedText(league?.name),
    division: trimmedText(record.division) || trimmedText(league?.division),
    country: country || trimmedText(league?.country),
    initiallyAvailable: true,
  };
}

export function normalizeTeamsPage(value: unknown): { teams: unknown[]; nextCursor: string | null } {
  const payload = asRecord(value);
  if (!payload || !Array.isArray(payload.teams)) {
    throw new Error('O catálogo retornou uma página inválida.');
  }
  if (payload.nextCursor === null || payload.nextCursor === undefined) {
    return { teams: payload.teams, nextCursor: null };
  }
  if (typeof payload.nextCursor !== 'string') {
    throw new Error('O catálogo retornou um cursor inválido.');
  }
  const nextCursor = payload.nextCursor.trim();
  if (!nextCursor) return { teams: payload.teams, nextCursor: null };
  if (nextCursor.length > 2_048) throw new Error('O catálogo retornou um cursor inválido.');
  return { teams: payload.teams, nextCursor };
}

export async function fetchAllClubs(credentials: ApiCredentials, signal: AbortSignal, roomCode?: string | null) {
  const teams: unknown[] = [];
  const seenCursors = new Set<string>();
  const normalizedRoomCode = trimmedText(roomCode);
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ limit: '100' });
    if (normalizedRoomCode) query.set('roomCode', normalizedRoomCode);
    if (cursor) query.set('cursor', cursor);
    const payload = normalizeTeamsPage(await apiRequest<unknown>(`/api/teams?${query}`, credentials, { signal }));
    if (teams.length + payload.teams.length > 10_000) {
      throw new Error('O catálogo excedeu o limite operacional de 10.000 clubes.');
    }
    teams.push(...payload.teams);
    if (!payload.nextCursor) return teams;
    if (seenCursors.has(payload.nextCursor)) throw new Error('O catálogo retornou um cursor repetido.');
    seenCursors.add(payload.nextCursor);
    cursor = payload.nextCursor;
  }
  throw new Error('O catálogo excedeu o limite operacional de 10.000 clubes.');
}

export function useClubCatalog(leagues: readonly LeagueChoice[] = [], roomCode?: string | null) {
  const auth = useAuth();
  const [remoteTeams, setRemoteTeams] = useState<unknown[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !auth.identity || auth.identity.mode !== 'firebase') {
      setRemoteTeams([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setRemoteTeams([]);
    setLoaded(false);
    setLoading(true);
    setError(null);
    void fetchAllClubs({
      identity: auth.identity,
      getIdToken: auth.getIdToken,
    }, controller.signal, roomCode).then((teams) => {
      setRemoteTeams(teams);
      setLoaded(true);
    }).catch((nextError: unknown) => {
      if (nextError instanceof DOMException && nextError.name === 'AbortError') return;
      setRemoteTeams([]);
      setLoaded(false);
      setError(roomCode
        ? 'A base do criador da sala está temporariamente indisponível.'
        : 'O catálogo do servidor está indisponível. Tente novamente.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [auth.status, auth.identity, auth.getIdToken, refreshToken, roomCode]);

  const refresh = useCallback(() => setRefreshToken((current) => current + 1), []);
  const remoteClubs = useMemo(() => {
    const leaguesById = new Map<string, LeagueChoice>();
    if (Array.isArray(leagues)) {
      for (const league of leagues) {
        const leagueId = league && typeof league === 'object' ? trimmedText(league.id) : null;
        if (leagueId) leaguesById.set(leagueId.toLocaleUpperCase('pt-BR'), league);
      }
    }
    const seen = new Set<string>();
    return remoteTeams.flatMap((team) => {
      const club = normalizeClub(team, leaguesById);
      const key = club?.id.toLocaleUpperCase('pt-BR');
      if (!club || !key || seen.has(key)) return [];
      seen.add(key);
      return [club];
    }).sort((left, right) => (
      right.stars - left.stars || left.name.localeCompare(right.name, 'pt-BR')
    ));
  }, [remoteTeams, leagues]);
  // Dados fictícios pertencem exclusivamente ao modo demonstração. Uma falha
  // do Firebase deve permanecer visível, sem substituir a base real em silêncio.
  const useFallback = auth.identity?.mode === 'demo';

  return useMemo(() => ({
    clubs: useFallback ? clubOptions : remoteClubs,
    source: (useFallback ? 'fallback' : 'firestore') as ClubCatalogSource,
    loaded: useFallback ? true : loaded,
    loading: useFallback ? false : loading,
    error: useFallback ? null : error,
    refresh,
  }), [remoteClubs, useFallback, loaded, loading, error, refresh]);
}
