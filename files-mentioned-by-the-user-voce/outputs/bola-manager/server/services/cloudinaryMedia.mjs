import { createHash, randomUUID } from "node:crypto";
import { CatalogMediaError, prepareCatalogMedia } from "./catalogMedia.mjs";
import { allowedExternalImage } from "../../shared/imagePolicy.mjs";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const CLOUDINARY_PATH_PATTERN = /^editor-media\/(clubs|players|tournaments)\/cloudinary\/[a-f0-9]{24}\/[a-zA-Z0-9_-]{1,128}$/;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCloudinaryUrl(value) {
  const raw = clean(value);
  if (!raw) return {};
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "cloudinary:") return {};
    return {
      cloudName: decodeURIComponent(parsed.hostname),
      apiKey: decodeURIComponent(parsed.username),
      apiSecret: decodeURIComponent(parsed.password),
    };
  } catch {
    return {};
  }
}

export function cloudinaryConfigFromEnv(env = process.env) {
  const fromUrl = parseCloudinaryUrl(env.CLOUDINARY_URL);
  const config = {
    cloudName: clean(env.CLOUDINARY_CLOUD_NAME) || fromUrl.cloudName || "",
    apiKey: clean(env.CLOUDINARY_API_KEY) || fromUrl.apiKey || "",
    apiSecret: clean(env.CLOUDINARY_API_SECRET) || fromUrl.apiSecret || "",
  };
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return { ...config, missing, complete: missing.length === 0 };
}

export function cloudinarySignature(parameters, apiSecret) {
  const serialized = Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
  return createHash("sha1").update(`${serialized}${apiSecret}`).digest("hex");
}

function cloudinaryPublicId(entity, recordId, objectId) {
  const recordHash = createHash("sha256").update(String(recordId)).digest("hex").slice(0, 24);
  return `editor-media/${entity}/cloudinary/${recordHash}/${objectId}`;
}

function validCloudinaryPath(value) {
  return CLOUDINARY_PATH_PATTERN.test(value);
}

function providerFailure(message, code, status, details) {
  return new CatalogMediaError(message, code, status, details);
}

export class CloudinaryMediaService {
  constructor({
    cloudName,
    apiKey,
    apiSecret,
    fetchImpl = globalThis.fetch,
    idFactory = randomUUID,
    now = Date.now,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    this.cloudName = clean(cloudName);
    this.apiKey = clean(apiKey);
    this.apiSecret = clean(apiSecret);
    this.fetchImpl = fetchImpl;
    this.idFactory = idFactory;
    this.now = now;
    this.requestTimeoutMs = requestTimeoutMs;
    this.provider = "cloudinary";
    this.configured = Boolean(this.cloudName && this.apiKey && this.apiSecret && typeof fetchImpl === "function");
  }

  async #post(action, parameters, file = null) {
    if (!this.configured) {
      throw providerFailure(
        "Cloudinary nao esta configurado no servidor",
        "EDITOR_MEDIA_STORAGE_UNAVAILABLE",
        503,
      );
    }
    const form = new FormData();
    Object.entries(parameters).forEach(([key, value]) => form.append(key, String(value)));
    form.append("api_key", this.apiKey);
    form.append("signature", cloudinarySignature(parameters, this.apiSecret));
    if (file) form.append("file", new Blob([file.bytes], { type: file.mimeType }), `imagem.${file.extension}`);

    const controller = new AbortController();
    // Um corpo pendente pode não ter socket ativo; o prazo precisa manter a operação viva.
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response;
    let payload = null;
    try {
      response = await this.fetchImpl(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.cloudName)}/image/${action}`,
        { method: "POST", body: form, signal: controller.signal },
      );
      try {
        payload = await response.json();
      } catch (error) {
        if (controller.signal.aborted || error?.name === "AbortError") throw error;
        // Uma resposta concluida sem JSON e tratada como falha do provedor abaixo.
      }
    } catch (error) {
      const uploading = action === "upload";
      throw providerFailure(
        uploading ? "Cloudinary nao respondeu ao envio da imagem" : "Cloudinary nao respondeu a remocao da imagem",
        uploading ? "EDITOR_MEDIA_UPLOAD_FAILED" : "EDITOR_MEDIA_DELETE_FAILED",
        502,
        { cause: error?.name === "AbortError" ? "timeout" : "network" },
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok || !payload || typeof payload !== "object") {
      throw providerFailure(
        action === "upload" ? "Cloudinary nao conseguiu salvar a imagem" : "Cloudinary nao conseguiu remover a imagem",
        action === "upload" ? "EDITOR_MEDIA_UPLOAD_FAILED" : "EDITOR_MEDIA_DELETE_FAILED",
        502,
        { providerStatus: response.status },
      );
    }
    return payload;
  }

  async upload({ entity, recordId, kind, mimeType: suppliedMimeType, bytes }) {
    if (!this.configured) {
      throw providerFailure(
        "Cloudinary nao esta configurado no servidor",
        "EDITOR_MEDIA_STORAGE_UNAVAILABLE",
        503,
      );
    }
    const prepared = await prepareCatalogMedia(suppliedMimeType, bytes);
    const { mimeType, mediaType } = prepared;
    bytes = prepared.bytes;
    const path = cloudinaryPublicId(entity, recordId, this.idFactory());
    const timestamp = Math.floor(this.now() / 1000);
    const payload = await this.#post("upload", { public_id: path, timestamp }, {
      bytes,
      mimeType,
      extension: mediaType.extension,
    });
    const url = clean(payload.secure_url);
    if (!allowedExternalImage(url) || new URL(url).hostname !== "res.cloudinary.com"
      || !new URL(url).pathname.startsWith(`/${this.cloudName}/image/upload/`)
      || clean(payload.public_id) !== path) {
      await this.remove(path).catch(() => {});
      throw providerFailure(
        "Cloudinary devolveu uma resposta de imagem invalida",
        "EDITOR_MEDIA_UPLOAD_FAILED",
        502,
      );
    }
    return {
      entity,
      recordId: String(recordId),
      kind,
      url,
      path,
      mimeType,
      size: bytes.length,
    };
  }

  async remove(path) {
    const normalizedPath = clean(path);
    if (!validCloudinaryPath(normalizedPath)) {
      throw providerFailure("Caminho de midia invalido", "EDITOR_MEDIA_PATH_INVALID", 400);
    }
    const timestamp = Math.floor(this.now() / 1000);
    const payload = await this.#post("destroy", {
      invalidate: "true",
      public_id: normalizedPath,
      timestamp,
    });
    if (!["ok", "not found"].includes(clean(payload.result))) {
      throw providerFailure(
        "Cloudinary nao confirmou a remocao da imagem",
        "EDITOR_MEDIA_DELETE_FAILED",
        502,
      );
    }
  }
}

export function createCloudinaryMediaService(options) {
  return new CloudinaryMediaService(options);
}

export function isCloudinaryMediaPath(path) {
  return validCloudinaryPath(clean(path));
}

export function isCloudinaryMediaNamespace(path) {
  return /^editor-media\/(clubs|players|tournaments)\/cloudinary(?:\/|$)/.test(clean(path));
}
