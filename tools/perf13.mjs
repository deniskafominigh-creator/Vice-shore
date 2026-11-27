import { chromium } from 'playwright';
const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(300000);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 300000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing', null, { timeout: 300000 });
const measure = async (label) => page.evaluate(async (label) => {
  const t0 = performance.now();
  let frames = 0;
  await new Promise((resolve) => {
    const tick = () => { frames += 1; if (performance.now() - t0 > 6000) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  return { label, fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(2) };
}, label);
console.log(JSON.stringify(await measure('all')));
await page.evaluate(() => { window.viceShore.world.sea.mesh.visible = false; });
console.log(JSON.stringify(await measure('no-sea')));
await page.evaluate(() => { window.viceShore.world.island.grass.group.visible = false; });
console.log(JSON.stringify(await measure('no-sea-no-grass')));
await page.evaluate(() => { window.viceShore.world.island.town.group.visible = false; });
console.log(JSON.stringify(await measure('no-sea-no-grass-no-town')));
await browser.close();
