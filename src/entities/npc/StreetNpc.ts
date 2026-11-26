import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clamp, damp } from '../../core/MathUtils';
import { cloneGltfForNpc, RiggedHero } from '../character/RiggedHero';

/**
 * Уличный житель (задача 22).
 *
 *  Тот же скелет, что у героя, но своя палитра: другая кожа, другая одежда,
 *  другой рост. Живёт по распорядку — идёт по маршруту, останавливается
 *  поглазеть, разворачивается и идёт назад. Когда герой подходит близко,
 *  здоровается: поворачивает голову, машет рукой и говорит (голос в StreetLife).
 *
 *  Отдельный класс, а не копия кассира: кассир стоит и торгует, этот ходит,
 *  и ему нужна нормальная локомоция с фазой шага.
 */

export interface StreetRoute {
  /** Точки маршрута на земле, м. */
  readonly points: ReadonlyArray<readonly [number, number]>;
  /** Скорость шага, м/с. */
  readonly speed: number;
  readonly yawBias?: number;
}

const GREET_RANGE = 3.4;

export class StreetNpc {
  readonly group = new THREE.Group();
  readonly hero: RiggedHero;
  readonly name: string;

  private readonly points: ReadonlyArray<readonly [number, number]>;
  private readonly speed: number;
  private readonly yawBias: number;
  private readonly armL: { bone: THREE.Bone; rest: THREE.Quaternion } | null;
  private readonly armR: { bone: THREE.Bone; rest: THREE.Quaternion } | null;
  private readonly spine: { bone: THREE.Bone; rest: THREE.Quaternion } | null;
  private readonly groundHeightAt: (x: number, z: number) => number;

  private target = 0;
  private direction = 1;
  private wait = 0;
  private phase = 0;
  private wave = 0;
  private waveTimer = 0;
  private lookYaw = 0;
  private greetCooldown = 0;
  private speed01 = 0;
  private yaw = 0;
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();

  constructor(
    gltf: GLTF,
    palette: readonly string[],
    route: StreetRoute,
    name: string,
    groundHeightAt: (x: number, z: number) => number,
  ) {
    this.hero = new RiggedHero(cloneGltfForNpc(gltf));
    this.hero.recolourOutfit(palette, 512);
    // 82 тысячи треугольников на жителя — в карту теней их второй раз не надо
    this.hero.setCastShadow(false);
    this.name = name;
    this.group.name = `street-npc-${name}`;
    this.group.add(this.hero.group);
    this.points = route.points;
    this.speed = route.speed;
    this.yawBias = route.yawBias ?? 0;
    this.groundHeightAt = groundHeightAt;

    const grab = (boneName: string): { bone: THREE.Bone; rest: THREE.Quaternion } | null => {
      const bone = this.hero.rig.bones.get(boneName);
      return bone ? { bone, rest: bone.quaternion.clone() } : null;
    };
    this.armL = grab('upperarm_l');
    this.armR = grab('upperarm_r');
    this.spine = grab('spine_02');

    const [x, z] = this.points[0];
    this.group.position.set(x, groundHeightAt(x, z), z);
    // Разные жители не идут строем: начальная фаза и задержка свои
    this.phase = Math.random() * 6;
    this.wait = Math.random() * 1.5;
    this.target = this.points.length > 1 ? 1 : 0;
    this.hero.setLocomotion(0, 0);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /** Поздороваться: мах рукой и поворот к герою. */
  greet(): void {
    this.waveTimer = 1.4;
    this.greetCooldown = 22 + Math.random() * 10;
  }

  get canGreet(): boolean {
    return this.greetCooldown <= 0 && this.waveTimer <= 0;
  }

  update(dt: number, playerPosition: THREE.Vector3): boolean {
    this.greetCooldown = Math.max(0, this.greetCooldown - dt);
    this.hero.update(dt);

    const toPlayerX = playerPosition.x - this.group.position.x;
    const toPlayerZ = playerPosition.z - this.group.position.z;
    const playerDistance = Math.hypot(toPlayerX, toPlayerZ);
    const near = playerDistance < GREET_RANGE;

    // Маршрут: идём к точке, на месте — топчемся/стоим
    let moving = 0;
    if (this.waveTimer > 0) {
      this.waveTimer = Math.max(0, this.waveTimer - dt);
      moving = 0;
    } else if (this.wait > 0) {
      this.wait = Math.max(0, this.wait - dt);
      moving = 0;
    } else {
      const [tx, tz] = this.points[this.target];
      const dx = tx - this.group.position.x;
      const dz = tz - this.group.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.35) {
        // Дошли: пауза и следующая точка (или разворот)
        this.wait = 1.4 + Math.random() * 2.6;
        this.target += this.direction;
        if (this.target >= this.points.length || this.target < 0) {
          this.direction *= -1;
          this.target = clamp(this.target, 0, this.points.length - 1);
        }
      } else {
        const step = Math.min(distance, this.speed * dt);
        this.group.position.x += (dx / distance) * step;
        this.group.position.z += (dz / distance) * step;
        moving = 1;
        const wantYaw = Math.atan2(-dx, -dz) + this.yawBias;
        this.yaw = this.turnToward(this.yaw, wantYaw, dt, 6);
      }
    }
    this.speed01 = damp(this.speed01, moving, 7, dt);
    this.phase += dt * (1.5 + this.speed01 * 7.5);

    // Стоит и смотрит на героя, если тот рядом и не идёт
    if (near && moving === 0) {
      const wantYaw = Math.atan2(-toPlayerX, -toPlayerZ);
      this.lookYaw = this.turnToward(this.lookYaw, wantYaw, dt, 4);
      if (this.waveTimer <= 0) this.yaw = this.turnToward(this.yaw, wantYaw, dt, 2.4);
    } else if (!near) {
      // Герой ушёл — взгляд возвращается к дороге, а не «прилипает» навсегда
      this.lookYaw = this.turnToward(this.lookYaw, 0, dt, 1.6);
    }

    this.group.position.y = this.groundHeightAt(this.group.position.x, this.group.position.z);
    this.group.rotation.y = this.yaw + this.lookYaw;
    this.hero.setLocomotion(this.speed01 * 0.62, this.phase);

    // Мах рукой: поднимаем плечо и качаем предплечьем
    this.wave = damp(this.wave, this.waveTimer > 0 ? 1 : 0, 9, dt);
    if (this.armR) {
      const swing = Math.sin(this.waveTimer * 11) * 0.35 * this.wave;
      const q = this.tmpQuat.setFromEuler(this.tmpEuler.set(0, 0, -2.2 * this.wave - swing));
      this.armR.bone.quaternion.copy(this.armR.rest).multiply(q);
    }
    if (this.armL) {
      const q = this.tmpQuat.setFromEuler(this.tmpEuler.set(0, 0, 0.12 * this.wave));
      this.armL.bone.quaternion.copy(this.armL.rest).multiply(q);
    }
    if (this.spine) {
      const q = this.tmpQuat.setFromEuler(this.tmpEuler.set(-0.12 * this.speed01, 0, 0));
      this.spine.bone.quaternion.copy(this.spine.rest).multiply(q);
    }

    // Возвращаем «здоровается» один раз за подход
    const greeted = near && this.canGreet;
    if (greeted) this.greet();
    return greeted;
  }

  private turnToward(current: number, target: number, dt: number, rate: number): number {
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return current + clamp(delta, -rate * dt, rate * dt);
  }

  get triangles(): number {
    return this.hero.triangleCount;
  }

  dispose(): void {
    this.hero.dispose(false);
    this.group.removeFromParent();
  }
}
