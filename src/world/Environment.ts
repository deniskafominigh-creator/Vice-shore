import * as THREE from 'three';
import { PALETTE } from '../core/Config';

/** HDR-окружение (задача 20).
 *
 *  Заказчик просил настоящую HDRI-карту (например, с Poly Haven). В песочнице
 *  наружу открыты только npm и PyPI, поэтому внешнюю панораму взять негде —
 *  зато её можно посчитать: небо, солнце и море у нас уже параметрические.
 *  Здесь собирается **настоящая HDR-карта** (equirectangular, float32): солнце
 *  в ней имеет яркость ~60, небо 1…3, море 0.2…0.6. Дальше `PMREMGenerator`
 *  сворачивает её в префильтрованную карту окружения — и металл, стекло и кожа
 *  получают отражения с реальным запасом по яркости (LDR-панорама такого не даёт:
 *  блик солнца в ней упирается в 1.0 и выглядит «мультяшно»).
 *
 *  Стоимость: 512×256 пикселей считаются один раз на загрузке (~50 мс),
 *  PMREM — один раз; в кадре это просто карта окружения. */

export interface HdrEnvironment {
  /** Префильтрованная карта окружения для `scene.environment`. */
  readonly texture: THREE.Texture | null;
  /** Исходная HDR-панорама: её же читает море для отражений в волнах. */
  readonly panorama: THREE.DataTexture | null;
  dispose(): void;
}

const WIDTH = 512;
const HEIGHT = 256;

/** Дешёвый ценный шум для облаков: две октавы, без текстур. */
const hash = (x: number, y: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const noise = (x: number, y: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const smoothX = xf * xf * (3 - 2 * xf);
  const smoothY = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return (a * (1 - smoothX) + b * smoothX) * (1 - smoothY) + (c * (1 - smoothX) + d * smoothX) * smoothY;
};

const linear = (hex: number): THREE.Color => new THREE.Color(hex).convertSRGBToLinear();

/** Собрать HDR-панораму неба и моря. */
export function createHdrPanorama(sunDirection: THREE.Vector3): THREE.DataTexture {
  // Полуточный формат, а не float32: линейная фильтрация RGBA16F — это ядро
  // WebGL2, а RGBA32F без расширения читается «чёрным». Солнце (60) в half
  // помещается с запасом, точности для отражений хватает.
  const data = new Uint16Array(WIDTH * HEIGHT * 4);
  const half = THREE.DataUtils.toHalfFloat;
  const zenith = linear(PALETTE.skyZenith);
  const horizon = linear(PALETTE.skyHorizon);
  const sunColor = linear(PALETTE.sunColor);
  const seaDeep = linear(PALETTE.seaDeep);
  const seaShallow = linear(PALETTE.seaShallow);

  const sun = sunDirection.clone().normalize();
  /** Косинус углового радиуса солнечного диска (0,55°). */
  const sunRadius = Math.cos(THREE.MathUtils.degToRad(0.55));

  for (let row = 0; row < HEIGHT; row += 1) {
    const v = (row + 0.5) / HEIGHT;
    const elevation = (v - 0.5) * Math.PI;
    const y = Math.sin(elevation);
    const ring = Math.cos(elevation);
    for (let column = 0; column < WIDTH; column += 1) {
      const u = (column + 0.5) / WIDTH;
      const phi = (u - 0.5) * Math.PI * 2;
      const dx = ring * Math.cos(phi);
      const dz = ring * Math.sin(phi);

      let r: number;
      let g: number;
      let b: number;

      if (y >= 0) {
        // Небо: зенит → горизонт, с потеплением у самой линии горизонта.
        const t = Math.pow(Math.min(1, y), 0.55);
        r = horizon.r + (zenith.r - horizon.r) * t;
        g = horizon.g + (zenith.g - horizon.g) * t;
        b = horizon.b + (zenith.b - horizon.b) * t;

        // Облака: две октавы, к горизонту сжимаются (перспектива).
        const scale = 1 / Math.max(0.18, y);
        const clouds =
          noise(dx * 2.4 * scale, dz * 2.4 * scale) * 0.62 +
          noise(dx * 5.7 * scale, dz * 5.7 * scale) * 0.38;
        const cloudMask = Math.max(0, clouds - 0.52) * 1.9 * Math.min(1, y * 2.4);
        const cloudLight = linear(PALETTE.cloudLight);
        r += (cloudLight.r * 2.1 - r) * cloudMask;
        g += (cloudLight.g * 2.1 - g) * cloudMask;
        b += (cloudLight.b * 2.1 - b) * cloudMask;
      } else {
        // Море: тёмное в глубине, светлее у горизонта, с солнечной дорожкой.
        const t = Math.pow(Math.min(1, -y * 3.2), 0.7);
        r = seaShallow.r + (seaDeep.r - seaShallow.r) * t;
        g = seaShallow.g + (seaDeep.g - seaShallow.g) * t;
        b = seaShallow.b + (seaDeep.b - seaShallow.b) * t;
        const glitter = Math.pow(Math.max(0, dx * sun.x + y * sun.y + dz * sun.z), 42) * 5.5;
        r += sunColor.r * glitter;
        g += sunColor.g * glitter;
        b += sunColor.b * glitter;
      }

      // Солнце: диск 60× плюс ореол до 14°.
      const cosAngle = dx * sun.x + y * sun.y + dz * sun.z;
      if (cosAngle > 0.001) {
        const disk = cosAngle > sunRadius ? 60 : 0;
        const glow = Math.pow(cosAngle, 900) * 9 + Math.pow(cosAngle, 24) * 1.5;
        r += sunColor.r * (disk + glow);
        g += sunColor.g * (disk + glow);
        b += sunColor.b * (disk + glow);
      }

      const offset = (row * WIDTH + column) * 4;
      data[offset] = half(r);
      data[offset + 1] = half(g);
      data[offset + 2] = half(b);
      data[offset + 3] = half(1);
    }
  }

  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.name = 'vice-shore-hdr-sky';
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** HDR-панорама → префильтрованная карта окружения для `scene.environment`. */
export function createHdrEnvironment(
  renderer: THREE.WebGLRenderer,
  sunDirection: THREE.Vector3,
): HdrEnvironment {
  let source: THREE.DataTexture | null = null;
  let target: THREE.WebGLRenderTarget | null = null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    source = createHdrPanorama(sunDirection);
    pmrem.compileEquirectangularShader();
    target = pmrem.fromEquirectangular(source);
    return {
      texture: target.texture,
      panorama: source,
      dispose(): void {
        target?.dispose();
        source?.dispose();
      },
    };
  } catch (error) {
    console.warn('[Environment] HDR-окружение не собралось:', error);
    source?.dispose();
    target?.dispose();
    return {
      texture: null,
      panorama: null,
      dispose(): void {
        /* нечего освобождать */
      },
    };
  } finally {
    pmrem.dispose();
  }
}
