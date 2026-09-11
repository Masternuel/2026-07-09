import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  apiBinaryUpload,
  apiBlobDownload,
  apiRequest,
  apiUpload,
  type ApiBlobDownload,
  type ApiCredentials,
} from '../lib/apiClient';
import type {
  EditorCatalog,
  EditorCatalogCounts,
  EditorClub,
  EditorEntity,
  EditorLeague,
  EditorPlayer,
  EditorPlayerAttributes,
  EditorRecord,
  EditorTournament,
  PlayerPosition,
  TournamentFormat,
  TournamentLegs,
  TournamentTiebreaker,
} from '../types';
import { calculatePlayerOverall } from '../utils/playerRating';
import { completeCatalogImportOperation, getCatalogImportOperation } from '../lib/catalogImportOperation';
import { isBrazilianCountry, normalizeBrazilianState, normalizeNationality } from '../utils/editorGeography';

type EditorAccessState = 'checking' | 'granted' | 'denied' | 'error';

interface EditorAccessResponse {
  canEdit?: boolean;
  reason?: string;
}

interface EditorCatalogResponse extends Partial<EditorCatalog> {
  meta?: Partial<Record<EditorEntity, EditorPageMetaResponse>>;
}

interface EditorPageMetaResponse {
  count?: number | null;
  returned?: number;
  limit?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
  filters?: { query?: string | null; clubId?: string | null };
}

interface EditorPageResponse extends EditorPageMetaResponse {
  entity?: EditorEntity;
  records?: unknown[];
}

export interface EditorPageMeta {
  count: number;
  returned: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
  filters: { query: string | null; clubId: string | null };
}

export interface EditorPageFilters {
  query?: string | null;
  clubId?: string | null;
}

interface EditorMutationResponse {
  record?: EditorRecord;
}

export interface EditorBulkDeleteResult {
  deleted: true;
  ids: string[];
  count: number;
  mediaRemoved: boolean;
  removedMediaCount: number;
  failedMediaCount: number;
}

interface EditorMediaResponse extends EditorMutationResponse {
  media?: {
    entity: string;
    recordId: string;
    kind: string;
    url: string;
    path: string;
    mimeType: string;
    size: number;
  };
}

export interface EditorDatabaseImportSummary {
  mode: 'merge';
  imported: true;
  counts: EditorCatalogCounts;
  total: number;
  revision: number;
  mediaRemoved: boolean;
  removedMediaCount: number;
}

const emptyCatalog: EditorCatalog = { leagues: [], clubs: [], players: [], tournaments: [] };
const playerPositions: PlayerPosition[] = ['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MEI', 'PD', 'PE', 'ATA'];
const attributeKeys: Array<keyof EditorPlayerAttributes> = [
  'velocidade', 'chute', 'drible', 'nocao', 'defesa', 'passe', 'peBom', 'peRuim',
  'forca', 'resistencia', 'impulsao', 'reflexos', 'posicionamentoGol', 'saidaGol', 'penaltis',
];
const tournamentFormats: TournamentFormat[] = ['league', 'knockout', 'groups_knockout'];
const tournamentLegs: TournamentLegs[] = ['single', 'double'];
const tournamentTiebreakers: TournamentTiebreaker[] = [
  'goal_difference', 'goals_scored', 'wins', 'head_to_head', 'fair_play', 'away_goals', 'extra_time', 'penalties', 'drawing_lots',
];
const pageLimit = 50;
const emptyPageMeta = (): EditorPageMeta => ({
  count: 0,
  returned: 0,
  limit: pageLimit,
  nextCursor: null,
  hasMore: false,
  filters: { query: null, clubId: null },
});
const emptyPages = (): Record<EditorEntity, EditorPageMeta> => ({
  leagues: emptyPageMeta(), clubs: emptyPageMeta(), players: emptyPageMeta(), tournaments: emptyPageMeta(),
});
const emptyPageLoading = (): Record<EditorEntity, boolean> => ({ leagues: false, clubs: false, players: false, tournaments: false });

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown, fallback: number, minimum?: number, maximum?: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum ?? parsed, Math.max(minimum ?? parsed, parsed));
}

function timestamps(value: Record<string, unknown>) {
  return {
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  };
}

