// Game-engine side of the local AI channel: a provider for createSocialAiService.
import { DEFAULT_LOCAL_MODEL } from "./catalog.mjs";
import { buildLocalSocialTask, bundleFromLocalTexts } from "./socialPrompt.mjs";

export function createLocalAiClient(port, { timeoutMs = 50_000 } = {}) {
  let nextId = 1;
  const pending = new Map();
  port.on("message", ({ data }) => {
    const item = pending.get(data?.id);
    if (!item) return;
    pending.delete(data.id); clearTimeout(item.timer);
    if (data.error) item.reject(Object.assign(new Error("IA local indisponivel"), { code: data.error.code }));
    else item.resolve(data.value);
  });
  port.on("close", () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Object.assign(new Error("IA local encerrada"), { code: "LOCAL_AI_CLOSED" })); }
    pending.clear();
  });
  port.start();
  const request = (action, value) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(Object.assign(new Error("IA local sem resposta"), { code: "LOCAL_AI_TIMEOUT" })); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    port.postMessage({ id, action, value });
  });
  return {
    status: (modelId = DEFAULT_LOCAL_MODEL) => request("status", { modelId }),
    provider(modelId = DEFAULT_LOCAL_MODEL) {
      return {
        source: "local",
        model: modelId,
        async generateBundle(input) {
          const task = buildLocalSocialTask(input);
          return bundleFromLocalTexts(input, await request("generate", { ...task, modelId }));
        },
      };
    },
  };
}
