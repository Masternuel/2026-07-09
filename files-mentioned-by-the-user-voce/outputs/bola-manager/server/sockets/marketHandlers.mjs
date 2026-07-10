import { randomUUID } from "node:crypto";
import { marketBidSchema, marketOfferSchema, parseOrThrow } from "../schemas.mjs";
import { channelForManager, channelForRoom, registerSafe } from "./helpers.mjs";

export function registerMarketHandlers(io, socket, { store, now = () => new Date() }) {
  const user = socket.data.user;

  registerSafe(socket, "market:offer", async (payload) => {
    const data = parseOrThrow(marketOfferSchema, payload);
    const room = await store.requireMembership(data.code, user.uid);
    if (!room.managerIds.includes(data.recipientId)) {
      const error = new Error("Destinatario nao pertence a sala");
      error.code = "RECIPIENT_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    const offer = {
      id: randomUUID(),
      code: data.code,
      senderId: user.uid,
      recipientId: data.recipientId,
      playerId: data.playerId,
      amount: data.amount,
      message: data.message || null,
      status: "received",
      createdAt: now().toISOString(),
      persistent: false,
    };
    io.to(channelForManager(user.uid))
      .to(channelForManager(data.recipientId))
      .emit("market:offer", offer);
    return { offer };
  });

  registerSafe(socket, "market:bid", async (payload) => {
    const data = parseOrThrow(marketBidSchema, payload);
    await store.requireMembership(data.code, user.uid);
    const bid = {
      id: randomUUID(),
      code: data.code,
      auctionId: data.auctionId,
      bidderId: user.uid,
      amount: data.amount,
      receivedAt: now().toISOString(),
      status: "scaffold-only",
      persistent: false,
    };
    io.to(channelForRoom(data.code)).emit("market:bid", bid);
    return { bid };
  });
}

