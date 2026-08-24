const HISTORY_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1_000;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function key(value) {
  return text(value).toLocaleLowerCase("pt-BR");
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = finite(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function nonNegativeInteger(value) {
  const parsed = integer(value);
  return parsed == null ? null : Math.max(0, parsed);
}

function timestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const supplied = text(value);
  if (!supplied) return null;
  const parsed = new Date(supplied);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(prefix, ...parts) {
  return `${prefix}-${hashText(parts.map((part) => text(part)).join("|"))}`;
}

function uniqueTexts(values) {
  return [...new Set(list(values).map(text).filter(Boolean))];
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(object(value)).filter(([, item]) => item !== undefined));
}

function mergeKnown(previous, next) {
  const merged = { ...object(previous) };
  for (const [name, value] of Object.entries(cleanObject(next))) {
    if (value === null && merged[name] != null) continue;
    if (name === "metadata" && value && typeof value === "object") {
      merged[name] = { ...object(merged[name]), ...value };
      continue;
    }
    merged[name] = value;
  }
  return merged;
}

function mergeById(previous, generated) {
  const values = new Map();
  for (const entry of [...list(previous), ...list(generated)]) {
    if (!entry || typeof entry !== "object") continue;
    const id = text(entry.id);
    if (!id) continue;
    values.set(id, mergeKnown(values.get(id), { ...clone(entry), id }));
  }
  return [...values.values()];
}

function compareChronological(left, right) {
  const leftTime = Date.parse(left?.occurredAt ?? left?.completedAt ?? left?.startedAt ?? "");
  const rightTime = Date.parse(right?.occurredAt ?? right?.completedAt ?? right?.startedAt ?? "");
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight
    || (integer(left?.seasonNumber) ?? Number.MAX_SAFE_INTEGER)
      - (integer(right?.seasonNumber) ?? Number.MAX_SAFE_INTEGER)
    || (integer(left?.round) ?? Number.MAX_SAFE_INTEGER)
      - (integer(right?.round) ?? Number.MAX_SAFE_INTEGER)
    || text(left?.id).localeCompare(text(right?.id), "pt-BR");
}

function durationDays(start, end) {
  const startTime = Date.parse(start ?? "");
  const endTime = Date.parse(end ?? "");
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return null;
  return Math.floor((endTime - startTime) / DAY_MS);
}

function roomNow(room, supplied) {
  return timestamp(
    supplied
      ?? room?.coachEmploymentState?.currentDate
      ?? room?.clubCareerState?.currentDate
      ?? room?.seasonStartedAt
      ?? room?.startedAt
      ?? room?.createdAt,
  );
}

function clubCatalog(room) {
  const clubs = new Map();
  const competitions = new Map();
  const addCompetition = (competition, source) => {
    const competitionId = text(competition?.id ?? competition?.code);
    if (!competitionId) return;
    const competitionRecord = {
      id: competitionId,
      name: text(competition?.name) || null,
      country: text(competition?.country) || null,
      division: text(competition?.division) || text(competition?.name) || null,
      level: integer(competition?.level ?? competition?.divisionOrder ?? competition?.tier),
      format: text(competition?.format ?? competition?.competitionFormat).toLocaleLowerCase("en-US") || null,
      source,
    };
    competitions.set(key(competitionId), mergeKnown(competitions.get(key(competitionId)), competitionRecord));
    const participants = source === "league"
      ? list(competition?.clubs)
      : list(competition?.participants ?? competition?.clubs);
    for (const participant of participants) {
      const clubId = text(participant?.id ?? participant?.code);
      if (!clubId) continue;
      const record = {
        id: clubId,
        name: text(participant?.name) || null,
        country: text(participant?.country) || competitionRecord.country,
        division: text(participant?.division) || competitionRecord.division,
        divisionId: text(participant?.leagueId ?? participant?.divisionId) || competitionId,
        competitionId,
        competitionName: competitionRecord.name,
      };
      const existing = clubs.get(key(clubId));
      if (!existing || source === "league") clubs.set(key(clubId), mergeKnown(existing, record));
      for (const alias of [participant?.code, participant?.name]) {
        if (text(alias) && !clubs.has(key(alias))) clubs.set(key(alias), clubs.get(key(clubId)));
      }
    }
  };
  for (const competition of list(room?.competitionCatalog)) addCompetition(competition, "league");
  for (const tournament of list(room?.tournamentCatalog)) addCompetition(tournament, "tournament");
  for (const manager of list(room?.managers)) {
    const clubId = text(manager?.clubId);
    if (clubId && !clubs.has(key(clubId))) {
      clubs.set(key(clubId), {
        id: clubId,
        name: null,
        country: null,
        division: null,
        divisionId: null,
        competitionId: null,
        competitionName: null,
      });
    }
  }
  return { clubs, competitions };
}

function assignmentId(coachId, assignment) {
  return text(assignment?.id) || stableId(
    "coach-assignment",
    coachId,
    assignment?.clubId,
    assignment?.startedSeason,
    assignment?.startedRound,
    assignment?.startedAt,
  );
}

function assignmentIncludes(assignment, season, round, occurredAt = null) {
  const suppliedSeason = integer(season);
  const suppliedRound = nonNegativeInteger(round);
  const startedSeason = integer(assignment?.startedSeason);
  const startedRound = nonNegativeInteger(assignment?.startedRound) ?? 1;
  const endedSeason = integer(assignment?.endedSeason);
  const endedRound = nonNegativeInteger(assignment?.endedRound);
  if (suppliedSeason != null && startedSeason != null) {
    if (suppliedSeason < startedSeason) return false;
    if (suppliedSeason === startedSeason && suppliedRound != null && suppliedRound < startedRound) return false;
  }
  if (suppliedSeason != null && endedSeason != null) {
    if (suppliedSeason > endedSeason) return false;
    if (
      suppliedSeason === endedSeason
      && suppliedRound != null
      && endedRound != null
      && suppliedRound > endedRound
    ) return false;
  }
  const eventTime = Date.parse(occurredAt ?? "");
  const startTime = Date.parse(assignment?.startedAt ?? "");
  const endTime = Date.parse(assignment?.endedAt ?? "");
  if (Number.isFinite(eventTime) && Number.isFinite(startTime) && eventTime < startTime) return false;
  if (Number.isFinite(eventTime) && Number.isFinite(endTime) && eventTime > endTime) return false;
  return true;
}

function assignmentsForCoach(room, coachId) {
  return list(room?.coachCareerState?.coaches)
    .find((candidate) => text(candidate?.id) === text(coachId))
    ?.assignments ?? [];
}

function coachAtClub(room, clubId, season, round, occurredAt = null) {
  const matches = [];
  for (const coach of list(room?.coachCareerState?.coaches)) {
    for (const assignment of list(coach?.assignments)) {
      if (key(assignment?.clubId) !== key(clubId)) continue;
      if (!assignmentIncludes(assignment, season, round, occurredAt)) continue;
      matches.push({ coach, assignment });
    }
  }
  matches.sort((left, right) => (
    (integer(right.assignment?.startedSeason) ?? 0) - (integer(left.assignment?.startedSeason) ?? 0)
    || (nonNegativeInteger(right.assignment?.startedRound) ?? 0)
      - (nonNegativeInteger(left.assignment?.startedRound) ?? 0)
    || text(right.assignment?.startedAt).localeCompare(text(left.assignment?.startedAt))
  ));
  return text(matches[0]?.coach?.id) || null;
}

function coachAtClubSeasonEnd(room, clubId, season, occurredAt = null) {
  const matches = [];
  for (const coach of list(room?.coachCareerState?.coaches)) {
    for (const assignment of list(coach?.assignments)) {
      if (key(assignment?.clubId) !== key(clubId)) continue;
      const startedSeason = integer(assignment?.startedSeason);
      const endedSeason = integer(assignment?.endedSeason);
      if (startedSeason != null && season != null && startedSeason > season) continue;
      if (endedSeason != null && season != null && endedSeason < season) continue;
      const eventTime = Date.parse(occurredAt ?? "");
      const startTime = Date.parse(assignment?.startedAt ?? "");
      const endTime = Date.parse(assignment?.endedAt ?? "");
      if (Number.isFinite(eventTime) && Number.isFinite(startTime) && eventTime < startTime) continue;
      if (Number.isFinite(eventTime) && Number.isFinite(endTime) && eventTime > endTime) continue;
      matches.push({ coach, assignment });
    }
  }
  matches.sort((left, right) => (
    (integer(right.assignment?.startedSeason) ?? 0) - (integer(left.assignment?.startedSeason) ?? 0)
    || (nonNegativeInteger(right.assignment?.startedRound) ?? 0)
      - (nonNegativeInteger(left.assignment?.startedRound) ?? 0)
    || text(right.assignment?.startedAt).localeCompare(text(left.assignment?.startedAt))
  ));
  return text(matches[0]?.coach?.id) || null;
}

function scorePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const home = nonNegativeInteger(value[0]);
  const away = nonNegativeInteger(value[1]);
  return home == null || away == null ? null : [home, away];
}

