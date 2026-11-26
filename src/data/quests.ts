/** Данные миссий (задача 7, GOAL §7).
 *  Тексты — русские, идентификаторы — английские. Держим их в TS, а не в JSON:
 *  так шаги проверяются типами, а сборка «одним файлом» ничего не теряет. */

export interface QuestStepDefinition {
  readonly id: string;
  /** Подсказка в HUD, пока шаг активен. */
  readonly hint: string;
}

export interface QuestDefinition {
  readonly id: string;
  /** Название для плашки задачи сверху. */
  readonly task: string;
  /** Короткое название миссии (для уведомлений и лога). */
  readonly title: string;
  readonly steps: readonly QuestStepDefinition[];
}

/** Первая миссия: валик → краска → стена. */
export const MISSION_01: QuestDefinition = {
  id: 'mission_01',
  task: 'Покрась стену в комнате',
  title: 'Покраска стены',
  steps: [
    { id: 'take_roller', hint: 'Валик лежит на стремянке у стены — подойди и возьми (E)' },
    { id: 'take_paint', hint: 'Теперь банка краски на полу у стены' },
    { id: 'paint_wall', hint: 'Встань к стене и крась: W/S — вести валик, A/D — соседняя полоса, R — макнуть, E — отойти' },
  ],
};

/** Вторая миссия: появляется сразу после первой (задача 8). */
export const MISSION_02: QuestDefinition = {
  id: 'mission_02',
  task: 'Выйди во двор и забей два гола',
  title: 'Два гола',
  steps: [
    { id: 'take_ball', hint: 'Мяч лежит на площадке за западной калиткой — подойди и возьми (E)' },
    { id: 'goals', hint: 'Наведись на кольцо, зажми ЛКМ для замаха и отпусти — нужно два гола' },
  ],
};

export const QUESTS: readonly QuestDefinition[] = [MISSION_01, MISSION_02];

export function findQuest(id: string): QuestDefinition | null {
  return QUESTS.find((quest) => quest.id === id) ?? null;
}

/** Тексты интерфейса задачи 7 — в одном месте, чтобы не искать по коду. */
export const PAINT_TEXTS = {
  hudRoom: 'КОМНАТА',
  stateDry: 'валик сухой — R: макнуть',
  stateDryTouch: 'валик сухой — нажми МАКНУТЬ',
  stateLoaded: 'краска на валике',
  stateLow: 'краски мало',
  stateDone: 'стена покрашена',
  promptRoller: 'E — взять валик',
  promptRollerTouch: 'Нажми Ⓔ — взять валик',
  promptPaint: 'E — взять банку краски',
  promptPaintTouch: 'Нажми Ⓔ — взять банку краски',
  promptWall: 'E — красить стену',
  promptWallTouch: 'Нажми Ⓔ — красить стену',
  promptWallNoRoller: 'Нужен валик и краска',
  painting: 'W/S — вести валик · A/D — полоса · R — макнуть · E — отойти',
  paintingTouch: 'Стик вверх-вниз — вести валик · ‹ › — полоса · МАКНУТЬ · ОТОЙТИ',
  paintStart: 'Красим стену',
  dipped: 'Валик в краске',
  noPaint: 'Краска на валике кончилась — нажми R у банки',
  noPaintTouch: 'Краска кончилась — нажми МАКНУТЬ у банки',
  needBoth: 'Сначала валик и краска',
  wallDone: 'Стена покрашена!',
  missionDone: 'Миссия выполнена',
} as const;

/** Тексты второй миссии (задача 8) — тоже в одном месте. */
export const BALL_TEXTS = {
  goalsLabel: 'ГОЛЫ',
  task: 'Выйди во двор и забей два гола',
  promptBall: 'E — взять мяч',
  promptBallTouch: 'Нажми Ⓔ — взять мяч',
  promptLetGo: 'ЛКМ — замах и бросок',
  promptLetGoTouch: 'Держи кнопку «Держать» и отпусти — бросок',
  promptReturn: 'Мяч вернётся на точку через пару секунд',
  stateIdle: 'мяч на площадке',
  stateHeld: 'мяч в руках',
  stateCharging: 'замах — отпусти ЛКМ',
  stateChargingTouch: 'замах — отпусти кнопку',
  stateFlying: 'мяч в игре',
  stateScored: 'гол!',
  stateMiss: 'мимо — подбери мяч',
  stateReturning: 'мяч возвращается',
  controls: 'ЛКМ — замах и бросок · отпусти в кольцо · E — взять мяч',
  goal: 'Гол!',
  goalSecond: 'Второй гол — миссия выполнена',
  miss: 'Мимо',
  picked: 'Мяч в руках',
  thrown: 'Бросок',
  rim: 'Дужка!',
  missionDone: 'Миссия выполнена',
  ballBack: 'Мяч вернулся на точку',
} as const;
