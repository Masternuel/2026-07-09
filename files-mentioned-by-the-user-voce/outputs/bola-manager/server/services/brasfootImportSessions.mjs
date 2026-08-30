import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, posix, resolve, sep, win32 } from "node:path";
import { parseBrasfootSource } from "../../scripts/lib/brasfoot-binary.mjs";
import { executeImportCommit, normalizeDataset } from "../../scripts/import-brasfoot.mjs";

export const BRASFOOT_IMPORT_LIMITS = Object.freeze({
  maxFiles: 200,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  ttlMs: 30 * 60 * 1000,
});

const ALLOWED_EXTENSIONS = new Set([".ban", ".cfg", ".png"]);
const FILE_SAMPLE_LIMIT = 30;
const CLUB_SAMPLE_LIMIT = 12;
const ISSUE_SAMPLE_LIMIT = 30;
const SESSION_COLLECTION = "brasfootImportSessions";
const SESSION_LOCK_COLLECTION = "brasfootImportSessionLocks";
const STORAGE_PREFIX = "brasfoot-import-sessions";
const DOWNLOAD_CONCURRENCY = 8;

export class BrasfootImportSessionError extends Error {
  constructor(message, code, status = 400, details) {
    super(message);
    this.name = "BrasfootImportSessionError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

function sessionError(message, code, status = 400, details) {
  return new BrasfootImportSessionError(message, code, status, details);
}

function timestamp(value) {
  const candidate = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(candidate)) throw new Error("Relogio da sessao Brasfoot retornou valor invalido");
  return candidate;
}

function iso(value) {
  return new Date(value).toISOString();
}

function pathWithin(root, target) {
  const normalizedRoot = process.platform === "win32" ? root.toLocaleLowerCase("en-US") : root;
  const normalizedTarget = process.platform === "win32" ? target.toLocaleLowerCase("en-US") : target;
  return normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}

export function normalizeBrasfootUploadPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw sessionError("Informe o caminho relativo do arquivo", "BRASFOOT_IMPORT_PATH_REQUIRED", 400);
  }
  const candidate = value.trim().replaceAll("\\", "/").normalize("NFC");
  if (candidate.length > 512) {
    throw sessionError("Caminho do arquivo excede 512 caracteres", "BRASFOOT_IMPORT_PATH_TOO_LONG", 400);
  }
  if (isAbsolute(candidate) || posix.isAbsolute(candidate) || win32.isAbsolute(candidate)) {
    throw sessionError("O caminho precisa ser relativo", "BRASFOOT_IMPORT_PATH_INVALID", 400);
  }
  let parts = candidate.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."
    || part.includes(":") || /[\u0000-\u001f\u007f]/.test(part))) {
    throw sessionError("Caminho de arquivo invalido", "BRASFOOT_IMPORT_PATH_INVALID", 400);
  }
  const extension = extname(parts.at(-1)).toLocaleLowerCase("en-US");
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw sessionError(
      "Apenas arquivos .ban, .cfg e .png sao aceitos",
      "BRASFOOT_IMPORT_EXTENSION_INVALID",
      415,
      { allowedExtensions: [...ALLOWED_EXTENSIONS] },
    );
  }
  const rootIndex = parts.findIndex((part) => ["teams", "conf_ligas_nacionais"]
    .includes(part.toLocaleLowerCase("en-US")));
  if (rootIndex >= 0) {
    parts = parts.slice(rootIndex);
  } else if (parts.length === 1) {
    if (extension === ".ban") parts = ["teams", parts[0]];
    else if (extension === ".cfg") parts = ["conf_ligas_nacionais", parts[0]];
    else parts = ["teams", "escudos", parts[0]];
  }
  const root = parts[0].toLocaleLowerCase("en-US");
  const expectedRoot = extension === ".cfg" ? "conf_ligas_nacionais" : "teams";
  if (root !== expectedRoot || (extension === ".cfg" && parts.length !== 2)) {
    throw sessionError(
      extension === ".cfg"
        ? "Arquivos .cfg devem ficar diretamente em conf_ligas_nacionais/"
        : `Arquivos ${extension} devem ficar dentro de teams/`,
      "BRASFOOT_IMPORT_STRUCTURE_INVALID",
      400,
    );
  }
  parts[0] = expectedRoot;
  return parts.join("/");
}

function summarizeDataset(data) {
  const clubIds = new Set(data.clubs.map((club) => club.id));
  return {
    version: data.version,
    clubs: data.clubs.length,
    players: data.players.length,
    leagues: data.leagues.length,
    cups: data.cups.length,
    playersWithoutClub: data.players.filter((player) => !clubIds.has(player.clubId)).length,
  };
}

