// Один кадр по координатам: node tools/shot-view.mjs out.png fx fy fz tx ty tz
import { chromium } from 'playwright';
const [out, fx, fy, fz, tx, ty, tz] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.setDefaultTimeout(300000);
await page.goto((process.env.VS_URL ?? 'http://localhost:5173') + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 300000 });
await page.evaluate(([f, t]) => window.viceShore.setAuditCamera(f, t), [[+fx, +fy, +fz], [+tx, +ty, +tz]]);
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();
