import type { PlayerPosition } from '../src/types';

export type FormationId = '4-3-3' | '4-4-2' | '3-5-2' | '4-2-3-1' | '5-3-2' | '3-4-3' | '4-1-4-1' | '5-4-1' | '4-3-2-1';
export const FORMATION_ROLES: Readonly<Record<FormationId, readonly PlayerPosition[]>>;
export const FORMATION_IDS: readonly FormationId[];
export const DEFAULT_FORMATION_ID: FormationId;