function normalizedMatch(room, raw, seasonFallback) {
  const fixtureId = text(raw?.fixtureId ?? raw?.leagueFixtureId ?? raw?.competitionFixtureId ?? raw?.id);
  const competitionId = text(
    raw?.competitionId ?? raw?.leagueId ?? raw?.tournamentId,
  );
  const homeClubId = text(raw?.homeClubId);
  const awayClubId = text(raw?.awayClubId);
  const score = scorePair(raw?.score ?? raw?.result?.score);
  if (!fixtureId || !competitionId || !homeClubId || !awayClubId || !score) return null;
  return {
    fixtureId,
    competitionId,
    seasonNumber: integer(raw?.seasonNumber) ?? integer(seasonFallback),
    round: nonNegativeInteger(raw?.calendarRound ?? raw?.round),
    completedAt: timestamp(raw?.completedAt ?? raw?.result?.completedAt ?? raw?.scheduledAt),
    homeClubId,
    awayClubId,
    homeManagerId: text(raw?.homeManagerId) || null,
    awayManagerId: text(raw?.awayManagerId) || null,
    score,
  };
}

function rawMatches(room) {
  const matches = [];
  for (const [seasonIndex, season] of list(room?.seasonHistory).entries()) {
    const seasonNumber = integer(season?.seasonNumber) ?? seasonIndex + 1;
    for (const archived of list(season?.managerMatchHistory)) {
      const match = normalizedMatch(room, archived, seasonNumber);
      if (match) matches.push(match);
    }
  }

  const results = new Map(list(room?.leagueMatchResults).map((result) => [
    key(result?.leagueFixtureId ?? result?.fixtureId),
    result,
  ]));
  for (const fixture of list(room?.leagueFixtureSchedule)) {
    const result = results.get(key(fixture?.leagueFixtureId ?? fixture?.fixtureId));
    if (!result) continue;
    const match = normalizedMatch(
      room,
      { ...fixture, score: result.score, completedAt: result.completedAt },
      room?.currentSeason,
    );
    if (match) matches.push(match);
  }
  for (const fixture of list(room?.competitionSeason?.fixtures)) {
    if (!fixture?.result || (!fixture?.completedAt && fixture?.status !== "completed")) continue;
    const match = normalizedMatch(room, fixture, room?.currentSeason);
    if (match) matches.push(match);
  }
  return [...new Map(matches.map((match) => [
    [
      match.seasonNumber ?? "unknown",
      key(match.competitionId),
      key(match.fixtureId),
    ].join("|"),
    match,
  ])).values()];
}

function coachMatchRecords(room, coach) {
  const result = [];
  for (const match of rawMatches(room)) {
    const sides = [{
      clubId: match.homeClubId,
      opponentClubId: match.awayClubId,
      managerId: match.homeManagerId,
      venue: "home",
      goalsFor: match.score[0],
      goalsAgainst: match.score[1],
    }, {
      clubId: match.awayClubId,
      opponentClubId: match.homeClubId,
      managerId: match.awayManagerId,
      venue: "away",
      goalsFor: match.score[1],
      goalsAgainst: match.score[0],
    }];
    for (const side of sides) {
      const attributedCoachId = side.managerId || coachAtClub(
        room,
        side.clubId,
        match.seasonNumber,
        match.round,
        match.completedAt,
      );
      if (text(attributedCoachId) !== text(coach.id)) continue;
      const assignment = list(coach.assignments).find((candidate) => (
        key(candidate?.clubId) === key(side.clubId)
        && assignmentIncludes(candidate, match.seasonNumber, match.round, match.completedAt)
      ));
      const outcome = side.goalsFor > side.goalsAgainst
        ? "win"
        : side.goalsFor < side.goalsAgainst ? "loss" : "draw";
      result.push({
        id: stableId(
          "coach-match",
          coach.id,
          match.seasonNumber,
          match.competitionId,
          match.fixtureId,
          side.clubId,
        ),
        fixtureId: match.fixtureId,
        competitionId: match.competitionId,
        seasonNumber: match.seasonNumber,
        round: match.round,
        completedAt: match.completedAt,
        coachId: coach.id,
        clubId: side.clubId,
        opponentClubId: side.opponentClubId,
        assignmentId: assignment ? assignmentId(coach.id, assignment) : null,
        venue: side.venue,
        goalsFor: side.goalsFor,
        goalsAgainst: side.goalsAgainst,
        outcome,
        points: outcome === "win" ? 3 : outcome === "draw" ? 1 : 0,
      });
    }
  }
  return result;
}

function matchStatistics(matches) {
  const ordered = [...matches].sort(compareChronological);
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let winningStreak = 0;
  let winlessStreak = 0;
  let longestWinningStreak = 0;
  let longestWinlessStreak = 0;
  for (const match of ordered) {
    const outcome = text(match?.outcome);
    if (outcome === "win") {
      wins += 1;
      winningStreak += 1;
      winlessStreak = 0;
    } else {
      winningStreak = 0;
      winlessStreak += 1;
      if (outcome === "draw") draws += 1;
      if (outcome === "loss") losses += 1;
    }
    longestWinningStreak = Math.max(longestWinningStreak, winningStreak);
    longestWinlessStreak = Math.max(longestWinlessStreak, winlessStreak);
    goalsFor += nonNegativeInteger(match?.goalsFor) ?? 0;
    goalsAgainst += nonNegativeInteger(match?.goalsAgainst) ?? 0;
  }
  const played = ordered.length;
  const points = wins * 3 + draws;
  return {
    matches: played,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    points,
    pointsPerGame: played ? Math.round((points / played) * 100) / 100 : 0,
    winRate: played ? Math.round(((wins / played) * 100) * 10) / 10 : 0,
    longestWinningStreak,
    longestWinlessStreak,
  };
}

