import { lstat, realpath, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

function inside(root, target) {
  const path = relative(root, target);
  return Boolean(path && !path.startsWith('..') && !path.includes(':'));
}

function unsafe() {
  return Object.assign(new Error('Refused cleanup outside an owned test fixture'), { code: 'TEST_CLEANUP_UNSAFE' });
}

export async function removeFixtureDirectory(root, directory, { remove = rm } = {}) {
  const parent = resolve(root);
  const target = resolve(directory);
  if (!inside(parent, target)) throw unsafe();
  let entry;
  try { entry = await lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!entry.isDirectory() || entry.isSymbolicLink() || (await lstat(parent)).isSymbolicLink()) throw unsafe();
  const [actualParent, actualTarget] = await Promise.all([realpath(parent), realpath(target)]);
  if (!inside(actualParent, actualTarget)) throw unsafe();
  // Retry only filesystem contention during disposal, not tests or application work.
  await remove(actualTarget, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
}
