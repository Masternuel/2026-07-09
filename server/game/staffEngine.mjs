const STAFF_SCHEMA_VERSION = 2;
const MAX_HISTORY = 500;
const MAX_OPERATIONS = 500;
const MAX_MONEY = 2_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export const STAFF_ROLES = Object.freeze([
  "assistant_coach",
  "fitness_coach",
  "goalkeeper_coach",
  "physiotherapist",
  "doctor",
  "performance_analyst",
  "scout",
  "football_director",
  "youth_coach",
]);

export const STAFF_ATTRIBUTE_KEYS = Object.freeze([
  "coaching",
  "tactical",
  "fitness",
  "goalkeeping",
  "medical",
  "analysis",
  "scouting",
  "youthDevelopment",
  "manManagement",
  "motivation",
  "negotiation",
]);

const ROLE_SET = new Set(STAFF_ROLES);
const MEMBER_STATUS = new Set([
  "employed",
  "free_agent",
  "retired",
  "suspended",
  "notice",
  "on_leave",
  "retiring",
]);
const CONTRACT_STATUS = new Set(["active", "expired", "terminated", "replaced"]);
const AFFILIATION_TYPES = new Set([
  "independent",
  "personal_team",
  "coach_recommended",
  "inherited",
]);
const CONTRACT_LIFECYCLE_STATUS = new Set([
  "active",
  "notice",
  "on_leave",
  "retiring",
  "separated",
  "retired",
  "expired",
  "terminated",
  "replaced",
]);

const ROLE_LABELS = Object.freeze({
  assistant_coach: "Auxiliar técnico",
  fitness_coach: "Preparador físico",
  goalkeeper_coach: "Treinador de goleiros",
  physiotherapist: "Fisioterapeuta",
  doctor: "Médico",
  performance_analyst: "Analista de desempenho",
  scout: "Olheiro",
  football_director: "Diretor de futebol",
  youth_coach: "Treinador da base",
});

const ROLE_ALIASES = Object.freeze({
  "auxiliar tecnico": "assistant_coach",
  "auxiliar tecnica": "assistant_coach",
  "assistant coach": "assistant_coach",
  "preparador fisico": "fitness_coach",
  "preparadora fisica": "fitness_coach",
  "fitness coach": "fitness_coach",
  "treinador de goleiros": "goalkeeper_coach",
  "treinadora de goleiros": "goalkeeper_coach",
  "goalkeeper coach": "goalkeeper_coach",
  fisioterapeuta: "physiotherapist",
  physiotherapist: "physiotherapist",
  medico: "doctor",
  medica: "doctor",
  doctor: "doctor",
  "analista de desempenho": "performance_analyst",
  "performance analyst": "performance_analyst",
  olheiro: "scout",
  "chefe de scout": "scout",
  scout: "scout",
  "diretor de futebol": "football_director",
  "diretora de futebol": "football_director",
  "football director": "football_director",
  "treinador da base": "youth_coach",
  "treinadora da base": "youth_coach",
  "youth coach": "youth_coach",
});

const ROLE_SPECIALTIES = Object.freeze({
  assistant_coach: Object.freeze(["Leitura de jogo", "Familiaridade tática"]),
  fitness_coach: Object.freeze(["Preparação física", "Prevenção de fadiga"]),
  goalkeeper_coach: Object.freeze(["Desenvolvimento de goleiros", "Bolas paradas"]),
  physiotherapist: Object.freeze(["Recuperação", "Prevenção de lesões"]),
  doctor: Object.freeze(["Diagnóstico", "Medicina esportiva"]),
  performance_analyst: Object.freeze(["Análise do adversário", "Dados táticos"]),
  scout: Object.freeze(["Observação", "Mercado internacional"]),
  football_director: Object.freeze(["Negociação", "Gestão de elenco"]),
  youth_coach: Object.freeze(["Formação de jovens", "Desenvolvimento técnico"]),
});

const ROLE_ATTRIBUTE_WEIGHTS = Object.freeze({
  assistant_coach: Object.freeze({ coaching: 1, tactical: 1.4, manManagement: 0.9, motivation: 0.7 }),
  fitness_coach: Object.freeze({ fitness: 1.5, coaching: 0.8, medical: 0.4, motivation: 0.4 }),
  goalkeeper_coach: Object.freeze({ goalkeeping: 1.7, coaching: 1, tactical: 0.3 }),
  physiotherapist: Object.freeze({ medical: 1.5, fitness: 0.8, manManagement: 0.3 }),
  doctor: Object.freeze({ medical: 1.8, analysis: 0.6, manManagement: 0.2 }),
  performance_analyst: Object.freeze({ analysis: 1.6, tactical: 1.1, scouting: 0.4 }),
  scout: Object.freeze({ scouting: 1.8, analysis: 0.8, negotiation: 0.2 }),
  football_director: Object.freeze({ negotiation: 1.7, manManagement: 1, scouting: 0.4 }),
  youth_coach: Object.freeze({ youthDevelopment: 1.8, coaching: 1, motivation: 0.5 }),
});

const FIRST_NAMES = Object.freeze([
  "Alex", "Bruno", "Caio", "Carla", "Clara", "Daniel", "Eduardo", "Fernanda",
  "Gabriel", "Helena", "Isabela", "João", "Laura", "Lucas", "Marina", "Rafael",
  "Renata", "Sofia", "Thiago", "Vitor",
]);
const LAST_NAMES = Object.freeze([
  "Almeida", "Barbosa", "Campos", "Costa", "Ferreira", "Lima", "Martins", "Mendes",
  "Oliveira", "Pereira", "Ramos", "Reis", "Rocha", "Santos", "Silva", "Souza",
]);
const NATIONALITIES = Object.freeze(["Brasil", "Argentina", "Uruguai", "Portugal", "Espanha", "Inglaterra"]);

export class StaffError extends Error {
  constructor(message, code, status = 400, details = undefined) {
    super(message);
    this.name = "StaffError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
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

function clubKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
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

function rounded(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function timestamp(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new StaffError("Data inválida", "STAFF_DATE_INVALID", 400);
  return date.toISOString();
}

function addYears(value, years) {
  const date = new Date(timestamp(value));
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicInteger(seed, minimum, maximum) {
  return minimum + (hashText(seed) % (maximum - minimum + 1));
}

function deterministicId(prefix, seed) {
  return `${prefix}-${hashText(seed).toString(36)}`;
}

function normalizeRole(value) {
  const direct = identifier(value);
  if (ROLE_SET.has(direct)) return direct;
  return ROLE_ALIASES[normalizedText(value)] ?? null;
}

function roleRating(attributes, role) {
  const weights = ROLE_ATTRIBUTE_WEIGHTS[role] ?? ROLE_ATTRIBUTE_WEIGHTS.assistant_coach;
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return total > 0
    ? rounded(entries.reduce((sum, [key, weight]) => sum + finite(attributes?.[key], 1) * weight, 0) / total, 2)
    : 1;
}

function normalizeAttributes(value, fallbackRating = 10, role = "assistant_coach") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacyRating = finite(fallbackRating, 10);
  const fallback = legacyRating <= 10 ? legacyRating * 2 : legacyRating;
  const primary = new Set(Object.keys(ROLE_ATTRIBUTE_WEIGHTS[role] ?? {}));
  return Object.fromEntries(STAFF_ATTRIBUTE_KEYS.map((key) => [
    key,
    rounded(clamp(finite(source[key], primary.has(key) ? fallback : Math.max(1, fallback - 4)), 1, 20), 1),
  ]));
}

function deterministicAttributes(seed, role, qualityOffset = 0) {
  const primary = new Set(Object.keys(ROLE_ATTRIBUTE_WEIGHTS[role] ?? {}));
  return Object.fromEntries(STAFF_ATTRIBUTE_KEYS.map((key) => {
    const minimum = primary.has(key) ? 10 : 5;
    const maximum = primary.has(key) ? 18 : 14;
    return [key, clamp(deterministicInteger(`${seed}|${key}`, minimum, maximum) + qualityOffset, 1, 20)];
  }));
}

function managedClubIds(room) {
  return [...new Map((Array.isArray(room?.managers) ? room.managers : [])
    .map((manager) => identifier(manager?.clubId))
    .filter(Boolean)
    .map((clubId) => [clubKey(clubId), clubId])).values()];
}

function allClubs(room) {
  const clubs = [
    ...(Array.isArray(room?.competitionCatalog) ? room.competitionCatalog : [])
      .filter((competition) => competition?.active !== false)
      .flatMap((competition) => (competition?.clubs ?? [])
        .filter((club) => club?.active !== false)
        .map((club) => ({
          ...club,
          country: club?.country ?? competition?.country,
        }))),
    ...(Array.isArray(room?.tournamentCatalog) ? room.tournamentCatalog : [])
      .filter((tournament) => tournament?.active !== false)
      .flatMap((tournament) => [
        ...(Array.isArray(tournament?.teamIds) ? tournament.teamIds.map((id) => ({ id })) : []),
        ...(Array.isArray(tournament?.participants) ? tournament.participants : []),
      ])
      .filter((club) => club?.active !== false),
  ];
  const unique = new Map();
  for (const club of clubs) {
    const id = identifier(club?.id);
    if (!id) continue;
    const key = clubKey(id);
    unique.set(key, { ...(unique.get(key) ?? {}), ...club, id });
  }
  return [...unique.values()];
}

/** Clubes do save que precisam de comissão: humanos e participantes ativos da carreira. */
function activeStaffClubIds(room) {
  const clubs = new Map(managedClubIds(room).map((clubId) => [clubKey(clubId), clubId]));
  for (const club of allClubs(room)) {
    const clubId = identifier(club?.id);
    if (clubId) clubs.set(clubKey(clubId), clubId);
  }
  return [...clubs.values()];
}

function clubNationality(room, clubId) {
  const key = clubKey(clubId);
  const club = allClubs(room).find((candidate) => clubKey(candidate?.id) === key);
  const country = identifier(club?.country);
  return country || NATIONALITIES[hashText(clubId) % NATIONALITIES.length];
}

function deterministicName(seed) {
  return `${FIRST_NAMES[hashText(`${seed}|first`) % FIRST_NAMES.length]} ${LAST_NAMES[hashText(`${seed}|last`) % LAST_NAMES.length]}`;
}

function parseLegacyEndDate(value, fallback) {
  if (value instanceof Date || typeof value === "number") return timestamp(value);
  const text = identifier(value);
  const monthAliases = {
    jan: 1, janeiro: 1, feb: 2, fev: 2, fevereiro: 2, mar: 3, marco: 3,
    apr: 4, abr: 4, abril: 4, may: 5, mai: 5, maio: 5, jun: 6, junho: 6,
    jul: 7, julho: 7, aug: 8, ago: 8, agosto: 8, sep: 9, set: 9, setembro: 9,
    oct: 10, out: 10, outubro: 10, nov: 11, novembro: 11, dec: 12, dez: 12, dezembro: 12,
  };
  const monthYear = normalizedText(text).match(/^([a-z]+|\d{1,2})[\s./-]+(20\d{2})$/u);
  if (monthYear) {
    const month = Number(monthYear[1]) || monthAliases[monthYear[1]];
    if (month >= 1 && month <= 12) {
      return new Date(Date.UTC(Number(monthYear[2]), month, 1) - 1).toISOString();
    }
  }
  const direct = new Date(text);
  if (Number.isFinite(direct.getTime())) return direct.toISOString();
  const year = text.match(/(20\d{2})/)?.[1];
  return year ? `${year}-12-31T23:59:59.999Z` : fallback;
}

function normalizeProfessionalHistory(value) {
  return (Array.isArray(value) ? value : []).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    return [{
      id: identifier(entry.id) || deterministicId("staff-career", JSON.stringify(entry) + index),
      clubId: identifier(entry.clubId) || null,
      role: normalizeRole(entry.role) ?? "assistant_coach",
      startedAt: entry.startedAt ? timestamp(entry.startedAt) : null,
      endedAt: entry.endedAt ? timestamp(entry.endedAt) : null,
      reason: identifier(entry.reason) || null,
    }];
  }).slice(-50);
}

function normalizedIdentifierList(value, maximum = 50) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(identifier)
    .filter(Boolean))].slice(0, maximum);
}

