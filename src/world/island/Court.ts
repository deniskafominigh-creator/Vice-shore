import * as THREE from 'three';
import { COURT, PLOT, TERRACE } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';
import type { CollisionWorld } from '../Colliders';

/** Баскетбольная площадка к западу от участка: плита, опора, щит, кольцо, сетка.
 *  Механика двух голов (задача 8) берёт отсюда точную геометрию кольца и щита,
 *  чтобы мяч сталкивался с ними по-настоящему, а не «примерно». */

/** Геометрия кольца и щита в мировых координатах — для физики мяча (задача 8). */
export interface HoopGeometry {
  /** Центр кольца (плоскость кольца горизонтальна). */
  readonly center: THREE.Vector3;
  /** Радиус кольца до середины прутка. */
  readonly radius: number;
  /** Радиус прутка. */
  readonly tube: number;
  /** Щит как параллелепипед. */
  readonly board: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** Опора кольца. */
  readonly pole: { x: number; z: number; radius: number; top: number };
}

export interface CourtResult {
  readonly group: THREE.Group;
  /** Точка кольца (совместимость с задачей 4). */
  readonly hoop: THREE.Vector3;
  readonly geometry: HoopGeometry;
  /** Верх плиты площадки — по нему прыгает мяч. */
  readonly slabTopY: number;
  /** Границы плиты в плане. */
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Кольцо и сетка — их анимирует миссия при голе. */
  readonly rim: THREE.Mesh;
  readonly net: THREE.Mesh;
}

export function buildCourt(materials: IslandMaterials, collisions: CollisionWorld): CourtResult {
  const group = new THREE.Group();
  group.name = 'court';
  const top = TERRACE.deckTopY;
  const { centerX, centerZ, length, width } = COURT;
  const slabTopY = top + 0.12;

  // Площадка
  const slab = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, width), materials.court);
  slab.position.set(centerX, top + 0.06, centerZ);
  slab.receiveShadow = true;
  slab.name = 'court-slab';
  group.add(slab);

  // Гравийный подъезд от проёма в западном заборе до площадки
  const apronLength = Math.abs(centerX - PLOT.fenceMinX) - length / 2;
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.5, apronLength + 1.2), 3.4).rotateX(-Math.PI / 2), materials.gravel);
  apron.position.set((PLOT.fenceMinX + centerX - length / 2) / 2, top + 0.03, centerZ);
  apron.receiveShadow = true;
  group.add(apron);

  // Опора кольца
  const hoopX = centerX - length / 2 + 0.7;
  const poleMaterial = materials.metal;
  collisions.addCircle(hoopX, centerZ, 0.3, top + 3.35);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.35, 12), poleMaterial);
  pole.position.set(hoopX, top + 1.67, centerZ);
  pole.castShadow = true;
  group.add(pole);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.1), poleMaterial);
  arm.position.set(hoopX + 0.5, top + 3.2, centerZ);
  arm.castShadow = true;
  group.add(arm);

  const board = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 1.82), materials.white);
  board.position.set(hoopX + 0.95, top + 2.85, centerZ);
  board.castShadow = true;
  group.add(board);
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.6), materials.terracotta);
  boardFrame.position.set(hoopX + 1.0, top + 2.62, centerZ);
  group.add(boardFrame);

  const rimX = hoopX + 1.16;
  const rimY = top + 3.05;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.026, 10, 32), materials.terracotta);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(rimX, rimY, centerZ);
  rim.castShadow = true;
  rim.name = 'court-rim';
  group.add(rim);

  // Сетка: конус из проволоки, висит под кольцом
  const netGeometry = new THREE.CylinderGeometry(0.235, 0.15, 0.42, 24, 4, true);
  const net = new THREE.Mesh(
    netGeometry,
    new THREE.MeshStandardMaterial({
      color: 0xf2f0e6,
      roughness: 0.9,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  net.position.set(rimX, rimY - 0.21, centerZ);
  net.name = 'court-net';
  group.add(net);

  return {
    group,
    hoop: new THREE.Vector3(rimX, rimY + 0.15, centerZ),
    geometry: {
      center: new THREE.Vector3(rimX, rimY, centerZ),
      radius: 0.24,
      tube: 0.026,
      board: {
        minX: hoopX + 0.91,
        maxX: hoopX + 0.99,
        minY: top + 2.325,
        maxY: top + 3.375,
        minZ: centerZ - 0.91,
        maxZ: centerZ + 0.91,
      },
      pole: { x: hoopX, z: centerZ, radius: 0.12, top: top + 3.35 },
    },
    slabTopY,
    bounds: {
      minX: centerX - length / 2,
      maxX: centerX + length / 2,
      minZ: centerZ - width / 2,
      maxZ: centerZ + width / 2,
    },
    rim,
    net,
  };
}
