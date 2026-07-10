import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../lib/apiClient';
import type { AckResponse, BolaSocket, Room, RoomCreatePayload } from '../types';
import { useAuth } from './useAuth';
import type { SocketState } from './useSocket';

type RoomAck = AckResponse<{ room: Room }>;

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'Não foi possível atualizar a sala.';
}

function waitForRoomAck(invoke: (callback: (response: RoomAck) => void) => void): Promise<Room> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('O servidor demorou para responder. Tente novamente.')), 8000);
    invoke((response) => {
      window.clearTimeout(timer);
      if (response.ok) resolve(response.room);
      else reject(new Error(response.error.message));
    });
  });
}

export function useRoom(socket: BolaSocket | null, socketState: SocketState) {
  const { identity, getIdToken } = useAuth();
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptRoom = useCallback((nextRoom: Room) => {
    setRoom((current) => {
      if (current?.code === nextRoom.code && current.revision >= nextRoom.revision) return current;
      return nextRoom;
    });
  }, []);

  useEffect(() => {
    if (!identity) {
      setRoom(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    apiRequest<{ rooms: Room[] }>('/api/rooms', { identity, getIdToken }, { signal: controller.signal })
      .then(({ rooms }) => {
        const latest = [...rooms].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        if (latest) setRoom((current) => current ?? latest);
      })
      .catch((nextError: unknown) => {
        if (!controller.signal.aborted && identity.mode !== 'demo') setError(errorMessage(nextError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [identity?.uid, identity?.mode, getIdToken, acceptRoom]);

  useEffect(() => {
    if (!socket) return;
    const onRoomState = (nextRoom: Room) => acceptRoom(nextRoom);
    const onRoomStarted = (nextRoom: Room) => acceptRoom(nextRoom);
    socket.on('room:state', onRoomState);
    socket.on('room:started', onRoomStarted);
    return () => {
      socket.off('room:state', onRoomState);
      socket.off('room:started', onRoomStarted);
    };
  }, [socket, acceptRoom]);

  useEffect(() => {
    if (!socket?.connected || !room) return;
    socket.emit('room:resume', { code: room.code }, (response) => {
      if (response.ok) acceptRoom(response.room);
    });
  }, [socket, socketState, room?.code, acceptRoom]);

  const offlineDemoRoom = useCallback((payload: RoomCreatePayload): Room => {
    if (!identity) throw new Error('Entre antes de criar uma sala.');
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      code: `BOLA-${crypto.randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()}`,
      name: payload.name,
      ownerId: identity.uid,
      status: 'waiting',
      activeLeagues: payload.activeLeagues ?? ['BR-A', 'BR-B'],
      seasonLength: payload.seasonLength ?? 1,
      maxManagers: payload.maxManagers ?? 6,
      createdAt: now,
      startedAt: null,
      revision: 1,
      managers: [{ id: identity.uid, name: identity.displayName, clubId: payload.clubId ?? null, ready: false, joinedAt: now }],
    };
  }, [identity]);

  const withPending = useCallback(async (action: () => Promise<Room>) => {
    setPending(true);
    setError(null);
    try {
      const nextRoom = await action();
      acceptRoom(nextRoom);
      return nextRoom;
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      throw new Error(message);
    } finally {
      setPending(false);
    }
  }, [acceptRoom]);

  const createRoom = useCallback((payload: RoomCreatePayload) => withPending(async () => {
    if (!socket?.connected) {
      if (identity?.mode === 'demo') return offlineDemoRoom(payload);
      throw new Error('A conexão em tempo real ainda não está pronta.');
    }
    return waitForRoomAck((acknowledge) => socket.emit('room:create', payload, acknowledge));
  }), [socket, identity?.mode, offlineDemoRoom, withPending]);

  const joinRoom = useCallback((code: string) => withPending(async () => {
    const normalizedCode = code.trim().toUpperCase();
    if (!socket?.connected) {
      if (identity?.mode === 'demo') return offlineDemoRoom({ name: 'Sala demonstração', activeLeagues: ['BR-A'], seasonLength: 1, maxManagers: 1 });
      throw new Error('A conexão em tempo real ainda não está pronta.');
    }
    return waitForRoomAck((acknowledge) => socket.emit('room:join', { code: normalizedCode }, acknowledge));
  }), [socket, identity?.mode, offlineDemoRoom, withPending]);

  const setReady = useCallback((ready: boolean, clubId?: string) => withPending(async () => {
    if (!room || !identity) throw new Error('Nenhuma sala selecionada.');
    if (!socket?.connected && identity.mode === 'demo') {
      return {
        ...room,
        revision: room.revision + 1,
        managers: room.managers.map((manager) => manager.id === identity.uid ? { ...manager, ready, clubId: clubId ?? manager.clubId } : manager),
      };
    }
    if (!socket?.connected) throw new Error('A conexão em tempo real foi interrompida.');
    return waitForRoomAck((acknowledge) => socket.emit('room:ready', { code: room.code, ready, clubId }, acknowledge));
  }), [socket, room, identity, withPending]);

  const startRoom = useCallback(() => withPending(async () => {
    if (!room || !identity) throw new Error('Nenhuma sala selecionada.');
    if (!socket?.connected && identity.mode === 'demo') {
      return { ...room, status: 'active', startedAt: new Date().toISOString(), revision: room.revision + 1 };
    }
    if (!socket?.connected) throw new Error('A conexão em tempo real foi interrompida.');
    return waitForRoomAck((acknowledge) => socket.emit('room:start', { code: room.code }, acknowledge));
  }), [socket, room, identity, withPending]);

  return {
    room,
    loading,
    pending,
    error,
    createRoom,
    joinRoom,
    setReady,
    startRoom,
    clearRoom: () => setRoom(null),
    clearError: () => setError(null),
  };
}
