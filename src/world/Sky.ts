import * as THREE from 'three';
import { PALETTE } from '../core/Config';

/** Небо: тропический полдень по референсу — синий градиент, крупные кучевые облака,
 *  солнце высоко. Купол следует за камерой, поэтому горизонта не «съезжает». */
export class Sky {
  readonly mesh: THREE.Mesh;

  private readonly material: THREE.ShaderMaterial;

  constructor(sunDirection: THREE.Vector3) {
    const geometry = new THREE.SphereGeometry(6000, 32, 20);
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(PALETTE.skyZenith) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uSunColor: { value: new THREE.Color(PALETTE.sunColor) },
        uCloudLight: { value: new THREE.Color(PALETTE.cloudLight) },
        uCloudShade: { value: new THREE.Color(PALETTE.cloudShade) },
        uSunDirection: { value: sunDirection.clone().normalize() },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          vec4 world = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDirection;

        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uCloudLight;
        uniform vec3 uCloudShade;
        uniform vec3 uSunDirection;
        uniform float uTime;

        // Дёшево и без артефактов: value-noise + fbm на хешах.
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 5; i++) {
            value += amplitude * noise(p);
            p *= 2.03;
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          vec3 dir = normalize(vDirection);
          float up = clamp(dir.y, -1.0, 1.0);

          // Градиент неба: насыщенный зенит → светлый горизонт
          vec3 color = mix(uZenith, uHorizon, pow(1.0 - max(up, 0.0), 2.6));

          // Солнце: диск + мягкое сияние
          vec3 sunDir = normalize(uSunDirection);
          float cosAngle = max(dot(dir, sunDir), 0.0);
          float disk = pow(cosAngle, 12000.0) * 12.0;
          float glow = pow(cosAngle, 220.0) * 0.5;
          float wide = pow(cosAngle, 10.0) * 0.14;
          color += uSunColor * (disk + glow + wide);

          // Кучевые облака: проекция направления на плоскость облаков
          float cloudHeight = 900.0;
          float t = cloudHeight / max(up, 0.06);
          vec2 plane = dir.xz * t * 0.0016;
          vec2 wind = vec2(uTime * 0.004, uTime * 0.0016);

          // Две «октавы» крупных масс + мелкая деталь по краю
          float base = fbm(plane * 0.72 + wind);
          float detail = fbm(plane * 2.6 - wind * 1.7);
          float density = base * 0.78 + detail * 0.22;

          // Покрытие: крупные кучевые массы, небо между ними остаётся синим
          float cover = smoothstep(0.46, 0.70, density);
          // У горизонта облака «слипаются» в дымку
          float fadeHorizon = smoothstep(0.02, 0.20, up) * (1.0 - smoothstep(0.62, 1.0, up) * 0.18);
          cover *= fadeHorizon;

          // Подсветка: край облака ярче, низ темнее (свет сверху)
          float lit = smoothstep(0.44, 0.80, density);
          vec3 cloudColor = mix(uCloudShade, uCloudLight, lit);
          cloudColor += uSunColor * pow(cosAngle, 6.0) * 0.25;

          color = mix(color, cloudColor, clamp(cover, 0.0, 0.92));

          // Дымка у горизонта: поверхность моря переходит в небо без шва
          float haze = smoothstep(0.05, -0.02, up);
          color = mix(color, uHorizon, haze * 0.85);

          // Ниже горизонта — цвет «дымки» (море закроет кадр само)
          color = mix(color, uHorizon, smoothstep(-0.02, -0.2, up));

          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  update(elapsed: number): void {
    this.material.uniforms.uTime!.value = elapsed;
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
