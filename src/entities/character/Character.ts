import * as THREE from 'three';
import { damp } from '../../core/MathUtils';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createCharacterTextures, type CharacterTextures, type RegionId, type UvRegion } from './CharacterAtlas';
import { CHARACTER } from './CharacterProfile';
import { createRig, type Rig } from './CharacterRig';
import {
  buildShapedSphere,
  buildTube,
  mergeParts,
  remapUv,
  smoothstep,
  withSkin,
  type BoneWeight,
  type KitContext,
  type RingSpec,
} from './GeometryKit';

export type CharacterPose = 'idle' | 'arms_up' | 'squat' | 'head_turn';

/** Сегменты сетки головы (детализация лица). */
export const HEAD_SEGMENTS = { width: 28, height: 20 } as const;

export const CHARACTER_POSES: readonly CharacterPose[] = ['idle', 'arms_up', 'squat', 'head_turn'];

export const POSE_LABELS: Readonly<Record<CharacterPose, string>> = {
  idle: 'Покой',
  arms_up: 'Руки вверх',
  squat: 'Присед',
  head_turn: 'Поворот головы',
};

interface PoseTarget {
  readonly rotations: Readonly<Record<string, readonly [number, number, number]>>;
  readonly offsets?: Readonly<Record<string, readonly [number, number, number]>>;
}

const POSES: Readonly<Record<CharacterPose, PoseTarget>> = {
  idle: { rotations: {} },
  arms_up: {
    rotations: {
      upperarm_l: [0, 0, 2.5],
      upperarm_r: [0, 0, -2.5],
      forearm_l: [0.15, 0, 0.3],
      forearm_r: [0.15, 0, -0.3],
      head: [-0.12, 0, 0],
      spine_03: [-0.05, 0, 0],
    },
  },
  squat: {
    rotations: {
      thigh_l: [1.15, 0, 0.06],
      thigh_r: [1.15, 0, -0.06],
      shin_l: [-1.75, 0, 0],
      shin_r: [-1.75, 0, 0],
      foot_l: [0.62, 0, 0],
      foot_r: [0.62, 0, 0],
      spine_01: [0.2, 0, 0],
      spine_02: [0.12, 0, 0],
      upperarm_l: [-0.55, 0, 0.12],
      upperarm_r: [-0.55, 0, -0.12],
      forearm_l: [-0.7, 0, 0],
      forearm_r: [-0.7, 0, 0],
      head: [-0.18, 0, 0],
    },
    offsets: { hips: [0, -0.3, 0] },
  },
  head_turn: {
    rotations: {
      neck: [0, 0.36, 0],
      head: [0.06, 0.72, 0],
      spine_03: [0, 0.08, 0],
    },
  },
};

/** Главный герой: процедурная модель со скелетом и скиннингом.
 *  Собран из непрерывных «труб» с плавными весами на суставах — без разрывов на сгибах
 *  (GOAL.md §7, задача 2). Материалов два: тело (атлас) и глаза (глянец). */
export class Character {
  readonly group = new THREE.Group();
  readonly rig: Rig;
  readonly height = CHARACTER.height;

  private readonly textures: CharacterTextures;
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly skinnedMesh: THREE.SkinnedMesh;
  private readonly headDetails: THREE.Group;
  /** Отладочный скелет: добавляется в сцену снаружи (у SkeletonHelper своя матрица). */
  readonly skeletonHelper: THREE.SkeletonHelper;
  private readonly targets = new Map<string, THREE.Euler>();
  private readonly offsets = new Map<string, THREE.Vector3>();
  private readonly restPositions = new Map<string, THREE.Vector3>();
  private readonly geometries: THREE.BufferGeometry[] = [];

  private pose: CharacterPose = 'idle';
  private elapsed = 0;
  private debug = false;
  /** Параметры походки: 0…1 (доля бега) и фаза шага в радианах. */
  private locoSpeed = 0;
  private locoPhase = 0;
  /** Плавное включение/выключение походки, чтобы не было щелчка позы. */
  private locoBlend = 0;
  private hipsBob = 0;
  private hipsSway = 0;
  /** Режим покраски: правая рука с валиком, корпус тянется к стене. */
  private paintActive = false;
  private paintHeight = 0.5;
  /** Мяч в руках и бросок (задача 8). */
  private ballMode: 'none' | 'hold' | 'throw' = 'none';
  private ballPhase = 0;
  /** Прыжок (задача 16): фаза полёта и вес позы. */
  private jumpPhase = 0;
  private jumpAirborne = false;
  private jumpWeight = 0;
  private wasAirborne = false;
  private landing = 0;
  private jumpTuck = 0;
  private jumpLand = 0;

