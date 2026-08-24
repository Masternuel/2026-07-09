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
  {
    id: '5-3-2',
    name: '5\u20133\u20132',
    description: 'Bloco baixo e sa\u00edda pelos alas',
    slots: [
      slot('gk', 'GOL', 50, 91), slot('lwb', 'LE', 10, 67), slot('cb1', 'ZAG', 28, 77), slot('cb2', 'ZAG', 50, 81), slot('cb3', 'ZAG', 72, 77), slot('rwb', 'LD', 90, 67),
      slot('dm', 'VOL', 50, 57), slot('cm1', 'MC', 30, 45), slot('cm2', 'MC', 70, 45),
      slot('st1', 'ATA', 38, 19), slot('st2', 'ATA', 62, 19),
    ],
  },
  {
    id: '3-4-3',
    name: '3\u20134\u20133',
    description: 'Press\u00e3o agressiva com tr\u00eas atacantes',
    slots: [
      slot('gk', 'GOL', 50, 91), slot('cb1', 'ZAG', 24, 76), slot('cb2', 'ZAG', 50, 80), slot('cb3', 'ZAG', 76, 76),
      slot('lm', 'PE', 13, 51), slot('cm1', 'MC', 38, 55), slot('cm2', 'MC', 62, 55), slot('rm', 'PD', 87, 51),
      slot('lw', 'PE', 19, 22), slot('st', 'ATA', 50, 15), slot('rw', 'PD', 81, 22),
    ],
  },
  {
    id: '4-1-4-1',
    name: '4\u20131\u20134\u20131',
    description: 'Prote\u00e7\u00e3o central e ocupa\u00e7\u00e3o dos corredores',
    slots: [
      slot('gk', 'GOL', 50, 91), slot('lb', 'LE', 15, 72), slot('cb1', 'ZAG', 38, 78), slot('cb2', 'ZAG', 62, 78), slot('rb', 'LD', 85, 72),
      slot('dm', 'VOL', 50, 60), slot('lm', 'PE', 15, 43), slot('cm1', 'MC', 38, 47), slot('cm2', 'MC', 62, 47), slot('rm', 'PD', 85, 43),
      slot('st', 'ATA', 50, 16),
    ],
  },
  {
    id: '5-4-1',
    name: '5\u20134\u20131',
    description: 'Defesa compacta e contra-ataque',
    slots: [
      slot('gk', 'GOL', 50, 91), slot('lwb', 'LE', 10, 67), slot('cb1', 'ZAG', 28, 77), slot('cb2', 'ZAG', 50, 81), slot('cb3', 'ZAG', 72, 77), slot('rwb', 'LD', 90, 67),
      slot('lm', 'PE', 16, 45), slot('cm1', 'MC', 39, 50), slot('cm2', 'MC', 61, 50), slot('rm', 'PD', 84, 45),
      slot('st', 'ATA', 50, 17),
    ],
  },
  {
    id: '4-3-2-1',
    name: '4\u20133\u20132\u20131',
    description: 'Meias por dentro atr\u00e1s do atacante',
    slots: [
      slot('gk', 'GOL', 50, 91), slot('lb', 'LE', 15, 72), slot('cb1', 'ZAG', 38, 78), slot('cb2', 'ZAG', 62, 78), slot('rb', 'LD', 85, 72),
      slot('dm', 'VOL', 50, 61), slot('cm1', 'MC', 31, 51), slot('cm2', 'MC', 69, 51),
      slot('am1', 'MEI', 36, 32), slot('am2', 'MEI', 64, 32), slot('st', 'ATA', 50, 14),
    ],
  },
];
