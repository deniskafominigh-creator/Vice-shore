import { ASSET_MANIFEST } from '../data/assets.manifest';
import { generateTexture, type TextureBundle } from './ProceduralTextures';

export type { TextureBundle };

/** Единый загрузчик ассетов любого типа: шрифты, процедурные текстуры, (позже) модели,
 *  звуки и данные. Прогресс загрузки — настоящий, по числу реально выполненных шагов. */

export interface LoadedAssets {
  readonly textures: ReadonlyMap<string, TextureBundle>;
}

export type ProgressReporter = (value: number, label: string) => void;

/** Даёт браузеру отрисовать кадр — иначе прогресс-бар «замирает» на время работы. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

export class Assets {
  private loaded: LoadedAssets | null = null;

  get bundle(): LoadedAssets {
    if (!this.loaded) throw new Error('[Assets] ассеты ещё не загружены');
    return this.loaded;
  }

  async load(report: ProgressReporter): Promise<LoadedAssets> {
    const total = ASSET_MANIFEST.fonts.length + ASSET_MANIFEST.textures.length + 1;
    let done = 0;
    const step = (label: string): void => {
      done += 1;
      report(Math.min(1, done / total), label);
    };

    report(0, 'Подготовка');

    // 1. Шрифты (локальные .woff2, подключены через CSS).
    for (const font of ASSET_MANIFEST.fonts) {
      for (const weight of font.weights) {
        try {
          await document.fonts.load(`${weight} 48px ${font.family}`, font.sample);
        } catch (error) {
          console.warn(`[Assets] шрифт ${font.family} ${weight} не загрузился:`, error);
        }
      }
      step(`Шрифт ${font.family}`);
      await nextFrame();
    }
    await document.fonts.ready;

    // 2. Процедурные текстуры.
    const textures = new Map<string, TextureBundle>();
    for (const spec of ASSET_MANIFEST.textures) {
      const bundle = generateTexture(spec.recipe, spec.size, spec.seed);
      bundle.map.repeat.set(spec.repeat[0], spec.repeat[1]);
      bundle.normalMap?.repeat.set(spec.repeat[0], spec.repeat[1]);
      bundle.roughnessMap?.repeat.set(spec.repeat[0], spec.repeat[1]);
      textures.set(spec.id, bundle);
      step(`Текстура: ${spec.id}`);
      await nextFrame();
    }

    // 3. Финальный шаг — «сборка сцены» (сама сборка идёт сразу после, в состоянии Loading).
    step('Сборка сцены');
    await nextFrame();

    this.loaded = { textures };
    return this.loaded;
  }

  dispose(): void {
    if (!this.loaded) return;
    for (const bundle of this.loaded.textures.values()) {
      bundle.map.dispose();
      bundle.normalMap?.dispose();
      bundle.roughnessMap?.dispose();
    }
    this.loaded = null;
  }
}
