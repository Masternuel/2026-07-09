import { useEffect, useMemo, useState } from 'react';
import { clubOptions, type ClubOption } from '../constants/clubs';
import { apiRequest, type ApiCredentials } from '../lib/apiClient';
import { useAuth } from './useAuth';

interface BrasfootClubDto {
  id: string;
  name: string;
  abbreviation?: string;
  colors?: string[];
  stadium?: string;
  reputation?: number;
  division?: string;
  country?: string;
  state?: string | null;
  city?: string;
  budget?: number | string;
}

interface TeamsResponse {
  teams: BrasfootClubDto[];
  nextCursor: string | null;
  source: 'firestore' | 'brasfoot-not-loaded';
}

export type ClubCatalogSource = 'firestore' | 'fallback';

function displayCode(value: string | undefined, name: string) {
  const source = value?.trim() || name;
  const normalized = source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return normalized.replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CLB';
}

function formatBudget(value: number | string | undefined) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'A definir';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 0,
  }).format(value);
}

function normalizeClub(team: BrasfootClubDto): ClubOption | null {
  const id = String(team.id ?? '').trim();
  const name = String(team.name ?? '').trim();
  if (!id || id.length > 128 || !name) return null;
  const reputation = Number.isFinite(team.reputation) ? Number(team.reputation) : 10;
  const stars = Math.max(1, Math.min(5, Math.round(reputation / 2) / 2));
  const city = team.city?.trim()
    || [team.state, team.country].filter((part): part is string => Boolean(part?.trim())).join(', ')
    || team.stadium?.trim()
    || 'Local a definir';
  const primaryColor = team.colors?.find((color) => /^#[0-9a-f]{6}$/i.test(color)) ?? '#c8ff3d';
  return {
    id,
    name,
    code: displayCode(team.abbreviation, name),
    city,
    stars,
    budget: formatBudget(team.budget),
    color: primaryColor,
    initiallyAvailable: true,
  };
}

async function fetchAllClubs(credentials: ApiCredentials, signal: AbortSignal) {
  const teams: BrasfootClubDto[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const payload = await apiRequest<TeamsResponse>(`/api/teams?${query}`, credentials, { signal });
    teams.push(...payload.teams);
    if (!payload.nextCursor) return teams;
    if (payload.nextCursor === cursor) throw new Error('O catálogo retornou um cursor repetido.');
    cursor = payload.nextCursor;
  }
  throw new Error('O catálogo excedeu o limite operacional de 10.000 clubes.');
}

export function useClubCatalog() {
  const auth = useAuth();
  const [remoteClubs, setRemoteClubs] = useState<ClubOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !auth.identity || auth.identity.mode !== 'firebase') {
      setRemoteClubs([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchAllClubs({
      identity: auth.identity,
      getIdToken: auth.getIdToken,
    }, controller.signal).then((teams) => {
      const seen = new Set<string>();
      const normalized = teams.flatMap((team) => {
        const club = normalizeClub(team);
        if (!club || seen.has(club.id)) return [];
        seen.add(club.id);
        return [club];
      });
      setRemoteClubs(normalized.sort((left, right) => (
        right.stars - left.stars || left.name.localeCompare(right.name, 'pt-BR')
      )));
    }).catch((nextError: unknown) => {
      if (nextError instanceof DOMException && nextError.name === 'AbortError') return;
      setRemoteClubs([]);
      setError('O catálogo do servidor está indisponível. Exibindo clubes de demonstração.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [auth.status, auth.identity, auth.getIdToken]);

  return useMemo(() => ({
    clubs: remoteClubs.length ? remoteClubs : clubOptions,
    source: (remoteClubs.length ? 'firestore' : 'fallback') as ClubCatalogSource,
    loading,
    error,
  }), [remoteClubs, loading, error]);
}
