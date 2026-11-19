// Each speed-up of the career match pipeline keeps the exact results of the code it replaced.
// The fast path runs on the real objects; the reference runs on deep copies (no reused or
// cached objects) or through the slow path that is kept for this comparison.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CAREER_EVENT_TYPES,
  appendCareerEvent,
  ensureClubCareerState,
  setCareerNewsReadState,
} from "../domain/careerEvents.mjs";
import { staffStateView } from "../game/clubCareerSystem.mjs";
import { synchronizeCoachCareerHistory } from "../game/coachCareerHistory.mjs";
import { createCompetitionState, recordCompetitionResult } from "../game/competitionEngine.mjs";
import { leagueLegs } from "../game/fixtures.mjs";
import { buildCompletedLeagueStates } from "../game/leagueSeasonTransition.mjs";
import { applyMatchPlayerProgression, mergePlayerStates, normalizePlayerState } from "../game/playerProgression.mjs";
import { ensureStaffState } from "../game/staffEngine.mjs";
import { advanceMarketLoans, createOffer, registrationForPlayer } from "../game/market.mjs";
import { ensureClubFacilities, facilityEffectsForClub, facilityForClub, recordMatchdayEconomy } from "../game/clubFacilities.mjs";
import { clubCareerPerformanceEffects, ensureClubCareerSystems } from "../game/clubCareerSystem.mjs";
import { flushMatchHistory } from "../store/matchHistory.mjs";
import { addCompactHashIndexValues, compactHash, compactHashIndexContains, normalizeCompactHashIndex } from "../domain/compactHashIndex.mjs";
import { createHash } from "node:crypto";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

const json = (value) => JSON.stringify(value);

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function testLeague(id, level, size) {
  return {
    id, name: `Liga ${id}`, country: "Brasil", level, division: `Serie ${level}`, legs: "double",
    clubs: Array.from({ length: size }, (_, index) => ({
      id: `${id}-C${index + 1}`, name: `Clube ${id} ${index + 1}`, code: `${id}${index + 1}`,
      reputation: 8 + index, leagueId: id, stadiumCapacity: 20_000 + index * 1_000,
    })),
  };
}

function rosterCatalog(leagues) {
  const positions = ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA", "GOL", "ZAG", "MC", "ATA"];
  return {
    async listCompetitionCatalog() { return structuredClone(leagues); },
    async listPlayers(clubId) {
      const players = positions.map((position, index) => ({
        id: `${clubId}-P${index + 1}`, clubId, name: `${clubId} Jogador ${index + 1}`, position,
        overall: 8 + (index % 7), age: 20 + index, condition: 100, active: true, marketValue: 1_000_000,
      }));
      return { players, count: players.length, source: "match-speed-test" };
    },
  };
}

let played;
/** A real career room after a few completed managed matches (built once, read-only). */
async function playedRoom() {
  if (played) return structuredClone(played);
  const persistence = new MemoryRoomPersistence();
  const leagues = [testLeague("EQ-A", 1, 6), testLeague("EQ-B", 2, 6)];
  const store = new RoomStore({
    persistence,
    catalogStore: rosterCatalog(leagues),
    codeFactory: () => "BOLA-RAPI",
    now: () => new Date("2026-07-12T12:00:00.000Z"),
  });
  const created = await store.createRoom({
    name: "Equivalencia", creatorId: "manager-1", creatorName: "Manager", clubId: "EQ-A-C1",
    activeLeagues: ["EQ-A", "EQ-B"], seasonLength: 1, maxManagers: 1,
  });
  await store.setReady(created.code, "manager-1", true);
  await store.startRoom(created.code, "manager-1");
  for (let index = 0; index < 4; index += 1) {
    const room = await store.getRoom(created.code);
    const fixture = room.fixtureSchedule.find((candidate) => candidate.fixtureId === room.currentFixtureId);
    await store.completeMatch(created.code, room.currentFixtureId, {
      id: `equivalencia-${index}`, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
      score: [index % 3, 1], statistics: { home: {}, away: {} }, skipped: false,
    });
  }
  played = await persistence.get(created.code);
  return structuredClone(played);
}

