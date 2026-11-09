export const PRESS_CONFERENCE_QUESTION_ORDER = Object.freeze([
  "result",
  "possession",
  "performance",
]);

const ANSWERS = Object.freeze({
  "result-confident": {
    questionId: "result",
    tone: "Confiante",
    text: "Controlamos os momentos decisivos e vamos manter essa confiança.",
    squad: 2,
  },
  "result-praise": {
    questionId: "result",
    tone: "Elogioso",
    text: "O grupo executou o plano com coragem e muita disciplina.",
    squad: 3,
  },
  "result-neutral": {
    questionId: "result",
    tone: "Neutro",
    text: "Foi um jogo definido nos detalhes e vamos analisá-lo com calma.",
    squad: 0,
  },
  "result-critical": {
    questionId: "result",
    tone: "Crítico",
    text: "Cometemos erros que não podemos repetir na próxima rodada.",
    squad: -2,
  },
  "possession-praise": {
    questionId: "possession",
    tone: "Elogioso",
    text: "Os dois meios-campos fizeram uma partida intensa e muito tática.",
    squad: 1,
    midfield: 1,
  },
  "possession-confident": {
    questionId: "possession",
    tone: "Confiante",
    text: "Fomos superiores nas zonas que realmente importavam.",
    squad: 1,
  },
  "possession-neutral": {
    questionId: "possession",
    tone: "Neutro",
    text: "A estratégia mudou conforme o jogo e o placar pediram.",
    squad: 0,
  },
  "possession-evasive": {
    questionId: "possession",
    tone: "Evasivo",
    text: "Números isolados não contam toda a história da partida.",
    squad: 0,
  },
  "possession-critical": {
    questionId: "possession",
    tone: "Crítico",
    text: "Precisamos ter mais qualidade e coragem com a bola.",
    squad: -1,
    midfield: -2,
  },
  "discipline-neutral": {
    questionId: "performance",
    tone: "Neutro",
    text: "A disputa foi forte, mas vamos analisar cada lance internamente.",
    squad: 0,
  },
  "discipline-critical": {
    questionId: "performance",
    tone: "Crítico",
    text: "Precisamos competir com intensidade sem oferecer riscos desnecessários.",
    squad: -1,
    defense: -2,
  },
  "discipline-provocative": {
    questionId: "performance",
    tone: "Provocador",
    text: "Futebol exige contato; nosso time não vai fugir de nenhuma disputa.",
    squad: 1,
    defense: 1,
  },
  "attack-confident": {
    questionId: "performance",
    tone: "Confiante",
    text: "Nossa movimentação criou os espaços que planejamos durante a semana.",
    squad: 1,
    attack: 1,
  },
  "attack-critical": {
    questionId: "performance",
    tone: "Crítico",
    text: "Precisamos acertar mais o alvo e ser frios na última decisão.",
    squad: -1,
    attack: -2,
  },
  "attack-praise": {
    questionId: "performance",
    tone: "Elogioso",
    text: "Os atacantes trabalharam pelo coletivo mesmo quando a chance não apareceu.",
    squad: 1,
    attack: 2,
  },
});

const DEFENSIVE_POSITIONS = new Set(["GOL", "ZAG", "LD", "LE"]);
const MIDFIELD_POSITIONS = new Set(["VOL", "MC", "MEI"]);
const ATTACK_POSITIONS = new Set(["PD", "PE", "ATA"]);

