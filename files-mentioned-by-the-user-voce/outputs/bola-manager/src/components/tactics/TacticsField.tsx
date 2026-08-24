import { useState, type DragEvent } from 'react';
import { StarPlayerMark } from '../shared/StarPlayerMark';
import type { Formation, Player } from '../../types';
import { cx } from '../../utils/formatters';
import { playerShirtNumberLabel } from '../../utils/playerDataAvailability';

interface TacticsFieldProps {
  formation: Formation;
  lineup: Array<Player | undefined>;
  compact?: boolean;
  onSwap?: (fromIndex: number, toIndex: number) => void;
  onBenchPlayerDrop?: (playerId: string, toIndex: number) => void;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
  onPlayerDoubleClick?: (player: Player) => void;
}

export const BENCH_PLAYER_DRAG_TYPE = 'application/x-bola-manager-player-id';
const LINEUP_SLOT_DRAG_TYPE = 'application/x-bola-manager-lineup-slot';

export function TacticsField({ formation, lineup, compact = false, onSwap, onBenchPlayerDrop, selectedIndex, onSelect, onPlayerDoubleClick }: TacticsFieldProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  function startLineupDrag(event: DragEvent<HTMLButtonElement>, index: number) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(LINEUP_SLOT_DRAG_TYPE, String(index));
    setDragIndex(index);
  }

  function dropPlayer(event: DragEvent<HTMLButtonElement>, index: number) {
    event.preventDefault();
    const benchPlayerId = event.dataTransfer.getData(BENCH_PLAYER_DRAG_TYPE);
    if (benchPlayerId) {
      onBenchPlayerDrop?.(benchPlayerId, index);
    } else {
      const transferredSlot = event.dataTransfer.getData(LINEUP_SLOT_DRAG_TYPE);
      const transferredIndex = transferredSlot === '' ? null : Number(transferredSlot);
      const fromIndex = transferredIndex !== null && Number.isInteger(transferredIndex) ? transferredIndex : dragIndex;
      if (fromIndex !== null && fromIndex !== index) onSwap?.(fromIndex, index);
    }
    setDragIndex(null);
    setDropIndex(null);
  }

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
            className={cx('pitch-player', selectedIndex === index && 'selected', dragIndex === index && 'dragging', dropIndex === index && 'drop-target')}
            style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            draggable={Boolean(onSwap && activePlayer)}
            onDragStart={(event) => startLineupDrag(event, index)}
            onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
            onDragEnter={() => setDropIndex(index)}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
            }}
            onDrop={(event) => dropPlayer(event, index)}
            onClick={() => onSelect?.(index)}
            onDoubleClick={(event) => {
              event.preventDefault();
              if (activePlayer) onPlayerDoubleClick?.(activePlayer);
            }}
            title={activePlayer ? `Duplo clique para ver os stats de ${activePlayer.shortName}` : `Selecionar posição ${slot.role}`}
            aria-label={`${slot.role}: ${activePlayer?.name ?? 'posição vazia'}${activePlayer?.isStar ? ', jogador estrela' : ''}`}
          >
            <span className="pitch-player__disc">{activePlayer ? playerShirtNumberLabel(activePlayer) : '–'}</span>
            <span className="pitch-player__name"><span>{activePlayer?.shortName ?? slot.role}</span>{activePlayer?.isStar && <StarPlayerMark />}</span>
            {!compact && <span className="pitch-player__role">{slot.role}</span>}
          </button>
        );
      })}
    </div>
  );
}
