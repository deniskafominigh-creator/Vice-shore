import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STADIUM, TERRACE } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';
import type { Rect } from './Town';

/**
 * Живые детали острова (задача 21).
 *
 *  Пустых мест на плато было много: северная полоса за домами, западный и
 *  восточный «карманы» между крайними домами и обрывом. Здесь они превращаются
 *  в набережную-парк с пикником и гирляндами, причал с лодкой, площадь с
 *  фонтаном и рыночный лоток; в небе кружат чайки, у берега качаются парусники.
 *
 *  Бюджет draw call — главное правило модуля:
 *   - статика (доски причала, чаши, столы, стойки) складывается в «корзины» по
 *     материалу и склеивается: один меш на материал;
 *   - вся ткань (флаги, флажки, зонты, навес, бельё) — ОДИН материал с цветом в
 *     вершинах и ветром в вершинном шейдере: один draw call на всю ткань мира;
 *   - весь флот (корпуса, мачты, паруса, буи) — один меш: качка и ветер в
 *     вершинном шейдере, CPU не участвует;
 *   - струи фонтана — `Points` с баллистикой в шейдере;
 *   - чайки — один меш, полёт и взмах крыла в шейдере.
 *  Итого около десятка draw call на всю задачу.
 */

const GROUND = TERRACE.deckTopY;

export interface DetailsResult {
  readonly group: THREE.Group;
  /** Площадки деталей: трава на них не сеется. */
  readonly occupied: readonly Rect[];
  /** Сколько предметов анимируется — для отчёта. */
  readonly animated: number;
  readonly drawMeshes: number;
  update(elapsed: number, eye?: THREE.Vector3): void;
  dispose(): void;
}

interface Clock {
  readonly uniform: { value: number };
}

interface Disposable {
  dispose(): void;
}

// ————————————————————————————————————————————————————————————————
// Геометрия: помощники
// ————————————————————————————————————————————————————————————————

const unitScale = new THREE.Vector3(1, 1, 1);
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempMatrix = new THREE.Matrix4();
const tempEuler = new THREE.Euler();

function placed(geometry: THREE.BufferGeometry, x: number, y: number, z: number, rotationY = 0): THREE.BufferGeometry {
  tempEuler.set(0, rotationY, 0);
  tempQuaternion.setFromEuler(tempEuler);
  tempMatrix.compose(tempPosition.set(x, y, z), tempQuaternion, unitScale);
  geometry.applyMatrix4(tempMatrix);
  return geometry;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rotationY = 0): THREE.BufferGeometry {
  return placed(new THREE.BoxGeometry(w, h, d), x, y, z, rotationY);
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  x: number,
  y: number,
  z: number,
  segments = 10,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  geometry.translate(x, y + height / 2, z);
  return geometry;
}

/** Точка, повёрнутая вокруг центра в плоскости XZ. */
function offsetPoint(centerX: number, centerZ: number, dx: number, dz: number, rotationY: number): { x: number; z: number } {
  return {
    x: centerX + dx * Math.cos(rotationY) + dz * Math.sin(rotationY),
    z: centerZ - dx * Math.sin(rotationY) + dz * Math.cos(rotationY),
  };
}

function linearColor(hex: number): THREE.Color {
  return new THREE.Color(hex).convertSRGBToLinear();
}

/** Корзины статики: материал → куски геометрии, склеиваются в один меш. */
class Buckets {
  private readonly map = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(material: THREE.Material, geometry: THREE.BufferGeometry | null): void {
    if (!geometry) return;
    const list = this.map.get(material) ?? [];
    list.push(geometry);
    this.map.set(material, list);
  }

  flush(target: THREE.Group, prefix: string): number {
    let count = 0;
    for (const [material, parts] of this.map) {
      if (parts.length === 0) continue;
      // Все корзины собраны из примитивов three — они индексированные
      const geometry = mergeGeometries(parts, false);
      parts.forEach((part) => part.dispose());
      if (!geometry) continue;
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${prefix}-${count}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      target.add(mesh);
      count += 1;
    }
    this.map.clear();
    return count;
  }
}

/** Перевести геометрию в non-indexed и гарантировать `uv` и `normal`:
 *  `mergeGeometries` не смешивает индексированные куски с неиндексированными,
 *  а атрибуты анимации надо считать уже по «развёрнутым» вершинам. */
function flatten(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  if (!flat.getAttribute('uv')) {
    flat.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(flat.attributes.position.count * 2), 2));
  }
  if (!flat.getAttribute('normal')) flat.computeVertexNormals();
  return flat;
}

/** Размножить короткое значение на все вершины. */
function fill(count: number, itemSize: number, values: ArrayLike<number>): Float32Array {
  const out = new Float32Array(count * itemSize);
  for (let i = 0; i < count; i += 1) {
    for (let component = 0; component < itemSize; component += 1) {
      out[i * itemSize + component] = values[component] ?? 0;
    }
  }
  return out;
}

/** Записать атрибут на всю геометрию: массив либо ровно по вершинам, либо
 *  одно значение на все (тогда размножаем). */
function setAttribute(
  geometry: THREE.BufferGeometry,
  name: string,
  values: ArrayLike<number>,
  itemSize: number,
): void {
  const count = geometry.attributes.position.count;
  const array = values.length === count * itemSize ? values : fill(count, itemSize, values);
  geometry.setAttribute(name, new THREE.BufferAttribute(Float32Array.from(array), itemSize));
}

