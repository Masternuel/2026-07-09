import { sortPlayersForSelection } from "./starImpact.mjs";

function identifier(value) {
  return String(value ?? "").trim();
}

function identifierKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function registrationsFor(room) {
  const registrations = room?.marketState?.registrations;
  if (Array.isArray(registrations)) return registrations;
  if (registrations && typeof registrations === "object") return Object.values(registrations);
  return [];
}

function registrationPlayerId(value) {
  return identifier(value?.playerId ?? value?.playerSnapshot?.id);
}

function registrationMap(room) {
  const registrations = new Map();
  for (const candidate of registrationsFor(room)) {
    const playerId = registrationPlayerId(candidate);
    if (!playerId) continue;
    registrations.set(identifierKey(playerId), candidate);
  }
  return registrations;
}

function collectionValues(value, idField) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([key, candidate]) => (
    candidate && typeof candidate === "object"
      ? { ...candidate, [idField]: identifier(candidate[idField]) || key }
      : null
  )).filter(Boolean);
}

function careerPlayersFor(room) {
  return collectionValues(room?.careerState?.players ?? room?.careerState?.roster, "id");
}

function careerPlayerMap(room) {
  const players = new Map();
  for (const player of careerPlayersFor(room)) {
    const playerId = identifier(player?.id);
    if (!playerId) continue;
    players.set(identifierKey(playerId), player);
  }
  return players;
}

function careerTrainingMap(room) {
  const plans = new Map();
  for (const plan of collectionValues(room?.careerState?.trainingPlans, "playerId")) {
    const playerId = identifier(plan?.playerId);
    if (!playerId) continue;
    plans.set(identifierKey(playerId), plan);
  }
  return plans;
}

function careerSeason(room) {
  const value = Number(room?.careerState?.currentSeason ?? room?.currentSeason);
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : null;
}

function contractStatus(player) {
  return identifier(player?.contract?.status).toLocaleLowerCase("pt-BR");
}

function careerPlayerIsAvailable(player, room) {
  if (!player || player.active === false || player.retired === true || player.careerStage === "retired") {
    return false;
  }
  const status = contractStatus(player);
  if (["expired", "free_agent", "retired", "released"].includes(status)) return false;
  const season = careerSeason(room);
  const endSeason = Number(player?.contract?.endSeason);
  if (season && Number.isFinite(endSeason) && endSeason < season) return false;
  return true;
}

function careerClubId(player) {
  const status = contractStatus(player);
  if (["expired", "free_agent", "retired", "released"].includes(status)) return null;
  return identifier(player?.contract?.clubId) || identifier(player?.clubId) || null;
}

function principalContractClubId(registration, effectiveClubId) {
  const loan = registration?.loan && typeof registration.loan === "object"
    ? registration.loan
    : null;
  if (loan) {
    return identifier(registration?.permanentClubId)
      || identifier(loan.lenderClubId)
      || identifier(registration?.originalClubId)
      || identifier(effectiveClubId)
      || null;
  }
  return identifier(registration?.permanentClubId)
    || identifier(registration?.currentClubId)
    || identifier(effectiveClubId)
    || null;
}

function mergeCareerPlayer(basePlayer, careerPlayer, effectiveClubId, contractClubId, trainingPlan) {
  const base = basePlayer && typeof basePlayer === "object" ? basePlayer : {};
  const career = careerPlayer && typeof careerPlayer === "object" ? careerPlayer : {};
  const attributes = (base.attributes && typeof base.attributes === "object")
    || (career.attributes && typeof career.attributes === "object")
    ? { ...(base.attributes ?? {}), ...(career.attributes ?? {}) }
    : career.attributes ?? base.attributes;
  const contract = (base.contract && typeof base.contract === "object")
    || (career.contract && typeof career.contract === "object")
    ? { ...(base.contract ?? {}), ...(career.contract ?? {}) }
    : career.contract ?? base.contract;
  if (contract && !["expired", "free_agent", "retired", "released"].includes(contractStatus({ contract }))) {
    contract.clubId = contractClubId;
  }
  const training = trainingPlan
    ? { ...(career.training ?? base.training ?? {}), ...trainingPlan }
    : career.training ?? base.training;
  return {
    ...base,
    ...career,
    id: identifier(career.id) || identifier(base.id),
    clubId: effectiveClubId,
    ...(attributes ? { attributes } : {}),
    ...(contract ? { contract } : {}),
    ...(training ? { training } : {}),
  };
}

