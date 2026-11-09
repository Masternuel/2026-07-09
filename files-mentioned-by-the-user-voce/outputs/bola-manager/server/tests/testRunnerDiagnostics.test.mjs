import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { sanitizer, completion } from '../../scripts/test-diagnostics/records.mjs';

const preload = new URL('../../scripts/test-diagnostics/preload.mjs', import.meta.url).href;
const reporter = new URL('../../scripts/test-diagnostics/reporter.mjs', import.meta.url).href;

async function probe(context, source, { testRunner = false, kill = null, env = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'bola-test-diagnostics-'));
  context.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  const args = ['--import', preload];
  if (testRunner) args.push('--test', '--test-reporter', reporter);
  const fixture = join(directory, 'probe.test.cjs');
  if (testRunner) writeFileSync(fixture, source);
  args.push(...(testRunner ? [fixture] : ['--input-type=module', '--eval', source]));
  const childEnv = { ...process.env, ...env, BOLA_TEST_DIAGNOSTICS_DIR: directory };
  delete childEnv.NODE_TEST_CONTEXT;
  // Fixtures supply their own import/reporter flags; inherited reporters accumulate in Node.
  delete childEnv.NODE_OPTIONS;
  const child = spawn(process.execPath, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; if (kill && stdout.includes('ready')) child.kill(kill); });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })); });
  const records = readdirSync(directory).filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => readFileSync(join(directory, name), 'utf8').trim().split('\n').map(JSON.parse));
  return { ...result, stdout, stderr, records };
}

test('diagnostic redaction removes credentials before truncation without logging environment', () => {
  const clean = sanitizer({ PRIVATE_KEY: 'opaque-value-test-only', PATH: 'visible-path' });
  const result = clean('opaque-value-test-only Bearer abc-secret https://user:pass@host token=hello');
  for (const value of ['opaque-value-test-only', 'abc-secret', 'user:pass', 'hello']) assert.ok(!result.includes(value));
  assert.equal(clean('visible-path'), 'visible-path');
});

test('diagnostics distinguishes abnormal exit from incomplete TAP', () => {
  assert.deepEqual(completion({ exitCode: 23, signal: null, planSeen: false, summarySeen: false }),
    { exitCode: 23, signal: null, abnormalExit: true, tapComplete: false, summarySeen: false });
  assert.equal(completion({ exitCode: 1, signal: null, planSeen: true, summarySeen: true }).tapComplete, true);
  assert.equal(completion({ exitCode: null, signal: 'SIGKILL', planSeen: true, summarySeen: false }).tapComplete, false);
});

test('preload preserves explicit nonzero exit and records process identity/memory', async (context) => {
  const result = await probe(context, 'process.exit(23)');
  assert.equal(result.exitCode, 23, result.stderr);
  const exit = result.records.find((row) => row.kind === 'process-exit');
  assert.equal(exit.exitCode, 23);
  assert.ok(exit.pid > 0 && exit.durationMs >= 0 && exit.memoryBefore.rss > 0 && exit.memoryAfter.rss > 0);
});

for (const [name, source, origin] of [
  ['uncaughtException', 'queueMicrotask(() => { throw new Error("probe-exception"); })', 'uncaughtException'],
  ['unhandledRejection', 'Promise.reject(new Error("probe-rejection"))', 'unhandledRejection'],
]) test(`preload observes ${name} without suppressing Node failure`, async (context) => {
  const result = await probe(context, source);
  assert.equal(result.exitCode, 1);
  assert.ok(result.records.some((row) => row.kind === 'uncaught-exception' && row.origin === origin));
});

test('preload captures child exit code and concurrency without consuming streams', async (context) => {
  const result = await probe(context, `import {spawn} from 'node:child_process';
    const child = spawn(process.execPath, ['-e', 'process.exit(29)'], {stdio: 'ignore'});
    child.on('exit', code => { if (code !== 29) process.exitCode = 9; });`);
  assert.equal(result.exitCode, 0);
  const exit = result.records.find((row) => row.kind === 'child-exit');
  assert.equal(exit.exitCode, 29);
  assert.equal(exit.signal, null);
  assert.equal(exit.concurrentProcesses, 1);
  assert.equal(exit.remainingProcesses, 0);
  assert.ok(exit.childPid > 0 && exit.memoryBefore.rss > 0 && exit.memoryAfter.rss > 0);
});

for (const signal of ['SIGTERM', 'SIGKILL']) test(`preload does not intercept ${signal}`, async (context) => {
  const result = await probe(context, 'console.log("ready"); setInterval(() => {}, 1000)', { kill: signal });
  assert.equal(result.signal, signal);
  assert.equal(result.exitCode, null);
  assert.ok(!result.records.some((row) => row.kind === 'process-exit'));
});

test('reporter preserves test failure and redacts stdout/stderr/error diagnostics', async (context) => {
  const result = await probe(context, `const {test} = require('node:test');
    test('diagnostic fixture', () => { console.log('opaque-fixture-secret'); console.error('Bearer fixture-bearer'); throw new Error('token=fixture-token'); });`,
  { testRunner: true, env: { DIAGNOSTIC_SECRET: 'opaque-fixture-secret' } });
  assert.equal(result.exitCode, 1, result.stderr);
  const serialized = JSON.stringify(result.records) + result.stdout;
  for (const secret of ['opaque-fixture-secret', 'fixture-bearer', 'fixture-token']) assert.ok(!serialized.includes(secret));
  const failure = result.records.find((row) => row.kind === 'test-failure');
  assert.ok(failure?.details.error.message.includes('[REDACTED]'), result.stderr + result.stdout);
  assert.ok(result.records.some((row) => row.kind === 'reporter-end' && row.tapComplete));
  assert.ok(result.records.some((row) => row.kind === 'child-exit' && row.exitCode === 1 && row.childPid > 0));
});

test('diagnostic write failure does not replace the original process exit', async (context) => {
  const records = new URL('../../scripts/test-diagnostics/records.mjs', import.meta.url).href;
  const result = await probe(context, `import {record} from ${JSON.stringify(records)};
    process.env.BOLA_TEST_DIAGNOSTICS_DIR += '/missing-directory'; record('probe'); process.exit(23);`);
  assert.equal(result.exitCode, 23);
  assert.match(result.stderr, /BOLA_TEST_DIAGNOSTICS_WRITE_FAILED/);
  assert.equal(result.stderr.trim().split('\n').length, 1);
});

test('reporter retains child exit code and detects missing child summary despite complete outer TAP', async (context) => {
  const result = await probe(context, 'process.exit(31)', { testRunner: true });
  assert.equal(result.exitCode, 1);
  assert.ok(result.records.some((row) => row.kind === 'child-exit' && row.exitCode === 31 && row.signal === null));
  assert.ok(result.records.some((row) => row.kind === 'test-failure' && row.details.error.exitCode === 31));
  assert.ok(result.records.some((row) => row.kind === 'reporter-end' && row.tapComplete && row.filesWithoutSummary.length > 0));
});

test('diagnostic fixtures do not inherit a second reporter from NODE_OPTIONS', async (context) => {
  const result = await probe(context, "require('node:test').test('fixture', () => {});", {
    testRunner: true, env: { NODE_OPTIONS: '--test-reporter=missing-parent-reporter' },
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.records.some((row) => row.kind === 'reporter-end' && row.tapComplete));
});
