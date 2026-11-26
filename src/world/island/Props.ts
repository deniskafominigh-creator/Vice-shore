import * as THREE from 'three';
import { PLOT, TERRACE, VILLA } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';

/** Мелкий декор участка: лежаки, зонт, горшки, фонари на дорожке.
 *  Наполняет кадр «жизнью» и задаёт масштаб, как на референсе. */

export function buildProps(materials: IslandMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  const top = TERRACE.deckTopY;
  const front = VILLA.centerZ + VILLA.depth / 2;
  const terraceY = top + 0.41;

  // ——— лежаки на террасе ———
  for (const offset of [-5.6, -3.4]) {
    const lounger = new THREE.Group();
    lounger.name = 'lounger';
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.36, 1.9), materials.wood);
    frame.position.y = 0.18;
    frame.castShadow = true;
    lounger.add(frame);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 1.5), materials.cushion);
    seat.position.set(0, 0.4, 0.12);
    seat.castShadow = true;
    lounger.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.9, 0.1), materials.cushion);
    back.position.set(0, 0.72, -0.66);
    back.rotation.x = -0.42;
    back.castShadow = true;
    lounger.add(back);
    lounger.position.set(offset, terraceY, front + 2.4);
    group.add(lounger);
  }

  // Полотенца на лежаках — мелочь, которая делает кадр живым
  for (const offset of [-5.6, -3.4]) {
    const towel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.7), offset < -4 ? materials.fabricTeal : materials.magenta);
    towel.position.set(offset, terraceY + 0.45, front + 2.35);
    towel.rotation.y = 0.12;
    towel.castShadow = true;
    group.add(towel);
  }

  // ——— почтовый ящик у калитки ———
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.05, 0.09), materials.trim);
  post.position.set(PLOT.gateWidth / 2 + 1.15, top + 0.52, PLOT.fenceMaxZ + 0.5);
  post.castShadow = true;
  group.add(post);
  const boxBody = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.42), materials.metal);
  boxBody.position.set(PLOT.gateWidth / 2 + 1.15, top + 1.16, PLOT.fenceMaxZ + 0.5);
  boxBody.castShadow = true;
  group.add(boxBody);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.09), materials.terracotta);
  flag.position.set(PLOT.gateWidth / 2 + 1.29, top + 1.22, PLOT.fenceMaxZ + 0.62);
  group.add(flag);

  // ——— зонт ———
  // Высота подобрана под балки перголы (низ 6.245 м): полотно зонта проходит под ними
  // с зазором 0.26 м — иначе два меша оказываются в одном объёме (задача 10).
  const umbrellaPole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.0, 10), materials.metal);
  umbrellaPole.position.set(-4.5, terraceY + 1.0, front + 1.5);
  umbrellaPole.castShadow = true;
  group.add(umbrellaPole);
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.75, 14, 1, true), materials.cushion);
  canopy.position.set(-4.5, terraceY + 2.0, front + 1.5);
  canopy.castShadow = true;
  group.add(canopy);

  // ——— горшки с растениями ———
  const potSpots: [number, number][] = [
    [VILLA.centerX + 4.9, front + 0.9],
    [VILLA.centerX - 7.3, front + 0.9],
    [2.8, 10.8],
    [-2.8, 10.8],
  ];
  for (const [x, z] of potSpots) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.62, 14), materials.terracotta);
    pot.position.set(x, top + 0.31, z);
    pot.castShadow = true;
    pot.receiveShadow = true;
    group.add(pot);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.52, 1), materials.foliage);
    bush.position.set(x, top + 0.95, z);
    bush.scale.set(1, 1.25, 1);
    bush.castShadow = true;
    group.add(bush);
  }

  // ——— фонари вдоль дорожки ———
  for (const z of [8.6, 4.6, 0.4]) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.05, 10), materials.white);
      post.position.set(side * 2.15, top + 0.52, z);
      post.castShadow = true;
      group.add(post);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.105, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe6b0, emissiveIntensity: 0.55, roughness: 0.6 }),
      );
      lamp.position.set(side * 2.15, top + 1.1, z);
      group.add(lamp);
    }
  }

  return group;
}

/** Дальний берег на горизонте: пологие холмы в дымке — глубина кадра. */
export function buildDistantShore(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'distant-shore';
  const material = new THREE.MeshBasicMaterial({ color: 0x8fb4c4, transparent: true, opacity: 0.75 });
  const deepMaterial = new THREE.MeshBasicMaterial({ color: 0x7aa2b4, transparent: true, opacity: 0.6 });

  const ridges: { x: number; z: number; scale: number; material: THREE.Material }[] = [
    { x: -420, z: -1250, scale: 320, material },
    { x: 180, z: -1420, scale: 420, material: deepMaterial },
    { x: 760, z: -1180, scale: 260, material },
    { x: -980, z: -1080, scale: 240, material: deepMaterial },
  ];

  for (const ridge of ridges) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), ridge.material);
    hill.position.set(ridge.x, -6, ridge.z);
    hill.scale.set(ridge.scale, ridge.scale * 0.075, ridge.scale * 0.35);
    group.add(hill);
  }

  return group;
}
