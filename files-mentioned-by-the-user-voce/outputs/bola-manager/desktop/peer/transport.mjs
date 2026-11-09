import { createFrameDecoder, encodeFrames } from "./framing.mjs";

const bridge = window.peerNetwork;
const peers = new Map();
const LIMIT = 8 * 1024 * 1024;
function close(id) {
  const entry = peers.get(id);
  if (!entry) return;
  peers.delete(id); clearTimeout(entry.pumpTimer); clearTimeout(entry.connectTimer);
  entry.decoder.clear(); entry.queue.length = 0;
  entry.channel?.close(); entry.connection.close(); bridge.closed(id);
}
function pump(entry) {
  clearTimeout(entry.pumpTimer);
  if (entry.channel?.readyState !== "open") return;
  try {
    while (entry.queue.length && entry.channel.bufferedAmount < 256 * 1024) {
      const text = entry.queue.shift(); entry.bytes -= text.length; entry.channel.send(text);
    }
    if (entry.queue.length) entry.pumpTimer = setTimeout(() => pump(entry), 20);
  } catch { close(entry.id); }
}
function send(id, value) {
  const entry = peers.get(id);
  if (!entry || entry.channel?.readyState !== "open") throw new Error("PEER_DISCONNECTED");
  const frames = encodeFrames(value);
  const size = frames.reduce((sum, item) => sum + item.length, 0);
  if (entry.bytes + size > LIMIT) { close(id); throw new Error("PEER_BACKPRESSURE_LIMIT"); }
  entry.queue.push(...frames); entry.bytes += size; pump(entry);
}
function attach(entry, channel) {
  if (entry.channel || channel.label !== "bola-manager-v1" || channel.ordered !== true || channel.maxRetransmits != null || channel.maxPacketLifeTime != null) { close(entry.id); return; }
  entry.channel = channel;
  channel.bufferedAmountLowThreshold = 64 * 1024;
  channel.onbufferedamountlow = () => pump(entry);
  channel.onopen = () => {
    clearTimeout(entry.connectTimer);
    if (entry.proof) send(entry.id, { type: "hello", proof: entry.proof });
  };
  channel.onmessage = ({ data }) => {
    try { const frame = entry.decoder.push(data); if (frame) bridge.message({ peerId: entry.id, frame }); }
    catch { close(entry.id); }
  };
  channel.onclose = () => close(entry.id);
  channel.onerror = () => close(entry.id);
}
function create(id, proof) {
  if (!/^[a-f0-9-]{36}$/.test(id) || peers.has(id) || peers.size >= 7) throw new Error("PEER_LIMIT");
  // No external signaling, STUN or TURN is contacted in the direct LAN/VPN increment.
  const connection = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle" });
  const entry = { id, connection, proof, channel: null, decoder: createFrameDecoder(), queue: [], bytes: 0, pumpTimer: null,
    connectTimer: setTimeout(() => close(id), 300_000) };
  peers.set(id, entry);
  connection.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(connection.connectionState)) close(id);
  };
  connection.oniceconnectionstatechange = () => {
    if (connection.iceConnectionState === "disconnected") close(id);
  };
  connection.ondatachannel = ({ channel }) => attach(entry, channel);
  return entry;
}
async function localDescription(entry) {
  if (entry.connection.iceGatheringState !== "complete") await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("PEER_ICE_TIMEOUT")); }, 10_000);
    const change = () => { if (entry.connection.iceGatheringState === "complete") { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timer); entry.connection.removeEventListener("icegatheringstatechange", change); };
    entry.connection.addEventListener("icegatheringstatechange", change); change();
  });
  const description = entry.connection.localDescription;
  return { type: description.type, sdp: description.sdp };
}
bridge.onCommand(async (command) => {
  try {
    let value;
    if (command.action === "offer") {
      const entry = create(command.peerId);
      attach(entry, entry.connection.createDataChannel("bola-manager-v1", { ordered: true }));
      await entry.connection.setLocalDescription(await entry.connection.createOffer());
      value = await localDescription(entry);
    } else if (command.action === "answer") {
      const entry = create(command.peerId, command.proof);
      await entry.connection.setRemoteDescription(command.description);
      await entry.connection.setLocalDescription(await entry.connection.createAnswer());
      value = await localDescription(entry);
    } else if (command.action === "accept") {
      const entry = peers.get(command.peerId);
      if (!entry || entry.proof || entry.connection.signalingState !== "have-local-offer") throw new Error("PEER_SIGNAL_STATE");
      await entry.connection.setRemoteDescription(command.description);
    } else if (command.action === "send") send(command.peerId, command.frame);
    else if (command.action === "close") close(command.peerId);
    else throw new Error("PEER_COMMAND_INVALID");
    if (command.id) bridge.result({ id: command.id, value });
  } catch (error) {
    close(command.peerId);
    if (command.id) bridge.result({ id: command.id, error: String(error.message).startsWith("PEER_") ? error.message : "PEER_TRANSPORT_FAILED" });
  }
});
window.addEventListener("beforeunload", () => { for (const id of [...peers.keys()]) close(id); });