function storedMatchStatistics(assignment) {
  const source = object(assignment?.metrics);
  const read = (name, ...aliases) => {
    for (const candidate of [source[name], assignment?.[name], ...aliases.map((alias) => assignment?.[alias])]) {
      const value = finite(candidate);
      if (value != null) return value;
    }
    return null;
  };
  const matches = read("matches", "games");
  if (matches == null) return null;
  return {
    matches,
    wins: read("wins"),
    draws: read("draws"),
    losses: read("losses"),
    goalsFor: read("goalsFor"),
    goalsAgainst: read("goalsAgainst"),
    goalDifference: read("goalDifference"),
    points: read("points"),
    pointsPerGame: read("pointsPerGame"),
    winRate: read("winRate"),
    longestWinningStreak: read("longestWinningStreak"),
    longestWinlessStreak: read("longestWinlessStreak"),
  };
}

function contractSnapshot(contract) {
  const startDate = timestamp(contract?.startDate ?? contract?.signedAt);
  const endDate = timestamp(contract?.endDate);
  return {
    id: text(contract?.id) || stableId(
      "coach-contract-history",
      contract?.coachId,
      contract?.clubId,
      startDate,
      contract?.operationId,
    ),
    coachId: text(contract?.coachId) || null,
    clubId: text(contract?.clubId) || null,
    role: text(contract?.role) || null,
    signedAt: timestamp(contract?.signedAt),
    startDate,
    endDate,
    endedAt: timestamp(contract?.endedAt),
    durationDays: durationDays(startDate, endDate),
    salary: finite(contract?.wage ?? contract?.salary),
    signingBonus: finite(contract?.signingBonus),
    terminationClause: finite(contract?.terminationClause ?? contract?.releaseClause),
    compensation: finite(contract?.compensation),
    transferBudget: finite(contract?.transferBudget ?? contract?.transferBudgetCommitment),
    bonuses: Object.keys(object(contract?.bonuses)).length ? clone(contract.bonuses) : null,
    clauses: list(contract?.clauses ?? contract?.specialClauses).map(clone),
    objectives: list(contract?.objectives).map(clone),
    renewalOption: contract?.renewalOption == null ? null : Boolean(contract.renewalOption),
    renewalCount: nonNegativeInteger(contract?.renewalCount),
    status: text(contract?.status) || null,
    endReason: text(contract?.endReason) || null,
    operationId: text(contract?.operationId) || null,
  };
}

function contractOverlapsAssignment(contract, assignment) {
  if (key(contract?.clubId) !== key(assignment?.clubId)) return false;
  const contractStart = Date.parse(contract?.startDate ?? "");
  const contractEnd = Date.parse(contract?.endedAt ?? contract?.endDate ?? "");
  const assignmentStart = Date.parse(assignment?.startedAt ?? "");
  const assignmentEnd = Date.parse(assignment?.endedAt ?? "");
  if (Number.isFinite(contractEnd) && Number.isFinite(assignmentStart) && contractEnd < assignmentStart) return false;
  if (Number.isFinite(contractStart) && Number.isFinite(assignmentEnd) && contractStart > assignmentEnd) return false;
  return true;
}

function assignmentContracts(state, coach, assignment) {
  const current = list(state?.contracts)
    .filter((contract) => (
      text(contract?.coachId) === text(coach.id)
      && contractOverlapsAssignment(contract, assignment)
    ))
    .map(contractSnapshot);
  return mergeById(assignment?.contracts, current).sort((left, right) => (
    text(left?.startDate).localeCompare(text(right?.startDate))
    || text(left?.id).localeCompare(text(right?.id))
  ));
}

function assignmentRenewals(assignment, contracts) {
  const generated = [];
  for (let index = 1; index < contracts.length; index += 1) {
    const previous = contracts[index - 1];
    const contract = contracts[index];
    const isRenewal = previous.endReason === "renewed_after_negotiation"
      || (nonNegativeInteger(contract.renewalCount) ?? 0) > (nonNegativeInteger(previous.renewalCount) ?? 0);
    if (!isRenewal) continue;
    generated.push({
      id: stableId("coach-renewal-history", assignment.id, previous.id, contract.id),
      occurredAt: contract.signedAt ?? contract.startDate,
      previousContractId: previous.id,
      contractId: contract.id,
      previousSalary: previous.salary,
      salary: contract.salary,
      previousEndDate: previous.endDate,
      endDate: contract.endDate,
      signingBonus: contract.signingBonus,
      clauses: clone(contract.clauses),
    });
  }
  return mergeById(assignment?.renewals, generated).sort(compareChronological);
}

function winnerRecords(room) {
  const catalog = clubCatalog(room);
  const records = [];
  const decisiveFixture = (competitionId, winnerClubId) => (
    list(room?.competitionSeason?.fixtures)
      .filter((fixture) => (
        key(fixture?.tournamentId ?? fixture?.competitionId) === key(competitionId)
        && (fixture?.status === "completed" || fixture?.completedAt || fixture?.result)
        && [fixture?.homeClubId, fixture?.awayClubId].some((clubId) => key(clubId) === key(winnerClubId))
      ))
      .sort((left, right) => (
        (nonNegativeInteger(right?.calendarRound ?? right?.round) ?? 0)
          - (nonNegativeInteger(left?.calendarRound ?? left?.round) ?? 0)
        || text(right?.completedAt ?? right?.result?.completedAt)
          .localeCompare(text(left?.completedAt ?? left?.result?.completedAt))
        || text(right?.competitionFixtureId ?? right?.id)
          .localeCompare(text(left?.competitionFixtureId ?? left?.id), "pt-BR")
      ))[0] ?? null
  );
  const add = (winner, seasonNumber, source, index) => {
    const clubId = text(winner?.clubId ?? winner?.winnerClubId);
    const competitionId = text(winner?.tournamentId ?? winner?.competitionId ?? winner?.id);
    if (!clubId || !competitionId) return;
    const competition = catalog.competitions.get(key(competitionId));
    const fixture = decisiveFixture(competitionId, clubId);
    const round = nonNegativeInteger(
      winner?.wonRound ?? winner?.round ?? fixture?.calendarRound ?? fixture?.round,
    );
    const occurredAt = timestamp(
      winner?.wonAt ?? winner?.completedAt ?? fixture?.completedAt ?? fixture?.result?.completedAt,
    );
    const coachId = text(winner?.managerId ?? winner?.coachId)
      || coachAtClub(room, clubId, seasonNumber, round, occurredAt);
    if (!coachId) return;
    const isKnockout = ["knockout", "groups_knockout", "groups+knockout"]
      .includes(text(winner?.format ?? competition?.format).toLocaleLowerCase("en-US"));
    const explicitFinalists = uniqueTexts([
      ...list(winner?.finalistClubIds),
      winner?.runnerUpClubId,
      winner?.finalistClubId,
      winner?.secondPlaceClubId,
    ]);
    const fixtureFinalists = fixture
      ? uniqueTexts([fixture.homeClubId, fixture.awayClubId])
      : [];
    const finalistClubIds = isKnockout || explicitFinalists.length > 1
      ? uniqueTexts([clubId, ...explicitFinalists, ...fixtureFinalists])
      : [];
    const finalistCoachIds = finalistClubIds.map((finalistClubId) => coachAtClub(
      room,
      finalistClubId,
      seasonNumber,
      round,
      occurredAt,
    )).map(text).filter(Boolean);
    records.push({
      id: stableId("coach-title", seasonNumber, competitionId, clubId),
      coachId,
      clubId,
      competitionId,
      competitionName: text(winner?.competitionName ?? winner?.tournamentName ?? winner?.name)
        || competition?.name
        || null,
      seasonNumber: integer(seasonNumber),
      round,
      occurredAt,
      source,
      sourceId: text(winner?.id) || `${source}-${index}`,
      format: text(winner?.format ?? competition?.format) || null,
      finalistClubIds,
      finalistCoachIds,
      runnerUpClubId: finalistClubIds.find((finalistClubId) => key(finalistClubId) !== key(clubId)) ?? null,
    });
  };
  for (const [index, winner] of list(room?.competitionSeason?.winners).entries()) {
    add(winner, integer(room?.currentSeason), "current", index);
  }
  for (const [seasonIndex, season] of list(room?.seasonHistory).entries()) {
    const seasonNumber = integer(season?.seasonNumber) ?? seasonIndex + 1;
    for (const [index, winner] of list(season?.tournamentWinners).entries()) {
      add(winner, seasonNumber, "archive", index);
    }
  }
  for (const [index, winner] of [
    ...list(room?.competitionWinners),
    ...list(room?.tournamentWinners),
  ].entries()) {
    add(winner, integer(winner?.seasonNumber ?? winner?.season), "legacy", index);
  }
  for (const event of list(room?.clubCareerState?.events)) {
    if (text(event?.type).toLocaleUpperCase("en-US") !== "COMPETITION_WON") continue;
    add({
      id: event.id,
      clubId: event?.payload?.clubId ?? event?.clubIds?.[0],
      competitionId: event?.competitionId ?? event?.payload?.competitionId,
      competitionName: event?.payload?.competitionName,
      coachId: event?.coachId ?? event?.coachIds?.[0],
      wonAt: event?.occurredAt,
    }, integer(event?.seasonNumber), "career_event", 0);
  }
  return mergeById([], records);
}

