// Кадр с субтитром реплики (задача 9) — для отчёта.
import { chromium } from 'playwright';
const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
const t0 = Date.now(); const step = (s) => console.log(`[${((Date.now()-t0)/1000).toFixed(0)}s] ${s}`);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 120000 });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Играть'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 180000 });
await page.waitForTimeout(800);
step('playing');
// Кадр снимается ~40 с (SwiftShader), а реплика идёт 3–5 с. Поэтому запускаем
// настоящую озвученную реплику и «замораживаем» звук: приостановленный AudioContext
// не доводит источник до конца, субтитр остаётся на экране.
const line = await page.evaluate(async () => {
  const game = window.viceShore;
  game.settings.set('subtitles', true);
  game.dialogues.stop();
  const ok = game.dialogues.play('take_paint') ? 'take_paint' : null;
  game.loop?.stop?.();
  await game.audio.ctx?.suspend?.();
  return ok;
});
step('line ' + line);
await page.waitForTimeout(300);
console.log('subtitle:', await page.evaluate(() => document.querySelector('.subtitle')?.textContent ?? null));
try { await page.screenshot({ path: 'shots/t9-subtitle.png', timeout: 150000 }); step('shot ok'); } catch (e) { step('shot fail'); }
await browser.close();
