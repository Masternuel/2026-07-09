import assert from "node:assert/strict";
import test from "node:test";
import { ensureCoachCareerState } from "../game/career.mjs";
import {
  buildLeagueRankingTimeline,
  compactLeagueRankingTimeline,
  expandCompactLeagueRankingTimeline,
} from "../game/rankingTimeline.mjs";
import { buildRoomRankings } from "../services/rankings.mjs";

const clubs = [
  {
    id: "A",
    code: "AUR",
    name: "Aurora",
    reputation: 12,
    headCoach: { id: "ai-coach:aurora", name: "Técnico Aurora", nationality: "BRA" },
  },
  {
    id: "B",
    code: "BOR",
    name: "Boreal",
    reputation: 16,
    headCoach: { id: "boreal", name: "Técnico Boreal", nationality: "ARG" },
  },
];
const league = { id: "L1", name: "Liga", active: true, clubs };
const fixtures = [
  { leagueFixtureId: "r1", leagueId: "L1", round: 1, homeClubId: "A", awayClubId: "B" },
  { leagueFixtureId: "r2", leagueId: "L1", round: 2, homeClubId: "B", awayClubId: "A" },
  { leagueFixtureId: "r3", leagueId: "L1", round: 3, homeClubId: "A", awayClubId: "B" },
];
const results = [
  { leagueFixtureId: "r1", score: [2, 0], completedAt: "2026-01-01T00:00:00.000Z" },
  { leagueFixtureId: "r2", score: [1, 0], completedAt: "2026-01-08T00:00:00.000Z" },
  { leagueFixtureId: "r3", score: [3, 1], completedAt: "2026-01-15T00:00:00.000Z" },
];

function room() {
  return {
    code: "COACH",
    ownerId: "human",
    currentSeason: 1,
    seasonYear: 2026,
    lastCompletedRound: { round: 0 },
    competitionCatalog: [structuredClone(league)],
    leagueFixtureSchedule: structuredClone(fixtures),
    leagueMatchResults: structuredClone(results),
    managers: [{ id: "human", name: "Emanuel", clubId: "A" }],
    playerStates: [],
  };
}

const catalogStore = {
  async listPlayers(clubId) {
    return {
      players: [{ id: `${clubId}-1`, clubId, name: `Jogador ${clubId}`, position: "MC", overall: 10 }],
      count: 1,
      source: "test",
    };
  },
};

test("carreira preserva identidades, metadata e mudanças de clube por rodada", () => {
  const value = room();
  value.coachCareerState = { version: 1, awards: [{ id: "award-1", managerId: "human" }], coaches: [] };
  assert.equal(ensureCoachCareerState(value, new Date("2026-01-01T00:00:00.000Z")), true);
  assert.deepEqual(value.coachCareerState.awards, [{ id: "award-1", managerId: "human" }]);
  assert.equal(value.coachCareerState.coaches.some((coach) => coach.id === "ai-coach:ai-coach:aurora"), false);
  assert.equal(value.coachCareerState.coaches.some((coach) => coach.id === "ai-coach:boreal"), true);

  value.lastCompletedRound = { round: 2 };
  value.managers[0].clubId = "B";
  assert.equal(ensureCoachCareerState(value, new Date("2026-01-10T00:00:00.000Z")), true);
  const human = value.coachCareerState.coaches.find((coach) => coach.id === "human");
  assert.deepEqual(human.assignments.map(({ clubId, startedRound, endedRound }) => (
    { clubId, startedRound, endedRound }
  )), [
    { clubId: "A", startedRound: 1, endedRound: 2 },
    { clubId: "B", startedRound: 3, endedRound: null },
  ]);
  assert.equal(value.coachCareerState.coaches.some((coach) => coach.id === "ai-coach:aurora"), true);
  assert.equal(value.coachCareerState.coaches.some((coach) => coach.id === "ai-coach:ai-coach:aurora"), false);
  assert.equal(ensureCoachCareerState(value, new Date("2026-01-10T00:00:00.000Z")), false);

  value.lastCompletedRound = { round: 3 };
  value.managers[0].clubId = null;
  value.managers[0].status = "dismissed";
  ensureCoachCareerState(value, new Date("2026-01-16T00:00:00.000Z"));
  const dismissed = value.coachCareerState.coaches.find((coach) => coach.id === "human");
  assert.equal(dismissed.currentClubId, null);
  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissed.assignments.at(-1).endedRound, 3);
});

