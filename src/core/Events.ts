import type { GameStateId } from './GameStateMachine';
import type { MusicMood } from '../audio/Music';

/** Единый список событий игры (GOAL.md §5.3).
 *  Добавляя событие — добавь его сюда, а не строкой по месту. */
export interface GameEventMap {
  'state:changed': { from: GameStateId | null; to: GameStateId };
  'loading:progress': { value: number; label: string };
  'settings:changed': { key: string; value: unknown };
  'audio:unlocked': { ok: boolean };
  'ui:notify': { text: string; tone?: 'info' | 'success' | 'warning' };
  'save:updated': { createdAt: number; updatedAt: number };
  'frame:stats': { fps: number; drawCalls: number; triangles: number };
  /** Миссии: старт и завершение меняют музыкальное настроение (задача 3, 7, 8). */
  'quest:started': { id: string; title: string };
  'quest:completed': { id: string; title: string };
  /** Шаг миссии сменился (задача 9: триггеры реплик по событиям, а не по таймерам). */
  'quest:step': { id: string; step: string };
  /** Взяли предмет: валик, банку краски или мяч. */
  'item:pickup': { item: 'roller' | 'paint' | 'ball' };
  /** Первая миссия: вошли в режим покраски, валик подсох, прогресс, стена готова. */
  'paint:started': { id: string };
  'paint:dry': { id: string };
  'paint:progress': { id: string; progress: number };
  'paint:completed': { id: string };
  /** Вторая миссия: бросок, гол, промах. */
  'ball:throw': { id: string };
  'ball:scored': { goals: number; total: number };
  'ball:missed': { goals: number };
  /** Герой молчит слишком долго — повод для idle-реплики (задача 9). */
  'voice:idle': { seconds: number };
  /** Реплика героя: под неё музыка приглушается (задача 9). */
  'voice:started': { id: string };
  'voice:ended': { id: string };
  /** Текущее музыкальное настроение — для отладки и интерфейса. */
  'music:mood': { mood: MusicMood };
}
