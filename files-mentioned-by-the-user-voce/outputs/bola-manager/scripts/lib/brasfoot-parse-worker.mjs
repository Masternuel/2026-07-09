// D-02: Java deserialization of Brasfoot files is CPU-bound. A file near the 32 MB limit
// blocked the event loop for ~0.9 s in measurement, stalling live-match sockets on a shared
// replica. The parser now runs in a worker thread with memory and time limits.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { parseBrasfootSource } from "./brasfoot-binary.mjs";

const WORKER_FLAG = "bola-brasfoot-parse";

if (!isMainThread && workerData?.[WORKER_FLAG]) {
  try {
    parentPort.postMessage({ ok: true, value: await parseBrasfootSource(workerData.inputPath, workerData.options) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: { name: error?.name, message: String(error?.message ?? error), code: error?.code } });
  }
}

const limitError = (message, code) => Object.assign(new Error(message), { code, status: 413, public: true });

/** Same contract as parseBrasfootSource, executed off the main thread. */
export function parseBrasfootSourceInWorker(inputPath, options = {}, {
  timeoutMs = 120_000,
  maxOldGenerationSizeMb = 1024,
  createWorker = (url, workerOptions) => new Worker(url, workerOptions),
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = createWorker(new URL(import.meta.url), {
      workerData: { [WORKER_FLAG]: true, inputPath, options },
      resourceLimits: { maxOldGenerationSizeMb },
    });
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      callback(value);
    };
    const succeed = finish(resolve);
    const fail = finish(reject);
    const timer = setTimeout(() => fail(limitError("Leitura dos arquivos Brasfoot excedeu o tempo limite", "BRASFOOT_IMPORT_PARSE_TIMEOUT")), timeoutMs);
    timer.unref?.();
    worker.once("message", (message) => {
      if (message?.ok) succeed(message.value);
      else fail(Object.assign(new Error(message?.error?.message ?? "Falha ao ler arquivos Brasfoot"), {
        name: message?.error?.name ?? "Error", ...(message?.error?.code ? { code: message.error.code } : {}),
      }));
    });
    worker.once("error", (error) => fail(error?.code === "ERR_WORKER_OUT_OF_MEMORY"
      ? limitError("Arquivos Brasfoot exigem memoria demais para leitura", "BRASFOOT_IMPORT_PARSE_MEMORY")
      : error));
    worker.once("exit", (code) => fail(new Error(`Leitor Brasfoot encerrou sem resposta (codigo ${code})`)));
  });
}
