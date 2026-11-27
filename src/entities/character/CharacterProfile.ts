import * as THREE from 'three';

/** Профиль главного героя: пропорции и позы костей в покое.
 *  Всё в метрах, рост 1.80 м (ТЗ GOAL.md §7, задача 2). Персонаж смотрит в −Z,
 *  левая сторона персонажа — +X. */

export const CHARACTER = {
  height: 1.8,
  /** Голова ≈ 1/7.5 роста. */
  headTopY: 1.8,
  chinY: 1.556,
  headCenterY: 1.672,
  neckBaseY: 1.5,
  shoulderY: 1.44,
  shoulderHalfWidth: 0.225,
  waistY: 1.08,
  hipY: 0.96,
  kneeY: 0.5,
  ankleY: 0.095,
  /** Полуразмеры стопы (вдоль −Z — носок). */
  footLength: 0.275,
  footWidth: 0.108,
  footHeight: 0.075,
} as const;

export interface BoneRest {
  readonly name: string;
  readonly parent: string | null;
  /** Позиция в системе координат родителя (как в three.js). */
  readonly position: readonly [number, number, number];
}

/** Кости считаются из абсолютных позиций — так удобнее держать пропорции. */
const ABSOLUTE_BONES: ReadonlyArray<{ name: string; parent: string | null; pos: readonly [number, number, number] }> = [
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'hips', parent: 'root', pos: [0, 0.96, 0] },
  { name: 'spine_01', parent: 'hips', pos: [0, 1.06, 0] },
  { name: 'spine_02', parent: 'spine_01', pos: [0, 1.18, 0] },
  { name: 'spine_03', parent: 'spine_02', pos: [0, 1.32, 0] },
  { name: 'neck', parent: 'spine_03', pos: [0, 1.5, 0] },
  { name: 'head', parent: 'neck', pos: [0, 1.58, 0] },

  // ——— руки (l = левая, +X) ———
  { name: 'clavicle_l', parent: 'spine_03', pos: [0.05, 1.43, 0] },
  { name: 'upperarm_l', parent: 'clavicle_l', pos: [0.185, 1.42, 0] },
  { name: 'forearm_l', parent: 'upperarm_l', pos: [0.235, 1.14, 0] },
  { name: 'hand_l', parent: 'forearm_l', pos: [0.275, 0.87, 0] },

  // пальцы левой руки: большой — 3 фаланги, остальные — по 2
  { name: 'thumb_l_01', parent: 'hand_l', pos: [0.263, 0.833, -0.045] },
  { name: 'thumb_l_02', parent: 'thumb_l_01', pos: [0.259, 0.803, -0.07] },
  { name: 'thumb_l_03', parent: 'thumb_l_02', pos: [0.256, 0.779, -0.089] },

  { name: 'index_l_01', parent: 'hand_l', pos: [0.278, 0.788, -0.033] },
  { name: 'index_l_02', parent: 'index_l_01', pos: [0.278, 0.738, -0.038] },
  { name: 'middle_l_01', parent: 'hand_l', pos: [0.279, 0.788, -0.009] },
  { name: 'middle_l_02', parent: 'middle_l_01', pos: [0.279, 0.734, -0.011] },
  { name: 'ring_l_01', parent: 'hand_l', pos: [0.278, 0.786, 0.014] },
  { name: 'ring_l_02', parent: 'ring_l_01', pos: [0.278, 0.734, 0.017] },
  { name: 'pinky_l_01', parent: 'hand_l', pos: [0.276, 0.782, 0.036] },
  { name: 'pinky_l_02', parent: 'pinky_l_01', pos: [0.276, 0.738, 0.039] },

  // ——— ноги ———
  { name: 'thigh_l', parent: 'hips', pos: [0.095, 0.94, 0] },
  { name: 'shin_l', parent: 'thigh_l', pos: [0.1, 0.5, 0] },
  { name: 'foot_l', parent: 'shin_l', pos: [0.104, 0.1, 0] },
  { name: 'toe_l', parent: 'foot_l', pos: [0.104, 0.045, -0.11] },
];

/** Имена левой стороны: `hand_l`, но у пальцев — `thumb_l_01`. */
const isLeftName = (name: string): boolean => name.endsWith('_l') || name.includes('_l_');
const toRightName = (name: string): string => name.replace('_l_', '_r_').replace(/_l$/, '_r');

/** Правая сторона — зеркальное отражение левой по X. */
function mirrored(): typeof ABSOLUTE_BONES[number][] {
  const result: (typeof ABSOLUTE_BONES)[number][] = [];
  for (const bone of ABSOLUTE_BONES) {
    if (!isLeftName(bone.name)) continue;
    result.push({
      name: toRightName(bone.name),
      parent: bone.parent ? toRightName(bone.parent) : null,
      pos: [-bone.pos[0], bone.pos[1], bone.pos[2]],
    });
  }
  return result;
}

const ALL_ABSOLUTE = [...ABSOLUTE_BONES, ...mirrored()];

/** Плоский список костей с позициями относительно родителя. */
export const BONES: readonly BoneRest[] = ALL_ABSOLUTE.map((bone) => {
  const parent = bone.parent ? ALL_ABSOLUTE.find((candidate) => candidate.name === bone.parent) : null;
  const offset: [number, number, number] = parent
    ? [bone.pos[0] - parent.pos[0], bone.pos[1] - parent.pos[1], bone.pos[2] - parent.pos[2]]
    : [bone.pos[0], bone.pos[1], bone.pos[2]];
  return { name: bone.name, parent: bone.parent, position: offset };
});

export const BONE_COUNT = BONES.length;

/** Абсолютная позиция кости в позе покоя (нужна геометрии и весам скиннинга). */
export const BONE_WORLD_POSITIONS: ReadonlyMap<string, THREE.Vector3> = new Map(
  ALL_ABSOLUTE.map((bone) => [bone.name, new THREE.Vector3(bone.pos[0], bone.pos[1], bone.pos[2])]),
);

export const SKIN = {
  torso: { rings: 14, radial: 24 },
  limb: { radial: 16 },
  head: { widthSegments: 28, heightSegments: 20 },
} as const;
