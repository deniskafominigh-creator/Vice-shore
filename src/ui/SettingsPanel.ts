import {
  QUALITY_ORDER,
  QUALITY_PRESETS,
  SUBTITLE_BACKDROPS,
  SUBTITLE_BACKDROP_LABELS,
  SUBTITLE_FONTS,
  SUBTITLE_FONT_LABELS,
  type QualityLevel,
  type SubtitleBackdrop,
  type SubtitleFont,
} from '../core/Config';
import {
  CONTROL_PREFERENCES,
  describePreference,
  type ControlPreference,
  type PlatformInfo,
} from '../core/Platform';
import type { FullscreenController } from '../core/Fullscreen';
import type { UiEnvironment } from './Ui';
import type { EventBus } from '../core/EventBus';
import type { GameEventMap } from '../core/Events';
import type { SettingsStore } from '../core/Settings';
import { clamp01 } from '../core/MathUtils';
import { el } from './dom';
import { Panel } from './Panel';

/** Настройки. Показываем только те параметры, которые реально работают.
 *  Задача 11 добавила сюда схему управления и полноэкранный режим. */
export class SettingsPanel extends Panel {
  private readonly syncers: Array<() => void> = [];

  constructor(
    private readonly settings: SettingsStore,
    bus: EventBus<GameEventMap>,
    private readonly onHover: () => void,
    private readonly onClick: () => void,
    onClose: () => void,
    environment: UiEnvironment,
  ) {
    super({ eyebrow: 'Настройки', title: 'Параметры игры', onClose });

    const platform: PlatformInfo = environment.platform;
    const fullscreen: FullscreenController = environment.fullscreen;

    this.addRow(
      'Качество графики',
      'Детализация волн, тени, разрешение кадра',
      this.buildSegmented<QualityLevel>(
        QUALITY_ORDER,
        (value) => QUALITY_PRESETS[value].label,
        () => this.settings.get('quality'),
        (value) => this.settings.set('quality', value),
      ),
    );

    this.addRow(
      'Управление',
      `Определено: ${platform.label.toLowerCase()} — ${platform.reason}`,
      this.buildSegmented<ControlPreference>(
        CONTROL_PREFERENCES,
        (value) => describePreference(value, platform),
        () => this.settings.get('controls'),
        (value) => this.settings.set('controls', value),
      ),
    );

    const fullscreenSupported = fullscreen.supported;
    this.addRow(
      'Полноэкранный режим',
      fullscreenSupported
        ? 'Игра на весь экран, без адресной строки'
        : 'На iPhone Safari полный экран недоступен — добавь игру на экран «Домой»',
      this.buildSwitch(
        () => fullscreen.active,
        (value) => {
          this.settings.set('fullscreen', value);
          // Здесь мы в обработчике нажатия — браузер разрешит смену режима.
          void (value ? fullscreen.request() : fullscreen.exit()).then((ok) => {
            if (!ok && value) this.settings.set('fullscreen', false);
            this.sync();
          });
        },
        { disabled: !fullscreenSupported },
      ),
    );

    this.addRow(
      environment.getScheme() === 'touch' ? 'Чувствительность обзора' : 'Чувствительность мыши',
      environment.getScheme() === 'touch' ? 'Скорость поворота обзора свайпом' : 'Скорость поворота камеры',
      this.buildRange(
        0.25,
        2.5,
        0.05,
        () => this.settings.get('mouseSensitivity'),
        (value) => this.settings.set('mouseSensitivity', value),
        (value) => `×${value.toFixed(2)}`,
      ),
    );

    this.addRow(
      'Инверсия мыши по вертикали',
      'Для привычного «самолётного» управления',
      this.buildSwitch(() => this.settings.get('invertY'), (value) => this.settings.set('invertY', value)),
    );

    // ——— интерфейс: что показывать поверх игры (задача 12) ——————————
    this.body.append(el('div', { className: 'panel__group', text: 'Интерфейс' }));

    this.addRow(
      'Подсказки управления',
      'Строка с клавишами внизу и в HUD миссии',
      this.buildSwitch(
        () => this.settings.get('showControlHints'),
        (value) => this.settings.set('showControlHints', value),
      ),
    );

    this.addRow(
      'Подсказки действий',
      '«E — взять валик» по центру экрана',
      this.buildSwitch(
        () => this.settings.get('showActionPrompts'),
        (value) => this.settings.set('showActionPrompts', value),
      ),
    );

    this.addRow(
      'Задачи и прогресс',
      'Плашка задачи и полоса «КОМНАТА / ГОЛЫ»',
      this.buildSwitch(
        () => this.settings.get('showMissionHud'),
        (value) => this.settings.set('showMissionHud', value),
      ),
    );

    // ——— субтитры: шрифт и фон плашки ————————————————————————————
    this.body.append(el('div', { className: 'panel__group', text: 'Субтитры' }));

    this.addRow(
      'Субтитры реплик',
      'Дублировать голос героя текстом',
      this.buildSwitch(() => this.settings.get('subtitles'), (value) => this.settings.set('subtitles', value)),
    );

    this.addRow(
      'Шрифт субтитров',
      'Кинематограф — крупный шрифт с засечками',
      this.buildSegmented<SubtitleFont>(
        SUBTITLE_FONTS,
        (value) => SUBTITLE_FONT_LABELS[value],
        () => this.settings.get('subtitleFont'),
        (value) => this.settings.set('subtitleFont', value),
      ),
    );

    this.addRow(
      'Фон субтитров',
      'Плёнка — градиент с золотой полосой',
      this.buildSegmented<SubtitleBackdrop>(
        SUBTITLE_BACKDROPS,
        (value) => SUBTITLE_BACKDROP_LABELS[value],
        () => this.settings.get('subtitleBackdrop'),
        (value) => this.settings.set('subtitleBackdrop', value),
      ),
    );

    // ——— звук ————————————————————————————————————————————————————
    this.body.append(el('div', { className: 'panel__group', text: 'Звук' }));

    this.addRow(
      'Общая громкость',
      null,
      this.buildRange(0, 1, 0.01, () => this.settings.get('volumeMaster'), (value) => this.settings.set('volumeMaster', value), SettingsPanel.asPercent),
    );

    this.addRow(
      'Музыка',
      'Настроение меняется по ситуации',
      this.buildRange(0, 1, 0.01, () => this.settings.get('volumeMusic'), (value) => this.settings.set('volumeMusic', value), SettingsPanel.asPercent),
    );

    this.addRow(
      'Голос',
      'Реплики героя',
      this.buildRange(0, 1, 0.01, () => this.settings.get('volumeVoice'), (value) => this.settings.set('volumeVoice', value), SettingsPanel.asPercent),
    );

    this.addRow(
      'Эффекты',
      'Интерфейс, шаги, предметы',
      this.buildRange(0, 1, 0.01, () => this.settings.get('volumeSfx'), (value) => this.settings.set('volumeSfx', value), SettingsPanel.asPercent),
    );

    this.addRow(
      'Окружение',
      'Море и ветер',
      this.buildRange(0, 1, 0.01, () => this.settings.get('volumeAmbience'), (value) => this.settings.set('volumeAmbience', value), SettingsPanel.asPercent),
    );

    const reset = el('button', { className: 'btn btn--ghost', text: 'Сбросить', attrs: { type: 'button' } });
    reset.addEventListener('click', () => {
      this.onClick();
      this.settings.resetToDefaults();
      this.sync();
    });

    const done = el('button', { className: 'btn btn--primary', text: 'Готово', attrs: { type: 'button' } });
    done.addEventListener('click', () => {
      this.onClick();
      onClose();
    });

    this.footer.append(reset, done);
    this.body.append(
      el('div', {
        className: 'panel__note',
        text:
          'Голос героя приглушает музыку на время реплики. Субтитры дублируют реплики текстом — и выручают, если звук недоступен. ' +
          'Схема управления «Авто» включает сенсорные кнопки на телефоне и планшете. Подсказки и HUD можно скрыть — на игру это не влияет.',
      }),
    );

    this.sync();
    bus.on('settings:changed', () => this.sync());
    // Полный экран меняется и без нас: Esc, F11, кнопка браузера.
    fullscreen.onChange(() => this.sync());
  }

