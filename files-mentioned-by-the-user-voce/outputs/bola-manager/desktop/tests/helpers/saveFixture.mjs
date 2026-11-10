import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStarterCatalog } from "../../localCatalog.mjs";
import { openLocalDatabase } from "../../localDatabase.mjs";

// Frozen save fixtures guard the v8.serialize format across Electron/V8 upgrades (audit S-09).
// Content is fictional and deterministic; never build fixtures from a real player's save.

const at = (iso) => new Date(iso);

export function buildFixtureState() {
  const starter = createStarterCatalog();
  const clubs = starter.clubs.slice(0, 4);
  const clubIds = new Set(clubs.map((club) => club.id));
  return {
    profile: { uid: "local-fixture-0001", displayName: "Manager Fixture", preferences: { theme: "dark", musicVolume: 0.35, language: "pt-BR" } },
    catalog: { ...starter, clubs, players: starter.players.filter((player) => clubIds.has(player.clubId)) },
    rooms: {
      rooms: [{
        code: "FIXT01", name: "Carreira de teste — São João ⚽", ownerId: "local-fixture-0001",
        createdAt: at("2026-01-15T12:00:00.000Z"), managers: [{ uid: "local-fixture-0001", clubId: clubs[0].id, ready: true }],
        season: 2, round: 7, budget: 12_345_678.9, notes: undefined, tags: ["offline", "fixture"],
      }],
      deletedCodes: ["OLD001"], creationReceipts: [], history: [{ code: "FIXT01", event: "created", at: at("2026-01-15T12:00:00.000Z") }],
    },
    matches: [{
      id: "match-fixture-1", roomCode: "FIXT01", homeClubId: clubs[0].id, awayClubId: clubs[1].id,
      score: { home: 2, away: 1 }, playedAt: at("2026-02-01T20:30:00.000Z"),
      events: [{ minute: 12, type: "goal", side: "home" }, { minute: 58, type: "goal", side: "away" }, { minute: 90, type: "goal", side: "home" }],
      ratings: { 1: 7.5, extra: Number.NaN, big: Number.MAX_SAFE_INTEGER, tiny: -0 },
    }],
    news: { posts: [{ id: "post-1", text: "Acentuação çãéü, emoji 🏆 e aspas “curvas”.", createdAt: at("2026-02-02T09:00:00.000Z") }], operations: [] },
  };
}

/** Type-tagged canonical form, so Date, undefined, NaN and -0 survive in the digest. */
export function canonical(value) {
  if (value === undefined) return { $: "undefined" };
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $: "NaN" };
    if (Object.is(value, -0)) return { $: "-0" };
    if (!Number.isFinite(value)) return { $: String(value) };
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return { $: "Date", v: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonical);
  const tag = Object.prototype.toString.call(value);
  if (tag !== "[object Object]") throw new Error(`Tipo nao suportado no fixture: ${tag}`);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export const stateDigest = (state) => createHash("sha256").update(JSON.stringify(canonical(state))).digest("hex");
export const fileDigest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Opens a copy of the fixture through the real database code and reports what it read. */
export async function readSaveFixture(fixturePath) {
  const directory = await mkdtemp(join(tmpdir(), "bola-save-fixture-"));
  try {
    const savePath = join(directory, "career.bolasave");
    await copyFile(fixturePath, savePath);
    const before = fileDigest(await readFile(savePath));
    const database = await openLocalDatabase(directory, undefined);
    let state;
    try { state = await database.read((value) => value); } finally { await database.close(); }
    const after = fileDigest(await readFile(savePath));
    return {
      digest: stateDigest(state), uid: state.profile.uid, unchanged: before === after,
      runtime: { node: process.versions.node, v8: process.versions.v8, electron: process.versions.electron ?? null },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
