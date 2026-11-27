// Приёмка задачи 1: полный прогон интерфейса + проверка собранного одним файлом dist/index.html
import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const result = { dev: {}, dist: {}, errors: [] };

// ——— 1. dev-сервер: весь путь по интерфейсу ———
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// Сцена с островом на программном рендере (SwiftShader) кадрится медленно —
// скриншотам нужен запас, иначе проверка падает по таймауту, а не по баге.
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => result.errors.push(`dev: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') result.errors.push(`dev console: ${m.text()}`); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/final-01-menu.png' });

const stateOf = () => page.evaluate(() => window.viceShore?.machine?.current ?? null);
// Ждём не только нужное состояние, но и завершение перехода (иначе ввод ещё заблокирован).
const waitState = async (id) => {
  await page.waitForFunction(
    (target) => window.viceShore?.machine?.current === target && !window.viceShore?.machine?.isBusy,
    id,
    { timeout: 150000 },
  );
  return id;
};
result.dev.menu = await stateOf();

// навигация с клавиатуры
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
result.dev.focusLabel = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);

// настройки: меняем качество и громкость
await page.click('.menu-list__button:has-text("Настройки")');
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/final-02-settings.png' });
await page.click('.segmented__button:has-text("Высокое")');
await page.waitForTimeout(300);
result.dev.qualityAfterClick = await page.evaluate(() => window.viceShore?.settings?.get('quality'));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// управление
await page.click('.menu-list__button:has-text("Управление")');
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/final-03-controls.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// игра
await page.click('.menu-list__button:has-text("Играть")');
result.dev.playing = await waitState('playing');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/final-04-playing.png' });

// миссия 01 (задача 7): плашка задачи и активный квест
result.dev.mission = await page.evaluate(() => ({
  task: document.querySelector('.mission-task__title')?.textContent ?? null,
  active: window.viceShore.quests.isActive('mission_01'),
  hudVisible: Boolean(document.querySelector('.mission-hud:not(.is-hidden)')),
}));

// движение вперёд: герой идёт, камера от третьего лица едет за ним.
// Шаг фиксированный (1/60), иначе на SwiftShader скорость зависит от частоты кадров.
await page.keyboard.down('KeyW');
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/final-08-walk.png' });
result.dev.walk = await page.evaluate(() => {
  const game = window.viceShore;
  const before = game.player.getState();
  for (let i = 0; i < 120; i += 1) game.updatePlayer(1 / 60, { x: 0, y: 0 });
  const after = game.player.getState();
  const camera = game.thirdPersonCamera.camera.position;
  return {
    moved: Number(Math.hypot(after.x - before.x, after.z - before.z).toFixed(2)),
    speed: Number(game.player.speed.toFixed(2)),
    phase: Number(game.player.phase.toFixed(2)),
    cameraDistance: Number(Math.hypot(camera.x - after.x, camera.z - after.z).toFixed(2)),
    cameraHeight: Number((camera.y - after.y).toFixed(2)),
  };
});
await page.keyboard.up('KeyW');
result.dev.moved = result.dev.walk.moved;

// коллизии: в глухую часть витража не пройти
result.dev.wall = await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(4.0, -1.5, game.world.island, 0);
  for (let i = 0; i < 240; i += 1) game.player.update(1 / 60, { forward: 1, strafe: 0, run: false }, 0, game.world.island);
  const state = game.player.getState();
  return { z: Number(state.z.toFixed(2)), stopped: state.z > -5.3 };
});

// пауза → возврат в игру
await page.keyboard.press('Escape');
result.dev.paused = await waitState('paused');
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/final-05-pause.png' });
await page.click('.panel button:has-text("Продолжить")');
result.dev.resumed = await waitState('playing');
await page.waitForTimeout(600);

// выход в меню и «Продолжить»
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await page.click('.panel button:has-text("В главное меню")');
result.dev.backToMenu = await waitState('menu');
await page.waitForTimeout(1200);
result.dev.continueEnabled = await page.evaluate(
  () => !document.querySelectorAll('.menu-list__button')[1].hasAttribute('disabled'),
);
await page.screenshot({ path: 'shots/final-06-menu-return.png' });

// ——— 2. собранный один файл (file://) ———
// dev-страницу закрываем: два WebGL-контекста на SwiftShader делят один CPU,
// и проверка dist падала по таймауту, хотя игра грузилась нормально.
await page.close();
const distPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
distPage.setDefaultTimeout(180000);
distPage.on('pageerror', (e) => result.errors.push(`dist: ${e.message}`));
distPage.on('console', (m) => { if (m.type() === 'error') result.errors.push(`dist console: ${m.text()}`); });
await distPage.goto('file:///home/user/dist/index.html', { waitUntil: 'domcontentloaded' });
await distPage.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await distPage.waitForTimeout(1200);
await distPage.screenshot({ path: 'shots/final-07-dist-file.png' });
result.dist.state = await distPage.evaluate(() => window.viceShore?.machine?.current ?? null);
result.dist.hero = await distPage.evaluate(() => {
  const hero = window.viceShore?.character;
  if (!hero) return null;
  return { cls: hero.constructor.name, bones: hero.boneCount, triangles: hero.triangleCount, fingers: [...hero.rig.bones.keys()].filter((n) => /_(l|r)_0[123]$/.test(n)).length };
});
result.dist.player = await distPage.evaluate(() => {
  const game = window.viceShore;
  const before = game.player.getState();
  for (let i = 0; i < 60; i += 1) game.player.update(1 / 60, { forward: 1, strafe: 0, run: false }, 0, game.world.island);
  const after = game.player.getState();
  return Number(Math.hypot(after.x - before.x, after.z - before.z).toFixed(2));
});
result.dist.fontLoaded = await distPage.evaluate(() => document.fonts.check('700 48px Oswald'));

console.log(JSON.stringify(result, null, 2));
await browser.close();
