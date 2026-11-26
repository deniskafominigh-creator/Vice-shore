import * as THREE from 'three';
import { Assets, type LoadedAssets } from '../core/Assets';
import { AudioSystem } from '../core/Audio';
import { DEBUG, ISLAND, QUALITY_PRESETS, STADIUM, type QualityLevel } from '../core/Config';
import { EventBus } from '../core/EventBus';
import type { GameEventMap } from '../core/Events';
import { GameStateMachine } from '../core/GameStateMachine';
import { Input } from '../core/Input';
import { FullscreenController } from '../core/Fullscreen';
import { detectPlatform, resolveScheme, type ControlScheme } from '../core/Platform';
import { Loop } from '../core/Loop';
import { SaveGame } from '../core/SaveGame';
import { SettingsStore } from '../core/Settings';
import { Ui, type UiHandlers } from '../ui/Ui';
import { TouchControls } from '../ui/TouchControls';
import { DriftCamera, FreeCamera, InspectorCamera, ThirdPersonCamera } from '../world/Cameras';
import { World } from '../world/World';
import { auditScene, type AuditReport } from '../world/SceneAudit';
import { CHARACTER_POSES, Character, POSE_LABELS, type CharacterPose } from '../entities/character/Character';
import type { HeroCharacter } from '../entities/character/HeroCharacter';
import { loadRiggedHero } from '../entities/character/RiggedHero';
import { PlayerController, type MoveIntent } from '../entities/player/PlayerController';
import { createStates } from './states';
import { QuestSystem } from './QuestSystem';
import { DialogueSystem } from './DialogueSystem';
import { PaintMission } from './PaintMission';
import { BallMission } from './BallMission';
import { Football } from './Football';

const DEFAULT_BOUNDS = { minX: -13, maxX: 13, minZ: -10, maxZ: 10 } as const;

/** Подсказка под схему управления (задача 11). */
const HINTS = {
  keyboard:
    'WASD — идти · Shift — бег · Space — прыжок · у мяча держи Space — удар · мышь — обзор · Esc — пауза',
  touch:
    'Стик — идти · «ПРЫЖОК» — прыгать, у мяча держать — удар · свайп — обзор · «Держать» — красить и бросать · Ⓔ — действие · II — пауза',
} as const;

/** Где герой относительно стадиона (задача 16): подсказки при входе. */
type StadiumZone = 'outside' | 'plaza' | 'pitch';

/** Точка сборки всего: рендерер, мир, интерфейс, звук, состояния.
 *  Владеет ресурсами и освобождает их в dispose(). */
export class Game {
  readonly bus = new EventBus<GameEventMap>();
  readonly settings: SettingsStore;
  readonly save: SaveGame;
  readonly audio: AudioSystem;
  readonly input: Input;
  readonly ui: Ui;
  readonly machine: GameStateMachine;
  /** Миссии (задача 7): шаги, прогресс, сохранение. */
  readonly quests: QuestSystem;
  /** Первая миссия: предметы, покраска стены. Создаётся после сборки мира. */
  paintMission: PaintMission | null = null;
  /** Вторая миссия: мяч, бросок, два гола (задача 8). */
  ballMission: BallMission | null = null;
  /** Мяч на стадионе с физикой и счётом (задача 16). */
  football: Football | null = null;
  /** Идёт зарядка удара (Space зажали рядом с мячом). */
  private kickCharging = false;
  private stadiumZone: StadiumZone = 'outside';
  /** Билет куплен в кассе (необязательный шаг: пройти мимо можно). */
  private hasTicket = false;
  private boothPrompted = false;
  /** Герой уже на территории стадиона (для одноразового события входа). */
  private atStadium = false;
  /** Озвучка героя (задача 9). */
  dialogues: DialogueSystem | null = null;
  /** Определение устройства: телефон/планшет/компьютер (задача 11). */
  readonly platform = detectPlatform();
  /** Полноэкранный режим: обёртка над Fullscreen API. */
  readonly fullscreen = new FullscreenController();
  /** Сенсорное управление: живёт всегда, показывается на телефоне и планшете. */
  readonly touch: TouchControls;

  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly driftCamera: DriftCamera;
  readonly freeCamera: FreeCamera;
  readonly thirdPersonCamera: ThirdPersonCamera;
  /** Управляемый герой (задача 6). */
  readonly player = new PlayerController();

