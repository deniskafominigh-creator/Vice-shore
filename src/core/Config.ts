/** Проект: VICE SHORE. Общие константы и настройки качества.
 *  Значения не «магические»: всё геймплейное и визуальное живёт здесь (§5.7 GOAL.md). */

export const GAME = {
  /** Название игры меняется ТОЛЬКО здесь (см. GOAL.md §11, п.4). */
  title: 'VICE SHORE',
  subtitle: 'Вилла у моря',
  version: '0.15.0',
  /** Ключи localStorage — с версией, чтобы миграции были возможны. */
  settingsKey: 'vice-shore.settings.v1',
  saveKey: 'vice-shore.save.v1',
} as const;

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  readonly label: string;
  readonly pixelRatio: number;
  /** Разрешение карты теней: чем больше, тем мягче и чётче тени. */
  readonly shadowMapSize: number;
  /** Число сегментов плоскости моря (влияет на детализацию волн). */
  readonly seaSegments: number;
  /** Пост-обработка (задача 19): свечение ярких мест. */
  readonly bloom: boolean;
  /** Ambient Occlusion: затемнение в стыках и под предметами. */
  readonly ssao: boolean;
  /** Сглаживание SMAA поверх готового кадра (вместо «лесенки»). */
  readonly smaa: boolean;
  /** Во сколько раз AO считается мельче кадра (0,5 — вчетверо дешевле). */
  readonly ssaoScale: number;
  readonly bloomStrength: number;
  /** Глубина резкости (BokehPass): фокус на герое, дальний план размыт. */
  readonly bokeh: boolean;
  /** Плёночный эффект (FilmPass): зерно и виньетка кадра. */
  readonly film: boolean;
}

/** Порог «дорого/дёшево» подобран так, чтобы даже слабая видеокарта держала 60 FPS:
 *  низкое — прямой рендер с MSAA самого рендерера (никаких проходов),
 *  среднее — bloom + SMAA, высокое — плюс SSAO в половину разрешения. */
export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Низкое',
    pixelRatio: 1,
    shadowMapSize: 1024,
    seaSegments: 96,
    bloom: false,
    ssao: false,
    smaa: false,
    ssaoScale: 0.5,
    bloomStrength: 0,
    bokeh: false,
    film: false,
  },
  medium: {
    label: 'Среднее',
    pixelRatio: 1.25,
    shadowMapSize: 2048,
    seaSegments: 160,
    bloom: true,
    ssao: false,
    smaa: true,
    ssaoScale: 0.5,
    bloomStrength: 0.26,
    bokeh: true,
    film: true,
  },
  high: {
    label: 'Высокое',
    pixelRatio: 1.5,
    shadowMapSize: 4096,
    seaSegments: 256,
    bloom: true,
    ssao: true,
    smaa: true,
    ssaoScale: 0.5,
    bloomStrength: 0.34,
    bokeh: true,
    film: true,
  },
};

/** Дымка (задача 19): дальние дома и трибуны растворяются в цвете горизонта. */
export const FOG = {
  /** Экспоненциальная плотность: 13 % на 120 м, 80 % на 400 м. */
  density: 0.0032,
  /** Экспозиция ACES: чуть выше единицы — «кинематографично», но без пересвета. */
  exposure: 1.2,
} as const;

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high'];

/** Палитра мира: тропический полдень по референсу заказчика (VISION.md §1). */
export const PALETTE = {
  skyZenith: 0x1f6cb4,
  skyHorizon: 0xc3e2f2,
  cloudLight: 0xffffff,
  cloudShade: 0xa9bed0,
  sunColor: 0xfff3dc,
  seaReflect: 0x63a8c8,
  seaDeep: 0x0a3c56,
  seaShallow: 0x21a3b4,
  limestone: 0xe6e0d2,
  rock: 0x9a8d7a,
  metal: 0x9aa3a8,
  plant: 0x4d6b3c,
  terracotta: 0xb4623f,
  /** Белая обшивка дома и штакетник (референс). */
  whiteWood: 0xf7f3ea,
  darkWood: 0xa8825f,
  grass: 0x78913f,
  gravel: 0x9d968a,
  courtSurface: 0x9a9a92,
  bougainvillea: 0xc2456f,
  /** Агавы: светлая зелень с жёлтым отливом (референс). */
  agave: 0x7fa055,
  /** Мокрый камень у воды. */
  shoreStone: 0xefece5,
} as const;

/** Солнце: высоко (≈57°), чуть справа — яркий полдень, как на референсе. */
export const SUN = {
  direction: [0.55, 1.0, 0.4] as const,
  distance: 180,
} as const;

