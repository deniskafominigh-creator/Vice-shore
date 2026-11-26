import * as THREE from 'three';
import { PALETTE } from '../../core/Config';

/** Материалы острова: все текстуры рисуются кодом (без файлов и CDN, GOAL.md §6.1).
 *  Палитра и характер поверхностей — по референсу заказчика (`VISION.md §1`). */

type Ctx = CanvasRenderingContext2D;

interface Painted {
  readonly map: THREE.Texture;
  readonly normalMap: THREE.Texture;
  readonly roughnessMap: THREE.Texture;
}

const SIZE = 512;

function canvas(size = SIZE): { el: HTMLCanvasElement; ctx: Ctx } {
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('[IslandTextures] нет 2D-контекста');
  return { el, ctx };
}

/** Детерминированный ГПСЧ — текстуры одинаковы от запуска к запуску. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Бесшовный value-noise: выборка по сетке с периодом `period`. */
function valueNoise(seed: number, period: number): (x: number, y: number) => number {
  const random = rng(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i += 1) grid[i] = random();
  const at = (x: number, y: number): number => grid[(((y % period) + period) % period) * period + (((x % period) + period) % period)] as number;
  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  };
}

function fbm(seed: number, basePeriod: number, octaves: number): (x: number, y: number) => number {
  const layers = Array.from({ length: octaves }, (_, i) => valueNoise(seed + i * 97, basePeriod * 2 ** i));
  return (x: number, y: number): number => {
    let value = 0;
    let amplitude = 0.5;
    layers.forEach((noise, i) => {
      value += noise(x * 2 ** i, y * 2 ** i) * amplitude;
      amplitude *= 0.5;
      void i;
    });
    return value;
  };
}

function heightToNormal(source: HTMLCanvasElement, strength: number): THREE.Texture {
  const size = source.width;
  const ctx = source.getContext('2d');
  if (!ctx) throw new Error('[IslandTextures] нет контекста карты высот');
  const data = ctx.getImageData(0, 0, size, size).data;
  const target = canvas(size);
  const image = target.ctx.createImageData(size, size);
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
      const length = Math.hypot(nx, ny, 1) || 1;
      const i = (y * size + x) * 4;
      image.data[i] = Math.round((nx / length) * 127 + 127);
      image.data[i + 1] = Math.round((ny / length) * 127 + 127);
      image.data[i + 2] = Math.round((1 / length) * 127 + 127);
      image.data[i + 3] = 255;
    }
  }
  target.ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(target.el);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function finish(canvasEl: HTMLCanvasElement, srgb = true): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Универсальная «шумная» поверхность: цвет + высота в одном проходе. */
function noiseSurface(
  seed: number,
  period: number,
  octaves: number,
  paint: (value: number, x: number, y: number) => [number, number, number],
  strength = 1,
): Painted {
  const color = canvas();
  const height = canvas();
  const rough = canvas();
  const colorImage = color.ctx.createImageData(SIZE, SIZE);
  const heightImage = height.ctx.createImageData(SIZE, SIZE);
  const roughImage = rough.ctx.createImageData(SIZE, SIZE);
  const noise = fbm(seed, period, octaves);
  const micro = valueNoise(seed + 1000, 64);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const nx = (x / SIZE) * period;
      const ny = (y / SIZE) * period;
      const value = noise(nx, ny);
      const grain = micro(x * 0.4, y * 0.4);
      const [r, g, b] = paint(value, x, y);
      const i = (y * SIZE + x) * 4;
      const shade = 1 + (grain - 0.5) * 0.12;
      colorImage.data[i] = Math.min(255, r * shade);
      colorImage.data[i + 1] = Math.min(255, g * shade);
      colorImage.data[i + 2] = Math.min(255, b * shade);
      colorImage.data[i + 3] = 255;

      const heightValue = Math.round((value * 0.75 + grain * 0.25) * 255);
      heightImage.data[i] = heightValue;
      heightImage.data[i + 1] = heightValue;
      heightImage.data[i + 2] = heightValue;
      heightImage.data[i + 3] = 255;

      const roughValue = Math.round((170 + (1 - value) * 60) * 1);
      roughImage.data[i] = roughValue;
      roughImage.data[i + 1] = roughValue;
      roughImage.data[i + 2] = roughValue;
      roughImage.data[i + 3] = 255;
    }
  }

  color.ctx.putImageData(colorImage, 0, 0);
  height.ctx.putImageData(heightImage, 0, 0);
  rough.ctx.putImageData(roughImage, 0, 0);

  return {
    map: finish(color.el),
    normalMap: heightToNormal(height.el, strength),
    roughnessMap: finish(rough.el, false),
  };
}

