function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function getServerConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  const requestedDemoAuth = enabled(env.ALLOW_DEMO_AUTH);
  if (nodeEnv === "production" && requestedDemoAuth) {
    throw new Error("ALLOW_DEMO_AUTH nunca pode ser ativado em producao");
  }

  return {
    port: nonNegativeInteger(env.PORT, 3001),
    clientOrigin: env.CLIENT_ORIGIN?.trim() || "http://localhost:5173",
    matchEventDelayMs: nonNegativeInteger(env.MATCH_EVENT_DELAY_MS, 800),
    nodeEnv,
    allowDemoAuth: requestedDemoAuth,
    roomStoreMode: env.ROOM_STORE?.trim().toLowerCase() || (requestedDemoAuth ? "memory" : "firestore"),
  };
}

export function loadLocalEnvironment({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.NODE_ENV === "production" || typeof process.loadEnvFile !== "function") return [];
  const loaded = [];
  for (const filename of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(`${cwd}/${filename}`);
      loaded.push(filename);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return loaded;
}

export { initializeFirebaseAdmin } from "./services/firebaseAdmin.mjs";
