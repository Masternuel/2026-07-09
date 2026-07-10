import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  compact?: boolean;
  label?: string;
}

export function StarRating({ value, compact = false, label }: StarRatingProps) {
  const normalized = Math.max(1, Math.min(10, value));
  if (compact) {
    return (
      <span className="star-rating star-rating--compact" aria-label={`${label ? `${label}: ` : ''}${normalized} de 10 estrelas`}>
        <Star size={12} fill="currentColor" aria-hidden="true" />
        <strong>{normalized}</strong><span>/10</span>
      </span>
    );
  }

  return (
    <span className="star-rating" aria-label={`${label ? `${label}: ` : ''}${normalized} de 10 estrelas`}>
      <span className="star-rating__track" aria-hidden="true">
        <span className="star-rating__fill" style={{ width: `${normalized * 10}%` }} />
      </span>
      <strong>{normalized.toFixed(1)}</strong>
    </span>
  );
}
