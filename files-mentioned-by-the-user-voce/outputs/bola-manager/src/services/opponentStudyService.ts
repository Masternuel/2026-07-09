import { z } from 'zod';
import type { OpponentStudy } from '../types';

const depth = z.enum(['quick', 'standard', 'deep']);
const text = z.string().min(1);
const percent = z.number().finite().min(0).max(100);
const date = text.refine((value) => Number.isFinite(Date.parse(value)));
const player = z.object({
  id: text, name: text, position: z.enum(['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MEI', 'PD', 'PE', 'ATA']),
  rating: z.number().finite(), reason: text,
});
const insight = z.object({ code: text, label: text, detail: text });
const schema: z.ZodType<OpponentStudy> = z.object({
  fixtureId: text.nullable(), opponentClubId: text, viewerClubId: text, opponentName: text,
  depth, effectiveDepth: z.enum(['none', 'quick', 'standard', 'deep']),
  dataStatus: z.enum(['unknown', 'partial', 'complete']), confidence: percent,
  scoutLevel: z.number().int().min(0).max(5), revision: z.number().int().nonnegative(),
  estimatedStudyHours: z.number().finite().nonnegative(), scoutingSpeedMultiplier: z.number().finite().positive(),
  source: z.enum(['observed', 'estimated']), probableFormation: text.nullable(), style: text.nullable(),
  mentality: text.nullable(), pressing: text.nullable(), marking: text.nullable(),
  knowledge: z.object({
    status: z.enum(['unknown', 'studying', 'ready', 'expired', 'known']), progress: percent,
    readyAt: date.nullable(), requestedDepth: depth.optional(),
  }).refine((value) => value.status !== 'studying' || value.readyAt !== null),
  probableLineup: z.array(player), dangerousPlayers: z.array(player),
  sectors: z.array(z.object({
    key: z.enum(['goalkeeping', 'defense', 'midfield', 'attack', 'physical']), label: text,
    rating: z.number().finite().min(0).max(20), level: z.enum(['strong', 'balanced', 'vulnerable']),
  })),
  strengths: z.array(insight), weaknesses: z.array(insight), recommendations: z.array(insight), generatedAt: date.optional(),
});

export function parseOpponentStudy(response: unknown, clubId?: string, viewerClubId?: string): OpponentStudy | null {
  const envelope = z.object({ study: schema.nullable() }).safeParse(response);
  const study = envelope.success ? envelope.data.study : undefined;
  if (study === null && !clubId) return null;
  if (!study || clubId && study.opponentClubId.toUpperCase() !== clubId.toUpperCase()
    || viewerClubId && study.viewerClubId.toUpperCase() !== viewerClubId.toUpperCase()) {
    throw new Error('Relatório inválido ou de outro clube. Atualize o estudo.');
  }
  return study;
}
