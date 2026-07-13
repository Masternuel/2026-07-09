import { Router, raw } from "express";
import {
  brasfootImportCommitSchema,
  brasfootImportFileQuerySchema,
  brasfootImportSessionIdSchema,
  editorCatalogQuerySchema,
  editorCreateSchemas,
  editorEntitySchema,
  editorListQuerySchema,
  editorMediaUploadQuerySchema,
  editorPatchSchemas,
  editorRecordIdSchema,
  mediaKindForEntity,
} from "../editorSchemas.mjs";
import { parseOrThrow } from "../schemas.mjs";
import { BRASFOOT_IMPORT_LIMITS } from "../services/brasfootImportSessions.mjs";
import { MAX_EDITOR_MEDIA_BYTES } from "../services/catalogMedia.mjs";

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

const parseMediaBody = raw({
  type: ["image/png", "image/jpeg", "image/webp"],
  limit: MAX_EDITOR_MEDIA_BYTES,
});

const parseBrasfootFileBody = raw({
  type: "application/octet-stream",
  limit: BRASFOOT_IMPORT_LIMITS.maxFileBytes,
});

function mediaBody(request, response, next) {
  parseMediaBody(request, response, (error) => {
    if (error?.type === "entity.too.large") {
      error.code = "EDITOR_MEDIA_TOO_LARGE";
      error.message = "A imagem excede o limite de 5 MB";
      error.status = 413;
      error.details = { maximumBytes: MAX_EDITOR_MEDIA_BYTES };
    }
    next(error);
  });
}

function brasfootFileBody(request, response, next) {
  parseBrasfootFileBody(request, response, (error) => {
    if (error?.type === "entity.too.large") {
      error.code = "BRASFOOT_IMPORT_FILE_TOO_LARGE";
      error.message = "O arquivo excede o limite de 32 MB";
      error.status = 413;
      error.details = { maximumBytes: BRASFOOT_IMPORT_LIMITS.maxFileBytes };
    }
    next(error);
  });
}

function requiredBrasfootImportService(options) {
  if (options.brasfootImportService) return options.brasfootImportService;
  const error = new Error("Importacao Brasfoot indisponivel");
  error.code = "BRASFOOT_IMPORT_UNAVAILABLE";
  error.status = 503;
  throw error;
}

function normalizedAdminUids(value) {
  if (Array.isArray(value)) return new Set(value.map(String).map((uid) => uid.trim()).filter(Boolean));
  return new Set(String(value ?? "").split(",").map((uid) => uid.trim()).filter(Boolean));
}

export function canEditCatalog(user, {
  nodeEnv,
  allowLocalEditor = false,
  editorAdminUids = [],
} = {}) {
  if (!user || user.authType !== "firebase") return false;
  if (user.editor === true) return true;
  const allowedUids = normalizedAdminUids(editorAdminUids);
  if (allowedUids.has(user.uid)) return true;
  return ["development", "test"].includes(nodeEnv)
    && allowLocalEditor === true
    && allowedUids.size === 0;
}

function requireEditor(options) {
  return (request, _response, next) => {
    if (canEditCatalog(request.user, options)) {
      next();
      return;
    }
    const error = new Error("Acesso ao Editor da Base nao autorizado");
    error.code = "EDITOR_FORBIDDEN";
    error.status = 403;
    next(error);
  };
}

