import { GAME, TIMING } from '../core/Config';
import type { EventBus } from '../core/EventBus';
import type { GameEventMap } from '../core/Events';
import type { SettingsStore } from '../core/Settings';
import type { ControlScheme, PlatformInfo } from '../core/Platform';
import type { FullscreenController } from '../core/Fullscreen';
import { ControlsPanel } from './ControlsPanel';
import { LoadingScreen } from './LoadingScreen';
import { MainMenu } from './MainMenu';
import { MissionHud } from './MissionHud';
import { PauseMenu } from './PauseMenu';
import { Panel } from './Panel';
import { SettingsPanel } from './SettingsPanel';
import { Toasts, type ToastTone } from './Toasts';
import { el, wait } from './dom';

/** Что интерфейсу нужно знать о платформе и управлении (задача 11). */
export interface UiEnvironment {
  readonly platform: PlatformInfo;
  readonly fullscreen: FullscreenController;
  readonly getScheme: () => ControlScheme;
}

export interface UiHandlers {
  readonly play: () => void;
  readonly continueGame: () => void;
  readonly exit: () => void;
  readonly resume: () => void;
  readonly exitToMenu: () => void;
  readonly returnFromShutdown: () => void;
  readonly hover: () => void;
  readonly click: () => void;
}

/** Корень интерфейса: экраны, панели, затемнения, подсказки.
 *  Здесь же маршрутизация клавиш: сначала верхняя панель, потом меню. */
export class Ui {
  private readonly loading: LoadingScreen;
  private readonly menu: MainMenu;
  private readonly settingsPanel: SettingsPanel;
  private readonly controlsPanel: ControlsPanel;
  private readonly pauseMenu: PauseMenu;
  private readonly toasts: Toasts;
  private readonly mission: MissionHud;
  private readonly fade: HTMLElement;
  private readonly hint: HTMLElement;
  /** Индикатор силы удара по мячу (задача 16): полоска заполняется, пока держишь Space. */
  private readonly kick: HTMLElement;
  private readonly kickFill: HTMLElement;
  /** Субтитры реплик героя (задача 9). */
  private readonly subtitle: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly shutdown: HTMLElement;

