import * as THREE from 'three';
import { STADIUM } from '../core/Config';
import type { CollisionWorld } from '../world/Colliders';
import type { StadiumResult } from '../world/island/Stadium';

/** Футбольный мяч на стадионе (задача 16).
 *
 *  Что умеет:
 *   • катится с трением и отскоками, отталкивается от трибун и ворот;
 *   • «ведётся» — если герой бежит рядом, мяч подталкивается вперёд;
 *   • бьётся по удержанию Space: чем дольше держишь, тем сильнее удар;
 *   • считает голы и отдаёт счёт табло (`onGoal`).
 *
 *  Физика намеренно простая и предсказуемая: это аркадный футбол, а не симулятор.
 *  Один мяч, один игрок, две линии ворот. */

export interface FootballOptions {
  readonly parent: THREE.Object3D;
  readonly stadium: StadiumResult;
  readonly collisions: CollisionWorld;
  readonly groundHeightAt: (x: number, z: number) => number;
  readonly onGoal: (home: number, away: number) => void;
}

export interface FootballPlayer {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  /** Горизонтальная скорость героя, м/с. */
  readonly speed: number;
  readonly radius: number;
}

const GRAVITY = 16;
/** Трение качения. Было 2,4 — мяч вставал через 6,5 м, и с 32-метрового поля
 *  в ворота было не попасть ни герою, ни ИИ (задача 22). 0,6 даёт честные
 *  ~28 м хода при полном ударе: с центра поля мяч доходит до ворот. */
const ROLL_FRICTION = 0.45;
const AIR_FRICTION = 0.18;
const BOUNCE = 0.42;
/** Дальность удара: ближе этого расстояния Space бьёт по мячу, а не прыгает. */
export const KICK_RANGE = 1.35;
/** Сколько секунд копится полная сила удара. */
const CHARGE_FULL_TIME = 0.9;
const MIN_KICK = 6;
const MAX_KICK = 23;
const KICK_LIFT = 0.32;

export class Football {
  readonly mesh: THREE.Mesh;
  readonly position: THREE.Vector3;
  home = 0;
  away = 0;

  private readonly velocity = new THREE.Vector3();
  private readonly radius = STADIUM.ballRadius;
  private charging = false;
  private chargeTime = 0;
  /** Мяч в сетке: пока идёт пауза после гола, физика стоит. */
  private celebrate = 0;
  /** Автоцентровка после гола: в матче её делает MatchSim. */
  private autoCentre = true;

