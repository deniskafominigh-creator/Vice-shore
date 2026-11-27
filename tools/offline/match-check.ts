/**
 * Проверка матча (задача 22).
 *
 * Прогоняем матч целиком без сцены: чистая симуляция + мяч по тем же константам,
 * что у настоящего футбола (гравитация 16, трение 2.4, отскок 0.42).
 * Смотрим, что игроки живые (бегают, держат зоны, не слипаются), что матч
 * доигрывается до трёх голов, что счёт честный и что после гола игра продолжается.
 */
import { MATCH, STADIUM } from '../../src/core/Config';
import { MatchSim, type MatchBall } from '../../src/game/match/MatchSim';

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

const GROUND = 3.2;
const RADIUS = STADIUM.ballRadius;
const GRAVITY = 16;
const FRICTION = 2.4;
const BOUNCE = 0.42;
const CENTER_X = STADIUM.centerX;
const CENTER_Z = STADIUM.centerZ;
const WEST = CENTER_X - STADIUM.pitchWidth / 2;
const EAST = CENTER_X + STADIUM.pitchWidth / 2;

/** Мяч-двойник Football: та же физика, но без THREE и текстур. */
class TestBall implements MatchBall {
  x = CENTER_X;
  z = CENTER_Z;
  y = GROUND + RADIUS;
  vx = 0;
  vz = 0;
  vy = 0;
  held = false;
  goals = { home: 0, away: 0 };

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  place(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.y = GROUND + RADIUS;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
  }

  kick(vx: number, vz: number, lift: number): void {
    if (this.held) return;
    this.vx = vx;
    this.vz = vz;
    this.vy = Math.hypot(vx, vz) * lift;
  }

  update(dt: number): void {
    if (this.held) {
      this.vx = 0;
      this.vz = 0;
      return;
    }
    const groundY = GROUND + RADIUS;
    const onGround = this.y <= groundY + 0.02;
    this.vy -= GRAVITY * dt;
    const damping = Math.max(0, 1 - (onGround ? FRICTION : 0.4) * dt);
    this.vx *= damping;
    this.vz *= damping;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y += this.vy * dt;
    if (this.y < groundY) {
      this.y = groundY;
      this.vy = Math.abs(this.vy) > 1.1 ? -this.vy * BOUNCE : 0;
    }
    if (onGround && this.speed < 0.12) {
      this.vx = 0;
      this.vz = 0;
    }
    this.checkGoal();
  }

  private checkGoal(): void {
    const inMouth = Math.abs(this.z - CENTER_Z) < STADIUM.goalWidth / 2 - RADIUS * 0.5 && this.y < GROUND + STADIUM.goalHeight;
    if (inMouth && this.x < WEST) {
      this.goals.away += 1;
      this.held = true;
    } else if (inMouth && this.x > EAST) {
      this.goals.home += 1;
      this.held = true;
    }
  }

  centre(): void {
    this.x = CENTER_X;
    this.z = CENTER_Z;
    this.y = GROUND + RADIUS;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.held = false;
  }
}

const ball = new TestBall();
const sim = new MatchSim({ seed: 20261126 });
sim.attachBall(ball);

// ——— 1. состав ———
const home = sim.players.filter((player) => player.team === 'home');
const away = sim.players.filter((player) => player.team === 'away');
check(sim.players.length === MATCH.teamSize * 2, `на поле ${sim.players.length} игроков: 4 на 4`);
check(home.length === MATCH.teamSize && away.length === MATCH.teamSize, 'команды равные');
check(sim.players.filter((player) => player.human).length === 1, 'герой один — играет за «Морских волков»');
check(home.some((player) => player.role === 'gk') && away.some((player) => player.role === 'gk'), 'у обеих команд есть вратарь');
check(new Set(sim.players.map((player) => player.role)).size === 4, 'в схеме есть все роли: gk/def/mid/fwd');

