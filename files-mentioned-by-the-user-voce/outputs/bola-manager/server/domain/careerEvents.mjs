import {
  addCompactHashIndexValues,
  compactHashIndexContains,
  normalizeCompactHashIndex,
} from "./compactHashIndex.mjs";

const EVENT_SCHEMA_VERSION = 1;
const STATE_VERSION = 4;
const CAREER_ARCHIVE_VERSION = 1;
const CAREER_ARCHIVE_HIGHLIGHTS_PER_SEASON = 8;
const PROCESSED_ARCHIVE_VERSION = 1;

export const CAREER_RETENTION_LIMITS = Object.freeze({
  events: 1_000,
  news: 500,
  recentProcessedIds: 4_096,
  archiveHighlightsPerSeason: CAREER_ARCHIVE_HIGHLIGHTS_PER_SEASON,
});

export const CAREER_EVENT_TYPES = Object.freeze({
  MATCH_COMPLETED: "MATCH_COMPLETED",
  TRANSFER_COMPLETED: "TRANSFER_COMPLETED",
  TRANSFER_SCHEDULED: "TRANSFER_SCHEDULED",
  LOAN_STARTED: "LOAN_STARTED",
  LOAN_RETURNED: "LOAN_RETURNED",
  LOAN_PURCHASED: "LOAN_PURCHASED",
  PLAYER_INJURED: "PLAYER_INJURED",
  PLAYER_RETURNED_FROM_INJURY: "PLAYER_RETURNED_FROM_INJURY",
  PLAYER_SUSPENDED: "PLAYER_SUSPENDED",
  PLAYER_CONTRACT_RENEWED: "PLAYER_CONTRACT_RENEWED",
  PLAYER_CONTRACT_EXPIRED: "PLAYER_CONTRACT_EXPIRED",
  YOUTH_PROMOTED: "YOUTH_PROMOTED",
  STAFF_HIRED: "STAFF_HIRED",
  STAFF_FIRED: "STAFF_FIRED",
  STAFF_RESIGNED: "STAFF_RESIGNED",
  STAFF_CONTRACT_RENEWED: "STAFF_CONTRACT_RENEWED",
  STAFF_CONTRACT_EXPIRED: "STAFF_CONTRACT_EXPIRED",
  COACH_APPOINTED: "COACH_APPOINTED",
  COACH_DISMISSED: "COACH_DISMISSED",
  COACH_RESIGNED: "COACH_RESIGNED",
  COACH_INTERIM_APPOINTED: "COACH_INTERIM_APPOINTED",
  COACH_INTERIM_CONFIRMED: "COACH_INTERIM_CONFIRMED",
  COACH_CONTRACT_RENEWED: "COACH_CONTRACT_RENEWED",
  COACH_PROPOSAL_RECEIVED: "COACH_PROPOSAL_RECEIVED",
  COACH_SEARCH_STARTED: "COACH_SEARCH_STARTED",
  COACH_NEGOTIATION_FAILED: "COACH_NEGOTIATION_FAILED",
  COACH_BECAME_UNEMPLOYED: "COACH_BECAME_UNEMPLOYED",
  COACH_CHANGED_CLUB: "COACH_CHANGED_CLUB",
  COACH_SUCCESSION_SEARCH_STARTED: "COACH_SUCCESSION_SEARCH_STARTED",
  PROFESSIONAL_NOTICE_STARTED: "PROFESSIONAL_NOTICE_STARTED",
  PROFESSIONAL_NOTICE_COMPLETED: "PROFESSIONAL_NOTICE_COMPLETED",
  PROFESSIONAL_NOTICE_ENDED_EARLY: "PROFESSIONAL_NOTICE_ENDED_EARLY",
  PROFESSIONAL_RETIREMENT_ANNOUNCED: "PROFESSIONAL_RETIREMENT_ANNOUNCED",
  PROFESSIONAL_RETIREMENT_POSTPONED: "PROFESSIONAL_RETIREMENT_POSTPONED",
  PROFESSIONAL_RETIREMENT_CANCELLED: "PROFESSIONAL_RETIREMENT_CANCELLED",
  PROFESSIONAL_RETIREMENT_EFFECTIVE: "PROFESSIONAL_RETIREMENT_EFFECTIVE",
  PROFESSIONAL_LEAVE_SCHEDULED: "PROFESSIONAL_LEAVE_SCHEDULED",
  PROFESSIONAL_LEAVE_STARTED: "PROFESSIONAL_LEAVE_STARTED",
  PROFESSIONAL_LEAVE_COMPLETED: "PROFESSIONAL_LEAVE_COMPLETED",
  PROFESSIONAL_LEAVE_ENDED_EARLY: "PROFESSIONAL_LEAVE_ENDED_EARLY",
  PROFESSIONAL_LEAVE_CANCELLED: "PROFESSIONAL_LEAVE_CANCELLED",
  PROFESSIONAL_MUTUAL_AGREEMENT_PROPOSED: "PROFESSIONAL_MUTUAL_AGREEMENT_PROPOSED",
  PROFESSIONAL_MUTUAL_AGREEMENT_COUNTERED: "PROFESSIONAL_MUTUAL_AGREEMENT_COUNTERED",
  PROFESSIONAL_MUTUAL_AGREEMENT_ACCEPTED: "PROFESSIONAL_MUTUAL_AGREEMENT_ACCEPTED",
  PROFESSIONAL_MUTUAL_AGREEMENT_REJECTED: "PROFESSIONAL_MUTUAL_AGREEMENT_REJECTED",
  PROFESSIONAL_MUTUAL_AGREEMENT_SIGNED: "PROFESSIONAL_MUTUAL_AGREEMENT_SIGNED",
  PROFESSIONAL_MUTUAL_AGREEMENT_COMPLETED: "PROFESSIONAL_MUTUAL_AGREEMENT_COMPLETED",
  PROFESSIONAL_MUTUAL_SEPARATION_PROPOSED: "PROFESSIONAL_MUTUAL_SEPARATION_PROPOSED",
  PROFESSIONAL_MUTUAL_SEPARATION_COUNTER: "PROFESSIONAL_MUTUAL_SEPARATION_COUNTER",
  PROFESSIONAL_MUTUAL_SEPARATION_ACCEPT: "PROFESSIONAL_MUTUAL_SEPARATION_ACCEPT",
  PROFESSIONAL_MUTUAL_SEPARATION_REJECT: "PROFESSIONAL_MUTUAL_SEPARATION_REJECT",
  PROFESSIONAL_MUTUAL_SEPARATION_SIGN: "PROFESSIONAL_MUTUAL_SEPARATION_SIGN",
  PROFESSIONAL_MUTUAL_SEPARATION_EXECUTED: "PROFESSIONAL_MUTUAL_SEPARATION_EXECUTED",
  PROFESSIONAL_MUTUAL_SEPARATION_EXPIRED: "PROFESSIONAL_MUTUAL_SEPARATION_EXPIRED",
  COACH_PREFERRED_STAFF_UPDATED: "COACH_PREFERRED_STAFF_UPDATED",
  COACH_PREFERRED_STAFF_REMOVED: "COACH_PREFERRED_STAFF_REMOVED",
  COACH_STAFF_PACKAGE_HIRED: "COACH_STAFF_PACKAGE_HIRED",
  STAFF_COACH_LINK_UPDATED: "STAFF_COACH_LINK_UPDATED",
  STAFF_RETIREMENT_ANNOUNCED: "STAFF_RETIREMENT_ANNOUNCED",
  STAFF_RETIRED: "STAFF_RETIRED",
  STAFF_SEPARATED_BY_AGREEMENT: "STAFF_SEPARATED_BY_AGREEMENT",
  STAFF_RETAINED_AFTER_COACH_EXIT: "STAFF_RETAINED_AFTER_COACH_EXIT",
  STAFF_FOLLOWED_COACH: "STAFF_FOLLOWED_COACH",
  STAFF_INTERIM_PROMOTED: "STAFF_INTERIM_PROMOTED",
  STAFF_PACKAGE_HIRED: "STAFF_PACKAGE_HIRED",
  STAFF_TEAM_DISSOLVED: "STAFF_TEAM_DISSOLVED",
  STADIUM_UPGRADE_STARTED: "STADIUM_UPGRADE_STARTED",
  STADIUM_UPGRADE_COMPLETED: "STADIUM_UPGRADE_COMPLETED",
  INFRASTRUCTURE_UPGRADE_STARTED: "INFRASTRUCTURE_UPGRADE_STARTED",
  INFRASTRUCTURE_UPGRADE_COMPLETED: "INFRASTRUCTURE_UPGRADE_COMPLETED",
  COMPETITION_WON: "COMPETITION_WON",
  PRIZE_RECEIVED: "PRIZE_RECEIVED",
  SPONSOR_PAYMENT_RECEIVED: "SPONSOR_PAYMENT_RECEIVED",
});

export class CareerEventError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CareerEventError";
    this.code = code;
  }
}