test("career events: reusing already normalized events/news gives the same log as normalizing everything", async () => {
  const fast = await playedRoom();
  const reference = structuredClone(fast);
  const inputs = Array.from({ length: 40 }, (_, index) => ({
    id: `equivalence-event-${index % 30}`,
    operationId: `equivalence-operation-${index % 30}`,
    type: index % 2 ? CAREER_EVENT_TYPES.PLAYER_INJURED : CAREER_EVENT_TYPES.COMPETITION_WON,
    occurredAt: `2026-07-${String(13 + (index % 10)).padStart(2, "0")}T12:00:00.000Z`,
    clubId: "EQ-A-C1",
    playerId: `player-${index}`,
    staffId: index % 3 ? undefined : `staff-${index}`,
    payload: { clubId: "EQ-A-C1", competitionId: "EQ-A", competitionName: "Serie A" },
  }));
  for (const [index, input] of inputs.entries()) {
    const fastResult = appendCareerEvent(fast, input, { projectNews: index % 4 !== 0 });
    // The reference never sees an object twice: every call starts from fresh copies.
    const copy = structuredClone(reference);
    const referenceResult = appendCareerEvent(copy, input, { projectNews: index % 4 !== 0 });
    Object.assign(reference, copy);
    assert.equal(json(fastResult.event), json(referenceResult.event));
    assert.equal(fastResult.created, referenceResult.created);
    if (index % 7 === 0 && fast.clubCareerState.news.length) {
      const newsId = fast.clubCareerState.news.at(-1).id;
      setCareerNewsReadState(fast, newsId, "manager-1", true, "2026-07-20T10:00:00.000Z");
      setCareerNewsReadState(reference, newsId, "manager-1", true, "2026-07-20T10:00:00.000Z");
    }
  }
  ensureClubCareerState(fast);
  ensureClubCareerState(reference);
  assert.equal(json(fast.clubCareerState), json(structuredClone(reference).clubCareerState));
  assert.equal(json(fast.clubCareerState), json(ensureClubCareerState(structuredClone(fast))));
});

test("career events: de-duplication keeps the first event per id or per type + operation and its news keys", () => {
  const event = (id, type, operationId, extra = {}) => ({ id, type, operationId, occurredAt: "2026-07-13T12:00:00.000Z", ...extra });
  const room = { clubCareerState: {
    events: [
      event("a", "MATCH_PLAYED", "op-1"),
      event("a", "MATCH_PLAYED", "op-2", { note: "same id" }),
      event("b", "MATCH_PLAYED", "op-1", { note: "same occurrence" }),
      { id: " legacy ", legacy: true },
      { id: "legacy", legacy: "second with the same identifier" },
      { id: "a", legacy: "legacy with a kept id" },
      event("c", "MATCH_PLAYED", "op-3"),
    ],
    news: [
      { id: "n1", eventId: "c", eventType: "match played" },
      { id: "n1", eventId: "x" },
      { id: "n2", eventId: "c" },
      { id: "n3", sourceEventId: "a" },
    ],
    processedEventIds: ["older"],
  } };
  const state = ensureClubCareerState(room);
  assert.deepEqual(state.events.map((item) => [item.id, item.operationId ?? null]), [["a", "op-1"], [" legacy ", null], ["c", "op-3"]]);
  assert.deepEqual(state.news.map((item) => [item.id, item.eventId]), [["n1", "c"], ["n3", "a"]]);
  assert.deepEqual(state.processedEventIds, ["older", "c", "a", "operation:MATCH_PLAYED:op-3", "operation:MATCH_PLAYED:op-1"]);
  // Normalizing twice reaches the fixed point; the reused objects must equal fresh ones each time.
  for (let pass = 0; pass < 3; pass += 1) {
    const fresh = ensureClubCareerState(structuredClone(room));
    assert.equal(json(ensureClubCareerState(room)), json(fresh));
  }
});

