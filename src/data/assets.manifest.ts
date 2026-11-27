import type { TextureRecipe } from '../core/ProceduralTextures';

/** Манифест ассетов — единый реестр для всех типов файлов (§4.2 GOAL.md).
 *  Прямых загрузок «по месту» быть не должно: только через Assets.load(). */

export interface FontSpec {
  readonly family: string;
  readonly weights: readonly number[];
  /** Строка-образец: содержит кириллицу и латиницу, чтобы подтянулись оба сабсета. */
  readonly sample: string;
}

export interface TextureSpec {
  readonly id: string;
  readonly recipe: TextureRecipe;
  readonly size: number;
  readonly seed: number;
  readonly repeat: readonly [number, number];
}

export const ASSET_MANIFEST = {
  fonts: [
    { family: 'Oswald', weights: [500, 700], sample: 'VICE SHORE Вилла АБВ abc 123' },
    { family: 'Inter', weights: [400, 600], sample: 'Пауза Настройки АБВ abc 123' },
  ] as readonly FontSpec[],

  textures: [
    { id: 'limestone', recipe: 'limestone', size: 512, seed: 1337, repeat: [3, 2] },
    { id: 'concrete', recipe: 'concrete', size: 512, seed: 2024, repeat: [4, 4] },
    { id: 'brushed-metal', recipe: 'brushed-metal', size: 256, seed: 9081, repeat: [3, 1] },
  ] as readonly TextureSpec[],
} as const;
