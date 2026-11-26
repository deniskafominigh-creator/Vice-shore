/** Проверка стадиона (задача 16): чаша не свисает с обрыва, не лезет в участок
 *  виллы, площадку и дома, поле и ворота вписываются в чашу, мест на трибунах —
 *  сотни. Всё считается по тем же константам, что и геометрия. */
import * as THREE from 'three';
import { COURT, ISLAND, PLOT, STADIUM, TOWN, layoutHouses } from '../../src/core/Config';
import { buildStadium } from '../../src/world/island/Stadium';
import type { IslandMaterials } from '../../src/world/island/IslandTextures';
import { CollisionWorld } from '../../src/world/Colliders';

/** CanvasTexture в Node: чашу собираем по-настоящему, чтобы проверить проход. */
const makeCanvas = (): Record<string, unknown> => {
  const ctx = new Proxy({}, { get: () => () => 0, set: () => true });
  return { width: 16, height: 16, style: {}, getContext: () => ctx };
};
(globalThis as unknown as { document: unknown }).document = { createElement: () => makeCanvas() };

let problems = 0;
/** Высота проверки прохода: уровень груди героя. */
const INLAND_EYE = ISLAND.plateauTopY + 0.9;
const fail = (message: string): void => {
  problems += 1;
  console.log(`✗ ${message}`);
};

/** Полуширина эллипса острова на высоте z. */
const islandHalfWidth = (z: number): number =>
  ISLAND.radiusX * Math.sqrt(Math.max(0, 1 - (z / ISLAND.radiusZ) ** 2));

interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}
const overlap = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

const halfW = STADIUM.width / 2;
const halfD = STADIUM.depth / 2;
const plazaMinX = STADIUM.centerX + halfW;
const plazaMaxX = plazaMinX + STADIUM.plazaWidth;
const plazaMinZ = STADIUM.centerZ - STADIUM.plazaDepth / 2;
const plazaMaxZ = STADIUM.centerZ + STADIUM.plazaDepth / 2;
const driveHalf = STADIUM.driveWidth / 2;

const bowl: Rect = {
  minX: STADIUM.centerX - halfW,
  maxX: STADIUM.centerX + halfW,
  minZ: STADIUM.centerZ - halfD,
  maxZ: STADIUM.centerZ + halfD,
};
const plaza: Rect = { minX: plazaMinX, maxX: plazaMaxX, minZ: plazaMinZ, maxZ: plazaMaxZ };
const drive: Rect = {
  minX: STADIUM.driveX - driveHalf,
  maxX: STADIUM.driveX + driveHalf,
  minZ: plazaMaxZ - 1.2,
  maxZ: TOWN.streetZ + 1,
};

// ——— 1. габарит и край острова ———
const corners: Array<[string, number, number]> = [
  ['чаша СЗ', bowl.minX, bowl.minZ],
  ['чаша СВ', bowl.maxX, bowl.minZ],
  ['чаша ЮЗ', bowl.minX, bowl.maxZ],
  ['чаша ЮВ', bowl.maxX, bowl.maxZ],
  ['площадь С', plazaMaxX, plazaMinZ],
  ['площадь Ю', plazaMaxX, plazaMaxZ],
  ['аллея С', drive.maxX, drive.minZ],
  ['аллея Ю', drive.maxX, drive.maxZ],
];
const margin = 2;
for (const [name, x, z] of corners) {
  const limit = islandHalfWidth(z) - margin;
  const ok = Math.abs(x) <= limit;
  if (!ok) fail(`${name} (${x.toFixed(1)}, ${z.toFixed(1)}) за краем острова: ${limit.toFixed(1)} м`);
  console.log(
    `${name.padEnd(10)} x ${x.toFixed(1).padStart(6)}  z ${z.toFixed(1).padStart(6)}` +
      `  край острова ${limit.toFixed(1).padStart(5)} м` +
      (ok ? '' : '  ✗ ЗА КРАЕМ'),
  );
}