function referenceCompletedLeagueStates(room) {
  const key = (value) => String(value ?? "").trim().toLocaleUpperCase("pt-BR");
  const states = [];
  for (const league of room.competitionCatalog ?? []) {
    const participants = (league.clubs ?? []).map((club) => ({ id: club.id, name: club.name }));
    if (!league.id || participants.length < 2) continue;
    let state = createCompetitionState({
      id: league.id, name: league.name, format: "league", legs: leagueLegs(league),
      tiebreakers: ["points", "wins", "goal_difference", "goals_scored", "head_to_head"],
      teamCount: participants.length, participants,
    }, { seasonNumber: room.currentSeason, seasonYear: room.seasonYear, startDate: room.seasonStartedAt, roundIntervalDays: 7 });
    let complete = true;
    for (const fixture of state.fixtures) {
      const compact = (room.leagueFixtureSchedule ?? []).find((candidate) => key(candidate.leagueId) === key(league.id)
        && Number(candidate.round) === Number(fixture.round)
        && [key(candidate.homeClubId), key(candidate.awayClubId)].sort().join("|") === [key(fixture.homeClubId), key(fixture.awayClubId)].sort().join("|"));
      const stored = compact && (room.leagueMatchResults ?? []).find((candidate) => key(candidate.leagueFixtureId) === key(compact.leagueFixtureId));
      if (!stored) { complete = false; break; }
      const score = stored.score.slice(0, 2).map((item) => Math.max(0, Math.trunc(Number(item) || 0)));
      state = recordCompetitionResult(state, fixture.id, { score: key(compact.homeClubId) === key(fixture.homeClubId) ? score : [score[1], score[0]] });
    }
    if (complete && state.status === "completed") states.push(state);
  }
  return states;
}

test("league tables: a finished league is rebuilt exactly as before; an unfinished one is skipped", async () => {
  const room = await playedRoom();
  assert.deepEqual(buildCompletedLeagueStates(room), []);
  assert.deepEqual(buildCompletedLeagueStates(room), referenceCompletedLeagueStates(room));
  const league = room.competitionCatalog[0];
  const reference = createCompetitionState({
    id: league.id, name: league.name, format: "league", legs: leagueLegs(league),
    tiebreakers: ["points"], teamCount: league.clubs.length,
    participants: league.clubs.map((club) => ({ id: club.id, name: club.name })),
  }, { seasonNumber: room.currentSeason, seasonYear: room.seasonYear, startDate: room.seasonStartedAt, roundIntervalDays: 7 });
  // Finish the league with stored results (away-first pairs check the score swap).
  room.leagueFixtureSchedule = reference.fixtures.map((fixture, index) => ({
    leagueFixtureId: `full-${index}`, leagueId: ` ${league.id.toLowerCase()} `, round: String(fixture.round),
    homeClubId: index % 2 ? fixture.awayClubId : fixture.homeClubId,
    awayClubId: index % 2 ? fixture.homeClubId : fixture.awayClubId,
  }));
  room.leagueMatchResults = reference.fixtures.map((_, index) => ({ leagueFixtureId: `FULL-${index}`, score: [index % 4, (index * 7) % 3] }));
  const fast = buildCompletedLeagueStates(room);
  assert.equal(fast.length, 1);
  assert.deepEqual(fast, referenceCompletedLeagueStates(room));
  room.leagueMatchResults.pop();
  assert.deepEqual(buildCompletedLeagueStates(room), []);
});

