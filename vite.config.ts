import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Сборка проекта.
 *
 * Требование §4.2 GOAL.md — «одна общая кнопка»:
 *  - `npm run dev`   → живой dev-сервер, единственная точка входа /index.html;
 *  - `npm run build` → dist/index.html, ОДИН файл, который открывается двойным щелчком
 *                      (все скрипты, стили и шрифты встроены, сеть не нужна).
 */
export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    // Один файл на выходе: шрифты, реплики героя и модель персонажа (≈7,5 МБ) уходят внутрь HTML
    assetsInlineLimit: 16 * 1024 * 1024,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2048,
    reportCompressedSize: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Препросмотр в песочнице открывается с внешнего хоста — разрешаем его явно.
    allowedHosts: true,
  },
});
