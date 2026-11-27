// Проба задачи 8: геометрия кольца и подбор угла/силы броска через predictThrow.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 90000 });
await page.waitForTimeout(800);

const geometry = await page.evaluate(() => {
  const game = window.viceShore;
  const island = game.world.island;
  const hoop = island.court.geometry;
  const ball = game.ballMission;
  return {
    rim: { x: hoop.center.x, y: hoop.center.y, z: hoop.center.z, radius: hoop.radius, tube: hoop.tube },
    board: hoop.board,
    slabTopY: island.court.slabTopY,
    bounds: island.court.bounds,
    spawn: { x: ball.spawnPoint.x, y: ball.spawnPoint.y, z: ball.spawnPoint.z },
    groundAtSpawn: island.groundHeightAt(ball.spawnPoint.x, ball.spawnPoint.z),
    groundAtRim: island.groundHeightAt(hoop.center.x, hoop.center.z),
  };
});
console.log('GEOMETRY', JSON.stringify(geometry, null, 1));

// Ставим героя на линию броска и даём игре пару кадров, чтобы руки встали на место
await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const spawn = ball.spawnPoint;
  game.player.spawn(spawn.x + 0.9, spawn.z, game.world.island, -Math.PI / 2);
  game.snapThirdPersonCamera();
  ball.pickUp();
  game.player.spawn(game.world.island.court.geometry.center.x + 6.2, game.world.island.court.geometry.center.z, game.world.island, Math.PI / 2);
  game.snapThirdPersonCamera();
  game.thirdPersonCamera.setYaw(Math.PI / 2);
  game.thirdPersonCamera.setPitch(0);
});
await page.waitForTimeout(1200);

const hand = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  return {
    held: ball.heldBall,
    ballPos: ball.ballPosition.toArray().map((v) => Number(v.toFixed(3))),
    player: game.player.position.toArray().map((v) => Number(v.toFixed(3))),
    predictions: [-0.2, 0, 0.2, 0.4].map((pitch) => {
      game.thirdPersonCamera.setPitch(pitch);
      const row = [];
      for (const charge of [0.3, 0.5, 0.7, 0.9, 1]) {
        const result = ball.predictThrow(charge);
        row.push({ charge, scores: result.scores, land: [Number(result.landX.toFixed(2)), Number(result.landY.toFixed(2)), Number(result.landZ.toFixed(2))] });
      }
      return { pitch, row };
    }),
  };
});
console.log('HAND', JSON.stringify(hand, null, 1));

// Подробная трассировка: как близко мяч подходит к центру кольца
const trace = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const rim = game.world.island.court.geometry.center;
  const rows = [];
  for (const pitch of [0.2, 0.4, 0.5, 0.6]) {
    game.thirdPersonCamera.setPitch(pitch);
    const charges = [];
    for (const charge of [0.3, 0.35, 0.4, 0.45, 0.5, 0.55]) {
      const points = ball.predictTrace(charge, 2.5);
      let best = 99;
      let bestPoint = null;
      let aboveRim = false;
      for (let i = 0; i < points.length; i += 3) {
        const dx = points[i] - rim.x;
        const dy = points[i + 1] - rim.y;
        const dz = points[i + 2] - rim.z;
        const horizontal = Math.hypot(dx, dz);
        if (Math.abs(dy) < 0.5 && horizontal < best) {
          best = horizontal;
          bestPoint = [points[i], points[i + 1], points[i + 2]];
          aboveRim = dy > 0;
        }
      }
      charges.push({ charge, best: Number(best.toFixed(3)), aboveRim, point: bestPoint });
    }
    rows.push({ pitch, charges });
  }
  return rows;
});
console.log('TRACE', JSON.stringify(trace, null, 1));

// Отладка доводки: что решает solver и куда летит мяч
const snap = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const rim = game.world.island.court.geometry.center;
  const rows = [];
  for (const pitch of [0.2, 0.4, 0.6]) {
    game.thirdPersonCamera.setPitch(pitch);
    const win = ball.shotWindow();
    const charges = [];
    for (const charge of [0.3, 0.35, 0.4, 0.45, 0.5, 0.6]) {
      const points = ball.predictTrace(charge, 2.2);
      let best = 99;
      let atY = null;
      for (let i = 0; i < points.length; i += 3) {
        const horizontal = Math.hypot(points[i] - rim.x, points[i + 2] - rim.z);
        if (Math.abs(points[i + 1] - rim.y) < 0.35 && horizontal < best) {
          best = horizontal;
          atY = Number((points[i + 1] - rim.y).toFixed(3));
        }
      }
      charges.push({ charge, best: Number(best.toFixed(3)), atY, scores: ball.predictThrow(charge).scores });
    }
    rows.push({ pitch, win, charges });
  }
  return rows;
});
console.log('SNAP', JSON.stringify(snap));

const grid = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const hoop = game.world.island.court.geometry.center;
  // сначала берём мяч там, где он лежит, потом встаём на линию броска
  const spawn = ball.spawnPoint;
  game.player.spawn(spawn.x + 0.9, spawn.z, game.world.island, -Math.PI / 2);
  game.snapThirdPersonCamera();
  const pickedUp = ball.pickUp();
  const px = hoop.x + 6.2;
  const pz = hoop.z;
  game.player.spawn(px, pz, game.world.island, Math.PI / 2);
  game.snapThirdPersonCamera();
  game.thirdPersonCamera.setYaw(Math.PI / 2);
  const held = ball.heldBall;
  const rows = [];
  for (let pitch = -0.28; pitch <= 1.06; pitch += 0.1) {
    const row = { pitch: Number(pitch.toFixed(2)), scores: [] };
    for (let charge = 0.1; charge <= 1.001; charge += 0.05) {
      game.thirdPersonCamera.setPitch(pitch);
      const result = ball.predictThrow(charge);
      if (result.scores) row.scores.push(Number(charge.toFixed(2)));
    }
    rows.push(row);
  }
  return { pickedUp, held, px, pz, rows, aim: ball.aimDirection().toArray().map((v) => Number(v.toFixed(3))) };
});
console.log('GRID', JSON.stringify(grid, null, 1));
console.log('ERRORS', JSON.stringify(errors.slice(0, 5)));
await browser.close();
