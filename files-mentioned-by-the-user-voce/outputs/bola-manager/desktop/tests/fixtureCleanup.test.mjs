import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { removeFixtureDirectory } from './helpers/fixtureCleanup.mjs';

const root = resolve('.tmp/editor-cleanup-tests');
async function fixture(t) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  t.after(() => removeFixtureDirectory(root, directory));
  const profile = join(directory, 'profile');
  await mkdir(profile);
  return { directory, profile };
}

async function holdFile(file) {
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  const windows = process.platform === 'win32';
  const command = windows ? join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : process.execPath;
  const script = windows
    ? "$file=[System.IO.File]::Open($env:EDITOR_FIXTURE_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); [Console]::WriteLine('ready'); [Console]::ReadLine() | Out-Null; $file.Dispose()"
    : "const fs=require('node:fs'); const fd=fs.openSync(process.env.EDITOR_FIXTURE_FILE,'r'); console.log('ready'); process.stdin.once('data',()=>{fs.closeSync(fd);process.stdin.destroy();});";
  const child = spawn(command, windows ? ['-NoProfile', '-NonInteractive', '-Command', script] : ['-e', script], {
    env: { ...env, EDITOR_FIXTURE_FILE: file }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const exited = once(child, 'exit');
  let timer;
  const release = async () => {
    if (!child.stdin.destroyed) child.stdin.end('\n');
    let stopTimer;
    try {
      const [code, signal] = await Promise.race([exited, new Promise((_, reject) => {
        stopTimer = setTimeout(() => { child.kill(); reject(new Error('Test reader did not stop')); }, 3000);
      })]);
      assert.equal(code, 0); assert.equal(signal, null);
    } finally { clearTimeout(stopTimer); }
  };
  try {
    await Promise.race([
      new Promise((done, reject) => {
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk.toString(); if (output.includes('ready')) done(); });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('Test reader exited before ready')));
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test reader did not become ready')), 3000); }),
    ]);
    return release;
  } catch (error) { await release(); throw error; }
  finally { clearTimeout(timer); }
}

test('Editor fixture cleanup uses bounded native retries and a verified absolute child path', async (t) => {
  const { directory, profile } = await fixture(t);
  const calls = [];
  await removeFixtureDirectory(directory, profile, { remove: async (...args) => calls.push(args) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], profile);
  assert.deepEqual(calls[0][1], { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
});

test('Editor fixture cleanup cannot remove the root, an outside path or a junction', async (t) => {
  const { directory, profile } = await fixture(t);
  const outside = join(directory, 'preserved');
  await mkdir(outside); await writeFile(join(outside, 'marker'), 'preserved');
  let calls = 0;
  const options = { remove: async () => { calls += 1; } };
  await assert.rejects(removeFixtureDirectory(profile, profile, options), { code: 'TEST_CLEANUP_UNSAFE' });
  await assert.rejects(removeFixtureDirectory(profile, outside, options), { code: 'TEST_CLEANUP_UNSAFE' });
  const link = join(profile, 'alias');
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(removeFixtureDirectory(profile, link, options), { code: 'TEST_CLEANUP_UNSAFE' });
  assert.equal(calls, 0);
  assert.equal(await readFile(join(outside, 'marker'), 'utf8'), 'preserved');
});

test('Editor fixture cleanup preserves a persistent deletion error instead of hiding it', async (t) => {
  const { directory, profile } = await fixture(t);
  const failure = Object.assign(new Error('Fixture remains busy'), { code: 'EBUSY' });
  await assert.rejects(removeFixtureDirectory(directory, profile, { remove: async () => { throw failure; } }), (error) => error === failure);
  assert.equal((await stat(profile)).isDirectory(), true);
});

test('Editor fixture cleanup tolerates a transient real file reader without skipping assertions', { timeout: 10000 }, async (t) => {
  const { directory, profile } = await fixture(t);
  const file = join(profile, 'fixture.bin');
  await writeFile(file, 'disposable test data');
  const release = await holdFile(file);
  let releaseTimer, released;
  try {
    if (process.platform === 'win32') {
      await assert.rejects(rm(profile, { recursive: true, force: true }), (error) => ['EBUSY', 'EPERM'].includes(error.code));
      await assert.rejects(removeFixtureDirectory(directory, profile), (error) => ['EBUSY', 'EPERM'].includes(error.code));
      assert.equal(await readFile(file, 'utf8'), 'disposable test data');
    }
    released = new Promise((done, reject) => { releaseTimer = setTimeout(() => { release().then(done, reject); }, 50); });
    await removeFixtureDirectory(directory, profile);
    await released;
    await assert.rejects(stat(profile), { code: 'ENOENT' });
  } finally {
    clearTimeout(releaseTimer);
    if (released) await released; else await release();
  }
});

test('Editor fixture cleanup is idempotent for an already removed owned directory', async (t) => {
  const { directory, profile } = await fixture(t);
  await removeFixtureDirectory(directory, profile);
  await removeFixtureDirectory(directory, profile);
});
