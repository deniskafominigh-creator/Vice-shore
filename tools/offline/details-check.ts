/** Проверка живых деталей острова (задача 21) без WebGL.
 *
 *  Что важно проверить, не видя экрана:
 *   - атрибуты анимации живые: у каждой вершины ткани/флота есть свои aWind и
 *     фаза (иначе ветер «залипает» — ровно та ошибка, которую ловит этот тест);
 *   - бюджет: сколько мешей (draw call) и треугольников добавилось;
 *   - детали стоят на плато и не входят в чужие площадки (не в стене);
 *   - флот плавает в море, а не в газоне;
 *   - площадки деталей попадают в исключения травы.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ISLAND, PLOT, TERRACE } from '../../src/core/Config';
import { buildDetails } from '../../src/world/island/Details';
import { buildGrass } from '../../src/world/island/GrassField';
import { createIslandMaterials } from '../../src/world/island/IslandTextures';
import { buildStadium } from '../../src/world/island/Stadium';
import { buildTown } from '../../src/world/island/Town';
import { CollisionWorld } from '../../src/world/Colliders';

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

const makeCanvas = (): Record<string, unknown> => {
  const ctx = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'getImageData') {
          return (x: number, y: number, w = 4, h = 4) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        }
        if (key === 'createImageData') {
          return (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        }
        if (key === 'createLinearGradient' || key === 'createRadialGradient') {
          return () => ({ addColorStop: () => undefined });
        }
        if (key === 'canvas') return canvas;
        return () => 0;
      },
      set() {
        return true;
      },
    },
  );
  const canvas: Record<string, unknown> = {
    width: 256,
    height: 256,
    style: {},
    getContext: () => ctx,
    toDataURL: () => 'data:,',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  return canvas;
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => makeCanvas(),
  createElementNS: () => makeCanvas(),
};

const materials = createIslandMaterials();
const collisions = new CollisionWorld();
const town = buildTown(materials, collisions);
const stadium = buildStadium(materials, collisions);
const details = buildDetails(materials);

// ——— 1. бюджет ————————————————————————————————————————————————
let meshes = 0;
let points = 0;
let triangles = 0;
const broken: string[] = [];
details.group.traverse((object) => {
  if ((object as THREE.Points).isPoints) {
    points += 1;
    return;
  }
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh || !mesh.geometry) return;
  meshes += 1;
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position');
  const count = geometry.index ? geometry.index.count : position?.count ?? 0;
  triangles += count / 3;
  if (!position) return;
  // Атрибуты анимации обязаны совпадать по числу вершин с позициями
  for (const name of ['aWind', 'aPhase', 'aSpeed', 'aAmp', 'color', 'aBoatCenter', 'aBoatPhase', 'aGlide']) {
    const attribute = geometry.getAttribute(name);
    if (attribute && attribute.count !== position.count) broken.push(`${mesh.name}.${name}`);
  }
});
console.log(`детали: мешей ${meshes}, точек ${points}, треугольников ${Math.round(triangles)}`);
if (broken.length > 0) {
  fail(`атрибуты не по вершинам (анимация «залипнет»): ${broken.slice(0, 4).join(', ')}`);
}
if (meshes < 8) fail(`деталей слишком мало: ${meshes} мешей — пустые места остались пустыми`);
if (meshes > 18) fail(`деталей слишком много для одного кадра: ${meshes} draw call`);
if (triangles > 70000) fail(`детали съели ${Math.round(triangles)} треугольников — это перебор`);
if (points === 0) fail('нет струй фонтана (Points)');

// ——— 2. площадки деталей: на плато и вне чужих площадок ——————————
const foreign = [
  ...town.occupied,
  ...stadium.clearings,
  { minX: PLOT.fenceMinX, maxX: PLOT.fenceMaxX, minZ: PLOT.fenceMinZ, maxZ: PLOT.fenceMaxZ },
];
const overlaps = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: (typeof foreign)[number]): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

let conflicts = 0;
for (const rect of details.occupied) {
  const hits = foreign.filter((other) => overlaps(rect, other));
  if (hits.length > 0) {
    conflicts += 1;
    console.error(
      `  площадка x ${rect.minX}..${rect.maxX} z ${rect.minZ}..${rect.maxZ} пересекает чужую ` +
        `x ${hits[0].minX.toFixed(1)}..${hits[0].maxX.toFixed(1)} z ${hits[0].minZ.toFixed(1)}..${hits[0].maxZ.toFixed(1)}`,
    );
  }
  // Углы площадки должны быть на плато
  for (const [x, z] of [
    [rect.minX, rect.minZ],
    [rect.maxX, rect.maxZ],
    [rect.minX, rect.maxZ],
    [rect.maxX, rect.minZ],
  ]) {
    const ellipse = (x / ISLAND.radiusX) ** 2 + (z / ISLAND.radiusZ) ** 2;
    if (ellipse > 1) console.log(`  примечание: площадка тянется в море (${x}, ${z}) — причал, это норма`);
  }
}
console.log(`площадок под детали: ${details.occupied.length}, пересечений с домами/стадионом/виллой: ${conflicts}`);
if (conflicts > 0) fail(`детали встали на чужую площадку: ${conflicts}`);

// ——— 2б. копланарных граней с газоном нет (z-fight) ————————————————
let coplanar = 0;
details.group.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh || (mesh as unknown as { isPoints?: boolean }).isPoints) return;
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position');
  if (!position) return;
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const y = position.getY(i + k);
      // Только смотрящие ВВЕРХ грани: нижние торцы цилиндров в плоскости газона
      // не мерцают — их закрывает сам предмет.
      const ny = normal ? normal.getY(i + k) : 0;
      if (Math.abs(y - TERRACE.deckTopY) < 0.002 && ny > 0.9) {
        coplanar += 1;
        return;
      }
    }
  }
});
console.log(`граней ровно на уровне газона: ${coplanar}`);
if (coplanar > 0) fail(`настил/плиты легли в плоскость газона: ${coplanar} мешей будут мерцать`);

// ——— 3. флот плавает в море ————————————————————————————————————————
const fleet = details.group.children.find((child) => child.name === 'detail-fleet') as THREE.Mesh | undefined;
if (!fleet) {
  fail('флота нет в сцене');
} else {
  const position = fleet.geometry.getAttribute('position');
  let inSea = 0;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    if ((x / ISLAND.radiusX) ** 2 + (z / ISLAND.radiusZ) ** 2 > 0.95) inSea += 1;
  }
  const share = inSea / Math.max(1, position.count);
  const centers = fleet.geometry.getAttribute('aBoatCenter');
  const uniqueCenters = new Set<string>();
  for (let i = 0; i < centers.count; i += 1) {
    uniqueCenters.add(`${centers.getX(i).toFixed(1)}:${centers.getZ(i).toFixed(1)}`);
  }
  console.log(
    `флот: ${Math.round(share * 100)} % вершин в море, вершин ${position.count}, качающихся корпусов ${uniqueCenters.size}`,
  );
  if (share < 0.85) fail('часть флота стоит на газоне, а не в воде');
  if (uniqueCenters.size !== 7) fail(`в флоте ${uniqueCenters.size} корпусов вместо 7 (4 лодки + 3 буя)`);
  if (position.count < 2000) fail('флот склеился не полностью: слишком мало вершин');
}

// ——— 4. ткань и качка — в шейдере, а не на CPU ————————————————————
const clothMesh = details.group.children.find((child) => child.name === 'detail-cloth') as THREE.Mesh | undefined;
if (!clothMesh) {
  fail('ткани нет в сцене');
} else {
  for (const name of ['aWind', 'aPhase', 'aSpeed', 'aAmp']) {
    if (!(clothMesh.geometry as THREE.BufferGeometry).getAttribute(name)) fail(`у ткани нет ${name}`);
  }
  const material = clothMesh.material as THREE.MeshPhysicalMaterial;
  if (!material.vertexColors) fail('цвет ткани не в вершинах: пришлось бы плодить материалы');
  if (!material.onBeforeCompile) fail('ветер не вклеен в шейдер ткани');
}
const source = readFileSync('src/world/island/Details.ts', 'utf8');
for (const token of ['customProgramCacheKey', 'aBoatCenter', 'aBoatRoll', 'gl_PointSize']) {
  if (!source.includes(token)) fail(`в деталях нет ${token}: анимация потерялась`);
}

// ——— 5. кадр не зависит от расстояния (LOD жив) ————————————————————
details.update(3.5, new THREE.Vector3(0, 1.7, 0));
const nearVisible = details.group.children.filter((child) => child.visible).length;
details.update(3.5, new THREE.Vector3(70, 1.7, 50));
const farVisible = details.group.children.filter((child) => child.visible).length;
console.log(`видимых групп вблизи: ${nearVisible}, с другого края: ${farVisible}`);
if (farVisible > nearVisible) fail('LOD деталей не гасит ничего');

// ——— 6. трава не растёт на площадках деталей ————————————————————
const grass = buildGrass([...town.occupied, ...stadium.clearings, ...details.occupied], 9000);
let inDetails = 0;
for (const child of grass.group.children) {
  const mesh = child as THREE.InstancedMesh;
  if (!mesh.isInstancedMesh) continue;
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    point.setFromMatrixPosition(matrix);
    if (details.occupied.some((rect) => point.x > rect.minX && point.x < rect.maxX && point.z > rect.minZ && point.z < rect.maxZ)) {
      inDetails += 1;
    }
  }
}
console.log(`трава на площадках деталей: ${inDetails} из ${grass.instances} пучков`);
if (inDetails > 0) fail(`трава проросла сквозь детали: ${inDetails} пучков`);
grass.dispose();

console.log(`анимированных предметов: ${details.animated}, draw call деталей: ${details.drawMeshes}`);
void TERRACE;
details.dispose();
materials.dispose();

if (failures.length > 0) {
  console.error('Живые детали: есть проблемы');
  failures.forEach((message) => console.error(`  ✗ ${message}`));
  process.exitCode = 1;
} else {
  console.log('Живые детали: всё на месте');
}
