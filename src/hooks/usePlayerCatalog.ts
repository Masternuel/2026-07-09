import { useCallback, useEffect, useMemo, useState } from 'react';
import { players as demoPlayers } from '../data/demoData';
import { apiRequest } from '../lib/apiClient';
import type {
  AttributeKey,
  CareerContractStatus,
  CareerStage,
  CareerTrainingFocus,
  CareerTrainingIntensity,
  ClubChoice,
  Morale,
  Player,
  PlayerCareerStats,
  PlayerPosition,
  PlayerSeasonStats,
  PlayerStatus,
} from '../types';
import { moraleLabelForScore, normalizeMoraleScore } from '../utils/playerMorale';
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
const morales: Morale[] = ['Excelente', 'Boa', 'Neutra', 'Baixa'];
const careerContractStatuses: CareerContractStatus[] = ['active', 'academy', 'expired', 'free_agent', 'retired', 'released'];
const careerStages: CareerStage[] = ['academy', 'senior', 'retired'];
const trainingFocuses: CareerTrainingFocus[] = ['balanced', 'technical', 'attacking', 'defending', 'physical', 'goalkeeping', 'recovery'];
const trainingIntensities: CareerTrainingIntensity[] = ['low', 'normal', 'high'];
const attributeKeys: AttributeKey[] = [
  'velocidade', 'chute', 'drible', 'nocao', 'defesa', 'passe', 'peBom', 'peRuim',
  'forca', 'resistencia', 'impulsao', 'reflexos', 'posicionamentoGol', 'saidaGol', 'penaltis',
];
function numeric(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamped(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, numeric(value, fallback)));
}

export function normalizePlayerCondition(value: unknown) {
  if (value === null || value === undefined || value === '') return 100;
  return Math.round(clamped(value, 100, 0, 100));
}

function remainingMatches(value: unknown) {
  return Math.trunc(clamped(value, 0, 0, 100));
}

function normalizedStatusKey(value: unknown) {
  return typeof value === 'string'
    ? value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('pt-BR')
    : '';
}

export function normalizePlayerStatus(
  value: unknown,
  injuryMatches = 0,
  suspensionMatches = 0,
): PlayerStatus {
  if (remainingMatches(injuryMatches) > 0) return 'Lesionado';
  if (remainingMatches(suspensionMatches) > 0) return 'Suspenso';
  const aliases: Record<string, PlayerStatus> = {
    disponivel: 'Disponível',
    available: 'Disponível',
    lesionado: 'Lesionado',
    injured: 'Lesionado',
    suspenso: 'Suspenso',
    suspended: 'Suspenso',
    cansado: 'Cansado',
    tired: 'Cansado',
  };
  return aliases[normalizedStatusKey(value)] ?? 'Disponível';
}

function nonNegativeStat(value: unknown, maximum = 1_000_000) {
  return Math.trunc(clamped(value, 0, 0, maximum));
}

function statsRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizePlayerCareerStats(value: unknown): PlayerCareerStats | undefined {
  const record = statsRecord(value);
  if (!record) return undefined;
  return {
    appearances: nonNegativeStat(record.appearances, 10_000),
    starts: nonNegativeStat(record.starts, 10_000),
    minutes: nonNegativeStat(record.minutes, 1_000_000),
    goals: nonNegativeStat(record.goals, 100_000),
    assists: nonNegativeStat(record.assists, 100_000),
    yellowCards: nonNegativeStat(record.yellowCards, 100_000),
    redCards: nonNegativeStat(record.redCards, 100_000),
    injuries: nonNegativeStat(record.injuries, 100_000),
  };
}

