import { clamp } from './MathUtils';

/** Ввод: клавиатура + мышь + pointer lock, а с задачи 11 — ещё и виртуальный слой
 *  для сенсорного управления (`setVirtualMove`, `setVirtualLook`, `setVirtualKey`).
 *
 *  Виртуальный слой не отдельная ветка логики: он вливается в те же самые вопросы
 *  `isDown` / `wasPressed` / `axis` / `consumeMouseDelta`. Поэтому миссии (покраска, бросок)
 *  и камера работают на телефоне без единой правки в своём коде — они просто спрашивают
 *  «зажато ли действие», а уж кто его зажал — палец или мышь — им не важно.
 *
 *  Модуль ничего не знает о состояниях игры — он лишь сообщает факты, решение принимает состояние. */

export interface InputOptions {
  readonly canvas: HTMLCanvasElement;
  /** Текущая чувствительность мыши из настроек (1.0 — базовая). */
  readonly getSensitivity: () => number;
  readonly getInvertY: () => boolean;
}

export type LockChangeHandler = (locked: boolean) => void;

export class Input {
  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private readonly keyDownListeners = new Set<(code: string, event: KeyboardEvent) => void>();
  private readonly lockListeners = new Set<LockChangeHandler>();

  private mouseDX = 0;
  private mouseDY = 0;
  /** Кнопки мыши: 0 — левая (задача 7: красить/бросать по удержанию). */
  private readonly mouseDown = new Set<number>();
  private readonly mousePressedThisFrame = new Set<number>();
  private locked = false;

  // ——— виртуальный слой (сенсорное управление, задача 11) ————————————————
  /** Нажатия «пальцем»: те же коды клавиш, что и на клавиатуре. */
  private readonly virtualKeys = new Set<string>();
  private readonly virtualPressed = new Set<string>();
  private readonly virtualMouse = new Set<number>();
  private readonly virtualMousePressed = new Set<number>();
  /** Стик: −1…1 по каждой оси (forward — вперёд, strafe — вправо). */
  private virtualForward = 0;
  private virtualStrafe = 0;
  /** Накопленное движение пальца по экрану обзора, в пикселях. */
  private virtualLookX = 0;
  private virtualLookY = 0;
  /** Щипок двумя пальцами — приближение камеры. */
  private virtualZoom = 0;
  /** После захвата мыши браузер присылает «скачок» курсора к центру экрана.
   *  Эти миллисекунды игнорируем — иначе камера дёргается в момент входа в игру. */
  private ignoreMouseUntil = 0;
  private static readonly LOCK_GRACE_MS = 250;
  /** Один «человеческий» рывок мыши не бывает больше этого; всё резче — сбой захвата курсора. */
  private static readonly MAX_MOUSE_DELTA = 110;
  private static readonly MAX_STEP_PIXELS = 180;

