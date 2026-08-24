const LEGACY_FIXTURE_CATALOG = Object.freeze({
  abertura: { homeSlot: 0, awaySlot: 1, fallbackAway: "SAN" },
  "rodada-2": { homeSlot: 1, awaySlot: 0, fallbackHome: "PAL" },
  "copa-ida": { homeSlot: 0, awaySlot: 2, fallbackAway: "FLA" },
});

export const FIXTURE_ORDER = Object.freeze(Object.keys(LEGACY_FIXTURE_CATALOG));
export const FIXTURE_SCHEDULE_VERSION = 4;

const DAY_IN_MS = 24 * 60 * 60 * 1_000;

const CLUB_NAMES = Object.freeze({
  AUR: "Aurora FC",
  SAN: "Santos",
  PAL: "Palmeiras",
  FLA: "Flamengo",
  COR: "Corinthians",
  GRE: "Gremio",
  INT: "Internacional",
  CRU: "Cruzeiro",
  FLU: "Fluminense",
  BOT: "Botafogo",
  BAH: "Bahia",
  FOR: "Fortaleza",
  CAM: "Atletico-MG",
  CAP: "Athletico-PR",
  VAS: "Vasco",
  SAO: "Sao Paulo",
});

const AI_CLUB_IDS = Object.freeze([
  "PAL", "FLA", "COR", "GRE", "INT", "CRU", "FLU", "BOT",
  "BAH", "FOR", "CAM", "CAP", "VAS", "SAO",
]);

const LEGACY_FALLBACK_CLUB_IDS = Object.freeze(["SAN", ...AI_CLUB_IDS, "AUR"]);

function clubKey(clubId) {
  return String(clubId ?? "").trim().toLocaleUpperCase("pt-BR");
}

function fixtureKey(fixtureId) {
  return String(fixtureId ?? "").trim().toLocaleLowerCase("pt-BR");
}

function clubIdsEqual(left, right) {
  return clubKey(left) === clubKey(right);
}

export function leagueLegs(league) {
  const configured = String(league?.legs ?? "").trim().toLocaleLowerCase("pt-BR");
  if (configured === "single" || configured === "double") return configured;
  if (typeof league?.brasfootRaw?.doisTurnos === "boolean") {
    return league.brasfootRaw.doisTurnos ? "double" : "single";
  }
  // League records created before the rule existed represented national
  // championships, which use home and away legs by default.
  return "double";
}

export function fixtureIdsEqual(left, right) {
  return fixtureKey(left) === fixtureKey(right);
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function validDate(value) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * First league match is scheduled on the first Sunday at least two days after
 * the save starts. Keeping this calculation in UTC makes imported/shared saves
 * deterministic in every server timezone.
 */
export function seasonCalendarStart(room) {
  const seasonYear = Number.isInteger(Number(room?.seasonYear))
    ? Number(room.seasonYear)
    : new Date().getUTCFullYear();
  const startedAt = validDate(room?.seasonStartedAt ?? room?.startedAt ?? room?.createdAt)
    ?? new Date(Date.UTC(seasonYear, 0, 1));
  const candidate = new Date(startedAt.getTime() + (2 * DAY_IN_MS));
  candidate.setUTCHours(19, 0, 0, 0);
  const daysUntilSunday = (7 - candidate.getUTCDay()) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysUntilSunday);
  return candidate;
}

export function scheduledLeagueKickoff(room, round = 1) {
  const kickoff = seasonCalendarStart(room);
  kickoff.setUTCDate(kickoff.getUTCDate() + (Math.max(1, Number(round) || 1) - 1) * 7);
  return kickoff.toISOString();
}

function managerClub(room, slot, fallback) {
  return room.managers[slot]?.clubId || fallback;
}

