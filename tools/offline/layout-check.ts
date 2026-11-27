/** Проверка расстановки посёлка: дома по осям, вдоль улицы, внутри острова,
 *  цоколи не пересекаются, дорожки и клумбы не лезут в бассейны. */
import { ISLAND, TOWN, layoutHouses } from '../../src/core/Config';

const toDeg = (rad: number): string => `${Math.round((rad * 180) / Math.PI)}°`;
const northEdge = TOWN.streetZ - TOWN.streetWidth / 2;
const southEdge = TOWN.streetZ + TOWN.streetWidth / 2;
const rows: string[] = [];
let problems = 0;

const houses = layoutHouses();
for (const spec of houses) {
  const halfW = spec.width / 2;
  const halfD = spec.depth / 2;
  const faceZ = spec.z + Math.cos(spec.yaw) * halfD;
  const gap = spec.side === 'north' ? northEdge - faceZ : faceZ - southEdge;
  // край острова у самого дальнего угла дома (плюс 2 м запаса до обрыва)
  const worstZ = Math.max(Math.abs(spec.z - halfD), Math.abs(spec.z + halfD)) + 2;
  const limitX = ISLAND.radiusX * Math.sqrt(Math.max(0, 1 - (worstZ / ISLAND.radiusZ) ** 2));
  const outside = halfW + Math.abs(spec.x) > limitX;
  if (outside) problems += 1;
  if (Math.abs(gap - TOWN.frontGap) > 0.01) problems += 1;
  rows.push(
    `${spec.id.padEnd(9)} yaw ${toDeg(spec.yaw).padStart(4)}  x ${spec.x
      .toString()
      .padStart(4)}  z ${spec.z.toFixed(1).padStart(5)}  фасад→улица ${gap.toFixed(1)} м` +
      `  край острова ${limitX.toFixed(1)} м при |x|+полуширина ${(Math.abs(spec.x) + halfW).toFixed(1)}` +
      (outside ? '  ✗ ЗА КРАЕМ' : ''),
  );
}
console.log(rows.join('\n'));

// бассейн не должен залезать на дорогу
for (const spec of houses) {
  if (!spec.pool) continue;
  const poolZ = spec.z + Math.cos(spec.yaw) * (spec.depth / 2 + 6);
  const poolDepth = 2.3;
  const near = spec.side === 'north' ? poolZ + poolDepth / 2 + 0.4 : poolZ - poolDepth / 2 - 0.4;
  const clear = spec.side === 'north' ? northEdge - near : near - southEdge;
  if (clear < 0.4) {
    problems += 1;
    console.log(`✗ ${spec.id}: бассейн в ${clear.toFixed(2)} м от улицы`);
  }
}

// старый участок с виллой и площадкой: дома не должны в него лезть
const plot = { minX: -15.5, maxX: 15.5, minZ: -15.5, maxZ: 12.5 };
const court = { minX: -29, maxX: -16, minZ: -0.5, maxZ: 8.5 };
for (const spec of houses) {
  for (const [name, rect] of [['участок виллы', plot], ['площадка', court]] as const) {
    const hit =
      spec.x + spec.width / 2 > rect.minX &&
      spec.x - spec.width / 2 < rect.maxX &&
      spec.z + spec.depth / 2 > rect.minZ &&
      spec.z - spec.depth / 2 < rect.maxZ;
    if (hit) {
      problems += 1;
      console.log(`✗ ${spec.id} пересекает ${name}`);
    }
  }
}

// цоколи не должны пересекаться
for (let i = 0; i < houses.length; i += 1) {
  for (let j = i + 1; j < houses.length; j += 1) {
    const a = houses[i];
    const b = houses[j];
    const overlap =
      Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 4 &&
      Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 + 4;
    if (overlap) {
      problems += 1;
      console.log(`✗ ${a.id} и ${b.id} ближе 4 м друг к другу`);
    }
  }
}
console.log(problems === 0 ? 'Расстановка: конфликтов нет' : `Расстановка: конфликтов ${problems}`);
export const failed = problems > 0;
