/** Проверка графики (задача 19): бюджет пост-обработки по пресетам, дымка,
 *  палитра одежды. Всё это чистые константы и правила — проверяется без GPU. */
import { FOG, PALETTE, QUALITY_ORDER, QUALITY_PRESETS } from '../../src/core/Config';
import {
  HERO_OUTFIT,
  nearestClassId,
  OUTFIT_CLASSES,
  SELLER_OUTFIT,
} from '../../src/entities/character/Outfit';

let problems = 0;
const fail = (message: string): void => {
  problems += 1;
  console.log(`✗ ${message}`);
};

// ——— 1. пресеты качества: дешёвое остаётся дешёвым ———
console.log('пресеты качества (пост-обработка):');
for (const level of QUALITY_ORDER) {
  const preset = QUALITY_PRESETS[level];
  const passes = [preset.ssao && 'SSAO', preset.bloom && 'Bloom', preset.smaa && 'SMAA'].filter(Boolean);
  console.log(
    `  ${level.padEnd(6)} тени ${String(preset.shadowMapSize).padStart(4)} · ` +
      `pixelRatio ${preset.pixelRatio} · ${passes.length > 0 ? passes.join(' + ') : 'прямой рендер (без проходов)'}`,
  );
  if (preset.shadowMapSize < 1024) fail(`${level}: карта теней ${preset.shadowMapSize} — тени будут рваными`);
  if (preset.shadowMapSize > 4096) fail(`${level}: карта теней ${preset.shadowMapSize} — больше 4096 не нужно`);
}

const low = QUALITY_PRESETS.low;
if (low.bloom || low.ssao || low.smaa) fail('низкое качество не должно включать пост-обработку: это мобильный FPS');
if (!QUALITY_PRESETS.medium.bloom && !QUALITY_PRESETS.high.bloom) fail('bloom не включён нигде');
if (!QUALITY_PRESETS.high.ssao) fail('на высоком качестве нет SSAO');
if (!QUALITY_PRESETS.high.smaa) fail('на высоком качестве нет SMAA');
if (QUALITY_PRESETS.high.ssaoScale > 0.6) fail('SSAO считается почти в полный размер — дорого');
if (QUALITY_PRESETS.low.bloomStrength !== 0) fail('у низкого качества сила bloom должна быть 0');
if (QUALITY_PRESETS.high.bloomStrength <= 0 || QUALITY_PRESETS.high.bloomStrength > 0.6) {
  fail(`сила bloom ${QUALITY_PRESETS.high.bloomStrength} — свечение либо не видно, либо «мыло»`);
}

// ——— 2. дымка ———
const density = FOG.density;
if (!(density > 0.001 && density < 0.01)) fail(`плотность дымки ${density} вне разумного диапазона`);
/** Доля дымки по закону FogExp2. */
const haze = (distance: number): number => 1 - Math.exp(-((distance * density) ** 2));
console.log(
  `дымка: 50 м ${(haze(50) * 100).toFixed(1)} % · 120 м ${(haze(120) * 100).toFixed(1)} % · ` +
    `300 м ${(haze(300) * 100).toFixed(1)} % · 600 м ${(haze(600) * 100).toFixed(1)} %`,
);
if (haze(50) > 0.1) fail('на 50 м уже слишком много дымки: вилла утонет');
if (haze(300) < 0.35) fail('на 300 м дымки мало: дальние дома не растворяются');
if (haze(600) < 0.85) fail('на 600 м горизонт не сходится с небом');
if (FOG.exposure < 1.1 || FOG.exposure > 1.35) fail(`экспозиция ${FOG.exposure} — вне «кинематографичного» коридора`);
if (PALETTE.skyHorizon === undefined) fail('нет цвета горизонта для дымки');

// ——— 3. палитра одежды ———
if (HERO_OUTFIT.length !== OUTFIT_CLASSES.length) fail('палитра героя не совпадает по длине с классами');
if (SELLER_OUTFIT.length !== OUTFIT_CLASSES.length) fail('палитра кассира не совпадает по длине с классами');
if (HERO_OUTFIT.join() === SELLER_OUTFIT.join()) fail('герой и кассир в одинаковой одежде — их не различить');

// Кожа и волосы обязаны остаться собой, иначе получится маска, а не человек.
OUTFIT_CLASSES.forEach((item, index) => {
  if (nearestClassId(item.source) !== item.id) fail(`цвет ${item.source} («${item.name}») не опознаёт сам себя`);
  if (item.id.startsWith('skin') && HERO_OUTFIT[index].toLowerCase() !== item.source.toLowerCase()) {
    fail(`кожа ${item.source} перекрашена в ${HERO_OUTFIT[index]} — так нельзя`);
  }
});
// Проверка «соседних» пикселей: сглаженные края не должны улетать в чужой класс.
for (const sample of ['#dcdad3', '#e1ded7', '#cb8a62', '#d28d64', '#222c35', '#1f2b45']) {
  console.log(`  ${sample} → ${nearestClassId(sample)}`);
}
if (nearestClassId('#cb8a62') !== 'skin' && nearestClassId('#cb8a62') !== 'skinShade') {
  fail('светлый оттенок кожи уходит в чужой класс — на лице появятся пятна');
}
if (nearestClassId('#e1ded7') !== 'cream') fail('светлая ткань уходит в чужой класс');

console.log(problems === 0 ? 'Графика: бюджет и палитра согласованы' : `Графика: проблем ${problems}`);
export const failed = problems > 0;
