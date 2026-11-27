import * as THREE from 'three';
import { COURT, PLOT, TERRACE } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';
import type { CollisionWorld } from '../Colliders';

/** Белый деревянный штакетник по периметру участка — главный акцент с референса.
 *  Планки с острым верхом ставятся инстансами: 600+ штук за один вызов отрисовки. */

const PICKET_WIDTH = 0.09;
const PICKET_HEIGHT = 1.06;
const PICKET_DEPTH = 0.028;
const PICKET_STEP = 0.185;

function createPicketGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const half = PICKET_WIDTH / 2;
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(half, PICKET_HEIGHT - 0.11);
  shape.lineTo(0, PICKET_HEIGHT);
  shape.lineTo(-half, PICKET_HEIGHT - 0.11);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: PICKET_DEPTH, bevelEnabled: false, curveSegments: 1 });
  geometry.translate(0, 0, -PICKET_DEPTH / 2);
  return geometry;
}

interface Segment {
  readonly from: THREE.Vector2;
  readonly to: THREE.Vector2;
}

export function buildFence(materials: IslandMaterials, collisions: CollisionWorld): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fence';
  const top = TERRACE.deckTopY;
  const minX = PLOT.fenceMinX;
  const maxX = PLOT.fenceMaxX;
  const minZ = PLOT.fenceMinZ;
  const maxZ = PLOT.fenceMaxZ;
  const gateHalf = PLOT.gateWidth / 2;
  const sideGateHalf = PLOT.sideGateWidth / 2;

  // Разрыв на фронтальной стороне — калитка
  const segments: Segment[] = [
    { from: new THREE.Vector2(minX, maxZ), to: new THREE.Vector2(-gateHalf, maxZ) },
    { from: new THREE.Vector2(gateHalf, maxZ), to: new THREE.Vector2(maxX, maxZ) },
    { from: new THREE.Vector2(minX, minZ), to: new THREE.Vector2(maxX, minZ) },
    { from: new THREE.Vector2(minX, minZ), to: new THREE.Vector2(minX, COURT.centerZ - sideGateHalf) },
    { from: new THREE.Vector2(minX, COURT.centerZ + sideGateHalf), to: new THREE.Vector2(minX, maxZ) },
    { from: new THREE.Vector2(maxX, minZ), to: new THREE.Vector2(maxX, maxZ) },
  ];

  // Забор — препятствие: створки калитки распахнуты и в проём не мешают
  for (const segment of segments) {
    collisions.addBox(segment.from.x, segment.to.x, segment.from.y, segment.to.y, top + 1.3);
  }

  const dummy = new THREE.Object3D();
  const placements: { position: THREE.Vector3; rotation: number; tilt: number }[] = [];
  for (const segment of segments) {
    const length = segment.from.distanceTo(segment.to);
    const count = Math.max(1, Math.round(length / PICKET_STEP));
    const direction = new THREE.Vector2().subVectors(segment.to, segment.from).normalize();
    const rotation = Math.atan2(direction.y, direction.x);
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      const point = new THREE.Vector2().lerpVectors(segment.from, segment.to, t);
      placements.push({
        position: new THREE.Vector3(point.x, top, point.y),
        rotation: -rotation + Math.PI / 2,
        // Живой забор: каждая планка стоит чуть иначе, как на референсе
        tilt: (((i * 37) % 11) - 5) * 0.004,
      });
    }
  }

  const pickets = new THREE.InstancedMesh(createPicketGeometry(), materials.white, placements.length);
  pickets.castShadow = true;
  pickets.receiveShadow = true;
  pickets.name = 'pickets';
  placements.forEach((placement, index) => {
    dummy.position.copy(placement.position);
    dummy.rotation.set(placement.tilt, placement.rotation, placement.tilt * 0.6);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    pickets.setMatrixAt(index, dummy.matrix);
  });
  group.add(pickets);

  // Горизонтальные перекладины (две на пролёт) + столбы
  const railHeightA = 0.32;
  const railHeightB = 0.86;
  for (const segment of segments) {
    const length = segment.from.distanceTo(segment.to);
    const midX = (segment.from.x + segment.to.x) / 2;
    const midZ = (segment.from.y + segment.to.y) / 2;
    const horizontal = Math.abs(segment.from.y - segment.to.y) < 0.001;
    for (const height of [railHeightA, railHeightB]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(horizontal ? length : 0.05, 0.055, horizontal ? 0.05 : length),
        materials.white,
      );
      rail.position.set(midX, top + height, midZ);
      rail.castShadow = true;
      rail.receiveShadow = true;
      group.add(rail);
    }
  }

  // Столбы по углам и у калитки
  const postPositions: [number, number][] = [
    [minX, minZ],
    [maxX, minZ],
    [minX, maxZ],
    [maxX, maxZ],
    [-gateHalf, maxZ],
    [gateHalf, maxZ],
    [minX, (minZ + maxZ) / 2],
    [maxX, (minZ + maxZ) / 2],
    [minX, COURT.centerZ - sideGateHalf],
    [minX, COURT.centerZ + sideGateHalf],
  ];
  for (const [x, z] of postPositions) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.28, 0.13), materials.white);
    post.position.set(x, top + 0.64, z);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.19), materials.white);
    cap.position.set(x, top + 1.31, z);
    cap.castShadow = true;
    group.add(cap);
  }

  // ——— створки калитки: раскрыты внутрь, с петлями и щеколдой ———
  const leafWidth = gateHalf - 0.06;
  for (const side of [-1, 1] as const) {
    const leaf = new THREE.Group();
    const slats = Math.floor(leafWidth / PICKET_STEP);
    for (let i = 0; i < slats; i += 1) {
      const picket = new THREE.Mesh(createPicketGeometry(), materials.trim);
      picket.position.set(side * (i * PICKET_STEP + PICKET_STEP / 2), 0, 0);
      picket.castShadow = true;
      leaf.add(picket);
    }
    for (const height of [0.32, 0.86]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(leafWidth, 0.055, 0.05), materials.trim);
      rail.position.set(side * leafWidth / 2, height, -0.02);
      rail.castShadow = true;
      leaf.add(rail);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.06, 0.06), materials.trim);
    frame.position.set(side * (leafWidth - 0.03), 0.53, 0);
    leaf.add(frame);
    // Петли на столбе
    for (const height of [0.35, 0.9]) {
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), materials.metal);
      hinge.position.set(side * leafWidth, height, 0.03);
      leaf.add(hinge);
    }
    leaf.position.set(side * (gateHalf - 0.04), top, maxZ);
    // Створка распахнута внутрь участка
    leaf.rotation.y = side * 1.15;
    group.add(leaf);
  }
  // Щеколда на левой створке
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), materials.metal);
  latch.position.set(-0.12, top + 0.72, maxZ + 0.34);
  group.add(latch);

  return group;
}
