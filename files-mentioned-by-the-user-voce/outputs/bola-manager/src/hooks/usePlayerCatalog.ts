import { useCallback, useEffect, useMemo, useState } from 'react';
import { players as demoPlayers } from '../data/demoData';
import { apiRequest } from '../lib/apiClient';
import type {
  AttributeKey,
  ClubChoice,
  Morale,
  Player,
  PlayerPosition,
  PlayerStatus,
} from '../types';
import { useAuth } from './useAuth';

interface PlayerCatalogResponse {
  players?: unknown[];
  count?: number;
  source?: string;
}

interface PlayerCatalogState {
  clubId: string;
  players: Player[];
  source: string;
  loading: boolean;
  error: string | null;
}

const positions: PlayerPosition[] = ['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MEI', 'PD', 'PE', 'ATA'];
const statuses: PlayerStatus[] = ['Disponível', 'Lesionado', 'Suspenso', 'Cansado'];
const morales: Morale[] = ['Excelente', 'Boa', 'Neutra', 'Baixa'];
const attributeKeys: AttributeKey[] = ['velocidade', 'chute', 'drible', 'nocao', 'defesa', 'passe', 'peBom', 'peRuim'];

function numeric(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamped(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, numeric(value, fallback)));
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function fallbackRoster(clubId: string) {
  if (clubId === 'AUR') return demoPlayers;
  return demoPlayers.map((player) => ({ ...player, isStar: false }));
}

function normalizePlayer(value: unknown, clubId: string, index: number): Player | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.active === false) return null;
  const id = text(record.id, `${clubId}-player-${index + 1}`);
  const name = text(record.name, `Jogador ${index + 1}`);
  const positionValue = text(record.position, 'MC').toUpperCase() as PlayerPosition;
  const position = positions.includes(positionValue) ? positionValue : 'MC';
  const internalOverall = clamped(record.overall, 10, 1, 20);
  const visualOverall = clamped(internalOverall / 2, 5, 1, 10);
  const rawAttributes = record.attributes && typeof record.attributes === 'object'
    ? record.attributes as Record<string, unknown>
    : {};
  const attributes = Object.fromEntries(attributeKeys.map((key) => [
    key,
    clamped(numeric(rawAttributes[key], internalOverall) / 2, visualOverall, 1, 10),
  ])) as Record<AttributeKey, number>;
  const marketValue = Math.max(0, numeric(record.marketValue ?? record.value, internalOverall * 2_000_000));
  const statusValue = text(record.status, 'Disponível') as PlayerStatus;
  const moraleValue = text(record.morale, 'Boa') as Morale;
  const footValue = text(record.foot, 'Direito');
  const names = name.split(/\s+/);

  return {
    id,
    name,
    shortName: text(record.shortName, names.at(-1) ?? name),
    isStar: record.isStar === true,
    number: Math.round(clamped(record.shirtNumber ?? record.number, index + 1, 0, 99)),
    position,
    role: text(record.role, position),
    age: Math.round(clamped(record.age, 24, 14, 60)),
    nationality: text(record.nationality, 'Brasil'),
    value: marketValue,
    wage: Math.max(0, numeric(record.wage, Math.round(marketValue * 0.0035))),
    condition: Math.round(clamped(record.condition, 92, 0, 100)),
    morale: morales.includes(moraleValue) ? moraleValue : 'Boa',
    status: statuses.includes(statusValue) ? statusValue : 'Disponível',
    foot: footValue === 'Esquerdo' ? 'Esquerdo' : 'Direito',
    personality: text(record.personality, 'Profissional'),
    worldStar: clamped(record.worldStar, 3, 1, 10),
    attributes,
    avatarImageUrl: typeof record.avatarImageUrl === 'string' ? record.avatarImageUrl : null,
  };
}

function normalizeResponse(payload: unknown, clubId: string) {
  const response = payload && typeof payload === 'object' ? payload as PlayerCatalogResponse : {};
  const records = Array.isArray(payload) ? payload : Array.isArray(response.players) ? response.players : [];
  const seen = new Set<string>();
  const players = records.flatMap((record, index) => {
    const player = normalizePlayer(record, clubId, index);
    if (!player || seen.has(player.id)) return [];
    seen.add(player.id);
    return [player];
  });
  return { players, source: typeof response.source === 'string' ? response.source : 'firestore' };
}

export function usePlayerCatalog(club: ClubChoice) {
  const auth = useAuth();
  const fallback = useMemo(() => fallbackRoster(club.id), [club.id]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<PlayerCatalogState>(() => ({
    clubId: club.id,
    players: auth.status === 'authenticated' ? [] : fallback,
    source: auth.status === 'authenticated' ? 'loading' : 'fallback',
    loading: auth.status === 'authenticated',
    error: null,
  }));

  useEffect(() => {
    if (auth.status !== 'authenticated' || !auth.identity) {
      setState({ clubId: club.id, players: fallback, source: 'fallback', loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    setState({ clubId: club.id, players: [], source: 'loading', loading: true, error: null });
    void apiRequest<PlayerCatalogResponse>(
      `/api/teams/${encodeURIComponent(club.id)}/players`,
      { identity: auth.identity, getIdToken: auth.getIdToken },
      { signal: controller.signal },
    ).then((payload) => {
      if (controller.signal.aborted) return;
      const normalized = normalizeResponse(payload, club.id);
      const fallbackAllowed = normalized.source === 'demo-fallback' || normalized.source === 'brasfoot-not-loaded';
      setState({
        clubId: club.id,
        players: normalized.players.length ? normalized.players : fallbackAllowed ? fallback : [],
        source: normalized.source,
        loading: false,
        error: null,
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({
        clubId: club.id,
        players: fallback,
        source: 'fallback',
        loading: false,
        error: error instanceof Error ? error.message : 'O elenco do servidor está indisponível.',
      });
    });
    return () => controller.abort();
  }, [auth.getIdToken, auth.identity, auth.status, club.id, fallback, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((current) => current + 1), []);
  const current = state.clubId === club.id ? state : {
    clubId: club.id,
    players: auth.status === 'authenticated' ? [] : fallback,
    source: auth.status === 'authenticated' ? 'loading' : 'fallback',
    loading: true,
    error: null,
  };

  return useMemo(() => ({ ...current, refresh }), [current, refresh]);
}
