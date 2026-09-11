import { GlobalFixtureCalendarError } from "./globalFixtureCalendar.mjs";

const key = (value) => String(value ?? "").trim().toLocaleUpperCase("pt-BR");
const terminal = new Set(["completed", "cancelled", "canceled"]);

export function officialKickoff(fixture) {
  const value = Date.parse(fixture?.scheduledAt ?? "");
  if (!Number.isFinite(value)) throw new GlobalFixtureCalendarError(
    "Partida oficial sem data valida", "INVALID_GLOBAL_FIXTURE",
    { fixtureId: fixture?.fixtureId ?? fixture?.competitionFixtureId ?? fixture?.leagueFixtureId ?? fixture?.id },
  );
  return value;
}

export function compareOfficialFixtures(left, right) {
  return officialKickoff(left) - officialKickoff(right)
    || Number(left.round ?? left.calendarRound ?? 0) - Number(right.round ?? right.calendarRound ?? 0)
    || String(left.calendarId ?? left.fixtureId ?? left.id).localeCompare(String(right.calendarId ?? right.fixtureId ?? right.id), "pt-BR");
}

export function pendingManagedFixtures(room, excludedFixtureId = null) {
  const completed = new Set([...(room.completedFixtureIds ?? []), excludedFixtureId].filter(Boolean).map(key));
  const leagueResults = new Set((room.leagueMatchResults ?? []).map((result) => key(result.leagueFixtureId)));
  const cupResults = new Set((room.competitionSeason?.completedFixtureIds ?? []).map(key));
  return (room.fixtureSchedule ?? []).filter((fixture) => (
    !completed.has(key(fixture.fixtureId))
    && !terminal.has(fixture.status)
    && !(fixture.leagueFixtureId && leagueResults.has(key(fixture.leagueFixtureId)))
    && !(fixture.competitionFixtureId && cupResults.has(key(fixture.competitionFixtureId)))
  )).sort(compareOfficialFixtures);
}

export function pendingOfficialFixtures(room, excludedFixtureId = null) {
  const managedClubs = new Set((room.managers ?? []).map((manager) => key(manager.clubId)).filter(Boolean));
  const completed = new Set((room.completedFixtureIds ?? []).map(key));
  const managed = room.fixtureSchedule ?? [];
  const excluded = managed.find((fixture) => key(fixture.fixtureId) === key(excludedFixtureId));
  const leagueResults = new Set((room.leagueMatchResults ?? []).map((result) => key(result.leagueFixtureId)));
  const cupResults = new Set((room.competitionSeason?.completedFixtureIds ?? []).map(key));
  for (const fixture of managed) if (completed.has(key(fixture.fixtureId)) || fixture === excluded) {
    if (fixture.leagueFixtureId) leagueResults.add(key(fixture.leagueFixtureId));
    if (fixture.competitionFixtureId) cupResults.add(key(fixture.competitionFixtureId));
  }
  const league = (room.leagueFixtureSchedule ?? []).filter((fixture) => (
    !leagueResults.has(key(fixture.leagueFixtureId)) && !terminal.has(fixture.status)
  )).map((fixture) => ({ ...fixture, calendarId: `league:${fixture.leagueFixtureId}`, kind: "league" }));
  const competitions = (room.competitionSeason?.fixtures ?? []).filter((fixture) => (
    fixture.status === "scheduled" && fixture.homeClubId && fixture.awayClubId
    && !cupResults.has(key(fixture.competitionFixtureId ?? fixture.id))
  )).map((fixture) => ({ ...fixture,
    calendarId: `competition:${fixture.competitionId ?? fixture.tournamentId}:${fixture.competitionFixtureId ?? fixture.id}`,
    kind: "competition",
  }));
  const legacy = league.length || (room.leagueFixtureSchedule ?? []).length ? []
    : pendingManagedFixtures(room, excludedFixtureId).filter((fixture) => !fixture.competitionFixtureId)
      .map((fixture) => ({ ...fixture, calendarId: `managed:${fixture.fixtureId}`, kind: "managed" }));
  const entries = [...league, ...competitions, ...legacy].map((fixture) => ({
    ...fixture, managed: managedClubs.has(key(fixture.homeClubId)) || managedClubs.has(key(fixture.awayClubId)),
  }));
  for (const fixture of entries) officialKickoff(fixture);
  return entries.sort(compareOfficialFixtures);
}

export function aiFixturesBeforeNextManaged(room, { excludedFixtureId = null, through = null } = {}) {
  const pending = pendingOfficialFixtures(room, excludedFixtureId);
  const nextManaged = pending.find((fixture) => fixture.managed);
  const cutoff = nextManaged ? officialKickoff(nextManaged) : Infinity;
  const inclusive = through == null ? -Infinity : officialKickoff({ scheduledAt: through });
  return pending.filter((fixture) => !fixture.managed && (
    officialKickoff(fixture) < cutoff || (officialKickoff(fixture) === cutoff && cutoff <= inclusive)
  ));
}
