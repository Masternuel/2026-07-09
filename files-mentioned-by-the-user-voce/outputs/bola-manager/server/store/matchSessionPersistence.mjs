function clone(value) {
  return value == null ? null : structuredClone(value);
}

function normalizedCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizedOwnership(value) {
  if (!value) return null;
  const token = String(value.token ?? "").trim();
  const fence = Number(value.fence);
  if (!token || !Number.isSafeInteger(fence) || fence < 0) {
    const error = new Error("Ownership da partida invalido");
    error.code = "MATCH_OWNERSHIP_INVALID";
    throw error;
  }
  return { token, fence };
}

function ownershipError() {
  const error = new Error("Outra replica assumiu esta partida");
  error.code = "MATCH_OWNERSHIP_LOST";
  error.status = 409;
  return error;
}

function assertOwnership(current, requested) {
  const active = normalizedOwnership(current?._matchOwnership);
  if (!active) return;
  if (!requested || requested.fence < active.fence) throw ownershipError();
  if (requested.fence === active.fence && requested.token !== active.token) {
    throw ownershipError();
  }
}

function assertSaveOwnership(current, requested) {
  assertOwnership(current, requested);
  if (current?._matchRemoved === true) {
    const last = normalizedOwnership(current._matchOwnership);
    if (last && (!requested || requested.fence <= last.fence)) throw ownershipError();
  }
}

function ownedRecord(value, ownership) {
  const record = { ...value };
  delete record._matchRemoved;
  return ownership ? { ...record, _matchOwnership: ownership } : record;
}

function removedRecord(code, current, ownership) {
  return {
    code: normalizedCode(code),
    matchId: current?.matchId ?? null,
    _matchRemoved: true,
    ...(ownership ? { _matchOwnership: ownership } : {}),
  };
}

function activeRecord(value) {
  return value?._matchRemoved === true ? null : value;
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
    return clone(activeRecord(this.#sessions.get(normalizedCode(code))));
  }

  async has(code) {
    return Boolean(activeRecord(this.#sessions.get(normalizedCode(code))));
  }

  async save(session, ownershipValue) {
    const ownership = normalizedOwnership(ownershipValue);
    const key = normalizedCode(session.code);
    assertSaveOwnership(this.#sessions.get(key), ownership);
    const stored = ownedRecord(withoutUndefined(session), ownership);
    this.#sessions.set(key, clone(stored));
    return clone(stored);
  }

  async remove(code, matchId, ownershipValue) {
    const key = normalizedCode(code);
    const current = this.#sessions.get(key);
    if (!current || current._matchRemoved === true
      || (matchId && String(current.matchId) !== String(matchId))) return false;
    const ownership = normalizedOwnership(ownershipValue);
    assertOwnership(current, ownership);
    this.#sessions.set(key, removedRecord(key, current, ownership));
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
    return snapshot.exists ? clone(activeRecord(snapshot.data())) : null;
  }

  async has(code) {
    return Boolean(await this.get(code));
  }

  async save(session, ownershipValue) {
    const ownership = normalizedOwnership(ownershipValue);
    const stored = ownedRecord(withoutUndefined(session), ownership);
    const reference = this.#collection.doc(normalizedCode(stored.code));
    await this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      assertSaveOwnership(snapshot.exists ? snapshot.data() : null, ownership);
      transaction.set(reference, clone(stored));
    });
    return clone(stored);
  }

  async remove(code, matchId, ownershipValue) {
    const ownership = normalizedOwnership(ownershipValue);
    const reference = this.#collection.doc(normalizedCode(code));
    return this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return false;
      const current = snapshot.data();
      if (current?._matchRemoved === true
        || (matchId && String(current?.matchId) !== String(matchId))) return false;
      assertOwnership(current, ownership);
      transaction.set(reference, removedRecord(code, current, ownership));
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
