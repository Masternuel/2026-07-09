#!/usr/bin/env node
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { initializeFirebaseAdmin } from "../server/config.mjs";
import { calculatePlayerOverall } from "../server/game/lineupStrength.mjs";
import { createMediaService } from "../server/services/mediaService.mjs";
import { commitCatalogGeneration } from "../server/store/catalogImportTransaction.mjs";
import { createGlobalCatalogGenerationFirestore } from "../server/store/catalogScope.mjs";
import { parseBrasfootSource } from "./lib/brasfoot-binary.mjs";

const attributeSchema = z.record(z.coerce.number().finite()).default({});
const playerPositionSchema = z.enum(["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"]);
const recordIdSchema = z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().trim().min(1).max(128).refine((value) => !value.includes("/"), "ID nao pode conter /"));
const clubSchema = z.object({
  id: recordIdSchema,
  name: z.string().trim().min(1),
  abbreviation: z.string().trim().max(8).optional(),
  colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i, "cor deve usar #RRGGBB")).max(4).default([]),
  stadium: z.string().default("A definir"),
  reputation: z.coerce.number().int().min(1).max(20).default(10),
  division: z.string().default("Sem divisão"),
  country: z.string().default("Brasil"),
  state: z.string().nullable().optional(),
}).passthrough();
const playerSchema = z.object({
  id: recordIdSchema,
  clubId: recordIdSchema,
  name: z.string().trim().min(1),
  position: playerPositionSchema,
  age: z.coerce.number().int().min(14).max(60),
  nationality: z.string().default("Brasil"),
  shirtNumber: z.coerce.number().int().min(0).max(99).nullable().optional(),
  overall: z.coerce.number().finite().optional(),
  attributes: attributeSchema,
  isStar: z.boolean().default(false),
}).passthrough();
const competitionSchema = z.object({
  id: recordIdSchema,
  name: z.string().trim().min(1),
}).passthrough();
const leagueSchema = competitionSchema.extend({
  country: z.string().trim().min(1).max(60).default("Brasil"),
  level: z.coerce.number().int().min(1).max(20).default(1),
  division: z.string().trim().min(1).max(60).default("Primeira divisao"),
  active: z.boolean().default(true),
});
const datasetSchema = z.object({
  version: z.string().default("1"),
  clubs: z.array(clubSchema).default([]),
  players: z.array(playerSchema).default([]),
  leagues: z.array(leagueSchema).default([]),
  cups: z.array(competitionSchema).default([]),
}).strict();

