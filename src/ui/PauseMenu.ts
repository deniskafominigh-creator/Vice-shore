import { el } from './dom';
import { MenuList } from './MenuList';
import { Panel } from './Panel';

export interface PauseMenuCallbacks {
  readonly onResume: () => void;
  readonly onSettings: () => void;
  readonly onControls: () => void;
  readonly onExitToMenu: () => void;
  readonly onHover: () => void;
  readonly onClick: () => void;
}

/** Пауза. Esc здесь = «Продолжить», как и ожидает игрок. */
export class PauseMenu extends Panel {
  private readonly list: MenuList;

  constructor(private readonly callbacks: PauseMenuCallbacks) {
    super({ eyebrow: 'Пауза', title: 'Игра остановлена', onClose: callbacks.onResume });

    this.list = new MenuList(callbacks.onHover, callbacks.onClick);
    this.list.add('Продолжить', callbacks.onResume);
    this.list.add('Настройки', callbacks.onSettings);
    this.list.add('Управление', callbacks.onControls);
    this.list.add('В главное меню', callbacks.onExitToMenu);

    this.body.append(this.list.root);
    this.body.append(
      el(
        'div',
        { className: 'panel__note' },
        el('span', { className: 'only-keyboard', text: 'Esc — вернуться в игру.' }),
        el('span', { className: 'only-touch', text: '«Продолжить» вернёт в игру.' }),
      ),
    );
  }

  override show(): void {
    this.root.classList.remove('is-hidden');
    requestAnimationFrame(() => this.list.focusFirst());
  }

  override hide(): void {
    this.list.blur();
    super.hide();
  }

  override handleKey(code: string): boolean {
    if (!this.isVisible) return false;
    switch (code) {
      case 'Escape':
        this.callbacks.onResume();
        return true;
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
