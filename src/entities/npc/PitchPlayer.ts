import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clamp, damp } from '../../core/MathUtils';
import type { SimPlayer } from '../../game/match/MatchSim';
import { cloneGltfForNpc, RiggedHero } from '../character/RiggedHero';

/**
 * Игрок на поле (задача 22).
 *
 * Модель — та же GLB, что у героя (`SkeletonUtils`), но перекрашенная в цвета
 * команды. Клипы Idle/Walk/Run уже дают бег и развороты; поверх кода:
 *   • фаза шага зависит от скорости — ноги не «плывут» при разгоне;
 *   • удар: замах корпусом и мах ведущей ногой (бедро/голень);
 *   • гол: руки вверх и подскок, у проигравших — голова вниз;
 *   • лёгкий наклон корпуса на разгоне.
 * Всё через кости и веса, поэтому не ломает клипы — они продолжают играть.
 */

const MODEL_TO_BONE = {
  left: 'upperarm_l',
  right: 'upperarm_r',
} as const;

interface BoneRest {
  readonly bone: THREE.Bone;
  readonly quaternion: THREE.Quaternion;
}

export class PitchPlayer {
  readonly group = new THREE.Group();
  readonly hero: RiggedHero;

  private readonly arms: { left: BoneRest; right: BoneRest } | null;
  private readonly thighR: BoneRest | null;
  private readonly shinR: BoneRest | null;
  private readonly spine: BoneRest | null;
  private readonly head: BoneRest | null;

  private phase = 0;
  private celebration = 0;
  private kick = 0;
  private sadness = 0;
  private lean = 0;
  private hop = 0;
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();

  constructor(gltf: GLTF, palette: readonly string[], groundY: number) {
    this.hero = new RiggedHero(cloneGltfForNpc(gltf));
    this.hero.recolourOutfit(palette, 512);
    this.group.name = 'pitch-player';
    this.group.add(this.hero.group);
    this.group.position.y = groundY;

    const grab = (name: string): BoneRest | null => {
      const bone = this.hero.rig.bones.get(name);
      return bone ? { bone, quaternion: bone.quaternion.clone() } : null;
    };
    const left = grab(MODEL_TO_BONE.left);
    const right = grab(MODEL_TO_BONE.right);
    this.arms = left && right ? { left, right } : null;
    this.thighR = grab('thigh_r');
    this.shinR = grab('shin_r');
    this.spine = grab('spine_02');
    this.head = grab('head');
  }

  get triangles(): number {
    return this.hero.triangleCount;
  }

  /** Подогнать модель под состояние симуляции. */
  sync(player: SimPlayer, dt: number): void {
    this.group.position.x = player.x;
    this.group.position.z = player.z;
    this.group.rotation.y = player.yaw;
    this.hero.setLocomotion(player.speed01, this.phase);
    // Фаза шага: бегущий перебирает ногами чаще, на месте — почти стоит
    this.phase += dt * (1.6 + player.speed01 * 9.2);
    this.hero.update(dt);

    const wantCelebrate = player.action === 'celebrate' ? 1 : 0;
    const wantSad = player.action === 'sad' ? 1 : 0;
    const wantKick = player.action === 'kick' ? 1 : 0;
    this.celebration = damp(this.celebration, wantCelebrate, 6, dt);
    this.sadness = damp(this.sadness, wantSad, 5, dt);
    this.kick = damp(this.kick, wantKick, 18, dt);

    // Подскок на праздновании — короткими толчками, как прыгают от радости
    const beat = Math.sin(this.hero.group.userData.celebrateTime ?? 0);
    void beat;
    this.hop = this.celebration > 0.35 ? Math.abs(Math.sin(this.celebration * 9)) * 0.16 : 0;
    this.group.position.y = this.hero.group.position.y + this.hop;

    // Разгон: корпус вперёд, чтобы бег читался силуэтом
    this.lean = damp(this.lean, clamp(player.speed01 * 0.9, 0, 1), 8, dt);
    this.applyPose();
  }

  private applyPose(): void {
    const spinLeft = this.arms ? this.tmpQuat.setFromEuler(this.tmpEuler.set(0, 0, 2.35 * this.celebration)) : null;
    if (this.arms && spinLeft) {
      this.arms.left.bone.quaternion.copy(this.arms.left.quaternion).multiply(spinLeft);
      const spinRight = this.tmpQuat.setFromEuler(this.tmpEuler.set(0, 0, -2.35 * this.celebration));
      this.arms.right.bone.quaternion.copy(this.arms.right.quaternion).multiply(spinRight);
    }
    if (this.thighR) {
      // Замах ногой на удар: бедро вперёд и вверх
      const swing = this.tmpQuat.setFromEuler(this.tmpEuler.set(-1.15 * this.kick, 0, 0));
      this.thighR.bone.quaternion.copy(this.thighR.quaternion).multiply(swing);
    }
    if (this.shinR) {
      const fold = this.tmpQuat.setFromEuler(this.tmpEuler.set(0.95 * this.kick, 0, 0));
      this.shinR.bone.quaternion.copy(this.shinR.quaternion).multiply(fold);
    }
    if (this.spine) {
      // Наклон вперёд на бегу и вниз головой при проигрыше
      const tilt = this.tmpQuat.setFromEuler(this.tmpEuler.set(-0.16 * this.lean - 0.26 * this.sadness, 0, 0));
      this.spine.bone.quaternion.copy(this.spine.quaternion).multiply(tilt);
    }
    if (this.head) {
      const nod = this.tmpQuat.setFromEuler(this.tmpEuler.set(0.22 * this.sadness, 0, 0));
      this.head.bone.quaternion.copy(this.head.quaternion).multiply(nod);
    }
  }

  dispose(): void {
    this.hero.dispose();
    this.group.removeFromParent();
  }
}
