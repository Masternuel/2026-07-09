import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { peerError } from "./identity.mjs";

export class PeerRpc extends EventEmitter {
  #pending = new Map();
  #send;
  #closed = false;
  constructor(send) { super(); this.#send = send; }
  get closed() { return this.#closed; }
  send(frame) { if (this.#closed) throw peerError("PEER_DISCONNECTED"); this.#send(frame); }
  request(operation, payload, { signal, timeoutMs = 30_000 } = {}) {
    if (this.#closed || signal?.aborted) return Promise.reject(peerError("PEER_DISCONNECTED"));
    if (this.#pending.size >= 16) return Promise.reject(peerError("PEER_BUSY"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        const item = this.#pending.get(id);
        if (!item) return;
        this.#pending.delete(id); clearTimeout(item.timer); signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => { try { this.send({ type: "cancel", id }); } catch { /* already disconnected */ } finish(peerError("PEER_REQUEST_ABORTED")); };
      const timer = setTimeout(() => {
        try { this.send({ type: "cancel", id }); } catch { /* already disconnected */ }
        finish(peerError("PEER_REQUEST_TIMEOUT"));
      }, timeoutMs);
      this.#pending.set(id, { finish, timer });
      signal?.addEventListener("abort", abort, { once: true });
      try { this.send({ type: "request", id, operation, payload }); } catch (error) { finish(error); }
    });
  }
  receive(frame) {
    if (this.#closed || !frame || typeof frame !== "object") return;
    if (frame.type === "response") {
      this.#pending.get(frame.id)?.finish(frame.error ? peerError(frame.error.code) : null, frame.value);
    } else if (frame.type === "event") this.emit("event", frame.event, frame.payload);
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const item of [...this.#pending.values()]) item.finish(peerError("PEER_DISCONNECTED"));
    this.emit("close"); this.removeAllListeners();
  }
}
