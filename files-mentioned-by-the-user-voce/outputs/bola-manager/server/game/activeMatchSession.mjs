import { randomUUID } from "node:crypto";

export const ACTIVE_MATCH_SNAPSHOT_VERSION = 1;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function activeMatchError(message) {
  const error = new Error(message);
  error.code = "ACTIVE_MATCH_CORRUPT";
  return error;
}

function persistenceSequence(value) {
  if (value == null) return 0;
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw activeMatchError("Sequencia da partida ativa e invalida");
  }
  return sequence;
}

function serializeRoster(roster) {
  return {
    clubId: roster?.clubId ?? null,
    source: roster?.source ?? "unavailable",
    players: clone(Array.isArray(roster?.players) ? roster.players : []),
    knownIds: [...(roster?.knownIds ?? [])].map(String),
    initialLineupIds: [...(roster?.initialLineupIds ?? [])].map(String),
    editable: Boolean(roster?.editable),
  };
}

function hydrateRoster(value) {
  const players = clone(Array.isArray(value?.players) ? value.players : []);
  const playersById = new Map(players.map((player) => [String(player.id), player]));
  const knownIds = Array.isArray(value?.knownIds)
    ? value.knownIds.map(String)
    : [...playersById.keys()];
  return {
    clubId: value?.clubId ?? null,
    source: value?.source ?? "unavailable",
    players,
    playersById,
    knownIds: new Set(knownIds),
    initialLineupIds: Array.isArray(value?.initialLineupIds)
      ? value.initialLineupIds.map(String)
      : [],
    editable: Boolean(value?.editable),
  };
}

function serializeAdjustedFixture(value) {
  const adjusted = clone(value ?? {});
  delete adjusted.homeRoster;
  delete adjusted.awayRoster;
  return adjusted;
}

function serializeHalftime(halftime) {
  return {
    reached: Boolean(halftime?.reached),
    status: halftime?.status === "resuming" ? "resuming" : "paused",
    requiredManagerIds: [...(halftime?.requiredManagerIds ?? [])].map(String),
    readyManagerIds: [...(halftime?.readyManagerIds ?? [])].map(String),
    plans: [...(halftime?.plans ?? new Map()).entries()].map(([managerId, plan]) => ({
      managerId: String(managerId),
      plan: clone(plan),
    })),
  };
}

export function serializeActiveMatchSession(session, now = () => new Date()) {
  if (!session?.match?.id || !session?.fixture?.fixtureId) {
    throw activeMatchError("Sessao ativa sem partida ou fixture");
  }
  const createdAt = session.persistedCreatedAt ?? now().toISOString();
  const generation = String(session.persistenceGeneration ?? "").trim() || randomUUID();
  session.persistedCreatedAt = createdAt;
  session.persistenceGeneration = generation;
  return {
    version: ACTIVE_MATCH_SNAPSHOT_VERSION,
    _matchSequence: persistenceSequence(session.persistenceSequence),
    _matchGeneration: generation,
    code: session.code,
    matchId: session.match.id,
    fixtureId: session.fixture.fixtureId,
    phase: session.phase === "halftime" ? "halftime" : "running",
    started: clone(session.started),
    match: clone(session.match),
    adjustedFixture: serializeAdjustedFixture(session.adjustedFixture),
    emittedEvents: clone(Array.isArray(session.events) ? session.events : []),
    nextEventIndex: Array.isArray(session.events) ? session.events.length : 0,
    speed: clone(session.speed),
    skipped: Boolean(session.playback?.skipped ?? session.skipped),
    homeManagerId: session.homeManagerId ?? null,
    awayManagerId: session.awayManagerId ?? null,
    homeRoster: serializeRoster(session.homeRoster),
    awayRoster: serializeRoster(session.awayRoster),
    halftime: serializeHalftime(session.halftime),
    createdAt,
    updatedAt: now().toISOString(),
  };
}

