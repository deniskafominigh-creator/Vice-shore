// Задача 6: числовая проверка коллизий и камеры (без скриншотов — быстро).
import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  null,
  { timeout: 60000 },
);

const report = await page.evaluate(() => {
  const game = window.viceShore;
  const island = game.world.island;
  const out = { runs: [], camera: {}, errors: [] };

  const drive = (x, z, yaw, forward, steps = 300, run = false) => {
    game.player.spawn(x, z, island, yaw);
    // Камера смотрит туда же, куда герой: forward по камере = вперёд
    game.thirdPersonCamera.setYaw(yaw);
    const before = game.player.getState();
    const keys = run ? 1 : 0;
    for (let i = 0; i < steps; i += 1) {
      game.player.update(1 / 60, { forward, strafe: 0, run: keys === 1 }, yaw, island);
    }
    const after = game.player.getState();
    return {
      from: [Number(before.x.toFixed(2)), Number(before.z.toFixed(2))],
      to: [Number(after.x.toFixed(2)), Number(after.z.toFixed(2))],
      y: Number(after.y.toFixed(2)),
      travelled: Number(Math.hypot(after.x - before.x, after.z - before.z).toFixed(2)),
      blocked: island.collisions.isBlocked(after.x, after.z, 0.3, after.y + 0.3),
    };
  };

  // 1. прямо в глухую часть витража (x = 4.0) — должен упереться
  out.runs.push({ name: 'стекло x=4.0', ...drive(4.0, -1.5, 0, 1) });
  // 2. в открытую створку (x = 0.4) — проходит в дом
  out.runs.push({ name: 'проём x=0.4', ...drive(0.4, -1.5, 0, 1) });
  // 3. в заднюю стену изнутри
  out.runs.push({ name: 'задняя стена', ...drive(0.0, -12.5, Math.PI, 1) });
  // 4. в боковую стену дома
  out.runs.push({ name: 'боковая стена', ...drive(-12.0, -10.2, -Math.PI / 2, 1) });
  // 5. в диван: внутрь него не попасть
  out.runs.push({ name: 'диван', ...drive(1.6, -8.2, 0, 1) });
  // 6. в опору кольца
  out.runs.push({ name: 'опора кольца', ...drive(-28.3, 8.6, 0, 1) });
  // 7. к забору/кромке острова — не улетаем
  out.runs.push({ name: 'кромка острова', ...drive(0.0, 14.0, 0, 1, 900) });
  // 8. бег через весь газон
  out.runs.push({ name: 'бег 5 с', ...drive(6.0, 16.0, Math.PI, 1, 300, true) });

  // Камера: у стены пружина короче
  // Герой спиной к задней стене: камера должна укоротиться
  game.player.spawn(0.4, -14.4, island, Math.PI);
  game.snapThirdPersonCamera();
  const nearWall = Math.hypot(
    game.thirdPersonCamera.camera.position.x - game.player.position.x,
    game.thirdPersonCamera.camera.position.z - game.player.position.z,
  );
  game.player.spawn(0.7, 8.4, island, 0);
  game.snapThirdPersonCamera();
  const open = Math.hypot(
    game.thirdPersonCamera.camera.position.x - game.player.position.x,
    game.thirdPersonCamera.camera.position.z - game.player.position.z,
  );
  out.camera = {
    nearWall: Number(nearWall.toFixed(2)),
    open: Number(open.toFixed(2)),
    heightOpen: Number((game.thirdPersonCamera.camera.position.y - game.player.position.y).toFixed(2)),
  };
  return out;
});

console.log(JSON.stringify({ report, errors }, null, 2));
await browser.close();
