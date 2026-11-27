import * as THREE from 'three';
import { createNoise2D, clamp01, smoothstep } from '../../core/MathUtils';
import type { IslandMaterials } from './IslandTextures';
import type { InteriorBounds } from './Villa';
import type { CollisionWorld } from '../Colliders';

/** Ремонт в комнате (задача 7): неокрашенная стена, валик, банка, стремянка, плёнка.
 *  Покрытие хранится сеткой «полосы × ячейки» и рисуется в canvas-маску:
 *  стена проявляется постепенно, пятно не выходит за её границы. */

export const PAINT = {
  /** Цвет свежей краски. */
  color: 0xa8c6ba,
  /** Полос на стене — как на референсе. */
  stripes: 10,
  /** Ячеек по высоте в полосе: ими меряется покрытие. */
  cells: 18,
  /** Мокрая краска темнее и глаже, потом сохнет. */
  dryingSeconds: 5.5,
} as const;

const WALL_WIDTH = 4.6;
const WALL_HEIGHT = 3.02;
const WALL_BASE = 0.12;
const MASK_WIDTH = 512;
const MASK_HEIGHT = 336;

/** «Шубка» валика: вертикальные штрихи ворса. Маска умножается на них одним
 *  `drawImage`, поэтому край слоя не выглядит ровной заливкой, а живой полосой. */
function createNapCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 336;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  for (let x = 0; x < canvas.width; x += 1) {
    // Детерминированный «шум»: одна и та же колонка всегда одинаковой плотности,
    // иначе маска мерцала бы при каждой перерисовке.
    const hash = Math.sin(x * 12.9898) * 43758.5453;
    const noise = hash - Math.floor(hash);
    const alpha = 0.74 + noise * 0.26;
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.fillRect(x, 0, 1, canvas.height);
  }
  // Полосу ворса слегка «разбиваем» поперёк, чтобы штрихи не были бесконечными
  for (let y = 0; y < canvas.height; y += 7) {
    const hash = Math.sin(y * 7.233) * 1973.13;
    const noise = hash - Math.floor(hash);
    if (noise > 0.55) continue;
    ctx.fillStyle = `rgba(255,255,255,${(0.5 + noise * 0.4).toFixed(3)})`;
    ctx.fillRect(0, y, canvas.width, 2);
  }
  return canvas;
}

/** Текстура «сырой» стены: штукатурка с заплатками, потёками и следами валика. */
function createRawWallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 688;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось создать контекст canvas для стены');
  const noise = createNoise2D(9173);

  ctx.fillStyle = '#c3baa7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Крупные пятна тона — стена неровная, а не «обои в клеточку»
  for (let i = 0; i < 90; i += 1) {
    const x = noise(i * 3.1, 0.5) * 0.5 + 0.5;
    const y = noise(0.7, i * 2.7) * 0.5 + 0.5;
    const r = 40 + Math.abs(noise(i * 1.7, i * 2.3)) * 150;
    const tone = 168 + Math.round(Math.abs(noise(i * 0.9, 4.2)) * 52);
    const gradient = ctx.createRadialGradient(x * canvas.width, y * canvas.height, 0, x * canvas.width, y * canvas.height, r);
    gradient.addColorStop(0, `rgba(${tone + 12},${tone + 6},${tone - 12},0.22)`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Заплатки шпаклёвки: светлее и глаже, с рваным краем
  const patches = [
    { x: 0.08, y: 0.18, w: 0.22, h: 0.3 },
    { x: 0.45, y: 0.12, w: 0.16, h: 0.22 },
    { x: 0.68, y: 0.5, w: 0.24, h: 0.34 },
    { x: 0.24, y: 0.62, w: 0.18, h: 0.26 },
    { x: 0.86, y: 0.2, w: 0.11, h: 0.2 },
  ];
  for (const patch of patches) {
    ctx.save();
    ctx.beginPath();
    const cx = (patch.x + patch.w / 2) * canvas.width;
    const cy = (patch.y + patch.h / 2) * canvas.height;
    const steps = 26;
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      const wobble = 1 + Math.sin(angle * 3 + patch.x * 20) * 0.09 + Math.sin(angle * 7 + patch.y * 11) * 0.05;
      const px = cx + Math.cos(angle) * patch.w * canvas.width * 0.5 * wobble;
      const py = cy + Math.sin(angle) * patch.h * canvas.height * 0.5 * wobble;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(214,206,190,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,140,124,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  // Следы валика и потёки — стена уже «в работе»
  for (let i = 0; i < 160; i += 1) {
    const x = Math.abs(noise(i * 5.3, 1.1)) * canvas.width;
    const w = 6 + Math.abs(noise(i * 2.9, 6.4)) * 26;
    const y0 = Math.abs(noise(i * 1.3, 8.8)) * canvas.height * 0.7;
    const h = 80 + Math.abs(noise(i * 4.1, 2.2)) * canvas.height * 0.5;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(214,206,190,0.10)' : 'rgba(168,160,146,0.06)';
    ctx.fillRect(x, y0, w, h);
  }

  // Мелкая крупа штукатурки
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * 16;
    data[i] = Math.max(0, Math.min(255, data[i] + grain));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + grain));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + grain));
  }
  ctx.putImageData(image, 0, 0);

  // Потёки от воды у пола
  const stain = ctx.createLinearGradient(0, canvas.height, 0, canvas.height * 0.82);
  stain.addColorStop(0, 'rgba(120,112,98,0.28)');
  stain.addColorStop(1, 'rgba(120,112,98,0)');
  ctx.fillStyle = stain;
  ctx.fillRect(0, canvas.height * 0.82, canvas.width, canvas.height * 0.18);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Стена под покраску: сетка покрытия + маска в canvas-текстуре. */
