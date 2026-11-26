import * as THREE from 'three';
import { clamp, damp } from '../core/MathUtils';
import { MISSION_01, PAINT_TEXTS } from '../data/quests';
import { PAINT, type PaintWall, type HeldRoller } from '../world/island/Renovation';
import type { Game } from './Game';

/** Механика первой миссии (задача 7): предметы, режим покраски, прогресс, звук.
 *  Правила — по `VISION.md §2`: полосы, валик вверх-вниз, запас краски, макание. */

const RULES = {
  /** С какого расстояния герой видит предмет и стену. */
  itemReach: 1.9,
  wallReach: 2.4,
  /** Насколько герой отходит от стены в режиме покраски. */
  standOff: 1.02,
  /** Валик идёт по высоте: доля высоты стены в секунду. */
  rollerSpeed: 0.6,
  /** Мышь (ЛКМ) ведёт валик: пиксель → доля высоты. */
  mouseScale: 0.0032,
  /** Прирост покрытия ячейки в секунду при полном контакте рукава. */
  paintRate: 9,
  /** Ёмкость рукава и банки в «площадях стены». */
  rollerCapacity: 0.55,
  canCapacity: 1.15,
  /** Полувысота контакта рукава по стене. */
  sleeveHalf: 0.048,
  /** Не чаще, чем раз в 0,7 с, прогресс уходит в сохранение. */
  saveEvery: 0.7,
} as const;

type Mode = 'walk' | 'paint';

/** Капли краски: дешёвая система точек, живёт всегда, оживает при покраске. */
class DropletSystem {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly count = 48;
  private cursor = 0;

  constructor(color: number) {
    this.positions = new Float32Array(this.count * 3).fill(-999);
    this.velocities = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.name = 'paint-droplets';
  }

