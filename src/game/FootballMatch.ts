import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MATCH } from '../core/Config';
import type { EventBus } from '../core/EventBus';
import type { GameEventMap } from '../core/Events';
import type { Ui } from '../ui/Ui';
import { TEAM_KINGS_OUTFIT, TEAM_WOLVES_OUTFIT } from '../entities/character/Outfit';
import { PitchPlayer } from '../entities/npc/PitchPlayer';
import type { Football } from './Football';
import { MatchSim, type HumanState, type MatchEvent } from './match/MatchSim';

/**
 * Матч на стадионе (задача 22) — мост между чистой симуляцией и миром.
 *
 * Симуляция (`MatchSim`) знает только позиции и счёт. Здесь она получает тело:
 * у каждого ИИ-игрока свой меш на скелете героя в цветах команды, герой ведёт
 * мяч сам, а табло и звук приходят из событий матча.
 *
 * Матч не начинается «по кнопке»: его назначает расписание (ровно 19:00),
 * и до свистка игроки разминаются на своих половинах.
 */

export type MatchSound = 'whistle' | 'kick' | 'goal' | 'shout' | 'save' | 'end';

export interface FootballMatchOptions {
  readonly scene: THREE.Scene;
  readonly football: Football;
  readonly gltf: GLTF;
  readonly groundY: number;
  readonly ui: Ui;
  readonly bus: EventBus<GameEventMap>;
  readonly onSound: (sound: MatchSound, power: number) => void;
  readonly onFinished: (homeScore: number, awayScore: number) => void;
}

export class FootballMatch {
  readonly sim: MatchSim;
  private readonly views = new Map<number, PitchPlayer>();
  private running = false;
  private finished = false;
  private lastHome = 0;
  private lastAway = 0;
  private lastState: string = 'idle';
  private eventCursor = 0;
  private hudHideAt = 0;
  private clock = 0;

