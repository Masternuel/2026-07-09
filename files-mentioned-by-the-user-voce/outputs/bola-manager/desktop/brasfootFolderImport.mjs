// Desktop-only Brasfoot import straight from the installed Brasfoot folder (no upload
// limits): the player chooses countries, clubs keep their real divisions, and the crests
// from teams/escudos are stored as local media in the same transaction as the catalog.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseBrasfootSource } from "../server/import/brasfoot/binary.mjs";
import { normalizeDataset, secureAssetPath } from "../server/import/brasfoot/importer.mjs";
import { createCatalogDatabasePackage } from "../server/services/catalogDatabase.mjs";
import { prepareCatalogMedia } from "../server/services/catalogMedia.mjs";
import { mediaHash, mediaScope } from "../server/services/mediaOwnership.mjs";
import { catalogCounts, preserveCareerCatalog } from "./catalogImport.mjs";

export const BRASFOOT_FOLDER_PREVIEW_TTL_MS = 15 * 60_000;
export const BRASFOOT_FOLDER_LIMITS = Object.freeze({ clubs: 5_000, players: 100_000 });
const LOCAL_MEDIA_PREFIX = "http://127.0.0.1/desktop-media/";
const CREST_CONCURRENCY = 3;

const fail = (code) => { throw Object.assign(new Error("Importacao do Brasfoot indisponivel. A base anterior foi preservada."), { code }); };

export async function prepareBrasfootFolder(path, { now = Date.now(), parse = parseBrasfootSource } = {}) {
  if (typeof path !== "string" || !path.trim()) fail("BRASFOOT_FOLDER_INVALID");
  let parsed;
  try { parsed = await parse(path); } catch { fail("BRASFOOT_FOLDER_INVALID"); }
  const { dataset, report, assetRoot } = parsed;
  if (!dataset.clubs.length || !dataset.leagues.length) fail("BRASFOOT_FOLDER_EMPTY");
  const data = normalizeDataset(dataset);
  return { id: randomUUID(), data, assetRoot, errors: report.errors?.length ?? 0, expiresAt: now + BRASFOOT_FOLDER_PREVIEW_TTL_MS };
}

// Only clubs placed in a national division are offered: they are what a career can use.
export function brasfootCountries(data) {
  const countries = new Map();
  const leagueCountry = new Map(data.leagues.map((league) => [league.id, league.country]));
  const clubCountry = new Map();
  for (const club of data.clubs) {
    const country = club.leagueId ? leagueCountry.get(club.leagueId) : null;
    if (!country) continue;
    clubCountry.set(club.id, country);
    const entry = countries.get(country) ?? { country, leagues: new Set(), clubs: 0, players: 0, crests: 0 };
    entry.leagues.add(club.leagueId);
    entry.clubs += 1;
    if (club.assets?.shield) entry.crests += 1;
    countries.set(country, entry);
  }
  for (const player of data.players) {
    const country = clubCountry.get(player.clubId);
    if (country) countries.get(country).players += 1;
  }
  return [...countries.values()]
    .map((entry) => ({ ...entry, leagues: entry.leagues.size }))
    .sort((left, right) => right.clubs - left.clubs || left.country.localeCompare(right.country));
}

export function previewBrasfootFolder(candidate) {
  return { id: candidate.id, countries: brasfootCountries(candidate.data), limits: BRASFOOT_FOLDER_LIMITS,
    errors: candidate.errors, expiresAt: new Date(candidate.expiresAt).toISOString() };
}

function withoutSourceFields(record) {
  const { brasfootRaw: _raw, assets: _assets, source: _source, ...rest } = record;
  return rest;
}

export function selectBrasfootRecords(data, countries) {
  const selected = new Set(Array.isArray(countries) ? countries.filter((item) => typeof item === "string") : []);
  if (!selected.size) fail("BRASFOOT_FOLDER_NOTHING_SELECTED");
  const clubs = data.clubs.filter((club) => club.leagueId && selected.has(data.leagues.find((league) => league.id === club.leagueId)?.country));
  const leagueIds = new Set(clubs.map((club) => club.leagueId));
  const leagues = data.leagues.filter((league) => leagueIds.has(league.id));
  const clubIds = new Set(clubs.map((club) => club.id));
  const players = data.players.filter((player) => clubIds.has(player.clubId));
  if (!clubs.length) fail("BRASFOOT_FOLDER_NOTHING_SELECTED");
  if (clubs.length > BRASFOOT_FOLDER_LIMITS.clubs || players.length > BRASFOOT_FOLDER_LIMITS.players) fail("BRASFOOT_FOLDER_TOO_LARGE");
  return { leagues, clubs, players };
}

async function loadCrests(clubs, assetRoot, ownerId, prepare = prepareCatalogMedia) {
  const crests = new Map();
  let failed = 0;
  const queue = clubs.filter((club) => club.assets?.shield);
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const club = queue[cursor++];
      try {
        const bytes = await readFile(await secureAssetPath(assetRoot, club.assets.shield));
        const prepared = await prepare("image/png", bytes);
        const id = randomUUID();
        const path = `editor-media/clubs/v2/${mediaHash(ownerId)}/${mediaHash(club.id)}/${id}.${prepared.mediaType.extension}`;
        crests.set(club.id, { id, path, asset: { ...mediaScope({ ownerId, entity: "clubs", recordId: club.id }), id, mimeType: prepared.mimeType, bytes: prepared.bytes } });
      } catch { failed += 1; }
    }
  }
  await Promise.all(Array.from({ length: CREST_CONCURRENCY }, worker));
  return { crests, failed };
}

export async function commitBrasfootFolder(database, candidate, countries, { now = Date.now(), prepare } = {}) {
  if (!candidate || now >= candidate.expiresAt) fail("LOCAL_IMPORT_EXPIRED");
  const selection = selectBrasfootRecords(candidate.data, countries);
  const ownerId = await database.read((state) => state.profile.uid);
  const { crests, failed } = await loadCrests(selection.clubs, candidate.assetRoot, ownerId, prepare);
  const { records } = createCatalogDatabasePackage({
    leagues: selection.leagues.map(withoutSourceFields),
    clubs: selection.clubs.map(withoutSourceFields),
    players: selection.players.map(withoutSourceFields),
    tournaments: [],
  });
  for (const club of records.clubs) {
    const crest = crests.get(club.id);
    if (crest) { club.crestImageUrl = `${LOCAL_MEDIA_PREFIX}${crest.id}`; club.crestImagePath = crest.path; }
  }
  const digest = createHash("sha256").update(JSON.stringify(records)).digest("hex");
  return database.transaction((state, { backupFile }) => {
    const preservedCareers = preserveCareerCatalog(state);
    state.catalog = records;
    state.catalogMedia ??= {};
    for (const crest of crests.values()) state.catalogMedia[crest.path] = crest.asset;
    state.catalogImport = { importedAt: new Date(now).toISOString(), digest, backupFile, source: "brasfoot-folder", countries: [...new Set(countries)] };
    return { counts: catalogCounts(records), preservedCareers, crests: crests.size, crestsFailed: failed, backupFile };
  }, { backup: true });
}