/** Газон: сочная зелень с проплешинами. */
function grassTexture(): Painted {
  const base = new THREE.Color(PALETTE.grass);
  return noiseSurface(
    11,
    8,
    4,
    (value, x, y) => {
      const dry = Math.max(0, value - 0.58) * 1.8;
      const patch = Math.sin(x * 0.035) * Math.cos(y * 0.041) * 0.5 + 0.5;
      const shade = 0.72 + value * 0.4 + patch * 0.045;
      return [
        Math.round(base.r * 255 * shade * (1 + dry * 0.22)),
        Math.round(base.g * 255 * shade * (1 + dry * 0.1)),
        Math.round(base.b * 255 * shade * (0.92 - dry * 0.15)),
      ];
    },
    0.9,
  );
}

/** Гравий дорожки: серые камешки. */
function gravelTexture(): Painted {
  const base = new THREE.Color(PALETTE.gravel);
  return noiseSurface(
    23,
    24,
    3,
    (value, x, y) => {
      const pebble = Math.sin(x * 1.7) * Math.cos(y * 2.3) * 0.5 + 0.5;
      const mixed = value * 0.7 + pebble * 0.3;
      const shade = 0.55 + mixed * 0.72;
      return [Math.round(base.r * 255 * shade), Math.round(base.g * 255 * shade), Math.round(base.b * 255 * shade)];
    },
    1.5,
  );
}

/** Белая обшивка дома: горизонтальные доски с тенью в швах (референс). */
function sidingTexture(): Painted {
  const color = canvas();
  const height = canvas();
  const rough = canvas();
  const colorImage = color.ctx.createImageData(SIZE, SIZE);
  const heightImage = height.ctx.createImageData(SIZE, SIZE);
  const roughImage = rough.ctx.createImageData(SIZE, SIZE);
  const board = SIZE / 8; // 8 досок на тайл
  const streak = fbm(77, 6, 3);
  const base = new THREE.Color(PALETTE.whiteWood);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const inBoard = y % board;
      const seam = inBoard < 2 ? 0.87 : inBoard < 5 ? 0.95 : 1;
      // Потёртости и подтёки — как облупившаяся краска на референсе
      const weather = streak((x / SIZE) * 6, (y / SIZE) * 3);
      const wear = weather > 0.66 ? 0.9 : 1;
      const shade = seam * wear;
      const i = (y * SIZE + x) * 4;
      colorImage.data[i] = Math.round(base.r * 255 * shade);
      colorImage.data[i + 1] = Math.round(base.g * 255 * shade);
      colorImage.data[i + 2] = Math.round(base.b * 255 * shade * 0.99);
      colorImage.data[i + 3] = 255;

      const heightValue = seam > 0.9 ? 175 : 96;
      heightImage.data[i] = heightValue;
      heightImage.data[i + 1] = heightValue;
      heightImage.data[i + 2] = heightValue;
      heightImage.data[i + 3] = 255;

      const roughValue = weather > 0.66 ? 210 : 155;
      roughImage.data[i] = roughValue;
      roughImage.data[i + 1] = roughValue;
      roughImage.data[i + 2] = roughValue;
      roughImage.data[i + 3] = 255;
    }
  }

  color.ctx.putImageData(colorImage, 0, 0);
  height.ctx.putImageData(heightImage, 0, 0);
  rough.ctx.putImageData(roughImage, 0, 0);

  return { map: finish(color.el), normalMap: heightToNormal(height.el, 1.2), roughnessMap: finish(rough.el, false) };
}

/** Дерево: тёплые доски для настила террасы и перголы. */
function woodTexture(): Painted {
  const base = new THREE.Color(PALETTE.darkWood);
  return noiseSurface(
    41,
    10,
    4,
    (value, x, y) => {
      const grain = Math.sin(y * 0.9 + Math.sin(x * 0.12) * 2.4) * 0.5 + 0.5;
      const mixed = value * 0.45 + grain * 0.55;
      const shade = 0.72 + mixed * 0.55;
      return [Math.round(base.r * 255 * shade), Math.round(base.g * 255 * shade), Math.round(base.b * 255 * shade)];
    },
    1.1,
  );
}