test("player states: a fixture keeps other clubs' states as they are and matches a full normalization", async () => {
  const fast = await playedRoom();
  const clubs = [...new Set(fast.playerStates.map((state) => state.clubId))];
  assert.ok(clubs.length >= 4, "fixture room has player states for several clubs");
  const fixtures = [[clubs[0], clubs[1]], [clubs[2], clubs[3]], [clubs[0], clubs[2]]];
  let reference = structuredClone(fast);
  for (const [index, [homeClubId, awayClubId]] of fixtures.entries()) {
    const stats = (clubId, side) => fast.playerStates.filter((state) => state.clubId === clubId).slice(0, 3)
      .map((state, position) => ({ playerId: state.playerId, clubId, side, started: true, minutesPlayed: 90, goals: position === 0 ? 1 : 0, yellowCards: position === 1 ? 1 : 0 }));
    const result = {
      id: `equivalence-ai-${index}`, homeClubId, awayClubId, leagueId: "EQ-A",
      playerStatistics: { home: stats(homeClubId, "home"), away: stats(awayClubId, "away") }, playerEffects: [],
    };
    const fixture = { fixtureId: result.id, homeClubId, awayClubId, leagueId: "EQ-A" };
    const untouched = fast.playerStates.filter((state) => state.clubId !== homeClubId && state.clubId !== awayClubId);
    untouched.forEach(deepFreeze); // A kept state must never be edited in place.
    const previous = fast.playerStates;
    const fastResult = applyMatchPlayerProgression(fast, fixture, result, "2026-07-20T12:00:00.000Z");
    const referenceResult = applyMatchPlayerProgression(reference, fixture, structuredClone(result), "2026-07-20T12:00:00.000Z");
    assert.equal(json(fastResult), json(referenceResult));
    assert.equal(json(fast.playerStates), json(reference.playerStates));
    // States the previous fixture produced and left unchanged are kept as they are.
    const previousClubs = index > 0 ? fixtures[index - 1] : clubs;
    const kept = untouched.filter((state) => !previousClubs.includes(state.clubId));
    if (index > 0) assert.ok(kept.length > 0 && kept.every((state) => fast.playerStates.includes(state)));
    assert.ok(previous.filter((state) => !untouched.includes(state)).every((state) => !fast.playerStates.includes(state)));
    reference = structuredClone(reference);
  }
});

test("player states: a roster merge uses the last valid stored state per player, normalized as before", () => {
  const room = { currentSeason: 2, playerStates: [
    { playerId: "p1", clubId: "aur", condition: 50, seasonStats: { seasonNumber: 1, goals: 4 } },
    { playerId: " p1 ", clubId: " AUR ", condition: 70, injuryMatches: 2, seasonStats: { seasonNumber: 2, goals: 1 } },
    { playerId: "p2", clubId: "", condition: 10 },
    null,
    { playerId: "p3", clubId: "SAN", condition: 80 },
  ] };
  const players = [{ id: "p1", clubId: "AUR", name: "Um" }, { id: "p2", clubId: "AUR", name: "Dois", status: "Suspenso" }, { id: "p3", name: "Tres" }];
  const merged = mergePlayerStates(players, room, "SAN");
  const normalized = normalizePlayerState(room.playerStates[1], { seasonNumber: 2 });
  assert.equal(merged[0].condition, 70);
  assert.equal(merged[0].injuryMatches, 2);
  assert.deepEqual(merged[0].seasonStats, normalized.seasonStats);
  assert.equal(merged[1].status, "Suspenso");
  assert.equal(merged[2].condition, 80);
  assert.equal(merged[2].clubId, "SAN");
});

test("staff migration: the staff view gives the same staff fields as migrating the whole room", async () => {
  const room = await playedRoom();
  const legacy = { ...structuredClone(room), staff: [{ id: "legacy-coach", name: "Antigo", role: "assistant", clubId: "EQ-A-C1" }] };
  delete legacy.clubCareerState.staffMembers;
  for (const candidate of [room, legacy]) {
    const now = "2026-07-20T12:00:00.000Z";
    const full = ensureStaffState(candidate, { now }).clubCareerState;
    const viewed = ensureStaffState(staffStateView(candidate), { now }).clubCareerState;
    for (const field of ["staffSchemaVersion", "staffMembers", "staffCandidates", "staffContracts", "staffHistory",
      "staffEffectsByClub", "processedStaffOperationIds", "staffInitializedClubIds"]) {
      assert.equal(json(viewed[field]), json(full[field]), field);
    }
  }
});

