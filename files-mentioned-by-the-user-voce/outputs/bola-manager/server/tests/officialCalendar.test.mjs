import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { aiFixturesBeforeNextManaged, pendingManagedFixtures, pendingOfficialFixtures } from "../game/officialCalendar.mjs";
import { coordinateRoomFixtureCalendar, ensureFixtureSchedule } from "../game/fixtures.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

const at = (day) => `2026-07-${String(day).padStart(2, "0")}T20:00:00.000Z`;
function match(id, day, options = {}) {
  return { fixtureId: id, leagueFixtureId: id, leagueId: "L1", homeClubId: "B", awayClubId: "C",
    round: 1, scheduledAt: at(day), ...options };
}
function sample() {
  const first = match("H1", 20, { homeClubId: "A", awayClubId: "D" });
  const next = match("H2", 27, { homeClubId: "A", awayClubId: "E", round: 2 });
  const cup = { id: "CUP-1", competitionFixtureId: "CUP-1", competitionId: "CUP", fixtureId: "CUP-1",
    homeClubId: "A", awayClubId: "F", scheduledAt: at(23), round: 1, status: "scheduled" };
  return { managers: [{ id: "M", clubId: "A" }], managerIds: ["M"],
    fixtureSchedule: [next, cup, first], completedFixtureIds: [], leagueMatchResults: [],
    leagueFixtureSchedule: [first, next, match("LATE", 29), match("EARLY", 21, { round: 4, leagueId: "L2" })],
    competitionSeason: { fixtures: [cup], completedFixtureIds: [] } };
}

test("data prevalece sobre rodada e copa limita avancos de todas as ligas", () => {
  const room = sample();
  assert.equal(pendingManagedFixtures(room)[0].fixtureId, "H1");
  const due = aiFixturesBeforeNextManaged(room, { excludedFixtureId: "H1", through: at(20) });
  assert.deepEqual(due.map((fixture) => fixture.leagueFixtureId), ["EARLY"]);
  assert.equal(pendingOfficialFixtures(room, "H1").find((fixture) => fixture.managed).competitionFixtureId, "CUP-1");
});

test("duas copas respeitam data; rodada igual nao antecipa final futura", () => {
  const room = sample();
  room.competitionSeason.fixtures.push({ id: "OTHER-CUP", competitionFixtureId: "OTHER-CUP", competitionId: "OTHER",
    scheduledAt: at(28), homeClubId: "G", awayClubId: "H", round: 1, status: "scheduled" });
  assert.equal(aiFixturesBeforeNextManaged(room, { excludedFixtureId: "H1" }).some((fixture) => fixture.id === "OTHER-CUP"), false);
});

test("concluidos, cancelados e participantes indefinidos nao entram na fila", () => {
  const room = sample();
  room.leagueMatchResults.push({ leagueFixtureId: "EARLY", score: [1, 0] });
  room.leagueFixtureSchedule.find((fixture) => fixture.leagueFixtureId === "LATE").status = "cancelled";
  room.competitionSeason.fixtures.push({ id: "WAITING", status: "scheduled", homeClubId: null, awayClubId: "B" });
  assert.deepEqual(aiFixturesBeforeNextManaged(room, { excludedFixtureId: "H1" }), []);
});

test("AI simultanea so avanca apos jogo humano daquele horario", () => {
  const room = sample();
  room.leagueFixtureSchedule.push(match("SAME", 20));
  assert.deepEqual(aiFixturesBeforeNextManaged(room), []);
  assert.deepEqual(aiFixturesBeforeNextManaged(room, { through: at(20) }).map((fixture) => fixture.leagueFixtureId), ["SAME"]);
});

test("data invalida falha explicitamente; nao vira inicio ou fim ficticio do calendario", () => {
  const room = sample();
  room.leagueFixtureSchedule[0].scheduledAt = null;
  assert.throws(() => pendingOfficialFixtures(room), { code: "INVALID_GLOBAL_FIXTURE" });
});