  world: World | null = null;
  /** Герой: привезённая GLB с анимациями, а если её нет — процедурная модель. */
  character: HeroCharacter | null = null;
  elapsed = 0;
  activeCamera: THREE.PerspectiveCamera;
  /** Режим осмотра модели (F3): камера у персонажа, скелет, тестовые позы. */
  inspectorActive = false;

  private readonly assets = new Assets();
  private readonly loop: Loop;
  private readonly inspectorCamera: InspectorCamera;
  /** Камера облёта для аудита сцены (задача 10). */
  private readonly auditCamera = new THREE.PerspectiveCamera(58, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 500);
  private inspectorSpin = 0;
  private wireframe = false;
  private readonly unsubscribers: Array<() => void> = [];
  private audioUnlockRequested = false;
  private shutdown = false;
  private debugStats = false;
  private statsTimer = 0;
  private statsFrames = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;

    // ——— данные игрока ——————————————————————————————————————————
    this.settings = new SettingsStore(this.bus);
    this.save = new SaveGame(this.bus);
    this.quests = new QuestSystem(this.save, this.bus);

    // ——— рендерер ————————————————————————————————————————————————
    const preset = QUALITY_PRESETS[this.settings.get('quality')];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ——— камеры ————————————————————————————————————————————————
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.driftCamera = new DriftCamera(aspect);
    this.freeCamera = new FreeCamera(aspect, DEFAULT_BOUNDS);
    this.thirdPersonCamera = new ThirdPersonCamera(aspect);
    this.inspectorCamera = new InspectorCamera(aspect);
    this.activeCamera = this.driftCamera.camera;

    // ——— ввод ——————————————————————————————————————————————————
    this.input = new Input({
      canvas,
      getSensitivity: () => this.settings.get('mouseSensitivity'),
      getInvertY: () => this.settings.get('invertY'),
    });

    // ——— звук и интерфейс ——————————————————————————————————————
    this.audio = new AudioSystem(this.settings, this.bus);

    const handlers: UiHandlers = {
      play: () => void this.startGame(false),
      continueGame: () => void this.startGame(true),
      exit: () => this.exitToShutdown(),
      resume: () => void this.resume(),
      exitToMenu: () => void this.exitToMenu(),
      returnFromShutdown: () => this.returnFromShutdown(),
      hover: () => this.audio.playUi('hover'),
      click: () => this.audio.playUi('click'),
    };
    this.ui = new Ui(uiRoot, this.settings, this.bus, handlers, {
      platform: this.platform,
      fullscreen: this.fullscreen,
      getScheme: () => this.scheme,
    });

    // ——— сенсорное управление (задача 11) ————————————————————————
    this.touch = new TouchControls({
      input: this.input,
      onPause: () => void this.pause(),
      onHover: handlers.hover,
      onClick: handlers.click,
    });
    this.ui.attachTouchControls(this.touch.root);
    this.ui.setTouchMode(this.scheme === 'touch');

