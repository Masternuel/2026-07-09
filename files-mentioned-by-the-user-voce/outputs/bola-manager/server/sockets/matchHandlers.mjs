import { resolveServerFixture } from "../game/fixtures.mjs";
import {
  hydrateActiveMatchSession,
  serializeActiveMatchSession,
} from "../game/activeMatchSession.mjs";
import {
  applyLineupAttributeProfiles,
  calculateLineupAttributeProfile,
} from "../game/lineupStrength.mjs";
import { MatchPlayback, simulateMatch } from "../game/matchSimulator.mjs";
import { applyClubCareerEffectsToFixture, careerDateFor } from "../game/clubCareerSystem.mjs";
import { applyFanAtmosphereToFixture } from "../game/coachJobSecurity.mjs";
import { applyPregameTacticsToFixture, createAiTacticPlan } from "../game/tactics.mjs";
import { calculateTeamCohesion } from "../game/teamCohesion.mjs";
import {
  applyStarImpactToFixture,
  calculateStarImpact,
  isPlayerAvailableForMatch,
  loadStarImpactsAtomically,
  sortPlayersForSelection,
} from "../game/starImpact.mjs";
import { mergePlayerStates } from "../game/playerProgression.mjs";
import { listRoomPlayers } from "../game/roomRoster.mjs";
import {
  matchControlSchema,
  matchHalftimePlanSchema,
  matchHalftimeReadySchema,
  matchReadySchema,
  matchSpeedSchema,
  matchStartSchema,
  parseOrThrow,
} from "../schemas.mjs";
import { emitRoomForViewers, roomForViewer } from "../services/roomVisibility.mjs";
import { catalogForOwner } from "../store/catalogScope.mjs";
import { channelForRoom, registerSafe, rememberMembership } from "./helpers.mjs";

const DEMO_PLAYER_IDS = Array.from(
  { length: 20 },
  (_, index) => `p${String(index + 1).padStart(2, "0")}`,
);
const DEMO_STAR_PLAYERS = Object.freeze({
  AUR: Object.freeze({
    p08: "Igor Sampaio",
    p10: "Felipe Rocha",
  }),
});

const MENTALITY_MODIFIERS = Object.freeze({
  cautious: -0.35,
  balanced: 0,
  positive: 0.35,
  attacking: 0.7,
});

const INSTRUCTION_MODIFIERS = Object.freeze({
  "keep-plan": 0,
  "exploit-right": 0.15,
  "keep-possession": 0.1,
  "high-line": 0.25,
  "slow-tempo": -0.1,
});

