import { Router } from "express";
import { catalogForRequest } from "../store/catalogScope.mjs";

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createTournamentsRouter(catalogStore, roomStore = null) {
  const router = Router();
  router.get("/", asyncRoute(async (request, response) => {
    const roomCode = String(request.query?.roomCode ?? "").trim();
    if (roomCode && typeof roomStore?.requireMembership === "function") {
      const room = await roomStore.requireMembership(roomCode, request.user?.uid);
      const tournaments = Array.isArray(room.tournamentCatalog) ? room.tournamentCatalog : [];
      response.json({ tournaments, count: tournaments.length, source: "room-save" });
      return;
    }
    const activeCatalog = await catalogForRequest(catalogStore, roomStore, request);
    response.json(await activeCatalog.listActiveTournaments());
  }));
  return router;
}
