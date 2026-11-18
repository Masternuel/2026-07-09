import assert from "node:assert/strict";
import { fingerprint } from "../security-staging-preflight.mjs";
import { createCloudinaryMediaService, cloudinaryConfigFromEnv } from "../../server/services/cloudinaryMedia.mjs";
import { mediaHash, mediaBinding } from "../../server/services/mediaOwnership.mjs";
import { createSocialAiService } from "../../server/services/socialAi.mjs";
import { createAiUsage } from "../../server/infrastructure/aiUsage.mjs";
import { openRedis, closeRedis } from "./fixtures.mjs";
import sharp from "sharp";

const PNG = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#80a030" } }).png().toBuffer();
export function ownedFixture(receipt) {
  return { runId: receipt.runId, proof: fingerprint(receipt.owner) };
}
export function isOwned(value, receipt) {
  return value?.runId === receipt.runId && value?.proof === fingerprint(receipt.owner);
}
async function firebase(env, receipt) {
  const { initializeApp, cert, deleteApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getStorage } = await import("firebase-admin/storage");
  const options = { projectId: env.FIREBASE_PROJECT_ID, storageBucket: env.FIREBASE_STORAGE_BUCKET };
  const runtime = initializeApp({ ...options, credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON)) }, `${receipt.runId}-runtime`);
  const admin = initializeApp({ ...options, credential: cert(JSON.parse(env.STAGING_FIREBASE_ADMIN_JSON)) }, `${receipt.runId}-admin`);
  return {
    auth: getAuth(admin), runtimeAuth: getAuth(runtime), db: getFirestore(runtime), bucket: getStorage(runtime).bucket(),
    async close() { await Promise.all([deleteApp(runtime), deleteApp(admin)]); },
  };
}
export async function checkFirebase(env, receipt) {
  const service = await firebase(env, receipt);
  const fixture = ownedFixture(receipt);
  try {
    const user = await service.auth.createUser({ uid: receipt.runId, disabled: true, displayName: `${receipt.runId}:${fixture.proof}` });
    assert.equal(user.disabled, true);
    assert.equal((await service.runtimeAuth.getUser(receipt.runId)).uid, receipt.runId);
    const doc = service.db.collection("security-validation").doc(receipt.runId);
    await service.db.runTransaction(async (transaction) => {
      assert.equal((await transaction.get(doc)).exists, false);
      transaction.create(doc, fixture);
    });
    assert.ok(isOwned((await doc.get()).data(), receipt));
    const file = service.bucket.file(`security-validation/${receipt.runId}/fixture.png`);
    await file.save(PNG, { resumable: false, validation: "crc32c", preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "image/png", metadata: fixture } });
    const [metadata] = await file.getMetadata();
    assert.ok(isOwned(metadata.metadata, receipt));
    assert.deepEqual((await file.download())[0], PNG);
  } finally { await service.close(); }
}
export async function cleanupFirebase(env, receipt) {
  const service = await firebase(env, receipt);
  try {
    const file = service.bucket.file(`security-validation/${receipt.runId}/fixture.png`);
    let metadata;
    try { [metadata] = await file.getMetadata(); } catch (error) { if (Number(error.code) !== 404) throw error; }
    if (metadata) {
      if (!isOwned(metadata.metadata, receipt) || !metadata.generation) throw new Error("OWNERSHIP_UNCONFIRMED");
      await file.delete({ ifGenerationMatch: metadata.generation });
    }
    const doc = service.db.collection("security-validation").doc(receipt.runId);
    await service.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(doc);
      if (!snapshot.exists) return;
      if (!isOwned(snapshot.data(), receipt)) throw new Error("OWNERSHIP_UNCONFIRMED");
      transaction.delete(doc);
    });
    let user;
    try { user = await service.auth.getUser(receipt.runId); } catch (error) { if (error.code !== "auth/user-not-found") throw error; }
    if (user) {
      if (!user.disabled || user.displayName !== `${receipt.runId}:${fingerprint(receipt.owner)}`) throw new Error("OWNERSHIP_UNCONFIRMED");
      await service.auth.deleteUser(receipt.runId);
    }
  } finally { await service.close(); }
}

function mediaContext(env, receipt) {
  const config = cloudinaryConfigFromEnv(env);
  const scope = { ownerId: `${receipt.runId}:${receipt.owner}`, entity: "clubs", recordId: receipt.runId };
  const path = `editor-media/clubs/cloudinary/v2/${mediaHash(scope.ownerId)}/${mediaHash(scope.recordId)}/${receipt.runId}.${mediaBinding(scope, receipt.runId, config.apiSecret)}`;
  return { scope, path, service: createCloudinaryMediaService({ ...config, idFactory: () => receipt.runId }) };
}
export async function checkMedia(env, receipt) {
  const { scope, path, service } = mediaContext(env, receipt);
  const media = await service.upload({ entity: scope.entity, recordId: scope.recordId, kind: "crest", mimeType: "image/png", bytes: PNG, uploadedBy: scope.ownerId });
  assert.equal(media.path, path);
  await assert.rejects(() => service.remove(media.path, { ...scope, ownerId: "intruder" }), { code: "EDITOR_MEDIA_OWNERSHIP_INVALID" });
}
export async function cleanupMedia(env, receipt) {
  const { scope, path, service } = mediaContext(env, receipt);
  await service.remove(path, scope);
}

export async function checkAi(env, receipt) {
  const runtime = await openRedis(env, receipt);
  try {
    const usage = createAiUsage({ runtime, required: true, limits: { operationLimit: 1, userLimit: 1, globalLimit: 1, userConcurrent: 1, globalConcurrent: 1 } });
    // A single configured model, no retry and no fallback model. Real service + real Redis.
    const service = createSocialAiService({ usage, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, fallbackModels: [env.GEMINI_MODEL], retriesPerModel: 0, logger: { warn() {} } });
    const input = { clubName: receipt.runId, mode: "thread", posts: [] };
    const result = await service.generate(input, { uid: receipt.runId, operation: "interview" });
    assert.equal(result.source, "gemini");
    await assert.rejects(() => service.generate({ ...input, clubName: `${receipt.runId}-blocked` }, { uid: receipt.runId, operation: "interview" }), { code: "AI_USAGE_LIMITED" });
    runtime.raw.destroy();
    await assert.rejects(() => service.generate({ ...input, clubName: `${receipt.runId}-offline` }, { uid: receipt.runId, operation: "interview" }), { code: "REDIS_REQUIRED" });
  } finally { closeRedis(runtime); }
}
