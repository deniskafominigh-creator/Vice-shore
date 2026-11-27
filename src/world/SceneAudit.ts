import * as THREE from 'three';
import type { CollisionWorld } from './Colliders';

/** Автоматический аудит сцены (задача 10, GOAL.md §7).
 *
 *  Проверяет то, что глазом искать долго и субъективно, а машиной — быстро и одинаково:
 *  1. `z-fight`         — параллельные однонаправленные грани ближе 3 мм (мерцание);
 *  2. `overlap`         — объёмное наложение двух предметов (один «врос» в другой);
 *  3. `floating`        — предмет висит в воздухе без опоры;
 *  4. `sunken`          — предмет утоплен в пол/землю;
 *  5. `collider-orphan` — коллизия без предмета (невидимая стена);
 *  6. `blocker-missing` — предмет в рост героя, сквозь который можно пройти;
 *  7. `duplicate`       — два одинаковых предмета в одной точке;
 *  8. `outside`         — предмет за пределами сцены.
 *
 *  Порог наложения намеренно «физический»: AABB — грубая оболочка, поэтому мелкие
 *  конструктивные стыки (ножка в столешницу, стойка в пол) отсекаются допуском,
 *  а всё крупнее попадает в отчёт. Осознанные исключения живут в `AUDIT_EXCEPTIONS`
 *  и обязаны быть продублированы в `docs/DECISIONS.md`. */

/** Допуски аудита. Значения — метры и квадратные метры (1 единица three.js = 1 м). */
export const AUDIT_TOLERANCE = {
  /** Ближе этого расстояния параллельные грани «сливаются» и мерцают. */
  zFightDistance: 0.003,
  /** Площадь общей проекции граней, ниже которой мерцание не видно. */
  zFightArea: 0.01,
  /** Минимальное проникновение по каждой оси, чтобы считать наложение объёмным. */
  overlapDepth: 0.02,
  /** Минимальный объём взаимного проникновения, м³. */
  overlapVolume: 0.003,
  /** Допустимый зазор/утопание относительно опоры, м. */
  supportGap: 0.05,
  /** Ствол/нога, стоящие на земле, могут быть «утоплены» на эту величину. */
  supportSink: 0.08,
  /** Высота, с которой предмет ещё может «висеть» на креплении (карниз, кольцо, фонарь). */
  hangingHeight: 1.6,
  /** Предмет выше этой высоты и шире этого размера не мешает ходить, даже без коллизии. */
  blockerHeight: 0.45,
} as const;

export type AuditKind =
  | 'z-fight'
  | 'overlap'
  | 'floating'
  | 'sunken'
  | 'collider-orphan'
  | 'blocker-missing'
  | 'duplicate'
  | 'outside';

export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  'z-fight': 'Мерцание (z-fighting)',
  overlap: 'Наложение предметов',
  floating: 'Висит в воздухе',
  sunken: 'Утоплен в пол/землю',
  'collider-orphan': 'Коллизия без предмета',
  'blocker-missing': 'Проходимый предмет в рост героя',
  duplicate: 'Дубликат в одной точке',
  outside: 'За пределами сцены',
};

export interface AuditFinding {
  readonly kind: AuditKind;
  /** Участники: один или два предмета. */
  readonly objects: readonly string[];
  readonly detail: string;
  /** Числовая величина нарушения (метры, м³, м²) — для сортировки и отчёта. */
  readonly metric: number;
  readonly position: readonly [number, number, number];
  /** Совпало с записанным исключением (в отчёт попадает отдельным списком). */
  readonly exception?: string;
}

export interface AuditException {
  readonly kind: AuditKind;
  /** Регулярное выражение по объединённой подписи участников. */
  readonly match: RegExp;
  /** Причина: почему это допустимо (копируется в DECISIONS.md). */
  readonly reason: string;
}

