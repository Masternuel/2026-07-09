import type { SVGProps } from 'react';
import { countryFlag, type CountryFlagCode } from '../../utils/leagueCountryGroups';

interface CountryFlagProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  country: string;
}

function FlagArtwork({ code }: { code: CountryFlagCode }) {
  switch (code) {
    case 'BR':
      return (
        <>
          <rect width="24" height="16" fill="#169b62" />
          <path d="m12 2.25 9.35 5.75L12 13.75 2.65 8 12 2.25Z" fill="#ffdf00" />
          <circle cx="12" cy="8" r="3.15" fill="#002776" />
          <path d="M8.95 7.15c2.35-.7 5.15-.4 7.2.65" fill="none" stroke="#fff" strokeWidth=".65" />
        </>
      );
    case 'AR':
      return (
        <>
          <rect width="24" height="16" fill="#74acdf" />
          <rect y="5.33" width="24" height="5.34" fill="#fff" />
          <circle cx="12" cy="8" r="1.25" fill="#f6b40e" />
          <path d="M12 5.95v.8M12 9.25v.8M9.95 8h.8M13.25 8h.8M10.55 6.55l.57.57M12.88 8.88l.57.57M13.45 6.55l-.57.57M11.12 8.88l-.57.57" stroke="#f6b40e" strokeWidth=".35" strokeLinecap="round" />
        </>
      );
    case 'GB':
      return (
        <>
          <rect width="24" height="16" fill="#012169" />
          <path d="M0 0 24 16M24 0 0 16" stroke="#fff" strokeWidth="3.4" />
          <path d="M0 0 24 16M24 0 0 16" stroke="#c8102e" strokeWidth="1.3" />
          <path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5" />
          <path d="M12 0v16M0 8h24" stroke="#c8102e" strokeWidth="2.7" />
        </>
      );
    case 'DE':
      return (
        <>
          <rect width="24" height="5.34" fill="#181818" />
          <rect y="5.33" width="24" height="5.34" fill="#dd0000" />
          <rect y="10.66" width="24" height="5.34" fill="#ffce00" />
        </>
      );
    case 'ES':
      return (
        <>
          <rect width="24" height="16" fill="#aa151b" />
          <rect y="4" width="24" height="8" fill="#f1bf00" />
          <rect x="7" y="6.15" width="1.45" height="3.7" rx=".25" fill="#aa151b" />
          <path d="M6.55 6.15h2.35M6.8 9.85h1.85" stroke="#fff" strokeWidth=".35" />
        </>
      );
    case 'FR':
      return (
        <>
          <rect width="8" height="16" fill="#002654" />
          <rect x="8" width="8" height="16" fill="#fff" />
          <rect x="16" width="8" height="16" fill="#ed2939" />
        </>
      );
    case 'IT':
      return (
        <>
          <rect width="8" height="16" fill="#009246" />
          <rect x="8" width="8" height="16" fill="#fff" />
          <rect x="16" width="8" height="16" fill="#ce2b37" />
        </>
      );
    case 'NL':
      return (
        <>
          <rect width="24" height="5.34" fill="#ae1c28" />
          <rect y="5.33" width="24" height="5.34" fill="#fff" />
          <rect y="10.66" width="24" height="5.34" fill="#21468b" />
        </>
      );
    case 'PT':
      return (
        <>
          <rect width="9.6" height="16" fill="#046a38" />
          <rect x="9.6" width="14.4" height="16" fill="#da291c" />
          <circle cx="9.6" cy="8" r="2.25" fill="#ffcd00" />
          <path d="M8.25 6.7h2.7v2.65c-.8.85-1.9.85-2.7 0V6.7Z" fill="#fff" stroke="#da291c" strokeWidth=".35" />
        </>
      );
    case 'UY':
      return (
        <>
          <rect width="24" height="16" fill="#fff" />
          <path d="M0 3.55h24v1.78H0zM0 7.1h24v1.78H0zM0 10.65h24v1.78H0zM0 14.2h24V16H0z" fill="#0038a8" />
          <rect width="8.5" height="8.85" fill="#fff" />
          <circle cx="4.25" cy="4.25" r="1.35" fill="#fcd116" />
          <path d="M4.25 1.75v.85M4.25 5.9v.85M1.75 4.25h.85M5.9 4.25h.85M2.5 2.5l.6.6M5.4 5.4l.6.6M6 2.5l-.6.6M3.1 5.4l-.6.6" stroke="#fcd116" strokeWidth=".45" strokeLinecap="round" />
        </>
      );
    default:
      return (
        <>
          <rect width="24" height="16" fill="#181b1e" />
          <circle cx="12" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M7.3 8h9.4M12 3c1.35 1.4 2.05 3.05 2.05 5S13.35 11.6 12 13c-1.35-1.4-2.05-3.05-2.05-5S10.65 4.4 12 3Z" fill="none" stroke="currentColor" strokeWidth=".8" />
        </>
      );
  }
}

export function CountryFlag({ country, className, ...svgProps }: CountryFlagProps) {
  const code = countryFlag(country);
  const classes = ['country-flag', `country-flag--${code.toLocaleLowerCase('en-US')}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <svg
      {...svgProps}
      className={classes}
      viewBox="0 0 24 16"
      aria-hidden="true"
      focusable="false"
      data-country-flag={code}
    >
      <FlagArtwork code={code} />
    </svg>
  );
}
