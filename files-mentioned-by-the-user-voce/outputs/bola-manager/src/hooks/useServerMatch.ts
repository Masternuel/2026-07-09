import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AckResponse,
  BolaSocket,
  LineupSaveResponse,
  MatchEvent,
  MatchReadyResponse,
  MatchStatistics,
  MatchSyncResponse,
  Room,
  ServerMatchEvent,
  ServerMatchFinished,
  ServerMatchStarted,
} from '../types';
import { toClientMatchEvent } from '../utils/matchEventAdapter';

export type ServerMatchPhase = 'idle' | 'syncing' | 'starting' | 'running' | 'finished' | 'error';

function waitForAck<T extends object>(invoke: (callback: (response: AckResponse<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('O servidor demorou para responder.')), 8000);
    invoke((response) => {
      window.clearTimeout(timer);
      if (response.ok) resolve(response);
      else reject(new Error(response.error.message));
    });
  });
}

export function useServerMatch(socket: BolaSocket | null, room: Room | null, enabled: boolean) {
  const [phase, setPhase] = useState<ServerMatchPhase>('idle');
  const [match, setMatch] = useState<ServerMatchStarted | null>(null);
  const [rawEvents, setRawEvents] = useState<ServerMatchEvent[]>([]);
  const [result, setResult] = useState<ServerMatchFinished | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readyPending, setReadyPending] = useState(false);

  useEffect(() => {
    setPhase('idle');
    setMatch(null);
    setRawEvents([]);
    setResult(null);
    setError(null);
    setReadyPending(false);
  }, [room?.code]);

  useEffect(() => {
    if (!socket || !enabled) return;
    const onStarted = (started: ServerMatchStarted) => {
      if (started.code !== room?.code) return;
      setMatch(started);
      setRawEvents([]);
      setResult(null);
      setError(null);
      setPhase('running');
    };
    const onEvent = (event: ServerMatchEvent) => {
      if (event.code !== room?.code) return;
      setRawEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event]);
      setPhase('running');
    };
    const onFinished = (finished: ServerMatchFinished) => {
      if (finished.code && finished.code !== room?.code) return;
      setResult(finished);
      setPhase('finished');
    };
    const onServerError = (payload: { event: string; error: { message: string } }) => {
      if (!payload.event.startsWith('match:')) return;
      setError(payload.error.message);
      setPhase('error');
    };
    socket.on('match:started', onStarted);
    socket.on('match:event', onEvent);
    socket.on('match:finished', onFinished);
    socket.on('server:error', onServerError);
    return () => {
      socket.off('match:started', onStarted);
      socket.off('match:event', onEvent);
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
        if (synced.started) setMatch(synced.started);
        setRawEvents(synced.events);
        setResult(synced.result);
        setError(null);
        setPhase(synced.result ? 'finished' : synced.started ? 'running' : 'idle');
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
    if (phase === 'starting' || phase === 'running' || phase === 'finished') return;
    setPhase('starting');
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

  const setReady = useCallback(async (ready: boolean) => {
    if (!enabled || !socket?.connected || !room) throw new Error('A partida online ainda não está disponível.');
    if (!room.currentFixtureId) throw new Error('A temporada não possui partidas pendentes.');
    if (phase === 'running' || phase === 'starting') throw new Error('A partida desta rodada já começou.');
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

  const saveLineup = useCallback(async (lineupIds: string[]) => {
    if (!enabled || !socket?.connected || !room) throw new Error('A conexão com a sala ainda não está disponível.');
    if (lineupIds.length < 1 || lineupIds.length > 11) throw new Error('A escalação deve ter entre 1 e 11 jogadores.');
    if (new Set(lineupIds).size !== lineupIds.length) throw new Error('A escalação não pode repetir jogadores.');
    setError(null);
    try {
      return await waitForAck<LineupSaveResponse>((acknowledge) => socket.emit(
        'lineup:save',
        { code: room.code, lineupIds },
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

  const events = useMemo<MatchEvent[]>(() => rawEvents.map((event) => toClientMatchEvent(
    event,
    match?.homeTeam ?? 'Aurora FC',
  )), [rawEvents, match?.homeTeam]);
  const latestEvent = rawEvents.at(-1);
  const statistics: MatchStatistics | null = latestEvent?.statistics ?? result?.statistics ?? null;
  const score: [number, number] = latestEvent?.score ?? result?.score ?? [0, 0];

  const reset = useCallback(() => {
    setPhase('idle');
    setMatch(null);
    setRawEvents([]);
    setResult(null);
    setError(null);
    setReadyPending(false);
  }, []);

  return {
    connected: Boolean(socket?.connected),
    phase,
    match,
    events,
    statistics,
    score,
    result,
    error,
    readyPending,
    start,
    setReady,
    saveLineup,
    skip,
    reset,
  };
}

export type ServerMatchController = ReturnType<typeof useServerMatch>;
