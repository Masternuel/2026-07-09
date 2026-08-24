import { randomUUID } from "node:crypto";

const IMPORT_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 400;
const RECONCILIATION_ATTEMPTS = 5;

export class CatalogImportTransactionError extends Error {
  constructor(message, code, status = 409, details) {
    super(message);
    this.name = "CatalogImportTransactionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function timestamp(now) {
  const value = now();
  return value instanceof Date ? value.toISOString() : String(value);
}

function importLeaseExpired(operation, currentTimestamp) {
  const heartbeat = Date.parse(operation?.heartbeatAt ?? operation?.startedAt ?? "");
  const current = Date.parse(currentTimestamp);
  return !Number.isFinite(heartbeat)
    || !Number.isFinite(current)
    || current - heartbeat >= IMPORT_LEASE_MS;
}

async function writeRecords(
  rootFirestore,
  targetFirestore,
  collectionName,
  records,
  batchSize,
  references,
  onBatch,
) {
  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = rootFirestore.batch();
    const slice = records.slice(offset, offset + batchSize);
    for (const record of slice) {
      const reference = targetFirestore.collection(collectionName).doc(String(record.id));
      references.push(reference);
      batch.set(reference, record);
    }
    await batch.commit();
    await onBatch?.(Math.min(offset + slice.length, records.length), records.length);
  }
}

async function deleteReferences(rootFirestore, references, batchSize) {
  for (let offset = 0; offset < references.length; offset += batchSize) {
    const slice = references.slice(offset, offset + batchSize);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const batch = rootFirestore.batch();
        for (const reference of slice) batch.delete(reference);
        await batch.commit();
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
  }
}

