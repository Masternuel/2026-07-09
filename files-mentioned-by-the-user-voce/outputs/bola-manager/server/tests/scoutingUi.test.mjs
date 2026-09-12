import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

let vite;
let service;
const record = { clubId: 'A', playerId: 'p1', playerName: 'Jogador real', watching: true, interested: false, agentContact: null };
const snapshot = { clubId: 'A', revision: 4, records: [record], history: [] };
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
    envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
    define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify('http://scouting.test') } });
  service = await vite.ssrLoadModule('/src/services/scoutingService.ts');
});
after(async () => { await vite?.close(); });

test('snapshot distingue vazio valido de resposta ausente, corrompida ou de outro clube', () => {
  assert.equal(service.parseScoutingSnapshot({ snapshot }), snapshot);
  assert.deepEqual(service.parseScoutingSnapshot({ snapshot: { ...snapshot, records: [] } }).records, []);
  for (const response of [null, {}, { snapshot: {} }, { snapshot: { ...snapshot, records: null } },
    { snapshot: { ...snapshot, records: [{ ...record, clubId: 'B' }] } },
    { snapshot: { ...snapshot, records: [{ ...record, watching: 'true' }] } },
    { snapshot: { ...snapshot, records: [{ ...record, agentContact: { status: 'open', message: 'ok', contactedAt: 'invalido' } }] } }]) {
    assert.throws(() => service.parseScoutingSnapshot(response), /inválida/);
  }
});

test('servico envia credencial e intent estavel, sem managerId fornecido pelo cliente', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ snapshot });
  });
  const credentials = { identity: { uid: 'manager', mode: 'firebase' }, getIdToken: async () => 'test-token' };
  await service.loadScouting('BOLA-TEST', 'p1', credentials);
  const input = { clubId: 'A', playerId: 'p1', action: 'watch', operationId: 'same-intent' };
  await service.saveScouting('BOLA-TEST', input, credentials);
  assert.match(String(calls[0].url), /\/api\/scouting\/BOLA-TEST\?playerId=p1$/);
  assert.equal(new Headers(calls[1].options.headers).get('authorization'), 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), input);
  assert.equal(calls[1].options.method, 'POST');
});

test('erro HTTP nao vira snapshot vazio nem sucesso de observacao', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Persistencia indisponivel', code: 'STORE_UNAVAILABLE' } }, { status: 503 }));
  await assert.rejects(service.loadScouting('BOLA-TEST', 'p1', {
    identity: { uid: 'manager', mode: 'firebase' }, getIdToken: async () => 'test-token',
  }), { status: 503 });
});

test('hook protege contexto, revisao e retries; perfil usa data UTC e erros visiveis', async () => {
  const hook = await readFile(new URL('../../src/hooks/useScouting.ts', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../../src/components/rankings/RankingEntityProfiles.tsx', import.meta.url), 'utf8');
  assert.match(hook, /received\?\.scope === scope/);
  assert.match(hook, /scopeRef\.current === scope/);
  assert.match(hook, /result\.revision >= previous\.snapshot\.revision/);
  assert.match(hook, /intents\.current\.get\(intent\) \?\? crypto\.randomUUID/);
  assert.match(hook, /if \(opposite\) intents\.current\.delete/);
  assert.doesNotMatch(hook, /localStorage|sessionStorage/);
  assert.match(profile, /timeZone: 'UTC'/);
  assert.match(profile, /Atualizar observação/);
  assert.match(profile, /resposta simulada/);
});