export function createEditorRouter(catalogStore, mediaService, options = {}) {
  const router = Router();

  router.get("/access", (request, response) => {
    response.json({ canEdit: canEditCatalog(request.user, options) });
  });

  router.use(requireEditor(options));

  router.post("/brasfoot-import/sessions", asyncRoute(async (request, response) => {
    const service = requiredBrasfootImportService(options);
    const session = await service.createSession({ ownerId: request.user.uid });
    response.status(201).json(session);
  }));

  router.put("/brasfoot-import/sessions/:id/files", brasfootFileBody, asyncRoute(async (request, response) => {
    const service = requiredBrasfootImportService(options);
    const sessionId = parseOrThrow(brasfootImportSessionIdSchema, request.params.id);
    const query = parseOrThrow(brasfootImportFileQuerySchema, request.query);
    const result = await service.uploadFile({
      sessionId,
      ownerId: request.user.uid,
      path: query.path,
      bytes: request.body,
    });
    response.status(201).json(result);
  }));

  router.post("/brasfoot-import/sessions/:id/preview", asyncRoute(async (request, response) => {
    const service = requiredBrasfootImportService(options);
    const sessionId = parseOrThrow(brasfootImportSessionIdSchema, request.params.id);
    response.json(await service.preview({ sessionId, ownerId: request.user.uid }));
  }));

  router.post("/brasfoot-import/sessions/:id/commit", asyncRoute(async (request, response) => {
    const service = requiredBrasfootImportService(options);
    const sessionId = parseOrThrow(brasfootImportSessionIdSchema, request.params.id);
    const input = parseOrThrow(brasfootImportCommitSchema, request.body);
    response.json(await service.commit({ sessionId, ownerId: request.user.uid, ...input }));
  }));

  router.delete("/brasfoot-import/sessions/:id", asyncRoute(async (request, response) => {
    const service = requiredBrasfootImportService(options);
    const sessionId = parseOrThrow(brasfootImportSessionIdSchema, request.params.id);
    response.json(await service.deleteSession({ sessionId, ownerId: request.user.uid }));
  }));

  router.get("/catalog", asyncRoute(async (request, response) => {
    const query = parseOrThrow(editorCatalogQuerySchema, request.query);
    response.json(await catalogStore.list(query));
  }));

  router.get("/:entity", asyncRoute(async (request, response) => {
    const entity = parseOrThrow(editorEntitySchema, request.params.entity);
    const query = parseOrThrow(editorListQuerySchema, request.query);
    if (query.clubId && entity !== "players") {
      const error = new Error("clubId so pode filtrar jogadores");
      error.code = "EDITOR_FILTER_INVALID";
      error.status = 400;
      throw error;
    }
    response.json(await catalogStore.listPage(entity, query));
  }));

  router.post("/media", mediaBody, asyncRoute(async (request, response) => {
    const query = parseOrThrow(editorMediaUploadQuerySchema, request.query);
    await catalogStore.get(query.entity, query.id);
    const media = await mediaService.upload({
      entity: query.entity,
      recordId: query.id,
      kind: query.kind ?? mediaKindForEntity(query.entity),
      mimeType: request.headers["content-type"],
      bytes: request.body,
      uploadedBy: request.user.uid,
    });
    let association;
    try {
      association = await catalogStore.associateMedia(query.entity, query.id, media, request.user.uid);
    } catch (error) {
      await mediaService.remove(media.path).catch(() => {});
      throw error;
    }
    let previousMediaRemoved = true;
    if (association.previousPath && association.previousPath !== media.path) {
      try {
        await mediaService.remove(association.previousPath);
      } catch {
        previousMediaRemoved = false;
      }
    }
    response.status(201).json({
      media,
      record: association.record,
      previousMediaRemoved,
    });
  }));

  router.delete("/media", asyncRoute(async (request, response) => {
    const query = parseOrThrow(editorMediaUploadQuerySchema, request.query);
    const association = await catalogStore.clearMedia(query.entity, query.id, request.user.uid);
    let mediaRemoved = true;
    if (association.previousPath) {
      try {
        await mediaService.remove(association.previousPath);
      } catch {
        mediaRemoved = false;
      }
    }
    response.json({ record: association.record, mediaRemoved });
  }));

  router.post("/:entity", asyncRoute(async (request, response) => {
    const entity = parseOrThrow(editorEntitySchema, request.params.entity);
    const input = parseOrThrow(editorCreateSchemas[entity], request.body);
    const record = await catalogStore.create(entity, input, request.user.uid);
    response.status(201).json({ record });
  }));

  router.patch("/:entity/:id", asyncRoute(async (request, response) => {
    const entity = parseOrThrow(editorEntitySchema, request.params.entity);
    const id = parseOrThrow(editorRecordIdSchema, request.params.id);
    const changes = parseOrThrow(editorPatchSchemas[entity], request.body);
    const record = await catalogStore.update(entity, id, changes, request.user.uid);
    response.json({ record });
  }));

  router.delete("/:entity/:id", asyncRoute(async (request, response) => {
    const entity = parseOrThrow(editorEntitySchema, request.params.entity);
    const id = parseOrThrow(editorRecordIdSchema, request.params.id);
    const { previousPath, ...deletion } = await catalogStore.delete(entity, id);
    let mediaRemoved = true;
    if (previousPath) {
      try {
        await mediaService.remove(previousPath);
      } catch {
        mediaRemoved = false;
      }
    }
    response.json({ ...deletion, mediaRemoved });
  }));

  return router;
}
