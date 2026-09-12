import test from "node:test";
import assert from "node:assert/strict";
import { io as createClient } from "socket.io-client";
import { installSocketAuthSession } from "../sockets/authSession.mjs";
import { registerSafe } from "../sockets/helpers.mjs";
import { createSocketAuthMiddleware } from "../auth.mjs";
import { startTestServer, fakeFirebase } from "./testHarness.mjs";

function mockSocket() {
  const handlers = new Map();
  const socket = {
    id: 'test-socket', data: {}, sent: [], disconnected: false,
    on: (name, fn) => handlers.set(name, fn),
    once: (name, fn) => handlers.set(name, fn),
    emit: (name, payload) => socket.sent.push({ name, payload }),
    disconnect() { this.disconnected = true; handlers.get('disconnect')?.(); },
    invoke: (name, payload = {}) => new Promise((resolve) => handlers.get(name)(payload, resolve)),
  };
  return socket;
}
function credentials(token = 'old', expiresAt = Date.now() + 3600_000, uid = 'owner') {
  return { token, expiresAt, user: { uid, name: 'Owner', authType: 'firebase', editor: false } };
}
function session(t, verify, initial = credentials(), options = {}) {
  const socket = mockSocket();
  installSocketAuthSession(socket, initial, verify, options);
  socket.data.startAuthSession();
  t.after(() => socket.data.disposeAuthSession());
  return socket;
}
const authError = (code, status = 401) => Object.assign(new Error(code), { code, status });

test('cada acao verifica sessao; eventos concorrentes compartilham apenas verificacao em andamento', async (t) => {
  let calls = 0;
  let release;
  const socket = session(t, () => { calls++; return new Promise((resolve) => { release = resolve; }); });
  const first = socket.data.authorize('room:create');
  const second = socket.data.authorize('room:ready');
  release(credentials());
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  const third = socket.data.authorize('room:create');
  release(credentials());
  await third;
  assert.equal(calls, 2);
});

test('sessao expirada bloqueia handler mesmo com socket ainda aberto', async (t) => {
  let clock = 10;
  let mutations = 0;
  const socket = session(t, async () => credentials('old', 100), credentials('old', 100), { now: () => clock });
  registerSafe(socket, 'room:create', async () => { mutations++; return {}; });
  clock = 100;
  const result = await socket.invoke('room:create');
  assert.equal(result.error.code, 'AUTH_TOKEN_EXPIRED');
  assert.equal(mutations, 0);
});

test('logout invalida validacao pendente e nao depende da disponibilidade Firebase ou rate limit', async (t) => {
  let release;
  let mutations = 0;
  const socket = session(t, () => new Promise((resolve) => { release = resolve; }));
  registerSafe(socket, 'room:create', async () => { mutations++; return {}; });
  const pending = socket.invoke('room:create');
  await new Promise((resolve) => setImmediate(resolve));
  socket.data.consumeRateLimit = async () => ({ allowed: false });
  assert.equal((await socket.invoke('auth:logout')).ok, true);
  release(credentials());
  assert.equal((await pending).ok, false);
  assert.equal(mutations, 0);
});

test('desconexao durante validacao impede nova mutacao', async (t) => {
  let release;
  const socket = session(t, () => new Promise((resolve) => { release = resolve; }));
  const pending = socket.data.authorize('room:create');
  socket.disconnect();
  release(credentials());
  await assert.rejects(pending, { code: 'AUTH_SESSION_CLOSED' });
});

test('renovacao valida substitui token e claims sem trocar referencia da identidade', async (t) => {
  const expiresAt = Date.now() + 7200_000;
  const checkedTokens = [];
  const socket = session(t, async ({ token }) => {
    checkedTokens.push(token);
    return { ...credentials(token, expiresAt), user: { ...credentials().user, editor: true } };
  });
  const user = socket.data.user;
  const ack = await socket.invoke('auth:refresh', { token: 'new' });
  assert.equal(ack.ok, true);
  await socket.data.authorize('room:create');
  assert.deepEqual(checkedTokens, ['new', 'new']);
  assert.equal(socket.data.user, user);
  assert.equal(user.editor, true);
  assert.deepEqual(socket.data.authCredentials(), { token: 'new' });
});

test('renovacao nao aceita troca de UID', async (t) => {
  const socket = session(t, async () => credentials('other', Date.now() + 7200_000, 'intruder'));
  const ack = await socket.invoke('auth:refresh', { token: 'other' });
  assert.equal(ack.error.code, 'AUTH_IDENTITY_CHANGED');
  assert.equal(socket.data.user.uid, 'owner');
  await assert.rejects(socket.data.authorize(), { code: 'AUTH_SESSION_CLOSED' });
});

