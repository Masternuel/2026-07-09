import { buildCoachEvaluationContext } from './coachEvaluationContext.mjs';

export const COACH_JOB_SECURITY_VERSION = 1;

export const DEFAULT_COACH_JOB_SECURITY_CONFIG = Object.freeze({
  relegationSlotsRatio: 0.2,
  evaluationSmoothing: 0.32,
  maximumNormalChange: 10,
  maximumCriticalChange: 22,
  ultimatumRounds: 3,
  thresholds: Object.freeze({
    untouchable: 90,
    very_safe: 80,
    safe: 70,
    stable: 60,
    under_observation: 50,
    pressured: 42,
    at_risk: 32,
    very_pressured: 22,
  }),
});

const LEVEL_LABELS = Object.freeze({
  untouchable: 'Intocável',
  very_safe: 'Muito seguro',
  safe: 'Seguro',
  stable: 'Estável',
  under_observation: 'Sob observação',
  pressured: 'Pressionado',
  at_risk: 'Em risco',
  very_pressured: 'Risco elevado',
  imminent: 'Demissão iminente',
});

const DIMENSION_LABELS = Object.freeze({
  sportingPerformance: 'Desempenho esportivo',
  objectives: 'Objetivos',
  recentForm: 'Forma recente',
  classics: 'Clássicos',
  competitionSituation: 'Situação na competição',
  relegation: 'Risco de rebaixamento',
  fans: 'Apoio da torcida',
  board: 'Apoio da diretoria',
  squad: 'Confiança do elenco',
  finance: 'Estabilidade financeira',
  reputation: 'Reputação',
  achievements: 'Títulos e conquistas',
  tenure: 'Tempo no cargo',
  expectations: 'Expectativas iniciais',
});

const BASE_WEIGHTS = Object.freeze({
  sportingPerformance: 16,
  objectives: 9,
  recentForm: 10,
  classics: 7,
  competitionSituation: 9,
  relegation: 10,
  fans: 8,
  board: 10,
  squad: 5,
  finance: 3,
  reputation: 3,
  achievements: 4,
  tenure: 3,
  expectations: 3,
});

const PROFILE_PRESETS = Object.freeze({
  structured: Object.freeze({
    badResultsTolerance: 55,
    classicImportance: 55,
    fanInfluence: 50,
    projectPatience: 65,
    relegationAversion: 70,
    titlePressure: 55,
    presidentPower: 70,
    politicalStability: 70,
    academyPriority: 50,
  }),
  elite: Object.freeze({
    badResultsTolerance: 28,
    classicImportance: 78,
    fanInfluence: 72,
    projectPatience: 42,
    relegationAversion: 95,
    titlePressure: 92,
    presidentPower: 76,
    politicalStability: 58,
    academyPriority: 45,
  }),
  survival: Object.freeze({
    badResultsTolerance: 72,
    classicImportance: 42,
    fanInfluence: 46,
    projectPatience: 68,
    relegationAversion: 52,
    titlePressure: 18,
    presidentPower: 64,
    politicalStability: 62,
    academyPriority: 58,
  }),
  unstable: Object.freeze({
    badResultsTolerance: 25,
    classicImportance: 68,
    fanInfluence: 88,
    projectPatience: 24,
    relegationAversion: 86,
    titlePressure: 72,
    presidentPower: 38,
    politicalStability: 25,
    academyPriority: 32,
  }),
  development: Object.freeze({
    badResultsTolerance: 68,
    classicImportance: 45,
    fanInfluence: 44,
    projectPatience: 82,
    relegationAversion: 58,
    titlePressure: 30,
    presidentPower: 68,
    politicalStability: 76,
    academyPriority: 90,
  }),
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value) {
  return String(value ?? '').trim();
}

function key(value) {
  return text(value).toLocaleUpperCase('pt-BR');
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value, digits = 0) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function sameClub(left, right) {
  return Boolean(key(left)) && key(left) === key(right);
}

function uniqueById(values) {
  return [...new Map(values.filter((entry) => text(entry?.id)).map((entry) => [entry.id, entry])).values()];
}

function timestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeProfileNumber(value, fallback) {
  return rounded(clamp(finite(value, fallback)), 1);
}

function normalizeWeights(value = {}, preset = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [id, fallback] of Object.entries(BASE_WEIGHTS)) {
    result[id] = rounded(clamp(finite(source[id], finite(preset[id], fallback)), 0, 40), 2);
  }
  return result;
}

function normalizeProfile(value, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const type = text(source.type ?? fallback.type) || 'structured';
  const preset = PROFILE_PRESETS[type] ?? PROFILE_PRESETS.structured;
  const weightsAlreadyNormalized = integer(source.normalizedWeightsVersion, 0) === COACH_JOB_SECURITY_VERSION;
  const profile = {
    ...clone(source),
    clubId: text(source.clubId ?? fallback.clubId),
    type,
    badResultsTolerance: normalizeProfileNumber(source.badResultsTolerance, preset.badResultsTolerance),
    classicImportance: normalizeProfileNumber(source.classicImportance, preset.classicImportance),
    fanInfluence: normalizeProfileNumber(source.fanInfluence, preset.fanInfluence),
    projectPatience: normalizeProfileNumber(source.projectPatience, preset.projectPatience),
    relegationAversion: normalizeProfileNumber(source.relegationAversion, preset.relegationAversion),
    titlePressure: normalizeProfileNumber(source.titlePressure, preset.titlePressure),
    presidentPower: normalizeProfileNumber(source.presidentPower, preset.presidentPower),
    politicalStability: normalizeProfileNumber(source.politicalStability, preset.politicalStability),
    academyPriority: normalizeProfileNumber(source.academyPriority, preset.academyPriority),
    weights: normalizeWeights(source.weights),
    normalizedWeightsVersion: COACH_JOB_SECURITY_VERSION,
  };
  if (!weightsAlreadyNormalized) {
    profile.weights.classics = rounded(profile.weights.classics * (0.55 + (profile.classicImportance / 100) * 0.9), 2);
    profile.weights.fans = rounded(profile.weights.fans * (0.55 + (profile.fanInfluence / 100) * 0.9), 2);
    profile.weights.relegation = rounded(profile.weights.relegation * (0.55 + (profile.relegationAversion / 100) * 0.9), 2);
    profile.weights.achievements = rounded(profile.weights.achievements * (0.6 + (profile.titlePressure / 100) * 0.8), 2);
  }
  profile.meetingThreshold = normalizeProfileNumber(
    source.meetingThreshold,
    48 + ((50 - profile.badResultsTolerance) * 0.08) + ((50 - profile.politicalStability) * 0.05),
  );
  profile.ultimatumThreshold = normalizeProfileNumber(
    source.ultimatumThreshold,
    34 + ((50 - profile.badResultsTolerance) * 0.08) + ((50 - profile.politicalStability) * 0.05),
  );
  profile.dismissalThreshold = normalizeProfileNumber(
    source.dismissalThreshold,
    19 + ((50 - profile.badResultsTolerance) * 0.06),
  );
  return profile;
}

function normalizeUltimatum(value) {
  const id = text(value?.id);
  const coachId = text(value?.coachId);
  const clubId = text(value?.clubId);
  if (!id || !coachId || !clubId) return null;
  const allowed = new Set(['active', 'fulfilled', 'failed', 'cancelled']);
  return {
    ...clone(value),
    id,
    coachId,
    clubId,
    appointmentId: text(value?.appointmentId) || null,
    status: allowed.has(value?.status) ? value.status : 'active',
    title: text(value?.title) || 'Ultimato da diretoria',
    objective: {
      type: text(value?.objective?.type) || 'points',
      label: text(value?.objective?.label) || 'Somar pontos',
      target: finite(value?.objective?.target, 4),
    },
    startedSeason: integer(value?.startedSeason, 1, 1),
    startedRound: integer(value?.startedRound, 1, 1),
    deadlineSeason: integer(value?.deadlineSeason, integer(value?.startedSeason, 1, 1), 1),
    deadlineRound: integer(value?.deadlineRound, integer(value?.startedRound, 1, 1) + 3, 1),
    progress: finite(value?.progress, 0),
    consequence: text(value?.consequence) || 'A diretoria poderá iniciar o desligamento.',
    createdAt: timestamp(value?.createdAt),
    resolvedAt: timestamp(value?.resolvedAt),
    resolutionEvaluationId: text(value?.resolutionEvaluationId) || null,
  };
}

