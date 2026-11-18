import { Router } from "express";
import { z } from "zod";
import { parseOrThrow, roomCodeSchema } from "../schemas.mjs";

const identifier = z.string().trim().min(1).max(128);
const querySchema = z.object({ playerId: identifier.optional() }).strict();
const actionSchema = z.object({
  operationId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/),
  clubId: identifier,
  playerId: identifier,
  action: z.enum(["watch", "unwatch", "interest", "withdraw-interest", "contact-agent"]),
}).strict();

export function createScoutingRouter(store) {
  const router = Router();
  router.get("/:code", async (request, response, next) => {
    try {
      const code = parseOrThrow(roomCodeSchema, request.params.code);
      const { playerId } = parseOrThrow(querySchema, request.query);
      response.json({ snapshot: await store.getScoutingSnapshot(code, request.user.uid, playerId) });
    } catch (error) { next(error); }
  });
  router.post("/:code", async (request, response, next) => {
    try {
      const code = parseOrThrow(roomCodeSchema, request.params.code);
      const input = parseOrThrow(actionSchema, request.body);
      response.json(await store.updateScouting(code, request.user.uid, input));
    } catch (error) { next(error); }
  });
  return router;
}
