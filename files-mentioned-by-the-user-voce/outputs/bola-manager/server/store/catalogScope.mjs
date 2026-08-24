const CATALOG_DATABASE_COLLECTION = "catalogDatabases";
const CATALOG_GENERATIONS_COLLECTION = "generations";
const GLOBAL_CATALOG_GENERATIONS_COLLECTION = "brasfootCatalogGenerations";

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

function normalizedCollectionName(value) {
  const collectionName = String(value ?? "").trim();
  if (!collectionName || collectionName.includes("/")) {
    throw new Error("Colecao da base de dados invalida");
  }
  return collectionName;
}

function normalizedGenerationId(value) {
  const generationId = String(value ?? "").trim();
  if (!generationId || generationId.length > 128 || generationId.includes("/")) {
    throw new Error("Geracao da base de dados invalida");
  }
  return generationId;
}

export function catalogCollectionPath(ownerIdValue, collectionNameValue, generationIdValue = null) {
  const ownerId = normalizedOwnerId(ownerIdValue);
  const collectionName = normalizedCollectionName(collectionNameValue);
  if (generationIdValue !== null && generationIdValue !== undefined) {
    const generationId = normalizedGenerationId(generationIdValue);
    return `${CATALOG_DATABASE_COLLECTION}/${ownerId}/${CATALOG_GENERATIONS_COLLECTION}/${generationId}/${collectionName}`;
  }
  return `${CATALOG_DATABASE_COLLECTION}/${ownerId}/${collectionName}`;
}

export function createScopedCatalogFirestore(firestore, ownerIdValue, generationIdValue = null) {
  if (!firestore) return null;
  const ownerId = normalizedOwnerId(ownerIdValue);
  const generationId = generationIdValue === null || generationIdValue === undefined
    ? null
    : normalizedGenerationId(generationIdValue);
  const proxy = {
    collection(collectionName) {
      return firestore.collection(catalogCollectionPath(ownerId, collectionName, generationId));
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

export function createGlobalCatalogGenerationFirestore(firestore, generationIdValue) {
  if (!firestore) return null;
  const generationId = normalizedGenerationId(generationIdValue);
  const proxy = {
    collection(collectionNameValue) {
      const collectionName = normalizedCollectionName(collectionNameValue);
      return firestore.collection(
        `${GLOBAL_CATALOG_GENERATIONS_COLLECTION}/${generationId}/${collectionName}`,
      );
    },
    runTransaction(operation, ...options) {
      return firestore.runTransaction(operation, ...options);
    },
  };
  if (typeof firestore.getAll === "function") {
    proxy.getAll = (...references) => firestore.getAll(...references);
  }
  if (typeof firestore.batch === "function") proxy.batch = () => firestore.batch();
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
