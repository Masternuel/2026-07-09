const DEFAULT_TRANSACTION_ATTEMPTS = 5;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizedPath(value) {
  const path = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!path || path.split("/").some((segment) => !segment)) {
    throw new Error(`Caminho Firestore invalido: ${value}`);
  }
  return path;
}

function lastSegment(path) {
  return normalizedPath(path).split("/").at(-1);
}

function parentPath(path) {
  const segments = normalizedPath(path).split("/");
  segments.pop();
  return segments.join("/");
}

function fieldValue(record, fieldPath) {
  return String(fieldPath ?? "")
    .split(".")
    .filter(Boolean)
    .reduce((value, segment) => value?.[segment], record);
}

function setFieldValue(record, fieldPath, value) {
  const segments = String(fieldPath ?? "").split(".").filter(Boolean);
  if (segments.length === 0) throw new Error("Campo Firestore invalido");
  let target = record;
  for (const segment of segments.slice(0, -1)) {
    if (!target[segment] || typeof target[segment] !== "object" || Array.isArray(target[segment])) {
      target[segment] = {};
    }
    target = target[segment];
  }
  target[segments.at(-1)] = clone(value);
}

function mergedData(current, data, options) {
  if (!options?.merge && !Array.isArray(options?.mergeFields)) return clone(data);
  const next = current && typeof current === "object" ? clone(current) : {};
  if (Array.isArray(options?.mergeFields)) {
    for (const field of options.mergeFields) {
      setFieldValue(next, field, fieldValue(data, field));
    }
    return next;
  }
  return { ...next, ...clone(data) };
}

function firestoreError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function failureError(value, fallback, context) {
  const candidate = typeof value === "function" ? value(context) : value;
  if (candidate instanceof Error) return candidate;
  return new Error(typeof candidate === "string" ? candidate : fallback);
}

function matchesFilter(record, { field, operator, value }) {
  const candidate = fieldValue(record, field);
  switch (operator) {
    case "==": return candidate === value;
    case "!=": return candidate !== value;
    case "<": return candidate < value;
    case "<=": return candidate <= value;
    case ">": return candidate > value;
    case ">=": return candidate >= value;
    case "in": return Array.isArray(value) && value.includes(candidate);
    case "not-in": return Array.isArray(value) && !value.includes(candidate);
    case "array-contains": return Array.isArray(candidate) && candidate.includes(value);
    case "array-contains-any": return Array.isArray(candidate)
      && Array.isArray(value)
      && value.some((item) => candidate.includes(item));
    default: throw new Error(`Operador Firestore nao suportado pelo fake: ${operator}`);
  }
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  return left < right ? -1 : 1;
}

function blankMetrics() {
  return {
    reads: 0,
    documentReads: 0,
    queryReads: 0,
    writes: 0,
    writeAttempts: 0,
    sets: 0,
    creates: 0,
    updates: 0,
    deletes: 0,
    transactions: 0,
    transactionAttempts: 0,
    transactionRetries: 0,
    batches: 0,
    commitAttempts: 0,
    commits: 0,
    rollbacks: 0,
    failedCommits: 0,
    readPaths: [],
    attemptedWritePaths: [],
    writePaths: [],
    commitKinds: [],
  };
}

/**
 * Fake pequeno do Firestore Admin para testes de persistencia.
 *
 * Falhas sao consumidas uma vez:
 *   firestore.failBeforeCommit(error)
 *   firestore.failAfterCommit(error, "transaction") // commit aplicado, ACK falha
 *   firestore.failOnWrite(2, error)       // segunda escrita do proximo commit
 *   firestore.failOnGlobalWrite(5, error) // quinta tentativa a partir de agora
 */
