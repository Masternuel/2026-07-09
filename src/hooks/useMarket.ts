import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emitSocketRequest } from '../lib/socketRequest';
import type {
  BolaSocket,
  MarketListingInput,
  MarketMutationResponse,
  MarketOfferInput,
  MarketResponseAction,
  MarketSnapshot,
  MarketUpdatedEvent,
  Room,
} from '../types';

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function errorMessage(error: unknown, fallback = 'O mercado não conseguiu concluir esta ação.') {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function stableIntentValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map(stableIntentValue).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableIntentValue(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeSnapshot(value: unknown): MarketSnapshot | null {
  const record = objectRecord(value);
  const finance = objectRecord(record?.finance);
  if (!record || !finance) return null;
  const revision = Number(record.revision);
  const balance = Number(finance.balance);
  const committed = Number(finance.committed);
  const available = Number(finance.available);
  if (![revision, balance, committed, available].every(Number.isFinite)) return null;

  const collection = <T,>(candidate: unknown): T[] => (
    Array.isArray(candidate)
      ? candidate.filter((item): item is T => Boolean(item && typeof item === 'object'))
      : []
  );

  return {
    revision,
    serverTime: typeof record.serverTime === 'string' ? record.serverTime : new Date().toISOString(),
    finance: {
      clubId: typeof finance.clubId === 'string' ? finance.clubId : '',
      balance,
      committed,
      available,
      cashAvailable: Number.isFinite(Number(finance.cashAvailable))
        ? Number(finance.cashAvailable)
        : Math.max(0, balance - committed),
      transferBudget: Number.isFinite(Number(finance.transferBudget))
        ? Number(finance.transferBudget)
        : available,
      transferAvailable: Number.isFinite(Number(finance.transferAvailable))
        ? Number(finance.transferAvailable)
        : available,
      wageBudget: Number.isFinite(Number(finance.wageBudget)) ? Number(finance.wageBudget) : 0,
      monthlyPayroll: Number.isFinite(Number(finance.monthlyPayroll)) ? Number(finance.monthlyPayroll) : 0,
      paidPlayers: Number.isFinite(Number(finance.paidPlayers)) ? Number(finance.paidPlayers) : 0,
    },
    listings: collection(record.listings),
    candidates: collection(record.candidates),
    offers: collection(record.offers),
    activeLoans: collection(record.activeLoans),
    scheduledTransfers: collection(record.scheduledTransfers),
    transactions: collection(record.transactions),
    activity: collection(record.activity),
  };
}

export interface MarketController {
  snapshot: MarketSnapshot | null;
  loading: boolean;
  syncing: boolean;
  pendingAction: string | null;
  error: string | null;
  actionError: string | null;
  refresh: () => Promise<void>;
  offer: (input: MarketOfferInput) => Promise<MarketMutationResponse>;
  respond: (offerId: string, action: MarketResponseAction, counterAmount?: number, noticeApproval?: boolean) => Promise<MarketMutationResponse>;
  list: (input: MarketListingInput) => Promise<MarketMutationResponse>;
  bid: (listingId: string, amount: number, noticeApproval?: boolean) => Promise<MarketMutationResponse>;
  cancelListing: (listingId: string) => Promise<MarketMutationResponse>;
  exerciseLoanOption: (loanId: string, noticeApproval?: boolean) => Promise<MarketMutationResponse>;
  clearActionError: () => void;
}

export function useMarket(
  room: Room | null,
  socket: BolaSocket | null,
  managerId: string,
  onRosterChanged: () => void,
  enabled = true,
): MarketController {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const roomCodeRef = useRef<string | null>(room?.code ?? null);
  const snapshotRef = useRef<MarketSnapshot | null>(snapshot);
  const rosterChangedRef = useRef(onRosterChanged);
  const requestIdsRef = useRef(new Map<string, string>());
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const syncQueuedRef = useRef(false);
  roomCodeRef.current = room?.code ?? null;
  snapshotRef.current = snapshot;
  rosterChangedRef.current = onRosterChanged;

  const syncMarket = useCallback((background = false): Promise<void> => {
    if (!enabled) {
      setLoading(false);
      setSyncing(false);
      return Promise.resolve();
    }
    const code = room?.code;
    if (!code || !socket?.connected || !managerId) {
      setLoading(false);
      setSyncing(false);
      return Promise.resolve();
    }
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return syncInFlightRef.current;
    }
    const generation = ++generationRef.current;
    if (background) setSyncing(true);
    else setLoading(true);
    setError(null);
    const request = (async () => {
      try {
        do {
          syncQueuedRef.current = false;
          const response = await emitSocketRequest<{ snapshot: MarketSnapshot }>(socket, 'market:sync', { code });
          const normalized = normalizeSnapshot(response.snapshot);
          if (!normalized) throw new Error('O servidor enviou dados inválidos do mercado.');
          if (generation !== generationRef.current || roomCodeRef.current !== code) return;
          snapshotRef.current = normalized;
          setSnapshot(normalized);
        } while (syncQueuedRef.current && socket.connected);
      } catch (nextError) {
        if (generation !== generationRef.current || roomCodeRef.current !== code) return;
        setError(errorMessage(nextError, 'Não foi possível sincronizar o mercado.'));
      } finally {
        if (generation === generationRef.current) syncInFlightRef.current = null;
        if (generation === generationRef.current && roomCodeRef.current === code) {
          setLoading(false);
          setSyncing(false);
        }
      }
    })();
    syncInFlightRef.current = request;
    return request;
  }, [enabled, managerId, room?.code, socket]);

  useEffect(() => {
    generationRef.current += 1;
    syncInFlightRef.current = null;
    syncQueuedRef.current = false;
    requestIdsRef.current.clear();
    setSnapshot(null);
    setError(null);
    setActionError(null);
    setPendingAction(null);
    if (!enabled || !room?.code || !socket?.connected || !managerId) {
      setLoading(false);
      setSyncing(false);
      return;
    }
    void syncMarket();
  }, [enabled, managerId, room?.code, socket, socket?.connected, syncMarket]);

  useEffect(() => {
    const code = room?.code;
    if (!enabled || !code || !socket || !managerId) return;
    const onUpdated = (payload: MarketUpdatedEvent) => {
      if (!payload || payload.code !== code) return;
      rosterChangedRef.current();
      if (Number(payload.revision) <= (snapshotRef.current?.revision ?? -1)) return;
      void syncMarket(true);
    };
    socket.on('market:updated', onUpdated);
    return () => {
      socket.off('market:updated', onUpdated);
    };
  }, [enabled, managerId, room?.code, socket, syncMarket]);

  const runMutation = useCallback(async (
    key: string,
    invoke: () => Promise<MarketMutationResponse>,
  ) => {
    setPendingAction(key);
    setActionError(null);
    try {
      const response = await invoke();
      const returnedSnapshot = normalizeSnapshot(response.snapshot);
      if (
        returnedSnapshot
        && roomCodeRef.current === room?.code
        && returnedSnapshot.revision >= (snapshotRef.current?.revision ?? -1)
      ) {
        snapshotRef.current = returnedSnapshot;
        setSnapshot(returnedSnapshot);
      }
      rosterChangedRef.current();
      if (!returnedSnapshot) await syncMarket(true);
      return response;
    } catch (nextError) {
      const message = errorMessage(nextError);
      setActionError(message);
      throw new Error(message);
    } finally {
      setPendingAction(null);
    }
  }, [room?.code, syncMarket]);

  const runIdempotentMutation = useCallback((
    key: string,
    payload: unknown,
    invoke: (requestId: string) => Promise<MarketMutationResponse>,
  ) => {
    const intent = `${room?.code ?? ''}:${key}:${stableIntentValue(payload)}`;
    let requestId = requestIdsRef.current.get(intent);
    if (!requestId) {
      requestId = crypto.randomUUID();
      requestIdsRef.current.set(intent, requestId);
    }
    return runMutation(key, async () => {
      const response = await invoke(requestId as string);
      requestIdsRef.current.delete(intent);
      return response;
    });
  }, [room?.code, runMutation]);

  const offer = useCallback((input: MarketOfferInput) => {
    if (!socket?.connected || !room?.code) return Promise.reject(new Error('Mercado em tempo real indisponível.'));
    const code = room.code;
    return runIdempotentMutation(`offer:${input.playerId}`, input, (requestId) => (
      emitSocketRequest<MarketMutationResponse>(socket, 'market:offer', { code, requestId, ...input })
    ));
  }, [room?.code, runIdempotentMutation, socket]);

  const respond = useCallback((offerId: string, action: MarketResponseAction, counterAmount?: number, noticeApproval = false) => {
    if (!socket?.connected || !room?.code) return Promise.reject(new Error('Mercado em tempo real indisponível.'));
    const code = room.code;
    const payload = { offerId, action, counterAmount, noticeApproval };
    return runIdempotentMutation(`respond:${offerId}`, payload, (requestId) => (
      emitSocketRequest<MarketMutationResponse>(socket, 'market:respond', {
        code,
        requestId,
        offerId,
        action,
        ...(counterAmount !== undefined ? { counterAmount } : {}),
        ...(noticeApproval ? { noticeApproval: true } : {}),
      })
    ));
  }, [room?.code, runIdempotentMutation, socket]);

  const list = useCallback((input: MarketListingInput) => {
    if (!socket?.connected || !room?.code) return Promise.reject(new Error('Mercado em tempo real indisponível.'));
    const code = room.code;
    return runIdempotentMutation(`list:${input.playerId}`, input, (requestId) => (
      emitSocketRequest<MarketMutationResponse>(socket, 'market:list', { code, requestId, ...input })
    ));
  }, [room?.code, runIdempotentMutation, socket]);

  const bid = useCallback((listingId: string, amount: number, noticeApproval = false) => {
    if (!socket?.connected || !room?.code) return Promise.reject(new Error('Mercado em tempo real indisponível.'));
    const code = room.code;
    return runIdempotentMutation(`bid:${listingId}`, { listingId, amount, noticeApproval }, (requestId) => (
      emitSocketRequest<MarketMutationResponse>(socket, 'market:bid', { code, requestId, listingId, amount, ...(noticeApproval ? { noticeApproval: true } : {}) })
    ));
  }, [room?.code, runIdempotentMutation, socket]);

  const cancelListing = useCallback((listingId: string) => {
    if (!socket?.connected || !room?.code) return Promise.reject(new Error('Mercado em tempo real indisponível.'));
    const code = room.code;
    return runIdempotentMutation(`cancel:${listingId}`, { listingId }, (requestId) => (
      emitSocketRequest<MarketMutationResponse>(socket, 'market:cancel-listing', { code, requestId, listingId })
    ));
  }, [room?.code, runIdempotentMutation, socket]);

  const exerciseLoanOption = useCallback((loanId: string, noticeApproval = false) => {
    if (!socket?.connected || !room?.code) return Promise.reject(new Error('Mercado em tempo real indisponível.'));
    const code = room.code;
    return runIdempotentMutation(`exercise-option:${loanId}`, { loanId, noticeApproval }, (requestId) => (
      emitSocketRequest<MarketMutationResponse>(socket, 'market:exercise-loan-option', {
        code,
        requestId,
        loanId,
        ...(noticeApproval ? { noticeApproval: true } : {}),
      })
    ));
  }, [room?.code, runIdempotentMutation, socket]);

  return useMemo(() => ({
    snapshot,
    loading,
    syncing,
    pendingAction,
    error,
    actionError,
    refresh: () => syncMarket(false),
    offer,
    respond,
    list,
    bid,
    cancelListing,
    exerciseLoanOption,
    clearActionError: () => setActionError(null),
  }), [
    actionError,
    bid,
    cancelListing,
    error,
    exerciseLoanOption,
    list,
    loading,
    offer,
    pendingAction,
    respond,
    snapshot,
    syncMarket,
    syncing,
  ]);
}
