// Задача 8: вторая миссия — мяч, бросок, два гола. Сквозная проверка.
import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const out = { errors };
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(800);

// ——— 0. миссия 01 закрыта, миссия 02 активна ———
out.afterFirstMission = await page.evaluate(() => {
  const game = window.viceShore;
  game.quests.complete('mission_01');
  return {
    m1: game.quests.get('mission_01')?.status,
    m2: game.quests.get('mission_02')?.status,
    step: game.quests.currentStep('mission_02'),
  };
});
await page.waitForTimeout(1200);
out.taskPlate = await page.evaluate(() => document.querySelector('.mission-task__title')?.textContent ?? null);

// ——— 1. мяч: подсказка и взятие ———
await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const spawn = ball.spawnPoint;
  game.player.spawn(spawn.x + 1.0, spawn.z, game.world.island, Math.PI / 2);
  game.thirdPersonCamera.setYaw(Math.PI / 2);
  game.thirdPersonCamera.setPitch(-0.1);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(1600);
out.promptBall = await page.evaluate(() => document.querySelector('.mission-prompt')?.textContent ?? null);
await page.screenshot({ path: 'shots/t8-01-ball.png' });
await page.keyboard.press('KeyE');
await page.waitForTimeout(700);
out.afterPickup = await page.evaluate(() => ({
  held: window.viceShore.ballMission.heldBall,
  step: window.viceShore.quests.currentStep('mission_02'),
  prompt: document.querySelector('.mission-prompt')?.textContent ?? null,
}));

// ——— 2. встаём на линию броска: 6.2 м от кольца ———
await page.evaluate(() => {
  const game = window.viceShore;
  const rim = game.world.island.court.geometry.center;
  game.player.spawn(rim.x + 6.2, rim.z, game.world.island, Math.PI / 2);
  game.thirdPersonCamera.setYaw(Math.PI / 2);
  game.thirdPersonCamera.setPitch(0.4);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(900);
out.aim = await page.evaluate(() => {
  const ball = window.viceShore.ballMission;
  const window01 = ball.shotWindow();
  return { window: window01, held: ball.heldBall };
});

// ——— 3. первый гол через настоящий замах и бросок ———
out.goal1 = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const win = ball.shotWindow();
  const charge = win ? (win.from + win.to) / 2 : 0.5;
  const frames = Math.round((charge * 0.9) / (1 / 60));
  ball.holdCharge(true);
  for (let i = 0; i < frames; i += 1) ball.update(1 / 60);
  const charged = ball.chargingPower;
  ball.holdCharge(false);
  ball.update(1 / 60); // отпускание → бросок
  const speed = ball.ballPosition.toArray().map((v) => Number(v.toFixed(2)));
  let peak = 0;
  for (let i = 0; i < 300; i += 1) {
    ball.update(1 / 60);
    peak = Math.max(peak, ball.goalCount);
  }
  return { charge: Number(charged.toFixed(3)), release: speed, goals: ball.goalCount, peak };
});
await page.waitForTimeout(600);
out.hudAfterGoal = await page.evaluate(() => ({
  room: document.querySelector('.mission-room__value')?.textContent ?? null,
  label: document.querySelector('.mission-room__label')?.textContent ?? null,
  state: document.querySelector('.mission-room__state')?.textContent ?? null,
}));
await page.screenshot({ path: 'shots/t8-02-goal.png' });

// ——— 4. 20 бросков мимо: голов не прибавляется ———
out.misses = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const rim = game.world.island.court.geometry.center;
  const island = game.world.island;
  let goalsBefore = ball.goalCount;
  let maxY = 0;
  let minY = 99;
  let falseGoals = 0;
  let escaped = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // подбираем мяч там, где он лежит
    const pos = ball.ballPosition;
    island.clampToIsland(pos.x, pos.z, 0.4);
    game.player.spawn(pos.x + 0.6, pos.z, island, Math.PI / 2);
    ball.pickUp();
    if (!ball.heldBall) {
      ball.ballPosition.set(ball.spawnPoint.x, ball.spawnPoint.y, ball.spawnPoint.z);
      game.player.spawn(ball.spawnPoint.x + 0.6, ball.spawnPoint.z, island, Math.PI / 2);
      ball.pickUp();
    }
    game.player.spawn(rim.x + 6.2, rim.z, island, Math.PI / 2);
    // прицел в сторону: боковой промах больше допуска доводки
    const side = attempt % 2 === 0 ? 0.42 : -0.42;
    game.thirdPersonCamera.setYaw(Math.PI / 2 + side);
    game.thirdPersonCamera.setPitch(0.4);
    ball.holdCharge(true);
    for (let i = 0; i < 30; i += 1) ball.update(1 / 60);
    ball.holdCharge(false);
    ball.update(1 / 60);
    for (let i = 0; i < 260; i += 1) {
      ball.update(1 / 60);
      maxY = Math.max(maxY, ball.ballPosition.y);
      minY = Math.min(minY, ball.ballPosition.y);
      if (ball.ballPosition.y < 0) escaped += 1;
    }
    if (ball.goalCount > goalsBefore) {
      falseGoals += 1;
      goalsBefore = ball.goalCount;
    }
  }
  return { falseGoals, goals: ball.goalCount, maxY: Number(maxY.toFixed(2)), minY: Number(minY.toFixed(2)), escaped };
});

