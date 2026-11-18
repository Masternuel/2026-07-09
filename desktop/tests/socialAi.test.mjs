import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { createAiSettingsStore } from "../aiSettings.mjs";
import { createDesktopSocialAi } from "../socialAi.mjs";
import { startLocalBackend } from "../localBackend.mjs";

const root = resolve(".tmp/gemini-tests");
const fakeKey = "test-only-gemini-key-000000000000";
const silent = { info() {}, warn() {}, error() {} };
const input = { clubId: "AUR", clubName: "Aurora FC", lastMatch: null, nextFixture: null,
  posts: [{ id: "manager-post", source: "Manager", sourceType: "manager", headline: "Rodada", body: "Vamos apoiar o time!" }] };
const response = (options) => {
  const context = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
  return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify({
    teamComment: { author: "Central da Rodada", role: "imprensa", text: "O clube trabalha para a rodada.", sentiment: "neutro" },
    replies: context.posts.map((post) => ({ postId: post.id, comments: [{ author: "Torcedor", role: "torcida", text: "Resposta contextual do provedor de teste.", sentiment: "positivo" }] })),
  }) }] } }] }; } };
};
async function directory(t) {
  await mkdir(root, { recursive: true });
  const value = await mkdtemp(join(root, "run-"));
  t.after(async () => { const inside = relative(root, resolve(value)); assert.ok(inside && !inside.startsWith("..") && !inside.includes(":")); await rm(value, { recursive: true, force: true }); });
  return value;
}
function encryption() {
  const key = randomBytes(32);
  return { available: () => true,
    async encrypt(text) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    async decrypt(bytes) { const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"); },
  };
}
test("Gemini settings encrypt, reload, disable and remove without plaintext", async (t) => {
  const path = await directory(t); const crypto = encryption();
  const vault = createAiSettingsStore({ directory: path, encryption: crypto });
  assert.deepEqual(await vault.read(), { apiKey: "", enabled: false });
  await vault.write({ apiKey: fakeKey, enabled: true });
  const bytes = await readFile(join(path, "ai-settings.json"), "utf8");
  assert.ok(!bytes.includes(fakeKey)); assert.ok(!bytes.includes("apiKey"));
  const reopened = createAiSettingsStore({ directory: path, encryption: crypto });
  assert.deepEqual(await reopened.read(), { apiKey: fakeKey, enabled: true });
  await reopened.write({ enabled: false });
  assert.deepEqual(await reopened.read(), { apiKey: fakeKey, enabled: false });
  await reopened.write({ enabled: false, removeKey: true });
  assert.deepEqual(await reopened.read(), { apiKey: "", enabled: false });
  const authKey = `AQ.${fakeKey}`;
  await reopened.write({ apiKey: authKey, enabled: true });
  assert.equal((await reopened.read()).apiKey, authKey);
});
test("Gemini settings fail closed without encryption or with basic_text", async (t) => {
  const path = await directory(t);
  for (const crypto of [{ ...encryption(), available: () => false }, { ...encryption(), backend: () => "basic_text" }]) {
    const vault = createAiSettingsStore({ directory: path, encryption: crypto, platform: "linux" });
    await assert.rejects(vault.write({ apiKey: fakeKey, enabled: true }), { code: "LOCAL_AI_ENCRYPTION_UNAVAILABLE" });
  }
  await assert.rejects(readFile(join(path, "ai-settings.json")), { code: "ENOENT" });
});
test("Gemini settings reject paths, arbitrary fields, wrong flags and invalid keys", async (t) => {
  const vault = createAiSettingsStore({ directory: await directory(t), encryption: encryption() });
  for (const patch of [null, [], { enabled: "true" }, { enabled: true, apiKey: "short" }, { enabled: false, apiKey: "x\n".repeat(20) },
    { enabled: false, path: "other.json" }, { enabled: true, removeKey: true }, { enabled: false, removeKey: "true" }]) await assert.rejects(vault.write(patch));
  await assert.rejects(vault.write({ enabled: true }), { code: "LOCAL_AI_KEY_REQUIRED" });
});
test("Gemini disabled never calls network or exposes key in status", async () => {
  const ai = createDesktopSocialAi({ config: { apiKey: fakeKey, enabled: false }, fetchImpl: () => { throw new Error("network forbidden"); } });
  assert.equal((await ai.generate(input)).source, "fallback");
  assert.equal(ai.status().enabled, false); assert.equal(ai.status().configured, true);
  assert.ok(!JSON.stringify(ai.status()).includes(fakeKey));
  await assert.rejects(ai.test("local-test"), { code: "LOCAL_AI_KEY_REQUIRED" });
});
test("Gemini reuses official endpoint/schema, usage and cache", async () => {
  let calls = 0;
  const ai = createDesktopSocialAi({ fetchImpl: async (url, options) => {
    calls++; assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent");
    assert.equal(options.headers["x-goog-api-key"], fakeKey);
    const payload = JSON.parse(options.body); assert.equal(payload.generationConfig.responseMimeType, "application/json");
    assert.ok(payload.generationConfig.responseJsonSchema); assert.ok(!Object.hasOwn(payload, "store"));
    return response(options);
  } });
  ai.configure({ apiKey: fakeKey, enabled: true });
  assert.equal((await ai.generate(input, { uid: "local-test", operation: "post" })).source, "gemini");
  assert.equal((await ai.generate(input, { uid: "local-test", operation: "post" })).cached, true);
  assert.equal(calls, 1); assert.equal(ai.status().lastResult, "gemini");
  await assert.rejects(ai.generate({ ...input, clubId: "different" }, { uid: "local-test", operation: "post" }), { code: "AI_USAGE_LIMITED" });
  ai.configure({ apiKey: fakeKey, enabled: false });
  assert.equal((await ai.generate(input)).source, "fallback"); assert.equal(calls, 1);
});
test("Gemini error is sanitized and fallback never claims provider success", async () => {
  const warnings = [];
  const ai = createDesktopSocialAi({ config: { apiKey: fakeKey, enabled: true },
    fetchImpl: async () => ({ ok: false, status: 403, async json() { return { error: { status: "PERMISSION_DENIED", message: fakeKey } }; } }),
    logger: { warn(...args) { warnings.push(args); } } });
  assert.equal((await ai.generate(input, { uid: "local-test", operation: "post" })).source, "fallback");
  assert.equal(ai.status().lastResult, "fallback"); assert.equal(ai.status().lastError, "PERMISSION_DENIED");
  assert.ok(!JSON.stringify([warnings, ai.status()]).includes(fakeKey));
});
test("Gemini connection test makes fresh requests without bypassing usage limits", async () => {
  const postIds = [];
  const ai = createDesktopSocialAi({ config: { apiKey: fakeKey, enabled: true }, fetchImpl: async (_url, options) => {
    const context = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
    postIds.push(context.posts[0].id);
    return response(options);
  } });
  assert.equal((await ai.test("local-test-one")).lastResult, "gemini");
  assert.equal((await ai.test("local-test-two")).lastResult, "gemini");
  assert.equal(postIds.length, 2);
  assert.notEqual(postIds[0], postIds[1]);
  await assert.rejects(ai.test("local-test-two"), { code: "AI_USAGE_LIMITED" });
  assert.equal(postIds.length, 2);
});
test("desktop posts persist Gemini replies and reload without credentials in save", async (t) => {
  const path = await directory(t); let calls = 0;
  let backend = await startLocalBackend({ directory: path, logger: silent,
    socialAiConfig: { apiKey: fakeKey, enabled: true }, socialAiFetch: async (_url, options) => { calls++; return response(options); } });
  let roomCode;
  try {
    const session = await backend.session();
    const headers = { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
    async function request(route, body) {
      const result = await fetch(backend.origin + route, { headers, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
      const payload = await result.json(); assert.ok(result.ok, `HTTP ${result.status} ${payload.error?.code ?? ""}`); return payload;
    }
    const { room } = await request("/api/rooms", { name: "Gemini fixture", clubId: "AUR", activeLeagues: ["BR-A"], seasonLength: 1, maxManagers: 1 });
    roomCode = room.code;
    const { post } = await request(`/api/news/${roomCode}/posts`, { message: "Vamos apoiar o time!", requestId: randomUUID() });
    assert.equal(post.comments[0].text, "Resposta contextual do provedor de teste.");
    assert.equal(backend.socialAiStatus().lastResult, "gemini");
    const followup = await request(`/api/news/${roomCode}/posts/${post.id}/comments`, { message: "Obrigado pelo apoio!", parentCommentId: post.comments[0].id, requestId: randomUUID() });
    assert.equal(followup.post.comments.at(-1).text, "Resposta contextual do provedor de teste.");
    assert.ok(!JSON.stringify(await backend.database.read((value) => value)).includes(fakeKey));
    assert.equal(calls, 2);
    assert.equal((await request(`/api/news/${roomCode}`)).posts[0].comments.length, 3);
  } finally { await backend.close(); }
  backend = await startLocalBackend({ directory: path, logger: silent, socialAiFetch: () => { throw new Error("unexpected request"); } });
  try {
    const session = await backend.session();
    const result = await fetch(`${backend.origin}/api/news/${roomCode}`, { headers: { Authorization: `Bearer ${session.token}` } });
    assert.equal(result.status, 200); assert.equal((await result.json()).posts[0].comments.length, 3);
    assert.equal(backend.socialAiStatus().configured, false);
  } finally { await backend.close(); }
});
