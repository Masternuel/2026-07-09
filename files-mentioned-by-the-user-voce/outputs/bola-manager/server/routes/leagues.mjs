import { Router } from "express";
import { catalogForRequest } from "../store/catalogScope.mjs";

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createLeaguesRouter(catalogStore, roomStore = null) {
  const router = Router();
  router.get("/", asyncRoute(async (request, response) => {
    const roomCode = String(request.query?.roomCode ?? "").trim();
    if (roomCode && typeof roomStore?.requireMembership === "function") {
      const room = await roomStore.requireMembership(roomCode, request.user?.uid);
      if (Array.isArray(room.competitionCatalog) && room.competitionCatalog.length > 0) {
        const leagues = room.competitionCatalog.map((league, index) => ({
          id: league.id,
          name: league.name ?? league.id,
          country: league.country ?? "",
          division: league.division ?? league.name ?? league.id,
          level: Number.isInteger(Number(league.level)) ? Number(league.level) : index + 1,
          active: true,
          clubCount: Array.isArray(league.clubs) ? league.clubs.length : 0,
        }));
        response.json({ leagues, count: leagues.length, source: "room-save" });
        return;
      }
    }
    const activeCatalog = await catalogForRequest(catalogStore, roomStore, request);
    response.json(await activeCatalog.listActiveLeagues());
  }));
  return router;
}