test("coach history: sharing the match list and attributions across coaches gives the same history", async () => {
  const room = await playedRoom();
  assert.ok(room.coachCareerState?.coaches?.length > 1);
  // Assignment values the sync rewrites (number dates, string seasons) must reset the cache.
  const coach = room.coachCareerState.coaches.find((candidate) => candidate.assignments?.length);
  coach.assignments[0].startedAt = Date.parse(coach.assignments[0].startedAt ?? "2026-07-01T00:00:00.000Z");
  coach.assignments[0].startedSeason = String(coach.assignments[0].startedSeason ?? 1);
  const fast = structuredClone(room);
  const reference = structuredClone(room);
  synchronizeCoachCareerHistory(fast, fast.coachEmploymentState, "2026-07-20T12:00:00.000Z");
  synchronizeCoachCareerHistory(reference, reference.coachEmploymentState, "2026-07-20T12:00:00.000Z", { shareMatchWork: false });
  assert.equal(json(fast.coachCareerState), json(reference.coachCareerState));
  assert.ok(fast.coachCareerState.coaches.some((candidate) => candidate.careerMatchHistory?.length > 0));
});

test("room persistence: a shared (frozen) save is read by reference and never written", async () => {
  const rooms = deepFreeze([{ code: "BOLA-AAAA", value: 1, list: [1] }, { code: "BOLA-BBBB", value: 2 }]);
  const history = deepFreeze([["id-1:h1", { id: "h1", detailsAvailable: true }]]);
  const receipts = deepFreeze([["op", { roomCode: "BOLA-AAAA" }]]);
  const persistence = new MemoryRoomPersistence(rooms, { creationReceipts: receipts, history, shared: true });
  const read = await persistence.get("BOLA-AAAA");
  read.list.push(2);
  const changed = await persistence.mutate("BOLA-AAAA", (current) => { current.value = 10; return current; });
  assert.equal(changed.value, 10);
  const exported = persistence.exportState();
  assert.equal(exported.rooms[1], rooms[1], "untouched room is the same object");
  assert.equal(exported.history[0][1], history[0][1], "archive records are not copied");
  assert.deepEqual(exported.rooms[0], { code: "BOLA-AAAA", value: 10, list: [1] });
  assert.equal(rooms[0].value, 1);
  // The default (owning) mode still copies everything, as before.
  const owning = new MemoryRoomPersistence(structuredClone(rooms), { history: structuredClone(history) });
  assert.notEqual(owning.exportState().rooms[1], rooms[1]);
});

test("match archive: a batch store reports records it kept before failing, like the record-by-record path", async () => {
  const records = ["a", "b", "c"].map((id) => ({ id, detailsAvailable: true }));
  const room = { code: "BOLA-HIST", matchHistoryPending: structuredClone(records) };
  const failure = Object.assign(new Error("conflict"), { code: "MATCH_HISTORY_CONFLICT", acknowledged: records.slice(0, 2) });
  let remaining;
  const persistence = {
    matchHistory: { async putBatch() { throw failure; } },
    async mutatePaths(code, paths, mutation) {
      const next = mutation(structuredClone(room));
      remaining = next.matchHistoryPending;
      return next;
    },
  };
  await assert.rejects(flushMatchHistory(persistence, room), (error) => error === failure);
  assert.deepEqual(remaining.map((record) => record.id), ["c"]);
});