const DEFAULT_MATCH_LOCK_TTL_MS = 30_000;
const DEFAULT_MATCH_LOCK_WAIT_MS = 1_000;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function matchError(message, code, status = 409, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function assertRoomAvailable(code, deletingRooms, deletedRooms) {
  if (deletingRooms.has(code) || deletedRooms.has(code)) {
    throw matchError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
  }
}

function assertRoomOwner(room, managerId) {
  if (room.ownerId !== managerId) {
    throw matchError("Somente o criador da sala pode controlar a simulacao", "OWNER_REQUIRED", 403);
  }
}

function readinessFor(room, fixtureId) {
  const validManagerIds = new Set(room.managerIds);
  const readyIds = room.matchReadiness?.fixtureId === fixtureId
    ? room.matchReadiness.managerIds.filter((managerId) => validManagerIds.has(managerId))
    : [];
  return {
    readyIds,
    readyCount: readyIds.length,
    requiredCount: room.managerIds.length,
    allReady: room.managerIds.length > 0 && room.managerIds.every((managerId) => readyIds.includes(managerId)),
  };
}

function clubKey(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function lineupPlanForClub(room, managerId, clubId) {
  if (!managerId || !Array.isArray(room.lineups)) return undefined;
  const lineup = room.lineups.find((candidate) => (
    candidate.managerId === managerId && clubKey(candidate.clubId) === clubKey(clubId)
  ));
  if (!Array.isArray(lineup?.lineupIds) || lineup.lineupIds.length === 0) return undefined;
  return clone(lineup);
}

function managerForClub(room, fixtureManagerId, clubId) {
  if (fixtureManagerId) return fixtureManagerId;
  return room.managers.find((manager) => clubKey(manager.clubId) === clubKey(clubId))?.id;
}

function uniqueIds(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

async function loadRosterSnapshot(catalogStore, clubId, savedLineupIds, room) {
  const unavailable = {
    clubId,
    source: "unavailable",
    players: [],
    playersById: new Map(),
    knownIds: new Set(savedLineupIds ?? []),
    initialLineupIds: [...(savedLineupIds ?? [])],
    editable: false,
  };
  if (typeof catalogStore?.listPlayers !== "function") return unavailable;

  try {
    const result = await listRoomPlayers(catalogStore, room, clubId);
    if (result?.source === "brasfoot-not-loaded") return unavailable;
    const players = sortPlayersForSelection(mergePlayerStates(
      (Array.isArray(result?.players) ? result.players : []).filter((player) => player?.active !== false),
      room,
      clubId,
    ));
    const demoFallback = result?.source === "demo-fallback" && players.length === 0;
    const demoStars = DEMO_STAR_PLAYERS[clubKey(clubId)] ?? {};
    const virtualPlayers = demoFallback
      ? DEMO_PLAYER_IDS.map((id) => ({
        id,
        clubId,
        name: demoStars[id] ?? id,
        overall: 10,
        active: true,
        isStar: Object.hasOwn(demoStars, id),
      }))
      : players;
    const playersById = new Map(virtualPlayers.map((player) => [String(player.id), player]));
    const availablePlayers = virtualPlayers.filter(isPlayerAvailableForMatch);
    const requestedCount = Array.isArray(savedLineupIds) && savedLineupIds.length > 0
      ? Math.min(11, savedLineupIds.length)
      : Math.min(11, availablePlayers.length);
    const requestedIds = Array.isArray(savedLineupIds) ? savedLineupIds.map(String) : [];
    const availableById = new Map(availablePlayers.map((player) => [String(player.id), player]));
    const selectedIds = requestedIds.filter((playerId) => availableById.has(playerId));
    for (const player of availablePlayers) {
      if (selectedIds.length >= requestedCount || selectedIds.includes(String(player.id))) continue;
      selectedIds.push(String(player.id));
    }
    const initialLineupIds = selectedIds.slice(0, requestedCount);
    return {
      clubId,
      source: result?.source ?? "unknown",
      players: virtualPlayers,
      playersById,
      knownIds: new Set(playersById.keys()),
      initialLineupIds,
      editable: initialLineupIds.length > 0 && playersById.size > 0,
    };
  } catch {
    return unavailable;
  }
}

function publicHalftimeState(session) {
  const halftime = session.halftime;
  if (!halftime) return null;
  const requiredManagerIds = [...halftime.requiredManagerIds];
  const readyManagerIds = requiredManagerIds.filter((managerId) => halftime.readyManagerIds.has(managerId));
  return {
    code: session.code,
    matchId: session.match.id,
    fixtureId: session.fixture.fixtureId,
    status: halftime.status,
    requiredManagerIds,
    readyManagerIds,
    readyCount: readyManagerIds.length,
    requiredCount: requiredManagerIds.length,
    allReady: requiredManagerIds.length > 0
      && requiredManagerIds.every((managerId) => halftime.readyManagerIds.has(managerId)),
    // Planos ainda em preparacao sao privados; os demais managers recebem
    // somente a prontidao necessaria para coordenar o reinicio.
    plansSavedManagerIds: [],
    substitutionCounts: {},
  };
}

function halftimeStateForViewer(session, managerId) {
  const state = publicHalftimeState(session);
  if (!state) return null;
  const ownPlan = session.halftime.plans.get(managerId) ?? null;
  return {
    ...state,
    participant: session.halftime.requiredManagerIds.includes(managerId),
    ownPlan: clone(ownPlan),
    plansSavedManagerIds: ownPlan ? [managerId] : [],
    substitutionCounts: ownPlan ? { [managerId]: ownPlan.substitutionCount } : {},
  };
}

function requireHalftimeSession(session, matchId, managerId) {
  if (!session) throw matchError("Nao existe partida em andamento", "MATCH_NOT_FOUND", 404);
  if (session.preparing || !session.playback) {
    throw matchError("A partida ainda esta sendo preparada", "MATCH_PREPARING");
  }
  if (session.match?.id !== matchId) {
    throw matchError("Esta acao pertence a outra partida", "MATCH_ID_MISMATCH");
  }
  if (session.phase !== "halftime") {
    throw matchError("O intervalo nao esta ativo", "HALFTIME_NOT_ACTIVE");
  }
  if (session.halftime.status !== "paused") {
    throw matchError("O segundo tempo ja esta sendo preparado", "HALFTIME_RESUMING");
  }
  if (!session.halftime.requiredManagerIds.includes(managerId)) {
    throw matchError("Apenas managers desta partida podem alterar o intervalo", "HALFTIME_NOT_PARTICIPANT", 403);
  }
  return session;
}

function averageOverall(lineupIds, roster) {
  const values = lineupIds
    .map((playerId) => Number(roster.playersById.get(playerId)?.overall))
    .filter(Number.isFinite);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function lineupPlayers(plan, roster) {
  if (!roster?.playersById) return undefined;
  const lineupIds = plan?.lineupIds ?? roster.initialLineupIds;
  const players = lineupIds
    .map((playerId) => roster.playersById.get(playerId))
    .filter(Boolean);
  return players.length > 0 ? players : undefined;
}

function playerStateBaselines(...rosters) {
  return rosters.flatMap((roster) => (roster?.players ?? []).flatMap((player) => {
    const playerId = String(player?.id ?? "").trim();
    const clubId = String(player?.clubId ?? roster?.clubId ?? "").trim();
    if (!playerId || !clubId) return [];
    const numericCondition = Number(player?.condition);
    const condition = Number.isFinite(numericCondition) ? clamp(numericCondition, 0, 100) : 100;
    const injuryMatches = Math.max(0, Math.trunc(Number(player?.injuryMatches) || 0));
    const suspensionMatches = Math.max(0, Math.trunc(Number(player?.suspensionMatches) || 0));
    if (condition >= 100 && injuryMatches === 0 && suspensionMatches === 0) return [];
    return [{ playerId, clubId, condition, injuryMatches, suspensionMatches }];
  }));
}

function validateHalftimePlan(roster, lineupIds) {
  if (!roster?.editable) {
    throw matchError("Catalogo de jogadores indisponivel", "LINEUP_CATALOG_UNAVAILABLE", 503);
  }
  if (lineupIds.length !== roster.initialLineupIds.length) {
    throw matchError(
      "A escalacao do segundo tempo deve manter a quantidade de jogadores",
      "HALFTIME_LINEUP_SIZE_MISMATCH",
      409,
      { expected: roster.initialLineupIds.length, received: lineupIds.length },
    );
  }
  const unknownIds = lineupIds.filter((playerId) => !roster.knownIds.has(playerId));
  if (unknownIds.length > 0) {
    throw matchError(
      "A escalacao contem jogador que nao pertence ao clube",
      "LINEUP_PLAYER_NOT_IN_CLUB",
      409,
      { playerIds: unknownIds },
    );
  }
  const unavailableIds = lineupIds.filter(
    (playerId) => !isPlayerAvailableForMatch(roster.playersById.get(playerId)),
  );
  if (unavailableIds.length > 0) {
    throw matchError(
      "A escalacao contem jogador lesionado ou suspenso",
      "LINEUP_PLAYER_UNAVAILABLE",
      409,
      { playerIds: unavailableIds },
    );
  }
  const knownPositions = lineupIds
    .map((playerId) => String(roster.playersById.get(playerId)?.position ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (knownPositions.length > 0) {
    const goalkeeperCount = knownPositions.filter((position) => position === "GOL").length;
    const firstPosition = String(roster.playersById.get(lineupIds[0])?.position ?? "").trim().toUpperCase();
    if (goalkeeperCount !== 1 || firstPosition !== "GOL") {
      throw matchError(
        "O segundo tempo precisa de exatamente um goleiro na posicao GOL",
        "HALFTIME_GOALKEEPER_INVALID",
        409,
        { goalkeeperCount },
      );
    }
  }
  const initialIds = new Set(roster.initialLineupIds);
  const substitutionCount = lineupIds.filter((playerId) => !initialIds.has(playerId)).length;
  if (substitutionCount > 5) {
    throw matchError(
      "Sao permitidas no maximo cinco substituicoes no intervalo",
      "HALFTIME_TOO_MANY_SUBSTITUTIONS",
      409,
      { substitutionCount, maximum: 5 },
    );
  }
  return substitutionCount;
}

function planModifier(plan, roster, baseTactics) {
  if (!plan) return 0;
  const initialAverage = averageOverall(roster.initialLineupIds, roster);
  const nextAverage = averageOverall(plan.lineupIds, roster);
  const lineupModifier = initialAverage == null || nextAverage == null
    ? 0
    : clamp((nextAverage - initialAverage) / 10, -1, 1);
  const nextImpact = calculateStarImpact(roster.clubId, roster.players, { lineupIds: plan.lineupIds });
  const initialImpact = calculateStarImpact(roster.clubId, roster.players, {
    lineupIds: roster.initialLineupIds,
  });
  const initialStarBonus = Number(initialImpact.matchStrengthBonus) || 0;
  const starModifier = clamp(nextImpact.matchStrengthBonus - initialStarBonus, -1, 1);
  const baseMentality = MENTALITY_MODIFIERS[baseTactics?.mentality] ?? 0;
  const instruction = plan.tactics.instruction;
  const mentalityModifier = instruction === "keep-plan"
    ? 0
    : (MENTALITY_MODIFIERS[plan.tactics.mentality] ?? 0) - baseMentality;
  return clamp(
    mentalityModifier
      + (INSTRUCTION_MODIFIERS[instruction] ?? 0)
      + lineupModifier
      + starModifier,
    -3,
    3,
  );
}

function prepareSecondHalf(session) {
  const homePlan = session.homeManagerId
    ? session.halftime.plans.get(session.homeManagerId)
    : null;
  const awayPlan = session.awayManagerId
    ? session.halftime.plans.get(session.awayManagerId)
    : null;
  const homeTacticalModifier = planModifier(
    homePlan,
    session.homeRoster,
    session.adjustedFixture.homeTacticPlan,
  );
  const awayTacticalModifier = planModifier(
    awayPlan,
    session.awayRoster,
    session.adjustedFixture.awayTacticPlan,
  );
  const homePhysicalModifier = Number(session.adjustedFixture.homePhysicalSecondHalfModifier) || 0;
  const awayPhysicalModifier = Number(session.adjustedFixture.awayPhysicalSecondHalfModifier) || 0;
  const homeModifier = homeTacticalModifier + homePhysicalModifier;
  const awayModifier = awayTacticalModifier + awayPhysicalModifier;
  const updated = simulateMatch({
    ...session.adjustedFixture,
    homeSecondHalfModifier: homeTacticalModifier,
    awaySecondHalfModifier: awayTacticalModifier,
    homeSecondHalfPlayers: lineupPlayers(homePlan, session.homeRoster),
    awaySecondHalfPlayers: lineupPlayers(awayPlan, session.awayRoster),
  });
  const halftimeIndex = session.match.events.findIndex((event) => event.type === "halftime");
  const updatedHalftimeIndex = updated.events.findIndex((event) => event.type === "halftime");
  const initialFirstHalf = session.match.events.slice(0, halftimeIndex + 1);
  const updatedFirstHalf = updated.events.slice(0, updatedHalftimeIndex + 1);
  if (JSON.stringify(initialFirstHalf) !== JSON.stringify(updatedFirstHalf)) {
    throw matchError("Nao foi possivel preservar o primeiro tempo", "HALFTIME_SIMULATION_MISMATCH", 500);
  }

  // O iterador do MatchPlayback aponta para este mesmo array; mutar in-place faz
  // com que ele consuma a nova simulacao ao sair da trava do intervalo.
  session.match.events.splice(0, session.match.events.length, ...updated.events);
  session.match.score = updated.score;
  session.match.statistics = updated.statistics;
  session.match.playerStatistics = updated.playerStatistics;
  session.match.playerEffects = updated.playerEffects;
  session.match.simulationVersion = updated.simulationVersion;
  session.match.halftimeAdjustments = {
    homeModifier,
    awayModifier,
    homeTacticalModifier,
    awayTacticalModifier,
    homePhysicalModifier,
    awayPhysicalModifier,
    homeSubstitutionCount: homePlan?.substitutionCount ?? 0,
    awaySubstitutionCount: awayPlan?.substitutionCount ?? 0,
  };
}

export function registerMatchHandlers(io, socket, {
  store,
  matchSessions,
  matchRecoveryLocks,
  matchSessionStore,
  deletingRooms,
  deletedRooms,
  matchDelayMs,
  catalogStore,
  distributedLocks,
  matchLockTtlMs = DEFAULT_MATCH_LOCK_TTL_MS,
  matchLockWaitMs = DEFAULT_MATCH_LOCK_WAIT_MS,
  metrics,
  logger,
}) {
  const user = socket.data.user;
  const ownershipTtlMs = Math.max(3_000, Number(matchLockTtlMs) || DEFAULT_MATCH_LOCK_TTL_MS);
  const ownershipWaitMs = Math.max(0, Number(matchLockWaitMs) || DEFAULT_MATCH_LOCK_WAIT_MS);

  function ownershipError(cause) {
    return matchError(
      "Outra replica assumiu esta partida",
      "MATCH_OWNERSHIP_LOST",
      409,
      cause ? { cause: cause.code || cause.message } : undefined,
    );
  }

  function ownershipFor(session) {
    const ownership = session.ownership;
    return ownership ? {
      token: ownership.token ?? ownership.owner,
      fence: ownership.fence ?? ownership.fencingToken,
    } : undefined;
  }

  function assertSessionOwnership(session) {
    if (session.ownershipLost) throw ownershipError();
  }

  async function releaseOwnershipHandle(ownership) {
    if (!ownership?.release) return;
    await Promise.resolve(ownership.release()).catch(() => {});
  }

  async function releaseSessionOwnership(session) {
    if (!session?.ownership || session.ownershipReleased) return;
    session.ownershipReleased = true;
    clearInterval(session.ownershipHeartbeat);
    await releaseOwnershipHandle(session.ownership);
  }

  function loseSessionOwnership(session, cause) {
    if (!session || session.ownershipLost || session.ownershipReleased) return;
    session.ownershipLost = true;
    clearInterval(session.ownershipHeartbeat);
    session.playback?.cancel();
    if (matchSessions.get(session.code) === session) matchSessions.delete(session.code);
    io.to(channelForRoom(session.code)).emit("server:error", {
      event: "match:ownership",
      error: {
        code: "MATCH_OWNERSHIP_LOST",
        message: "Partida transferida para outra replica. Reconecte para continuar.",
        ...(cause ? { details: { cause: cause.code || cause.message } } : {}),
      },
    });
  }

  function monitorSessionOwnership(session, ownership) {
    if (!ownership) return;
    session.ownership = ownership;
    session.ownershipLost = false;
    session.ownershipReleased = false;
    let renewing = false;
    session.ownershipHeartbeat = setInterval(async () => {
      if (renewing || session.ownershipReleased || session.ownershipLost) return;
      renewing = true;
      try {
        const renewed = await ownership.renew();
        if (renewed === false) loseSessionOwnership(session);
      } catch (error) {
        loseSessionOwnership(session, error);
      } finally {
        renewing = false;
      }
    }, Math.max(1_000, Math.floor(ownershipTtlMs / 3)));
    session.ownershipHeartbeat.unref?.();
    if (ownership.lost && typeof ownership.lost.then === "function") {
      ownership.lost.then(
        (cause) => loseSessionOwnership(session, cause),
        (cause) => loseSessionOwnership(session, cause),
      );
    }
  }

  async function acquireMatchOwnership(code) {
    if (!distributedLocks) return null;
    let ownership;
    try {
      ownership = await distributedLocks.acquire(
        `match:${String(code).trim().toUpperCase()}`,
        {
          ttlMs: ownershipTtlMs,
          waitMs: ownershipWaitMs,
          waitTimeoutMs: ownershipWaitMs,
        },
      );
    } catch (error) {
      if (error?.code === "DISTRIBUTED_LOCK_TIMEOUT") {
        throw matchError("Ja existe uma partida em andamento nesta sala", "MATCH_IN_PROGRESS");
      }
      throw error;
    }
    if (!ownership) {
      throw matchError("Ja existe uma partida em andamento nesta sala", "MATCH_IN_PROGRESS");
    }
    return ownership;
  }

  function persistActiveSession(session) {
    const snapshot = serializeActiveMatchSession(session);
    const write = (session.persistChain ?? Promise.resolve())
      .then(() => {
        assertSessionOwnership(session);
        return matchSessionStore.save(snapshot, ownershipFor(session));
      });
    session.persistChain = write.catch(() => {});
    return write;
  }

  async function removePersistedSession(session) {
    await (session.persistChain ?? Promise.resolve());
    assertSessionOwnership(session);
    return matchSessionStore.remove(session.code, session.match.id, ownershipFor(session));
  }

  function buildPlayback(session) {
    const roomChannel = channelForRoom(session.code);
    const playback = new MatchPlayback(session.match, {
      delayMs: session.speed?.baseDelayMs ?? matchDelayMs,
      startIndex: session.nextEventIndex ?? session.events.length,
      initialRate: session.speed?.rate ?? 1,
      skipped: session.skipped,
      onEvent: async (matchEvent, playbackState) => {
        const enrichedEvent = {
          matchId: session.match.id,
          fixtureId: session.fixture.fixtureId,
          ...matchEvent,
          code: session.code,
          skipped: playbackState.skipped,
        };
        session.events.push(clone(enrichedEvent));
        session.nextEventIndex = session.events.length;
        session.skipped = playbackState.skipped;
        if (matchEvent.type === "halftime") {
          session.phase = "halftime";
          session.halftime.reached = true;
          session.halftime.status = "paused";
        }
        await persistActiveSession(session);
        io.to(roomChannel).emit("match:event", enrichedEvent);
      },
      onHalftime: async () => {
        io.to(roomChannel).emit("match:halftime", publicHalftimeState(session));

        // Fixtures normais possuem manager humano. O fallback impede que um
        // save legado sem participantes fique preso no intervalo.
        if (session.halftime.requiredManagerIds.length === 0) {
          session.halftime.status = "resuming";
          prepareSecondHalf(session);
          session.phase = "running";
          await persistActiveSession(session);
          io.to(roomChannel).emit("match:resumed", publicHalftimeState(session));
          playback.resume();
        }
      },
      onFinish: async (result) => {
        assertSessionOwnership(session);
        if (session.ownership && await session.ownership.renew() === false) {
          loseSessionOwnership(session);
          throw ownershipError();
        }
        session.phase = "finished";
        const completion = await store.completeMatch(session.code, session.fixture.fixtureId, {
          ...result,
          playerStateBaselines: playerStateBaselines(session.homeRoster, session.awayRoster),
        });
        const finishedResult = {
          ...result,
          playerEffects: clone(completion.summary.playerEffects ?? result.playerEffects ?? []),
          code: session.code,
          fixtureId: session.fixture.fixtureId,
          completedAt: completion.summary.completedAt,
          roomRevision: completion.room.revision,
          nextFixtureId: completion.room.currentFixtureId,
          seasonNumber: completion.summary.seasonNumber,
          seasonYear: completion.summary.seasonYear,
          nextSeasonNumber: completion.summary.nextSeasonNumber ?? null,
          nextSeasonYear: completion.summary.nextSeasonYear ?? null,
          roundSummary: clone(completion.summary.roundSummary ?? null),
        };
        session.result = clone(finishedResult);
        await removePersistedSession(session);
        await emitRoomForViewers(io, completion.room);
        io.to(roomChannel).emit("match:finished", finishedResult);
      },
    });
    session.playback = playback;
    return playback;
  }

  function runPlayback(session) {
    if (session.playbackStarted) return false;
    session.playbackStarted = true;
    metrics?.increment?.("jobs_started_total", 1, { job: "match_playback" });
    void session.playback.start()
      .then(() => metrics?.increment?.("jobs_completed_total", 1, { job: "match_playback" }))
      .catch((error) => {
        metrics?.increment?.("jobs_failed_total", 1, { job: "match_playback" });
        logger?.error?.("match.playback_failed", { code: session.code, error });
        io.to(channelForRoom(session.code)).emit("server:error", {
          event: "match:recovery",
          error: { code: error.code || "MATCH_PLAYBACK_ERROR", message: error.message },
        });
      })
      .finally(() => {
        if (matchSessions.get(session.code) === session) matchSessions.delete(session.code);
        void releaseSessionOwnership(session);
      });
    return true;
  }

  async function restorePersistedSession(room, code) {
    const live = matchSessions.get(code);
    if (live) return live;
    const existingLock = matchRecoveryLocks.get(code);
    if (existingLock) return existingLock;

    const recovery = (async () => {
      const ownership = await acquireMatchOwnership(code);
      let claimed = false;
      let recoveredSession;
      try {
        const snapshot = await matchSessionStore.get(code);
        if (!snapshot) return null;
        const completed = room.completedFixtureIds?.some(
          (fixtureId) => clubKey(fixtureId) === clubKey(snapshot.fixtureId),
        ) || String(room.lastCompletedMatch?.id ?? "") === String(snapshot.matchId ?? "");
        if (completed) {
          await matchSessionStore.remove(code, snapshot.matchId, ownershipFor({ ownership }));
          return null;
        }
        let fixture;
        try {
          fixture = resolveServerFixture(room, snapshot.fixtureId);
          recoveredSession = hydrateActiveMatchSession(snapshot, fixture, code);
        } catch (error) {
          // O proprio fixtureId pode ser a parte corrompida. Limpar a prontidao
          // da fixture atual garante que todos confirmem novamente.
          const resetRoom = await store.clearMatchReadiness(code);
          await matchSessionStore.remove(code, snapshot.matchId, ownershipFor({ ownership }));
          await emitRoomForViewers(io, resetRoom);
          throw matchError(
            "A partida salva estava inconsistente e foi descartada. Confirme a prontidao novamente.",
            "ACTIVE_MATCH_RECOVERY_FAILED",
            409,
            { cause: error.code || "ACTIVE_MATCH_CORRUPT" },
          );
        }
        const raced = matchSessions.get(code);
        if (raced) return raced;
        monitorSessionOwnership(recoveredSession, ownership);
        buildPlayback(recoveredSession);
        if (recoveredSession.phase === "halftime" && recoveredSession.halftime.requiredManagerIds.length === 0) {
          recoveredSession.halftime.status = "resuming";
          prepareSecondHalf(recoveredSession);
          recoveredSession.phase = "running";
        }
        // Publica o novo fence antes de permitir qualquer playback local.
        await persistActiveSession(recoveredSession);
        matchSessions.set(code, recoveredSession);
        claimed = true;
        return recoveredSession;
      } finally {
        if (!claimed && recoveredSession) await releaseSessionOwnership(recoveredSession);
        else if (!claimed) await releaseOwnershipHandle(ownership);
      }
    })().finally(() => matchRecoveryLocks.delete(code));
    matchRecoveryLocks.set(code, recovery);
    return recovery;
  }

  async function startMatchSession(room, code, requestedFixtureId) {
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    if (room.status !== "active") {
      throw matchError("Inicie a temporada antes da partida", "ROOM_NOT_ACTIVE");
    }
    if (matchSessions.has(code)) {
      throw matchError("Ja existe uma partida em andamento nesta sala", "MATCH_IN_PROGRESS");
    }

    const fixture = resolveServerFixture(room, requestedFixtureId);
    const readiness = readinessFor(room, fixture.fixtureId);
    if (!readiness.allReady) {
      throw matchError("Todos os managers precisam confirmar que estao prontos", "MATCH_MANAGERS_NOT_READY");
    }

    const ownership = await acquireMatchOwnership(code);
    if (matchSessions.has(code)) {
      await releaseOwnershipHandle(ownership);
      throw matchError("Ja existe uma partida em andamento nesta sala", "MATCH_IN_PROGRESS");
    }

    const session = {
      code,
      preparing: true,
      phase: "running",
      started: null,
      events: [],
      result: null,
      playback: null,
      playbackStarted: false,
      persistChain: Promise.resolve(),
      nextEventIndex: 0,
      skipped: false,
      fixture,
    };
    monitorSessionOwnership(session, ownership);
    matchSessions.set(code, session);

    try {
      const homeManagerId = managerForClub(room, fixture.homeManagerId, fixture.homeClubId);
      const awayManagerId = managerForClub(room, fixture.awayManagerId, fixture.awayClubId);
      const homeLineup = lineupPlanForClub(room, homeManagerId, fixture.homeClubId);
      const awayLineup = lineupPlanForClub(room, awayManagerId, fixture.awayClubId);
      const homeLineupIds = homeLineup?.lineupIds;
      const awayLineupIds = awayLineup?.lineupIds;
      const roomCatalog = await catalogForOwner(
        catalogStore,
        room.catalogOwnerId || room.ownerId,
      );
      const [catalogImpacts, homeRoster, awayRoster] = await Promise.all([
        loadStarImpactsAtomically(roomCatalog, fixture.homeClubId, fixture.awayClubId, {
          homeLineupIds,
          awayLineupIds,
        }),
        loadRosterSnapshot(roomCatalog, fixture.homeClubId, homeLineupIds, room),
        loadRosterSnapshot(roomCatalog, fixture.awayClubId, awayLineupIds, room),
      ]);
      const impacts = {
        home: homeRoster.source === "unavailable" ? catalogImpacts.home : {
          ...calculateStarImpact(fixture.homeClubId, homeRoster.players, {
            lineupIds: homeRoster.initialLineupIds,
          }),
          status: "available",
        },
        away: awayRoster.source === "unavailable" ? catalogImpacts.away : {
          ...calculateStarImpact(fixture.awayClubId, awayRoster.players, {
            lineupIds: awayRoster.initialLineupIds,
          }),
          status: "available",
        },
      };
      const matchLineup = (lineup, roster, clubId) => {
        const tactics = lineup?.tactics ?? createAiTacticPlan(roster.players, roster.initialLineupIds);
        const cohesion = lineup?.cohesion ?? calculateTeamCohesion({
          lineupIds: roster.initialLineupIds,
          tactics,
          players: roster.players,
          reason: "save",
        });
        return {
          ...(lineup ?? {}),
          clubId,
          lineupIds: [...roster.initialLineupIds],
          tactics,
          cohesion,
        };
      };
      const effectiveHomeLineup = matchLineup(homeLineup, homeRoster, fixture.homeClubId);
      const effectiveAwayLineup = matchLineup(awayLineup, awayRoster, fixture.awayClubId);
      assertRoomAvailable(code, deletingRooms, deletedRooms);
      if (matchSessions.get(code) !== session) {
        throw matchError("Inicio da partida foi cancelado", "MATCH_START_CANCELLED");
      }
      const attributeProfiles = {
        home: calculateLineupAttributeProfile(homeRoster.players, {
          lineupIds: homeRoster.initialLineupIds,
        }),
        away: calculateLineupAttributeProfile(awayRoster.players, {
          lineupIds: awayRoster.initialLineupIds,
        }),
      };
      const adjustedFixture = {
        ...applyFanAtmosphereToFixture(
          room,
          applyClubCareerEffectsToFixture(
            room,
            applyPregameTacticsToFixture(
              applyLineupAttributeProfiles(
                applyStarImpactToFixture(fixture, impacts.home, impacts.away),
                attributeProfiles.home,
                attributeProfiles.away,
              ),
              effectiveHomeLineup,
              effectiveAwayLineup,
              homeRoster,
              awayRoster,
            ),
            careerDateFor(room),
          ),
        ),
        simulationVersion: 2,
        roomCode: code,
        fixtureId: fixture.fixtureId,
        seasonNumber: room.currentSeason,
        homePlayers: lineupPlayers(null, homeRoster),
        awayPlayers: lineupPlayers(null, awayRoster),
        homeRoster: homeRoster.players,
        awayRoster: awayRoster.players,
        homeTacticPlan: structuredClone(effectiveHomeLineup.tactics),
        awayTacticPlan: structuredClone(effectiveAwayLineup.tactics),
      };
      const match = {
        ...simulateMatch(adjustedFixture),
        fixtureId: fixture.fixtureId,
        seasonNumber: room.currentSeason,
        seasonYear: room.seasonYear,
        starImpact: adjustedFixture.starImpact,
        strengthProfile: adjustedFixture.strengthProfile,
        lineupAttributeProfile: adjustedFixture.lineupAttributeProfile,
        tacticalMatchup: adjustedFixture.tacticalMatchup,
        clubCareerEffects: adjustedFixture.clubCareerEffects,
        homeFormation: effectiveHomeLineup.tactics.formationId,
        awayFormation: effectiveAwayLineup.tactics.formationId,
      };
      const speed = {
        code,
        matchId: match.id,
        rate: 1,
        baseDelayMs: matchDelayMs,
        effectiveDelayMs: matchDelayMs,
        changedBy: null,
        changedAt: null,
      };
      const requiredManagerIds = uniqueIds(fixture.managerIds);
      const roomChannel = channelForRoom(code);
      const started = {
        code,
        id: match.id,
        fixtureId: fixture.fixtureId,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        eventCount: match.events.length,
        delayMs: matchDelayMs,
        seasonNumber: room.currentSeason,
        seasonYear: room.seasonYear,
        starImpact: match.starImpact,
        strengthProfile: match.strengthProfile,
        lineupAttributeProfile: match.lineupAttributeProfile,
        tacticalMatchup: match.tacticalMatchup,
        clubCareerEffects: match.clubCareerEffects,
        homeFormation: match.homeFormation,
        awayFormation: match.awayFormation,
        speed: clone(speed),
      };
      Object.assign(session, {
        started,
        preparing: false,
        match,
        speed,
        adjustedFixture,
        impacts,
        attributeProfiles,
        homeManagerId,
        awayManagerId,
        homeRoster,
        awayRoster,
        rostersByManager: new Map([
          ...(homeManagerId ? [[homeManagerId, homeRoster]] : []),
          ...(awayManagerId ? [[awayManagerId, awayRoster]] : []),
        ]),
        halftime: {
          reached: false,
          status: "paused",
          requiredManagerIds,
          readyManagerIds: new Set(),
          plans: new Map(),
          planUpdates: new Set(),
        },
      });

      buildPlayback(session);
      await persistActiveSession(session);

      return {
        matchId: match.id,
        starImpact: match.starImpact,
        strengthProfile: match.strengthProfile,
        lineupAttributeProfile: match.lineupAttributeProfile,
        tacticalMatchup: match.tacticalMatchup,
        afterAcknowledgement: () => {
          io.to(roomChannel).emit("match:started", started);
          runPlayback(session);
        },
      };
    } catch (error) {
      if (matchSessions.get(code) === session) matchSessions.delete(code);
      if (session.match?.id) {
        await matchSessionStore.remove(code, session.match.id, ownershipFor(session)).catch(() => {});
      }
      await releaseSessionOwnership(session);
      throw error;
    }
  }

  registerSafe(socket, "match:ready", async (payload) => {
    const data = parseOrThrow(matchReadySchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const currentRoom = await store.requireMembership(data.code, user.uid);
    if (await restorePersistedSession(currentRoom, data.code)) {
      throw matchError("A partida desta rodada ja esta em andamento", "MATCH_IN_PROGRESS");
    }
    const room = await store.setMatchReady(data.code, user.uid, data.ready, data.fixtureId);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const fixtureId = room.currentFixtureId;
    const readiness = readinessFor(room, fixtureId);
    await emitRoomForViewers(io, room);

    if (!data.ready || !readiness.allReady) {
      return { room: roomForViewer(room, user.uid), started: false, ...readiness };
    }
    const start = await startMatchSession(room, data.code, fixtureId);
    return { room: roomForViewer(room, user.uid), started: true, ...readiness, ...start };
  });

  registerSafe(socket, "match:start", async (payload) => {
    const data = parseOrThrow(matchStartSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const prepared = await store.prepareMatch(data.code, user.uid, data.fixtureId);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    rememberMembership(socket, data.code);
    if (prepared.migrated) await emitRoomForViewers(io, prepared.room);
    if (await restorePersistedSession(prepared.room, data.code)) {
      throw matchError("A partida desta rodada ja esta em andamento", "MATCH_IN_PROGRESS");
    }
    return startMatchSession(prepared.room, data.code, prepared.fixtureId);
  });

  registerSafe(socket, "match:skip", async (payload) => {
    const data = parseOrThrow(matchControlSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const room = await store.requireMembership(data.code, user.uid);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    assertRoomOwner(room, user.uid);
    const session = matchSessions.get(data.code) ?? await restorePersistedSession(room, data.code);
    if (!session) throw matchError("Nao existe partida em andamento", "MATCH_NOT_FOUND", 404);
    if (!session.playback) throw matchError("A partida ainda esta sendo preparada", "MATCH_PREPARING");
    if (session.phase === "finished" || session.result) {
      throw matchError("A partida ja terminou", "MATCH_FINISHED");
    }
    if (session.phase === "halftime") {
      throw matchError("Aguarde todos os managers ficarem prontos", "HALFTIME_ACTIVE");
    }
    const skipped = session.playback.skip();
    if (!skipped) {
      throw matchError("A partida ja esta em avancar resultado", "MATCH_ALREADY_SKIPPED");
    }
    session.skipped = true;
    await persistActiveSession(session);
    return {
      skipped,
      afterAcknowledgement: () => {
        io.to(channelForRoom(data.code)).emit("match:skipped", { code: data.code });
        if (session.phase === "running") runPlayback(session);
      },
    };
  });

  registerSafe(socket, "match:speed", async (payload) => {
    const data = parseOrThrow(matchSpeedSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const room = await store.requireMembership(data.code, user.uid);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    assertRoomOwner(room, user.uid);
    const session = matchSessions.get(data.code) ?? await restorePersistedSession(room, data.code);
    if (!session) {
      if (room.lastCompletedMatch?.id === data.matchId) {
        throw matchError("A partida ja terminou", "MATCH_FINISHED");
      }
      throw matchError("Nao existe partida em andamento", "MATCH_NOT_FOUND", 404);
    }
    if (session.preparing || !session.playback) {
      throw matchError("A partida ainda esta sendo preparada", "MATCH_PREPARING");
    }
    if (session.match?.id !== data.matchId) {
      throw matchError("Esta acao pertence a outra partida", "MATCH_ID_MISMATCH");
    }
    if (session.phase === "finished" || session.result) {
      throw matchError("A partida ja terminou", "MATCH_FINISHED");
    }
    if (session.playback.skipped) {
      throw matchError("A partida ja esta em avancar resultado", "MATCH_ALREADY_SKIPPED");
    }

    const changed = session.playback.setSpeed(data.speed);
    if (!changed) {
      return {
        changed: false,
        speed: clone(session.speed),
        ...(!session.playbackStarted && session.phase === "running"
          ? { afterAcknowledgement: () => runPlayback(session) }
          : {}),
      };
    }

    const speed = {
      code: data.code,
      matchId: session.match.id,
      rate: session.playback.rate,
      baseDelayMs: session.playback.baseDelayMs,
      effectiveDelayMs: session.playback.effectiveDelayMs,
      changedBy: user.uid,
      changedAt: new Date().toISOString(),
    };
    session.speed = speed;
    session.started.speed = clone(speed);
    await persistActiveSession(session);
    return {
      changed: true,
      speed: clone(speed),
      afterAcknowledgement: () => {
        if (matchSessions.get(data.code) !== session) return;
        io.to(channelForRoom(data.code)).emit("match:speed-changed", clone(speed));
        if (session.phase === "running") runPlayback(session);
      },
    };
  });

  registerSafe(socket, "match:halftime-plan", async (payload) => {
    const data = parseOrThrow(matchHalftimePlanSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const room = await store.requireMembership(data.code, user.uid);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const session = requireHalftimeSession(
      matchSessions.get(data.code) ?? await restorePersistedSession(room, data.code),
      data.matchId,
      user.uid,
    );
    const halftime = session.halftime;
    const roster = session.rostersByManager.get(user.uid);

    // Abrir/editar o plano desfaz a confirmacao para impedir que o ultimo ready
    // libere o jogo enquanto a validacao assincrona ainda estiver em curso.
    halftime.readyManagerIds.delete(user.uid);
    halftime.planUpdates.add(user.uid);
    await persistActiveSession(session);
    io.to(channelForRoom(data.code)).emit("match:halftime", publicHalftimeState(session));
    try {
      const substitutionCount = validateHalftimePlan(roster, data.lineupIds);
      if (session.phase !== "halftime" || halftime.status !== "paused") {
        throw matchError("O segundo tempo ja esta sendo preparado", "HALFTIME_RESUMING");
      }
      halftime.plans.set(user.uid, {
        lineupIds: [...data.lineupIds],
        tactics: { ...data.tactics },
        substitutionCount,
        savedAt: new Date().toISOString(),
      });
    } finally {
      halftime.planUpdates.delete(user.uid);
    }
    await persistActiveSession(session);
    io.to(channelForRoom(data.code)).emit("match:halftime", publicHalftimeState(session));
    return { halftime: halftimeStateForViewer(session, user.uid) };
  });

  registerSafe(socket, "match:halftime-ready", async (payload) => {
    const data = parseOrThrow(matchHalftimeReadySchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const room = await store.requireMembership(data.code, user.uid);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const session = requireHalftimeSession(
      matchSessions.get(data.code) ?? await restorePersistedSession(room, data.code),
      data.matchId,
      user.uid,
    );
    const halftime = session.halftime;
    if (data.ready && halftime.planUpdates.has(user.uid)) {
      throw matchError("Aguarde o plano tatico ser salvo", "HALFTIME_PLAN_UPDATING");
    }
    if (data.ready) halftime.readyManagerIds.add(user.uid);
    else halftime.readyManagerIds.delete(user.uid);

    const allReady = halftime.requiredManagerIds.length > 0
      && halftime.requiredManagerIds.every((managerId) => halftime.readyManagerIds.has(managerId));
    let resumed = false;
    if (allReady) {
      halftime.status = "resuming";
      try {
        prepareSecondHalf(session);
        session.phase = "running";
        resumed = true;
      } catch (error) {
        halftime.status = "paused";
        throw error;
      }
    }
    try {
      await persistActiveSession(session);
    } catch (error) {
      if (resumed) {
        session.phase = "halftime";
        halftime.status = "paused";
      }
      throw error;
    }
    io.to(channelForRoom(data.code)).emit("match:halftime", publicHalftimeState(session));

    return {
      halftime: halftimeStateForViewer(session, user.uid),
      resumed,
      afterAcknowledgement: resumed
        ? () => {
          if (matchSessions.get(data.code) !== session || session.phase !== "running") return;
          io.to(channelForRoom(data.code)).emit("match:resumed", publicHalftimeState(session));
          if (session.playbackStarted ? !session.playback.resume() : !runPlayback(session)) {
            socket.emit("server:error", {
              event: "match:halftime-ready",
              error: { code: "HALFTIME_RESUME_FAILED", message: "Nao foi possivel iniciar o segundo tempo" },
            });
          }
        }
        : undefined,
    };
  });

  registerSafe(socket, "match:sync", async (payload) => {
    const data = parseOrThrow(matchControlSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const room = await store.requireMembership(data.code, user.uid);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    rememberMembership(socket, data.code);
    const session = matchSessions.get(data.code) ?? await restorePersistedSession(room, data.code);
    if (session) {
      return {
        source: "live",
        phase: session.phase ?? "running",
        started: clone(session.started),
        events: clone(session.events),
        result: clone(session.result),
        halftime: session.halftime?.reached ? halftimeStateForViewer(session, user.uid) : null,
        speed: clone(session.speed ?? null),
        ...(!session.playbackStarted && session.phase === "running"
          ? { afterAcknowledgement: () => runPlayback(session) }
          : {}),
      };
    }
    if (room.lastCompletedMatch) {
      const persistedEvents = (Array.isArray(room.lastCompletedMatch.events)
        ? room.lastCompletedMatch.events
        : []).map((event) => ({
        ...event,
        code: room.code,
        matchId: room.lastCompletedMatch.id,
        fixtureId: room.lastCompletedMatch.fixtureId,
        skipped: Boolean(room.lastCompletedMatch.skipped),
      }));
      return {
        source: "persisted",
        phase: "finished",
        started: null,
        events: clone(persistedEvents),
        result: clone(room.lastCompletedMatch),
        lastCompletedRound: clone(room.lastCompletedRound ?? room.lastCompletedMatch.roundSummary ?? null),
        halftime: null,
        speed: null,
      };
    }
    return {
      source: "idle",
      phase: "idle",
      started: null,
      events: [],
      result: null,
      halftime: null,
      speed: null,
    };
  });
}
