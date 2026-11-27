import * as THREE from 'three';
import { COURT, ISLAND, PLOT, TERRACE, TOWN, VILLA } from '../../core/Config';
import type { Rect } from './GrassField';
import type { CollisionWorld } from '../Colliders';

/**
 * Роща (сборка v17): высокие деревья пяти видов — пиния, кипарис, фикус-баньян,
 * жакаранда и олива.
 *
 *  Заказчик: «не хватает высококачественных деревьев разных видов… около дороги
 *  трава, но всё равно пусто». Пальмы на участке виллы уже есть (`Vegetation`),
 *  но на улице и на дальних лугах стояла пустая зелень.
 *
 *  Бюджет кадра — главное решение модуля:
 *   • **одно дерево одного вида = один InstancedMesh**, то есть 5 draw calls на всю
 *     рощу. Ствол и крона склеены в одну геометрию, потому что обе части лежат
 *     в одном атласе: слева кора, справа листва. Отдельные материалы для коры и
 *     листвы дали бы 10 вызовов и 10 шейдеров;
 *   • атлас 512² на вид рисуется кодом: кора с продольными трещинами и сучками,
 *     листва из тысячи мелких «листьев» с провалом в глубине кроны. К карте цвета
 *     считается карта нормалей по Собелю — на кроне появляется объём, а не
 *     крашеная сфера;
 *   • 900–1700 треугольников на дерево: крона — 8–14 сплюснутых шаров с шумом
 *     по вершинам, ствол — сужающийся цилиндр с ветвями и изгибом;
 *   • ветер — в вершинном шейдере, вес растёт с высотой вершины: качается крона,
 *     а комель стоит. Каждый вид — свой шейдер (`customProgramCacheKey`), поэтому
 *     пересборки программ в кадре не будет;
 *   • стволы попадают в мир столкновений кругом 0,34 м — сквозь дерево не пройти.
 */

export interface GroveSpeciesReport {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly triangles: number;
  readonly height: number;
}

export interface GroveResult {
  readonly group: THREE.Group;
  /** Сколько деревьев посажено. */
  readonly instances: number;
  /** Сколько мешей (по одному на вид). */
  readonly meshes: number;
  readonly triangles: number;
  /** Сколько деревьев стоит вдоль улицы — для отчёта. */
  readonly alongStreet: number;
  /** Где стоят стволы: по ним обочина вырезает пролёты забора. */
  readonly trunks: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  readonly species: readonly GroveSpeciesReport[];
  update(elapsed: number): void;
  dispose(): void;
}

const GROUND = TERRACE.deckTopY;
const ATLAS = 512;
/** Левая половина атласа — кора, правая — листва. */
const BARK_UV = { x0: 0.004, y0: 0.004, w: 0.468, h: 0.992 } as const;
const LEAF_UV = { x0: 0.528, y0: 0.004, w: 0.468, h: 0.992 } as const;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Мягкий шум по трём осям: сумма синусов, диапазон примерно ±1. */
function wobble(x: number, y: number, z: number, seed: number): number {
  return (
    Math.sin(x * 2.1 + y * 1.3 + z * 0.7 + seed) * 0.5 +
    Math.sin(x * 4.3 - y * 3.1 + z * 2.2 + seed * 1.7) * 0.3 +
    Math.sin(-x * 7.7 + y * 5.9 + z * 6.1 + seed * 2.9) * 0.2
  );
}

// ————————————————————————————————————————————————————————————————
//  Текстуры: атлас «кора + листва» и карта нормалей к нему
// ————————————————————————————————————————————————————————————————

function canvas(size: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('[Grove] нет 2D-контекста');
  return { el, ctx };
}

interface AtlasSpec {
  readonly id: string;
  /** Основной цвет коры и его светлый/тёмный оттенок. */
  readonly bark: readonly [string, string, string];
  /** Цвета листвы: тёмная глубина, основной, светлый край. */
  readonly leaf: readonly [string, string, string];
  /** Сколько «листьев» нарисовать в листовой половине. */
  readonly leafDensity: number;
  /** Диаметр листа в пикселях. */
  readonly leafSize: readonly [number, number];
}

