import { useState } from 'react';
import type { Formation, Player } from '../../types';
import { cx } from '../../utils/formatters';

interface TacticsFieldProps {
  formation: Formation;
  lineup: Player[];
  compact?: boolean;
  onSwap?: (fromIndex: number, toIndex: number) => void;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
}

export function TacticsField({ formation, lineup, compact = false, onSwap, selectedIndex, onSelect }: TacticsFieldProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <div className={cx('tactics-field', compact && 'tactics-field--compact')}>
      <div className="pitch-markings" aria-hidden="true">
        <span className="pitch-half" /><span className="pitch-circle" /><span className="pitch-box pitch-box--top" />
        <span className="pitch-box pitch-box--bottom" /><span className="pitch-spot pitch-spot--top" /><span className="pitch-spot pitch-spot--bottom" />
      </div>
      {formation.slots.map((slot, index) => {
        const activePlayer = lineup[index];
        return (
          <button
            key={slot.id}
            className={cx('pitch-player', selectedIndex === index && 'selected', dragIndex === index && 'dragging')}
            style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            draggable={Boolean(onSwap)}
            onDragStart={() => setDragIndex(index)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => { if (dragIndex !== null && dragIndex !== index) onSwap?.(dragIndex, index); setDragIndex(null); }}
            onClick={() => onSelect?.(index)}
            aria-label={`${slot.role}: ${activePlayer?.name ?? 'posição vazia'}`}
          >
            <span className="pitch-player__disc">{activePlayer?.number ?? '–'}</span>
            <span className="pitch-player__name">{activePlayer?.shortName ?? slot.role}</span>
            {!compact && <span className="pitch-player__role">{slot.role}</span>}
          </button>
        );
      })}
    </div>
  );
}
