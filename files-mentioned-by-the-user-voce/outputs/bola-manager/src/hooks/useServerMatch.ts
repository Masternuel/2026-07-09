import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AckResponse,
  BolaSocket,
  MatchEvent,
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

  useEffect(() => {
    setPhase('idle');
    setMatch(null);
    setRawEvents([]);
    setResult(null);
    setError(null);
  }, [room?.code]);

  useEffect(() => {
    if (!socket || !enabled) return;
    const onStarted = (started: ServerMatchStarted) => {
      setMatch(started);
      setRawEvents([]);
      setResult(null);
      setError(null);
      setPhase('running');
    };
    const onEvent = (event: ServerMatchEvent) => {
      setRawEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event]);
      setPhase('running');
    };
    const onFinished = (finished: ServerMatchFinished) => {
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
  }, [socket, enabled]);

  useEffect(() => {
    if (!enabled || !socket?.connected || !room) return;
    setPhase((current) => current === 'idle' || current === 'error' ? 'syncing' : current);
    void waitForAck<MatchSyncResponse>((acknowledge) => socket.emit('match:sync', { code: room.code }, acknowledge))
      .then((synced) => {
        if (synced.started) setMatch(synced.started);
        setRawEvents(synced.events);
        setResult(synced.result);
        setError(null);
        setPhase(synced.result ? 'finished' : synced.started ? 'running' : 'idle');
      })
      .catch((nextError: unknown) => {
        setError(nextError instanceof Error ? nextError.message : 'Não foi possível sincronizar a partida.');
        setPhase('error');
      });
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
    start,
    skip,
    reset,
  };
}

export type ServerMatchController = ReturnType<typeof useServerMatch>;
