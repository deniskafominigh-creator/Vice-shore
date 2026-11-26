import * as THREE from 'three';
import { TERRACE, VILLA } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';
import type { CollisionWorld } from '../Colliders';

/** Белая вилла: настоящая оболочка дома — стены с проёмами, пол, потолок, окна и двери.
 *  Оболочка нужна для задачи 5: внутри стоит мебель (`Interior.ts`), а не «заглушка» из куба. */

const BASE_HEIGHT = 0.46;
const WALL = 0.26;
const CEILING_HEIGHT = 3.3;
/** Перепуск панелей в углах, м (задача 10): торцы стен не совпадают с плоскостями
 *  соседей, иначе шов мерцает. 2 см перекрытия глазом не видно. */
const SEAM = 0.02;

export interface InteriorBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Низ потолка. */
  readonly ceilingY: number;
}

export interface VillaResult {
  readonly group: THREE.Group;
  /** Уровень пола внутри дома. */
  readonly floorY: number;
  /** Проём входной двери. */
  readonly entrance: { x: number; z: number; width: number };
  /** Проём в витраже — через него можно войти на террасу и в дом. */
  readonly terraceDoor: { x: number; z: number; width: number };
  readonly interior: InteriorBounds;
}

/** Стена как плита: снаружи — обшивка, изнутри — штукатурка (материалы по граням бокса). */
function wallPad(
  materials: IslandMaterials,
  size: [number, number, number],
  position: [number, number, number],
  outward: 0 | 1 | 4 | 5,
): THREE.Mesh {
  const outer = materials.siding;
  const inner = materials.plaster;
  const edge = materials.white;
  const faces: THREE.Material[] = [edge, edge, edge, edge, edge, edge];
  faces[outward] = outer;
  const opposite = ([1, 0, 5, 4] as const)[([0, 1, 4, 5] as const).indexOf(outward)];
  faces[opposite] = inner;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), faces);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function box(
  material: THREE.Material,
  size: [number, number, number],
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildVilla(materials: IslandMaterials, collisions: CollisionWorld): VillaResult {
  const group = new THREE.Group();
  group.name = 'villa';
  const top = TERRACE.deckTopY;
  const y0 = top + BASE_HEIGHT;
  const { centerX, centerZ, width, depth, height, terraceDepth, roofOverhang } = VILLA;
  const front = centerZ + depth / 2;
  const halfW = width / 2;
  const halfD = depth / 2;

  // ——— цоколь ———
  group.add(box(materials.white, [width + 0.5, BASE_HEIGHT, depth + 0.5], [centerX, top + BASE_HEIGHT / 2, centerZ]));

  // ——— стены первого этажа: сегменты вокруг проёмов ———
  const frontZ = front - WALL / 2;
  const backZ = centerZ - halfD + WALL / 2;
  const sideX = halfW - WALL / 2;
  const wallCenterY = y0 + height / 2;
  const wallHeight = height;

  // Фасад: витраж 5.2 м (x −4.2…1.0) и вход (x 1.9…3.2)
  const slidingFrom = centerX - 4.2;
  const slidingTo = centerX + 1.0;
  const doorFrom = centerX + 1.9;
  const doorTo = centerX + 3.2;
  const slidingHeight = 2.6;
  const doorHeight = 2.4;

  const frontSegments: [number, number][] = [
    [centerX - halfW + SEAM, slidingFrom],
    [slidingTo, doorFrom],
    [doorTo, centerX + halfW - SEAM],
  ];
  for (const [from, to] of frontSegments) {
    const w = to - from;
    if (w <= 0.001) continue;
    group.add(wallPad(materials, [w, wallHeight, WALL], [(from + to) / 2, wallCenterY, frontZ], 4));
  }
  // Перемычки над проёмами
  group.add(
    wallPad(
      materials,
      [slidingTo - slidingFrom, height - slidingHeight, WALL],
      [(slidingFrom + slidingTo) / 2, y0 + slidingHeight + (height - slidingHeight) / 2, frontZ],
      4,
    ),
  );
  group.add(
    wallPad(
      materials,
      [doorTo - doorFrom, height - doorHeight, WALL],
      [(doorFrom + doorTo) / 2, y0 + doorHeight + (height - doorHeight) / 2, frontZ],
      4,
    ),
  );

  // Задняя стена (сплошная) и боковые — с окнами
  group.add(wallPad(materials, [width - SEAM * 2, wallHeight, WALL], [centerX, wallCenterY, backZ], 5));

  const sideWindowZ = centerZ + 1.4;
  const sideWindowHalf = 0.7;
  const sideSill = 0.95;
  const sideTop = 2.5;
  for (const side of [-1, 1] as const) {
    const outward = side > 0 ? 0 : 1;
    const x = side * sideX;
    const segments: [number, number][] = [
      [centerZ - halfD + SEAM, sideWindowZ - sideWindowHalf],
      [sideWindowZ + sideWindowHalf, front - SEAM],
    ];
    for (const [from, to] of segments) {
      group.add(
        wallPad(materials, [WALL, wallHeight - 0.03, to - from], [x, y0 + (wallHeight - 0.03) / 2, (from + to) / 2], outward),
      );
    }
    group.add(
      wallPad(
        materials,
        [WALL, sideSill, sideWindowHalf * 2],
        [x, y0 + sideSill / 2, sideWindowZ],
        outward,
      ),
    );
    group.add(
      wallPad(
        materials,
        [WALL, height - sideTop, sideWindowHalf * 2],
        [x, y0 + sideTop + (height - sideTop) / 2, sideWindowZ],
        outward,
      ),
    );
  }

  // ——— пол и потолок интерьера ———
  const innerWidth = width - WALL * 2;
  const innerDepth = depth - WALL * 2;
  const innerCenterZ = centerZ;
  // Верх пола на 5 мм выше плиты цоколя (задача 10): иначе две поверхности
  // лежат в одной плоскости и пол мерцает на всей площади комнаты.
  group.add(box(materials.oakFloor, [innerWidth, 0.1, innerDepth], [centerX, y0 - 0.045, innerCenterZ]));
  group.add(box(materials.plaster, [innerWidth, 0.2, innerDepth], [centerX, y0 + CEILING_HEIGHT + 0.1, innerCenterZ]));

  // Плинтусы по периметру
  const baseH = 0.11;
  const baseT = 0.035;
  for (const side of [-1, 1]) {
    group.add(box(materials.trim, [innerWidth - 0.01, baseH, baseT], [centerX, y0 + baseH / 2, innerCenterZ + side * (innerDepth / 2 - baseT / 2 + 0.005)]));
    group.add(box(materials.trim, [baseT, baseH, innerDepth - 0.01], [centerX + side * (innerWidth / 2 - baseT / 2 + 0.005), y0 + baseH / 2, innerCenterZ]));
  }

  // ——— витраж фасада (стекло прозрачное — интерьер видно снаружи) ———
  const glassMaterial = materials.windowGlass;

  const panelWidth = (slidingTo - slidingFrom) / 4;
  for (let i = 0; i < 3; i += 1) {
    const x = slidingFrom + panelWidth * (i + 0.5);
    group.add(box(glassMaterial, [panelWidth - 0.04, slidingHeight - 0.06, 0.04], [x, y0 + slidingHeight / 2, frontZ + 0.05]));
    group.add(box(materials.trim, [0.06, slidingHeight, 0.06], [slidingFrom + panelWidth * i, y0 + slidingHeight / 2, frontZ + 0.07]));
  }
  group.add(box(materials.trim, [0.06, slidingHeight, 0.06], [slidingTo, y0 + slidingHeight / 2, frontZ + 0.07]));
  // Открытая створка: сдвинута в сторону, проём свободен
  group.add(box(glassMaterial, [panelWidth - 0.04, slidingHeight - 0.06, 0.04], [slidingFrom + panelWidth * 2.5, y0 + slidingHeight / 2, frontZ - 0.12]));
  group.add(box(materials.trim, [panelWidth, 0.07, 0.06], [slidingFrom + panelWidth * 2.5, y0 + slidingHeight - 0.03, frontZ - 0.12]));
  group.add(box(materials.trim, [panelWidth, 0.07, 0.06], [slidingFrom + panelWidth * 2.5, y0 + 0.03, frontZ - 0.12]));

  // Рама витража: верх, низ и наличники
  group.add(box(materials.trim, [slidingTo - slidingFrom + 0.2, 0.1, 0.16], [(slidingFrom + slidingTo) / 2, y0 + slidingHeight + 0.05, front - 0.02]));
  group.add(box(materials.trim, [slidingTo - slidingFrom + 0.2, 0.06, 0.2], [(slidingFrom + slidingTo) / 2, y0 + 0.03, front - 0.01]));
  for (const x of [slidingFrom - 0.08, slidingTo + 0.08]) {
    group.add(box(materials.trim, [0.15, slidingHeight + 0.12, 0.15], [x, y0 + slidingHeight / 2, front - 0.02]));
  }

  // ——— входная дверь ———
  const doorWidth = doorTo - doorFrom;
  group.add(box(materials.trim, [doorWidth + 0.16, doorHeight + 0.12, 0.14], [(doorFrom + doorTo) / 2, y0 + doorHeight / 2, front + 0.02]));
  const doorLeaf = box(materials.oakFurniture, [doorWidth - 0.06, doorHeight - 0.04, 0.06], [(doorFrom + doorTo) / 2, y0 + doorHeight / 2, front + 0.1]);
  doorLeaf.material = materials.oakFurniture;
  group.add(doorLeaf);
  group.add(box(glassMaterial, [doorWidth * 0.5, doorHeight * 0.66, 0.02], [(doorFrom + doorTo) / 2, y0 + doorHeight * 0.58, front + 0.14]));
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 10), materials.brass);
  handle.rotation.z = Math.PI / 2;
  handle.position.set((doorFrom + doorTo) / 2 + doorWidth * 0.32, y0 + 1.05, front + 0.16);
  group.add(handle);

  // Стена дома: номер и фонарь у входа
  for (const offset of [-0.75, 0.75]) {
    const lampBody = box(materials.metal, [0.13, 0.24, 0.13], [(doorFrom + doorTo) / 2 + offset, y0 + 2.12, front + 0.09]);
    group.add(lampBody);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xffe9c4, emissive: 0xffd79a, emissiveIntensity: 1.6, roughness: 0.6 }),
    );
    glow.position.set((doorFrom + doorTo) / 2 + offset, y0 + 2.1, front + 0.16);
    group.add(glow);
  }

  // ——— боковые окна ———
  for (const side of [-1, 1] as const) {
    const x = side * (halfW + 0.01);
    const windowHeight = sideTop - sideSill;
    group.add(box(materials.windowGlass, [0.03, windowHeight, sideWindowHalf * 2], [x, y0 + sideSill + windowHeight / 2, sideWindowZ]));
    group.add(box(materials.trim, [0.1, windowHeight + 0.16, sideWindowHalf * 2 + 0.16], [x + side * 0.03, y0 + sideSill + windowHeight / 2, sideWindowZ]));
    // Подоконник снаружи
    group.add(box(materials.trim, [0.15, 0.07, sideWindowHalf * 2 + 0.24], [x + side * 0.06, y0 + sideSill - 0.03, sideWindowZ]));
  }

  // ——— угловые накладки и водостоки ———
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = centerX + sx * (halfW + 0.02);
      group.add(box(materials.trim, [0.11, height - 0.03, 0.11], [x, y0 + (height - 0.03) / 2, centerZ + sz * (halfD - 0.06)]));
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, height - 0.2, 10), materials.metal);
    pipe.position.set(centerX + sx * (halfW - 0.14), y0 + (height - 0.2) / 2, front + 0.12);
    pipe.castShadow = true;
    group.add(pipe);
  }

  // ——— второй этаж (внутри пока пусто: спальня не нужна по заданию) ———
  const upperWidth = width * 0.7;
  const upperDepth = depth * 0.84;
  const upperHeight = 2.9;
  const upperX = centerX - 1.6;
  const upperZ = centerZ - 0.5;
  group.add(box(materials.siding, [upperWidth, upperHeight, upperDepth], [upperX, y0 + height + upperHeight / 2, upperZ]));

  const upperBelt = box(materials.glass, [upperWidth * 0.78, 1.25, 0.05], [upperX - 0.4, y0 + height + 1.55, upperZ + upperDepth / 2 + 0.03]);
  group.add(upperBelt);
  for (let i = 0; i < 4; i += 1) {
    const x = upperX - 0.4 - upperWidth * 0.39 + (i / 3) * upperWidth * 0.78;
    group.add(box(materials.trim, [0.06, 1.3, 0.07], [x, y0 + height + 1.55, upperZ + upperDepth / 2 + 0.08]));
  }

  // ——— плоские крыши с белым парапетом ———
  const addRoof = (w: number, d: number, x: number, z: number, y: number): void => {
    const roofW = w + roofOverhang * 2;
    const roofD = d + roofOverhang * 2;
    group.add(box(materials.darkRoof, [roofW, 0.26, roofD], [x, y + 0.13, z]));
    const parapetHeight = 0.22;
    const thickness = 0.12;
    const parapetY = y + 0.26 + parapetHeight / 2;
    for (const side of [-1, 1]) {
      group.add(box(materials.trim, [roofW, parapetHeight, thickness], [x, parapetY, z + side * (roofD / 2 - thickness / 2)]));
      group.add(box(materials.trim, [thickness, parapetHeight, roofD - thickness * 2], [x + side * (roofW / 2 - thickness / 2), parapetY, z]));
    }
  };
  addRoof(width, depth, centerX, centerZ, y0 + height);
  addRoof(upperWidth, upperDepth, upperX, upperZ, y0 + height + upperHeight);

  // ——— козырёк над входом ———
  group.add(box(materials.trim, [3.4, 0.14, 1.7], [centerX + 2.2, y0 + 2.66, front + 0.85]));

  // ——— настил террасы и ступень ———
  const deckWidth = width + 0.6;
  group.add(box(materials.wood, [deckWidth, 0.22, terraceDepth], [centerX, top + 0.3, front + terraceDepth / 2]));
  group.add(box(materials.wood, [deckWidth * 0.7, 0.12, 0.4], [centerX, top + 0.2, front + terraceDepth + 0.2]));

  // Порог между настилом и полом дома — чтобы не было щели под витражом
  group.add(box(materials.stone, [slidingTo - slidingFrom + 0.4, 0.06, 0.5], [(slidingFrom + slidingTo) / 2, y0 - 0.025, front + 0.2]));

  // ——— пергола над западной частью террасы ———
  const pergolaFrom = centerX - deckWidth / 2 + 0.5;
  const pergolaTo = centerX - 1.6;
  const beamCount = 6;
  for (let i = 0; i < beamCount; i += 1) {
    const x = pergolaFrom + (i / (beamCount - 1)) * (pergolaTo - pergolaFrom);
    group.add(box(materials.trim, [0.13, 0.15, terraceDepth + 0.5], [x, top + 3.12, front + terraceDepth / 2]));
  }
  for (const x of [pergolaFrom + 0.1, pergolaTo - 0.1]) {
    group.add(box(materials.trim, [0.15, 2.8, 0.15], [x, top + 1.72, front + terraceDepth - 0.3]));
  }
  group.add(box(materials.trim, [pergolaTo - pergolaFrom + 0.3, 0.13, 0.13], [(pergolaFrom + pergolaTo) / 2, top + 3.02, front + terraceDepth - 0.3]));

  // ——— столкновения стен: проём витража (сдвинутая створка) остаётся свободным ———
  const wallTop = y0 + height;
  for (const [from, to] of frontSegments) {
    collisions.addBox(from, to, frontZ - WALL / 2, frontZ + WALL / 2, wallTop);
  }
  collisions.addBox(slidingFrom, slidingTo - panelWidth, frontZ - WALL / 2, frontZ + WALL / 2, wallTop);
  collisions.addBox(doorFrom, doorTo, frontZ - WALL / 2, frontZ + WALL / 2, wallTop);
  collisions.addBox(centerX - halfW, centerX + halfW, backZ - WALL / 2, backZ + WALL / 2, wallTop);
  for (const side of [-1, 1] as const) {
    const x = side * sideX;
    collisions.addBox(x - WALL / 2, x + WALL / 2, centerZ - halfD, front, wallTop);
  }

  return {
    group,
    floorY: y0,
    entrance: { x: (doorFrom + doorTo) / 2, z: front, width: doorWidth },
    terraceDoor: { x: (slidingFrom + slidingTo) / 2, z: front, width: slidingTo - slidingFrom },
    interior: {
      minX: centerX - innerWidth / 2,
      maxX: centerX + innerWidth / 2,
      minZ: innerCenterZ - innerDepth / 2,
      maxZ: innerCenterZ + innerDepth / 2,
      ceilingY: y0 + CEILING_HEIGHT,
    },
  };
}
