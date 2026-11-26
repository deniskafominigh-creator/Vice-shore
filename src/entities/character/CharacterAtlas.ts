import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Атлас персонажа: одна текстура на кожу, футболку, джинсы, кроссовки и волосы.
 *  Регионы заданы в долях UV, поэтому геометрия «раскрашивается» через UV (GOAL.md §7, задача 2). */

export interface UvRegion {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export interface CharacterTextures {
  readonly map: THREE.Texture;
  readonly normalMap: THREE.Texture;
  readonly roughnessMap: THREE.Texture;
  readonly regions: Readonly<Record<RegionId, UvRegion>>;
}

export type RegionId = 'skin' | 'shirt' | 'denim' | 'shoeSole' | 'shoeUpper' | 'hair';

/** Раскладка атласа 1024×1024 (v считается сверху вниз, как в canvas). */
const LAYOUT: Record<RegionId, UvRegion> = {
  skin: { u0: 0.0, v0: 0.5, u1: 0.5, v1: 0.9 },
  shirt: { u0: 0.5, v0: 0.5, u1: 1.0, v1: 0.9 },
  denim: { u0: 0.0, v0: 0.12, u1: 0.5, v1: 0.5 },
  shoeSole: { u0: 0.5, v0: 0.12, u1: 0.72, v1: 0.3 },
  shoeUpper: { u0: 0.72, v0: 0.12, u1: 0.95, v1: 0.3 },
  hair: { u0: 0.0, v0: 0.92, u1: 0.5, v1: 1.0 },
};

const ATLAS_SIZE = 1024;

interface Ctx2D {
  readonly color: CanvasRenderingContext2D;
  readonly height: CanvasRenderingContext2D;
  readonly rough: CanvasRenderingContext2D;
}

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[CharacterAtlas] 2D-контекст недоступен');
  return { canvas, ctx };
}

function px(region: UvRegion, size: number): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(region.u0 * size),
    y: Math.round(region.v0 * size),
    w: Math.round((region.u1 - region.u0) * size),
    h: Math.round((region.v1 - region.v0) * size),
  };
}