function normalizeSecurityHistory(value) {
  const id = text(value?.id);
  const coachId = text(value?.coachId);
  const clubId = text(value?.clubId);
  if (!id || !coachId || !clubId) return null;
  const previousScore = value?.previousScore == null ? null : rounded(clamp(finite(value.previousScore)), 1);
  return {
    id,
    evaluationId: text(value?.evaluationId) || null,
    coachId,
    clubId,
    appointmentId: text(value?.appointmentId) || null,
    occurredAt: timestamp(value?.occurredAt),
    previousLevel: text(value?.previousLevel) || null,
    newLevel: text(value?.newLevel) || 'stable',
    previousScore,
    newScore: rounded(clamp(finite(value?.newScore, 50)), 1),
    factors: list(value?.factors).slice(0, 10).map((entry) => ({
      code: text(entry?.code ?? entry?.id) || 'unknown',
      label: text(entry?.label) || null,
      impact: rounded(finite(entry?.impact, 0), 1),
    })),
    fanSupport: value?.fanSupport && typeof value.fanSupport === 'object' ? {
      value: rounded(clamp(finite(value.fanSupport.value, 50)), 1),
      state: text(value.fanSupport.state) || fanState(finite(value.fanSupport.value, 50)).state,
    } : null,
    boardPublicSupport: rounded(clamp(finite(value?.boardPublicSupport, 50)), 1),
    boardPrivateConfidence: rounded(clamp(finite(value?.boardPrivateConfidence, 50)), 1),
    relegation: value?.relegation && typeof value.relegation === 'object' ? {
      risk: rounded(clamp(finite(value.relegation.risk, 0)), 1),
      state: text(value.relegation.state) || 'safe',
      inZone: Boolean(value.relegation.inZone),
      confirmed: Boolean(value.relegation.confirmed),
      survivalSecured: Boolean(value.relegation.survivalSecured),
    } : null,
    classics: value?.classics && typeof value.classics === 'object' ? {
      played: integer(value.classics.played, 0),
      wins: integer(value.classics.wins, 0),
      draws: integer(value.classics.draws, 0),
      losses: integer(value.classics.losses, 0),
      winlessStreak: integer(value.classics.winlessStreak, 0),
      heavyLosses: integer(value.classics.heavyLosses, 0),
      eliminations: integer(value.classics.eliminations, 0),
      impact: rounded(finite(value.classics.impact, 0), 1),
    } : null,
    accumulatedCredit: value?.accumulatedCredit && typeof value.accumulatedCredit === 'object' ? {
      value: rounded(clamp(finite(value.accumulatedCredit.value, 0)), 1),
      delta: rounded(finite(value.accumulatedCredit.delta, 0), 1),
      label: text(value.accumulatedCredit.label) || null,
    } : null,
    decision: text(value?.decision) || 'retain',
    legacyDerived: Boolean(value?.legacyDerived),
  };
}

export function normalizeCoachJobSecurityState(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
  const fanSupportByClubId = source.fanSupportByClubId && typeof source.fanSupportByClubId === 'object'
    ? Object.fromEntries(Object.entries(source.fanSupportByClubId).map(([clubId, entry]) => [clubId, {
      value: rounded(clamp(finite(entry?.value, 50)), 1),
      state: text(entry?.state) || fanState(finite(entry?.value, 50)).state,
      updatedAt: timestamp(entry?.updatedAt),
      trend: text(entry?.trend) || 'stable',
    }]))
    : {};
  return {
    ...source,
    version: COACH_JOB_SECURITY_VERSION,
    profiles: uniqueById(list(source.profiles).map((profile) => {
      const normalized = normalizeProfile(profile);
      return normalized.clubId ? { ...normalized, id: text(profile?.id) || 'security-profile:' + key(normalized.clubId) } : null;
    }).filter(Boolean)),
    meetings: uniqueById(list(source.meetings).filter((entry) => text(entry?.id))),
    ultimatums: uniqueById(list(source.ultimatums).map(normalizeUltimatum).filter(Boolean)),
    history: uniqueById(list(source.history).map(normalizeSecurityHistory).filter(Boolean)),
    fanSupportByClubId,
    processedSignalIds: [...new Set(list(source.processedSignalIds).map(text).filter(Boolean))].slice(-2000),
  };
}

function competitionClubs(room, league) {
  return list(league?.clubs).length > 0
    ? list(league.clubs)
    : list(room?.competitionCatalog).flatMap((competition) => list(competition?.clubs));
}

function clubIdOf(value) {
  return text(value?.id ?? value?.clubId ?? value?.code);
}

function clubFor(room, clubId, league) {
  return competitionClubs(room, league).find((club) => sameClub(clubIdOf(club), clubId))
    ?? list(room?.tournamentCatalog).flatMap((tournament) => list(tournament?.participants))
      .find((club) => sameClub(clubIdOf(club), clubId))
    ?? { id: clubId };
}

function coachFor(room, coachId) {
  return list(room?.coachCareerState?.coaches).find((coach) => key(coach?.id) === key(coachId))
    ?? list(room?.managers).find((manager) => key(manager?.id) === key(coachId))
    ?? {};
}

function normalizedReputation(value) {
  const parsed = finite(value, 50);
  return clamp(parsed <= 20 ? parsed * 5 : parsed);
}

function inferredProfileType(club) {
  const explicit = text(club?.coachSecurityProfile?.type ?? club?.jobSecurityProfile?.type ?? club?.toleranceProfile);
  if (PROFILE_PRESETS[explicit]) return explicit;
  const reputation = normalizedReputation(club?.reputation);
  const politicalStability = finite(club?.politicalStability, 60);
  const academy = finite(club?.academyPriority ?? club?.youthPriority, 50);
  if (politicalStability < 38) return 'unstable';
  if (academy >= 78) return 'development';
  if (club?.newlyPromoted === true || text(club?.seasonObjective).includes('survival')) return 'survival';
  if (reputation >= 80) return 'elite';
  return 'structured';
}

export function resolveCoachSecurityProfile(room, state, clubId, league = null) {
  const stored = list(state?.profiles).find((profile) => sameClub(profile?.clubId, clubId));
  if (stored) return normalizeProfile(stored);
  const club = clubFor(room, clubId, league);
  const overrides = club?.coachSecurityProfile ?? club?.jobSecurityProfile ?? {};
  return normalizeProfile(overrides, { clubId, type: inferredProfileType(club) });
}

export function coachSecurityLevel(score, config = DEFAULT_COACH_JOB_SECURITY_CONFIG) {
  const thresholds = { ...DEFAULT_COACH_JOB_SECURITY_CONFIG.thresholds, ...(config?.thresholds ?? {}) };
  if (score >= thresholds.untouchable) return 'untouchable';
  if (score >= thresholds.very_safe) return 'very_safe';
  if (score >= thresholds.safe) return 'safe';
  if (score >= thresholds.stable) return 'stable';
  if (score >= thresholds.under_observation) return 'under_observation';
  if (score >= thresholds.pressured) return 'pressured';
  if (score >= thresholds.at_risk) return 'at_risk';
  if (score >= thresholds.very_pressured) return 'very_pressured';
  return 'imminent';
}

