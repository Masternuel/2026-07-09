import { MemoryRoomPersistence } from "../server/store/roomPersistence.mjs";
import { MemoryMatchSessionPersistence } from "../server/store/matchSessionPersistence.mjs";
import { NewsStore } from "../server/store/newsStore.mjs";

// Reuse the engine's ownership, sequence, tombstone and idempotency rules.
// A fresh adapter per operation cannot expose uncommitted data after disk failure.
export function createFileStores(database) {
  // Rooms are built over the committed (frozen) section without copying it: the adapter copies
  // what it reads or changes, and a write replaces the section with a new object that reuses
  // the untouched rooms and archive records. Copying the whole section (every room plus the
  // growing match archive) several times per save made each match slower than the last.
  const rooms = (section) => new MemoryRoomPersistence(section.rooms, { ...section, shared: true });
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
    for (const method of writeMethods) result[method] = (...args) => database.transaction(async (state, context) => {
      const store = construct(state, context);
      const value = await store[method](...args);
      save(state, store, context);
      return value;
    });
    return result;
  }
  // Writes read the rooms section through peek so the draft does not deep-copy it first.
  const roomsFor = (state, context) => rooms(context ? context.peek("rooms") : state.rooms);
  const persistence = adapter(roomsFor,
    ["findCreation", "get", "getPartial", "getPaths", "getSectionTail", "listByManager", "listMetadataByManager", "getMetadata", "getDeletionMetadata", "getSection"],
    ["create", "save", "mutate", "mutatePaths", "remove"],
    (state, store) => { state.rooms = store.exportState(); });
  const saveHistory = (state, store, context) => { state.rooms = { ...context.peek("rooms"), history: store.exportState() }; };
  persistence.matchHistory = adapter((state, context) => roomsFor(state, context).matchHistory,
    ["list", "get"], ["put"], saveHistory);
  // One save for a whole archive batch instead of one per match. Records are stored in order
  // until one fails; the stored ones are committed and reported on the error, exactly as the
  // record-by-record path acknowledges them before stopping (flushMatchHistory).
  persistence.matchHistory.putBatch = async (room, records) => {
    let failure = null;
    const stored = await database.transaction(async (state, context) => {
      const store = roomsFor(state, context).matchHistory;
      const kept = [];
      for (const record of records) {
        try { await store.put(room, record); } catch (error) { failure = error; break; }
        kept.push(record);
      }
      if (kept.length) saveHistory(state, store, context);
      return kept;
    });
    if (failure) throw Object.assign(failure, { acknowledged: stored });
    return stored;
  };
  // Every save rewrites the whole file, so archive a round's matches in one save instead of
  // one per 25 (the pending queue holds at most 512 records with details).
  persistence.matchHistory.batchSize = 512;
  const matchSessionStore = adapter(matches, ["get", "has"], ["save", "remove"],
    (state, store) => { state.matches = store.exportState(); });
  const newsStore = adapter(news, ["list", "get", "getOperationResult"],
    ["create", "createEditorial", "syncEditorials", "ensureEditorials", "appendComments", "replaceGeneratedComments", "createManagerPostWithOperation", "appendCommentsWithOperation"],
    (state, store) => { state.news = { posts: [...store.memory], operations: [...store.operations] }; });
  newsStore.source = "local-disk";
  return { persistence, matchSessionStore, newsStore };
}
