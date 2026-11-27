import * as THREE from 'three';

/** Перекраска одежды привезённой модели (задача 19).
 *
 *  В GLB один материал и одна запечённая текстура 2048², поэтому «сменить цвет
 *  рубашки» через `material.color` нельзя — потемнело бы всё, включая лицо.
 *  Работаем по самой текстуре: сгруппировали её палитру в классы (снято с
 *  самой текстуры: тёмно-синяя ткань, кремовая ткань, красный акцент, кожа,
 *  волосы, чёрные детали) и каждому классу даём новый цвет. Кожа и волосы
 *  остаются собой — иначе получился бы не герой, а инопланетянин.
 *
 *  Скорость: не «ближайший цвет» на каждый пиксель, а LUT 32×32×32 (32 768
 *  байт), построенный один раз. Пиксель стоит одно чтение — 4 млн пикселей
 *  текстуры красятся за десятки миллисекунд на загрузке, в кадре работы нет. */

export interface OutfitClass {
  readonly id: string;
  /** Цвет в базовой текстуре модели (sRGB). */
  readonly source: string;
  /** Что это: подпись для документации и отладки. */
  readonly name: string;
}

/** Классы палитры текстуры, в порядке источников. Порядок = порядок палитры. */
export const OUTFIT_CLASSES: readonly OutfitClass[] = [
  { id: 'ink', source: '#0a0a0a', name: 'чёрные детали и обувь' },
  { id: 'navy', source: '#273957', name: 'тёмно-синяя ткань (штаны)' },
  { id: 'navyLit', source: '#344868', name: 'синяя ткань, свет' },
  { id: 'navyDeep', source: '#23324c', name: 'синяя ткань, тень' },
  { id: 'cream', source: '#e5e3db', name: 'кремовая ткань (футболка)' },
  { id: 'creamShade', source: '#d5d4cc', name: 'кремовая ткань, тень' },
  { id: 'creamLight', source: '#e9e9e3', name: 'кремовая ткань, свет' },
  { id: 'red', source: '#a8363b', name: 'красный акцент' },
  { id: 'skin', source: '#c4845d', name: 'кожа' },
  { id: 'skinShade', source: '#b77b57', name: 'кожа, тень' },
  { id: 'hair', source: '#27282d', name: 'волосы и тёмная ткань' },
] as const;

/** Новая одежда героя: тиловые штаны, коралловая футболка, тёплый акцент.
 *  Кожа и волосы на месте — меняется только одежда. */
export const HERO_OUTFIT: readonly string[] = [
  '#14161c', // ink
  '#12545c', // navy → тил
  '#1b6f74', // navyLit
  '#0c4148', // navyDeep
  '#e99377', // cream → коралл
  '#d67f66', // creamShade
  '#f2a488', // creamLight
  '#e8703a', // red → закатный оранжевый
  '#c4845d', // skin — без изменений
  '#b77b57', // skinShade — без изменений
  '#231f22', // hair — чуть теплее
];

/** Одежда кассира: светлая рубашка, графитовые брюки — форма стадиона. */
export const SELLER_OUTFIT: readonly string[] = [
  '#101317',
  '#2b3742', // брюки
  '#35434f',
  '#222c35',
  '#f1eee4', // рубашка
  '#e2dfd4',
  '#fbf9f2',
  '#c8462f',
  '#c4845d',
  '#b77b57',
  '#2a2528',
];

/** Команда «Морские волки» (задача 22): бирюзовая форма, песочные шорты. */
export const TEAM_WOLVES_OUTFIT: readonly string[] = [
  '#101318',
  '#e9dfc8', // шорты — песочные
  '#f4ead4',
  '#d9cfb8',
  '#1d8f92', // футболка — бирюза
  '#177a7d',
  '#27a3a4',
  '#e8703a',
  '#c4845d',
  '#b77b57',
  '#191b20',
];

/** Команда «Коралловые короли»: коралловая форма, тёмно-синие шорты. */
export const TEAM_KINGS_OUTFIT: readonly string[] = [
  '#11151c',
  '#22314a',
  '#2c3d59',
  '#1a2739',
  '#ef8b6a', // футболка — коралл
  '#d97b5d',
  '#fba184',
  '#f3d9a4',
  '#8d5a3c', // кожа темнее — команда гостей
  '#7d4f34',
  '#241f1d',
];

/** Уличные жители (задача 22): четыре разных человека, а не клоны героя.
 *  Меняются одежда и кожа — модель одна, узнаваемость разная. */
