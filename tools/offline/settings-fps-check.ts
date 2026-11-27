/**
 * Проверка настройки «Показывать FPS» (сборка v19).
 *
 *  Счётчик кадров — это настройка, а не отладочный режим: она должна
 *   1. существовать в наборе по умолчанию и по умолчанию быть выключенной;
 *   2. переживать сохранение в localStorage и порчу файла настроек;
 *   3. поднимать событие `settings:changed`, по которому интерфейс показывает бейдж;
 *   4. не мешать телеметрии F4 — это два разных элемента.
 */
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsStore } from '../../src/core/Settings';
import { EventBus } from '../../src/core/EventBus';
import type { GameEventMap } from '../../src/core/Events';

/** Минимальное хранилище вместо localStorage (в Node его нет). */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
};

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

// ——— 1. значение по умолчанию ———
check('showFps' in DEFAULT_SETTINGS, 'ключ showFps есть в наборе настроек');
check(DEFAULT_SETTINGS.showFps === false, 'по умолчанию счётчик выключен — интерфейс не обрастает цифрами');

// ——— 2. устойчивость к испорченным данным ———
check(sanitizeSettings({ showFps: true }).showFps === true, 'включённый счётчик сохраняется');
check(sanitizeSettings({ showFps: false }).showFps === false, 'выключенный счётчик сохраняется');
check(
  sanitizeSettings({ showFps: 'да' as unknown as boolean }).showFps === false,
  'мусор вместо значения не включает счётчик (остаётся false)',
);
check(
  sanitizeSettings({ showFps: null as unknown as boolean }).showFps === false,
  'null в сохранённых настройках не ломает запуск',
);

// ——— 3. шина событий и сохранение ———
const bus = new EventBus<GameEventMap>();
const settings = new SettingsStore(bus);
check(settings.get('showFps') === false, 'новая установка начинает с выключенным счётчиком');

const events: string[] = [];
bus.on('settings:changed', (payload) => events.push(`${payload.key}=${String(payload.value)}`));
settings.set('showFps', true);
check(settings.get('showFps') === true, 'настройка переключается на true');
check(
  events.includes('showFps=true'),
  'поднимается settings:changed — интерфейс показывает бейдж без перезапуска',
);

const reloaded = new SettingsStore(new EventBus<GameEventMap>());
check(reloaded.get('showFps') === true, 'значение переживает перезапуск: читается из хранилища');

settings.set('showFps', false);
const again = new SettingsStore(new EventBus<GameEventMap>());
check(again.get('showFps') === false, 'выключение тоже сохраняется');

// ——— 4. не мешает другим настройкам интерфейса ———
check(
  DEFAULT_SETTINGS.showControlHints === true && DEFAULT_SETTINGS.showMissionHud === true,
  'подсказки и HUD миссий остаются включёнными по умолчанию',
);
check(
  Object.keys(DEFAULT_SETTINGS).length === Object.keys(sanitizeSettings({})).length,
  'в наборе нет забытых ключей: sanitize возвращает полный объект',
);

if (problems > 0) {
  console.log(`\nПроблем: ${problems}`);
  process.exitCode = 1;
} else {
  console.log('\nСчётчик FPS: настройка, сохранение и событие в порядке');
}
export const failed = problems;