export function createFakeFirestore({ initialDocuments } = {}) {
  let documents = new Map();
  let documentVersions = new Map();
  let collectionVersions = new Map();
  let autoId = 0;
  const metrics = blankMetrics();
  const failures = {
    beforeCommit: null,
    afterCommit: null,
    afterCommitKind: null,
    writeAt: null,
    globalWriteAt: null,
    writeError: null,
  };

  function bumpVersion(path, versions, collections) {
    versions.set(path, (versions.get(path) ?? 0) + 1);
    const collectionPath = parentPath(path);
    collections.set(collectionPath, (collections.get(collectionPath) ?? 0) + 1);
  }

  function seedDocument(pathValue, data) {
    const path = normalizedPath(pathValue);
    documents.set(path, clone(data));
    bumpVersion(path, documentVersions, collectionVersions);
  }

  function snapshotFor(reference, source = documents) {
    const exists = source.has(reference.path);
    const value = exists ? source.get(reference.path) : undefined;
    return {
      id: reference.id,
      ref: reference,
      exists,
      data: () => (exists ? clone(value) : undefined),
      get: (path) => (exists ? clone(fieldValue(value, path)) : undefined),
    };
  }

  function recordDocumentRead(path) {
    metrics.reads += 1;
    metrics.documentReads += 1;
    metrics.readPaths.push(path);
  }

  function queryEntries(collectionPath, source) {
    const expectedSegments = collectionPath.split("/").length + 1;
    return [...source.entries()].filter(([path]) => (
      parentPath(path) === collectionPath && path.split("/").length === expectedSegments
    ));
  }

  function executeQuery(query, source = documents, { track = true } = {}) {
    let entries = queryEntries(query.path, source)
      .filter(([, record]) => query._state.filters.every((filter) => matchesFilter(record, filter)));

    const orderings = query._state.orderings;
    entries.sort(([leftPath, left], [rightPath, right]) => {
      for (const ordering of orderings) {
        const comparison = compareValues(
          fieldValue(left, ordering.field),
          fieldValue(right, ordering.field),
        );
        if (comparison !== 0) return ordering.direction === "desc" ? -comparison : comparison;
      }
      return lastSegment(leftPath).localeCompare(lastSegment(rightPath));
    });

    const cursor = query._state.startAfter;
    if (cursor) {
      if (cursor.kind === "snapshot") {
        const cursorIndex = entries.findIndex(([path]) => path === cursor.path);
        entries = cursorIndex >= 0 ? entries.slice(cursorIndex + 1) : entries;
      } else if (orderings.length > 0) {
        entries = entries.filter(([, record]) => {
          for (let index = 0; index < orderings.length; index += 1) {
            const comparison = compareValues(
              fieldValue(record, orderings[index].field),
              cursor.values[index],
            );
            if (comparison !== 0) {
              return orderings[index].direction === "desc" ? comparison < 0 : comparison > 0;
            }
          }
          return false;
        });
      }
    }

    entries = entries.slice(0, query._state.maximum);
    const snapshots = entries.map(([path]) => snapshotFor(documentReference(path), source));
    if (track) {
      metrics.queryReads += 1;
      metrics.reads += snapshots.length;
      metrics.documentReads += snapshots.length;
      metrics.readPaths.push(...snapshots.map((snapshot) => snapshot.ref.path));
    }
    return {
      docs: snapshots,
      empty: snapshots.length === 0,
      size: snapshots.length,
      forEach(callback, thisArg) {
        snapshots.forEach(callback, thisArg);
      },
    };
  }

  function queryReference(pathValue, state = {}) {
    const path = normalizedPath(pathValue);
    const normalizedState = {
      filters: state.filters ?? [],
      orderings: state.orderings ?? [],
      maximum: state.maximum ?? Infinity,
      startAfter: state.startAfter ?? null,
    };
    const query = {
      _fakeFirestoreKind: "query",
      _state: normalizedState,
      path,
      id: lastSegment(path),
      where(field, operator, value) {
        return queryReference(path, {
          ...normalizedState,
          filters: [...normalizedState.filters, { field, operator, value: clone(value) }],
        });
      },
      orderBy(field, direction = "asc") {
        if (!["asc", "desc"].includes(direction)) throw new Error(`Ordenacao invalida: ${direction}`);
        return queryReference(path, {
          ...normalizedState,
          orderings: [...normalizedState.orderings, { field, direction }],
        });
      },
      limit(value) {
        const maximum = Number(value);
        if (!Number.isInteger(maximum) || maximum < 0) throw new Error("Limite Firestore invalido");
        return queryReference(path, { ...normalizedState, maximum });
      },
      startAfter(...values) {
        const first = values[0];
        const cursor = first?._fakeFirestoreKind === "document-snapshot" || first?.ref?.path
          ? { kind: "snapshot", path: first.ref.path }
          : { kind: "values", values: clone(values) };
        return queryReference(path, { ...normalizedState, startAfter: cursor });
      },
      async get() {
        return executeQuery(query);
      },
      count() {
        return {
          async get() {
            const result = executeQuery(query);
            return { data: () => ({ count: result.size }) };
          },
        };
      },
    };
    return query;
  }

  function collectionReference(pathValue) {
    const path = normalizedPath(pathValue);
    return {
      ...queryReference(path),
      _fakeFirestoreKind: "collection",
      path,
      id: lastSegment(path),
      parent: path.split("/").length > 1 ? documentReference(parentPath(path)) : null,
      doc(idValue) {
        const id = idValue == null ? `auto-${String(++autoId).padStart(12, "0")}` : String(idValue);
        if (!id || id.includes("/")) throw new Error(`ID Firestore invalido: ${idValue}`);
        return documentReference(`${path}/${id}`);
      },
      async add(data) {
        const reference = this.doc();
        await reference.create(data);
        return reference;
      },
    };
  }

  function writeResult() {
    return { writeTime: new Date() };
  }

  function documentReference(pathValue) {
    const path = normalizedPath(pathValue);
    const reference = {
      _fakeFirestoreKind: "document",
      path,
      id: lastSegment(path),
      get parent() {
        return collectionReference(parentPath(path));
      },
      collection(name) {
        const collectionName = String(name ?? "").trim();
        if (!collectionName || collectionName.includes("/")) {
          throw new Error(`Subcolecao Firestore invalida: ${name}`);
        }
        return collectionReference(`${path}/${collectionName}`);
      },
      async get() {
        recordDocumentRead(path);
        return snapshotFor(reference);
      },
      async create(data) {
        commitWrites([{ type: "create", reference, data: clone(data) }], "direct");
        return writeResult();
      },
      async set(data, options) {
        commitWrites([{ type: "set", reference, data: clone(data), options: clone(options) }], "direct");
        return writeResult();
      },
      async update(data) {
        commitWrites([{ type: "update", reference, data: clone(data) }], "direct");
        return writeResult();
      },
      async delete() {
        commitWrites([{ type: "delete", reference }], "direct");
        return writeResult();
      },
    };
    return reference;
  }

  function beforeCommitFailure(context) {
    if (!failures.beforeCommit) return;
    const failure = failures.beforeCommit;
    failures.beforeCommit = null;
    throw failureError(failure, "Falha simulada antes do commit", context);
  }

  function writeFailure(write, index, kind) {
    metrics.writeAttempts += 1;
    metrics.attemptedWritePaths.push(write.reference.path);
    const context = {
      kind,
      index,
      globalIndex: metrics.writeAttempts,
      path: write.reference.path,
      type: write.type,
    };
    const localIndex = failures.writeAt && typeof failures.writeAt === "object"
      ? Number(failures.writeAt.index)
      : Number(failures.writeAt);
    const localMatches = Number.isInteger(localIndex) && localIndex === index;
    const globalMatches = Number.isInteger(Number(failures.globalWriteAt))
      && Number(failures.globalWriteAt) === metrics.writeAttempts;
    if (!localMatches && !globalMatches) return;
    failures.writeAt = null;
    failures.globalWriteAt = null;
    throw failureError(failures.writeError, "Falha simulada durante escrita", context);
  }

  function hasConflict(readVersions, readCollections) {
    return [...readVersions].some(([path, version]) => (documentVersions.get(path) ?? 0) !== version)
      || [...readCollections].some(
        ([path, version]) => (collectionVersions.get(path) ?? 0) !== version,
      );
  }

  function commitWrites(writes, kind, { readVersions = new Map(), readCollections = new Map() } = {}) {
    if (hasConflict(readVersions, readCollections)) {
      const error = firestoreError("Conflito simulado na transacao", 10);
      error.retryableTransactionConflict = true;
      throw error;
    }

    metrics.commitAttempts += 1;
    try {
      beforeCommitFailure({ kind, writes: writes.map((write) => write.reference.path) });
      for (let index = 0; index < writes.length; index += 1) {
        writeFailure(writes[index], index + 1, kind);
      }
      // A injecao por posicao pertence apenas ao proximo commit.
      failures.writeAt = null;

      const nextDocuments = new Map(documents);
      const nextDocumentVersions = new Map(documentVersions);
      const nextCollectionVersions = new Map(collectionVersions);
      for (const write of writes) {
        const path = write.reference.path;
        if (write.type === "create") {
          if (nextDocuments.has(path)) throw firestoreError(`Documento ja existe: ${path}`, 6);
          nextDocuments.set(path, clone(write.data));
        } else if (write.type === "set") {
          nextDocuments.set(path, mergedData(nextDocuments.get(path), write.data, write.options));
        } else if (write.type === "update") {
          if (!nextDocuments.has(path)) throw firestoreError(`Documento nao existe: ${path}`, 5);
          const updated = clone(nextDocuments.get(path));
          for (const [field, value] of Object.entries(write.data ?? {})) {
            setFieldValue(updated, field, value);
          }
          nextDocuments.set(path, updated);
        } else if (write.type === "delete") {
          nextDocuments.delete(path);
        } else {
          throw new Error(`Escrita Firestore desconhecida: ${write.type}`);
        }
        bumpVersion(path, nextDocumentVersions, nextCollectionVersions);
      }

      documents = nextDocuments;
      documentVersions = nextDocumentVersions;
      collectionVersions = nextCollectionVersions;
      metrics.commits += 1;
      metrics.writes += writes.length;
      metrics.commitKinds.push(kind);
      for (const write of writes) {
        metrics.writePaths.push(write.reference.path);
        if (write.type === "set") metrics.sets += 1;
        else if (write.type === "create") metrics.creates += 1;
        else if (write.type === "update") metrics.updates += 1;
        else if (write.type === "delete") metrics.deletes += 1;
      }
      if (failures.afterCommit
        && (!failures.afterCommitKind || failures.afterCommitKind === kind)) {
        const failure = failures.afterCommit;
        failures.afterCommit = null;
        failures.afterCommitKind = null;
        const error = failureError(failure, "Falha simulada depois do commit", {
          kind,
          writes: writes.map((write) => write.reference.path),
          commitApplied: true,
        });
        error.commitApplied = true;
        throw error;
      }
      return writes.map(writeResult);
    } catch (error) {
      metrics.failedCommits += 1;
      if (!error?.commitApplied) metrics.rollbacks += 1;
      throw error;
    }
  }

  function stagedWriter(writes, markWrite, returnValue) {
    const writer = {
      create(reference, data) {
        markWrite?.();
        writes.push({ type: "create", reference, data: clone(data) });
        return returnValue?.() ?? writer;
      },
      set(reference, data, options) {
        markWrite?.();
        writes.push({ type: "set", reference, data: clone(data), options: clone(options) });
        return returnValue?.() ?? writer;
      },
      update(reference, data) {
        markWrite?.();
        writes.push({ type: "update", reference, data: clone(data) });
        return returnValue?.() ?? writer;
      },
      delete(reference) {
        markWrite?.();
        writes.push({ type: "delete", reference });
        return returnValue?.() ?? writer;
      },
    };
    return writer;
  }

  function batch() {
    metrics.batches += 1;
    const writes = [];
    let committed = false;
    let batchReference;
    const writer = stagedWriter(writes, null, () => batchReference);
    batchReference = {
      ...writer,
      async commit() {
        if (committed) throw new Error("Batch Firestore ja confirmado");
        committed = true;
        return commitWrites(writes, "batch");
      },
    };
    return batchReference;
  }

  async function getAll(...references) {
    return references.map((reference) => {
      recordDocumentRead(reference.path);
      return snapshotFor(reference);
    });
  }

  async function runTransaction(operation, options = {}) {
    metrics.transactions += 1;
    const maxAttempts = Number.isInteger(options.maxAttempts)
      ? options.maxAttempts
      : DEFAULT_TRANSACTION_ATTEMPTS;
    let lastConflict;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      metrics.transactionAttempts += 1;
      const sourceDocuments = new Map(
        [...documents].map(([path, data]) => [path, clone(data)]),
      );
      const sourceDocumentVersions = new Map(documentVersions);
      const sourceCollectionVersions = new Map(collectionVersions);
      const readVersions = new Map();
      const readCollections = new Map();
      const writes = [];
      let startedWriting = false;
      const assertCanRead = () => {
        if (startedWriting) throw new Error("Leituras devem ocorrer antes das escritas na transacao");
      };
      const markWrite = () => { startedWriting = true; };
      let transaction;
      const writer = stagedWriter(writes, markWrite, () => transaction);
      transaction = {
        ...writer,
        async get(target) {
          assertCanRead();
          if (target?._fakeFirestoreKind === "query" || target?._fakeFirestoreKind === "collection") {
            readCollections.set(target.path, sourceCollectionVersions.get(target.path) ?? 0);
            return executeQuery(target, sourceDocuments);
          }
          readVersions.set(target.path, sourceDocumentVersions.get(target.path) ?? 0);
          recordDocumentRead(target.path);
          return snapshotFor(target, sourceDocuments);
        },
        async getAll(...references) {
          assertCanRead();
          return references.map((reference) => {
            readVersions.set(reference.path, sourceDocumentVersions.get(reference.path) ?? 0);
            recordDocumentRead(reference.path);
            return snapshotFor(reference, sourceDocuments);
          });
        },
      };

      let result;
      try {
        result = await operation(transaction);
      } catch (error) {
        metrics.rollbacks += 1;
        throw error;
      }
      if (writes.length === 0) return result;

      try {
        commitWrites(writes, "transaction", { readVersions, readCollections });
        return result;
      } catch (error) {
        if (!error?.retryableTransactionConflict || attempt >= maxAttempts) throw error;
        lastConflict = error;
        metrics.transactionRetries += 1;
      }
    }
    throw lastConflict ?? firestoreError("Transacao Firestore abortada", 10);
  }

  function seed(pathOrCollection, idOrData, maybeData) {
    const hasSeparateId = arguments.length >= 3;
    const path = hasSeparateId
      ? `${normalizedPath(pathOrCollection)}/${String(idOrData)}`
      : normalizedPath(pathOrCollection);
    seedDocument(path, hasSeparateId ? maybeData : idOrData);
  }

  function read(pathOrCollection, maybeId) {
    const path = maybeId === undefined
      ? normalizedPath(pathOrCollection)
      : `${normalizedPath(pathOrCollection)}/${String(maybeId)}`;
    return documents.has(path) ? clone(documents.get(path)) : undefined;
  }

  function dump(prefixValue) {
    const prefix = prefixValue == null ? "" : `${normalizedPath(prefixValue)}/`;
    return new Map([...documents]
      .filter(([path]) => !prefix || path.startsWith(prefix))
      .map(([path, data]) => [path, clone(data)]));
  }

  function resetMetrics() {
    const next = blankMetrics();
    for (const key of Object.keys(metrics)) {
      metrics[key] = Array.isArray(next[key]) ? [] : next[key];
    }
  }

  const firestore = {
    metrics,
    failures,
    collection: collectionReference,
    doc: documentReference,
    getAll,
    batch,
    runTransaction,
    seed,
    read,
    dump,
    has(path) {
      return documents.has(normalizedPath(path));
    },
    paths() {
      return [...documents.keys()].sort();
    },
    resetMetrics,
    clearFailures() {
      failures.beforeCommit = null;
      failures.afterCommit = null;
      failures.afterCommitKind = null;
      failures.writeAt = null;
      failures.globalWriteAt = null;
      failures.writeError = null;
    },
    failBeforeCommit(error = new Error("Falha simulada antes do commit")) {
      failures.beforeCommit = error;
    },
    failAfterCommit(error = new Error("Falha simulada depois do commit"), kind = null) {
      failures.afterCommit = error;
      failures.afterCommitKind = kind;
    },
    failOnWrite(index = 1, error = new Error("Falha simulada durante escrita")) {
      if (!Number.isInteger(index) || index < 1) throw new Error("Indice de escrita invalido");
      failures.writeAt = index;
      failures.writeError = error;
    },
    failOnGlobalWrite(offset = 1, error = new Error("Falha global simulada durante escrita")) {
      if (!Number.isInteger(offset) || offset < 1) throw new Error("Offset de escrita invalido");
      failures.globalWriteAt = metrics.writeAttempts + offset;
      failures.writeError = error;
    },
    injectFailure({ phase = "beforeCommit", at = 1, error } = {}) {
      if (phase === "beforeCommit") firestore.failBeforeCommit(error);
      else if (phase === "afterCommit") firestore.failAfterCommit(error);
      else if (phase === "write") firestore.failOnWrite(at, error);
      else if (phase === "globalWrite") firestore.failOnGlobalWrite(at, error);
      else throw new Error(`Fase de falha desconhecida: ${phase}`);
    },
  };

  if (initialDocuments instanceof Map) {
    for (const [path, data] of initialDocuments) seedDocument(path, data);
  } else if (Array.isArray(initialDocuments)) {
    for (const item of initialDocuments) seedDocument(item.path, item.data);
  } else if (initialDocuments && typeof initialDocuments === "object") {
    for (const [path, data] of Object.entries(initialDocuments)) seedDocument(path, data);
  }

  return firestore;
}

export const fakeFirestore = createFakeFirestore;
