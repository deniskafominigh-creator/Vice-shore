/** Проверка графики (задача 19): бюджет пост-обработки по пресетам, дымка,
 *  палитра одежды. Всё это чистые константы и правила — проверяется без GPU. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FOG, PALETTE, QUALITY_ORDER, QUALITY_PRESETS, SUN } from '../../src/core/Config';
import { createHdrPanorama } from '../../src/world/Environment';
import { createIslandMaterials } from '../../src/world/island/IslandTextures';
import { buildGrass } from '../../src/world/island/GrassField';
import { Sea } from '../../src/world/Sea';
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
  const passes = [
    preset.ssao && 'SSAO',
    preset.bokeh && 'Bokeh',
    preset.bloom && 'Bloom',
    preset.smaa && 'SMAA',
    preset.film && 'Film',
  ].filter(Boolean);
  console.log(
    `  ${level.padEnd(6)} тени ${String(preset.shadowMapSize).padStart(4)} · ` +
      `pixelRatio ${preset.pixelRatio} · ${passes.length > 0 ? passes.join(' + ') : 'прямой рендер (без проходов)'}`,
  );
  if (preset.shadowMapSize < 1024) fail(`${level}: карта теней ${preset.shadowMapSize} — тени будут рваными`);
  if (preset.shadowMapSize > 4096) fail(`${level}: карта теней ${preset.shadowMapSize} — больше 4096 не нужно`);
}

const low = QUALITY_PRESETS.low;
if (low.bloom || low.ssao || low.smaa || low.bokeh || low.film) {
  fail('низкое качество не должно включать пост-обработку: это мобильный FPS');
}
if (!QUALITY_PRESETS.high.bokeh) fail('на высоком качестве нет глубины резкости');
if (!QUALITY_PRESETS.high.film) fail('на высоком качестве нет плёночного эффекта');
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

// ——— 4. HDR-панорама: солнце ярче единицы, небо и море в разумных пределах ———
const sunDirection = new THREE.Vector3(SUN.direction[0], SUN.direction[1], SUN.direction[2]).normalize();
const panorama = createHdrPanorama(sunDirection);
const raw = panorama.image.data as unknown as Uint16Array;
const half = THREE.DataUtils.fromHalfFloat;
const width = panorama.image.width;
const height = panorama.image.height;
let maxValue = 0;
let maxRow = 0;
let maxColumn = 0;
let bad = 0;
let skySum = 0;
let skyCount = 0;
let seaSum = 0;
let seaCount = 0;
for (let row = 0; row < height; row += 1) {
  const v = (row + 0.5) / height;
  const y = Math.sin((v - 0.5) * Math.PI);
  for (let column = 0; column < width; column += 1) {
    const offset = (row * width + column) * 4;
    const r = half(raw[offset]);
    const g = half(raw[offset + 1]);
    const b = half(raw[offset + 2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || r < 0 || g < 0 || b < 0) bad += 1;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if ((row % 8 === 0) && (column % 8 === 0)) {
      if (y > 0.25) {
        skySum += luma;
        skyCount += 1;
      } else if (y < -0.2) {
        seaSum += luma;
        seaCount += 1;
      }
    }
    if (luma > maxValue) {
      maxValue = luma;
      maxRow = row;
      maxColumn = column;
    }
  }
}
if (bad > 0) fail(`в HDR-панораме ${bad} битых пикселей (NaN/отрицательные)`);
if (maxValue < 20) fail(`солнце в панораме всего ${maxValue.toFixed(1)} — бликов на стекле не будет`);
const skyAverage = skySum / Math.max(1, skyCount);
const seaAverage = seaSum / Math.max(1, seaCount);
console.log(
  `HDR: ${width}×${height} · солнце ${maxValue.toFixed(1)} лямбд · небо в среднем ${skyAverage.toFixed(2)} · ` +
    `море ${seaAverage.toFixed(2)} · битых пикселей ${bad}`,
);
if (skyAverage < 0.25 || skyAverage > 6) fail(`небо в среднем ${skyAverage.toFixed(2)} — IBL будет либо тёмным, либо пересвеченным`);
if (seaAverage >= skyAverage) fail('море в панораме светлее неба — отражения вывернуты');
const sampleAt = (v: number, u: number): string => {
  const row = Math.min(height - 1, Math.max(0, Math.round(v * height)));
  const column = Math.min(width - 1, Math.max(0, Math.round(u * width)));
  const offset = (row * width + column) * 4;
  return `v=${v.toFixed(2)}: (${half(raw[offset]).toFixed(2)}, ${half(raw[offset + 1]).toFixed(2)}, ${half(raw[offset + 2]).toFixed(2)})`;
};
console.log(`панорама — море ${sampleAt(0.05, 0.3)} · горизонт ${sampleAt(0.5, 0.3)} · небо ${sampleAt(0.75, 0.3)} · зенит ${sampleAt(0.98, 0.3)}`);
// Значения линейные, поэтому «тёмно-синий» — это тысячные доли.
if (seaAverage < 0.0005) fail('море в панораме чёрное: в отражениях под горизонтом провал');

// Солнце должно оказаться там, где ему положено быть по направлению.
const sunV = Math.asin(THREE.MathUtils.clamp(sunDirection.y, -1, 1)) / Math.PI + 0.5;
const expectedRow = sunV * height;
const dRow = Math.abs(maxRow + 0.5 - expectedRow);
if (dRow > 3) fail(`солнце в панораме на строке ${maxRow}, а должно быть около ${expectedRow.toFixed(0)}`);
void maxColumn;

// ——— 5. физические материалы: стекло отражает, дерево и бетон матовые ———
const scratch = new Uint8ClampedArray(1024 * 1024 * 4);
const makeCanvas = (): Record<string, unknown> => {
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'createImageData'
          ? (w: number, h: number) => ({
              data: new Uint8ClampedArray(Math.max(4, w * h * 4)),
              width: w,
              height: h,
            })
          : key === 'getImageData'
          ? (x: number, y: number, w: number, h: number) => ({
              data: scratch.subarray(0, Math.max(4, w * h * 4)),
              width: w,
              height: h,
            })
          : () => 0,
      set: () => true,
    },
  );
  return { width: 256, height: 256, style: {}, getContext: () => ctx, toDataURL: () => '' };
};
(globalThis as unknown as { document: unknown }).document = { createElement: () => makeCanvas() };
const materials = createIslandMaterials();
const report = (label: string, material: THREE.MeshPhysicalMaterial): string =>
  `${label}: roughness ${material.roughness.toFixed(2)} · metalness ${material.metalness.toFixed(2)}` +
  (material.clearcoat ? ` · clearcoat ${material.clearcoat.toFixed(2)}` : '');
console.log(report('окна (витраж)', materials.glass as THREE.MeshPhysicalMaterial));
console.log(report('окна (стекло)', materials.windowGlass as THREE.MeshPhysicalMaterial));
console.log(report('дерево', materials.wood as THREE.MeshPhysicalMaterial));
console.log(report('бетон/штукатурка', materials.plaster as THREE.MeshPhysicalMaterial));
console.log(report('металл', materials.metal as THREE.MeshPhysicalMaterial));

const glass = materials.glass as THREE.MeshPhysicalMaterial;
const windowGlass = materials.windowGlass as THREE.MeshPhysicalMaterial;
const wood = materials.wood as THREE.MeshPhysicalMaterial;
const plaster = materials.plaster as THREE.MeshPhysicalMaterial;
const metal = materials.metal as THREE.MeshPhysicalMaterial;
if (glass.roughness > 0.12) fail('тёмное стекло витрин слишком матовое — отражений не будет');
if (windowGlass.roughness > 0.12) fail('стекло окон слишком матовое');
if ((glass.envMapIntensity ?? 1) < 1.5) fail('у стекла слабая карта окружения — отражения бледные');
if (wood.roughness < 0.6) fail('дерево блестит сильнее, чем должно');
if (plaster.roughness < 0.6) fail('бетон/штукатурка блестят сильнее, чем должны');
if (metal.metalness < 0.9) fail('металл не металл');
if (!wood.normalMap) fail('у дерева нет карты нормалей');
if (!plaster.normalMap) fail('у штукатурки нет карты нормалей');
const physicalCount = Object.values(materials).filter(
  (value) => value instanceof THREE.MeshPhysicalMaterial,
).length;
console.log(`физических материалов в палитре острова: ${physicalCount}`);
if (physicalCount < 10) fail('слишком мало физических материалов: замена не доведена');
materials.dispose();

// ——— 6. шейдер моря: без дублей uniform (именно дубль `uFogDensity` «убил» воду) ———
const seaSource = readFileSync('src/world/Sea.ts', 'utf8');
const shaderBlocks = [...seaSource.matchAll(/ShaderMaterial\(\{([\s\S]*?)\}\);/g)].map((match) => match[1]);
if (shaderBlocks.length === 0) fail('в Sea.ts не найден ни один ShaderMaterial');
for (const block of shaderBlocks) {
  for (const stage of ['vertexShader', 'fragmentShader']) {
    const index = block.indexOf(stage);
    if (index < 0) continue;
    const chunk = block.slice(index, block.indexOf('`', block.indexOf('`', index) + 1) + 1);
    const names = [...chunk.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((match) => match[1]);
    const duplicates = names.filter((name, position) => names.indexOf(name) !== position);
    if (duplicates.length > 0) {
      fail(`в ${stage} моря дубли uniform: ${[...new Set(duplicates)].join(', ')} — шейдер не соберётся, вода исчезнет`);
    }
    console.log(`${stage} моря: ${names.length} uniform, дублей нет`);
  }
}
if (!seaSource.includes('tEnv')) fail('море не читает HDR-панораму: отражения остались формулой');
if (!seaSource.includes('RECIPROCAL_PI')) fail('развёртка equirect в шейдере моря потерялась');

// ——— 7. море: материалы, панорама и состав сцены ———
const sea = new Sea(sunDirection, QUALITY_PRESETS.high.seaSegments);
for (const key of ['uTime', 'uChop', 'tEnv', 'uHasEnv', 'uSunDir', 'uFogDensity']) {
  if (!(key in sea.material.uniforms)) fail(`в шейдере моря нет uniform ${key}`);
}
if (sea.material.uniforms.uHasEnv.value !== 0) fail('море стартует с включённой панорамой, но её ещё нет');
sea.setEnvironment(panorama);
if (sea.material.uniforms.uHasEnv.value !== 1) fail('море не приняло HDR-панораму');
if (sea.material.uniforms.tEnv.value !== panorama) fail('в шейдер моря ушла не та текстура');
sea.setEnvironment(null);
if (sea.material.uniforms.uHasEnv.value !== 0) fail('море не умеет откатываться на формулу неба');
if (sea.mesh.frustumCulled) fail('море отсекается по фрустуму — при повороте камеры оно мигает');
if (sea.mesh.renderOrder >= 0) fail('море рисуется после острова — вода будет закрывать берег');
console.log(`море: сегментов на низком ${QUALITY_PRESETS.low.seaSegments} · на высоком ${QUALITY_PRESETS.high.seaSegments}`);

// ——— 8. трава: LOD по расстоянию реально гасит дальние чанки ———
const grass = buildGrass([], 1200);
if (grass.chunks < 2) fail('трава не разбита на чанки');
const near = new THREE.Vector3(0, 1.7, 0);
grass.update(0, near);
const visibleNear = grass.group.children.filter((child) => child.visible).length;
grass.update(0, new THREE.Vector3(0, 400, 0));
const visibleFar = grass.group.children.filter((child) => child.visible).length;
if (visibleNear === 0) fail('вблизи не видно ни одного чанка травы');
if (visibleFar >= visibleNear) fail('дальний LOD травы не работает: чанки не гасятся');
console.log(`трава: чанков ${grass.chunks} · видно вблизи ${visibleNear} · с 400 м ${visibleFar}`);
grass.dispose();

const fullGrass = buildGrass([], 9000);
const tuftTriangles =
  fullGrass.group.children[0] instanceof THREE.InstancedMesh
    ? (fullGrass.group.children[0].geometry.index
        ? fullGrass.group.children[0].geometry.index.count / 3
        : (fullGrass.group.children[0].geometry.getAttribute('position')?.count ?? 0) / 3)
    : 0;
const grassTriangles = tuftTriangles * fullGrass.instances;
console.log(
  `трава на весь остров: ${fullGrass.instances} пучков × ${tuftTriangles} треугольника = ${grassTriangles} ` +
    `(было ${fullGrass.instances * 18} при 18 треугольниках на пучок)`,
);
if (tuftTriangles > 4) fail(`пучок травы стоит ${tuftTriangles} треугольника — это не cross-billboard`);
fullGrass.dispose();
