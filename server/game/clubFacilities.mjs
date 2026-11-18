import { randomUUID } from "node:crypto";

const DAY_MS = 86_400_000;
const MAX_RENOVATION_HISTORY = 120;
const MAX_MATCH_HISTORY = 120;
const MAX_COMPLETED_PROJECTS = 80;

export const FACILITY_DEFINITIONS = Object.freeze([
  { id: "stands", category: "stadium", name: "Arquibancadas", maxLevel: 5, baseCost: 12_000_000, baseDays: 70, maintenance: 120_000, benefit: "capacity" },
  { id: "pitch", category: "stadium", name: "Gramado", maxLevel: 5, baseCost: 3_200_000, baseDays: 28, maintenance: 65_000, benefit: "pitch" },
  { id: "lighting", category: "stadium", name: "Iluminacao", maxLevel: 5, baseCost: 2_800_000, baseDays: 35, maintenance: 45_000, benefit: "lighting" },
  { id: "coverage", category: "stadium", name: "Cobertura", maxLevel: 5, baseCost: 7_500_000, baseDays: 56, maintenance: 70_000, benefit: "coverage" },
  { id: "security", category: "stadium", name: "Seguranca", maxLevel: 5, baseCost: 2_400_000, baseDays: 28, maintenance: 38_000, benefit: "security" },
  { id: "comfort", category: "stadium", name: "Conforto", maxLevel: 5, baseCost: 4_800_000, baseDays: 42, maintenance: 55_000, benefit: "comfort" },
  { id: "parking", category: "stadium", name: "Estacionamento", maxLevel: 5, baseCost: 3_600_000, baseDays: 42, maintenance: 35_000, benefit: "parking" },
  { id: "commercial", category: "stadium", name: "Estrutura comercial", maxLevel: 5, baseCost: 5_500_000, baseDays: 49, maintenance: 50_000, benefit: "commercial" },
  { id: "training", category: "infrastructure", name: "Centro de treinamento", maxLevel: 5, baseCost: 8_000_000, baseDays: 56, maintenance: 95_000, benefit: "development" },
  { id: "academy", category: "infrastructure", name: "Categorias de base", maxLevel: 5, baseCost: 7_000_000, baseDays: 63, maintenance: 80_000, benefit: "academy" },
  { id: "medical", category: "infrastructure", name: "Departamento medico", maxLevel: 5, baseCost: 5_000_000, baseDays: 42, maintenance: 65_000, benefit: "medical" },
  { id: "analysis", category: "infrastructure", name: "Departamento de analise", maxLevel: 5, baseCost: 4_200_000, baseDays: 35, maintenance: 55_000, benefit: "analysis" },
  { id: "scouting", category: "infrastructure", name: "Rede de observacao", maxLevel: 5, baseCost: 4_500_000, baseDays: 42, maintenance: 60_000, benefit: "scouting" },
  { id: "recovery", category: "infrastructure", name: "Instalacoes de recuperacao", maxLevel: 5, baseCost: 4_800_000, baseDays: 42, maintenance: 62_000, benefit: "recovery" },
  { id: "physiology", category: "infrastructure", name: "Area de fisiologia", maxLevel: 5, baseCost: 3_800_000, baseDays: 35, maintenance: 48_000, benefit: "fitness" },
  { id: "administration", category: "infrastructure", name: "Estrutura administrativa", maxLevel: 5, baseCost: 3_000_000, baseDays: 35, maintenance: 40_000, benefit: "administration" },
  { id: "technology", category: "infrastructure", name: "Tecnologia de desempenho", maxLevel: 5, baseCost: 5_200_000, baseDays: 42, maintenance: 58_000, benefit: "technology" },
]);

const DEFINITION_BY_ID = new Map(FACILITY_DEFINITIONS.map((definition) => [definition.id, definition]));

