import * as THREE from 'three';
import { clamp } from '../core/MathUtils';
import { BALL_TEXTS, MISSION_02 } from '../data/quests';
import type { HoopGeometry } from '../world/island/Court';
import type { Game } from './Game';

/** Вторая миссия (задача 8): мяч, бросок с зарядом и честный подсчёт голов.
 *  Физика своя, без движка: одна сфера против пола, щита, дужки, сетки и героя.
 *  Каждый шаг — чистая функция от состояния, поэтому ту же физику использует
 *  предпросмотр дуги броска (и автотест), а не отдельная «примерная» модель. */

const RULES = {
  radius: 0.12,
  gravity: 9.81,
  /** Отскоки: пол мягче, дужка звонче, герой гасит мяч. */
  restitutionGround: 0.65,
  restitutionRim: 0.45,
  restitutionBoard: 0.55,
  restitutionWorld: 0.5,
  restitutionPlayer: 0.4,
  /** Сопротивление воздуха и трение качения. */
  airDrag: 0.05,
  rollingFriction: 1.7,
  /** Фиксированный подшаг физики: 240 Гц хватает, чтобы не проскакивать дужку. */
  step: 1 / 240,
  maxFrame: 0.1,
  pickupReach: 1.9,
  pickupSpeed: 7,
  /** Замах: 0.9 с до полной силы. */
  chargeTime: 0.9,
  minSpeed: 6.4,
  maxSpeed: 14,
  /** Угол броска: наклон камеры вниз — плоский бросок, вверх — навес. */
  elevationBase: 1.05,
  elevationGain: 0.75,
  minElevation: 0.35,
  maxElevation: 1.35,
  throwDuration: 0.45,
  releaseGrace: 0.15,
  /** Точка вылета мяча: чуть дальше кистей, чтобы он не появлялся внутри тела. */
  releaseOffset: 0.42,
  /** Допуск «мяч целиком внутри кольца» (0.02 — зазор на погрешность шага). */
  scoreTolerance: 0.02,
  /** Мягкая помощь прицелу у кольца (см. DECISIONS D-59): радиус и сила подтягивания. */
  assistRadius: 0.34,
  assistHeight: 0.6,
  assistStrength: 18,
  /** Доводка броска: боковой промах прицела и допуск по силе (D-59). */
  snapAimRadius: 0.7,
  snapTolerance: 0.85,
  goalConfirmDepth: 0.34,
  respawnDelay: 5,
  respawnMargin: 3,
  total: 2,
} as const;

/** Состояние сферы: одна и та же структура для живого мяча и предпросмотра. */
interface Body {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  prevX: number;
  prevY: number;
  prevZ: number;
  /** Первые мгновения после броска мяч не сталкивается с самим героем. */
  grace: number;
  /** Ось и скорость вращения — по ним крутится модель мяча. */
  readonly spinAxis: THREE.Vector3;
  spinSpeed: number;
}

function createBody(): Body {
  return {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    prevX: 0,
    prevY: 0,
    prevZ: 0,
    grace: 0,
    spinAxis: new THREE.Vector3(1, 0, 0),
    spinSpeed: 0,
  };
}

/** Текстура баскетбольного мяча: оранжевая кожа и чёрные швы (canvas, без файлов). */
function createBallTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#cf6b2c';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i += 1) {
      const light = Math.random() > 0.5;
      ctx.fillStyle = light ? 'rgba(255,205,150,0.20)' : 'rgba(96,44,14,0.24)';
      const r = 0.6 + Math.random() * 1.5;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#2b1a10';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const x of [0, size / 2, size]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
    for (const centerX of [size * 0.25, size * 0.75]) {
      ctx.beginPath();
      ctx.ellipse(centerX, size / 2, size * 0.15, size * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Искры при голе: те же точки, что и капли краски у первой миссии. */
class SparkSystem {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly count = 40;
  private cursor = 0;

  constructor(color: number) {
    this.positions = new Float32Array(this.count * 3).fill(-999);
    this.velocities = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color,
        size: 0.05,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.name = 'goal-sparks';
  }

  burst(origin: THREE.Vector3, count = 18): void {
    for (let i = 0; i < count; i += 1) {
      const index = this.cursor % this.count;
      this.cursor += 1;
      const base = index * 3;
      this.positions[base] = origin.x + (Math.random() - 0.5) * 0.3;
      this.positions[base + 1] = origin.y + (Math.random() - 0.5) * 0.2;
      this.positions[base + 2] = origin.z + (Math.random() - 0.5) * 0.3;
      this.velocities[base] = (Math.random() - 0.5) * 2.4;
      this.velocities[base + 1] = 0.5 + Math.random() * 2.2;
      this.velocities[base + 2] = (Math.random() - 0.5) * 2.4;
      this.life[index] = 0.5 + Math.random() * 0.5;
    }
  }

  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < this.count; i += 1) {
      if (this.life[i] <= 0) continue;
      changed = true;
      this.life[i] -= dt;
      const base = i * 3;
      this.velocities[base + 1] -= 6 * dt;
      this.positions[base] += this.velocities[base] * dt;
      this.positions[base + 1] += this.velocities[base + 1] * dt;
      this.positions[base + 2] += this.velocities[base + 2] * dt;
      if (this.life[i] <= 0) this.positions[base + 1] = -999;
    }
    if (changed) this.points.geometry.getAttribute('position').needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points.removeFromParent();
  }
}

export class BallMission {
  /** Геометрия мяча и кольца — открыта тестам и отладке. */
  readonly ball: Body;
  readonly spawnPoint: THREE.Vector3;
  readonly radius = RULES.radius;

