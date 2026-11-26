// Диагностика покраски: сколько реально прибавляется за проход.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 90000 });
await page.waitForTimeout(600);

const report = await page.evaluate(() => {
  const game = window.viceShore;
  const island = game.world.island;
  const mission = game.paintMission;
  const wall = island.renovation.wall;
  const input = game.input;

  // Забираем предметы напрямую (без клавиш), встаём к стене и входим в покраску
  mission.takeRoller();
  mission.takePaint();
  game.player.spawn(wall.center.x - 1.6, wall.center.z, island, -Math.PI / 2);
  mission.enterPainting();

  const step = (count) => {
    for (let i = 0; i < count; i += 1) mission.updatePainting(1 / 60, { x: 0, y: 0 });
  };
  const snap = () => ({
    progress: Number(wall.progress.toFixed(3)),
    stripe: mission.stripe,
    rollerY: Number(mission.rollerY.toFixed(2)),
    paint: Number(mission.paintOnRoller.toFixed(3)),
    can: Number(mission.canPaint.toFixed(3)),
  });

  const log = [];
  log.push({ phase: 'вход', ...snap() });
  const hold = (code, count) => {
    input.down.add(code);
    step(count);
    input.down.delete(code);
  };
  const tap = (code) => {
    input.pressedThisFrame.add(code);
    step(1);
    input.pressedThisFrame.clear();
  };
  const rows = [];
  for (let stripe = 0; stripe < 4; stripe += 1) {
    hold('KeyW', 150);
    hold('KeyS', 150);
    rows.push({ stripe: mission.stripe, after: Number(wall.stripeProgress(mission.stripe).toFixed(2)), paint: Number(mission.paintOnRoller.toFixed(2)) });
    tap('KeyD');
  }
  const stripesAll = Array.from({ length: 10 }, (_, i) => Number(wall.stripeProgress(i).toFixed(2)));
  return { log, rows, stripesAll };
});

console.log(JSON.stringify({ report, errors }, null, 2));
await browser.close();
