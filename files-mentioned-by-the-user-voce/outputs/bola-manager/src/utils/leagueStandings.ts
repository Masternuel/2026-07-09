import type { ClubChoice, LeagueTeam, Room, RoomFixture, RoomLeagueFixture, RoomLeagueSnapshot, ServerLeagueMatchResult, ServerMatchFinished } from '../types';

type SeasonFixture = RoomFixture | RoomLeagueFixture;

function fixtureKey(value: string | null | undefined) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function compactCode(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

function accentFor(value: string) {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 58% 54%)`;
}

function isManagedFixture(fixture: SeasonFixture): fixture is RoomFixture {
  return 'fixtureId' in fixture;
}

function resultForFixture(matches: Array<ServerMatchFinished | ServerLeagueMatchResult>, fixture: SeasonFixture) {
  const keys = new Set([
    fixture.leagueFixtureId,
    isManagedFixture(fixture) ? fixture.fixtureId : null,
  ].map(fixtureKey).filter(Boolean));
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const matchKeys = 'leagueFixtureId' in match ? [match.leagueFixtureId] : [match.fixtureId];
    if (matchKeys.some((key) => keys.has(fixtureKey(key)))) return match;
  }
  return null;
}

function catalogClubKeys(league: RoomLeagueSnapshot) {
  return new Set(league.clubs.flatMap((club) => [club.id, club.code]).map(fixtureKey));
}

export function findRoomLeagueForClub(
  room: Room | null | undefined,
  club: Pick<ClubChoice, 'id' | 'code' | 'leagueId'>,
): RoomLeagueSnapshot | null {
  const catalog = room?.competitionCatalog ?? [];
  const leagueId = fixtureKey(club.leagueId);
  if (leagueId) {
    return catalog.find((league) => fixtureKey(league.id) === leagueId) ?? null;
  }

  const clubKeys = new Set([club.id, club.code].map(fixtureKey));
  return catalog.find((league) => (
    league.clubs.some((candidate) => clubKeys.has(fixtureKey(candidate.id)) || clubKeys.has(fixtureKey(candidate.code)))
  )) ?? null;
}

function fixturesForLeague(room: Room, leagueId: string | null | undefined, sourceFixtures: SeasonFixture[]) {
  const fixtures = sourceFixtures;
  const requestedLeagueId = fixtureKey(leagueId);
  if (!requestedLeagueId) return { fixtures, catalogLeague: null };

  const catalogLeague = room.competitionCatalog?.find((league) => fixtureKey(league.id) === requestedLeagueId) ?? null;
  if (catalogLeague) {
    const memberKeys = catalogClubKeys(catalogLeague);
    return {
      fixtures: fixtures.filter((fixture) => (
        memberKeys.has(fixtureKey(fixture.homeClubId))
        && memberKeys.has(fixtureKey(fixture.awayClubId))
      )),
      catalogLeague,
    };
  }

  const hasLeagueMetadata = fixtures.some((fixture) => Boolean(fixtureKey(fixture.leagueId)));
  return {
    fixtures: hasLeagueMetadata
      ? fixtures.filter((fixture) => fixtureKey(fixture.leagueId) === requestedLeagueId)
      : fixtures,
    catalogLeague: null,
  };
}

export function buildSeasonTable(room: Room | null | undefined, leagueId?: string | null): LeagueTeam[] {
  if (!room) return [];
  const hasLeagueResults = Array.isArray(room.leagueMatchResults);
  const sourceFixtures = hasLeagueResults
    ? (room.leagueFixtureSchedule?.length ? room.leagueFixtureSchedule : room.fixtureSchedule ?? [])
    : room.fixtureSchedule ?? [];
  const { fixtures, catalogLeague } = fixturesForLeague(room, leagueId, sourceFixtures);
  if (!fixtures.length && !catalogLeague?.clubs.length) return [];

  const completed = new Set((room.completedFixtureIds ?? []).map(fixtureKey));
  const matches: Array<ServerMatchFinished | ServerLeagueMatchResult> = hasLeagueResults
    ? room.leagueMatchResults ?? []
    : room.completedMatches ?? [];
  const teams = new Map<string, LeagueTeam>();
  const appliedResults = new Set<string>();
  const catalogClubs = new Map((catalogLeague?.clubs ?? []).flatMap((club) => (
    [club.id, club.code].map((key) => [fixtureKey(key), club] as const)
  )));

  const ensureTeam = (
    clubId: string,
    name: string,
    code?: string,
    color?: string,
    crestImageUrl?: string | null,
    darkThemeColor?: string | null,
    lightThemeColor?: string | null,
  ) => {
    const key = clubId.trim().toLocaleUpperCase('pt-BR') || compactCode(name);
    if (!teams.has(key)) {
      teams.set(key, {
        clubId,
        position: 0,
        name,
        code: code?.trim() || key.slice(0, 3),
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalDifference: 0,
        points: 0,
        form: [],
        accent: color || accentFor(key),
        darkThemeColor: darkThemeColor ?? null,
        lightThemeColor: lightThemeColor ?? null,
        crestImageUrl: crestImageUrl ?? null,
      });
    }
    const team = teams.get(key)!;
    if (code?.trim()) team.code = code.trim();
    if (color) team.accent = color;
    if (crestImageUrl !== undefined) team.crestImageUrl = crestImageUrl;
    if (darkThemeColor !== undefined) team.darkThemeColor = darkThemeColor;
    if (lightThemeColor !== undefined) team.lightThemeColor = lightThemeColor;
    return team;
  };

  for (const club of catalogLeague?.clubs ?? []) {
    ensureTeam(club.id, club.name, club.code, club.color, club.crestImageUrl, club.darkThemeColor, club.lightThemeColor);
  }

  for (const fixture of fixtures) {
    const homeCatalog = catalogClubs.get(fixtureKey(fixture.homeClubId));
    const awayCatalog = catalogClubs.get(fixtureKey(fixture.awayClubId));
    const home = ensureTeam(
      fixture.homeClubId,
      isManagedFixture(fixture) ? fixture.homeTeam : homeCatalog?.name ?? fixture.homeClubId,
      isManagedFixture(fixture) ? fixture.homeCode : homeCatalog?.code,
      isManagedFixture(fixture) ? fixture.homeColor : homeCatalog?.color,
      isManagedFixture(fixture) ? fixture.homeCrestImageUrl : homeCatalog?.crestImageUrl,
      isManagedFixture(fixture) ? fixture.homeDarkThemeColor : homeCatalog?.darkThemeColor,
      isManagedFixture(fixture) ? fixture.homeLightThemeColor : homeCatalog?.lightThemeColor,
    );
    const away = ensureTeam(
      fixture.awayClubId,
      isManagedFixture(fixture) ? fixture.awayTeam : awayCatalog?.name ?? fixture.awayClubId,
      isManagedFixture(fixture) ? fixture.awayCode : awayCatalog?.code,
      isManagedFixture(fixture) ? fixture.awayColor : awayCatalog?.color,
      isManagedFixture(fixture) ? fixture.awayCrestImageUrl : awayCatalog?.crestImageUrl,
      isManagedFixture(fixture) ? fixture.awayDarkThemeColor : awayCatalog?.darkThemeColor,
      isManagedFixture(fixture) ? fixture.awayLightThemeColor : awayCatalog?.lightThemeColor,
    );
    if (!hasLeagueResults && (!isManagedFixture(fixture) || !completed.has(fixtureKey(fixture.fixtureId)))) continue;
    const result = resultForFixture(matches, fixture);
    if (!result?.score) continue;
    const resultKey = 'leagueFixtureId' in result
      ? fixtureKey(result.leagueFixtureId)
      : fixtureKey(result.fixtureId) || fixtureKey(result.id);
    if (appliedResults.has(resultKey)) continue;
    appliedResults.add(resultKey);
    const [homeGoals, awayGoals] = result.score;
    home.played += 1;
    away.played += 1;
    home.goalDifference += homeGoals - awayGoals;
    away.goalDifference += awayGoals - homeGoals;
    if (homeGoals === awayGoals) {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
      home.form.push('E');
      away.form.push('E');
    } else if (homeGoals > awayGoals) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
      home.form.push('V');
      away.form.push('D');
    } else {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
      home.form.push('D');
      away.form.push('V');
    }
    home.form = home.form.slice(-5);
    away.form = away.form.slice(-5);
  }

  return [...teams.values()]
    .sort((left, right) => right.points - left.points
      || right.wins - left.wins
      || right.goalDifference - left.goalDifference
      || left.name.localeCompare(right.name, 'pt-BR'))
    .map((team, index) => ({ ...team, position: index + 1 }));
}