function normalizeAffiliationType(value) {
  const normalized = identifier(value).toLocaleLowerCase("en-US").replace(/[^a-z]+/g, "_");
  if (normalized === "personal_staff") return "personal_team";
  return AFFILIATION_TYPES.has(normalized) ? normalized : "independent";
}

function normalizeAvailability(value, status = "employed") {
  const source = typeof value === "string"
    ? { status: value }
    : value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackStatus = status === "retired"
    ? "retired"
    : ["notice", "on_leave", "retiring"].includes(status) ? status : "available";
  return {
    status: identifier(source.status) || fallbackStatus,
    availableFrom: source.availableFrom ? timestamp(source.availableFrom) : null,
    unavailableUntil: source.unavailableUntil ? timestamp(source.unavailableUntil) : null,
    effectiveAt: source.effectiveAt ? timestamp(source.effectiveAt) : null,
    reason: identifier(source.reason) || null,
    compensation: integer(source.compensation, 0, 0, MAX_MONEY),
  };
}

function normalizeInterimAssignment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const clubId = identifier(value.clubId);
  const startedAtValue = value.startedAt ?? value.startsAt;
  const expectedEndAtValue = value.expectedEndAt ?? value.endsAt;
  const startedAt = startedAtValue ? timestamp(startedAtValue) : null;
  if (!clubId || !startedAt) return null;
  const expectedEndAt = expectedEndAtValue ? timestamp(expectedEndAtValue) : null;
  const endedAt = value.endedAt ? timestamp(value.endedAt) : null;
  return {
    id: identifier(value.id) || deterministicId("staff-interim", `${clubId}|${startedAt}`),
    clubId,
    role: identifier(value.role) || "head_coach",
    startedAt,
    startsAt: startedAt,
    expectedEndAt,
    endedAt,
    endsAt: endedAt ?? expectedEndAt,
    status: identifier(value.status) || (value.endedAt ? "ended" : "active"),
    endReason: identifier(value.endReason) || null,
    temporaryBonus: integer(value.temporaryBonus, 0, 0, MAX_MONEY),
    authorityLevel: integer(value.authorityLevel, 50, 0, 100),
    sourceCoachId: identifier(value.sourceCoachId) || null,
  };
}

function normalizeMoneyMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, amount]) => [identifier(key), integer(amount, 0, 0, MAX_MONEY)])
    .filter(([key]) => Boolean(key))
    .slice(0, 20));
}

function normalizeSeverance(value, terminationRate = 0.25) {
  const source = typeof value === "number"
    ? { type: "fixed", amount: value }
    : value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = identifier(source.type) || "remaining_wages_rate";
  return {
    type,
    amount: integer(source.amount, 0, 0, MAX_MONEY),
    rate: rounded(clamp(finite(source.rate, terminationRate), 0, 1), 3),
    months: integer(source.months, 0, 0, 120),
  };
}

function normalizeContractItems(value, maximum = 50) {
  const entries = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return entries.flatMap((entry) => {
    if (typeof entry === "string") {
      const description = identifier(entry);
      return description ? [description] : [];
    }
    if (!entry || typeof entry !== "object") return [];
    return [structuredClone(entry)];
  }).slice(0, maximum);
}

function normalizeMember(value, { defaultClubId = null, now = new Date(), candidate = false } = {}) {
  if (!value || typeof value !== "object") return null;
  const role = normalizeRole(value.role ?? value.position ?? value.job);
  const name = identifier(value.name);
  if (!role || !name) return null;
  const id = identifier(value.id) || deterministicId("staff", `${name}|${role}`);
  const storedStatus = MEMBER_STATUS.has(value.status) ? value.status : null;
  const detachedLifecycle = storedStatus && !["employed", "free_agent"].includes(storedStatus);
  const hasExplicitClub = Object.prototype.hasOwnProperty.call(value, "clubId")
    || Object.prototype.hasOwnProperty.call(value, "currentClubId");
  const sourceClubId = hasExplicitClub
    ? value.clubId ?? value.currentClubId
    : defaultClubId;
  const clubId = candidate && !detachedLifecycle
    ? null
    : identifier(sourceClubId) || null;
  const attributes = normalizeAttributes(value.attributes, value.rating ?? value.reputation ?? 10, role);
  const rating = roleRating(attributes, role);
  const status = candidate && !detachedLifecycle
    ? "free_agent"
    : storedStatus ?? (clubId ? "employed" : "free_agent");
  const affiliationType = normalizeAffiliationType(value.affiliationType ?? value.coachLinkType);
  return {
    id,
    name,
    role,
    roleLabel: ROLE_LABELS[role],
    age: integer(value.age, 40, 18, 80),
    nationality: identifier(value.nationality) || "Brasil",
    reputation: integer(value.reputation, Math.round(rating * 5), 1, 100),
    attributes,
    salary: integer(value.salary ?? value.wage, Math.round(15_000 + rating * 7_500), 1_000, 10_000_000),
    clubId,
    contractId: clubId ? identifier(value.contractId ?? value.contract?.id) || null : null,
    specialties: [...new Set((Array.isArray(value.specialties) ? value.specialties : ROLE_SPECIALTIES[role])
      .map(identifier).filter(Boolean))].slice(0, 8),
    satisfaction: integer(value.satisfaction ?? value.motivation, 75, 0, 100),
    status,
    affiliationType,
    linkedCoachId: identifier(value.linkedCoachId ?? value.coachId) || null,
    affinity: integer(value.affinity, affiliationType === "independent" ? 50 : 70, 0, 100),
    sharedJobs: integer(value.sharedJobs, 0, 0, 1_000),
    preferredByCoachIds: normalizedIdentifierList(value.preferredByCoachIds),
    availability: normalizeAvailability(value.availability, status),
    interimAssignment: normalizeInterimAssignment(value.interimAssignment),
    professionalHistory: normalizeProfessionalHistory(value.professionalHistory ?? value.history),
    createdAt: value.createdAt ? timestamp(value.createdAt) : timestamp(now),
    updatedAt: value.updatedAt ? timestamp(value.updatedAt) : timestamp(now),
  };
}

