const NEW_ATTRIBUTE_KEYS = Object.freeze([
  "forca",
  "resistencia",
  "impulsao",
  "reflexos",
  "posicionamentoGol",
  "saidaGol",
  "penaltis",
]);

const LEGACY_ATTRIBUTE_KEYS = Object.freeze([
  "velocidade",
  "chute",
  "drible",
  "nocao",
  "defesa",
  "passe",
  "peBom",
  "peRuim",
]);
const REQUIRED_ATTRIBUTE_KEYS = Object.freeze([...LEGACY_ATTRIBUTE_KEYS, ...NEW_ATTRIBUTE_KEYS]);
const DEFENSIVE_POSITIONS = new Set(["ZAG", "LD", "LE"]);
const MIDFIELD_POSITIONS = new Set(["VOL", "MC", "MEI"]);
const ATTACK_POSITIONS = new Set(["PD", "PE", "ATA"]);

const POSITION_WEIGHTS = Object.freeze({
  goalkeeper: Object.freeze({
    reflexos: 0.35,
    posicionamentoGol: 0.25,
    saidaGol: 0.20,
    penaltis: 0.10,
    resistencia: 0.10,
  }),
  defense: Object.freeze({
    defesa: 0.30,
    nocao: 0.20,
    passe: 0.15,
    velocidade: 0.10,
    forca: 0.10,
    resistencia: 0.10,
    impulsao: 0.05,
  }),
  midfield: Object.freeze({
    passe: 0.25,
    nocao: 0.20,
    drible: 0.15,
    velocidade: 0.10,
    forca: 0.10,
    resistencia: 0.10,
    chute: 0.05,
    peBom: 0.05,
  }),
  attack: Object.freeze({
    chute: 0.25,
    drible: 0.20,
    velocidade: 0.15,
    nocao: 0.10,
    peBom: 0.10,
    forca: 0.10,
    resistencia: 0.05,
    impulsao: 0.05,
  }),
});

