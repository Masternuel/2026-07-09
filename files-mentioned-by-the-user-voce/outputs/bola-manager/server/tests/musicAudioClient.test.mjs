import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let vite, MusicManager, categoryGain, preferences, PreferenceWriter;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, envDir: false,
    esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom',
    logLevel: 'silent', server: { middlewareMode: true } });
  ({ MusicManager, categoryGain } = await vite.ssrLoadModule('/src/audio/musicManager.ts'));
  preferences = await vite.ssrLoadModule('/src/preferences/userPreferences.ts');
  ({ PreferenceWriter } = await vite.ssrLoadModule('/src/preferences/preferenceWriter.ts'));
});
after(async () => { await vite?.close(); });

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
class Clock {
  at = 0; id = 0; timers = new Map();
  now = () => this.at;
  setTimeout = (fn, ms) => { const id = ++this.id; this.timers.set(id, { fn, at: this.at + ms }); return id; };
  clearTimeout = (id) => this.timers.delete(id);
  async advance(ms) {
    await flush();
    const end = this.at + ms;
    for (;;) {
      const entry = [...this.timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      this.at = entry[1].at; this.timers.delete(entry[0]); entry[1].fn(); await flush();
    }
    this.at = end; await flush();
  }
}
class Audio {
  src = ''; volume = 1; paused = true; currentTime = 0; listeners = new Map(); loads = []; plays = [];
  reject = null; stalled = false;
  addEventListener(event, fn) { this.listeners.set(event, fn); }
  removeEventListener(event) { this.listeners.delete(event); }
  emit(event) { this.listeners.get(event)?.(); }
  load() { this.loads.push(this.src); }
  play() { this.plays.push(this.src); if (this.reject) return Promise.reject(this.reject);
    if (this.stalled) return new Promise(() => {}); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
}
const playlist = ['a', 'b', 'c'].map((id) => ({ id, src: `/${id}.mp3`, title: id, artist: 'Test' }));
function setup(changes = {}, random = () => 0) {
  const time = new Clock(), audio = new Audio();
  const settings = { ...preferences.DEFAULT_USER_PREFERENCES.audio, shuffle: false, ...changes };
  const manager = new MusicManager(audio, playlist, settings, time, random);
  return { manager, audio, time, settings };
}

test('one media element survives menu navigation and fades in at category gain', async () => {
  const { manager, audio, time, settings } = setup(); manager.start(); await time.advance(400);
  assert.equal(manager.getSnapshot().status, 'playing');
  assert.equal(audio.volume, categoryGain(settings, 'music'));
  const before = [...audio.plays]; manager.setActive(true); manager.start(); await time.advance(400);
  assert.deepEqual(audio.plays, before); manager.dispose();
});
test('ended advances continuously and notice sequence changes only on successful new starts', async () => {
  const { manager, audio, time } = setup(); manager.start(); await time.advance(400);
  assert.equal(manager.getSnapshot().sequence, 1); audio.emit('ended'); await time.advance(650);
  assert.equal(manager.getSnapshot().track.id, 'b'); assert.equal(manager.getSnapshot().sequence, 2);
  manager.pause(); await time.advance(200); manager.resume(); await time.advance(400);
  assert.equal(manager.getSnapshot().sequence, 2); manager.dispose();
});
test('shuffle excludes immediate repeats, previous uses listening history', async () => {
  const { manager, time } = setup({ shuffle: true }); manager.start(); await time.advance(400);
  assert.equal(manager.getSnapshot().track.id, 'a'); manager.next(); await time.advance(650);
  assert.equal(manager.getSnapshot().track.id, 'b'); manager.previous(); await time.advance(650);
  assert.equal(manager.getSnapshot().track.id, 'a'); manager.dispose();
});
test('rapid switching cancels old transitions; only final source starts', async () => {
  const { manager, audio, time } = setup(); manager.start(); await time.advance(400);
  manager.select('b'); manager.select('c'); manager.select('b'); await time.advance(650);
  assert.deepEqual(audio.plays, ['/a.mp3', '/b.mp3']); assert.equal(manager.getSnapshot().sequence, 2); manager.dispose();
});
test('master gain does not overwrite individual volumes; live slider changes ramp smoothly', async () => {
  const { manager, audio, time, settings } = setup(); manager.start(); await time.advance(400);
  const next = { ...settings, masterVolume: 50, musicVolume: 60 }; manager.setPreferences(next);
  await time.advance(100); assert.ok(audio.volume > 0.3 && audio.volume < 0.32);
  await time.advance(200); assert.equal(audio.volume, 0.3); assert.equal(next.musicVolume, 60);
  assert.equal(categoryGain(next, 'effects'), 0.4); assert.equal(categoryGain(next, 'interface'), 0.3); manager.dispose();
});
test('disable silences immediately and re-enable resumes without restarting or new notice', async () => {
  const { manager, audio, time, settings } = setup(); manager.start(); await time.advance(400);
  audio.currentTime = 30; manager.setPreferences({ ...settings, musicEnabled: false }); await flush();
  assert.equal(audio.volume, 0); assert.equal(audio.paused, true);
  manager.setPreferences(settings); await time.advance(400);
  assert.equal(audio.currentTime, 30); assert.equal(manager.getSnapshot().sequence, 1); manager.dispose();
});
test('match pause preserves position and manual pause is not undone by navigation', async () => {
  const { manager, audio, time } = setup(); manager.start(); await time.advance(400); audio.currentTime = 80;
  manager.setActive(false); await time.advance(200); assert.equal(audio.paused, true);
  manager.setActive(true); await time.advance(400); assert.equal(audio.currentTime, 80);
  manager.pause(); await time.advance(200); manager.setActive(false); manager.setActive(true);
  await time.advance(400); assert.equal(audio.paused, true); manager.dispose();
});
test('navigation during transition cannot resume an old source with new metadata', async () => {
  const { manager, audio, time } = setup(); manager.start(); await time.advance(400);
  manager.select('b'); manager.setActive(false); await time.advance(200);
  manager.setActive(true); await time.advance(650); assert.equal(audio.src, '/b.mp3'); manager.dispose();
});
test('autoplay restriction reports blocked, then user gesture resumes honestly', async () => {
  const { manager, audio, time } = setup(); audio.reject = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
  manager.start(); await flush(); assert.equal(manager.getSnapshot().status, 'blocked'); assert.equal(manager.getSnapshot().sequence, 0);
  audio.reject = null; manager.resume(); await time.advance(400); assert.equal(manager.getSnapshot().status, 'playing');
  assert.equal(manager.getSnapshot().sequence, 1); manager.dispose();
});
test('missing tracks are skipped finitely without freezing or infinite retry', async () => {
  const { manager, audio, time } = setup(); audio.reject = new Error('missing'); manager.start(); await time.advance(100);
  assert.equal(manager.getSnapshot().status, 'error'); assert.equal(audio.plays.length, 3);
  assert.equal(time.timers.size, 0); manager.dispose();
});
test('a stalled media fetch has bounded loading and moves to next track', async () => {
  const { manager, audio, time } = setup(); audio.stalled = true; manager.start(); await time.advance(10001);
  assert.equal(manager.getSnapshot().track.id, 'b'); assert.equal(audio.plays.length, 2);
  manager.dispose(); assert.equal(time.timers.size, 0);
});
test('dispose closes media, removes listeners and settles transition cancellation', async () => {
  const { manager, audio, time } = setup(); manager.start(); await time.advance(100); manager.next();
  manager.dispose(); await flush(); assert.equal(audio.src, ''); assert.equal(audio.paused, true);
  assert.equal(audio.listeners.size, 0); assert.equal(time.timers.size, 0);
});
test('audio preference defaults support old profiles, finite/clamped volumes and partial patches', () => {
  const old = preferences.normalizeUserPreferences({ theme: 'light' });
  assert.deepEqual(old.audio, preferences.DEFAULT_USER_PREFERENCES.audio);
  const next = preferences.applyUserPreferencesPatch(old, { audio: { masterVolume: 0, musicVolume: 101, effectsVolume: -1, interfaceVolume: NaN, musicEnabled: false } });
  assert.equal(next.audio.masterVolume, 0); assert.equal(next.audio.musicVolume, 100); assert.equal(next.audio.effectsVolume, 0);
  assert.equal(next.audio.interfaceVolume, 60); assert.equal(next.audio.musicEnabled, false); assert.equal(next.audio.shuffle, true);
  assert.equal(old.audio.masterVolume, 80);
  assert.deepEqual(preferences.normalizeUserPreferences(JSON.parse(JSON.stringify(next))), next);
});
test('preference writer coalesces slider changes, keeps final snapshot and resolves all callers', async () => {
  const written = [], writer = new PreferenceWriter(async (value) => { written.push(value); });
  const results = await Promise.all([writer.enqueue(1, 10), writer.enqueue(2, 10), writer.enqueue(3, 10)]);
  assert.deepEqual(results, [true, true, true]); assert.deepEqual(written, [3]); writer.close();
});
test('preference writes serialize even if an older write is slow', async () => {
  let release; const written = [];
  const gate = new Promise((resolve) => { release = resolve; });
  const writer = new PreferenceWriter(async (value) => { written.push(value); if (value === 1) await gate; });
  const first = writer.enqueue(1); await new Promise((resolve) => setTimeout(resolve, 10));
  const second = writer.enqueue(2); const third = writer.enqueue(3); release();
  assert.deepEqual(await Promise.all([first, second, third]), [true, true, true]); assert.deepEqual(written, [1, 3]); writer.close();
});
test('failed writes are reported and closed identity queues cannot leak preferences', async () => {
  const writer = new PreferenceWriter(async () => { throw new Error('disk'); });
  assert.equal(await writer.enqueue(1), false); const pending = writer.enqueue(2, 150); writer.close();
  assert.equal(await pending, false); assert.equal(await writer.enqueue(3), false);
});