function benefitLabel(definition, level) {
  const normalizedLevel = integer(level, 0, 0, definition.maxLevel);
  switch (definition.benefit) {
    case "capacity": return `+${new Intl.NumberFormat("pt-BR").format(4_000 + normalizedLevel * 2_000)} lugares`;
    case "pitch": return "Menor risco de lesao";
    case "lighting": return "Melhores jogos noturnos";
    case "coverage": return "Mais conforto e demanda";
    case "security": return "Maior capacidade utilizavel";
    case "comfort": return "Mais publico e receita";
    case "parking": return "Mais demanda em casa";
    case "commercial": return `+${normalizedLevel * 2}% receita por jogo`;
    case "development": return `+${normalizedLevel * 2.5}% desenvolvimento`;
    case "academy": return `Nivel ${normalizedLevel} na formacao`;
    case "medical": return `-${normalizedLevel * 4.5}% risco de lesao`;
    case "analysis": return `+${normalizedLevel * 3}% conhecimento tatico`;
    case "scouting": return `+${normalizedLevel * 3}% precisao do scout`;
    case "recovery": return `+${normalizedLevel} recuperacao por ciclo`;
    case "fitness": return "Menos fadiga e lesoes";
    case "administration": return `-${normalizedLevel * 2.5}% custos operacionais`;
    case "technology": return "Melhor treino e analise";
    default: return "Melhoria estrutural";
  }
}

function quoteForArea(definition, area) {
  const nextLevel = area.level + 1;
  return {
    areaId: area.id,
    name: area.name,
    category: area.category,
    currentLevel: area.level,
    nextLevel,
    cost: Math.round(definition.baseCost * (0.72 + nextLevel * 0.28)),
    durationDays: Math.round(definition.baseDays * (0.7 + nextLevel * 0.3)),
    maintenanceIncrease: definition.maintenance,
    benefit: definition.benefit,
    benefitLabel: benefitLabel(definition, nextLevel),
  };
}

/**
 * DTO calculado para o cliente. Custo, prazo e impacto nunca entram no save,
 * evitando que uma mudanca de regra deixe cotacoes antigas persistidas.
 */
export function facilityView(facility) {
  if (!facility || typeof facility !== "object") return null;
  const visible = structuredClone(facility);
  visible.areas = (Array.isArray(visible.areas) ? visible.areas : []).map((area) => {
    const definition = DEFINITION_BY_ID.get(identifier(area?.id));
    if (!definition) return area;
    const level = integer(area.level, 0, 0, definition.maxLevel);
    const maxLevel = integer(area.maxLevel, definition.maxLevel, 1, definition.maxLevel);
    const activeProjectId = identifier(area.activeProjectId) || null;
    const normalizedArea = {
      ...area,
      id: definition.id,
      name: identifier(area.name) || definition.name,
      category: definition.category,
      level,
      maxLevel,
      activeProjectId,
    };
    const maximum = level >= maxLevel;
    const active = Boolean(activeProjectId);
    return {
      ...normalizedArea,
      benefitLabel: benefitLabel(definition, level),
      upgradeStatus: maximum ? "max" : active ? "active" : "available",
      nextUpgradeQuote: maximum || active ? null : quoteForArea(definition, normalizedArea),
    };
  });
  return visible;
}

export class ClubFacilityError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.name = "ClubFacilityError";
    this.code = code;
    this.status = status;
  }
}

function identifier(value) {
  return String(value ?? "").trim();
}

function clubKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(finite(value, fallback))));
}

function percent(value, fallback = 0) {
  return integer(value, fallback, 0, 100);
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + days * DAY_MS).toISOString();
}

function seasonNumberForMatch(room, value) {
  return integer(value ?? room?.currentSeason, 1, 1);
}

function scopePart(value, fallback) {
  const normalized = identifier(value).toLocaleLowerCase("pt-BR") || fallback;
  return encodeURIComponent(normalized);
}

function matchScope({ seasonNumber, competitionId, fixtureId }) {
  return `s${seasonNumberForMatch(null, seasonNumber)}:${scopePart(competitionId, "unknown")}:${scopePart(fixtureId, "unknown")}`;
}