function catalogContext(room) {
  const leagueCatalog = Array.isArray(room?.competitionCatalog) ? room.competitionCatalog : [];
  const tournamentCatalog = Array.isArray(room?.tournamentCatalog) ? room.tournamentCatalog : [];
  if (leagueCatalog.length === 0 && tournamentCatalog.length === 0) return null;
  const leaguesById = new Map();
  const clubsById = new Map();
  for (const league of leagueCatalog) {
    const leagueId = String(league?.id ?? "").trim();
    if (!leagueId) continue;
    leaguesById.set(clubKey(leagueId), league);
    for (const club of Array.isArray(league.clubs) ? league.clubs : []) {
      const id = String(club?.id ?? "").trim();
      if (!id) continue;
      clubsById.set(clubKey(id), { ...club, id, leagueId });
    }
  }
  for (const tournament of tournamentCatalog) {
    for (const participant of Array.isArray(tournament?.participants) ? tournament.participants : []) {
      const id = String(participant?.id ?? "").trim();
      if (!id) continue;
      const current = clubsById.get(clubKey(id)) ?? {};
      clubsById.set(clubKey(id), {
        ...participant,
        ...current,
        id,
        code: current.code ?? participant.abbreviation,
        color: current.color ?? participant.colors?.[0],
        leagueId: current.leagueId ?? participant.leagueId ?? null,
      });
    }
  }
  return clubsById.size ? { leaguesById, clubsById } : null;
}

function teamFromClub(clubId, context = null) {
  const normalized = clubId || "IA";
  const comparisonId = clubKey(normalized);
  const catalogClub = context?.clubsById.get(comparisonId);
  const reputation = Number(catalogClub?.reputation);
  const stadiumCapacity = Number(catalogClub?.stadiumCapacity);
  const configuredStadium = typeof catalogClub?.stadium === "string" ? catalogClub.stadium.trim() : "";
  return {
    clubId: catalogClub?.id || normalized,
    name: catalogClub?.name || CLUB_NAMES[comparisonId] || normalized,
    code: catalogClub?.code || catalogClub?.abbreviation || comparisonId.slice(0, 8) || "IA",
    color: catalogClub?.color || catalogClub?.colors?.[0] || "#9ba3ad",
    darkThemeColor: typeof catalogClub?.darkThemeColor === "string" ? catalogClub.darkThemeColor : null,
    lightThemeColor: typeof catalogClub?.lightThemeColor === "string" ? catalogClub.lightThemeColor : null,
    crestImageUrl: typeof catalogClub?.crestImageUrl === "string" ? catalogClub.crestImageUrl : null,
    leagueId: catalogClub?.leagueId || null,
    stadium: configuredStadium || "A definir",
    stadiumCapacity: Number.isInteger(stadiumCapacity)
      && stadiumCapacity >= 0
      && stadiumCapacity <= 500_000
      ? stadiumCapacity
      : 0,
    strength: Number.isFinite(reputation)
      ? Math.max(1, Math.min(20, reputation))
      : 9 + (hashText(comparisonId) % 7),
  };
}

function fixtureIdAt(index) {
  return index === 0 ? "abertura" : `rodada-${index + 1}`;
}

function scheduledFixture(homeClubId, awayClubId, managedByClub, index, context = null, leagueId = null, round = index + 1, leagueFixtureId = null, scheduledAt = null) {
  const home = teamFromClub(homeClubId, context);
  const away = teamFromClub(awayClubId, context);
  const canonicalLeagueId = leagueId || (home.leagueId && home.leagueId === away.leagueId ? home.leagueId : null);
  const league = canonicalLeagueId ? context?.leaguesById.get(clubKey(canonicalLeagueId)) : null;
  const homeManagerId = managedByClub.get(clubKey(homeClubId))?.id ?? null;
  const awayManagerId = managedByClub.get(clubKey(awayClubId))?.id ?? null;
  return {
    fixtureId: fixtureIdAt(index),
    leagueFixtureId,
    round,
    scheduledAt: validDate(scheduledAt)?.toISOString() ?? null,
    competition: league?.name || "Competicao nao informada",
    leagueId: canonicalLeagueId,
    homeClubId: home.clubId,
    awayClubId: away.clubId,
    homeTeam: home.name,
    awayTeam: away.name,
    homeCode: home.code,
    awayCode: away.code,
    homeColor: home.color,
    awayColor: away.color,
    homeDarkThemeColor: home.darkThemeColor,
    homeLightThemeColor: home.lightThemeColor,
    awayDarkThemeColor: away.darkThemeColor,
    awayLightThemeColor: away.lightThemeColor,
    homeCrestImageUrl: home.crestImageUrl,
    awayCrestImageUrl: away.crestImageUrl,
    homeStadium: home.stadium,
    homeStadiumCapacity: home.stadiumCapacity,
    homeStrength: home.strength,
    awayStrength: away.strength,
    homeManagerId,
    awayManagerId,
    managerIds: [homeManagerId, awayManagerId].filter(Boolean),
  };
}

function normalizedIdPart(value) {
  return String(value ?? "league")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "league";
}

