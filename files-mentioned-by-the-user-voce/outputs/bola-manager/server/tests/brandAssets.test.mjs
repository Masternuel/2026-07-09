import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { brandRenditions } from '../../scripts/prepare-brand-assets.mjs';

const brand = fileURLToPath(new URL('../../public/assets/brand/', import.meta.url));
const source = `${brand}bola-manager-logo.png`;

test('official logo remains byte-identical to the approved image', async () => {
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),
    '8fb184c8adf70cedaa4fbba0d980c241931b6d20d64892246952582668ab998b');
  const metadata = await sharp(source).metadata();
  assert.equal(metadata.width, 1254);
  assert.equal(metadata.height, 1254);
  assert.equal(metadata.hasAlpha, true);
});

test('brand renditions have their declared dimensions and preserve transparency', async () => {
  for (const { file, size } of brandRenditions) {
    const metadata = await sharp(`${brand}${file}`).metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    assert.equal(metadata.hasAlpha, true);
    assert.equal((await sharp(`${brand}${file}`).stats()).isOpaque, false);
  }
});

test('renditions are only proportional resizes of the original artwork', async () => {
  for (const { file, size } of brandRenditions) {
    const expected = await sharp(source).resize(size, size, {
      fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).raw().toBuffer();
    assert.deepEqual(await sharp(`${brand}${file}`).raw().toBuffer(), expected);
  }
});

test('browser, native window and installer reference the approved brand assets', async () => {
  const text = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.match(await text('index.html'), /rel="icon"[^>]+\/assets\/brand\/bola-manager-favicon\.png/);
  assert.match(await text('desktop/main.mjs'), /icon: join\(root, "dist-desktop\/assets\/brand\/bola-manager-icon\.png"\)/);
  const packaging = await text('scripts/package-desktop.mjs');
  assert.match(packaging, /sharp\(join\(root, "public\/assets\/brand\/bola-manager-logo\.png"\)\)/);
  assert.doesNotMatch(packaging, /public\/favicon\.svg/);
  for (const { file } of brandRenditions) assert.ok(packaging.includes(`/dist-desktop/assets/brand/${file}`));
});
