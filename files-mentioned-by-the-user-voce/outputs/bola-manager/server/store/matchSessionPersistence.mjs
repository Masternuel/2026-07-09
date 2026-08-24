function clone(value) {
  return value == null ? null : structuredClone(value);
}

function normalizedCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function withoutUndefined(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => withoutUndefined(item) ?? null);
  }
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const cleaned = withoutUndefined(item);
    return cleaned === undefined ? [] : [[key, cleaned]];
  }));
}

export class MemoryMatchSessionPersistence {
  #sessions = new Map();

  constructor(initialSessions = []) {
    for (const session of initialSessions) {
      this.#sessions.set(normalizedCode(session.code), clone(withoutUndefined(session)));
    }
  }

  async get(code) {
    return clone(this.#sessions.get(normalizedCode(code)));
  }

  async has(code) {
    return this.#sessions.has(normalizedCode(code));
  }

  async save(session) {
    const stored = withoutUndefined(session);
    this.#sessions.set(normalizedCode(stored.code), clone(stored));
    return clone(stored);
  }

  async remove(code, matchId) {
    const key = normalizedCode(code);
    const current = this.#sessions.get(key);
    if (!current || (matchId && String(current.matchId) !== String(matchId))) return false;
    this.#sessions.delete(key);
    return true;
  }
}

export class FirestoreMatchSessionPersistence {
  #collection;
  #firestore;

  constructor(firestore, { collectionName = "activeMatches" } = {}) {
    if (!firestore) throw new Error("Firestore e obrigatorio para persistir partidas em andamento");
    this.#firestore = firestore;
    this.#collection = firestore.collection(collectionName);
  }

  async get(code) {
    const snapshot = await this.#collection.doc(normalizedCode(code)).get();
    return snapshot.exists ? clone(snapshot.data()) : null;
  }

  async has(code) {
    return Boolean(await this.get(code));
  }

  async save(session) {
    const stored = withoutUndefined(session);
    await this.#collection.doc(normalizedCode(stored.code)).set(clone(stored));
    return clone(stored);
  }

  async remove(code, matchId) {
    const reference = this.#collection.doc(normalizedCode(code));
    return this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return false;
      const current = snapshot.data();
      if (matchId && String(current?.matchId) !== String(matchId)) return false;
      transaction.delete(reference);
      return true;
    });
  }
}

export function createMatchSessionPersistence({ firestore, mode, nodeEnv, allowDemoAuth }) {
  if (mode === "memory") {
    if (nodeEnv === "production" || (!allowDemoAuth && nodeEnv !== "test")) {
      throw new Error("Partidas em memoria exigem ALLOW_DEMO_AUTH=true fora dos testes");
    }
    return new MemoryMatchSessionPersistence();
  }
  if (mode !== "firestore") throw new Error(`ROOM_STORE invalido: ${mode}`);
  return new FirestoreMatchSessionPersistence(firestore);
}