/** Кора: вертикальные трещины, сучки, продольные волокна. */
function paintBark(ctx: CanvasRenderingContext2D, spec: AtlasSpec, random: () => number): void {
  const width = ATLAS * BARK_UV.w;
  const height = ATLAS * BARK_UV.h;
  const x0 = ATLAS * BARK_UV.x0;
  const y0 = ATLAS * BARK_UV.y0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, width, height);
  ctx.clip();
  ctx.fillStyle = spec.bark[1];
  ctx.fillRect(x0, y0, width, height);

  // Продольные волокна: узкие вертикальные полосы разной ширины
  for (let i = 0; i < 220; i += 1) {
    const x = x0 + random() * width;
    const w = 1 + random() * 5;
    const h = height * (0.2 + random() * 0.8);
    const y = y0 + random() * (height - h);
    ctx.globalAlpha = 0.12 + random() * 0.3;
    ctx.fillStyle = random() > 0.45 ? spec.bark[2] : spec.bark[0];
    ctx.fillRect(x, y, w, h);
  }
  // Трещины: ломаная линия сверху вниз с ответвлениями
  ctx.globalAlpha = 1;
  for (let i = 0; i < 26; i += 1) {
    let x = x0 + random() * width;
    let y = y0 + random() * height * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 6 + Math.floor(random() * 8);
    for (let s = 0; s < steps; s += 1) {
      x += (random() - 0.5) * 6;
      y += height / (steps * 1.6);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = spec.bark[0];
    ctx.globalAlpha = 0.5 + random() * 0.4;
    ctx.lineWidth = 0.8 + random() * 1.8;
    ctx.stroke();
  }
  // Сучки: тёмное пятно с ободком
  for (let i = 0; i < 9; i += 1) {
    const x = x0 + random() * width;
    const y = y0 + random() * height;
    const r = 2.5 + random() * 5;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = spec.bark[0];
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + random() * 0.6), random() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = spec.bark[2];
    ctx.beginPath();
    ctx.ellipse(x - r * 0.25, y - r * 0.3, r * 0.45, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Мох у комля: зеленоватая дымка по нижней трети
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#5a6b3a';
  ctx.fillRect(x0, y0 + height * 0.68, width, height * 0.32);
  ctx.restore();
}

/** Листва: тысяча мелких листьев, в глубине кроны — почти чёрные провалы. */
function paintLeaves(ctx: CanvasRenderingContext2D, spec: AtlasSpec, random: () => number): void {
  const width = ATLAS * LEAF_UV.w;
  const height = ATLAS * LEAF_UV.h;
  const x0 = ATLAS * LEAF_UV.x0;
  const y0 = ATLAS * LEAF_UV.y0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, width, height);
  ctx.clip();
  ctx.fillStyle = spec.leaf[0];
  ctx.fillRect(x0, y0, width, height);

  const [minSize, maxSize] = spec.leafSize;
  for (let i = 0; i < spec.leafDensity; i += 1) {
    const x = x0 + random() * width;
    const y = y0 + random() * height;
    // Верх кроны светлее: имитируем свет сверху
    const up = 1 - (y - y0) / height;
    const pick = random();
    const base = pick > 0.72 && up > 0.35 ? spec.leaf[2] : pick > 0.34 ? spec.leaf[1] : spec.leaf[0];
    ctx.globalAlpha = 0.5 + random() * 0.5;
    ctx.fillStyle = base;
    const size = minSize + random() * (maxSize - minSize);
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * (0.45 + random() * 0.4), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Провалы в глубине — тени между листьями
  for (let i = 0; i < 90; i += 1) {
    const x = x0 + random() * width;
    const y = y0 + random() * height;
    ctx.globalAlpha = 0.18 + random() * 0.22;
    ctx.fillStyle = '#0d1a10';
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + random() * 9, 2 + random() * 5, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Карта нормалей по Собелю: крона и кора получают объём без лишних полигонов. */
function normalFromCanvas(source: HTMLCanvasElement, strength: number): THREE.Texture {
  const size = source.width;
  const ctx = source.getContext('2d');
  if (!ctx) throw new Error('[Grove] нет контекста карты высот');
  const data = ctx.getImageData(0, 0, size, size).data;
  const target = canvas(size);
  const image = target.ctx.createImageData(size, size);
  const at = (x: number, y: number): number => {
    const cx = ((x % size) + size) % size;
    const cy = ((y % size) + size) % size;
    const index = (cy * size + cx) * 4;
    return ((data[index] as number) * 0.3 + (data[index + 1] as number) * 0.59 + (data[index + 2] as number) * 0.11) / 255;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) - at(x + 1, y - 1) - 2 * at(x + 1, y) - at(x + 1, y + 1);
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) - at(x - 1, y + 1) - 2 * at(x, y + 1) - at(x + 1, y + 1);
      let nx = dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz);
      nx /= length;
      ny /= length;
      nz /= length;
      const index = (y * size + x) * 4;
      image.data[index] = Math.round((nx * 0.5 + 0.5) * 255);
      image.data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      image.data[index + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      image.data[index + 3] = 255;
    }
  }
  target.ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(target.el);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

interface Atlas {
  readonly map: THREE.Texture;
  readonly normalMap: THREE.Texture;
}

function paintAtlas(spec: AtlasSpec): Atlas {
  const random = seeded(spec.id.length * 7919 + spec.leafDensity);
  const { el, ctx } = canvas(ATLAS);
  paintBark(ctx, spec, random);
  paintLeaves(ctx, spec, random);
  const map = new THREE.CanvasTexture(el);
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return { map, normalMap: normalFromCanvas(el, 2.2) };
}

// ————————————————————————————————————————————————————————————————
//  Геометрия: ствол с ветвями и крона из шаров
// ————————————————————————————————————————————————————————————————

interface UvRect {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
}

function remapUv(geometry: THREE.BufferGeometry, rect: UvRect, tilesU: number, tilesV: number): void {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i += 1) {
    const fu = uv.getX(i) * tilesU;
    const fv = uv.getY(i) * tilesV;
    uv.setXY(i, rect.x0 + (fu - Math.floor(fu)) * rect.w, rect.y0 + (fv - Math.floor(fv)) * rect.h);
  }
  uv.needsUpdate = true;
}

