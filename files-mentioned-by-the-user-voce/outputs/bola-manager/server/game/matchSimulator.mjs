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

export function simulateMatch({
  homeTeam,
  awayTeam,
  homeStrength = 10,
  awayStrength = 10,
  seed = "bola-manager",
}) {
  const normalizedSeed = `${seed}|${homeTeam}|${awayTeam}|${homeStrength}|${awayStrength}`;
  const seedHash = hashSeed(normalizedSeed);
  const random = seededRandom(seedHash);
  const advantage = Math.max(-8, Math.min(8, homeStrength - awayStrength));
  const possessionHome = Math.max(38, Math.min(62, 50 + Math.round(advantage * 1.2 + random() * 6 - 3)));
  const stats = createStats(possessionHome);
  const score = { home: 0, away: 0 };
  const events = [];
  let sequence = 0;

  const sideName = (side) => side === "home" ? homeTeam : awayTeam;
  const player = (side) => pick(random, PLAYERS[side]);
  const scoreText = () => `${homeTeam} ${score.home} x ${score.away} ${awayTeam}`;
  const event = (minute, type, text, extra = {}) => {
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
  const goalChance = (minute, side, probability, description) => {
    const scorer = player(side);
    shot(side, true);
    if (random() < probability) {
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
  goalChance(7, "home", Math.max(0.28, Math.min(0.72, 0.5 + advantage * 0.025)), "cabeceia no canto e abre o placar");

  shot("away", true);
  event(14, "save", `DEFESAÇA! O goleiro de ${homeTeam} busca no canto a finalização de ${player("away")}.`);
  stats.away.fouls += 1;
  event(23, "foul", `Falta perigosa para o ${homeTeam} na entrada da área.`);
  stats.home.corners += 1;
  event(31, "corner", `Escanteio para o ${homeTeam}. A zaga afasta o cruzamento fechado.`);
  stats.away.fouls += 1;
  stats.away.yellowCards += 1;
  event(38, "yellow-card", `Cartão amarelo para ${player("away")} após entrada dura no meio-campo.`);
  event(45, "halftime", `Fim do primeiro tempo. ${scoreText()}.`);

  shot("home", false);
  event(52, "post", `NA TRAVE! ${player("home")} acerta o poste em chute de fora da área.`);
  event(58, "injury", `${player("away")} sente a coxa e recebe atendimento no gramado.`);
  event(63, "substitution", `SUBSTITUIÇÃO: ${sideName("away")} mexe no ataque para ganhar velocidade.`);

  const penaltySide = random() < 0.5 - advantage * 0.02 ? "away" : "home";
  stats[penaltySide === "home" ? "away" : "home"].fouls += 1;
  event(68, "penalty", `PÊNALTI para o ${sideName(penaltySide)}! O árbitro aponta a marca da cal.`);
  event(69, "var", "VAR EM AÇÃO: o lance é revisado e a penalidade está confirmada.");
  goalChance(71, penaltySide, 0.74, "cobra firme e desloca o goleiro");

  const cardSide = penaltySide === "home" ? "away" : "home";
  stats[cardSide].fouls += 1;
  if (random() < 0.18) {
    stats[cardSide].redCards += 1;
    event(77, "red-card", `Cartão vermelho! ${player(cardSide)} é expulso após falta por trás.`);
  } else {
    stats[cardSide].yellowCards += 1;
    event(77, "yellow-card", `Cartão amarelo para ${player(cardSide)} por impedir o contra-ataque.`);
  }

  const finalSide = random() < 0.5 + advantage * 0.035 ? "home" : "away";
  goalChance(84, finalSide, 0.48, "bate cruzado e encontra o canto");
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
  #delayMs;
  #match;
  #onEvent;
  #onFinish;
  #running = false;
  #skipped = false;
  #wake = null;

  constructor(match, { delayMs = 800, onEvent = () => {}, onFinish = () => {} } = {}) {
    this.#match = match;
    this.#delayMs = Math.max(0, Number(delayMs) || 0);
    this.#onEvent = onEvent;
    this.#onFinish = onFinish;
  }

  async start() {
    if (this.#running) throw new Error("A reprodução da partida já foi iniciada");
    this.#running = true;
    let emittedEvents = 0;
    for (const [index, matchEvent] of this.#match.events.entries()) {
      if (this.#cancelled) break;
      if (index > 0 && !this.#skipped) await this.#wait();
      if (this.#cancelled) break;
      await this.#onEvent(matchEvent, { skipped: this.#skipped });
      emittedEvents += 1;
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
    if (this.#cancelled) return false;
    this.#skipped = true;
    this.#wake?.();
    return true;
  }

  cancel() {
    this.#cancelled = true;
    this.#wake?.();
  }

  #wait() {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#wake = null;
        resolve();
      }, this.#delayMs);
      this.#wake = () => {
        clearTimeout(timer);
        this.#wake = null;
        resolve();
      };
    });
  }
}
