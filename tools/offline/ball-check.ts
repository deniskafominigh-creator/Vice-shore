/** Проверка мяча (задача 16): удар заряжается и бьёт сильнее, мяч катится,
 *  отскакивает, отталкивается от трибуны, ведётся за героем и засчитывает гол. */
import * as THREE from 'three';
import { STADIUM } from '../../src/core/Config';
import { Football, KICK_RANGE, type FootballPlayer } from '../../src/game/Football';
import { CollisionWorld } from '../../src/world/Colliders';
import type { StadiumResult } from '../../src/world/island/Stadium';

/** CanvasTexture в Node: без DOM, но с настоящей заглушкой 2d-контекста. */
const makeCanvas = (): Record<string, unknown> => {
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'canvas') return canvas;
      return () => 0;
    },
    set() { return true; },
  });
  const canvas: Record<string, unknown> = {
    width: 16,
    height: 16,
    style: {},
    getContext: () => ctx,
  };
  return canvas;
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => makeCanvas(),
  createElementNS: () => makeCanvas(),
};

const GROUND = 3.2;
let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

const collisions = new CollisionWorld();
// Трибуна за восточной линией — как в настоящей чаше: мяч гасится о бетон.
collisions.addBox(17, 22, STADIUM.centerZ - 15, STADIUM.centerZ + 15, GROUND + 4);
collisions.addBox(-22, -17, STADIUM.centerZ - 15, STADIUM.centerZ + 15, GROUND + 4);

const goals: Array<[number, number]> = [];
const ballStart = new THREE.Vector3(0, GROUND + STADIUM.ballRadius, STADIUM.centerZ);
const stadium = {
  ballStart,
  goalLines: { west: -16, east: 16 },
  goalHalfWidth: STADIUM.goalWidth / 2,
  goalHeight: STADIUM.goalHeight,
} as unknown as StadiumResult;

const parent = new THREE.Group();
const ball = new Football({
  parent,
  stadium,
  collisions,
  groundHeightAt: () => GROUND,
  onGoal: (home, away) => goals.push([home, away]),
});

const player = (x: number, z: number, yaw: number, speed = 0): FootballPlayer => ({
  x,
  y: GROUND,
  z,
  yaw,
  speed,
  radius: 0.35,
});
const step = (seconds: number, who: FootballPlayer | null = null): void => {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) ball.update(dt, who);
};

// ——— 1. зарядка: дольше держишь — сильнее удар ———
const kicker = player(0, STADIUM.centerZ + 0.5, 0); // yaw 0 → смотрит в −Z, мяч перед ним
check(ball.canKick(kicker), 'мяч в радиусе удара');
check(!ball.canKick(player(0, STADIUM.centerZ + 3, 0)), 'с трёх метров мяч не ударить');

const kickOnce = (hold: number): number => {
  ball.reset();
  check(ball.startCharge(kicker), `зарядка началась (держка ${hold.toFixed(2)} с)`);
  step(hold);
  const power = ball.releaseCharge(kicker);
  const speed = ball.speed;
  console.log(`   держка ${hold.toFixed(2)} с → сила ${(power * 100).toFixed(0)}%, скорость ${speed.toFixed(2)} м/с`);
  return speed;
};
const shortKick = kickOnce(0.15);
const longKick = kickOnce(0.9);
check(longKick > shortKick + 4, 'долгая зарядка бьёт заметно сильнее');
check(shortKick > 4 && longKick < 26, 'скорость удара в разумных пределах');

// ——— 2. сила набралась до 100% и сбросилась ———
ball.reset();
ball.startCharge(kicker);
step(2);
check(Math.abs(ball.charge01 - 1) < 0.001, 'за 2 с сила набирается до 100%');
ball.releaseCharge(kicker);
check(ball.charge01 === 0 && !ball.isCharging, 'после удара зарядка сброшена');

// ——— 3. мяч катится и останавливается ———
ball.reset();
ball.startCharge(kicker);
step(0.5);
ball.releaseCharge(kicker);
const startZ = ball.position.z;
step(0.6);
const rolled = Math.abs(ball.position.z - startZ);
step(14);
check(rolled > 2, `мяч катится: ${rolled.toFixed(1)} м за 0,6 с`);
check(ball.speed < 0.2, `мяч останавливается трением: ${ball.speed.toFixed(2)} м/с`);

// ——— 4. мяч отскакивает от земли ———
ball.reset();
ball.startCharge(kicker);
step(0.9);
ball.releaseCharge(kicker);
let peak = 0;
let bounced = false;
let wasFalling = false;
for (let i = 0; i < 200; i += 1) {
  const before = ball.position.y;
  ball.update(1 / 60, null);
  peak = Math.max(peak, ball.position.y);
  if (ball.position.y < before - 0.001) wasFalling = true;
  if (wasFalling && ball.position.y > before + 0.001 && ball.position.y < peak) bounced = true;
}
check(peak - ballStart.y > 0.4, `мяч подлетает после удара: ${(peak - ballStart.y).toFixed(2)} м`);
check(bounced, 'мяч отскакивает от газона');

// ——— 5. мяч не проходит сквозь трибуну ———
ball.reset();
const pusher = player(14.8, STADIUM.centerZ, -Math.PI / 2);
ball.position.set(15.6, ballStart.y, STADIUM.centerZ);
ball.startCharge(pusher);
step(0.5);
ball.releaseCharge(pusher);
step(3);
check(ball.position.x < 17.2, `мяч остановлен трибуной: x = ${ball.position.x.toFixed(2)}`);

// ——— 6. гол и счёт ———
// Мяч, улетевший в створ на предыдущем шаге, тоже засчитался — начинаем с чистого счёта.
ball.reset(false);
goals.length = 0;
const striker = player(14.5, STADIUM.centerZ, -Math.PI / 2);
ball.position.set(15.2, ballStart.y, STADIUM.centerZ);
ball.startCharge(striker);
step(0.4);
ball.releaseCharge(striker);
step(2);
check(ball.home === 1 && ball.away === 0, `гол в восточные ворота: ${ball.home}:${ball.away}`);
check(goals.length === 1 && goals[0][0] === 1 && goals[0][1] === 0, 'табло получило новый счёт');
step(2);
check(Math.abs(ball.position.x) < 0.2 && Math.abs(ball.position.z - STADIUM.centerZ) < 0.2, 'после гола мяч вернулся на центр');

// ——— 7. ведение мяча ———
ball.reset();
const runner = player(0, STADIUM.centerZ + 0.6, 0, 3.4);
for (let i = 0; i < 40; i += 1) {
  ball.update(1 / 60, runner);
}
check(ball.position.z < STADIUM.centerZ - 0.2, `ведение: мяч ушёл вперёд на ${(STADIUM.centerZ - ball.position.z).toFixed(2)} м`);
check(ball.speed > 1, `мяч катится за героем: ${ball.speed.toFixed(2)} м/с`);

// ——— 8. дальность удара ———
check(Math.abs(KICK_RANGE - 1.35) < 0.001, 'дальность удара совпадает с подсказкой в интерфейсе');

console.log(problems === 0 ? 'Мяч: физика и счёт работают' : `Мяч: проблем ${problems}`);
export const failed = problems > 0;
