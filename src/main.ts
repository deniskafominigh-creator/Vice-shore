import * as THREE from 'three';
import './ui/styles.css';
import { Game } from './game/Game';

/** Единственная точка входа игры (GOAL.md §4.2). */
function showFatal(message: string): void {
  const root = document.getElementById('ui-root');
  if (!root) return;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:grid',
    'place-content:center',
    'gap:14px',
    'padding:32px',
    'text-align:center',
    'background:#07131b',
    'color:#f2f6f8',
    'font-family:system-ui,sans-serif',
    'z-index:100',
  ].join(';');
  box.innerHTML = `
    <div style="font-size:20px;letter-spacing:.12em;text-transform:uppercase">Не удалось запустить игру</div>
    <div style="font-size:13px;line-height:1.7;color:#9fb0ba;max-width:520px">${message}</div>
    <button style="margin-top:8px;padding:10px 22px;border-radius:999px;border:0;background:#ffb02e;color:#201302;font-weight:600;cursor:pointer"
      onclick="location.reload()">Перезагрузить</button>
  `;
  root.append(box);
}

function bootstrap(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  const uiRoot = document.querySelector<HTMLElement>('#ui-root');

  if (!canvas || !uiRoot) {
    showFatal('В разметке не найден canvas или контейнер интерфейса.');
    return;
  }

  try {
    const game = new Game(canvas, uiRoot);
    void game.start().catch((error: unknown) => {
      console.error(error);
      showFatal(
        `Ошибка при запуске: ${error instanceof Error ? error.message : String(error)}. ` +
          'Проверьте, что браузер поддерживает WebGL2 и включено аппаратное ускорение.',
      );
    });
    // Доступ к игре из консоли — удобно для отладки и будущих задач.
    (window as unknown as { viceShore?: Game }).viceShore = game;
    // Только в dev: THREE нужен скриптам-скриншотерам, чтобы ставить свою камеру.
    if (import.meta.env.DEV) (window as unknown as { viceShoreThree?: typeof THREE }).viceShoreThree = THREE;
  } catch (error) {
    console.error(error);
    showFatal(
      'Похоже, WebGL недоступен: ' +
        (error instanceof Error ? error.message : String(error)) +
        '. Включите аппаратное ускорение в настройках браузера.',
    );
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
