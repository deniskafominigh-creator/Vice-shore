import * as THREE from 'three';
import { ISLAND, PLOT, TERRACE, VILLA } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';

/** Земля острова: плато с газоном, скала-обрыв, камни у воды, гравийная дорожка,
 *  ступени к террасе. Формы со скруглениями и неровной кромкой — как на референсе. */

function wobble(geometry: THREE.BufferGeometry, amount: number, seed = 1, onlyRim = true): void {
  const position = geometry.attributes.position;
  if (!position) return;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const radius = Math.hypot(vertex.x, vertex.z);
    if (onlyRim && radius < 0.92) continue;
    const angle = Math.atan2(vertex.z, vertex.x);
    const noise =
      Math.sin(angle * 5.3 + seed) * 0.5 + Math.sin(angle * 11.7 - seed * 2) * 0.3 + Math.sin(angle * 23.1 + seed) * 0.2;
    const scale = 1 + noise * amount;
    vertex.x *= scale;
    vertex.z *= scale;
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function buildGround(materials: IslandMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ground';
  const top = TERRACE.deckTopY;

  // ——— газон плато ———
  const lawn = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
  lawn.scale(ISLAND.radiusX, 1, ISLAND.radiusZ);
  wobble(lawn, 0.035, 2.1, true);
  const lawnMesh = new THREE.Mesh(lawn, materials.grass);
  lawnMesh.position.y = top;
  lawnMesh.receiveShadow = true;
  lawnMesh.name = 'lawn';
  group.add(lawnMesh);

  // ——— скала-обрыв до воды ———
  const cliffHeight = top - ISLAND.cliffBottomY;
  const cliff = new THREE.CylinderGeometry(1, 1.05, cliffHeight, 96, 10, true);
  cliff.scale(ISLAND.radiusX * 0.995, 1, ISLAND.radiusZ * 0.995);
  const position = cliff.attributes.position;
  if (position) {
    const vertex = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i);
      const angle = Math.atan2(vertex.z, vertex.x);
      const depth = (vertex.y + cliffHeight / 2) / cliffHeight;
      const noise =
        Math.sin(angle * 4.1 + 1.7) * 0.6 + Math.sin(angle * 9.3 - 2.1) * 0.3 + Math.sin(vertex.y * 0.9 + angle * 2.3) * 0.25;
      const bulge = 1 + noise * (0.03 + depth * 0.05);
      vertex.x *= bulge;
      vertex.z *= bulge;
      position.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    position.needsUpdate = true;
    cliff.computeVertexNormals();
  }
  const cliffMesh = new THREE.Mesh(cliff, materials.rock);
  cliffMesh.position.y = top - cliffHeight / 2 + 0.06;
  cliffMesh.receiveShadow = true;
  cliffMesh.castShadow = true;
  cliffMesh.name = 'cliff';
  group.add(cliffMesh);

  // ——— камни у воды ———
  const stoneGeometry = new THREE.IcosahedronGeometry(1, 1);
  const stoneCount = 16;
  const stones = new THREE.InstancedMesh(stoneGeometry, materials.shoreStone, stoneCount);
  stones.castShadow = true;
  stones.receiveShadow = true;
  stones.name = 'shore-rocks';
  const dummy = new THREE.Object3D();
  let seed = 5;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < stoneCount; i += 1) {
    const angle = (i / stoneCount) * Math.PI * 2 + random() * 0.18;
    const radius = 0.99 + random() * 0.05;
    const scale = 0.38 + random() * 0.42;
    dummy.position.set(
      Math.cos(angle) * ISLAND.radiusX * radius,
      -0.25 + random() * 0.7,
      Math.sin(angle) * ISLAND.radiusZ * radius,
    );
    dummy.rotation.set(random() * 3, random() * 3, random() * 3);
    dummy.scale.set(scale * 1.5, scale * 0.85, scale * 1.25);
    dummy.updateMatrix();
    stones.setMatrixAt(i, dummy.matrix);
  }
  group.add(stones);

  // ——— гравийная дорожка от калитки к дому ———
  const pathStartZ = PLOT.fenceMaxZ + 0.4;
  const pathEndZ = VILLA.centerZ + VILLA.depth / 2 + VILLA.terraceDepth + 0.2;
  const pathLength = pathStartZ - pathEndZ;
  const path = new THREE.PlaneGeometry(PLOT.pathWidth, pathLength).rotateX(-Math.PI / 2);
  const pathMesh = new THREE.Mesh(path, materials.gravel);
  pathMesh.position.set(0, top + 0.035, (pathStartZ + pathEndZ) / 2);
  pathMesh.receiveShadow = true;
  pathMesh.name = 'path';
  group.add(pathMesh);

  // Бордюр из камней по краям дорожки
  const borderGeometry = new THREE.BoxGeometry(0.17, 0.07, 0.34);
  const borderCount = Math.floor(pathLength / 0.55) * 2;
  const border = new THREE.InstancedMesh(borderGeometry, materials.shoreStone, borderCount);
  border.castShadow = true;
  border.receiveShadow = true;
  border.name = 'path-border';
  let index = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < borderCount / 2; i += 1) {
      dummy.position.set(side * (PLOT.pathWidth / 2 + 0.12), top + 0.03, pathStartZ - i * 0.55 - 0.28);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      if (index < borderCount) border.setMatrixAt(index, dummy.matrix);
      index += 1;
    }
  }
  group.add(border);

  // ——— ступени к террасе ———
  const stepCount = 3;
  for (let i = 0; i < stepCount; i += 1) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(5.4 + i * 0.5, 0.14, 0.42), materials.white);
    step.position.set(0, top + 0.07 + i * 0.02, pathEndZ - 0.3 - i * 0.42);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
  }

  return group;
}
