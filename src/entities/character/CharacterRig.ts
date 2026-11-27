import * as THREE from 'three';
import { BONES } from './CharacterProfile';

/** Скелет героя: 45 костей (≤ 60 по ТЗ), иерархия из CharacterProfile. */
export interface Rig {
  readonly root: THREE.Bone;
  readonly bones: ReadonlyMap<string, THREE.Bone>;
  readonly skeleton: THREE.Skeleton;
  readonly boneIndex: (name: string) => number;
  dispose(): void;
}

export function createRig(): Rig {
  const bones = new Map<string, THREE.Bone>();
  const ordered: THREE.Bone[] = [];

  for (const rest of BONES) {
    const bone = new THREE.Bone();
    bone.name = rest.name;
    bone.position.set(rest.position[0], rest.position[1], rest.position[2]);
    if (rest.parent) {
      const parent = bones.get(rest.parent);
      if (!parent) throw new Error(`[Rig] родитель "${rest.parent}" для "${rest.name}" не найден (порядок костей)`);
      parent.add(bone);
    }
    bones.set(rest.name, bone);
    ordered.push(bone);
  }

  const root = bones.get('root');
  if (!root) throw new Error('[Rig] нет корневой кости');
  root.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(ordered);
  const indexByName = new Map(ordered.map((bone, index) => [bone.name, index]));

  return {
    root,
    bones,
    skeleton,
    boneIndex(name: string): number {
      const index = indexByName.get(name);
      if (index === undefined) throw new Error(`[Rig] неизвестная кость "${name}"`);
      return index;
    },
    dispose(): void {
      skeleton.dispose();
    },
  };
}
