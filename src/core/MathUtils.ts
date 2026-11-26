/** Математические помощники: сглаживание, ограничения, детерминированный шум.
 *  Своя реализация — чтобы поведение было предсказуемым и повторяемым (seed). */

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const inverseLerp = (a: number, b: number, value: number): number =>
  a === b ? 0 : clamp01((value - a) / (b - a));

export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = inverseLerp(edge0, edge1, value);
  return t * t * (3 - 2 * t);
};

/** Кадронезависимое экспоненциальное сглаживание — база «нелинейности» всех движений.
 *  lambda — насколько быстро значение догоняет цель (больше = резче). */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Кривая ease-out для плавного появления/затухания (никаких линейных скачков). */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Детерминированный генератор случайных чисел (mulberry32). */
export const createRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Гладкий двумерный value-noise с билинейной интерполяцией — основа процедурных текстур. */
export const createNoise2D = (seed: number): ((x: number, y: number) => number) => {
  const rng = createRng(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i += 1) table[i] = rng();

  const at = (ix: number, iy: number): number =>
    table[((iy & (size - 1)) * size + (ix & (size - 1))) | 0] as number;

  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = lerp(at(x0, y0), at(x0 + 1, y0), sx);
    const bottom = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx);
    return lerp(top, bottom, sy);
  };
};

/** Фрактальный шум (сумма октав) — «дорогая» на вид, дешёвая по коду поверхность. */
export const fbm = (
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number => {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
};
