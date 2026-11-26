import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ISLAND, TERRACE } from '../../core/Config';

/** Трава (задача 13).
 *
 *  Тысячи пучков травы — это не тысячи мешей: один InstancedMesh, один draw call.
 *  Каждый пучок — три изогнутых стебля (12 треугольников), наклон к земле и случайный
 *  поворот; цвет варьируется через instanceColor, чтобы поле не выглядело ковром.
 *
 *  Ветер работает в вершинном шейдере (вставка в `MeshStandardMaterial`), поэтому
 *  трава качается и при этом честно получает свет и тени: освещение остаётся штатным,
 *  а не самодельным. */

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
  update(elapsed: number): void;
  dispose(): void;
}

/** Пучок: три стебля крест-накрест, верх сужен и загнут. */
function buildTuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    const blade = new THREE.PlaneGeometry(0.13, 0.44, 1, 3);
    blade.translate(0, 0.22, 0);
    const position = blade.attributes.position;
    if (!position) continue;
    for (let v = 0; v < position.count; v += 1) {
      const y = position.getY(v);
      const t = Math.min(1, y / 0.44);
      // Кверху стебель сужается и загибается — пучок читается как трава, а не как флаг
      position.setX(v, position.getX(v) * (1 - t * 0.78));
      position.setZ(v, position.getZ(v) + t * t * 0.08);
    }
    position.needsUpdate = true;
    blade.computeVertexNormals();
    blade.rotateY((i / 3) * Math.PI);
    blades.push(blade);
  }
  const merged = mergeGeometries(blades, false);
  for (const blade of blades) blade.dispose();
  return merged ?? new THREE.PlaneGeometry(0.13, 0.44);
}

export function buildGrass(occupied: readonly Rect[], count: number): GrassResult {
  const geometry = buildTuftGeometry();
  // Отдельный материал, а не клон листвы: у листвы тёмная текстура, и умножение
  // на instanceColor превращало траву в чёрные шипы.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.DoubleSide,
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
        float bladeHeight = clamp(transformed.y / 0.44, 0.0, 1.0);
        float phase = tuftOrigin.x * 0.42 + tuftOrigin.z * 0.31;
        // Две частоты: ровный ветер плюс порывы
        float sway = sin(uTime * 1.6 + phase) * 0.6 + sin(uTime * 3.7 + phase * 1.9) * 0.4;
        transformed.x += sway * bladeHeight * bladeHeight * 0.07;
        transformed.z += sway * bladeHeight * bladeHeight * 0.04;
      `,
    );
  };
  material.customProgramCacheKey = () => 'grass-wind';

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'grass-field';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const random = (() => {
    let state = 987654321;
    return (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  })();

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const ground = TERRACE.deckTopY;
  const isFree = (x: number, z: number): boolean => {
    for (const rect of occupied) {
      if (x > rect.minX - 0.6 && x < rect.maxX + 0.6 && z > rect.minZ - 0.6 && z < rect.maxZ + 0.6) return false;
    }
    // Старый участок: стриженый газон у виллы, густую траву там не сеем
    if (x > -34 && x < 18 && z > -18 && z < 15) return false;
    return true;
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

      dummy.position.set(x, ground, z);
      dummy.rotation.y = random() * Math.PI * 2;
      const scale = 0.7 + random() * 0.8;
      dummy.scale.set(scale, scale * (0.8 + random() * 0.6), scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);

      // Цвет: от сочного зелёного к выгоревшему жёлтому — газон не выглядит заливкой
      // Альбедо намеренно тёмное: солнце 3,1 и tone mapping вытягивают светлые оттенки
      // в бледно-мятный, поэтому цвет задаём с запасом вниз.
      color.setHSL(0.25 + random() * 0.05, 0.6 + random() * 0.25, 0.07 + random() * 0.06);
      mesh.setColorAt(placed, color);
      placed += 1;
    }
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'grass';
  group.add(mesh);

  return {
    group,
    instances: placed,
    update(elapsed: number): void {
      timeUniform.value = elapsed;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
