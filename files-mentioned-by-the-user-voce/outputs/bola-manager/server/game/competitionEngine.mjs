export const COMPETITION_ENGINE_VERSION = 1;

const DEFAULT_LEAGUE_TIEBREAKERS = Object.freeze([
  "points",
  "wins",
  "goal_difference",
  "goals_scored",
  "head_to_head",
]);

const DEFAULT_KNOCKOUT_TIEBREAKERS = Object.freeze(["extra_time", "penalties"]);

export class CompetitionEngineError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "CompetitionEngineError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details = null) {
  throw new CompetitionEngineError(message, code, details);
}

function text(value) {
  return String(value ?? "").trim();
}

function positiveInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function slug(value, fallback = "competition") {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clone(value) {
  return structuredClone(value);
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeFormat(value) {
  const format = text(value || "league").toLocaleLowerCase("pt-BR");
  if (format === "group_knockout") return "groups_knockout";
  if (["league", "knockout", "groups_knockout"].includes(format)) return format;
  fail("Formato de competicao invalido", "INVALID_FORMAT", { format: value });
}

function normalizeLegs(value) {
  const legs = text(value || "single").toLocaleLowerCase("pt-BR");
  if (legs === "single" || legs === "double") return legs;
  fail("Numero de turnos invalido", "INVALID_LEGS", { legs: value });
}

function normalizeParticipants(definition) {
  const source = Array.isArray(definition.participants)
    ? definition.participants
    : Array.isArray(definition.teamIds) ? definition.teamIds : [];
  const participants = source.map((candidate, index) => {
    const sourceRecord = candidate && typeof candidate === "object" ? candidate : { id: candidate };
    const id = text(sourceRecord.id ?? sourceRecord.clubId);
    if (!id) fail("Participante sem id", "INVALID_PARTICIPANT", { index });
    return {
      id,
      name: text(sourceRecord.name) || id,
      seed: positiveInteger(sourceRecord.seed, index + 1),
    };
  });
  if (participants.length < 2) {
    fail("Competicao exige ao menos dois participantes", "NOT_ENOUGH_PARTICIPANTS");
  }
  const ids = participants.map((participant) => participant.id);
  if (unique(ids).length !== ids.length) {
    fail("Participantes repetidos", "DUPLICATE_PARTICIPANT");
  }
  const configuredCount = positiveInteger(definition.teamCount, participants.length);
  if (configuredCount !== participants.length) {
    fail("teamCount difere dos participantes", "TEAM_COUNT_MISMATCH", {
      teamCount: configuredCount,
      participants: participants.length,
    });
  }
  return participants;
}

function normalizeTiebreakers(definition, format, legs) {
  const defaults = format === "league" ? DEFAULT_LEAGUE_TIEBREAKERS : DEFAULT_KNOCKOUT_TIEBREAKERS;
  const supplied = Array.isArray(definition.tiebreakers) && definition.tiebreakers.length
    ? definition.tiebreakers.map((criterion) => text(criterion).toLocaleLowerCase("pt-BR"))
    : [...defaults];
  const allowed = new Set([
    "points", "wins", "goal_difference", "goals_scored", "head_to_head", "fair_play",
    "away_goals", "extra_time", "penalties", "drawing_lots",
  ]);
  if (supplied.some((criterion) => !allowed.has(criterion))) {
    fail("Criterio de desempate invalido", "INVALID_TIEBREAKER", { tiebreakers: supplied });
  }
  if (unique(supplied).length !== supplied.length) {
    fail("Criterios de desempate repetidos", "DUPLICATE_TIEBREAKER");
  }
  if (supplied.includes("away_goals") && legs !== "double") {
    fail("away_goals exige ida e volta", "AWAY_GOALS_REQUIRES_DOUBLE_LEG");
  }
  return supplied;
}

function validIsoDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeKickoffTimes(value) {
  const source = Array.isArray(value) && value.length ? value : ["19:00", "21:30"];
  const times = source.map((candidate) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text(candidate));
    const hour = match ? Number(match[1]) : -1;
    const minute = match ? Number(match[2]) : -1;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      fail("Horario de jogo invalido", "INVALID_KICKOFF_TIME", { value: candidate });
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  });
  return unique(times);
}

function normalizeSchedule(options, seasonYear) {
  const fallbackStart = `${seasonYear}-07-01T00:00:00.000Z`;
  const start = validIsoDate(options.startDate ?? fallbackStart);
  if (!start) fail("Data inicial invalida", "INVALID_START_DATE", { startDate: options.startDate });
  start.setUTCHours(0, 0, 0, 0);
  return {
    startDate: start.toISOString(),
    roundIntervalDays: positiveInteger(options.roundIntervalDays, 4),
    knockoutLegIntervalDays: positiveInteger(options.knockoutLegIntervalDays, 7),
    knockoutRoundIntervalDays: positiveInteger(options.knockoutRoundIntervalDays, 14),
    kickoffTimes: normalizeKickoffTimes(options.kickoffTimes),
  };
}

