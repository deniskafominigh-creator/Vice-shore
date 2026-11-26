import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STREET_OUTFITS } from '../entities/character/Outfit';
import { StreetNpc, type StreetRoute } from '../entities/npc/StreetNpc';
import type { Ui } from '../ui/Ui';
import type { VoiceBank, VoiceLine } from './VoiceBank';

/**
 * Улицы острова живут (задача 22): по тротуару вдоль улицы ходят соседи.
 *
 *  Каждый — тот же скелет, что у героя, но со своей палитрой: кожа темнее или
 *  светлее, куртка синяя или бордовая. Идут по маршруту, останавливаются,
 *  разворачиваются. Когда герой подходит ближе трёх метров — здороваются:
 *  машут рукой, говорят в свою дорожку и показывают текст субтитром.
 *
 *  Маршруты проверяются по коллайдерам на старте: если точка занята домом,
 *  житель в неё не пойдёт (иначе он «въедет» в стену, и это видно).
 */

const ROUTES: ReadonlyArray<{
  route: StreetRoute;
  who: 'man' | 'woman';
  name: string;
  /** Насколько охотно здоровается: у каждого свой характер. */
  greetChance: number;
}> = [
  {
    name: 'сосед в синей куртке',
    who: 'man',
    greetChance: 0.6,
    route: { points: [[-16, 25.2], [-4, 25.4], [6, 25.2]], speed: 1.25 },
  },
  {
    name: 'прохожая с зонтом',
    who: 'woman',
    greetChance: 0.5,
    route: { points: [[12, 26.9], [2, 27.1], [-9, 26.9]], speed: 1.05 },
  },
  {
    name: 'рыбак с удочкой',
    who: 'man',
    greetChance: 0.4,
    route: { points: [[-2, 24.4], [9, 24.6], [18, 24.4]], speed: 1.15 },
  },
  {
    name: 'девушка с пляжной сумкой',
    who: 'woman',
    greetChance: 0.55,
    route: { points: [[20, 26.4], [14, 26.6], [22, 27.0]], speed: 1.35 },
  },
];

const GREETINGS: Record<'man' | 'woman', readonly VoiceLine[]> = {
  man: [
    { clip: 'hi_man_1', text: 'Здорово! Сегодня в семь на поле — не опаздывай.' },
    { clip: 'hi_man_2', text: 'О, сосед! Волки сегодня порвут королей, отвечаю.' },
  ],
  woman: [
    { clip: 'hi_woman_1', text: 'Привет! Матч в семь, я уже место на трибуне заняла.' },
    { clip: 'hi_woman_2', text: 'Добрый вечер! Не забудь билет, без него не пустят.' },
  ],
};

export class StreetLife {
  readonly npcs: StreetNpc[] = [];
  private subtitleUntil = 0;
  private clock = 0;
  private greetingIndex = 0;
  private lastSpeaker = '';
  /** Общий лимит: на улице звучит одна реплика за раз, а не четыре сразу. */
  private nextGreetAt = 0;

  constructor(
    private readonly gltf: GLTF,
    private readonly scene: THREE.Scene,
    private readonly island: { groundHeightAt: (x: number, z: number) => number; isWalkable: (x: number, z: number) => boolean },
    private readonly ui: Ui,
    private readonly voices: VoiceBank,
  ) {
    this.spawn();
  }

  private spawn(): void {
    const free = (points: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> =>
      points.filter(([x, z]) => this.island.isWalkable(x, z));

    for (let index = 0; index < ROUTES.length; index += 1) {
      const spec = ROUTES[index];
      const points = free(spec.route.points);
      // Маршрут из одной точки — житель просто стоит; из двух и больше — ходит
      if (points.length === 0) continue;
      const palette = STREET_OUTFITS[index % STREET_OUTFITS.length];
      const npc = new StreetNpc(
        this.gltf,
        palette,
        { ...spec.route, points },
        spec.name,
        this.island.groundHeightAt,
        spec.greetChance,
      );
      this.npcs.push(npc);
      this.scene.add(npc.group);
    }
  }

  update(dt: number, playerPosition: THREE.Vector3): void {
    this.clock += dt;
    if (this.subtitleUntil > 0 && this.clock > this.subtitleUntil) {
      this.subtitleUntil = 0;
      this.ui.hideSubtitle();
    }
    for (const npc of this.npcs) {
      // Дальний план: 82 тысячи треугольников на человека за 50 м не рисуем
      const distance = npc.position.distanceTo(playerPosition);
      const visible = distance < 50;
      if (npc.group.visible !== visible) npc.group.visible = visible;
      if (!visible) continue;
      const wants = npc.update(dt, playerPosition);
      if (!wants) continue;
      if (this.clock < this.nextGreetAt) continue;
      npc.greet();
      this.greet(npc);
    }
  }

  /** Житель здоровается: голос + субтитр (голос может отсутствовать). */
  private greet(npc: StreetNpc): void {
    const pool = GREETINGS[npc.name.includes('прохожая') || npc.name.includes('девушка') ? 'woman' : 'man'];
    const line = pool[this.greetingIndex % pool.length];
    this.greetingIndex += 1;
    this.lastSpeaker = npc.name;
    this.ui.showSubtitle(line.text);
    const duration = this.voices.duration(line);
    this.subtitleUntil = this.clock + Math.max(2.6, duration + 0.4);
    this.nextGreetAt = this.clock + Math.max(4, duration + 1.5);
    this.voices.play(line);
  }

  get speaker(): string {
    return this.lastSpeaker;
  }

  get triangles(): number {
    let total = 0;
    for (const npc of this.npcs) total += npc.triangles;
    return total;
  }

  dispose(): void {
    for (const npc of this.npcs) npc.dispose();
    this.npcs.length = 0;
  }
}
