import { test, expect } from '@playwright/test';

test('menu organiza as áreas sem carregar uma carreira e preserva o formulário', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Menu principal', exact: true });
  await expect(nav).toBeVisible();
  for (const name of ['Carreira', 'Novo Jogo', 'Continuar', 'Multiplayer', 'Editor', 'Configurações', 'Perfil', 'Estatísticas / histórico', 'Créditos']) {
    await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await nav.getByRole('button', { name: 'Novo Jogo', exact: true }).click();
  const nameField = page.getByRole('textbox', { name: 'Nome da temporada', exact: true });
  await nameField.fill('Formulário preservado');
  const roomReads = [];
  const watch = (request) => {
    if (request.method() === 'GET' && /\/api\/rooms\/[^/?]+(?:\?|$)/.test(new URL(request.url()).pathname)) roomReads.push(request.url());
  };
  page.on('request', watch);
  await nav.getByRole('button', { name: 'Estatísticas / histórico', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Estatísticas / histórico', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Não é um histórico global de conquistas');
  await nav.getByRole('button', { name: 'Perfil', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Dona da Sala');
  await nav.getByRole('button', { name: 'Créditos', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Bola Manager');
  page.off('request', watch);
  expect(roomReads).toEqual([]);
  await nav.getByRole('button', { name: 'Novo Jogo', exact: true }).click();
  await expect(nameField).toHaveValue('Formulário preservado');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(nameField).toHaveValue('Formulário preservado');
  expect(errors).toEqual([]);
});

test('menu permanece navegável sem corte horizontal em resoluções pequenas', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Menu principal', exact: true });
  await expect(nav).toBeVisible();
  for (const name of ['Carreira', 'Novo Jogo', 'Multiplayer', 'Editor', 'Perfil', 'Estatísticas / histórico', 'Créditos']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await nav.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Configurações');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
