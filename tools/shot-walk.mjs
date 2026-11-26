// Задача 6: кадры ходьбы от третьего лица.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(240000);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/t6-01-start.png' });
console.log('01 start');

// Шаг: держим W, пока снимаем — персонаж в движении
await page.keyboard.down('KeyW');
await page.waitForTimeout(700);
await page.screenshot({ path: 'shots/t6-02-walk.png' });
console.log('02 walk');
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/t6-03-walk2.png' });
console.log('03 walk2');

// Бег по газону
await page.keyboard.up('KeyW');
await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(6.5, 14.0, game.world.island, Math.PI * 0.9);
  game.snapThirdPersonCamera();
  for (let i = 0; i < 30; i += 1) game.thirdPersonCamera.look(-4, 0);
});
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyW');
await page.waitForTimeout(700);
await page.screenshot({ path: 'shots/t6-04-run.png' });
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');
console.log('04 run');

// Упираемся в витраж
await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(4.0, -3.4, game.world.island, 0);
  game.snapThirdPersonCamera();
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/t6-05-wall.png' });
await page.keyboard.up('KeyW');
console.log('05 wall');

// В комнате: камера у стены поджимается
await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(-0.6, -12.6, game.world.island, Math.PI * 1.15);
  game.snapThirdPersonCamera();
});
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/t6-06-interior.png' });
console.log('06 interior');

// Крупный план: колесо приближает
await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(0.7, 6.4, game.world.island, 0);
  game.snapThirdPersonCamera();
  game.thirdPersonCamera.zoom(-1.6);
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/t6-07-closeup.png' });
await page.keyboard.up('KeyW');
console.log('07 closeup');

await browser.close();