  constructor(private readonly options: FootballOptions) {
    const texture = createBallTexture();
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0.02 });
    material.name = 'football';
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(this.radius, 20, 14), material);
    this.mesh.name = 'football-ball';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.position = options.stadium.ballStart.clone();
    this.mesh.position.copy(this.position);
    options.parent.add(this.mesh);
  }

  /** 0…1 — накопленная сила удара (для индикатора на экране). */
  get charge01(): number {
    return Math.min(1, this.chargeTime / CHARGE_FULL_TIME);
  }

  get isCharging(): boolean {
    return this.charging;
  }

  get speed(): number {
    return this.velocity.length();
  }

  /** Координаты мяча — интерфейс MatchBall для игроков матча. */
  get x(): number {
    return this.position.x;
  }

  get z(): number {
    return this.position.z;
  }

  /** Горизонтальная скорость — нужна игрокам матча для чтения полёта мяча. */
  get vx(): number {
    return this.velocity.x;
  }

  get vz(): number {
    return this.velocity.z;
  }

  /** Прямой импульс: бьёт ИИ-игрок матча (герой бьёт через зарядку). */
  kick(vx: number, vz: number, lift = 0.3): void {
    if (this.celebrate > 0) return;
    this.velocity.set(vx, Math.hypot(vx, vz) * lift, vz);
  }

  /** Поставить мяч в точку: ведение ИИ и вбрасывание. */
  place(x: number, z: number): void {
    this.position.x = x;
    this.position.z = z;
    this.position.y = this.options.groundHeightAt(x, z) + this.radius;
    this.velocity.set(0, 0, 0);
    this.mesh.position.copy(this.position);
  }

  /** Матч сам центрует мяч после гола — тогда физика ждёт его команды. */
  setAutoCentre(value: boolean): void {
    this.autoCentre = value;
  }

  /** Расстояние от героя до мяча по земле. */
  distanceTo(player: FootballPlayer): number {
    return Math.hypot(player.x - this.position.x, player.z - this.position.z);
  }

  /** Мяч в пределах удара? По этому признаку Space бьёт, а не прыгает. */
  canKick(player: FootballPlayer): boolean {
    return this.celebrate <= 0 && this.distanceTo(player) <= KICK_RANGE + player.radius;
  }

  /** Зажать Space рядом с мячом: копим силу. */
  startCharge(player: FootballPlayer): boolean {
    if (!this.canKick(player)) return false;
    this.charging = true;
    this.chargeTime = 0;
    return true;
  }

  /** Отпустить Space: удар накопленной силы. Возвращает силу удара 0…1. */
  releaseCharge(player: FootballPlayer): number {
    if (!this.charging) return 0;
    const power = this.charge01;
    this.charging = false;
    this.chargeTime = 0;
    if (!this.canKick(player)) return 0;

    const direction = new THREE.Vector2(-Math.sin(player.yaw), -Math.cos(player.yaw));
    const distance = this.distanceTo(player);
    // Мяч перед героем: бьём в его сторону, а не «в себя».
    const side = (this.position.x - player.x) * direction.x + (this.position.z - player.z) * direction.y;
    if (side < 0) direction.multiplyScalar(-1);
    // Чем ближе мяч, тем точнее удар: на пределе дальности сила падает.
    const accuracy = 1 - Math.min(1, distance / (KICK_RANGE + player.radius)) * 0.35;
    const speed = (MIN_KICK + (MAX_KICK - MIN_KICK) * power) * accuracy;

    this.velocity.set(direction.x * speed, speed * KICK_LIFT * (0.4 + power * 0.8), direction.y * speed);
    return power;
  }

  /** Вернуть мяч на центр (новый матч, выход в меню). */
  reset(keepScore = true): void {
    this.position.copy(this.options.stadium.ballStart);
    this.velocity.set(0, 0, 0);
    this.mesh.position.copy(this.position);
    this.charging = false;
    this.chargeTime = 0;
    this.celebrate = 0;
    if (!keepScore) {
      this.home = 0;
      this.away = 0;
      this.options.onGoal(0, 0);
    }
  }

  update(dt: number, player: FootballPlayer | null): void {
    if (this.charging) this.chargeTime = Math.min(CHARGE_FULL_TIME, this.chargeTime + dt);

    if (this.celebrate > 0) {
      if (!this.autoCentre) return;
      this.celebrate = Math.max(0, this.celebrate - dt);
      if (this.celebrate === 0) this.reset();
      return;
    }

    if (dt <= 0) return;

    // Мяч укатился с плато в море — возвращаем на центр, счёт не трогаем.
    if (this.position.y < 0 || Math.abs(this.position.x) > 80 || Math.abs(this.position.z) > 60) {
      this.reset();
      return;
    }

    // ——— ведение мяча: герой рядом и бежит — толкаем вперёд ———
    if (player && player.speed > 0.35 && this.velocity.length() < 9 && !this.charging) {
      const dx = this.position.x - player.x;
      const dz = this.position.z - player.z;
      const distance = Math.hypot(dx, dz);
      const touch = this.radius + player.radius + 0.28;
      if (distance < touch && distance > 0.001) {
        const forwardX = -Math.sin(player.yaw);
        const forwardZ = -Math.cos(player.yaw);
        // Мяч должен уходить вперёд, а не отскакивать в сторону.
        const push = 1.6 + player.speed * 1.15;
        this.velocity.x = forwardX * push + (dx / distance) * 0.6;
        this.velocity.z = forwardZ * push + (dz / distance) * 0.6;
        this.velocity.y = Math.max(this.velocity.y, 0.2);
      }
    }

    // ——— интегрирование ———
    const groundY = this.options.groundHeightAt(this.position.x, this.position.z) + this.radius;
    const onGround = this.position.y <= groundY + 0.02;

    this.velocity.y -= GRAVITY * dt;
    const friction = onGround ? ROLL_FRICTION : AIR_FRICTION;
    const damping = Math.max(0, 1 - friction * dt);
    this.velocity.x *= damping;
    this.velocity.z *= damping;

    const nextX = this.position.x + this.velocity.x * dt;
    const nextZ = this.position.z + this.velocity.z * dt;

    // Столкновения по осям отдельно: так нормаль отскока получается сама.
    const blockedX = this.options.collisions.isBlocked(nextX, this.position.z, this.radius, this.position.y);
    const blockedZ = this.options.collisions.isBlocked(this.position.x, nextZ, this.radius, this.position.y);
    if (!blockedX) this.position.x = nextX;
    else this.velocity.x = -this.velocity.x * BOUNCE;
    if (!blockedZ) this.position.z = nextZ;
    else this.velocity.z = -this.velocity.z * BOUNCE;

    this.position.y += this.velocity.y * dt;
    if (this.position.y < groundY) {
      this.position.y = groundY;
      this.velocity.y = Math.abs(this.velocity.y) > 1.1 ? -this.velocity.y * BOUNCE : 0;
    }

    // Остановка: иначе мяч «дрожит» на месте с микроскоростью.
    if (onGround && Math.hypot(this.velocity.x, this.velocity.z) < 0.12) {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // Вращение мяча «по ходу» — без него катится как доска.
    const spin = Math.hypot(this.velocity.x, this.velocity.z) / this.radius;
    this.mesh.rotateOnWorldAxis(
      new THREE.Vector3(this.velocity.z, 0, -this.velocity.x).normalize(),
      spin * dt,
    );
    this.mesh.position.copy(this.position);

    this.checkGoal();
  }

  /** Гол: мяч пересёк линию между штангами ниже перекладины. */
  private checkGoal(): void {
    const { west, east } = this.options.stadium.goalLines;
    const halfWidth = this.options.stadium.goalHalfWidth;
    // Высота перекладины отсчитывается от земли, а не от нуля мира.
    const groundY = this.options.groundHeightAt(this.position.x, this.position.z);
    const inMouth =
      Math.abs(this.position.z - STADIUM.centerZ) < halfWidth - this.radius * 0.5 &&
      this.position.y < groundY + this.options.stadium.goalHeight;

    if (inMouth && this.position.x < west) {
      this.away += 1;
      this.finishGoal();
    } else if (inMouth && this.position.x > east) {
      this.home += 1;
      this.finishGoal();
    }
  }

  private finishGoal(): void {
    this.celebrate = 1.6;
    this.velocity.set(0, 0, 0);
    this.charging = false;
    this.chargeTime = 0;
    this.options.onGoal(this.home, this.away);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}

/** Мяч: белая кожа с тёмными пятнами — узнаваемо даже в 22 см. */
function createBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#f6f4ee';
    context.fillRect(0, 0, 256, 128);
    context.fillStyle = '#14181c';
    const patches: Array<[number, number, number]> = [
      [32, 40, 13],
      [96, 26, 12],
      [160, 46, 13],
      [224, 30, 11],
      [64, 96, 12],
      [128, 104, 13],
      [192, 92, 12],
      [250, 96, 10],
    ];
    for (const [x, y, r] of patches) {
      context.beginPath();
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
