import { useEffect, useState, type ReactNode } from 'react';
import { useImageSource } from '../../lib/imageSources';

interface ResilientImageProps {
  src?: string | null;
  alt: string;
  fallback?: ReactNode;
  className?: string;
}

export function ResilientImage({ src, alt, fallback = null, className }: ResilientImageProps) {
  const [failed, setFailed] = useState(false);
  const safeSrc = useImageSource(src);

  useEffect(() => setFailed(false), [safeSrc]);

  if (!safeSrc || failed) return <>{fallback}</>;
  return <img className={className} src={safeSrc} alt={alt} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
