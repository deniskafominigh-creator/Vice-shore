import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clamp, damp } from '../../core/MathUtils';
import modelUrl from '../../assets/characters/character_rigged.glb?url';
import type { CharacterPose } from './Character';
import type { Rig } from './CharacterRig';
import type { HeroCharacter } from './HeroCharacter';

/** Модель героя, привезённая внешне (модель заказчика): раскрашенная GLB с ригом на 53 кости
 *  и шестью клипами. Здесь она «встаёт на место» процедурного героя:
 *   - те же имена костей (`hips`, `hand_r`, `index_r_01`…), поэтому миссии,
 *     которые ищут кисти, работают без правок;
 *   - клипы ведут тело: Idle / Walk / Run / Paint / Hold / Throw;
 *   - пальцы доводятся кодом поверх клипов (хват валика и мяча). */

const TARGET_HEIGHT = 1.8; // рост героя из CharacterProfile
/** В glTF персонаж смотрит в +Z, three.js ждёт «вперёд» = −Z. */
const MODEL_YAW = Math.PI;

const CLIP = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  paint: 'Paint',
  hold: 'Hold',
  throw: 'Throw',
} as const;

type ClipKey = keyof typeof CLIP;

/** Изгиб пальцев по суставам (радианы вокруг локальной X). */
const FINGER_CURL: Readonly<Record<1 | 2 | 3, number>> = { 1: 0.95, 2: 1.25, 3: 0.8 };
const FINGER_RE = /_(l|r)_0([123])$/;

export class RiggedHero implements HeroCharacter {
  readonly group = new THREE.Group();
  readonly rig: Rig;
  readonly skeletonHelper: THREE.SkeletonHelper;
  readonly headBone: THREE.Bone | null;
  readonly boneCount: number;
  readonly triangleCount: number;

  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipKey, THREE.AnimationAction>();
  private readonly weights = new Map<ClipKey, number>();
  private readonly fingers: Array<{ bone: THREE.Bone; side: number; joint: 1 | 2 | 3 }> = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private skinned: THREE.SkinnedMesh | null = null;
  private readonly curlAxis = new THREE.Vector3(1, 0, 0);
  private readonly curlQuat = new THREE.Quaternion();
  private readonly tmpBox = new THREE.Box3();

  private pose: CharacterPose = 'idle';
  private speed01 = 0;
  private phase = 0;
  private painting = false;
  private paintHeight = 0.5;
  private ballMode: 'none' | 'hold' | 'throw' = 'none';
  private ballPhase = 0;
  private grip = 0;

