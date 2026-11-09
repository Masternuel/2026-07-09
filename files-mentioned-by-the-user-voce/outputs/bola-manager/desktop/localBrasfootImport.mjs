import { BrasfootImportSessionService } from "../server/services/brasfootImportSessions.mjs";
import { uploadBrasfootCrests } from "../scripts/import-brasfoot.mjs";

// Reuse the original parser, preview, quotas, safe paths and session cleanup.
// Only the final catalog publication changes from Firestore to the local transaction.
export function createLocalBrasfootImport({ catalog, mediaService, tempDirectory, logger }) {
  return new BrasfootImportSessionService({
    databaseForOwner: (uid) => {
      if (uid !== catalog.ownerId) throw Object.assign(new Error("Editor indisponivel para convidados"), { code: "EDITOR_FORBIDDEN", status: 403 });
      return catalog;
    },
    mediaService, tempDirectory, logger, allowLocalFallback: true,
    async commitImport({ ownerId, data, parsedSource, options, runId }) {
      const uploaded = [];
      try {
        if (!options.skipAssets && parsedSource.assetRoot) {
          const result = await uploadBrasfootCrests({ ownerId, clubs: data.clubs, assetRoot: parsedSource.assetRoot, mediaService, report: parsedSource.report, concurrency: 2 });
          uploaded.push(...result.uploadedMedia);
        }
        const result = await catalog.importBrasfootData({ data, runId });
        for (const previous of result.previousMedia ?? []) await mediaService.remove(previous.path, { ...previous, ownerId });
        return { runId, generationId: result.generationId, progress: { phase: "completed", collections: Object.fromEntries(["clubs", "players", "leagues", "cups"].map((entity) => [entity, { total: data[entity].length, committed: data[entity].length }])), assets: { uploaded: uploaded.length, failed: parsedSource.report.assets?.failed ?? 0 } } };
      } catch (error) {
        await Promise.allSettled(uploaded.map((asset) => mediaService.remove(asset.path, asset)));
        throw error;
      }
    },
  });
}