function normalizeContract(value, member, now = new Date()) {
  if (!value || typeof value !== "object") return null;
  const staffId = identifier(value.staffId ?? member?.id);
  const clubId = identifier(value.clubId ?? member?.clubId);
  if (!staffId || !clubId) return null;
  const startDate = value.startDate ? timestamp(value.startDate) : timestamp(now);
  const endDate = parseLegacyEndDate(value.endDate ?? value.contract, addYears(startDate, 2));
  const status = CONTRACT_STATUS.has(value.status) ? value.status : "active";
  const terminationRate = rounded(clamp(finite(value.terminationRate, 0.25), 0, 1), 3);
  const lifecycleFallback = status === "active" ? "active" : status;
  const lifecycleStatus = CONTRACT_LIFECYCLE_STATUS.has(value.lifecycleStatus)
    ? value.lifecycleStatus
    : lifecycleFallback;
  const fallbackWage = integer(member?.salary, 1_000, 1_000, 10_000_000);
  return {
    id: identifier(value.id) || deterministicId("staff-contract", `${staffId}|${clubId}|${startDate}`),
    staffId,
    clubId,
    startDate,
    endDate,
    startSeason: integer(value.startSeason, 1, 1),
    endSeason: integer(value.endSeason, integer(value.startSeason, 1, 1) + 2, 1),
    wage: integer(value.wage ?? value.salary ?? member?.salary, fallbackWage, 1_000, 10_000_000),
    terminationRate,
    bonuses: normalizeMoneyMap(value.bonuses),
    severance: normalizeSeverance(value.severance, terminationRate),
    clauses: normalizeContractItems(value.clauses),
    benefits: normalizeContractItems(value.benefits),
    lifecycleStatus,
    status,
    renewalCount: integer(value.renewalCount, 0, 0, 100),
    operationId: identifier(value.operationId) || null,
    endedAt: value.endedAt ? timestamp(value.endedAt) : null,
    endReason: identifier(value.endReason ?? value.reason) || null,
  };
}

function generatedMember(room, clubId, role, now) {
  const roomId = identifier(room?.id ?? room?.code) || "bola-manager";
  const seed = `${roomId}|staff|${clubId}|${role}`;
  const attributes = deterministicAttributes(seed, role);
  const rating = roleRating(attributes, role);
  const memberId = deterministicId("staff", seed);
  const startDate = timestamp(now);
  const years = deterministicInteger(`${seed}|years`, 2, 4);
  const contractId = deterministicId("staff-contract", `${seed}|contract`);
  const member = normalizeMember({
    id: memberId,
    name: deterministicName(seed),
    role,
    age: deterministicInteger(`${seed}|age`, 32, 61),
    nationality: clubNationality(room, clubId),
    reputation: Math.round(rating * 5),
    attributes,
    salary: Math.round(18_000 + rating * 8_000),
    clubId,
    contractId,
    satisfaction: deterministicInteger(`${seed}|satisfaction`, 68, 92),
    specialties: ROLE_SPECIALTIES[role],
    professionalHistory: [{
      id: deterministicId("staff-career", seed),
      clubId,
      role,
      startedAt: startDate,
      endedAt: null,
      reason: "initial_staff",
    }],
    createdAt: startDate,
    updatedAt: startDate,
  }, { now });
  const contract = normalizeContract({
    id: contractId,
    staffId: memberId,
    clubId,
    startDate,
    endDate: addYears(startDate, years),
    startSeason: integer(room?.currentSeason, 1, 1),
    endSeason: integer(room?.currentSeason, 1, 1) + years - 1,
    wage: member.salary,
    terminationRate: deterministicInteger(`${seed}|termination`, 15, 35) / 100,
    status: "active",
  }, member, now);
  return { member: { ...member, contractId: contract.id }, contract };
}

function generatedCandidate(room, role, index, now) {
  const roomId = identifier(room?.id ?? room?.code) || "bola-manager";
  const seed = `${roomId}|staff-candidate|${role}|${index}`;
  const qualityOffset = index === 0 ? -1 : index === 1 ? 1 : 0;
  const attributes = deterministicAttributes(seed, role, qualityOffset);
  const rating = roleRating(attributes, role);
  return normalizeMember({
    id: deterministicId("staff-candidate", seed),
    name: deterministicName(seed),
    role,
    age: deterministicInteger(`${seed}|age`, 29, 64),
    nationality: NATIONALITIES[hashText(`${seed}|nation`) % NATIONALITIES.length],
    reputation: Math.round(rating * 5),
    attributes,
    salary: Math.round(16_000 + rating * 7_000),
    specialties: ROLE_SPECIALTIES[role],
    satisfaction: deterministicInteger(`${seed}|satisfaction`, 58, 88),
    status: "free_agent",
    professionalHistory: [],
    createdAt: timestamp(now),
    updatedAt: timestamp(now),
  }, { candidate: true, now });
}

function uniqueById(values) {
  return [...new Map(values.filter(Boolean).map((value) => [value.id, value])).values()];
}

function activeContractFor(contracts, staffId, now = null) {
  return contracts.find((contract) => (
    contract.staffId === staffId
    && contract.status === "active"
    && (!now || new Date(contract.endDate).getTime() > new Date(now).getTime())
  )) ?? null;
}

function careerStateFrom(room) {
  return room?.clubCareerState && typeof room.clubCareerState === "object" && !Array.isArray(room.clubCareerState)
    ? room.clubCareerState
    : {};
}

function calculateEffectsFromCollections(members, contracts, clubId, now = new Date()) {
  const key = clubKey(clubId);
  const nowIso = timestamp(now);
  const eligible = members.filter((member) => (
    clubKey(member.clubId) === key
    && ["employed", "notice", "retiring"].includes(member.status)
    && activeContractFor(contracts, member.id, nowIso)
  ));
  const byRole = new Map(eligible.map((member) => [member.role, member]));
  const rating = (role, attribute) => finite(byRole.get(role)?.attributes?.[attribute], 0);
  const quality = eligible.length
    ? rounded(eligible.reduce((total, member) => total + roleRating(member.attributes, member.role), 0) / eligible.length, 2)
    : 0;
  const fitness = rating("fitness_coach", "fitness");
  const physio = rating("physiotherapist", "medical");
  const doctor = rating("doctor", "medical");
  const assistantTactical = rating("assistant_coach", "tactical");
  const assistantCoaching = rating("assistant_coach", "coaching");
  const analyst = rating("performance_analyst", "analysis");
  const scout = rating("scout", "scouting");
  const goalkeeper = rating("goalkeeper_coach", "goalkeeping");
  const youth = rating("youth_coach", "youthDevelopment");
  const director = rating("football_director", "negotiation");
  const monthlyCost = eligible.reduce((total, member) => {
    const contract = activeContractFor(contracts, member.id, nowIso);
    return total + integer(contract?.wage ?? member.salary, 0, 0, MAX_MONEY);
  }, 0);
  return {
    clubId: identifier(clubId),
    memberCount: eligible.length,
    quality,
    monthlyCost,
    trainingDevelopmentMultiplier: rounded(clamp(1 + (assistantCoaching + fitness) / 400, 1, 1.1)),
    conditionRecoveryBonus: rounded(clamp((fitness + physio) / 14, 0, 3)),
    injuryRiskMultiplier: rounded(clamp(1 - (fitness + physio + doctor) / 240, 0.72, 1)),
    injuryRecoveryMultiplier: rounded(clamp(1 - (physio + doctor) / 180, 0.78, 1)),
    scoutingConfidenceBonus: rounded(clamp((scout + analyst) * 0.4, 0, 16)),
    scoutingSpeedMultiplier: rounded(clamp(1 - (scout + analyst) / 160, 0.75, 1)),
    tacticalAnalysisBonus: rounded(clamp((assistantTactical + analyst) * 0.3, 0, 12)),
    cohesionGainBonus: rounded(clamp(assistantTactical / 10, 0, 2)),
    cohesionChangePenaltyMultiplier: rounded(clamp(1 - (assistantTactical + analyst) / 220, 0.82, 1)),
    goalkeeperDevelopmentMultiplier: rounded(clamp(1 + goalkeeper / 180, 1, 1.12)),
    youthIntakeQualityBonus: rounded(clamp(youth / 10, 0, 2)),
    moraleRecoveryBonus: rounded(clamp((rating("assistant_coach", "motivation") + rating("youth_coach", "motivation")) / 15, 0, 2.5)),
    negotiationBonus: rounded(clamp(director / 250, 0, 0.08)),
    sourceStaffIds: eligible.map((member) => member.id).sort(),
    calculatedAt: nowIso,
  };
}

