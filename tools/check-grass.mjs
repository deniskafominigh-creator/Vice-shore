import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.setDefaultTimeout(300000);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 300000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const grass = window.viceShore.world.island.grass.group.children[0];
  const col = grass.instanceColor;
  return {
    count: grass.count,
    hasInstanceColor: !!col,
    first: col ? Array.from(col.array.slice(0, 3)).map((v) => +v.toFixed(3)) : null,
    materialColor: grass.material.color.getHexString(),
    defines: grass.material.defines ?? null,
  };
}), null, 1));
await browser.close();
