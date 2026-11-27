// Задача 7: сквозная проверка миссии «покрась стену» + скриншоты.
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
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Играть'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(800);

// ——— 1. у стремянки: подсказка и взятие валика ———
await page.evaluate(() => {
  const game = window.viceShore;
  const spot = game.world.island.renovation.rollerSpot;
  game.player.spawn(spot.x - 1.0, spot.z, game.world.island, -Math.PI / 2);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(1800);
out.promptRoller = await page.evaluate(() => document.querySelector('.mission-prompt')?.textContent ?? null);
await page.screenshot({ path: 'shots/t7-01-roller.png' });
await page.keyboard.press('KeyE');
await page.waitForTimeout(700);
out.afterRoller = await page.evaluate(() => ({
  flag: window.viceShore.quests.hasFlag('mission_01', 'roller'),
  step: window.viceShore.quests.currentStep('mission_01'),
  task: document.querySelector('.mission-task__title')?.textContent ?? null,
}));

// ——— 2. банка краски ———
await page.evaluate(() => {
  const game = window.viceShore;
  const spot = game.world.island.renovation.canSpot;
  game.player.spawn(spot.x - 1.1, spot.z, game.world.island, -Math.PI / 2);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(1500);
out.promptPaint = await page.evaluate(() => document.querySelector('.mission-prompt')?.textContent ?? null);
await page.screenshot({ path: 'shots/t7-02-can.png' });
await page.keyboard.press('KeyE');
await page.waitForTimeout(600);
out.afterPaint = await page.evaluate(() => ({
  flag: window.viceShore.quests.hasFlag('mission_01', 'paint'),
  step: window.viceShore.quests.currentStep('mission_01'),
}));

// ——— 3. вход в режим покраски ———
await page.evaluate(() => {
  const game = window.viceShore;
  const wall = game.world.island.renovation.wall;
  game.player.spawn(wall.center.x - 1.7, wall.center.z, game.world.island, -Math.PI / 2);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(1500);
out.promptWall = await page.evaluate(() => document.querySelector('.mission-prompt')?.textContent ?? null);
await page.keyboard.press('KeyE');
await page.waitForTimeout(900);
out.painting = await page.evaluate(() => window.viceShore.paintMission.painting);
await page.screenshot({ path: 'shots/t7-03-paint-start.png' });

// ——— 4. красим: гоняем валик вверх-вниз фиксированным шагом ———
await page.keyboard.down('KeyW');
out.pass1 = await page.evaluate(() => {
  const game = window.viceShore;
  const wall = game.world.island.renovation.wall;
  const before = wall.progress;
  for (let i = 0; i < 150; i += 1) game.paintMission.updatePainting(1 / 60, { x: 0, y: 0 });
  return { before: Number(before.toFixed(3)), after: Number(wall.progress.toFixed(3)) };
});
await page.keyboard.up('KeyW');
await page.screenshot({ path: 'shots/t7-04-painting.png' });

// Вниз по той же полосе + шаг вправо и проход по каждой полосе
out.sweep = await page.evaluate(() => {
  const game = window.viceShore;
  const wall = game.world.island.renovation.wall;
  const mission = game.paintMission;
  const input = game.input;
  const completed = () => game.quests.isCompleted('mission_01');

  // один синтетический кадр; сохнет валик — сразу макаем
  const frame = () => {
    if (mission.paintOnRoller < 0.02) {
      input.pressedThisFrame.add('KeyR');
      mission.updatePainting(1 / 60, { x: 0, y: 0 });
      input.pressedThisFrame.clear();
    }
    mission.updatePainting(1 / 60, { x: 0, y: 0 });
  };
  const hold = (code, count) => {
    input.down.add(code);
    for (let i = 0; i < count && !completed(); i += 1) frame();
    input.down.delete(code);
  };
  const tap = (code) => {
    input.pressedThisFrame.add(code);
    mission.updatePainting(1 / 60, { x: 0, y: 0 });
    input.pressedThisFrame.clear();
  };

  let rounds = 0;
  while (!completed() && rounds < 5) {
    rounds += 1;
    for (let stripe = 0; stripe < 10 && !completed(); stripe += 1) {
      hold('KeyW', 160);
      hold('KeyS', 160);
      if (stripe < 9) tap('KeyD');
    }
    // возвращаемся к началу стены для второго круга
    for (let i = 0; i < 9; i += 1) tap('KeyA');
  }
  return {
    progress: Number(wall.progress.toFixed(3)),
    percent: Math.round(wall.progress * 100),
    completed: completed(),
    mission2: game.quests.get('mission_02')?.status ?? null,
    painting: mission.painting,
    rounds,
    usedCan: Number((1.15 - mission.canPaint).toFixed(2)),
  };
});

await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/t7-05-painted.png' });

// ——— 5. HUD и сохранение ———
out.hud = await page.evaluate(() => ({
  task: document.querySelector('.mission-task__title')?.textContent ?? null,
  room: document.querySelector('.mission-room__value')?.textContent ?? null,
  state: document.querySelector('.mission-room__state')?.textContent ?? null,
  controls: document.querySelector('.mission-controls')?.textContent ?? null,
}));
out.save = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('vice-shore.save.v1') ?? 'null');
  if (!raw) return null;
  return {
    missions: Object.keys(raw.missions ?? {}),
    m1: raw.missions?.mission_01 ? { status: raw.missions.mission_01.status, progress: Number((raw.missions.mission_01.progress ?? 0).toFixed(2)), flags: raw.missions.mission_01.flags, values: raw.missions.mission_01.values?.length } : null,
    m2: raw.missions?.mission_02?.status ?? null,
  };
});

// ——— 6. перезагрузка и «Продолжить»: состояние на месте ———
await page.evaluate(() => window.viceShore.quests.flush());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Продолжить")');
await page.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(1600);
out.afterReload = await page.evaluate(() => ({
  percent: Math.round(window.viceShore.world.island.renovation.wall.progress * 100),
  m1: window.viceShore.quests.get('mission_01')?.status,
  m2: window.viceShore.quests.get('mission_02')?.status,
  task: document.querySelector('.mission-task__title')?.textContent ?? null,
}));
await page.screenshot({ path: 'shots/t7-06-reloaded.png' });

console.log(JSON.stringify(out, null, 2));
await browser.close();
