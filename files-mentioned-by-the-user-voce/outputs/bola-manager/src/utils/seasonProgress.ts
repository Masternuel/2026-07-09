import type { Room } from '../types';

function fixtureKey(value: string | null | undefined) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

export interface SeasonProgress {
  currentRound: number;
  totalRounds: number;
  completedRounds: number;
  percent: number;
  hasSchedule: boolean;
  seasonNumber: number;
  seasonYear: number | null;
}

export function getSeasonProgress(room: Room | null | undefined): SeasonProgress {
  const fixtures = room?.fixtureSchedule ?? [];
  const completedIds = new Set((room?.completedFixtureIds ?? []).map(fixtureKey));
  const completedRounds = fixtures.length
    ? fixtures.filter((fixture) => completedIds.has(fixtureKey(fixture.fixtureId))).length
    : 0;
  const currentFixture = fixtures.find((fixture) => fixtureKey(fixture.fixtureId) === fixtureKey(room?.currentFixtureId))
    ?? fixtures.find((fixture) => !completedIds.has(fixtureKey(fixture.fixtureId)));
  const totalRounds = fixtures.reduce((largest, fixture) => Math.max(largest, fixture.round), 0);
  const currentRound = currentFixture?.round
    ?? (totalRounds ? Math.min(totalRounds, completedRounds + 1) : 1);

  return {
    currentRound: Math.max(1, currentRound),
    totalRounds: Math.max(1, totalRounds),
    completedRounds,
    percent: totalRounds ? Math.min(100, Math.round((completedRounds / totalRounds) * 100)) : 0,
    hasSchedule: totalRounds > 0,
    seasonNumber: Math.max(1, room?.currentSeason ?? 1),
    seasonYear: Number.isFinite(Number(room?.seasonYear)) && Number(room?.seasonYear) > 0
      ? Math.trunc(Number(room?.seasonYear))
      : null,
  };
}