test("adiamento nao regride durante coordenacao ou reload", () => {
  const room = sample();
  const moved = { ...match("POSTPONED", 27), originalScheduledAt: at(20), dateLocked: true };
  const first = coordinateRoomFixtureCalendar(room, [moved], null);
  const second = coordinateRoomFixtureCalendar(room, structuredClone(first.leagueSchedule), null);
  assert.equal(first.leagueSchedule[0].scheduledAt, at(27));
  assert.deepEqual(second.leagueSchedule, first.leagueSchedule);
});

test("mesmo clube descansa 72 horas entre liga e copa; nova coordenacao e estavel", () => {
  const room = sample();
  const league = [match("L1", 20, { homeClubId: "A", awayClubId: "B" })];
  const cup = { id: "C1", competitionFixtureId: "C1", competitionId: "CUP", scheduledAt: at(20),
    homeClubId: "A", awayClubId: "C", status: "scheduled" };
  const first = coordinateRoomFixtureCalendar(room, league, { fixtures: [cup] });
  assert.equal(Date.parse(first.leagueSchedule[0].scheduledAt) - Date.parse(first.competitionSeason.fixtures[0].scheduledAt), 72 * 3600_000);
  const second = coordinateRoomFixtureCalendar(room, first.leagueSchedule, first.competitionSeason);
  assert.deepEqual(second.leagueSchedule, first.leagueSchedule);
  assert.deepEqual(second.competitionSeason, first.competitionSeason);
});