function colorAttribute(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const flat = flatten(geometry);
  const color = linearColor(hex);
  setAttribute(flat, 'color', [color.r, color.g, color.b], 3);
  return flat;
}

// ————————————————————————————————————————————————————————————————
// Ткань: один материал, цвет в вершинах, ветер в шейдере
// ————————————————————————————————————————————————————————————————

interface ClothTag {
  readonly phase: number;
  readonly speed: number;
  readonly amplitude: number;
  readonly color: number;
}

/** Полотнище-сетка с весом ветра по оси (`x` — от древка, `y` — сверху вниз,
 *  `radial` — от центра зонта к кромке). */
function cloth(
  width: number,
  height: number,
  columns: number,
  rows: number,
  axis: 'x' | 'y' | 'radial',
  tag: ClothTag,
  place?: (geometry: THREE.BufferGeometry) => void,
): THREE.BufferGeometry {
  // Считаем вес ветра на «плоской» сетке до переноса в мир: иначе у флага на
  // другом конце острова вес считался бы от мирового нуля.
  const flat = flatten(new THREE.PlaneGeometry(width, height, columns, rows));
  const position = flat.attributes.position;
  const wind: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    if (axis === 'x') wind.push(THREE.MathUtils.clamp(x / width + 0.5, 0, 1));
    else if (axis === 'y') wind.push(THREE.MathUtils.clamp(0.5 - y / height, 0, 1));
    else wind.push(THREE.MathUtils.clamp(Math.hypot(x / (width / 2), y / (height / 2)) * 0.5, 0, 1));
  }
  if (place) place(flat);
  const color = linearColor(tag.color);
  setAttribute(flat, 'color', [color.r, color.g, color.b], 3);
  setAttribute(flat, 'aWind', wind, 1);
  setAttribute(flat, 'aPhase', [tag.phase], 1);
  setAttribute(flat, 'aSpeed', [tag.speed], 1);
  setAttribute(flat, 'aAmp', [tag.amplitude], 1);
  return flat;
}

/** Докрасить примитив сцены (конус зонта, треугольник флажка) как ткань. */
function tagCloth(geometry: THREE.BufferGeometry, axis: 'x' | 'y' | 'radial', tag: ClothTag): THREE.BufferGeometry {
  const flat = flatten(geometry);
  const position = flat.attributes.position;
  const bounds = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
  const count = position.count;
  const wind: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (axis === 'x') {
      wind.push((position.getX(i) - bounds.min.x) / Math.max(0.001, bounds.max.x - bounds.min.x));
    } else if (axis === 'y') {
      wind.push((bounds.max.y - position.getY(i)) / Math.max(0.001, bounds.max.y - bounds.min.y));
    } else {
      const radius = Math.max(0.001, Math.max(bounds.max.x, bounds.max.z));
      wind.push(THREE.MathUtils.clamp(Math.hypot(position.getX(i), position.getZ(i)) / radius, 0, 1));
    }
  }
  const color = linearColor(tag.color);
  setAttribute(flat, 'color', [color.r, color.g, color.b], 3);
  setAttribute(flat, 'aWind', wind, 1);
  setAttribute(flat, 'aPhase', [tag.phase], 1);
  setAttribute(flat, 'aSpeed', [tag.speed], 1);
  setAttribute(flat, 'aAmp', [tag.amplitude], 1);
  return flat;
}

