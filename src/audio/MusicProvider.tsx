import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useUserPreferences } from '../preferences/UserPreferencesContext';
import { DEFAULT_USER_PREFERENCES, type AudioPreferences } from '../preferences/userPreferences';
import { categoryGain, MusicManager, type MusicState, type MusicTrack } from './musicManager';
import { musicPlaylist } from './playlist';

interface MusicContextValue extends MusicState {
  playlist: readonly MusicTrack[];
  preferences: AudioPreferences;
  notice: { track: MusicTrack; sequence: number } | null;
  next(): void;
  previous(): void;
  toggle(): void;
  select(id: string): void;
  dismissNotice(): void;
  setMenuActive(active: boolean): void;
  updateAudio(patch: Partial<AudioPreferences>): Promise<boolean>;
  previewSound(category: 'interface' | 'effects'): void;
}
const initialState: MusicState = { track: null, status: 'idle', error: null, sequence: 0 };
const fallback: MusicContextValue = { ...initialState, playlist: musicPlaylist, preferences: DEFAULT_USER_PREFERENCES.audio,
  notice: null, next() {}, previous() {}, toggle() {}, select() {}, dismissNotice() {}, setMenuActive() {},
  updateAudio: async () => false, previewSound() {} };
const MusicContext = createContext<MusicContextValue>(fallback);

export function MusicProvider({ children }: { children: ReactNode }) {
  const settings = useUserPreferences();
  const auth = useAuth();
  const managerRef = useRef<MusicManager | null>(null);
  const preferencesRef = useRef(settings.preferences.audio);
  preferencesRef.current = settings.preferences.audio;
  const ready = auth.status === 'authenticated' && settings.status !== 'loading';
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const activeRef = useRef(true);
  const [state, setState] = useState(initialState);
  const [notice, setNotice] = useState<MusicContextValue['notice']>(null);
  const soundContext = useRef<AudioContext | null>(null);
  const previews = useRef(new Set<{ oscillator: OscillatorNode; gain: GainNode; category: 'interface' | 'effects' }>());

  useEffect(() => {
    const manager = new MusicManager(new Audio(), musicPlaylist, preferencesRef.current);
    managerRef.current = manager;
    manager.setActive(activeRef.current && readyRef.current);
    const unsubscribe = manager.subscribe(setState);
    const unlock = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-music-controls]')) return;
      if (manager.getSnapshot().status === 'blocked' && readyRef.current) manager.resume();
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      unsubscribe(); manager.dispose(); managerRef.current = null;
      previews.current.forEach(({ oscillator }) => { try { oscillator.stop(); } catch { /* Already ended. */ } });
      previews.current.clear();
      void soundContext.current?.close().catch(() => undefined);
      soundContext.current = null;
    };
  }, []);

  useEffect(() => {
    const manager = managerRef.current;
    manager?.setPreferences(settings.preferences.audio);
    manager?.setActive(activeRef.current && ready);
    if (ready) manager?.start();
    const context = soundContext.current;
    if (context) previews.current.forEach(({ gain, category }) => {
      gain.gain.setTargetAtTime(categoryGain(settings.preferences.audio, category) * 0.08, context.currentTime, 0.015);
    });
  }, [settings.preferences.audio, ready]);

  useEffect(() => {
    if (!state.sequence || !state.track || !settings.preferences.audio.showNowPlaying || !activeRef.current) return;
    setNotice({ track: state.track, sequence: state.sequence });
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
    // Only a successful new track start should trigger a notice, never navigation/resume.
  }, [state.sequence]);
  useEffect(() => {
    if (!settings.preferences.audio.showNowPlaying || !settings.preferences.audio.musicEnabled || !ready) setNotice(null);
  }, [settings.preferences.audio.showNowPlaying, settings.preferences.audio.musicEnabled, ready]);

  const setMenuActive = useCallback((active: boolean) => {
    activeRef.current = active;
    managerRef.current?.setActive(active && readyRef.current);
    if (!active) setNotice(null);
  }, []);
  const updateAudio = useCallback((patch: Partial<AudioPreferences>) => settings.updatePreferences({ audio: patch }), [settings.updatePreferences]);
  const previewSound = useCallback((category: 'interface' | 'effects') => {
    const context = soundContext.current ?? new AudioContext();
    soundContext.current = context;
    void context.resume().then(() => {
      if (soundContext.current !== context || context.state === 'closed') return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const entry = { oscillator, gain, category };
      previews.current.add(entry);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(category === 'interface' ? 660 : 220, context.currentTime);
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(categoryGain(preferencesRef.current, category) * 0.08, context.currentTime + 0.012);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.12);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); previews.current.delete(entry); };
      oscillator.start(); oscillator.stop(context.currentTime + 0.13);
    }).catch(() => undefined);
  }, []);
  const value = useMemo<MusicContextValue>(() => ({ ...state, playlist: musicPlaylist,
    preferences: settings.preferences.audio, notice, updateAudio, previewSound, setMenuActive,
    next: () => managerRef.current?.next(), previous: () => managerRef.current?.previous(),
    select: (id) => managerRef.current?.select(id), dismissNotice: () => setNotice(null),
    toggle: () => {
      if (!preferencesRef.current.musicEnabled) void updateAudio({ musicEnabled: true });
      else managerRef.current?.toggle();
    },
  }), [state, settings.preferences.audio, notice, updateAudio, previewSound, setMenuActive]);
  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}

export function useMusic() { return useContext(MusicContext); }