function identifier(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function eventType(value) {
  return identifier(value).toLocaleUpperCase("en-US").replace(/[^A-Z0-9]+/g, "_");
}

function uniqueIdentifiers(values) {
  const result = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const item = identifier(value);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function normalizeProcessedArchive(value) {
  return normalizeCompactHashIndex(value, { version: PROCESSED_ARCHIVE_VERSION });
}

function processedArchiveContains(archive, keys) {
  return keys.some((key) => compactHashIndexContains(
    archive,
    key,
    { version: PROCESSED_ARCHIVE_VERSION },
  ));
}

function addProcessedKeysToArchive(archive, keys) {
  return addCompactHashIndexValues(
    archive,
    uniqueIdentifiers(keys),
    { version: PROCESSED_ARCHIVE_VERSION },
  );
}

function clean(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") return [];
      return [clean(item)];
    });
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
      result[key] = clean(item);
    }
    return result;
  }
  return null;
}

function timestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const text = identifier(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function fact(event, ...keys) {
  for (const key of keys) {
    const direct = event?.[key];
    if (direct !== undefined && direct !== null && direct !== "") return direct;
    const payload = event?.payload?.[key];
    if (payload !== undefined && payload !== null && payload !== "") return payload;
  }
  return null;
}

function textFact(event, ...keys) {
  return identifier(fact(event, ...keys));
}

function playerName(event) {
  return textFact(event, "playerName") || identifier(event?.payload?.player?.name);
}

function staffName(event) {
  return textFact(event, "staffName", "employeeName")
    || identifier(event?.payload?.staff?.name)
    || identifier(event?.payload?.employee?.name);
}

function coachName(event) {
  return textFact(event, "coachName", "managerName")
    || identifier(event?.payload?.coach?.name)
    || identifier(event?.payload?.manager?.name);
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(amount);
}

function durationText(value) {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration <= 0) return "";
  return `${duration} ${duration === 1 ? "partida" : "partidas"}`;
}

function normalizeEventInput(input) {
  if (!input || typeof input !== "object") {
    throw new CareerEventError("Evento da carreira invalido", "CAREER_EVENT_INVALID");
  }
  const type = eventType(input.type);
  if (!type) throw new CareerEventError("Tipo do evento e obrigatorio", "CAREER_EVENT_TYPE_REQUIRED");
  const operationId = identifier(input.operationId ?? input.originOperationId ?? input.id);
  const id = identifier(input.id) || (operationId ? `${type}:${operationId}` : "");
  if (!id || !operationId) {
    throw new CareerEventError(
      "Evento exige id ou operationId estavel",
      "CAREER_EVENT_ID_REQUIRED",
    );
  }
  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  const suppliedPayload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
    ? input.payload
    : {};
  const payloadSource = { ...metadata, ...suppliedPayload };
  for (const name of [
    "staffId",
    "coachId",
    "contractId",
    "proposalId",
    "vacancyId",
    "interviewId",
    "projectId",
    "playerId",
    "clubId",
    "relatedClubId",
    "amount",
    "coachName",
    "clubName",
    "reason",
  ]) {
    if (payloadSource[name] === undefined && input[name] !== undefined) payloadSource[name] = input[name];
  }
  const payload = clean(payloadSource);
  const occurredAt = timestamp(
    input.occurredAt ?? input.date ?? payload?.occurredAt ?? payload?.completedAt,
  );
  if (!occurredAt) {
    throw new CareerEventError(
      "Evento exige occurredAt valido",
      "CAREER_EVENT_OCCURRED_AT_REQUIRED",
    );
  }
  const clubIds = uniqueIdentifiers([
    ...(input.clubIds ?? []),
    input.clubId,
    payload?.clubId,
    payload?.fromClubId,
    payload?.toClubId,
    payload?.homeClubId,
    payload?.awayClubId,
  ]);
  const playerIds = uniqueIdentifiers([
    ...(input.playerIds ?? []),
    input.playerId,
    payload?.playerId,
    payload?.player?.id,
  ]);
  const coachIds = uniqueIdentifiers([
    ...(input.coachIds ?? []),
    input.coachId,
    payload?.coachId,
    payload?.coach?.id,
  ]);
  const managerIds = uniqueIdentifiers([
    ...(input.managerIds ?? []),
    input.managerId,
    payload?.managerId,
    payload?.targetManagerId,
    payload?.recipientManagerId,
  ]);
  return {
    id,
    type,
    operationId,
    occurredAt,
    seasonNumber: Number.isInteger(Number(input.seasonNumber ?? payload?.seasonNumber))
      ? Number(input.seasonNumber ?? payload?.seasonNumber)
      : null,
    aggregateType: identifier(input.aggregateType) || null,
    aggregateId: identifier(input.aggregateId) || null,
    staffId: identifier(input.staffId ?? payload?.staffId) || null,
    coachId: identifier(input.coachId ?? payload?.coachId) || coachIds[0] || null,
    contractId: identifier(input.contractId ?? payload?.contractId) || null,
    proposalId: identifier(input.proposalId ?? payload?.proposalId) || null,
    vacancyId: identifier(input.vacancyId ?? payload?.vacancyId) || null,
    interviewId: identifier(input.interviewId ?? payload?.interviewId) || null,
    projectId: identifier(input.projectId ?? payload?.projectId) || null,
    clubIds,
    playerIds,
    coachIds,
    managerIds,
    competitionId: identifier(input.competitionId ?? payload?.competitionId ?? payload?.leagueId) || null,
    matchId: identifier(input.matchId ?? payload?.matchId ?? payload?.fixtureId) || null,
    payload,
    schemaVersion: EVENT_SCHEMA_VERSION,
  };
}

function storedEvent(value) {
  try {
    return normalizeEventInput(value);
  } catch {
    return null;
  }
}

function processingKeys(event) {
  return uniqueIdentifiers([
    event.id,
    event.operationId ? `operation:${event.type}:${event.operationId}` : null,
  ]);
}

function storedProcessingKeys(event) {
  const normalized = storedEvent(event);
  return normalized ? processingKeys(normalized) : uniqueIdentifiers([event?.id]);
}

function sameOccurrence(left, right) {
  return left.id === right.id
    || (left.type === right.type && left.operationId === right.operationId);
}

function normalizeNews(value) {
  if (!value || typeof value !== "object") return null;
  const id = identifier(value.id);
  const sourceEventId = identifier(value.eventId ?? value.sourceEventId);
  if (!id || !sourceEventId) return null;
  return {
    ...clean(value),
    id,
    eventId: sourceEventId,
    eventType: eventType(value.eventType),
    readByManagerIds: uniqueIdentifiers(value.readByManagerIds),
    readAtByManagerId: value.readAtByManagerId && typeof value.readAtByManagerId === "object"
      ? clean(value.readAtByManagerId)
      : {},
  };
}

function newsProcessingKeys(news) {
  return uniqueIdentifiers([
    news?.eventId,
    news?.eventType && news?.originOperationId
      ? `operation:${eventType(news.eventType)}:${identifier(news.originOperationId)}`
      : null,
  ]);
}

function archiveSeasonNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function archiveSeasonKey(value) {
  const season = archiveSeasonNumber(value);
  return season ? `season:${season}` : "season:unknown";
}

function boundedText(value, maxLength) {
  const text = identifier(value);
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizedCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function normalizeCountMap(value, maxKeys = 64) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, count]) => [boundedText(key, 80), normalizedCount(count)])
    .filter(([key, count]) => key && count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, maxKeys));
}

function archiveFacts(event) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const result = {};
  for (const key of [
    "playerName",
    "staffName",
    "clubName",
    "fromClubName",
    "toClubName",
    "homeClubName",
    "awayClubName",
    "competitionName",
    "projectName",
    "facilityName",
    "round",
    "amount",
    "score",
  ]) {
    const value = payload[key];
    if (typeof value === "string") {
      const text = boundedText(value, 100);
      if (text) result[key] = text;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    } else if (key === "score" && Array.isArray(value)) {
      const score = value.slice(0, 2).map(Number);
      if (score.length === 2 && score.every((goal) => Number.isInteger(goal) && goal >= 0)) {
        result.score = score;
      }
    }
  }
  return result;
}

function normalizeArchiveHighlight(value) {
  if (!value || typeof value !== "object") return null;
  const id = identifier(value.id);
  const eventId = identifier(value.eventId ?? (value.kind === "event" ? value.id : null));
  const occurredAt = timestamp(value.occurredAt ?? value.publishedAt ?? value.date);
  if (!id || !eventId || !occurredAt) return null;
  const kind = value.kind === "news" ? "news" : "event";
  const readByManagerIds = uniqueIdentifiers(value.readByManagerIds).slice(0, 32);
  const readAtSource = value.readAtByManagerId && typeof value.readAtByManagerId === "object"
    ? value.readAtByManagerId
    : {};
  const readAtByManagerId = Object.fromEntries(readByManagerIds.flatMap((managerId) => {
    const readAt = timestamp(readAtSource[managerId]);
    return readAt ? [[managerId, readAt]] : [];
  }));
  return {
    id,
    kind,
    eventId,
    eventType: eventType(value.eventType ?? value.type),
    originOperationId: identifier(value.originOperationId ?? value.operationId) || null,
    occurredAt,
    seasonNumber: archiveSeasonNumber(value.seasonNumber),
    clubIds: uniqueIdentifiers(value.clubIds).slice(0, 8),
    playerIds: uniqueIdentifiers(value.playerIds).slice(0, 8),
    competitionId: identifier(value.competitionId) || null,
    matchId: identifier(value.matchId) || null,
    title: kind === "news" ? boundedText(value.title, 180) : "",
    summary: kind === "news" ? boundedText(value.summary ?? value.content, 320) : "",
    category: kind === "news" ? boundedText(value.category, 48) : "",
    importance: value.importance === "alta" ? "alta" : "normal",
    facts: kind === "event" && value.facts && typeof value.facts === "object"
      ? clean(value.facts)
      : {},
    readByManagerIds,
    readAtByManagerId,
  };
}

