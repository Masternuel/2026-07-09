import { marketValueForPlayer } from "../game/market.mjs";
import { mergePlayerStates } from "../game/playerProgression.mjs";
import {
  buildLeagueRankingTimeline,
  calculateCoachRankingPoints,
  expectedCoachPositions,
  expandCompactLeagueRankingTimeline,
  latestRankingMovement,
  rankingManagersForCompetition,
} from "../game/rankingTimeline.mjs";
import { listRoomPlayers } from "../game/roomRoster.mjs";

function identifier(value) {
  return String(value ?? "").trim();
}

function identifierKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function finiteInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(0, Math.trunc(number)))
    : fallback;
}

function nullableInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
  return Math.trunc(number);
}

function nullableNumber(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
  return number;
}

function finiteOverall(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(20, number)) : 1;
}

function publicClub(club) {
  const colors = Array.isArray(club?.colors)
    ? club.colors.filter((color) => typeof color === "string" && color.trim())
    : [];
  const color = identifier(club?.color) || colors[0] || "#c8ff3d";
  return {
    id: identifier(club?.id),
    name: identifier(club?.name) || identifier(club?.id),
    code: identifier(club?.code ?? club?.abbreviation ?? club?.id).slice(0, 8).toLocaleUpperCase("pt-BR"),
    color,
    colors: colors.length ? colors : [color],
    darkThemeColor: identifier(club?.darkThemeColor) || null,
    lightThemeColor: identifier(club?.lightThemeColor) || null,
    crestImageUrl: identifier(club?.crestImageUrl) || null,
    reputation: nullableNumber(club?.reputation, 1, 20),
    budget: nullableNumber(club?.budget),
  };
}

function activeLeagues(catalog) {
  return Array.isArray(catalog) ? catalog.filter((league) => league?.active !== false) : [];
}

function tournamentStates(room) {
  const states = room?.competitionSeason?.competitions ?? room?.competitionSeason?.states ?? [];
  return Array.isArray(states) ? states : [];
}

function tournamentScopes(room, catalog) {
  const catalogClubs = new Map();
  for (const league of activeLeagues(catalog)) {
    for (const club of Array.isArray(league?.clubs) ? league.clubs : []) {
      if (identifierKey(club?.id)) catalogClubs.set(identifierKey(club.id), club);
      if (identifierKey(club?.code)) catalogClubs.set(identifierKey(club.code), club);
    }
  }
  const definitions = new Map((Array.isArray(room?.tournamentCatalog) ? room.tournamentCatalog : [])
    .map((definition) => [identifierKey(definition?.id), definition]));
  return tournamentStates(room).flatMap((state) => {
    const id = identifier(state?.id ?? state?.competitionId);
    if (!id) return [];
    const definition = definitions.get(identifierKey(id));
    const participantRecords = new Map((Array.isArray(definition?.participants)
      ? definition.participants
      : []).map((participant) => [identifierKey(participant?.id ?? participant?.clubId), participant]));
    const participantIds = (Array.isArray(state?.participants) ? state.participants : [])
      .map((participant) => identifier(participant?.id ?? participant?.clubId ?? participant))
      .filter(Boolean);
    const fallbackIds = Array.isArray(definition?.teamIds)
      ? definition.teamIds.map(identifier).filter(Boolean)
      : [];
    const uniqueParticipantIds = new Map((participantIds.length ? participantIds : fallbackIds)
      .map((participantId) => [identifierKey(participantId), participantId]));
    const clubs = [...uniqueParticipantIds.entries()]
      .map(([key, participantId]) => (
        catalogClubs.get(key) ?? participantRecords.get(key) ?? { id: participantId, name: participantId }
      ));
    return [{
      id,
      name: identifier(state?.name ?? definition?.name) || id,
      country: identifier(definition?.country) || null,
      division: null,
      format: identifier(state?.format ?? definition?.format) || null,
      active: true,
      clubs,
      scopeType: "tournament",
      competitionState: state,
    }];
  });
}

function leagueScopes(catalog) {
  return activeLeagues(catalog).map((league) => ({ ...league, scopeType: "league" }));
}

function selectedCompetitions(room, catalog, { clubId = null, competitionId = null } = {}) {
  const leagues = leagueScopes(catalog);
  const tournaments = tournamentScopes(room, catalog);
  const requestedCompetition = identifierKey(competitionId);
  if (requestedCompetition) {
    const selected = [...leagues, ...tournaments]
      .find((competition) => identifierKey(competition?.id) === requestedCompetition);
    return selected ? [selected] : [];
  }

  const requestedClub = identifierKey(clubId);
  if (!requestedClub) return leagues;
  const selected = leagues.find((league) => (
    (league?.clubs ?? []).some((club) => (
      identifierKey(club?.id) === requestedClub || identifierKey(club?.code) === requestedClub
    ))
  ));
  if (selected) return [selected];
  return [];
}

function leagueOption(league) {
  return {
    id: identifier(league?.id),
    name: identifier(league?.name) || identifier(league?.id),
    country: identifier(league?.country) || null,
    division: identifier(league?.division) || null,
    count: Array.isArray(league?.clubs) ? league.clubs.length : null,
  };
}

function tournamentOption(tournament) {
  return {
    id: identifier(tournament?.id),
    name: identifier(tournament?.name) || identifier(tournament?.id),
    country: identifier(tournament?.country) || null,
    division: null,
    count: Array.isArray(tournament?.clubs) ? tournament.clubs.length : null,
    type: "tournament",
    format: identifier(tournament?.format) || null,
  };
}

async function roomCompetitionCatalog(room, catalogStore) {
  if (Array.isArray(room?.competitionCatalog) && room.competitionCatalog.length > 0) {
    return room.competitionCatalog;
  }
  if (typeof catalogStore?.listCompetitionCatalog !== "function") return [];
  return catalogStore.listCompetitionCatalog(room?.activeLeagues);
}

const BASIC_PLAYER_STAT_KEYS = Object.freeze([
  "goals",
  "assists",
  "appearances",
  "starts",
  "minutes",
  "yellowCards",
  "redCards",
  "injuries",
  "ratedMatches",
]);

const DECIMAL_PLAYER_STAT_KEYS = Object.freeze(["ratingTotal"]);

const ADVANCED_PLAYER_STAT_KEYS = Object.freeze([
  "shots",
  "shotsOnTarget",
  "saves",
  "goalsConceded",
  "cleanSheets",
]);

function normalizedPlayerStats(value) {
  const normalized = Object.fromEntries(BASIC_PLAYER_STAT_KEYS.map((key) => [
    key,
    finiteInteger(value?.[key]),
  ]));
  for (const key of DECIMAL_PLAYER_STAT_KEYS) {
    normalized[key] = Math.max(0, Number(value?.[key]) || 0);
  }
  for (const key of ADVANCED_PLAYER_STAT_KEYS) {
    normalized[key] = nullableInteger(value?.[key]);
  }
  return normalized;
}

function aggregatePlayerStats(entries) {
  const normalized = entries.map(normalizedPlayerStats);
  const result = Object.fromEntries(BASIC_PLAYER_STAT_KEYS.map((key) => [
    key,
    normalized.reduce((total, stats) => total + stats[key], 0),
  ]));
  for (const key of DECIMAL_PLAYER_STAT_KEYS) {
    result[key] = normalized.reduce((total, stats) => total + stats[key], 0);
  }
  for (const key of ADVANCED_PLAYER_STAT_KEYS) {
    result[key] = normalized.length > 0 && normalized.every((stats) => stats[key] !== null)
      ? normalized.reduce((total, stats) => total + stats[key], 0)
      : null;
  }
  return result;
}

function emptyPlayerStats() {
  return {
    ...Object.fromEntries(BASIC_PLAYER_STAT_KEYS.map((key) => [key, 0])),
    ...Object.fromEntries(DECIMAL_PLAYER_STAT_KEYS.map((key) => [key, 0])),
    ...Object.fromEntries(ADVANCED_PLAYER_STAT_KEYS.map((key) => [key, null])),
  };
}

function scopedCompetitionStats(player, competitionIds, seasonNumber) {
  const wanted = new Set(competitionIds.map(identifierKey).filter(Boolean));
  if (wanted.size === 0) return [];
  return (Array.isArray(player?.competitionStats) ? player.competitionStats : []).filter((entry) => (
    finiteInteger(entry?.seasonNumber, seasonNumber) === seasonNumber
      && wanted.has(identifierKey(entry?.competitionId))
  ));
}

function completedCompetitionIds(room) {
  const completed = new Set();
  const leagueByFixture = new Map((room?.leagueFixtureSchedule ?? []).map((fixture) => [
    identifierKey(fixture?.leagueFixtureId),
    identifierKey(fixture?.leagueId),
  ]));
  for (const result of room?.leagueMatchResults ?? []) {
    const competitionId = leagueByFixture.get(identifierKey(result?.leagueFixtureId));
    if (competitionId) completed.add(competitionId);
  }
  const competitionStates = room?.competitionSeason?.competitions
    ?? room?.competitionSeason?.states
    ?? [];
  for (const state of competitionStates) {
    if (!(state?.fixtures ?? []).some((fixture) => (
      fixture?.status === "completed" || fixture?.result || fixture?.completedAt
    ))) continue;
    const competitionId = identifierKey(state?.id ?? state?.competitionId);
    if (competitionId) completed.add(competitionId);
  }
  return completed;
}

function playerStatsContext(room, leagues, fixtures, results, rosterEntries) {
  const competitionIds = leagues.map((league) => identifier(league?.id)).filter(Boolean);
  const competitionKeys = new Set(competitionIds.map(identifierKey));
  const seasonNumber = Math.max(1, finiteInteger(room?.currentSeason, 1));
  const completedInScope = fixtures.some((fixture) => results.has(identifierKey(fixture?.leagueFixtureId)));
  const coverageEntries = (Array.isArray(room?.playerCompetitionStatsCoverage)
    ? room.playerCompetitionStatsCoverage
    : []).filter((entry) => (
    finiteInteger(entry?.seasonNumber, seasonNumber) === seasonNumber
      && competitionKeys.has(identifierKey(entry?.competitionId))
  ));
  const hasScopedRecords = rosterEntries.some(({ players }) => players.some((player) => (
    scopedCompetitionStats(player, competitionIds, seasonNumber).length > 0
  )));
  const completedIds = completedCompetitionIds(room);
  const safeLegacySeason = competitionIds.length === 1
    && completedIds.size <= 1
    && (completedIds.size === 0 || completedIds.has(identifierKey(competitionIds[0])));
  const scope = !completedInScope || coverageEntries.length > 0 || hasScopedRecords
    ? "competition"
    : safeLegacySeason
      ? "season-legacy"
      : "unavailable";
  const trackedMatches = coverageEntries.reduce(
    (total, entry) => total + finiteInteger(entry?.trackedMatches),
    0,
  );
  const untrackedMatches = coverageEntries.reduce(
    (total, entry) => total + finiteInteger(entry?.untrackedMatches),
    0,
  );
  const complete = scope === "competition"
    ? coverageEntries.length === 0
      ? !completedInScope || hasScopedRecords
      : coverageEntries.length === competitionIds.length
        && coverageEntries.every((entry) => entry?.complete === true && finiteInteger(entry?.untrackedMatches) === 0)
    : scope === "season-legacy";
  const metricCoverage = Object.fromEntries(ADVANCED_PLAYER_STAT_KEYS.map((key) => [
    key,
    coverageEntries.length > 0 && coverageEntries.every((entry) => entry?.metrics?.[key] === true),
  ]));
  return {
    competitionIds,
    seasonNumber,
    scope,
    complete,
    trackedMatches,
    untrackedMatches,
    metricCoverage,
  };
}

