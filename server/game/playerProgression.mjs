const CAREER_STAT_KEYS = Object.freeze([
  "appearances",
  "starts",
  "minutes",
  "goals",
  "assists",
  "yellowCards",
  "redCards",
  "injuries",
  "ratedMatches",
  "ratingTotal",
]);

const DECIMAL_CAREER_STAT_KEYS = new Set(["ratingTotal"]);

const COMPETITION_ADVANCED_STAT_KEYS = Object.freeze([
  "shots",
  "shotsOnTarget",
  "saves",
  "goalsConceded",
  "cleanSheets",
]);

// Competition records only cover the active season. The cap protects the
// Firestore room document from pathological databases with hundreds of cups.
const MAX_COMPETITION_STATS_PER_PLAYER = 24;

const INJURY_DURATION = Object.freeze({
  minor: 1,
  moderate: 2,
  severe: 4,
});

function identifier(value) {
  return String(value ?? "").trim();
}

function clubKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function stateKey(clubId, playerId) {
  return `${clubKey(clubId)}\u0000${identifier(playerId)}`;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.min(maximum, Math.max(0, Math.trunc(finiteNumber(value, fallback))));
}

function optionalInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(maximum, Math.max(0, Math.trunc(number)));
}

function conditionValue(value, fallback = 100) {
  return Math.min(100, Math.max(0, finiteNumber(value, fallback)));
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const timestamp = new Date(value ?? Date.now());
  return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
}

function emptyCareerStats() {
  return Object.fromEntries(CAREER_STAT_KEYS.map((key) => [key, 0]));
}

function normalizeCareerStats(value) {
  const normalized = emptyCareerStats();
  for (const key of CAREER_STAT_KEYS) {
    normalized[key] = DECIMAL_CAREER_STAT_KEYS.has(key)
      ? Math.max(0, finiteNumber(value?.[key]))
      : integer(value?.[key]);
  }
  return normalized;
}

function normalizeSeasonStats(value, seasonNumber) {
  const currentSeason = Math.max(1, integer(seasonNumber, 1));
  if (value && integer(value.seasonNumber, currentSeason) !== currentSeason) {
    return { seasonNumber: currentSeason, ...emptyCareerStats() };
  }
  return {
    seasonNumber: currentSeason,
    ...normalizeCareerStats(value),
  };
}

function emptyCompetitionStats(competitionId, seasonNumber) {
  return {
    competitionId,
    seasonNumber,
    ...emptyCareerStats(),
    ...Object.fromEntries(COMPETITION_ADVANCED_STAT_KEYS.map((key) => [key, null])),
    lastMatchId: null,
  };
}

function normalizeCompetitionStat(value, seasonNumber, fallbackCompetitionId = null) {
  const competitionId = identifier(value?.competitionId ?? fallbackCompetitionId);
  const currentSeason = Math.max(1, integer(seasonNumber, 1));
  if (!competitionId || integer(value?.seasonNumber, currentSeason) !== currentSeason) return null;
  const normalized = {
    competitionId,
    seasonNumber: currentSeason,
    ...normalizeCareerStats(value),
    lastMatchId: identifier(value?.lastMatchId) || null,
  };
  for (const key of COMPETITION_ADVANCED_STAT_KEYS) {
    normalized[key] = optionalInteger(value?.[key]);
  }
  return normalized;
}

function normalizeCompetitionStats(value, seasonNumber) {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([competitionId, stats]) => ({ ...stats, competitionId }))
      : [];
  const deduplicated = new Map();
  for (const candidate of candidates) {
    const normalized = normalizeCompetitionStat(candidate, seasonNumber);
    if (normalized) deduplicated.set(clubKey(normalized.competitionId), normalized);
  }
  return [...deduplicated.values()].slice(-MAX_COMPETITION_STATS_PER_PLAYER);
}

