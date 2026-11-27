import {
  CLOCK_STYLES,
  GAME,
  QUALITY_ORDER,
  type ClockStyle,
  SUBTITLE_BACKDROPS,
  SUBTITLE_FONTS,
  type QualityLevel,
  type SubtitleBackdrop,
  type SubtitleFont,
} from './Config';
import type { EventBus } from './EventBus';
import type { GameEventMap } from './Events';
import { clamp } from './MathUtils';
import { CONTROL_PREFERENCES, detectPlatform, type ControlPreference } from './Platform';

/** Настройки игрока. Ключи присутствуют все сразу (в т.ч. для будущих задач),
 *  но в интерфейсе показываются только те, что уже реально работают:
 *  музыка — задача 3, голос — задача 9 (см. PROGRESS.md). */
export interface GameSettings {
  quality: QualityLevel;
  /** Схема управления (задача 11): авто по устройству, либо принудительно. */
  controls: ControlPreference;
  /** Полноэкранный режим: намерение игрока. Включение происходит по его жесту. */
  fullscreen: boolean;
  mouseSensitivity: number;
  invertY: boolean;
  volumeMaster: number;
  volumeMusic: number;
  volumeSfx: number;
  volumeVoice: number;
  volumeAmbience: number;
  subtitles: boolean;
  /** Вид субтитров: шрифт и фон плашки (задача 12). */
  subtitleFont: SubtitleFont;
  subtitleBackdrop: SubtitleBackdrop;
  /** Что показывать поверх игры: подсказки управления, подсказки действий, задачи. */
  showControlHints: boolean;
  showActionPrompts: boolean;
  showMissionHud: boolean;
  /** Глубина резкости (BokehPass). По умолчанию включена, но её можно снять:
   *  на слабом экране размытый дальний план читается как «мыло». */
  depthOfField: boolean;
  /** Стиль часов сверху экрана (задача 22). */
  clockStyle: ClockStyle;
  /** Счётчик FPS в углу экрана (сборка v19): для проверки плавности на телефоне. */
  showFps: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'medium',
  controls: 'auto',
  fullscreen: false,
  mouseSensitivity: 1,
  invertY: false,
  volumeMaster: 0.85,
  volumeMusic: 0.6,
  volumeSfx: 0.85,
  volumeVoice: 0.95,
  volumeAmbience: 0.5,
  subtitles: true,
  // Прежний Inter в субтитрах заказчик назвал слишком простым — по умолчанию
  // «кинематографичный» шрифт и фон-плёнка.
  subtitleFont: 'film',
  subtitleBackdrop: 'film',
  showControlHints: true,
  showActionPrompts: true,
  showMissionHud: true,
  depthOfField: true,
  clockStyle: 'neon',
  showFps: false,
};

