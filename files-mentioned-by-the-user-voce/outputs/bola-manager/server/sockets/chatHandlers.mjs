import { randomUUID } from "node:crypto";
import { chatMessageSchema, parseOrThrow } from "../schemas.mjs";
import { channelForManager, channelForRoom, registerSafe } from "./helpers.mjs";

export function registerChatHandlers(io, socket, { store, now = () => new Date() }) {
  const user = socket.data.user;

  registerSafe(socket, "chat:send", async (payload) => {
    const data = parseOrThrow(chatMessageSchema, payload);
    const room = await store.requireMembership(data.code, user.uid);
    const manager = room.managers.find((candidate) => candidate.id === user.uid);
    const message = {
      id: randomUUID(),
      code: data.code,
      managerId: user.uid,
      managerName: manager.name,
      message: data.message,
      sentAt: now().toISOString(),
    };
    io.to(channelForRoom(data.code)).emit("chat:message", message);
    return { message };
  });

  registerSafe(socket, "chat:direct", async (payload) => {
    const schema = chatMessageSchema.extend({
      recipientId: chatMessageSchema.shape.managerId.unwrap(),
    });
    const data = parseOrThrow(schema, payload);
    const room = await store.requireMembership(data.code, user.uid);
    const sender = room.managers.find((manager) => manager.id === user.uid);
    const recipient = room.managers.find((manager) => manager.id === data.recipientId);
    if (!recipient) {
      const error = new Error("Destinatario nao pertence a sala");
      error.code = "RECIPIENT_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    const message = {
      id: randomUUID(),
      code: data.code,
      managerId: user.uid,
      managerName: sender.name,
      recipientId: recipient.id,
      message: data.message,
      sentAt: now().toISOString(),
    };
    io.to(channelForManager(user.uid))
      .to(channelForManager(recipient.id))
      .emit("chat:direct-message", message);
    return { message };
  });
}

