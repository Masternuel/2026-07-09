import { Router } from "express";
import {
  createRoomSchema,
  joinRoomSchema,
  parseOrThrow,
  readyRoomSchema,
  roomCodeSchema,
  startRoomSchema,
} from "../schemas.mjs";

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createRoomsRouter(store) {
  const router = Router();

  router.get("/", asyncRoute(async (request, response) => {
    const rooms = await store.listRoomsForManager(request.user.uid);
    response.json({ rooms });
  }));

  router.post("/", asyncRoute(async (request, response) => {
    const payload = parseOrThrow(createRoomSchema, request.body);
    const room = await store.createRoom({
      ...payload,
      creatorId: request.user.uid,
      creatorName: request.user.name,
    });
    response.status(201).json({ room });
  }));

  router.get("/:code", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const room = await store.requireMembership(code, request.user.uid);
    response.json({ room });
  }));

  router.post("/:code/join", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(joinRoomSchema, request.body);
    const room = await store.joinRoom(code, {
      ...payload,
      managerId: request.user.uid,
      managerName: request.user.name,
    });
    response.json({ room });
  }));

  router.patch("/:code/ready", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(readyRoomSchema, request.body);
    const room = await store.setReady(code, request.user.uid, payload.ready, payload.clubId);
    response.json({ room });
  }));

  router.post("/:code/start", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    parseOrThrow(startRoomSchema, request.body ?? {});
    const room = await store.startRoom(code, request.user.uid);
    response.json({ room });
  }));

  return router;
}

