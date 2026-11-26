import * as THREE from 'three';
import type { Ui } from '../ui/Ui';
import type { VoiceBank, VoiceLine } from './VoiceBank';

/**
 * Катсцена конца рабочего дня (задача 22).
 *
 *  Матч отыгран — день закончен. Камера уходит в виллу: герой заходит,
 *  падает на диван и засыпает, свет в кадре гаснет. Кадры идут по таймлайну,
 *  а не по случайности: каждый отрезок знает свою длительность, поэтому сцена
 *  не «прыгает» и её можно проверить оффлайн (см. `check:cutscene`).
 *
 *  Озвучка — две реплики героя-рассказчика. Если файла нет, текст остаётся
 *  в титрах: без звука, но не пусто.
 */

export interface EndOfDayDeps {
  readonly ui: Ui;
  readonly voices: VoiceBank;
  readonly hero: THREE.Group;
  /** Пол виллы, м. */
  readonly floorY: number;
  /** Диван в гостиной: на него и ложимся. */
  readonly sofa: { x: number; z: number };
  readonly onFinish: () => void;
  /** Куда вернуть героя после сцены. */
  readonly restore: () => void;
}

interface Shot {
  readonly at: number;
  readonly run: () => void;
}

const LINES: readonly VoiceLine[] = [
  { clip: 'end_day_1', text: 'Всё, рабочий день закрыт. Три гола, полный стадион — и я без сил.' },
  { clip: 'end_day_2', text: 'Завтра снова красить, бегать и ловить солнце. Спокойной ночи, Вайс Шор.' },
];

/** Сколько держится каждая полоса кадра (секунды от начала сцены). */
const TIMELINE = {
  title: 0.0,
  lie: 3.2,
  bedLine: 5.0,
  fade: 8.6,
  end: 10.4,
} as const;