function parseArguments(argv) {
  const options = {
    dryRun: true, input: null, batchSize: 400, report: null, allowPartial: false, skipAssets: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--commit") options.dryRun = false;
    else if (argument === "--input") options.input = argv[++index];
    else if (argument === "--batch-size") options.batchSize = Number.parseInt(argv[++index], 10);
    else if (argument === "--report") options.report = argv[++index];
    else if (argument === "--allow-partial") options.allowPartial = true;
    else if (argument === "--skip-assets") options.skipAssets = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Argumento desconhecido: ${argument}`);
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 450) {
    throw new Error("--batch-size deve estar entre 1 e 450");
  }
  return options;
}

function helpText() {
  return [
    "Importador normalizado da base Brasfoot para o Bola Manager",
    "",
    "Uso:",
    "  node scripts/import-brasfoot.mjs --dry-run --input ./data/brasfoot-normalized.json",
    "  node scripts/import-brasfoot.mjs --dry-run --input C:/Brasfoot --report ./brasfoot-report.json",
    "  BRASFOOT_IMPORT_PROVIDED_KEY=... node scripts/import-brasfoot.mjs --commit --input ./data/brasfoot-normalized.json",
    "",
    "Aceita JSON normalizado, arquivo .ban/.cfg ou pasta raiz do Brasfoot.",
    "O JSON normalizado deve conter: version, clubs, players, leagues e cups.",
    "Dry-run e o padrao. --commit exige Firebase Admin e chave administrativa.",
    "Importacoes com arquivo corrompido nao fazem commit sem --allow-partial.",
    "No commit, escudos detectados sobem ao Storage; --skip-assets desativa essa etapa.",
    "Arquivos .dat nao sao suportados.",
  ].join("\n");
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const INTERNAL_ATTRIBUTE_MIN = 1;
const INTERNAL_ATTRIBUTE_MAX = 20;
const BRASFOOT_ATTRIBUTE_SCALE = 100;
const ATTRIBUTE_SCALE_DIVISOR = BRASFOOT_ATTRIBUTE_SCALE / INTERNAL_ATTRIBUTE_MAX;

const GOALKEEPER_ATTRIBUTES = ["reflexos", "posicionamentoGol", "saidaGol", "penaltis"];

function attributeProfile({ high = [], medium = [], low = [], veryLow = [] }) {
  return Object.freeze(Object.fromEntries([
    ...high.map((attribute) => [attribute, "high"]),
    ...medium.map((attribute) => [attribute, "medium"]),
    ...low.map((attribute) => [attribute, "low"]),
    ...veryLow.map((attribute) => [attribute, "veryLow"]),
  ]));
}

const fullbackProfile = attributeProfile({
  high: ["velocidade", "defesa", "passe", "resistencia"],
  medium: ["drible", "nocao", "peBom", "forca", "impulsao"],
  low: ["chute", "peRuim"],
  veryLow: GOALKEEPER_ATTRIBUTES,
});
const wingerProfile = attributeProfile({
  high: ["velocidade", "chute", "drible", "peBom"],
  medium: ["nocao", "passe", "forca", "resistencia", "impulsao"],
  low: ["defesa", "peRuim"],
  veryLow: GOALKEEPER_ATTRIBUTES,
});
const POSITION_ATTRIBUTE_TIERS = Object.freeze({
  GOL: attributeProfile({
    high: ["reflexos", "posicionamentoGol", "saidaGol"],
    medium: ["nocao", "passe", "peBom", "forca", "resistencia", "impulsao", "penaltis"],
    low: ["velocidade", "defesa", "peRuim"],
    veryLow: ["chute", "drible"],
  }),
  ZAG: attributeProfile({
    high: ["nocao", "defesa", "forca", "impulsao"],
    medium: ["velocidade", "passe", "peBom", "resistencia"],
    low: ["chute", "drible", "peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
  LD: fullbackProfile,
  LE: fullbackProfile,
  VOL: attributeProfile({
    high: ["nocao", "defesa", "passe", "forca", "resistencia"],
    medium: ["velocidade", "drible", "peBom", "impulsao"],
    low: ["chute", "peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
  MC: attributeProfile({
    high: ["nocao", "passe", "resistencia"],
    medium: ["velocidade", "chute", "drible", "defesa", "peBom", "forca", "impulsao"],
    low: ["peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
  MEI: attributeProfile({
    high: ["chute", "drible", "nocao", "passe", "peBom"],
    medium: ["velocidade", "forca", "resistencia", "impulsao"],
    low: ["defesa", "peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
  PD: wingerProfile,
  PE: wingerProfile,
  ATA: attributeProfile({
    high: ["chute", "drible", "nocao", "forca", "impulsao"],
    medium: ["velocidade", "passe", "peBom", "resistencia"],
    low: ["defesa", "peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
});

function usesBrasfootAttributeScale(player) {
  if (Number(player.attributeScale) === BRASFOOT_ATTRIBUTE_SCALE) return true;
  return [player.overall, ...Object.values(player.attributes)]
    .some((value) => Number.isFinite(Number(value)) && Number(value) > INTERNAL_ATTRIBUTE_MAX);
}

function toInternalAttribute(value, brasfootScale = false) {
  const numeric = Number(value);
  const scaled = brasfootScale ? numeric / ATTRIBUTE_SCALE_DIVISOR : numeric;
  return Math.max(
    INTERNAL_ATTRIBUTE_MIN,
    Math.min(INTERNAL_ATTRIBUTE_MAX, Math.round(scaled)),
  );
}

function generatedAttribute(player, attributeName, overall) {
  const variance = (hashText(`${player.name}|${player.position}|${attributeName}`) % 3) - 1;
  const tier = POSITION_ATTRIBUTE_TIERS[player.position]?.[attributeName] ?? "medium";
  const target = tier === "high"
    ? overall + 1
    : tier === "low"
      ? Math.round(overall * 0.5)
      : tier === "veryLow"
        ? Math.round(overall * 0.25)
        : overall - 1;
  return Math.max(1, Math.min(20, target + variance));
}

function ageFactor(age) {
  if (age <= 21) return 1.25;
  if (age <= 29) return 1.1;
  if (age <= 32) return 0.85;
  return 0.6;
}

export function normalizeDataset(rawData) {
  const parsed = datasetSchema.parse(rawData);
  for (const [label, records] of [
    ["clubes", parsed.clubs],
    ["jogadores", parsed.players],
    ["ligas", parsed.leagues],
    ["copas", parsed.cups],
  ]) {
    const ids = new Set();
    for (const record of records) {
      const comparisonId = record.id.toLocaleUpperCase("pt-BR");
      if (ids.has(comparisonId)) throw new Error(`ID duplicado em ${label}: ${record.id}`);
      ids.add(comparisonId);
    }
  }
  const clubsById = new Map(parsed.clubs.map((club) => [club.id, club]));
  for (const player of parsed.players) {
    if (!clubsById.has(player.clubId)) {
      throw new Error(`Jogador ${player.id} referencia clube inexistente: ${player.clubId}`);
    }
  }
  const requiredAttributes = [
    "velocidade", "chute", "drible", "nocao", "defesa", "passe", "peBom", "peRuim",
    "forca", "resistencia", "impulsao", "reflexos", "posicionamentoGol", "saidaGol", "penaltis",
  ];
  const players = parsed.players.map((player) => {
    const brasfootScale = usesBrasfootAttributeScale(player);
    const { attributeScale: _sourceAttributeScale, ...normalizedPlayer } = player;
    const sourceValues = Object.values(player.attributes)
      .map((value) => toInternalAttribute(value, brasfootScale));
    const sourceOverall = player.overall == null
      ? sourceValues.reduce((sum, value) => sum + value, 0) / Math.max(1, sourceValues.length)
      : toInternalAttribute(player.overall, brasfootScale);
    const seedOverall = Math.max(1, Math.min(20, Math.round(sourceOverall || 10)));
    const attributes = Object.fromEntries(requiredAttributes.map((key) => [
      key,
      player.attributes[key] == null
        ? generatedAttribute(player, key, seedOverall)
        : toInternalAttribute(player.attributes[key], brasfootScale),
    ]));
    const overall = calculatePlayerOverall({ position: player.position, attributes }, seedOverall);
    const stars = Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, Math.ceil(value / 2)]));
    const clubReputation = clubsById.get(player.clubId)?.reputation ?? 10;
    const marketValue = Math.round(overall * ageFactor(player.age) * clubReputation * 100_000);
    return { ...normalizedPlayer, overall, attributes, stars, marketValue };
  });
  return { ...parsed, players };
}

function summarize(data) {
  const clubIds = new Set(data.clubs.map((club) => club.id));
  const playersWithoutClub = data.players.filter((player) => !clubIds.has(player.clubId));
  return {
    version: data.version,
    clubs: data.clubs.length,
    players: data.players.length,
    leagues: data.leagues.length,
    cups: data.cups.length,
    playersWithoutClub: playersWithoutClub.length,
  };
}

export async function secureAssetPath(assetRoot, relativePath) {
  const root = resolve(assetRoot);
  const target = resolve(root, String(relativePath));
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Caminho de escudo fora da origem Brasfoot");
  const pathParts = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const part of [null, ...pathParts]) {
    if (part != null) current = resolve(current, part);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error("Escudo nao pode atravessar link simbolico ou junction");
  }
  const targetMetadata = await lstat(target);
  if (!targetMetadata.isFile()) throw new Error("Escudo precisa ser um arquivo regular");
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`)) {
    throw new Error("Caminho real do escudo sai da origem Brasfoot");
  }
  return realTarget;
}

