import { simulateDynamicMatch } from "./dynamicMatchSimulator.mjs";

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

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function optionalGoalkeeperRating(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 1, 20) : null;
}

function optionalTacticalProfile(value) {
  if (!value || value.available !== true) return null;
  const numeric = (key, minimum, maximum) => clamp(Number(value[key]) || 0, minimum, maximum);
  const readSetPiece = (kind) => ({
    routine: String(value.setPieces?.[kind]?.routine ?? ""),
    takerName: String(value.setPieces?.[kind]?.takerName ?? "").trim() || null,
  });
  return {
    formationId: String(value.formationId ?? ""),
    attack: numeric("attack", -0.75, 0.75),
    control: numeric("control", -0.75, 0.75),
    defense: numeric("defense", -0.75, 0.75),
    setPiece: numeric("setPiece", -0.08, 0.08),
    disciplineRisk: numeric("disciplineRisk", -0.1, 0.1),
    setPieces: {
      corner: readSetPiece("corner"),
      freeKick: readSetPiece("freeKick"),
      goalKick: readSetPiece("goalKick"),
    },
  };
}

function tacticalFingerprint(home, away) {
  if (!home && !away) return "";
  const fingerprint = (profile) => profile ? {
    formationId: profile.formationId,
    attack: profile.attack,
    control: profile.control,
    defense: profile.defense,
    setPiece: profile.setPiece,
    disciplineRisk: profile.disciplineRisk,
    routines: [
      profile.setPieces.corner.routine,
      profile.setPieces.freeKick.routine,
      profile.setPieces.goalKick.routine,
    ],
  } : null;
  return `|tactics:${JSON.stringify([fingerprint(home), fingerprint(away)])}`;
}

export function goalProbabilityAgainstGoalkeeper(baseProbability, goalkeeperRating) {
  const base = clamp(Number(baseProbability) || 0, 0, 1);
  const rating = optionalGoalkeeperRating(goalkeeperRating);
  if (rating == null) return base;
  const adjustment = clamp((10 - rating) * 0.012, -0.12, 0.12);
  return clamp(base + adjustment, 0, 1);
}

function createStats(possessionHome) {
  const side = () => ({
    possession: 0,
    shots: 0,
    shotsOnTarget: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    corners: 0,
  });
  const stats = { home: side(), away: side() };
  stats.home.possession = possessionHome;
  stats.away.possession = 100 - possessionHome;
  return stats;
}

const PLAYERS = {
  home: ["Felipe Rocha", "Igor Sampaio", "Bruno Mendes", "Leandro Paiva", "Victor Moura"],
  away: ["Rafael Silva", "Matías Rojas", "Lucas Braga", "Diego Costa", "João Victor"],
};