export function applyFanAtmosphereToFixture(room, fixture = {}) {
  const supportEntries = Object.entries(
    room?.coachEmploymentState?.jobSecurity?.fanSupportByClubId ?? {},
  );
  const support = supportEntries.find(([clubId]) => sameClub(clubId, fixture?.homeClubId))?.[1];
  const value = clamp(finite(support?.value, 50));
  const strengthModifier = rounded(clamp(((value - 50) / 50) * 0.35, -0.35, 0.35), 3);
  const strengthProfile = fixture?.strengthProfile && typeof fixture.strengthProfile === 'object'
    ? clone(fixture.strengthProfile)
    : null;
  if (strengthProfile?.home && Number.isFinite(Number(strengthProfile.home.effective))) {
    strengthProfile.home.effective = rounded(
      finite(strengthProfile.home.effective) + strengthModifier,
      3,
    );
    strengthProfile.home.fanAtmosphereBonus = strengthModifier;
  }
  return {
    ...fixture,
    homeStrength: rounded(finite(fixture?.homeStrength, 10) + strengthModifier, 3),
    ...(strengthProfile ? { strengthProfile } : {}),
    fanAtmosphere: {
      clubId: text(fixture?.homeClubId) || null,
      support: value,
      strengthModifier,
      state: text(support?.state) || fanState(value).state,
    },
  };
}

function matchRound(entry) {
  return integer(entry?.fixture?.calendarRound ?? entry?.fixture?.round ?? entry?.result?.round, 0);
}

function matchId(entry) {
  return text(entry?.fixture?.leagueFixtureId ?? entry?.fixture?.fixtureId ?? entry?.fixture?.id
    ?? entry?.result?.leagueFixtureId ?? entry?.result?.fixtureId ?? entry?.result?.id);
}

function outcomeFor(entry, clubId) {
  const home = sameClub(entry?.fixture?.homeClubId, clubId);
  const own = finite(entry?.score?.[home ? 0 : 1], 0);
  const rival = finite(entry?.score?.[home ? 1 : 0], 0);
  return {
    home,
    own,
    rival,
    margin: own - rival,
    points: own > rival ? 3 : own === rival ? 1 : 0,
    opponentClubId: text(home ? entry?.fixture?.awayClubId : entry?.fixture?.homeClubId),
  };
}

function rivalryRecords(room, league) {
  return [
    ...list(room?.rivalries),
    ...list(room?.classicRivalries),
    ...list(league?.rivalries),
  ];
}

function explicitRivalIds(club) {
  return [
    ...list(club?.rivalClubIds),
    ...list(club?.rivals),
    ...list(club?.classicRivals),
  ].map((entry) => text(typeof entry === 'string' ? entry : entry?.clubId ?? entry?.id)).filter(Boolean);
}

function classicImportance(entry, room, league, clubId) {
  const fixture = entry?.fixture ?? {};
  const outcome = outcomeFor(entry, clubId);
  if (fixture.isClassic === true || fixture.isDerby === true || text(fixture.rivalryId)) {
    return clamp(finite(fixture.rivalryImportance ?? fixture.classicImportance, 70));
  }
  const club = clubFor(room, clubId, league);
  if (explicitRivalIds(club).some((id) => sameClub(id, outcome.opponentClubId))) {
    return 70;
  }
  const rivalry = rivalryRecords(room, league).find((record) => {
    const ids = list(record?.clubIds ?? record?.clubs).map((id) => text(typeof id === 'string' ? id : id?.id ?? id?.clubId));
    const homeId = text(record?.homeClubId ?? record?.clubId);
    const awayId = text(record?.awayClubId ?? record?.rivalClubId);
    return (ids.some((id) => sameClub(id, clubId)) && ids.some((id) => sameClub(id, outcome.opponentClubId)))
      || (sameClub(homeId, clubId) && sameClub(awayId, outcome.opponentClubId))
      || (sameClub(awayId, clubId) && sameClub(homeId, outcome.opponentClubId));
  });
  return rivalry ? clamp(finite(rivalry.importance ?? rivalry.weight, 70)) : 0;
}

function buildClassicRecord(matches, room, league, clubId, profile) {
  const classics = matches.filter((entry) => classicImportance(entry, room, league, clubId) > 0);
  const summary = classics.reduce((record, entry) => {
    const outcome = outcomeFor(entry, clubId);
    const fixture = entry?.fixture ?? {};
    const importance = classicImportance(entry, room, league, clubId);
    const phase = text(fixture.stage ?? fixture.phase ?? fixture.roundName).toLocaleLowerCase('pt-BR');
    const phaseMultiplier = fixture.isElimination === true || /final|semi|quartas|mata/.test(phase) ? 1.25 : 1;
    const homeStrength = finite(fixture?.strengthProfile?.home?.effective ?? fixture.homeStrength, 10);
    const awayStrength = finite(fixture?.strengthProfile?.away?.effective ?? fixture.awayStrength, 10);
    const ownStrength = outcome.home ? homeStrength : awayStrength;
    const rivalStrength = outcome.home ? awayStrength : homeStrength;
    const qualityGap = ownStrength - rivalStrength;
    const resultImpact = outcome.points === 3 ? 8 : outcome.points === 1 ? 1 : -9;
    const marginImpact = outcome.margin > 0
      ? Math.min(4, outcome.margin * 1.2)
      : outcome.margin < 0
        ? -Math.min(8, Math.abs(outcome.margin) * 1.6)
        : 0;
    const expectationImpact = outcome.points === 3 && qualityGap < 0
      ? Math.min(4, Math.abs(qualityGap) * 0.45)
      : outcome.points === 0 && qualityGap > 0
        ? -Math.min(4, qualityGap * 0.45)
        : 0;
    const venueImpact = outcome.home && outcome.points === 0 ? -1.5 : !outcome.home && outcome.points === 3 ? 1.5 : 0;
    record.rawImpact += (resultImpact + marginImpact + expectationImpact + venueImpact)
      * (0.55 + importance / 100 * 0.9)
      * phaseMultiplier;
    record.played += 1;
    record.points += outcome.points;
    if (outcome.points === 3) {
      record.wins += 1;
      record.winlessStreak = 0;
    } else {
      if (outcome.points === 1) record.draws += 1;
      else record.losses += 1;
      record.winlessStreak += 1;
    }
    if (outcome.margin <= -3) record.heavyLosses += 1;
    if (entry?.fixture?.isElimination === true && outcome.points === 0) record.eliminations += 1;
    return record;
  }, { played: 0, wins: 0, draws: 0, losses: 0, points: 0, winlessStreak: 0, heavyLosses: 0, eliminations: 0, rawImpact: 0 });
  const ppg = summary.played > 0 ? summary.points / summary.played : 1.5;
  const baseImpact = summary.rawImpact
    - (Math.max(0, summary.winlessStreak - 1) * 3)
    - (summary.eliminations * 5);
  const weightedImpact = rounded(baseImpact * (0.55 + profile.classicImportance / 100 * 0.9), 1);
  return {
    played: summary.played,
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    points: summary.points,
    winlessStreak: summary.winlessStreak,
    heavyLosses: summary.heavyLosses,
    eliminations: summary.eliminations,
    pointsPerGame: rounded(ppg, 2),
    impact: weightedImpact,
    value: summary.played === 0 ? 50 : rounded(clamp(50 + weightedImpact * 2), 1),
  };
}

function totalLeagueRounds(room, league) {
  const explicit = integer(league?.totalRounds ?? league?.rounds, 0);
  if (explicit > 0) return explicit;
  const scheduled = list(room?.leagueFixtureSchedule)
    .filter((fixture) => sameClub(fixture?.leagueId, league?.id))
    .map((fixture) => integer(fixture?.round, 0));
  const maximum = scheduled.length > 0 ? Math.max(...scheduled) : 0;
  if (maximum > 0) return maximum;
  const clubs = list(league?.clubs).length;
  const legs = integer(league?.scheduleLegs ?? league?.legs, league?.turnAndReturn === false ? 1 : 2, 1, 4);
  return clubs > 1 ? (clubs - 1) * legs : 0;
}

function relegationSlotsFor(league, config) {
  const explicit = integer(league?.relegationSlots ?? league?.promotionRelegation?.relegationSlots, 0);
  if (explicit > 0) return explicit;
  const clubs = list(league?.clubs).length;
  return clubs >= 8 ? Math.max(1, Math.round(clubs * finite(config.relegationSlotsRatio, 0.2))) : 0;
}