function pressError(message, code = "PRESS_CONFERENCE_INVALID", status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.public = true;
  return error;
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampMoraleScore(value) {
  return Math.max(20, Math.min(100, Math.round(numeric(value, 70))));
}

export function clampPlayerMoraleDelta(value) {
  return Math.max(-15, Math.min(15, Math.round(numeric(value, 0))));
}

export function moraleLabel(scoreValue) {
  const score = clampMoraleScore(scoreValue);
  if (score >= 85) return "Excelente";
  if (score >= 65) return "Boa";
  if (score >= 45) return "Neutra";
  return "Baixa";
}

export function basePlayerMoraleScore(player) {
  if (Number.isFinite(Number(player?.moraleScore))) {
    return clampMoraleScore(Number(player.moraleScore));
  }
  return {
    Excelente: 92,
    Boa: 75,
    Neutra: 52,
    Baixa: 30,
  }[player?.morale] ?? 75;
}

export function sectorForPosition(positionValue) {
  const position = String(positionValue ?? "").trim().toUpperCase();
  if (DEFENSIVE_POSITIONS.has(position)) return "defense";
  if (MIDFIELD_POSITIONS.has(position)) return "midfield";
  if (ATTACK_POSITIONS.has(position)) return "attack";
  return null;
}

function sideStatistics(match, side) {
  const statistics = match?.statistics?.[side];
  return {
    possession: numeric(statistics?.possession, 50),
    fouls: Math.max(0, numeric(statistics?.fouls, 0)),
    yellowCards: Math.max(0, numeric(statistics?.yellowCards, 0)),
    redCards: Math.max(0, numeric(statistics?.redCards, 0)),
  };
}

function allowedAnswerIds(match, side) {
  const score = Array.isArray(match?.score) ? match.score : [0, 0];
  const ownScore = numeric(score[side === "away" ? 1 : 0]);
  const rivalScore = numeric(score[side === "away" ? 0 : 1]);
  const stats = sideStatistics(match, side);

  const result = ownScore > rivalScore
    ? ["result-confident", "result-praise", "result-neutral"]
    : ownScore < rivalScore
      ? ["result-critical", "result-neutral", "result-confident"]
      : ["result-neutral", "result-critical", "result-praise"];
  const possession = stats.possession >= 55
    ? ["possession-confident", "possession-critical", "possession-evasive"]
    : stats.possession <= 45
      ? ["possession-confident", "possession-critical", "possession-neutral"]
      : ["possession-praise", "possession-confident", "possession-evasive"];
  const hasDisciplineQuestion = stats.fouls >= 10 || stats.yellowCards + stats.redCards > 0;
  const performance = hasDisciplineQuestion
    ? ["discipline-neutral", "discipline-critical", "discipline-provocative"]
    : ["attack-confident", "attack-critical", "attack-praise"];
  return { result, possession, performance };
}

function contextualAnswerText(answerId, match, side) {
  const score = Array.isArray(match?.score) ? match.score : [0, 0];
  const ownScore = numeric(score[side === "away" ? 1 : 0]);
  const rivalScore = numeric(score[side === "away" ? 0 : 1]);
  const stats = sideStatistics(match, side);

  if (answerId === "result-confident") {
    return ownScore > rivalScore
      ? "Controlamos os momentos decisivos e merecemos essa vitória."
      : "O placar machuca, mas a resposta do elenco virá imediatamente.";
  }
  if (answerId === "result-praise") {
    return ownScore > rivalScore
      ? "O grupo executou o plano com coragem e muita disciplina."
      : "A equipe competiu até o fim e mostrou personalidade.";
  }
  if (answerId === "result-neutral") {
    if (ownScore > rivalScore) return "Foi um jogo equilibrado, definido nos detalhes.";
    if (ownScore < rivalScore) {
      return "Precisamos rever a partida com calma antes de tirar conclusões.";
    }
    return "O empate refletiu o equilíbrio visto durante os noventa minutos.";
  }
  if (answerId === "result-critical") {
    return ownScore < rivalScore
      ? "Cometemos erros que não podemos repetir na próxima rodada."
      : "Criamos o suficiente e faltou transformar volume em gols.";
  }
  if (answerId === "possession-confident") {
    if (stats.possession >= 55) {
      return "A posse teve propósito; mantivemos o adversário sob pressão.";
    }
    if (stats.possession <= 45) {
      return "Cedemos espaço de forma consciente para atacar em velocidade.";
    }
    return "Fomos superiores nas zonas que realmente importavam.";
  }
  if (answerId === "possession-critical") {
    return stats.possession >= 55
      ? "Precisamos acelerar mais perto da área e criar chances melhores."
      : "Recuamos demais e precisamos ter mais coragem com a bola.";
  }
  if (answerId === "possession-evasive") {
    return stats.possession >= 55
      ? "Números isolados não contam toda a história da partida."
      : "Prefiro avaliar nossas decisões, não somente a posse.";
  }
  return ANSWERS[answerId]?.text ?? "";
}

export function resolvePressConferenceAnswers({ match, side, answers }) {
  if (side !== "home" && side !== "away") {
    throw pressError("Nao foi possivel identificar o clube nesta partida", "PRESS_CONFERENCE_NOT_PARTICIPANT", 403);
  }
  const answerByQuestion = new Map((answers ?? []).map((answer) => [answer.questionId, answer.answerId]));
  const allowed = allowedAnswerIds(match, side);
  const canonicalAnswers = PRESS_CONFERENCE_QUESTION_ORDER.map((questionId) => {
    const answerId = answerByQuestion.get(questionId);
    const answer = ANSWERS[answerId];
    if (!answer || answer.questionId !== questionId || !allowed[questionId].includes(answerId)) {
      throw pressError(
        `Resposta invalida para a pergunta ${questionId}`,
        "PRESS_CONFERENCE_ANSWER_INVALID",
        400,
      );
    }
    return {
      questionId,
      answerId,
      tone: answer.tone,
      text: contextualAnswerText(answerId, match, side),
    };
  });

  const effects = canonicalAnswers.reduce((total, canonical) => {
    const answer = ANSWERS[canonical.answerId];
    total.squadMoraleDelta += answer.squad ?? 0;
    total.sectorDeltas.defense += answer.defense ?? 0;
    total.sectorDeltas.midfield += answer.midfield ?? 0;
    total.sectorDeltas.attack += answer.attack ?? 0;
    return total;
  }, {
    squadMoraleDelta: 0,
    sectorDeltas: { defense: 0, midfield: 0, attack: 0 },
  });

  return { answers: canonicalAnswers, effects };
}

function resultDescription(match, clubSide) {
  const score = Array.isArray(match?.score) ? match.score : [0, 0];
  const ownScore = numeric(score[clubSide === "away" ? 1 : 0]);
  const rivalScore = numeric(score[clubSide === "away" ? 0 : 1]);
  if (ownScore > rivalScore) return "a vitória";
  if (ownScore < rivalScore) return "a derrota";
  return "o empate";
}

export function buildPressConferenceEditorial({ room, match, manager, submission }) {
  const clubName = submission.clubName || manager?.clubId || "o clube";
  const score = Array.isArray(match?.score) ? match.score : [0, 0];
  const answers = submission.answers ?? [];
  const answerText = answers.map((answer) => `“${answer.text}”`).join(" ");
  const result = resultDescription(match, submission.clubSide);
  const editorialKey = `press:${submission.matchId}:${submission.managerId}`;
  return {
    editorialKey,
    id: editorialKey,
    roomCode: room.code,
    clubId: submission.clubId,
    source: "Central da Rodada",
    sourceType: "imprensa",
    headline: `${clubName} repercute ${result} em coletiva pós-jogo`,
    body: `Após ${match.homeTeam} ${score[0]} a ${score[1]} ${match.awayTeam}, ${manager?.name || "o manager"} falou à imprensa. ${answerText}`,
    reactions: Math.max(0, 120 + submission.effects.squadMoraleDelta * 18),
    tag: "PÓS-JOGO",
  };
}

export function fallbackPressComment(submission) {
  const delta = submission?.effects?.squadMoraleDelta ?? 0;
  if (delta > 0) {
    return {
      id: `press-comment:${submission.matchId}:${submission.managerId}`,
      author: "Arquibancada",
      role: "torcida",
      text: "A postura do manager na coletiva foi bem recebida pelo elenco e pela torcida.",
      sentiment: "positivo",
    };
  }
  if (delta < 0) {
    return {
      id: `press-comment:${submission.matchId}:${submission.managerId}`,
      author: "Voz da Torcida",
      role: "torcida",
      text: "A cobrança pública aumentou a pressão sobre o elenco para a próxima rodada.",
      sentiment: "critico",
    };
  }
  return {
    id: `press-comment:${submission.matchId}:${submission.managerId}`,
    author: "Central da Rodada",
    role: "imprensa",
    text: "A coletiva manteve o tom equilibrado depois do apito final.",
    sentiment: "neutro",
  };
}