function movementRecords(room) {
  const records = [];
  for (const [seasonIndex, season] of list(room?.seasonHistory).entries()) {
    const seasonNumber = integer(season?.seasonNumber) ?? seasonIndex + 1;
    for (const movement of list(season?.promotionMovements)) {
      const clubId = text(movement?.clubId);
      const type = text(movement?.type).toLocaleLowerCase("en-US");
      if (!clubId || !["promotion", "relegation"].includes(type)) continue;
      const coachId = coachAtClubSeasonEnd(room, clubId, seasonNumber, season?.completedAt);
      if (!coachId) continue;
      records.push({
        id: stableId(
          "coach-division-movement",
          seasonNumber,
          clubId,
          type,
          movement?.fromDivisionId,
          movement?.toDivisionId,
        ),
        coachId,
        clubId,
        type,
        seasonNumber,
        occurredAt: timestamp(season?.completedAt),
        fromDivisionId: text(movement?.fromDivisionId) || null,
        toDivisionId: text(movement?.toDivisionId) || null,
        position: integer(movement?.position),
      });
    }
  }
  return records;
}

function careerEventsForAssignment(room, coach, assignment) {
  return list(room?.clubCareerState?.events).filter((event) => {
    const eventCoachIds = uniqueTexts([
      event?.coachId,
      ...list(event?.coachIds),
      event?.payload?.coachId,
    ]);
    if (eventCoachIds.length && !eventCoachIds.includes(text(coach.id))) return false;
    const eventClubIds = uniqueTexts([
      event?.clubId,
      ...list(event?.clubIds),
      event?.payload?.clubId,
      event?.payload?.fromClubId,
      event?.payload?.toClubId,
    ]);
    if (eventClubIds.length && !eventClubIds.some((clubId) => key(clubId) === key(assignment.clubId))) {
      return false;
    }
    return assignmentIncludes(
      assignment,
      event?.seasonNumber,
      event?.round,
      timestamp(event?.occurredAt),
    );
  });
}

function assignmentDevelopment(room, coach, assignment) {
  const previous = object(assignment?.development);
  const relevant = careerEventsForAssignment(room, coach, assignment);
  const promotedPlayers = new Set(list(previous.youthPlayerIds).map(text).filter(Boolean));
  const signings = new Map(list(previous.signings).map((entry) => [text(entry?.id), clone(entry)]).filter(([id]) => id));
  const sales = new Map(list(previous.sales).map((entry) => [text(entry?.id), clone(entry)]).filter(([id]) => id));
  for (const event of relevant) {
    const type = text(event?.type).toLocaleUpperCase("en-US");
    const payload = object(event?.payload);
    const playerId = text(payload.playerId ?? event?.playerIds?.[0]);
    if (type === "YOUTH_PROMOTED" && playerId) promotedPlayers.add(playerId);
    if (type !== "TRANSFER_COMPLETED") continue;
    const record = {
      id: text(event?.id) || stableId("coach-transfer-development", coach.id, event?.operationId),
      playerId: playerId || null,
      playerName: text(payload.playerName) || null,
      occurredAt: timestamp(event?.occurredAt),
      amount: finite(payload.amount ?? event?.amount),
      fromClubId: text(payload.fromClubId) || null,
      toClubId: text(payload.toClubId) || null,
    };
    if (key(record.toClubId) === key(assignment.clubId)) signings.set(record.id, record);
    if (key(record.fromClubId) === key(assignment.clubId)) sales.set(record.id, record);
  }
  return {
    youthPromoted: promotedPlayers.size,
    youthPlayerIds: [...promotedPlayers],
    signings: [...signings.values()].sort(compareChronological),
    sales: [...sales.values()].sort(compareChronological),
    squadValueStart: finite(previous.squadValueStart),
    squadValueEnd: finite(previous.squadValueEnd),
  };
}

function reputationRecords(coach) {
  const generated = [];
  for (const [index, entry] of [
    ...list(coach?.careerConductHistory),
    ...list(coach?.reputationHistory),
  ].entries()) {
    if (!entry || typeof entry !== "object") continue;
    const before = finite(entry?.reputationBefore);
    const after = finite(entry?.reputationAfter);
    const delta = finite(entry?.reputationDelta);
    if (before == null && after == null && delta == null) continue;
    generated.push({
      ...clone(entry),
      id: text(entry?.id) || stableId(
        "coach-reputation-history",
        coach.id,
        entry?.type,
        entry?.occurredAt,
        entry?.operationId,
        index,
      ),
      coachId: coach.id,
      type: text(entry?.type) || "reputation_change",
      occurredAt: timestamp(entry?.occurredAt ?? entry?.createdAt),
      clubId: text(entry?.clubId) || null,
      seasonNumber: integer(entry?.seasonNumber),
      reputationBefore: before,
      reputationAfter: after,
      reputationDelta: delta ?? (before != null && after != null ? after - before : null),
      reasonCode: text(entry?.reasonCode) || null,
      reasonLabel: text(entry?.reasonLabel) || null,
    });
  }
  return mergeById(coach?.careerReputationHistory, generated).sort(compareChronological);
}

