import { useEffect, useState, type ReactNode } from 'react';

interface ResilientImageProps {
  src?: string | null;
  alt: string;
  fallback?: ReactNode;
  className?: string;
}

export function ResilientImage({ src, alt, fallback = null, className }: ResilientImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) return <>{fallback}</>;
  return <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />;
}
