/** Платформа и схема управления.
 *
 *  Задача 11: игра должна сама понимать, где её открыли — на телефоне или на компьютере,
 *  и подставлять подходящее управление. Решение принимается по возможностям устройства
 *  (тач, грубый указатель, отсутствие наведения), а не только по строке User-Agent:
 *  UA врёт, а медиазапросы — нет.
 *
 *  Модуль ничего не знает о настройках и интерфейсе: он лишь отвечает на вопрос «что это за
 *  устройство». Что с этим делать, решает `Game` (см. `resolveScheme`). */

/** Схема управления, которая реально включена в игре. */
export type ControlScheme = 'keyboard' | 'touch';

/** Что выбрал игрок в настройках. `auto` — довериться определению устройства. */
export type ControlPreference = 'auto' | 'keyboard' | 'touch';

export const CONTROL_PREFERENCES: readonly ControlPreference[] = ['auto', 'keyboard', 'touch'];

export interface PlatformInfo {
  /** Основной ввод — палец: сенсорный экран, нет наведения курсора. */
  readonly touch: boolean;
  /** Устройство мобильное (телефон или планшет). */
  readonly mobile: boolean;
  readonly phone: boolean;
  readonly tablet: boolean;
  /** Запущено как приложение с домашнего экрана (нет адресной строки). */
  readonly standalone: boolean;
  /** Человеческое название для панели настроек: «Телефон», «Планшет», «Компьютер». */
  readonly label: string;
  /** Почему решили именно так — показываем в настройках, чтобы не было «магии». */
  readonly reason: string;
  /** Есть ли в браузере полноэкранный режим для элемента. */
  readonly fullscreen: boolean;
}

/** Планшеты и телефоны по ширине экрана в CSS-пикселях. */
const PHONE_MAX_SHORT_SIDE = 620;

/** UA — только как подсказка: на iPadOS 13+ Safari представляется «Macintosh». */
const UA_MOBILE = /Android|iPhone|iPod|iPad|Mobile|Tablet|Silk|Kindle|PlayBook|Opera Mini/i;

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  mozFullScreenEnabled?: boolean;
};

/** Есть ли в браузере полноэкранный режим (с учётом префиксов и iOS). */
export function detectFullscreenSupport(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenDocument;
  if (typeof doc.fullscreenEnabled === 'boolean') return doc.fullscreenEnabled;
  if (typeof doc.webkitFullscreenEnabled === 'boolean') return doc.webkitFullscreenEnabled;
  if (typeof doc.mozFullScreenEnabled === 'boolean') return doc.mozFullScreenEnabled;
  return false;
}

/** «1 точка касания», «5 точек касания» — без кривых формулировок в настройках. */
function touchWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'точка касания';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'точки касания';
  return 'точек касания';
}

/** Определение устройства. Вызывается один раз при старте, результат живёт в `Game`. */
export function detectPlatform(): PlatformInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      touch: false,
      mobile: false,
      phone: false,
      tablet: false,
      standalone: false,
      label: 'Компьютер',
      reason: 'окружение без браузера',
      fullscreen: false,
    };
  }

  const ua = navigator.userAgent ?? '';
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  const uaMobile = UA_MOBILE.test(ua);

  // Палец как основной ввод: тач есть И указатель грубый (или наведения нет вовсе).
  const touch = (maxTouchPoints > 0 && (coarse || noHover)) || (uaMobile && maxTouchPoints > 0);
  const width = window.screen?.width ?? window.innerWidth;
  const height = window.screen?.height ?? window.innerHeight;
  const shortSide = Math.min(width, height);
  const phone = touch && shortSide <= PHONE_MAX_SHORT_SIDE;
  const tablet = touch && !phone;
  const mobile = touch;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  const label = phone ? 'Телефон' : tablet ? 'Планшет' : 'Компьютер';
  const reason = touch
    ? `${maxTouchPoints} ${touchWord(maxTouchPoints)}, ${coarse ? 'грубый указатель' : 'нет наведения'}`
    : 'мышь и клавиатура';

  return { touch, mobile, phone, tablet, standalone, label, reason, fullscreen: detectFullscreenSupport() };
}

/** Какая схема управления включена: настройка игрока важнее автоопределения. */
export function resolveScheme(preference: ControlPreference, platform: PlatformInfo): ControlScheme {
  if (preference === 'touch') return 'touch';
  if (preference === 'keyboard') return 'keyboard';
  return platform.touch ? 'touch' : 'keyboard';
}

/** Подпись варианта в настройках. */
export function describePreference(preference: ControlPreference, platform: PlatformInfo): string {
  if (preference === 'auto') return `Авто (${platform.label.toLowerCase()})`;
  if (preference === 'touch') return 'Сенсор';
  return 'Мышь';
}
