import type { z } from 'zod';
export interface RankingQuery {
  season: string; search: string; clubFilter: string; nationalityFilter: string; positionFilter: string;
  ageFilter: 'all' | 'u21' | '22-25' | '26-30' | '31+';
  playerCategory: string; playerColumn: string; playerDirection: 'asc' | 'desc';
  clubCategory: string; clubColumn: string; clubDirection: 'asc' | 'desc';
  managerPeriod: 'current' | 'last5' | 'career'; managerTypeFilter: 'all' | 'human' | 'ai';
  managerClubFilter: string; managerNationalityFilter: string; managerStatusFilter: '' | 'employed' | 'unemployed' | 'dismissed';
  managerCategory: string; managerColumn: string; managerDirection: 'asc' | 'desc';
}
export const rankingQuerySchema: z.ZodType<RankingQuery>;
export function parseRankingQuery(input?: unknown): RankingQuery;
export function rankingQueryKey(input?: unknown): string;
