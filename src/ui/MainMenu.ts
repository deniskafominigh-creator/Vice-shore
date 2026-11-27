import { GAME } from '../core/Config';
import { el } from './dom';
import { MenuList } from './MenuList';

export interface MainMenuCallbacks {
  readonly onPlay: () => void;
  readonly onContinue: () => void;
  readonly onSettings: () => void;
  readonly onControls: () => void;
  readonly onExit: () => void;
  readonly onHover: () => void;
  readonly onClick: () => void;
}

/** Главное меню: живой 3D-фон позади, крупная типографика, полная клавиатурная навигация. */
export class MainMenu {
  readonly root: HTMLElement;
  private readonly list: MenuList;

  constructor(callbacks: MainMenuCallbacks) {
    this.list = new MenuList(callbacks.onHover, callbacks.onClick);
    this.list.add('Играть', callbacks.onPlay);
    this.list.add('Продолжить', callbacks.onContinue, { disabled: true, note: 'нет сохранения' });
    this.list.add('Настройки', callbacks.onSettings);
    this.list.add('Управление', callbacks.onControls);
    this.list.add('Выход', callbacks.onExit);

    this.root = el(
      'section',
      { className: 'screen menu is-hidden', attrs: { 'aria-label': 'Главное меню' } },
      el(
        'div',
        { className: 'menu__brand' },
        el('div', { className: 'menu__eyebrow', text: 'Вилла у моря · пролог' }),
        el('h1', { className: 'menu__title' }, 'VICE', el('br'), 'SH', el('em', { text: 'O' }), 'RE'),
        el('div', { className: 'menu__subtitle', text: GAME.subtitle }),
      ),
      el('nav', { className: 'menu__nav', attrs: { 'aria-label': 'Меню' } }, this.list.root),
      el(
        'footer',
        { className: 'menu__footer' },
        el('span', {}, 'Версия ', el('b', { text: GAME.version })),
        el('span', { className: 'only-keyboard', text: '↑ ↓ — выбор · Enter — подтвердить' }),
        el('span', { className: 'only-touch', text: 'Нажми пункт пальцем' }),
      ),
    );
  }

  /** «Продолжить» активна только при наличии сохранения. */
  setSaveAvailable(available: boolean): void {
    this.list.setEnabled(1, available);
    const note = this.list.root.querySelector('.menu-list__item:nth-child(2) .menu-list__note');
    if (note) note.textContent = available ? 'прогресс сохранён' : 'нет сохранения';
  }

  show(): void {
    this.root.classList.remove('is-hidden');
    // Фокус ставим после того, как экран стал видимым — иначе браузер «теряет» его.
    requestAnimationFrame(() => this.list.focusFirst());
  }

  hide(): void {
    this.list.blur();
    this.root.classList.add('is-hidden');
  }

  get isVisible(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  handleKey(code: string): boolean {
    if (!this.isVisible) return false;
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        this.list.move(-1);
        return true;
      case 'ArrowDown':
      case 'KeyS':
        this.list.move(1);
        return true;
      default:
        return false;
    }
  }
}
