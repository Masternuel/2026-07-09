function identifier(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function sideCoverage({ clubId, players, lineupIds }) {
  if (!Array.isArray(players) || players.length === 0) {
    return { valid: false, status: "missing" };
  }
  const playerIds = players.map((player) => identifier(player?.id));
  const normalizedPlayerIds = playerIds.map(key);
  if (playerIds.some((id) => !id)) return { valid: false, status: "partial" };
  if (new Set(normalizedPlayerIds).size !== normalizedPlayerIds.length) {
    return { valid: false, status: "duplicate" };
  }
  if (players.some((player) => (
    identifier(player?.clubId) && key(player.clubId) !== key(clubId)
  ))) {
    return { valid: false, status: "partial" };
  }

  const selectedIds = Array.isArray(lineupIds) ? lineupIds.map(identifier) : [];
  const normalizedSelectedIds = selectedIds.map(key);
  const knownIds = new Set(normalizedPlayerIds);
  if (
    selectedIds.length !== 11
    || selectedIds.some((id) => !id || !knownIds.has(key(id)))
    || new Set(normalizedSelectedIds).size !== selectedIds.length
  ) {
    return { valid: false, status: "partial" };
  }
  const playersById = new Map(players.map((player) => [key(player.id), player]));
  const positions = normalizedSelectedIds.map((id) => identifier(playersById.get(id)?.position).toUpperCase());
  const knownPositions = positions.filter(Boolean);
  if (
    knownPositions.length > 0
    && (knownPositions.length !== positions.length || knownPositions.filter((position) => position === "GOL").length !== 1)
  ) {
    return { valid: false, status: "partial" };
  }
  return { valid: true, status: "complete" };
}

export function validateSymmetricRosterCoverage(homeInput, awayInput) {
  const home = sideCoverage(homeInput);
  const away = sideCoverage(awayInput);
  if (home.valid && away.valid) {
    const homeIds = new Set(homeInput.players.map((player) => key(player.id)));
    const bothDemoFallback = Boolean(homeInput.demoFallback) && Boolean(awayInput.demoFallback);
    const duplicate = !bothDemoFallback
      && awayInput.players.some((player) => homeIds.has(key(player.id)));
    const incompatibleSources = Boolean(homeInput.demoFallback) !== Boolean(awayInput.demoFallback);
    if (duplicate || incompatibleSources) {
      const status = duplicate ? "duplicate" : "partial";
      return {
        valid: false,
        home: { valid: false, status },
        away: { valid: false, status },
      };
    }
  }
  return { valid: home.valid && away.valid, home, away };
}