function negotiationRecords(state, coach) {
  const generated = [];
  for (const proposal of list(state?.proposals).filter((candidate) => text(candidate?.coachId) === text(coach.id))) {
    const base = {
      coachId: coach.id,
      sourceType: "proposal",
      sourceId: text(proposal?.id) || null,
      proposalId: text(proposal?.id) || null,
      clubId: text(proposal?.clubId ?? proposal?.offeringClubId) || null,
      kind: text(proposal?.kind ?? proposal?.proposalType) || "hiring",
      status: text(proposal?.status) || null,
      outcome: text(proposal?.closedReason ?? proposal?.responseReason) || null,
      terms: {
        salary: finite(proposal?.wage ?? proposal?.salary),
        durationYears: finite(proposal?.durationYears ?? proposal?.years),
        signingBonus: finite(proposal?.signingBonus),
        terminationClause: finite(proposal?.terminationClause),
        transferBudget: finite(proposal?.transferBudget),
        clauses: list(proposal?.specialClauses ?? proposal?.clauses).map(clone),
        objectives: list(proposal?.objectives).map(clone),
      },
    };
    generated.push({
      ...base,
      id: stableId("coach-negotiation", coach.id, "proposal", proposal?.id, "opened"),
      action: "proposal_opened",
      occurredAt: timestamp(proposal?.createdAt ?? proposal?.updatedAt),
      justification: text(proposal?.message) || null,
      operationId: text(proposal?.operationId) || null,
    });
    for (const [index, decision] of list(proposal?.decisionHistory).entries()) {
      generated.push({
        ...base,
        id: text(decision?.id) || stableId(
          "coach-negotiation",
          coach.id,
          "proposal",
          proposal?.id,
          decision?.action,
          decision?.decidedAt,
          index,
        ),
        action: text(decision?.action) || "status_change",
        occurredAt: timestamp(decision?.decidedAt ?? decision?.occurredAt ?? decision?.createdAt),
        previousStatus: text(decision?.previousStatus) || null,
        newStatus: text(decision?.newStatus) || null,
        justification: text(decision?.justification ?? decision?.reason) || null,
        responsibleId: text(decision?.responsibleId ?? decision?.actorId) || null,
        responsibleRole: text(decision?.responsibleRole ?? decision?.actorRole) || null,
        negotiatedValues: Object.keys(object(decision?.negotiatedValues)).length
          ? clone(object(decision?.negotiatedValues))
          : null,
        conditions: list(decision?.conditions).map(clone),
        operationId: text(decision?.operationId) || null,
      });
    }
  }
  for (const interview of list(state?.interviews).filter((candidate) => text(candidate?.coachId) === text(coach.id))) {
    const base = {
      coachId: coach.id,
      sourceType: "interview",
      sourceId: text(interview?.id) || null,
      interviewId: text(interview?.id) || null,
      proposalId: text(interview?.proposalId) || null,
      clubId: text(interview?.clubId) || null,
      kind: "interview",
      status: text(interview?.status) || null,
      outcome: text(interview?.closedReason) || text(interview?.evaluation?.recommendation) || null,
    };
    generated.push({
      ...base,
      id: stableId("coach-negotiation", coach.id, "interview", interview?.id, "lifecycle"),
      action: `interview_${text(interview?.status) || "pending"}`,
      occurredAt: timestamp(interview?.completedAt ?? interview?.scheduledAt),
      justification: text(interview?.memorySummary ?? interview?.evaluation?.summary) || null,
      evaluation: interview?.evaluation ? clone(interview.evaluation) : null,
      operationId: text(interview?.operationId) || null,
    });
    for (const [index, decision] of list(interview?.decisionHistory).entries()) {
      generated.push({
        ...base,
        id: text(decision?.id) || stableId(
          "coach-negotiation",
          coach.id,
          "interview",
          interview?.id,
          decision?.action,
          decision?.decidedAt,
          index,
        ),
        action: text(decision?.action) || "interview_status_change",
        occurredAt: timestamp(decision?.decidedAt ?? decision?.occurredAt ?? decision?.createdAt),
        previousStatus: text(decision?.previousStatus) || null,
        newStatus: text(decision?.newStatus) || null,
        justification: text(decision?.justification ?? decision?.reason) || null,
        responsibleId: text(decision?.responsibleId ?? decision?.actorId) || null,
        responsibleRole: text(decision?.responsibleRole ?? decision?.actorRole) || null,
        operationId: text(decision?.operationId) || null,
      });
    }
  }
  return mergeById(coach?.negotiationHistory, generated).sort(compareChronological);
}

function assignmentReputation(assignment, history, active, currentReputation) {
  const records = history.filter((entry) => {
    if (entry.clubId && key(entry.clubId) !== key(assignment.clubId)) return false;
    return assignmentIncludes(assignment, entry.seasonNumber, entry.round, entry.occurredAt);
  });
  return {
    reputationStart: finite(assignment?.reputationStart) ?? records.find((entry) => entry.reputationBefore != null)
      ?.reputationBefore ?? null,
    reputationEnd: finite(assignment?.reputationEnd) ?? records.findLast((entry) => entry.reputationAfter != null)
      ?.reputationAfter ?? (active ? currentReputation : null),
  };
}

function assignmentRecord(room, state, catalog, coach, value, matches, titles, movements, reputation) {
  const id = assignmentId(coach.id, value);
  const club = catalog.clubs.get(key(value?.clubId));
  const assignment = {
    ...clone(value),
    id,
    clubId: text(value?.clubId),
    clubName: text(value?.clubName) || club?.name || null,
    country: text(value?.country) || club?.country || null,
    division: text(value?.division) || club?.division || null,
    divisionId: text(value?.divisionId) || club?.divisionId || null,
    competitionId: text(value?.competitionId) || club?.competitionId || null,
    competitionName: text(value?.competitionName) || club?.competitionName || null,
    startedAt: timestamp(value?.startedAt),
    endedAt: timestamp(value?.endedAt),
    startedSeason: integer(value?.startedSeason),
    startedRound: nonNegativeInteger(value?.startedRound),
    endedSeason: integer(value?.endedSeason),
    endedRound: nonNegativeInteger(value?.endedRound),
    durationDays: durationDays(value?.startedAt, value?.endedAt),
  };
  const relevantMatches = matches.filter((match) => match.assignmentId === id);
  const computed = matchStatistics(relevantMatches);
  const active = assignment.endedSeason == null && !assignment.endedAt;
  const statistics = relevantMatches.length > 0
    ? computed
    : storedMatchStatistics(assignment)
      ?? (active ? computed : {
        matches: null,
        wins: null,
        draws: null,
        losses: null,
        goalsFor: null,
        goalsAgainst: null,
        goalDifference: null,
        points: null,
        pointsPerGame: null,
        winRate: null,
        longestWinningStreak: null,
        longestWinlessStreak: null,
      });
  const contracts = assignmentContracts(state, coach, assignment);
  const renewals = assignmentRenewals(assignment, contracts);
  const assignmentTitles = mergeById(
    assignment?.titles,
    titles.filter((title) => (
      title.coachId === coach.id
      && key(title.clubId) === key(assignment.clubId)
      && assignmentIncludes(assignment, title.seasonNumber, title.round, title.occurredAt)
    )),
  ).sort(compareChronological);
  const assignmentMovements = mergeById(
    assignment?.movements,
    movements.filter((movement) => (
      movement.coachId === coach.id
      && key(movement.clubId) === key(assignment.clubId)
      && assignmentIncludes(assignment, movement.seasonNumber, null, movement.occurredAt)
    )),
  ).sort(compareChronological);
  const rep = assignmentReputation(
    assignment,
    reputation,
    active,
    finite(coach?.reputation ?? coach?.marketReputation),
  );
  return {
    ...assignment,
    ...statistics,
    metrics: clone(statistics),
    statisticsCoverage: {
      trackedMatches: relevantMatches.length,
      complete: null,
    },
    contractStartAt: contracts[0]?.startDate ?? assignment.contractStartAt ?? null,
    contractEndAt: contracts.at(-1)?.endDate ?? assignment.contractEndAt ?? null,
    initialSalary: contracts[0]?.salary ?? finite(assignment.initialSalary),
    finalSalary: contracts.at(-1)?.salary ?? finite(assignment.finalSalary),
    contracts,
    contractIds: contracts.map((contract) => contract.id),
    renewals,
    titles: assignmentTitles,
    titleEntries: clone(assignmentTitles),
    movements: assignmentMovements,
    promotions: assignmentMovements.filter((entry) => entry.type === "promotion").length,
    relegations: assignmentMovements.filter((entry) => entry.type === "relegation").length,
    achievements: {
      titles: assignmentTitles.length,
      titleEntries: clone(assignmentTitles),
      promotions: assignmentMovements.filter((entry) => entry.type === "promotion").length,
      relegations: assignmentMovements.filter((entry) => entry.type === "relegation").length,
    },
    development: assignmentDevelopment(room, coach, assignment),
    ...rep,
  };
}

