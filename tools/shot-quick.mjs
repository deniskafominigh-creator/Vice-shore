// Быстрый контрольный кадр: меню + вид от третьего лица. node tools/shot-quick.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', e => errs.push(`[pageerror] ${e.message}`));
page.on('console', m => { if (m.type()==='error') errs.push(`[console] ${m.text()}`); });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 120000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'shots/q1-menu.png', timeout: 180000 });
console.log('menu shot');
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForTimeout(6000);
await page.screenshot({ path: 'shots/q2-play.png', timeout: 180000 });
console.log('play shot');
console.log(JSON.stringify({ errs, tris: await page.evaluate(() => window.viceShore?.world?.triangleCountEstimate) }));
await browser.close();
