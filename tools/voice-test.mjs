// Проверка задачи 9: реплики героя — события, одна дорожка, приоритеты, cooldown,
// duck музыки, субтитры (в т.ч. фолбэк без файла), пауза, реальный уровень на шине голоса.
//
// Под SwiftShader кадр рисуется секундами, поэтому все проверки порядка реплик
// выполняются ОДНИМ вызовом evaluate (синхронно, без гонок с реальным временем),
// а кадры снимаются только по запросу: SHOT=1 node tools/voice-test.mjs
import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  ignoreDefaultArgs: ['--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 620 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

const t0 = Date.now();
const step = (name) => console.log(`[step] ${name} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
const results = {};
const fail = [];

const domClick = (label) =>
  page.evaluate((text) => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes(text));
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, label);

const voice = () =>
  page.evaluate(() => {
    const game = window.viceShore;
    const dialogues = game?.dialogues;
    return {
      exists: Boolean(dialogues),
      line: dialogues?.currentLineId ?? null,
      speaking: dialogues?.isSpeaking ?? false,
      subtitle: dialogues?.subtitleText ?? null,
      subtitleDom: document.querySelector('.subtitle')?.classList.contains('is-visible') ?? false,
      subtitleDomText: document.querySelector('.subtitle')?.textContent ?? '',
      ducked: game?.audio?.musicEngine?.ducked ?? null,
      totalLines: dialogues?.totalLines ?? 0,
      voicedLines: dialogues?.voicedLines ?? 0,
      missing: dialogues?.missingVoice ?? [],
      audioReady: game?.audio?.isReady ?? false,
      state: game?.machine?.current ?? null,
    };
  });

step('goto');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 90000 });
step('menu');
await domClick('Играть');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 120000 });
// Звук разблокируется только доверенным событием (headless: нажатие клавиши)
await page.keyboard.press('ShiftLeft');
await page.waitForTimeout(1000);

// 1. Файлы декодированы
await page.evaluate(() => window.viceShore.dialogues.preload());
await page.waitForFunction(() => window.viceShore.dialogues.voicedLines > 0, null, { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(500);
step('loaded');
const loaded = await voice();
results.files = { total: loaded.totalLines, voiced: loaded.voicedLines, missing: loaded.missing, audioReady: loaded.audioReady };
if (loaded.totalLines !== 18) fail.push(`реплик ${loaded.totalLines}, ожидалось 18`);
if (loaded.voicedLines !== loaded.totalLines) fail.push(`со звуком ${loaded.voicedLines} из ${loaded.totalLines} реплик`);

// 2-6. Порядок реплик — одним синхронным проходом.
step('sequence');
const seq = await page.evaluate(() => {
  const game = window.viceShore;
  const d = game.dialogues;
  const ducked = () => game.audio.musicEngine?.ducked ?? null;
  const out = {};
  d.stop();

  // реплика по событию покраски (quest:started mission_01 игра уже израсходовала сама)
  game.bus.emit('paint:completed', { id: 'mission_01' });
  out.event = { line: d.currentLineId, subtitle: d.subtitleText, ducked: ducked() };

  // одна дорожка: вторая реплика не подменяет первую (в очереди ждёт максимум 2)
  out.third = d.play('take_roller');
  out.afterThird = d.currentLineId;

  // приоритет: важная реплика перебивает текущую
  out.interrupt = d.play('win');
  out.afterInterrupt = d.currentLineId;

  // cooldown: та же реплика подряд не звучит
  out.repeat = d.play('win');

  // конец реплики снимает duck
  d.stop();
  out.afterStop = { line: d.currentLineId, ducked: ducked() };

  // все 18 реплик со звуком — проверяем, что звуковых «дыр» не осталось
  out.missing = d.missingVoice;
  out.voiced = d.voicedLines;
  out.total = d.totalLines;

  return out;
});
results.sequence = seq;
if (seq.event.line !== 'wall_done') fail.push(`по paint:completed звучит «${seq.event.line}»`);
if (!seq.event.subtitle) fail.push('нет субтитра под реплику');
if (seq.event.ducked !== true) fail.push('музыка не приглушена под реплику');
if (seq.third) fail.push('вторая реплика запустилась поверх первой');
if (seq.afterThird !== 'wall_done') fail.push('дорожка подменилась');
if (!seq.interrupt || seq.afterInterrupt !== 'win') fail.push(`приоритет не сработал: «${seq.afterInterrupt}»`);
if (seq.repeat) fail.push('cooldown не сработал — реплика повторилась');
if (seq.afterStop.line || seq.afterStop.ducked) fail.push('стоп не снял реплику/duck');
if (seq.missing.length > 0) fail.push(`без звука остались: ${seq.missing.join(', ')}`);
if (seq.voiced !== seq.total) fail.push(`со звуком ${seq.voiced} из ${seq.total}`);

// 7. Субтитры выключены → звук есть, текста нет
step('subtitlesOff');
const noSubs = await page.evaluate(() => {
  const game = window.viceShore;
  const d = game.dialogues;
  d.stop();
  game.settings.set('subtitles', false);
  d.play('goal');
  const shot = { line: d.currentLineId, subtitle: d.subtitleText, dom: document.querySelector('.subtitle')?.classList.contains('is-visible') ?? false };
  d.stop();
  game.settings.set('subtitles', true);
  return shot;
});
results.subtitlesOff = noSubs;
if (noSubs.subtitle || noSubs.dom) fail.push('субтитр виден при выключенных субтитрах');
if (noSubs.line !== 'goal') fail.push('реплика не звучит при выключенных субтитрах');

// 8. Реальный сигнал на шине голоса (не пустой звук).
// Главный поток занят рендером, поэтому на время замера останавливаем игровой цикл —
// иначе таймеры в странице растягиваются в разы и замер промахивается мимо реплики.
step('level');
const level = await page.evaluate(async () => {
  const game = window.viceShore;
  const loop = game.loop;
  loop?.stop?.();
  const ctx = game.audio.ctx;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 16384;
  game.audio.voiceOutput.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  game.dialogues.stop();
  const started = game.dialogues.play('to_court');
  let peak = 0;
  for (let i = 0; i < 70; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    analyser.getFloatTimeDomainData(buffer);
    for (const value of buffer) peak = Math.max(peak, Math.abs(value));
  }
  game.dialogues.stop();
  loop?.start?.();
  return { started, peak: Number(peak.toFixed(4)), voiced: game.dialogues.voicedLines };
});
results.level = level;
step(`level peak=${level.peak}`);
if (!level.started) fail.push('реплика для замера не запустилась');
if (!(level.peak > 0.01)) fail.push(`голос тишиной: peak ${level.peak}`);

// 9. Кадр с субтитром — пока игра на ходу (SwiftShader медленный, поэтому по запросу)
step('shots');
results.shots = {};
if (process.env.SHOT === '1') {
  const shotLine = await page.evaluate(() => {
    const game = window.viceShore;
    game.settings.set('subtitles', true);
    // берём первую реплику, которая не на cooldown
    for (const id of ['goal_second', 'take_ball', 'miss', 'to_court', 'wall_done', 'win']) {
      game.dialogues.stop();
      if (game.dialogues.play(id)) return id;
    }
    return null;
  });
  results.shots.line = shotLine;
  await page.waitForTimeout(400);
  try {
    await page.screenshot({ path: 'shots/t9-subtitle.png', timeout: 150000 });
    results.shots.subtitle = true;
  } catch (error) {
    results.shots.subtitle = `fail: ${error.message.slice(0, 60)}`;
  }
  results.shots.subtitleText = (await voice()).subtitleDomText;
} else {
  results.shots.skipped = true;
}

// 10. Пауза глушит реплику (музыку на паузе игра приглушает сама — это не duck реплики)
step('pause');
await page.evaluate(() => {
  window.viceShore.dialogues.stop();
  window.viceShore.dialogues.play('take_ball');
});
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'paused' && !window.viceShore?.machine?.isBusy, null, { timeout: 60000 });
await page.waitForTimeout(400);
const paused = await voice();
results.pause = { line: paused.line, subtitleDom: paused.subtitleDom, state: paused.state };
if (paused.line) fail.push('реплика не остановилась на паузе');
if (paused.subtitleDom) fail.push('субтитр остался на паузе');

results.errors = errors.filter((text) => !text.includes('favicon'));
console.log(JSON.stringify({ results, fail, errors: results.errors }, null, 1));
await browser.close();
process.exit(fail.length === 0 && results.errors.length === 0 ? 0 : 1);