export async function uploadBrasfootCrests({ clubs, assetRoot, mediaService, report, concurrency = 6 }) {
  const withCrest = clubs.filter((club) => club.assets?.shield);
  report.assets.uploaded ??= 0;
  report.assets.failed ??= 0;
  report.assets.uploadSkipped ??= 0;
  report.assets.uploadFailures ??= [];
  const uploadedMedia = [];
  let cursor = 0;
  async function worker() {
    while (cursor < withCrest.length) {
      const club = withCrest[cursor++];
      try {
        const bytes = await readFile(await secureAssetPath(assetRoot, club.assets.shield));
        const media = await mediaService.upload({
          entity: "clubs",
          recordId: club.id,
          kind: "crest",
          mimeType: "image/png",
          bytes,
          uploadedBy: "brasfoot-import",
        });
        club.crestImageUrl = media.url;
        club.crestImagePath = media.path;
        uploadedMedia.push({ ...media, recordId: String(club.id) });
        report.assets.uploaded += 1;
      } catch (error) {
        report.assets.failed += 1;
        const failure = { clubId: club.id, file: club.assets.shield, message: error.message };
        report.assets.uploadFailures.push(failure);
        report.warnings.push({ code: "CREST_UPLOAD_FAILED", ...failure });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, withCrest.length || 1)) }, worker));
  return { uploaded: report.assets.uploaded, failed: report.assets.failed, uploadedMedia };
}

