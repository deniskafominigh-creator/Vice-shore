// Задача 6: проверка ходьбы, коллизий и камеры от третьего лица.
// Движение прогоняется фиксированным шагом (1/60) прямо через game.updatePlayer —
// так результат не зависит от частоты кадров в SwiftShader.
import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(180000);
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
  { timeout: 60000 },
);
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/t6-01-start.png' });

// ——— 1. ходьба вперёд от точки старта ———
const walk = async (steps, keys = ['KeyW']) => {
  for (const key of keys) await page.keyboard.down(key);
  const measured = await page.evaluate((count) => {
    const game = window.viceShore;
    const start = game.player.getState();
    for (let i = 0; i < count; i += 1) game.updatePlayer(1 / 60, { x: 0, y: 0 });
    const end = game.player.getState();
    const camera = game.thirdPersonCamera.camera.position;
    return {
      start,
      end,
      distance: Math.hypot(end.x - start.x, end.z - start.z),
      speed: game.player.speed,
      speed01: game.player.speed01,
      phase: game.player.phase,
      cameraDistance: Math.hypot(camera.x - end.x, camera.z - end.z),
      cameraHeight: camera.y - end.y,
    };
  }, steps);
  return measured;
};

out.walk2s = await walk(120);
await page.screenshot({ path: 'shots/t6-02-walk.png' });
out.walkMore = await walk(90);
await page.keyboard.up('KeyW');
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/t6-03-stopped.png' });

// ——— 2. бег ———
const run = await walk(60, ['KeyW', 'ShiftLeft']);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
out.run = run;
await page.screenshot({ path: 'shots/t6-04-run.png' });

// ——— 3. стена виллы: сквозь неё пройти нельзя ———
await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(0.4, -1.5, game.world.island, 0);
  game.snapThirdPersonCamera();
});
await page.keyboard.down('KeyW');
out.wall = await page.evaluate(() => {
  const game = window.viceShore;
  for (let i = 0; i < 300; i += 1) game.updatePlayer(1 / 60, { x: 0, y: 0 });
  return { ...game.player.getState(), speed: game.player.speed, phase: game.player.phase };
});
await page.keyboard.up('KeyW');
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/t6-05-wall.png' });

// ——— 4. камера не проходит сквозь стену в комнате ———
await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(0.2, -9.4, game.world.island, Math.PI);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(900);
out.interior = await page.evaluate(() => {
  const game = window.viceShore;
  const camera = game.thirdPersonCamera.camera.position;
  const player = game.player.getState();
  return {
    player,
    camera: { x: camera.x, y: camera.y, z: camera.z },
    cameraDistance: Math.hypot(camera.x - player.x, camera.z - player.z),
    height: player.y,
  };
});
await page.screenshot({ path: 'shots/t6-06-interior.png' });

// ——— 5. полный круг по острову: клавиши A и D ———
await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(0.7, 8.4, game.world.island, 0);
  game.snapThirdPersonCamera();
});
const strafe = await walk(60, ['KeyD']);
out.strafe = strafe;
await page.keyboard.up('KeyD');
await page.waitForTimeout(400);

// ——— 6. кадр с персонажем крупно (колесо мыши приближает) ———
await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(0.7, 8.4, game.world.island, 0);
  game.snapThirdPersonCamera();
  game.thirdPersonCamera.zoom(-1.2);
});
await page.keyboard.down('KeyW');
await page.evaluate(() => { for (let i = 0; i < 40; i += 1) window.viceShore.updatePlayer(1 / 60, { x: 0, y: 0 }); });
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/t6-07-closeup.png' });
await page.keyboard.up('KeyW');

console.log(JSON.stringify(out, null, 2));
await browser.close();