export function normalizePlayerSeasonStats(value: unknown): PlayerSeasonStats | undefined {
  const record = statsRecord(value);
  const stats = normalizePlayerCareerStats(record);
  if (!record || !stats) return undefined;
  return {
    seasonNumber: Math.trunc(clamped(record.seasonNumber, 1, 1, 10_000)),
    ...stats,
  };
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function fallbackRoster(clubId: string) {
  if (clubId === 'AUR') return demoPlayers;
  return demoPlayers.map((player) => ({ ...player, isStar: false }));
}

export function normalizeCatalogPlayer(value: unknown): Player | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.active === false) return null;
  const id = text(record.id);
  const name = text(record.name);
  if (!id || !name) return null;
  const positionValue = text(record.position).toUpperCase() as PlayerPosition;
  const rawOverall = numeric(record.overall, Number.NaN);
  const rawAge = numeric(record.age, Number.NaN);
  if (!positions.includes(positionValue) || !Number.isFinite(rawOverall) || !Number.isFinite(rawAge)) return null;
  const position = positionValue;
  const internalOverall = clamped(rawOverall, 1, 1, 20);
  const rawAttributes = record.attributes && typeof record.attributes === 'object'
    ? record.attributes as Record<string, unknown>
    : {};
  const unknownAttributes = attributeKeys.filter((key) => !Number.isFinite(numeric(rawAttributes[key], Number.NaN)));
  const attributes = Object.fromEntries(attributeKeys.map((key) => {
    const rawAttribute = numeric(rawAttributes[key], Number.NaN);
    return [key, Number.isFinite(rawAttribute)
      ? clamped(rawAttribute / 2, 1, 1, 10)
      : 0];
  })) as Record<AttributeKey, number>;
  const marketValue = Math.max(0, numeric(record.marketValue ?? record.value, 0));
  const rawShirtNumber = numeric(record.shirtNumber ?? record.number, Number.NaN);
  const condition = normalizePlayerCondition(record.condition);
  const injuryMatches = remainingMatches(record.injuryMatches);
  const suspensionMatches = remainingMatches(record.suspensionMatches);
  const moraleValue = text(record.morale) as Morale;
  const moraleScore = normalizeMoraleScore(record.moraleScore);
  const footValue = text(record.foot);
  const names = name.split(/\s+/);
  const contractRecord = statsRecord(record.contract);
  const rawContractStatus = text(contractRecord?.status, record.academy === true ? 'academy' : 'active') as CareerContractStatus;
  const contractStatus = careerContractStatuses.includes(rawContractStatus) ? rawContractStatus : 'active';
  const trainingRecord = statsRecord(record.training);
  const rawTrainingFocus = text(trainingRecord?.focus, 'balanced') as CareerTrainingFocus;
  const rawTrainingIntensity = text(trainingRecord?.intensity, 'normal') as CareerTrainingIntensity;
  const rawCareerStage = text(record.careerStage, record.academy === true ? 'academy' : 'senior') as CareerStage;
  const careerStage = careerStages.includes(rawCareerStage) ? rawCareerStage : 'senior';
  const academy = record.academy === true || record.youth === true || careerStage === 'academy';
  const contract = contractRecord ? {
    clubId: text(contractRecord.clubId ?? record.clubId) || null,
    startSeason: contractRecord.startSeason === null || contractRecord.startSeason === undefined ? null : Math.trunc(clamped(contractRecord.startSeason, 1, 1, 10_000)),
    endSeason: contractRecord.endSeason === null || contractRecord.endSeason === undefined ? null : Math.trunc(clamped(contractRecord.endSeason, 1, 1, 10_000)),
    wage: Math.max(0, numeric(contractRecord.wage ?? record.wage, 0)),
    status: contractStatus,
    renewalCount: Math.trunc(clamped(contractRecord.renewalCount, 0, 0, 1_000)),
  } : undefined;
  const training = trainingRecord ? {
    playerId: id,
    focus: trainingFocuses.includes(rawTrainingFocus) ? rawTrainingFocus : 'balanced',
    intensity: trainingIntensities.includes(rawTrainingIntensity) ? rawTrainingIntensity : 'normal',
    active: trainingRecord.active !== false,
  } : undefined;
  const catalogUnknownFields: Player['catalogUnknownFields'] = [];
  if (!Number.isFinite(rawShirtNumber)) catalogUnknownFields.push('shirtNumber');
  if (record.condition === null || record.condition === undefined || record.condition === '') catalogUnknownFields.push('condition');
  if (unknownAttributes.length > 0) catalogUnknownFields.push('attributes');
  if (footValue !== 'Direito' && footValue !== 'Esquerdo') catalogUnknownFields.push('foot');
  if (!morales.includes(moraleValue) && moraleScore === undefined) catalogUnknownFields.push('morale');
  if (!contractRecord) catalogUnknownFields.push('contract');
  if (!Number.isFinite(numeric(record.potential, Number.NaN))) catalogUnknownFields.push('potential');
  if (!Number.isFinite(numeric(record.worldStar, Number.NaN))) catalogUnknownFields.push('worldStar');

  return {
    id,
    name,
    shortName: text(record.shortName, names.at(-1) ?? name),
    isStar: record.isStar === true,
    number: Number.isFinite(rawShirtNumber) ? Math.round(clamped(rawShirtNumber, 0, 0, 99)) : 0,
    position,
    role: text(record.role, position),
    age: Math.round(clamped(rawAge, 14, 14, 60)),
    nationality: text(record.nationality, 'Não informada'),
    value: marketValue,
    wage: Math.max(0, numeric(record.wage ?? contract?.wage, 0)),
    condition,
    morale: morales.includes(moraleValue)
      ? moraleValue
      : moraleScore === undefined ? 'Não informada' : moraleLabelForScore(moraleScore),
    moraleScore,
    status: normalizePlayerStatus(record.status, injuryMatches, suspensionMatches),
    injuryMatches,
    suspensionMatches,
    seasonStats: normalizePlayerSeasonStats(record.seasonStats),
    careerStats: normalizePlayerCareerStats(record.careerStats),
    clubId: text(record.clubId ?? contract?.clubId) || null,
    overall: internalOverall,
    potential: Number.isFinite(numeric(record.potential, Number.NaN))
      ? clamped(record.potential, internalOverall, 1, 20)
      : undefined,
    academy,
    youth: academy,
    retired: record.retired === true || careerStage === 'retired',
    careerStage,
    ...(contract ? { contract } : {}),
    ...(training ? { training } : {}),
    generatedSeason: record.generatedSeason === undefined ? undefined : Math.trunc(clamped(record.generatedSeason, 1, 1, 10_000)),
    promotedSeason: record.promotedSeason === undefined ? undefined : Math.trunc(clamped(record.promotedSeason, 1, 1, 10_000)),
    foot: footValue === 'Esquerdo' ? 'Esquerdo' : footValue === 'Direito' ? 'Direito' : 'Não informado',
    personality: text(record.personality, 'Não informada'),
    worldStar: Number.isFinite(numeric(record.worldStar, Number.NaN))
      ? clamped(record.worldStar, 1, 1, 10)
      : undefined,
    attributes,
    ...(catalogUnknownFields.length ? { catalogUnknownFields } : {}),
    ...(unknownAttributes.length ? { catalogUnknownAttributes: unknownAttributes } : {}),
    avatarImageUrl: typeof record.avatarImageUrl === 'string' ? record.avatarImageUrl : null,
  };
}

