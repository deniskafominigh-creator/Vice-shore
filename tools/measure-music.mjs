import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
try {
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 60000 });
  await page.click('.menu-list__button:has-text("Играть")');
  await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 60000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(async () => {
    const ctx = window.viceShore.audio.context;
    const music = window.viceShore.audio.music;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    music.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    const sample = async (ms) => {
      const started = performance.now();
      let peak = 0, sum = 0, n = 0;
      while (performance.now() - started < ms) {
        await new Promise((r) => setTimeout(r, 40));
        analyser.getFloatTimeDomainData(buffer);
        for (const v of buffer) { sum += v * v; n += 1; peak = Math.max(peak, Math.abs(v)); }
      }
      return { rms: Math.sqrt(sum / Math.max(1, n)), peak };
    };
    const explore = await sample(2500);
    window.viceShore.bus.emit('quest:started', { id: 'm1', title: 't' });
    await new Promise((r) => setTimeout(r, 4000));
    const mission = await sample(2500);
    music.disconnect(analyser);
    return {
      explore: { rms: +explore.rms.toFixed(4), peak: +explore.peak.toFixed(4), db: +(20 * Math.log10(explore.peak || 1e-6)).toFixed(1) },
      mission: { rms: +mission.rms.toFixed(4), peak: +mission.peak.toFixed(4), db: +(20 * Math.log10(mission.peak || 1e-6)).toFixed(1) },
      mood: window.viceShore.audio.musicMood,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
