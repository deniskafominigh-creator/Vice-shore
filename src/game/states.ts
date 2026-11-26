import type { GameState, GameStateId } from '../core/GameStateMachine';
import { MISSION_01 } from '../data/quests';
import type { Game } from './Game';

/** Состояния игры. Каждое состояние владеет своим вводом и интерфейсом:
 *  enter — включить, exit — убрать за собой (GOAL.md §5.2). */

class LoadingState implements GameState {
  readonly id: GameStateId = 'loading';

  constructor(private readonly game: Game) {}

  async enter(): Promise<void> {
    this.game.ui.showLoading();
    this.game.ui.setLoadingProgress(0, 'Подготовка');
    await this.game.prepareWorld();
  }

  exit(): void {
    this.game.ui.hideLoading();
  }

  update(): void {
    // Пока идёт загрузка, играть нечем: логика кадра пустая по делу, а не «временно».
  }
}

class MenuState implements GameState {
  readonly id: GameStateId = 'menu';

  constructor(private readonly game: Game) {}

  async enter(): Promise<void> {
    const game = this.game;
    game.setActiveCamera(game.driftCamera.camera);
    game.input.exitPointerLock();
    game.input.clearVirtual();
    game.ui.hideTouchControls();
    game.audio.setAmbienceTarget(1);

    await game.ui.fadeTo(true);
    game.ui.hideLoading();
    game.ui.closeAllPanels();
    game.ui.setHint(null);
    game.ui.setSaveAvailable(game.save.hasSave);
    game.ui.showMainMenu();
    await game.ui.fadeTo(false);
  }

  exit(): void {
    this.game.ui.hideMainMenu();
  }

  update(dt: number): void {
    this.game.driftCamera.update(dt, this.game.elapsed);
  }
}

class PlayingState implements GameState {
  readonly id: GameStateId = 'playing';

  private unsubscribeEscape: (() => void) | null = null;
  private readonly onCanvasPointerDown = (): void => {
    if (!this.game.input.isPointerLocked) void this.game.input.requestPointerLock();
  };

  constructor(private readonly game: Game) {}

  async enter(): Promise<void> {
    const game = this.game;
    game.setActiveCamera(game.thirdPersonCamera.camera);
    await game.ui.fadeTo(true);

    game.ui.hideMainMenu();
    game.ui.closeAllPanels();
    game.save.ensureExists();
    game.ui.setSaveAvailable(true);
    game.ui.setHint(game.playHint);

    // ——— миссия 01 (задача 7) ————————————————————————————————
    game.ui.showMissionHud();
    if (!game.quests.isCompleted(MISSION_01.id) && !game.quests.isActive(MISSION_01.id)) {
      game.quests.start(MISSION_01.id);
    } else if (game.quests.isActive(MISSION_01.id)) {
      game.quests.focusOn(MISSION_01.id);
    }
    game.paintMission?.refresh();
    game.ballMission?.refresh();

    this.unsubscribeEscape = game.input.onKeyDownGlobal((code) => {
      // Пока открыт разговор с кассиром, Esc закрывает его, а не ставит игру на паузу.
      if (code === 'Escape' && !game.isTalking) void game.pause();
    });

    // Захват мыши нужен только клавиатурной схеме: на телефоне его нет,
    // а вызов pointer lock там только мешает (задача 11).
    if (game.scheme === 'touch') {
      game.ui.showTouchControls();
    } else {
      game.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
      void game.input.requestPointerLock();
    }

    await game.ui.fadeTo(false);
  }

  exit(): void {
    this.unsubscribeEscape?.();
    this.unsubscribeEscape = null;
    this.game.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.game.ui.hideTouchControls();
    this.game.touch.reset();
    if (this.game.inspectorActive) this.game.toggleInspector();
    this.game.paintMission?.leave();
    this.game.ballMission?.leave();
    this.game.quests.flush();
    this.game.ui.hideMissionHud();
    this.game.ui.setHint(null);
  }

  update(dt: number): void {
    const game = this.game;
    // Мышь всегда «съедаем», чтобы при возврате из осмотра камера не прыгала.
    const look = game.input.consumeMouseDelta();
    // Приближение: колесо на компьютере, щипок двумя пальцами на телефоне.
    const zoom = game.input.consumeZoomDelta();
    if (zoom !== 0) game.thirdPersonCamera.zoom(zoom * 0.0022);
    // Реплики героя живут и во время покраски (задача 9)
    game.dialogues?.update(dt);
    // Кассир живёт и во время разговора: он дышит, смотрит и кивает (задача 18)
    game.updateSeller(dt);

    if (game.scheme === 'touch') {
      game.touch.setMode(game.paintMission?.painting ? 'painting' : 'world');
      if (game.ballMission?.heldBall) game.touch.setHoldLabel('БРОСОК');
    }

    if (game.inspectorActive) {
      game.updateInspector(dt);
      return;
    }

    // Разговор с кассиром: герой стоит, камера не крутится, ввод у панели (задача 18)
    if (game.isTalking) {
      game.dialogues?.pauseIdle();
      return;
    }

    // Покраска стены перехватывает управление (задача 7)
    if (game.paintMission?.painting) {
      game.paintMission.updatePainting(dt, look);
      return;
    }

    // Третье лицо: герой идёт, камера едет за плечом (задача 6)
    game.updatePlayer(dt, look);
    game.paintMission?.update(dt);
    game.ballMission?.update(dt);
  }
}

class PausedState implements GameState {
  readonly id: GameStateId = 'paused';

  constructor(private readonly game: Game) {}

  async enter(): Promise<void> {
    const game = this.game;
    game.input.exitPointerLock();
    game.ui.hideTouchControls();
    game.touch.reset();
    game.ui.setHint(null);
    game.ui.setMissionPrompt(null);
    game.audio.setAmbienceTarget(0.55);
    game.quests.flush();
    game.ui.openPause();
  }

  exit(): void {
    this.game.ui.closePause();
    this.game.audio.setAmbienceTarget(1);
  }

  update(): void {
    // Игра стоит: время не идёт, персонаж не двигается.
  }
}

export function createStates(game: Game): ReadonlyMap<GameStateId, GameState> {
  const states: GameState[] = [
    new LoadingState(game),
    new MenuState(game),
    new PlayingState(game),
    new PausedState(game),
  ];
  return new Map(states.map((state) => [state.id, state]));
}
