import * as THREE from 'three';
import { FOG, PALETTE, QUALITY_PRESETS, SUN, type QualityLevel } from '../core/Config';
import type { LoadedAssets } from '../core/Assets';
import { Sky } from './Sky';
import { Sea } from './Sea';
import { Island, type WalkBounds } from './Island';
import { createLighting, type LightingRig } from './Lighting';
import { createHdrEnvironment, type HdrEnvironment } from './Environment';

/** Мир: небо, море, остров, свет. Один объект-владелец сцены.
 *  Задача 4 расширит его виллой и двором, не ломая текущие модули. */
export class World {
  readonly scene = new THREE.Scene();
  readonly sunDirection: THREE.Vector3;

  private readonly sky: Sky;
  private readonly sea: Sea;
  readonly island: Island;
  private readonly lighting: LightingRig;
  private readonly environment: HdrEnvironment | null = null;
  private quality: QualityLevel;

  constructor(renderer: THREE.WebGLRenderer, assets: LoadedAssets, quality: QualityLevel) {
    this.quality = quality;
    this.sunDirection = new THREE.Vector3(SUN.direction[0], SUN.direction[1], SUN.direction[2]).normalize();

    this.scene.background = new THREE.Color(PALETTE.skyHorizon);
    // Дымка в цвет неба: дальний берег и трибуны не обрываются, а растворяются.
    this.scene.fog = new THREE.FogExp2(PALETTE.skyHorizon, FOG.density);

    this.sky = new Sky(this.sunDirection);
    this.sea = new Sea(this.sunDirection, QUALITY_PRESETS[quality].seaSegments);
    this.island = new Island(assets);
    this.lighting = createLighting(this.sunDirection, quality);

    this.scene.add(this.sky.mesh, this.sea.mesh, this.island.group);
    this.scene.add(this.lighting.sun, this.lighting.sun.target, this.lighting.hemi, this.lighting.fill);

    // Отражения: HDR-панорама неба и моря, свёрнутая в карту окружения (задача 20).
    // Солнце в ней ярче 60 — поэтому блики на стекле и металле «зажигаются», а не
    // упираются в единицу, как в LDR-панораме.
    const environment = createHdrEnvironment(renderer, this.sunDirection);
    this.environment = environment;
    this.scene.environment = environment.texture;
    this.scene.environmentIntensity = 0.9;
    // Море отражает ту же HDR-панораму: блики солнца в волнах настоящие.
    this.sea.setEnvironment(environment.panorama);
  }

  /** Карта окружения (для отладочных проверок и настроек). */
  get environmentMap(): THREE.Texture | null {
    return this.environment?.texture ?? null;
  }

  get bounds(): WalkBounds {
    return this.island.bounds;
  }

  get triangleCountEstimate(): number {
    return this.island.countTriangles();
  }

  /** Анимация мира: волны во времени, облака плывут, купол неба следует за камерой. */
  update(dt: number, elapsed: number, camera: THREE.Camera): void {
    void dt;
    this.sea.update(elapsed);
    this.sky.update(elapsed);
    this.island.update(elapsed, camera.position);
    this.sky.follow(camera);
    // Тени считаются вокруг того, на что смотрит игрок: карта не «пикселится» на весь остров
    this.lighting.followTarget(camera.position.x, camera.position.z);
  }

  setQuality(quality: QualityLevel): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.sea.setQuality(quality);
    this.lighting.applyQuality(quality);
  }

  dispose(): void {
    this.sky.dispose();
    this.sea.dispose();
    this.island.dispose();
    this.lighting.dispose();
    this.environment?.dispose();
    this.scene.environment = null;
  }

}
