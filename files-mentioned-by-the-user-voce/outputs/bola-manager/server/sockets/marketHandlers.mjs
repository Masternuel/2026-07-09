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
  error.public = true;
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

async function withMarketMutationLock({
  matchSessions,
  matchSessionStore,
  distributedLocks,
  matchLockTtlMs,
}, code, mutation) {
  try {
    const run = async () => {
      await assertMarketMutable(matchSessions, matchSessionStore, code);
      return mutation();
    };
    return distributedLocks
      ? await distributedLocks.withLock(`match:${code}`, run, {
          ttlMs: matchLockTtlMs,
          waitTimeoutMs: 0,
        })
      : await run();
  } catch (error) {
    if (["DISTRIBUTED_LOCK_TIMEOUT", "DISTRIBUTED_LOCK_LOST"].includes(error?.code)) {
      throw marketError(
        "A partida em andamento precisa terminar antes de negociar jogadores",
        "MATCH_IN_PROGRESS",
      );
    }
    throw error;
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

export function registerMarketHandlers(io, socket, {
  store,
  matchSessions,
  matchSessionStore,
  distributedLocks,
  matchLockTtlMs,
}) {
  const user = socket.data.user;
  const mutationContext = {
    matchSessions,
    matchSessionStore,
    distributedLocks,
    matchLockTtlMs,
  };

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
    return withMarketMutationLock(mutationContext, data.code, async () => {
      const result = await store.createMarketOffer(data.code, user.uid, data);
      return mutationResponse(io, data.code, "offer", result);
    });
  });

  registerSafe(socket, "market:respond", async (payload) => {
    const data = parseOrThrow(marketRespondSchema, payload);
    return withMarketMutationLock(mutationContext, data.code, async () => {
      const result = await store.respondMarketOffer(data.code, user.uid, data);
      return mutationResponse(io, data.code, "offer-response", result);
    });
  });

  registerSafe(socket, "market:list", async (payload) => {
    const data = parseOrThrow(marketListingSchema, payload);
    return withMarketMutationLock(mutationContext, data.code, async () => {
      const result = await store.createMarketListing(data.code, user.uid, data);
      return mutationResponse(io, data.code, "listing", result);
    });
  });

  registerSafe(socket, "market:bid", async (payload) => {
    const data = parseOrThrow(marketBidSchema, payload);
    return withMarketMutationLock(mutationContext, data.code, async () => {
      const result = await store.placeMarketBid(data.code, user.uid, data);
      return mutationResponse(io, data.code, "bid", result);
    });
  });

  registerSafe(socket, "market:cancel-listing", async (payload) => {
    const data = parseOrThrow(marketCancelListingSchema, payload);
    return withMarketMutationLock(mutationContext, data.code, async () => {
      const result = await store.cancelMarketListing(data.code, user.uid, data);
      return mutationResponse(io, data.code, "listing-cancelled", result);
    });
  });

  registerSafe(socket, "market:exercise-loan-option", async (payload) => {
    const data = parseOrThrow(marketExerciseLoanOptionSchema, payload);
    return withMarketMutationLock(mutationContext, data.code, async () => {
      const result = await store.exerciseMarketLoanOption(data.code, user.uid, data);
      return mutationResponse(io, data.code, "loan-option-exercised", result);
    });
  });
}