function statsForPlayer(player, context) {
  if (context.scope === "season-legacy") return normalizedPlayerStats(player?.seasonStats);
  if (context.scope === "unavailable") return emptyPlayerStats();
  const scoped = scopedCompetitionStats(player, context.competitionIds, context.seasonNumber);
  return scoped.length > 0 ? aggregatePlayerStats(scoped) : emptyPlayerStats();
}

function wageForPlayer(player) {
  return nullableNumber(player?.contract?.wage ?? player?.wage);
}

function publicPlayerAttributes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const attributes = Object.fromEntries(Object.entries(value).flatMap(([name, rawValue]) => {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? [[name, Math.max(0, Math.min(20, parsed))]] : [];
  }));
  return Object.keys(attributes).length > 0 ? attributes : null;
}

function publicPlayerContract(player) {
  const contract = player?.contract;
  const wage = wageForPlayer(player);
  if ((!contract || typeof contract !== "object" || Array.isArray(contract)) && wage === null) return null;
  return {
    startSeason: nullableInteger(contract?.startSeason, 1),
    endSeason: nullableInteger(contract?.endSeason, 1),
    wage,
    status: identifier(contract?.status) || null,
  };
}

function publicPlayer(player, club, statsContext) {
  const seasonStats = statsForPlayer(player, statsContext);
  const overall = finiteOverall(player?.overall);
  const shirtNumber = nullableInteger(player?.shirtNumber ?? player?.number, 0, 99);
  const marketValue = marketValueForPlayer(player);
  const goalContributions = seasonStats.goals + seasonStats.assists;
  return {
    id: identifier(player?.id),
    name: identifier(player?.name) || "Jogador",
    clubId: club.id,
    clubName: club.name,
    clubCode: club.code,
    clubCrestImageUrl: club.crestImageUrl,
    shirtNumber,
    number: shirtNumber,
    position: identifier(player?.position).toLocaleUpperCase("pt-BR") || "MC",
    age: nullableInteger(player?.age, 14, 60),
    nationality: identifier(player?.nationality) || null,
    isStar: player?.isStar === true,
    avatarImageUrl: identifier(player?.avatarImageUrl) || null,
    marketValue,
    wage: wageForPlayer(player),
    condition: nullableNumber(player?.condition, 0, 100),
    morale: identifier(player?.morale) || null,
    potential: nullableNumber(player?.potential, 1, 20),
    status: identifier(player?.status) || null,
    negotiability: identifier(player?.negotiability) || null,
    loanAvailable: typeof player?.loanAvailable === "boolean" ? player.loanAvailable : null,
    attributes: publicPlayerAttributes(player?.attributes),
    contract: publicPlayerContract(player),
    statisticsAvailable: statsContext.scope !== "unavailable",
    statisticsComplete: statsContext.complete,
    statisticsScope: statsContext.scope,
    seasonStats,
    goals: seasonStats.goals,
    assists: seasonStats.assists,
    appearances: seasonStats.appearances,
    starts: seasonStats.starts,
    minutes: seasonStats.minutes,
    yellowCards: seasonStats.yellowCards,
    redCards: seasonStats.redCards,
    injuries: seasonStats.injuries,
    goalContributions,
    goalsPerGame: seasonStats.appearances > 0
      ? Number((seasonStats.goals / seasonStats.appearances).toFixed(3))
      : null,
    minutesPerGoal: seasonStats.goals > 0 ? Math.round(seasonStats.minutes / seasonStats.goals) : null,
    minutesPerAssist: seasonStats.assists > 0 ? Math.round(seasonStats.minutes / seasonStats.assists) : null,
    minutesPerContribution: goalContributions > 0 ? Math.round(seasonStats.minutes / goalContributions) : null,
    contributionsPerGame: seasonStats.appearances > 0
      ? Number((goalContributions / seasonStats.appearances).toFixed(3))
      : null,
    clubGoalParticipationPercent: null,
    overall,
    // Compatibility: the old ranking called the positional overall "rating".
    rating: overall,
    averageRating: seasonStats.ratedMatches > 0
      ? Number((seasonStats.ratingTotal / seasonStats.ratedMatches).toFixed(2))
      : null,
    penaltyGoals: null,
    nonPenaltyGoals: null,
    ownGoals: null,
    keyPasses: null,
    bigChancesCreated: null,
    tackles: null,
    saves: seasonStats.saves,
    goalsConceded: seasonStats.goalsConceded,
    cleanSheets: seasonStats.cleanSheets,
    shots: seasonStats.shots,
    shotsOnTarget: seasonStats.shotsOnTarget,
    previousRank: null,
    rankChange: null,
  };
}

function playerChangedClubThisSeason(room, playerId) {
  const transactions = Array.isArray(room?.marketState?.transactions)
    ? room.marketState.transactions
    : [];
  const seasonStartedAt = Date.parse(room?.seasonStartedAt ?? "");
  return transactions.some((transaction) => {
    if (identifierKey(transaction?.player?.id ?? transaction?.playerId) !== identifierKey(playerId)) return false;
    if (!Number.isFinite(seasonStartedAt)) return true;
    const completedAt = Date.parse(transaction?.completedAt ?? "");
    return !Number.isFinite(completedAt) || completedAt >= seasonStartedAt;
  });
}

function comparePlayers(left, right) {
  return right.goals - left.goals
    || right.assists - left.assists
    || right.appearances - left.appearances
    || right.overall - left.overall
    || left.name.localeCompare(right.name, "pt-BR");
}

