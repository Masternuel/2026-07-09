// Models the game can download on request (never bundled in the installer).
// Qwen3 is Apache-2.0; the GGUF quantization is bartowski's public conversion, pinned by hash.
export const LOCAL_AI_MODELS = Object.freeze({
  "qwen3-1.7b": Object.freeze({
    id: "qwen3-1.7b",
    label: "Qwen3 1.7B",
    file: "qwen3-1.7b-q4_k_m.gguf",
    url: "https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf",
    bytes: 1_282_439_584,
    sha256: "72c5c3cb38fa32d5256e2fe30d03e7a64c6c79e668ad84057e3bd66e250b24fb",
    license: "Apache-2.0",
  }),
});

export const DEFAULT_LOCAL_MODEL = "qwen3-1.7b";
