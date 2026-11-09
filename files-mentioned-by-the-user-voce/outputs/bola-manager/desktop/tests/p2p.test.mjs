import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { io } from "socket.io-client";
import { startLocalBackend } from "../localBackend.mjs";
import { createPeerRuntime } from "../peer/runtime.mjs";
import { createInvitation, encodeSignal, parseSignal, invitationProof, verifyInvitationProof } from "../peer/identity.mjs";
import { createFrameDecoder, encodeFrames, MAX_PEER_BYTES } from "../peer/framing.mjs";
import { scopedEvent, scopedHttp } from "../peer/scope.mjs";
import { PeerRpc } from "../peer/rpc.mjs";
import { createAiTacticPlan } from "../../server/game/tactics.mjs";

const silent = { info() {}, error() {}, warn() {}, debug() {} };
const root = resolve(".tmp/peer-tests");
async function directory(t) {
  await mkdir(root, { recursive: true });
  const value = await mkdtemp(join(root, "run-"));
  t.after(async () => {
    assert.ok(relative(root, value) && !relative(root, value).startsWith(".."));
    await rm(value, { recursive: true, force: true });
  });
  return value;
}
async function waitFor(predicate, budget = 5000) {
  const deadline = Date.now() + budget;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, "P2P condition exceeded its deadline");
    await new Promise((done) => setTimeout(done, 10));
  }
}

test("P2P frames preserve chunked Unicode and impose bounded ordered messages", () => {
  const original = { text: "⚽ São Paulo 東京".repeat(7000), nested: [null, false, 0, { value: "" }] };
  const frames = encodeFrames(original);
  assert.ok(frames.length > 1);
  assert.ok(frames.every((frame) => frame.length < 16384));
  const decoder = createFrameDecoder();
  const result = frames.map((frame) => decoder.push(frame)).at(-1);
  assert.deepEqual(result, original);
  assert.throws(() => encodeFrames({ text: "x".repeat(MAX_PEER_BYTES) }), { code: "PEER_FRAME_INVALID" });
  assert.throws(() => createFrameDecoder().push(frames[1]), { code: "PEER_FRAME_INVALID" });
  assert.throws(() => decoder.push("not JSON"), { code: "PEER_FRAME_INVALID" });
});

test("P2P scope forbids SSRF, traversal, unrelated rooms and owner/catalog mutation endpoints", () => {
  for (const path of ["https://attacker.invalid", "/api/rooms/../editor", "/api/rooms/%2e%2e/editor", "/api/editor", "/api/rooms/BOLA-BBBB", "/api/teams/AUR/players?roomCode=BOLA-BBBB"]) {
    assert.throws(() => scopedHttp({ path }, "BOLA-AAAA"));
  }
  assert.throws(() => scopedHttp({ path: "/api/rooms", method: "POST" }, "BOLA-AAAA"));
  assert.throws(() => scopedHttp({ path: "/api/rooms/BOLA-AAAA", method: "DELETE" }, "BOLA-AAAA"));
  assert.throws(() => scopedHttp({ path: "/api/teams/AUR", method: "PUT" }, "BOLA-AAAA"));
  assert.throws(() => scopedHttp({ path: "/api/teams/AUR/players?roomCode=BOLA-AAAA&roomCode=BOLA-BBBB" }, "BOLA-AAAA"));
  assert.equal(scopedHttp({ path: "/api/teams/AUR/players" }, "BOLA-AAAA").path, "/api/teams/AUR/players?roomCode=BOLA-AAAA");
  assert.throws(() => scopedEvent("room:delete", { code: "BOLA-AAAA" }, "BOLA-AAAA"));
  assert.throws(() => scopedEvent("room:join", { code: "BOLA-AAAA", roomCode: "BOLA-BBBB" }, "BOLA-AAAA"));
});