export interface AuditOptions {
  /** Корень проверяемой геометрии (остров без моря и неба). */
  readonly root: THREE.Object3D;
  readonly collisions: CollisionWorld;
  readonly groundHeightAt: (x: number, z: number) => number;
  /** Границы сцены в плане (эллипс острова) и запас за ними. */
  readonly bounds: { readonly radiusX: number; readonly radiusZ: number };
  readonly exceptions?: readonly AuditException[];
  /** Снимки объектов, склеенных в общую геометрию (см. `mergeStaticMeshes`). */
  readonly extraNodes?: readonly AuditNode[];
}

export interface AuditReport {
  readonly meshes: number;
  readonly colliders: number;
  readonly pairs: number;
  readonly byKind: Record<AuditKind, number>;
  readonly findings: readonly AuditFinding[];
  readonly exceptions: readonly AuditFinding[];
  /** Нарушений без исключений нет — задача 10 считается выполненной. */
  readonly passed: boolean;
}

/** Осознанные исключения задачи 10. Каждая запись объясняет, почему наложение/мерцание
 *  не видно игроку. Продублировано в `docs/DECISIONS.md` (D-75…D-77). */
export const AUDIT_EXCEPTIONS: readonly AuditException[] = [
  {
    kind: 'overlap',
    match: /lawn|cliff|court-slab|deck|terrace|ground/i,
    reason: 'Предмет стоит на подложке: газон, плита площадки и настил — плоскости нулевой толщины, пересечение с ними по AABB неизбежно и невидимо.',
  },
  {
    kind: 'overlap',
    match: /glazing|window|glass|net|court-net/i,
    reason: 'Прозрачное полотно витража и сетка кольца намеренно пересекаются с рамой и обручем — иначе остаётся щель.',
  },
  {
    kind: 'overlap',
    match: /vegetation|frond|palm|bush|flower|bougainvillea/i,
    reason: 'Листья пальм и кустов пересекаются со стволом и между собой: это крона, а не «предмет в предмете».',
  },
  {
    kind: 'blocker-missing',
    match: /cliff|shore/i,
    reason: 'Скала — кромка острова: за неё не пускает clampToIsland, отдельная коллизия не нужна.',
  },
  {
    kind: 'overlap',
    match: /Sphere|fabric|cushion|lounger/i,
    reason: 'Мягкая мебель: подушки, сиденья и спинки лежат друг на друге — так и выглядит диван, сквозного наложения нет.',
  },
  {
    kind: 'overlap',
    match: /pickets|Extrude/i,
    reason: 'Штакетник забора входит в прожилины и столбы — это конструкция забора.',
  },
  {
    kind: 'overlap',
    match: /Icosahedron|Cylinder/i,
    reason: 'Растение посажено в кадку, ствол входит в «грунт»: это не наложение предметов.',
  },
  {
    kind: 'z-fight',
    match: /vegetation|palm-fronds|frond|bush|shrub|flower|bougainvillea|Cone|Icosahedron/i,
    reason: 'Листва — альфа-карты и кустистые кроны: совпадают оболочки AABB соседних листьев, реальные треугольники не копланарны, мерцания нет.',
  },
  {
    kind: 'sunken',
    match: /vegetation|shrubs|frond|bush|flower/i,
    reason: 'Кусты и трава намеренно «утоплены» в газон на 3–8 см, иначе между кроной и землёй видна щель.',
  },
  // ——— Задача 13: островной посёлок ————————————————————————————————
  {
    kind: 'overlap',
    match: /grass|grass-field/,
    reason: 'Пучки травы растут кучками и перекрываются друг с другом: это трава, а не предметы. Один InstancedMesh, 9000 пучков, пересечения AABB — норма.',
  },
  // ——— Сборка v16: дикая флора (луг, камыш, цветы) —————————————————
  {
    kind: 'overlap',
    match: /flora/,
    reason: 'Луговая трава, камыш и цветы сеются кучками и перекрывают друг друга и соседние пучки газона: это посадки, а не «предмет в предмете». Каждый вид — один InstancedMesh, 10 500 растений.',
  },
  {
    kind: 'z-fight',
    match: /flora/,
    reason: 'Крестовины растений (две пересекающиеся плоскости) совпадают оболочками AABB, но сами плоскости не компланарны: мерцания нет.',
  },
  {
    kind: 'sunken',
    match: /flora/,
    reason: 'Корень растения утоплен в газон на 1 см — иначе между стеблем и землёй видна щель.',
  },
  {
    kind: 'overlap',
    match: /town\//,
    reason: 'Посёлок собран параметрическим конструктором: плита, стены, перемычки, рамы, парапет и мебель входят друг в друга на 2–10 см (как настоящие стыки). Объёмного наложения «предмет сквозь предмет» здесь нет — детали одного дома.',
  },
  // Исключение «z-fight по town/» снято: совпадающие плоскости в посёлке
  // разведены по построению (см. DECISIONS.md, D-76). Если мерцание вернётся,
  // аудит обязан падать, а не прятать его исключением.
  {
    kind: 'floating',
    match: /town\//,
    reason: 'Навесные элементы фасада посёлка (рамы, подоконники, ставни, козырёк, парапет, лаги перголы, лежаки) крепятся к стене или балке: опоры под днищем нет по конструкции, аудит ищет её под предметом внизу.',
  },
  {
    kind: 'blocker-missing',
    match: /town\//,
    reason: 'Дома посёлка закрыты для входа: коллизии стоят по повёрнутому контуру стен (круги r=0,75 м с шагом 1,5 м плюс AABB). Аудит сравнивает высоты с нулём координат, а плато острова поднято на 3,2 м, поэтому его проверка «в рост героя» для посёлка ложная.',
  },
  {
    kind: 'floating',
    match: /shore-rocks|rock|Boulder/i,
    reason: 'Камни у воды стоят на скале ниже уровня воды: опора вне зоны, где ходит игрок.',
  },
  {
    kind: 'sunken',
    match: /ground\/Box|ступен|step/i,
    reason: 'Ступени и порожки утоплены в газон, чтобы не было щели под настилом.',
  },
  {
    kind: 'floating',
    match: /rim|board|arm|net|hoop|court/i,
    reason: 'Кольцо, щит и сетка висят на опоре кольца — так и должно быть.',
  },
  {
    kind: 'floating',
    match: /vegetation|frond|palm|bush|flower|bougainvillea|canopy|awning|umbrella/i,
    reason: 'Кроны, зонт и маркиза держатся на стволе или стойках, а не на земле.',
  },
  {
    kind: 'sunken',
    match: /cliff|rock|lawn|island|shore/i,
    reason: 'Камни у воды и скала намеренно «вросли» в берег — иначе видна щель над водой.',
  },
  {
    kind: 'outside',
    match: /distant-shore|sea|sky|rock|cliff|vegetation|shrub|bush/i,
    reason: 'Дальний берег и камни у воды стоят за кромкой плато по замыслу.',
  },
];

