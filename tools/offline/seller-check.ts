/** Проверка кассира (задача 18): реплики, ответы, расписание и место у кассы.
 *  Логика TicketOffice — чистые правила, поэтому проверяется без браузера. */
import * as THREE from 'three';
import { STADIUM } from '../../src/core/Config';
import { CollisionWorld } from '../../src/world/Colliders';
import { buildStadium } from '../../src/world/island/Stadium';
import {
  lineById,
  SELLER_LINES,
  SELLER_QUESTIONS,
  SELLER_SPOT,
  TEAMS,
  TicketOffice,
} from '../../src/game/TicketOffice';

const makeCanvas = (): Record<string, unknown> => {
  const ctx = new Proxy({}, { get: () => () => 0, set: () => true });
  return { width: 16, height: 16, style: {}, getContext: () => ctx };
};
(globalThis as unknown as { document: unknown }).document = { createElement: () => makeCanvas() };
const cache = new Map<string, THREE.MeshStandardMaterial>();
const materials = new Proxy({} as Record<string, THREE.MeshStandardMaterial>, {
  get(_target, prop: string) {
    if (prop === 'dispose') return () => undefined;
    let material = cache.get(prop);
    if (!material) {
      material = new THREE.MeshStandardMaterial();
      material.name = prop;
      cache.set(prop, material);
    }
    return material;
  },
}) as never;

let problems = 0;
const fail = (message: string): void => {
  problems += 1;
  console.log(`✗ ${message}`);
};

// ——— 1. реплики ———
const ids = new Set<string>();
for (const line of SELLER_LINES) {
  if (ids.has(line.id)) fail(`повтор id «${line.id}»`);
  ids.add(line.id);
  if (line.text.trim().length < 6) fail(`«${line.id}»: пустой текст`);
  if (!line.file.endsWith('.mp3')) fail(`«${line.id}»: file не mp3`);
}
console.log(`реплик кассира: ${SELLER_LINES.length}`);

// ——— 2. вопросы ———
if (SELLER_QUESTIONS.length < 4) fail(`вопросов мало: ${SELLER_QUESTIONS.length}`);
if (SELLER_QUESTIONS.length > 6) fail(`вопросов больше шести — не влезут под клавиши 1…6`);
const questionIds = new Set<string>();
for (const question of SELLER_QUESTIONS) {
  if (questionIds.has(question.id)) fail(`повтор вопроса «${question.id}»`);
  questionIds.add(question.id);
  if (question.label.trim().length < 6) fail(`вопрос «${question.id}»: пустая подпись`);
}

// ——— 3. ответы: у каждого вопроса есть реплика ———
const office = new TicketOffice();
for (const played of [false, true]) {
  for (const hasTicket of [false, true]) {
    const fresh = new TicketOffice();
    for (const question of SELLER_QUESTIONS) {
      const lineId = fresh.answer(question.id, { played, hasTicket });
      if (lineId === null) {
        const expected = question.id === 'ticket' && hasTicket;
        if (!expected) fail(`«${question.id}» (played=${played}, билет=${hasTicket}) остался без ответа`);
        continue;
      }
      if (!lineById(lineId)) fail(`«${question.id}» → нет реплики «${lineId}»`);
    }
  }
}
void office;

// ——— 4. расписание и команды сходятся с текстом ———
const soon = lineById('join_soon')?.text ?? '';
const tomorrow = lineById('join_tomorrow')?.text ?? '';
if (!/через час/.test(soon)) fail('join_soon не говорит «через час»');
if (!/завтра/.test(tomorrow)) fail('join_tomorrow не говорит «завтра»');

const checkPairing = (played: boolean): void => {
  const [first, second] = TicketOffice.pairing(played);
  const text = lineById(played ? 'watch_tomorrow' : 'watch_today')?.text ?? '';
  for (const team of [first, second]) {
    if (!text.includes(team)) fail(`«${played ? 'watch_tomorrow' : 'watch_today'}» не называет команду «${team}»`);
  }
};
checkPairing(false);
checkPairing(true);

const teamsText = lineById('teams')?.text ?? '';
if (!teamsText.includes(TEAMS[0])) fail('реплика teams не называет команду героя');
if (!/без игроков/.test(teamsText)) fail('реплика teams не говорит, что в команде пока нет игроков');
if (lineById('viced')?.text.includes('Viced Boys') !== true) fail('реплика viced не называет Viced Boys');

// ——— 5. касса стоит там, где надо ———
const plazaMinX = STADIUM.centerX + STADIUM.width / 2;
const plazaMaxX = plazaMinX + STADIUM.plazaWidth;
const plazaMinZ = STADIUM.centerZ - STADIUM.plazaDepth / 2;
const plazaMaxZ = STADIUM.centerZ + STADIUM.plazaDepth / 2;
const inPlaza =
  SELLER_SPOT.x > plazaMinX && SELLER_SPOT.x < plazaMaxX && SELLER_SPOT.z > plazaMinZ && SELLER_SPOT.z < plazaMaxZ;
if (!inPlaza) fail(`кассир стоит вне площади: (${SELLER_SPOT.x.toFixed(2)}, ${SELLER_SPOT.z.toFixed(2)})`);

const collisions = new CollisionWorld();
const stadium = buildStadium(materials, collisions);
const boothZ = plazaMinZ + 0.5;
const clearance = Math.abs(SELLER_SPOT.z - boothZ);
if (clearance < 0.6) fail(`кассир прижат к стене кассы: ${clearance.toFixed(2)} м`);

const stuck = collisions.isBlocked(SELLER_SPOT.x, SELLER_SPOT.z, 0.36, 0.9);
if (stuck) fail('кассир стоит внутри коллизии (в стене/стойке)');

// Подход покупателя: от площади к кассиру по прямой должно быть свободно.
let blocked = false;
for (let step = 0; step <= 20; step += 1) {
  const t = step / 20;
  const x = SELLER_SPOT.x;
  const z = SELLER_SPOT.z + 2.6 * (1 - t);
  if (collisions.isBlocked(x, z, 0.34, 0.9)) {
    blocked = true;
    break;
  }
}
if (blocked) fail('к кассиру не подойти: между покупателем и кассой препятствие');
else console.log('подход к кассе свободен');

console.log(`кассир: (${SELLER_SPOT.x.toFixed(2)}, ${SELLER_SPOT.z.toFixed(2)}), стена кассы на ${boothZ.toFixed(2)}`);
console.log(`стадион собрался: коллизий ${collisions.count}, чаша ${Math.round(stadium.footprint.maxX - stadium.footprint.minX)}×${Math.round(stadium.footprint.maxZ - stadium.footprint.minZ)} м`);
console.log(problems === 0 ? 'Кассир: всё на месте' : `Кассир: проблем ${problems}`);
export const failed = problems > 0;
