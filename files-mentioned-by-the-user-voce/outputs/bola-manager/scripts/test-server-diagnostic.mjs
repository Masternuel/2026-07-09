import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitize, tail, completion } from './test-diagnostics/records.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [runId, ...requested] = process.argv.slice(2);
if (!/^[a-zA-Z0-9-]{1,80}$/.test(runId ?? '')) throw new Error('Informe um run-id exclusivo (letras, numeros, hifen).');
const files = requested.length ? requested : readdirSync(join(root, 'server/tests')).filter((name) => name.endsWith('.test.mjs')).sort();
if (!files.length || files.some((name) => !/^[a-zA-Z0-9-]+\.test\.mjs$/.test(name))) throw new Error('Informe somente nomes de arquivos server/tests/*.test.mjs.');
const directory = join(root, '.tmp', 'test-diagnostics', runId);
mkdirSync(join(root, '.tmp', 'test-diagnostics'), { recursive: true });
mkdirSync(directory); // Exclusive run directory: never overwrite the first failure.
const env = { ...process.env, BOLA_ENV_FILES: 'false', BOLA_TEST_DIAGNOSTICS_DIR: directory };
for (const key of Object.keys(env)) {
  if (/^(TEST_REDIS_URL|REDIS_URL|STAGING_|FIREBASE_|VITE_FIREBASE_|CLOUDINARY_|GEMINI_|GOOGLE_APPLICATION_CREDENTIALS|FIRESTORE_EMULATOR_HOST|STORAGE_EMULATOR_HOST|NODE_OPTIONS)/.test(key)) delete env[key];
}
const before = process.memoryUsage();
const started = performance.now();
const args = ['--import', './scripts/test-diagnostics/preload.mjs', '--test', '--test-concurrency=1',
  '--test-reporter', './scripts/test-diagnostics/reporter.mjs', ...files.map((name) => `server/tests/${name}`)];
const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
const tails = { stdout: '', stderr: '' };
let planSeen = false;
let summarySeen = false;
let diagnosticsWriteFailed = false;
const counts = {};
for (const stream of ['stdout', 'stderr']) {
  let pending = '';
  const consume = (line) => {
    const safe = sanitize(line);
    if (safe.includes('BOLA_TEST_DIAGNOSTICS_WRITE_FAILED')) diagnosticsWriteFailed = true;
    appendFileSync(join(directory, `${stream}.log`), safe, { mode: 0o600 });
    tails[stream] = tail(tails[stream] + safe);
    if (stream !== 'stdout') return;
    if (/^1\.\.\d+\s*$/.test(safe)) planSeen = true;
    if (/^# duration_ms /.test(safe)) summarySeen = true;
    const match = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)/.exec(safe);
    if (match) counts[match[1]] = Number(match[2]);
  };
  child[stream].setEncoding('utf8');
  child[stream].on('data', (chunk) => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) !== -1) { consume(pending.slice(0, end + 1)); pending = pending.slice(end + 1); }
  });
  child[stream].on('end', () => { if (pending) consume(pending); });
}
child.once('error', (error) => {
  writeFileSync(join(directory, 'spawn-error.log'), sanitize(`${error.name}: ${error.message}`));
  process.exitCode = 1;
});
child.once('close', (exitCode, signal) => {
  const result = { runId, ...completion({ exitCode, signal, planSeen, summarySeen }), childPid: child.pid ?? null,
    durationMs: performance.now() - started, fileCount: files.length, configuredConcurrency: 1,
    memoryBefore: before, memoryAfter: process.memoryUsage(), diagnosticsWriteFailed, counts, ...tails };
  writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ runId, exitCode, signal, tapComplete: result.tapComplete, diagnosticsWriteFailed, counts }));
  process.exitCode = exitCode ?? 1;
});
