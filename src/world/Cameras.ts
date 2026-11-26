import * as THREE from 'three';
import { TERRACE } from '../core/Config';
import { clamp, damp } from '../core/MathUtils';
import type { WalkBounds } from './Island';
import type { CollisionWorld } from './Colliders';

/** Камера меню: медленный «дрейф» по террасе, взгляд на море.
 *  Никаких резких движений — только синусоиды и сглаживание (GOAL.md §6.3). */
export class DriftCamera {
  readonly camera: THREE.PerspectiveCamera;
  // Меню смотрит на дом от калитки — кадр как на референсе (VISION.md §1)
  private readonly base = new THREE.Vector3(0, TERRACE.deckTopY + 2.35, 18.4);
  private readonly position = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredLookAt = new THREE.Vector3();
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(56, aspect, 0.1, 12000);
    this.camera.position.copy(this.base);
  }

  update(dt: number, elapsed: number): void {
    const t = elapsed;
    this.desiredPosition.set(
      this.base.x + Math.sin(t * 0.19) * 0.9,
      this.base.y + Math.sin(t * 0.17 + 1.1) * 0.09,
      this.base.z + Math.cos(t * 0.21) * 0.45,
    );
    this.desiredLookAt.set(
      Math.sin(t * 0.12) * 1.4,
      TERRACE.deckTopY + 1.35 + Math.sin(t * 0.16) * 0.14,
      -3,
    );

    if (!this.initialized) {
      this.position.copy(this.desiredPosition);
      this.lookAt.copy(this.desiredLookAt);
      this.initialized = true;
    }
    this.position.x = damp(this.position.x, this.desiredPosition.x, 3, dt);
    this.position.y = damp(this.position.y, this.desiredPosition.y, 3, dt);
    this.position.z = damp(this.position.z, this.desiredPosition.z, 3, dt);
    this.lookAt.x = damp(this.lookAt.x, this.desiredLookAt.x, 2.4, dt);
    this.lookAt.y = damp(this.lookAt.y, this.desiredLookAt.y, 2.4, dt);
    this.lookAt.z = damp(this.lookAt.z, this.desiredLookAt.z, 2.4, dt);

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

/** Камера осмотра персонажа (F3): плавно переезжает к модели и смотрит на грудь.
 *  Модель при этом вращается сама — так видно скиннинг со всех сторон. */
export class InspectorCamera {
  readonly camera: THREE.PerspectiveCamera;

  private readonly position = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private initialized = false;

  private distance = 3.1;
  private static readonly EYE = 1.24;
  private static readonly CHEST = 1.1;
  private static readonly HEAD = 1.62;
  private static readonly MIN_DISTANCE = 0.75;
  private static readonly MAX_DISTANCE = 6;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.05, 400);
  }

  /** Первый кадр берём из текущей камеры игрока — переход получается плавным. */
  enter(from: THREE.Camera): void {
    if (this.initialized) return;
    this.position.copy(from.position);
    this.target.copy(from.position).addScaledVector(from.getWorldDirection(new THREE.Vector3()), 3);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
    this.initialized = true;
  }

  /** rotationY — поворот модели: камера встаёт со стороны лица (модель смотрит в −Z). */
  update(dt: number, characterPosition: THREE.Vector3, rotationY: number): void {
    const offset = new THREE.Vector3(
      -Math.sin(rotationY) * this.distance,
      InspectorCamera.EYE,
      -Math.cos(rotationY) * this.distance,
    );
    this.desiredPosition.copy(characterPosition).add(offset);
    // Чем ближе камера, тем выше цель: при сильном приближении смотрим в лицо.
    const focus = this.distance < 1.5 ? InspectorCamera.HEAD : InspectorCamera.CHEST;
    this.desiredTarget.copy(characterPosition).add(new THREE.Vector3(0, focus, 0));

    this.position.x = damp(this.position.x, this.desiredPosition.x, 5, dt);
    this.position.y = damp(this.position.y, this.desiredPosition.y, 5, dt);
    this.position.z = damp(this.position.z, this.desiredPosition.z, 5, dt);
    this.target.x = damp(this.target.x, this.desiredTarget.x, 6, dt);
    this.target.y = damp(this.target.y, this.desiredTarget.y, 6, dt);
    this.target.z = damp(this.target.z, this.desiredTarget.z, 6, dt);

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
  }

  /** Приближение колесом мыши: нужно, чтобы рассмотреть лицо и кисти. */
  zoomBy(delta: number): void {
    this.distance = clamp(this.distance + delta, InspectorCamera.MIN_DISTANCE, InspectorCamera.MAX_DISTANCE);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

export interface FreeCameraIntent {
  readonly forward: number;
  readonly strafe: number;
  readonly run: boolean;
}

/** Камера свободного обзора (до появления персонажа в задаче 2):
 *  ходьба по террасе от первого лица с инерцией — те же константы, что будут у героя:
 *  ускорение 8 м/с², торможение 12 м/с², шаг 2.6 м/с, бег 5.4 м/с (GOAL.md §7, задача 6). */
export class FreeCamera {
  readonly camera: THREE.PerspectiveCamera;

  private yaw = 0;
  private pitch = -0.05;
  private readonly velocity = new THREE.Vector3();
  private readonly eye = new THREE.Vector3(0, TERRACE.deckTopY + TERRACE.eyeHeight, 6.4);

  private static readonly ACCELERATION = 8;
  private static readonly DECELERATION = 12;
  private static readonly WALK_SPEED = 2.6;
  private static readonly RUN_SPEED = 5.4;
  private static readonly LOOK_SENSITIVITY = 0.0022;
  private static readonly MAX_PITCH = 1.2;

  constructor(aspect: number, private bounds: WalkBounds) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.08, 12000);
    this.applyTransform();
  }

  /** Границы ходьбы задаёт мир (после сборки сцены). */
  setBounds(bounds: WalkBounds): void {
    this.bounds = bounds;
    this.eye.x = clamp(this.eye.x, bounds.minX, bounds.maxX);
    this.eye.z = clamp(this.eye.z, bounds.minZ, bounds.maxZ);
    this.applyTransform();
  }

  /** Состояние камеры для сохранения («Продолжить» возвращает на то же место). */
  getState(): { x: number; y: number; z: number; yaw: number } {
    return { x: this.eye.x, y: this.eye.y, z: this.eye.z, yaw: this.yaw };
  }

  setState(state: { x: number; y: number; z: number; yaw: number }): void {
    this.eye.set(
      clamp(state.x, this.bounds.minX, this.bounds.maxX),
      TERRACE.deckTopY + TERRACE.eyeHeight,
      clamp(state.z, this.bounds.minZ, this.bounds.maxZ),
    );
    this.yaw = state.yaw;
    this.velocity.set(0, 0, 0);
    this.applyTransform();
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = -0.05;
    this.velocity.set(0, 0, 0);
    // Спавн: за плечом героя, взгляд на дом по дорожке
    this.eye.set(0, TERRACE.deckTopY + TERRACE.eyeHeight, 11.6);
    this.applyTransform();
  }

  /** Приращение мыши → поворот. Скорость поворота ограничена сверху, «рывков» нет. */
  look(deltaX: number, deltaY: number): void {
    this.yaw -= deltaX * FreeCamera.LOOK_SENSITIVITY;
    this.pitch = clamp(this.pitch - deltaY * FreeCamera.LOOK_SENSITIVITY, -FreeCamera.MAX_PITCH, FreeCamera.MAX_PITCH);
  }

  update(dt: number, intent: FreeCameraIntent): void {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Направления в плоскости пола: вперёд = -Z при yaw = 0
    const desiredX = (-sin * intent.forward + cos * intent.strafe) * this.maxSpeed(intent.run);
    const desiredZ = (-cos * intent.forward - sin * intent.strafe) * this.maxSpeed(intent.run);

    const accelerate = Math.abs(intent.forward) + Math.abs(intent.strafe) > 0;
    const rate = (accelerate ? FreeCamera.ACCELERATION : FreeCamera.DECELERATION) * dt;

    this.velocity.x = FreeCamera.approach(this.velocity.x, desiredX, rate);
    this.velocity.z = FreeCamera.approach(this.velocity.z, desiredZ, rate);

    this.eye.x = clamp(this.eye.x + this.velocity.x * dt, this.bounds.minX, this.bounds.maxX);
    this.eye.z = clamp(this.eye.z + this.velocity.z * dt, this.bounds.minZ, this.bounds.maxZ);
    // Упёрлись в границу — гасим скорость, чтобы не «скрести» стену.
    if (this.eye.x <= this.bounds.minX || this.eye.x >= this.bounds.maxX) this.velocity.x = 0;
    if (this.eye.z <= this.bounds.minZ || this.eye.z >= this.bounds.maxZ) this.velocity.z = 0;

    this.applyTransform();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private maxSpeed(run: boolean): number {
    return run ? FreeCamera.RUN_SPEED : FreeCamera.WALK_SPEED;
  }

  private applyTransform(): void {
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private static approach(current: number, target: number, maxDelta: number): number {
    const diff = target - current;
    if (Math.abs(diff) <= maxDelta) return target;
    return current + Math.sign(diff) * maxDelta;
  }
}

/** Камера от третьего лица (задача 6): «пружина» за плечом героя.
 *  Мышь вращает камеру вокруг персонажа, W двигает его от камеры.
 *  Стены не просвечивают: пружина укорачивается по столкновениям мира. */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Высота точки взгляда над ногами героя. */
  private static readonly LOOK_HEIGHT = 1.42;
  private static readonly MIN_DISTANCE = 1.15;
  private static readonly MAX_DISTANCE = 6.5;
  private static readonly LOOK_SENSITIVITY = 0.0024;
  /** Сдвиг вбок: камера смотрит поверх правого плеча, герой левее центра. */
  private static readonly SHOULDER_OFFSET = 0.34;

  private yawValue = 0;
  private pitchValue = 0.2;
  private distanceValue = 3.3;

  private readonly target = new THREE.Vector3();
  private readonly smoothTarget = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly smooth = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.08, 12000);
  }

  get yaw(): number {
    return this.yawValue;
  }

  get distance(): number {
    return this.distanceValue;
  }

  /** Наклон камеры: по нему считается угол броска (задача 8). */
  get pitch(): number {
    return this.pitchValue;
  }

  /** Жёстко задать наклон (тесты и восстановление после загрузки). */
  setPitch(pitch: number): void {
    this.pitchValue = clamp(pitch, -0.28, 1.05);
  }

  /** Жёстко задать угол обзора (после загрузки сохранения). */
  setYaw(yaw: number): void {
    this.yawValue = yaw;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Мышь: горизонталь — вокруг героя, вертикаль — наклон. */
  look(deltaX: number, deltaY: number): void {
    this.yawValue -= deltaX * ThirdPersonCamera.LOOK_SENSITIVITY;
    this.pitchValue = clamp(this.pitchValue + deltaY * ThirdPersonCamera.LOOK_SENSITIVITY, -0.28, 1.05);
  }

  /** Колесо мыши: приближение/отдаление. */
  zoom(delta: number): void {
    this.distanceValue = clamp(this.distanceValue + delta, ThirdPersonCamera.MIN_DISTANCE, ThirdPersonCamera.MAX_DISTANCE);
  }

  /** Мгновенно поставить камеру за героем (вход в игру, возврат из паузы). */
  snapTo(feet: THREE.Vector3, yaw: number, collisions: CollisionWorld | null): void {
    this.yawValue = yaw;
    this.setTarget(feet);
    this.smoothTarget.copy(this.target);
    this.computeDesired(collisions);
    this.smooth.copy(this.desired);
    this.initialized = true;
    this.applyTransform();
  }

  update(dt: number, feet: THREE.Vector3, collisions: CollisionWorld | null): void {
    this.setTarget(feet);
    if (!this.initialized) {
      this.snapTo(feet, this.yawValue, collisions);
      return;
    }
    // Сглаживание: точка взгляда догоняет героя быстрее, чем сама камера
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x, 18, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y, 10, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z, 18, dt);

    this.computeDesired(collisions);
    const rate = 14;
    this.smooth.x = damp(this.smooth.x, this.desired.x, rate, dt);
    this.smooth.y = damp(this.smooth.y, this.desired.y, rate, dt);
    this.smooth.z = damp(this.smooth.z, this.desired.z, rate, dt);
    this.applyTransform();
  }

  /** Точка взгляда: на уровне груди и сдвинута вправо относительно героя. */
  private setTarget(feet: THREE.Vector3): void {
    const side = ThirdPersonCamera.SHOULDER_OFFSET;
    this.target.set(
      feet.x + Math.cos(this.yawValue) * side,
      feet.y + ThirdPersonCamera.LOOK_HEIGHT,
      feet.z - Math.sin(this.yawValue) * side,
    );
  }

  private computeDesired(collisions: CollisionWorld | null): void {
    const cosPitch = Math.cos(this.pitchValue);
    this.direction.set(Math.sin(this.yawValue) * cosPitch, Math.sin(this.pitchValue), Math.cos(this.yawValue) * cosPitch);
    let distance = this.distanceValue;
    if (collisions) {
      // Пружина не проходит сквозь стены
      distance = collisions.raycastDistance(this.smoothTarget, this.direction, distance, 0.3);
    }
    this.desired.copy(this.smoothTarget).addScaledVector(this.direction, distance);
  }

  private applyTransform(): void {
    this.camera.position.copy(this.smooth);
    this.camera.lookAt(this.smoothTarget);
  }
}
