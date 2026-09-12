import { z } from 'zod';

const text = z.string().trim().max(160).default('');
const direction = z.enum(['asc', 'desc']).default('desc');
export const rankingQuerySchema = z.object({
  season: z.string().regex(/^(current|\d{1,4})$/).default('current'),
  search: z.string().trim().max(120).default(''),
  clubFilter: text, nationalityFilter: text, positionFilter: text,
  ageFilter: z.enum(['all', 'u21', '22-25', '26-30', '31+']).default('all'),
  playerCategory: z.enum(['goals', 'assists', 'contributions', 'rating', 'minutes', 'appearances', 'keyPasses', 'tackles', 'saves', 'cleanSheets', 'cards']).default('goals'),
  playerColumn: z.enum(['player', 'club', 'position', 'age', 'nationality', 'goals', 'assists', 'goalContributions', 'averageRating', 'overall', 'minutes', 'appearances', 'starts', 'keyPasses', 'bigChancesCreated', 'tackles', 'saves', 'cleanSheets', 'yellowCards', 'redCards', 'minutesPerGoal', 'penaltyGoals', 'nonPenaltyGoals', 'ownGoals', 'minutesPerAssist', 'minutesPerContribution', 'contributionsPerGame', 'clubGoalParticipationPercent', 'shots', 'shotsOnTarget', 'goalsConceded', 'rankChange']).default('goals'),
  playerDirection: direction,
  clubCategory: z.enum(['points', 'squadValue', 'averagePlayerValue', 'payroll', 'reputation', 'form', 'possession', 'attendance', 'wins', 'attack', 'defense']).default('squadValue'),
  clubColumn: z.enum(['club', 'playerCount', 'played', 'wins', 'draws', 'losses', 'goalsFor', 'goalsAgainst', 'goalDifference', 'points', 'squadValue', 'valueChange', 'averagePlayerValue', 'payroll', 'possession', 'attendance', 'form', 'reputation']).default('squadValue'),
  clubDirection: direction,
  managerPeriod: z.enum(['current', 'last5', 'career']).default('current'),
  managerTypeFilter: z.enum(['all', 'human', 'ai']).default('all'),
  managerClubFilter: text, managerNationalityFilter: text,
  managerStatusFilter: z.enum(['', 'employed', 'unemployed', 'dismissed']).default(''),
  managerCategory: z.enum(['points', 'wins', 'performance', 'rankingPoints', 'titles', 'reputation']).default('points'),
  managerColumn: z.enum(['manager', 'type', 'club', 'nationality', 'status', 'played', 'wins', 'draws', 'losses', 'goalsFor', 'goalsAgainst', 'goalDifference', 'points', 'performance', 'form', 'preferredFormation', 'reputation', 'titles', 'rankingPoints', 'rankChange']).default('points'),
  managerDirection: direction,
}).strict();

export function parseRankingQuery(input = {}) { return rankingQuerySchema.parse(input); }
export function rankingQueryKey(query) { return JSON.stringify(parseRankingQuery(query)); }
