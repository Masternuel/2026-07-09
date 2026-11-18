import { IMAGE_CSP } from "./imagePolicy.mjs";

// SHA-256 of the inline prepaint theme script in index.html. A test recomputes it
// from index.html, so editing that script without updating this hash fails CI.
export const THEME_SCRIPT_HASH = "sha256-JyZmLQGOk9AYYQvb/LLSHqfIatIMUSu5gVPxIxghkqM=";

const FIREBASE_CONNECT = [
  "https://*.googleapis.com",
  "https://*.firebaseio.com",
  "wss://*.firebaseio.com",
  "https://*.firebaseapp.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
];
const BACKEND_CONNECT = ["https://*.up.railway.app", "wss://*.up.railway.app"];

/**
 * Full SPA policy, shipped as Content-Security-Policy-Report-Only first (audit S-01).
 * Promote it to the enforced header once staging shows no violations in the console.
 * The enforced HTTP_CSP stays unchanged until then.
 */
export const APP_CSP_REPORT_ONLY = [
  "default-src 'self'",
  `script-src 'self' '${THEME_SCRIPT_HASH}' https://www.googletagmanager.com`,
  "style-src 'self' 'unsafe-inline'",
  IMAGE_CSP,
  "font-src 'self'",
  "media-src 'self' blob:",
  `connect-src 'self' ${[...BACKEND_CONNECT, ...FIREBASE_CONNECT].join(" ")}`,
  "frame-src https://*.firebaseapp.com https://accounts.google.com",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
