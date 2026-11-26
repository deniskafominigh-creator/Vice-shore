// Обзорные ракурсы острова для задачи 4. Запуск: node tools/shot-island.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(`[console] ${m.text()}`);
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 60000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForTimeout(6000);

// Своя камера: рендер-цикл читает game.activeCamera, поэтому просто подменяем её
await page.evaluate(() => {
  const game = window.viceShore;
  const THREE = window.viceShoreThree;
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 12000);
  window.__shotCamera = camera;
  game.activeCamera = camera;
  window.__lookAt = (from, to) => {
    camera.position.set(from[0], from[1], from[2]);
    camera.lookAt(to[0], to[1], to[2]);
    camera.updateMatrixWorld(true);
  };
  window.__stats = {
    triangles: game.world.triangleCountEstimate,
    islandChildren: game.world.scene.children.length,
  };
});

const views = [
  ['i1-gate', [0.5, 5.4, 21], [0, 4.2, -2]],
  ['i2-over-shoulder', [3.2, 5.0, 14], [0, 4.4, -6]],
  ['i3-villa-front', [4.5, 4.7, 4.5], [0, 4.0, -8]],
  ['i4-court', [-8, 5.2, 12], [-20.5, 3.6, 4]],
  ['i5-aerial', [10, 42, 52], [0, 3, 0]],
  ['i6-shore', [22, 4.6, 9], [30, 1.0, 2]],
  ['i7-path', [0, 4.6, 11.5], [0, 4.2, -4]],
  ['i8-palm-closeup', [6.5, 4.9, 9.5], [11.5, 8.5, 6.5]],
];

for (const [name, from, to] of views) {
  await page.evaluate(([a, b]) => window.__lookAt(a, b), [from, to]);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `shots/${name}.png`, timeout: 180000 });
  console.log(name, 'ok');
}

const stats = await page.evaluate(() => window.__stats ?? null);
console.log(JSON.stringify({ stats, errs }, null, 2));
await browser.close();