function compactReport(report) {
  return {
    sourceFormat: report.sourceFormat,
    scanned: report.scanned ?? {},
    success: report.success ?? {},
    errors: (report.errors ?? []).slice(0, ISSUE_SAMPLE_LIMIT),
    warnings: (report.warnings ?? []).slice(0, ISSUE_SAMPLE_LIMIT),
    errorCount: report.errors?.length ?? 0,
    warningCount: report.warnings?.length ?? 0,
    corruptedCount: report.corrupted?.length ?? 0,
    duplicateClubIds: report.duplicates?.clubs?.length ?? 0,
    duplicateClubNames: report.duplicates?.clubNames?.length ?? 0,
    duplicatePlayers: report.duplicates?.players?.length ?? 0,
    duplicateLeagues: report.duplicates?.leagues?.length ?? 0,
    assets: { ...(report.assets ?? {}) },
  };
}

function clubSample(data) {
  const playerCounts = new Map();
  for (const player of data.players) {
    playerCounts.set(player.clubId, (playerCounts.get(player.clubId) ?? 0) + 1);
  }
  return data.clubs.slice(0, CLUB_SAMPLE_LIMIT).map((club) => ({
    id: club.id,
    name: club.name,
    abbreviation: club.abbreviation ?? "",
    country: club.country ?? null,
    division: club.division ?? null,
    players: playerCounts.get(club.id) ?? 0,
    hasCrest: Boolean(club.assets?.shield),
  }));
}

function fileSample(session) {
  return [...session.files.values()]
    .sort((left, right) => left.path.localeCompare(right.path, "pt-BR"))
    .slice(0, FILE_SAMPLE_LIMIT)
    .map((file) => ({ ...file }));
}

function publicLimits(limits) {
  return {
    maxFiles: limits.maxFiles,
    maxFileBytes: limits.maxFileBytes,
    maxTotalBytes: limits.maxTotalBytes,
  };
}

function mebibytes(bytes) {
  return Math.round(bytes / (1024 * 1024));
}

function supportsDistributedSessions(database, bucket) {
  return Boolean(
    database
    && typeof database.collection === "function"
    && typeof database.runTransaction === "function"
    && bucket
    && typeof bucket.file === "function",
  );
}

function documentId(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function mapConcurrent(values, maximum, operation) {
  const queue = [...values];
  const results = new Array(queue.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(maximum, queue.length) }, async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(queue[index], index);
    }
  }));
  return results;
}