function scheduledAt(schedule, calendarRound, matchOrder = 0, extraDays = 0) {
  const kickoffTimes = schedule.kickoffTimes;
  const slot = kickoffTimes[matchOrder % kickoffTimes.length];
  const overflowDays = Math.floor(matchOrder / kickoffTimes.length);
  const [hour, minute] = slot.split(":").map(Number);
  const date = new Date(schedule.startDate);
  date.setUTCDate(date.getUTCDate()
    + ((calendarRound - 1) * schedule.roundIntervalDays)
    + overflowDays
    + extraDays);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

function normalizeDefinition(definition, options) {
  if (!definition || typeof definition !== "object") {
    fail("Definicao de competicao ausente", "INVALID_DEFINITION");
  }
  const id = text(definition.id);
  if (!id) fail("Competicao sem id", "INVALID_COMPETITION_ID");
  const format = normalizeFormat(definition.format);
  const legs = normalizeLegs(definition.legs);
  const participants = normalizeParticipants(definition);
  const seasonYear = positiveInteger(options.seasonYear, positiveInteger(definition.seasonYear, 2026));
  const tiebreakers = normalizeTiebreakers(definition, format, legs);
  return {
    id,
    name: text(definition.name) || id,
    format,
    legs,
    tiebreakers,
    participants,
    seasonNumber: positiveInteger(options.seasonNumber, 1),
    seasonYear,
    schedule: normalizeSchedule(options, seasonYear),
  };
}

function roundRobinPairings(participantIds) {
  const rotation = [...participantIds];
  if (rotation.length % 2 === 1) rotation.push(null);
  const rounds = [];
  for (let roundIndex = 0; roundIndex < rotation.length - 1; roundIndex += 1) {
    const matches = [];
    for (let pairIndex = 0; pairIndex < rotation.length / 2; pairIndex += 1) {
      const left = rotation[pairIndex];
      const right = rotation[rotation.length - 1 - pairIndex];
      if (!left || !right) continue;
      const reverse = pairIndex === 0 && roundIndex % 2 === 1;
      matches.push({
        homeClubId: reverse ? right : left,
        awayClubId: reverse ? left : right,
      });
    }
    rounds.push(matches);
    const last = rotation.pop();
    rotation.splice(1, 0, last);
  }
  return rounds;
}

function createEmptyStandings(participantIds) {
  return participantIds.map((clubId, index) => ({
    position: index + 1,
    clubId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    fairPlay: 0,
  }));
}

function competitionKey(state) {
  return `${slug(state.id)}-${hashText(state.id).toString(36)}`;
}

function fixtureId(state, stageId, round, matchNumber, leg = 1) {
  return `${competitionKey(state)}:s${state.seasonNumber}:${slug(stageId, "stage")}:r${round}:m${matchNumber}:l${leg}`;
}

function registerFixture(state, details) {
  const id = details.id ?? fixtureId(
    state,
    details.stageId,
    details.round,
    details.matchNumber,
    details.leg,
  );
  if (state.fixtures.some((fixture) => fixture.id === id)) return id;
  const fixture = {
    id,
    competitionFixtureId: id,
    competitionId: state.id,
    tournamentId: state.id,
    seasonNumber: state.seasonNumber,
    seasonYear: state.seasonYear,
    stageId: details.stageId,
    stage: details.stageId,
    stageType: details.stageType,
    groupId: details.groupId ?? null,
    tieId: details.tieId ?? null,
    round: details.round,
    calendarRound: details.calendarRound,
    matchNumber: details.matchNumber,
    leg: details.leg ?? 1,
    homeClubId: details.homeClubId,
    awayClubId: details.awayClubId,
    scheduledAt: details.scheduledAt,
    status: "scheduled",
    result: null,
    completedAt: null,
  };
  state.fixtures.push(fixture);
  state.calendar.push(id);
  return id;
}

function addRoundRobinFixtures(state, stage, participantIds, options = {}) {
  const firstLegRounds = roundRobinPairings(participantIds);
  const allRounds = [...firstLegRounds];
  if (state.legs === "double") {
    allRounds.push(...firstLegRounds.map((matches) => matches.map((match) => ({
      homeClubId: match.awayClubId,
      awayClubId: match.homeClubId,
    }))));
  }
  allRounds.forEach((matches, roundIndex) => {
    matches.forEach((match, matchIndex) => {
      const round = roundIndex + 1;
      const matchNumber = (options.matchNumberOffset ?? 0) + matchIndex + 1;
      const id = registerFixture(state, {
        stageId: stage.id,
        stageType: stage.type,
        groupId: options.groupId ?? null,
        round,
        calendarRound: (options.calendarRoundOffset ?? 0) + round,
        matchNumber,
        leg: roundIndex < firstLegRounds.length ? 1 : 2,
        homeClubId: match.homeClubId,
        awayClubId: match.awayClubId,
        scheduledAt: scheduledAt(
          state.schedule,
          (options.calendarRoundOffset ?? 0) + round,
          options.calendarMatchOffset ? options.calendarMatchOffset + matchIndex : matchIndex,
        ),
      });
      stage.fixtureIds.push(id);
      if (options.group) options.group.fixtureIds.push(id);
    });
  });
  return allRounds.length;
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function roundLabel(round, roundCount) {
  const remaining = 2 ** (roundCount - round + 1);
  if (remaining === 2) return "Final";
  if (remaining === 4) return "Semifinal";
  if (remaining === 8) return "Quartas de final";
  if (remaining === 16) return "Oitavas de final";
  return `Fase de ${remaining}`;
}

function seedSource(clubId) {
  return { type: "seed", id: clubId ?? null };
}

function winnerSource(tieId) {
  return { type: "winner", id: tieId };
}

function sourceValue(stage, source) {
  if (source.type === "seed") return { ready: true, clubId: source.id };
  const sourceTie = stage.ties.find((tie) => tie.id === source.id);
  return sourceTie?.status === "completed"
    ? { ready: true, clubId: sourceTie.winnerClubId }
    : { ready: false, clubId: null };
}

function createKnockoutStage(state, participantIds, options = {}) {
  if (participantIds.length < 2) fail("Mata-mata exige dois classificados", "NOT_ENOUGH_QUALIFIERS");
  const stageId = options.stageId ?? "knockout";
  const bracketSize = nextPowerOfTwo(participantIds.length);
  const roundCount = Math.log2(bracketSize);
  const seeds = [...participantIds, ...Array(bracketSize - participantIds.length).fill(null)];
  const stage = {
    id: stageId,
    type: "knockout",
    status: "active",
    startCalendarRound: positiveInteger(options.startCalendarRound, 1),
    fixtureIds: [],
    rounds: [],
    ties: [],
  };

  for (let round = 1; round <= roundCount; round += 1) {
    const tieCount = bracketSize / (2 ** round);
    const roundRecord = {
      number: round,
      name: roundLabel(round, roundCount),
      tieIds: [],
    };
    for (let order = 1; order <= tieCount; order += 1) {
      const tieId = `${competitionKey(state)}:s${state.seasonNumber}:${slug(stageId)}:r${round}:t${order}`;
      let homeSource;
      let awaySource;
      if (round === 1) {
        homeSource = seedSource(seeds[order - 1]);
        awaySource = seedSource(seeds[bracketSize - order]);
      } else {
        const previousBase = (order - 1) * 2;
        const previousRound = stage.rounds[round - 2];
        homeSource = winnerSource(previousRound.tieIds[previousBase]);
        awaySource = winnerSource(previousRound.tieIds[previousBase + 1]);
      }
      stage.ties.push({
        id: tieId,
        round,
        order,
        homeSource,
        awaySource,
        homeClubId: null,
        awayClubId: null,
        fixtureIds: [],
        status: "pending",
        winnerClubId: null,
        aggregate: null,
        decidedBy: null,
      });
      roundRecord.tieIds.push(tieId);
    }
    stage.rounds.push(roundRecord);
  }
  state.stages.push(stage);
  materializeKnockout(state, stage);
  return stage;
}

function knockoutCalendarRound(state, stage, tie, leg) {
  const base = stage.startCalendarRound;
  if (state.legs === "single") return base + tie.round - 1;
  const daysPerCalendarRound = state.schedule.roundIntervalDays;
  const roundGap = Math.max(1, Math.ceil(state.schedule.knockoutRoundIntervalDays / daysPerCalendarRound));
  const legGap = Math.max(0, Math.ceil(state.schedule.knockoutLegIntervalDays / daysPerCalendarRound));
  return base + ((tie.round - 1) * roundGap) + ((leg - 1) * legGap);
}

function materializeKnockout(state, stage) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const tie of stage.ties) {
      if (tie.status !== "pending") continue;
      const home = sourceValue(stage, tie.homeSource);
      const away = sourceValue(stage, tie.awaySource);
      if (!home.ready || !away.ready) continue;
      tie.homeClubId = home.clubId;
      tie.awayClubId = away.clubId;
      if (!home.clubId && !away.clubId) {
        tie.status = "void";
        changed = true;
        continue;
      }
      if (!home.clubId || !away.clubId) {
        tie.status = "completed";
        tie.winnerClubId = home.clubId || away.clubId;
        tie.decidedBy = "bye";
        changed = true;
        continue;
      }

      const legCount = state.legs === "double" ? 2 : 1;
      for (let leg = 1; leg <= legCount; leg += 1) {
        const homeClubId = leg === 1 ? home.clubId : away.clubId;
        const awayClubId = leg === 1 ? away.clubId : home.clubId;
        const calendarRound = knockoutCalendarRound(state, stage, tie, leg);
        const id = registerFixture(state, {
          stageId: stage.id,
          stageType: stage.type,
          tieId: tie.id,
          round: tie.round,
          calendarRound,
          matchNumber: tie.order,
          leg,
          homeClubId,
          awayClubId,
          scheduledAt: scheduledAt(state.schedule, calendarRound, tie.order - 1),
        });
        tie.fixtureIds.push(id);
        stage.fixtureIds.push(id);
      }
      tie.status = "active";
      changed = true;
    }
  }
}

