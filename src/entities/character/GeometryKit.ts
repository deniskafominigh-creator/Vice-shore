import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mapUv, type UvRegion } from './CharacterAtlas';

/** Инструменты сборки скинированной геометрии: трубы с весами, деформированные сферы,
 *  «жёсткие» детали на одну кость. Всё строится в позе покоя в мировых координатах. */

export interface BoneWeight {
  readonly bone: string;
  readonly weight: number;
}

export interface RingSpec {
  readonly center: THREE.Vector3;
  readonly rx: number;
  readonly rz: number;
  readonly weights: readonly BoneWeight[];
  /** Параметр вдоль трубы (0..1) — используется для UV, чтобы рисунок ткани шёл по длине. */
  readonly t: number;
}

export interface KitContext {
  readonly boneIndex: (name: string) => number;
}

const UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_AXIS = new THREE.Vector3(1, 0, 0);

function frameFor(previous: THREE.Vector3, next: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3 } {
  const tangent = new THREE.Vector3().subVectors(next, previous).normalize();
  const right = new THREE.Vector3().crossVectors(tangent, UP);
  if (right.lengthSq() < 1e-6) right.copy(FALLBACK_AXIS);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
  return { right, up };
}

/** Труба по набору колец: непрерывная поверхность с плавными весами на изгибах. */
export function buildTube(
  rings: readonly RingSpec[],
  radialSegments: number,
  region: UvRegion,
  ctx: KitContext,
  options: { capStart?: boolean; capEnd?: boolean; uRepeat?: number; vRepeat?: number } = {},
): THREE.BufferGeometry {
  const { capStart = false, capEnd = false, uRepeat = 1, vRepeat = 1 } = options;

  // Обход треугольников рассчитан на кольца «снизу вверх». Если деталь описана сверху вниз
  // (руки, ноги, джинсы), разворачиваем кольца — иначе нормали смотрят внутрь.
  const goesDown = rings[rings.length - 1]!.center.y < rings[0]!.center.y;
  const orderedRings = goesDown ? [...rings].reverse() : rings;
  const capBottom = goesDown ? capEnd : capStart;
  const capTop = goesDown ? capStart : capEnd;

  const ringCount = orderedRings.length;
  if (ringCount < 2) throw new Error('[GeometryKit] для трубы нужно минимум два кольца');

  const positions: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  const pushSkin = (weights: readonly BoneWeight[]): void => {
    const sorted = [...weights].sort((a, b) => b.weight - a.weight).slice(0, 4);
    const total = sorted.reduce((sum, item) => sum + item.weight, 0) || 1;
    for (let slot = 0; slot < 4; slot += 1) {
      const item = sorted[slot];
      skinIndices.push(item ? ctx.boneIndex(item.bone) : 0);
      skinWeights.push(item ? item.weight / total : 0);
    }
  };

  for (let i = 0; i < ringCount; i += 1) {
    const ring = orderedRings[i] as RingSpec;
    const previous = orderedRings[Math.max(0, i - 1)] as RingSpec;
    const next = orderedRings[Math.min(ringCount - 1, i + 1)] as RingSpec;
    const { right, up } = frameFor(previous.center, next.center);

    for (let j = 0; j < radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(
        ring.center.x + right.x * cos * ring.rx + up.x * sin * ring.rz,
        ring.center.y + right.y * cos * ring.rx + up.y * sin * ring.rz,
        ring.center.z + right.z * cos * ring.rx + up.z * sin * ring.rz,
      );

      const [u, v] = mapUv(region, (j / radialSegments) * uRepeat, ring.t * vRepeat);
      uvs.push(u, 1 - v);
      pushSkin(ring.weights);
    }
  }

  for (let i = 0; i < ringCount - 1; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const jNext = (j + 1) % radialSegments;
      const a = i * radialSegments + j;
      const b = i * radialSegments + jNext;
      const c = (i + 1) * radialSegments + jNext;
      const d = (i + 1) * radialSegments + j;
      // Порядок обхода — против часовой снаружи: нормали смотрят наружу.
      indices.push(a, c, b, a, d, c);
    }
  }

  const addCap = (ring: RingSpec, reverse: boolean): void => {
    const centerIndex = positions.length / 3;
    positions.push(ring.center.x, ring.center.y, ring.center.z);
    const [u, v] = mapUv(region, 0.5, ring.t * vRepeat);
    uvs.push(u, 1 - v);
    pushSkin(ring.weights);
    const ringStart = reverse ? (ringCount - 1) * radialSegments : 0;
    for (let j = 0; j < radialSegments; j += 1) {
      const jNext = (j + 1) % radialSegments;
      const a = ringStart + j;
      const b = ringStart + jNext;
      if (reverse) indices.push(centerIndex, b, a);
      else indices.push(centerIndex, a, b);
    }
  };

  if (capBottom) addCap(orderedRings[0] as RingSpec, false);
  if (capTop) addCap(orderedRings[ringCount - 1] as RingSpec, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Деформированная сфера: голова, плечи, мысы кроссовок и т.п. */
export function buildShapedSphere(
  center: THREE.Vector3,
  radius: THREE.Vector3,
  widths: number,
  heights: number,
  bone: string,
  region: UvRegion,
  ctx: KitContext,
  shape?: (vertex: THREE.Vector3, unit: THREE.Vector3) => void,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, widths, heights);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  if (!position || !uv) throw new Error('[GeometryKit] сфера без позиций или UV');

  const unit = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    unit.set(position.getX(i), position.getY(i), position.getZ(i));
    vertex.set(unit.x * radius.x, unit.y * radius.y, unit.z * radius.z);
    shape?.(vertex, unit);
    position.setXYZ(i, center.x + vertex.x, center.y + vertex.y, center.z + vertex.z);
    const [u, v] = mapUv(region, uv.getX(i), uv.getY(i));
    uv.setXY(i, u, 1 - v);
  }
  position.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  return withRigidSkin(geometry, bone, ctx);
}

