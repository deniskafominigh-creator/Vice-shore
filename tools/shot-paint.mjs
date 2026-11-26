// Кадры задачи 7: неокрашенная стена, процесс, готовая стена.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 90000 });
await page.waitForTimeout(700);

await page.evaluate(() => {
  const game = window.viceShore;
  const island = game.world.island;
  const wall = island.renovation.wall;
  game.player.spawn(wall.center.x - 3.2, wall.center.z + 0.4, island, -Math.PI / 2);
  game.snapThirdPersonCamera();
  game.thirdPersonCamera.zoom(1.2);
});
await page.waitForTimeout(1800);
await page.screenshot({ path: 'shots/t7-room.png' });
console.log('01 room');

// Берём предметы и красим половину стены
await page.evaluate(() => {
  const game = window.viceShore;
  const island = game.world.island;
  const mission = game.paintMission;
  const wall = island.renovation.wall;
  const input = game.input;
  mission.takeRoller();
  mission.takePaint();
  game.player.spawn(wall.center.x - 1.4, wall.center.z - 1.2, island, -Math.PI / 2);
  mission.enterPainting();
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
    for (let i = 0; i < count; i += 1) frame();
    input.down.delete(code);
  };
  const tap = (code) => {
    input.pressedThisFrame.add(code);
    mission.updatePainting(1 / 60, { x: 0, y: 0 });
    input.pressedThisFrame.clear();
  };
  for (let stripe = 0; stripe < 6; stripe += 1) {
    hold('KeyW', 150);
    hold('KeyS', 150);
    if (stripe < 5) tap('KeyD');
  }
  tap('KeyA');
  hold('KeyW', 60);
});
await page.keyboard.down('KeyS');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/t7-progress.png' });
await page.keyboard.up('KeyS');
console.log('02 painting');

// Докрашиваем до конца
await page.evaluate(() => {
  const game = window.viceShore;
  const mission = game.paintMission;
  const input = game.input;
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
    for (let i = 0; i < count; i += 1) frame();
    input.down.delete(code);
  };
  const tap = (code) => {
    input.pressedThisFrame.add(code);
    mission.updatePainting(1 / 60, { x: 0, y: 0 });
    input.pressedThisFrame.clear();
  };
  for (let round = 0; round < 3 && !game.quests.isCompleted('mission_01'); round += 1) {
    for (let stripe = 0; stripe < 10 && !game.quests.isCompleted('mission_01'); stripe += 1) {
      hold('KeyW', 160);
      hold('KeyS', 160);
      if (stripe < 9) tap('KeyD');
    }
    for (let i = 0; i < 9; i += 1) tap('KeyA');
  }
});
await page.waitForTimeout(1400);
await page.evaluate(() => {
  const game = window.viceShore;
  const island = game.world.island;
  const wall = island.renovation.wall;
  game.player.spawn(wall.center.x - 3.0, wall.center.z, island, -Math.PI / 2);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(1600);
await page.screenshot({ path: 'shots/t7-done.png' });
console.log('03 painted', JSON.stringify(errors));
await browser.close();
