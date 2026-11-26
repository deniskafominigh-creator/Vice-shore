import * as THREE from 'three';
import { ISLAND, TERRACE, TOWN, type HouseSpec } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';
import type { CollisionWorld } from '../Colliders';

/** Островной посёлок (задача 13): пять новых домов вокруг старой виллы.
 *
 *  Шестой дом — уже существующая вилла с интерьером и миссиями, её здесь не трогаем:
 *  координаты миссий 7–8 должны остаться прежними.
 *
 *  Дома строятся параметрически из одного набора деталей: плита-подиум, стены с
 *  перепуском в углах (SEAM), окна с откосами и ставнями, двери с ручками и козырьком,
 *  плоская крыша с парапетом и ограждением, терраса с перголой, бассейн с плиткой,
 *  садовые светильники, лежаки, зонт, кашпо, живая изгородь, гравийный въезд.
 *  Каждый дом — это 150–200 предметов; всё вместе склеивается по материалам
 *  (`mergeStaticMeshes` во внешнем коде), поэтому «тысяча объектов» не превращается
 *  в тысячу draw call. */

const GROUND = TERRACE.deckTopY;
/** Перепуск панелей (задача 10): торцы стен уходят внутрь соседа, шов не мерцает. */
const SEAM = 0.02;
const WALL = 0.24;
const WALL_HEIGHT = 3.15;

