// Диагностика: печатает ошибки страницы сразу. node tools/probe-errors.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 400)));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 12; i += 1) {
  await page.waitForTimeout(5000);
  const state = await page.evaluate(() => ({
    state: window.viceShore?.machine?.current ?? null,
    menu: Boolean(document.querySelector('.menu:not(.is-hidden)')),
    load: document.querySelector('[class*="loading"]')?.textContent?.slice(0, 60) ?? null,
  }));
  console.log(i, JSON.stringify(state));
  if (state.menu) break;
}
await browser.close();
