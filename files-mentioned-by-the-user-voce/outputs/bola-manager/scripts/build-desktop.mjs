import { build } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Never load .env files, and never inject inherited cloud endpoints/credentials.
const keys = ["VITE_SERVER_URL", "VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_MESSAGING_SENDER_ID", "VITE_FIREBASE_APP_ID", "VITE_FIREBASE_MEASUREMENT_ID"];
await build({
  root,
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  configLoader: "runner",
  envDir: false,
  envPrefix: "BOLA_DESKTOP_PUBLIC_",
  define: Object.fromEntries(keys.map((key) => [`import.meta.env.${key}`, JSON.stringify("")])),
  build: { outDir: "dist-desktop" },
});