function archiveHighlightPriority(highlight) {
  if (highlight.kind === "news" && highlight.importance === "alta") return 4;
  if ([
    CAREER_EVENT_TYPES.COMPETITION_WON,
    CAREER_EVENT_TYPES.TRANSFER_COMPLETED,
    CAREER_EVENT_TYPES.LOAN_PURCHASED,
    CAREER_EVENT_TYPES.COACH_APPOINTED,
    CAREER_EVENT_TYPES.COACH_DISMISSED,
    CAREER_EVENT_TYPES.COACH_CHANGED_CLUB,
    CAREER_EVENT_TYPES.STADIUM_UPGRADE_COMPLETED,
    CAREER_EVENT_TYPES.INFRASTRUCTURE_UPGRADE_COMPLETED,
  ].includes(highlight.eventType)) return 3;
  return highlight.kind === "news" ? 2 : 1;
}

function mergeArchiveHighlights(highlights, candidate = null) {
  const byEvent = new Map();
  for (const raw of [...(Array.isArray(highlights) ? highlights : []), candidate]) {
    const highlight = normalizeArchiveHighlight(raw);
    if (!highlight) continue;
    const previous = byEvent.get(highlight.eventId);
    if (!previous || highlight.kind === "news" || previous.kind !== "news") {
      byEvent.set(highlight.eventId, highlight);
    }
  }
  return [...byEvent.values()]
    .sort((left, right) => (
      archiveHighlightPriority(right) - archiveHighlightPriority(left)
      || right.occurredAt.localeCompare(left.occurredAt)
      || right.id.localeCompare(left.id)
    ))
    .slice(0, CAREER_ARCHIVE_HIGHLIGHTS_PER_SEASON);
}

function normalizeSeasonArchive(value) {
  if (!value || typeof value !== "object") return null;
  const seasonNumber = archiveSeasonNumber(value.seasonNumber);
  const key = archiveSeasonKey(seasonNumber);
  const firstOccurredAt = timestamp(value.firstOccurredAt);
  const lastOccurredAt = timestamp(value.lastOccurredAt);
  return {
    key,
    seasonNumber,
    firstOccurredAt,
    lastOccurredAt,
    eventCount: normalizedCount(value.eventCount),
    eventTypeCounts: normalizeCountMap(value.eventTypeCounts),
    newsCount: normalizedCount(value.newsCount),
    newsCategoryCounts: normalizeCountMap(value.newsCategoryCounts),
    readNewsCountByManagerId: normalizeCountMap(value.readNewsCountByManagerId, 32),
    highlights: mergeArchiveHighlights(value.highlights),
  };
}

function mergeSeasonArchives(left, right) {
  const timestamps = [left.firstOccurredAt, left.lastOccurredAt, right.firstOccurredAt, right.lastOccurredAt]
    .filter(Boolean).sort();
  const mergeCounts = (first, second) => {
    const merged = { ...first };
    for (const [key, count] of Object.entries(second)) merged[key] = (merged[key] ?? 0) + count;
    return merged;
  };
  return {
    key: left.key,
    seasonNumber: left.seasonNumber,
    firstOccurredAt: timestamps[0] ?? null,
    lastOccurredAt: timestamps.at(-1) ?? null,
    eventCount: left.eventCount + right.eventCount,
    eventTypeCounts: mergeCounts(left.eventTypeCounts, right.eventTypeCounts),
    newsCount: left.newsCount + right.newsCount,
    newsCategoryCounts: mergeCounts(left.newsCategoryCounts, right.newsCategoryCounts),
    readNewsCountByManagerId: mergeCounts(
      left.readNewsCountByManagerId,
      right.readNewsCountByManagerId,
    ),
    highlights: mergeArchiveHighlights([...left.highlights, ...right.highlights]),
  };
}

function normalizeCareerArchive(value) {
  const byKey = new Map();
  const seasons = value && typeof value === "object" && Array.isArray(value.seasons)
    ? value.seasons
    : [];
  for (const raw of seasons) {
    const season = normalizeSeasonArchive(raw);
    if (!season) continue;
    const previous = byKey.get(season.key);
    byKey.set(season.key, previous ? mergeSeasonArchives(previous, season) : season);
  }
  return {
    version: CAREER_ARCHIVE_VERSION,
    seasons: [...byKey.values()].sort((left, right) => (
      (left.seasonNumber ?? Number.MAX_SAFE_INTEGER) - (right.seasonNumber ?? Number.MAX_SAFE_INTEGER)
    )),
  };
}

function archiveSeason(state, seasonNumber) {
  const key = archiveSeasonKey(seasonNumber);
  let season = state.careerArchive.seasons.find((candidate) => candidate.key === key);
  if (season) return season;
  season = normalizeSeasonArchive({ seasonNumber });
  state.careerArchive.seasons.push(season);
  state.careerArchive.seasons.sort((left, right) => (
    (left.seasonNumber ?? Number.MAX_SAFE_INTEGER) - (right.seasonNumber ?? Number.MAX_SAFE_INTEGER)
  ));
  return season;
}

function updateArchiveRange(season, occurredAt) {
  const at = timestamp(occurredAt);
  if (!at) return;
  if (!season.firstOccurredAt || at < season.firstOccurredAt) season.firstOccurredAt = at;
  if (!season.lastOccurredAt || at > season.lastOccurredAt) season.lastOccurredAt = at;
}

function archiveCareerEvent(state, value) {
  const event = storedEvent(value);
  if (!event) return;
  const season = archiveSeason(state, event.seasonNumber);
  season.eventCount += 1;
  season.eventTypeCounts[event.type] = (season.eventTypeCounts[event.type] ?? 0) + 1;
  updateArchiveRange(season, event.occurredAt);
  season.highlights = mergeArchiveHighlights(season.highlights, {
    id: event.id,
    kind: "event",
    eventId: event.id,
    eventType: event.type,
    originOperationId: event.operationId,
    occurredAt: event.occurredAt,
    seasonNumber: event.seasonNumber,
    clubIds: event.clubIds,
    playerIds: event.playerIds,
    competitionId: event.competitionId,
    matchId: event.matchId,
    facts: archiveFacts(event),
  });
}

function archiveCareerNews(state, value, sourceEvent = null) {
  const news = normalizeNews(value);
  if (!news) return;
  const seasonNumber = archiveSeasonNumber(news.seasonNumber ?? sourceEvent?.seasonNumber);
  const season = archiveSeason(state, seasonNumber);
  season.newsCount += 1;
  const category = boundedText(news.category, 48) || "sem_categoria";
  season.newsCategoryCounts[category] = (season.newsCategoryCounts[category] ?? 0) + 1;
  for (const managerId of uniqueIdentifiers(news.readByManagerIds).slice(0, 32)) {
    season.readNewsCountByManagerId[managerId] = (
      season.readNewsCountByManagerId[managerId] ?? 0
    ) + 1;
  }
  updateArchiveRange(season, news.publishedAt ?? news.date);
  season.highlights = mergeArchiveHighlights(season.highlights, {
    ...news,
    kind: "news",
    occurredAt: news.publishedAt ?? news.date,
    seasonNumber,
  });
}

function compactProcessedIndex(state, archiveKeys = []) {
  const identifiers = uniqueIdentifiers(state.processedEventIds);
  const overflow = Math.max(0, identifiers.length - CAREER_RETENTION_LIMITS.recentProcessedIds);
  state.processedEventIds = overflow > 0 ? identifiers.slice(overflow) : identifiers;
  state.processedEventArchive = addProcessedKeysToArchive(
    state.processedEventArchive,
    [...archiveKeys, ...identifiers.slice(0, overflow)],
  );
}

function applyCareerRetention(state) {
  const archivedKeys = [];
  const sourceEvents = new Map(state.events.map((event) => [identifier(event?.id), event]));
  if (state.events.length > CAREER_RETENTION_LIMITS.events) {
    const overflow = state.events.length - CAREER_RETENTION_LIMITS.events;
    for (const event of state.events.slice(0, overflow)) {
      archiveCareerEvent(state, event);
      archivedKeys.push(...storedProcessingKeys(event));
    }
    state.events = state.events.slice(overflow);
  }
  if (state.news.length > CAREER_RETENTION_LIMITS.news) {
    const overflow = state.news.length - CAREER_RETENTION_LIMITS.news;
    for (const news of state.news.slice(0, overflow)) {
      archiveCareerNews(state, news, sourceEvents.get(identifier(news?.eventId)));
      archivedKeys.push(...newsProcessingKeys(news));
    }
    state.news = state.news.slice(overflow);
  }
  compactProcessedIndex(state, archivedKeys);
  return state;
}

