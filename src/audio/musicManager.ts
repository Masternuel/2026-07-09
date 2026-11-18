import type { AudioPreferences } from '../preferences/userPreferences';

export interface MusicTrack { id: string; title: string; artist: string; src: string; cover?: string }
export type MusicStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';
export interface MusicState { track: MusicTrack | null; status: MusicStatus; error: string | null; sequence: number }
export interface AudioClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}
const clock: AudioClock = { now: () => performance.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms), clearTimeout: (id) => window.clearTimeout(id) };

export function categoryGain(settings: AudioPreferences, category: 'music' | 'effects' | 'interface') {
  return (settings.masterVolume / 100) * (settings[`${category}Volume`] / 100);
}

/** One media element: switch only after fading out and pausing the old source. */
export class MusicManager {
  private state: MusicState = { track: null, status: 'idle', error: null, sequence: 0 };
  private listeners = new Set<(state: MusicState) => void>();
  private settings: AudioPreferences;
  private active = true;
  private userPaused = false;
  private disposed = false;
  private generation = 0;
  private fadeTimer: number | undefined;
  private fadeResolve: (() => void) | undefined;
  private loadTimer: number | undefined;
  private history: string[] = [];
  private failed = new Set<string>();
  private announce = true;
  private loadedId: string | null = null;
  private readonly ended = () => { if (this.shouldPlay()) this.next(); };
  private readonly mediaError = () => {
    if (this.loadedId === this.state.track?.id) this.failTrack(this.generation);
  };