/** Склейка в одну геометрию: одинаковый набор атрибутов, без индексов. */
function mergeParts(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  let total = 0;
  for (const part of flat) total += part.attributes.position?.count ?? 0;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let offset = 0;
  for (const part of flat) {
    const pos = part.attributes.position;
    const nor = part.attributes.normal;
    const uvs = part.attributes.uv;
    if (!pos) continue;
    position.set(pos.array as Float32Array, offset * 3);
    if (nor) normal.set(nor.array as Float32Array, offset * 3);
    if (uvs) uv.set(uvs.array as Float32Array, offset * 2);
    offset += pos.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  for (const part of flat) part.dispose();
  merged.computeBoundingSphere();
  return merged;
}

interface TrunkOptions {
  readonly height: number;
  readonly rBottom: number;
  readonly rTop: number;
  readonly bendX: number;
  readonly bendZ: number;
  readonly seed: number;
  readonly radial?: number;
  readonly knotty?: number;
}

/** Ствол: сужающийся цилиндр с изгибом, шумом по радиусу и продольными рёбрами. */
function trunkGeometry(options: TrunkOptions): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    options.rTop,
    options.rBottom,
    options.height,
    options.radial ?? 10,
    7,
    false,
  );
  geometry.translate(0, options.height / 2, 0);
  const position = geometry.attributes.position;
  const knotty = options.knotty ?? 0.08;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const t = vertex.y / options.height;
    const angle = Math.atan2(vertex.z, vertex.x);
    const radius = Math.hypot(vertex.x, vertex.z);
    if (radius > 0.0001) {
      const ripple = 1 + wobble(Math.cos(angle) * 2.4, t * 3.1, Math.sin(angle) * 2.4, options.seed) * knotty;
      vertex.x = Math.cos(angle) * radius * ripple;
      vertex.z = Math.sin(angle) * radius * ripple;
    }
    vertex.x += options.bendX * t * t;
    vertex.z += options.bendZ * t * t;
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  remapUv(geometry, BARK_UV, 2, 3);
  return geometry;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Ветвь: тонкий конус, выставленный по направлению из точки крепления. */
