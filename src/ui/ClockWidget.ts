import type { ClockStyle } from '../core/Config';
import { el } from './dom';

/**
 * Часы сверху экрана (задача 22).
 *
 *  Появляются после двух вступительных миссий и живут по центру верхней кромки,
 *  не мешая плашке задачи (она ниже и уже). Три стиля — переключаются в
 *  настройках: циферблат (стрелки), табло (цифры с подписью части дня) и неон
 *  (те же цифры, но с тёплым свечением в духе города).
 *
 *  Часы сделаны на SVG и тексте без картинок: их видно в любом масштабе, а
 *  перерисовка — это смена `textContent` и двух `transform`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

export class ClockWidget {
  readonly root: HTMLElement;
  private readonly digits: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly analog: SVGSVGElement;
  private readonly hourHand: SVGLineElement;
  private readonly minuteHand: SVGLineElement;
  private style: ClockStyle = 'neon';
  private minutes = 0;
  private visible = false;

  constructor() {
    this.digits = el('span', { className: 'clock__digits', text: '17:40' });
    this.caption = el('span', { className: 'clock__caption', text: 'ВЕЧЕР' });

    // Циферблат: тонкое кольцо, четыре метки и две стрелки
    this.analog = svg('svg', { viewBox: '0 0 100 100', class: 'clock__face' });
    this.analog.append(svg('circle', { cx: '50', cy: '50', r: '46', class: 'clock__ring' }));
    for (const hour of [12, 3, 6, 9]) {
      const angle = (hour / 12) * Math.PI * 2;
      this.analog.append(
        svg('circle', {
          cx: String(50 + Math.sin(angle) * 36),
          cy: String(50 - Math.cos(angle) * 36),
          r: '2.6',
          class: 'clock__tick',
        }),
      );
    }
    this.hourHand = svg('line', { x1: '50', y1: '50', x2: '50', y2: '26', class: 'clock__hand clock__hand--hour' });
    this.minuteHand = svg('line', { x1: '50', y1: '54', x2: '50', y2: '14', class: 'clock__hand clock__hand--minute' });
    this.analog.append(this.hourHand, this.minuteHand, svg('circle', { cx: '50', cy: '50', r: '3.4', class: 'clock__pin' }));

    const digital = el('div', { className: 'clock__stack' }, this.digits, this.caption);

    this.root = el('div', { className: 'clock', attrs: { role: 'timer', 'aria-live': 'off' } });
    this.root.append(this.analog, digital);
    this.root.classList.add('is-hidden');
    this.applyStyle();
    this.setTime(0);
  }

  setStyle(style: ClockStyle): void {
    if (this.style === style) return;
    this.style = style;
    this.applyStyle();
  }

  private applyStyle(): void {
    this.root.dataset.style = this.style;
    // В цифровых стилях циферблат убирается, в аналоговом — прячется текст
    this.analog.classList.toggle('is-off', this.style !== 'analog');
    this.digits.parentElement?.classList.toggle('is-off', this.style === 'analog');
    this.root.classList.toggle('is-analog', this.style === 'analog');
  }

  setTime(minutes: number): void {
    this.minutes = ((minutes % 1440) + 1440) % 1440;
    const hour = Math.floor(this.minutes / 60);
    const minute = this.minutes % 60;
    this.digits.textContent = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    this.caption.textContent = this.partOfDay(hour);
    const hourAngle = ((hour % 12) + minute / 60) * 30;
    const minuteAngle = minute * 6;
    this.hourHand.setAttribute('transform', `rotate(${hourAngle.toFixed(2)} 50 50)`);
    this.minuteHand.setAttribute('transform', `rotate(${minuteAngle.toFixed(2)} 50 50)`);
  }

  private partOfDay(hour: number): string {
    if (hour >= 5 && hour < 11) return 'УТРО';
    if (hour >= 11 && hour < 17) return 'ДЕНЬ';
    if (hour >= 17 && hour < 22) return 'ВЕЧЕР';
    return 'НОЧЬ';
  }

  get timeLabel(): string {
    return this.digits.textContent ?? '';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.root.classList.remove('is-hidden');
    this.root.classList.add('is-visible');
  }

  hide(): void {
    this.visible = false;
    this.root.classList.remove('is-visible');
    this.root.classList.add('is-hidden');
  }

  /** Мигание «время матча»: подсветить часы, когда до начала меньше 5 минут. */
  setUrgent(urgent: boolean): void {
    this.root.classList.toggle('is-urgent', urgent);
  }

  /** Обратный отсчёт до матча вместо подписи части дня — на время ожидания. */
  setHint(text: string | null): void {
    this.caption.textContent = text ?? this.partOfDay(Math.floor(this.minutes / 60));
    this.root.classList.toggle('is-hint', text !== null);
  }

  get minutesValue(): number {
    return this.minutes;
  }
}
