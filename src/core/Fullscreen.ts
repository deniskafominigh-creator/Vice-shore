/** Полноэкранный режим (задача 11).
 *
 *  Обёртка над Fullscreen API: префиксы WebKit, отказы браузера (iOS Safari не умеет
 *  полноэкранный режим для элемента), фиксация ориентации на телефоне.
 *  Все методы безопасны: ошибки не всплывают наружу, а возвращаются как `false`. */

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: (options?: { navigationUI?: string }) => Promise<void> | void;
};

type OrientationLock = { lock?: (orientation: string) => Promise<void> };

export type FullscreenListener = (active: boolean) => void;

export class FullscreenController {
  private readonly listeners = new Set<FullscreenListener>();
  private readonly element: FullscreenElement | null;

  constructor(element?: HTMLElement | null) {
    this.element =
      (element as FullscreenElement | null | undefined) ??
      (typeof document !== 'undefined' ? (document.documentElement as FullscreenElement) : null);

    if (typeof document === 'undefined') return;
    document.addEventListener('fullscreenchange', this.handleChange);
    document.addEventListener('webkitfullscreenchange', this.handleChange);
  }

  /** Поддерживает ли браузер полноэкранный режим. iPhone Safari — нет. */
  get supported(): boolean {
    if (!this.element) return false;
    const doc = document as FullscreenDocument;
    const hasApi =
      typeof this.element.requestFullscreen === 'function' ||
      typeof this.element.webkitRequestFullscreen === 'function';
    const enabled =
      typeof doc.fullscreenEnabled === 'boolean'
        ? doc.fullscreenEnabled
        : typeof doc.webkitFullscreenEnabled === 'boolean'
          ? doc.webkitFullscreenEnabled
          : true;
    return hasApi && enabled;
  }

  get active(): boolean {
    if (typeof document === 'undefined') return false;
    const doc = document as FullscreenDocument;
    return Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement);
  }

  /** Войти в полноэкранный режим. Вызывать только из обработчика действия игрока. */
  async request(): Promise<boolean> {
    if (this.active) return true;
    if (!this.element || !this.supported) return false;
    try {
      if (typeof this.element.requestFullscreen === 'function') {
        await this.element.requestFullscreen({ navigationUI: 'hide' });
      } else if (typeof this.element.webkitRequestFullscreen === 'function') {
        await this.element.webkitRequestFullscreen({ navigationUI: 'hide' });
      }
      return true;
    } catch (error) {
      // Браузер вправе отказать (нет жеста, вкладка не активна, политика iframe).
      console.warn('[Fullscreen] браузер отказал во входе в полноэкранный режим:', error);
      return false;
    }
  }

  async exit(): Promise<boolean> {
    if (!this.active) return true;
    const doc = document as FullscreenDocument;
    try {
      if (typeof document.exitFullscreen === 'function') await document.exitFullscreen();
      else if (typeof doc.webkitExitFullscreen === 'function') await doc.webkitExitFullscreen();
      return true;
    } catch (error) {
      console.warn('[Fullscreen] не удалось выйти из полноэкранного режима:', error);
      return false;
    }
  }

  async toggle(): Promise<boolean> {
    return this.active ? this.exit() : this.request();
  }

  /** Зафиксировать альбомную ориентацию — имеет смысл только в полноэкранном режиме. */
  async lockLandscape(): Promise<void> {
    const orientation = (screen as Screen & { orientation?: OrientationLock }).orientation;
    try {
      await orientation?.lock?.('landscape');
    } catch {
      // Safari и десктопные браузеры блокировку не поддерживают — это нормально.
    }
  }

  onChange(listener: FullscreenListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (typeof document === 'undefined') return;
    document.removeEventListener('fullscreenchange', this.handleChange);
    document.removeEventListener('webkitfullscreenchange', this.handleChange);
    this.listeners.clear();
  }

  private readonly handleChange = (): void => {
    const active = this.active;
    for (const listener of this.listeners) listener(active);
  };
}
