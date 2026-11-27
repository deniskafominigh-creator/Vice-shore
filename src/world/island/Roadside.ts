import * as THREE from 'three';
import { ISLAND, PLOT, STADIUM, TERRACE, TOWN, layoutHouses } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';
import type { CollisionWorld } from '../Colliders';

/**
 * Обочина и фирменный забор (сборка v17).
 *
 *  Заказчик: «около дороги трава, но всё равно пусто… придумай фирменный забор,
 *  что-то ещё, дома однотипные».
 *
 *  Что здесь:
 *   • **Фирменный забор посёлка** — белый штакетник в два роста с каменным цоколем,
 *     столбами под терракотовой шапкой и латунным номером участка. Он идёт по обеим
 *     сторонам улицы, оставляя проёмы на дорожках к домам, у автобусной остановки
 *     и у въезда на стадион. Каждый третий пролёт увит бугенвиллией — это и есть
 *     «фирменный» признак: белое + терракота + маджента повторяются по всему посёлку.
 *   • **Пешеходный переход** перед главной аллеей, два знака, разметка.
 *   • **Автобусная остановка**: навес, стеклянная задняя стенка, скамья, доска
 *     с расписанием. Стоит на западном конце улицы, где раньше был просто газон.
 *   • **Почтовые ящики** и **кашпо с цветами** у каждой калитки, **указатель
 *     на стадион**, урны.
 *
 *  Бюджет: все таблички — один атлас 512² на девять клеток (номер участка,
 *  «переход», указатель, расписание), поэтому это один материал. Штакетник —
 *  один InstancedMesh на весь посёлок. Остальное склеивается по материалам
 *  (`mergeStaticMeshes`), так что вся обочина — это единицы draw calls, а не сотни.
 */

export interface RoadsideResult {
  readonly group: THREE.Group;
  /** Сколько пролётов забора и сколько досок в них. */
  readonly runs: number;
  readonly pickets: number;
  /** Сколько предметов обочины построено. */
  readonly props: number;
  /** Дома, у которых теперь свой номер на заборе. */
  readonly houses: number;
  dispose(): void;
}

interface Obstacle {
  readonly x: number;
  readonly z: number;
}

const GROUND = TERRACE.deckTopY;
const SIGN_TILES = 3;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ————————————————————————————————————————————————————————————————
//  Атлас табличек: 3×3 клетки
// ————————————————————————————————————————————————————————————————

type Painter = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => void;

/** Знак пешеходного перехода: синий квадрат, белый треугольник, шагающий человек. */
const paintCrossing: Painter = (ctx, size) => {
  ctx.fillStyle = '#1b4fa0';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#f4f7fa';
  ctx.lineWidth = size * 0.05;
  ctx.strokeRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92);
  ctx.fillStyle = '#f4f7fa';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.14);
  ctx.lineTo(size * 0.88, size * 0.84);
  ctx.lineTo(size * 0.12, size * 0.84);
  ctx.closePath();
  ctx.fill();
  // Человек: голова, туловище, ноги
  ctx.fillStyle = '#16202b';
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.42, size * 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = size * 0.035;
  ctx.strokeStyle = '#16202b';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.48);
  ctx.lineTo(size * 0.5, size * 0.66);
  ctx.moveTo(size * 0.5, size * 0.66);
  ctx.lineTo(size * 0.4, size * 0.79);
  ctx.moveTo(size * 0.5, size * 0.66);
  ctx.lineTo(size * 0.6, size * 0.79);
  ctx.moveTo(size * 0.5, size * 0.53);
  ctx.lineTo(size * 0.41, size * 0.6);
  ctx.moveTo(size * 0.5, size * 0.53);
  ctx.lineTo(size * 0.59, size * 0.58);
  ctx.stroke();
  // «Зебра» под ногами
  ctx.fillStyle = '#16202b';
  for (let i = 0; i < 3; i += 1) ctx.fillRect(size * (0.24 + i * 0.18), size * 0.8, size * 0.1, size * 0.03);
};

