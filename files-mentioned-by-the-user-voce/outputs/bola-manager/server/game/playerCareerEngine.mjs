import {
  REQUIRED_ATTRIBUTE_KEYS,
  calculatePlayerOverall,
} from "./lineupStrength.mjs";

export const CAREER_ATTRIBUTE_KEYS = Object.freeze([...REQUIRED_ATTRIBUTE_KEYS]);
export const TRAINING_FOCUSES = Object.freeze([
  "balanced",
  "technical",
  "attacking",
  "defending",
  "physical",
  "goalkeeping",
  "recovery",
]);
export const TRAINING_INTENSITIES = Object.freeze(["low", "normal", "high"]);

const POSITIONS = Object.freeze(["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"]);
const POSITION_SET = new Set(POSITIONS);
const DEFENDERS = new Set(["ZAG", "LD", "LE"]);
const MIDFIELDERS = new Set(["VOL", "MC", "MEI"]);
const ATTACKERS = new Set(["PD", "PE", "ATA"]);

const FOCUS_ATTRIBUTES = Object.freeze({
  balanced: Object.freeze([...CAREER_ATTRIBUTE_KEYS]),
  technical: Object.freeze(["drible", "nocao", "passe", "peBom", "peRuim"]),
  attacking: Object.freeze(["chute", "drible", "velocidade", "nocao", "peBom", "impulsao"]),
  defending: Object.freeze(["defesa", "nocao", "forca", "resistencia", "impulsao", "passe"]),
  physical: Object.freeze(["velocidade", "forca", "resistencia", "impulsao"]),
  goalkeeping: Object.freeze(["reflexos", "posicionamentoGol", "saidaGol", "penaltis", "resistencia"]),
  recovery: Object.freeze([]),
});

const FIRST_NAMES = Object.freeze({
  Brasil: ["Arthur", "Caio", "Davi", "Enzo", "Gabriel", "Joao", "Lucas", "Matheus"],
  Argentina: ["Agustin", "Facundo", "Franco", "Juan", "Lautaro", "Mateo", "Nicolas", "Tomas"],
  Inglaterra: ["Archie", "Charlie", "George", "Harry", "Jack", "James", "Oliver", "William"],
  default: ["Alex", "Daniel", "Elias", "Ivan", "Leo", "Marco", "Noah", "Samuel"],
});

const LAST_NAMES = Object.freeze({
  Brasil: ["Almeida", "Barbosa", "Costa", "Lima", "Oliveira", "Pereira", "Santos", "Silva"],
  Argentina: ["Acosta", "Benitez", "Fernandez", "Gomez", "Martinez", "Romero", "Ruiz", "Suarez"],
  Inglaterra: ["Brown", "Clark", "Harris", "Johnson", "Smith", "Taylor", "Walker", "Wilson"],
  default: ["Costa", "Garcia", "Martin", "Melo", "Ramos", "Reis", "Silva", "Souza"],
});

function identifier(value) {
  return String(value ?? "").trim();
}

