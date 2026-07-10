import { Router } from "express";
import { parseOrThrow, roomCodeSchema } from "../schemas.mjs";

export function createMarketRouter(store, firestore) {
  const router = Router();
  router.get("/:code", async (request, response, next) => {
    try {
      const code = parseOrThrow(roomCodeSchema, request.params.code);
      await store.requireMembership(code, request.user.uid);
      if (!firestore) {
        response.json({ listings: [], source: "market-scaffold" });
        return;
      }
      const snapshot = await firestore.collection("marketListings")
        .where("roomCode", "==", code)
        .limit(100)
        .get();
      response.json({ listings: snapshot.docs.map((document) => document.data()), source: "firestore" });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