function normalizeResponse(payload: unknown) {
  const response = payload && typeof payload === 'object' ? payload as PlayerCatalogResponse : {};
  const records = Array.isArray(payload) ? payload : Array.isArray(response.players) ? response.players : [];
  const seen = new Set<string>();
  const players = records.flatMap((record) => {
    const player = normalizeCatalogPlayer(record);
    if (!player || seen.has(player.id)) return [];
    seen.add(player.id);
    return [player];
  });
  if (records.length > 0 && players.length === 0) {
    throw new Error('O catálogo retornou jogadores sem os campos obrigatórios de identidade, posição, idade ou overall.');
  }
  return { players, source: typeof response.source === 'string' ? response.source : 'firestore' };
}

export function usePlayerCatalog(club: ClubChoice, roomCode?: string | null) {
  const auth = useAuth();
  const fallback = useMemo(() => fallbackRoster(club.id), [club.id]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<PlayerCatalogState>(() => ({
    clubId: club.id,
    players: [],
    source: auth.status === 'loading' ? 'loading' : 'unavailable',
    loading: auth.status === 'loading' || auth.status === 'authenticated',
    error: null,
  }));

  useEffect(() => {
    if (auth.status !== 'authenticated' || !auth.identity) {
      setState({
        clubId: club.id,
        players: [],
        source: auth.status === 'loading' ? 'loading' : 'unavailable',
        loading: auth.status === 'loading',
        error: null,
      });
      return;
    }
    if (!club.id.trim()) {
      setState({ clubId: '', players: [], source: 'unavailable', loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams();
    if (roomCode?.trim()) query.set('roomCode', roomCode.trim());
    const queryString = query.toString();
    setState({ clubId: club.id, players: [], source: 'loading', loading: true, error: null });
    void apiRequest<PlayerCatalogResponse>(
      `/api/teams/${encodeURIComponent(club.id)}/players${queryString ? `?${queryString}` : ''}`,
      { identity: auth.identity, getIdToken: auth.getIdToken },
      { signal: controller.signal },
    ).then((payload) => {
      if (controller.signal.aborted) return;
      const normalized = normalizeResponse(payload);
      const fallbackAllowed = auth.identity?.mode === 'demo';
      setState({
        clubId: club.id,
        players: normalized.players.length ? normalized.players : fallbackAllowed ? fallback : [],
        source: normalized.players.length ? normalized.source : fallbackAllowed ? 'fallback' : normalized.source,
        loading: false,
        error: null,
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({
        clubId: club.id,
        players: auth.identity?.mode === 'demo' ? fallback : [],
        source: auth.identity?.mode === 'demo' ? 'fallback' : 'unavailable',
        loading: false,
        error: error instanceof Error ? error.message : 'O elenco do servidor está indisponível.',
      });
    });
    return () => controller.abort();
  }, [auth.getIdToken, auth.identity, auth.status, club.id, fallback, refreshToken, roomCode]);

  const refresh = useCallback(() => setRefreshToken((current) => current + 1), []);
  const current = state.clubId === club.id ? state : {
    clubId: club.id,
    players: [],
    source: auth.status === 'loading' || auth.status === 'authenticated' ? 'loading' : 'unavailable',
    loading: auth.status === 'loading' || auth.status === 'authenticated',
    error: null,
  };

  return useMemo(() => ({ ...current, refresh }), [current, refresh]);
}