function normalizeScore(value, field) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const score = value.map((goal) => nonNegativeInteger(goal));
  if (score.some((goal) => goal === null)) fail(`${field} invalido`, "INVALID_SCORE", { field, value });
  return score;
}

function normalizePossession(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== 2) {
    fail("Posse invalida", "INVALID_POSSESSION", { field: "possession", value });
  }
  const possession = value.map(Number);
  if (possession.some((item) => !Number.isFinite(item) || item < 0 || item > 100)) {
    fail("Posse invalida", "INVALID_POSSESSION", { field: "possession", value });
  }
  return possession.map((item) => Math.round(item * 10) / 10);
}

function normalizeResult(result) {
  if (!result || typeof result !== "object") fail("Resultado ausente", "INVALID_RESULT");
  const score = normalizeScore(
    result.score ?? [result.homeGoals, result.awayGoals],
    "score",
  );
  if (!score) fail("Placar invalido", "INVALID_SCORE");
  const extraTime = result.extraTime == null && result.extraTimeScore == null
    ? null
    : normalizeScore(result.extraTime ?? result.extraTimeScore, "extraTime");
  const penalties = result.penalties == null
    ? null
    : normalizeScore(result.penalties, "penalties");
  const fairPlay = result.fairPlay == null
    ? [0, 0]
    : normalizeScore(result.fairPlay, "fairPlay");
  const possession = normalizePossession(result.possession);
  return {
    score,
    extraTime,
    penalties,
    fairPlay,
    possession,
    winnerClubId: text(result.winnerClubId) || null,
  };
}

