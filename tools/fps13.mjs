import { chromium } from 'playwright';
const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 300000 });
await page.waitForTimeout(1000);
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing', null, { timeout: 300000 });
await page.waitForTimeout(2000);
const fps = await page.evaluate(async () => {
  const t0 = performance.now(); let frames = 0;
  await new Promise((resolve) => {
    const tick = () => { frames += 1; if (performance.now() - t0 > 5000) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  return { frames, ms: Math.round(performance.now() - t0), stats: window.viceShore.frameStats() };
});
console.log(JSON.stringify(fps));
await browser.close();
