import { withTimeout } from "../infrastructure/readiness.mjs";

const DEFAULT_OPERATION_TIMEOUT_MS = 15_000;

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

function normalizedSequence(value) {
  if (value == null) return 0;
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    const error = new Error("Sequencia da partida invalida");
    error.code = "MATCH_SEQUENCE_INVALID";
    error.status = 409;
    throw error;
  }
  return sequence;
}

function normalizedGeneration(value) {
  const generation = String(value ?? "").trim();
  return generation || null;
}

function retiredGenerations(value) {
  return [...new Set((Array.isArray(value?._matchRetiredGenerations)
    ? value._matchRetiredGenerations
    : []).map(normalizedGeneration).filter(Boolean))];
}

function staleSnapshotError(currentSequence, requestedSequence) {
  const error = new Error("Snapshot antigo da partida nao pode sobrescrever estado mais recente");
  error.code = "MATCH_SNAPSHOT_STALE";
  error.status = 409;
  error.details = { currentSequence, requestedSequence };
  return error;
}

function assertSaveSequence(current, requested) {
  const requestedSequence = normalizedSequence(requested._matchSequence);
  if (!current || String(current.matchId ?? "") !== String(requested.matchId ?? "")) return;
  const currentSequence = normalizedSequence(current._matchSequence);
  const currentGeneration = normalizedGeneration(current._matchGeneration);
  const requestedGeneration = normalizedGeneration(requested._matchGeneration);
  if (requestedGeneration && retiredGenerations(current).includes(requestedGeneration)) {
    throw staleSnapshotError(currentSequence, requestedSequence);
  }
  if (current._matchRemoved === true) {
    if (requestedGeneration && requestedGeneration !== currentGeneration) return;
    throw staleSnapshotError(currentSequence, requestedSequence);
  }
  if (currentGeneration && requestedGeneration !== currentGeneration) {
    throw staleSnapshotError(currentSequence, requestedSequence);
  }
  if (requestedSequence < currentSequence) {
    throw staleSnapshotError(currentSequence, requestedSequence);
  }
}

function persistenceTimeoutError(operation, cause) {
  const error = new Error(`Persistencia da partida excedeu o tempo limite (${operation})`);
  error.code = "MATCH_PERSISTENCE_TIMEOUT";
  error.status = 503;
  error.expose = true;
  error.cause = cause;
  return error;
}

async function boundedOperation(operation, timeoutMs, label) {
  try {
    return await withTimeout(
      Promise.resolve().then(operation),
      timeoutMs,
      `match-persistence:${label}`,
    );
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.code === "DEPENDENCY_TIMEOUT") {
      throw persistenceTimeoutError(label, error);
    }
    throw error;
  }
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

function ownedRecord(value, ownership, current = null) {
  const record = { ...value };
  delete record._matchRemoved;
  const retired = String(current?.matchId ?? "") === String(record.matchId ?? "")
    ? [...new Set([...retiredGenerations(current), ...retiredGenerations(record)])]
    : retiredGenerations(record);
  if (retired.length > 0) record._matchRetiredGenerations = retired;
  else delete record._matchRetiredGenerations;
  return ownership ? { ...record, _matchOwnership: ownership } : record;
}

function removedRecord(code, current, ownership) {
  const retired = [...new Set([
    ...retiredGenerations(current),
    normalizedGeneration(current?._matchGeneration),
  ].filter(Boolean))];
  return {
    code: normalizedCode(code),
    matchId: current?.matchId ?? null,
    _matchSequence: normalizedSequence(current?._matchSequence),
    ...(normalizedGeneration(current?._matchGeneration)
      ? { _matchGeneration: normalizedGeneration(current._matchGeneration) }
      : {}),
    ...(retired.length > 0 ? { _matchRetiredGenerations: retired } : {}),
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
    const current = this.#sessions.get(key);
    assertSaveOwnership(current, ownership);
    assertSaveSequence(current, session);
    const stored = ownedRecord(withoutUndefined(session), ownership, current);
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
  #operationTimeoutMs;

  constructor(firestore, {
    collectionName = "activeMatches",
    operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  } = {}) {
    if (!firestore) throw new Error("Firestore e obrigatorio para persistir partidas em andamento");
    this.#firestore = firestore;
    this.#collection = firestore.collection(collectionName);
    this.#operationTimeoutMs = Number.isInteger(Number(operationTimeoutMs))
      && Number(operationTimeoutMs) > 0
      ? Number(operationTimeoutMs)
      : DEFAULT_OPERATION_TIMEOUT_MS;
  }

  async get(code) {
    const snapshot = await boundedOperation(
      () => this.#collection.doc(normalizedCode(code)).get(),
      this.#operationTimeoutMs,
      "get",
    );
    return snapshot.exists ? clone(activeRecord(snapshot.data())) : null;
  }

  async has(code) {
    return Boolean(await this.get(code));
  }

  async save(session, ownershipValue) {
    const ownership = normalizedOwnership(ownershipValue);
    const cleaned = withoutUndefined(session);
    let stored;
    const reference = this.#collection.doc(normalizedCode(cleaned.code));
    await boundedOperation(
      () => this.#firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists ? snapshot.data() : null;
        assertSaveOwnership(current, ownership);
        assertSaveSequence(current, cleaned);
        stored = ownedRecord(cleaned, ownership, current);
        transaction.set(reference, clone(stored));
      }),
      this.#operationTimeoutMs,
      "save",
    );
    return clone(stored);
  }

  async remove(code, matchId, ownershipValue) {
    const ownership = normalizedOwnership(ownershipValue);
    const reference = this.#collection.doc(normalizedCode(code));
    return boundedOperation(
      () => this.#firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return false;
        const current = snapshot.data();
        if (current?._matchRemoved === true
          || (matchId && String(current?.matchId) !== String(matchId))) return false;
        assertOwnership(current, ownership);
        transaction.set(reference, removedRecord(code, current, ownership));
        return true;
      }),
      this.#operationTimeoutMs,
      "remove",
    );
  }
}

export function createMatchSessionPersistence({
  firestore,
  mode,
  nodeEnv,
  allowDemoAuth,
  operationTimeoutMs,
}) {
  if (mode === "memory") {
    if (nodeEnv === "production" || (!allowDemoAuth && nodeEnv !== "test")) {
      throw new Error("Partidas em memoria exigem ALLOW_DEMO_AUTH=true fora dos testes");
    }
    return new MemoryMatchSessionPersistence();
  }
  if (mode !== "firestore") throw new Error(`ROOM_STORE invalido: ${mode}`);
  return new FirestoreMatchSessionPersistence(firestore, { operationTimeoutMs });
}