function mapFixtureScoreToTie(fixture, tie, score) {
  return fixture.homeClubId === tie.homeClubId ? score : [score[1], score[0]];
}

function resolveTie(state, stage, tie) {
  const fixtures = tie.fixtureIds.map((id) => state.fixtures.find((fixture) => fixture.id === id));
  if (fixtures.some((fixture) => !fixture || fixture.status !== "completed")) return false;
  const aggregate = [0, 0];
  const awayGoals = [0, 0];
  for (const fixture of fixtures) {
    const mapped = mapFixtureScoreToTie(fixture, tie, fixture.result.score);
    aggregate[0] += mapped[0];
    aggregate[1] += mapped[1];
    if (fixture.awayClubId === tie.homeClubId) awayGoals[0] += fixture.result.score[1];
    if (fixture.awayClubId === tie.awayClubId) awayGoals[1] += fixture.result.score[1];
  }
  tie.aggregate = aggregate;
  let winnerIndex = aggregate[0] === aggregate[1] ? null : aggregate[0] > aggregate[1] ? 0 : 1;
  let decidedBy = "aggregate";
  const decisiveFixture = fixtures.at(-1);

  if (winnerIndex === null) {
    for (const criterion of state.tiebreakers) {
      if (criterion === "away_goals" && awayGoals[0] !== awayGoals[1]) {
        winnerIndex = awayGoals[0] > awayGoals[1] ? 0 : 1;
        decidedBy = "away_goals";
        break;
      }
      if (criterion === "extra_time" && decisiveFixture.result.extraTime) {
        const extra = mapFixtureScoreToTie(decisiveFixture, tie, decisiveFixture.result.extraTime);
        if (extra[0] !== extra[1]) {
          winnerIndex = extra[0] > extra[1] ? 0 : 1;
          decidedBy = "extra_time";
          break;
        }
      }
      if (criterion === "penalties" && decisiveFixture.result.penalties) {
        const penalties = mapFixtureScoreToTie(decisiveFixture, tie, decisiveFixture.result.penalties);
        if (penalties[0] !== penalties[1]) {
          winnerIndex = penalties[0] > penalties[1] ? 0 : 1;
          decidedBy = "penalties";
          break;
        }
      }
      if (criterion === "drawing_lots") {
        winnerIndex = hashText(`${state.id}:${state.seasonNumber}:${tie.id}`) % 2;
        decidedBy = "drawing_lots";
        break;
      }
    }
  }

  if (winnerIndex === null && decisiveFixture.result.winnerClubId) {
    const explicit = decisiveFixture.result.winnerClubId;
    if (explicit !== tie.homeClubId && explicit !== tie.awayClubId) {
      fail("Vencedor nao participa do confronto", "INVALID_TIE_WINNER", { tieId: tie.id });
    }
    winnerIndex = explicit === tie.homeClubId ? 0 : 1;
    decidedBy = "explicit";
  }
  if (winnerIndex === null) {
    fail("Desempate obrigatorio para concluir confronto", "TIEBREAK_REQUIRED", { tieId: tie.id });
  }
  tie.winnerClubId = winnerIndex === 0 ? tie.homeClubId : tie.awayClubId;
  tie.decidedBy = decidedBy;
  tie.status = "completed";
  materializeKnockout(state, stage);
  return true;
}

function fixtureRows(participantIds, fixtures) {
  const rows = new Map(createEmptyStandings(participantIds).map((row) => [row.clubId, row]));
  for (const fixture of fixtures) {
    if (fixture.status !== "completed") continue;
    const home = rows.get(fixture.homeClubId);
    const away = rows.get(fixture.awayClubId);
    if (!home || !away) continue;
    const [homeGoals, awayGoals] = fixture.result.score;
    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;
    home.fairPlay += fixture.result.fairPlay[0];
    away.fairPlay += fixture.result.fairPlay[1];
    if (homeGoals > awayGoals) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (awayGoals > homeGoals) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }
  for (const row of rows.values()) row.goalDifference = row.goalsFor - row.goalsAgainst;
  return rows;
}

