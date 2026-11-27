/** Правила езды на лонгборде (сборка v22) — без THREE и DOM, чтобы их можно было
 *  проверить офлайн (`npm run check:board`).
 *
 *  Зачем борд: заказчик выбрал «свободу в мире» и «как в GTA», но у модели героя
 *  нет клипа «сидеть». Стоя на доске, герой выглядит правильно без новой анимации,
 *  а остров 156 × 116 м наконец проезжается, а не проходится.
 *
 *  Физика нарочно аркадная и предсказуемая: толчок ногой даёт импульс, накат
 *  затухает, поворот возможен только на ходу, крен зависит от скорости.
 */

export const BOARD = {
  /** Потолок на асфальте, м/с (7,6 м/с ≈ 27 км/ч — быстро для острова). */
  maxSpeed: 7.6,
  /** Толчок ногой: импульс скорости, м/с. */
  pushImpulse: 1.05,
  /** Пауза между толчками, с: иначе кнопку можно «защёлкать» до мгновенного разгона. */
  pushCooldown: 0.38,
  /** Накат: насколько скорость падает сама, м/с². */
  drag: 0.38,
  /** Торможение ногой, м/с². */
  brake: 5.4,
  /** Угол поворота на полном ходу, рад/с. */
  steerRate: 2.2,
  /** До этой скорости доска почти не слушается руля. */
  steerSpeed: 2.2,
  /** Радиус доски для столкновений, м. */
  radius: 0.34,
  /** Высота деки над землёй, м: герой стоит на доске, а не в ней. */
  deckHeight: 0.115,
  /** Крен: радиан на долю поворота. */
  leanPerSteer: 0.34,
  /** Предел крена, рад. */
  maxLean: 0.34,
  /** Мягкий край крена: возврат к нулю, рад/с². */
  leanReturn: 3.2,
  /** Трава тормозит: дополнительное сопротивление, м/с². */
  offRoadDrag: 2.4,
  /** Ниже этой скорости доска считается стоящей. */
  idleSpeed: 0.12,
} as const;

export interface BoardIntent {
  /** Толчок ногой (кнопка/стик вперёд). */
  readonly push: boolean;
  /** Торможение (стик назад). */
  readonly brake: boolean;
  /** Руль: −1 влево, +1 вправо. */
  readonly steer: number;
}

export interface BoardState {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly lean: number;
}

export class BoardModel {
  private posX = 0;
  private posZ = 0;
  private heading = 0;
  private velocity = 0;
  private tilt = 0;
  private pushTimer = 0;
  private pushed = 0;

  get x(): number {
    return this.posX;
  }

  get z(): number {
    return this.posZ;
  }

  get yaw(): number {
    return this.heading;
  }

  get speed(): number {
    return this.velocity;
  }

  /** 0..1 — по ней считается звук, анимация и крен. */
  get speed01(): number {
    return Math.min(1, this.velocity / BOARD.maxSpeed);
  }

  /**

   * Крен доски и героя: положительный — вправо.
   */
  get lean(): number {
    return this.tilt;
  }

  /** Можно ли толкнуться прямо сейчас (подсказка «толкайся» на экране). */
  get canPush(): boolean {
    return this.pushTimer <= 0 && this.velocity < BOARD.maxSpeed - 0.05;
  }

  /** Сколько толчков сделано за заезд — для звука и статистики. */
  get pushes(): number {
    return this.pushed;
  }

  /** Куда смотрит доска: 0 — на −Z, как у героя. */
  get forward(): { x: number; z: number } {
    return { x: -Math.sin(this.heading), z: -Math.cos(this.heading) };
  }

  reset(x: number, z: number, yaw = 0): void {
    this.posX = x;
    this.posZ = z;
    this.heading = yaw;
    this.velocity = 0;
    this.tilt = 0;
    this.pushTimer = 0;
    this.pushed = 0;
  }

  state(): BoardState {
    return { x: this.posX, z: this.posZ, yaw: this.heading, speed: this.velocity, lean: this.tilt };
  }

  /** Поставить на место после столкновения (мир решает, куда вытолкнуть). */
  place(x: number, z: number): void {
    this.posX = x;
    this.posZ = z;
  }

  /** Шаг физики. dt — только время: разогнать доску частыми кадрами нельзя. */
  step(dt: number, intent: BoardIntent, offRoad = false): void {
    const step = Math.max(0, Math.min(0.1, dt));
    if (step === 0) return;

    this.pushTimer = Math.max(0, this.pushTimer - step);

    if (intent.push && this.canPush) {
      this.velocity = Math.min(BOARD.maxSpeed, this.velocity + BOARD.pushImpulse);
      this.pushTimer = BOARD.pushCooldown;
      this.pushed += 1;
    }

    if (intent.brake) {
      this.velocity = Math.max(0, this.velocity - BOARD.brake * step);
    }

    // Накат: сопротивление всегда против движения, иначе доска «едет» сама
    const resistance = BOARD.drag + (offRoad ? BOARD.offRoadDrag : 0);
    if (this.velocity > 0) {
      this.velocity = Math.max(0, this.velocity - resistance * step);
    }
    if (this.velocity < BOARD.idleSpeed) this.velocity = 0;

    // Руль: на месте доска не поворачивает, на ходу — тем сильнее, чем быстрее
    const steer = Math.max(-1, Math.min(1, intent.steer));
    const authority = Math.min(1, this.velocity / BOARD.steerSpeed);
    const turn = steer * BOARD.steerRate * authority * step;
    this.heading = normaliseAngle(this.heading - turn);

    // Крен тянется к целевому и возвращается, когда руль отпущен
    const target = -steer * BOARD.leanPerSteer * authority;
    const leanStep = (Math.abs(target) > 0.001 ? 6 : BOARD.leanReturn) * step;
    this.tilt = approach(this.tilt, Math.max(-BOARD.maxLean, Math.min(BOARD.maxLean, target)), leanStep);

    if (this.velocity > 0) {
      const forward = this.forward;
      this.posX += forward.x * this.velocity * step;
      this.posZ += forward.z * this.velocity * step;
    }
  }

  /** Удар о стену или бордюр: скорость гаснет, доска остаётся на месте.
   *  `factor` — какая доля скорости сохраняется. */
  absorbImpact(factor = 0.35): void {
    this.velocity *= Math.max(0, Math.min(1, factor));
    if (this.velocity < BOARD.idleSpeed) this.velocity = 0;
  }

  /** Толчок без физики шага — для звука в момент нажатия. */
  tickPushTimer(dt: number): void {
    this.pushTimer = Math.max(0, this.pushTimer - Math.max(0, dt));
  }
}

/** Угол в диапазон −π..π: иначе за долгую езду копится и «сворачивает» руль. */
export function normaliseAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return value;
}