test("timeline e arquivo atribuem somente estatísticas do mandato", () => {
  const value = room();
  ensureCoachCareerState(value, new Date("2026-01-01T00:00:00.000Z"));
  value.lastCompletedRound = { round: 2 };
  value.managers[0].clubId = "B";
  ensureCoachCareerState(value, new Date("2026-01-10T00:00:00.000Z"));

  const timeline = buildLeagueRankingTimeline({
    leagues: [league],
    fixtures,
    results,
    managers: value.managers,
    coachCareerState: value.coachCareerState,
    seasonNumber: 1,
    seasonYear: 2026,
  });
  const human = timeline.filter((entry) => entry.type === "manager" && entry.managerId === "human");
  assert.deepEqual(human.map(({ round, clubId, played, points, tenureStartedRound }) => ({
    round, clubId, played, points, tenureStartedRound,
  })), [
    { round: 1, clubId: "A", played: 1, points: 3, tenureStartedRound: 1 },
    { round: 2, clubId: "A", played: 2, points: 3, tenureStartedRound: 1 },
    { round: 3, clubId: "B", played: 1, points: 0, tenureStartedRound: 3 },
  ]);

  const restored = expandCompactLeagueRankingTimeline(compactLeagueRankingTimeline(timeline));
  const restoredHuman = restored.filter((entry) => entry.type === "manager" && entry.managerId === "human");
  assert.deepEqual(restoredHuman.map(({ round, clubId, played, points, tenureStartedRound }) => ({
    round, clubId, played, points, tenureStartedRound,
  })), human.map(({ round, clubId, played, points, tenureStartedRound }) => ({
    round, clubId, played, points, tenureStartedRound,
  })));
});

test("treinador desempregado continua no ranking sem herdar campanha posterior", async () => {
  const value = room();
  value.leagueMatchResults = results.slice(0, 2);
  ensureCoachCareerState(value, new Date("2026-01-01T00:00:00.000Z"));
  value.lastCompletedRound = { round: 2 };
  value.managers[0].clubId = null;
  value.managers[0].status = "unemployed";
  ensureCoachCareerState(value, new Date("2026-01-10T00:00:00.000Z"));

  const rankings = await buildRoomRankings({
    room: value,
    catalogStore,
    competitionId: "L1",
    viewerId: "human",
  });
  const human = rankings.managers.find((manager) => manager.id === "human");
  assert.ok(human);
  assert.equal(human.clubId, null);
  assert.equal(human.status, "unemployed");
  assert.equal(human.played, 2);
  assert.equal(human.points, 3);
  assert.equal(human.careerHistory[0].played, 2);
  assert.equal(human.seasonStats[0].rankingPoints, human.rankingPoints);
  assert.equal(human.matchHistory.length, 2);
  assert.equal(human.matchHistory.every((match) => match.opponentManagerId === "ai-coach:boreal"), true);
});

test("migração pública preserva mandato ao passar por interino, renúncia e desemprego", () => {
  const value = room();
  value.coachCareerState = {
    version: 1,
    publicMetadata: { source: "career-history" },
    coaches: [],
  };
  ensureCoachCareerState(value, new Date("2026-01-01T00:00:00.000Z"));

  value.lastCompletedRound = { round: 1 };
  value.managers[0].status = "interim";
  ensureCoachCareerState(value, new Date("2026-01-05T00:00:00.000Z"));
  let human = value.coachCareerState.coaches.find((coach) => coach.id === "human");
  assert.equal(human.status, "interim");
  assert.equal(human.currentClubId, "A");
  assert.equal(human.assignments.length, 1);
  assert.equal(human.assignments[0].endedRound, null);

  value.lastCompletedRound = { round: 2 };
  value.managers[0].clubId = null;
  value.managers[0].status = "resigned";
  ensureCoachCareerState(value, new Date("2026-01-10T00:00:00.000Z"));
  human = value.coachCareerState.coaches.find((coach) => coach.id === "human");
  assert.equal(human.status, "resigned");
  assert.equal(human.currentClubId, null);
  assert.equal(human.assignments.length, 1);
  assert.equal(human.assignments[0].clubId, "A");
  assert.equal(human.assignments[0].startedRound, 1);
  assert.equal(human.assignments[0].endedRound, 2);
  assert.equal(human.assignments[0].endedAt, "2026-01-10T00:00:00.000Z");
  const resignedHistory = structuredClone(human.assignments);

  value.lastCompletedRound = { round: 3 };
  value.managers[0].status = "unemployed";
  ensureCoachCareerState(value, new Date("2026-01-15T00:00:00.000Z"));
  human = value.coachCareerState.coaches.find((coach) => coach.id === "human");
  assert.equal(human.status, "unemployed");
  assert.equal(human.currentClubId, null);
  assert.deepEqual(human.assignments, resignedHistory, "troca de status não reabre nem apaga mandato encerrado");
  assert.deepEqual(value.coachCareerState.publicMetadata, { source: "career-history" });

  const reloaded = structuredClone(value);
  assert.equal(ensureCoachCareerState(reloaded, new Date("2026-01-15T00:00:00.000Z")), false);
  const afterReload = reloaded.coachCareerState.coaches.find((coach) => coach.id === "human");
  assert.equal(afterReload.status, "unemployed");
  assert.deepEqual(afterReload.assignments, resignedHistory);
  assert.deepEqual(reloaded.coachCareerState.publicMetadata, { source: "career-history" });
});

