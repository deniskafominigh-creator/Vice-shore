/**
 * Проверка катсцены конца дня (задача 22, сборка v15).
 *
 *  Сцена — это таймлайн и поза героя. Таймлайн проверяем по кадрам, а позу —
 *  по повороту: заказчик после матча вошёл в новый день лёжа, потому что
 *  последний кадр сцены успевал положить уже восстановленного героя.
 *  Здесь ровно этот случай: сцена заканчивается, и герой обязан стоять,
 *  сколько бы кадров после этого ни прошло.
 */
import * as THREE from 'three';
import { EndOfDay } from '../../src/game/EndOfDay';
import type { Ui } from '../../src/ui/Ui';
import type { VoiceBank, VoiceLine } from '../../src/game/VoiceBank';

let problems = 0;
const check = (ok: boolean, message: string): void => {
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

const FLOOR = 3.2;
const SOFA = { x: -3.9, z: -9.4 };
const SPOT = { x: 5, y: FLOOR, z: 7 };

// ——— заглушки интерфейса и озвучки ———
const calls: string[] = [];
const ui = {
  showCutscene: () => calls.push('show'),
  hideCutscene: () => calls.push('hide'),
  setCutsceneTitle: (title: string | null, subtitle: string | null) =>
    calls.push(`title:${title ?? '-'}:${subtitle ?? '-'}`),
  setCutsceneCaption: (text: string | null) => calls.push(`caption:${text ?? '-'}`),
  flashMission: (text: string) => calls.push(`mission:${text}`),
} as unknown as Ui;

const spoken: string[] = [];
const voices = {
  play: (line: VoiceLine) => {
    spoken.push(line.clip);
    return true;
  },
  stop: () => calls.push('voice-stop'),
  duration: () => 3,
} as unknown as VoiceBank;

const hero = new THREE.Group();
hero.name = 'hero';
hero.position.set(SPOT.x, SPOT.y, SPOT.z);
hero.rotation.set(0, 0.4, 0);
const scene = new THREE.Group();
scene.add(hero);

let finished = 0;
let restored = 0;
const cutscene = new EndOfDay({
  ui,
  voices,
  hero,
  floorY: FLOOR,
  sofa: SOFA,
  onFinish: () => {
    finished += 1;
  },
  restore: () => {
    restored += 1;
  },
});

/** Объект реально видно только если видимы он и все родители. */
const drawn = (name: string): boolean => {
  let object: THREE.Object3D | null = scene.getObjectByName(name);
  while (object) {
    if (!object.visible) return false;
    object = object.parent;
  }
  return true;
};

const step = (seconds: number): void => {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) cutscene.update(dt);
};

// ——— 1. титры и постановка ———
cutscene.start(scene);
// Первый кадр сцены: таймлайн с отметки 0 запускает титры и ставит героя.
cutscene.update(0);
check(cutscene.isActive && !cutscene.isFinished, 'сцена началась и ещё не закончилась');
check(
  Math.abs(hero.position.x - (SOFA.x + 0.15)) < 0.01 &&
    Math.abs(hero.position.z - (SOFA.z + 1.35)) < 0.01,
  'герой встал у дивана',
);
check(Math.abs(hero.rotation.x) < 0.01, 'в начале сцены герой стоит, а не лежит');
check(calls.some((call) => call.startsWith('caption:Всё, рабочий день закрыт')), 'первая реплика в титрах');
check(spoken.length === 1 && spoken[0] === 'end_day_1', 'первая реплика озвучена');
check(drawn('cutscene-blanket-mesh') && drawn('cutscene-pillow-mesh'), 'плед и подушка на месте');

// ——— 2. герой ложится ———
step(5.2);
check(Math.abs(hero.rotation.x - Math.PI / 2) < 0.02, 'к 5-й секунде герой лежит на спине');
check(hero.position.y > FLOOR + 0.5, 'и лежит на диване, а не на полу');
check(spoken.includes('end_day_2'), 'вторая реплика озвучена');

// ——— 3. финал: герой снова стоит (баг заказчика) ———
step(6);
check(cutscene.isFinished && !cutscene.isActive, 'сцена закончилась по таймлайну');
check(finished === 1 && restored === 1, 'завершение сцены пришло ровно один раз');
check(calls.includes('hide'), 'кадр сцены убран');
check(Math.abs(hero.rotation.x) < 0.001 && Math.abs(hero.rotation.z) < 0.001, 'после сцены герой стоит, а не лежит');
check(
  Math.abs(hero.position.x - SPOT.x) < 0.001 && Math.abs(hero.position.z - SPOT.z) < 0.001,
  'герой вернулся на своё место',
);
check(hero.rotation.order === 'XYZ', `порядок осей снова обычный (${hero.rotation.order})`);
check(!drawn('cutscene-blanket-mesh'), 'плед убран вместе со сценой');

// ——— 4. лишние кадры после сцены ничего не ломают ———
step(3);
check(Math.abs(hero.rotation.x) < 0.001, 'кадры после сцены не кладут героя обратно');
check(finished === 1, 'второго завершения не было');

// ——— 5. новый день: сцена запускается заново и снова заканчивается ———
hero.position.set(SPOT.x, SPOT.y, SPOT.z);
hero.rotation.set(0, 1.2, 0);
cutscene.start(scene);
cutscene.update(0);
check(cutscene.isActive, 'повторный запуск сцены работает');
step(11.2);
check(finished === 2, 'второй день тоже закончился');
check(Math.abs(hero.rotation.x) < 0.001, 'и после второго дня герой снова стоит');

console.log(problems === 0 ? 'Катсцена: таймлайн и поза героя в порядке' : `Катсцена: проблем ${problems}`);
export const failed = problems > 0;
