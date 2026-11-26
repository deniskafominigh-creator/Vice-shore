import { el } from './dom';
import { Panel } from './Panel';

/** Разговор с кассиром (задача 18): вопрос кнопками + ответ кассира.
 *  Панель ничего не решает — она показывает то, что даёт `TicketOffice`,
 *  и сообщает наружу, какой вопрос выбрали. */

export interface TalkOption {
  readonly id: string;
  readonly label: string;
  /** Подпись справа: цена, «куплен», «уже в кармане». */
  readonly note?: string;
  readonly disabled?: boolean;
}

export interface TalkHandlers {
  readonly onAsk: (id: string) => void;
  readonly onClose: () => void;
}

export class TalkPanel extends Panel {
  private readonly answer: HTMLElement;
  private readonly list: HTMLElement;
  private readonly speaker: HTMLElement;
  private current: readonly TalkOption[] = [];

  constructor(private readonly handlers: TalkHandlers, eyebrow: string, title: string) {
    super({ eyebrow, title, onClose: handlers.onClose });
    this.speaker = el('div', { className: 'talk__speaker' });
    this.answer = el('div', { className: 'talk__answer' });
    this.list = el('div', { className: 'talk__options' });
    this.body.append(this.speaker, this.answer, this.list);
    this.footer.append(
      el('div', { className: 'panel__note', text: '1 … 6 — спросить · Esc — уйти' }),
    );
  }

  /** Что кассир ответил (текст его реплики). */
  setAnswer(who: string, text: string | null): void {
    this.speaker.textContent = who;
    this.answer.textContent = text ?? '…';
    this.answer.classList.toggle('is-empty', !text);
  }

  setOptions(list: readonly TalkOption[]): void {
    this.current = list;
    this.list.replaceChildren(
      ...list.map((option, index) => {
        const button = el(
          'button',
          {
            className: 'talk__option',
            attrs: { type: 'button', 'data-question': option.id },
          },
          el('span', { className: 'talk__key', text: String(index + 1) }),
          el('span', { className: 'talk__label', text: option.label }),
        );
        if (option.note) button.append(el('span', { className: 'talk__note', text: option.note }));
        button.disabled = Boolean(option.disabled);
        button.addEventListener('click', () => {
          if (option.disabled) return;
          this.handlers.onAsk(option.id);
        });
        return button;
      }),
    );
  }

  /** Номерные клавиши: на клавиатуре быстрее, чем целиться мышью. */
  override handleKey(code: string): boolean {
    if (!this.isVisible) return false;
    if (super.handleKey(code)) return true;
    const match = /^Digit([1-9])$/.exec(code) ?? /^Numpad([1-9])$/.exec(code);
    if (!match) return false;
    const index = Number(match[1]) - 1;
    const option = this.current[index];
    if (!option || option.disabled) return true;
    this.handlers.onAsk(option.id);
    return true;
  }
}
