import type { Input } from '../core/Input';
import { el } from './dom';

/** Сенсорное управление (задача 11).
 *
 *  Три вещи, которых на телефоне нет у мыши и клавиатуры:
 *  — стик слева (движение, до упора — бег),
 *  — свайп по экрану (обзор), два пальца — приближение,
 *  — кнопки действия: «держать» (ЛКМ — красить, замах и бросок) и «Ⓔ» (взаимодействие).
 *
 *  Модуль ничего не решает про игру: он только пишет в виртуальный слой `Input`,
 *  поэтому миссии покраски и баскетбола работают на телефоне как есть. */

export type TouchMode = 'world' | 'painting';

export interface TouchControlsOptions {
  readonly input: Input;
  readonly onPause: () => void;
  readonly onHover: () => void;
  readonly onClick: () => void;
}

/** Мёртвая зона стика: палец в центре не должен «дрожать» героем. */
const DEAD_ZONE = 0.16;
/** С этого отклонения включается бег — как Shift на клавиатуре. */
const RUN_ZONE = 0.92;
/** Чувствительность щипка: пиксели → шаг приближения камеры. */
const PINCH_SCALE = 0.0038;

export class TouchControls {
  readonly root: HTMLElement;

  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly look: HTMLElement;
  private readonly holdButton: HTMLElement;
  private readonly holdLabel: HTMLElement;
  private readonly actionButton: HTMLElement;
  private readonly actionLabel: HTMLElement;
  private readonly jumpButton: HTMLElement;
  private readonly extras: HTMLElement;
  private readonly rotate: HTMLElement;

  private stickPointer: number | null = null;
  private stickCenter = { x: 0, y: 0 };
  private stickRadius = 1;
  /** Пальцы на зоне обзора: id → последняя точка и позиция в момент нажатия. */
  private readonly lookPointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private mode: TouchMode = 'world';
  private visible = false;