function upcomingFixtureDifficulty(room, league, clubId, round) {
  const completed = new Set(list(room?.leagueMatchResults).map((result) => key(
    result?.leagueFixtureId ?? result?.fixtureId ?? result?.id,
  )));
  const ownReputation = normalizedReputation(clubFor(room, clubId, league)?.reputation);
  const opponents = list(room?.leagueFixtureSchedule)
    .filter((fixture) => (
      sameClub(fixture?.leagueId, league?.id)
      && integer(fixture?.round, 0) > round
      && (sameClub(fixture?.homeClubId, clubId) || sameClub(fixture?.awayClubId, clubId))
      && !completed.has(key(fixture?.leagueFixtureId ?? fixture?.fixtureId ?? fixture?.id))
    ))
    .sort((left, right) => integer(left?.round, 0) - integer(right?.round, 0))
    .slice(0, 5)
    .map((fixture) => {
      const isHome = sameClub(fixture?.homeClubId, clubId);
      const opponentId = isHome ? fixture?.awayClubId : fixture?.homeClubId;
      const opponentReputation = normalizedReputation(clubFor(room, opponentId, league)?.reputation);
      return 50 + (opponentReputation - ownReputation) * 0.45 + (isHome ? -3 : 3);
    });
  if (opponents.length === 0) return 50;
  return rounded(clamp(opponents.reduce((total, value) => total + value, 0) / opponents.length), 1);
}

function buildRelegationRisk(room, league, standings, clubId, round, previous, config, signals = {}) {
  const rows = list(standings);
  const index = rows.findIndex((row) => sameClub(row?.clubId, clubId));
  const position = index >= 0 ? index + 1 : null;
  const slots = relegationSlotsFor(league, config);
  const zoneStart = slots > 0 ? Math.max(1, rows.length - slots + 1) : null;
  const inZone = Boolean(position && zoneStart && position >= zoneStart);
  const totalRounds = totalLeagueRounds(room, league);
  const played = index >= 0 ? integer(rows[index]?.played, round) : round;
  const remaining = Math.max(0, totalRounds - played);
  const safetyRow = zoneStart && zoneStart > 1 ? rows[zoneStart - 2] : null;
  const points = index >= 0 ? integer(rows[index]?.points, 0) : 0;
  const safetyPoints = integer(safetyRow?.points, points);
  const pointsGap = inZone ? Math.max(0, safetyPoints - points + 1) : Math.max(0, points - safetyPoints);
  const confirmed = inZone && remaining >= 0 && (points + remaining * 3) < safetyPoints;
  const previousInZone = Boolean(previous?.inZone);
  const consecutiveRounds = inZone
    ? (previousInZone ? integer(previous?.consecutiveRounds, 0) + 1 : 1)
    : 0;
  const survivalSecured = !inZone
    && totalRounds > 0
    && remaining === 0
    && (Boolean(previous?.inZone) || finite(previous?.risk, 0) >= 20);
  const fixtureDifficulty = upcomingFixtureDifficulty(room, league, clubId, round);
  const recentValue = clamp(finite(signals.recentValue, 50));
  let risk = 0;
  if (slots > 0 && position) {
    const proximity = clamp(50 + ((position - zoneStart) * 12), 0, 100);
    const gapRisk = remaining > 0 ? clamp((pointsGap / Math.max(3, remaining * 1.2)) * 100) : (inZone ? 100 : 0);
    risk = inZone ? Math.max(55, proximity, gapRisk) : clamp(40 - pointsGap * 5 + Math.max(0, 8 - remaining), 0, 55);
  }
  if (consecutiveRounds >= 3) risk = clamp(risk + Math.min(18, (consecutiveRounds - 2) * 4));
  if (!confirmed && !survivalSecured && slots > 0) {
    risk = clamp(risk
      + (50 - recentValue) * 0.12
      + (fixtureDifficulty - 50) * 0.12);
  }
  if (confirmed) risk = 100;
  if (survivalSecured) risk = 0;
  const state = confirmed
    ? 'confirmed'
    : survivalSecured
      ? 'survival_secured'
      : consecutiveRounds >= 3
        ? 'prolonged_zone'
        : inZone
          ? 'in_zone'
          : risk >= 45
            ? 'at_risk'
            : risk >= 20
              ? 'watch'
              : 'safe';
  const labels = {
    confirmed: 'Rebaixamento confirmado',
    survival_secured: 'Permanência conquistada',
    prolonged_zone: 'Permanência prolongada na zona',
    in_zone: 'Na zona de rebaixamento',
    at_risk: 'Risco elevado',
    watch: 'Sob atenção',
    safe: 'Fora de risco',
  };
  return {
    risk: rounded(risk, 1),
    value: rounded(100 - risk, 1),
    state,
    label: labels[state],
    position,
    zoneStart,
    slots,
    inZone,
    consecutiveRounds,
    confirmed,
    survivalSecured,
    totalRounds,
    remainingMatches: remaining,
    pointsGap,
    recentFormValue: recentValue,
    upcomingFixtureDifficulty: fixtureDifficulty,
  };
}

function fanState(value) {
  if (value >= 90) return { state: 'idolized', label: 'Idolatrado' };
  if (value >= 76) return { state: 'very_high', label: 'Apoio muito alto' };
  if (value >= 61) return { state: 'moderate', label: 'Apoio moderado' };
  if (value >= 46) return { state: 'divided', label: 'Torcida dividida' };
  if (value >= 32) return { state: 'pressured', label: 'Pressionado' };
  if (value >= 18) return { state: 'rejected', label: 'Rejeitado' };
  return { state: 'unsustainable', label: 'Ambiente insustentável' };
}

function trendFromDelta(delta) {
  if (delta >= 2) return 'rising';
  if (delta <= -2) return 'falling';
  return 'stable';
}

function publicDeclarationSignal(room, clubId, previousAt) {
  const after = timestamp(previousAt);
  const seen = new Set();
  let count = 0;
  let impact = 0;
  for (const match of list(room?.completedMatches)) {
    for (const submission of list(match?.pressConferenceSubmissions)) {
      if (!sameClub(submission?.clubId, clubId)) continue;
      const submittedAt = timestamp(submission?.submittedAt);
      if (after && (!submittedAt || submittedAt <= after)) continue;
      const signalId = text(submission?.matchId) + ':' + text(submission?.managerId);
      if (!signalId || seen.has(signalId)) continue;
      seen.add(signalId);
      count += 1;
      impact += clamp(finite(submission?.effects?.squadMoraleDelta, 0) * 1.4, -7, 7);
    }
  }
  return { count, impact: rounded(clamp(impact, -12, 12), 1) };
}

function buildFanSupport(previous, recentValue, competitionValue, classics, context, profile, now, declarations) {
  const previousValue = finite(previous?.value, 50);
  const titleBoost = Math.min(12, integer(context?.titles, 0) * 4);
  const tenureBoost = Math.min(5, integer(context?.tenureMatches, 0) / 20);
  const target = clamp(
    44
      + ((recentValue - 50) * 0.38)
      + ((competitionValue - 50) * 0.18)
      + classics.impact
      + titleBoost
      + tenureBoost
      + finite(declarations?.impact, 0),
  );
  const responsiveness = 0.24 + (profile.fanInfluence / 100) * 0.24;
  const value = rounded(previousValue + (target - previousValue) * responsiveness, 1);
  const delta = rounded(value - previousValue, 1);
  const state = fanState(value);
  return {
    value,
    ...state,
    delta,
    trend: trendFromDelta(delta),
    publicDeclarations: clone(declarations),
    updatedAt: now,
  };
}

function boardState(value) {
  if (value >= 88) return { state: 'total', label: 'Apoio total' };
  if (value >= 74) return { state: 'strong', label: 'Apoio forte' };
  if (value >= 58) return { state: 'moderate', label: 'Confiança moderada' };
  if (value >= 44) return { state: 'review', label: 'Em avaliação' };
  if (value >= 30) return { state: 'reduced', label: 'Apoio reduzido' };
  if (value >= 16) return { state: 'lost', label: 'Confiança perdida' };
  return { state: 'exit', label: 'Desligamento em avaliação' };
}

