// Optional real-club database shipped inside the installer (desktop/data/base-brasil.json,
// produced by `npm run catalog:update -- --bundle`). The file is gitignored: it is generated
// locally from API-Football and only exists in builds made from a machine that has it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_CATALOG_DATABASE_BYTES, parseCatalogDatabase } from "../server/services/catalogDatabase.mjs";

export const BUNDLED_CATALOG_RELATIVE_PATH = join("desktop", "data", "base-brasil.json");

export function readBundledCatalogBytes(path) {
  if (!path) return null;
  try {
    const bytes = readFileSync(path);
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_CATALOG_DATABASE_BYTES ? bytes : null;
  } catch { return null; }
}

// Validated records, or null when the build has no (valid) bundled database.
export function loadBundledCatalog(path, logger = console) {
  const bytes = readBundledCatalogBytes(path);
  if (!bytes) return null;
  try {
    const { records } = parseCatalogDatabase(JSON.parse(bytes.toString("utf8")));
    if (!records.leagues.length || !records.clubs.length || !records.players.length) return null;
    return { ...records, tournaments: records.tournaments ?? [] };
  } catch (error) {
    logger.warn?.(`Base incluida invalida; usando a base inicial: ${error.message}`);
    return null;
  }
}
