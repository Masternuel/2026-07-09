// Utility process hosting the local model, isolated from the game engine: if it crashes or
// runs out of memory the career keeps going with the deterministic social replies.
// Main forks it at below-normal priority and hands one MessagePort to the game engine.
import { createLocalAiEngine } from "./engine.mjs";

const engine = createLocalAiEngine({ directory: process.env.BOLA_LOCAL_AI_DIR });

const actions = {
  status: (value) => engine.status(value?.modelId),
  download: (value) => engine.startDownload(value?.modelId),
  cancelDownload: () => { engine.cancelDownload(); return true; },
  remove: (value) => engine.remove(value?.modelId),
  unload: async () => { await engine.unload(); return true; },
  generate: (value) => engine.generate(value),
};

async function answer(message, reply) {
  if (!message || typeof message.id !== "number" || !Object.hasOwn(actions, message.action)) return;
  try { reply({ id: message.id, value: await actions[message.action](message.value) }); }
  catch (error) { reply({ id: message.id, error: { code: String(error?.code ?? "LOCAL_AI_FAILED") } }); }
}

process.parentPort.on("message", (event) => {
  const port = event.ports?.[0];
  if (event.data?.type === "enginePort" && port) {
    // Game engine channel: only social generation and status.
    port.on("message", ({ data }) => {
      if (["generate", "status"].includes(data?.action)) void answer(data, (value) => port.postMessage(value));
    });
    port.start();
    return;
  }
  void answer(event.data, (value) => process.parentPort.postMessage(value));
});
