// Приёмка задачи 12: настройки интерфейса — скрытие подсказок/HUD и вид субтитров.
//
// Проверяем то, что видит игрок: строки в настройках, реальный шрифт и фон плашки
// субтитров (через getComputedStyle), исчезновение подсказок, сброс к значениям
// по умолчанию. Кадры для глазной проверки: SHOT=1 node tools/verify-ui.mjs
//
// Запуск: node tools/verify-ui.mjs   (dev-сервер на 5173 или VS_URL)

import { chromium } from 'playwright';

const BASE = process.env.VS_URL ?? 'http://localhost:5173';
const SHOTS = process.env.SHOT === '1';

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});

const result = { settings: {}, subtitle: {}, hiding: {}, errors };
const fail = [];
const expect = (name, ok, detail) => {
  if (!ok) fail.push(`${name}${detail ? `: ${JSON.stringify(detail)}` : ''}`);
};

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
await page.waitForTimeout(600);

const openSettings = async () => {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((node) =>
      node.textContent?.trim().startsWith('Настройки'),
    );
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForSelector('.modal:not(.is-hidden) .panel__row', { timeout: 90000 });
  await page.waitForTimeout(200);
};

const closeSettings = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};

/** Нажать сегмент в строке с заданной подписью. */
const pickSegment = async (rowLabel, buttonText) =>
  page.evaluate(
    ({ rowLabel, buttonText }) => {
      const row = [...document.querySelectorAll('.panel__row')].find((node) =>
        node.querySelector('.panel__label')?.textContent?.startsWith(rowLabel),
      );
      const button = [...(row?.querySelectorAll('.segmented__button') ?? [])].find(
        (node) => node.textContent?.trim() === buttonText,
      );
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return Boolean(button);
    },
    { rowLabel, buttonText },
  );

/** Щёлкнуть переключатель в строке с заданной подписью. */
const flipSwitch = async (rowLabel) =>
  page.evaluate((rowLabel) => {
    const row = [...document.querySelectorAll('.panel__row')].find((node) =>
      node.querySelector('.panel__label')?.textContent?.startsWith(rowLabel),
    );
    const button = row?.querySelector('button.switch');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return Boolean(button);
  }, rowLabel);

const subtitleStyle = () =>
  page.evaluate(() => {
    const node = document.querySelector('.subtitle');
    if (!node) return null;
    const style = getComputedStyle(node);
    return {
      font: node.dataset.font,
      backdrop: node.dataset.backdrop,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage.slice(0, 60),
      borderLeft: `${style.borderLeftWidth} ${style.borderLeftColor}`,
      hidden: node.classList.contains('is-hidden'),
    };
  });

// ——— 1. Настройки: новые строки и значения по умолчанию ———
await openSettings();
result.settings.rows = await page.evaluate(() =>
  [...document.querySelectorAll('.panel__row .panel__label')].map((node) => node.firstChild?.textContent?.trim() ?? ''),
);
result.settings.groups = await page.evaluate(() =>
  [...document.querySelectorAll('.panel__group')].map((node) => node.textContent?.trim() ?? ''),
);
result.settings.active = await page.evaluate(() => {
  const pick = (label) => {
    const row = [...document.querySelectorAll('.panel__row')].find((node) =>
      node.querySelector('.panel__label')?.textContent?.startsWith(label),
    );
    return row?.querySelector('.segmented__button.is-active')?.textContent?.trim() ?? null;
  };
  return { font: pick('Шрифт субтитров'), backdrop: pick('Фон субтитров') };
});
result.settings.values = await page.evaluate(() => {
  const s = window.viceShore.settings.snapshot;
  return {
    subtitleFont: s.subtitleFont,
    subtitleBackdrop: s.subtitleBackdrop,
    showControlHints: s.showControlHints,
    showActionPrompts: s.showActionPrompts,
    showMissionHud: s.showMissionHud,
    subtitles: s.subtitles,
  };
});
expect('строки «Интерфейс» и «Субтитры» есть', result.settings.groups.join(',').includes('Интерфейс'));
expect('по умолчанию «Кинематограф»', result.settings.active.font === 'Кинематограф', result.settings.active);
expect('по умолчанию «Плёнка»', result.settings.active.backdrop === 'Плёнка', result.settings.active);
expect('по умолчанию всё включено', result.settings.values.showControlHints && result.settings.values.showMissionHud);