  constructor(private readonly options: TouchControlsOptions) {
    this.stick = el('div', { className: 'touch-stick', attrs: { 'aria-hidden': 'true' } });
    this.knob = el('div', { className: 'touch-stick__knob' });
    this.stick.append(el('div', { className: 'touch-stick__ring' }), this.knob);

    this.look = el('div', { className: 'touch-look', attrs: { 'aria-hidden': 'true' } });

    // Без эмодзи: в наборах Oswald/Inter нет пиктограмм, и «✋» превращался в квадрат.
    this.holdLabel = el('span', { className: 'touch-btn__title', text: 'ДЕРЖАТЬ' });
    this.holdButton = el(
      'button',
      {
        className: 'touch-btn touch-btn--hold',
        attrs: { type: 'button', 'aria-label': 'Держать — красить или бросать' },
      },
      this.holdLabel,
    );

    this.actionLabel = el('span', { className: 'touch-btn__label', text: 'ДЕЙСТВИЕ' });
    this.actionButton = el(
      'button',
      { className: 'touch-btn touch-btn--action', attrs: { type: 'button', 'aria-label': 'Действие' } },
      el('span', { className: 'touch-btn__icon', text: 'Ⓔ' }),
      this.actionLabel,
    );

    // Прыжок — отдельная круглая кнопка слева от «Держать»: на телефоне левый
    // большой палец занят стиком, правый — обзором и действиями.
    this.jumpButton = el(
      'button',
      {
        className: 'touch-btn touch-btn--jump',
        attrs: { type: 'button', 'aria-label': 'Прыжок' },
      },
      el('span', { className: 'touch-btn__icon', text: '↑' }),
      el('span', { className: 'touch-btn__label', text: 'ПРЫЖОК' }),
    );

    this.extras = el(
      'div',
      { className: 'touch-extras' },
      this.smallButton('‹', 'предыдущая полоса', 'KeyA'),
      this.smallButton('МАКНУТЬ', 'макнуть валик', 'KeyR'),
      this.smallButton('›', 'следующая полоса', 'KeyD'),
    );

    const pause = el(
      'button',
      { className: 'touch-pause', attrs: { type: 'button', 'aria-label': 'Пауза' } },
      el('span', { text: 'II' }),
    );
    pause.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.options.onClick();
      this.options.onPause();
    });

    this.rotate = el('div', {
      className: 'touch-rotate',
      text: 'Поверни телефон — в горизонтальном положении видно больше',
    });

    this.root = el(
      'div',
      { className: 'touch-ui is-hidden', attrs: { 'aria-hidden': 'true' } },
      this.look,
      this.stick,
      this.extras,
      this.holdButton,
      this.actionButton,
      this.jumpButton,
      pause,
      this.rotate,
    );

    this.bindStick();
    this.bindLook();
    this.bindHold();
    this.bindAction();
    this.bindJump();
    this.setMode('world');
  }

  get isVisible(): boolean {
    return this.visible;
  }

  get currentMode(): TouchMode {
    return this.mode;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.classList.remove('is-hidden');
    this.root.setAttribute('aria-hidden', 'false');
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.add('is-hidden');
    this.root.setAttribute('aria-hidden', 'true');
    this.reset();
  }

  /** Режим меняет подписи и набор дополнительных кнопок. */
  setMode(mode: TouchMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    const painting = mode === 'painting';
    this.root.classList.toggle('is-painting', painting);
    this.holdLabel.textContent = painting ? 'КРАСИТЬ' : 'ДЕРЖАТЬ';
    this.actionLabel.textContent = painting ? 'ОТОЙТИ' : 'ДЕЙСТВИЕ';
    if (!painting) this.releaseExtras();
  }

  /** Подпись большой кнопки снаружи (например, «БРОСОК», когда мяч в руках). */
  setHoldLabel(text: string): void {
    if (this.mode === 'painting') return;
    this.holdLabel.textContent = text;
  }

  /** Отпустить всё: уход в меню, пауза, потеря фокуса. */
  reset(): void {
    this.stickPointer = null;
    this.knob.style.transform = 'translate3d(0,0,0)';
    this.stick.classList.remove('is-active');
    this.holdButton.classList.remove('is-pressed');
    this.actionButton.classList.remove('is-pressed');
    this.jumpButton.classList.remove('is-pressed');
    this.lookPointers.clear();
    this.pinchDistance = 0;
    this.releaseExtras();
    this.options.input.clearVirtual();
  }

  dispose(): void {
    this.reset();
    this.root.remove();
  }

  // ——— стик ————————————————————————————————————————————————

  private bindStick(): void {
    const start = (event: PointerEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const rect = this.stick.getBoundingClientRect();
      this.stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.stickRadius = Math.max(24, rect.width / 2);
      this.stickPointer = event.pointerId;
      this.stick.classList.add('is-active');
      this.moveStick(event.clientX, event.clientY);
      this.capture(this.stick, event);
    };

    const move = (event: PointerEvent): void => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      this.moveStick(event.clientX, event.clientY);
    };

    const end = (event: PointerEvent): void => {
      if (event.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.knob.style.transform = 'translate3d(0,0,0)';
      this.stick.classList.remove('is-active');
      this.options.input.setVirtualMove(0, 0);
      this.options.input.setVirtualKey('ShiftLeft', false);
    };

    this.stick.addEventListener('pointerdown', start);
    this.stick.addEventListener('pointermove', move);
    this.stick.addEventListener('pointerup', end);
    this.stick.addEventListener('pointercancel', end);
    this.stick.addEventListener('lostpointercapture', end);
  }

  private moveStick(clientX: number, clientY: number): void {
    const dx = clientX - this.stickCenter.x;
    const dy = clientY - this.stickCenter.y;
    const distance = Math.hypot(dx, dy);
    const limit = this.stickRadius * 0.62;
    const scale = distance > limit ? limit / distance : 1;
    const offsetX = dx * scale;
    const offsetY = dy * scale;
    this.knob.style.transform = `translate3d(${offsetX.toFixed(1)}px, ${offsetY.toFixed(1)}px, 0)`;

    const strength = Math.min(1, distance / limit);
    if (strength < DEAD_ZONE) {
      this.options.input.setVirtualMove(0, 0);
      this.options.input.setVirtualKey('ShiftLeft', false);
      return;
    }
    // Приводим к −1…1 уже после мёртвой зоны, чтобы шаг начинался мягко.
    const normalized = (strength - DEAD_ZONE) / (1 - DEAD_ZONE);
    const forward = -(offsetY / limit) / Math.max(1e-3, strength) * 1;
    const strafe = (offsetX / limit) / Math.max(1e-3, strength);
    this.options.input.setVirtualMove(forward * normalized, strafe * normalized);
    this.options.input.setVirtualKey('ShiftLeft', strength >= RUN_ZONE);
  }

  // ——— обзор ————————————————————————————————————————————————

  private bindLook(): void {
    this.look.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.lookPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.lookPointers.size === 2) this.pinchDistance = this.pinchSpan();
      this.capture(this.look, event);
    });

    this.look.addEventListener('pointermove', (event) => {
      const previous = this.lookPointers.get(event.pointerId);
      if (!previous) return;
      event.preventDefault();
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      this.lookPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.lookPointers.size >= 2) {
        // Щипок: приближаем камеру, обзор не крутим — иначе рука «смазывает» кадр.
        const span = this.pinchSpan();
        if (this.pinchDistance > 0) this.options.input.setVirtualZoom((span - this.pinchDistance) * PINCH_SCALE);
        this.pinchDistance = span;
        return;
      }
      this.options.input.setVirtualLook(dx, dy);
    });

    const end = (event: PointerEvent): void => {
      this.lookPointers.delete(event.pointerId);
      if (this.lookPointers.size < 2) this.pinchDistance = 0;
    };
    this.look.addEventListener('pointerup', end);
    this.look.addEventListener('pointercancel', end);
    this.look.addEventListener('lostpointercapture', end);
  }

  private pinchSpan(): number {
    const points = [...this.lookPointers.values()];
    if (points.length < 2) return 0;
    const [a, b] = points;
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ——— кнопки ————————————————————————————————————————————

  private bindHold(): void {
    const press = (event: PointerEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.holdButton.classList.add('is-pressed');
      this.options.onHover();
      this.options.input.setVirtualMouse(0, true);
      this.capture(this.holdButton, event);
    };
    const release = (event: PointerEvent): void => {
      event.preventDefault();
      this.holdButton.classList.remove('is-pressed');
      this.options.input.setVirtualMouse(0, false);
    };
    this.holdButton.addEventListener('pointerdown', press);
    this.holdButton.addEventListener('pointerup', release);
    this.holdButton.addEventListener('pointercancel', release);
    this.holdButton.addEventListener('lostpointercapture', release);
  }

  private bindJump(): void {
    // Кнопка ведёт себя как пробел: короткий тап — прыжок, удержание рядом
    // с мячом — зарядка удара (задача 16). Поэтому здесь именно удержание,
    // а не «тап»: игра сама разбирает, что делать с нажатием.
    this.jumpButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.jumpButton.classList.add('is-pressed');
      this.options.input.setVirtualKey('Space', true);
    });
    const release = (): void => {
      this.jumpButton.classList.remove('is-pressed');
      this.options.input.setVirtualKey('Space', false);
    };
    this.jumpButton.addEventListener('pointerup', release);
    this.jumpButton.addEventListener('pointercancel', release);
    this.jumpButton.addEventListener('lostpointercapture', release);
  }

  private bindAction(): void {
    this.actionButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actionButton.classList.add('is-pressed');
      this.options.onClick();
      // Одно нажатие — одно событие «E»: взять валик, войти в покраску, выйти из неё.
      this.options.input.tapVirtualKey('KeyE');
    });
    const release = (): void => this.actionButton.classList.remove('is-pressed');
    this.actionButton.addEventListener('pointerup', release);
    this.actionButton.addEventListener('pointercancel', release);
    this.actionButton.addEventListener('lostpointercapture', release);
  }

  private smallButton(text: string, label: string, code: string): HTMLElement {
    const button = el(
      'button',
      { className: 'touch-btn touch-btn--small', attrs: { type: 'button', 'aria-label': label } },
      el('span', { text }),
    );
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.classList.add('is-pressed');
      this.options.onClick();
      this.options.input.tapVirtualKey(code);
    });
    const release = (): void => button.classList.remove('is-pressed');
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    return button;
  }

  /** Захват указателя бывает недоступен (синтетические события, отпущенный палец) —
   *  это не повод ронять управление: стик и кнопки продолжают работать. */
  private capture(target: HTMLElement, event: PointerEvent): void {
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      /* без захвата событие просто придёт на элемент, если палец с него не ушёл */
    }
  }

  private releaseExtras(): void {
    for (const button of this.extras.querySelectorAll('.is-pressed')) button.classList.remove('is-pressed');
  }
}
