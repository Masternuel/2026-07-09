import { HTTP_CSP } from "../../shared/imagePolicy.mjs";
import { SECURITY_HEADERS } from "../../shared/securityHeaders.mjs";

export function createSecurityHeaders(config) {
  return (request) => {
    const headers = {
      ...SECURITY_HEADERS,
      "Content-Security-Policy": HTTP_CSP,
      "X-Frame-Options": "DENY",
    };
    // Explicit HTTPS-only staging ingress, not a claim made by forwarded headers.
    const stagingIngress = config.stagingHttpsOrigin
      && request.headers.host === new URL(config.stagingHttpsOrigin).host;
    if (config.enableHsts && (request.secure || request.socket?.encrypted || stagingIngress)) {
      headers["Strict-Transport-Security"] = `max-age=${config.stagingHttpsOrigin ? 86400 : 31536000}`;
    }
    return headers;
  };
}

export function applySecurityHeaders(response, headers) {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
}

export function secureEngineTransport({ httpServer, io, originPolicy, headersForRequest, upgradeHandlers }) {
  // Official hook covers accepted upgrades; HTTP errors need headers before CORS.
  io.engine.on("headers", (headers, request) => Object.assign(headers, headersForRequest(request)));
  httpServer.prependListener("request", (request, response) => {
    applySecurityHeaders(response, headersForRequest(request));
  });

  // Engine.IO 6 abortUpgrade bypasses its headers hook. Route denied origins at
  // the application's public HTTP upgrade boundary, with one response writer.
  // Other protocol errors remain Engine.IO's responsibility.
  for (const handler of upgradeHandlers) httpServer.removeListener("upgrade", handler);
  httpServer.on("upgrade", (request, socket, head) => {
    const path = request.url?.split("?", 1)[0] ?? "";
    if (path.startsWith(`${io.path()}/`) && !originPolicy.allows(request.headers.origin)) {
      const body = "Forbidden origin";
      const headers = {
        ...headersForRequest(request),
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(body)),
        Connection: "close",
      };
      socket.on("error", () => {});
      socket.end(`HTTP/1.1 400 Bad Request\r\n${Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}`).join("\r\n")}\r\n\r\n${body}`);
      return;
    }
    for (const handler of upgradeHandlers) handler.call(httpServer, request, socket, head);
  });
}