  sync(): void {
    for (const syncer of this.syncers) syncer();
  }

  override show(): void {
    this.sync();
    super.show();
  }

  // ——— строители контролов ————————————————————————————————————————

  private buildSegmented<T extends string>(
    values: readonly T[],
    label: (value: T) => string,
    read: () => T,
    write: (value: T) => void,
  ): HTMLElement {
    const group = el('div', { className: 'segmented', attrs: { role: 'group' } });
    const buttons = values.map((value) => {
      const button = el('button', {
        className: 'segmented__button',
        text: label(value),
        attrs: { type: 'button' },
      });
      button.addEventListener('click', () => {
        this.onClick();
        write(value);
        sync();
      });
      button.addEventListener('pointerenter', () => this.onHover());
      group.append(button);
      return { value, button };
    });

    const sync = (): void => {
      const current = read();
      for (const item of buttons) item.button.classList.toggle('is-active', item.value === current);
    };
    this.syncers.push(sync);
    return group;
  }

  private buildRange(
    min: number,
    max: number,
    step: number,
    read: () => number,
    write: (value: number) => void,
    format: (value: number) => string,
  ): HTMLElement {
    const input = el('input', {
      className: 'range',
      attrs: { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': 'Ползунок' },
    });
    const value = el('span', { className: 'range__value' });
    input.addEventListener('input', () => {
      write(Number(input.value));
      value.textContent = format(Number(input.value));
    });
    input.addEventListener('pointerdown', () => this.onHover());

    const sync = (): void => {
      const current = read();
      input.value = String(current);
      value.textContent = format(current);
    };
    this.syncers.push(sync);
    return el('div', { className: 'panel__control' }, input, value);
  }

  private buildSwitch(
    read: () => boolean,
    write: (value: boolean) => void,
    options: { disabled?: boolean } = {},
  ): HTMLElement {
    const button = el('button', {
      className: 'switch',
      attrs: { type: 'button', role: 'switch', 'aria-checked': 'false' },
    });
    if (options.disabled) {
      button.disabled = true;
      button.classList.add('is-disabled');
    }
    const sync = (): void => {
      const on = read();
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', String(on));
    };
    button.addEventListener('click', () => {
      if (options.disabled) return;
      this.onClick();
      write(!read());
      sync();
    });
    this.syncers.push(sync);
    return button;
  }

  private static asPercent(value: number): string {
    return `${Math.round(clamp01(value) * 100)}%`;
  }
}
