// Local AI: prompt adapter, engine (queue, idle unload, verified download) and provider order.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleFromLocalTexts, buildLocalSocialTask, LOCAL_MAX_REPLIES } from "../localAi/socialPrompt.mjs";
import { createLocalAiEngine } from "../localAi/engine.mjs";
import { createDesktopSocialAi } from "../socialAi.mjs";
import { createSocialAiService } from "../../server/services/socialAi.mjs";

const root = fileURLToPath(new URL("../../.tmp/local-ai-tests/", import.meta.url));
async function directory(t) {
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "run-"));
  t.after(async () => {
    const inside = relative(root, resolve(path));
    assert.ok(inside && !inside.startsWith("..") && !inside.includes(":"));
    await rm(path, { recursive: true, force: true });
  });
  return path;
}

const input = {
  clubName: "Aurora FC",
  lastMatch: { homeTeam: "Aurora FC", awayTeam: "Porto Real", score: [1, 3] },
  nextFixture: { homeTeam: "Vale Verde", awayTeam: "Aurora FC" },
  posts: [
    { id: "p1", source: "Manager do clube", sourceType: "manager", headline: "", body: "Perdemos e a culpa é minha. Vamos corrigir os erros contra o Vale Verde." },
    { id: "p2", source: "Igor Sampaio", sourceType: "jogador", headline: "", body: "Dia difícil, mas esse grupo vai dar a volta por cima." },
    { id: "p3", source: "Torcida", sourceType: "jogador", headline: "", body: "Cadê a raça?" },
    { id: "p4", source: "Imprensa", sourceType: "jogador", headline: "", body: "Quarto jogo sem vencer." },
  ],
};
const texts = (count) => ({ geral: "Torcedor fala da fase.", respostas: Array.from({ length: count }, (_, index) => `Resposta ${index}`), manchete: "Aurora tropeça e pressão aumenta" });

test("prompt: short slot task with the game's facts, capped replies and a grammar the size of the slots", () => {
  const task = buildLocalSocialTask(input);
  assert.match(task.prompt, /Último jogo: Aurora FC 1 x 3 Porto Real\./);
  assert.match(task.prompt, /cobrando o time/);
  assert.match(task.prompt, /\/no_think$/);
  assert.equal(task.schema.properties.respostas.minItems, LOCAL_MAX_REPLIES);
  assert.equal(task.schema.properties.respostas.maxItems, LOCAL_MAX_REPLIES);
  assert.ok(task.maxTokens <= 400);
  const thread = buildLocalSocialTask({ ...input, posts: [input.posts[0]], mode: "thread", thread: { post: { body: "x" }, parent: { author: "Velha Guarda", text: "Escalação errada!" }, response: "Vou mexer no meio." } });
  assert.equal(thread.schema.properties.respostas.maxItems, 0);
  assert.match(thread.prompt, /primeira pessoa/);
});

test("prompt: model texts become a valid social bundle; personas come from the game, news only when newsworthy", async () => {
  const service = createSocialAiService({ provider: { source: "local", model: "qwen3-1.7b", generateBundle: async (value) => bundleFromLocalTexts(value, texts(LOCAL_MAX_REPLIES)) } });
  const result = await service.generate(input, { operation: "feed" });
  assert.equal(result.source, "local");
  assert.equal(result.model, "qwen3-1.7b");
  assert.equal(result.teamComment.sentiment, "critico");
  assert.equal(result.replies.length, 4, "every post gets a reply; the 4th uses the deterministic text");
  assert.deepEqual(result.replies.slice(0, 3).map((reply) => reply.comments[0].text), ["Resposta 0", "Resposta 1", "Resposta 2"]);
  assert.ok(result.replies.every((reply) => reply.comments[0].role === "torcida" && reply.comments[0].author));
  assert.equal(result.newsArticle.publish, true, "a substantive manager statement becomes news");
  assert.equal(result.newsArticle.headline, "Aurora tropeça e pressão aumenta");
  const quiet = await service.generate({ ...input, posts: [input.posts[1]] }, { operation: "feed" });
  assert.equal(quiet.newsArticle.publish, false);
  assert.throws(() => bundleFromLocalTexts(input, { geral: " ", respostas: [], manchete: "" }), { code: "INVALID_RESPONSE" });
});

test("prompt: a failing local model falls back to the deterministic replies", async () => {
  const service = createSocialAiService({ provider: { source: "local", model: "m", generateBundle: async () => { throw Object.assign(new Error("x"), { code: "LOCAL_AI_TIMEOUT" }); } }, logger: { warn() {} } });
  const result = await service.generate(input, { operation: "feed" });
  assert.equal(result.source, "fallback");
  assert.equal(result.replies.length, 4);
});

function fakeLlama(log) {
  return async () => ({
    getLlama: async (options) => {
      log.push(["getLlama", options.gpu, options.build]);
      return {
        loadModel: async ({ modelPath }) => {
          log.push(["loadModel", modelPath.endsWith("fake.gguf")]);
          return {
            createContext: async (options) => { log.push(["context", options.threads, options.contextSize]); return { getSequence: () => ({}), dispose: async () => log.push(["dispose-context"]) }; },
            dispose: async () => log.push(["dispose-model"]),
          };
        },
        createGrammarForJsonSchema: async () => ({ parse: (text) => JSON.parse(text) }),
        dispose: async () => log.push(["dispose-llama"]),
      };
    },
    LlamaChatSession: class {
      async prompt(prompt) {
        log.push(["prompt-start", prompt]);
        await new Promise((resolve) => setTimeout(resolve, 15));
        log.push(["prompt-end", prompt]);
        return JSON.stringify({ geral: `ok ${prompt}`, respostas: [], manchete: "" });
      }
      dispose() {}
    },
  });
}

