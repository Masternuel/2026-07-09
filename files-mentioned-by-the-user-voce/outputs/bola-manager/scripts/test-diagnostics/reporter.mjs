import { tap } from 'node:test/reporters';
import './preload.mjs';
import { record, sanitize, tail } from './records.mjs';

export default async function* reporter(source) {
  const files = new Map();
  let summarySeen = false;
  let planSeen = false;
  let activeTests = 0;
  async function* observe() {
    for await (const event of source) {
      const { type, data } = event;
      const file = data.file ?? '<runner>';
      const state = files.get(file) ?? { stdout: '', stderr: '', summarySeen: false,
        uncaughtExceptionObserved: false, unhandledRejectionObserved: false };
      files.set(file, state);
      if (type === 'test:dequeue') activeTests++;
      if (type === 'test:complete') activeTests = Math.max(0, activeTests - 1);
      if (type === 'test:stdout' || type === 'test:stderr') {
        const stream = type === 'test:stdout' ? 'stdout' : 'stderr';
        state[stream] = tail(state[stream] + data.message);
      }
      const failureType = data.details?.error?.failureType;
      if (failureType === 'uncaughtException') state.uncaughtExceptionObserved = true;
      if (failureType === 'unhandledRejection') state.unhandledRejectionObserved = true;
      if (type === 'test:diagnostic' && (data.level === 'error' || /uncaughtException|unhandledRejection/.test(data.message))) {
        record('test-error-diagnostic', { file, message: data.message });
      }
      if (type === 'test:fail') record('test-failure', { ...data, activeTests, ...state });
      if (type === 'test:summary') {
        state.summarySeen = true;
        if (!data.file) summarySeen = true;
        record('test-summary', data);
      }
      if (type === 'test:plan' && data.nesting === 0) planSeen = true;
      yield event;
    }
  }
  // Children use Node's serialized event protocol, not TAP. Keep that distinction explicit.
  for await (const chunk of tap(observe())) yield sanitize(chunk);
  record('reporter-end', { planSeen, summarySeen, tapComplete: planSeen && summarySeen,
    filesWithoutSummary: [...files].filter(([file, state]) => file !== '<runner>' && !state.summarySeen).map(([file]) => file) });
}
