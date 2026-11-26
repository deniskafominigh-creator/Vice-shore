import { el } from './dom';

/** HUD миссии (задача 7, по референсу `ref-painting.jpg`):
 *  плашка задачи сверху по центру, полоса «КОМНАТА» слева-снизу,
 *  подсказки управления справа-снизу, подсказка действия по центру. */
export class MissionHud {
  readonly root: HTMLElement;
  private readonly task: HTMLElement;
  private readonly taskTitle: HTMLElement;
  private readonly taskHint: HTMLElement;
  private readonly taskStep: HTMLElement;
  private readonly room: HTMLElement;
  private readonly roomLabel: HTMLElement;
  private readonly roomFill: HTMLElement;
  private readonly roomValue: HTMLElement;
  private readonly roomState: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly power: HTMLElement;
  private readonly powerFill: HTMLElement;
  private readonly powerMark: HTMLElement;

  constructor() {
    this.taskTitle = el('div', { className: 'mission-task__title' });
    this.taskHint = el('div', { className: 'mission-task__hint' });
    this.taskStep = el('div', { className: 'mission-task__step' });
    this.task = el(
      'div',
      { className: 'mission-task' },
      el('div', { className: 'mission-task__badge', text: 'ЗАДАЧА' }),
      el('div', { className: 'mission-task__body' }, this.taskTitle, this.taskHint, this.taskStep),
    );

    this.roomLabel = el('span', { className: 'mission-room__label', text: 'КОМНАТА' });
    this.roomValue = el('span', { className: 'mission-room__value', text: '0 %' });
    this.roomFill = el('span', { className: 'mission-room__fill' });
    this.roomState = el('div', { className: 'mission-room__state' });
    this.room = el(
      'div',
      { className: 'mission-room' },
      el('div', { className: 'mission-room__head' }, this.roomLabel, this.roomValue),
      el('div', { className: 'mission-room__track' }, this.roomFill),
      this.roomState,
    );

    this.controls = el('div', { className: 'mission-controls' });
    this.prompt = el('div', { className: 'mission-prompt' });

    // Индикатор силы броска (задача 8): появляется, пока держим ЛКМ с мячом
    this.powerFill = el('span', { className: 'mission-power__fill' });
    this.powerMark = el('span', { className: 'mission-power__mark' });
    this.power = el(
      'div',
      { className: 'mission-power' },
      el('span', { className: 'mission-power__label', text: 'СИЛА' }),
      el('div', { className: 'mission-power__track' }, this.powerMark, this.powerFill),
    );

    this.root = el('div', { className: 'mission-hud' }, this.task, this.room, this.controls, this.power, this.prompt);
    this.root.classList.add('is-hidden');
  }

  show(): void {
    this.root.classList.remove('is-hidden');
  }

  hide(): void {
    this.root.classList.add('is-hidden');
    this.setPrompt(null);
    this.setPower(null);
  }

  /** Плашка задачи сверху. */
  setTask(title: string | null, hint = '', step = ''): void {
    if (!title) {
      this.task.classList.add('is-hidden');
      return;
    }
    this.task.classList.remove('is-hidden');
    this.task.classList.remove('is-flash');
    this.task.dataset.tone = 'info';
    this.taskTitle.textContent = title;
    this.taskHint.textContent = hint;
    this.taskHint.classList.toggle('is-hidden', hint.length === 0);
    this.taskStep.textContent = step;
    this.taskStep.classList.toggle('is-hidden', step.length === 0);
  }

  /** Полоса прогресса слева-снизу: у задачи 7 это «КОМНАТА %», у задачи 8 — «ГОЛЫ 1 / 2». */
  setRoom(percent: number | null, state = '', label = 'КОМНАТА', value?: string): void {
    if (percent === null) {
      this.room.classList.add('is-hidden');
      return;
    }
    this.room.classList.remove('is-hidden');
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    this.roomLabel.textContent = label;
    this.roomValue.textContent = value ?? `${clamped} %`;
    this.roomFill.style.width = `${clamped}%`;
    this.roomState.textContent = state;
    this.room.classList.toggle('is-complete', clamped >= 100);
  }

  /** Индикатор силы броска: null — спрятать; window — зелёная зона, где бросок доводится. */
  setPower(value: number | null, window: { from: number; to: number } | null = null): void {
    if (value === null) {
      this.power.classList.remove('is-visible');
      return;
    }
    const clamped = Math.max(0, Math.min(1, value));
    this.power.classList.add('is-visible');
    this.powerFill.style.width = `${Math.round(clamped * 100)}%`;
    const inWindow = window !== null && clamped >= window.from && clamped <= window.to;
    this.power.dataset.zone = inWindow ? 'good' : clamped > 0.9 ? 'hot' : 'low';
    if (window) {
      this.powerMark.style.display = 'block';
      this.powerMark.style.left = `${Math.round(window.from * 100)}%`;
      this.powerMark.style.width = `${Math.max(4, Math.round((window.to - window.from) * 100))}%`;
    } else {
      this.powerMark.style.display = 'none';
    }
  }

  setControls(text: string | null): void {
    if (!text) {
      this.controls.classList.add('is-hidden');
      this.controls.textContent = '';
      return;
    }
    this.controls.classList.remove('is-hidden');
    this.controls.textContent = text;
  }

  /** Подсказка действия по центру («E — взять валик»). */
  setPrompt(text: string | null): void {
    if (!text) {
      this.prompt.classList.remove('is-visible');
      return;
    }
    this.prompt.textContent = text;
    this.prompt.classList.add('is-visible');
  }

  /** Короткое сообщение поверх (завершение миссии). */
  flash(text: string, tone: 'info' | 'success' = 'info'): void {
    this.task.classList.remove('is-flash');
    this.taskTitle.textContent = text;
    this.taskHint.classList.add('is-hidden');
    this.taskStep.classList.add('is-hidden');
    this.task.classList.remove('is-hidden');
    void this.task.offsetHeight;
    this.task.classList.add('is-flash');
    this.task.dataset.tone = tone;
  }
}
