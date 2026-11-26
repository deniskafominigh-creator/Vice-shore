// Быстрая проверка собранного файла: меню, игра, сцена, бюджет кадра.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
await page.goto('file:///home/user/dist/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 300000 });
await page.waitForTimeout(1500);
const state = await page.evaluate(() => ({
  machine: window.viceShore.machine.current,
  houses: window.viceShore.world.island.town.houses.length,
  decorations: window.viceShore.world.island.decorationCount,
  stats: window.viceShore.frameStats(),
  audit: window.viceShore.auditScene().byKind,
}));
console.log(JSON.stringify({ ...state, errors }, null, 1));
await browser.close();
