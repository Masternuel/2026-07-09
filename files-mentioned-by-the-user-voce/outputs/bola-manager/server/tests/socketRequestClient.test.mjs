import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { after, before, test } from 'node:test';
import ts from 'typescript';
import { io } from 'socket.io-client';
import { startTestServer } from './testHarness.mjs';

const source = await readFile(new URL('../../src/lib/socketRequest.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { emitSocketRequest } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const previousWindow = globalThis.window;
before(() => { globalThis.window = { setTimeout, clearTimeout }; });
after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });

test('emissão preserva this do Socket.IO real e recebe ACK do backend', async (context) => {
  const { server, url } = await startTestServer();
  context.after(() => server.close());
  assert.equal(server.httpServer.address().address, '127.0.0.1');
  const socket = io(url, { auth: { token: 'owner-token' }, forceNew: true, reconnection: false });
  context.after(() => socket.disconnect());
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const response = await emitSocketRequest(socket, 'room:create', { name: 'Regressão transporte', clubId: 'AUR' }, { timeoutMs: 2000 });
  assert.equal(response.ok, true);
  assert.equal(response.room.ownerId, 'uid-owner');
  assert.equal(socket.listeners('disconnect').length, 0);
});

test('falha síncrona limpa timer/listener e devolve erro estruturado', async () => {
  const socket = new EventEmitter(); socket.connected = true;
  socket.emit = function () { assert.equal(this, socket); throw new Error('falha de envio'); };
  await assert.rejects(emitSocketRequest(socket, 'room:create', { requestId: 'same-intent' }), { code: 'SOCKET_SEND_FAILED', requestId: 'same-intent' });
  assert.equal(socket.listenerCount('disconnect'), 0);
});

test('timeout, desconexão e ACK inválido rejeitam e limpam recursos', async () => {
  for (const mode of ['timeout', 'disconnect', 'invalid']) {
    const socket = new EventEmitter(); socket.connected = true;
    socket.emit = (_event, _body, ack) => {
      if (mode === 'invalid') ack({ unexpected: true });
      if (mode === 'disconnect') EventEmitter.prototype.emit.call(socket, 'disconnect');
    };
    const expected = { timeout: 'SOCKET_ACK_TIMEOUT', disconnect: 'SOCKET_DISCONNECTED', invalid: 'SOCKET_ACK_INVALID' }[mode];
    await assert.rejects(emitSocketRequest(socket, 'test:request', {}, { timeoutMs: 5 }), { code: expected });
    assert.equal(socket.listenerCount('disconnect'), 0);
  }
});
