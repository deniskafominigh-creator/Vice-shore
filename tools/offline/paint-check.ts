/**
 * Проверка покраски валиком «как в реальной жизни» (сборка v21).
 *
 *  Заказчик: «сделай покраску валиком пореалистичнее: звук мазка, в одну сторону,
 *  не надо по 10 раз, скорость не какая захочешь».
 *
 *  Отсюда правила, которые и проверяются:
 *   1. мазок идёт только в одну сторону — снизу вверх;
 *   2. темп задаёт мастер: ни удержание кнопки, ни частота нажатий не ускоряют проход;
 *   3. один проход кладёт слой целиком — второй проход по той же полосе не добавляет
 *      ничего (никакого «натирания» одного места по десять раз);
 *   4. с полупустого валика слой реже, и полоса докрашивается **вторым** проходом,
 *      а не десятым;
 *   5. мазок не начинается с сухого валика; пройденное остаётся пройденным;
 *   6. покрытие никогда не выходит за 0..1 и не «переливается» выше 100 %.
 */
import { RollerStroke, STROKE, STROKE_SECONDS, coatFor } from '../../src/game/rollerStroke';
import { PAINT } from '../../src/world/island/Renovation';

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

/** Маленькая «стена» с теми же правилами покрытия, что у PaintWall.coatCell. */
class FakeWall {
  readonly cells = new Array<number>(STROKE.cells).fill(0);

  coat(cell: number, amount: number): number {
    const before = this.cells[cell] ?? 0;
    const after = Math.min(1, Math.max(before, amount));
    this.cells[cell] = after;
    return after - before;
  }

  get covered(): number {
    return this.cells.reduce((sum, value) => sum + value, 0) / STROKE.cells;
  }

  get full(): number {
    return this.cells.filter((value) => value >= 0.999).length;
  }
}

/** Один проход целиком: тот же цикл, что в PaintMission.updatePainting. */
function pass(stroke: RollerStroke, wall: FakeWall, paint: number, dt: number): { spent: number; seconds: number } {
  stroke.begin(paint);
  let spent = 0;
  let seconds = 0;
  for (let guard = 0; guard < 5000 && stroke.active; guard += 1) {
    const tick = stroke.tick(dt);
    seconds += dt;
    for (const coat of tick.coats) spent += wall.coat(coat.cell, coat.amount);
    if (tick.finished) break;
  }
  // Как в PaintMission: прирост ячеек → доля площади стены
  return { spent: spent / (STROKE.bands * STROKE.cells), seconds };
}

// ——— 0. правила совпадают с самой стеной ———
console.log('=== Стена ===');
check(
  STROKE.cells === PAINT.cells && STROKE.bands === PAINT.stripes,
  `сетка мазка совпадает со стеной: ${STROKE.bands} полос × ${STROKE.cells} ячеек`,
);
check(
  Math.abs(STROKE.paintPerBand * STROKE.bands - 1) < 1e-9,
  'на всю стену уходит ровно столько краски, сколько полос',
);

// ——— 1. темп мастера ———
console.log('=== Темп ===');
const wallClock = STROKE.wallHeight / STROKE.pace;
check(
  Math.abs(wallClock - STROKE_SECONDS) < 1e-9 && STROKE_SECONDS > 2.4 && STROKE_SECONDS < 4.2,
  `полный проход по стене ${STROKE.wallHeight} м — ${STROKE_SECONDS.toFixed(2)} с (темп ${STROKE.pace} м/с, как у мастера)`,
);

const fast = new RollerStroke();
const fastWall = new FakeWall();
const fastPass = pass(fast, fastWall, 1, 1 / 144); // частые кадры
const slow = new RollerStroke();
const slowWall = new FakeWall();
const slowPass = pass(slow, slowWall, 1, 1 / 24); // редкие кадры
check(
  Math.abs(fastPass.seconds - slowPass.seconds) < 0.1,
  `время прохода не зависит от частоты кадров: ${fastPass.seconds.toFixed(2)} с против ${slowPass.seconds.toFixed(2)} с`,
);
check(
  Math.abs(fastWall.covered - slowWall.covered) < 0.02,
  `покрытие тоже: ${(fastWall.covered * 100).toFixed(1)} % против ${(slowWall.covered * 100).toFixed(1)} %`,
);

