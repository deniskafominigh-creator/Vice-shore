// Быстрый снимок сцены для калибровки аудита: имена, AABB, прозрачность.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const URL = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.setDefaultTimeout(180000);
await page.goto(URL + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
const data = await page.evaluate(() => {
  const g = window.viceShore;
  const THREE = window.viceShoreThree;
  const root = g.world.scene;
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const box = new THREE.Box3().setFromObject(o);
    const path = [];
    let p = o;
    while (p && p !== root) { if (p.name) path.unshift(p.name); p = p.parent; }
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    meshes.push({
      name: o.name || '(без имени)',
      path: path.join('/'),
      material: mat?.name || mat?.type,
      transparent: !!mat?.transparent,
      doubleSide: mat?.side === THREE.DoubleSide,
      instanced: !!o.isInstancedMesh,
      count: o.isInstancedMesh ? o.count : 1,
      tris: Math.round(((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1)),
      min: box.min.toArray(), max: box.max.toArray(),
    });
  });
  return { total: meshes.length, meshes, colliders: g.world.island.collisions.count, islandTris: g.world.island.countTriangles() };
});
writeFileSync('/tmp/audit-probe.json', JSON.stringify(data, null, 1));
console.log('meshes', data.total, 'colliders', data.colliders, 'island tris', data.islandTris);
const byPath = {};
for (const m of data.meshes) { const k = m.path.split('/')[0]; byPath[k] = (byPath[k] ?? 0) + 1; }
console.log(JSON.stringify(byPath));
await browser.close();