const fakeCatalog = (bytes) => ({ fake: { id: "fake", label: "Fake", file: "fake.gguf", url: "https://example.invalid/fake.gguf", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });

test("engine: CPU only, 2 threads, one generation at a time, unloads after idle", async (t) => {
  const path = await directory(t);
  const model = Buffer.from("fake model bytes");
  await mkdir(join(path, "models"), { recursive: true });
  await writeFile(join(path, "models", "fake.gguf"), model);
  const log = [];
  const engine = createLocalAiEngine({ directory: path, catalog: fakeCatalog(model), defaultModel: "fake", loadLlama: fakeLlama(log),
    limits: { threads: 2, contextSize: 1024, idleUnloadMs: 30, generationTimeoutMs: 1000 } });
  const [first, second] = await Promise.all([engine.generate({ system: "s", prompt: "A", schema: {} }), engine.generate({ system: "s", prompt: "B", schema: {} })]);
  assert.equal(first.geral, "ok A");
  assert.equal(second.geral, "ok B");
  assert.deepEqual(log.filter(([name]) => name.startsWith("prompt")).map(([name, prompt]) => `${name}:${prompt}`), ["prompt-start:A", "prompt-end:A", "prompt-start:B", "prompt-end:B"]);
  assert.deepEqual(log.find(([name]) => name === "getLlama"), ["getLlama", false, "never"]);
  assert.deepEqual(log.find(([name]) => name === "context"), ["context", 2, 1024]);
  assert.equal(log.filter(([name]) => name === "loadModel").length, 1, "the model is loaded once for both requests");
  assert.equal((await engine.status()).loaded, true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal((await engine.status()).loaded, false);
  assert.ok(log.some(([name]) => name === "dispose-model"));
});

test("engine: a missing model is reported, not crashed on", async (t) => {
  const path = await directory(t);
  const engine = createLocalAiEngine({ directory: path, catalog: fakeCatalog(Buffer.from("x")), defaultModel: "fake", loadLlama: fakeLlama([]) });
  await assert.rejects(engine.generate({ system: "s", prompt: "A", schema: {} }), { code: "LOCAL_AI_MODEL_MISSING" });
  assert.equal((await engine.status()).installed, false);
});

test("engine: download is verified by size and SHA-256; a corrupt file never becomes the model", async (t) => {
  const path = await directory(t);
  const model = Buffer.from("verified model payload");
  const serve = (bytes) => async () => new Response(bytes);
  const good = createLocalAiEngine({ directory: path, catalog: fakeCatalog(model), defaultModel: "fake", fetchImpl: serve(model), loadLlama: fakeLlama([]) });
  await good.startDownload();
  for (let index = 0; index < 50 && !(await good.status()).installed; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await good.status()).installed, true);
  assert.equal(await good.verify(), true);
  await good.remove();
  assert.equal((await good.status()).installed, false);

  const corrupt = Buffer.from("tampered model payload!");
  const bad = createLocalAiEngine({ directory: path, catalog: { fake: { ...fakeCatalog(model).fake, bytes: corrupt.length } }, defaultModel: "fake", fetchImpl: serve(corrupt), loadLlama: fakeLlama([]) });
  await bad.startDownload();
  for (let index = 0; index < 50 && !(await bad.status()).downloadError; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await bad.status()).downloadError, "LOCAL_AI_DOWNLOAD_CORRUPT");
  assert.equal((await bad.status()).installed, false);
  assert.deepEqual(await readdir(join(path, "models")), [], "the partial file is removed");
});

test("provider order: local model when enabled and connected, otherwise Gemini key, otherwise deterministic", async () => {
  const calls = [];
  const localAi = { provider: (modelId) => ({ source: "local", model: modelId ?? "qwen3-1.7b", generateBundle: async (value) => { calls.push("local"); return bundleFromLocalTexts(value, texts(2)); } }) };
  const quiet = { warn() {} };
  const ai = createDesktopSocialAi({ config: { apiKey: "", enabled: false, local: { enabled: true } }, localAi, logger: quiet });
  assert.equal(ai.status().provider, "local");
  assert.equal((await ai.generate({ ...input, posts: input.posts.slice(1, 3) }, { uid: "u", operation: "feed" })).source, "local");
  assert.deepEqual(calls, ["local"]);
  ai.configure({ apiKey: "", enabled: false, local: { enabled: false } });
  assert.equal(ai.status().provider, "none");
  assert.equal((await ai.generate(input, { uid: "u", operation: "feed" })).source, "fallback");
  const waiting = createDesktopSocialAi({ config: { apiKey: "", enabled: false, local: { enabled: true } }, logger: quiet });
  assert.equal(waiting.status().provider, "none", "enabled but the AI process is not connected yet");
  waiting.setLocalAi(localAi);
  assert.equal(waiting.status().provider, "local");
  assert.throws(() => ai.configure({ apiKey: "", enabled: false, local: { enabled: "yes" } }));
});
