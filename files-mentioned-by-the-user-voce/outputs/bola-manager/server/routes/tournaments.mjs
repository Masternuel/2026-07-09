import { Router } from "express";

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createTournamentsRouter(catalogStore) {
  const router = Router();
  router.get("/", asyncRoute(async (_request, response) => {
    response.json(await catalogStore.listActiveTournaments());
  }));
  return router;
}
