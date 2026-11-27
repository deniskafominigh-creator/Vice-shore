// Кадр панели настроек для документации: node tools/shot-settings.mjs [mobile]
import { chromium, devices } from 'playwright';

const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const mobile = process.argv[2] === 'mobile';
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext(mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(180000);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim().startsWith('Настройки'));
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForSelector('.panel__row', { timeout: 30000 });
await page.waitForTimeout(600);
const name = mobile ? '/tmp/settings-mobile.png' : '/tmp/settings-desktop.png';
await page.screenshot({ path: name });
console.log('saved', name);
await browser.close();
