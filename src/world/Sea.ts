import * as THREE from 'three';
import { ISLAND, PALETTE, QUALITY_PRESETS, type QualityLevel } from '../core/Config';

/** Размер плоскости моря: дальше 4,5 км её не видно — тонет в дымке горизонта. */
const SEA_SIZE = 9000;

/** Море (задача 13).
 *
 *  Было: четыре синуса и один блик. Стало — то, что читается как вода:
 *  — волны Герстнера (вертикальное смещение + горизонтальный перенос): гребни острые,
 *    ложбины плоские, как у настоящей зыби;
 *  — две волновые системы: крупная зыбь (12–40 м) и рябь (0,8–2 м), у каждой своя скорость;
 *  — нормаль считается аналитически по производным, поверх неё — мелкая процедурная
 *    деталь (fbm), из-за неё блик солнца распадается на дорожку искр;
 *  — отражение неба по Шлику: берём ту же формулу градиента, что и в `Sky`, поэтому
 *    вода и небо стыкуются по горизонту без шва;
 *  — блик солнца по GGX + узкая искра, зависящая от детальной нормали;
 *  — цвет по глубине: у берега бирюза и просвечивающий песок, дальше — глубокий тон;
 *  — пена: у кромки острова (по эллипсу), на гребнях и «барашки» по ветру;
 *  — дальняя дымка, бесшовно уходящая в горизонт.
 *
 *  Всё это в одном шейдере и одном draw call: реализм здесь не покупается кадрами. */
export class Sea {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private geometry: THREE.PlaneGeometry;

