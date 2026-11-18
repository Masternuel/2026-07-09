import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Frontend tests live in tests/frontend (audit Etapa 4); server tests stay in server/tests.
const root = fileURLToPath(new URL('..', import.meta.url));
const names = await readdir(new URL('../tests/frontend/', import.meta.url));
const files = names.filter((name) => name.endsWith('.test.mjs')).sort();
if (!files.length) throw new Error('Nenhum teste frontend encontrado');
console.log(`Frontend: ${files.length} arquivos`);
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files.map((name) => `tests/frontend/${name}`)], { cwd: root, stdio: 'inherit' });
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
