// Замер габаритов домов посёлка: node tools/measure-town.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.setDefaultTimeout(300000);
await page.goto((process.env.VS_URL ?? 'http://localhost:5173') + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 300000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const island = window.viceShore.world.island;
  const out = { ground: { center: island.groundHeightAt(0, 0), town: island.groundHeightAt(60, 30) }, houses: {} };
  island.town.group.children.forEach((child) => {
    if (!child.name.startsWith('house-')) return;
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    child.updateMatrixWorld(true);
    child.traverse((o) => {
      if (!o.isMesh || !o.geometry.boundingBox) { if (o.isMesh) o.geometry.computeBoundingBox(); }
      if (!o.isMesh) return;
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      min = [Math.min(min[0], b.min.x), Math.min(min[1], b.min.y), Math.min(min[2], b.min.z)];
      max = [Math.max(max[0], b.max.x), Math.max(max[1], b.max.y), Math.max(max[2], b.max.z)];
    });
    out.houses[child.name] = {
      y: [+min[1].toFixed(2), +max[1].toFixed(2)],
      x: [+min[0].toFixed(1), +max[0].toFixed(1)],
      z: [+min[2].toFixed(1), +max[2].toFixed(1)],
    };
  });
  return out;
}), null, 1));
await browser.close();