function inferredHistorySeason(room, entry) {
  const explicit = Number(entry?.seasonNumber);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const occurredAt = new Date(entry?.occurredAt ?? entry?.completedAt ?? 0).getTime();
  if (!Number.isFinite(occurredAt)) return null;
  for (const season of room?.seasonHistory ?? []) {
    const startedAt = new Date(season?.startedAt ?? 0).getTime();
    const completedAt = new Date(season?.completedAt ?? 0).getTime();
    if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) continue;
    if (occurredAt >= startedAt && occurredAt <= completedAt) {
      return seasonNumberForMatch(room, season?.seasonNumber);
    }
  }
  const currentStartedAt = new Date(room?.seasonStartedAt ?? room?.startedAt ?? room?.createdAt ?? 0).getTime();
  if (Number.isFinite(currentStartedAt) && occurredAt >= currentStartedAt) {
    return seasonNumberForMatch(room);
  }
  return seasonNumberForMatch(room) === 1 ? 1 : null;
}

function isLegacyMatchDuplicate(room, entry, economy) {
  if (identifier(entry?.operationId).toLocaleLowerCase("pt-BR")
    !== `matchday:${identifier(economy.fixtureId)}`.toLocaleLowerCase("pt-BR")) return false;
  if (inferredHistorySeason(room, entry) !== economy.seasonNumber) return false;
  const entryCompetition = identifier(entry?.competitionId);
  return !entryCompetition
    || entryCompetition.toLocaleLowerCase("pt-BR") === identifier(economy.competitionId).toLocaleLowerCase("pt-BR");
}

function isMatchHistoryEntry(entry) {
  return identifier(entry?.type).toLocaleLowerCase("pt-BR") === "matchday";
}

