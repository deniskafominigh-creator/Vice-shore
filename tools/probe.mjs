import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 120000 });
await page.click('.menu-list__button:has-text("Играть")');
await page.waitForTimeout(5000);
console.log(JSON.stringify(await page.evaluate(() => {
  const g = window.viceShore;
  const c = g.activeCamera;
  const ch = g.character.group.position;
  return {
    cam: [c.position.x.toFixed(2), c.position.y.toFixed(2), c.position.z.toFixed(2)],
    rot: [c.rotation.x.toFixed(3), c.rotation.y.toFixed(3)],
    char: [ch.x.toFixed(2), ch.y.toFixed(2), ch.z.toFixed(2)],
    fov: c.fov, same: c === g.freeCamera.camera,
    state: g.machine.current,
    saved: JSON.stringify(g.freeCamera.getState()),
  };
}), null, 2));
await browser.close();