test('resultado antigo de verificacao nao invalida token renovado', async (t) => {
  let rejectOld;
  const socket = session(t, ({ token }) => token === 'old'
    ? new Promise((_resolve, reject) => { rejectOld = reject; })
    : Promise.resolve(credentials('new', Date.now() + 7200_000)));
  const checking = socket.data.authorize();
  assert.equal((await socket.invoke('auth:refresh', { token: 'new' })).ok, true);
  rejectOld(authError('AUTH_TOKEN_EXPIRED'));
  await checking;
  assert.equal(socket.disconnected, false);
  assert.deepEqual(socket.data.authCredentials(), { token: 'new' });
});

test('renovacoes fora de ordem nao restauram token antigo', async (t) => {
  let release;
  const expiry = Date.now() + 7200_000;
  const socket = session(t, ({ token }) => token === 'older'
    ? new Promise((resolve) => { release = () => resolve(credentials(token, expiry)); })
    : Promise.resolve(credentials(token, expiry + 1000)));
  const older = socket.invoke('auth:refresh', { token: 'older' });
  await new Promise((resolve) => setImmediate(resolve));
  const newer = await socket.invoke('auth:refresh', { token: 'newer' });
  release();
  assert.equal(newer.ok, true);
  assert.equal((await older).ok, true);
  assert.deepEqual(socket.data.authCredentials(), { token: 'newer' });
});

test('expiracao ociosa fecha socket; renovacao rearma prazo', async (t) => {
  const socket = session(t, async () => credentials('new', Date.now() + 1000), credentials('old', Date.now() + 60));
  assert.equal((await socket.invoke('auth:refresh', { token: 'new' })).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 85));
  assert.equal(socket.disconnected, false);
  const expired = session(t, async () => credentials(), credentials('old', Date.now() + 15));
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(expired.disconnected, true);
});

