import { test, expect } from '@playwright/test';

const issues = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = []; issues.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
});
test.afterEach(async ({ page }) => { expect(issues.get(page)).toEqual([]); });

async function createCareer(page, name) {
  const initialRooms = page.waitForResponse((response) => response.url().endsWith('/api/rooms') && response.request().method() === 'GET');
  await page.goto('/');
  const origin = new URL((await initialRooms).url()).origin;
  await page.getByRole('tab', { name: 'Criar sala', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome da temporada' }).fill(name);
  await page.getByRole('button', { name: 'Criar e escolher clube' }).click();
  await page.getByRole('button', { name: /Clube Alfa.*Livre/ }).click();
  await page.getByRole('button', { name: 'Confirmar Clube Alfa' }).click();
  await page.getByRole('button', { name: 'Iniciar temporada', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Bom jogo/ })).toBeVisible();
  async function read(path) {
    const response = await page.request.get(`${origin}${path}`, { headers: { authorization: 'Bearer owner-token' } });
    expect(response.ok()).toBe(true);
    return response.json();
  }
  const { rooms } = await read('/api/rooms');
  const matches = rooms.filter((room) => room.name === name);
  expect(matches).toHaveLength(1);
  return { read, code: matches[0].code };
}

async function resume(page, name) {
  await page.reload();
  await page.locator('.save-manager__card').filter({ hasText: name }).getByRole('button', { name: /Continuar/ }).click();
  await expect(page.getByRole('heading', { name: /Bom jogo/ })).toBeVisible();
}

test('criar/carregar carreira, calendário, tática e rankings', async ({ page }) => {
  await createCareer(page, 'E2E tática');
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await nav.getByRole('button', { name: 'Calendário', exact: true }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Calendário', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Clube Alfa');
  await nav.getByRole('button', { name: 'Carreira do treinador' }).click();
  await expect(page.getByRole('main')).toContainText('Dona da Sala');
  await nav.getByRole('button', { name: 'Táticas', exact: true }).click();
  await page.getByRole('combobox').first().selectOption('4-4-2');
  await page.getByRole('button', { name: 'Cautelosa', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Plano salvo', exact: true })).toBeVisible();
  const study = page.getByRole('region', { name: 'Estudo tático do clube' });
  await study.getByRole('button', { name: 'Rápido', exact: true }).click();
  await study.getByRole('button', { name: 'Solicitar estudo', exact: true }).click();
  await expect(study).toContainText('Análise em andamento');
  await nav.getByRole('button', { name: 'Elenco', exact: true }).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Buscar jogador no elenco' }).fill('Alfa Jogador 00');
  await expect(page.getByRole('button', { name: 'Abrir perfil de Alfa Jogador 00' })).toBeVisible();
  await nav.getByRole('button', { name: 'Rankings', exact: true }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Rankings', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Clubes', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Clube Beta');
  await resume(page, 'E2E tática');
  await nav.getByRole('button', { name: 'Táticas', exact: true }).click();
  await expect(page.getByRole('combobox').first()).toHaveValue('4-4-2');
  await expect(page.getByRole('button', { name: 'Cautelosa', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(study).toContainText('Análise em andamento');
});

test('scouting e transferência atualizam elenco e histórico após reload', async ({ page }) => {
  const { read, code } = await createCareer(page, 'E2E mercado');
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await nav.getByRole('button', { name: 'Mercado', exact: true }).click();
  await page.getByPlaceholder('Buscar jogador, clube ou posição').fill('Beta Jogador 14');
  const candidate = page.locator('article.market-player').filter({ hasText: 'Beta Jogador 14' });
  await candidate.getByRole('button', { name: 'Abrir perfil de Beta Jogador 14' }).click();
  const profile = page.getByRole('dialog');
  await profile.getByRole('button', { name: 'Observar jogador', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Remover da observação' })).toBeEnabled();
  await profile.getByRole('button', { name: 'Demonstrar interesse', exact: true }).click();
  await profile.getByRole('button', { name: 'Contatar empresário', exact: true }).click();
  await expect(profile.getByRole('region', { name: 'Resposta do empresário' })).toBeVisible();
  await profile.getByRole('button', { name: 'Fechar janela' }).click();
  await resume(page, 'E2E mercado');
  await nav.getByRole('button', { name: 'Mercado', exact: true }).click();
  await page.getByPlaceholder('Buscar jogador, clube ou posição').fill('Beta Jogador 14');
  await candidate.getByRole('button', { name: 'Abrir perfil de Beta Jogador 14' }).click();
  await expect(profile.getByRole('button', { name: 'Remover da observação' })).toBeEnabled();
  await expect(profile.getByRole('button', { name: 'Retirar interesse' })).toBeEnabled();
  await expect(profile.getByRole('region', { name: 'Resposta do empresário' })).toBeVisible();
  await profile.getByRole('button', { name: 'Fechar janela' }).click();
  await candidate.getByRole('button', { name: 'Fazer oferta' }).click();
  await page.getByLabel('SUA OFERTA', { exact: false }).fill('30000000');
  await page.getByLabel('NOVO SALÁRIO MENSAL', { exact: true }).fill('100000');
  await page.getByRole('button', { name: 'Enviar oferta', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav.getByRole('button', { name: 'Elenco', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abrir perfil de Beta Jogador 14' })).toBeVisible();
  await resume(page, 'E2E mercado');
  await nav.getByRole('button', { name: 'Elenco', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abrir perfil de Beta Jogador 14' })).toBeVisible();
  const market = await read(`/api/market/${code}`);
  const snapshot = market.snapshot;
  const transfers = snapshot.transactions.filter((entry) => entry.player.id === 'E2E-1-P14');
  expect(transfers).toHaveLength(1);
  expect(transfers[0]).toMatchObject({ fromClubId: 'E2E-1', toClubId: 'E2E-0', amount: 30_000_000 });
  const buyer = await read(`/api/teams/E2E-0/players?roomCode=${code}`);
  const seller = await read(`/api/teams/E2E-1/players?roomCode=${code}`);
  expect(buyer.players.filter((player) => player.id === 'E2E-1-P14')).toHaveLength(1);
  expect(seller.players.filter((player) => player.id === 'E2E-1-P14')).toHaveLength(0);
});

test('partida pausa no intervalo, recupera sessão e conclui rodada', async ({ page }) => {
  const { read, code } = await createCareer(page, 'E2E partida');
  await page.getByRole('button', { name: 'Estou pronto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Partida pausada para ajustes' })).toBeVisible();
  await resume(page, 'E2E partida');
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Central da partida' }).click();
  await expect(page.getByRole('heading', { name: 'Partida pausada para ajustes' })).toBeVisible();
  await page.getByRole('button', { name: 'Estou pronto para o 2º tempo' }).click();
  await expect(page.getByRole('heading', { name: /Resultados da rodada/ })).toBeVisible();
  const { room } = await read(`/api/rooms/${code}`);
  expect(room.completedFixtureIds.length).toBeGreaterThan(0);
  expect(room.lastCompletedMatch).toBeTruthy();
});
