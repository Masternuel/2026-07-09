import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../lib/apiClient';
import type { AckResponse, BolaSocket, Room, RoomCreatePayload } from '../types';
import { useAuth } from './useAuth';
import type { SocketState } from './useSocket';

type RoomAck = AckResponse<{ room: Room }>;
type DeleteRoomAck = AckResponse<{ code: string }>;

const MISSING_SAVE_MESSAGE = 'Este save não existe mais no servidor e foi removido da sua lista.';

class RoomAckError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'RoomAckError';
    this.code = code;
  }
}

function roomTimestamp(room: Room): number {
  const timestamp = Date.parse(room.updatedAt ?? room.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort((left, right) => roomTimestamp(right) - roomTimestamp(left));
}

function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

function mergeRoomsByRevision(current: Room[], incoming: Room[], tombstones: Set<string>): Room[] {
  const merged = new Map<string, Room>();
  for (const room of current) {
    const code = normalizeRoomCode(room.code);
    if (!tombstones.has(code)) merged.set(code, room);
  }
  for (const room of incoming) {
    const code = normalizeRoomCode(room.code);
    if (tombstones.has(code)) continue;
    const existing = merged.get(code);
    if (!existing || room.revision > existing.revision) merged.set(code, room);
  }
  return sortRooms([...merged.values()]);
}

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
      else reject(new RoomAckError(response.error.message, response.error.code));
    });
  });
}

function waitForDeleteRoomAck(invoke: (callback: (response: DeleteRoomAck) => void) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('O servidor demorou para responder. Tente novamente.')), 8000);
    invoke((response) => {
      window.clearTimeout(timer);
      if (response.ok) resolve(response.code);
      else reject(new RoomAckError(response.error.message, response.error.code));
    });
  });
}

