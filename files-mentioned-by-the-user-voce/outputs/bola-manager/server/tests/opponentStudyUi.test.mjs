import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { studyRoom, studyRoster } from './fixtures/tacticalStudyData.mjs';
import { buildClubTacticalStudy, startTacticalStudy, tacticalStudyContext } from '../game/clubTacticalStudy.mjs';

let vite, parse, Panel;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
    envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  parse = (await vite.ssrLoadModule('/src/services/opponentStudyService.ts')).parseOpponentStudy;
  Panel = (await vite.ssrLoadModule('/src/components/tactics/OpponentStudyPanel.tsx')).OpponentStudyPanel;
});
after(async () => { await vite?.close(); });
function report(ready = true) {
  const room = studyRoom();
  if (ready) {
    startTacticalStudy(room, 'uid-owner', { clubId: 'OPP', depth: 'deep' });
    room.clubCareerState.currentDate = '2026-07-12T00:00:00.000Z';
  }
  return buildClubTacticalStudy(room, tacticalStudyContext(room, 'uid-owner', 'OPP'), studyRoster(), 'deep');
}
function render(study, changes = {}) {
  return renderToStaticMarkup(React.createElement(Panel, { controller: {
    study, loading: false, pending: false, error: null, depth: 'deep',
    setDepth() {}, refresh() {}, start() {}, ...changes,
  } }));
}

test('DTO real e aceito; ausencia de proximo adversario difere de erro de clube selecionado', () => {
  const study = parse({ study: report() }, 'OPP', 'VIEW');
  assert.equal(study.probableFormation, '4-4-2');
  assert.equal(study.probableLineup.length, 11);
  assert.equal(parse({ study: null }), null);
  assert.throws(() => parse({ study: null }, 'OPP'), /inválido/);
  assert.throws(() => parse({ study }, 'OTHER'), /outro clube/);
  assert.throws(() => parse({ study }, 'OPP', 'OTHER'), /outro clube/);
  assert.equal(study.knowledge.earned, undefined, 'campos internos nao pertencem ao DTO da interface');
});

test('DTO malformado nao causa tela preta nem sucesso falso', () => {
  const study = report();
  const invalid = [null, {}, { study: {} }, { study: { ...study, estimatedStudyHours: undefined } },
    { study: { ...study, probableLineup: [null] } }, { study: { ...study, confidence: NaN } },
    { study: { ...study, effectiveDepth: 'magic' } }, { study: { ...study, dataStatus: 'fake' } },
    { study: { ...study, knowledge: { status: 'studying', progress: 10, readyAt: null } } },
    { study: { ...study, knowledge: { status: 'studying', progress: 10, readyAt: 'invalid' } } }];
  for (const value of invalid) assert.throws(() => parse(value), /inválido/);
});

test('painel mostra conhecimento real, ausencia, progresso, erro e dados parciais', () => {
  assert.match(render(parse({ study: report(false) })), /Nenhuma análise registrada/);
  assert.doesNotMatch(render(parse({ study: report(false) })), /Onze provável/);
  const study = parse({ study: report() });
  assert.match(render(study), /4-4-2/);
  assert.match(render(study), /OPP Atleta/);
  assert.doesNotMatch(render(study), /5-4-1|aggressive|SECRET_NEVER_EXPOSE/);
  assert.match(render(study, { pending: true }), /Salvando…/);
  assert.match(render(null, { loading: true }), /Carregando estudo/);
  assert.match(render(null, { error: 'Persistência indisponível' }), /role="alert"/);
  assert.match(render({ ...study, dataStatus: 'partial' }), /Análise parcial/);
  assert.match(render({ ...study, knowledge: { status: 'expired' } }), /Relatório desatualizado/);
  assert.match(render({ ...study, knowledge: { status: 'studying', progress: 20, readyAt: '2026-07-12T12:00:00Z' } }), /20%/);
});

test('hook isola usuario, sala, clube, profundidade e revisao e descarta respostas atrasadas', async () => {
  const hook = await readFile(new URL('../../src/hooks/useOpponentStudy.ts', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  assert.match(hook, /\[identity\?\.uid, code, viewerClubId, clubId, depth, revision\]/);
  assert.match(hook, /result\?\.scope === scope && enabled/);
  assert.match(hook, /current\.current === scope && id === sequence\.current/);
  assert.match(hook, /request\.current\?\.abort\(\)/);
  assert.match(hook, /query\.set\('clubId', clubId\)/);
  assert.match(hook, /if \(!busy\.current\) void refresh\(\)/);
  assert.match(app, /\['home', 'tactics', 'match'\]\.includes\(route\)/);
  assert.doesNotMatch(hook, /localStorage|sessionStorage|managerId:/);
});
