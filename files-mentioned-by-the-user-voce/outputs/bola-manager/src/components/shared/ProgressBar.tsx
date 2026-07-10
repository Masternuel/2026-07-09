interface ProgressBarProps {
  value: number;
  tone?: 'accent' | 'info' | 'warning' | 'danger';
  label?: string;
}

export function ProgressBar({ value, tone = 'accent', label }: ProgressBarProps) {
  return (
    <div className={`progress progress--${tone}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
