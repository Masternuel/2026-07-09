import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../../src/lib/socketSession.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function runtime() {
  const sent = [];
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    assert.equal(id, './socketRequest');
    return { emitSocketRequest: async (_socket, event, payload) => { sent.push({ event, payload }); return {}; } };
  }, module, module.exports);
  return { ...module.exports, sent };
}
function socket() {
  const listeners = new Map();
  const result = { connected: true, emitted: [],
    on(event, fn) { const group = listeners.get(event) ?? new Set(); group.add(fn); listeners.set(event, group); },
    off(event, fn) { listeners.get(event)?.delete(fn); },
    emit(event, body) { this.emitted.push({ event, body }); },
    receive(event, ...args) { for (const fn of listeners.get(event) ?? []) fn(...args); },
    disconnect() { this.connected = false; this.receive('disconnect', 'io client disconnect'); },
  };
  return result;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function setup(t, getToken, options = {}) {
  const api = runtime();
  const connection = socket();
  const errors = [];
  const reconnects = [];
  const dispose = api.attachSocketSession(connection, getToken, {
    firebase: true, refreshMs: 10, onError: (...args) => errors.push(args), onHealthy() {},
    reconnect: (token) => reconnects.push(token), ...options,
  });
  t.after(dispose);
  return { ...api, connection, errors, reconnects, dispose };
}

test('cliente renova token durante conexao sem reenviar comandos do jogo', async (t) => {
  const state = setup(t, async () => 'fresh');
  await wait(25);
  assert.ok(state.sent.length > 0);
  assert.ok(state.sent.every(({ event, payload }) => event === 'auth:refresh' && payload.token === 'fresh'));
  assert.equal(state.connection.connected, true);
});

test('logout cancela refresh pendente e desconecta antes de concluir token Firebase', async (t) => {
  let release;
  const state = setup(t, () => new Promise((resolve) => { release = resolve; }));
  await wait(20);
  state.endSocketSessions();
  assert.equal(state.connection.connected, false);
  assert.equal(state.connection.emitted[0].event, 'auth:logout');
  release('too-late');
  await wait(15);
  assert.equal(state.sent.length, 0);
  assert.equal(state.reconnects.length, 0);
});

test('expiracao solicita um refresh forcado antes de reconectar', async (t) => {
  const forces = [];
  const state = setup(t, async (force) => { forces.push(force); return 'new'; }, { refreshMs: 1000 });
  state.connection.receive('auth:error', { code: 'AUTH_TOKEN_EXPIRED' });
  state.connection.connected = false;
  state.connection.receive('disconnect', 'io server disconnect');
  await wait(5);
  assert.deepEqual(forces, [true]);
  assert.deepEqual(state.reconnects, ['new']);
});

test('revogacao nao entra em loop de reconexao nem apaga outros dispositivos', async (t) => {
  const state = setup(t, async () => 'token', { refreshMs: 1000 });
  state.connection.receive('auth:error', { code: 'AUTH_TOKEN_REVOKED' });
  state.connection.connected = false;
  state.connection.receive('disconnect', 'io server disconnect');
  await wait(5);
  assert.equal(state.reconnects.length, 0);
  assert.equal(state.errors[0][0], 'AUTH_TOKEN_REVOKED');
});

test('logout durante recuperacao de expiracao impede reconexao tardia', async (t) => {
  let release;
  const state = setup(t, () => new Promise((resolve) => { release = resolve; }), { refreshMs: 1000 });
  state.connection.receive('auth:error', { code: 'AUTH_TOKEN_EXPIRED' });
  state.connection.connected = false;
  state.connection.receive('disconnect', 'io server disconnect');
  state.endSocketSessions();
  release('fresh');
  await wait(5);
  assert.deepEqual(state.reconnects, []);
});

test('ausencia de usuario Firebase encerra conexao; erro transitorio nao encerra sessao', async (t) => {
  const missing = setup(t, async () => null);
  const offline = setup(t, async () => { throw Object.assign(new Error('offline'), { code: 'AUTH_UNAVAILABLE' }); });
  await wait(25);
  assert.equal(missing.connection.connected, false);
  assert.equal(offline.connection.connected, true);
  assert.equal(offline.errors[0][0], 'AUTH_UNAVAILABLE');
});

test('modo demo nao faz refresh Firebase; dispose remove temporizadores', async (t) => {
  let calls = 0;
  const state = setup(t, async () => { calls++; return null; }, { firebase: false });
  await wait(20);
  state.dispose();
  state.endSocketSessions();
  assert.equal(calls, 0);
  assert.equal(state.connection.connected, true);
});

test('AuthContext notifica sockets antes de esperar signOut Firebase', async () => {
  const context = await readFile(new URL('../../src/auth/AuthContext.tsx', import.meta.url), 'utf8');
  const signOut = context.slice(context.indexOf('const signOut ='), context.indexOf('const updateDisplayName ='));
  assert.ok(signOut.indexOf('endSocketSessions()') >= 0);
  assert.ok(signOut.indexOf('endSocketSessions()') < signOut.indexOf('await firebaseSignOut'));
});

test('logout invalida preparacao da conexao iniciada antes de instalar listeners', async () => {
  const api = runtime();
  const before = api.socketSessionGeneration();
  api.endSocketSessions();
  assert.notEqual(api.socketSessionGeneration(), before);
  const hook = await readFile(new URL('../../src/hooks/useSocket.ts', import.meta.url), 'utf8');
  assert.match(hook, /authGeneration !== socketSessionGeneration\(\)/);
  assert.ok(hook.indexOf('authGeneration !== socketSessionGeneration()') < hook.indexOf('connection = io('));
});
