import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCoachCareerHistorySummary,
  synchronizeCoachCareerHistory,
} from "../game/coachCareerHistory.mjs";

const NOW = "2027-03-01T12:00:00.000Z";

function roomFixture() {
  return {
    currentSeason: 2,
    seasonStartedAt: "2027-01-01T00:00:00.000Z",
    competitionCatalog: [{
      id: "BR-A",
      name: "Serie A",
      country: "Brasil",
      division: "Serie A",
      clubs: [
        { id: "A", name: "Aurora" },
        { id: "B", name: "Boreal" },
        { id: "C", name: "Celta" },
      ],
    }],
    coachCareerState: {
      coaches: [{
        id: "coach-a",
        name: "Ana",
        managerType: "human",
        status: "employed",
        currentClubId: "B",
        reputation: 64,
        assignments: [{
          clubId: "A",
          startedSeason: 1,
          startedRound: 1,
          startedAt: "2026-01-01T00:00:00.000Z",
          endedSeason: 1,
          endedRound: 2,
          endedAt: "2026-12-31T00:00:00.000Z",
          entryReason: "appointed",
          exitReason: "contract_expired",
        }, {
          clubId: "B",
          startedSeason: 2,
          startedRound: 1,
          startedAt: "2027-02-01T00:00:00.000Z",
          endedSeason: null,
          endedRound: null,
          endedAt: null,
          entryReason: "appointed",
          exitReason: null,
        }],
        reputationHistory: [{
          id: "rep-a",
          type: "title_won",
          occurredAt: "2026-12-20T00:00:00.000Z",
          clubId: "A",
          seasonNumber: 1,
          reputationBefore: 58,
          reputationAfter: 64,
          reputationDelta: 6,
          reasonLabel: "Titulo conquistado",
        }],
      }, {
        id: "coach-c",
        name: "Carlos",
        status: "employed",
        currentClubId: "C",
        reputation: 50,
        assignments: [{
          clubId: "C",
          startedSeason: 1,
          startedRound: 1,
          startedAt: "2026-01-01T00:00:00.000Z",
          endedSeason: null,
          endedRound: null,
          endedAt: null,
        }],
      }],
    },
    coachEmploymentState: {
      currentDate: NOW,
      contracts: [{
        id: "contract-a",
        coachId: "coach-a",
        clubId: "A",
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-12-31T00:00:00.000Z",
        endedAt: "2026-12-31T00:00:00.000Z",
        status: "expired",
        endReason: "contract_expired",
        wage: 100_000,
      }, {
        id: "contract-b-1",
        coachId: "coach-a",
        clubId: "B",
        startDate: "2027-02-01T00:00:00.000Z",
        endDate: "2028-02-01T00:00:00.000Z",
        endedAt: "2027-02-20T00:00:00.000Z",
        status: "replaced",
        endReason: "renewed_after_negotiation",
        wage: 150_000,
        renewalCount: 0,
      }, {
        id: "contract-b-2",
        coachId: "coach-a",
        clubId: "B",
        signedAt: "2027-02-20T00:00:00.000Z",
        startDate: "2027-02-20T00:00:00.000Z",
        endDate: "2029-02-20T00:00:00.000Z",
        status: "active",
        wage: 200_000,
        signingBonus: 50_000,
        renewalCount: 1,
      }],
      proposals: [{
        id: "proposal-b",
        coachId: "coach-a",
        clubId: "B",
        kind: "hiring",
        status: "accepted",
        wage: 150_000,
        durationYears: 2,
        createdAt: "2027-01-20T00:00:00.000Z",
        decisionHistory: [{
          id: "proposal-b-accepted",
          action: "offer_accepted",
          decidedAt: "2027-01-25T00:00:00.000Z",
          previousStatus: "pending",
          newStatus: "accepted",
        }],
      }],
      interviews: [{
        id: "interview-b",
        coachId: "coach-a",
        clubId: "B",
        proposalId: "proposal-b",
        status: "completed",
        scheduledAt: "2027-01-22T00:00:00.000Z",
        completedAt: "2027-01-23T00:00:00.000Z",
        evaluation: { overallScore: 80, recommendation: "hire", summary: "Boa aderencia." },
      }],
    },
    seasonHistory: [{
      seasonNumber: 1,
      completedAt: "2026-12-31T00:00:00.000Z",
      managerMatchHistory: [{
        fixtureId: "league-1",
        competitionId: "BR-A",
        round: 1,
        completedAt: "2026-03-01T00:00:00.000Z",
        homeClubId: "A",
        awayClubId: "C",
        homeManagerId: "coach-a",
        awayManagerId: "coach-c",
        score: [2, 0],
      }, {
        fixtureId: "league-2",
        competitionId: "BR-A",
        round: 2,
        completedAt: "2026-03-08T00:00:00.000Z",
        homeClubId: "C",
        awayClubId: "A",
        homeManagerId: "coach-c",
        awayManagerId: "coach-a",
        score: [1, 1],
      }],
      tournamentWinners: [{
        tournamentId: "BR-A",
        clubId: "A",
        managerId: "coach-a",
        wonRound: 2,
        wonAt: "2026-12-20T00:00:00.000Z",
      }],
      promotionMovements: [{
        clubId: "A",
        type: "promotion",
        fromDivisionId: "BR-B",
        toDivisionId: "BR-A",
        position: 1,
      }],
    }],
    leagueFixtureSchedule: [{
      leagueFixtureId: "league-3",
      leagueId: "BR-A",
      round: 1,
      homeClubId: "B",
      awayClubId: "C",
      scheduledAt: "2027-02-10T00:00:00.000Z",
    }],
    leagueMatchResults: [{
      leagueFixtureId: "league-3",
      score: [0, 1],
      completedAt: "2027-02-10T00:00:00.000Z",
    }],
    competitionSeason: {
      winners: [],
      fixtures: [{
        competitionFixtureId: "cup-1",
        competitionId: "CUP",
        tournamentId: "CUP",
        calendarRound: 2,
        homeClubId: "B",
        awayClubId: "A",
        status: "completed",
        completedAt: "2027-02-17T00:00:00.000Z",
        result: { score: [3, 2] },
      }],
    },
  };
}

