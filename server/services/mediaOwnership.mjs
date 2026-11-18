import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MEDIA_KINDS = { clubs: "crest", players: "avatar", tournaments: "trophy" };

export function mediaOwnershipError() {
  return Object.assign(new Error("Propriedade da imagem nao comprovada para este registro"), {
    code: "EDITOR_MEDIA_OWNERSHIP_INVALID", status: 403,
  });
}

export function mediaScope({ ownerId, entity, recordId } = {}) {
  if (typeof ownerId !== "string" || !ownerId.trim() || !MEDIA_KINDS[entity]
    || typeof recordId !== "string" || !recordId.trim()) throw mediaOwnershipError();
  return { ownerId, entity, recordId, kind: MEDIA_KINDS[entity] };
}

export function mediaHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function mediaBinding(scope, objectId, secret) {
  const { ownerId, entity, recordId } = mediaScope(scope);
  return createHmac("sha256", secret).update(JSON.stringify([ownerId, entity, recordId, objectId])).digest("hex");
}

export function verifyMediaBinding(scope, objectId, signature, secret) {
  const expected = Buffer.from(mediaBinding(scope, objectId, secret));
  const received = Buffer.from(signature ?? "");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw mediaOwnershipError();
}

// URLs externas continuam editaveis; identificadores de exclusao pertencem ao servidor.
export function withoutClientMediaPaths(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { crestImagePath, avatarImagePath, trophyImagePath, ...fields } = value;
  return fields;
}
