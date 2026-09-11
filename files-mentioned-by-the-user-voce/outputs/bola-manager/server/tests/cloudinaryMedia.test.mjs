import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { cloudinaryConfigFromEnv } from "../services/cloudinaryMedia.mjs";
import { createMediaService } from "../services/mediaService.mjs";

import { png } from "./helpers/imageFixtures.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function expectedSignature(parameters, secret) {
  const serialized = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(`${serialized}${secret}`).digest("hex");
}

test("le CLOUDINARY_URL sem expor credenciais ao frontend", () => {
  const config = cloudinaryConfigFromEnv({
    CLOUDINARY_URL: "cloudinary://api-key:api-secret@bola-manager",
  });
  assert.equal(config.cloudName, "bola-manager");
  assert.equal(config.apiKey, "api-key");
  assert.equal(config.apiSecret, "api-secret");
  assert.equal(config.complete, true);
});

test("envia e remove imagem Cloudinary com assinatura gerada no backend", async () => {
  const calls = [];
  const timestamp = 1_700_000_000;
  const secret = "segredo-servidor";
  const fetchImpl = async (url, options) => {
    const form = options.body;
    calls.push({ url, form });
    assert.equal(form.get("api_key"), "chave-api");
    assert.equal(form.get("api_secret"), null);
    if (url.endsWith("/image/upload")) {
      const publicId = form.get("public_id");
      assert.match(publicId, /^editor-media\/clubs\/cloudinary\/[a-f0-9]{24}\/asset-id$/);
      assert.equal(form.get("timestamp"), String(timestamp));
      assert.equal(
        form.get("signature"),
        expectedSignature({ public_id: publicId, timestamp }, secret),
      );
      const file = form.get("file");
      assert.equal(file.type, "image/png");
      assert.equal(file.size, png.length);
      return jsonResponse({
        public_id: publicId,
        secure_url: `https://res.cloudinary.com/bola-manager/image/upload/${publicId}.png`,
      });
    }
    assert.equal(url.endsWith("/image/destroy"), true);
    assert.equal(form.get("invalidate"), "true");
    assert.equal(
      form.get("signature"),
      expectedSignature({ invalidate: "true", public_id: form.get("public_id"), timestamp }, secret),
    );
    return jsonResponse({ result: "ok" });
  };
  const service = createMediaService({
    env: {
      MEDIA_STORAGE_PROVIDER: "cloudinary",
      CLOUDINARY_CLOUD_NAME: "bola-manager",
      CLOUDINARY_API_KEY: "chave-api",
      CLOUDINARY_API_SECRET: secret,
    },
    fetchImpl,
    idFactory: () => "asset-id",
    now: () => timestamp * 1000,
  });

  assert.equal(service.provider, "cloudinary");
  assert.equal(service.configured, true);
  const media = await service.upload({
    entity: "clubs",
    recordId: "AUR",
    kind: "crest",
    mimeType: "image/png",
    bytes: png,
    uploadedBy: "uid-editor",
  });
  assert.equal(media.path.includes("/cloudinary/"), true);
  assert.equal(media.url.startsWith("https://res.cloudinary.com/"), true);
  await service.remove(media.path);
  assert.equal(calls.length, 2);
  await assert.rejects(
    service.remove("editor-media/clubs/cloudinary/../../outro-asset"),
    (error) => error.code === "EDITOR_MEDIA_PATH_INVALID",
  );
  assert.equal(calls.length, 2);
});

test("recusa URL inesperada do provedor e remove somente o novo upload", async () => {
  for (const imageUrl of ["https://evil.example/image.png", "https://res.cloudinary.com/other/image/upload/a.png", "https://res.cloudinary.com/cloud/image/upload/a.svg"]) {
    const deleted = [];
    let uploadedPath;
    const service = createMediaService({
      env: { MEDIA_STORAGE_PROVIDER: "cloudinary", CLOUDINARY_URL: "cloudinary://key:secret@cloud" },
      fetchImpl: async (url, { body }) => {
        if (url.endsWith("/image/upload")) {
          uploadedPath = body.get("public_id");
          return jsonResponse({ public_id: uploadedPath, secure_url: imageUrl });
        }
        deleted.push(body.get("public_id"));
        return jsonResponse({ result: "ok" });
      },
    });
    await assert.rejects(service.upload({ entity: "clubs", recordId: "AUR", kind: "crest", mimeType: "image/png", bytes: png }),
      (error) => error.code === "EDITOR_MEDIA_UPLOAD_FAILED");
    assert.deepEqual(deleted, [uploadedPath]);
  }
});

test("mantem exclusao de objetos Firebase legados ao usar Cloudinary", async () => {
  const deleted = [];
  const bucket = {
    name: "legacy.appspot.com",
    file(path) {
      return { async delete() { deleted.push(path); } };
    },
  };
  const service = createMediaService({
    env: {
      MEDIA_STORAGE_PROVIDER: "cloudinary",
      CLOUDINARY_URL: "cloudinary://key:secret@cloud",
    },
    bucket,
    fetchImpl: async () => jsonResponse({ result: "not found" }),
  });
  await assert.rejects(
    service.remove("editor-media/clubs/cloudinary/../../firebase-object"),
    (error) => error.code === "EDITOR_MEDIA_PATH_INVALID",
  );
  assert.deepEqual(deleted, []);
  await service.remove("editor-media/clubs/hash/legacy.png");
  assert.deepEqual(deleted, ["editor-media/clubs/hash/legacy.png"]);
});

test("configuracao Cloudinary incompleta falha somente no upload", async () => {
  const service = createMediaService({
    env: { MEDIA_STORAGE_PROVIDER: "cloudinary" },
  });
  assert.equal(service.provider, "cloudinary");
  assert.equal(service.configured, false);
  await assert.rejects(
    service.upload({ entity: "clubs", recordId: "AUR", kind: "crest", mimeType: "image/png", bytes: png }),
    (error) => error.code === "EDITOR_MEDIA_STORAGE_UNAVAILABLE"
      && /CLOUDINARY_URL/.test(error.message),
  );
});

test("erro do Cloudinary vira falha tipada sem vazar o segredo", async () => {
  const service = createMediaService({
    env: {
      MEDIA_STORAGE_PROVIDER: "cloudinary",
      CLOUDINARY_URL: "cloudinary://key:super-secret@cloud",
    },
    fetchImpl: async () => jsonResponse({ error: { message: "Unauthorized super-secret" } }, 401),
  });
  await assert.rejects(
    service.upload({ entity: "players", recordId: "AUR-9", kind: "avatar", mimeType: "image/png", bytes: png }),
    (error) => {
      const exposed = JSON.stringify({ message: error.message, details: error.details, stack: error.stack });
      return error.code === "EDITOR_MEDIA_UPLOAD_FAILED" && !exposed.includes("super-secret");
    },
  );
});

test("timeout continua ativo enquanto o corpo da resposta nao termina", async () => {
  const service = createMediaService({
    env: {
      MEDIA_STORAGE_PROVIDER: "cloudinary",
      CLOUDINARY_URL: "cloudinary://key:secret@cloud",
    },
    requestTimeoutMs: 10,
    fetchImpl: async (_url, options) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    }),
  });
  await assert.rejects(
    service.upload({ entity: "clubs", recordId: "AUR", kind: "crest", mimeType: "image/png", bytes: png }),
    (error) => error.code === "EDITOR_MEDIA_UPLOAD_FAILED" && error.details?.cause === "timeout",
  );
});