function loanRoom() {
  const MILLION = 1_000_000;
  const room = {
    code: "BOLA-LOAN", status: "active", currentSeason: 1,
    competitionCatalog: [{ id: "BR-A", name: "Liga de teste", clubs: [
      { id: "BUY", name: "Comprador FC", budget: 100 * MILLION, reputation: 10 },
      { id: "AI", name: "Clube IA", budget: 70 * MILLION, reputation: 10 },
    ] }],
    managers: [{ id: "buyer", name: "Buyer", clubId: "BUY" }],
    playerStates: [], clubMoraleStates: [], lineups: [],
    matchReadiness: { fixtureId: "fixture-1", managerIds: ["buyer"] },
  };
  const target = { id: "loaned", clubId: "AI", name: "Emprestado", position: "ATA", age: 24, overall: 10, value: 20 * MILLION, active: true };
  room.playerStates.push({ playerId: target.id, clubId: "AI", condition: 100 });
  createOffer(room, "buyer", { requestId: "loan", dealType: "loan", amount: 2 * MILLION, loanTerms: { durationRounds: 1 } },
    target, new Date("2026-07-18T12:00:00.000Z"));
  assert.equal(registrationForPlayer(room, target.id).loan.remainingRounds, 1);
  return room;
}

test("loan rounds: a failure before any loan ends restores the market state; after one ends, the whole room", () => {
  const room = loanRoom();
  const before = structuredClone(room);
  // Fails while ensureMarketState reads the clubs a second time (after the market state was rebuilt).
  const league = room.competitionCatalog[0];
  const clubs = league.clubs;
  let reads = 0;
  Object.defineProperty(league, "clubs", { configurable: true, enumerable: true, get() {
    reads += 1;
    if (reads > 1) throw new Error("catalog unavailable");
    return clubs;
  } });
  assert.throws(() => advanceMarketLoans(room, 1, 1, new Date("2026-07-19T12:00:00.000Z"), "BR-A"), /catalog unavailable/);
  Object.defineProperty(league, "clubs", { value: clubs, writable: true, enumerable: true, configurable: true });
  assert.deepEqual(room, before);

  // The loan ends; ending it writes to a frozen player state and fails: everything is restored.
  const ending = loanRoom();
  const original = structuredClone(ending);
  Object.freeze(ending.playerStates[0]);
  assert.throws(() => advanceMarketLoans(ending, 1, 1, new Date("2026-07-19T12:00:00.000Z")), TypeError);
  assert.deepEqual(ending, original);

  // Without failures the loan ends exactly as with a full copy taken up front.
  const fast = loanRoom();
  const result = advanceMarketLoans(fast, 1, 1, new Date("2026-07-19T12:00:00.000Z"));
  assert.equal(result.returned.length, 1);
  assert.equal(registrationForPlayer(fast, "loaned").loan, null);
});

test("facilities: lookups after a full normalization skip re-normalizing and return the same values", async () => {
  const room = await playedRoom();
  const asOf = "2026-07-20T12:00:00.000Z";
  ensureClubCareerSystems(room, { now: asOf });
  const reference = structuredClone(room);
  for (const club of room.competitionCatalog.flatMap((league) => league.clubs)) {
    const fast = facilityEffectsForClub(room, club.id, asOf, { ensured: true });
    assert.deepEqual(fast, facilityEffectsForClub(reference, club.id, asOf));
    assert.deepEqual(clubCareerPerformanceEffects(room, club.id, asOf, { ensured: true }),
      clubCareerPerformanceEffects(structuredClone(reference), club.id, asOf));
  }
  assert.equal(json(room.clubCareerState.clubFacilities), json(reference.clubCareerState.clubFacilities));
  // A recorded matchday leaves facilities exactly as the double normalization did.
  const [home, away] = room.competitionCatalog[0].clubs;
  const input = { fixtureId: "eq-matchday", homeClubId: home.id, awayClubId: away.id, competitionId: "EQ-A", score: [2, 1], occurredAt: asOf };
  const credit = () => ({ applied: true });
  recordMatchdayEconomy(room, input, { credit });
  ensureClubFacilities(reference, asOf);
  facilityForClub(reference, home.id, asOf);
  recordMatchdayEconomy(reference, input, { credit });
  assert.equal(json(room.clubCareerState.clubFacilities), json(reference.clubCareerState.clubFacilities));
  // A round of matchdays after one normalization equals normalizing before each of them.
  const clubs = room.competitionCatalog.flatMap((league) => league.clubs);
  for (let index = 0; index < 40; index += 1) {
    const fixture = { ...input, fixtureId: `eq-round-${index}`, homeClubId: clubs[index % clubs.length].id,
      awayClubId: clubs[(index + 1) % clubs.length].id, score: [index % 3, (index + 1) % 2] };
    const fast = recordMatchdayEconomy(room, fixture, { credit, facilitiesReady: true });
    assert.deepEqual(fast, recordMatchdayEconomy(reference, fixture, { credit }));
  }
  ensureClubFacilities(reference, asOf);
  assert.equal(json(room.clubCareerState.clubFacilities), json(reference.clubCareerState.clubFacilities));
});

