import { createSocialAiService } from "../server/services/socialAi.mjs";
import { createAiUsage } from "../server/infrastructure/aiUsage.mjs";
import { randomUUID } from "node:crypto";

export function createDesktopSocialAi({ config = {}, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const usage = createAiUsage();
  let service;
  let enabled = false;
  let configured = false;
  let lastResult = "none";
  let lastError = null;
  const configure = (value) => {
    if (!value || typeof value.enabled !== "boolean" || typeof value.apiKey !== "string") throw new Error("LOCAL_AI_SETTINGS_INVALID");
    configured = Boolean(value.apiKey);
    enabled = value.enabled && configured;
    lastResult = "none"; lastError = null;
    service = createSocialAiService({
      apiKey: enabled ? value.apiKey : "", usage, fetchImpl,
      api: "generateContent", model: "gemini-3.1-flash-lite", fallbackModels: ["gemini-3.5-flash"],
      // Two bounded model attempts fit the existing 30-second HTTP/IPC budget.
      retriesPerModel: 0,
      logger: { warn(_message, detail) {
        if (service === current) lastError = detail?.code ?? "PROVIDER_UNAVAILABLE";
        logger.warn?.("desktop.social_ai_unavailable", { code: detail?.code ?? "PROVIDER_UNAVAILABLE" });
      } },
    });
    const current = service;
  };
  configure({ apiKey: config.apiKey ?? "", enabled: config.enabled === true });
  const api = {
    get configured() { return enabled; },
    get model() { return service.model; },
    get fallbackModels() { return service.fallbackModels; },
    configure,
    status: () => ({ configured, enabled, model: service.model, lastResult, lastError }),
    hasReusableResult: (input) => service.hasReusableResult(input),
    async generate(input, options) {
      const current = service;
      const result = await current.generate(input, options);
      if (current === service) { lastResult = result.source; if (result.source === "gemini") lastError = null; }
      return result;
    },
    async test(uid) {
      if (!enabled) throw Object.assign(new Error("Ative o Gemini antes de testar."), { code: "LOCAL_AI_KEY_REQUIRED" });
      const testId = `connection-test-${randomUUID()}`;
      await api.generate({ clubId: "connection-test", clubName: "Clube de teste", lastMatch: null, nextFixture: null,
        posts: [{ id: testId, source: "Torcida", sourceType: "jogador", headline: "Conexao", body: "Vamos apoiar nosso clube nesta rodada." }],
      }, { uid, operation: "comment" });
      return api.status();
    },
  };
  return api;
}