function headToHead(left, right, fixtures) {
  const matches = fixtures.filter((fixture) => fixture.status === "completed" && (
    (fixture.homeClubId === left && fixture.awayClubId === right)
    || (fixture.homeClubId === right && fixture.awayClubId === left)
  ));
  const rows = fixtureRows([left, right], matches);
  return [rows.get(left), rows.get(right)];
}

function compareCriterion(left, right, criterion, fixtures, competitionId) {
  if (criterion === "points") return right.points - left.points;
  if (criterion === "wins") return right.wins - left.wins;
  if (criterion === "goal_difference") return right.goalDifference - left.goalDifference;
  if (criterion === "goals_scored") return right.goalsFor - left.goalsFor;
  if (criterion === "fair_play") return left.fairPlay - right.fairPlay;
  if (criterion === "head_to_head") {
    const [leftHead, rightHead] = headToHead(left.clubId, right.clubId, fixtures);
    return (rightHead.points - leftHead.points)
      || (rightHead.goalDifference - leftHead.goalDifference)
      || (rightHead.goalsFor - leftHead.goalsFor);
  }
  if (criterion === "drawing_lots") {
    return hashText(`${competitionId}:${left.clubId}`) - hashText(`${competitionId}:${right.clubId}`);
  }
  return 0;
}

function calculateStandings(participantIds, fixtures, tiebreakers, competitionId) {
  const seedOrder = new Map(participantIds.map((clubId, index) => [clubId, index]));
  const rows = [...fixtureRows(participantIds, fixtures).values()];
  const criteria = unique(["points", ...tiebreakers]);
  rows.sort((left, right) => {
    for (const criterion of criteria) {
      const comparison = compareCriterion(left, right, criterion, fixtures, competitionId);
      if (comparison) return comparison;
    }
    return seedOrder.get(left.clubId) - seedOrder.get(right.clubId)
      || left.clubId.localeCompare(right.clubId, "pt-BR");
  });
  rows.forEach((row, index) => { row.position = index + 1; });
  return rows;
}

function refreshLeague(state, stage) {
  const fixtures = stage.fixtureIds.map((id) => state.fixtures.find((fixture) => fixture.id === id));
  stage.standings = calculateStandings(stage.participantIds, fixtures, state.tiebreakers, state.id);
  if (fixtures.every((fixture) => fixture.status === "completed")) {
    stage.status = "completed";
    state.status = "completed";
    state.winnerClubId = stage.standings[0]?.clubId ?? null;
  } else if (fixtures.some((fixture) => fixture.status === "completed")) {
    stage.status = "active";
    state.status = "active";
  }
}

function defaultGroupCount(teamCount) {
  return Math.min(Math.floor(teamCount / 2), Math.max(2, Math.floor(teamCount / 4)));
}

function distributeGroups(participantIds, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  participantIds.forEach((clubId, index) => {
    const cycle = Math.floor(index / groupCount);
    const offset = index % groupCount;
    const groupIndex = cycle % 2 === 0 ? offset : groupCount - 1 - offset;
    groups[groupIndex].push(clubId);
  });
  return groups;
}

function createGroupStage(state, definition) {
  const participantIds = state.participants.map((participant) => participant.id);
  const groupCount = positiveInteger(definition.groupCount, defaultGroupCount(participantIds.length));
  if (groupCount < 2 || groupCount > Math.floor(participantIds.length / 2)) {
    fail("Quantidade de grupos invalida", "INVALID_GROUP_COUNT", { groupCount });
  }
  const distributed = distributeGroups(participantIds, groupCount);
  const smallestGroup = Math.min(...distributed.map((group) => group.length));
  const qualifiersPerGroup = positiveInteger(definition.qualifiersPerGroup, Math.min(2, smallestGroup - 1));
  if (qualifiersPerGroup < 1 || qualifiersPerGroup >= smallestGroup) {
    fail("Numero de classificados por grupo invalido", "INVALID_GROUP_QUALIFIERS", {
      qualifiersPerGroup,
      smallestGroup,
    });
  }
  const stage = {
    id: "groups",
    type: "groups",
    status: "active",
    qualifiersPerGroup,
    fixtureIds: [],
    groups: distributed.map((clubIds, index) => ({
      id: `group-${String.fromCharCode(65 + index)}`,
      name: `Grupo ${String.fromCharCode(65 + index)}`,
      participantIds: clubIds,
      fixtureIds: [],
      standings: createEmptyStandings(clubIds),
      qualifiers: [],
    })),
  };
  state.stages.push(stage);
  let maxRound = 0;
  stage.groups.forEach((group, groupIndex) => {
    const roundCount = addRoundRobinFixtures(state, stage, group.participantIds, {
      group,
      groupId: group.id,
      matchNumberOffset: groupIndex * 100,
      calendarMatchOffset: groupIndex * Math.ceil(group.participantIds.length / 2),
    });
    maxRound = Math.max(maxRound, roundCount);
  });
  stage.calendarRoundCount = maxRound;
  return stage;
}

