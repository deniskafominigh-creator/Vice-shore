import { el } from './dom';

export interface MenuButtonOptions {
  readonly disabled?: boolean;
  /** Короткая подпись справа (например, версия сохранения). */
  readonly note?: string;
}

/** Вертикальный список кнопок меню: мышь + клавиатура, всегда видимый фокус.
 *  Источник правды о выборе — реальный DOM-фокус, поэтому Enter/Space работают
 *  нативно, а Tab не ломает навигацию (GOAL.md §7, задача 1). */
export class MenuList {
  readonly root: HTMLUListElement;
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(
    private readonly onHoverSound: () => void,
    private readonly onClickSound: () => void,
  ) {
    this.root = el('ul', { className: 'menu-list' });
    this.root.setAttribute('role', 'menu');
  }

  add(label: string, onActivate: () => void, options: MenuButtonOptions = {}): HTMLButtonElement {
    const text = el('span', { className: 'menu-list__label', text: label });
    const note = options.note ? el('span', { className: 'menu-list__note', text: options.note }) : null;
    const button = el('button', {
      className: 'menu-list__button',
      attrs: { type: 'button', role: 'menuitem' },
    }, text, note);

    if (options.disabled) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }

    button.addEventListener('pointerenter', () => {
      if (button.disabled) return;
      this.onHoverSound();
      button.focus({ preventScroll: true });
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (button.disabled) return;
      this.onClickSound();
      onActivate();
    });

    this.buttons.push(button);
    this.root.append(el('li', { className: 'menu-list__item' }, button));
    return button;
  }

  get enabledButtons(): readonly HTMLButtonElement[] {
    return this.buttons.filter((button) => !button.disabled);
  }

  /** Перемещение по списку с «заворотом» через край. */
  move(delta: number): void {
    const enabled = this.enabledButtons;
    if (enabled.length === 0) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = current === -1
      ? (delta > 0 ? 0 : enabled.length - 1)
      : (current + delta + enabled.length) % enabled.length;
    this.onHoverSound();
    enabled[nextIndex]?.focus({ preventScroll: true });
  }

  focusFirst(): void {
    const enabled = this.enabledButtons;
    if (enabled.length === 0) return;
    enabled[0]?.focus({ preventScroll: true });
  }

  /** Снимаем фокус при скрытии экрана, чтобы он не «прыгал» по странице. */
  blur(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
  }

  setEnabled(index: number, enabled: boolean): void {
    const button = this.buttons[index];
    if (!button) return;
    button.disabled = !enabled;
    if (enabled) button.removeAttribute('aria-disabled');
    else button.setAttribute('aria-disabled', 'true');
  }
}