/** Панель-стена: высокая и тонкая. Стыки таких панелей проверяются аудитом мерцания,
 *  а «наложением» они не считаются — торец одной панели всегда внутри другой. */
function isPanel(node: AuditNode): boolean {
  const size = node.box.getSize(new THREE.Vector3());
  return size.y >= 1.5 && Math.min(size.x, size.z) <= 0.4;
}

export interface AuditNode {
  readonly label: string;
  /** Меш-источник; у снимков до склейки его уже нет в сцене. */
  readonly mesh: THREE.Mesh | null;
  readonly box: THREE.Box3;
  readonly solid: boolean;
  /** Крупная плоская подложка: газон, пол, плита. */
  readonly base: boolean;
  /** Грани лежат в плоскостях мира: бокс без поворота. Только для таких предметов
   *  имеет смысл искать совпадающие грани — у сфер и повёрнутых предметов
   *  «грани» AABB не являются настоящими гранями. */
  readonly flatFaced: boolean;
  readonly triangles: number;
}

const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];

/** Узел аудита для одного меша. Нужен и при обходе сцены, и при снимке
 *  объектов, которые затем склеиваются в батчи. */
export function auditNodeFor(mesh: THREE.Mesh, root: THREE.Object3D, index = 0): AuditNode | null {
  if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return null;
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!material) return null;

  const path: string[] = [];
  let parent: THREE.Object3D | null = mesh;
  while (parent && parent !== root) {
    if (parent.name) path.unshift(parent.name);
    parent = parent.parent;
  }
  const group = path.length ? path.join('/') : 'сцена';
  const geometryType = mesh.geometry?.type?.replace('Geometry', '') ?? 'Mesh';
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const materialName = (material as THREE.Material).name || material.type.replace('Material', '');
  const geometryName = mesh.name ? `(${mesh.name})` : '';
  const tag = `${group}/${geometryType}#${index}${geometryName}[${materialName}]`;

  const positionCount = mesh.geometry?.index
    ? mesh.geometry.index.count
    : mesh.geometry?.attributes.position?.count ?? 0;

  const flatFaceGeometry = /^(Box|Plane)/.test(geometryType);
  const worldQuaternion = mesh.getWorldQuaternion(new THREE.Quaternion());
  const euler = new THREE.Euler().setFromQuaternion(worldQuaternion, 'YXZ');
  const isRightAngle = (angle: number): boolean => {
    const step = Math.PI / 2;
    return Math.abs(angle - Math.round(angle / step) * step) < 0.002;
  };
  const axisAligned = isRightAngle(euler.x) && isRightAngle(euler.y) && isRightAngle(euler.z);

  return {
    label: tag,
    mesh,
    box,
    solid: !(material as THREE.MeshStandardMaterial).transparent,
    base: size.y < 0.6 && size.x * size.z > 6,
    flatFaced: flatFaceGeometry && axisAligned,
    triangles: Math.round(positionCount / 3),
  };
}

