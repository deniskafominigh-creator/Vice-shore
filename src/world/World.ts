import * as THREE from 'three';
import { PALETTE, QUALITY_PRESETS, SUN, type QualityLevel } from '../core/Config';
import type { LoadedAssets } from '../core/Assets';
import { Sky } from './Sky';
import { Sea } from './Sea';
import { Island, type WalkBounds } from './Island';
import { createLighting, type LightingRig } from './Lighting';

/** Мир: небо, море, остров, свет. Один объект-владелец сцены.
 *  Задача 4 расширит его виллой и двором, не ломая текущие модули. */
export class World {
  readonly scene = new THREE.Scene();
  readonly sunDirection: THREE.Vector3;

  private readonly sky: Sky;
  private readonly sea: Sea;
  readonly island: Island;
  private readonly lighting: LightingRig;
  private readonly environmentTarget: THREE.WebGLRenderTarget | null;
  private quality: QualityLevel;

  constructor(renderer: THREE.WebGLRenderer, assets: LoadedAssets, quality: QualityLevel) {
    this.quality = quality;
    this.sunDirection = new THREE.Vector3(SUN.direction[0], SUN.direction[1], SUN.direction[2]).normalize();

    this.scene.background = new THREE.Color(PALETTE.skyHorizon);

    this.sky = new Sky(this.sunDirection);
    this.sea = new Sea(this.sunDirection, QUALITY_PRESETS[quality].seaSegments);
    this.island = new Island(assets);
    this.lighting = createLighting(this.sunDirection, quality);

    this.scene.add(this.sky.mesh, this.sea.mesh, this.island.group);
    this.scene.add(this.lighting.sun, this.lighting.sun.target, this.lighting.hemi, this.lighting.fill);

    // Отражения: окружение собирается из того же неба, что видит игрок.
    const { texture, target } = World.buildEnvironment(renderer, this.sky);
    this.environmentTarget = target;
    this.scene.environment = texture;
    this.scene.environmentIntensity = 0.5;
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
    this.island.update(elapsed);
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
    this.environmentTarget?.dispose();
    this.scene.environment = null;
  }

  /** Панорама неба → карта окружения для металла и стекла (дешёвая «жизнь» отражений). */
  private static buildEnvironment(
    renderer: THREE.WebGLRenderer,
    sky: Sky,
  ): { texture: THREE.Texture | null; target: THREE.WebGLRenderTarget | null } {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const probeScene = new THREE.Scene();
    const probeGeometry = new THREE.SphereGeometry(10, 32, 24);
    const probe = new THREE.Mesh(probeGeometry, sky.mesh.material as THREE.Material);
    probeScene.add(probe);
    try {
      const target = pmrem.fromScene(probeScene, 0, 0.1, 100);
      return { texture: target.texture, target };
    } catch (error) {
      console.warn('[World] не удалось собрать окружение, отражения будут без карты:', error);
      return { texture: null, target: null };
    } finally {
      probeGeometry.dispose();
      pmrem.dispose();
    }
  }
}