test("calendario da UI e servidor apontam mesmo proximo compromisso", async () => {
  const source = await readFile(new URL("../../src/views/season/calendarItems.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { buildCalendarSchedule } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  const room = sample();
  room.completedFixtureIds = ["H1"];
  room.currentFixtureId = pendingManagedFixtures(room)[0].fixtureId;
  assert.equal(room.currentFixtureId, "CUP-1");
  assert.equal(buildCalendarSchedule(room, "A").currentFixture.fixture.fixtureId, room.currentFixtureId);
  assert.equal(buildCalendarSchedule(structuredClone(room), "A").currentFixture.fixture.scheduledAt, at(23));
});

async function started() {
  const positions = ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA", "GOL", "ZAG", "MC", "ATA"];
  const leagues = ["L1", "L2"].map((id, index) => ({ id, name: id, legs: "double", country: "Brasil", clubs:
    Array.from({ length: 4 }, (_, n) => ({ id: `${index ? "D" : "C"}${n + 1}`, name: `${id}-${n}`, leagueId: id, reputation: 10 })) }));
  const catalog = {
    async listCompetitionCatalog() { return leagues; },
    async listActiveTournaments() { return { tournaments: [{ id: "CUP", name: "Copa", format: "knockout", legs: "single", teamCount: 4,
      teamIds: leagues[0].clubs.map((club) => club.id), active: true, tiebreakers: ["penalties"] }] }; },
    async listPlayers(clubId) { return { players: positions.map((position, n) => ({ id: `${clubId}-${n}`, clubId, position,
      name: `Player ${n}`, age: 23, overall: 12, active: true, condition: 100 })) }; },
  };
  const persistence = new MemoryRoomPersistence();
  const options = { persistence, catalogStore: catalog, now: () => new Date("2026-07-16T12:00:00Z"), codeFactory: () => "BOLA-CAL1" };
  const store = new RoomStore(options);
  const created = await store.createRoom({ name: "Calendario", creatorId: "M", creatorName: "Manager", clubId: "C1",
    activeLeagues: ["L1", "L2"], seasonLength: 1, maxManagers: 1 });
  await store.setReady(created.code, "M", true);
  return { store, persistence, options, room: await store.startRoom(created.code, "M") };
}

test("RoomStore simula liga paralela por data, preserva adiamento e repete reload sem novos resultados", async () => {
  const context = await started();
  let earlyId;
  let lateId;
  let lateAt;
  await context.persistence.mutate(context.room.code, (room) => {
    const parallel = room.leagueFixtureSchedule.filter((fixture) => fixture.leagueId === "L2");
    const early = parallel.find((fixture) => fixture.round === 4);
    const late = parallel.find((fixture) => fixture.round === 1);
    earlyId = early.leagueFixtureId;
    lateId = late.leagueFixtureId;
    const first = room.fixtureSchedule.find((fixture) => fixture.fixtureId === room.currentFixtureId);
    early.scheduledAt = new Date(Date.parse(first.scheduledAt) + 86400_000).toISOString();
    early.originalScheduledAt = early.scheduledAt;
    early.dateLocked = true;
    lateAt = new Date(Date.parse(first.scheduledAt) + 25 * 86400_000).toISOString();
    late.scheduledAt = lateAt;
    late.originalScheduledAt = late.scheduledAt;
    late.dateLocked = true;
    ensureFixtureSchedule(room);
    return room;
  });
  const store = new RoomStore(context.options);
  const room = await store.requireRoom(context.room.code);
  const first = room.fixtureSchedule.find((fixture) => fixture.fixtureId === room.currentFixtureId);
  const completion = await store.completeMatch(room.code, first.fixtureId, { id: "human-calendar", score: [1, 0],
    homeTeam: first.homeTeam, awayTeam: first.awayTeam });
  assert.equal(completion.room.leagueMatchResults.some((result) => result.leagueFixtureId === earlyId), true);
  assert.equal(completion.room.leagueMatchResults.some((result) => result.leagueFixtureId === lateId), false);
  const next = completion.room.fixtureSchedule.find((fixture) => fixture.fixtureId === completion.room.currentFixtureId);
  for (const result of completion.room.leagueMatchResults) {
    const fixture = completion.room.leagueFixtureSchedule.find((candidate) => candidate.leagueFixtureId === result.leagueFixtureId);
    assert.ok(Date.parse(fixture.scheduledAt) < Date.parse(next.scheduledAt));
  }
  const reloaded = await new RoomStore(context.options).requireRoom(room.code);
  assert.deepEqual(reloaded.leagueMatchResults, completion.room.leagueMatchResults);
  assert.equal(reloaded.currentFixtureId, completion.room.currentFixtureId);
  assert.equal(reloaded.leagueFixtureSchedule.find((fixture) => fixture.leagueFixtureId === lateId).scheduledAt, lateAt);
});

test("prepareMatch recupera IA anterior ao jogo humano e nao repete na proxima preparacao", async () => {
  const context = await started();
  let overdueId;
  await context.persistence.mutate(context.room.code, (room) => {
    const first = room.fixtureSchedule.find((fixture) => fixture.fixtureId === room.currentFixtureId);
    const overdue = room.leagueFixtureSchedule.find((fixture) => fixture.leagueId === "L2");
    overdueId = overdue.leagueFixtureId;
    overdue.scheduledAt = new Date(Date.parse(first.scheduledAt) - 4 * 86400_000).toISOString();
    overdue.originalScheduledAt = overdue.scheduledAt;
    overdue.dateLocked = true;
    ensureFixtureSchedule(room);
    return room;
  });
  const reloaded = new RoomStore(context.options);
  const prepared = await reloaded.prepareMatch(context.room.code, "M", context.room.currentFixtureId);
  assert.equal(prepared.migrated, true);
  assert.equal(prepared.room.leagueMatchResults.some((result) => result.leagueFixtureId === overdueId), true);
  assert.equal(prepared.fixtureId, prepared.room.currentFixtureId);
  const again = await reloaded.prepareMatch(context.room.code, "M", prepared.fixtureId);
  assert.deepEqual(again.room.leagueMatchResults, prepared.room.leagueMatchResults);
});

test("datas fixas conflitantes abortam sem salvar calendario parcial", async () => {
  const context = await started();
  const before = await context.store.requireRoom(context.room.code);
  await assert.rejects(context.persistence.mutate(context.room.code, (room) => {
    const games = room.leagueFixtureSchedule.filter((fixture) => fixture.homeClubId === "C1" || fixture.awayClubId === "C1");
    games[0].dateLocked = true;
    games[1].dateLocked = true;
    games[1].scheduledAt = games[0].scheduledAt;
    ensureFixtureSchedule(room);
    return room;
  }), { code: "LOCKED_FIXTURE_CONFLICT" });
  const after = await context.store.requireRoom(context.room.code);
  assert.deepEqual(after.leagueFixtureSchedule, before.leagueFixtureSchedule);
  assert.equal(after.currentFixtureId, before.currentFixtureId);
});