/** Остров: эллиптическое плато над водой (задача 4).
 *  Задача 13 увеличила карту: плато 156 × 116 м вместо 64 × 46 — на нём помещаются
 *  шесть домов, улица между ними и сады. Старый участок с виллой остался в центре
 *  без изменений, чтобы миссии 7–8 не сдвинулись ни на сантиметр. */
export const ISLAND = {
  /** Высота плато над уровнем моря, м. */
  plateauTopY: 3.2,
  radiusX: 78,
  radiusZ: 58,
  /** Насколько скала уходит под воду. */
  cliffBottomY: -7,
  walkMargin: 1.5,
} as const;

/** Островной посёлок (задача 13): пять домов вокруг старой виллы.
 *  Координаты — центры домов, фасады смотрят на улицу/море. */
export interface HouseSpec {
  readonly id: string;
  readonly name: string;
  /** Положение вдоль улицы. Высота и поворот считаются в `layoutHouses()`. */
  readonly x: number;
  /** Сторона улицы: дом стоит вдоль неё фасадом к дороге. */
  readonly side: 'north' | 'south';
  readonly width: number;
  readonly depth: number;
  readonly floors: 0 | 1;
  readonly wallColor: number;
  readonly roofColor: number;
  /** Терраса с бассейном перед домом. */
  readonly pool: boolean;
  /** Пергола с вьющимся растением на террасе. */
  readonly pergola: boolean;
}

/** Дом после расстановки: координаты и поворот уже посчитаны. */
export interface PlacedHouse extends HouseSpec {
  readonly z: number;
  /** Поворот вокруг Y: 0 — фасад на +Z (северный ряд), π — на −Z (южный). */
  readonly yaw: number;
}

export const TOWN = {
  /** Улица вдоль острова: от западной оконечности к восточной. */
  streetZ: 26,
  streetWidth: 5.4,
  /** Отступ фасада от кромки улицы, м. Вперёд выносятся терраса (3,6 м) и
   *  бассейн (ещё 6 м), поэтому девять: при семи чаша бассейна вставала на дорогу. */
  frontGap: 9,
  houses: [
    {
      id: 'house-se',
      name: 'Дом у юго-восточной бухты',
      x: 0,
      side: 'south',
      width: 14,
      depth: 10,
      floors: 1,
      wallColor: 0xf6f1e6,
      roofColor: 0xb4623f,
      pool: true,
      pergola: false,
    },
    {
      id: 'house-e',
      name: 'Стеклянный дом на востоке',
      x: 30,
      side: 'south',
      width: 12,
      depth: 11,
      floors: 1,
      wallColor: 0xeae6dd,
      roofColor: 0x8d9298,
      pool: true,
      pergola: true,
    },
    {
      id: 'house-n',
      name: 'Дом с перголой у северной аллеи',
      x: 30,
      side: 'north',
      width: 16,
      depth: 9,
      floors: 0,
      wallColor: 0xfbf7ee,
      roofColor: 0x6f7f86,
      pool: false,
      pergola: true,
    },
    {
      id: 'house-w',
      name: 'Западная вилла над обрывом',
      x: -44,
      side: 'north',
      width: 13,
      depth: 10,
      floors: 1,
      wallColor: 0xf2ece0,
      roofColor: 0x9c5a3c,
      pool: false,
      pergola: false,
    },
    {
      id: 'house-sw',
      name: 'Терракотовый дом в саду',
      x: -28,
      side: 'south',
      width: 15,
      depth: 11,
      floors: 1,
      wallColor: 0xf7f0e2,
      roofColor: 0xa8552f,
      pool: true,
      pergola: true,
    },
  ] satisfies readonly HouseSpec[],
} as const;

/**
 * Расстановка домов посёлка.
 *
 * Правило одно: дома стоят вдоль улицы двумя рядами, фасадом к дороге, с равным
 * отступом `frontGap`. Координаты в `TOWN.houses` больше не задаются руками —
 * раньше из-за этого западный дом стоял поперёк дороги (z = streetZ, поворот 61°),
 * стеклянный дом был повёрнут на 140°, а дом с перголой смотрел фасадом в поле.
 */
export function layoutHouses(): readonly PlacedHouse[] {
  const northEdge = TOWN.streetZ - TOWN.streetWidth / 2;
  const southEdge = TOWN.streetZ + TOWN.streetWidth / 2;
  return TOWN.houses.map((spec) => {
    const z = spec.side === 'north'
      ? northEdge - TOWN.frontGap - spec.depth / 2
      : southEdge + TOWN.frontGap + spec.depth / 2;
    // Фасад — это +Z дома: северный ряд смотрит на юг (к дороге), южный — на север.
    const yaw = spec.side === 'north' ? 0 : Math.PI;
    return { ...spec, z, yaw };
  });
}