export function hydrateActiveMatchSession(snapshot, fixture, expectedCode = snapshot?.code) {
  if (!snapshot || snapshot.version !== ACTIVE_MATCH_SNAPSHOT_VERSION) {
    throw activeMatchError("Versao da partida ativa nao suportada");
  }
  if (!snapshot.match?.id || String(snapshot.match.id) !== String(snapshot.matchId)) {
    throw activeMatchError("Identificador da partida ativa e invalido");
  }
  const canonicalCode = String(expectedCode ?? "").trim().toUpperCase();
  if (!canonicalCode || String(snapshot.code ?? "").trim().toUpperCase() !== canonicalCode) {
    throw activeMatchError("Codigo da partida ativa nao corresponde ao documento");
  }
  if (!fixture?.fixtureId || String(fixture.fixtureId) !== String(snapshot.fixtureId)) {
    throw activeMatchError("Fixture persistida nao corresponde ao calendario atual");
  }
  if (!Array.isArray(snapshot.match.events)) {
    throw activeMatchError("Eventos da partida ativa sao invalidos");
  }
  if (!snapshot.started
    || String(snapshot.started.id) !== String(snapshot.matchId)
    || String(snapshot.started.fixtureId) !== String(snapshot.fixtureId)) {
    throw activeMatchError("Metadados iniciais da partida ativa sao invalidos");
  }
  const persistedRate = Number(snapshot.speed?.rate ?? 1);
  if (![0.5, 1, 2, 3].includes(persistedRate)) {
    throw activeMatchError("Velocidade da partida ativa e invalida");
  }
  const emittedEvents = clone(Array.isArray(snapshot.emittedEvents) ? snapshot.emittedEvents : []);
  const nextEventIndex = Number(snapshot.nextEventIndex);
  const plannedEvents = Array.isArray(snapshot.match.events) ? snapshot.match.events : [];
  if (!Number.isInteger(nextEventIndex)
    || nextEventIndex !== emittedEvents.length
    || nextEventIndex < 0
    || nextEventIndex > plannedEvents.length) {
    throw activeMatchError("Cursor da partida ativa e invalido");
  }

  const homeRoster = hydrateRoster(snapshot.homeRoster);
  const awayRoster = hydrateRoster(snapshot.awayRoster);
  const halftime = snapshot.halftime ?? {};
  const plans = new Map((Array.isArray(halftime.plans) ? halftime.plans : []).flatMap((entry) => (
    entry?.managerId ? [[String(entry.managerId), clone(entry.plan)]] : []
  )));
  const homeManagerId = snapshot.homeManagerId ?? null;
  const awayManagerId = snapshot.awayManagerId ?? null;
  const restoredPersistenceSequence = persistenceSequence(snapshot._matchSequence);
  return {
    code: canonicalCode,
    preparing: false,
    phase: snapshot.phase === "halftime" ? "halftime" : "running",
    started: {
      ...clone(snapshot.started),
      code: canonicalCode,
      id: snapshot.matchId,
      fixtureId: snapshot.fixtureId,
    },
    events: emittedEvents,
    result: null,
    playback: null,
    playbackStarted: false,
    persistChain: Promise.resolve(),
    persistenceSequence: restoredPersistenceSequence,
    persistenceGeneration: String(snapshot._matchGeneration ?? "").trim() || randomUUID(),
    persistedCreatedAt: snapshot.createdAt ?? snapshot.updatedAt ?? new Date().toISOString(),
    fixture,
    match: clone(snapshot.match),
    speed: clone(snapshot.speed),
    skipped: Boolean(snapshot.skipped),
    adjustedFixture: {
      ...clone(snapshot.adjustedFixture ?? {}),
      homeRoster: homeRoster.players,
      awayRoster: awayRoster.players,
    },
    homeManagerId,
    awayManagerId,
    homeRoster,
    awayRoster,
    rostersByManager: new Map([
      ...(homeManagerId ? [[homeManagerId, homeRoster]] : []),
      ...(awayManagerId ? [[awayManagerId, awayRoster]] : []),
    ]),
    halftime: {
      reached: Boolean(halftime.reached),
      status: halftime.status === "resuming" ? "resuming" : "paused",
      requiredManagerIds: Array.isArray(halftime.requiredManagerIds)
        ? halftime.requiredManagerIds.map(String)
        : [],
      readyManagerIds: new Set(Array.isArray(halftime.readyManagerIds)
        ? halftime.readyManagerIds.map(String)
        : []),
      plans,
      planUpdates: new Set(),
    },
    nextEventIndex,
    restored: true,
  };
}
