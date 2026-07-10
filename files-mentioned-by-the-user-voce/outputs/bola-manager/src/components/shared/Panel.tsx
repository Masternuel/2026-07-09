import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from '../../utils/formatters';

interface PanelProps {
  title?: string;
  eyebrow?: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, eyebrow, action, onAction, children, className }: PanelProps) {
  return (
    <section className={cx('panel', className)}>
      {(title || eyebrow || action) && (
        <header className="panel__header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {action && (
            <button className="panel__action" onClick={onAction}>
              {action}<ChevronRight size={14} />
            </button>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
