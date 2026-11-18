import { Router } from "express";
import { parseOrThrow, roomCodeSchema } from "../schemas.mjs";

export function createMarketRouter(store) {
  const router = Router();
  router.get("/:code", async (request, response, next) => {
    try {
      const code = parseOrThrow(roomCodeSchema, request.params.code);
      const snapshot = await store.getMarketSnapshot(code, request.user.uid);
      response.json({ snapshot });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