/** Проверка и приведение значений: испорченный localStorage не должен ломать запуск. */
export function sanitizeSettings(raw: Partial<Record<keyof GameSettings, unknown>>): GameSettings {
  const volume = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : fallback;

  const quality =
    typeof raw.quality === 'string' && QUALITY_ORDER.includes(raw.quality as QualityLevel)
      ? (raw.quality as QualityLevel)
      : DEFAULT_SETTINGS.quality;

  const controls =
    typeof raw.controls === 'string' && CONTROL_PREFERENCES.includes(raw.controls as ControlPreference)
      ? (raw.controls as ControlPreference)
      : DEFAULT_SETTINGS.controls;

  return {
    quality,
    controls,
    fullscreen: typeof raw.fullscreen === 'boolean' ? raw.fullscreen : DEFAULT_SETTINGS.fullscreen,
    mouseSensitivity:
      typeof raw.mouseSensitivity === 'number' && Number.isFinite(raw.mouseSensitivity)
        ? clamp(raw.mouseSensitivity, 0.25, 2.5)
        : DEFAULT_SETTINGS.mouseSensitivity,
    invertY: typeof raw.invertY === 'boolean' ? raw.invertY : DEFAULT_SETTINGS.invertY,
    volumeMaster: volume(raw.volumeMaster, DEFAULT_SETTINGS.volumeMaster),
    volumeMusic: volume(raw.volumeMusic, DEFAULT_SETTINGS.volumeMusic),
    volumeSfx: volume(raw.volumeSfx, DEFAULT_SETTINGS.volumeSfx),
    volumeVoice: volume(raw.volumeVoice, DEFAULT_SETTINGS.volumeVoice),
    volumeAmbience: volume(raw.volumeAmbience, DEFAULT_SETTINGS.volumeAmbience),
    subtitles: typeof raw.subtitles === 'boolean' ? raw.subtitles : DEFAULT_SETTINGS.subtitles,
    subtitleFont:
      typeof raw.subtitleFont === 'string' && SUBTITLE_FONTS.includes(raw.subtitleFont as SubtitleFont)
        ? (raw.subtitleFont as SubtitleFont)
        : DEFAULT_SETTINGS.subtitleFont,
    subtitleBackdrop:
      typeof raw.subtitleBackdrop === 'string' &&
      SUBTITLE_BACKDROPS.includes(raw.subtitleBackdrop as SubtitleBackdrop)
        ? (raw.subtitleBackdrop as SubtitleBackdrop)
        : DEFAULT_SETTINGS.subtitleBackdrop,
    showControlHints:
      typeof raw.showControlHints === 'boolean' ? raw.showControlHints : DEFAULT_SETTINGS.showControlHints,
    showActionPrompts:
      typeof raw.showActionPrompts === 'boolean' ? raw.showActionPrompts : DEFAULT_SETTINGS.showActionPrompts,
    showMissionHud:
      typeof raw.showMissionHud === 'boolean' ? raw.showMissionHud : DEFAULT_SETTINGS.showMissionHud,
    depthOfField:
      typeof raw.depthOfField === 'boolean' ? raw.depthOfField : DEFAULT_SETTINGS.depthOfField,
    clockStyle:
      typeof raw.clockStyle === 'string' && CLOCK_STYLES.includes(raw.clockStyle as ClockStyle)
        ? (raw.clockStyle as ClockStyle)
        : DEFAULT_SETTINGS.clockStyle,
    showFps: typeof raw.showFps === 'boolean' ? raw.showFps : DEFAULT_SETTINGS.showFps,
  };
}

export class SettingsStore {
  private values: GameSettings;

  constructor(private readonly bus: EventBus<GameEventMap>) {
    this.values = this.read();
  }

  get snapshot(): Readonly<GameSettings> {
    return this.values;
  }

  get<K extends keyof GameSettings>(key: K): GameSettings[K] {
    return this.values[key];
  }

  set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    if (this.values[key] === value) return;
    this.values = sanitizeSettings({ ...this.values, [key]: value });
    this.persist();
    this.bus.emit('settings:changed', { key: String(key), value: this.values[key] });
  }

  resetToDefaults(): void {
    this.values = { ...DEFAULT_SETTINGS };
    this.persist();
    for (const key of Object.keys(this.values) as (keyof GameSettings)[]) {
      this.bus.emit('settings:changed', { key: String(key), value: this.values[key] });
    }
  }

  private read(): GameSettings {
    try {
      const raw = localStorage.getItem(GAME.settingsKey);
      if (!raw) return SettingsStore.firstRun();
      return sanitizeSettings(JSON.parse(raw) as Partial<Record<keyof GameSettings, unknown>>);
    } catch (error) {
      console.warn('[Settings] не удалось прочитать настройки, используются значения по умолчанию:', error);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /** Первый запуск: на телефоне включаем низкое качество — там дорог каждый пиксель. */
  private static firstRun(): GameSettings {
    const platform = detectPlatform();
    return { ...DEFAULT_SETTINGS, quality: platform.mobile ? 'low' : DEFAULT_SETTINGS.quality };
  }

  private persist(): void {
    try {
      localStorage.setItem(GAME.settingsKey, JSON.stringify(this.values));
    } catch (error) {
      console.warn('[Settings] не удалось сохранить настройки:', error);
    }
  }
}