function normalizedStaffCollections(room, now) {
  const career = careerStateFrom(room);
  const defaultClubId = managedClubIds(room)[0] ?? null;
  const legacyMembers = career.staffMembers ?? career.staff ?? room?.staffMembers ?? room?.staff ?? [];
  const legacyCandidates = career.staffCandidates ?? room?.staffCandidates ?? [];
  const rawMemberSourcesById = new Map();
  const rawMembers = (Array.isArray(legacyMembers) ? legacyMembers : []).map((source) => {
    const member = normalizeMember(source, { defaultClubId, now, candidate: false });
    if (member) rawMemberSourcesById.set(member.id, source);
    return member;
  });
  const rawCandidates = (Array.isArray(legacyCandidates) ? legacyCandidates : []).map((member) => (
    normalizeMember(member, { now, candidate: true })
  ));
  const memberSources = [...rawMembers, ...rawCandidates];
  const members = uniqueById(memberSources.filter((member) => (
    member && (member.clubId || member.status !== "free_agent")
  )));
  const employedIds = new Set(members.map((member) => member.id));
  const candidates = uniqueById([
    ...rawCandidates,
    ...rawMembers.filter((member) => member && !member.clubId),
  ]).filter((member) => (
    !employedIds.has(member.id)
    && !member.clubId
    && member.status === "free_agent"
  ));
  const memberById = new Map([...members, ...candidates].map((member) => [member.id, member]));
  const rawContracts = Array.isArray(career.staffContracts) ? career.staffContracts : [];
  const contracts = uniqueById(rawContracts.map((contract) => {
    const member = memberById.get(identifier(contract?.staffId));
    return normalizeContract(contract, member, now);
  }));
  for (const member of members) {
    if (member.status === "retired") continue;
    if (activeContractFor(contracts, member.id)) continue;
    const source = rawMemberSourcesById.get(member.id) ?? {};
    const embeddedContract = source.contract && typeof source.contract === "object"
      ? source.contract
      : {
        endDate: source.contractEndDate ?? source.contract,
        startDate: source.contractStartDate ?? source.createdAt,
      };
    const embedded = normalizeContract({
      ...embeddedContract,
      id: embeddedContract.id ?? member.contractId,
      clubId: member.clubId,
      wage: embeddedContract.wage ?? embeddedContract.salary ?? member.salary,
      startDate: embeddedContract.startDate ?? member.createdAt,
      endDate: embeddedContract.endDate,
      status: embeddedContract.status ?? "active",
    }, member, now);
    if (embedded) contracts.push(embedded);
  }
  return { members, candidates, contracts: uniqueById(contracts) };
}

function recomputeEffects(room, now) {
  const career = room.clubCareerState;
  const clubIds = new Map();
  for (const manager of room.managers ?? []) {
    const clubId = identifier(manager?.clubId);
    if (clubId) clubIds.set(clubKey(clubId), clubId);
  }
  for (const member of career.staffMembers ?? []) {
    const clubId = identifier(member.clubId);
    if (clubId) clubIds.set(clubKey(clubId), clubId);
  }
  career.staffEffectsByClub = Object.fromEntries([...clubIds.values()].map((clubId) => [
    clubId,
    calculateEffectsFromCollections(career.staffMembers, career.staffContracts, clubId, now),
  ]));
}

/** Clone and migrate staff data without changing unrelated room/career fields. */
export function ensureStaffState(roomValue, { now = new Date(), candidateCountPerRole = 2 } = {}) {
  if (!roomValue || typeof roomValue !== "object" || Array.isArray(roomValue)) {
    throw new StaffError("Save inválido para comissão técnica", "STAFF_ROOM_INVALID", 400);
  }
  const nowIso = timestamp(now);
  const room = structuredClone(roomValue);
  const existingCareer = careerStateFrom(room);
  const collections = normalizedStaffCollections(room, nowIso);
  const initialized = new Map((Array.isArray(existingCareer.staffInitializedClubIds)
    ? existingCareer.staffInitializedClubIds : [])
    .map(identifier).filter(Boolean).map((clubId) => [clubKey(clubId), clubId]));
  const generatedContracts = [];
  for (const clubId of activeStaffClubIds(room)) {
    if (initialized.has(clubKey(clubId))) continue;
    for (const role of STAFF_ROLES) {
      const generated = generatedMember(room, clubId, role, nowIso);
      if (!collections.members.some((member) => member.id === generated.member.id)) {
        collections.members.push(generated.member);
        generatedContracts.push(generated.contract);
      }
    }
    initialized.set(clubKey(clubId), clubId);
  }
  const candidates = [...collections.candidates];
  const desiredCandidates = integer(candidateCountPerRole, 2, 0, 6);
  for (const role of STAFF_ROLES) {
    for (let index = 0; index < desiredCandidates; index += 1) {
      const candidate = generatedCandidate(room, role, index, nowIso);
      if (![...collections.members, ...candidates].some((member) => member.id === candidate.id)) {
        candidates.push(candidate);
      }
    }
  }
  room.clubCareerState = {
    ...existingCareer,
    staffSchemaVersion: STAFF_SCHEMA_VERSION,
    staffMembers: uniqueById(collections.members),
    staffCandidates: uniqueById(candidates),
    staffContracts: uniqueById([...collections.contracts, ...generatedContracts]),
    staffHistory: (Array.isArray(existingCareer.staffHistory) ? existingCareer.staffHistory : []).slice(-MAX_HISTORY),
    staffEffectsByClub: existingCareer.staffEffectsByClub && typeof existingCareer.staffEffectsByClub === "object"
      ? structuredClone(existingCareer.staffEffectsByClub) : {},
    processedStaffOperationIds: [...new Set((Array.isArray(existingCareer.processedStaffOperationIds)
      ? existingCareer.processedStaffOperationIds : []).map(identifier).filter(Boolean))].slice(-MAX_OPERATIONS),
    staffInitializedClubIds: [...initialized.values()],
  };
  const preferredContractByStaff = new Map(room.clubCareerState.staffMembers.map((member) => [
    member.id,
    identifier(member.contractId),
  ]));
  const activeContractsByStaff = new Map();
  for (const contract of room.clubCareerState.staffContracts) {
    if (contract.status !== "active") continue;
    const selected = activeContractsByStaff.get(contract.staffId);
    const preferredId = preferredContractByStaff.get(contract.staffId);
    if (!selected
      || (contract.id === preferredId && selected.id !== preferredId)
      || (selected.id !== preferredId && contract.id !== preferredId
        && new Date(contract.startDate).getTime() > new Date(selected.startDate).getTime())) {
      activeContractsByStaff.set(contract.staffId, contract);
    }
  }
  room.clubCareerState.staffContracts = room.clubCareerState.staffContracts.map((contract) => {
    if (contract.status !== "active") return contract;
    return activeContractsByStaff.get(contract.staffId)?.id === contract.id
      ? contract
      : {
        ...contract,
        status: "replaced",
        lifecycleStatus: "replaced",
        endedAt: nowIso,
        endReason: "duplicate_contract_migration",
      };
  });
  const retiredIds = new Set(room.clubCareerState.staffMembers
    .filter((member) => member.status === "retired")
    .map((member) => member.id));
  room.clubCareerState.staffContracts = room.clubCareerState.staffContracts.map((contract) => (
    contract.status === "active" && retiredIds.has(contract.staffId)
      ? {
        ...contract,
        status: "terminated",
        lifecycleStatus: "retired",
        endedAt: contract.endedAt ?? nowIso,
        endReason: contract.endReason ?? "retirement_migration",
      }
      : contract
  ));
  room.clubCareerState.staffMembers = room.clubCareerState.staffMembers.map((member) => {
    const active = activeContractFor(room.clubCareerState.staffContracts, member.id);
    const lifecycleStatus = ["notice", "on_leave", "retiring"].includes(active?.lifecycleStatus)
      ? active.lifecycleStatus
      : null;
    const preservedStatus = ["notice", "on_leave", "retiring", "suspended"].includes(member.status)
      ? member.status
      : lifecycleStatus;
    return active ? {
      ...member,
      clubId: active.clubId,
      contractId: active.id,
      salary: active.wage,
      status: preservedStatus ?? "employed",
      availability: normalizeAvailability({
        ...member.availability,
        status: preservedStatus ?? "available",
      }, preservedStatus ?? "employed"),
    } : member.status === "retired" ? {
      ...member,
      contractId: null,
      status: "retired",
      availability: normalizeAvailability({ ...member.availability, status: "retired" }, "retired"),
    } : ["notice", "on_leave", "retiring", "suspended"].includes(member.status) ? {
      ...member,
      contractId: null,
      availability: normalizeAvailability({
        ...member.availability,
        status: member.status,
      }, member.status),
    } : {
      ...member,
      clubId: null,
      contractId: null,
      status: "free_agent",
      availability: normalizeAvailability({ ...member.availability, status: "available" }, "free_agent"),
    };
  });
  const lifecycleByStaff = new Map(room.clubCareerState.staffMembers
    .filter((member) => ["notice", "on_leave", "retiring"].includes(member.status))
    .map((member) => [member.id, member.status]));
  room.clubCareerState.staffContracts = room.clubCareerState.staffContracts.map((contract) => (
    contract.status === "active" && lifecycleByStaff.has(contract.staffId)
      ? { ...contract, lifecycleStatus: lifecycleByStaff.get(contract.staffId) }
      : contract
  ));
  const newlyFree = room.clubCareerState.staffMembers.filter((member) => member.status === "free_agent");
  room.clubCareerState.staffMembers = room.clubCareerState.staffMembers.filter((member) => member.status !== "free_agent");
  room.clubCareerState.staffCandidates = uniqueById([...room.clubCareerState.staffCandidates, ...newlyFree]);
  recomputeEffects(room, nowIso);
  return room;
}