export class EndOfDay {
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);

  private shots: Shot[] = [];
  private time = 0;
  private active = false;
  private finished = false;
  private readonly blanket = new THREE.Group();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly basePosition = new THREE.Vector3();
  private readonly baseRotation = new THREE.Euler();

  constructor(private readonly deps: EndOfDayDeps) {
    this.buildProps();
  }

  get isActive(): boolean {
    return this.active;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** Плед и подушка: появляются только на время сцены. */
  private buildProps(): void {
    const { sofa, floorY } = this.deps;
    const fabric = new THREE.MeshStandardMaterial({ color: 0x7fbfb4, roughness: 0.92 });
    const pillow = new THREE.MeshStandardMaterial({ color: 0xf3e6d2, roughness: 0.95 });
    fabric.name = 'cutscene-blanket';
    pillow.name = 'cutscene-pillow';
    this.materials.push(fabric, pillow);

    const cover = new THREE.BoxGeometry(2.0, 0.14, 1.02);
    const coverMesh = new THREE.Mesh(cover, fabric);
    coverMesh.name = 'cutscene-blanket-mesh';
    coverMesh.position.set(sofa.x + 0.15, floorY + 0.66, sofa.z + 0.05);
    coverMesh.castShadow = true;
    this.blanket.add(coverMesh);
    this.geometries.push(cover);

    const pillowGeometry = new THREE.BoxGeometry(0.52, 0.16, 0.42);
    const pillowMesh = new THREE.Mesh(pillowGeometry, pillow);
    pillowMesh.name = 'cutscene-pillow-mesh';
    pillowMesh.position.set(sofa.x + 1.15, floorY + 0.68, sofa.z + 0.02);
    pillowMesh.rotation.y = 0.18;
    pillowMesh.castShadow = true;
    this.blanket.add(pillowMesh);
    this.geometries.push(pillowGeometry);

    this.blanket.visible = false;
  }

  /** Начать сцену: сюда приходит Game после финального свистка. */
  start(parent: THREE.Object3D): void {
    if (this.active) return;
    this.active = true;
    this.finished = false;
    this.time = 0;
    if (!this.blanket.parent) parent.add(this.blanket);
    this.blanket.visible = true;

    const hero = this.deps.hero;
    this.basePosition.copy(hero.position);
    this.baseRotation.copy(hero.rotation);

    this.camera.position.set(this.deps.sofa.x + 0.35, this.deps.floorY + 1.42, this.deps.sofa.z + 3.1);
    this.camera.lookAt(this.deps.sofa.x + 0.1, this.deps.floorY + 0.78, this.deps.sofa.z);

    this.deps.ui.showCutscene();
    this.shots = this.buildShots();
  }

  private buildShots(): Shot[] {
    const { ui, voices } = this.deps;
    const line = (index: number): void => {
      const text = LINES[index];
      ui.setCutsceneCaption(text.text);
      const played = voices.play(text);
      if (!played) ui.flashMission('Озвучка недоступна — читай титры', 'info');
    };
    return [
      {
        at: TIMELINE.title,
        run: () => {
          ui.setCutsceneTitle('КОНЕЦ РАБОЧЕГО ДНЯ', 'Вилла «Вайс Шор» · 21:30');
          this.placeHeroStanding();
          line(0);
        },
      },
      {
        at: TIMELINE.lie,
        run: () => {
          ui.setCutsceneCaption('Герой падает на диван, не снимая кроссовок');
        },
      },
      {
        at: TIMELINE.bedLine,
        run: () => {
          line(1);
        },
      },
      {
        at: TIMELINE.fade,
        run: () => {
          ui.setCutsceneCaption(null);
          ui.setCutsceneTitle(null, null);
        },
      },
      {
        at: TIMELINE.end,
        run: () => this.finish(),
      },
    ];
  }

  private placeHeroStanding(): void {
    const { hero, sofa, floorY } = this.deps;
    hero.position.set(sofa.x + 0.15, floorY, sofa.z + 1.35);
    hero.rotation.set(0, Math.PI, 0);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    while (this.shots.length > 0 && this.time >= this.shots[0].at) {
      const shot = this.shots.shift();
      shot?.run();
    }

    // Ложимся: тело плавно уходит из стойки в положение «на спине вдоль дивана»
    const lieStart = TIMELINE.lie;
    const lie = Math.min(1, Math.max(0, (this.time - lieStart) / 1.4));
    if (lie > 0) {
      const { hero, sofa, floorY } = this.deps;
      const eased = lie * lie * (3 - 2 * lie);
      hero.position.x = sofa.x + 0.15 * (1 - eased);
      hero.position.z = sofa.z + 1.35 * (1 - eased) + 0.02 * eased;
      hero.position.y = floorY + 0.62 * eased;
      // YXZ: сначала кладём на спину (X), потом разворачиваем головой к +X (Y)
      hero.rotation.set((Math.PI / 2) * eased, Math.PI + (Math.PI / 2) * eased, 0, 'YXZ');
    }

    // Камера медленно наезжает — кадр не «стоит», но и не трясётся
    const push = Math.min(1, this.time / TIMELINE.end);
    this.camera.position.z = this.deps.sofa.z + 3.1 - push * 0.55;
    this.camera.position.y = this.deps.floorY + 1.42 - push * 0.16;
    this.camera.lookAt(this.deps.sofa.x + 0.1, this.deps.floorY + 0.78 - push * 0.12, this.deps.sofa.z);
  }

  private finish(): void {
    if (!this.active) return;
    this.active = false;
    this.finished = true;
    this.restoreHero();
    this.deps.ui.hideCutscene();
    this.blanket.visible = false;
    this.deps.restore();
    this.deps.voices.stop();
    this.deps.onFinish();
  }

  private restoreHero(): void {
    const { hero } = this.deps;
    hero.position.copy(this.basePosition);
    hero.rotation.copy(this.baseRotation);
  }

  dispose(): void {
    this.deps.voices.stop();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.blanket.removeFromParent();
  }
}