/**
 * Migra saves antigos sem fabricar saldo, eventos ou noticias.
 * A funcao altera somente room.clubCareerState, preservando outros dominios.
 */
export function ensureClubCareerState(room) {
  if (!room || typeof room !== "object") {
    throw new CareerEventError("Sala invalida", "CAREER_ROOM_INVALID");
  }
  const state = room.clubCareerState && typeof room.clubCareerState === "object"
    ? room.clubCareerState
    : {};
  const events = [];
  for (const candidate of Array.isArray(state.events) ? state.events : []) {
    const normalized = storedEvent(candidate);
    if (normalized) {
      if (!events.some((event) => sameOccurrence(event, normalized))) events.push(normalized);
      continue;
    }
    // Dominios anteriores podem ter eventos com um schema proprio. Preserva-os
    // para a migracao do dominio de origem, mas nao os transforma em noticia.
    const legacyId = identifier(candidate?.id);
    if (legacyId && !events.some((event) => identifier(event?.id) === legacyId)) {
      events.push(clean(candidate));
    }
  }
  const news = [];
  for (const candidate of Array.isArray(state.news) ? state.news : []) {
    const normalized = normalizeNews(candidate);
    if (!normalized || news.some((item) => item.id === normalized.id || item.eventId === normalized.eventId)) continue;
    news.push(normalized);
  }
  const processedEventIds = uniqueIdentifiers([
    ...(Array.isArray(state.processedEventIds) ? state.processedEventIds : []),
    ...news.map((item) => item.eventId),
    ...news.flatMap((item) => {
      const source = events.find((event) => identifier(event?.id) === item.eventId);
      return source && storedEvent(source) ? processingKeys(source) : [];
    }),
  ]);
  state.version = Math.max(STATE_VERSION, Number(state.version) || 0);
  state.events = events;
  state.news = news;
  state.processedEventIds = processedEventIds;
  state.processedEventArchive = normalizeProcessedArchive(state.processedEventArchive);
  delete state.processedEventBloom;
  state.careerArchive = normalizeCareerArchive(state.careerArchive);
  applyCareerRetention(state);
  room.clubCareerState = state;
  return state;
}

export function createCareerEvent(input) {
  return normalizeEventInput(input);
}

function baseNews(event, {
  title,
  summary,
  content = summary,
  category,
  importance = "normal",
  visualType = "bulletin",
  clubIds = event.clubIds,
  playerIds = event.playerIds,
  coachIds = event.coachIds,
}) {
  return {
    id: `career-news:${event.id}`,
    kind: "career_news",
    eventId: event.id,
    eventType: event.type,
    originOperationId: event.operationId,
    seasonNumber: event.seasonNumber,
    title,
    summary,
    content,
    publishedAt: event.occurredAt,
    date: event.occurredAt,
    category,
    importance,
    clubIds: uniqueIdentifiers(clubIds),
    playerIds: uniqueIdentifiers(playerIds),
    coachIds: uniqueIdentifiers(coachIds),
    competitionId: event.competitionId,
    matchId: event.matchId,
    visualType,
    readByManagerIds: [],
    readAtByManagerId: {},
    schemaVersion: 1,
  };
}

function reasonedSentence(message, event) {
  const reason = textFact(event, "reason", "terminationReason", "exitReason").replace(/[.\s]+$/u, "");
  return `${message}${reason ? `. Motivo: ${reason}` : ""}.`;
}

function coachAppointmentNews(event, mode) {
  const coach = coachName(event);
  const club = textFact(event, "clubName", "toClubName");
  if (!coach || !club) return null;
  const copies = {
    appointed: {
      title: `${club} anuncia ${coach}`,
      summary: reasonedSentence(`${coach} foi nomeado treinador do ${club}`, event),
      importance: "alta",
    },
    interim: {
      title: `${coach} assume interinamente o ${club}`,
      summary: reasonedSentence(`${coach} assumiu o comando interino do ${club}`, event),
      importance: "normal",
    },
    confirmed: {
      title: `${club} efetiva ${coach}`,
      summary: reasonedSentence(`${coach} foi efetivado no comando do ${club}`, event),
      importance: "alta",
    },
  };
  return baseNews(event, {
    ...copies[mode],
    category: "treinadores",
    visualType: "coach",
  });
}

function coachDepartureNews(event, mode) {
  const coach = coachName(event);
  const club = textFact(event, "clubName", "fromClubName");
  if (!coach || (mode !== "unemployed" && !club)) return null;
  const copies = {
    dismissed: {
      title: `${club} demite ${coach}`,
      summary: reasonedSentence(`${club} encerrou o vínculo com ${coach}`, event),
      importance: "alta",
    },
    resigned: {
      title: `${coach} deixa o ${club}`,
      summary: reasonedSentence(`${coach} pediu demissão do ${club}`, event),
      importance: "alta",
    },
    unemployed: {
      title: `${coach} está livre no mercado`,
      summary: reasonedSentence(
        `${coach}${club ? ` deixou o ${club} e` : ""} está sem clube`,
        event,
      ),
      importance: "normal",
    },
  };
  return baseNews(event, {
    ...copies[mode],
    category: "treinadores",
    visualType: "coach",
  });
}

function coachContractRenewalNews(event) {
  const coach = coachName(event);
  const club = textFact(event, "clubName");
  if (!coach || !club) return null;
  const endDate = textFact(event, "endDate", "contractEndDate");
  const endSeason = Number(fact(event, "endSeason"));
  const until = endDate || (Number.isInteger(endSeason) ? `a temporada ${endSeason}` : "");
  const summary = `${coach} renovou o contrato com ${club}${until ? ` até ${until}` : ""}.`;
  return baseNews(event, {
    title: `${coach} renova com ${club}`,
    summary,
    category: "treinadores",
    importance: "alta",
    visualType: "coach_contract",
  });
}

function coachProposalNews(event) {
  const coach = coachName(event);
  const club = textFact(event, "clubName", "toClubName");
  if (!coach || !club) return null;
  // Valores e cláusulas são deliberadamente omitidos da notícia pública.
  const summary = `${club} fez uma abordagem oficial para conversar com ${coach}.`;
  return baseNews(event, {
    title: `${club} demonstra interesse em ${coach}`,
    summary,
    category: "treinadores",
    importance: "normal",
    visualType: "coach_interest",
  });
}

function coachSearchNews(event) {
  const club = textFact(event, "clubName");
  if (!club) return null;
  return baseNews(event, {
    title: `${club} inicia busca por treinador`,
    summary: reasonedSentence(`${club} abriu oficialmente a procura por um novo treinador`, event),
    category: "treinadores",
    importance: "normal",
    visualType: "coach_search",
  });
}

function coachNegotiationFailedNews(event) {
  const coach = coachName(event);
  const club = textFact(event, "clubName", "toClubName");
  if (!coach || !club) return null;
  return baseNews(event, {
    title: `${club} e ${coach} encerram negociação`,
    summary: reasonedSentence(`${club} e ${coach} não chegaram a um acordo`, event),
    category: "treinadores",
    importance: "normal",
    visualType: "coach_negotiation",
  });
}

function coachChangedClubNews(event) {
  const coach = coachName(event);
  const destination = textFact(event, "toClubName", "clubName");
  if (!coach || !destination) return null;
  const origin = textFact(event, "fromClubName");
  const summary = `${coach}${origin ? ` deixou o ${origin} e` : ""} assumiu o comando do ${destination}.`;
  return baseNews(event, {
    title: `${destination} anuncia ${coach}`,
    summary,
    category: "treinadores",
    importance: "alta",
    visualType: "coach",
  });
}

function matchNews(event) {
  const home = textFact(event, "homeClubName", "homeTeam");
  const away = textFact(event, "awayClubName", "awayTeam");
  const score = fact(event, "score");
  if (!home || !away || !Array.isArray(score) || score.length < 2) return null;
  const homeGoals = Number(score[0]);
  const awayGoals = Number(score[1]);
  if (!Number.isInteger(homeGoals) || homeGoals < 0 || !Number.isInteger(awayGoals) || awayGoals < 0) return null;
  const title = `${home} ${homeGoals} x ${awayGoals} ${away}`;
  const competition = textFact(event, "competitionName", "competition");
  const round = Number(fact(event, "round"));
  const context = [competition, Number.isInteger(round) && round > 0 ? `rodada ${round}` : ""]
    .filter(Boolean).join(" - ");
  const summary = `${title}${context ? `, pela ${context}` : ""}.`;
  return baseNews(event, {
    title,
    summary,
    content: summary,
    category: "resultados",
    importance: Math.abs(homeGoals - awayGoals) >= 3 ? "alta" : "normal",
    visualType: "scoreboard",
  });
}

