// Кадры острова (задача 13): сверху, с воды, у домов. node tools/shot-island13.mjs
import { chromium } from 'playwright';

const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 300000 });
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(() => ({
  tris: window.viceShore.world.triangleCountEstimate,
  decorations: window.viceShore.world.island.decorationCount,
  houses: window.viceShore.world.island.town.houses.length,
  merge: window.viceShore.world.island.mergeStats,
  drawCalls: window.viceShore.frameStats(),
})), null, 2));

const views = [
  ['overview', [0, 95, 120], [0, 0, 0]],
  ['shore', [0, 9, 96], [0, 3, 30]],
  ['horizon', [40, 7, 88], [-380, 14, 380]],
  ['street', [2, 9, 46], [10, 3, 26]],
  ['house', [30, 5, 44], [40, 4, 34]],
  ['villa', [-16, 12, 34], [-4, 4, 2]],
];
for (const [name, from, to] of views) {
  await page.evaluate(({ from, to }) => window.viceShore.setAuditCamera(from, to), { from, to });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/island-${name}.png` });
}
console.log('errors', errors.slice(0, 5));
await browser.close();
