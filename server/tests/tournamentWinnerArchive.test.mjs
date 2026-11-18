import assert from "node:assert/strict";
import test from "node:test";
import { archiveManagerMatchHistory, archiveTournamentWinners } from "../store/roomStore.mjs";

test("arquivo do torneio atribui o titulo ao treinador ativo na final", () => {
  const room = {
    currentSeason: 2,
    coachCareerState: {
      version: 1,
      coaches: [
        {
          id: "coach-champion",
          assignments: [{
            clubId: "A",
            startedSeason: 1,
            startedRound: 1,
            endedSeason: 2,
            endedRound: 5,
          }],
        },
        {
          id: "coach-successor",
          assignments: [{
            clubId: "A",
            startedSeason: 2,
            startedRound: 6,
            endedSeason: null,
            endedRound: null,
          }],
        },
      ],
    },
    competitionSeason: {
      winners: [{ tournamentId: "CUP", clubId: "A" }],
      fixtures: [
        {
          competitionFixtureId: "cup-final",
          tournamentId: "CUP",
          calendarRound: 5,
          round: 1,
          homeClubId: "A",
          awayClubId: "B",
          status: "completed",
          completedAt: "2027-08-08T19:00:00.000Z",
          result: { score: [2, 1] },
        },
      ],
    },
  };

  assert.deepEqual(archiveTournamentWinners(room), [{
    tournamentId: "CUP",
    clubId: "A",
    managerId: "coach-champion",
    wonRound: 5,
    wonAt: "2027-08-08T19:00:00.000Z",
    finalistClubIds: ["A", "B"],
    runnerUpClubId: "B",
  }]);
});

test("arquivo preserva vencedor legado quando nao ha partida decisiva", () => {
  const winner = { tournamentId: "LEGACY-CUP", clubId: "A" };
  assert.deepEqual(archiveTournamentWinners({
    currentSeason: 1,
    competitionSeason: { winners: [winner], fixtures: [] },
  }), [winner]);
});

test("arquivo preserva confrontos de treinadores humanos e IA por competicao", () => {
  const room = {
    currentSeason: 2,
    coachCareerState: {
      version: 1,
      coaches: [{
        id: "coach-a",
        assignments: [{ clubId: "A", startedSeason: 1, startedRound: 1, endedSeason: null, endedRound: null }],
      }, {
        id: "coach-b-old",
        assignments: [{ clubId: "B", startedSeason: 1, startedRound: 1, endedSeason: 2, endedRound: 3 }],
      }, {
        id: "coach-b-new",
        assignments: [{ clubId: "B", startedSeason: 2, startedRound: 4, endedSeason: null, endedRound: null }],
      }],
    },
    leagueFixtureSchedule: [{
      leagueFixtureId: "league-r3",
      leagueId: "L1",
      round: 3,
      homeClubId: "A",
      awayClubId: "B",
    }],
    leagueMatchResults: [{
      leagueFixtureId: "league-r3",
      score: [2, 0],
      completedAt: "2027-07-01T19:00:00.000Z",
    }],
    competitionSeason: {
      fixtures: [{
        competitionFixtureId: "cup-r4",
        tournamentId: "CUP",
        calendarRound: 4,
        round: 1,
        homeClubId: "B",
        awayClubId: "A",
        status: "completed",
        completedAt: "2027-07-08T19:00:00.000Z",
        result: { score: [1, 1] },
      }],
    },
  };

  assert.deepEqual(archiveManagerMatchHistory(room), [{
    fixtureId: "league-r3",
    competitionId: "L1",
    round: 3,
    completedAt: "2027-07-01T19:00:00.000Z",
    homeClubId: "A",
    awayClubId: "B",
    homeManagerId: "coach-a",
    awayManagerId: "coach-b-old",
    score: [2, 0],
  }, {
    fixtureId: "cup-r4",
    competitionId: "CUP",
    round: 4,
    completedAt: "2027-07-08T19:00:00.000Z",
    homeClubId: "B",
    awayClubId: "A",
    homeManagerId: "coach-b-new",
    awayManagerId: "coach-a",
    score: [1, 1],
  }]);
});
