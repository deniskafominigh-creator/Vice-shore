import { MATCH, STADIUM } from '../../core/Config';

/**
 * Футбольный матч — чистая логика без сцены (задача 22).
 *
 *  Здесь нет ни одного меша и ни одного DOM-обращения: только позиции, скорости,
 *  решения и правила. Благодаря этому матч можно прогнать целиком в оффлайн-
 *  проверке (`npm run check:match`) — симулировать 90 игровых секунд и убедиться,
 *  что команды бегают, бьют, забивают и матч честно заканчивается на третьем голе.
 *
 *  Почему «игроки не как боты»:
 *   • у каждого своя роль и свой якорь в схеме — команда держит ширину, а не сбивается в кучу;
 *   • решение принимается не каждый кадр, а по таймеру реакции (0,18–0,35 с), поэтому
 *     есть честное «замешкался»;
 *   • у каждого свой шум в цели (свой ритм, своя амплитуда) — траектории не совпадают;
 *   • усталость: рывок тратит запас, запас ограничивает скорость;
 *   • с мячом игрок выбирает удар / пас / ведение по обстановке, а не всегда бьёт;
 *   • без мяча — опека ближайшего соперника и поддержка атаки, с расталкиванием
 *     своих, чтобы не стоять друг на друге.
 */

export type MatchState = 'idle' | 'ready' | 'kickoff' | 'play' | 'goal' | 'finished';
export type TeamId = 'home' | 'away';
export type Role = 'gk' | 'def' | 'mid' | 'fwd';
export type PlayerAction = 'idle' | 'run' | 'kick' | 'celebrate' | 'sad';

export interface MatchBall {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly speed: number;
  /** Удар/толчок: скорость по земле и подъём. */
  kick(vx: number, vz: number, lift: number): void;
  /** Поставить мяч в точку (ведение и возврат в игру после аута). */
  place(x: number, z: number): void;
}

export interface HumanState {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
}

export interface SimPlayer {
  readonly id: number;
  readonly team: TeamId;
  readonly role: Role;
  /** Человек (герой) — им управляет игрок, а не ИИ. */
  readonly human: boolean;
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  /** Запас сил 0…1: рывок тратит, пауза восстанавливает. */
  stamina: number;
  speed01: number;
  action: PlayerAction;
  actionTimer: number;
  /** Якорь в схеме относительно центра поля (по X — в сторону атаки). */
  anchorX: number;
  anchorZ: number;
  /** Свой ритм и фаза шума: игроки не ходят строем. */
  rhythm: number;
  noiseAmp: number;
  /** Задержка реакции, с. */
  reaction: number;
  /** Множитель скорости: герою и его команде чуть легче, соперник чуть медленнее. */
  speedScale: number;
  decisionTimer: number;
  /** Мяч у этого игрока (в пределах контроля). */
  hasBall: boolean;
  /** Кулдаун удара/паса, чтобы не бить каждый кадр. */
  kickCooldown: number;
  /** Последняя цель — для отладки и проверок. */
  targetX: number;
  targetZ: number;
}

export type MatchEventType =
  | 'kickoff'
  | 'goal'
  | 'shot'
  | 'pass'
  | 'save'
  | 'tackle'
  | 'shout'
  | 'whistle'
  | 'finished';

export interface MatchEvent {
  readonly type: MatchEventType;
  readonly team?: TeamId;
  readonly player?: number;
  /** Сила удара 0…1 (для звука). */
  readonly power?: number;
  readonly byHome?: boolean;
}

export interface MatchOptions {
  readonly goalsToWin?: number;
  readonly seed?: number;
}