test("sincroniza passagens, contratos, partidas e fatos reais sem duplicar", () => {
  const room = roomFixture();
  const state = room.coachEmploymentState;

  synchronizeCoachCareerHistory(room, state, NOW);
  const coach = room.coachCareerState.coaches.find(({ id }) => id === "coach-a");
  const first = coach.assignments[0];
  const current = coach.assignments[1];

  assert.match(first.id, /^coach-assignment-/);
  assert.equal(first.country, "Brasil");
  assert.equal(first.division, "Serie A");
  assert.deepEqual(first.metrics, {
    matches: 2,
    wins: 1,
    draws: 1,
    losses: 0,
    goalsFor: 3,
    goalsAgainst: 1,
    goalDifference: 2,
    points: 4,
    pointsPerGame: 2,
    winRate: 50,
    longestWinningStreak: 1,
    longestWinlessStreak: 1,
  });
  assert.equal(first.titles.length, 1);
  assert.equal(first.promotions, 1);
  assert.equal(current.matches, 2);
  assert.equal(current.wins, 1);
  assert.equal(current.losses, 1);
  assert.deepEqual(current.contractIds, ["contract-b-1", "contract-b-2"]);
  assert.equal(current.renewals.length, 1);
  assert.equal(current.initialSalary, 150_000);
  assert.equal(current.finalSalary, 200_000);
  assert.equal(coach.careerMatchHistory.length, 4);
  assert.equal(coach.negotiationHistory.length, 3);
  assert.equal(coach.careerReputationHistory.length, 1);
  assert.equal(coach.unemploymentPeriods.length, 1);
  assert.equal(coach.unemploymentPeriods[0].durationDays, 32);
  assert.equal(coach.careerHistorySummary.matches, 4);
  assert.equal(coach.careerHistorySummary.goalsFor, 6);
  assert.equal(coach.careerHistorySummary.goalsAgainst, 4);
  assert.equal(coach.careerHistorySummary.titles, 1);
  assert.equal(coach.careerHistorySummary.proposalsAccepted, 1);

  const synchronizedOnce = structuredClone(coach);
  synchronizeCoachCareerHistory(room, state, NOW);
  assert.deepEqual(coach, synchronizedOnce);
});

