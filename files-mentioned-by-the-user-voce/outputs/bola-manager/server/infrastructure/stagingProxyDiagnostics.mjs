import { createHash } from "node:crypto";
import { isIP } from "node:net";

export function getStagingDiagnosticsConfig(env, now = Date.now()) {
  if (env.STAGING_PROXY_DIAGNOSTICS !== "true") return null;
  if (env.RAILWAY_ENVIRONMENT_NAME !== "staging" || env.RAILWAY_SERVICE_NAME !== "backend-staging") {
    throw new Error("STAGING_PROXY_DIAGNOSTICS requires backend-staging/staging");
  }
  const runId = env.STAGING_PROXY_DIAGNOSTICS_RUN_ID ?? "";
  const until = Date.parse(env.STAGING_PROXY_DIAGNOSTICS_UNTIL ?? "");
  if (!/^security-validation-[a-zA-Z0-9-]{1,80}$/.test(runId)
    || !Number.isFinite(until) || until > now + 3_600_000) {
    throw new Error("STAGING_PROXY_DIAGNOSTICS requires run-id and expiry within one hour");
  }
  return { runId, until };
}

function safeAddress(value, runId) {
  const address = String(value ?? "").replace(/^::ffff:/, "");
  if (!isIP(address)) return "unknown";
  // Internal peers are needed for topology analysis. Never expose public client IPs.
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
    || address === "::1" || /^f[cd][0-9a-f]{2}:/i.test(address)) return address;
  return `public-${createHash("sha256").update(`${runId}:${address}`).digest("hex").slice(0, 16)}`;
}

const SYNTHETIC_IPS = new Set(["198.51.100.17", "203.0.113.29", "192.0.2.41"]);

export function createStagingProxyDiagnostics({ config, logger, instanceId, now = Date.now }) {
  let remaining = 48;
  return (request, _response, next) => {
    const id = request.headers["x-request-id"];
    if (config && remaining > 0 && now() < config.until && typeof id === "string"
      && id.startsWith(`${config.runId}-`) && /^[a-zA-Z0-9-]{1,128}$/.test(id)) {
      remaining -= 1;
      const xff = String(request.headers["x-forwarded-for"] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      const xfp = request.headers["x-forwarded-proto"];
      logger.info("staging.proxy_diagnostic", {
        runId: config.runId, requestId: id, instanceId,
        remoteAddress: safeAddress(request.socket.remoteAddress, config.runId),
        ip: safeAddress(request.ip, config.runId),
        ipEqualsPeer: request.ip === request.socket.remoteAddress,
        protocol: ["http", "https"].includes(request.protocol) ? request.protocol : "other",
        secure: request.secure,
        xffPresent: request.headers["x-forwarded-for"] !== undefined,
        xffCount: xff.length,
        xffSyntheticPositions: xff.flatMap((value, index) => SYNTHETIC_IPS.has(value) ? [{ index, value }] : []),
        xfpPresent: xfp !== undefined,
        xfp: ["http", "https"].includes(xfp) ? xfp : "other-or-absent",
        forwardedPresent: request.headers.forwarded !== undefined,
        forwardedContainsSynthetic: String(request.headers.forwarded ?? "").includes("198.51.100.17"),
      });
    }
    next();
  };
}
