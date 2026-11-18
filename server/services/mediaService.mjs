import { CatalogMediaError, createCatalogMediaService as createFirebaseMediaService } from "./catalogMedia.mjs";
import {
  cloudinaryConfigFromEnv,
  createCloudinaryMediaService,
  isCloudinaryMediaNamespace,
  isCloudinaryMediaPath,
} from "./cloudinaryMedia.mjs";

const VALID_PROVIDERS = new Set(["auto", "firebase", "cloudinary"]);

class UnavailableMediaService {
  constructor(provider, message) {
    this.provider = provider;
    this.message = message;
    this.configured = false;
  }

  #error() {
    return new CatalogMediaError(this.message, "EDITOR_MEDIA_STORAGE_UNAVAILABLE", 503);
  }

  async upload() {
    throw this.#error();
  }

  async remove() {
    throw this.#error();
  }
}

class RoutedMediaService {
  constructor({ primary, firebase, cloudinary }) {
    this.primary = primary;
    this.firebase = firebase;
    this.cloudinary = cloudinary;
    this.provider = primary.provider;
    this.configured = primary.configured === true;
  }

  upload(input) {
    return this.primary.upload(input);
  }

  remove(path, ownership) {
    if (isCloudinaryMediaNamespace(path)) {
      if (!isCloudinaryMediaPath(path)) {
        return Promise.reject(new CatalogMediaError(
          "Caminho de midia invalido",
          "EDITOR_MEDIA_PATH_INVALID",
          400,
        ));
      }
      if (this.cloudinary) return this.cloudinary.remove(path, ownership);
      return Promise.reject(new CatalogMediaError(
        "Cloudinary nao esta configurado para remover esta imagem",
        "EDITOR_MEDIA_STORAGE_UNAVAILABLE",
        503,
      ));
    }
    return this.firebase.remove(path, ownership);
  }
}

function selectedProvider(env) {
  const requested = String(env.MEDIA_STORAGE_PROVIDER ?? env.MEDIA_PROVIDER ?? "auto").trim().toLowerCase();
  return VALID_PROVIDERS.has(requested) ? requested : "invalid";
}

export function createMediaService({
  env = process.env,
  bucket = null,
  fetchImpl = globalThis.fetch,
  idFactory,
  now,
  requestTimeoutMs,
} = {}) {
  const firebase = createFirebaseMediaService({ bucket, ...(idFactory ? { idFactory } : {}) });
  const config = cloudinaryConfigFromEnv(env);
  const cloudinary = config.complete
    ? createCloudinaryMediaService({
      ...config,
      fetchImpl,
      ...(idFactory ? { idFactory } : {}),
      ...(now ? { now } : {}),
      ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
    })
    : null;
  const requested = selectedProvider(env);

  let primary;
  if (requested === "cloudinary") {
    primary = cloudinary ?? new UnavailableMediaService(
      "cloudinary",
      "Cloudinary nao esta configurado; defina CLOUDINARY_URL no Railway",
    );
  } else if (requested === "firebase") {
    primary = firebase;
  } else if (requested === "auto") {
    primary = cloudinary ?? firebase;
  } else {
    primary = new UnavailableMediaService(
      "invalid",
      "MEDIA_STORAGE_PROVIDER deve ser auto, firebase ou cloudinary",
    );
  }

  return new RoutedMediaService({ primary, firebase, cloudinary });
}
