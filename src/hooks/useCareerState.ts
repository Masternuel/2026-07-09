import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/apiClient';
import type {
  CareerContract,
  CareerContractStatus,
  CareerNationalSquad,
  CareerPlayerSnapshot,
  CareerSnapshot,
  CareerStage,
  CareerTrainingFocus,
  CareerTrainingIntensity,
  CareerTrainingPlan,
  PlayerPosition,
  Room,
} from '../types';
import { useAuth } from './useAuth';

type UnknownRecord = Record<string, unknown>;

interface CareerResponse {
  career?: unknown;
}

interface RoomMutationResponse {
  room?: Room;
}

export interface CareerTrainingInput {
  playerId: string;
  focus: CareerTrainingFocus;
  intensity: CareerTrainingIntensity;
  active?: boolean;
}

export interface CareerContractInput {
  playerId: string;
  years: number;
  wage: number;
}

export interface CareerPromotionInput {
  playerId: string;
  years?: number;
  wage?: number;
}

export interface UseCareerStateResult {
  career: CareerSnapshot | null;
  loading: boolean;
  error: string | null;
  mutationKey: string | null;
  refresh: () => void;
  saveTraining: (input: CareerTrainingInput) => Promise<Room | null>;
  renewContract: (input: CareerContractInput) => Promise<Room | null>;
  promoteAcademyPlayer: (input: CareerPromotionInput) => Promise<Room | null>;
}

const positions: PlayerPosition[] = ['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MEI', 'PD', 'PE', 'ATA'];
const focuses: CareerTrainingFocus[] = ['balanced', 'technical', 'attacking', 'defending', 'physical', 'goalkeeping', 'recovery'];
const intensities: CareerTrainingIntensity[] = ['low', 'normal', 'high'];
const contractStatuses: CareerContractStatus[] = ['active', 'academy', 'expired', 'free_agent', 'retired', 'released'];
const careerStages: CareerStage[] = ['academy', 'senior', 'retired'];

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value: unknown, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(number(value, fallback))));
}

function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : integer(value, 0, 0);
}

function normalizeContract(value: unknown, player: UnknownRecord): CareerContract {
  const source = record(value);
  const rawStatus = text(source?.status, player.academy === true ? 'academy' : 'active') as CareerContractStatus;
  const status = contractStatuses.includes(rawStatus) ? rawStatus : 'active';
  return {
    clubId: text(source?.clubId ?? player.clubId) || null,
    startSeason: nullableInteger(source?.startSeason),
    endSeason: nullableInteger(source?.endSeason),
    wage: Math.max(0, number(source?.wage ?? player.wage, 0)),
    status,
    renewalCount: integer(source?.renewalCount, 0),
  };
}

function normalizeTraining(value: unknown, fallbackPlayerId = ''): CareerTrainingPlan | null {
  const source = record(value);
  const playerId = text(source?.playerId, fallbackPlayerId);
  if (!source || !playerId) return null;
  const rawFocus = text(source.focus, 'balanced') as CareerTrainingFocus;
  const rawIntensity = text(source.intensity, 'normal') as CareerTrainingIntensity;
  return {
    playerId,
    focus: focuses.includes(rawFocus) ? rawFocus : 'balanced',
    intensity: intensities.includes(rawIntensity) ? rawIntensity : 'normal',
    active: source.active !== false,
  };
}

function normalizeCareerPlayer(value: unknown): CareerPlayerSnapshot | null {
  const source = record(value);
  const id = text(source?.id);
  if (!source || !id) return null;
  const rawPosition = text(source.position, 'MC').toUpperCase() as PlayerPosition;
  const rawStage = text(source.careerStage, source.academy === true ? 'academy' : 'senior') as CareerStage;
  const contract = normalizeContract(source.contract, source);
  const training = normalizeTraining(source.training, id);
  return {
    id,
    clubId: contract.clubId ?? (text(source.clubId) || null),
    name: text(source.name, id),
    position: positions.includes(rawPosition) ? rawPosition : 'MC',
    age: integer(source.age, 24, 14, 60),
    nationality: text(source.nationality, 'Brasil'),
    overall: Math.max(1, Math.min(20, number(source.overall, 10))),
    potential: Math.max(1, Math.min(20, number(source.potential, number(source.overall, 10)))),
    academy: source.academy === true || source.youth === true || rawStage === 'academy',
    youth: source.youth === true || source.academy === true || rawStage === 'academy',
    retired: source.retired === true || rawStage === 'retired',
    careerStage: careerStages.includes(rawStage) ? rawStage : 'senior',
    active: source.active !== false,
    condition: source.condition === undefined ? undefined : Math.max(0, Math.min(100, number(source.condition, 100))),
    wage: Math.max(0, number(source.wage ?? contract.wage, 0)),
    contract,
    ...(training ? { training } : {}),
    generatedSeason: source.generatedSeason === undefined ? undefined : integer(source.generatedSeason, 1, 1),
    promotedSeason: source.promotedSeason === undefined ? undefined : integer(source.promotedSeason, 1, 1),
    nationalTeamId: text(source.nationalTeamId) || null,
    internationalCaps: integer(source.internationalCaps, 0),
  };
}