function operationId(input) {
  const id = identifier(input?.operationId ?? input?.requestId);
  if (!id) throw new StaffError("Operação sem identificador", "STAFF_OPERATION_ID_REQUIRED", 400);
  if (id.length > 128) throw new StaffError("Identificador de operação inválido", "STAFF_OPERATION_ID_INVALID", 400);
  return id;
}

function duplicateOutcome(room, id) {
  if (!room.clubCareerState.processedStaffOperationIds.includes(id)) return null;
  const event = [...room.clubCareerState.staffHistory].reverse().find((entry) => entry.operationId === id) ?? null;
  const member = event
    ? [...room.clubCareerState.staffMembers, ...room.clubCareerState.staffCandidates]
      .find((candidate) => candidate.id === event.staffId) ?? null
    : null;
  const contract = event?.contractId
    ? room.clubCareerState.staffContracts.find((candidate) => candidate.id === event.contractId) ?? null
    : null;
  return { room, member, contract, event, financialTransactions: [], duplicate: true };
}

function appendHistory(room, event) {
  room.clubCareerState.staffHistory = [...room.clubCareerState.staffHistory, event].slice(-MAX_HISTORY);
  room.clubCareerState.processedStaffOperationIds = [
    ...new Set([...room.clubCareerState.processedStaffOperationIds, event.operationId]),
  ].slice(-MAX_OPERATIONS);
}

function emitCallbacks(room, transactions, event, options) {
  for (const transaction of transactions) options.postFinancialTransaction?.(room, structuredClone(transaction));
  options.recordCareerEvent?.(room, structuredClone(event));
}

function staffEvent(room, {
  id,
  type,
  staffId,
  clubId,
  relatedClubId = null,
  contractId = null,
  amount = 0,
  occurredAt,
  metadata = {},
}) {
  return {
    id: deterministicId("staff-event", `${id}|${type}`),
    operationId: id,
    type,
    staffId,
    clubId: identifier(clubId) || null,
    relatedClubId: identifier(relatedClubId) || null,
    contractId: identifier(contractId) || null,
    amount: integer(amount, 0, 0, MAX_MONEY),
    occurredAt: timestamp(occurredAt),
    seasonNumber: integer(room.currentSeason, 1, 1),
    metadata: structuredClone(metadata),
  };
}

function financeTransaction({ id, direction, category, amount, clubId, staffId, relatedClubId, occurredAt, description }) {
  return {
    id,
    originId: id.replace(/:(?:buyer|seller|penalty|bonus)$/u, ""),
    type: direction === "income" ? "income" : "expense",
    category,
    amount: integer(amount, 0, 0, MAX_MONEY),
    date: timestamp(occurredAt),
    description,
    clubId: identifier(clubId),
    relatedClubId: identifier(relatedClubId) || null,
    staffId,
  };
}

function activeMember(room, staffId) {
  const member = room.clubCareerState.staffMembers.find((candidate) => candidate.id === identifier(staffId));
  if (!member) throw new StaffError("Funcionário contratado não encontrado", "STAFF_MEMBER_NOT_FOUND", 404);
  return member;
}

function candidateOrMember(room, staffId) {
  const id = identifier(staffId);
  const candidate = room.clubCareerState.staffCandidates.find((member) => member.id === id);
  const member = room.clubCareerState.staffMembers.find((current) => current.id === id);
  if (!candidate && !member) throw new StaffError("Profissional não encontrado", "STAFF_NOT_FOUND", 404);
  return candidate ?? member;
}

function closeProfessionalHistory(member, endedAt, reason) {
  const history = [...member.professionalHistory];
  const index = history.findLastIndex((entry) => !entry.endedAt && clubKey(entry.clubId) === clubKey(member.clubId));
  if (index >= 0) history[index] = { ...history[index], endedAt, reason };
  return history;
}

function remainingContractMonths(contract, now) {
  const remainingMs = Math.max(0, new Date(contract.endDate).getTime() - new Date(now).getTime());
  return Math.min(96, Math.ceil(remainingMs / (30 * DAY_MS)));
}

export function calculateTerminationPenalty(contract, now = new Date()) {
  if (!contract || contract.status !== "active") return 0;
  const severance = normalizeSeverance(contract.severance, contract.terminationRate);
  if (severance.type === "fixed") return severance.amount;
  const remainingMonths = remainingContractMonths(contract, now);
  const payableMonths = severance.months > 0
    ? Math.min(remainingMonths, severance.months)
    : remainingMonths;
  return Math.min(MAX_MONEY, Math.round(
    payableMonths * integer(contract.wage, 0) * severance.rate,
  ));
}

function closeInterimAssignment(assignment, endedAt, reason) {
  if (!assignment || assignment.endedAt) return assignment;
  return {
    ...assignment,
    endedAt,
    endsAt: endedAt,
    status: "ended",
    endReason: identifier(reason) || null,
  };
}

function separateStaffMutable(room, {
  id,
  member,
  contract,
  clubId,
  now,
  reason,
  eventType,
  lifecycleStatus = "terminated",
  destination = "free_agent",
  compensation = 0,
  transactionCategory = "staff_termination",
  satisfactionDelta = -20,
  description = null,
  metadata = {},
}) {
  const amount = integer(compensation, 0, 0, MAX_MONEY);
  const endedContract = contract ? {
    ...contract,
    status: "terminated",
    lifecycleStatus,
    endedAt: now,
    endReason: reason,
  } : null;
  if (endedContract) {
    room.clubCareerState.staffContracts = room.clubCareerState.staffContracts.map((current) => (
      current.id === contract.id ? endedContract : current
    ));
  }
  const retired = destination === "retired";
  const separatedMember = {
    ...member,
    clubId: retired ? member.clubId : null,
    contractId: null,
    status: retired ? "retired" : "free_agent",
    satisfaction: clamp(member.satisfaction + satisfactionDelta, 0, 100),
    availability: normalizeAvailability({
      status: retired ? "retired" : "available",
      availableFrom: retired ? null : now,
      effectiveAt: retired ? now : null,
      reason,
      compensation: amount,
    }, retired ? "retired" : "free_agent"),
    interimAssignment: closeInterimAssignment(member.interimAssignment, now, reason),
    professionalHistory: closeProfessionalHistory(member, now, reason),
    updatedAt: now,
  };
  room.clubCareerState.staffMembers = room.clubCareerState.staffMembers.filter((current) => current.id !== member.id);
  room.clubCareerState.staffCandidates = room.clubCareerState.staffCandidates.filter((current) => current.id !== member.id);
  if (retired) {
    room.clubCareerState.staffMembers = uniqueById([...room.clubCareerState.staffMembers, separatedMember]);
  } else {
    room.clubCareerState.staffCandidates = uniqueById([...room.clubCareerState.staffCandidates, separatedMember]);
  }
  const transactions = amount > 0 && clubId ? [financeTransaction({
    id: `${id}:penalty`,
    direction: "expense",
    category: transactionCategory,
    amount,
    clubId,
    staffId: member.id,
    relatedClubId: null,
    occurredAt: now,
    description: description ?? `Desligamento de ${member.name}`,
  })] : [];
  const event = staffEvent(room, {
    id,
    type: eventType,
    staffId: member.id,
    clubId,
    contractId: contract?.id,
    amount,
    occurredAt: now,
    metadata: {
      role: member.role,
      reason,
      lifecycleStatus,
      destination,
      compensation: amount,
      ...metadata,
    },
  });
  return { member: separatedMember, contract: endedContract, event, transactions };
}