function branchGeometry(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  rBase: number,
  rTip: number,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(rTip, rBase, length, 6, 1, false);
  geometry.translate(0, length / 2, 0);
  const dir = direction.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quaternion));
  geometry.translate(origin.x, origin.y, origin.z);
  remapUv(geometry, BARK_UV, 2, 2);
  return geometry;
}

/** Кусок кроны: шар с шумом по вершинам, сплюснутый по Y (крона шире, чем выше). */
function blobGeometry(
  center: THREE.Vector3,
  radius: number,
  squashY: number,
  seed: number,
  detail = 1,
): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const bump = 1 + wobble(vertex.x * 1.6, vertex.y * 1.9, vertex.z * 1.6, seed) * 0.2;
    vertex.multiplyScalar(bump);
    vertex.y *= squashY;
    vertex.x += center.x;
    vertex.y += center.y;
    vertex.z += center.z;
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  remapUv(geometry, LEAF_UV, 1, 1);
  return geometry;
}

interface Built {
  readonly geometry: THREE.BufferGeometry;
  readonly height: number;
  readonly sway: number;
  readonly seed: number;
}

/** Пиния: высокий голый ствол с развилкой и плоская «зонтичная» крона. */
function buildPine(seed: number): Built {
  const random = seeded(seed);
  const height = 5.2;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    trunkGeometry({ height: height - 0.9, rBottom: 0.26, rTop: 0.17, bendX: 0.5, bendZ: -0.35, seed, knotty: 0.09 }),
  );
  const fork = new THREE.Vector3(0.5, height - 0.9, -0.35);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + 0.6;
    parts.push(
      branchGeometry(
        fork,
        new THREE.Vector3(Math.cos(angle) * 0.75, 1, Math.sin(angle) * 0.75),
        1.5 + random() * 0.7,
        0.13,
        0.055,
      ),
    );
  }
  // Крона: плоский диск из девяти шаров на верхушке развилки
  const top = height + 0.35;
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2 + random() * 0.5;
    const radius = i === 0 ? 0 : 1.1 + random() * 1.1;
    parts.push(
      blobGeometry(
        new THREE.Vector3(Math.cos(angle) * radius + 0.4, top + (random() - 0.5) * 0.3, Math.sin(angle) * radius),
        1.05 + random() * 0.5,
        0.52,
        seed + i * 13,
      ),
    );
  }
  return { geometry: mergeParts(parts), height: top + 1.1, sway: 0.1, seed };
}

/** Кипарис: узкий столб из поставленных друг на друга шаров. */
function buildCypress(seed: number): Built {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    trunkGeometry({ height: 6.4, rBottom: 0.2, rTop: 0.09, bendX: 0.1, bendZ: 0.12, seed, knotty: 0.05 }),
  );
  const layers = 7;
  for (let i = 0; i < layers; i += 1) {
    const t = i / (layers - 1);
    const y = 2.2 + t * 4.2;
    const radius = 0.95 * (1 - Math.pow(t, 1.6) * 0.82) + 0.16;
    parts.push(
      blobGeometry(
        new THREE.Vector3(
          Math.cos(i * 2.1) * 0.12,
          y,
          Math.sin(i * 2.1) * 0.12,
        ),
        radius,
        1.55,
        seed + i * 31,
        1,
      ),
    );
  }
  return { geometry: mergeParts(parts), height: 7.2, sway: 0.06, seed };
}