function resultMap(room, competitions = []) {
  const results = new Map();
  const setResult = (keyValue, value, completedAtValue = null) => {
    const key = identifierKey(keyValue);
    const score = Array.isArray(value?.score) ? value.score : [];
    const homeGoals = Number(score[0]);
    const awayGoals = Number(score[1]);
    if (!key || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return;
    const possessionSource = Array.isArray(value?.possession)
      ? value.possession
      : [value?.statistics?.home?.possession, value?.statistics?.away?.possession];
    const possession = possessionSource.slice(0, 2).map(Number);
    const hasPossession = possession.length === 2
      && possession.every((item) => Number.isFinite(item) && item >= 0 && item <= 100);
    results.set(key, {
      score: [Math.max(0, Math.trunc(homeGoals)), Math.max(0, Math.trunc(awayGoals))],
      completedAt: identifier(completedAtValue ?? value?.completedAt) || null,
      possession: hasPossession ? possession : null,
    });
  };
  for (const result of Array.isArray(room?.leagueMatchResults) ? room.leagueMatchResults : []) {
    setResult(result?.leagueFixtureId, result, result?.completedAt);
  }
  for (const competition of competitions) {
    if (competition?.scopeType !== "tournament") continue;
    for (const fixture of Array.isArray(competition?.competitionState?.fixtures)
      ? competition.competitionState.fixtures
      : []) {
      if (fixture?.status !== "completed" && !fixture?.result) continue;
      setResult(
        fixture?.competitionFixtureId ?? fixture?.id,
        fixture?.result,
        fixture?.completedAt,
      );
    }
  }
  return results;
}

function clubKeysForLeagues(leagues) {
  return new Set(leagues.flatMap((league) => (
    (league?.clubs ?? []).flatMap((club) => [club?.id, club?.code])
  )).map(identifierKey).filter(Boolean));
}

function leagueFixturesForScope(room, leagues) {
  const fixtures = Array.isArray(room?.leagueFixtureSchedule) ? room.leagueFixtureSchedule : [];
  if (!leagues.length) return [];
  const leagueKeys = new Set(leagues.map((league) => identifierKey(league?.id)).filter(Boolean));
  const clubKeys = clubKeysForLeagues(leagues);
  return fixtures.filter((fixture) => {
    const leagueKey = identifierKey(fixture?.leagueId);
    if (leagueKey) return leagueKeys.has(leagueKey);
    return clubKeys.has(identifierKey(fixture?.homeClubId))
      && clubKeys.has(identifierKey(fixture?.awayClubId));
  });
}

function competitionFixturesForScope(room, competitions) {
  const leagues = competitions.filter((competition) => competition?.scopeType !== "tournament");
  const leagueFixtures = leagueFixturesForScope(room, leagues);
  const tournamentFixtures = competitions.flatMap((competition) => {
    if (competition?.scopeType !== "tournament") return [];
    return (Array.isArray(competition?.competitionState?.fixtures)
      ? competition.competitionState.fixtures
      : []).flatMap((fixture) => {
      const fixtureId = identifier(fixture?.competitionFixtureId ?? fixture?.id);
      if (!fixtureId) return [];
      return [{
        ...fixture,
        leagueFixtureId: fixtureId,
        leagueId: identifier(competition?.id),
        competitionId: identifier(competition?.id),
        stageRound: nullableInteger(fixture?.round, 1),
        round: nullableInteger(fixture?.calendarRound, 1)
          ?? nullableInteger(fixture?.round, 1)
          ?? 0,
      }];
    });
  });
  return [...leagueFixtures, ...tournamentFixtures];
}

function compareFixtures(left, right) {
  return finiteInteger(left?.round) - finiteInteger(right?.round)
    || identifier(left?.scheduledAt).localeCompare(identifier(right?.scheduledAt))
    || identifier(left?.leagueFixtureId).localeCompare(identifier(right?.leagueFixtureId));
}

function campaignForClub(clubId, fixtures, results) {
  const club = identifierKey(clubId);
  const campaign = {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    recentForm: [],
    averagePossession: null,
    possessionPercent: null,
  };
  if (!club) return campaign;

  const applied = new Set();
  let possessionTotal = 0;
  let possessionMatches = 0;
  for (const fixture of [...fixtures].sort(compareFixtures)) {
    const fixtureKey = identifierKey(fixture?.leagueFixtureId);
    const result = results.get(fixtureKey);
    if (!fixtureKey || !result || applied.has(fixtureKey)) continue;
    const isHome = identifierKey(fixture?.homeClubId) === club;
    const isAway = identifierKey(fixture?.awayClubId) === club;
    if (!isHome && !isAway) continue;
    applied.add(fixtureKey);
    const scored = result.score[isHome ? 0 : 1];
    const conceded = result.score[isHome ? 1 : 0];
    campaign.played += 1;
    campaign.goalsFor += scored;
    campaign.goalsAgainst += conceded;
    const possession = result.possession?.[isHome ? 0 : 1];
    if (Number.isFinite(possession)) {
      possessionTotal += possession;
      possessionMatches += 1;
    }
    if (scored > conceded) {
      campaign.wins += 1;
      campaign.points += 3;
      campaign.recentForm.push("V");
    } else if (scored === conceded) {
      campaign.draws += 1;
      campaign.points += 1;
      campaign.recentForm.push("E");
    } else {
      campaign.losses += 1;
      campaign.recentForm.push("D");
    }
  }
  campaign.goalDifference = campaign.goalsFor - campaign.goalsAgainst;
  campaign.recentForm = campaign.recentForm.slice(-5);
  if (possessionMatches > 0) {
    campaign.averagePossession = Number((possessionTotal / possessionMatches).toFixed(2));
    campaign.possessionPercent = campaign.averagePossession;
  }
  return campaign;
}

function compareCampaigns(left, right) {
  return right.points - left.points
    || right.wins - left.wins
    || right.goalDifference - left.goalDifference
    || right.goalsFor - left.goalsFor
    || left.name.localeCompare(right.name, "pt-BR");
}

function currentStreak(recentForm) {
  const last = recentForm.at(-1);
  if (!last) return null;
  let count = 0;
  for (let index = recentForm.length - 1; index >= 0 && recentForm[index] === last; index -= 1) count += 1;
  return `${last}${count}`;
}

function compareManagers(left, right) {
  return (right.rankingPoints ?? -1) - (left.rankingPoints ?? -1)
    || right.points - left.points
    || right.wins - left.wins
    || right.goalDifference - left.goalDifference
    || left.name.localeCompare(right.name, "pt-BR");
}

function preferredFormation(room, managerId) {
  const lineup = (Array.isArray(room?.lineups) ? room.lineups : [])
    .find((candidate) => identifier(candidate?.managerId) === identifier(managerId));
  return identifier(lineup?.tactics?.formationId) || null;
}

function mostUsedFormation(room, managerId) {
  const managerKey = identifierKey(managerId);
  const usage = new Map();
  (Array.isArray(room?.completedMatches) ? room.completedMatches : []).forEach((match, index) => {
    const formation = identifierKey(match?.homeManagerId) === managerKey
      ? identifier(match?.homeFormation)
      : identifierKey(match?.awayManagerId) === managerKey
        ? identifier(match?.awayFormation)
        : null;
    if (!formation) return;
    const previous = usage.get(formation) ?? { count: 0, lastIndex: -1 };
    usage.set(formation, { count: previous.count + 1, lastIndex: index });
  });
  return [...usage.entries()].sort((left, right) => (
    right[1].count - left[1].count
      || right[1].lastIndex - left[1].lastIndex
      || left[0].localeCompare(right[0], "pt-BR")
  ))[0]?.[0] ?? null;
}

function publicCoachCareer(room, managerId) {
  const state = (Array.isArray(room?.coachCareerState?.coaches)
    ? room.coachCareerState.coaches
    : []).find((coach) => identifier(coach?.id) === identifier(managerId));
  if (!state) return null;
  return {
    nationality: identifier(state?.nationality) || null,
    avatarImageUrl: identifier(state?.avatarImageUrl) || null,
    preferredFormation: identifier(state?.preferredFormation) || null,
    style: identifier(state?.style) || null,
    reputation: nullableNumber(state?.reputation, 0, 100),
    status: ["employed", "unemployed", "dismissed"].includes(state?.status)
      ? state.status
      : state?.currentClubId ? "employed" : "unemployed",
    currentClubId: identifier(state?.currentClubId) || null,
    assignments: (Array.isArray(state?.assignments) ? state.assignments : []).flatMap((assignment) => {
      const clubId = identifier(assignment?.clubId);
      if (!clubId) return [];
      const metrics = assignment?.metrics && typeof assignment.metrics === "object"
        ? assignment.metrics
        : assignment;
      return [{
        id: identifier(assignment?.id) || null,
        clubId,
        role: identifier(assignment?.role) || "head_coach",
        startedSeason: nullableInteger(assignment?.startedSeason, 1),
        startedRound: nullableInteger(assignment?.startedRound, 1),
        endedSeason: nullableInteger(assignment?.endedSeason, 1),
        endedRound: nullableInteger(assignment?.endedRound, 0),
        startedAt: identifier(assignment?.startedAt) || null,
        endedAt: identifier(assignment?.endedAt) || null,
        entryReason: identifier(assignment?.entryReason) || null,
        exitReason: identifier(assignment?.exitReason) || null,
        country: identifier(assignment?.country) || null,
        division: identifier(assignment?.division) || null,
        durationDays: nullableInteger(assignment?.durationDays, 0),
        matches: nullableInteger(metrics?.matches, 0),
        wins: nullableInteger(metrics?.wins, 0),
        draws: nullableInteger(metrics?.draws, 0),
        losses: nullableInteger(metrics?.losses, 0),
        points: nullableInteger(metrics?.points, 0),
        goalsFor: nullableInteger(metrics?.goalsFor, 0),
        goalsAgainst: nullableInteger(metrics?.goalsAgainst, 0),
        pointsPerGame: nullableNumber(metrics?.pointsPerGame, 0, 3),
        winRate: nullableNumber(metrics?.winRate, 0, 100),
        longestWinningStreak: nullableInteger(metrics?.longestWinningStreak, 0),
        longestWinlessStreak: nullableInteger(metrics?.longestWinlessStreak, 0),
        promotions: nullableInteger(assignment?.promotions, 0),
        relegations: nullableInteger(assignment?.relegations, 0),
        reputationStart: nullableNumber(assignment?.reputationStart, 0, 100),
        reputationEnd: nullableNumber(assignment?.reputationEnd, 0, 100),
      }];
    }),
  };
}

function historicalManagerCandidatesForScope(room, timeline, competitionIds) {
  const scopedCompetitionIds = new Set(
    [...(competitionIds ?? [])].map(identifierKey).filter(Boolean),
  );
  if (scopedCompetitionIds.size === 0) return [];

  const latestEntryByManager = new Map();
  for (const entry of Array.isArray(timeline) ? timeline : []) {
    const managerId = identifier(entry?.managerId ?? entry?.entityId);
    if (
      entry?.type !== "manager"
      || !managerId
      || !scopedCompetitionIds.has(identifierKey(entry?.competitionId))
    ) continue;
    latestEntryByManager.set(identifierKey(managerId), entry);
  }

  const liveManagers = new Map((Array.isArray(room?.managers) ? room.managers : [])
    .flatMap((manager) => {
      const managerId = identifier(manager?.id);
      return managerId ? [[identifierKey(managerId), manager]] : [];
    }));
  const persistedCoaches = new Map((Array.isArray(room?.coachCareerState?.coaches)
    ? room.coachCareerState.coaches
    : []).flatMap((coach) => {
      const coachId = identifier(coach?.id);
      return coachId ? [[identifierKey(coachId), coach]] : [];
    }));

  return [...latestEntryByManager.entries()].map(([managerKey, entry]) => {
    const persisted = persistedCoaches.get(managerKey) ?? {};
    const live = liveManagers.get(managerKey) ?? {};
    const id = identifier(live?.id ?? persisted?.id ?? entry?.managerId ?? entry?.entityId);
    const inferredAI = identifierKey(id).startsWith("AI-COACH:");
    const managerType = persisted?.managerType === "ai"
      ? "ai"
      : persisted?.managerType === "human" || live?.id
        ? "human"
        : inferredAI ? "ai" : "human";
    return {
      ...persisted,
      ...live,
      id,
      name: identifier(live?.name ?? persisted?.name ?? entry?.label) || "Manager",
      clubId: identifier(live?.clubId ?? persisted?.currentClubId) || null,
      managerType,
      isHuman: managerType === "human",
      isAI: managerType === "ai",
      status: identifier(live?.status ?? persisted?.status)
        || (live?.clubId ?? persisted?.currentClubId ? "employed" : "unemployed"),
    };
  });
}

function managerTimelineEntries(timeline, managerId) {
  return (Array.isArray(timeline) ? timeline : []).filter((entry) => (
    entry?.type === "manager" && identifierKey(entry?.managerId ?? entry?.entityId) === identifierKey(managerId)
  ));
}

function finalTimelineRows(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = [
      finiteInteger(entry?.seasonNumber, 1),
      identifierKey(entry?.competitionId),
      identifierKey(entry?.clubId),
      nullableInteger(entry?.tenureStartedSeason, 1) ?? 1,
      nullableInteger(entry?.tenureStartedRound, 1) ?? 1,
    ].join("\u0000");
    const previous = grouped.get(key);
    if (!previous || finiteInteger(entry?.round) >= finiteInteger(previous?.round)) grouped.set(key, entry);
  }
  return [...grouped.values()];
}

function managerResultsForClub(clubId, fixtures, results, clubsById) {
  const clubKey = identifierKey(clubId);
  return [...fixtures].sort(compareFixtures).flatMap((fixture) => {
    const result = results.get(identifierKey(fixture?.leagueFixtureId));
    const home = identifierKey(fixture?.homeClubId);
    const away = identifierKey(fixture?.awayClubId);
    if (!result || (home !== clubKey && away !== clubKey)) return [];
    const isHome = home === clubKey;
    const goalsFor = result.score[isHome ? 0 : 1];
    const goalsAgainst = result.score[isHome ? 1 : 0];
    const opponentId = identifier(isHome ? fixture?.awayClubId : fixture?.homeClubId);
    const opponent = clubsById.get(identifierKey(opponentId));
    return [{
      fixtureId: identifier(fixture?.leagueFixtureId),
      competitionId: identifier(fixture?.leagueId ?? fixture?.competitionId) || null,
      clubId: identifier(clubId) || null,
      round: nullableInteger(fixture?.round, 1),
      completedAt: result.completedAt,
      venue: isHome ? "home" : "away",
      opponentId,
      opponentName: opponent?.name ?? opponentId,
      goalsFor,
      goalsAgainst,
      result: goalsFor > goalsAgainst ? "V" : goalsFor === goalsAgainst ? "E" : "D",
    }];
  });
}