function buildBoardSupport(coach, previous, performanceValue, objectivesValue, relegation, fanSupport, profile, squadValue, financeValue) {
  const previousPrivate = finite(
    previous?.privateValue ?? coach?.boardConfidence ?? coach?.boardRelationship ?? coach?.satisfaction,
    55,
  );
  const target = clamp(
    52
      + ((performanceValue - 50) * 0.32)
      + ((objectivesValue - 50) * 0.25)
      - (relegation.risk * profile.relegationAversion / 100 * 0.2)
      + ((fanSupport.value - 50)
        * (profile.fanInfluence / 100)
        * (1.15 - profile.presidentPower / 180 + (100 - profile.politicalStability) / 280)
        * 0.22)
      + ((squadValue - 50) * 0.1)
      + ((financeValue - 50) * 0.04),
  );
  const privateValue = rounded(previousPrivate + (target - previousPrivate) * 0.34, 1);
  const privateState = boardState(privateValue);
  const publicShield = privateValue < 55 ? profile.presidentPower / 10 : -2;
  const publicValue = rounded(clamp(privateValue + publicShield), 1);
  const publicState = boardState(publicValue);
  const realIntent = privateValue < 16
    ? 'dismiss'
    : privateValue < 30
      ? 'seek_replacement'
      : privateValue < 44
        ? 'ultimatum'
        : privateValue < 58
          ? 'monitor'
          : 'retain';
  return {
    publicValue,
    publicState: publicState.state,
    publicLabel: publicState.label,
    privateValue,
    privateState: privateState.state,
    privateLabel: privateState.label,
    realIntent,
  };
}

function creditLabel(value) {
  if (value >= 80) return 'Crédito histórico';
  if (value >= 60) return 'Crédito alto';
  if (value >= 40) return 'Crédito moderado';
  if (value >= 20) return 'Pouco crédito';
  return 'Crédito esgotado';
}

function buildAccumulatedCredit(previous, context, newMatches, classics) {
  const previousValue = previous?.value == null
    ? clamp(12 + integer(context?.titles, 0) * 10 + Math.min(22, integer(context?.tenureMatches, 0) * 0.3))
    : finite(previous.value, 12);
  let delta = 0;
  for (const entry of newMatches) {
    const outcome = entry.outcome;
    delta += outcome.points === 3 ? 1.2 : outcome.points === 0 ? -1.6 : 0.1;
    if (entry.classicImportance > 0) {
      delta += outcome.points === 3 ? 3.5 : outcome.points === 0 ? -4.5 : 0;
      if (outcome.margin <= -3) delta -= 4;
    }
  }
  if (classics.winlessStreak >= 3) delta -= 2;
  const titleDelta = Math.max(0, integer(context?.titles, 0) - integer(previous?.knownTitles, integer(context?.titles, 0)));
  delta += titleDelta * 8;
  const value = rounded(clamp(previousValue + delta), 1);
  return { value, label: creditLabel(value), delta: rounded(value - previousValue, 1), knownTitles: integer(context?.titles, 0) };
}

function memoryEvents(previous, newMatches, season, round) {
  const existing = list(previous).map((entry) => {
    const age = Math.max(0, round - integer(entry?.lastRound ?? entry?.round, round));
    const severe = Boolean(entry?.severe);
    const decay = severe ? 0.965 ** age : 0.82 ** age;
    return { ...entry, impact: rounded(finite(entry?.impact, 0) * decay, 2), lastRound: round };
  }).filter((entry) => Math.abs(entry.impact) >= 0.5);
  const additions = newMatches.flatMap((entry) => {
    const id = 'security-signal:s' + season + ':' + (matchId(entry.match) || matchRound(entry.match));
    if (entry.classicImportance > 0 && entry.outcome.points === 0) {
      const severe = entry.outcome.margin <= -3;
      return [{
        id,
        type: severe ? 'classic_heavy_loss' : 'classic_loss',
        label: severe ? 'Goleada sofrida em clássico' : 'Derrota em clássico',
        impact: severe ? -12 : -6,
        severe,
        round: matchRound(entry.match),
        lastRound: round,
      }];
    }
    if (entry.classicImportance > 0 && entry.outcome.points === 3) {
      return [{
        id,
        type: 'classic_win',
        label: 'Vitória em clássico',
        impact: 6,
        severe: false,
        round: matchRound(entry.match),
        lastRound: round,
      }];
    }
    return [];
  });
  return uniqueById([...existing, ...additions]).slice(-50);
}

function dimension(id, value, weight, previous, justification, now) {
  const previousValue = finite(previous?.value, value);
  return {
    id,
    label: DIMENSION_LABELS[id] ?? id,
    value: rounded(clamp(value), 1),
    weight: rounded(Math.max(0, weight), 2),
    trend: trendFromDelta(value - previousValue),
    justification,
    updatedAt: now,
  };
}

function weightedScore(dimensions) {
  const weight = dimensions.reduce((total, item) => total + item.weight, 0);
  if (weight <= 0) return 50;
  return dimensions.reduce((total, item) => total + item.value * item.weight, 0) / weight;
}

function factor(code, impact, label, detail, evidence = {}) {
  return { code, impact: rounded(impact, 1), label, detail, evidence };
}

function recentMatchesValue(matches, clubId) {
  const recent = [...matches].sort((left, right) => matchRound(left) - matchRound(right)).slice(-5);
  const points = recent.reduce((total, entry) => total + outcomeFor(entry, clubId).points, 0);
  return {
    matches: recent.length,
    points,
    value: recent.length > 0 ? rounded((points / (recent.length * 3)) * 100, 1) : 50,
  };
}

function ultimatumProgress(ultimatum, matches, clubId, relegation, currentRound, room, league) {
  const relevant = matches.filter((entry) => matchRound(entry) > ultimatum.startedRound && matchRound(entry) <= currentRound);
  if (ultimatum.objective.type === 'leave_relegation_zone') {
    return { progress: relegation.inZone ? 0 : 1, fulfilled: !relegation.inZone };
  }
  if (ultimatum.objective.type === 'win_classic') {
    const victories = relevant.filter((entry) => (
      classicImportance(entry, room, league, clubId) > 0
      && outcomeFor(entry, clubId).points === 3
    )).length;
    return { progress: victories, fulfilled: victories >= ultimatum.objective.target };
  }
  const points = relevant.reduce((total, entry) => total + outcomeFor(entry, clubId).points, 0);
  return { progress: points, fulfilled: points >= ultimatum.objective.target };
}

function createUltimatum(appointment, evaluationId, season, round, now, relegation, classics, config) {
  const objective = relegation.inZone
    ? { type: 'leave_relegation_zone', label: 'Sair da zona de rebaixamento', target: 1 }
    : classics.winlessStreak >= 2
      ? { type: 'win_classic', label: 'Vencer o próximo clássico', target: 1 }
      : { type: 'points', label: 'Somar ao menos 4 pontos nos próximos 3 jogos', target: 4 };
  return normalizeUltimatum({
    id: 'coach-security-ultimatum:' + appointment.id + ':s' + season + ':r' + round,
    coachId: appointment.coachId,
    clubId: appointment.clubId,
    appointmentId: appointment.id,
    status: 'active',
    title: 'Ultimato por recuperação imediata',
    objective,
    startedSeason: season,
    startedRound: round,
    deadlineSeason: season,
    deadlineRound: round + integer(config.ultimatumRounds, 3, 1, 8),
    progress: 0,
    consequence: 'O descumprimento inicia o processo de desligamento.',
    createdAt: now,
    resolutionEvaluationId: evaluationId,
  });
}

function publicPrivateEstimate(board, knownSource) {
  if (knownSource) {
    return {
      min: Math.max(0, Math.floor(board.privateValue / 10) * 10 - 5),
      max: Math.min(100, Math.floor(board.privateValue / 10) * 10 + 5),
      label: board.privateLabel,
      source: knownSource,
    };
  }
  const center = Math.round(board.publicValue / 20) * 20;
  return {
    min: Math.max(0, center - 15),
    max: Math.min(100, center + 15),
    label: 'Estimativa sem confirmação interna',
    source: 'public_signals',
  };
}

