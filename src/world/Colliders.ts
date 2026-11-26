import * as THREE from 'three';

/** Столкновения мира (задача 6). Схема нарочно простая и предсказуемая:
 *  вертикальные призмы (AABB в плане) и цилиндры. Для похода по вилле и двору
 *  этого достаточно, а стоит почти ничего — в отличие от физического движка. */

export interface BoxCollider {
  readonly kind: 'box';
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Верхняя точка: камера может пролетать над низкой мебелью. */
  readonly top: number;
}

export interface CircleCollider {
  readonly kind: 'circle';
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly top: number;
}

export type Collider = BoxCollider | CircleCollider;

/** Мир столкновений: список призм + разрешение проникновений выталкиванием. */
export class CollisionWorld {
  private readonly boxes: BoxCollider[] = [];
  private readonly circles: CircleCollider[] = [];

  addBox(minX: number, maxX: number, minZ: number, maxZ: number, top: number): void {
    this.boxes.push({
      kind: 'box',
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minZ: Math.min(minZ, maxZ),
      maxZ: Math.max(minZ, maxZ),
      top,
    });
  }

  addCircle(x: number, z: number, radius: number, top: number): void {
    this.circles.push({ kind: 'circle', x, z, radius, top });
  }

  get count(): number {
    return this.boxes.length + this.circles.length;
  }

  /** Снимок всех коллайдеров — только для аудита сцены (задача 10): проверить,
   *  что каждый препятствует реальному предмету, а не воздуху. */
  list(): readonly Collider[] {
    return [...this.boxes, ...this.circles];
  }

  /** Точка занята? `y` — высота проверки: низкие предметы выше себя не мешают. */
  isBlocked(x: number, z: number, radius: number, y: number): boolean {
    for (const box of this.boxes) {
      if (box.top <= y) continue;
      if (x > box.minX - radius && x < box.maxX + radius && z > box.minZ - radius && z < box.maxZ + radius) return true;
    }
    for (const circle of this.circles) {
      if (circle.top <= y) continue;
      const dx = x - circle.x;
      const dz = z - circle.z;
      const limit = circle.radius + radius;
      if (dx * dx + dz * dz < limit * limit) return true;
    }
    return false;
  }

  /** Выталкивает точку из препятствий. Возвращает исправленную позицию.
   *  Несколько итераций нужны во внутренних углах (мебель у стены). */
  resolve(x: number, z: number, radius: number, y: number): { x: number; z: number } {
    let px = x;
    let pz = z;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      let moved = false;

      for (const box of this.boxes) {
        if (box.top <= y) continue;
        const minX = box.minX - radius;
        const maxX = box.maxX + radius;
        const minZ = box.minZ - radius;
        const maxZ = box.maxZ + radius;
        if (px <= minX || px >= maxX || pz <= minZ || pz >= maxZ) continue;

        // Выход по ближайшей грани
        const toLeft = px - minX;
        const toRight = maxX - px;
        const toBack = pz - minZ;
        const toFront = maxZ - pz;
        const smallest = Math.min(toLeft, toRight, toBack, toFront);
        if (smallest === toLeft) px = minX - 0.001;
        else if (smallest === toRight) px = maxX + 0.001;
        else if (smallest === toBack) pz = minZ - 0.001;
        else pz = maxZ + 0.001;
        moved = true;
      }

      for (const circle of this.circles) {
        if (circle.top <= y) continue;
        const dx = px - circle.x;
        const dz = pz - circle.z;
        const distance = Math.hypot(dx, dz);
        const limit = circle.radius + radius;
        if (distance >= limit) continue;
        if (distance < 0.0001) {
          px = circle.x + limit;
        } else {
          px = circle.x + (dx / distance) * limit;
          pz = circle.z + (dz / distance) * limit;
        }
        moved = true;
      }

      if (!moved) break;
    }
    return { x: px, z: pz };
  }

  /** Ближайшее препятствие вдоль луча — для «пружины» камеры и стен.
   *  Возвращает максимально допустимое расстояние (не больше maxDistance). */
  raycastDistance(from: THREE.Vector3, direction: THREE.Vector3, maxDistance: number, radius: number): number {
    const steps = Math.max(4, Math.ceil(maxDistance / 0.15));
    for (let i = 1; i <= steps; i += 1) {
      const t = (i / steps) * maxDistance;
      const x = from.x + direction.x * t;
      const z = from.z + direction.z * t;
      const y = from.y + direction.y * t;
      if (this.isBlocked(x, z, radius, y)) return Math.max(0.5, t - maxDistance / steps);
    }
    return maxDistance;
  }
}