function completedMatchHistoryForManager(room, managerId, clubsById) {
  const managerKey = identifierKey(managerId);
  const archivedMatches = (Array.isArray(room?.seasonHistory) ? room.seasonHistory : [])
    .flatMap((season) => (Array.isArray(season?.managerMatchHistory)
      ? season.managerMatchHistory
      : []).map((match) => ({
      ...match,
      seasonNumber: finiteInteger(season?.seasonNumber, 1),
      seasonYear: nullableInteger(season?.seasonYear, 1900, 9999),
    })));
  const currentMatches = Array.isArray(room?.completedMatches) ? room.completedMatches : [];
  return [...archivedMatches, ...currentMatches].flatMap((match) => {
    const homeManagerId = identifier(match?.homeManagerId);
    const awayManagerId = identifier(match?.awayManagerId);
    const isHome = identifierKey(homeManagerId) === managerKey;
    const isAway = identifierKey(awayManagerId) === managerKey;
    const score = Array.isArray(match?.score) ? match.score.map((value) => finiteInteger(value)) : [];
    if ((!isHome && !isAway) || score.length < 2) return [];
    const clubId = identifier(isHome ? match?.homeClubId : match?.awayClubId);
    const opponentId = identifier(isHome ? match?.awayClubId : match?.homeClubId);
    const opponent = clubsById.get(identifierKey(opponentId));
    const goalsFor = score[isHome ? 0 : 1];
    const goalsAgainst = score[isHome ? 1 : 0];
    return [{
      fixtureId: identifier(match?.fixtureId ?? match?.id),
      competitionId: identifier(match?.competitionId ?? match?.leagueId) || null,
      clubId: clubId || null,
      clubName: identifier(isHome ? match?.homeClubName : match?.awayClubName)
        || clubsById.get(identifierKey(clubId))?.name
        || clubId
        || null,
      seasonNumber: nullableInteger(match?.seasonNumber, 1),
      seasonYear: nullableInteger(match?.seasonYear, 1900, 9999),
      round: nullableInteger(match?.round, 1),
      completedAt: identifier(match?.completedAt) || null,
      venue: isHome ? "home" : "away",
      opponentId: opponentId || null,
      opponentName: opponent?.name ?? opponentId ?? null,
      managerId: identifier(managerId),
      opponentManagerId: identifier(isHome ? awayManagerId : homeManagerId) || null,
      goalsFor,
      goalsAgainst,
      result: goalsFor > goalsAgainst ? "V" : goalsFor === goalsAgainst ? "E" : "D",
    }];
  });
}

function rankingTrophies(entries, currentSeason, currentCompetitionIds, completedCompetitionIds) {
  return finalTimelineRows(entries).flatMap((entry) => {
    const isCurrent = finiteInteger(entry?.seasonNumber, 1) === currentSeason;
    const competitionKey = identifierKey(entry?.competitionId);
    const completed = !isCurrent || (
      currentCompetitionIds.has(competitionKey) && completedCompetitionIds.has(competitionKey)
    );
    if (!completed || finiteInteger(entry?.titles) < 1) return [];
    return [{
      id: `league:${entry.seasonNumber}:${entry.competitionId}`,
      name: identifier(entry?.competitionName) || identifier(entry?.competitionId),
      title: identifier(entry?.competitionName) || identifier(entry?.competitionId),
      label: identifier(entry?.competitionName) || identifier(entry?.competitionId),
      seasonNumber: finiteInteger(entry?.seasonNumber, 1),
      seasonYear: nullableInteger(entry?.seasonYear, 1900, 9999),
      competitionId: identifier(entry?.competitionId),
      competitionName: identifier(entry?.competitionName) || identifier(entry?.competitionId),
      clubId: identifier(entry?.clubId) || null,
      type: "league",
    }];
  });
}

function assignmentAtSeasonEnd(career, clubId, seasonNumber) {
  if (!career || !clubId) return null;
  return [...(career.assignments ?? [])]
    .filter((assignment) => (
      identifierKey(assignment?.clubId) === identifierKey(clubId)
        && (assignment?.startedSeason ?? 1) <= seasonNumber
        && (assignment?.endedSeason === null || assignment.endedSeason >= seasonNumber)
    ))
    .sort((left, right) => (
      (right?.startedSeason ?? 1) - (left?.startedSeason ?? 1)
        || (right?.startedRound ?? 1) - (left?.startedRound ?? 1)
    ))[0] ?? null;
}

function assignmentAtRound(career, clubId, seasonNumber, round) {
  if (!career || !clubId) return null;
  const targetRound = Math.max(1, finiteInteger(round, 1));
  return [...(career.assignments ?? [])]
    .filter((assignment) => {
      if (identifierKey(assignment?.clubId) !== identifierKey(clubId)) return false;
      const startedSeason = finiteInteger(assignment?.startedSeason, 1);
      const endedSeason = assignment?.endedSeason === null || assignment?.endedSeason === undefined
        ? null
        : finiteInteger(assignment.endedSeason, startedSeason);
      if (seasonNumber < startedSeason || (endedSeason !== null && seasonNumber > endedSeason)) return false;
      if (seasonNumber === startedSeason && targetRound < Math.max(1, finiteInteger(assignment?.startedRound, 1))) {
        return false;
      }
      const endedRound = nullableInteger(assignment?.endedRound, 0);
      return !(endedSeason === seasonNumber && endedRound !== null && targetRound > endedRound);
    })
    .sort((left, right) => (
      finiteInteger(right?.startedSeason, 1) - finiteInteger(left?.startedSeason, 1)
        || finiteInteger(right?.startedRound, 1) - finiteInteger(left?.startedRound, 1)
    ))[0] ?? null;
}

function coachIdAtSeasonEnd(room, clubId, seasonNumber) {
  return (Array.isArray(room?.coachCareerState?.coaches) ? room.coachCareerState.coaches : [])
    .flatMap((coach) => (Array.isArray(coach?.assignments) ? coach.assignments : []).flatMap((assignment) => (
      identifierKey(assignment?.clubId) === identifierKey(clubId)
        && finiteInteger(assignment?.startedSeason, 1) <= seasonNumber
        && (assignment?.endedSeason === null || assignment?.endedSeason === undefined
          || finiteInteger(assignment.endedSeason, seasonNumber) >= seasonNumber)
        ? [{ coachId: identifier(coach?.id), assignment }]
        : []
    )))
    .sort((left, right) => (
      finiteInteger(right.assignment?.startedSeason, 1) - finiteInteger(left.assignment?.startedSeason, 1)
        || finiteInteger(right.assignment?.startedRound, 1) - finiteInteger(left.assignment?.startedRound, 1)
    ))[0]?.coachId ?? null;
}

function coachIdAtRound(room, clubId, seasonNumber, round) {
  const targetRound = Math.max(1, finiteInteger(round, 1));
  return (Array.isArray(room?.coachCareerState?.coaches) ? room.coachCareerState.coaches : [])
    .flatMap((coach) => {
      const assignments = Array.isArray(coach?.assignments) ? coach.assignments : [];
      return assignments.flatMap((assignment) => {
      if (identifierKey(assignment?.clubId) !== identifierKey(clubId)) return [];
      const startedSeason = finiteInteger(assignment?.startedSeason, 1);
      const endedSeason = assignment?.endedSeason === null || assignment?.endedSeason === undefined
        ? null
        : finiteInteger(assignment.endedSeason, startedSeason);
      if (seasonNumber < startedSeason || (endedSeason !== null && seasonNumber > endedSeason)) return [];
      if (seasonNumber === startedSeason && targetRound < Math.max(1, finiteInteger(assignment?.startedRound, 1))) {
        return [];
      }
      const endedRound = nullableInteger(assignment?.endedRound, 0);
      if (endedSeason === seasonNumber && endedRound !== null && targetRound > endedRound) return [];
      return [{ coachId: identifier(coach?.id), assignment }];
      });
    })
    .sort((left, right) => (
      finiteInteger(right.assignment?.startedSeason, 1) - finiteInteger(left.assignment?.startedSeason, 1)
        || finiteInteger(right.assignment?.startedRound, 1) - finiteInteger(left.assignment?.startedRound, 1)
    ))[0]?.coachId ?? null;
}

function tournamentWinnerContext(room, winner, seasonNumber) {
  const tournamentId = identifier(winner?.tournamentId ?? winner?.competitionId);
  const clubId = identifier(winner?.clubId);
  const competition = tournamentStates(room).find((candidate) => (
    identifierKey(candidate?.id ?? candidate?.competitionId) === identifierKey(tournamentId)
  ));
  const decisiveFixture = (Array.isArray(competition?.fixtures) ? competition.fixtures : [])
    .filter((fixture) => (
      fixture?.status === "completed"
        && (identifierKey(fixture?.homeClubId) === identifierKey(clubId)
          || identifierKey(fixture?.awayClubId) === identifierKey(clubId))
    ))
    .sort((left, right) => (
      finiteInteger(left?.calendarRound ?? left?.round) - finiteInteger(right?.calendarRound ?? right?.round)
        || identifier(left?.completedAt ?? left?.scheduledAt)
          .localeCompare(identifier(right?.completedAt ?? right?.scheduledAt))
        || finiteInteger(left?.matchNumber) - finiteInteger(right?.matchNumber)
    ))
    .at(-1) ?? null;
  const wonRound = nullableInteger(
    winner?.wonRound ?? decisiveFixture?.calendarRound ?? decisiveFixture?.round,
    1,
  );
  return {
    managerId: identifier(winner?.managerId ?? winner?.coachId)
      || (wonRound === null ? null : coachIdAtRound(room, clubId, seasonNumber, wonRound))
      || coachIdAtSeasonEnd(room, clubId, seasonNumber),
    wonRound,
    completedAt: identifier(winner?.wonAt ?? winner?.completedAt
      ?? decisiveFixture?.completedAt ?? decisiveFixture?.scheduledAt) || null,
  };
}

