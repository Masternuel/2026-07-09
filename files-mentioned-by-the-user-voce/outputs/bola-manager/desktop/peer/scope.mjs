import { peerError } from "./identity.mjs";
export const PEER_EVENTS = new Set([
  "room:join", "room:resume", "room:sync", "room:ready", "room:start", "lineup:save", "chat:send", "chat:direct",
  "match:ready", "match:start", "match:skip", "match:speed", "match:halftime-plan", "match:halftime-ready", "match:sync",
  "market:sync", "market:offer", "market:respond", "market:list", "market:bid", "market:cancel-listing", "market:exercise-loan-option",
  "club:upgrade", "career:staff:hire", "career:staff:fire", "career:staff:renew", "career:professional:lifecycle", "club:news-read",
  "club:staff-hire", "club:staff-fire", "club:staff-renew",
]);
export function scopedEvent(event, payload, roomCode) {
  if (!PEER_EVENTS.has(event) || !payload || typeof payload !== "object" || Array.isArray(payload)) throw peerError("PEER_OPERATION_FORBIDDEN");
  if (String(payload.code ?? payload.roomCode ?? "").toUpperCase() !== roomCode) throw peerError("PEER_ROOM_FORBIDDEN");
  if ((payload.code && String(payload.code).toUpperCase() !== roomCode) || (payload.roomCode && String(payload.roomCode).toUpperCase() !== roomCode)) throw peerError("PEER_ROOM_FORBIDDEN");
  return payload;
}
export function scopedHttp(input, roomCode) {
  if (typeof input?.path !== "string" || input.path.length > 4096 || !input.path.startsWith("/api/")
    || /[\\#\r\n]/.test(input.path) || /%2f|%5c|%2e/i.test(input.path)) throw peerError("PEER_OPERATION_FORBIDDEN");
  const url = new URL(input.path, "http://peer.invalid");
  if (url.origin !== "http://peer.invalid" || url.pathname !== input.path.split("?")[0]) throw peerError("PEER_OPERATION_FORBIDDEN");
  const method = input.method ?? "GET";
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) throw peerError("PEER_OPERATION_FORBIDDEN");
  const [, , family, code] = url.pathname.split("/");
  if (["teams", "leagues", "tournaments"].includes(family)) {
    if (method !== "GET") throw peerError("PEER_OPERATION_FORBIDDEN");
    const supplied = url.searchParams.getAll("roomCode");
    if (supplied.some((value) => value.toUpperCase() !== roomCode)) throw peerError("PEER_ROOM_FORBIDDEN");
    url.searchParams.set("roomCode", roomCode);
  } else if (["rooms", "matches", "market", "scouting", "news"].includes(family)) {
    if (family === "rooms" && !code && method === "GET") return { path: "/api/rooms", method, body: undefined, roomList: true };
    if (String(code).toUpperCase() !== roomCode) throw peerError("PEER_ROOM_FORBIDDEN");
    if (family === "rooms" && (method === "DELETE" || /\/(delete|import|backup|restore)(\/|$)/.test(url.pathname))) throw peerError("PEER_OPERATION_FORBIDDEN");
  } else throw peerError("PEER_OPERATION_FORBIDDEN");
  if (input.body != null && (typeof input.body !== "object" || Array.isArray(input.body))) throw peerError("PEER_OPERATION_FORBIDDEN");
  if (input.body?.roomCode && String(input.body.roomCode).toUpperCase() !== roomCode) throw peerError("PEER_ROOM_FORBIDDEN");
  return { path: url.pathname + url.search, method, body: method === "GET" ? undefined : input.body, roomList: false };
}
