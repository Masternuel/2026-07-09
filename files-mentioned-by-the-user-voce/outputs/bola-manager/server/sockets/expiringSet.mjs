// Set-compatible guard whose entries expire, so per-replica tombstones cannot grow
// without bound (audit S-08). The durable deletion lives in the room store; this only
// short-circuits events for rooms deleted recently on this replica.
export class ExpiringSet {
  #entries = new Map();
  #ttlMs;
  #maxSize;
  #now;

  constructor({ ttlMs = 60 * 60_000, maxSize = 10_000, now = Date.now } = {}) {
    if (!(ttlMs > 0) || !(maxSize > 0)) throw new Error("ExpiringSet requer ttlMs e maxSize positivos");
    this.#ttlMs = ttlMs;
    this.#maxSize = maxSize;
    this.#now = now;
  }

  get size() { this.#prune(); return this.#entries.size; }

  add(value) {
    this.#entries.delete(value);
    this.#entries.set(value, this.#now() + this.#ttlMs);
    this.#prune();
    while (this.#entries.size > this.#maxSize) this.#entries.delete(this.#entries.keys().next().value);
    return this;
  }

  has(value) {
    const expiresAt = this.#entries.get(value);
    if (expiresAt === undefined) return false;
    if (expiresAt > this.#now()) return true;
    this.#entries.delete(value);
    return false;
  }

  delete(value) { return this.#entries.delete(value); }
  clear() { this.#entries.clear(); }

  // Insertion order equals expiry order (fixed TTL, re-add moves to the end).
  #prune() {
    const now = this.#now();
    for (const [value, expiresAt] of this.#entries) {
      if (expiresAt > now) break;
      this.#entries.delete(value);
    }
  }
}
