import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../lib/apiClient';
import type { AckResponse, BolaSocket, Room, RoomCreatePayload, RoomFixture } from '../types';
import { normalizeRoomSnapshot, normalizeRoomSnapshots } from '../utils/normalizeRoom';
import { useAuth } from './useAuth';
import type { SocketState } from './useSocket';

type RoomAck = AckResponse<{ room: Room }>;
type DeleteRoomAck = AckResponse<{ code: string }>;

const ROOM_ACK_TIMEOUT_MS = 8_000;
const ROOM_DELETE_ACK_TIMEOUT_MS = 30_000;

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

function normalizeRoomCode(code: unknown): string {
  if (typeof code === 'string') return code.trim().toUpperCase();
  if (typeof code === 'number' && Number.isFinite(code)) return String(code);
  return '';
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
    const timer = window.setTimeout(() => reject(new Error('O servidor demorou para responder. Tente novamente.')), ROOM_ACK_TIMEOUT_MS);
    invoke((response) => {
      window.clearTimeout(timer);
      if (response?.ok) {
        const room = normalizeRoomSnapshot(response.room);
        if (room) resolve(room);
        else reject(new RoomAckError('O servidor retornou um save inválido.', 'ROOM_SNAPSHOT_INVALID'));
      } else if (response?.error) reject(new RoomAckError(response.error.message, response.error.code));
      else reject(new RoomAckError('O servidor retornou uma resposta inválida.', 'ROOM_ACK_INVALID'));
    });
  });
}

function waitForDeleteRoomAck(invoke: (callback: (response: DeleteRoomAck) => void) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('O servidor demorou para responder. Tente novamente.')), ROOM_DELETE_ACK_TIMEOUT_MS);
    invoke((response) => {
      window.clearTimeout(timer);
      if (response?.ok) {
        const code = normalizeRoomCode(response.code);
        if (code) resolve(code);
        else reject(new RoomAckError('O servidor retornou um código de save inválido.', 'ROOM_CODE_INVALID'));
      } else if (response?.error) reject(new RoomAckError(response.error.message, response.error.code));
      else reject(new RoomAckError('O servidor retornou uma resposta inválida.', 'ROOM_ACK_INVALID'));
    });
  });
}

const demoClubNames: Record<string, string> = {
  AUR: 'Aurora FC',
  SAN: 'Santos',
  FLU: 'Fluminense',
  BAH: 'Bahia',
  PAL: 'Palmeiras',
};

function createOfflineFixtureSchedule(managerId: string, selectedClubId: string | null): RoomFixture[] {
  const managedClubId = (selectedClubId || 'AUR').toLocaleUpperCase('pt-BR');
  const managedTeam = demoClubNames[managedClubId] ?? managedClubId;
  const opponents = ['SAN', 'FLU', 'BAH', 'PAL'].filter((clubId) => clubId !== managedClubId).slice(0, 3);
  return opponents.map((opponentId, index) => {
    const managerAtHome = index % 2 === 0;
    return {
      fixtureId: index === 0 ? 'abertura' : `rodada-${index + 1}`,
      round: index + 1,
      competition: 'Brasileirao',
      homeClubId: managerAtHome ? managedClubId : opponentId,
      awayClubId: managerAtHome ? opponentId : managedClubId,
      homeTeam: managerAtHome ? managedTeam : demoClubNames[opponentId],
      awayTeam: managerAtHome ? demoClubNames[opponentId] : managedTeam,
      homeManagerId: managerAtHome ? managerId : null,
      awayManagerId: managerAtHome ? null : managerId,
      managerIds: [managerId],
    };
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
    if (!normalizedCode) return;
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
    apiRequest<unknown>('/api/rooms', { identity, getIdToken }, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted || requestGeneration !== requestGenerationRef.current) return;
        const tombstones = deletedRoomCodesRef.current;
        const records = payload && typeof payload === 'object' && 'rooms' in payload
          ? (payload as { rooms?: unknown }).rooms
          : [];
        const incoming = sortRooms(normalizeRoomSnapshots(records)
          .filter((candidate) => !tombstones.has(normalizeRoomCode(candidate.code))));
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
    const onRoomState = (value: unknown) => {
      const nextRoom = normalizeRoomSnapshot(value);
      if (nextRoom) updateSelectedRoom(nextRoom);
    };
    const onRoomStarted = (value: unknown) => {
      const nextRoom = normalizeRoomSnapshot(value);
      if (nextRoom) updateSelectedRoom(nextRoom);
    };
    const onRoomDeleted = (value: unknown) => {
      const code = value && typeof value === 'object' && 'code' in value
        ? normalizeRoomCode((value as { code?: unknown }).code)
        : '';
      if (code) tombstoneRoom(code);
    };
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
      if (response?.ok) {
        const nextRoom = normalizeRoomSnapshot(response.room);
        if (nextRoom) updateSelectedRoom(nextRoom);
        else setError('O servidor retornou um save inválido.');
      } else if (response?.error?.code === 'ROOM_NOT_FOUND') {
        tombstoneRoom(code);
        setError(MISSING_SAVE_MESSAGE);
      } else if (response?.error) {
        setError(response.error.message);
      } else {
        setError('O servidor retornou uma resposta inválida.');
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
      const manager = room.managers.find((candidate) => candidate.id === identity.uid) ?? room.managers[0];
      const fixtureSchedule = createOfflineFixtureSchedule(identity.uid, manager?.clubId ?? null);
      return {
        ...room,
        status: 'active',
        startedAt,
        seasonStartedAt: room.seasonStartedAt ?? startedAt,
        revision: room.revision + 1,
        scheduleVersion: 1,
        fixtureSchedule,
        currentFixtureId: fixtureSchedule[0]?.fixtureId ?? null,
        matchReadiness: { fixtureId: fixtureSchedule[0]?.fixtureId ?? null, managerIds: [] },
        completedFixtureIds: [],
        completedMatches: [],
      };
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