test("historico absorvido permanece quando fontes volateis somem", () => {
  const room = roomFixture();
  synchronizeCoachCareerHistory(room, room.coachEmploymentState, NOW);
  const coach = room.coachCareerState.coaches.find(({ id }) => id === "coach-a");
  const persistedCounts = {
    matches: coach.careerMatchHistory.length,
    negotiations: coach.negotiationHistory.length,
    reputation: coach.careerReputationHistory.length,
    timeline: coach.careerTimeline.length,
    contracts: coach.assignments.flatMap(({ contracts }) => contracts).length,
  };

  room.seasonHistory = [];
  room.leagueFixtureSchedule = [];
  room.leagueMatchResults = [];
  room.competitionSeason = { fixtures: [], winners: [] };
  room.coachEmploymentState.contracts = [];
  room.coachEmploymentState.proposals = [];
  room.coachEmploymentState.interviews = [];
  coach.reputationHistory = [];
  coach.careerConductHistory = [];

  synchronizeCoachCareerHistory(room, room.coachEmploymentState, NOW);
  assert.deepEqual({
    matches: coach.careerMatchHistory.length,
    negotiations: coach.negotiationHistory.length,
    reputation: coach.careerReputationHistory.length,
    timeline: coach.careerTimeline.length,
    contracts: coach.assignments.flatMap(({ contracts }) => contracts).length,
  }, persistedCounts);
  assert.equal(coach.careerHistorySummary.matches, 4);
});

test("builder nao muta save e nao inventa dados ausentes", () => {
  const room = roomFixture();
  delete room.competitionCatalog[0].country;
  delete room.competitionCatalog[0].division;
  room.coachEmploymentState.contracts = [];
  const before = structuredClone(room);

  const history = buildCoachCareerHistorySummary(
    room,
    room.coachEmploymentState,
    "coach-a",
    NOW,
  );

  assert.deepEqual(room, before);
  assert.equal(history.assignments[0].country, null);
  assert.equal(history.assignments[0].division, "Serie A");
  assert.equal(history.assignments[0].initialSalary, null);
  assert.equal(history.financialHistory.length, 0);
  assert.equal(
    buildCoachCareerHistorySummary(room, room.coachEmploymentState, "missing", NOW),
    null,
  );
});

test("registra finais de mata-mata para campeão e vice sem contar liga como final", () => {
  const room = roomFixture();
  room.tournamentCatalog = [{
    id: "CUP",
    name: "Copa Nacional",
    format: "knockout",
    participants: [
      { id: "B", name: "Boreal" },
      { id: "C", name: "Celta" },
    ],
  }];
  room.competitionSeason = {
    winners: [{ tournamentId: "CUP", clubId: "B" }],
    fixtures: [{
      competitionFixtureId: "cup-final",
      competitionId: "CUP",
      tournamentId: "CUP",
      calendarRound: 4,
      homeClubId: "B",
      awayClubId: "C",
      status: "completed",
      completedAt: "2027-02-28T00:00:00.000Z",
      result: { score: [2, 1], completedAt: "2027-02-28T00:00:00.000Z" },
    }],
  };

  synchronizeCoachCareerHistory(room, room.coachEmploymentState, NOW);
  const champion = room.coachCareerState.coaches.find(({ id }) => id === "coach-a");
  const runnerUp = room.coachCareerState.coaches.find(({ id }) => id === "coach-c");

  assert.equal(champion.careerHistorySummary.finals, 1);
  assert.equal(champion.careerHistorySummary.finalsWon, 1);
  assert.equal(runnerUp.careerHistorySummary.finals, 1);
  assert.equal(runnerUp.careerHistorySummary.finalsWon, 0);
  assert.equal(
    runnerUp.careerTimeline.some(({ type, description }) => (
      type === "FINAL_LOST" && description === "Copa Nacional"
    )),
    true,
  );
});