function createLeagueFixtureId(leagueId, round, matchNumber) {
  const leagueHash = hashText(String(leagueId)).toString(36);
  return `${normalizedIdPart(leagueId)}-${leagueHash}-r${round}-m${matchNumber}`;
}

// Circle method. A null slot represents a BYE, therefore odd-sized leagues
// keep the same guarantees without creating a fake club.
function roundRobinPairings(participants) {
  const rotation = participants.map((club) => club.id);
  if (rotation.length % 2 === 1) rotation.push(null);
  const roundCount = Math.max(0, rotation.length - 1);
  const pairings = [];

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    let matchNumber = 0;
    for (let pairIndex = 0; pairIndex < rotation.length / 2; pairIndex += 1) {
      const left = rotation[pairIndex];
      const right = rotation[rotation.length - 1 - pairIndex];
      if (!left || !right) continue;
      matchNumber += 1;
      // Berger orientation: rotating pairs keep their direction; fixed pair
      // alternates each round. This keeps home counts balanced.
      const swapHome = pairIndex === 0 && roundIndex % 2 === 1;
      pairings.push({
        homeClubId: swapHome ? right : left,
        awayClubId: swapHome ? left : right,
        round: roundIndex + 1,
        matchNumber,
      });
    }
    const last = rotation.pop();
    rotation.splice(1, 0, last);
  }
  return pairings;
}

export function createLeagueFixtureSchedule(room) {
  const context = catalogContext(room);
  if (!context) return [];
  const managedClubIds = new Set((room.managers ?? [])
    .map((manager) => clubKey(manager?.clubId))
    .filter(Boolean));
  const schedule = [];

  for (const league of room.competitionCatalog) {
    const leagueId = String(league?.id ?? "").trim();
    if (!leagueId) continue;
    let participants = (Array.isArray(league.clubs) ? league.clubs : [])
      .filter((club) => context.clubsById.has(clubKey(club?.id)));
    if (participants.length < 2) continue;
    if (participants.length % 2 === 1) {
      const byeClubIndex = participants.findIndex((club) => !managedClubIds.has(clubKey(club.id)));
      if (byeClubIndex > 0) {
        participants = [participants[byeClubIndex], ...participants.filter((_, index) => index !== byeClubIndex)];
      }
    }
    const firstLeg = roundRobinPairings(participants);
    const firstLegRoundCount = firstLeg.reduce((maximum, pairing) => (
      Math.max(maximum, pairing.round)
    ), 0);
    const pairings = leagueLegs(league) === "double"
      ? [
        ...firstLeg,
        ...firstLeg.map((pairing) => ({
          ...pairing,
          homeClubId: pairing.awayClubId,
          awayClubId: pairing.homeClubId,
          round: pairing.round + firstLegRoundCount,
        })),
      ]
      : firstLeg;
    for (const pairing of pairings) {
      const leagueFixtureId = createLeagueFixtureId(leagueId, pairing.round, pairing.matchNumber);
      schedule.push({
        leagueFixtureId,
        leagueId,
        round: pairing.round,
        scheduledAt: scheduledLeagueKickoff(room, pairing.round),
        homeClubId: pairing.homeClubId,
        awayClubId: pairing.awayClubId,
      });
    }
  }
  return schedule;
}

export function hydrateLeagueFixture(room, fixture) {
  const context = catalogContext(room);
  const managedByClub = new Map((room.managers ?? [])
    .filter((manager) => manager?.clubId)
    .map((manager) => [clubKey(manager.clubId), manager]));
  const hydrated = scheduledFixture(
    fixture.homeClubId,
    fixture.awayClubId,
    managedByClub,
    0,
    context,
    fixture.leagueId,
    fixture.round,
    fixture.leagueFixtureId,
    fixture.scheduledAt,
  );
  hydrated.fixtureId = fixture.leagueFixtureId;
  return hydrated;
}

