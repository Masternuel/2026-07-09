export const STAR_MATCH_STRENGTH_PER_PLAYER = 0.25;
export const STAR_MATCH_STRENGTH_CAP = 1;
export const STAR_SPONSOR_PERCENT_PER_PLAYER = 5;
export const STAR_SPONSOR_PERCENT_CAP = 25;
export const STAR_ANNUAL_BONUS_PER_PLAYER = 2_500_000;
export const STAR_ANNUAL_BONUS_CAP = 12_500_000;

function normalizedClubId(value) {
  return String(value ?? "").trim();
}

function capped(value, maximum) {
  return Math.min(maximum, Math.max(0, value));
}

function numericOverall(player) {
  const value = Number(player?.overall);
  return Number.isFinite(value) ? value : 0;
}

export function sortPlayersForSelection(players = []) {
  return [...players].sort((left, right) => (
    numericOverall(right) - numericOverall(left)
    || String(left?.name ?? left?.id).localeCompare(String(right?.name ?? right?.id), "pt-BR")
    || String(left?.id).localeCompare(String(right?.id), "pt-BR")
  ));
}

function playerSummary(player) {
  return { id: String(player.id), name: String(player.name ?? player.id) };
}

export function isPlayerAvailableForMatch(player) {
  if (!player) return false;
  const status = String(player?.status ?? "").trim().toLocaleLowerCase("pt-BR");
  return player?.active !== false
    && player?.injured !== true
    && player?.isInjured !== true
    && player?.suspended !== true
    && player?.isSuspended !== true
    && !(Number(player?.injuryMatches) > 0)
    && !(Number(player?.suspensionMatches) > 0)
    && !["lesionado", "suspenso", "injured", "suspended"].includes(status);
}

export function calculateStarImpact(clubId, players = [], { lineupIds } = {}) {
  const catalog = Array.isArray(players) ? players : [];
  const activePlayers = sortPlayersForSelection(catalog.filter((player) => player?.active !== false));
  const stars = activePlayers.filter((player) => player?.isStar === true);
  const availablePlayers = activePlayers.filter(isPlayerAvailableForMatch);
  const hasSavedLineup = Array.isArray(lineupIds) && lineupIds.length > 0;
  const availableById = new Map(availablePlayers.map((player) => [String(player.id), player]));
  const playingPlayers = hasSavedLineup
    ? lineupIds.map((id) => availableById.get(String(id))).filter(Boolean).slice(0, 11)
    : availablePlayers.slice(0, 11);
  const playingStars = playingPlayers.filter((player) => player?.isStar === true);
  const starPlayers = stars
    .map(playerSummary)
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  const starCount = stars.length;
  const playingStarCount = playingStars.length;
  return {
    clubId: normalizedClubId(clubId),
    catalogPlayerCount: catalog.length,
    starCount,
    starPlayers,
    playingStarCount,
    playingStarPlayers: playingStars.map(playerSummary),
    lineupSource: hasSavedLineup ? "saved" : "deterministic-top11",
    matchStrengthBonus: capped(playingStarCount * STAR_MATCH_STRENGTH_PER_PLAYER, STAR_MATCH_STRENGTH_CAP),
    sponsorBoostPercent: capped(starCount * STAR_SPONSOR_PERCENT_PER_PLAYER, STAR_SPONSOR_PERCENT_CAP),
    sponsorAnnualBonus: capped(starCount * STAR_ANNUAL_BONUS_PER_PLAYER, STAR_ANNUAL_BONUS_CAP),
  };
}

function unavailableImpact(clubId) {
  return {
    ...calculateStarImpact(clubId, []),
    source: "unavailable",
    status: "unavailable",
  };
}

async function withTimeout(operation, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("STAR_IMPACT_TIMEOUT")), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function loadStarImpactsAtomically(
  catalogStore,
  homeClubId,
  awayClubId,
  { timeoutMs = 2_000, homeLineupIds, awayLineupIds } = {},
) {
  if (typeof catalogStore?.getStarImpact !== "function") {
    return {
      home: unavailableImpact(homeClubId),
      away: unavailableImpact(awayClubId),
      status: "unavailable",
    };
  }
  try {
    const [home, away] = await withTimeout(Promise.all([
      catalogStore.getStarImpact(homeClubId, { lineupIds: homeLineupIds }),
      catalogStore.getStarImpact(awayClubId, { lineupIds: awayLineupIds }),
    ]), timeoutMs);
    return {
      home: { ...home, status: home?.status ?? "available" },
      away: { ...away, status: away?.status ?? "available" },
      status: "available",
    };
  } catch {
    return {
      home: unavailableImpact(homeClubId),
      away: unavailableImpact(awayClubId),
      status: "unavailable",
    };
  }
}

function safeStrengthBonus(impact) {
  const value = Number(impact?.matchStrengthBonus);
  return Number.isFinite(value) ? capped(value, STAR_MATCH_STRENGTH_CAP) : 0;
}

export function applyStarImpactToFixture(fixture, homeImpact, awayImpact) {
  const baseHomeStrength = Number.isFinite(fixture?.strengthProfile?.home?.base)
    ? fixture.strengthProfile.home.base
    : Number.isFinite(fixture?.homeStrength) ? fixture.homeStrength : 10;
  const baseAwayStrength = Number.isFinite(fixture?.strengthProfile?.away?.base)
    ? fixture.strengthProfile.away.base
    : Number.isFinite(fixture?.awayStrength) ? fixture.awayStrength : 10;
  const homeBonus = safeStrengthBonus(homeImpact);
  const awayBonus = safeStrengthBonus(awayImpact);
  return {
    ...fixture,
    homeStrength: baseHomeStrength + homeBonus,
    awayStrength: baseAwayStrength + awayBonus,
    starImpact: {
      home: homeImpact,
      away: awayImpact,
      status: homeImpact?.status === "unavailable" || awayImpact?.status === "unavailable"
        ? "unavailable"
        : "available",
    },
    strengthProfile: {
      home: { base: baseHomeStrength, starBonus: homeBonus, effective: baseHomeStrength + homeBonus },
      away: { base: baseAwayStrength, starBonus: awayBonus, effective: baseAwayStrength + awayBonus },
    },
  };
}
