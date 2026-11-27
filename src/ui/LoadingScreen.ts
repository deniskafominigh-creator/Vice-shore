import { el } from './dom';

/** Экран загрузки: реальный прогресс (шрифты, текстуры, сборка сцены), а не таймер. */
export class LoadingScreen {
  readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;

  constructor() {
    this.fill = el('div', { className: 'loading__fill' });
    this.label = el('div', { className: 'loading__label', text: 'Подготовка' });

    this.root = el(
      'section',
      { className: 'screen loading is-hidden', attrs: { 'aria-live': 'polite', 'aria-busy': 'true' } },
      el('div', { className: 'loading__logo' }, 'VICE ', el('span', { text: 'SHORE' })),
      el('div', { className: 'loading__bar' }, this.fill),
      this.label,
    );
  }

  setProgress(value: number, label: string): void {
    const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
    this.fill.style.width = `${percent}%`;
    this.label.textContent = `${label} · ${percent}%`;
  }

  show(): void {
    this.root.classList.remove('is-hidden');
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }
}
