import { registerChatHandlers } from "./chatHandlers.mjs";
import { registerMatchHandlers } from "./matchHandlers.mjs";
import { registerMarketHandlers } from "./marketHandlers.mjs";
import { registerRoomHandlers } from "./roomHandlers.mjs";
import { channelForManager } from "./helpers.mjs";

export function registerSocketHandlers(io, options) {
  const matchSessions = new Map();
  const deletingRooms = new Set();
  const deletedRooms = new Set();

  io.on("connection", (socket) => {
    socket.join(channelForManager(socket.data.user.uid));
    socket.emit("server:ready", { socketId: socket.id });
    registerRoomHandlers(io, socket, { ...options, matchSessions, deletingRooms, deletedRooms });
    registerChatHandlers(io, socket, options);
    registerMatchHandlers(io, socket, { ...options, matchSessions, deletingRooms, deletedRooms });
    registerMarketHandlers(io, socket, options);
  });

  return {
    close() {
      for (const session of matchSessions.values()) session.playback?.cancel();
      matchSessions.clear();
      deletingRooms.clear();
      deletedRooms.clear();
    },
  };
}