  /** Сюда `Game` кладёт сенсорное управление: интерфейс не создаёт его сам. */
  private readonly touchHolder = el('div', { className: 'touch-holder' });
  private readonly modals: Panel[] = [];
  private disposed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: SettingsStore,
    bus: EventBus<GameEventMap>,
    handlers: UiHandlers,
    environment: UiEnvironment,
  ) {
    this.fade = el('div', { className: 'ui-fade' });
    this.loading = new LoadingScreen();
    this.toasts = new Toasts();
    this.mission = new MissionHud();
    this.hint = el('div', { className: 'hint' });
    this.kickFill = el('div', { className: 'kick-charge__fill' });
    this.kick = el(
      'div',
      { className: 'kick-charge' },
      el('span', { className: 'kick-charge__label', text: 'УДАР' }),
      el('div', { className: 'kick-charge__track' }, this.kickFill),
    );
    this.subtitle = el('div', { className: 'subtitle' });
    this.debug = el('div', { className: 'debug' });
    this.debug.style.display = 'none';

    this.menu = new MainMenu({
      onPlay: handlers.play,
      onContinue: handlers.continueGame,
      onSettings: () => this.openSettings(),
      onControls: () => this.openControls(),
      onExit: handlers.exit,
      onHover: handlers.hover,
      onClick: handlers.click,
    });

    this.pauseMenu = new PauseMenu({
      onResume: handlers.resume,
      onSettings: () => this.openSettings(),
      onControls: () => this.openControls(),
      onExitToMenu: handlers.exitToMenu,
      onHover: handlers.hover,
      onClick: handlers.click,
    });

    this.settingsPanel = new SettingsPanel(
      settings,
      bus,
      handlers.hover,
      handlers.click,
      () => this.closeSettings(),
      environment,
    );

    this.controlsPanel = new ControlsPanel(handlers.click, () => this.closeControls(), environment);

    this.shutdown = this.buildShutdown(handlers);
    this.shutdown.classList.add('is-hidden');

    this.root.append(
      el('div', { className: 'ui-vignette' }),
      this.hint,
      this.kick,
      this.subtitle,
      this.mission.root,
      this.touchHolder,
      this.toasts.root,
      this.debug,
      this.menu.root,
      this.pauseMenu.root,
      this.controlsPanel.root,
      this.settingsPanel.root,
      this.loading.root,
      this.shutdown,
      this.fade,
    );

    document.addEventListener('keydown', this.onKeyDown);

    // Задача 12: вид субтитров и то, что вообще показывать поверх игры.
    this.applyInterface();
    bus.on('settings:changed', () => this.applyInterface());
  }

  /** Перенести настройки интерфейса на DOM: классы скрытия и вид плашки субтитров. */
  applyInterface(): void {
    const values = this.settings.snapshot;
    this.root.classList.toggle('hide-control-hints', !values.showControlHints);
    this.root.classList.toggle('hide-action-prompts', !values.showActionPrompts);
    this.root.classList.toggle('hide-mission-hud', !values.showMissionHud);
    this.subtitle.dataset.font = values.subtitleFont;
    this.subtitle.dataset.backdrop = values.subtitleBackdrop;
    this.subtitle.classList.toggle('is-hidden', !values.subtitles);
  }

  // ——— загрузка ——————————————————————————————————————————————

  showLoading(): void {
    this.loading.show();
  }

  hideLoading(): void {
    this.loading.hide();
  }

  setLoadingProgress(value: number, label: string): void {
    this.loading.setProgress(value, label);
  }

  // ——— главное меню ——————————————————————————————————————————

  showMainMenu(): void {
    this.menu.show();
  }

  hideMainMenu(): void {
    this.menu.hide();
  }

  setSaveAvailable(available: boolean): void {
    this.menu.setSaveAvailable(available);
  }

  // ——— панели ————————————————————————————————————————————————

  openSettings(): void {
    this.pushModal(this.settingsPanel);
  }

  closeSettings(): void {
    this.popModal(this.settingsPanel);
  }

  openControls(): void {
    this.pushModal(this.controlsPanel);
  }

  closeControls(): void {
    this.popModal(this.controlsPanel);
  }

  openPause(): void {
    this.pushModal(this.pauseMenu);
  }

  closePause(): void {
    this.popModal(this.pauseMenu);
  }

  /** Закрыть все модальные панели (например, при смене состояния). */
  closeAllPanels(): void {
    for (const panel of [...this.modals].reverse()) panel.hide();
    this.modals.length = 0;
  }

  // ——— сенсорное управление (задача 11) ——————————————————————

  /** Подключить готовое сенсорное управление в нужный слой оверлея. */
  attachTouchControls(node: HTMLElement): void {
    this.touchHolder.append(node);
  }

  /** Класс на корне: по нему CSS знает, что играет палец, а не мышь. */
  setTouchMode(enabled: boolean): void {
    this.root.classList.toggle('is-touch', enabled);
  }

  showTouchControls(): void {
    this.touchHolder.classList.remove('is-hidden');
    for (const node of this.touchHolder.children) node.classList.remove('is-hidden');
  }

  hideTouchControls(): void {
    for (const node of this.touchHolder.children) node.classList.add('is-hidden');
  }

  // ——— игровые подсказки и уведомления ——————————————————————

  /** Субтитры: тот же текст, что звучит в реплике (задача 9). */
  showSubtitle(text: string): void {
    this.subtitle.textContent = text;
    this.subtitle.classList.add('is-visible');
  }

  hideSubtitle(): void {
    this.subtitle.classList.remove('is-visible');
    this.subtitle.textContent = '';
  }

  setHint(text: string | null): void {
    if (text) {
      this.hint.textContent = text;
      this.hint.classList.add('is-visible');
    } else {
      this.hint.classList.remove('is-visible');
    }
  }

  /** Сила удара по мячу: null — полоска скрыта, 0…1 — заполнение. */
  setKickCharge(value: number | null): void {
    if (value === null) {
      this.kick.classList.remove('is-visible');
      return;
    }
    const clamped = Math.max(0, Math.min(1, value));
    this.kick.classList.add('is-visible');
    this.kickFill.style.width = `${(clamped * 100).toFixed(1)}%`;
    this.kick.classList.toggle('is-full', clamped >= 0.995);
  }

  toast(text: string, tone: ToastTone = 'info'): void {
    this.toasts.show(text, tone, TIMING.toast * 1000);
  }

  setDebug(text: string | null): void {
    if (text === null) {
      this.debug.style.display = 'none';
      this.debug.textContent = '';
      return;
    }
    this.debug.style.display = 'block';
    this.debug.textContent = text;
  }

  // ——— HUD миссии (задача 7) —————————————————————————————————

  showMissionHud(): void {
    this.mission.show();
  }

  hideMissionHud(): void {
    this.mission.hide();
  }

  setMissionTask(title: string | null, hint = '', step = ''): void {
    this.mission.setTask(title, hint, step);
  }

  setMissionRoom(percent: number | null, state = '', label?: string, value?: string): void {
    this.mission.setRoom(percent, state, label, value);
  }

  setMissionPower(value: number | null, window: { from: number; to: number } | null = null): void {
    this.mission.setPower(value, window);
  }

  setMissionControls(text: string | null): void {
    this.mission.setControls(text);
  }

  setMissionPrompt(text: string | null): void {
    this.mission.setPrompt(text);
  }

  flashMission(text: string, tone: 'info' | 'success' = 'info'): void {
    this.mission.flash(text, tone);
  }

  // ——— затемнение ————————————————————————————————————————————

  /** Плавное затемнение/прояснение экрана. instant=true — без перехода (первый кадр). */
  async fadeTo(active: boolean, instant = false): Promise<void> {
    const duration = TIMING.fade * 1000;
    if (instant) {
      this.fade.style.transition = 'none';
      this.fade.classList.toggle('is-active', active);
      // Принудительная перерисовка, затем возвращаем переход.
      void this.fade.offsetHeight;
      this.fade.style.transition = '';
      return;
    }
    this.fade.classList.toggle('is-active', active);
    await wait(duration + 40);
  }

  // ——— завершение ——————————————————————————————————————————

  showShutdown(): void {
    this.closeAllPanels();
    this.hideMainMenu();
    this.shutdown.classList.remove('is-hidden');
  }

  hideShutdown(): void {
    this.shutdown.classList.add('is-hidden');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('keydown', this.onKeyDown);
  }

  // ——— внутреннее ————————————————————————————————————————————

  private buildShutdown(handlers: UiHandlers): HTMLElement {
    const back = el('button', { className: 'btn btn--primary', text: 'Вернуться в меню', attrs: { type: 'button' } });
    back.addEventListener('click', () => {
      handlers.click();
      handlers.returnFromShutdown();
    });

    return el(
      'section',
      { className: 'screen shutdown' },
      el('div', { className: 'shutdown__title', text: 'До встречи' }),
      el('div', {
        className: 'shutdown__text',
        text: `${GAME.title} остановлена. Прогресс сохранён — можно вернуться в любой момент.`,
      }),
      back,
    );
  }

  private pushModal(panel: Panel): void {
    if (!this.modals.includes(panel)) this.modals.push(panel);
    panel.show();
  }

  private popModal(panel: Panel): void {
    const index = this.modals.indexOf(panel);
    if (index >= 0) this.modals.splice(index, 1);
    panel.hide();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    for (let i = this.modals.length - 1; i >= 0; i -= 1) {
      const panel = this.modals[i];
      if (panel && panel.handleKey(event.code)) {
        event.preventDefault();
        return;
      }
    }
    if (this.menu.isVisible && this.menu.handleKey(event.code)) event.preventDefault();
  };
}