test('revogacao ociosa fecha socket pela verificacao periodica', async (t) => {
  const socket = session(t, async () => { throw authError('AUTH_TOKEN_REVOKED'); }, credentials(), { recheckMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(socket.disconnected, true);
});

test('indisponibilidade bloqueia acao, preserva conexao e permite retry validado', async (t) => {
  let offline = true;
  let mutations = 0;
  const socket = session(t, async () => { if (offline) throw authError('AUTH_UNAVAILABLE', 503); return credentials(); });
  registerSafe(socket, 'room:create', async () => { mutations++; return {}; });
  assert.equal((await socket.invoke('room:create')).error.code, 'AUTH_UNAVAILABLE');
  assert.equal(mutations, 0);
  assert.equal(socket.disconnected, false);
  offline = false;
  assert.equal((await socket.invoke('room:create')).ok, true);
  assert.equal(mutations, 1);
});

async function realServer(t, options = {}) {
  let failure = null;
  const calls = [];
  const firebase = fakeFirebase();
  firebase.auth.verifyIdToken = async (token, checkRevoked) => {
    calls.push({ token, checkRevoked });
    if (failure) throw Object.assign(new Error('private-provider-message'), { code: failure });
    return { uid: token === 'other' ? 'intruder' : 'owner', name: 'Owner', exp: Math.floor(Date.now() / 1000) + 3600 };
  };
  const { server, url, store } = await startTestServer({ firebase, ...options });
  let client;
  t.after(async () => { client?.disconnect(); await server.close(); });
  client = await new Promise((resolve, reject) => {
    const socket = createClient(url, { auth: { token: 'valid' }, reconnection: false, transports: ['websocket'] });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
  return { server, client, calls, store, fail: (value) => { failure = value; } };
}

for (const [providerCode, expected] of [['auth/id-token-revoked', 'AUTH_TOKEN_REVOKED'],
  ['auth/user-disabled', 'AUTH_USER_DISABLED'], ['auth/id-token-expired', 'AUTH_TOKEN_EXPIRED']]) {
  test(`Socket real: ${providerCode} apos handshake impede criacao`, async (t) => {
    const { client, fail, store, calls } = await realServer(t);
    fail(providerCode);
    const ack = await client.timeout(1000).emitWithAck('room:create', { name: 'Nao criar' });
    assert.equal(ack.error.code, expected);
    assert.equal((await store.listRoomsForManager('owner')).length, 0);
    assert.ok(calls.length >= 2);
    assert.ok(calls.every((call) => call.checkRevoked === true));
    assert.ok(!JSON.stringify(ack).includes('private-provider-message'));
  });
}

test('Socket real: renovar preserva conexao e aplica credencial nova na proxima acao', async (t) => {
  const { client, calls } = await realServer(t);
  const id = client.id;
  assert.equal((await client.timeout(1000).emitWithAck('auth:refresh', { token: 'fresh' })).ok, true);
  assert.equal((await client.timeout(1000).emitWithAck('room:create', { name: 'Sala valida' })).ok, true);
  assert.equal(client.id, id);
  assert.equal(calls.at(-1).token, 'fresh');
});

test('Socket real: logout confirma e encerra conexao', async (t) => {
  const { client } = await realServer(t);
  const disconnected = new Promise((resolve) => client.once('disconnect', resolve));
  assert.equal((await client.timeout(1000).emitWithAck('auth:logout', {})).ok, true);
  assert.equal(await disconnected, 'io server disconnect');
});

test('handshake rejeita validade ausente ou expirada e exige verificacao de revogacao', async () => {
  for (const exp of [undefined, 0, Math.floor(Date.now() / 1000) - 1]) {
    const socket = { data: {}, handshake: { auth: { token: 'candidate' } } };
    const middleware = createSocketAuthMiddleware({ auth: { async verifyIdToken(_token, revoked) {
      assert.equal(revoked, true); return { uid: 'owner', exp };
    } } });
    const error = await new Promise((resolve) => middleware(socket, resolve));
    assert.equal(error.data.code, 'AUTH_TOKEN_EXPIRED');
    assert.equal(socket.data.user, undefined);
  }
});

test('timeout de revalidacao nao permite mutacao e nao usa identidade antiga como fallback', async (t) => {
  let checking = false;
  const socket = mockSocket();
  socket.handshake = { auth: { token: 'candidate' } };
  const middleware = createSocketAuthMiddleware({ timeoutMs: 10, auth: {
    verifyIdToken: () => checking ? new Promise(() => {})
      : Promise.resolve({ uid: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 }),
  } });
  await new Promise((resolve, reject) => middleware(socket, (error) => error ? reject(error) : resolve()));
  socket.data.startAuthSession();
  t.after(() => socket.data.disposeAuthSession());
  let mutations = 0;
  registerSafe(socket, 'room:create', async () => { mutations++; return {}; });
  checking = true;
  assert.equal((await socket.invoke('room:create')).error.code, 'AUTH_UNAVAILABLE');
  assert.equal(mutations, 0);
  checking = false;
  assert.equal((await socket.invoke('room:create')).ok, true);
});

test('comando encaminhado exige credencial valida na replica receptora; objeto user nao autentica', async (t) => {
  let fence = 0;
  const { server, client, store, fail } = await realServer(t, {
    distributedLocks: { acquire: async () => ({ token: `owner-${++fence}`, fence,
      renew: async () => true, release: async () => true }) }, matchDelayMs: 60_000,
  });
  const create = await client.timeout(1000).emitWithAck('room:create', { name: 'RPC autenticado', clubId: 'AUR' });
  const code = create.room.code;
  assert.equal((await client.timeout(1000).emitWithAck('room:ready', { code, ready: true })).ok, true);
  assert.equal((await client.timeout(1000).emitWithAck('room:start', { code })).ok, true);
  const start = await client.timeout(2000).emitWithAck('match:ready', { code, ready: true });
  assert.equal(start.ok, true);
  const handler = server.io.sockets.listeners('cluster:match-command')[0];
  assert.equal(typeof handler, 'function');
  const invoke = (auth) => new Promise((resolve) => handler({
    event: 'match:speed', payload: { code, matchId: start.matchId, speed: 2 }, auth,
    user: { uid: 'owner', name: 'Forged trusted user', authType: 'firebase' },
  }, resolve));
  assert.equal((await invoke({ token: 'valid' })).response.ok, true);
  assert.equal((await invoke(undefined)).response.error.code, 'AUTH_REQUIRED');
  let mutations = 0;
  const membership = store.requireMembership.bind(store);
  store.requireMembership = async (...args) => { mutations++; return membership(...args); };
  fail('auth/id-token-revoked');
  assert.equal((await invoke({ token: 'valid' })).response.error.code, 'AUTH_TOKEN_REVOKED');
  assert.equal(mutations, 0);
});
