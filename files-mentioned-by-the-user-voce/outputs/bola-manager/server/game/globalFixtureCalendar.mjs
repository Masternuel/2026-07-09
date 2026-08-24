const DAY_IN_MS = 24 * 60 * 60 * 1_000;

export const MIN_FIXTURE_REST_DAYS = 3;
export const MAX_FIXTURE_RESCHEDULE_DAYS = 60;
export const GLOBAL_FIXTURE_PRIORITY = Object.freeze({
  FIXED: 0,
  COMPETITION: 100,
  LEAGUE: 200,
});

export class GlobalFixtureCalendarError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "GlobalFixtureCalendarError";
    this.code = code;
    this.details = details;
    this.status = 409;
  }
}

function fail(message, code, details = null) {
  throw new GlobalFixtureCalendarError(message, code, details);
}

function text(value) {
  return String(value ?? "").trim();
}

function clubKey(value) {
  return text(value).toLocaleUpperCase("pt-BR");
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function calendarOptions(options = {}) {
  const minRestDays = options.minRestDays ?? MIN_FIXTURE_REST_DAYS;
  const maxRescheduleDays = options.maxRescheduleDays ?? MAX_FIXTURE_RESCHEDULE_DAYS;
  if (!Number.isSafeInteger(minRestDays) || minRestDays < 1) {
    fail("Descanso minimo invalido", "INVALID_GLOBAL_FIXTURE", {
      field: "minRestDays",
      value: minRestDays,
    });
  }
  if (!Number.isSafeInteger(maxRescheduleDays) || maxRescheduleDays < 0) {
    fail("Limite de remarcacao invalido", "INVALID_GLOBAL_FIXTURE", {
      field: "maxRescheduleDays",
      value: maxRescheduleDays,
    });
  }
  return {
    minRestDays,
    maxRescheduleDays,
    allowHistoricalLockedConflicts: options.allowHistoricalLockedConflicts === true,
  };
}

function normalizeFixtures(fixtures) {
  if (!Array.isArray(fixtures)) {
    fail("Lista de partidas invalida", "INVALID_GLOBAL_FIXTURE", { field: "fixtures" });
  }

  const ids = new Set();
  return fixtures.map((fixture, index) => {
    if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
      fail("Partida invalida no calendario global", "INVALID_GLOBAL_FIXTURE", { index });
    }

    const calendarId = text(fixture.calendarId ?? fixture.id);
    const homeClubKey = clubKey(fixture.homeClubId);
    const awayClubKey = clubKey(fixture.awayClubId);
    const date = new Date(fixture.scheduledAt ?? "");
    const preferredDate = new Date(fixture.originalScheduledAt ?? fixture.scheduledAt ?? "");
    const notBeforeDate = fixture.notBefore == null ? null : new Date(fixture.notBefore);
    if (!calendarId || ids.has(calendarId)) {
      fail("Partida sem identificador unico", "INVALID_GLOBAL_FIXTURE", {
        index,
        fixtureId: calendarId || null,
        field: fixture.calendarId == null ? "id" : "calendarId",
      });
    }
    if (!homeClubKey || !awayClubKey || homeClubKey === awayClubKey) {
      fail("Clubes invalidos na partida", "INVALID_GLOBAL_FIXTURE", {
        index,
        fixtureId: calendarId,
        homeClubId: fixture.homeClubId ?? null,
        awayClubId: fixture.awayClubId ?? null,
      });
    }
    if (!Number.isFinite(date.getTime())
      || !Number.isFinite(preferredDate.getTime())
      || (notBeforeDate && !Number.isFinite(notBeforeDate.getTime()))) {
      fail("Data invalida na partida", "INVALID_GLOBAL_FIXTURE", {
        index,
        fixtureId: calendarId,
        field: "scheduledAt",
        value: fixture.scheduledAt ?? null,
      });
    }
    if (typeof fixture.priority !== "number" || !Number.isFinite(fixture.priority)) {
      fail("Prioridade invalida na partida", "INVALID_GLOBAL_FIXTURE", {
        index,
        fixtureId: calendarId,
        field: "priority",
        value: fixture.priority ?? null,
      });
    }
    if (typeof fixture.locked !== "boolean") {
      fail("Bloqueio invalido na partida", "INVALID_GLOBAL_FIXTURE", {
        index,
        fixtureId: calendarId,
        field: "locked",
        value: fixture.locked ?? null,
      });
    }

    ids.add(calendarId);
    return {
      fixture,
      inputIndex: index,
      calendarId,
      homeClubKey,
      awayClubKey,
      clubKeys: [homeClubKey, awayClubKey],
      scheduledTimestamp: date.getTime(),
      originalTimestamp: preferredDate.getTime(),
      originalScheduledAt: preferredDate.toISOString(),
      notBeforeTimestamp: notBeforeDate?.getTime() ?? null,
      priority: fixture.priority,
      locked: fixture.locked,
      historical: fixture.historical === true,
    };
  });
}

