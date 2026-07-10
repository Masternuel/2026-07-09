import {
  createRoomSchema,
  joinRoomSchema,
  parseOrThrow,
  readyRoomSchema,
  roomCodeSchema,
  startRoomSchema,
} from "../schemas.mjs";
import { channelForRoom, registerSafe, rememberMembership } from "./helpers.mjs";

export function registerRoomHandlers(io, socket, { store }) {
  const user = socket.data.user;

  registerSafe(socket, "room:create", async (payload) => {
    const data = parseOrThrow(createRoomSchema, payload);
    const room = await store.createRoom({
      ...data,
      creatorId: user.uid,
      creatorName: user.name,
    });
    rememberMembership(socket, room.code);
    io.to(channelForRoom(room.code)).emit("room:state", room);
    return { room };
  });

  registerSafe(socket, "room:join", async (payload) => {
    const code = parseOrThrow(roomCodeSchema, payload.code);
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
    rememberMembership(socket, code);
    if (room.status === "waiting") io.to(channelForRoom(code)).emit("room:state", room);
    else socket.emit("room:state", room);
    return { room };
  });

  const resume = async (payload) => {
    const code = parseOrThrow(roomCodeSchema, payload.code);
    const room = await store.requireMembership(code, user.uid);
    rememberMembership(socket, code);
    socket.emit("room:state", room);
    return { room };
  };
  registerSafe(socket, "room:resume", resume);
  registerSafe(socket, "room:sync", resume);

  registerSafe(socket, "room:ready", async (payload) => {
    const code = parseOrThrow(roomCodeSchema, payload.code);
    const data = parseOrThrow(readyRoomSchema, {
      managerId: payload.managerId,
      ready: payload.ready,
      clubId: payload.clubId,
    });
    const room = await store.setReady(code, user.uid, data.ready, data.clubId);
    rememberMembership(socket, code);
    io.to(channelForRoom(code)).emit("room:state", room);
    return { room };
  });

  registerSafe(socket, "room:start", async (payload) => {
    const code = parseOrThrow(roomCodeSchema, payload.code);
    parseOrThrow(startRoomSchema, { managerId: payload.managerId });
    const room = await store.startRoom(code, user.uid);
    io.to(channelForRoom(code)).emit("room:started", room);
    io.to(channelForRoom(code)).emit("room:state", room);
    return { room };
  });
}
