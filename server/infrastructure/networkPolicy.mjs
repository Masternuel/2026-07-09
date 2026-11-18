import { isIP } from "node:net";

export function parseTrustedProxies(value) {
  if (!value || value === "false") return false;
  const proxies = String(value).split(",").map((item) => item.trim());
  for (const proxy of proxies) {
    const [ip, prefix, extra] = proxy.split("/");
    const version = isIP(ip);
    const bits = version === 4 ? 32 : 128;
    if (!version || extra != null || (prefix != null && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > bits))) {
      throw new Error("TRUST_PROXY deve conter apenas IPs/CIDRs de proxies verificados; numeros de saltos e redes universais nao sao aceitos");
    }
  }
  return proxies;
}

export function createOriginPolicy(clientOrigin, nodeEnv) {
  const origins = String(clientOrigin ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const wildcard = origins.includes("*");
  if (wildcard && (nodeEnv === "production" || origins.length !== 1)) {
    throw new Error("CLIENT_ORIGIN deve listar origens explicitas; wildcard nao permitido nesta configuracao");
  }
  for (const origin of origins.filter((item) => item !== "*")) {
    let url;
    try { url = new URL(origin); } catch { /* rejected below */ }
    if (!url || !["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
      throw new Error("CLIENT_ORIGIN deve conter origens HTTP/HTTPS exatas, sem caminho, credenciais ou query");
    }
  }
  const allows = (origin) => origin == null || (typeof origin === "string" && origin !== "null" && (wildcard || origins.includes(origin)));
  return {
    allows,
    cors: {
      credentials: !wildcard,
      origin(origin, callback) {
        if (allows(origin)) return callback(null, origin ? true : false);
        callback(Object.assign(new Error("Origem nao permitida"), { code: "CORS_ORIGIN_DENIED", status: 403 }));
      },
    },
    allowRequest(request, callback) { callback(null, allows(request.headers.origin)); },
  };
}