async function cleanupUploadedAssets(mediaService, uploadedMedia, report) {
  report.assets.cleanedUp ??= 0;
  report.assets.cleanupFailed ??= 0;
  report.assets.cleanupFailures ??= [];
  if (!mediaService || typeof mediaService.remove !== "function") return;
  await Promise.all(uploadedMedia.map(async (media) => {
    try {
      await mediaService.remove(media.path);
      report.assets.cleanedUp += 1;
    } catch (error) {
      report.assets.cleanupFailed += 1;
      const failure = { path: media.path, message: error.message };
      report.assets.cleanupFailures.push(failure);
      report.warnings.push({ code: "CREST_CLEANUP_FAILED", ...failure });
    }
  }));
}

function normalizedJsonReport(inputPath, summary) {
  return {
    sourceFormat: "normalized-json",
    inputPath,
    scanned: { json: 1 },
    success: {
      clubs: summary.clubs,
      players: summary.players,
      leagues: summary.leagues,
      cups: summary.cups,
    },
    errors: [],
    warnings: [],
    duplicates: { clubs: [], clubNames: [], players: [], leagues: [] },
    corrupted: [],
    assets: { shieldsFound: 0, shieldsMissing: 0, miniShieldsFound: 0, shirtsFound: 0 },
  };
}

function compactReport(report) {
  return {
    sourceFormat: report.sourceFormat,
    success: report.success,
    errors: report.errors.length,
    warnings: report.warnings.length,
    corrupted: report.corrupted.length,
    duplicateClubIds: report.duplicates?.clubs?.length ?? 0,
    duplicateClubNames: report.duplicates?.clubNames?.length ?? 0,
    assets: {
      uploaded: report.assets?.uploaded ?? 0,
      failed: report.assets?.failed ?? 0,
      cleanedUp: report.assets?.cleanedUp ?? 0,
      cleanupFailed: report.assets?.cleanupFailed ?? 0,
      preserved: report.assets?.preserved ?? 0,
    },
  };
}