  constructor(private readonly options: InputOptions) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
  }

  /** Нажата ли клавиша прямо сейчас (удержание): клавиатура или палец. */
  isDown(code: string): boolean {
    return this.down.has(code) || this.virtualKeys.has(code);
  }

  /** Была ли клавиша нажата именно в этом кадре (edge). */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code) || this.virtualPressed.has(code);
  }

  /** Зажата ли кнопка мыши (0 — левая): мышь или кнопка «держать» на сенсорном экране. */
  isMouseDown(button = 0): boolean {
    return this.mouseDown.has(button) || this.virtualMouse.has(button);
  }

  /** Была ли кнопка мыши нажата именно в этом кадре. */
  wasMousePressed(button = 0): boolean {
    return this.mousePressedThisFrame.has(button) || this.virtualMousePressed.has(button);
  }

  /** Ось из двух клавиш: -1 / 0 / 1 (без «залипания» при одновременном нажатии).
   *  Виртуальный стик добавляется к клавишам: на телефоне WASD заменяет джойстик. */
  axis(negative: string, positive: string): number {
    const neg = this.down.has(negative) ? 1 : 0;
    const pos = this.down.has(positive) ? 1 : 0;
    let virtual = 0;
    if (negative === 'KeyS' && positive === 'KeyW') virtual = this.virtualForward;
    else if (negative === 'KeyA' && positive === 'KeyD') virtual = this.virtualStrafe;
    return clamp(pos - neg + virtual, -1, 1);
  }

  /** Приращение обзора за кадр, уже с учётом чувствительности и инверсии.
   *  Мышь и палец складываются: оба источника пишут в один и тот же счётчик. */
  consumeMouseDelta(): { x: number; y: number } {
    const sensitivity = clamp(this.options.getSensitivity(), 0.1, 3);
    const invert = this.options.getInvertY() ? -1 : 1;
    const limit = Input.MAX_STEP_PIXELS;
    const dx = clamp(this.mouseDX + this.virtualLookX, -limit, limit);
    const dy = clamp(this.mouseDY + this.virtualLookY, -limit, limit);
    const result = { x: dx * sensitivity, y: dy * sensitivity * invert };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.virtualLookX = 0;
    this.virtualLookY = 0;
    return result;
  }

  /** Приближение камеры за кадр (щипок двумя пальцами). Ноль — если не трогали. */
  consumeZoomDelta(): number {
    const delta = this.virtualZoom;
    this.virtualZoom = 0;
    return delta;
  }

  // ——— виртуальный слой ————————————————————————————————————————

  /** Стик: forward — вперёд (+1), strafe — вправо (+1). Значения вне −1…1 обрезаются. */
  setVirtualMove(forward: number, strafe: number): void {
    this.virtualForward = clamp(forward, -1, 1);
    this.virtualStrafe = clamp(strafe, -1, 1);
  }

  /** Палец по экрану обзора: пиксели за кадр (складываются с мышью). */
  setVirtualLook(dx: number, dy: number): void {
    this.virtualLookX += dx;
    this.virtualLookY += dy;
  }

  /** Виртуальная клавиша: down=true — удержание, down=false — отпускание.
   *  Нажатие всегда даёт и «edge» в текущем кадре. */
  setVirtualKey(code: string, down: boolean): void {
    if (down) {
      if (!this.virtualKeys.has(code)) this.virtualPressed.add(code);
      this.virtualKeys.add(code);
    } else {
      this.virtualKeys.delete(code);
    }
  }

  /** Одно нажатие «в этом кадре»: нажали и отпустили — как тап по кнопке. */
  tapVirtualKey(code: string): void {
    this.virtualPressed.add(code);
  }

  /** Виртуальная кнопка мыши (сенсорная кнопка «держать»). */
  setVirtualMouse(button: number, down: boolean): void {
    if (down) {
      if (!this.virtualMouse.has(button)) this.virtualMousePressed.add(button);
      this.virtualMouse.add(button);
    } else {
      this.virtualMouse.delete(button);
    }
  }

  /** Щипок: положительное значение приближает камеру. */
  setVirtualZoom(delta: number): void {
    this.virtualZoom += delta;
  }

  /** Сбросить весь виртуальный слой (уход в меню, потеря фокуса, смена схемы). */
  clearVirtual(): void {
    this.virtualKeys.clear();
    this.virtualPressed.clear();
    this.virtualMouse.clear();
    this.virtualMousePressed.clear();
    this.virtualForward = 0;
    this.virtualStrafe = 0;
    this.virtualLookX = 0;
    this.virtualLookY = 0;
    this.virtualZoom = 0;
  }

  get isPointerLocked(): boolean {
    return this.locked;
  }

  /** Запрос захвата мыши. Возвращает true, если захват удался (или уже был). */
  async requestPointerLock(): Promise<boolean> {
    if (this.locked) return true;
    try {
      const maybePromise = this.options.canvas.requestPointerLock() as unknown;
      if (maybePromise instanceof Promise) await maybePromise;
      return true;
    } catch (error) {
      // Браузер может отказать (например, сразу после Esc). Это не ошибка игры.
      console.warn('[Input] pointer lock недоступен:', error);
      return false;
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onKeyDownGlobal(listener: (code: string, event: KeyboardEvent) => void): () => void {
    this.keyDownListeners.add(listener);
    return () => this.keyDownListeners.delete(listener);
  }

  onPointerLockChange(listener: LockChangeHandler): () => void {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  }

  /** Вызывается в конце кадра: сбрасывает «одноразовые» состояния. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.mousePressedThisFrame.clear();
    this.virtualPressed.clear();
    this.virtualMousePressed.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.handlePointerLockError);
    this.down.clear();
    this.pressedThisFrame.clear();
    this.clearVirtual();
    this.keyDownListeners.clear();
    this.lockListeners.clear();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Space/стрелки не должны скроллить страницу, Tab — уводить фокус из игры.
    if (event.code === 'Space' || event.code.startsWith('Arrow') || event.code === 'Tab') {
      event.preventDefault();
    }
    if (!event.repeat) {
      this.down.add(event.code);
      this.pressedThisFrame.add(event.code);
      for (const listener of this.keyDownListeners) listener(event.code, event);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 && event.button !== 2) return;
    this.mouseDown.add(event.button);
    this.mousePressedThisFrame.add(event.button);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.mouseDown.delete(event.button);
  };

  /** Правая кнопка не должна открывать меню браузера поверх игры. */
  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.locked) event.preventDefault();
  };

  private readonly onWindowBlur = (): void => {
    this.down.clear();
    this.pressedThisFrame.clear();
    this.mouseDown.clear();
    this.mousePressedThisFrame.clear();
    this.clearVirtual();
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    if (performance.now() < this.ignoreMouseUntil) return;
    // Захват курсора иногда присылает «прыжок» от курсора к центру экрана —
    // такой дельтой камера мгновенно уезжает в небо. Ограничиваем шаг.
    const limit = Input.MAX_MOUSE_DELTA;
    this.mouseDX += Math.max(-limit, Math.min(limit, event.movementX));
    this.mouseDY += Math.max(-limit, Math.min(limit, event.movementY));
  };

  private readonly handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.options.canvas;
    if (locked === this.locked) return;
    this.locked = locked;
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (locked) this.ignoreMouseUntil = performance.now() + Input.LOCK_GRACE_MS;
    for (const listener of this.lockListeners) listener(locked);
  };

  private readonly handlePointerLockError = (): void => {
    this.locked = false;
    for (const listener of this.lockListeners) listener(false);
  };
}
