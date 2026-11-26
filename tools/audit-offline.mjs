// Оффлайн-аудит сцены: считает геометрию мира в Node, без браузера и WebGL.
//
// Зачем: `npm run audit:scene` требует Chromium. На машине без него (или без
// аппаратного ускорения) правки z-fighting проверять нечем — а «на глаз» такие
// дефекты находятся плохо. Этот скрипт собирает модули мира заглушками
// материалов и прогоняет по ним штатные проверки `SceneAudit`, поэтому цифры
// совпадают с браузерным аудитом (проверено: 49 пар по посёлку — те же 49, что
// в docs/AUDIT_SCENE.md).
//
// Запуск: `npm run audit:offline`
// Код выхода 1, если остались конфликты без исключений.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'vice-offline-audit-'));
const bundle = join(dir, 'island-audit.mjs');

await build({
  entryPoints: ['tools/offline/island-entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'warning',
});

const module = await import(pathToFileURL(bundle).href);
process.exitCode = module.zfightTotal ? 1 : 0;
