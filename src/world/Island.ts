import * as THREE from 'three';
import { COURT, ISLAND, PLOT, STADIUM, TERRACE, TOWN, VILLA } from '../core/Config';
import type { LoadedAssets } from '../core/Assets';
import { createIslandMaterials, type IslandMaterials } from './island/IslandTextures';
import { buildGround } from './island/Ground';
import { buildFence } from './island/Fence';
import { buildVilla, type VillaResult } from './island/Villa';
import { buildInterior, type InteriorResult } from './island/Interior';
import { buildCourt, type CourtResult } from './island/Court';
import { buildProps, buildDistantShore } from './island/Props';
import { buildVegetation, type VegetationResult } from './island/Vegetation';
import { buildRenovation, type RenovationResult } from './island/Renovation';
import { buildTown, type TownResult } from './island/Town';
import { buildStadium, type StadiumResult } from './island/Stadium';
import { buildDetails, type DetailsResult } from './island/Details';
import { buildGrass, type GrassResult } from './island/GrassField';
import { mergeStaticMeshes } from './island/mergeStatic';
import type { AuditNode } from './SceneAudit';
import { CollisionWorld } from './Colliders';

export interface WalkBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Остров-мыс по референсу заказчика (`docs/references/ref-outdoor.jpg`):
 *  газонное плато со скалой, белый штакетник, гравийная дорожка, вилла с террасой,
 *  пальмы, бугенвиллия и баскетбольная площадка в стороне.
 *  Модули лежат в `world/island/` — каждый можно развивать, не трогая остальные. */
export class Island {
  readonly group = new THREE.Group();
  readonly bounds: WalkBounds;
  /** Уровень пола в доме (задача 5 — интерьер). */
  readonly floorY: number;
  /** Проём входной двери. */
  readonly entrance: { x: number; z: number; width: number };
  /** Точка кольца (задача 8 — два гола). */
  readonly hoop: THREE.Vector3;
  /** Площадка целиком: геометрия кольца и щита нужна физике мяча (задача 8). */
  readonly court: CourtResult;
  /** Мир столкновений: стены, мебель, забор, стволы, опора кольца (задача 6). */
  readonly collisions = new CollisionWorld();
  /** Ремонт в комнате: неокрашенная стена, валик, банка (задача 7). */
  readonly renovation: RenovationResult;
  /** Посёлок из пяти домов вокруг виллы (задача 13). */
  readonly town: TownResult;
  /** Стадион в конце улицы (задача 16): чаша, поле, ворота, табло, касса. */
  readonly stadium: StadiumResult;
  /** Поле травы: один InstancedMesh с ветром (задача 13). */
  readonly grass: GrassResult;
  readonly details: DetailsResult;
  /** Всего предметов декорации на острове — для отчёта о детализации. */
  get decorationCount(): number {
    return this.town.objectCount + this.grass.instances;
  }

  private readonly materials: IslandMaterials;
  private readonly vegetation: VegetationResult;
  private readonly villa: VillaResult;
  private readonly interior: InteriorResult;
  private readonly geometries: THREE.BufferGeometry[] = [];
  /** Сколько мешей было и стало после склейки статики (для отчёта о бюджете). */
  mergeStats: { before: number; after: number } = { before: 0, after: 0 };
  /** Предметы до склейки статики — вход для аудита сцены (задача 10). */
  readonly auditFootprints: AuditNode[] = [];