/**
 * Стадион в конце улицы (задача 16).
 *
 * Чаша стоит восточнее старой виллы, вход — с востока, куда приходит аллея от
 * восточного конца улицы. Размеры привязаны к острову: внешняя чаша 54 × 32 м,
 * поле 42 × 20 м, пять рядов трибун по всем сторонам.
 */
export const STADIUM = {
  /** Чаша стоит в северо-восточном углу острова: за посёлком, наискосок от виллы.
   *  Габарит подобран по эллипсу острова 156 × 116 — при большем размере угол
   *  чаши свисал с обрыва (проверка: `npm run check:stadium`). */
  centerX: 40,
  centerZ: -14,
  /** Внешний габарит чаши, м = поле + 2 × (проход + трибуна). */
  width: 43,
  depth: 29,
  /** Поле, м: разметка рисуется текстурой, физика считает по этим числам. */
  pitchWidth: 32,
  pitchDepth: 18,
  /** Трибуны: ряды сидений, глубина ряда и подъём. */
  rows: 5,
  rowDepth: 0.9,
  rowRise: 0.42,
  /** Проход между полем и первым рядом. */
  concourse: 1,
  /** Ворота: ширина проёма, высота перекладины и глубина сетки. */
  goalWidth: 6,
  goalHeight: 2.2,
  /** Глубина сетки: впереди трибуны остаётся ровно метр прохода, сетка
   *  не должна протыкать первый ряд. */
  goalDepth: 0.9,
  /** Площадь перед входом (билеты, турникеты), м. */
  plazaWidth: 7,
  plazaDepth: 14,
  /** Подъездная аллея от конца улицы к площади: ось по X и ширина. */
  driveX: 64,
  driveWidth: 3.6,
  ballRadius: 0.11,
} as const;

/** Участок с виллой: забор, калитка, дом, терраса. */
export const PLOT = {
  fenceMinX: -15.5,
  fenceMaxX: 15.5,
  fenceMinZ: -15.5,
  fenceMaxZ: 12.5,
  gateWidth: 3.8,
  /** Пешеходная гравийная дорожка от калитки к дому. */
  pathWidth: 3.2,
  /** Проём в западной части забора — выход к баскетбольной площадке. */
  sideGateWidth: 3.6,
} as const;

/** Вилла: габариты и положение (фасад смотрит на море, +Z). */
export const VILLA = {
  centerX: 0,
  centerZ: -10.2,
  width: 15,
  depth: 9.6,
  height: 3.5,
  terraceDepth: 4.4,
  roofOverhang: 0.9,
} as const;

/** Баскетбольная площадка (основа для задачи 8). */
export const COURT = {
  centerX: -22.5,
  centerZ: 4,
  length: 13,
  width: 9,
} as const;

/** Высота пола, на которой стоят игрок и предметы (плато острова).
 *  Старые поля оставлены до перестройки острова в задаче 4. */
export const TERRACE = {
  deckTopY: ISLAND.plateauTopY,
  deckWidth: 22,
  deckDepth: 16,
  deckThickness: 1.4,
  railingHeight: 1.05,
  walkMargin: 0.75,
  eyeHeight: 1.68,
} as const;

/** Шрифт субтитров реплик (задача 12). «Кинематограф» — новый шрифт по умолчанию:
 *  прежний Inter казался заказчику слишком простым для голоса героя. */
export type SubtitleFont = 'film' | 'display' | 'mono' | 'plain';

export const SUBTITLE_FONTS: readonly SubtitleFont[] = ['film', 'display', 'mono', 'plain'];

export const SUBTITLE_FONT_LABELS: Record<SubtitleFont, string> = {
  film: 'Кинематограф',
  display: 'Дисплей',
  mono: 'Машинка',
  plain: 'Нейтральный',
};

/** Фон плашки субтитров: от «киноплёнки» до полностью прозрачного. */
export type SubtitleBackdrop = 'film' | 'glass' | 'solid' | 'none';

export const SUBTITLE_BACKDROPS: readonly SubtitleBackdrop[] = ['film', 'glass', 'solid', 'none'];

export const SUBTITLE_BACKDROP_LABELS: Record<SubtitleBackdrop, string> = {
  film: 'Плёнка',
  glass: 'Стекло',
  solid: 'Панель',
  none: 'Без фона',
};

/** Управление: единый источник правды для подсказок в интерфейсе. */
export interface ControlBinding {
  readonly keys: readonly string[];
  readonly label: string;
  readonly description: string;
}