export async function executeImportCommit({
  database,
  catalogStore = null,
  data,
  summary,
  parsedSource,
  options = {},
  mediaService = null,
  runId = randomUUID(),
  now = () => new Date().toISOString(),
}) {
  const report = parsedSource.report;
  const batchSize = options.batchSize ?? 400;
  const runReference = database.collection("brasfootImports").doc(runId);
  const currentReference = database.collection("brasfootImports").doc("current");
  const collectionPlan = [
    ["clubs", "brasfootClubs", data.clubs],
    ["players", "brasfootPlayers", data.players],
    ["leagues", "brasfootLeagues", data.leagues],
    ["cups", "brasfootCups", data.cups],
  ];
  const progress = {
    phase: "starting",
    collections: Object.fromEntries(collectionPlan.map(([name, , records]) => [name, {
      total: records.length,
      committed: 0,
    }])),
    assets: { detected: data.clubs.filter((club) => club.assets?.shield).length, uploaded: 0, failed: 0, cleanedUp: 0 },
  };
  let uploadedMedia = [];
  let activated = false;
  const startedAt = now();
  report.commit = { runId, status: "running", startedAt, progress };

  async function persistProgress(phase) {
    progress.phase = phase;
    report.commit.progress = progress;
    await runReference.set({ status: "running", progress, updatedAt: now() }, { merge: true });
  }

  try {
    await runReference.set({
      runId,
      status: "running",
      startedAt,
      updatedAt: startedAt,
      inputPath: parsedSource.report.inputPath,
      version: data.version,
      summary,
      progress,
    });
    if (parsedSource.assetRoot) {
      const detectedCrests = progress.assets.detected;
      if (options.skipAssets) {
        report.assets.uploadSkipped = detectedCrests;
        report.warnings.push({
          code: "CREST_UPLOAD_SKIPPED",
          message: `Upload de ${detectedCrests} escudo(s) desativado por --skip-assets`,
        });
      } else if (!mediaService) {
        report.assets.uploadSkipped = detectedCrests;
        report.warnings.push({
          code: "CREST_STORAGE_UNAVAILABLE",
          message: `Armazenamento de imagens nao configurado; ${detectedCrests} escudo(s) nao foram enviados`,
        });
      } else {
        await persistProgress("uploading-assets");
        const upload = await uploadBrasfootCrests({
          clubs: data.clubs,
          assetRoot: parsedSource.assetRoot,
          mediaService,
          report,
        });
        uploadedMedia = upload.uploadedMedia;
        progress.assets.uploaded = upload.uploaded;
        progress.assets.failed = upload.failed;
      }
    }

    await persistProgress("staging");
    const namesByCollection = new Map(collectionPlan.map(([name, collectionName]) => [collectionName, name]));
    const atomicResult = catalogStore?.importBrasfootData
      ? await catalogStore.importBrasfootData({
        data,
        runId,
        batchSize,
        onProgress: async (collectionName, committed) => {
          const name = namesByCollection.get(collectionName);
          if (!name) return;
          progress.collections[name].committed = committed;
          await persistProgress(`staging-${name}`);
        },
      })
        : await (async () => {
        return commitCatalogGeneration({
          rootFirestore: database,
          metadataReference: currentReference,
          sourceFirestoreForGeneration: (generationId) => generationId
            ? createGlobalCatalogGenerationFirestore(database, generationId)
            : database,
          generationFirestoreForId: (generationId) => (
            createGlobalCatalogGenerationFirestore(database, generationId)
          ),
          collectionPlan: [
            ...collectionPlan.map(([, collectionName, records]) => ({ collectionName, records })),
            { collectionName: "tournaments", records: [] },
          ],
          runId,
          batchSize,
          now,
          onProgress: async (collectionName, committed) => {
            const name = namesByCollection.get(collectionName);
            if (!name) return;
            progress.collections[name].committed = committed;
            await persistProgress(`staging-${name}`);
          },
        });
      })();
    activated = true;
    if (atomicResult.idempotent && uploadedMedia.length > 0) {
      await cleanupUploadedAssets(mediaService, uploadedMedia, report);
      progress.assets.cleanedUp = report.assets.cleanedUp ?? 0;
      progress.assets.cleanupFailed = report.assets.cleanupFailed ?? 0;
    }

    const completedAt = now();
    progress.phase = "completed";
    report.commit = {
      runId,
      status: "completed",
      startedAt,
      completedAt,
      generationId: atomicResult.generationId,
      progress,
    };
    try {
      await runReference.set({
        status: "completed",
        completedAt,
        updatedAt: completedAt,
        generationId: atomicResult.generationId,
        progress,
        report: compactReport(report),
      }, { merge: true });
      await currentReference.set({
        runId,
        status: "completed",
        version: data.version,
        importedAt: completedAt,
        summary,
      }, { merge: true });
    } catch (statusError) {
      report.warnings.push({ code: "IMPORT_STATUS_WRITE_FAILED", message: statusError.message });
    }
    return { runId, generationId: atomicResult.generationId, progress };
  } catch (error) {
    if (activated) throw error;
    if (error?.code === "BRASFOOT_IMPORT_COMMIT_UNCERTAIN"
      && error?.details?.stagingPreserved === true) {
      const uncertainAt = now();
      report.assets.preserved = uploadedMedia.length;
      progress.phase = "uncertain";
      progress.assets.preserved = uploadedMedia.length;
      report.commit = {
        runId,
        status: "uncertain",
        startedAt,
        failedAt: uncertainAt,
        error: error.message,
        progress,
      };
      try {
        await runReference.set({
          status: "uncertain",
          updatedAt: uncertainAt,
          error: error.message,
          progress,
          report: compactReport(report),
        }, { merge: true });
      } catch (statusError) {
        report.warnings.push({ code: "IMPORT_STATUS_WRITE_FAILED", message: statusError.message });
      }
      throw error;
    }
    report.assets.preserved = 0;
    await cleanupUploadedAssets(mediaService, uploadedMedia, report);
    progress.phase = "failed";
    progress.assets.cleanedUp = report.assets.cleanedUp ?? 0;
    progress.assets.cleanupFailed = report.assets.cleanupFailed ?? 0;
    progress.assets.preserved = 0;
    const failedAt = now();
    report.commit = {
      runId,
      status: "failed",
      startedAt,
      failedAt,
      error: error.message,
      progress,
    };
    try {
      await runReference.set({
        status: "failed",
        failedAt,
        updatedAt: failedAt,
        error: error.message,
        progress,
        report: compactReport(report),
      }, { merge: true });
    } catch (statusError) {
      report.warnings.push({ code: "IMPORT_STATUS_WRITE_FAILED", message: statusError.message });
    }
    throw error;
  }
}

