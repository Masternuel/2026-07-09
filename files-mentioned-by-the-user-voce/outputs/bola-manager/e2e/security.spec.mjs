import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { HTTP_CSP } from '../shared/imagePolicy.mjs';

test('HTTP CSP bloqueia iframe externo e preserva abertura direta', async ({ page, baseURL }) => {
  const direct = await page.goto('/');
  expect(direct.headers()['content-security-policy']).toBe(HTTP_CSP);
  expect(direct.headers()['x-frame-options']).toBe('DENY');
  await expect(page.getByRole('tab', { name: 'Criar sala', exact: true })).toBeVisible();
  // Different origin, same network address space: exercise framing, not Chrome's LNA guard.
  const outer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<html><body><iframe src="${baseURL}/"></iframe></body></html>`);
  });
  await new Promise((resolve) => outer.listen(0, '127.0.0.1', resolve));
  try {
    const blocked = page.waitForEvent('console', { predicate: (message) => /frame-ancestors|X-Frame-Options/i.test(message.text()) });
    await page.goto(`http://127.0.0.1:${outer.address().port}/`);
    await blocked;
    expect(page.frames().some((frame) => frame.url() === `${baseURL}/`)).toBe(false);
    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Criar sala', exact: true })).toBeVisible();
  } finally {
    await new Promise((resolve) => { outer.close(resolve); outer.closeAllConnections(); });
  }
});