test("P2P RPC cancellation/disconnection settles pending callers without retries", async () => {
  const frames = [];
  const rpc = new PeerRpc((frame) => frames.push(frame));
  const controller = new AbortController();
  const operation = rpc.request("http", {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(operation, { code: "PEER_REQUEST_ABORTED" });
  assert.deepEqual(frames.map((frame) => frame.type), ["request", "cancel"]);
  const pending = rpc.request("http", {});
  rpc.close();
  await assert.rejects(pending, { code: "PEER_DISCONNECTED" });
  await assert.rejects(rpc.request("http", {}), { code: "PEER_DISCONNECTED" });
});

test("P2P RPC deadline is bounded and does not resubmit mutations", async () => {
  const frames = [];
  const rpc = new PeerRpc((frame) => frames.push(frame));
  await assert.rejects(rpc.request("socket:emit", {}, { timeoutMs: 25 }), { code: "PEER_REQUEST_TIMEOUT" });
  assert.equal(frames.filter((frame) => frame.type === "request").length, 1);
  rpc.close();
});

test("P2P concurrent pairing and disconnect cannot install a stale guest session", async () => {
  let release;
  const gate = new Promise((done) => { release = done; });
  const state = { profile: { uid: "local-test", displayName: "Manager" } };
  const backend = { origin: "http://127.0.0.1", database: {
    read: async (reader) => { if (!state.matches) { await gate; state.matches = []; } return reader(state); },
    transaction: async (writer) => writer(state),
  } };
  const runtime = createPeerRuntime(backend, { send() {}, closeTransport() {} });
  const invitation = createInvitation("BOLA-AAAA");
  const first = runtime.beginGuest(invitation);
  await assert.rejects(runtime.beginGuest(invitation), { code: "PEER_MODE_CONFLICT" });
  await runtime.disconnect();
  release();
  await assert.rejects(first, { code: "PEER_DISCONNECTED" });
  assert.equal(runtime.status().mode, "offline");
  await runtime.close();
});

test("P2P invitation rejects offline careers and invalid/replayed proofs before registration", async (t) => {
  const backend = await startLocalBackend({ directory: await directory(t), logger: silent });
  const messages = [];
  const runtime = createPeerRuntime(backend, { send: (_id, frame) => messages.push(frame), closeTransport() {} });
  try {
    const session = await backend.session();
    const create = async (maxManagers) => (await (await fetch(backend.origin + "/api/rooms", { method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Scope ${maxManagers}`, clubId: "AUR", activeLeagues: ["BR-A"], seasonLength: 1, maxManagers }) })).json()).room;
    const offline = await create(1);
    await assert.rejects(runtime.createInvite(offline.code), { code: "PEER_HOST_REQUIRES_SHARED_CAREER" });
    const room = await create(4);
    const invitation = await runtime.createInvite(room.code);
    const proof = await invitationProof(backend.database, invitation);
    await runtime.receive(invitation.id, { type: "hello", proof: { ...proof, signature: "x".repeat(86) } });
    assert.equal(messages.at(-1).type, "helloError");
    await runtime.receive(invitation.id, { type: "hello", proof });
    assert.equal(messages.at(-1).error.code, "PEER_INVITE_EXPIRED_OR_USED");
    assert.equal((await backend.server.store.getRoom(room.code)).managers.length, 1);
    assert.equal(runtime.status().peers, 0);
  } finally { await runtime.close(); await backend.close(); }
});

test("P2P device proof binds one room/nonce and retains identity across process reload", async (t) => {
  const path = await directory(t);
  let backend = await startLocalBackend({ directory: path, logger: silent });
  try {
    const invitation = createInvitation("BOLA-AAAA");
    const proof = await invitationProof(backend.database, invitation);
    const identity = verifyInvitationProof(invitation, { ...proof, uid: "forged-owner" });
    assert.match(identity.uid, /^peer-[a-f0-9]{64}$/);
    assert.throws(() => verifyInvitationProof({ ...invitation, roomCode: "BOLA-BBBB" }, proof), { code: "PEER_AUTH_REJECTED" });
    assert.throws(() => verifyInvitationProof(invitation, { ...proof, secret: "x".repeat(43) }), { code: "PEER_AUTH_REJECTED" });
    const signal = encodeSignal({ type: "offer", id: invitation.id, invitation, description: { type: "offer", sdp: "test" } });
    assert.equal(parseSignal(signal, "offer").id, invitation.id);
    assert.throws(() => parseSignal(signal, "answer"), { code: "PEER_SIGNAL_INVALID" });
    const expired = { ...invitation, expiresAt: Date.now() - 1 };
    assert.throws(() => parseSignal(encodeSignal({ type: "offer", id: expired.id, invitation: expired, description: { type: "offer", sdp: "test" } }), "offer"));
    await backend.close();
    backend = await startLocalBackend({ directory: path, logger: silent });
    const next = createInvitation("BOLA-AAAA");
    assert.equal(verifyInvitationProof(next, await invitationProof(backend.database, next)).uid, identity.uid);
    const session = await backend.session();
    assert.equal(Object.hasOwn(session.identity, "peerKeys"), false);
  } finally { await backend.close(); }
});

test("P2P gateway reuses real engine authorization, saves on host, isolates rooms and fails closed on host loss", async (t) => {
  const hostPath = await directory(t);
  const guestPath = await directory(t);
  const hostBackend = await startLocalBackend({ directory: hostPath, logger: silent });
  const guestBackend = await startLocalBackend({ directory: guestPath, logger: silent });
  let host;
  let guest;
  const forwardingErrors = [];
  const deliver = (runtime, id, frame) => void runtime.receive(id, frame).catch((error) => forwardingErrors.push(error.code));
  host = createPeerRuntime(hostBackend, { send: (id, frame) => deliver(guest, id, frame), closeTransport: (id) => guest.drop(id) });
  guest = createPeerRuntime(guestBackend, { send: (id, frame) => deliver(host, id, frame), closeTransport: (id) => host.drop(id) });
  let guestSocket;
  let hostSocket;
  try {
    const hostSession = await hostBackend.session();
    const created = await fetch(hostBackend.origin + "/api/rooms", { method: "POST", headers: { Authorization: `Bearer ${hostSession.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P2P regression", clubId: "AUR", activeLeagues: ["BR-A"], seasonLength: 1, maxManagers: 4 }) });
    assert.equal(created.status, 201);
    const { room } = await created.json();
    const invitation = await host.createInvite(room.code);
    const proof = await guest.beginGuest(invitation);
    await host.receive(invitation.id, { type: "hello", proof });
    await waitFor(() => guest.status().connected);
    const relay = guest.activateGuest();
    const session = await guest.session();
    assert.equal(session.identity.mode, "peer");
    assert.notEqual(session.identity.uid, hostSession.identity.uid);
    const headers = { Authorization: `Bearer ${session.token}` };
    assert.equal((await fetch(relay.origin + "/api/rooms")).status, 401);
    assert.equal((await fetch(relay.origin + "/api/rooms", { headers: { ...headers, Origin: "https://evil.invalid" } })).status, 403);
    const list = await (await fetch(relay.origin + "/api/rooms", { headers })).json();
    assert.deepEqual(list.rooms.map((value) => value.code), [room.code]);
    assert.equal((await fetch(relay.origin + "/api/rooms/BOLA-XXXX", { headers })).status, 403);
    assert.equal((await fetch(relay.origin + "/api/rooms", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })).status, 403);
    const roster = await fetch(relay.origin + `/api/teams/SAN/players?roomCode=${room.code}`, { headers });
    assert.equal(roster.status, 200, await roster.clone().text());
    const { players } = await roster.json();
    assert.equal(players.length, 20);
    guestSocket = io(relay.origin, { transports: ["websocket"], reconnection: false, auth: { token: session.token }, extraHeaders: { Origin: relay.origin } });
    await new Promise((done, reject) => { guestSocket.once("connect", done); guestSocket.once("connect_error", reject); });
    const joined = await guestSocket.timeout(5000).emitWithAck("room:join", { code: room.code, clubId: "SAN" });
    assert.equal(joined.ok, true, JSON.stringify(joined));
    const forbidden = await guestSocket.timeout(5000).emitWithAck("room:start", { code: room.code });
    assert.equal(forbidden.ok, false);
    const otherRoom = await guestSocket.timeout(5000).emitWithAck("room:sync", { code: "BOLA-XXXX" });
    assert.equal(otherRoom.ok, false);
    hostSocket = io(hostBackend.origin, { transports: ["websocket"], reconnection: false, auth: { token: hostSession.token }, extraHeaders: { Origin: hostBackend.origin } });
    await new Promise((done, reject) => { hostSocket.once("connect", done); hostSocket.once("connect_error", reject); });
    await hostSocket.timeout(5000).emitWithAck("room:join", { code: room.code, clubId: "AUR" });
    let stateReceived = false;
    guestSocket.on("room:state", (state) => { if (state.managers?.some((manager) => manager.uid === hostSession.identity.uid || manager.id === hostSession.identity.uid)) stateReceived = true; });
    assert.equal((await guestSocket.timeout(5000).emitWithAck("room:ready", { code: room.code, ready: true, clubId: "SAN" })).ok, true);
    assert.equal((await hostSocket.timeout(5000).emitWithAck("room:ready", { code: room.code, ready: true, clubId: "AUR" })).ok, true);
    await waitFor(() => stateReceived);
    assert.equal((await hostSocket.timeout(5000).emitWithAck("room:start", { code: room.code })).ok, true);
    const lineupIds = [players.find((player) => player.position === "GOL"), ...players.filter((player) => player.position !== "GOL").slice(0, 10)].map((player) => player.id);
    const tactics = createAiTacticPlan(players, lineupIds);
    const lineup = await guestSocket.timeout(5000).emitWithAck("lineup:save", { code: room.code, lineupIds, tactics });
    assert.equal(lineup.ok, true, JSON.stringify(lineup));
    assert.deepEqual((await hostBackend.server.store.getRoom(room.code)).lineups.find((value) => value.managerId === session.identity.uid).tactics, tactics);
    let hostEvent;
    let guestEvent;
    hostSocket.once("match:event", (event) => { hostEvent = event; });
    guestSocket.once("match:event", (event) => { guestEvent = event; });
    assert.equal((await hostSocket.timeout(5000).emitWithAck("match:ready", { code: room.code, ready: true })).ok, true);
    assert.equal((await guestSocket.timeout(5000).emitWithAck("match:ready", { code: room.code, ready: true })).ok, true);
    await waitFor(() => hostEvent && guestEvent);
    assert.deepEqual(guestEvent, hostEvent, "Both managers consume the same host simulation event");
    assert.ok(await hostBackend.database.read((state) => state.matches.some((match) => match._matchRemoved !== true)));
    assert.equal(await guestBackend.database.read((state) => state.matches.length), 0);
    assert.equal((await guestBackend.database.read((state) => state.rooms.rooms)).length, 0);
    assert.equal((await hostBackend.server.store.getRoom(room.code)).status, "active");
    await host.disconnect();
    await waitFor(() => !guestSocket.connected);
    assert.equal(guest.status().connected, false);
    assert.equal((await fetch(relay.origin + "/api/rooms", { headers })).status, 401);
    assert.equal((await guest.session()).identity.mode, "peer", "Host loss cannot silently enter the guest's own offline engine");
    assert.equal(forwardingErrors.length, 0);
    assert.equal((await fetch(hostBackend.origin + "/api/rooms", { headers })).status, 401, "Disconnected peer capability must be revoked on the host");
    await guest.disconnect();
    const reconnect = await host.createInvite(room.code);
    const reconnectProof = await guest.beginGuest(reconnect);
    await host.receive(reconnect.id, { type: "hello", proof: reconnectProof });
    await waitFor(() => guest.status().connected);
    guest.activateGuest();
    assert.equal((await guest.session()).identity.uid, session.identity.uid);
    assert.equal((await hostBackend.server.store.getRoom(room.code)).managers.length, 2, "Manual reconnect cannot create a duplicate manager");
  } finally {
    guestSocket?.close(); hostSocket?.close();
    await guest.close(); await host.close();
    await guestBackend.close(); await hostBackend.close();
  }
  const restored = await startLocalBackend({ directory: hostPath, logger: silent });
  try {
    const rooms = await restored.server.store.listRoomsForManager(restored.profileId);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].managers.length, 2);
    assert.equal(rooms[0].status, "active");
  } finally { await restored.close(); }
});