function normalizeNationalSquad(value: unknown): CareerNationalSquad | null {
  const source = record(value);
  const teamId = text(source?.teamId);
  if (!source || !teamId) return null;
  const playerIds = list(source.playerIds).map((id) => text(id)).filter(Boolean);
  return {
    teamId,
    seasonNumber: integer(source.seasonNumber, 1, 1),
    squadSize: integer(source.squadSize, playerIds.length, 0),
    playerIds,
    eligibleCount: integer(source.eligibleCount, playerIds.length, 0),
  };
}

export function normalizeCareerSnapshot(value: unknown): CareerSnapshot | null {
  const source = record(value);
  if (!source) return null;
  return {
    currentSeason: integer(source.currentSeason, 1, 1),
    players: list(source.players).flatMap((player) => {
      const normalized = normalizeCareerPlayer(player);
      return normalized ? [normalized] : [];
    }),
    trainingPlans: list(source.trainingPlans).flatMap((plan) => {
      const normalized = normalizeTraining(plan);
      return normalized ? [normalized] : [];
    }),
    nationalSquads: list(source.nationalSquads).flatMap((squad) => {
      const normalized = normalizeNationalSquad(squad);
      return normalized ? [normalized] : [];
    }),
    lastSummary: source.lastSummary ?? null,
  };
}

export function useCareerState(roomCode?: string | null, enabled = true): UseCareerStateResult {
  const auth = useAuth();
  const [career, setCareer] = useState<CareerSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const code = roomCode?.trim() ?? '';

  const requestSnapshot = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !code || auth.status !== 'authenticated' || !auth.identity) return null;
    const payload = await apiRequest<CareerResponse>(
      `/api/rooms/${encodeURIComponent(code)}/career`,
      { identity: auth.identity, getIdToken: auth.getIdToken },
      { signal },
    );
    return normalizeCareerSnapshot(payload.career);
  }, [auth.getIdToken, auth.identity, auth.status, code, enabled]);

  useEffect(() => {
    if (!enabled || !code || auth.status !== 'authenticated' || !auth.identity) {
      setCareer(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void requestSnapshot(controller.signal).then((snapshot) => {
      if (!controller.signal.aborted) setCareer(snapshot);
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Carreira indisponível.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [auth.identity, auth.status, code, enabled, refreshToken, requestSnapshot]);

  const refresh = useCallback(() => setRefreshToken((current) => current + 1), []);

  const mutate = useCallback(async (
    key: string,
    path: string,
    method: 'POST' | 'PUT',
    body: object,
  ) => {
    if (!code || auth.status !== 'authenticated' || !auth.identity) throw new Error('Carreira não está disponível nesta sala.');
    setMutationKey(key);
    setError(null);
    try {
      const response = await apiRequest<RoomMutationResponse>(
        `/api/rooms/${encodeURIComponent(code)}${path}`,
        { identity: auth.identity, getIdToken: auth.getIdToken },
        { method, body, timeoutMs: 30_000 },
      );
      try {
        setCareer(await requestSnapshot());
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : 'Ação salva; atualização da carreira falhou.');
      }
      return response.room ?? null;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'O servidor não conseguiu salvar a carreira.');
      throw mutationError;
    } finally {
      setMutationKey(null);
    }
  }, [auth.getIdToken, auth.identity, auth.status, code, requestSnapshot]);

  return useMemo(() => ({
    career,
    loading,
    error,
    mutationKey,
    refresh,
    saveTraining: (input: CareerTrainingInput) => mutate(`training:${input.playerId}`, '/career/training', 'PUT', { ...input, active: input.active !== false }),
    renewContract: (input: CareerContractInput) => mutate(`contract:${input.playerId}`, '/career/contracts/renew', 'POST', input),
    promoteAcademyPlayer: (input: CareerPromotionInput) => mutate(`academy:${input.playerId}`, '/career/academy/promote', 'POST', input),
  }), [career, error, loading, mutate, mutationKey, refresh]);
}
