// Проверка задачи 10: привезённая модель героя встала в игру.
import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'], ignoreDefaultArgs: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const t0 = Date.now(); const step = (s) => console.log(`[${((Date.now()-t0)/1000).toFixed(0)}s] ${s}`);
step('goto');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 120000 });
step('menu');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Играть'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 180000 });
step('playing');
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const g = window.viceShore;
  const c = g.character;
  const THREE = window.viceShoreThree;
  const box = new THREE.Box3().setFromObject(c.group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const hand = c.rig.bones.get('hand_r');
  const handPos = new THREE.Vector3(); hand?.getWorldPosition(handPos);
  const fingerBones = [...c.rig.bones.keys()].filter((n) => /_(l|r)_0[123]$/.test(n));
  const clips = [];
  c.group.traverse((o) => {});
  return {
    cls: c.constructor.name,
    bones: c.boneCount,
    triangles: c.triangleCount,
    height: Number(size.y.toFixed(3)),
    width: Number(size.x.toFixed(3)),
    depth: Number(size.z.toFixed(3)),
    boxMinY: Number(box.min.y.toFixed(3)),
    center: [center.x, center.y, center.z].map((v) => Number(v.toFixed(2))),
    fingers: fingerBones.length,
    handWorld: [handPos.x, handPos.y, handPos.z].map((v) => Number(v.toFixed(2))),
    player: [g.player.position.x, g.player.position.y, g.player.position.z].map((v) => Number(v.toFixed(2))),
    yaw: Number((g.player.yaw ?? 0).toFixed(2)),
    clips: c.mixer ? [...c.actions.keys()] : null,
  };
});
console.log(JSON.stringify(info, null, 1));
step('shot');
try { await page.screenshot({ path: 'shots/t10-hero-idle.png', timeout: 150000 }); step('shot ok'); } catch (e) { step('shot fail ' + e.message.slice(0, 50)); }
console.log('errors', JSON.stringify(errors.filter((t) => !t.includes('favicon'))));
await browser.close();
