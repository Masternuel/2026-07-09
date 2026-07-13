import { cx } from '../../utils/formatters';

interface ClubMarkProps {
  code: string;
  color?: string;
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'shield' | 'round';
}

export function ClubMark({ code, color = '#c8ff3d', imageUrl, size = 'md', variant = 'shield' }: ClubMarkProps) {
  return (
    <span className={cx('club-mark', `club-mark--${size}`, `club-mark--${variant}`)} style={{ '--club-color': color } as React.CSSProperties} aria-label={code}>
      {imageUrl && <img src={imageUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
      <span>{code}</span>
    </span>
  );
}