function normalizeRecord(entity: EditorEntity, value: unknown): EditorRecord {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const base = {
    id: text(record.id),
    name: text(record.name),
    active: record.active !== false,
    ...timestamps(record),
  };
  if (entity === 'leagues') {
    return {
      ...base,
      country: text(record.country, 'Brasil'),
      level: number(record.level, 1, 1, 20),
      division: text(record.division),
      legs: tournamentLegs.includes(record.legs as TournamentLegs) ? record.legs as TournamentLegs : 'double',
    } satisfies EditorLeague;
  }
  if (entity === 'clubs') {
    const colors = Array.isArray(record.colors)
      ? record.colors.filter((color): color is string => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
      : [];
    const country = text(record.country, 'Brasil');
    return {
      ...base,
      abbreviation: text(record.abbreviation, base.id.slice(0, 3).toUpperCase()),
      colors: colors.length ? colors : ['#c8ff3d'],
      darkThemeColor: typeof record.darkThemeColor === 'string' && /^#[0-9a-f]{6}$/i.test(record.darkThemeColor)
        ? record.darkThemeColor
        : null,
      lightThemeColor: typeof record.lightThemeColor === 'string' && /^#[0-9a-f]{6}$/i.test(record.lightThemeColor)
        ? record.lightThemeColor
        : null,
      stadium: text(record.stadium, 'A definir'),
      stadiumCapacity: number(record.stadiumCapacity, 0, 0, 500_000),
      reputation: number(record.reputation, 10, 1, 20),
      division: text(record.division),
      country,
      state: isBrazilianCountry(country)
        ? normalizeBrazilianState(record.state)
        : typeof record.state === 'string' ? record.state : null,
      city: typeof record.city === 'string' ? record.city : null,
      leagueId: typeof record.leagueId === 'string' ? record.leagueId : null,
      budget: number(record.budget, 0, 0, 2_000_000_000),
      crestImageUrl: typeof record.crestImageUrl === 'string' ? record.crestImageUrl : null,
      crestImagePath: typeof record.crestImagePath === 'string' ? record.crestImagePath : null,
    } satisfies EditorClub;
  }
  if (entity === 'tournaments') {
    const format = text(record.format) as TournamentFormat;
    const legs = text(record.legs) as TournamentLegs;
    const teamIds = Array.isArray(record.teamIds)
      ? record.teamIds.filter((id): id is string => typeof id === 'string')
      : [];
    const tiebreakers = Array.isArray(record.tiebreakers)
      ? record.tiebreakers.filter((item): item is TournamentTiebreaker => tournamentTiebreakers.includes(item as TournamentTiebreaker))
      : [];
    return {
      ...base,
      format: tournamentFormats.includes(format) ? format : 'league',
      teamCount: number(record.teamCount, 2, 2, 256),
      legs: tournamentLegs.includes(legs) ? legs : 'single',
      tiebreakers: tiebreakers.length ? tiebreakers : ['goal_difference', 'goals_scored', 'head_to_head'],
      teamIds: Array.from(new Set(teamIds)),
      trophyImageUrl: typeof record.trophyImageUrl === 'string' ? record.trophyImageUrl : null,
      trophyImagePath: typeof record.trophyImagePath === 'string' ? record.trophyImagePath : null,
    } satisfies EditorTournament;
  }
  const rawAttributes = record.attributes && typeof record.attributes === 'object'
    ? record.attributes as Record<string, unknown>
    : {};
  const attributes = Object.fromEntries(attributeKeys.map((key) => [
    key,
    number(rawAttributes[key], key === 'peRuim' ? 6 : 10, 1, 20),
  ])) as unknown as EditorPlayerAttributes;
  const position = text(record.position).toUpperCase();
  const normalizedPlayer = {
    ...base,
    clubId: text(record.clubId),
    isStar: record.isStar === true,
    position: playerPositions.includes(position as PlayerPosition) ? position as PlayerPosition : 'MC',
    age: number(record.age, 24, 14, 60),
    nationality: normalizeNationality(record.nationality),
    shirtNumber: number(record.shirtNumber, 0, 0, 99),
    overall: 10,
    attributes,
    avatarImageUrl: typeof record.avatarImageUrl === 'string' ? record.avatarImageUrl : null,
    avatarImagePath: typeof record.avatarImagePath === 'string' ? record.avatarImagePath : null,
  } satisfies EditorPlayer;
  return {
    ...normalizedPlayer,
    overall: calculatePlayerOverall(normalizedPlayer),
  } satisfies EditorPlayer;
}

export function mutationPayload(entity: EditorEntity, input: EditorRecord, includeId: boolean): Record<string, unknown> {
  const record = normalizeRecord(entity, input);
  const id = includeId ? { id: record.id } : {};
  if (entity === 'leagues') {
    const league = record as EditorLeague;
    return { ...id, name: league.name, country: league.country, level: league.level, division: league.division, active: league.active };
  }
  if (entity === 'clubs') {
    const club = record as EditorClub;
    return {
      ...id,
      name: club.name,
      abbreviation: club.abbreviation,
      colors: club.colors,
      darkThemeColor: club.darkThemeColor,
      lightThemeColor: club.lightThemeColor,
      stadium: club.stadium,
      stadiumCapacity: club.stadiumCapacity,
      reputation: club.reputation,
      division: club.division,
      country: club.country,
      state: club.state,
      city: club.city,
      leagueId: club.leagueId,
      budget: club.budget,
      crestImageUrl: club.crestImageUrl,
      crestImagePath: club.crestImagePath,
      active: club.active,
    };
  }
  if (entity === 'tournaments') {
    const tournament = record as EditorTournament;
    return {
      ...id,
      name: tournament.name,
      format: tournament.format,
      teamCount: tournament.teamCount,
      legs: tournament.legs,
      tiebreakers: tournament.tiebreakers,
      teamIds: tournament.teamIds,
      trophyImageUrl: tournament.trophyImageUrl,
      trophyImagePath: tournament.trophyImagePath,
      active: tournament.active,
    };
  }
  const player = record as EditorPlayer;
  return {
    ...id,
    clubId: player.clubId,
    name: player.name,
    isStar: player.isStar,
    position: player.position,
    age: player.age,
    nationality: player.nationality,
    shirtNumber: player.shirtNumber,
    overall: calculatePlayerOverall(player),
    attributes: player.attributes,
    avatarImageUrl: player.avatarImageUrl,
    avatarImagePath: player.avatarImagePath,
    active: player.active,
  };
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof DOMException && error.name === 'AbortError') return null;
  return 'Não foi possível acessar sua base de dados.';
}

