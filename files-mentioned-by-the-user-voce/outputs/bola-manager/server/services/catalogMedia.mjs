import { createHash, randomUUID } from "node:crypto";

export const MAX_EDITOR_MEDIA_BYTES = 5 * 1024 * 1024;

const MEDIA_TYPES = Object.freeze({
  "image/png": { extension: "png", signature: "png" },
  "image/jpeg": { extension: "jpg", signature: "jpeg" },
  "image/webp": { extension: "webp", signature: "webp" },
});

export class CatalogMediaError extends Error {
  constructor(message, code, status = 400, details) {
    super(message);
    this.name = "CatalogMediaError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

function normalizedMimeType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function hasPngSignature(buffer) {
  return buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function hasJpegSignature(buffer) {
  return buffer.length >= 5
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
    && buffer.at(-2) === 0xff
    && buffer.at(-1) === 0xd9;
}

function hasWebpSignature(buffer) {
  return buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
}

function matchesSignature(buffer, signature) {
  if (signature === "png") return hasPngSignature(buffer);
  if (signature === "jpeg") return hasJpegSignature(buffer);
  if (signature === "webp") return hasWebpSignature(buffer);
  return false;
}

export function validateCatalogMediaUpload(suppliedMimeType, bytes) {
  const mimeType = normalizedMimeType(suppliedMimeType);
  const mediaType = MEDIA_TYPES[mimeType];
  if (!mediaType) {
    throw new CatalogMediaError(
      "Formato de imagem nao suportado; use PNG, JPEG ou WebP",
      "EDITOR_MEDIA_MIME_UNSUPPORTED",
      415,
    );
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new CatalogMediaError("Envie a imagem no corpo da requisicao", "EDITOR_MEDIA_BODY_REQUIRED", 400);
  }
  if (bytes.length > MAX_EDITOR_MEDIA_BYTES) {
    throw new CatalogMediaError(
      "A imagem excede o limite de 5 MB",
      "EDITOR_MEDIA_TOO_LARGE",
      413,
      { maximumBytes: MAX_EDITOR_MEDIA_BYTES },
    );
  }
  if (!matchesSignature(bytes, mediaType.signature)) {
    throw new CatalogMediaError(
      "O conteudo do arquivo nao corresponde ao tipo de imagem informado",
      "EDITOR_MEDIA_MIME_MISMATCH",
      400,
    );
  }
  return { mimeType, mediaType };
}

function downloadUrl(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
}

function storagePath(entity, recordId, objectId, extension) {
  const recordHash = createHash("sha256").update(String(recordId)).digest("hex").slice(0, 24);
  return `editor-media/${entity}/${recordHash}/${objectId}.${extension}`;
}

export class CatalogMediaService {
  constructor({ bucket = null, idFactory = randomUUID } = {}) {
    this.bucket = bucket;
    this.idFactory = idFactory;
    this.provider = "firebase";
    this.configured = Boolean(bucket && typeof bucket.file === "function" && bucket.name);
  }

  async upload({ entity, recordId, kind, mimeType: suppliedMimeType, bytes, uploadedBy }) {
    if (!this.bucket || typeof this.bucket.file !== "function" || !this.bucket.name) {
      throw new CatalogMediaError(
        "Firebase Storage nao esta configurado no servidor",
        "EDITOR_MEDIA_STORAGE_UNAVAILABLE",
        503,
      );
    }
    const { mimeType, mediaType } = validateCatalogMediaUpload(suppliedMimeType, bytes);

    const objectId = this.idFactory();
    const token = this.idFactory();
    const path = storagePath(entity, recordId, objectId, mediaType.extension);
    const file = this.bucket.file(path);
    try {
      await file.save(bytes, {
        resumable: false,
        validation: "crc32c",
        metadata: {
          contentType: mimeType,
          cacheControl: "public, max-age=31536000, immutable",
          metadata: {
            firebaseStorageDownloadTokens: token,
            uploadedBy: String(uploadedBy),
            mediaEntity: entity,
            mediaKind: kind,
          },
        },
      });
    } catch (error) {
      try {
        await file.delete({ ignoreNotFound: true });
      } catch {
        // Best effort: o erro original de upload continua sendo o mais util para o cliente.
      }
      throw new CatalogMediaError(
        "Firebase Storage nao conseguiu salvar a imagem",
        "EDITOR_MEDIA_UPLOAD_FAILED",
        502,
        { cause: error?.code ? String(error.code) : undefined },
      );
    }

    return {
      entity,
      recordId: String(recordId),
      kind,
      url: downloadUrl(this.bucket.name, path, token),
      path,
      mimeType,
      size: bytes.length,
    };
  }

  async remove(path) {
    if (!this.bucket || typeof this.bucket.file !== "function") {
      throw new CatalogMediaError(
        "Firebase Storage nao esta configurado no servidor",
        "EDITOR_MEDIA_STORAGE_UNAVAILABLE",
        503,
      );
    }
    const normalizedPath = String(path ?? "").trim();
    if (!normalizedPath.startsWith("editor-media/")
      || normalizedPath.includes("..")
      || /[\u0000-\u001f\u007f]/.test(normalizedPath)) {
      throw new CatalogMediaError("Caminho de midia invalido", "EDITOR_MEDIA_PATH_INVALID", 400);
    }
    await this.bucket.file(normalizedPath).delete({ ignoreNotFound: true });
  }
}

export function createCatalogMediaService(options) {
  return new CatalogMediaService(options);
}
