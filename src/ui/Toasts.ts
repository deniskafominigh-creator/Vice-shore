import { el } from './dom';

export type ToastTone = 'info' | 'success' | 'warning';

/** Всплывающие сообщения: короткая обратная связь на действие игрока. */
export class Toasts {
  readonly root: HTMLElement;

  constructor() {
    this.root = el('div', { className: 'toasts', attrs: { 'aria-live': 'polite' } });
  }

  show(text: string, tone: ToastTone = 'info', duration = 2600): void {
    const node = el('div', { className: `toast${tone === 'info' ? '' : ` toast--${tone}`}`, text });
    this.root.append(node);
    requestAnimationFrame(() => node.classList.add('is-visible'));
    window.setTimeout(() => {
      node.classList.remove('is-visible');
      window.setTimeout(() => node.remove(), 320);
    }, duration);
  }
}
