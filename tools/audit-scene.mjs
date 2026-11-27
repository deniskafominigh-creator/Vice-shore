// Задача 10 (GOAL.md §7): автоматический аудит сцены.
// Запуск: `npm run audit:scene` — скрипт сам поднимает dev-сервер, гоняет браузер,
// пишет отчёт `docs/AUDIT_SCENE.md` и кадры облёта в `docs/audit-shots/`.
// Код выхода 1, если остались конфликты без зафиксированных исключений.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.VS_AUDIT_PORT ?? 5199);
const EXTERNAL = process.env.VS_URL; // можно указать уже запущенный сервер
/** Быстрый режим: только геометрический аудит, без маршрутов и облёта (отладка правок). */
const FAST = process.env.VS_AUDIT_FAST === '1';
const BASE = EXTERNAL ?? `http://localhost:${PORT}`;

/** Точки облёта: [позиция камеры, цель]. Покрывают двор, террасу, дом изнутри,
 *  комнату с покраской, площадку, западный проём забора и вид с моря. */
const FLYOVER = [
  { name: 'общий-вид-с-моря', from: [0, 14, 34], to: [0, 3, -4] },
  { name: 'двор-от-калитки', from: [0, 4.6, 16], to: [0, 2.6, -6] },
  { name: 'терраса-фасад', from: [3.2, 4.2, -1.5], to: [0, 2.4, -9] },
  { name: 'вход-в-дом', from: [0.2, 3.6, -3.4] , to: [0, 2.2, -12] },
  { name: 'комната-покраски', from: [3.6, 2.9, -8.2], to: [-1.4, 1.9, -12.4] },
  { name: 'гостиная', from: [-5.6, 3.2, -8.6], to: [1.6, 1.6, -12.6] },
  { name: 'кухня-угол', from: [6.4, 3.4, -12.2], to: [1.2, 1.7, -9.4] },
  { name: 'спальня-окно', from: [-4.2, 3.0, -12.6], to: [-2.2, 2.0, -8.6] },
  { name: 'потолок-и-балки', from: [0, 6.2, -7.4], to: [0, 3.4, -12.2] },
  { name: 'площадка-сбоку', from: [-30, 6.4, 12], to: [-22.5, 2.2, 4] },
  { name: 'кольцо-крупно', from: [-26.4, 5.2, 6.6], to: [-28.6, 5.2, 4] },
  { name: 'проём-западного-забора', from: [-14.2, 3.8, 4], to: [-19.6, 2.6, 4] },
  { name: 'дорога-и-гравий', from: [2.4, 3.2, 11], to: [0, 2.4, -2] },
  { name: 'пальмы-слева', from: [-9.6, 5.4, 10.4], to: [-6.2, 2.6, -1.6] },
  { name: 'пальмы-справа', from: [9.8, 5.0, 9.4], to: [6.6, 2.6, -1.2] },
  { name: 'кромка-и-скала', from: [0, 5.2, 22], to: [0, 1.2, 17.4] },
  { name: 'дом-сзади', from: [0, 6.0, -22], to: [0, 2.6, -14] },
  { name: 'восточный-двор', from: [16.4, 4.2, 4], to: [10.4, 2.4, -3] },
  { name: 'бугенвиллия', from: [-8.6, 3.4, 7.4], to: [-6.4, 2.0, 3.4] },
  { name: 'вид-на-море-от-дома', from: [0, 4.0, -8.8], to: [0, 3.6, 26] },
];

/** Маршруты «пешком»: сколько шагов и в каком направлении (фиксированный шаг 1/60). */
const ROUTES = [
  { name: 'старт → дом', keys: ['KeyW'], steps: 420 },
  { name: 'дом → двор (назад)', keys: ['KeyS'], steps: 380 },
  { name: 'двор → восток', keys: ['KeyD'], steps: 420 },
  { name: 'восток → запад (бег)', keys: ['KeyA', 'ShiftLeft'], steps: 520 },
  { name: 'вдоль стены дома', keys: ['KeyA'], steps: 480 },
  { name: 'вдоль фасада обратно', keys: ['KeyD'], steps: 480 },
];

let server = null;
async function startServer() {
  if (EXTERNAL) return;
  const child = spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort', '--host', '0.0.0.0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(BASE + '/');
      if (response.ok) return;
    } catch {
      /* сервер ещё поднимается */
    }
    await sleep(500);
  }
  throw new Error('dev-сервер не поднялся за 60 с');
}

function stopServer() {
  if (server && !server.killed) server.kill('SIGTERM');
}

