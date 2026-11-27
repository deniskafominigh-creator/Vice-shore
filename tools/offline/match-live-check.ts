/**
 * Матч «в железе» (задача 22): настоящая чаша, настоящий мяч, настоящая симуляция.
 *
 *  `check:match` гоняет чистую логику на упрощённом мяче. Здесь то же самое, но
 *  на настоящих воротах и коллизиях стадиона: чаша, сетка, трибуны. Именно этот
 *  прогон отвечает на вопрос «почему в игре никто не забивает»: если мяч не
 *  пересекает линию, значит его держат бортик, сетка или сам симулятор.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MATCH, STADIUM } from '../../src/core/Config';
import { Football } from '../../src/game/Football';
import { MatchSim } from '../../src/game/match/MatchSim';
import { CollisionWorld } from '../../src/world/Colliders';
import { buildStadium, type StadiumResult } from '../../src/world/island/Stadium';
import type { IslandMaterials } from '../../src/world/island/IslandTextures';

const makeCanvas = (): Record<string, unknown> => {
  const ctx = new Proxy({}, { get: () => () => 0, set: () => true });
  return { width: 16, height: 16, style: {}, getContext: () => ctx };
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => makeCanvas(),
  createElementNS: () => makeCanvas(),
};

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

const cache = new Map<string, THREE.MeshStandardMaterial>();
const materials = new Proxy({} as Record<string, THREE.MeshStandardMaterial>, {
  get(_t, prop: string) {
    if (prop === 'dispose') return () => undefined;
    let material = cache.get(prop);
    if (!material) {
      material = new THREE.MeshStandardMaterial();
      material.name = prop;
      cache.set(prop, material);
    }
    return material;
  },
}) as unknown as IslandMaterials;

const collisions = new CollisionWorld();
const stadium: StadiumResult = buildStadium(materials, collisions);
const GROUND = STADIUM.groundY ?? 3.2;

// Та же функция высоты, что в Game: поле на 5 см выше плато.
const groundHeightAt = (x: number, z: number): number => {
  const onPitch =
    Math.abs(x - STADIUM.centerX) <= STADIUM.pitchWidth / 2 &&
    Math.abs(z - STADIUM.centerZ) <= STADIUM.pitchDepth / 2;
  return GROUND + (onPitch ? 0.05 : 0);
};

const parent = new THREE.Group();
const goals: Array<{ home: number; away: number }> = [];
let football!: Football;
const ball: Football = new Football({
  parent,
  stadium,
  collisions,
  groundHeightAt,
  onGoal: (home, away) => goals.push({ home, away }),
});
football = ball;

const sim = new MatchSim({ seed: 20261126 });
sim.attachBall(ball);
sim.start();
ball.setAutoCentre(false);

const me = (): { x: number; y: number; z: number; yaw: number; speed: number; radius: number } => ({
  x: sim.humanPlayer.x,
  y: GROUND,
  z: sim.humanPlayer.z,
  yaw: sim.humanPlayer.yaw,
  speed: sim.humanPlayer.speed01 * MATCH.runSpeed,
  radius: 0.36,
});

const dt = 1 / 60;
let goalsByHuman = 0;
let charging = 0;
let humanAt = -10;

console.log(
  `ворота: запад ${stadium.goalLines.west.toFixed(1)} · восток ${stadium.goalLines.east.toFixed(1)} · ` +
    `створ ±${stadium.goalHalfWidth.toFixed(1)} · высота ${stadium.goalHeight.toFixed(1)}`,
);

// Герой играет как человек: бежит к мячу и бьёт по воротам, когда мяч рядом.
const maxSeconds = 240;
for (let t = 0; t < maxSeconds; t += dt) {
  if (sim.state === 'finished') break;
  const hero = sim.humanPlayer;
  const dx = ball.position.x - hero.x;
  const dz = ball.position.z - hero.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 0.8) {
    const step = MATCH.runSpeed * dt;
    hero.x += (dx / distance) * Math.min(step, distance - 0.8);
    hero.z += (dz / distance) * Math.min(step, distance - 0.8);
    hero.yaw = Math.atan2(-dx, -dz);
  }
  // Бьём так же, как игрок: зажали Space рядом с мячом, отпустили через пол-секунды.
  // Направление удара берётся из yaw героя, поэтому сначала смотрим в створ.
  const goalX = stadium.goalLines.east;
  const toGoalX = goalX - ball.position.x;
  const toGoalZ = STADIUM.centerZ - ball.position.z;
  hero.yaw = Math.atan2(-toGoalX, -toGoalZ);
  const player = me();
  if (!charging) {
    if (distance < 1.25 && football.startCharge(player)) charging = sim.elapsed;
  } else if (sim.elapsed - charging >= 0.55) {
    const power = football.releaseCharge(me());
    charging = 0;
    if (power > 0) {
      goalsByHuman += 1;
      humanAt = sim.elapsed;
    }
  }
  sim.setHuman({ x: hero.x, z: hero.z, yaw: hero.yaw, speed: distance < 1.1 ? 0 : MATCH.runSpeed });
  const goalsBefore = goals.length;
  const stateBefore = sim.state;
  sim.update(dt);
  ball.update(dt, me());
  // Как и в игре: симуляция дала свисток и центровку — возвращаем мяч в игру
  if (sim.state === 'kickoff' && stateBefore !== 'kickoff') ball.reset(true);
  if (goals.length > goalsBefore) {
    const last = goals[goals.length - 1];
    const prev = goals.length > 1 ? goals[goals.length - 2] : { home: 0, away: 0 };
    sim.registerGoal(last.home > prev.home);
  }
  if (ball.position.x > 200 || ball.position.y < 0) {
    console.log('мяч улетел с плато — сброс');
    ball.reset(true);
  }
}

console.log(
  `   матч: ${sim.homeScore}:${sim.awayScore} за ${sim.elapsed.toFixed(1)} с · ` +
    `ударов ${sim.events.filter((e) => e.type === 'shot').length} · ` +
    `пасов ${sim.events.filter((e) => e.type === 'pass').length} · ` +
    `голов мяча ${goals.length} · ударов героя ${goalsByHuman}`,
);

// ——— 1. мяч вообще может забить в этих воротах ———
const mouthZ = STADIUM.centerZ;
const mouthY = GROUND + stadium.goalHeight * 0.5;
check(!collisions.isBlocked(stadium.goalLines.east + 0.4, mouthZ, STADIUM.ballRadius, mouthY), 'за линией восточных ворот пусто — мяч не упирается в бетон');
check(!collisions.isBlocked(stadium.goalLines.west - 0.4, mouthZ, STADIUM.ballRadius, mouthY), 'за линией западных ворот пусто');
check(!collisions.isBlocked(stadium.goalLines.east + 0.4, mouthZ, STADIUM.ballRadius, GROUND + 0.3), 'низ створа тоже свободен');
check(
  !collisions.isBlocked(stadium.goalLines.east + 0.9, mouthZ, STADIUM.ballRadius, GROUND + 0.3),
  'мяч может уйти в сетку глубже линии',
);

// ——— 2. голы вообще случились ———
check(goals.length >= 3, `мяч побывал в сетке ${goals.length} раз`);
check(sim.homeScore + sim.awayScore >= 3, `симуляция засчитала ${sim.homeScore + sim.awayScore} голов`);
check(sim.state === 'finished', `матч завершён за ${sim.elapsed.toFixed(1)} с (${sim.homeScore}:${sim.awayScore})`);
check(Math.max(sim.homeScore, sim.awayScore) === MATCH.goalsToWin, `победитель набрал ${MATCH.goalsToWin} гола`);
check(goals.length === sim.homeScore + sim.awayScore, 'мяч и симуляция считают одинаково');
check(goalsByHuman > 0, `герой бил по воротам ${goalsByHuman} раз — кнопка удара работает`);

// ——— 3. герой может забрать мяч у ИИ (жалоба «мяч держит только один») ———
ball.setAutoCentre(true);
ball.reset(true);
ball.setAutoCentre(false);
const stealSim = new MatchSim({ seed: 4242 });
stealSim.attachBall(ball);
stealSim.start();
// Герой в стороне: мяч подбирает ИИ
stealSim.setHuman({
  x: STADIUM.centerX - 11,
  z: STADIUM.centerZ + 6,
  yaw: 0,
  speed: 0,
});
let ownerBefore: { id: number; team: string; human: boolean } | null = null;
for (let i = 0; i < 300 && !ownerBefore; i += 1) {
  stealSim.update(dt);
  const current = stealSim.ballOwner;
  if (current && !current.human) ownerBefore = current;
}
// Герой подбегает вплотную к мячу и бежит в него
for (let i = 0; i < 12; i += 1) {
  const hero = stealSim.humanPlayer;
  hero.x = ball.position.x - 0.4;
  hero.z = ball.position.z;
  stealSim.setHuman({
    x: hero.x,
    z: hero.z,
    yaw: Math.atan2(-(ball.position.x - hero.x), -(ball.position.z - hero.z)),
    speed: 4,
  });
  stealSim.update(dt);
}
const ownerAfter = stealSim.ballOwner;
console.log(`   мяч: у ИИ (${ownerBefore?.id ?? '—'}) → у героя (${ownerAfter?.id ?? '—'}, human ${ownerAfter?.human})`);
check(ownerBefore !== null && ownerBefore.human === false, 'ИИ действительно владел мячом');
check(ownerAfter !== null && ownerAfter.human === true, 'герой отбирает мяч у ИИ, подойдя вплотную');

// ——— 4. голы доходят до счёта: проводка в Game, а не только в симуляции ———
const gameSource = readFileSync('src/game/Game.ts', 'utf8');
check(gameSource.includes('this.match.handleFootballGoal(home, away)'), 'гол из мяча уходит в счёт матча (проводка в Game)');
check(gameSource.includes('this.match?.isRunning'), 'гол до матча не считается матчевым');
const matchSource = readFileSync('src/game/match/MatchSim.ts', 'utf8');
check(matchSource.includes('ball.speed > 5'), 'летящий мяч не приклеивается к ведущему — удар долетает');
check(matchSource.includes('humanDistance < 1.0'), 'герой может отобрать мяч у ИИ');

console.log(problems === 0 ? '\nматч в настоящей чаше идёт' : `\nпроблем: ${problems}`);
process.exit(problems === 0 ? 0 : 1);
