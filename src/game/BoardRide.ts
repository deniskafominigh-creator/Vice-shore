import { BOARD, BoardModel, normaliseAngle } from '../entities/vehicle/boardModel';
import { Longboard } from '../entities/vehicle/Longboard';
import { TOWN } from '../core/Config';
import type { Game } from './Game';

/** Езда на лонгборде (сборка v22): посадка, физика, столкновения, звук, камера.
 *
 *  Зачем: заказчик выбрал «свободу в мире» и «как в GTA» — остров 156 × 116 м
 *  наконец проезжается, а не проходится. Доска стоит у калитки виллы, в трёх
 *  шагах от старта, чтобы её нельзя было не заметить.
 *
 *  Правила простые: E у доски — встать; стик/WASD вперёд — толчок, назад —
 *  тормозить ногой, влево-вправо — руль; E — сойти. На телефоне большая кнопка
 *  становится «ТОЛЧОК», кнопка Ⓔ — «СОЙТИ».
 */

/** Где доска ждёт героя (у калитки виллы, рядом со стартом). */
const SPAWN = { x: 2.8, z: 10.2 } as const;

export class BoardRide {
  readonly board: Longboard;
  private readonly model = new BoardModel();
  private riding = false;
  private nearPrompted = false;
  private spawnX: number = SPAWN.x;
  private spawnZ: number = SPAWN.z;
  private lastSpeed = 0;
  private rollClock = 0;

  constructor(private readonly game: Game) {
    this.board = new Longboard();
    const scene = game.world?.scene;
    if (scene) scene.add(this.board.group);
    this.placeAtStart();
  }

  get isRiding(): boolean {
    return this.riding;
  }

  /** Позиция доски — для проверок и сохранения. */
  get position(): { x: number; z: number } {
    return { x: this.model.x, z: this.model.z };
  }

  get speed(): number {
    return this.model.speed;
  }

  /** Крен в повороте: герой наклоняется вместе с доской. */
  get lean(): number {
    return this.riding ? this.model.lean : 0;
  }

  /** Кадр на ногах: подсказка рядом с доской и посадка по E. */
  update(dt: number): void {
    if (this.riding) return;
    const island = this.game.world?.island;
    if (!island) return;
    const position = this.game.player.position;
    const distance = Math.hypot(position.x - this.model.x, position.z - this.model.z);
    const near = distance < 2.3 && Math.abs(position.y - island.groundHeightAt(this.model.x, this.model.z)) < 1.6;
    if (near) {
      if (!this.nearPrompted) {
        this.nearPrompted = true;
        this.game.ui.toast(
          this.game.scheme === 'touch' ? 'Лонгборд · Ⓔ — встать' : 'Лонгборд · E — встать и катить',
          'info',
        );
      }
      if (this.game.input.wasPressed('KeyE') && this.game.machine.current === 'playing') this.mount();
      return;
    }
    this.nearPrompted = false;
    void dt;
  }

  /** Кадр в движении: физика доски вместо ходьбы героя. */
  drive(dt: number, forward: number, strafe: number, look: { x: number; y: number }): void {
    if (!this.riding) return;
    const island = this.game.world?.island;
    const character = this.game.character;
    if (!island || !character) return;

    if (this.game.input.wasPressed('KeyE')) {
      this.dismount();
      return;
    }

    const intent = {
      push: forward > 0.25 || this.game.input.isMouseDown(0),
      brake: forward < -0.25,
      steer: Math.max(-1, Math.min(1, strafe)),
    };
    const offRoad = this.isOffRoad(this.model.z);
    this.model.step(dt, intent, offRoad);

    // Столкновения: доска не проходит сквозь стену, а глохнет об неё
    const y = island.groundHeightAt(this.model.x, this.model.z);
    const resolved = island.collisions.resolve(this.model.x, this.model.z, BOARD.radius, y + 0.6);
    const limited = island.clampToIsland(resolved.x, resolved.z, BOARD.radius);
    const shift = Math.hypot(limited.x - this.model.x, limited.z - this.model.z);
    this.model.place(limited.x, limited.z);
    if (shift > 0.015) this.model.absorbImpact();

    // Вода: дальше кромки острова не пускаем (доска не плавает)
    if (island.groundHeightAt(this.model.x, this.model.z) <= 0.01) {
      this.model.place(limited.x, limited.z);
      this.model.absorbImpact(0.15);
    }

    // Герой стоит на деке: позиция ног = доска + высота деки
    const feetY = island.groundHeightAt(this.model.x, this.model.z) + Longboard.feetHeight;
    this.game.player.position.set(this.model.x, feetY, this.model.z);
    this.game.player.yaw = this.model.yaw;
    this.game.player.speed = this.model.speed;
    // Шаг не анимируем: на доске герой стоит, а не идёт
    this.game.player.speed01 = 0;
    this.game.player.phase += this.model.speed * dt * 2.4;

    this.board.setState(this.model.x, feetY - Longboard.feetHeight, this.model.z, this.model.yaw, this.model.lean);
    this.board.roll(this.model.speed * dt);
    character.group.position.copy(this.game.player.position);
    // Наклон всем телом в поворот — то, что читается как «живая» езда
    character.group.rotation.set(0, this.model.yaw, this.model.lean);
    character.setLocomotion(0, this.game.player.phase);

    // Камера сама встаёт за доску, пока игрок не крутит обзор
    const camera = this.game.thirdPersonCamera;
    if (Math.abs(look.x) < 0.35 && Math.abs(look.y) < 0.35) {
      const target = this.model.yaw;
      const delta = normaliseAngle(target - camera.yaw);
      camera.setYaw(normaliseAngle(camera.yaw + delta * Math.min(1, dt * 3.2)));
    }

    this.game.audio.setBoardRoll(this.model.speed01, offRoad, this.model.speed);
    if (intent.push && this.model.speed > this.lastSpeed + 0.2 && this.rollClock <= 0) {
      this.rollClock = BOARD.pushCooldown;
      this.game.audio.playBoardPush();
      this.game.bus.emit('board:push', { speed: this.model.speed });
    }
    this.rollClock = Math.max(0, this.rollClock - dt);
    this.lastSpeed = this.model.speed;
  }