/** Скала: серо-коричневый камень обрыва. */
function rockTexture(): Painted {
  const base = new THREE.Color(PALETTE.rock);
  return noiseSurface(
    67,
    7,
    5,
    (value) => {
      const shade = 0.55 + value * 0.85;
      const moss = Math.max(0, value - 0.72) * 0.5;
      return [
        Math.round(base.r * 255 * shade * (1 - moss * 0.4)),
        Math.round(base.g * 255 * shade * (1 + moss * 0.15)),
        Math.round(base.b * 255 * shade * (1 - moss * 0.5)),
      ];
    },
    1.8,
  );
}

/** Листва кустов: плотная зелень с бликами. */
function foliageTexture(): Painted {
  const base = new THREE.Color(0x3f6b2c);
  return noiseSurface(
    91,
    12,
    4,
    (value) => {
      const light = Math.pow(value, 1.6) * 1.4;
      return [
        Math.round(base.r * 255 * (0.7 + light)),
        Math.round(base.g * 255 * (0.8 + light)),
        Math.round(base.b * 255 * (0.6 + light * 0.6)),
      ];
    },
    1.4,
  );
}


/** Крашеная белая древесина отделки: наличники, штакетник, плинтусы. */
function paintedWoodTexture(): Painted {
  const base = new THREE.Color(0xf6f3ea);
  return noiseSurface(
    131,
    12,
    4,
    (value, x, y) => {
      const grain = Math.sin(x * 0.32 + Math.sin(y * 0.08) * 1.8) * 0.5 + 0.5;
      const shade = 0.9 + value * 0.12 - grain * 0.05;
      // Потёртости: редкие серые пятна, как облупившаяся краска
      const worn = value > 0.78 ? 0.88 : 1;
      return [Math.round(base.r * 255 * shade * worn), Math.round(base.g * 255 * shade * worn), Math.round(base.b * 255 * shade * worn * 0.99)];
    },
    0.5,
  );
}

/** Дубовый пол: доски вдоль оси X с тёмными швами и волокном. */
function oakFloorTexture(): Painted {
  const color = canvas();
  const height = canvas();
  const rough = canvas();
  const colorImage = color.ctx.createImageData(SIZE, SIZE);
  const heightImage = height.ctx.createImageData(SIZE, SIZE);
  const roughImage = rough.ctx.createImageData(SIZE, SIZE);
  const planks = 6;
  const plankHeight = SIZE / planks;
  const grain = fbm(211, 8, 3);
  const random = rng(311);
  const shades = Array.from({ length: planks }, () => 0.86 + random() * 0.2);
  const base = new THREE.Color(0xcaa87a);

  for (let y = 0; y < SIZE; y += 1) {
    const plank = Math.floor(y / plankHeight);
    const inPlank = y % plankHeight;
    const seam = inPlank < 2 ? 0.55 : inPlank < 4 ? 0.8 : 1;
    for (let x = 0; x < SIZE; x += 1) {
      const fibre = grain((x / SIZE) * 6, (y / SIZE) * 30);
      const mix = shades[plank] * seam * (0.9 + fibre * 0.18);
      const i = (y * SIZE + x) * 4;
      colorImage.data[i] = Math.round(base.r * 255 * mix);
      colorImage.data[i + 1] = Math.round(base.g * 255 * mix);
      colorImage.data[i + 2] = Math.round(base.b * 255 * mix);
      colorImage.data[i + 3] = 255;
      const h = seam > 0.9 ? 200 : 90;
      heightImage.data[i] = h;
      heightImage.data[i + 1] = h;
      heightImage.data[i + 2] = h;
      heightImage.data[i + 3] = 255;
      const r = 118 + Math.round(fibre * 30);
      roughImage.data[i] = r;
      roughImage.data[i + 1] = r;
      roughImage.data[i + 2] = r;
      roughImage.data[i + 3] = 255;
    }
  }

  color.ctx.putImageData(colorImage, 0, 0);
  height.ctx.putImageData(heightImage, 0, 0);
  rough.ctx.putImageData(roughImage, 0, 0);
  return { map: finish(color.el), normalMap: heightToNormal(height.el, 0.8), roughnessMap: finish(rough.el, false) };
}

/** Светлый камень столешниц. */
function stoneTexture(): Painted {
  const base = new THREE.Color(0xe7e3da);
  return noiseSurface(
    173,
    16,
    4,
    (value, x, y) => {
      const vein = Math.abs(Math.sin(x * 0.03 + Math.sin(y * 0.011) * 3.4));
      const shade = 0.93 + value * 0.08 - vein * 0.05;
      return [Math.round(base.r * 255 * shade), Math.round(base.g * 255 * shade), Math.round(base.b * 255 * shade)];
    },
    0.35,
  );
}

