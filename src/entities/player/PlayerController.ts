import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../../core/MathUtils';
import type { Island } from '../../world/Island';

/** Ходьба героя (задача 6): разгон/торможение, поворот к направлению движения,
 *  столкновения и высота земли. Камера работает отдельно (`ThirdPersonCamera`). */

export interface MoveIntent {
  readonly forward: number;
  readonly strafe: number;
  readonly run: boolean;
}

export class PlayerController {
  /** Позиция ног в мире. */
  readonly position = new THREE.Vector3();
  /** Куда повёрнут герой (радианы, 0 = лицом в −Z). */
  yaw = 0;
  /** Горизонтальная скорость, м/с — по ней считается анимация. */
  speed = 0;
  /** 0…1 — доля от бега: размах шага и наклон корпуса. */
  speed01 = 0;
  /** Фаза шага в радианах: растёт от пройденного пути, а не от времени. */
  phase = 0;
  /** Радиус тела для столкновений. */
  readonly radius = 0.34;

  private static readonly WALK_SPEED = 1.85;
  private static readonly RUN_SPEED = 4.5;
  private static readonly ACCELERATION = 12;
  private static readonly DECELERATION = 16;
  private static readonly TURN_RATE = 11;
  /** Длина шага, м: фаза шага привязана к пути, иначе ноги «скользят». */
  private static readonly STRIDE = 1.45;

  private readonly velocity = new THREE.Vector2();
  private targetYaw = 0;
  private moving = false;

  /** Поставить героя в точку и на землю. */
  spawn(x: number, z: number, island: Island, yaw = 0): void {
    this.position.set(x, island.groundHeightAt(x, z), z);
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.velocity.set(0, 0);
    this.speed = 0;
    this.speed01 = 0;
    this.phase = 0;
  }

  /** Состояние для сохранения. */
  getState(): { x: number; y: number; z: number; yaw: number } {
    return { x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.yaw };
  }

  setState(state: { x: number; z: number; yaw: number }, island: Island): void {
    this.spawn(state.x, state.z, island, state.yaw);
  }

  update(dt: number, intent: MoveIntent, cameraYaw: number, island: Island): void {
    if (dt <= 0) return;

    // Направление желаемого движения в мире относительно камеры
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    let wishX = -sin * intent.forward + cos * intent.strafe;
    let wishZ = -cos * intent.forward - sin * intent.strafe;
    const wishLength = Math.hypot(wishX, wishZ);
    this.moving = wishLength > 0.001;
    if (this.moving) {
      wishX /= wishLength;
      wishZ /= wishLength;
    }

    const maxSpeed = intent.run ? PlayerController.RUN_SPEED : PlayerController.WALK_SPEED;
    const targetX = this.moving ? wishX * maxSpeed : 0;
    const targetZ = this.moving ? wishZ * maxSpeed : 0;

    // Разгон медленнее торможения — движение «живое», а не телеграфное
    const rate = (this.moving ? PlayerController.ACCELERATION : PlayerController.DECELERATION) * dt;
    this.velocity.x = PlayerController.approach(this.velocity.x, targetX, rate);
    this.velocity.y = PlayerController.approach(this.velocity.y, targetZ, rate);

    // Движение с разрешением столкновений
    const startX = this.position.x;
    const startZ = this.position.z;
    const probeY = this.position.y + 0.25;
    const desiredX = startX + this.velocity.x * dt;
    const desiredZ = startZ + this.velocity.y * dt;
    const pushed = island.collisions.resolve(desiredX, desiredZ, this.radius, probeY);
    const bounded = island.clampToIsland(pushed.x, pushed.z, this.radius);
    this.position.x = bounded.x;
    this.position.z = bounded.z;

    // Упёрлись в стену — гасим скорость по этой оси, чтобы не «скрести»
    const actualDX = this.position.x - startX;
    const actualDZ = this.position.z - startZ;
    if (Math.abs(this.velocity.x) > 1e-3 && Math.abs(actualDX) < Math.abs(this.velocity.x * dt) * 0.35) this.velocity.x = 0;
    if (Math.abs(this.velocity.y) > 1e-3 && Math.abs(actualDZ) < Math.abs(this.velocity.y * dt) * 0.35) this.velocity.y = 0;

    this.speed = Math.hypot(actualDX, actualDZ) / dt;

    // Высота земли: ступенька на террасу и порог дома сглаживаются
    const groundY = island.groundHeightAt(this.position.x, this.position.z);
    this.position.y = damp(this.position.y, groundY, 14, dt);

    // Поворот героя к направлению движения (плавно, по кратчайшей дуге)
    if (this.moving) this.targetYaw = Math.atan2(-wishX, -wishZ);
    this.yaw = PlayerController.dampAngle(this.yaw, this.targetYaw, PlayerController.TURN_RATE, dt);

    // Параметры анимации: размах зависит от скорости, фаза — от пройденного пути
    this.speed01 = clamp(this.speed / PlayerController.RUN_SPEED, 0, 1);
    if (this.speed > 0.02) {
      // Нога идёт по земле, пока тело проезжает шаг: фаза от пути
      this.phase += (this.speed / PlayerController.STRIDE) * Math.PI * 2 * dt;
      if (this.phase > Math.PI * 200) this.phase -= Math.PI * 200;
    } else {
      // Мягко возвращаем ноги в стойку, когда герой остановился
      const rest = Math.round(this.phase / Math.PI) * Math.PI;
      this.phase = damp(this.phase, rest, 4.5, dt);
    }

    // Нагрузка на развороте: если разница углов большая и мы бежим — шаг мельче
    const turnPenalty = smoothstep(0.6, 1.8, Math.abs(PlayerController.angleDelta(this.yaw, this.targetYaw)));
    this.speed01 *= 1 - turnPenalty * 0.25;
  }

  private static approach(current: number, target: number, maxDelta: number): number {
    const diff = target - current;
    if (Math.abs(diff) <= maxDelta) return target;
    return current + Math.sign(diff) * maxDelta;
  }

  private static angleDelta(from: number, to: number): number {
    let delta = (to - from) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  /** Сглаживание угла с насыщением: быстрый старт поворота, мягкое выравнивание. */
  private static dampAngle(from: number, to: number, lambda: number, dt: number): number {
    const delta = PlayerController.angleDelta(from, to);
    const eased = delta * (1 - Math.exp(-lambda * dt));
    return from + eased;
  }
}