  private readonly island: NonNullable<Game['world']>['island'];
  private readonly hoop: HoopGeometry;
  private readonly mesh: THREE.Mesh;
  private readonly texture: THREE.CanvasTexture;
  private readonly sparks: SparkSystem;
  private readonly ballRing: THREE.Mesh;
  private readonly hoopGlow: THREE.Mesh;
  private readonly net: THREE.Mesh;
  private readonly netBaseY: number;
  private readonly previewLine: THREE.Line;
  private readonly previewPositions: Float32Array;

  private held = false;
  private charging = false;
  private charge = 0;
  private testHold = false;
  private throwTimer = 0;
  private ballPose: 'none' | 'hold' | 'throw' = 'none';
  private ballPosePhase = -1;

  private goals = 0;
  private completed = false;
  private pendingGoal = false;
  private missPending = false;
  private rimCooldown = 0;
  private netWobble = 0;
  private outTimer = 0;
  private respawnFade = 0;

  private promptText: string | null = null;
  private hudTask = '';
  private hudGoals = -1;
  private hudState = '';
  private eventText = '';
  private eventUntil = 0;
  private flashUntil = 0;
  private clock = 0;
  private saveTimer = 0;

  private readonly sim: Body = createBody();
  /** Отдельное тело для solver'а: иначе он затирает предпросмотр и предсказание. */
  private readonly solverBody: Body = createBody();
  private readonly handPoint = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly camForward = new THREE.Vector3();
  private readonly scratchRelease = new THREE.Vector3();

