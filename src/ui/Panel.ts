import { el } from './dom';

export interface PanelOptions {
  readonly eyebrow: string;
  readonly title: string;
  /** Закрытие по Esc или клику по фону. */
  readonly onClose: () => void;
}

/** Что Ui умеет показывать модально: панели и экранные диалоги (задача 19). */
export interface Modal {
  readonly root: HTMLElement;
  show(): void;
  hide(): void;
  readonly isVisible: boolean;
  handleKey(code: string): boolean;
}

/** Базовая модальная панель: настройки, управление, пауза строятся на ней. */
export class Panel implements Modal {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly footer: HTMLElement;

  protected constructor(readonly options: PanelOptions) {
    this.body = el('div', { className: 'panel__body' });
    this.footer = el('div', { className: 'panel__footer' });

    const card = el(
      'div',
      { className: 'panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title } },
      el('div', { className: 'panel__eyebrow', text: options.eyebrow }),
      el('h2', { className: 'panel__title', text: options.title }),
      this.body,
      this.footer,
    );

    this.root = el('div', { className: 'modal is-hidden' }, card);
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.options.onClose();
    });
  }

  show(): void {
    this.root.classList.remove('is-hidden');
    const first = this.root.querySelector<HTMLElement>('button:not(:disabled), input');
    first?.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.classList.add('is-hidden');
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
  }

  get isVisible(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  /** Esc закрывает панель. Возвращает true, если событие обработано. */
  handleKey(code: string): boolean {
    if (!this.isVisible) return false;
    if (code === 'Escape') {
      this.options.onClose();
      return true;
    }
    return false;
  }

  protected addRow(label: string, hint: string | null, control: HTMLElement): HTMLElement {
    const labelNode = el('div', { className: 'panel__label' }, label);
    if (hint) labelNode.append(el('small', { text: hint }));
    const row = el('div', { className: 'panel__row' }, labelNode, el('div', { className: 'panel__control' }, control));
    this.body.append(row);
    return row;
  }
}
