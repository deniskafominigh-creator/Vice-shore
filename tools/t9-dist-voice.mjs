// Проверка собранного одним файлом HTML: все 18 реплик на месте и звучат.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const t0 = Date.now(); const step = (s) => console.log(`[${((Date.now()-t0)/1000).toFixed(0)}s] ${s}`);
await page.goto('file:///home/user/VICE-SHORE.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
step('menu');
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Играть'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 180000 });
await page.keyboard.press('ShiftLeft');
await page.waitForTimeout(1000);
await page.evaluate(() => window.viceShore.dialogues.preload());
await page.waitForFunction(() => window.viceShore.dialogues.voicedLines > 0, null, { timeout: 60000 }).catch(() => {});
const info = await page.evaluate(() => {
  const d = window.viceShore.dialogues;
  d.stop();
  const started = d.play('take_paint');
  return { total: d.totalLines, voiced: d.voicedLines, missing: d.missingVoice, started, line: d.currentLineId, subtitle: d.subtitleText };
});
console.log(JSON.stringify(info, null, 1));
console.log('errors', JSON.stringify(errors.filter((e) => !e.includes('favicon'))));
await browser.close();