/** Мелкий шум-оверлей: одна маленькая канва, растянутая на регион (быстро и без «мыла»). */
function noiseCanvas(seed: number, size = 128, contrast = 1): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size);
  const image = ctx.createImageData(size, size);
  let state = seed >>> 0;
  for (let i = 0; i < size * size; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const value = 128 + ((state >>> 24) - 128) * 0.5 * contrast;
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function fillRegion(ctx: CanvasRenderingContext2D, region: UvRegion, size: number, color: string): void {
  const r = px(region, size);
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

function drawNoise(
  ctx: CanvasRenderingContext2D,
  region: UvRegion,
  size: number,
  seed: number,
  alpha: number,
): void {
  const r = px(region, size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'overlay';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(noiseCanvas(seed, 128, 1), r.x, r.y, r.w, r.h);
  ctx.restore();
}

/** Тонкие линии (тканевый рисунок): диагональная «саржа» для джинсов и плетение для футболки. */
function drawPattern(
  ctx: CanvasRenderingContext2D,
  region: UvRegion,
  size: number,
  options: { step: number; width: number; angle: number; color: string; alpha: number },
): void {
  const r = px(region, size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.globalAlpha = options.alpha;
  ctx.strokeStyle = options.color;
  ctx.lineWidth = options.width;
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.rotate(options.angle);
  const span = Math.max(r.w, r.h) * 1.5;
  for (let offset = -span; offset <= span; offset += options.step) {
    ctx.beginPath();
    ctx.moveTo(offset, -span);
    ctx.lineTo(offset, span);
    ctx.stroke();
  }
  ctx.restore();
}

/** Карта нормалей из карты высот (значения читаются по яркости). */
function heightToNormal(
  heightCanvas: HTMLCanvasElement,
  size: number,
  strength: number,
): THREE.CanvasTexture {
  const source = heightCanvas.getContext('2d');
  if (!source) throw new Error('[CharacterAtlas] нет контекста карты высот');
  const data = source.getImageData(0, 0, size, size).data;

  const { canvas, ctx } = makeCanvas(size);
  const image = ctx.createImageData(size, size);
  const at = (x: number, y: number): number => {
    const cx = ((x % size) + size) % size;
    const cy = ((y % size) + size) % size;
    return (data[(cy * size + cx) * 4] as number) / 255;
  };

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
  texture.anisotropy = 4;
  return texture;
}

function buildContexts(): Ctx2D {
  const color = makeCanvas(ATLAS_SIZE);
  const height = makeCanvas(ATLAS_SIZE);
  const rough = makeCanvas(ATLAS_SIZE);
  return { color: color.ctx, height: height.ctx, rough: rough.ctx };
}

/** Собирает атлас: цвет, карта высот → нормали, карта шероховатости. */
export function createCharacterTextures(): CharacterTextures {
  const { color, height, rough } = buildContexts();

  // ——— кожа ———
  fillRegion(color, LAYOUT.skin, ATLAS_SIZE, '#e0ab8b');
  drawNoise(color, LAYOUT.skin, ATLAS_SIZE, 11, 0.16);
  fillRegion(height, LAYOUT.skin, ATLAS_SIZE, '#808080');
  drawNoise(height, LAYOUT.skin, ATLAS_SIZE, 21, 0.1);
  fillRegion(rough, LAYOUT.skin, ATLAS_SIZE, '#7d7d7d');

  // ——— футболка: терракота, плетение ———
  fillRegion(color, LAYOUT.shirt, ATLAS_SIZE, '#bd5a45');
  drawPattern(color, LAYOUT.shirt, ATLAS_SIZE, { step: 7, width: 1, angle: 0, color: '#8f4433', alpha: 0.35 });
  drawPattern(color, LAYOUT.shirt, ATLAS_SIZE, { step: 7, width: 1, angle: Math.PI / 2, color: '#cf6c56', alpha: 0.3 });
  drawNoise(color, LAYOUT.shirt, ATLAS_SIZE, 31, 0.1);
  fillRegion(height, LAYOUT.shirt, ATLAS_SIZE, '#808080');
  drawPattern(height, LAYOUT.shirt, ATLAS_SIZE, { step: 7, width: 2, angle: 0, color: '#b0b0b0', alpha: 0.5 });
  drawPattern(height, LAYOUT.shirt, ATLAS_SIZE, { step: 7, width: 2, angle: Math.PI / 2, color: '#505050', alpha: 0.5 });
  fillRegion(rough, LAYOUT.shirt, ATLAS_SIZE, '#d0d0d0');

  // ——— джинсы: саржа ———
  fillRegion(color, LAYOUT.denim, ATLAS_SIZE, '#3d5b7d');
  drawPattern(color, LAYOUT.denim, ATLAS_SIZE, { step: 6, width: 2, angle: Math.PI / 4, color: '#33506e', alpha: 0.45 });
  drawNoise(color, LAYOUT.denim, ATLAS_SIZE, 41, 0.14);
  fillRegion(height, LAYOUT.denim, ATLAS_SIZE, '#808080');
  drawPattern(height, LAYOUT.denim, ATLAS_SIZE, { step: 6, width: 2, angle: Math.PI / 4, color: '#b8b8b8', alpha: 0.55 });
  fillRegion(rough, LAYOUT.denim, ATLAS_SIZE, '#c8c8c8');

  // ——— кроссовки: подошва и верх ———
  fillRegion(color, LAYOUT.shoeSole, ATLAS_SIZE, '#e8e4da');
  drawNoise(color, LAYOUT.shoeSole, ATLAS_SIZE, 51, 0.12);
  fillRegion(height, LAYOUT.shoeSole, ATLAS_SIZE, '#808080');
  fillRegion(rough, LAYOUT.shoeSole, ATLAS_SIZE, '#a8a8a8');

  fillRegion(color, LAYOUT.shoeUpper, ATLAS_SIZE, '#2c3138');
  drawNoise(color, LAYOUT.shoeUpper, ATLAS_SIZE, 61, 0.18);
  fillRegion(height, LAYOUT.shoeUpper, ATLAS_SIZE, '#808080');
  drawNoise(height, LAYOUT.shoeUpper, ATLAS_SIZE, 71, 0.3);
  fillRegion(rough, LAYOUT.shoeUpper, ATLAS_SIZE, '#6e6e6e');

  // ——— волосы: тёмные пряди ———
  fillRegion(color, LAYOUT.hair, ATLAS_SIZE, '#2a211a');
  drawPattern(color, LAYOUT.hair, ATLAS_SIZE, { step: 3, width: 1, angle: 0.06, color: '#17100c', alpha: 0.5 });
  drawPattern(color, LAYOUT.hair, ATLAS_SIZE, { step: 5, width: 1, angle: 0.1, color: '#4a3a2c', alpha: 0.35 });
  fillRegion(height, LAYOUT.hair, ATLAS_SIZE, '#808080');
  drawPattern(height, LAYOUT.hair, ATLAS_SIZE, { step: 3, width: 1, angle: 0.06, color: '#c0c0c0', alpha: 0.6 });
  fillRegion(rough, LAYOUT.hair, ATLAS_SIZE, '#909090');

  const colorCanvas = color.canvas;
  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(rough.canvas);
  roughnessMap.anisotropy = 4;

  return {
    map,
    normalMap: heightToNormal(height.canvas, ATLAS_SIZE, 0.7),
    roughnessMap,
    regions: LAYOUT,
  };
}

/** Пересчёт UV точки в координаты региона (u,v — 0..1 внутри региона). */
export function mapUv(region: UvRegion, u: number, v: number): [number, number] {
  const uu = ((u % 1) + 1) % 1;
  const vv = ((v % 1) + 1) % 1;
  return [region.u0 + (region.u1 - region.u0) * uu, region.v0 + (region.v1 - region.v0) * vv];
}

export { mergeGeometries };
