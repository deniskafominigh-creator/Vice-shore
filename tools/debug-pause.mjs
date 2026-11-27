import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', m => console.log('[console]', m.type(), m.text().slice(0,120)));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 60000 });

const info = async (tag) => {
  const d = await page.evaluate(() => ({
    state: window.viceShore?.machine?.current,
    busy: window.viceShore?.machine?.isBusy,
    locked: window.viceShore?.input?.isPointerLocked,
    modalOpen: [...document.querySelectorAll('.modal')].map(m => !m.classList.contains('is-hidden')),
  }));
  console.log(tag, JSON.stringify(d));
};

await page.click('.menu-list__button:has-text("Играть")');
await page.waitForTimeout(3000);
await info('after play');

await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
await info('after esc #1');

await page.click('.panel button:has-text("Продолжить")');
await page.waitForTimeout(2500);
await info('after resume');

await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
await info('after esc #2');
await browser.close();
