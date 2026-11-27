/** Карта свободного места на плато: печатает ASCII-сетку, где занято домами,
 *  дорожками, улицей, стадионом и виллой. Нужна, чтобы детали (задача 21) не
 *  вставали в стену и не падали в море. */
import * as THREE from 'three';
import { ISLAND, PLOT, TERRACE } from '../../src/core/Config';
import { buildTown } from '../../src/world/island/Town';
import { buildStadium } from '../../src/world/island/Stadium';
import { createIslandMaterials } from '../../src/world/island/IslandTextures';
import { CollisionWorld } from '../../src/world/Colliders';

const makeCanvas = (): Record<string, unknown> => {
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'getImageData') return (x: number, y: number, w = 4, h = 4) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
      if (prop === 'canvas') return canvas;
      return () => 0;
    },
    set() { return true; },
  });
  const canvas: Record<string, unknown> = {
    width: 256, height: 256, style: {}, getContext: () => ctx, toDataURL: () => 'data:,',
    addEventListener: () => undefined, removeEventListener: () => undefined,
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
void THREE; void TERRACE;

const rects = [
  ...town.occupied,
  ...stadium.clearings,
  { minX: PLOT.fenceMinX, maxX: PLOT.fenceMaxX, minZ: PLOT.fenceMinZ, maxZ: PLOT.fenceMaxZ },
];
const inside = (x: number, z: number): boolean => rects.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
const inPlateau = (x: number, z: number): boolean => (x / ISLAND.radiusX) ** 2 + (z / ISLAND.radiusZ) ** 2 < 0.86;

const step = 4;
let header = '     ';
for (let x = -ISLAND.radiusX; x <= ISLAND.radiusX; x += step) header += Math.abs(x) % 20 < step ? '|' : ' ';
console.log(header);
for (let z = -ISLAND.radiusZ; z <= ISLAND.radiusZ; z += step) {
  let line = `${z.toFixed(0).padStart(4)} `;
  for (let x = -ISLAND.radiusX; x <= ISLAND.radiusX; x += step) {
    if (!inPlateau(x, z)) line += ' ';
    else if (inside(x, z)) line += '#';
    else line += '.';
  }
  console.log(line);
}
console.log('клетка 4 м · # занято (дома/дорожки/улица/стадион/вилла) · . свободно');