export function careerPlayerFor(room, playerId) {
  return careerPlayerMap(room).get(identifierKey(playerId)) ?? null;
}

export function registrationForPlayer(room, playerId) {
  return registrationMap(room).get(identifierKey(playerId)) ?? null;
}

export function currentPlayerClubId(room, playerId, fallbackClubId = null) {
  const registration = registrationForPlayer(room, playerId);
  const careerPlayer = careerPlayerFor(room, playerId);
  return identifier(registration?.currentClubId)
    || careerClubId(careerPlayer)
    || identifier(fallbackClubId)
    || null;
}

async function incomingPlayer(catalogStore, registration, playerId) {
  const snapshot = registration?.playerSnapshot;
  if (snapshot && typeof snapshot === "object") return structuredClone(snapshot);
  if (typeof catalogStore?.get !== "function") return null;
  try {
    return await catalogStore.get("players", playerId);
  } catch {
    return null;
  }
}

/**
 * Apply save-scoped registrations without mutating the creator's catalog.
 * Returned shape matches CatalogStore.listPlayers().
 */
export async function listRoomPlayers(catalogStore, room, clubId) {
  if (typeof catalogStore?.listPlayers !== "function") {
    throw new TypeError("Catalogo de jogadores indisponivel");
  }

  const roster = await catalogStore.listPlayers(clubId);
  const basePlayers = Array.isArray(roster?.players) ? roster.players : [];
  const targetClubKey = identifierKey(clubId);
  const registrations = registrationMap(room);
  const careerPlayers = careerPlayerMap(room);
  const trainingPlans = careerTrainingMap(room);
  if (registrations.size === 0 && careerPlayers.size === 0) return roster;

  const playersById = new Map();
  for (const player of basePlayers) {
    const playerId = identifier(player?.id);
    if (!playerId) continue;
    const playerKey = identifierKey(playerId);
    const registration = registrations.get(playerKey);
    const careerPlayer = careerPlayers.get(playerKey);
    if (careerPlayer && !careerPlayerIsAvailable(careerPlayer, room)) continue;
    const currentClubId = identifier(registration?.currentClubId)
      || careerClubId(careerPlayer)
      || identifier(player?.clubId)
      || identifier(clubId);
    if (identifierKey(currentClubId) !== targetClubKey) continue;
    playersById.set(playerKey, mergeCareerPlayer(
      player,
      careerPlayer,
      identifier(clubId),
      principalContractClubId(registration, clubId),
      trainingPlans.get(playerKey),
    ));
  }

  for (const registration of registrations.values()) {
    const playerId = registrationPlayerId(registration);
    if (!playerId || identifierKey(registration?.currentClubId) !== targetClubKey) continue;
    const playerKey = identifierKey(playerId);
    if (playersById.has(playerKey)) continue;
    const player = await incomingPlayer(catalogStore, registration, playerId);
    if (!player || player.active === false) continue;
    const careerPlayer = careerPlayers.get(playerKey);
    if (careerPlayer && !careerPlayerIsAvailable(careerPlayer, room)) continue;
    playersById.set(playerKey, mergeCareerPlayer(
      { ...player, id: identifier(player.id) || playerId },
      careerPlayer,
      identifier(clubId),
      principalContractClubId(registration, clubId),
      trainingPlans.get(playerKey),
    ));
  }

  // Generated academy players and career-scoped club moves do not exist in the
  // immutable Editor catalog. Add them directly from this save's career state.
  for (const [playerKey, careerPlayer] of careerPlayers) {
    if (playersById.has(playerKey) || !careerPlayerIsAvailable(careerPlayer, room)) continue;
    const registration = registrations.get(playerKey);
    const currentClubId = identifier(registration?.currentClubId) || careerClubId(careerPlayer);
    if (identifierKey(currentClubId) !== targetClubKey) continue;
    playersById.set(playerKey, mergeCareerPlayer(
      registration?.playerSnapshot,
      careerPlayer,
      identifier(clubId),
      principalContractClubId(registration, clubId),
      trainingPlans.get(playerKey),
    ));
  }

  const players = sortPlayersForSelection([...playersById.values()]);
  return { ...roster, players, count: players.length };
}
