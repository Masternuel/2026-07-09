import { Router } from "express";
import { z } from "zod";
import { parseOrThrow } from "../schemas.mjs";

const querySchema = z.object({
  country: z.string().trim().min(2).max(60).optional(),
  division: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
}).strict();

export function createTeamsRouter(firestore) {
  const router = Router();
  router.get("/", async (request, response, next) => {
    try {
      const filters = parseOrThrow(querySchema, request.query);
      if (!firestore) {
        response.json({ teams: [], source: "brasfoot-not-loaded" });
        return;
      }
      let query = firestore.collection("brasfootClubs");
      if (filters.country) query = query.where("country", "==", filters.country);
      if (filters.division) query = query.where("division", "==", filters.division);
      const snapshot = await query.limit(filters.limit).get();
      response.json({ teams: snapshot.docs.map((document) => document.data()), source: "firestore" });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