  /** Встать на доску. */
  mount(): void {
    if (this.riding) return;
    const island = this.game.world?.island;
    if (!island) return;
    this.riding = true;
    this.nearPrompted = false;
    this.lastSpeed = 0;
    this.model.reset(this.model.x, this.model.z, this.game.player.yaw);
    this.board.setVisible(true);
    this.game.character?.setPainting(false);
    this.game.character?.setLocomotion(0, 0);
    this.game.audio.startBoardRoll();
    this.game.audio.setBoardRoll(0, false, 0);
    this.game.touch.setRideMode(true);
    this.game.ui.toast(
      this.game.scheme === 'touch'
        ? 'ТОЛЧОК — катиться · стик влево-вправо — руль · СОЙТИ — Ⓔ'
        : 'W или ЛКМ — толчок · A/D — руль · S — тормоз · E — сойти',
      'info',
    );
    this.game.bus.emit('board:mounted', { x: this.model.x, z: this.model.z });
  }

  /** Сойти: доска остаётся на месте, герой встаёт рядом. */
  dismount(): void {
    if (!this.riding) return;
    const island = this.game.world?.island;
    this.riding = false;
    this.game.audio.stopBoardRoll();
    this.game.touch.setRideMode(false);
    if (island) {
      // Сходим в сторону от доски, чтобы не оказаться внутри неё
      const side = { x: Math.cos(this.model.yaw), z: -Math.sin(this.model.yaw) };
      const spot = island.collisions.resolve(this.model.x + side.x * 0.7, this.model.z + side.z * 0.7, 0.34, island.floorY + 0.9);
      this.game.player.spawn(spot.x, spot.z, island, this.model.yaw);
      this.game.character?.group.position.copy(this.game.player.position);
      this.game.character?.group.rotation.set(0, this.game.player.yaw, 0);
    }
    this.board.setState(
      this.model.x,
      island?.groundHeightAt(this.model.x, this.model.z) ?? 0,
      this.model.z,
      this.model.yaw,
      0,
    );
    this.game.ui.toast('Сошёл с доски', 'info');
    this.game.bus.emit('board:dismounted', { x: this.model.x, z: this.model.z });
  }

  /** Прервать езду без расстановки героя: новый день, загрузка, выход в меню. */
  cancel(): void {
    if (!this.riding) return;
    this.riding = false;
    this.game.audio.stopBoardRoll();
    this.game.touch.setRideMode(false);
  }

  /** Поставить доску у калитки: если точка занята, ищем свободную рядом. */
  placeAtStart(): void {
    const island = this.game.world?.island;
    if (!island) return;
    for (let radius = 0; radius <= 8; radius += 0.5) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const x = SPAWN.x + Math.cos(angle) * radius;
        const z = SPAWN.z + Math.sin(angle) * radius;
        if (!island.isWalkable(x, z)) continue;
        this.spawnX = x;
        this.spawnZ = z;
        this.model.reset(x, z, -Math.PI / 2);
        this.board.setState(x, island.groundHeightAt(x, z), z, -Math.PI / 2, 0);
        return;
      }
    }
    // Ничего свободного рядом — ставим на гравийную дорожку у калитки
    this.spawnX = 0.7;
    this.spawnZ = 9.6;
    this.model.reset(this.spawnX, this.spawnZ, -Math.PI / 2);
    this.board.setState(this.spawnX, island.groundHeightAt(this.spawnX, this.spawnZ), this.spawnZ, -Math.PI / 2, 0);
  }

  /** Газон или дорога: по траве доска катится хуже (и звучит глуше). */
  private isOffRoad(z: number): boolean {
    const half = TOWN.streetWidth / 2;
    return z < TOWN.streetZ - half || z > TOWN.streetZ + half;
  }

  dispose(): void {
    this.game.audio.stopBoardRoll();
    this.board.dispose();
  }
}