const PHYSICAL_WEIGHTS = Object.freeze({
  resistencia: 0.30,
  forca: 0.30,
  velocidade: 0.25,
  impulsao: 0.15,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value) {
  return Math.round(value * 1_000) / 1_000;
}

function validAttribute(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 1 && numeric <= 20;
}

function attributesFor(player) {
  return player?.attributes && typeof player.attributes === "object"
    ? player.attributes
    : null;
}

function completeNewAttributes(player) {
  const attributes = attributesFor(player);
  return Boolean(attributes
    && REQUIRED_ATTRIBUTE_KEYS.every((key) => validAttribute(attributes[key])));
}

function weightedRating(attributes, weights) {
  return rounded(Object.entries(weights).reduce(
    (total, [key, weight]) => total + Number(attributes[key]) * weight,
    0,
  ));
}

function positionSector(positionValue) {
  const position = String(positionValue ?? "").trim().toUpperCase();
  if (position === "GOL") return "goalkeeper";
  if (DEFENSIVE_POSITIONS.has(position)) return "defense";
  if (MIDFIELD_POSITIONS.has(position)) return "midfield";
  if (ATTACK_POSITIONS.has(position)) return "attack";
  return null;
}

function average(values, fallback = 10) {
  return values.length > 0
    ? rounded(values.reduce((total, value) => total + value, 0) / values.length)
    : fallback;
}

function legacyProfile(lineupPlayerCount = 0) {
  return {
    version: null,
    status: "legacy",
    available: false,
    lineupPlayerCount,
    rating: null,
    attack: null,
    midfield: null,
    defense: null,
    goalkeeping: null,
    physical: null,
    strengthBonus: 0,
    physicalSecondHalfModifier: 0,
  };
}

export { NEW_ATTRIBUTE_KEYS, POSITION_WEIGHTS, REQUIRED_ATTRIBUTE_KEYS };

export function strengthBonusForRating(rating) {
  return rounded(clamp((Number(rating) - 10) * 0.12, -1, 1.5));
}

export function physicalSecondHalfModifier(physicalRating) {
  return rounded(clamp((Number(physicalRating) - 10) * 0.04, -0.4, 0.4));
}

export function playerAttributeRatings(player) {
  if (!completeNewAttributes(player)) return null;
  const sector = positionSector(player.position);
  if (!sector) return null;
  const attributes = attributesFor(player);
  return {
    sector,
    positional: weightedRating(attributes, POSITION_WEIGHTS[sector]),
    physical: weightedRating(attributes, PHYSICAL_WEIGHTS),
  };
}

export function calculatePlayerOverall(player, fallback = 10) {
  const rating = playerAttributeRatings(player)?.positional;
  const fallbackValue = Number(fallback);
  const value = Number.isFinite(rating)
    ? rating
    : Number.isFinite(fallbackValue) ? fallbackValue : 10;
  return clamp(Math.round(value), 1, 20);
}

export function calculateLineupAttributeProfile(players = [], { lineupIds } = {}) {
  const catalog = Array.isArray(players) ? players : [];
  const playersById = new Map(catalog.map((player) => [String(player?.id ?? ""), player]));
  const selected = Array.isArray(lineupIds) && lineupIds.length > 0
    ? lineupIds.map((playerId) => playersById.get(String(playerId))).filter(Boolean)
    : catalog.slice(0, 11);
  const expectedCount = Array.isArray(lineupIds) && lineupIds.length > 0
    ? lineupIds.length
    : selected.length;
  if (selected.length === 0 || selected.length !== expectedCount || selected.some((player) => !completeNewAttributes(player))) {
    return legacyProfile(selected.length);
  }

  const ratings = selected.map(playerAttributeRatings);
  if (ratings.some((rating) => !rating)) return legacyProfile(selected.length);
  const bySector = (sector) => ratings.filter((rating) => rating.sector === sector).map((rating) => rating.positional);
  const positionalRatings = ratings.map((rating) => rating.positional);
  const physical = average(ratings.map((rating) => rating.physical));
  const rating = average(positionalRatings);
  return {
    version: 2,
    status: "available",
    available: true,
    lineupPlayerCount: selected.length,
    rating,
    attack: average(bySector("attack")),
    midfield: average(bySector("midfield")),
    defense: average(bySector("defense")),
    goalkeeping: average(bySector("goalkeeper")),
    physical,
    strengthBonus: strengthBonusForRating(rating),
    physicalSecondHalfModifier: physicalSecondHalfModifier(physical),
  };
}

function sideStrength(fixture, side, profile) {
  const previous = fixture?.strengthProfile?.[side] ?? {};
  const baseField = side === "home" ? "homeStrength" : "awayStrength";
  const base = Number.isFinite(previous.base)
    ? previous.base
    : Number.isFinite(fixture?.[baseField]) ? fixture[baseField] : 10;
  const starBonus = Number.isFinite(previous.starBonus) ? previous.starBonus : 0;
  const attributeBonus = profile?.available ? Number(profile.strengthBonus) || 0 : 0;
  return {
    ...previous,
    base,
    starBonus,
    attributeBonus,
    effective: base + starBonus + attributeBonus,
  };
}

export function applyLineupAttributeProfiles(fixture, homeProfile, awayProfile) {
  const normalizedHome = homeProfile?.available ? homeProfile : legacyProfile(homeProfile?.lineupPlayerCount);
  const normalizedAway = awayProfile?.available ? awayProfile : legacyProfile(awayProfile?.lineupPlayerCount);
  const homeStrength = sideStrength(fixture, "home", normalizedHome);
  const awayStrength = sideStrength(fixture, "away", normalizedAway);
  return {
    ...fixture,
    homeStrength: homeStrength.effective,
    awayStrength: awayStrength.effective,
    ...(normalizedHome.available ? {
      homeGoalkeeperRating: normalizedHome.goalkeeping,
      homePhysicalSecondHalfModifier: normalizedHome.physicalSecondHalfModifier,
    } : {}),
    ...(normalizedAway.available ? {
      awayGoalkeeperRating: normalizedAway.goalkeeping,
      awayPhysicalSecondHalfModifier: normalizedAway.physicalSecondHalfModifier,
    } : {}),
    lineupAttributeProfile: {
      home: normalizedHome,
      away: normalizedAway,
      status: normalizedHome.available || normalizedAway.available ? "available" : "legacy",
    },
    strengthProfile: {
      home: homeStrength,
      away: awayStrength,
    },
  };
}
