import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// Identity assertion for match commands forwarded between replicas over Redis.
// The source replica re-verifies the Firebase token (with revocation check)
// right before signing, so only a short-lived signed identity crosses Redis
// instead of the user's bearer token (audit S-02).

const VERSION = 1;
const DEFAULT_TTL_MS = 15_000;
const MAX_ASSERTION_LENGTH = 4_096;
const AUTH_TYPES = new Set(["firebase", "demo"]);

const invalid = () => Object.assign(new Error("Identidade de cluster invalida"), {
  name: "AuthError", code: "INVALID_AUTH_TOKEN", status: 401,
});

export function validateClusterSigningKey(value) {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length < 32 || value.length > 512
    || !/^[A-Za-z0-9._~+/-]+={0,2}$/.test(value)) {
    throw new Error("CLUSTER_SIGNING_KEY deve conter 32 a 512 caracteres seguros, sem espacos");
  }
  return value;
}

/** Returns null when no key is configured, so callers keep the token-forwarding fallback. */
export function createClusterIdentity(key, { now = Date.now, ttlMs = DEFAULT_TTL_MS } = {}) {
  const secret = validateClusterSigningKey(key);
  if (!secret) return null;
  const mac = (payload) => createHmac("sha256", secret).update(payload).digest();

  return {
    sign(user) {
      if (!user?.uid || !AUTH_TYPES.has(user.authType)) throw invalid();
      const payload = Buffer.from(JSON.stringify({
        v: VERSION,
        uid: String(user.uid),
        name: String(user.name ?? "Manager"),
        email: user.email ?? null,
        picture: user.picture ?? null,
        editor: user.editor === true,
        authType: user.authType,
        exp: now() + ttlMs,
        jti: randomUUID(),
      })).toString("base64url");
      return `${payload}.${mac(payload).toString("base64url")}`;
    },
    verify(assertion) {
      if (typeof assertion !== "string" || assertion.length > MAX_ASSERTION_LENGTH) throw invalid();
      const [payload, signature, extra] = assertion.split(".");
      if (!payload || !signature || extra !== undefined) throw invalid();
      const provided = Buffer.from(signature, "base64url");
      const expected = mac(payload);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw invalid();
      let claims;
      try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw invalid(); }
      if (claims?.v !== VERSION || typeof claims.uid !== "string" || !claims.uid
        || !AUTH_TYPES.has(claims.authType) || !Number.isFinite(claims.exp)
        || claims.exp <= now() || claims.exp > now() + ttlMs) {
        throw invalid();
      }
      return {
        user: {
          uid: claims.uid,
          name: claims.name,
          email: claims.email,
          picture: claims.picture,
          editor: claims.authType === "firebase" && claims.editor === true,
          authType: claims.authType,
        },
        expiresAt: claims.exp,
      };
    },
  };
}
