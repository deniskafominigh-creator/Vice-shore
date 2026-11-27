/** Мазок валиком по правилам реальной покраски (уточнение заказчика к задаче 7:
 *  «в одну сторону, не надо по 10 раз, скорость не какая захочешь»).
 *
 *  Правила:
 *   - мазок — **один проход снизу вверх**; валик не трёт одно место туда-сюда;
 *   - темп задаёт мастер, а не игрок: 0,95 м/с, полоса 3,02 м — 3,2 с. Держи
 *     кнопку сколько хочешь — быстрее валик не пойдёт;
 *   - один проход кладёт слой целиком: **повторный проход по той же полосе
 *     ничего не добавляет** (краска не «натирается»);
 *   - с полупустого валика слой реже: полоса ложится пятнами и докрашивается
 *     вторым проходом — это и есть смысл макать валик (R);
 *   - край пятна контакта мягкий: ячейка набирает слой, когда рукав прошёл по ней
 *     хотя бы на треть, поэтому у мазка есть живой «мокрый край».
 *
 *  Модуль без THREE и DOM — правила проверяются офлайн-проверкой `check:paint`.
 */

export const STROKE = {
  /** Темп мастера, м/с. */
  pace: 0.95,
  /** Высота окрашиваемой части стены, м. */
  wallHeight: 3.02,
  /** Полувысота пятна контакта рукава по стене, в долях высоты. */
  sleeveHalf: 0.048,
  /** Ячеек по высоте — как `PAINT.cells`. */
  cells: 18,
  /** Полос на стене — как `PAINT.stripes`. */
  bands: 10,
  /** Ячейка набирает полный слой, когда рукав перекрыл её на эту долю. */
  edge: 0.34,
  /** Краски на одну полосу, в долях площади стены (10 полос — 1,0). */
  paintPerBand: 1 / 10,
  /** Слой с валика, на котором краска на исходе. */
  starvedCoat: 0.55,
  /** Порог «краски нет». */
  dry: 0.0005,
} as const;

export interface StrokeCoat {
  /** Индекс ячейки по высоте, 0 — низ стены. */
  readonly cell: number;
  /** Сколько слоя ложится: 0..1, применяется как «не меньше, чем есть». */
  readonly amount: number;
}

export interface StrokeTick {
  /** Где центр рукава по высоте, 0..1. */
  readonly y: number;
  /** Сколько прошёл валик за шаг, в долях высоты. */
  readonly travelled: number;
  /** Ячейки, по которым рукав прошёл за шаг. */
  readonly coats: readonly StrokeCoat[];
  /** Проход дошёл до верха. */
  readonly finished: boolean;
}

/** Слой, который ляжет за проход: с полного валика — 1, с полупустого — реже. */
export function coatFor(paintOnRoller: number): number {
  if (paintOnRoller <= STROKE.dry) return 0;
  if (paintOnRoller >= STROKE.paintPerBand) return 1;
  const share = paintOnRoller / STROKE.paintPerBand;
  return STROKE.starvedCoat + (1 - STROKE.starvedCoat) * share;
}

/** Сколько секунд идёт полный проход: подсказки, звук, анимация. */
export const STROKE_SECONDS = STROKE.wallHeight / STROKE.pace;

export class RollerStroke {
  private running = false;
  private y = 0;
  private coat = 0;

  /** Идёт ли мазок прямо сейчас. */
  get active(): boolean {
    return this.running;
  }

  /** Где рукав, 0..1. */
  get position(): number {
    return this.y;
  }

  /** Направление прохода всегда одно — снизу вверх. */
  get direction(): 1 {
    return 1;
  }

  /** Начать мазок. Возвращает слой, который ляжет (0 — краски нет, мазок не начался). */
  begin(paintOnRoller: number): number {
    if (this.running) return this.coat;
    const coat = coatFor(paintOnRoller);
    if (coat <= 0) return 0;
    this.running = true;
    this.coat = coat;
    this.y = 0;
    return coat;
  }

  /** Шаг мазка. Ровный темп: dt — единственный источник скорости. */
  tick(dt: number): StrokeTick {
    if (!this.running) {
      return { y: this.y, travelled: 0, coats: [], finished: false };
    }
    const step = Math.max(0, dt) * (STROKE.pace / STROKE.wallHeight);
    const from = this.y;
    const to = Math.min(1, from + step);
    this.y = to;
    const coats = this.coatsBetween(from, to);
    const finished = to >= 1 - 1e-9;
    if (finished) this.running = false;
    return { y: to, travelled: to - from, coats, finished };
  }

  /** Оборвать мазок (пауза, выход из режима): покрытое остаётся покрытым. */
  cancel(): void {
    this.running = false;
  }

  /** Ячейки, которые рукав перекрыл на участке from → to. */
  private coatsBetween(from: number, to: number): StrokeCoat[] {
    const cellHeight = 1 / STROKE.cells;
    const low = Math.max(0, from - STROKE.sleeveHalf);
    const high = Math.min(1, to + STROKE.sleeveHalf);
    const first = Math.max(0, Math.floor(low / cellHeight));
    const last = Math.min(STROKE.cells - 1, Math.floor(high / cellHeight));
    const coats: StrokeCoat[] = [];
    for (let cell = first; cell <= last; cell += 1) {
      const cellLow = cell * cellHeight;
      const cellHigh = cellLow + cellHeight;
      const overlap = Math.min(high, cellHigh) - Math.max(low, cellLow);
      if (overlap <= 1e-6) continue;
      const share = Math.min(1, overlap / cellHeight / STROKE.edge);
      const amount = this.coat * share;
      if (amount <= 0.001) continue;
      coats.push({ cell, amount });
    }
    return coats;
  }
}
