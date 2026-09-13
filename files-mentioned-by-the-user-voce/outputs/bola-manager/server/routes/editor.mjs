import { Router, raw } from "express";
import {
  brasfootImportCommitSchema,
  brasfootImportFileQuerySchema,
  brasfootImportSessionIdSchema,
  editorBulkDeleteSchema,
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
import { MAX_CATALOG_DATABASE_BYTES } from "../services/catalogDatabase.mjs";
import { catalogForOwner } from "../store/catalogScope.mjs";
import { withoutClientMediaPaths } from "../services/mediaOwnership.mjs";

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

const parseCatalogDatabaseBody = raw({
  type: "application/octet-stream",
  limit: MAX_CATALOG_DATABASE_BYTES,
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

function catalogDatabaseBody(request, response, next) {
  parseCatalogDatabaseBody(request, response, (error) => {
    if (error?.type === "entity.too.large") {
      error.code = "CATALOG_DATABASE_TOO_LARGE";
      error.message = "A base excede o limite de 24 MB";
      error.status = 413;
      error.details = { maximumBytes: MAX_CATALOG_DATABASE_BYTES };
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

export function canEditCatalog(user, _options = {}) {
  // Each Firebase account owns an isolated database, so the Editor is a
  // player feature instead of a single global administrative surface.
  return Boolean(user && user.authType === "firebase" && user.uid);
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
  router.use(asyncRoute(async (request, _response, next) => {
    request.catalogStore = await catalogForOwner(catalogStore, request.user.uid);
    next();
  }));

  router.get("/database/export", asyncRoute(async (request, response) => {
    const database = await request.catalogStore.exportDatabase();
    const filename = `bola-manager-base-${new Date().toISOString().slice(0, 10)}.json`;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    response.send(JSON.stringify(database));
  }));

  router.post("/database/import", catalogDatabaseBody, asyncRoute(async (request, response) => {
    const mode = String(request.query.mode ?? "merge").trim();
    if (mode !== "merge") {
      const error = new Error("Modo de importacao nao suportado; use merge");
      error.code = "CATALOG_DATABASE_MODE_UNSUPPORTED";
      error.status = 400;
      throw error;
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      const error = new Error("Envie a base como arquivo JSON");
      error.code = "CATALOG_DATABASE_BODY_INVALID";
      error.status = 415;
      throw error;
    }
    let database;
    try {
      const json = request.body.toString("utf8").replace(/^\ufeff/, "");
      database = JSON.parse(json);
    } catch {
      const error = new Error("O arquivo da base nao contem um JSON valido");
      error.code = "CATALOG_DATABASE_JSON_INVALID";
      error.status = 400;
      throw error;
    }
    const { previousMediaPaths = [], previousMedia = [], ...result } = await request.catalogStore.importDatabase(
      database,
      request.user.uid,
      { operationId: request.query.operationId },
    );
    // Caminhos antigos sem registro associado nao autorizam remocao no provedor.
    let mediaRemoved = previousMediaPaths.every((path) => previousMedia.some((media) => media.path === path));
    let removedMediaCount = 0;
    for (const media of previousMedia) {
      try {
        await mediaService.remove(media.path, { ...media, ownerId: request.user.uid });
        removedMediaCount += 1;
      } catch {
        mediaRemoved = false;
      }
    }
    response.json({
      ...result,
      mediaRemoved,
      removedMediaCount,
    });
  }));

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
    response.json(await request.catalogStore.list(query));
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
    response.json(await request.catalogStore.listPage(entity, query));
  }));

  router.post("/media", mediaBody, asyncRoute(async (request, response) => {
    const query = parseOrThrow(editorMediaUploadQuerySchema, request.query);
    await request.catalogStore.get(query.entity, query.id);
    const ownership = { ownerId: request.user.uid, entity: query.entity, recordId: query.id };
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
      association = await request.catalogStore.associateMedia(query.entity, query.id, media, request.user.uid);
    } catch (error) {
      try {
        await mediaService.remove(media.path, ownership);
      } catch (cleanupError) {
        options.logger?.warn?.("editor.media_cleanup_failed", { entity: query.entity, code: cleanupError.code });
        error.details = { ...error.details, mediaCleanupFailed: true };
      }
      throw error;
    }
    let previousMediaRemoved = true;
    if (association.previousPath && association.previousPath !== media.path) {
      try {
        await mediaService.remove(association.previousPath, ownership);
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
    const association = await request.catalogStore.clearMedia(query.entity, query.id, request.user.uid);
    let mediaRemoved = true;
    if (association.previousPath) {
      try {
        await mediaService.remove(association.previousPath, { ownerId: request.user.uid, entity: query.entity, recordId: query.id });
      } catch {
        mediaRemoved = false;
      }
    }
    response.json({ record: association.record, mediaRemoved });
  }));

  router.post("/:entity/bulk-delete", asyncRoute(async (request, response) => {
    const entity = parseOrThrow(editorEntitySchema, request.params.entity);
    const { ids } = parseOrThrow(editorBulkDeleteSchema, request.body);
    const { previousPaths, previousMedia, ...deletion } = await request.catalogStore.deleteMany(entity, ids);
    let removedMediaCount = 0;
    let failedMediaCount = 0;
    for (let index = 0; index < previousMedia.length; index += 5) {
      const results = await Promise.allSettled(
        previousMedia.slice(index, index + 5).map((media) => mediaService.remove(media.path, {
          ownerId: request.user.uid, entity, recordId: media.recordId,
        })),
      );
      for (const result of results) {
        if (result.status === "fulfilled") removedMediaCount += 1;
        else failedMediaCount += 1;
      }
    }
    response.json({
      ...deletion,
      mediaRemoved: failedMediaCount === 0,
      removedMediaCount,
      failedMediaCount,
    });
  }));

  router.post("/:entity", asyncRoute(async (request, response) => {
    const entity = parseOrThrow(editorEntitySchema, request.params.entity);
    const input = parseOrThrow(editorCreateSchemas[entity], withoutClientMediaPaths(request.body));
    const record = await request.catalogStore.create(entity, input, request.user.uid);
    response.status(201).json({ record });
  }));

  router.patch("/:entity/:id", asyncRoute(async (request, response) => {
    const entity = parseOrThrow(editorEntitySchema, request.params.entity);
    const id = parseOrThrow(editorRecordIdSchema, request.params.id);
    const changes = parseOrThrow(editorPatchSchemas[entity], withoutClientMediaPaths(request.body));
    const record = await request.catalogStore.update(entity, id, changes, request.user.uid);
    response.json({ record });
  }));

  router.delete("/:entity/:id", asyncRoute(async (request, response) => {
    const entity = parseOrThrow(editorEntitySchema, request.params.entity);
    const id = parseOrThrow(editorRecordIdSchema, request.params.id);
    const { previousPath, ...deletion } = await request.catalogStore.delete(entity, id);
    let mediaRemoved = true;
    if (previousPath) {
      try {
        await mediaService.remove(previousPath, { ownerId: request.user.uid, entity, recordId: id });
      } catch {
        mediaRemoved = false;
      }
    }
    response.json({ ...deletion, mediaRemoved });
  }));

  return router;
}
