import type { EventBus } from './EventBus';
import type { GameEventMap } from './Events';

/** Состояния игры. Переходы — только через GameStateMachine (GOAL.md §5.2). */
export type GameStateId = 'boot' | 'loading' | 'menu' | 'playing' | 'paused';

export interface GameState {
  readonly id: GameStateId;
  /** Вызывается при входе. Может быть асинхронным (например, затемнение экрана). */
  enter(): void | Promise<void>;
  /** Вызывается при выходе; обязан освободить ввод/курсор/звук. */
  exit(): void;
  /** Логика кадра. dt — фиксированный шаг (1/60 с). */
  update(dt: number): void;
}

/** Конечный автомат состояний: одна точка правды о том, что сейчас происходит. */
export class GameStateMachine {
  private currentState: GameState | null = null;
  private busy = false;

  constructor(
    private readonly states: ReadonlyMap<GameStateId, GameState>,
    private readonly bus: EventBus<GameEventMap>,
  ) {}

  get current(): GameStateId | null {
    return this.currentState?.id ?? null;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  async change(nextId: GameStateId): Promise<void> {
    if (this.busy) {
      console.warn('[StateMachine] переход уже выполняется, запрос отклонён:', nextId);
      return;
    }
    if (this.currentState?.id === nextId) return;

    const next = this.states.get(nextId);
    if (!next) {
      console.error(`[StateMachine] неизвестное состояние: ${nextId}`);
      return;
    }

    this.busy = true;
    const from = this.currentState?.id ?? null;
    try {
      this.currentState?.exit();
      // Состояние считается текущим сразу, как только начался вход:
      // снаружи (ввод, интерфейс) уже можно спрашивать «где мы», а от повторных
      // переходов защищает флаг busy.
      this.currentState = next;
      await next.enter();
      this.bus.emit('state:changed', { from, to: nextId });
    } catch (error) {
      console.error(`[StateMachine] не удалось перейти в состояние "${nextId}":`, error);
      // Проект не должен оставаться «подвисшим»: возвращаемся в меню.
      if (nextId !== 'menu') {
        this.busy = false;
        this.currentState = null;
        await this.change('menu');
      }
    } finally {
      this.busy = false;
    }
  }

  update(dt: number): void {
    this.currentState?.update(dt);
  }
}
