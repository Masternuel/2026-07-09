import assert from "node:assert/strict";
import test from "node:test";
import {
  GlobalFixtureCalendarError,
  coordinateGlobalFixtureCalendar,
  validateGlobalFixtureCalendar,
} from "../game/globalFixtureCalendar.mjs";

const DAY = 24 * 60 * 60 * 1_000;

function fixture({
  id,
  home = "A",
  away = "B",
  at = "2026-01-01T20:00:00.000Z",
  priority = 20,
  locked = false,
  kind = "league",
}) {
  return {
    id,
    homeClubId: home,
    awayClubId: away,
    scheduledAt: at,
    priority,
    locked,
    kind,
  };
}

function byId(fixtures, id) {
  return fixtures.find((entry) => entry.id === id);
}

function datesById(fixtures) {
  return Object.fromEntries(fixtures.map(({ id, scheduledAt }) => [id, scheduledAt]));
}

test("calendario sem conflito preserva datas", () => {
  const input = [
    fixture({ id: "L1" }),
    fixture({ id: "L2", home: "C", away: "D", at: "2026-01-02T20:00:00.000Z" }),
    fixture({ id: "L3", at: "2026-01-04T20:00:00.000Z" }),
  ];
  const coordinated = coordinateGlobalFixtureCalendar(input);

  assert.deepEqual(coordinated.map(({ scheduledAt }) => scheduledAt), input.map(({ scheduledAt }) => scheduledAt));
  assert.equal(coordinated.every(({ rescheduled }) => !rescheduled), true);
  assert.equal(validateGlobalFixtureCalendar(coordinated), true);
});

test("copa tem prioridade e move liga na mesma data", () => {
  const coordinated = coordinateGlobalFixtureCalendar([
    fixture({ id: "L1", priority: 20 }),
    fixture({ id: "C1", away: "C", priority: 10, kind: "cup" }),
  ]);

  assert.equal(byId(coordinated, "C1").scheduledAt, "2026-01-01T20:00:00.000Z");
  assert.equal(byId(coordinated, "C1").rescheduled, false);
  assert.equal(byId(coordinated, "L1").scheduledAt, "2026-01-04T20:00:00.000Z");
  assert.equal(byId(coordinated, "L1").rescheduled, true);
});

test("descanso menor que o minimo remarca a partida", () => {
  const coordinated = coordinateGlobalFixtureCalendar([
    fixture({ id: "L1" }),
    fixture({ id: "L2", away: "C", at: "2026-01-03T20:00:00.000Z" }),
  ]);

  assert.equal(byId(coordinated, "L2").scheduledAt, "2026-01-04T20:00:00.000Z");
  assert.equal(validateGlobalFixtureCalendar(coordinated), true);
});

test("conflito considera clube como mandante e visitante", () => {
  const coordinated = coordinateGlobalFixtureCalendar([
    fixture({ id: "L1", home: "A", away: "B" }),
    fixture({ id: "L2", home: "C", away: "A", at: "2026-01-02T20:00:00.000Z" }),
  ]);

  assert.equal(byId(coordinated, "L2").scheduledAt, "2026-01-04T20:00:00.000Z");
});

test("remarcacao resolve conflitos em cadeia", () => {
  const coordinated = coordinateGlobalFixtureCalendar([
    fixture({ id: "C1", home: "A", away: "B", priority: 10, kind: "cup" }),
    fixture({ id: "L1", home: "A", away: "C", priority: 20 }),
    fixture({ id: "L2", home: "C", away: "D", at: "2026-01-02T20:00:00.000Z", priority: 30 }),
  ]);

  assert.equal(byId(coordinated, "L1").scheduledAt, "2026-01-04T20:00:00.000Z");
  assert.equal(byId(coordinated, "L2").scheduledAt, "2026-01-07T20:00:00.000Z");
  assert.equal(validateGlobalFixtureCalendar(coordinated), true);
});

test("limite sem capacidade gera erro claro", () => {
  assert.throws(
    () => coordinateGlobalFixtureCalendar([
      fixture({ id: "C1", priority: 10, kind: "cup" }),
      fixture({ id: "L1", away: "C", priority: 20 }),
    ], { maxRescheduleDays: 2 }),
    (error) => {
      assert.equal(error instanceof GlobalFixtureCalendarError, true);
      assert.equal(error.code, "GLOBAL_CALENDAR_CAPACITY_EXCEEDED");
      assert.match(error.message, /remarcar partida dentro do limite/i);
      assert.equal(error.details.fixtureId, "L1");
      return true;
    },
  );
});

test("partidas bloqueadas em conflito sao rejeitadas", () => {
  assert.throws(
    () => coordinateGlobalFixtureCalendar([
      fixture({ id: "C1", locked: true, priority: 10, kind: "cup" }),
      fixture({ id: "L1", away: "C", locked: true, priority: 20 }),
    ]),
    (error) => {
      assert.equal(error instanceof GlobalFixtureCalendarError, true);
      assert.equal(error.code, "LOCKED_FIXTURE_CONFLICT");
      assert.equal(error.details.fixtureId, "L1");
      assert.equal(error.details.conflictingFixtureId, "C1");
      return true;
    },
  );
});

function leagueSeason(clubIds) {
  const rotating = [...clubIds];
  const rounds = [];
  for (let round = 0; round < clubIds.length - 1; round += 1) {
    for (let index = 0; index < clubIds.length / 2; index += 1) {
      rounds.push({
        round,
        home: rotating[index],
        away: rotating[clubIds.length - 1 - index],
      });
    }
    rotating.splice(1, 0, rotating.pop());
  }
  const legs = [...rounds, ...rounds.map((entry) => ({
    round: entry.round + clubIds.length - 1,
    home: entry.away,
    away: entry.home,
  }))];
  const start = Date.parse("2026-01-05T20:00:00.000Z");
  return legs.map((entry, index) => fixture({
    id: `L${index + 1}`,
    home: entry.home,
    away: entry.away,
    at: new Date(start + entry.round * 7 * DAY).toISOString(),
  }));
}

test("temporada grande e deterministica e valida", () => {
  const clubs = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const input = [
    ...leagueSeason(clubs),
    fixture({ id: "CQ1", home: "A", away: "B", at: "2026-01-05T20:00:00.000Z", priority: 10, kind: "cup" }),
    fixture({ id: "CQ2", home: "C", away: "D", at: "2026-01-05T20:00:00.000Z", priority: 10, kind: "cup" }),
    fixture({ id: "CQ3", home: "E", away: "F", at: "2026-01-05T20:00:00.000Z", priority: 10, kind: "cup" }),
    fixture({ id: "CQ4", home: "G", away: "H", at: "2026-01-05T20:00:00.000Z", priority: 10, kind: "cup" }),
    fixture({ id: "CS1", home: "A", away: "C", at: "2026-01-26T20:00:00.000Z", priority: 10, kind: "cup" }),
    fixture({ id: "CS2", home: "E", away: "G", at: "2026-01-26T20:00:00.000Z", priority: 10, kind: "cup" }),
    fixture({ id: "CF", home: "A", away: "E", at: "2026-02-16T20:00:00.000Z", priority: 10, kind: "cup" }),
  ];

  const first = coordinateGlobalFixtureCalendar(input);
  const second = coordinateGlobalFixtureCalendar(structuredClone(input));
  const reversed = coordinateGlobalFixtureCalendar([...structuredClone(input)].reverse());

  assert.deepEqual(second, first);
  assert.deepEqual(datesById(reversed), datesById([...first].reverse()));
  assert.equal(validateGlobalFixtureCalendar(first), true);
  assert.equal(first.length, 63);
});
