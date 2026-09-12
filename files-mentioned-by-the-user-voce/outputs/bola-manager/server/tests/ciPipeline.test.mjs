import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import config from '../../playwright.config.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('CI exige qualidade e E2E sem ignorar falhas', async () => {
  const workflow = await read('../../../../../.github/workflows/bola-manager-ci.yml');
  const { scripts } = JSON.parse(await read('../../package.json'));
  for (const command of ['typecheck', 'build', 'test:server', 'test:frontend', 'test:e2e']) {
    assert.ok(scripts[command], command);
    assert.ok(workflow.includes(`run: npm run ${command}`), command);
  }
  assert.match(workflow, /needs: \[quality, smoke\]/);
  assert.match(workflow, /test "\$QUALITY" = success && test "\$SMOKE" = success/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /continue-on-error|pull_request_target|secrets\./);
});

test('E2E isola autenticação e artefatos do build de produção', async () => {
  const entry = await read('../../src/main.tsx');
  const setup = await read('../../e2e/server.mjs');
  assert.doesNotMatch(entry, /e2e\/|owner-token/);
  assert.match(setup, /configFile: false, envFile: false/);
  assert.match(setup, /MemoryRoomPersistence/);
  assert.equal(config.globalSetup, './e2e/server.mjs');
  assert.equal(config.outputDir, '.tmp/e2e/results');
  assert.equal(config.use.trace, 'retain-on-failure');
  assert.equal(config.use.screenshot, 'only-on-failure');
  assert.equal(config.retries, 0);
  assert.equal(config.workers, 1);
});