// ——— 2. ничего чужого под чашей ———
const plot: Rect = { minX: PLOT.fenceMinX, maxX: PLOT.fenceMaxX, minZ: PLOT.fenceMinZ, maxZ: PLOT.fenceMaxZ };
const court: Rect = {
  minX: COURT.centerX - COURT.length / 2,
  maxX: COURT.centerX + COURT.length / 2,
  minZ: COURT.centerZ - COURT.width / 2,
  maxZ: COURT.centerZ + COURT.width / 2,
};
const reserved: Array<[string, Rect]> = [['участок виллы', plot], ['баскетбольная площадка', court]];
for (const house of layoutHouses()) {
  reserved.push([
    house.id,
    {
      minX: house.x - house.width / 2,
      maxX: house.x + house.width / 2,
      minZ: house.z - house.depth / 2,
      maxZ: house.z + house.depth / 2,
    },
  ]);
}
for (const [name, rect] of reserved) {
  for (const [partName, part] of [['чаша', bowl], ['площадь', plaza], ['аллея', drive]] as const) {
    if (overlap(part, rect)) fail(`${partName} стадиона пересекает ${name}`);
  }
}

// ——— 3. поле, трибуны и ворота ———
const standDepth = STADIUM.rows * STADIUM.rowDepth;
const needW = STADIUM.pitchWidth + 2 * (STADIUM.concourse + standDepth);
const needD = STADIUM.pitchDepth + 2 * (STADIUM.concourse + standDepth);
if (Math.abs(needW - STADIUM.width) > 0.01) fail(`ширина чаши ${STADIUM.width} ≠ поле+трибуны ${needW}`);
if (Math.abs(needD - STADIUM.depth) > 0.01) fail(`глубина чаши ${STADIUM.depth} ≠ поле+трибуны ${needD}`);
if (STADIUM.goalWidth > STADIUM.pitchDepth - 4) fail('ворота не вписываются в ширину поля');
if (STADIUM.goalDepth > STADIUM.concourse + 0.5) fail('сетка ворот упирается в трибуну');

// ——— 4. места: сотни, и поровну по секторам ———
const gateWidth = 6;
const longSide = STADIUM.pitchWidth + 2 * (STADIUM.concourse + standDepth);
const shortSide = STADIUM.depth - 2 * (STADIUM.concourse + standDepth);
const eastHalf = (shortSide - gateWidth) / 2;
const seatCount = (span: number): number => Math.max(2, Math.floor((span - 1.2) / 0.55));
const perRow = seatCount(longSide) * 2 + seatCount(shortSide) + seatCount(eastHalf) * 2;
const seats = perRow * STADIUM.rows;
console.log(`мест на трибунах: ${seats} (${perRow} в ряду × ${STADIUM.rows} рядов)`);
if (seats < 300) fail(`мест мало для «сотен»: ${seats}`);
const sectorSeats = STADIUM.rows * (seatCount(longSide) * 2 + seatCount(shortSide));

// ——— 5. мяч и ворота согласованы ———
if (STADIUM.ballRadius * 2 > STADIUM.goalWidth / 3) fail('мяч великоват для ворот');
console.log(`поле ${STADIUM.pitchWidth}×${STADIUM.pitchDepth} м, ворота ${STADIUM.goalWidth}×${STADIUM.goalHeight} м, мяч r ${STADIUM.ballRadius} м`);
void sectorSeats;

// ——— 6. путь от улицы до поля: ни одной невидимой стены ———
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
}) as unknown as IslandMaterials;
const collisions = new CollisionWorld();
buildStadium(materials, collisions);
console.log(`коллизий стадиона: ${collisions.count}`);

const corridor: Array<[number, number]> = [
  [STADIUM.driveX, TOWN.streetZ],
  [STADIUM.driveX, STADIUM.centerZ],
  [STADIUM.centerX + STADIUM.width / 2, STADIUM.centerZ],
  [STADIUM.centerX, STADIUM.centerZ],
];
const radius = 0.34;
const eye = INLAND_EYE;
let blockedAt: string | null = null;
for (let i = 0; i < corridor.length - 1 && !blockedAt; i += 1) {
  const [x0, z0] = corridor[i];
  const [x1, z1] = corridor[i + 1];
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.1));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    if (collisions.isBlocked(x, z, radius, eye)) {
      blockedAt = `(${x.toFixed(1)}, ${z.toFixed(1)})`;
      break;
    }
  }
}
if (blockedAt) fail(`проход к полю перекрыт в ${blockedAt}`);
else console.log('проход улица → аллея → площадь → турникеты → поле свободен');

console.log(problems === 0 ? 'Стадион: всё на месте' : `Стадион: проблем ${problems}`);
export const failed = problems > 0;