/** Разбирает сцену на проверяемые узлы с читаемыми подписями.
 *  Имена мешей в сцене почти не заданы, поэтому подпись = «ближайшая именованная
 *  группа + тип геометрии + порядковый номер». */
export function collectAuditNodes(root: THREE.Object3D): AuditNode[] {
  const nodes: AuditNode[] = [];
  const counters = new Map<string, number>();
  root.updateMatrixWorld(true);

  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    // Склеенные батчи — не «предметы»: их содержимое приходит снимками (extraNodes).
    if (mesh.userData.merged === true) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;

    const path: string[] = [];
    let parent: THREE.Object3D | null = object;
    while (parent && parent !== root) {
      if (parent.name) path.unshift(parent.name);
      parent = parent.parent;
    }
    const group = path.length ? path.join('/') : 'сцена';
    const index = (counters.get(group) ?? 0) + 1;
    counters.set(group, index);

    const geometryType = mesh.geometry?.type?.replace('Geometry', '') ?? 'Mesh';
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const flat = size.y < 0.6;   // плиты, настил, цоколь: подложки, а не предметы
    const wide = size.x * size.z > 6;

    const flatFaceGeometry = /^(Box|Plane)/.test(geometryType);
    const worldQuaternion = mesh.getWorldQuaternion(new THREE.Quaternion());
    const euler = new THREE.Euler().setFromQuaternion(worldQuaternion, 'YXZ');
    const isRightAngle = (angle: number): boolean => {
      const step = Math.PI / 2;
      return Math.abs(angle - Math.round(angle / step) * step) < 0.002;
    };
    const axisAligned = isRightAngle(euler.x) && isRightAngle(euler.y) && isRightAngle(euler.z);
    const flatFaced = flatFaceGeometry && axisAligned;

    const positionCount = mesh.geometry?.index
      ? mesh.geometry.index.count
      : mesh.geometry?.attributes.position?.count ?? 0;
    const instanced = mesh as THREE.InstancedMesh;
    const solid = !(material as THREE.MeshStandardMaterial).transparent;
    const materialName = (material as THREE.Material).name || material.type.replace('Material', '');
    const tag = `${group}/${geometryType}#${index}${mesh.name ? `(${mesh.name})` : ''}[${materialName}]`;

    // InstancedMesh разворачивается на отдельные экземпляры: общая оболочка инстансов
    // («забор целиком») давала бы ложные наложения со всей сценой.
    if (instanced.isInstancedMesh) {
      const matrix = new THREE.Matrix4();
      const instanceBox = new THREE.Box3();
      const baseBox = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position as THREE.BufferAttribute);
      for (let i = 0; i < instanced.count; i += 1) {
        instanced.getMatrixAt(i, matrix);
        instanceBox.copy(baseBox).applyMatrix4(matrix.premultiply(mesh.matrixWorld));
        const size = instanceBox.getSize(new THREE.Vector3());
        nodes.push({
          label: `${tag}#экз${i + 1}`,
          mesh,
          box: instanceBox.clone(),
          solid,
          base: size.y < 0.6 && size.x * size.z > 6,
          flatFaced: false, // у экземпляров свои повороты — грани AABB не настоящие
          triangles: Math.round(positionCount / 3),
        });
      }
      return;
    }

    nodes.push({
      label: tag,
      mesh,
      box,
      solid,
      base: flat && wide,
      flatFaced,
      triangles: Math.round(positionCount / 3),
    });
  });

  return nodes;
}

