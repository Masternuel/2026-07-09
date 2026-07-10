function clone(value) {
  return value == null ? null : structuredClone(value);
}

export class MemoryRoomPersistence {
  #rooms = new Map();

  constructor(initialRooms = []) {
    for (const room of initialRooms) this.#rooms.set(room.code, clone(room));
  }

  async create(room) {
    if (this.#rooms.has(room.code)) return false;
    this.#rooms.set(room.code, clone(room));
    return true;
  }

  async get(code) {
    return clone(this.#rooms.get(code));
  }

  async save(room) {
    this.#rooms.set(room.code, clone(room));
  }

  async mutate(code, mutation) {
    const current = clone(this.#rooms.get(code));
    const next = mutation(current);
    if (next === undefined) return current;
    this.#rooms.set(code, clone(next));
    return clone(next);
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
    return snapshot.exists ? clone(snapshot.data()) : null;
  }

  async save(room) {
    await this.#collection.doc(room.code).set(clone(room));
  }

  async mutate(code, mutation) {
    const reference = this.#collection.doc(code);
    return this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? clone(snapshot.data()) : null;
      const next = mutation(current);
      if (next === undefined) return current;
      transaction.set(reference, clone(next));
      return clone(next);
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
