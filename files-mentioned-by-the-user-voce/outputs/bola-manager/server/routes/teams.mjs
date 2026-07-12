import { Router } from "express";
import { FieldPath } from "firebase-admin/firestore";
import { z } from "zod";
import { parseOrThrow } from "../schemas.mjs";

const querySchema = z.object({
  country: z.string().trim().min(2).max(60).optional(),
  division: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().trim().min(1).max(128).optional(),
}).strict();

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function serializeTeam(document) {
  return { ...document.data(), id: document.id };
}

export function createTeamsRouter(firestore) {
  const router = Router();
  router.get("/", asyncRoute(async (request, response) => {
    const filters = parseOrThrow(querySchema, request.query);
    if (!firestore) {
      response.json({ teams: [], count: 0, nextCursor: null, source: "brasfoot-not-loaded" });
      return;
    }
    let query = firestore.collection("brasfootClubs");
    if (filters.country) query = query.where("country", "==", filters.country);
    if (filters.division) query = query.where("division", "==", filters.division);
    query = query.orderBy(FieldPath.documentId());
    if (filters.cursor) query = query.startAfter(filters.cursor);
    const snapshot = await query.limit(filters.limit).get();
    const teams = snapshot.docs.map(serializeTeam);
    const nextCursor = snapshot.docs.length === filters.limit
      ? snapshot.docs.at(-1)?.id ?? null
      : null;
    response.json({ teams, count: teams.length, nextCursor, source: "firestore" });
  }));
  return router;
}