/** Persist a professional's relationship with a coach without mutating the input save. */
export function setStaffCoachLink(roomValue, input = {}, options = {}) {
  const now = timestamp(options.now ?? new Date());
  const room = ensureStaffState(roomValue, { now });
  const id = operationId(input);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const member = candidateOrMember(room, input.staffId);
  const hasCoachId = Object.prototype.hasOwnProperty.call(input, "linkedCoachId")
    || Object.prototype.hasOwnProperty.call(input, "coachId");
  const linkedCoachId = hasCoachId
    ? identifier(input.linkedCoachId ?? input.coachId) || null
    : member.linkedCoachId;
  const affiliationType = normalizeAffiliationType(
    input.affiliationType ?? input.linkType ?? (linkedCoachId ? member.affiliationType : "independent"),
  );
  const preferredByCoachIds = Object.prototype.hasOwnProperty.call(input, "preferredByCoachIds")
    ? normalizedIdentifierList(input.preferredByCoachIds)
    : member.preferredByCoachIds;
  const updated = {
    ...member,
    affiliationType,
    linkedCoachId,
    affinity: integer(input.affinity, member.affinity, 0, 100),
    sharedJobs: integer(input.sharedJobs, member.sharedJobs, 0, 1_000),
    preferredByCoachIds,
    availability: Object.prototype.hasOwnProperty.call(input, "availability")
      ? normalizeAvailability(input.availability, member.status)
      : member.availability,
    interimAssignment: Object.prototype.hasOwnProperty.call(input, "interimAssignment")
      ? normalizeInterimAssignment(input.interimAssignment)
      : member.interimAssignment,
    updatedAt: now,
  };
  room.clubCareerState.staffMembers = room.clubCareerState.staffMembers.map((current) => (
    current.id === member.id ? updated : current
  ));
  room.clubCareerState.staffCandidates = room.clubCareerState.staffCandidates.map((current) => (
    current.id === member.id ? updated : current
  ));
  const contract = activeContractFor(room.clubCareerState.staffContracts, member.id, now);
  const event = staffEvent(room, {
    id,
    type: "STAFF_COACH_LINK_UPDATED",
    staffId: member.id,
    clubId: member.clubId,
    contractId: contract?.id,
    occurredAt: now,
    metadata: {
      previousAffiliationType: member.affiliationType,
      previousLinkedCoachId: member.linkedCoachId,
      affiliationType,
      linkedCoachId,
      affinity: updated.affinity,
      sharedJobs: updated.sharedJobs,
    },
  });
  emitCallbacks(room, [], event, options);
  appendHistory(room, event);
  recomputeEffects(room, now);
  return {
    room,
    member: structuredClone(updated),
    contract: contract ? structuredClone(contract) : null,
    event,
    financialTransactions: [],
    duplicate: false,
  };
}

/** Hire a free professional or buy out an employed professional. Input room remains untouched. */
export function hireStaff(roomValue, input = {}, options = {}) {
  const now = timestamp(options.now ?? new Date());
  const room = ensureStaffState(roomValue, { now });
  const id = operationId(input);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const clubId = identifier(input.clubId);
  if (!clubId) throw new StaffError("Clube obrigatório", "STAFF_CLUB_REQUIRED", 400);
  const source = candidateOrMember(room, input.staffId);
  if (source.status === "retired") {
    throw new StaffError("Profissional aposentado não pode ser contratado", "STAFF_RETIRED", 409);
  }
  if (clubKey(source.clubId) === clubKey(clubId)) {
    throw new StaffError("Profissional já pertence ao clube", "STAFF_ALREADY_AT_CLUB", 409);
  }
  const years = integer(input.years, 3, 1, 8);
  if (years < 1) throw new StaffError("Duração de contrato inválida", "STAFF_CONTRACT_YEARS_INVALID", 400);
  const wage = integer(input.wage ?? source.salary, 0, 1_000, 10_000_000);
  if (wage < 1_000) throw new StaffError("Salário inválido", "STAFF_WAGE_INVALID", 400);
  const previousClubId = source.clubId;
  const previousContract = activeContractFor(room.clubCareerState.staffContracts, source.id, now);
  const compensation = previousContract ? calculateTerminationPenalty(previousContract, now) : 0;
  const signingBonus = integer(input.signingBonus, wage, 0, MAX_MONEY);
  if (previousContract) {
    room.clubCareerState.staffContracts = room.clubCareerState.staffContracts.map((contract) => (
      contract.id === previousContract.id
        ? {
          ...contract,
          status: "terminated",
          lifecycleStatus: "terminated",
          endedAt: now,
          endReason: "staff_transfer",
        }
        : contract
    ));
  }
  const startSeason = integer(room.currentSeason, 1, 1);
  const contract = normalizeContract({
    id: deterministicId("staff-contract", `${id}|${source.id}|${clubId}`),
    staffId: source.id,
    clubId,
    startDate: now,
    endDate: addYears(now, years),
    startSeason,
    endSeason: startSeason + years - 1,
    wage,
    terminationRate: input.terminationRate,
    bonuses: input.bonuses,
    severance: input.severance,
    clauses: input.clauses,
    benefits: input.benefits,
    lifecycleStatus: input.lifecycleStatus,
    status: "active",
    renewalCount: 0,
    operationId: id,
  }, { ...source, clubId, salary: wage }, now);
  const previousHistory = previousClubId
    ? closeProfessionalHistory(source, now, "transferred")
    : source.professionalHistory;
  const member = {
    ...source,
    clubId,
    contractId: contract.id,
    salary: wage,
    status: "employed",
    satisfaction: clamp(source.satisfaction + 5, 0, 100),
    professionalHistory: [...previousHistory, {
      id: deterministicId("staff-career", `${id}|${source.id}|${clubId}`),
      clubId,
      role: source.role,
      startedAt: now,
      endedAt: null,
      reason: "hired",
    }].slice(-50),
    updatedAt: now,
  };
  room.clubCareerState.staffCandidates = room.clubCareerState.staffCandidates.filter((candidate) => candidate.id !== source.id);
  room.clubCareerState.staffMembers = uniqueById([
    ...room.clubCareerState.staffMembers.filter((current) => current.id !== source.id),
    member,
  ]);
  room.clubCareerState.staffContracts.push(contract);
  const totalCost = Math.min(MAX_MONEY, compensation + signingBonus);
  const transactions = [financeTransaction({
    id: `${id}:buyer`, direction: "expense", category: "staff_hiring", amount: totalCost,
    clubId, staffId: source.id, relatedClubId: previousClubId, occurredAt: now,
    description: `Contratação de ${source.name}`,
  })];
  if (previousClubId && compensation > 0) transactions.push(financeTransaction({
    id: `${id}:seller`, direction: "income", category: "staff_compensation", amount: compensation,
    clubId: previousClubId, staffId: source.id, relatedClubId: clubId, occurredAt: now,
    description: `Compensação pela saída de ${source.name}`,
  }));
  const event = staffEvent(room, {
    id, type: "STAFF_HIRED", staffId: source.id, clubId, relatedClubId: previousClubId,
    contractId: contract.id, amount: totalCost, occurredAt: now,
    metadata: { wage, years, signingBonus, compensation, role: source.role },
  });
  emitCallbacks(room, transactions, event, options);
  appendHistory(room, event);
  recomputeEffects(room, now);
  return { room, member: structuredClone(member), contract: structuredClone(contract), event, financialTransactions: transactions, duplicate: false };
}

/** Fire a staff member, calculate remaining-contract penalty and return them to persistent candidate pool. */
export function fireStaff(roomValue, input = {}, options = {}) {
  const now = timestamp(options.now ?? new Date());
  const room = ensureStaffState(roomValue, { now });
  const id = operationId(input);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const member = activeMember(room, input.staffId);
  const clubId = identifier(input.clubId);
  if (!clubId || clubKey(member.clubId) !== clubKey(clubId)) {
    throw new StaffError("Funcionário não pertence ao clube", "STAFF_CLUB_MISMATCH", 409);
  }
  const contract = activeContractFor(room.clubCareerState.staffContracts, member.id, now);
  if (!contract) throw new StaffError("Contrato ativo não encontrado", "STAFF_ACTIVE_CONTRACT_NOT_FOUND", 409);
  const basePenalty = calculateTerminationPenalty(contract, now);
  const penalty = input.mutualAgreement === true ? Math.round(basePenalty * 0.5) : basePenalty;
  const separated = separateStaffMutable(room, {
    id,
    member,
    contract,
    clubId,
    now,
    reason: input.mutualAgreement ? "mutual_agreement" : "fired",
    eventType: "STAFF_FIRED",
    lifecycleStatus: input.mutualAgreement ? "separated" : "terminated",
    compensation: penalty,
    transactionCategory: "staff_termination",
    satisfactionDelta: -20,
    description: `Multa de demissão de ${member.name}`,
    metadata: {
      penalty,
      mutualAgreement: input.mutualAgreement === true,
    },
  });
  emitCallbacks(room, separated.transactions, separated.event, options);
  appendHistory(room, separated.event);
  recomputeEffects(room, now);
  return {
    room,
    member: structuredClone(separated.member),
    contract: structuredClone(separated.contract),
    event: separated.event,
    financialTransactions: separated.transactions,
    duplicate: false,
  };
}

