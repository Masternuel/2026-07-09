import { randomUUID } from "node:crypto";
import { prepareCatalogMedia } from "../server/services/catalogMedia.mjs";
import { mediaHash, mediaScope, mediaOwnershipError } from "../server/services/mediaOwnership.mjs";
import { LOCAL_MEDIA_FIELDS } from "./localEditorCatalog.mjs";

const PREFIX = "http://127.0.0.1/desktop-media/";
export class LocalEditorMedia {
  constructor(database, ownerId, { origin, assertEditable }) {
    this.database = database; this.ownerId = ownerId; this.origin = origin; this.assertEditable = assertEditable;
    this.provider = "local"; this.configured = true;
  }
  canonicalize(value) {
    if (typeof value !== "string") return value;
    const current = `${this.origin()}/desktop-media/`;
    return value.startsWith(current) ? `${PREFIX}${value.slice(current.length)}` : value;
  }
  project(value) {
    if (typeof value === "string" && value.startsWith(PREFIX)) return `${this.origin()}/desktop-media/${value.slice(PREFIX.length)}`;
    if (Array.isArray(value)) return value.map((item) => this.project(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, this.project(item)]));
    return value;
  }
  async upload({ entity, recordId, kind, mimeType, bytes, uploadedBy }) {
    const scope = mediaScope({ ownerId: uploadedBy, entity, recordId });
    if (scope.ownerId !== this.ownerId || kind !== scope.kind) throw mediaOwnershipError();
    this.assertEditable();
    const prepared = await prepareCatalogMedia(mimeType, bytes);
    const id = randomUUID();
    const path = `editor-media/${entity}/v2/${mediaHash(uploadedBy)}/${mediaHash(recordId)}/${id}.${prepared.mediaType.extension}`;
    await this.database.transaction((state) => {
      this.assertEditable();
      if (state.matches.some((match) => match._matchRemoved !== true)) throw Object.assign(new Error("Encerre a partida antes de editar imagens"), { code: "LOCAL_EDITOR_MATCH_ACTIVE", status: 409, public: true });
      state.catalogMedia ??= {};
      state.catalogMedia[path] = { ...scope, id, mimeType: prepared.mimeType, bytes: prepared.bytes };
    });
    return { provider: "local", path, url: `${PREFIX}${id}`, mimeType: prepared.mimeType };
  }
  async remove(path, ownership) {
    const scope = mediaScope(ownership);
    return this.database.transaction((state) => {
      const asset = state.catalogMedia?.[path];
      if (!asset || scope.ownerId !== this.ownerId || ["ownerId", "entity", "recordId"].some((field) => asset[field] !== scope[field])) throw mediaOwnershipError();
      // An archived career can still need a replaced/deleted Editor image.
      const referenced = [state.catalog, ...Object.values(state.catalogArchives ?? {})].some((catalog) =>
        Object.entries(LOCAL_MEDIA_FIELDS).some(([entity, fields]) => catalog[entity]?.some((record) => record[fields[1]] === path)));
      if (!referenced) delete state.catalogMedia[path];
      return { removed: !referenced, retainedForCareer: referenced };
    });
  }
  async handle(request, response, next) {
    if (!request.path.startsWith("/desktop-media/")) return next();
    if (request.method !== "GET" && request.method !== "HEAD") return response.sendStatus(405);
    const id = request.path.slice("/desktop-media/".length);
    if (!/^[a-f0-9-]{36}$/.test(id)) return response.sendStatus(404);
    // Random asset IDs act as read capabilities, like the old Storage download URLs.
    const asset = await this.database.read((state) => Object.values(state.catalogMedia ?? {}).find((item) => item.id === id));
    if (!asset) return response.sendStatus(404);
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.send(Buffer.from(asset.bytes));
  }
}