function transferNews(event) {
  const player = playerName(event);
  const destination = textFact(event, "toClubName", "buyerClubName");
  if (!player || !destination) return null;
  const origin = textFact(event, "fromClubName", "sellerClubName");
  const amount = money(fact(event, "amount", "fee"));
  const title = `${destination} anuncia ${player}`;
  const parts = [`${player} foi transferido${origin ? ` por ${origin}` : ""} para ${destination}`];
  if (amount) parts.push(`por ${amount}`);
  const summary = `${parts.join(" ")}.`;
  return baseNews(event, {
    title,
    summary,
    category: "mercado",
    importance: "alta",
    visualType: "transfer",
  });
}

function scheduledTransferNews(event) {
  const player = playerName(event);
  const destination = textFact(event, "toClubName", "buyerClubName");
  const effectiveSeason = Number(fact(event, "effectiveSeason"));
  if (!player || !destination || !Number.isInteger(effectiveSeason)) return null;
  const summary = `${player} acertou a ida para ${destination} na temporada ${effectiveSeason}.`;
  return baseNews(event, {
    title: `${player} acerta transferência futura`,
    summary,
    category: "mercado",
    importance: "normal",
    visualType: "transfer",
  });
}

function loanStartedNews(event) {
  const player = playerName(event);
  const destination = textFact(event, "borrowerClubName", "toClubName");
  if (!player || !destination) return null;
  const lender = textFact(event, "lenderClubName", "fromClubName");
  const summary = `${player} foi emprestado${lender ? ` por ${lender}` : ""} para ${destination}.`;
  return baseNews(event, {
    title: `${destination} recebe ${player} por empréstimo`,
    summary,
    category: "mercado",
    importance: "normal",
    visualType: "loan",
  });
}

function loanReturnedNews(event) {
  const player = playerName(event);
  const owner = textFact(event, "lenderClubName", "toClubName", "ownerClubName");
  if (!player || !owner) return null;
  const summary = `${player} encerrou o empréstimo e retornou ao ${owner}.`;
  return baseNews(event, {
    title: `${player} retorna ao ${owner}`,
    summary,
    category: "mercado",
    importance: "normal",
    visualType: "loan",
  });
}

function loanPurchasedNews(event) {
  const player = playerName(event);
  const destination = textFact(event, "borrowerClubName", "toClubName");
  if (!player || !destination) return null;
  const amount = money(fact(event, "amount", "purchaseAmount"));
  const summary = `${destination} exerceu a compra de ${player}${amount ? ` por ${amount}` : ""}.`;
  return baseNews(event, {
    title: `${destination} confirma compra de ${player}`,
    summary,
    category: "mercado",
    importance: "alta",
    visualType: "transfer",
  });
}

function playerAvailabilityNews(event, mode) {
  const player = playerName(event);
  const club = textFact(event, "clubName");
  if (!player) return null;
  const duration = durationText(fact(event, "matches", "durationMatches", "injuryMatches", "suspensionMatches"));
  const copies = {
    injury: {
      title: `${player} sofre lesão`,
      summary: `${player}${club ? `, do ${club},` : ""} ficará fora${duration ? ` por ${duration}` : ""}.`,
      category: "departamento_medico",
      visualType: "injury",
    },
    return: {
      title: `${player} volta a ficar disponível`,
      summary: `${player}${club ? `, do ${club},` : ""} foi liberado após a lesão.`,
      category: "departamento_medico",
      visualType: "recovery",
    },
    suspension: {
      title: `${player} está suspenso`,
      summary: `${player}${club ? `, do ${club},` : ""} cumprirá suspensão${duration ? ` por ${duration}` : ""}.`,
      category: "disciplina",
      visualType: "suspension",
    },
  };
  const copy = copies[mode];
  return baseNews(event, { ...copy, importance: mode === "return" ? "normal" : "alta" });
}

function staffNews(event, hired) {
  const staff = staffName(event);
  const club = textFact(event, "clubName");
  const role = textFact(event, "role", "staffRole");
  if (!staff || !club) return null;
  const action = hired ? "contratou" : "encerrou o vínculo com";
  const summary = `${club} ${action} ${staff}${role ? `, ${role}` : ""}.`;
  return baseNews(event, {
    title: hired ? `${staff} chega ao ${club}` : `${staff} deixa o ${club}`,
    summary,
    category: "comissao_tecnica",
    importance: "normal",
    visualType: "staff",
  });
}

function staffContractNews(event, renewed) {
  const staff = staffName(event);
  const club = textFact(event, "clubName");
  const role = textFact(event, "role", "staffRole");
  if (!staff || !club) return null;
  const endDate = textFact(event, "endDate", "contractEndDate");
  const endSeason = Number(fact(event, "endSeason"));
  const until = endDate || (Number.isInteger(endSeason) ? `a temporada ${endSeason}` : "");
  const summary = renewed
    ? `${staff}${role ? `, ${role},` : ""} renovou com ${club}${until ? ` até ${until}` : ""}.`
    : `O contrato de ${staff}${role ? `, ${role},` : ""} com ${club} terminou.`;
  return baseNews(event, {
    title: renewed ? `${staff} renova com ${club}` : `${staff} encerra vínculo com ${club}`,
    summary,
    category: "comissao_tecnica",
    importance: "normal",
    visualType: "staff",
  });
}

