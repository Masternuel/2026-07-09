// Local model engine (runs in its own low-priority utility process). Built to stay light:
// CPU only, 2 threads at most, a 1K-token context, one generation at a time, and the model is
// unloaded after a short idle period so its ~2 GB return to the system between rounds.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { DEFAULT_LOCAL_MODEL, LOCAL_AI_MODELS } from "./catalog.mjs";

export const LOCAL_AI_LIMITS = Object.freeze({
  threads: Math.max(1, Math.min(2, Math.floor(cpus().length / 2))),
  contextSize: 1024,
  idleUnloadMs: 90_000,
  generationTimeoutMs: 45_000,
});

const fail = (code, message = "IA local indisponivel") => Object.assign(new Error(message), { code });

export function createLocalAiEngine({ directory, catalog = LOCAL_AI_MODELS, defaultModel = DEFAULT_LOCAL_MODEL, fetchImpl = globalThis.fetch, loadLlama = () => import("node-llama-cpp"), limits = LOCAL_AI_LIMITS, now = () => Date.now() } = {}) {
  const models = join(directory, "models");
  let runtime = null; // { modelId, llama, model, context }
  let loading = null;
  let queue = Promise.resolve();
  let idleTimer = null;
  let download = null; // { modelId, received, total, controller, error }
  let lastGeneration = null;

  const modelInfo = (modelId = defaultModel) => {
    const info = catalog[modelId];
    if (!info) throw fail("LOCAL_AI_MODEL_UNKNOWN");
    return info;
  };
  const modelPath = (modelId) => join(models, modelInfo(modelId).file);
  async function installed(modelId) {
    try { return (await stat(modelPath(modelId))).size === modelInfo(modelId).bytes; } catch { return false; }
  }

  async function unload() {
    clearTimeout(idleTimer); idleTimer = null;
    const current = runtime; runtime = null;
    if (!current) return;
    await current.context?.dispose().catch(() => undefined);
    await current.model?.dispose().catch(() => undefined);
    await current.llama?.dispose().catch(() => undefined);
  }
  const scheduleUnload = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void unload(); }, limits.idleUnloadMs);
    idleTimer.unref?.();
  };

  async function load(modelId) {
    if (runtime?.modelId === modelId) return runtime;
    if (loading) return loading;
    loading = (async () => {
      await unload();
      if (!await installed(modelId)) throw fail("LOCAL_AI_MODEL_MISSING");
      const { getLlama } = await loadLlama();
      const llama = await getLlama({ gpu: false, build: "never", logLevel: "error" });
      const model = await llama.loadModel({ modelPath: modelPath(modelId) });
      const context = await model.createContext({ contextSize: limits.contextSize, threads: limits.threads, batchSize: 256 });
      runtime = { modelId, llama, model, context };
      return runtime;
    })().finally(() => { loading = null; });
    return loading;
  }

  // One generation at a time; callers wait in line instead of competing for CPU.
  function generate({ modelId = defaultModel, system, prompt, schema, maxTokens = 260 }) {
    const task = queue.then(async () => {
      const { LlamaChatSession } = await loadLlama();
      const current = await load(modelId);
      clearTimeout(idleTimer);
      const started = now();
      const grammar = await current.llama.createGrammarForJsonSchema(schema);
      const session = new LlamaChatSession({ contextSequence: current.context.getSequence(), systemPrompt: system });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limits.generationTimeoutMs);
      try {
        const text = await session.prompt(prompt, { grammar, maxTokens: Math.min(400, maxTokens), temperature: 0.85, topP: 0.9,
          budgets: { thoughtTokens: 0 }, signal: controller.signal, stopOnAbortSignal: false });
        const value = grammar.parse(text);
        lastGeneration = { ms: now() - started, at: new Date(now()).toISOString() };
        return value;
      } catch (error) {
        throw fail(controller.signal.aborted ? "LOCAL_AI_TIMEOUT" : error?.code ?? "LOCAL_AI_FAILED");
      } finally {
        clearTimeout(timer);
        session.dispose({ disposeSequence: true });
        scheduleUnload();
      }
    });
    queue = task.catch(() => undefined);
    return task;
  }

  async function startDownload(modelId = defaultModel) {
    const info = modelInfo(modelId);
    if (download && !download.error && !download.done) return status(modelId);
    if (await installed(modelId)) return status(modelId);
    const controller = new AbortController();
    download = { modelId, received: 0, total: info.bytes, controller, error: null, done: false };
    const current = download;
    void (async () => {
      const partial = `${modelPath(modelId)}.part`;
      try {
        await mkdir(models, { recursive: true });
        const response = await fetchImpl(info.url, { signal: controller.signal, redirect: "follow" });
        if (!response.ok || !response.body) throw fail("LOCAL_AI_DOWNLOAD_FAILED");
        const hash = createHash("sha256");
        const meter = new Transform({ transform(chunk, _encoding, callback) {
          current.received += chunk.length; hash.update(chunk);
          if (current.received > info.bytes) callback(fail("LOCAL_AI_DOWNLOAD_FAILED")); else callback(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial), { signal: controller.signal });
        if (current.received !== info.bytes || hash.digest("hex") !== info.sha256) throw fail("LOCAL_AI_DOWNLOAD_CORRUPT");
        await rename(partial, modelPath(modelId));
        current.done = true;
      } catch (error) {
        current.error = controller.signal.aborted ? "LOCAL_AI_DOWNLOAD_CANCELLED" : error?.code ?? "LOCAL_AI_DOWNLOAD_FAILED";
        await rm(partial, { force: true }).catch(() => undefined);
      }
    })();
    return status(modelId);
  }

  function cancelDownload() {
    download?.controller.abort();
  }

  async function remove(modelId = defaultModel) {
    cancelDownload();
    if (runtime?.modelId === modelId) await unload();
    await rm(modelPath(modelId), { force: true });
    await rm(`${modelPath(modelId)}.part`, { force: true });
    download = null;
    return status(modelId);
  }

  async function status(modelId = defaultModel) {
    const info = modelInfo(modelId);
    const active = download?.modelId === modelId ? download : null;
    return {
      modelId, label: info.label, bytes: info.bytes,
      installed: await installed(modelId),
      loaded: runtime?.modelId === modelId,
      downloading: Boolean(active && !active.done && !active.error),
      received: active?.received ?? 0,
      downloadError: active?.error ?? null,
      threads: limits.threads,
      lastGenerationMs: lastGeneration?.ms ?? null,
    };
  }

  // Integrity check of an installed file (used by tests and after manual copies).
  async function verify(modelId = defaultModel) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(modelPath(modelId))) hash.update(chunk);
    return hash.digest("hex") === modelInfo(modelId).sha256;
  }

  return { generate, startDownload, cancelDownload, remove, status, verify, unload, installed };
}
