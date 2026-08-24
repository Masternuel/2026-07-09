import type { LeagueChoice } from '../types';

export interface LeagueCountryGroup {
  key: string;
  label: string;
  leagues: LeagueChoice[];
  clubCount: number;
}

const COUNTRY_ALIASES: Record<string, { key: string; label: string }> = {
  AR: { key: 'ARGENTINA', label: 'Argentina' },
  ARG: { key: 'ARGENTINA', label: 'Argentina' },
  ARGENTINA: { key: 'ARGENTINA', label: 'Argentina' },
  BR: { key: 'BRASIL', label: 'Brasil' },
  BRA: { key: 'BRASIL', label: 'Brasil' },
  BRASIL: { key: 'BRASIL', label: 'Brasil' },
  ENG: { key: 'INGLATERRA', label: 'Inglaterra' },
  ENGLAND: { key: 'INGLATERRA', label: 'Inglaterra' },
  ING: { key: 'INGLATERRA', label: 'Inglaterra' },
  INGLATERRA: { key: 'INGLATERRA', label: 'Inglaterra' },
};

export type CountryFlagCode = 'AR' | 'BR' | 'DE' | 'ES' | 'FR' | 'GB' | 'IT' | 'NL' | 'PT' | 'UY' | 'GLOBE';

const COUNTRY_FLAG_CODES: Partial<Record<string, CountryFlagCode>> = {
  ARGENTINA: 'AR',
  AR: 'AR',
  ARG: 'AR',
  BRASIL: 'BR',
  BR: 'BR',
  BRA: 'BR',
  INGLATERRA: 'GB',
  ENG: 'GB',
  ENGLAND: 'GB',
  DE: 'DE',
  DEU: 'DE',
  ALEMANHA: 'DE',
  GERMANY: 'DE',
  ES: 'ES',
  ESP: 'ES',
  ESPANHA: 'ES',
  SPAIN: 'ES',
  FR: 'FR',
  FRA: 'FR',
  FRANCA: 'FR',
  FRANCE: 'FR',
  IT: 'IT',
  ITA: 'IT',
  ITALIA: 'IT',
  ITALY: 'IT',
  NL: 'NL',
  NLD: 'NL',
  HOLANDA: 'NL',
  NETHERLANDS: 'NL',
  PT: 'PT',
  PRT: 'PT',
  PORTUGAL: 'PT',
  UY: 'UY',
  URU: 'UY',
  URUGUAI: 'UY',
  URUGUAY: 'UY',
  GB: 'GB',
  GBR: 'GB',
  UK: 'GB',
  'UNITED KINGDOM': 'GB',
};

function normalizedText(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('pt-BR');
}

export function countryIdentity(value: string) {
  const text = value.trim() || 'País a definir';
  const normalized = normalizedText(text);
  return COUNTRY_ALIASES[normalized] ?? { key: normalized || 'PAIS-A-DEFINIR', label: text };
}

export function countryFlag(value: string) {
  return COUNTRY_FLAG_CODES[countryIdentity(value).key] ?? 'GLOBE';
}

export function groupLeaguesByCountry(leagues: readonly LeagueChoice[]): LeagueCountryGroup[] {
  const groups = new Map<string, LeagueCountryGroup>();

  for (const league of leagues) {
    const country = countryIdentity(league.country);
    const current = groups.get(country.key) ?? {
      key: country.key,
      label: country.label,
      leagues: [],
      clubCount: 0,
    };
    current.leagues.push(league);
    current.clubCount += league.clubCount;
    groups.set(country.key, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      leagues: [...group.leagues].sort((left, right) => (
        left.level - right.level
        || left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' })
      )),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' }));
}

export function defaultLeagueIds(leagues: readonly LeagueChoice[]) {
  return leagues.filter((league) => league.clubCount > 0).map((league) => league.id);
}

export function initialOpenCountryKey(
  groups: readonly LeagueCountryGroup[],
  selectedLeagueIds: readonly string[],
) {
  const selected = new Set(selectedLeagueIds.map((id) => normalizedText(id)));
  return groups.find((group) => group.leagues.some((league) => selected.has(normalizedText(league.id))))?.key
    ?? groups[0]?.key
    ?? null;
}

export function reconcileLeagueIds(
  selectedLeagueIds: readonly string[],
  leagues: readonly LeagueChoice[],
) {
  const canonicalIds = new Map(
    leagues.filter((league) => league.clubCount > 0).map((league) => [normalizedText(league.id), league.id]),
  );
  const reconciled: string[] = [];
  const seen = new Set<string>();
  for (const id of selectedLeagueIds) {
    const key = normalizedText(id);
    const canonical = canonicalIds.get(key);
    if (!canonical || seen.has(key)) continue;
    reconciled.push(canonical);
    seen.add(key);
  }
  return reconciled;
}

function sameLeagueIds(left: readonly string[], right: readonly string[]) {
  const leftKeys = new Set(left.map((id) => normalizedText(id)));
  const rightKeys = new Set(right.map((id) => normalizedText(id)));
  return leftKeys.size === rightKeys.size && [...leftKeys].every((key) => rightKeys.has(key));
}

export function resolveLeagueSelectionAfterCatalogChange(
  selectedLeagueIds: readonly string[],
  previousDefaultLeagueIds: readonly string[],
  leagues: readonly LeagueChoice[],
  selectionEdited: boolean,
) {
  if (!selectionEdited || sameLeagueIds(selectedLeagueIds, previousDefaultLeagueIds)) {
    return defaultLeagueIds(leagues);
  }
  return reconcileLeagueIds(selectedLeagueIds, leagues);
}