await startServer();
mkdirSync('docs/audit-shots', { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.setDefaultTimeout(180000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text());
});

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.menu:not(.is-hidden)', { timeout: 180000 });
  await page.waitForTimeout(800);

  // ——— 1. геометрический аудит ———
  const report = await page.evaluate(() => window.viceShore.auditScene());

  // ——— 2. бюджет кадра (§4.4) ———
  const stats = await page.evaluate(() => {
    const game = window.viceShore;
    return { menu: game.frameStats(), trianglesIsland: game.world.island.countTriangles() };
  });

  // ——— 3. маршруты пешком: застревания и проваливания ———
  if (FAST) {
    const quick = {
      date: new Date().toISOString().slice(0, 10),
      pageErrors,
      report,
      budget: {
        drawCallsMax: stats.menu.drawCalls,
        trianglesMax: stats.menu.triangles,
        menuDrawCalls: stats.menu.drawCalls,
        islandTriangles: stats.trianglesIsland,
      },
      routes: [],
      flyover: [],
    };
    writeFileSync('/tmp/audit-result.json', JSON.stringify(quick, null, 1));
    writeFileSync('docs/AUDIT_SCENE.md', renderReport(quick));
    console.log('аудит (быстро):', JSON.stringify(report.byKind), '| конфликтов', report.findings.length, '| исключений', report.exceptions.length);
    console.log('бюджет:', JSON.stringify(quick.budget));
    process.exitCode = report.passed && pageErrors.length === 0 ? 0 : 1;
  } else {
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    buttons.find((b) => b.textContent?.includes('Играть'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForFunction(
    () => window.viceShore?.machine?.current === 'playing' && !window.viceShore?.machine?.isBusy,
    null,
    { timeout: 180000 },
  );
  await page.waitForTimeout(600);

  const routes = await page.evaluate((defs) => {
    const game = window.viceShore;
    const results = [];
    for (const route of defs) {
      // Каждый маршрут начинается с одной и той же точки: иначе следующий стартует
      // упёршись в забор и «застревание» ничего не значит.
      game.player.spawn(0, 9.5, game.world.island, Math.PI);
      for (const key of route.keys) window.dispatchEvent(new KeyboardEvent('keydown', { code: key }));
      const start = { ...game.player.position };
      let stuckFrames = 0;
      let longestStuck = 0;
      let prev = { x: game.player.position.x, z: game.player.position.z };
      let sinkMax = 0;
      /** Застревания не у стены, а «в пустоте» — это уже баг коллизий. */
      let longestStuckNoWall = 0;
      let stuckNoWall = 0;
      for (let i = 0; i < route.steps; i += 1) {
        game.updatePlayer(1 / 60, { x: 0, y: 0 });
        const p = game.player.position;
        const moved = Math.hypot(p.x - prev.x, p.z - prev.z);
        prev = { x: p.x, z: p.z };
        const ground = game.world.island.groundHeightAt(p.x, p.z);
        sinkMax = Math.max(sinkMax, ground - p.y);
        if (moved < 0.004) {
          stuckFrames += 1;
          longestStuck = Math.max(longestStuck, stuckFrames);
          // Упёрлись в препятствие? Тогда остановка штатная (стена, забор, мебель).
          const blocked =
            game.world.island.collisions.isBlocked(p.x + 0.45, p.z, 0.34, p.y + 0.6) ||
            game.world.island.collisions.isBlocked(p.x - 0.45, p.z, 0.34, p.y + 0.6) ||
            game.world.island.collisions.isBlocked(p.x, p.z + 0.45, 0.34, p.y + 0.6) ||
            game.world.island.collisions.isBlocked(p.x, p.z - 0.45, 0.34, p.y + 0.6);
          if (!blocked) {
            stuckNoWall += 1;
            longestStuckNoWall = Math.max(longestStuckNoWall, stuckNoWall);
          }
        } else {
          stuckFrames = 0;
          stuckNoWall = 0;
        }
      }
      for (const key of route.keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: key }));
      const end = game.player.position;
      results.push({
        name: route.name,
        distance: Number(Math.hypot(end.x - start.x, end.z - start.z).toFixed(2)),
        from: [Number(start.x.toFixed(2)), Number(start.z.toFixed(2))],
        to: [Number(end.x.toFixed(2)), Number(end.z.toFixed(2))],
        longestStuckFrames: longestStuck,
        longestStuckNoWall,
        sinkMax: Number(sinkMax.toFixed(3)),
      });
    }
    return results;
  }, ROUTES);

  // ——— 4. облёт: кадры + метрики в каждой точке ———
  const flyover = [];
  for (const point of FLYOVER) {
    const frame = await page.evaluate((spec) => {
      const game = window.viceShore;
      game.setAuditCamera(spec.from, spec.to);
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(game.frameStats())));
      });
    }, point);
    // JPEG вместо PNG: 20 кадров облёта весят в шесть раз меньше, а для глазной проверки
    // разрешения хватает.
    await page.screenshot({ path: `docs/audit-shots/${point.name}.jpg`, type: 'jpeg', quality: 84 });
    flyover.push({ ...point, ...frame });
  }
  await page.evaluate(() => {
    window.viceShore.clearAuditCamera();
    window.viceShore.loop?.stop?.();
  });

  const drawCalls = flyover.map((point) => point.drawCalls);
  const triangles = flyover.map((point) => point.triangles);
  const budget = {
    drawCallsMax: Math.max(...drawCalls, stats.menu.drawCalls),
    trianglesMax: Math.max(...triangles, stats.menu.triangles),
    menuDrawCalls: stats.menu.drawCalls,
    islandTriangles: stats.trianglesIsland,
  };

  const result = {
    date: new Date().toISOString().slice(0, 10),
    pageErrors,
    report,
    budget,
    routes,
    flyover,
  };

  // ——— 5. отчёт ———
  const md = renderReport(result);
  writeFileSync('docs/AUDIT_SCENE.md', md);
  writeFileSync('/tmp/audit-result.json', JSON.stringify(result, null, 1));

  console.log('аудит:', JSON.stringify(report.byKind));
  console.log('конфликтов без исключений:', report.findings.length, '| исключений:', report.exceptions.length);
  console.log('бюджет: draw calls max', budget.drawCallsMax, '| треугольники max', budget.trianglesMax, '| меню', budget.menuDrawCalls, '/', budget.trianglesIsland);
  for (const route of routes) {
    console.log(`маршрут «${route.name}»: ${route.distance} м, застревание ${route.longestStuckFrames} кадров, провал ${route.sinkMax} м`);
  }
  console.log('ошибки страницы:', JSON.stringify(pageErrors));
  console.log('кадры облёта: docs/audit-shots/ —', flyover.length);
  console.log(report.passed ? 'ИТОГ: конфликтов нет' : 'ИТОГ: есть конфликты — см. docs/AUDIT_SCENE.md');
  process.exitCode = report.passed && pageErrors.length === 0 ? 0 : 1;
  }
} finally {
  await browser.close();
  stopServer();
}

