import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clamp, damp } from '../../core/MathUtils';
import { SELLER_SPOT } from '../../game/TicketOffice';
import { cloneGltfForNpc, RiggedHero } from '../character/RiggedHero';

/** Кассир стадиона (задача 18).
 *
 *  Модель — та же привезённая GLB, что у героя (клонируется через `SkeletonUtils`,
 *  текстуры общие). Клип Idle уже даёт живое дыхание, поверх него код добавляет то,
 *  чего в клипе нет:
 *   - голова и корпус поворачиваются к покупателю (и провожают его, когда отходит);
 *   - жест «привет» (рука вверх) и «вот ваш билет» (рука вперёд);
 *   - лёгкий кивок, когда кассир говорит.
 *  Форменный жилет и бейдж — отдельные меши, чтобы кассира было видно издалека
 *  и он не был копией героя. */

/** Дальше этого кассир не провожает покупателя взглядом, м. */
const LOOK_RANGE = 7;
const LOOK_YAW_LIMIT = 1.0;
const LOOK_PITCH_LIMIT = 0.22;
/** Скорость поворота головы, 1/с. */
const LOOK_SMOOTHING = 4.2;

type Gesture = 'none' | 'wave' | 'hand';

const UP = new THREE.Vector3(0, 1, 0);

export class TicketSeller {
  readonly group = new THREE.Group();
  readonly hero: RiggedHero;

  private readonly head: THREE.Bone | undefined;
  private readonly spine: THREE.Bone | undefined;

  private lookYaw = 0;
  private lookPitch = 0;
  /** Вес жеста 0…1: плавно входит и выходит, рука не «телепортируется». */
  private gestureWeight = 0;
  /** Какой жест играем: держится, пока вес не погаснет, иначе рука дёрнется. */
  private gestureKind: Gesture = 'none';
  private gestureTime = 0;
  private gestureDuration = 0;
  /** Кивок на время разговора. */
  private talking = 0;
  private clock = 0;

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpAxis = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly quatA = new THREE.Quaternion();
  private readonly quatB = new THREE.Quaternion();
  private readonly disposables: Array<{ dispose: () => void }> = [];

  constructor(gltf: GLTF, groundY: number) {
    this.hero = new RiggedHero(cloneGltfForNpc(gltf));
    this.group.name = 'ticket-seller';
    this.group.add(this.hero.group);
    this.group.position.set(SELLER_SPOT.x, groundY, SELLER_SPOT.z);
    this.group.rotation.y = SELLER_SPOT.yaw;

    this.head = this.hero.rig.bones.get('head');
    this.spine = this.hero.rig.bones.get('spine_02');
    // Стоит на месте: клип Idle тянет всё тело, локомоции нет.
    this.hero.setLocomotion(0, 0);
    this.buildUniform();
  }