/** Привязка готовой геометрии к одной кости (жёсткая деталь). */
export function withRigidSkin(
  geometry: THREE.BufferGeometry,
  bone: string,
  ctx: KitContext,
): THREE.BufferGeometry {
  const count = geometry.attributes.position?.count ?? 0;
  const index = ctx.boneIndex(bone);
  const indices: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < count; i += 1) {
    indices.push(index, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}

/** Скиннинг по функции от вершины: нужно там, где вес зависит от положения
 *  (например, носок кроссовка — на кость носка, остальное — на стопу). */
export function withSkin(
  geometry: THREE.BufferGeometry,
  ctx: KitContext,
  weightsFor: (vertex: THREE.Vector3) => readonly BoneWeight[],
): THREE.BufferGeometry {
  const position = geometry.attributes.position;
  if (!position) throw new Error('[GeometryKit] нет позиций для скиннинга');
  const indices: number[] = [];
  const weights: number[] = [];
  const vertex = new THREE.Vector3();

  for (let i = 0; i < position.count; i += 1) {
    vertex.set(position.getX(i), position.getY(i), position.getZ(i));
    const sorted = [...weightsFor(vertex)].sort((a, b) => b.weight - a.weight).slice(0, 4);
    const total = sorted.reduce((sum, item) => sum + item.weight, 0) || 1;
    for (let slot = 0; slot < 4; slot += 1) {
      const item = sorted[slot];
      indices.push(item ? ctx.boneIndex(item.bone) : 0);
      weights.push(item ? item.weight / total : 0);
    }
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}

/** Пересчёт UV готовой детали в регион атласа (для коробок и примитивов). */
export function remapUv(geometry: THREE.BufferGeometry, region: UvRegion, uRepeat = 1, vRepeat = 1): void {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i += 1) {
    const [u, v] = mapUv(region, uv.getX(i) * uRepeat, uv.getY(i) * vRepeat);
    uv.setXY(i, u, 1 - v);
  }
  uv.needsUpdate = true;
}

/** Объединение деталей: три-_Box-геометрии бывают неиндексированными,
 *  поэтому перед склейкой приводим всё к одному виду — иначе merge падает. */
export function mergeParts(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries([...normalized], false);
  for (const part of normalized) part.dispose();
  if (!merged) throw new Error('[GeometryKit] не удалось объединить геометрию');
  return merged;
}

/** Плавное смешивание двух весов (для стыков «сустав — соседняя кость»). */
export function blendWeights(
  a: { bone: string; weight: number },
  b: { bone: string; weight: number },
): BoneWeight[] {
  return [
    { bone: a.bone, weight: a.weight },
    { bone: b.bone, weight: b.weight },
  ];
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0 || 1)));
  return t * t * (3 - 2 * t);
}