// ——— 2. Шрифты субтитров: реальный computed style ———
result.subtitle.default = await subtitleStyle();
const fonts = [
  ['Кинематограф', 'playfair'],
  ['Дисплей', 'oswald'],
  ['Машинка', 'mono'],
  ['Нейтральный', 'inter'],
];
result.subtitle.fonts = {};
for (const [label, marker] of fonts) {
  await pickSegment('Шрифт субтитров', label);
  await page.waitForTimeout(120);
  const style = await subtitleStyle();
  result.subtitle.fonts[label] = style;
  const family = (style?.fontFamily ?? '').toLowerCase();
  expect(`шрифт «${label}» применился`, family.includes(marker), family);
}
result.subtitle.playfairLoaded = await page.evaluate(async () => {
  // check() возвращает true только для уже загруженного шрифта, поэтому грузим явно.
  await document.fonts.load('500 23px "Playfair Display"', 'Валик');
  await document.fonts.ready;
  return document.fonts.check('500 23px "Playfair Display"', 'Валик');
});
expect('шрифт «Кинематограф» реально загружен', result.subtitle.playfairLoaded === true);

// ——— 3. Фоны субтитров ———
const backdrops = [
  ['Плёнка', 'film'],
  ['Стекло', 'glass'],
  ['Панель', 'solid'],
  ['Без фона', 'none'],
];
await pickSegment('Шрифт субтитров', 'Кинематограф');
result.subtitle.backdrops = {};
for (const [label] of backdrops) {
  await pickSegment('Фон субтитров', label);
  await page.waitForTimeout(120);
  const style = await subtitleStyle();
  result.subtitle.backdrops[label] = style;
  expect(`фон «${label}» применился`, style?.backdrop && style.backdrop.length > 0);
}
const filmStyle = result.subtitle.backdrops['Плёнка'];
expect('«Плёнка» — золотая полоса слева', filmStyle?.borderLeft.startsWith('3px'), filmStyle?.borderLeft);
expect('«Без фона» прозрачный', result.subtitle.backdrops['Без фона']?.background === 'rgba(0, 0, 0, 0)',
  result.subtitle.backdrops['Без фона']?.background);

// ——— 4. Сброс к значениям по умолчанию ———
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Сбросить');
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(250);
result.settings.afterReset = await page.evaluate(() => {
  const s = window.viceShore.settings.snapshot;
  return { font: s.subtitleFont, backdrop: s.subtitleBackdrop, style: document.querySelector('.subtitle')?.dataset.font };
});
expect('сброс вернул «Кинематограф»', result.settings.afterReset.font === 'film', result.settings.afterReset);
expect('сброс вернул «Плёнку»', result.settings.afterReset.backdrop === 'film', result.settings.afterReset);

// Выключаем показ подсказок и HUD — интерфейс должен стать чище.
for (const row of ['Подсказки управления', 'Подсказки действий', 'Задачи и прогресс']) {
  const ok = await flipSwitch(row);
  expect(`переключатель «${row}» найден`, ok);
}
await page.waitForTimeout(200);
result.hiding.switchedOff = await page.evaluate(() => {
  const s = window.viceShore.settings.snapshot;
  const root = document.getElementById('ui-root');
  return {
    values: { hints: s.showControlHints, prompts: s.showActionPrompts, hud: s.showMissionHud },
    classes: {
      hints: root.classList.contains('hide-control-hints'),
      prompts: root.classList.contains('hide-action-prompts'),
      hud: root.classList.contains('hide-mission-hud'),
    },
  };
});
expect('классы скрытия выставлены', result.hiding.switchedOff.classes.hints && result.hiding.switchedOff.classes.prompts && result.hiding.switchedOff.classes.hud);

await closeSettings();
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Играть');
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForFunction(
  () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
  { timeout: 150000 },
);
await page.waitForTimeout(900);

result.hiding.inGame = await page.evaluate(() => {
  const display = (selector) => {
    const node = document.querySelector(selector);
    return node ? getComputedStyle(node).display : null;
  };
  return {
    hint: display('.hint'),
    missionControls: display('.mission-controls'),
    prompt: display('.mission-prompt'),
    task: display('.mission-task'),
    room: display('.mission-room'),
  };
});
expect('подсказка скрыта', result.hiding.inGame.hint === 'none', result.hiding.inGame);
expect('подсказка действий скрыта', result.hiding.inGame.prompt === 'none', result.hiding.inGame);
expect('плашка задачи скрыта', result.hiding.inGame.task === 'none', result.hiding.inGame);
expect('полоса прогресса скрыта', result.hiding.inGame.room === 'none', result.hiding.inGame);