async function readForReconciliation(reference) {
  let lastError;
  for (let attempt = 0; attempt < RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      return await reference.get();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function restoreMetadata({
  rootFirestore,
  metadataReference,
  metadataExisted,
  originalMetadata,
  runId,
  generationId,
  baseRevision,
}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rootFirestore.runTransaction(async (transaction) => {
        const current = await transaction.get(metadataReference);
        const operation = current.data()?.importOperation;
        if (operation?.runId !== runId || operation?.generationId !== generationId) return;
        const revisionChanged = Number(current.data()?.revision || 0) !== baseRevision;
        if (revisionChanged) {
          transaction.set(metadataReference, {
            ...current.data(),
            importOperation: originalMetadata?.importOperation ?? null,
          });
        } else if (metadataExisted) transaction.set(metadataReference, originalMetadata);
        else transaction.delete(metadataReference);
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function commitCatalogGeneration({
  rootFirestore,
  metadataReference,
  sourceFirestoreForGeneration,
  generationFirestoreForId,
  collectionPlan,
  runId,
  generationId = randomUUID(),
  batchSize = DEFAULT_BATCH_SIZE,
  now = () => new Date(),
  onProgress = async () => {},
  metadataCounts = (counts) => counts,
}) {
  if (!rootFirestore?.runTransaction || !rootFirestore?.batch) {
    throw new CatalogImportTransactionError(
      "Firestore nao oferece transacao e batch para a importacao",
      "BRASFOOT_IMPORT_TRANSACTION_UNAVAILABLE",
      503,
    );
  }
  const normalizedBatchSize = Math.max(1, Math.min(DEFAULT_BATCH_SIZE, Number(batchSize) || DEFAULT_BATCH_SIZE));
  const startedAt = timestamp(now);
  let baseRevision = 0;
  let baseGenerationId = null;
  let originalMetadata = null;
  let metadataExisted = false;
  let idempotentGenerationId = null;

  try {
    await rootFirestore.runTransaction(async (transaction) => {
      const current = await transaction.get(metadataReference);
      const metadata = current.exists ? current.data() : {};
      metadataExisted = current.exists;
      originalMetadata = current.exists ? { ...metadata } : null;
      baseRevision = Math.max(0, Number(metadata.revision) || 0);
      baseGenerationId = metadata.activeGenerationId ?? null;
      if (metadata.lastBrasfootImportId === runId && metadata.activeGenerationId) {
        idempotentGenerationId = metadata.activeGenerationId;
        return;
      }
      if (["importing", "initializing"].includes(metadata.status)) {
        throw new CatalogImportTransactionError(
          "Ja existe uma alteracao exclusiva em andamento nesta base",
          "BRASFOOT_IMPORT_IN_PROGRESS",
          409,
        );
      }
      if (metadata.importOperation && !importLeaseExpired(metadata.importOperation, startedAt)) {
        throw new CatalogImportTransactionError(
          "Ja existe uma importacao Brasfoot em andamento nesta base",
          "BRASFOOT_IMPORT_IN_PROGRESS",
          409,
        );
      }
      transaction.set(metadataReference, {
        ...metadata,
        importOperation: {
          type: "brasfoot",
          runId,
          generationId,
          baseRevision,
          startedAt,
          heartbeatAt: startedAt,
        },
      });
    });
  } catch (error) {
    if (error instanceof CatalogImportTransactionError) throw error;
    let reconciled;
    try {
      reconciled = await readForReconciliation(metadataReference);
    } catch (reconciliationError) {
      throw new CatalogImportTransactionError(
        "Nao foi possivel confirmar o inicio da importacao",
        "BRASFOOT_IMPORT_COMMIT_UNCERTAIN",
        503,
        { cause: reconciliationError.message },
      );
    }
    const metadata = reconciled.data?.() ?? {};
    const operation = metadata.importOperation;
    if (metadata.lastBrasfootImportId === runId && metadata.activeGenerationId) {
      idempotentGenerationId = metadata.activeGenerationId;
      baseRevision = Math.max(0, Number(metadata.revision) || 0);
    } else if (operation?.runId !== runId || operation?.generationId !== generationId) {
      throw error;
    }
  }

  if (idempotentGenerationId) {
    return { generationId: idempotentGenerationId, revision: baseRevision, idempotent: true };
  }

  const sourceFirestore = sourceFirestoreForGeneration(baseGenerationId);
  const generationFirestore = generationFirestoreForId(generationId);
  const stagedReferences = [];
  let activated = false;
  let promotionOutcomeUncertain = false;

  const heartbeat = async () => {
    const heartbeatAt = timestamp(now);
    await rootFirestore.runTransaction(async (transaction) => {
      const current = await transaction.get(metadataReference);
      const operation = current.data()?.importOperation;
      if (operation?.runId !== runId || operation?.generationId !== generationId) {
        throw new CatalogImportTransactionError(
          "A importacao foi substituida por outra operacao",
          "BRASFOOT_IMPORT_REPLACED",
          409,
        );
      }
      transaction.set(metadataReference, {
        ...current.data(),
        importOperation: { ...operation, heartbeatAt },
      });
    });
  };

  try {
    const counts = {};
    for (const { collectionName, records = [] } of collectionPlan) {
      const current = await sourceFirestore.collection(collectionName).get();
      const merged = new Map(current.docs.map((document) => [
        String(document.id),
        { ...document.data(), id: String(document.id) },
      ]));
      for (const record of records) {
        const id = String(record.id);
        merged.set(id, { ...(merged.get(id) ?? {}), ...record, id });
      }
      const completeRecords = [...merged.values()];
      counts[collectionName] = completeRecords.length;
      await writeRecords(
        rootFirestore,
        generationFirestore,
        collectionName,
        completeRecords,
        normalizedBatchSize,
        stagedReferences,
        async (written, total) => {
          await heartbeat();
          const committed = total > 0
            ? Math.min(records.length, Math.ceil((records.length * written) / total))
            : records.length;
          await onProgress(collectionName, committed);
        },
      );
      if (completeRecords.length === 0) await onProgress(collectionName, records.length);
    }

    const completedAt = timestamp(now);
    try {
      await rootFirestore.runTransaction(async (transaction) => {
        const current = await transaction.get(metadataReference);
        const metadata = current.data() ?? {};
        if (metadata.lastBrasfootImportId === runId
          && metadata.activeGenerationId === generationId) return;
        const operation = metadata.importOperation;
        if (operation?.runId !== runId
          || operation?.generationId !== generationId
          || Number(metadata.revision || 0) !== baseRevision) {
          throw new CatalogImportTransactionError(
            "A base mudou durante a importacao Brasfoot",
            "BRASFOOT_IMPORT_CONFLICT",
            409,
          );
        }
        transaction.set(metadataReference, {
          ...metadata,
          activeGenerationId: generationId,
          revision: baseRevision + 1,
          lastBrasfootImportId: runId,
          lastBrasfootImportAt: completedAt,
          importOperation: null,
          counts: metadataCounts(counts),
        });
      });
      activated = true;
    } catch (error) {
      let reconciled;
      try {
        reconciled = await readForReconciliation(metadataReference);
      } catch (reconciliationError) {
        promotionOutcomeUncertain = true;
        throw new CatalogImportTransactionError(
          "A ativacao da base ficou com resultado incerto; a geracao foi preservada",
          "BRASFOOT_IMPORT_COMMIT_UNCERTAIN",
          503,
          {
            cause: reconciliationError.message,
            generationId,
            stagingPreserved: true,
          },
        );
      }
      const metadata = reconciled.data?.();
      if (metadata?.lastBrasfootImportId === runId
        && metadata?.activeGenerationId === generationId) activated = true;
      else throw error;
    }

    return { generationId, revision: baseRevision + 1, counts, idempotent: false };
  } catch (error) {
    if (!activated && !promotionOutcomeUncertain) {
      let cleanupError = null;
      try {
        await deleteReferences(rootFirestore, stagedReferences, normalizedBatchSize);
      } catch (failure) {
        cleanupError = failure;
      }
      await restoreMetadata({
        rootFirestore,
        metadataReference,
        metadataExisted,
        originalMetadata,
        runId,
        generationId,
        baseRevision,
      }).catch((failure) => {
        cleanupError ??= failure;
      });
      if (cleanupError && error && typeof error === "object") {
        error.details = { ...(error.details ?? {}), stagingCleanupFailed: cleanupError.message };
      }
    }
    throw error;
  }
}
