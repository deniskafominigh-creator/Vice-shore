import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 90000 });
await page.waitForTimeout(600);
await page.evaluate(() => {
  const g = window.viceShore;
  g.quests.complete('mission_01');
  const ball = g.ballMission;
  ball.throwBall(0.4);
  // два гола через API счёта: имитируем через прямое попадание
  ball.ballPosition.set(ball.spawnPoint.x, ball.spawnPoint.y, ball.spawnPoint.z);
  g.quests.setProgress('mission_02', 1, [2]);
  g.quests.complete('mission_02');
  g.save.flush?.();
});
await page.waitForTimeout(1500);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Продолжить")');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 90000 });
await page.waitForTimeout(2000);
console.log(JSON.stringify(await page.evaluate(() => ({
  goals: window.viceShore.ballMission.goalCount,
  m2: window.viceShore.quests.get('mission_02')?.status,
  label: document.querySelector('.mission-room__label')?.textContent ?? null,
  value: document.querySelector('.mission-room__value')?.textContent ?? null,
  state: document.querySelector('.mission-room__state')?.textContent ?? null,
  complete: document.querySelector('.mission-room')?.classList.contains('is-complete') ?? null,
  plate: document.querySelector('.mission-task__title')?.textContent ?? null,
  plateHidden: document.querySelector('.mission-task')?.classList.contains('is-hidden') ?? null,
})), null, 1));
console.log('ERRORS', JSON.stringify(errors.slice(0, 3)));
await browser.close();
