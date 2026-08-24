import { playerAttributeRatings } from "./lineupStrength.mjs";
import { isPlayerAvailableForMatch } from "./starImpact.mjs";
import { FORMATION_ROLES } from "./tactics.mjs";

const DEPTH_CONFIG = Object.freeze({
  quick: Object.freeze({ confidence: 48, findings: 2, hours: 4, label: "baixa" }),
  standard: Object.freeze({ confidence: 72, findings: 4, hours: 16, label: "média" }),
  deep: Object.freeze({ confidence: 90, findings: 6, hours: 40, label: "alta" }),
});

const POSITION_SECTORS = Object.freeze({
  GOL: "goalkeeping",
  ZAG: "defense",
  LD: "defense",
  LE: "defense",
  VOL: "midfield",
  MC: "midfield",
  MEI: "midfield",
  PD: "attack",
  PE: "attack",
  ATA: "attack",
});

const COMPATIBLE_POSITIONS = Object.freeze({
  GOL: Object.freeze(["GOL"]),
  ZAG: Object.freeze(["ZAG", "VOL", "LD", "LE"]),
  LD: Object.freeze(["LD", "ZAG", "PD"]),
  LE: Object.freeze(["LE", "ZAG", "PE"]),
  VOL: Object.freeze(["VOL", "MC", "ZAG"]),
  MC: Object.freeze(["MC", "VOL", "MEI"]),
  MEI: Object.freeze(["MEI", "MC", "PD", "PE"]),
  PD: Object.freeze(["PD", "MEI", "ATA"]),
  PE: Object.freeze(["PE", "MEI", "ATA"]),
  ATA: Object.freeze(["ATA", "PD", "PE", "MEI"]),
});

const SECTOR_DEFINITIONS = Object.freeze({
  defense: Object.freeze({
    label: "Defesa",
    positions: Object.freeze(["ZAG", "LD", "LE"]),
    attributes: Object.freeze(["defesa", "nocao", "forca", "velocidade"]),
  }),
  midfield: Object.freeze({
    label: "Meio-campo",
    positions: Object.freeze(["VOL", "MC", "MEI"]),
    attributes: Object.freeze(["passe", "nocao", "drible", "defesa", "resistencia"]),
  }),
  attack: Object.freeze({
    label: "Ataque",
    positions: Object.freeze(["PD", "PE", "ATA"]),
    attributes: Object.freeze(["chute", "drible", "velocidade", "nocao", "passe"]),
  }),
  goalkeeping: Object.freeze({
    label: "Gol",
    positions: Object.freeze(["GOL"]),
    attributes: Object.freeze(["reflexos", "posicionamentoGol", "saidaGol", "penaltis"]),
  }),
});

const MENTALITY_LABELS = Object.freeze({
  cautious: "Cauteloso",
  balanced: "Equilibrado",
  positive: "Positivo",
  attacking: "Ofensivo",
});

