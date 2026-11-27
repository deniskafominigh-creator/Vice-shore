import * as THREE from 'three';
import { ISLAND, TERRACE } from '../../core/Config';
import type { Rect } from './GrassField';

/**
 * Дикая флора (сборка v16): луговая трава другого вида, камыш у воды и три вида
 * цветов — ромашки, маки, лаванда.
 *
 *  Зачем отдельный модуль, если есть `GrassField`: у газона одна текстура и один
 *  вид пучка, и остров между домами читался как «пустая зелёная скатерть».
 *  Здесь те же приёмы (крестовина, alpha test, ветер в вершинном шейдере,
 *  инстансы), но каждый вид — своя текстура, свой размер и свой ареал:
 *   • луговая трава сеется везде, где не занято;
 *   • камыш — только у кромки острова, где начинается обрыв;
 *   • цветы растут кучками: ромашки по лугам, маки ближе к обрыву, лаванда —
 *     вдоль стен домов.
 *
 *  Бюджет кадра (главное отличие от газона):
 *   • **один меш на вид** — вся флора острова это 5 draw calls, а не 29 чанков;
 *   • дальность считается в вершинном шейдере по позиции инстанса: за
 *     `viewDistance` растение схлопывается в точку нулевой площади и не доходит
 *     до растеризации. Поэтому далёкие цветы не стоят ничего, а CPU не считает
 *     видимость по 7800 растениям каждый кадр;
 *   • 4 треугольника на растение — вся флора это ~42 тысячи треугольников;
 *   • материал, геометрия и текстура общие на вид: пять шейдеров на всю сцену.
 */

export interface FloraSpeciesReport {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly triangles: number;
}

export interface FloraResult {
  readonly group: THREE.Group;
  /** Сколько растений посеяно всего. */
  readonly instances: number;
  /** Сколько мешей получилось (по одному на вид). */
  readonly meshes: number;
  readonly triangles: number;
  readonly species: readonly FloraSpeciesReport[];
  /** Ветер: время для шейдера. Дальность режется в шейдере по камере. */
  update(elapsed: number): void;
  dispose(): void;
}

type Painter = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => void;

interface SpeciesSpec {
  readonly id: string;
  readonly label: string;
  /** Ширина и высота крестовины, м. */
  readonly width: number;
  readonly height: number;
  readonly count: number;
  readonly viewDistance: number;
  readonly patchSize: readonly [number, number];
  readonly patchRadius: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly stretch: readonly [number, number];
  readonly hue: readonly [number, number];
  readonly sat: readonly [number, number];
  readonly light: readonly [number, number];
  /** Насколько растение гнётся от ветра. */
  readonly sway: number;
  readonly zone: 'meadow' | 'shore' | 'garden';
  readonly paint: Painter;
}

const GROUND = TERRACE.deckTopY;
/** Стриженый газон у виллы: там сеет GrassField, дикую траву не пускаем. */
const LAWN: Rect = { minX: -34, maxX: 18, minZ: -18, maxZ: 15 };

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ——— рисунки растений ————————————————————————————————————————————————
// Всё рисуется на прозрачном фоне: прозрачность режет alphaTest в материале,
// поэтому трава и цветы остаются в непрозрачном проходе и не сортируются.

/** Лист: изогнутая лента от корня к верхушке. */
function leaf(
  ctx: CanvasRenderingContext2D,
  size: number,
  baseX: number,
  heightValue: number,
  width: number,
  lean: number,
  fill: string,
): void {
  const topX = baseX + lean;
  const topY = size - heightValue;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(baseX - width / 2, size);
  ctx.quadraticCurveTo(baseX - width / 3 + lean * 0.4, (size + topY) / 2, topX, topY);
  ctx.quadraticCurveTo(baseX + width / 3 + lean * 0.4, (size + topY) / 2, baseX + width / 2, size);
  ctx.closePath();
  ctx.fill();
}