/** Фикус-баньян: толстый ствол с контрфорсами, широкая крона и воздушные корни. */
function buildBanyan(seed: number): Built {
  const random = seeded(seed);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(trunkGeometry({ height: 3.4, rBottom: 0.42, rTop: 0.26, bendX: 0.15, bendZ: 0.1, seed, knotty: 0.12 }));
  // Контрфорсы у комля — то, что делает баньян баньяном
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + random() * 0.4;
    const fin = new THREE.BoxGeometry(0.16, 0.9, 1.15);
    fin.translate(0, 0.45, 0.58);
    fin.rotateY(-angle);
    fin.translate(Math.cos(angle) * 0.2, 0, Math.sin(angle) * 0.2);
    remapUv(fin, BARK_UV, 2, 2);
    parts.push(fin);
  }
  // Ветви: шесть, расходятся вверх и в стороны
  const crown = 3.4;
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + 0.3;
    parts.push(
      branchGeometry(
        new THREE.Vector3(0, crown - 0.4, 0),
        new THREE.Vector3(Math.cos(angle), 0.85, Math.sin(angle)),
        1.9 + random() * 0.9,
        0.17,
        0.07,
      ),
    );
  }
  const top = crown + 1.1;
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2 + random() * 0.6;
    const radius = i === 0 ? 0 : 1.2 + random() * 1.6;
    parts.push(
      blobGeometry(
        new THREE.Vector3(Math.cos(angle) * radius, top + (random() - 0.5) * 1.1, Math.sin(angle) * radius),
        1.1 + random() * 0.55,
        0.78,
        seed + i * 17,
      ),
    );
  }
  // Воздушные корни: тонкие нити от кроны до земли
  for (let i = 0; i < 9; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 1.4 + random() * 1.9;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const length = top - 0.7;
    const root = new THREE.CylinderGeometry(0.022, 0.038, length, 5, 1, false);
    root.translate(x, length / 2, z);
    remapUv(root, BARK_UV, 1, 3);
    parts.push(root);
  }
  return { geometry: mergeParts(parts), height: top + 1.6, sway: 0.07, seed };
}

/** Жакаранда: светлый ствол-развилка, воздушная крона (цвет задаётся инстансом). */
function buildJacaranda(seed: number): Built {
  const random = seeded(seed);
  const parts: THREE.BufferGeometry[] = [];
  const height = 3.1;
  parts.push(trunkGeometry({ height, rBottom: 0.24, rTop: 0.15, bendX: -0.25, bendZ: 0.3, seed, knotty: 0.07 }));
  const fork = new THREE.Vector3(-0.25, height, 0.3);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.9;
    parts.push(
      branchGeometry(
        fork,
        new THREE.Vector3(Math.cos(angle) * 0.9, 1, Math.sin(angle) * 0.9),
        1.7 + random() * 0.8,
        0.11,
        0.045,
      ),
    );
  }
  const top = height + 1.9;
  for (let i = 0; i < 11; i += 1) {
    const angle = (i / 11) * Math.PI * 2 + random() * 0.7;
    const radius = i === 0 ? 0 : 0.9 + random() * 1.5;
    parts.push(
      blobGeometry(
        new THREE.Vector3(
          Math.cos(angle) * radius - 0.25,
          top + (random() - 0.5) * 1.3,
          Math.sin(angle) * radius + 0.3,
        ),
        0.85 + random() * 0.45,
        0.72,
        seed + i * 23,
      ),
    );
  }
  return { geometry: mergeParts(parts), height: top + 1.4, sway: 0.11, seed };
}

/** Олива: корявый невысокий ствол и серебристо-зелёная крона. */
function buildOlive(seed: number): Built {
  const random = seeded(seed);
  const parts: THREE.BufferGeometry[] = [];
  const height = 2.3;
  parts.push(
    trunkGeometry({ height, rBottom: 0.28, rTop: 0.16, bendX: 0.35, bendZ: 0.2, seed, knotty: 0.18, radial: 8 }),
  );
  const fork = new THREE.Vector3(0.35, height, 0.2);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + 1.4;
    parts.push(
      branchGeometry(
        fork,
        new THREE.Vector3(Math.cos(angle) * 0.8, 1, Math.sin(angle) * 0.8),
        1.1 + random() * 0.5,
        0.1,
        0.04,
      ),
    );
  }
  const top = height + 1.25;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + random() * 0.6;
    const radius = i === 0 ? 0 : 0.7 + random() * 1.0;
    parts.push(
      blobGeometry(
        new THREE.Vector3(
          Math.cos(angle) * radius + 0.3,
          top + (random() - 0.5) * 0.8,
          Math.sin(angle) * radius + 0.2,
        ),
        0.72 + random() * 0.4,
        0.7,
        seed + i * 29,
      ),
    );
  }
  return { geometry: mergeParts(parts), height: top + 0.9, sway: 0.09, seed };
}