/** End a staff contract by mutual agreement and return the professional to the market. */
export function separateStaffByAgreement(roomValue, input = {}, options = {}) {
  const now = timestamp(options.now ?? new Date());
  const room = ensureStaffState(roomValue, { now });
  const id = operationId(input);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const member = activeMember(room, input.staffId);
  const clubId = identifier(input.clubId);
  if (!clubId || clubKey(member.clubId) !== clubKey(clubId)) {
    throw new StaffError("Funcionário não pertence ao clube", "STAFF_CLUB_MISMATCH", 409);
  }
  const contract = activeContractFor(room.clubCareerState.staffContracts, member.id, now);
  if (!contract) throw new StaffError("Contrato ativo não encontrado", "STAFF_ACTIVE_CONTRACT_NOT_FOUND", 409);
  const defaultCompensation = Math.round(calculateTerminationPenalty(contract, now) * 0.5);
  const compensation = Object.prototype.hasOwnProperty.call(input, "compensation")
    ? integer(input.compensation, 0, 0, MAX_MONEY)
    : defaultCompensation;
  const separated = separateStaffMutable(room, {
    id,
    member,
    contract,
    clubId,
    now,
    reason: identifier(input.reason) || "mutual_agreement",
    eventType: "STAFF_SEPARATED_BY_AGREEMENT",
    lifecycleStatus: "separated",
    compensation,
    transactionCategory: "staff_mutual_separation",
    satisfactionDelta: -5,
    description: `Acordo de rescisão com ${member.name}`,
    metadata: {
      agreementTerms: input.agreementTerms && typeof input.agreementTerms === "object"
        ? structuredClone(input.agreementTerms)
        : {},
    },
  });
  emitCallbacks(room, separated.transactions, separated.event, options);
  appendHistory(room, separated.event);
  recomputeEffects(room, now);
  return {
    room,
    member: structuredClone(separated.member),
    contract: structuredClone(separated.contract),
    event: separated.event,
    financialTransactions: separated.transactions,
    duplicate: false,
  };
}

/** Announce or complete a professional's retirement. Retired staff never return to the free pool. */
export function retireStaff(roomValue, input = {}, options = {}) {
  const now = timestamp(options.now ?? new Date());
  const room = ensureStaffState(roomValue, { now });
  const id = operationId(input);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const member = candidateOrMember(room, input.staffId);
  if (member.status === "retired") {
    throw new StaffError("Profissional já está aposentado", "STAFF_ALREADY_RETIRED", 409);
  }
  const clubId = identifier(input.clubId ?? member.clubId) || null;
  if (member.clubId && (!clubId || clubKey(member.clubId) !== clubKey(clubId))) {
    throw new StaffError("Funcionário não pertence ao clube", "STAFF_CLUB_MISMATCH", 409);
  }
  const contract = activeContractFor(room.clubCareerState.staffContracts, member.id, now);
  const effectiveAt = input.effectiveAt ? timestamp(input.effectiveAt) : now;
  const compensation = integer(input.compensation, 0, 0, MAX_MONEY);
  if (new Date(effectiveAt).getTime() > new Date(now).getTime()) {
    const retiring = {
      ...member,
      status: "retiring",
      availability: normalizeAvailability({
        status: "retiring",
        effectiveAt,
        reason: identifier(input.reason) || "retirement",
        compensation,
      }, "retiring"),
      updatedAt: now,
    };
    const retiringContract = {
      ...contract,
      lifecycleStatus: "retiring",
    };
    room.clubCareerState.staffCandidates = room.clubCareerState.staffCandidates.filter((current) => (
      current.id !== member.id
    ));
    room.clubCareerState.staffMembers = uniqueById([
      ...room.clubCareerState.staffMembers.filter((current) => current.id !== member.id),
      retiring,
    ]);
    if (contract) {
      room.clubCareerState.staffContracts = room.clubCareerState.staffContracts.map((current) => (
        current.id === contract.id ? retiringContract : current
      ));
    }
    const event = staffEvent(room, {
      id,
      type: "STAFF_RETIREMENT_ANNOUNCED",
      staffId: member.id,
      clubId,
      contractId: contract?.id,
      occurredAt: now,
      metadata: {
        role: member.role,
        effectiveAt,
        compensation,
        reason: identifier(input.reason) || "retirement",
      },
    });
    emitCallbacks(room, [], event, options);
    appendHistory(room, event);
    recomputeEffects(room, now);
    return {
      room,
      member: structuredClone(retiring),
      contract: contract ? structuredClone(retiringContract) : null,
      event,
      financialTransactions: [],
      duplicate: false,
    };
  }
  const retired = separateStaffMutable(room, {
    id,
    member,
    contract,
    clubId,
    now,
    reason: identifier(input.reason) || "retirement",
    eventType: "STAFF_RETIRED",
    lifecycleStatus: "retired",
    destination: "retired",
    compensation,
    transactionCategory: "staff_retirement",
    satisfactionDelta: 0,
    description: `Aposentadoria de ${member.name}`,
    metadata: { effectiveAt: now },
  });
  emitCallbacks(room, retired.transactions, retired.event, options);
  appendHistory(room, retired.event);
  recomputeEffects(room, now);
  return {
    room,
    member: structuredClone(retired.member),
    contract: structuredClone(retired.contract),
    event: retired.event,
    financialTransactions: retired.transactions,
    duplicate: false,
  };
}

/** Replace current staff contract with a renewed contract. */
export function renewStaffContract(roomValue, input = {}, options = {}) {
  const now = timestamp(options.now ?? new Date());
  const room = ensureStaffState(roomValue, { now });
  const id = operationId(input);
  const duplicate = duplicateOutcome(room, id);
  if (duplicate) return duplicate;
  const member = activeMember(room, input.staffId);
  const clubId = identifier(input.clubId);
  if (!clubId || clubKey(member.clubId) !== clubKey(clubId)) {
    throw new StaffError("Funcionário não pertence ao clube", "STAFF_CLUB_MISMATCH", 409);
  }
  const previous = activeContractFor(room.clubCareerState.staffContracts, member.id, now);
  if (!previous) throw new StaffError("Contrato ativo não encontrado", "STAFF_ACTIVE_CONTRACT_NOT_FOUND", 409);
  const years = integer(input.years, 0, 1, 8);
  if (years < 1) throw new StaffError("Duração de contrato inválida", "STAFF_CONTRACT_YEARS_INVALID", 400);
  const wage = integer(input.wage, 0, 1_000, 10_000_000);
  if (wage < 1_000) throw new StaffError("Salário inválido", "STAFF_WAGE_INVALID", 400);
  const renewalBonus = integer(input.renewalBonus, Math.round(wage * 0.5), 0, MAX_MONEY);
  room.clubCareerState.staffContracts = room.clubCareerState.staffContracts.map((contract) => (
    contract.id === previous.id
      ? {
        ...contract,
        status: "replaced",
        lifecycleStatus: "replaced",
        endedAt: now,
        endReason: "renewed",
      }
      : contract
  ));
  const startSeason = integer(room.currentSeason, 1, 1);
  const contract = normalizeContract({
    id: deterministicId("staff-contract", `${id}|${member.id}|renewal`),
    staffId: member.id,
    clubId,
    startDate: now,
    endDate: addYears(now, years),
    startSeason,
    endSeason: startSeason + years - 1,
    wage,
    terminationRate: input.terminationRate ?? previous.terminationRate,
    bonuses: input.bonuses ?? previous.bonuses,
    severance: input.severance ?? previous.severance,
    clauses: input.clauses ?? previous.clauses,
    benefits: input.benefits ?? previous.benefits,
    lifecycleStatus: input.lifecycleStatus,
    status: "active",
    renewalCount: previous.renewalCount + 1,
    operationId: id,
  }, { ...member, salary: wage }, now);
  const renewed = {
    ...member,
    salary: wage,
    contractId: contract.id,
    status: "employed",
    availability: normalizeAvailability({ status: "available" }, "employed"),
    satisfaction: clamp(member.satisfaction + 3, 0, 100),
    updatedAt: now,
  };
  room.clubCareerState.staffMembers = room.clubCareerState.staffMembers.map((current) => current.id === member.id ? renewed : current);
  room.clubCareerState.staffContracts.push(contract);
  const transactions = renewalBonus > 0 ? [financeTransaction({
    id: `${id}:bonus`, direction: "expense", category: "staff_contract_renewal", amount: renewalBonus,
    clubId, staffId: member.id, relatedClubId: null, occurredAt: now,
    description: `Renovação contratual de ${member.name}`,
  })] : [];
  const event = staffEvent(room, {
    id, type: "STAFF_CONTRACT_RENEWED", staffId: member.id, clubId, contractId: contract.id,
    amount: renewalBonus, occurredAt: now,
    metadata: { previousContractId: previous.id, wage, years, renewalBonus, role: member.role },
  });
  emitCallbacks(room, transactions, event, options);
  appendHistory(room, event);
  recomputeEffects(room, now);
  return { room, member: structuredClone(renewed), contract: structuredClone(contract), event, financialTransactions: transactions, duplicate: false };
}