export function hydrateCompetitionFixture(room, fixture) {
  const context = catalogContext(room);
  const managedByClub = new Map((room.managers ?? [])
    .filter((manager) => manager?.clubId)
    .map((manager) => [clubKey(manager.clubId), manager]));
  const competitionId = fixture?.tournamentId ?? fixture?.competitionId ?? null;
  const tournament = (room.tournamentCatalog ?? []).find(
    (candidate) => clubKey(candidate?.id) === clubKey(competitionId),
  );
  const hydrated = scheduledFixture(
    fixture.homeClubId,
    fixture.awayClubId,
    managedByClub,
    0,
    context,
    null,
    fixture.round ?? fixture.calendarRound ?? 1,
    null,
    fixture.scheduledAt,
  );
  const competitionFixtureId = fixture.competitionFixtureId ?? fixture.id;
  return {
    ...hydrated,
    fixtureId: competitionFixtureId,
    competitionFixtureId,
    tournamentId: competitionId,
    competition: tournament?.name ?? fixture.competitionName ?? competitionId ?? "Torneio",
    stage: fixture.stage ?? fixture.stageId ?? null,
    stageType: fixture.stageType ?? null,
    groupId: fixture.groupId ?? null,
    tieId: fixture.tieId ?? null,
    leg: fixture.leg ?? 1,
  };
}