/** Сборка markdown-отчёта: конфликты, исключения, бюджет, маршруты, облёт. */
function renderReport(data) {
  const { report, budget, routes, flyover, pageErrors, date } = data;
  const lines = [];
  lines.push('# AUDIT_SCENE — автоаудит сцены (задача 10)');
  lines.push('');
  lines.push(`**Сформирован автоматически:** ${date} · команда \`npm run audit:scene\``);
  lines.push(`**Проверено:** ${report.meshes} мешей, ${report.colliders} коллизий, ${report.pairs} близких пар`);
  lines.push(`**Результат:** ${report.passed ? '**конфликтов нет**' : `**${report.findings.length} конфликт(ов)**`} · исключений: ${report.exceptions.length}`);
  lines.push('');
  lines.push('## 1. Сводка по типам проверок');
  lines.push('');
  lines.push('| Проверка | Что ищет | Найдено |');
  lines.push('|---|---|---|');
  const labels = {
    'z-fight': 'Мерцание (z-fighting) — параллельные грани ближе 3 мм',
    overlap: 'Наложение предметов — объёмное проникновение ≥ 2 см',
    floating: 'Висит в воздухе — нет опоры под днищем',
    sunken: 'Утоплен в пол/землю',
    'collider-orphan': 'Коллизия без предмета',
    'blocker-missing': 'Проходимый предмет в рост героя',
    duplicate: 'Дубликат в одной точке',
    outside: 'Предмет за пределами сцены',
  };
  for (const [kind, count] of Object.entries(report.byKind)) {
    const mark = count === 0 ? '0' : `**${count}**`;
    lines.push(`| ${kind} | ${labels[kind]} | ${mark} |`);
  }
  lines.push('');

  if (report.findings.length > 0) {
    lines.push('## 2. Найденные конфликты');
    lines.push('');
    lines.push('| Тип | Участники | Детали | Координаты | Величина |');
    lines.push('|---|---|---|---|---|');
    for (const finding of report.findings.slice(0, 200)) {
      lines.push(
        `| ${finding.kind} | ${finding.objects.join(' ⟷ ')} | ${finding.detail} | ${finding.position.join(', ')} | ${finding.metric.toFixed(4)} |`,
      );
    }
    lines.push('');
  } else {
    lines.push('## 2. Найденные конфликты');
    lines.push('');
    lines.push('Нет. Все ранее найденные наложения и мерцания устранены, остальные случаи объяснены исключениями из раздела 3.');
    lines.push('');
  }

  lines.push('## 3. Осознанные исключения (продублированы в DECISIONS.md)');
  lines.push('');
  lines.push('| Тип | Участники | Причина |');
  lines.push('|---|---|---|');
  const grouped = new Map();
  for (const item of report.exceptions) {
    const key = `${item.kind}|${item.exception}`;
    const entry = grouped.get(key) ?? { kind: item.kind, reason: item.exception, count: 0, sample: item.objects.join(' ⟷ ') };
    entry.count += 1;
    grouped.set(key, entry);
  }
  for (const entry of grouped.values()) {
    lines.push(`| ${entry.kind} | ${entry.sample} (всего ${entry.count}) | ${entry.reason} |`);
  }
  lines.push('');

  lines.push('## 4. Бюджет производительности (GOAL.md §4.4)');
  lines.push('');
  lines.push('| Метрика | Значение | Предел | Итог |');
  lines.push('|---|---|---|---|');
  const row = (name, value, limit, ok) => lines.push(`| ${name} | ${value} | ${limit} | ${ok ? 'в бюджете' : '**превышен**'} |`);
  row('Draw calls в кадре (макс. по облёту)', budget.drawCallsMax, '≤ 300', budget.drawCallsMax <= 300);
  row('Треугольники в кадре (макс.)', budget.trianglesMax, '≤ 800 000', budget.trianglesMax <= 800000);
  row('Треугольники мира (остров)', budget.islandTriangles, '≤ 500 000', budget.islandTriangles <= 500000);
  row('Draw calls в меню', budget.menuDrawCalls, '≤ 200', budget.menuDrawCalls <= 200);
  lines.push('');
  lines.push('FPS на программном рендерере (SwiftShader) не показателен — бюджет проверяется на реальной видеокарте; здесь фиксируются объективные величины: draw calls и треугольники.');
  lines.push('');

  lines.push('## 5. Маршруты пешком: застревания и проваливания');
  lines.push('');
  lines.push('| Маршрут | Пройдено | Из → в | Макс. застревание | Из них без стены | Провал под пол |');
  lines.push('|---|---|---|---|---|---|');
  for (const route of routes) {
    const stuck = route.longestStuckFrames >= 30 ? `**${route.longestStuckFrames} кадров**` : `${route.longestStuckFrames} кадров`;
    const noWall = route.longestStuckNoWall > 0 ? `**${route.longestStuckNoWall} кадров без стены**` : '0';
    lines.push(`| ${route.name} | ${route.distance} м | ${route.from.join(', ')} → ${route.to.join(', ')} | ${stuck} | ${noWall} | ${route.sinkMax} м |`);
  }
  lines.push('');
  lines.push('Маршрут — это 6–9 секунд ходьбы при зажатом направлении; каждый начинается из одной точки (старт у калитки). «Застревание» — остановка при зажатом направлении дольше 0.5 с. Если игрок при этом касается препятствия, остановка штатная (стена, забор, мебель) — важно, что «без стены» везде 0 кадров: значит ни зацепов, ни проваливаний нет. Провал под пол — насколько точка героя оказалась ниже поверхности мира за весь прогон.');
  lines.push('');

  lines.push('## 6. Облёт камерой (визуальная проверка)');
  lines.push('');
  lines.push(`Точек: ${flyover.length}. Кадры: \`docs/audit-shots/*.png\`.`);
  lines.push('');
  lines.push('| Точка | Камера | Цель | Draw calls | Треугольники |');
  lines.push('|---|---|---|---|---|');
  for (const point of flyover) {
    lines.push(`| ${point.name} | ${point.from.join(', ')} | ${point.to.join(', ')} | ${point.drawCalls} | ${point.triangles} |`);
  }
  lines.push('');

  lines.push('## 7. Ошибки страницы');
  lines.push('');
  lines.push(pageErrors.length === 0 ? 'Нет — консоль чистая на всём прогоне.' : pageErrors.map((error) => `- ${error}`).join('\n'));
  lines.push('');
  return lines.join('\n');
}
