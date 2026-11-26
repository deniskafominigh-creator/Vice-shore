import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ISLAND, STADIUM, TOWN } from '../../core/Config';
import type { IslandMaterials } from './IslandTextures';
import type { CollisionWorld } from '../Colliders';

/** Стадион в конце улицы (задача 16).
 *
 *  Состав: площадь перед входом с кассами и турникетами, чаша с открытым небом,
 *  пять рядов сидений по всем сторонам (934 места — один InstancedMesh на цвет),
 *  табло с настоящим счётом, двое ворот с сеткой и футбольный мяч в центре.
 *
 *  Зрителей нет намеренно: заказчик просил не ставить никого, «а то можно сделать
 *  только хуже». Места пустые и ждут будущих NPC.
 *
 *  Геометрия статичная, кроме табло (у него живая текстура) и мяча (им владеет
 *  `Football`). Всё остальное склеивается `mergeStaticMeshes` в Island. */

const GROUND = ISLAND.plateauTopY;
/** Насколько основания уходят под землю: копланарные грани дают мерцание. */
const SINK = 0.15;

export interface StadiumScoreboard {
  /** Перерисовать табло: счёт и подпись. */
  setScore(home: number, away: number): void;
  readonly mesh: THREE.Mesh;
}

export interface StadiumResult {
  readonly group: THREE.Group;
  readonly scoreboard: StadiumScoreboard;
  /** Центр поля — там мяч после гола и в начале. */
  readonly ballStart: THREE.Vector3;
  /** Линия ворот по X, проём по Z: западные (−) и восточные (+). */
  readonly goalLines: { readonly west: number; readonly east: number };
  /** Половина проёма ворот по Z (для определения гола). */
  readonly goalHalfWidth: number;
  readonly goalHeight: number;
  /** Прямоугольник чаши: сюда не сеются трава, пальмы и садовая мелочь. */
  readonly footprint: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /** Все мощения стадиона (чаша, площадь, аллея) — трава там не растёт. */
  readonly clearings: ReadonlyArray<{ readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }>;
  dispose(): void;
}

/** Тёмный экран табло: рисуем счёт на canvas и держим текстуру живой. */
function createScoreboardTexture(): { texture: THREE.CanvasTexture; draw: (home: number, away: number) => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const draw = (home: number, away: number): void => {
    if (!context) return;
    context.fillStyle = '#061118';
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Рамка
    context.strokeStyle = '#ffb02e';
    context.lineWidth = 6;
    context.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    context.fillStyle = '#ffb02e';
    context.font = '600 34px Oswald, Arial Narrow, sans-serif';
    context.textAlign = 'center';
    context.fillText('VICE  SHORE  ARENA', canvas.width / 2, 56);

    context.fillStyle = '#f2f6f8';
    context.font = '700 92px Oswald, Arial Narrow, sans-serif';
    const text = `${home} : ${away}`;
    context.fillText(text, canvas.width / 2, 156);
    texture.needsUpdate = true;
  };

  draw(0, 0);
  return { texture, draw };
}

