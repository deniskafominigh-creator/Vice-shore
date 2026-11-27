import { GAME } from './Config';
import type { EventBus } from './EventBus';
import type { GameEventMap } from './Events';

/** Статус миссии. Используется задачами 7 и 8; задел уже в схеме сохранения. */
export type MissionStatus = 'inactive' | 'active' | 'completed';

export interface MissionState {
  status: MissionStatus;
  /** Прогресс 0..1 (например, доля покрашенной стены). */
  progress: number;
  /** Текущий шаг цепочки (индекс в определении миссии, задача 7). */
  step?: number;
  /** Флаги предметов: валик взят, краска взята. */
  flags?: Record<string, boolean>;
  /** Покрытие стены по ячейкам — покраска восстанавливается после перезагрузки. */
  values?: number[];
}

export interface SaveData {
  /** Версия схемы. Растёт при изменении структуры — тогда нужна миграция (§5.6). */
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Место появления игрока (позиция/поворот) — восстанавливается при «Продолжить». */
  player: { x: number; y: number; z: number; yaw: number } | null;
  missions: Record<string, MissionState>;
}

const SAVE_VERSION = 1;

function createEmptySave(now: number): SaveData {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    player: null,
    missions: {},
  };
}

/** Сохранение прогресса: одно автоматическое сохранение в localStorage (§11 п.7). */
export class SaveGame {
  private data: SaveData | null;

  constructor(private readonly bus: EventBus<GameEventMap>) {
    this.data = this.read();
  }

  get hasSave(): boolean {
    return this.data !== null;
  }

  get snapshot(): Readonly<SaveData> | null {
    return this.data;
  }

  /** Создаёт сохранение, если его ещё нет. Возвращает актуальные данные. */
  ensureExists(): Readonly<SaveData> {
    if (!this.data) {
      this.data = createEmptySave(Date.now());
      this.persist();
    }
    return this.data;
  }

  /** Изменение сохранения (точечно, без перезаписи всей структуры). */
  update(mutator: (save: SaveData) => void): void {
    const save = this.data ?? createEmptySave(Date.now());
    mutator(save);
    save.updatedAt = Date.now();
    this.data = save;
    this.persist();
  }

  clear(): void {
    this.data = null;
    try {
      localStorage.removeItem(GAME.saveKey);
    } catch (error) {
      console.warn('[SaveGame] не удалось удалить сохранение:', error);
    }
  }

  private read(): SaveData | null {
    try {
      const raw = localStorage.getItem(GAME.saveKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (typeof parsed !== 'object' || parsed === null) return null;
      // TODO-заглушек нет: неизвестная версия → честный сброс с записью в консоль.
      if (parsed.version !== SAVE_VERSION) {
        console.warn('[SaveGame] версия сохранения не совпадает, прогресс сброшен');
        return null;
      }
      return {
        version: SAVE_VERSION,
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        player: parsed.player ?? null,
        missions: parsed.missions ?? {},
      };
    } catch (error) {
      console.warn('[SaveGame] не удалось прочитать сохранение:', error);
      return null;
    }
  }

  private persist(): void {
    if (!this.data) return;
    try {
      localStorage.setItem(GAME.saveKey, JSON.stringify(this.data));
      this.bus.emit('save:updated', {
        createdAt: this.data.createdAt,
        updatedAt: this.data.updatedAt,
      });
    } catch (error) {
      console.warn('[SaveGame] не удалось сохранить прогресс:', error);
    }
  }
}
