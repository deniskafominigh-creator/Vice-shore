import * as THREE from 'three';

/**
 * Бюджет теней (сборка v20).
 *
 *  Теневой проход стоит почти столько же, сколько цветной: солнце рисует в карту
 *  теней всё, у чего `castShadow = true`. Замер показал **247 000 треугольников**
 *  в проходе тени против 336 000 в цветном — то есть кадр почти удваивался.
 *
 *  Здесь снимается тень с того, чего в тени не видно:
 *   • **сиденья трибун и их ноги** — их тень падает на ступени под ними, где её
 *     всё равно съедает затенение, а это 66 000 треугольников;
 *   • **интерьер и ремонт** — солнце туда не достаёт, тени внутри считает не оно;
 *   • **земля** — она получатель тени, а не источник (её собственная тень — ноль);
 *   • **низкие кусты** — тень от приземистого куста почти не читается на газоне.
 *
 *  Остаются: дома посёлка и вилла, кроны деревьев и пальмы, чаша стадиона, забор
 *  и обочина — то есть всё, что даёт читаемый силуэт на земле.
 */

/** Меши, которые тени не отбрасывают (по имени). */
const NO_CAST = [/^stadium-seat/, /^shrubs$/, /^stadium-scoreboard/, /^stadium-ticket/, /^stadium-gate/];

/** Группы, внутри которых ничего не отбрасывает тень. */
const NO_CAST_GROUPS = new Set(['interior', 'renovation', 'ground']);

export interface ShadowBudgetReport {
  /** Сколько мешей потеряло тень. */
  readonly disabled: number;
  /** Сколько треугольников ушло из прохода тени. */
  readonly triangles: number;
}

function trianglesOf(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry?.attributes.position) return 0;
  const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
  return Math.floor(count / 3) * instances;
}

/** Снимает тень с того, чего не видно в тени. Возвращает, сколько сэкономили. */
export function applyShadowBudget(root: THREE.Object3D): ShadowBudgetReport {
  let disabled = 0;
  let triangles = 0;

  const visit = (object: THREE.Object3D, suppressed: boolean): void => {
    const mesh = object as THREE.Mesh;
    const inGroup = suppressed || NO_CAST_GROUPS.has(object.name);
    const byName = mesh.isMesh && NO_CAST.some((pattern) => pattern.test(mesh.name));
    if (mesh.isMesh && mesh.castShadow && (inGroup || byName)) {
      mesh.castShadow = false;
      disabled += 1;
      triangles += trianglesOf(mesh);
    }
    for (const child of object.children) visit(child, inGroup);
  };

  visit(root, false);
  return { disabled, triangles };
}