function scheduleTimestamp(value) {
  return validDate(value)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

/** Managed calendar used by match flow. League IDs remain stable; custom
 * competition IDs come from competitionEngine and therefore survive rebuilds. */
export function createUnifiedFixtureSchedule(
  room,
  leagueSchedule = createLeagueFixtureSchedule(room),
  competitionSeason = room?.competitionSeason,
) {
  const leagueFixtures = createFixtureSchedule(room, leagueSchedule);
  const competitionFixtures = (competitionSeason?.fixtures ?? [])
    .filter((fixture) => fixture?.homeClubId && fixture?.awayClubId)
    .map((fixture) => hydrateCompetitionFixture(room, fixture))
    .filter((fixture) => fixture.managerIds.length > 0);
  return [...leagueFixtures, ...competitionFixtures].sort((left, right) => (
    scheduleTimestamp(left.scheduledAt) - scheduleTimestamp(right.scheduledAt)
    || Number(left.round ?? 0) - Number(right.round ?? 0)
    || String(left.fixtureId).localeCompare(String(right.fixtureId), "pt-BR")
  ));
}

export function createFixtureSchedule(room, fullSchedule = createLeagueFixtureSchedule(room)) {
  const managed = [];
  const managedClubKeys = new Set();
  for (const manager of room.managers) {
    const comparisonId = clubKey(manager.clubId);
    if (!comparisonId || managedClubKeys.has(comparisonId)) continue;
    managedClubKeys.add(comparisonId);
    managed.push(manager);
  }
  if (managed.length === 0) return [];

  const managedByClub = new Map(managed.map((manager) => [clubKey(manager.clubId), manager]));
  const context = catalogContext(room);
  if (context) {
    return [...fullSchedule]
      .sort((left, right) => {
        const dateDelta = (validDate(left.scheduledAt)?.getTime() ?? Number.MAX_SAFE_INTEGER)
          - (validDate(right.scheduledAt)?.getTime() ?? Number.MAX_SAFE_INTEGER);
        if (dateDelta !== 0) return dateDelta;
        if (left.round !== right.round) return left.round - right.round;
        return String(left.leagueFixtureId).localeCompare(String(right.leagueFixtureId), "pt-BR");
      })
      .map((fixture) => hydrateLeagueFixture(room, fixture))
      .filter((fixture) => fixture.managerIds.length > 0)
      .map((fixture, index) => ({ ...fixture, fixtureId: fixtureIdAt(index) }));
  }

  const aiClubIds = AI_CLUB_IDS.filter((clubId) => !managedClubKeys.has(clubKey(clubId))).slice(0, 6);
  const pairings = [];

  for (let aiRound = 0; aiRound < aiClubIds.length; aiRound += 1) {
    managed.forEach((manager, managerIndex) => {
      const aiClubId = aiClubIds[(aiRound + managerIndex) % aiClubIds.length];
      const aiAtHome = (aiRound + managerIndex) % 2 === 1;
      pairings.push(aiAtHome
        ? [aiClubId, manager.clubId]
        : [manager.clubId, aiClubId]);
    });

    // Intercala classicos humanos depois de cada manager enfrentar duas IAs.
    if (aiRound === 1) {
      for (let homeIndex = 0; homeIndex < managed.length; homeIndex += 1) {
        for (let awayIndex = homeIndex + 1; awayIndex < managed.length; awayIndex += 1) {
          pairings.push([managed[homeIndex].clubId, managed[awayIndex].clubId]);
        }
      }
    }
  }

  return pairings
    .filter(([homeClubId, awayClubId]) => !clubIdsEqual(homeClubId, awayClubId))
    .map(([homeClubId, awayClubId], index) => (
      scheduledFixture(homeClubId, awayClubId, managedByClub, index)
    ));
}

function sameManagerIds(left = [], right = []) {
  return left.length === right.length && left.every((managerId, index) => managerId === right[index]);
}

function schedulesMatch(current, expected) {
  if (!Array.isArray(current) || current.length !== expected.length) return false;
  return current.every((fixture, index) => {
    const target = expected[index];
    return fixtureIdsEqual(fixture.fixtureId, target.fixtureId)
      && (fixture.leagueFixtureId ?? null) === (target.leagueFixtureId ?? null)
      && fixture.round === target.round
      && (fixture.scheduledAt ?? null) === (target.scheduledAt ?? null)
      && fixture.competition === target.competition
      && clubKey(fixture.leagueId) === clubKey(target.leagueId)
      && clubIdsEqual(fixture.homeClubId, target.homeClubId)
      && clubIdsEqual(fixture.awayClubId, target.awayClubId)
      && !clubIdsEqual(fixture.homeClubId, fixture.awayClubId)
      && fixture.homeTeam === target.homeTeam
      && fixture.awayTeam === target.awayTeam
      && fixture.homeCode === target.homeCode
      && fixture.awayCode === target.awayCode
      && fixture.homeColor === target.homeColor
      && fixture.awayColor === target.awayColor
      && (fixture.homeDarkThemeColor ?? null) === (target.homeDarkThemeColor ?? null)
      && (fixture.homeLightThemeColor ?? null) === (target.homeLightThemeColor ?? null)
      && (fixture.awayDarkThemeColor ?? null) === (target.awayDarkThemeColor ?? null)
      && (fixture.awayLightThemeColor ?? null) === (target.awayLightThemeColor ?? null)
      && fixture.homeCrestImageUrl === target.homeCrestImageUrl
      && fixture.awayCrestImageUrl === target.awayCrestImageUrl
      && fixture.homeStadium === target.homeStadium
      && fixture.homeStadiumCapacity === target.homeStadiumCapacity
      && fixture.homeManagerId === target.homeManagerId
      && fixture.awayManagerId === target.awayManagerId
      && sameManagerIds(fixture.managerIds, target.managerIds);
  });
}

function fixturePairKey(fixture) {
  return [clubKey(fixture?.homeClubId), clubKey(fixture?.awayClubId)].sort().join("|");
}

function associatePreservedSchedule(room, fullSchedule) {
  const usedLeagueFixtures = new Set();
  const preserved = (room.fixtureSchedule ?? []).map((fixture) => {
    const leagueKey = clubKey(fixture.leagueId);
    const pairKey = fixturePairKey(fixture);
    const full = fullSchedule.find((candidate) => (
      !usedLeagueFixtures.has(candidate.leagueFixtureId)
      && fixturePairKey(candidate) === pairKey
      && (!leagueKey || clubKey(candidate.leagueId) === leagueKey)
    ));
    if (!full) return { ...fixture };
    usedLeagueFixtures.add(full.leagueFixtureId);
    const hydratedFull = hydrateLeagueFixture(room, full);
    const reversed = !clubIdsEqual(fixture.homeClubId, full.homeClubId);
    return {
      ...fixture,
      leagueFixtureId: full.leagueFixtureId,
      leagueFixtureReversed: reversed,
      leagueId: full.leagueId,
      competition: hydratedFull.competition,
      round: full.round,
      scheduledAt: full.scheduledAt ?? fixture.scheduledAt ?? null,
      homeManagerId: fixture.homeManagerId ?? (reversed ? hydratedFull.awayManagerId : hydratedFull.homeManagerId),
      awayManagerId: fixture.awayManagerId ?? (reversed ? hydratedFull.homeManagerId : hydratedFull.awayManagerId),
      managerIds: hydratedFull.managerIds,
    };
  });
  const usedFixtureIds = new Set(preserved.map((fixture) => fixtureKey(fixture.fixtureId)));
  let nextFixtureIndex = preserved.length;
  const missingManagedFixtures = createFixtureSchedule(room, fullSchedule)
    .filter((fixture) => (
      fixture.leagueFixtureId
      && !usedLeagueFixtures.has(fixture.leagueFixtureId)
    ))
    .map((fixture) => {
      let fixtureId = fixture.fixtureId;
      while (usedFixtureIds.has(fixtureKey(fixtureId))) {
        fixtureId = fixtureIdAt(nextFixtureIndex);
        nextFixtureIndex += 1;
      }
      usedFixtureIds.add(fixtureKey(fixtureId));
      return { ...fixture, fixtureId };
    });
  return [...preserved, ...missingManagedFixtures];
}

function nextUncompletedFixtureId(schedule, completedFixtureIds) {
  const completed = new Set((completedFixtureIds ?? []).map(fixtureKey));
  return schedule.find((fixture) => !completed.has(fixtureKey(fixture.fixtureId)))?.fixtureId ?? null;
}

function backfillPreservedLeagueResults(room, schedule) {
  room.leagueMatchResults ??= [];
  const existing = new Set(room.leagueMatchResults.map((result) => fixtureKey(result.leagueFixtureId)));
  for (const fixture of schedule) {
    if (!fixture.leagueFixtureId || existing.has(fixtureKey(fixture.leagueFixtureId))) continue;
    if (!(room.completedFixtureIds ?? []).some((id) => fixtureIdsEqual(id, fixture.fixtureId))) continue;
    const completed = (room.completedMatches ?? []).find((match) => (
      fixtureIdsEqual(match.fixtureId, fixture.fixtureId)
      && (match.seasonNumber ?? room.currentSeason ?? 1) === (room.currentSeason ?? 1)
    ));
    if (!completed || !Array.isArray(completed.score)) continue;
    const score = completed.score.slice(0, 2).map((value) => Math.max(0, Math.trunc(Number(value) || 0)));
    if (fixture.leagueFixtureReversed) score.reverse();
    room.leagueMatchResults.push({
      leagueFixtureId: fixture.leagueFixtureId,
      score,
      completedAt: completed.completedAt ?? null,
    });
    existing.add(fixtureKey(fixture.leagueFixtureId));
  }
}

export function ensureFixtureSchedule(room) {
  const expectedLeagueSchedule = createLeagueFixtureSchedule(room);
  const hasProgress = (room.completedFixtureIds ?? []).length > 0;
  const migrateV2 = Number(room.scheduleVersion ?? 0) < FIXTURE_SCHEDULE_VERSION
    && hasProgress
    && Array.isArray(room.fixtureSchedule)
    && room.fixtureSchedule.length > 0;
  const preserveV2 = migrateV2 || room.scheduleCompatibility === "v2-preserved";
  const expected = preserveV2
    ? associatePreservedSchedule(room, expectedLeagueSchedule)
    : createUnifiedFixtureSchedule(room, expectedLeagueSchedule, room.competitionSeason);
  const authoritativeCurrent = nextUncompletedFixtureId(expected, room.completedFixtureIds);
  const scheduleIsCurrent = room.scheduleVersion === FIXTURE_SCHEDULE_VERSION
    && schedulesMatch(room.fixtureSchedule, expected)
    && JSON.stringify(room.leagueFixtureSchedule ?? []) === JSON.stringify(expectedLeagueSchedule);
  const currentIsAuthoritative = fixtureIdsEqual(room.currentFixtureId, authoritativeCurrent);
  const readinessIsCurrent = room.matchReadiness
    && fixtureIdsEqual(room.matchReadiness.fixtureId, authoritativeCurrent)
    && Array.isArray(room.matchReadiness.managerIds)
    && room.matchReadiness.managerIds.every((managerId) => room.managerIds.includes(managerId));

  if (scheduleIsCurrent && currentIsAuthoritative && readinessIsCurrent) return false;

  room.fixtureSchedule = expected;
  room.leagueFixtureSchedule = expectedLeagueSchedule;
  room.leagueMatchResults ??= [];
  if (preserveV2) backfillPreservedLeagueResults(room, expected);
  room.lastCompletedRound ??= null;
  if (preserveV2) room.scheduleCompatibility = "v2-preserved";
  room.scheduleVersion = FIXTURE_SCHEDULE_VERSION;
  room.currentFixtureId = authoritativeCurrent;
  room.matchReadiness = { fixtureId: authoritativeCurrent, managerIds: [] };
  return true;
}

function distinctLegacyOpponent(homeClubId, candidateClubId) {
  if (candidateClubId && !clubIdsEqual(homeClubId, candidateClubId)) return candidateClubId;
  return LEGACY_FALLBACK_CLUB_IDS.find((clubId) => !clubIdsEqual(homeClubId, clubId)) || "IA";
}

function legacyFixture(room, fixtureId) {
  const canonicalFixtureId = fixtureKey(fixtureId);
  const template = LEGACY_FIXTURE_CATALOG[canonicalFixtureId];
  if (!template) return null;
  const homeClubId = managerClub(room, template.homeSlot, template.fallbackHome || "AUR");
  const awayCandidate = managerClub(room, template.awaySlot, template.fallbackAway || "SAN");
  const awayClubId = distinctLegacyOpponent(homeClubId, awayCandidate);
  const context = catalogContext(room);
  const home = teamFromClub(homeClubId, context);
  const away = teamFromClub(awayClubId, context);
  return {
    fixtureId: canonicalFixtureId,
    homeClubId,
    awayClubId,
    homeTeam: home.name,
    awayTeam: away.name,
    managerIds: room.managers
      .filter((manager) => clubIdsEqual(manager.clubId, homeClubId) || clubIdsEqual(manager.clubId, awayClubId))
      .map((manager) => manager.id),
  };
}

export function resolveServerFixture(room, requestedFixtureId) {
  const fixtureId = requestedFixtureId || room.currentFixtureId;
  if (!fixtureId) {
    const error = new Error("Nao existem fixtures pendentes nesta sala");
    error.code = "NO_PENDING_FIXTURE";
    error.status = 409;
    throw error;
  }
  if (room.completedFixtureIds?.some((completedId) => fixtureIdsEqual(completedId, fixtureId))) {
    const error = new Error("Esta fixture ja foi concluida");
    error.code = "FIXTURE_ALREADY_COMPLETED";
    error.status = 409;
    throw error;
  }
  if (room.currentFixtureId && !fixtureIdsEqual(fixtureId, room.currentFixtureId)) {
    const error = new Error("Esta fixture ainda nao e a atual");
    error.code = "FIXTURE_NOT_CURRENT";
    error.status = 409;
    throw error;
  }

  const stored = room.fixtureSchedule?.find((fixture) => fixtureIdsEqual(fixture.fixtureId, fixtureId));
  const fixture = stored || legacyFixture(room, fixtureId);
  if (!fixture) {
    const error = new Error("Fixture nao encontrado no calendario do servidor");
    error.code = "FIXTURE_NOT_FOUND";
    error.status = 404;
    throw error;
  }

  if (clubIdsEqual(fixture.homeClubId, fixture.awayClubId)) {
    const error = new Error("Fixture invalida: um clube nao pode enfrentar a si mesmo");
    error.code = "FIXTURE_SELF_MATCH";
    error.status = 409;
    throw error;
  }
  const context = catalogContext(room);
  const home = teamFromClub(fixture.homeClubId, context);
  const away = teamFromClub(fixture.awayClubId, context);
  const canonicalFixtureId = fixture.fixtureId || fixtureId;
  const storedHomeStadiumCapacity = Number(fixture.homeStadiumCapacity);
  const hasStoredHomeStadiumCapacity = fixture.homeStadiumCapacity !== null
    && fixture.homeStadiumCapacity !== undefined
    && fixture.homeStadiumCapacity !== ""
    && Number.isInteger(storedHomeStadiumCapacity)
    && storedHomeStadiumCapacity >= 0
    && storedHomeStadiumCapacity <= 500_000;
  return {
    ...fixture,
    fixtureId: canonicalFixtureId,
    homeTeam: fixture.homeTeam || home.name,
    awayTeam: fixture.awayTeam || away.name,
    homeStadium: typeof fixture.homeStadium === "string" && fixture.homeStadium.trim()
      ? fixture.homeStadium
      : home.stadium,
    homeStadiumCapacity: hasStoredHomeStadiumCapacity
      ? storedHomeStadiumCapacity
      : home.stadiumCapacity,
    homeStrength: home.strength,
    awayStrength: away.strength,
    seed: [
      room.id,
      room.currentSeason ?? 1,
      fixture.leagueId || "legacy",
      fixture.round ?? 0,
      fixture.leagueFixtureId || canonicalFixtureId,
    ].join("|"),
  };
}

export function nextFixtureId(room, fixtureId) {
  const order = room.fixtureSchedule?.length
    ? room.fixtureSchedule.map((fixture) => fixture.fixtureId)
    : FIXTURE_ORDER;
  const index = order.findIndex((candidate) => fixtureIdsEqual(candidate, fixtureId));
  return index >= 0 ? order[index + 1] ?? null : null;
}