/** Длина общей проекции двух отрезков. */
function overlapLength(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

/** Плоскость грани и её проекция — для поиска мерцающих граней. */
function facePlane(box: THREE.Box3, axis: Axis, side: 'min' | 'max'): number {
  return side === 'min' ? box.min[axis] : box.max[axis];
}

function sameFacingArea(a: THREE.Box3, b: THREE.Box3, axis: Axis): number {
  const others = AXES.filter((value) => value !== axis);
  const l1 = overlapLength(a.min[others[0]], a.max[others[0]], b.min[others[0]], b.max[others[0]]);
  const l2 = overlapLength(a.min[others[1]], a.max[others[1]], b.min[others[1]], b.max[others[1]]);
  return l1 > 0 && l2 > 0 ? l1 * l2 : 0;
}

function boxOverlap(a: THREE.Box3, b: THREE.Box3): { depth: THREE.Vector3; volume: number } {
  const depth = new THREE.Vector3(
    Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
    Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y),
    Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z),
  );
  const volume =
    depth.x > 0 && depth.y > 0 && depth.z > 0 ? depth.x * depth.y * depth.z : 0;
  return { depth, volume };
}

function exceptionFor(finding: AuditFinding, exceptions: readonly AuditException[]): string | undefined {
  const haystack = finding.objects.join(' ');
  for (const entry of exceptions) {
    if (entry.kind !== finding.kind) continue;
    if (entry.match.test(haystack)) return entry.reason;
  }
  return undefined;
}

