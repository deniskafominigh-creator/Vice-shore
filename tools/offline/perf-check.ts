/**
 * Отчёт по производительности сцены (сборка v20).
 *
 *  Считает то, за что платит кадр:
 *   • сколько мешей (= draw calls) останется после склейки статики;
 *   • сколько треугольников в каждом меше и сколько из них «всегда в кадре» —
 *     склейка по материалам делает один меш на материал, и его габарит накрывает
 *     весь остров, то есть отсечение по пирамиде видимости не работает;
 *   • сколько мешей отбрасывают тень (второй проход);
 *   • сколько материалов и текстур живёт в памяти.
 *
 *  Инструмент ничего не меняет в игре: он собирает сцену так же, как `Island`,
 *  меряет кадр и сверяет с бюджетом. Если бюджет пробит — проверка падает,
 *  чтобы «стало на 30 тысяч треугольников тяжелее» не проходило незамеченным.
 */
import * as THREE from 'three';
import { buildVilla } from '../../src/world/island/Villa';
import { buildInterior } from '../../src/world/island/Interior';
import { buildRenovation } from '../../src/world/island/Renovation';
import { buildCourt } from '../../src/world/island/Court';
import { buildVegetation } from '../../src/world/island/Vegetation';
import { buildGround } from '../../src/world/island/Ground';
import { buildFence } from '../../src/world/island/Fence';
import { buildProps, buildDistantShore } from '../../src/world/island/Props';
import { buildTown } from '../../src/world/island/Town';
import { buildStadium } from '../../src/world/island/Stadium';
import { buildDetails } from '../../src/world/island/Details';
import { buildGrass } from '../../src/world/island/GrassField';
import { buildWildFlora } from '../../src/world/island/WildFlora';
import { buildGrove } from '../../src/world/island/Grove';
import { buildRoadside } from '../../src/world/island/Roadside';
import { mergeStaticMeshes } from '../../src/world/island/mergeStatic';
import { applyShadowBudget } from '../../src/world/island/shadowBudget';

/** Минимальный DOM: canvas 2D, градиенты, getImageData. */
const makeCanvas = (): Record<string, unknown> => {
  const canvas: Record<string, unknown> = { width: 8, height: 8, style: {} };
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(4, w * h * 4)).fill(150),
        width: w,
        height: h,
      }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
      putImageData: () => undefined,
      drawImage: () => undefined,
      measureText: () => ({ width: 40 }),
      canvas,
    },
    {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return () => 0;
      },
      set() {
        return true;
      },
    },
  );
  canvas.getContext = () => ctx;
  canvas.toDataURL = () => 'data:,';
  return canvas;
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => makeCanvas(),
  createElementNS: () => makeCanvas(),
};

const cache = new Map<string, THREE.MeshStandardMaterial>();
const materials = new Proxy({} as Record<string, THREE.MeshStandardMaterial>, {
  get(_t, prop: string) {
    if (prop === 'dispose') return () => undefined;
    let material = cache.get(prop);
    if (!material) {
      material = new THREE.MeshStandardMaterial();
      material.name = prop;
      cache.set(prop, material);
    }
    return material;
  },
});
const collisions = new Proxy({} as Record<string, unknown>, {
  get(_t, prop: string) {
    if (prop === 'list') return () => [];
    if (prop === 'isBlocked') return () => false;
    if (prop === 'resolve') return (x: number, z: number) => ({ x, z });
    return () => undefined;
  },
});

const m = materials as never;
const c = collisions as never;

/** Треугольники меша с учётом инстансов. */
function trianglesOf(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
  const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
  return Math.floor(count / 3) * instances;
}

interface Entry {
  readonly name: string;
  readonly triangles: number;
  readonly instances: number;
  readonly radius: number;
  readonly castShadow: boolean;
  readonly material: string;
  readonly kind: 'mesh' | 'instanced';
}