function lifecycleTimeline(coach) {
  const generated = [];
  for (const assignment of list(coach?.assignments)) {
    generated.push({
      id: stableId("coach-timeline", coach.id, assignment.id, "assignment-start"),
      coachId: coach.id,
      type: "ASSIGNMENT_STARTED",
      occurredAt: assignment.startedAt,
      seasonNumber: assignment.startedSeason,
      round: assignment.startedRound,
      clubId: assignment.clubId,
      country: assignment.country,
      division: assignment.division,
      title: "Inicio no clube",
      description: assignment.entryReason || null,
      reputationDelta: null,
      assignmentId: assignment.id,
    });
    if (assignment.endedAt || assignment.endedSeason != null) {
      generated.push({
        id: stableId("coach-timeline", coach.id, assignment.id, "assignment-end"),
        coachId: coach.id,
        type: "ASSIGNMENT_ENDED",
        occurredAt: assignment.endedAt,
        seasonNumber: assignment.endedSeason,
        round: assignment.endedRound,
        clubId: assignment.clubId,
        country: assignment.country,
        division: assignment.division,
        title: "Fim no clube",
        description: assignment.exitReason || null,
        reputationDelta: null,
        assignmentId: assignment.id,
      });
    }
    for (const renewal of list(assignment.renewals)) {
      generated.push({
        id: stableId("coach-timeline", coach.id, renewal.id, "renewal"),
        coachId: coach.id,
        type: "CONTRACT_RENEWED",
        occurredAt: renewal.occurredAt,
        clubId: assignment.clubId,
        country: assignment.country,
        division: assignment.division,
        title: "Contrato renovado",
        description: null,
        reputationDelta: null,
        assignmentId: assignment.id,
        metadata: { contractId: renewal.contractId, previousContractId: renewal.previousContractId },
      });
    }
    for (const title of list(assignment.titles)) {
      generated.push({
        id: stableId("coach-timeline", coach.id, title.id, "title"),
        coachId: coach.id,
        type: "TITLE_WON",
        occurredAt: title.occurredAt,
        seasonNumber: title.seasonNumber,
        round: title.round,
        clubId: assignment.clubId,
        country: assignment.country,
        division: assignment.division,
        title: "Titulo conquistado",
        description: title.competitionName,
        reputationDelta: null,
        assignmentId: assignment.id,
        metadata: { competitionId: title.competitionId },
      });
    }
    for (const movement of list(assignment.movements)) {
      generated.push({
        id: stableId("coach-timeline", coach.id, movement.id, movement.type),
        coachId: coach.id,
        type: movement.type === "promotion" ? "PROMOTION" : "RELEGATION",
        occurredAt: movement.occurredAt,
        seasonNumber: movement.seasonNumber,
        clubId: assignment.clubId,
        country: assignment.country,
        division: assignment.division,
        title: movement.type === "promotion" ? "Acesso conquistado" : "Rebaixamento",
        description: null,
        reputationDelta: null,
        assignmentId: assignment.id,
        metadata: {
          fromDivisionId: movement.fromDivisionId,
          toDivisionId: movement.toDivisionId,
          position: movement.position,
        },
      });
    }
  }
  for (const final of list(coach?.careerFinalHistory).filter((entry) => entry?.won !== true)) {
    generated.push({
      id: stableId("coach-timeline", coach.id, final.id, "final-lost"),
      coachId: coach.id,
      type: "FINAL_LOST",
      occurredAt: final.occurredAt,
      seasonNumber: final.seasonNumber,
      round: final.round,
      clubId: final.clubId,
      title: "Vice-campeonato",
      description: final.competitionName,
      reputationDelta: null,
      metadata: {
        competitionId: final.competitionId,
        winnerClubId: final.winnerClubId,
      },
    });
  }
  for (const reputation of list(coach?.careerReputationHistory)) {
    generated.push({
      id: stableId("coach-timeline", coach.id, reputation.id, "reputation"),
      coachId: coach.id,
      type: "REPUTATION_CHANGED",
      occurredAt: reputation.occurredAt,
      seasonNumber: reputation.seasonNumber,
      clubId: reputation.clubId,
      title: "Reputacao alterada",
      description: reputation.reasonLabel ?? reputation.reasonCode,
      reputationDelta: reputation.reputationDelta,
      metadata: {
        reputationBefore: reputation.reputationBefore,
        reputationAfter: reputation.reputationAfter,
      },
    });
  }
  for (const negotiation of list(coach?.negotiationHistory)) {
    generated.push({
      id: stableId("coach-timeline", coach.id, negotiation.id, "negotiation"),
      coachId: coach.id,
      type: "NEGOTIATION",
      occurredAt: negotiation.occurredAt,
      clubId: negotiation.clubId,
      title: negotiation.sourceType === "interview" ? "Entrevista" : "Negociacao",
      description: negotiation.action,
      reputationDelta: null,
      metadata: {
        sourceType: negotiation.sourceType,
        sourceId: negotiation.sourceId,
        status: negotiation.status,
        outcome: negotiation.outcome,
      },
    });
  }
  return mergeById(coach?.careerTimeline, generated).sort(compareChronological);
}

function unemploymentPeriods(coach, now) {
  const assignments = [...list(coach?.assignments)].sort((left, right) => (
    compareChronological(
      { occurredAt: left?.startedAt, seasonNumber: left?.startedSeason, round: left?.startedRound, id: left?.id },
      { occurredAt: right?.startedAt, seasonNumber: right?.startedSeason, round: right?.startedRound, id: right?.id },
    )
  ));
  const generated = [];
  for (let index = 0; index < assignments.length; index += 1) {
    const current = assignments[index];
    if (current.endedSeason == null && !current.endedAt) continue;
    const next = assignments[index + 1];
    const ongoing = !next && text(coach?.status) === "unemployed";
    if (!next && !ongoing) continue;
    const startedAt = timestamp(current.endedAt);
    const endedAt = timestamp(next?.startedAt) ?? (ongoing ? null : null);
    const periodEnd = endedAt ?? (ongoing ? now : null);
    const negotiations = list(coach?.negotiationHistory).filter((entry) => {
      const eventTime = Date.parse(entry?.occurredAt ?? "");
      const startTime = Date.parse(startedAt ?? "");
      const endTime = Date.parse(periodEnd ?? "");
      if (!Number.isFinite(eventTime) || !Number.isFinite(startTime)) return false;
      return eventTime >= startTime && (!Number.isFinite(endTime) || eventTime <= endTime);
    });
    generated.push({
      id: stableId("coach-unemployment", coach.id, current.id, next?.id ?? "ongoing"),
      coachId: coach.id,
      startedAt,
      endedAt,
      startedSeason: current.endedSeason,
      endedSeason: next?.startedSeason ?? null,
      durationDays: durationDays(startedAt, periodEnd),
      ongoing,
      reason: current.exitReason || null,
      previousClubId: current.clubId,
      nextClubId: next?.clubId ?? null,
      interviews: new Set(negotiations
        .filter((entry) => entry.sourceType === "interview")
        .map((entry) => entry.interviewId ?? entry.sourceId)
        .filter(Boolean)).size,
      proposals: new Set(negotiations.map((entry) => entry.proposalId).filter(Boolean)).size,
      refusals: negotiations.filter((entry) => (
        /reject|recus|declin|withdraw|expir/u.test(
          `${entry.action ?? ""} ${entry.outcome ?? ""}`.toLocaleLowerCase("pt-BR"),
        )
      )).length,
    });
  }
  if (!assignments.length && text(coach?.status) === "unemployed") {
    const startedAt = timestamp(
      coach?.unemployedSince
      ?? coach?.availableAt
      ?? coach?.marketRestriction?.startsAt,
    );
    if (startedAt) {
      generated.push({
        id: stableId("coach-unemployment", coach.id, "initial", startedAt),
        coachId: coach.id,
        startedAt,
        endedAt: null,
        startedSeason: null,
        endedSeason: null,
        durationDays: durationDays(startedAt, now),
        ongoing: true,
        reason: null,
        previousClubId: null,
        nextClubId: null,
        interviews: new Set(list(coach?.negotiationHistory)
          .filter((entry) => entry.sourceType === "interview")
          .map((entry) => entry.interviewId ?? entry.sourceId)
          .filter(Boolean)).size,
        proposals: new Set(list(coach?.negotiationHistory).map((entry) => entry.proposalId).filter(Boolean)).size,
        refusals: 0,
      });
    }
  }
  return mergeById(coach?.unemploymentPeriods, generated).sort(compareChronological);
}