function identifier(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function position(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function finiteRating(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 1 && numeric <= 20 ? numeric : null;
}

function rounded(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values) {
  const numeric = values.filter(Number.isFinite);
  return numeric.length > 0
    ? numeric.reduce((total, value) => total + value, 0) / numeric.length
    : null;
}

function playerName(player) {
  return identifier(player?.shortName ?? player?.name ?? player?.id) || "Jogador não identificado";
}

function attributeValues(player, names) {
  return names.flatMap((name) => {
    const value = finiteRating(player?.attributes?.[name]);
    return value == null ? [] : [value];
  });
}

function playerOverall(player) {
  const explicit = finiteRating(player?.overall);
  if (explicit != null) return explicit;
  const positional = playerAttributeRatings(player)?.positional;
  if (Number.isFinite(positional)) return positional;
  return average(Object.values(player?.attributes ?? {}).map(finiteRating).filter((value) => value != null));
}

function playerMetric(player, attributes) {
  const measured = average(attributeValues(player, attributes));
  return measured ?? playerOverall(player);
}

function fixtureIdentifier(fixture) {
  return [fixture?.leagueFixtureId, fixture?.competitionFixtureId, fixture?.fixtureId, fixture?.id]
    .map(identifier)
    .find(Boolean) ?? null;
}

function resolveOpponent(fixture, viewerClubId, opponentClub) {
  const viewer = key(viewerClubId);
  const homeId = identifier(fixture?.homeClubId);
  const awayId = identifier(fixture?.awayClubId);
  const fixtureOpponentId = viewer && viewer === key(homeId)
    ? awayId
    : viewer && viewer === key(awayId) ? homeId : "";
  const fixtureOpponentName = viewer && viewer === key(homeId)
    ? identifier(fixture?.awayTeam)
    : viewer && viewer === key(awayId) ? identifier(fixture?.homeTeam) : "";
  const id = fixtureOpponentId
    || identifier(opponentClub?.id ?? opponentClub?.clubId ?? opponentClub?.code);
  return {
    id: id || null,
    code: identifier(opponentClub?.code) || id || null,
    name: identifier(opponentClub?.name) || fixtureOpponentName || "Adversário não identificado",
  };
}

function scopePlayers(players, opponentId) {
  const catalog = Array.isArray(players) ? players.filter((player) => player && typeof player === "object") : [];
  const tagged = catalog.filter((player) => identifier(player?.clubId));
  if (!opponentId || tagged.length === 0) return catalog;
  return tagged.filter((player) => key(player.clubId) === key(opponentId));
}

function lineupIdentifiers(lineup) {
  const values = Array.isArray(lineup)
    ? lineup
    : Array.isArray(lineup?.lineupIds) ? lineup.lineupIds
      : Array.isArray(lineup?.playerIds) ? lineup.playerIds : [];
  return values.map((value) => identifier(value?.id ?? value)).filter(Boolean).slice(0, 11);
}

function inferFormation(players) {
  if (players.length === 0) return { id: "4-3-3", source: "default" };
  const counts = new Map();
  for (const player of players) {
    const role = position(player?.position);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  const candidates = Object.entries(FORMATION_ROLES).map(([formationId, roles], order) => {
    const roleCounts = new Map();
    for (const role of roles) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    const knownRoles = new Set([...counts.keys(), ...roleCounts.keys()]);
    const distance = [...knownRoles].reduce(
      (total, role) => total + Math.abs((counts.get(role) ?? 0) - (roleCounts.get(role) ?? 0)),
      0,
    );
    return { id: formationId, distance, order };
  }).sort((left, right) => left.distance - right.distance || left.order - right.order);
  return { id: candidates[0]?.id ?? "4-3-3", source: "lineup-inference" };
}

function formationSelection(tacticPreview, providedPlayers) {
  const previewFormation = identifier(tacticPreview?.formationId);
  if (Object.hasOwn(FORMATION_ROLES, previewFormation)) {
    return { id: previewFormation, source: "public-preview" };
  }
  return inferFormation(providedPlayers);
}

function fitForRole(player, role) {
  const actual = position(player?.position);
  if (actual === role) return 1;
  return (COMPATIBLE_POSITIONS[role] ?? []).includes(actual) ? 0.65 : 0.15;
}

function selectionScore(player, role) {
  return fitForRole(player, role) * 10 + (playerOverall(player) ?? 0) / 20;
}

function bestPlayerForRole(players, usedIds, role) {
  return players
    .filter((player) => !usedIds.has(identifier(player?.id)))
    .sort((left, right) => (
      selectionScore(right, role) - selectionScore(left, role)
      || playerName(left).localeCompare(playerName(right), "pt-BR")
      || identifier(left?.id).localeCompare(identifier(right?.id), "pt-BR")
    ))[0] ?? null;
}

function buildProbableLineup(players, providedIds, formationId) {
  const roles = FORMATION_ROLES[formationId] ?? FORMATION_ROLES["4-3-3"];
  const playersById = new Map(players.map((player) => [identifier(player?.id), player]));
  const providedSlots = providedIds.map((playerId) => playersById.get(playerId) ?? null);
  const usedIds = new Set(providedSlots.flatMap((player) => player ? [identifier(player.id)] : []));
  const selected = roles.map((role, index) => {
    const provided = providedSlots[index];
    if (provided) return provided;
    const replacement = bestPlayerForRole(players, usedIds, role);
    if (replacement) usedIds.add(identifier(replacement.id));
    return replacement;
  });
  return selected.flatMap((player, index) => player ? [{
    id: identifier(player.id),
    name: playerName(player),
    position: position(player.position) || null,
    role: roles[index],
    overall: rounded(playerOverall(player), 1),
    fit: rounded(fitForRole(player, roles[index]), 2),
  }] : []);
}

function sectorMetric(code, lineupPlayers) {
  const definition = SECTOR_DEFINITIONS[code];
  const selected = lineupPlayers.filter((player) => definition.positions.includes(position(player?.position)));
  const rating = average(selected.map((player) => playerMetric(player, definition.attributes)));
  return {
    code: code.toLocaleUpperCase("pt-BR"),
    label: definition.label,
    rating: rounded(rating),
    sampleSize: selected.length,
    classification: rating == null ? "unknown" : rating >= 13 ? "strong" : rating <= 9.5 ? "vulnerable" : "balanced",
  };
}

function signal(lineupPlayers, positions, attributes) {
  const selected = lineupPlayers.filter((player) => positions.includes(position(player?.position)));
  return rounded(average(selected.map((player) => playerMetric(player, attributes))));
}

function threatProfile(player) {
  const role = POSITION_SECTORS[position(player?.position)] ?? "unknown";
  const overall = playerOverall(player);
  const finishing = playerMetric(player, ["chute", "nocao", "peBom"]);
  const creation = playerMetric(player, ["passe", "drible", "nocao"]);
  const aerial = playerMetric(player, ["impulsao", "forca", "nocao"]);
  const defending = playerMetric(player, ["defesa", "nocao", "forca"]);
  const goalkeeping = playerMetric(player, ["reflexos", "posicionamentoGol", "saidaGol"]);
  const score = role === "attack"
    ? average([overall, finishing, finishing, creation, aerial])
    : role === "midfield" ? average([overall, creation, creation, finishing, defending])
      : role === "defense" ? average([overall, defending, defending, aerial, creation])
        : role === "goalkeeping" ? average([overall, goalkeeping, goalkeeping]) : overall;
  const reasons = [
    { code: "FINISHING", label: "finalização", value: finishing },
    { code: "CREATION", label: "criação", value: creation },
    { code: "AERIAL", label: "jogo aéreo", value: aerial },
    { code: "DEFENDING", label: "capacidade defensiva", value: defending },
    { code: "GOALKEEPING", label: "proteção do gol", value: goalkeeping },
  ].filter((candidate) => Number.isFinite(candidate.value));
  const allowed = role === "goalkeeping"
    ? new Set(["GOALKEEPING"])
    : role === "defense" ? new Set(["DEFENDING", "AERIAL", "CREATION"])
      : role === "midfield" ? new Set(["CREATION", "FINISHING", "DEFENDING"])
        : new Set(["FINISHING", "CREATION", "AERIAL"]);
  return {
    player,
    score: score ?? 0,
    reasons: reasons.filter((candidate) => allowed.has(candidate.code))
      .sort((left, right) => right.value - left.value || left.code.localeCompare(right.code))
      .slice(0, 2)
      .map(({ code, label }) => ({ code, label })),
  };
}

function dangerousPlayers(lineupPlayers) {
  return lineupPlayers.map(threatProfile)
    .sort((left, right) => (
      right.score - left.score
      || playerName(left.player).localeCompare(playerName(right.player), "pt-BR")
      || identifier(left.player?.id).localeCompare(identifier(right.player?.id), "pt-BR")
    ))
    .slice(0, 3)
    .map((entry, index) => ({
      rank: index + 1,
      id: identifier(entry.player.id),
      name: playerName(entry.player),
      position: position(entry.player.position) || null,
      score: rounded(entry.score),
      reasons: entry.reasons,
    }));
}

function tacticTraits(tacticPreview) {
  if (!tacticPreview || typeof tacticPreview !== "object") return [];
  const instructions = tacticPreview.teamInstructions ?? {};
  const traits = [];
  if (["high", "very-high"].includes(instructions.pressureLine)
    || ["intense", "aggressive"].includes(instructions.pressing)) {
    traits.push({ code: "HIGH_PRESS", label: "pressão alta" });
  }
  if (["low", "very-low"].includes(instructions.pressureLine)) {
    traits.push({ code: "LOW_BLOCK", label: "bloco baixo" });
  }
  if (["wide", "very-wide"].includes(instructions.width)) {
    traits.push({ code: "WIDE_PLAY", label: "amplitude pelos lados" });
  }
  if (["fast", "very-fast"].includes(instructions.tempo)) {
    traits.push({ code: "FAST_TEMPO", label: "ritmo alto" });
  }
  if (instructions.offensiveTransition === "counter") {
    traits.push({ code: "COUNTER_ATTACK", label: "contra-ataque" });
  } else if (instructions.offensiveTransition === "direct") {
    traits.push({ code: "DIRECT_PLAY", label: "jogo direto" });
  } else if (instructions.offensiveTransition === "build-up") {
    traits.push({ code: "BUILD_UP", label: "saída construída" });
  }
  return traits;
}

function buildStyle(tacticPreview, sectors) {
  const previewTraits = tacticTraits(tacticPreview);
  if (tacticPreview && typeof tacticPreview === "object") {
    const mentality = identifier(tacticPreview.mentality);
    const primary = previewTraits[0];
    return {
      code: primary?.code ?? (mentality.toLocaleUpperCase("pt-BR") || "BALANCED"),
      label: primary?.label ?? MENTALITY_LABELS[mentality] ?? "Equilibrado",
      mentality: MENTALITY_LABELS[mentality] ?? null,
      traits: previewTraits,
      source: "public-preview",
    };
  }
  const values = Object.values(sectors).filter((sector) => Number.isFinite(sector.rating));
  const strongest = [...values].sort((left, right) => right.rating - left.rating || left.code.localeCompare(right.code))[0];
  const derived = strongest?.code === "ATTACK"
    ? { code: "OFFENSIVE", label: "Ofensivo" }
    : strongest?.code === "MIDFIELD" ? { code: "CONTROL", label: "Controle pelo meio" }
      : strongest?.code === "DEFENSE" || strongest?.code === "GOALKEEPING"
        ? { code: "COMPACT", label: "Compacto" }
        : { code: "BALANCED", label: "Equilibrado" };
  return { ...derived, mentality: null, traits: [], source: "player-data-inference" };
}

function finding(code, label, detail, severity, evidence = {}) {
  return { code, label, detail, severity: rounded(severity), evidence };
}

function weaknessCandidates(signals, tacticPreview, formationId) {
  const candidates = [];
  const addLow = (value, threshold, code, label, detail) => {
    if (Number.isFinite(value) && value < threshold) {
      candidates.push(finding(code, label, detail, threshold - value, { rating: value, threshold }));
    }
  };
  addLow(signals.flankDefense, 10.5, "FLANK_DEFENSE", "Laterais vulneráveis", "Os lados cedem duelos e espaço defensivo.");
  addLow(signals.midfieldMarking, 10.5, "MIDFIELD_MARKING", "Marcação frágil no meio", "O meio-campo tem baixa proteção sem a bola.");
  addLow(signals.aerialDefense, 10.5, "AERIAL_DEFENSE", "Defesa aérea vulnerável", "A defesa apresenta dificuldade em força e impulsão.");
  addLow(signals.buildUp, 10.5, "BUILDUP_UNDER_PRESSURE", "Saída sensível à pressão", "Passe e tomada de decisão na primeira fase estão abaixo da média.");
  const roles = FORMATION_ROLES[formationId] ?? [];
  const defensiveMidfielders = roles.filter((role) => role === "VOL").length;
  const attackingPlan = ["positive", "attacking"].includes(tacticPreview?.mentality);
  if (Number.isFinite(signals.betweenLines)
    && (signals.betweenLines < 10.5 || (defensiveMidfielders === 0 && attackingPlan))) {
    const tacticalPenalty = defensiveMidfielders === 0 && attackingPlan ? 1 : 0;
    candidates.push(finding(
      "SPACE_BETWEEN_LINES",
      "Espaço entre as linhas",
      "Há margem para receber entre o meio e a defesa.",
      Math.max(0.1, 10.5 - signals.betweenLines) + tacticalPenalty,
      { rating: signals.betweenLines, defensiveMidfielders },
    ));
  }
  const highLine = ["high", "very-high"].includes(tacticPreview?.teamInstructions?.pressureLine);
  if (highLine && Number.isFinite(signals.defenderSpeed) && signals.defenderSpeed < 11.5) {
    candidates.push(finding(
      "SPACE_BEHIND_HIGH_LINE",
      "Espaço nas costas da defesa",
      "A linha alta não é sustentada por velocidade defensiva.",
      11.5 - signals.defenderSpeed + 0.5,
      { rating: signals.defenderSpeed, threshold: 11.5 },
    ));
  }
  return candidates.sort((left, right) => right.severity - left.severity || left.code.localeCompare(right.code));
}

function strengthCandidates(sectors, signals, tacticPreview) {
  const candidates = Object.values(sectors)
    .filter((sector) => Number.isFinite(sector.rating) && sector.rating >= 12)
    .map((sector) => finding(
      `STRONG_${sector.code}`,
      `${sector.label} forte`,
      `${sector.label} é um dos setores mais consistentes da equipe.`,
      sector.rating - 11,
      { rating: sector.rating },
    ));
  if (Number.isFinite(signals.aerialAttack) && signals.aerialAttack >= 12.5) {
    candidates.push(finding("AERIAL_THREAT", "Ameaça aérea", "Atacantes oferecem força e impulsão pelo alto.", signals.aerialAttack - 11.5, { rating: signals.aerialAttack }));
  }
  if (Number.isFinite(signals.attackerSpeed) && signals.attackerSpeed >= 13) {
    candidates.push(finding("FAST_ATTACK", "Ataque veloz", "O ataque ameaça o espaço em transições.", signals.attackerSpeed - 12, { rating: signals.attackerSpeed }));
  }
  if (["intense", "aggressive"].includes(tacticPreview?.teamInstructions?.pressing)) {
    candidates.push(finding("HIGH_PRESS", "Pressão agressiva", "A equipe tenta recuperar a bola rapidamente.", 1.5, { source: "public-preview" }));
  }
  return candidates.sort((left, right) => right.severity - left.severity || left.code.localeCompare(right.code));
}

const RECOMMENDATION_BY_WEAKNESS = Object.freeze({
  FLANK_DEFENSE: Object.freeze({ code: "ATTACK_FLANKS", label: "Atacar pelos lados", detail: "Use amplitude e sobreposições contra os laterais." }),
  MIDFIELD_MARKING: Object.freeze({ code: "OVERLOAD_MIDFIELD", label: "Criar superioridade no meio", detail: "Aproxime meio-campistas para dominar a zona central." }),
  AERIAL_DEFENSE: Object.freeze({ code: "USE_AERIAL_BALLS", label: "Explorar o jogo aéreo", detail: "Cruze com frequência e ataque a segunda bola." }),
  BUILDUP_UNDER_PRESSURE: Object.freeze({ code: "PRESS_HIGH", label: "Pressionar a saída", detail: "Suba a pressão sobre os primeiros passes." }),
  SPACE_BETWEEN_LINES: Object.freeze({ code: "USE_NUMBER_TEN", label: "Ocupar a entrelinha", detail: "Posicione um meia entre os volantes e zagueiros." }),
  SPACE_BEHIND_HIGH_LINE: Object.freeze({ code: "ATTACK_DEPTH", label: "Atacar a profundidade", detail: "Use velocidade e passes nas costas da linha alta." }),
});

function recommendationsFor(weaknesses, strengths, maximum) {
  const recommendations = [];
  const used = new Set();
  const add = (candidate) => {
    if (!candidate || used.has(candidate.code)) return;
    used.add(candidate.code);
    recommendations.push(candidate);
  };
  for (const weakness of weaknesses) {
    const recommendation = RECOMMENDATION_BY_WEAKNESS[weakness.code];
    add(recommendation ? { ...recommendation, basedOn: [weakness.code] } : null);
  }
  if (strengths.some((entry) => entry.code === "AERIAL_THREAT")) {
    add({ code: "PROTECT_BOX", label: "Proteger a área", detail: "Evite faltas laterais e reforce a marcação aérea.", basedOn: ["AERIAL_THREAT"] });
  }
  if (strengths.some((entry) => entry.code === "HIGH_PRESS")) {
    add({ code: "ESCAPE_PRESS", label: "Escapar da pressão", detail: "Ofereça opção curta e uma saída direta de segurança.", basedOn: ["HIGH_PRESS"] });
  }
  if (recommendations.length === 0) {
    add({ code: "KEEP_BALANCE", label: "Manter equilíbrio", detail: "Não há desequilíbrio claro; preserve cobertura e controle.", basedOn: [] });
  }
  return recommendations.slice(0, maximum);
}

function confidenceFor(
  depth,
  lineupPlayers,
  formationSource,
  professionalBonus = 0,
  professionalSpeedMultiplier = 1,
) {
  const configured = DEPTH_CONFIG[depth];
  const measured = lineupPlayers.filter((player) => (
    playerOverall(player) != null || Object.values(player?.attributes ?? {}).some((value) => finiteRating(value) != null)
  )).length;
  const completeness = lineupPlayers.length > 0 ? measured / lineupPlayers.length : 0;
  const formationBonus = formationSource === "public-preview" ? 4 : formationSource === "lineup-inference" ? 0 : -8;
  const appliedProfessionalBonus = Math.max(0, Math.min(24, Number(professionalBonus) || 0));
  const speedMultiplier = Math.max(0.7, Math.min(1, Number(professionalSpeedMultiplier) || 1));
  const speedEfficiencyBonus = (1 / speedMultiplier - 1) * 12;
  const score = Math.max(10, Math.min(98, Math.round(
    configured.confidence * (0.55 + completeness * 0.45)
      + formationBonus
      + appliedProfessionalBonus
      + speedEfficiencyBonus,
  )));
  return {
    depth,
    score,
    label: score >= 80 ? "alta" : score >= 58 ? "média" : "baixa",
    deterministic: true,
    professionalBonus: Math.round(appliedProfessionalBonus * 10) / 10,
    scoutingSpeedMultiplier: rounded(speedMultiplier, 3),
    estimatedStudyHours: rounded(configured.hours * speedMultiplier, 1),
    note: `${configured.label === "alta" ? "Estudo profundo" : configured.label === "média" ? "Estudo padrão" : "Estudo rápido"}; ${measured} de ${lineupPlayers.length} atletas com dados mensuráveis${appliedProfessionalBonus > 0 ? "; estrutura e comissão elevaram a precisão" : ""}.`,
  };
}

/**
 * Builds a deterministic report from caller-visible data. Deliberately ignores
 * `lineup.tactics`; only `tacticPreview` may reveal tactical information.
 */
export function buildOpponentStudy({
  fixture,
  viewerClubId,
  opponentClub,
  players,
  lineup,
  tacticPreview,
  depth = "standard",
  professionalConfidenceBonus = 0,
  professionalSpeedMultiplier = 1,
} = {}) {
  const normalizedDepth = Object.hasOwn(DEPTH_CONFIG, depth) ? depth : "standard";
  const config = DEPTH_CONFIG[normalizedDepth];
  const opponent = resolveOpponent(fixture, viewerClubId, opponentClub);
  const roster = scopePlayers(players, opponent.id);
  const available = roster.filter(isPlayerAvailableForMatch);
  const providedIds = lineupIdentifiers(lineup);
  const availableById = new Map(available.map((player) => [identifier(player.id), player]));
  const providedPlayers = providedIds.flatMap((playerId) => {
    const player = availableById.get(playerId);
    return player ? [player] : [];
  });
  const formation = formationSelection(tacticPreview, providedPlayers);
  const probableLineup = buildProbableLineup(available, providedIds, formation.id);
  const rosterById = new Map(available.map((player) => [identifier(player.id), player]));
  const lineupPlayers = probableLineup.flatMap((entry) => {
    const player = rosterById.get(entry.id);
    return player ? [player] : [];
  });
  const sectors = Object.fromEntries(
    Object.keys(SECTOR_DEFINITIONS).map((code) => [code, sectorMetric(code, lineupPlayers)]),
  );
  const signals = {
    flankDefense: signal(lineupPlayers, ["LD", "LE"], ["defesa", "velocidade", "nocao", "resistencia"]),
    midfieldMarking: signal(lineupPlayers, ["VOL", "MC", "MEI"], ["defesa", "nocao", "forca", "resistencia"]),
    aerialDefense: signal(lineupPlayers, ["ZAG", "LD", "LE"], ["impulsao", "forca", "nocao", "defesa"]),
    aerialAttack: signal(lineupPlayers, ["ATA", "PD", "PE"], ["impulsao", "forca", "nocao"]),
    buildUp: signal(lineupPlayers, ["GOL", "ZAG", "LD", "LE", "VOL"], ["passe", "nocao", "peBom"]),
    betweenLines: signal(lineupPlayers, ["ZAG", "VOL", "MC"], ["defesa", "nocao", "forca"]),
    defenderSpeed: signal(lineupPlayers, ["ZAG", "LD", "LE"], ["velocidade"]),
    attackerSpeed: signal(lineupPlayers, ["ATA", "PD", "PE"], ["velocidade", "drible"]),
  };
  const status = lineupPlayers.length === 0
    ? "unavailable"
    : lineupPlayers.length < 11 ? "partial" : "available";
  const sortedSectors = Object.values(sectors)
    .filter((sector) => Number.isFinite(sector.rating))
    .sort((left, right) => right.rating - left.rating || left.code.localeCompare(right.code));

  let weaknesses;
  let strengths;
  if (status === "unavailable") {
    weaknesses = [finding("DATA_INSUFFICIENT", "Dados insuficientes", "Não há atletas disponíveis para produzir uma leitura confiável.", 0, {})];
    strengths = [];
  } else {
    weaknesses = weaknessCandidates(signals, tacticPreview, formation.id).slice(0, config.findings);
    strengths = strengthCandidates(sectors, signals, tacticPreview).slice(0, config.findings);
    if (weaknesses.length === 0) {
      weaknesses = [finding("NO_CLEAR_WEAKNESS", "Sem fragilidade clara", "Os dados disponíveis não indicam uma fraqueza dominante.", 0, {})];
    }
  }
  const confidence = confidenceFor(
    normalizedDepth,
    lineupPlayers,
    formation.source,
    professionalConfidenceBonus,
    professionalSpeedMultiplier,
  );
  const recommendations = status === "unavailable"
    ? [{ code: "GATHER_MORE_DATA", label: "Ampliar observação", detail: "Obtenha dados do elenco antes de definir um plano específico.", basedOn: ["DATA_INSUFFICIENT"] }]
    : recommendationsFor(weaknesses, strengths, config.findings);

  return {
    version: 1,
    status,
    fixtureId: fixtureIdentifier(fixture),
    viewerClubId: identifier(viewerClubId) || null,
    opponent,
    confidence,
    probableFormation: {
      id: formation.id,
      source: formation.source,
      confidence: Math.max(10, Math.min(98, confidence.score + (formation.source === "public-preview" ? 2 : 0))),
    },
    style: buildStyle(tacticPreview, sectors),
    probableLineup,
    dangerousPlayers: dangerousPlayers(lineupPlayers),
    sectors,
    strongestSectors: sortedSectors.slice(0, Math.min(2, sortedSectors.length)),
    vulnerableSectors: sortedSectors
      .filter((sector) => sector.classification === "vulnerable")
      .sort((left, right) => left.rating - right.rating || left.code.localeCompare(right.code))
      .slice(0, 2),
    strengths,
    weaknesses,
    recommendations,
    evidence: {
      rosterPlayerCount: roster.length,
      availablePlayerCount: available.length,
      probableLineupCount: probableLineup.length,
      lineupSource: providedPlayers.length > 0 ? "provided-lineup" : "deterministic-selection",
      tacticSource: tacticPreview ? "public-preview" : "not-disclosed",
      scoutingSpeedMultiplier: confidence.scoutingSpeedMultiplier,
      estimatedStudyHours: confidence.estimatedStudyHours,
    },
  };
}