  constructor() {
    this.group.name = 'character';
    this.textures = createCharacterTextures();
    this.rig = createRig();
    const ctx: KitContext = { boneIndex: this.rig.boneIndex };
    const regions = this.textures.regions;

    const parts: THREE.BufferGeometry[] = [
      this.buildTorso(ctx, regions.skin),
      this.buildNeck(ctx, regions.skin),
      this.buildHead(ctx, regions.skin),
      this.buildArm('l', ctx, regions.skin),
      this.buildArm('r', ctx, regions.skin),
      this.buildHand('l', ctx, regions.skin),
      this.buildHand('r', ctx, regions.skin),
      this.buildLeg('l', ctx, regions.skin),
      this.buildLeg('r', ctx, regions.skin),
      this.buildShirt(ctx, regions.shirt),
      this.buildSleeve('l', ctx, regions.shirt),
      this.buildSleeve('r', ctx, regions.shirt),
      this.buildJeans(ctx, regions.denim),
      this.buildShoe('l', ctx, regions),
      this.buildShoe('r', ctx, regions),
    ];

    const merged = mergeParts(parts);
    for (const part of parts) part.dispose();
    merged.computeBoundingSphere();
    this.geometries.push(merged);

    this.bodyMaterial = new THREE.MeshStandardMaterial({
      map: this.textures.map,
      normalMap: this.textures.normalMap,
      roughnessMap: this.textures.roughnessMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 1,
      metalness: 0.02,
    });

    this.skinnedMesh = new THREE.SkinnedMesh(merged, this.bodyMaterial);
    this.skinnedMesh.name = 'character-body';
    this.skinnedMesh.castShadow = true;
    this.skinnedMesh.receiveShadow = true;
    this.skinnedMesh.frustumCulled = false;
    this.skinnedMesh.add(this.rig.root);
    this.skinnedMesh.bind(this.rig.skeleton);
    this.group.add(this.skinnedMesh);

    this.eyeMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.12,
      metalness: 0,
      envMapIntensity: 1.4,
    });
    // buildHeadDetails сам вешает группу на кость головы: иначе лицо уедет к ногам.
    this.headDetails = this.buildHeadDetails(regions);

    // Отладочный вид: скелет поверх модели (F3).
    // Внутрь group его класть нельзя: SkeletonHelper берёт матрицу корневой кости,
    // и трансформ группы применился бы дважды.
    this.skeletonHelper = new THREE.SkeletonHelper(this.rig.root);
    this.skeletonHelper.visible = false;
    const helperMaterial = this.skeletonHelper.material as THREE.LineBasicMaterial;
    helperMaterial.depthTest = false;
    helperMaterial.linewidth = 2;
    this.skeletonHelper.renderOrder = 999;
    this.skeletonHelper.frustumCulled = false;

    for (const [name, bone] of this.rig.bones) this.restPositions.set(name, bone.position.clone());
    this.applyPose('idle', true);
  }

  get headBone(): THREE.Bone | null {
    return this.rig.bones.get('head') ?? null;
  }

  get boneCount(): number {
    return this.rig.skeleton.bones.length;
  }

  get triangleCount(): number {
    const geometry = this.skinnedMesh.geometry;
    const index = geometry.getIndex();
    if (index) return index.count / 3;
    return (geometry.attributes.position?.count ?? 0) / 3;
  }

  /** Походка (задача 6): скорость 0…1 и фаза шага.
   *  Фазу задаёт контроллер по пройденному пути — поэтому ноги не «скользят». */
  setLocomotion(speed01: number, phase: number): void {
    this.locoSpeed = Math.max(0, Math.min(1, speed01));
    this.locoPhase = phase;
  }

  /** Поза покраски (задача 7): height01 — где валик по высоте стены (0 — низ). */
  setPainting(active: boolean, height01 = 0.5): void {
    this.paintActive = active;
    this.paintHeight = Math.max(0, Math.min(1, height01));
  }

  /** Поза с мячом (задача 8): держит у груди или бросает (phase 0 — замах, 1 — проводка). */
  setBall(mode: 'none' | 'hold' | 'throw', phase = 0): void {
    this.ballMode = mode;
    this.ballPhase = Math.max(0, Math.min(1, phase));
  }

  /** Прыжок: 0 — отрыв, 0,5 — вершина, 1 — касание. Поза накладывается поверх
   *  походки и покраски, с плавным входом и коротким приседом на приземлении. */
  setJump(phase01: number, airborne: boolean): void {
    this.jumpPhase = Math.max(0, Math.min(1, phase01));
    this.jumpAirborne = airborne;
    if (this.wasAirborne && !airborne) this.landing = 0.24;
    else if (!this.wasAirborne && airborne) this.landing = 0;
    this.wasAirborne = airborne;
  }

  setPose(pose: CharacterPose): void {
    this.applyPose(pose, false);
  }

  get currentPose(): CharacterPose {
    return this.pose;
  }

  /** Отладочный режим осмотра: скелет и сетка. */
  setDebug(visible: boolean, wireframe = false): void {
    this.debug = visible;
    this.skeletonHelper.visible = visible;
    this.bodyMaterial.wireframe = wireframe;
  }

  /** Дыхание в покое + походка (задача 6). Всё через сглаживание кватернионов,
   *  поэтому переход «стоит → идёт → бежит» не рвётся. */
  update(dt: number): void {
    const smoothing = this.debug ? 6 : 12;
    // Прыжок: вес позы и огибающие полёта/приседания
    if (this.landing > 0) this.landing = Math.max(0, this.landing - dt);
    this.jumpWeight = damp(this.jumpWeight, this.jumpAirborne || this.landing > 0 ? 1 : 0, 16, dt);
    this.jumpTuck = this.jumpAirborne ? Math.sin(Math.PI * this.jumpPhase) : 0;
    this.jumpLand = Math.min(1, this.landing / 0.24);
    this.elapsed += dt;
    const breath = Math.sin(this.elapsed * 1.35);
    const sway = Math.sin(this.elapsed * 0.5);

    // Походка включается плавно: smoothstep по скорости + инерция
    const targetBlend = Character.softstep(0.04, 0.35, this.locoSpeed);
    this.locoBlend = damp(this.locoBlend, targetBlend, 9, dt);

    for (const [name, bone] of this.rig.bones) {
      const target = this.targets.get(name);
      if (!target) continue;

      const euler = Character.scratchEuler.copy(target);
      if (this.pose === 'idle' || this.pose === 'head_turn') {
        if (name === 'spine_02') euler.x += breath * 0.012;
        if (name === 'spine_03') euler.x += breath * 0.008;
        if (name === 'neck' || name === 'head') euler.y += sway * 0.02;
        if (name === 'upperarm_l' || name === 'upperarm_r') euler.z += sway * 0.012;
      }
      if (this.locoBlend > 0.002) this.applyWalk(euler, name);
      if (this.paintActive) Character.applyPaintPose(euler, name, this.paintHeight);
      if (this.ballMode !== 'none') Character.applyBallPose(euler, name, this.ballMode, this.ballPhase);
      if (this.jumpWeight > 0.004) Character.applyJumpPose(euler, name, this.jumpTuck, this.jumpLand, this.jumpWeight);

      Character.scratchQuat.setFromEuler(euler);
      bone.quaternion.slerp(Character.scratchQuat, 1 - Math.exp(-smoothing * dt));
    }

    // Смещение таза: покачивание по вертикали и в стороны в такт шагам
    const blend = this.locoBlend;
    this.hipsBob = -0.035 * blend * (0.5 + 0.5 * Math.cos(this.locoPhase * 2));
    this.hipsSway = 0.014 * blend * Math.sin(this.locoPhase);

    for (const [name, offset] of this.offsets) {
      const bone = this.rig.bones.get(name);
      const rest = this.restPositions.get(name);
      if (!bone || !rest) continue;
      if (name === 'hips') continue; // таз считается ниже: к позе добавляется шаг
      bone.position.y += (rest.y + offset.y - bone.position.y) * (1 - Math.exp(-smoothing * dt));
    }

    const hips = this.rig.bones.get('hips');
    const hipsRest = this.restPositions.get('hips');
    if (hips && hipsRest) {
      const poseOffset = this.offsets.get('hips');
      const targetY = hipsRest.y + (poseOffset?.y ?? 0) + this.hipsBob;
      const targetX = hipsRest.x + (poseOffset?.x ?? 0) + this.hipsSway;
      const k = 1 - Math.exp(-smoothing * dt);
      hips.position.y += (targetY - hips.position.y) * k;
      hips.position.x += (targetX - hips.position.x) * k;
    }
  }

  /** Поза прыжка в локальных эйлерах рига: бедро вперёд (+X), колено назад (−X),
   *  корпус вперёд, руки вверх. Знаки совпадают с позой «присед» из POSES. */
  private static applyJumpPose(
    euler: THREE.Euler,
    name: string,
    tuck: number,
    land: number,
    weight: number,
  ): void {
    const lift = (0.62 * tuck + 0.42 * land) * weight;
    const knee = -(1.15 * tuck + 0.95 * land) * weight;
    const lean = (0.14 * tuck + 0.2 * land) * weight;
    const arm = -(1.45 * tuck - 0.5 * land) * weight;
    if (name === 'thigh_l' || name === 'thigh_r') euler.x += lift;
    else if (name === 'shin_l' || name === 'shin_r') euler.x += knee;
    else if (name === 'spine_01') euler.x += lean;
    else if (name === 'spine_02') euler.x += lean * 0.5;
    else if (name === 'upperarm_l' || name === 'upperarm_r') euler.x += arm;
  }

  /** Походка: бедро качает ногу, колено подгибается в переносе, корпус скручивается.
   *  Вторая гармоника в размахе убирает «машинную» синусоиду. */
  private applyWalk(euler: THREE.Euler, name: string): void {
    const blend = this.locoBlend;
    const speed = this.locoSpeed;
    const phase = this.locoPhase;
    const amp = blend * (0.28 + 0.62 * speed);
    const swingL = Math.sin(phase) + 0.14 * Math.sin(2 * phase);
    const swingR = Math.sin(phase + Math.PI) + 0.14 * Math.sin(2 * phase + Math.PI * 2);
    const kneeL = -(0.1 + 0.95 * blend) * (0.5 + 0.5 * Math.sin(phase));
    const kneeR = -(0.1 + 0.95 * blend) * (0.5 + 0.5 * Math.sin(phase + Math.PI));

    switch (name) {
      case 'thigh_l':
        euler.x += amp * swingL;
        break;
      case 'thigh_r':
        euler.x += amp * swingR;
        break;
      case 'shin_l':
        euler.x += kneeL;
        break;
      case 'shin_r':
        euler.x += kneeR;
        break;
      case 'foot_l':
        euler.x += -amp * swingL * 0.5 - kneeL * 0.5 + 0.1 * blend;
        break;
      case 'foot_r':
        euler.x += -amp * swingR * 0.5 - kneeR * 0.5 + 0.1 * blend;
        break;
      case 'upperarm_l':
        euler.x += -amp * 1.05 * swingL;
        euler.z += -0.09 * blend;
        break;
      case 'upperarm_r':
        euler.x += -amp * 1.05 * swingR;
        euler.z += 0.09 * blend;
        break;
      case 'forearm_l':
        euler.x += -0.22 * blend - 0.3 * Math.max(0, swingL) - 0.25 * speed * blend;
        break;
      case 'forearm_r':
        euler.x += -0.22 * blend - 0.3 * Math.max(0, swingR) - 0.25 * speed * blend;
        break;
      case 'hips':
        euler.y += 0.1 * blend * Math.sin(phase);
        break;
      case 'spine_01':
        euler.x += 0.07 * blend + 0.12 * speed;
        euler.y += -0.05 * blend * Math.sin(phase);
        break;
      case 'spine_02':
        euler.y += 0.07 * blend * Math.sin(phase);
        break;
      case 'spine_03':
        euler.x += 0.03 * blend;
        break;
      case 'head':
        euler.y += -0.07 * blend * Math.sin(phase);
        euler.x += -0.04 * blend - 0.03 * speed;
        break;
      default:
        break;
    }
  }

  /** Поза с валиком: рука вытянута к стене, вторая придерживает ручку, голова смотрит на рукав. */
  private static applyPaintPose(euler: THREE.Euler, name: string, h: number): void {
    switch (name) {
      case 'upperarm_r':
        euler.set(-0.8 - 0.95 * h, 0, -0.3);
        break;
      case 'forearm_r':
        euler.set(-0.3 - 0.45 * h, 0.18, 0);
        break;
      case 'hand_r':
        euler.set(0.2, 0, 0.1);
        break;
      case 'upperarm_l':
        euler.set(-0.32 - 0.28 * h, 0, 0.24);
        break;
      case 'forearm_l':
        euler.set(-0.5, 0.15, 0.1);
        break;
      case 'spine_01':
        euler.set(0.05, 0.05, 0);
        break;
      case 'spine_02':
        euler.set(0.04, -0.1, 0);
        break;
      case 'neck':
        euler.set(-0.05, 0.16, 0);
        break;
      case 'head':
        euler.set(-0.08 - 0.12 * h, 0.14, 0);
        break;
      default:
        break;
    }
  }

  /** Мяч у груди и бросок: замах назад, затем проводка вперёд с поворотом корпуса. */
  private static applyBallPose(euler: THREE.Euler, name: string, mode: 'hold' | 'throw', phase: number): void {
    if (mode === 'hold') {
      switch (name) {
        case 'upperarm_r':
          euler.set(-0.78, 0.1, -0.2);
          break;
        case 'forearm_r':
          euler.set(-1.3, 0.1, 0);
          break;
        case 'hand_r':
          euler.set(0.16, 0, 0.1);
          break;
        case 'upperarm_l':
          euler.set(-0.86, -0.1, 0.2);
          break;
        case 'forearm_l':
          euler.set(-1.42, -0.1, 0);
          break;
        case 'neck':
          euler.set(-0.06, 0, 0);
          break;
        default:
          break;
      }
      return;
    }

    const t = phase;
    const lerp = (from: number, to: number): number => from + (to - from) * t;
    switch (name) {
      case 'upperarm_r':
        euler.set(lerp(-2.45, -0.5), lerp(-0.2, 0.08), lerp(-0.36, -0.12));
        break;
      case 'forearm_r':
        euler.set(lerp(-1.5, -0.12), lerp(0.1, 0), 0);
        break;
      case 'hand_r':
        euler.set(lerp(-0.25, 0.25), 0, 0.1);
        break;
      case 'upperarm_l':
        euler.set(lerp(-0.5, -1.15), 0, lerp(0.3, 0.18));
        break;
      case 'forearm_l':
        euler.set(lerp(-1.1, -0.7), 0, 0);
        break;
      case 'spine_01':
        euler.set(lerp(-0.06, 0.04), lerp(-0.16, 0.14), 0);
        break;
      case 'spine_02':
        euler.set(lerp(-0.08, 0.02), lerp(-0.22, 0.18), 0);
        break;
      case 'neck':
        euler.set(lerp(-0.14, -0.02), lerp(-0.08, 0.06), 0);
        break;
      case 'head':
        euler.set(lerp(-0.2, -0.04), lerp(-0.06, 0.05), 0);
        break;
      default:
        break;
    }
  }

  private static softstep(edge0: number, edge1: number, value: number): number {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  dispose(): void {
    this.skeletonHelper.geometry.dispose();
    (this.skeletonHelper.material as THREE.Material).dispose();
    this.skeletonHelper.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    this.headDetails.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.bodyMaterial.dispose();
    this.eyeMaterial.dispose();
    this.textures.map.dispose();
    this.textures.normalMap.dispose();
    this.textures.roughnessMap.dispose();
    this.rig.dispose();
  }

  // ——— позы ————————————————————————————————————————————————

  private applyPose(pose: CharacterPose, instant: boolean): void {
    this.pose = pose;
    const target = POSES[pose];
    this.targets.clear();
    this.offsets.clear();

    for (const [name] of this.rig.bones) {
      const rotation = target.rotations[name];
      this.targets.set(name, new THREE.Euler(rotation?.[0] ?? 0, rotation?.[1] ?? 0, rotation?.[2] ?? 0));
    }
    for (const [name, offset] of Object.entries(target.offsets ?? {})) {
      this.offsets.set(name, new THREE.Vector3(offset[0], offset[1], offset[2]));
    }

    if (!instant) return;
    for (const [name, bone] of this.rig.bones) {
      const euler = this.targets.get(name);
      if (euler) bone.quaternion.setFromEuler(euler);
    }
    for (const [name, offset] of this.offsets) {
      const bone = this.rig.bones.get(name);
      const rest = this.restPositions.get(name);
      if (bone && rest) bone.position.set(rest.x + offset.x, rest.y + offset.y, rest.z + offset.z);
    }
  }

  // ——— тело ————————————————————————————————————————————————

  private weightsFor(y: number, anchors: ReadonlyArray<{ bone: string; y: number; radius: number }>): BoneWeight[] {
    const weights: BoneWeight[] = [];
    for (const anchor of anchors) {
      const weight = 1 - Math.min(1, Math.abs(y - anchor.y) / anchor.radius);
      if (weight > 0.001) weights.push({ bone: anchor.bone, weight });
    }
    if (weights.length === 0) return [{ bone: anchors[0]?.bone ?? 'hips', weight: 1 }];
    return weights;
  }

  private buildTorso(ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const anchors = [
      { bone: 'hips', y: 0.96, radius: 0.17 },
      { bone: 'spine_01', y: 1.06, radius: 0.13 },
      { bone: 'spine_02', y: 1.18, radius: 0.13 },
      { bone: 'spine_03', y: 1.32, radius: 0.15 },
      { bone: 'neck', y: 1.5, radius: 0.09 },
    ];
    const profile: ReadonlyArray<readonly [number, number, number]> = [
      [0.9, 0.148, 0.106],
      [0.96, 0.168, 0.117],
      [1.02, 0.16, 0.112],
      [1.08, 0.148, 0.103],
      [1.14, 0.152, 0.106],
      [1.22, 0.172, 0.116],
      [1.3, 0.188, 0.124],
      [1.38, 0.196, 0.12],
      [1.43, 0.197, 0.112],
      [1.47, 0.148, 0.098],
      [1.5, 0.072, 0.066],
    ];
    const yMin = 0.9;
    const yMax = 1.5;
    const rings: RingSpec[] = profile.map(([y, rx, rz]) => ({
      center: new THREE.Vector3(0, y, 0),
      rx,
      rz,
      weights: this.weightsFor(y, anchors),
      t: (y - yMin) / (yMax - yMin),
    }));
    return buildTube(rings, 24, region, ctx, { capStart: true, vRepeat: 2 });
  }

  private buildNeck(ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const rings: RingSpec[] = [
      { y: 1.47, rx: 0.072, rz: 0.066 },
      { y: 1.52, rx: 0.064, rz: 0.06 },
      { y: 1.58, rx: 0.06, rz: 0.057 },
    ].map((spec, index, all) => ({
      center: new THREE.Vector3(0, spec.y, 0),
      rx: spec.rx,
      rz: spec.rz,
      weights:
        index === 0
          ? [{ bone: 'neck', weight: 1 }]
          : index === all.length - 1
            ? [
                { bone: 'neck', weight: 0.45 },
                { bone: 'head', weight: 0.55 },
              ]
            : [
                { bone: 'neck', weight: 0.8 },
                { bone: 'head', weight: 0.2 },
              ],
      t: index / (all.length - 1),
    }));
    return buildTube(rings, 18, region, ctx);
  }

  private buildHead(ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    return buildShapedSphere(
      new THREE.Vector3(0, CHARACTER.headCenterY, 0),
      new THREE.Vector3(0.088, 0.115, 0.098),
      HEAD_SEGMENTS.width,
      HEAD_SEGMENTS.height,
      'head',
      region,
      ctx,
      (vertex, unit) => {
        // Сужаем челюсть, выдвигаем подбородок, чуть сплющиваем затылок.
        const belowCenter = smoothstep(0.15, -0.85, unit.y);
        vertex.x *= 1 - 0.2 * belowCenter;
        vertex.z *= 1 - 0.08 * belowCenter;
        if (vertex.z < 0) vertex.z -= 0.006 * belowCenter;
        const back = Math.max(0, unit.z);
        vertex.z -= back * 0.012;
        // Лёгкая «маска» лица: скулы чуть шире в середине
        const cheeks = smoothstep(0.5, 0.0, Math.abs(unit.y)) * smoothstep(0.2, -0.6, unit.z);
        vertex.x *= 1 + 0.05 * cheeks;
      },
    );
  }

  private buildArm(side: 'l' | 'r', ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const sign = side === 'l' ? 1 : -1;
    const upper = `upperarm_${side}`;
    const fore = `forearm_${side}`;
    const hand = `hand_${side}`;
    // Кольца: плечо → бицепс → локоть → предплечье → запястье
    const profile: ReadonlyArray<{
      y: number;
      x: number;
      rx: number;
      rz: number;
      weights: readonly BoneWeight[];
    }> = [
      { y: 1.455, x: 0.185, rx: 0.056, rz: 0.056, weights: [{ bone: upper, weight: 1 }] },
      { y: 1.41, x: 0.198, rx: 0.062, rz: 0.06, weights: [{ bone: upper, weight: 1 }] },
      { y: 1.33, x: 0.208, rx: 0.056, rz: 0.054, weights: [{ bone: upper, weight: 1 }] },
      { y: 1.25, x: 0.222, rx: 0.05, rz: 0.048, weights: [{ bone: upper, weight: 1 }] },
      { y: 1.19, x: 0.23, rx: 0.047, rz: 0.045, weights: [{ bone: upper, weight: 0.75 }, { bone: fore, weight: 0.25 }] },
      { y: 1.15, x: 0.235, rx: 0.046, rz: 0.044, weights: [{ bone: upper, weight: 0.45 }, { bone: fore, weight: 0.55 }] },
      { y: 1.11, x: 0.241, rx: 0.046, rz: 0.044, weights: [{ bone: upper, weight: 0.15 }, { bone: fore, weight: 0.85 }] },
      { y: 1.03, x: 0.252, rx: 0.048, rz: 0.045, weights: [{ bone: fore, weight: 1 }] },
      { y: 0.96, x: 0.262, rx: 0.042, rz: 0.04, weights: [{ bone: fore, weight: 1 }] },
      { y: 0.9, x: 0.269, rx: 0.034, rz: 0.033, weights: [{ bone: fore, weight: 0.8 }, { bone: hand, weight: 0.2 }] },
      { y: 0.87, x: 0.272, rx: 0.03, rz: 0.028, weights: [{ bone: fore, weight: 0.4 }, { bone: hand, weight: 0.6 }] },
    ];
    const rings: RingSpec[] = profile.map((item, index) => ({
      center: new THREE.Vector3(item.x * sign, item.y, 0),
      rx: item.rx,
      rz: item.rz,
      weights: item.weights,
      t: index / (profile.length - 1),
    }));
    return buildTube(rings, 16, region, ctx, { capStart: true, vRepeat: 1 });
  }

  private buildHand(side: 'l' | 'r', ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const sign = side === 'l' ? 1 : -1;
    const hand = `hand_${side}`;
    const profile: ReadonlyArray<readonly [number, number, number, number]> = [
      // y, x, rx (толщина), rz (ширина ладони)
      [0.875, 0.272, 0.03, 0.028],
      [0.845, 0.274, 0.028, 0.038],
      [0.81, 0.276, 0.025, 0.041],
      [0.788, 0.277, 0.023, 0.04],
    ];
    const rings: RingSpec[] = profile.map(([y, x, rx, rz], index) => ({
      center: new THREE.Vector3(x * sign, y, 0),
      rx,
      rz,
      weights: [{ bone: hand, weight: 1 }],
      t: index / (profile.length - 1),
    }));
    const palm = buildTube(rings, 14, region, ctx, { capEnd: true, vRepeat: 1 });

    const fingers = this.buildFingers(side, ctx, region);
    return mergeParts([palm, fingers]);
  }

  private buildFingers(side: 'l' | 'r', ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const sign = side === 'l' ? 1 : -1;
    // [кость_1, кость_2, кость_3?, x, z, длина_1, длина_2, длина_3, радиус]
    const layout: ReadonlyArray<{
      bones: readonly string[];
      x: number;
      z: number;
      lengths: readonly number[];
      radius: number;
    }> = [
      { bones: [`thumb_${side}_01`, `thumb_${side}_02`, `thumb_${side}_03`], x: 0.263, z: -0.045, lengths: [0.032, 0.026, 0.022], radius: 0.012 },
      { bones: [`index_${side}_01`, `index_${side}_02`], x: 0.278, z: -0.032, lengths: [0.046, 0.036], radius: 0.0115 },
      { bones: [`middle_${side}_01`, `middle_${side}_02`], x: 0.279, z: -0.009, lengths: [0.05, 0.04], radius: 0.012 },
      { bones: [`ring_${side}_01`, `ring_${side}_02`], x: 0.278, z: 0.014, lengths: [0.046, 0.037], radius: 0.0115 },
      { bones: [`pinky_${side}_01`, `pinky_${side}_02`], x: 0.276, z: 0.036, lengths: [0.04, 0.032], radius: 0.0105 },
    ];

    const geometries: THREE.BufferGeometry[] = [];
    for (const finger of layout) {
      const start = new THREE.Vector3(finger.x * sign, 0.79, finger.z);
      // большой палец растёт вперёд-вниз, остальные — вниз
      const direction =
        finger.bones.length === 3 ? new THREE.Vector3(-0.2 * sign, -0.75, -0.62).normalize() : new THREE.Vector3(0, -1, -0.05).normalize();

      const rings: RingSpec[] = [];
      const total = finger.lengths.reduce((sum, value) => sum + value, 0);
      let travelled = 0;
      rings.push({
        center: start.clone(),
        rx: finger.radius,
        rz: finger.radius,
        weights: [{ bone: finger.bones[0] as string, weight: 1 }],
        t: 0,
      });
      finger.lengths.forEach((length, index) => {
        travelled += length;
        const center = start.clone().addScaledVector(direction, travelled);
        const bone = finger.bones[Math.min(index + 1, finger.bones.length - 1)] as string;
        const previous = finger.bones[index] as string;
        rings.push({
          center,
          rx: finger.radius * (1 - 0.25 * (travelled / total)),
          rz: finger.radius * (1 - 0.25 * (travelled / total)),
          weights:
            index === finger.lengths.length - 1
              ? [{ bone: previous, weight: 1 }]
              : [
                  { bone: previous, weight: 0.55 },
                  { bone, weight: 0.45 },
                ],
          t: travelled / total,
        });
      });
      geometries.push(buildTube(rings, 8, region, ctx, { capStart: true, capEnd: true, vRepeat: 1 }));
    }

    return mergeParts(geometries);
  }

  private buildLeg(side: 'l' | 'r', ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const sign = side === 'l' ? 1 : -1;
    const thigh = `thigh_${side}`;
    const shin = `shin_${side}`;
    const foot = `foot_${side}`;
    const profile: ReadonlyArray<{
      y: number;
      x: number;
      rx: number;
      rz: number;
      weights: readonly BoneWeight[];
    }> = [
      { y: 0.95, x: 0.095, rx: 0.098, rz: 0.1, weights: [{ bone: 'hips', weight: 0.35 }, { bone: thigh, weight: 0.65 }] },
      { y: 0.87, x: 0.096, rx: 0.093, rz: 0.095, weights: [{ bone: thigh, weight: 1 }] },
      { y: 0.75, x: 0.098, rx: 0.085, rz: 0.088, weights: [{ bone: thigh, weight: 1 }] },
      { y: 0.62, x: 0.099, rx: 0.075, rz: 0.078, weights: [{ bone: thigh, weight: 1 }] },
      { y: 0.54, x: 0.1, rx: 0.069, rz: 0.072, weights: [{ bone: thigh, weight: 0.7 }, { bone: shin, weight: 0.3 }] },
      { y: 0.5, x: 0.1, rx: 0.067, rz: 0.07, weights: [{ bone: thigh, weight: 0.45 }, { bone: shin, weight: 0.55 }] },
      { y: 0.44, x: 0.101, rx: 0.066, rz: 0.069, weights: [{ bone: thigh, weight: 0.15 }, { bone: shin, weight: 0.85 }] },
      { y: 0.34, x: 0.102, rx: 0.058, rz: 0.061, weights: [{ bone: shin, weight: 1 }] },
      { y: 0.24, x: 0.103, rx: 0.048, rz: 0.05, weights: [{ bone: shin, weight: 1 }] },
      { y: 0.16, x: 0.104, rx: 0.04, rz: 0.042, weights: [{ bone: shin, weight: 1 }] },
      { y: 0.12, x: 0.104, rx: 0.036, rz: 0.038, weights: [{ bone: shin, weight: 0.7 }, { bone: foot, weight: 0.3 }] },
    ];
    const rings: RingSpec[] = profile.map((item, index) => ({
      center: new THREE.Vector3(item.x * sign, item.y, 0),
      rx: item.rx,
      rz: item.rz,
      weights: item.weights,
      t: index / (profile.length - 1),
    }));
    return buildTube(rings, 16, region, ctx, { capStart: true, vRepeat: 2 });
  }

  // ——— одежда ————————————————————————————————————————————

  private buildShirt(ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const anchors = [
      { bone: 'hips', y: 0.98, radius: 0.12 },
      { bone: 'spine_01', y: 1.06, radius: 0.13 },
      { bone: 'spine_02', y: 1.18, radius: 0.13 },
      { bone: 'spine_03', y: 1.32, radius: 0.15 },
      { bone: 'neck', y: 1.5, radius: 0.07 },
    ];
    const profile: ReadonlyArray<readonly [number, number, number]> = [
      [1.03, 0.172, 0.126],
      [1.08, 0.164, 0.119],
      [1.14, 0.168, 0.122],
      [1.22, 0.188, 0.132],
      [1.3, 0.202, 0.138],
      [1.38, 0.206, 0.132],
      [1.43, 0.212, 0.128],
      [1.47, 0.168, 0.108],
      [1.5, 0.086, 0.08],
    ];
    const rings: RingSpec[] = profile.map(([y, rx, rz], index) => ({
      center: new THREE.Vector3(0, y, 0),
      rx,
      rz,
      weights: this.weightsFor(y, anchors),
      t: index / (profile.length - 1),
    }));
    return buildTube(rings, 24, region, ctx, { vRepeat: 1 });
  }

  private buildSleeve(side: 'l' | 'r', ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const sign = side === 'l' ? 1 : -1;
    const upper = `upperarm_${side}`;
    const profile: ReadonlyArray<readonly [number, number, number, number]> = [
      [1.445, 0.188, 0.066, 0.064],
      [1.41, 0.196, 0.068, 0.066],
      [1.34, 0.206, 0.062, 0.06],
      [1.28, 0.216, 0.056, 0.054],
      [1.25, 0.221, 0.052, 0.05],
    ];
    const rings: RingSpec[] = profile.map(([y, x, rx, rz], index) => ({
      center: new THREE.Vector3(x * sign, y, 0),
      rx,
      rz,
      weights: [{ bone: upper, weight: 1 }],
      t: index / (profile.length - 1),
    }));
    return buildTube(rings, 16, region, ctx, { vRepeat: 1 });
  }

  private buildJeans(ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const waistAnchors = [
      { bone: 'hips', y: 0.98, radius: 0.14 },
      { bone: 'spine_01', y: 1.06, radius: 0.08 },
    ];
    const waistRings: RingSpec[] = [
      [1.06, 0.176, 0.13],
      [1.02, 0.184, 0.135],
      [0.98, 0.19, 0.138],
      [0.93, 0.188, 0.136],
      [0.88, 0.19, 0.14],
      [0.84, 0.175, 0.128],
      // Сводим таз «на конус»: объём закрыт, изнутри ничего не просвечивает.
      [0.81, 0.13, 0.1],
      [0.79, 0.06, 0.05],
    ].map(([y, rx, rz], index, all) => ({
      center: new THREE.Vector3(0, y as number, 0),
      rx: rx as number,
      rz: rz as number,
      weights: this.weightsFor(y as number, waistAnchors),
      t: index / (all.length - 1),
    }));

    const geometries: THREE.BufferGeometry[] = [
      buildTube(waistRings, 24, region, ctx, { vRepeat: 1, capEnd: true }),
      this.buildJeansLeg('l', ctx, region),
      this.buildJeansLeg('r', ctx, region),
    ];

    return mergeParts(geometries);
  }

  private buildJeansLeg(side: 'l' | 'r', ctx: KitContext, region: UvRegion): THREE.BufferGeometry {
    const sign = side === 'l' ? 1 : -1;
    const thigh = `thigh_${side}`;
    const shin = `shin_${side}`;
    const profile: ReadonlyArray<{
      y: number;
      x: number;
      rx: number;
      rz: number;
      weights: readonly BoneWeight[];
    }> = [
      { y: 1.02, x: 0.094, rx: 0.118, rz: 0.12, weights: [{ bone: 'hips', weight: 0.25 }, { bone: thigh, weight: 0.75 }] },
      { y: 0.87, x: 0.096, rx: 0.112, rz: 0.114, weights: [{ bone: thigh, weight: 1 }] },
      { y: 0.75, x: 0.098, rx: 0.104, rz: 0.107, weights: [{ bone: thigh, weight: 1 }] },
      { y: 0.62, x: 0.099, rx: 0.094, rz: 0.097, weights: [{ bone: thigh, weight: 1 }] },
      { y: 0.54, x: 0.1, rx: 0.088, rz: 0.091, weights: [{ bone: thigh, weight: 0.65 }, { bone: shin, weight: 0.35 }] },
      { y: 0.5, x: 0.1, rx: 0.086, rz: 0.089, weights: [{ bone: thigh, weight: 0.45 }, { bone: shin, weight: 0.55 }] },
      { y: 0.44, x: 0.101, rx: 0.084, rz: 0.087, weights: [{ bone: thigh, weight: 0.15 }, { bone: shin, weight: 0.85 }] },
      { y: 0.34, x: 0.102, rx: 0.076, rz: 0.079, weights: [{ bone: shin, weight: 1 }] },
      { y: 0.24, x: 0.103, rx: 0.066, rz: 0.069, weights: [{ bone: shin, weight: 1 }] },
      { y: 0.17, x: 0.104, rx: 0.058, rz: 0.06, weights: [{ bone: shin, weight: 1 }] },
    ];
    const rings: RingSpec[] = profile.map((item, index) => ({
      center: new THREE.Vector3(item.x * sign, item.y, 0),
      rx: item.rx,
      rz: item.rz,
      weights: item.weights,
      t: index / (profile.length - 1),
    }));
    // Верх штанины закрыт: иначе сверху видно «дыру» внутрь джинсов.
    return buildTube(rings, 18, region, ctx, { uRepeat: 2, vRepeat: 1, capStart: true });
  }

  private buildShoe(
    side: 'l' | 'r',
    ctx: KitContext,
    regions: Readonly<Record<RegionId, UvRegion>>,
  ): THREE.BufferGeometry {
    const sign = side === 'l' ? 1 : -1;
    const foot = `foot_${side}`;
    const toe = `toe_${side}`;
    const x = 0.104 * sign;

    const shoeWeights = (vertex: THREE.Vector3): BoneWeight[] => {
      const blend = smoothstep(-0.16, -0.07, vertex.z); // у носка → кость носка
      return [
        { bone: toe, weight: 1 - blend },
        { bone: foot, weight: blend },
      ];
    };

    const soleRegion = regions.shoeSole as UvRegion;
    const upperRegion = regions.shoeUpper as UvRegion;

    const sole = new RoundedBoxGeometry(0.112, 0.042, 0.285, 3, 0.016);
    sole.translate(x, 0.023, -0.042);
    remapUv(sole, soleRegion, 1, 1);
    withSkin(sole, ctx, shoeWeights);

    const upper = new RoundedBoxGeometry(0.104, 0.062, 0.24, 3, 0.026);
    upper.translate(x, 0.072, -0.048);
    remapUv(upper, upperRegion, 1, 1);
    withSkin(upper, ctx, shoeWeights);

    const toeCap = new THREE.SphereGeometry(0.05, 16, 12);
    toeCap.scale(1.02, 0.72, 1.15);
    toeCap.translate(x, 0.055, -0.168);
    remapUv(toeCap, upperRegion, 1, 1);
    withSkin(toeCap, ctx, shoeWeights);

    const heel = new RoundedBoxGeometry(0.1, 0.07, 0.06, 2, 0.02);
    heel.translate(x, 0.078, 0.062);
    remapUv(heel, upperRegion, 1, 1);
    withSkin(heel, ctx, shoeWeights);

    return mergeParts([sole, upper, toeCap, heel]);
  }

  // ——— голова: волосы, глаза, черты лица ——————————————————

  private buildHeadDetails(regions: Readonly<Record<RegionId, UvRegion>>): THREE.Group {
    const headBone = this.rig.bones.get('head');
    if (!headBone) throw new Error('[Character] нет кости головы');
    const group = new THREE.Group();
    group.name = 'head-details';

    const skinRegion = regions.skin as UvRegion;
    const hairRegion = regions.hair as UvRegion;

    const addMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    // Нос, рот, брови, уши — в регионе кожи/волос на атласе
    const nose = new THREE.ConeGeometry(0.022, 0.05, 10, 1);
    nose.rotateX(-Math.PI / 2);
    nose.scale(0.85, 1, 1);
    nose.translate(0, 0.072, -0.1);
    remapUv(nose, skinRegion, 1, 1);
    addMesh(nose, this.bodyMaterial, 'nose');

    const mouth = new RoundedBoxGeometry(0.036, 0.007, 0.01, 2, 0.003);
    mouth.translate(0, 0.032, -0.087);
    remapUv(mouth, hairRegion, 1, 1);
    addMesh(mouth, this.bodyMaterial, 'mouth');

    for (const sign of [1, -1]) {
      const brow = new RoundedBoxGeometry(0.04, 0.009, 0.012, 2, 0.003);
      brow.rotateZ(sign * 0.14);
      brow.translate(sign * 0.037, 0.119, -0.081);
      remapUv(brow, hairRegion, 1, 1);
      addMesh(brow, this.bodyMaterial, 'brow');

      const ear = new THREE.SphereGeometry(0.02, 12, 10);
      ear.scale(0.55, 1.25, 0.9);
      ear.translate(sign * 0.086, 0.088, 0.006);
      remapUv(ear, skinRegion, 1, 1);
      addMesh(ear, this.bodyMaterial, 'ear');

      // Глаз: белок с радужкой через вершинные цвета (материал глаз — глянцевый)
      const eye = new THREE.SphereGeometry(0.0165, 20, 14);
      const position = eye.attributes.position;
      const colors: number[] = [];
      const direction = new THREE.Vector3();
      if (position) {
        for (let i = 0; i < position.count; i += 1) {
          direction.set(position.getX(i), position.getY(i), position.getZ(i)).normalize();
          const facing = -direction.z; // смотрит вперёд, −Z
          if (facing > 0.985) colors.push(0.02, 0.02, 0.02);
          else if (facing > 0.93) colors.push(0.16, 0.1, 0.06);
          else if (facing > 0.87) colors.push(0.34, 0.22, 0.13);
          else colors.push(0.93, 0.91, 0.88);
        }
      }
      eye.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      eye.translate(sign * 0.036, 0.104, -0.077);
      addMesh(eye, this.eyeMaterial, 'eye');
    }

    // Волосы: шапка + затылок + несколько прядей на лбу
    // Шапка заканчивается выше бровей — лицо остаётся открытым
    const cap = new THREE.SphereGeometry(1, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.44);
    cap.scale(0.099, 0.122, 0.107);
    cap.translate(0, 0.096, 0.003);
    remapUv(cap, hairRegion, 2, 2);
    addMesh(cap, this.bodyMaterial, 'hair-cap');

    // Затылочная масса: только задняя половина сферы (phi 0..π = +Z, затылок)
    const back = new THREE.SphereGeometry(1, 22, 14, 0, Math.PI, Math.PI * 0.36, Math.PI * 0.5);
    back.scale(0.098, 0.118, 0.104);
    back.translate(0, 0.094, 0.006);
    remapUv(back, hairRegion, 2, 2);
    addMesh(back, this.bodyMaterial, 'hair-back');

    for (let i = 0; i < 7; i += 1) {
      const angle = -0.9 + (i / 6) * 1.8;
      const strand = new RoundedBoxGeometry(0.03, 0.055, 0.014, 2, 0.006);
      strand.rotateZ(angle * 0.35);
      strand.rotateX(0.25);
      strand.translate(Math.sin(angle) * 0.058, 0.142, -0.062 - Math.abs(angle) * 0.01);
      remapUv(strand, hairRegion, 1, 1);
      addMesh(strand, this.bodyMaterial, 'hair-strand');
    }

    headBone.add(group);
    return group;
  }

  // ——— вспомогательное ——————————————————————————————————

  private static readonly scratchEuler = new THREE.Euler();
  private static readonly scratchQuat = new THREE.Quaternion();
}