// ————————————————————————————————————————————————————————————————
//  Виды
// ————————————————————————————————————————————————————————————————

interface SpeciesSpec {
  readonly id: string;
  readonly label: string;
  readonly atlas: AtlasSpec;
  readonly build: (seed: number) => Built;
  /** Сколько деревьев поставить вдоль улицы и сколько в рощах. */
  readonly verge: number;
  readonly grove: number;
  readonly scale: readonly [number, number];
  /** Разброс оттенка листвы по инстансам: [hue, saturation, lightness] в HSL. */
  readonly tint: { readonly hue: number; readonly sat: number; readonly light: number };
}

const SPECIES: readonly SpeciesSpec[] = [
  {
    id: 'pine',
    label: 'Пиния',
    build: buildPine,
    verge: 7,
    grove: 6,
    scale: [0.9, 1.15],
    tint: { hue: 0.008, sat: 0.06, light: 0.05 },
    atlas: {
      id: 'pine',
      bark: ['#4a3626', '#6d5238', '#8a6a48'],
      leaf: ['#1d3320', '#2f5230', '#4a7038'],
      leafDensity: 1400,
      leafSize: [5, 11],
    },
  },
  {
    id: 'cypress',
    label: 'Кипарис',
    build: buildCypress,
    verge: 8,
    grove: 12,
    scale: [0.85, 1.12],
    tint: { hue: 0.01, sat: 0.05, light: 0.045 },
    atlas: {
      id: 'cypress',
      bark: ['#4d4034', '#6f5d49', '#8b7a63'],
      leaf: ['#152a20', '#22412e', '#345c3c'],
      leafDensity: 1900,
      leafSize: [4, 9],
    },
  },
  {
    id: 'banyan',
    label: 'Фикус-баньян',
    build: buildBanyan,
    verge: 4,
    grove: 6,
    scale: [0.9, 1.1],
    tint: { hue: 0.006, sat: 0.07, light: 0.055 },
    atlas: {
      id: 'banyan',
      bark: ['#8b8478', '#a9a294', '#c3bcae'],
      leaf: ['#1b3323', '#2c4f34', '#456f45'],
      leafDensity: 1600,
      leafSize: [5, 12],
    },
  },
  {
    id: 'jacaranda',
    label: 'Жакаранда',
    build: buildJacaranda,
    verge: 7,
    grove: 6,
    scale: [0.9, 1.14],
    tint: { hue: 0.03, sat: 0.14, light: 0.06 },
    atlas: {
      id: 'jacaranda',
      bark: ['#8f8b80', '#b3aea1', '#cfcabd'],
      leaf: ['#2b3a4a', '#5c6f9a', '#8e86c8'],
      leafDensity: 1100,
      leafSize: [4, 10],
    },
  },
  {
    id: 'olive',
    label: 'Олива',
    build: buildOlive,
    verge: 7,
    grove: 6,
    scale: [0.9, 1.18],
    tint: { hue: 0.014, sat: 0.08, light: 0.06 },
    atlas: {
      id: 'olive',
      bark: ['#5b5548', '#7d7565', '#9b9483'],
      leaf: ['#3f4d38', '#66775a', '#8fa07f'],
      leafDensity: 1500,
      leafSize: [4, 9],
    },
  },
];

// ————————————————————————————————————————————————————————————————
//  Посадка
// ————————————————————————————————————————————————————————————————