function rankingTournamentTrophies(room, manager, career, currentSeason) {
  const tournamentNames = new Map([
    ...(Array.isArray(room?.tournamentCatalog) ? room.tournamentCatalog : []),
    ...(Array.isArray(room?.competitionSeason?.competitions) ? room.competitionSeason.competitions : []),
  ].flatMap((competition) => {
    const id = identifier(competition?.id ?? competition?.tournamentId);
    return id ? [[identifierKey(id), identifier(competition?.name) || id]] : [];
  }));
  const archived = (Array.isArray(room?.seasonHistory) ? room.seasonHistory : []).flatMap((season) => (
    (Array.isArray(season?.tournamentWinners) ? season.tournamentWinners : []).map((winner) => ({
      ...winner,
      seasonNumber: finiteInteger(season?.seasonNumber, 1),
      seasonYear: nullableInteger(season?.seasonYear, 1900, 9999),
      completedAt: identifier(season?.completedAt) || null,
    }))
  ));
  const current = (Array.isArray(room?.competitionSeason?.winners) ? room.competitionSeason.winners : [])
    .map((winner) => {
      const context = tournamentWinnerContext(room, winner, currentSeason);
      return {
        ...winner,
        managerId: context.managerId,
        wonRound: context.wonRound,
        seasonNumber: currentSeason,
        seasonYear: nullableInteger(room?.seasonYear, 1900, 9999),
        completedAt: context.completedAt,
      };
    });
  const unique = new Map([...archived, ...current].flatMap((winner) => {
    const tournamentId = identifier(winner?.tournamentId ?? winner?.competitionId);
    const clubId = identifier(winner?.clubId);
    const seasonNumber = finiteInteger(winner?.seasonNumber, 1);
    return tournamentId && clubId
      ? [[`${seasonNumber}:${identifierKey(tournamentId)}`, { ...winner, tournamentId, clubId, seasonNumber }]]
      : [];
  }));
  return [...unique.values()].flatMap((winner) => {
    const recordedCoachId = identifier(winner?.managerId ?? winner?.coachId)
      || (winner?.wonRound === null || winner?.wonRound === undefined
        ? null
        : coachIdAtRound(room, winner.clubId, winner.seasonNumber, winner.wonRound))
      || coachIdAtSeasonEnd(room, winner.clubId, winner.seasonNumber);
    const assignment = assignmentAtSeasonEnd(career, winner.clubId, winner.seasonNumber);
    const belongsToManager = recordedCoachId
      ? identifierKey(recordedCoachId) === identifierKey(manager?.id)
      : assignment
        ? true
      : !career
        && winner.seasonNumber === currentSeason
        && identifierKey(manager?.clubId) === identifierKey(winner.clubId);
    if (!belongsToManager) return [];
    const name = tournamentNames.get(identifierKey(winner.tournamentId)) ?? winner.tournamentId;
    return [{
      id: `tournament:${winner.seasonNumber}:${winner.tournamentId}`,
      name,
      title: name,
      label: name,
      seasonNumber: winner.seasonNumber,
      seasonYear: winner.seasonYear ?? null,
      competitionId: winner.tournamentId,
      competitionName: name,
      clubId: winner.clubId,
      clubName: identifier(winner?.clubName) || null,
      type: "tournament",
      wonRound: nullableInteger(winner?.wonRound, 1),
      completedAt: winner.completedAt ?? null,
    }];
  });
}

function rankingAwards(room, managerId) {
  return [
    ...(Array.isArray(room?.managerAwards) ? room.managerAwards : []),
    ...(Array.isArray(room?.coachCareerState?.awards) ? room.coachCareerState.awards : []),
  ].flatMap((award, index) => {
    if (identifierKey(award?.managerId ?? award?.coachId) !== identifierKey(managerId)) return [];
    return [{
      id: identifier(award?.id) || `award-${index + 1}`,
      name: identifier(award?.name ?? award?.title) || "Premiação de treinador",
      seasonNumber: nullableInteger(award?.seasonNumber ?? award?.season, 1),
      competitionId: identifier(award?.competitionId) || null,
      awardedAt: identifier(award?.awardedAt ?? award?.createdAt) || null,
    }];
  });
}

function upsetWinsForClub(clubId, recentResults, clubMetrics) {
  const own = clubMetrics.get(identifierKey(clubId));
  if (!own) return 0;
  return recentResults.reduce((total, result) => {
    if (result.result !== "V") return total;
    const opponent = clubMetrics.get(identifierKey(result.opponentId));
    if (!opponent) return total;
    if (own.reputation === null || opponent.reputation === null) return total;
    return total + (opponent.reputation > own.reputation ? 1 : 0);
  }, 0);
}

function rankingScore({ campaign, trophies, expectedPosition, actualPosition, upsetWins, competitionStrength }) {
  return calculateCoachRankingPoints({
    campaign: { ...campaign, upsetWins },
    expectedPosition,
    actualPosition,
    titles: trophies.length,
    competitionStrength,
  });
}

function emptyManagerCampaign() {
  return {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    recentForm: [],
    averagePossession: null,
    possessionPercent: null,
  };
}

function campaignFromTimeline(entry) {
  if (!entry) return emptyManagerCampaign();
  return {
    played: finiteInteger(entry.played),
    wins: finiteInteger(entry.wins),
    draws: finiteInteger(entry.draws),
    losses: finiteInteger(entry.losses),
    goalsFor: finiteInteger(entry.goalsFor),
    goalsAgainst: finiteInteger(entry.goalsAgainst),
    goalDifference: Number(entry.goalDifference) || 0,
    points: finiteInteger(entry.points),
    recentForm: Array.isArray(entry.recentForm) ? entry.recentForm.slice(-5) : [],
    averagePossession: null,
    possessionPercent: null,
  };
}

function campaignFromManagerResults(values) {
  const campaign = emptyManagerCampaign();
  for (const result of Array.isArray(values) ? values : []) {
    campaign.played += 1;
    campaign.goalsFor += finiteInteger(result?.goalsFor);
    campaign.goalsAgainst += finiteInteger(result?.goalsAgainst);
    if (result?.result === "V") {
      campaign.wins += 1;
      campaign.points += 3;
    } else if (result?.result === "E") {
      campaign.draws += 1;
      campaign.points += 1;
    } else {
      campaign.losses += 1;
    }
    campaign.recentForm.push(result?.result === "V" ? "V" : result?.result === "E" ? "E" : "D");
  }
  campaign.goalDifference = campaign.goalsFor - campaign.goalsAgainst;
  campaign.recentForm = campaign.recentForm.slice(-5);
  return campaign;
}

function assignmentForEntry(career, entry) {
  if (!career || !entry) return null;
  return (career.assignments ?? []).find((assignment) => (
    identifierKey(assignment.clubId) === identifierKey(entry.clubId)
      && (assignment.startedSeason ?? 1) === (entry.tenureStartedSeason ?? entry.seasonNumber ?? 1)
      && (assignment.startedRound ?? 1) === (entry.tenureStartedRound ?? 1)
  )) ?? null;
}

function activeAssignment(career, clubId, seasonNumber) {
  if (!career || !clubId) return null;
  return [...(career.assignments ?? [])].reverse().find((assignment) => (
    identifierKey(assignment.clubId) === identifierKey(clubId)
      && (assignment.startedSeason ?? 1) <= seasonNumber
      && (assignment.endedSeason === null || assignment.endedSeason >= seasonNumber)
      && assignment.endedAt === null
  )) ?? null;
}

function resultsWithinAssignment(results, assignment, seasonNumber) {
  if (!assignment) return results;
  if (seasonNumber < (assignment.startedSeason ?? 1)) return [];
  if (assignment.endedSeason !== null && seasonNumber > assignment.endedSeason) return [];
  const fromRound = seasonNumber === (assignment.startedSeason ?? 1) ? assignment.startedRound ?? 1 : 1;
  const throughRound = assignment.endedSeason === seasonNumber && assignment.endedRound !== null
    ? assignment.endedRound
    : Number.MAX_SAFE_INTEGER;
  return results.filter((result) => {
    const round = nullableInteger(result?.round, 1);
    return round !== null && round >= fromRound && round <= throughRound;
  });
}

function tournamentCompetitionNames(room) {
  return new Map([
    ...(Array.isArray(room?.tournamentCatalog) ? room.tournamentCatalog : []),
    ...tournamentStates(room),
  ].flatMap((competition) => {
    const id = identifier(competition?.id ?? competition?.tournamentId ?? competition?.competitionId);
    return id ? [[identifierKey(id), identifier(competition?.name) || id]] : [];
  }));
}

function tournamentCompetitionIds(room) {
  const ids = new Set(tournamentCompetitionNames(room).keys());
  for (const season of Array.isArray(room?.seasonHistory) ? room.seasonHistory : []) {
    for (const winner of Array.isArray(season?.tournamentWinners) ? season.tournamentWinners : []) {
      const id = identifier(winner?.tournamentId ?? winner?.competitionId);
      if (id) ids.add(identifierKey(id));
    }
  }
  return ids;
}

function managerTournamentSeasonStats({
  room,
  career,
  matchHistory,
  trophies,
  clubsById,
  rankingContext,
  score,
  actualPosition,
}) {
  const tournamentIds = tournamentCompetitionIds(room);
  const names = tournamentCompetitionNames(room);
  for (const trophy of trophies) {
    if (trophy?.type === "tournament") {
      tournamentIds.add(identifierKey(trophy?.competitionId));
      names.set(identifierKey(trophy?.competitionId), identifier(trophy?.competitionName) || identifier(trophy?.competitionId));
    }
  }
  const rows = new Map();
  const rowFor = ({ seasonNumber, seasonYear, competitionId, clubId, clubName, round }) => {
    const assignment = assignmentAtRound(career, clubId, seasonNumber, round);
    const tenureStartedSeason = nullableInteger(assignment?.startedSeason, 1) ?? seasonNumber;
    const tenureStartedRound = nullableInteger(assignment?.startedRound, 1) ?? 1;
    const key = [seasonNumber, identifierKey(competitionId), identifierKey(clubId), tenureStartedSeason, tenureStartedRound].join(":");
    if (!rows.has(key)) {
      rows.set(key, {
        seasonNumber,
        seasonYear,
        competitionId,
        competitionName: names.get(identifierKey(competitionId)) ?? competitionId,
        clubId: identifier(clubId) || null,
        clubName: identifier(clubName)
          || clubsById.get(identifierKey(clubId))?.name
          || identifier(clubId)
          || null,
        round: 0,
        tenureStartedSeason,
        tenureStartedRound,
        position: null,
        campaignPosition: null,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
        rankingPoints: null,
        titles: 0,
      });
    }
    return rows.get(key);
  };

  for (const result of matchHistory) {
    const competitionId = identifier(result?.competitionId);
    if (!competitionId || !tournamentIds.has(identifierKey(competitionId))) continue;
    const seasonNumber = finiteInteger(result?.seasonNumber, rankingContext.currentSeason);
    const round = Math.max(1, finiteInteger(result?.round, 1));
    const row = rowFor({
      seasonNumber,
      seasonYear: nullableInteger(result?.seasonYear, 1900, 9999),
      competitionId,
      clubId: result?.clubId,
      clubName: result?.clubName,
      round,
    });
    row.round = Math.max(row.round, round);
    row.played += 1;
    row.goalsFor += finiteInteger(result?.goalsFor);
    row.goalsAgainst += finiteInteger(result?.goalsAgainst);
    if (result?.result === "V") {
      row.wins += 1;
      row.points += 3;
    } else if (result?.result === "E") {
      row.draws += 1;
      row.points += 1;
    } else {
      row.losses += 1;
    }
  }

  for (const trophy of trophies.filter((candidate) => candidate?.type === "tournament")) {
    const row = rowFor({
      seasonNumber: finiteInteger(trophy?.seasonNumber, 1),
      seasonYear: nullableInteger(trophy?.seasonYear, 1900, 9999),
      competitionId: identifier(trophy?.competitionId),
      clubId: trophy?.clubId,
      clubName: trophy?.clubName,
      round: trophy?.wonRound ?? 1,
    });
    row.titles = Math.max(1, row.titles);
  }

  for (const row of rows.values()) {
    const isCurrentScope = row.seasonNumber === rankingContext.currentSeason
      && identifierKey(row.competitionId) === identifierKey(rankingContext.currentCompetitionId);
    if (isCurrentScope) {
      row.rankingPoints = score.total;
      row.campaignPosition = actualPosition;
    }
  }
  return [...rows.values()];
}