function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(number)))
    : fallback;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizedText(value) {
  return identifier(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitFrom(value) {
  return hashText(value) / 0xffffffff;
}

function pick(values, seed) {
  return values[hashText(seed) % values.length];
}

function attributeValue(value, fallback = 10) {
  return rounded(clamp(finite(value, fallback), 1, 20));
}

function normalizeAttributes(attributes, fallback = 10) {
  const source = attributes && typeof attributes === "object" ? attributes : {};
  return Object.fromEntries(CAREER_ATTRIBUTE_KEYS.map((key) => [
    key,
    attributeValue(source[key], fallback),
  ]));
}

function positionOf(value) {
  const position = identifier(value).toUpperCase();
  return POSITION_SET.has(position) ? position : "MC";
}

function positionGroup(positionValue) {
  const position = positionOf(positionValue);
  if (position === "GOL") return "goalkeeper";
  if (DEFENDERS.has(position)) return "defender";
  if (MIDFIELDERS.has(position)) return "midfielder";
  if (ATTACKERS.has(position)) return "attacker";
  return "midfielder";
}

function contractStatus(contract, clubId, seasonNumber, academy, retired) {
  if (retired) return "retired";
  if (academy) return "academy";
  if (!clubId) return "free_agent";
  if (contract?.status === "free_agent") return "free_agent";
  return integer(contract?.endSeason, seasonNumber, 1) < seasonNumber ? "expired" : "active";
}

function normalizeContract(player, seasonNumber, { bootstrapMissingContract = true } = {}) {
  const current = player?.contract && typeof player.contract === "object" ? player.contract : null;
  const academy = player?.academy === true || player?.youth === true || player?.careerStage === "academy";
  const retired = player?.retired === true || player?.careerStage === "retired";
  let clubId = identifier(current?.clubId ?? player?.clubId) || null;
  if (current?.status === "free_agent" || retired) clubId = null;

  if (!current && !clubId) {
    return {
      clubId: null,
      startSeason: null,
      endSeason: null,
      wage: 0,
      status: retired ? "retired" : "free_agent",
      renewalCount: 0,
    };
  }

  const defaultEnd = academy ? seasonNumber + 1 : seasonNumber + 2;
  const startSeason = current
    ? integer(current.startSeason, seasonNumber, 1)
    : bootstrapMissingContract ? seasonNumber : null;
  const endSeason = current
    ? integer(current.endSeason, defaultEnd, 1)
    : bootstrapMissingContract ? defaultEnd : null;
  const status = contractStatus({ ...current, endSeason }, clubId, seasonNumber, academy, retired);
  if (["expired", "free_agent", "retired"].includes(status)) clubId = null;
  return {
    ...(identifier(current?.id) ? { id: identifier(current.id) } : {}),
    clubId,
    startSeason,
    endSeason,
    ...(current?.startDate ? { startDate: String(current.startDate) } : {}),
    ...(current?.endDate ? { endDate: String(current.endDate) } : {}),
    ...(identifier(current?.transferId) ? { transferId: identifier(current.transferId) } : {}),
    wage: Math.max(0, rounded(finite(current?.wage ?? player?.wage, academy ? 1_000 : 10_000), 2)),
    status,
    renewalCount: integer(current?.renewalCount, 0),
  };
}

function currentOverall(player, attributes) {
  return calculatePlayerOverall({ ...player, attributes }, finite(player?.overall, 10));
}

/** Normalize legacy/catalog players into save-scoped career records. */
export function normalizeCareerPlayer(player, {
  seasonNumber = 1,
  bootstrapMissingContract = true,
} = {}) {
  const id = identifier(player?.id);
  if (!id) throw new TypeError("Jogador sem ID para ciclo de carreira");
  const position = positionOf(player?.position);
  const fallback = clamp(finite(player?.overall, 10), 1, 20);
  const attributes = normalizeAttributes(player?.attributes, fallback);
  const overall = currentOverall({ ...player, position }, attributes);
  const potential = attributeValue(player?.potential, Math.min(20, overall + (integer(player?.age, 24, 14, 60) <= 21 ? 4 : 2)));
  const contract = normalizeContract(player, seasonNumber, { bootstrapMissingContract });
  const retired = player?.retired === true || contract.status === "retired";
  const academy = !retired && (player?.academy === true || player?.youth === true || player?.careerStage === "academy");
  const clubId = contract.clubId ?? (!retired && academy ? identifier(player?.clubId) || null : null);

  return {
    ...player,
    id,
    clubId,
    position,
    age: integer(player?.age, 24, 14, 60),
    nationality: identifier(player?.nationality) || "Brasil",
    attributes,
    overall,
    potential: Math.max(overall, potential),
    academy,
    youth: academy,
    retired,
    careerStage: retired ? "retired" : academy ? "academy" : "senior",
    active: retired ? false : player?.active !== false,
    contract: { ...contract, clubId },
  };
}

function renewalMap(renewals) {
  const values = Array.isArray(renewals)
    ? renewals
    : renewals && typeof renewals === "object"
      ? Object.entries(renewals).map(([playerId, renewal]) => ({ playerId, ...renewal }))
      : [];
  return new Map(values.map((renewal) => [identifier(renewal?.playerId), renewal]));
}

/** Expire, renew and bootstrap contracts for one season, without mutating input. */
export function resolveContractCycle(players, {
  seasonNumber = 1,
  renewals = [],
  defaultContractYears = 2,
  bootstrapMissingContracts = true,
} = {}) {
  const season = integer(seasonNumber, 1, 1);
  const renewalByPlayer = renewalMap(renewals);
  const report = { renewedPlayerIds: [], expiredPlayerIds: [], freeAgentPlayerIds: [], bootstrappedPlayerIds: [] };
  const result = (Array.isArray(players) ? players : []).map((source) => {
    const hadContract = Boolean(source?.contract && typeof source.contract === "object");
    const sourceClubId = identifier(source?.contract?.clubId ?? source?.clubId) || null;
    let player = normalizeCareerPlayer(source, {
      seasonNumber: season,
      bootstrapMissingContract: bootstrapMissingContracts,
    });
    if (!hadContract && player.clubId && bootstrapMissingContracts) report.bootstrappedPlayerIds.push(player.id);
    if (player.retired || player.academy) return player;

    const renewal = renewalByPlayer.get(player.id);
    if (renewal && sourceClubId) {
      const years = integer(renewal.years, defaultContractYears, 1, 8);
      player = {
        ...player,
        wage: Math.max(0, rounded(finite(renewal.wage, player.contract.wage), 2)),
        clubId: sourceClubId,
        contract: {
          ...player.contract,
          clubId: sourceClubId,
          startSeason: Math.min(player.contract.startSeason ?? season, season),
          endSeason: season + years - 1,
          wage: Math.max(0, rounded(finite(renewal.wage, player.contract.wage), 2)),
          status: "active",
          renewalCount: player.contract.renewalCount + 1,
        },
      };
      report.renewedPlayerIds.push(player.id);
      return player;
    }

    if (player.contract.status === "expired" || (player.contract.endSeason ?? season) < season) {
      player = {
        ...player,
        clubId: null,
        contract: { ...player.contract, clubId: null, status: "free_agent" },
      };
      report.expiredPlayerIds.push(player.id);
      report.freeAgentPlayerIds.push(player.id);
    } else if (player.contract.status === "free_agent") {
      report.freeAgentPlayerIds.push(player.id);
    }
    return player;
  });
  return { players: result, ...report };
}

export function normalizeTrainingPlans(plans) {
  const values = Array.isArray(plans) ? plans : [];
  const normalized = new Map();
  for (const plan of values) {
    const playerId = identifier(plan?.playerId);
    if (!playerId) continue;
    const focus = TRAINING_FOCUSES.includes(plan?.focus) ? plan.focus : "balanced";
    const intensity = TRAINING_INTENSITIES.includes(plan?.intensity) ? plan.intensity : "normal";
    normalized.set(playerId, { playerId, focus, intensity, active: plan?.active !== false });
  }
  return [...normalized.values()].sort((left, right) => left.playerId.localeCompare(right.playerId));
}

function planFor(player, planByPlayer) {
  if (player.retired || player.active === false) return { playerId: player.id, focus: "recovery", intensity: "low", active: false };
  return planByPlayer.get(player.id) ?? { playerId: player.id, focus: "balanced", intensity: "normal", active: true };
}

function ageCurve(player) {
  const age = integer(player.age, 24, 14, 60);
  const group = positionGroup(player.position);
  if (age <= 18) return 0.9;
  if (age <= 21) return 0.7;
  if (age <= 24) return 0.45;
  if (age <= 28) return 0.18;
  if (age <= 30) return 0.04;
  if (group === "goalkeeper" && age <= 33) return 0.02;
  if (age <= 33) return -0.28;
  if (group === "goalkeeper" && age <= 36) return -0.2;
  return age <= 36 ? -0.52 : -0.75;
}

function developmentDelta(player, plan, minutes) {
  const curve = ageCurve(player);
  const intensity = plan.intensity === "high" ? 1.2 : plan.intensity === "low" ? 0.72 : 1;
  const playingTime = clamp(finite(minutes, 0) / 2_700, 0, 1);
  if (curve < 0) return curve * (plan.focus === "recovery" ? 0.72 : intensity);
  const potentialGap = clamp((finite(player.potential, player.overall) - player.overall) / 7, 0, 1);
  return curve * intensity * (0.45 + playingTime * 0.25 + potentialGap * 0.55);
}

function attributeMultiplier(key, plan, curve, player) {
  const selected = FOCUS_ATTRIBUTES[plan.focus] ?? FOCUS_ATTRIBUTES.balanced;
  let multiplier = selected.includes(key) ? (plan.focus === "balanced" ? 1 : 1.45) : 0.42;
  if (curve < 0 && ["velocidade", "resistencia", "forca", "impulsao"].includes(key)) multiplier *= 1.35;
  if (curve < 0 && positionGroup(player.position) === "goalkeeper" && ["reflexos", "posicionamentoGol"].includes(key)) multiplier *= 0.65;
  if (plan.focus === "recovery") multiplier = curve < 0 ? 0.65 : 0;
  return multiplier;
}

/** Age players one year and apply potential/training/minutes based development. */
export function applyAnnualPlayerDevelopment(players, {
  seasonNumber = 1,
  trainingPlans = [],
  minutesByPlayer = {},
} = {}) {
  const season = integer(seasonNumber, 1, 1);
  const planByPlayer = new Map(normalizeTrainingPlans(trainingPlans).map((plan) => [plan.playerId, plan]));
  const changes = [];
  const developed = (Array.isArray(players) ? players : []).map((source) => {
    const player = normalizeCareerPlayer(source, { seasonNumber: season });
    if (player.retired) return player;
    const plan = planFor(player, planByPlayer);
    const age = Math.min(60, player.age + 1);
    const aged = { ...player, age };
    const curve = ageCurve(aged);
    const minutes = minutesByPlayer instanceof Map
      ? minutesByPlayer.get(player.id)
      : minutesByPlayer?.[player.id];
    const delta = developmentDelta(aged, plan, minutes);
    const attributes = Object.fromEntries(CAREER_ATTRIBUTE_KEYS.map((key) => [
      key,
      attributeValue(player.attributes[key] + delta * attributeMultiplier(key, plan, curve, aged)),
    ]));
    const overall = currentOverall(aged, attributes);
    const potential = age >= 30
      ? Math.max(overall, attributeValue(player.potential - Math.max(0, age - 31) * 0.12, overall))
      : Math.max(overall, player.potential);
    changes.push({
      playerId: player.id,
      ageBefore: player.age,
      ageAfter: age,
      overallBefore: player.overall,
      overallAfter: overall,
      delta: rounded(overall - player.overall),
      focus: plan.focus,
    });
    return {
      ...aged,
      attributes,
      overall,
      potential,
      training: plan,
      lastDevelopmentSeason: season,
    };
  });
  return { players: developed, changes };
}

/** Apply a shorter weekly training cycle; useful between rounds. */
export function applyTrainingCycle(players, {
  seasonNumber = 1,
  plans = [],
  cycleId = "week-1",
  clubEffects = {},
} = {}) {
  const planByPlayer = new Map(normalizeTrainingPlans(plans).map((plan) => [plan.playerId, plan]));
  const effects = [];
  const trained = (Array.isArray(players) ? players : []).map((source) => {
    const player = normalizeCareerPlayer(source, { seasonNumber });
    const plan = planFor(player, planByPlayer);
    if (!plan.active || player.retired) return player;
    const clubId = identifier(player.currentClubId ?? player.clubId);
    const clubEffect = clubEffects?.[clubId.toLocaleUpperCase("pt-BR")]
      ?? clubEffects?.[clubId]
      ?? {};
    const developmentMultiplier = clamp(finite(clubEffect.developmentMultiplier, 1), 1, 1.35);
    const goalkeeperDevelopmentMultiplier = positionGroup(player.position) === "goalkeeper"
      ? clamp(finite(clubEffect.goalkeeperDevelopmentMultiplier, 1), 1, 1.2)
      : 1;
    const injuryRiskMultiplier = clamp(finite(clubEffect.injuryRiskMultiplier, 1), 0.5, 1);
    const recoveryBonus = clamp(finite(clubEffect.recoveryBonus), 0, 8);
    const base = plan.intensity === "high" ? 0.055 : plan.intensity === "low" ? 0.018 : 0.032;
    const potentialRoom = clamp(player.potential - player.overall, 0, 8) / 8;
    const gain = plan.focus === "recovery"
      ? 0
      : base * (0.35 + potentialRoom * 0.65) * developmentMultiplier * goalkeeperDevelopmentMultiplier;
    const attributes = Object.fromEntries(CAREER_ATTRIBUTE_KEYS.map((key) => [
      key,
      attributeValue(player.attributes[key] + (FOCUS_ATTRIBUTES[plan.focus]?.includes(key) ? gain : gain * 0.18)),
    ]));
    const rawConditionDelta = plan.focus === "recovery" ? 7 : plan.intensity === "high" ? -5 : plan.intensity === "low" ? -1 : -3;
    const conditionDelta = rounded(rawConditionDelta + recoveryBonus, 1);
    const condition = clamp(finite(player.condition, 100) + conditionDelta, 0, 100);
    const injuryRisk = plan.focus === "recovery" ? 0 : rounded((plan.intensity === "high" ? 0.06 : plan.intensity === "low" ? 0.01 : 0.025)
      * (1 + Math.max(0, 75 - condition) / 50)
      * injuryRiskMultiplier);
    const overall = currentOverall(player, attributes);
    effects.push({
      playerId: player.id,
      clubId: clubId || null,
      focus: plan.focus,
      intensity: plan.intensity,
      conditionDelta,
      injuryRisk,
      developmentMultiplier,
      goalkeeperDevelopmentMultiplier,
      injuryRiskMultiplier,
      recoveryBonus,
    });
    return { ...player, attributes, overall, condition, training: plan, lastTrainingCycleId: identifier(cycleId) };
  });
  return { players: trained, effects };
}

export function retirementDecision(playerValue, { seasonNumber = 1, seed = "bola-manager" } = {}) {
  const player = normalizeCareerPlayer(playerValue, { seasonNumber });
  if (player.retired) return { retire: true, probability: 1, score: 0, reason: "already_retired" };
  if (player.academy) return { retire: false, probability: 0, score: 1, reason: "academy" };
  const goalkeeper = positionGroup(player.position) === "goalkeeper";
  const earliestAge = goalkeeper ? 35 : 32;
  const certainAge = goalkeeper ? 44 : 41;
  if (player.age < earliestAge) return { retire: false, probability: 0, score: 1, reason: "too_young" };
  if (player.age >= certainAge) return { retire: true, probability: 1, score: 0, reason: "age_limit" };
  const ageProbability = (player.age - earliestAge + 1) * (goalkeeper ? 0.07 : 0.085);
  const qualityAdjustment = Math.max(0, 10 - player.overall) * 0.018;
  const injuryAdjustment = Math.min(0.12, finite(player?.careerStats?.injuries, 0) * 0.006);
  const probability = rounded(clamp(ageProbability + qualityAdjustment + injuryAdjustment, 0, 0.92));
  const score = rounded(unitFrom(`${seed}|retirement|${seasonNumber}|${player.id}|${player.age}`), 6);
  return { retire: score < probability, probability, score, reason: score < probability ? "career_end" : "continues" };
}

export function resolveRetirements(players, options = {}) {
  const retiredPlayerIds = [];
  const decisions = [];
  const result = (Array.isArray(players) ? players : []).map((source) => {
    const player = normalizeCareerPlayer(source, { seasonNumber: options.seasonNumber });
    const decision = retirementDecision(player, options);
    decisions.push({ playerId: player.id, ...decision });
    if (!decision.retire || player.retired) return player;
    retiredPlayerIds.push(player.id);
    return {
      ...player,
      clubId: null,
      active: false,
      academy: false,
      retired: true,
      careerStage: "retired",
      retirementSeason: integer(options.seasonNumber, 1, 1),
      contract: { ...player.contract, clubId: null, status: "retired" },
    };
  });
  return { players: result, retiredPlayerIds, decisions };
}

function countryName(club) {
  const normalized = normalizedText(club?.country);
  if (["br", "bra", "brasil", "brazil"].includes(normalized)) return "Brasil";
  if (["ar", "arg", "argentina"].includes(normalized)) return "Argentina";
  if (["gb", "gb-eng", "eng", "inglaterra", "england"].includes(normalized)) return "Inglaterra";
  return identifier(club?.country) || "Brasil";
}

function youthPosition(index, seed) {
  const rotation = ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
  return rotation[(index + hashText(seed)) % rotation.length];
}

/**
 * Normaliza a qualidade da base sem gravar o bonus derivado no catalogo.
 * Saves antigos continuam aceitos por `youthQualityBonus`; os novos guardam
 * separadamente estrutura e treinador para evitar somar o mesmo bonus duas vezes.
 */
export function youthDevelopmentProfileForClub(club = {}) {
  const source = club?.youthDevelopment && typeof club.youthDevelopment === "object"
    ? club.youthDevelopment
    : club?.youthDevelopmentProfile && typeof club.youthDevelopmentProfile === "object"
      ? club.youthDevelopmentProfile
      : {};
  const baseAcademyQuality = clamp(finite(
    source.baseAcademyQuality
      ?? club?.academyLevel
      ?? club?.youthRating
      ?? club?.reputation,
    10,
  ), 1, 20);
  const hasDetailedBonuses = source.infrastructureBonus != null
    || source.staffBonus != null
    || club?.infrastructureYouthQualityBonus != null
    || club?.staffYouthQualityBonus != null;
  const legacyBonus = hasDetailedBonuses
    ? 0
    : finite(source.totalBonus ?? club?.youthQualityBonus, 0);
  const infrastructureBonus = clamp(finite(
    source.infrastructureBonus ?? club?.infrastructureYouthQualityBonus,
    legacyBonus,
  ), 0, 5);
  const staffBonus = clamp(finite(
    source.staffBonus ?? club?.staffYouthQualityBonus,
    0,
  ), 0, 2);
  const totalBonus = rounded(infrastructureBonus + staffBonus, 3);
  return {
    schemaVersion: 1,
    baseAcademyQuality: rounded(baseAcademyQuality, 3),
    infrastructureBonus: rounded(infrastructureBonus, 3),
    staffBonus: rounded(staffBonus, 3),
    totalBonus,
    effectiveAcademyQuality: rounded(clamp(baseAcademyQuality + totalBonus, 1, 20), 3),
  };
}

function youthAttributes({ club, position, seed }) {
  const academyQuality = youthDevelopmentProfileForClub(club).effectiveAcademyQuality;
  const baseline = clamp(4.5 + academyQuality * 0.33 + unitFrom(`${seed}|base`) * 2.2, 4, 13);
  const focus = position === "GOL"
    ? FOCUS_ATTRIBUTES.goalkeeping
    : DEFENDERS.has(position) ? FOCUS_ATTRIBUTES.defending
      : MIDFIELDERS.has(position) ? FOCUS_ATTRIBUTES.technical
        : FOCUS_ATTRIBUTES.attacking;
  return Object.fromEntries(CAREER_ATTRIBUTE_KEYS.map((key) => {
    const noise = (unitFrom(`${seed}|attribute|${key}`) - 0.5) * 2.4;
    const positional = focus.includes(key) ? 1.4 : -0.3;
    return [key, attributeValue(baseline + noise + positional)];
  }));
}

function slug(value) {
  return normalizedText(value).replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "club";
}

/** Generate deterministic academy intakes. Same save/season/clubs => same players and IDs. */
export function generateYouthIntake({
  clubs = [],
  seasonNumber = 1,
  countPerClub = 3,
  seed = "bola-manager",
} = {}) {
  const season = integer(seasonNumber, 1, 1);
  const count = integer(countPerClub, 3, 0, 12);
  const players = [];
  for (const club of [...(Array.isArray(clubs) ? clubs : [])].sort((a, b) => identifier(a?.id).localeCompare(identifier(b?.id)))) {
    const clubId = identifier(club?.id);
    if (!clubId || club?.active === false) continue;
    const nationality = countryName(club);
    const youthDevelopment = youthDevelopmentProfileForClub(club);
    const firstNames = FIRST_NAMES[nationality] ?? FIRST_NAMES.default;
    const lastNames = LAST_NAMES[nationality] ?? LAST_NAMES.default;
    for (let index = 0; index < count; index += 1) {
      const playerSeed = `${seed}|academy|${clubId}|${season}|${index}`;
      const position = youthPosition(index, playerSeed);
      const attributes = youthAttributes({ club, position, seed: playerSeed });
      const name = `${pick(firstNames, `${playerSeed}|first`)} ${pick(lastNames, `${playerSeed}|last`)}`;
      const id = `academy-${slug(clubId)}-${season}-${index + 1}-${hashText(playerSeed).toString(36)}`;
      const overall = currentOverall({ position }, attributes);
      const academyQuality = youthDevelopment.effectiveAcademyQuality;
      const potential = Math.max(overall, attributeValue(10 + academyQuality * 0.42 + unitFrom(`${playerSeed}|potential`) * 3.5));
      players.push(normalizeCareerPlayer({
        id,
        clubId,
        name,
        position,
        age: 15 + (hashText(`${playerSeed}|age`) % 4),
        nationality,
        attributes,
        overall,
        potential,
        academy: true,
        careerStage: "academy",
        active: true,
        generatedSeason: season,
        youthIntake: {
          ...youthDevelopment,
          generatedSeason: season,
        },
        contract: {
          clubId,
          startSeason: season,
          endSeason: season + 2,
          wage: 1_000 + overall * 150,
          status: "academy",
          renewalCount: 0,
        },
      }, { seasonNumber: season }));
    }
  }
  return players;
}

export function promoteYouthPlayer(playerValue, {
  seasonNumber = 1,
  contractYears = 3,
  wage = null,
} = {}) {
  const season = integer(seasonNumber, 1, 1);
  const player = normalizeCareerPlayer(playerValue, { seasonNumber: season });
  if (!player.academy) throw new TypeError("Jogador nao pertence a categoria de base");
  if (player.age < 16) throw new RangeError("Jogador precisa ter ao menos 16 anos para promocao");
  const years = integer(contractYears, 3, 1, 8);
  const salary = Math.max(0, rounded(finite(wage, 4_000 + player.overall * 1_000), 2));
  return {
    ...player,
    academy: false,
    youth: false,
    careerStage: "senior",
    promotedSeason: season,
    wage: salary,
    contract: {
      clubId: player.clubId,
      startSeason: season,
      endSeason: season + years - 1,
      wage: salary,
      status: "active",
      renewalCount: 0,
    },
  };
}

export function promoteYouthPlayers(players, playerIds, options = {}) {
  const selected = new Set((Array.isArray(playerIds) ? playerIds : []).map(identifier));
  const promotedPlayerIds = [];
  const result = (Array.isArray(players) ? players : []).map((player) => {
    if (!selected.has(identifier(player?.id))) return normalizeCareerPlayer(player, { seasonNumber: options.seasonNumber });
    const promoted = promoteYouthPlayer(player, options);
    promotedPlayerIds.push(promoted.id);
    return promoted;
  });
  return { players: result, promotedPlayerIds };
}

function teamAliases(team) {
  return new Set([
    team?.id,
    team?.code,
    team?.country,
    team?.name,
    ...(Array.isArray(team?.aliases) ? team.aliases : []),
  ].map(normalizedText).filter(Boolean));
}

export function nationalTeamEligibility(playerValue, team, { seasonNumber = 1 } = {}) {
  const player = normalizeCareerPlayer(playerValue, { seasonNumber });
  const teamId = identifier(team?.id ?? team?.code);
  if (!teamId) return { eligible: false, reason: "invalid_team" };
  if (player.retired || player.active === false) return { eligible: false, reason: "inactive" };
  if (player.age < integer(team?.minimumAge, 16, 14, 60)) return { eligible: false, reason: "underage" };
  if (team?.maximumAge && player.age > integer(team.maximumAge, 60, 14, 60)) return { eligible: false, reason: "overage" };
  const tiedTeam = identifier(player?.nationalTeamId);
  if (tiedTeam && integer(player?.internationalCaps) > 0 && normalizedText(tiedTeam) !== normalizedText(teamId)) {
    return { eligible: false, reason: "cap_tied" };
  }
  const aliases = teamAliases(team);
  const nationalities = [
    player.nationality,
    ...(Array.isArray(player?.eligibleNationalities) ? player.eligibleNationalities : []),
  ].map(normalizedText).filter(Boolean);
  return nationalities.some((nationality) => aliases.has(nationality))
    ? { eligible: true, reason: "nationality" }
    : { eligible: false, reason: "nationality_mismatch" };
}

function squadQuotas(size) {
  const goalkeepers = Math.min(size, Math.max(1, Math.round(size * 0.13)));
  const defenders = Math.min(size - goalkeepers, Math.max(0, Math.round(size * 0.35)));
  const midfielders = Math.min(size - goalkeepers - defenders, Math.max(0, Math.round(size * 0.3)));
  return { goalkeeper: goalkeepers, defender: defenders, midfielder: midfielders, attacker: size - goalkeepers - defenders - midfielders };
}

function selectionOrder(left, right, seed) {
  return right.overall - left.overall
    || right.potential - left.potential
    || unitFrom(`${seed}|${right.id}`) - unitFrom(`${seed}|${left.id}`)
    || left.id.localeCompare(right.id);
}

export function selectNationalTeamSquad(team, players, {
  seasonNumber = 1,
  squadSize = 23,
  seed = "bola-manager",
} = {}) {
  const size = integer(squadSize, 23, 1, 40);
  const teamId = identifier(team?.id ?? team?.code);
  const eligible = (Array.isArray(players) ? players : [])
    .map((player) => normalizeCareerPlayer(player, { seasonNumber }))
    .filter((player) => nationalTeamEligibility(player, team, { seasonNumber }).eligible)
    .sort((left, right) => selectionOrder(left, right, `${seed}|${teamId}|${seasonNumber}`));
  const quotas = squadQuotas(size);
  const selected = [];
  const selectedIds = new Set();
  for (const [group, quota] of Object.entries(quotas)) {
    eligible.filter((player) => positionGroup(player.position) === group).slice(0, quota).forEach((player) => {
      selected.push(player);
      selectedIds.add(player.id);
    });
  }
  for (const player of eligible) {
    if (selected.length >= size) break;
    if (!selectedIds.has(player.id)) {
      selected.push(player);
      selectedIds.add(player.id);
    }
  }
  return {
    teamId,
    seasonNumber: integer(seasonNumber, 1, 1),
    squadSize: selected.length,
    playerIds: selected.map((player) => player.id),
    players: selected,
    eligibleCount: eligible.length,
  };
}

/** Batch selection prevents dual-national players being called by two teams. */
export function selectNationalTeamSquads(nationalTeams, players, options = {}) {
  const unavailable = new Set();
  return [...(Array.isArray(nationalTeams) ? nationalTeams : [])]
    .sort((left, right) => identifier(left?.id ?? left?.code).localeCompare(identifier(right?.id ?? right?.code)))
    .map((team) => {
      const available = (Array.isArray(players) ? players : []).filter((player) => !unavailable.has(identifier(player?.id)));
      const squad = selectNationalTeamSquad(team, available, options);
      squad.playerIds.forEach((playerId) => unavailable.add(playerId));
      return squad;
    });
}

/** Complete pure transition. RoomStore may persist returned state atomically. */
export function processCareerSeasonTransition(state, {
  toSeason = integer(state?.currentSeason, 1, 1) + 1,
  roster = state?.players ?? [],
  clubs = state?.clubs ?? [],
  renewals = [],
  trainingPlans = state?.trainingPlans ?? [],
  minutesByPlayer = {},
  youthCountPerClub = 3,
  nationalTeams = state?.nationalTeams ?? [],
  nationalSquadSize = 23,
  seed = identifier(state?.saveId) || "bola-manager",
} = {}) {
  const seasonNumber = integer(toSeason, integer(state?.currentSeason, 1, 1) + 1, 1);
  const sourcePlayers = Array.isArray(roster) ? roster : [];
  if (integer(state?.lastCareerTransitionSeason, 0) >= seasonNumber) {
    const careerState = { ...state, players: sourcePlayers };
    const summary = { seasonNumber, skipped: true, reason: "season_already_processed" };
    return { careerState, players: sourcePlayers, summary, state: careerState, report: summary };
  }
  const development = applyAnnualPlayerDevelopment(sourcePlayers, {
    seasonNumber,
    trainingPlans,
    minutesByPlayer,
  });
  const contracts = resolveContractCycle(development.players, { seasonNumber, renewals });
  const retirements = resolveRetirements(contracts.players, { seasonNumber, seed });
  const intake = generateYouthIntake({ clubs, seasonNumber, countPerClub: youthCountPerClub, seed });
  const existingIds = new Set(retirements.players.map((player) => player.id));
  const uniqueIntake = intake.filter((player) => !existingIds.has(player.id));
  const players = [...retirements.players, ...uniqueIntake];
  const squads = selectNationalTeamSquads(nationalTeams, players, {
    seasonNumber,
    squadSize: nationalSquadSize,
    seed,
  });
  const careerState = {
    ...state,
    currentSeason: seasonNumber,
    players,
    trainingPlans: normalizeTrainingPlans(trainingPlans),
    nationalSquads: squads,
    nationalTeamSquads: squads,
    lastCareerTransitionSeason: seasonNumber,
  };
  const summary = {
    seasonNumber,
    development: development.changes,
    contracts: {
      renewedPlayerIds: contracts.renewedPlayerIds,
      expiredPlayerIds: contracts.expiredPlayerIds,
      freeAgentPlayerIds: contracts.freeAgentPlayerIds,
      bootstrappedPlayerIds: contracts.bootstrappedPlayerIds,
    },
    retiredPlayerIds: retirements.retiredPlayerIds,
    generatedYouthPlayerIds: uniqueIntake.map((player) => player.id),
    nationalTeamSquads: squads.map((squad) => ({ teamId: squad.teamId, playerIds: squad.playerIds })),
  };
  return {
    careerState,
    players,
    summary,
    // Compatibility aliases for callers that model the whole transition as state/report.
    state: careerState,
    report: summary,
  };
}