// ——— 5. Субтитры: плашка показывается и её видно ———
// Озвучка идёт по своим таймингам, поэтому проверяем сам слой субтитров:
// тот же вызов, что делает DialogueSystem, плюс кадр без ожидания перехода.
result.subtitle.visible = await page.evaluate(async () => {
  const ui = window.viceShore.ui;
  ui.showSubtitle('Валик в руки — и по стене, снизу вверх.');
  // Текст читаем сразу, в том же синхронном шаге: озвучка героя может выдать
  // очередную реплику в следующем кадре (сцена стала тяжелее, окно шире).
  const immediate = document.querySelector('.subtitle')?.textContent ?? null;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const node = document.querySelector('.subtitle');
  return {
    text: immediate,
    liveText: node?.textContent ?? null,
    visibleClass: node?.classList.contains('is-visible') ?? false,
    font: node?.dataset.font ?? null,
  };
});
expect('плашка субтитров показывает текст', result.subtitle.visible.text === 'Валик в руки — и по стене, снизу вверх.', result.subtitle.visible);

if (SHOTS) {
  // Кадр — только область субтитров: реплику ставим напрямую, иначе на SwiftShader
  // она успевает закончиться раньше, чем снимется кадр.
  const clip = { x: 240, y: 640, width: 1000, height: 200 };
  // Для кадра «замораживаем» плашку: без этого DialogueSystem прячет её по своему
  // таймеру, и на медленном SwiftShader снимок успевает поймать пустой экран.
  await page.evaluate(() => {
    const ui = window.viceShore.ui;
    ui.hideSubtitle = () => {};
    const node = document.querySelector('.subtitle');
    if (node) node.style.transition = 'none';
  });
  const showLine = async () => {
    await page.evaluate(() =>
      window.viceShore.ui.showSubtitle('Валик в руки — и по стене, снизу вверх: краска ляжет ровнее.'),
    );
    await page.waitForTimeout(150);
  };
  for (const [label] of fonts) {
    await page.evaluate((name) => {
      const fonts = { Кинематограф: 'film', Дисплей: 'display', Машинка: 'mono', Нейтральный: 'plain' };
      window.viceShore.settings.set('subtitleFont', fonts[name]);
    }, label);
    await showLine();
    await page.screenshot({ path: `/tmp/sub-font-${label}.png`, clip });
  }
  for (const [label] of backdrops) {
    await page.evaluate((name) => {
      const map = { Плёнка: 'film', Стекло: 'glass', Панель: 'solid', 'Без фона': 'none' };
      window.viceShore.settings.set('subtitleFont', 'film');
      window.viceShore.settings.set('subtitleBackdrop', map[name]);
    }, label);
    await showLine();
    await page.screenshot({ path: `/tmp/sub-bg-${label}.png`, clip });
  }
  await page.evaluate(() => {
    window.viceShore.settings.set('subtitleFont', 'film');
    window.viceShore.settings.set('subtitleBackdrop', 'film');
  });
}

// Субтитры можно выключить совсем — плашка исчезает, голос остаётся.
await page.evaluate(() => {
  const s = window.viceShore.settings;
  s.set('subtitles', false);
});
await page.waitForTimeout(250);
result.subtitle.offViaSettings = await page.evaluate(() =>
  document.querySelector('.subtitle')?.classList.contains('is-hidden'),
);
expect('выключение субтитров прячет плашку', result.subtitle.offViaSettings === true);

// Возвращаем подсказки и HUD обратно — панель настроек из игры.
await page.evaluate(() => {
  const s = window.viceShore.settings;
  s.set('subtitles', true);
  s.set('showControlHints', true);
  s.set('showActionPrompts', true);
  s.set('showMissionHud', true);
});
await page.waitForTimeout(300);
result.hiding.backOn = await page.evaluate(() => {
  const root = document.getElementById('ui-root');
  return {
    hint: getComputedStyle(document.querySelector('.hint')).display,
    classes: {
      hints: root.classList.contains('hide-control-hints'),
      prompts: root.classList.contains('hide-action-prompts'),
      hud: root.classList.contains('hide-mission-hud'),
    },
  };
});
expect('подсказка вернулась', result.hiding.backOn.hint !== 'none', result.hiding.backOn);
expect(
  'классы скрытия сняты',
  !result.hiding.backOn.classes.hints &&
    !result.hiding.backOn.classes.prompts &&
    !result.hiding.backOn.classes.hud,
  result.hiding.backOn.classes,
);

result.fail = fail;
result.errors = errors;
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (fail.length > 0 || errors.length > 0) process.exit(1);