// ——— 2. в одну сторону ———
console.log('\n=== В одну сторону ===');
const direct = new RollerStroke();
direct.begin(1);
const ys: number[] = [];
for (let i = 0; i < 400 && direct.active; i += 1) {
  ys.push(direct.tick(1 / 60).y);
}
check(direct.direction === 1, 'направление мазка — только вверх (одно значение, не «туда-сюда»)');
check(
  ys.every((y, index) => index === 0 || y >= ys[index - 1] - 1e-9),
  `валик не разворачивается внутри мазка: ${ys.length} кадров, высота только растёт`,
);
check(Math.abs(ys[ys.length - 1] - 1) < 1e-6, 'проход заканчивается у верха стены');

// ——— 3. один проход = слой целиком, второй ничего не добавляет ———
console.log('\n=== Один проход ===');
const one = new RollerStroke();
const oneWall = new FakeWall();
const first = pass(one, oneWall, 1, 1 / 60);
check(oneWall.full === STROKE.cells, `после одного прохода окрашены все ${STROKE.cells} ячеек полосы`);
check(oneWall.covered > 0.99, `покрытие полосы ${(oneWall.covered * 100).toFixed(1)} % с первого прохода`);
const second = pass(one, oneWall, 1, 1 / 60);
check(second.spent === 0, 'второй проход по той же полосе не добавляет слоя (краска не натирается)');
check(Math.abs(first.spent - STROKE.paintPerBand) < 0.02, `расход за проход ${first.spent.toFixed(3)} ≈ ${STROKE.paintPerBand} площади стены`);

// ——— 4. полупустой валик: пятна и второй проход ———
console.log('\n=== Валик на исходе ===');
check(coatFor(0) === 0, 'сухой валик не кладёт слой');
check(coatFor(STROKE.paintPerBand / 2) < 0.9, 'с полупустого валика слой реже — полоса ложится пятнами');
check(coatFor(STROKE.paintPerBand) === 1 && coatFor(1) === 1, 'с полного валика слой полный');

const starved = new RollerStroke();
const starvedWall = new FakeWall();
pass(starved, starvedWall, STROKE.paintPerBand * 0.4, 1 / 60);
check(starvedWall.covered < 0.9, `после прохода на исходе полоса покрыта на ${(starvedWall.covered * 100).toFixed(0)} % — пятнами`);
pass(starved, starvedWall, 1, 1 / 60);
check(
  starvedWall.covered > 0.99,
  `второй проход после макания докрашивает полосу: ${(starvedWall.covered * 100).toFixed(0)} % — «по 10 раз» не нужно`,
);

// ——— 5. сухой валик и оборванный мазок ———
console.log('\n=== Сухой валик и обрыв ===');
const dryRun = new RollerStroke();
check(dryRun.begin(0) === 0 && !dryRun.active, 'с сухого валика мазок не начинается — сначала макнуть (R)');

const cut = new RollerStroke();
const cutWall = new FakeWall();
cut.begin(1);
for (let i = 0; i < 20; i += 1) {
  const tick = cut.tick(1 / 60);
  for (const coat of tick.coats) cutWall.coat(coat.cell, coat.amount);
}
const beforeCut = cutWall.covered;
cut.cancel();
check(!cut.active && cutWall.covered === beforeCut, 'оборванный мазок не откатывает уже положенную краску');
check(beforeCut > 0 && beforeCut < 1, `оборванный мазок оставил полосу недокрашенной: ${(beforeCut * 100).toFixed(0)} %`);

// ——— 6. границы ———
console.log('\n=== Границы ===');
const bounds = new RollerStroke();
bounds.begin(1);
let outOfRange = 0;
for (let i = 0; i < 400 && bounds.active; i += 1) {
  const tick = bounds.tick(1 / 30);
  if (tick.y < 0 || tick.y > 1) outOfRange += 1;
  for (const coat of tick.coats) if (coat.cell < 0 || coat.cell >= STROKE.cells) outOfRange += 1;
}
check(outOfRange === 0, 'высота валика и номера ячеек не выходят за стену');
check(
  new RollerStroke().tick(0.1).coats.length === 0,
  'без начатого мазка шаг ничего не красит',
);
const huge = new RollerStroke();
const hugeWall = new FakeWall();
huge.begin(1);
const jump = huge.tick(10); // кадр «завис» на 10 секунд
for (const coat of jump.coats) hugeWall.coat(coat.cell, coat.amount);
check(jump.finished && jump.y <= 1, 'долгий кадр не проскакивает верх стены');
check(
  hugeWall.cells.every((value) => value >= 0 && value <= 1),
  'покрытие после долгого кадра остаётся в 0..1',
);

if (problems > 0) {
  console.log(`\nПроблем: ${problems}`);
  process.exitCode = 1;
} else {
  console.log('\nПокраска валиком: один проход, один слой, темп мастера — в порядке');
}
export const failed = problems;
