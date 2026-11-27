import { CLOCK, CLOCK_STYLE_LABELS, type ClockStyle } from './Config';

/**
 * Игровые часы (задача 22).
 *
 *  Время не декоративное: по нему назначается матч («приходи в 19:00» — значит
 *  в 19:00), по нему же меняются подписи дня и стартует катсцена конца дня.
 *  Часы тикают только когда мир «идёт»: в меню и на паузе время стоит.
 *
 *  Скорость задаётся в игровых минутах за реальную секунду (по умолчанию 1),
 *  поэтому полтора игровых часа до матча — это 80 секунд реального времени:
 *  успеваешь добежать до арены, но не успеваешь заскучать.
 */
export class GameClock {
  /** Минуты от полуночи, 0…1439. */
  private minutes: number;
  private running = false;
  private lastTick = 0;
  /** Дробная часть накопленного времени: иначе при dt < 1 с время «залипает». */
  private accumulated = 0;

  constructor(
    private readonly onChange?: (minutes: number, label: string) => void,
    private readonly rate: number = CLOCK.minutesPerSecond,
  ) {
    this.minutes = CLOCK.startHour * 60 + CLOCK.startMinute;
  }

  get totalMinutes(): number {
    return this.minutes;
  }

  get hour(): number {
    return Math.floor(this.minutes / 60) % 24;
  }

  get minute(): number {
    return this.minutes % 60;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** «19:00» — формат без локали: в игре часы всегда 24-часовые. */
  get label(): string {
    return `${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`;
  }

  /** Часть дня для подписи под часами: «УТРО», «ДЕНЬ», «ВЕЧЕР», «НОЧЬ». */
  get partOfDay(): string {
    const h = this.hour;
    if (h >= 5 && h < 11) return 'УТРО';
    if (h >= 11 && h < 17) return 'ДЕНЬ';
    if (h >= 17 && h < 22) return 'ВЕЧЕР';
    return 'НОЧЬ';
  }

  get styleCaption(): string {
    return CLOCK_STYLE_LABELS[this.style];
  }

  private style: ClockStyle = 'neon';

  setStyle(style: ClockStyle): void {
    this.style = style;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /** Поставить время вручную (катсцена конца дня, отладка). */
  setTime(hour: number, minute: number): void {
    this.minutes = ((Math.round(hour) * 60 + Math.round(minute)) % 1440 + 1440) % 1440;
    this.accumulated = 0;
    this.emit();
  }

  /** Прыжок вперёд в минутах. */
  advanceMinutes(minutes: number): void {
    this.setTime(Math.floor((this.minutes + minutes) / 60), (this.minutes + minutes) % 60);
  }

  /** Сколько игровых минут осталось до указанного часа:минуты (по кругу суток). */
  minutesUntil(hour: number, minute: number): number {
    const target = hour * 60 + minute;
    const delta = (target - this.minutes + 1440) % 1440;
    return delta === 0 ? 0 : delta;
  }

  /** Догнать указанное время: не «дошло ли», а «поставь ровно это время». */
  catchUpTo(hour: number, minute: number): void {
    this.setTime(hour, minute);
  }

  /** Тик реального времени. Возвращает число прошедших игровых минут. */
  update(dtSeconds: number): number {
    if (!this.running || dtSeconds <= 0) return 0;
    this.accumulated += dtSeconds * this.rate;
    const whole = Math.floor(this.accumulated);
    if (whole <= 0) return 0;
    this.accumulated -= whole;
    const before = this.minutes;
    this.minutes = (this.minutes + whole) % 1440;
    if (this.minutes !== before) this.emit();
    return whole;
  }

  private emit(): void {
    this.lastTick = this.minutes;
    this.onChange?.(this.minutes, this.label);
  }

  /** Минуты, прошедшие с последнего события (для отладки). */
  get sinceLastTick(): number {
    return this.minutes - this.lastTick;
  }
}
