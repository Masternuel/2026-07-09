import type { ReactNode } from 'react';
import { cx } from '../../utils/formatters';

interface BadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'info';
  dot?: boolean;
  className?: string;
}

export function Badge({ children, tone = 'neutral', dot = false, className }: BadgeProps) {
  return (
    <span className={cx('badge', `badge--${tone}`, className)}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
