import * as THREE from 'three';
import { VILLA } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';
import type { InteriorBounds } from './Villa';
import type { CollisionWorld } from '../Colliders';

/** Интерьер первого этажа (задача 5): открытая гостиная-столовая-кухня.
 *  Всё стоит на полу дома (y0), прижато к стенам без щелей и зазоров,
 *  ничего не перекрывает проём витража, через который входят с террасы. */

export interface InteriorResult {
  readonly group: THREE.Group;
  /** Тёплые лампы: без них комната выглядит «мёртвой» — солнце внутрь почти не попадает. */
  readonly lights: THREE.PointLight[];
  readonly emissive: THREE.Mesh[];
}

type Vec3 = [number, number, number];

export function buildInterior(
  materials: IslandMaterials,
  bounds: InteriorBounds,
  floorY: number,
  collisions: CollisionWorld,
): InteriorResult {
  const group = new THREE.Group();
  group.name = 'interior';
  const y0 = floorY;
  const lights: THREE.PointLight[] = [];
  const emissive: THREE.Mesh[] = [];

  const part = (material: THREE.Material, size: Vec3, position: Vec3, rotationY = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const cylinder = (
    material: THREE.Material,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    position: Vec3,
    segments = 16,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  /** Коллайдер мебели: прямоугольник в плане + высота, чтобы камера летела поверх. */
  const block = (cx: number, cz: number, width: number, depth: number, top: number): void => {
    collisions.addBox(cx - width / 2, cx + width / 2, cz - depth / 2, cz + depth / 2, top);
  };

  // ————————————————————— Гостиная (левая половина, лицом к морю) —————————————————————
  const sofaX = -3.9;
  const sofaZ = -9.4;

  // Ковёр
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.0), materials.fabricCream);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(sofaX + 0.5, y0 + 0.014, sofaZ + 0.8);
  rug.receiveShadow = true;
  group.add(rug);

  block(sofaX, sofaZ, 2.9, 1.1, y0 + 1.0);

  // Диван: основа, сиденья, спинка, подлокотники, подушки
  part(materials.fabricCream, [2.7, 0.34, 1.0], [sofaX, y0 + 0.29, sofaZ]);
  part(materials.fabricCream, [2.74, 0.12, 1.04], [sofaX, y0 + 0.06, sofaZ]);
  for (let i = 0; i < 3; i += 1) {
    part(materials.fabricCream, [0.84, 0.16, 0.92], [sofaX - 0.9 + i * 0.9, y0 + 0.53, sofaZ + 0.02]);
  }
  part(materials.fabricCream, [2.7, 0.62, 0.2], [sofaX, y0 + 0.72, sofaZ - 0.42]);
  for (const side of [-1, 1]) {
    part(materials.fabricCream, [0.18, 0.62, 0.98], [sofaX + side * 1.35, y0 + 0.5, sofaZ]);
  }
  // Декоративные подушки
  part(materials.fabricTeal, [0.42, 0.42, 0.14], [sofaX - 0.85, y0 + 0.78, sofaZ - 0.28], 0.16);
  part(materials.fabricTeal, [0.42, 0.42, 0.14], [sofaX + 0.9, y0 + 0.78, sofaZ - 0.28], -0.2);
  part(materials.brass, [0.4, 0.4, 0.12], [sofaX + 0.02, y0 + 0.78, sofaZ - 0.3], 0.05);

  block(sofaX + 0.15, sofaZ + 1.55, 1.3, 1.3, y0 + 0.46);

  // Журнальный столик
  cylinder(materials.stone, 0.62, 0.62, 0.06, [sofaX + 0.15, y0 + 0.42, sofaZ + 1.55]);
  cylinder(materials.oakFurniture, 0.1, 0.14, 0.4, [sofaX + 0.15, y0 + 0.2, sofaZ + 1.55], 12);
  cylinder(materials.oakFurniture, 0.36, 0.42, 0.04, [sofaX + 0.15, y0 + 0.02, sofaZ + 1.55], 16);
  // Книги и ваза на столике
  part(materials.screenDark, [0.3, 0.04, 0.22], [sofaX - 0.1, y0 + 0.47, sofaZ + 1.5], 0.2);
  part(materials.trim, [0.28, 0.035, 0.2], [sofaX - 0.11, y0 + 0.51, sofaZ + 1.52], -0.1);
  cylinder(materials.terracotta, 0.09, 0.12, 0.26, [sofaX + 0.34, y0 + 0.58, sofaZ + 1.6], 14);

  // Кресло у окна
  const chairX = 2.3;
  const chairZ = -9.6;
  block(chairX, chairZ, 0.9, 0.9, y0 + 0.95);
  part(materials.fabricTeal, [0.78, 0.3, 0.78], [chairX, y0 + 0.26, chairZ]);
  // Спинка и подлокотники сидят на 5 мм внутри габарита сиденья (задача 10):
  // вровень с ним их грани совпадали бы и мерцали.
  part(materials.fabricTeal, [0.77, 0.55, 0.16], [chairX, y0 + 0.62, chairZ - 0.305]);
  for (const side of [-1, 1]) {
    part(materials.fabricTeal, [0.14, 0.5, 0.76], [chairX + side * 0.31, y0 + 0.44, chairZ]);
  }
  for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) {
    cylinder(materials.oakFurniture, 0.03, 0.03, 0.22, [chairX + dx, y0 + 0.11, chairZ + dz], 8);
  }

  // ————————————————————— Столовая (справа у витража) —————————————————————
  const tableX = 4.5;
  const tableZ = -8.2;
  block(tableX, tableZ, 2.3, 1.1, y0 + 0.8);
  part(materials.oakFurniture, [2.2, 0.07, 1.0], [tableX, y0 + 0.75, tableZ]);
  for (const [dx, dz] of [[-0.98, -0.4], [0.98, -0.4], [-0.98, 0.4], [0.98, 0.4]] as const) {
    part(materials.oakFurniture, [0.07, 0.72, 0.07], [tableX + dx, y0 + 0.36, tableZ + dz]);
  }
  // Стулья: три с дальней стороны, три с ближней
  const placeChair = (x: number, z: number, rotation: number): void => {
    block(x, z, 0.55, 0.55, y0 + 1.0);
    part(materials.oakFurniture, [0.46, 0.05, 0.46], [x, y0 + 0.45, z], rotation);
    part(materials.oakFurniture, [0.46, 0.5, 0.05], [x + Math.sin(rotation) * 0.21, y0 + 0.7, z + Math.cos(rotation) * 0.21], rotation);
    for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) {
      part(materials.oakFurniture, [0.04, 0.44, 0.04], [x + dx, y0 + 0.22, z + dz], rotation);
    }
  };
  for (let i = 0; i < 3; i += 1) {
    placeChair(tableX - 0.75 + i * 0.75, tableZ - 0.78, 0);
    placeChair(tableX - 0.75 + i * 0.75, tableZ + 0.78, Math.PI);
  }

  // Ковёр под обеденной группой
  const diningRug = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.2), materials.fabricCream);
  diningRug.rotation.x = -Math.PI / 2;
  diningRug.position.set(tableX, y0 + 0.014, tableZ);
  diningRug.receiveShadow = true;
  group.add(diningRug);

  // Подвес над обеденным столом
  cylinder(materials.metal, 0.008, 0.008, 1.2, [tableX, (bounds.ceilingY + y0 + 2.1) / 2 + 0.2, tableZ], 6);
  const diningShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.24, 22, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2f3336, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }),
  );
  diningShade.position.set(tableX, bounds.ceilingY - 1.05, tableZ);
  group.add(diningShade);
  const diningBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffd79a, emissiveIntensity: 2.4, roughness: 0.5 }),
  );
  diningBulb.position.set(tableX, bounds.ceilingY - 1.16, tableZ);
  group.add(diningBulb);
  emissive.push(diningBulb);

  // ————————————————————— Кухня у задней стены —————————————————————
  const backWall = bounds.minZ;
  const counterDepth = 0.64;
  const counterZ = backWall + counterDepth / 2 + 0.02;
  const counterFrom = bounds.minX + 0.3;
  const counterTo = 1.0;
  const counterWidth = counterTo - counterFrom;

  block((counterFrom + counterTo) / 2, counterZ, counterWidth, counterDepth + 0.05, y0 + 0.95);

  // Нижние шкафы + столешница
  part(materials.oakFurniture, [counterWidth, 0.86, counterDepth], [(counterFrom + counterTo) / 2, y0 + 0.43, counterZ]);
  // Фартук-панель за столешницей
  part(materials.stone, [counterWidth, 0.42, 0.03], [(counterFrom + counterTo) / 2, y0 + 1.12, backWall + 0.025]);
  part(materials.stone, [counterWidth + 0.04, 0.06, counterDepth + 0.04], [(counterFrom + counterTo) / 2, y0 + 0.89, counterZ]);
  // Ручки шкафов
  for (let i = 0; i < 6; i += 1) {
    const x = counterFrom + 0.55 + i * ((counterWidth - 1.1) / 5);
    part(materials.brass, [0.22, 0.02, 0.02], [x, y0 + 0.74, counterZ + counterDepth / 2 + 0.01]);
  }
  // Мойка и смеситель
  part(materials.metal, [0.62, 0.03, 0.42], [counterFrom + 1.1, y0 + 0.9, counterZ]);
  part(materials.screenDark, [0.54, 0.08, 0.34], [counterFrom + 1.1, y0 + 0.845, counterZ]);
  const tap = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 24, Math.PI), materials.brass);
  tap.position.set(counterFrom + 1.1, y0 + 1.06, counterZ - 0.16);
  tap.rotation.set(0, 0, 0);
  group.add(tap);
  // Варочная панель
  part(materials.screenDark, [0.62, 0.012, 0.48], [counterFrom + 3.3, y0 + 0.93, counterZ]);
  for (const [dx, dz] of [[-0.15, -0.11], [0.15, -0.11], [-0.15, 0.11], [0.15, 0.11]] as const) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.075, 18), materials.metal);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(counterFrom + 3.3 + dx, y0 + 0.94, counterZ + dz);
    group.add(ring);
  }

  // Верхние шкафы (с разрывом над мойкой — там окно света)
  part(materials.oakFurniture, [2.4, 0.7, 0.36], [counterFrom + 1.3, y0 + 2.06, backWall + 0.2]);
  part(materials.oakFurniture, [2.2, 0.7, 0.36], [counterFrom + 4.6, y0 + 2.06, backWall + 0.2]);
  part(materials.stone, [2.0, 0.02, 0.34], [counterFrom + 3.0, y0 + 1.72, backWall + 0.2]);

  block(counterTo + 0.62, backWall + 0.4, 0.95, 0.75, y0 + 2.0);

  // Холодильник
  part(materials.metal, [0.92, 2.0, 0.72], [counterTo + 0.62, y0 + 1.0, backWall + 0.4]);
  part(materials.screenDark, [0.04, 0.7, 0.03], [counterTo + 0.2, y0 + 1.3, backWall + 0.77]);

  // Остров с барными стульями
  const islandX = -2.6;
  const islandZ = -12.3;
  block(islandX, islandZ, 2.8, 1.15, y0 + 0.95);
  part(materials.oakFurniture, [2.6, 0.86, 1.0], [islandX, y0 + 0.43, islandZ]);
  part(materials.stone, [2.76, 0.07, 1.12], [islandX, y0 + 0.9, islandZ]);
  for (let i = 0; i < 3; i += 1) {
    const x = islandX - 0.8 + i * 0.8;
    cylinder(materials.oakFurniture, 0.19, 0.19, 0.06, [x, y0 + 0.66, islandZ + 0.86], 18);
    cylinder(materials.metal, 0.035, 0.035, 0.63, [x, y0 + 0.33, islandZ + 0.86], 10);
    cylinder(materials.metal, 0.19, 0.19, 0.03, [x, y0 + 0.02, islandZ + 0.86], 18);
  }
  // Фрукты и доска на острове
  cylinder(materials.trim, 0.22, 0.18, 0.05, [islandX + 0.55, y0 + 0.96, islandZ + 0.1], 20);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), i % 2 === 0 ? materials.terracotta : materials.magenta);
    fruit.position.set(islandX + 0.55 + Math.cos(angle) * 0.08, y0 + 1.0, islandZ + 0.1 + Math.sin(angle) * 0.08);
    group.add(fruit);
  }

  // Консоль у задней стены за обеденной группой: пустая стена оживает
  block(5.0, bounds.minZ + 0.24, 1.9, 0.45, y0 + 0.8);
  part(materials.oakFurniture, [1.9, 0.78, 0.42], [5.0, y0 + 0.39, bounds.minZ + 0.24]);
  part(materials.trim, [1.4, 0.9, 0.05], [5.0, y0 + 1.75, bounds.minZ + 0.04]);
  part(materials.fabricTeal, [1.24, 0.74, 0.02], [5.0, y0 + 1.75, bounds.minZ + 0.07]);
  cylinder(materials.terracotta, 0.14, 0.1, 0.3, [4.4, y0 + 0.93, bounds.minZ + 0.24], 16);
  cylinder(materials.brass, 0.06, 0.06, 0.22, [5.6, y0 + 0.89, bounds.minZ + 0.24], 14);

  // ————————————————————— Медиа-стена справа —————————————————————
  const mediaX = bounds.maxX - 0.9;
  block(mediaX, centerZ + 1.6, 0.5, 2.3, y0 + 0.55);
  part(materials.oakFurniture, [0.42, 0.5, 2.2], [mediaX, y0 + 0.25, centerZ + 1.6]);
  part(materials.screenDark, [0.06, 0.92, 1.62], [bounds.maxX - 0.05, y0 + 1.62, centerZ + 1.6]);
  part(materials.trim, [0.04, 1.0, 1.7], [bounds.maxX - 0.02, y0 + 1.62, centerZ + 1.6]);
  // Колонки
  for (const offset of [-1.15, 1.15]) {
    part(materials.screenDark, [0.18, 0.3, 0.18], [mediaX, y0 + 0.66, centerZ + 1.6 + offset]);
  }

  // ————————————————————— Декор —————————————————————
  // Картина на левой стене
  part(materials.trim, [0.06, 1.05, 0.78], [bounds.minX + 0.04, y0 + 1.85, centerZ + 2.4]);
  part(materials.fabricTeal, [0.02, 0.92, 0.66], [bounds.minX + 0.08, y0 + 1.85, centerZ + 2.4]);
  // Второе панно — над диваном
  part(materials.trim, [0.06, 0.62, 1.3], [bounds.minX + 0.04, y0 + 2.0, sofaZ]);
  part(materials.terracotta, [0.02, 0.5, 1.18], [bounds.minX + 0.08, y0 + 2.0, sofaZ]);

  // Растения в кадках
  const addPlant = (x: number, z: number, scale: number): void => {
    block(x, z, 0.5 * scale, 0.5 * scale, y0 + 1.1 * scale);
    cylinder(materials.terracotta, 0.24 * scale, 0.19 * scale, 0.4 * scale, [x, y0 + 0.2 * scale, z], 18);
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16 * scale, 8, 6), materials.foliage);
      leaf.position.set(x + Math.cos(angle) * 0.16 * scale, y0 + (0.5 + (i % 3) * 0.16) * scale, z + Math.sin(angle) * 0.16 * scale);
      leaf.scale.set(1.5, 0.7, 1.2);
      leaf.castShadow = true;
      group.add(leaf);
    }
  };
  addPlant(bounds.maxX - 0.6, bounds.maxZ - 0.7, 1.15);
  addPlant(bounds.minX + 0.7, bounds.minZ + 0.9, 0.9);

  // Торшер у дивана
  cylinder(materials.metal, 0.16, 0.2, 0.04, [bounds.minX + 0.55, y0 + 0.02, sofaZ + 1.5], 18);
  cylinder(materials.metal, 0.022, 0.022, 1.55, [bounds.minX + 0.55, y0 + 0.79, sofaZ + 1.5], 10);
  const lampShade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.26, 0.26, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xfff2dc, roughness: 0.85, side: THREE.DoubleSide, emissive: 0xffe3b0, emissiveIntensity: 0.45 }),
  );
  lampShade.position.set(bounds.minX + 0.55, y0 + 1.62, sofaZ + 1.5);
  group.add(lampShade);
  emissive.push(lampShade);

  // Подвесные лампы над островом
  for (let i = 0; i < 3; i += 1) {
    const x = islandX - 0.8 + i * 0.8;
    cylinder(materials.metal, 0.008, 0.008, 0.95, [x, bounds.ceilingY - 0.48, islandZ], 6);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff4e2, emissive: 0xffd9a0, emissiveIntensity: 2.2, roughness: 0.5 }),
    );
    bulb.position.set(x, bounds.ceilingY - 0.98, islandZ);
    group.add(bulb);
    emissive.push(bulb);
  }

  // Точечные светильники в потолке
  for (let i = 0; i < 6; i += 1) {
    const x = bounds.minX + 1.6 + (i % 3) * 2.6;
    const z = centerZ - 1.6 + Math.floor(i / 3) * 3.2;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 16),
      new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xffe9c8, emissiveIntensity: 1.6, roughness: 0.8 }),
    );
    disc.rotation.x = Math.PI / 2;
    disc.position.set(x, bounds.ceilingY - 0.005, z);
    group.add(disc);
    emissive.push(disc);
  }

  // Шторы по краям витража
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? bounds.minX + 0.45 : bounds.maxX - 0.45;
    const z = bounds.maxZ - 0.35;
    part(materials.curtain, [0.55, 2.9, 0.12], [x, y0 + 1.5, z]);
    part(materials.curtain, [0.12, 2.9, 0.5], [side < 0 ? bounds.minX + 0.2 : bounds.maxX - 0.2, y0 + 1.5, z - 0.2]);
  }

  // Коврик у входа
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), materials.fabricTeal);
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(VILLA.centerX - 1.6 + 1.6, y0 + 0.016, bounds.maxZ - 0.6);
  group.add(mat);

  // ————————————————————— Свет —————————————————————
  const mainLight = new THREE.PointLight(0xffe2b8, 4.2, 15, 2);
  mainLight.position.set(bounds.minX + 3.4, bounds.ceilingY - 0.5, centerZ + 1.4);
  group.add(mainLight);
  lights.push(mainLight);

  const kitchenLight = new THREE.PointLight(0xffeccb, 3.2, 11, 2);
  kitchenLight.position.set(-2.2, bounds.ceilingY - 0.6, centerZ - 2.2);
  group.add(kitchenLight);
  lights.push(kitchenLight);

  // Один прожектор с тенью: мебель получает контактные тени, комната перестаёт «плавать»
  const roomSpot = new THREE.SpotLight(0xffe8c8, 26, 18, 1.15, 0.75, 1.6);
  roomSpot.position.set(bounds.minX + 3.6, bounds.ceilingY - 0.15, centerZ + 0.4);
  roomSpot.target.position.set(bounds.minX + 3.2, y0, centerZ + 1.2);
  roomSpot.castShadow = true;
  roomSpot.shadow.mapSize.set(1024, 1024);
  roomSpot.shadow.bias = -0.0006;
  roomSpot.shadow.normalBias = 0.02;
  roomSpot.shadow.camera.near = 0.4;
  roomSpot.shadow.camera.far = 16;
  group.add(roomSpot, roomSpot.target);

  const diningLight = new THREE.PointLight(0xffdcae, 2.6, 10, 2);
  diningLight.position.set(bounds.maxX - 2.0, bounds.ceilingY - 0.7, centerZ + 2.2);
  group.add(diningLight);
  lights.push(diningLight);

  return { group, lights, emissive };
}