test("carreira normaliza e preserva perfil rico de treinador em saves antigos", () => {
  const value = room();
  value.managers = [];
  value.competitionCatalog[0].clubs[0].headCoach = {
    id: "ai-coach:aurora",
    name: "Treinador Completo",
    nationality: "BRA",
    license: "UEFA A",
    licenses: ["UEFA A", "CONMEBOL A"],
    equivalentLicenses: ["CONMEBOL A", "conmebol a", "A"],
    languages: { Português: "native", Espanhol: "advanced" },
    experienceYears: "12",
    youthYears: 3,
    professionalYears: 9,
    internationalYears: 2,
    currentDivisionExperienceYears: 4,
    countriesWorked: ["Brasil", "Portugal", "brasil"],
    leaguesWorked: ["BRA-1", "POR-1", "bra-1"],
    achievements: {
      nationalTitles: "2",
      cups: 1,
      project: "formacao",
    },
    youthDevelopment: "high",
    trainingIntensity: "intense",
    ambition: 87,
    adaptability: 72,
    salaryExpectation: "450000",
    marketReputation: 82,
    playStyle: "possession",
    playStyles: ["pressing", "Possession"],
    formation: "4-3-3",
    preferredFormations: ["4-2-3-1", "4-3-3"],
    countryKnowledge: ["Brasil", "Portugal"],
    customProfileField: { source: "catalog" },
  };

  assert.equal(ensureCoachCareerState(value, new Date("2026-01-01T00:00:00.000Z")), true);
  const coach = value.coachCareerState.coaches.find(({ id }) => id === "ai-coach:aurora");
  assert.ok(coach);
  assert.equal(coach.license, "UEFA A");
  assert.equal(coach.licenseTier, "A");
  assert.deepEqual(coach.equivalentLicenses, ["CONMEBOL A", "A"]);
  assert.deepEqual(coach.languages, ["Português", "Espanhol"]);
  assert.equal(coach.yearsExperience, 12);
  assert.equal(coach.youthExperienceYears, 3);
  assert.equal(coach.professionalExperienceYears, 9);
  assert.equal(coach.internationalExperienceYears, 2);
  assert.equal(coach.divisionExperienceYears, 4);
  assert.deepEqual(coach.workedCountries, ["Brasil", "Portugal"]);
  assert.deepEqual(coach.workedLeagueIds, ["BRA-1", "POR-1"]);
  assert.deepEqual(coach.achievements, {
    nationalTitles: 2,
    cups: 1,
    project: "formacao",
  });
  assert.equal(coach.youthDevelopment, 75);
  assert.equal(coach.trainingIntensity, 90);
  assert.equal(coach.ambition, 87);
  assert.equal(coach.adaptability, 72);
  assert.equal(coach.expectedSalary, 450_000);
  assert.equal(coach.marketReputation, 82);
  assert.equal(coach.style, "possession");
  assert.deepEqual(coach.playStyles, ["pressing", "Possession"]);
  assert.equal(coach.preferredFormation, "4-3-3");
  assert.deepEqual(coach.preferredFormations, ["4-2-3-1", "4-3-3"]);
  assert.deepEqual(coach.countryKnowledge, { Brasil: 100, Portugal: 100 });
  assert.deepEqual(coach.customProfileField, { source: "catalog" });

  coach.assignments[0].customAssignmentField = "preservar";
  const reloaded = structuredClone(value);
  assert.equal(ensureCoachCareerState(reloaded, new Date("2026-01-01T00:00:00.000Z")), false);
  const afterReload = reloaded.coachCareerState.coaches.find(({ id }) => id === "ai-coach:aurora");
  assert.deepEqual(afterReload.customProfileField, { source: "catalog" });
  assert.equal(afterReload.assignments[0].customAssignmentField, "preservar");
  assert.deepEqual(afterReload, coach);
});

test("carreira converte notas legadas de 1-20 para 0-100", () => {
  const value = room();
  value.managers = [];
  value.competitionCatalog[0].clubs[0].headCoach = {
    id: "ai-coach:aurora",
    name: "Treinador Legado",
    youthDevelopment: 15,
    trainingIntensity: 18,
    ambition: 16,
    adaptability: 14,
  };

  assert.equal(ensureCoachCareerState(value, new Date("2026-01-01T00:00:00.000Z")), true);
  const coach = value.coachCareerState.coaches.find(({ id }) => id === "ai-coach:aurora");
  assert.ok(coach);
  assert.equal(coach.youthDevelopment, 75);
  assert.equal(coach.trainingIntensity, 90);
  assert.equal(coach.ambition, 80);
  assert.equal(coach.adaptability, 70);

  const reloaded = structuredClone(value);
  assert.equal(ensureCoachCareerState(reloaded, new Date("2026-01-01T00:00:00.000Z")), false);
  assert.deepEqual(
    Object.fromEntries(
      ["youthDevelopment", "trainingIntensity", "ambition", "adaptability"]
        .map((field) => [field, reloaded.coachCareerState.coaches
          .find(({ id }) => id === "ai-coach:aurora")[field]]),
    ),
    {
      youthDevelopment: 75,
      trainingIntensity: 90,
      ambition: 80,
      adaptability: 70,
    },
  );
});
