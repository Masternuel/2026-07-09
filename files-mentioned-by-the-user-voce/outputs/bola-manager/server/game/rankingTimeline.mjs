function text(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return text(value).toLocaleUpperCase("pt-BR");
}

function aiCoachId(value) {
  const sourceId = text(value);
  return sourceId.toLocaleLowerCase("pt-BR").startsWith("ai-coach:")
    ? sourceId
    : `ai-coach:${sourceId}`;
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function metric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Builds a deterministic expectation table from real club data. Reputation is
 * the primary signal, while first-team quality and squad value stop equally
 * reputed clubs from falling back to an arbitrary alphabetical expectation.
 */
export function expectedCoachPositions(clubs = []) {
  const rows = (Array.isArray(clubs) ? clubs : []).filter((club) => (
    key(club?.clubId ?? club?.id ?? club?.code)
  ));
  const metrics = [
    { fields: ["reputation"], weight: 0.45 },
    { fields: ["squadStrength", "rankingSquadStrength", "strength"], weight: 0.4 },
    { fields: ["squadValue", "rankingSquadValue", "value"], weight: 0.15 },
  ].map((definition) => {
    const values = rows.map((row) => definition.fields
      .map((field) => metric(row?.[field]))
      .find((value) => value !== null) ?? null);
    const known = values.filter((value) => value !== null);
    return {
      ...definition,
      values,
      minimum: known.length ? Math.min(...known) : null,
      maximum: known.length ? Math.max(...known) : null,
    };
  });
  const scored = rows.map((row, rowIndex) => {
    let score = 0;
    let weight = 0;
    for (const definition of metrics) {
      const value = definition.values[rowIndex];
      if (value === null || definition.minimum === null || definition.maximum === null) continue;
      const normalized = definition.maximum === definition.minimum
        ? 0.5
        : (value - definition.minimum) / (definition.maximum - definition.minimum);
      score += normalized * definition.weight;
      weight += definition.weight;
    }
    return { row, score: weight > 0 ? score / weight : 0 };
  }).sort((left, right) => (
    right.score - left.score
      || text(left.row?.clubName ?? left.row?.name ?? left.row?.label)
        .localeCompare(text(right.row?.clubName ?? right.row?.name ?? right.row?.label), "pt-BR")
  ));
  const positions = new Map();
  scored.forEach(({ row }, index) => {
    const position = index + 1;
    const id = key(row?.clubId ?? row?.id ?? row?.code);
    const code = key(row?.clubCode ?? row?.code);
    if (id) positions.set(id, position);
    if (code) positions.set(code, position);
  });
  return positions;
}

function resultByFixture(results) {
  const byFixture = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const fixtureId = key(result?.leagueFixtureId ?? result?.fixtureId);
    const score = Array.isArray(result?.score) ? result.score : [];
    const home = Number(score[0]);
    const away = Number(score[1]);
    if (!fixtureId || !Number.isFinite(home) || !Number.isFinite(away)) continue;
    byFixture.set(fixtureId, [Math.max(0, Math.trunc(home)), Math.max(0, Math.trunc(away))]);
  }
  return byFixture;
}

function fixtureId(fixture) {
  return key(fixture?.leagueFixtureId ?? fixture?.fixtureId);
}

function clubIdentity(club) {
  return key(club?.id ?? club?.code);
}

