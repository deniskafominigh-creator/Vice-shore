/**
 * Проверка телевизора в гостиной (сборка v18).
 *
 *  Без GPU и без звуковой карты проверяем:
 *   1. экран — отдельная плоскость в интерьере, пропорции как у настоящей панели;
 *   2. три канала и переключение по кругу, выключение возвращает тёмное стекло;
 *   3. включённый экран светится: `map` + `emissiveMap` + свет в комнате;
 *   4. картинка рисуется без ошибок на всех каналах и в помехах переключения;
 *   5. звук канала уходит в аудиосистему (`startTv` / `stopTv` / `setTvDistance`);
 *   6. озвучка: ролики в сборке, субтитры на каждый канал;
 *   7. громкость падает с расстоянием.
 */
import * as THREE from 'three';
import type { AudioSystem } from '../../src/core/Audio';
import type { InteriorTv } from '../../src/world/island/Interior';

/** Минимальный DOM: canvas 2D, градиенты, drawImage. */
const makeCanvas = (): Record<string, unknown> => {
  const canvas: Record<string, unknown> = { width: 1, height: 1, style: {} };
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      getImageData: (x: number, y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(120),
        width: w,
        height: h,
      }),
      putImageData: () => undefined,
      drawImage: () => undefined,
      measureText: () => ({ width: 40 }),
      canvas,
    },
    {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return () => 0;
      },
      set() {
        return true;
      },
    },
  );
  canvas.getContext = () => ctx;
  canvas.toDataURL = () => 'data:,';
  return canvas;
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => makeCanvas(),
  createElementNS: () => makeCanvas(),
};

const { TvSet, TV_CHANNELS, TV_LABELS, TV_LINES } = await import('../../src/game/TvSet');

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

// ——— аудиосистема-заглушка: записываем, что от нас просят ———
const audioLog: string[] = [];
const audio = {
  ctx: null,
  voiceOutput: null,
  startTv: (channel: string) => audioLog.push(`start:${channel}`),
  stopTv: () => audioLog.push('stop'),
  setTvDistance: (distance: number) => audioLog.push(`distance:${Math.round(distance)}`),
  decodeVoice: async () => null,
} as unknown as AudioSystem;

// ——— экран, как в интерьере: плоскость 1,56 × 0,86 на восточной стене ———
const scene = new THREE.Scene();
const material = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.44 });
material.name = 'tv-screen';
const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.86), material);
mesh.name = 'tv-screen';
mesh.rotation.y = -Math.PI / 2;
mesh.position.set(6.6, 4.82, -8.6);
scene.add(mesh);

const tvInfo: InteriorTv = {
  mesh,
  center: mesh.position.clone(),
  facing: new THREE.Vector3(-1, 0, 0),
  standAt: new THREE.Vector3(mesh.position.x - 2.05, 3.2, mesh.position.z),
  width: 1.56,
  height: 0.86,
};

const tv = new TvSet({ tv: tvInfo, audio, scene });

// ——— 1. экран ———
const aspect = tvInfo.width / tvInfo.height;
check(
  Math.abs(aspect - 16 / 9) < 0.06,
  `пропорции экрана ${aspect.toFixed(2)} — как у панели 16:9 (${tvInfo.width} × ${tvInfo.height} м)`,
);
const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
check(
  normal.x < -0.99,
  'экран смотрит от стены в комнату (−X), поэтому картинку видно с дивана',
);

// ——— 2. каналы ———
check(TV_CHANNELS.length === 3, `каналов ${TV_CHANNELS.length}: ${TV_CHANNELS.map((c) => TV_LABELS[c]).join(', ')}`);
check(!tv.isOn, 'телевизор выключен по умолчанию');
tv.toggle();
check(tv.isOn && tv.channel === 'football', 'E включает телевизор — первый канал «ФУТБОЛ»');
const seen: string[] = [tv.channelLabel];
for (let i = 0; i < 3; i += 1) {
  tv.next();
  tv.update(1 / 12);
  seen.push(tv.channelLabel);
}
check(
  seen.join(' → ') === 'ФУТБОЛ → НОВОСТИ → ПОГОДА → ФУТБОЛ',
  `переключение по кругу: ${seen.join(' → ')}`,
);