export interface TownHouse {
  readonly id: string;
  readonly name: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface TownResult {
  readonly group: THREE.Group;
  readonly houses: readonly TownHouse[];
  /** Прямоугольники, занятые домами, террасами, бассейнами и улицей: там не сеем траву. */
  readonly occupied: readonly Rect[];
  /** Сколько отдельных предметов построено (для отчёта о детализации). */
  readonly objectCount: number;
  dispose(): void;
}

/** Детерминированный генератор: посёлок выглядит одинаково на каждом запуске. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function buildTown(materials: IslandMaterials, collisions: CollisionWorld): TownResult {
  const group = new THREE.Group();
  group.name = 'town';

  const random = makeRandom(20261126);
  const occupied: Rect[] = [];
  const houses: TownHouse[] = [];
  let objectCount = 0;

  /** Счётчик предметов: каждый меш — это «объект» декорации до склейки. */
  const add = (parent: THREE.Object3D, mesh: THREE.Object3D): THREE.Object3D => {
    objectCount += 1;
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
    segments = 12,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // ——— материалы-варианты: три оттенка стен и вода бассейна ————————
  const wallVariants = [0.0, 0.06, -0.045].map((tint, index) => {
    const material = materials.plaster.clone();
    material.color.offsetHSL(0, index === 1 ? 0.02 : 0, tint);
    material.name = `town-wall-${index}`;
    return material;
  });
  const poolWater = new THREE.MeshStandardMaterial({
    color: 0x2fa7bd,
    roughness: 0.06,
    metalness: 0.16,
    transparent: true,
    opacity: 0.86,
    envMapIntensity: 1.2,
  });
  poolWater.name = 'town-pool-water';
  const lampGlow = new THREE.MeshStandardMaterial({
    color: 0xfff0c8,
    emissive: new THREE.Color(0xffce7a),
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });
  lampGlow.name = 'town-lamp-glow';

  const roofMaterial = (spec: HouseSpec): THREE.Material => {
    // Цвет крыши из спецификации → ближайший готовый материал (без новых текстур)
    const palette = [materials.terracotta, materials.darkRoof, materials.metal, materials.court];
    const index = Math.abs(spec.roofColor) % palette.length;
    return palette[index] ?? materials.darkRoof;
  };

  // ————————————————————————————————————————————————————————————————
  //  Дом
  // ————————————————————————————————————————————————————————————————

  const buildHouse = (spec: HouseSpec, index: number): void => {
    const house = new THREE.Group();
    house.name = spec.id;
    // Дети группы считают высоту от уровня площадки в абсолютных числах (h),
    // поэтому сама группа стоит на нуле по Y — иначе весь дом «всплывает» на 3,2 м.
    house.position.set(spec.x, 0, spec.z);
    house.rotation.y = spec.yaw;

    const wall = wallVariants[index % wallVariants.length]!;
    const roof = roofMaterial(spec);
    const halfW = spec.width / 2;
    const halfD = spec.depth / 2;
    const twoFloors = spec.floors === 1;
    const bodyHeight = twoFloors ? WALL_HEIGHT * 2 + 0.3 : WALL_HEIGHT;
    /** Плита-подиум: дом стоит на каменном основании, как на референсе. */
    const plinth = 0.34;
    const plinthTop = plinth;

    // ——— подиум ———
    add(
      house,
      box(materials.stone, [spec.width + 0.7, plinth, spec.depth + 0.7], [0, plinth / 2, 0]),
    );
    // Кромка подиума светлее — читается как облицовка
    add(
      house,
      box(materials.trim, [spec.width + 0.76, 0.06, spec.depth + 0.76], [0, plinth - 0.05, 0]),
    );

    const wallFoot = plinthTop;
    const wallTop = plinthTop + bodyHeight;

    // ——— стены: перепуск в углах, чтобы торцы не совпадали с плоскостями соседей ———
    // Задняя и передняя — на полную ширину, боковые — между ними с нахлёстом SEAM.
    const backZ = -halfD + WALL / 2;
    const frontZ = halfD - WALL / 2;
    /** Наружные плоскости фасадов. Всё навесное (окна, двери, ставни) считается
     *  от них: деталь должна выходить НАРУЖУ, иначе стена её закрывает. */
    const frontOut = frontZ + WALL / 2;
    const backOut = backZ - WALL / 2;
    add(
      house,
      box(wall, [spec.width + SEAM * 2, bodyHeight, WALL], [0, wallFoot + bodyHeight / 2, backZ]),
    );
    // Передняя стена — из двух простенков: в середине вход.
    // Простенок короче на SEAM: его торец уходит внутрь боковой стены и больше
    // не совпадает с её наружной плоскостью (раньше это давало мерцание в углу).
    const doorWidth = 1.35;
    const pierWidth = (spec.width - doorWidth) / 2 - SEAM;
    add(
      house,
      box(wall, [pierWidth, bodyHeight, WALL], [-(doorWidth / 2 + pierWidth / 2), wallFoot + bodyHeight / 2, frontZ]),
    );
    add(
      house,
      box(wall, [pierWidth, bodyHeight, WALL], [doorWidth / 2 + pierWidth / 2, wallFoot + bodyHeight / 2, frontZ]),
    );
    // Перемычка над дверью — вынесена на 2 см: в одной плоскости с простенками
    // её торцы давали мерцание на всю высоту проёма.
    add(house, box(wall, [doorWidth + SEAM * 2, 0.9, WALL], [0, wallTop - 0.45, frontZ + 0.02]));
    // Боковые стены — с нахлёстом в обе стороны
    add(
      house,
      box(wall, [WALL, bodyHeight, spec.depth - WALL * 2 + SEAM * 2], [-halfW + WALL / 2, wallFoot + bodyHeight / 2, 0]),
    );
    add(
      house,
      box(wall, [WALL, bodyHeight, spec.depth - WALL * 2 + SEAM * 2], [halfW - WALL / 2, wallFoot + bodyHeight / 2, 0]),
    );

    // Цокольная отделка по периметру — тонкая полоса над подиумом
    add(house, box(materials.trim, [spec.width + 0.12, 0.1, spec.depth + 0.12], [0, wallFoot + 0.05, 0]));

    // ——— дверь ———
    add(house, box(materials.wood, [doorWidth - 0.12, 2.25, 0.09], [0, wallFoot + 1.125, frontOut - 0.02]));
    add(house, box(materials.brass, [0.06, 0.28, 0.06], [0.45, wallFoot + 1.1, frontOut + 0.04]));
    // Козырёк над входом
    add(house, box(materials.trim, [doorWidth + 1.1, 0.12, 1.1], [0, wallFoot + 2.42, frontOut + 0.5]));
    add(house, box(materials.white, [0.1, 0.5, 0.1], [-(doorWidth / 2 + 0.4), wallFoot + 2.14, frontOut + 0.9]));
    add(house, box(materials.white, [0.1, 0.5, 0.1], [doorWidth / 2 + 0.4, wallFoot + 2.14, frontOut + 0.9]));
    // Ступень перед дверью
    add(house, box(materials.stone, [doorWidth + 0.7, 0.12, 0.7], [0, 0.06, frontOut + 0.42]));

    // ——— окна: стекло, рама, импост, подоконник, ставни ———
    // Вынос деталей от наружной плоскости стены, м. Стекло — ближе всех к фасаду,
    // но всё же снаружи; рама выступает сильнее и читается как переплёт.
    const PANE = 0.02;
    const FRAME = 0.045;
    const MULLION = 0.048;
    const SILL = 0.13;
    const SHUTTER = 0.03;
    const windowRow = (y: number, count: number): void => {
      const spacing = spec.width / (count + 1);
      for (let i = 0; i < count; i += 1) {
        const x = -halfW + spacing * (i + 1);
        const z = frontOut;
        add(house, box(materials.windowGlass, [1.15, 1.35, 0.06], [x, y, z + PANE]));
        add(house, box(materials.trim, [1.27, 0.07, 0.1], [x, y + 0.71, z + FRAME]));
        add(house, box(materials.trim, [1.27, 0.07, 0.1], [x, y - 0.71, z + FRAME]));
        add(house, box(materials.trim, [0.07, 1.49, 0.1], [x - 0.6, y, z + FRAME]));
        add(house, box(materials.trim, [0.07, 1.49, 0.1], [x + 0.6, y, z + FRAME]));
        // Импост
        add(house, box(materials.trim, [0.05, 1.35, 0.07], [x, y, z + MULLION]));
        // Подоконник
        add(house, box(materials.stone, [1.45, 0.08, 0.26], [x, y - 0.78, z + SILL]));
        // Ставни-жалюзи
        add(house, box(materials.wood, [0.34, 1.44, 0.06], [x - 0.83, y, z + SHUTTER]));
        add(house, box(materials.wood, [0.34, 1.44, 0.06], [x + 0.83, y, z + SHUTTER]));
      }
    };

    windowRow(wallFoot + 1.55, Math.max(2, Math.round(spec.width / 4.4)));
    // Окна на боковых стенах
    const sideWindows = Math.max(1, Math.round(spec.depth / 5.5));
    for (let i = 0; i < sideWindows; i += 1) {
      const z = -halfD + (i + 1) * (spec.depth / (sideWindows + 1));
      for (const side of [-1, 1] as const) {
        const out = side * halfW;
        add(house, box(materials.windowGlass, [0.06, 1.2, 1.0], [out + side * PANE, wallFoot + 1.6, z]));
        add(house, box(materials.trim, [0.1, 0.06, 1.12], [out + side * FRAME, wallFoot + 2.23, z]));
        add(house, box(materials.trim, [0.1, 0.06, 1.12], [out + side * FRAME, wallFoot + 0.97, z]));
        add(house, box(materials.trim, [0.1, 1.32, 0.06], [out + side * FRAME, wallFoot + 1.6, z - 0.53]));
        add(house, box(materials.trim, [0.1, 1.32, 0.06], [out + side * FRAME, wallFoot + 1.6, z + 0.53]));
        add(house, box(materials.stone, [0.24, 0.07, 1.28], [out + side * SILL, wallFoot + 0.92, z]));
      }
    }

    // ——— задний фасад: окна и служебная дверь в сад ———
    const backWindows = Math.max(2, Math.round(spec.width / 6));
    for (let i = 0; i < backWindows; i += 1) {
      const x = -halfW + (i + 1) * (spec.width / (backWindows + 1));
      const z = backOut;
      add(house, box(materials.windowGlass, [1.0, 1.25, 0.06], [x, wallFoot + 1.55, z - PANE]));
      add(house, box(materials.trim, [1.12, 0.06, 0.1], [x, wallFoot + 2.21, z - FRAME]));
      add(house, box(materials.trim, [1.12, 0.06, 0.1], [x, wallFoot + 0.89, z - FRAME]));
      add(house, box(materials.trim, [0.06, 1.38, 0.1], [x - 0.53, wallFoot + 1.55, z - FRAME]));
      add(house, box(materials.trim, [0.06, 1.38, 0.1], [x + 0.53, wallFoot + 1.55, z - FRAME]));
      add(house, box(materials.stone, [1.24, 0.07, 0.22], [x, wallFoot + 0.84, z - 0.12]));
    }
    // Служебная дверь
    const serviceX = halfW - 1.3;
    add(house, box(materials.wood, [0.95, 2.1, 0.09], [serviceX, wallFoot + 1.05, backOut + 0.02]));
    add(house, box(materials.brass, [0.05, 0.22, 0.05], [serviceX + 0.35, wallFoot + 1.05, backOut - 0.05]));
    add(house, box(materials.stone, [1.2, 0.12, 0.6], [serviceX, 0.06, backOut - 0.42]));

    // ——— второй этаж: пояс, окна, балкон с ограждением ———
    if (twoFloors) {
      const beltY = wallFoot + WALL_HEIGHT;
      add(house, box(materials.trim, [spec.width + 0.16, 0.16, spec.depth + 0.16], [0, beltY, 0]));
      windowRow(beltY + 1.5, Math.max(2, Math.round(spec.width / 5)));
      // Балкон по центру фасада
      const balconyWidth = Math.min(4.6, spec.width * 0.42);
      add(
        house,
        box(materials.stone, [balconyWidth, 0.14, 1.5], [0, beltY + 0.08, halfD + 0.7]),
      );
      const railY = beltY + 0.62;
      add(house, box(materials.metal, [balconyWidth, 0.05, 0.05], [0, railY + 0.52, halfD + 1.42]));
      const posts = Math.max(2, Math.round(balconyWidth / 0.46));
      for (let i = 0; i <= posts; i += 1) {
        const x = -balconyWidth / 2 + (balconyWidth / posts) * i;
        add(house, box(materials.metal, [0.035, 1.04, 0.035], [x, railY, halfD + 1.42]));
      }
      add(house, box(materials.metal, [0.035, 1.04, 0.035], [-balconyWidth / 2, railY, halfD + 0.02]));
      add(house, box(materials.metal, [0.035, 1.04, 0.035], [balconyWidth / 2, railY, halfD + 0.02]));
      // Боковые заполнения короче и чуть внутрь: иначе их грани совпадают с угловыми
      // стойками и с передней планкой — аудит видит z-fighting.
      // Зазор до кромки плиты — 15 мм: при 2,5 мм грани попадают в допуск мерцания.
      add(house, box(materials.metal, [0.035, 1.04, 1.34], [-balconyWidth / 2 + 0.035, railY, halfD + 0.66]));
      add(house, box(materials.metal, [0.035, 1.04, 1.34], [balconyWidth / 2 - 0.035, railY, halfD + 0.66]));
    }

    // ——— крыша: плита с парапетом и ограждением кровли ———
    const roofY = wallTop;
    add(house, box(roof, [spec.width + 0.5, 0.26, spec.depth + 0.5], [0, roofY + 0.13, 0]));
    // Парапет: четыре полосы с перепуском в углах
    const parapetH = 0.55;
    const parapet = (size: [number, number, number], position: [number, number, number]): void => {
      add(house, box(materials.trim, size, position));
    };
    parapet([spec.width + 0.6 + SEAM, parapetH, 0.16], [0, roofY + 0.26 + parapetH / 2, halfD + 0.25]);
    parapet([spec.width + 0.6 + SEAM, parapetH, 0.16], [0, roofY + 0.26 + parapetH / 2, -halfD - 0.25]);
    parapet([0.16, parapetH, spec.depth + 0.4], [-halfW - 0.22, roofY + 0.26 + parapetH / 2, 0]);
    parapet([0.16, parapetH, spec.depth + 0.4], [halfW + 0.22, roofY + 0.26 + parapetH / 2, 0]);
    // Кровельные «гребни» — намёк на черепицу, читается сверху
    const ridgeCount = Math.max(4, Math.round(spec.depth / 1.1));
    for (let i = 0; i < ridgeCount; i += 1) {
      const z = -halfD + (i + 0.5) * ((spec.depth + 0.2) / ridgeCount);
      add(house, box(roof, [spec.width + 0.2, 0.07, 0.16], [0, roofY + 0.3, z]));
    }
    // Солнечные панели на части домов
    if (index % 2 === 0) {
      for (let i = 0; i < 3; i += 1) {
        add(
          house,
          box(materials.screenDark, [1.7, 0.06, 1.0], [-halfW + 1.6 + i * 1.85, roofY + 0.36, -halfD + 1.6]),
        );
      }
    }

    // ——— терраса перед домом ———
    const terraceDepth = 3.6;
    add(
      house,
      box(materials.court, [spec.width + 1.4, 0.08, terraceDepth], [0, 0.03, halfD + terraceDepth / 2]),
    );
    // Ограждение террасы по краям
    for (const side of [-1, 1] as const) {
      const x = side * (spec.width / 2 + 0.62);
      add(house, box(materials.metal, [0.05, 0.05, terraceDepth], [x, 0.95, halfD + terraceDepth / 2]));
      for (let i = 0; i < 4; i += 1) {
        const z = halfD + 0.3 + (terraceDepth / 3.4) * i;
        add(house, box(materials.metal, [0.04, 0.9, 0.04], [x, 0.5, z]));
      }
    }

    // Пергола
    if (spec.pergola) {
      const pergolaWidth = Math.min(spec.width * 0.7, 8);
      const zFront = halfD + terraceDepth - 0.4;
      for (const side of [-1, 1] as const) {
        add(house, box(materials.white, [0.16, 2.5, 0.16], [side * pergolaWidth / 2, 1.25, zFront]));
        add(house, box(materials.white, [0.16, 2.5, 0.16], [side * pergolaWidth / 2, 1.25, halfD + 0.4]));
      }
      // Продольные балки
      add(house, box(materials.white, [pergolaWidth + 0.35, 0.16, 0.16], [0, 2.55, zFront]));
      add(house, box(materials.white, [pergolaWidth + 0.35, 0.16, 0.16], [0, 2.55, halfD + 0.4]));
      // Поперечные лаги
      const slats = Math.round(pergolaWidth / 0.55);
      for (let i = 0; i <= slats; i += 1) {
        const x = -pergolaWidth / 2 + (pergolaWidth / slats) * i;
        add(
          house,
          box(materials.white, [0.1, 0.1, terraceDepth - 0.2], [x, 2.66, halfD + terraceDepth / 2 + 0.1]),
        );
      }
      // Вьющееся растение на перголе
      for (let i = 0; i < 9; i += 1) {
        const x = -pergolaWidth / 2 + 0.4 + i * (pergolaWidth / 10);
        const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26 + random() * 0.14, 0), materials.foliage);
        foliage.position.set(x, 2.78 + random() * 0.1, halfD + 0.6 + random() * (terraceDepth - 1.2));
        foliage.castShadow = true;
        add(house, foliage);
      }
    }