function makeClothMaterial(clock: Clock): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0,
    sheen: 0.5,
    sheenRoughness: 0.6,
    envMapIntensity: 0.85,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock.uniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        attribute float aWind;
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aAmp;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float weight = aWind * aWind;
        float t = uTime * aSpeed + aPhase;
        // Медленный «парус» и быстрая рябь по свободной кромке
        float slow = sin(t * 1.6 + position.x * 0.55 + position.y * 1.9);
        float fast = sin(t * 5.3 + position.x * 2.4 + aPhase * 1.3);
        transformed.x += (slow * 0.8 + fast * 0.3) * weight * aAmp;
        transformed.z += (cos(t * 1.1) * 0.7 + fast * 0.25) * weight * aAmp * 0.75;
        transformed.y -= abs(slow) * weight * aAmp * 0.3;`,
      );
  };
  material.customProgramCacheKey = () => 'details-cloth';
  return material;
}

// ————————————————————————————————————————————————————————————————
// Флот: качка и паруса в шейдере
// ————————————————————————————————————————————————————————————————

interface BoatSpec {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly heading: number;
  readonly mast: boolean;
  readonly hull: number;
  readonly sail: number;
  readonly phase: number;
}

interface FleetTag {
  readonly center: THREE.Vector3;
  readonly phase: number;
  readonly amplitude: number;
  readonly roll: number;
  readonly pitch: number;
}

/** Привести кусок флота к общему набору атрибутов: у парусов ветер есть,
 *  у корпуса — нули, но набор обязан совпадать, иначе merge не сработает. */
function normalizeFleet(part: THREE.BufferGeometry, phase: number): THREE.BufferGeometry {
  const flat = flatten(part);
  if (!flat.getAttribute('color')) setAttribute(flat, 'color', [1, 1, 1], 3);
  if (!flat.getAttribute('aWind')) setAttribute(flat, 'aWind', [0], 1);
  if (!flat.getAttribute('aPhase')) setAttribute(flat, 'aPhase', [phase], 1);
  if (!flat.getAttribute('aSpeed')) setAttribute(flat, 'aSpeed', [0.9], 1);
  if (!flat.getAttribute('aAmp')) setAttribute(flat, 'aAmp', [0], 1);
  return flat;
}

/** Качка задаётся константами на весь корпус — их и размножаем по вершинам. */
function applyBoatTag(geometry: THREE.BufferGeometry, tag: FleetTag): THREE.BufferGeometry {
  setAttribute(geometry, 'aBoatCenter', [tag.center.x, tag.center.y, tag.center.z], 3);
  setAttribute(geometry, 'aBoatPhase', [tag.phase], 1);
  setAttribute(geometry, 'aBoatAmp', [tag.amplitude], 1);
  setAttribute(geometry, 'aBoatRoll', [tag.roll], 1);
  setAttribute(geometry, 'aBoatPitch', [tag.pitch], 1);
  return geometry;
}

function makeFleetMaterial(clock: Clock): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.42,
    metalness: 0.05,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
    envMapIntensity: 1.15,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock.uniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        attribute vec3 aBoatCenter;
        attribute float aBoatPhase;
        attribute float aBoatAmp;
        attribute float aBoatRoll;
        attribute float aBoatPitch;
        attribute float aWind;
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aAmp;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float bt = uTime * 0.85 + aBoatPhase;
        vec3 local = transformed - aBoatCenter;
        // Качка: подъём, бортовая и килевая
        local.y += sin(bt) * aBoatAmp;
        float pitch = cos(bt * 0.7) * aBoatPitch;
        float roll = sin(bt * 0.9 + 0.6) * aBoatRoll;
        float cp = cos(pitch), sp = sin(pitch);
        float cr = cos(roll), sr = sin(roll);
        local = vec3(local.x, local.y * cp - local.z * sp, local.y * sp + local.z * cp);
        local = vec3(local.x * cr - local.y * sr, local.x * sr + local.y * cr, local.z);
        // Паруса: ткань колышется относительно мачты
        float weight = aWind * aWind;
        float st = uTime * aSpeed + aPhase;
        local.x += sin(st * 1.6 + local.z * 0.4) * weight * aAmp;
        local.z += cos(st * 1.1) * weight * aAmp * 0.7;
        transformed = aBoatCenter + local;`,
      );
  };
  material.customProgramCacheKey = () => 'details-fleet';
  return material;
}

function boatGeometry(spec: BoatSpec): { geometry: THREE.BufferGeometry; tag: FleetTag } {
  const parts: THREE.BufferGeometry[] = [];
  const length = 4.6 * spec.scale;
  const beam = 1.7 * spec.scale;
  const depth = 0.75 * spec.scale;

  // Корпус: три бруса разной ширины + скошенный нос
  parts.push(colorAttribute(box(length, depth * 0.55, beam, 0, depth * 0.05, 0), spec.hull));
  parts.push(colorAttribute(box(length * 0.72, depth * 0.5, beam * 0.78, 0, depth * 0.45, 0), spec.hull));
  parts.push(colorAttribute(box(length * 0.98, 0.06 * spec.scale, beam * 1.04, 0, depth * 0.62, 0), 0xe8e2d5));
  const bow = new THREE.ConeGeometry(beam * 0.42, length * 0.32, 4, 1);
  bow.rotateZ(-Math.PI / 2);
  bow.rotateY(Math.PI / 4);
  bow.translate(length * 0.42, depth * 0.3, 0);
  parts.push(colorAttribute(bow, spec.hull));

  if (spec.mast) {
    const mastHeight = 5.4 * spec.scale;
    parts.push(colorAttribute(cylinder(0.05 * spec.scale, 0.065 * spec.scale, mastHeight, 0, depth * 0.6, 0, 8), 0xb9b6ad));
    parts.push(colorAttribute(box(length * 0.42, 0.07, 0.07, -length * 0.16, depth * 0.6 + mastHeight * 0.52, 0), 0xb9b6ad));

    // Паруса: полотнище колышется, вес ветра — от верхней шкаторины вниз
    const main = cloth(2.5 * spec.scale, 3.4 * spec.scale, 8, 10, 'y', {
      phase: spec.phase + 0.5,
      speed: 0.85,
      amplitude: 0.11,
      color: spec.sail,
    }, (geometry) => {
      geometry.rotateY(Math.PI / 2);
      geometry.translate(length * 0.06 - length * 0.14, depth * 0.6 + mastHeight * 0.5, 0);
    });
    parts.push(main);
    const jib = cloth(1.5 * spec.scale, 2.4 * spec.scale, 6, 8, 'y', {
      phase: spec.phase + 2.1,
      speed: 0.95,
      amplitude: 0.14,
      color: spec.sail,
    }, (geometry) => {
      geometry.rotateY(Math.PI / 2);
      geometry.translate(length * 0.06 + length * 0.28, depth * 0.6 + mastHeight * 0.34, 0);
    });
    parts.push(jib);
  }

  const prepared = parts.map((part) => normalizeFleet(part, spec.phase));
  const merged = mergeGeometries(prepared, false) ?? prepared[0];
  prepared.forEach((part) => {
    if (part !== merged) part.dispose();
  });

  merged.rotateY(spec.heading);
  merged.translate(spec.x, 0, spec.z);
  const tag: FleetTag = {
    center: new THREE.Vector3(spec.x, 0, spec.z),
    phase: spec.phase,
    amplitude: 0.09 + spec.scale * 0.05,
    roll: 0.05,
    pitch: 0.03,
  };
  return { geometry: applyBoatTag(merged, tag), tag };
}

