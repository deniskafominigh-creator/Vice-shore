import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { auditNodeFor, type AuditNode } from '../SceneAudit';

/** Склейка статичной геометрии (задача 10, бюджет GOAL.md §4.4).
 *
 *  Вилла, интерьер, забор и двор собраны из сотен отдельных мешей: у каждого свой
 *  draw call, а на кадр приходится два прохода (тени + цвет). Всё, что не двигается
 *  и не подсвечивается скриптом, можно склеить по материалам: один материал —
 *  один меш — один draw call. Визуально ничего не меняется.
 *
 *  Не склеивается то, на что ссылается код: кольцо и сетка (миссия мяча), стена
 *  покраски и валик (миссия покраски), лампы, растительность (качание ветра)
 *  и инстансы (штакетник забора).
 *
 *  Склейка «всё или ничего»: если геометрии несовместимы, исходные меши остаются
 *  на месте — лучше лишний draw call, чем пропавший предмет. */

export interface MergeOptions {
  /** Имена мешей, которые нельзя склеивать (на них ссылается игровой код). */
  readonly skip?: readonly string[];
  /** Корень для подписи предметов в снимке аудита (обычно группа острова). */
  readonly labelRoot?: THREE.Object3D;
}

interface Bucket {
  readonly material: THREE.Material;
  readonly meshes: THREE.Mesh[];
  readonly geometries: THREE.BufferGeometry[];
  castShadow: boolean;
  receiveShadow: boolean;
}

/** Число треугольников в геометрии. */
function triangleCount(geometry: THREE.BufferGeometry): number {
  const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
  return Math.floor(count / 3);
}

/** Склеивает меши группы по материалам. Возвращает статистику и снимки предметов. */
export function mergeStaticMeshes(
  group: THREE.Object3D,
  options: MergeOptions = {},
): { before: number; after: number; removed: THREE.Mesh[]; nodes: AuditNode[]; mergedTriangles: number } {
  const skip = new Set(options.skip ?? []);
  group.updateMatrixWorld(true);
  const inverseGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();

  const buckets = new Map<string, Bucket>();

  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) return;
    if (!mesh.visible || mesh.userData.noMerge === true) return;
    if (Array.isArray(mesh.material)) return; // гранёные материалы (стены с обшивкой) не склеиваем
    const material = mesh.material as THREE.Material;
    if (skip.has(mesh.name) || skip.has(material.name)) return;
    if (!mesh.geometry.attributes.position) return;

    const attributes = Object.keys(mesh.geometry.attributes).sort().join(',');
    const indexed = mesh.geometry.index ? 'indexed' : 'plain';
    const key = `${material.uuid}|${attributes}|${indexed}`;

    const bucket = buckets.get(key) ?? {
      material,
      meshes: [],
      geometries: [],
      castShadow: false,
      receiveShadow: false,
    };
    bucket.meshes.push(mesh);
    bucket.castShadow = bucket.castShadow || mesh.castShadow;
    bucket.receiveShadow = bucket.receiveShadow || mesh.receiveShadow;
    buckets.set(key, bucket);
  });

  let before = 0;
  let after = 0;
  let mergedTriangles = 0;
  const removed: THREE.Mesh[] = [];

  for (const bucket of buckets.values()) {
    before += bucket.meshes.length;
    if (bucket.meshes.length < 2) {
      after += bucket.meshes.length;
      continue;
    }

    const expected = bucket.meshes.reduce((sum, mesh) => sum + triangleCount(mesh.geometry), 0);
    const geometries = bucket.meshes.map((mesh) => {
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseGroup, mesh.matrixWorld));
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
      }
      geometry.clearGroups();
      return geometry;
    });

    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();

    // Проверка целостности: склейка не должна терять треугольники.
    if (!merged || triangleCount(merged) !== expected) {
      merged?.dispose();
      after += bucket.meshes.length;
      continue;
    }

    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = `merged-${bucket.material.name || bucket.material.type}`;
    mesh.userData.merged = true;
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    group.add(mesh);
    removed.push(...bucket.meshes);
    mergedTriangles += triangleCount(merged);
    after += 1;
  }

  // Снимок предметов считается до удаления из графа: после removeFromParent()
  // мировые матрицы теряют трансформацию родителей, а аудиту нужны мировые габариты.
  const labelRoot = options.labelRoot ?? group;
  const nodes: AuditNode[] = [];
  removed.forEach((mesh, index) => {
    const node = auditNodeFor(mesh, labelRoot, index + 1);
    if (node) nodes.push(node);
  });

  for (const mesh of removed) mesh.removeFromParent();

  return { before, after, removed, nodes, mergedTriangles };
}