function recommendationFor(score, profile, minimumGamesMet, ultimatumOutcome, relegation, board) {
  if (ultimatumOutcome === 'failed') return 'dismiss';
  if (relegation.confirmed && board.privateValue < 40) return 'dismiss';
  if (!minimumGamesMet) return 'insufficient_data';
  if (score < profile.dismissalThreshold) return 'dismiss';
  if (score < profile.meetingThreshold) return 'review';
  return 'retain';
}

export function evaluateCoachJobSecurity(input = {}) {
  const room = input.room ?? {};
  const employmentState = input.employmentState ?? {};
  const appointment = input.appointment ?? {};
  const now = timestamp(input.now) ?? new Date().toISOString();
  const round = integer(input.round, 0);
  const season = integer(input.seasonNumber, 1, 1);
  const evaluationId = text(input.evaluationId) || 'coach-evaluation:' + appointment.id + ':s' + season + ':r' + round;
  const jobState = normalizeCoachJobSecurityState(employmentState.jobSecurity);
  const persistedEvaluation = list(employmentState.evaluations)
    .find((entry) => text(entry?.id) === evaluationId);
  if (persistedEvaluation) {
    return { evaluation: clone(persistedEvaluation), jobSecurityState: jobState, actions: [], duplicate: true };
  }
  const alreadyProcessedSignals = new Set(jobState.processedSignalIds);
  const profile = resolveCoachSecurityProfile(room, jobState, appointment.clubId, input.league);
  if (!jobState.profiles.some((entry) => sameClub(entry.clubId, profile.clubId))) {
    jobState.profiles.push({ ...profile, id: 'security-profile:' + key(profile.clubId) });
  }
  const matches = list(input.relevantMatches)
    .filter((entry) => list(entry?.score).length >= 2)
    .sort((left, right) => matchRound(left) - matchRound(right) || matchId(left).localeCompare(matchId(right), 'pt-BR'));
  const previousEvaluation = list(employmentState.evaluations)
    .filter((entry) => (
      entry?.id !== evaluationId
      && (
        entry?.appointmentId === appointment.id
        || (
          !entry?.appointmentId
          && text(entry?.coachId) === text(appointment.coachId)
          && sameClub(entry?.clubId, appointment.clubId)
        )
      )
    ))
    .sort((left, right) => integer(left?.seasonNumber) - integer(right?.seasonNumber)
      || integer(left?.round) - integer(right?.round))
    .at(-1) ?? null;
  const previousDimensions = new Map(list(previousEvaluation?.dimensions).map((item) => [item.id, item]));
  const statistics = input.statistics ?? {};
  const games = integer(statistics.games, 0);
  const points = integer(statistics.points, 0);
  const ppg = games > 0 ? points / games : 0;
  const expectation = input.expectation ?? { expectedPosition: null, expectedPointsPerGame: 1.35 };
  const expectedPosition = integer(expectation.expectedPosition, 1, 1);
  const position = input.position == null ? null : integer(input.position, 1, 1);
  const context = buildCoachEvaluationContext(room, {
    coachId: appointment.coachId,
    clubId: appointment.clubId,
    appointment,
    contract: input.contract,
    league: input.league,
    expectedPosition,
  });
  const recent = recentMatchesValue(matches, appointment.clubId);
  const classics = buildClassicRecord(matches, room, input.league, appointment.clubId, profile);
  const relegation = buildRelegationRisk(
    room,
    input.league,
    input.standings,
    appointment.clubId,
    round,
    previousEvaluation?.relegation,
    { ...DEFAULT_COACH_JOB_SECURITY_CONFIG, ...(input.config ?? {}) },
    { recentValue: recent.value },
  );
  const performanceValue = games > 0
    ? clamp(50 + (ppg - finite(expectation.expectedPointsPerGame, 1.35)) * 28)
    : 50;
  const competitionValue = position == null
    ? 50
    : clamp(50 + (expectedPosition - position) * 7);
  const objectivesValue = clamp(
    50
      + integer(context.evidence?.boardObjectivesCompleted, 0) * 14
      - integer(context.evidence?.boardObjectivesFailed, 0) * 22,
  );
  const squadMorale = list(room?.clubMoraleStates).find((entry) => sameClub(entry?.clubId, appointment.clubId));
  const squadValue = clamp(finite(squadMorale?.score, 50));
  const finance = list(room?.marketState?.finances).find((entry) => sameClub(entry?.clubId, appointment.clubId));
  const financeValue = Number(finance?.balance) < 0 ? 20 : Number(finance?.balance) === 0 ? 50 : 65;
  const coach = coachFor(room, appointment.coachId);
  const club = clubFor(room, appointment.clubId, input.league);
  const reputationGap = normalizedReputation(coach?.reputation) - normalizedReputation(club?.reputation);
  const reputationValue = clamp(50 + reputationGap * 0.8);
  const titles = integer(context.evidence?.titles, 0);
  const achievementsValue = clamp(48 + titles * 11 - list(context.evidence?.cupEliminations).length * 8);
  const tenureMatches = integer(context.evidence?.tenureMatches, games);
  const tenureValue = clamp(40 + Math.min(48, tenureMatches * 0.8));
  const expectationsValue = clamp((performanceValue * 0.55) + (competitionValue * 0.45));
  const previousFan = jobState.fanSupportByClubId[appointment.clubId] ?? previousEvaluation?.fanSupport;
  const declarationSignal = publicDeclarationSignal(
    room,
    appointment.clubId,
    previousEvaluation?.updatedAt ?? previousEvaluation?.evaluatedAt,
  );
  const fanSupport = buildFanSupport(
    previousFan,
    recent.value,
    competitionValue,
    classics,
    context.evidence,
    profile,
    now,
    declarationSignal,
  );
  jobState.fanSupportByClubId[appointment.clubId] = clone(fanSupport);
  const board = buildBoardSupport(
    coach,
    previousEvaluation?.boardSupport,
    performanceValue,
    objectivesValue,
    relegation,
    fanSupport,
    profile,
    squadValue,
    financeValue,
  );
  const newMatches = matches
    .filter((entry) => matchRound(entry) > integer(previousEvaluation?.round, 0))
    .map((match) => ({
      match,
      outcome: outcomeFor(match, appointment.clubId),
      classicImportance: classicImportance(match, room, input.league, appointment.clubId),
    }));
  const accumulatedCredit = buildAccumulatedCredit(
    previousEvaluation?.accumulatedCredit,
    context.evidence,
    newMatches,
    classics,
  );
  const dimensions = [
    dimension('sportingPerformance', performanceValue, profile.weights.sportingPerformance, previousDimensions.get('sportingPerformance'), 'Pontuação por jogo comparada à expectativa do clube.', now),
    dimension('objectives', objectivesValue, profile.weights.objectives, previousDimensions.get('objectives'), 'Metas contratuais concluídas e não cumpridas.', now),
    dimension('recentForm', recent.value, profile.weights.recentForm, previousDimensions.get('recentForm'), recent.matches + ' jogo(s) recentes, ' + recent.points + ' ponto(s).', now),
    dimension('classics', classics.value, profile.weights.classics, previousDimensions.get('classics'), classics.played + ' clássico(s), ' + classics.wins + ' vitória(s) e ' + classics.losses + ' derrota(s).', now),
    dimension('competitionSituation', competitionValue, profile.weights.competitionSituation, previousDimensions.get('competitionSituation'), position == null ? 'Tabela ainda sem posição confiável.' : position + 'º lugar para expectativa de ' + expectedPosition + 'º.', now),
    dimension('relegation', relegation.value, profile.weights.relegation, previousDimensions.get('relegation'), relegation.label + '.', now),
    dimension('fans', fanSupport.value, profile.weights.fans, previousDimensions.get('fans'), fanSupport.label + '.', now),
    dimension('board', board.privateValue, profile.weights.board, previousDimensions.get('board'), board.privateLabel + '.', now),
    dimension('squad', squadValue, profile.weights.squad, previousDimensions.get('squad'), 'Moral persistida do elenco.', now),
    dimension('finance', financeValue, profile.weights.finance, previousDimensions.get('finance'), financeValue < 50 ? 'Clube opera com saldo negativo.' : 'Situação financeira sem crise registrada.', now),
    dimension('reputation', reputationValue, profile.weights.reputation, previousDimensions.get('reputation'), 'Compatibilidade entre reputação do treinador e do clube.', now),
    dimension('achievements', achievementsValue, profile.weights.achievements, previousDimensions.get('achievements'), titles + ' título(s) persistido(s) e eliminações recentes.', now),
    dimension('tenure', tenureValue, profile.weights.tenure, previousDimensions.get('tenure'), tenureMatches + ' partida(s) registradas no vínculo.', now),
    dimension('expectations', expectationsValue, profile.weights.expectations, previousDimensions.get('expectations'), 'Entrega atual comparada às expectativas iniciais.', now),
  ];
  const config = { ...DEFAULT_COACH_JOB_SECURITY_CONFIG, ...(input.config ?? {}) };
  let targetScore = weightedScore(dimensions)
    + ((accumulatedCredit.value - 50) * (0.04 + profile.projectPatience / 100 * 0.1));
  const memory = memoryEvents(previousEvaluation?.memory, newMatches, season, round);
  targetScore += memory.reduce((total, entry) => total + finite(entry?.impact, 0), 0) * 0.22;
  if (relegation.confirmed) targetScore -= 18 * (profile.relegationAversion / 100);
  if (relegation.survivalSecured && previousEvaluation?.relegation?.inZone) targetScore += 10;

  const actions = [];
  const previousFanValue = finite(previousEvaluation?.fanSupport?.value, 50);
  if (fanSupport.value < 18 && previousFanValue >= 18) {
    actions.push({
      type: 'COACH_SECURITY_FAN_PROTEST',
      operationId: evaluationId + ':fan-protest',
      title: 'Protesto da torcida',
      message: 'A rejeiÃ§Ã£o chegou a um nÃ­vel insustentÃ¡vel e aumentou a pressÃ£o sobre a diretoria.',
    });
  }
  let ultimatumOutcome = null;
  let activeUltimatum = jobState.ultimatums.find((entry) => (
    entry.status === 'active'
      && entry.appointmentId === appointment.id
  )) ?? null;
  if (activeUltimatum) {
    const progress = ultimatumProgress(
      activeUltimatum,
      matches,
      appointment.clubId,
      relegation,
      round,
      room,
      input.league,
    );
    activeUltimatum.progress = progress.progress;
    if (progress.fulfilled) {
      activeUltimatum.status = 'fulfilled';
      activeUltimatum.resolvedAt = now;
      activeUltimatum.resolutionEvaluationId = evaluationId;
      targetScore += 9;
      accumulatedCredit.value = rounded(clamp(accumulatedCredit.value + 5), 1);
      accumulatedCredit.delta = rounded(accumulatedCredit.delta + 5, 1);
      ultimatumOutcome = 'fulfilled';
      actions.push({
        type: 'COACH_SECURITY_ULTIMATUM_FULFILLED',
        operationId: activeUltimatum.id + ':fulfilled',
        title: 'Ultimato cumprido',
        message: 'A diretoria reconheceu a recuperação e devolveu parte da confiança.',
        ultimatumId: activeUltimatum.id,
      });
    } else if (season > activeUltimatum.deadlineSeason
      || (season === activeUltimatum.deadlineSeason && round >= activeUltimatum.deadlineRound)) {
      activeUltimatum.status = 'failed';
      activeUltimatum.resolvedAt = now;
      activeUltimatum.resolutionEvaluationId = evaluationId;
      targetScore -= 18;
      ultimatumOutcome = 'failed';
      actions.push({
        type: 'COACH_SECURITY_ULTIMATUM_FAILED',
        operationId: activeUltimatum.id + ':failed',
        title: 'Ultimato não cumprido',
        message: 'A diretoria iniciou a avaliação formal de desligamento.',
        ultimatumId: activeUltimatum.id,
      });
    }
  }

  const previousScore = previousEvaluation ? finite(previousEvaluation.score, 55) : null;
  const critical = relegation.confirmed || ultimatumOutcome === 'failed'
    || newMatches.some((entry) => entry.classicImportance > 0 && entry.outcome.margin <= -3);
  const maximumChange = critical ? config.maximumCriticalChange : config.maximumNormalChange;
  const smoothed = previousScore == null
    ? targetScore
    : previousScore + clamp((targetScore - previousScore) * config.evaluationSmoothing, -maximumChange, maximumChange);
  let score = rounded(clamp(smoothed), 0);
  let level = coachSecurityLevel(score, config);

  if (!activeUltimatum && games >= integer(input.minimumGames, 5, 1)
    && (score <= profile.ultimatumThreshold || relegation.confirmed || relegation.consecutiveRounds >= 3)) {
    activeUltimatum = createUltimatum(appointment, evaluationId, season, round, now, relegation, classics, config);
    jobState.ultimatums.push(activeUltimatum);
    actions.push({
      type: 'COACH_SECURITY_ULTIMATUM_CREATED',
      operationId: activeUltimatum.id,
      title: 'Diretoria estabelece ultimato',
      message: activeUltimatum.objective.label + '. Prazo: rodada ' + activeUltimatum.deadlineRound + '.',
      ultimatumId: activeUltimatum.id,
    });
  }

  const existingMeeting = jobState.meetings.find((entry) => (
    entry.appointmentId === appointment.id && entry.seasonNumber === season && entry.round === round
  ));
  if (!existingMeeting && games >= integer(input.minimumGames, 5, 1) && score <= profile.meetingThreshold) {
    const meeting = {
      id: 'coach-security-meeting:' + appointment.id + ':s' + season + ':r' + round,
      coachId: appointment.coachId,
      clubId: appointment.clubId,
      appointmentId: appointment.id,
      seasonNumber: season,
      round,
      type: activeUltimatum?.status === 'active' ? 'ultimatum' : 'performance_review',
      status: 'completed',
      decision: activeUltimatum?.status === 'active' ? 'ultimatum' : 'monitor',
      occurredAt: now,
    };
    jobState.meetings.push(meeting);
    actions.push({
      type: 'COACH_SECURITY_MEETING_HELD',
      operationId: meeting.id,
      title: 'Reunião de avaliação',
      message: activeUltimatum?.status === 'active'
        ? 'A diretoria formalizou condições para a continuidade.'
        : 'A diretoria cobrou recuperação de desempenho.',
      meetingId: meeting.id,
    });
  }

  if (ultimatumOutcome === 'failed') {
    board.realIntent = 'dismiss';
    board.privateValue = Math.min(board.privateValue, 12);
    score = Math.min(score, 18);
    level = coachSecurityLevel(score, config);
  }
  const trendDelta = rounded(score - (previousScore ?? score), 1);
  const trend = {
    direction: trendFromDelta(trendDelta),
    delta: trendDelta,
    label: trendDelta >= 6 ? 'Melhora forte' : trendDelta >= 2 ? 'Em melhora' : trendDelta <= -6 ? 'Piora forte' : trendDelta <= -2 ? 'Em queda' : 'Estável',
  };
  const knownPrivateSource = activeUltimatum?.status === 'active'
    ? 'ultimatum'
    : actions.some((action) => action.type === 'COACH_SECURITY_MEETING_HELD')
      ? 'board_meeting'
      : null;
  board.privateEstimate = publicPrivateEstimate(board, knownPrivateSource);
  board.privateKnownSource = knownPrivateSource;

  const factors = [];
  factors.push(factor(
    ppg >= finite(expectation.expectedPointsPerGame, 1.35) ? 'results_above_expectation' : 'results_below_expectation',
    (performanceValue - 50) / 3,
    ppg >= finite(expectation.expectedPointsPerGame, 1.35) ? 'Resultados acima da expectativa' : 'Resultados abaixo da expectativa',
    'Média de ' + rounded(ppg, 2) + ' ponto(s) por jogo; expectativa de ' + rounded(finite(expectation.expectedPointsPerGame, 1.35), 2) + '.',
  ));
  if (position != null) factors.push(factor(
    position <= expectedPosition ? 'position_above_expectation' : 'position_below_expectation',
    (competitionValue - 50) / 4,
    position <= expectedPosition ? 'Posição acima da expectativa' : 'Posição abaixo da expectativa',
    position + 'º lugar; objetivo projetado de ' + expectedPosition + 'º.',
  ));
  if (recent.matches >= 3 && recent.value < 40) factors.push(factor('poor_recent_run', (recent.value - 50) / 4, 'Sequência recente ruim', recent.points + ' ponto(s) nos últimos ' + recent.matches + ' jogos.'));
  if (classics.played > 0) factors.push(factor(
    classics.impact >= 0 ? 'classic_support' : 'classic_pressure',
    classics.impact,
    classics.impact >= 0 ? 'Bom desempenho em clássicos' : 'Pressão nos clássicos',
    classics.wins + ' vitória(s), ' + classics.losses + ' derrota(s), ' + classics.winlessStreak + ' sem vencer.',
  ));
  if (classics.heavyLosses > 0) factors.push(factor('classic_heavy_losses', -(classics.heavyLosses * 7), 'Goleada sofrida para rival', classics.heavyLosses + ' goleada(s) persistem na memória institucional.'));
  if (relegation.risk >= 20 || relegation.survivalSecured) factors.push(factor(
    relegation.survivalSecured ? 'survival_secured' : relegation.confirmed ? 'relegation_confirmed' : relegation.inZone ? 'relegation_zone' : 'relegation_risk',
    relegation.survivalSecured ? 10 : -(relegation.risk / 5),
    relegation.label,
    relegation.inZone ? relegation.consecutiveRounds + ' rodada(s) consecutiva(s) na zona.' : 'Risco estimado em ' + Math.round(relegation.risk) + '%.',
  ));
  factors.push(factor(
    fanSupport.value >= 50 ? 'fan_support' : 'fan_pressure',
    (fanSupport.value - 50) / 5,
    fanSupport.label,
    'Apoio da torcida em ' + Math.round(fanSupport.value) + '/100.',
  ));
  if (declarationSignal.impact !== 0) factors.push(factor(
    declarationSignal.impact > 0 ? 'public_declarations_support' : 'public_declarations_pressure',
    declarationSignal.impact,
    declarationSignal.impact > 0 ? 'Boa repercussÃ£o das declaraÃ§Ãµes' : 'DeclaraÃ§Ãµes aumentaram a pressÃ£o',
    declarationSignal.count + ' coletiva(s) desde a Ãºltima avaliaÃ§Ã£o.',
  ));
  factors.push(factor(
    board.privateValue >= 50 ? 'board_support' : 'board_confidence_low',
    (board.privateValue - 50) / 5,
    board.privateLabel,
    'Apoio público: ' + board.publicLabel + '.',
  ));
  factors.push(factor(
    squadValue >= 50 ? 'squad_support' : 'squad_unrest',
    (squadValue - 50) / 10,
    squadValue >= 50 ? 'Apoio do elenco' : 'Insatisfação do elenco',
    'Moral do grupo em ' + Math.round(squadValue) + '/100.',
  ));
  if (financeValue < 50) factors.push(factor('financial_pressure', -5, 'Pressão financeira', 'Saldo do clube está negativo.'));
  factors.push(...context.factors);
  if (games < integer(input.minimumGames, 5, 1)) factors.push(factor('insufficient_matches', 0, 'Amostra de jogos insuficiente', 'A diretoria ainda reúne evidências.'));
  const meaningfulFactors = factors
    .filter((entry) => entry && (entry.impact !== 0 || entry.code === 'insufficient_matches'))
    .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
    .slice(0, 30);
  const recommendation = recommendationFor(
    score,
    profile,
    games >= integer(input.minimumGames, 5, 1),
    ultimatumOutcome,
    relegation,
    board,
  );
  const evaluation = {
    id: evaluationId,
    coachId: appointment.coachId,
    clubId: appointment.clubId,
    appointmentId: appointment.id,
    role: appointment.role,
    evaluatedAt: now,
    updatedAt: now,
    seasonNumber: season,
    round,
    games,
    points,
    wins: integer(statistics.wins, 0),
    draws: integer(statistics.draws, 0),
    losses: integer(statistics.losses, 0),
    goalsFor: integer(statistics.goalsFor, 0),
    goalsAgainst: integer(statistics.goalsAgainst, 0),
    position,
    expectedPosition,
    score,
    rawScore: rounded(clamp(targetScore), 1),
    securityLevel: level,
    securityLabel: LEVEL_LABELS[level],
    recommendation,
    factors: meaningfulFactors,
    positiveFactors: meaningfulFactors.filter((entry) => entry.impact > 0),
    negativeFactors: meaningfulFactors.filter((entry) => entry.impact < 0),
    dimensions,
    trend,
    fanSupport,
    boardSupport: board,
    classics,
    relegation,
    accumulatedCredit,
    memory,
    profile: clone(profile),
    activeUltimatum: activeUltimatum?.status === 'active' ? clone(activeUltimatum) : null,
    ultimatumOutcome,
    contextEvidence: context.evidence,
    minimumGamesMet: games >= integer(input.minimumGames, 5, 1),
    operationId: evaluationId,
  };
  const historyId = evaluationId + ':security-history';
  const materialHistoryChange = !previousEvaluation
    || previousEvaluation.securityLevel !== level
    || previousEvaluation.recommendation !== recommendation
    || Math.abs(trendDelta) >= 5
    || actions.length > 0
    || newMatches.some((entry) => entry.classicImportance > 0)
    || Boolean(previousEvaluation.relegation?.inZone) !== relegation.inZone
    || Boolean(previousEvaluation.relegation?.confirmed) !== relegation.confirmed
    || Boolean(previousEvaluation.relegation?.survivalSecured) !== relegation.survivalSecured
    || text(previousEvaluation.fanSupport?.state) !== fanSupport.state;
  if (materialHistoryChange && !jobState.history.some((entry) => entry.id === historyId)) {
    jobState.history.push(normalizeSecurityHistory({
      id: historyId,
      evaluationId,
      coachId: appointment.coachId,
      clubId: appointment.clubId,
      appointmentId: appointment.id,
      occurredAt: now,
      previousLevel: previousEvaluation?.securityLevel ?? null,
      newLevel: level,
      previousScore,
      newScore: score,
      factors: meaningfulFactors.slice(0, 10),
      fanSupport: clone(fanSupport),
      boardPublicSupport: board.publicValue,
      boardPrivateConfidence: board.privateValue,
      relegation: clone(relegation),
      classics: clone(classics),
      accumulatedCredit: clone(accumulatedCredit),
      decision: recommendation,
    }));
  }
  if (previousEvaluation && (previousEvaluation.securityLevel !== level || Math.abs(trendDelta) >= 5)) {
    actions.push({
      type: 'COACH_JOB_SECURITY_CHANGED',
      operationId: evaluationId + ':security-changed',
      title: 'Segurança no cargo atualizada',
      message: LEVEL_LABELS[previousEvaluation.securityLevel] + ' → ' + LEVEL_LABELS[level] + '.',
    });
  }
  const novelActions = actions.filter((action) => !alreadyProcessedSignals.has(action.operationId));
  for (const action of novelActions) {
    if (!jobState.processedSignalIds.includes(action.operationId)) jobState.processedSignalIds.push(action.operationId);
  }
  jobState.profiles = uniqueById(jobState.profiles).slice(-500);
  jobState.meetings = uniqueById(jobState.meetings).slice(-1000);
  jobState.ultimatums = uniqueById(jobState.ultimatums).slice(-1000);
  // Auditoria não é descartada: avaliações antigas podem sair da janela
  // operacional, mas mudanças materiais continuam disponíveis no save.
  jobState.history = uniqueById(jobState.history);
  jobState.processedSignalIds = [...new Set(jobState.processedSignalIds)].slice(-5000);
  return { evaluation, jobSecurityState: jobState, actions: novelActions, duplicate: false };
}

export const COACH_SECURITY_LABELS = LEVEL_LABELS;