// ——— 2. старт ———
sim.start();
check(sim.state === 'ready' || sim.state === 'kickoff', 'матч стартовал по свистку');
check(sim.events.some((event) => event.type === 'whistle'), 'свисток прозвучал');

// ——— 3. прогон ———
const human = sim.humanPlayer;
let humanKickAt = -10;
const dt = 1 / 60;
/** Заглушка героя: бежит к мячу и бьёт по воротам, когда мяч рядом. */
const humanStep = (): void => {
  const dx = ball.x - human.x;
  const dz = ball.z - human.z;
  const distance = Math.hypot(dx, dz);
  const goalX = EAST;
  if (distance < 0.95 && sim.elapsed - humanKickAt > 0.7) {
    const aimX = goalX - ball.x;
    const aimZ = CENTER_Z - ball.z;
    const length = Math.hypot(aimX, aimZ) || 1;
    ball.kick((aimX / length) * 14, (aimZ / length) * 14, 0.4);
    humanKickAt = sim.elapsed;
  }
  const targetX = distance < 1.0 ? human.x : ball.x;
  const targetZ = distance < 1.0 ? human.z : ball.z;
  const step = MATCH.runSpeed * dt;
  const moveX = targetX - human.x;
  const moveZ = targetZ - human.z;
  const moveLength = Math.hypot(moveX, moveZ);
  if (moveLength > 0.001) {
    human.x += (moveX / moveLength) * Math.min(step, moveLength);
    human.z += (moveZ / moveLength) * Math.min(step, moveLength);
    human.yaw = Math.atan2(-moveX, -moveZ);
  }
  // Герой тоже не выходит за кромку: в игре его держат бортики стадиона
  human.x = Math.min(CENTER_X + MATCH.pitchHalfX, Math.max(CENTER_X - MATCH.pitchHalfX, human.x));
  human.z = Math.min(CENTER_Z + MATCH.pitchHalfZ, Math.max(CENTER_Z - MATCH.pitchHalfZ, human.z));
  sim.setHuman({ x: human.x, z: human.z, yaw: human.yaw, speed: distance < 1.0 ? 0 : MATCH.runSpeed });
};

let prevState = sim.state;
const travelled = sim.players.map(() => 0);
const prevPositions = sim.players.map((player) => ({ x: player.x, z: player.z }));
const startPositions = sim.players.map((player) => ({ x: player.x, z: player.z }));
let closestSameTeam = Infinity;
let samples = 0;
let closeFrames = 0;
let maxOutOfPitch = 0;
let nanFound = false;
const maxSeconds = 240;

for (let t = 0; t < maxSeconds; t += dt) {
  if (sim.state === 'finished') break;
  humanStep();
  const homeBefore = ball.goals.home;
  const awayBefore = ball.goals.away;
  sim.update(dt);
  ball.update(dt);
  if (ball.goals.home !== homeBefore || ball.goals.away !== awayBefore) {
    // Гол забит: сообщаем симуляции, кто отличился
    sim.registerGoal(ball.goals.home > homeBefore);
  }

  // Мяч вернулся в игру после гола — центруем
  if (prevState === 'goal' && sim.state === 'kickoff') ball.centre();
  if (prevState === 'ready' && sim.state === 'play') ball.centre();
  prevState = sim.state;

  // Никаких NaN: иначе игрок улетит в бесконечность
  for (const player of sim.players) {
    if (!Number.isFinite(player.x) || !Number.isFinite(player.z)) nanFound = true;
    maxOutOfPitch = Math.max(
      maxOutOfPitch,
      Math.abs(player.x - CENTER_X) - MATCH.pitchHalfX,
      Math.abs(player.z - CENTER_Z) - MATCH.pitchHalfZ,
    );
  }
  if (!Number.isFinite(ball.x) || !Number.isFinite(ball.z)) nanFound = true;
  sim.players.forEach((player, index) => {
    travelled[index] += Math.hypot(player.x - prevPositions[index].x, player.z - prevPositions[index].z);
    prevPositions[index] = { x: player.x, z: player.z };
  });

  // Плотность: не слипаются ли свои
  if (sim.state === 'play') {
    samples += 1;
    let frameClosest = Infinity;
    for (const team of ['home', 'away'] as const) {
      const mates = sim.players.filter((player) => player.team === team && !player.human);
      for (let i = 0; i < mates.length; i += 1) {
        for (let j = i + 1; j < mates.length; j += 1) {
          frameClosest = Math.min(frameClosest, Math.hypot(mates[i].x - mates[j].x, mates[i].z - mates[j].z));
        }
      }
    }
    closestSameTeam = Math.min(closestSameTeam, frameClosest);
    if (frameClosest < 0.9) closeFrames += 1;
  }
}

