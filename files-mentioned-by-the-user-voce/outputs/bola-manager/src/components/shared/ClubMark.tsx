import { cx } from '../../utils/formatters';

interface ClubMarkProps {
  code: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'shield' | 'round';
}

export function ClubMark({ code, color = '#c8ff3d', size = 'md', variant = 'shield' }: ClubMarkProps) {
  return (
    <span className={cx('club-mark', `club-mark--${size}`, `club-mark--${variant}`)} style={{ '--club-color': color } as React.CSSProperties} aria-label={code}>
      <span>{code}</span>
    </span>
  );
}
