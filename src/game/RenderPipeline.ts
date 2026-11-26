import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { QUALITY_PRESETS, type QualityLevel } from '../core/Config';

/** Пост-обработка кадра (задача 19).
 *
 *  Цепочка: сцена → (SSAO) → (Bloom) → Output (ACES + sRGB) → (SMAA).
 *  Тон-маппинг и перевод в sRGB делает `OutputPass`: при рендере в текстуру
 *  three сам отключает тон-маппинг в материалах, поэтому двойного ACES нет.
 *
 *  Производительность: на «низком» композер не создаётся вообще — кадр идёт
 *  напрямую (MSAA самого рендерера); на «среднем» только bloom + SMAA;
 *  на «высоком» добавляется SSAO в половину разрешения (вчетверо дешевле) —
 *  AO всё равно мягкий, разницы не видно, а кадры экономятся.
 *  Если карта не тянет, `disableAmbientOcclusion()` снимает SSAO на ходу. */

export interface PipelineStats {
  /** Композер вообще используется (пост-обработка включена). */
  readonly post: boolean;
  readonly ssao: boolean;
  readonly bloom: boolean;
  readonly smaa: boolean;
  /** Дополнительные полноэкранные проходы за кадр. */
  readonly passes: number;
}

export class RenderPipeline {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private smaaPass: SMAAPass | null = null;
  private outputPass: OutputPass | null = null;

  private quality: QualityLevel;
  /** Аварийное отключение AO на слабой видеокарте (не трогает настройку качества). */
  private ambientOcclusion = true;
  private width = 1;
  private height = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer, quality: QualityLevel) {
    this.quality = quality;
    this.build();
  }

  /** Полноэкранные проходы — для проверки бюджета и отладки. */
  get stats(): PipelineStats {
    return {
      post: this.composer !== null,
      ssao: this.ssaoPass !== null,
      bloom: this.bloomPass !== null,
      smaa: this.smaaPass !== null,
      passes: (this.composer?.passes.length ?? 0),
    };
  }

  get ambientOcclusionActive(): boolean {
    return this.ssaoPass !== null;
  }

  setQuality(quality: QualityLevel): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.build();
  }

  /** Снять SSAO на ходу (слабый GPU). Остальная цепочка остаётся. */
  disableAmbientOcclusion(): boolean {
    if (!this.ssaoPass || !this.composer) return false;
    this.ambientOcclusion = false;
    this.ssaoPass.enabled = false;
    this.ssaoPass = null;
    // Проход выключен, а не удалён: индексы композера не сдвигаются.
    return true;
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const pixelRatio = this.renderer.getPixelRatio();
    this.composer?.setPixelRatio(pixelRatio);
    this.composer?.setSize(this.width, this.height);
    this.resizeSsao();
  }

  /** Кадр: либо напрямую (низкое качество), либо через композер. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const composer = this.composer;
    if (!composer || !this.renderPass) {
      this.renderer.render(scene, camera);
      return;
    }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    // SSAO рендерит глубину и нормали своей камерой — её надо синхронизировать,
    // иначе AO остаётся от прошлой камеры (меню, осмотр, третье лицо).
    if (this.ssaoPass) {
      this.ssaoPass.scene = scene;
      this.ssaoPass.camera = camera;
    }
    composer.render();
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.ssaoPass = null;
    this.bloomPass = null;
    this.smaaPass = null;
    this.outputPass = null;
  }

  private build(): void {
    this.dispose();
    const preset = QUALITY_PRESETS[this.quality];
    if (!preset.bloom && !preset.ssao && !preset.smaa) {
      this.ambientOcclusion = true;
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    // Полутоновый буфер: bloom должен видеть значения ярче 1.0 (HDR).
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(this.width, this.height);

    this.renderPass = new RenderPass(scene, camera);
    composer.addPass(this.renderPass);

    if (preset.ssao && this.ambientOcclusion) {
      const pass = new SSAOPass(scene, camera, this.width, this.height);
      pass.kernelRadius = 10;
      pass.minDistance = 0.0018;
      pass.maxDistance = 0.12;
      this.ssaoPass = pass;
      composer.addPass(pass);
    }

    if (preset.bloom) {
      const pass = new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        preset.bloomStrength,
        0.62, // радиус: мягкое сияние, а не «мыло»
        0.86, // порог: светятся только солнце, блики и лампы
      );
      this.bloomPass = pass;
      composer.addPass(pass);
    }

    this.outputPass = new OutputPass();
    composer.addPass(this.outputPass);

    if (preset.smaa) {
      const pass = new SMAAPass(1, 1);
      this.smaaPass = pass;
      composer.addPass(pass);
    }

    this.composer = composer;
    this.setSize(this.width, this.height);
  }

  /** SSAO считается мельче кадра: дешевле и мягче. */
  private resizeSsao(): void {
    if (!this.ssaoPass) return;
    const preset = QUALITY_PRESETS[this.quality];
    const scale = preset.ssaoScale > 0 ? preset.ssaoScale : 1;
    this.ssaoPass.setSize(Math.max(2, Math.round(this.width * scale)), Math.max(2, Math.round(this.height * scale)));
  }
}
