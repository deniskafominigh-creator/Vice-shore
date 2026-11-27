/** Проверка прыжка без браузера: баллистика, приземление, отсутствие двойного прыжка. */
import { PlayerController } from '../../src/entities/player/PlayerController';

const GROUND = 3.2;
const island = {
  groundHeightAt: () => GROUND,
  collisions: { resolve: (x: number, z: number) => ({ x, z }), isBlocked: () => false },
  clampToIsland: (x: number, z: number) => ({ x, z }),
};
const player = new PlayerController();
player.spawn(0, 0, island as never);
const intent = { forward: 0, strafe: 0, run: false };
const step = 1 / 60;

let maxHeight = 0;
let airFrames = 0;
const jumped = player.jump();
const secondJump = player.jump();
for (let i = 0; i < 200; i += 1) {
  player.update(step, intent, 0, island as never);
  maxHeight = Math.max(maxHeight, player.position.y - GROUND);
  if (player.isAirborne) airFrames += 1;
}
console.log(`прыжок сработал: ${jumped}, повторный в воздухе: ${secondJump}`);
console.log(`высота: ${maxHeight.toFixed(2)} м, полёт: ${(airFrames * step).toFixed(2)} с`);
console.log(`приземлился: ${!player.isAirborne}, y = ${player.position.y.toFixed(3)} (земля ${GROUND})`);
const ok =
  jumped &&
  !secondJump &&
  maxHeight > 0.5 &&
  maxHeight < 1.0 &&
  !player.isAirborne &&
  Math.abs(player.position.y - GROUND) < 1e-6;
console.log(ok ? 'Прыжок: ок' : 'Прыжок: ПРОБЛЕМА');
export const failed = !ok;
