// Проверка задачи 3: музыка следует за состоянием, ducking, stingers, ползунки.
import { chromium } from 'playwright';

/** Адрес игры: по умолчанию dev-сервер Vite. */
const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

const snapshot = () => page.evaluate(() => ({
  state: window.viceShore?.machine?.current,
  mood: window.viceShore?.audio?.musicMood ?? null,
  audioReady: window.viceShore?.audio?.isReady ?? false,
  engine: Boolean(window.viceShore?.audio?.musicEngine),
  playing: window.viceShore?.audio?.musicEngine?.isPlaying ?? false,
  ducked: window.viceShore?.audio?.musicEngine?.ducked ?? null,
}));

/** Клик по кнопке с текстом через DOM: обычный page.click конфликтует с pointer lock. */
const domClick = (page, text) =>
  page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.includes(label));
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, text);

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 60000 });
await page.waitForTimeout(800);
const beforeClick = await snapshot();

await domClick(page, 'Играть');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy, null, { timeout: 90000 });
await page.waitForTimeout(2500);
const playing = await snapshot();

// миссия: событие старта квеста должно переключить музыку
await page.evaluate(() => window.viceShore.bus.emit('quest:started', { id: 'mission_01', title: 'Покрась стену' }));
await page.waitForTimeout(1200);
const mission = await snapshot();
await page.evaluate(() => window.viceShore.bus.emit('quest:completed', { id: 'mission_01', title: 'Покрась стену' }));
await page.waitForTimeout(1200);
const afterQuest = await snapshot();

// голос приглушает музыку
await page.evaluate(() => window.viceShore.bus.emit('voice:started', { id: 'line-1' }));
await page.waitForTimeout(600);
const duckedVoice = await snapshot();
await page.evaluate(() => window.viceShore.bus.emit('voice:ended', { id: 'line-1' }));
await page.waitForTimeout(600);
const unducked = await snapshot();

// пауза: музыка на месте, но приглушена
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'paused' && !window.viceShore?.machine?.isBusy, null, { timeout: 30000 });
await page.waitForTimeout(700);
const paused = await snapshot();

// настройки: ползунки громкости, включая музыку и голос
await domClick(page, 'Настройки');
await page.waitForTimeout(700);
await page.screenshot({ path: 'shots/audio-01-settings.png' });
const sliders = await page.evaluate(() => [...document.querySelectorAll('.settings-row, .setting-row, [class*="row"]')].map(r => r.textContent?.trim().slice(0, 24)).filter(Boolean).slice(0, 12));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// возврат в меню
await domClick(page, 'В главное меню');
await page.waitForFunction(() => window.viceShore?.machine?.current === 'menu' && !window.viceShore?.machine?.isBusy, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const menu = await snapshot();

// Реальный уровень сигнала на шине музыки: доказывает, что звук не «пустой».
const level = await page.evaluate(async () => {
  const ctx = window.viceShore.audio.context;
  const music = window.viceShore.audio.music;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  music.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  let peak = 0;
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    analyser.getFloatTimeDomainData(buffer);
    for (const value of buffer) { sum += value * value; samples += 1; peak = Math.max(peak, Math.abs(value)); }
  }
  music.disconnect(analyser);
  return { rms: Math.sqrt(sum / samples), peak };
});

// Стресс: 30 смен настроения подряд — движок не должен запускать второй планировщик
const stress = await page.evaluate(async () => {
  const engine = window.viceShore.audio.musicEngine;
  const moods = ['menu', 'explore', 'mission'];
  for (let i = 0; i < 30; i += 1) {
    window.viceShore.bus.emit(i % 2 === 0 ? 'quest:started' : 'quest:completed', { id: 'mission_01', title: 'stress' });
    if (i % 7 === 0) engine.setMood(moods[i % 3], 0.4);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
  return {
    playing: engine.isPlaying,
    timers: engine.timer === null ? 0 : 1,
    mood: engine.mood,
    outputGain: engine.output?.gain?.value ?? null,
  };
});

console.log(JSON.stringify({ beforeClick, playing, mission, afterQuest, duckedVoice, unducked, paused, menu, level, stress, errors }, null, 2));
await browser.close();
