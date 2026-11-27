// Проверочный визуальный прогон задачи 1: загрузка → меню → игра → пауза → настройки.
// Запуск: node tools/shot.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/01-loading.png` });

await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/02-menu.png` });

// Фокус/клавиатура: вниз-вниз-вверх возвращает на первый пункт
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/03-menu-keyboard-focus.png` });

// Настройки из меню
await page.click('.menu-list__button:has-text("Настройки")');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04-settings.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Управление
await page.click('.menu-list__button:has-text("Управление")');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/05-controls.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Играть
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/06-playing.png` });

// Пройти вперёд немного
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
await page.keyboard.up('KeyW');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/07-playing-moved.png` });

// Пауза
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/08-pause.png` });

const state = await page.evaluate(() => {
  const game = window.viceShore;
  return {
    state: game?.machine?.current ?? null,
    hasWorld: Boolean(game?.world),
    saved: Boolean(game?.save?.hasSave),
    fps: null,
  };
});

// Возврат в меню
await page.click('.panel button:has-text("В главное меню")');
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/09-menu-after-return.png` });

const afterReturn = await page.evaluate(() => ({
  state: window.viceShore?.machine?.current ?? null,
  continueEnabled: !document.querySelectorAll('.menu-list__button')[1]?.hasAttribute('disabled'),
}));

console.log(JSON.stringify({ state, afterReturn, logs }, null, 2));
await browser.close();