export function useRoom(socket: BolaSocket | null, socketState: SocketState) {
  const { identity, getIdToken } = useAuth();
  const [room, setRoom] = useState<Room | null>(null);
  const [savedRooms, setSavedRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletedRoomCodesRef = useRef(new Set<string>());
  const requestGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const identityKeyRef = useRef<string | null>(null);

  const tombstoneRoom = useCallback((code: string) => {
    const normalizedCode = normalizeRoomCode(code);
    if (!deletedRoomCodesRef.current.has(normalizedCode)) {
      deletedRoomCodesRef.current.add(normalizedCode);
      mutationGenerationRef.current += 1;
    }
    setSavedRooms((current) => current.filter((savedRoom) => normalizeRoomCode(savedRoom.code) !== normalizedCode));
    setRoom((current) => current && normalizeRoomCode(current.code) === normalizedCode ? null : current);
  }, []);

  const rememberRoom = useCallback((nextRoom: Room) => {
    if (deletedRoomCodesRef.current.has(normalizeRoomCode(nextRoom.code))) return;
    mutationGenerationRef.current += 1;
    setSavedRooms((current) => sortRooms([
      current.find((savedRoom) => savedRoom.code === nextRoom.code && savedRoom.revision >= nextRoom.revision) ?? nextRoom,
      ...current.filter((savedRoom) => savedRoom.code !== nextRoom.code),
    ]));
  }, []);

  const acceptRoom = useCallback((nextRoom: Room) => {
    if (deletedRoomCodesRef.current.has(normalizeRoomCode(nextRoom.code))) return;
    setRoom((current) => {
      if (current?.code === nextRoom.code && current.revision >= nextRoom.revision) return current;
      return nextRoom;
    });
    rememberRoom(nextRoom);
  }, [rememberRoom]);

  const updateSelectedRoom = useCallback((nextRoom: Room) => {
    if (deletedRoomCodesRef.current.has(normalizeRoomCode(nextRoom.code))) return;
    setRoom((current) => {
      if (current?.code !== nextRoom.code || current.revision >= nextRoom.revision) return current;
      return nextRoom;
    });
    rememberRoom(nextRoom);
  }, [rememberRoom]);

  useEffect(() => {
    const identityKey = identity ? `${identity.mode}:${identity.uid}` : null;
    const identityChanged = identityKeyRef.current !== identityKey;

    if (identityChanged) {
      identityKeyRef.current = identityKey;
      requestGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
      deletedRoomCodesRef.current.clear();
      setRoom(null);
      setSavedRooms([]);
      setError(null);
    }

    if (!identity) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const requestGeneration = ++requestGenerationRef.current;
    const mutationGeneration = mutationGenerationRef.current;
    setLoading(true);
    apiRequest<{ rooms: Room[] }>('/api/rooms', { identity, getIdToken }, { signal: controller.signal })
      .then(({ rooms }) => {
        if (controller.signal.aborted || requestGeneration !== requestGenerationRef.current) return;
        const tombstones = deletedRoomCodesRef.current;
        const incoming = sortRooms(rooms.filter((candidate) => !tombstones.has(normalizeRoomCode(candidate.code))));
        const hasConcurrentMutation = identity.mode === 'demo'
          || mutationGenerationRef.current !== mutationGeneration;

        if (!hasConcurrentMutation) {
          setSavedRooms(incoming);
          setRoom((current) => {
            if (!current || tombstones.has(normalizeRoomCode(current.code))) return null;
            return incoming.find((candidate) => candidate.code === current.code) ?? null;
          });
          return;
        }

        setSavedRooms((current) => mergeRoomsByRevision(current, incoming, tombstones));
        setRoom((current) => {
          if (!current || tombstones.has(normalizeRoomCode(current.code))) return null;
          const serverRoom = incoming.find((candidate) => candidate.code === current.code);
          return serverRoom && serverRoom.revision > current.revision ? serverRoom : current;
        });
      })
      .catch((nextError: unknown) => {
        if (
          !controller.signal.aborted
          && requestGeneration === requestGenerationRef.current
          && identity.mode !== 'demo'
        ) setError(errorMessage(nextError));
      })
      .finally(() => {
        if (requestGeneration === requestGenerationRef.current) setLoading(false);
      });
    return () => controller.abort();
  }, [identity?.uid, identity?.mode, getIdToken, socketState]);

  useEffect(() => {
    if (!socket) return;
    const onRoomState = (nextRoom: Room) => updateSelectedRoom(nextRoom);
    const onRoomStarted = (nextRoom: Room) => updateSelectedRoom(nextRoom);
    const onRoomDeleted = ({ code }: { code: string }) => tombstoneRoom(code);
    socket.on('room:state', onRoomState);
    socket.on('room:started', onRoomStarted);
    socket.on('room:deleted', onRoomDeleted);
    return () => {
      socket.off('room:state', onRoomState);
      socket.off('room:started', onRoomStarted);
      socket.off('room:deleted', onRoomDeleted);
    };
  }, [socket, tombstoneRoom, updateSelectedRoom]);

  useEffect(() => {
    if (!socket?.connected || !room) return;
    const code = room.code;
    if (deletedRoomCodesRef.current.has(normalizeRoomCode(code))) {
      tombstoneRoom(code);
      return;
    }
    socket.emit('room:resume', { code }, (response) => {
      if (response.ok) updateSelectedRoom(response.room);
      else if (response.error.code === 'ROOM_NOT_FOUND') {
        tombstoneRoom(code);
        setError(MISSING_SAVE_MESSAGE);
      } else {
        setError(response.error.message);
      }
    });
  }, [socket, socketState, room?.code, tombstoneRoom, updateSelectedRoom]);

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
      unlimitedSeasons: payload.unlimitedSeasons === true,
      currentSeason: 1,
      seasonYear: new Date(now).getUTCFullYear(),
      seasonStartedAt: null,
      seasonHistory: [],
      careerCompleted: false,
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
      if (deletedRoomCodesRef.current.has(normalizeRoomCode(nextRoom.code))) {
        throw new Error(MISSING_SAVE_MESSAGE);
      }
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
    const normalizedCode = normalizeRoomCode(code);
    if (!socket?.connected) {
      if (identity?.mode === 'demo') return offlineDemoRoom({ name: 'Sala demonstração', activeLeagues: ['BR-A'], seasonLength: 1, maxManagers: 1 });
      throw new Error('A conexão em tempo real ainda não está pronta.');
    }
    return waitForRoomAck((acknowledge) => socket.emit('room:join', { code: normalizedCode }, acknowledge));
  }), [socket, identity?.mode, offlineDemoRoom, withPending]);

  const selectRoom = useCallback((code: string) => withPending(async () => {
    const normalizedCode = normalizeRoomCode(code);
    if (deletedRoomCodesRef.current.has(normalizedCode)) throw new Error(MISSING_SAVE_MESSAGE);
    if (socket?.connected) {
      try {
        return await waitForRoomAck((acknowledge) => socket.emit('room:resume', { code: normalizedCode }, acknowledge));
      } catch (nextError) {
        if (nextError instanceof RoomAckError && nextError.code === 'ROOM_NOT_FOUND') {
          tombstoneRoom(normalizedCode);
          throw new Error(MISSING_SAVE_MESSAGE);
        }
        throw nextError;
      }
    }
    if (identity?.mode === 'demo') {
      const savedRoom = savedRooms.find((candidate) => candidate.code === normalizedCode);
      if (savedRoom) return savedRoom;
      throw new Error('Save não encontrado.');
    }
    throw new Error('A conexão em tempo real ainda não está pronta.');
  }), [socket, identity?.mode, savedRooms, tombstoneRoom, withPending]);

  const deleteRoom = useCallback(async (code: string) => {
    const normalizedCode = normalizeRoomCode(code);
    setPending(true);
    setError(null);
    try {
      if (socket?.connected) {
        await waitForDeleteRoomAck((acknowledge) => socket.emit('room:delete', { code: normalizedCode }, acknowledge));
      } else if (identity?.mode === 'demo') {
        const savedRoom = savedRooms.find((candidate) => candidate.code === normalizedCode);
        if (!savedRoom) throw new Error('Save não encontrado.');
        if (savedRoom.ownerId !== identity.uid) throw new Error('Somente o criador pode excluir este save.');
      } else {
        throw new Error('A conexão em tempo real ainda não está pronta.');
      }
      tombstoneRoom(normalizedCode);
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      throw new Error(message);
    } finally {
      setPending(false);
    }
  }, [socket, identity, savedRooms, tombstoneRoom]);

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
      const startedAt = new Date().toISOString();
      return { ...room, status: 'active', startedAt, seasonStartedAt: room.seasonStartedAt ?? startedAt, revision: room.revision + 1 };
    }
    if (!socket?.connected) throw new Error('A conexão em tempo real foi interrompida.');
    return waitForRoomAck((acknowledge) => socket.emit('room:start', { code: room.code }, acknowledge));
  }), [socket, room, identity, withPending]);

  return {
    room,
    savedRooms,
    loading,
    pending,
    error,
    createRoom,
    joinRoom,
    selectRoom,
    deleteRoom,
    setReady,
    startRoom,
    clearRoom: () => setRoom(null),
    clearError: () => setError(null),
  };
}
