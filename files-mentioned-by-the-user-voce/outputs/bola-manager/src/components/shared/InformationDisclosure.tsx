import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../../utils/formatters';

interface InformationDisclosureProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function InformationDisclosure({ title, children, className }: InformationDisclosureProps) {
  return (
    <details className={cx('information-disclosure', className)}>
      <summary><span>{title}</span><ChevronDown size={15} aria-hidden="true" /></summary>
      <div className="information-disclosure__content">{children}</div>
    </details>
  );
}
