/** Оффлайн-аудит всей сцены без WebGL: строит модули мира с заглушками
 *  материалов и прогоняет штатные проверки SceneAudit по каждому модулю. */
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
import { auditScene } from '../../src/world/SceneAudit';

/** Минимальный DOM для CanvasTexture и маски покраски (WebGL не нужен). */
const makeCanvas = (): Record<string, unknown> => {
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (prop === 'canvas') return canvas;
      return () => 0;
    },
    set() { return true; },
  });
  const canvas: Record<string, unknown> = {
    width: 8,
    height: 8,
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
  body: { appendChild: () => undefined },
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
const modules: Array<[string, THREE.Object3D]> = [];
const villa = buildVilla(m, c);
modules.push(['villa', villa.group]);
modules.push(['interior', buildInterior(m, villa.interior, villa.floorY, c)]);
modules.push(['renovation', buildRenovation(m, villa.interior, villa.floorY, c) as unknown as THREE.Object3D]);
modules.push(['court', buildCourt(m, c).group]);
modules.push(['vegetation', buildVegetation(m, c).group]);
modules.push(['ground', buildGround(m)]);
modules.push(['fence', buildFence(m, c)]);
modules.push(['props', buildProps(m)]);
modules.push(['distantShore', buildDistantShore()]);
modules.push(['town', buildTown(m, c).group]);

let total = 0;
for (const [name, node] of modules) {
  const root = new THREE.Object3D();
  root.add(node);
  root.updateMatrixWorld(true);
  const report = auditScene({
    root,
    collisions: c,
    groundHeightAt: () => 3.2,
    bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 },
  } as never);
  const zfight = report.findings.filter((f) => f.kind === 'z-fight');
  total += zfight.length;
  console.log(`${name.padEnd(14)} z-fight: ${String(zfight.length).padStart(3)}`);
  for (const f of zfight.slice(0, 4)) {
    console.log(`   ${f.detail} | ${f.objects[0]} ⟷ ${f.objects[1]}`);
  }
}
console.log(`ИТОГО z-fight по сцене: ${total}`);
export const zfightTotal = total;
