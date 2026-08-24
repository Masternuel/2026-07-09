import { useEffect, useState } from 'react';
import { ApiError, apiRequest, type ApiCredentials } from '../lib/apiClient';
import type { ClubChoice, StarImpactPlayer, StarImpactProfile } from '../types';

interface StarImpactState {
  profile: StarImpactProfile | null;
  loading: boolean;
  error: string | null;
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeStarPlayers(value: unknown): StarImpactPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    return typeof record.id === 'string' && typeof record.name === 'string'
      ? [{ id: record.id, name: record.name }]
      : [];
  });
}

function normalizeProfile(value: unknown, clubId: string): StarImpactProfile {
  const envelope = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const record = envelope.impact && typeof envelope.impact === 'object'
    ? envelope.impact as Record<string, unknown>
    : envelope;
  const starPlayers = normalizeStarPlayers(record.starPlayers);
  return {
    clubId: typeof record.clubId === 'string' ? record.clubId : clubId,
    catalogPlayerCount: Math.max(0, finiteNumber(record.catalogPlayerCount)),
    starCount: Math.max(0, finiteNumber(record.starCount, starPlayers.length)),
    starPlayers,
    matchStrengthBonus: Math.max(0, finiteNumber(record.matchStrengthBonus)),
    sponsorBoostPercent: Math.max(0, finiteNumber(record.sponsorBoostPercent)),
    sponsorAnnualBonus: Math.max(0, finiteNumber(record.sponsorAnnualBonus)),
    ...(typeof record.source === 'string'
      ? { source: record.source }
      : typeof envelope.source === 'string' ? { source: envelope.source } : {}),
  };
}

function starImpactError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof DOMException && error.name === 'AbortError') return null;
  return 'Não foi possível calcular o impacto comercial das estrelas.';
}

export function useStarImpact(club: ClubChoice, credentials: ApiCredentials | null, roomCode?: string | null): StarImpactState {
  const [state, setState] = useState<StarImpactState>({ profile: null, loading: Boolean(credentials), error: null });

  useEffect(() => {
    const controller = new AbortController();
    if (!credentials) {
      setState({ profile: null, loading: false, error: null });
      return () => controller.abort();
    }

    const query = new URLSearchParams();
    if (roomCode?.trim()) query.set('roomCode', roomCode.trim());
    const queryString = query.toString();
    setState({ profile: null, loading: true, error: null });
    void apiRequest<unknown>(`/api/teams/${encodeURIComponent(club.id)}/star-impact${queryString ? `?${queryString}` : ''}`, credentials, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const profile = normalizeProfile(payload, club.id);
        setState({ profile, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = starImpactError(error);
        if (message) setState({ profile: null, loading: false, error: message });
      });

    return () => controller.abort();
  }, [club, credentials, roomCode]);

  return state;
}