/** Луговая трава: широкие мягкие листья, ниже газонного пучка. */
const paintMeadow: Painter = (ctx, size, random) => {
  for (let i = 0; i < 6; i += 1) {
    const baseX = 22 + random() * (size - 44);
    const heightValue = size * (0.5 + random() * 0.44);
    const width = 7 + random() * 6;
    const lean = (random() - 0.5) * 30;
    const light = 96 + random() * 44;
    leaf(
      ctx,
      size,
      baseX,
      heightValue,
      width,
      lean,
      `rgb(${Math.floor(light * 0.66)}, ${Math.floor(light * 1.02)}, ${Math.floor(light * 0.46)})`,
    );
  }
  // Пара узких травинок между листьями — пучок не выглядит «лопухом»
  for (let i = 0; i < 3; i += 1) {
    const baseX = 16 + random() * (size - 32);
    leaf(ctx, size, baseX, size * (0.7 + random() * 0.28), 3.4, (random() - 0.5) * 30, 'rgb(96, 140, 62)');
  }
};

/** Камыш: высокие жёсткие стебли с метёлками на конце. */
const paintReeds: Painter = (ctx, size, random) => {
  for (let i = 0; i < 5; i += 1) {
    const baseX = 24 + random() * (size - 48);
    const heightValue = size * (0.72 + random() * 0.26);
    const lean = (random() - 0.5) * 22;
    const topX = baseX + lean;
    const topY = size - heightValue;
    ctx.strokeStyle = `rgb(${88 + Math.floor(random() * 30)}, ${116 + Math.floor(random() * 34)}, ${56})`;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(baseX, size);
    ctx.quadraticCurveTo(baseX + lean * 0.35, (size + topY) / 2, topX, topY);
    ctx.stroke();
    // Метёлка: два зерна у самой верхушки
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgb(154, 128, 74)';
      for (let grain = 0; grain < 3; grain += 1) {
        ctx.beginPath();
        ctx.ellipse(topX + (grain - 1) * 3.4, topY + 4 + grain * 2, 2.2, 6.4, lean * 0.02, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
};

/** Ромашка: белые лепестки вокруг жёлтой серединки на тонком стебле. */
const paintDaisy: Painter = (ctx, size, random) => {
  for (let s = 0; s < 3; s += 1) {
    const baseX = size * (0.18 + random() * 0.64);
    const topY = size * (0.16 + random() * 0.3);
    const lean = (random() - 0.5) * 20;
    ctx.strokeStyle = 'rgb(78, 112, 52)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(baseX, size);
    ctx.quadraticCurveTo(baseX + lean * 0.5, (size + topY) / 2, baseX + lean, topY + 7);
    ctx.stroke();

    const cx = baseX + lean;
    const cy = topY + 6;
    const petals = 6 + Math.floor(random() * 3);
    ctx.fillStyle = 'rgb(244, 244, 232)';
    for (let p = 0; p < petals; p += 1) {
      const angle = (p / petals) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(angle) * 6.4, cy + Math.sin(angle) * 6.4, 4.6, 2.5, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgb(238, 186, 58)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Мак: алые лепестки и тёмная серединка. */
const paintPoppy: Painter = (ctx, size, random) => {
  for (let s = 0; s < 3; s += 1) {
    const baseX = size * (0.2 + random() * 0.6);
    const topY = size * (0.18 + random() * 0.26);
    const lean = (random() - 0.5) * 18;
    ctx.strokeStyle = 'rgb(84, 108, 54)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(baseX, size);
    ctx.quadraticCurveTo(baseX + lean * 0.4, (size + topY) / 2, baseX + lean, topY + 8);
    ctx.stroke();

    const cx = baseX + lean;
    const cy = topY + 7;
    const petals = 4 + Math.floor(random() * 2);
    for (let p = 0; p < petals; p += 1) {
      const angle = (p / petals) * Math.PI * 2 + 0.4;
      ctx.fillStyle = p % 2 === 0 ? 'rgb(206, 52, 40)' : 'rgb(224, 74, 52)';
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(angle) * 5.4, cy + Math.sin(angle) * 5.4, 6.4, 4.4, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgb(38, 30, 28)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Лаванда: колосок из мелких сиреневых цветков на высоком стебле. */
const paintLavender: Painter = (ctx, size, random) => {
  for (let s = 0; s < 4; s += 1) {
    const baseX = size * (0.18 + random() * 0.64);
    const topY = size * (0.1 + random() * 0.22);
    const lean = (random() - 0.5) * 16;
    ctx.strokeStyle = 'rgb(96, 122, 66)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(baseX, size);
    ctx.quadraticCurveTo(baseX + lean * 0.4, (size + topY) / 2, baseX + lean, topY + 26);
    ctx.stroke();

    const cx = baseX + lean;
    for (let bud = 0; bud < 11; bud += 1) {
      const t = bud / 10;
      const side = bud % 2 === 0 ? -1 : 1;
      const bx = cx + side * (2.2 + random() * 2.2) + lean * t * 0.2;
      const by = topY + 4 + t * 30;
      ctx.fillStyle = bud % 3 === 0 ? 'rgb(150, 118, 196)' : 'rgb(124, 96, 172)';
      ctx.beginPath();
      ctx.ellipse(bx, by, 3.1, 2.2, side * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

const SPECIES: readonly SpeciesSpec[] = [
  {
    id: 'meadow',
    label: 'луговая трава',
    width: 0.52,
    height: 0.56,
    count: 5200,
    viewDistance: 78,
    patchSize: [6, 12],
    patchRadius: [0.5, 1.5],
    scale: [0.75, 1.4],
    stretch: [0.8, 1.35],
    hue: [0.22, 0.29],
    sat: [0.42, 0.72],
    light: [0.16, 0.28],
    sway: 0.06,
    zone: 'meadow',
    paint: paintMeadow,
  },
  {
    id: 'reeds',
    label: 'камыш у обрыва',
    width: 0.6,
    height: 1.24,
    count: 1800,
    viewDistance: 90,
    patchSize: [5, 10],
    patchRadius: [0.4, 1.2],
    scale: [0.8, 1.3],
    stretch: [0.85, 1.25],
    hue: [0.19, 0.26],
    sat: [0.34, 0.58],
    light: [0.2, 0.32],
    sway: 0.1,
    zone: 'shore',
    paint: paintReeds,
  },
  {
    id: 'daisy',
    label: 'ромашки',
    width: 0.34,
    height: 0.32,
    count: 1600,
    viewDistance: 48,
    patchSize: [7, 14],
    patchRadius: [0.6, 1.8],
    scale: [0.85, 1.35],
    stretch: [0.9, 1.2],
    hue: [0.2, 0.26],
    sat: [0.18, 0.4],
    light: [0.42, 0.6],
    sway: 0.05,
    zone: 'meadow',
    paint: paintDaisy,
  },
  {
    id: 'poppy',
    label: 'маки',
    width: 0.36,
    height: 0.36,
    count: 1000,
    viewDistance: 46,
    patchSize: [5, 11],
    patchRadius: [0.7, 2.0],
    scale: [0.85, 1.3],
    stretch: [0.9, 1.2],
    hue: [0.21, 0.25],
    sat: [0.2, 0.4],
    light: [0.4, 0.55],
    sway: 0.05,
    zone: 'shore',
    paint: paintPoppy,
  },
  {
    id: 'lavender',
    label: 'лаванда у домов',
    width: 0.4,
    height: 0.5,
    count: 900,
    viewDistance: 44,
    patchSize: [6, 12],
    patchRadius: [0.5, 1.4],
    scale: [0.8, 1.25],
    stretch: [0.9, 1.2],
    hue: [0.72, 0.78],
    sat: [0.22, 0.45],
    light: [0.38, 0.52],
    sway: 0.045,
    zone: 'garden',
    paint: paintLavender,
  },
];

function paintTexture(id: string, painter: Painter, seed: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    painter(ctx, size, seeded(seed));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `flora-${id}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Крестовина: две плоскости под 90°, низ на земле, UV на весь рисунок. */
function buildCross(width: number, height: number): THREE.BufferGeometry {
  const first = new THREE.PlaneGeometry(width, height, 1, 1);
  first.translate(0, height / 2, 0);
  const second = first.clone();
  second.rotateY(Math.PI / 2);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const geometry of [first, second]) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const index = geometry.getIndex();
    if (!index) continue;
    for (let i = 0; i < index.count; i += 1) {
      const v = index.getX(i);
      positions.push(position.getX(v), position.getY(v), position.getZ(v));
      normals.push(normal.getX(v), normal.getY(v), normal.getZ(v));
      uvs.push(uv.getX(v), uv.getY(v));
    }
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  first.dispose();
  second.dispose();
  return merged;
}

/** Ветер и отсечение по расстоянию — в вершинном шейдере.
 *
 *  Газон держит LOD по чанкам снаружи, но флоре это не подходит: чанк на весь
 *  остров либо виден целиком, либо нет. Здесь далеко стоящее растение само
 *  схлопывается в точку: четыре вершины в одной точке — нулевая площадь,
 *  пиксельный проход не начинается. Ветви `if` нет, поэтому вся пачка
 *  инстансов считается предсказуемо, а не «кто успел». */
function withWind(
  material: THREE.MeshStandardMaterial,
  uniforms: { uTime: THREE.IUniform<number>; uCullDistance: THREE.IUniform<number> },
  sway: number,
  height: number,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uCullDistance = uniforms.uCullDistance;
    shader.vertexShader = `uniform float uTime;\nuniform float uCullDistance;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 plantOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 plantOrigin = vec3(0.0);
        #endif
        // Дальний LOD: растение за пределом видимости схлопывается в точку
        float plantDistance = distance(plantOrigin, cameraPosition);
        if (plantDistance > uCullDistance) {
          transformed = vec3(0.0);
        } else {
          float plantHeight = clamp(transformed.y / ${height.toFixed(3)}, 0.0, 1.0);
          float plantPhase = plantOrigin.x * 0.42 + plantOrigin.z * 0.31;
          float plantSway = sin(uTime * 1.6 + plantPhase) * 0.6 + sin(uTime * 3.7 + plantPhase * 1.9) * 0.4;
          transformed.x += plantSway * plantHeight * plantHeight * ${sway.toFixed(3)};
          transformed.z += plantSway * plantHeight * plantHeight * ${(sway * 0.6).toFixed(3)};
        }
      `,
    );
  };
  material.customProgramCacheKey = () => `flora-wind-${sway}-${height}`;
}

export function buildWildFlora(occupied: readonly Rect[], seed = 20260926): FloraResult {
  const group = new THREE.Group();
  group.name = 'flora';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const timeUniform: THREE.IUniform<number> = { value: 0 };
  const report: FloraSpeciesReport[] = [];

  const insideLawn = (x: number, z: number): boolean =>
    x > LAWN.minX - 0.4 && x < LAWN.maxX + 0.4 && z > LAWN.minZ - 0.4 && z < LAWN.maxZ + 0.4;

  const insideEllipse = (x: number, z: number, factor: number): boolean => {
    const rx = ISLAND.radiusX * factor;
    const rz = ISLAND.radiusZ * factor;
    return (x * x) / (rx * rx) + (z * z) / (rz * rz) <= 1;
  };

  const free = (x: number, z: number, margin: number): boolean => {
    if (!insideEllipse(x, z, 0.965)) return false;
    for (const rect of occupied) {
      if (x > rect.minX - margin && x < rect.maxX + margin && z > rect.minZ - margin && z < rect.maxZ + margin) {
        return false;
      }
    }
    return !insideLawn(x, z);
  };

  let instances = 0;
  let triangles = 0;

  for (const spec of SPECIES) {
    const random = seeded(seed + spec.count * 7 + spec.id.length);
    const texture = paintTexture(spec.id, spec.paint, seed + spec.count * 13);
    textures.push(texture);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      alphaTest: 0.42,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide,
    });
    material.name = `flora-${spec.id}`;
    withWind(
      material,
      { uTime: timeUniform, uCullDistance: { value: spec.viewDistance } },
      spec.sway,
      spec.height,
    );
    materials.push(material);

    const geometry = buildCross(spec.width, spec.height);
    geometries.push(geometry);

    /** Точка под кучку: у луга и камыша — по ареалу, у лаванды — у стены дома. */
    const patchCenter = (): { x: number; z: number } | null => {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        if (spec.zone === 'garden') {
          if (occupied.length === 0) return null;
          const rect = occupied[Math.floor(random() * occupied.length)];
          const side = Math.floor(random() * 4);
          const offset = 0.8 + random() * 2.6;
          if (side === 0) return { x: rect.minX - offset, z: rect.minZ + random() * (rect.maxZ - rect.minZ) };
          if (side === 1) return { x: rect.maxX + offset, z: rect.minZ + random() * (rect.maxZ - rect.minZ) };
          if (side === 2) return { x: rect.minX + random() * (rect.maxX - rect.minX), z: rect.minZ - offset };
          return { x: rect.minX + random() * (rect.maxX - rect.minX), z: rect.maxZ + offset };
        }
        const angle = random() * Math.PI * 2;
        const radius = spec.zone === 'shore' ? 0.78 + random() * 0.17 : Math.sqrt(random()) * 0.955;
        const x = Math.cos(angle) * ISLAND.radiusX * radius;
        const z = Math.sin(angle) * ISLAND.radiusZ * radius;
        if (free(x, z, 0.9)) return { x, z };
      }
      return null;
    };

    // Сначала раскладываем точки, потом создаём меш ровно по их числу: пустых
    // инстансов в буфере нет, и лишних draw calls тоже.
    const spots: Array<{ x: number; z: number; scale: number; stretch: number; spin: number; color: THREE.Color }> = [];
    const [minSize, maxSize] = spec.patchSize;
    const [minRadius, maxRadius] = spec.patchRadius;
    let guard = 0;
    while (spots.length < spec.count && guard < spec.count * 6) {
      guard += 1;
      const center = patchCenter();
      if (!center) continue;
      const plants = minSize + Math.floor(random() * (maxSize - minSize + 1));
      const spread = minRadius + random() * (maxRadius - minRadius);
      for (let t = 0; t < plants && spots.length < spec.count; t += 1) {
        const x = center.x + (random() - 0.5) * spread * 2;
        const z = center.z + (random() - 0.5) * spread * 2;
        if (!free(x, z, 0.35)) continue;
        const color = new THREE.Color();
        color.setHSL(
          spec.hue[0] + random() * (spec.hue[1] - spec.hue[0]),
          spec.sat[0] + random() * (spec.sat[1] - spec.sat[0]),
          spec.light[0] + random() * (spec.light[1] - spec.light[0]),
        );
        spots.push({
          x,
          z,
          scale: spec.scale[0] + random() * (spec.scale[1] - spec.scale[0]),
          stretch: spec.stretch[0] + random() * (spec.stretch[1] - spec.stretch[0]),
          spin: random() * Math.PI * 2,
          color,
        });
      }
    }

    if (spots.length > 0) {
      const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
      mesh.name = `flora-${spec.id}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < spots.length; i += 1) {
        const plant = spots[i];
        // Утоплено на 1 см: между корнем и газоном не должно быть щели
        dummy.position.set(plant.x, GROUND - 0.01, plant.z);
        dummy.rotation.set(0, plant.spin, 0);
        dummy.scale.set(plant.scale, plant.scale * plant.stretch, plant.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, plant.color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      meshes.push(mesh);
    }

    const speciesTriangles = spots.length * 4;
    report.push({ id: spec.id, label: spec.label, count: spots.length, triangles: speciesTriangles });
    instances += spots.length;
    triangles += speciesTriangles;
  }

  return {
    group,
    instances,
    meshes: meshes.length,
    triangles,
    species: report,
    update(elapsed: number): void {
      // Ветер — один юниформ на все виды: время общее, фаза у каждого растения своя.
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