export const STREET_OUTFITS: readonly (readonly string[])[] = [
  [
    '#12151a', '#3a4a5c', '#46586c', '#2e3b4a', '#f2d9a0', '#e3c98d', '#fae6b4', '#c9553f',
    '#e0b48c', '#cf9f78', '#3b2f28',
  ],
  [
    '#0f1216', '#5a4632', '#6b553e', '#4a3a29', '#e8eef2', '#d5dde3', '#f4f8fb', '#4b8f6a',
    '#7a4a2e', '#6a3f27', '#141210',
  ],
  [
    '#131318', '#7a3556', '#8d3f63', '#662c47', '#f0e2d2', '#dfcdb9', '#fdf3e5', '#3f7fb0',
    '#5e3423', '#4f2b1d', '#1a1512',
  ],
  [
    '#101216', '#2e5d4f', '#3a7060', '#244a3f', '#f6e7c9', '#e6d5b4', '#fff2d9', '#d98a2b',
    '#edd3b6', '#dcbf9e', '#584a3a',
  ],
];

const LUT_BITS = 5;
const LUT_SIZE = 1 << (LUT_BITS * 3);

const parseHex = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/** LUT: квантованный sRGB → индекс класса. Строится один раз на все материалы. */
let classLut: Uint8Array | null = null;

function getClassLut(): Uint8Array {
  if (classLut) return classLut;
  const lut = new Uint8Array(LUT_SIZE);
  const sources = OUTFIT_CLASSES.map((item) => parseHex(item.source));
  const step = 255 / ((1 << LUT_BITS) - 1);
  for (let r = 0; r < 1 << LUT_BITS; r += 1) {
    for (let g = 0; g < 1 << LUT_BITS; g += 1) {
      for (let b = 0; b < 1 << LUT_BITS; b += 1) {
        const red = r * step;
        const green = g * step;
        const blue = b * step;
        let best = 0;
        let bestDistance = Infinity;
        for (let index = 0; index < sources.length; index += 1) {
          const [sr, sg, sb] = sources[index];
          // Взвешенная метрика: глаз чувствительнее к зелёному.
          const dr = red - sr;
          const dg = green - sg;
          const db = blue - sb;
          const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
        lut[(r << (LUT_BITS * 2)) | (g << LUT_BITS) | b] = best;
      }
    }
  }
  classLut = lut;
  return lut;
}

/** Какому классу принадлежит цвет (для проверок и отладки). Метрика та же,
 *  что в LUT: глаз чувствительнее к зелёному. */
export function nearestClassId(hex: string): string {
  const [r, g, b] = parseHex(hex);
  let best = OUTFIT_CLASSES[0].id;
  let bestDistance = Infinity;
  for (const item of OUTFIT_CLASSES) {
    const [sr, sg, sb] = parseHex(item.source);
    const dr = r - sr;
    const dg = g - sg;
    const db = b - sb;
    const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item.id;
    }
  }
  return best;
}

/** Текстура-копия с перекрашенными классами. null — красить нечего. */
export function recoloredTexture(
  source: THREE.Texture,
  palette: readonly string[],
  maxSize: number,
): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const image = source.image as (HTMLImageElement & ImageBitmap) | null;
  if (!image) return null;
  const width = (image as { width?: number }).width ?? 0;
  const height = (image as { height?: number }).height ?? 0;
  if (!width || !height) return null;

  const scale = Math.min(1, maxSize / Math.max(width, height));
  const targetWidth = Math.max(2, Math.round(width * scale));
  const targetHeight = Math.max(2, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const lut = getClassLut();
  const targets = palette.map((hex) => parseHex(hex));
  const step = 255 / ((1 << LUT_BITS) - 1);
  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  const data = imageData.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < 8) continue;
    const r = Math.min(31, Math.round(data[offset] / step));
    const g = Math.min(31, Math.round(data[offset + 1] / step));
    const b = Math.min(31, Math.round(data[offset + 2] / step));
    const [tr, tg, tb] = targets[lut[(r << 10) | (g << 5) | b]];
    data[offset] = tr;
    data[offset + 1] = tg;
    data[offset + 2] = tb;
  }
  context.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `${source.name || 'outfit'}-recolored`;
  texture.colorSpace = source.colorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.anisotropy = source.anisotropy;
  texture.minFilter = source.minFilter;
  texture.magFilter = source.magFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Перекрасить все материалы с картой цвета. Возвращает число перекрашенных. */
export function applyOutfit(
  materials: readonly THREE.Material[],
  palette: readonly string[],
  maxSize = 2048,
): number {
  if (palette.length !== OUTFIT_CLASSES.length) {
    console.warn(`[Outfit] палитра должна быть длиной ${OUTFIT_CLASSES.length}, пришло ${palette.length}`);
    return 0;
  }
  let painted = 0;
  const done = new Set<THREE.Texture>();
  for (const material of materials) {
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    const map = material.map;
    if (!map || done.has(map)) continue;
    done.add(map);
    const texture = recoloredTexture(map, palette, maxSize);
    if (!texture) continue;
    // Исходную текстуру не освобождаем: она общая с другим персонажем
    // (второй экземпляр красит её заново из оригинала).
    material.map = texture;
    material.needsUpdate = true;
    painted += 1;
  }
  return painted;
}