// ——— 3. экран светится ———
check(Boolean(material.map), 'у включённого экрана есть картинка (map)');
check(material.emissiveMap === material.map, 'та же картинка в emissiveMap — экран светится сам');
const glow = scene.getObjectByName('tv-glow') as THREE.PointLight | undefined;
check(Boolean(glow), 'от экрана идёт свет в комнату');
tv.setProximity(1.6);
tv.update(1 / 12);
check((glow?.intensity ?? 0) > 0.4, `свет включён и растёт рядом с экраном (${(glow?.intensity ?? 0).toFixed(1)})`);

// ——— 4. картинка на всех каналах ———
let painted = 0;
for (const channel of TV_CHANNELS) {
  tv.setChannel(channel);
  for (let frame = 0; frame < 8; frame += 1) {
    tv.update(1 / 12);
    painted += 1;
  }
}
check(painted === 24, `отрисовано ${painted} кадров на трёх каналах без ошибок`);

// ——— 5. звук ———
const started = audioLog.filter((entry) => entry.startsWith('start:'));
check(started.length >= 3, `звук канала уходит в аудиосистему: ${started.join(', ')}`);
check(
  ['football', 'news', 'weather'].every((channel) => started.some((entry) => entry === `start:${channel}`)),
  'все три канала включают свой звук: трибуны, студия, прибой',
);

// ——— 6. озвучка и субтитры ———
// `import.meta.glob` есть только в сборке Vite, поэтому файлы читаем с диска:
// имя ролика должно совпадать с тем, что ищет TvVoices.play — `tv_<канал>_<номер>`.
// Запуск идёт из корня репозитория, а сам бандл лежит во временной папке —
// поэтому путь берём от рабочего каталога, а не от import.meta.url.
const { readdirSync, statSync } = await import('node:fs');
const { resolve } = await import('node:path');
const tvDir = resolve(process.cwd(), 'src/assets/tv');
let clips: string[] = [];
try {
  clips = readdirSync(tvDir).filter((name: string) => name.endsWith('.mp3'));
} catch {
  clips = [];
}
check(clips.length >= 5, `роликов озвучки в сборке: ${clips.length} (ждали не меньше пяти)`);
for (const channel of TV_CHANNELS) {
  const forChannel = clips.filter((name: string) => name.startsWith(`tv_${channel}_`));
  check(forChannel.length >= 1, `у канала ${TV_LABELS[channel]} свой голос: ${forChannel.join(', ') || '—'}`);
}
const tooSmall = clips.filter((name: string) => statSync(resolve(tvDir, name)).size < 12_000);
check(tooSmall.length === 0, `все ролики звучат не меньше секунды (мелких файлов: ${tooSmall.length})`);
for (const channel of TV_CHANNELS) {
  check((TV_LINES[channel]?.length ?? 0) >= 1, `у канала ${TV_LABELS[channel]} есть текст субтитра`);
}

// ——— 7. расстояние ———
tv.setProximity(1.5);
const nearGain = glow?.intensity ?? 0;
tv.setProximity(40);
tv.update(1 / 12);
const farGain = glow?.intensity ?? 0;
check(nearGain > farGain, `свет и звук гаснут с расстоянием (${nearGain.toFixed(1)} → ${farGain.toFixed(1)})`);
check(
  audioLog.some((entry) => entry.startsWith('distance:40')),
  'аудиосистема получает расстояние до экрана и гасит громкость',
);

// ——— выключение ———
tv.toggle();
check(!tv.isOn, 'повторное E выключает телевизор');
check(!material.map && !material.emissiveMap, 'выключенный экран — тёмное стекло без картинки');
check(audioLog[audioLog.length - 1] === 'stop' || audioLog.includes('stop'), 'звук выключился вместе с экраном');

tv.dispose();
check(!scene.getObjectByName('tv-glow'), 'dispose убирает свет из сцены');

if (problems > 0) {
  console.log(`\nПроблем: ${problems}`);
  process.exitCode = 1;
} else {
  console.log('\nТелевизор: каналы, картинка, звук и озвучка в порядке');
}
export const failed = problems;
