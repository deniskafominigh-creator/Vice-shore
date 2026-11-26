import { CONTROLS, TOUCH_CONTROLS } from '../core/Config';
import { el } from './dom';
import { Panel } from './Panel';
import type { UiEnvironment } from './Ui';

/** Управление: подсказки берутся из единых списков CONTROLS / TOUCH_CONTROLS,
 *  а не пишутся вручную. На телефоне первой идёт сенсорная раскладка. */
export class ControlsPanel extends Panel {
  constructor(onClick: () => void, onClose: () => void, environment: UiEnvironment) {
    const touch = environment.getScheme() === 'touch';
    super({
      eyebrow: 'Управление',
      title: touch ? 'Сенсор и жесты' : 'Клавиши и мышь',
      onClose,
    });

    const table = el('div', { className: 'controls-table' });
    const bindings = touch ? [...TOUCH_CONTROLS, ...CONTROLS] : CONTROLS;
    for (const binding of bindings) {
      const keys = el('div', { className: 'controls-table__keys' });
      for (const key of binding.keys) keys.append(el('span', { className: 'keycap', text: key }));

      table.append(
        el(
          'div',
          { className: 'controls-table__row' },
          keys,
          el(
            'div',
            { className: 'controls-table__text' },
            el('b', { text: binding.label }),
            binding.description,
          ),
        ),
      );
    }

    this.body.append(table);
    this.body.append(
      el('div', {
        className: 'panel__note',
        text:
          'Переназначение клавиш появится позже — сейчас раскладка фиксированная. ' +
          'Схему управления можно переключить в настройках: «Авто» подстраивается под устройство.',
      }),
    );

    const done = el('button', { className: 'btn btn--primary', text: 'Понятно', attrs: { type: 'button' } });
    done.addEventListener('click', () => {
      onClick();
      onClose();
    });
    this.footer.append(done);
  }
}