function normalizeCatalog(payload: EditorCatalogResponse): EditorCatalog {
  return {
    leagues: Array.isArray(payload.leagues) ? payload.leagues.map((record) => normalizeRecord('leagues', record) as EditorLeague) : [],
    clubs: Array.isArray(payload.clubs) ? payload.clubs.map((record) => normalizeRecord('clubs', record) as EditorClub) : [],
    players: Array.isArray(payload.players) ? payload.players.map((record) => normalizeRecord('players', record) as EditorPlayer) : [],
    tournaments: Array.isArray(payload.tournaments) ? payload.tournaments.map((record) => normalizeRecord('tournaments', record) as EditorTournament) : [],
  };
}

function normalizePageMeta(value: EditorPageMetaResponse | undefined, fallbackCount: number): EditorPageMeta {
  const count = typeof value?.count === 'number' && Number.isFinite(value.count) ? value.count : fallbackCount;
  return {
    count,
    returned: typeof value?.returned === 'number' ? value.returned : fallbackCount,
    limit: typeof value?.limit === 'number' ? value.limit : pageLimit,
    nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
    hasMore: value?.hasMore === true,
    filters: {
      query: typeof value?.filters?.query === 'string' ? value.filters.query : null,
      clubId: typeof value?.filters?.clubId === 'string' ? value.filters.clubId : null,
    },
  };
}

function sameFilters(left: EditorPageMeta['filters'], right: EditorPageFilters) {
  return left.query === (right.query?.trim() || null) && left.clubId === (right.clubId?.trim() || null);
}