  constructor(private readonly game: Game) {
    const island = game.world?.island;
    if (!island) throw new Error('Площадка не построена: BallMission создаётся после мира');
    this.island = island;
    this.hoop = island.court.geometry;
    this.ball = createBody();

    // Мяч лежит на площадке в 7.4 м от кольца — «штрафная» дистанция броска
    this.spawnPoint = new THREE.Vector3(
      this.hoop.center.x + 7.4,
      island.court.slabTopY + RULES.radius,
      this.hoop.center.z,
    );
    this.ball.pos.copy(this.spawnPoint);
    this.ball.prevY = this.spawnPoint.y;

    this.texture = createBallTexture();
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(RULES.radius, 22, 16),
      new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.78, metalness: 0.02 }),
    );
    this.mesh.castShadow = true;
    this.mesh.name = 'basketball';
    this.mesh.position.copy(this.ball.pos);
    game.world?.scene.add(this.mesh);

    this.sparks = new SparkSystem(0xffd27a);
    game.world?.scene.add(this.sparks.points);

    // Подсветка мяча на полу и кольца — по ним видно, что делать в миссии 02
    this.ballRing = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.34, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ballRing.visible = false;
    game.world?.scene.add(this.ballRing);

    this.hoopGlow = new THREE.Mesh(
      new THREE.TorusGeometry(this.hoop.radius + 0.06, 0.014, 8, 40).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.0, depthWrite: false }),
    );
    this.hoopGlow.position.copy(this.hoop.center);
    this.hoopGlow.visible = false;
    game.world?.scene.add(this.hoopGlow);

    this.net = island.court.net;
    this.netBaseY = this.net.position.y;

    // Предпросмотр дуги: одна линия, живёт всегда, показывается при замахе
    this.previewPositions = new Float32Array(40 * 3).fill(-999);
    const previewGeometry = new THREE.BufferGeometry();
    previewGeometry.setAttribute('position', new THREE.BufferAttribute(this.previewPositions, 3));
    this.previewLine = new THREE.Line(
      previewGeometry,
      new THREE.LineDashedMaterial({
        color: 0xffc45c,
        transparent: true,
        opacity: 0.95,
        dashSize: 0.14,
        gapSize: 0.1,
        depthTest: false,
      }),
    );
    this.previewLine.frustumCulled = false;
    this.previewLine.visible = false;
    this.previewLine.name = 'ball-preview';
    game.world?.scene.add(this.previewLine);
  }

  // ——— состояние, доступное тестам и отладке ——————————————————

  get heldBall(): boolean {
    return this.held;
  }

  get goalCount(): number {
    return this.goals;
  }

  get chargingPower(): number {
    return this.charge;
  }

  get missionActive(): boolean {
    return this.game.quests.isActive(MISSION_02.id);
  }

  get ballPosition(): THREE.Vector3 {
    return this.ball.pos;
  }

  get ballVelocity(): THREE.Vector3 {
    return this.ball.vel;
  }

  /** Тест и подсказки: сколько голов нужно. */
  get goalsTotal(): number {
    return RULES.total;
  }

  /** Восстановить состояние из сохранения (голы, статус миссии). */
  restore(): void {
    const state = this.game.quests.get(MISSION_02.id);
    const saved = state?.values?.[0];
    this.goals = typeof saved === 'number' && Number.isFinite(saved) ? clamp(Math.round(saved), 0, RULES.total) : 0;
    this.completed = this.game.quests.isCompleted(MISSION_02.id) || this.goals >= RULES.total;
    if (this.game.quests.isCompleted(MISSION_02.id)) this.goals = RULES.total;
    this.held = false;
    this.charging = false;
    this.charge = 0;
    this.ball.pos.copy(this.spawnPoint);
    this.ball.vel.set(0, 0, 0);
    this.ball.prevY = this.ball.pos.y;
    this.mesh.position.copy(this.ball.pos);
    this.hudGoals = -1;
    this.hudTask = '';
    this.hudState = '';
    this.refresh();
  }

  /** Перерисовать HUD (вход в игру). */
  refresh(): void {
    this.hudGoals = -1;
    this.hudTask = '';
    this.updateHud();
  }

  /** Выход из игры: убираем за собой подсказки и замах. */
  leave(): void {
    this.charging = false;
    this.testHold = false;
    this.charge = 0;
    this.setPrompt(null);
    this.game.ui.setMissionPower(null);
    this.previewLine.visible = false;
    if (this.ballPose !== 'none') this.setBallPose('none');
  }

  /** Кадр обычной игры: физика мяча, замах, подсказки, HUD. */
  update(dt: number): void {
    this.clock += dt;
    this.rimCooldown = Math.max(0, this.rimCooldown - dt);
    this.respawnFade = Math.max(0, this.respawnFade - dt);
    this.sparks.update(dt);
    this.saveTimer += dt;

    if (this.held) this.updateCharge(dt);
    // Замах мог закончиться броском прямо в этом кадре — тогда мяч уже в полёте
    if (this.held) {
      this.computeHandPoint();
      this.ball.pos.copy(this.handPoint);
      this.ball.vel.set(0, 0, 0);
      this.mesh.position.copy(this.handPoint);
    } else {
      this.advance(dt);
      this.checkBounds(dt);
    }

    this.updateThrowPose(dt);
    this.updateNet(dt);
    this.updateMesh();
    this.updateRings();
    this.updatePrompt();
    this.updatePreview();
    this.updateHud();

    if (this.saveTimer > 1.2) {
      this.saveTimer = 0;
      this.syncProgress();
    }
  }

  // ——— ввод ————————————————————————————————————————————————————

  /** Замах: ЛКМ (или удержание из автотеста). Отпускание — бросок. */
  private updateCharge(dt: number): void {
    const pressing = this.testHold || this.game.input.isMouseDown(0);
    if (pressing) {
      this.charging = true;
      this.charge = Math.min(1, this.charge + dt / RULES.chargeTime);
      return;
    }
    if (this.charging) {
      this.charging = false;
      this.throwBall(this.charge);
    }
  }

  /** Тест: заменить удержание ЛКМ (тот же путь, что и у игрока). */
  holdCharge(active: boolean): void {
    this.testHold = active;
  }

  /** Бросок по фактическому заряду. Возвращает начальную скорость (для тестов). */
  throwBall(charge: number): THREE.Vector3 {
    const dir = this.aimDirection(this.scratchDir);
    const power = clamp(charge, 0, 1);
    const speed = this.shotSpeed(power, dir);
    this.computeHandPoint();
    this.ball.pos.copy(this.handPoint).addScaledVector(dir, RULES.releaseOffset);
    this.ball.vel.copy(dir).multiplyScalar(speed);
    this.ball.prevX = this.ball.pos.x;
    this.ball.prevY = this.ball.pos.y;
    this.ball.prevZ = this.ball.pos.z;
    this.ball.spinAxis.set(-dir.z, 0, dir.x).normalize();
    this.ball.spinSpeed = speed / RULES.radius;
    this.held = false;
    this.charging = false;
    this.charge = 0;
    this.testHold = false;
    this.pendingGoal = false;
    this.missPending = true;
    this.ball.grace = RULES.releaseGrace;
    this.throwTimer = RULES.throwDuration;
    this.setBallPose('throw', 0);
    this.game.ui.setMissionPower(null);
    this.game.audio.playThrow(power);
    this.game.quests.setStep(MISSION_02.id, 'goals');
    this.game.bus.emit('ball:throw', { id: MISSION_02.id });
    this.previewLine.visible = false;
    this.setPrompt(null);
    return this.ball.vel;
  }

  /** Промах по дальности при данной скорости: + перелёт, − недолёт (метры). */
  private rimMissForSpeed(speed: number, direction: THREE.Vector3): number {
    const center = this.hoop.center;
    const sim = this.solverBody;
    sim.pos.copy(this.handPoint).addScaledVector(direction, RULES.releaseOffset);
    sim.vel.copy(direction).multiplyScalar(speed);
    sim.grace = RULES.releaseGrace;
    sim.prevX = sim.pos.x;
    sim.prevY = sim.pos.y;
    sim.prevZ = sim.pos.z;
    const horizontalLength = Math.hypot(direction.x, direction.z);
    if (horizontalLength < 1e-4) return -9;
    const hx = direction.x / horizontalLength;
    const hz = direction.z / horizontalLength;
    const step = 1 / 120;
    for (let i = 0; i < 480; i += 1) {
      this.stepBody(sim, step, false);
      if (sim.prevY > center.y && sim.pos.y <= center.y) {
        const t = (sim.prevY - center.y) / Math.max(1e-6, sim.prevY - sim.pos.y);
        const crossX = sim.prevX + (sim.pos.x - sim.prevX) * t;
        const crossZ = sim.prevZ + (sim.pos.z - sim.prevZ) * t;
        return (crossX - center.x) * hx + (crossZ - center.z) * hz;
      }
      if (sim.pos.y < center.y - 2.5) break;
    }
    return -9;
  }

  /** Точная скорость, при которой мяч проходит через центр кольца (null — не достать).
   *  Сначала аналитическая оценка, потом 2–3 уточнения той же физикой: так учитывается
   *  сопротивление воздуха и помощь прицелу, и «идеальный» бросок действительно попадает. */
  private solveRimSpeed(direction: THREE.Vector3): number | null {
    this.computeHandPoint();
    const release = this.scratchRelease.copy(this.handPoint).addScaledVector(direction, RULES.releaseOffset);
    const center = this.hoop.center;
    const dx = center.x - release.x;
    const dz = center.z - release.z;
    const horizontalLength = Math.hypot(direction.x, direction.z);
    if (horizontalLength < 1e-4) return null;
    const hx = direction.x / horizontalLength;
    const hz = direction.z / horizontalLength;
    // Боковая ошибка прицела: насколько линия броска проходит мимо кольца
    const lateral = Math.abs(dx * hz - dz * hx);
    if (lateral > RULES.snapAimRadius) return null;
    const along = dx * hx + dz * hz;
    if (along < 1.2) return null;
    const elevation = Math.asin(clamp(direction.y, -1, 1));
    const cos = Math.cos(elevation);
    const tan = Math.tan(elevation);
    const deltaY = center.y - release.y;
    const denominator = 2 * cos * cos * (along * tan - deltaY);
    if (denominator <= 0.01) return null;
    let speed = Math.sqrt((RULES.gravity * along * along) / denominator);
    if (!Number.isFinite(speed)) return null;
    speed = clamp(speed, 4, 22);
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const miss = this.rimMissForSpeed(speed, direction);
      if (miss < -8) return null;
      if (Math.abs(miss) < 0.015) break;
      // Дальность растёт как квадрат скорости — отсюда и поправка
      speed = clamp(speed * Math.sqrt(along / Math.max(0.4, along + miss)), 4, 22);
    }
    return speed;
  }

  /** Скорость броска: точная при попадании в окно силы, иначе честная по заряду. */
  private shotSpeed(charge: number, direction: THREE.Vector3): number {
    const raw = RULES.minSpeed + (RULES.maxSpeed - RULES.minSpeed) * clamp(charge, 0, 1);
    const perfect = this.solveRimSpeed(direction);
    if (perfect !== null && Math.abs(raw - perfect) <= RULES.snapTolerance) return perfect;
    return raw;
  }

  /** Окно силы, в котором бросок доводится до кольца, — для индикатора в HUD. */
  shotWindow(): { from: number; to: number } | null {
    const direction = this.aimDirection(this.scratchDir);
    const perfect = this.solveRimSpeed(direction);
    if (perfect === null) return null;
    const span = RULES.maxSpeed - RULES.minSpeed;
    const center = (perfect - RULES.minSpeed) / span;
    const half = RULES.snapTolerance / span;
    return { from: Math.max(0, center - half), to: Math.min(1, center + half) };
  }

  /** Куда полетит мяч: горизонталь — по камере, угол — по наклону камеры. */
  aimDirection(target = new THREE.Vector3()): THREE.Vector3 {
    const cam = this.game.thirdPersonCamera;
    const elevation = clamp(
      RULES.elevationBase - cam.pitch * RULES.elevationGain,
      RULES.minElevation,
      RULES.maxElevation,
    );
    const horizontal = Math.cos(elevation);
    return target.set(-Math.sin(cam.yaw) * horizontal, Math.sin(elevation), -Math.cos(cam.yaw) * horizontal).normalize();
  }

  // ——— физика ——————————————————————————————————————————————————

  /** Прогнать физику вперёд фиксированным шагом. */
  private advance(dt: number): void {
    let remaining = Math.min(dt, RULES.maxFrame);
    while (remaining > 0) {
      const step = Math.min(RULES.step, remaining);
      this.stepBody(this.ball, step, true);
      remaining -= step;
    }
  }

  /** Один шаг сферы: гравитация, подшаг перемещения и все столкновения. */
  private stepBody(body: Body, dt: number, live: boolean): void {
    body.grace = Math.max(0, body.grace - dt);
    body.prevX = body.pos.x;
    body.prevY = body.pos.y;
    body.prevZ = body.pos.z;
    body.vel.y -= RULES.gravity * dt;
    body.vel.multiplyScalar(Math.exp(-RULES.airDrag * dt));
    body.pos.addScaledVector(body.vel, dt);
    this.collideGround(body, dt, live);
    this.assistAim(body, dt);
    this.collideRim(body, live);
    this.collideBoard(body, live);
    this.collideWorld(body, live);
    this.collidePlayer(body, live);
    this.collideNet(body, dt);
    if (live) this.detectScore(body);
  }

  private collideGround(body: Body, dt: number, live: boolean): void {
    const groundY = this.island.groundHeightAt(body.pos.x, body.pos.z);
    if (body.pos.y - RULES.radius > groundY) return;
    body.pos.y = groundY + RULES.radius;
    if (body.vel.y >= 0) return;
    const impact = -body.vel.y;
    body.vel.y = impact * RULES.restitutionGround;
    if (impact < 0.9) body.vel.y = 0;
    // Трение качения: мяч катится и останавливается, а не скользит вечно
    const friction = Math.exp(-RULES.rollingFriction * dt);
    body.vel.x *= friction;
    body.vel.z *= friction;
    const speed = Math.hypot(body.vel.x, body.vel.z);
    if (speed < 0.18) {
      body.vel.x = 0;
      body.vel.z = 0;
    }
    body.spinSpeed = speed / RULES.radius;
    if (speed > 0.001) body.spinAxis.set(-body.vel.z / speed, 0, body.vel.x / speed).normalize();
    if (live && impact > 0.8) {
      this.game.audio.playBounce(Math.min(1, impact / 5));
      this.onBallLanded();
    }
  }

  /** Мягкая помощь прицелу: мяч, идущий вниз прямо над кольцом, слегка подтягивается
   *  к центру. Работает только в узком объёме над дужкой, поэтому «чужие» броски
   *  не трогает, а честный бросок с малым промахом не наказывает за 2 см. */
  private assistAim(body: Body, dt: number): void {
    const center = this.hoop.center;
    const above = body.pos.y - center.y;
    if (above <= 0 || above > RULES.assistHeight) return;
    if (body.vel.y > -0.8) return;
    const dx = body.pos.x - center.x;
    const dz = body.pos.z - center.z;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > RULES.assistRadius || horizontal < 1e-4) return;
    const falloff = 1 - horizontal / RULES.assistRadius;
    const pull = RULES.assistStrength * falloff * dt;
    body.vel.x -= (dx / horizontal) * pull;
    body.vel.z -= (dz / horizontal) * pull;
  }

  private collideRim(body: Body, live: boolean): void {
    const center = this.hoop.center;
    let dx = body.pos.x - center.x;
    let dz = body.pos.z - center.z;
    let horizontal = Math.hypot(dx, dz);
    if (horizontal < 1e-5) {
      dx = 1;
      dz = 0;
      horizontal = 1;
    }
    const nearX = center.x + (dx / horizontal) * this.hoop.radius;
    const nearZ = center.z + (dz / horizontal) * this.hoop.radius;
    const nx = body.pos.x - nearX;
    const ny = body.pos.y - center.y;
    const nz = body.pos.z - nearZ;
    const distance = Math.hypot(nx, ny, nz);
    const limit = RULES.radius + this.hoop.tube;
    if (distance >= limit || distance < 1e-6) return;
    const inv = 1 / distance;
    const ux = nx * inv;
    const uy = ny * inv;
    const uz = nz * inv;
    body.pos.set(nearX + ux * limit, center.y + uy * limit, nearZ + uz * limit);
    const vn = body.vel.x * ux + body.vel.y * uy + body.vel.z * uz;
    if (vn >= 0) return;
    const k = (1 + RULES.restitutionRim) * vn;
    body.vel.x -= k * ux;
    body.vel.y -= k * uy;
    body.vel.z -= k * uz;
    if (live && this.rimCooldown <= 0 && Math.abs(vn) > 0.8) {
      this.rimCooldown = 0.7;
      this.game.audio.playRim();
      this.showEvent(BALL_TEXTS.rim, 1.2);
    }
  }

  private collideBoard(body: Body, live: boolean): void {
    const board = this.hoop.board;
    const px = clamp(body.pos.x, board.minX, board.maxX);
    const py = clamp(body.pos.y, board.minY, board.maxY);
    const pz = clamp(body.pos.z, board.minZ, board.maxZ);
    const nx = body.pos.x - px;
    const ny = body.pos.y - py;
    const nz = body.pos.z - pz;
    const distance = Math.hypot(nx, ny, nz);
    if (distance >= RULES.radius) return;

    let ux: number;
    let uy: number;
    let uz: number;
    if (distance > 1e-6) {
      const inv = 1 / distance;
      ux = nx * inv;
      uy = ny * inv;
      uz = nz * inv;
      body.pos.set(px + ux * RULES.radius, py + uy * RULES.radius, pz + uz * RULES.radius);
    } else {
      // Центр сферы внутри щита: выталкиваем по ближайшей грани
      const toMinX = body.pos.x - board.minX;
      const toMaxX = board.maxX - body.pos.x;
      const toMinY = body.pos.y - board.minY;
      const toMaxY = board.maxY - body.pos.y;
      const toMinZ = body.pos.z - board.minZ;
      const toMaxZ = board.maxZ - body.pos.z;
      const smallest = Math.min(toMinX, toMaxX, toMinY, toMaxY, toMinZ, toMaxZ);
      ux = 0;
      uy = 0;
      uz = 0;
      if (smallest === toMinX) {
        ux = -1;
        body.pos.x = board.minX - RULES.radius;
      } else if (smallest === toMaxX) {
        ux = 1;
        body.pos.x = board.maxX + RULES.radius;
      } else if (smallest === toMinY) {
        uy = -1;
        body.pos.y = board.minY - RULES.radius;
      } else if (smallest === toMaxY) {
        uy = 1;
        body.pos.y = board.maxY + RULES.radius;
      } else if (smallest === toMinZ) {
        uz = -1;
        body.pos.z = board.minZ - RULES.radius;
      } else {
        uz = 1;
        body.pos.z = board.maxZ + RULES.radius;
      }
    }
    const vn = body.vel.x * ux + body.vel.y * uy + body.vel.z * uz;
    if (vn >= 0) return;
    const k = (1 + RULES.restitutionBoard) * vn;
    body.vel.x -= k * ux;
    body.vel.y -= k * uy;
    body.vel.z -= k * uz;
    if (live) this.game.audio.playBounce(0.6);
  }

  /** Стены, забор, опора кольца: те же призмы, что и у героя. */
  private collideWorld(body: Body, live: boolean): void {
    const solved = this.island.collisions.resolve(body.pos.x, body.pos.z, RULES.radius, body.pos.y);
    const dx = solved.x - body.pos.x;
    const dz = solved.z - body.pos.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    body.pos.x = solved.x;
    body.pos.z = solved.z;
    const ux = dx / length;
    const uz = dz / length;
    const vn = body.vel.x * ux + body.vel.z * uz;
    if (vn >= 0) return;
    const k = (1 + RULES.restitutionWorld) * vn;
    body.vel.x -= k * ux;
    body.vel.z -= k * uz;
    if (live) this.game.audio.playBounce(Math.min(1, Math.abs(vn) / 5));
  }

  /** Герой — честное препятствие: мяч от него отскакивает. */
  private collidePlayer(body: Body, live: boolean): void {
    if (body.grace > 0) return;
    const feet = this.game.player.position;
    const dy = body.pos.y - feet.y;
    if (dy < -0.15 || dy > 1.82) return;
    const dx = body.pos.x - feet.x;
    const dz = body.pos.z - feet.z;
    const distance = Math.hypot(dx, dz);
    const limit = this.game.player.radius + RULES.radius;
    if (distance >= limit) return;
    const ux = distance < 1e-5 ? 1 : dx / distance;
    const uz = distance < 1e-5 ? 0 : dz / distance;
    body.pos.x = feet.x + ux * limit;
    body.pos.z = feet.z + uz * limit;
    const vn = body.vel.x * ux + body.vel.z * uz;
    if (vn < 0) {
      const k = (1 + RULES.restitutionPlayer) * vn;
      body.vel.x -= k * ux;
      body.vel.z -= k * uz;
    }
    if (live) this.game.audio.playBounce(0.35);
  }

  /** Сетка: гасит мяч и не даёт пролететь сквозь полотно. */
  private collideNet(body: Body, dt: number): void {
    const center = this.hoop.center;
    const dy = body.pos.y - center.y;
    if (dy > 0.02 || dy < -0.5) return;
    const horizontal = Math.hypot(body.pos.x - center.x, body.pos.z - center.z);
    if (horizontal > 0.22) return;
    const damping = Math.exp(-9 * dt);
    body.vel.x *= damping;
    body.vel.z *= damping;
    body.vel.y *= Math.exp(-3.5 * dt);
  }

  /** Пересечение плоскости кольца «сверху вниз, мяч целиком внутри» — чистая проверка.
   *  Её же использует предпросмотр броска и автотест, чтобы «зачёт» был один на всех. */
  private crossesRim(body: Body): boolean {
    const center = this.hoop.center;
    if (!(body.prevY > center.y && body.pos.y <= center.y)) return false;
    if (body.vel.y > -0.5) return false;
    const span = body.prevY - body.pos.y;
    if (span < 1e-6) return false;
    const t = (body.prevY - center.y) / span;
    const crossX = body.prevX + (body.pos.x - body.prevX) * t;
    const crossZ = body.prevZ + (body.pos.z - body.prevZ) * t;
    const clearance = this.hoop.radius - this.hoop.tube - RULES.radius + RULES.scoreTolerance;
    return Math.hypot(crossX - center.x, crossZ - center.z) <= clearance;
  }

  /** Предсказание броска той же физикой, но без последствий для игры.
   *  Нужно подсказкам, автотесту и будущему «прицелу» — считает один код. */
  predictThrow(charge: number): { scores: boolean; landX: number; landY: number; landZ: number } {
    const dir = this.aimDirection(this.scratchDir);
    const speed = this.shotSpeed(charge, dir);
    const sim = this.sim;
    sim.pos.copy(this.handPoint).addScaledVector(dir, RULES.releaseOffset);
    sim.vel.copy(dir).multiplyScalar(speed);
    sim.grace = RULES.releaseGrace;
    sim.prevX = sim.pos.x;
    sim.prevY = sim.pos.y;
    sim.prevZ = sim.pos.z;
    let scores = false;
    for (let i = 0; i < 900; i += 1) {
      this.stepBody(sim, RULES.step, false);
      if (this.crossesRim(sim)) {
        scores = true;
        break;
      }
      if (sim.pos.y < this.island.court.slabTopY - 1) break;
    }
    return { scores, landX: sim.pos.x, landY: sim.pos.y, landZ: sim.pos.z };
  }

  /** Трассировка дуги той же физикой (отладка, тесты, предпросмотр прицела). */
  predictTrace(charge: number, maxSeconds = 3): number[] {
    const dir = this.aimDirection(this.scratchDir);
    const speed = this.shotSpeed(charge, dir);
    const sim = this.sim;
    sim.pos.copy(this.handPoint).addScaledVector(dir, RULES.releaseOffset);
    sim.vel.copy(dir).multiplyScalar(speed);
    sim.grace = RULES.releaseGrace;
    sim.prevX = sim.pos.x;
    sim.prevY = sim.pos.y;
    sim.prevZ = sim.pos.z;
    const points: number[] = [];
    const steps = Math.round(maxSeconds / RULES.step);
    for (let i = 0; i < steps; i += 1) {
      this.stepBody(sim, RULES.step, false);
      if (i % 4 === 0) points.push(sim.pos.x, sim.pos.y, sim.pos.z);
    }
    return points.map((value) => Number(value.toFixed(3)));
  }

  /** Взять мяч, если он рядом (то же, что клавиша E, но доступно из тестов). */
  pickUp(): boolean {
    if (this.held) return true;
    const feet = this.game.player.position;
    const distance = Math.hypot(feet.x - this.ball.pos.x, feet.z - this.ball.pos.z);
    if (distance > RULES.pickupReach + 0.6) return false;
    this.takeBall();
    return true;
  }

  /** Гол: пересечение плоскости кольца сверху вниз, мяч целиком внутри. */
  private detectScore(body: Body): void {
    const center = this.hoop.center;

    if (this.pendingGoal) {
      const horizontal = Math.hypot(body.pos.x - center.x, body.pos.z - center.z);
      if (body.pos.y < center.y - RULES.goalConfirmDepth) {
        this.pendingGoal = false;
        if (horizontal < 0.4) this.countGoal();
      } else if (body.pos.y > center.y + 0.22 || horizontal > 0.55) {
        this.pendingGoal = false;
      }
      return;
    }

    if (!this.crossesRim(body)) return;
    this.pendingGoal = true;
    this.game.audio.playSwish();
  }

  private countGoal(): void {
    if (this.game.quests.isCompleted(MISSION_02.id)) {
      this.game.audio.playGoal(false);
      return;
    }
    this.goals = Math.min(RULES.total, this.goals + 1);
    this.pendingGoal = false;
    this.missPending = false;
    this.netWobble = 1;
    this.sparks.burst(this.hoop.center, 20);
    this.game.audio.playGoal(this.goals >= RULES.total);
    this.game.ui.toast(this.goals >= RULES.total ? BALL_TEXTS.goalSecond : BALL_TEXTS.goal, 'success');
    this.showEvent(BALL_TEXTS.stateScored, 1.6);
    this.game.bus.emit('ball:scored', { goals: this.goals, total: RULES.total });
    this.syncProgress();
    if (this.goals >= RULES.total) this.completeMission();
    this.updateHud();
  }

  private completeMission(): void {
    if (this.completed) return;
    this.completed = true;
    const quests = this.game.quests;
    quests.setProgress(MISSION_02.id, 1, [this.goals]);
    quests.complete(MISSION_02.id);
    this.game.ui.flashMission(BALL_TEXTS.missionDone, 'success');
    this.flashUntil = performance.now() + 2600;
    this.hudGoals = -1;
    this.updateHud();
  }

  /** Мяч приземлился: если это был бросок без гола — подсказываем «мимо». */
  private onBallLanded(): void {
    if (!this.missPending) return;
    if (this.pendingGoal) return;
    this.missPending = false;
    this.showEvent(BALL_TEXTS.stateMiss, 2);
    this.game.bus.emit('ball:missed', { goals: this.goals });
  }

  /** Вылет за площадку: через 5 с мяч мягко возвращается на точку. */
  private checkBounds(dt: number): void {
    const bounds = this.island.court.bounds;
    const water = this.island.court.slabTopY - 0.8;
    const pos = this.ball.pos;
    const outside =
      pos.x < bounds.minX - RULES.respawnMargin ||
      pos.x > bounds.maxX + RULES.respawnMargin ||
      pos.z < bounds.minZ - RULES.respawnMargin ||
      pos.z > bounds.maxZ + RULES.respawnMargin ||
      pos.y < water;
    if (!outside) {
      this.outTimer = 0;
      return;
    }
    this.outTimer += dt;
    if (this.outTimer < RULES.respawnDelay) return;
    this.respawn();
  }

  private respawn(): void {
    this.outTimer = 0;
    this.pendingGoal = false;
    this.missPending = false;
    this.ball.pos.copy(this.spawnPoint);
    this.ball.vel.set(0, 0, 0);
    this.ball.prevY = this.ball.pos.y;
    this.mesh.position.copy(this.ball.pos);
    this.respawnFade = 0.4;
    this.game.ui.toast(BALL_TEXTS.ballBack, 'info');
    this.game.audio.playPickup();
  }

  // ——— визуал ————————————————————————————————————————————————

  private updateMesh(): void {
    this.mesh.position.copy(this.ball.pos);
    const spin = this.ball.spinSpeed * 0.016;
    if (this.held) {
      this.ball.spinSpeed = 0;
      this.mesh.scale.setScalar(this.respawnFade > 0 ? 0.2 + 0.8 * (1 - this.respawnFade / 0.4) : 1);
      return;
    }
    this.mesh.scale.setScalar(this.respawnFade > 0 ? 0.35 + 0.65 * (1 - this.respawnFade / 0.4) : 1);
    if (spin > 0.0001) this.mesh.rotateOnWorldAxis(this.ball.spinAxis, spin);
    this.ball.spinSpeed *= 0.999;
  }

  private updateNet(dt: number): void {
    if (this.netWobble <= 0) {
      this.net.position.y = this.netBaseY;
      return;
    }
    this.netWobble = Math.max(0, this.netWobble - dt * 1.4);
    const wobble = Math.sin(this.clock * 26) * 0.05 * this.netWobble;
    this.net.position.y = this.netBaseY - Math.abs(wobble) - 0.03 * this.netWobble;
    this.net.rotation.y = wobble * 0.6;
  }

  private updateRings(): void {
    const active = this.missionActive;
    const pulse = 0.26 + Math.sin(this.clock * 4.4) * 0.12;
    // Кольцо под мячом: подсвечивает предмет, пока мяч не в руках
    const showBallRing = active && !this.held;
    this.ballRing.visible = showBallRing;
    if (showBallRing) {
      const groundY = this.island.groundHeightAt(this.ball.pos.x, this.ball.pos.z);
      this.ballRing.position.set(this.ball.pos.x, groundY + 0.012, this.ball.pos.z);
      (this.ballRing.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
    this.hoopGlow.visible = active && !this.completed;
    if (this.hoopGlow.visible) {
      (this.hoopGlow.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(this.clock * 3.2) * 0.1;
    }
  }

  private updatePreview(): void {
    const show = this.held && this.charging;
    if (!show) {
      this.previewLine.visible = false;
      return;
    }
    const charge = this.charge;
    const direction = this.aimDirection(this.scratchDir);
    const speed = this.shotSpeed(charge, direction);
    const sim = this.sim;
    sim.pos.copy(this.handPoint).addScaledVector(direction, RULES.releaseOffset);
    sim.vel.copy(direction).multiplyScalar(speed);
    sim.grace = RULES.releaseGrace;
    sim.prevY = sim.pos.y;

    let index = 0;
    const samples = this.previewPositions.length / 3;
    let lastX = sim.pos.x;
    let lastY = sim.pos.y;
    let lastZ = sim.pos.z;
    for (let step = 0; step < 800 && index < samples; step += 1) {
      this.stepBody(sim, RULES.step, false);
      if (step % 8 === 0) {
        const base = index * 3;
        this.previewPositions[base] = sim.pos.x;
        this.previewPositions[base + 1] = sim.pos.y;
        this.previewPositions[base + 2] = sim.pos.z;
        lastX = sim.pos.x;
        lastY = sim.pos.y;
        lastZ = sim.pos.z;
        index += 1;
      }
      // Дуга заканчивается там, где мяч падает на пол или гаснет в сетке
      if (sim.vel.y < 0 && sim.pos.y < this.island.groundHeightAt(sim.pos.x, sim.pos.z) + RULES.radius + 0.01) break;
    }
    for (let i = index; i < samples; i += 1) {
      const base = i * 3;
      this.previewPositions[base] = lastX;
      this.previewPositions[base + 1] = lastY;
      this.previewPositions[base + 2] = lastZ;
    }
    this.previewLine.geometry.setDrawRange(0, Math.max(2, index));
    this.previewLine.geometry.getAttribute('position').needsUpdate = true;
    this.previewLine.computeLineDistances();
    this.previewLine.visible = true;
    this.game.ui.setMissionPower(charge, this.shotWindow());
  }

  /** Точка, где мяч висит в руках: между кистями, чуть впереди груди. */
  private computeHandPoint(): void {
    const character = this.game.character;
    if (!character) return;
    character.group.updateMatrixWorld(true);
    const right = character.rig.bones.get('hand_r');
    const left = character.rig.bones.get('hand_l');
    if (!right || !left) return;
    right.getWorldPosition(this.scratchA);
    left.getWorldPosition(this.scratchB);
    this.handPoint.copy(this.scratchA).add(this.scratchB).multiplyScalar(0.5);
    const yaw = this.game.player.yaw;
    this.camForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.handPoint.addScaledVector(this.camForward, 0.2);
  }

  private updateThrowPose(dt: number): void {
    if (this.throwTimer > 0) {
      this.throwTimer = Math.max(0, this.throwTimer - dt);
      const phase = 1 - this.throwTimer / RULES.throwDuration;
      this.setBallPose('throw', phase);
      if (this.throwTimer === 0) this.setBallPose('none');
      return;
    }
    if (this.held) this.setBallPose('hold');
  }

  private setBallPose(mode: 'none' | 'hold' | 'throw', phase = 0): void {
    if (mode === this.ballPose && Math.abs(phase - this.ballPosePhase) < 0.02) return;
    this.ballPose = mode;
    this.ballPosePhase = phase;
    this.game.character?.setBall(mode, phase);
  }

  // ——— подсказки и HUD ————————————————————————————————————————

  private updatePrompt(): void {
    if (this.held) {
      this.setPrompt(this.game.t(BALL_TEXTS.promptLetGo, BALL_TEXTS.promptLetGoTouch));
      return;
    }
    if (this.game.machine.current !== 'playing') {
      this.setPrompt(null);
      return;
    }
    const feet = this.game.player.position;
    const distance = Math.hypot(feet.x - this.ball.pos.x, feet.z - this.ball.pos.z);
    const speed = this.ball.vel.length();
    const reachable = distance < RULES.pickupReach && speed < RULES.pickupSpeed && Math.abs(feet.y - this.ball.pos.y) < 2.2;
    if (reachable) {
      this.setPrompt(this.game.t(BALL_TEXTS.promptBall, BALL_TEXTS.promptBallTouch));
      if (this.game.input.wasPressed('KeyE')) this.takeBall();
    } else if (this.outTimer > 0) {
      this.setPrompt(BALL_TEXTS.promptReturn);
    } else {
      this.setPrompt(null);
    }
  }

  private takeBall(): void {
    if (this.held) return;
    this.held = true;
    this.charge = 0;
    this.charging = false;
    this.outTimer = 0;
    this.pendingGoal = false;
    this.missPending = false;
    this.ball.vel.set(0, 0, 0);
    this.setBallPose('hold');
    this.game.audio.playPickup();
    this.game.ui.toast(BALL_TEXTS.picked, 'info');
    this.game.quests.setStep(MISSION_02.id, 'goals');
    this.game.bus.emit('item:pickup', { item: 'ball' });
    this.setPrompt(null);
    this.updateHud();
  }

  private setPrompt(text: string | null): void {
    if (text === this.promptText) return;
    this.promptText = text;
    this.game.ui.setMissionPrompt(text);
  }

  private showEvent(text: string, seconds: number): void {
    this.eventText = text;
    this.eventUntil = this.clock + seconds;
  }

  private stateText(): string {
    if (this.clock < this.eventUntil) return this.eventText;
    if (this.completed) return BALL_TEXTS.goalSecond;
    if (this.held) {
      if (!this.charging) return BALL_TEXTS.stateHeld;
      return this.game.t(BALL_TEXTS.stateCharging, BALL_TEXTS.stateChargingTouch);
    }
    if (this.outTimer > 0) return BALL_TEXTS.stateReturning;
    if (this.ball.vel.length() > 0.5) return BALL_TEXTS.stateFlying;
    return BALL_TEXTS.stateIdle;
  }

  private updateHud(): void {
    const ui = this.game.ui;
    const quests = this.game.quests;
    const focused = quests.focused;
    const showMission = focused?.id === MISSION_02.id;
    // Когда все миссии закрыты, полоса голов остаётся как итог
    const showBar = showMission || (!focused && quests.isCompleted(MISSION_02.id));

    // После победы плашка держит «Миссия выполнена», но полосу голов обновляем всегда
    const flashing = performance.now() < this.flashUntil;
    if (showMission && !flashing && !this.completed) {
      const view = quests.view(MISSION_02.id);
      if (view) {
        const key = `${view.task}|${view.hint}|${view.stepLabel}`;
        if (key !== this.hudTask) {
          this.hudTask = key;
          ui.setMissionTask(view.task, view.hint, view.stepLabel);
        }
      }
    }

    // Когда миссий не осталось, пустая плашка не висит
    if (!showMission && !flashing && this.hudTask !== '__none__') {
      this.hudTask = '__none__';
      ui.setMissionTask(null);
    }

    if (!showBar) {
      if (this.hudGoals !== -1) {
        this.hudGoals = -1;
        this.hudState = '';
      }
      return;
    }

    const percent = (this.goals / RULES.total) * 100;
    const state = this.stateText();
    if (this.goals !== this.hudGoals || state !== this.hudState) {
      this.hudGoals = this.goals;
      this.hudState = state;
      ui.setMissionRoom(percent, state, BALL_TEXTS.goalsLabel, `${this.goals} / ${RULES.total}`);
    }
  }

  /** Прогресс миссии: голы уходят в сохранение как число в массиве values. */
  private syncProgress(): void {
    const quests = this.game.quests;
    if (!quests.get(MISSION_02.id)) return;
    if (quests.isCompleted(MISSION_02.id)) return;
    quests.setProgress(MISSION_02.id, this.goals / RULES.total, [this.goals]);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
    this.texture.dispose();
    this.sparks.dispose();
    this.ballRing.geometry.dispose();
    (this.ballRing.material as THREE.Material).dispose();
    this.ballRing.removeFromParent();
    this.hoopGlow.geometry.dispose();
    (this.hoopGlow.material as THREE.Material).dispose();
    this.hoopGlow.removeFromParent();
    this.previewLine.geometry.dispose();
    (this.previewLine.material as THREE.Material).dispose();
    this.previewLine.removeFromParent();
  }
}
