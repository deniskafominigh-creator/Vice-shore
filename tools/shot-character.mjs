// Проверка задачи 2: персонаж в игре + осмотр (F3): ракурсы, позы, каркас, крупный план лица.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const setAngle = (a) => page.evaluate((angle) => window.viceShore.setInspectorAngle(angle), a);
const setPose = (key) => page.keyboard.press(key);

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 60000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 60000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/char-01-in-game.png' });

const info = await page.evaluate(() => ({ bones: window.viceShore.character.boneCount, tris: Math.round(window.viceShore.character.triangleCount) }));

await page.keyboard.press('F3');
await page.waitForTimeout(2200);

// ракурсы: спереди / сбоку / сзади
await setAngle(0); await page.waitForTimeout(1400);
await page.screenshot({ path: 'shots/char-02-front.png' });
await setAngle(Math.PI / 2); await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/char-03-side.png' });
await setAngle(Math.PI); await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/char-04-back.png' });

// крупный план лица
await setAngle(0.15);
await page.evaluate(() => window.viceShore.zoomInspector(-1.9));
await page.waitForTimeout(1600);
await page.screenshot({ path: 'shots/char-05-face.png' });
await page.evaluate(() => window.viceShore.zoomInspector(1.9));
await page.waitForTimeout(1200);

// позы
await setAngle(0.35);
await setPose('Digit2'); await page.waitForTimeout(1800);
await page.screenshot({ path: 'shots/char-06-arms-up.png' });
await setPose('Digit3'); await page.waitForTimeout(1800);
await page.screenshot({ path: 'shots/char-07-squat.png' });
await setPose('Digit4'); await page.waitForTimeout(1600);
await page.screenshot({ path: 'shots/char-08-head-turn.png' });
await setPose('Digit1'); await page.waitForTimeout(1200);

// каркас
await page.keyboard.press('F5');
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/char-09-wIREFRAME.png' });
await page.keyboard.press('F5');
await page.keyboard.press('F3');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/char-10-back-to-game.png' });

console.log(JSON.stringify({ info, errors }, null, 2));
await browser.close();
