import { GAME, TIMING } from '../core/Config';
import type { EventBus } from '../core/EventBus';
import type { GameEventMap } from '../core/Events';
import type { SettingsStore } from '../core/Settings';
import type { ControlScheme, PlatformInfo } from '../core/Platform';
import type { FullscreenController } from '../core/Fullscreen';
import { ClockWidget } from './ClockWidget';
import { ControlsPanel } from './ControlsPanel';
import { LoadingScreen } from './LoadingScreen';
import { MainMenu } from './MainMenu';
import { MissionHud } from './MissionHud';
import { PauseMenu } from './PauseMenu';
import type { Modal } from './Panel';
import { SettingsPanel } from './SettingsPanel';
import { TalkPanel, type TalkOption } from './TalkPanel';
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
  /** Спросить кассира (id вопроса) и закрыть разговор. */
  readonly talk: (questionId: string) => void;
  readonly closeTalk: () => void;
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
  /** Разговор с кассиром (задача 18). Панель одна на игру, содержимое меняется. */
  private readonly talkPanel: TalkPanel;
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
  /** Часы сверху экрана (задача 22) и табло матча под ними. */
  private readonly clockWidget: ClockWidget;
  private readonly matchHud: HTMLElement;
  private readonly matchScoreEl: HTMLElement;
  private readonly matchNoteEl: HTMLElement;
  /** Катсцена конца дня: полосы кадра, подпись и титр. */
  private readonly cutscene: HTMLElement;
  private readonly cutsceneCaption: HTMLElement;
  private readonly cutsceneTitle: HTMLElement;
  private readonly debug: HTMLElement;
  /** Счётчик FPS (сборка v19): включается в настройках, живёт отдельно от телеметрии F4. */
  private readonly fpsBadge: HTMLElement;
  private readonly shutdown: HTMLElement;

  /** Сюда `Game` кладёт сенсорное управление: интерфейс не создаёт его сам. */
  private readonly touchHolder = el('div', { className: 'touch-holder' });
  private readonly modals: Modal[] = [];
  private disposed = false;
  private lastFps = 0;

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
    this.clockWidget = new ClockWidget();
    this.matchScoreEl = el('span', { className: 'match-hud__score', text: '0 : 0' });
    this.matchNoteEl = el('span', { className: 'match-hud__note', text: 'ДО 3 ГОЛОВ' });
    this.matchHud = el(
      'div',
      { className: 'match-hud' },
      el('span', { className: 'match-hud__team match-hud__team--home', text: 'МОРСКИЕ ВОЛКИ' }),
      this.matchScoreEl,
      el('span', { className: 'match-hud__team match-hud__team--away', text: 'КОРАЛЛОВЫЕ КОРОЛИ' }),
      this.matchNoteEl,
    );

    this.cutsceneCaption = el('div', { className: 'cutscene__caption' });
    this.cutsceneTitle = el('div', { className: 'cutscene__title' });
    this.cutscene = el(
      'div',
      { className: 'cutscene' },
      el('div', { className: 'cutscene__bar cutscene__bar--top' }),
      el('div', { className: 'cutscene__bar cutscene__bar--bottom' }),
      this.cutsceneTitle,
      this.cutsceneCaption,
    );
    this.debug = el('div', { className: 'debug' });
    this.debug.style.display = 'none';
    this.fpsBadge = el('div', { className: 'fps-badge is-hidden' });

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

    this.talkPanel = new TalkPanel(
      {
        onAsk: (id) => handlers.talk(id),
        onClose: () => handlers.closeTalk(),
      },
      { speaker: 'Кассир', role: 'касса · «Вайс Шор Арена»', monogram: 'К' },
    );

    this.shutdown = this.buildShutdown(handlers);
    this.shutdown.classList.add('is-hidden');

    this.root.append(
      el('div', { className: 'ui-vignette' }),
      this.hint,
      this.kick,
      this.subtitle,
      this.clockWidget.root,
      this.matchHud,
      this.cutscene,
      this.mission.root,
      this.touchHolder,
      this.toasts.root,
      this.fpsBadge,
      this.debug,
      this.menu.root,
      this.pauseMenu.root,
      this.controlsPanel.root,
      this.settingsPanel.root,
      this.talkPanel.root,
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
    this.clockWidget.setStyle(values.clockStyle);
    this.subtitle.dataset.font = values.subtitleFont;
    this.subtitle.dataset.backdrop = values.subtitleBackdrop;
    this.subtitle.classList.toggle('is-hidden', !values.subtitles);
    // FPS: показываем, только если игрок сам включил счётчик в настройках
    this.fpsBadge.classList.toggle('is-hidden', !values.showFps);
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

  // ——— разговор с кассиром (задача 18) ————————————————————————

  /** Открыть панель разговора: вопросы и первая реплика кассира. */
  openTalk(options: readonly TalkOption[]): void {
    this.talkPanel.setOptions(options);
    this.pushModal(this.talkPanel);
  }

  closeTalk(): void {
    this.popModal(this.talkPanel);
  }

  setTalkAnswer(who: string, text: string | null): void {
    this.talkPanel.setAnswer(who, text);
  }

  setTalkOptions(options: readonly TalkOption[]): void {
    this.talkPanel.setOptions(options);
  }

  get talkOpen(): boolean {
    return this.talkPanel.isVisible;
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

  /** Счётчик кадров: цифра обновляется раз в полсекунды вместе с телеметрией. */
  setFps(fps: number | null): void {
    if (fps === null) {
      this.fpsBadge.textContent = '';
      this.fpsBadge.classList.add('is-hidden');
      return;
    }
    this.lastFps = Math.round(fps);
    const value = `${this.lastFps}`;
    this.fpsBadge.textContent = `${value} FPS`;
    // Цвет — оценка плавности: зелёный 55+, жёлтый 40+, красный ниже
    this.fpsBadge.dataset.level = this.lastFps >= 55 ? 'high' : this.lastFps >= 40 ? 'mid' : 'low';
    this.fpsBadge.classList.toggle('is-hidden', !this.settings.get('showFps'));
  }

  /** Последнее измеренное значение — нужно проверкам и отладке. */
  get fps(): number {
    return this.lastFps;
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

  // ——— Часы и матч (задача 22) ————————————————————————————————

  /** Показать часы: по сюжету они появляются после двух вступительных миссий. */
  setClockVisible(visible: boolean): void {
    if (visible) this.clockWidget.show();
    else this.clockWidget.hide();
    this.root.classList.toggle('has-clock', visible);
  }

  setClockTime(minutes: number): void {
    this.clockWidget.setTime(minutes);
  }

  setClockHint(text: string | null): void {
    this.clockWidget.setHint(text);
  }

  setClockUrgent(urgent: boolean): void {
    this.clockWidget.setUrgent(urgent);
  }

  get clockVisible(): boolean {
    return this.clockWidget.isVisible;
  }

  /** Табло матча: счёт и подпись (команды, «до 3 голов»). */
  showMatchHud(note = 'ДО 3 ГОЛОВ'): void {
    this.matchNoteEl.textContent = note;
    this.matchHud.classList.add('is-visible');
  }

  hideMatchHud(): void {
    this.matchHud.classList.remove('is-visible', 'is-goal');
  }

  setMatchScore(home: number, away: number, note?: string): void {
    this.matchScoreEl.textContent = `${home} : ${away}`;
    if (note !== undefined) this.matchNoteEl.textContent = note;
  }

  /** Вспышка табло на голе. */
  flashMatchGoal(): void {
    this.matchHud.classList.remove('is-goal');
    // Перезапуск анимации: без reflow класс не сработает второй раз
    void this.matchHud.offsetWidth;
    this.matchHud.classList.add('is-goal');
  }

  // ——— Катсцена конца дня (задача 22) ————————————————————————

  showCutscene(): void {
    this.cutscene.classList.add('is-visible');
    // Реплики, подсказки и HUD в катсцене не нужны
    this.setHint(null);
    this.hideMissionHud();
  }

  hideCutscene(): void {
    this.cutscene.classList.remove('is-visible');
    this.setCutsceneCaption(null);
    this.setCutsceneTitle(null, null);
  }

  setCutsceneCaption(text: string | null): void {
    if (text === null) {
      this.cutsceneCaption.classList.remove('is-visible');
      this.cutsceneCaption.textContent = '';
      return;
    }
    this.cutsceneCaption.textContent = text;
    this.cutsceneCaption.classList.add('is-visible');
  }

  setCutsceneTitle(title: string | null, sub: string | null): void {
    if (title === null) {
      this.cutsceneTitle.classList.remove('is-visible');
      this.cutsceneTitle.textContent = '';
      return;
    }
    this.cutsceneTitle.textContent = title;
    if (sub) this.cutsceneTitle.append(el('span', { className: 'cutscene__sub', text: sub }));
    this.cutsceneTitle.classList.add('is-visible');
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

  private pushModal(panel: Modal): void {
    if (!this.modals.includes(panel)) this.modals.push(panel);
    panel.show();
  }

  private popModal(panel: Modal): void {
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
