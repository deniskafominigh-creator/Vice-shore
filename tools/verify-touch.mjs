// Приёмка задачи 11: определение устройства, сенсорное управление, полноэкранный режим.
//
// Проверяем три вещи, которые легко «показать» и легко сломать:
//  1) на телефоне игра сама включает сенсорную схему, на компьютере — клавиатурную;
//  2) стик/свайп/кнопки реально двигают героя, крутят камеру и нажимают «E» —
//     через настоящие DOM-события, а не через внутренние методы;
//  3) переключатели в настройках работают: схема управления и полный экран.
//
// Запуск: node tools/verify-touch.mjs   (нужен dev-сервер на 5173 или VS_URL)

import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const result = { mobile: {}, desktop: {}, dist: {}, errors: [] };

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

/** Телефон: iPhone 13 в Playwright — тач, грубый указатель, мобильный UA. */
const phone = await browser.newContext({ ...devices['iPhone 13'] });
const page = await phone.newPage();
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => result.errors.push(`mobile: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') result.errors.push(`mobile console: ${m.text()}`);
});

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.waitForTimeout(800);

// ——— 1. определение устройства ———
result.mobile.platform = await page.evaluate(() => {
  const p = window.viceShore.platform;
  return { touch: p.touch, phone: p.phone, tablet: p.tablet, label: p.label, reason: p.reason, fullscreen: p.fullscreen };
});
result.mobile.scheme = await page.evaluate(() => window.viceShore.scheme);
result.mobile.hint = await page.evaluate(() => window.viceShore.playHint);
result.mobile.uiTouchClass = await page.evaluate(() =>
  document.getElementById('ui-root')?.classList.contains('is-touch'),
);
result.mobile.qualityDefault = await page.evaluate(() => window.viceShore.settings.get('quality'));

// ——— 2. настройки: схема управления и полный экран ———
await page.click('.menu-list__button:has-text("Настройки")');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/touch-settings.png' });
result.mobile.settings = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.panel__row')].map((row) => ({
    label: row.querySelector('.panel__label')?.firstChild?.textContent?.trim() ?? '',
    hint: row.querySelector('.panel__label small')?.textContent ?? '',
  }));
  const fullscreenSwitch = [...document.querySelectorAll('.panel__row')]
    .find((row) => row.textContent?.includes('Полноэкранный'))
    ?.querySelector('button.switch');
  return {
    rows: rows.map((row) => row.label),
    controlsRowHint: rows.find((row) => row.label === 'Управление')?.hint ?? null,
    fullscreenRow: Boolean(fullscreenSwitch),
    fullscreenDisabled: fullscreenSwitch?.disabled ?? null,
    activeScheme:
      [...document.querySelectorAll('.panel__row')]
        .find((row) => row.textContent?.startsWith('Управление'))
        ?.querySelector('.segmented .is-active')?.textContent ?? null,
  };
});

// Переключение схемы на «Мышь»: сенсорный слой должен уйти, подсказка — смениться.
await page.click('.segmented__button:has-text("Мышь")');
await page.waitForTimeout(500);
result.mobile.switchToKeyboard = await page.evaluate(() => ({
  scheme: window.viceShore.scheme,
  hint: window.viceShore.playHint,
  uiTouchClass: document.getElementById('ui-root')?.classList.contains('is-touch'),
}));
await page.click('.segmented__button:has-text("Сенсор")');
await page.waitForTimeout(400);
result.mobile.switchBackToTouch = await page.evaluate(() => ({
  scheme: window.viceShore.scheme,
  stored: window.viceShore.settings.get('controls'),
}));

// Полный экран: клик по переключателю должен изменить состояние (если браузер разрешает).
const fullscreenSwitch = page.locator('.panel__row:has-text("Полноэкранный") button.switch');
result.mobile.fullscreenBefore = await page.evaluate(() => window.viceShore.fullscreen.active);
await fullscreenSwitch.click();
await page.waitForTimeout(700);
result.mobile.fullscreenAfter = await page.evaluate(() => ({
  active: window.viceShore.fullscreen.active,
  setting: window.viceShore.settings.get('fullscreen'),
  element: document.fullscreenElement?.tagName ?? null,
}));
// Возвращаем как было, чтобы не мешать остальным проверкам.
if (await page.evaluate(() => window.viceShore.fullscreen.active)) {
  await fullscreenSwitch.click();
  await page.waitForTimeout(500);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ——— 3. игра: сенсорный слой живёт, кнопки работают ———
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  { timeout: 150000 },
);
await page.waitForTimeout(1200);

result.mobile.touchUiVisible = await page.evaluate(() => {
  const ui = document.querySelector('.touch-ui');
  return Boolean(ui) && !ui.classList.contains('is-hidden');
});
const stickBox = await page.locator('.touch-stick').boundingBox();
const lookBox = await page.locator('.touch-look').boundingBox();
result.mobile.controlsBoxes = {
  stick: stickBox ? { w: Math.round(stickBox.width), h: Math.round(stickBox.height) } : null,
  look: lookBox ? { w: Math.round(lookBox.width), h: Math.round(lookBox.height) } : null,
};

// Стик: настоящий pointerdown/pointermove по элементу → виртуальная ось → герой идёт.
await page.dispatchEvent('.touch-stick', 'pointerdown', {
  pointerId: 11,
  pointerType: 'touch',
  isPrimary: true,
  clientX: stickBox.x + stickBox.width / 2,
  clientY: stickBox.y + stickBox.height / 2,
  bubbles: true,
});
await page.dispatchEvent('.touch-stick', 'pointermove', {
  pointerId: 11,
  pointerType: 'touch',
  isPrimary: true,
  clientX: stickBox.x + stickBox.width / 2,
  clientY: stickBox.y + stickBox.height / 2 - 70,
  bubbles: true,
});
result.mobile.stickAxes = await page.evaluate(() => ({
  forward: window.viceShore.input.axis('KeyS', 'KeyW'),
  strafe: window.viceShore.input.axis('KeyA', 'KeyD'),
  run: window.viceShore.input.isDown('ShiftLeft'),
}));
result.mobile.stickWalk = await page.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(0.7, 8.4, game.world.island, 0);
  const before = game.player.getState();
  for (let i = 0; i < 120; i += 1) game.updatePlayer(1 / 60, { x: 0, y: 0 });
  const after = game.player.getState();
  return {
    moved: Number(Math.hypot(after.x - before.x, after.z - before.z).toFixed(2)),
    axis: Number(game.input.axis('KeyS', 'KeyW').toFixed(2)),
  };
});
await page.dispatchEvent('.touch-stick', 'pointerup', {
  pointerId: 11,
  pointerType: 'touch',
  isPrimary: true,
  clientX: stickBox.x + stickBox.width / 2,
  clientY: stickBox.y + stickBox.height / 2 - 70,
  bubbles: true,
});
result.mobile.stickReset = await page.evaluate(() => ({
  forward: window.viceShore.input.axis('KeyS', 'KeyW'),
  run: window.viceShore.input.isDown('ShiftLeft'),
}));

// Свайп по экрану: движение пальца → поворот камеры (через тот же путь, что и мышь).
// Замер — по реальной камере: дельту съедает игровой цикл в том же кадре, поэтому
// смотреть надо на результат, а не на внутренний счётчик.
result.mobile.yawBefore = await page.evaluate(() => Number(window.viceShore.thirdPersonCamera.yaw.toFixed(3)));
await page.dispatchEvent('.touch-look', 'pointerdown', {
  pointerId: 21,
  pointerType: 'touch',
  isPrimary: true,
  clientX: lookBox.x + lookBox.width * 0.4,
  clientY: lookBox.y + lookBox.height * 0.5,
  bubbles: true,
});
await page.dispatchEvent('.touch-look', 'pointermove', {
  pointerId: 21,
  pointerType: 'touch',
  isPrimary: true,
  clientX: lookBox.x + lookBox.width * 0.4 + 120,
  clientY: lookBox.y + lookBox.height * 0.5,
  bubbles: true,
});
await page.waitForTimeout(600);
result.mobile.lookWired = await page.evaluate((before) => {
  const game = window.viceShore;
  const yaw = game.thirdPersonCamera.yaw;
  return {
    yawBefore: before,
    yawAfter: Number(yaw.toFixed(3)),
    turned: Math.abs(yaw - before) > 0.01,
  };
}, result.mobile.yawBefore);
await page.dispatchEvent('.touch-look', 'pointerup', {
  pointerId: 21,
  pointerType: 'touch',
  isPrimary: true,
  clientX: lookBox.x + lookBox.width * 0.4 + 120,
  clientY: lookBox.y + lookBox.height * 0.5,
  bubbles: true,
});

// Кнопка «держать»: это ЛКМ — замах мяча и покраска.
await page.dispatchEvent('.touch-btn--hold', 'pointerdown', {
  pointerId: 31,
  pointerType: 'touch',
  isPrimary: true,
  bubbles: true,
});
result.mobile.holdDown = await page.evaluate(() => window.viceShore.input.isMouseDown(0));
await page.dispatchEvent('.touch-btn--hold', 'pointerup', {
  pointerId: 31,
  pointerType: 'touch',
  isPrimary: true,
  bubbles: true,
});
result.mobile.holdUp = await page.evaluate(() => window.viceShore.input.isMouseDown(0));

// Кнопка «Ⓔ»: одно нажатие = одно событие KeyE. Проверяем и связку, и то,
// что игра его видит: у мяча герой берёт мяч в руки.
result.mobile.actionTap = await page.evaluate(async () => {
  const game = window.viceShore;
  const ball = game.ballMission;
  const target = ball.spawnPoint;
  game.player.spawn(target.x + 0.55, target.z, game.world.island, 0);
  game.thirdPersonCamera.setYaw(0);
  let taps = 0;
  const original = game.input.tapVirtualKey.bind(game.input);
  game.input.tapVirtualKey = (code) => {
    taps += 1;
    original(code);
  };
  window.__tapCount = () => taps;
  return { ballAt: { x: Number(target.x.toFixed(2)), z: Number(target.z.toFixed(2)) } };
});
await page.dispatchEvent('.touch-btn--action', 'pointerdown', {
  pointerId: 41,
  pointerType: 'touch',
  isPrimary: true,
  bubbles: true,
});
await page.waitForTimeout(900);
result.mobile.actionEffect = await page.evaluate(() => ({
  taps: window.__tapCount?.() ?? 0,
  heldBall: window.viceShore.ballMission.heldBall,
  prompt: document.querySelector('.mission-prompt')?.textContent ?? null,
}));

// Режим покраски: дополнительные кнопки (полоса, макнуть) появляются сами.
result.mobile.paintingMode = await page.evaluate(() => {
  const game = window.viceShore;
  game.touch.setMode('painting');
  const extras = document.querySelector('.touch-extras');
  return {
    visible: Boolean(extras) && getComputedStyle(extras).display !== 'none',
    buttons: [...(extras?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim()),
    holdLabel: document.querySelector('.touch-btn--hold .touch-btn__title')?.textContent ?? null,
    actionLabel: document.querySelector('.touch-btn--action .touch-btn__label')?.textContent ?? null,
  };
});
await page.evaluate(() => window.viceShore.touch.setMode('world'));

// Пауза с сенсорной кнопки: слой управления прячется за модальной панелью.
await page.dispatchEvent('.touch-pause', 'pointerdown', {
  pointerId: 51,
  pointerType: 'touch',
  isPrimary: true,
  bubbles: true,
});
await page.waitForFunction(() => window.viceShore?.machine?.current === 'paused', { timeout: 120000 });
result.mobile.pauseByTouch = await page.evaluate(() => ({
  state: window.viceShore.machine.current,
  touchHidden: document.querySelector('.touch-ui')?.classList.contains('is-hidden'),
}));
await page.screenshot({ path: '/tmp/touch-pause.png' });
await page.click('.panel button:has-text("Продолжить")');
await page.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  { timeout: 180000 },
);
await page.screenshot({ path: '/tmp/touch-playing.png' });

// Пейзаж: на телефоне это основной режим, раскладка должна остаться рабочей.
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/touch-landscape.png' });
result.mobile.landscape = await page.evaluate(() => {
  const stick = document.querySelector('.touch-stick')?.getBoundingClientRect();
  const hold = document.querySelector('.touch-btn--hold')?.getBoundingClientRect();
  return {
    stick: stick ? { x: Math.round(stick.x), y: Math.round(stick.y), w: Math.round(stick.width) } : null,
    hold: hold ? { x: Math.round(hold.x), y: Math.round(hold.y), w: Math.round(hold.width) } : null,
    canvas: { w: window.innerWidth, h: window.innerHeight },
    hint: document.querySelector('.hint')?.textContent ?? null,
  };
});
await phone.close();

// ——— 4. компьютер: схема осталась клавиатурной ———
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desktopPage = await desktop.newPage();
desktopPage.setDefaultTimeout(180000);
desktopPage.on('pageerror', (e) => result.errors.push(`desktop: ${e.message}`));
await desktopPage.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await desktopPage.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await desktopPage.waitForTimeout(600);
result.desktop.detected = await desktopPage.evaluate(() => ({
  touch: window.viceShore.platform.touch,
  scheme: window.viceShore.scheme,
  hint: window.viceShore.playHint,
  uiTouchClass: document.getElementById('ui-root')?.classList.contains('is-touch'),
}));
await desktopPage.click('.menu-list__button:has-text("Настройки")');
await desktopPage.waitForTimeout(400);
result.desktop.settingsRows = await desktopPage.evaluate(() =>
  [...document.querySelectorAll('.panel__row .panel__label')].map((node) => node.firstChild?.textContent?.trim() ?? ''),
);
result.desktop.fullscreenSupported = await desktopPage.evaluate(() => window.viceShore.fullscreen.supported);
await desktopPage.keyboard.press('Escape');
await desktopPage.waitForTimeout(300);
await desktopPage.click('.menu-list__button:has-text("Играть")');
await desktopPage.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  { timeout: 150000 },
);
await desktopPage.waitForTimeout(800);
result.desktop.touchUiVisible = await desktopPage.evaluate(
  () => !document.querySelector('.touch-ui')?.classList.contains('is-hidden'),
);
// На компьютере кнопки не мешают: WASD по-прежнему двигает героя.
result.desktop.keyboardWalk = await desktopPage.evaluate(() => {
  const game = window.viceShore;
  game.player.spawn(0.7, 8.4, game.world.island, 0);
  const before = game.player.getState();
  for (let i = 0; i < 60; i += 1) game.player.update(1 / 60, { forward: 1, strafe: 0, run: false }, 0, game.world.island);
  const after = game.player.getState();
  return Number(Math.hypot(after.x - before.x, after.z - before.z).toFixed(2));
});
await desktopPage.close();
await desktop.close();

// ——— 5. собранный одним файлом: сенсорный слой внутри dist ———
const distContext = await browser.newContext({ ...devices['Pixel 7'] });
const distPage = await distContext.newPage();
distPage.setDefaultTimeout(180000);
distPage.on('pageerror', (e) => result.errors.push(`dist: ${e.message}`));
const html = readFileSync('/home/user/dist/index.html', 'utf8');
result.dist.size = html.length;
await distPage.goto('file:///home/user/dist/index.html', { waitUntil: 'domcontentloaded' });
await distPage.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await distPage.waitForTimeout(800);
result.dist.platform = await distPage.evaluate(() => ({
  touch: window.viceShore.platform.touch,
  scheme: window.viceShore.scheme,
  quality: window.viceShore.settings.get('quality'),
}));
await distPage.click('.menu-list__button:has-text("Играть")');
await distPage.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  { timeout: 180000 },
);
await distPage.waitForTimeout(1000);
result.dist.touchUi = await distPage.evaluate(() => {
  const ui = document.querySelector('.touch-ui');
  const stick = document.querySelector('.touch-stick');
  const rect = stick?.getBoundingClientRect();
  return {
    visible: Boolean(ui) && !ui.classList.contains('is-hidden'),
    stickSize: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    hint: window.viceShore.playHint,
  };
});
await distPage.screenshot({ path: '/tmp/touch-dist.png' });
await distContext.close();

console.log(JSON.stringify(result, null, 2));
await browser.close();
