export const DEFAULT_COACH_SELECTION_WEIGHTS = Object.freeze({
  license: 10,
  experience: 12,
  recentPerformance: 10,
  reputation: 8,
  achievements: 8,
  salary: 10,
  playingStyle: 13,
  squadCompatibility: 12,
  countryKnowledge: 8,
  adaptability: 5,
  availability: 4,
});

const PROFILE_VERSION = 1;
const MONEY_LIMIT = 2_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const LICENSE_RANK = Object.freeze({
  NONE: 0,
  C: 1,
  UEFA_C: 1,
  CONMEBOL_C: 1,
  B: 2,
  UEFA_B: 2,
  CONMEBOL_B: 2,
  A: 3,
  UEFA_A: 3,
  CONMEBOL_A: 3,
  PRO: 4,
  UEFA_PRO: 4,
  CONMEBOL_PRO: 4,
});
const LICENSE_EQUIVALENTS = Object.freeze({
  C: ["C", "UEFA_C", "CONMEBOL_C"],
  B: ["B", "UEFA_B", "CONMEBOL_B"],
  A: ["A", "UEFA_A", "CONMEBOL_A"],
  PRO: ["PRO", "UEFA_PRO", "CONMEBOL_PRO"],
});
const COUNTRY_LANGUAGE = Object.freeze({
  ar: "es",
  arg: "es",
  argentina: "es",
  bolivia: "es",
  br: "pt",
  bra: "pt",
  brasil: "pt",
  brazil: "pt",
  chile: "es",
  colombia: "es",
  espanha: "es",
  spain: "es",
  franca: "fr",
  france: "fr",
  eng: "en",
  gb: "en",
  gbr: "en",
  inglaterra: "en",
  england: "en",
  italia: "it",
  italy: "it",
  mexico: "es",
  paraguai: "es",
  portugal: "pt",
  uruguai: "es",
});
const COUNTRY_ALIASES = Object.freeze({
  ar: "argentina",
  arg: "argentina",
  br: "brasil",
  bra: "brasil",
  brazil: "brasil",
  eng: "inglaterra",
  england: "inglaterra",
  gb: "inglaterra",
  gbr: "inglaterra",
});
const STYLE_ALIASES = Object.freeze({
  attacking: "attacking",
  ataque: "attacking",
  offensive: "attacking",
  ofensivo: "attacking",
  counter: "counter_attack",
  counterattack: "counter_attack",
  counter_attack: "counter_attack",
  "contra-ataque": "counter_attack",
  contrapress: "high_press",
  pressing: "high_press",
  pressao: "high_press",
  high_press: "high_press",
  "pressao-alta": "high_press",
  possession: "possession",
  posse: "possession",
  solid_defense: "solid_defense",
  defensivo: "solid_defense",
  defensive: "solid_defense",
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function identifier(value) {
  return String(value ?? "").trim();
}

function normalizedText(value) {
  return identifier(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function normalizedCountry(value) {
  const normalized = normalizedText(value);
  return COUNTRY_ALIASES[normalized] ?? normalized;
}

function normalizedLanguage(value) {
  const normalized = normalizedText(value).replace(/_/gu, "-");
  const aliases = {
    english: "en",
    ingles: "en",
    portuguese: "pt",
    portugues: "pt",
    "pt-br": "pt",
    spanish: "es",
    espanhol: "es",
  };
  return aliases[normalized] ?? normalized;
}

function clubKey(value) {
  return normalizedText(value);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(number)))
    : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function timestamp(value, fallback = null) {
  const date = value instanceof Date ? value : new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueText(values) {
  return [...new Set(list(values).map(identifier).filter(Boolean))];
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeStyle(value) {
  const normalized = normalizedText(value).replace(/\s+/gu, "_");
  return STYLE_ALIASES[normalized] ?? normalized;
}

function normalizeLicense(value) {
  const normalized = identifier(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleUpperCase("pt-BR")
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (!normalized) return "NONE";
  if (normalized === "LICENCA_PRO" || normalized === "PRO_LICENSE") return "PRO";
  return normalized;
}

function normalizeStrictness(value, fallback = "balanced") {
  const normalized = normalizedText(value);
  return ["strict", "balanced", "flexible"].includes(normalized) ? normalized : fallback;
}

function normalizeTier(value, fallback = "established") {
  const normalized = normalizedText(value);
  return ["elite", "established", "development", "small"].includes(normalized) ? normalized : fallback;
}

function deepMerge(baseValue, overrideValue) {
  const base = object(baseValue);
  const override = object(overrideValue);
  const result = clone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = object(value) && object(base[key]) === base[key]
      ? deepMerge(base[key], value)
      : clone(value);
  }
  return result;
}

function normalizeWeights(value, fallback = DEFAULT_COACH_SELECTION_WEIGHTS) {
  const source = object(value);
  const base = object(fallback);
  const entries = Object.keys(DEFAULT_COACH_SELECTION_WEIGHTS).map((code) => [
    code,
    Math.max(0, finite(source[code], finite(base[code], DEFAULT_COACH_SELECTION_WEIGHTS[code]))),
  ]);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return { ...DEFAULT_COACH_SELECTION_WEIGHTS };
  const normalized = Object.fromEntries(entries.map(([code, weight]) => [
    code,
    rounded(weight * 100 / total, 4),
  ]));
  const normalizedTotal = Object.values(normalized).reduce((sum, weight) => sum + weight, 0);
  const lastCode = entries.at(-1)[0];
  normalized[lastCode] = rounded(normalized[lastCode] + (100 - normalizedTotal), 4);
  return normalized;
}

function countriesFromCatalog(room) {
  const clubs = new Map();
  const add = (club, competition = {}) => {
    const id = identifier(club?.id ?? club?.code);
    if (!id) return;
    const record = {
      ...clone(club),
      id,
      competitionId: identifier(competition?.id) || null,
      competitionName: identifier(competition?.name) || null,
      competitionCountry: identifier(competition?.country) || null,
      competitionLevel: finite(
        competition?.divisionOrder ?? competition?.tier ?? competition?.level,
        1,
      ),
    };
    for (const alias of [id, club?.code, club?.abbreviation, club?.name]) {
      if (identifier(alias)) clubs.set(clubKey(alias), record);
    }
  };
  for (const competition of list(room?.competitionCatalog)) {
    for (const club of list(competition?.clubs)) add(club, competition);
  }
  for (const competition of list(room?.tournamentCatalog)) {
    for (const club of list(competition?.participants)) add(club, competition);
  }
  return clubs;
}

function clubFor(room, clubId) {
  return countriesFromCatalog(room).get(clubKey(clubId)) ?? {
    id: identifier(clubId),
    name: identifier(clubId),
  };
}

function financeFor(room, clubId) {
  return list(room?.marketState?.finances).find((finance) => (
    clubKey(finance?.clubId) === clubKey(clubId)
  )) ?? null;
}

function playerClubId(player) {
  const contract = object(player?.contract);
  return identifier(contract.clubId ?? player?.currentClubId ?? player?.clubId);
}

function playersForClub(room, clubId) {
  return list(room?.careerState?.players).filter((player) => (
    player?.active !== false
      && player?.retired !== true
      && clubKey(playerClubId(player)) === clubKey(clubId)
  ));
}

function playerAttribute(player, key, fallback = 10) {
  return clamp(finite(player?.attributes?.[key], fallback), 1, 20);
}

function average(values, fallback = 0) {
  return values.length
    ? values.reduce((sum, value) => sum + finite(value), 0) / values.length
    : fallback;
}

function formationForClub(room, clubId, players) {
  const lineups = list(room?.lineups)
    .filter((lineup) => clubKey(lineup?.clubId) === clubKey(clubId))
    .map((lineup) => identifier(lineup?.tactics?.formationId ?? lineup?.formationId))
    .filter(Boolean);
  if (lineups.length) {
    const count = new Map();
    for (const formation of lineups) count.set(formation, (count.get(formation) ?? 0) + 1);
    return [...count].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "pt-BR"))[0][0];
  }
  const positions = new Map();
  for (const player of players) {
    const position = identifier(player?.position).toLocaleUpperCase("pt-BR");
    positions.set(position, (positions.get(position) ?? 0) + 1);
  }
  if ((positions.get("ATA") ?? 0) >= 4) return "4-4-2";
  if ((positions.get("PE") ?? 0) + (positions.get("PD") ?? 0) >= 3) return "4-3-3";
  if ((positions.get("MEI") ?? 0) >= 2) return "4-2-3-1";
  return "4-3-3";
}

function squadFacts(room, clubId) {
  const players = playersForClub(room, clubId);
  const averageAge = rounded(average(players.map((player) => finite(player?.age, 25)), 25), 1);
  const averageOverall = rounded(average(players.map((player) => (
    normalizeCoachReputation100(player?.overall)
  )), 50), 1);
  const youngTalentCount = players.filter((player) => (
    finite(player?.age, 30) <= 21
      && normalizeCoachReputation100(player?.potential ?? player?.overall) >= 70
  )).length;
  const attacking = average(players.map((player) => average([
    playerAttribute(player, "chute"),
    playerAttribute(player, "drible"),
    playerAttribute(player, "passe"),
  ], 10)), 10);
  const defending = average(players.map((player) => average([
    playerAttribute(player, "defesa"),
    playerAttribute(player, "forca"),
    playerAttribute(player, "nocao"),
  ], 10)), 10);
  const pace = average(players.map((player) => playerAttribute(player, "velocidade")), 10);
  const possession = average(players.map((player) => average([
    playerAttribute(player, "passe"),
    playerAttribute(player, "drible"),
    playerAttribute(player, "nocao"),
  ], 10)), 10);
  return {
    playerCount: players.length,
    averageAge,
    averageOverall,
    averagePotential: rounded(average(players.map((player) => (
      normalizeCoachReputation100(player?.potential ?? player?.overall)
    )), averageOverall), 1),
    youngTalentCount,
    youthShare: players.length ? rounded(players.filter((player) => finite(player?.age, 30) <= 23).length / players.length, 3) : 0,
    predominantFormation: formationForClub(room, clubId, players),
    attackingScore: rounded(attacking * 5, 1),
    defendingScore: rounded(defending * 5, 1),
    paceScore: rounded(pace * 5, 1),
    possessionScore: rounded(possession * 5, 1),
    rebuilding: players.length > 0 && (averageAge >= 28 || averageOverall < 55),
  };
}

function preferredStyleFromClub(club, squad, clubId) {
  const explicit = normalizeStyle(
    club?.playStyle
      ?? club?.style
      ?? club?.philosophy
      ?? club?.sportingPhilosophy,
  );
  if (explicit) return explicit;
  if (squad.possessionScore >= Math.max(squad.paceScore, squad.defendingScore) + 4) return "possession";
  if (squad.paceScore >= Math.max(squad.possessionScore, squad.defendingScore) + 4) return "counter_attack";
  if (squad.defendingScore >= squad.attackingScore + 5) return "solid_defense";
  if (squad.youthShare >= 0.38) return "high_press";
  return ["possession", "counter_attack", "high_press", "attacking"][hashText(clubId) % 4];
}

function languageForCountry(country) {
  return COUNTRY_LANGUAGE[normalizedCountry(country)] ?? null;
}

function profileTemplate(tier, strictness) {
  const requirements = {
    elite: {
      license: "PRO",
      minimumYears: 8,
      professionalYears: 6,
      divisionYears: 3,
      internationalYears: 2,
    },
    established: {
      license: "A",
      minimumYears: 5,
      professionalYears: 4,
      divisionYears: 2,
      internationalYears: 1,
    },
    development: {
      license: "B",
      minimumYears: 3,
      professionalYears: 2,
      divisionYears: 1,
      internationalYears: 0,
    },
    small: {
      license: "B",
      minimumYears: 1,
      professionalYears: 0,
      divisionYears: 0,
      internationalYears: 0,
    },
  }[tier];
  return {
    version: PROFILE_VERSION,
    revision: 1,
    tier,
    strictness,
    license: {
      minimum: requirements.license,
      allowEquivalent: true,
      acceptedEquivalent: LICENSE_EQUIVALENTS[requirements.license],
    },
    experience: {
      minimumYears: requirements.minimumYears,
      youthYears: tier === "development" ? 2 : 0,
      professionalYears: requirements.professionalYears,
      internationalYears: requirements.internationalYears,
      currentDivisionYears: requirements.divisionYears,
    },
    geography: {
      country: null,
      preferredNationality: null,
      acceptedNationalities: [],
      requiredLanguage: null,
      acceptedLanguages: [],
      regionalExperiencePreferred: true,
    },
    salary: {
      minimum: 0,
      ideal: 100_000,
      maximum: 150_000,
      flexibility: strictness === "strict" ? 0.12 : strictness === "flexible" ? 0.45 : 0.25,
    },
    achievements: {
      minimumNationalTitles: tier === "elite" ? 1 : 0,
      minimumCups: 0,
      minimumContinentalTitles: 0,
      minimumPromotions: 0,
      prioritizeYouthDevelopment: tier === "development",
      prioritizeLeagueSurvival: tier === "small",
    },
    playingStyle: {
      preferred: [],
      accepted: [],
      preferredFormation: null,
      acceptedFormations: [],
      trainingIntensity: "normal",
      youthUsage: tier === "development" ? "high" : "balanced",
    },
    squad: {
      playerCount: 0,
      averageAge: 25,
      averageOverall: 50,
      averagePotential: 50,
      youngTalentCount: 0,
      youthShare: 0,
      predominantFormation: "4-3-3",
      attackingScore: 50,
      defendingScore: 50,
      paceScore: 50,
      possessionScore: 50,
      rebuilding: false,
    },
    countryKnowledge: {
      minimum: strictness === "strict" ? 45 : strictness === "flexible" ? 15 : 30,
      priorWorkPreferred: true,
      languageRequired: strictness === "strict",
    },
    weights: { ...DEFAULT_COACH_SELECTION_WEIGHTS },
    objective: null,
    availableBudget: null,
    squadSummary: null,
  };
}

function normalizedProfileDefaults(defaults) {
  const source = profileWithPlayingStyleAliases(defaults);
  const tier = normalizeTier(source.tier);
  const strictness = normalizeStrictness(
    source.strictness,
    tier === "elite" ? "strict" : tier === "small" ? "flexible" : "balanced",
  );
  return deepMerge(profileTemplate(tier, strictness), source);
}

function profileWithPlayingStyleAliases(value) {
  const source = clone(object(value));
  const playingStyle = object(source.playingStyle);
  const flatStyles = uniqueText([
    source.style,
    source.playStyle,
    ...list(source.styles),
    ...list(source.playStyles),
  ]);
  const flatFormations = uniqueText([
    source.preferredFormation,
    source.formation,
    ...list(source.preferredFormations),
    ...list(source.formations),
  ]);
  const hasPreferredStyles = Object.prototype.hasOwnProperty.call(playingStyle, "preferred");
  const hasPreferredFormation = Object.prototype.hasOwnProperty.call(
    playingStyle,
    "preferredFormation",
  );
  const hasAcceptedFormations = Object.prototype.hasOwnProperty.call(
    playingStyle,
    "acceptedFormations",
  );
  source.playingStyle = {
    ...playingStyle,
    ...(!hasPreferredStyles && flatStyles.length > 0 ? { preferred: flatStyles } : {}),
    ...(!hasPreferredFormation && flatFormations.length > 0
      ? { preferredFormation: flatFormations[0] }
      : {}),
    ...(!hasAcceptedFormations && flatFormations.length > 1
      ? { acceptedFormations: flatFormations.slice(1) }
      : {}),
  };
  return source;
}

export function normalizeCoachReputation100(value, fallback = 50) {
  if (value === null || value === undefined || value === "") {
    return rounded(clamp(finite(fallback, 50), 0, 100), 2);
  }
  const score = finite(value, fallback);
  if (score > 0 && score <= 20) return rounded(clamp(score * 5, 0, 100), 2);
  return rounded(clamp(score, 0, 100), 2);
}

function coachReputation100(coach, fallback = 50) {
  const marketReputation = coach?.marketReputation;
  const legacyReputation = coach?.reputation;
  return normalizeCoachReputation100(
    marketReputation == null || (
      finite(marketReputation, 0) === 0
        && finite(legacyReputation, 0) > 0
    )
      ? legacyReputation
      : marketReputation,
    fallback,
  );
}

function normalizeAmbition100(value, fallback = 50) {
  if (value == null || value === "") return clamp(finite(fallback, 50), 0, 100);
  if (Number.isFinite(Number(value))) return clamp(finite(value, fallback), 0, 100);
  const aliases = {
    low: 25,
    baixa: 25,
    balanced: 50,
    media: 50,
    medium: 50,
    high: 75,
    alta: 75,
    elite: 95,
  };
  return aliases[normalizedText(value)] ?? clamp(finite(fallback, 50), 0, 100);
}

export function normalizeVacancyDesiredProfile(profile = {}, defaults = {}) {
  const mergedDefaults = normalizedProfileDefaults(defaults);
  const source = deepMerge(mergedDefaults, profileWithPlayingStyleAliases(profile));
  const tier = normalizeTier(source.tier, mergedDefaults.tier);
  const strictness = normalizeStrictness(source.strictness, mergedDefaults.strictness);
  const minimumLicense = normalizeLicense(
    source.license?.minimum
      ?? source.licenseTier
      ?? mergedDefaults.license.minimum,
  );
  const acceptedEquivalent = uniqueText([
    ...(source.license?.acceptedEquivalent ?? []),
    ...(source.equivalentLicenses ?? []),
    ...(source.license?.allowEquivalent === false ? [] : LICENSE_EQUIVALENTS[minimumLicense] ?? []),
  ]).map(normalizeLicense);
  const salaryMinimum = integer(source.salary?.minimum, 0, 0, MONEY_LIMIT);
  const salaryIdeal = integer(source.salary?.ideal, Math.max(1_000, salaryMinimum), salaryMinimum, MONEY_LIMIT);
  const salaryMaximum = integer(source.salary?.maximum, Math.max(salaryIdeal, salaryMinimum), salaryIdeal, MONEY_LIMIT);
  const geography = object(source.geography);
  const style = object(source.playingStyle);
  const squad = object(source.squad);
  const achievements = object(source.achievements);
  const experience = object(source.experience);
  const countryKnowledge = object(source.countryKnowledge);
  return {
    version: integer(source.version, PROFILE_VERSION, 1, PROFILE_VERSION),
    revision: integer(source.revision, 1, 1, 1_000_000),
    tier,
    strictness,
    license: {
      minimum: minimumLicense,
      allowEquivalent: source.license?.allowEquivalent !== false,
      acceptedEquivalent,
    },
    experience: {
      minimumYears: rounded(clamp(finite(experience.minimumYears), 0, 60), 1),
      youthYears: rounded(clamp(finite(experience.youthYears), 0, 60), 1),
      professionalYears: rounded(clamp(finite(experience.professionalYears), 0, 60), 1),
      internationalYears: rounded(clamp(finite(experience.internationalYears), 0, 60), 1),
      currentDivisionYears: rounded(clamp(finite(experience.currentDivisionYears), 0, 60), 1),
    },
    geography: {
      country: identifier(geography.country) || null,
      preferredNationality: identifier(geography.preferredNationality) || null,
      acceptedNationalities: uniqueText(geography.acceptedNationalities),
      requiredLanguage: identifier(geography.requiredLanguage) || null,
      acceptedLanguages: uniqueText(geography.acceptedLanguages),
      regionalExperiencePreferred: geography.regionalExperiencePreferred !== false,
    },
    salary: {
      minimum: salaryMinimum,
      ideal: salaryIdeal,
      maximum: salaryMaximum,
      flexibility: rounded(clamp(finite(source.salary?.flexibility, 0.25), 0, 1), 3),
    },
    achievements: {
      minimumNationalTitles: integer(achievements.minimumNationalTitles, 0, 0, 100),
      minimumCups: integer(achievements.minimumCups, 0, 0, 100),
      minimumContinentalTitles: integer(achievements.minimumContinentalTitles, 0, 0, 100),
      minimumPromotions: integer(achievements.minimumPromotions, 0, 0, 100),
      prioritizeYouthDevelopment: Boolean(achievements.prioritizeYouthDevelopment),
      prioritizeLeagueSurvival: Boolean(achievements.prioritizeLeagueSurvival),
    },
    playingStyle: {
      preferred: uniqueText(style.preferred).map(normalizeStyle).filter(Boolean),
      accepted: uniqueText(style.accepted).map(normalizeStyle).filter(Boolean),
      preferredFormation: identifier(style.preferredFormation) || null,
      acceptedFormations: uniqueText(style.acceptedFormations),
      trainingIntensity: identifier(style.trainingIntensity) || "normal",
      youthUsage: identifier(style.youthUsage) || "balanced",
    },
    squad: {
      playerCount: integer(squad.playerCount, 0, 0, 200),
      averageAge: rounded(clamp(finite(squad.averageAge, 25), 14, 60), 1),
      averageOverall: rounded(clamp(finite(squad.averageOverall, 50), 0, 100), 1),
      averagePotential: rounded(clamp(finite(squad.averagePotential, squad.averageOverall ?? 50), 0, 100), 1),
      youngTalentCount: integer(squad.youngTalentCount, 0, 0, 100),
      youthShare: rounded(clamp(finite(squad.youthShare), 0, 1), 3),
      predominantFormation: identifier(squad.predominantFormation) || "4-3-3",
      attackingScore: rounded(clamp(finite(squad.attackingScore, 50), 0, 100), 1),
      defendingScore: rounded(clamp(finite(squad.defendingScore, 50), 0, 100), 1),
      paceScore: rounded(clamp(finite(squad.paceScore, 50), 0, 100), 1),
      possessionScore: rounded(clamp(finite(squad.possessionScore, 50), 0, 100), 1),
      rebuilding: Boolean(squad.rebuilding),
    },
    countryKnowledge: {
      minimum: rounded(clamp(finite(countryKnowledge.minimum, 30), 0, 100), 1),
      priorWorkPreferred: countryKnowledge.priorWorkPreferred !== false,
      languageRequired: Boolean(countryKnowledge.languageRequired),
    },
    weights: normalizeWeights(source.weights, mergedDefaults.weights),
    objective: identifier(source.objective) || null,
    objectives: clone(list(source.objectives)),
    expectation: identifier(source.expectation) || null,
    interviewQuestions: clone(list(source.interviewQuestions)),
    reason: identifier(source.reason) || null,
    generatedAt: timestamp(source.generatedAt),
    availableBudget: source.availableBudget == null
      ? null
      : integer(source.availableBudget, 0, 0, MONEY_LIMIT),
    squadSummary: identifier(source.squadSummary) || null,
  };
}

export function buildDesiredCoachProfile(room, state, clubId, reason, now, overrides = {}) {
  const club = clubFor(room, clubId);
  const reputation = normalizeCoachReputation100(club?.reputation);
  const finance = financeFor(room, clubId);
  const catalogBudget = Math.max(0, finite(club?.budget));
  const balance = Math.max(0, finite(finance?.balance, catalogBudget));
  const committed = Math.max(0, finite(finance?.committed));
  const availableBudget = finance
    ? Math.max(0, balance - committed)
    : club?.budget != null
      ? catalogBudget
      : null;
  const explicitObjective = identifier(
    club?.seasonObjective
      ?? club?.objective
      ?? list(room?.clubCareerState?.boardObjectives).find((entry) => (
        clubKey(entry?.clubId) === clubKey(clubId)
      ))?.label,
  );
  const objectiveKey = normalizedText(explicitObjective);
  const objectivePressure = /(titulo|champion|campea|acesso|promotion|promoc)/u.test(objectiveKey)
    ? 8
    : /(perman|survival|evitar.*rebaix)/u.test(objectiveKey)
      ? -4
      : 0;
  const ambition = normalizeAmbition100(
    club?.ambition ?? club?.sportingAmbition ?? club?.philosophy?.ambition,
    reputation,
  );
  const tierScore = clamp(reputation * 0.65 + ambition * 0.35 + objectivePressure, 0, 100);
  const tier = tierScore >= 85
    ? "elite"
    : tierScore >= 70
      ? "established"
      : tierScore >= 55
        ? "development"
        : "small";
  const strictness = tier === "elite" ? "strict" : tier === "small" ? "flexible" : "balanced";
  const squad = squadFacts(room, clubId);
  const country = identifier(club?.country ?? club?.competitionCountry) || null;
  const language = languageForCountry(country);
  const style = preferredStyleFromClub(club, squad, clubId);
  const salaryIdeal = Math.round((30_000 + reputation * 2_800) / 1_000) * 1_000;
  const affordableMonthly = availableBudget == null
    ? MONEY_LIMIT
    : Math.max(25_000, Math.floor(availableBudget / 24 / 1_000) * 1_000);
  const salaryMaximum = Math.max(
    25_000,
    Math.min(
      Math.round(salaryIdeal * (strictness === "strict" ? 1.45 : strictness === "flexible" ? 1.2 : 1.32)),
      affordableMonthly,
    ),
  );
  const boundedIdeal = Math.min(salaryIdeal, salaryMaximum);
  const objective = explicitObjective || (tier === "elite"
    ? "Disputar títulos e manter padrão de elite"
    : squad.rebuilding
      ? "Reconstruir o elenco com sustentabilidade"
      : tier === "small"
        ? "Permanecer competitivo na divisão"
        : "Cumprir objetivos esportivos da temporada");
  const tierWeights = tier === "elite"
    ? { license: 15, achievements: 13, reputation: 11, salary: 6, availability: 2 }
    : tier === "development"
      ? { playingStyle: 16, squadCompatibility: 17, experience: 10, achievements: 5 }
      : tier === "small"
        ? { salary: 18, availability: 10, adaptability: 9, license: 5, achievements: 3, reputation: 5 }
        : {};
  if (tierScore >= 75 || objectivePressure > 0) {
    tierWeights.achievements = Math.max(12, finite(tierWeights.achievements, 8));
    tierWeights.reputation = Math.max(10, finite(tierWeights.reputation, 8));
  }
  if (objectivePressure < 0) {
    tierWeights.experience = Math.max(15, finite(tierWeights.experience, 12));
    tierWeights.squadCompatibility = Math.max(15, finite(tierWeights.squadCompatibility, 12));
  }
  const generated = {
    ...profileTemplate(tier, strictness),
    tier,
    strictness,
    geography: {
      country,
      preferredNationality: country,
      acceptedNationalities: country ? [country] : [],
      requiredLanguage: language,
      acceptedLanguages: language ? [language] : [],
      regionalExperiencePreferred: true,
    },
    salary: {
      minimum: Math.round(boundedIdeal * 0.65 / 1_000) * 1_000,
      ideal: boundedIdeal,
      maximum: salaryMaximum,
      flexibility: strictness === "strict" ? 0.12 : strictness === "flexible" ? 0.45 : 0.25,
    },
    achievements: {
      ...profileTemplate(tier, strictness).achievements,
      prioritizeYouthDevelopment: tier === "development" || squad.youngTalentCount >= 5,
      prioritizeLeagueSurvival: tier === "small",
    },
    playingStyle: {
      preferred: [style],
      accepted: style === "attacking" ? ["possession", "high_press"] : [],
      preferredFormation: squad.predominantFormation,
      acceptedFormations: [squad.predominantFormation],
      trainingIntensity: style === "high_press" ? "high" : "normal",
      youthUsage: squad.youngTalentCount >= 5 ? "high" : "balanced",
    },
    squad,
    weights: normalizeWeights({
      ...DEFAULT_COACH_SELECTION_WEIGHTS,
      ...tierWeights,
    }),
    objective,
    availableBudget,
    squadSummary: squad.playerCount
      ? `${squad.playerCount} jogadores · média ${squad.averageAge} anos · força ${Math.round(squad.averageOverall)}/100`
      : "Elenco sem dados completos",
    reason: identifier(reason) || "coach_departure",
    generatedAt: timestamp(now),
  };
  return normalizeVacancyDesiredProfile(deepMerge(generated, overrides), generated);
}

function assignmentDurationYears(room, assignment, now) {
  const startAt = new Date(assignment?.startedAt ?? "").getTime();
  const endAt = new Date(assignment?.endedAt ?? now ?? "").getTime();
  if (Number.isFinite(startAt) && Number.isFinite(endAt) && endAt >= startAt) {
    return (endAt - startAt) / (365.25 * DAY_MS);
  }
  const currentSeason = integer(room?.currentSeason, 1, 1);
  const startSeason = integer(assignment?.startedSeason, currentSeason, 1);
  const endSeason = integer(assignment?.endedSeason, currentSeason, startSeason);
  return Math.max(0, endSeason - startSeason + 1);
}

function coachCountries(room, coach) {
  const clubs = countriesFromCatalog(room);
  const countries = new Set();
  for (const country of uniqueText([
    ...list(coach?.workedCountries),
    ...list(coach?.countriesWorked),
  ])) {
    countries.add(normalizedCountry(country));
  }
  for (const [country, score] of Object.entries(object(coach?.countryKnowledge))) {
    if (finite(score, score === true ? 100 : 0) > 0) countries.add(normalizedCountry(country));
  }
  for (const assignment of list(coach?.assignments)) {
    const club = clubs.get(clubKey(assignment?.clubId));
    const country = identifier(club?.country ?? club?.competitionCountry);
    if (country) countries.add(normalizedCountry(country));
  }
  return countries;
}

function coachLanguages(coach) {
  const values = uniqueText([
    ...list(coach?.languages),
    coach?.language,
    languageForCountry(coach?.nationality ?? coach?.country),
  ]);
  return new Set(values.map(normalizedLanguage));
}

function coachAchievements(room, coach) {
  const explicit = object(coach?.achievements);
  let nationalTitles = integer(explicit.nationalTitles ?? coach?.nationalTitles, 0);
  let cups = integer(explicit.cups ?? coach?.cups, 0);
  let continentalTitles = integer(explicit.continentalTitles ?? coach?.continentalTitles, 0);
  let promotions = integer(explicit.promotions ?? coach?.promotions, 0);
  const aggregateTitles = integer(explicit.titles ?? coach?.titles, 0);
  const categorizedTitles = nationalTitles + cups + continentalTitles;
  if (aggregateTitles > categorizedTitles) nationalTitles += aggregateTitles - categorizedTitles;
  const coachId = identifier(coach?.id);
  for (const winner of list(room?.competitionWinners ?? room?.tournamentWinners)) {
    if (identifier(winner?.coachId ?? winner?.managerId) !== coachId) continue;
    const kind = normalizedText(winner?.type ?? winner?.format ?? winner?.competitionType);
    if (kind.includes("continental")) continentalTitles += 1;
    else if (kind.includes("cup") || kind.includes("copa") || kind.includes("knockout")) cups += 1;
    else nationalTitles += 1;
  }
  for (const achievement of list(coach?.achievements)) {
    const type = normalizedText(achievement?.type ?? achievement);
    if (type.includes("promotion") || type.includes("promoc")) promotions += 1;
  }
  return {
    nationalTitles,
    cups,
    continentalTitles,
    promotions,
    youthDevelopment: clamp(finite(coach?.youthDevelopment, 50), 0, 100),
    leagueSurvival: integer(explicit.leagueSurvival ?? coach?.leagueSurvival, 0),
  };
}

function currentContract(state, coachId) {
  return list(state?.contracts).find((contract) => (
    identifier(contract?.coachId) === identifier(coachId)
      && ["active", "scheduled"].includes(identifier(contract?.status))
  )) ?? null;
}

function coachExperience(room, coach, profile, now) {
  const countries = coachCountries(room, coach);
  const targetCountry = normalizedCountry(profile.geography.country);
  let assignmentYears = 0;
  let countryYears = 0;
  let divisionYears = 0;
  for (const assignment of list(coach?.assignments)) {
    const years = assignmentDurationYears(room, assignment, now);
    assignmentYears += years;
    const club = clubFor(room, assignment?.clubId);
    if (targetCountry && normalizedCountry(club?.country ?? club?.competitionCountry) === targetCountry) {
      countryYears += years;
    }
    if (identifier(club?.competitionId) === identifier(clubFor(room, profile.clubId)?.competitionId)) {
      divisionYears += years;
    }
  }
  const totalYears = Math.max(
    0,
    finite(coach?.experienceYears ?? coach?.yearsExperience, 0),
    assignmentYears,
  );
  return {
    totalYears,
    youthYears: Math.max(0, finite(coach?.youthExperienceYears, 0)),
    professionalYears: Math.max(0, finite(coach?.professionalExperienceYears, assignmentYears)),
    internationalYears: Math.max(
      0,
      finite(coach?.internationalExperienceYears, countries.size > 1 ? totalYears * 0.25 : 0),
    ),
    currentDivisionYears: Math.max(
      0,
      finite(
        coach?.divisionExperienceYears
          ?? coach?.currentDivisionExperienceYears
          ?? coach?.currentDivisionYears,
        divisionYears,
      ),
    ),
    countryYears,
    countries,
  };
}

function inferredCoachLicense(coach) {
  const explicitLicenses = uniqueText([
    coach?.licenseTier,
    coach?.license,
    coach?.coachingLicense,
    ...list(coach?.equivalentLicenses),
    ...list(coach?.licenseEquivalents),
    ...list(coach?.licenses),
  ]).map(normalizeLicense).filter((license) => license !== "NONE");
  if (explicitLicenses.length > 0) {
    const ranked = [...explicitLicenses].sort((left, right) => (
      (LICENSE_RANK[right] ?? 0) - (LICENSE_RANK[left] ?? 0)
    ));
    return { license: ranked[0], licenses: explicitLicenses, inferred: false };
  }
  return { license: "NONE", licenses: [], inferred: true, missing: true };
}

function meetsLicense(candidate, requirement) {
  const inferred = inferredCoachLicense(candidate);
  const candidateLicense = inferred.license;
  const candidateLicenses = inferred.licenses ?? [candidateLicense];
  const minimum = normalizeLicense(requirement?.minimum);
  if (candidateLicenses.some((license) => (
    (LICENSE_RANK[license] ?? 0) >= (LICENSE_RANK[minimum] ?? 0)
  ))) {
    return {
      accepted: true,
      exact: candidateLicenses.includes(minimum),
      candidateLicense,
      candidateLicenses,
      minimum,
      inferred: inferred.inferred,
      missing: inferred.missing === true,
    };
  }
  const accepted = requirement?.allowEquivalent !== false
    && candidateLicenses.some((license) => (
      list(requirement?.acceptedEquivalent).map(normalizeLicense).includes(license)
    ));
  return {
    accepted,
    exact: false,
    candidateLicense,
    candidateLicenses,
    minimum,
    inferred: inferred.inferred,
    missing: inferred.missing === true,
  };
}

function trainingIntensityScore(value, fallback = 50) {
  if (Number.isFinite(Number(value))) return clamp(finite(value, fallback), 0, 100);
  const aliases = {
    very_low: 10,
    low: 25,
    light: 25,
    balanced: 50,
    normal: 50,
    medium: 50,
    high: 75,
    intense: 90,
    very_high: 90,
  };
  return aliases[normalizedText(value).replace(/[\s-]+/gu, "_")] ?? fallback;
}

function styleCompatibility(coach, profile) {
  const preferred = profile.playingStyle.preferred;
  const accepted = profile.playingStyle.accepted;
  const coachStyles = uniqueText([
    ...list(coach?.playStyles),
    ...list(coach?.styles),
    coach?.style,
    coach?.playStyle,
  ]).map(normalizeStyle).filter(Boolean);
  const coachFormations = uniqueText([
    ...list(coach?.preferredFormations),
    ...list(coach?.formations),
    coach?.preferredFormation,
    coach?.formation,
  ]);
  const coachStyle = coachStyles[0] ?? "";
  const coachFormation = coachFormations[0] ?? "";
  let styleScore = preferred.length === 0
    ? 65
    : coachStyles.some((style) => preferred.includes(style))
      ? 100
      : coachStyles.some((style) => accepted.includes(style))
        ? 78
        : 28;
  if (coachStyles.length === 0) styleScore = 45;
  const formationScore = !profile.playingStyle.preferredFormation
    ? 65
    : coachFormations.includes(profile.playingStyle.preferredFormation)
      ? 100
      : coachFormations.some((formation) => profile.playingStyle.acceptedFormations.includes(formation))
        ? 78
        : coachFormations.length > 0 ? 35 : 45;
  const requestedTrainingIntensity = trainingIntensityScore(profile.playingStyle.trainingIntensity);
  const coachTrainingIntensity = trainingIntensityScore(coach?.trainingIntensity);
  const intensityScore = clamp(100 - Math.abs(
    requestedTrainingIntensity - coachTrainingIntensity,
  ) * 1.5, 25, 100);
  return {
    score: styleScore * 0.55 + formationScore * 0.3 + intensityScore * 0.15,
    coachStyle,
    coachFormation,
    coachStyles,
    coachFormations,
    intensityScore,
  };
}

function achievementScore(facts, requirements) {
  const ratios = [
    requirements.minimumNationalTitles > 0 ? facts.nationalTitles / requirements.minimumNationalTitles : facts.nationalTitles ? 1 : 0.65,
    requirements.minimumCups > 0 ? facts.cups / requirements.minimumCups : facts.cups ? 1 : 0.65,
    requirements.minimumContinentalTitles > 0 ? facts.continentalTitles / requirements.minimumContinentalTitles : facts.continentalTitles ? 1 : 0.65,
    requirements.minimumPromotions > 0 ? facts.promotions / requirements.minimumPromotions : facts.promotions ? 1 : 0.65,
  ];
  let score = average(ratios.map((ratio) => clamp(ratio * 100, 0, 100)), 50);
  if (requirements.prioritizeYouthDevelopment) score = score * 0.65 + facts.youthDevelopment * 0.35;
  if (requirements.prioritizeLeagueSurvival) score = score * 0.8 + clamp(50 + facts.leagueSurvival * 12, 0, 100) * 0.2;
  return score;
}

function salaryAssessment(room, state, coach, profile) {
  const contract = currentContract(state, coach?.id);
  const reputation = coachReputation100(coach);
  const requested = Math.max(
    1_000,
    finite(coach?.expectedSalary, 0),
    finite(contract?.wage ?? contract?.salary, 0),
    25_000 + reputation * 2_500,
  );
  const { minimum, ideal, maximum, flexibility } = profile.salary;
  const ratio = requested / Math.max(1, ideal);
  let score;
  if (requested <= ideal && requested >= minimum) score = 100 - Math.abs(1 - ratio) * 15;
  else if (requested < minimum) score = 88;
  else {
    const acceptedCeiling = maximum * (1 + flexibility);
    score = requested <= acceptedCeiling
      ? 70 - ((requested - maximum) / Math.max(1, acceptedCeiling - maximum)) * 35
      : Math.max(0, 30 - ((requested - acceptedCeiling) / Math.max(1, maximum)) * 50);
  }
  return { requested: Math.round(requested), score: clamp(score, 0, 100) };
}

function countryKnowledge(room, coach, profile, experience) {
  const targetCountry = normalizedCountry(profile.geography.country);
  const nationality = normalizedCountry(coach?.nationality ?? coach?.country);
  const preferredNationality = normalizedCountry(profile.geography.preferredNationality);
  const acceptedNationalities = new Set(
    profile.geography.acceptedNationalities.map(normalizedCountry).filter(Boolean),
  );
  const languages = coachLanguages(coach);
  const requiredLanguage = normalizedLanguage(profile.geography.requiredLanguage);
  const acceptedLanguages = new Set(
    profile.geography.acceptedLanguages.map(normalizedLanguage).filter(Boolean),
  );
  const preferredNationalityMatch = Boolean(
    preferredNationality && nationality === preferredNationality,
  );
  const acceptedNationalityMatch = Boolean(
    nationality && acceptedNationalities.has(nationality),
  );
  const nationalityMatch = preferredNationalityMatch
    || acceptedNationalityMatch
    || Boolean(targetCountry && nationality === targetCountry);
  const countryWorked = targetCountry && experience.countries.has(targetCountry);
  const requiredLanguageMatch = !requiredLanguage || languages.has(requiredLanguage);
  const acceptedLanguageMatch = acceptedLanguages.size === 0
    || [...acceptedLanguages].some((language) => languages.has(language));
  const languageMatch = requiredLanguage
    ? requiredLanguageMatch
    : acceptedLanguages.size > 0
      ? acceptedLanguageMatch
      : true;
  const explicitKnowledge = Object.entries(object(coach?.countryKnowledge)).reduce(
    (best, [country, score]) => normalizedCountry(country) === targetCountry
      ? Math.max(best, clamp(finite(score, score === true ? 100 : 0), 0, 100))
      : best,
    0,
  );
  let score = 25;
  if (preferredNationalityMatch) score += 35;
  else if (acceptedNationalityMatch || nationalityMatch) score += 25;
  if (countryWorked) score += 25;
  score += Math.min(10, experience.countryYears * 3);
  if (languageMatch) score += 20;
  else score -= 15;
  score = Math.max(score, explicitKnowledge);
  return {
    score: clamp(score, 0, 100),
    nationalityMatch,
    preferredNationalityMatch,
    acceptedNationalityMatch,
    countryWorked,
    languageMatch,
    requiredLanguageMatch,
    acceptedLanguageMatch,
    languageKnown: languages.size > 0,
    explicitKnowledge,
  };
}

function squadCompatibility(coach, profile, style) {
  const youth = clamp(finite(coach?.youthDevelopment, 50), 0, 100);
  const adaptability = clamp(finite(coach?.adaptability, 50), 0, 100);
  let score = style.score * 0.45 + adaptability * 0.25 + 50 * 0.3;
  if (profile.squad.youngTalentCount >= 4 || profile.playingStyle.youthUsage === "high") {
    score = score * 0.72 + youth * 0.28;
  }
  if (profile.squad.rebuilding) {
    score = score * 0.82 + clamp(finite(coach?.rebuilding, adaptability), 0, 100) * 0.18;
  }
  return clamp(score, 0, 100);
}

function availabilityAssessment(state, coach, now) {
  if (identifier(coach?.status) === "retired") {
    return { score: 0, status: "retired", blocker: true };
  }
  const contract = currentContract(state, coach?.id);
  if (!coach?.currentClubId && !contract) return { score: 100, status: "immediate", blocker: false };
  if (!contract?.endDate) return { score: 55, status: "employed", blocker: false };
  const days = Math.ceil((new Date(contract.endDate).getTime() - new Date(now).getTime()) / DAY_MS);
  if (days <= 0) return { score: 100, status: "immediate", blocker: false };
  if (days <= 180) return { score: 82, status: "precontract", blocker: false };
  return { score: 48, status: "employed", blocker: false };
}

function recentPerformance(state, coachId) {
  const evaluations = list(state?.evaluations)
    .filter((evaluation) => identifier(evaluation?.coachId) === identifier(coachId))
    .sort((left, right) => String(right?.evaluatedAt ?? "").localeCompare(String(left?.evaluatedAt ?? "")));
  return evaluations.length ? clamp(finite(evaluations[0]?.score, 50), 0, 100) : 50;
}

function experienceScore(facts, required) {
  const dimensions = [
    [facts.totalYears, required.minimumYears],
    [facts.youthYears, required.youthYears],
    [facts.professionalYears, required.professionalYears],
    [facts.internationalYears, required.internationalYears],
    [facts.currentDivisionYears, required.currentDivisionYears],
  ];
  return average(dimensions.map(([actual, minimum]) => (
    minimum <= 0 ? 72 : clamp(actual / minimum * 100, 0, 100)
  )), 50);
}

export function evaluateCoachCandidate(room, state, coach, vacancy, now, config = {}) {
  const profile = normalizeVacancyDesiredProfile(vacancy?.desiredProfile ?? vacancy?.profile ?? {});
  const evaluatedAt = timestamp(now, new Date(0).toISOString());
  const configWeights = object(
    config?.selectionWeights
      ?? config?.weights
      ?? config?.candidateWeights,
  );
  const weights = normalizeWeights(
    Object.keys(configWeights).length ? configWeights : profile.weights,
    profile.weights,
  );
  const blockers = [];
  const license = meetsLicense(coach, profile.license);
  const experience = coachExperience(room, coach, { ...profile, clubId: vacancy?.clubId }, now);
  const salary = salaryAssessment(room, state, coach, profile);
  const style = styleCompatibility(coach, profile);
  const achievements = coachAchievements(room, coach);
  const knowledge = countryKnowledge(room, coach, profile, experience);
  const availability = availabilityAssessment(state, coach, now);
  const strictness = profile.strictness;
  const licenseGap = (LICENSE_RANK[license.minimum] ?? 0) - (LICENSE_RANK[license.candidateLicense] ?? 0);
  if (license.missing && strictness === "strict") {
    blockers.push({
      code: "license_missing",
      label: "Licença não informada",
      detail: `A vaga exige licença ${license.minimum}`,
    });
  } else if (!license.missing
    && !license.accepted
    && (strictness === "strict" || (strictness === "balanced" && licenseGap >= 2))) {
    blockers.push({
      code: "license_below_minimum",
      label: "Licença abaixo do mínimo",
      detail: `${license.candidateLicense} não atende ${license.minimum}`,
    });
  }
  if (strictness === "strict" && experience.totalYears < profile.experience.minimumYears) {
    blockers.push({
      code: "experience_below_minimum",
      label: "Experiência abaixo do mínimo",
      detail: `${rounded(experience.totalYears, 1)} < ${profile.experience.minimumYears} anos`,
    });
  }
  const unmetAchievements = [
    ["títulos nacionais", achievements.nationalTitles, profile.achievements.minimumNationalTitles],
    ["copas", achievements.cups, profile.achievements.minimumCups],
    ["títulos continentais", achievements.continentalTitles, profile.achievements.minimumContinentalTitles],
    ["promoções", achievements.promotions, profile.achievements.minimumPromotions],
  ].filter(([, actual, minimum]) => minimum > 0 && actual < minimum);
  if (strictness === "strict" && unmetAchievements.length > 0) {
    blockers.push({
      code: "achievement_requirements_not_met",
      label: "Conquistas abaixo do mínimo",
      detail: unmetAchievements.map(([label, actual, minimum]) => (
        `${label}: ${actual}/${minimum}`
      )).join(" · "),
    });
  }
  const acceptedSalaryCeiling = profile.salary.maximum * (
    strictness === "strict"
      ? 1
      : strictness === "balanced"
        ? 1 + profile.salary.flexibility
        : 1 + profile.salary.flexibility * 1.5
  );
  if (salary.requested > acceptedSalaryCeiling) {
    blockers.push({
      code: "salary_above_limit",
      label: "Pretensão salarial acima do limite",
      detail: `${salary.requested} > ${Math.round(acceptedSalaryCeiling)}`,
    });
  }
  if (availability.blocker) {
    blockers.push({
      code: "coach_unavailable",
      label: "Treinador indisponível",
      detail: availability.status,
    });
  }
  if (profile.countryKnowledge.languageRequired
    && knowledge.languageKnown
    && !knowledge.languageMatch
    && strictness === "strict") {
    blockers.push({
      code: "required_language_missing",
      label: "Idioma obrigatório ausente",
      detail: profile.geography.requiredLanguage,
    });
  }
  if (strictness === "strict" && knowledge.score < profile.countryKnowledge.minimum) {
    blockers.push({
      code: "country_knowledge_below_minimum",
      label: "Conhecimento regional abaixo do mínimo",
      detail: `${rounded(knowledge.score, 1)} < ${profile.countryKnowledge.minimum}`,
    });
  }

  const rawScores = {
    license: license.missing
      ? strictness === "strict" ? 8 : strictness === "balanced" ? 24 : 32
      : license.inferred
        ? license.accepted
          ? 72
          : clamp(48 - Math.max(0, licenseGap) * 12, 12, 48)
      : license.accepted
        ? license.exact ? 100 : 90
        : clamp(55 - Math.max(0, licenseGap) * 22, 0, 55),
    experience: experienceScore(experience, profile.experience),
    recentPerformance: recentPerformance(state, coach?.id),
    reputation: coachReputation100(coach),
    achievements: achievementScore(achievements, profile.achievements),
    salary: salary.score,
    playingStyle: style.score,
    squadCompatibility: squadCompatibility(coach, profile, style),
    countryKnowledge: knowledge.score,
    adaptability: clamp(
      finite(
        coach?.adaptability,
        45 + experience.countries.size * 8 + Math.min(15, experience.internationalYears * 3),
      ),
      0,
      100,
    ),
    availability: clamp(availability.score + (config?.activeSearch === true ? 12 : 0), 0, 100),
  };
  const labels = {
    license: "Licença",
    experience: "Experiência",
    recentPerformance: "Desempenho recente",
    reputation: "Reputação",
    achievements: "Conquistas",
    salary: "Faixa salarial",
    playingStyle: "Estilo de jogo",
    squadCompatibility: "Compatibilidade com o elenco",
    countryKnowledge: "Conhecimento do país",
    adaptability: "Adaptação ao clube",
    availability: "Disponibilidade",
  };
  const details = {
    license: license.missing
      ? `não informada / mínimo ${license.minimum}`
      : `${license.candidateLicense}${license.inferred ? " (inferida)" : ""} / mínimo ${license.minimum}`,
    experience: `${rounded(experience.totalYears, 1)} anos / mínimo ${profile.experience.minimumYears}`,
    recentPerformance: "Última avaliação persistida",
    reputation: `${coachReputation100(coach)}/100`,
    achievements: `${achievements.nationalTitles + achievements.cups + achievements.continentalTitles} títulos registrados`,
    salary: `${salary.requested} / ideal ${profile.salary.ideal}`,
    playingStyle: `${style.coachStyle || "não informado"} · ${style.coachFormation || "formação não informada"}`,
    squadCompatibility: profile.squadSummary,
    countryKnowledge: knowledge.countryWorked ? "Já trabalhou no país" : knowledge.languageMatch ? "Idioma compatível" : "Adaptação necessária",
    adaptability: `${experience.countries.size} país(es) no histórico`,
    availability: config?.activeSearch === true
      ? `${availability.status} · busca ativa`
      : availability.status,
  };
  const factors = Object.keys(DEFAULT_COACH_SELECTION_WEIGHTS).map((code) => ({
    code,
    label: labels[code],
    weight: weights[code],
    rawScore: rounded(rawScores[code], 2),
    weightedScore: rounded(rawScores[code] * weights[code] / 100, 4),
    detail: identifier(details[code]) || null,
  }));
  const tieBreaker = ((hashText(`${vacancy?.id ?? vacancy?.clubId}|${coach?.id}|candidate-fit`) % 201) - 100) / 100;
  const score = rounded(clamp(
    factors.reduce((total, factor) => total + factor.weightedScore, 0),
    0,
    100,
  ), 2);
  return {
    eligible: blockers.length === 0,
    score,
    tieBreaker,
    factors,
    hardBlockers: blockers,
    profileVersion: profile.version,
    evaluatedAt,
  };
}
