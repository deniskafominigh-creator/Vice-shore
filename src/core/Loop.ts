/** Игровой цикл: один requestAnimationFrame, фиксированный шаг физики 1/60 с
 *  и ограничение dt сверху, чтобы после сворачивания вкладки мир не «прыгал»
 *  (GOAL.md §5.1). */

export const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1; // максимум, что вообще принимаем от часов
const MAX_STEPS_PER_FRAME = 5; // защита от «спирали смерти» при просадках

export interface LoopCallbacks {
  /** Логика с фиксированным шагом. */
  readonly fixedUpdate: (dt: number) => void;
  /** Отрисовка: вызывается один раз в кадр, alpha — остаток между шагами. */
  readonly render: (dt: number, alpha: number) => void;
}

export class Loop {
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;

  constructor(private readonly callbacks: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const rawDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const frameDelta = Math.min(Math.max(rawDelta, 0), MAX_FRAME_DELTA);

    this.accumulator += frameDelta;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.callbacks.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    // Если не успели — не копим долг бесконечно.
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.callbacks.render(frameDelta, this.accumulator / FIXED_STEP);
  };
}