  spawn(origin: THREE.Vector3, amount: number): void {
    const drops = Math.max(1, Math.round(amount));
    for (let i = 0; i < drops; i += 1) {
      const index = this.cursor % this.count;
      this.cursor += 1;
      const base = index * 3;
      this.positions[base] = origin.x - Math.random() * 0.12;
      this.positions[base + 1] = origin.y + (Math.random() - 0.5) * 0.2;
      this.positions[base + 2] = origin.z + (Math.random() - 0.5) * 0.2;
      this.velocities[base] = -(0.2 + Math.random() * 0.5);
      this.velocities[base + 1] = (Math.random() - 0.4) * 0.9;
      this.velocities[base + 2] = (Math.random() - 0.5) * 0.5;
      this.life[index] = 0.55 + Math.random() * 0.35;
    }
  }

  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < this.count; i += 1) {
      if (this.life[i] <= 0) continue;
      changed = true;
      this.life[i] -= dt;
      const base = i * 3;
      this.velocities[base + 1] -= 7.5 * dt;
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

export class PaintMission {
  private mode: Mode = 'walk';
  private readonly wall: PaintWall;
  private readonly rollerRest: THREE.Object3D;
  private readonly held: HeldRoller;

  private hasRoller = false;
  private hasPaint = false;
  private paintOnRoller = 0;
  private canPaint = RULES.canCapacity;

  private stripe = 4;
  private rollerY = 0.5;
  private walkPhase = 0;

  private promptText: string | null = null;
  private hudPercent = -1;
  private hudState = '';
  private hudTask = '';
  private flashUntil = 0;
  private saveTimer = 0;
  private dryHintCooldown = 0;
  private completed = false;
  /** Реплика «половина готова» звучит один раз за прохождение (задача 9). */
  private halfAnnounced = false;
  private readonly droplets: DropletSystem;
  private readonly rollerRing: THREE.Mesh;
  private readonly canRing: THREE.Mesh;
  /** Короткая анимация взятия: рука тянется к предмету. */
  private pickupTimer = 0;
  private clock = 0;

  private readonly handWorld = new THREE.Vector3();
  private readonly tipWorld = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  constructor(private readonly game: Game) {
    const renovation = game.world?.island.renovation;
    if (!renovation) throw new Error('Ремонт не построен: PaintMission создаётся после мира');
    this.wall = renovation.wall;
    this.rollerRest = renovation.rollerRest;
    this.held = renovation.rollerHeld;
    this.rollerRing = renovation.rollerRing;
    this.canRing = renovation.canRing;
    this.droplets = new DropletSystem(PAINT.color);
    game.world?.scene.add(this.droplets.points);
  }

  get painting(): boolean {
    return this.mode === 'paint';
  }

  /** Обновить HUD (вызывается при входе в игру и из состояний). */
  refresh(): void {
    this.hudPercent = -1;
    this.hudTask = '';
    this.refreshHud();
  }

  /** Выйти из режима покраски (пауза, меню). */
  leave(): void {
    this.exitPainting();
  }

  /** Восстановить состояние из сохранения (покраска, флаги предметов). */
  restore(): void {
    const quests = this.game.quests;
    const state = quests.get(MISSION_01.id);
    this.wall.setCoverage(state?.values);
    this.hasRoller = quests.hasFlag(MISSION_01.id, 'roller');
    this.hasPaint = quests.hasFlag(MISSION_01.id, 'paint');
    this.completed = quests.isCompleted(MISSION_01.id);
    this.paintOnRoller = this.hasRoller && !this.completed ? RULES.rollerCapacity * 0.55 : 0;
    this.halfAnnounced = this.wall.progress >= 0.5;
    this.canPaint = RULES.canCapacity;
    this.rollerRest.visible = !this.hasRoller;
    this.held.setVisible(this.hasRoller && !this.completed);
    this.held.setLoaded(this.paintOnRoller > 0.01);
    this.hudPercent = -1;
    this.hudState = '';
    this.refreshHud();
  }

  /** Кадр вне режима покраски: подсказки, взятие предметов, вход в покраску. */
  update(dt: number): void {
    const game = this.game;
    this.clock += dt;
    this.dryHintCooldown = Math.max(0, this.dryHintCooldown - dt);
    this.tickPickup(dt);
    this.wall.update(dt);
    this.droplets.update(dt);

    if (this.hasRoller && !this.completed) this.updateHeldInHand();

    if (game.machine.current !== 'playing') {
      this.setPrompt(null);
      return;
    }

    const near = this.completed
      ? { roller: false, can: false, wall: false }
      : this.proximity();

    let prompt: string | null = null;
    let action: (() => void) | null = null;

    if (near.roller) {
      prompt = game.t(PAINT_TEXTS.promptRoller, PAINT_TEXTS.promptRollerTouch);
      action = () => this.takeRoller();
    } else if (near.can) {
      prompt = game.t(PAINT_TEXTS.promptPaint, PAINT_TEXTS.promptPaintTouch);
      action = () => this.takePaint();
    } else if (near.wall) {
      if (this.hasRoller && this.hasPaint) {
        prompt = game.t(PAINT_TEXTS.promptWall, PAINT_TEXTS.promptWallTouch);
        action = () => this.enterPainting();
      } else {
        prompt = PAINT_TEXTS.promptWallNoRoller;
      }
    }

    this.setPrompt(prompt);
    this.updateRings(near.roller, near.can);
    if (action && game.input.wasPressed('KeyE')) action();

    this.refreshHud();
    this.saveTimer += dt;
    if (this.saveTimer > RULES.saveEvery) {
      this.saveTimer = 0;
      this.syncQuestProgress();
    }
  }

  /** Кадр в режиме покраски: валик, полосы, маска, звук. */
  updatePainting(dt: number, look: { x: number; y: number }): void {
    const game = this.game;
    const input = game.input;
    const player = game.player;
    const character = game.character;
    const island = game.world?.island;
    if (!character || !island) return;

    this.wall.update(dt);
    this.droplets.update(dt);
    this.dryHintCooldown = Math.max(0, this.dryHintCooldown - dt);

    if (input.wasPressed('KeyE')) {
      this.exitPainting();
      return;
    }
    if (input.wasPressed('KeyR')) this.dipRoller();

    // A/D — шаг к соседней полосе (A — к задней стене, D — к выходу)
    let stripeChanged = false;
    if (input.wasPressed('KeyA')) {
      this.stripe = Math.max(0, this.stripe - 1);
      stripeChanged = true;
    }
    if (input.wasPressed('KeyD')) {
      this.stripe = Math.min(PAINT.stripes - 1, this.stripe + 1);
      stripeChanged = true;
    }

    // Валик вверх-вниз: клавиши или мышь с зажатой ЛКМ
    let delta = input.axis('KeyS', 'KeyW') * RULES.rollerSpeed * dt;
    const mousePainting = input.isMouseDown(0);
    if (mousePainting) delta += -look.y * RULES.mouseScale;
    // Красит только реальное движение: упёршись в верх стены, валик не «натирает» ячейку
    const previousY = this.rollerY;
    this.rollerY = clamp(this.rollerY + delta, 0.015, 0.985);
    const travel = this.rollerY - previousY;
    const moving = Math.abs(travel) > 1e-6;

    // Герой едет к центру полосы боком
    const targetZ = this.wall.stripeCenterZ(this.stripe);
    const before = player.position.z;
    player.position.z = damp(player.position.z, targetZ, stripeChanged ? 16 : 9, dt);
    player.position.x = this.wall.center.x - RULES.standOff;
    player.position.y = island.floorY;
    const lateral = dt > 0 ? (player.position.z - before) / dt : 0;
    this.walkPhase += Math.abs(lateral) * dt * 7;
    character.setLocomotion(clamp(Math.abs(lateral) / 2.2, 0, 0.5), this.walkPhase);
    character.group.position.copy(player.position);
    character.group.rotation.y = player.yaw;
    character.setPainting(true, this.rollerY);

    // Точка контакта рукава со стеной
    this.tipWorld.set(
      this.wall.center.x,
      this.wall.baseY + 0.05 + this.rollerY * (this.wall.height - 0.1),
      this.wall.stripeCenterZ(this.stripe),
    );

    // Ручка валика — от кисти до точки на стене
    character.group.updateMatrixWorld(true);
    const hand = character.rig.bones.get('hand_r');
    if (hand) {
      hand.getWorldPosition(this.handWorld);
      this.held.setPose(this.handWorld, this.tipWorld);
    }

    // Покраска: рукав красит ячейки, которые перекрывает
    let painted = 0;
    const canPaintNow = this.paintOnRoller > 0.0005;
    if (moving && canPaintNow) {
      painted = this.paintAtTip(dt);
      if (painted > 0) {
        this.droplets.spawn(this.tipWorld, 2 + Math.abs(travel) * 260);
        this.paintOnRoller = Math.max(0, this.paintOnRoller - painted);
        this.held.setLoaded(this.paintOnRoller > 0.01);
        if (Math.random() < 0.09) game.audio.playSplat();
      }
    }
    if (!canPaintNow && moving && this.dryHintCooldown <= 0) {
      this.dryHintCooldown = 4;
      game.ui.toast(game.t(PAINT_TEXTS.noPaint, PAINT_TEXTS.noPaintTouch), 'warning');
      game.bus.emit('paint:dry', { id: MISSION_01.id });
    }

    // Половина стены: одноразовое событие для реплики (задача 9)
    const progress = this.wall.progress;
    if (!this.halfAnnounced && progress >= 0.5) {
      this.halfAnnounced = true;
      game.bus.emit('paint:progress', { id: MISSION_01.id, progress });
    }

    // Звук валика: громкость по скорости движения
    const intensity = moving && canPaintNow ? clamp(Math.abs(travel) / (RULES.rollerSpeed * dt + 1e-6), 0, 1) : 0;
    game.audio.setRollerIntensity(intensity * 0.9);

    // Камера всегда за спиной и смотрит на стену
    game.thirdPersonCamera.update(dt, player.position, island.collisions);

    if (this.wall.complete && !this.completed) this.completeWall();

    this.refreshHud();
    this.saveTimer += dt;
    if (this.saveTimer > RULES.saveEvery) {
      this.saveTimer = 0;
      this.syncQuestProgress();
    }
  }

  /** Подсветка предметов: кольцо на полу пульсирует, когда можно взять. */
  private updateRings(rollerNear: boolean, canNear: boolean): void {
    const pulse = 0.34 + Math.sin(this.clock * 4.2) * 0.14;
    for (const [ring, near] of [
      [this.rollerRing, rollerNear],
      [this.canRing, canNear],
    ] as const) {
      ring.visible = near;
      if (near) (ring.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  }

  /** Анимация взятия: 0,5 с рука вытянута к предмету. */
  private tickPickup(dt: number): void {
    if (this.pickupTimer <= 0) return;
    this.pickupTimer = Math.max(0, this.pickupTimer - dt);
    const progress = 1 - this.pickupTimer / 0.5;
    this.game.character?.setPainting(true, 0.12 + Math.sin(progress * Math.PI) * 0.35);
    if (this.pickupTimer === 0) this.game.character?.setPainting(false);
  }

  // ——— состояние ——————————————————————————————————————————————

  private paintAtTip(dt: number): number {
    const cellHeight = this.wall.height / PAINT.cells;
    const lowY = this.tipWorld.y - RULES.sleeveHalf - this.wall.baseY;
    const highY = this.tipWorld.y + RULES.sleeveHalf - this.wall.baseY;
    const lowCell = lowY / cellHeight;
    const highCell = highY / cellHeight;
    let gained = 0;
    for (let cell = Math.floor(lowCell); cell <= Math.floor(highCell); cell += 1) {
      if (cell < 0 || cell >= PAINT.cells) continue;
      const overlap = Math.min(highCell, cell + 1) - Math.max(lowCell, cell);
      if (overlap <= 0.001) continue;
      gained += this.wall.paintCell(this.stripe, cell, RULES.paintRate * overlap * dt);
    }
    return gained / (PAINT.stripes * PAINT.cells);
  }

  private dipRoller(): void {
    if (!this.hasPaint) return;
    const free = RULES.rollerCapacity - this.paintOnRoller;
    if (free <= 0.001) {
      this.game.audio.playDip();
      this.game.ui.toast('Валик и так полный', 'info');
      return;
    }
    const taken = Math.min(free, this.canPaint);
    if (taken <= 0.001) {
      this.game.ui.toast('В банке пусто — краски больше нет', 'warning');
      return;
    }
    this.canPaint -= taken;
    this.paintOnRoller += taken;
    this.held.setLoaded(true);
    this.game.audio.playDip();
    this.game.ui.toast(PAINT_TEXTS.dipped, 'success');
    this.hudState = '';
  }

  private enterPainting(): void {
    if (this.mode === 'paint') return;
    const game = this.game;
    const player = game.player;
    this.mode = 'paint';
    this.completed = false;

    // Встаём к ближайшей полосе
    const z = player.position.z;
    const stripeWidth = this.wall.width / PAINT.stripes;
    const index = Math.round((z - (this.wall.center.z - this.wall.width / 2)) / stripeWidth - 0.5);
    this.stripe = clamp(index, 0, PAINT.stripes - 1);

    player.position.set(this.wall.center.x - RULES.standOff, game.world?.island.floorY ?? player.position.y, this.wall.stripeCenterZ(this.stripe));
    player.yaw = -Math.PI / 2;
    player.speed = 0;
    player.speed01 = 0;
    game.character?.setPainting(true, this.rollerY);

    game.thirdPersonCamera.setYaw(-Math.PI / 2);
    game.thirdPersonCamera.snapTo(player.position, player.yaw, game.world?.island.collisions ?? null);
    game.thirdPersonCamera.zoom(-0.6);

    game.audio.startRoller();
    game.audio.setRollerIntensity(0);
    game.bus.emit('paint:started', { id: MISSION_01.id });
    game.ui.setHint(null);
    game.ui.setMissionControls(game.t(PAINT_TEXTS.painting, PAINT_TEXTS.paintingTouch));
    game.ui.setMissionPrompt(null);
    this.promptText = null;
  }

  private exitPainting(): void {
    if (this.mode !== 'paint') return;
    const game = this.game;
    this.mode = 'walk';
    game.audio.stopRoller();
    game.audio.setRollerIntensity(0);
    game.character?.setPainting(false);
    game.character?.setLocomotion(0, 0);
    game.ui.setMissionControls(null);
    game.ui.setHint(game.playHint);
    game.thirdPersonCamera.zoom(0.6);
    game.thirdPersonCamera.setYaw(game.player.yaw);
    this.syncQuestProgress();
    this.refreshHud();
  }

  private completeWall(): void {
    const game = this.game;
    this.completed = true;
    this.syncQuestProgress(1);
    this.exitPainting();
    this.held.setVisible(false);
    game.quests.complete(MISSION_01.id);
    game.bus.emit('paint:completed', { id: MISSION_01.id });
    game.ui.flashMission(PAINT_TEXTS.missionDone, 'success');
    this.flashUntil = performance.now() + 2600;
    game.ui.toast(PAINT_TEXTS.wallDone, 'success');
    this.hudPercent = -1;
    this.refreshHud();
  }

  private syncQuestProgress(force?: number): void {
    const quests = this.game.quests;
    if (!quests.get(MISSION_01.id)) return;
    const value = force ?? this.wall.progress;
    quests.setProgress(MISSION_01.id, value, this.wall.snapshot());
  }

  // ——— отображение ————————————————————————————————————————————

  private refreshHud(): void {
    const ui = this.game.ui;
    const focused = this.game.quests.focused;
    // После первой миссии HUD ведёт вторая (задача 8) — здесь руль не дублируем
    if (!focused || focused.id !== MISSION_01.id) {
      if (this.hudPercent !== -1) {
        this.hudPercent = -1;
        this.hudState = '';
        ui.setMissionRoom(null);
      }
      return;
    }
    const view = focused ? this.game.quests.view(focused.id) : null;
    // После «Миссия выполнена» даём плашке повисеть пару секунд, потом показываем следующую задачу
    if (performance.now() < this.flashUntil) return;
    if (view) {
      const taskKey = `${view.task}|${view.hint}|${view.stepLabel}`;
      if (taskKey !== this.hudTask) {
        this.hudTask = taskKey;
        ui.setMissionTask(view.task, view.hint, view.stepLabel);
      }
    } else if (this.hudTask !== '') {
      this.hudTask = '';
      ui.setMissionTask(null);
    }

    const percent = this.completed ? 100 : Math.round(this.wall.progress * 100);
    const state = this.stateText();
    if (percent !== this.hudPercent || state !== this.hudState) {
      this.hudPercent = percent;
      this.hudState = state;
      ui.setMissionRoom(this.hasPaint || this.completed || percent > 0 ? percent : null, state);
    }
  }

  private stateText(): string {
    if (this.completed) return PAINT_TEXTS.stateDone;
    if (!this.hasPaint) return 'краски нет';
    if (this.paintOnRoller <= 0.0005) return this.game.t(PAINT_TEXTS.stateDry, PAINT_TEXTS.stateDryTouch);
    if (this.paintOnRoller < 0.08) return PAINT_TEXTS.stateLow;
    return PAINT_TEXTS.stateLoaded;
  }

  private setPrompt(text: string | null): void {
    if (text === this.promptText) return;
    this.promptText = text;
    this.game.ui.setMissionPrompt(text);
  }

  private updateHeldInHand(): void {
    const character = this.game.character;
    if (!character) return;
    character.group.updateMatrixWorld(true);
    const hand = character.rig.bones.get('hand_r');
    if (!hand) return;
    hand.getWorldPosition(this.handWorld);
    this.forward.set(-Math.sin(this.game.player.yaw), 0, -Math.cos(this.game.player.yaw));
    this.tipWorld
      .copy(this.handWorld)
      .addScaledVector(this.forward, 0.4)
      .add(this.scratch.set(0, 0.92, 0));
    this.held.setPose(this.handWorld, this.tipWorld);
  }

  private proximity(): { roller: boolean; can: boolean; wall: boolean } {
    const island = this.game.world?.island;
    const position = this.game.player.position;
    if (!island) return { roller: false, can: false, wall: false };
    const renovation = island.renovation;
    const inside = Math.abs(position.y - island.floorY) < 1.2;

    const rollerDistance = Math.hypot(position.x - renovation.rollerSpot.x, position.z - renovation.rollerSpot.z);
    const canDistance = Math.hypot(position.x - renovation.canSpot.x, position.z - renovation.canSpot.z);
    const wallZ0 = this.wall.center.z - this.wall.width / 2;
    const wallZ1 = this.wall.center.z + this.wall.width / 2;
    const nearWall =
      inside &&
      !this.completed &&
      position.z > wallZ0 - 0.4 &&
      position.z < wallZ1 + 0.4 &&
      position.x < this.wall.center.x &&
      position.x > this.wall.center.x - RULES.wallReach;

    return {
      roller: inside && !this.hasRoller && rollerDistance < RULES.itemReach,
      can: inside && !this.hasPaint && canDistance < RULES.itemReach,
      wall: nearWall,
    };
  }

  private takeRoller(): void {
    if (this.hasRoller) return;
    this.hasRoller = true;
    this.paintOnRoller = RULES.rollerCapacity * 0.55;
    this.rollerRest.visible = false;
    this.held.setVisible(true);
    this.held.setLoaded(true);
    this.game.audio.playPickup();
    this.pickupTimer = 0.5;
    this.game.quests.setFlag(MISSION_01.id, 'roller');
    this.syncQuestStep();
    this.game.bus.emit('item:pickup', { item: 'roller' });
    this.game.ui.toast('Валик в руках', 'info');
    this.refreshHud();
  }

  private takePaint(): void {
    if (this.hasPaint) return;
    this.hasPaint = true;
    this.game.audio.playPickup();
    this.pickupTimer = 0.5;
    this.game.quests.setFlag(MISSION_01.id, 'paint');
    this.syncQuestStep();
    this.game.bus.emit('item:pickup', { item: 'paint' });
    this.game.ui.toast('Краска взята', 'info');
    this.refreshHud();
  }

  /** Шаги идут по факту: предметы можно брать в любом порядке. */
  private syncQuestStep(): void {
    const quests = this.game.quests;
    if (!quests.isActive(MISSION_01.id)) return;
    if (this.hasRoller && this.hasPaint) quests.setStep(MISSION_01.id, 'paint_wall');
    else if (this.hasRoller) quests.setStep(MISSION_01.id, 'take_paint');
    else quests.setStep(MISSION_01.id, 'take_roller');
  }

  dispose(): void {
    this.game.audio.stopRoller();
    this.droplets.dispose();
  }
}
