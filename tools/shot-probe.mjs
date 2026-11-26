// Мини-проба броска: замах → отпускание → полёт, с диагностикой каждого шага.
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
await page.waitForTimeout(900);

await page.evaluate(() => {
  const game = window.viceShore;
  game.quests.complete('mission_01');
  const ball = game.ballMission;
  const rim = game.world.island.court.geometry.center;
  game.player.spawn(ball.spawnPoint.x + 0.9, ball.spawnPoint.z, game.world.island, -Math.PI / 2);
  game.snapThirdPersonCamera();
  ball.pickUp();
  game.player.spawn(rim.x + 6.2, rim.z, game.world.island, Math.PI / 2);
  game.thirdPersonCamera.setYaw(Math.PI / 2);
  game.thirdPersonCamera.setPitch(0.4);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(1500);

const steps = await page.evaluate(() => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const trace = [];
  const snapshot = (label) => trace.push({
    label,
    held: ball.heldBall,
    charge: Number(ball.chargingPower.toFixed(3)),
    power: Number(ball.charge.toFixed?.(3) ?? -1),
    pos: ball.ballPosition.toArray().map((v) => Number(v.toFixed(2))),
    vel: ball.ballVelocity.toArray().map((v) => Number(v.toFixed(2))),
    mouse: game.input.isMouseDown(0),
  });
  snapshot('start');
  ball.holdCharge(true);
  for (let i = 0; i < 22; i += 1) ball.update(1 / 60);
  snapshot('charged');
  ball.holdCharge(false);
  ball.update(1 / 60);
  snapshot('afterRelease');
  for (let i = 0; i < 20; i += 1) ball.update(1 / 60);
  snapshot('flight20');
  for (let i = 0; i < 40; i += 1) ball.update(1 / 60);
  snapshot('flight60');
  for (let i = 0; i < 60; i += 1) ball.update(1 / 60);
  snapshot('flight120');
  return {
    trace,
    goals: ball.goalCount,
    window: ball.shotWindow(),
    player: game.player.position.toArray().map((v) => Number(v.toFixed(2))),
    character: game.character.group.position.toArray().map((v) => Number(v.toFixed(2))),
    yaw: Number(game.thirdPersonCamera.yaw.toFixed(3)),
    playerYaw: Number(game.player.yaw.toFixed(3)),
    aim: ball.aimDirection().toArray().map((v) => Number(v.toFixed(3))),
  };
});
console.log(JSON.stringify(steps, null, 1));
console.log('ERRORS', JSON.stringify(errors.slice(0, 3)));
await browser.close();
