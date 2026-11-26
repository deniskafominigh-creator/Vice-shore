/** Оффлайн-аудит посёлка: строит геометрию домов без WebGL и прогоняет штатные
 *  проверки SceneAudit. Нужен для правок z-fighting, когда браузер недоступен. */
import * as THREE from 'three';
import { buildTown } from '../../src/world/island/Town';
import { auditScene } from '../../src/world/SceneAudit';

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
const mountains = new Proxy({} as Record<string, THREE.MeshStandardMaterial>, {
  get(_target, prop: string) {
    if (prop === 'dispose') return () => undefined;
    let material = materialCache.get(prop);
    if (!material) {
      material = new THREE.MeshStandardMaterial();
      material.name = prop;
      materialCache.set(prop, material);
    }
    return material;
  },
});

const collisions = new Proxy({} as Record<string, unknown>, {
  get(_target, prop: string) {
    if (prop === 'list') return () => [];
    if (prop === 'isBlocked') return () => false;
    if (prop === 'resolve') return (x: number, z: number) => ({ x, z });
    return () => undefined;
  },
});

const town = buildTown(mountains as never, collisions as never);
const root = new THREE.Object3D();
root.add(town.group);
root.updateMatrixWorld(true);

const report = auditScene({
  root,
  collisions: collisions as never,
  groundHeightAt: () => 3.2,
  bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
  exceptions: [],
} as never);

const zfight = report.findings.filter((f) => f.kind === 'z-fight');
const groups = new Map<string, string[]>();
for (const f of zfight) {
  const axis = /по (X|Y|Z)(min|max)/.exec(f.detail)?.[0] ?? '?';
  if (!groups.has(axis)) groups.set(axis, []);
  groups.get(axis)!.push(`${f.objects[0]} ⟷ ${f.objects[1]} (${f.detail})`);
}
console.log(`всего z-fight: ${zfight.length}, предметов: ${town.objectCount}`);
for (const [axis, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n===== ${axis}: ${list.length} =====`);
  for (const line of list.slice(0, 6)) console.log('  ' + line);
}
