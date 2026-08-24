import {
  marketBidSchema,
  marketCancelListingSchema,
  marketExerciseLoanOptionSchema,
  marketListingSchema,
  marketOfferSchema,
  marketRespondSchema,
  marketSyncSchema,
  parseOrThrow,
} from "../schemas.mjs";
import { channelForRoom, registerSafe, rememberMembership } from "./helpers.mjs";

function marketError(message, code, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function assertMarketMutable(matchSessions, matchSessionStore, code) {
  if (matchSessions?.has(code) || await matchSessionStore?.has?.(code)) {
    throw marketError(
      "A partida em andamento precisa terminar antes de negociar jogadores",
      "MATCH_IN_PROGRESS",
    );
  }
}

function mutationResponse(io, code, reason, result) {
  const revision = Number(result?.revision ?? result?.snapshot?.revision ?? 0);
  return {
    ...result,
    afterAcknowledgement: marketUpdate(io, code, revision, reason),
  };
}

function marketUpdate(io, code, revision, reason) {
  return () => {
    io.to(channelForRoom(code)).emit("market:updated", { code, revision, reason });
  };
}

export function registerMarketHandlers(io, socket, { store, matchSessions, matchSessionStore }) {
  const user = socket.data.user;

  registerSafe(socket, "market:sync", async (payload) => {
    const data = parseOrThrow(marketSyncSchema, payload);
    const result = await store.getMarketSnapshot(data.code, user.uid, { withMetadata: true });
    const snapshot = result?.snapshot ?? result;
    rememberMembership(socket, data.code);
    return {
      snapshot,
      ...(result?.settlementChanged === true
        ? { afterAcknowledgement: marketUpdate(io, data.code, Number(snapshot?.revision ?? 0), "settlement") }
        : {}),
    };
  });

  registerSafe(socket, "market:offer", async (payload) => {
    const data = parseOrThrow(marketOfferSchema, payload);
    await assertMarketMutable(matchSessions, matchSessionStore, data.code);
    const result = await store.createMarketOffer(data.code, user.uid, data);
    return mutationResponse(io, data.code, "offer", result);
  });

  registerSafe(socket, "market:respond", async (payload) => {
    const data = parseOrThrow(marketRespondSchema, payload);
    await assertMarketMutable(matchSessions, matchSessionStore, data.code);
    const result = await store.respondMarketOffer(data.code, user.uid, data);
    return mutationResponse(io, data.code, "offer-response", result);
  });

  registerSafe(socket, "market:list", async (payload) => {
    const data = parseOrThrow(marketListingSchema, payload);
    await assertMarketMutable(matchSessions, matchSessionStore, data.code);
    const result = await store.createMarketListing(data.code, user.uid, data);
    return mutationResponse(io, data.code, "listing", result);
  });

  registerSafe(socket, "market:bid", async (payload) => {
    const data = parseOrThrow(marketBidSchema, payload);
    await assertMarketMutable(matchSessions, matchSessionStore, data.code);
    const result = await store.placeMarketBid(data.code, user.uid, data);
    return mutationResponse(io, data.code, "bid", result);
  });

  registerSafe(socket, "market:cancel-listing", async (payload) => {
    const data = parseOrThrow(marketCancelListingSchema, payload);
    await assertMarketMutable(matchSessions, matchSessionStore, data.code);
    const result = await store.cancelMarketListing(data.code, user.uid, data);
    return mutationResponse(io, data.code, "listing-cancelled", result);
  });

  registerSafe(socket, "market:exercise-loan-option", async (payload) => {
    const data = parseOrThrow(marketExerciseLoanOptionSchema, payload);
    await assertMarketMutable(matchSessions, matchSessionStore, data.code);
    const result = await store.exerciseMarketLoanOption(data.code, user.uid, data);
    return mutationResponse(io, data.code, "loan-option-exercised", result);
  });
}