const CENTER_X = STADIUM.centerX;
const CENTER_Z = STADIUM.centerZ;
const HALF_X = MATCH.pitchHalfX;
const HALF_Z = MATCH.pitchHalfZ;
/** Ворота-линия: по X, проём по Z. */
const GOAL_WEST = CENTER_X - STADIUM.pitchWidth / 2;
const GOAL_EAST = CENTER_X + STADIUM.pitchWidth / 2;
/** Радиус контроля мяча у полевого игрока. */
const CONTROL = 0.62;
/** Радиус, с которого можно бить по воротам. */
const SHOOT_RANGE = 12;
/** Предел «шума» цели и раскачки — чтобы игроки не телепортировались. */
const ACCEL = MATCH.acceleration;
const TURN_RATE = 9;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MatchSim {
  readonly players: SimPlayer[] = [];
  readonly events: MatchEvent[] = [];
  state: MatchState = 'idle';
  homeScore = 0;
  awayScore = 0;
  /** Игровое время матча, с. */
  elapsed = 0;
  private readonly goalsToWin: number;
  private readonly random: () => number;
  private ballRef: MatchBall | null = null;
  private human: HumanState | null = null;
  private goalPause = 0;
  private kickoffTeam: TeamId = 'home';
  private shoutTimer = 6;
  /** Кто сейчас владеет мячом: он ведёт, остальные прессингуют. */
  private possession: SimPlayer | null = null;
  private possessionTime = 0;
  private lastPossessionTeam: TeamId | null = null;
  private carryTimer = 0;
  /** Сколько мяч уже вне поля — для вбрасывания. */
  private outTimer = 0;
  /** Сколько секунд ничего не происходит — страховка от зависания. */
  private stallTimer = 0;

  constructor(options: MatchOptions = {}) {
    this.goalsToWin = options.goalsToWin ?? MATCH.goalsToWin;
    this.random = mulberry32(options.seed ?? 20261126);
    this.setupTeams();
  }

  /** Состав: герой — центральный нападающий домашней команды. */
  private setupTeams(): void {
    let id = 0;
    const add = (team: TeamId, role: Role, human: boolean, anchorX: number, anchorZ: number): void => {
      this.players.push({
        id: id++, team, role, human,
        x: CENTER_X, z: CENTER_Z, yaw: team === 'home' ? -Math.PI / 2 : Math.PI / 2,
        vx: 0, vz: 0,
        stamina: 1, speed01: 0,
        action: 'idle', actionTimer: 0,
        anchorX, anchorZ,
        rhythm: 0.8 + this.random() * 0.7,
        noiseAmp: 0.22 + this.random() * 0.3,
        reaction: (0.16 + this.random() * 0.2) * (team === 'away' ? 1.16 : 1),
        speedScale: human ? 1 : team === 'home' ? 1.03 : 0.95,
        decisionTimer: 0,
        hasBall: false, kickCooldown: 0,
        targetX: CENTER_X, targetZ: CENTER_Z,
      });
    };
    // Домашние атакуют на восток (+X), гости — на запад (−X)
    add('home', 'gk', false, -(HALF_X - 1.1), 0);
    add('home', 'def', false, -(HALF_X * 0.45), 2.2);
    add('home', 'mid', false, -(HALF_X * 0.1), -3.0);
    add('home', 'fwd', true, HALF_X * 0.25, 1.2);
    add('away', 'gk', false, HALF_X - 1.1, 0);
    add('away', 'def', false, HALF_X * 0.45, -2.2);
    add('away', 'mid', false, HALF_X * 0.1, 3.0);
    add('away', 'fwd', false, -(HALF_X * 0.25), -1.2);
  }

  get humanPlayer(): SimPlayer {
    return this.players.find((player) => player.human) as SimPlayer;
  }

  get scoreLabel(): string {
    return `${this.homeScore} : ${this.awayScore}`;
  }

  get isFinished(): boolean {
    return this.state === 'finished';
  }

  attachBall(ball: MatchBall): void {
    this.ballRef = ball;
  }

  /** Состояние героя приходит из контроллера каждый кадр. */
  setHuman(state: HumanState | null): void {
    this.human = state;
    if (!state) return;
    const human = this.humanPlayer;
    human.x = state.x;
    human.z = state.z;
    human.yaw = state.yaw;
    human.speed01 = Math.min(1, state.speed / MATCH.runSpeed);
  }

  /** Начать матч: расстановка и свисток. */
  start(): void {
    if (this.state === 'play' || this.state === 'goal' || this.state === 'kickoff') return;
    this.homeScore = 0;
    this.awayScore = 0;
    this.elapsed = 0;
    this.stallTimer = 0;
    this.state = 'ready';
    this.kickoff('home');
    this.events.push({ type: 'whistle' });
    this.events.push({ type: 'kickoff', team: 'home' });
  }

  /** Мяч в сетке — счёт и пауза на празднование, затем центр. */
  registerGoal(byHome: boolean): void {
    if (this.state === 'finished' || this.state === 'idle') return;
    if (byHome) this.homeScore += 1;
    else this.awayScore += 1;
    this.events.push({ type: 'goal', byHome, team: byHome ? 'home' : 'away' });
    for (const player of this.players) {
      player.hasBall = false;
      player.action = player.team === (byHome ? 'home' : 'away') ? 'celebrate' : 'sad';
      player.actionTimer = 2.2;
    }
    if (this.homeScore >= this.goalsToWin || this.awayScore >= this.goalsToWin) {
      this.state = 'finished';
      this.events.push({ type: 'whistle' });
      this.events.push({ type: 'finished', byHome });
      return;
    }
    this.state = 'goal';
    this.goalPause = 2.2;
    this.kickoffTeam = byHome ? 'away' : 'home';
  }

  /** Расстановка по схеме: свои половины, мяч в центре. */
  private kickoff(team: TeamId): void {
    this.state = 'kickoff';
    this.kickoffTeam = team;
    for (const player of this.players) {
      if (player.human) continue;
      const sign = player.team === 'home' ? 1 : -1;
      player.x = CENTER_X + player.anchorX * sign * (player.role === 'gk' ? 1 : 1);
      player.z = CENTER_Z + player.anchorZ * sign;
      // Нападающий бьющей команды стоит у мяча
      if (player.role === 'fwd' && player.team === team) {
        player.x = CENTER_X + (player.team === 'home' ? -0.7 : 0.7);
        player.z = CENTER_Z;
      }
      player.vx = 0;
      player.vz = 0;
      player.hasBall = false;
      player.action = 'idle';
      player.actionTimer = 0;
      player.yaw = player.team === 'home' ? -Math.PI / 2 : Math.PI / 2;
      player.targetX = player.x;
      player.targetZ = player.z;
    }
    const human = this.humanPlayer;
    human.hasBall = false;
    if (this.human) {
      // Героя не телепортируем: он сам подходит к мячу, но схема ставит его в круг
      human.targetX = CENTER_X - 1.6;
      human.targetZ = CENTER_Z;
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    if (this.state === 'idle' || this.state === 'finished') {
      this.decayActions(dt);
      return;
    }
    this.elapsed += dt;

    if (this.state === 'goal') {
      this.goalPause -= dt;
      this.decayActions(dt);
      for (const player of this.players) {
        if (player.human) continue;
        this.damp(player, dt);
      }
      if (this.goalPause <= 0) {
        this.kickoff(this.kickoffTeam);
        this.events.push({ type: 'kickoff', team: this.kickoffTeam });
      }
      return;
    }

    if (this.state === 'kickoff') {
      // Миг тишины перед свистком: игроки занимают места
      this.decayActions(dt);
      this.state = 'play';
    }

    const ball = this.ballRef;
    if (!ball) return;

    this.decayActions(dt);
    this.tickShouts(dt);
    this.updatePossession(dt, ball);
    this.decide(dt, ball);
    for (const player of this.players) {
      if (player.human) continue;
      this.move(player, dt, ball);
    }
    this.separate();
    this.dribble(dt, ball);
    this.keepBallInPlay(dt, ball);
    this.watchStall(dt, ball);
  }

  /**
   * Страховка: если мяч не двигается и никто ничего не делает дольше 7 с,
   * судья останавливает игру и ставит мяч в центр. Без этого матч может
   * встать намертво (например, мяч застрял под бортиком).
   */
  private watchStall(dt: number, ball: MatchBall): void {
    this.stallTimer += dt;
    if (this.stallTimer < 7) return;
    this.stallTimer = 0;
    this.possession = null;
    this.possessionTime = 0;
    this.outTimer = 0;
    ball.place(CENTER_X, CENTER_Z);
    this.events.push({ type: 'whistle' });
  }

  /**
   * Развод игроков: свои держат дистанцию 1,25 м, чужие — 0,85 м.
   * Без этого при смене схемы двое оказываются в одной точке и «слипаются».
   */
  private separate(): void {
    for (let i = 0; i < this.players.length; i += 1) {
      for (let j = i + 1; j < this.players.length; j += 1) {
        const a = this.players[i];
        const b = this.players[j];
        const min = a.human || b.human ? 0.62 : a.team === b.team ? 1.25 : 0.85;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let distance = Math.hypot(dx, dz);
        if (distance >= min) continue;
        if (distance < 0.001) {
          // Слиплись ровно в точку — расталкиваем детерминированно по номеру
          dx = Math.cos(a.id * 2.4);
          dz = Math.sin(a.id * 2.4);
          distance = 1;
        }
        const push = (min - distance) * 0.5;
        const ux = dx / distance;
        const uz = dz / distance;
        if (!a.human) {
          a.x -= ux * push;
          a.z -= uz * push;
        }
        if (!b.human) {
          b.x += ux * push;
          b.z += uz * push;
        }
      }
    }
  }

  private decayActions(dt: number): void {
    for (const player of this.players) {
      player.kickCooldown = Math.max(0, player.kickCooldown - dt);
      if (player.actionTimer > 0) {
        player.actionTimer = Math.max(0, player.actionTimer - dt);
        if (player.actionTimer === 0 && (player.action === 'kick' || player.action === 'celebrate' || player.action === 'sad')) {
          player.action = 'run';
        }
      }
    }
  }

  private tickShouts(dt: number): void {
    this.shoutTimer -= dt;
    if (this.shoutTimer > 0) return;
    this.shoutTimer = 9 + this.random() * 8;
    const team: TeamId = this.random() < 0.5 ? 'home' : 'away';
    const candidates = this.players.filter((player) => player.team === team && !player.human);
    if (candidates.length === 0) return;
    const speaker = candidates[Math.floor(this.random() * candidates.length)];
    this.events.push({ type: 'shout', team, player: speaker.id });
  }

  /** Решения всех игроков: кто бежит к мячу, кто держит зону. */
  private decide(dt: number, ball: MatchBall): void {
    const pursuers = new Map<TeamId, SimPlayer>();
    for (const team of ['home', 'away'] as const) {
      let best: SimPlayer | null = null;
      let bestDistance = Infinity;
      for (const player of this.players) {
        if (player.team !== team || player.human) continue;
        // Вратарь выходит из ворот, только если мяч в своей штрафной
        if (player.role === 'gk' && !this.ballInOwnBox(player, ball)) continue;
        const distance = Math.hypot(player.x - ball.x, player.z - ball.z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = player;
        }
      }
      if (best) pursuers.set(team, best);
    }

    for (const player of this.players) {
      if (player.human) continue;
      player.decisionTimer -= dt;
      player.hasBall = this.possession?.id === player.id;
      const pursuer = pursuers.get(player.team);
      const isPursuer = pursuer?.id === player.id;

      if (player.decisionTimer > 0) continue;
      player.decisionTimer = player.reaction * (0.85 + this.random() * 0.4);

      const goalX = player.team === 'home' ? GOAL_EAST : GOAL_WEST;
      const ownGoalX = player.team === 'home' ? GOAL_WEST : GOAL_EAST;
      const teammateWithBall = this.players.some(
        (other) => other.id !== player.id && other.team === player.team && other.hasBall,
      );

      if (player.role === 'gk') {
        // Вратарь: на линии между мячом и центром ворот, но чуть впереди
        const lineZ = THREE_clamp(CENTER_Z + (ball.z - CENTER_Z) * 0.72, CENTER_Z - 2.6, CENTER_Z + 2.6);
        player.targetX = ownGoalX + (player.team === 'home' ? 0.55 : -0.55);
        player.targetZ = lineZ;
        // Мяч у вратаря: прикрываем створ и ждём, выбить — дело updatePossession
        continue;
      }

      if (player.hasBall) {
        // С мячом бежим к воротам, но с креном в свободную сторону
        const openZ = ball.z + (ball.z > CENTER_Z ? -2.4 : 2.4) * 0.5;
        player.targetX = goalX - (player.team === 'home' ? 9 : -9);
        player.targetZ = THREE_clamp(openZ, CENTER_Z - HALF_Z + 1, CENTER_Z + HALF_Z - 1);
        continue;
      }

      if (isPursuer) {
        // Прогноз мяча: бежим туда, где он будет через 0,25 с
        player.targetX = ball.x + ball.vx * 0.25;
        player.targetZ = ball.z + ball.vz * 0.25;
        continue;
      }

      // Поддержка атаки и опека: точка смещается по роли
      const attacking = player.team === 'home' ? ball.x < GOAL_EAST : ball.x > GOAL_WEST;
      if (player.role === 'fwd' && !teammateWithBall) {
        player.targetX = THREE_clamp(ball.x + (player.team === 'home' ? 5.5 : -5.5), CENTER_X - HALF_X + 2, CENTER_X + HALF_X - 2);
        player.targetZ = CENTER_Z + player.anchorZ * (player.team === 'home' ? 1 : -1);
      } else if (attacking) {
        // В атаке держим ширину и открываемся под пас
        player.targetX = THREE_clamp(ball.x - (player.team === 'home' ? 3.5 : -3.5), CENTER_X - HALF_X + 2, CENTER_X + HALF_X - 2);
        player.targetZ = CENTER_Z + player.anchorZ * 1.5 * (player.team === 'home' ? 1 : -1);
      } else {
        // В обороне — между мячом и своими воротами, ближе к опасной зоне
        player.targetX = THREE_clamp(ball.x * 0.55 + ownGoalX * 0.45, CENTER_X - HALF_X + 1.5, CENTER_X + HALF_X - 1.5);
        player.targetZ = THREE_clamp(CENTER_Z + (ball.z - CENTER_Z) * 0.6 + player.anchorZ * 0.6, CENTER_Z - HALF_Z + 1, CENTER_Z + HALF_Z - 1);
      }

      // Расталкивание своих: не стоим друг на друге
      for (const mate of this.players) {
        if (mate.id === player.id || mate.team !== player.team) continue;
        const dx = player.targetX - mate.targetX;
        const dz = player.targetZ - mate.targetZ;
        const distanceToMate = Math.hypot(dx, dz);
        if (distanceToMate > 0.001 && distanceToMate < 3.2) {
          const push = (3.2 - distanceToMate) * 0.35;
          player.targetX += (dx / distanceToMate) * push;
          player.targetZ += (dz / distanceToMate) * push;
        }
      }

      // Свой шум: игрок «дышит», а не идёт по линейке
      const wobble = Math.sin(this.elapsed * player.rhythm + player.id) * player.noiseAmp;
      player.targetZ += wobble;
      player.targetX += Math.cos(this.elapsed * player.rhythm * 0.7 + player.id) * player.noiseAmp * 0.5;

      player.targetX = THREE_clamp(player.targetX, CENTER_X - HALF_X + 0.6, CENTER_X + HALF_X - 0.6);
      player.targetZ = THREE_clamp(player.targetZ, CENTER_Z - HALF_Z + 0.6, CENTER_Z + HALF_Z - 0.6);
    }
  }

  private ballInOwnBox(player: SimPlayer, ball: MatchBall): boolean {
    const ownGoalX = player.team === 'home' ? GOAL_WEST : GOAL_EAST;
    const nearGoal = Math.abs(ball.x - ownGoalX) < 5.5;
    const nearCenter = Math.abs(ball.z - CENTER_Z) < 4.6;
    return nearGoal && nearCenter;
  }

  private nearestOpponent(player: SimPlayer, ball: MatchBall): number {
    let best = Infinity;
    for (const other of this.players) {
      if (other.team === player.team || other.human) continue;
      best = Math.min(best, Math.hypot(other.x - ball.x, other.z - ball.z));
    }
    // Герой тоже давит: если он рядом с мячом, это давление
    if (this.human) best = Math.min(best, Math.hypot(this.human.x - ball.x, this.human.z - ball.z));
    return best;
  }

  private findPassTarget(player: SimPlayer, ball: MatchBall): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bestScore = -Infinity;
    const forward = player.team === 'home' ? 1 : -1;
    for (const mate of this.players) {
      if (mate.id === player.id || mate.team !== player.team || mate.human) continue;
      const dx = mate.x - ball.x;
      const dz = mate.z - ball.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 3 || distance > 18) continue;
      const progress = (mate.x - ball.x) * forward;
      const space = this.nearestOpponent(mate, { x: mate.x, z: mate.z, vx: 0, vz: 0, speed: 0, kick: () => undefined, place: () => undefined });
      const score = progress * 0.6 + space * 0.8 - distance * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = mate;
      }
    }
    return best;
  }

  /** Удар по мячу от имени игрока. */
  private kickBall(player: SimPlayer, ball: MatchBall, dirX: number, dirZ: number, lift: number, speed: number): void {
    const length = Math.hypot(dirX, dirZ) || 1;
    const accuracy = 0.82 + player.stamina * 0.18;
    ball.kick((dirX / length) * speed * accuracy, (dirZ / length) * speed * accuracy, lift);
    this.stallTimer = 0;
    player.kickCooldown = 0.5;
    player.action = 'kick';
    player.actionTimer = 0.45;
    // Мяч ушёл: владение снимаем, иначе ведение тут же вернёт его назад
    player.hasBall = false;
    if (this.possession?.id === player.id) {
      this.possession = null;
      this.possessionTime = 0;
    }
  }

  private move(player: SimPlayer, dt: number, ball: MatchBall): void {
    const dx = player.targetX - player.x;
    const dz = player.targetZ - player.z;
    const distance = Math.hypot(dx, dz);
    const staminaFactor = 0.62 + player.stamina * 0.38;
    const maxSpeed =
      MATCH.runSpeed *
      player.speedScale *
      staminaFactor *
      (player.role === 'fwd' ? 1.06 : player.role === 'gk' ? 1.12 : 1);
    // Мёртвая зона: на месте не дёргаемся
    const desiredSpeed = distance < 0.35 ? 0 : Math.min(maxSpeed, distance * 2.6);
    const dirX = distance > 0.001 ? dx / distance : 0;
    const dirZ = distance > 0.001 ? dz / distance : 0;

    const targetVx = dirX * desiredSpeed;
    const targetVz = dirZ * desiredSpeed;
    // Ускорение ограничено: игрок разгоняется и тормозит, а не телепортируется
    const deltaVx = THREE_clamp(targetVx - player.vx, -ACCEL * dt, ACCEL * dt);
    const deltaVz = THREE_clamp(targetVz - player.vz, -ACCEL * dt, ACCEL * dt);
    player.vx += deltaVx;
    player.vz += deltaVz;

    // Расход сил: рывок тратит, шаг восстанавливает
    const speed = Math.hypot(player.vx, player.vz);
    const sprint = speed / MATCH.runSpeed;
    player.stamina = THREE_clamp(player.stamina + (sprint > 0.75 ? -0.05 : 0.04) * dt, 0.25, 1);
    player.speed01 = Math.min(1, speed / MATCH.runSpeed);

    player.x += player.vx * dt;
    player.z += player.vz * dt;

    // Поле — прямоугольник: за кромку не убегаем (кроме вратаря у линии)
    player.x = THREE_clamp(player.x, CENTER_X - HALF_X - 1.2, CENTER_X + HALF_X + 1.2);
    player.z = THREE_clamp(player.z, CENTER_Z - HALF_Z - 1.1, CENTER_Z + HALF_Z + 1.1);

    // Поворот корпуса — плавный, по направлению движения
    if (speed > 0.2) {
      const targetYaw = Math.atan2(-player.vx, -player.vz);
      let delta = targetYaw - player.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      player.yaw += THREE_clamp(delta, -TURN_RATE * dt, TURN_RATE * dt);
    }
    if (player.action === 'idle' || player.action === 'run') {
      player.action = speed > 0.6 ? 'run' : 'idle';
    }
    void ball;
  }

  private damp(player: SimPlayer, dt: number): void {
    player.vx *= Math.max(0, 1 - 6 * dt);
    player.vz *= Math.max(0, 1 - 6 * dt);
    player.speed01 = Math.min(1, Math.hypot(player.vx, player.vz) / MATCH.runSpeed);
  }

  /**
   * Владение мячом: подбор, отбор, приём героя.
   * Отдельно от `decide`, потому что владение — это состояние, а не решение:
   * пока игрок ведёт мяч, меняется только тот, у кого он в ногах.
   */
  private updatePossession(dt: number, ball: MatchBall): void {
    const human = this.human ? this.humanPlayer : null;

    // Герой у мяча — мяч его, но только если он свободен или уже у героя.
    // Отобрать у ИИ герой должен сам, иначе стоящий на месте герой
    // «магнитом» держал бы мяч и матч вставал.
    const humanDistance = human ? Math.hypot(human.x - ball.x, human.z - ball.z) : Infinity;
    if (human && humanDistance < 0.95 && (this.possession === null || this.possession.human)) {
      if (this.possession?.id !== human.id) {
        this.possession = human;
        this.possessionTime = 0;
        this.carryTimer = human.reaction;
        if (this.lastPossessionTeam && this.lastPossessionTeam !== human.team) {
          this.events.push({ type: 'tackle', team: human.team, player: human.id });
        }
        this.lastPossessionTeam = human.team;
      }
    }

    if (this.possession) {
      const carrier = this.possession;
      const distance = Math.hypot(carrier.x - ball.x, carrier.z - ball.z);
      // Мяч отскочил или улетел — владение кончилось
      if (distance > 1.9 || (carrier.human && distance > 1.3)) {
        this.possession = null;
        this.possessionTime = 0;
      } else {
        this.possessionTime += dt;
      }
    }

    if (!this.possession) {
      let best: SimPlayer | null = null;
      let bestDistance = Infinity;
      for (const player of this.players) {
        if (player.kickCooldown > 0) continue;
        // Вратарь ловит мяч в своей штрафной, а не по всему полю
        if (player.role === 'gk' && !this.ballInOwnBox(player, ball)) continue;
        const reach = player.role === 'gk' ? CONTROL + 0.75 : CONTROL + 0.3;
        const distance = Math.hypot(player.x - ball.x, player.z - ball.z);
        if (distance < reach && distance < bestDistance) {
          bestDistance = distance;
          best = player;
        }
      }
      if (best) {
        if (this.lastPossessionTeam && this.lastPossessionTeam !== best.team) {
          this.events.push({ type: 'tackle', team: best.team, player: best.id });
        }
        this.possession = best;
        this.possessionTime = 0;
        this.stallTimer = 0;
        this.carryTimer = best.reaction;
        this.lastPossessionTeam = best.team;
      }
    }

    const carrier = this.possession;
    if (!carrier) return;

    // Отбор: соперник в шаге от мяча может выбить его себе.
    // У героя отбирают реже — он не должен терять мяч от первого касания.
    const stealRate = carrier.human ? 0.9 : 0.6;
    // Только что принял мяч — мгновенно не отбирают: даём приём и первый шаг
    const grace = this.possessionTime < 0.7;
    for (const rival of this.players) {
      if (grace) break;
      if (rival.team === carrier.team) continue;
      // Герой отбирает у ИИ, только если сам вплотную к мячу
      if (rival.human && humanDistance > 0.8) continue;
      if (Math.hypot(rival.x - ball.x, rival.z - ball.z) > (carrier.human ? 1.05 : 0.56)) continue;
      // Герой отбирает сам, когда подбегает вплотную к ведущему
      if (this.random() > stealRate * dt) continue;
      this.possession = rival;
      this.possessionTime = 0;
      this.stallTimer = 0;
      this.carryTimer = rival.reaction;
      this.lastPossessionTeam = rival.team;
      this.events.push({ type: 'tackle', team: rival.team, player: rival.id });
      break;
    }

    if (carrier.human) return;

    // Решение с мячом принимается с задержкой реакции, а не каждый кадр
    this.carryTimer -= dt;
    if (this.carryTimer > 0) return;
    this.carryTimer = 0.22 + this.random() * 0.28;
    if (this.possession?.id === carrier.id) this.carryDecision(carrier, ball);
  }

  /** Что делать с мячом: бить, пасовать или продолжать вести. */
  private carryDecision(carrier: SimPlayer, ball: MatchBall): void {
    const goalX = carrier.team === 'home' ? GOAL_EAST : GOAL_WEST;
    const forward = carrier.team === 'home' ? 1 : -1;

    if (carrier.role === 'gk') return; // вратарь выбивает в dribble после паузы

    const toGoal = Math.abs(goalX - ball.x);
    const central = Math.abs(ball.z - CENTER_Z) < 7;
    const pressured = this.nearestOpponent(carrier, ball) < 2.2;

    if (toGoal < SHOOT_RANGE && central && this.random() < 0.38) {
      // Разброс: иногда бьют мимо или прямо во вратаря — как живые
      const spread = this.random() < 0.18 ? 0.5 : 0.24;
      const aim = THREE_clamp((CENTER_Z - ball.z) * 0.07, -0.18, 0.18) + (this.random() - 0.5) * spread;
      this.kickBall(carrier, ball, forward, aim, 0.5 + this.random() * 0.4, 16);
      this.events.push({ type: 'shot', team: carrier.team, player: carrier.id, power: 0.85 });
      return;
    }

    // Пас: под давлением почти всегда, без давления — иногда, чтобы не вести до угла
    const passChance = pressured ? 0.7 : this.possessionTime > 1.2 ? 0.22 : 0;
    if (passChance > 0 && this.random() < passChance) {
      const mate = this.findPassTarget(carrier, ball);
      if (mate) {
        const dx = mate.x - ball.x;
        const dz = mate.z - ball.z;
        const length = Math.hypot(dx, dz) || 1;
        // Пас чуть вперёд, на ход партнёру
        const lead = 0.35;
        this.kickBall(carrier, ball, dx / length + forward * lead, dz / length, 0.45, 12);
        this.events.push({ type: 'pass', team: carrier.team, player: carrier.id });
        return;
      }
      // Пас некому — уводим мяч в ширину
      const side = this.random() < 0.5 ? -1 : 1;
      this.kickBall(carrier, ball, forward * 0.7, side * 0.7, 0.2, 6.5);
    }
  }

  /**
   * Ведение: мяч жёстко стоит в полуметре перед ведущим.
   * Позиция, а не импульс — иначе физика и ИИ тянут мяч в разные стороны,
   * и он «дрожит» у ног.
   */
  private dribble(dt: number, ball: MatchBall): void {
    const carrier = this.possession;
    if (!carrier || carrier.human) return;

    if (carrier.role === 'gk') {
      // Вратарь подержал мяч и выбивает в поле
      if (this.possessionTime > 0.45) {
        this.kickBall(carrier, ball, carrier.team === 'home' ? 1 : -1, (this.random() - 0.5) * 0.55, 0.7, 13);
        this.events.push({ type: 'save', team: carrier.team, player: carrier.id });
      }
      void dt;
      return;
    }

    const forwardX = -Math.sin(carrier.yaw);
    const forwardZ = -Math.cos(carrier.yaw);
    ball.place(carrier.x + forwardX * 0.45, carrier.z + forwardZ * 0.45);
    void dt;
  }

  /** Аут: мяч вне поля дольше 0,7 с — возвращаем в игру, как вбрасывание. */
  private keepBallInPlay(dt: number, ball: MatchBall): void {
    const outX = Math.abs(ball.x - CENTER_X) > HALF_X + 1.2;
    const outZ = Math.abs(ball.z - CENTER_Z) > HALF_Z + 1.2;
    if (!outX && !outZ) {
      this.outTimer = 0;
      return;
    }
    this.outTimer += dt;
    if (this.outTimer < 0.7) return;
    this.outTimer = 0;
    this.possession = null;
    this.possessionTime = 0;
    const x = THREE_clamp(ball.x, CENTER_X - HALF_X + 1, CENTER_X + HALF_X - 1);
    const z = THREE_clamp(ball.z, CENTER_Z - HALF_Z + 1, CENTER_Z + HALF_Z - 1);
    ball.place(x, z);
    this.events.push({ type: 'whistle' });
  }
}

function THREE_clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