// ——— 5. второй гол — миссия закрыта ———
out.goal2 = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const rim = game.world.island.court.geometry.center;
  const island = game.world.island;
  // возвращаем мяч и встаём на линию броска
  ball.ballPosition.set(ball.spawnPoint.x, ball.spawnPoint.y, ball.spawnPoint.z);
  game.player.spawn(ball.spawnPoint.x + 0.6, ball.spawnPoint.z, island, Math.PI / 2);
  ball.pickUp();
  game.player.spawn(rim.x + 6.2, rim.z, island, Math.PI / 2);
  game.thirdPersonCamera.setYaw(Math.PI / 2);
  game.thirdPersonCamera.setPitch(0.4);
  // даём кадру переставить героя и мяч в руки
  return { held: ball.heldBall };
});
await page.waitForTimeout(900);
out.goal2 = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const win = ball.shotWindow();
  const charge = win ? (win.from + win.to) / 2 : 0.5;
  const frames = Math.round((charge * 0.9) / (1 / 60));
  ball.holdCharge(true);
  for (let i = 0; i < frames; i += 1) ball.update(1 / 60);
  ball.holdCharge(false);
  ball.update(1 / 60);
  for (let i = 0; i < 300; i += 1) ball.update(1 / 60);
  const save = JSON.parse(localStorage.getItem('vice-shore.save.v1') ?? '{}');
  return {
    charge: Number(charge.toFixed(3)),
    goals: ball.goalCount,
    m2: game.quests.get('mission_02')?.status,
    progress: game.quests.get('mission_02')?.progress,
    values: game.quests.get('mission_02')?.values,
    save: save.missions?.mission_02 ?? null,
    room: document.querySelector('.mission-room__value')?.textContent ?? null,
    plate: document.querySelector('.mission-task__title')?.textContent ?? null,
  };
});
await page.waitForTimeout(800);
out.hudDone = await page.evaluate(() => ({
  room: document.querySelector('.mission-room__value')?.textContent ?? null,
  state: document.querySelector('.mission-room__state')?.textContent ?? null,
  complete: document.querySelector('.mission-room')?.classList.contains('is-complete') ?? null,
}));
await page.screenshot({ path: 'shots/t8-03-done.png' });

// ——— 6. мяч не улетает навсегда: возврат через 5 с ———
out.respawn = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  // запускаем мяч далеко в сторону
  ball.ballPosition.set(ball.spawnPoint.x, ball.spawnPoint.y + 1, ball.spawnPoint.z);
  ball.ballVelocity.set(14, 6, 12);
  for (let i = 0; i < 60 * 8; i += 1) ball.update(1 / 60);
  const pos = ball.ballPosition;
  return {
    distanceToSpawn: Number(
      Math.hypot(pos.x - ball.spawnPoint.x, pos.y - ball.spawnPoint.y, pos.z - ball.spawnPoint.z).toFixed(2),
    ),
    y: Number(pos.y.toFixed(2)),
  };
});

// ——— 7. перезагрузка: счёт и статус на месте ———
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Продолжить")');
await page.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(1500);
out.afterReload = await page.evaluate(() => {
  const game = window.viceShore;
  return {
    goals: game.ballMission.goalCount,
    m2: game.quests.get('mission_02')?.status,
    state: document.querySelector('.mission-room__state')?.textContent ?? null,
  };
});

out.errors = errors;
console.log(JSON.stringify(out, null, 2));
await browser.close();
