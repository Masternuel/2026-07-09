import assert from "node:assert/strict";
import test from "node:test";

import { buildCoachEvaluationContext } from "../game/coachEvaluationContext.mjs";

function appointment(overrides = {}) {
  return {
    id: "appointment-coach-a",
    coachId: "coach-a",
    clubId: "A",
    status: "active",
    role: "head_coach",
    startedSeason: 2,
    startedRound: 1,
    ...overrides,
  };
}

function baseRoom(overrides = {}) {
  const activeAppointment = appointment();
  return {
    currentSeason: 2,
    competitionCatalog: [{
      id: "L1",
      name: "Liga",
      clubs: [
        { id: "A", name: "A", reputation: 18 },
        { id: "B", name: "B", reputation: 16 },
        { id: "C", name: "C", reputation: 14 },
        { id: "D", name: "D", reputation: 12 },
      ],
    }],
    coachCareerState: {
      version: 1,
      coaches: [{
        id: "coach-a",
        name: "Treinador A",
        reputation: null,
        currentClubId: "A",
        assignments: [{ clubId: "A", startedSeason: 2, startedRound: 1 }],
      }],
    },
    coachEmploymentState: {
      version: 1,
      appointments: [activeAppointment],
      contracts: [{
        id: "contract-a",
        coachId: "coach-a",
        clubId: "A",
        status: "active",
        objectives: [],
      }],
    },
    leagueFixtureSchedule: [],
    leagueMatchResults: [],
    completedMatches: [],
    seasonHistory: [],
    competitionSeason: { competitions: [], fixtures: [], winners: [] },
    ...overrides,
  };
}

function compactCampaign({ points = 25, played = 10, titles = 0 } = {}) {
  return [{
    format: "ranking-timeline-v1",
    seasonNumber: 1,
    seasonYear: 2026,
    competitionId: "L1",
    competitionName: "Liga",
    clubs: [["A", "A", "A"], ["B", "B", "B"]],
    managers: [["coach-a", "A", "Treinador A"]],
    rounds: [{
      round: 10,
      clubRows: [],
      managerRows: [[
        0, 1, points, played, 8, 1, 1, 20, 7, 80,
        "A", 1, 1, 1, titles,
      ]],
    }],
  }];
}

test("contexto não inventa fatores sem evidência persistida suficiente", () => {
  const room = baseRoom();
  const before = structuredClone(room);
  const result = buildCoachEvaluationContext(room, {
    coachId: "coach-a",
    clubId: "A",
    appointment: room.coachEmploymentState.appointments[0],
    contract: room.coachEmploymentState.contracts[0],
    expectedPosition: 1,
  });

  assert.equal(result.impact, 0);
  assert.deepEqual(result.factors, []);
  assert.deepEqual(room, before, "seletor deve ser puro");
});

test("qualidade confiável do elenco tempera objetivo incompatível da diretoria", () => {
  const room = baseRoom();
  room.competitionCatalog[0].clubs = [
    { id: "A", name: "A", reputation: 18, squadStrength: 7 },
    { id: "B", name: "B", reputation: 16, squadStrength: 18 },
    { id: "C", name: "C", reputation: 14, squadStrength: 16 },
    { id: "D", name: "D", reputation: 12, squadStrength: 14 },
  ];

  const result = buildCoachEvaluationContext(room, {
    coachId: "coach-a",
    clubId: "A",
    expectedPosition: 1,
  });
  const squad = result.factors.find((entry) => entry.code === "squad_resources_below_expectation");

  assert.ok(squad);
  assert.equal(squad.impact, 2);
  assert.equal(result.evidence.squadQuality.position, 4);
  assert.deepEqual(result.evidence.squadQuality.fields, ["squadStrength", "rankingSquadStrength", "strength"]);
});

