import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto('file:///home/user/dist/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 60000 });
await page.waitForTimeout(1000);
const state = await page.evaluate(() => ({
  state: window.viceShore?.machine?.current,
  character: Boolean(window.viceShore?.character),
  bones: window.viceShore?.character?.boneCount ?? 0,
  tris: Math.round(window.viceShore?.character?.triangleCount ?? 0),
  font: document.fonts.check('700 48px Oswald'),
}));
await page.screenshot({ path: 'shots/char-11-dist.png' });
console.log(JSON.stringify({ state, errors }, null, 2));
await browser.close();
