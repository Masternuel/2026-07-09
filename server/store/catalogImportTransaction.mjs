import { randomUUID } from "node:crypto";
import { canonicalChecksum } from "./roomPersistenceSections.mjs";

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
  for (let offset = 0; offset < records.length;) {
    const batch = rootFirestore.batch();
    const slice = [];
    let bytes = 0;
    while (offset + slice.length < records.length && slice.length < batchSize) {
      const record = records[offset + slice.length];
      const size = Buffer.byteLength(JSON.stringify(record), "utf8") + 1024;
      if (slice.length && bytes + size > 8 * 1024 * 1024) break;
      slice.push(record);
      bytes += size;
    }
    for (const record of slice) {
      const reference = targetFirestore.collection(collectionName).doc(String(record.id));
      references.push(reference);
      batch.set(reference, record);
    }
    await batch.commit();
    offset += slice.length;
    await onBatch?.(offset, records.length);
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
}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rootFirestore.runTransaction(async (transaction) => {
        const current = await transaction.get(metadataReference);
        const operation = current.data()?.importOperation;
        if (operation?.runId !== runId || operation?.generationId !== generationId) return;
        // Only release our lease; never restore stale metadata over concurrent changes.
        const released = { ...current.data() };
        if (Object.hasOwn(originalMetadata ?? {}, "importOperation")
          || released.revision !== originalMetadata?.revision
          || released.activeGenerationId !== originalMetadata?.activeGenerationId) released.importOperation = null;
        else delete released.importOperation;
        if (metadataExisted || Object.keys(released).length) transaction.set(metadataReference, released);
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
  operationType = "brasfoot",
  operationReference = null,
  inputChecksum = null,
  expectedGenerationId = undefined,
  transformRecord = (_collection, existing, record) => ({ ...existing, ...record }),
  verifyStaging = false,
  validateRecords = null,
  activationMetadata = () => ({}),
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
  let idempotentResult = null;
  const importIdField = operationType === "json" ? "lastJsonImportId" : "lastBrasfootImportId";
  const importAtField = operationType === "json" ? "lastJsonImportAt" : "lastBrasfootImportAt";

  try {
    await rootFirestore.runTransaction(async (transaction) => {
      idempotentGenerationId = null;
      idempotentResult = null;
      const [current, receipt] = await Promise.all([
        transaction.get(metadataReference),
        operationReference ? transaction.get(operationReference) : null,
      ]);
      const metadata = current.exists ? current.data() : {};
      metadataExisted = current.exists;
      originalMetadata = current.exists ? { ...metadata } : null;
      baseRevision = Math.max(0, Number(metadata.revision) || 0);
      baseGenerationId = metadata.activeGenerationId ?? null;
      if (receipt?.exists && receipt.data().inputChecksum !== inputChecksum) {
        throw new CatalogImportTransactionError("Identificador de importacao reutilizado com outro arquivo",
          "BRASFOOT_IMPORT_ID_CONFLICT", 409);
      }
      if (receipt?.data()?.status === "completed") {
        idempotentResult = { ...receipt.data().result, activeGenerationId: baseGenerationId, idempotent: true };
        return;
      }
      if (!operationReference && metadata[importIdField] === runId && metadata.activeGenerationId) {
        idempotentGenerationId = metadata.activeGenerationId;
        return;
      }
      if (expectedGenerationId !== undefined && expectedGenerationId !== baseGenerationId) {
        throw new CatalogImportTransactionError("A base mudou; recarregue o Editor antes de importar",
          "BRASFOOT_IMPORT_CONFLICT", 409);
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
          "Ja existe uma importacao em andamento nesta base",
          "BRASFOOT_IMPORT_IN_PROGRESS",
          409,
        );
      }
      transaction.set(metadataReference, {
        ...metadata,
        importOperation: {
          type: operationType,
          runId,
          generationId,
          baseRevision,
          startedAt,
          heartbeatAt: startedAt,
        },
      });
      if (operationReference) transaction.set(operationReference, {
        type: operationType, runId, inputChecksum, generationId, baseGenerationId, baseRevision,
        status: "staging", startedAt,
        ...(receipt?.exists ? { previousAttemptGenerationId: receipt.data().generationId } : {}),
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
    if (operationReference) {
      const receipt = await readForReconciliation(operationReference);
      if (receipt.data()?.inputChecksum === inputChecksum && receipt.data()?.status === "completed") {
        idempotentResult = { ...receipt.data().result,
          activeGenerationId: metadata.activeGenerationId ?? null, idempotent: true };
      }
    }
    if (idempotentResult) return idempotentResult;
    if (!operationReference && metadata[importIdField] === runId && metadata.activeGenerationId) {
      idempotentGenerationId = metadata.activeGenerationId;
      baseRevision = Math.max(0, Number(metadata.revision) || 0);
    } else if (operation?.runId !== runId || operation?.generationId !== generationId) {
      throw error;
    }
  }

  if (idempotentResult) return idempotentResult;
  if (idempotentGenerationId) {
    return { generationId: idempotentGenerationId, revision: baseRevision, idempotent: true };
  }

  const sourceFirestore = sourceFirestoreForGeneration(baseGenerationId);
  const generationFirestore = generationFirestoreForId(generationId);
  const stagedReferences = [];
  let activated = false;
  let promotionOutcomeUncertain = false;
  const expectedCollections = new Map();

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
      if (importLeaseExpired(operation, heartbeatAt)) {
        throw new CatalogImportTransactionError("A importacao perdeu seu prazo; tente novamente",
          "BRASFOOT_IMPORT_REPLACED", 409);
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
        merged.set(id, { ...transformRecord(collectionName, merged.get(id) ?? {}, record), id });
      }
      const completeRecords = [...merged.values()];
      if (verifyStaging) expectedCollections.set(collectionName,
        new Map(completeRecords.map((record) => [record.id, canonicalChecksum(record)])));
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

    if (verifyStaging) {
      const verifiedCollections = {};
      for (const [collectionName, expected] of expectedCollections) {
        await heartbeat();
        const staged = await generationFirestore.collection(collectionName).get();
        if (staged.docs.length !== expected.size || staged.docs.some((document) => (
          !expected.has(document.id) || expected.get(document.id) !== canonicalChecksum(document.data())
        ))) {
          throw new CatalogImportTransactionError("A geracao importada esta incompleta ou corrompida",
            "BRASFOOT_IMPORT_VALIDATION_FAILED", 500, { collectionName });
        }
        if (validateRecords) verifiedCollections[collectionName] = staged.docs.map((document) => document.data());
      }
      if (validateRecords) await validateRecords(verifiedCollections);
    }

    const completedAt = timestamp(now);
    const result = { generationId, revision: baseRevision + 1, counts, idempotent: false };
    try {
      await rootFirestore.runTransaction(async (transaction) => {
        const current = await transaction.get(metadataReference);
        const metadata = current.data() ?? {};
        if (metadata[importIdField] === runId
          && metadata.activeGenerationId === generationId) return;
        const operation = metadata.importOperation;
        if (operation?.runId !== runId
          || operation?.generationId !== generationId
          || Number(metadata.revision || 0) !== baseRevision
          || (metadata.activeGenerationId ?? null) !== baseGenerationId
          || importLeaseExpired(operation, timestamp(now))) {
          throw new CatalogImportTransactionError(
            "A base mudou durante a importacao",
            "BRASFOOT_IMPORT_CONFLICT",
            409,
          );
        }
        transaction.set(metadataReference, {
          ...metadata,
          ...activationMetadata(completedAt),
          activeGenerationId: generationId,
          revision: baseRevision + 1,
          [importIdField]: runId,
          [importAtField]: completedAt,
          importOperation: null,
          counts: metadataCounts(counts),
        });
        if (operationReference) transaction.set(operationReference, {
          type: operationType, runId, inputChecksum, generationId, baseGenerationId, baseRevision,
          status: "completed", startedAt, completedAt, validated: verifyStaging, result,
        });
      });
      activated = true;
    } catch (error) {
      let reconciled;
      let receipt;
      try {
        reconciled = await readForReconciliation(metadataReference);
        if (operationReference) receipt = await readForReconciliation(operationReference);
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
      if ((metadata?.[importIdField] === runId && metadata?.activeGenerationId === generationId)
        || (receipt?.data()?.status === "completed" && receipt.data().generationId === generationId
          && receipt.data().inputChecksum === inputChecksum)) activated = true;
      else throw error;
    }

    return result;
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
      }).catch((failure) => {
        cleanupError ??= failure;
      });
      if (operationReference) await rootFirestore.runTransaction(async (transaction) => {
        const receipt = await transaction.get(operationReference);
        if (receipt.data()?.generationId !== generationId || receipt.data()?.status === "completed") return;
        transaction.set(operationReference, {
          ...receipt.data(), status: "failed", failedAt: timestamp(now),
          errorCode: error?.code ?? "IMPORT_FAILED", stagingCleanupFailed: Boolean(cleanupError),
        });
      }).catch((failure) => { cleanupError ??= failure; });
      if (cleanupError && error && typeof error === "object") {
        error.details = { ...(error.details ?? {}), stagingCleanupFailed: cleanupError.message };
      }
    }
    throw error;
  }
}
