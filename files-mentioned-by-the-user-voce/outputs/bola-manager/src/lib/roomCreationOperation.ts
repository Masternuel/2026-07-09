import type { Room, RoomCreatePayload } from '../types';

type CreationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const inFlight = new Map<string, Promise<Room>>();
const validId = (value: string) => /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);

export function createRoomOnce(
  account: string,
  payload: RoomCreatePayload,
  send: (payload: RoomCreatePayload) => Promise<Room>,
  storage: CreationStorage = window.localStorage,
): Promise<Room> {
  const canonical = JSON.stringify({
    name: payload.name.trim(),
    clubId: payload.clubId?.trim() || null,
    activeLeagues: [...new Set((payload.activeLeagues ?? ['BR-A', 'BR-B']).map((id) => id.trim()))].sort(),
    seasonLength: payload.seasonLength ?? 1,
    unlimitedSeasons: payload.unlimitedSeasons ?? false,
    maxManagers: payload.maxManagers ?? 6,
  });
  const key = `bola-manager:room-create:${encodeURIComponent(account)}:${encodeURIComponent(canonical)}`;
  const stored = storage.getItem(key);
  const explicitId = payload.operationId ?? payload.requestId;
  const operationId = explicitId ?? stored ?? crypto.randomUUID();
  if (!validId(operationId) || (payload.operationId && payload.requestId && payload.operationId !== payload.requestId)) {
    throw new Error('Identificador de criação inválido.');
  }
  const flightKey = `${key}:${operationId}`;
  const previous = inFlight.get(flightKey);
  if (previous) return previous;
  // Persist before sending; failed requests keep the ID across reload/reconnect.
  storage.setItem(key, operationId);
  const request = Promise.resolve()
    .then(() => send({ ...payload, operationId, requestId: operationId }))
    .then((room) => {
      if (storage.getItem(key) === operationId) storage.removeItem(key);
      return room;
    })
    .catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ROOM_CREATION_GONE'
        && storage.getItem(key) === operationId) storage.removeItem(key);
      throw error;
    })
    .finally(() => { if (inFlight.get(flightKey) === request) inFlight.delete(flightKey); });
  inFlight.set(flightKey, request);
  return request;
}
