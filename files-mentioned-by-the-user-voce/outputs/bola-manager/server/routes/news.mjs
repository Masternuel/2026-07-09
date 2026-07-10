import { Router } from "express";
import { parseOrThrow, roomCodeSchema } from "../schemas.mjs";

export function createNewsRouter(store, firestore) {
  const router = Router();
  router.get("/:code", async (request, response, next) => {
    try {
      const code = parseOrThrow(roomCodeSchema, request.params.code);
      await store.requireMembership(code, request.user.uid);
      if (!firestore) {
        response.json({ news: [], source: "news-not-loaded" });
        return;
      }
      const snapshot = await firestore.collection("news")
        .where("roomCode", "==", code)
        .limit(50)
        .get();
      response.json({ news: snapshot.docs.map((document) => document.data()), source: "firestore" });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

