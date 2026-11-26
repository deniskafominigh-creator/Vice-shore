// Кадры задачи 8: мяч на площадке, замах с дугой, гол, закрытая миссия.
import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 90000 });
await page.waitForTimeout(900);

// Миссия 01 закрыта, вторая активна; встаём на линию броска лицом к кольцу
await page.evaluate(() => {
  const game = window.viceShore;
  game.quests.complete('mission_01');
  const ball = game.ballMission;
  const rim = game.world.island.court.geometry.center;
  game.player.spawn(ball.spawnPoint.x + 0.9, ball.spawnPoint.z, game.world.island, Math.PI / 2);
  game.thirdPersonCamera.setYaw(Math.PI / 2);
  game.thirdPersonCamera.setPitch(-0.12);
  game.snapThirdPersonCamera();
  ball.pickUp();
  game.player.spawn(rim.x + 6.4, rim.z, game.world.island, Math.PI / 2);
  game.thirdPersonCamera.setYaw(Math.PI / 2);
  game.thirdPersonCamera.setPitch(-0.12);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(1800);
await page.screenshot({ path: 'shots/t8-a-ball.png' });

// Замах: дуга полёта, индикатор силы с зелёной зоной
await page.evaluate(() => {
  const ball = window.viceShore.ballMission;
  ball.holdCharge(true);
  for (let i = 0; i < 54; i += 1) ball.update(1 / 60);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/t8-b-aim.png' });

// Бросок в окне силы → гол (throwBall — тот же код, что и отпускание ЛКМ)
const goal1 = await page.evaluate(() => {
  const ball = window.viceShore.ballMission;
  ball.holdCharge(false);
  const win = ball.shotWindow();
  const charge = win ? (win.from + win.to) / 2 : 0.5;
  ball.throwBall(charge);
  for (let i = 0; i < 300 && ball.goalCount === 0; i += 1) ball.update(1 / 60);
  for (let i = 0; i < 20; i += 1) ball.update(1 / 60);
  return { goals: ball.goalCount, charge: Number(charge.toFixed(2)) };
});
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/t8-c-goal.png' });

// Второй гол — миссия закрыта
const done = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const rim = game.world.island.court.geometry.center;
  const island = game.world.island;
  for (let attempt = 0; attempt < 4 && ball.goalCount < 2; attempt += 1) {
    const pos = ball.ballPosition;
    game.player.spawn(pos.x + 0.5, pos.z, island, Math.PI / 2);
    ball.pickUp();
    game.player.spawn(rim.x + 6.4, rim.z, island, Math.PI / 2);
    game.thirdPersonCamera.setYaw(Math.PI / 2);
    game.thirdPersonCamera.setPitch(-0.12);
    const win = ball.shotWindow();
    const charge = win ? (win.from + win.to) / 2 : 0.5;
    const frames = Math.round((charge * 0.9) / (1 / 60));
    ball.holdCharge(true);
    for (let i = 0; i < frames; i += 1) ball.update(1 / 60);
    ball.holdCharge(false);
    ball.update(1 / 60);
    for (let i = 0; i < 240; i += 1) ball.update(1 / 60);
  }
  return { goals: ball.goalCount, status: game.quests.get('mission_02')?.status };
});
await page.waitForTimeout(1600);
await page.screenshot({ path: 'shots/t8-d-done.png' });

console.log(JSON.stringify({ goal1, ...done, errors: errors.slice(0, 5) }, null, 1));
await browser.close();
