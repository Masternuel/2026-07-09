export const DARK_THEME_CANVAS = '#111214';
export const LIGHT_THEME_CANVAS = '#eceeeb';
export const DARK_THEME_FALLBACK = '#f0f0f0';
export const LIGHT_THEME_FALLBACK = '#171a17';
export const DARK_ACCENT_FOREGROUND = '#101311';
export const LIGHT_ACCENT_FOREGROUND = '#ffffff';
export const PURE_DARK_ACCENT_FOREGROUND = '#000000';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface ClubThemeColorInput {
  color?: string | null;
  darkThemeColor?: string | null;
  lightThemeColor?: string | null;
}

export interface ClubThemeColors {
  darkThemeColor: string;
  lightThemeColor: string;
}

export function clubIdentitySurfaces(identity: string, lightMode: boolean) {
  return {
    canvas: mixHexColors(lightMode ? LIGHT_THEME_CANVAS : DARK_THEME_CANVAS, identity, lightMode ? 0.07 : 0.15),
    menu: mixHexColors(lightMode ? '#f5f7f3' : '#131518', identity, lightMode ? 0.12 : 0.22),
    menuInset: mixHexColors(lightMode ? '#edf0eb' : '#101214', identity, lightMode ? 0.06 : 0.09),
  };
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return HEX_COLOR.test(normalized) ? normalized.toLowerCase() : null;
}

function channelToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(value: unknown): number | null {
  const color = normalizeHexColor(value);
  if (!color) return null;
  const red = channelToLinear(Number.parseInt(color.slice(1, 3), 16));
  const green = channelToLinear(Number.parseInt(color.slice(3, 5), 16));
  const blue = channelToLinear(Number.parseInt(color.slice(5, 7), 16));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

export function contrastRatio(foreground: unknown, background: unknown): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return 0;
  const lightest = Math.max(foregroundLuminance, backgroundLuminance);
  const darkest = Math.min(foregroundLuminance, backgroundLuminance);
  return (lightest + 0.05) / (darkest + 0.05);
}

function isChromatic(color: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return Math.max(...channels) - Math.min(...channels) >= 12;
}

function accessibleLegacyAccent(primary: string | null, canvas: string, fallback: string) {
  if (!primary) return fallback;
  if (contrastRatio(primary, canvas) >= 4.5) return primary;
  if (!isChromatic(primary)) return fallback;
  // Keep the identity hue while making legacy colors readable on each canvas.
  const toward = relativeLuminance(canvas)! < 0.5 ? '#ffffff' : '#000000';
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mixHexColors(primary, toward, step / 100);
    if (contrastRatio(candidate, canvas) >= 4.5) return candidate;
  }
  return fallback;
}

export function resolveClubThemeColors(input: ClubThemeColorInput): ClubThemeColors {
  const primary = normalizeHexColor(input.color);
  const explicitDark = normalizeHexColor(input.darkThemeColor);
  const explicitLight = normalizeHexColor(input.lightThemeColor);
  const legacyCanvas = (lightMode: boolean) => {
    if (!primary || !isChromatic(primary)) return lightMode ? LIGHT_THEME_CANVAS : DARK_THEME_CANVAS;
    const surfaces = clubIdentitySurfaces(primary, lightMode);
    return Object.values(surfaces).reduce((leastContrast, surface) => (
      (relativeLuminance(surface)! - relativeLuminance(leastContrast)!) * (lightMode ? -1 : 1) > 0
        ? surface : leastContrast
    ));
  };
  return {
    darkThemeColor: explicitDark
      ?? accessibleLegacyAccent(primary, legacyCanvas(false), DARK_THEME_FALLBACK),
    lightThemeColor: explicitLight
      ?? accessibleLegacyAccent(primary, legacyCanvas(true), LIGHT_THEME_FALLBACK),
  };
}

export function resolveClubIdentityColor(input: ClubThemeColorInput, lightMode: boolean): string {
  const explicit = normalizeHexColor(lightMode ? input.lightThemeColor : input.darkThemeColor);
  if (explicit) return explicit;
  const primary = normalizeHexColor(input.color);
  if (primary && isChromatic(primary)) return primary;
  const colors = resolveClubThemeColors(input);
  return lightMode ? colors.lightThemeColor : colors.darkThemeColor;
}

export function foregroundForAccent(accent: unknown): string {
  const color = normalizeHexColor(accent);
  if (!color) return DARK_ACCENT_FOREGROUND;
  const darkContrast = contrastRatio(DARK_ACCENT_FOREGROUND, color);
  const lightContrast = contrastRatio(LIGHT_ACCENT_FOREGROUND, color);
  if (darkContrast >= 4.5 || lightContrast >= 4.5) {
    return darkContrast >= lightContrast ? DARK_ACCENT_FOREGROUND : LIGHT_ACCENT_FOREGROUND;
  }
  return contrastRatio(PURE_DARK_ACCENT_FOREGROUND, color) >= lightContrast
    ? PURE_DARK_ACCENT_FOREGROUND
    : LIGHT_ACCENT_FOREGROUND;
}

function mixHexColors(base: string, mix: string, mixWeight: number) {
  const channel = (offset: number) => Math.round(
    Number.parseInt(base.slice(offset, offset + 2), 16) * (1 - mixWeight)
    + Number.parseInt(mix.slice(offset, offset + 2), 16) * mixWeight,
  ).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export function hoverForAccent(accent: unknown, foreground = foregroundForAccent(accent)): string {
  const color = normalizeHexColor(accent) ?? '#c8ff3d';
  const normalizedForeground = normalizeHexColor(foreground) ?? DARK_ACCENT_FOREGROUND;
  const moveToward = relativeLuminance(normalizedForeground)! > 0.5 ? '#000000' : '#ffffff';
  return mixHexColors(color, moveToward, 0.14);
}

export function replacePrimaryClubColor(colors: readonly string[], nextPrimary: string): string[] {
  return [nextPrimary, ...colors.slice(1)];
}