function unavailableLegacyStatus(value) {
  const key = identifier(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR");
  if (key === "lesionado") return "Lesionado";
  if (key === "suspenso") return "Suspenso";
  if (key === "cansado") return "Cansado";
  return null;
}

function baselineStateForPlayer(player, seasonNumber) {
  const legacyStatus = unavailableLegacyStatus(player?.status);
  const injuryMatches = Math.max(
    integer(player?.injuryMatches),
    legacyStatus === "Lesionado" ? 1 : 0,
  );
  const suspensionMatches = Math.max(
    integer(player?.suspensionMatches),
    legacyStatus === "Suspenso" ? 1 : 0,
  );
  return normalizePlayerState({
    playerId: player?.id,
    clubId: player?.clubId,
    condition: player?.condition,
    injuryMatches,
    suspensionMatches,
  }, {
    seasonNumber,
    fallbackCondition: 100,
  });
}

export function derivePlayerStatus(runtime = {}, fallbackStatus = null) {
  if (integer(runtime.injuryMatches) > 0) return "Lesionado";
  if (integer(runtime.suspensionMatches) > 0) return "Suspenso";
  const legacyStatus = unavailableLegacyStatus(fallbackStatus);
  if (legacyStatus) return legacyStatus;
  if (conditionValue(runtime.condition) < 70) return "Cansado";
  return "Disponível";
}

export function normalizePlayerState(value, {
  playerId = value?.playerId,
  clubId = value?.clubId,
  seasonNumber = value?.seasonStats?.seasonNumber ?? 1,
  fallbackCondition = 100,
} = {}) {
  const normalizedPlayerId = identifier(playerId);
  const normalizedClubId = identifier(clubId);
  if (!normalizedPlayerId || !normalizedClubId) return null;
  const normalizedSeason = Math.max(1, integer(seasonNumber, 1));
  const storedSeason = value?.seasonStats
    ? Math.max(1, integer(value.seasonStats.seasonNumber, normalizedSeason))
    : normalizedSeason;
  return {
    playerId: normalizedPlayerId,
    clubId: normalizedClubId,
    condition: conditionValue(value?.condition, fallbackCondition),
    injuryMatches: integer(value?.injuryMatches),
    suspensionMatches: integer(value?.suspensionMatches),
    yellowCardAccumulator: storedSeason === normalizedSeason
      ? integer(value?.yellowCardAccumulator, 0, 2)
      : 0,
    seasonStats: normalizeSeasonStats(value?.seasonStats, normalizedSeason),
    competitionStats: normalizeCompetitionStats(value?.competitionStats, normalizedSeason),
    careerStats: normalizeCareerStats(value?.careerStats),
    updatedAt: value?.updatedAt ? isoTimestamp(value.updatedAt) : null,
    lastMatchId: identifier(value?.lastMatchId) || null,
  };
}

function normalizedRoomStates(room) {
  const seasonNumber = Math.max(1, integer(room?.currentSeason, 1));
  const states = new Map();
  for (const candidate of Array.isArray(room?.playerStates) ? room.playerStates : []) {
    const normalized = normalizePlayerState(candidate, { seasonNumber });
    if (normalized) states.set(stateKey(normalized.clubId, normalized.playerId), normalized);
  }
  return states;
}

function mergePlayerState(player, state, seasonNumber) {
  const hasRoomState = Boolean(state);
  const normalized = hasRoomState
    ? normalizePlayerState(state, {
      playerId: player?.id,
      clubId: player?.clubId,
      seasonNumber,
      fallbackCondition: conditionValue(player?.condition, 100),
    })
    : baselineStateForPlayer(player, seasonNumber);
  if (!normalized) return { ...player };
  return {
    ...player,
    condition: normalized.condition,
    injuryMatches: normalized.injuryMatches,
    suspensionMatches: normalized.suspensionMatches,
    status: derivePlayerStatus(normalized, hasRoomState ? null : player?.status),
    seasonStats: structuredClone(normalized.seasonStats),
    competitionStats: structuredClone(normalized.competitionStats),
    careerStats: structuredClone(normalized.careerStats),
  };
}

/** Merge the save-scoped runtime overlay without mutating the shared catalog. */
export function mergePlayerStates(players, room, clubId) {
  const values = Array.isArray(players) ? players : [];
  const seasonNumber = Math.max(1, integer(room?.currentSeason, 1));
  const states = normalizedRoomStates(room);
  const requestedClub = identifier(clubId);
  return values.map((player) => {
    const playerClubId = identifier(player?.clubId) || requestedClub;
    const state = states.get(stateKey(playerClubId, player?.id));
    return mergePlayerState({ ...player, clubId: playerClubId }, state, seasonNumber);
  });
}

function entriesForSide(result, field, side, fallbackClubId) {
  const values = result?.[field]?.[side];
  if (!Array.isArray(values)) return [];
  return values.map((value) => ({
    ...value,
    side: value?.side === "away" ? "away" : value?.side === "home" ? "home" : side,
    clubId: identifier(value?.clubId) || identifier(fallbackClubId),
  }));
}

function playerEffectsFor(result, homeClubId, awayClubId) {
  if (!Array.isArray(result?.playerEffects)) {
    return [
      ...entriesForSide(result, "playerEffects", "home", homeClubId),
      ...entriesForSide(result, "playerEffects", "away", awayClubId),
    ];
  }
  return result.playerEffects.map((effect) => {
    const effectClubId = identifier(effect?.clubId);
    const side = effect?.side === "away"
      || (effect?.side !== "home" && effectClubId && clubKey(effectClubId) === clubKey(awayClubId))
      ? "away"
      : "home";
    return {
      ...effect,
      side,
      clubId: effectClubId || (side === "away" ? awayClubId : homeClubId),
    };
  });
}

function injuryDurationFor(result, playerId, clubId) {
  let duration = 0;
  for (const event of Array.isArray(result?.events) ? result.events : []) {
    if (event?.type !== "injury" || identifier(event?.playerId) !== playerId) continue;
    const eventClubId = identifier(event?.teamId ?? event?.clubId);
    if (eventClubId && clubId && clubKey(eventClubId) !== clubKey(clubId)) continue;
    duration = Math.max(duration, INJURY_DURATION[event?.severity] ?? 2);
  }
  return duration;
}

function addMatchStats(target, matchStats) {
  for (const key of CAREER_STAT_KEYS) {
    target.seasonStats[key] += matchStats[key];
    target.careerStats[key] += matchStats[key];
  }
}

function competitionIdFor(fixture, result) {
  return identifier(
    result?.leagueId
      ?? result?.competitionId
      ?? result?.tournamentId
      ?? fixture?.leagueId
      ?? fixture?.competitionId
      ?? fixture?.tournamentId,
  );
}

function addCompetitionMatchStats(target, competitionId, seasonNumber, matchId, matchStats) {
  if (!competitionId) return false;
  target.competitionStats = normalizeCompetitionStats(target.competitionStats, seasonNumber);
  let scoped = target.competitionStats.find(
    (candidate) => clubKey(candidate.competitionId) === clubKey(competitionId),
  );
  if (!scoped) {
    scoped = emptyCompetitionStats(competitionId, seasonNumber);
    target.competitionStats.push(scoped);
    target.competitionStats = target.competitionStats.slice(-MAX_COMPETITION_STATS_PER_PLAYER);
  }
  if (scoped.lastMatchId === matchId) return false;
  for (const key of CAREER_STAT_KEYS) scoped[key] += matchStats[key];
  for (const key of COMPETITION_ADVANCED_STAT_KEYS) {
    if (matchStats[key] === null) continue;
    scoped[key] = (scoped[key] ?? 0) + matchStats[key];
  }
  scoped.lastMatchId = matchId;
  return true;
}

function normalizedMatchStats(stat, result, clubId) {
  const minutes = integer(stat?.minutesPlayed, 0, 130);
  const injuryDuration = injuryDurationFor(result, identifier(stat?.playerId), clubId);
  const injured = Boolean(stat?.injured) || injuryDuration > 0;
  const goalkeeper = clubKey(stat?.position) === "GOL";
  const appeared = minutes > 0 || Boolean(stat?.started);
  const cleanSheet = goalkeeper && typeof stat?.cleanSheet === "boolean" ? (stat.cleanSheet ? 1 : 0) : null;
  const rawRating = 6
    + integer(stat?.goals, 0, 20) * 1.2
    + integer(stat?.assists, 0, 20) * 0.8
    + integer(stat?.shotsOnTarget, 0, 100) * 0.08
    + (goalkeeper ? integer(stat?.saves, 0, 100) * 0.1 : 0)
    + (cleanSheet === 1 ? 0.4 : 0)
    - (goalkeeper ? integer(stat?.goalsConceded, 0, 20) * 0.12 : 0)
    - integer(stat?.yellowCards, 0, 2) * 0.15
    - integer(stat?.redCards, 0, 2) * 1.2;
  const participationWeight = Math.min(1, Math.max(0.35, minutes / 90));
  const matchRating = appeared
    ? Number(Math.min(10, Math.max(1, 6 + (rawRating - 6) * participationWeight)).toFixed(2))
    : 0;
  return {
    appearances: appeared ? 1 : 0,
    starts: Boolean(stat?.started) ? 1 : 0,
    minutes,
    goals: integer(stat?.goals, 0, 20),
    assists: integer(stat?.assists, 0, 20),
    yellowCards: integer(stat?.yellowCards, 0, 2),
    redCards: integer(stat?.redCards, 0, 2),
    injuries: injured ? 1 : 0,
    ratedMatches: appeared ? 1 : 0,
    ratingTotal: matchRating,
    shots: optionalInteger(stat?.shots, 100),
    shotsOnTarget: optionalInteger(stat?.shotsOnTarget, 100),
    saves: goalkeeper ? optionalInteger(stat?.saves, 100) : null,
    goalsConceded: goalkeeper ? optionalInteger(stat?.goalsConceded, 20) : null,
    cleanSheets: cleanSheet,
    injuryDuration: injured ? (injuryDuration || 2) : 0,
  };
}

function completedCompetitionMatchExists(room, competitionId, currentFixtureIdentifiers = []) {
  const key = clubKey(competitionId);
  if (!key) return false;
  const ignored = new Set(currentFixtureIdentifiers.map(clubKey).filter(Boolean));
  const leagueByFixture = new Map((room?.leagueFixtureSchedule ?? []).map((fixture) => [
    clubKey(fixture?.leagueFixtureId),
    clubKey(fixture?.leagueId),
  ]));
  if ((room?.leagueMatchResults ?? []).some((result) => (
    leagueByFixture.get(clubKey(result?.leagueFixtureId)) === key
      && !ignored.has(clubKey(result?.leagueFixtureId))
  ))) return true;
  const competitionStates = room?.competitionSeason?.competitions
    ?? room?.competitionSeason?.states
    ?? [];
  return competitionStates.some((state) => (
    clubKey(state?.id ?? state?.competitionId) === key
      && (state?.fixtures ?? []).some((fixture) => (
        (fixture?.status === "completed" || fixture?.result || fixture?.completedAt)
          && !ignored.has(clubKey(
            fixture?.competitionFixtureId ?? fixture?.fixtureId ?? fixture?.id,
          ))
      ))
  ));
}

function updateCompetitionCoverage(room, {
  competitionId,
  seasonNumber,
  matchId,
  statistics,
  currentFixtureIdentifiers,
}) {
  if (!competitionId) return;
  const playerStatistics = Array.isArray(statistics) ? statistics : [];
  const individualStatsAvailable = playerStatistics.length > 0;
  const goalkeepers = playerStatistics.filter((stat) => clubKey(stat?.position) === "GOL");
  const metricCoverage = {
    shots: individualStatsAvailable && playerStatistics.every((stat) => optionalInteger(stat?.shots) !== null),
    shotsOnTarget: individualStatsAvailable && playerStatistics.every((stat) => optionalInteger(stat?.shotsOnTarget) !== null),
    saves: goalkeepers.length > 0 && goalkeepers.every((stat) => optionalInteger(stat?.saves) !== null),
    goalsConceded: goalkeepers.length > 0 && goalkeepers.every((stat) => optionalInteger(stat?.goalsConceded) !== null),
    cleanSheets: goalkeepers.length > 0 && goalkeepers.every((stat) => typeof stat?.cleanSheet === "boolean"),
  };
  const entries = (Array.isArray(room.playerCompetitionStatsCoverage)
    ? room.playerCompetitionStatsCoverage
    : []).filter((entry) => integer(entry?.seasonNumber, seasonNumber) === seasonNumber);
  let coverage = entries.find(
    (entry) => clubKey(entry?.competitionId) === clubKey(competitionId),
  );
  if (!coverage) {
    coverage = {
      competitionId,
      seasonNumber,
      complete: !completedCompetitionMatchExists(
        room,
        competitionId,
        currentFixtureIdentifiers,
      ) && individualStatsAvailable,
      trackedMatches: 0,
      untrackedMatches: 0,
      metrics: { ...metricCoverage },
      lastMatchId: null,
    };
    entries.push(coverage);
  }
  if (coverage.lastMatchId !== matchId) {
    if (individualStatsAvailable) coverage.trackedMatches = integer(coverage.trackedMatches) + 1;
    else {
      coverage.untrackedMatches = integer(coverage.untrackedMatches) + 1;
      coverage.complete = false;
    }
    coverage.metrics = Object.fromEntries(COMPETITION_ADVANCED_STAT_KEYS.map((key) => [
      key,
      coverage.metrics?.[key] === true && metricCoverage[key] === true,
    ]));
    coverage.lastMatchId = matchId;
  }
  room.playerCompetitionStatsCoverage = entries.slice(-64);
}

function normalizeEffect(effect) {
  if (!effect) return null;
  const conditionAfter = Number(effect.conditionAfter);
  const conditionBefore = Number(effect.conditionBefore);
  const conditionDelta = Number(effect.conditionDelta);
  return {
    ...effect,
    ...(Number.isFinite(conditionAfter) ? { conditionAfter: conditionValue(conditionAfter) } : {}),
    ...(Number.isFinite(conditionBefore) ? { conditionBefore: conditionValue(conditionBefore) } : {}),
    ...(Number.isFinite(conditionDelta) ? { conditionDelta } : {}),
    injuryMatches: integer(effect.injuryMatches),
    suspensionMatches: integer(effect.suspensionMatches),
  };
}

function finalCondition(state, stat, effect, injured) {
  if (Number.isFinite(effect?.conditionAfter)) return conditionValue(effect.conditionAfter);
  if (Number.isFinite(effect?.conditionDelta)) {
    const base = Number.isFinite(effect?.conditionBefore) ? effect.conditionBefore : state.condition;
    return conditionValue(base + effect.conditionDelta);
  }
  const minutes = integer(stat?.minutesPlayed, 0, 130);
  const fatigue = Math.ceil(minutes / 12) + (injured ? 10 : 0);
  return conditionValue(state.condition - fatigue);
}

function publicEffect(state, side, conditionBefore) {
  return {
    playerId: state.playerId,
    clubId: state.clubId,
    ...(side ? { side } : {}),
    conditionBefore,
    conditionAfter: state.condition,
    conditionDelta: Number((state.condition - conditionBefore).toFixed(2)),
    status: derivePlayerStatus(state),
    injuryMatches: state.injuryMatches,
    suspensionMatches: state.suspensionMatches,
  };
}

/**
 * Apply a completed manager match to the room-scoped player overlay.
 * The room is intentionally mutated so RoomStore can persist it in the same transaction.
 */
export function applyMatchPlayerProgression(room, fixture, result, now = new Date()) {
  if (!room || typeof room !== "object") throw new TypeError("Sala invalida para progressao");
  const matchId = identifier(result?.id ?? fixture?.fixtureId);
  if (!matchId) throw new TypeError("Partida sem identificador para progressao");

  const seasonNumber = Math.max(1, integer(room.currentSeason, 1));
  const completedAt = isoTimestamp(now);
  const homeClubId = identifier(result?.homeClubId ?? fixture?.homeClubId);
  const awayClubId = identifier(result?.awayClubId ?? fixture?.awayClubId);
  const competitionId = competitionIdFor(fixture, result);
  const states = normalizedRoomStates(room);

  // Runtime fields used by old catalogs lived on the player itself. Seed a
  // room state once so a suspension/injury can be served instead of returning
  // from the immutable base on every request.
  for (const candidate of Array.isArray(result?.playerStateBaselines)
    ? result.playerStateBaselines
    : []) {
    const normalized = normalizePlayerState(candidate, { seasonNumber });
    if (!normalized) continue;
    const key = stateKey(normalized.clubId, normalized.playerId);
    if (states.has(key)) continue;
    if (
      normalized.condition >= 100
      && normalized.injuryMatches === 0
      && normalized.suspensionMatches === 0
    ) continue;
    states.set(key, normalized);
  }

  const statistics = [
    ...entriesForSide(result, "playerStatistics", "home", homeClubId),
    ...entriesForSide(result, "playerStatistics", "away", awayClubId),
  ];
  updateCompetitionCoverage(room, {
    competitionId,
    seasonNumber,
    matchId,
    statistics,
    currentFixtureIdentifiers: [
      matchId,
      fixture?.fixtureId,
      fixture?.leagueFixtureId,
      fixture?.competitionFixtureId,
      result?.id,
      result?.leagueFixtureId,
      result?.competitionFixtureId,
    ],
  });
  const effects = playerEffectsFor(result, homeClubId, awayClubId)
    .map(normalizeEffect)
    .filter(Boolean);
  const participatingClubs = new Set([
    clubKey(homeClubId),
    clubKey(awayClubId),
    ...statistics.map((stat) => clubKey(stat.clubId)),
    ...effects.map((effect) => clubKey(effect.clubId)),
  ].filter(Boolean));
  const effectByPlayer = new Map(effects.map((effect) => [
    stateKey(effect.clubId, effect.playerId),
    effect,
  ]));
  const participantKeys = new Set([
    ...statistics.map((stat) => stateKey(stat.clubId, stat.playerId)),
    ...effects.map((effect) => stateKey(effect.clubId, effect.playerId)),
  ]);
  const statisticKeys = new Set(statistics.map((stat) => stateKey(stat.clubId, stat.playerId)));
  const alreadyApplied = new Set();

  // A played fixture serves existing bans/injuries. Players outside the match recover condition.
  for (const [key, state] of states) {
    if (participatingClubs.size > 0 && !participatingClubs.has(clubKey(state.clubId))) continue;
    if (state.lastMatchId === matchId) {
      alreadyApplied.add(key);
      continue;
    }
    state.injuryMatches = Math.max(0, state.injuryMatches - 1);
    state.suspensionMatches = Math.max(0, state.suspensionMatches - 1);
    state.seasonStats = normalizeSeasonStats(state.seasonStats, seasonNumber);
    if (!participantKeys.has(key)) state.condition = conditionValue(state.condition + 6);
    state.updatedAt = completedAt;
    state.lastMatchId = matchId;
  }

  const normalizedEffects = [];
  for (const stat of statistics) {
    const playerId = identifier(stat?.playerId);
    const clubId = identifier(stat?.clubId);
    if (!playerId || !clubId) continue;
    const key = stateKey(clubId, playerId);
    if (alreadyApplied.has(key)) continue;
    const effect = effectByPlayer.get(key);
    let state = states.get(key);
    if (!state) {
      state = normalizePlayerState(null, {
        playerId,
        clubId,
        seasonNumber,
        fallbackCondition: effect?.conditionBefore ?? 100,
      });
      states.set(key, state);
    }
    const conditionBefore = state.condition;
    const matchStats = normalizedMatchStats(stat, result, clubId);
    addMatchStats(state, matchStats);
    addCompetitionMatchStats(state, competitionId, seasonNumber, matchId, matchStats);

    const accumulatedYellows = state.yellowCardAccumulator + matchStats.yellowCards;
    state.suspensionMatches += Math.floor(accumulatedYellows / 3) + matchStats.redCards;
    state.yellowCardAccumulator = accumulatedYellows % 3;
    state.suspensionMatches = Math.max(state.suspensionMatches, effect?.suspensionMatches ?? 0);
    state.injuryMatches = Math.max(
      state.injuryMatches,
      matchStats.injuryDuration,
      effect?.injuryMatches ?? 0,
    );
    state.condition = finalCondition(state, stat, effect, matchStats.injuries > 0);
    state.updatedAt = completedAt;
    state.lastMatchId = matchId;
    normalizedEffects.push(publicEffect(state, stat.side, conditionBefore));
  }

  // Effects may also contain substitutes/non-participants without a statistics row.
  for (const effect of effects) {
    const playerId = identifier(effect?.playerId);
    const clubId = identifier(effect?.clubId);
    if (!playerId || !clubId) continue;
    const key = stateKey(clubId, playerId);
    if (alreadyApplied.has(key) || statisticKeys.has(key)) continue;
    let state = states.get(key);
    if (!state) {
      state = normalizePlayerState(null, {
        playerId,
        clubId,
        seasonNumber,
        fallbackCondition: effect.conditionBefore ?? 100,
      });
      states.set(key, state);
    }
    const conditionBefore = state.condition;
    state.condition = finalCondition(state, null, effect, effect.injuryMatches > 0);
    state.injuryMatches = Math.max(state.injuryMatches, effect.injuryMatches);
    state.suspensionMatches = Math.max(state.suspensionMatches, effect.suspensionMatches);
    state.updatedAt = completedAt;
    state.lastMatchId = matchId;
    normalizedEffects.push(publicEffect(state, effect.side, conditionBefore));
  }

  room.playerStates = [...states.values()];
  return {
    playerStates: room.playerStates,
    playerEffects: normalizedEffects,
  };
}