function professionalLifecycleNews(event) {
  const professionalType = textFact(event, "professionalType");
  const resolvedProfessional = professionalType === "staff"
    ? staffName(event)
    : coachName(event) || staffName(event);
  const professional = resolvedProfessional || "O profissional";
  const club = textFact(event, "clubName");
  const displayName = professional;
  const copies = {
    PROFESSIONAL_NOTICE_STARTED: {
      title: `${professional} entra em aviso prévio`,
      summary: `${professional}${club ? ` e ${club}` : ""} iniciaram uma transição profissional planejada.`,
      importance: "alta",
    },
    PROFESSIONAL_NOTICE_COMPLETED: {
      title: `${professional} conclui aviso prévio`,
      summary: `${professional}${club ? ` encerrou o vínculo com ${club}` : " concluiu o período de aviso"}.`,
    },
    PROFESSIONAL_NOTICE_ENDED_EARLY: {
      title: `${professional} encerra transição antecipadamente`,
      summary: `O aviso prévio de ${professional}${club ? ` no ${club}` : ""} terminou antes da data prevista.`,
    },
    PROFESSIONAL_RETIREMENT_ANNOUNCED: {
      title: `${professional} anuncia aposentadoria`,
      summary: `${professional} confirmou que encerrará a carreira profissional.`,
      importance: "alta",
    },
    PROFESSIONAL_RETIREMENT_POSTPONED: {
      title: `${professional} adia aposentadoria`,
      summary: `${professional} decidiu prolongar a carreira e definiu uma nova data de aposentadoria.`,
    },
    PROFESSIONAL_RETIREMENT_CANCELLED: {
      title: `${professional} cancela aposentadoria`,
      summary: `${professional} retirou o plano de aposentadoria e permanece no mercado profissional.`,
    },
    PROFESSIONAL_RETIREMENT_EFFECTIVE: {
      title: `${displayName} encerra a carreira`,
      summary: `${displayName} efetivou a aposentadoria e deixa o mercado profissional.`,
      importance: "alta",
    },
    PROFESSIONAL_LEAVE_SCHEDULED: {
      title: `${displayName} terá período de afastamento`,
      summary: `${displayName}${club ? `, do ${club},` : ""} programou um afastamento profissional com retorno previsto.`,
    },
    PROFESSIONAL_LEAVE_STARTED: {
      title: `${displayName} inicia afastamento`,
      summary: `${displayName}${club ? ` ficará temporariamente afastado do ${club}` : " ficará temporariamente afastado"}. O contrato permanece ativo.`,
      importance: "alta",
    },
    PROFESSIONAL_LEAVE_COMPLETED: {
      title: `${displayName} retorna ao trabalho`,
      summary: `${displayName}${club ? ` foi reintegrado ao ${club}` : " concluiu o afastamento e foi reintegrado"}.`,
    },
    PROFESSIONAL_LEAVE_ENDED_EARLY: {
      title: `${displayName} antecipa retorno`,
      summary: `${displayName}${club ? ` voltou ao ${club}` : " voltou às atividades"} antes da data prevista.`,
    },
    PROFESSIONAL_LEAVE_CANCELLED: {
      title: `Afastamento de ${displayName} é cancelado`,
      summary: `${displayName}${club ? ` permanece normalmente no ${club}` : " permanece em atividade"}.`,
    },
    PROFESSIONAL_MUTUAL_AGREEMENT_COMPLETED: {
      title: `${professional} deixa ${club || "o clube"} em comum acordo`,
      summary: `${professional}${club ? ` e ${club}` : ""} formalizaram a rescisão consensual.`,
      importance: "alta",
    },
    PROFESSIONAL_MUTUAL_SEPARATION_PROPOSED: {
      title: `${professional} negocia saída de ${club || "seu clube"}`,
      summary: `${professional}${club ? ` e ${club}` : ""} abriram uma negociação de rescisão consensual.`,
    },
    PROFESSIONAL_MUTUAL_SEPARATION_COUNTER: {
      title: `Negociação com ${professional} recebe contraproposta`,
      summary: `As condições para a saída de ${professional} foram revistas.`,
    },
    PROFESSIONAL_MUTUAL_SEPARATION_ACCEPT: {
      title: `Acordo com ${professional} é aceito`,
      summary: `${professional}${club ? ` e ${club}` : ""} chegaram a um entendimento sujeito à assinatura.`,
    },
    PROFESSIONAL_MUTUAL_SEPARATION_REJECT: {
      title: `Acordo com ${professional} é recusado`,
      summary: `A negociação de saída de ${professional} terminou sem consenso.`,
    },
    PROFESSIONAL_MUTUAL_SEPARATION_SIGN: {
      title: `Acordo com ${professional} é assinado`,
      summary: `As partes formalizaram as condições para a saída de ${professional}.`,
    },
    PROFESSIONAL_MUTUAL_SEPARATION_EXECUTED: {
      title: `${professional} deixa ${club || "o clube"} em comum acordo`,
      summary: `${professional}${club ? ` e ${club}` : ""} concluíram a rescisão consensual.`,
      importance: "alta",
    },
    PROFESSIONAL_MUTUAL_SEPARATION_EXPIRED: {
      title: `Negociação com ${professional} expira`,
      summary: `O prazo do acordo de saída terminou sem conclusão.`,
    },
    STAFF_RETIREMENT_ANNOUNCED: {
      title: `${professional} anuncia aposentadoria`,
      summary: `${professional} informou quando encerrará a carreira na comissão técnica.`,
      importance: "alta",
    },
    STAFF_RETIRED: {
      title: `${professional} encerra a carreira`,
      summary: `${professional}${club ? ` se aposentou no ${club}` : " se aposentou"}.`,
      importance: "alta",
    },
    STAFF_SEPARATED_BY_AGREEMENT: {
      title: `${professional} deixa ${club || "o clube"} em comum acordo`,
      summary: `A rescisão de ${professional} foi concluída de forma consensual.`,
    },
    STAFF_INTERIM_PROMOTED: {
      title: `${professional} assume interinamente`,
      summary: `${professional}${club ? ` assume o comando do ${club}` : " assume o comando interino"}.`,
      importance: "alta",
    },
    STAFF_PACKAGE_HIRED: {
      title: `${club || "Clube"} confirma nova comissão`,
      summary: `${club || "O clube"} concluiu a contratação conjunta do treinador e sua equipe técnica.`,
      importance: "alta",
    },
    COACH_STAFF_PACKAGE_HIRED: {
      title: `${club || "Clube"} confirma nova comissão`,
      summary: `${club || "O clube"} concluiu a contratação conjunta do treinador e sua equipe técnica.`,
      importance: "alta",
    },
    COACH_PREFERRED_STAFF_UPDATED: {
      title: `${professional} atualiza comissão preferencial`,
      summary: `${professional} adicionou um profissional à sua rede de confiança.`,
    },
    COACH_PREFERRED_STAFF_REMOVED: {
      title: `${professional} altera comissão preferencial`,
      summary: `${professional} removeu um profissional da sua rede de confiança.`,
    },
    STAFF_COACH_LINK_UPDATED: {
      title: `${professional} atualiza vínculo com treinador`,
      summary: `O vínculo profissional de ${professional}${club ? ` no ${club}` : ""} foi atualizado.`,
    },
    STAFF_RESIGNED: {
      title: `${professional} deixa ${club || "o clube"}`,
      summary: `${professional}${club ? ` encerrou seu vínculo com ${club}` : " encerrou seu vínculo profissional"}.`,
      importance: "alta",
    },
  };
  const copy = copies[event.type];
  if (!copy) return null;
  return baseNews(event, {
    ...copy,
    category: "comissao_tecnica",
    importance: copy.importance ?? "normal",
    visualType: "staff",
  });
}

function upgradeNews(event, { stadium, completed }) {
  const club = textFact(event, "clubName");
  const project = textFact(event, "projectName", "upgradeName", "facilityName", "name");
  if (!club || !project) return null;
  const place = stadium ? "estádio" : "infraestrutura";
  const action = completed ? "concluiu" : "iniciou";
  const summary = `${club} ${action} ${project} em seu ${place}.`;
  return baseNews(event, {
    title: completed ? `${club} conclui ${project}` : `${club} inicia ${project}`,
    summary,
    category: stadium ? "estadio" : "infraestrutura",
    importance: completed ? "alta" : "normal",
    visualType: stadium ? "stadium" : "infrastructure",
  });
}

function contractNews(event, renewed) {
  const player = playerName(event);
  const club = textFact(event, "clubName");
  if (!player || !club) return null;
  const endDate = textFact(event, "endDate", "contractEndDate");
  const endSeason = Number(fact(event, "endSeason"));
  const until = endDate || (Number.isInteger(endSeason) ? `a temporada ${endSeason}` : "");
  const summary = renewed
    ? `${player} renovou com ${club}${until ? ` até ${until}` : ""}.`
    : `O contrato de ${player} com ${club} terminou.`;
  return baseNews(event, {
    title: renewed ? `${player} renova com ${club}` : `${player} deixa o ${club} ao fim do contrato`,
    summary,
    category: "contratos",
    importance: "normal",
    visualType: "contract",
  });
}

function youthNews(event) {
  const player = playerName(event);
  const club = textFact(event, "clubName");
  if (!player || !club) return null;
  const summary = `${player} foi promovido das categorias de base ao elenco principal do ${club}.`;
  return baseNews(event, {
    title: `${club} promove ${player}`, summary, category: "base", importance: "normal", visualType: "youth",
  });
}

function prizeNews(event) {
  const club = textFact(event, "clubName");
  const competition = textFact(event, "competitionName", "competition");
  const amount = money(fact(event, "amount"));
  if (!club || !competition || !amount) return null;
  const reason = textFact(event, "reason", "prizeName");
  const summary = `${club} recebeu ${amount} da ${competition}${reason ? ` por ${reason}` : ""}.`;
  return baseNews(event, {
    title: `${club} recebe premiação`, summary, category: "financas", importance: "alta", visualType: "prize",
  });
}

function competitionWonNews(event) {
  const club = textFact(event, "clubName");
  const competition = textFact(event, "competitionName", "competition");
  if (!club || !competition) return null;
  const summary = `${club} conquistou a ${competition}.`;
  return baseNews(event, {
    title: `${club} conquista a ${competition}`,
    summary,
    category: "competicoes",
    importance: "alta",
    visualType: "prize",
  });
}

function sponsorPaymentNews(event) {
  const club = textFact(event, "clubName");
  const amount = money(fact(event, "amount"));
  if (!club || !amount) return null;
  const sponsor = textFact(event, "sponsorName");
  const summary = `${club} recebeu ${amount}${sponsor ? ` de ${sponsor}` : " em receita de patrocínio"}.`;
  return baseNews(event, {
    title: `${club} recebe pagamento de patrocínio`,
    summary,
    category: "financas",
    importance: "normal",
    visualType: "finance",
  });
}