test("match archive: a store's batch size sets how many pending records one flush writes (default 25)", async () => {
  const records = Array.from({ length: 30 }, (_, index) => ({ id: `r${index}`, detailsAvailable: true }));
  for (const [batchSize, written, left] of [[undefined, 25, 5], [512, 30, 0]]) {
    const room = { code: "BOLA-HIST", matchHistoryPending: structuredClone(records) };
    let batch;
    const persistence = {
      matchHistory: { batchSize, async putBatch(_, values) { batch = values; return values; } },
      async mutatePaths(code, paths, mutation) { return mutation(room); },
    };
    assert.equal(await flushMatchHistory(persistence, room), left);
    assert.equal(batch.length, written);
    assert.deepEqual(room.matchHistoryPending.map((record) => record.id), records.slice(written).map((record) => record.id));
  }
});

test("hash index: cached digests and the direct lookup answer exactly like hashing and normalizing first", () => {
  const values = Array.from({ length: 400 }, (_, index) => `origin-${index}`);
  for (const value of values.slice(0, 50)) {
    assert.equal(compactHash(value), createHash("sha256").update(value).digest().subarray(0, 16).toString("base64url"));
    assert.equal(compactHash(value, { digestBytes: 8 }), createHash("sha256").update(value).digest().subarray(0, 8).toString("base64url"));
  }
  const reference = (index, value, options = {}) => {
    const normalized = normalizeCompactHashIndex(index, options);
    if (!normalized.count || value === null || value === undefined || value === "") return false;
    const target = compactHash(value, { digestBytes: normalized.digestBytes });
    const bytes = Buffer.from(target, "base64url");
    const bucket = Buffer.from(normalized.buckets[bytes.subarray(0, 1).toString("hex")] ?? "", "base64");
    const width = normalized.digestBytes - 1;
    for (let offset = 0; offset < bucket.length; offset += width) {
      if (bucket.subarray(offset, offset + width).equals(bytes.subarray(1))) return true;
    }
    return false;
  };
  const index = addCompactHashIndexValues(null, values.slice(0, 300));
  // Mixed-case, duplicated, invalid and empty buckets, as an old or edited save could have.
  const messy = structuredClone(index);
  const [firstKey, secondKey] = Object.keys(messy.buckets);
  messy.buckets[firstKey.toUpperCase()] = messy.buckets[secondKey];
  messy.buckets.zz = messy.buckets[firstKey];
  messy.buckets[secondKey] = "not base64 of a whole digest!";
  const empty = { ...structuredClone(index), buckets: { [firstKey]: "" } };
  const otherVersion = { ...structuredClone(index), version: 2 };
  for (const candidate of [index, messy, empty, otherVersion, null, {}, { version: 1, digestBytes: 16 }]) {
    for (const value of [...values, "", null, undefined, 7]) {
      assert.equal(compactHashIndexContains(candidate, value), reference(candidate, value), `${JSON.stringify(value)}`);
    }
  }
  const narrow = addCompactHashIndexValues(null, values.slice(0, 20), { version: 3, digestBytes: 8 });
  for (const value of values.slice(0, 40)) {
    assert.equal(compactHashIndexContains(narrow, value, { version: 3, digestBytes: 8 }), reference(narrow, value, { version: 3, digestBytes: 8 }));
  }
});