interface Spot {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly spin: number;
  readonly color: THREE.Color;
  readonly roadside: boolean;
}

/** Свободно ли место под ствол: не дом, не площадка, не дорожка, не газон виллы. */
function makeFreeTest(occupied: readonly Rect[]) {
  const villa: Rect = {
    minX: VILLA.centerX - VILLA.width / 2 - 2.6,
    maxX: VILLA.centerX + VILLA.width / 2 + 2.6,
    minZ: VILLA.centerZ - VILLA.depth / 2 - 3.6,
    maxZ: VILLA.centerZ + VILLA.depth / 2 + VILLA.terraceDepth + 2.2,
  };
  const court: Rect = {
    minX: COURT.centerX - COURT.length / 2 - 2.4,
    maxX: COURT.centerX + COURT.length / 2 + 2.4,
    minZ: COURT.centerZ - COURT.width / 2 - 2.4,
    maxZ: COURT.centerZ + COURT.width / 2 + 2.4,
  };
  const plot: Rect = {
    minX: PLOT.fenceMinX - 0.6,
    maxX: PLOT.fenceMaxX + 0.6,
    minZ: PLOT.fenceMinZ - 0.6,
    maxZ: PLOT.fenceMaxZ + 0.6,
  };
  const inside = (rect: Rect, x: number, z: number, pad: number): boolean =>
    x > rect.minX - pad && x < rect.maxX + pad && z > rect.minZ - pad && z < rect.maxZ + pad;

  return (x: number, z: number, pad: number): boolean => {
    const rx = ISLAND.radiusX * 0.935;
    const rz = ISLAND.radiusZ * 0.935;
    if ((x * x) / (rx * rx) + (z * z) / (rz * rz) > 1) return false;
    if (inside(villa, x, z, pad) || inside(court, x, z, pad) || inside(plot, x, z, pad)) return false;
    for (const rect of occupied) if (inside(rect, x, z, pad)) return false;
    return true;
  };
}