function refreshGroups(state, stage) {
  let allComplete = true;
  for (const group of stage.groups) {
    const fixtures = group.fixtureIds.map((id) => state.fixtures.find((fixture) => fixture.id === id));
    group.standings = calculateStandings(group.participantIds, fixtures, state.tiebreakers, `${state.id}:${group.id}`);
    if (!fixtures.every((fixture) => fixture.status === "completed")) allComplete = false;
  }
  if (!allComplete) {
    if (stage.fixtureIds.some((id) => state.fixtures.find((fixture) => fixture.id === id)?.status === "completed")) {
      state.status = "active";
    }
    return;
  }
  if (stage.status === "completed") return;
  stage.status = "completed";
  for (const group of stage.groups) {
    group.qualifiers = group.standings.slice(0, stage.qualifiersPerGroup).map((row) => row.clubId);
  }
  const qualifiers = [];
  for (let position = 0; position < stage.qualifiersPerGroup; position += 1) {
    for (const group of stage.groups) qualifiers.push(group.qualifiers[position]);
  }
  if (qualifiers.length === 1) {
    state.status = "completed";
    state.winnerClubId = qualifiers[0];
    return;
  }
  createKnockoutStage(state, qualifiers, {
    stageId: "knockout",
    startCalendarRound: stage.calendarRoundCount + 2,
  });
  state.status = "active";
}

function refreshKnockout(state, stage) {
  for (const tie of stage.ties) {
    if (tie.status === "active") resolveTie(state, stage, tie);
  }
  const finalRound = stage.rounds.at(-1);
  const finalTie = stage.ties.find((tie) => tie.id === finalRound?.tieIds[0]);
  if (finalTie?.status === "completed") {
    stage.status = "completed";
    state.status = "completed";
    state.winnerClubId = finalTie.winnerClubId;
  } else if (stage.fixtureIds.some((id) => state.fixtures.find((fixture) => fixture.id === id)?.status === "completed")) {
    state.status = "active";
  }
}

function sortCalendar(state) {
  const fixtureById = new Map(state.fixtures.map((fixture) => [fixture.id, fixture]));
  state.calendar = unique(state.calendar).sort((leftId, rightId) => {
    const left = fixtureById.get(leftId);
    const right = fixtureById.get(rightId);
    return left.scheduledAt.localeCompare(right.scheduledAt)
      || left.calendarRound - right.calendarRound
      || left.matchNumber - right.matchNumber
      || left.leg - right.leg
      || left.id.localeCompare(right.id, "pt-BR");
  });
}

function validateSerializable(state) {
  try {
    JSON.stringify(state);
  } catch (error) {
    fail("Estado de competicao nao serializavel", "NON_SERIALIZABLE_STATE", { cause: error.message });
  }
}

/**
 * Cria estado completo e deterministico para persistencia no save.
 * Aceita diretamente registros do Editor (teamIds, format, legs, tiebreakers).
 */
export function createCompetitionState(definition, options = {}) {
  const normalized = normalizeDefinition(definition, options);
  const state = {
    engineVersion: COMPETITION_ENGINE_VERSION,
    id: normalized.id,
    name: normalized.name,
    format: normalized.format,
    legs: normalized.legs,
    tiebreakers: normalized.tiebreakers,
    seasonNumber: normalized.seasonNumber,
    seasonYear: normalized.seasonYear,
    status: "scheduled",
    participants: normalized.participants,
    schedule: normalized.schedule,
    stages: [],
    fixtures: [],
    calendar: [],
    completedFixtureIds: [],
    winnerClubId: null,
  };
  const participantIds = state.participants.map((participant) => participant.id);
  if (state.format === "league") {
    const stage = {
      id: "league",
      type: "league",
      status: "active",
      participantIds,
      fixtureIds: [],
      standings: createEmptyStandings(participantIds),
    };
    state.stages.push(stage);
    addRoundRobinFixtures(state, stage, participantIds);
  } else if (state.format === "knockout") {
    createKnockoutStage(state, participantIds);
  } else {
    createGroupStage(state, definition);
  }
  sortCalendar(state);
  validateSerializable(state);
  return state;
}

/** Registra resultado sem mutar estado recebido. Retorna novo estado serializavel. */
export function recordCompetitionResult(currentState, fixtureIdValue, result, options = {}) {
  const state = clone(currentState);
  if (state.engineVersion !== COMPETITION_ENGINE_VERSION) {
    fail("Versao de engine nao suportada", "UNSUPPORTED_ENGINE_VERSION", {
      engineVersion: state.engineVersion,
    });
  }
  if (state.status === "completed") fail("Competicao ja concluida", "COMPETITION_COMPLETED");
  const id = text(fixtureIdValue);
  const fixture = state.fixtures.find((candidate) => candidate.id === id);
  if (!fixture) fail("Jogo nao encontrado", "FIXTURE_NOT_FOUND", { fixtureId: id });
  if (fixture.status === "completed") fail("Jogo ja concluido", "FIXTURE_ALREADY_COMPLETED", { fixtureId: id });
  fixture.result = normalizeResult(result);
  fixture.status = "completed";
  const completedAt = options.completedAt == null ? fixture.scheduledAt : validIsoDate(options.completedAt)?.toISOString();
  if (!completedAt) fail("Data de conclusao invalida", "INVALID_COMPLETED_AT");
  fixture.completedAt = completedAt;
  state.completedFixtureIds.push(fixture.id);

  const stage = state.stages.find((candidate) => candidate.id === fixture.stageId);
  if (!stage) fail("Fase do jogo nao encontrada", "STAGE_NOT_FOUND", { stageId: fixture.stageId });
  if (stage.type === "league") refreshLeague(state, stage);
  if (stage.type === "groups") refreshGroups(state, stage);
  if (stage.type === "knockout") refreshKnockout(state, stage);
  sortCalendar(state);
  validateSerializable(state);
  return state;
}

