import assert from "node:assert/strict";
import { CloudinaryMediaService } from "../../services/cloudinaryMedia.mjs";

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
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return pendingJsonResponse(signal);
    },
  });
  await assert.rejects(
    service.remove(`editor-media/clubs/cloudinary/${"a".repeat(24)}/pending-body`),
    (error) => error.code === "EDITOR_MEDIA_DELETE_FAILED" && error.details?.cause === "timeout",
  );
  assert.equal(signal.aborted, true);
}