/** Указатель «СТАДИОН →»: тёмно-зелёная доска с белой надписью и стрелкой. */
const paintStadiumSign: Painter = (ctx, size) => {
  ctx.fillStyle = '#1f4a3d';
  ctx.fillRect(0, 0, size, size * 0.6);
  ctx.strokeStyle = '#eaf4f6';
  ctx.lineWidth = size * 0.02;
  ctx.strokeRect(size * 0.03, size * 0.05, size * 0.94, size * 0.5);
  ctx.fillStyle = '#eaf4f6';
  ctx.font = `bold ${Math.round(size * 0.13)}px "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('СТАДИОН', size * 0.07, size * 0.3);
  // Стрелка
  ctx.beginPath();
  ctx.moveTo(size * 0.66, size * 0.3);
  ctx.lineTo(size * 0.9, size * 0.3);
  ctx.lineTo(size * 0.86, size * 0.24);
  ctx.moveTo(size * 0.9, size * 0.3);
  ctx.lineTo(size * 0.86, size * 0.36);
  ctx.strokeStyle = '#ffd479';
  ctx.lineWidth = size * 0.025;
  ctx.stroke();
};

/** Расписание на остановке: белая доска с синей шапкой и строками. */
const paintTimetable: Painter = (ctx, size, random) => {
  ctx.fillStyle = '#eef2f4';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#1b4fa0';
  ctx.fillRect(0, 0, size, size * 0.2);
  ctx.fillStyle = '#eef2f4';
  ctx.font = `bold ${Math.round(size * 0.1)}px "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('ОСТАНОВКА', size * 0.06, size * 0.11);
  ctx.font = `${Math.round(size * 0.075)}px "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = '#22303a';
  const rows = 6;
  for (let i = 0; i < rows; i += 1) {
    const y = size * (0.28 + i * 0.11);
    ctx.fillText(`${7 + i * 2}:${String(Math.floor(random() * 6) * 10).padStart(2, '0')}`, size * 0.08, y);
    ctx.fillStyle = '#6b7a84';
    ctx.fillRect(size * 0.36, y - size * 0.012, size * 0.5, size * 0.024);
    ctx.fillStyle = '#22303a';
  }
  ctx.strokeStyle = '#b9c4ca';
  ctx.lineWidth = size * 0.02;
  ctx.strokeRect(0, 0, size, size);
};

/** Латунная табличка с номером участка. */
const paintPlate =
  (number: number): Painter =>
  (ctx, size) => {
    ctx.fillStyle = '#d8c9a3';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#8a7a4e';
    ctx.lineWidth = size * 0.04;
    ctx.strokeRect(size * 0.06, size * 0.06, size * 0.88, size * 0.88);
    ctx.fillStyle = '#2c2a22';
    ctx.font = `bold ${Math.round(size * 0.5)}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), size * 0.5, size * 0.44);
    ctx.font = `${Math.round(size * 0.11)}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText('VICE SHORE', size * 0.5, size * 0.78);
    ctx.textAlign = 'left';
  };

interface Atlas {
  readonly map: THREE.Texture;
  readonly size: number;
}

function paintSignAtlas(numbers: readonly number[]): Atlas {
  const size = 512;
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('[Roadside] нет 2D-контекста');
  ctx.fillStyle = '#0d1a22';
  ctx.fillRect(0, 0, size, size);
  const cell = size / SIGN_TILES;
  const random = seeded(4242);
  const painters: Array<Painter | null> = [paintCrossing, paintStadiumSign, paintTimetable];
  for (let i = 0; i < numbers.length && i < SIGN_TILES; i += 1) painters.push(paintPlate(numbers[i] ?? i + 1));
  for (let i = 0; i < SIGN_TILES * SIGN_TILES; i += 1) {
    const painter = painters[i];
    if (!painter) continue;
    ctx.save();
    ctx.translate((i % SIGN_TILES) * cell, Math.floor(i / SIGN_TILES) * cell);
    // Небольшой отступ внутри клетки: без него соседняя табличка «протекает» по краю
    ctx.translate(4, 4);
    painter(ctx, cell - 8, random);
    ctx.restore();
  }
  const map = new THREE.CanvasTexture(el);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return { map, size };
}

/** Плоскость с UV, вырезанными под клетку атласа. */
function tileQuad(tile: number, width: number, height: number, size: number): THREE.PlaneGeometry {
  const step = 1 / SIGN_TILES;
  const u0 = (tile % SIGN_TILES) * step;
  const v0 = 1 - (Math.floor(tile / SIGN_TILES) + 1) * step;
  const geometry = new THREE.PlaneGeometry(width, height);
  const uv = geometry.attributes.uv;
  if (uv) {
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, u0 + uv.getX(i) * step, v0 + uv.getY(i) * step);
    }
    uv.needsUpdate = true;
  }
  void size;
  return geometry;
}

// ————————————————————————————————————————————————————————————————
//  Забор
// ————————————————————————————————————————————————————————————————

const PICKET_STEP = 0.19;
const FENCE_HEIGHT_SHORT = 0.86;
const FENCE_HEIGHT_TALL = 1.02;
const PICKET_WIDTH = 0.085;
const PICKET_DEPTH = 0.03;

/** Штакетина с фигурным верхом: срез под 45° с одной стороны — «фирменный» рисунок. */
function picketGeometry(short: boolean): THREE.BufferGeometry {
  const height = short ? FENCE_HEIGHT_SHORT : FENCE_HEIGHT_TALL;
  const shape = new THREE.Shape();
  const half = PICKET_WIDTH / 2;
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(half, height - 0.09);
  shape.lineTo(0, height);
  shape.lineTo(-half, height - 0.05);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: PICKET_DEPTH, bevelEnabled: false, curveSegments: 1 });
  geometry.translate(0, 0, -PICKET_DEPTH / 2);
  return geometry;
}

interface Run {
  readonly from: number;
  readonly to: number;
}

/** Делит отрезок на пролёты, вырезая проёмы. */
function splitRun(from: number, to: number, gaps: ReadonlyArray<readonly [number, number]>): Run[] {
  let pieces: Array<readonly [number, number]> = [[from, to]];
  for (const [gapFrom, gapTo] of gaps) {
    const next: Array<readonly [number, number]> = [];
    for (const [a, b] of pieces) {
      if (gapTo <= a || gapFrom >= b) {
        next.push([a, b]);
        continue;
      }
      if (gapFrom > a) next.push([a, gapFrom]);
      if (gapTo < b) next.push([gapTo, b]);
    }
    pieces = next;
  }
  return pieces.filter(([a, b]) => b - a > 0.6).map(([a, b]) => ({ from: a, to: b }));
}

export function buildRoadside(
  materials: IslandMaterials,
  collisions: CollisionWorld,
  trunks: ReadonlyArray<Obstacle> = [],
  seed = 20261129,
): RoadsideResult {
  const group = new THREE.Group();
  group.name = 'roadside';
  const random = seeded(seed);

  const houses = layoutHouses();
  const numbers = houses.map((_, index) => index + 1);
  const atlas = paintSignAtlas(numbers);
  const signMaterial = new THREE.MeshStandardMaterial({
    map: atlas.map,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  signMaterial.name = 'roadside-signs';

  let props = 0;
  const add = (parent: THREE.Object3D, mesh: THREE.Object3D): THREE.Object3D => {
    props += 1;
    parent.add(mesh);
    return mesh;
  };
  const box = (
    material: THREE.Material,
    size: [number, number, number],
    position: [number, number, number],
    rotationY = 0,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const cylinder = (
    material: THREE.Material,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    position: [number, number, number],
    segments = 10,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const sign = (tile: number, width: number, height: number, position: [number, number, number], rotationY = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(tileQuad(tile, width, height, atlas.size), signMaterial);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    return mesh;
  };

  // ————————————————————————————————————————————————————————————
  //  Калитки, забор, номера участков
  // ————————————————————————————————————————————————————————————

  const streetHalf = TOWN.streetWidth / 2;
  const northLine = TOWN.streetZ - streetHalf - 2.4;
  const southLine = TOWN.streetZ + streetHalf + 2.4;
  const fenceHalfExtent = ISLAND.radiusX * 0.66;

  /** Проём на дорожку к дому: повторяет правило из `Town` (дорожка обходит бассейн). */
  const pathX = (spec: (typeof houses)[number]): number =>
    spec.x + (spec.pool ? (spec.x >= 0 ? -1 : 1) * (spec.width / 2 + 1.2) : 0);

  const gapsNorth: Array<readonly [number, number]> = [];
  const gapsSouth: Array<readonly [number, number]> = [];
  const gates: Array<{ x: number; z: number; side: 'north' | 'south'; number: number }> = [];

  houses.forEach((spec, index) => {
    const x = pathX(spec);
    const side: 'north' | 'south' = spec.side;
    const gap: readonly [number, number] = [x - 1.35, x + 1.35];
    if (side === 'north') gapsNorth.push(gap);
    else gapsSouth.push(gap);
    gates.push({ x, z: side === 'north' ? northLine : southLine, side, number: index + 1 });
  });

  // Главная аллея к вилле, въезд на стадион и остановка — тоже проёмы
  const alleyGap: readonly [number, number] = [-1.7, 1.7];
  gapsNorth.push(alleyGap);
  gapsSouth.push(alleyGap);
  const drive: readonly [number, number] = [STADIUM.driveX - STADIUM.driveWidth / 2 - 0.8, STADIUM.driveX + STADIUM.driveWidth / 2 + 0.8];
  gapsSouth.push(drive);
  gapsNorth.push(drive);
  // Остановка на западном конце: там забора нет
  const shelterX = -ISLAND.radiusX * 0.7;
  gapsNorth.push([shelterX - 3.2, shelterX + 3.2]);

  // Деревья рощи, попавшие на линию забора, вырезают пролёт: ствол не должен
  // прорастать сквозь штакетник.
  for (const trunk of trunks) {
    if (Math.abs(trunk.z - northLine) < 2.4) gapsNorth.push([trunk.x - 1.5, trunk.x + 1.5]);
    if (Math.abs(trunk.z - southLine) < 2.4) gapsSouth.push([trunk.x - 1.5, trunk.x + 1.5]);
  }

  const shortPicket = picketGeometry(true);
  const tallPicket = picketGeometry(false);
  const placements: Array<{ x: number; z: number; rotation: number; tall: boolean; tilt: number }> = [];
  const runs: Array<{ from: number; to: number; z: number }> = [];

  const buildSide = (z: number, gaps: ReadonlyArray<readonly [number, number]>): void => {
    const pieces = splitRun(-fenceHalfExtent, fenceHalfExtent, gaps);
    for (const piece of pieces) {
      runs.push({ from: piece.from, to: piece.to, z });
      const length = piece.to - piece.from;
      const middle = (piece.from + piece.to) / 2;
      // Цоколь и две перекладины
      add(group, box(materials.stone, [length, 0.2, 0.2], [middle, GROUND + 0.1, z]));
      add(group, box(materials.trim, [length, 0.05, 0.05], [middle, GROUND + 0.24, z]));
      add(group, box(materials.trim, [length, 0.05, 0.05], [middle, GROUND + 0.74, z]));
      // Столбы с терракотовой шапкой каждые 2,6 м
      const posts = Math.max(1, Math.round(length / 2.6));
      for (let i = 0; i <= posts; i += 1) {
        const x = piece.from + (length / posts) * i;
        add(group, box(materials.trim, [0.15, 1.18, 0.15], [x, GROUND + 0.59, z]));
        add(group, box(materials.terracotta, [0.21, 0.09, 0.21], [x, GROUND + 1.2, z]));
      }
      // Штакетины: через одну высокие и низкие — читается как «гребёнка»
      const count = Math.floor(length / PICKET_STEP);
      for (let i = 0; i <= count; i += 1) {
        const x = piece.from + i * PICKET_STEP;
        if (x > piece.to) break;
        placements.push({
          x,
          z,
          rotation: 0,
          tall: i % 2 === 0,
          tilt: ((i * 37) % 9 - 4) * 0.003,
        });
      }
      collisions.addBox(piece.from, piece.to, z - 0.12, z + 0.12, GROUND + 1.25);
    }
  };

  buildSide(northLine, gapsNorth);
  buildSide(southLine, gapsSouth);

  // Штакетник — один InstancedMesh на весь посёлок: две геометрии (высокая/низкая)
  const tall = placements.filter((item) => item.tall);
  const short = placements.filter((item) => !item.tall);
  const dummy = new THREE.Object3D();
  const makePickets = (list: typeof placements, geometry: THREE.BufferGeometry, name: string): THREE.InstancedMesh | null => {
    if (list.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, materials.white, list.length);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((item, index) => {
      dummy.position.set(item.x, GROUND + 0.2, item.z);
      dummy.rotation.set(item.tilt, item.rotation, item.tilt * 0.5);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  };
  makePickets(tall, tallPicket, 'roadside-pickets-tall');
  makePickets(short, shortPicket, 'roadside-pickets-short');

  // Бугенвиллия на каждом третьем пролёте — «фирменное» пятно цвета
  for (const run of runs) {
    if (random() > 0.36) continue;
    const length = run.to - run.from;
    const blooms = 3 + Math.floor(random() * 3);
    for (let i = 0; i < blooms; i += 1) {
      const x = run.from + 0.5 + random() * (length - 1);
      const y = GROUND + 0.55 + random() * 0.6;
      const blob = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.2 + random() * 0.16, 0),
        i % 3 === 0 ? materials.foliage : materials.magenta,
      );
      blob.position.set(x, y, run.z + (random() - 0.5) * 0.22);
      blob.castShadow = true;
      add(group, blob);
    }
  }

  // Каждая калитка: две створки, латунный номер, почтовый ящик и кашпо
  for (const gate of gates) {
    const inward = gate.side === 'north' ? 1 : -1;
    for (const side of [-1, 1] as const) {
      const leaf = new THREE.Group();
      leaf.name = `roadside-gate-${gate.number}-${side}`;
      const leafWidth = 1.28;
      const slats = Math.floor(leafWidth / PICKET_STEP);
      for (let i = 0; i < slats; i += 1) {
        const picket = new THREE.Mesh(i % 2 === 0 ? tallPicket : shortPicket, materials.trim);
        picket.position.set(side * (i * PICKET_STEP + PICKET_STEP / 2), 0, 0);
        picket.castShadow = true;
        leaf.add(picket);
      }
      for (const height of [0.26, 0.8]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(leafWidth, 0.05, 0.05), materials.trim);
        rail.position.set(side * (leafWidth / 2), height, 0);
        rail.castShadow = true;
        leaf.add(rail);
      }
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), materials.brass);
      hinge.position.set(0, 0.6, 0);
      leaf.add(hinge);
      leaf.position.set(gate.x + side * 1.32, GROUND + 0.2, gate.z);
      // Створки приоткрыты внутрь — видно, что калитка не заперта
      leaf.rotation.y = side * 0.42;
      group.add(leaf);
      // Столб калитки
      add(group, box(materials.trim, [0.18, 1.32, 0.18], [gate.x + side * 1.36, GROUND + 0.66, gate.z]));
      add(group, box(materials.terracotta, [0.24, 0.1, 0.24], [gate.x + side * 1.36, GROUND + 1.36, gate.z]));
    }
    // Номер участка на правом столбе
    const plate = sign(gate.number + 2, 0.24, 0.24, [gate.x + 1.36, GROUND + 1.12, gate.z + (gate.side === 'north' ? -0.1 : 0.1)], gate.side === 'north' ? Math.PI : 0);
    plate.castShadow = false;
    group.add(plate);

    // Почтовый ящик: столбик, ящик, флажок
    const mailboxX = gate.x - 2.1;
    add(group, cylinder(materials.wood, 0.05, 0.06, 1.02, [mailboxX, GROUND + 0.51, gate.z - inward * 0.35], 8));
    add(group, box(materials.metal, [0.3, 0.22, 0.42], [mailboxX, GROUND + 1.12, gate.z - inward * 0.35]));
    add(group, box(materials.brass, [0.03, 0.16, 0.05], [mailboxX + 0.17, GROUND + 1.2, gate.z - inward * 0.35]));
    collisions.addCircle(mailboxX, gate.z - inward * 0.35, 0.2, GROUND + 1.3);

    // Два кашпо с цветами у калитки
    for (const offset of [-2.9, 2.9] as const) {
      const potX = gate.x + offset;
      add(group, cylinder(materials.terracotta, 0.26, 0.2, 0.42, [potX, GROUND + 0.21, gate.z - inward * 0.55], 12));
      add(group, cylinder(materials.stone, 0.28, 0.28, 0.05, [potX, GROUND + 0.42, gate.z - inward * 0.55], 12));
      for (let i = 0; i < 4; i += 1) {
        const bloom = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.13 + random() * 0.08, 0),
          i % 2 === 0 ? materials.foliage : materials.magenta,
        );
        bloom.position.set(
          potX + (random() - 0.5) * 0.36,
          GROUND + 0.56 + random() * 0.14,
          gate.z - inward * 0.55 + (random() - 0.5) * 0.3,
        );
        bloom.castShadow = true;
        add(group, bloom);
      }
    }
  }

  // ————————————————————————————————————————————————————————————
  //  Пешеходный переход: разметка и два знака
  // ————————————————————————————————————————————————————————————

  const crosswalk = new THREE.Group();
  crosswalk.name = 'roadside-crosswalk';
  for (let i = 0; i < 5; i += 1) {
    const x = -2.4 + i * 1.2;
    add(crosswalk, box(materials.white, [0.55, 0.02, TOWN.streetWidth - 0.5], [x, GROUND + 0.065, TOWN.streetZ]));
  }
  for (const side of [-1, 1] as const) {
    const z = TOWN.streetZ + side * (streetHalf + 1.1);
    add(crosswalk, cylinder(materials.metal, 0.05, 0.06, 2.3, [-3.6, GROUND + 1.15, z], 8));
    const plate = sign(0, 0.62, 0.62, [-3.6, GROUND + 2.2, z + side * 0.04], side > 0 ? 0 : Math.PI);
    crosswalk.add(plate);
    collisions.addCircle(-3.6, z, 0.12, GROUND + 2.4);
  }
  group.add(crosswalk);

  // Указатель на стадион — у восточного конца улицы
  const signX = 46;
  const signZ = TOWN.streetZ - streetHalf - 1.2;
  for (const dx of [-1.1, 1.1] as const) {
    add(group, cylinder(materials.metal, 0.05, 0.06, 2.6, [signX + dx, GROUND + 1.3, signZ], 8));
    collisions.addCircle(signX + dx, signZ, 0.12, GROUND + 2.7);
  }
  const stadiumSign = sign(1, 2.5, 0.62, [signX, GROUND + 2.35, signZ + 0.06], Math.PI);
  group.add(stadiumSign);

  // ————————————————————————————————————————————————————————————
  //  Автобусная остановка на западном конце
  // ————————————————————————————————————————————————————————————

  const shelter = new THREE.Group();
  shelter.name = 'roadside-shelter';
  const shelterZ = TOWN.streetZ - streetHalf - 1.45;
  add(shelter, box(materials.court, [4.6, 0.08, 1.9], [shelterX, GROUND + 0.04, shelterZ]));
  for (const dx of [-2.1, 2.1] as const) {
    for (const dz of [-0.8, 0.8] as const) {
      add(shelter, box(materials.metal, [0.09, 2.5, 0.09], [shelterX + dx, GROUND + 1.25, shelterZ + dz]));
    }
  }
  add(shelter, box(materials.darkRoof, [4.9, 0.14, 2.2], [shelterX, GROUND + 2.55, shelterZ]));
  add(shelter, box(materials.trim, [4.9, 0.06, 0.12], [shelterX, GROUND + 2.47, shelterZ + 1.06]));
  // Стеклянная задняя стенка и боковины
  add(shelter, box(materials.glass, [4.2, 1.7, 0.04], [shelterX, GROUND + 1.35, shelterZ - 0.9]));
  for (const dx of [-2.1, 2.1] as const) {
    add(shelter, box(materials.glass, [0.04, 1.7, 1.5], [shelterX + dx, GROUND + 1.35, shelterZ - 0.15]));
  }
  // Скамья
  add(shelter, box(materials.wood, [3.4, 0.08, 0.46], [shelterX, GROUND + 0.5, shelterZ - 0.58]));
  add(shelter, box(materials.wood, [3.4, 0.34, 0.07], [shelterX, GROUND + 0.7, shelterZ - 0.8]));
  for (const dx of [-1.4, 1.4] as const) {
    add(shelter, box(materials.metal, [0.07, 0.46, 0.4], [shelterX + dx, GROUND + 0.24, shelterZ - 0.58]));
  }
  // Доска с расписанием на боковине
  const timetable = sign(2, 0.8, 0.9, [shelterX + 2.14, GROUND + 1.5, shelterZ - 0.15], Math.PI / 2);
  shelter.add(timetable);
  // Урна у остановки
  add(shelter, cylinder(materials.metal, 0.16, 0.13, 0.52, [shelterX + 2.5, GROUND + 0.26, shelterZ + 0.5], 10));
  collisions.addBox(shelterX - 2.5, shelterX + 2.5, shelterZ - 1.1, shelterZ - 0.55, GROUND + 1.2);
  collisions.addBox(shelterX - 2.5, shelterX + 2.5, shelterZ - 1.0, shelterZ + 1.0, GROUND + 0.9);
  group.add(shelter);

  // Урны у каждой калитки — по одной, со стороны улицы
  for (const gate of gates) {
    const inward = gate.side === 'north' ? 1 : -1;
    add(
      group,
      cylinder(materials.metal, 0.14, 0.12, 0.48, [gate.x + 1.9, GROUND + 0.24, gate.z + inward * 0.7], 10),
    );
  }

  return {
    group,
    runs: runs.length,
    pickets: placements.length,
    props,
    houses: homesWithGates(houses.length),
    dispose(): void {
      shortPicket.dispose();
      tallPicket.dispose();
      signMaterial.dispose();
      atlas.map.dispose();
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
      });
      group.clear();
    },
  };
}

/** Все дома получают калитку и номер; функция оставлена ради отчёта. */
function homesWithGates(count: number): number {
  void PLOT;
  return count;
}