// ————————————————————————————————————————————————————————————————
// Чайки
// ————————————————————————————————————————————————————————————————

interface Gull {
  readonly center: THREE.Vector3;
  readonly radius: number;
  readonly speed: number;
  readonly phase: number;
  readonly scale: number;
}

function buildGulls(gulls: readonly Gull[], clock: Clock, disposables: Disposable[]): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const gull of gulls) {
    const body = new THREE.OctahedronGeometry(0.24, 0);
    body.scale(0.55 * gull.scale, 0.52 * gull.scale, 1.5 * gull.scale);
    parts.push(body);
    for (const side of [-1, 1]) {
      const wing = new THREE.BufferGeometry();
      wing.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            0, 0, 0.12 * gull.scale,
            0, 0, -0.2 * gull.scale,
            side * 1.05 * gull.scale, 0.02 * gull.scale, -0.05 * gull.scale,
          ],
          3,
        ),
      );
      wing.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      wing.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      parts.push(wing);
    }
  }

  const positioned: THREE.BufferGeometry[] = [];
  const glide: number[] = [];
  const phase: number[] = [];
  const center: number[] = [];
  const radius: number[] = [];
  const speed: number[] = [];
  for (const gull of gulls) {
    for (const part of parts.splice(0, 3)) {
      const flat = part.index ? part.toNonIndexed() : part;
      if (flat !== part) part.dispose();
      const count = flat.attributes.position.count;
      const position = flat.attributes.position;
      for (let i = 0; i < count; i += 1) {
        glide.push(Math.min(1, Math.abs(position.getX(i)) / (1.05 * gull.scale)));
        phase.push(gull.phase);
        center.push(gull.center.x, gull.center.y, gull.center.z);
        radius.push(gull.radius);
        speed.push(gull.speed);
      }
      positioned.push(flat);
    }
  }

  const geometry = mergeGeometries(positioned, false);
  positioned.forEach((part) => part.dispose());
  if (!geometry) return null;
  geometry.setAttribute('aGlide', new THREE.BufferAttribute(Float32Array.from(glide), 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(Float32Array.from(phase), 1));
  geometry.setAttribute('aCenter', new THREE.BufferAttribute(Float32Array.from(center), 3));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(Float32Array.from(radius), 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(Float32Array.from(speed), 1));
  geometry.computeVertexNormals();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 14, -12), 320);

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: clock.uniform },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aGlide;
      attribute float aPhase;
      attribute vec3 aCenter;
      attribute float aRadius;
      attribute float aSpeed;
      varying float vGlide;
      void main() {
        float theta = uTime * aSpeed + aPhase;
        vec3 forward = normalize(vec3(-sin(theta), 0.0, cos(theta)));
        vec3 right = vec3(cos(theta), 0.0, sin(theta));
        vec3 up = vec3(0.0, 1.0, 0.0);
        float flap = sin(uTime * 6.2 + aPhase * 4.0);
        vec3 local = position;
        local.y += aGlide * flap * 0.55;
        local.x *= 1.0 + aGlide * flap * 0.08;
        vec3 middle = aCenter + vec3(cos(theta), 0.0, sin(theta)) * aRadius;
        middle.y += sin(theta * 1.7 + aPhase * 3.0) * 1.8;
        vec3 world = middle + right * local.x + up * local.y + forward * local.z;
        vGlide = aGlide;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vGlide;
      void main() {
        vec3 base = mix(vec3(0.92, 0.93, 0.94), vec3(0.55, 0.6, 0.65), vGlide * 0.85);
        gl_FragColor = vec4(base * 0.94, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  disposables.push(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'detail-gulls';
  mesh.frustumCulled = false;
  return mesh;
}

// ————————————————————————————————————————————————————————————————
// Фонтан
// ————————————————————————————————————————————————————————————————

interface Fountain {
  readonly water: THREE.Mesh;
  readonly spray: THREE.Points;
}

function buildFountain(
  buckets: Buckets,
  materials: IslandMaterials,
  clock: Clock,
  disposables: Disposable[],
  x: number,
  z: number,
): Fountain {
  const top = GROUND;
  const radius = 3.1;
  buckets.add(materials.stone, cylinder(radius, radius, 0.44, x, top, z, 32));
  buckets.add(materials.stone, cylinder(radius - 0.42, radius - 0.42, 0.4, x, top, z, 28));
  buckets.add(materials.stone, cylinder(radius - 0.3, radius - 0.3, 0.12, x, top - 0.02, z, 28));
  buckets.add(materials.stone, cylinder(radius + 0.9, radius + 1.0, 0.16, x, top - 0.08, z, 32));
  for (let i = 0; i < 3; i += 1) {
    buckets.add(materials.stone, box(2.2 - i * 0.5, 0.16, 0.5, x, top + i * 0.16, z + radius + 1.1 - i * 0.45));
  }
  buckets.add(materials.stone, cylinder(0.42, 0.62, 1.15, x, top + 0.3, z, 16));
  buckets.add(materials.stone, cylinder(1.15, 0.55, 0.28, x, top + 1.35, z, 20));
  buckets.add(materials.stone, cylinder(0.28, 0.4, 0.9, x, top + 1.5, z, 12));

  // Вода в чаше: живая рябь и блик солнца
  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: clock.uniform, uSun: { value: new THREE.Vector3(0.42, 0.66, 0.35).normalize() } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSun;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float d = length(p) * 2.0;
        float ripple = sin(d * 26.0 - uTime * 4.4) * 0.5 + sin(d * 15.0 - uTime * 2.9) * 0.5;
        vec3 normal = normalize(vec3(p.x * ripple * 0.6, 1.0, p.y * ripple * 0.6));
        float fresnel = pow(1.0 - clamp(normal.y, 0.0, 1.0), 2.0);
        vec3 water = mix(vec3(0.03, 0.29, 0.36), vec3(0.55, 0.8, 0.86), fresnel * 1.8 + 0.15);
        float glint = pow(max(dot(reflect(-uSun, normal), vec3(0.0, 1.0, 0.0)), 0.0), 42.0) * 2.4;
        float rings = smoothstep(0.7, 1.0, sin(d * 30.0 - uTime * 6.0)) * 0.1 * smoothstep(0.95, 0.2, d);
        gl_FragColor = vec4(water + glint + rings, 0.95);
      }
    `,
  });
  disposables.push(waterMaterial);
  const water = new THREE.Mesh(new THREE.CircleGeometry(radius - 0.45, 40).rotateX(-Math.PI / 2), waterMaterial);
  water.position.set(x, top + 0.4, z);
  water.name = 'detail-fountain-water';
  water.receiveShadow = false;
  water.renderOrder = 2;

  // Струи: точки с баллистикой в шейдере
  const jets = 10;
  const perJet = 24;
  const count = jets * perJet;
  const positions = new Float32Array(count * 3);
  const origins = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  for (let jet = 0; jet < jets; jet += 1) {
    const angle = (jet / jets) * Math.PI * 2;
    const out = 1.5 + (jet % 3) * 0.24;
    for (let i = 0; i < perJet; i += 1) {
      const index = jet * perJet + i;
      origins[index * 3] = x + Math.cos(angle) * 0.22;
      origins[index * 3 + 1] = top + 2.3;
      origins[index * 3 + 2] = z + Math.sin(angle) * 0.22;
      velocities[index * 3] = Math.cos(angle) * out;
      velocities[index * 3 + 1] = 2.4 + (i % 5) * 0.14;
      velocities[index * 3 + 2] = Math.sin(angle) * out;
      phases[index] = i / perJet;
      speeds[index] = 0.7 + (i % 4) * 0.07;
      sizes[index] = 2.2 + (i % 3) * 0.5;
    }
  }
  const jetGeometry = new THREE.BufferGeometry();
  jetGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  jetGeometry.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 3));
  jetGeometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
  jetGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  jetGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  jetGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  jetGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, top + 2, z), 9);

  const jetMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: clock.uniform },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec3 aOrigin;
      attribute vec3 aVelocity;
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;
      varying float vLife;
      void main() {
        float life = fract(uTime * aSpeed + aPhase);
        vec3 p = aOrigin + aVelocity * life + vec3(0.0, -4.9 * life * life, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = max(1.0, (aSize * 24.0) / -mv.z);
        gl_Position = projectionMatrix * mv;
        vLife = life;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        float mask = smoothstep(0.5, 0.06, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(0.86, 0.96, 1.0), mask * (1.0 - vLife) * 0.55);
      }
    `,
  });
  disposables.push(jetMaterial);
  const spray = new THREE.Points(jetGeometry, jetMaterial);
  spray.name = 'detail-fountain-spray';

  return { water, spray };
}