function careerSummary(coach, now) {
  const matches = mergeById([], coach?.careerMatchHistory).sort(compareChronological);
  const statistics = matchStatistics(matches);
  const assignments = list(coach?.assignments);
  const titles = mergeById([], assignments.flatMap((assignment) => list(assignment?.titles)));
  const movements = mergeById([], assignments.flatMap((assignment) => list(assignment?.movements)));
  const finals = mergeById([], coach?.careerFinalHistory);
  const negotiations = list(coach?.negotiationHistory);
  const unemployment = list(coach?.unemploymentPeriods);
  const knownTenures = assignments.map((assignment) => (
    durationDays(assignment.startedAt, assignment.endedAt ?? (
      assignment.endedSeason == null ? now : null
    ))
  )).filter((value) => value != null);
  const seasons = new Set(matches.map((match) => integer(match?.seasonNumber)).filter((value) => value != null));
  const clubs = uniqueTexts(assignments.map((assignment) => assignment?.clubId));
  const countries = uniqueTexts(assignments.map((assignment) => assignment?.country));
  const resignations = assignments.filter((assignment) => (
    /resign|demiss[aã]o volunt|pedido/u.test(
      text(assignment?.exitReason).toLocaleLowerCase("pt-BR"),
    )
  )).length;
  const dismissals = assignments.filter((assignment) => (
    /dismiss|demit|replaced|performance/u.test(
      text(assignment?.exitReason).toLocaleLowerCase("pt-BR"),
    )
  )).length;
  const currentReputation = finite(coach?.reputation ?? coach?.marketReputation);
  const reputationValues = list(coach?.careerReputationHistory)
    .flatMap((entry) => [finite(entry?.reputationBefore), finite(entry?.reputationAfter)])
    .filter((value) => value != null);
  const firstStartedAt = assignments.map((assignment) => timestamp(assignment?.startedAt)).filter(Boolean).sort()[0] ?? null;
  const result = {
    clubs: clubs.length,
    clubIds: clubs,
    countries: countries.length,
    countryNames: countries,
    seasonsPlayed: seasons.size,
    seasonNumbers: [...seasons].sort((left, right) => left - right),
    careerStartedAt: firstStartedAt,
    careerDurationDays: durationDays(firstStartedAt, now),
    averageTenureDays: knownTenures.length
      ? Math.round(knownTenures.reduce((total, value) => total + value, 0) / knownTenures.length)
      : null,
    ...statistics,
    titles: titles.length,
    finals: finals.length,
    finalsWon: finals.filter((entry) => entry.won === true).length,
    promotions: movements.filter((entry) => entry.type === "promotion").length,
    relegations: movements.filter((entry) => entry.type === "relegation").length,
    dismissals,
    resignations,
    renewals: assignments.reduce((total, assignment) => total + list(assignment?.renewals).length, 0),
    interviews: new Set(negotiations
      .filter((entry) => entry.sourceType === "interview")
      .map((entry) => entry.interviewId ?? entry.sourceId)
      .filter(Boolean)).size,
    proposals: new Set(negotiations.map((entry) => entry.proposalId).filter(Boolean)).size,
    acceptedProposals: new Set(negotiations.filter((entry) => (
      /accept|aprovad|agreement|signed/u.test(
        `${entry.action ?? ""} ${entry.newStatus ?? ""} ${entry.status ?? ""}`.toLocaleLowerCase("pt-BR"),
      )
    )).map((entry) => entry.proposalId).filter(Boolean)).size,
    rejectedProposals: new Set(negotiations.filter((entry) => (
      /reject|recus|declin/u.test(
        `${entry.action ?? ""} ${entry.newStatus ?? ""} ${entry.status ?? ""}`.toLocaleLowerCase("pt-BR"),
      )
    )).map((entry) => entry.proposalId).filter(Boolean)).size,
    unemploymentPeriods: unemployment.length,
    unemployedDays: unemployment.reduce((total, period) => total + (period.durationDays ?? 0), 0),
    reputationStart: reputationValues[0] ?? null,
    reputationCurrent: currentReputation,
    reputationPeak: reputationValues.length ? Math.max(...reputationValues) : currentReputation,
    reputationLowest: reputationValues.length ? Math.min(...reputationValues) : currentReputation,
  };
  return {
    ...result,
    clubsManaged: result.clubs,
    countriesWorked: result.countries,
    seasons: result.seasonsPlayed,
    seasonCount: result.seasonsPlayed,
    careerDays: result.careerDurationDays,
    proposalsAccepted: result.acceptedProposals,
    proposalsRejected: result.rejectedProposals,
    unemploymentDays: result.unemployedDays,
  };
}

function reputationSummary(coach) {
  const bySeason = new Map();
  const byCountry = new Map();
  for (const entry of list(coach?.careerReputationHistory)) {
    if (entry.seasonNumber != null) bySeason.set(entry.seasonNumber, entry.reputationAfter ?? entry.reputationBefore);
    const assignment = list(coach?.assignments).find((candidate) => (
      (!entry.clubId || key(candidate.clubId) === key(entry.clubId))
      && assignmentIncludes(candidate, entry.seasonNumber, entry.round, entry.occurredAt)
    ));
    if (assignment?.country) byCountry.set(assignment.country, entry.reputationAfter ?? entry.reputationBefore);
  }
  return {
    current: finite(coach?.reputation ?? coach?.marketReputation),
    seasons: [...bySeason.entries()].map(([seasonNumber, reputation]) => ({ seasonNumber, reputation })),
    countries: [...byCountry.entries()].map(([country, reputation]) => ({ country, reputation })),
  };
}

function financialHistory(coach) {
  return list(coach?.assignments).flatMap((assignment) => list(assignment?.contracts).map((contract) => ({
    id: stableId("coach-financial-history", assignment.id, contract.id),
    type: (contract.renewalCount ?? 0) > 0 ? "renewal_contract" : "contract",
    assignmentId: assignment.id,
    clubId: assignment.clubId,
    contractId: contract.id,
    occurredAt: contract.signedAt ?? contract.startDate,
    startDate: contract.startDate,
    endDate: contract.endDate,
    salary: contract.salary,
    signingBonus: contract.signingBonus,
    terminationClause: contract.terminationClause,
    compensation: contract.compensation,
    status: contract.status,
  }))).sort(compareChronological);
}