  constructor(sunDirection: THREE.Vector3, segments: number) {
    this.geometry = Sea.createGeometry(segments);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(PALETTE.seaDeep) },
        uShallow: { value: new THREE.Color(PALETTE.seaShallow) },
        uSand: { value: new THREE.Color(0xcfd8bd) },
        uReflect: { value: new THREE.Color(PALETTE.seaReflect) },
        uZenith: { value: new THREE.Color(PALETTE.skyZenith) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uCloudLight: { value: new THREE.Color(PALETTE.cloudLight) },
        uShore: { value: new THREE.Vector2(ISLAND.radiusX, ISLAND.radiusZ) },
        uSunColor: { value: new THREE.Color(PALETTE.sunColor) },
        uSunDir: { value: sunDirection.clone().normalize() },
        /** 0…1 — насколько «штормит» (качество: на низком волны мягче, чтобы не пилило) */
        uChop: { value: 1 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uChop;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vHeight;
        varying vec2 vGrid;

        // Волна Герстнера: смещение по вертикали и горизонтальный перенос гребня.
        // Возвращает высоту, а производные копятся в grad (по ним строится нормаль).
        float gerstner(
          vec2 p, vec2 dir, float steepness, float wavelength, float speed,
          inout vec2 grad, inout vec2 shift
        ) {
          float k = 6.28318 / wavelength;
          float c = sqrt(9.81 / k);            // фазовая скорость глубокой воды
          float f = k * (dot(dir, p) - c * speed * uTime);
          float a = steepness / k;
          grad += dir * (a * k * cos(f));
          shift += dir * (a * sin(f)) * 0.6;
          return a * sin(f);
        }

        void main() {
          vec3 pos = position;
          vec2 p = pos.xz;

          vec2 grad = vec2(0.0);
          vec2 shift = vec2(0.0);
          float height = 0.0;

          // ——— крупная зыбь: четыре направления, честные длины волн в метрах ———
          height += gerstner(p, normalize(vec2(0.92, 0.39)), 0.16 * uChop, 42.0, 0.55, grad, shift);
          height += gerstner(p, normalize(vec2(-0.34, 0.94)), 0.14 * uChop, 27.0, 0.62, grad, shift);
          height += gerstner(p, normalize(vec2(0.72, -0.69)), 0.11 * uChop, 17.0, 0.72, grad, shift);
          height += gerstner(p, normalize(vec2(-0.88, -0.47)), 0.09 * uChop, 11.0, 0.85, grad, shift);

          // ——— накат и рябь: короткие волны, заметны только вблизи ———
          height += gerstner(p, normalize(vec2(0.98, 0.20)), 0.05 * uChop, 5.5, 1.05, grad, shift);
          height += gerstner(p, normalize(vec2(-0.55, 0.83)), 0.04 * uChop, 3.1, 1.25, grad, shift);
          height += gerstner(p, normalize(vec2(0.22, -0.97)), 0.03 * uChop, 1.8, 1.5, grad, shift);

          pos.xz += shift;
          pos.y += height;

          vec4 world = modelMatrix * vec4(pos, 1.0);
          vWorldPos = world.xyz;
          vNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
          vHeight = height;
          vGrid = p;

          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uSand;
        uniform vec3 uReflect;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uCloudLight;
        uniform vec2 uShore;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uTime;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vHeight;
        varying vec2 vGrid;

        // ——— дешёвый шум: хеши + value-noise ———
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
          for (int i = 0; i < 3; i++) {
            value += amplitude * noise(p);
            p *= 2.07;
            amplitude *= 0.5;
          }
          return value;
        }

        /** Небо для отражения — та же формула градиента, что в Sky. */
        vec3 skyColor(vec3 dir) {
          float up = clamp(dir.y, -1.0, 1.0);
          vec3 base = mix(uZenith, uHorizon, pow(1.0 - max(up, 0.0), 2.6));
          // Облачность отражения: медленная крупная рябь, чтобы небо не было «пластиковым»
          float clouds = smoothstep(0.52, 0.86, fbm(dir.xz * 3.1 + vec2(uTime * 0.006, 0.0)));
          return mix(base, uCloudLight, clouds * 0.22 * smoothstep(0.0, 0.35, up));
        }

        void main() {
          vec3 view = normalize(cameraPosition - vWorldPos);
          float distanceToEye = length(cameraPosition - vWorldPos);

          // ——— детальная нормаль: две частоты, движущиеся в разные стороны ———
          vec2 uv1 = vGrid * 0.09 + vec2(uTime * 0.014, uTime * 0.021);
          vec2 uv2 = vGrid * 0.23 - vec2(uTime * 0.028, uTime * 0.012);
          float n1 = fbm(uv1);
          float n2 = fbm(uv2);
          // Производные по экрану — из разницы соседних значений шума
          float e = 0.12;
          float dx = (fbm(uv1 + vec2(e, 0.0)) - n1) + (fbm(uv2 + vec2(e, 0.0)) - n2) * 0.7;
          float dz = (fbm(uv1 + vec2(0.0, e)) - n1) + (fbm(uv2 + vec2(0.0, e)) - n2) * 0.7;
          // Чем дальше, тем слабее деталь: иначе на горизонте получается «шум-каша»
          float detailFade = 1.0 - smoothstep(40.0, 320.0, distanceToEye);
          vec3 normal = normalize(normalize(vNormal) + vec3(-dx, 0.0, -dz) * (2.4 * detailFade));

          // ——— глубина: расстояние до кромки острова по эллипсу ———
          vec2 shorePoint = vec2(vWorldPos.x / uShore.x, vWorldPos.z / uShore.y);
          float shoreDistance = length(shorePoint);
          float shallowness = 1.0 - smoothstep(0.965, 1.35, shoreDistance);
          float sand = 1.0 - smoothstep(0.985, 1.06, shoreDistance);

          // Цвет воды: глубокий тон → бирюза на мели → песок у самой кромки
          vec3 color = mix(uDeep, uShallow, clamp(0.35 + vHeight * 0.9, 0.0, 1.0));
          color = mix(color, uShallow * 1.18, shallowness * 0.55);
          color = mix(color, uSand, sand * 0.35);

          // ——— френель: чем острее угол, тем больше неба в отражении ———
          float fresnel = pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 5.0);
          fresnel = mix(0.04, 1.0, fresnel);
          vec3 reflected = reflect(-view, normal);
          reflected.y = max(reflected.y, -0.04);
          vec3 reflection = skyColor(normalize(reflected));
          color = mix(color, reflection, clamp(fresnel, 0.0, 0.92));
          // Отражение солнца в воде чуть теплее — иначе оно «выпадает» из сцены
          color = mix(color, uReflect, fresnel * 0.18);

          // ——— солнце: блик GGX + искры по детальной нормали ———
          vec3 lightDir = normalize(uSunDir);
          vec3 halfDir = normalize(lightDir + view);
          float nDotH = max(dot(normal, halfDir), 0.0);
          float roughness = 0.16;
          float alphaR = roughness * roughness;
          float d = alphaR * alphaR;
          float denom = nDotH * nDotH * (alphaR - 1.0) + 1.0;
          float ggx = d / (3.14159 * denom * denom + 1e-4);
          float sparkle = pow(max(nDotH, 0.0), 620.0);
          float glitter = smoothstep(0.72, 0.99, n1 * 1.08 + n2 * 0.42);
          color += uSunColor * (ggx * 0.045 + sparkle * 1.7 + glitter * 0.16);

          // ——— пена ———
          float crest = smoothstep(0.42, 0.78, vHeight + 0.12);
          float windFoam = smoothstep(0.66, 0.98, fbm(vGrid * 0.35 + vec2(uTime * 0.05, -uTime * 0.03)));
          float foam = crest * 0.35 + windFoam * 0.05 * crest;

          // Прибой: пена идёт полосой вдоль кромки, рисунок движется к берегу
          float surfBand = 1.0 - smoothstep(0.0, 0.035, abs(shoreDistance - 1.0));
          float surfPulse = 0.55 + 0.45 * sin(shoreDistance * 120.0 - uTime * 1.9);
          foam += surfBand * surfPulse * 0.85;
          foam = clamp(foam, 0.0, 1.0);
          color = mix(color, vec3(1.0), foam);

          // ——— дымка горизонта ———
          color = mix(color, uHorizon, smoothstep(1200.0, 4600.0, distanceToEye));

          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'sea';
    this.mesh.updateMatrix();
    // Воду рисуем до острова: она непрозрачная, порядок экономит перерисовку неба
    this.mesh.renderOrder = -1;
  }

  update(elapsed: number): void {
    this.material.uniforms.uTime!.value = elapsed;
  }

  /** Смена качества графики: плотность сетки волн даёт разную «гладкость» гребней. */
  setSegments(segments: number): void {
    this.geometry.dispose();
    this.geometry = Sea.createGeometry(segments);
    this.mesh.geometry = this.geometry;
  }

  setQuality(quality: QualityLevel): void {
    this.setSegments(QUALITY_PRESETS[quality].seaSegments);
    // На низком качестве волны мягче: меньше вершин — меньше шума на горизонте
    const chop = quality === 'low' ? 0.72 : quality === 'medium' ? 0.9 : 1;
    this.material.uniforms.uChop!.value = chop;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private static createGeometry(segments: number): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.computeBoundingSphere();
    return geometry;
  }
}
