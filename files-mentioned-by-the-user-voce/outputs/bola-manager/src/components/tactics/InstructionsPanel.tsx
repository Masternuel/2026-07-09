import { ChevronsUp, CircleGauge, MoveHorizontal, Repeat2, Shield, Zap } from 'lucide-react';

export type InstructionKey = 'pressureLine' | 'width' | 'tempo' | 'pressing' | 'offensiveTransition' | 'defensiveTransition';
export type InstructionValues = Record<InstructionKey, string>;

interface InstructionsPanelProps {
  values: InstructionValues;
  onChange: (key: InstructionKey, value: string) => void;
}

const controls: Array<{ key: InstructionKey; label: string; icon: typeof Shield; options: string[] }> = [
  { key: 'pressureLine', label: 'Linha de pressão', icon: ChevronsUp, options: ['Baixa', 'Média', 'Alta', 'Muito alta'] },
  { key: 'width', label: 'Largura', icon: MoveHorizontal, options: ['Estreita', 'Normal', 'Ampla'] },
  { key: 'tempo', label: 'Ritmo', icon: CircleGauge, options: ['Lento', 'Normal', 'Rápido', 'Muito rápido'] },
  { key: 'pressing', label: 'Pressão', icon: Zap, options: ['Passiva', 'Moderada', 'Intensa', 'Agressiva'] },
  { key: 'offensiveTransition', label: 'Transição ofensiva', icon: Repeat2, options: ['Construir', 'Direto', 'Contra-ataque'] },
  { key: 'defensiveTransition', label: 'Transição defensiva', icon: Shield, options: ['Pressão imediata', 'Organizar', 'Recuar'] },
];

export function InstructionsPanel({ values, onChange }: InstructionsPanelProps) {
  return (
    <div className="instructions-panel">
      {controls.map((control) => (
        <div className="instruction-control" key={control.key}>
          <label><control.icon size={14} /> {control.label}</label>
          <div className="instruction-options">
            {control.options.map((option) => (
              <button key={option} aria-pressed={values[control.key] === option} onClick={() => onChange(control.key, option)}>{option}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
