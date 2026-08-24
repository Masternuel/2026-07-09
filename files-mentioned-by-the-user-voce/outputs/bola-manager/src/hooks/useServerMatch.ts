import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AckResponse,
  BolaSocket,
  HalftimeTactics,
  LineupSaveResponse,
  MatchEvent,
  MatchHalftimeResponse,
  MatchReadyResponse,
  MatchSpeed,
  MatchStatistics,
  MatchSyncResponse,
  Room,
  ServerHalftimeState,
  ServerMatchEvent,
  ServerMatchFinished,
  ServerMatchResumed,
  ServerMatchSpeed,
  ServerMatchStarted,
  TacticPlanV1,
} from '../types';
import { toClientMatchEvent } from '../utils/matchEventAdapter';

export type ServerMatchPhase = 'idle' | 'syncing' | 'starting' | 'running' | 'halftime' | 'finished' | 'error';

function waitForAck<T extends object>(invoke: (callback: (response: AckResponse<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('O servidor demorou para responder.')), 8000);
    invoke((response: unknown) => {
      window.clearTimeout(timer);
      const validated = validateAckResponse<T>(response);
      if (validated.ok) resolve(validated.value);
      else reject(new Error(validated.message));
    });
  });
}

export function validateAckResponse<T extends object>(
  value: unknown,
): { ok: true; value: T } | { ok: false; message: string } {
  const record = objectRecord(value);
  if (!record || record.ok !== true) {
    const error = objectRecord(record?.error);
    const message = typeof error?.message === 'string' && error.message.trim()
      ? error.message
      : 'O servidor enviou uma resposta inválida.';
    return { ok: false, message };
  }
  return { ok: true, value: record as unknown as T };
}

function mergeHalftimeState(
  current: ServerHalftimeState | null,
  incoming: ServerHalftimeState,
): ServerHalftimeState {
  if (!current || current.matchId !== incoming.matchId) return incoming;
  return {
    ...current,
    ...incoming,
    participant: incoming.participant ?? current.participant,
    ownPlan: incoming.ownPlan === undefined ? current.ownPlan : incoming.ownPlan,
  };
}

