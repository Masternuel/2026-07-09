import { createSocialAiService } from "../server/services/socialAi.mjs";
import { createAiUsage } from "../server/infrastructure/aiUsage.mjs";
import { randomUUID } from "node:crypto";

// Provider order: local model (when enabled and its process is connected) > personal Gemini key
// > deterministic replies. Nothing here ever needs a developer-paid key.
export function createDesktopSocialAi({ config = {}, fetchImpl = globalThis.fetch, logger = console, localAi = null } = {}) {
  const usage = createAiUsage();
  let service;
  let enabled = false;
  let configured = false;
  let localClient = localAi;
  let local = { enabled: false, modelId: undefined };
  let lastValue = null;
  let lastResult = "none";
  let lastError = null;
  const useLocal = () => Boolean(local.enabled && localClient);
  const configure = (value) => {
    if (!value || typeof value.enabled !== "boolean" || typeof value.apiKey !== "string") throw new Error("LOCAL_AI_SETTINGS_INVALID");
    if (value.local !== undefined && (typeof value.local !== "object" || typeof value.local?.enabled !== "boolean")) throw new Error("LOCAL_AI_SETTINGS_INVALID");
    lastValue = value;
    configured = Boolean(value.apiKey);
    enabled = value.enabled && configured;
    local = { enabled: value.local?.enabled === true, modelId: typeof value.local?.modelId === "string" ? value.local.modelId : undefined };
    lastResult = "none"; lastError = null;
    let current = null;
    const warnLogger = { warn(_message, detail) {
      if (service === current) lastError = detail?.code ?? "PROVIDER_UNAVAILABLE";
      logger.warn?.("desktop.social_ai_unavailable", { code: detail?.code ?? "PROVIDER_UNAVAILABLE" });
    } };
    if (useLocal()) {
      // The local model answers in ~5-20 s on two CPU threads; one request at a time.
      service = createSocialAiService({ usage, provider: localClient.provider(local.modelId), maxConcurrentRequests: 1, logger: warnLogger });
      current = service;
      return;
    }
    service = createSocialAiService({
      apiKey: enabled ? value.apiKey : "", usage, fetchImpl,
      api: "generateContent", model: "gemini-3.1-flash-lite", fallbackModels: ["gemini-3.5-flash"],
      // Two bounded model attempts fit the existing 30-second HTTP/IPC budget.
      retriesPerModel: 0,
      logger: warnLogger,
    });
    current = service;
  };
  configure({ apiKey: config.apiKey ?? "", enabled: config.enabled === true, local: config.local ?? { enabled: false } });
  const api = {
    get configured() { return enabled || useLocal(); },
    get model() { return service.model; },
    get fallbackModels() { return service.fallbackModels; },
    configure,
    status: () => ({ configured, enabled, model: service.model, lastResult, lastError,
      provider: useLocal() ? "local" : enabled ? "gemini" : "none", local: { enabled: local.enabled, connected: Boolean(localClient) } }),
    // The local AI process connects after start (and survives engine restarts).
    setLocalAi(client) { localClient = client; if (lastValue) configure(lastValue); },
    localAi: () => localClient,
    hasReusableResult: (input) => service.hasReusableResult(input),
    async generate(input, options) {
      const current = service;
      const result = await current.generate(input, options);
      if (current === service) { lastResult = result.source; if (result.source !== "fallback") lastError = null; }
      return result;
    },
    async test(uid) {
      if (!enabled && !useLocal()) throw Object.assign(new Error("Ative uma IA antes de testar."), { code: "LOCAL_AI_KEY_REQUIRED" });
      const testId = `connection-test-${randomUUID()}`;
      await api.generate({ clubId: "connection-test", clubName: "Clube de teste", lastMatch: null, nextFixture: null,
        posts: [{ id: testId, source: "Torcida", sourceType: "jogador", headline: "Conexao", body: "Vamos apoiar nosso clube nesta rodada." }],
      }, { uid, operation: "comment" });
      return api.status();
    },
  };
  return api;
}