export function buildCareerNews(eventInput) {
  const event = normalizeEventInput(eventInput);
  switch (event.type) {
    case CAREER_EVENT_TYPES.MATCH_COMPLETED: return matchNews(event);
    case CAREER_EVENT_TYPES.TRANSFER_COMPLETED: return transferNews(event);
    case CAREER_EVENT_TYPES.TRANSFER_SCHEDULED: return scheduledTransferNews(event);
    case CAREER_EVENT_TYPES.LOAN_STARTED: return loanStartedNews(event);
    case CAREER_EVENT_TYPES.LOAN_RETURNED: return loanReturnedNews(event);
    case CAREER_EVENT_TYPES.LOAN_PURCHASED: return loanPurchasedNews(event);
    case CAREER_EVENT_TYPES.PLAYER_INJURED: return playerAvailabilityNews(event, "injury");
    case CAREER_EVENT_TYPES.PLAYER_RETURNED_FROM_INJURY: return playerAvailabilityNews(event, "return");
    case CAREER_EVENT_TYPES.PLAYER_SUSPENDED: return playerAvailabilityNews(event, "suspension");
    case CAREER_EVENT_TYPES.STAFF_HIRED: return staffNews(event, true);
    case CAREER_EVENT_TYPES.STAFF_FIRED: return staffNews(event, false);
    case CAREER_EVENT_TYPES.STAFF_CONTRACT_RENEWED: return staffContractNews(event, true);
    case CAREER_EVENT_TYPES.STAFF_CONTRACT_EXPIRED: return staffContractNews(event, false);
    case CAREER_EVENT_TYPES.COACH_APPOINTED: return coachAppointmentNews(event, "appointed");
    case CAREER_EVENT_TYPES.COACH_DISMISSED: return coachDepartureNews(event, "dismissed");
    case CAREER_EVENT_TYPES.COACH_RESIGNED: return coachDepartureNews(event, "resigned");
    case CAREER_EVENT_TYPES.COACH_INTERIM_APPOINTED: return coachAppointmentNews(event, "interim");
    case CAREER_EVENT_TYPES.COACH_INTERIM_CONFIRMED: return coachAppointmentNews(event, "confirmed");
    case CAREER_EVENT_TYPES.COACH_CONTRACT_RENEWED: return coachContractRenewalNews(event);
    case CAREER_EVENT_TYPES.COACH_PROPOSAL_RECEIVED: return coachProposalNews(event);
    case CAREER_EVENT_TYPES.COACH_SEARCH_STARTED: return coachSearchNews(event);
    case CAREER_EVENT_TYPES.COACH_NEGOTIATION_FAILED: return coachNegotiationFailedNews(event);
    case CAREER_EVENT_TYPES.COACH_BECAME_UNEMPLOYED: return coachDepartureNews(event, "unemployed");
    case CAREER_EVENT_TYPES.COACH_CHANGED_CLUB: return coachChangedClubNews(event);
    case CAREER_EVENT_TYPES.PROFESSIONAL_NOTICE_STARTED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_NOTICE_COMPLETED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_NOTICE_ENDED_EARLY:
    case CAREER_EVENT_TYPES.PROFESSIONAL_RETIREMENT_ANNOUNCED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_RETIREMENT_POSTPONED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_RETIREMENT_CANCELLED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_RETIREMENT_EFFECTIVE:
    case CAREER_EVENT_TYPES.PROFESSIONAL_LEAVE_SCHEDULED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_LEAVE_STARTED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_LEAVE_COMPLETED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_LEAVE_ENDED_EARLY:
    case CAREER_EVENT_TYPES.PROFESSIONAL_LEAVE_CANCELLED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_MUTUAL_AGREEMENT_COMPLETED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_MUTUAL_SEPARATION_PROPOSED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_MUTUAL_SEPARATION_COUNTER:
    case CAREER_EVENT_TYPES.PROFESSIONAL_MUTUAL_SEPARATION_ACCEPT:
    case CAREER_EVENT_TYPES.PROFESSIONAL_MUTUAL_SEPARATION_REJECT:
    case CAREER_EVENT_TYPES.PROFESSIONAL_MUTUAL_SEPARATION_SIGN:
    case CAREER_EVENT_TYPES.PROFESSIONAL_MUTUAL_SEPARATION_EXECUTED:
    case CAREER_EVENT_TYPES.PROFESSIONAL_MUTUAL_SEPARATION_EXPIRED:
    case CAREER_EVENT_TYPES.STAFF_RETIREMENT_ANNOUNCED:
    case CAREER_EVENT_TYPES.STAFF_RETIRED:
    case CAREER_EVENT_TYPES.STAFF_SEPARATED_BY_AGREEMENT:
    case CAREER_EVENT_TYPES.STAFF_INTERIM_PROMOTED:
    case CAREER_EVENT_TYPES.STAFF_PACKAGE_HIRED:
    case CAREER_EVENT_TYPES.COACH_STAFF_PACKAGE_HIRED:
    case CAREER_EVENT_TYPES.COACH_PREFERRED_STAFF_UPDATED:
    case CAREER_EVENT_TYPES.COACH_PREFERRED_STAFF_REMOVED:
    case CAREER_EVENT_TYPES.STAFF_COACH_LINK_UPDATED:
    case CAREER_EVENT_TYPES.STAFF_RESIGNED:
      return professionalLifecycleNews(event);
    case CAREER_EVENT_TYPES.STADIUM_UPGRADE_STARTED: return upgradeNews(event, { stadium: true, completed: false });
    case CAREER_EVENT_TYPES.STADIUM_UPGRADE_COMPLETED: return upgradeNews(event, { stadium: true, completed: true });
    case CAREER_EVENT_TYPES.INFRASTRUCTURE_UPGRADE_STARTED: return upgradeNews(event, { stadium: false, completed: false });
    case CAREER_EVENT_TYPES.INFRASTRUCTURE_UPGRADE_COMPLETED: return upgradeNews(event, { stadium: false, completed: true });
    case CAREER_EVENT_TYPES.PLAYER_CONTRACT_RENEWED: return contractNews(event, true);
    case CAREER_EVENT_TYPES.PLAYER_CONTRACT_EXPIRED: return contractNews(event, false);
    case CAREER_EVENT_TYPES.YOUTH_PROMOTED: return youthNews(event);
    case CAREER_EVENT_TYPES.COMPETITION_WON: return competitionWonNews(event);
    case CAREER_EVENT_TYPES.PRIZE_RECEIVED: return prizeNews(event);
    case CAREER_EVENT_TYPES.SPONSOR_PAYMENT_RECEIVED: return sponsorPaymentNews(event);
    default: return null;
  }
}

function roomClubName(room, clubId) {
  const target = identifier(clubId).toLocaleLowerCase("pt-BR");
  if (!target) return "";
  for (const competition of [
    ...(room?.competitionCatalog ?? []),
    ...(room?.tournamentCatalog ?? []),
  ]) {
    const clubs = competition?.clubs ?? competition?.participants ?? [];
    const club = clubs.find((candidate) => (
      [candidate?.id, candidate?.code, candidate?.name]
        .some((value) => identifier(value).toLocaleLowerCase("pt-BR") === target)
    ));
    if (club?.name) return identifier(club.name);
  }
  return "";
}

function roomCompetitionName(room, competitionId) {
  const target = identifier(competitionId).toLocaleLowerCase("pt-BR");
  if (!target) return "";
  return identifier([
    ...(room?.competitionCatalog ?? []),
    ...(room?.tournamentCatalog ?? []),
  ].find((competition) => identifier(competition?.id).toLocaleLowerCase("pt-BR") === target)?.name);
}

function roomPlayerName(room, playerId) {
  const target = identifier(playerId).toLocaleLowerCase("pt-BR");
  if (!target) return "";
  const career = (room?.careerState?.players ?? []).find(
    (player) => identifier(player?.id).toLocaleLowerCase("pt-BR") === target,
  );
  if (career?.name) return identifier(career.name);
  const registration = (room?.marketState?.registrations ?? []).find(
    (item) => identifier(item?.playerId).toLocaleLowerCase("pt-BR") === target,
  );
  return identifier(registration?.playerSnapshot?.name);
}

function roomStaffName(room, staffId) {
  const target = identifier(staffId).toLocaleLowerCase("pt-BR");
  if (!target) return "";
  const staff = [
    ...(room?.clubCareerState?.staffMembers ?? []),
    ...(room?.clubCareerState?.staffCandidates ?? []),
  ].find(
    (item) => identifier(item?.id).toLocaleLowerCase("pt-BR") === target,
  );
  return identifier(staff?.name);
}

function roomStaffFacts(room, staffId) {
  const target = identifier(staffId).toLocaleLowerCase("pt-BR");
  if (!target) return null;
  return [
    ...(room?.clubCareerState?.staffMembers ?? []),
    ...(room?.clubCareerState?.staffCandidates ?? []),
  ].find((item) => identifier(item?.id).toLocaleLowerCase("pt-BR") === target) ?? null;
}

function roomStaffContract(room, contractId) {
  const target = identifier(contractId).toLocaleLowerCase("pt-BR");
  if (!target) return null;
  return (room?.clubCareerState?.staffContracts ?? []).find(
    (item) => identifier(item?.id).toLocaleLowerCase("pt-BR") === target,
  ) ?? null;
}

function roomCoachFacts(room, coachId) {
  const target = identifier(coachId).toLocaleLowerCase("pt-BR");
  if (!target) return null;
  const employmentState = room?.coachEmploymentState && typeof room.coachEmploymentState === "object"
    ? room.coachEmploymentState
    : {};
  return [
    employmentState.coach,
    ...(employmentState.coaches ?? []),
    ...(room?.coachCareerState?.coaches ?? []),
    ...(room?.managers ?? []),
  ].find((item) => [item?.id, item?.coachId, item?.managerId]
    .some((value) => identifier(value).toLocaleLowerCase("pt-BR") === target)) ?? null;
}

function roomCoachName(room, coachId) {
  return identifier(roomCoachFacts(room, coachId)?.name);
}

function roomCoachContract(room, contractId) {
  const target = identifier(contractId).toLocaleLowerCase("pt-BR");
  if (!target) return null;
  return (room?.coachEmploymentState?.contracts ?? []).find(
    (item) => identifier(item?.id).toLocaleLowerCase("pt-BR") === target,
  ) ?? null;
}

