import { MemoryRoomPersistence } from "../server/store/roomPersistence.mjs";
import { MemoryMatchSessionPersistence } from "../server/store/matchSessionPersistence.mjs";
import { NewsStore } from "../server/store/newsStore.mjs";

// Reuse the engine's ownership, sequence, tombstone and idempotency rules.
// A fresh adapter per operation cannot expose uncommitted data after disk failure.
export function createFileStores(database) {
  const rooms = (state) => new MemoryRoomPersistence(state.rooms.rooms, state.rooms);
  const matches = (state) => new MemoryMatchSessionPersistence(state.matches);
  const news = (state) => {
    const store = new NewsStore();
    store.memory = new Map(state.news.posts);
    store.operations = new Map(state.news.operations);
    return store;
  };
  function adapter(construct, readMethods, writeMethods, save) {
    const result = {};
    for (const method of readMethods) result[method] = (...args) => database.read((state) => construct(state)[method](...args));
    for (const method of writeMethods) result[method] = (...args) => database.transaction(async (state) => {
      const store = construct(state);
      const value = await store[method](...args);
      save(state, store);
      return value;
    });
    return result;
  }
  const persistence = adapter(rooms,
    ["findCreation", "get", "getPartial", "getPaths", "getSectionTail", "listByManager", "listMetadataByManager", "getMetadata", "getDeletionMetadata", "getSection"],
    ["create", "save", "mutate", "mutatePaths", "remove"],
    (state, store) => { state.rooms = store.exportState(); });
  persistence.matchHistory = adapter((state) => rooms(state).matchHistory,
    ["list", "get"], ["put"], (state, store) => { state.rooms.history = store.exportState(); });
  const matchSessionStore = adapter(matches, ["get", "has"], ["save", "remove"],
    (state, store) => { state.matches = store.exportState(); });
  const newsStore = adapter(news, ["list", "get", "getOperationResult"],
    ["create", "createEditorial", "syncEditorials", "ensureEditorials", "appendComments", "replaceGeneratedComments", "createManagerPostWithOperation", "appendCommentsWithOperation"],
    (state, store) => { state.news = { posts: [...store.memory], operations: [...store.operations] }; });
  newsStore.source = "local-disk";
  return { persistence, matchSessionStore, newsStore };
}
