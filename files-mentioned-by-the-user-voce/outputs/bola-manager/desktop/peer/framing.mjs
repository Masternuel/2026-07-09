export const MAX_PEER_BYTES = 4 * 1024 * 1024;
const CHUNK_BYTES = 10 * 1024;
function invalid() { return Object.assign(new Error("Frame P2P invalido ou grande demais."), { code: "PEER_FRAME_INVALID" }); }
export function encodeFrames(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (!bytes.length || bytes.length > MAX_PEER_BYTES) throw invalid();
  const id = crypto.randomUUID();
  const count = Math.ceil(bytes.length / CHUNK_BYTES);
  return Array.from({ length: count }, (_, index) => {
    const part = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    return JSON.stringify({ id, index, count, data: btoa(String.fromCharCode(...part)) });
  });
}
export function createFrameDecoder() {
  const pending = new Map();
  let total = 0;
  function clear() { pending.clear(); total = 0; }
  return {
    clear,
    push(text) {
      if (typeof text !== "string" || text.length > 16_384) throw invalid();
      let frame;
      try { frame = JSON.parse(text); } catch { throw invalid(); }
      if (!/^[a-f0-9-]{36}$/.test(String(frame?.id)) || !Number.isInteger(frame.index) || !Number.isInteger(frame.count)
        || frame.count < 1 || frame.count > 410 || frame.index < 0 || frame.index >= frame.count
        || typeof frame.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data)) throw invalid();
      for (const value of pending.values()) if (Date.now() - value.started > 30_000) { clear(); throw invalid(); }
      let assembly = pending.get(frame.id);
      if (!assembly) {
        if (frame.index !== 0 || pending.size >= 4) throw invalid();
        assembly = { count: frame.count, parts: [], bytes: 0, started: Date.now() };
        pending.set(frame.id, assembly);
      }
      if (frame.index !== assembly.parts.length || frame.count !== assembly.count) throw invalid();
      let part;
      try { part = Uint8Array.from(atob(frame.data), (char) => char.charCodeAt(0)); } catch { throw invalid(); }
      if (!part.length || part.length > CHUNK_BYTES || assembly.bytes + part.length > MAX_PEER_BYTES || total + part.length > MAX_PEER_BYTES * 2) throw invalid();
      assembly.parts.push(part); assembly.bytes += part.length; total += part.length;
      if (assembly.parts.length !== assembly.count) return null;
      const bytes = new Uint8Array(assembly.bytes);
      let offset = 0;
      for (const item of assembly.parts) { bytes.set(item, offset); offset += item.length; }
      pending.delete(frame.id); total -= assembly.bytes;
      try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw invalid(); }
    },
  };
}
