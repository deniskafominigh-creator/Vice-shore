/**
 * Проверка дикой флоры (сборка v16): луговая трава, камыш и цветы.
 *
 *  Здесь проверяется не «красиво ли», а то, что можно проверить без GPU:
 *   1. каждый вид действительно посеян и в заявленном количестве;
 *   2. ни одно растение не выросло в доме, на поле стадиона, на площадке деталей
 *      или на стриженом газоне у виллы;
 *   3. всё в пределах острова, корни на земле, ничего не висит в воде;
 *   4. геометрия и материал общие на вид, а не на чанк (иначе это лишние
 *      draw calls и лишние шейдеры);
 *   5. LOD честный: у земли видны не все чанки, с 300 м — ни одного;
 *   6. бюджет кадра: чанков и треугольников не больше заявленного.
 */
import * as THREE from 'three';
import { ISLAND, TERRACE } from '../../src/core/Config';
import { buildTown } from '../../src/world/island/Town';
import { buildStadium } from '../../src/world/island/Stadium';
import { buildDetails } from '../../src/world/island/Details';
import { buildWildFlora, type FloraResult } from '../../src/world/island/WildFlora';

/** Минимальный DOM: CanvasTexture в Node без WebGL. */
const makeCanvas = (): Record<string, unknown> => {
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'canvas') return canvas;
      return () => 0;
    },
    set() { return true; },
  });
  const canvas: Record<string, unknown> = {
    width: 16,
    height: 16,
    style: {},
    getContext: () => ctx,
    toDataURL: () => 'data:,',
  };
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
    if (prop === 'isBlocked') return () => false;
    if (prop === 'resolve') return (x: number, z: number) => ({ x, z });
    if (prop === 'addBox' || prop === 'addCircle' || prop === 'addCylinder') return () => undefined;
    return () => undefined;
  },
});

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

// ——— 1. те же «занятые» прямоугольники, что в игре ———
const m = materials as never;
const c = collisions as never;
const town = buildTown(m, c);
const stadium = buildStadium(m, c);
const details = buildDetails(m);
const occupied = [...town.occupied, ...stadium.clearings, ...details.occupied];
console.log(`занятых площадок: ${occupied.length} (дома ${town.occupied.length}, стадион ${stadium.clearings.length}, детали ${details.occupied.length})`);

const flora: FloraResult = buildWildFlora(occupied);

const GROUND = TERRACE.deckTopY;
const LAWN = { minX: -34, maxX: 18, minZ: -18, maxZ: 15 };

// ——— 2. отчёт по видам ———
console.log('\nвид                  штук  треугольников');
for (const species of flora.species) {
  console.log(
    `  ${species.label.padEnd(18)} ${String(species.count).padStart(5)} ${String(species.triangles).padStart(13)}`,
  );
}
check(flora.species.length === 5, 'пять видов: луговая трава, камыш, ромашки, маки, лаванда');
check(
  flora.species.every((species) => species.count >= 500),
  'каждый вид посеян гуще 500 штук',
);
check(flora.triangles <= 45000, `флора — ${flora.triangles} треугольников, не больше 45 000`);
check(flora.instances >= 9500 && flora.instances <= 12000, `всего растений ${flora.instances} — в заявленном коридоре`);

// ——— 3. бюджет кадра: один меш на вид и дальность в шейдере ———
const geometries = new Set<THREE.BufferGeometry>();
const materialSet = new Set<THREE.Material>();
const textureNames = new Set<string>();
const cacheKeys = new Set<string>();
const cullDistances: number[] = [];
let meshes = 0;
/** Шейдер, который получится после `onBeforeCompile`: проверяем текст, а не «на глаз». */
interface FakeShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}
const shaders: FakeShader[] = [];

for (const child of flora.group.children) {
  const mesh = child as THREE.InstancedMesh;
  meshes += 1;
  geometries.add(mesh.geometry);
  const material = mesh.material as THREE.MeshStandardMaterial;
  materialSet.add(material);
  if (material.map) textureNames.add(material.map.name);
  if (material.customProgramCacheKey) cacheKeys.add(material.customProgramCacheKey());
  check(material.alphaTest > 0.3, `${mesh.name}: alphaTest ${material.alphaTest} — трава в непрозрачном проходе`);
  check(mesh.castShadow === false, `${mesh.name}: тени не отбрасывает (иначе платим за 10 000 растений)`);
  check(mesh.count > 0, `${mesh.name}: ${mesh.count} растений в одном инстанс-буфере`);

  const fake: FakeShader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '' };
  material.onBeforeCompile(fake as never, undefined as never);
  shaders.push(fake);
  const cull = fake.uniforms.uCullDistance;
  if (cull) cullDistances.push(Number(cull.value));
}

