import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactLogValue, redactText } from '../../server/infrastructure/redaction.mjs';

export function sanitizer(env = process.env) {
  const secrets = Object.entries(env)
    .filter(([key, value]) => /secret|password|token|credential|api.?key|private.?key|authorization|cookie|redis_url|database_url/i.test(key) && value?.length >= 4)
    .map(([, value]) => value).sort((a, b) => b.length - a.length);
  return (text) => {
    let safe = String(text);
    for (const secret of secrets) safe = safe.replaceAll(secret, '[REDACTED]');
    return redactText(safe);
  };
}

export const sanitize = sanitizer();
export const tail = (value, limit = 16_384) => sanitize(value).slice(-limit);
let writeWarning = false;

export function record(kind, data = {}) {
  if (!process.env.BOLA_TEST_DIAGNOSTICS_DIR) return;
  try {
    const safe = redactLogValue({ time: new Date().toISOString(), pid: process.pid, kind, ...data });
    const line = JSON.stringify(safe, (_key, value) => typeof value === 'string' ? sanitize(value) : value);
    appendFileSync(join(process.env.BOLA_TEST_DIAGNOSTICS_DIR, `${process.pid}.jsonl`), `${line}\n`, { mode: 0o600 });
  } catch {
    // Diagnostics must not turn a passing test into a different process failure.
    if (!writeWarning) process.stderr.write('BOLA_TEST_DIAGNOSTICS_WRITE_FAILED\n');
    writeWarning = true;
  }
}

export function completion({ exitCode, signal, planSeen, summarySeen }) {
  return { exitCode, signal, abnormalExit: exitCode !== 0 || signal !== null,
    tapComplete: Boolean(planSeen && summarySeen), summarySeen: Boolean(summarySeen) };
}
