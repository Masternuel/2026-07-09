const SIDES = Object.freeze(["home", "away"]);
const ATTACK_POSITIONS = new Set(["ATA", "PD", "PE"]);
const MIDFIELD_POSITIONS = new Set(["VOL", "MC", "MEI"]);
const DEFENSIVE_POSITIONS = new Set(["ZAG", "LD", "LE", "VOL"]);

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function rounded(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function otherSide(side) {
  return side === "home" ? "away" : "home";
}

function unique(values) {
  return [...new Set(values)];
}

function playerName(player) {
  return String(player?.shortName ?? player?.name ?? player?.id ?? "Jogador").trim() || "Jogador";
}

function playerAttribute(player, key, fallback = null) {
  const value = finite(player?.attributes?.[key], Number.NaN);
  if (Number.isFinite(value)) return clamp(value, 1, 20);
  return clamp(fallback ?? finite(player?.overall, 10), 1, 20);
}

function fitnessFactor(player) {
  return clamp(0.55 + finite(player?.condition, 100) / 220, 0.55, 1);
}

function normalizePlayer(value, side, index, clubId) {
  if (typeof value === "string") {
    const name = value.trim() || `Jogador ${index + 1}`;
    return {
      id: `${side}-legacy-${hashSeed(`${name}|${index}`).toString(16)}`,
      clubId,
      name,
      shortName: name,
      position: index === 0 ? "GOL" : index < 5 ? "ZAG" : index < 8 ? "MEI" : "ATA",
      overall: 10,
      condition: 100,
      attributes: {},
    };
  }
  const record = value && typeof value === "object" ? value : {};
  const id = String(record.id ?? `${side}-player-${index + 1}`).trim() || `${side}-player-${index + 1}`;
  const name = String(record.name ?? record.shortName ?? id).trim() || id;
  return {
    ...record,
    id,
    clubId: String(record.clubId ?? clubId ?? "").trim() || clubId,
    name,
    shortName: String(record.shortName ?? name).trim() || name,
    position: String(record.position ?? (index === 0 ? "GOL" : "MC")).trim().toUpperCase(),
    overall: clamp(finite(record.overall, 10), 1, 20),
    condition: clamp(finite(record.condition, 100), 0, 100),
    attributes: record.attributes && typeof record.attributes === "object" ? record.attributes : {},
  };
}

function normalizePlayers(values, side, clubId) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.flatMap((value, index) => {
    const player = normalizePlayer(value, side, index, clubId);
    if (!player.id || seen.has(player.id)) return [];
    seen.add(player.id);
    return [player];
  });
}

function availablePlayer(player) {
  const status = String(player?.status ?? "").trim().toLocaleLowerCase("pt-BR");
  return player?.active !== false
    && finite(player?.injuryMatches, 0) <= 0
    && finite(player?.suspensionMatches, 0) <= 0
    && !["lesionado", "suspenso", "injured", "suspended"].includes(status);
}

