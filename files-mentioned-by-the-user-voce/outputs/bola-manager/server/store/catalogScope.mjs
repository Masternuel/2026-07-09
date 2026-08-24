const CATALOG_DATABASE_COLLECTION = "catalogDatabases";

function normalizedOwnerId(value) {
  const ownerId = String(value ?? "").trim();
  if (!ownerId || ownerId.length > 128 || ownerId.includes("/")) {
    const error = new Error("Proprietario da base de dados invalido");
    error.code = "CATALOG_OWNER_INVALID";
    error.status = 400;
    throw error;
  }
  return ownerId;
}

export function catalogDatabaseDocument(firestore, ownerIdValue) {
  const ownerId = normalizedOwnerId(ownerIdValue);
  return firestore.collection(CATALOG_DATABASE_COLLECTION).doc(ownerId);
}

export function catalogCollectionPath(ownerIdValue, collectionNameValue) {
  const ownerId = normalizedOwnerId(ownerIdValue);
  const collectionName = String(collectionNameValue ?? "").trim();
  if (!collectionName || collectionName.includes("/")) {
    throw new Error("Colecao da base de dados invalida");
  }
  return `${CATALOG_DATABASE_COLLECTION}/${ownerId}/${collectionName}`;
}

export function createScopedCatalogFirestore(firestore, ownerIdValue) {
  if (!firestore) return null;
  const ownerId = normalizedOwnerId(ownerIdValue);
  const proxy = {
    collection(collectionName) {
      return firestore.collection(catalogCollectionPath(ownerId, collectionName));
    },
    runTransaction(operation, ...options) {
      return firestore.runTransaction(operation, ...options);
    },
  };
  if (typeof firestore.getAll === "function") {
    proxy.getAll = (...references) => firestore.getAll(...references);
  }
  if (typeof firestore.batch === "function") {
    proxy.batch = () => firestore.batch();
  }
  return proxy;
}

export async function catalogForOwner(catalogStore, ownerId) {
  if (!ownerId) return catalogStore;
  const scoped = typeof catalogStore?.forOwner === "function"
    ? catalogStore.forOwner(ownerId)
    : catalogStore;
  await scoped?.ensureInitialized?.();
  return scoped;
}

export async function catalogForRequest(catalogStore, roomStore, request) {
  let ownerId = request.user?.uid;
  const roomCode = String(request.query?.roomCode ?? "").trim().toUpperCase();
  if (roomCode) {
    if (!roomStore || typeof roomStore.requireMembership !== "function") {
      const error = new Error("Base da sala indisponivel");
      error.code = "ROOM_CATALOG_UNAVAILABLE";
      error.status = 503;
      throw error;
    }
    const room = await roomStore.requireMembership(roomCode, request.user?.uid);
    ownerId = room.catalogOwnerId || room.ownerId;
  }
  if (!ownerId) return catalogStore;
  return catalogForOwner(catalogStore, ownerId);
}

export function catalogOwnerId(value) {
  return normalizedOwnerId(value);
}