function normalizedPlayerNames(values, fallback) {
  if (!Array.isArray(values)) return fallback;
  const names = [...new Set(values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
  return names.length > 0 ? names : fallback;
}

export function simulateMatch(options = {}) {
  if (Number(options?.simulationVersion) === 2) return simulateDynamicMatch(options);
  return simulateLegacyMatch(options);
}

function simulateLegacyMatch({
  homeTeam,
  awayTeam,
  homeStrength = 10,
  awayStrength = 10,
  homeGoalkeeperRating,
  awayGoalkeeperRating,
  homePhysicalSecondHalfModifier = 0,
  awayPhysicalSecondHalfModifier = 0,
  homeInjuryRiskMultiplier,
  awayInjuryRiskMultiplier,
  clubCareerEffects,
  homeTacticalProfile,
  awayTacticalProfile,
  homeSecondHalfModifier = 0,
  awaySecondHalfModifier = 0,
  homeSecondHalfPlayers,
  awaySecondHalfPlayers,
  seed = "bola-manager",
}) {
  const normalizedHomeGoalkeeper = optionalGoalkeeperRating(homeGoalkeeperRating);
  const normalizedAwayGoalkeeper = optionalGoalkeeperRating(awayGoalkeeperRating);
  const normalizedInjuryRisk = {
    home: clamp(Number.isFinite(Number(homeInjuryRiskMultiplier))
      ? Number(homeInjuryRiskMultiplier)
      : Number(clubCareerEffects?.home?.injuryRiskMultiplier) || 1, 0, 1),
    away: clamp(Number.isFinite(Number(awayInjuryRiskMultiplier))
      ? Number(awayInjuryRiskMultiplier)
      : Number(clubCareerEffects?.away?.injuryRiskMultiplier) || 1, 0, 1),
  };
  const normalizedHomeTactics = optionalTacticalProfile(homeTacticalProfile);
  const normalizedAwayTactics = optionalTacticalProfile(awayTacticalProfile);
  const legacySeed = `${seed}|${homeTeam}|${awayTeam}|${homeStrength}|${awayStrength}`;
  const goalkeeperSeed = normalizedHomeGoalkeeper == null && normalizedAwayGoalkeeper == null
    ? ""
    : `|gk:${normalizedHomeGoalkeeper ?? "legacy"}:${normalizedAwayGoalkeeper ?? "legacy"}`;
  const normalizedSeed = `${legacySeed}${goalkeeperSeed}${tacticalFingerprint(normalizedHomeTactics, normalizedAwayTactics)}`;
  const seedHash = hashSeed(normalizedSeed);
  const random = seededRandom(seedHash);
  const advantage = clamp(homeStrength - awayStrength, -8, 8);
  const tacticalControlEdge = (normalizedHomeTactics?.control ?? 0) - (normalizedAwayTactics?.control ?? 0);
  const possessionHome = clamp(
    50 + Math.round(advantage * 1.2 + tacticalControlEdge * 2.5 + random() * 6 - 3),
    38,
    62,
  );
  const stats = createStats(possessionHome);
  const score = { home: 0, away: 0 };
  const events = [];
  let sequence = 0;
  let secondHalfStarted = false;
  const tacticsEnabled = Boolean(normalizedHomeTactics || normalizedAwayTactics);
  const tacticsFor = (side) => side === "home" ? normalizedHomeTactics : normalizedAwayTactics;
  const opponentTacticsFor = (side) => side === "home" ? normalizedAwayTactics : normalizedHomeTactics;
  const matchupEdge = (side) => (
    (tacticsFor(side)?.attack ?? 0) - (opponentTacticsFor(side)?.defense ?? 0)
  );
  const secondHalfPlayers = {
    home: normalizedPlayerNames(homeSecondHalfPlayers, PLAYERS.home),
    away: normalizedPlayerNames(awaySecondHalfPlayers, PLAYERS.away),
  };

  const sideName = (side) => side === "home" ? homeTeam : awayTeam;
  const player = (side) => pick(random, secondHalfStarted ? secondHalfPlayers[side] : PLAYERS[side]);
  const scoreText = () => `${homeTeam} ${score.home} x ${score.away} ${awayTeam}`;
  const event = (minute, type, text, extra = {}) => {
    if (type === "injury") {
      const riskSide = extra.side === "home" ? "home" : "away";
      const injuryRoll = seededRandom(hashSeed(
        `${normalizedSeed}|injury-risk:${riskSide}:${minute}`,
      ))();
      if (injuryRoll >= normalizedInjuryRisk[riskSide]) return;
    }
    sequence += 1;
    events.push({
      id: `evt-${String(sequence).padStart(2, "0")}`,
      minute,
      type,
      text,
      score: [score.home, score.away],
      statistics: structuredClone(stats),
      ...extra,
    });
  };
  const shot = (side, onTarget = true) => {
    stats[side].shots += 1;
    if (onTarget) stats[side].shotsOnTarget += 1;
  };
  const goalChance = (minute, side, probability, description, scorerOverride = null) => {
    const scorer = scorerOverride || player(side);
    shot(side, true);
    const goalkeeperRating = side === "home" ? normalizedAwayGoalkeeper : normalizedHomeGoalkeeper;
    const adjustedProbability = goalProbabilityAgainstGoalkeeper(probability, goalkeeperRating);
    if (random() < adjustedProbability) {
      score[side] += 1;
      const assistant = player(side);
      event(minute, "goal", `GOOOOOL! ${scorer} ${description}. ${scoreText()}.`, {
        team: sideName(side),
        scorer,
        assist: assistant === scorer ? null : assistant,
      });
    } else {
      event(minute, "save", `DEFESA DIFÍCIL! ${scorer} finaliza e o goleiro de ${sideName(side === "home" ? "away" : "home")} espalma.`);
    }
  };

  event(0, "kickoff", `Rola a bola! ${homeTeam} e ${awayTeam} iniciam a partida.`);
  event(3, "attack", `${player("home")} recebe pela esquerda, avança e cruza para a área.`);
  goalChance(
    7,
    "home",
    clamp(0.5 + advantage * 0.025 + matchupEdge("home") * 0.04, 0.28, 0.72),
    "cabeceia no canto e abre o placar",
  );

  shot("away", true);
  event(14, "save", `DEFESAÇA! O goleiro de ${homeTeam} busca no canto a finalização de ${player("away")}.`);
  stats.away.fouls += 1;
  event(23, "foul", `Falta perigosa para o ${homeTeam} na entrada da área.`);
  if (tacticsEnabled) {
    const freeKick = normalizedHomeTactics?.setPieces.freeKick;
    const freeKickProbability = clamp(
      0.12 + (normalizedHomeTactics?.setPiece ?? 0) + matchupEdge("home") * 0.025,
      0.04,
      0.28,
    );
    if (random() < freeKickProbability) {
      const taker = freeKick?.takerName;
      goalChance(
        24,
        "home",
        clamp(0.34 + (normalizedHomeTactics?.setPiece ?? 0), 0.24, 0.48),
        `cobra ${freeKick?.routine === "cross" ? "na área" : "com precisão"}`,
        taker,
      );
    }
  }
  stats.home.corners += 1;
  const cornerRoutine = normalizedHomeTactics?.setPieces.corner.routine;
  event(
    31,
    "corner",
    tacticsEnabled
      ? `Escanteio para o ${homeTeam}. ${cornerRoutine === "short" ? "A cobrança curta abre novo espaço" : "A bola viaja para a área"}.`
      : `Escanteio para o ${homeTeam}. A zaga afasta o cruzamento fechado.`,
  );
  if (tacticsEnabled && random() < clamp(
    0.13 + (normalizedHomeTactics?.setPiece ?? 0) + matchupEdge("home") * 0.02,
    0.04,
    0.26,
  )) {
    goalChance(
      32,
      "home",
      clamp(0.30 + (normalizedHomeTactics?.setPiece ?? 0), 0.2, 0.44),
      "aproveita a jogada ensaiada e testa firme",
    );
  }
  stats.away.fouls += 1;
  stats.away.yellowCards += 1;
  event(38, "yellow-card", `Cartão amarelo para ${player("away")} após entrada dura no meio-campo.`);
  event(45, "halftime", `Fim do primeiro tempo. ${scoreText()}.`);

  // As mudancas decididas no intervalo entram somente daqui em diante. Como
  // os modificadores nao fazem parte da seed, o primeiro tempo permanece igual.
  secondHalfStarted = true;
  const normalizedHomeModifier = clamp(Number(homeSecondHalfModifier) || 0, -3, 3);
  const normalizedAwayModifier = clamp(Number(awaySecondHalfModifier) || 0, -3, 3);
  const normalizedHomePhysicalModifier = clamp(Number(homePhysicalSecondHalfModifier) || 0, -0.4, 0.4);
  const normalizedAwayPhysicalModifier = clamp(Number(awayPhysicalSecondHalfModifier) || 0, -0.4, 0.4);
  const totalHomeSecondHalfModifier = normalizedHomeModifier + normalizedHomePhysicalModifier;
  const totalAwaySecondHalfModifier = normalizedAwayModifier + normalizedAwayPhysicalModifier;
  const secondHalfAdvantage = clamp(
    advantage + totalHomeSecondHalfModifier - totalAwaySecondHalfModifier,
    -10,
    10,
  );
  const secondHalfPossessionHome = clamp(
    possessionHome + Math.round((totalHomeSecondHalfModifier - totalAwaySecondHalfModifier) * 1.5),
    35,
    65,
  );
  stats.home.possession = secondHalfPossessionHome;
  stats.away.possession = 100 - secondHalfPossessionHome;

  shot("home", false);
  event(52, "post", `NA TRAVE! ${player("home")} acerta o poste em chute de fora da área.`);
  event(58, "injury", `${player("away")} sente a coxa e recebe atendimento no gramado.`);
  event(63, "substitution", `SUBSTITUIÇÃO: ${sideName("away")} mexe no ataque para ganhar velocidade.`);

  const secondHalfTacticalEdge = matchupEdge("home") - matchupEdge("away");
  const penaltyThreshold = clamp(
    0.5 - secondHalfAdvantage * 0.02 - secondHalfTacticalEdge * 0.03,
    0.2,
    0.8,
  );
  const penaltySide = random() < penaltyThreshold ? "away" : "home";
  stats[penaltySide === "home" ? "away" : "home"].fouls += 1;
  event(68, "penalty", `PÊNALTI para o ${sideName(penaltySide)}! O árbitro aponta a marca da cal.`);
  event(69, "var", "VAR EM AÇÃO: o lance é revisado e a penalidade está confirmada.");
  const penaltyModifier = penaltySide === "home" ? totalHomeSecondHalfModifier : totalAwaySecondHalfModifier;
  const penaltyTactics = tacticsFor(penaltySide);
  const penaltyTaker = penaltyTactics?.setPieces.freeKick.takerName;
  goalChance(
    71,
    penaltySide,
    clamp(0.74 + penaltyModifier * 0.025 + (penaltyTactics?.setPiece ?? 0), 0.62, 0.86),
    "cobra firme e desloca o goleiro",
    penaltyTaker,
  );

  const cardSide = penaltySide === "home" ? "away" : "home";
  stats[cardSide].fouls += 1;
  const cardRisk = clamp(0.18 + (tacticsFor(cardSide)?.disciplineRisk ?? 0), 0.08, 0.30);
  if (random() < cardRisk) {
    stats[cardSide].redCards += 1;
    event(77, "red-card", `Cartão vermelho! ${player(cardSide)} é expulso após falta por trás.`);
  } else {
    stats[cardSide].yellowCards += 1;
    event(77, "yellow-card", `Cartão amarelo para ${player(cardSide)} por impedir o contra-ataque.`);
  }

  const finalSideThreshold = tacticsEnabled
    ? clamp(0.5 + secondHalfAdvantage * 0.035 + secondHalfTacticalEdge * 0.04, 0.18, 0.82)
    : 0.5 + secondHalfAdvantage * 0.035;
  const finalSide = random() < finalSideThreshold ? "home" : "away";
  const finalModifier = finalSide === "home" ? totalHomeSecondHalfModifier : totalAwaySecondHalfModifier;
  goalChance(
    84,
    finalSide,
    clamp(0.48 + finalModifier * 0.04 + matchupEdge(finalSide) * 0.04, 0.28, 0.68),
    "bate cruzado e encontra o canto",
  );
  event(90, "fulltime", `APITO FINAL! ${scoreText()}.`);

  return {
    id: `match-${seedHash.toString(16).padStart(8, "0")}`,
    seed: String(seed),
    homeTeam,
    awayTeam,
    score: [score.home, score.away],
    statistics: structuredClone(stats),
    events,
  };
}

export class MatchPlayback {
  #cancelled = false;
  #activeWait = null;
  #baseDelayMs;
  #clearTimer;
  #match;
  #now;
  #onEvent;
  #onFinish;
  #onHalftime;
  #pauseGate = null;
  #paused = false;
  #rate = 1;
  #running = false;
  #startIndex = 0;
  #setTimer;
  #skipped = false;

  constructor(match, {
    delayMs = 800,
    onEvent = () => {},
    onFinish = () => {},
    onHalftime = null,
    startIndex = 0,
    initialRate = 1,
    skipped = false,
    now = () => performance.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
  } = {}) {
    this.#match = match;
    this.#baseDelayMs = Math.max(0, Number(delayMs) || 0);
    this.#onEvent = onEvent;
    this.#onFinish = onFinish;
    this.#onHalftime = typeof onHalftime === "function" ? onHalftime : null;
    const normalizedStartIndex = Math.trunc(Number(startIndex) || 0);
    this.#startIndex = clamp(normalizedStartIndex, 0, this.#match.events.length);
    if (![0.5, 1, 2, 3].includes(Number(initialRate))) {
      throw new RangeError("Velocidade inicial da simulacao invalida");
    }
    this.#rate = Number(initialRate);
    this.#skipped = Boolean(skipped);
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  get paused() {
    return this.#paused;
  }

  get rate() {
    return this.#rate;
  }

  get baseDelayMs() {
    return this.#baseDelayMs;
  }

  get effectiveDelayMs() {
    return this.#baseDelayMs / this.#rate;
  }

  get skipped() {
    return this.#skipped;
  }

  async start() {
    if (this.#running) throw new Error("A reprodução da partida já foi iniciada");
    this.#running = true;
    let emittedEvents = this.#startIndex;
    for (const [index, matchEvent] of this.#match.events.entries()) {
      if (index < this.#startIndex) continue;
      if (this.#cancelled) break;
      if (index > 0 && !this.#skipped) await this.#wait();
      if (this.#cancelled) break;
      await this.#onEvent(matchEvent, {
        skipped: this.#skipped,
        rate: this.#rate,
        effectiveDelayMs: this.effectiveDelayMs,
      });
      emittedEvents += 1;
      if (matchEvent.type === "halftime" && this.#onHalftime && !this.#cancelled) {
        this.#paused = true;
        const pausePromise = new Promise((resolve) => {
          this.#pauseGate = resolve;
        });
        await this.#onHalftime(matchEvent, { skipped: this.#skipped });
        if (!this.#cancelled) await pausePromise;
        this.#pauseGate = null;
        this.#paused = false;
      }
    }
    const result = {
      ...this.#match,
      skipped: this.#skipped,
      cancelled: this.#cancelled,
      emittedEvents,
    };
    if (!this.#cancelled) await this.#onFinish(result);
    return result;
  }

  skip() {
    if (this.#cancelled || this.#skipped) return false;
    this.#skipped = true;
    this.#finishActiveWait();
    return true;
  }

  setSpeed(rate) {
    const normalizedRate = Number(rate);
    if (![0.5, 1, 2, 3].includes(normalizedRate)) {
      throw new RangeError("Velocidade de simulacao invalida");
    }
    if (normalizedRate === this.#rate) return false;

    const previousRate = this.#rate;
    if (this.#activeWait) this.#consumeActiveWait(previousRate);
    this.#rate = normalizedRate;
    if (this.#activeWait) this.#scheduleActiveWait();
    return true;
  }

  resume() {
    if (this.#cancelled || !this.#paused || !this.#pauseGate) return false;
    const release = this.#pauseGate;
    this.#pauseGate = null;
    release();
    return true;
  }

  cancel() {
    if (this.#cancelled) return;
    this.#cancelled = true;
    this.#finishActiveWait();
    this.#pauseGate?.();
    this.#pauseGate = null;
  }

  #wait() {
    if (this.#baseDelayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.#activeWait = {
        remainingBaseMs: this.#baseDelayMs,
        startedAt: this.#now(),
        timer: null,
        resolve,
      };
      this.#scheduleActiveWait();
    });
  }

  #consumeActiveWait(rate) {
    const wait = this.#activeWait;
    if (!wait) return;
    const currentTime = this.#now();
    const elapsedRealMs = Math.max(0, currentTime - wait.startedAt);
    wait.remainingBaseMs = Math.max(0, wait.remainingBaseMs - elapsedRealMs * rate);
    wait.startedAt = currentTime;
    if (wait.timer !== null) {
      this.#clearTimer(wait.timer);
      wait.timer = null;
    }
  }

  #scheduleActiveWait() {
    const wait = this.#activeWait;
    if (!wait) return;
    if (wait.remainingBaseMs <= 0) {
      this.#finishActiveWait();
      return;
    }
    wait.startedAt = this.#now();
    wait.timer = this.#setTimer(
      () => this.#finishActiveWait(wait),
      wait.remainingBaseMs / this.#rate,
    );
  }

  #finishActiveWait(expectedWait = this.#activeWait) {
    const wait = this.#activeWait;
    if (!wait || wait !== expectedWait) return false;
    if (wait.timer !== null) this.#clearTimer(wait.timer);
    this.#activeWait = null;
    wait.resolve();
    return true;
  }
}