/** Expire due contracts once; returns free agents and persistent career events. */
export function processStaffContractExpirations(roomValue, options = {}) {
  const now = timestamp(options.now ?? new Date());
  const room = ensureStaffState(roomValue, { now });
  const managedClubs = new Set(managedClubIds(room).map(clubKey));
  const activeClubs = new Set(activeStaffClubIds(room).map(clubKey));
  const events = [];
  const retiredStaffIds = [];
  const retiringDue = room.clubCareerState.staffMembers.filter((member) => (
    member.status === "retiring"
    && member.availability?.effectiveAt
    && new Date(member.availability.effectiveAt).getTime() <= new Date(now).getTime()
  ));
  for (const member of retiringDue) {
    const contract = activeContractFor(room.clubCareerState.staffContracts, member.id);
    const id = `staff-retirement-effective:${member.id}:${member.availability.effectiveAt}`;
    if (room.clubCareerState.processedStaffOperationIds.includes(id)) continue;
    const retired = separateStaffMutable(room, {
      id,
      member,
      contract,
      clubId: member.clubId,
      now,
      reason: member.availability.reason || "retirement",
      eventType: "STAFF_RETIRED",
      lifecycleStatus: "retired",
      destination: "retired",
      compensation: member.availability.compensation,
      transactionCategory: "staff_retirement",
      satisfactionDelta: 0,
      description: `Aposentadoria de ${member.name}`,
      metadata: {
        effectiveAt: member.availability.effectiveAt,
        scheduled: true,
      },
    });
    emitCallbacks(room, retired.transactions, retired.event, options);
    appendHistory(room, retired.event);
    events.push(retired.event);
    retiredStaffIds.push(member.id);
  }
  const due = room.clubCareerState.staffContracts.filter((contract) => (
    contract.status === "active" && new Date(contract.endDate).getTime() <= new Date(now).getTime()
  ));
  const renewedStaffIds = [];
  for (const contract of due) {
    const aiControlled = activeClubs.has(clubKey(contract.clubId))
      && !managedClubs.has(clubKey(contract.clubId));
    const id = aiControlled ? `staff-ai-renew:${contract.id}` : `staff-expire:${contract.id}`;
    if (room.clubCareerState.processedStaffOperationIds.includes(id)) continue;
    const member = room.clubCareerState.staffMembers.find((candidate) => candidate.id === contract.staffId);
    if (aiControlled && member && member.status !== "retiring") {
      const years = deterministicInteger(`${id}|years`, 2, 4);
      const increase = deterministicInteger(`${id}|wage-increase`, 1, 4) / 100;
      const wage = integer(Math.round(contract.wage * (1 + increase)), contract.wage, 1_000, MAX_MONEY);
      const startSeason = integer(room.currentSeason, 1, 1);
      const renewedContract = normalizeContract({
        id: deterministicId("staff-contract", `${id}|${member.id}`),
        staffId: member.id,
        clubId: contract.clubId,
        startDate: now,
        endDate: addYears(now, years),
        startSeason,
        endSeason: startSeason + years - 1,
        wage,
        terminationRate: contract.terminationRate,
        bonuses: contract.bonuses,
        severance: contract.severance,
        clauses: contract.clauses,
        benefits: contract.benefits,
        status: "active",
        renewalCount: contract.renewalCount + 1,
        operationId: id,
      }, { ...member, salary: wage }, now);
      room.clubCareerState.staffContracts = room.clubCareerState.staffContracts
        .filter((current) => current.staffId !== member.id || current.status === "active")
        .map((current) => current.id === contract.id ? {
          ...current,
          status: "replaced",
          lifecycleStatus: "replaced",
          endedAt: now,
          endReason: "ai_renewed",
        } : current);
      room.clubCareerState.staffContracts.push(renewedContract);
      room.clubCareerState.staffMembers = room.clubCareerState.staffMembers.map((current) => (
        current.id === member.id ? {
          ...current,
          contractId: renewedContract.id,
          salary: wage,
          satisfaction: clamp(current.satisfaction + 1, 0, 100),
          updatedAt: now,
        } : current
      ));
      const event = staffEvent(room, {
        id,
        type: "STAFF_CONTRACT_RENEWED",
        staffId: member.id,
        clubId: contract.clubId,
        contractId: renewedContract.id,
        occurredAt: now,
        metadata: {
          previousContractId: contract.id,
          wage,
          years,
          renewalBonus: 0,
          role: member.role,
          aiControlled: true,
        },
      });
      options.recordCareerEvent?.(room, structuredClone(event));
      appendHistory(room, event);
      events.push(event);
      renewedStaffIds.push(member.id);
      continue;
    }
    room.clubCareerState.staffContracts = room.clubCareerState.staffContracts.map((current) => (
      current.id === contract.id ? {
        ...current,
        status: "expired",
        lifecycleStatus: "expired",
        endedAt: now,
        endReason: "contract_expired",
      } : current
    ));
    if (member) {
      room.clubCareerState.staffMembers = room.clubCareerState.staffMembers.filter((current) => current.id !== member.id);
      if (member.status === "retiring" && member.availability?.effectiveAt) {
        const retiring = {
          ...member,
          clubId: null,
          contractId: null,
          professionalHistory: closeProfessionalHistory(member, now, "contract_expired_before_retirement"),
          updatedAt: now,
        };
        room.clubCareerState.staffCandidates = room.clubCareerState.staffCandidates.filter((current) => (
          current.id !== member.id
        ));
        room.clubCareerState.staffMembers = uniqueById([...room.clubCareerState.staffMembers, retiring]);
      } else {
        const candidate = {
          ...member,
          clubId: null,
          contractId: null,
          status: "free_agent",
          availability: normalizeAvailability({
            status: "available",
            availableFrom: now,
            reason: "contract_expired",
          }, "free_agent"),
          interimAssignment: closeInterimAssignment(member.interimAssignment, now, "contract_expired"),
          professionalHistory: closeProfessionalHistory(member, now, "contract_expired"),
          updatedAt: now,
        };
        room.clubCareerState.staffCandidates = uniqueById([...room.clubCareerState.staffCandidates, candidate]);
      }
    }
    const event = staffEvent(room, {
      id, type: "STAFF_CONTRACT_EXPIRED", staffId: contract.staffId, clubId: contract.clubId,
      contractId: contract.id, occurredAt: now, metadata: { role: member?.role ?? null, orphanedContract: !member },
    });
    options.recordCareerEvent?.(room, structuredClone(event));
    appendHistory(room, event);
    events.push(event);
  }
  recomputeEffects(room, now);
  const renewed = new Set(renewedStaffIds);
  return {
    room,
    events,
    renewedStaffIds,
    retiredStaffIds,
    expiredStaffIds: events
      .filter((event) => event.type === "STAFF_CONTRACT_EXPIRED" && !renewed.has(event.staffId))
      .map((event) => event.staffId),
  };
}

export function calculateStaffEffects(roomOrCareerState, clubId, now = new Date()) {
  const career = roomOrCareerState?.clubCareerState ?? roomOrCareerState ?? {};
  return calculateEffectsFromCollections(
    Array.isArray(career.staffMembers) ? career.staffMembers : [],
    Array.isArray(career.staffContracts) ? career.staffContracts : [],
    clubId,
    now,
  );
}

export function staffSnapshotForClub(roomValue, clubId, options = {}) {
  const room = ensureStaffState(roomValue, options);
  const key = clubKey(clubId);
  return {
    clubId: identifier(clubId),
    members: structuredClone(room.clubCareerState.staffMembers.filter((member) => clubKey(member.clubId) === key)),
    candidates: structuredClone(room.clubCareerState.staffCandidates),
    contracts: structuredClone(room.clubCareerState.staffContracts.filter((contract) => clubKey(contract.clubId) === key)),
    history: structuredClone(room.clubCareerState.staffHistory.filter((entry) => (
      clubKey(entry.clubId) === key || clubKey(entry.relatedClubId) === key
    ))),
    effects: structuredClone(room.clubCareerState.staffEffectsByClub?.[identifier(clubId)]
      ?? calculateStaffEffects(room, clubId, options.now)),
  };
}

export function validateStaffState(roomValue, now = new Date()) {
  const room = ensureStaffState(roomValue, { now });
  const career = room.clubCareerState;
  const ids = [...career.staffMembers, ...career.staffCandidates].map((member) => member.id);
  if (new Set(ids).size !== ids.length) throw new StaffError("Funcionários duplicados", "STAFF_DUPLICATE_MEMBER", 500);
  for (const member of career.staffMembers) {
    const contracts = career.staffContracts.filter((contract) => contract.staffId === member.id && contract.status === "active");
    const retiredWithContract = member.status === "retired" && contracts.length > 0;
    const linkedWithoutContract = member.clubId
      && member.status !== "retired"
      && contracts.length !== 1;
    const clubMismatch = contracts.length === 1
      && clubKey(contracts[0].clubId) !== clubKey(member.clubId);
    if (contracts.length > 1 || retiredWithContract || linkedWithoutContract || clubMismatch) {
      throw new StaffError("Vínculo de funcionário inconsistente", "STAFF_CONTRACT_INTEGRITY", 500, { staffId: member.id });
    }
    if (member.status === "free_agent") {
      throw new StaffError("Funcionário livre fora do mercado", "STAFF_MEMBER_POOL_INTEGRITY", 500, { staffId: member.id });
    }
  }
  for (const candidate of career.staffCandidates) {
    if (candidate.clubId || candidate.status !== "free_agent") {
      throw new StaffError("Candidato livre possui vínculo", "STAFF_CANDIDATE_INTEGRITY", 500, { staffId: candidate.id });
    }
  }
  return true;
}
