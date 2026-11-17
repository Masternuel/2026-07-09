import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { serialize, deserialize } from "node:v8";
import { setTimeout as delay } from "node:timers/promises";

const MAGIC = Buffer.from("BOLASV01");
const MAX_BYTES = 128 * 1024 * 1024;
const failure = (code, message) => Object.assign(new Error(message), { code });
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

// Committed state is shared by every read, so it is frozen: a reader that tries to
// mutate it fails immediately instead of silently corrupting the next save (D-01).
// V8 serialization depends on object layout (frozen objects, cloned arrays), so backups reuse
// the exact committed bytes instead of re-encoding the state.
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  // Binary payloads (editor media bytes) cannot be frozen; reads still return clones of them.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

/**
 * Windows antivirus/indexers can briefly hold the save open, making rename fail with
 * EPERM/EBUSY/EACCES. Retry a few times with short backoff; other errors fail at once (S-10).
 */
export async function renameWithRetry(from, to, { renameFile = rename, attempts = 5, baseDelayMs = 20, wait = delay } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await renameFile(from, to); } catch (error) {
      if (attempt >= attempts || !RENAME_RETRY_CODES.has(error?.code)) throw error;
      await wait(baseDelayMs * attempt);
    }
  }
}

function encode(state) {
  const payload = serialize({ version: 1, state });
  if (payload.length > MAX_BYTES) throw failure("LOCAL_SAVE_TOO_LARGE", "O save local excedeu 128 MiB.");
  return Buffer.concat([MAGIC, createHash("sha256").update(payload).digest(), payload]);
}

function decode(bytes) {
  if (bytes.length < 40 || bytes.length > MAX_BYTES + 40 || !bytes.subarray(0, 8).equals(MAGIC)) {
    throw failure("LOCAL_SAVE_CORRUPT", "Formato do save local invalido. O arquivo nao foi substituido.");
  }
  const payload = bytes.subarray(40);
  if (!createHash("sha256").update(payload).digest().equals(bytes.subarray(8, 40))) {
    throw failure("LOCAL_SAVE_CORRUPT", "Checksum do save local invalido. O arquivo nao foi substituido.");
  }
  let envelope;
  try { envelope = deserialize(payload); } catch {
    throw failure("LOCAL_SAVE_CORRUPT", "Nao foi possivel ler o save local.");
  }
  if (envelope?.version !== 1 || !envelope.state?.profile?.uid || !envelope.state?.rooms || !Array.isArray(envelope.state?.matches)) {
    throw failure("LOCAL_SAVE_CORRUPT", "Schema do save local invalido.");
  }
  return envelope.state;
}

export async function openLocalDatabase(directory, initialState, { atomicWrite, renameFile } = {}) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = join(root, "session.lock");
  const lockValue = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = await readFile(lockPath, "utf8");
    let pid;
    try { pid = JSON.parse(previous).pid; } catch { /* unknown ownership: fail closed */ }
    if (!Number.isSafeInteger(pid) || pid <= 0) throw failure("LOCAL_SAVE_LOCKED", "Lock local desconhecido; nao foi removido.");
    try { process.kill(pid, 0); } catch (probe) {
      if (probe.code !== "ESRCH") throw probe;
      if (await readFile(lockPath, "utf8") !== previous) throw failure("LOCAL_SAVE_LOCKED", "Outra instancia alterou o lock local.");
      await unlink(lockPath);
      lock = await open(lockPath, "wx", 0o600);
    }
    if (!lock) throw failure("LOCAL_SAVE_LOCKED", "Outra instancia esta usando o save local.");
  }
  try { await lock.writeFile(lockValue); } catch (error) {
    await lock.close().catch(() => undefined);
    throw error;
  }
  const path = join(root, "career.bolasave");
  let state;
  let committedBytes;
  let queue = Promise.resolve();
  let closed = false;
  let closePromise;
  const release = async () => {
    await lock.close();
    if (await readFile(lockPath, "utf8") === lockValue) await unlink(lockPath);
    else throw failure("LOCAL_SAVE_LOCKED", "Ownership do lock local mudou; arquivo preservado.");
  };
  const write = atomicWrite ?? (async (bytes) => {
    const temporary = join(root, `career-${randomUUID()}.pending`);
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await renameWithRetry(temporary, path, { renameFile });
    } finally {
      await handle?.close();
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  });
  try {
    try {
      const handle = await open(path, "r");
      try {
        if ((await handle.stat()).size > MAX_BYTES + 40) throw failure("LOCAL_SAVE_TOO_LARGE", "Save local grande demais.");
        committedBytes = await handle.readFile();
        state = decode(committedBytes);
      } finally { await handle.close(); }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (initialState === undefined) throw failure("LOCAL_SAVE_MISSING", "Save local ausente; importacao cancelada.");
      state = structuredClone(initialState);
      committedBytes = encode(state);
      await write(committedBytes);
    }
  } catch (error) { await release(); throw error; }
  deepFreeze(state);

  function enqueue(operation) {
    if (closed) return Promise.reject(failure("LOCAL_SAVE_CLOSED", "Save local fechado."));
    const pending = queue.then(operation);
    queue = pending.catch(() => undefined);
    return pending;
  }
  return {
    path,
    // Readers see the frozen committed state; only their result is cloned (D-01).
    read: (operation) => enqueue(async () => structuredClone(await operation(state))),
    transaction: (operation, { backup = false } = {}) => enqueue(async () => {
      const next = structuredClone(state);
      const backupFile = backup ? `career-before-import-${randomUUID()}.bolasave` : null;
      const result = await operation(next, { backupFile });
      const bytes = encode(next);
      if (backup) {
        const backupRoot = join(root, "backups");
        await mkdir(backupRoot, { recursive: true, mode: 0o700 });
        const temporary = join(backupRoot, `${backupFile}.pending`);
        let handle;
        try {
          handle = await open(temporary, "wx", 0o600);
          await handle.writeFile(committedBytes); await handle.sync(); await handle.close(); handle = null;
          await renameWithRetry(temporary, join(backupRoot, backupFile), { renameFile });
        } finally {
          await handle?.close();
          await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
        }
      }
      await write(bytes);
      state = deepFreeze(next);
      committedBytes = bytes;
      return structuredClone(result);
    }),
    close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = queue.then(release);
      return closePromise;
    },
  };
}
