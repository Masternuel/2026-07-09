import { channelForRoom } from "../sockets/helpers.mjs";

export function roomForViewer(room, viewerId) {
  if (!room) return room;
  const visible = structuredClone(room);
  visible.lineups = Array.isArray(visible.lineups)
    ? visible.lineups.filter((lineup) => lineup.managerId === viewerId)
    : [];
  return visible;
}

export async function emitRoomForViewers(io, room, eventName = "room:state") {
  const sockets = await io.in(channelForRoom(room.code)).fetchSockets();
  for (const target of sockets) {
    target.emit(eventName, roomForViewer(room, target.data.user?.uid));
  }
}
