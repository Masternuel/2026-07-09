import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { serialize, deserialize } from "node:v8";

const MAGIC = Buffer.from("BOLASV01");
const MAX_BYTES = 128 * 1024 * 1024;
const failure = (code, message) => Object.assign(new Error(message), { code });

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

export async function openLocalDatabase(directory, initialState, { atomicWrite } = {}) {
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
      await rename(temporary, path);
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
        state = decode(await handle.readFile());
      } finally { await handle.close(); }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (initialState === undefined) throw failure("LOCAL_SAVE_MISSING", "Save local ausente; importacao cancelada.");
      state = structuredClone(initialState);
      await write(encode(state));
    }
  } catch (error) { await release(); throw error; }

  function enqueue(operation) {
    if (closed) return Promise.reject(failure("LOCAL_SAVE_CLOSED", "Save local fechado."));
    const pending = queue.then(operation);
    queue = pending.catch(() => undefined);
    return pending;
  }
  return {
    path,
    read: (operation) => enqueue(() => operation(structuredClone(state))),
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
          await handle.writeFile(encode(state)); await handle.sync(); await handle.close(); handle = null;
          await rename(temporary, join(backupRoot, backupFile));
        } finally {
          await handle?.close();
          await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
        }
      }
      await write(bytes);
      state = next;
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
