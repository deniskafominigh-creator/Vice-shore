// Запуск оффлайн-проверок сцены: собирает указанный TypeScript-вход через esbuild
// и выполняет его в Node — без браузера и WebGL.
//
//   npm run audit:offline   геометрия всей сцены (z-fighting и прочее)
//   npm run audit:layout    расстановка домов посёлка вдоль улицы
//   npm run check:jump      физика прыжка
//
// Код выхода 1, если вход экспортировал `failed = true`.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  console.error('Укажите вход: node tools/offline-run.mjs tools/offline/island-entry.ts');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'vice-offline-'));
const bundle = join(dir, 'check.mjs');
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning' });

const module = await import(pathToFileURL(bundle).href);
process.exitCode = module.failed ? 1 : 0;
