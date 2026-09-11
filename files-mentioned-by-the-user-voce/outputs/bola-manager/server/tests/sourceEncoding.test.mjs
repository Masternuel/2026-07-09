import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkSourceEncoding, inspectEncoding } from '../../scripts/check-encoding.mjs';

test('encoding aceita UTF-8 real, caixa alta, nomes internacionais, símbolos e emoji', () => {
  const valid = 'GESTÃO · SÃO PAULO · EVOLUÇÃO · Tática · João · François · Müller · İstanbul · 東京 · 1º · — · “gol” · 🇧🇷 ⚽';
  assert.deepEqual(inspectEncoding(Buffer.from(valid)), []);
});

test('encoding detecta bytes inválidos sem tentar reparar ou substituir dados', () => {
  for (const invalid of [[0xc3, 0x28], [0xe9], [0xf0, 0x9f, 0x87]]) {
    const bytes = Buffer.from(invalid);
    assert.deepEqual(inspectEncoding(bytes), [{ line: 1, code: 'INVALID_UTF8' }]);
    assert.deepEqual([...bytes], invalid);
  }
});

test('encoding detecta textos redecodificados, inclusive dupla conversão e pontuação', () => {
  const invalid = [
    'posi\u00c3\u00a7\u00c3\u00a3o', 'EVOLU\u00c3\u2021\u00c3\u0192O',
    '\u00e2\u20ac\u201d', '\u00c2\u00ba', '\u00c2\u00b7',
    '\u00f0\u0178\u0087\u00a7', '\u00ef\u00bb\u00bf', '\u00ef\u00bf\u00bd',
    '\ufffd', '\u00c3\u0192\u00c2\u00a7',
  ];
  for (const text of invalid) {
    assert.deepEqual(inspectEncoding(Buffer.from(`normal\r\n${text}\n`)), [{ line: 2, code: 'MOJIBAKE' }]);
  }
});

test('encoding rejeita BOM e texto com NUL', () => {
  assert.deepEqual(inspectEncoding(Buffer.from('\ufeffação')), [{ line: 1, code: 'UTF8_BOM' }]);
  assert.deepEqual(inspectEncoding(Buffer.from('ok\ntexto\0')), [{ line: 2, code: 'NUL_BYTE' }]);
});

test('fontes do jogo permanecem UTF-8 sem corrupção', async () => {
  const result = await checkSourceEncoding();
  assert.ok(result.checkedFiles > 0);
  assert.deepEqual(result.issues, []);
});

test('verificação é somente leitura, aponta arquivo/linha e ignora artefatos e bases', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bola-encoding-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [
    ['src/nested/example.ts', 'const title = "São Paulo";\n// \u00c3\u00a7'],
    ['README.md', 'Documentação'], ['.editorconfig', 'charset = utf-8'],
    ['src/.tmp/generated.ts', '\ufffd'], ['src/node_modules/vendor.ts', '\ufffd'],
    ['dist/bundle.js', '\ufffd'], ['data/save.json', '\ufffd'],
    ['package-lock.json', '\ufffd'], ['.env.local', '\ufffd'],
  ];
  for (const [file, text] of files) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }
  const result = await checkSourceEncoding(root);
  assert.equal(result.checkedFiles, 3);
  assert.deepEqual(result.issues, [{ file: 'src/nested/example.ts', line: 2, code: 'MOJIBAKE' }]);
  for (const [file, text] of files) assert.equal(await readFile(path.join(root, file), 'utf8'), text);
  await assert.rejects(checkSourceEncoding(path.join(root, 'missing')), { code: 'ENOENT' });
});

test('build e typecheck exigem a verificação de encoding', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts['check:encoding'], 'node scripts/check-encoding.mjs');
  assert.equal(scripts.prebuild, 'npm run check:encoding');
  assert.equal(scripts.pretypecheck, 'npm run check:encoding');
});
