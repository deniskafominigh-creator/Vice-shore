import type * as THREE from 'three';
import type { Rig } from './CharacterRig';
import type { CharacterPose } from './Character';

/** Общий контракт главного героя (модель заказчика): игра не знает, процедурная модель
 *  перед ней или привезённая GLB с анимациями. Миссии обращаются к костям через
 *  `rig.bones` (`hand_r`/`hand_l`), поэтому обе реализации обязаны дать этот доступ. */
export interface HeroCharacter {
  readonly group: THREE.Group;
  readonly rig: Rig;
  readonly skeletonHelper: THREE.SkeletonHelper;
  readonly headBone: THREE.Bone | null;
  readonly boneCount: number;
  readonly triangleCount: number;
  readonly currentPose: CharacterPose;
  setLocomotion(speed01: number, phase: number): void;
  setPainting(active: boolean, height01?: number): void;
  setBall(mode: 'none' | 'hold' | 'throw', phase?: number): void;
  /** Прыжок (задача 16): фазa полёта 0…1 (0 — отрыв, 1 — касание) и признак «в воздухе».
   *  Клипа Jump в привезённой модели нет, поэтому поза строится кодом поверх микшера. */
  setJump(phase01: number, airborne: boolean): void;
  setPose(pose: CharacterPose): void;
  setDebug(visible: boolean, wireframe?: boolean): void;
  update(dt: number): void;
  dispose(): void;
}
