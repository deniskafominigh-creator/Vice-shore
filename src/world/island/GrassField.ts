import * as THREE from 'three';
import { ISLAND, TERRACE } from '../../core/Config';

/** Трава (задача 13, переделана в задаче 20).
 *
 *  Пучок — две скрещённые плоскости (cross-billboard) с текстурой травы и
 *  `alphaTest`: вместо «трёх лезвий из полигонов» — настоящий рисунок стеблей,
 *  который читается и вблизи, и на ходу. Прозрачность через alpha test, а не
 *  `transparent`: трава остаётся в непрозрачном проходе с честным z-буфером,
 *  поэтому не мерцает и не требует сортировки.
 *
 *  Оптимизация:
 *   - один материал и одна геометрия на весь остров;
 *   - поле разбито на chunks 4×4, каждый — свой `InstancedMesh` с корректным
 *     габаритом, поэтому frustum culling реально отсекает невидимые куски
 *     (раньше у единственного меша стояло `frustumCulled = false`);
 *   - пучок стоит 4 треугольника вместо 18.
 *
 *  Ветер работает в вершинном шейдере (вставка в материал), поэтому трава
 *  качается и при этом честно получает свет и тени. */

/**
 * Дальность травы: за этим радиусом чанк не рисуется вовсе. 110 м — порог, где
 * дымка (`FOG.density`) уже гасит цвет, а пучок занимает меньше пикселя.
 */
const GRASS_VIEW_DISTANCE = 110;

export interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface GrassResult {
  readonly group: THREE.Group;
  /** Сколько пучков посеяно. */
  readonly instances: number;
  /** Сколько чанков (мешей) получилось. */
  readonly chunks: number;
  /** Ветер + LOD по расстоянию: чанки дальше `GRASS_VIEW_DISTANCE` не рисуются. */
  update(elapsed: number, eye?: THREE.Vector3): void;
  dispose(): void;
}