export const CONTROLS: readonly ControlBinding[] = [
  { keys: ['W', 'A', 'S', 'D'], label: 'Движение', description: 'Ходьба по террасе' },
  { keys: ['Мышь'], label: 'Обзор', description: 'Поворот камеры' },
  { keys: ['Shift'], label: 'Быстрее', description: 'Ускоренный шаг' },
  { keys: ['Space'], label: 'Прыжок', description: 'Подпрыгнуть на месте или на бегу; рядом с мячом — удар с зарядкой' },
  { keys: ['E'], label: 'Действие', description: 'Взять предмет, начать красить, отойти' },
  { keys: ['W', 'S'], label: 'Валик', description: 'Вести валик по стене вверх-вниз' },
  { keys: ['A', 'D'], label: 'Полоса', description: 'Шаг к соседней полосе стены' },
  { keys: ['R'], label: 'Макнуть', description: 'Набрать краску из банки' },
  { keys: ['ЛКМ'], label: 'Мышь', description: 'Альтернативно вести валик' },
  { keys: ['Esc'], label: 'Пауза', description: 'Меню паузы' },
  { keys: ['↑', '↓'], label: 'Меню', description: 'Выбор пункта' },
  { keys: ['Enter'], label: 'Меню', description: 'Подтвердить' },
] as const;

/** Сенсорное управление (задача 11): тот же формат, что и у клавиш, — показывается
 *  в панели «Управление» на телефоне и планшете. */
export const TOUCH_CONTROLS: readonly ControlBinding[] = [
  { keys: ['Стик'], label: 'Движение', description: 'Слева внизу; до упора — бег' },
  { keys: ['ПРЫЖОК'], label: 'Прыжок', description: 'Круглая кнопка слева от «Держать»' },
  { keys: ['ПРЫЖОК'], label: 'Удар', description: 'Рядом с мячом: держать — сила, отпустить — удар' },
  { keys: ['Свайп'], label: 'Обзор', description: 'Провести пальцем по экрану' },
  { keys: ['Щипок'], label: 'Приблизить', description: 'Два пальца — камера ближе/дальше' },
  { keys: ['Ⓔ'], label: 'Действие', description: 'Взять предмет, войти в покраску, отойти' },
  { keys: ['Держать'], label: 'ЛКМ', description: 'Красить стену, замах и бросок мяча' },
  { keys: ['‹', '›'], label: 'Полоса', description: 'Соседняя полоса стены при покраске' },
  { keys: ['МАКНУТЬ'], label: 'Краска', description: 'Набрать краску из банки' },
  { keys: ['II'], label: 'Пауза', description: 'Меню паузы (правый верхний угол)' },
] as const;

/** Переходы интерфейса: всё плавное, ничего не «режется» (GOAL.md §6.3). */
export const TIMING = {
  fade: 0.42,
  screen: 0.28,
  hover: 0.2,
  toast: 2.6,
} as const;

export const DEBUG = {
  /** F4 — телеметрия кадра (FPS, draw calls, треугольники). */
  statsKey: 'F4',
  /** F3 — осмотр модели персонажа: скелет, вращение, тестовые позы (GOAL.md §7, задача 2). */
  inspectorKey: 'F3',
  /** F5 — каркас (wireframe) модели в режиме осмотра. */
  wireframeKey: 'F5',
  /** 1..4 — тестовые позы в режиме осмотра. */
  poseKeys: ['Digit1', 'Digit2', 'Digit3', 'Digit4'] as const,
} as const;

/** Задача 22: игровое время и матч.
 *
 *  Время идёт честно: если сказали «матч в 19:00», он начнётся в 19:00 по
 *  игровым часам, которые видно сверху экрана. Часы стартуют после второй
 *  вступительной миссии, в 17:40 — до матча полтора игровых часа.
 */
export const CLOCK = {
  /** Старт игрового дня после вступительных миссий (17:40). */
  startHour: 17,
  startMinute: 40,
  /** Сколько игровых минут проходит за реальную секунду. 1 мин/с → до матча 80 с. */
  minutesPerSecond: 1,
  /** Час матча и минута начала. */
  matchHour: 19,
  matchMinute: 0,
  /** Конец рабочего дня (катсцена): столько показывают часы на финале. */
  endHour: 21,
  endMinute: 30,
} as const;

export const CLOCK_STYLES = ['analog', 'digital', 'neon'] as const;
export type ClockStyle = (typeof CLOCK_STYLES)[number];

export const CLOCK_STYLE_LABELS: Record<ClockStyle, string> = {
  analog: 'Циферблат',
  digital: 'Табло',
  neon: 'Неон',
};

/** Матч (задача 22). */
export const MATCH = {
  /** Матч до трёх голов. */
  goalsToWin: 3,
  /** Игроков в команде (вратарь + три полевых). */
  teamSize: 4,
  /** Половина поля, где начинается матч, м. */
  pitchHalfX: 15,
  pitchHalfZ: 8.5,
  /** С какой скоростью игроки бегают, м/с. */
  runSpeed: 5.4,
  /** Разгон и торможение, м/с². */
  acceleration: 9,
} as const;
