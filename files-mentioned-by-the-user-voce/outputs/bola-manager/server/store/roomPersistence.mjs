function clone(value) {
  return value == null ? null : structuredClone(value);
}

function isDeletedRoom(value) {
  return Boolean(value?.deleted === true);
}

function deletedRoom(code) {
  return { code, deleted: true };
}

function reservedCodeError(code) {
  const error = new Error(`Codigo de sala reservado: ${code}`);
  error.code = "ROOM_CODE_RESERVED";
  return error;
}

export class MemoryRoomPersistence {
  #rooms = new Map();
  #deletedCodes = new Set();

  constructor(initialRooms = []) {
    for (const room of initialRooms) {
      if (isDeletedRoom(room)) this.#deletedCodes.add(room.code);
      else this.#rooms.set(room.code, clone(room));
    }
  }

  async create(room) {
    if (this.#rooms.has(room.code) || this.#deletedCodes.has(room.code)) return false;
    this.#rooms.set(room.code, clone(room));
    return true;
  }

  async get(code) {
    return clone(this.#rooms.get(code));
  }

  async save(room) {
    if (this.#deletedCodes.has(room.code)) throw reservedCodeError(room.code);
    this.#rooms.set(room.code, clone(room));
  }

  async mutate(code, mutation) {
    const reserved = this.#deletedCodes.has(code);
    const current = reserved ? null : clone(this.#rooms.get(code));
    const next = mutation(current);
    if (next === undefined) return current;
    if (reserved) throw reservedCodeError(code);
    this.#rooms.set(code, clone(next));
    return clone(next);
  }

  async remove(code, authorize) {
    const current = clone(this.#rooms.get(code));
    authorize(current);
    this.#rooms.delete(code);
    this.#deletedCodes.add(code);
    return clone(current);
  }

  async listByManager(managerId) {
    return [...this.#rooms.values()]
      .filter((room) => room.managerIds.includes(managerId))
      .map(clone);
  }
}

function isAlreadyExists(error) {
  return error?.code === 6
    || error?.code === "already-exists"
    || error?.code === "ALREADY_EXISTS";
}

export class FirestoreRoomPersistence {
  #collection;
  #firestore;

  constructor(firestore, { collectionName = "rooms" } = {}) {
    if (!firestore) throw new Error("Firestore e obrigatorio");
    this.#firestore = firestore;
    this.#collection = firestore.collection(collectionName);
  }

  async create(room) {
    try {
      await this.#collection.doc(room.code).create(clone(room));
      return true;
    } catch (error) {
      if (isAlreadyExists(error)) return false;
      throw error;
    }
  }

  async get(code) {
    const snapshot = await this.#collection.doc(code).get();
    const current = snapshot.exists ? snapshot.data() : null;
    return current && !isDeletedRoom(current) ? clone(current) : null;
  }

  async save(room) {
    const reference = this.#collection.doc(room.code);
    await this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists && isDeletedRoom(snapshot.data())) throw reservedCodeError(room.code);
      transaction.set(reference, clone(room));
    });
  }

  async mutate(code, mutation) {
    const reference = this.#collection.doc(code);
    return this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const stored = snapshot.exists ? snapshot.data() : null;
      const reserved = isDeletedRoom(stored);
      const current = stored && !reserved ? clone(stored) : null;
      const next = mutation(current);
      if (next === undefined) return current;
      if (reserved) throw reservedCodeError(code);
      transaction.set(reference, clone(next));
      return clone(next);
    });
  }

  async remove(code, authorize) {
    const reference = this.#collection.doc(code);
    return this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const stored = snapshot.exists ? snapshot.data() : null;
      const current = stored && !isDeletedRoom(stored) ? clone(stored) : null;
      authorize(current);
      transaction.set(reference, deletedRoom(code));
      return clone(current);
    });
  }

  async listByManager(managerId) {
    const snapshot = await this.#collection.where("managerIds", "array-contains", managerId).get();
    return snapshot.docs.map((document) => clone(document.data()));
  }
}

export function createRoomPersistence({ firestore, mode, nodeEnv, allowDemoAuth }) {
  if (mode === "memory") {
    if (nodeEnv === "production" || (!allowDemoAuth && nodeEnv !== "test")) {
      throw new Error("RoomStore em memoria exige ALLOW_DEMO_AUTH=true fora dos testes");
    }
    return new MemoryRoomPersistence();
  }
  if (mode !== "firestore") throw new Error(`ROOM_STORE invalido: ${mode}`);
  if (!firestore) {
    throw new Error("Firestore nao configurado; use ALLOW_DEMO_AUTH=true para o modo local explicito");
  }
  return new FirestoreRoomPersistence(firestore);
}