function coachForClubAtRound(managers, clubId, seasonNumber, round) {
  const clubKey = identifierKey(clubId);
  return (managers ?? []).find((manager) => {
    const assignments = Array.isArray(manager?.assignments) ? manager.assignments : [];
    if (assignments.length === 0) return identifierKey(manager?.clubId) === clubKey;
    return assignments.some((assignment) => {
      if (identifierKey(assignment?.clubId) !== clubKey) return false;
      const startedSeason = finiteInteger(assignment?.startedSeason, 1);
      const endedSeason = assignment?.endedSeason === null || assignment?.endedSeason === undefined
        ? null
        : finiteInteger(assignment.endedSeason, startedSeason);
      if (seasonNumber < startedSeason || (endedSeason !== null && seasonNumber > endedSeason)) return false;
      if (seasonNumber === startedSeason && round < Math.max(1, finiteInteger(assignment?.startedRound, 1))) return false;
      const endedRound = nullableInteger(assignment?.endedRound, 0);
      return !(endedSeason === seasonNumber && endedRound !== null && round > endedRound);
    });
  }) ?? null;
}

function publicManager(room, manager, clubsById, fixtures, results, viewerId, rankingContext) {
  const club = clubsById.get(identifierKey(manager?.clubId)) ?? null;
  const career = publicCoachCareer(room, manager?.id);
  const trajectory = managerTimelineEntries(rankingContext.timeline, manager?.id);
  const latest = trajectory.at(-1) ?? null;
  const latestCurrent = [...trajectory].reverse().find((entry) => (
    finiteInteger(entry?.seasonNumber, 1) === rankingContext.currentSeason
      && rankingContext.currentCompetitionIds.has(identifierKey(entry?.competitionId))
  )) ?? null;
  const currentAssignment = activeAssignment(career, club?.id, rankingContext.currentSeason);
  const latestCurrentTenure = !career
    ? latestCurrent
    : club && currentAssignment
      ? [...trajectory].reverse().find((entry) => (
        finiteInteger(entry?.seasonNumber, 1) === rankingContext.currentSeason
          && rankingContext.currentCompetitionIds.has(identifierKey(entry?.competitionId))
          && identifierKey(entry?.clubId) === identifierKey(club.id)
          && (entry?.tenureStartedSeason ?? entry?.seasonNumber ?? 1) === currentAssignment.startedSeason
          && (entry?.tenureStartedRound ?? 1) === currentAssignment.startedRound
      )) ?? null
      : !club ? latestCurrent : null;
  const campaignEntry = latestCurrentTenure;
  const trophies = [...new Map([
    ...rankingTrophies(
      trajectory,
      rankingContext.currentSeason,
      rankingContext.currentCompetitionIds,
      rankingContext.completedCompetitionIds,
    ),
    ...rankingTournamentTrophies(room, manager, career, rankingContext.currentSeason),
  ].map((trophy) => [trophy.id, trophy])).values()];
  const currentSeasonTrophies = trophies.filter((trophy) => (
    finiteInteger(trophy?.seasonNumber, 1) === rankingContext.currentSeason
  ));
  const currentScopeTrophies = currentSeasonTrophies.filter((trophy) => (
    rankingContext.currentCompetitionIds.has(identifierKey(trophy?.competitionId))
  ));
  const currentScopeTrophy = currentScopeTrophies[0] ?? null;
  const rankingClubId = club?.id ?? campaignEntry?.clubId ?? manager?.clubId ?? currentScopeTrophy?.clubId;
  const resultAssignment = currentAssignment
    ?? assignmentForEntry(career, campaignEntry)
    ?? assignmentAtRound(
      career,
      currentScopeTrophy?.clubId,
      rankingContext.currentSeason,
      currentScopeTrophy?.wonRound ?? 1,
    );
  const allResults = resultsWithinAssignment(
    managerResultsForClub(rankingClubId, fixtures, results, clubsById),
    resultAssignment,
    rankingContext.currentSeason,
  ).map((result) => ({
    ...result,
    managerId: identifier(manager?.id),
    opponentManagerId: identifier(coachForClubAtRound(
      rankingContext.managerCandidates,
      result.opponentId,
      rankingContext.currentSeason,
      result.round,
    )?.id) || null,
  }));
  const recentResults = allResults.slice(-5).reverse();
  const preservedMatches = completedMatchHistoryForManager(room, manager?.id, clubsById);
  const matchHistory = [...new Map([
    ...preservedMatches,
    ...allResults.map((result) => ({
      ...result,
      seasonNumber: rankingContext.currentSeason,
      seasonYear: nullableInteger(room?.seasonYear, 1900, 9999),
    })),
  ].map((result) => {
    const seasonNumber = finiteInteger(result?.seasonNumber, rankingContext.currentSeason);
    const fixtureId = identifierKey(result?.fixtureId);
    return [`${seasonNumber}:${fixtureId || identifier(result?.completedAt)}`, result];
  })).values()]
    .sort((left, right) => (
      finiteInteger(right?.seasonNumber, 1) - finiteInteger(left?.seasonNumber, 1)
        || finiteInteger(right?.round) - finiteInteger(left?.round)
        || identifier(right?.completedAt).localeCompare(identifier(left?.completedAt))
    ));
  const campaign = campaignEntry
    ? campaignFromTimeline(campaignEntry)
    : rankingContext.usesManagerTimeline
      ? emptyManagerCampaign()
      : campaignFromManagerResults(allResults);
  const expectedPosition = rankingContext.expectedPositions.get(identifierKey(rankingClubId))
    ?? rankingContext.clubCount;
  const actualPosition = nullableInteger(campaignEntry?.campaignPosition, 1)
    ?? rankingContext.actualPositions.get(identifierKey(rankingClubId))
    ?? rankingContext.clubCount;
  const upsetWins = upsetWinsForClub(rankingClubId, allResults, rankingContext.clubMetrics);
  const calculatedScore = rankingScore({
    campaign,
    trophies: currentScopeTrophies,
    expectedPosition,
    actualPosition,
    upsetWins,
    competitionStrength: rankingContext.competitionStrength,
  });
  const score = calculatedScore;
  const managerType = manager?.managerType === "ai" ? "ai" : "human";
  const preferred = mostUsedFormation(room, manager?.id)
    || identifier(manager?.preferredFormation)
    || career?.preferredFormation
    || (managerType === "human" ? preferredFormation(room, manager?.id) : null);
  const seasonStats = finalTimelineRows(trajectory).map((entry) => ({
    seasonNumber: finiteInteger(entry?.seasonNumber, 1),
    seasonYear: nullableInteger(entry?.seasonYear, 1900, 9999),
    competitionId: identifier(entry?.competitionId),
    competitionName: identifier(entry?.competitionName) || identifier(entry?.competitionId),
    clubId: identifier(entry?.clubId) || null,
    clubName: identifier(entry?.clubName)
      || clubsById.get(identifierKey(entry?.clubId))?.name
      || identifier(entry?.clubId)
      || null,
    round: finiteInteger(entry?.round),
    tenureStartedSeason: nullableInteger(entry?.tenureStartedSeason, 1),
    tenureStartedRound: nullableInteger(entry?.tenureStartedRound, 1),
    position: nullableInteger(entry?.position, 1),
    campaignPosition: nullableInteger(entry?.campaignPosition, 1),
    played: finiteInteger(entry?.played),
    wins: finiteInteger(entry?.wins),
    draws: finiteInteger(entry?.draws),
    losses: finiteInteger(entry?.losses),
    goalsFor: finiteInteger(entry?.goalsFor),
    goalsAgainst: finiteInteger(entry?.goalsAgainst),
    points: finiteInteger(entry?.points),
    rankingPoints: nullableNumber(entry?.rankingPoints),
    titles: trophies.some((trophy) => (
      trophy.seasonNumber === finiteInteger(entry?.seasonNumber, 1)
        && identifierKey(trophy.competitionId) === identifierKey(entry?.competitionId)
    )) ? 1 : 0,
  }));
  const tournamentStats = managerTournamentSeasonStats({
    room,
    career,
    matchHistory,
    trophies,
    clubsById,
    rankingContext,
    score,
    actualPosition,
  });
  for (const tournamentStat of tournamentStats) {
    const duplicate = seasonStats.some((entry) => (
      entry.seasonNumber === tournamentStat.seasonNumber
        && identifierKey(entry.competitionId) === identifierKey(tournamentStat.competitionId)
        && identifierKey(entry.clubId) === identifierKey(tournamentStat.clubId)
        && (entry.tenureStartedSeason ?? entry.seasonNumber) === tournamentStat.tenureStartedSeason
        && (entry.tenureStartedRound ?? 1) === tournamentStat.tenureStartedRound
    ));
    if (!duplicate) seasonStats.push(tournamentStat);
  }
  const careerHistory = (career?.assignments ?? []).map((assignment) => {
    const related = seasonStats.filter((stats) => (
      identifierKey(stats.clubId) === identifierKey(assignment.clubId)
        && (stats.tenureStartedSeason ?? stats.seasonNumber) === assignment.startedSeason
        && (stats.tenureStartedRound ?? 1) === assignment.startedRound
    ));
    const firstSeason = related.find((stats) => stats.seasonNumber === assignment.startedSeason) ?? related[0];
    const assignmentMetrics = assignment?.metrics && typeof assignment.metrics === "object"
      ? assignment.metrics
      : assignment;
    const sum = (field) => related.reduce((total, stats) => total + finiteInteger(stats?.[field]), 0);
    return {
      ...assignment,
      seasonNumber: assignment.startedSeason,
      clubName: firstSeason?.clubName
        ?? clubsById.get(identifierKey(assignment.clubId))?.name
        ?? null,
      status: assignment.endedSeason === null ? "employed" : "unemployed",
      played: related.length ? sum("played") : finiteInteger(assignmentMetrics?.matches),
      wins: related.length ? sum("wins") : finiteInteger(assignmentMetrics?.wins),
      draws: related.length ? sum("draws") : finiteInteger(assignmentMetrics?.draws),
      losses: related.length ? sum("losses") : finiteInteger(assignmentMetrics?.losses),
      goalsFor: related.length ? sum("goalsFor") : finiteInteger(assignmentMetrics?.goalsFor),
      goalsAgainst: related.length ? sum("goalsAgainst") : finiteInteger(assignmentMetrics?.goalsAgainst),
      points: related.length ? sum("points") : finiteInteger(assignmentMetrics?.points),
      titles: related.length
        ? sum("titles")
        : Array.isArray(assignment?.titles)
          ? assignment.titles.length
          : finiteInteger(assignment?.titles),
      rankingPoints: related.at(-1)?.rankingPoints ?? null,
    };
  });
  return {
    id: identifier(manager?.id),
    name: identifier(manager?.name) || "Manager",
    managerType,
    isHuman: managerType === "human",
    isAI: managerType === "ai",
    status: identifier(manager?.status ?? career?.status) || "employed",
    nationality: identifier(manager?.nationality ?? career?.nationality) || null,
    style: identifier(manager?.style ?? career?.style) || null,
    avatarImageUrl: identifier(manager?.avatarImageUrl ?? manager?.photoUrl ?? career?.avatarImageUrl) || null,
    clubId: club?.id ?? null,
    clubName: club?.name ?? null,
    clubCode: club?.code ?? null,
    clubColor: club?.color ?? null,
    clubDarkThemeColor: club?.darkThemeColor ?? null,
    clubLightThemeColor: club?.lightThemeColor ?? null,
    clubCrestImageUrl: club?.crestImageUrl ?? null,
    isOwner: identifier(manager?.id) === identifier(room?.ownerId),
    isViewer: identifier(manager?.id) === identifier(viewerId),
    ...campaign,
    performancePercent: campaign.played > 0
      ? Math.round((campaign.points / (campaign.played * 3)) * 100)
      : 0,
    currentStreak: currentStreak(campaign.recentForm),
    preferredFormation: preferred,
    reputation: nullableNumber(manager?.reputation ?? career?.reputation, 0, 100),
    titles: currentScopeTrophies.length,
    rankingPoints: score.total,
    rankingBreakdown: score.components,
    rankingMethodVersion: 1,
    expectedPosition,
    campaignPosition: actualPosition,
    upsetWins,
    recentResults,
    matchHistory,
    rankingTrajectory: trajectory.map((entry) => ({
      seasonNumber: finiteInteger(entry?.seasonNumber, 1),
      seasonYear: nullableInteger(entry?.seasonYear, 1900, 9999),
      competitionId: identifier(entry?.competitionId),
      competitionName: identifier(entry?.competitionName) || identifier(entry?.competitionId),
      round: finiteInteger(entry?.round),
      clubId: identifier(entry?.clubId) || null,
      position: nullableInteger(entry?.position, 1),
      previousPosition: nullableInteger(entry?.previousPosition, 1),
      positionChange: Number.isFinite(Number(entry?.positionChange)) ? Number(entry.positionChange) : null,
      rankingPoints: nullableNumber(entry?.rankingPoints),
      campaignPosition: nullableInteger(entry?.campaignPosition, 1),
      tenureStartedSeason: nullableInteger(entry?.tenureStartedSeason, 1),
      tenureStartedRound: nullableInteger(entry?.tenureStartedRound, 1),
    })),
    careerHistory,
    seasonStats,
    trophyHistory: trophies,
    awards: rankingAwards(room, manager?.id),
    historyComplete: Boolean(career && seasonStats.length > 0),
    rankChange: latest?.positionChange ?? null,
    previousPosition: latest?.previousPosition ?? null,
    positionChange: latest?.positionChange ?? null,
  };
}

