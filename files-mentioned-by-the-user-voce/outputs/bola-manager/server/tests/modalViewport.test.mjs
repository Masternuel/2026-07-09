import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('modais ficam presos ao viewport e mantêm o conteúdo rolável', async () => {
  const [source, styles] = await Promise.all([
    readFile(path.join(projectRoot, 'src/components/shared/Modal.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'src/styles.css'), 'utf8'),
  ]);

  assert.match(source, /document\.querySelector\('\.app-shell'\) \?\? document\.body/);
  assert.match(source, /createPortal\(content, portalTarget\)/);
  assert.match(styles, /\.modal \{[^}]*min-height:\s*0[^}]*max-height:\s*calc\(100dvh - 48px\)/s);
  assert.match(styles, /\.modal__body \{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
});
