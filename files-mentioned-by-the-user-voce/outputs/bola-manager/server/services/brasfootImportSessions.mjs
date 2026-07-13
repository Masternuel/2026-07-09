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

export class BrasfootImportSessionService {
  constructor({
    database = null,
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
  } = {}) {
    this.database = database;
    this.mediaService = mediaService;
    this.logger = logger;
    this.tempDirectory = resolve(tempDirectory);
    this.limits = Object.freeze({ ...BRASFOOT_IMPORT_LIMITS, ...limits });
    this.now = now;
    this.idFactory = idFactory;
    this.parseSource = parseSource;
    this.normalize = normalize;
    this.commitImport = commitImport;
    this.sessions = new Map();
    this.root = null;
    this.closed = false;
    this.cleanupTimer = null;
    if (scheduleCleanup) {
      const interval = Math.max(1_000, Math.min(60_000, this.limits.ttlMs));
      this.cleanupTimer = setInterval(() => {
        void this.cleanupExpired().catch((error) => this.#logError(error));
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

  async #ensureRoot() {
    if (this.closed) throw sessionError("Servico de importacao encerrado", "BRASFOOT_IMPORT_CLOSED", 503);
    if (!this.root) {
      await mkdir(this.tempDirectory, { recursive: true });
      this.root = await mkdtemp(join(this.tempDirectory, "bola-manager-brasfoot-"));
    }
    return this.root;
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

  async createSession({ ownerId }) {
    if (!ownerId) throw sessionError("Editor responsavel nao identificado", "BRASFOOT_IMPORT_OWNER_REQUIRED", 400);
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
    let completed = false;
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
      if (!this.database) {
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
        database: this.database,
        data,
        summary: structuredClone(preview.summary),
        parsedSource,
        options: {
          allowPartial: allowPartial === true,
          skipAssets: importAssets !== true,
          batchSize: 400,
        },
        mediaService: importAssets === true ? this.mediaService : null,
      });
      completed = true;
      return {
        sessionId: session.id,
        id: session.id,
        runId: result.runId,
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
  }

  async #remove(sessionId) {
    const session = this.sessions.get(String(sessionId));
    if (!session) return false;
    this.sessions.delete(session.id);
    await rm(session.directory, { recursive: true, force: true });
    return true;
  }

  async deleteSession({ sessionId, ownerId }) {
    const session = await this.#find(sessionId, ownerId);
    if (session.busy) {
      throw sessionError("Sessao de importacao ocupada", "BRASFOOT_IMPORT_SESSION_BUSY", 409);
    }
    await this.#remove(session.id);
    return { sessionId: session.id, id: session.id, deleted: true };
  }

  async cleanupExpired() {
    const nowMs = this.#nowMs();
    const expired = [...this.sessions.values()]
      .filter((session) => !session.busy && session.expiresAt <= nowMs)
      .map((session) => session.id);
    await Promise.all(expired.map((id) => this.#remove(id)));
    return expired.length;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    this.sessions.clear();
    if (this.root) await rm(this.root, { recursive: true, force: true });
    this.root = null;
  }
}

export function createBrasfootImportSessionService(options) {
  return new BrasfootImportSessionService(options);
}
