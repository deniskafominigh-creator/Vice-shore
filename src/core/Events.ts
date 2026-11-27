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
  /** Начался мазок: одно нажатие — один проход снизу вверх. */
  'paint:stroke': { id: string; coat: number };
  'paint:progress': { id: string; progress: number };
  'paint:completed': { id: string };
  /** Лонгборд (сборка v22): толчок, посадка и сход. */
  'board:push': { speed: number };
  'board:mounted': { x: number; z: number };
  'board:dismounted': { x: number; z: number };
  /** Вторая миссия: бросок, гол, промах. */
  'ball:throw': { id: string };
  'ball:scored': { goals: number; total: number };
  'ball:missed': { goals: number };
  /** Стадион (задача 17): вошёл на аллею/площадь, купил билет, ударил по мячу, забил. */
  'stadium:entered': { x: number; z: number };
  'stadium:ticket': { price: number };
  'football:charge': { power: number };
  'football:kick': { power: number };
  'football:goal': { home: number; away: number };
  /** Герой молчит слишком долго — повод для idle-реплики (задача 9). */
  'voice:idle': { seconds: number };
  /** Реплика героя: под неё музыка приглушается (задача 9). */
  'voice:started': { id: string };
  'voice:ended': { id: string };
  /** Текущее музыкальное настроение — для отладки и интерфейса. */
  'music:mood': { mood: MusicMood };
  /** Задача 22: игровое время. Тикает раз в игровую минуту. */
  'clock:tick': { minutes: number; label: string };
  /** Матч: назначен (в какое время), начался, гол, свисток, конец. */
  'match:scheduled': { at: number; label: string };
  'match:ready': { minutes: number };
  'match:started': { home: number; away: number };
  'match:goal': { home: number; away: number; byHome: boolean; scorer?: 'hero' | 'npc' };
  'match:finished': { home: number; away: number };
  /** Уличный NPC поздоровался (для субтитров и статистики). */
  'npc:greeted': { id: string; text: string };
  /** Катсцена конца дня: номер кадра и его подпись. */
  'cutscene:shot': { index: number; caption: string };
}
