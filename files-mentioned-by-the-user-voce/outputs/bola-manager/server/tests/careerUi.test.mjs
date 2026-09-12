import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const attributes = {
  velocidade: 7, chute: 6, drible: 7, nocao: 8, defesa: 6, passe: 8, peBom: 8, peRuim: 4,
  forca: 7, resistencia: 8, impulsao: 6, reflexos: 5, posicionamentoGol: 5, saidaGol: 5, penaltis: 5,
};

const club = { id: 'SAN', code: 'SAN', name: 'Santos', crestImageUrl: null };

function player(overrides = {}) {
  return {
    id: 'SAN-MC-8', clubId: 'SAN', name: 'Joao Carreira', shortName: 'Carreira', isStar: false,
    number: 8, position: 'MC', role: 'Meia central', age: 22, nationality: 'Brasil', value: 8_000_000,
    wage: 30_000, condition: 100, morale: 'Boa', status: 'Disponivel', foot: 'Direito',
    personality: 'Profissional', worldStar: 2, overall: 14, potential: 17, attributes,
    contract: { clubId: 'SAN', startSeason: 1, endSeason: 4, wage: 42_000, status: 'active', renewalCount: 1 },
    ...overrides,
  };
}

import { withTestAuth } from './helpers/withTestAuth.mjs';

let vite;
let PlayerCareerActions;
let SquadView;
let normalizeCareerSnapshot;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  ({ PlayerCareerActions } = await vite.ssrLoadModule('/src/components/player/PlayerCareerActions.tsx'));
  ({ SquadView } = await vite.ssrLoadModule('/src/views/SquadView.tsx'));
  SquadView = await withTestAuth(vite, SquadView);
  ({ normalizeCareerSnapshot } = await vite.ssrLoadModule('/src/hooks/useCareerState.ts'));
});

after(async () => {
  await vite?.close();
});

function fold(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

test('normaliza contrato, treino, base e convocacao sem propagar valores invalidos', () => {
  const career = normalizeCareerSnapshot({
    currentSeason: '3',
    players: [{
      id: 'academy-1', name: 'Talento', position: 'invalida', age: 12, overall: 90, potential: -4,
      academy: true, clubId: 'SAN', wage: 2_000,
      contract: { endSeason: '6', wage: '5000', status: 'academy' },
      training: { playerId: 'academy-1', focus: 'attacking', intensity: 'high' },
    }, null],
    trainingPlans: [{ playerId: 'academy-1', focus: 'physical', intensity: 'high' }, { focus: 'balanced' }],
    nationalSquads: [{ teamId: 'BRA', seasonNumber: 3, playerIds: ['academy-1', '', null] }],
  });

  assert.equal(career.currentSeason, 3);
  assert.equal(career.players.length, 1);
  assert.equal(career.players[0].position, 'MC');
  assert.equal(career.players[0].age, 14);
  assert.equal(career.players[0].overall, 20);
  assert.equal(career.players[0].potential, 1);
  assert.equal(career.players[0].academy, true);
  assert.equal(career.players[0].contract.endSeason, 6);
  assert.equal(career.players[0].contract.wage, 5_000);
  assert.equal(career.players[0].training.focus, 'attacking');
  assert.deepEqual(career.nationalSquads[0].playerIds, ['academy-1']);
  assert.equal(career.trainingPlans.length, 1);
});

test('acoes do perfil senior mostram treino, renovacao e convocacao', () => {
  const html = renderToStaticMarkup(React.createElement(PlayerCareerActions, {
    player: player(),
    currentSeason: 3,
    trainingPlan: { playerId: 'SAN-MC-8', focus: 'technical', intensity: 'high', active: true },
    nationalTeam: 'BRA',
    available: true,
    async onSaveTraining() {},
    async onRenewContract() {},
  }));
  const text = fold(html);

  assert.match(text, /RENOVAR CONTRATO/i);
  assert.match(text, /PLANO DE TREINO/i);
  assert.match(text, /Salvar treino/i);
  assert.match(text, /Renovar contrato/i);
  assert.match(text, /Convocado.*BRA/i);
  assert.match(text, /TEMPORADA 3/i);
});

test('elenco separa principal e Sub-20, e modal permite promover talento', () => {
  const academyPlayer = player({
    id: 'SAN-ACA-10', name: 'Talento da Base', shortName: 'Talento', age: 17, academy: true, youth: true,
    careerStage: 'academy', wage: 2_000, potential: 19,
    contract: { clubId: 'SAN', startSeason: 2, endSeason: null, wage: 2_000, status: 'academy', renewalCount: 0 },
  });
  const career = {
    currentSeason: 3,
    players: [academyPlayer],
    trainingPlans: [],
    nationalSquads: [],
    lastSummary: null,
  };
  const inertCareerState = {
    career, loading: false, error: null, mutationKey: null,
    refresh() {}, async saveTraining() { return null; }, async renewContract() { return null; },
    async promoteAcademyPlayer() { return null; },
  };
  const squadHtml = renderToStaticMarkup(React.createElement(SquadView, {
    players: [player(), academyPlayer], club, room: null, socket: null, managerId: '', careerState: inertCareerState,
    onRosterChanged() {}, onToast() {},
  }));

  assert.match(squadHtml, /Ver Sub-20 \(1\)/i);
  assert.doesNotMatch(squadHtml, /Talento da Base/);

  const modalHtml = fold(renderToStaticMarkup(React.createElement(PlayerCareerActions, {
    player: academyPlayer,
    currentSeason: 3,
    available: true,
    async onSaveTraining() {},
    async onPromoteAcademy() {},
  })));
  assert.match(modalHtml, /PROMOVER AO PRINCIPAL/i);
  assert.match(modalHtml, /Promover jogador/i);
});

test('hook aponta para endpoints e metodos de carreira do servidor', async () => {
  const source = await readFile(path.join(projectRoot, 'src/hooks/useCareerState.ts'), 'utf8');
  assert.match(source, /\/career\/training', 'PUT'/);
  assert.match(source, /\/career\/contracts\/renew', 'POST'/);
  assert.match(source, /\/career\/academy\/promote', 'POST'/);
  assert.match(source, /\/api\/rooms\/\$\{encodeURIComponent\(code\)\}\/career/);
});