    // ——— состояния и цикл ——————————————————————————————————————
    this.machine = new GameStateMachine(createStates(this), this.bus);
    this.dialogues = new DialogueSystem(this);
    this.loop = new Loop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (dt) => this.render(dt),
    });

    this.bindEvents();
  }

  /** Запуск: загрузка → меню. */
  async start(): Promise<void> {
    this.loop.start();
    await this.machine.change('loading');
    await this.machine.change('menu');
  }

  /** Загрузка ассетов и сборка мира. Вызывается состоянием загрузки. */
  async prepareWorld(): Promise<void> {
    const assets = await this.assets.load((value, label) => this.ui.setLoadingProgress(value, label));
    this.ui.setLoadingProgress(0.9, 'Сборка сцены');
    await this.buildWorld(assets);
    this.ui.setLoadingProgress(1, 'Готово');
  }

  setActiveCamera(camera: THREE.PerspectiveCamera): void {
    this.activeCamera = camera;
  }

  /** Включённая схема управления: настройка игрока важнее автоопределения. */
  get scheme(): ControlScheme {
    return resolveScheme(this.settings.get('controls'), this.platform);
  }

  /** Подсказка управления под текущую схему. */
  get playHint(): string {
    return HINTS[this.scheme];
  }

  /** Текст под схему управления: клавиатурный вариант и сенсорный. */
  t(keyboard: string, touch: string): string {
    return this.scheme === 'touch' ? touch : keyboard;
  }

  async startGame(fromSave: boolean): Promise<void> {
    if (this.machine.current !== 'menu') return;
    const island = this.world?.island;
    const saved = fromSave ? this.save.snapshot?.player : null;
    if (island) {
      if (saved) {
        this.player.setState(saved, island);
        this.thirdPersonCamera.look(0, 0);
        this.thirdPersonCamera.snapTo(this.player.position, saved.yaw, island.collisions);
        this.thirdPersonCamera.setYaw(saved.yaw);
      } else {
        this.player.spawn(0.7, 8.4, island, 0);
        this.thirdPersonCamera.setYaw(0);
        this.snapThirdPersonCamera();
      }
      this.character?.group.position.copy(this.player.position);
      if (this.character) this.character.group.rotation.y = this.player.yaw;
      // Начало матча: счёт с нуля, мяч на центре.
      this.football?.reset(false);
    }
    await this.machine.change('playing');
  }

  async pause(): Promise<void> {
    if (this.machine.current !== 'playing' || this.machine.isBusy) return;
    this.kickCharging = false;
    this.ui.setKickCharge(null);
    await this.machine.change('paused');
  }

  async resume(): Promise<void> {
    if (this.machine.current !== 'paused' || this.machine.isBusy) return;
    await this.machine.change('playing');
  }

  async exitToMenu(): Promise<void> {
    const current = this.machine.current;
    if ((current !== 'paused' && current !== 'playing') || this.machine.isBusy) return;
    this.persistPlayerState();
    // Табло живёт только в игре: в меню на нём нейтральные 0:0.
    this.football?.reset(false);
    this.kickCharging = false;
    this.ui.setKickCharge(null);
    await this.machine.change('menu');
  }

  dispose(): void {
    this.loop.stop();
    this.touch.dispose();
    this.fullscreen.dispose();
    this.input.dispose();
    this.ui.dispose();
    this.dialogues?.dispose();
    this.audio.dispose();
    this.paintMission?.dispose();
    this.ballMission?.dispose();
    this.football?.dispose();
    this.character?.dispose();
    this.world?.dispose();
    this.assets.dispose();
    this.renderer.dispose();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }

  // ——— внутреннее ————————————————————————————————————————————

  private async buildWorld(assets: LoadedAssets): Promise<void> {
    this.world?.dispose();
    this.world = new World(this.renderer, assets, this.settings.get('quality'));
    this.freeCamera.setBounds(this.world.bounds);

    // Главный герой стоит на террасе лицом к камере (управление — задача 6).
    // Модель заказчика: сначала пробуем привезённую GLB с анимациями, иначе — процедурная.
    this.character?.dispose();
    this.ui.setLoadingProgress(0.94, 'Герой');
    this.character = (await loadRiggedHero()) ?? new Character();
    // Герой стоит на дорожке лицом к дому: камера от третьего лица за плечом
    const island = this.world.island;
    this.player.spawn(0.7, 8.4, island, 0);
    this.character.group.position.copy(this.player.position);
    this.character.group.rotation.y = this.player.yaw;
    this.thirdPersonCamera.snapTo(this.player.position, this.player.yaw, island.collisions);
    this.world.scene.add(this.character.group);
    this.world.scene.add(this.character.skeletonHelper);
    this.inspectorSpin = 0;

    // ——— миссия 01: ремонт в комнате (задача 7) —————————————————
    this.paintMission?.dispose();
    this.quests.load();
    this.paintMission = new PaintMission(this);
    this.paintMission.restore();

    // ——— стадион (задача 16): мяч, счёт, табло —————————————————————
    this.football?.dispose();
    island.stadium.scoreboard.setScore(0, 0);
    this.kickCharging = false;
    this.stadiumZone = 'outside';
    this.football = new Football({
      parent: island.group,
      stadium: island.stadium,
      collisions: island.collisions,
      // Поле — плоскость на 5 см выше плато (иначе мерцает с кромкой), и мяч
      // должен катиться по ней, а не тонуть в газоне.
      groundHeightAt: (x, z) => {
        const onPitch =
          Math.abs(x - STADIUM.centerX) <= STADIUM.pitchWidth / 2 &&
          Math.abs(z - STADIUM.centerZ) <= STADIUM.pitchDepth / 2;
        return island.groundHeightAt(x, z) + (onPitch ? 0.05 : 0);
      },
      onGoal: (home, away) => {
        island.stadium.scoreboard.setScore(home, away);
        // 0:0 — это сброс перед матчем, а не гол.
        if (home + away > 0) {
          this.ui.toast(`Гол! ${home}:${away}`, 'success');
          this.bus.emit('football:goal', { home, away });
        }
      },
    });

    // ——— миссия 02: мяч и два гола (задача 8) —————————————————————
    this.ballMission?.dispose();
    this.ballMission = new BallMission(this);
    this.ballMission.restore();
    this.ui.setLoadingProgress(0.99, 'Сборка сцены');
    // Прогрев шейдеров: компилируем до показа меню, чтобы не было рывка на первом кадре.
    try {
      this.renderer.compile(this.world.scene, this.activeCamera);
    } catch (error) {
      console.warn('[Game] прогрев шейдеров не удался (не критично):', error);
    }
  }

  /** Кадр игры: мышь вращает камеру, WASD двигает героя, камера едет за ним. */
  updatePlayer(dt: number, look: { x: number; y: number }): void {
    const island = this.world?.island;
    const character = this.character;
    if (!island || !character) return;

    // Обзор: на компьютере — только с захваченной мышью, на телефоне — свайп.
    if (this.input.isPointerLocked || this.scheme === 'touch') this.thirdPersonCamera.look(look.x, look.y);

    const intent: MoveIntent = {
      forward: this.input.axis('KeyS', 'KeyW'),
      strafe: this.input.axis('KeyA', 'KeyD'),
      run: this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight'),
    };
    this.player.update(dt, intent, this.thirdPersonCamera.yaw, island);

    // Space у мяча — зарядка удара, в остальных случаях — прыжок. Одна кнопка
    // на оба действия: рядом с мячом прыгать нечем, зато удар всегда под рукой.
    const me = {
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.player.yaw,
      speed: this.player.speed,
      radius: this.player.radius,
    };
    const football = this.football;
    if (this.input.wasPressed('Space')) {
      if (football && !this.player.isAirborne && football.startCharge(me)) {
        this.kickCharging = true;
        this.bus.emit('football:charge', { power: 0 });
      } else {
        this.player.jump();
      }
    }

    if (football) {
      // Отпустили Space — удар накопленной силы.
      if (this.kickCharging && !this.input.isDown('Space')) {
        const power = football.releaseCharge(me);
        this.kickCharging = false;
        if (power > 0) {
          this.bus.emit('football:kick', { power });
          if (power > 0.75) this.ui.toast('Хлёсткий удар', 'info');
        }
      }
      football.update(dt, me);
      this.ui.setKickCharge(this.kickCharging ? football.charge01 : null);
      this.updateStadiumZone();
      this.updateTicketBooth();
    }

    character.group.position.copy(this.player.position);
    character.group.rotation.y = this.player.yaw;
    character.setLocomotion(this.player.speed01, this.player.phase);
    // Прыжок: клипа в модели нет — поза строится по фазе полёта (задача 16).
    character.setJump(this.player.jumpPhase01, this.player.isAirborne);

    this.thirdPersonCamera.update(dt, this.player.position, island.collisions);
  }

  /** Вход на стадион: при первом заходе на площадь и на поле — подсказка.
   *  Зоны считаются по константам чаши, поэтому не разъезжаются с геометрией. */
  private updateStadiumZone(): void {
    const island = this.world?.island;
    // Один раз при входе на аллею/площадь — событие для реплики «вот она, арена».
    const place = island ? island.placeAt(this.player.position.x, this.player.position.z) : 'street';
    if (place === 'stadium' && !this.atStadium) {
      this.atStadium = true;
      this.bus.emit('stadium:entered', { x: this.player.position.x, z: this.player.position.z });
    } else if (place !== 'stadium') {
      this.atStadium = false;
    }

    const { centerX, centerZ, width, depth, plazaWidth, plazaDepth } = STADIUM;
    const x = this.player.position.x;
    const z = this.player.position.z;
    const insidePitch =
      Math.abs(x - centerX) < width / 2 - 2 && Math.abs(z - centerZ) < depth / 2 - 2;
    const onPlaza =
      x > centerX + width / 2 - 1 &&
      x < centerX + width / 2 + plazaWidth + 1 &&
      Math.abs(z - centerZ) < plazaDepth / 2 + 1;
    const zone: StadiumZone = insidePitch ? 'pitch' : onPlaza ? 'plaza' : 'outside';
    if (zone === this.stadiumZone) return;
    this.stadiumZone = zone;
    if (zone === 'plaza') {
      this.ui.toast('«Вайс Шор Арена» · касса слева, вход — через турникеты', 'info');
    } else if (zone === 'pitch') {
      this.ui.toast('Поле · мяч в центре: подойди и держи Space для удара', 'info');
    }
  }

  /** Касса: билет — необязательный шаг, но купить его можно и приятно.
   *  Подсказка показывается один раз за подход, чтобы не забивать экран. */
  private updateTicketBooth(): void {
    const boothX = STADIUM.centerX + STADIUM.width / 2 + STADIUM.plazaWidth / 2;
    const boothZ = STADIUM.centerZ - STADIUM.plazaDepth / 2 + 0.5;
    const near =
      Math.abs(this.player.position.x - boothX) < 3.4 &&
      Math.abs(this.player.position.z - boothZ) < 2.2;
    if (!near) {
      this.boothPrompted = false;
      return;
    }
    if (!this.boothPrompted) {
      this.boothPrompted = true;
      this.ui.toast(
        this.hasTicket ? 'Касса · билет уже куплен, проходи к турникетам' : 'Касса · E — купить билет (500 ₽)',
        'info',
      );
    }
    if (this.input.wasPressed('KeyE')) {
      if (this.hasTicket) {
        this.ui.toast('Билет уже в кармане', 'info');
      } else {
        this.hasTicket = true;
        this.ui.toast('Билет куплен · 500 ₽ · проходи к турникетам', 'success');
        this.bus.emit('stadium:ticket', { price: 500 });
      }
    }
  }

  /** Аудит сцены (задача 10): мерцание, наложения, висящие предметы, осиротевшие
   *  коллизии. Возвращает отчёт; ничего в сцене не меняет. */
  auditScene(): AuditReport {
    const world = this.world;
    if (!world) throw new Error('Мир ещё не собран — аудит запускается после загрузки');
    return auditScene({
      root: world.island.group,
      collisions: world.island.collisions,
      groundHeightAt: (x, z) => world.island.groundHeightAt(x, z),
      bounds: { radiusX: ISLAND.radiusX, radiusZ: ISLAND.radiusZ },
      extraNodes: world.island.auditFootprints,
    });
  }

  /** Метрики кадра для бюджета GOAL.md §4.4 (draw calls, треугольники, память). */
  frameStats(): { drawCalls: number; triangles: number; geometries: number; textures: number; programs: number } {
    const render = this.renderer.info.render;
    const memory = this.renderer.info.memory;
    return {
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
    };
  }

  /** Служебная камера для облёта сцены в аудите (задача 10): ставится в точку,
   *  смотрит в цель и не участвует в игровых состояниях. */
  setAuditCamera(position: readonly [number, number, number], target: readonly [number, number, number]): void {
    this.auditCamera.position.set(position[0], position[1], position[2]);
    this.auditCamera.lookAt(target[0], target[1], target[2]);
    this.activeCamera = this.auditCamera;
  }

  /** Вернуть игровую камеру после облёта. */
  clearAuditCamera(): void {
    this.activeCamera = this.driftCamera.camera;
  }

  /** Поставить камеру за героем без сглаживания (вход в игру, респавн). */
  snapThirdPersonCamera(): void {
    const island = this.world?.island;
    if (!island) return;
    this.thirdPersonCamera.snapTo(this.player.position, this.player.yaw, island.collisions);
  }

  private fixedUpdate(dt: number): void {
    if (this.shutdown) return;
    if (this.machine.current !== 'paused') {
      this.elapsed += dt;
      this.character?.update(dt);
    }
    this.machine.update(dt);
    this.input.endFrame();
  }

  private render(dt: number): void {
    if (this.world) {
      this.world.update(dt, this.elapsed, this.activeCamera);
      this.renderer.render(this.world.scene, this.activeCamera);
    }
    this.collectStats(dt);
  }

  private collectStats(dt: number): void {
    this.statsFrames += 1;
    this.statsTimer += dt;
    if (this.statsTimer < 0.5) return;
    const fps = Math.round(this.statsFrames / this.statsTimer);
    this.statsFrames = 0;
    this.statsTimer = 0;
    const info = this.renderer.info;
    this.bus.emit('frame:stats', {
      fps,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
    });
    if (this.debugStats) {
      this.ui.setDebug(
        [
          `FPS      ${fps}`,
          `draw     ${info.render.calls}`,
          `tris     ${info.render.triangles.toLocaleString('ru-RU')}`,
          `state    ${this.machine.current ?? '—'}`,
          `quality  ${this.settings.get('quality')}`,
        ].join('\n'),
      );
    }
  }

  /** Кадр режима осмотра: модель медленно вращается, камера смотрит на неё. */
  updateInspector(dt: number): void {
    const character = this.character;
    if (!character) return;
    this.inspectorSpin += dt * 0.55;
    character.group.rotation.y = Math.PI + this.inspectorSpin;
    this.inspectorCamera.update(dt, character.group.position, Math.PI + this.inspectorSpin);
  }

  toggleInspector(): void {
    const character = this.character;
    if (!character) return;
    this.inspectorActive = !this.inspectorActive;
    character.setDebug(this.inspectorActive, this.wireframe);
    if (this.inspectorActive) {
      this.inspectorCamera.enter(this.thirdPersonCamera.camera);
      this.activeCamera = this.inspectorCamera.camera;
      this.input.exitPointerLock();
      this.ui.setHint(
        `Осмотр модели · ${POSE_LABELS[character.currentPose]} · 1–4 позы · F5 каркас · F3 выход`,
      );
    } else {
      this.activeCamera = this.thirdPersonCamera.camera;
      this.ui.setHint('WASD — идти · Shift — бег · мышь — обзор · колесо — приблизить · Esc — пауза');
      void this.input.requestPointerLock();
    }
  }

  /** Угол поворота модели в режиме осмотра (для отладки и автотестов). */
  setInspectorAngle(angle: number): void {
    this.inspectorSpin = angle;
  }

  zoomInspector(delta: number): void {
    this.inspectorCamera.zoomBy(delta);
  }

  setCharacterPose(pose: CharacterPose): void {
    if (!this.character) return;
    this.character.setPose(pose);
    if (this.inspectorActive) {
      this.ui.setHint(`Осмотр модели · ${POSE_LABELS[pose]} · 1–4 позы · F5 каркас · F3 выход`);
    }
  }

  /** Смена схемы управления на ходу: интерфейс, подсказка, захват мыши. */
  private applyControlsScheme(): void {
    const touch = this.scheme === 'touch';
    this.ui.setTouchMode(touch);
    if (!touch) {
      this.touch.hide();
      this.ui.setHint(this.playHint);
      if (this.machine.current === 'playing' && !this.inspectorActive) void this.input.requestPointerLock();
    } else {
      this.input.exitPointerLock();
      this.input.clearVirtual();
      if (this.machine.current === 'playing') {
        this.ui.showTouchControls();
        this.ui.setHint(this.playHint);
      }
    }
    this.ui.toast(touch ? 'Управление: сенсорный экран' : 'Управление: мышь и клавиатура');
  }

  /** Полноэкранный режим: приводим браузер к намерению игрока из настроек. */
  private applyFullscreen(): void {
    const want = this.settings.get('fullscreen');
    if (want === this.fullscreen.active) return;
    if (want) {
      void this.fullscreen.request().then((ok) => {
        if (ok && this.platform.touch) void this.fullscreen.lockLandscape();
        if (!ok) {
          this.settings.set('fullscreen', false);
          this.ui.toast(
            this.fullscreen.supported
              ? 'Браузер не дал включить полный экран'
              : 'В этом браузере полный экран недоступен',
            'warning',
          );
        }
      });
    } else {
      void this.fullscreen.exit();
    }
  }

  private persistPlayerState(): void {
    this.quests.flush();
    const state = this.player.getState();
    this.save.update((data) => {
      data.player = state;
    });
  }

  private exitToShutdown(): void {
    this.persistPlayerState();
    this.shutdown = true;
    this.ui.showShutdown();
    this.loop.stop();
    this.audio.suspend();
  }

  private returnFromShutdown(): void {
    this.shutdown = false;
    this.ui.hideShutdown();
    this.audio.resume();
    this.loop.start();
  }

  private applyQuality(quality: QualityLevel): void {
    const preset = QUALITY_PRESETS[quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.world?.setQuality(quality);
    this.ui.toast(`Качество графики: ${preset.label.toLowerCase()}`);
  }

  /** Звук разрешается только по действию пользователя (политика браузеров). */
  private tryUnlockAudio = (): void => {
    if (this.audioUnlockRequested) return;
    this.audioUnlockRequested = true;
    void this.audio.unlock().then((ok) => {
      if (!ok) return;
      this.audio.startAmbience();
      this.audio.applyVolumes(true);
      void this.dialogues?.preload();
    });
  };

  private bindEvents(): void {
    // Кнопка/жест «на весь экран» в браузере (Esc, F11) должна отражаться в настройках.
    this.unsubscribers.push(
      this.fullscreen.onChange((active) => {
        this.settings.set('fullscreen', active);
      }),
    );

    // Настройка «полный экран» включена ранее: браузер разрешит её только по жесту.
    if (this.settings.get('fullscreen') && this.fullscreen.supported) {
      const restore = (): void => {
        if (!this.fullscreen.active) this.applyFullscreen();
      };
      window.addEventListener('pointerdown', restore, { once: true });
      window.addEventListener('keydown', restore, { once: true });
      this.unsubscribers.push(() => window.removeEventListener('pointerdown', restore));
      this.unsubscribers.push(() => window.removeEventListener('keydown', restore));
    }

    const onResize = (): void => {
      const width = window.innerWidth;
      const height = Math.max(1, window.innerHeight);
      this.renderer.setSize(width, height);
      const aspect = width / height;
      this.driftCamera.setAspect(aspect);
      this.freeCamera.setAspect(aspect);
      this.inspectorCamera.setAspect(aspect);
      this.thirdPersonCamera.setAspect(aspect);
    };
    window.addEventListener('resize', onResize);

    // Разблокировка звука по первому действию пользователя.
    window.addEventListener('pointerdown', this.tryUnlockAudio, { passive: true });
    window.addEventListener('keydown', this.tryUnlockAudio);

    const onVisibility = (): void => {
      if (document.hidden) this.audio.suspend();
      else if (!this.shutdown) this.audio.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);

    this.unsubscribers.push(
      this.bus.on('settings:changed', (payload) => {
        if (payload.key === 'quality') this.applyQuality(payload.value as QualityLevel);
        // Субтитры включили/выключили посреди реплики (задача 9)
        if (payload.key === 'subtitles') this.dialogues?.refreshSubtitles();
        // Задача 11: смена схемы управления и полноэкранный режим
        if (payload.key === 'controls') this.applyControlsScheme();
        if (payload.key === 'fullscreen') this.applyFullscreen();
      }),
      this.bus.on('audio:unlocked', (payload) => {
        if (payload.ok) void this.dialogues?.preload();
      }),
    );

    // Уход из захвата мыши (Esc/Alt+Tab) = пауза, но только во время игры.
    this.unsubscribers.push(
      this.input.onPointerLockChange((locked) => {
        if (locked) return;
        // Осмотр модели сам отпускает мышь — это не повод ставить игру на паузу.
        if (this.inspectorActive) return;
        // На телефоне захвата мыши нет вовсе — отсутствие «захвата» там не событие.
        if (this.scheme === 'touch' || this.platform.touch) return;
        if (this.machine.current === 'playing' && !this.machine.isBusy) void this.pause();
      }),
    );

    // Отладочные клавиши.
    this.unsubscribers.push(
      this.input.onKeyDownGlobal((code) => {
        if (code === DEBUG.statsKey) {
          this.debugStats = !this.debugStats;
          if (!this.debugStats) this.ui.setDebug(null);
          return;
        }
        if (this.machine.current !== 'playing') return;
        if (code === DEBUG.inspectorKey) {
          this.toggleInspector();
          return;
        }
        if (code === DEBUG.wireframeKey && this.inspectorActive) {
          this.wireframe = !this.wireframe;
          this.character?.setDebug(true, this.wireframe);
          return;
        }
        const poseIndex = DEBUG.poseKeys.indexOf(code as (typeof DEBUG.poseKeys)[number]);
        if (this.inspectorActive && poseIndex >= 0) {
          const pose = CHARACTER_POSES[poseIndex];
          if (pose) this.setCharacterPose(pose);
        }
      }),
    );

    const onWheel = (event: WheelEvent): void => {
      if (this.machine.current !== 'playing') return;
      event.preventDefault();
      if (this.inspectorActive) {
        this.inspectorCamera.zoomBy(event.deltaY * 0.0016);
        return;
      }
      // Приближение камеры от третьего лица
      this.thirdPersonCamera.zoom(event.deltaY * 0.0022);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    this.unsubscribers.push(() => window.removeEventListener('wheel', onWheel));

    const onContextLost = (event: Event): void => {
      event.preventDefault();
      this.ui.toast('Графический контекст потерян — перезагрузите страницу', 'warning');
    };
    this.canvas.addEventListener('webglcontextlost', onContextLost);
    this.unsubscribers.push(() => this.canvas.removeEventListener('webglcontextlost', onContextLost));
    this.unsubscribers.push(() => window.removeEventListener('resize', onResize));
    this.unsubscribers.push(() => window.removeEventListener('pointerdown', this.tryUnlockAudio));
    this.unsubscribers.push(() => window.removeEventListener('keydown', this.tryUnlockAudio));
    this.unsubscribers.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }
}