// Ветер и отсечение: юниформ времени общий, дальность — своя у каждого вида
flora.update(2.5);
check(
  shaders.every((shader) => shader.uniforms.uTime && Number(shader.uniforms.uTime.value) === 2.5),
  'ветер: uTime общий и доходит до всех видов',
);
check(
  shaders.every((shader) => shader.vertexShader.includes('uCullDistance') && shader.vertexShader.includes('cameraPosition')),
  'дальность режется в вершинном шейдере по позиции камеры',
);
check(
  shaders.every((shader) => shader.vertexShader.includes('transformed = vec3(0.0)')),
  'далёкое растение схлопывается в точку — до растеризации не доходит',
);
check(
  cullDistances.length === 5 && cullDistances.every((d) => d >= 35 && d <= 100),
  `дальность видов ${cullDistances.map((d) => Math.round(d)).join(' / ')} м — цветы ближе, камыш дальше`,
);
check(geometries.size === 5, `геометрия скопирована только по видам (${geometries.size} на ${meshes} мешей)`);
check(materialSet.size === 5, `материалов ${materialSet.size} — по одному на вид`);
check(textureNames.size === 5, `у каждого вида своя текстура: ${[...textureNames].join(', ')}`);
check(cacheKeys.size === 5, 'у каждого вида свой ключ шейдера — пересборок программы не будет');
check(meshes === 5, `вся флора — ${meshes} draw calls вместо чанков`);

// ——— 4. посадки: ареалы и корни ———
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
let outsideIsland = 0;
let inOccupied = 0;
let onLawn = 0;
let wrongHeight = 0;
let sampleOverlap: string | null = null;

for (const child of flora.group.children) {
  const mesh = child as THREE.InstancedMesh;
  const species = mesh.name.replace('flora-', '').replace('-chunk', '');
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix);
    const { x, y, z } = position;
    const normalised = (x * x) / (ISLAND.radiusX * ISLAND.radiusX) + (z * z) / (ISLAND.radiusZ * ISLAND.radiusZ);
    if (normalised > 0.99) outsideIsland += 1;
    if (Math.abs(y - (GROUND - 0.01)) > 0.001) wrongHeight += 1;
    for (const rect of occupied) {
      if (x > rect.minX - 0.2 && x < rect.maxX + 0.2 && z > rect.minZ - 0.2 && z < rect.maxZ + 0.2) {
        inOccupied += 1;
        if (!sampleOverlap) sampleOverlap = `${species} (${x.toFixed(1)}, ${z.toFixed(1)})`;
        break;
      }
    }
    if (x > LAWN.minX && x < LAWN.maxX && z > LAWN.minZ && z < LAWN.maxZ) onLawn += 1;
  }
}
check(outsideIsland === 0, `за кромкой острова растений нет (${outsideIsland})`);
check(inOccupied === 0, `на домах, поле и площадках растений нет (${inOccupied}${sampleOverlap ? `, первое: ${sampleOverlap}` : ''})`);
check(onLawn === 0, `стриженый газон у виллы остался стриженым (${onLawn})`);
check(wrongHeight === 0, 'все корни на земле, в 1 см ниже газона — щели не будет');

// ——— 5. посадки не выходят за ареалы (уже проверено выше) и меш целиком в кадре ———
const sphere = new THREE.Sphere();
let sphereOk = true;
for (const child of flora.group.children) {
  const mesh = child as THREE.InstancedMesh;
  if (!mesh.boundingSphere) mesh.computeBoundingSphere();
  sphere.copy(mesh.boundingSphere as THREE.Sphere);
  // Меш на весь вид покрывает остров: радиус — это половина диагонали эллипса
  if (!Number.isFinite(sphere.radius) || sphere.radius > ISLAND.radiusX * 1.8) sphereOk = false;
}
check(sphereOk, 'габарит каждого меша конечный и в пределах острова');

console.log(problems === 0 ? '\nФлора: посадки, бюджет и LOD в порядке' : `\nФлора: проблем ${problems}`);
export const failed = problems > 0;