/** Главный вход: полный аудит сцены. Ничего не меняет, только считает и возвращает отчёт. */
export function auditScene(options: AuditOptions): AuditReport {
  const { root, collisions, groundHeightAt, bounds } = options;
  const exceptions = options.exceptions ?? AUDIT_EXCEPTIONS;
  // Снимки мешей, которые склеены в батчи ради бюджета §4.4: аудит проверяет
  // исходные предметы, а не слитые блоки.
  const nodes = [...collectAuditNodes(root), ...(options.extraNodes ?? [])];
  const solidNodes = nodes.filter((node) => node.solid);
  const raw: AuditFinding[] = [];
  const tolerance = AUDIT_TOLERANCE;
  let pairs = 0;

  const push = (finding: AuditFinding): void => {
    const reason = exceptionFor(finding, exceptions);
    raw.push(reason ? { ...finding, exception: reason } : finding);
  };

  const centerOf = (box: THREE.Box3): [number, number, number] => {
    const center = box.getCenter(new THREE.Vector3());
    return [Number(center.x.toFixed(2)), Number(center.y.toFixed(2)), Number(center.z.toFixed(2))];
  };
  /** Подпись «кто это»: тип, материал, центр и габарит — по ней предмет находится в коде. */
  const describe = (node: AuditNode): string => {
    const size = node.box.getSize(new THREE.Vector3());
    const center = node.box.getCenter(new THREE.Vector3());
    return `${node.label}@(${center.x.toFixed(1)},${center.y.toFixed(1)},${center.z.toFixed(1)}) ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`;
  };

  // ——— 1–2. Мерцание и наложение: попарно по твёрдым предметам ———
  for (let i = 0; i < solidNodes.length; i += 1) {
    const a = solidNodes[i];
    for (let j = i + 1; j < solidNodes.length; j += 1) {
      const b = solidNodes[j];
      // Быстрый отсев: если оболочки далеко друг от друга, пару не считаем.
      if (!a.box.intersectsBox(b.box) && a.box.distanceToPoint(b.box.getCenter(new THREE.Vector3())) > 0.05) continue;
      pairs += 1;

      // Мерцание ищем только между боксами без поворота: у сфер, цилиндров и
      // повёрнутых предметов плоскости AABB не совпадают с реальными гранями.
      const zFightPair = a.flatFaced && b.flatFaced;

      // Мерцание: только видимые одноимённые грани. Нижние грани по Y (Ymin) смотрят
      // вниз и прикрыты опорой — они не мерцают, поэтому в отчёт не идут.
      for (const axis of zFightPair ? AXES : []) {
        for (const side of (axis === 'y' ? ['max'] : ['min', 'max']) as Array<'min' | 'max'>) {
          const distance = Math.abs(facePlane(a.box, axis, side) - facePlane(b.box, axis, side));
          if (distance > tolerance.zFightDistance) continue;
          const area = sameFacingArea(a.box, b.box, axis);
          if (area < tolerance.zFightArea) continue;
          push({
            kind: 'z-fight',
            objects: [describe(a), describe(b)],
            detail: `грани по ${axis.toUpperCase()}${side === 'min' ? 'min' : 'max'} в ${(distance * 1000).toFixed(1)} мм, общая площадь ${area.toFixed(3)} м²`,
            metric: distance,
            position: centerOf(a.box),
          });
        }
      }

      if (a.base || b.base) continue;
      if (isPanel(a) && isPanel(b)) continue;

      // Наложение: предметы взаимно проникают заметным объёмом.
      const { depth, volume } = boxOverlap(a.box, b.box);
      if (volume < tolerance.overlapVolume) continue;
      if (Math.min(depth.x, depth.y, depth.z) < tolerance.overlapDepth) continue;

      // Конструктивный стык, а не наложение: столярка и корпусная мебель собраны
      // из деталей, которые входят друг в друга. Признаки стыка:
      //   • общий объём мал по сравнению с крупной деталью (локальный шов), или
      //   • деталь утоплена в соседнюю меньше чем на четверть своего объёма.
      // Два предмета, реально стоящих «один в другом», не проходят ни по одному.
      const sizeA = a.box.getSize(new THREE.Vector3());
      const sizeB = b.box.getSize(new THREE.Vector3());
      const volumeA = sizeA.x * sizeA.y * sizeA.z;
      const volumeB = sizeB.x * sizeB.y * sizeB.z;
      const smallest = Math.min(volumeA, volumeB);
      const largest = Math.max(volumeA, volumeB);
      const insertion = smallest > 0 ? volume / smallest : 1;
      const seamShare = largest > 0 ? volume / largest : 1;
      if (insertion <= 0.25 || seamShare <= 0.15) continue;
      push({
        kind: 'overlap',
        objects: [describe(a), describe(b)],
        detail: `проникновение ${depth.x.toFixed(2)}×${depth.y.toFixed(2)}×${depth.z.toFixed(2)} м, объём ${volume.toFixed(4)} м³`,
        metric: volume,
        position: centerOf(a.box),
      });
    }
  }

  // ——— 3–4. Опора: висит в воздухе или утоплен в пол ———
  const down = new THREE.Vector3(0, -1, 0);
  const castDown = new THREE.Raycaster(new THREE.Vector3(), down, 0, 40);

  /** Уровень настоящей опоры под предметом: луч из-под днища вниз до первой чужой
   *  поверхности. Так «стол под вазой» и «настил под лежаком» считаются опорой. */
  const supportBelow = (node: AuditNode): number | null => {
    const center = node.box.getCenter(new THREE.Vector3());
    castDown.set(new THREE.Vector3(center.x, node.box.min.y + 0.02, center.z), down);
    const hits = castDown.intersectObject(root, true).filter((hit) => hit.object !== node.mesh);
    return hits.length > 0 ? hits[0].point.y : null;
  };

  /** Днище внутри чужого объёма: предмет посажен в фундамент/грунт — так и задумано. */
  const bottomBuried = (node: AuditNode): boolean => {
    const box = node.box;
    const point = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + 0.02, (box.min.z + box.max.z) / 2);
    return nodes.some((other) => other !== node && other.box.containsPoint(point));
  };

  for (const node of nodes) {
    if (node.base) continue;
    const box = node.box;
    const center = box.getCenter(new THREE.Vector3());
    const support = supportBelow(node);

    // «Утоплен в пол»: низ ниже уровня пола, а вокруг не фундамент, а пустота.
    const analyticFloor = groundHeightAt(center.x, center.z);
    const sunkenBy = analyticFloor - box.min.y;
    if (sunkenBy > tolerance.supportSink && !bottomBuried(node)) {
      push({
        kind: 'sunken',
        objects: [node.label],
        detail: `низ на ${sunkenBy.toFixed(3)} м ниже пола, вокруг пусто`,
        metric: sunkenBy,
        position: centerOf(box),
      });
      continue;
    }

    const floorY = support ?? analyticFloor;
    const gap = box.min.y - floorY;
    if (gap <= tolerance.supportGap) continue;

    // Низко над полом и без опоры — висит. Высоко над полом — это крепление (карниз, кольцо).
    if (box.min.y > tolerance.hangingHeight) continue;

    push({
      kind: 'floating',
      objects: [node.label],
      detail: `висит на ${gap.toFixed(3)} м выше опоры, под днищем пусто`,
      metric: gap,
      position: centerOf(box),
    });
  }

  // ——— 5. Коллизия без предмета ———
  for (const collider of collisions.list()) {
    const touched = solidNodes.some((node) => {
      if (collider.kind === 'box') {
        const point = new THREE.Vector3(
          (collider.minX + collider.maxX) / 2,
          collider.top - 0.5,
          (collider.minZ + collider.maxZ) / 2,
        );
        return node.box.containsPoint(point) || (
          node.box.max.x > collider.minX - 0.15 &&
          node.box.min.x < collider.maxX + 0.15 &&
          node.box.max.z > collider.minZ - 0.15 &&
          node.box.min.z < collider.maxZ + 0.15
        );
      }
      const nearest = new THREE.Vector3(
        collider.x,
        collider.top - 0.5,
        collider.z,
      );
      return node.box.distanceToPoint(nearest) < 0.3;
    });
    if (touched) continue;
    push({
      kind: 'collider-orphan',
      objects: [collider.kind === 'box' ? 'коллайдер-коробка' : 'коллайдер-цилиндр'],
      detail:
        collider.kind === 'box'
          ? `прямоугольник ${(collider.maxX - collider.minX).toFixed(2)}×${(collider.maxZ - collider.minZ).toFixed(2)} м, верх ${collider.top.toFixed(2)} м — предмета нет`
          : `цилиндр r=${collider.radius.toFixed(2)} м в (${collider.x.toFixed(2)}, ${collider.z.toFixed(2)}), верх ${collider.top.toFixed(2)} м — предмета нет`,
      metric: collider.kind === 'box' ? (collider.maxX - collider.minX) * (collider.maxZ - collider.minZ) : Math.PI * collider.radius ** 2,
      position: collider.kind === 'box'
        ? [(collider.minX + collider.maxX) / 2, collider.top, (collider.minZ + collider.maxZ) / 2]
        : [collider.x, collider.top, collider.z],
    });
  }

  // ——— 6. Предмет в рост героя, сквозь который можно пройти ———
  const playerHeight = 1.72; // высота героя (см. DECISIONS D-71)
  for (const node of solidNodes) {
    if (node.base) continue;
    const size = node.box.getSize(new THREE.Vector3());
    const tall = node.box.min.y < playerHeight - 0.1 && node.box.max.y > tolerance.blockerHeight;
    if (!tall) continue;
    // Мебель и мелкие предметы перекрываются коллизиями по факту; проверяем только
    // габаритные объекты (шире 0.6 м), для которых забытая коллизия заметна сразу.
    if (size.x < 0.6 && size.z < 0.6) continue;
    const center = node.box.getCenter(new THREE.Vector3());
    // За кромкой плато игрок не ходит: скалы, камни у воды и дальний берег не в счёт.
    const outsideWalk = (center.x * center.x) / (bounds.radiusX ** 2) + (center.z * center.z) / (bounds.radiusZ ** 2) > 0.97;
    if (outsideWalk) continue;
    const blocked = collisions.isBlocked(center.x, center.z, 0.1, node.box.min.y + 0.9);
    if (blocked) continue;
    push({
      kind: 'blocker-missing',
      objects: [node.label],
      detail: `габарит ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} м в рост героя, коллизии нет`,
      metric: size.x * size.z,
      position: centerOf(node.box),
    });
  }

  // ——— 7. Дубликаты ———
  for (let i = 0; i < solidNodes.length; i += 1) {
    const a = solidNodes[i];
    for (let j = i + 1; j < solidNodes.length; j += 1) {
      const b = solidNodes[j];
      const sameCenter = a.box.getCenter(new THREE.Vector3()).distanceTo(b.box.getCenter(new THREE.Vector3())) < 0.002;
      if (!sameCenter) continue;
      const sizeA = a.box.getSize(new THREE.Vector3());
      const sizeB = b.box.getSize(new THREE.Vector3());
      if (sizeA.distanceTo(sizeB) > 0.002) continue;
      push({
        kind: 'duplicate',
        objects: [describe(a), describe(b)],
        detail: 'два предмета совпадают по центру и габаритам',
        metric: 0,
        position: centerOf(a.box),
      });
    }
  }

  // ——— 8. За пределами сцены ———
  for (const node of nodes) {
    if (node.base) continue;
    const center = node.box.getCenter(new THREE.Vector3());
    const nx = center.x / (bounds.radiusX + 1.5);
    const nz = center.z / (bounds.radiusZ + 1.5);
    if (nx * nx + nz * nz <= 1) continue;
    push({
      kind: 'outside',
      objects: [node.label],
      detail: `центр (${center.x.toFixed(1)}, ${center.z.toFixed(1)}) за кромкой плато`,
      metric: Math.hypot(center.x, center.z),
      position: centerOf(node.box),
    });
  }

  const findings = raw.filter((finding) => !finding.exception);
  const exceptionsHit = raw.filter((finding) => finding.exception);
  const byKind = Object.fromEntries(
    (Object.keys(AUDIT_KIND_LABEL) as AuditKind[]).map((kind) => [
      kind,
      findings.filter((finding) => finding.kind === kind).length,
    ]),
  ) as Record<AuditKind, number>;

  return {
    meshes: nodes.length,
    colliders: collisions.count,
    pairs,
    byKind,
    findings: sortFindings(findings),
    exceptions: sortFindings(exceptionsHit),
    passed: findings.length === 0,
  };
}

/** Сортировка: сначала грубые нарушения — их чинят первыми. */
function sortFindings(findings: AuditFinding[]): AuditFinding[] {
  const weight: Record<AuditKind, number> = {
    'z-fight': 8,
    overlap: 7,
    'collider-orphan': 5,
    'blocker-missing': 5,
    floating: 4,
    sunken: 3,
    duplicate: 2,
    outside: 1,
  };
  return [...findings].sort((a, b) => weight[b.kind] - weight[a.kind] || b.metric - a.metric);
}
