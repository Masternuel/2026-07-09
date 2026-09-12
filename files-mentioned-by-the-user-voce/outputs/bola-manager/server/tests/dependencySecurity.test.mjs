import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';

const require = createRequire(import.meta.url);
const from = (parent, name) => createRequire(parent.resolve(name));
const expressRequire = from(require, 'express');
const adminRequire = from(require, 'firebase-admin/app');
const storageRequire = from(adminRequire, '@google-cloud/storage');
const firestoreRequire = from(adminRequire, '@google-cloud/firestore');
const consumers = [
  ['google-gax', from(firestoreRequire, 'google-gax')],
  ['gaxios', from(storageRequire, 'gaxios')],
  ['teeny-request', from(storageRequire, 'teeny-request')],
];

async function listen(context, handler) {
  const server = createServer(handler);
  context.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('lockfile não reintroduz versões vulneráveis nos caminhos transitivos', () => {
  const { packages } = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const floors = { qs: '6.16.0', 'fast-xml-parser': '5.10.1', uuid: '11.1.1', 'socket.io-parser': '4.2.7' };
  for (const [name, floor] of Object.entries(floors)) {
    const entries = Object.entries(packages).filter(([path]) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`);
    assert.ok(entries.length, `${name} precisa estar instalado`);
    for (const [path, { version }] of entries) {
      assert.ok(version.localeCompare(floor, 'en', { numeric: true }) >= 0, `${path}: ${version} < ${floor}`);
      if (name === 'uuid') assert.ok(!['12.0.0', '13.0.0'].includes(version), `${path}: versão sem backport`);
    }
  }
});

test('Express 4 mantém parsing de query e formulário com qs corrigido', async (context) => {
  const express = require('express');
  assert.match(expressRequire('./package.json').version, /^4\./);
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.post('/', (request, response) => response.json({ query: request.query, body: request.body }));
  const url = await listen(context, app);
  const response = await fetch(`${url}/?filter[position]=GOL&ids[]=1&ids[]=2`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'player[name]=Teste&player[roles][]=GOL&player[roles][]=ZAG',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    query: { filter: { position: 'GOL' }, ids: ['1', '2'] },
    body: { player: { name: 'Teste', roles: ['GOL', 'ZAG'] } },
  });
});

test('qs bloqueia bypass do limite e não chama isBuffer controlado pela entrada', () => {
  for (const parent of [expressRequire, from(expressRequire, 'body-parser')]) {
    const qs = parent('qs');
    assert.throws(() => qs.parse('a[]=1,2,3,4', { comma: true, arrayLimit: 3, throwOnLimitExceeded: true }), RangeError);
    assert.doesNotThrow(() => qs.stringify(qs.parse('x[constructor][isBuffer]=y', { plainObjects: true })));
  }
});

for (const [name, parent] of consumers) {
  test(`${name}: UUID preserva v4/CommonJS e valida limites de buffers`, () => {
    const uuid = parent('uuid');
    assert.equal(uuid.validate(uuid.v4()), true);
    assert.equal(uuid.version(uuid.v4()), 4);
    assert.throws(() => uuid.v5('test', uuid.v5.DNS, new Uint8Array(8), 4), RangeError);
  });
}

test('google-gax continua gerando identificadores para Firestore', () => {
  const gaxRequire = consumers[0][1];
  const { makeUUID } = gaxRequire('./util.js');
  assert.equal(gaxRequire('uuid').validate(makeUUID()), true);
});

test('gaxios e teeny-request mantêm uploads multipart com os novos UUIDs', { timeout: 5_000 }, async (context) => {
  const requests = [];
  const url = await listen(context, (request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString() });
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  });
  const { Gaxios } = storageRequire('gaxios');
  const result = await new Gaxios().request({
    url, method: 'POST', timeout: 2_000, noProxy: ['127.0.0.1'],
    multipart: [
      { headers: { 'Content-Type': 'application/json' }, content: '{"name":"test.txt"}' },
      { headers: { 'Content-Type': 'text/plain' }, content: Readable.from(['upload-test']) },
    ],
  });
  assert.deepEqual(result.data, { ok: true });
  const { teenyRequest } = storageRequire('teeny-request');
  const body = await new Promise((resolve, reject) => teenyRequest({
    uri: url, method: 'POST', timeout: 2_000, headers: {},
    multipart: [
      { 'Content-Type': 'application/json', body: '{"name":"test.txt"}' },
      { 'Content-Type': 'text/plain', body: Readable.from(['upload-test']) },
    ],
  }, (error, _response, data) => error ? reject(error) : resolve(data)));
  assert.deepEqual(body, { ok: true });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const boundary = request.headers['content-type'].split('boundary=')[1];
    assert.equal(consumers[1][1]('uuid').validate(boundary), true);
    assert.ok(request.body.endsWith(`--${boundary}--`));
    assert.ok(request.body.includes('upload-test'));
    assert.ok(request.body.includes('{"name":"test.txt"}'));
  }
});

test('Storage mantém XML de upload e rejeita DOCTYPE repetido', () => {
  const { XMLBuilder, XMLParser } = storageRequire('fast-xml-parser');
  const parser = new XMLParser();
  const document = { CompleteMultipartUpload: { Part: [{ PartNumber: 1, ETag: 'abc' }] } };
  assert.deepEqual(parser.parse(new XMLBuilder().build(document)), {
    CompleteMultipartUpload: { Part: { PartNumber: 1, ETag: 'abc' } },
  });
  assert.throws(() => parser.parse('<!DOCTYPE a><!DOCTYPE a><a/>'), /Multiple DOCTYPE/);
});

for (const name of ['socket.io', 'socket.io-client']) {
  test(`${name}: parser rejeita anexos inválidos e preserva eventos binários`, () => {
    const { Decoder, Encoder, PacketType } = from(require, name)('socket.io-parser');
    const decoder = new Decoder();
    try {
      for (const count of [0, -1, 1.5]) {
        assert.throws(() => decoder.add(`5${count}-["test"]`), /Illegal attachments/);
      }
      const decoded = [];
      decoder.on('decoded', (packet) => decoded.push(packet));
      const original = { type: PacketType.EVENT, nsp: '/', data: ['upload', Buffer.from('test')] };
      for (const packet of new Encoder().encode(original)) decoder.add(packet);
      assert.equal(decoded.length, 1);
      assert.deepEqual(decoded[0].data, ['upload', Buffer.from('test')]);
    } finally {
      decoder.destroy();
    }
  });
}