function coachRecord(club) {
  const value = club?.headCoach ?? club?.coach ?? club?.manager ?? club?.managerProfile;
  if (typeof value === "string") return { name: text(value) };
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Returns one stable coach for every club in a competition. Human managers
 * replace the AI coach of their selected club; unmanaged clubs keep an AI
 * identity derived from catalog metadata (or, for legacy catalogs, club ID).
 */
export function rankingManagersForCompetition(competition, managers = [], coachCareerState = null) {
  const clubs = Array.isArray(competition?.clubs) ? competition.clubs : [];
  const clubAliases = new Map();
  for (const club of clubs) {
    const identity = clubIdentity(club);
    if (!identity) continue;
    clubAliases.set(identity, club);
    const code = key(club?.code);
    if (code) clubAliases.set(code, club);
  }

  const persistedCoaches = Array.isArray(coachCareerState?.coaches) ? coachCareerState.coaches : [];
  const persistedById = new Map(persistedCoaches.map((coach) => [text(coach?.id), coach]));
  const humans = (Array.isArray(managers) ? managers : []).flatMap((manager) => {
    const club = clubAliases.get(key(manager?.clubId));
    const id = text(manager?.id);
    if (!club || !id) return [];
    const persisted = persistedById.get(id) ?? {};
    return [{
      ...persisted,
      ...manager,
      id,
      clubId: text(club?.id ?? club?.code),
      managerType: "human",
      isHuman: true,
      isAI: false,
      status: text(manager?.status) || "employed",
    }];
  });
  const activeHumanIds = new Set(humans.map((manager) => text(manager.id)));
  const claimedClubs = new Set(humans.map((manager) => key(manager.clubId)));
  const persistedByClub = new Map(persistedCoaches.flatMap((coach) => {
    const clubId = key(coach?.currentClubId);
    return clubId && coach?.managerType === "ai" ? [[clubId, coach]] : [];
  }));
  const historicalCoaches = persistedCoaches.flatMap((coach) => {
    if (activeHumanIds.has(text(coach?.id))) return [];
    const assignments = Array.isArray(coach?.assignments) ? coach.assignments : [];
    if (!assignments.some((assignment) => clubAliases.has(key(assignment?.clubId)))) return [];
    const currentClubId = clubAliases.has(key(coach?.currentClubId)) ? text(coach.currentClubId) : null;
    const managerType = coach?.managerType === "human" ? "human" : "ai";
    return [{
      ...coach,
      clubId: currentClubId,
      managerType,
      isHuman: managerType === "human",
      isAI: managerType === "ai",
    }];
  });
  const historicalIds = new Set(historicalCoaches.map((coach) => text(coach.id)));
  const ai = clubs.flatMap((club) => {
    const clubId = text(club?.id ?? club?.code);
    if (!clubId || claimedClubs.has(key(clubId))) return [];
    const persisted = persistedByClub.get(key(clubId)) ?? null;
    const coach = persisted ?? coachRecord(club);
    const sourceId = text(coach?.id ?? coach?.coachId ?? coach?.managerId) || clubId;
    if (persisted && historicalIds.has(text(persisted.id))) return [];
    return [{
      id: persisted ? sourceId : aiCoachId(sourceId),
      name: text(coach?.name ?? coach?.fullName) || `Treinador de ${text(club?.name) || clubId}`,
      clubId,
      managerType: "ai",
      isHuman: false,
      isAI: true,
      status: text(coach?.status) || "employed",
      nationality: text(coach?.nationality ?? coach?.country) || null,
      avatarImageUrl: text(coach?.avatarImageUrl ?? coach?.photoUrl) || null,
      preferredFormation: text(coach?.preferredFormation ?? coach?.formation) || null,
      style: text(coach?.style ?? coach?.playStyle) || null,
      reputation: Number.isFinite(Number(coach?.reputation)) ? Number(coach.reputation) : null,
    }];
  });
  return [...humans, ...historicalCoaches, ...ai];
}

function managerAssignmentForRound(manager, seasonNumber, round) {
  const assignments = Array.isArray(manager?.assignments) ? manager.assignments : [];
  const assignment = assignments.find((candidate) => {
    const startedSeason = integer(candidate?.startedSeason, 1);
    const endedSeason = candidate?.endedSeason === null || candidate?.endedSeason === undefined
      ? null
      : integer(candidate.endedSeason, startedSeason);
    if (seasonNumber < startedSeason || (endedSeason !== null && seasonNumber > endedSeason)) return false;
    if (seasonNumber === startedSeason && round < Math.max(1, integer(candidate?.startedRound, 1))) return false;
    if (endedSeason !== null && seasonNumber === endedSeason) {
      const endedRound = candidate?.endedRound === null || candidate?.endedRound === undefined
        ? null
        : integer(candidate.endedRound);
      if (endedRound !== null && round > endedRound) return false;
    }
    return true;
  });
  if (assignment) return assignment;
  if (assignments.length > 0 || !text(manager?.clubId)) return null;
  return {
    clubId: text(manager.clubId),
    startedSeason: 1,
    startedRound: 1,
    endedSeason: null,
    endedRound: null,
  };
}

function rowForClubAtRound(rowsByRound, round, clubId) {
  if (round < 1) return null;
  return (rowsByRound.get(round) ?? []).find((row) => (
    key(row?.clubId) === key(clubId) || key(row?.clubCode) === key(clubId)
  )) ?? null;
}

function tenureCampaign(rowsByRound, currentClub, assignment, seasonNumber, round) {
  const clubId = text(assignment?.clubId);
  const startedSeason = integer(assignment?.startedSeason, 1);
  const startedRound = seasonNumber === startedSeason
    ? Math.max(1, integer(assignment?.startedRound, 1))
    : 1;
  const baseline = startedRound > 1
    ? rowForClubAtRound(rowsByRound, startedRound - 1, clubId)
    : null;
  const campaign = {
    ...currentClub,
    played: Math.max(0, integer(currentClub?.played) - integer(baseline?.played)),
    wins: Math.max(0, integer(currentClub?.wins) - integer(baseline?.wins)),
    draws: Math.max(0, integer(currentClub?.draws) - integer(baseline?.draws)),
    losses: Math.max(0, integer(currentClub?.losses) - integer(baseline?.losses)),
    goalsFor: Math.max(0, integer(currentClub?.goalsFor) - integer(baseline?.goalsFor)),
    goalsAgainst: Math.max(0, integer(currentClub?.goalsAgainst) - integer(baseline?.goalsAgainst)),
    points: Math.max(0, integer(currentClub?.points) - integer(baseline?.points)),
    upsetWins: Math.max(0, integer(currentClub?.upsetWins) - integer(baseline?.upsetWins)),
    recentForm: [],
  };
  campaign.goalDifference = campaign.goalsFor - campaign.goalsAgainst;

  for (let fixtureRound = startedRound; fixtureRound <= round; fixtureRound += 1) {
    const current = rowForClubAtRound(rowsByRound, fixtureRound, clubId);
    if (!current) continue;
    const previous = rowForClubAtRound(rowsByRound, fixtureRound - 1, clubId);
    const wins = Math.max(0, integer(current.wins) - integer(previous?.wins));
    const draws = Math.max(0, integer(current.draws) - integer(previous?.draws));
    const losses = Math.max(0, integer(current.losses) - integer(previous?.losses));
    campaign.recentForm.push(
      ...Array(wins).fill("V"),
      ...Array(draws).fill("E"),
      ...Array(losses).fill("D"),
    );
  }
  campaign.recentForm = campaign.recentForm.slice(-5);
  return campaign;
}

function compareRows(left, right) {
  return right.points - left.points
    || right.wins - left.wins
    || right.goalDifference - left.goalDifference
    || right.goalsFor - left.goalsFor
    || left.name.localeCompare(right.name, "pt-BR");
}

function emptyCampaign(club) {
  const name = text(club?.name ?? club?.id ?? club?.code);
  return {
    clubId: text(club?.id ?? club?.code),
    clubCode: text(club?.code ?? club?.id),
    clubName: name,
    name,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    reputation: Number.isFinite(Number(club?.reputation)) ? Number(club.reputation) : null,
    squadStrength: metric(club?.rankingSquadStrength ?? club?.squadStrength ?? club?.strength),
    squadValue: metric(club?.rankingSquadValue ?? club?.squadValue ?? club?.value),
    recentForm: [],
    upsetWins: 0,
  };
}

function applyFixture(campaigns, fixture, score) {
  const home = campaigns.get(key(fixture?.homeClubId));
  const away = campaigns.get(key(fixture?.awayClubId));
  if (!home || !away) return;

  const [homeGoals, awayGoals] = score;
  home.played += 1;
  away.played += 1;
  home.goalsFor += homeGoals;
  home.goalsAgainst += awayGoals;
  away.goalsFor += awayGoals;
  away.goalsAgainst += homeGoals;
  if (homeGoals > awayGoals) {
    home.wins += 1;
    away.losses += 1;
    home.points += 3;
    home.recentForm.push("V");
    away.recentForm.push("D");
    if (home.reputation !== null && away.reputation !== null && away.reputation > home.reputation) home.upsetWins += 1;
  } else if (homeGoals < awayGoals) {
    away.wins += 1;
    home.losses += 1;
    away.points += 3;
    home.recentForm.push("D");
    away.recentForm.push("V");
    if (home.reputation !== null && away.reputation !== null && home.reputation > away.reputation) away.upsetWins += 1;
  } else {
    home.draws += 1;
    away.draws += 1;
    home.points += 1;
    away.points += 1;
    home.recentForm.push("E");
    away.recentForm.push("E");
  }
  home.recentForm = home.recentForm.slice(-5);
  away.recentForm = away.recentForm.slice(-5);
  home.goalDifference = home.goalsFor - home.goalsAgainst;
  away.goalDifference = away.goalsFor - away.goalsAgainst;
}

function fixturesForLeague(fixtures, league, clubKeys) {
  const leagueKey = key(league?.id);
  return (Array.isArray(fixtures) ? fixtures : []).filter((fixture) => {
    const fixtureLeague = key(fixture?.leagueId ?? fixture?.competitionId);
    if (fixtureLeague) return fixtureLeague === leagueKey;
    return clubKeys.has(key(fixture?.homeClubId)) && clubKeys.has(key(fixture?.awayClubId));
  });
}

function completedRounds(fixtures, results) {
  const byRound = new Map();
  for (const fixture of fixtures) {
    const round = integer(fixture?.round);
    if (round < 1 || !fixtureId(fixture)) continue;
    const roundFixtures = byRound.get(round) ?? [];
    roundFixtures.push(fixture);
    byRound.set(round, roundFixtures);
  }
  const completed = [];
  for (const entry of [...byRound.entries()].sort(([left], [right]) => left - right)) {
    const [, roundFixtures] = entry;
    if (roundFixtures.length === 0 || !roundFixtures.every((fixture) => results.has(fixtureId(fixture)))) break;
    completed.push(entry);
  }
  return completed;
}

function clubEntriesForLeague({ league, fixtures, results, seasonNumber, seasonYear }) {
  const clubs = (Array.isArray(league?.clubs) ? league.clubs : [])
    .filter((club) => clubIdentity(club));
  const campaignRows = clubs.map(emptyCampaign);
  const campaigns = new Map();
  for (const row of campaignRows) {
    campaigns.set(key(row.clubId), row);
    campaigns.set(key(row.clubCode), row);
  }
  const positions = new Map();
  const entries = [];

  for (const [round, roundFixtures] of completedRounds(fixtures, results)) {
    for (const fixture of roundFixtures) {
      applyFixture(campaigns, fixture, results.get(fixtureId(fixture)));
    }
    const standings = [...campaignRows].sort(compareRows);
    for (let index = 0; index < standings.length; index += 1) {
      const row = standings[index];
      const position = index + 1;
      const previousPosition = positions.get(key(row.clubId)) ?? null;
      entries.push({
        id: `club:${seasonNumber}:${text(league?.id)}:${round}:${row.clubId}`,
        type: "club",
        seasonNumber,
        seasonYear,
        competitionId: text(league?.id),
        competitionName: text(league?.name ?? league?.id),
        round,
        entityId: row.clubId,
        clubId: row.clubId,
        clubCode: row.clubCode,
        managerId: null,
        label: row.clubName,
        position,
        previousPosition,
        positionChange: previousPosition === null ? null : previousPosition - position,
        ...Object.fromEntries([
          "played", "wins", "draws", "losses", "goalsFor", "goalsAgainst", "goalDifference", "points",
        ].map((field) => [field, row[field]])),
        reputation: row.reputation,
        recentForm: [...row.recentForm],
        upsetWins: row.upsetWins,
      });
      positions.set(key(row.clubId), position);
    }
  }
  return entries;
}

export function calculateCoachRankingPoints({
  campaign,
  expectedPosition,
  actualPosition,
  titles = 0,
  competitionStrength = null,
} = {}) {
  const played = integer(campaign?.played);
  const points = integer(campaign?.points);
  const wins = integer(campaign?.wins);
  const draws = integer(campaign?.draws);
  const goalDifference = Number(campaign?.goalDifference) || 0;
  const recentForm = Array.isArray(campaign?.recentForm) ? campaign.recentForm.slice(-5) : [];
  const performance = played > 0 ? (points / (played * 3)) * 100 : 0;
  const recentScore = recentForm.reduce((total, result) => (
    total + (result === "V" ? 6 : result === "E" ? 2 : -2)
  ), 0);
  const components = {
    results: points * 10 + wins * 4 + draws,
    performance: performance * 0.4,
    goalBalance: goalDifference * 2,
    recentForm: recentScore,
    expectation: (integer(expectedPosition, 1) - integer(actualPosition, 1)) * 8,
    upsets: integer(campaign?.upsetWins) * 12,
    titles: integer(titles) * 100,
    competitionMultiplier: competitionStrength === null || !Number.isFinite(Number(competitionStrength))
      ? 1
      : Math.round((1 + Math.max(0, Number(competitionStrength)) / 100) * 1_000) / 1_000,
  };
  if (played === 0 && integer(titles) === 0) return { total: 0, components };
  const subtotal = components.results + components.performance + components.goalBalance
    + components.recentForm + components.expectation + components.upsets + components.titles;
  return { total: Math.max(0, Math.round(subtotal * components.competitionMultiplier)), components };
}

function managerEntries(clubEntries, managers, competitionCompleted = false) {
  const competitionIds = [...new Set(clubEntries.map((entry) => key(entry.competitionId)))];
  // A manager only participates in the ranking after choosing a club in this
  // competition. Its round-by-round rank is unambiguous with one competition.
  if (competitionIds.length !== 1) return [];

  const rowsByRound = new Map();
  for (const entry of clubEntries) {
    const rows = rowsByRound.get(entry.round) ?? [];
    rows.push(entry);
    rowsByRound.set(entry.round, rows);
  }
  const positions = new Map();
  const entries = [];
  const maximumRound = clubEntries.reduce((maximum, entry) => Math.max(maximum, integer(entry?.round)), 0);
  for (const [round, clubRows] of [...rowsByRound.entries()].sort(([left], [right]) => left - right)) {
    const clubs = new Map();
    for (const row of clubRows) {
      clubs.set(key(row.clubId), row);
      clubs.set(key(row.clubCode), row);
    }
    const knownReputations = clubRows.map((row) => row.reputation).filter((value) => value !== null);
    const competitionStrength = knownReputations.length > 0
      ? knownReputations.reduce((sum, value) => sum + value, 0) / knownReputations.length
      : null;
    const expectedPositions = expectedCoachPositions(clubRows);
    const ranked = (Array.isArray(managers) ? managers : [])
      .map((manager) => ({
        manager,
        assignment: managerAssignmentForRound(manager, clubRows[0]?.seasonNumber ?? 1, round),
      }))
      .map(({ manager, assignment }) => ({ manager, assignment, clubId: text(assignment?.clubId) }))
      .filter(({ manager, clubId }) => text(manager?.id) && clubId && clubs.has(key(clubId)))
      .map(({ manager, assignment, clubId }) => {
        const club = clubs.get(key(clubId)) ?? null;
        const campaign = tenureCampaign(
          rowsByRound,
          club,
          assignment,
          clubRows[0]?.seasonNumber ?? 1,
          round,
        );
        const titles = competitionCompleted && round === maximumRound && club?.position === 1 ? 1 : 0;
        const rankingPoints = calculateCoachRankingPoints({
          campaign,
          expectedPosition: expectedPositions.get(key(club?.clubId)) ?? clubRows.length,
          actualPosition: club?.position ?? clubRows.length,
          titles,
          competitionStrength,
        }).total;
        return {
          manager,
          club,
          campaign,
          assignment,
          titles,
          rankingPoints,
          points: campaign.points,
          wins: campaign.wins,
          goalDifference: campaign.goalDifference,
          goalsFor: campaign.goalsFor,
          name: text(manager?.name) || "Manager",
        };
      })
      .sort((left, right) => (
        right.rankingPoints - left.rankingPoints || compareRows(left, right)
      ));

    for (let index = 0; index < ranked.length; index += 1) {
      const { manager, club, campaign, assignment, titles, name, rankingPoints } = ranked[index];
      const managerId = text(manager.id);
      const position = index + 1;
      const previousPosition = positions.get(managerId) ?? null;
      const base = club ?? clubRows[0];
      entries.push({
        ...base,
        id: `manager:${base.seasonNumber}:${base.competitionId}:${round}:${managerId}`,
        type: "manager",
        entityId: managerId,
        clubId: (club?.clubId ?? text(manager?.clubId)) || null,
        clubCode: club?.clubCode ?? null,
        managerId,
        label: name,
        position,
        campaignPosition: club?.position ?? null,
        tenureStartedSeason: integer(assignment?.startedSeason, 1),
        tenureStartedRound: Math.max(1, integer(assignment?.startedRound, 1)),
        previousPosition,
        positionChange: previousPosition === null ? null : previousPosition - position,
        played: campaign.played,
        wins: campaign.wins,
        draws: campaign.draws,
        losses: campaign.losses,
        goalsFor: campaign.goalsFor,
        goalsAgainst: campaign.goalsAgainst,
        goalDifference: campaign.goalDifference,
        points: campaign.points,
        recentForm: campaign.recentForm,
        upsetWins: campaign.upsetWins,
        titles,
        rankingPoints,
      });
      positions.set(managerId, position);
    }
  }
  return entries;
}

/**
 * Reconstructs league positions after every fully completed round.
 * Only persisted fixtures and scores are used; partial rounds stay out of history.
 */
export function buildLeagueRankingTimeline({
  leagues,
  fixtures,
  results,
  managers = [],
  coachCareerState = null,
  seasonNumber = 1,
  seasonYear = null,
} = {}) {
  const resultMap = resultByFixture(results);
  const normalizedSeason = Math.max(1, integer(seasonNumber, 1));
  const normalizedYear = Number.isFinite(Number(seasonYear)) ? Math.trunc(Number(seasonYear)) : null;
  const clubEntries = [];
  const managerTimeline = [];

  for (const league of Array.isArray(leagues) ? leagues : []) {
    const clubKeys = new Set((league?.clubs ?? []).map(clubIdentity).filter(Boolean));
    if (!text(league?.id) || clubKeys.size === 0) continue;
    const leagueClubEntries = clubEntriesForLeague({
      league,
      fixtures: fixturesForLeague(fixtures, league, clubKeys),
      results: resultMap,
      seasonNumber: normalizedSeason,
      seasonYear: normalizedYear,
    });
    clubEntries.push(...leagueClubEntries);
    const scopedFixtures = fixturesForLeague(fixtures, league, clubKeys);
    const scopedResults = resultMap;
    const competitionCompleted = scopedFixtures.length > 0
      && scopedFixtures.every((fixture) => scopedResults.has(fixtureId(fixture)));
    managerTimeline.push(...managerEntries(
      leagueClubEntries,
      rankingManagersForCompetition(league, managers, coachCareerState),
      competitionCompleted,
    ));
  }

  return [...clubEntries, ...managerTimeline].sort((left, right) => (
    left.seasonNumber - right.seasonNumber
      || left.competitionName.localeCompare(right.competitionName, "pt-BR")
      || left.round - right.round
      || left.type.localeCompare(right.type)
      || left.position - right.position
      || left.label.localeCompare(right.label, "pt-BR")
  ));
}

function timelineGroupKey(entry) {
  return [integer(entry?.seasonNumber, 1), text(entry?.seasonYear), key(entry?.competitionId)].join("\u0000");
}

/** Compact archival form: entity labels are stored once, round rows use arrays. */
export function compactLeagueRankingTimeline(timeline) {
  const grouped = new Map();
  for (const entry of Array.isArray(timeline) ? timeline : []) {
    if (!text(entry?.competitionId) || !["club", "manager"].includes(entry?.type)) continue;
    const groupKey = timelineGroupKey(entry);
    const entries = grouped.get(groupKey) ?? [];
    entries.push(entry);
    grouped.set(groupKey, entries);
  }

  return [...grouped.values()].map((entries) => {
    const sample = entries[0];
    const clubs = [];
    const clubIndexes = new Map();
    const managers = [];
    const managerIndexes = new Map();
    for (const entry of entries) {
      if (entry.type === "club" && !clubIndexes.has(key(entry.clubId))) {
        clubIndexes.set(key(entry.clubId), clubs.length);
        clubs.push([text(entry.clubId), text(entry.clubCode) || null, text(entry.label)]);
      }
      if (entry.type === "manager" && !managerIndexes.has(key(entry.managerId))) {
        managerIndexes.set(key(entry.managerId), managers.length);
        managers.push([text(entry.managerId), text(entry.clubId) || null, text(entry.label)]);
      }
    }

    const rounds = new Map();
    for (const entry of entries) {
      const round = integer(entry.round);
      if (round < 1) continue;
      const snapshot = rounds.get(round) ?? { round, clubRows: [], managerRows: [] };
      const stats = [
        integer(entry.position), integer(entry.points), integer(entry.played), integer(entry.wins),
        integer(entry.draws), integer(entry.losses), integer(entry.goalsFor), integer(entry.goalsAgainst),
        integer(entry.rankingPoints),
      ];
      if (entry.type === "club") {
        const entityIndex = clubIndexes.get(key(entry.clubId));
        if (entityIndex !== undefined) snapshot.clubRows.push([entityIndex, ...stats]);
      } else {
        const entityIndex = managerIndexes.get(key(entry.managerId));
        if (entityIndex !== undefined) snapshot.managerRows.push([
          entityIndex,
          ...stats,
          text(entry.clubId) || null,
          integer(entry.tenureStartedSeason, 1),
          Math.max(1, integer(entry.tenureStartedRound, 1)),
          integer(entry.campaignPosition),
          integer(entry.titles),
        ]);
      }
      rounds.set(round, snapshot);
    }
    return {
      format: "ranking-timeline-v1",
      seasonNumber: Math.max(1, integer(sample.seasonNumber, 1)),
      seasonYear: Number.isFinite(Number(sample.seasonYear)) ? Math.trunc(Number(sample.seasonYear)) : null,
      competitionId: text(sample.competitionId),
      competitionName: text(sample.competitionName ?? sample.competitionId),
      clubs,
      managers,
      rounds: [...rounds.values()].sort((left, right) => left.round - right.round),
    };
  });
}

function expandRows(group, type, positions) {
  const definitions = type === "club" ? group?.clubs : group?.managers;
  if (!Array.isArray(definitions)) return [];
  const output = [];
  for (const snapshot of Array.isArray(group?.rounds) ? group.rounds : []) {
    const round = integer(snapshot?.round);
    const rows = type === "club" ? snapshot?.clubRows : snapshot?.managerRows;
    if (round < 1 || !Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const definition = definitions[integer(row[0])];
      const entityId = text(definition?.[0]);
      const position = integer(row[1]);
      if (!entityId || position < 1) continue;
      const previousPosition = positions.get(entityId) ?? null;
      const clubId = type === "club"
        ? entityId
        : text(row.length > 10 ? row[10] : definition?.[1]) || null;
      const archivedClub = (Array.isArray(group?.clubs) ? group.clubs : []).find((candidate) => (
        key(candidate?.[0]) === key(clubId)
      ));
      const clubName = text(archivedClub?.[2]) || null;
      const goalsFor = integer(row[7]);
      const goalsAgainst = integer(row[8]);
      output.push({
        id: `${type}:${Math.max(1, integer(group?.seasonNumber, 1))}:${text(group?.competitionId)}:${round}:${entityId}`,
        type,
        seasonNumber: Math.max(1, integer(group?.seasonNumber, 1)),
        seasonYear: Number.isFinite(Number(group?.seasonYear)) ? Math.trunc(Number(group.seasonYear)) : null,
        competitionId: text(group?.competitionId),
        competitionName: text(group?.competitionName ?? group?.competitionId),
        round,
        entityId,
        clubId,
        clubName,
        clubCode: type === "club" ? text(definition?.[1]) || null : null,
        managerId: type === "manager" ? entityId : null,
        label: text(definition?.[2]) || entityId,
        position,
        previousPosition,
        positionChange: previousPosition === null ? null : previousPosition - position,
        points: integer(row[2]),
        played: integer(row[3]),
        wins: integer(row[4]),
        draws: integer(row[5]),
        losses: integer(row[6]),
        goalsFor,
        goalsAgainst,
        goalDifference: goalsFor - goalsAgainst,
        rankingPoints: row.length > 9 ? integer(row[9]) : null,
        tenureStartedSeason: type === "manager" && row.length > 11 ? integer(row[11], 1) : null,
        tenureStartedRound: type === "manager" && row.length > 12 ? Math.max(1, integer(row[12], 1)) : null,
        campaignPosition: type === "manager" && row.length > 13 ? integer(row[13]) || null : null,
        titles: type === "manager" && row.length > 14 ? integer(row[14]) : 0,
      });
      positions.set(entityId, position);
    }
  }
  return output;
}

/** Expands seasonHistory rankingTimeline snapshots into public timeline rows. */
export function expandCompactLeagueRankingTimeline(value) {
  const output = [];
  for (const group of Array.isArray(value) ? value : []) {
    if (group?.format !== "ranking-timeline-v1" || !text(group?.competitionId)) continue;
    output.push(...expandRows(group, "club", new Map()));
    output.push(...expandRows(group, "manager", new Map()));
  }
  return output.sort((left, right) => (
    left.seasonNumber - right.seasonNumber
      || left.competitionName.localeCompare(right.competitionName, "pt-BR")
      || left.round - right.round
      || left.type.localeCompare(right.type)
      || left.position - right.position
      || left.label.localeCompare(right.label, "pt-BR")
  ));
}

export function latestRankingMovement(timeline, type, entityId) {
  const matches = (Array.isArray(timeline) ? timeline : []).filter((entry) => (
    entry?.type === type && key(entry?.entityId) === key(entityId)
  ));
  return matches.length > 0 ? matches.at(-1) : null;
}