function lowerBound(entries, timestamp) {
  let start = 0;
  let end = entries.length;
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    if (entries[middle].timestamp < timestamp) start = middle + 1;
    else end = middle;
  }
  return start;
}

function conflictAt(indexByClub, normalized, timestamp, restInMs) {
  if (restInMs <= 0) return null;
  for (const clubId of normalized.clubKeys) {
    const entries = indexByClub.get(clubId) ?? [];
    const insertionIndex = lowerBound(entries, timestamp);
    const neighbors = [entries[insertionIndex - 1], entries[insertionIndex]];
    for (const entry of neighbors) {
      if (entry && Math.abs(timestamp - entry.timestamp) < restInMs) {
        return {
          clubId,
          conflictingFixtureId: entry.calendarId,
          conflictingScheduledAt: new Date(entry.timestamp).toISOString(),
          locked: entry.locked,
          historical: entry.historical,
        };
      }
    }
  }
  return null;
}

function insertIntoClubIndex(indexByClub, normalized, timestamp) {
  for (const clubId of normalized.clubKeys) {
    const entries = indexByClub.get(clubId) ?? [];
    let insertionIndex = lowerBound(entries, timestamp);
    while (insertionIndex < entries.length
      && entries[insertionIndex].timestamp === timestamp
      && compareText(entries[insertionIndex].calendarId, normalized.calendarId) < 0) {
      insertionIndex += 1;
    }
    entries.splice(insertionIndex, 0, {
      calendarId: normalized.calendarId,
      timestamp,
      locked: normalized.locked,
      historical: normalized.historical,
    });
    indexByClub.set(clubId, entries);
  }
}

function processingOrder(left, right) {
  if (left.locked !== right.locked) return left.locked ? -1 : 1;
  return left.priority - right.priority
    || (left.locked
      ? left.scheduledTimestamp
      : Math.max(left.originalTimestamp, left.notBeforeTimestamp ?? left.originalTimestamp))
      - (right.locked
        ? right.scheduledTimestamp
        : Math.max(right.originalTimestamp, right.notBeforeTimestamp ?? right.originalTimestamp))
    || compareText(left.calendarId, right.calendarId);
}

function validationOrder(left, right) {
  return left.scheduledTimestamp - right.scheduledTimestamp
    || left.priority - right.priority
    || compareText(left.calendarId, right.calendarId);
}

function fixtureErrorDetails(entry) {
  return {
    fixtureId: entry.calendarId,
    competitionId: entry.fixture.competitionId
      ?? entry.fixture.tournamentId
      ?? entry.fixture.leagueId
      ?? entry.fixture.kind
      ?? null,
    homeClubId: entry.fixture.homeClubId,
    awayClubId: entry.fixture.awayClubId,
  };
}

export function validateGlobalFixtureCalendar(fixtures, options = {}) {
  const normalized = normalizeFixtures(fixtures);
  const { minRestDays, allowHistoricalLockedConflicts } = calendarOptions(options);
  const restInMs = minRestDays * DAY_IN_MS;
  const indexByClub = new Map();

  for (const entry of [...normalized].sort(validationOrder)) {
    if (entry.notBeforeTimestamp != null && entry.scheduledTimestamp < entry.notBeforeTimestamp) {
      fail("Partida foi marcada antes de sua fase classificatoria", "GLOBAL_CALENDAR_CONFLICT", {
        ...fixtureErrorDetails(entry),
        scheduledAt: new Date(entry.scheduledTimestamp).toISOString(),
        notBefore: new Date(entry.notBeforeTimestamp).toISOString(),
      });
    }
    const conflict = conflictAt(indexByClub, entry, entry.scheduledTimestamp, restInMs);
    if (conflict && !(
      allowHistoricalLockedConflicts && entry.historical && conflict.historical
    )) {
      fail("Calendario global possui partidas em conflito", "GLOBAL_CALENDAR_CONFLICT", {
        ...fixtureErrorDetails(entry),
        scheduledAt: new Date(entry.scheduledTimestamp).toISOString(),
        minRestDays,
        ...conflict,
      });
    }
    insertIntoClubIndex(indexByClub, entry, entry.scheduledTimestamp);
  }
  return true;
}

