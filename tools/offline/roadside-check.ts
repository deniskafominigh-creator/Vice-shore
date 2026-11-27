/**
 * Проверка обочины и фирменного забора (сборка v17).
 *
 *   1. забор стоит с обеих сторон улицы, но не на проезжей части и не на бордюре;
 *   2. у каждого дома есть калитка и номер, проёмы совпадают с дорожками;
 *   3. штакетник не прорастает сквозь деревья рощи;
 *   4. каждый пролёт — препятствие для игрока;
 *   5. один атлас табличек на все указатели, штакетник — инстансы, а не меши;
 *   6. остановка, переход и указатель на стадион на месте и внутри острова.
 */
import * as THREE from 'three';
import { ISLAND, TOWN, layoutHouses } from '../../src/core/Config';
import type { CollisionWorld } from '../../src/world/Colliders';

/** Минимальный DOM: canvas 2D и getImageData в Node без WebGL. */
const makeContext = (size: number): Record<string, unknown> => {
  const canvas: Record<string, unknown> = { width: size, height: size };
  const ctx = new Proxy(
    {
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(128),
        width: w,
        height: h,
      }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => undefined,
      measureText: () => ({ width: 10 }),
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

const materials = new Proxy({} as Record<string, THREE.MeshStandardMaterial>, {
  get(_t, prop: string) {
    if (prop === 'dispose') return () => undefined;
    const material = new THREE.MeshStandardMaterial();
    material.name = prop;
    return material;
  },
});

interface BoxCall {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly top: number;
}
const boxes: BoxCall[] = [];
const circles: Array<{ x: number; z: number }> = [];
const collisions = {
  addBox: (minX: number, maxX: number, minZ: number, maxZ: number, top: number) => {
    boxes.push({ minX, maxX, minZ, maxZ, top });
  },
  addCircle: (x: number, z: number) => {
    circles.push({ x, z });
  },
  isBlocked: () => false,
  resolve: (x: number, z: number) => ({ x, z }),
} as unknown as CollisionWorld;

const { buildRoadside } = await import('../../src/world/island/Roadside');

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

// Деревья рощи по факту: три ствола прямо на линии забора — пролёты должны разойтись
const trunks = [
  { x: -30, z: TOWN.streetZ - TOWN.streetWidth / 2 - 2.4 },
  { x: 12, z: TOWN.streetZ + TOWN.streetWidth / 2 + 2.4 },
  { x: 40, z: TOWN.streetZ - TOWN.streetWidth / 2 - 2.4 },
];

const roadside = buildRoadside(materials as never, collisions, trunks);
const houses = layoutHouses();

console.log(`пролётов ${roadside.runs}, штакетин ${roadside.pickets}, предметов ${roadside.props}, домов ${roadside.houses}`);
check(roadside.houses === houses.length, `у всех ${houses.length} домов посёлка есть калитка и номер`);
check(roadside.runs >= 8, `забор собран из ${roadside.runs} пролётов`);
check(roadside.pickets > 300, `${roadside.pickets} штакетин — забор читается, а не пунктир`);
check(roadside.props > 60, `на обочине ${roadside.props} предметов: калитки, ящики, кашпо, знаки, остановка`);

// Точки штакетника: берём из инстансов, а не из кода
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const pickets: Array<{ x: number; z: number }> = [];
const picketMeshes: THREE.InstancedMesh[] = [];
for (const child of roadside.group.children) {
  const mesh = child as THREE.InstancedMesh;
  if (!(mesh as THREE.InstancedMesh).isInstancedMesh) continue;
  picketMeshes.push(mesh);
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix);
    pickets.push({ x: position.x, z: position.z });
  }
}
check(picketMeshes.length === 2, 'штакетник — два InstancedMesh (высокие и низкие), а не сотни мешей');

const halfStreet = TOWN.streetWidth / 2;
const onRoad = pickets.filter((picket) => Math.abs(picket.z - TOWN.streetZ) < halfStreet + 0.9);
check(onRoad.length === 0, `на проезжей части забора нет (${onRoad.length})`);

const north = pickets.filter((picket) => picket.z < TOWN.streetZ);
const south = pickets.filter((picket) => picket.z > TOWN.streetZ);
check(north.length > 100 && south.length > 100, `забор с обеих сторон улицы: ${north.length} + ${south.length} штакетин`);

// Проёмы: ни одна штакетина не стоит ближе 1,1 м к стволу на линии забора
let throughTree = 0;
for (const trunk of trunks) {
  const near = pickets.filter(
    (picket) => Math.abs(picket.z - trunk.z) < 0.5 && Math.abs(picket.x - trunk.x) < 1.1,
  );
  throughTree += near.length;
}
check(throughTree === 0, `деревья не прорастают сквозь забор (${throughTree})`);

// Калитки: проём 2,7 м, значит у каждой калитки штакетин нет
let blockedGates = 0;
for (const house of houses) {
  const x = house.x + (house.pool ? (house.x >= 0 ? -1 : 1) * (house.width / 2 + 1.2) : 0);
  const z = TOWN.streetZ + (house.side === 'north' ? -1 : 1) * (halfStreet + 2.4);
  const inGap = pickets.filter((picket) => Math.abs(picket.z - z) < 0.5 && Math.abs(picket.x - x) < 1.2);
  if (inGap.length > 0) blockedGates += 1;
}
check(blockedGates === 0, `все калитки свободны: к дому можно пройти (${blockedGates} перекрыто)`);

// Препятствия: каждый пролёт — бокс столкновения высотой выше пояса
const fenceBoxes = boxes.filter((item) => item.top > 3.2 + 1.0 && item.maxZ - item.minZ < 0.4);
check(fenceBoxes.length === roadside.runs, `каждый пролёт — препятствие (${fenceBoxes.length} из ${roadside.runs})`);
check(boxes.length > 0 && circles.length > 0, `столкновения поставлены: ${boxes.length} боксов, ${circles.length} кругов`);

// Всё внутри острова
let outside = 0;
roadside.group.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  const point = new THREE.Vector3();
  mesh.getWorldPosition(point);
  const normalised = (point.x * point.x) / (ISLAND.radiusX * ISLAND.radiusX) + (point.z * point.z) / (ISLAND.radiusZ * ISLAND.radiusZ);
  if (normalised > 1) outside += 1;
});
check(outside === 0, `всё стоит на острове (${outside} предметов за кромкой)`);

// Атлас табличек один на все указатели и номера
const signMaterials = new Set<string>();
let signQuads = 0;
roadside.group.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  const material = mesh.material as THREE.Material;
  if (material.name === 'roadside-signs') {
    signMaterials.add(material.uuid);
    signQuads += 1;
  }
});
check(signMaterials.size === 1, `все таблички на одном материале (${signQuads} табличек)`);
check(signQuads >= 6, `табличек ${signQuads}: номера домов, переход, стадион, расписание`);

const named = ['roadside-crosswalk', 'roadside-shelter'];
for (const name of named) {
  const found = roadside.group.getObjectByName(name);
  check(Boolean(found), `${name === 'roadside-shelter' ? 'автобусная остановка' : 'пешеходный переход'} на месте`);
}

if (problems > 0) {
  console.log(`\nПроблем: ${problems}`);
  process.exitCode = 1;
} else {
  console.log('\nОбочина: забор, калитки, переход и остановка в порядке');
}
export const failed = problems;
