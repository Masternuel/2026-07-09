import { io } from "socket.io-client";
import { emitRoomForViewers } from "../../server/services/roomVisibility.mjs";
import { createInvitation, peerError, verifyInvitationProof } from "./identity.mjs";
import { scopedEvent, scopedHttp } from "./scope.mjs";

export function createHostGateway(backend, { send, closeTransport }) {
  const invitations = new Map();
  const peers = new Map();
  let hostingRoom = null;
  let generation = 0;
  async function createInvite(roomCode) {
    const currentGeneration = generation;
    const room = await backend.server.store.requireViewerRoom(String(roomCode).toUpperCase(), backend.profileId);
    if (currentGeneration !== generation) throw peerError("PEER_DISCONNECTED");
    if (room.ownerId !== backend.profileId || room.maxManagers <= 1) throw peerError("PEER_HOST_REQUIRES_SHARED_CAREER");
    if (hostingRoom && hostingRoom !== room.code) throw peerError("PEER_HOST_ALREADY_ACTIVE");
    if (invitations.size + peers.size >= room.maxManagers - 1) throw peerError("PEER_HOST_FULL");
    hostingRoom = room.code;
    const invitation = createInvitation(room.code);
    const timer = setTimeout(() => { disconnect(invitation.id); closeTransport(invitation.id); }, 300_000);
    timer.unref();
    invitations.set(invitation.id, { invitation, timer });
    return invitation;
  }
  function disconnect(id) {
    const pending = invitations.get(id);
    if (pending) { clearTimeout(pending.timer); invitations.delete(id); }
    const peer = peers.get(id);
    if (peer) {
      peers.delete(id); backend.revokePeer(peer.token);
      peer.socket?.disconnect();
      for (const controller of peer.requests.values()) controller.abort();
    }
    if (!peers.size && !invitations.size) hostingRoom = null;
  }
  async function authorize(id, frame) {
    const pending = invitations.get(id);
    if (!pending || peers.has(id)) throw peerError("PEER_INVITE_EXPIRED_OR_USED");
    // Consume before awaiting any engine operation; simultaneous reuse cannot win.
    invitations.delete(id); clearTimeout(pending.timer);
    const identity = verifyInvitationProof(pending.invitation, frame.proof);
    if ([...peers.values()].some((peer) => peer.identity.uid === identity.uid)) throw peerError("PEER_ALREADY_CONNECTED");
    const peer = { identity, roomCode: pending.invitation.roomCode, token: backend.grantPeer(identity), socket: null, requests: new Map() };
    peers.set(id, peer);
    try {
      const room = await backend.server.store.joinRoom(peer.roomCode, { managerId: identity.uid, managerName: identity.name, clubId: null });
      if (peers.get(id) !== peer) throw peerError("PEER_DISCONNECTED");
      await emitRoomForViewers(backend.server.io, room);
      send(id, { type: "helloResult", session: { identity: { uid: identity.uid, displayName: identity.name, email: null, photoURL: null, mode: "peer" }, token: peer.token, roomCode: peer.roomCode } });
    } catch (error) { disconnect(id); throw error; }
  }
  async function operation(id, peer, frame, controller) {
    if (frame.operation === "http") {
      const input = scopedHttp(frame.payload, peer.roomCode);
      const headers = { Authorization: `Bearer ${peer.token}`, Accept: "application/json" };
      if (input.body) headers["Content-Type"] = "application/json";
      const response = await fetch(backend.origin + input.path, { method: input.method, headers,
        body: input.body ? JSON.stringify(input.body) : undefined, signal: controller.signal, redirect: "error" });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024) throw peerError("PEER_RESPONSE_TOO_LARGE");
      let body = bytes;
      if (input.roomList) {
        const value = JSON.parse(bytes.toString("utf8"));
        body = Buffer.from(JSON.stringify({ ...value, rooms: value.rooms?.filter((room) => room.code === peer.roomCode) ?? [] }));
      }
      return { status: response.status, contentType: response.headers.get("content-type"), body: body.toString("base64") };
    }
    if (frame.operation === "socket:connect") {
      if (peer.socket) throw peerError("PEER_SOCKET_ALREADY_CONNECTED");
      const socket = io(backend.origin, { transports: ["websocket"], reconnection: false, auth: { token: peer.token }, extraHeaders: { Origin: backend.origin } });
      peer.socket = socket;
      socket.onAny((event, payload) => {
        if (peers.get(id) === peer) send(id, { type: "event", event, payload });
      });
      socket.on("disconnect", () => { if (peers.get(id) === peer) send(id, { type: "event", event: "peer:socket-disconnected", payload: {} }); });
      await new Promise((resolve, reject) => {
        const abort = () => { socket.disconnect(); reject(peerError("PEER_DISCONNECTED")); };
        controller.signal.addEventListener("abort", abort, { once: true });
        socket.once("connect", () => { controller.signal.removeEventListener("abort", abort); resolve(); });
        socket.once("connect_error", (error) => { controller.signal.removeEventListener("abort", abort); socket.disconnect(); reject(peerError(error.data?.code ?? "PEER_SOCKET_FAILED")); });
      });
      return { connected: true };
    }
    if (frame.operation === "socket:disconnect") { peer.socket?.disconnect(); peer.socket = null; return {}; }
    if (frame.operation === "socket:emit") {
      if (!peer.socket?.connected) throw peerError("PEER_DISCONNECTED");
      const { event, payload } = frame.payload ?? {};
      scopedEvent(event, payload, peer.roomCode);
      return peer.socket.timeout(30_000).emitWithAck(event, payload);
    }
    throw peerError("PEER_OPERATION_FORBIDDEN");
  }
  async function receive(id, frame) {
    try {
      if (frame?.type === "hello") { await authorize(id, frame); return; }
      const peer = peers.get(id);
      if (!peer) throw peerError("PEER_AUTH_REQUIRED");
      if (frame?.type === "cancel") { peer.requests.get(frame.id)?.abort(); return; }
      if (frame?.type !== "request" || !/^[a-f0-9-]{36}$/.test(String(frame.id)) || peer.requests.has(frame.id)) throw peerError("PEER_REQUEST_INVALID");
      if (peer.requests.size >= 8) { send(id, { type: "response", id: frame.id, error: { code: "PEER_BUSY" } }); return; }
      const controller = new AbortController();
      peer.requests.set(frame.id, controller);
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const value = await operation(id, peer, frame, controller);
        if (!controller.signal.aborted && peers.get(id) === peer) send(id, { type: "response", id: frame.id, value });
      } catch (error) {
        if (peers.get(id) === peer) send(id, { type: "response", id: frame.id, error: { code: /^[A-Z0-9_:-]{1,80}$/.test(error.code) ? error.code : "PEER_OPERATION_FAILED" } });
      } finally { clearTimeout(timer); peer.requests.delete(frame.id); }
    } catch (error) {
      send(id, { type: "helloError", error: { code: /^[A-Z0-9_:-]{1,80}$/.test(error.code) ? error.code : "PEER_AUTH_REJECTED" } });
      disconnect(id); closeTransport(id);
    }
  }
  return {
    createInvite, receive, disconnect,
    status: () => ({ mode: hostingRoom ? "host" : "offline", connected: peers.size > 0, roomCode: hostingRoom, peers: peers.size, pendingInvites: invitations.size, transport: "direct-webrtc" }),
    close() { generation += 1; for (const id of [...invitations.keys(), ...peers.keys()]) { disconnect(id); closeTransport(id); } },
  };
}
