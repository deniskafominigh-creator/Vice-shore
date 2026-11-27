import { el } from './dom';

export type ToastTone = 'info' | 'success' | 'warning';

/** Плашки сообщений. Сборка v22: **одна плашка на экран**.
 *
 *  Заказчик назвал главной помехой «ощущение каши» — и первым делом каша была
 *  именно здесь: три-четыре тоста могли висеть друг на друге, закрывая пол-экрана
 *  на телефоне. Теперь сообщения идут очередью: пока одно видно, остальные ждут.
 *  Очередь короткая (2 сообщения), одинаковый текст второй раз не повторяется,
 *  а «важное» (warning/success) вытесняет то, что ждёт, — но не то, что уже видно.
 */

const MAX_QUEUE = 2;

interface PendingToast {
  readonly text: string;
  readonly tone: ToastTone;
  readonly duration: number;
}

export class Toasts {
  readonly root: HTMLElement;

  private active: HTMLElement | null = null;
  private activeText = '';
  private timer = 0;
  private readonly queue: PendingToast[] = [];

  constructor() {
    this.root = el('div', { className: 'toasts', attrs: { 'aria-live': 'polite' } });
  }

  show(text: string, tone: ToastTone = 'info', duration = 2600): void {
    if (!text) return;
    // Тот же текст, что уже висит или ждёт, — не повторяем
    if (text === this.activeText) return;
    if (this.queue.some((item) => item.text === text)) return;

    if (this.active) {
      if (tone === 'info') {
        // Обычное сообщение не вытесняет то, что читают: встаём в очередь
        if (this.queue.length >= MAX_QUEUE) this.queue.shift();
        this.queue.push({ text, tone, duration });
      } else {
        // Предупреждение и успех важнее: старое убираем сразу, новое показываем
        this.finishActive();
        this.present({ text, tone, duration });
      }
      return;
    }
    this.present({ text, tone, duration });
  }

  /** Сколько сообщений ждёт в очереди — для проверок. */
  get queued(): number {
    return this.queue.length;
  }

  /** Висит ли плашка прямо сейчас. */
  get visible(): boolean {
    return this.active !== null;
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.finishActive();
    this.queue.length = 0;
  }

  private present(item: PendingToast): void {
    const node = el('div', {
      className: `toast${item.tone === 'info' ? '' : ` toast--${item.tone}`}`,
      text: item.text,
    });
    this.root.append(node);
    this.active = node;
    this.activeText = item.text;
    requestAnimationFrame(() => node.classList.add('is-visible'));
    this.timer = window.setTimeout(() => {
      this.finishActive();
      this.drain();
    }, item.duration);
  }

  private finishActive(): void {
    window.clearTimeout(this.timer);
    const node = this.active;
    this.active = null;
    this.activeText = '';
    if (!node) return;
    node.classList.remove('is-visible');
    window.setTimeout(() => node.remove(), 320);
  }

  private drain(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (next) this.present(next);
  }
}
