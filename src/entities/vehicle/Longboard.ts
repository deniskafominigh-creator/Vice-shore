import * as THREE from 'three';

/** Лонгборд у виллы (сборка v22) — первое средство передвижения в игре.
 *
 *  Почему лонгборд, а не скутер: у привезённой модели героя нет клипа «сидеть»,
 *  и на скутере он стоял бы сквозь сиденье. Стоя на доске, герой выглядит
 *  правильно без новой анимации — а езда по острову уже есть.
 *
 *  Детали: пена-дека, шкурка-гриптэйп, четыре колеса на подвесках и неоновый
 *  подсвет снизу — визитная карточка Vice Shore. Всё в 4 материала и 5 мешей,
 *  тень отбрасывает только дека: борд не должен попадать в бюджет теней.
 */

const DECK = {
  length: 1.52,
  width: 0.56,
  thickness: 0.055,
  /** Нос и корень чуть подняты: доска не «палка». */
  kicktail: 0.06,
  wheelRadius: 0.056,
  wheelWidth: 0.048,
  truckX: 0.19,
  truckZ: 0.46,
} as const;

const NEON = 0x38e8d0;

export class Longboard {
  readonly group = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly neon: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private spin = 0;

  constructor() {
    this.group.name = 'longboard';

    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f0e2, roughness: 0.55, metalness: 0.05 });
    const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.95 });
    const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.35, metalness: 0.8 });
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0xf2d06b, roughness: 0.7 });
    this.materials.push(deckMaterial, gripMaterial, metalMaterial, wheelMaterial);

    // Дека: сплющенный цилиндр читается как скруглённая доска и стоит 40 треугольников
    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(DECK.width / 2, DECK.width / 2, DECK.thickness, 18, 1),
      deckMaterial,
    );
    deck.scale.set(1, 1, DECK.length / DECK.width);
    deck.rotation.z = Math.PI / 2;
    deck.rotation.y = Math.PI / 2;
    deck.castShadow = true;
    deck.name = 'board-deck';
    this.group.add(deck);

    // Гриптэйп — тонкий тёмный слой сверху
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(DECK.width / 2 - 0.015, DECK.width / 2 - 0.015, 0.012, 18, 1),
      gripMaterial,
    );
    grip.scale.set(1, 1, DECK.length / DECK.width - 0.05);
    grip.rotation.z = Math.PI / 2;
    grip.rotation.y = Math.PI / 2;
    grip.position.y = DECK.thickness / 2;
    this.group.add(grip);

    // Подвески
    for (const z of [-DECK.truckZ, DECK.truckZ]) {
      const truck = new THREE.Mesh(new THREE.BoxGeometry(DECK.truckX * 2, 0.032, 0.09), metalMaterial);
      truck.position.set(0, -DECK.thickness / 2 - 0.03, z);
      this.group.add(truck);
    }

    // Колёса
    const wheelGeometry = new THREE.CylinderGeometry(DECK.wheelRadius, DECK.wheelRadius, DECK.wheelWidth, 12);
    for (const z of [-DECK.truckZ, DECK.truckZ]) {
      for (const x of [-DECK.truckX, DECK.truckX]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, -DECK.thickness / 2 - 0.052, z);
        wheel.name = 'board-wheel';
        this.group.add(wheel);
        this.wheels.push(wheel);
      }
    }

    // Неоновый подсвет снизу: аддитивная плоскость, видна только когда стемнеет
    this.neon = new THREE.Mesh(
      new THREE.PlaneGeometry(DECK.width * 1.25, DECK.length * 1.05),
      new THREE.MeshBasicMaterial({
        color: NEON,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.neon.rotation.x = -Math.PI / 2;
    this.neon.position.y = -DECK.thickness / 2 - 0.11;
    this.neon.name = 'board-neon';
    this.materials.push(this.neon.material as THREE.Material);
    this.group.add(this.neon);
  }

  /** Высота деки над землёй: колесо + подвеска + половина деки. */
  static get deckCenterHeight(): number {
    return DECK.wheelRadius + 0.052;
  }

  /** Высота, на которой стоят ноги: верх деки над землёй. */
  static get feetHeight(): number {
    return Longboard.deckCenterHeight + DECK.thickness / 2;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** Поставить доску на землю: y — высота земли, не центра доски. */
  setState(x: number, groundY: number, z: number, yaw: number, lean: number): void {
    this.group.position.set(x, groundY + Longboard.deckCenterHeight, z);
    this.group.rotation.set(lean, yaw, 0, 'YXZ');
  }

  /** Колёса катятся от пройденного пути, а не от времени. */
  roll(distance: number): void {
    this.spin = (this.spin + distance / DECK.wheelRadius) % (Math.PI * 2);
    for (const wheel of this.wheels) wheel.rotation.x = this.spin;
  }

  /** Неон проявляется вечером: доска «оживает» вместе с городом. */
  setNight(amount: number): void {
    (this.neon.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.4 * Math.max(0, Math.min(1, amount));
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