export function coordinateGlobalFixtureCalendar(fixtures, options = {}) {
  const normalized = normalizeFixtures(fixtures);
  const { minRestDays, maxRescheduleDays, allowHistoricalLockedConflicts } = calendarOptions(options);
  if (normalized.length === 0) return [];

  const restInMs = minRestDays * DAY_IN_MS;
  const maximumDelayInMs = maxRescheduleDays * DAY_IN_MS;
  const latestOriginalTimestamp = Math.max(...normalized.map((entry) => (
    entry.locked ? entry.scheduledTimestamp : entry.originalTimestamp
  )));
  const globalDeadline = latestOriginalTimestamp + maximumDelayInMs;
  const indexByClub = new Map();
  const scheduledById = new Map();

  for (const entry of [...normalized].sort(processingOrder)) {
    const fixtureDeadline = entry.originalTimestamp + maximumDelayInMs;
    const deadline = Math.min(fixtureDeadline, globalDeadline);
    let timestamp = entry.locked
      ? entry.scheduledTimestamp
      : Math.max(entry.originalTimestamp, entry.notBeforeTimestamp ?? entry.originalTimestamp);
    if (!entry.locked && timestamp > deadline) {
      fail("Nao foi possivel remarcar partida dentro do limite", "GLOBAL_CALENDAR_CAPACITY_EXCEEDED", {
        ...fixtureErrorDetails(entry),
        originalScheduledAt: entry.originalScheduledAt,
        notBefore: entry.notBeforeTimestamp == null
          ? null
          : new Date(entry.notBeforeTimestamp).toISOString(),
        fixtureDeadline: new Date(fixtureDeadline).toISOString(),
        globalDeadline: new Date(globalDeadline).toISOString(),
        minRestDays,
        maxRescheduleDays,
      });
    }
    let conflict = conflictAt(indexByClub, entry, timestamp, restInMs);

    if (entry.locked && conflict && !(
      allowHistoricalLockedConflicts && entry.historical && conflict.historical
    )) {
      fail("Partidas bloqueadas possuem conflito de descanso", "LOCKED_FIXTURE_CONFLICT", {
        ...fixtureErrorDetails(entry),
        scheduledAt: entry.originalScheduledAt,
        minRestDays,
        ...conflict,
      });
    }

    while (conflict && !entry.locked) {
      timestamp += DAY_IN_MS;
      if (!Number.isFinite(timestamp) || timestamp > deadline) {
        fail("Nao foi possivel remarcar partida dentro do limite", "GLOBAL_CALENDAR_CAPACITY_EXCEEDED", {
          ...fixtureErrorDetails(entry),
          originalScheduledAt: entry.originalScheduledAt,
          fixtureDeadline: new Date(fixtureDeadline).toISOString(),
          globalDeadline: new Date(globalDeadline).toISOString(),
          minRestDays,
          maxRescheduleDays,
          ...conflict,
        });
      }
      conflict = conflictAt(indexByClub, entry, timestamp, restInMs);
    }

    insertIntoClubIndex(indexByClub, entry, timestamp);
    scheduledById.set(entry.calendarId, timestamp);
  }

  const coordinated = normalized
    .sort((left, right) => left.inputIndex - right.inputIndex)
    .map((entry) => ({
      ...entry.fixture,
      scheduledAt: new Date(scheduledById.get(entry.calendarId)).toISOString(),
      originalScheduledAt: entry.originalScheduledAt,
      rescheduled: scheduledById.get(entry.calendarId) !== entry.originalTimestamp,
    }));
  validateGlobalFixtureCalendar(coordinated, {
    minRestDays,
    maxRescheduleDays,
    allowHistoricalLockedConflicts,
  });
  return coordinated;
}
