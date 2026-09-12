import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: '**/*.spec.mjs',
  fullyParallel: false, workers: 1,
  forbidOnly: Boolean(process.env.CI), retries: 0,
  timeout: 90_000, expect: { timeout: 15_000 },
  outputDir: '.tmp/e2e/results',
  reporter: [['list'], ['html', { outputFolder: '.tmp/e2e/report', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5191',
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  globalSetup: './e2e/server.mjs',
});