function storageContentType(path) {
  if (path.toLowerCase().endsWith(".png")) return "image/png";
  if (path.toLowerCase().endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export class BrasfootImportSessionService {
  constructor({
    database = null,
    databaseForOwner = null,
    bucket = null,
    mediaService = null,
    logger = console,
    tempDirectory = tmpdir(),
    limits = {},
    now = () => Date.now(),
    idFactory = randomUUID,
    parseSource = parseBrasfootSource,
    normalize = normalizeDataset,
    commitImport = executeImportCommit,
    scheduleCleanup = true,
    nodeEnv = process.env.NODE_ENV,
    allowLocalFallback = String(nodeEnv ?? "development").toLowerCase() !== "production",
    sessionCollection = SESSION_COLLECTION,
    sessionLockCollection = SESSION_LOCK_COLLECTION,
    storagePrefix = STORAGE_PREFIX,
  } = {}) {
    this.database = database;
    this.databaseForOwner = databaseForOwner;
    this.bucket = bucket ?? mediaService?.firebase?.bucket ?? mediaService?.bucket ?? null;
    this.mediaService = mediaService;
    this.logger = logger;
    this.tempDirectory = resolve(tempDirectory);
    this.limits = Object.freeze({ ...BRASFOOT_IMPORT_LIMITS, ...limits });
    this.now = now;
    this.idFactory = idFactory;
    this.parseSource = parseSource;
    this.normalize = normalize;
    this.commitImport = commitImport;
    this.sessionCollection = String(sessionCollection);
    this.sessionLockCollection = String(sessionLockCollection);
    this.storagePrefix = String(storagePrefix).replace(/^\/+|\/+$/g, "");
    this.storageMode = supportsDistributedSessions(this.database, this.bucket)
      ? "firestore-storage"
      : allowLocalFallback
        ? "local"
        : "unavailable";
    this.sessions = new Map();
    this.ownerCommits = new Set();
    this.activeJobs = new Set();
    this.root = null;
    this.closed = false;
    this.closePromise = null;
    this.cleanupTimer = null;
    if (scheduleCleanup) {
      const interval = Math.max(1_000, Math.min(60_000, this.limits.ttlMs));
      this.cleanupTimer = setInterval(() => {
        void this.#track(this.cleanupExpired()).catch((error) => this.#logError(error));
      }, interval);
      this.cleanupTimer.unref?.();
    }
  }

  #nowMs() {
    return timestamp(this.now());
  }

  #logError(error) {
    try {
      this.logger?.error?.(error);
    } catch {
      // Logging must never alter an import result.
    }
  }

  #assertAvailable() {
    if (this.closed) {
      throw sessionError("Servico de importacao encerrado", "BRASFOOT_IMPORT_CLOSED", 503);
    }
    if (this.storageMode === "unavailable") {
      throw sessionError(
        "Firestore e Firebase Storage sao obrigatorios para importar em producao",
        "BRASFOOT_IMPORT_DISTRIBUTED_STORAGE_REQUIRED",
        503,
      );
    }
  }

  #track(job) {
    const promise = Promise.resolve(job);
    this.activeJobs.add(promise);
    promise.then(
      () => this.activeJobs.delete(promise),
      () => this.activeJobs.delete(promise),
    );
    return promise;
  }

  async #ensureRoot() {
    if (this.closed) throw sessionError("Servico de importacao encerrado", "BRASFOOT_IMPORT_CLOSED", 503);
    if (!this.root) {
      await mkdir(this.tempDirectory, { recursive: true });
      this.root = await mkdtemp(join(this.tempDirectory, "bola-manager-brasfoot-"));
    }
    return this.root;
  }

  #sessionReference(sessionId) {
    return this.database.collection(this.sessionCollection).doc(String(sessionId));
  }

  #lockReference(ownerId) {
    return this.database.collection(this.sessionLockCollection).doc(documentId(ownerId));
  }

  async #saveStorage(path, bytes) {
    await this.bucket.file(path).save(bytes, {
      resumable: false,
      metadata: { contentType: storageContentType(path), cacheControl: "private, no-store" },
    });
  }

  async #downloadStorage(path) {
    try {
      const result = await this.bucket.file(path).download();
      const bytes = Array.isArray(result) ? result[0] : result;
      return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    } catch (error) {
      throw sessionError(
        "Arquivo temporario da importacao nao esta disponivel",
        "BRASFOOT_IMPORT_STORAGE_UNAVAILABLE",
        503,
        { cause: error?.code ?? "storage-read-failed" },
      );
    }
  }

  async #deleteStorage(path) {
    if (!path) return;
    await this.bucket.file(path).delete({ ignoreNotFound: true });
  }

  async #distributedFiles(reference) {
    const snapshot = await reference.collection("files").get();
    return snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .sort((left, right) => left.path.localeCompare(right.path, "pt-BR"));
  }

  async #materializeFiles(session, files, operation, { downloadFiles = true } = {}) {
    const root = await this.#ensureRoot();
    const directory = resolve(root, `${session.id}-${randomUUID()}`);
    if (!pathWithin(root, directory)) throw new Error("ID de sessao gerou caminho inseguro");
    await mkdir(directory, { recursive: false });
    try {
      if (downloadFiles) {
        await mapConcurrent(files, DOWNLOAD_CONCURRENCY, async (file) => {
          const target = resolve(directory, ...file.path.split("/"));
          if (!pathWithin(directory, target)) {
            throw sessionError("Caminho de arquivo invalido", "BRASFOOT_IMPORT_PATH_INVALID", 400);
          }
          const bytes = await this.#downloadStorage(file.storagePath);
          const checksum = createHash("sha256").update(bytes).digest("hex");
          if (bytes.length !== file.size || checksum !== file.sha256) {
            throw sessionError(
              "Arquivo temporario da importacao falhou na verificacao de integridade",
              "BRASFOOT_IMPORT_STORAGE_CORRUPT",
              503,
            );
          }
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, bytes, { flag: "wx" });
        });
      }
      return await operation(directory);
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  async #findDistributed(sessionId, ownerId) {
    const reference = this.#sessionReference(sessionId);
    const snapshot = await reference.get();
    const session = snapshot.exists ? snapshot.data() : null;
    if (!session || session.ownerId !== String(ownerId) || session.expiresAt <= this.#nowMs()) {
      throw sessionError("Sessao de importacao nao encontrada", "BRASFOOT_IMPORT_SESSION_NOT_FOUND", 404);
    }
    return { ...session, id: snapshot.id, reference };
  }

  async #claimDistributed(sessionId, ownerId, status = "busy") {
    const reference = this.#sessionReference(sessionId);
    const token = String(this.idFactory());
    const nowMs = this.#nowMs();
    const session = await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? snapshot.data() : null;
      if (!current || current.ownerId !== String(ownerId) || current.expiresAt <= nowMs) {
        throw sessionError("Sessao de importacao nao encontrada", "BRASFOOT_IMPORT_SESSION_NOT_FOUND", 404);
      }
      if (current.busyToken && current.busyUntil > nowMs) {
        throw sessionError("Sessao de importacao ocupada", "BRASFOOT_IMPORT_SESSION_BUSY", 409);
      }
      transaction.update(reference, {
        status,
        busyToken: token,
        busyUntil: nowMs + this.limits.ttlMs,
        updatedAt: nowMs,
      });
      return current;
    });
    return { ...session, id: String(sessionId), reference, token };
  }

  async #releaseDistributed(lease, { touch = true } = {}) {
    const nowMs = this.#nowMs();
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(lease.reference);
      if (!snapshot.exists || snapshot.data().busyToken !== lease.token) return;
      transaction.update(lease.reference, {
        status: "ready",
        busyToken: null,
        busyUntil: null,
        updatedAt: nowMs,
        ...(touch ? { expiresAt: nowMs + this.limits.ttlMs } : {}),
      });
    });
  }

  async #useDistributed(sessionId, ownerId, operation) {
    const lease = await this.#claimDistributed(sessionId, ownerId);
    let succeeded = false;
    try {
      const result = await operation(lease);
      succeeded = true;
      return result;
    } finally {
      await this.#releaseDistributed(lease, { touch: succeeded }).catch((error) => this.#logError(error));
    }
  }

  async #acquireOwnerLock(ownerId) {
    const reference = this.#lockReference(ownerId);
    const token = String(this.idFactory());
    const nowMs = this.#nowMs();
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists && snapshot.data().expiresAt > nowMs) {
        throw sessionError(
          "Ja existe uma importacao Brasfoot em andamento nesta base",
          "BRASFOOT_IMPORT_IN_PROGRESS",
          409,
        );
      }
      transaction.set(reference, {
        ownerId: String(ownerId),
        token,
        createdAt: nowMs,
        expiresAt: nowMs + this.limits.ttlMs,
      });
    });
    return { reference, token };
  }

  async #releaseOwnerLock(lock) {
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(lock.reference);
      if (snapshot.exists && snapshot.data().token === lock.token) transaction.delete(lock.reference);
    });
  }

  #touch(session) {
    const nowMs = this.#nowMs();
    session.updatedAt = nowMs;
    session.expiresAt = nowMs + this.limits.ttlMs;
  }

  async #find(sessionId, ownerId) {
    await this.cleanupExpired();
    const session = this.sessions.get(String(sessionId));
    if (!session || session.ownerId !== String(ownerId)) {
      throw sessionError("Sessao de importacao nao encontrada", "BRASFOOT_IMPORT_SESSION_NOT_FOUND", 404);
    }
    return session;
  }

  async #use(sessionId, ownerId, operation) {
    const session = await this.#find(sessionId, ownerId);
    if (session.busy) {
      throw sessionError("Sessao de importacao ocupada", "BRASFOOT_IMPORT_SESSION_BUSY", 409);
    }
    session.busy = true;
    try {
      const result = await operation(session);
      this.#touch(session);
      return result;
    } finally {
      session.busy = false;
    }
  }

  async #createDistributedSession(ownerId) {
    const nowMs = this.#nowMs();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = String(this.idFactory());
      const reference = this.#sessionReference(id);
      try {
        await reference.create({
          ownerId: String(ownerId),
          status: "ready",
          busyToken: null,
          busyUntil: null,
          fileCount: 0,
          totalBytes: 0,
          revision: 0,
          preview: null,
          createdAt: nowMs,
          updatedAt: nowMs,
          expiresAt: nowMs + this.limits.ttlMs,
        });
        return {
          sessionId: id,
          id,
          createdAt: iso(nowMs),
          expiresAt: iso(nowMs + this.limits.ttlMs),
          limits: publicLimits(this.limits),
        };
      } catch (error) {
        if (![6, "6", "already-exists"].includes(error?.code)) throw error;
      }
    }
    throw new Error("Nao foi possivel gerar ID unico para sessao Brasfoot");
  }

  async #uploadDistributed({ sessionId, ownerId, normalizedPath, bytes }) {
    return this.#useDistributed(sessionId, ownerId, async (session) => {
      const fileReference = session.reference.collection("files").doc(documentId(normalizedPath));
      const previousSnapshot = await fileReference.get();
      const previous = previousSnapshot.exists ? previousSnapshot.data() : null;
      const nextFileCount = session.fileCount + (previous ? 0 : 1);
      const nextTotalBytes = session.totalBytes - (previous?.size ?? 0) + bytes.length;
      if (nextFileCount > this.limits.maxFiles) {
        throw sessionError(
          `Sessao excede o limite de ${this.limits.maxFiles} arquivos`,
          "BRASFOOT_IMPORT_TOO_MANY_FILES",
          413,
          { maximumFiles: this.limits.maxFiles },
        );
      }
      if (nextTotalBytes > this.limits.maxTotalBytes) {
        throw sessionError(
          `Sessao excede o limite total de ${mebibytes(this.limits.maxTotalBytes)} MB`,
          "BRASFOOT_IMPORT_TOTAL_TOO_LARGE",
          413,
          { maximumBytes: this.limits.maxTotalBytes },
        );
      }
      const extension = extname(normalizedPath).toLowerCase();
      const storagePath = `${this.storagePrefix}/${session.id}/files/${randomUUID()}${extension}`;
      const file = {
        path: normalizedPath,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        storagePath,
      };
      await this.#saveStorage(storagePath, bytes);
      try {
        await this.database.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(session.reference);
          const current = snapshot.exists ? snapshot.data() : null;
          if (!current || current.busyToken !== session.token) {
            throw sessionError("Sessao de importacao ocupada", "BRASFOOT_IMPORT_SESSION_BUSY", 409);
          }
          transaction.set(fileReference, file);
          transaction.update(session.reference, {
            fileCount: nextFileCount,
            totalBytes: nextTotalBytes,
            revision: current.revision + 1,
            preview: null,
            updatedAt: this.#nowMs(),
          });
        });
      } catch (error) {
        await this.#deleteStorage(storagePath).catch((cleanupError) => this.#logError(cleanupError));
        throw error;
      }
      await this.#deleteStorage(previous?.storagePath).catch((error) => this.#logError(error));
      await this.#deleteStorage(session.preview?.storagePath).catch((error) => this.#logError(error));
      return {
        sessionId: session.id,
        id: session.id,
        file: { path: file.path, size: file.size, sha256: file.sha256 },
        fileCount: nextFileCount,
        totalBytes: nextTotalBytes,
        previewValid: false,
      };
    });
  }

  async #previewDistributed({ sessionId, ownerId }) {
    return this.#useDistributed(sessionId, ownerId, async (session) => {
      const files = await this.#distributedFiles(session.reference);
      const sourceFiles = files.filter((file) => [".ban", ".cfg"].includes(extname(file.path).toLowerCase()));
      if (sourceFiles.length === 0) {
        throw sessionError(
          "Envie ao menos um arquivo .ban ou .cfg",
          "BRASFOOT_IMPORT_SOURCE_REQUIRED",
          400,
        );
      }
      return this.#materializeFiles(session, files, async (directory) => {
        const parsedSource = await this.parseSource(directory, {
          maxFiles: this.limits.maxFiles,
          maxBytes: this.limits.maxFileBytes,
        });
        parsedSource.report.inputPath = `editor-session:${session.id}`;
        const data = this.normalize(parsedSource.dataset);
        const summary = summarizeDataset(data);
        const response = {
          sessionId: session.id,
          id: session.id,
          revision: session.revision,
          summary,
          report: compactReport(parsedSource.report),
          clubs: clubSample(data),
          files: files.slice(0, FILE_SAMPLE_LIMIT).map(({ path, size, sha256 }) => ({ path, size, sha256 })),
          fileCount: files.length,
          totalBytes: session.totalBytes,
        };
        const storagePath = `${this.storagePrefix}/${session.id}/previews/${randomUUID()}.json`;
        const artifact = Buffer.from(JSON.stringify({
          revision: session.revision,
          data,
          report: parsedSource.report,
        }));
        await this.#saveStorage(storagePath, artifact);
        const persistedPreview = JSON.parse(JSON.stringify({
          revision: session.revision,
          storagePath,
          summary,
          response,
        }));
        try {
          await this.database.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(session.reference);
            const current = snapshot.exists ? snapshot.data() : null;
            if (!current || current.busyToken !== session.token || current.revision !== session.revision) {
              throw sessionError("Sessao de importacao ocupada", "BRASFOOT_IMPORT_SESSION_BUSY", 409);
            }
            transaction.update(session.reference, {
              preview: persistedPreview,
              updatedAt: this.#nowMs(),
            });
          });
        } catch (error) {
          await this.#deleteStorage(storagePath).catch((cleanupError) => this.#logError(cleanupError));
          throw error;
        }
        await this.#deleteStorage(session.preview?.storagePath).catch((error) => this.#logError(error));
        return structuredClone(response);
      });
    });
  }

  async #removeDistributed(session) {
    const files = await this.#distributedFiles(session.reference);
    await mapConcurrent(
      [...files.map((file) => file.storagePath), session.preview?.storagePath].filter(Boolean),
      DOWNLOAD_CONCURRENCY,
      (path) => this.#deleteStorage(path),
    );
    const batch = this.database.batch();
    for (const file of files) batch.delete(session.reference.collection("files").doc(file.id));
    batch.delete(session.reference);
    await batch.commit();
  }

  async #cleanupDistributed() {
    const nowMs = this.#nowMs();
    const snapshot = await this.database
      .collection(this.sessionCollection)
      .where("expiresAt", "<=", nowMs)
      .limit(25)
      .get();
    let removed = 0;
    for (const document of snapshot.docs) {
      const token = String(this.idFactory());
      const claimed = await this.database.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(document.ref);
        if (!currentSnapshot.exists) return null;
        const current = currentSnapshot.data();
        if (current.expiresAt > nowMs || (current.busyToken && current.busyUntil > nowMs)) return null;
        transaction.update(document.ref, {
          status: "cleanup",
          busyToken: token,
          busyUntil: nowMs + this.limits.ttlMs,
        });
        return { ...current, id: document.id, reference: document.ref, token };
      });
      if (!claimed) continue;
      try {
        await this.#removeDistributed(claimed);
        removed += 1;
      } catch (error) {
        this.#logError(error);
      }
    }
    return removed;
  }

  async #commitDistributed({ sessionId, ownerId, allowPartial, importAssets }) {
    const ownerLock = await this.#acquireOwnerLock(ownerId);
    let lease;
    let removed = false;
    try {
      lease = await this.#claimDistributed(sessionId, ownerId, "committing");
      const preview = lease.preview;
      if (!preview || preview.revision !== lease.revision) {
        throw sessionError(
          "Gere uma pre-visualizacao valida antes de importar",
          "BRASFOOT_IMPORT_PREVIEW_REQUIRED",
          409,
        );
      }
      const artifactBytes = await this.#downloadStorage(preview.storagePath);
      let artifact;
      try {
        artifact = JSON.parse(artifactBytes.toString("utf8"));
      } catch {
        throw sessionError(
          "Pre-visualizacao temporaria esta corrompida",
          "BRASFOOT_IMPORT_STORAGE_CORRUPT",
          503,
        );
      }
      if (artifact.revision !== lease.revision || !artifact.data || !artifact.report) {
        throw sessionError(
          "Pre-visualizacao temporaria esta desatualizada",
          "BRASFOOT_IMPORT_PREVIEW_REQUIRED",
          409,
        );
      }
      const errorCount = artifact.report.errors?.length ?? 0;
      if (errorCount > 0 && allowPartial !== true) {
        throw sessionError(
          "A pre-visualizacao contem erros; confirme a importacao parcial para continuar",
          "BRASFOOT_IMPORT_PARTIAL_CONFIRMATION_REQUIRED",
          409,
          { errors: errorCount },
        );
      }
      const files = await this.#distributedFiles(lease.reference);
      const response = await this.#materializeFiles(
        lease,
        files,
        async (directory) => {
          const target = this.databaseForOwner
            ? await this.databaseForOwner(ownerId)
            : this.database;
          const catalogStore = typeof target?.importBrasfootData === "function" ? target : null;
          const targetDatabase = catalogStore?.importLogFirestore ?? catalogStore?.firestore ?? target;
          if (!targetDatabase) {
            throw sessionError(
              "Firestore indisponivel para importacao",
              "BRASFOOT_IMPORT_FIRESTORE_UNAVAILABLE",
              503,
            );
          }
          const parsedSource = { report: structuredClone(artifact.report), assetRoot: directory };
          const result = await this.commitImport({
            database: targetDatabase,
            catalogStore,
            data: structuredClone(artifact.data),
            summary: structuredClone(preview.summary),
            parsedSource,
            options: {
              allowPartial: allowPartial === true,
              skipAssets: importAssets !== true,
              batchSize: 400,
            },
            mediaService: importAssets === true ? this.mediaService : null,
            runId: lease.id,
          });
          return {
            sessionId: lease.id,
            id: lease.id,
            runId: result.runId,
            generationId: result.generationId,
            summary: structuredClone(preview.summary),
            progress: result.progress,
            report: compactReport(parsedSource.report),
          };
        },
        { downloadFiles: importAssets === true },
      );
      await this.#removeDistributed(lease);
      removed = true;
      return response;
    } finally {
      if (lease && !removed) {
        await this.#releaseDistributed(lease, { touch: false }).catch((error) => this.#logError(error));
      }
      await this.#releaseOwnerLock(ownerLock).catch((error) => this.#logError(error));
    }
  }

  async createSession({ ownerId }) {
    if (!ownerId) throw sessionError("Editor responsavel nao identificado", "BRASFOOT_IMPORT_OWNER_REQUIRED", 400);
    this.#assertAvailable();
    if (this.storageMode === "firestore-storage") return this.#createDistributedSession(ownerId);
    const root = await this.#ensureRoot();
    let id;
    do id = String(this.idFactory()); while (this.sessions.has(id));
    const directory = resolve(root, id);
    if (!pathWithin(root, directory)) throw new Error("ID de sessao gerou caminho inseguro");
    await mkdir(directory, { recursive: false });
    const nowMs = this.#nowMs();
    const session = {
      id,
      ownerId: String(ownerId),
      directory,
      files: new Map(),
      totalBytes: 0,
      revision: 0,
      preview: null,
      busy: false,
      createdAt: nowMs,
      updatedAt: nowMs,
      expiresAt: nowMs + this.limits.ttlMs,
    };
    this.sessions.set(id, session);
    return {
      sessionId: id,
      id,
      createdAt: iso(session.createdAt),
      expiresAt: iso(session.expiresAt),
      limits: publicLimits(this.limits),
    };
  }

  async uploadFile({ sessionId, ownerId, path, bytes }) {
    const normalizedPath = normalizeBrasfootUploadPath(path);
    if (!Buffer.isBuffer(bytes)) {
      throw sessionError("Envie o arquivo como application/octet-stream", "BRASFOOT_IMPORT_BODY_INVALID", 415);
    }
    if (bytes.length === 0) {
      throw sessionError("O arquivo esta vazio", "BRASFOOT_IMPORT_FILE_EMPTY", 400);
    }
    if (bytes.length > this.limits.maxFileBytes) {
      throw sessionError(
        `Arquivo excede o limite de ${mebibytes(this.limits.maxFileBytes)} MB`,
        "BRASFOOT_IMPORT_FILE_TOO_LARGE",
        413,
        { maximumBytes: this.limits.maxFileBytes },
      );
    }
    this.#assertAvailable();
    if (this.storageMode === "firestore-storage") {
      return this.#uploadDistributed({ sessionId, ownerId, normalizedPath, bytes });
    }
    return this.#use(sessionId, ownerId, async (session) => {
      const previous = session.files.get(normalizedPath);
      const nextFileCount = session.files.size + (previous ? 0 : 1);
      const nextTotalBytes = session.totalBytes - (previous?.size ?? 0) + bytes.length;
      if (nextFileCount > this.limits.maxFiles) {
        throw sessionError(
          `Sessao excede o limite de ${this.limits.maxFiles} arquivos`,
          "BRASFOOT_IMPORT_TOO_MANY_FILES",
          413,
          { maximumFiles: this.limits.maxFiles },
        );
      }
      if (nextTotalBytes > this.limits.maxTotalBytes) {
        throw sessionError(
          `Sessao excede o limite total de ${mebibytes(this.limits.maxTotalBytes)} MB`,
          "BRASFOOT_IMPORT_TOTAL_TOO_LARGE",
          413,
          { maximumBytes: this.limits.maxTotalBytes },
        );
      }
      const target = resolve(session.directory, ...normalizedPath.split("/"));
      if (!pathWithin(session.directory, target)) {
        throw sessionError("Caminho de arquivo invalido", "BRASFOOT_IMPORT_PATH_INVALID", 400);
      }
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.upload-${randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { flag: "wx" });
      try {
        if (previous) await rm(target, { force: true });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
      const file = {
        path: normalizedPath,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      session.files.set(normalizedPath, file);
      session.totalBytes = nextTotalBytes;
      session.revision += 1;
      session.preview = null;
      return {
        sessionId: session.id,
        id: session.id,
        file,
        fileCount: session.files.size,
        totalBytes: session.totalBytes,
        previewValid: false,
      };
    });
  }

  async preview({ sessionId, ownerId }) {
    this.#assertAvailable();
    if (this.storageMode === "firestore-storage") {
      return this.#previewDistributed({ sessionId, ownerId });
    }
    return this.#use(sessionId, ownerId, async (session) => {
      const sourceFiles = [...session.files.keys()].filter((path) => [".ban", ".cfg"].includes(extname(path).toLowerCase()));
      if (sourceFiles.length === 0) {
        throw sessionError(
          "Envie ao menos um arquivo .ban ou .cfg",
          "BRASFOOT_IMPORT_SOURCE_REQUIRED",
          400,
        );
      }
      const parsedSource = await this.parseSource(session.directory, {
        maxFiles: this.limits.maxFiles,
        maxBytes: this.limits.maxFileBytes,
      });
      parsedSource.report.inputPath = `editor-session:${session.id}`;
      const data = this.normalize(parsedSource.dataset);
      const summary = summarizeDataset(data);
      const response = {
        sessionId: session.id,
        id: session.id,
        revision: session.revision,
        summary,
        report: compactReport(parsedSource.report),
        clubs: clubSample(data),
        files: fileSample(session),
        fileCount: session.files.size,
        totalBytes: session.totalBytes,
      };
      session.preview = { revision: session.revision, parsedSource, data, summary, response };
      return structuredClone(response);
    });
  }

  async commit({ sessionId, ownerId, allowPartial = false, importAssets = false }) {
    this.#assertAvailable();
    return this.#track(this.#commit({ sessionId, ownerId, allowPartial, importAssets }));
  }

  async #commit({ sessionId, ownerId, allowPartial = false, importAssets = false }) {
    if (this.storageMode === "firestore-storage") {
      return this.#commitDistributed({ sessionId, ownerId, allowPartial, importAssets });
    }
    const ownerKey = String(ownerId);
    if (this.ownerCommits.has(ownerKey)) {
      throw sessionError(
        "Ja existe uma importacao Brasfoot em andamento nesta base",
        "BRASFOOT_IMPORT_IN_PROGRESS",
        409,
      );
    }
    this.ownerCommits.add(ownerKey);
    let completed = false;
    try {
      const response = await this.#use(sessionId, ownerId, async (session) => {
        const preview = session.preview;
        if (!preview || preview.revision !== session.revision) {
          throw sessionError(
            "Gere uma pre-visualizacao valida antes de importar",
            "BRASFOOT_IMPORT_PREVIEW_REQUIRED",
            409,
          );
        }
        const errorCount = preview.parsedSource.report.errors?.length ?? 0;
        if (errorCount > 0 && allowPartial !== true) {
          throw sessionError(
            "A pre-visualizacao contem erros; confirme a importacao parcial para continuar",
            "BRASFOOT_IMPORT_PARTIAL_CONFIRMATION_REQUIRED",
            409,
            { errors: errorCount },
          );
        }
        const target = this.databaseForOwner
          ? await this.databaseForOwner(ownerId)
          : this.database;
        const catalogStore = typeof target?.importBrasfootData === "function" ? target : null;
        const targetDatabase = catalogStore?.importLogFirestore ?? catalogStore?.firestore ?? target;
        if (!targetDatabase) {
          throw sessionError(
            "Firestore indisponivel para importacao",
            "BRASFOOT_IMPORT_FIRESTORE_UNAVAILABLE",
            503,
          );
        }
        const data = structuredClone(preview.data);
        const parsedSource = {
          report: structuredClone(preview.parsedSource.report),
          assetRoot: preview.parsedSource.assetRoot,
        };
        const result = await this.commitImport({
          database: targetDatabase,
          catalogStore,
          data,
          summary: structuredClone(preview.summary),
          parsedSource,
          options: {
            allowPartial: allowPartial === true,
            skipAssets: importAssets !== true,
            batchSize: 400,
          },
          mediaService: importAssets === true ? this.mediaService : null,
          runId: session.id,
        });
        completed = true;
        return {
          sessionId: session.id,
          id: session.id,
          runId: result.runId,
          generationId: result.generationId,
          summary: structuredClone(preview.summary),
          progress: result.progress,
          report: compactReport(parsedSource.report),
        };
      });
      if (completed) {
        try {
          await this.#remove(sessionId);
        } catch (error) {
          this.#logError(error);
        }
      }
      return response;
    } finally {
      this.ownerCommits.delete(ownerKey);
    }
  }

  async #remove(sessionId) {
    const session = this.sessions.get(String(sessionId));
    if (!session) return false;
    this.sessions.delete(session.id);
    await rm(session.directory, { recursive: true, force: true });
    return true;
  }

  async deleteSession({ sessionId, ownerId }) {
    this.#assertAvailable();
    if (this.storageMode === "firestore-storage") {
      const lease = await this.#claimDistributed(sessionId, ownerId, "deleting");
      try {
        await this.#removeDistributed(lease);
      } catch (error) {
        await this.#releaseDistributed(lease, { touch: false }).catch((releaseError) => this.#logError(releaseError));
        throw error;
      }
      return { sessionId: lease.id, id: lease.id, deleted: true };
    }
    const session = await this.#find(sessionId, ownerId);
    if (session.busy) {
      throw sessionError("Sessao de importacao ocupada", "BRASFOOT_IMPORT_SESSION_BUSY", 409);
    }
    await this.#remove(session.id);
    return { sessionId: session.id, id: session.id, deleted: true };
  }

  async cleanupExpired() {
    if (this.storageMode === "firestore-storage") return this.#cleanupDistributed();
    if (this.storageMode === "unavailable") return 0;
    const nowMs = this.#nowMs();
    const expired = [...this.sessions.values()]
      .filter((session) => !session.busy && session.expiresAt <= nowMs)
      .map((session) => session.id);
    await Promise.all(expired.map((id) => this.#remove(id)));
    return expired.length;
  }

  async close() {
    if (!this.closePromise) {
      this.closed = true;
      if (this.cleanupTimer) clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this.closePromise = (async () => {
        await Promise.allSettled([...this.activeJobs]);
        this.sessions.clear();
        if (this.root) await rm(this.root, { recursive: true, force: true });
        this.root = null;
      })();
    }
    return this.closePromise;
  }
}

export function createBrasfootImportSessionService(options) {
  return new BrasfootImportSessionService(options);
}
