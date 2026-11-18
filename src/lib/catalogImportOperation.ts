export interface CatalogImportOperation {
  key: string;
  operationId: string;
}

export async function getCatalogImportOperation(
  ownerId: string,
  file: Blob,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): Promise<CatalogImportOperation> {
  if (file.size > 24 * 1024 * 1024) throw new Error('A base excede o limite de 24 MB.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const key = `bola-manager:catalog-import:${encodeURIComponent(ownerId)}:${checksum}`;
  const stored = storage.getItem(key);
  const operationId = stored && /^[a-zA-Z0-9_-]{1,128}$/.test(stored) ? stored : crypto.randomUUID();
  // Persist before uploading so reselection/reload can reconcile a lost response.
  storage.setItem(key, operationId);
  return { key, operationId };
}

export function completeCatalogImportOperation(
  operation: CatalogImportOperation,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = window.localStorage,
) {
  if (storage.getItem(operation.key) === operation.operationId) storage.removeItem(operation.key);
}