export function buildGrove(occupied: readonly Rect[], collisions: CollisionWorld, seed = 20261128): GroveResult {
  const group = new THREE.Group();
  group.name = 'grove';

  const free = makeFreeTest(occupied);
  const placed: Array<{ x: number; z: number; radius: number }> = [];
  const timeUniform: THREE.IUniform<number> = { value: 0 };
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const meshes: THREE.InstancedMesh[] = [];

  const streetHalf = TOWN.streetWidth / 2;

  /** Слишком близко к уже посаженному дереву? */
  const crowded = (x: number, z: number, gap: number): boolean =>
    placed.some((other) => (other.x - x) ** 2 + (other.z - z) ** 2 < (gap + other.radius) ** 2);

  interface State {
    readonly spec: SpeciesSpec;
    readonly built: Built;
    readonly material: THREE.MeshStandardMaterial;
    readonly atlas: Atlas;
    readonly random: () => number;
    readonly spots: Spot[];
    readonly target: number;
    vergePlaced: number;
  }

  const states: State[] = SPECIES.map((spec) => {
    const built = spec.build(seed + spec.id.length * 131);
    const atlas = paintAtlas(spec.atlas);
    const material = new THREE.MeshStandardMaterial({
      map: atlas.map,
      normalMap: atlas.normalMap,
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughness: 0.82,
      metalness: 0,
    });
    material.name = `grove-${spec.id}`;
    // Ветер: вес растёт с высотой вершины — качается крона, комель стоит.
    const sway = built.sway.toFixed(3);
    const height = built.height.toFixed(2);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 treeOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
         #else
           vec3 treeOrigin = vec3(0.0);
         #endif
         float treeWeight = pow(clamp(transformed.y / ${height}, 0.0, 1.0), 2.0);
         float treePhase = uTime * 0.9 + treeOrigin.x * 0.21 + treeOrigin.z * 0.17;
         transformed.x += sin(treePhase) * ${sway} * treeWeight;
         transformed.z += cos(treePhase * 0.73) * ${(built.sway * 0.7).toFixed(3)} * treeWeight;`,
      );
    };
    material.customProgramCacheKey = () => `grove-wind-${spec.id}-${sway}-${height}`;
    return {
      spec,
      built,
      material,
      atlas,
      random: seeded(seed + spec.id.length * 7919 + spec.verge),
      spots: [],
      target: spec.verge + spec.grove,
      vergePlaced: 0,
    };
  });

  /** Одна попытка посадить дерево вида: у улицы или в роще. */
  const tryPlant = (state: State): boolean => {
    const { spec, random, spots } = state;
    const wantRoadside = state.vergePlaced < spec.verge;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      let x = 0;
      let z = 0;
      if (wantRoadside) {
        const side = random() < 0.5 ? -1 : 1;
        x = -ISLAND.radiusX * 0.8 + random() * ISLAND.radiusX * 1.6;
        z = TOWN.streetZ + side * (streetHalf + 1.9 + random() * 5.6);
      } else {
        const angle = random() * Math.PI * 2;
        const radius = Math.sqrt(random()) * 0.9;
        x = Math.cos(angle) * ISLAND.radiusX * radius;
        z = Math.sin(angle) * ISLAND.radiusZ * radius;
      }
      if (!free(x, z, wantRoadside ? 0.55 : 1.2)) continue;
      if (crowded(x, z, wantRoadside ? 2.1 : 2.5)) continue;
      const scale = spec.scale[0] + random() * (spec.scale[1] - spec.scale[0]);
      const color = new THREE.Color();
      color.setHSL(
        0.28 + (random() - 0.5) * spec.tint.hue,
        0.42 + (random() - 0.5) * spec.tint.sat,
        0.5 + (random() - 0.5) * spec.tint.light,
      );
      spots.push({ x, z, scale, spin: random() * Math.PI * 2, color, roadside: wantRoadside });
      placed.push({ x, z, radius: 1.45 * scale });
      if (wantRoadside) state.vergePlaced += 1;
      return true;
    }
    return false;
  };

  // Посадка по кругу, вид за видом: иначе последняя олива остаётся без места,
  // когда все свободные пятна уже заняты пиниями и кипарисами.
  let progress = true;
  while (progress) {
    progress = false;
    for (const state of states) {
      if (state.spots.length >= state.target) continue;
      if (tryPlant(state)) progress = true;
    }
  }

  const report: GroveSpeciesReport[] = [];
  let instances = 0;
  let triangles = 0;
  let alongStreet = 0;

  for (const state of states) {
    const { spec, built, material, atlas, spots } = state;
    if (spots.length > 0) {
      const mesh = new THREE.InstancedMesh(built.geometry, material, spots.length);
      mesh.name = `grove-${spec.id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < spots.length; i += 1) {
        const spot = spots[i]!;
        dummy.position.set(spot.x, GROUND - 0.02, spot.z);
        dummy.rotation.set(0, spot.spin, 0);
        dummy.scale.setScalar(spot.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, spot.color);
        // Ствол — препятствие: сквозь дерево не пройти
        collisions.addCircle(spot.x, spot.z, 0.34 * spot.scale, GROUND + built.height * spot.scale);
        if (spot.roadside) alongStreet += 1;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      meshes.push(mesh);
    }

    const speciesTriangles = spots.length * Math.round((built.geometry.attributes.position?.count ?? 0) / 3);
    report.push({
      id: spec.id,
      label: spec.label,
      count: spots.length,
      triangles: speciesTriangles,
      height: Math.round(built.height * 10) / 10,
    });
    instances += spots.length;
    triangles += speciesTriangles;
    geometries.push(built.geometry);
    materials.push(material);
    textures.push(atlas.map, atlas.normalMap);
  }

  return {
    group,
    instances,
    meshes: meshes.length,
    triangles,
    alongStreet,
    trunks: placed.map((item) => ({ x: item.x, z: item.z })),
    species: report,
    update(elapsed: number): void {
      timeUniform.value = elapsed;
    },
    dispose(): void {
      for (const mesh of meshes) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      group.clear();
    },
  };
}
