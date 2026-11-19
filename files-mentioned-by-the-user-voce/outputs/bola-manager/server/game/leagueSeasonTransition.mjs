import {
  applyPromotionRelegation,
  createCompetitionState,
  recordCompetitionResult,
} from "./competitionEngine.mjs";
import { leagueLegs } from "./fixtures.mjs";

function key(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function inferredLevel(league, index) {
  const configured = Number(league?.level);
  if (Number.isInteger(configured) && configured > 0) return configured;
  const value = `${league?.division ?? ""} ${league?.name ?? ""}`.toLocaleUpperCase("pt-BR");
  const numeric = /(?:DIVIS(?:A|Ã)O|SERIE|SÉRIE|LEVEL|NIVEL|NÍVEL)\s*([1-9])/u.exec(value)?.[1];
  if (numeric) return Number(numeric);
  const letter = /(?:SERIE|SÉRIE|DIVIS(?:A|Ã)O)\s*([A-D])/u.exec(value)?.[1];
  if (letter) return letter.charCodeAt(0) - 64;
  if (value.includes("CHAMPIONSHIP")) return 2;
  if (value.includes("LEAGUE ONE")) return 3;
  if (value.includes("LEAGUE TWO")) return 4;
  return index + 1;
}

function score(value) {
  if (!Array.isArray(value) || value.length < 2) return [0, 0];
  return value.slice(0, 2).map((item) => Math.max(0, Math.trunc(Number(item) || 0)));
}

function fixtureKey(leagueId, round, homeClubId, awayClubId) {
  return JSON.stringify([key(leagueId), String(round), [key(homeClubId), key(awayClubId)].sort()]);
}

/**
 * Lookups for resultForFixture, built once per call instead of scanning the whole schedule
 * and result list for every fixture of every league (that grew with each played round).
 * Each map keeps the first match, like the Array.find it replaces.
 */
function leagueResultIndex(room) {
  const schedule = new Map();
  for (const candidate of room.leagueFixtureSchedule ?? []) {
    const round = Number(candidate?.round);
    if (Number.isNaN(round)) continue;
    if (key(candidate?.homeClubId) === key(candidate?.awayClubId)) continue;
    const scheduleKey = fixtureKey(candidate?.leagueId, round, candidate?.homeClubId, candidate?.awayClubId);
    if (!schedule.has(scheduleKey)) schedule.set(scheduleKey, candidate);
  }
  const results = new Map();
  for (const candidate of room.leagueMatchResults ?? []) {
    const resultKey = key(candidate?.leagueFixtureId);
    if (!results.has(resultKey)) results.set(resultKey, candidate);
  }
  return { schedule, results };
}

function resultForFixture(index, leagueId, fixture) {
  const compact = index.schedule.get(
    fixtureKey(leagueId, Number(fixture?.round), fixture?.homeClubId, fixture?.awayClubId),
  );
  if (!compact) return null;
  const stored = index.results.get(key(compact.leagueFixtureId));
  if (!stored) return null;
  const value = score(stored.score);
  return key(compact.homeClubId) === key(fixture.homeClubId) ? value : [value[1], value[0]];
}

export function buildCompletedLeagueStates(room) {
  const states = [];
  let index = null;
  for (const league of room?.competitionCatalog ?? []) {
    const participants = (league?.clubs ?? []).map((club) => ({ id: club.id, name: club.name }));
    if (!league?.id || participants.length < 2) continue;
    let state = createCompetitionState({
      id: league.id,
      name: league.name,
      format: "league",
      legs: leagueLegs(league),
      tiebreakers: ["points", "wins", "goal_difference", "goals_scored", "head_to_head"],
      teamCount: participants.length,
      participants,
    }, {
      seasonNumber: room.currentSeason,
      seasonYear: room.seasonYear,
      startDate: room.seasonStartedAt,
      roundIntervalDays: 7,
    });
    index ??= leagueResultIndex(room);
    // Only a league with every result is kept, so find the scores first and replay the table
    // only when none is missing. Replaying the played prefix of an unfinished league on every
    // match (one full state copy per result) was thrown away anyway.
    const scores = [];
    for (const fixture of state.fixtures) {
      const fixtureScore = resultForFixture(index, league.id, fixture);
      if (!fixtureScore) break;
      scores.push(fixtureScore);
    }
    if (scores.length !== state.fixtures.length) continue;
    const fixtures = state.fixtures;
    for (const [position, fixture] of fixtures.entries()) {
      state = recordCompetitionResult(state, fixture.id, { score: scores[position] });
    }
    if (state.status === "completed") states.push(state);
  }
  return states;
}

function defaultMovementSlots(teamCount) {
  return Math.max(1, Math.min(4, Math.floor(Math.max(2, teamCount) * 0.2)));
}

/** Apply movements only between loaded adjacent divisions from same country. */
export function transitionLeagueDivisions(room) {
  const catalog = structuredClone(room?.competitionCatalog ?? []);
  const states = buildCompletedLeagueStates(room);
  const statesById = new Map(states.map((state) => [key(state.id), state]));
  const movements = [];
  const countries = new Map();
  catalog.forEach((league, index) => {
    const country = key(league?.country) || "SEM-PAIS";
    if (!countries.has(country)) countries.set(country, []);
    countries.get(country).push({ ...league, level: inferredLevel(league, index) });
  });

  for (const leagues of countries.values()) {
    const divisions = leagues
      .filter((league) => statesById.has(key(league.id)) && (league.clubs ?? []).length >= 2)
      .sort((left, right) => left.level - right.level);
    if (divisions.length < 2) continue;
    for (let index = 1; index < divisions.length; index += 1) {
      if (divisions[index].level <= divisions[index - 1].level) {
        divisions[index].level = divisions[index - 1].level + 1;
      }
    }
    const divisionInput = divisions.map((league) => ({
      id: league.id,
      competitionId: league.id,
      level: league.level,
      teamIds: league.clubs.map((club) => club.id),
      promotionSlots: Number.isInteger(Number(league.promotionSlots))
        ? Number(league.promotionSlots)
        : defaultMovementSlots(league.clubs.length),
      relegationSlots: Number.isInteger(Number(league.relegationSlots))
        ? Number(league.relegationSlots)
        : defaultMovementSlots(league.clubs.length),
    }));
    const transitioned = applyPromotionRelegation({
      divisions: divisionInput,
      competitionStates: Object.fromEntries(divisions.map((league) => [league.id, statesById.get(key(league.id))])),
    });
    movements.push(...transitioned.movements);
  }

  if (movements.length === 0) return { competitionCatalog: catalog, movements };
  const destinationByClub = new Map(movements.map((movement) => [key(movement.clubId), movement.toDivisionId]));
  const clubsById = new Map(catalog.flatMap((league) => (league.clubs ?? []).map((club) => [key(club.id), club])));
  for (const league of catalog) {
    league.clubs = (league.clubs ?? []).filter((club) => !destinationByClub.has(key(club.id)));
  }
  for (const movement of movements) {
    const destination = catalog.find((league) => key(league.id) === key(movement.toDivisionId));
    const club = clubsById.get(key(movement.clubId));
    if (!destination || !club) continue;
    destination.clubs.push({ ...club, leagueId: destination.id });
    destination.clubs.sort((left, right) => String(left.name).localeCompare(String(right.name), "pt-BR"));
  }
  return { competitionCatalog: catalog, movements };
}