    // ——— бассейн ———
    if (spec.pool) {
      const poolWidth = Math.min(spec.width * 0.62, 8.4);
      const poolDepth = 2.3;
      const poolZ = halfD + terraceDepth + 2.4;
      // Чаша: дно и борта из плитки
      add(house, box(materials.court, [poolWidth + 0.78, 0.1, poolDepth + 0.78], [0, 0.05, poolZ]));
      for (const side of [-1, 1] as const) {
        add(
          house,
          box(materials.trim, [0.18, 0.5, poolDepth + 0.62], [side * (poolWidth / 2 + 0.26), 0.25, poolZ]),
        );
        add(
          house,
          box(materials.trim, [poolWidth + 0.34, 0.5, 0.18], [0, 0.25, poolZ + side * (poolDepth / 2 + 0.26)]),
        );
      }
      // Вода — на 6 см ниже борта, чтобы грани не совпадали
      const water = new THREE.Mesh(new THREE.PlaneGeometry(poolWidth, poolDepth), poolWater);
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, 0.44, poolZ);
      water.receiveShadow = true;
      add(house, water);
      // Лежаки и зонт
      for (const side of [-1, 1] as const) {
        const x = side * (poolWidth / 2 + 1.15);
        add(house, box(materials.wood, [0.75, 0.12, 1.95], [x, 0.38, poolZ]));
        add(house, box(materials.fabricCream, [0.72, 0.12, 1.4], [x, 0.5, poolZ + 0.15]));
        add(house, box(materials.wood, [0.7, 0.5, 0.1], [x, 0.62, poolZ - 0.95]));
        for (const dz of [-0.7, 0.7] as const) {
          add(house, box(materials.wood, [0.09, 0.36, 0.09], [x - 0.3, 0.18, poolZ + dz]));
          add(house, box(materials.wood, [0.09, 0.36, 0.09], [x + 0.3, 0.18, poolZ + dz]));
        }
      }
      add(house, cylinder(materials.white, 0.06, 0.06, 2.3, [poolWidth / 2 + 2.4, 1.15, poolZ], 8));
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.42, 12, 1, true), materials.fabricCream);
      canopy.position.set(poolWidth / 2 + 2.4, 2.2, poolZ);
      canopy.castShadow = true;
      add(house, canopy);
      occupied.push({
        minX: spec.x - poolWidth / 2 - 2.8,
        maxX: spec.x + poolWidth / 2 + 2.8,
        minZ: spec.z - poolZ - poolDepth,
        maxZ: spec.z + poolZ + poolDepth,
      });
    }

    // ——— садовые светильники у входа ———
    for (const side of [-1, 1] as const) {
      const x = side * (doorWidth / 2 + 0.7);
      add(house, cylinder(materials.metal, 0.05, 0.05, 0.9, [x, 0.45, halfD + 0.6], 8));
      add(house, box(lampGlow, [0.16, 0.16, 0.16], [x, 0.96, halfD + 0.6]));
    }
    // Фонарь у двери (бра). Стоит вплотную к наличнику: на 0,55 м от проёма он
    // попадал прямо в окно первого этажа.
    add(house, box(materials.metal, [0.12, 0.22, 0.1], [doorWidth / 2 + 0.18, wallFoot + 1.95, frontOut + 0.02]));
    add(house, box(lampGlow, [0.14, 0.26, 0.12], [doorWidth / 2 + 0.18, wallFoot + 1.95, frontOut + 0.07]));

    // ——— кашпо с цветами по фасаду ———
    const pots = Math.max(2, Math.round(spec.width / 5));
    for (let i = 0; i < pots; i += 1) {
      const x = -spec.width / 2 + 1.1 + i * ((spec.width - 2.2) / Math.max(1, pots - 1));
      add(house, cylinder(materials.terracotta, 0.24, 0.19, 0.36, [x, 0.18, halfD + 0.75], 10));
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), materials.magenta);
      bush.position.set(x, 0.5, halfD + 0.75);
      bush.castShadow = true;
      add(house, bush);
    }

    // ——— живая изгородь вдоль боковых границ участка ———
    // Ряд коротких подстриженных сегментов: читается как живая изгородь,
    // а не как зелёная плита во весь участок.
    const hedgeSegments = 6;
    const hedgeSpan = Math.min(spec.depth + 2.5, 12);
    for (const side of [-1, 1] as const) {
      const x = side * (spec.width / 2 + 2.4);
      for (let i = 0; i < hedgeSegments; i += 1) {
        const z = halfD + 0.4 - (hedgeSpan / hedgeSegments) * (i + 0.5);
        const height = 0.78 + random() * 0.16;
        const segment = box(
          materials.foliage,
          [0.62, height, hedgeSpan / hedgeSegments - 0.12],
          [x, height / 2, z],
        );
        add(house, segment);
        // Светлая шапка среза — верх изгороди не сливается с газоном
        add(house, box(materials.foliage, [0.5, 0.05, hedgeSpan / hedgeSegments - 0.22], [x, height + 0.02, z]));
      }
    }

    // ——— гравийный въезд и дорожка к двери ———
    add(house, box(materials.gravel, [2.2, 0.05, 6.2], [-halfW + 1.6, 0.025, halfD + 4.6]));
    add(house, box(materials.stone, [1.6, 0.05, terraceDepth + 1.2], [0, 0.03, halfD + terraceDepth / 2 + 0.3]));

    // ——— почтовый ящик и номер дома ———
    add(house, box(materials.wood, [0.06, 1.1, 0.06], [doorWidth / 2 + 1.5, 0.55, halfD + 1.9]));
    add(house, box(materials.metal, [0.34, 0.26, 0.22], [doorWidth / 2 + 1.5, 1.2, halfD + 1.9]));
    add(house, box(materials.brass, [0.22, 0.1, 0.02], [0, wallFoot + 2.62, halfD + 0.02]));

    group.add(house);
    // Дом закрыт для входа: AABB по повёрнутому контуру. Осевая коробка всегда
    // содержит повёрнутый прямоугольник, поэтому лишних «дыр» в стенах не остаётся.
    const cos = Math.cos(spec.yaw);
    const sin = Math.sin(spec.yaw);
    const toWorld = (lx: number, lz: number): [number, number] => [
      spec.x + lx * cos + lz * sin,
      spec.z - lx * sin + lz * cos,
    ];
    const [ax, az] = toWorld(-halfW, -halfD);
    const [bx, bz] = toWorld(halfW, halfD);
    collisions.addBox(
      Math.min(ax, bx) - 0.4,
      Math.max(ax, bx) + 0.4,
      Math.min(az, bz) - 0.4,
      Math.max(az, bz) + 0.4,
      GROUND + 2,
    );
    houses.push({
      id: spec.id,
      name: spec.name,
      minX: spec.x - halfW - 0.4,
      maxX: spec.x + halfW + 0.4,
      minZ: spec.z - halfD - 0.4,
      maxZ: spec.z + halfD + 0.4,
    });
    occupied.push({
      minX: spec.x - halfW - 3.4,
      maxX: spec.x + halfW + 3.4,
      minZ: spec.z - halfD - 3.4,
      maxZ: spec.z + halfD + 5.5,
    });
  };

  TOWN.houses.forEach(buildHouse);

  // ————————————————————————————————————————————————————————————————
  //  Улица: дорога, бордюры, фонари, скамейки, разметка, клумбы
  // ————————————————————————————————————————————————————————————————

  const street = new THREE.Group();
  street.name = 'town-street';
  const streetLength = ISLAND.radiusX * 1.5;
  add(street, box(materials.gravel, [streetLength, 0.06, TOWN.streetWidth], [0, GROUND + 0.02, TOWN.streetZ]));
  // Бордюры
  for (const side of [-1, 1] as const) {
    add(
      street,
      box(materials.stone, [streetLength, 0.14, 0.3], [0, GROUND + 0.07, TOWN.streetZ + side * (TOWN.streetWidth / 2 + 0.15)]),
    );
  }
  // Разметка: короткие штрихи по центру
  const dashes = Math.round(streetLength / 6);
  for (let i = 0; i < dashes; i += 1) {
    const x = -streetLength / 2 + 3 + i * 6;
    add(street, box(materials.white, [2.4, 0.02, 0.16], [x, GROUND + 0.06, TOWN.streetZ]));
  }
  // Фонари каждые 14 м по обе стороны
  const lampStep = 14;
  const lampCount = Math.floor(streetLength / lampStep);
  for (let i = 0; i < lampCount; i += 1) {
    const x = -streetLength / 2 + 7 + i * lampStep;
    const side = i % 2 === 0 ? 1 : -1;
    const z = TOWN.streetZ + side * (TOWN.streetWidth / 2 + 0.9);
    add(street, cylinder(materials.metal, 0.07, 0.1, 3.6, [x, GROUND + 1.8, z], 10));
    add(street, box(materials.metal, [0.5, 0.08, 0.08], [x + 0.2, GROUND + 3.55, z]));
    add(street, box(lampGlow, [0.3, 0.12, 0.22], [x + 0.45, GROUND + 3.45, z]));
    collisions.addCircle(x, z, 0.24, GROUND + 3.6);
  }
  // Скамейки и урны
  const benchStep = 21;
  const benchCount = Math.floor(streetLength / benchStep);
  for (let i = 0; i < benchCount; i += 1) {
    const x = -streetLength / 2 + 12 + i * benchStep;
    const z = TOWN.streetZ - TOWN.streetWidth / 2 - 1.5;
    for (const dx of [-0.7, 0.7] as const) {
      add(street, box(materials.metal, [0.08, 0.42, 0.5], [x + dx, GROUND + 0.21, z]));
    }
    add(street, box(materials.wood, [1.8, 0.09, 0.52], [x, GROUND + 0.46, z]));
    add(street, box(materials.wood, [1.8, 0.42, 0.08], [x, GROUND + 0.66, z - 0.24]));
    add(street, cylinder(materials.metal, 0.16, 0.13, 0.5, [x + 1.3, GROUND + 0.25, z + 0.2], 10));
    collisions.addBox(x - 0.95, x + 0.95, z - 0.35, z + 0.35, GROUND + 0.6);
  }
  // Клумбы вдоль улицы
  const bedCount = 9;
  const bedStep = (streetLength - 30) / (bedCount - 1);
  for (let i = 0; i < bedCount; i += 1) {
    const x = -streetLength / 2 + 15 + i * bedStep;
    const z = TOWN.streetZ + TOWN.streetWidth / 2 + 2.2;
    add(street, box(materials.stone, [3.4, 0.32, 1.5], [x, GROUND + 0.16, z]));
    add(street, box(materials.terracotta, [3.1, 0.1, 1.2], [x, GROUND + 0.34, z]));
    for (let k = 0; k < 5; k += 1) {
      const bush = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.2 + random() * 0.12, 0),
        k % 2 === 0 ? materials.foliage : materials.magenta,
      );
      bush.position.set(x - 1.2 + k * 0.6, GROUND + 0.5, z + (random() - 0.5) * 0.5);
      bush.castShadow = true;
      add(street, bush);
    }
  }
  group.add(street);
  occupied.push({
    minX: -streetLength / 2,
    maxX: streetLength / 2,
    minZ: TOWN.streetZ - TOWN.streetWidth / 2 - 2.6,
    maxZ: TOWN.streetZ + TOWN.streetWidth / 2 + 3,
  });

  // ————————————————————————————————————————————————————————————————
  //  Дорожки от домов к улице и к старому участку
  // ————————————————————————————————————————————————————————————————

  const paths = new THREE.Group();
  paths.name = 'town-paths';
  const pathTo = (fromX: number, fromZ: number, toX: number, toZ: number, width: number): void => {
    const length = Math.hypot(toX - fromX, toZ - fromZ);
    const angle = Math.atan2(toZ - fromZ, toX - fromX);
    const plate = box(materials.gravel, [length, 0.05, width], [(fromX + toX) / 2, GROUND + 0.03, (fromZ + toZ) / 2], -angle);
    add(paths, plate);
    // Плиты поперёк дорожки — читаемая «дорожка», а не серая лента
    const slabs = Math.floor(length / 1.7);
    for (let i = 0; i < slabs; i += 1) {
      const t = (i + 0.5) / slabs;
      const x = fromX + (toX - fromX) * t;
      const z = fromZ + (toZ - fromZ) * t;
      add(paths, box(materials.stone, [1.3, 0.04, width - 0.5], [x, GROUND + 0.06, z], -angle));
    }
    occupied.push({
      minX: Math.min(fromX, toX) - width,
      maxX: Math.max(fromX, toX) + width,
      minZ: Math.min(fromZ, toZ) - width,
      maxZ: Math.max(fromZ, toZ) + width,
    });
  };

  for (const spec of TOWN.houses) {
    // От центра фасада дома к улице
    const frontZ = spec.z + Math.cos(spec.yaw) * (spec.depth / 2 + 4.5);
    const frontX = spec.x + Math.sin(spec.yaw) * (spec.depth / 2 + 4.5);
    pathTo(frontX, frontZ, frontX * 0.6 + 0, TOWN.streetZ - TOWN.streetWidth / 2 - 0.45, 1.9);
  }
  // От калитки старого участка к улице — главная аллея
  pathTo(0, 14.5, 0, TOWN.streetZ - TOWN.streetWidth / 2 - 0.45, 2.6);
  group.add(paths);

  // ————————————————————————————————————————————————————————————————
  //  Садовая мелочь по всему острову: камни, кашпо, поленницы, качели
  // ————————————————————————————————————————————————————————————————

  const decor = new THREE.Group();
  decor.name = 'town-decor';
  const insideEllipse = (x: number, z: number, scale = 0.9): boolean =>
    (x * x) / (ISLAND.radiusX * scale) ** 2 + (z * z) / (ISLAND.radiusZ * scale) ** 2 <= 1;
  const isFree = (x: number, z: number, pad: number): boolean => {
    for (const rect of occupied) {
      if (x > rect.minX - pad && x < rect.maxX + pad && z > rect.minZ - pad && z < rect.maxZ + pad) return false;
    }
    // Старый участок с виллой, площадкой и забором
    if (x > -34 && x < 18 && z > -18 && z < 15) return false;
    return true;
  };

  // Камни-валуны
  for (let i = 0; i < 60; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 0.55 + random() * 0.4;
    const x = Math.cos(angle) * ISLAND.radiusX * radius;
    const z = Math.sin(angle) * ISLAND.radiusZ * radius;
    if (!insideEllipse(x, z, 0.94) || !isFree(x, z, 1.5)) continue;
    const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + random() * 0.5, 1), materials.shoreStone);
    stone.position.set(x, GROUND + 0.18, z);
    stone.rotation.set(random(), random() * Math.PI, random());
    stone.castShadow = true;
    stone.receiveShadow = true;
    add(decor, stone);
  }
  // Пальмы по периметру — вторая линия после существующей растительности
  for (let i = 0; i < 26; i += 1) {
    const angle = (i / 26) * Math.PI * 2 + random() * 0.12;
    const radius = 0.7 + random() * 0.2;
    const x = Math.cos(angle) * ISLAND.radiusX * radius;
    const z = Math.sin(angle) * ISLAND.radiusZ * radius;
    if (!isFree(x, z, 2)) continue;
    const palm = new THREE.Group();
    palm.position.set(x, GROUND, z);
    const trunk = cylinder(materials.wood, 0.16, 0.26, 4.6 + random() * 1.6, [0, 2.4, 0], 8);
    trunk.rotation.z = (random() - 0.5) * 0.12;
    add(palm, trunk);
    for (let f = 0; f < 7; f += 1) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.26, 2.5, 4, 1, true), materials.frond);
      frond.position.set(0, 4.9, 0);
      frond.rotation.set(Math.PI / 2 - 0.5, (f / 7) * Math.PI * 2, random() * 0.2);
      frond.castShadow = true;
      add(palm, frond);
    }
    for (let c = 0; c < 3; c += 1) {
      const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), materials.wood);
      coconut.position.set(Math.cos(c * 2.1) * 0.3, 4.7, Math.sin(c * 2.1) * 0.3);
      add(palm, coconut);
    }
    decor.add(palm);
    collisions.addCircle(x, z, 0.42, GROUND + 5);
  }
  // Кашпо и поленницы у домов
  for (const spec of TOWN.houses) {
    for (let i = 0; i < 3; i += 1) {
      const angle = spec.yaw + (i - 1) * 0.6;
      const x = spec.x + Math.sin(angle) * (spec.width / 2 + 3.6);
      const z = spec.z + Math.cos(angle) * (spec.width / 2 + 3.6);
      add(decor, cylinder(materials.terracotta, 0.3, 0.24, 0.5, [x, GROUND + 0.25, z], 10));
      const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), materials.foliage);
      plant.position.set(x, GROUND + 0.7, z);
      plant.castShadow = true;
      add(decor, plant);
    }
  }
  // Качели и гамак в саду
  for (let i = 0; i < 3; i += 1) {
    const x = -20 + i * 26;
    const z = -26 - i * 4;
    if (!isFree(x, z, 3)) continue;
    for (const dx of [-1.4, 1.4] as const) {
      add(decor, box(materials.wood, [0.14, 2.4, 0.14], [x + dx, GROUND + 1.2, z]));
      add(decor, box(materials.wood, [0.12, 2.2, 0.12], [x + dx, GROUND + 1.1, z + 1.2]));
    }
    add(decor, box(materials.wood, [3.0, 0.12, 0.12], [x, GROUND + 2.35, z]));
    add(decor, box(materials.wood, [0.7, 0.07, 0.4], [x, GROUND + 0.95, z + 0.2]));
    add(decor, box(materials.metal, [0.03, 1.35, 0.03], [x - 0.3, GROUND + 1.6, z + 0.2]));
    add(decor, box(materials.metal, [0.03, 1.35, 0.03], [x + 0.3, GROUND + 1.6, z + 0.2]));
    collisions.addCircle(x, z, 1.5, GROUND + 1.3);
  }
  group.add(decor);

  return {
    group,
    houses,
    occupied,
    objectCount,
    dispose(): void {
      for (const material of wallVariants) material.dispose();
      poolWater.dispose();
      lampGlow.dispose();
    },
  };
}