function collect(root: THREE.Object3D, label: string): Entry[] {
  const out: Entry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.attributes.position) return;
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const radius = mesh.geometry.boundingSphere?.radius ?? 0;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    out.push({
      name: `${label}/${mesh.name || material?.name || mesh.type}`,
      triangles: trianglesOf(mesh),
      instances: instanced ? (mesh as THREE.InstancedMesh).count : 1,
      radius,
      castShadow: mesh.castShadow,
      material: material?.name || material?.type || '—',
      kind: instanced ? 'instanced' : 'mesh',
    });
  });
  return out;
}

const modules: Array<[string, THREE.Object3D]> = [];
const villa = buildVilla(m, c);
modules.push(['villa', villa.group]);
modules.push(['interior', buildInterior(m, villa.interior, villa.floorY, c).group]);
modules.push(['renovation', buildRenovation(m, villa.interior, villa.floorY, c).group]);
modules.push(['court', buildCourt(m, c).group]);
modules.push(['vegetation', buildVegetation(m, c).group]);
const ground = buildGround(m);
modules.push(['ground', ground]);
const fence = buildFence(m, c);
modules.push(['fence', fence]);
const props = buildProps(m);
modules.push(['props', props]);
modules.push(['distantShore', buildDistantShore()]);
const town = buildTown(m, c);
modules.push(['town', town.group]);
const stadium = buildStadium(m, c);
modules.push(['stadium', stadium.group]);
const details = buildDetails(m);
modules.push(['details', details.group]);
const occupied = [...town.occupied, ...stadium.clearings, ...details.occupied];
const grass = buildGrass(occupied, 9000);
modules.push(['grass', grass.group]);
modules.push(['flora', buildWildFlora(occupied).group]);
const grove = buildGrove(occupied, c);
modules.push(['grove', grove.group]);
const roadside = buildRoadside(m, c, grove.trunks);
modules.push(['roadside', roadside.group]);

const before: Entry[] = [];
for (const [label, node] of modules) before.push(...collect(node, label));

// Бюджет теней — ровно как в игре (Island вызывает его на своей группе до склейки)
const shadowRoot = new THREE.Object3D();
for (const [, node] of modules) shadowRoot.add(node);
const budget = applyShadowBudget(shadowRoot);
const shadowBefore = before.filter((item) => item.castShadow).reduce((n, i) => n + i.triangles, 0);
console.log(`бюджет теней: снята с ${budget.disabled} мешей, ${budget.triangles.toLocaleString('ru-RU')} треугольников (было ${shadowBefore.toLocaleString('ru-RU')})`);

// Склейка статики — как в игре
const merged: Entry[] = [];
for (const [label, node] of modules) {
  if (['grass', 'flora', 'grove', 'vegetation', 'details'].includes(label)) {
    merged.push(...collect(node, label));
    continue;
  }
  mergeStaticMeshes(node, { labelRoot: node });
  merged.push(...collect(node, label));
}

const sum = (list: readonly Entry[]): number => list.reduce((total, item) => total + item.triangles, 0);
const drawCalls = merged.length;
const shadowCasters = merged.filter((item) => item.castShadow);
const instanced = merged.filter((item) => item.kind === 'instanced');
const staticMeshes = merged.filter((item) => item.kind === 'mesh');

console.log('=== Сцена целиком (после склейки статики) ===');
console.log(`draw calls (цвет):        ${drawCalls}`);
console.log(`из них instanced:         ${instanced.length} (${instanced.reduce((n, i) => n + i.instances, 0).toLocaleString('ru-RU')} инстансов)`);
console.log(`треугольников:            ${sum(merged).toLocaleString('ru-RU')}`);
console.log(`тень отбрасывают:         ${shadowCasters.length} мешей, ${sum(shadowCasters).toLocaleString('ru-RU')} треугольников в проходе тени`);
console.log(`материалов:               ${new Set(merged.map((item) => item.material)).size}`);
console.log(`до склейк:              ${before.length} мешей, ${sum(before).toLocaleString('ru-RU')} треугольников`);

