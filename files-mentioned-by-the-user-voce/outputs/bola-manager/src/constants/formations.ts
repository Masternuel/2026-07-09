import type { Formation, FormationSlot } from '../types';

const slot = (id: string, role: FormationSlot['role'], x: number, y: number): FormationSlot => ({ id, role, x, y });

export const formations: Formation[] = [
  {
    id: '4-3-3',
    name: '4–3–3',
    description: 'Amplitude e pressão alta',
    slots: [
      slot('gk', 'GOL', 50, 91), slot('lb', 'LE', 15, 72), slot('cb1', 'ZAG', 38, 78), slot('cb2', 'ZAG', 62, 78), slot('rb', 'LD', 85, 72),
      slot('dm', 'VOL', 50, 58), slot('cm1', 'MC', 29, 48), slot('cm2', 'MC', 71, 48),
      slot('lw', 'PE', 18, 23), slot('st', 'ATA', 50, 16), slot('rw', 'PD', 82, 23),
    ],
  },
  {
    id: '4-4-2',
    name: '4–4–2',
    description: 'Duas linhas compactas',
    slots: [
      slot('gk', 'GOL', 50, 91), slot('lb', 'LE', 15, 72), slot('cb1', 'ZAG', 38, 78), slot('cb2', 'ZAG', 62, 78), slot('rb', 'LD', 85, 72),
      slot('lm', 'PE', 15, 48), slot('cm1', 'MC', 38, 52), slot('cm2', 'MC', 62, 52), slot('rm', 'PD', 85, 48),
      slot('st1', 'ATA', 38, 20), slot('st2', 'ATA', 62, 20),
    ],
  },
  {
    id: '3-5-2',
    name: '3–5–2',
    description: 'Superioridade por dentro',
    slots: [
      slot('gk', 'GOL', 50, 91), slot('cb1', 'ZAG', 24, 74), slot('cb2', 'ZAG', 50, 79), slot('cb3', 'ZAG', 76, 74),
      slot('lwb', 'LE', 10, 48), slot('dm', 'VOL', 50, 59), slot('cm1', 'MC', 31, 46), slot('cm2', 'MC', 69, 46), slot('rwb', 'LD', 90, 48),
      slot('st1', 'ATA', 38, 20), slot('st2', 'ATA', 62, 20),
    ],
  },
  {
    id: '4-2-3-1',
    name: '4–2–3–1',
    description: 'Controle entre linhas',
    slots: [
      slot('gk', 'GOL', 50, 91), slot('lb', 'LE', 15, 72), slot('cb1', 'ZAG', 38, 78), slot('cb2', 'ZAG', 62, 78), slot('rb', 'LD', 85, 72),
      slot('dm1', 'VOL', 36, 58), slot('dm2', 'VOL', 64, 58), slot('lw', 'PE', 17, 35), slot('am', 'MEI', 50, 38), slot('rw', 'PD', 83, 35),
      slot('st', 'ATA', 50, 15),
    ],
  },
];
