import { chromium } from 'playwright';
const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.waitForTimeout(700);
const info = await page.evaluate(() => ({
  merge: window.viceShore.world.island.mergeStats,
  tris: window.viceShore.world.island.countTriangles(),
  drawCalls: window.viceShore.frameStats().drawCalls,
}));
const shots = [
  { name: '/tmp/m-room-a.png', from: [3.6, 4.4, -7.2], to: [-1.4, 3.4, -12.4] },
  { name: '/tmp/m-room-b.png', from: [-6.0, 4.6, -6.6], to: [3.0, 3.6, -13.0] },
  { name: '/tmp/m-hall-c.png', from: [0.0, 5.0, 6.0], to: [0.0, 3.4, -8.0] },
  { name: '/tmp/m-court.png', from: [-26.4, 6.4, 11.0], to: [-22.5, 4.2, 4.0] },
];
for (const shot of shots) {
  await page.evaluate((s) => window.viceShore.setAuditCamera(s.from, s.to), shot);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot.name });
}
console.log(JSON.stringify(info));
console.log('errors', JSON.stringify(errors));
await browser.close();
