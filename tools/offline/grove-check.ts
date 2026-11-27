/**
 * Проверка рощи (сборка v17): пинии, кипарисы, баньяны, жакаранды и оливы.
 *
 *  Без GPU проверяем то, что можно посчитать:
 *   1. пять видов и заявленное число деревьев, часть — вдоль улицы;
 *   2. ствол не встал в дом, бассейн, на поле стадиона, на дорожку или газон виллы,
 *      и не пробил кромку острова;
 *   3. корни на земле, высота дерева соответствует геометрии;
 *   4. бюджет: один InstancedMesh на вид (5 draw calls), одна геометрия, один
 *      материал и один атлас на вид, свой ключ шейдера;
 *   5. ветер в шейдере: uTime доходит, вес растёт с высотой вершины;
 *   6. каждое дерево — препятствие: круг столкновения на ствол.
 */
import * as THREE from 'three';
import { ISLAND, PLOT, TERRACE, TOWN, VILLA, COURT } from '../../src/core/Config';
import { buildTown } from '../../src/world/island/Town';
import { buildStadium } from '../../src/world/island/Stadium';
import { buildDetails } from '../../src/world/island/Details';
import { buildGrove, type GroveResult } from '../../src/world/island/Grove';

/** Минимальный DOM: CanvasTexture и getImageData в Node без WebGL. */
const makeContext = (size: number): Record<string, unknown> => {
  const canvas: Record<string, unknown> = { width: size, height: size };
  const ctx = new Proxy(
    {
      // Карте нормалей нужны реальные данные, иначе Собель читает нули
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(160),
        width: w,
        height: h,
      }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => undefined,
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
  canvas.style = {};
  return canvas;
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => makeContext(16),
  createElementNS: () => makeContext(16),
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

interface CircleCall {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}
const circles: CircleCall[] = [];
const collisions = {
  addBox: () => undefined,
  addCircle: (x: number, z: number, radius: number) => {
    circles.push({ x, z, radius });
  },
  addCylinder: () => undefined,
  isBlocked: () => false,
  resolve: (x: number, z: number) => ({ x, z }),
} as never;

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

const town = buildTown(materials as never, collisions);
const stadium = buildStadium(materials as never, collisions);
const details = buildDetails(materials as never);
const occupied = [...town.occupied, ...stadium.clearings, ...details.occupied];
console.log(`занятых площадок: ${occupied.length} (дома ${town.occupied.length}, стадион ${stadium.clearings.length}, детали ${details.occupied.length})`);

circles.length = 0;
const grove: GroveResult = buildGrove(occupied, collisions);
const GROUND = TERRACE.deckTopY;

console.log('\nвид                  штук  высота  треугольников');
for (const species of grove.species) {
  console.log(
    `  ${species.label.padEnd(18)} ${String(species.count).padStart(4)} ${String(species.height).padStart(7)} м ${String(species.triangles).padStart(13)}`,
  );
}
check(grove.species.length === 5, 'пять видов деревьев');
check(grove.species.every((species) => species.count >= 8), 'каждого вида посажено не меньше восьми');
check(grove.instances >= 45 && grove.instances <= 90, `всего деревьев ${grove.instances} — в заявленном коридоре 45–90`);
check(grove.alongStreet >= 25, `вдоль улицы ${grove.alongStreet} деревьев — обочина больше не пустая`);

// ——— бюджет кадра ———
const geometries = new Set<THREE.BufferGeometry>();
const materialSet = new Set<THREE.Material>();
const textureSet = new Set<THREE.Texture>();
const cacheKeys = new Set<string>();
const shaders: Array<{ uniforms: Record<string, { value: unknown }>; vertexShader: string }> = [];
let meshes = 0;
for (const child of grove.group.children) {
  const mesh = child as THREE.InstancedMesh;
  meshes += 1;
  geometries.add(mesh.geometry);
  const material = mesh.material as THREE.MeshStandardMaterial;
  materialSet.add(material);
  if (material.map) textureSet.add(material.map);
  if (material.normalMap) textureSet.add(material.normalMap);
  if (material.customProgramCacheKey) cacheKeys.add(material.customProgramCacheKey());
  check(material.alphaTest === 0, `${mesh.name}: без alpha-test — ствол и крона в непрозрачном проходе`);
  check(mesh.castShadow === true, `${mesh.name}: отбрасывает тень`);
  check(
    material.normalMap !== null && material.normalMap !== undefined,
    `${mesh.name}: есть карта нормалей — объём без лишних полигонов`,
  );
  const fake = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <begin_vertex>' };
  material.onBeforeCompile(fake as never, undefined as never);
  shaders.push(fake);
}
grove.update(3.25);
check(meshes === 5, `вся роща — ${meshes} draw calls (по одному мешу на вид)`);
check(geometries.size === 5, `геометрий ${geometries.size} — не по одной на дерево`);
check(materialSet.size === 5, `материалов ${materialSet.size}`);
check(textureSet.size === 10, `текстур ${textureSet.size}: по атласу и карте нормалей на вид`);
check(cacheKeys.size === 5, 'свой ключ шейдера на вид — пересборки программ в кадре не будет');
check(
  shaders.every((shader) => shader.uniforms.uTime && Number(shader.uniforms.uTime.value) === 3.25),
  'ветер: uTime общий и доходит до всех видов',
);
check(
  shaders.every((shader) => shader.vertexShader.includes('treeWeight') && shader.vertexShader.includes('pow(clamp(transformed.y')),
  'ветер считается от высоты вершины: качается крона, комель стоит',
);
check(grove.triangles <= 90_000, `роща — ${grove.triangles} треугольников, не больше 90 000`);

// ——— посадка ———
const rects = [
  ...occupied,
  { minX: PLOT.fenceMinX, maxX: PLOT.fenceMaxX, minZ: PLOT.fenceMinZ, maxZ: PLOT.fenceMaxZ },
  {
    minX: VILLA.centerX - VILLA.width / 2,
    maxX: VILLA.centerX + VILLA.width / 2,
    minZ: VILLA.centerZ - VILLA.depth / 2,
    maxZ: VILLA.centerZ + VILLA.depth / 2 + VILLA.terraceDepth,
  },
  {
    minX: COURT.centerX - COURT.length / 2,
    maxX: COURT.centerX + COURT.length / 2,
    minZ: COURT.centerZ - COURT.width / 2,
    maxZ: COURT.centerZ + COURT.width / 2,
  },
];

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
let outside = 0;
let insideRect = 0;
let onStreet = 0;
let floating = 0;
let tooClose = 0;
let sample: string | null = null;
const trees: Array<{ name: string; x: number; z: number; scale: number }> = [];

for (const child of grove.group.children) {
  const mesh = child as THREE.InstancedMesh;
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    matrix.decompose(position, quaternion, scale);
    const { x, y, z } = position;
    trees.push({ name: mesh.name, x, z, scale: scale.x });
    const normalised = (x * x) / (ISLAND.radiusX * ISLAND.radiusX) + (z * z) / (ISLAND.radiusZ * ISLAND.radiusZ);
    if (normalised > 0.95) outside += 1;
    if (Math.abs(y - (GROUND - 0.02)) > 0.001) floating += 1;
    if (Math.abs(z - TOWN.streetZ) < TOWN.streetWidth / 2 + 0.7) onStreet += 1;
    for (const rect of rects) {
      if (x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ) {
        insideRect += 1;
        if (!sample) sample = `${mesh.name} (${x.toFixed(1)}, ${z.toFixed(1)})`;
        break;
      }
    }
  }
}
for (let i = 0; i < trees.length; i += 1) {
  for (let j = i + 1; j < trees.length; j += 1) {
    const a = trees[i]!;
    const b = trees[j]!;
    const gap = Math.hypot(a.x - b.x, a.z - b.z);
    // Деревья не должны стоять друг в друге: стволы ближе 1,4 м — это ошибка посадки
    if (gap < 1.4) tooClose += 1;
  }
}
check(outside === 0, `за кромкой острова деревьев нет (${outside})`);
check(insideRect === 0, `в домах, бассейнах, на поле и площадках деревьев нет (${insideRect}${sample ? `, первое: ${sample}` : ''})`);
check(onStreet === 0, `на проезжей части деревьев нет (${onStreet})`);
check(floating === 0, 'все стволы стоят на земле (2 см в грунте — щели не будет)');
check(tooClose === 0, `стволы не наезжают друг на друга (${tooClose} пар ближе 1,4 м)`);
check(circles.length === grove.instances, `каждое дерево — препятствие: ${circles.length} кругов столкновения на ${grove.instances} стволов`);
check(
  circles.every((circle) => circle.radius >= 0.28 && circle.radius <= 0.45),
  'радиус ствола 28–45 см — игрок обходит дерево, а не проваливается',
);

if (problems > 0) {
  console.log(`\nПроблем: ${problems}`);
  process.exitCode = 1;
} else {
  console.log('\nРоща: породы, посадки, бюджет и ветер в порядке');
}
export const failed = problems;
