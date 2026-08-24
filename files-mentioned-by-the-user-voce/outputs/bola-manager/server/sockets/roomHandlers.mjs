import {
  createRoomSchema,
  joinRoomSchema,
  parseOrThrow,
  readyRoomSchema,
  roomCodeSchema,
  startRoomSchema,
} from "../schemas.mjs";
import { emitRoomForViewers, roomForViewer } from "../services/roomVisibility.mjs";
import { channelForManager, channelForRoom, registerSafe, rememberMembership } from "./helpers.mjs";

function roomError(message, code, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function assertRoomAvailable(code, deletingRooms, deletedRooms) {
  if (deletingRooms.has(code) || deletedRooms.has(code)) {
    throw roomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
  }
}

export function registerRoomHandlers(io, socket, {
  store,
  matchSessions,
  matchSessionStore,
  deletingRooms,
  deletedRooms,
}) {
  const user = socket.data.user;

  registerSafe(socket, "room:create", async (payload) => {
    const data = parseOrThrow(createRoomSchema, payload);
    const room = await store.createRoom({
      ...data,
      creatorId: user.uid,
      creatorName: user.name,
    });
    assertRoomAvailable(room.code, deletingRooms, deletedRooms);
    rememberMembership(socket, room.code);
    await emitRoomForViewers(io, room);
    return { room: roomForViewer(room, user.uid) };
  });

  registerSafe(socket, "room:join", async (payload) => {
    const code = parseOrThrow(roomCodeSchema, payload.code);
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    const data = parseOrThrow(joinRoomSchema, {
      managerId: payload.managerId,
      managerName: payload.managerName,
      clubId: payload.clubId,
    });
    const room = await store.joinRoom(code, {
      ...data,
      managerId: user.uid,
      managerName: user.name,
    });
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    rememberMembership(socket, code);
    if (room.status === "waiting") await emitRoomForViewers(io, room);
    else socket.emit("room:state", roomForViewer(room, user.uid));
    return { room: roomForViewer(room, user.uid) };
  });

  const resume = async (payload) => {
    const code = parseOrThrow(roomCodeSchema, payload.code);
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    const room = await store.requireViewerRoom(code, user.uid);
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    rememberMembership(socket, code);
    socket.emit("room:state", roomForViewer(room, user.uid));
    return { room: roomForViewer(room, user.uid) };
  };
  registerSafe(socket, "room:resume", resume);
  registerSafe(socket, "room:sync", resume);

  registerSafe(socket, "room:ready", async (payload) => {
    const code = parseOrThrow(roomCodeSchema, payload.code);
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    const data = parseOrThrow(readyRoomSchema, {
      managerId: payload.managerId,
      ready: payload.ready,
      clubId: payload.clubId,
    });
    const room = await store.setReady(code, user.uid, data.ready, data.clubId);
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    rememberMembership(socket, code);
    await emitRoomForViewers(io, room);
    return { room: roomForViewer(room, user.uid) };
  });

  registerSafe(socket, "room:start", async (payload) => {
    const code = parseOrThrow(roomCodeSchema, payload.code);
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    parseOrThrow(startRoomSchema, { managerId: payload.managerId });
    const room = await store.startRoom(code, user.uid);
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    await emitRoomForViewers(io, room, "room:started");
    await emitRoomForViewers(io, room);
    return { room: roomForViewer(room, user.uid) };
  });

  registerSafe(socket, "room:delete", async (payload) => {
    const code = parseOrThrow(roomCodeSchema, payload.code);
    await store.requireDeleteOwnership(code, user.uid);
    if (deletingRooms.has(code)) {
      throw roomError("A temporada ja esta sendo excluida", "ROOM_DELETE_IN_PROGRESS");
    }
    deletingRooms.add(code);
    try {
      if (matchSessions.has(code) || await matchSessionStore.has(code)) {
        throw roomError("A partida em andamento precisa terminar antes de excluir a temporada", "MATCH_IN_PROGRESS");
      }
      const deletedRoom = await store.deleteRoom(code, user.uid);
      deletedRooms.add(code);
      const deleted = { code };
      let recipients = io.to(channelForRoom(code));
      for (const managerId of deletedRoom.managerIds) {
        recipients = recipients.to(channelForManager(managerId));
      }
      recipients.emit("room:deleted", deleted);
      io.in(channelForRoom(code)).socketsLeave(channelForRoom(code));
      return deleted;
    } finally {
      deletingRooms.delete(code);
    }
  });
}
