/**
 * Проверка часов и расписания (задача 22).
 *
 *  Время — не декорация: если сказано «матч в 19:00», он должен начаться ровно
 *  в 19:00, а не «около». Поэтому проверяем арифметику часов отдельно от сцены:
 *  старт дня, тик, обратный отсчёт, точное попадание в минуту матча, прыжок
 *  к концу дня и три стиля циферблата в настройках и в CSS.
 */
import { readFileSync } from 'node:fs';
import { CLOCK, CLOCK_STYLES, CLOCK_STYLE_LABELS, MATCH } from '../../src/core/Config';
import { GameClock } from '../../src/core/GameClock';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/core/Settings';

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

const pad = (value: number): string => String(value).padStart(2, '0');

// ——— 1. старт дня и формат ———
const ticks: string[] = [];
const clock = new GameClock((minutes, label) => ticks.push(`${minutes}:${label}`));
check(clock.label === `${pad(CLOCK.startHour)}:${pad(CLOCK.startMinute)}`, `день начинается в ${clock.label}`);
check(clock.minutesUntil(CLOCK.matchHour, CLOCK.matchMinute) === 80, 'до матча ровно 80 игровых минут');
check(clock.partOfDay === 'ВЕЧЕР', 'вечер по подписи часов');

// ——— 2. ожидание на паузе ———
check(clock.update(10) === 0, 'на паузе часы стоят');
clock.start();
check(clock.isRunning, 'после start часы идут');

// ——— 3. один тик = одна игровая минута ———
clock.update(1);
check(clock.label === '17:41', `через секунду ${clock.label}`);

// ——— 4. матч ровно в 19:00 ———
// Догоняем до 18:59 и проверяем, что минута матча наступает ровно однажды.
while (clock.label !== '18:59') clock.update(1);
const beforeMatch = clock.minutesUntil(CLOCK.matchHour, CLOCK.matchMinute);
check(beforeMatch === 1, 'за минуту до свистка остаётся одна минута');
clock.update(1);
check(clock.label === '19:00', `свисток по расписанию: ${clock.label}`);
check(clock.minutesUntil(CLOCK.matchHour, CLOCK.matchMinute) === 0, 'в 19:00 отсчёт обнуляется');
const matches = ticks.filter((entry) => entry.endsWith(':19:00')).length;
check(matches === 1, 'минута 19:00 наступает ровно один раз');

// ——— 5. конец дня прыжком ———
clock.catchUpTo(CLOCK.endHour, CLOCK.endMinute);
check(clock.label === `${pad(CLOCK.endHour)}:${pad(CLOCK.endMinute)}`, `конец дня: ${clock.label}`);
check(clock.partOfDay === 'ВЕЧЕР', '21:30 всё ещё вечер');
clock.setTime(23, 30);
check(clock.partOfDay === 'НОЧЬ', 'в 23:30 — ночь');

// ——— 6. дробное накопление: 60 кадров по 1/60 с = 1 минута ———
const fine = new GameClock();
fine.start();
for (let frame = 0; frame < 60; frame += 1) fine.update(1 / 60);
check(fine.label === '17:41', `дробные кадры не теряются: ${fine.label}`);

// ——— 7. три стиля часов ———
check(CLOCK_STYLES.length === 3, `стилей часов: ${CLOCK_STYLES.length}`);
check(new Set(CLOCK_STYLES).size === CLOCK_STYLES.length, 'стили не повторяются');
check(
  CLOCK_STYLES.every((style) => typeof CLOCK_STYLE_LABELS[style] === 'string' && CLOCK_STYLE_LABELS[style].length > 2),
  'у каждого стиля есть подпись',
);
check(CLOCK_STYLES.includes(DEFAULT_SETTINGS.clockStyle), 'по умолчанию выбран существующий стиль');
const sanitized = sanitizeSettings({ ...DEFAULT_SETTINGS, clockStyle: 'sun-dial' as unknown as (typeof CLOCK_STYLES)[number] });
check(sanitized.clockStyle === DEFAULT_SETTINGS.clockStyle, 'неизвестный стиль сбрасывается на дефолт');

// ——— 8. стили есть в разметке и в CSS ———
const css = readFileSync('src/ui/styles.css', 'utf8');
for (const style of CLOCK_STYLES) {
  check(css.includes(`.clock[data-style='${style}']`) || css.includes(`.clock[data-style="${style}"]`), `CSS знает стиль «${style}»`);
}
check(css.includes('.clock__face') && css.includes('.clock__digits'), 'циферблат и цифры описаны стилями');
check(css.includes('.match-hud') && css.includes('.cutscene'), 'табло матча и катсцена описаны стилями');

// ——— 9. расписание матча ———
check(MATCH.goalsToWin === 3, 'матч играется до трёх голов');
check(MATCH.teamSize === 4, 'на поле по четыре игрока');
check(CLOCK.matchHour * 60 + CLOCK.matchMinute > CLOCK.startHour * 60 + CLOCK.startMinute, 'матч позже начала дня');
check(CLOCK.endHour * 60 + CLOCK.endMinute > CLOCK.matchHour * 60 + CLOCK.matchMinute, 'конец дня позже матча');

console.log(problems === 0 ? '\nчасы и расписание в порядке' : `\nпроблем: ${problems}`);
process.exit(problems === 0 ? 0 : 1);