/** Retorna classificacao persistida da liga ou de grupo. */
export function getCompetitionStandings(state, options = {}) {
  const groupId = text(options.groupId);
  if (groupId) {
    const groupStage = state.stages.find((stage) => stage.type === "groups");
    const group = groupStage?.groups.find((candidate) => candidate.id === groupId);
    if (!group) fail("Grupo nao encontrado", "GROUP_NOT_FOUND", { groupId });
    return clone(group.standings);
  }
  const stageId = text(options.stageId);
  const league = state.stages.find((stage) => (
    stage.type === "league" && (!stageId || stage.id === stageId)
  ));
  if (!league) fail("Classificacao nao disponivel", "STANDINGS_NOT_AVAILABLE");
  return clone(league.standings);
}

export function listPendingCompetitionFixtures(state) {
  const fixtureById = new Map(state.fixtures.map((fixture) => [fixture.id, fixture]));
  return state.calendar
    .map((id) => fixtureById.get(id))
    .filter((fixture) => fixture?.status === "scheduled")
    .map(clone);
}

function rebuildCompetitionSeasonSnapshot(season) {
  const fixtures = season.competitions.flatMap((competition) => competition.fixtures.map(clone));
  fixtures.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)
    || left.competitionFixtureId.localeCompare(right.competitionFixtureId, "pt-BR"));
  season.fixtures = fixtures;
  season.calendar = fixtures.map((fixture) => fixture.competitionFixtureId);
  season.completedFixtureIds = fixtures
    .filter((fixture) => fixture.status === "completed")
    .map((fixture) => fixture.competitionFixtureId);
  if (season.competitions.every((competition) => competition.status === "completed")) {
    season.status = "completed";
  } else if (season.completedFixtureIds.length > 0) {
    season.status = "active";
  } else {
    season.status = "scheduled";
  }
  season.winners = season.competitions
    .filter((competition) => competition.winnerClubId)
    .map((competition) => ({
      tournamentId: competition.id,
      clubId: competition.winnerClubId,
    }));
  validateSerializable(season);
  return season;
}

/**
 * Cria pacote de temporada com varias competicoes do Editor.
 * `fixtures` usa contrato plano para RoomStore/calendario, enquanto
 * `competitions` preserva grupos, classificacoes e chaves completas.
 */
export function createCompetitionSeason(tournaments, options = {}) {
  if (!Array.isArray(tournaments)) fail("Lista de torneios invalida", "INVALID_TOURNAMENT_LIST");
  const active = tournaments.filter((tournament) => tournament?.active !== false);
  const ids = active.map((tournament) => text(tournament?.id));
  if (ids.some((id) => !id) || unique(ids).length !== ids.length) {
    fail("Ids de torneios invalidos ou repetidos", "INVALID_TOURNAMENT_IDS");
  }
  const seasonNumber = positiveInteger(options.seasonNumber, 1);
  const seasonYear = positiveInteger(options.seasonYear, 2026);
  const competitions = active.map((tournament) => createCompetitionState(tournament, {
    ...options,
    seasonNumber,
    seasonYear,
    startDate: options.startDates?.[tournament.id] ?? options.startDate,
  }));
  const season = {
    engineVersion: COMPETITION_ENGINE_VERSION,
    seasonNumber,
    seasonYear,
    status: "scheduled",
    tournamentIds: competitions.map((competition) => competition.id),
    competitions,
    fixtures: [],
    calendar: [],
    completedFixtureIds: [],
    winners: [],
  };
  return rebuildCompetitionSeasonSnapshot(season);
}

/** Registra placar no pacote de temporada e avanca chave da competicao correta. */
export function recordCompetitionSeasonResult(currentSeason, fixtureIdValue, result, options = {}) {
  const season = clone(currentSeason);
  if (season.engineVersion !== COMPETITION_ENGINE_VERSION || !Array.isArray(season.competitions)) {
    fail("Pacote de temporada invalido", "INVALID_COMPETITION_SEASON");
  }
  const id = text(fixtureIdValue);
  const competitionIndex = season.competitions.findIndex((competition) => (
    competition.fixtures.some((fixture) => fixture.competitionFixtureId === id || fixture.id === id)
  ));
  if (competitionIndex < 0) fail("Jogo nao encontrado na temporada", "FIXTURE_NOT_FOUND", { fixtureId: id });
  season.competitions[competitionIndex] = recordCompetitionResult(
    season.competitions[competitionIndex],
    id,
    result,
    options,
  );
  return rebuildCompetitionSeasonSnapshot(season);
}

function stateMap(value) {
  if (Array.isArray(value)) return new Map(value.map((state) => [state.id, state]));
  return new Map(Object.entries(value ?? {}));
}