function finalHistoryRecords(coach, titles) {
  const generated = list(titles).flatMap((title) => {
    const finalistCoachIds = uniqueTexts(title?.finalistCoachIds);
    if (!finalistCoachIds.includes(text(coach?.id))) return [];
    const won = text(title?.coachId) === text(coach?.id);
    const clubId = won
      ? text(title?.clubId)
      : list(title?.finalistClubIds).map(text).find((finalistClubId) => (
        text(coachAtAssignmentClub(coach, finalistClubId, title)) === text(coach?.id)
      )) ?? null;
    return [{
      id: stableId("coach-final-history", coach.id, title.id),
      coachId: text(coach.id),
      clubId,
      competitionId: text(title?.competitionId) || null,
      competitionName: text(title?.competitionName) || null,
      seasonNumber: integer(title?.seasonNumber),
      round: nonNegativeInteger(title?.round),
      occurredAt: timestamp(title?.occurredAt),
      won,
      winnerClubId: text(title?.clubId) || null,
      runnerUpClubId: text(title?.runnerUpClubId) || null,
    }];
  });
  return mergeById(coach?.careerFinalHistory, generated).sort(compareChronological);
}

function coachAtAssignmentClub(coach, clubId, event) {
  const assignment = list(coach?.assignments).find((candidate) => (
    key(candidate?.clubId) === key(clubId)
    && assignmentIncludes(candidate, event?.seasonNumber, event?.round, event?.occurredAt)
  ));
  return assignment ? coach?.id : null;
}

function synchronizeCoach(room, state, coach, now, catalog, titles, movements) {
  coach.careerHistoryVersion = HISTORY_VERSION;
  coach.careerReputationHistory = reputationRecords(coach);
  coach.negotiationHistory = negotiationRecords(state, coach);
  coach.careerMatchHistory = mergeById(coach?.careerMatchHistory, coachMatchRecords(room, coach))
    .sort(compareChronological);
  const assignmentValues = list(coach?.assignments).map((assignment) => ({
    ...clone(assignment),
    id: assignmentId(coach.id, assignment),
  }));
  coach.assignments = assignmentValues.map((assignment) => assignmentRecord(
    room,
    state,
    catalog,
    coach,
    assignment,
    coach.careerMatchHistory,
    titles,
    movements,
    coach.careerReputationHistory,
  ));
  coach.careerFinalHistory = finalHistoryRecords(coach, titles);
  coach.unemploymentPeriods = unemploymentPeriods(coach, now);
  coach.careerTimeline = lifecycleTimeline(coach);
  coach.careerHistorySummary = careerSummary(coach, now);
  coach.careerHistoryUpdatedAt = now;
  return coach;
}

/**
 * Ingests volatile employment data before retention and writes a permanent,
 * idempotent history into each coach record.
 */
export function synchronizeCoachCareerHistory(room, state = room?.coachEmploymentState, suppliedNow = null) {
  if (!room || typeof room !== "object") return { room, state };
  const employmentState = state && typeof state === "object" ? state : {};
  if (!room.coachCareerState || typeof room.coachCareerState !== "object") {
    room.coachCareerState = { version: 1, coaches: [] };
  }
  if (!Array.isArray(room.coachCareerState.coaches)) room.coachCareerState.coaches = [];
  const now = roomNow(room, suppliedNow);
  const catalog = clubCatalog(room);
  const titles = winnerRecords(room);
  const movements = movementRecords(room);
  for (const coach of room.coachCareerState.coaches) {
    if (!text(coach?.id)) continue;
    synchronizeCoach(room, employmentState, coach, now, catalog, titles, movements);
  }
  employmentState.careerHistoryVersion = HISTORY_VERSION;
  employmentState.careerHistoryUpdatedAt = now;
  if (!room.coachEmploymentState || room.coachEmploymentState === state) {
    room.coachEmploymentState = employmentState;
  }
  return { room, state: employmentState };
}

/**
 * Produces an immutable, UI/AI-ready view. It synchronizes clones so callers
 * never need to mutate a save merely to read a current summary.
 */
export function buildCoachCareerHistorySummary(
  room,
  state = room?.coachEmploymentState,
  coachId,
  suppliedNow = null,
) {
  const roomCopy = clone(room ?? {});
  const stateCopy = clone(state ?? roomCopy?.coachEmploymentState ?? {});
  roomCopy.coachEmploymentState = stateCopy;
  synchronizeCoachCareerHistory(roomCopy, stateCopy, suppliedNow);
  const coach = list(roomCopy?.coachCareerState?.coaches)
    .find((candidate) => text(candidate?.id) === text(coachId));
  if (!coach) return null;
  const assignments = clone(list(coach.assignments));
  const titles = mergeById([], assignments.flatMap((assignment) => list(assignment?.titles)))
    .sort(compareChronological);
  const movements = mergeById([], assignments.flatMap((assignment) => list(assignment?.movements)))
    .sort(compareChronological);
  const achievementEntries = [
    ...titles.map((title) => ({
      id: title.id,
      type: "title",
      occurredAt: title.occurredAt,
      seasonNumber: title.seasonNumber,
      clubId: title.clubId,
      competitionId: title.competitionId,
      label: title.competitionName,
    })),
    ...movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      occurredAt: movement.occurredAt,
      seasonNumber: movement.seasonNumber,
      clubId: movement.clubId,
      competitionId: null,
      label: null,
      fromDivisionId: movement.fromDivisionId,
      toDivisionId: movement.toDivisionId,
    })),
  ].sort(compareChronological);
  const achievementSummary = {
    titles: clone(titles),
    promotions: clone(movements.filter((entry) => entry.type === "promotion")),
    relegations: clone(movements.filter((entry) => entry.type === "relegation")),
    youthPromoted: assignments.reduce(
      (total, assignment) => total + (nonNegativeInteger(assignment?.development?.youthPromoted) ?? 0),
      0,
    ),
  };
  return {
    version: HISTORY_VERSION,
    updatedAt: coach.careerHistoryUpdatedAt ?? roomNow(roomCopy, suppliedNow),
    generatedAt: coach.careerHistoryUpdatedAt ?? roomNow(roomCopy, suppliedNow),
    coachId: text(coach.id),
    coach: {
      id: text(coach.id),
      name: text(coach.name) || text(coach.id),
      managerType: text(coach.managerType) || null,
      status: text(coach.status) || null,
      currentClubId: text(coach.currentClubId) || null,
      reputation: finite(coach.reputation ?? coach.marketReputation),
      professionalTrust: finite(coach.professionalTrust),
    },
    summary: clone(coach.careerHistorySummary),
    assignments,
    spells: clone(assignments),
    timeline: clone(list(coach.careerTimeline)),
    matches: clone(list(coach.careerMatchHistory)),
    titles: clone(titles),
    finals: clone(list(coach.careerFinalHistory)),
    movements: clone(movements),
    negotiationHistory: clone(list(coach.negotiationHistory)),
    negotiations: clone(list(coach.negotiationHistory)),
    reputationHistory: clone(list(coach.careerReputationHistory)),
    reputation: reputationSummary(coach),
    unemploymentPeriods: clone(list(coach.unemploymentPeriods)),
    achievements: achievementSummary,
    achievementEntries: clone(achievementEntries),
    achievementSummary: clone(achievementSummary),
    financialHistory: financialHistory(coach),
  };
}