/** Штукатурка стен внутри дома. */
function plasterTexture(): Painted {
  const base = new THREE.Color(0xe6ddce);
  return noiseSurface(
    197,
    20,
    4,
    (value) => {
      const shade = 0.95 + value * 0.06;
      return [Math.round(base.r * 255 * shade), Math.round(base.g * 255 * shade), Math.round(base.b * 255 * shade)];
    },
    0.25,
  );
}

/** Ткань: диван, подушки, шторы. */
function fabricTexture(seed: number, tint: number): Painted {
  const base = new THREE.Color(tint);
  return noiseSurface(
    seed,
    40,
    3,
    (value, x, y) => {
      const weave = (Math.sin(x * 1.4) + Math.sin(y * 1.4)) * 0.08 + 1;
      const shade = (0.92 + value * 0.12) * weave;
      return [Math.round(base.r * 255 * shade), Math.round(base.g * 255 * shade), Math.round(base.b * 255 * shade)];
    },
    0.6,
  );
}

/** Разметка баскетбольной площадки: рисуется один раз на весь слот (не тайл). */
function courtTexture(): THREE.Texture {
  const width = 1024;
  const height = 700;
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('[IslandTextures] нет контекста площадки');
  const base = new THREE.Color(PALETTE.courtSurface);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, width, height);

  // Лёгкая зернистость бетона
  const random = rng(5);
  for (let i = 0; i < 9000; i += 1) {
    const shade = 0.85 + random() * 0.3;
    ctx.fillStyle = `rgba(${Math.round(base.r * 255 * shade)},${Math.round(base.g * 255 * shade)},${Math.round(base.b * 255 * shade)},0.35)`;
    ctx.fillRect(random() * width, random() * height, 2, 2);
  }

  const line = '#f4f1e8';
  ctx.strokeStyle = line;
  ctx.lineWidth = 8;
  const margin = 46;
  ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);
  // Центральная линия и круг
  ctx.beginPath();
  ctx.moveTo(width / 2, margin);
  ctx.lineTo(width / 2, height - margin);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 90, 0, Math.PI * 2);
  ctx.stroke();
  // Трёхочковая дуга слева (кольцо у левого края)
  ctx.beginPath();
  ctx.arc(margin + 60, height / 2, 210, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  // Штрафная зона
  ctx.strokeRect(margin, height / 2 - 150, 190, 300);

  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Перо пальмы: контур листа с прозрачностью — для alpha-tested карточек. */
function frondTexture(): THREE.Texture {
  const width = 256;
  const height = 256;
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('[IslandTextures] нет контекста листа');
  ctx.clearRect(0, 0, width, height);

  const random = rng(19);
  ctx.strokeStyle = '#2f5a24';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(6, height / 2);
  ctx.quadraticCurveTo(width * 0.55, height / 2 - 18, width - 4, height / 2 + 6);
  ctx.stroke();

  // Листочки вдоль центральной жилки
  for (let i = 0; i < 46; i += 1) {
    const t = i / 46;
    const x = 8 + t * (width - 20);
    const spine = height / 2 - 18 * Math.sin(t * Math.PI) + t * 6;
    const length = 62 * (1 - t * 0.55);
    for (const dir of [-1, 1]) {
      const shade = 0.65 + random() * 0.45;
      ctx.strokeStyle = `rgb(${Math.round(58 * shade + 20)},${Math.round(110 * shade + 20)},${Math.round(46 * shade)})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, spine);
      ctx.quadraticCurveTo(x + 10, spine + dir * length * 0.6, x + 22, spine + dir * length);
      ctx.stroke();
    }
  }

  // Светлая кромка — «солнце сквозь лист»
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(150,200,110,0.35)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(10, height / 2);
  ctx.quadraticCurveTo(width * 0.55, height / 2 - 20, width - 8, height / 2 + 4);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export interface IslandMaterials {
  readonly grass: THREE.MeshStandardMaterial;
  readonly gravel: THREE.MeshStandardMaterial;
  readonly siding: THREE.MeshStandardMaterial;
  readonly wood: THREE.MeshStandardMaterial;
  readonly rock: THREE.MeshStandardMaterial;
  readonly shoreStone: THREE.MeshStandardMaterial;
  readonly foliage: THREE.MeshStandardMaterial;
  readonly court: THREE.MeshStandardMaterial;
  readonly frond: THREE.MeshStandardMaterial;
  readonly white: THREE.MeshStandardMaterial;
  readonly darkRoof: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly terracotta: THREE.MeshStandardMaterial;
  readonly magenta: THREE.MeshStandardMaterial;
  readonly cushion: THREE.MeshStandardMaterial;
  readonly trim: THREE.MeshStandardMaterial;
  readonly plaster: THREE.MeshStandardMaterial;
  readonly oakFloor: THREE.MeshStandardMaterial;
  readonly oakFurniture: THREE.MeshStandardMaterial;
  readonly stone: THREE.MeshStandardMaterial;
  readonly fabricCream: THREE.MeshStandardMaterial;
  readonly fabricTeal: THREE.MeshStandardMaterial;
  readonly curtain: THREE.MeshStandardMaterial;
  readonly brass: THREE.MeshStandardMaterial;
  readonly screenDark: THREE.MeshStandardMaterial;
  readonly windowGlass: THREE.MeshStandardMaterial;
  dispose(): void;
}

/** Материал поверхности (задача 20): физический, с картой нормалей и
 *  шероховатости. `MeshPhysicalMaterial` — надмножество стандартного: поверх
 *  него доступны clearcoat (лак на дереве, полировка камня), sheen (ткань),
 *  ior/specularIntensity (стекло). Включаем только там, где это видно:
 *  лишние фичи стоят пиксельных инструкций. */
function standard(
  texture: Painted,
  repeat: [number, number],
  extra: THREE.MeshPhysicalMaterialParameters = {},
): THREE.MeshPhysicalMaterial {
  const map = texture.map.clone();
  const normalMap = texture.normalMap.clone();
  const roughnessMap = texture.roughnessMap.clone();
  for (const tex of [map, normalMap, roughnessMap]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
    tex.needsUpdate = true;
  }
  return new THREE.MeshPhysicalMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.7,
    ...extra,
  });
}

/** Все материалы острова создаются один раз и переиспользуются. */
export function createIslandMaterials(): IslandMaterials {
  const textures = {
    grass: grassTexture(),
    gravel: gravelTexture(),
    siding: sidingTexture(),
    wood: woodTexture(),
    rock: rockTexture(),
    foliage: foliageTexture(),
    trim: paintedWoodTexture(),
    plaster: plasterTexture(),
    oak: oakFloorTexture(),
    stone: stoneTexture(),
    fabricCream: fabricTexture(233, 0xf0e7d8),
    fabricTeal: fabricTexture(241, 0x74a79f),
  };

  const courtMap = courtTexture();
  const frondMap = frondTexture();

  const created: THREE.Material[] = [];
  const track = <T extends THREE.Material>(material: T): T => {
    created.push(material);
    return material;
  };

  const materials: IslandMaterials = {
    grass: track(standard(textures.grass, [26, 19], { roughness: 0.94, envMapIntensity: 0.45 })),
    gravel: track(standard(textures.gravel, [2, 12], { roughness: 0.92, envMapIntensity: 0.5 })),
    // Дерево жилое, но не лакированное: матовое, с чуть заметным лаком сверху.
    siding: track(
      standard(textures.siding, [3, 2], {
        roughness: 0.78,
        clearcoat: 0.14,
        clearcoatRoughness: 0.55,
        envMapIntensity: 0.75,
      }),
    ),
    wood: track(standard(textures.wood, [4, 4], { roughness: 0.82, envMapIntensity: 0.6 })),
    rock: track(standard(textures.rock, [6, 3], { roughness: 0.66, envMapIntensity: 0.6 })),
    shoreStone: track(standard(textures.rock, [2, 2], { color: PALETTE.shoreStone, roughness: 0.8 })),
    foliage: track(standard(textures.foliage, [2, 2], { roughness: 0.72, envMapIntensity: 0.85 })),
    court: track(new THREE.MeshStandardMaterial({ map: courtMap, roughness: 0.9, metalness: 0 })),
    frond: track(
      new THREE.MeshStandardMaterial({
        map: frondMap,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.85,
        metalness: 0,
      }),
    ),
    white: track(
      new THREE.MeshPhysicalMaterial({
        color: PALETTE.whiteWood,
        roughness: 0.7,
        metalness: 0,
        clearcoat: 0.18,
        clearcoatRoughness: 0.5,
        envMapIntensity: 0.8,
      }),
    ),
    darkRoof: track(
      new THREE.MeshPhysicalMaterial({ color: 0x3c3a38, roughness: 0.86, metalness: 0.06, envMapIntensity: 0.6 }),
    ),
    // Тёмное стекло витрин: почти зеркало, поэтому в HDR-окружении в нём видно небо.
    glass: track(
      new THREE.MeshPhysicalMaterial({
        color: 0x16262f,
        roughness: 0.035,
        metalness: 0.9,
        ior: 1.52,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        envMapIntensity: 2.3,
      }),
    ),
    metal: track(
      new THREE.MeshPhysicalMaterial({
        color: PALETTE.metal,
        roughness: 0.31,
        metalness: 1,
        envMapIntensity: 1.5,
        clearcoat: 0.35,
        clearcoatRoughness: 0.25,
      }),
    ),
    terracotta: track(
      new THREE.MeshPhysicalMaterial({ color: PALETTE.terracotta, roughness: 0.88, metalness: 0, envMapIntensity: 0.5 }),
    ),
    magenta: track(
      new THREE.MeshPhysicalMaterial({ color: PALETTE.bougainvillea, roughness: 0.72, metalness: 0, envMapIntensity: 0.7 }),
    ),
    // Ткань: мягкий sheen вместо блика — подушка не выглядит пластиком.
    cushion: track(
      new THREE.MeshPhysicalMaterial({
        color: 0xf0ece2,
        roughness: 0.94,
        metalness: 0,
        sheen: 0.5,
        sheenRoughness: 0.85,
        sheenColor: new THREE.Color(0xfff3e2),
        envMapIntensity: 0.5,
      }),
    ),
    trim: track(standard(textures.trim, [2, 2])),
    plaster: track(standard(textures.plaster, [3, 2], { roughness: 0.96 })),
    oakFloor: track(standard(textures.oak, [3.4, 2.2], { roughness: 0.95, envMapIntensity: 0.35 })),
    oakFurniture: track(standard(textures.oak, [1, 1], { color: 0xe8d3b4 })),
    stone: track(
      standard(textures.stone, [2, 2], { roughness: 0.38, clearcoat: 0.25, clearcoatRoughness: 0.35, envMapIntensity: 0.9 }),
    ),
    fabricCream: track(
      standard(textures.fabricCream, [2, 2], {
        roughness: 0.95,
        sheen: 0.45,
        sheenRoughness: 0.9,
        sheenColor: new THREE.Color(0xfff6e8),
        envMapIntensity: 0.45,
      }),
    ),
    fabricTeal: track(
      standard(textures.fabricTeal, [2, 2], {
        roughness: 0.95,
        sheen: 0.45,
        sheenRoughness: 0.9,
        sheenColor: new THREE.Color(0xd9fff6),
        envMapIntensity: 0.45,
      }),
    ),
    curtain: track(
      new THREE.MeshPhysicalMaterial({
        color: 0xe9dcc6,
        roughness: 0.97,
        metalness: 0,
        sheen: 0.35,
        sheenColor: new THREE.Color(0xfff4e4),
        side: THREE.DoubleSide,
        envMapIntensity: 0.4,
      }),
    ),
    brass: track(
      new THREE.MeshPhysicalMaterial({
        color: 0xc8a25e,
        roughness: 0.24,
        metalness: 1,
        envMapIntensity: 1.8,
        clearcoat: 0.4,
        clearcoatRoughness: 0.18,
      }),
    ),
    screenDark: track(
      new THREE.MeshPhysicalMaterial({
        color: 0x12161a,
        roughness: 0.12,
        metalness: 0.4,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.6,
      }),
    ),
    // Прозрачное стекло: сквозь витраж и окна видно интерьер (задача 5).
    // Без transmission: он рендерит сцену второй раз в отдельную цель и на слабых
    // видеокартах (и в программном рендере) съедает кадры. Обычная прозрачность дешевле.
    windowGlass: track(
      new THREE.MeshPhysicalMaterial({
        color: 0xbfdfe8,
        roughness: 0.02,
        metalness: 0.1,
        ior: 1.52,
        transparent: true,
        opacity: 0.16,
        envMapIntensity: 1.7,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        specularIntensity: 1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
    dispose(): void {
      for (const material of created) {
        const withMap = material as THREE.MeshStandardMaterial;
        withMap.map?.dispose();
        withMap.normalMap?.dispose();
        withMap.roughnessMap?.dispose();
        material.dispose();
      }
      courtMap.dispose();
      frondMap.dispose();
      for (const texture of Object.values(textures)) {
        texture.map.dispose();
        texture.normalMap.dispose();
        texture.roughnessMap.dispose();
      }
    },
  };

  return materials;
}
