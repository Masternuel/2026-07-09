const LEGACY_FIXTURE_CATALOG = Object.freeze({
  abertura: { homeSlot: 0, awaySlot: 1, fallbackAway: "SAN" },
  "rodada-2": { homeSlot: 1, awaySlot: 0, fallbackHome: "PAL" },
  "copa-ida": { homeSlot: 0, awaySlot: 2, fallbackAway: "FLA" },
});

export const FIXTURE_ORDER = Object.freeze(Object.keys(LEGACY_FIXTURE_CATALOG));
export const FIXTURE_SCHEDULE_VERSION = 1;

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

function managerClub(room, slot, fallback) {
  return room.managers[slot]?.clubId || fallback;
}

function teamFromClub(clubId) {
  const normalized = clubId || "IA";
  const comparisonId = clubKey(normalized);
  return {
    clubId: normalized,
    name: CLUB_NAMES[comparisonId] || normalized,
    strength: 9 + (hashText(comparisonId) % 7),
  };
}

function fixtureIdAt(index) {
  return index === 0 ? "abertura" : `rodada-${index + 1}`;
}

function scheduledFixture(homeClubId, awayClubId, managedByClub, index) {
  const home = teamFromClub(homeClubId);
  const away = teamFromClub(awayClubId);
  const homeManagerId = managedByClub.get(clubKey(homeClubId))?.id ?? null;
  const awayManagerId = managedByClub.get(clubKey(awayClubId))?.id ?? null;
  return {
    fixtureId: fixtureIdAt(index),
    round: index + 1,
    competition: "Brasileirao",
    homeClubId,
    awayClubId,
    homeTeam: home.name,
    awayTeam: away.name,
    homeManagerId,
    awayManagerId,
    managerIds: [homeManagerId, awayManagerId].filter(Boolean),
  };
}

export function createFixtureSchedule(room) {
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
      && fixture.round === target.round
      && fixture.competition === target.competition
      && clubIdsEqual(fixture.homeClubId, target.homeClubId)
      && clubIdsEqual(fixture.awayClubId, target.awayClubId)
      && !clubIdsEqual(fixture.homeClubId, fixture.awayClubId)
      && fixture.homeTeam === target.homeTeam
      && fixture.awayTeam === target.awayTeam
      && fixture.homeManagerId === target.homeManagerId
      && fixture.awayManagerId === target.awayManagerId
      && sameManagerIds(fixture.managerIds, target.managerIds);
  });
}

export function ensureFixtureSchedule(room) {
  const expected = createFixtureSchedule(room);
  const completed = new Set((room.completedFixtureIds ?? []).map(fixtureKey));
  const authoritativeCurrent = expected.find((fixture) => !completed.has(fixtureKey(fixture.fixtureId)))?.fixtureId ?? null;
  const scheduleIsCurrent = room.scheduleVersion === FIXTURE_SCHEDULE_VERSION
    && schedulesMatch(room.fixtureSchedule, expected);
  const currentIsAuthoritative = fixtureIdsEqual(room.currentFixtureId, authoritativeCurrent);
  const readinessIsCurrent = room.matchReadiness
    && fixtureIdsEqual(room.matchReadiness.fixtureId, authoritativeCurrent)
    && Array.isArray(room.matchReadiness.managerIds)
    && room.matchReadiness.managerIds.every((managerId) => room.managerIds.includes(managerId));

  if (scheduleIsCurrent && currentIsAuthoritative && readinessIsCurrent) return false;

  room.fixtureSchedule = expected;
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
  const home = teamFromClub(homeClubId);
  const away = teamFromClub(awayClubId);
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
  const home = teamFromClub(fixture.homeClubId);
  const away = teamFromClub(fixture.awayClubId);
  const canonicalFixtureId = fixture.fixtureId || fixtureId;
  return {
    ...fixture,
    fixtureId: canonicalFixtureId,
    homeTeam: fixture.homeTeam || home.name,
    awayTeam: fixture.awayTeam || away.name,
    homeStrength: home.strength,
    awayStrength: away.strength,
    seed: `${room.id}|${canonicalFixtureId}|${room.revision}`,
  };
}

export function nextFixtureId(room, fixtureId) {
  const order = room.fixtureSchedule?.length
    ? room.fixtureSchedule.map((fixture) => fixture.fixtureId)
    : FIXTURE_ORDER;
  const index = order.findIndex((candidate) => fixtureIdsEqual(candidate, fixtureId));
  return index >= 0 ? order[index + 1] ?? null : null;
}