function completedRoundForScope(fixtures, results) {
  const rounds = new Map();
  for (const fixture of fixtures) {
    const round = nullableInteger(fixture?.round, 1);
    if (round === null) continue;
    const values = rounds.get(round) ?? [];
    values.push(fixture);
    rounds.set(round, values);
  }
  return [...rounds.entries()].reduce((largest, [round, roundFixtures]) => (
    roundFixtures.length > 0
      && roundFixtures.every((fixture) => results.has(identifierKey(fixture?.leagueFixtureId)))
      ? Math.max(largest, round)
      : largest
  ), 0);
}

function scopeStatus(room, fixtures, results) {
  if (!fixtures.length) return room?.careerCompleted ? "completed" : "not_started";
  const completed = fixtures.filter((fixture) => results.has(identifierKey(fixture?.leagueFixtureId))).length;
  if (completed === 0) return "not_started";
  if (completed === fixtures.length) return "completed";
  return "active";
}

function sanitizedWinner(value) {
  const tournamentId = identifier(value?.tournamentId);
  const clubId = identifier(value?.clubId);
  return tournamentId && clubId ? { tournamentId, clubId } : null;
}

function sanitizedMovement(value) {
  const clubId = identifier(value?.clubId);
  const type = value?.type === "promotion" ? "promotion" : value?.type === "relegation" ? "relegation" : null;
  if (!clubId || !type) return null;
  return {
    clubId,
    type,
    fromDivisionId: identifier(value?.fromDivisionId) || null,
    toDivisionId: identifier(value?.toDivisionId) || null,
    position: nullableInteger(value?.position, 1),
  };
}

function publicSeasonHistory(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    seasonNumber: nullableInteger(value.seasonNumber ?? value.season, 1),
    seasonYear: nullableInteger(value.seasonYear, 1900, 9999),
    startedAt: identifier(value.startedAt) || null,
    completedAt: identifier(value.completedAt) || null,
    completedFixtureCount: Array.isArray(value.completedFixtureIds)
      ? value.completedFixtureIds.length
      : nullableInteger(value.completedFixtureCount, 0),
    matchCount: Array.isArray(value.matchIds)
      ? value.matchIds.length
      : nullableInteger(value.matchCount, 0),
    tournamentWinners: (Array.isArray(value.tournamentWinners) ? value.tournamentWinners : [])
      .map(sanitizedWinner)
      .filter(Boolean),
    promotionMovements: (Array.isArray(value.promotionMovements) ? value.promotionMovements : [])
      .map(sanitizedMovement)
      .filter(Boolean),
  };
}

/**
 * Build rankings exclusively from the room save and its owner's catalog.
 * Missing advanced metrics stay null; this service never fabricates statistics.
 */
