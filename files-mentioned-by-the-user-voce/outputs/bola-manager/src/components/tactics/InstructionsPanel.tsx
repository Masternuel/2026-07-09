import { ChevronsUp, CircleGauge, MoveHorizontal, Repeat2, Shield, Zap } from 'lucide-react';
import type { TeamInstructions } from '../../types';

export type InstructionKey = keyof TeamInstructions;
export type InstructionValues = TeamInstructions;
export type InstructionValue = TeamInstructions[InstructionKey];

interface InstructionsPanelProps {
  values: InstructionValues;
  onChange: (key: InstructionKey, value: InstructionValue) => void;
}

interface InstructionControl {
  key: InstructionKey;
  label: string;
  icon: typeof Shield;
  options: Array<{ value: InstructionValue; label: string }>;
}

const controls: InstructionControl[] = [
  {
    key: 'pressureLine',
    label: 'Linha de press\u00e3o',
    icon: ChevronsUp,
    options: [
      { value: 'very-low', label: 'Muito baixa' },
      { value: 'low', label: 'Baixa' },
      { value: 'medium', label: 'M\u00e9dia' },
      { value: 'high', label: 'Alta' },
      { value: 'very-high', label: 'Muito alta' },
    ],
  },
  {
    key: 'width',
    label: 'Largura',
    icon: MoveHorizontal,
    options: [
      { value: 'very-narrow', label: 'Muito estreita' },
      { value: 'narrow', label: 'Estreita' },
      { value: 'normal', label: 'Normal' },
      { value: 'wide', label: 'Ampla' },
      { value: 'very-wide', label: 'Muito ampla' },
    ],
  },
  {
    key: 'tempo',
    label: 'Ritmo',
    icon: CircleGauge,
    options: [
      { value: 'very-slow', label: 'Muito lento' },
      { value: 'slow', label: 'Lento' },
      { value: 'normal', label: 'Normal' },
      { value: 'fast', label: 'R\u00e1pido' },
      { value: 'very-fast', label: 'Muito r\u00e1pido' },
    ],
  },
  {
    key: 'pressing',
    label: 'Press\u00e3o',
    icon: Zap,
    options: [
      { value: 'passive', label: 'Passiva' },
      { value: 'moderate', label: 'Moderada' },
      { value: 'intense', label: 'Intensa' },
      { value: 'aggressive', label: 'Agressiva' },
    ],
  },
  {
    key: 'offensiveTransition',
    label: 'Transi\u00e7\u00e3o ofensiva',
    icon: Repeat2,
    options: [
      { value: 'build-up', label: 'Construir' },
      { value: 'direct', label: 'Direto' },
      { value: 'counter', label: 'Contra-ataque r\u00e1pido' },
    ],
  },
  {
    key: 'defensiveTransition',
    label: 'Transi\u00e7\u00e3o defensiva',
    icon: Shield,
    options: [
      { value: 'counter-press', label: 'Press\u00e3o imediata' },
      { value: 'regroup', label: 'Organizar' },
      { value: 'drop', label: 'Recuar' },
    ],
  },
];

export function InstructionsPanel({ values, onChange }: InstructionsPanelProps) {
  return (
    <div className="instructions-panel">
      {controls.map((control) => (
        <div className="instruction-control" key={control.key}>
          <label><control.icon size={14} /> {control.label}</label>
          <div className="instruction-options">
            {control.options.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={values[control.key] === option.value}
                onClick={() => onChange(control.key, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
