import { useEffect, useState, type CSSProperties } from 'react';
import { cx } from '../../utils/formatters';
import { resolveClubThemeColors } from '../../utils/clubThemeColors';

interface ClubMarkProps {
  code: string;
  color?: string;
  darkThemeColor?: string | null;
  lightThemeColor?: string | null;
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'shield' | 'round';
}

export function ClubMark({ code, color = '#c8ff3d', darkThemeColor, lightThemeColor, imageUrl, size = 'md', variant = 'shield' }: ClubMarkProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(imageUrl) && !imageFailed;
  const themeColors = resolveClubThemeColors({ color, darkThemeColor, lightThemeColor });

  useEffect(() => setImageFailed(false), [imageUrl]);

  return (
    <span
      className={cx('club-mark', `club-mark--${size}`, `club-mark--${variant}`, hasImage && 'club-mark--image')}
      style={{
        '--club-color-dark': themeColors.darkThemeColor,
        '--club-color-light': themeColors.lightThemeColor,
      } as CSSProperties}
      aria-label={code}
    >
      {hasImage ? <img src={imageUrl!} alt="" onError={() => setImageFailed(true)} /> : <span>{code}</span>}
    </span>
  );
}
