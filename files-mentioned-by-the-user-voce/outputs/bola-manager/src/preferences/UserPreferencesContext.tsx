import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { firebaseDb } from '../lib/firebaseClient';
import {
  DEFAULT_USER_PREFERENCES,
  USER_PREFERENCES_VERSION,
  applyUserPreferencesPatch,
  normalizeUserPreferences,
  readCachedThemePreference,
  resolveThemePreference,
  writeCachedThemePreference,
  type ResolvedTheme,
  type UserPreferences,
  type UserPreferencesPatch,
} from './userPreferences';

export type UserPreferencesStatus = 'loading' | 'saving' | 'saved' | 'error';

export interface UserPreferencesContextValue {
  preferences: UserPreferences;
  resolvedTheme: ResolvedTheme;
  status: UserPreferencesStatus;
  error: string | null;
  savedAt: Date | null;
  updatePreferences: (patch: UserPreferencesPatch) => Promise<boolean>;
  reloadPreferences: () => Promise<void>;
}

const fallbackContext: UserPreferencesContextValue = {
  preferences: DEFAULT_USER_PREFERENCES,
  resolvedTheme: 'dark',
  status: 'saved',
  error: null,
  savedAt: null,
  updatePreferences: async () => false,
  reloadPreferences: async () => undefined,
};

export const UserPreferencesContext = createContext<UserPreferencesContextValue>(fallbackContext);

function preferencesError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  if (code === 'permission-denied') return 'O Firestore recusou o acesso às suas preferências.';
  if (code === 'unavailable') return 'As preferências estão temporariamente indisponíveis.';
  return 'Não foi possível sincronizar suas preferências.';
}

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const initialTheme = useMemo(() => readCachedThemePreference(), []);
  const [preferences, setPreferences] = useState<UserPreferences>(
    () => applyUserPreferencesPatch(DEFAULT_USER_PREFERENCES, {
      theme: initialTheme ?? DEFAULT_USER_PREFERENCES.theme,
    }),
  );
  const preferencesRef = useRef(preferences);
  const [status, setStatus] = useState<UserPreferencesStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [prefersLight, setPrefersLight] = useState(systemPrefersLight);
  const loadSequence = useRef(0);
  const identityUid = auth.identity?.uid ?? null;
  const identityMode = auth.identity?.mode ?? null;

  const replacePreferences = useCallback((next: UserPreferences) => {
    const normalized = normalizeUserPreferences(next);
    preferencesRef.current = normalized;
    setPreferences(normalized);
    writeCachedThemePreference(normalized.theme);
    return normalized;
  }, []);

  const reloadPreferences = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setError(null);

    if (!identityUid || !identityMode) {
      setStatus('loading');
      return;
    }

    if (identityMode === 'demo') {
      replacePreferences(DEFAULT_USER_PREFERENCES);
      setStatus('saved');
      setSavedAt(null);
      return;
    }

    if (!firebaseDb) {
      setStatus('error');
      setError('O Firestore não está configurado neste ambiente.');
      return;
    }

    setStatus('loading');
    try {
      const snapshot = await getDoc(doc(firebaseDb, 'users', identityUid));
      if (sequence !== loadSequence.current) return;
      const data = snapshot.exists() ? snapshot.data() : null;
      const source = data && typeof data === 'object' && 'preferences' in data
        ? data.preferences
        : data;
      replacePreferences(source ? normalizeUserPreferences(source) : DEFAULT_USER_PREFERENCES);
      setStatus('saved');
      setSavedAt(null);
    } catch (nextError) {
      if (sequence !== loadSequence.current) return;
      setStatus('error');
      setError(preferencesError(nextError));
    }
  }, [identityMode, identityUid, replacePreferences]);

  useEffect(() => {
    void reloadPreferences();
    return () => {
      loadSequence.current += 1;
    };
  }, [reloadPreferences]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const synchronize = () => setPrefersLight(query.matches);
    synchronize();
    query.addEventListener?.('change', synchronize);
    return () => query.removeEventListener?.('change', synchronize);
  }, []);

  const resolvedTheme = resolveThemePreference(preferences.theme, prefersLight);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('theme-light', resolvedTheme === 'light');
    root.dataset.theme = resolvedTheme;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeColor?.setAttribute('content', resolvedTheme === 'light' ? '#eceeeb' : '#111214');
  }, [resolvedTheme]);

  const updatePreferences = useCallback(async (patch: UserPreferencesPatch) => {
    const previous = preferencesRef.current;
    const next = applyUserPreferencesPatch(previous, patch);
    replacePreferences(next);
    setStatus('saving');
    setError(null);

    if (!identityUid || !identityMode) {
      replacePreferences(previous);
      setStatus('error');
      setError('Entre novamente para salvar suas preferências.');
      return false;
    }

    if (identityMode === 'demo') {
      setStatus('saved');
      setSavedAt(new Date());
      return true;
    }

    if (!firebaseDb) {
      replacePreferences(previous);
      setStatus('error');
      setError('O Firestore não está configurado neste ambiente.');
      return false;
    }

    try {
      await setDoc(doc(firebaseDb, 'users', identityUid), {
        preferencesVersion: USER_PREFERENCES_VERSION,
        preferences: next,
        preferencesUpdatedAt: serverTimestamp(),
      }, { merge: true });
      setStatus('saved');
      setSavedAt(new Date());
      return true;
    } catch (nextError) {
      replacePreferences(previous);
      setStatus('error');
      setError(preferencesError(nextError));
      return false;
    }
  }, [identityMode, identityUid, replacePreferences]);

  const value = useMemo<UserPreferencesContextValue>(() => ({
    preferences,
    resolvedTheme,
    status,
    error,
    savedAt,
    updatePreferences,
    reloadPreferences,
  }), [preferences, resolvedTheme, status, error, savedAt, updatePreferences, reloadPreferences]);

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
}

export function useUserPreferences() {
  return useContext(UserPreferencesContext);
}