/** Рисунок пучка: 8 стеблей разной высоты и наклона на прозрачном фоне. */
function createBladeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    // Детерминированный «рандом»: текстура не должна прыгать между запусками.
    let seed = 20260526;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 9; i += 1) {
      const baseX = 16 + random() * (size - 32);
      const height = size * (0.45 + random() * 0.5);
      const lean = (random() - 0.5) * 34;
      const width = 3.2 + random() * 3.4;
      const topX = baseX + lean;
      const topY = size - height;
      // Тень у корня и светлая верхушка: пучок не выглядит плоской наклейкой.
      const shade = 118 + Math.floor(random() * 60);
      const gradient = ctx.createLinearGradient(0, size, 0, topY);
      if (gradient && typeof gradient.addColorStop === 'function') {
        gradient.addColorStop(0, `rgb(${Math.floor(shade * 0.55)}, ${Math.floor(shade * 0.7)}, ${Math.floor(shade * 0.4)})`);
        gradient.addColorStop(0.55, `rgb(${shade}, ${shade + 26}, ${Math.floor(shade * 0.55)})`);
        gradient.addColorStop(1, `rgb(${Math.min(255, shade + 70)}, ${Math.min(255, shade + 96)}, ${Math.floor(shade * 0.8)})`);
        ctx.fillStyle = gradient;
      } else {
        // Офлайн-проверки подменяют canvas заглушкой — текстура там не нужна.
        ctx.fillStyle = `rgb(${shade}, ${shade + 26}, ${Math.floor(shade * 0.55)})`;
      }
      ctx.beginPath();
      ctx.moveTo(baseX - width / 2, size);
      ctx.quadraticCurveTo(baseX - width / 3 + lean * 0.4, size - height * 0.55, topX, topY);
      ctx.quadraticCurveTo(baseX + width / 3 + lean * 0.4, size - height * 0.55, baseX + width / 2, size);
      ctx.closePath();
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'grass-blade';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Крест: две плоскости под 90°, низ на земле, UV на весь рисунок. */
function buildCrossGeometry(): THREE.BufferGeometry {
  const first = new THREE.PlaneGeometry(0.42, 0.42, 1, 1);
  first.translate(0, 0.21, 0);
  const second = first.clone();
  second.rotateY(Math.PI / 2);
  const merged = new THREE.BufferGeometry();
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
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  first.dispose();
  second.dispose();
  return merged;
}

/** Сетка чанков: 4×4 по острову — culling работает по кускам. */
const CHUNK_X = 4;
const CHUNK_Z = 4;

export function buildGrass(occupied: readonly Rect[], count: number): GrassResult {
  const geometry = buildCrossGeometry();
  const bladeTexture = createBladeTexture();
  // Отдельный материал, а не клон листвы: у листвы тёмная текстура, и умножение
  // на instanceColor превращало траву в чёрные шипы.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: bladeTexture,
    alphaTest: 0.42,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });
  material.name = 'grass-field';

  const timeUniform = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      /* glsl */ `
        #include <begin_vertex>
        // Мирная позиция экземпляра: по ней фаза ветра у каждого пучка своя.
        #ifdef USE_INSTANCING
          vec3 tuftOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 tuftOrigin = vec3(0.0);
        #endif
        float bladeHeight = clamp(transformed.y / 0.42, 0.0, 1.0);
        float phase = tuftOrigin.x * 0.42 + tuftOrigin.z * 0.31;
        // Две частоты: ровный ветер плюс порывы
        float sway = sin(uTime * 1.6 + phase) * 0.6 + sin(uTime * 3.7 + phase * 1.9) * 0.4;
        transformed.x += sway * bladeHeight * bladeHeight * 0.07;
        transformed.z += sway * bladeHeight * bladeHeight * 0.04;
      `,
    );
  };
  material.customProgramCacheKey = () => 'grass-wind-cross';

  const random = (() => {
    let state = 987654321;
    return (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  })();

  const ground = TERRACE.deckTopY;
  const isFree = (x: number, z: number): boolean => {
    for (const rect of occupied) {
      if (x > rect.minX - 0.6 && x < rect.maxX + 0.6 && z > rect.minZ - 0.6 && z < rect.maxZ + 0.6) return false;
    }
    // Старый участок: стриженый газон у виллы, густую траву там не сеем
    if (x > -34 && x < 18 && z > -18 && z < 15) return false;
    return true;
  };

  /** Пучки по чанкам: сначала раскладываем, потом создаём по мешу на чанк. */
  const buckets: Array<Array<{ x: number; z: number; scale: number; stretch: number; rotation: number; hsl: THREE.Color }>> =
    Array.from({ length: CHUNK_X * CHUNK_Z }, () => []);
  const chunkOf = (x: number, z: number): number => {
    const cx = Math.min(CHUNK_X - 1, Math.max(0, Math.floor(((x + ISLAND.radiusX) / (ISLAND.radiusX * 2)) * CHUNK_X)));
    const cz = Math.min(CHUNK_Z - 1, Math.max(0, Math.floor(((z + ISLAND.radiusZ) / (ISLAND.radiusZ * 2)) * CHUNK_Z)));
    return cz * CHUNK_X + cx;
  };

  let placed = 0;
  let guard = 0;
  // Кучки: центр кучки + 5–10 пучков вокруг. Плотность по площади эллипса ровная.
  while (placed < count && guard < count * 16) {
    guard += 1;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random());
    const clusterX = Math.cos(angle) * ISLAND.radiusX * radius * 0.985;
    const clusterZ = Math.sin(angle) * ISLAND.radiusZ * radius * 0.985;

    const tufts = 5 + Math.floor(random() * 6);
    const spread = 0.45 + random() * 0.75;
    for (let t = 0; t < tufts && placed < count; t += 1) {
      const x = clusterX + (random() - 0.5) * spread * 2;
      const z = clusterZ + (random() - 0.5) * spread * 2;
      if (!isFree(x, z)) continue;

      // Цвет: от сочного зелёного к выгоревшему жёлтому — газон не выглядит заливкой.
      // Альбедо намеренно тёмное: солнце и tone mapping вытягивают светлые оттенки
      // в бледно-мятный, поэтому цвет задаём с запасом вниз.
      const hsl = new THREE.Color();
      hsl.setHSL(0.24 + random() * 0.06, 0.55 + random() * 0.3, 0.16 + random() * 0.12);
      buckets[chunkOf(x, z)].push({
        x,
        z,
        scale: 0.7 + random() * 0.8,
        stretch: 0.8 + random() * 0.6,
        rotation: random() * Math.PI * 2,
        hsl,
      });
      placed += 1;
    }
  }

  const group = new THREE.Group();
  group.name = 'grass';
  const dummy = new THREE.Object3D();
  let chunks = 0;
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    const mesh = new THREE.InstancedMesh(geometry, material, bucket.length);
    mesh.name = 'grass-chunk';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    for (let i = 0; i < bucket.length; i += 1) {
      const tuft = bucket[i];
      dummy.position.set(tuft.x, ground, tuft.z);
      dummy.rotation.set(0, tuft.rotation, 0);
      dummy.scale.set(tuft.scale, tuft.scale * tuft.stretch, tuft.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tuft.hsl);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Габарит считается по инстансам — иначе culling режет кусок целиком.
    mesh.computeBoundingSphere();
    group.add(mesh);
    chunks += 1;
  }

  return {
    group,
    instances: placed,
    chunks,
    update(elapsed: number, eye?: THREE.Vector3): void {
      timeUniform.value = elapsed;
      if (!eye) return;
      for (const child of group.children) {
        if (!(child instanceof THREE.InstancedMesh)) continue;
        const sphere = child.boundingSphere;
        if (!sphere) continue;
        // Дальний LOD: отдельная травинка за сотню метров всё равно в один
        // пиксель, а дымка уже съедает её цвет — рисуем чанк только вблизи.
        child.visible = eye.distanceTo(sphere.center) - sphere.radius < GRASS_VIEW_DISTANCE;
      }
    },
    dispose(): void {
      for (const child of group.children) {
        if (child instanceof THREE.InstancedMesh) child.dispose();
      }
      geometry.dispose();
      bladeTexture.dispose();
      material.dispose();
    },
  };
}