  constructor(private readonly options: FootballMatchOptions) {
    this.sim = new MatchSim();
    this.sim.attachBall(options.football);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get score(): { home: number; away: number } {
    return { home: this.sim.homeScore, away: this.sim.awayScore };
  }

  /** Расстановка перед матчем: игроки на поле, мяч в центре, табло 0:0. */
  prepare(): void {
    if (this.views.size > 0) return;
    const { scene, gltf, groundY } = this.options;
    for (const player of this.sim.players) {
      if (player.human) continue; // герой — не копия, он настоящий
      const palette = player.team === 'home' ? TEAM_WOLVES_OUTFIT : TEAM_KINGS_OUTFIT;
      const view = new PitchPlayer(gltf, palette, groundY);
      view.group.visible = false;
      scene.add(view.group);
      this.views.set(player.id, view);
    }
  }

  /** Свисток: игроки выходят на позиции, табло включается. */
  start(): void {
    if (this.running) return;
    this.prepare();
    this.options.football.setAutoCentre(false);
    this.options.football.reset(true);
    // Мяч уже мог побывать в сетке до матча (миссия «два гола»): берём его
    // текущий счёт за точку отсчёта, иначе первый гол матча уедет не той команде.
    this.lastHome = this.options.football.home;
    this.lastAway = this.options.football.away;
    this.sim.start();
    this.running = true;
    this.finished = false;
    this.eventCursor = this.sim.events.length;
    this.options.ui.showMatchHud();
    this.options.ui.setMatchScore(0, 0);
    this.options.bus.emit('match:started', { home: 0, away: 0 });
    for (const view of this.views.values()) view.group.visible = true;
    this.options.onSound('whistle', 1);
  }

  /** Мяч в сетке: считаем гол по данным самого мяча, а не по догадке. */
  handleFootballGoal(home: number, away: number): void {
    if (!this.running || this.finished) return;
    if (home === this.lastHome && away === this.lastAway) return;
    const byHome = home > this.lastHome;
    this.lastHome = home;
    this.lastAway = away;
    this.sim.registerGoal(byHome);
    this.options.ui.setMatchScore(this.sim.homeScore, this.sim.awayScore);
    this.options.ui.flashMatchGoal();
    this.options.onSound('goal', 1);
    this.options.bus.emit('match:goal', {
      home: this.sim.homeScore,
      away: this.sim.awayScore,
      byHome,
    });
    this.drainEvents();
    if (this.sim.isFinished) this.finish();
  }

  /** Удар героя — событие для звука и камеры. */
  heroKick(power: number): void {
    if (!this.running) return;
    this.options.onSound('kick', power);
  }

  update(dt: number, hero: HumanState): void {
    if (!this.running) return;
    this.clock += dt;
    this.sim.setHuman(hero);
    this.sim.update(dt);
    for (const player of this.sim.players) {
      const view = this.views.get(player.id);
      if (!view) continue;
      if (!view.group.visible) view.group.visible = true;
      view.sync(player, dt);
    }
    this.drainEvents();

    // После гола симуляция даёт свисток и центровку — мяч возвращаем ей под руку
    if (this.sim.state === 'kickoff' && this.lastState !== 'kickoff') {
      this.options.football.reset(true);
    }
    this.lastState = this.sim.state;

    if (this.hudHideAt > 0 && this.clock > this.hudHideAt) {
      this.hudHideAt = 0;
      this.options.ui.hideMatchHud();
    }
    if (this.sim.isFinished && !this.finished) this.finish();
  }

  /** Разбор событий симуляции: звук и крики, без HUD-логики. */
  private drainEvents(): void {
    while (this.eventCursor < this.sim.events.length) {
      const event = this.sim.events[this.eventCursor];
      this.eventCursor += 1;
      this.playEvent(event);
    }
  }

  private playEvent(event: MatchEvent): void {
    switch (event.type) {
      case 'kickoff':
        this.options.onSound('whistle', 0.6);
        break;
      case 'shot':
        this.options.onSound('kick', event.power ?? 0.7);
        break;
      case 'pass':
        this.options.onSound('kick', 0.35);
        break;
      case 'save':
        this.options.onSound('save', 0.8);
        break;
      case 'shout':
        this.options.onSound('shout', 0.7);
        break;
      case 'goal':
        // Счёт и табло обновляет handleFootballGoal — здесь только звук
        break;
      case 'finished':
        break;
      default:
        break;
    }
  }

  /** Финальный свисток: табло держим 6 с, потом убираем. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    this.lastHome = this.sim.homeScore;
    this.lastAway = this.sim.awayScore;
    this.hudHideAt = this.clock + 6;
    this.options.onSound('end', 1);
    this.options.ui.setMatchScore(this.sim.homeScore, this.sim.awayScore);
    this.options.bus.emit('match:finished', {
      home: this.sim.homeScore,
      away: this.sim.awayScore,
    });
    this.options.onFinished(this.sim.homeScore, this.sim.awayScore);
  }

  /** Игроки уходят с поля (после катсцены или перезапуска). */
  clear(): void {
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    // Мяч возвращается к обычной жизни: иначе после финального свистка он
    // так и лежал бы в сетке, а герой не смог бы его ударить.
    this.options.football.setAutoCentre(true);
    this.options.football.reset(true);
    this.options.ui.hideMatchHud();
    this.running = false;
    this.clock = 0;
    this.hudHideAt = 0;
    this.lastState = 'idle';
  }

  /** Сколько треугольников добавили игроки — для оффлайн-бюджета кадра. */
  get triangles(): number {
    let total = 0;
    for (const view of this.views.values()) total += view.triangles;
    return total;
  }

  /** Позиции для отладки: где стоят игроки и куда смотрит матч. */
  get positions(): ReadonlyArray<{ id: number; team: string; role: string; x: number; z: number }> {
    return this.sim.players.map((player) => ({
      id: player.id,
      team: player.team,
      role: player.role,
      x: player.x,
      z: player.z,
    }));
  }

  get goalsToWin(): number {
    return MATCH.goalsToWin;
  }
}