const simulated = sim.elapsed;
const totalMoved = travelled.reduce((sum, value) => sum + value, 0);
void startPositions;
const kickEvents = sim.events.filter((event) => event.type === 'shot');
const passEvents = sim.events.filter((event) => event.type === 'pass');
const saveEvents = sim.events.filter((event) => event.type === 'save');
const shoutEvents = sim.events.filter((event) => event.type === 'shout');

console.log(
  `   матч: ${sim.homeScore}:${sim.awayScore}, игрового времени ${simulated.toFixed(1)} с, ` +
    `ударов ${kickEvents.length}, пасов ${passEvents.length}, спасений ${saveEvents.length}, криков ${shoutEvents.length}`,
);

// ——— 4. живые игроки ———
check(totalMoved > 120, `игроки бегают: суммарно ${totalMoved.toFixed(0)} м`);
check(travelled.every((value) => value > 8), `каждый набегал минимум ${Math.min(...travelled).toFixed(1)} м — никто не стоит столбом`);
check(closestSameTeam > 0.8, `свои не слипаются: минимум ${closestSameTeam.toFixed(2)} м`);
check(closeFrames / Math.max(1, samples) < 0.2, `тесно (ближе 0,9 м) лишь ${((closeFrames / Math.max(1, samples)) * 100).toFixed(0)}% кадров`);
check(maxOutOfPitch < 1.35, `никто не убежал с поля: максимум ${maxOutOfPitch.toFixed(2)} м за кромкой`);
check(!nanFound, 'координаты конечные — симуляция не развалилась');

// ——— 5. игра, а не беготня ———
check(kickEvents.length > 0, `по воротам бьют (${kickEvents.length} ударов)`);
check(passEvents.length > 0, `и пасуют (${passEvents.length} пасов)`);
check(shoutEvents.length > 0, 'игроки перекликаются — матч звучит');

// ——— 6. матч до трёх голов ———
check(sim.state === 'finished', `матч завершился за ${simulated.toFixed(1)} с`);
check(
  Math.max(sim.homeScore, sim.awayScore) === MATCH.goalsToWin,
  `победитель набрал ровно ${MATCH.goalsToWin} гола: ${sim.homeScore}:${sim.awayScore}`,
);
check(ball.goals.home === sim.homeScore && ball.goals.away === sim.awayScore, 'счёт симуляции и счёт мяча совпадают');
check(sim.events.filter((event) => event.type === 'goal').length === sim.homeScore + sim.awayScore, 'каждый гол зафиксирован один раз');
check(sim.events.some((event) => event.type === 'finished'), 'финальный свисток есть');
check(simulated < maxSeconds, `матч не зависает: ${simulated.toFixed(1)} с < ${maxSeconds} с`);

// ——— 7. после гола игра продолжается ———
check(sim.events.filter((event) => event.type === 'kickoff').length >= sim.homeScore + sim.awayScore, 'после каждого гола — новая центровка');
check(sim.events.filter((event) => event.type === 'whistle').length === 2, 'свисток в начале и в конце — два');

console.log(problems === 0 ? '\nматч в порядке' : `\nпроблем: ${problems}`);
process.exit(problems === 0 ? 0 : 1);
