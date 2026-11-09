interface BrandLogoProps {
  variant?: 'compact' | 'menu';
  className?: string;
}

export function BrandLogo({ variant = 'compact', className = '' }: BrandLogoProps) {
  return (
    <span className={`brand-logo brand-logo--${variant}${className ? ` ${className}` : ''}`} role="img" aria-label="Bola Manager">
      <img className="brand-logo__crest" src="/assets/brand/bola-manager-logo-512.png" alt="" aria-hidden="true" width={512} height={512} decoding="async" />
      <span className="brand-logo__name" aria-hidden="true">BOLA <strong>MANAGER</strong></span>
    </span>
  );
}
