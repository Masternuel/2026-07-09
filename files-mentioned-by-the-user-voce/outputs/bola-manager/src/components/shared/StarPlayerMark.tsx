import { Star } from 'lucide-react';
import { cx } from '../../utils/formatters';

interface StarPlayerMarkProps {
  size?: 'sm' | 'md';
  className?: string;
}

export function StarPlayerMark({ size = 'sm', className }: StarPlayerMarkProps) {
  return (
    <span
      className={cx('star-player-mark', `star-player-mark--${size}`, className)}
      role="img"
      aria-label="Jogador estrela"
      title="Jogador estrela"
    >
      <Star aria-hidden="true" fill="currentColor" />
    </span>
  );
}
