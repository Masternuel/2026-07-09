export const USER_PREFERENCES_VERSION = 1 as const;
export const USER_PREFERENCES_CACHE_KEY = 'bola-manager:user-preferences-cache:v1';

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type UserLocale = 'pt-BR';
export type UserRegion = 'br-sp' | 'south-america';

export interface NotificationPreferences {
  offers: boolean;
  matches: boolean;
  news: boolean;
  room: boolean;
}

export type NotificationCategory = keyof NotificationPreferences;

export interface ProfilePreferences {
  locale: UserLocale;
  region: UserRegion;
}

export interface UserPreferences {
  version: typeof USER_PREFERENCES_VERSION;
  theme: ThemePreference;
  notifications: NotificationPreferences;
  profile: ProfilePreferences;
}

export interface UserPreferencesPatch {
  theme?: ThemePreference;
  notifications?: Partial<NotificationPreferences>;
  profile?: Partial<ProfilePreferences>;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = Object.freeze({
  version: USER_PREFERENCES_VERSION,
  theme: 'dark',
  notifications: Object.freeze({
    offers: true,
    matches: true,
    news: false,
    room: true,
  }),
  profile: Object.freeze({
    locale: 'pt-BR',
    region: 'br-sp',
  }),
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const source = record(value);
  const notifications = record(source.notifications);
  const profile = record(source.profile);
  const theme = source.theme === 'light' || source.theme === 'system' || source.theme === 'dark'
    ? source.theme
    : DEFAULT_USER_PREFERENCES.theme;
  const locale = profile.locale === 'pt-BR'
    ? profile.locale
    : DEFAULT_USER_PREFERENCES.profile.locale;
  const region = profile.region === 'south-america' || profile.region === 'br-sp'
    ? profile.region
    : DEFAULT_USER_PREFERENCES.profile.region;

  return {
    version: USER_PREFERENCES_VERSION,
    theme,
    notifications: {
      offers: boolean(notifications.offers, DEFAULT_USER_PREFERENCES.notifications.offers),
      matches: boolean(notifications.matches, DEFAULT_USER_PREFERENCES.notifications.matches),
      news: boolean(notifications.news, DEFAULT_USER_PREFERENCES.notifications.news),
      room: boolean(notifications.room, DEFAULT_USER_PREFERENCES.notifications.room),
    },
    profile: { locale, region },
  };
}

export function applyUserPreferencesPatch(
  current: UserPreferences,
  patch: UserPreferencesPatch,
): UserPreferences {
  return normalizeUserPreferences({
    ...current,
    ...patch,
    notifications: {
      ...current.notifications,
      ...patch.notifications,
    },
    profile: {
      ...current.profile,
      ...patch.profile,
    },
  });
}

export function resolveThemePreference(
  theme: ThemePreference,
  systemPrefersLight: boolean,
): ResolvedTheme {
  if (theme === 'system') return systemPrefersLight ? 'light' : 'dark';
  return theme;
}

export function notificationCategoryEnabled(
  notifications: NotificationPreferences,
  category: NotificationCategory,
): boolean {
  return notifications[category] === true;
}

export function readCachedThemePreference(): ThemePreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_PREFERENCES_CACHE_KEY);
    const value = raw ? record(JSON.parse(raw)) : {};
    return value.theme === 'dark' || value.theme === 'light' || value.theme === 'system'
      ? value.theme
      : null;
  } catch {
    return null;
  }
}

export function writeCachedThemePreference(theme: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      USER_PREFERENCES_CACHE_KEY,
      JSON.stringify({ version: USER_PREFERENCES_VERSION, theme }),
    );
  } catch {
    // Este cache contém somente o tema para o prepaint; o Firestore é a fonte oficial.
  }
}
