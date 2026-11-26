/** Проверка реплик героя (задача 17): 3 фразы «просто стою», 3 фразы «забил гол»,
 *  у каждой фразы есть место, а «краска сохнет» и «кольцо белое» не звучат на стадионе. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import dialogues from '../../src/data/dialogues.json';

interface Line {
  readonly id: string;
  readonly text: string;
  readonly trigger: string;
  readonly priority: number;
  readonly cooldown: number;
  readonly file: string;
  readonly place?: string;
}

const lines = dialogues.lines as readonly Line[];
const PLACES = new Set(['any', 'villa', 'court', 'stadium']);
/** Фразы, которые привязаны к дому и двору: на стадионе их слышать не должны. */
const HOME_WORDS = ['краск', 'валик', 'стен', 'кольц', 'двор'];
/** Изначальный набор задачи 9 — всё, что не отсюда, добавлено в задаче 17. */
const OLD_IDS = new Set([
  'start_mission1', 'take_roller', 'take_paint', 'paint_start', 'paint_dry', 'paint_half',
  'wall_done', 'to_court', 'take_ball', 'throw', 'goal', 'miss', 'goal_second', 'win',
]);

let problems = 0;
const fail = (message: string): void => {
  problems += 1;
  console.log(`✗ ${message}`);
};

// ——— идентификаторы и текст ———
const ids = new Set<string>();
for (const line of lines) {
  if (ids.has(line.id)) fail(`повтор id «${line.id}»`);
  ids.add(line.id);
  if (line.text.trim().length < 4) fail(`«${line.id}»: пустой текст`);
  if (PLACES.has(line.place ?? '') === false) fail(`«${line.id}»: неизвестное место «${line.place}»`);
  if (!Number.isFinite(line.priority) || line.priority < 0 || line.priority > 100) {
    fail(`«${line.id}»: подозрительный приоритет ${line.priority}`);
  }
  if (!Number.isFinite(line.cooldown) || line.cooldown < 6) fail(`«${line.id}»: cooldown меньше 6 с`);
  if (/[A-Za-z]{4,}/.test(line.text)) fail(`«${line.id}»: латиница в русской фразе — «${line.text}»`);
}

// ——— 3 фразы «просто стою» ———
const idle = lines.filter((line) => line.trigger === 'idle');
console.log(`idle-фраз: ${idle.length}`);
if (idle.length !== 3) fail(`idle-фраз должно быть 3 — сейчас ${idle.length}`);
for (const line of idle) {
  if ((line.place ?? 'any') !== 'any') fail(`idle «${line.id}» привязан к месту «${line.place}»: стоять можно где угодно`);
  // Универсальная фраза не должна упоминать дом, краску или кольцо
  const hit = HOME_WORDS.find((word) => line.text.toLowerCase().includes(word));
  if (hit) fail(`idle «${line.id}» говорит про «${hit}» — это не универсальная фраза`);
  console.log(`  ✓ ${line.id}: ${line.text}`);
}

// ——— 3 фразы «забил гол» ———
const goals = lines.filter((line) => line.trigger === 'football:goal');
console.log(`фраз на гол: ${goals.length}`);
if (goals.length !== 3) fail(`фраз на гол должно быть 3 — сейчас ${goals.length}`);
for (const line of goals) {
  if ((line.place ?? 'any') !== 'stadium') fail(`«${line.id}»: гол на стадионе, а место «${line.place}»`);
  console.log(`  ✓ ${line.id}: ${line.text}`);
}

// ——— привязка к месту: домашние фразы не звучат на стадионе ———
for (const line of lines) {
  const place = line.place ?? 'any';
  const hit = HOME_WORDS.find((word) => line.text.toLowerCase().includes(word));
  if (hit && place === 'any' && line.trigger === 'idle') fail(`«${line.id}»: домашняя тема «${hit}» в универсальной фразе`);
  if (hit && place === 'stadium') fail(`«${line.id}»: на стадионе фраза про «${hit}»`);
}
const stadiumLines = lines.filter((line) => (line.place ?? 'any') === 'stadium');
if (stadiumLines.length < 5) fail(`стадионных фраз мало: ${stadiumLines.length}`);

// ——— новые фразы ———
const fresh = lines.filter((line) => !OLD_IDS.has(line.id));
console.log(`новых фраз: ${fresh.length}`);
if (fresh.length !== 10) fail(`новых фраз должно быть 10 — сейчас ${fresh.length}`);

// ——— озвучка: файл на месте и это настоящий mp3 с внятной длительностью ———
// Путь от корня проекта: офлайн-раннер собирает ts во временный файл, import.meta.url врёт.
const VOICE_DIR = join(process.cwd(), 'src/assets/voice');
const BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BR_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SR = [44100, 48000, 32000];

/** Длительность по кадрам: без декодера, но структуру и тишину по нулевым кадрам ловит. */
const mp3Duration = (data: Buffer): number | null => {
  let offset = 0;
  if (data.slice(0, 3).toString('latin1') === 'ID3') {
    const size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);
    offset = 10 + size;
  }
  let seconds = 0;
  let frames = 0;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const version = (data[offset + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (data[offset + 1] >> 1) & 3; // 1 = Layer III
    if (layer !== 1 || version === 1) {
      offset += 1;
      continue;
    }
    const table = version === 3 ? BR_V1_L3 : BR_V2_L3;
    const bitrate = table[(data[offset + 2] >> 4) & 0xf] * 1000;
    const sampleRate = SR[(data[offset + 2] >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const padding = (data[offset + 2] >> 1) & 1;
    if (!bitrate || !sampleRate) {
      offset += 1;
      continue;
    }
    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
    if (length < 24) {
      offset += 1;
      continue;
    }
    seconds += samples / sampleRate;
    frames += 1;
    offset += length;
  }
  return frames > 2 ? seconds : null;
};

const voiced = lines.filter((line) => line.file.trim().length > 0);
let totalSeconds = 0;
for (const line of voiced) {
  const path = join(VOICE_DIR, line.file);
  if (!existsSync(path)) {
    fail(`«${line.id}»: нет файла ${line.file}`);
    continue;
  }
  const seconds = mp3Duration(readFileSync(path));
  if (seconds === null) {
    fail(`«${line.id}»: ${line.file} — не читается как mp3`);
    continue;
  }
  totalSeconds += seconds;
  if (seconds < 0.6) fail(`«${line.id}»: слишком коротко — ${seconds.toFixed(2)} с`);
  if (seconds > 8) fail(`«${line.id}»: слишком долго — ${seconds.toFixed(2)} с`);
}
const used = new Set(lines.map((line) => line.file).filter((file) => file.length > 0));
const orphans = readdirSync(VOICE_DIR).filter((file) => file.endsWith('.mp3') && !used.has(file));
if (orphans.length > 0) fail(`лишние mp3 без фраз: ${orphans.join(', ')}`);
console.log(
  `всего фраз: ${lines.length}, со звуком: ${voiced.length} (${totalSeconds.toFixed(1)} с), ` +
    `без звука (субтитры): ${lines.length - voiced.length}`,
);

// ——— триггеры уникальны там, где должен быть один вариант ———
for (const line of lines) {
  if (line.trigger === 'idle' || line.trigger === 'football:goal') continue;
  const same = lines.filter((other) => other.trigger === line.trigger);
  if (same.length > 1) fail(`триггер «${line.trigger}» описан ${same.length} раза — для одиночных реплик нужен один`);
}

console.log(problems === 0 ? 'Реплики: набор согласован' : `Реплики: проблем ${problems}`);
export const failed = problems > 0;
