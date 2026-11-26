import * as THREE from 'three';
import { COURT, ISLAND, PALETTE, PLOT, TERRACE, VILLA } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';
import type { CollisionWorld } from '../Colliders';

/** Растительность: пальмы с качающимися листьями, кусты, агавы и бугенвиллия.
 *  Всё процедурное, инстансами — референс задаёт плотный «райский» сад. */

export interface VegetationResult {
  readonly group: THREE.Group;
  update(time: number): void;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Ветер: общий юниформ, подмешивается в вершинный шейдер. */
function withWind(material: THREE.MeshStandardMaterial, uniforms: { uTime: THREE.IUniform<number> }, amount: number, stretched: boolean): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         vec3 instanceOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
       #else
         vec3 instanceOrigin = vec3(0.0);
       #endif
       float windPhase = uTime * 1.35 + instanceOrigin.x * 0.45 + instanceOrigin.z * 0.35;
       float windWeight = ${stretched ? 'clamp(transformed.x * 0.55, 0.0, 1.4)' : '0.35'};
       transformed.x += sin(windPhase) * ${amount.toFixed(3)} * windWeight;
       transformed.z += cos(windPhase * 0.8) * ${(amount * 0.6).toFixed(3)} * windWeight;`,
    );
  };
  material.customProgramCacheKey = () => `wind-${amount}-${stretched}`;
}

/** Изгиб ствола: смещение по x пропорционально квадрату высоты. */
function bendTrunk(geometry: THREE.BufferGeometry, lean: THREE.Vector2, height: number): void {
  const position = geometry.attributes.position;
  if (!position) return;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const t = (y + height / 2) / height;
    position.setX(i, position.getX(i) + lean.x * t * t);
    position.setZ(i, position.getZ(i) + lean.y * t * t);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createFrondGeometry(): THREE.BufferGeometry {
  const length = 3.1;
  const width = 0.95;
  const geometry = new THREE.PlaneGeometry(length, width, 14, 2).rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  if (position) {
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const normalised = (x + length / 2) / length; // 0 у ствола, 1 на кончике
      const droop = -Math.pow(normalised, 2.2) * 1.5;
      position.setY(i, droop);
      position.setX(i, x + length / 2); // начало листа — в нуле
      position.setZ(i, position.getZ(i) * (1 - normalised * 0.35));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** Куст: сплюснутый шар с неровной поверхностью — не «идеальный глобус». */
function blobGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.attributes.position;
  if (!position) return geometry;
  const random = seeded(seed);
  const offsets = [random() * 6.28, random() * 6.28, random() * 6.28];
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const noise =
      Math.sin(vertex.x * 2.6 + offsets[0]) * 0.5 +
      Math.sin(vertex.y * 3.1 + offsets[1]) * 0.3 +
      Math.sin(vertex.z * 2.2 + offsets[2]) * 0.2;
    vertex.multiplyScalar(1 + noise * 0.22);
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

interface PalmSpec {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly lean: THREE.Vector2;
}

const PALMS: PalmSpec[] = [
  { x: -11.2, z: 7.4, height: 7.6, lean: new THREE.Vector2(0.9, -0.5) },
  { x: -8.8, z: -1.2, height: 6.4, lean: new THREE.Vector2(-0.7, 0.6) },
  { x: 10.8, z: 7.9, height: 8.2, lean: new THREE.Vector2(-1.2, -0.4) },
  { x: 11.4, z: -1.8, height: 6.9, lean: new THREE.Vector2(0.6, 0.7) },
  { x: -13.4, z: -9.8, height: 7.1, lean: new THREE.Vector2(0.5, 0.9) },
  { x: 13.6, z: -12.8, height: 8.6, lean: new THREE.Vector2(-0.8, 0.3) },
  { x: 4.2, z: 9.2, height: 5.8, lean: new THREE.Vector2(-0.4, -0.8) },
  { x: 16.6, z: 15.4, height: 7.2, lean: new THREE.Vector2(-1.0, 0.5) },
  { x: -17.2, z: 15.0, height: 7.8, lean: new THREE.Vector2(0.8, 0.6) },
  { x: -19.4, z: 13.2, height: 6.2, lean: new THREE.Vector2(1.0, -0.3) },
];

/** Точки посадки кустов: вне дорожки, дома и террасы. */
function shrubPositions(count: number): THREE.Vector3[] {
  const random = seeded(7);
  const points: THREE.Vector3[] = [];
  const villaRect = new THREE.Box2(
    new THREE.Vector2(VILLA.centerX - VILLA.width / 2 - 1.2, VILLA.centerZ - VILLA.depth / 2 - 1.2),
    new THREE.Vector2(VILLA.centerX + VILLA.width / 2 + 1.2, VILLA.centerZ + VILLA.depth / 2 + VILLA.terraceDepth + 1.0),
  );
  let guard = 0;
  while (points.length < count && guard < count * 60) {
    guard += 1;
    const x = PLOT.fenceMinX + 1.2 + random() * (PLOT.fenceMaxX - PLOT.fenceMinX - 2.4);
    const z = PLOT.fenceMinZ + 1.2 + random() * (PLOT.fenceMaxZ - PLOT.fenceMinZ - 2.4);
    // Коридор дорожки и место перед домом — свободны
    if (Math.abs(x) < PLOT.pathWidth / 2 + 1.6 && z > VILLA.centerZ + 2) continue;
    if (villaRect.containsPoint(new THREE.Vector2(x, z))) continue;
    // Растения вдоль забора — плотнее, в центре газона — реже
    const edge = Math.min(x - PLOT.fenceMinX, PLOT.fenceMaxX - x, z - PLOT.fenceMinZ, PLOT.fenceMaxZ - z);
    if (edge > 5.5 && random() > 0.35) continue;
    if (Math.abs(x - COURT.centerX) < COURT.length / 2 + 2.5 && Math.abs(z - COURT.centerZ) < COURT.width / 2 + 2.5) continue;
    if (points.some((point) => point.distanceTo(new THREE.Vector3(x, 0, z)) < 2.1)) continue;
    points.push(new THREE.Vector3(x, 0, z));
  }
  return points;
}

export function buildVegetation(materials: IslandMaterials, collisions: CollisionWorld): VegetationResult {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const top = TERRACE.deckTopY;
  const uniforms = { uTime: { value: 0 } };
  const dummy = new THREE.Object3D();

  // ——— стволы пальм ———
  const trunkMaterial = materials.wood.clone();
  trunkMaterial.map = materials.wood.map?.clone() ?? null;
  if (trunkMaterial.map) {
    trunkMaterial.map.repeat.set(1, 6);
    trunkMaterial.map.needsUpdate = true;
  }
  trunkMaterial.color = new THREE.Color(0xb9a389);

  const crownPoints: THREE.Vector3[] = [];
  for (const palm of PALMS) {
    collisions.addCircle(palm.x + palm.lean.x * 0.35, palm.z + palm.lean.y * 0.35, 0.3, top + palm.height);
    const geometry = new THREE.CylinderGeometry(0.12, 0.23, palm.height, 9, 10, false);
    bendTrunk(geometry, palm.lean, palm.height);
    const trunk = new THREE.Mesh(geometry, trunkMaterial);
    trunk.position.set(palm.x, top + palm.height / 2, palm.z);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);
    crownPoints.push(new THREE.Vector3(palm.x + palm.lean.x, top + palm.height, palm.z + palm.lean.y));
  }

  // ——— листья: один инстанс-меш на все пальмы ———
  const frondMaterial = materials.frond.clone();
  withWind(frondMaterial, uniforms, 0.16, true);
  const frondsPerPalm = 17;
  const fronds = new THREE.InstancedMesh(createFrondGeometry(), frondMaterial, crownPoints.length * frondsPerPalm);
  fronds.castShadow = true;
  fronds.receiveShadow = true;
  fronds.name = 'palm-fronds';
  const random = seeded(31);
  let frondIndex = 0;
  crownPoints.forEach((crown, palmIndex) => {
    for (let i = 0; i < frondsPerPalm; i += 1) {
      const angle = (i / frondsPerPalm) * Math.PI * 2 + palmIndex * 0.7;
      const droop = i < 5 ? -0.62 : 0.05 + random() * 0.62;
      dummy.position.copy(crown);
      dummy.rotation.set(0, angle, 0);
      dummy.rotateZ(droop);
      const scale = 0.92 + random() * 0.4;
      dummy.scale.set(scale, scale * (0.9 + random() * 0.2), scale);
      dummy.updateMatrix();
      fronds.setMatrixAt(frondIndex, dummy.matrix);
      frondIndex += 1;
    }
  });
  group.add(fronds);

  // Плоды-кокосы под кроной
  const coconutGeometry = new THREE.IcosahedronGeometry(0.14, 0);
  const coconuts = new THREE.InstancedMesh(coconutGeometry, materials.terracotta, crownPoints.length * 4);
  crownPoints.forEach((crown, palmIndex) => {
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + palmIndex;
      dummy.position.set(crown.x + Math.cos(angle) * 0.22, crown.y - 0.28 - (i % 2) * 0.1, crown.z + Math.sin(angle) * 0.22);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      coconuts.setMatrixAt(palmIndex * 4 + i, dummy.matrix);
    }
  });
  group.add(coconuts);

  // ——— кусты ———
  const shrubMaterial = materials.foliage.clone();
  withWind(shrubMaterial, uniforms, 0.05, false);
  const shrubPoints = shrubPositions(46);
  const shrubGeometry = blobGeometry(13, 2);
  const shrubs = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, shrubPoints.length * 3);
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  shrubs.name = 'shrubs';
  const shrubTint = new THREE.Color();
  let shrubIndex = 0;
  for (const point of shrubPoints) {
    const radius = 0.28 + random() * 0.34;
    const lobes = 2 + Math.floor(random() * 2);
    for (let layer = 0; layer < 3; layer += 1) {
      if (layer > lobes) {
        dummy.scale.setScalar(0.0001);
        dummy.position.set(point.x, top, point.z);
        dummy.updateMatrix();
        shrubs.setMatrixAt(shrubIndex, dummy.matrix);
        shrubIndex += 1;
        continue;
      }
      const scale = radius * (layer === 0 ? 1 : 0.55 + random() * 0.3);
      const spread = layer === 0 ? 0 : radius * 1.1;
      dummy.position.set(
        point.x + (random() - 0.5) * spread,
        top + scale * 0.62,
        point.z + (random() - 0.5) * spread,
      );
      dummy.rotation.set(random() * 0.4, random() * 3, random() * 0.4);
      dummy.scale.set(scale * (0.9 + random() * 0.4), scale * (0.62 + random() * 0.3), scale * (0.9 + random() * 0.4));
      dummy.updateMatrix();
      shrubs.setMatrixAt(shrubIndex, dummy.matrix);
      shrubTint.setHSL(0.26 + random() * 0.06, 0.42 + random() * 0.2, 0.42 + random() * 0.16);
      shrubs.setColorAt(shrubIndex, shrubTint);
      shrubIndex += 1;
    }
  }
  group.add(shrubs);

  // ——— агавы: розетки узких листьев ———
  const leafGeometry = new THREE.ConeGeometry(0.1, 1.15, 4, 1);
  leafGeometry.translate(0, 0.57, 0);
  const agavePositions = [
    [-5.2, 3.4],
    [5.4, 2.2],
    [-7.6, -3.6],
    [7.2, -4.2],
    [-14.2, 1.2],
    [14.4, 3.6],
    [2.6, -2.4],
    [-3.4, -3.0],
  ] as const;
  const agaveMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.agave, roughness: 0.72, metalness: 0 });
  const agaves = new THREE.InstancedMesh(leafGeometry, agaveMaterial, agavePositions.length * 9);
  agaves.castShadow = true;
  let agaveIndex = 0;
  for (const [x, z] of agavePositions) {
    for (let i = 0; i < 9; i += 1) {
      const angle = (i / 9) * Math.PI * 2;
      dummy.position.set(x, top + 0.05, z);
      dummy.rotation.set(0, angle, 0.55 + random() * 0.3);
      dummy.scale.setScalar(0.5 + random() * 0.22);
      dummy.updateMatrix();
      agaves.setMatrixAt(agaveIndex, dummy.matrix);
      agaveIndex += 1;
    }
  }
  group.add(agaves);

  // ——— бугенвиллия: облака малиновых цветов у стен и забора ———
  const bougainvilleaSpots: [number, number, number][] = [
    [-7.9, -4.4, 1.5],
    [8.2, -5.0, 1.3],
    [-15.0, -12.4, 1.8],
    [15.0, 8.8, 1.4],
    [-4.6, 11.6, 1.2],
    [9.4, -13.2, 1.6],
  ];
  const flowerGeometry = new THREE.IcosahedronGeometry(0.19, 0);
  const flowersPerBush = 46;
  const flowers = new THREE.InstancedMesh(flowerGeometry, materials.magenta, bougainvilleaSpots.length * flowersPerBush);
  flowers.castShadow = true;
  let flowerIndex = 0;
  const greens: THREE.Matrix4[] = [];
  for (const [x, z, height] of bougainvilleaSpots) {
    const base = new THREE.Vector3(x, top, z);
    for (let i = 0; i < flowersPerBush; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.pow(random(), 0.6) * 0.95;
      const y = 0.35 + random() * height;
      const shrink = 1 - (y / height) * 0.35;
      dummy.position.set(base.x + Math.cos(angle) * radius * shrink, base.y + y, base.z + Math.sin(angle) * radius * shrink);
      dummy.rotation.set(random() * 3, random() * 3, random() * 3);
      dummy.scale.setScalar(0.6 + random() * 0.7);
      dummy.updateMatrix();
      flowers.setMatrixAt(flowerIndex, dummy.matrix);
      flowerIndex += 1;
    }
    // Зелёная основа-куст под цветами
    for (let i = 0; i < 6; i += 1) {
      dummy.position.set(base.x + (random() - 0.5) * 1.1, base.y + 0.3 + random() * height * 0.6, base.z + (random() - 0.5) * 1.1);
      dummy.rotation.set(random() * 3, random() * 3, random() * 3);
      dummy.scale.setScalar(0.7 + random() * 0.5);
      dummy.updateMatrix();
      greens.push(dummy.matrix.clone());
    }
  }
  group.add(flowers);

  const greenMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), shrubMaterial, greens.length);
  greenMesh.castShadow = true;
  greenMesh.receiveShadow = true;
  greens.forEach((matrix, index) => greenMesh.setMatrixAt(index, matrix));
  group.add(greenMesh);

  // Кусты вокруг площадки (вне забора, но на плато)
  const outerGeometry = blobGeometry(29, 1);
  const outer = new THREE.InstancedMesh(outerGeometry, shrubMaterial, 18);
  for (let i = 0; i < 18; i += 1) {
    const angle = (i / 18) * Math.PI * 2;
    const radiusX = COURT.length / 2 + 3.6 + random() * 1.8;
    const radiusZ = COURT.width / 2 + 3.6 + random() * 1.8;
    const x = COURT.centerX + Math.cos(angle) * radiusX;
    const z = COURT.centerZ + Math.sin(angle) * radiusZ;
    const insideIsland = (x * x) / (ISLAND.radiusX * ISLAND.radiusX) + (z * z) / (ISLAND.radiusZ * ISLAND.radiusZ) < 0.86;
    const scale = insideIsland ? 0.45 + random() * 0.35 : 0;
    dummy.position.set(x, top + scale * 0.55, z);
    dummy.rotation.set(random() * 0.5, random() * 3, random() * 0.5);
    dummy.scale.set(scale * 1.1, scale * 0.8, scale * 1.1);
    dummy.updateMatrix();
    outer.setMatrixAt(i, dummy.matrix);
  }
  group.add(outer);

  return {
    group,
    update(time: number): void {
      uniforms.uTime.value = time;
    },
  };
}