// ————————————————————————————————————————————————————————————————
// Сборка
// ————————————————————————————————————————————————————————————————

export function buildDetails(materials: IslandMaterials): DetailsResult {
  const group = new THREE.Group();
  group.name = 'details';
  const clock: Clock = { uniform: { value: 0 } };
  const disposables: Disposable[] = [];
  const buckets = new Buckets();
  const clothParts: THREE.BufferGeometry[] = [];
  const occupied: Rect[] = [];

  // ——— 1. Причал на северной кромке ———
  const pierX = 4;
  const pierStart = -44;
  const pierEnd = -64;
  {
    const width = 3.2;
    const length = pierStart - pierEnd;
    for (let i = 0; i < Math.floor(length / 0.34); i += 1) {
      // Верх доски на 3 см выше газона: копланарных граней нет (z-fight)
      buckets.add(materials.wood, box(width, 0.09, 0.3, pierX, GROUND - 0.015, pierStart - i * 0.34 - 0.17));
    }
    for (let z = pierStart - 0.6; z > pierEnd; z -= 3) {
      for (const side of [-1, 1]) {
        // Верх сваи на 5 см ниже газона — укрыт настилом и не спорит с ним по глубине
        buckets.add(materials.wood, cylinder(0.11, 0.13, GROUND + 1.55, pierX + side * (width / 2 - 0.28), -1.6, z, 8));
      }
    }
    for (const side of [-1, 1]) {
      const railX = pierX + side * (width / 2 - 0.12);
      for (let z = pierStart - 1.2; z > pierEnd; z -= 2.4) {
        buckets.add(materials.metal, cylinder(0.045, 0.05, 0.95, railX, GROUND, z, 6));
      }
      buckets.add(materials.metal, box(0.09, 0.09, length - 1.2, railX, GROUND + 0.95, pierStart - length / 2));
    }
    buckets.add(materials.wood, box(width + 0.6, 0.12, 1.4, pierX, GROUND - 0.02, pierStart + 0.6));
    occupied.push({ minX: pierX - 2.2, maxX: pierX + 2.2, minZ: pierEnd - 1, maxZ: pierStart + 1.5 });
  }

  // ——— 2. Флаги:причал, парк, стадион, площадь ———
  const flagSpots: Array<{ x: number; z: number; height: number; color: number }> = [
    { x: pierX, z: pierEnd + 0.6, height: 6.4, color: 0xf2705b },
    { x: -30, z: -33.5, height: 5.6, color: 0x3fb8b0 },
    { x: 26, z: -33.5, height: 5.6, color: 0xf5d9a6 },
    { x: STADIUM.driveX - 9, z: 5, height: 7, color: 0xf2705b },
    { x: -56.5, z: 15.5, height: 5.4, color: 0x3fb8b0 },
  ];
  flagSpots.forEach((spot, index) => {
    buckets.add(materials.metal, cylinder(0.055, 0.085, spot.height, spot.x, GROUND, spot.z, 10));
    buckets.add(materials.brass, new THREE.SphereGeometry(0.11, 10, 8).translate(spot.x, GROUND + spot.height + 0.08, spot.z));
    clothParts.push(
      cloth(1.9, 1.15, 10, 6, 'x', { phase: index * 1.7, speed: 1.15, amplitude: 0.19, color: spot.color }, (geometry) => {
        geometry.translate(0.95, 0, 0);
        geometry.rotateY(Math.PI / 2);
        geometry.translate(spot.x + 0.06, GROUND + spot.height - 0.72, spot.z);
      }),
    );
  });

  // ——— 3. Гирлянды над парком (столбы — концы пролётов) ———
  const garlandSpans = [
    { from: new THREE.Vector3(-30, GROUND + 5.45, -33.5), to: new THREE.Vector3(-10, GROUND + 5.05, -36.5), sag: 0.9, pennants: 17 },
    { from: new THREE.Vector3(-10, GROUND + 5.05, -36.5), to: new THREE.Vector3(8, GROUND + 5.25, -33.8), sag: 0.85, pennants: 16 },
    { from: new THREE.Vector3(8, GROUND + 5.25, -33.8), to: new THREE.Vector3(26, GROUND + 5.45, -33.5), sag: 0.9, pennants: 17 },
  ];
  const pennantColors = [0xf2705b, 0xf5d9a6, 0x3fb8b0, 0xffffff];
  const poleKeys = new Set<string>();
  garlandSpans.forEach((span, spanIndex) => {
    // Столбы на концах пролёта (без дублей — иначе z-fight)
    for (const anchor of [span.from, span.to]) {
      const key = `${anchor.x.toFixed(1)}:${anchor.z.toFixed(1)}`;
      if (poleKeys.has(key)) continue;
      poleKeys.add(key);
      const height = anchor.y - GROUND;
      if (height > 0.5) {
        buckets.add(materials.metal, cylinder(0.05, 0.075, height, anchor.x, GROUND, anchor.z, 8));
      }
    }
    const steps = 10;
    let previous = new THREE.Vector3();
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const point = new THREE.Vector3(
        THREE.MathUtils.lerp(span.from.x, span.to.x, t),
        THREE.MathUtils.lerp(span.from.y, span.to.y, t) - Math.sin(t * Math.PI) * span.sag,
        THREE.MathUtils.lerp(span.from.z, span.to.z, t),
      );
      if (i > 0) {
        const wireLength = previous.distanceTo(point);
        const wire = new THREE.CylinderGeometry(0.012, 0.012, wireLength, 4, 1);
        wire.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), point.clone().sub(previous).normalize()),
        );
        const mid = previous.clone().add(point).multiplyScalar(0.5);
        wire.translate(mid.x, mid.y, mid.z);
        buckets.add(materials.metal, wire);
      }
      previous = point;
    }
    const heading = Math.atan2(span.to.x - span.from.x, span.to.z - span.from.z);
    for (let i = 1; i < span.pennants; i += 1) {
      const t = i / span.pennants;
      const x = THREE.MathUtils.lerp(span.from.x, span.to.x, t);
      const z = THREE.MathUtils.lerp(span.from.z, span.to.z, t);
      const y = THREE.MathUtils.lerp(span.from.y, span.to.y, t) - Math.sin(t * Math.PI) * span.sag;
      const triangle = new THREE.BufferGeometry();
      triangle.setAttribute('position', new THREE.Float32BufferAttribute([-0.16, 0, 0, 0.16, 0, 0, 0, -0.42, 0], 3));
      triangle.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      triangle.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
      triangle.rotateX(-Math.PI / 2);
      triangle.rotateY(heading);
      triangle.translate(x, y, z);
      clothParts.push(
        tagCloth(triangle, 'y', {
          phase: spanIndex * 3.1 + i * 0.7,
          speed: 1.6,
          amplitude: 0.1,
          color: pennantColors[i % pennantColors.length],
        }),
      );
    }
  });

  // ——— 4. Пикник в парке ———
  const picnicSpots = [
    { x: -26, z: -38, rotationY: 0.15, umbrella: 0xf5f2e8 },
    { x: -16, z: -40.5, rotationY: -0.2, umbrella: 0xef7f6b },
    { x: -4, z: -36.5, rotationY: 0.05, umbrella: 0xf5f2e8 },
    { x: 10, z: -40, rotationY: 0.25, umbrella: 0x3fb8b0 },
    { x: 22, z: -37.5, rotationY: -0.15, umbrella: 0xf5f2e8 },
  ];
  picnicSpots.forEach((spot, index) => {
    buckets.add(materials.oakFurniture, box(1.6, 0.08, 0.9, spot.x, GROUND + 0.74, spot.z, spot.rotationY));
    for (const side of [-1, 1]) {
      const bench = offsetPoint(spot.x, spot.z, 0, side * 0.78, spot.rotationY);
      buckets.add(materials.oakFurniture, box(1.6, 0.07, 0.32, bench.x, GROUND + 0.44, bench.z, spot.rotationY));
      for (const along of [-0.62, 0.62]) {
        const leg = offsetPoint(spot.x, spot.z, along, side * 0.78, spot.rotationY);
        buckets.add(materials.metal, box(0.06, 0.7, 0.9, leg.x, GROUND + 0.34, leg.z, spot.rotationY));
      }
    }
    buckets.add(materials.metal, cylinder(0.035, 0.045, 2.35, spot.x, GROUND, spot.z, 8));
    // Вес ветра считается в локальных координатах конуса, потом переносим
    const canopy = tagCloth(new THREE.ConeGeometry(1.75, 0.62, 12, 1, true), 'radial', {
      phase: index * 1.9,
      speed: 1.3,
      amplitude: 0.08,
      color: spot.umbrella,
    });
    canopy.translate(spot.x, GROUND + 2.2, spot.z);
    canopy.rotateY(spot.rotationY + index);
    clothParts.push(canopy);
    occupied.push({ minX: spot.x - 2.1, maxX: spot.x + 2.1, minZ: spot.z - 2.6, maxZ: spot.z + 2.6 });
  });

  // ——— 5. Бельевые верёвки на западной кромке парка ———
  const laundryLines = [
    { from: new THREE.Vector3(-34, GROUND + 2.1, -42), to: new THREE.Vector3(-26, GROUND + 2.05, -43.5), sag: 0.26, items: 6 },
    { from: new THREE.Vector3(-24, GROUND + 2.1, -44), to: new THREE.Vector3(-16.5, GROUND + 2.05, -45), sag: 0.24, items: 5 },
  ];
  const laundryColors = [0xf4f1ea, 0xf3c9b6, 0x9fc7c9, 0xe8d8a8];
  laundryLines.forEach((line, lineIndex) => {
    for (const anchor of [line.from, line.to]) {
      buckets.add(materials.metal, cylinder(0.06, 0.075, 2.15, anchor.x, GROUND, anchor.z, 8));
    }
    let previous = line.from.clone();
    for (let i = 1; i <= 8; i += 1) {
      const t = i / 8;
      const point = new THREE.Vector3(
        THREE.MathUtils.lerp(line.from.x, line.to.x, t),
        THREE.MathUtils.lerp(line.from.y, line.to.y, t) - Math.sin(t * Math.PI) * line.sag,
        THREE.MathUtils.lerp(line.from.z, line.to.z, t),
      );
      const wireLength = previous.distanceTo(point);
      const wire = new THREE.CylinderGeometry(0.008, 0.008, wireLength, 3, 1);
      wire.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), point.clone().sub(previous).normalize()),
      );
      const mid = previous.clone().add(point).multiplyScalar(0.5);
      wire.translate(mid.x, mid.y, mid.z);
      buckets.add(materials.metal, wire);
      previous = point;
    }
    for (let i = 1; i < line.items; i += 1) {
      const t = i / line.items;
      const x = THREE.MathUtils.lerp(line.from.x, line.to.x, t);
      const z = THREE.MathUtils.lerp(line.from.z, line.to.z, t);
      const y = THREE.MathUtils.lerp(line.from.y, line.to.y, t) - Math.sin(t * Math.PI) * line.sag;
      const width = 0.42 + (i % 3) * 0.1;
      const height = 0.55 + (i % 4) * 0.08;
      clothParts.push(
        cloth(width, height, 3, 4, 'y', {
          phase: lineIndex * 2.3 + i * 1.1,
          speed: 1.5,
          amplitude: 0.13,
          color: laundryColors[i % laundryColors.length],
        }, (geometry) => geometry.translate(x, y - height / 2, z)),
      );
    }
  });
  occupied.push({ minX: -35, maxX: -16, minZ: -46, maxZ: -40.5 });

  // ——— 6. Площадь с фонтаном в западном кармане ———
  const fountain = buildFountain(buckets, materials, clock, disposables, -62, 8);
  group.add(fountain.water, fountain.spray);
  occupied.push({ minX: -66.5, maxX: -57.5, minZ: 3.5, maxZ: 12.5 });

  // ——— 7. Рыночный лоток в восточном кармане ———
  {
    const kioskX = 69.5;
    const kioskZ = 15;
    const rotationY = -0.6;
    const width = 3.4;
    const depth = 2.2;
    buckets.add(materials.wood, box(width, 1.05, depth, kioskX, GROUND + 0.5, kioskZ, rotationY));
    buckets.add(materials.white, box(width + 0.3, 0.1, depth + 0.3, kioskX, GROUND + 1.06, kioskZ, rotationY));
    for (const side of [-1, 1]) {
      const post = offsetPoint(kioskX, kioskZ, side * (width / 2 - 0.12), depth / 2 - 0.15, rotationY);
      buckets.add(materials.metal, cylinder(0.05, 0.06, 2.5, post.x, GROUND, post.z, 8));
    }
    for (let i = 0; i < 3; i += 1) {
      const crate = offsetPoint(kioskX, kioskZ, (i - 1) * 0.62, 0.5, rotationY);
      buckets.add(materials.terracotta, box(0.44, 0.3, 0.36, crate.x, GROUND + 1.28, crate.z, rotationY));
    }
    // Полосатый навес
    const stripes = 6;
    for (let i = 0; i < stripes; i += 1) {
      const stripe = cloth(width / stripes, depth + 0.9, 2, 6, 'y', {
        phase: i * 0.8,
        speed: 1.4,
        amplitude: 0.07,
        color: i % 2 === 0 ? 0xef7f6b : 0xf5f2e8,
      }, (geometry) => {
        geometry.rotateX(-0.28);
        geometry.translate((i - (stripes - 1) / 2) * (width / stripes), 2.55, 0.1);
        geometry.rotateY(rotationY);
        geometry.translate(kioskX, GROUND, kioskZ);
      });
      clothParts.push(stripe);
    }
    buckets.add(materials.magenta, box(1.9, 0.62, 0.08, kioskX, GROUND + 2.95, kioskZ, rotationY));
    occupied.push({ minX: kioskX - 3, maxX: kioskX + 3, minZ: kioskZ - 2.6, maxZ: kioskZ + 2.6 });
  }

  // ——— 8. Флот: парусники, лодка у причала, буи — один меш ———
  const fleetParts: THREE.BufferGeometry[] = [];
  const boats: BoatSpec[] = [
    { x: -34, z: -74, scale: 1.15, heading: 0.6, mast: true, hull: 0xf4f1ea, sail: 0xf7f3e8, phase: 0.4 },
    { x: 46, z: -66, scale: 0.95, heading: -1.1, mast: true, hull: 0x2f6f7a, sail: 0xf4e6c8, phase: 2.3 },
    { x: 62, z: 34, scale: 0.85, heading: 2.4, mast: true, hull: 0xef7f6b, sail: 0xf7f3e8, phase: 4.1 },
    { x: pierX - 1.8, z: pierEnd - 2.5, scale: 0.5, heading: 0.1, mast: false, hull: 0xf4f1ea, sail: 0xf7f3e8, phase: 1.2 },
  ];
  for (const spec of boats) {
    const { geometry } = boatGeometry(spec);
    fleetParts.push(geometry);
  }
  // Буи качаются тем же шейдером
  for (const spot of [
    { x: -22, z: -70, phase: 0.9 },
    { x: 20, z: -76, phase: 3.2 },
    { x: 54, z: 44, phase: 5.1 },
  ]) {
    const buoy = mergeGeometries(
      [
        colorAttribute(new THREE.SphereGeometry(0.34, 10, 8).translate(spot.x, 0.16, spot.z), 0xef7f5b),
        colorAttribute(cylinder(0.06, 0.06, 0.5, spot.x, 0.2, spot.z, 6), 0xef7f5b),
      ],
      false,
    );
    if (buoy) {
      fleetParts.push(
        applyBoatTag(normalizeFleet(buoy, spot.phase), {
          center: new THREE.Vector3(spot.x, 0, spot.z),
          phase: spot.phase,
          amplitude: 0.22,
          roll: 0.12,
          pitch: 0.1,
        }),
      );
    }
  }
  const fleetGeometry = mergeGeometries(fleetParts, false);
  fleetParts.forEach((part) => part.dispose());
  if (fleetGeometry) {
    const fleetMaterial = makeFleetMaterial(clock);
    disposables.push(fleetMaterial);
    const fleet = new THREE.Mesh(fleetGeometry, fleetMaterial);
    fleet.name = 'detail-fleet';
    fleet.castShadow = false;
    fleet.receiveShadow = false;
    group.add(fleet);
  }

  // ——— 9. Чайки над берегом ———
  const gulls: Gull[] = [];
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2;
    gulls.push({
      center: new THREE.Vector3(Math.cos(angle) * 26, 13 + (i % 4) * 2.4, Math.sin(angle) * 18 - 12),
      radius: 10 + (i % 5) * 3.6,
      speed: 0.11 + (i % 5) * 0.022,
      phase: angle * 1.7,
      scale: 0.85 + (i % 3) * 0.12,
    });
  }
  const gullMesh = buildGulls(gulls, clock, disposables);
  if (gullMesh) group.add(gullMesh);

  // ——— склейка: статика по материалам, ткань одним мешем ———
  buckets.flush(group, 'detail-static');
  if (clothParts.length > 0) {
    const clothGeometry = mergeGeometries(clothParts, false);
    clothParts.forEach((part) => part.dispose());
    if (clothGeometry) {
      const clothMaterial = makeClothMaterial(clock);
      disposables.push(clothMaterial);
      const mesh = new THREE.Mesh(clothGeometry, clothMaterial);
      mesh.name = 'detail-cloth';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  let drawMeshes = 0;
  group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) drawMeshes += 1;
  });

  const animated = 5 + 50 + 5 + 11 + 6 + 240 + gulls.length + boats.length + 3;

  return {
    group,
    occupied,
    animated,
    drawMeshes,
    update(elapsed: number, eye?: THREE.Vector3): void {
      clock.uniform.value = elapsed;
      if (eye) {
        // Чайки и струи — мелочь в пару пикселей: с другого края острова не нужны
        if (gullMesh) gullMesh.visible = eye.distanceTo(new THREE.Vector3(0, 14, -12)) < 220;
        fountain.spray.visible = eye.distanceTo(new THREE.Vector3(-62, 4, 8)) < 90;
      }
    },
    dispose(): void {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      for (const item of disposables) item.dispose();
    },
  };
}
