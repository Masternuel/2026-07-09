import { channel, tracingChannel } from 'node:diagnostics_channel';
import { basename } from 'node:path';
import { record } from './records.mjs';

if (process.env.BOLA_TEST_DIAGNOSTICS_DIR) {
  const started = performance.now();
  const children = new Map();
  const memoryBefore = process.memoryUsage();
  const isTestFile = (arg = '') => /\.test\.(?:mjs|cjs|js)$/.test(arg);
  const testFile = isTestFile(process.argv[1]) ? process.argv[1] : null;
  record('process-start', { ppid: process.ppid, testFile, memoryBefore });
  channel('child_process').subscribe(({ process: child }) => {
    let entry;
    child.once('spawn', () => {
      entry = { childPid: child.pid, started: performance.now(), memoryBefore: process.memoryUsage(),
        testFile: child.spawnargs?.find(isTestFile) ?? null,
        executable: basename(child.spawnfile ?? '') };
      children.set(child, entry);
      record('child-spawn', { ...entry, concurrentProcesses: children.size,
        concurrentTestProcesses: [...children.values()].filter((item) => item.testFile).length });
    });
    child.once('exit', (exitCode, signal) => {
      const concurrentProcesses = children.size;
      const concurrentTestProcesses = [...children.values()].filter((item) => item.testFile).length;
      children.delete(child);
      record('child-exit', { ...entry, childPid: child.pid ?? null, exitCode, signal,
        durationMs: entry ? performance.now() - entry.started : null,
        memoryAfter: process.memoryUsage(), concurrentProcesses, concurrentTestProcesses,
        remainingProcesses: children.size, abnormalExit: exitCode !== 0 || signal !== null });
    });
    child.once('close', (exitCode, signal) => record('child-close', { childPid: child.pid ?? null, exitCode, signal }));
  });
  // Passive observers only: no error/rejection/signal handler that consumes a failure.
  tracingChannel('child_process.spawn').error.subscribe(({ error }) => record('spawn-error', { error }));
  process.on('uncaughtExceptionMonitor', (error, origin) => record('uncaught-exception', { error, origin,
    unhandledRejection: origin === 'unhandledRejection' }));
  process.on('beforeExit', (exitCode) => record('before-exit', { exitCode, resources: process.getActiveResourcesInfo() }));
  process.on('exit', (exitCode) => record('process-exit', { exitCode, testFile,
    durationMs: performance.now() - started, memoryBefore, memoryAfter: process.memoryUsage(),
    openChildPids: [...children.values()].map((entry) => entry.childPid), resources: process.getActiveResourcesInfo() }));
}