  constructor(private readonly audio: HTMLAudioElement, readonly playlist: readonly MusicTrack[],
    settings: AudioPreferences, private readonly time: AudioClock = clock, private readonly random = Math.random) {
    this.settings = settings;
    audio.preload = 'none';
    audio.volume = 0;
    audio.addEventListener('ended', this.ended);
    audio.addEventListener('error', this.mediaError);
  }
  getSnapshot = () => this.state;
  subscribe(listener: (state: MusicState) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private publish(patch: Partial<MusicState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }
  private shouldPlay() { return this.active && this.settings.musicEnabled && !this.userPaused && !this.disposed; }
  private clearLoadTimer() {
    if (this.loadTimer !== undefined) this.time.clearTimeout(this.loadTimer);
    this.loadTimer = undefined;
  }
  private cancelFade() {
    if (this.fadeTimer !== undefined) this.time.clearTimeout(this.fadeTimer);
    this.fadeTimer = undefined;
    this.fadeResolve?.();
    this.fadeResolve = undefined;
  }
  private fadeTo(target: number, duration = 220) {
    this.cancelFade();
    const from = this.audio.volume;
    if (from === target || duration === 0) { this.audio.volume = target; return Promise.resolve(); }
    const start = this.time.now();
    return new Promise<void>((resolve) => {
      this.fadeResolve = resolve;
      const tick = () => {
        const progress = Math.min(1, (this.time.now() - start) / duration);
        this.audio.volume = Math.max(0, Math.min(1, from + (target - from) * progress));
        if (progress === 1) { this.fadeTimer = undefined; this.fadeResolve = undefined; resolve(); }
        else this.fadeTimer = this.time.setTimeout(tick, 16);
      };
      tick();
    });
  }
  setPreferences(settings: AudioPreferences) {
    const wasEnabled = this.settings.musicEnabled;
    this.settings = settings;
    if (!settings.musicEnabled) this.stop(true);
    else if (!wasEnabled && this.shouldPlay()) this.resume();
    else if (this.state.status === 'playing') void this.fadeTo(categoryGain(settings, 'music'));
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.stop();
    else if (this.shouldPlay()) this.resume();
  }
  start() {
    if (!this.shouldPlay() || this.state.track) return;
    const track = this.choose();
    if (track) this.switchTo(track);
  }
  private choose() {
    const candidates = this.playlist.filter((track) => !this.failed.has(track.id));
    if (!candidates.length) return null;
    if (this.settings.shuffle) {
      const pool = candidates.length > 1 ? candidates.filter((track) => track.id !== this.state.track?.id) : candidates;
      return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(this.random() * pool.length)))];
    }
    const index = this.playlist.findIndex((track) => track.id === this.state.track?.id);
    for (let step = 1; step <= this.playlist.length; step++) {
      const track = this.playlist[(index + step) % this.playlist.length];
      if (!this.failed.has(track.id)) return track;
    }
    return null;
  }
  next() {
    if (this.disposed) return;
    const track = this.choose();
    if (track) this.switchTo(track);
  }
  previous() {
    if (this.disposed) return;
    const previous = this.history.pop();
    const index = this.playlist.findIndex((track) => track.id === this.state.track?.id);
    const track = this.playlist.find((item) => item.id === previous)
      ?? this.playlist[(index - 1 + this.playlist.length) % this.playlist.length];
    if (track) { this.failed.delete(track.id); this.switchTo(track, false); }
  }
  select(id: string) {
    const track = this.playlist.find((item) => item.id === id);
    if (!track || this.disposed) return;
    this.failed.delete(id);
    this.userPaused = false;
    this.switchTo(track);
  }
  toggle() { if (this.state.status === 'playing' || this.state.status === 'loading') this.pause(); else this.resume(); }
  pause() { this.userPaused = true; this.stop(); }
  resume() {
    this.userPaused = false;
    if (!this.shouldPlay() || this.state.status === 'playing' || this.state.status === 'loading') return;
    if (!this.state.track) { this.start(); return; }
    if (this.loadedId !== this.state.track.id) { this.switchTo(this.state.track, false); return; }
    const generation = ++this.generation;
    this.cancelFade();
    void this.play(generation);
  }
  private stop(immediate = false) {
    const generation = ++this.generation;
    this.clearLoadTimer();
    this.publish({ status: this.state.track ? 'paused' : 'idle' });
    void this.fadeTo(0, immediate ? 0 : 180).then(() => {
      if (generation === this.generation) this.audio.pause();
    });
  }
  private switchTo(track: MusicTrack, remember = true) {
    const generation = ++this.generation;
    this.clearLoadTimer();
    if (remember && this.state.track && this.state.track.id !== track.id) {
      this.history.push(this.state.track.id);
      if (this.history.length > 100) this.history.shift();
    }
    this.publish({ track, status: 'loading', error: null });
    void this.fadeTo(0).then(() => {
      if (generation !== this.generation || this.disposed) return;
      this.audio.pause();
      this.audio.src = track.src;
      this.loadedId = track.id;
      this.audio.load();
      this.announce = true;
      if (this.shouldPlay()) void this.play(generation);
      else this.publish({ status: 'paused' });
    });
  }
  private async play(generation: number) {
    this.publish({ status: 'loading', error: null });
    // A stalled media fetch must not leave controls stuck in loading forever.
    this.loadTimer = this.time.setTimeout(() => this.failTrack(generation), 10000);
    try {
      await this.audio.play();
      if (generation !== this.generation || this.disposed) return;
      this.clearLoadTimer();
      this.publish({ status: 'playing', sequence: this.state.sequence + (this.announce ? 1 : 0) });
      this.announce = false;
      void this.fadeTo(categoryGain(this.settings, 'music'), 350);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.clearLoadTimer();
      if (error instanceof Error && error.name === 'NotAllowedError') {
        this.publish({ status: 'blocked', error: 'Clique em reproduzir para liberar o áudio.' });
      } else this.failTrack(generation);
    }
  }
  private failTrack(generation: number) {
    if (generation !== this.generation || this.disposed || !this.state.track) return;
    this.clearLoadTimer();
    this.failed.add(this.state.track.id);
    this.audio.pause();
    this.cancelFade();
    this.audio.volume = 0;
    const next = this.choose();
    if (next && this.shouldPlay()) this.switchTo(next);
    else this.publish({ status: 'error', error: 'Não foi possível carregar as músicas. Verifique os arquivos e tente outra faixa.' });
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.cancelFade();
    this.clearLoadTimer();
    this.audio.pause();
    this.audio.removeEventListener('ended', this.ended);
    this.audio.removeEventListener('error', this.mediaError);
    this.audio.removeAttribute('src');
    this.audio.load();
    this.listeners.clear();
  }
}
