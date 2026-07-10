import { Router } from "express";
import { resolveServerFixture } from "../game/fixtures.mjs";
import { parseOrThrow, roomCodeSchema } from "../schemas.mjs";

export function createMatchRouter(store) {
  const router = Router();
  router.get("/:code/fixture", async (request, response, next) => {
    try {
      const code = parseOrThrow(roomCodeSchema, request.params.code);
      const room = await store.requireMembership(code, request.user.uid);
      const fixtureId = typeof request.query.fixtureId === "string" ? request.query.fixtureId : undefined;
      response.json({ fixture: resolveServerFixture(room, fixtureId) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