console.log('\n=== По модулям ===');
const byModule = new Map<string, Entry[]>();
for (const item of merged) {
  const key = item.name.split('/')[0] ?? '—';
  byModule.set(key, [...(byModule.get(key) ?? []), item]);
}
const rows = [...byModule.entries()].map(([name, list]) => ({
  name,
  calls: list.length,
  triangles: sum(list),
  shadow: list.filter((item) => item.castShadow).length,
}));
rows.sort((a, b) => b.triangles - a.triangles);
console.log('модуль          вызовов   треугольников   с тенью');
for (const row of rows) {
  console.log(
    `${row.name.padEnd(15)} ${String(row.calls).padStart(7)} ${row.triangles.toLocaleString('ru-RU').padStart(15)} ${String(row.shadow).padStart(9)}`,
  );
}

console.log('\n=== Самые тяжёлые меши (их видно всегда: габарит на весь остров) ===');
const heavy = [...merged].sort((a, b) => b.triangles - a.triangles).slice(0, 14);
for (const item of heavy) {
  console.log(
    `${item.name.slice(0, 42).padEnd(44)} ${item.triangles.toLocaleString('ru-RU').padStart(10)} тр.  радиус ${Math.round(item.radius * 10) / 10} м  ${item.castShadow ? 'тень' : '—'}`,
  );
}

const bigRadius = merged.filter((item) => item.radius > 60);
console.log(
  `\nмешей с «островным» габаритом (радиус > 60 м): ${bigRadius.length}, в них ${sum(bigRadius).toLocaleString('ru-RU')} треугольников — отсечение по пирамиде видимости их не спасает`,
);

// ——— бюджет кадра (GOAL.md §4.4 + замеры сборки v20) ———
const BUDGET = {
  drawCalls: 240,
  triangles: 310_000,
  shadowTriangles: 165_000,
  materials: 70,
  instanced: 45,
} as const;

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

const shadowTriangles = sum(shadowCasters);
const materialCount = new Set(merged.map((item) => item.material)).size;
console.log('\n=== Бюджет кадра ===');
check(drawCalls <= BUDGET.drawCalls, `draw calls ${drawCalls} ≤ ${BUDGET.drawCalls}`);
check(
  sum(merged) <= BUDGET.triangles,
  `треугольников ${sum(merged).toLocaleString('ru-RU')} ≤ ${BUDGET.triangles.toLocaleString('ru-RU')}`,
);
check(
  shadowTriangles <= BUDGET.shadowTriangles,
  `теневой проход ${shadowTriangles.toLocaleString('ru-RU')} ≤ ${BUDGET.shadowTriangles.toLocaleString('ru-RU')} треугольников`,
);
check(materialCount <= BUDGET.materials, `материалов ${materialCount} ≤ ${BUDGET.materials}`);
check(instanced.length <= BUDGET.instanced, `instanced-мешей ${instanced.length} ≤ ${BUDGET.instanced}`);
check(
  shadowTriangles < sum(merged) * 0.6,
  `тень дешевле цвета: ${shadowTriangles.toLocaleString('ru-RU')} против ${sum(merged).toLocaleString('ru-RU')} (${Math.round(
    (shadowTriangles / sum(merged)) * 100,
  )} %)`,
);

// Тень не должна отбрасывать тяжёлая мелочь: сиденья, интерьер, ремонт, земля, кусты
const noShadow = merged.filter((item) => !item.castShadow);
check(noShadow.length > 0, `тень снята с ${noShadow.length} мешей (сиденья, интерьер, земля, кусты)`);
check(
  !merged.some((item) => item.castShadow && /stadium-seat|interior|renovation|ground|shrubs/.test(item.name)),
  'тяжёлая мелочь в теневой проход не попадает',
);

// Без габарита three не отсекает меш по пирамиде видимости — он рисуется всегда
const withoutSphere = merged.filter((item) => item.radius <= 0);
check(withoutSphere.length === 0, `у всех мешей есть габарит для отсечения (без него: ${withoutSphere.length})`);

if (problems > 0) {
  console.log(`\nПроблем: ${problems}`);
  process.exitCode = 1;
} else {
  console.log('\nБюджет кадра: в норме');
}

export const report = { drawCalls, triangles: sum(merged), shadowTriangles, materials: materialCount };
export const failed = problems;