function safeServerEvents(value: unknown): ServerMatchEvent[] {
  return Array.isArray(value)
    ? value.filter((event): event is ServerMatchEvent => Boolean(event && typeof event === 'object'))
    : [];
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function validateMatchSocketPayload(
  value: unknown,
  expectedRoomCode: unknown,
  requiredStringFields: readonly string[] = [],
): Record<string, unknown> | null {
  const record = objectRecord(value);
  if (!record || typeof expectedRoomCode !== 'string' || !expectedRoomCode) return null;
  if (typeof record.code !== 'string' || record.code !== expectedRoomCode) return null;
  if (requiredStringFields.some((field) => (
    typeof record[field] !== 'string' || !(record[field] as string).trim()
  ))) return null;
  return record;
}

export function validateMatchServerError(value: unknown): { event: string; message: string } | null {
  const record = objectRecord(value);
  const error = objectRecord(record?.error);
  if (!record || typeof record.event !== 'string' || !record.event.trim()) return null;
  if (!error || typeof error.message !== 'string' || !error.message.trim()) return null;
  return { event: record.event, message: error.message };
}

export function validateMatchSpeedPayload(
  value: unknown,
  expectedRoomCode: unknown,
  expectedMatchId: string | null = null,
): ServerMatchSpeed | null {
  const record = validateMatchSocketPayload(value, expectedRoomCode, ['matchId']);
  if (!record || (expectedMatchId && record.matchId !== expectedMatchId)) return null;
  if (![0.5, 1, 2, 3].includes(record.rate as number)) return null;
  return record as unknown as ServerMatchSpeed;
}

export function useServerMatch(socket: BolaSocket | null, room: Room | null, enabled: boolean) {
  const [phase, setPhase] = useState<ServerMatchPhase>('idle');
  const [match, setMatch] = useState<ServerMatchStarted | null>(null);
  const [rawEvents, setRawEvents] = useState<ServerMatchEvent[]>([]);
  const [result, setResult] = useState<ServerMatchFinished | null>(null);
  const [halftime, setHalftime] = useState<ServerHalftimeState | null>(null);
  const [speed, setSpeedState] = useState<ServerMatchSpeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readyPending, setReadyPending] = useState(false);
  const [halftimePending, setHalftimePending] = useState<'plan' | 'ready' | null>(null);
  const [speedPending, setSpeedPending] = useState<MatchSpeed | null>(null);
  const activeMatchIdRef = useRef<string | null>(null);
  const roomCodeRef = useRef<string | null>(room?.code ?? null);

  useEffect(() => {
    roomCodeRef.current = room?.code ?? null;
    activeMatchIdRef.current = null;
    setPhase('idle');
    setMatch(null);
    setRawEvents([]);
    setResult(null);
    setHalftime(null);
    setSpeedState(null);
    setError(null);
    setReadyPending(false);
    setHalftimePending(null);
    setSpeedPending(null);
  }, [room?.code]);

  useEffect(() => {
    if (!socket || !enabled) return;
    const onStarted = (value: unknown) => {
      const payload = validateMatchSocketPayload(value, room?.code, ['id']);
      if (!payload) return;
      const started = payload as unknown as ServerMatchStarted;
      activeMatchIdRef.current = started.id;
      setMatch(started);
      setRawEvents([]);
      setResult(null);
      setHalftime(null);
      setSpeedState(validateMatchSpeedPayload(started.speed, room?.code, started.id));
      setError(null);
      setSpeedPending(null);
      setPhase('running');
    };
    const onEvent = (value: unknown) => {
      const payload = validateMatchSocketPayload(value, room?.code, ['id', 'type']);
      if (!payload) return;
      const event = payload as unknown as ServerMatchEvent;
      setRawEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event]);
      setPhase((current) => event.type === 'halftime' || current === 'halftime' ? 'halftime' : 'running');
    };
    const onHalftime = (value: unknown) => {
      const payload = validateMatchSocketPayload(value, room?.code, ['matchId']);
      if (!payload) return;
      const nextHalftime = payload as unknown as ServerHalftimeState;
      setHalftime((current) => mergeHalftimeState(current, nextHalftime));
      setError(null);
      setPhase('halftime');
    };
    const onResumed = (value: unknown) => {
      const payload = validateMatchSocketPayload(value, room?.code, ['matchId']);
      if (!payload) return;
      const resumed = payload as unknown as ServerMatchResumed;
      setHalftime((current) => current?.matchId === resumed.matchId
        ? { ...current, status: 'resuming', allReady: true }
        : current);
      setHalftimePending(null);
      setError(null);
      setPhase('running');
    };
    const onSpeedChanged = (value: unknown) => {
      const activeMatchId = activeMatchIdRef.current;
      if (!activeMatchId) return;
      const nextSpeed = validateMatchSpeedPayload(value, room?.code, activeMatchId);
      if (!nextSpeed) return;
      setSpeedState(nextSpeed);
      setError(null);
    };
    const onFinished = (value: unknown) => {
      const payload = validateMatchSocketPayload(value, room?.code, ['id']);
      if (!payload) return;
      const finished = payload as unknown as ServerMatchFinished;
      activeMatchIdRef.current = null;
      setResult(finished);
      setHalftime(null);
      setSpeedState(null);
      setHalftimePending(null);
      setSpeedPending(null);
      setPhase('finished');
    };
    const onServerError = (value: unknown) => {
      const payload = validateMatchServerError(value);
      if (!payload || !payload.event.startsWith('match:')) return;
      setError(payload.message);
      if (payload.event === 'match:speed') {
        setSpeedPending(null);
        return;
      }
      setPhase((current) => current === 'halftime' ? current : 'error');
    };
    socket.on('match:started', onStarted);
    socket.on('match:event', onEvent);
    socket.on('match:halftime', onHalftime);
    socket.on('match:resumed', onResumed);
    socket.on('match:speed-changed', onSpeedChanged);
    socket.on('match:finished', onFinished);
    socket.on('server:error', onServerError);
    return () => {
      socket.off('match:started', onStarted);
      socket.off('match:event', onEvent);
      socket.off('match:halftime', onHalftime);
      socket.off('match:resumed', onResumed);
      socket.off('match:speed-changed', onSpeedChanged);
      socket.off('match:finished', onFinished);
      socket.off('server:error', onServerError);
    };
  }, [socket, enabled, room?.code]);

  useEffect(() => {
    if (!enabled || !socket?.connected || !room) return;
    let cancelled = false;
    setPhase((current) => current === 'idle' || current === 'error' ? 'syncing' : current);
    void waitForAck<MatchSyncResponse>((acknowledge) => socket.emit('match:sync', { code: room.code }, acknowledge))
      .then((synced) => {
        if (cancelled) return;
        const startedMatchId = synced.started?.id ?? null;
        const syncedMatchId = synced.source === 'live' ? startedMatchId : null;
        const syncedSpeed = synced.speed ?? synced.started?.speed ?? null;
        activeMatchIdRef.current = syncedMatchId;
        setMatch(synced.started);
        setRawEvents(safeServerEvents(synced.events));
        setResult(synced.result);
        setHalftime(synced.halftime ?? null);
        setSpeedState(
          syncedMatchId && syncedSpeed?.matchId === syncedMatchId
            ? syncedSpeed
            : null,
        );
        setSpeedPending(null);
        setError(null);
        setPhase(synced.source === 'idle'
          ? 'idle'
          : synced.result || synced.phase === 'finished'
            ? 'finished'
            : synced.phase === 'halftime'
              ? 'halftime'
              : synced.phase === 'running' || synced.started
                ? 'running'
                : 'idle');
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : 'Não foi possível sincronizar a partida.');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, socket, socket?.connected, room?.code]);

  const start = useCallback(async () => {
    if (!enabled || !socket?.connected || !room) throw new Error('A partida online ainda não está disponível.');
    if (phase === 'starting' || phase === 'running' || phase === 'halftime' || phase === 'finished') return;
    activeMatchIdRef.current = null;
    setPhase('starting');
    setSpeedState(null);
    setSpeedPending(null);
    setError(null);
    try {
      await waitForAck<{ matchId: string }>((acknowledge) => socket.emit(
        'match:start',
        { code: room.code, fixtureId: room.currentFixtureId ?? undefined },
        acknowledge,
      ));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Não foi possível iniciar a partida.';
      setError(message);
      setPhase('error');
      throw new Error(message);
    }
  }, [enabled, socket, room, phase]);

  const setSpeed = useCallback(async (nextSpeed: MatchSpeed) => {
    if (!enabled || !socket?.connected || !room || !match) {
      throw new Error('A partida online ainda não está disponível.');
    }
    if (phase !== 'running' && phase !== 'halftime') {
      throw new Error('A velocidade só pode ser alterada durante a partida.');
    }
    if (speed?.matchId === match.id && speed.rate === nextSpeed) return speed;

    const roomCode = room.code;
    const matchId = match.id;
    setSpeedPending(nextSpeed);
    setError(null);
    try {
      const response = await waitForAck<{ changed: boolean; speed: ServerMatchSpeed }>((acknowledge) => socket.emit(
        'match:speed',
        { code: roomCode, matchId, speed: nextSpeed },
        acknowledge,
      ));
      if (
        roomCodeRef.current !== roomCode
        || activeMatchIdRef.current !== matchId
        || response.speed.code !== roomCode
        || response.speed.matchId !== matchId
      ) {
        throw new Error('A resposta de velocidade pertence a uma partida anterior.');
      }
      setSpeedState(response.speed);
      return response.speed;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Não foi possível alterar a velocidade.';
      if (roomCodeRef.current === roomCode && activeMatchIdRef.current === matchId) setError(message);
      throw new Error(message);
    } finally {
      if (roomCodeRef.current === roomCode && activeMatchIdRef.current === matchId) {
        setSpeedPending((current) => current === nextSpeed ? null : current);
      }
    }
  }, [enabled, socket, room, match, phase, speed]);

  const setReady = useCallback(async (ready: boolean) => {
    if (!enabled || !socket?.connected || !room) throw new Error('A partida online ainda não está disponível.');
    if (!room.currentFixtureId) throw new Error('A temporada não possui partidas pendentes.');
    if (phase === 'running' || phase === 'halftime' || phase === 'starting') throw new Error('A partida desta rodada já começou.');
    setReadyPending(true);
    setError(null);
    try {
      return await waitForAck<MatchReadyResponse>((acknowledge) => socket.emit(
        'match:ready',
        { code: room.code, fixtureId: room.currentFixtureId ?? undefined, ready },
        acknowledge,
      ));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Não foi possível confirmar a prontidão.';
      setError(message);
      throw new Error(message);
    } finally {
      setReadyPending(false);
    }
  }, [enabled, socket, room, phase]);

  const saveLineup = useCallback(async (lineupIds: string[], tactics?: TacticPlanV1) => {
    if (!enabled || !socket?.connected || !room) throw new Error('A conexão com a sala ainda não está disponível.');
    if (lineupIds.length !== 11) throw new Error('A escalação precisa ter exatamente 11 titulares.');
    if (new Set(lineupIds).size !== lineupIds.length) throw new Error('A escalação não pode repetir jogadores.');
    setError(null);
    try {
      return await waitForAck<LineupSaveResponse>((acknowledge) => socket.emit(
        'lineup:save',
        { code: room.code, lineupIds, tactics },
        acknowledge,
      ));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Não foi possível salvar a escalação.';
      setError(message);
      throw new Error(message);
    }
  }, [enabled, socket, room]);

  const skip = useCallback(async () => {
    if (!socket?.connected || !room) throw new Error('A conexão com a partida foi interrompida.');
    await waitForAck<{ skipped: boolean }>((acknowledge) => socket.emit('match:skip', { code: room.code }, acknowledge));
  }, [socket, room]);

  const saveHalftimePlan = useCallback(async (lineupIds: string[], tactics: HalftimeTactics) => {
    if (!enabled || !socket?.connected || !room || !match || !halftime) {
      throw new Error('O intervalo da partida ainda não está disponível.');
    }
    if (phase !== 'halftime' || halftime.status !== 'paused') throw new Error('O segundo tempo já está sendo iniciado.');
    if (halftime.participant === false) throw new Error('Somente os managers desta partida podem alterar o plano.');
    if (lineupIds.length !== 11) throw new Error('A escalação precisa ter exatamente 11 jogadores.');
    if (new Set(lineupIds).size !== lineupIds.length) throw new Error('A escalação não pode repetir jogadores.');
    setHalftimePending('plan');
    setError(null);
    try {
      const response = await waitForAck<MatchHalftimeResponse>((acknowledge) => socket.emit(
        'match:halftime-plan',
        { code: room.code, matchId: halftime.matchId, lineupIds, tactics },
        acknowledge,
      ));
      setHalftime((current) => mergeHalftimeState(current, response.halftime));
      setPhase('halftime');
      return response.halftime;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Não foi possível salvar o plano do intervalo.';
      setError(message);
      throw new Error(message);
    } finally {
      setHalftimePending(null);
    }
  }, [enabled, socket, room, match, halftime, phase]);

  const setHalftimeReady = useCallback(async (ready: boolean) => {
    if (!enabled || !socket?.connected || !room || !match || !halftime) {
      throw new Error('O intervalo da partida ainda não está disponível.');
    }
    if (phase !== 'halftime' || halftime.status !== 'paused') throw new Error('O segundo tempo já está sendo iniciado.');
    if (halftime.participant === false) throw new Error('Somente os managers desta partida confirmam a prontidão.');
    setHalftimePending('ready');
    setError(null);
    try {
      const response = await waitForAck<MatchHalftimeResponse>((acknowledge) => socket.emit(
        'match:halftime-ready',
        { code: room.code, matchId: halftime.matchId, ready },
        acknowledge,
      ));
      if (response.resumed) {
        setHalftime((current) => mergeHalftimeState(current, response.halftime));
        setPhase('running');
      } else {
        setHalftime((current) => mergeHalftimeState(current, response.halftime));
        setPhase('halftime');
      }
      return response;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Não foi possível confirmar a prontidão do intervalo.';
      setError(message);
      throw new Error(message);
    } finally {
      setHalftimePending(null);
    }
  }, [enabled, socket, room, match, halftime, phase]);

  const events = useMemo<MatchEvent[]>(() => rawEvents.map((event) => toClientMatchEvent(
    event,
    match?.homeTeam,
  )), [rawEvents, match?.homeTeam]);
  const latestEvent = rawEvents.at(-1);
  const statistics: MatchStatistics | null = latestEvent?.statistics ?? result?.statistics ?? null;
  const score: [number, number] = latestEvent?.score ?? result?.score ?? [0, 0];

  const reset = useCallback(() => {
    setPhase('idle');
    setMatch(null);
    setRawEvents([]);
    setResult(null);
    setHalftime(null);
    setSpeedState(null);
    setError(null);
    setReadyPending(false);
    setHalftimePending(null);
    setSpeedPending(null);
    activeMatchIdRef.current = null;
  }, []);

  return {
    connected: Boolean(socket?.connected),
    phase,
    match,
    events,
    statistics,
    score,
    result,
    halftime,
    speed,
    error,
    readyPending,
    halftimePending,
    speedPending,
    start,
    setSpeed,
    setReady,
    saveLineup,
    saveHalftimePlan,
    setHalftimeReady,
    skip,
    reset,
  };
}

export type ServerMatchController = ReturnType<typeof useServerMatch>;
