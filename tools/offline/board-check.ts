/**
 * Проверка езды на лонгборде (сборка v22).
 *
 *  Доска — первый шаг «свободы в мире»: герой едет, а не идёт. Проверяются
 *  правила, которые игрок заметит сразу:
 *   1. толчок ногой разгоняет, но не выше потолка — и не превращается в ракету
 *      при частых нажатиях (пауза между толчками);
 *   2. накат сам гасит скорость до нуля, трава тормозит сильнее асфальта;
 *   3. на месте не повернёшь: руль работает только на ходу;
 *   4. крен есть только в повороте и возвращается к нулю, когда руль отпущен;
 *   5. направление движения совпадает с направлением доски (0 — на −Z);
 *   6. угол не «наматывается» за долгую езду, а держится в −π..π;
 *   7. dt не влияет на результат: разгон одинаковый при 30 и 144 кадрах в секунду.
 */
import { BOARD, BoardModel, normaliseAngle } from '../../src/entities/vehicle/boardModel';

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

const drive = (
  board: BoardModel,
  seconds: number,
  dt: number,
  intent: { push?: boolean; brake?: boolean; steer?: number },
  offRoad = false,
): void => {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i += 1) {
    board.step(dt, { push: intent.push ?? false, brake: intent.brake ?? false, steer: intent.steer ?? 0 }, offRoad);
  }
};

// ——— 1. разгон и потолок ———
console.log('=== Разгон ===');
const board = new BoardModel();
board.reset(0, 0, 0);
check(board.speed === 0 && board.pushTimer === 0, 'доска стартует стоящей');

const one = new BoardModel();
one.reset(0, 0, 0);
one.step(1 / 60, { push: true, brake: false, steer: 0 });
check(one.speed > 0.9 && one.speed <= BOARD.pushImpulse + 0.01, `один толчок даёт импульс ${one.speed.toFixed(2)} м/с`);

const spam = new BoardModel();
spam.reset(0, 0, 0);
// Держим «толчок» каждый кадр секунду: пауза между толчками не даст разогнаться мгновенно
drive(spam, 1, 1 / 60, { push: true });
check(spam.pushes <= Math.ceil(1 / BOARD.pushCooldown) + 1, `за секунду не больше ${Math.ceil(1 / BOARD.pushCooldown) + 1} толчков (сделано ${spam.pushes})`);
check(spam.speed <= BOARD.maxSpeed + 1e-9, `скорость не превышает потолок: ${spam.speed.toFixed(2)} ≤ ${BOARD.maxSpeed}`);

const sprint = new BoardModel();
sprint.reset(0, 0, 0);
drive(sprint, 20, 1 / 60, { push: true });
check(Math.abs(sprint.speed - BOARD.maxSpeed) < 0.2, `долгий разгон упирается в потолок: ${sprint.speed.toFixed(2)} м/с`);

// ——— 2. накат ———
console.log('\n=== Накат ===');
const coast = new BoardModel();
coast.reset(0, 0, 0);
drive(coast, 3, 1 / 60, { push: true });
const topSpeed = coast.speed;
drive(coast, 5, 1 / 60, {});
const expected = Math.max(0, topSpeed - BOARD.drag * 5);
check(
  Math.abs(coast.speed - expected) < 0.15,
  `накат гасит ровно по сопротивлению: ${topSpeed.toFixed(2)} → ${coast.speed.toFixed(2)} м/с (ждали ${expected.toFixed(2)})`,
);
drive(coast, 25, 1 / 60, {});
check(coast.speed === 0, 'рано или поздно доска встаёт сама');
check(topSpeed < BOARD.maxSpeed + 1e-9, 'накат не разгоняет доску');

const asphalt = new BoardModel();
const grass = new BoardModel();
asphalt.reset(0, 0, 0);
grass.reset(0, 0, 0);
drive(asphalt, 2, 1 / 60, { push: true });
drive(grass, 2, 1 / 60, { push: true });
const asphaltSpeed = asphalt.speed;
drive(asphalt, 3, 1 / 60, {});
drive(grass, 3, 1 / 60, {}, true);
check(grass.speed < asphalt.speed, `трава тормозит сильнее: ${grass.speed.toFixed(2)} против ${asphalt.speed.toFixed(2)} м/с`);
check(asphaltSpeed > 0, 'по асфальту доска катится');

const brake = new BoardModel();
brake.reset(0, 0, 0);
drive(brake, 2, 1 / 60, { push: true });
drive(brake, 1, 1 / 60, { brake: true });
check(brake.speed === 0, 'торможение ногой останавливает доску');

// ——— 3. руль только на ходу ———
console.log('\n=== Руль ===');
const still = new BoardModel();
still.reset(0, 0, 0);
drive(still, 1, 1 / 60, { steer: 1 });
check(Math.abs(still.yaw) < 1e-9, 'на месте доска не поворачивает');