/** Разметка поля одной текстурой: полосы газона, круг, штрафные, ворота. */
function createPitchTexture(width: number, depth: number): { texture: THREE.CanvasTexture; dispose(): void } {
  const scale = 24; // пикселей на метр
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(depth * scale);
  const context = canvas.getContext('2d');
  if (context) {
    const { width: w, height: h } = canvas;
    // Полосы газона
    const stripes = 10;
    for (let i = 0; i < stripes; i += 1) {
      context.fillStyle = i % 2 === 0 ? '#3f8f45' : '#398340';
      context.fillRect((w / stripes) * i, 0, Math.ceil(w / stripes), h);
    }
    context.strokeStyle = 'rgba(242,246,248,0.92)';
    context.lineWidth = scale * 0.12;
    // Кромка поля
    const margin = scale * 1.6;
    context.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
    // Средняя линия и круг
    context.beginPath();
    context.moveTo(w / 2, margin);
    context.lineTo(w / 2, h - margin);
    context.stroke();
    context.beginPath();
    context.arc(w / 2, h / 2, scale * 3, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(w / 2, h / 2, scale * 0.25, 0, Math.PI * 2);
    context.fillStyle = 'rgba(242,246,248,0.92)';
    context.fill();
    // Штрафные площади
    const penaltyW = scale * 5.5;
    const penaltyH = h * 0.52;
    context.strokeRect(margin, (h - penaltyH) / 2, penaltyW, penaltyH);
    context.strokeRect(w - margin - penaltyW, (h - penaltyH) / 2, penaltyW, penaltyH);
    // Вратарские
    const boxW = scale * 2.4;
    const boxH = h * 0.26;
    context.strokeRect(margin, (h - boxH) / 2, boxW, boxH);
    context.strokeRect(w - margin - boxW, (h - boxH) / 2, boxW, boxH);
    // Точки пенальти
    for (const x of [margin + scale * 3.6, w - margin - scale * 3.6]) {
      context.beginPath();
      context.arc(x, h / 2, scale * 0.22, 0, Math.PI * 2);
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return {
    texture,
    dispose: () => texture.dispose(),
  };
}

/** Сетка ворот: прозрачная текстура с ячейками, чтобы ворота читались на просвет. */
function createNetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 128, 128);
    context.strokeStyle = 'rgba(242,246,248,0.75)';
    context.lineWidth = 2;
    for (let i = 0; i <= 128; i += 16) {
      context.beginPath();
      context.moveTo(i, 0);
      context.lineTo(i, 128);
      context.stroke();
      context.beginPath();
      context.moveTo(0, i);
      context.lineTo(128, i);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 2);
  return texture;
}

/** Табличка с надписью: «БИЛЕТЫ», «ВХОД». Без неё вход читается как дыра в бетоне. */
function createSignTexture(text: string, background: string, ink: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = ink;
    context.font = 'bold 34px "Arial Narrow", Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Кресло трибуны: подушка, наклонная спинка, две боковины. Одна геометрия на все
 *  места — дальше это InstancedMesh, поэтому детализация стоит один draw call. */
function buildSeatGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const pan = new THREE.BoxGeometry(0.44, 0.07, 0.4);
  pan.translate(0, 0.06, 0.03);
  parts.push(pan);

  const back = new THREE.BoxGeometry(0.44, 0.44, 0.06);
  back.rotateX(-0.13);
  back.translate(0, 0.29, -0.19);
  parts.push(back);

  for (const sx of [-1, 1] as const) {
    const cheek = new THREE.BoxGeometry(0.05, 0.1, 0.36);
    cheek.translate(sx * 0.215, 0.035, 0.02);
    parts.push(cheek);
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged ?? new THREE.BoxGeometry(0.44, 0.1, 0.4);
}

export function buildStadium(materials: IslandMaterials, collisions: CollisionWorld): StadiumResult {
  const group = new THREE.Group();
  group.name = 'stadium';

  const { centerX, centerZ } = STADIUM;
  const halfW = STADIUM.width / 2;
  const halfD = STADIUM.depth / 2;
  const halfPitchX = STADIUM.pitchWidth / 2;
  const halfPitchZ = STADIUM.pitchDepth / 2;
  const standDepth = STADIUM.rows * STADIUM.rowDepth;
  const standTop = GROUND + STADIUM.rows * STADIUM.rowRise;
  const seatTop = STADIUM.rows * STADIUM.rowRise;

  let meshCount = 0;
  const disposables: Array<{ dispose(): void }> = [];

  const box = (
    material: THREE.Material,
    size: [number, number, number],
    position: [number, number, number],
    rotationY = 0,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshCount += 1;
    group.add(mesh);
    return mesh;
  };

  // ——— материалы стадиона ————————————————————————————————————————
  const pitch = createPitchTexture(STADIUM.pitchWidth, STADIUM.pitchDepth);
  disposables.push({ dispose: () => pitch.dispose() });
  const pitchMaterial = new THREE.MeshStandardMaterial({ map: pitch.texture, roughness: 0.95, metalness: 0 });
  pitchMaterial.name = 'stadium-pitch';
  disposables.push(pitchMaterial);

  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.9, metalness: 0.02 });
  concrete.name = 'stadium-concrete';
  const seatHome = new THREE.MeshStandardMaterial({ color: 0xc2503a, roughness: 0.7 });
  seatHome.name = 'stadium-seat-home';
  const seatAway = new THREE.MeshStandardMaterial({ color: 0x2f6f9c, roughness: 0.7 });
  seatAway.name = 'stadium-seat-away';
  const seatEmpty = new THREE.MeshStandardMaterial({ color: 0xdcd6c6, roughness: 0.8 });
  seatEmpty.name = 'stadium-seat-empty';
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f6f8, roughness: 0.6 });
  lineMat.name = 'stadium-line';
  disposables.push(concrete, seatHome, seatAway, seatEmpty, lineMat);

  // ——— газон с разметкой ———
  const pitchMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(STADIUM.pitchWidth, STADIUM.pitchDepth),
    pitchMaterial,
  );
  pitchMesh.rotation.x = -Math.PI / 2;
  pitchMesh.position.set(centerX, GROUND + 0.05, centerZ);
  pitchMesh.receiveShadow = true;
  pitchMesh.name = 'stadium-pitch-surface';
  group.add(pitchMesh);

  // Кромка вокруг поля — утоптанный грунт/бетон
  const apron = STADIUM.concourse + standDepth;
  box(
    concrete,
    [STADIUM.pitchWidth + apron * 2 - 0.3, 0.06, STADIUM.pitchDepth + apron * 2 - 0.3],
    [centerX, GROUND, centerZ],
  );

  // ——— трибуны: четыре стороны, пять рядов ———
  /** Вход в чашу — с востока, сквозь восточную трибуну: в ней оставлен проход. */
  const GATE_WIDTH = 8;
  /** Отрезки вдоль оси трибуны (середина и длина) — у восточной их два. */
  const sideSegments = (side: 'north' | 'south' | 'east' | 'west'): Array<{ center: number; length: number }> => {
    const full = side === 'north' || side === 'south'
      ? STADIUM.pitchWidth + 2 * (STADIUM.concourse + standDepth)
      : STADIUM.depth - 2 * (STADIUM.concourse + standDepth);
    if (side !== 'east') return [{ center: 0, length: full }];
    const half = (full - GATE_WIDTH) / 2;
    return [
      { center: -(GATE_WIDTH / 2 + half / 2), length: half },
      { center: GATE_WIDTH / 2 + half / 2, length: half },
    ];
  };

  /** Одна сторона чаши: ступени из бетона на каждом ряду. */
  const buildStandSide = (side: 'north' | 'south' | 'east' | 'west'): void => {
    const alongX = side === 'north' || side === 'south';
    const sign = side === 'north' || side === 'east' ? -1 : 1;
    const inner = (alongX ? halfPitchZ : halfPitchX) + STADIUM.concourse;

    for (const segment of sideSegments(side)) {
      for (let row = 0; row < STADIUM.rows; row += 1) {
        const offset = inner + row * STADIUM.rowDepth + STADIUM.rowDepth / 2;
        const height = (row + 1) * STADIUM.rowRise;
        const sunk = height + SINK;
        if (alongX) {
          box(
            concrete,
            [segment.length, sunk, STADIUM.rowDepth],
            [centerX + segment.center, GROUND - SINK + sunk / 2, centerZ - sign * offset],
          );
        } else {
          box(
            concrete,
            [STADIUM.rowDepth, sunk, segment.length],
            [centerX - sign * offset, GROUND - SINK + sunk / 2, centerZ + segment.center],
          );
        }
      }
    }
  };

  buildStandSide('north');
  buildStandSide('south');
  buildStandSide('west');
  buildStandSide('east');

  // ——— сиденья: три InstancedMesh по цветам ———
  // Кресло собрано из пяти деталей: подушка, спинка с наклоном, две боковины
  // и опора. Раньше это была одна плоская плитка — на трибуне читался «частокол».
  const seatGeometry = buildSeatGeometry();
  const seatLegGeometry = new THREE.BoxGeometry(0.06, 0.34, 0.06);
  const seatPlacements: Array<{ x: number; y: number; z: number; rotY: number; color: 'home' | 'away' | 'empty' }> = [];

  const placeSeats = (side: 'north' | 'south' | 'east' | 'west'): void => {
    const alongX = side === 'north' || side === 'south';
    const sign = side === 'north' || side === 'east' ? -1 : 1;
    const inner = (alongX ? halfPitchZ : halfPitchX) + STADIUM.concourse;
    const step = 0.55;
    for (const segment of sideSegments(side)) {
      const span = segment.length;
      const count = Math.max(2, Math.floor((span - 1.2) / step));
      const base = segment.center - span / 2;

    for (let row = 0; row < STADIUM.rows; row += 1) {
      const offset = inner + row * STADIUM.rowDepth + STADIUM.rowDepth / 2;
      const height = (row + 1) * STADIUM.rowRise;
      for (let i = 0; i < count; i += 1) {
        const t = (i + 0.5) / count;
        const along = base + span * t;
        // Разные цвета по секторам: дома — терракота, гости — синий, служебные — белые.
        const sector = row === 0 ? 'empty' : i % 11 === 5 ? 'away' : 'home';
        // Кресло смотрит на поле: спинка всегда со стороны трибуны, не поля.
        if (alongX) {
          seatPlacements.push({
            x: centerX + along,
            y: GROUND + height + 0.02,
            z: centerZ - sign * offset,
            rotY: side === 'north' ? Math.PI : 0,
            color: sector,
          });
        } else {
          seatPlacements.push({
            x: centerX - sign * offset,
            y: GROUND + height + 0.02,
            z: centerZ + along,
            rotY: side === 'west' ? Math.PI / 2 : -Math.PI / 2,
            color: sector,
          });
        }
      }
    }
    }
  };

  placeSeats('north');
  placeSeats('south');
  placeSeats('east');
  placeSeats('west');

  const seatGroups: Record<'home' | 'away' | 'empty', THREE.Matrix4[]> = { home: [], away: [], empty: [] };
  const dummy = new THREE.Object3D();
  const legMatrix = new THREE.Matrix4();
  const legInstances: THREE.Matrix4[] = [];
  for (const seat of seatPlacements) {
    dummy.position.set(seat.x, seat.y, seat.z);
    dummy.rotation.set(0, seat.rotY, 0);
    dummy.updateMatrix();
    seatGroups[seat.color].push(dummy.matrix.clone());

    dummy.position.set(seat.x, seat.y - 0.17, seat.z);
    dummy.updateMatrix();
    legMatrix.copy(dummy.matrix);
    legInstances.push(legMatrix.clone());
  }

  const addInstanced = (geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], name: string): void => {
    if (matrices.length === 0) {
      geometry.dispose();
      return;
    }
    const instanced = new THREE.InstancedMesh(geometry, material, matrices.length);
    instanced.name = name;
    matrices.forEach((matrix, index) => instanced.setMatrixAt(index, matrix));
    instanced.instanceMatrix.needsUpdate = true;
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    instanced.frustumCulled = false;
    group.add(instanced);
    meshCount += 1;
  };

  addInstanced(seatGeometry, seatHome, seatGroups.home, 'stadium-seats-home');
  addInstanced(seatGeometry, seatAway, seatGroups.away, 'stadium-seats-away');
  addInstanced(seatGeometry, seatEmpty, seatGroups.empty, 'stadium-seats-empty');
  addInstanced(seatLegGeometry, concrete, legInstances, 'stadium-seat-legs');

  // ——— внешние стены чаши: у восточной разрыв на вход ———
  const wallHeight = (standTop - GROUND + 0.4) + SINK;
  const wallY = GROUND - SINK + wallHeight / 2;
  const wallPush = 0.03;
  // Северная и южная стены чуть выше торцевых — иначе на углах совпадают
  // верхние грани и появляется мерцание.
  const longWallHeight = wallHeight + 0.04;
  const longWallY = GROUND - SINK + longWallHeight / 2;
  box(concrete, [STADIUM.width + 0.12, longWallHeight, 0.42], [centerX, longWallY, centerZ - halfD - wallPush]);
  box(concrete, [STADIUM.width + 0.12, longWallHeight, 0.42], [centerX, longWallY, centerZ + halfD + wallPush]);
  box(concrete, [0.42, wallHeight, STADIUM.depth + 0.12], [centerX - halfW - wallPush, wallY, centerZ]);
  for (const segment of sideSegments('east')) {
    box(concrete, [0.42, wallHeight, segment.length - 0.08], [centerX + halfW + wallPush, wallY, centerZ + segment.center]);
  }
  // Створки ворот на входе — по краю прохода стоят столбы
  for (const dz of [-GATE_WIDTH / 2, GATE_WIDTH / 2] as const) {
    box(materials.metal, [0.5, 2.6 + SINK, 0.5], [centerX + halfW, GROUND - SINK + (2.6 + SINK) / 2, centerZ + dz]);
  }
  box(materials.metal, [0.7, 0.25, GATE_WIDTH + 1], [centerX + halfW, GROUND + 2.7, centerZ]);

  // ——— ворота ———
  const netTexture = createNetTexture();
  disposables.push({ dispose: () => netTexture.dispose() });
  const netMaterial = new THREE.MeshStandardMaterial({
    map: netTexture,
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 0.9,
    depthWrite: false,
  });
  netMaterial.name = 'stadium-net';
  disposables.push(netMaterial);

  const postMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f6f8, roughness: 0.45, metalness: 0.1 });
  postMaterial.name = 'stadium-post';
  disposables.push(postMaterial);

  const goalHalf = STADIUM.goalWidth / 2;
  const goalH = STADIUM.goalHeight;
  const goalDepth = STADIUM.goalDepth;
  const postR = 0.07;

  const buildGoal = (side: -1 | 1): void => {
    const lineX = centerX + side * halfPitchX;
    // Стойки
    for (const dz of [-goalHalf, goalHalf] as const) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, goalH, 10), postMaterial);
      post.position.set(lineX, GROUND + goalH / 2, centerZ + dz);
      post.castShadow = true;
      group.add(post);
      meshCount += 1;
    }
    // Перекладина
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, STADIUM.goalWidth, 10), postMaterial);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(lineX, GROUND + goalH, centerZ);
    bar.castShadow = true;
    group.add(bar);
    meshCount += 1;

    // Сетка: задняя стенка, две боковые и верх
    const back = new THREE.Mesh(new THREE.PlaneGeometry(STADIUM.goalWidth, goalH), netMaterial);
    back.position.set(lineX + side * goalDepth, GROUND + goalH / 2, centerZ);
    back.rotation.y = Math.PI / 2;
    group.add(back);
    meshCount += 1;

    for (const dz of [-goalHalf, goalHalf] as const) {
      const netSide = new THREE.Mesh(new THREE.PlaneGeometry(goalDepth, goalH), netMaterial);
      netSide.position.set(lineX + side * goalDepth / 2, GROUND + goalH / 2, centerZ + dz);
      group.add(netSide);
      meshCount += 1;
    }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(goalDepth, STADIUM.goalWidth), netMaterial);
    top.rotation.x = Math.PI / 2;
    top.position.set(lineX + side * goalDepth / 2, GROUND + goalH, centerZ);
    group.add(top);
    meshCount += 1;
  };

  buildGoal(-1);
  buildGoal(1);

  // ——— табло над северной трибуной ———
  const board = createScoreboardTexture();
  disposables.push({ dispose: () => board.texture.dispose() });
  const boardMaterial = new THREE.MeshStandardMaterial({
    map: board.texture,
    emissive: 0xffffff,
    emissiveMap: board.texture,
    emissiveIntensity: 0.55,
    roughness: 0.6,
  });
  boardMaterial.name = 'stadium-scoreboard';
  disposables.push(boardMaterial);

  // Мачты стоят на верхнем ряду северной трибуны — табло не парит в воздухе.
  const boardFoot = GROUND + seatTop;
  const boardZ = centerZ - halfD + 1.2;
  for (const dx of [-3.8, 3.8] as const) {
    box(materials.metal, [0.22, 6.0, 0.22], [centerX + dx, boardFoot + 3.0, boardZ]);
  }
  // Экран висит в верхней части мачт: 6,0 м от верхнего ряда минус половина корпуса.
  box(materials.screenDark, [8.4, 3.3, 0.28], [centerX, boardFoot + 4.0, boardZ]);

  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), boardMaterial);
  boardMesh.position.set(centerX, boardFoot + 4.0, boardZ + 0.16);
  boardMesh.name = 'stadium-scoreboard-face';
  group.add(boardMesh);
  meshCount += 1;

  // ——— прожекторы: мачты по внешним углам чаши, а не посреди сидений ———
  const floodlights: Array<[number, number]> = [];
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const x = centerX + sx * (halfW + 0.9);
      const z = centerZ + sz * (halfD + 0.9);
      floodlights.push([x, z]);
      box(materials.metal, [0.24, 9 + SINK, 0.24], [x, GROUND - SINK + (9 + SINK) / 2, z]);
      box(materials.metal, [2.0, 0.18, 0.3], [x, GROUND + 9.1, z]);
      box(materials.white, [1.8, 0.5, 0.16], [x, GROUND + 8.8, z]);
    }
  }

  // ——— площадь перед входом, кассы, турникеты ———
  const plazaMinX = centerX + halfW;
  const plazaMaxX = plazaMinX + STADIUM.plazaWidth;
  const plazaMinZ = centerZ - STADIUM.plazaDepth / 2;
  const plazaMaxZ = centerZ + STADIUM.plazaDepth / 2;
  const plazaX = (plazaMinX + plazaMaxX) / 2;
  box(materials.gravel, [STADIUM.plazaWidth, 0.08, STADIUM.plazaDepth], [plazaX, GROUND + 0.03, centerZ]);

  // Касса: стойка с тремя окнами вдоль северного края площади
  const boothZ = plazaMinZ + 0.5;
  box(materials.white, [6.2, 2.9 + SINK, 0.4], [plazaX, GROUND - SINK + (2.9 + SINK) / 2, boothZ]);
  box(materials.trim, [6.9, 0.18, 1.7], [plazaX, GROUND + 3.0, boothZ + 0.7]);
  for (const dx of [-2, 0, 2] as const) {
    box(materials.screenDark, [1.2, 0.95, 0.1], [plazaX + dx, GROUND + 1.75, boothZ + 0.22]);
    box(materials.brass, [1.35, 0.07, 0.45], [plazaX + dx, GROUND + 1.15, boothZ + 0.45]);
  }
  const ticketSign = createSignTexture('БИЛЕТЫ', '#f2f6f8', '#0b1a22');
  disposables.push({ dispose: () => ticketSign.dispose() });
  const ticketMaterial = new THREE.MeshStandardMaterial({
    map: ticketSign,
    emissive: 0xffffff,
    emissiveMap: ticketSign,
    emissiveIntensity: 0.35,
    roughness: 0.7,
  });
  ticketMaterial.name = 'stadium-ticket-sign';
  disposables.push(ticketMaterial);
  const ticketBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), ticketMaterial);
  ticketBoard.position.set(plazaX, GROUND + 3.55, boothZ + 0.1);
  ticketBoard.name = 'stadium-ticket-sign-face';
  group.add(ticketBoard);
  meshCount += 1;

  // Табличка «ВХОД» над проходом в чашу
  const gateSignTexture = createSignTexture('ВХОД', '#ffb02e', '#12232c');
  disposables.push({ dispose: () => gateSignTexture.dispose() });
  const gateSignMaterial = new THREE.MeshStandardMaterial({
    map: gateSignTexture,
    emissive: 0xffffff,
    emissiveMap: gateSignTexture,
    emissiveIntensity: 0.3,
    roughness: 0.7,
  });
  gateSignMaterial.name = 'stadium-gate-sign';
  disposables.push(gateSignMaterial);
  const gateSign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), gateSignMaterial);
  gateSign.position.set(centerX + halfW + 1.4, GROUND + 3.35, centerZ);
  gateSign.rotation.y = Math.PI / 2;
  gateSign.name = 'stadium-gate-sign-face';
  group.add(gateSign);
  meshCount += 1;

  // Турникеты: три прохода в проёме восточной трибуны
  const gateX = centerX + halfW;
  /** Турникеты: три прохода. Между тумбами 1,14 м — герой (Ø0,68) проходит,
   *  всё остальное в проёме зашито металлом: мимо турникетов не пройти. */
  const TURNSTILE_DZ = [-2.6, 0, 2.6] as const;
  const POST_OFFSET = 0.95;
  const POST = 0.42;
  /** Тумбы с номером турникета: проход между тумбами одной пары зашивать нельзя. */
  const posts: Array<{ z: number; turnstile: number }> = [];
  TURNSTILE_DZ.forEach((dz, turnstile) => {
    const z = centerZ + dz;
    for (const side of [-1, 1] as const) {
      posts.push({ z: z + side * POST_OFFSET, turnstile });
      box(
        materials.metal,
        [POST, 1.05 + SINK, POST],
        [gateX, GROUND - SINK + (1.05 + SINK) / 2, z + side * POST_OFFSET],
      );
    }
    // Три рычага на оси: настоящая «вертушка», а не три крест-накрест
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2;
      const armLength = 0.7;
      box(
        materials.brass,
        [armLength, 0.05, 0.05],
        [gateX + Math.cos(angle) * armLength / 2, GROUND + 1.0, z + Math.sin(angle) * armLength / 2],
        -angle,
      );
    }
    box(materials.metal, [0.1, 1.0, 0.1], [gateX, GROUND + 1.0, z]);
  });

  // Зашивка между тумбами СОСЕДНИХ турникетов и по краям проёма:
  // проход внутри пары тумб остаётся открытым — это и есть турникет.
  const seams: Array<[number, number]> = [];
  const sorted = [...posts].sort((a, b) => a.z - b.z);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (sorted[i].turnstile === sorted[i + 1].turnstile) continue;
    const a = sorted[i].z + POST / 2;
    const b = sorted[i + 1].z - POST / 2;
    if (b - a > 0.02) seams.push([a, b]);
  }
  // Края: от внешней тумбы до торца стены
  seams.push([sorted[sorted.length - 1].z + POST / 2, centerZ + GATE_WIDTH / 2]);
  seams.push([centerZ - GATE_WIDTH / 2, sorted[0].z - POST / 2]);
  for (const [a, b] of seams) {
    const width = b - a;
    if (width <= 0.01) continue;
    box(
      materials.metal,
      [0.3, 0.95 + SINK, width],
      [gateX, GROUND - SINK + (0.95 + SINK) / 2, (a + b) / 2],
    );
    collisions.addBox(gateX - 0.15, gateX + 0.15, a, b, GROUND + 1.0);
  }

  // Навес над турникетами: вход читается как вход, а не как дыра в стене
  box(materials.metal, [0.22, 1.9 + SINK, 0.22], [gateX + 1.9, GROUND - SINK + (1.9 + SINK) / 2, centerZ - GATE_WIDTH / 2 + 0.3]);
  box(materials.metal, [0.22, 1.9 + SINK, 0.22], [gateX + 1.9, GROUND - SINK + (1.9 + SINK) / 2, centerZ + GATE_WIDTH / 2 - 0.3]);
  box(materials.trim, [2.6, 0.14, GATE_WIDTH - 0.2], [gateX + 0.9, GROUND + 3.3, centerZ]);
  box(materials.trim, [2.7, 0.1, GATE_WIDTH - 0.1], [gateX + 0.95, GROUND + 3.42, centerZ]);

  // ——— подъездная аллея: улица заканчивается у ворот стадиона ———
  const driveX = STADIUM.driveX;
  const driveHalf = STADIUM.driveWidth / 2;
  const driveStart = TOWN.streetZ + 1;
  const driveEnd = plazaMaxZ - 1.2;
  box(
    materials.gravel,
    [STADIUM.driveWidth, 0.07, driveStart - driveEnd],
    [driveX, GROUND + 0.02, (driveStart + driveEnd) / 2],
  );
  // Соединение с улицей: короткий «рукав» от конца дороги к аллее
  const joinFrom = 57;
  const joinTo = driveX + driveHalf - 0.5;
  box(
    materials.gravel,
    [joinTo - joinFrom, 0.06, 5.2],
    [(joinFrom + joinTo) / 2, GROUND + 0.012, TOWN.streetZ],
  );
  // Бордюр аллеи — чтобы читалась как дорога, а не как газон
  for (const side of [-1, 1] as const) {
    box(
      materials.stone,
      [0.28, 0.16 + SINK, driveStart - driveEnd],
      [driveX + side * (driveHalf + 0.14), GROUND - SINK + (0.16 + SINK) / 2, (driveStart + driveEnd) / 2],
    );
  }

  // ——— коллизии ————————————————————————————————————————————————
  // Трибуны по четырём сторонам: в них нельзя зайти, но к первому ряду подойти можно.
  const standTopY = GROUND + seatTop + 1.6;
  const wallTopY = GROUND + (standTop - GROUND) + 0.5;
  collisions.addBox(
    centerX - halfPitchX - STADIUM.concourse - standDepth,
    centerX + halfPitchX + STADIUM.concourse + standDepth,
    centerZ - halfPitchZ - STADIUM.concourse - standDepth,
    centerZ - halfPitchZ - STADIUM.concourse,
    standTopY,
  );
  collisions.addBox(
    centerX - halfPitchX - STADIUM.concourse - standDepth,
    centerX + halfPitchX + STADIUM.concourse + standDepth,
    centerZ + halfPitchZ + STADIUM.concourse,
    centerZ + halfPitchZ + STADIUM.concourse + standDepth,
    standTopY,
  );
  collisions.addBox(
    centerX - halfPitchX - STADIUM.concourse - standDepth,
    centerX - halfPitchX - STADIUM.concourse,
    centerZ - halfPitchZ - STADIUM.concourse,
    centerZ + halfPitchZ + STADIUM.concourse,
    standTopY,
  );
  // Восточная трибуна разорвана проходом посередине — две коллизии вместо одной.
  const eastInner = centerX + halfPitchX + STADIUM.concourse;
  for (const segment of sideSegments('east')) {
    collisions.addBox(
      eastInner,
      eastInner + standDepth,
      centerZ + segment.center - segment.length / 2,
      centerZ + segment.center + segment.length / 2,
      standTopY,
    );
  }

  // Стены чаши и касса — чтобы нельзя было выйти наружу сквозь бетон.
  const wallThickness = 0.5;
  collisions.addBox(centerX - halfW, centerX + halfW, centerZ - halfD, centerZ - halfD + wallThickness, wallTopY);
  collisions.addBox(centerX - halfW, centerX + halfW, centerZ + halfD - wallThickness, centerZ + halfD, wallTopY);
  collisions.addBox(centerX - halfW, centerX - halfW + wallThickness, centerZ - halfD, centerZ + halfD, wallTopY);
  for (const segment of sideSegments('east')) {
    collisions.addBox(
      centerX + halfW - wallThickness,
      centerX + halfW,
      centerZ + segment.center - segment.length / 2,
      centerZ + segment.center + segment.length / 2,
      wallTopY,
    );
  }
  // Мачты прожекторов: коллизии по видимому столбу
  for (const [x, z] of floodlights) collisions.addCircle(x, z, 0.2, GROUND + 9);

  // Касса: стойка вдоль северного края площади
  collisions.addBox(plazaX - 3.1, plazaX + 3.1, boothZ - 0.25, boothZ + 0.25, GROUND + 3.0);
  // Турникеты: тумбы по краям проходов. Проход внутри пары тумб — 1,14 м,
  // между соседними турникетами — 0,24 м, туда герой не пролезет и не должен.
  for (const dz of TURNSTILE_DZ) {
    const z = centerZ + dz;
    for (const side of [-1, 1] as const) {
      const postZ = z + side * POST_OFFSET;
      collisions.addBox(gateX - 0.21, gateX + 0.21, postZ - 0.21, postZ + 0.21, GROUND + 1.2);
    }
  }

  return {
    group,
    scoreboard: {
      mesh: boardMesh,
      setScore: (home: number, away: number) => board.draw(home, away),
    },
    ballStart: new THREE.Vector3(centerX, GROUND + STADIUM.ballRadius, centerZ),
    goalLines: { west: centerX - halfPitchX, east: centerX + halfPitchX },
    goalHalfWidth: goalHalf,
    goalHeight: goalH,
    footprint: {
      minX: centerX - halfW - 1,
      maxX: plazaMaxX + 1,
      minZ: centerZ - halfD - 1,
      maxZ: centerZ + halfD + 1,
    },
    clearings: [
      // чаша вместе с площадью: южная граница — стена чаши, а не площадь.
      // Раньше здесь стоял plazaMaxZ, и трава сеялась по южной трибуне и краю поля.
      { minX: centerX - halfW - 1, maxX: plazaMaxX + 1, minZ: centerZ - halfD - 1, maxZ: centerZ + halfD + 1 },
      // аллея от улицы к площади
      { minX: driveX - driveHalf - 0.4, maxX: driveX + driveHalf + 0.4, minZ: driveEnd, maxZ: driveStart },
      // рукав, которым улица заканчивается у аллеи
      { minX: joinFrom - 1, maxX: joinTo + 1, minZ: TOWN.streetZ - 3, maxZ: TOWN.streetZ + 3 },
    ],
    dispose(): void {
      for (const item of disposables) item.dispose();
      seatGeometry.dispose();
      seatLegGeometry.dispose();
      void meshCount;
    },
  };
}