function defaultPlayers(side, clubId) {
  const positions = ["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "MC", "MEI", "PE", "ATA", "PD"];
  return positions.map((position, index) => normalizePlayer({
    id: `${side}-virtual-${index + 1}`,
    clubId,
    name: `${side === "home" ? "Mandante" : "Visitante"} ${index + 1}`,
    position,
    overall: 10,
    condition: 100,
  }, side, index, clubId));
}

function weightedPick(random, values, weight) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const weighted = values.map((value) => ({ value, weight: Math.max(0.001, finite(weight(value), 1)) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.value;
  }
  return weighted.at(-1).value;
}

function normalizeTactics(value) {
  const setPiece = (kind) => ({
    routine: String(value?.setPieces?.[kind]?.routine ?? ""),
    takerId: String(value?.setPieces?.[kind]?.takerId ?? "").trim() || null,
    takerName: String(value?.setPieces?.[kind]?.takerName ?? "").trim() || null,
  });
  if (!value || value.available !== true) {
    return {
      attack: 0,
      control: 0,
      defense: 0,
      setPiece: 0,
      disciplineRisk: 0,
      setPieces: { corner: setPiece("corner"), freeKick: setPiece("freeKick"), goalKick: setPiece("goalKick") },
    };
  }
  return {
    attack: clamp(finite(value.attack, 0), -0.75, 0.75),
    control: clamp(finite(value.control, 0), -0.75, 0.75),
    defense: clamp(finite(value.defense, 0), -0.75, 0.75),
    setPiece: clamp(finite(value.setPiece, 0), -0.08, 0.08),
    disciplineRisk: clamp(finite(value.disciplineRisk, 0), -0.1, 0.1),
    setPieces: { corner: setPiece("corner"), freeKick: setPiece("freeKick"), goalKick: setPiece("goalKick") },
  };
}

function createTeamStats() {
  return {
    possession: 50,
    shots: 0,
    shotsOnTarget: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    corners: 0,
  };
}

function createPlayerStats(player, side, started) {
  return {
    playerId: player.id,
    name: String(player.name ?? player.id),
    clubId: player.clubId,
    side,
    position: player.position,
    started,
    appearance: true,
    minutesPlayed: 0,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    foulsCommitted: 0,
    foulsSuffered: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    goalsConceded: 0,
    cleanSheet: false,
    injuries: 0,
    injured: false,
  };
}

function createSideRuntime(side, initialPlayers, rosterPlayers) {
  const players = new Map();
  for (const player of [...rosterPlayers, ...initialPlayers]) players.set(player.id, player);
  const starters = initialPlayers.length > 0 ? initialPlayers.slice(0, 11) : [...players.values()].slice(0, 11);
  const activeIds = new Set(starters.map((player) => player.id));
  const periods = new Map(starters.map((player) => [player.id, [{ enter: 0, exit: null }]]));
  const playerStats = new Map(starters.map((player) => [player.id, createPlayerStats(player, side, true)]));
  return {
    side,
    players,
    activeIds,
    periods,
    playerStats,
    injuries: new Map(),
    dismissedIds: new Set(),
  };
}

function activePlayers(runtime) {
  return [...runtime.activeIds].map((id) => runtime.players.get(id)).filter(Boolean);
}

function ensureParticipant(runtime, player, minute, started = false) {
  runtime.players.set(player.id, player);
  if (!runtime.playerStats.has(player.id)) {
    runtime.playerStats.set(player.id, createPlayerStats(player, runtime.side, started));
  }
  if (!runtime.periods.has(player.id)) runtime.periods.set(player.id, [{ enter: minute, exit: null }]);
  return runtime.playerStats.get(player.id);
}

function closePeriod(runtime, playerId, minute) {
  const periods = runtime.periods.get(playerId);
  const period = periods?.findLast((candidate) => candidate.exit == null);
  if (period) period.exit = minute;
  runtime.activeIds.delete(playerId);
}

function enterPlayer(runtime, player, minute) {
  ensureParticipant(runtime, player, minute, false);
  const periods = runtime.periods.get(player.id);
  if (periods?.every((period) => period.exit != null)) periods.push({ enter: minute, exit: null });
  runtime.activeIds.add(player.id);
}

function substitute(runtime, outgoing, incoming, minute) {
  if (!outgoing || !incoming || outgoing.id === incoming.id) return false;
  closePeriod(runtime, outgoing.id, minute);
  enterPlayer(runtime, incoming, minute);
  return true;
}

function unusedBench(runtime) {
  return [...runtime.players.values()].filter((player) => (
    !runtime.activeIds.has(player.id)
    && !runtime.periods.has(player.id)
    && availablePlayer(player)
  ));
}

function playerFingerprint(player) {
  return [
    player.id,
    player.position,
    rounded(player.overall),
    rounded(player.condition),
    rounded(playerAttribute(player, "chute")),
    rounded(playerAttribute(player, "passe")),
    rounded(playerAttribute(player, "defesa")),
    rounded(playerAttribute(player, "resistencia")),
  ];
}

function eventCategory(random, tactics) {
  const attackLift = clamp((tactics.attack + tactics.control) * 0.025, -0.03, 0.03);
  const disciplineLift = clamp(tactics.disciplineRisk * 0.7, -0.07, 0.07);
  const roll = random();
  const attackCut = 0.23 + attackLift;
  const shotCut = attackCut + 0.34 + attackLift;
  const foulCut = shotCut + 0.23 + disciplineLift;
  const cornerCut = foulCut + 0.11;
  const injuryCut = cornerCut + 0.045;
  if (roll < attackCut) return "attack";
  if (roll < shotCut) return "shot";
  if (roll < foulCut) return "foul";
  if (roll < cornerCut) return "corner";
  if (roll < injuryCut) return "injury";
  return "penalty";
}

function createCandidates(random, startMinute, endMinute, tactics) {
  const intensity = Math.abs(tactics.home.attack) + Math.abs(tactics.away.attack)
    + Math.max(0, tactics.home.disciplineRisk + tactics.away.disciplineRisk) * 2;
  const count = clamp(Math.round(6 + random() * 7 + intensity), 6, 15);
  const minutes = new Set();
  while (minutes.size < count) {
    minutes.add(startMinute + Math.floor(random() * (endMinute - startMinute + 1)));
  }
  const candidates = [...minutes].sort((left, right) => left - right).map((minute) => ({
    minute,
    category: eventCategory(random, random() < 0.5 ? tactics.home : tactics.away),
  }));
  if (!candidates.some((candidate) => candidate.category === "shot")) {
    candidates[Math.floor(random() * candidates.length)].category = "shot";
  }
  return candidates;
}

export function simulateDynamicMatch(options = {}) {
  const homeClubId = String(options.homeClubId ?? options.homeTeam ?? "HOME").trim();
  const awayClubId = String(options.awayClubId ?? options.awayTeam ?? "AWAY").trim();
  const initial = {
    home: normalizePlayers(options.homePlayers, "home", homeClubId),
    away: normalizePlayers(options.awayPlayers, "away", awayClubId),
  };
  if (initial.home.length === 0) initial.home = defaultPlayers("home", homeClubId);
  if (initial.away.length === 0) initial.away = defaultPlayers("away", awayClubId);
  const roster = {
    home: normalizePlayers(options.homeRoster, "home", homeClubId),
    away: normalizePlayers(options.awayRoster, "away", awayClubId),
  };
  if (roster.home.length === 0) roster.home = initial.home;
  if (roster.away.length === 0) roster.away = initial.away;
  const secondHalf = {
    home: normalizePlayers(options.homeSecondHalfPlayers, "home", homeClubId),
    away: normalizePlayers(options.awaySecondHalfPlayers, "away", awayClubId),
  };
  const teams = { home: String(options.homeTeam ?? "Mandante"), away: String(options.awayTeam ?? "Visitante") };
  const clubIds = { home: homeClubId, away: awayClubId };
  const averageCondition = (players) => players.reduce(
    (total, player) => total + finite(player.condition, 100),
    0,
  ) / Math.max(1, players.length);
  const strength = {
    home: clamp(finite(options.homeStrength, 10) + (averageCondition(initial.home) - 100) / 18, 1, 25),
    away: clamp(finite(options.awayStrength, 10) + (averageCondition(initial.away) - 100) / 18, 1, 25),
  };
  const goalkeeperRating = {
    home: clamp(finite(options.homeGoalkeeperRating, 10), 1, 20),
    away: clamp(finite(options.awayGoalkeeperRating, 10), 1, 20),
  };
  const tactics = {
    home: normalizeTactics(options.homeTacticalProfile),
    away: normalizeTactics(options.awayTacticalProfile),
  };
  const injuryRiskMultiplier = {
    home: clamp(finite(
      options.homeInjuryRiskMultiplier,
      finite(options.clubCareerEffects?.home?.injuryRiskMultiplier, 1),
    ), 0, 1),
    away: clamp(finite(
      options.awayInjuryRiskMultiplier,
      finite(options.clubCareerEffects?.away?.injuryRiskMultiplier, 1),
    ), 0, 1),
  };
  const rosterFingerprint = SIDES.map((side) => initial[side].map(playerFingerprint));
  const baseSeed = [
    "v2",
    String(options.roomCode ?? "").trim().toLocaleUpperCase("pt-BR"),
    String(options.fixtureId ?? "").trim().toLocaleLowerCase("pt-BR"),
    Math.max(1, Math.trunc(finite(options.seasonNumber, 1))),
    options.seed ?? "bola-manager",
    teams.home,
    teams.away,
    rounded(strength.home),
    rounded(strength.away),
    JSON.stringify(rosterFingerprint),
    JSON.stringify(tactics),
  ].join("|");
  const matchHash = hashSeed(baseSeed);
  const score = { home: 0, away: 0 };
  const statistics = { home: createTeamStats(), away: createTeamStats() };
  const runtimes = {
    home: createSideRuntime("home", initial.home, roster.home),
    away: createSideRuntime("away", initial.away, roster.away),
  };
  const events = [];
  let sequence = 0;

  const possessionFor = (homeModifier = 0, awayModifier = 0, random = () => 0.5) => {
    const strengthEdge = strength.home + homeModifier - strength.away - awayModifier;
    const controlEdge = tactics.home.control - tactics.away.control;
    return clamp(Math.round(50 + strengthEdge * 0.75 + controlEdge * 4 + random() * 4 - 2), 34, 66);
  };
  const setPossession = (home) => {
    statistics.home.possession = home;
    statistics.away.possession = 100 - home;
  };
  const event = (minute, type, text, extra = {}) => {
    sequence += 1;
    events.push({
      id: `evt-${String(sequence).padStart(3, "0")}`,
      minute,
      type,
      text,
      score: [score.home, score.away],
      statistics: structuredClone(statistics),
      ...extra,
    });
  };
  const teamExtra = (side, player = null) => ({
    side,
    team: teams[side],
    teamId: clubIds[side],
    ...(player ? { playerId: player.id, playerName: playerName(player) } : {}),
  });
  const selectSide = (random, homePossession) => (
    random() < clamp(homePossession / 100 + (strength.home - strength.away) * 0.006, 0.25, 0.75)
      ? "home"
      : "away"
  );
  const selectPlayer = (side, random, purpose = "general", excludedIds = new Set()) => {
    const candidates = activePlayers(runtimes[side]).filter((player) => !excludedIds.has(player.id));
    const weights = {
      shot: (player) => {
        const position = ATTACK_POSITIONS.has(player.position) ? 4.5 : MIDFIELD_POSITIONS.has(player.position) ? 2.4 : player.position === "GOL" ? 0.08 : 0.8;
        return position * (playerAttribute(player, "chute") * 0.65 + playerAttribute(player, "drible") * 0.35) * fitnessFactor(player);
      },
      assist: (player) => {
        const position = MIDFIELD_POSITIONS.has(player.position) ? 4 : ATTACK_POSITIONS.has(player.position) ? 2.8 : player.position === "GOL" ? 0.1 : 1.2;
        return position * (playerAttribute(player, "passe") * 0.7 + playerAttribute(player, "nocao") * 0.3) * fitnessFactor(player);
      },
      foul: (player) => {
        const position = DEFENSIVE_POSITIONS.has(player.position) ? 3.8 : MIDFIELD_POSITIONS.has(player.position) ? 2.2 : player.position === "GOL" ? 0.2 : 1;
        return position * (22 - playerAttribute(player, "nocao")) / fitnessFactor(player);
      },
      victim: (player) => (ATTACK_POSITIONS.has(player.position) ? 4 : MIDFIELD_POSITIONS.has(player.position) ? 2.4 : 1)
        * (playerAttribute(player, "drible") + playerAttribute(player, "velocidade")),
      injury: (player) => (22 - playerAttribute(player, "resistencia"))
        * (1 + (100 - finite(player.condition, 100)) / 25),
      goalkeeper: (player) => player.position === "GOL" ? 100 : 0.01,
      general: () => 1,
    };
    return weightedPick(random, candidates, weights[purpose] ?? weights.general);
  };
  const goalkeeper = (side, random) => selectPlayer(side, random, "goalkeeper") ?? activePlayers(runtimes[side])[0];
  const configuredTaker = (side, kind) => {
    const configured = tactics[side].setPieces?.[kind];
    if (!configured) return null;
    return activePlayers(runtimes[side]).find((player) => (
      (configured.takerId && player.id === configured.takerId)
      || (configured.takerName && playerName(player) === configured.takerName)
      || (configured.takerName && String(player.name ?? "").trim() === configured.takerName)
    )) ?? null;
  };
  const scoreText = () => `${teams.home} ${score.home} x ${score.away} ${teams.away}`;

  const doAttack = (minute, side, random) => {
    const creator = selectPlayer(side, random, "assist") ?? selectPlayer(side, random);
    if (!creator) return;
    const lanes = ["pelo corredor", "entre as linhas", "em transição rápida", "pela ponta"];
    event(minute, "attack", `${playerName(creator)} acelera ${lanes[Math.floor(random() * lanes.length)]} e aproxima ${teams[side]} da área.`, teamExtra(side, creator));
  };

  const doShot = (minute, side, random, {
    penalty = false,
    setPiece = false,
    shooterOverride = null,
    assistantOverride = null,
    unassisted = false,
  } = {}) => {
    const shooter = shooterOverride && runtimes[side].activeIds.has(shooterOverride.id)
      ? shooterOverride
      : selectPlayer(side, random, "shot") ?? selectPlayer(side, random);
    if (!shooter) return;
    const opponent = otherSide(side);
    const keeper = goalkeeper(opponent, random);
    const shooterStats = ensureParticipant(runtimes[side], shooter, minute, false);
    shooterStats.shots += 1;
    statistics[side].shots += 1;
    const accuracy = penalty
      ? 0.91
      : clamp(0.42 + (playerAttribute(shooter, "chute") - 10) * 0.025 + tactics[side].attack * 0.08, 0.25, 0.78);
    const onTarget = random() < accuracy;
    if (!onTarget) {
      if (random() < 0.22) {
        event(minute, "post", `NA TRAVE! ${playerName(shooter)} finaliza e a bola explode no poste.`, teamExtra(side, shooter));
      } else {
        event(minute, "attack", `${playerName(shooter)} arrisca, mas a finalização sai sem direção.`, teamExtra(side, shooter));
      }
      return;
    }
    shooterStats.shotsOnTarget += 1;
    statistics[side].shotsOnTarget += 1;
    const quality = playerAttribute(shooter, penalty ? "penaltis" : "chute");
    const keeperQuality = goalkeeperRating[opponent] * 0.6
      + playerAttribute(keeper, "reflexos", goalkeeperRating[opponent]) * 0.4;
    const matchup = (strength[side] - strength[opponent]) * 0.012
      + (tactics[side].attack - tactics[opponent].defense) * 0.06;
    const goalProbability = penalty
      ? clamp(0.74 + (quality - keeperQuality) * 0.012, 0.58, 0.90)
      : clamp(0.20 + (quality - keeperQuality) * 0.014 + matchup + (setPiece ? tactics[side].setPiece : 0), 0.06, 0.48);
    if (random() < goalProbability) {
      score[side] += 1;
      shooterStats.goals += 1;
      if (keeper) {
        ensureParticipant(
          runtimes[opponent],
          keeper,
          minute,
          keeper.position === "GOL",
        ).goalsConceded += 1;
      }
      let assistant = null;
      if (!penalty && !unassisted && random() < 0.72) {
        assistant = assistantOverride
          && assistantOverride.id !== shooter.id
          && runtimes[side].activeIds.has(assistantOverride.id)
          ? assistantOverride
          : selectPlayer(side, random, "assist", new Set([shooter.id]));
        if (assistant) ensureParticipant(runtimes[side], assistant, minute, false).assists += 1;
      }
      event(minute, "goal", `GOOOOOL! ${playerName(shooter)} finaliza com precisão. ${scoreText()}.`, {
        ...teamExtra(side, shooter),
        scorerId: shooter.id,
        scorer: playerName(shooter),
        assistId: assistant?.id ?? null,
        assist: assistant ? playerName(assistant) : null,
      });
      return;
    }
    if (keeper) ensureParticipant(runtimes[opponent], keeper, minute, keeper.position === "GOL").saves += 1;
    event(minute, "save", `DEFESA! ${playerName(shooter)} acerta o alvo, mas ${playerName(keeper)} evita o gol.`, {
      ...teamExtra(side, shooter),
      goalkeeperId: keeper?.id ?? null,
      goalkeeperName: keeper ? playerName(keeper) : null,
    });
  };

  const doCard = (minute, side, player, random) => {
    const individual = ensureParticipant(runtimes[side], player, minute, false);
    const risk = clamp(0.23 + tactics[side].disciplineRisk + (20 - playerAttribute(player, "nocao")) * 0.006, 0.12, 0.48);
    if (random() >= risk) return;
    const redRisk = clamp(0.055 + tactics[side].disciplineRisk * 0.35, 0.025, 0.12);
    if (random() < redRisk) {
      individual.redCards += 1;
      statistics[side].redCards += 1;
      runtimes[side].dismissedIds.add(player.id);
      event(minute, "red-card", `Cartão vermelho! ${playerName(player)} é expulso após falta dura.`, {
        ...teamExtra(side, player),
        suspensionMatches: 1,
      });
      closePeriod(runtimes[side], player.id, minute);
      return;
    }
    individual.yellowCards += 1;
    statistics[side].yellowCards += 1;
    if (individual.yellowCards >= 2) {
      individual.redCards += 1;
      statistics[side].redCards += 1;
      runtimes[side].dismissedIds.add(player.id);
      event(minute, "red-card", `Segundo amarelo! ${playerName(player)} recebe o vermelho e está expulso.`, {
        ...teamExtra(side, player),
        secondYellow: true,
        suspensionMatches: 1,
      });
      closePeriod(runtimes[side], player.id, minute);
      return;
    }
    event(minute, "yellow-card", `Cartão amarelo para ${playerName(player)}.`, teamExtra(side, player));
  };

  const doFoul = (minute, attackingSide, random) => {
    const defendingSide = otherSide(attackingSide);
    const offender = selectPlayer(defendingSide, random, "foul") ?? selectPlayer(defendingSide, random);
    const victim = selectPlayer(attackingSide, random, "victim") ?? selectPlayer(attackingSide, random);
    if (!offender || !victim) return;
    statistics[defendingSide].fouls += 1;
    ensureParticipant(runtimes[defendingSide], offender, minute, false).foulsCommitted += 1;
    ensureParticipant(runtimes[attackingSide], victim, minute, false).foulsSuffered += 1;
    event(minute, "foul", `${playerName(offender)} para a jogada de ${playerName(victim)} com falta.`, {
      ...teamExtra(defendingSide, offender),
      fouledPlayerId: victim.id,
      fouledPlayerName: playerName(victim),
    });
    doCard(minute, defendingSide, offender, random);
    if (random() < clamp(0.13 + tactics[attackingSide].setPiece, 0.06, 0.24)) {
      const freeKick = tactics[attackingSide].setPieces?.freeKick;
      doShot(minute, attackingSide, random, {
        setPiece: true,
        shooterOverride: freeKick?.routine === "direct" ? configuredTaker(attackingSide, "freeKick") : null,
        assistantOverride: freeKick?.routine === "direct" ? null : configuredTaker(attackingSide, "freeKick"),
        unassisted: freeKick?.routine === "direct",
      });
    }
  };

  const doCorner = (minute, side, random) => {
    statistics[side].corners += 1;
    const taker = configuredTaker(side, "corner")
      ?? selectPlayer(side, random, "assist")
      ?? selectPlayer(side, random);
    event(minute, "corner", `Escanteio para ${teams[side]}. ${playerName(taker)} prepara a cobrança.`, teamExtra(side, taker));
    if (random() < clamp(0.30 + tactics[side].setPiece, 0.18, 0.42)) {
      doShot(minute, side, random, { setPiece: true, assistantOverride: taker });
    }
  };

  const emitSubstitution = (minute, side, outgoing, incoming, reason = "tática") => {
    if (!substitute(runtimes[side], outgoing, incoming, minute)) return false;
    event(minute, "substitution", `SUBSTITUIÇÃO em ${teams[side]}: sai ${playerName(outgoing)}, entra ${playerName(incoming)} por decisão ${reason}.`, {
      ...teamExtra(side, incoming),
      playerOutId: outgoing.id,
      playerOutName: playerName(outgoing),
      playerInId: incoming.id,
      playerInName: playerName(incoming),
      substitution: {
        playerOutId: outgoing.id,
        playerOutName: playerName(outgoing),
        playerInId: incoming.id,
        playerInName: playerName(incoming),
      },
    });
    return true;
  };

  const doInjury = (minute, side, random) => {
    const injured = selectPlayer(side, random, "injury") ?? selectPlayer(side, random);
    if (!injured || runtimes[side].injuries.has(injured.id)) return;
    const resistance = playerAttribute(injured, "resistencia");
    const severityRoll = random() + clamp((10 - resistance) * 0.02, -0.18, 0.18);
    const severity = severityRoll > 0.82 ? "severe" : severityRoll > 0.48 ? "moderate" : "minor";
    const injuryMatches = severity === "severe" ? 4 : severity === "moderate" ? 2 : 1;
    const severityLabel = severity === "severe" ? "grave" : severity === "moderate" ? "moderada" : "leve";
    const riskRoll = seededRandom(hashSeed(
      `${baseSeed}|injury-risk:${side}:${minute}:${injured.id}`,
    ))();
    if (riskRoll >= injuryRiskMultiplier[side]) return;
    runtimes[side].injuries.set(injured.id, { severity, injuryMatches });
    const playerStats = ensureParticipant(runtimes[side], injured, minute, false);
    playerStats.injuries += 1;
    playerStats.injured = true;
    event(minute, "injury", `${playerName(injured)} sente uma lesão ${severityLabel} e recebe atendimento.`, {
      ...teamExtra(side, injured),
      severity,
      injuryMatches,
    });
    const replacement = weightedPick(random, unusedBench(runtimes[side]), (player) => (
      player.position === injured.position ? 5 : player.position === "GOL" ? 0.1 : 1
    ));
    if (replacement) emitSubstitution(minute, side, injured, replacement, "médica");
    else closePeriod(runtimes[side], injured.id, minute);
  };

  const doPenalty = (minute, attackingSide, random) => {
    const defendingSide = otherSide(attackingSide);
    const offender = selectPlayer(defendingSide, random, "foul") ?? selectPlayer(defendingSide, random);
    const victim = selectPlayer(attackingSide, random, "victim") ?? selectPlayer(attackingSide, random);
    if (offender) {
      statistics[defendingSide].fouls += 1;
      ensureParticipant(runtimes[defendingSide], offender, minute, false).foulsCommitted += 1;
      if (victim) ensureParticipant(runtimes[attackingSide], victim, minute, false).foulsSuffered += 1;
    }
    event(minute, "penalty", `PÊNALTI para ${teams[attackingSide]}!`, {
      ...teamExtra(attackingSide, victim),
      committedByPlayerId: offender?.id ?? null,
    });
    if (random() < 0.38) event(minute, "var", "VAR confirma a penalidade após revisão.", teamExtra(attackingSide));
    if (offender) doCard(minute, defendingSide, offender, random);
    doShot(Math.min(90, minute + 1), attackingSide, random, {
      penalty: true,
      shooterOverride: configuredTaker(attackingSide, "freeKick"),
    });
  };

  const processHalf = (half, homePossession, random) => {
    const range = half === 1 ? [1, 44] : [47, 89];
    const candidates = createCandidates(random, range[0], range[1], tactics);
    for (const candidate of candidates) {
      const attackingSide = selectSide(random, homePossession);
      switch (candidate.category) {
        case "attack": doAttack(candidate.minute, attackingSide, random); break;
        case "shot": doShot(candidate.minute, attackingSide, random); break;
        case "foul": doFoul(candidate.minute, attackingSide, random); break;
        case "corner": doCorner(candidate.minute, attackingSide, random); break;
        case "injury": doInjury(candidate.minute, random() < 0.5 ? "home" : "away", random); break;
        case "penalty": doPenalty(candidate.minute, attackingSide, random); break;
        default: break;
      }
    }
  };

  const firstRandom = seededRandom(hashSeed(`${baseSeed}|half:1`));
  const firstPossession = possessionFor(0, 0, firstRandom);
  setPossession(firstPossession);
  event(0, "kickoff", `Rola a bola! ${teams.home} e ${teams.away} iniciam a partida.`);
  processHalf(1, firstPossession, firstRandom);
  event(45, "halftime", `Fim do primeiro tempo. ${scoreText()}.`);

  const homeSecondModifier = clamp(finite(options.homeSecondHalfModifier, 0), -3, 3)
    + clamp(finite(options.homePhysicalSecondHalfModifier, 0), -0.4, 0.4);
  const awaySecondModifier = clamp(finite(options.awaySecondHalfModifier, 0), -3, 3)
    + clamp(finite(options.awayPhysicalSecondHalfModifier, 0), -0.4, 0.4);
  const secondFingerprint = SIDES.map((side) => (
    (secondHalf[side].length > 0 ? secondHalf[side] : initial[side]).map((player) => player.id)
  ));
  const secondRandom = seededRandom(hashSeed(`${baseSeed}|half:2|${homeSecondModifier}|${awaySecondModifier}|${JSON.stringify(secondFingerprint)}`));
  const applyHalftimeLineup = (side) => {
    if (secondHalf[side].length === 0) return;
    const desired = secondHalf[side].slice(0, 11).filter((player) => (
      !runtimes[side].injuries.has(player.id)
      && !runtimes[side].dismissedIds.has(player.id)
    ));
    for (const player of desired) runtimes[side].players.set(player.id, player);
    const desiredIds = new Set(desired.map((player) => player.id));
    const outgoing = activePlayers(runtimes[side]).filter((player) => !desiredIds.has(player.id));
    const incoming = desired.filter((player) => !runtimes[side].activeIds.has(player.id));
    const count = Math.min(outgoing.length, incoming.length);
    for (let index = 0; index < count; index += 1) {
      emitSubstitution(46, side, outgoing[index], incoming[index], "tática no intervalo");
    }
  };
  applyHalftimeLineup("home");
  applyHalftimeLineup("away");
  const secondPossession = possessionFor(homeSecondModifier, awaySecondModifier, secondRandom);
  setPossession(secondPossession);
  processHalf(2, secondPossession, secondRandom);
  setPossession(Math.round((firstPossession + secondPossession) / 2));
  event(90, "fulltime", `APITO FINAL! ${scoreText()}.`);

  const playerStatistics = { home: [], away: [] };
  const playerEffects = [];
  for (const side of SIDES) {
    for (const [playerId, playerStats] of runtimes[side].playerStats) {
      const periods = runtimes[side].periods.get(playerId) ?? [];
      const minutesPlayed = periods.reduce((total, period) => (
        total + clamp((period.exit ?? 90) - period.enter, 0, 90)
      ), 0);
      const player = runtimes[side].players.get(playerId);
      const injury = runtimes[side].injuries.get(playerId) ?? null;
      const resistance = playerAttribute(player, "resistencia");
      const tacticalIntensity = Math.max(0, tactics[side].attack + tactics[side].disciplineRisk * 2);
      const baseDrain = clamp(Math.round(1 + minutesPlayed / 17 + tacticalIntensity * 1.5 - (resistance - 10) * 0.12), 1, 11);
      const injuryDrain = injury ? injury.injuryMatches * 4 : 0;
      const conditionBefore = clamp(finite(player?.condition, 100), 0, 100);
      const conditionDelta = -clamp(baseDrain + injuryDrain, 1, 28);
      const finalized = {
        ...playerStats,
        minutesPlayed,
        goalsConceded: playerStats.goalsConceded,
        cleanSheet: player?.position === "GOL" && playerStats.goalsConceded === 0,
      };
      playerStatistics[side].push(finalized);
      playerEffects.push({
        playerId,
        clubId: player?.clubId ?? clubIds[side],
        side,
        conditionBefore,
        conditionDelta,
        conditionAfter: clamp(conditionBefore + conditionDelta, 0, 100),
        injuryMatches: injury?.injuryMatches ?? 0,
        injurySeverity: injury?.severity ?? null,
      });
    }
    playerStatistics[side].sort((left, right) => (
      Number(right.started) - Number(left.started)
      || right.minutesPlayed - left.minutesPlayed
      || left.name.localeCompare(right.name, "pt-BR")
    ));
  }

  return {
    id: `match-${matchHash.toString(16).padStart(8, "0")}`,
    seed: String(options.seed ?? "bola-manager"),
    simulationVersion: 2,
    homeTeam: teams.home,
    awayTeam: teams.away,
    score: [score.home, score.away],
    statistics: structuredClone(statistics),
    playerStatistics,
    playerEffects,
    events,
  };
}
