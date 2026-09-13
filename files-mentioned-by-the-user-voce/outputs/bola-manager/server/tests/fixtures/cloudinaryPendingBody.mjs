import assert from "node:assert/strict";
import { CloudinaryMediaService } from "../../services/cloudinaryMedia.mjs";
import { png } from "../helpers/imageFixtures.mjs";

export function pendingJsonResponse(signal) {
  let abort;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"result":'));
      abort = () => controller.error(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    },
    cancel() {
      signal.removeEventListener("abort", abort);
    },
  });
  return new Response(body, { headers: { "content-type": "application/json" } });
}

export async function checkPendingBodyTimeout() {
  let signal;
  const service = new CloudinaryMediaService({
    cloudName: "cloud", apiKey: "key", apiSecret: "secret", requestTimeoutMs: 10,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/upload")) {
        const path = options.body.get("public_id");
        return Response.json({ public_id: path, secure_url: `https://res.cloudinary.com/cloud/image/upload/${path}.png` });
      }
      signal = options.signal;
      return pendingJsonResponse(signal);
    },
  });
  const ownership = { ownerId: "uid-editor", entity: "clubs", recordId: "pending-body" };
  const media = await service.upload({ ...ownership, uploadedBy: ownership.ownerId, kind: "crest", mimeType: "image/png", bytes: png });
  await assert.rejects(
    service.remove(media.path, ownership),
    (error) => error.code === "EDITOR_MEDIA_DELETE_FAILED" && error.details?.cause === "timeout",
  );
  assert.equal(signal.aborted, true);
}
