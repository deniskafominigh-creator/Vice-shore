import * as THREE from 'three';
import { Assets, type LoadedAssets } from '../core/Assets';
import { AudioSystem } from '../core/Audio';
import { CLOCK, DEBUG, FOG, ISLAND, MATCH, QUALITY_PRESETS, STADIUM, type QualityLevel } from '../core/Config';
import { GameClock } from '../core/GameClock';
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
import { cloneGltfForNpc, loadHeroGltf, RiggedHero } from '../entities/character/RiggedHero';
import { HERO_OUTFIT, SELLER_OUTFIT } from '../entities/character/Outfit';
import { TicketSeller } from '../entities/npc/TicketSeller';
import { SellerVoice } from '../entities/npc/SellerVoice';
import { lineById, SELLER_QUESTIONS, SELLER_SPEAKER, SELLER_SPOT, TicketOffice } from './TicketOffice';
import type { TalkOption } from '../ui/TalkPanel';
import { PlayerController, type MoveIntent } from '../entities/player/PlayerController';
import { createStates } from './states';
import { QuestSystem } from './QuestSystem';
import { DialogueSystem } from './DialogueSystem';
import { PaintMission } from './PaintMission';
import { BallMission } from './BallMission';
import { Football } from './Football';
import { RenderPipeline } from './RenderPipeline';
import { VoiceBank } from './VoiceBank';
import { StreetLife } from './StreetLife';
import { FootballMatch, type MatchSound } from './FootballMatch';
import { EndOfDay } from './EndOfDay';
import { MISSION_01, MISSION_02 } from '../data/quests';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
  /** Игровые часы (задача 22): время матча и конец дня. */
  readonly clock: GameClock;
  /** Уличные жители и голоса задачи 22. */
  street: StreetLife | null = null;
  voices: VoiceBank | null = null;
  /** Матч до трёх голов (задача 22). */
  match: FootballMatch | null = null;
  /** Катсцена конца дня. */
  private cutscene: EndOfDay | null = null;
  /** Копия GLB для клонов игроков и жителей: одна на весь мир. */
  private npcGltf: GLTF | null = null;
  /** Часы уже показаны (после двух вступительных миссий). */
  private clockShown = false;
  /** Матч назначен на 19:00 и уже сыгран. */
  private matchScheduled = false;
  private matchStarted = false;
  private cutsceneActive = false;
  /** Через сколько секунд после свистка уходить в катсцену. */
  private cutsceneAt = -1;
  /** Идёт зарядка удара (Space зажали рядом с мячом). */
  private kickCharging = false;
  private stadiumZone: StadiumZone = 'outside';
  /** Билет куплен в кассе (необязательный шаг: пройти мимо можно). */
  private hasTicket = false;
  private boothPrompted = false;
  /** Кассир стадиона и его голос (задача 18). */
  private seller: TicketSeller | null = null;
  private sellerVoice: SellerVoice | null = null;
  private readonly office = new TicketOffice();
  /** Открыт разговор с кассиром: герой стоит, мышь не захвачена. */
  private talking = false;
  /** Матч уже играли — от этого зависят ответы кассира про запись и просмотр. */
  private matchPlayed = false;
  /** Когда закрылся разговор: пауза в тот же миг от того же Esc не срабатывает. */
  private talkClosedAt = -Infinity;
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
  /** Пост-обработка кадра: bloom, SSAO, SMAA (задача 19). */
  readonly pipeline: RenderPipeline;
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
  /** Средний FPS и сколько раз его уже мерили — для автозащиты качества. */
  private perfAvg = 0;
  private perfSamples = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;

    // ——— часы (задача 22): тикают только во время игры ————————————
    this.clock = new GameClock((minutes, label) => this.onClockTick(minutes, label));

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
    this.renderer.toneMappingExposure = FOG.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Информация о кадре собирается по всем проходам композера, а не по последнему.
    this.renderer.info.autoReset = false;

    this.pipeline = new RenderPipeline(this.renderer, this.settings.get('quality'));
    this.pipeline.setCinematicBlur(this.settings.get('depthOfField'));
    this.pipeline.setSize(window.innerWidth, window.innerHeight);

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
      talk: (questionId: string) => void this.askSeller(questionId),
      closeTalk: () => this.endTalk(),
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
    // Только что закрыли разговор тем же нажатием Esc — это не команда «пауза».
    if (performance.now() - this.talkClosedAt < 400) return;
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
    this.cutscene?.dispose();
    this.match?.clear();
    this.street?.dispose();
    this.voices?.stop();
    this.audio.dispose();
    this.paintMission?.dispose();
    this.ballMission?.dispose();
    this.football?.dispose();
    this.character?.dispose();
    this.world?.dispose();
    this.pipeline.dispose();
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
    // Один разбор GLB на двоих: герой и кассир. Копию для NPC снимаем ДО того,
    // как `RiggedHero` развернёт и отмасштабирует сцену, иначе копия получит
    // разворот и масштаб дважды.
    const gltf = await loadHeroGltf();
    const npcGltf = gltf ? cloneGltfForNpc(gltf) : null;
    this.character = gltf ? new RiggedHero(gltf) : new Character();
    // Одежда героя перекрашена по палитре (задача 19): кожа и волосы на месте.
    if (this.character instanceof RiggedHero) this.character.recolourOutfit(HERO_OUTFIT, 2048);
    // Герой стоит на дорожке лицом к дому: камера от третьего лица за плечом
    const island = this.world.island;
    this.player.spawn(0.7, 8.4, island, 0);
    this.character.group.position.copy(this.player.position);
    this.character.group.rotation.y = this.player.yaw;
    this.thirdPersonCamera.snapTo(this.player.position, this.player.yaw, island.collisions);
    this.world.scene.add(this.character.group);
    this.world.scene.add(this.character.skeletonHelper);
    this.inspectorSpin = 0;

    // ——— кассир стадиона (задача 18) ————————————————————————————
    this.endTalk();
    this.seller?.dispose();
    this.seller = null;
    this.sellerVoice?.stop();
    this.sellerVoice = new SellerVoice(this);
    if (npcGltf) {
      this.ui.setLoadingProgress(0.96, 'Кассир');
      const groundY = island.groundHeightAt(SELLER_SPOT.x, SELLER_SPOT.z);
      this.seller = new TicketSeller(npcGltf, groundY);
      // Кассир в другой форме: та же модель, другая палитра (задача 19).
      this.seller.hero.recolourOutfit(SELLER_OUTFIT, 1024);
      this.world.scene.add(this.seller.group);
      // Сквозь кассира не пройти: коллайдер + снимок для аудита, иначе аудит
      // задачи 10 честно назовёт его «коллизией без предмета».
      island.collisions.addCircle(SELLER_SPOT.x, SELLER_SPOT.z, 0.36, groundY + 1.86);
      island.auditFootprints.push({
        label: 'кассир',
        mesh: null,
        box: new THREE.Box3(
          new THREE.Vector3(SELLER_SPOT.x - 0.36, groundY, SELLER_SPOT.z - 0.36),
          new THREE.Vector3(SELLER_SPOT.x + 0.36, groundY + 1.86, SELLER_SPOT.z + 0.36),
        ),
        solid: true,
        base: false,
        flatFaced: true,
        triangles: 0,
      });
    }
    this.office.reset();
    this.matchPlayed = false;

    // ——— миссия 01: ремонт в комнате (задача 7) —————————————————
    this.paintMission?.dispose();
    this.quests.load();
    this.paintMission = new PaintMission(this);
    this.paintMission.restore();

    // ——— уличные жители (задача 22): соседи ходят по улице ———————————
    this.street?.dispose();
    this.street = null;
    this.voices?.stop();
    this.voices = new VoiceBank(this.audio);
    this.npcGltf = npcGltf;
    if (npcGltf) {
      this.ui.setLoadingProgress(0.965, 'Соседи');
      this.street = new StreetLife(
        npcGltf,
        this.world.scene,
        {
          groundHeightAt: (x, z) => island.groundHeightAt(x, z),
          isWalkable: (x, z) => island.isWalkable(x, z),
        },
        this.ui,
        this.voices,
      );
    }
    // Матч и катсцена пересобираются вместе с миром
    this.match?.clear();
    this.match = null;
    this.cutscene?.dispose();
    this.cutscene = null;
    this.cutsceneActive = false;
    this.cutsceneAt = -1;
    this.clock.stop();
    this.clock.setTime(CLOCK.startHour, CLOCK.startMinute);
    this.clockShown = false;
    this.matchScheduled = false;
    this.matchStarted = false;
    this.ui.setClockVisible(false);

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
        // Идёт матч — счёт ведёт он: гол уходит в симуляцию, табло и HUD
        // обновляет FootballMatch. Иначе счёт матча оставался бы 0:0.
        if (this.match?.isRunning) {
          this.match.handleFootballGoal(home, away);
          // Табло в чаше показывает счёт матча, а не общий счёт мяча за день
          const score = this.match.score;
          island.stadium.scoreboard.setScore(score.home, score.away);
          this.bus.emit('football:goal', { home: score.home, away: score.away });
          this.matchPlayed = true;
          return;
        }
        island.stadium.scoreboard.setScore(home, away);
        // 0:0 — это сброс перед матчем, а не гол.
        if (home + away > 0) {
          this.ui.toast(`Гол! ${home}:${away}`, 'success');
          this.matchPlayed = true;
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

    // Катсцена конца дня: герой спит, ввод не трогаем, сцена идёт по таймлайну
    if (this.cutsceneActive) {
      this.cutscene?.update(dt);
      return;
    }

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
    // Поворот ставим целиком: катсцена кладёт героя на спину (x = π/2), и если
    // после неё менять только .y, герой «входит в новый день лёжа».
    character.group.rotation.set(0, this.player.yaw, 0);
    character.setLocomotion(this.player.speed01, this.player.phase);
    // Прыжок: клипа в модели нет — поза строится по фазе полёта (задача 16).
    character.setJump(this.player.jumpPhase01, this.player.isAirborne);

    this.thirdPersonCamera.update(dt, this.player.position, island.collisions);

    // Жизнь поверх героя (задача 22): часы, соседи, матч, катсцена
    this.updateClockAndLife(dt);
    this.updateMatch(dt, me);
  }

  // ——— задача 22: часы, матч, катсцена ——————————————————————————————

  /** Часы и всё, что от них зависит: подсказка, свисток в 19:00, конец дня. */
  private updateClockAndLife(dt: number): void {
    const island = this.world?.island;
    if (!island) return;

    this.street?.update(dt, this.player.position);

    // Часы появляются после двух вступительных миссий: раньше расписание
    // игроку всё равно не нужно, а лишний элемент в HUD мешает.
    if (!this.clockShown) {
      if (this.quests.isCompleted(MISSION_01.id) && this.quests.isCompleted(MISSION_02.id)) {
        this.clockShown = true;
        this.ui.setClockVisible(true);
        this.applyClockStyle();
        this.ui.setClockTime(this.clock.totalMinutes);
        this.clock.start();
        this.bus.emit('clock:tick', { minutes: this.clock.totalMinutes, label: this.clock.label });
        this.ui.flashMission(`${this.clock.label} · вечер · матч в 19:00`, 'info');
      }
    } else {
      const before = this.clock.totalMinutes;
      this.clock.update(dt);
      if (this.clock.totalMinutes !== before) {
        this.onClockTick(this.clock.totalMinutes, this.clock.label);
      }
    }

    // Катсцена назначена — уходим в неё, когда стихнет празднование
    if (this.cutsceneAt > 0 && this.elapsed >= this.cutsceneAt) {
      this.cutsceneAt = -1;
      this.startCutscene();
    }
    if (this.cutsceneActive) this.cutscene?.update(0);
  }

  /** Тик часов: HUD, обратный отсчёт и свисток ровно в 19:00. */
  private onClockTick(minutes: number, label: string): void {
    this.ui.setClockTime(minutes);
    this.bus.emit('clock:tick', { minutes, label });
    if (this.matchStarted) return;

    const until = this.clock.minutesUntil(CLOCK.matchHour, CLOCK.matchMinute);
    this.ui.setClockUrgent(until > 0 && until <= 20);
    if (until > 0 && until <= 40) {
      this.ui.setClockHint(`матч в ${String(CLOCK.matchHour).padStart(2, '0')}:${String(CLOCK.matchMinute).padStart(2, '0')} · ${until} мин`);
    } else {
      this.ui.setClockHint(null);
    }

    if (!this.matchScheduled && until > 0 && until <= 45) {
      this.matchScheduled = true;
      this.ui.toast('Кассир предупредил: матч в 19:00. Не опаздывай', 'info');
      this.bus.emit('match:scheduled', {
        at: CLOCK.matchHour * 60 + CLOCK.matchMinute,
        label: `${String(CLOCK.matchHour).padStart(2, '0')}:${String(CLOCK.matchMinute).padStart(2, '0')}`,
      });
    }

    // Ровно 19:00 — свисток. Опоздал — команда начинает без тебя.
    const atMatchTime = this.clock.hour === CLOCK.matchHour && this.clock.minute === CLOCK.matchMinute;
    if (atMatchTime) this.beginMatch();
  }

  /** Применить выбранный стиль часов (настройки → часы). */
  applyClockStyle(): void {
    this.clock.setStyle(this.settings.get('clockStyle'));
    // Стиль применяет интерфейс: у виджета один атрибут data-style на все три вида
    this.ui.applyInterface();
    this.ui.setClockTime(this.clock.totalMinutes);
  }

  /** Свисток: собираем матч, выводим игроков и табло. */
  private beginMatch(): void {
    const island = this.world?.island;
    const football = this.football;
    if (!island || !football || this.matchStarted) return;
    this.matchStarted = true;
    this.ui.setClockHint(null);
    this.ui.setClockUrgent(false);
    this.bus.emit('match:ready', { minutes: this.clock.totalMinutes });

    if (!this.npcGltf) {
      this.ui.toast('Матч не собрать: нет модели игроков', 'warning');
      return;
    }
    const world = this.world;
    if (!world) return;
    if (!this.match) {
      this.match = new FootballMatch({
        scene: world.scene,
        football,
        gltf: this.npcGltf,
        groundY: island.groundHeightAt(STADIUM.centerX, STADIUM.centerZ) + 0.05,
        ui: this.ui,
        bus: this.bus,
        onSound: (sound, power) => this.playMatchSound(sound, power),
        onFinished: (home, away) => this.finishMatch(home, away),
      });
    }
    island.stadium.scoreboard.setScore(0, 0);
    this.match.start();
    this.ui.flashMission(`19:00 · свисток! Матч до ${MATCH.goalsToWin} голов`, 'success');
    this.audio.playWhistle(false);
  }

  /** Кадр матча: симуляция, игроки, табло. */
  private updateMatch(dt: number, me: { x: number; z: number; yaw: number; speed: number }): void {
    const match = this.match;
    if (!match || !match.isRunning) return;
    match.update(dt, { x: me.x, z: me.z, yaw: me.yaw, speed: me.speed });
  }

  /** Звук матча: свисток, удар, гол — своими синтезаторами. */
  private playMatchSound(sound: MatchSound, power: number): void {
    switch (sound) {
      case 'kick':
        this.audio.playThrow(power);
        break;
      case 'goal':
        this.audio.playGoal(true);
        this.audio.playCheer(1);
        break;
      case 'save':
        this.audio.playPickup();
        break;
      case 'shout':
        this.audio.playCheer(0.45);
        break;
      case 'whistle':
        this.audio.playWhistle(true);
        break;
      case 'end':
        this.audio.playWhistle(false);
        this.audio.playGoal(true);
        break;
      default:
        break;
    }
  }

  /** Финальный свисток: время прыгает к концу дня, затем катсцена. */
  private finishMatch(home: number, away: number): void {
    this.matchPlayed = true;
    this.clock.catchUpTo(CLOCK.endHour, CLOCK.endMinute);
    this.ui.setClockTime(this.clock.totalMinutes);
    this.ui.setClockHint('конец рабочего дня');
    this.ui.setClockUrgent(false);
    const win = home > away;
    this.ui.flashMission(
      win ? `Победа ${home}:${away} · конец рабочего дня` : `Матч ${home}:${away} · конец рабочего дня`,
      win ? 'success' : 'info',
    );
    this.bus.emit('match:finished', { home, away });
    this.cutsceneAt = this.elapsed + 2.4;
  }

  /** Катсцена конца дня: вилла, диван, сон. */
  private startCutscene(): void {
    const island = this.world?.island;
    const character = this.character;
    const world = this.world;
    if (!island || !character || !world || this.cutsceneActive) return;
    this.cutsceneActive = true;
    this.cutscene?.dispose();
    this.cutscene = new EndOfDay({
      ui: this.ui,
      voices: this.voices ?? (this.voices = new VoiceBank(this.audio)),
      hero: character.group,
      floorY: island.villa.floorY,
      sofa: { x: -3.9, z: -9.4 },
      onFinish: () => this.endCutscene(),
      restore: () => this.setActiveCamera(this.thirdPersonCamera.camera),
    });
    this.cutscene.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.cutscene.camera.updateProjectionMatrix();
    this.cutscene.start(world.scene);
    this.setActiveCamera(this.cutscene.camera);
    this.ui.setClockHint('сон');
    this.bus.emit('cutscene:shot', { index: 0, caption: 'КОНЕЦ РАБОЧЕГО ДНЯ' });
  }

  /** Сцена закончилась: новый день, герой снова на террасе. */
  private endCutscene(): void {
    const island = this.world?.island;
    const character = this.character;
    this.cutsceneActive = false;
    this.setActiveCamera(this.thirdPersonCamera.camera);
    if (!island || !character) return;
    this.clock.setTime(CLOCK.startHour, CLOCK.startMinute);
    this.clock.start();
    this.ui.setClockTime(this.clock.totalMinutes);
    this.player.spawn(0.7, 8.4, island, 0);
    character.group.position.copy(this.player.position);
    // Поворот ставим целиком (x = z = 0): после катсцены герой лежал на спине,
    // и одного rotation.y не хватало — новый день начинался «лёжа».
    character.group.rotation.set(0, this.player.yaw, 0);
    this.thirdPersonCamera.snapTo(this.player.position, this.player.yaw, island.collisions);
    this.match?.clear();
    this.ui.setClockHint(null);
    this.ui.toast('Новый день · Вайс Шор ждёт', 'success');
  }

  get isCutscene(): boolean {
    return this.cutsceneActive;
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
  /** Касса (задача 18): рядом — подсказка, E открывает разговор с кассиром.
   *  Билет больше не выдаётся «по кнопке»: его продаёт живой кассир, а заодно
   *  отвечает про запись на матч, команды и просмотр. */
  private updateTicketBooth(): void {
    if (!this.seller) return;
    const dx = this.player.position.x - SELLER_SPOT.x;
    const dz = this.player.position.z - SELLER_SPOT.z;
    const near = Math.hypot(dx, dz) < 3.6;
    if (!near) {
      this.boothPrompted = false;
      if (this.talking) this.endTalk();
      return;
    }
    if (this.talking) return;
    if (!this.boothPrompted) {
      this.boothPrompted = true;
      this.ui.toast(
        this.hasTicket ? 'Касса · билет уже куплен, можно поговорить' : 'Касса · E — поговорить с кассиром',
        'info',
      );
    }
    if (this.input.wasPressed('KeyE')) this.openTalk();
  }

  // ——— разговор с кассиром (задача 18) ————————————————————————

  /** Открыт ли разговор: пока да, герой стоит и мышь не захвачена. */
  get isTalking(): boolean {
    return this.talking;
  }

  /** Сколько mp3 кассира дошло до сборки — для проверок. */
  get sellerClips(): number {
    return this.sellerVoice?.clipCount ?? 0;
  }

  openTalk(): void {
    const seller = this.seller;
    if (!seller || this.talking || this.machine.current !== 'playing') return;
    this.talking = true;
    this.input.exitPointerLock();
    this.ui.setHint(null);
    this.ui.setMissionPrompt(null);
    this.ui.setTalkAnswer(SELLER_SPEAKER, null);
    this.ui.openTalk(this.talkOptions());
    // Свободные клавиши не должны «догонять» героя после разговора.
    this.input.clearVirtual();
    seller.wave();
    void this.sellerVoice?.preload();
    this.say(this.office.greeting());
  }

  endTalk(): void {
    if (!this.talking) {
      if (this.ui.talkOpen) this.ui.closeTalk();
      return;
    }
    this.talking = false;
    // Один Esc ловят и панель (document), и игровой обработчик (window). Без этой
    // метки разговор закрывался, а игра тут же вставала на паузу — и герой «замирал».
    this.talkClosedAt = performance.now();
    this.ui.closeTalk();
    this.sellerVoice?.stop();
    this.seller?.setTalking(false);
    if (this.machine.current === 'playing' && this.scheme !== 'touch') {
      void this.input.requestPointerLock();
    }
  }

  /** Вопрос выбран: кассир отвечает, билет при необходимости продаётся. */
  askSeller(questionId: string): void {
    if (!this.talking) return;
    const lineId = this.office.answer(questionId, { played: this.matchPlayed, hasTicket: this.hasTicket });
    if (questionId === 'ticket') {
      if (this.hasTicket) {
        this.ui.toast('Билет уже в кармане', 'info');
      } else {
        this.hasTicket = true;
        this.boothPrompted = false;
        this.bus.emit('stadium:ticket', { price: 500 });
        this.ui.toast('Билет куплен · 500 ₽ · проходи к турникетам', 'success');
        this.seller?.handOver();
      }
    }
    if (questionId === 'join') {
      this.ui.toast('Заявка в Viced Boys принята', 'success');
    }
    if (lineId) this.say(lineId);
    this.ui.setTalkOptions(this.talkOptions());
  }

  /** Проговорить реплику кассира: текст в панель, звук — в его дорожку. */
  private say(lineId: string): void {
    const line = lineById(lineId);
    if (!line) return;
    this.ui.setTalkAnswer(SELLER_SPEAKER, line.text);
    this.sellerVoice?.play(line.file);
    this.seller?.setTalking(true);
  }

  /** Кнопки разговора: цена билета и пометки берутся из состояния, а не из текста. */
  private talkOptions(): readonly TalkOption[] {
    return SELLER_QUESTIONS.map((question) => {
      if (question.id === 'ticket') {
        return this.hasTicket
          ? { id: question.id, label: question.label, note: 'куплен', disabled: true }
          : { id: question.id, label: question.label, note: '500 ₽' };
      }
      if (question.id === 'join') {
        return this.office.isRegistered
          ? { id: question.id, label: question.label, note: 'заявка подана' }
          : { id: question.id, label: question.label };
      }
      return { id: question.id, label: question.label };
    });
  }

  /** Кассир живёт всегда: дышит, смотрит на покупателя, провожает взглядом. */
  updateSeller(dt: number): void {
    const seller = this.seller;
    if (!seller) return;
    this.sellerVoice?.update(dt);
    seller.update(dt, this.world ? this.player.position : null);
    if (this.sellerVoice?.isSpeaking) seller.setTalking(true);
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
    // Сброс статистики вручную: за кадр может быть несколько проходов композера.
    this.renderer.info.reset();
    if (this.world) {
      this.world.update(dt, this.elapsed, this.activeCamera);
      // Фокус глубины резкости — на герое (задача 20): дальний план уходит в мягкое боке.
      const focus =
        this.machine.current === 'playing'
          ? this.activeCamera.position.distanceTo(this.player.position)
          : 26;
      this.pipeline.setFocus(focus);
      this.pipeline.render(this.world.scene, this.activeCamera);
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

    // Защита FPS (задача 19): если тяжёлый AO роняет кадр, снимаем его на ходу —
    // настройка качества остаётся прежней, картинка перестаёт «плыть».
    this.perfSamples += 1;
    if (fps > 0) this.perfAvg = this.perfAvg <= 0 ? fps : this.perfAvg * 0.7 + fps * 0.3;
    if (this.perfSamples > 6 && this.perfAvg > 0 && this.perfAvg < 45 && this.machine.current === 'playing') {
      // Порядок уступок: сначала боке (самое дорогое), потом AO, и только потом
      // пользователь сам опускает качество в настройках.
      if (this.pipeline.disableCinematicBlur()) {
        this.ui.toast('Глубина резкости отключена ради плавности кадров', 'info');
      } else if (this.pipeline.disableAmbientOcclusion()) {
        this.ui.toast('SSAO отключён ради плавности кадров', 'info');
      }
    }
    if (this.debugStats) {
      this.ui.setDebug(
        [
          `FPS      ${fps}`,
          `draw     ${info.render.calls}`,
          `tris     ${info.render.triangles.toLocaleString('ru-RU')}`,
          `state    ${this.machine.current ?? '—'}`,
          `quality  ${this.settings.get('quality')}`,
          `post     ${
            this.pipeline.stats.post
              ? [
                  this.pipeline.stats.ssao && 'ssao',
                  this.pipeline.stats.bokeh && 'bokeh',
                  this.pipeline.stats.bloom && 'bloom',
                  this.pipeline.stats.smaa && 'smaa',
                  this.pipeline.stats.film && 'film',
                ]
                  .filter(Boolean)
                  .join(' ')
              : '—'
          }`,
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
    this.pipeline.setQuality(quality);
    this.pipeline.setSize(window.innerWidth, window.innerHeight);
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
      void this.sellerVoice?.preload();
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
      this.pipeline.setSize(width, height);
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
        if (payload.key === 'depthOfField') {
          this.pipeline.setCinematicBlur(payload.value as boolean);
          this.pipeline.setSize(window.innerWidth, window.innerHeight);
        }
        // Субтитры включили/выключили посреди реплики (задача 9)
        if (payload.key === 'subtitles') this.dialogues?.refreshSubtitles();
        // Задача 11: смена схемы управления и полноэкранный режим
        if (payload.key === 'clockStyle') this.applyClockStyle();
        if (payload.key === 'controls') this.applyControlsScheme();
        if (payload.key === 'fullscreen') this.applyFullscreen();
      }),
      this.bus.on('audio:unlocked', (payload) => {
        if (!payload.ok) return;
        void this.dialogues?.preload();
        // Голоса задачи 22: катсцена и приветствия соседей
        void this.voices?.preload();
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