function standingsForDivision(division, states, requireComplete) {
  const state = states.get(division.competitionId ?? division.id);
  if (!state) fail("Competicao da divisao ausente", "DIVISION_COMPETITION_NOT_FOUND", { divisionId: division.id });
  if (requireComplete && state.status !== "completed") {
    fail("Competicao da divisao ainda nao terminou", "DIVISION_NOT_COMPLETED", { divisionId: division.id });
  }
  return getCompetitionStandings(state);
}

/**
 * Calcula composicao das divisoes da proxima temporada.
 * Nenhum argumento e mutado. Transicoes podem ligar qualquer nivel adjacente.
 */
export function applyPromotionRelegation({
  divisions,
  competitionStates,
  transitions = null,
  requireComplete = true,
}) {
  if (!Array.isArray(divisions) || divisions.length < 2) {
    fail("Promocao/rebaixamento exige duas divisoes", "NOT_ENOUGH_DIVISIONS");
  }
  const normalized = divisions.map((division, index) => {
    const id = text(division.id);
    const teamIds = (division.teamIds ?? division.clubIds ?? []).map(text).filter(Boolean);
    if (!id || teamIds.length < 2 || unique(teamIds).length !== teamIds.length) {
      fail("Divisao invalida", "INVALID_DIVISION", { index });
    }
    return {
      ...clone(division),
      id,
      level: positiveInteger(division.level, index + 1),
      teamIds,
    };
  }).sort((left, right) => left.level - right.level || left.id.localeCompare(right.id, "pt-BR"));
  const allClubs = normalized.flatMap((division) => division.teamIds);
  if (unique(allClubs).length !== allClubs.length) {
    fail("Clube aparece em mais de uma divisao", "DUPLICATE_DIVISION_CLUB");
  }
  const byId = new Map(normalized.map((division) => [division.id, division]));
  const rules = Array.isArray(transitions) ? transitions : normalized.slice(0, -1).map((upper, index) => {
    const lower = normalized[index + 1];
    return {
      upperDivisionId: upper.id,
      lowerDivisionId: lower.id,
      promotionSlots: nonNegativeInteger(lower.promotionSlots, 0),
      relegationSlots: nonNegativeInteger(upper.relegationSlots, 0),
    };
  });
  const states = stateMap(competitionStates);
  const standingsCache = new Map();
  const standings = (division) => {
    if (!standingsCache.has(division.id)) {
      standingsCache.set(division.id, standingsForDivision(division, states, requireComplete));
    }
    return standingsCache.get(division.id);
  };
  const movements = [];
  const leaving = new Map(normalized.map((division) => [division.id, new Set()]));
  const arriving = new Map(normalized.map((division) => [division.id, []]));
  const movedClubs = new Set();

  for (const rule of rules) {
    const upper = byId.get(text(rule.upperDivisionId));
    const lower = byId.get(text(rule.lowerDivisionId));
    if (!upper || !lower || upper.level >= lower.level) {
      fail("Transicao entre divisoes invalida", "INVALID_DIVISION_TRANSITION", { rule });
    }
    const promotionSlots = nonNegativeInteger(rule.promotionSlots, nonNegativeInteger(lower.promotionSlots, 0));
    const relegationSlots = nonNegativeInteger(rule.relegationSlots, nonNegativeInteger(upper.relegationSlots, 0));
    const upperTable = standings(upper);
    const lowerTable = standings(lower);
    if (promotionSlots > lowerTable.length || relegationSlots > upperTable.length) {
      fail("Vagas excedem tamanho da divisao", "INVALID_MOVEMENT_SLOTS", { rule });
    }
    const promoted = lowerTable.slice(0, promotionSlots);
    const relegated = relegationSlots ? upperTable.slice(-relegationSlots) : [];
    for (const row of promoted) {
      if (movedClubs.has(row.clubId)) fail("Clube selecionado em dois movimentos", "CONFLICTING_MOVEMENT", { clubId: row.clubId });
      movedClubs.add(row.clubId);
      leaving.get(lower.id).add(row.clubId);
      arriving.get(upper.id).push(row.clubId);
      movements.push({
        clubId: row.clubId,
        type: "promotion",
        fromDivisionId: lower.id,
        toDivisionId: upper.id,
        position: row.position,
      });
    }
    for (const row of relegated) {
      if (movedClubs.has(row.clubId)) fail("Clube selecionado em dois movimentos", "CONFLICTING_MOVEMENT", { clubId: row.clubId });
      movedClubs.add(row.clubId);
      leaving.get(upper.id).add(row.clubId);
      arriving.get(lower.id).push(row.clubId);
      movements.push({
        clubId: row.clubId,
        type: "relegation",
        fromDivisionId: upper.id,
        toDivisionId: lower.id,
        position: row.position,
      });
    }
  }

  const nextDivisions = normalized.map((division) => ({
    ...division,
    teamIds: [
      ...division.teamIds.filter((clubId) => !leaving.get(division.id).has(clubId)),
      ...arriving.get(division.id),
    ],
  }));
  const nextClubs = nextDivisions.flatMap((division) => division.teamIds);
  if (unique(nextClubs).length !== nextClubs.length) {
    fail("Movimentos produziram clubes duplicados", "DUPLICATE_NEXT_DIVISION_CLUB");
  }
  return { divisions: nextDivisions, movements };
}