test("reputação, objetivos explícitos e partidas reais do vínculo afetam segurança", () => {
  const room = baseRoom();
  room.coachCareerState.coaches[0].reputation = 90;
  room.competitionCatalog[0].clubs[0].reputation = 10;
  room.coachEmploymentState.contracts[0].objectives = [
    { id: "academy", status: "completed" },
    { id: "finance", status: "failed" },
  ];
  room.completedMatches = Array.from({ length: 20 }, (_, index) => ({
    id: `match-${index + 1}`,
    fixtureId: `match-${index + 1}`,
    seasonNumber: 2,
    round: index + 1,
    homeClubId: "A",
    awayClubId: "B",
    homeManagerId: "coach-a",
    awayManagerId: "coach-b",
    score: [1, 0],
  }));

  const result = buildCoachEvaluationContext(room, { coachId: "coach-a", clubId: "A" });
  assert.deepEqual(
    result.factors.map(({ code, impact }) => [code, impact]),
    [
      ["coach_reputation_trust", 2],
      ["board_objectives_met", 2],
      ["board_objectives_failed", -3],
      ["established_tenure", 1],
    ],
  );
  assert.equal(result.evidence.tenureMatches, 20);
  assert.equal(result.impact, 2);
});

test("campanhas e títulos usam arquivo real da carreira", () => {
  const room = baseRoom({
    seasonHistory: [{
      seasonNumber: 1,
      rankingTimeline: compactCampaign({ points: 25, played: 10, titles: 1 }),
      tournamentWinners: [{ tournamentId: "CUP", clubId: "A", managerId: "coach-a" }],
    }],
  });

  const result = buildCoachEvaluationContext(room, { coachId: "coach-a", clubId: "A" });
  const campaign = result.factors.find((entry) => entry.code === "strong_past_campaigns");
  const titles = result.factors.find((entry) => entry.code === "career_titles");

  assert.equal(campaign?.impact, 3);
  assert.equal(campaign?.evidence.pointsPerGame, 2.5);
  assert.equal(titles?.impact, 4);
  assert.equal(result.evidence.titles, 2);
});

test("eliminação precoce em copa só pesa quando ocorreu durante vínculo atual", () => {
  const cup = {
    id: "CUP",
    format: "knockout",
    participants: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
    status: "active",
    winnerClubId: null,
    fixtures: [{
      id: "cup-r1-a-b",
      competitionFixtureId: "cup-r1-a-b",
      status: "completed",
      calendarRound: 2,
      round: 1,
      homeClubId: "A",
      awayClubId: "B",
      result: { score: [0, 1] },
    }],
    stages: [{
      id: "knockout",
      type: "knockout",
      status: "active",
      rounds: [{ number: 1 }, { number: 2 }],
      ties: [{
        id: "tie-1",
        status: "completed",
        round: 1,
        homeClubId: "A",
        awayClubId: "B",
        winnerClubId: "B",
        fixtureIds: ["cup-r1-a-b"],
      }],
    }],
  };
  const room = baseRoom({
    competitionCatalog: [{
      id: "L1",
      clubs: [
        { id: "A", reputation: 20 },
        { id: "B", reputation: 15 },
        { id: "C", reputation: 10 },
        { id: "D", reputation: 5 },
      ],
    }],
    competitionSeason: { competitions: [cup], fixtures: cup.fixtures, winners: [] },
  });

  const duringTenure = buildCoachEvaluationContext(room, { coachId: "coach-a", clubId: "A" });
  const elimination = duringTenure.factors.find((entry) => entry.code === "cup_eliminations");
  assert.equal(elimination?.impact, -3);
  assert.equal(duringTenure.evidence.cupEliminations[0].contender, true);

  const afterElimination = buildCoachEvaluationContext(room, {
    coachId: "coach-a",
    clubId: "A",
    appointment: appointment({ startedRound: 3 }),
  });
  assert.equal(afterElimination.factors.some((entry) => entry.code === "cup_eliminations"), false);
});
