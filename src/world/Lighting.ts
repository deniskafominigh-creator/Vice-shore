import * as THREE from 'three';
import { PALETTE, QUALITY_PRESETS, SUN, type QualityLevel } from '../core/Config';

/** Свет сцены: высокое полуденное солнце + сильная небесная подсветка (референс VISION.md §1).
 *  Тени — одна зона на весь участок: дёшево и без мерцания. */
export interface LightingRig {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fill: THREE.AmbientLight;
  /** Двигать зону теней за игроком (задача 13: остров 156 × 116 м). */
  followTarget(x: number, z: number): void;
  applyQuality(quality: QualityLevel): void;
  dispose(): void;
}

export function createLighting(sunDirection: THREE.Vector3, quality: QualityLevel): LightingRig {
  const sun = new THREE.DirectionalLight(PALETTE.sunColor, 3.1);
  sun.position.copy(sunDirection).normalize().multiplyScalar(SUN.distance);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(QUALITY_PRESETS[quality].shadowMapSize);
  sun.shadow.camera.near = 40;
  sun.shadow.camera.far = 420;
  // Зона теней: остров вырос, поэтому карта теней едет за игроком (followTarget),
  // а не растягивается на все 156 м — иначе на тексель приходилось бы полметра.
  const extent = 46;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  sun.shadow.camera.updateProjectionMatrix();

  const hemi = new THREE.HemisphereLight(0xbcdcf5, 0x6f7a52, 0.75);
  hemi.position.set(0, 40, 0);

  const fill = new THREE.AmbientLight(0xeaf4ff, 0.18);

  const direction = sunDirection.clone().normalize();
  /** Шаг сетки теней: сдвиг на полтекселя убирает «плывущие» края теней. */
  const snap = (value: number, texel: number): number => Math.round(value / texel) * texel;
  const texel = (extent * 2) / sun.shadow.mapSize.x;

  const followTarget = (x: number, z: number): void => {
    const focusX = snap(x, texel);
    const focusZ = snap(z, texel);
    sun.target.position.set(focusX, 0, focusZ);
    sun.position.set(
      focusX + direction.x * SUN.distance,
      direction.y * SUN.distance,
      focusZ + direction.z * SUN.distance,
    );
    sun.target.updateMatrixWorld();
  };
  followTarget(0, 0);

  return {
    sun,
    hemi,
    fill,
    followTarget,
    applyQuality(next: QualityLevel): void {
      const size = QUALITY_PRESETS[next].shadowMapSize;
      if (sun.shadow.mapSize.x === size) return;
      sun.shadow.mapSize.setScalar(size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.needsUpdate = true;
    },
    dispose(): void {
      sun.dispose();
      hemi.dispose();
      fill.dispose();
    },
  };
}