  /** Форма: светоотражающий жилет и бейдж. Меши не скиннинговые, но кассир
   *  стоит на месте и почти не гнётся — жилет сидит как настоящий. */
  private buildUniform(): void {
    const vest = new THREE.MeshStandardMaterial({
      color: 0xf6c644,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    vest.name = 'seller-vest';
    const stripe = new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.45, metalness: 0.15 });
    stripe.name = 'seller-stripe';
    const badge = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.5, metalness: 0.3 });
    badge.name = 'seller-badge';
    this.disposables.push(vest, stripe, badge);

    const shell = new THREE.CylinderGeometry(0.215, 0.245, 0.44, 20, 1, true);
    shell.scale(1, 1, 0.68);
    const body = new THREE.Mesh(shell, vest);
    body.name = 'seller-vest-body';
    body.position.set(0, 1.2, 0.02);
    body.castShadow = true;
    this.group.add(body);
    this.disposables.push(shell);

    for (const y of [1.1, 1.33]) {
      const ring = new THREE.CylinderGeometry(0.252, 0.252, 0.045, 20, 1, true);
      ring.scale(1, 1, 0.68);
      const band = new THREE.Mesh(ring, stripe);
      band.name = `seller-vest-stripe-${y}`;
      band.position.set(0, y, 0.02);
      this.group.add(band);
      this.disposables.push(ring);
    }

    const plate = new THREE.BoxGeometry(0.12, 0.045, 0.012);
    const tag = new THREE.Mesh(plate, badge);
    tag.name = 'seller-badge-plate';
    tag.position.set(0.09, 1.24, -0.19);
    this.group.add(tag);
    this.disposables.push(plate);
  }

  /** Приветствие: рука вверх на 1,6 с. */
  wave(): void {
    this.startGesture('wave', 1.6);
  }

  /** Отдаёт билет: рука вперёд на 1,2 с. */
  handOver(): void {
    this.startGesture('hand', 1.3);
  }

  get worldPosition(): THREE.Vector3 {
    return this.group.position;
  }

  /** Кассир говорит: кивает, пока идёт реплика. */
  setTalking(active: boolean): void {
    this.talking = active ? 1 : this.talking;
  }

  update(dt: number, playerPosition: THREE.Vector3 | null): void {
    this.clock += dt;
    this.hero.update(dt);
    this.talking = damp(this.talking, 0, 1.2, dt);

    this.updateLook(dt, playerPosition);
    this.updateGesture(dt);
    this.applyFace();
    this.applyArm();
  }

  /** Голова и корпус поворачиваются к покупателю; без покупателя — медленно оглядывается. */
  private updateLook(dt: number, playerPosition: THREE.Vector3 | null): void {
    const head = this.head;
    if (!head) return;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(this.tmpA);

    let targetYaw = 0;
    let targetPitch = 0;
    if (playerPosition) {
      const distance = this.tmpB.copy(playerPosition).sub(this.tmpA).length();
      this.forward.set(0, 0, -1).applyQuaternion(this.group.getWorldQuaternion(this.quatA)).normalize();
      this.tmpB.copy(playerPosition).setY(this.tmpA.y).sub(this.tmpA);
      if (distance < LOOK_RANGE && this.tmpB.lengthSq() > 1e-6) {
        this.tmpB.normalize();
        // Угол со знаком: cross(вперёд, на игрока) по оси Y.
        const cross = this.tmpDir.copy(this.forward).cross(this.tmpB).y;
        const dot = clamp(this.forward.dot(this.tmpB), -1, 1);
        targetYaw = clamp(Math.atan2(cross, dot), -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT);
        const height = playerPosition.y + 1.55 - this.tmpA.y;
        targetPitch = clamp(-Math.atan2(height, Math.max(0.4, distance)), -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT);
      } else {
        targetYaw = Math.sin(this.clock * 0.35) * 0.28;
      }
    } else {
      targetYaw = Math.sin(this.clock * 0.35) * 0.28;
    }

    this.lookYaw = damp(this.lookYaw, targetYaw, LOOK_SMOOTHING, dt);
    this.lookPitch = damp(this.lookPitch, targetPitch, LOOK_SMOOTHING, dt);
  }

  private startGesture(kind: Gesture, duration: number): void {
    this.gestureKind = kind;
    this.gestureTime = 0;
    this.gestureDuration = duration;
  }

  private updateGesture(dt: number): void {
    if (this.gestureDuration <= 0) {
      this.gestureWeight = damp(this.gestureWeight, 0, 9, dt);
      return;
    }
    this.gestureTime += dt;
    const t = clamp(this.gestureTime / this.gestureDuration, 0, 1);
    // Вход 0…0.2, удержание, выход 0.8…1.
    const shape = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
    this.gestureWeight = damp(this.gestureWeight, shape, 12, dt);
    if (t >= 1) {
      this.gestureTime = 0;
      this.gestureDuration = 0;
    }
  }

  /** Голова и корпус: после микшера, поэтому поворот ложится поверх клипа. */
  private applyFace(): void {
    if (this.head && Math.abs(this.lookYaw) > 1e-3) this.bend(this.head, UP, this.lookYaw);
    if (this.spine && Math.abs(this.lookYaw) > 1e-3) this.bend(this.spine, UP, this.lookYaw * 0.35);

    const nod = Math.sin(this.clock * 3.1) * 0.045 * this.talking;
    const pitch = this.lookPitch + nod;
    if (this.head && Math.abs(pitch) > 1e-3) {
      // Ось кивка — горизонталь поперёк взгляда.
      this.forward.set(0, 0, -1).applyQuaternion(this.group.getWorldQuaternion(this.quatA)).normalize();
      this.tmpAxis.copy(UP).cross(this.forward).normalize().clone();
      if (this.tmpAxis.lengthSq() > 1e-6) this.bend(this.head, this.tmpAxis, pitch);
    }
  }

  private applyArm(): void {
    if (this.gestureWeight < 0.004 || this.gestureKind === 'none') return;
    const weight = this.gestureWeight;
    const wave = this.gestureKind === 'wave';
    // Правая рука: плечо поднимаем, предплечье доводим — «рука вверх» либо «вперёд».
    this.raiseArm('r', (wave ? 1.45 : 1.0) * weight);
    const second = wave ? Math.sin(this.clock * 7.5) * 0.42 * weight : -0.35 * weight;
    this.raiseArm('r', second, true);
  }

  /** Поднять/согнуть руку в плоскости «кость × вперёд». */
  private raiseArm(side: 'l' | 'r', angle: number, forearm = false): void {
    const bone = this.hero.rig.bones.get(`${forearm ? 'forearm' : 'upperarm'}_${side}`);
    const child = this.hero.rig.bones.get(`${forearm ? 'hand' : 'forearm'}_${side}`);
    if (!bone) return;
    const axis = this.limbAxis(bone, child);
    if (axis) this.bend(bone, axis, angle);
  }

  private limbAxis(bone: THREE.Bone | undefined, child: THREE.Bone | undefined): THREE.Vector3 | null {
    if (!bone || !child) return null;
    bone.updateWorldMatrix(true, false);
    child.updateWorldMatrix(true, false);
    bone.getWorldPosition(this.tmpA);
    child.getWorldPosition(this.tmpB);
    this.tmpDir.copy(this.tmpB).sub(this.tmpA);
    if (this.tmpDir.lengthSq() < 1e-8) return null;
    this.tmpDir.normalize();
    this.forward.set(0, 0, -1).applyQuaternion(this.group.getWorldQuaternion(this.quatA)).normalize();
    this.tmpAxis.copy(this.tmpDir).cross(this.forward);
    if (this.tmpAxis.lengthSq() < 1e-6) return null;
    return this.tmpAxis.normalize().clone();
  }

  private bend(bone: THREE.Bone, worldAxis: THREE.Vector3, angle: number): void {
    if (Math.abs(angle) < 1e-4) return;
    bone.updateWorldMatrix(true, false);
    const world = bone.getWorldQuaternion(this.quatA);
    const local = this.tmpDir.copy(worldAxis).applyQuaternion(world.invert()).normalize();
    bone.quaternion.multiply(this.quatB.setFromAxisAngle(local, angle));
  }

  dispose(): void {
    this.hero.dispose();
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
  }
}