function historyTime(entry) {
  const time = new Date(entry?.occurredAt ?? entry?.completedAt ?? entry?.startedAt ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function mergeStadiumHistory(renovationHistory, matchHistory) {
  return [...renovationHistory, ...matchHistory]
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => historyTime(left.entry) - historyTime(right.entry) || left.index - right.index)
    .map(({ entry }) => entry);
}

function normalizeStadiumHistory(stadium) {
  const legacyHistory = Array.isArray(stadium?.history) ? stadium.history : [];
  const renovationHistory = (Array.isArray(stadium?.renovationHistory)
    ? stadium.renovationHistory
    : legacyHistory.filter((entry) => !isMatchHistoryEntry(entry)))
    .slice(-MAX_RENOVATION_HISTORY);
  const matchHistory = (Array.isArray(stadium?.matchHistory)
    ? stadium.matchHistory
    : legacyHistory.filter(isMatchHistoryEntry))
    .slice(-MAX_MATCH_HISTORY);
  return {
    renovationHistory,
    matchHistory,
    // Campo legado continua disponivel para saves/clientes antigos, agora sem uma classe apagar a outra.
    history: mergeStadiumHistory(renovationHistory, matchHistory),
  };
}

function syncStadiumHistory(stadium) {
  stadium.renovationHistory = (Array.isArray(stadium.renovationHistory) ? stadium.renovationHistory : [])
    .slice(-MAX_RENOVATION_HISTORY);
  stadium.matchHistory = (Array.isArray(stadium.matchHistory) ? stadium.matchHistory : [])
    .slice(-MAX_MATCH_HISTORY);
  stadium.history = mergeStadiumHistory(stadium.renovationHistory, stadium.matchHistory);
}

function catalogClubs(room) {
  const clubs = [];
  const seen = new Set();
  for (const league of room?.competitionCatalog ?? []) {
    for (const club of league?.clubs ?? []) {
      const key = clubKey(club?.id);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      clubs.push(club);
    }
  }
  for (const tournament of room?.tournamentCatalog ?? []) {
    for (const participant of tournament?.participants ?? []) {
      if (!participant || typeof participant !== "object") continue;
      const key = clubKey(participant.id);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      clubs.push(participant);
    }
  }
  for (const manager of room?.managers ?? []) {
    const key = clubKey(manager?.clubId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clubs.push({ id: manager.clubId, name: manager.clubId });
  }
  return clubs;
}

function safeState(room, now) {
  const raw = room.clubCareerState && typeof room.clubCareerState === "object"
    ? room.clubCareerState
    : {};
  Object.assign(raw, {
    version: Math.max(1, integer(raw.version, 1, 1)),
    currentDate: iso(raw.currentDate ?? room.seasonStartedAt ?? room.startedAt ?? room.createdAt ?? now),
    clubFacilities: Array.isArray(raw.clubFacilities) ? raw.clubFacilities : [],
    facilityProjects: retainFacilityProjects(raw.facilityProjects),
  });
  room.clubCareerState = raw;
  return raw;
}

function retainFacilityProjects(value) {
  const projects = Array.isArray(value) ? value.filter((project) => project && typeof project === "object") : [];
  const active = projects.filter((project) => project.status === "active");
  const completed = projects.filter((project) => project.status !== "active").slice(-MAX_COMPLETED_PROJECTS);
  return [...completed, ...active];
}

function baseLevel(reputation, offset = 0) {
  return integer(Math.floor((finite(reputation, 10) + offset) / 5), 2, 1, 4);
}

function defaultArea(definition, reputation) {
  const level = baseLevel(reputation, definition.category === "stadium" ? 0 : -1);
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    level,
    maxLevel: definition.maxLevel,
    maintenanceCost: definition.maintenance * level,
    benefit: definition.benefit,
    activeProjectId: null,
  };
}

function normalizeArea(value, definition, reputation) {
  const fallback = defaultArea(definition, reputation);
  const level = integer(value?.level, fallback.level, 0, definition.maxLevel);
  const persisted = value && typeof value === "object" ? { ...value } : {};
  delete persisted.benefitLabel;
  delete persisted.upgradeStatus;
  delete persisted.nextUpgradeQuote;
  return {
    ...fallback,
    ...persisted,
    id: definition.id,
    name: definition.name,
    category: definition.category,
    level,
    maxLevel: definition.maxLevel,
    maintenanceCost: integer(value?.maintenanceCost, definition.maintenance * level),
    benefit: definition.benefit,
    activeProjectId: identifier(value?.activeProjectId) || null,
  };
}

function normalizeFacility(value, club) {
  const reputation = finite(club?.reputation, 10);
  const capacity = integer(value?.stadium?.capacity ?? club?.stadiumCapacity, 20_000, 1_000, 250_000);
  const areasById = new Map((Array.isArray(value?.areas) ? value.areas : []).map((area) => [identifier(area?.id), area]));
  const areas = FACILITY_DEFINITIONS.map((definition) => (
    normalizeArea(areasById.get(definition.id), definition, reputation)
  ));
  const averageAttendance = integer(value?.stadium?.averageAttendance, 0, 0, capacity);
  const stadiumHistory = normalizeStadiumHistory(value?.stadium);
  return {
    ...(value && typeof value === "object" ? value : {}),
    clubId: identifier(club?.id ?? value?.clubId),
    stadium: {
      name: identifier(value?.stadium?.name ?? club?.stadium) || "Estadio a definir",
      capacity,
      usedCapacity: integer(value?.stadium?.usedCapacity, averageAttendance, 0, capacity),
      averageAttendance,
      matchesHosted: integer(value?.stadium?.matchesHosted, 0),
      totalAttendance: integer(value?.stadium?.totalAttendance, 0),
      condition: percent(value?.stadium?.condition, 65 + Math.round(reputation * 1.5)),
      pitchQuality: percent(value?.stadium?.pitchQuality, 60 + Math.round(reputation * 1.7)),
      lighting: percent(value?.stadium?.lighting, 55 + Math.round(reputation * 1.8)),
      coverage: percent(value?.stadium?.coverage, 40 + Math.round(reputation * 2)),
      security: percent(value?.stadium?.security, 60 + Math.round(reputation * 1.7)),
      comfort: percent(value?.stadium?.comfort, 45 + Math.round(reputation * 2)),
      parking: percent(value?.stadium?.parking, 35 + Math.round(reputation * 2)),
      commercial: percent(value?.stadium?.commercial, 45 + Math.round(reputation * 2)),
      level: integer(value?.stadium?.level, baseLevel(reputation), 1, 5),
      maintenanceCost: integer(value?.stadium?.maintenanceCost, Math.max(100_000, capacity * 18)),
      averageMatchRevenue: integer(value?.stadium?.averageMatchRevenue, 0),
      totalMatchRevenue: integer(value?.stadium?.totalMatchRevenue, 0),
      averageTicketPrice: integer(value?.stadium?.averageTicketPrice, 35 + reputation * 4, 10, 500),
      ...stadiumHistory,
    },
    areas,
  };
}

function normalizeFacilityInPlace(value, club) {
  const normalized = normalizeFacility(value, club);
  if (!value || typeof value !== "object") return normalized;
  const stadium = value.stadium && typeof value.stadium === "object" ? value.stadium : {};
  Object.assign(stadium, normalized.stadium);
  const previousAreas = new Map((Array.isArray(value.areas) ? value.areas : [])
    .map((area) => [identifier(area?.id), area]));
  const areas = normalized.areas.map((area) => {
    const previous = previousAreas.get(area.id);
    if (!previous || typeof previous !== "object") return area;
    delete previous.benefitLabel;
    delete previous.upgradeStatus;
    delete previous.nextUpgradeQuote;
    Object.assign(previous, area);
    return previous;
  });
  Object.assign(value, normalized, { stadium, areas });
  return value;
}

export function ensureClubFacilities(room, now = new Date()) {
  const state = safeState(room, now);
  const existing = new Map(state.clubFacilities.map((facility) => [clubKey(facility?.clubId), facility]));
  state.clubFacilities = catalogClubs(room).map((club) => normalizeFacilityInPlace(existing.get(clubKey(club.id)), club));
  const validProjectIds = new Set(state.facilityProjects.filter((project) => project?.status === "active").map((project) => project.id));
  for (const facility of state.clubFacilities) {
    facility.areas = facility.areas.map((area) => ({
      ...area,
      activeProjectId: validProjectIds.has(area.activeProjectId) ? area.activeProjectId : null,
    }));
  }
  return state;
}

export function facilityForClub(room, clubId, now = new Date()) {
  const state = ensureClubFacilities(room, now);
  return state.clubFacilities.find((facility) => clubKey(facility.clubId) === clubKey(clubId)) ?? null;
}

export function upgradeQuote(room, clubId, areaId, now = new Date()) {
  const facility = facilityForClub(room, clubId, now);
  const definition = DEFINITION_BY_ID.get(identifier(areaId));
  const area = facility?.areas.find((candidate) => candidate.id === definition?.id);
  if (!facility || !definition || !area) {
    throw new ClubFacilityError("Melhoria nao encontrada", "FACILITY_UPGRADE_NOT_FOUND", 404);
  }
  if (area.level >= area.maxLevel) {
    throw new ClubFacilityError("Esta area ja esta no nivel maximo", "FACILITY_MAX_LEVEL");
  }
  return quoteForArea(definition, area);
}

export function startFacilityUpgrade(room, {
  clubId,
  areaId,
  operationId = randomUUID(),
  now = new Date(),
  debit,
  recordEvent,
} = {}) {
  const state = ensureClubFacilities(room, now);
  const previous = state.facilityProjects.find((project) => project.operationId === operationId);
  if (previous) return { project: previous, duplicate: true };
  const facility = facilityForClub(room, clubId, now);
  const area = facility?.areas.find((candidate) => candidate.id === identifier(areaId));
  if (!area) throw new ClubFacilityError("Melhoria nao encontrada", "FACILITY_UPGRADE_NOT_FOUND", 404);
  if (area.activeProjectId) {
    throw new ClubFacilityError("Esta area ja possui uma obra em andamento", "FACILITY_PROJECT_ACTIVE");
  }
  const quote = upgradeQuote(room, clubId, areaId, now);
  const startedAt = iso(state.currentDate ?? now);
  if (typeof debit !== "function") {
    throw new ClubFacilityError("Servico financeiro indisponivel", "FACILITY_FINANCE_REQUIRED", 503);
  }
  debit({
    clubId,
    amount: quote.cost,
    operationId,
    category: quote.category === "stadium" ? "stadium_investment" : "infrastructure_investment",
    description: `Melhoria de ${quote.name} para o nivel ${quote.nextLevel}`,
    occurredAt: startedAt,
  });
  const project = {
    id: `facility:${operationId}`,
    operationId,
    clubId: identifier(clubId),
    areaId: area.id,
    name: area.name,
    category: area.category,
    fromLevel: area.level,
    toLevel: quote.nextLevel,
    cost: quote.cost,
    durationDays: quote.durationDays,
    startedAt,
    expectedAt: addDays(startedAt, quote.durationDays),
    completedAt: null,
    status: "active",
  };
  state.facilityProjects.push(project);
  state.facilityProjects = retainFacilityProjects(state.facilityProjects);
  const persistedFacility = state.clubFacilities.find((candidate) => clubKey(candidate.clubId) === clubKey(clubId));
  const persistedArea = persistedFacility?.areas.find((candidate) => candidate.id === area.id);
  if (persistedArea) persistedArea.activeProjectId = project.id;
  recordEvent?.({
    id: `facility-start:${operationId}`,
    operationId,
    type: area.category === "stadium" ? "STADIUM_UPGRADE_STARTED" : "INFRASTRUCTURE_UPGRADE_STARTED",
    occurredAt: startedAt,
    clubIds: [identifier(clubId)],
    payload: { projectId: project.id, areaId: area.id, name: area.name, cost: quote.cost, expectedAt: project.expectedAt },
  });
  return { project, quote, duplicate: false };
}

function applyUpgrade(facility, area, project) {
  area.level = project.toLevel;
  const definition = DEFINITION_BY_ID.get(area.id);
  area.maintenanceCost = definition.maintenance * area.level;
  area.activeProjectId = null;
  const stadium = facility.stadium;
  const delta = 6 + area.level * 2;
  switch (area.id) {
    case "stands": stadium.capacity += 4_000 + area.level * 2_000; break;
    case "pitch": stadium.pitchQuality = percent(stadium.pitchQuality + delta); break;
    case "lighting": stadium.lighting = percent(stadium.lighting + delta); break;
    case "coverage": stadium.coverage = percent(stadium.coverage + delta); break;
    case "security": stadium.security = percent(stadium.security + delta); break;
    case "comfort": stadium.comfort = percent(stadium.comfort + delta); break;
    case "parking": stadium.parking = percent(stadium.parking + delta); break;
    case "commercial": stadium.commercial = percent(stadium.commercial + delta); break;
    default: break;
  }
  if (area.category === "stadium") {
    stadium.level = Math.max(1, Math.round(facility.areas
      .filter((candidate) => candidate.category === "stadium")
      .reduce((sum, candidate) => sum + candidate.level, 0) / 8));
    stadium.renovationHistory.push({
      type: "renovation",
      projectId: project.id,
      areaId: area.id,
      name: area.name,
      level: area.level,
      cost: project.cost,
      completedAt: project.completedAt,
    });
    syncStadiumHistory(stadium);
  }
}

export function processFacilityProjects(room, asOf = new Date(), { recordEvent } = {}) {
  const state = ensureClubFacilities(room, asOf);
  const effectiveAt = iso(asOf);
  if (new Date(effectiveAt).getTime() > new Date(state.currentDate).getTime()) state.currentDate = effectiveAt;
  const completed = [];
  for (const project of state.facilityProjects) {
    if (project.status !== "active" || new Date(project.expectedAt).getTime() > new Date(state.currentDate).getTime()) continue;
    const facility = state.clubFacilities.find((candidate) => clubKey(candidate.clubId) === clubKey(project.clubId));
    const area = facility?.areas.find((candidate) => candidate.id === project.areaId);
    if (!facility || !area) continue;
    project.status = "completed";
    project.completedAt = state.currentDate;
    applyUpgrade(facility, area, project);
    completed.push(project);
    recordEvent?.({
      id: `facility-completed:${project.operationId}`,
      operationId: project.operationId,
      type: project.category === "stadium" ? "STADIUM_UPGRADE_COMPLETED" : "INFRASTRUCTURE_UPGRADE_COMPLETED",
      occurredAt: project.completedAt,
      clubIds: [project.clubId],
      payload: { projectId: project.id, areaId: area.id, name: area.name, level: area.level },
    });
  }
  return { changed: completed.length > 0, completed };
}

function clubFromRoom(room, clubId) {
  for (const league of room?.competitionCatalog ?? []) {
    const club = (league?.clubs ?? []).find((candidate) => clubKey(candidate?.id) === clubKey(clubId));
    if (club) return club;
  }
  for (const tournament of room?.tournamentCatalog ?? []) {
    const club = (tournament?.participants ?? []).find((candidate) => (
      candidate && typeof candidate === "object" && clubKey(candidate.id) === clubKey(clubId)
    ));
    if (club) return club;
  }
  return null;
}

export function calculateMatchdayEconomy(room, {
  fixtureId,
  homeClubId,
  awayClubId,
  competitionId = null,
  seasonNumber = null,
  stage = null,
  score = [0, 0],
  occurredAt = new Date(),
} = {}) {
  const facility = facilityForClub(room, homeClubId, occurredAt);
  if (!facility) return null;
  const home = clubFromRoom(room, homeClubId);
  const away = clubFromRoom(room, awayClubId);
  const homeReputation = finite(home?.reputation, 10);
  const awayReputation = finite(away?.reputation, 10);
  const importance = /final|semi|knockout|mata/i.test(identifier(stage)) ? 0.16 : 0;
  const form = Number(score?.[0]) > Number(score?.[1]) ? 0.035 : Number(score?.[0]) < Number(score?.[1]) ? -0.02 : 0;
  const kickoffHour = new Date(occurredAt).getUTCHours();
  const lightingDemand = kickoffHour >= 18 || kickoffHour < 6 ? facility.stadium.lighting / 2_000 : 0;
  const demand = Math.max(0.32, Math.min(0.99,
    0.34 + homeReputation * 0.012 + awayReputation * 0.006 + importance + form
    + facility.stadium.comfort / 1_000 + facility.stadium.security / 1_400
    + facility.stadium.coverage / 1_500 + facility.stadium.parking / 1_800 + lightingDemand,
  ));
  const attendance = Math.max(0, Math.min(facility.stadium.capacity, Math.round(facility.stadium.capacity * demand)));
  const experienceMultiplier = 1 + facility.stadium.comfort / 1_500 + facility.stadium.coverage / 2_500;
  const ticketPrice = Math.round(Math.max(15, facility.stadium.averageTicketPrice * (1 + importance) * experienceMultiplier));
  const commercialMultiplier = 1 + facility.stadium.commercial / 500;
  const grossRevenue = Math.round(attendance * ticketPrice * commercialMultiplier);
  const administrationLevel = facility.areas.find((area) => area.id === "administration")?.level ?? 0;
  const administrationDiscount = Math.min(0.15, administrationLevel * 0.025);
  // Manutencao fixa e cobrada no fechamento mensal. Aqui entram somente custos variaveis do evento.
  const operatingCost = Math.round(attendance * 4.5 * (1 - administrationDiscount));
  const netRevenue = Math.max(0, grossRevenue - operatingCost);
  return {
    fixtureId: identifier(fixtureId),
    seasonNumber: seasonNumberForMatch(room, seasonNumber),
    homeClubId: identifier(homeClubId),
    awayClubId: identifier(awayClubId),
    competitionId: identifier(competitionId) || null,
    attendance,
    capacity: facility.stadium.capacity,
    occupancyPercent: facility.stadium.capacity ? Math.round(attendance / facility.stadium.capacity * 100) : 0,
    ticketPrice,
    grossRevenue,
    operatingCost,
    netRevenue,
    administrationDiscount,
    occurredAt: iso(occurredAt),
  };
}

export function recordMatchdayEconomy(room, input, { credit, recordEvent } = {}) {
  const economy = calculateMatchdayEconomy(room, input);
  if (!economy) return null;
  const operationScope = matchScope(economy);
  const operationId = `matchday:${operationScope}`;
  const eventOperationId = `match:${operationScope}`;
  const state = ensureClubFacilities(room, economy.occurredAt);
  const facility = facilityForClub(room, economy.homeClubId, economy.occurredAt);
  const alreadyRecorded = facility.stadium.matchHistory.some((entry) => (
    entry.operationId === operationId || isLegacyMatchDuplicate(room, entry, economy)
  ));
  if (alreadyRecorded) {
    return { ...economy, operationScope, financeOperationId: operationId, eventOperationId, duplicate: true };
  }
  const credited = credit?.({
    clubId: economy.homeClubId,
    amount: economy.netRevenue,
    operationId,
    category: "matchday_revenue",
    description: `Bilheteria da partida ${economy.fixtureId}`,
    relatedClubId: economy.awayClubId,
    competitionId: economy.competitionId,
    fixtureId: economy.fixtureId,
    seasonNumber: economy.seasonNumber,
    occurredAt: economy.occurredAt,
  });
  if (credited?.duplicate === true || credited?.applied === false) {
    return { ...economy, operationScope, financeOperationId: operationId, eventOperationId, duplicate: true };
  }
  facility.stadium.matchesHosted += 1;
  facility.stadium.totalAttendance += economy.attendance;
  facility.stadium.averageAttendance = Math.round(facility.stadium.totalAttendance / facility.stadium.matchesHosted);
  facility.stadium.usedCapacity = economy.attendance;
  facility.stadium.totalMatchRevenue += economy.netRevenue;
  facility.stadium.averageMatchRevenue = Math.round(facility.stadium.totalMatchRevenue / facility.stadium.matchesHosted);
  facility.stadium.matchHistory.push({ operationId, operationScope, type: "matchday", ...economy });
  syncStadiumHistory(facility.stadium);
  state.currentDate = iso(economy.occurredAt);
  recordEvent?.({
    id: eventOperationId,
    operationId: eventOperationId,
    type: "MATCH_COMPLETED",
    occurredAt: economy.occurredAt,
    seasonNumber: economy.seasonNumber,
    clubIds: [economy.homeClubId, economy.awayClubId],
    competitionId: economy.competitionId,
    payload: { ...input, matchday: economy },
  });
  return { ...economy, operationScope, financeOperationId: operationId, eventOperationId, duplicate: false };
}

export function facilityEffectsForClub(room, clubId, now = new Date()) {
  const facility = facilityForClub(room, clubId, now);
  if (!facility) return {
    developmentMultiplier: 1,
    youthQualityBonus: 0,
    injuryRiskMultiplier: 1,
    recoveryBonus: 0,
    scoutingConfidenceBonus: 0,
    analysisConfidenceBonus: 0,
    fatigueMultiplier: 1,
  };
  const level = (id) => facility.areas.find((area) => area.id === id)?.level ?? 0;
  return {
    developmentMultiplier: 1 + level("training") * 0.025 + level("technology") * 0.01,
    youthQualityBonus: level("academy"),
    injuryRiskMultiplier: Math.max(0.65, 1 - level("medical") * 0.045 - level("physiology") * 0.02 - facility.stadium.pitchQuality / 2_500),
    recoveryBonus: level("recovery") + Math.floor(level("medical") / 2),
    scoutingConfidenceBonus: level("scouting") * 3,
    analysisConfidenceBonus: level("analysis") * 3 + level("technology"),
    fatigueMultiplier: Math.max(0.72, 1 - level("recovery") * 0.035 - level("physiology") * 0.025),
    administrationDiscount: Math.min(0.15, level("administration") * 0.025),
  };
}

export function facilitySnapshot(room, clubId, now = new Date()) {
  const state = ensureClubFacilities(room, now);
  const facility = facilityForClub(room, clubId, now);
  const projects = state.facilityProjects.filter((project) => clubKey(project.clubId) === clubKey(clubId));
  return facility ? { facility: facilityView(facility), projects: structuredClone(projects), effects: facilityEffectsForClub(room, clubId, now) } : null;
}
