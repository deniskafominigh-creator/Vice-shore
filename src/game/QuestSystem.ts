import type { EventBus } from '../core/EventBus';
import type { GameEventMap } from '../core/Events';
import type { SaveGame } from '../core/SaveGame';
import { MISSION_01, MISSION_02, findQuest, type QuestDefinition } from '../data/quests';

/** Состояние одной миссии в рантайме. */
export interface QuestState {
  readonly id: string;
  readonly definition: QuestDefinition;
  status: 'inactive' | 'active' | 'completed';
  /** Индекс текущего шага (0..steps.length). */
  stepIndex: number;
  /** Прогресс 0..1 — для первой миссии это доля покрашенной стены. */
  progress: number;
  /** Флаги предметов: roller / paint — чтобы цепочка не проскакивала шаги. */
  readonly flags: Record<string, boolean>;
  /** Покрытие стены по ячейкам (120 чисел) — так покраска переживает перезагрузку. */
  values: number[];
}

export interface QuestView {
  readonly id: string;
  readonly task: string;
  readonly hint: string;
  readonly stepId: string | null;
  readonly status: QuestState['status'];
  readonly progress: number;
  readonly stepLabel: string;
}

/** Система миссий (задача 7): шаги, прогресс, сохранение, события.
 *  Живёт одна на игру; состояние каждой миссии пишется в `SaveGame.missions`. */
export class QuestSystem {
  private readonly states = new Map<string, QuestState>();
  private saveTimer = 0;
  private pendingSave = false;
  /** Какая миссия сейчас показывается в HUD. */
  private focus: string | null = null;

  constructor(
    private readonly save: SaveGame,
    private readonly bus: EventBus<GameEventMap>,
  ) {}

  /** Подтянуть состояние из сохранения (после загрузки или создания сейва). */
  load(): void {
    const snapshot = this.save.snapshot;
    for (const id of [MISSION_01.id, MISSION_02.id]) {
      const definition = findQuest(id);
      if (!definition) continue;
      const saved = snapshot?.missions?.[id];
      const state: QuestState = {
        id,
        definition,
        status: saved?.status === 'completed' ? 'completed' : saved?.status === 'active' ? 'active' : 'inactive',
        stepIndex: typeof saved?.step === 'number' ? saved.step : 0,
        progress: typeof saved?.progress === 'number' ? saved.progress : 0,
        flags: saved?.flags ? { ...saved.flags } : {},
        values: Array.isArray(saved?.values) ? [...saved.values] : [],
      };
      this.states.set(id, state);
    }
    // Активная миссия — та, что должна быть в HUD
    const active = [...this.states.values()].find((state) => state.status === 'active');
    this.focus = active?.id ?? null;
  }

  /** Начать миссию, если она ещё не начата (повторный вход ничего не ломает). */
  start(id: string): QuestState | null {
    const state = this.states.get(id);
    if (!state) return null;
    if (state.status !== 'inactive') return state;
    state.status = 'active';
    state.stepIndex = 0;
    this.focus = id;
    this.bus.emit('quest:started', { id, title: state.definition.title });
    this.persist(id);
    return state;
  }

  get(id: string): QuestState | null {
    return this.states.get(id) ?? null;
  }

  /** Миссия, которую показываем в HUD (активная, иначе завершённая последней). */
  get focused(): QuestState | null {
    if (this.focus) return this.states.get(this.focus) ?? null;
    return null;
  }

  focusOn(id: string | null): void {
    this.focus = id;
  }

  isActive(id: string): boolean {
    return this.states.get(id)?.status === 'active';
  }

  isCompleted(id: string): boolean {
    return this.states.get(id)?.status === 'completed';
  }

  /** Текущий шаг миссии (null, если миссия не активна). */
  currentStep(id: string): string | null {
    const state = this.states.get(id);
    if (!state || state.status !== 'active') return null;
    return state.definition.steps[state.stepIndex]?.id ?? null;
  }

  /** Активен ли конкретный шаг. */
  isStep(id: string, stepId: string): boolean {
    return this.currentStep(id) === stepId;
  }

  /** Перевести миссию на следующий шаг. */
  advance(id: string): void {
    const state = this.states.get(id);
    if (!state || state.status !== 'active') return;
    state.stepIndex += 1;
    if (state.stepIndex >= state.definition.steps.length) {
      this.complete(id);
      return;
    }
    this.persist(id);
    this.bus.emit('quest:step', { id, step: state.definition.steps[state.stepIndex]?.id ?? '' });
  }

  /** Дойти до конкретного шага (идемпотентно). */
  setStep(id: string, stepId: string): void {
    const state = this.states.get(id);
    if (!state || state.status !== 'active') return;
    const index = state.definition.steps.findIndex((step) => step.id === stepId);
    if (index < 0 || index <= state.stepIndex) return;
    state.stepIndex = index;
    this.persist(id);
    this.bus.emit('quest:step', { id, step: state.definition.steps[state.stepIndex]?.id ?? '' });
  }

  setFlag(id: string, flag: string, value = true): void {
    const state = this.states.get(id);
    if (!state) return;
    if (state.flags[flag] === value) return;
    state.flags[flag] = value;
    this.persist(id);
  }

  hasFlag(id: string, flag: string): boolean {
    return this.states.get(id)?.flags[flag] === true;
  }

  /** Прогресс меняется каждый кадр покраски — сохраняем редко, а не на каждый пиксель. */
  setProgress(id: string, value: number, values?: number[]): void {
    const state = this.states.get(id);
    if (!state) return;
    const next = Math.max(0, Math.min(1, value));
    if (values) state.values = values;
    if (Math.abs(next - state.progress) < 0.0001 && !values) return;
    state.progress = next;
    this.pendingSave = true;
  }

  complete(id: string): void {
    const state = this.states.get(id);
    if (!state || state.status === 'completed') return;
    state.status = 'completed';
    state.stepIndex = state.definition.steps.length;
    if (state.id === MISSION_01.id) state.progress = 1;
    this.bus.emit('quest:completed', { id, title: state.definition.title });
    this.persist(id);
    // Первая миссия открывает вторую — сразу, как обещано в GOAL §7.
    if (state.id === MISSION_01.id) this.start(MISSION_02.id);
  }

  /** Досрочное сохранение (пауза, выход в меню). */
  flush(): void {
    if (!this.pendingSave) return;
    this.pendingSave = false;
    for (const id of this.states.keys()) this.persist(id);
  }

  /** Раз в несколько секунд сбрасываем прогресс на диск. */
  update(dt: number): void {
    if (!this.pendingSave) return;
    this.saveTimer += dt;
    if (this.saveTimer < 2.5) return;
    this.saveTimer = 0;
    this.flush();
  }

  /** Данные для HUD. */
  view(id: string): QuestView | null {
    const state = this.states.get(id);
    if (!state) return null;
    const step = state.definition.steps[state.stepIndex];
    return {
      id: state.id,
      task: state.definition.task,
      hint: step?.hint ?? '',
      stepId: step?.id ?? null,
      status: state.status,
      progress: state.progress,
      stepLabel: `${Math.min(state.stepIndex + 1, state.definition.steps.length)}/${state.definition.steps.length}`,
    };
  }

  private persist(id: string): void {
    const state = this.states.get(id);
    if (!state) return;
    this.save.update((data) => {
      data.missions[id] = {
        status: state.status,
        progress: state.progress,
        step: state.stepIndex,
        flags: { ...state.flags },
        values: state.values,
      };
    });
  }
}