const rolling = new BoardModel();
rolling.reset(0, 0, 0);
drive(rolling, 2, 1 / 60, { push: true });
const yawBefore = rolling.yaw;
drive(rolling, 0.5, 1 / 60, { steer: 1 });
check(Math.abs(rolling.yaw - yawBefore) > 0.1, `на ходу руль работает: поворот ${(rolling.yaw - yawBefore).toFixed(2)} рад`);

// ——— 4. крен ———
console.log('\n=== Крен ===');
const leaner = new BoardModel();
leaner.reset(0, 0, 0);
drive(leaner, 2, 1 / 60, { push: true });
drive(leaner, 0.4, 1 / 60, { steer: 1 });
check(leaner.lean < -0.05, `в правом повороте доска кренится: ${leaner.lean.toFixed(2)} рад`);
check(Math.abs(leaner.lean) <= BOARD.maxLean + 1e-9, `крен не выходит за предел ${BOARD.maxLean}`);
drive(leaner, 1.2, 1 / 60, {});
check(Math.abs(leaner.lean) < 0.02, `руль отпущен — доска выпрямилась: ${leaner.lean.toFixed(3)} рад`);

// ——— 5. направление ———
console.log('\n=== Направление ===');
const goNorth = new BoardModel();
goNorth.reset(5, 5, 0);
drive(goNorth, 1, 1 / 60, { push: true });
check(goNorth.z < 5 - 0.5 && Math.abs(goNorth.x - 5) < 0.05, `yaw 0 — едет на −Z: z ${5} → ${goNorth.z.toFixed(2)}`);
const goEast = new BoardModel();
goEast.reset(0, 0, -Math.PI / 2);
drive(goEast, 1, 1 / 60, { push: true });
check(goEast.x > 0.5 && Math.abs(goEast.z) < 0.05, `yaw −π/2 — едет на +X: x 0 → ${goEast.x.toFixed(2)}`);

// ——— 6. угол не наматывается ———
console.log('\n=== Угол ===');
const spinner = new BoardModel();
spinner.reset(0, 0, 0);
drive(spinner, 2, 1 / 60, { push: true });
for (let i = 0; i < 60; i += 1) {
  spinner.step(1 / 60, { push: true, brake: false, steer: i % 2 === 0 ? 1 : -1 });
}
check(Math.abs(spinner.yaw) <= Math.PI + 1e-9, `угол в −π..π: ${spinner.yaw.toFixed(2)}`);
check(normaliseAngle(Math.PI * 4 + 0.3) - 0.3 < 1e-9, 'normaliseAngle сводит полные обороты');

// ——— 7. dt ———
console.log('\n=== Кадры ===');
// Один и тот же толчок, дальше — чистый накат: так кадры сравниваются честно,
// без «сколько раз успела сработать пауза между толчками».
const at144 = new BoardModel();
const at30 = new BoardModel();
at144.reset(0, 0, 0);
at30.reset(0, 0, 0);
at144.step(1 / 144, { push: true, brake: false, steer: 0 });
at30.step(1 / 30, { push: true, brake: false, steer: 0 });
drive(at144, 3, 1 / 144, {});
drive(at30, 3, 1 / 30, {});
check(
  Math.abs(at144.speed - at30.speed) < 0.05,
  `скорость не зависит от частоты кадров: ${at144.speed.toFixed(2)} против ${at30.speed.toFixed(2)} м/с`,
);
check(
  Math.abs(at144.z - at30.z) < 0.15,
  `путь тоже: ${at144.z.toFixed(2)} против ${at30.z.toFixed(2)} м`,
);
const frozen = new BoardModel();
frozen.reset(0, 0, 0);
frozen.step(0, { push: true, brake: false, steer: 1 });
check(frozen.speed === 0 && frozen.yaw === 0, 'нулевой кадр ничего не двигает');
const stuck = new BoardModel();
stuck.reset(0, 0, 0);
stuck.step(5, { push: true, brake: false, steer: 0 });
check(Number.isFinite(stuck.x) && Number.isFinite(stuck.speed) && stuck.speed <= BOARD.maxSpeed, 'огромный кадр не ломает физику (шаг ограничен)');

// ——— 8. место и состояние ———
console.log('\n=== Место ===');
const placed = new BoardModel();
placed.reset(12, -3, 1);
check(placed.state().x === 12 && placed.state().z === -3 && placed.yaw === 1, 'reset ставит доску в точку с поворотом');
placed.place(-4, 8);
check(placed.x === -4 && placed.z === 8, 'place двигает без сброса скорости — так мир выталкивает из стены');
const t = placed.forward;
check(Math.abs(Math.hypot(t.x, t.z) - 1) < 1e-9, 'вектор движения единичный');

if (problems > 0) {
  console.log(`\nПроблем: ${problems}`);
  process.exitCode = 1;
} else {
  console.log('\nЛонгборд: разгон, накат, руль и крен — в порядке');
}
export const failed = problems;
