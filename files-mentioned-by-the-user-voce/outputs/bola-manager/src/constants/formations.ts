import type { Formation, FormationSlot } from '../types';
import { FORMATION_IDS, FORMATION_ROLES, type FormationId } from '../../shared/formations.mjs';

// Visual metadata only (slot ids, pitch coordinates, labels). Slot roles come from
// shared/formations.mjs, the same table the server uses for rules (audit Q-04).
type SlotLayout = Omit<FormationSlot, 'role'>;
interface FormationLayout { id: FormationId; name: string; description: string; slots: SlotLayout[] }

const slot = (id: string, x: number, y: number): SlotLayout => ({ id, x, y });

const layouts: FormationLayout[] = [
  {
    id: '4-3-3',
    name: '4–3–3',
    description: 'Amplitude e pressão alta',
    slots: [
      slot('gk', 50, 91), slot('lb', 15, 72), slot('cb1', 38, 78), slot('cb2', 62, 78), slot('rb', 85, 72),
      slot('dm', 50, 58), slot('cm1', 29, 48), slot('cm2', 71, 48),
      slot('lw', 18, 23), slot('st', 50, 16), slot('rw', 82, 23),
    ],
  },
  {
    id: '4-4-2',
    name: '4–4–2',
    description: 'Duas linhas compactas',
    slots: [
      slot('gk', 50, 91), slot('lb', 15, 72), slot('cb1', 38, 78), slot('cb2', 62, 78), slot('rb', 85, 72),
      slot('lm', 15, 48), slot('cm1', 38, 52), slot('cm2', 62, 52), slot('rm', 85, 48),
      slot('st1', 38, 20), slot('st2', 62, 20),
    ],
  },
  {
    id: '3-5-2',
    name: '3–5–2',
    description: 'Superioridade por dentro',
    slots: [
      slot('gk', 50, 91), slot('cb1', 24, 74), slot('cb2', 50, 79), slot('cb3', 76, 74),
      slot('lwb', 10, 48), slot('dm', 50, 59), slot('cm1', 31, 46), slot('cm2', 69, 46), slot('rwb', 90, 48),
      slot('st1', 38, 20), slot('st2', 62, 20),
    ],
  },
  {
    id: '4-2-3-1',
    name: '4–2–3–1',
    description: 'Controle entre linhas',
    slots: [
      slot('gk', 50, 91), slot('lb', 15, 72), slot('cb1', 38, 78), slot('cb2', 62, 78), slot('rb', 85, 72),
      slot('dm1', 36, 58), slot('dm2', 64, 58), slot('lw', 17, 35), slot('am', 50, 38), slot('rw', 83, 35),
      slot('st', 50, 15),
    ],
  },
  {
    id: '5-3-2',
    name: '5\u20133\u20132',
    description: 'Bloco baixo e sa\u00edda pelos alas',
    slots: [
      slot('gk', 50, 91), slot('lwb', 10, 67), slot('cb1', 28, 77), slot('cb2', 50, 81), slot('cb3', 72, 77), slot('rwb', 90, 67),
      slot('dm', 50, 57), slot('cm1', 30, 45), slot('cm2', 70, 45),
      slot('st1', 38, 19), slot('st2', 62, 19),
    ],
  },
  {
    id: '3-4-3',
    name: '3\u20134\u20133',
    description: 'Press\u00e3o agressiva com tr\u00eas atacantes',
    slots: [
      slot('gk', 50, 91), slot('cb1', 24, 76), slot('cb2', 50, 80), slot('cb3', 76, 76),
      slot('lm', 13, 51), slot('cm1', 38, 55), slot('cm2', 62, 55), slot('rm', 87, 51),
      slot('lw', 19, 22), slot('st', 50, 15), slot('rw', 81, 22),
    ],
  },
  {
    id: '4-1-4-1',
    name: '4\u20131\u20134\u20131',
    description: 'Prote\u00e7\u00e3o central e ocupa\u00e7\u00e3o dos corredores',
    slots: [
      slot('gk', 50, 91), slot('lb', 15, 72), slot('cb1', 38, 78), slot('cb2', 62, 78), slot('rb', 85, 72),
      slot('dm', 50, 60), slot('lm', 15, 43), slot('cm1', 38, 47), slot('cm2', 62, 47), slot('rm', 85, 43),
      slot('st', 50, 16),
    ],
  },
  {
    id: '5-4-1',
    name: '5\u20134\u20131',
    description: 'Defesa compacta e contra-ataque',
    slots: [
      slot('gk', 50, 91), slot('lwb', 10, 67), slot('cb1', 28, 77), slot('cb2', 50, 81), slot('cb3', 72, 77), slot('rwb', 90, 67),
      slot('lm', 16, 45), slot('cm1', 39, 50), slot('cm2', 61, 50), slot('rm', 84, 45),
      slot('st', 50, 17),
    ],
  },
  {
    id: '4-3-2-1',
    name: '4\u20133\u20132\u20131',
    description: 'Meias por dentro atr\u00e1s do atacante',
    slots: [
      slot('gk', 50, 91), slot('lb', 15, 72), slot('cb1', 38, 78), slot('cb2', 62, 78), slot('rb', 85, 72),
      slot('dm', 50, 61), slot('cm1', 31, 51), slot('cm2', 69, 51),
      slot('am1', 36, 32), slot('am2', 64, 32), slot('st', 50, 14),
    ],
  },
];

export const formations: Formation[] = layouts.map((layout) => {
  const roles = FORMATION_ROLES[layout.id];
  if (roles.length !== layout.slots.length) throw new Error(`Formation ${layout.id} has ${layout.slots.length} slots but ${roles.length} roles`);
  return { ...layout, slots: layout.slots.map((item, index) => ({ ...item, role: roles[index] })) };
});

if (layouts.length !== FORMATION_IDS.length || FORMATION_IDS.some((id, index) => layouts[index]?.id !== id)) {
  throw new Error('Formation layouts must cover shared FORMATION_IDS in the same order');
}
