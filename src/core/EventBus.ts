/** Типизированная шина событий: системы общаются сообщениями, а не прямыми вызовами
 *  (GOAL.md §5.3). Подписка возвращает функцию отписки — утечек нет. */

export type EventHandler<T> = (payload: T) => void;

export class EventBus<EventMap extends object> {
  private readonly handlers = new Map<keyof EventMap, Set<EventHandler<never>>>();

  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set<EventHandler<never>>();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<never>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Копия набора: обработчик может отписаться во время рассылки.
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<EventMap[K]>)(payload);
      } catch (error) {
        console.error(`[EventBus] обработчик события "${String(event)}" упал:`, error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
