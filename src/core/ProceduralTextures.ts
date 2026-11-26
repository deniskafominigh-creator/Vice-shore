import * as THREE from 'three';
import { clamp01, createNoise2D, createRng, fbm, lerp } from './MathUtils';

/** Процедурные текстуры: генерируются в коде, поэтому проект не зависит от внешних
 *  файлов и полностью работает офлайн (§4.1 GOAL.md). Все карты бесшовные по обеим осям. */

export type TextureRecipe = 'limestone' | 'concrete' | 'brushed-metal';

export interface TextureBundle {
  readonly map: THREE.Texture;
  readonly normalMap?: THREE.Texture;
  readonly roughnessMap?: THREE.Texture;
}

const RECIPE_PARAMS: Record<TextureRecipe, { detail: number; octaves: number }> = {
  limestone: { detail: 3, octaves: 4 },
  concrete: { detail: 5, octaves: 4 },
  'brushed-metal': { detail: 3, octaves: 3 },
};

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[Textures] 2D-контекст недоступен');
  return { canvas, ctx };
}

/** Бесшовный фрактальный шум: смешиваем четыре сдвинутых образца с весами по краям. */
function tileableFbm(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  period: number,
  detail: number,
  octaves: number,
): number {
  const fx = x / period;
  const fy = y / period;
  const p = detail;
  const n00 = fbm(noise, p * x, p * y, octaves);
  const n10 = fbm(noise, p * (x - period), p * y, octaves);
  const n01 = fbm(noise, p * x, p * (y - period), octaves);
  const n11 = fbm(noise, p * (x - period), p * (y - period), octaves);
  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fy);
}

function textureFromCanvas(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Карта нормалей из карты высот (свёртка Собеля, с заворотом по краям — бесшовно). */
function heightToNormal(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const image = ctx.createImageData(size, size);
  const at = (x: number, y: number): number =>
    height[(((y % size) + size) % size) * size + (((x % size) + size) % size)] as number;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      const nx = dx * strength;
      const ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * size + x) * 4;
      image.data[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Генерация набора карт (цвет + нормали + шероховатость) по рецепту. */
export function generateTexture(recipe: TextureRecipe, size: number, seed: number): TextureBundle {
  const { detail, octaves } = RECIPE_PARAMS[recipe];
  const noise = createNoise2D(seed);
  const grain = createNoise2D(seed + 101);
  const rng = createRng(seed + 777);

  const { canvas, ctx } = makeCanvas(size);
  const image = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = new Uint8ClampedArray(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = tileableFbm(noise, x, y, size, detail, octaves);
      // Зерно низкочастотное: крупные «пятна», а не телевизионный шум.
      const micro = grain(x * 0.022, y * 0.022);
      const idx = y * size + x;

      // Швы плит (только для камня): тонкие тёмные линии по сетке.
      const tiles = 4;
      const cell = size / tiles;
      const dx = Math.min(x % cell, cell - (x % cell));
      const dy = Math.min(y % cell, cell - (y % cell));
      const seam = Math.min(1, Math.min(dx, dy) / 2.2); // 0 у шва → 1 в глубине плиты

      let r = 0;
      let g = 0;
      let b = 0;
      let h = n;
      let roughness = 0.8;

      switch (recipe) {
        case 'limestone': {
          // Тёплый камень: мягкие крупные пятна + едва заметное зерно.
          const warm = clamp01(n * 0.95 + micro * 0.05);
          r = lerp(203, 228, warm) - (1 - micro) * 4;
          g = lerp(193, 217, warm) - (1 - micro) * 5;
          b = lerp(173, 196, warm) - (1 - micro) * 6;
          // Шов: чуть темнее и «утоплен» — читается как расшивка между плитами
          const seamShade = 0.86 + seam * 0.14;
          r *= seamShade;
          g *= seamShade;
          b *= seamShade;
          h = (n * 0.95 + micro * 0.05) * (0.72 + seam * 0.28);
          roughness = lerp(0.84, 0.9, n);
          break;
        }
        case 'concrete': {
          const mottle = clamp01(n * 0.86 + micro * 0.14);
          const speck = rng() > 0.9988 ? 0.86 : 1; // редкие тёмные точки
          r = lerp(150, 177, mottle) * speck;
          g = lerp(146, 172, mottle) * speck;
          b = lerp(138, 162, mottle) * speck;
          h = n * 0.72 + micro * 0.28;
          roughness = lerp(0.86, 0.96, mottle);
          break;
        }
        case 'brushed-metal': {
          // Горизонтальные «штрихи»: шум, растянутый по X.
          const streak = grain(x * 0.08, y * 1.4);
          const tone = clamp01(streak * 0.7 + 0.3);
          r = lerp(150, 186, tone);
          g = lerp(156, 190, tone);
          b = lerp(160, 194, tone);
          h = streak * 0.35;
          roughness = lerp(0.28, 0.46, tone);
          break;
        }
      }

      const i = idx * 4;
      image.data[i] = Math.round(clamp01(r / 255) * 255);
      image.data[i + 1] = Math.round(clamp01(g / 255) * 255);
      image.data[i + 2] = Math.round(clamp01(b / 255) * 255);
      image.data[i + 3] = 255;

      height[idx] = h;
      rough[idx] = Math.round(clamp01(roughness) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);

  const roughCanvas = makeCanvas(size);
  const roughImage = roughCanvas.ctx.createImageData(size, size);
  for (let i = 0; i < rough.length; i += 1) {
    const value = rough[i] as number;
    roughImage.data[i * 4] = value;
    roughImage.data[i * 4 + 1] = value;
    roughImage.data[i * 4 + 2] = value;
    roughImage.data[i * 4 + 3] = 255;
  }
  roughCanvas.ctx.putImageData(roughImage, 0, 0);

  return {
    map: textureFromCanvas(canvas, true),
    normalMap: recipe === 'brushed-metal' ? undefined : heightToNormal(height, size, 0.55),
    roughnessMap: textureFromCanvas(roughCanvas.canvas, false),
  };
}
