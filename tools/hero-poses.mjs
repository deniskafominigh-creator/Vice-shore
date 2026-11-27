// Позы героя задачи 10: покраска (валик в правой руке) и мяч в руках.
import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'], ignoreDefaultArgs: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const t0 = Date.now(); const step = (s) => console.log(`[${((Date.now()-t0)/1000).toFixed(0)}s] ${s}`);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 120000 });
step('menu');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Играть'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 180000 });
step('playing');
await page.waitForTimeout(800);

const shoot = async (name) => { try { await page.screenshot({ path: `shots/${name}.png`, timeout: 150000 }); step(`${name} ok`); } catch (e) { step(`${name} fail`); } };

// покраска: поднимаем валик ближе к верху стены
const paintInfo = await page.evaluate(() => {
  const g = window.viceShore;
  const THREE = window.viceShoreThree;
  g.character.setPainting(true, 0.62);
  g.thirdPersonCamera.setYaw(g.player.yaw);
  const hand = g.character.rig.bones.get('hand_r');
  const p = new THREE.Vector3(); hand.getWorldPosition(p);
  return { hand: [p.x, p.y, p.z].map((v) => Number(v.toFixed(2))) };
});
console.log('paint hand', JSON.stringify(paintInfo));
await page.waitForTimeout(600);
await shoot('t10-pose-paint');

// мяч в руках
const holdInfo = await page.evaluate(() => {
  const g = window.viceShore;
  const THREE = window.viceShoreThree;
  g.character.setPainting(false);
  g.character.setBall('hold', 0);
  const r = new THREE.Vector3(); g.character.rig.bones.get('hand_r').getWorldPosition(r);
  const l = new THREE.Vector3(); g.character.rig.bones.get('hand_l').getWorldPosition(l);
  return { right: [r.x, r.y, r.z].map((v) => Number(v.toFixed(2))), left: [l.x, l.y, l.z].map((v) => Number(v.toFixed(2))) };
});
console.log('hold hands', JSON.stringify(holdInfo));
await page.waitForTimeout(600);
await shoot('t10-pose-hold');
console.log('errors', JSON.stringify(errors.filter((t) => !t.includes('favicon'))));
await browser.close();