  constructor(assets: LoadedAssets) {
    void assets; // остров целиком процедурный — внешние текстуры не нужны
    this.group.name = 'island';

    this.materials = createIslandMaterials();
    this.villa = buildVilla(this.materials, this.collisions);
    this.interior = buildInterior(this.materials, this.villa.interior, this.villa.floorY, this.collisions);
    this.renovation = buildRenovation(this.materials, this.villa.interior, this.villa.floorY, this.collisions);
    this.court = buildCourt(this.materials, this.collisions);
    this.vegetation = buildVegetation(this.materials, this.collisions);

    const ground = buildGround(this.materials);
    const fence = buildFence(this.materials, this.collisions);
    const props = buildProps(this.materials);
    const distantShore = buildDistantShore();

    // ——— посёлок (задача 13): пять домов вокруг старой виллы ———
    this.town = buildTown(this.materials, this.collisions);
    // Стадион строится до травы: его чаша, площадь и аллея тоже не засеиваются.
    this.stadium = buildStadium(this.materials, this.collisions);
    // Живые детали (задача 21) — до травы: их площадки тоже не засеиваются
    this.details = buildDetails(this.materials);
    // Трава сеется после домов: занятые участки, дорожки и улица остаются чистыми
    this.grass = buildGrass(
      [...this.town.occupied, ...this.stadium.clearings, ...this.details.occupied],
      9000,
    );

    this.group.add(
      ground,
      fence,
      this.villa.group,
      this.interior.group,
      this.renovation.group,
      this.court.group,
      props,
      this.vegetation.group,
      this.town.group,
      this.stadium.group,
      this.grass.group,
      this.details.group,
      distantShore,
    );

    // ——— бюджет §4.4: статичная геометрия склеивается по материалам ———
    // Вилла, интерьер, забор и двор — сотни отдельных мешей; после склейки на каждый
    // материал остаётся один draw call. Растительность качается, покраска и кольцо
    // ссылаются на конкретные меши — их не трогаем.
    const merged = [
      mergeStaticMeshes(this.villa.group, { labelRoot: this.group }),
      mergeStaticMeshes(this.interior.group, { labelRoot: this.group }),
      mergeStaticMeshes(fence, { labelRoot: this.group }),
      mergeStaticMeshes(props, { labelRoot: this.group }),
      mergeStaticMeshes(this.court.group, { labelRoot: this.group, skip: ['court-rim', 'court-net'] }),
      mergeStaticMeshes(this.town.group, { labelRoot: this.group }),
      // Табло и таблички склеивать нельзя: на текстуры ссылается игровой код.
      mergeStaticMeshes(this.stadium.group, {
        labelRoot: this.group,
        skip: ['stadium-scoreboard-face', 'stadium-ticket-sign-face', 'stadium-gate-sign-face'],
      }),
      mergeStaticMeshes(ground, { labelRoot: this.group }),
    ];
    this.mergeStats = {
      before: merged.reduce((sum, item) => sum + item.before, 0),
      after: merged.reduce((sum, item) => sum + item.after, 0),
    };

    // Снимок «предметов», ушедших в батчи: аудит задачи 10 ищет мерцание и наложения
    // по исходным деталям, а не по слитым блокам.
    for (const result of merged) this.auditFootprints.push(...result.nodes);

    this.floorY = this.villa.floorY;
    this.entrance = this.villa.entrance;
    this.hoop = this.court.hoop;

    // Границы обзора для свободной камеры (F3): плато минус запас у кромки
    const marginX = ISLAND.radiusX - ISLAND.walkMargin;
    const marginZ = ISLAND.radiusZ - ISLAND.walkMargin;
    this.bounds = { minX: -marginX, maxX: marginX, minZ: -marginZ, maxZ: marginZ };

    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) this.geometries.push(mesh.geometry);
    });

    // Все объекты стоят на земле — проверяем, что ничего не парит над плато
    this.group.updateMatrixWorld(true);
  }

  /** Где сейчас герой — нужно репликам (задача 17), чтобы «краска сохнет»
   *  не звучала на стадионе, а «вот она, арена» — у виллы. */
  placeAt(x: number, z: number): 'villa' | 'court' | 'stadium' | 'street' {
    const bowl = this.stadium.footprint;
    const onDrive =
      Math.abs(x - STADIUM.driveX) < STADIUM.driveWidth / 2 + 1 &&
      z > STADIUM.centerZ + STADIUM.depth / 2 &&
      z < TOWN.streetZ + 3;
    if ((x > bowl.minX && x < bowl.maxX && z > bowl.minZ && z < bowl.maxZ) || onDrive) return 'stadium';
    if (x > PLOT.fenceMinX && x < PLOT.fenceMaxX && z > PLOT.fenceMinZ && z < PLOT.fenceMaxZ) return 'villa';
    if (
      Math.abs(x - COURT.centerX) < COURT.length / 2 + 3 &&
      Math.abs(z - COURT.centerZ) < COURT.width / 2 + 3
    ) {
      return 'court';
    }
    return 'street';
  }

  /** Анимация: ветер в листьях пальм, кустах и траве. */
  update(elapsed: number, eye?: THREE.Vector3): void {
    this.vegetation.update(elapsed);
    this.grass.update(elapsed, eye);
    this.details.update(elapsed, eye);
  }

  /** Сколько треугольников в сцене острова — для отчёта о производительности. */
  countTriangles(): number {
    let total = 0;
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const geometry = mesh.geometry;
      const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
      const instances = (mesh as THREE.InstancedMesh).isInstancedMesh
        ? (mesh as THREE.InstancedMesh).count
        : 1;
      total += (count / 3) * instances;
    });
    return Math.round(total);
  }

  /** Не даёт уйти за кромку острова: эллипс плато минус радиус тела. */
  clampToIsland(x: number, z: number, radius: number): { x: number; z: number } {
    const limitX = ISLAND.radiusX - ISLAND.walkMargin - radius;
    const limitZ = ISLAND.radiusZ - ISLAND.walkMargin - radius;
    const normalised = (x * x) / (limitX * limitX) + (z * z) / (limitZ * limitZ);
    if (normalised <= 1) return { x, z };
    const scale = 1 / Math.sqrt(normalised);
    return { x: x * scale, z: z * scale };
  }

  /** Координаты земли под точкой: газон, плита площадки, пол дома. */
  groundHeightAt(x: number, z: number): number {
    // Плита баскетбольной площадки чуть выше газона (задача 8: по ней прыгает мяч)
    const court = this.court.bounds;
    if (x > court.minX && x < court.maxX && z > court.minZ && z < court.maxZ) return this.court.slabTopY;
    const insideEllipse = (x * x) / (ISLAND.radiusX * ISLAND.radiusX) + (z * z) / (ISLAND.radiusZ * ISLAND.radiusZ) <= 1;
    if (!insideEllipse) return 0; // вода
    const insidePlot = x > PLOT.fenceMinX && x < PLOT.fenceMaxX && z > PLOT.fenceMinZ && z < PLOT.fenceMaxZ;
    if (!insidePlot) return TERRACE.deckTopY;
    // Внутри дома — пол дома (задача 5)
    const inner = this.villa.interior;
    if (x > inner.minX && x < inner.maxX && z > inner.minZ && z < inner.maxZ) return this.villa.floorY;
    // Терраса и ступени чуть выше газона
    const terraceFront = VILLA.centerZ + VILLA.depth / 2 + VILLA.terraceDepth;
    if (z < terraceFront && z > VILLA.centerZ && Math.abs(x) < VILLA.width / 2 + 0.3) return TERRACE.deckTopY + 0.41;
    return TERRACE.deckTopY;
  }

  dispose(): void {
    for (const geometry of new Set(this.geometries)) geometry.dispose();
    this.renovation.wall.dispose();
    this.grass.dispose();
    this.details.dispose();
    this.town.dispose();
    this.materials.dispose();
    this.group.clear();
  }
}