export async function buildRoomRankings({
  room,
  catalogStore,
  clubId = null,
  competitionId = null,
  viewerId = null,
}) {
  if (!room || typeof room !== "object") throw new TypeError("Sala indisponivel para rankings");
  if (!catalogStore || typeof catalogStore.listPlayers !== "function") {
    const error = new Error("Catalogo da sala indisponivel para rankings");
    error.code = "ROOM_RANKINGS_CATALOG_UNAVAILABLE";
    error.status = 503;
    throw error;
  }

  const catalog = await roomCompetitionCatalog(room, catalogStore);
  const availableTournaments = tournamentScopes(room, catalog);
  const options = [...new Map([
    ...activeLeagues(catalog).map(leagueOption),
    ...availableTournaments.map(tournamentOption),
  ].filter((competition) => competition.id).map((competition) => [
    identifierKey(competition.id),
    competition,
  ])).values()];
  const leagues = selectedCompetitions(room, catalog, { clubId, competitionId });
  const fixtures = competitionFixturesForScope(room, leagues);
  const results = resultMap(room, leagues);
  const clubsById = new Map();
  for (const league of catalog) {
    for (const candidate of Array.isArray(league?.clubs) ? league.clubs : []) {
      const club = publicClub(candidate);
      if (club.id) clubsById.set(identifierKey(club.id), club);
      if (club.code) clubsById.set(identifierKey(club.code), club);
    }
  }
  for (const competition of leagues) {
    for (const candidate of Array.isArray(competition?.clubs) ? competition.clubs : []) {
      const club = publicClub(candidate);
      if (club.id) clubsById.set(identifierKey(club.id), club);
      if (club.code) clubsById.set(identifierKey(club.code), club);
    }
  }

  const scopedClubs = [];
  const seenClubs = new Set();
  for (const league of leagues) {
    for (const candidate of Array.isArray(league?.clubs) ? league.clubs : []) {
      const club = publicClub(candidate);
      const key = identifierKey(club.id);
      if (!key || seenClubs.has(key)) continue;
      seenClubs.add(key);
      scopedClubs.push({
        ...club,
        leagueId: identifier(league?.id) || null,
        leagueName: identifier(league?.name) || null,
        country: identifier(candidate?.country ?? league?.country) || null,
        division: identifier(candidate?.division ?? league?.division) || null,
      });
    }
  }

  const rosterEntries = await Promise.all(scopedClubs.map(async (club) => {
    const roster = await listRoomPlayers(catalogStore, room, club.id);
    const players = mergePlayerStates(roster.players ?? [], room, club.id);
    return { club, players };
  }));
  const rosterMetricsByClub = new Map();
  for (const { club, players } of rosterEntries) {
    const squadValue = players.reduce((total, player) => total + marketValueForPlayer(player), 0);
    const knownOveralls = players
      .map((player) => nullableNumber(player?.overall, 1, 20))
      .filter((value) => value !== null)
      .sort((left, right) => right - left)
      .slice(0, 18);
    const metrics = {
      squadValue,
      squadStrength: knownOveralls.length
        ? knownOveralls.reduce((total, overall) => total + overall, 0) / knownOveralls.length
        : null,
    };
    rosterMetricsByClub.set(identifierKey(club.id), metrics);
    if (club.code) rosterMetricsByClub.set(identifierKey(club.code), metrics);
  }
  const statsContext = playerStatsContext(room, leagues, fixtures, results, rosterEntries);
  const timelineLeagues = leagues
    .filter((competition) => competition?.scopeType !== "tournament")
    .map((competition) => ({
      ...competition,
      clubs: (Array.isArray(competition?.clubs) ? competition.clubs : []).map((club) => {
        const metrics = rosterMetricsByClub.get(identifierKey(club?.id))
          ?? rosterMetricsByClub.get(identifierKey(club?.code));
        return metrics ? {
          ...club,
          rankingSquadStrength: metrics.squadStrength,
          rankingSquadValue: metrics.squadValue,
        } : club;
      }),
    }));
  const currentTimeline = buildLeagueRankingTimeline({
    leagues: timelineLeagues,
    fixtures: leagueFixturesForScope(room, timelineLeagues),
    results: room.leagueMatchResults,
    managers: room.managers,
    coachCareerState: room.coachCareerState,
    seasonNumber: room.currentSeason,
    seasonYear: room.seasonYear,
  });
  const archivedTimeline = (Array.isArray(room.seasonHistory) ? room.seasonHistory : [])
    .flatMap((season) => expandCompactLeagueRankingTimeline(season?.rankingTimeline));
  const timeline = [...new Map([...archivedTimeline, ...currentTimeline].map((entry) => [entry.id, entry])).values()];

  const clubRows = rosterEntries.map(({ club, players }) => {
    const rosterMetrics = rosterMetricsByClub.get(identifierKey(club.id));
    const squadValue = rosterMetrics?.squadValue ?? 0;
    const wages = players.map(wageForPlayer);
    const payroll = players.length > 0 && wages.every((wage) => wage !== null)
      ? wages.reduce((total, wage) => total + wage, 0)
      : null;
    const campaign = campaignForClub(club.id, fixtures, results);
    return {
      ...club,
      squadValue,
      squadStrength: rosterMetrics?.squadStrength ?? null,
      playerCount: players.length,
      averageValue: players.length ? Math.round(squadValue / players.length) : 0,
      averagePlayerValue: players.length ? Math.round(squadValue / players.length) : 0,
      payroll,
      ...campaign,
      campaignPosition: 0,
      position: 0,
      previousPosition: null,
      positionChange: null,
      valueChange: null,
      rankChange: null,
      averageAttendance: null,
    };
  });
  const campaignPositions = new Map([...clubRows]
    .sort(compareCampaigns)
    .map((club, index) => [club.id, index + 1]));
  const clubs = clubRows
    .map((club) => {
      const campaignPosition = campaignPositions.get(club.id) ?? 0;
      const movement = latestRankingMovement(currentTimeline, "club", club.id);
      const previousPosition = movement?.previousPosition ?? null;
      const positionChange = movement?.positionChange ?? null;
      return {
        ...club,
        campaignPosition,
        position: campaignPosition,
        previousPosition,
        positionChange,
        rankChange: positionChange,
      };
    })
    .sort((left, right) => (
      right.squadValue - left.squadValue || left.name.localeCompare(right.name, "pt-BR")
    ));

  const goalsByClub = new Map(clubRows.map((club) => [identifierKey(club.id), club.goalsFor]));
  const players = rosterEntries.flatMap(({ club, players: roster }) => (
    roster.map((player) => {
      const ranked = publicPlayer(player, club, statsContext);
      const clubGoals = goalsByClub.get(identifierKey(club.id)) ?? 0;
      const changedClub = playerChangedClubThisSeason(room, ranked.id);
      return {
        ...ranked,
        clubGoalParticipationPercent: ranked.statisticsAvailable
          && !changedClub
          && clubGoals > 0
          && ranked.goalContributions <= clubGoals
          ? Number(((ranked.goalContributions / clubGoals) * 100).toFixed(2))
          : null,
      };
    })
  )).sort(comparePlayers).map((player, index) => ({ ...player, rank: index + 1 }));

  const currentSeason = Math.max(1, finiteInteger(room.currentSeason, 1));
  const currentCompetitionIds = new Set(leagues.map((competition) => identifierKey(competition?.id)).filter(Boolean));
  const completedCompetitionKeys = new Set(leagues.flatMap((competition) => {
    const competitionFixtures = competitionFixturesForScope(room, [competition]);
    return scopeStatus(room, competitionFixtures, results) === "completed"
      ? [identifierKey(competition?.id)]
      : [];
  }));
  const clubMetrics = new Map();
  for (const club of clubRows) {
    clubMetrics.set(identifierKey(club.id), club);
    if (club.code) clubMetrics.set(identifierKey(club.code), club);
  }
  const expectedPositions = expectedCoachPositions(clubRows);
  const actualPositions = new Map(clubRows.map((club) => [
    identifierKey(club.id),
    campaignPositions.get(club.id) ?? clubRows.length,
  ]));
  const knownCompetitionReputations = clubRows
    .map((club) => nullableNumber(club.reputation, 0, 100))
    .filter((value) => value !== null);
  const competitionStrength = knownCompetitionReputations.length > 0
    ? knownCompetitionReputations.reduce((sum, value) => sum + value, 0) / knownCompetitionReputations.length
    : null;
  const rankingContext = {
    timeline,
    currentSeason,
    currentCompetitionId: leagues.length === 1 ? identifier(leagues[0]?.id) || null : null,
    currentCompetitionName: leagues.length === 1
      ? identifier(leagues[0]?.name ?? leagues[0]?.id) || null
      : null,
    currentCompetitionIds,
    completedCompetitionIds: completedCompetitionKeys,
    clubMetrics,
    expectedPositions,
    actualPositions,
    clubCount: Math.max(1, clubRows.length),
    competitionStrength,
    usesManagerTimeline: timelineLeagues.length > 0,
  };
  const currentManagerCandidates = leagues.flatMap((competition) => (
    rankingManagersForCompetition(competition, room.managers, room.coachCareerState)
  ));
  const currentManagerIds = new Set(currentManagerCandidates.map((manager) => identifierKey(manager?.id)));
  const historicalManagerCandidates = historicalManagerCandidatesForScope(
    room,
    timeline,
    currentCompetitionIds,
  ).filter((manager) => !currentManagerIds.has(identifierKey(manager?.id)));
  const managerCandidates = [...new Map([
    ...currentManagerCandidates,
    ...historicalManagerCandidates,
  ].map((manager) => [identifierKey(manager.id), manager])).values()];
  rankingContext.managerCandidates = managerCandidates;
  const managers = managerCandidates
    .map((manager) => publicManager(
      room,
      manager,
      clubsById,
      fixtures,
      results,
      viewerId,
      rankingContext,
    ))
    .sort(compareManagers)
    .map((manager, index) => {
      const position = index + 1;
      const movement = latestRankingMovement(currentTimeline, "manager", manager.id);
      const movementMatchesCurrentRank = movement?.position === position;
      const previousPosition = movementMatchesCurrentRank ? movement?.previousPosition ?? null : null;
      const positionChange = movementMatchesCurrentRank ? movement?.positionChange ?? null : null;
      return {
        ...manager,
        position,
        previousPosition,
        positionChange,
        rankChange: positionChange,
      };
    });

  const updatedRound = completedRoundForScope(fixtures, results);
  const totalRounds = fixtures.reduce((largest, fixture) => (
    Math.max(largest, finiteInteger(fixture?.round))
  ), 0);
  const nextFixture = [...fixtures]
    .sort(compareFixtures)
    .find((fixture) => !results.has(identifierKey(fixture?.leagueFixtureId)));
  const selectedLeague = leagues.length === 1 ? leagues[0] : null;
  const selectedTournament = selectedLeague?.scopeType === "tournament";
  const generatedAt = new Date().toISOString();
  const status = scopeStatus(room, fixtures, results);
  return {
    meta: {
      generatedAt,
      updatedAt: generatedAt,
      updatedRound,
      completedRounds: updatedRound,
      totalRounds,
      currentRound: nullableInteger(nextFixture?.round, 1) ?? updatedRound,
      currentSeason,
      seasonYear: nullableInteger(room.seasonYear, 1900, 9999),
      status,
      seasonState: status,
      source: "room-save",
      stale: false,
      playerStatsScope: statsContext.scope,
      playerStatsComplete: statsContext.complete,
      playerStatsTrackedMatches: statsContext.trackedMatches,
      playerStatsUntrackedMatches: statsContext.untrackedMatches,
      playerMetricCoverage: statsContext.metricCoverage,
    },
    scope: {
      type: selectedTournament ? "tournament" : leagues.length === 1 ? "league" : "active-leagues",
      competitionId: selectedLeague ? identifier(selectedLeague.id) || null : null,
      leagueId: selectedLeague && !selectedTournament ? identifier(selectedLeague.id) || null : null,
      leagueName: selectedLeague ? identifier(selectedLeague.name) || null : null,
      leagueIds: leagues
        .filter((competition) => competition?.scopeType !== "tournament")
        .map((league) => identifier(league?.id))
        .filter(Boolean),
      options,
      ...(selectedTournament ? {
        competitionName: identifier(selectedLeague?.name) || null,
        competitionFormat: identifier(selectedLeague?.format) || null,
      } : {}),
    },
    options: {
      competitions: options,
      clubs: scopedClubs.map((club) => ({ id: club.id, name: club.name, count: club.playerCount ?? null })),
      nationalities: [...new Set(players.map((player) => player.nationality).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "pt-BR"))
        .map((nationality) => ({ id: nationality, name: nationality, count: null })),
      positions: [...new Set(players.map((player) => player.position).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "pt-BR"))
        .map((position) => ({ id: position, name: position, count: null })),
      managerTypes: [
        { id: "all", name: "Todos", count: managers.length },
        { id: "human", name: "Jogadores", count: managers.filter((manager) => manager.isHuman).length },
        { id: "ai", name: "Inteligência Artificial", count: managers.filter((manager) => manager.isAI).length },
      ],
      managerClubs: scopedClubs.map((club) => ({
        id: club.id,
        name: club.name,
        count: managers.filter((manager) => identifierKey(manager.clubId) === identifierKey(club.id)).length,
      })),
      managerNationalities: [...new Set(managers.map((manager) => manager.nationality).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "pt-BR"))
        .map((nationality) => ({
          id: nationality,
          name: nationality,
          count: managers.filter((manager) => manager.nationality === nationality).length,
        })),
      managerStatuses: ["employed", "unemployed", "dismissed"].map((statusId) => ({
        id: statusId,
        name: statusId === "employed" ? "Empregado" : statusId === "dismissed" ? "Demitido" : "Sem clube",
        count: managers.filter((manager) => manager.status === statusId).length,
      })),
      managerPeriods: [
        { id: "current", name: "Temporada atual", count: null },
        { id: "last-five", name: "Últimos cinco jogos", count: null },
        { id: "career", name: "Histórico completo", count: null },
      ],
    },
    players,
    clubs,
    managers,
    timeline,
    history: (Array.isArray(room.seasonHistory) ? room.seasonHistory : [])
      .map(publicSeasonHistory)
      .filter(Boolean),
  };
}
