import { expandCompactLeagueRankingTimeline } from "./rankingTimeline.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return text(value).toLocaleUpperCase("pt-BR");
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value, fallback = 0) {
  const parsed = finite(value);
  return parsed === null ? fallback : Math.max(0, Math.trunc(parsed));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sameClub(left, right) {
  return Boolean(key(left)) && key(left) === key(right);
}

function clubIdOf(club) {
  return text(club?.id ?? club?.clubId ?? club?.code);
}

function mergeMissing(target, source) {
  const result = { ...(target ?? {}) };
  for (const [field, value] of Object.entries(source ?? {})) {
    if (result[field] === undefined || result[field] === null || result[field] === "") {
      result[field] = value;
    }
  }
  return result;
}

function clubCatalog(room) {
  const records = new Map();
  const add = (club) => {
    const id = clubIdOf(club);
    if (!id) return;
    records.set(key(id), mergeMissing(records.get(key(id)), { ...club, id }));
  };
  for (const competition of list(room?.competitionCatalog)) {
    for (const club of list(competition?.clubs)) add(club);
  }
  for (const tournament of list(room?.tournamentCatalog)) {
    for (const club of list(tournament?.participants)) add(club);
  }
  return records;
}

function competitionForClub(room, clubId, suppliedLeague) {
  if (suppliedLeague && list(suppliedLeague.clubs).some((club) => sameClub(clubIdOf(club), clubId))) {
    return suppliedLeague;
  }
  return list(room?.competitionCatalog).find((competition) => (
    list(competition?.clubs).some((club) => sameClub(clubIdOf(club), clubId))
  )) ?? null;
}

function firstMetric(record, fields) {
  for (const field of fields) {
    const value = finite(record?.[field]);
    if (value !== null && value >= 0) return value;
  }
  return null;
}

function reliableMetricRank(clubs, clubId, fieldGroups) {
  for (const fields of fieldGroups) {
    const rows = clubs.flatMap((club) => {
      const value = firstMetric(club, fields);
      return value === null ? [] : [{ club, clubId: clubIdOf(club), value }];
    });
    const target = rows.find((row) => sameClub(row.clubId, clubId));
    const minimumKnown = Math.max(3, Math.ceil(clubs.length * 0.6));
    if (!target || rows.length < minimumKnown) continue;
    const minimum = Math.min(...rows.map((row) => row.value));
    const maximum = Math.max(...rows.map((row) => row.value));
    if (minimum === maximum) continue;
    rows.sort((left, right) => (
      right.value - left.value
        || text(left.club?.name ?? left.clubId).localeCompare(text(right.club?.name ?? right.clubId), "pt-BR")
    ));
    const knownPosition = rows.findIndex((row) => sameClub(row.clubId, clubId)) + 1;
    const scaledPosition = rows.length <= 1
      ? 1
      : 1 + ((knownPosition - 1) / (rows.length - 1)) * Math.max(0, clubs.length - 1);
    return {
      fields,
      knownClubs: rows.length,
      totalClubs: clubs.length,
      value: target.value,
      position: Math.round(scaledPosition * 10) / 10,
    };
  }
  return null;
}

function normalizeReputation(value) {
  const parsed = finite(value);
  if (parsed === null || parsed < 0) return null;
  return clamp(parsed <= 20 ? parsed * 5 : parsed, 0, 100);
}

function activeCoach(room, coachId) {
  return list(room?.coachCareerState?.coaches).find((coach) => key(coach?.id) === key(coachId))
    ?? list(room?.managers).find((coach) => key(coach?.id) === key(coachId))
    ?? null;
}

function activeAppointment(room, coachId, clubId) {
  return list(room?.coachEmploymentState?.appointments).find((appointment) => (
    appointment?.status === "active"
      && key(appointment?.coachId) === key(coachId)
      && sameClub(appointment?.clubId, clubId)
  )) ?? null;
}

function activeContract(room, coachId, clubId) {
  return list(room?.coachEmploymentState?.contracts).find((contract) => (
    contract?.status === "active"
      && key(contract?.coachId) === key(coachId)
      && sameClub(contract?.clubId, clubId)
  )) ?? null;
}

function factor(code, impact, label, detail, evidence = {}) {
  return { code, impact, label, detail, evidence };
}

function squadExpectationFactor(room, clubId, league, expectedPosition) {
  const clubs = list(league?.clubs);
  const expected = finite(expectedPosition);
  if (clubs.length < 3 || expected === null) return { factor: null, rank: null };
  const rank = reliableMetricRank(clubs, clubId, [
    ["squadStrength", "rankingSquadStrength", "strength"],
    ["squadValue", "rankingSquadValue", "value"],
  ]);
  if (!rank) return { factor: null, rank: null };
  const gap = rank.position - expected;
  if (Math.abs(gap) < 1.5) return { factor: null, rank };
  const impact = clamp(Math.round(gap * 0.8), -4, 4);
  if (impact > 0) {
    return {
      rank,
      factor: factor(
        "squad_resources_below_expectation",
        impact,
        "Elenco abaixo da expectativa institucional",
        `Qualidade do elenco projeta ${rank.position.toFixed(1)}º; diretoria cobra ${Math.round(expected)}º.`,
        { qualityPosition: rank.position, expectedPosition: expected, metricFields: rank.fields },
      ),
    };
  }
  return {
    rank,
    factor: factor(
      "squad_resources_above_expectation",
      impact,
      "Elenco forte aumenta a cobrança",
      `Qualidade do elenco projeta ${rank.position.toFixed(1)}º; objetivo atual é ${Math.round(expected)}º.`,
      { qualityPosition: rank.position, expectedPosition: expected, metricFields: rank.fields },
    ),
  };
}

function reputationFactor(room, coach, clubId) {
  const club = clubCatalog(room).get(key(clubId));
  const coachReputation = normalizeReputation(coach?.reputation);
  const clubReputation = normalizeReputation(club?.reputation);
  if (coachReputation === null || clubReputation === null) return { factor: null, coachReputation, clubReputation };
  const gap = coachReputation - clubReputation;
  if (gap >= 15) {
    return {
      coachReputation,
      clubReputation,
      factor: factor(
        "coach_reputation_trust",
        2,
        "Prestígio sustenta confiança",
        "Histórico e reputação do treinador ampliam a margem de confiança da diretoria.",
        { coachReputation, clubReputation },
      ),
    };
  }
  if (gap <= -25) {
    return {
      coachReputation,
      clubReputation,
      factor: factor(
        "coach_reputation_pressure",
        -2,
        "Prestígio ainda em construção",
        "Diferença de reputação entre treinador e clube reduz a margem para resultados ruins.",
        { coachReputation, clubReputation },
      ),
    };
  }
  return { factor: null, coachReputation, clubReputation };
}

function boardObjectiveFactors(contract) {
  const positive = new Set(["completed", "complete", "achieved", "met", "success", "succeeded"]);
  const negative = new Set(["failed", "missed", "breached", "unmet"]);
  let completed = 0;
  let failed = 0;
  for (const objective of list(contract?.objectives)) {
    const status = text(objective?.status).toLocaleLowerCase("pt-BR");
    if (positive.has(status)) completed += 1;
    if (negative.has(status)) failed += 1;
  }
  const factors = [];
  if (completed > 0) {
    factors.push(factor(
      "board_objectives_met",
      Math.min(5, completed * 2),
      "Objetivos da diretoria cumpridos",
      `${completed} objetivo(s) contratual(is) concluído(s).`,
      { completed },
    ));
  }
  if (failed > 0) {
    factors.push(factor(
      "board_objectives_failed",
      -Math.min(6, failed * 3),
      "Objetivos da diretoria não cumpridos",
      `${failed} objetivo(s) contratual(is) marcado(s) como não cumprido(s).`,
      { failed },
    ));
  }
  return { factors, completed, failed };
}

function fixtureIdentifier(value) {
  return text(value?.fixtureId ?? value?.leagueFixtureId ?? value?.competitionFixtureId ?? value?.id);
}

function appointmentCoversRound(appointment, season, round) {
  const startSeason = integer(appointment?.startedSeason, 1);
  const startRound = Math.max(1, integer(appointment?.startedRound, 1));
  const endSeason = appointment?.endedSeason == null ? null : integer(appointment.endedSeason, startSeason);
  const endRound = appointment?.endedRound == null ? null : integer(appointment.endedRound, 0);
  if (season < startSeason || (season === startSeason && round < startRound)) return false;
  if (endSeason !== null && (season > endSeason || (season === endSeason && endRound !== null && round > endRound))) {
    return false;
  }
  return true;
}

function managerParticipated(match, coachId, clubId) {
  const home = key(match?.homeManagerId) === key(coachId) && sameClub(match?.homeClubId, clubId);
  const away = key(match?.awayManagerId) === key(coachId) && sameClub(match?.awayClubId, clubId);
  return home || away;
}

function tenureMatches(room, coachId, clubId, appointment) {
  if (!appointment) return 0;
  const seen = new Set();
  const add = (entry, season, round, exactManager = false) => {
    if (!appointmentCoversRound(appointment, season, round)) return;
    if (exactManager && !managerParticipated(entry, coachId, clubId)) return;
    if (!exactManager && ![entry?.homeClubId, entry?.awayClubId].some((id) => sameClub(id, clubId))) return;
    const id = fixtureIdentifier(entry) || `${season}:${round}:${key(entry?.homeClubId)}:${key(entry?.awayClubId)}`;
    seen.add(`${season}:${key(id)}`);
  };

  for (const season of list(room?.seasonHistory)) {
    const seasonNumber = Math.max(1, integer(season?.seasonNumber, 1));
    for (const match of list(season?.managerMatchHistory)) {
      add(match, seasonNumber, Math.max(1, integer(match?.round, 1)), true);
    }
  }
  const currentSeason = Math.max(1, integer(room?.currentSeason, 1));
  for (const match of list(room?.completedMatches)) {
    if (!managerParticipated(match, coachId, clubId)) continue;
    add(match, Math.max(1, integer(match?.seasonNumber, currentSeason)), Math.max(1, integer(match?.round, 1)), true);
  }
  const resultIds = new Set(list(room?.leagueMatchResults).map((result) => key(fixtureIdentifier(result))).filter(Boolean));
  for (const fixture of list(room?.leagueFixtureSchedule)) {
    if (!resultIds.has(key(fixtureIdentifier(fixture)))) continue;
    add(fixture, currentSeason, Math.max(1, integer(fixture?.round, 1)));
  }
  for (const fixture of list(room?.competitionSeason?.fixtures)) {
    if (fixture?.status !== "completed" && !fixture?.completedAt && !fixture?.result) continue;
    add(fixture, currentSeason, Math.max(1, integer(fixture?.calendarRound ?? fixture?.round, 1)));
  }
  return seen.size;
}

function tenureFactor(matchCount) {
  const impact = matchCount >= 80 ? 3 : matchCount >= 40 ? 2 : matchCount >= 20 ? 1 : 0;
  return impact > 0 ? factor(
    "established_tenure",
    impact,
    "Trabalho consolidado",
    `${matchCount} partidas persistidas neste vínculo sustentam continuidade.`,
    { matches: matchCount },
  ) : null;
}

function latestArchivedCampaigns(room, coachId) {
  const expanded = list(room?.seasonHistory).flatMap((season) => (
    expandCompactLeagueRankingTimeline(season?.rankingTimeline)
  ));
  const grouped = new Map();
  for (const row of expanded) {
    if (row?.type !== "manager" || key(row?.managerId ?? row?.entityId) !== key(coachId)) continue;
    const group = `${integer(row?.seasonNumber, 1)}:${key(row?.competitionId)}`;
    const previous = grouped.get(group);
    if (!previous || integer(row?.round) > integer(previous?.round)) grouped.set(group, row);
  }
  return [...grouped.values()]
    .filter((row) => integer(row?.played) >= 5)
    .sort((left, right) => integer(right?.seasonNumber) - integer(left?.seasonNumber)
      || integer(right?.round) - integer(left?.round))
    .slice(0, 3);
}

function pastCampaignFactor(campaigns) {
  if (campaigns.length === 0) return null;
  const games = campaigns.reduce((total, row) => total + integer(row?.played), 0);
  const points = campaigns.reduce((total, row) => total + integer(row?.points), 0);
  if (games === 0) return null;
  const pointsPerGame = points / games;
  const rounded = Math.round(pointsPerGame * 100) / 100;
  if (pointsPerGame >= 2) {
    return factor("strong_past_campaigns", 3, "Campanhas anteriores fortes", `Média de ${rounded} ponto(s) por jogo nas campanhas arquivadas mais recentes.`, { games, points, pointsPerGame: rounded });
  }
  if (pointsPerGame >= 1.7) {
    return factor("strong_past_campaigns", 2, "Bom histórico recente", `Média de ${rounded} ponto(s) por jogo nas campanhas arquivadas mais recentes.`, { games, points, pointsPerGame: rounded });
  }
  if (pointsPerGame <= 0.85) {
    return factor("weak_past_campaigns", -3, "Campanhas anteriores fracas", `Média de ${rounded} ponto(s) por jogo nas campanhas arquivadas mais recentes.`, { games, points, pointsPerGame: rounded });
  }
  if (pointsPerGame <= 1.1) {
    return factor("weak_past_campaigns", -2, "Histórico recente abaixo do esperado", `Média de ${rounded} ponto(s) por jogo nas campanhas arquivadas mais recentes.`, { games, points, pointsPerGame: rounded });
  }
  return null;
}

function titleCount(room, coach, coachId, clubId, appointment) {
  const derived = new Set();
  for (const season of list(room?.seasonHistory)) {
    for (const winner of list(season?.tournamentWinners)) {
      if (key(winner?.managerId ?? winner?.coachId) !== key(coachId)) continue;
      derived.add(`tournament:${integer(season?.seasonNumber, 1)}:${key(winner?.tournamentId ?? winner?.competitionId)}`);
    }
    const expanded = expandCompactLeagueRankingTimeline(season?.rankingTimeline);
    const finals = new Map();
    for (const row of expanded) {
      if (row?.type !== "manager" || key(row?.managerId ?? row?.entityId) !== key(coachId)) continue;
      const group = `${integer(row?.seasonNumber, 1)}:${key(row?.competitionId)}`;
      if (!finals.has(group) || integer(row?.round) > integer(finals.get(group)?.round)) finals.set(group, row);
    }
    for (const row of finals.values()) {
      for (let index = 0; index < integer(row?.titles); index += 1) {
        derived.add(`league:${integer(row?.seasonNumber, 1)}:${key(row?.competitionId)}:${index}`);
      }
    }
  }

  const currentSeason = Math.max(1, integer(room?.currentSeason, 1));
  for (const winner of list(room?.competitionSeason?.winners)) {
    if (!sameClub(winner?.clubId, clubId)) continue;
    const competition = list(room?.competitionSeason?.competitions).find((candidate) => (
      key(candidate?.id) === key(winner?.tournamentId ?? winner?.competitionId)
    ));
    const decisive = list(competition?.fixtures)
      .filter((fixture) => (
        (fixture?.status === "completed" || fixture?.completedAt || fixture?.result)
          && [fixture?.homeClubId, fixture?.awayClubId].some((id) => sameClub(id, clubId))
      ))
      .sort((left, right) => integer(right?.calendarRound ?? right?.round) - integer(left?.calendarRound ?? left?.round))[0];
    const decisiveRound = Math.max(1, integer(decisive?.calendarRound ?? decisive?.round, 1));
    const attributed = key(winner?.managerId ?? winner?.coachId) === key(coachId)
      || (!text(winner?.managerId ?? winner?.coachId)
        && appointment
        && decisive
        && appointmentCoversRound(appointment, currentSeason, decisiveRound));
    if (attributed) derived.add(`tournament:${currentSeason}:${key(winner?.tournamentId ?? winner?.competitionId)}`);
  }

  if (derived.size > 0) return derived.size;
  const explicit = new Set();
  for (const title of list(coach?.titles)) explicit.add(key(title?.id ?? title?.name ?? title));
  for (const assignment of list(coach?.assignments)) {
    for (const title of list(assignment?.titles)) explicit.add(key(title?.id ?? title?.name ?? title));
  }
  explicit.delete("");
  return explicit.size;
}

function titlesFactor(count) {
  if (count <= 0) return null;
  return factor(
    "career_titles",
    Math.min(5, count * 2),
    "Títulos conquistados",
    `${count} título(s) atribuído(s) ao treinador no histórico persistido.`,
    { titles: count },
  );
}

function competitionParticipantIds(competition) {
  return list(competition?.participants).map((participant) => text(participant?.id ?? participant?.clubId)).filter(Boolean);
}

function expectedCupContender(room, competition, clubId) {
  const catalog = clubCatalog(room);
  const participantIds = competitionParticipantIds(competition);
  const clubs = participantIds.map((id) => catalog.get(key(id)) ?? { id });
  const rank = reliableMetricRank(clubs, clubId, [
    ["reputation"],
    ["squadStrength", "rankingSquadStrength", "strength"],
    ["squadValue", "rankingSquadValue", "value"],
  ]);
  return rank ? rank.position <= Math.ceil(participantIds.length / 2) : null;
}

function cupEliminationContext(room, clubId, appointment) {
  if (!appointment) return { factor: null, eliminations: [] };
  const currentSeason = Math.max(1, integer(room?.currentSeason, 1));
  const eliminations = [];
  for (const competition of list(room?.competitionSeason?.competitions)) {
    if (!["knockout", "groups_knockout"].includes(text(competition?.format))) continue;
    if (!competitionParticipantIds(competition).some((id) => sameClub(id, clubId))) continue;
    if (sameClub(competition?.winnerClubId, clubId)) continue;
    let elimination = null;
    for (const stage of list(competition?.stages)) {
      if (stage?.type === "knockout") {
        for (const tie of list(stage?.ties)) {
          if (tie?.status !== "completed" || sameClub(tie?.winnerClubId, clubId)) continue;
          if (![tie?.homeClubId, tie?.awayClubId].some((id) => sameClub(id, clubId))) continue;
          const fixtures = list(tie?.fixtureIds).map((id) => list(competition?.fixtures).find((fixture) => key(fixtureIdentifier(fixture)) === key(id))).filter(Boolean);
          const round = Math.max(1, ...fixtures.map((fixture) => integer(fixture?.calendarRound ?? fixture?.round, 1)));
          if (!appointmentCoversRound(appointment, currentSeason, round)) continue;
          const stageRound = Math.max(1, integer(tie?.round, 1));
          const totalRounds = Math.max(1, list(stage?.rounds).length);
          elimination = { competitionId: competition.id, stage: "knockout", round, stageRound, totalRounds, early: stageRound <= Math.ceil(totalRounds / 2) };
        }
      }
      if (stage?.type === "groups" && stage?.status === "completed") {
        const group = list(stage?.groups).find((candidate) => list(candidate?.participantIds).some((id) => sameClub(id, clubId)));
        if (!group || list(group?.qualifiers).some((id) => sameClub(id, clubId))) continue;
        const fixtures = list(group?.fixtureIds).map((id) => list(competition?.fixtures).find((fixture) => key(fixtureIdentifier(fixture)) === key(id))).filter(Boolean);
        const round = Math.max(1, ...fixtures.map((fixture) => integer(fixture?.calendarRound ?? fixture?.round, 1)));
        if (!appointmentCoversRound(appointment, currentSeason, round)) continue;
        elimination = { competitionId: competition.id, stage: "groups", round, early: true };
      }
    }
    if (elimination) eliminations.push({ ...elimination, contender: expectedCupContender(room, competition, clubId) });
  }
  if (eliminations.length === 0) return { factor: null, eliminations };
  const impact = -Math.min(6, eliminations.reduce((total, entry) => (
    total + (entry.early && entry.contender === true ? 3 : 1)
  ), 0));
  return {
    eliminations,
    factor: factor(
      "cup_eliminations",
      impact,
      "Eliminação em competição eliminatória",
      `${eliminations.length} eliminação(ões) confirmada(s) durante o vínculo atual.`,
      { eliminations },
    ),
  };
}

/**
 * Extrai contexto real e persistido que complementa PPG/posição da liga.
 * Não usa aleatoriedade nem cria sinais quando o save não possui evidência.
 */
export function buildCoachEvaluationContext(room, options = {}) {
  const coachId = text(options.coachId ?? options.appointment?.coachId);
  const clubId = text(options.clubId ?? options.appointment?.clubId);
  if (!coachId || !clubId) return { impact: 0, factors: [], evidence: {} };
  const appointment = options.appointment ?? activeAppointment(room, coachId, clubId);
  const contract = options.contract ?? activeContract(room, coachId, clubId);
  const coach = options.coach ?? activeCoach(room, coachId);
  const league = competitionForClub(room, clubId, options.league);
  const factors = [];

  const squad = squadExpectationFactor(room, clubId, league, options.expectedPosition);
  if (squad.factor) factors.push(squad.factor);
  const reputation = reputationFactor(room, coach, clubId);
  if (reputation.factor) factors.push(reputation.factor);
  const objectives = boardObjectiveFactors(contract);
  factors.push(...objectives.factors);
  const matches = tenureMatches(room, coachId, clubId, appointment);
  const tenure = tenureFactor(matches);
  if (tenure) factors.push(tenure);
  const campaigns = latestArchivedCampaigns(room, coachId);
  const campaign = pastCampaignFactor(campaigns);
  if (campaign) factors.push(campaign);
  const titles = titleCount(room, coach, coachId, clubId, appointment);
  const title = titlesFactor(titles);
  if (title) factors.push(title);
  const cups = cupEliminationContext(room, clubId, appointment);
  if (cups.factor) factors.push(cups.factor);

  return {
    impact: factors.reduce((total, entry) => total + entry.impact, 0),
    factors,
    evidence: {
      squadQuality: squad.rank,
      coachReputation: reputation.coachReputation,
      clubReputation: reputation.clubReputation,
      boardObjectivesCompleted: objectives.completed,
      boardObjectivesFailed: objectives.failed,
      tenureMatches: matches,
      archivedCampaigns: campaigns.map((row) => ({
        seasonNumber: row.seasonNumber,
        competitionId: row.competitionId,
        played: row.played,
        points: row.points,
        campaignPosition: row.campaignPosition,
      })),
      titles,
      cupEliminations: cups.eliminations,
    },
  };
}