export class PaintWall {
  readonly mesh: THREE.Mesh;
  readonly center: THREE.Vector3;
  /** Нормаль из стены в комнату. */
  readonly normal = new THREE.Vector3(-1, 0, 0);
  readonly width = WALL_WIDTH;
  readonly height = WALL_HEIGHT;
  /** Низ окрашиваемой области. */
  readonly baseY: number;

  /** Покрытие по ячейкам: [полоса][ячейка], 0..1. */
  private readonly coverage: number[][];
  private readonly maskCanvas: HTMLCanvasElement;
  private readonly napCanvas: HTMLCanvasElement;
  private readonly maskTexture: THREE.CanvasTexture;
  private readonly material: THREE.MeshStandardMaterial;
  private dirty = true;
  private wetness = 0;
  private paintUniforms: { uWetness?: { value: number } } = {};

  constructor(bounds: InteriorBounds, floorY: number) {
    this.baseY = floorY + WALL_BASE;
    const centerZ = -12.0;
    this.center = new THREE.Vector3(bounds.maxX - 0.014, this.baseY + WALL_HEIGHT / 2, centerZ);
    this.coverage = Array.from({ length: PAINT.stripes }, () => new Array<number>(PAINT.cells).fill(0));

    this.napCanvas = createNapCanvas();
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = MASK_WIDTH;
    this.maskCanvas.height = MASK_HEIGHT;
    const maskContext = this.maskCanvas.getContext('2d');
    if (!maskContext) throw new Error('Не удалось создать маску покраски');
    maskContext.fillStyle = '#000';
    maskContext.fillRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
    this.maskTexture = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTexture.colorSpace = THREE.NoColorSpace;

    const rawTexture = createRawWallTexture();
    this.material = new THREE.MeshStandardMaterial({
      map: rawTexture,
      roughness: 0.96,
      metalness: 0,
      // Маска и краска подмешиваются в стандартный материал, чтобы свет и тени остались общими.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.applyShader();

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(WALL_WIDTH, WALL_HEIGHT), this.material);
    this.mesh.position.copy(this.center);
    // Плоскость по умолчанию смотрит в +Z: разворачиваем нормалью в комнату (−X).
    this.mesh.rotation.y = -Math.PI / 2;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'paint-wall';
  }

  /** Готово ли покрытие целиком. */
  get complete(): boolean {
    // 99 % — это уже визуально ровная стена: гонять игрока за последними пикселями незачем
    return this.progress >= 0.99;
  }

  /** Общий прогресс 0..1. */
  get progress(): number {
    let sum = 0;
    for (const stripe of this.coverage) {
      for (const cell of stripe) sum += cell;
    }
    return sum / (PAINT.stripes * PAINT.cells);
  }

  /** Покрытие отдельной полосы 0..1 (для подсказок и HUD). */
  stripeProgress(index: number): number {
    const stripe = this.coverage[index];
    if (!stripe) return 0;
    let sum = 0;
    for (const cell of stripe) sum += cell;
    return sum / PAINT.cells;
  }

  /** Центр полосы по Z (полоса 0 — у задней стены). */
  stripeCenterZ(index: number): number {
    const stripeWidth = WALL_WIDTH / PAINT.stripes;
    return this.center.z - WALL_WIDTH / 2 + stripeWidth * (index + 0.5);
  }

  /** Есть ли ещё непрокрашенное в полосе. */
  stripeRemaining(index: number): number {
    return 1 - this.stripeProgress(index);
  }

  /** Красит ячейку: возвращает фактический прирост покрытия (0..1). */
  paintCell(stripeIndex: number, cellIndex: number, amount: number): number {
    const stripe = this.coverage[stripeIndex];
    if (!stripe) return 0;
    const cell = Math.max(0, Math.min(PAINT.cells - 1, cellIndex));
    const before = stripe[cell];
    const after = clamp01(before + amount);
    stripe[cell] = after;
    if (after !== before) {
      this.dirty = true;
      this.wetness = 1;
    }
    return after - before;
  }

  /** Слой от одного прохода валика: ставит «не меньше, чем есть».
   *  Второй проход по тому же месту ничего не добавляет — краска не натирается.
   *  Возвращает фактический прирост (0..1), по нему списывается краска с валика. */
  coatCell(stripeIndex: number, cellIndex: number, amount: number): number {
    const stripe = this.coverage[stripeIndex];
    if (!stripe) return 0;
    const cell = Math.max(0, Math.min(PAINT.cells - 1, cellIndex));
    const before = stripe[cell];
    const after = Math.min(1, Math.max(before, amount));
    if (after <= before + 1e-9) return 0;
    stripe[cell] = after;
    this.dirty = true;
    this.wetness = 1;
    return after - before;
  }

  /** Восстановление из сохранения. */
  setCoverage(values: readonly number[] | undefined): void {
    if (!values || values.length !== PAINT.stripes * PAINT.cells) return;
    for (let s = 0; s < PAINT.stripes; s += 1) {
      for (let c = 0; c < PAINT.cells; c += 1) {
        this.coverage[s][c] = clamp01(values[s * PAINT.cells + c] ?? 0);
      }
    }
    this.dirty = true;
    this.wetness = 0;
  }

  /** Плоский список покрытия — так оно уезжает в сохранение. */
  snapshot(): number[] {
    const values: number[] = [];
    for (const stripe of this.coverage) for (const cell of stripe) values.push(Number(cell.toFixed(2)));
    return values;
  }

  /** Перерисовать маску, если что-то менялось, и подсушить краску. */
  update(dt: number): void {
    if (this.wetness > 0) {
      this.wetness = Math.max(0, this.wetness - dt / PAINT.dryingSeconds);
      if (this.paintUniforms.uWetness) this.paintUniforms.uWetness.value = this.wetness;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const ctx = this.maskCanvas.getContext('2d');
    if (!ctx) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, MASK_WIDTH, MASK_HEIGHT);

    const stripeWidth = MASK_WIDTH / PAINT.stripes;
    const cellHeight = MASK_HEIGHT / PAINT.cells;
    for (let s = 0; s < PAINT.stripes; s += 1) {
      const stripe = this.coverage[s];
      for (let c = 0; c < PAINT.cells; c += 1) {
        const value = stripe[c];
        if (value <= 0.01) continue;
        // Краска ложится от валика: слегка «рваный» край ячейки
        const fade = smoothstep(0.02, 0.35, value);
        ctx.fillStyle = `rgba(255,255,255,${(value * fade).toFixed(3)})`;
        const y = MASK_HEIGHT - (c + 1) * cellHeight;
        ctx.fillRect(s * stripeWidth, y, stripeWidth + 0.6, cellHeight + 0.6);
      }
    }
    // Ворс рукава: без него слой выглядит заливкой, а не мазком
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.napCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    this.maskTexture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.maskTexture.dispose();
  }

  private applyShader(): void {
    const mask = this.maskTexture;
    const paintColor = new THREE.Color(PAINT.color);
    const uniformsRef = this.paintUniforms;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uMask = { value: mask };
      shader.uniforms.uPaintColor = { value: paintColor };
      shader.uniforms.uWetness = { value: 0 };
      uniformsRef.uWetness = shader.uniforms.uWetness as { value: number };

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform sampler2D uMask;
           uniform vec3 uPaintColor;
           uniform float uWetness;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           float paintAmount = texture2D(uMask, vMapUv).r;
           // Краска ложится на неровную стену: берём светлоту штукатурки, чтобы не было «заливки»
           float baseLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
           float relief = clamp(baseLuma * 1.55, 0.78, 1.12);
           vec3 wetPaint = uPaintColor * relief * mix(1.0, 0.8, uWetness);
           diffuseColor.rgb = mix(diffuseColor.rgb, wetPaint, paintAmount);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           roughnessFactor = mix(roughnessFactor, mix(0.55, 0.3, uWetness), paintAmount);`,
        );
    };
    this.material.customProgramCacheKey = () => 'paint-wall-v1';
  }
}

/** Валик в руке: ручка строится между кистью и точкой на стене каждый кадр,
 *  поэтому рукав всегда касается стены именно там, где считается покрытие. */
export class HeldRoller {
  readonly group = new THREE.Group();
  private readonly pole: THREE.Mesh;
  private readonly sleeve: THREE.Mesh;
  private readonly paintBand: THREE.Mesh;
  private readonly seam: THREE.Mesh;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly direction = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly baseQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  private readonly spinQuaternion = new THREE.Quaternion();
  private spin = 0;

  constructor(materials: IslandMaterials) {
    this.group.name = 'held-roller';
    this.pole = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 1, 10), materials.brass);
    this.pole.castShadow = true;
    this.group.add(this.pole);

    // Рукав 44 см — широкий валик для больших стен: одна полоса стены (46 см)
    // закрывается одним проходом, как и положено в жизни.
    this.sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.44, 14),
      new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.9 }),
    );
    this.sleeve.quaternion.copy(this.baseQuaternion);
    this.sleeve.castShadow = true;
    this.group.add(this.sleeve);

    // Шов на ворсе: по нему видно, что рукав катится, а не скользит по стене
    this.seam = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, 0.42, 0.008),
      new THREE.MeshStandardMaterial({ color: 0xcfc7b6, roughness: 0.8 }),
    );
    this.seam.position.set(0.045, 0, 0);
    this.sleeve.add(this.seam);

    this.paintBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.047, 0.047, 0.425, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: PAINT.color, roughness: 0.55, side: THREE.DoubleSide }),
    );
    this.paintBand.rotation.x = Math.PI / 2;
    this.paintBand.visible = false;
    this.group.add(this.paintBand);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** Есть ли краска на рукаве (визуальная обратная связь). */
  setLoaded(loaded: boolean): void {
    this.paintBand.visible = loaded;
  }

  /** Рукав катится по стене: угол — пройденный путь / радиус. */
  rollBy(distance: number): void {
    this.spin = (this.spin + distance / 0.045) % (Math.PI * 2);
    this.spinQuaternion.setFromAxisAngle(this.axis, this.spin);
    this.sleeve.quaternion.copy(this.baseQuaternion).multiply(this.spinQuaternion);
  }

  /** Поставить ручку от кисти до точки на стене. */
  setPose(hand: THREE.Vector3, tip: THREE.Vector3): void {
    this.direction.subVectors(tip, hand);
    const length = Math.max(0.2, this.direction.length());
    this.direction.normalize();
    this.pole.position.copy(hand).addScaledVector(this.direction, length / 2);
    this.pole.quaternion.setFromUnitVectors(this.up, this.direction);
    this.pole.scale.set(1, length, 1);
    this.sleeve.position.copy(tip);
    this.paintBand.position.copy(tip);
  }

  dispose(): void {
    this.pole.geometry.dispose();
    this.sleeve.geometry.dispose();
    this.seam.geometry.dispose();
    this.paintBand.geometry.dispose();
  }
}

export interface RenovationResult {
  readonly group: THREE.Group;
  readonly wall: PaintWall;
  /** Валик на стремянке (лежит без дела). */
  readonly rollerRest: THREE.Group;
  /** Валик в руке: невидим, пока его не взяли. */
  readonly rollerHeld: HeldRoller;
  /** Банка краски на полу. */
  readonly can: THREE.Group;
  /** Точка, где стоит валик, пока его не взяли. */
  readonly rollerSpot: THREE.Vector3;
  /** Точка банки. */
  readonly canSpot: THREE.Vector3;
  /** Подсветка предметов под курсором-прицелом (кольцо на полу). */
  readonly rollerRing: THREE.Mesh;
  readonly canRing: THREE.Mesh;
}

export function buildRenovation(
  materials: IslandMaterials,
  bounds: InteriorBounds,
  floorY: number,
  collisions: CollisionWorld,
): RenovationResult {
  const group = new THREE.Group();
  group.name = 'renovation';
  const y0 = floorY;
  const wall = new PaintWall(bounds, floorY);
  group.add(wall.mesh);

  const box = (
    material: THREE.Material,
    size: [number, number, number],
    position: [number, number, number],
    rotation: [number, number, number] = [0, 0, 0],
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const wallX = bounds.maxX;
  const wallZ0 = wall.center.z - WALL_WIDTH / 2;
  const wallZ1 = wall.center.z + WALL_WIDTH / 2;

  // ——— Плёнка на полу и скотч по краям ———
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(WALL_WIDTH + 0.5, 1.7), materials.fabricCream.clone());
  const sheetMaterial = sheet.material as THREE.MeshStandardMaterial;
  sheetMaterial.color.setHex(0xdfd6c2);
  sheetMaterial.roughness = 0.85;
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(wallX - 0.92, y0 + 0.016, wall.center.z);
  sheet.receiveShadow = true;
  group.add(sheet);

  const tapeMaterial = materials.trim.clone();
  tapeMaterial.color.setHex(0xdccfae);
  tapeMaterial.roughness = 0.9;
  for (const y of [wall.baseY - 0.02, wall.baseY + WALL_HEIGHT + 0.02]) {
    box(tapeMaterial, [0.02, 0.032, WALL_WIDTH], [wallX - 0.012, y, wall.center.z]);
  }
  box(tapeMaterial, [0.02, WALL_HEIGHT, 0.032], [wallX - 0.012, wall.baseY + WALL_HEIGHT / 2, wallZ0]);
  box(tapeMaterial, [0.02, WALL_HEIGHT, 0.032], [wallX - 0.012, wall.baseY + WALL_HEIGHT / 2, wallZ1]);

  // ——— Стремянка, на которой лежит валик ———
  const ladderX = wallX - 0.95;
  const ladderZ = wall.center.z + 0.9;
  const ladderMaterial = materials.white;
  for (const side of [-1, 1]) {
    box(ladderMaterial, [0.05, 1.0, 0.06], [ladderX + side * 0.18, y0 + 0.5, ladderZ - 0.16], [0.12, 0, 0]);
    box(ladderMaterial, [0.05, 1.0, 0.06], [ladderX + side * 0.18, y0 + 0.5, ladderZ + 0.16], [-0.12, 0, 0]);
  }
  for (let i = 0; i < 3; i += 1) {
    box(materials.white, [0.4, 0.04, 0.34], [ladderX, y0 + 0.26 + i * 0.3, ladderZ]);
  }
  collisions.addBox(ladderX - 0.25, ladderX + 0.25, ladderZ - 0.28, ladderZ + 0.28, y0 + 1.0);

  // ——— Валик ———
  const makeRoller = (): THREE.Group => {
    const roller = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 1.0, 10), materials.brass);
    pole.position.y = 0.5;
    roller.add(pole);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.18, 10), materials.screenDark);
    grip.position.y = 0.1;
    roller.add(grip);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 14, Math.PI), materials.metal);
    frame.position.set(0, 1.0, 0);
    frame.rotation.z = Math.PI / 2;
    roller.add(frame);
    const sleeveMaterial = new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.9 });
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 14), sleeveMaterial);
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.set(0, 1.0, 0.14);
    roller.add(sleeve);
    const paint = new THREE.Mesh(
      new THREE.CylinderGeometry(0.046, 0.046, 0.235, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: PAINT.color, roughness: 0.7, side: THREE.DoubleSide }),
    );
    paint.rotation.x = Math.PI / 2;
    paint.position.copy(sleeve.position);
    paint.visible = false;
    roller.add(paint);
    roller.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return roller;
  };

  const rollerRest = makeRoller();
  rollerRest.position.set(ladderX, y0 + 0.99, ladderZ - 0.02);
  rollerRest.rotation.set(Math.PI / 2, 0, 0.35);
  group.add(rollerRest);

  const rollerHeld = new HeldRoller(materials);
  rollerHeld.setVisible(false);
  group.add(rollerHeld.group);

  // ——— Банка краски ———
  const can = new THREE.Group();
  const canBody = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.125, 0.3, 20, 1, true), materials.metal);
  canBody.position.y = 0.15;
  canBody.castShadow = true;
  can.add(canBody);
  const canBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.02, 20), materials.metal);
  canBottom.position.y = 0.01;
  can.add(canBottom);
  const canRim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 8, 24), materials.metal);
  canRim.rotation.x = Math.PI / 2;
  canRim.position.y = 0.3;
  can.add(canRim);
  const paintSurface = new THREE.Mesh(
    new THREE.CircleGeometry(0.128, 22),
    new THREE.MeshStandardMaterial({ color: PAINT.color, roughness: 0.25 }),
  );
  paintSurface.rotation.x = -Math.PI / 2;
  paintSurface.position.y = 0.24;
  can.add(paintSurface);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.008, 6, 18, Math.PI), materials.metal);
  handle.position.y = 0.31;
  handle.rotation.x = Math.PI / 2;
  can.add(handle);
  const canSpot = new THREE.Vector3(wallX - 0.55, y0, wall.center.z - 1.35);
  can.position.copy(canSpot);
  group.add(can);
  collisions.addCircle(canSpot.x, canSpot.z, 0.2, y0 + 0.32);

  // ——— Мелочи: кисть в банке, тряпка, второй валик-запаска ———
  const brush = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 8), materials.brass);
  brush.position.set(canSpot.x + 0.16, y0 + 0.5, canSpot.z);
  brush.rotation.z = 0.35;
  group.add(brush);
  box(materials.fabricCream, [0.3, 0.02, 0.3], [canSpot.x + 0.32, y0 + 0.02, canSpot.z - 0.22], [0, 0.4, 0]);

  // ——— Подсветка предметов: тонкое кольцо на полу ———
  const makeRing = (radius: number, position: THREE.Vector3): THREE.Mesh => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.035, radius, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.0, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(position.x, y0 + 0.012, position.z);
    ring.visible = false;
    group.add(ring);
    return ring;
  };
  const rollerRing = makeRing(0.4, new THREE.Vector3(ladderX, y0, ladderZ));
  const canRing = makeRing(0.34, canSpot);

  return {
    group,
    wall,
    rollerRing,
    canRing,
    rollerRest,
    rollerHeld,
    can,
    rollerSpot: new THREE.Vector3(ladderX, y0 + 0.99, ladderZ),
    canSpot: canSpot.clone(),
  };
}