/** Completa somente nomes presentes no save; nunca cria entidades. */
export function enrichCareerEventFacts(room, eventInput) {
  const event = normalizeEventInput(eventInput);
  const payload = { ...event.payload };
  const homeClubId = identifier(payload.homeClubId);
  const awayClubId = identifier(payload.awayClubId);
  const fromClubId = identifier(payload.fromClubId ?? payload.sellerClubId ?? payload.lenderClubId);
  const toClubId = identifier(payload.toClubId ?? payload.buyerClubId ?? payload.borrowerClubId);
  const primaryClubId = identifier(payload.clubId ?? event.clubIds[0]);
  if (!payload.clubName && payload.club?.name) payload.clubName = identifier(payload.club.name);
  if (!payload.homeClubName && homeClubId) payload.homeClubName = roomClubName(room, homeClubId);
  if (!payload.awayClubName && awayClubId) payload.awayClubName = roomClubName(room, awayClubId);
  if (!payload.fromClubName && fromClubId) payload.fromClubName = roomClubName(room, fromClubId);
  if (!payload.toClubName && toClubId) payload.toClubName = roomClubName(room, toClubId);
  if (!payload.lenderClubName && payload.lenderClubId) {
    payload.lenderClubName = roomClubName(room, payload.lenderClubId);
  }
  if (!payload.borrowerClubName && payload.borrowerClubId) {
    payload.borrowerClubName = roomClubName(room, payload.borrowerClubId);
  }
  if (!payload.clubName && primaryClubId) payload.clubName = roomClubName(room, primaryClubId);
  if (!payload.playerName) {
    payload.playerName = identifier(payload.player?.name)
      || roomPlayerName(room, payload.playerId ?? event.playerIds[0]);
  }
  if (!payload.staffName) {
    payload.staffName = identifier(payload.staff?.name)
      || roomStaffName(room, payload.staffId ?? event.staffId ?? event.aggregateId);
  }
  if (!payload.coachName) {
    payload.coachName = identifier(payload.coach?.name)
      || roomCoachName(room, payload.coachId ?? event.coachId ?? event.coachIds[0]);
  }
  const staff = roomStaffFacts(room, payload.staffId ?? event.staffId ?? event.aggregateId);
  if (!payload.role && !payload.staffRole && staff?.role) payload.role = identifier(staff.role);
  const staffContract = roomStaffContract(room, payload.contractId ?? event.contractId);
  if (!payload.endDate && staffContract?.endDate) payload.endDate = timestamp(staffContract.endDate);
  if (payload.endSeason === undefined && staffContract?.endSeason !== undefined) {
    payload.endSeason = Number(staffContract.endSeason);
  }
  const coachContract = roomCoachContract(room, payload.contractId ?? event.contractId);
  if (!payload.endDate && coachContract?.endDate) payload.endDate = timestamp(coachContract.endDate);
  if (payload.endSeason === undefined && coachContract?.endSeason !== undefined) {
    payload.endSeason = Number(coachContract.endSeason);
  }
  if (!payload.competitionName && event.competitionId) {
    payload.competitionName = roomCompetitionName(room, event.competitionId);
  }
  for (const [name, value] of Object.entries(payload)) if (value === "") delete payload[name];
  return { ...event, payload: clean(payload) };
}

function processed(state, event) {
  const keys = new Set(state.processedEventIds);
  const candidates = processingKeys(event);
  return candidates.some((key) => keys.has(key))
    || processedArchiveContains(state.processedEventArchive, candidates);
}

function rememberProcessed(state, event) {
  state.processedEventIds = uniqueIdentifiers([
    ...state.processedEventIds,
    ...processingKeys(event),
  ]);
  compactProcessedIndex(state);
}

export function projectCareerEventToNews(room, eventInput) {
  const state = ensureClubCareerState(room);
  const event = normalizeEventInput(eventInput);
  const existing = state.news.find((item) => (
    item.eventId === event.id
    || (item.eventType === event.type && item.originOperationId === event.operationId)
  )) ?? null;
  if (existing || processed(state, event)) {
    return { news: existing, created: false, processed: true };
  }
  const news = buildCareerNews(enrichCareerEventFacts(room, event));
  if (news) state.news.push(news);
  rememberProcessed(state, event);
  applyCareerRetention(state);
  return { news, created: Boolean(news), processed: true };
}

export function appendCareerEvent(room, input, { projectNews = true } = {}) {
  const state = ensureClubCareerState(room);
  const currentSeason = archiveSeasonNumber(room?.currentSeason);
  const candidate = normalizeEventInput(
    currentSeason && input?.seasonNumber == null && input?.payload?.seasonNumber == null
      ? { ...input, seasonNumber: currentSeason }
      : input,
  );
  const previous = state.events.find((event) => sameOccurrence(event, candidate)) ?? null;
  const wasProcessed = !previous && processed(state, candidate);
  const event = previous ?? candidate;
  if (!previous && !wasProcessed) state.events.push(event);
  const projection = projectNews
    ? projectCareerEventToNews(room, event)
    : { news: state.news.find((item) => item.eventId === event.id) ?? null, created: false, processed: false };
  applyCareerRetention(state);
  return {
    event,
    created: !previous && !wasProcessed,
    news: projection.news,
    newsCreated: projection.created,
    state,
  };
}

export const recordCareerEvent = appendCareerEvent;

export function appendCareerEvents(room, inputs, options) {
  return (Array.isArray(inputs) ? inputs : []).map((input) => appendCareerEvent(room, input, options));
}

export function projectPendingCareerNews(room) {
  const state = ensureClubCareerState(room);
  return state.events.flatMap((event) => (
    storedEvent(event) ? [projectCareerEventToNews(room, event)] : []
  ));
}

export function careerArchiveForSeason(room, seasonNumber) {
  const state = ensureClubCareerState(room);
  const key = archiveSeasonKey(seasonNumber);
  const season = state.careerArchive.seasons.find((candidate) => candidate.key === key);
  return season ? clean(season) : null;
}

export function careerArchiveSummary(room) {
  const state = ensureClubCareerState(room);
  return clean(state.careerArchive);
}

function archivedNewsItems(state) {
  return state.careerArchive.seasons.flatMap((season) => season.highlights.flatMap((highlight) => (
    highlight.kind === "news"
      ? [{
        ...highlight,
        publishedAt: highlight.occurredAt,
        date: highlight.occurredAt,
        content: highlight.summary,
        visualType: "archive",
        archived: true,
      }]
      : []
  )));
}

export function setCareerNewsReadState(room, newsId, managerId, read, readAt = null) {
  const state = ensureClubCareerState(room);
  const canonicalNewsId = identifier(newsId);
  const canonicalManagerId = identifier(managerId);
  if (!canonicalManagerId) {
    throw new CareerEventError("Manager obrigatorio", "CAREER_NEWS_MANAGER_REQUIRED");
  }
  let archiveSeason = null;
  let item = state.news.find((candidate) => candidate.id === canonicalNewsId);
  if (!item) {
    for (const season of state.careerArchive.seasons) {
      const archived = season.highlights.find((candidate) => (
        candidate.kind === "news" && candidate.id === canonicalNewsId
      ));
      if (!archived) continue;
      item = archived;
      archiveSeason = season;
      break;
    }
  }
  if (!item) throw new CareerEventError("Noticia nao encontrada", "CAREER_NEWS_NOT_FOUND");
  const readers = new Set(item.readByManagerIds ?? []);
  const readDates = { ...(item.readAtByManagerId ?? {}) };
  const wasRead = readers.has(canonicalManagerId);
  if (read) {
    readers.add(canonicalManagerId);
    const canonicalReadAt = timestamp(readAt);
    if (canonicalReadAt) readDates[canonicalManagerId] = canonicalReadAt;
  } else {
    readers.delete(canonicalManagerId);
    delete readDates[canonicalManagerId];
  }
  item.readByManagerIds = [...readers];
  item.readAtByManagerId = readDates;
  if (archiveSeason && wasRead !== Boolean(read)) {
    const previous = archiveSeason.readNewsCountByManagerId[canonicalManagerId] ?? 0;
    const next = Math.max(0, previous + (read ? 1 : -1));
    if (next > 0) archiveSeason.readNewsCountByManagerId[canonicalManagerId] = next;
    else delete archiveSeason.readNewsCountByManagerId[canonicalManagerId];
  }
  return clean(item);
}

export function markCareerNewsRead(room, newsId, managerId, readAt = null) {
  return setCareerNewsReadState(room, newsId, managerId, true, readAt);
}

export function careerNewsForManager(
  room,
  managerId,
  { clubId = null, limit = 50, includeArchived = false } = {},
) {
  const state = ensureClubCareerState(room);
  const canonicalManagerId = identifier(managerId);
  const canonicalClubId = identifier(clubId);
  const source = includeArchived
    ? [...state.news, ...archivedNewsItems(state)]
    : state.news;
  return source
    .filter((item) => !canonicalClubId || item.clubIds?.includes(canonicalClubId))
    .slice()
    .sort((left, right) => (
      String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? ""))
      || right.id.localeCompare(left.id)
    ))
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((item) => ({
      ...clean(item),
      read: canonicalManagerId ? item.readByManagerIds.includes(canonicalManagerId) : false,
    }));
}

export function unreadCareerNewsCount(room, managerId, options) {
  return careerNewsForManager(room, managerId, { ...options, limit: Number.MAX_SAFE_INTEGER })
    .filter((item) => !item.read).length;
}
