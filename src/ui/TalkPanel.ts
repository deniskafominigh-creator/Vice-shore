import { el } from './dom';
import type { Modal } from './Panel';

/** Разговор с кассиром (задача 18, вид переделан в задаче 19).
 *
 *  Не «модалка настроек», а сцена разговора в духе современных GTA:
 *   - кинематографические полосы сверху и снизу и лёгкое затемнение кадра;
 *   - слева-снизу блок говорящего: монограмма, имя капсом, реплика крупным текстом;
 *   - справа вертикальное меню вопросов с номером-клавишей, подсветкой и подсказкой;
 *   - всё въезжает снизу и гаснет по Esc, ввод — клавишами 1…6 или мышью.
 *  Логика ответов живёт в `TicketOffice`, поэтому панель ничего не решает сама. */

export interface TalkOption {
  readonly id: string;
  readonly label: string;
  /** Подпись справа: цена, «куплен», «заявка подана». */
  readonly note?: string;
  readonly disabled?: boolean;
}

export interface TalkHandlers {
  readonly onAsk: (id: string) => void;
  readonly onClose: () => void;
}

export interface TalkPanelOptions {
  readonly speaker: string;
  readonly role: string;
  /** Одна буква для монограммы. */
  readonly monogram: string;
}

export class TalkPanel implements Modal {
  readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly role: HTMLElement;
  private readonly monogram: HTMLElement;
  private readonly text: HTMLElement;
  private readonly menu: HTMLElement;
  private current: readonly TalkOption[] = [];
  private visible = false;

  constructor(private readonly handlers: TalkHandlers, options: TalkPanelOptions) {
    this.monogram = el('span', { className: 'talk__monogram', text: options.monogram });
    this.name = el('span', { className: 'talk__name', text: options.speaker });
    this.role = el('span', { className: 'talk__role', text: options.role });
    this.text = el('p', { className: 'talk__text' });
    this.menu = el('nav', { className: 'talk__menu', attrs: { 'aria-label': 'Вопросы' } });

    const line = el(
      'section',
      { className: 'talk__line' },
      el('div', { className: 'talk__who' }, this.monogram, el('div', { className: 'talk__caption' }, this.name, this.role)),
      el('div', { className: 'talk__bubble' }, this.text),
    );

    this.root = el(
      'div',
      {
        className: 'talk is-hidden',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Разговор: ${options.speaker}` },
      },
      el('div', { className: 'talk__scrim' }),
      el('div', { className: 'talk__letterbox talk__letterbox--top' }),
      el('div', { className: 'talk__letterbox talk__letterbox--bottom' }),
      el('div', { className: 'talk__stage' }, line, this.menu),
      el('div', { className: 'talk__legend', text: '1 … 6 — спросить · Esc — уйти' }),
    );

    // Клик по пустому месту — тоже «уйти»: привычнее, чем искать Esc.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root || (event.target as HTMLElement).classList.contains('talk__scrim')) {
        this.handlers.onClose();
      }
    });
  }

  show(): void {
    this.visible = true;
    this.root.classList.remove('is-hidden');
    // Даём кадр на перерисовку, чтобы сработала анимация входа.
    requestAnimationFrame(() => this.root.classList.add('is-live'));
    const first = this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)');
    first?.focus({ preventScroll: true });
  }

  hide(): void {
    this.visible = false;
    this.root.classList.remove('is-live');
    this.root.classList.add('is-hidden');
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Реплика кассира. Пусто — «…», пока он думает/молчит. */
  setAnswer(who: string, text: string | null): void {
    if (who) this.name.textContent = who;
    this.text.textContent = text ?? '…';
    this.text.classList.toggle('is-empty', !text);
    // Лёгкий «вдох» реплики: каждый новый ответ проявляется, а не подменяется молча.
    this.text.classList.remove('is-fresh');
    void this.text.offsetWidth;
    this.text.classList.add('is-fresh');
  }

  setOptions(list: readonly TalkOption[]): void {
    this.current = list;
    this.menu.replaceChildren(
      ...list.map((option, index) => {
        const button = el(
          'button',
          {
            className: 'talk__choice',
            attrs: { type: 'button', 'data-question': option.id },
          },
          el('span', { className: 'talk__choice-index', text: String(index + 1) }),
          el('span', { className: 'talk__choice-label', text: option.label }),
        );
        if (option.note) button.append(el('span', { className: 'talk__choice-note', text: option.note }));
        button.append(el('span', { className: 'talk__choice-arrow', text: '›' }));
        button.disabled = Boolean(option.disabled);
        button.addEventListener('click', () => {
          if (option.disabled) return;
          this.handlers.onAsk(option.id);
        });
        return button;
      }),
    );
  }

  handleKey(code: string): boolean {
    if (!this.visible) return false;
    if (code === 'Escape') {
      this.handlers.onClose();
      return true;
    }
    const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (!match) return false;
    const option = this.current[Number(match[1]) - 1];
    if (!option || option.disabled) return true;
    this.handlers.onAsk(option.id);
    return true;
  }
}