function assertAdminAuthorization(env) {
  const expected = env.BRASFOOT_IMPORT_ADMIN_KEY;
  const provided = env.BRASFOOT_IMPORT_PROVIDED_KEY;
  if (!expected || !provided) {
    throw new Error("Importacao exige BRASFOOT_IMPORT_ADMIN_KEY e BRASFOOT_IMPORT_PROVIDED_KEY");
  }
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
    throw new Error("Chave administrativa de importacao invalida");
  }
}

export async function runImport(options, env = process.env) {
  let inputPath = options.input ? resolve(options.input) : null;
  let parsedSource = null;
  let finalReport = null;
  let caughtError = null;
  try {
    if (!inputPath) throw new Error("Informe o arquivo com --input CAMINHO");
    if (extname(inputPath).toLowerCase() === ".dat") {
      throw new Error("Arquivos .dat nao sao suportados: forneca JSON normalizado ou uma pasta Brasfoot com .ban/.cfg");
    }
    const isNormalizedJson = extname(inputPath).toLowerCase() === ".json";
    parsedSource = isNormalizedJson
      ? { dataset: JSON.parse(await readFile(inputPath, "utf8")), report: null, assetRoot: null }
      : await parseBrasfootSource(inputPath, options.parserOptions);
    const data = normalizeDataset(parsedSource.dataset);
    const summary = summarize(data);
    finalReport = parsedSource.report ?? normalizedJsonReport(inputPath, summary);
    parsedSource.report = finalReport;
    finalReport.success = {
      ...finalReport.success,
      clubs: summary.clubs,
      players: summary.players,
      leagues: summary.leagues,
      cups: summary.cups,
    };
    const result = {
      mode: options.dryRun ? "dry-run" : "import",
      inputPath,
      summary,
      report: finalReport,
      ...(options.report ? { reportPath: resolve(options.report) } : {}),
    };
    if (options.dryRun) {
      finalReport.commit = { status: "dry-run" };
      return result;
    }
    if (finalReport.errors.length > 0 && !options.allowPartial) {
      throw new Error(`Importacao contem ${finalReport.errors.length} erro(s); corrija a origem ou use --allow-partial`);
    }

    assertAdminAuthorization(env);
    const firebase = await initializeFirebaseAdmin(env);
    if (!firebase.enabled) throw new Error(`Firebase Admin indisponivel: ${firebase.reason}`);
    const database = firebase.firestore ?? (await import("firebase-admin/firestore")).getFirestore(firebase.app);
    const configuredMediaService = createMediaService({ env, bucket: firebase.bucket });
    const mediaService = configuredMediaService.configured ? configuredMediaService : null;
    const commit = await executeImportCommit({
      database,
      data,
      summary,
      parsedSource,
      options,
      mediaService,
      runId: options.runId,
      now: options.now,
    });
    result.runId = commit.runId;
    return result;
  } catch (error) {
    caughtError = error;
    finalReport ??= {
      sourceFormat: "unknown",
      inputPath,
      success: {},
      errors: [],
      warnings: [],
      duplicates: { clubs: [], clubNames: [], players: [], leagues: [] },
      corrupted: [],
      assets: {},
    };
    if (!finalReport.commit || finalReport.commit.status === "dry-run") {
      finalReport.commit = { status: "failed", failedAt: new Date().toISOString(), error: error.message };
    }
    throw error;
  } finally {
    if (options.report) {
      try {
        await writeFile(resolve(options.report), `${JSON.stringify(finalReport ?? {
          sourceFormat: "unknown",
          inputPath,
          commit: { status: caughtError ? "failed" : "unknown", error: caughtError?.message },
        }, null, 2)}\n`, "utf8");
      } catch (reportError) {
        if (!caughtError) throw reportError;
      }
    }
  }
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(helpText());
    else console.log(JSON.stringify(await runImport(options), null, 2));
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Dataset inválido:", error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}