  constructor(gltf: GLTF) {
    this.group.name = 'character';
    const scene = gltf.scene;
    scene.rotation.y = MODEL_YAW;

    // ——— вписываем модель в мир игры: рост 1.8 м, ступни на земле, центр по XZ
    scene.updateMatrixWorld(true);
    this.tmpBox.setFromObject(scene);
    const height = Math.max(0.001, this.tmpBox.max.y - this.tmpBox.min.y);
    const scale = TARGET_HEIGHT / height;
    scene.scale.multiplyScalar(scale);
    scene.updateMatrixWorld(true);
    this.tmpBox.setFromObject(scene);
    scene.position.y -= this.tmpBox.min.y;
    scene.position.x -= (this.tmpBox.min.x + this.tmpBox.max.x) / 2;
    scene.position.z -= (this.tmpBox.min.z + this.tmpBox.max.z) / 2;

    // ——— материалы и геометрия: одна копия каждой, чтобы корректно освободить
    let triangles = 0;
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      this.geometries.push(object.geometry);
      const index = object.geometry.getIndex();
      triangles += (index ? index.count : (object.geometry.attributes.position?.count ?? 0)) / 3;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (this.materials.includes(material)) continue;
        this.materials.push(material);
        for (const value of Object.values(material as unknown as Record<string, unknown>)) {
          if (value instanceof THREE.Texture && !this.textures.includes(value)) this.textures.push(value);
        }
      }
      object.frustumCulled = false; // скиннинг: габариты в bind-позе, не режем по ним
      object.castShadow = true;
      object.receiveShadow = true;
      if (object instanceof THREE.SkinnedMesh) this.skinned = object;
    });
    this.triangleCount = Math.round(triangles);

    this.group.add(scene);

    // ——— скелет: имена совпадают с процедурным ригом
    const bones = new Map<string, THREE.Bone>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Bone)) return;
      bones.set(object.name, object);
      const match = FINGER_RE.exec(object.name);
      if (match) {
        const side = match[1] === 'r' ? 1 : -1;
        this.fingers.push({ bone: object, side, joint: Number(match[2]) as 1 | 2 | 3 });
      }
    });
    this.boneCount = bones.size;

    const root = bones.get('root') ?? bones.get('hips') ?? scene as unknown as THREE.Bone;
    const skeleton = this.skinned?.skeleton ?? new THREE.Skeleton([]);
    const indexByName = new Map<string, number>();
    skeleton.bones.forEach((bone, index) => indexByName.set(bone.name, index));
    this.headBone = bones.get('head') ?? null;

    this.rig = {
      root: root as THREE.Bone,
      bones,
      skeleton,
      boneIndex(name: string): number {
        const index = indexByName.get(name);
        if (index === undefined) throw new Error(`[RiggedHero] неизвестная кость "${name}"`);
        return index;
      },
      dispose(): void {
        skeleton.dispose();
      },
    };

    this.skeletonHelper = new THREE.SkeletonHelper(this.rig.root);
    this.skeletonHelper.visible = false;
    this.skeletonHelper.frustumCulled = false;
    const helperMaterial = this.skeletonHelper.material as THREE.LineBasicMaterial;
    helperMaterial.depthTest = false;
    helperMaterial.transparent = true;
    helperMaterial.opacity = 0.85;
    this.skeletonHelper.renderOrder = 999;

    // ——— клипы
    this.mixer = new THREE.AnimationMixer(scene);
    for (const key of Object.keys(CLIP) as ClipKey[]) {
      const name = CLIP[key];
      const clip = THREE.AnimationClip.findByName(gltf.animations, name) ?? null;
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      if (key === 'throw') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else if (key === 'paint') {
        // Позу покраски ведёт высота валика (см. update), клип не «крутится» сам.
        action.paused = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.actions.set(key, action);
      this.weights.set(key, 0);
    }
    // Стартовая поза — Idle
    this.weights.set('idle', 1);
    this.actions.get('idle')?.setEffectiveWeight(1);
  }

  setLocomotion(speed01: number, phase: number): void {
    this.speed01 = clamp(speed01, 0, 1);
    this.phase = phase;
  }

  setPainting(active: boolean, height01 = 0.5): void {
    this.painting = active;
    this.paintHeight = clamp(height01, 0, 1);
  }

  setBall(mode: 'none' | 'hold' | 'throw', phase = 0): void {
    if (mode !== this.ballMode && mode === 'throw') {
      const action = this.actions.get('throw');
      if (action) {
        action.reset();
        action.paused = false;
        action.time = 0;
      }
    }
    this.ballMode = mode;
    this.ballPhase = clamp(phase, 0, 1);
  }

  setPose(pose: CharacterPose): void {
    // У привезённой модели нет отдельных поз осмотра — крутим её в инспекторе целиком.
    this.pose = pose;
  }

  get currentPose(): CharacterPose {
    return this.pose;
  }

  setDebug(visible: boolean, wireframe = false): void {
    this.skeletonHelper.visible = visible;
    for (const material of this.materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if ('wireframe' in standard) standard.wireframe = wireframe;
    }
  }

  update(dt: number): void {
    // ——— какие клипы должны звучать сейчас
    const targets = new Map<ClipKey, number>();
    for (const key of this.actions.keys()) targets.set(key, 0);

    if (this.painting) {
      targets.set('paint', 1);
    } else if (this.ballMode === 'throw') {
      targets.set('throw', 1);
    } else if (this.ballMode === 'hold' && this.speed01 < 0.12) {
      targets.set('hold', 1);
    } else {
      // стоя → идёт → бежит: два перехода, веса в сумме 1
      const walk = clamp(this.speed01 / 0.55, 0, 1);
      const run = clamp((this.speed01 - 0.55) / 0.35, 0, 1);
      const moving = walk + run * 0; // walk уже включает 0…1
      const wIdle = clamp(1 - moving, 0, 1);
      const wWalk = clamp(moving, 0, 1) * (1 - run);
      const wRun = clamp(moving, 0, 1) * run;
      targets.set('idle', wIdle);
      targets.set('walk', wWalk);
      targets.set('run', wRun);
    }

    for (const [key, action] of this.actions) {
      const target = targets.get(key) ?? 0;
      const current = damp(this.weights.get(key) ?? 0, target, 10, dt);
      this.weights.set(key, current);
      action.setEffectiveWeight(current);
    }

    // Шаг «под скорость»: клип Walk рассчитан на ~1.2 м/с, Run — на быстрый бег.
    const walkAction = this.actions.get('walk');
    if (walkAction) walkAction.timeScale = 0.75 + this.speed01 * 0.9;
    const runAction = this.actions.get('run');
    if (runAction) runAction.timeScale = 0.85 + this.speed01 * 0.45;

    // Валик ведёт руку: поза покраски идёт по высоте валика на стене.
    const paintAction = this.actions.get('paint');
    if (paintAction) {
      const clip = paintAction.getClip();
      paintAction.time = clamp(this.paintHeight, 0, 1) * Math.max(0.01, clip.duration - 0.02);
    }

    // Замах/бросок мяча: клип листается по фазе, которую задаёт BallMission.
    const throwAction = this.actions.get('throw');
    if (throwAction && this.ballMode === 'throw') {
      const clip = throwAction.getClip();
      throwAction.time = this.ballPhase * Math.max(0.01, clip.duration * 0.92);
    }

    this.mixer.update(dt);
    this.applyGrip(dt);

    // Мяч в руках — обе кисти, валик — правая.
    void this.phase;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const action of this.actions.values()) action.stop();
    this.actions.clear();
    this.skeletonHelper.geometry.dispose();
    (this.skeletonHelper.material as THREE.Material).dispose();
    this.skeletonHelper.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.rig.dispose();
    this.group.removeFromParent();
  }

  // ——— внутреннее ————————————————————————————————————————————

  /** Пальцы поверх клипов: клипы анимируют все 53 кости, поэтому хват доводим
   *  пост-умножением кватерниона уже после `mixer.update`. */
  private applyGrip(dt: number): void {
    const target = this.painting || this.ballMode === 'hold' || this.ballMode === 'throw' ? 1 : 0;
    this.grip = damp(this.grip, target, 7, dt);
    if (this.grip <= 0.002) return;

    for (const { bone, side, joint } of this.fingers) {
      // Правая кисть держит всегда, левая — только мяч
      const hand = bone.name.includes('_r_') ? 1 : this.ballMode === 'hold' || this.ballMode === 'throw' ? 0.85 : 0;
      if (hand === 0) continue;
      const angle = FINGER_CURL[joint] * this.grip * hand * side * -1;
      this.curlQuat.setFromAxisAngle(this.curlAxis, angle);
      bone.quaternion.multiply(this.curlQuat);
    }
  }
}

/** Загрузка привезённой модели. null — если файла нет или он битый:
 *  игра в этом случае остаётся на процедурном герое. */
export async function loadRiggedHero(): Promise<RiggedHero | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(modelUrl);
    if (gltf.animations.length === 0) {
      console.warn('[RiggedHero] в модели нет анимаций — остаёмся на процедурном герое');
      return null;
    }
    return new RiggedHero(gltf);
  } catch (error) {
    console.warn('[RiggedHero] модель не загрузилась, герой процедурный:', error);
    return null;
  }
}