test("hash index: normalization keeps canonical buckets as they are and rebuilds the rest as before", () => {
  const reference = (value, digestBytes = 16, version = 1) => {
    const suffixWidth = digestBytes - 1;
    const buckets = {};
    let count = 0;
    if (value && typeof value === "object" && Number(value.version) === version && Number(value.digestBytes) === digestBytes
      && value.buckets && typeof value.buckets === "object") {
      for (const [key, encoded] of Object.entries(value.buckets)) {
        if (!/^[0-9a-f]{2}$/i.test(key)) continue;
        const bytes = typeof encoded === "string" && encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
        if (!bytes.length || bytes.length % suffixWidth !== 0) continue;
        buckets[key.toLowerCase()] = bytes.toString("base64");
        count += bytes.length / suffixWidth;
      }
    }
    return { version, algorithm: "sha256", digestBytes, prefixBytes: 1, count, buckets };
  };
  const index = addCompactHashIndexValues(null, Array.from({ length: 600 }, (_, item) => `key-${item}`));
  const keys = Object.keys(index.buckets);
  const fifteen = Buffer.alloc(15, 7).toString("base64"); // 20 chars, no padding
  const padded = Buffer.alloc(16, 9).toString("base64"); // ends with "=="
  const variants = {
    ...index.buckets,
    [keys[0].toUpperCase()]: index.buckets[keys[1]],
    [keys[2]]: index.buckets[keys[2]].replace(/=+$/, ""), // padding removed
    [keys[3]]: ` ${index.buckets[keys[3]]}`, // whitespace
    [keys[4]]: index.buckets[keys[4]].replace(/\+/g, "-").replace(/\//g, "_"), // url alphabet
    [keys[5]]: padded, // 16 bytes is not a whole number of 15-byte digests
    [keys[6]]: `${fifteen.slice(0, -2)}B=`, // non-zero unused bits with padding
    zz: fifteen,
    [keys[7]]: "",
    [keys[8]]: 42,
  };
  for (const value of [index, { ...index, buckets: variants }, { ...index, version: 2 }, null, { version: 1, digestBytes: 16, buckets: {} }]) {
    assert.equal(json(normalizeCompactHashIndex(value)), json(reference(value)));
  }
  const narrow = addCompactHashIndexValues(null, ["a", "b", "c"], { digestBytes: 8 });
  assert.equal(json(normalizeCompactHashIndex(narrow, { digestBytes: 8 })), json(reference(narrow, 8)));
});

test("player states: a state moved to another club in place (market transfer) is normalized again", async () => {
  const room = await playedRoom();
  const [first, second, third] = [...new Set(room.playerStates.map((state) => state.clubId))];
  const fixture = (id, home, away) => [{ fixtureId: id, homeClubId: home, awayClubId: away, leagueId: "EQ-A" },
    { id, homeClubId: home, awayClubId: away, leagueId: "EQ-A", playerStatistics: { home: [], away: [] }, playerEffects: [] }];
  applyMatchPlayerProgression(room, ...fixture("move-1", first, second), "2026-07-20T12:00:00.000Z");
  const moved = room.playerStates.find((state) => state.clubId === third);
  moved.clubId = ` ${first.toLowerCase()} `; // what an untrimmed transfer target would leave behind
  const reference = structuredClone(room);
  applyMatchPlayerProgression(room, ...fixture("move-2", second, third), "2026-07-21T12:00:00.000Z");
  applyMatchPlayerProgression(reference, ...fixture("move-2", second, third), "2026-07-21T12:00:00.000Z");
  assert.equal(json(room.playerStates), json(reference.playerStates));
  assert.ok(!room.playerStates.includes(moved));
});