export function useEditorCatalog(credentials: ApiCredentials) {
  const [access, setAccess] = useState<EditorAccessState>('checking');
  const [accessReason, setAccessReason] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<EditorCatalog>(emptyCatalog);
  const [pages, setPages] = useState<Record<EditorEntity, EditorPageMeta>>(emptyPages);
  const [totals, setTotals] = useState<EditorCatalogCounts>({ leagues: 0, clubs: 0, players: 0, tournaments: 0 });
  const [pageLoading, setPageLoading] = useState<Record<EditorEntity, boolean>>(emptyPageLoading);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [databaseAction, setDatabaseAction] = useState<'exporting' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const mountedRef = useRef(true);
  const pageRequestsRef = useRef<Record<EditorEntity, number>>({ leagues: 0, clubs: 0, players: 0, tournaments: 0 });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadCatalog = useCallback(async (signal?: AbortSignal, propagateError = false) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest<EditorCatalogResponse>(
        `/api/editor/catalog?limit=${pageLimit}`,
        credentials,
        { signal, timeoutMs: 60_000 },
      );
      if (!mountedRef.current || signal?.aborted) return;
      const normalized = normalizeCatalog(payload);
      setCatalog(normalized);
      const nextPages = {
        leagues: normalizePageMeta(payload.meta?.leagues, normalized.leagues.length),
        clubs: normalizePageMeta(payload.meta?.clubs, normalized.clubs.length),
        players: normalizePageMeta(payload.meta?.players, normalized.players.length),
        tournaments: normalizePageMeta(payload.meta?.tournaments, normalized.tournaments.length),
      };
      setPages(nextPages);
      setTotals({
        leagues: nextPages.leagues.count,
        clubs: nextPages.clubs.count,
        players: nextPages.players.count,
        tournaments: nextPages.tournaments.count,
      });
      setLastSyncedAt(new Date());
    } catch (nextError) {
      if (propagateError) throw nextError;
      if (!mountedRef.current || signal?.aborted) return;
      const message = errorMessage(nextError);
      if (message) setError(message);
      if (nextError instanceof ApiError && nextError.status === 403) {
        setAccess('denied');
        setAccessReason(nextError.message);
      }
    } finally {
      if (mountedRef.current && !signal?.aborted) setLoading(false);
    }
  }, [credentials]);

  useEffect(() => {
    const controller = new AbortController();
    setAccess('checking');
    setAccessReason(null);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const payload = await apiRequest<EditorAccessResponse>('/api/editor/access', credentials, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!payload.canEdit) {
          setAccess('denied');
          setAccessReason(payload.reason ?? 'Sua conta não possui acesso ao Editor da Base.');
          setLoading(false);
          return;
        }
        setAccess('granted');
        await loadCatalog(controller.signal);
      } catch (nextError) {
        if (controller.signal.aborted) return;
        const message = errorMessage(nextError);
        if (nextError instanceof ApiError && nextError.status === 403) {
          setAccess('denied');
          setAccessReason(nextError.message);
        } else {
          setAccess('error');
          if (message) setError(message);
        }
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [accessAttempt, credentials, loadCatalog]);

  const refresh = useCallback(() => loadCatalog(), [loadCatalog]);
  const retryAccess = useCallback(() => setAccessAttempt((attempt) => attempt + 1), []);

  const loadPage = useCallback(async (entity: EditorEntity, filters: EditorPageFilters = {}, append = false) => {
    const currentPage = pages[entity];
    const normalizedFilters = { query: filters.query?.trim() || null, clubId: filters.clubId?.trim() || null };
    const canAppend = append && sameFilters(currentPage.filters, normalizedFilters) && currentPage.hasMore && currentPage.nextCursor;
    if (append && !canAppend) return;
    const requestId = pageRequestsRef.current[entity] + 1;
    pageRequestsRef.current[entity] = requestId;
    setPageLoading((current) => ({ ...current, [entity]: true }));
    setError(null);
    try {
      const query = new URLSearchParams({ limit: String(pageLimit) });
      if (normalizedFilters.query) query.set('query', normalizedFilters.query);
      if (normalizedFilters.clubId && entity === 'players') query.set('clubId', normalizedFilters.clubId);
      if (canAppend) query.set('cursor', currentPage.nextCursor as string);
      const payload = await apiRequest<EditorPageResponse>(`/api/editor/${entity}?${query}`, credentials);
      if (!mountedRef.current || pageRequestsRef.current[entity] !== requestId) return;
      const records = Array.isArray(payload.records) ? payload.records.map((record) => normalizeRecord(entity, record)) : [];
      setCatalog((current) => {
        const previous = canAppend ? current[entity] as EditorRecord[] : [];
        const next = [...previous];
        const known = new Map(next.map((record, index) => [record.id, index]));
        records.forEach((record) => {
          const index = known.get(record.id);
          if (typeof index === 'number') next[index] = record;
          else { known.set(record.id, next.length); next.push(record); }
        });
        return { ...current, [entity]: next } as EditorCatalog;
      });
      setPages((current) => ({
        ...current,
        [entity]: normalizePageMeta(payload, canAppend ? current[entity].count : records.length),
      }));
      setLastSyncedAt(new Date());
    } catch (nextError) {
      if (!mountedRef.current || pageRequestsRef.current[entity] !== requestId) return;
      const message = errorMessage(nextError);
      if (message) setError(message);
      throw nextError;
    } finally {
      if (mountedRef.current && pageRequestsRef.current[entity] === requestId) {
        setPageLoading((current) => ({ ...current, [entity]: false }));
      }
    }
  }, [credentials, pages]);

  const search = useCallback((entity: EditorEntity, filters: EditorPageFilters = {}) => loadPage(entity, filters, false), [loadPage]);
  const loadMore = useCallback((entity: EditorEntity) => loadPage(entity, pages[entity].filters, true), [loadPage, pages]);

  const applyRecord = useCallback((entity: EditorEntity, record: EditorRecord) => {
    setCatalog((current) => {
      const records = current[entity] as EditorRecord[];
      const exists = records.some((candidate) => candidate.id === record.id);
      const next = exists
        ? records.map((candidate) => candidate.id === record.id ? record : candidate)
        : [record, ...records];
      return { ...current, [entity]: next } as EditorCatalog;
    });
    setLastSyncedAt(new Date());
  }, []);

  const createRecord = useCallback(async (entity: EditorEntity, record: EditorRecord) => {
    setPending(true);
    setError(null);
    try {
      const payload = await apiRequest<EditorMutationResponse>(`/api/editor/${entity}`, credentials, {
        method: 'POST',
        body: mutationPayload(entity, record, true),
      });
      if (!payload.record) throw new ApiError('O servidor não devolveu o registro criado.', 'EDITOR_RECORD_MISSING');
      const normalizedRecord = normalizeRecord(entity, payload.record);
      applyRecord(entity, normalizedRecord);
      setPages((current) => ({ ...current, [entity]: { ...current[entity], count: current[entity].count + 1, returned: current[entity].returned + 1 } }));
      setTotals((current) => ({ ...current, [entity]: current[entity] + 1 }));
      return normalizedRecord;
    } catch (nextError) {
      const message = errorMessage(nextError);
      if (message) setError(message);
      throw nextError;
    } finally {
      setPending(false);
    }
  }, [applyRecord, credentials]);

  const updateRecord = useCallback(async (entity: EditorEntity, record: EditorRecord) => {
    setPending(true);
    setError(null);
    const { id } = record;
    try {
      const payload = await apiRequest<EditorMutationResponse>(`/api/editor/${entity}/${encodeURIComponent(id)}`, credentials, {
        method: 'PATCH',
        body: mutationPayload(entity, record, false),
      });
      if (!payload.record) throw new ApiError('O servidor não devolveu o registro atualizado.', 'EDITOR_RECORD_MISSING');
      const normalizedRecord = normalizeRecord(entity, payload.record);
      applyRecord(entity, normalizedRecord);
      return normalizedRecord;
    } catch (nextError) {
      const message = errorMessage(nextError);
      if (message) setError(message);
      throw nextError;
    } finally {
      setPending(false);
    }
  }, [applyRecord, credentials]);

  const deleteRecord = useCallback(async (entity: EditorEntity, id: string) => {
    setPending(true);
    setError(null);
    try {
      await apiRequest<{ deleted?: boolean; id?: string }>(`/api/editor/${entity}/${encodeURIComponent(id)}`, credentials, {
        method: 'DELETE',
      });
      setCatalog((current) => ({
        ...current,
        [entity]: current[entity].filter((record) => record.id !== id),
      }));
      setPages((current) => ({ ...current, [entity]: { ...current[entity], count: Math.max(0, current[entity].count - 1), returned: Math.max(0, current[entity].returned - 1) } }));
      setTotals((current) => ({ ...current, [entity]: Math.max(0, current[entity] - 1) }));
      setLastSyncedAt(new Date());
    } catch (nextError) {
      const message = errorMessage(nextError);
      if (message) setError(message);
      throw nextError;
    } finally {
      setPending(false);
    }
  }, [credentials]);

  const deleteRecords = useCallback(async (entity: EditorEntity, ids: string[]) => {
    setPending(true);
    setError(null);
    try {
      const payload = await apiRequest<EditorBulkDeleteResult>(
        `/api/editor/${entity}/bulk-delete`,
        credentials,
        { method: 'POST', body: { ids } },
      );
      const deletedIds = new Set(payload.ids);
      setCatalog((current) => ({
        ...current,
        [entity]: current[entity].filter((record) => !deletedIds.has(record.id)),
      }));
      setPages((current) => ({
        ...current,
        [entity]: {
          ...current[entity],
          count: Math.max(0, current[entity].count - payload.count),
          returned: Math.max(0, current[entity].returned - payload.count),
          nextCursor: null,
          hasMore: false,
        },
      }));
      setTotals((current) => ({
        ...current,
        [entity]: Math.max(0, current[entity] - payload.count),
      }));
      setLastSyncedAt(new Date());
      void loadPage(entity, pages[entity].filters, false).catch(() => {});
      return payload;
    } catch (nextError) {
      const message = errorMessage(nextError);
      if (message) setError(message);
      throw nextError;
    } finally {
      setPending(false);
    }
  }, [credentials, loadPage, pages]);

  const uploadMedia = useCallback(async (
    entity: Exclude<EditorEntity, 'leagues'>,
    id: string,
    file: File,
    onProgress?: (progress: number) => void,
  ) => {
    const kind = entity === 'clubs' ? 'crest' : entity === 'players' ? 'avatar' : 'trophy';
    setPending(true);
    setError(null);
    try {
      const query = new URLSearchParams({ entity, id, kind });
      const payload = await apiUpload<EditorMediaResponse>(`/api/editor/media?${query}`, credentials, file, onProgress);
      if (!payload.record) throw new ApiError('O servidor não devolveu o registro com a imagem.', 'EDITOR_RECORD_MISSING');
      const normalizedRecord = normalizeRecord(entity, payload.record);
      applyRecord(entity, normalizedRecord);
      return normalizedRecord;
    } catch (nextError) {
      const message = errorMessage(nextError);
      if (message) setError(message);
      throw nextError;
    } finally {
      setPending(false);
    }
  }, [applyRecord, credentials]);

  const removeMedia = useCallback(async (entity: Exclude<EditorEntity, 'leagues'>, id: string) => {
    const kind = entity === 'clubs' ? 'crest' : entity === 'players' ? 'avatar' : 'trophy';
    setPending(true);
    setError(null);
    try {
      const query = new URLSearchParams({ entity, id, kind });
      const payload = await apiRequest<EditorMutationResponse>(`/api/editor/media?${query}`, credentials, { method: 'DELETE' });
      if (!payload.record) throw new ApiError('O servidor não devolveu o registro sem a imagem.', 'EDITOR_RECORD_MISSING');
      const normalizedRecord = normalizeRecord(entity, payload.record);
      applyRecord(entity, normalizedRecord);
      return normalizedRecord;
    } catch (nextError) {
      const message = errorMessage(nextError);
      if (message) setError(message);
      throw nextError;
    } finally {
      setPending(false);
    }
  }, [applyRecord, credentials]);

  const exportDatabase = useCallback(async (): Promise<ApiBlobDownload> => {
    setDatabaseAction('exporting');
    setError(null);
    try {
      return await apiBlobDownload('/api/editor/database/export', credentials);
    } catch (nextError) {
      const message = errorMessage(nextError);
      if (message) setError(message);
      throw nextError;
    } finally {
      setDatabaseAction(null);
    }
  }, [credentials]);

  const importDatabase = useCallback(async (
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<EditorDatabaseImportSummary> => {
    setDatabaseAction('importing');
    setError(null);
    try {
      const operation = await getCatalogImportOperation(credentials.identity.uid, file);
      const payload = await apiBinaryUpload<EditorDatabaseImportSummary>(
        `/api/editor/database/import?mode=merge&operationId=${encodeURIComponent(operation.operationId)}`,
        credentials,
        file,
        {
          method: 'POST',
          contentType: 'application/octet-stream',
          onProgress,
          networkErrorCode: 'EDITOR_DATABASE_IMPORT_NETWORK_ERROR',
        },
      );
      await loadCatalog(undefined, true);
      completeCatalogImportOperation(operation);
      return payload;
    } catch (nextError) {
      const message = errorMessage(nextError);
      if (message) setError(message);
      throw nextError;
    } finally {
      setDatabaseAction(null);
    }
  }, [credentials, loadCatalog]);

  const counts = useMemo<EditorCatalogCounts>(() => totals, [totals]);

  return {
    access,
    accessReason,
    catalog,
    counts,
    pages,
    pageLoading,
    loading,
    pending,
    databaseAction,
    error,
    lastSyncedAt,
    refresh,
    loadPage,
    search,
    loadMore,
    retryAccess,
    createRecord,
    updateRecord,
    deleteRecord,
    deleteRecords,
    uploadMedia,
    removeMedia,
    exportDatabase,
    importDatabase,
  };
}
