import dialogues from '../data/dialogues.json';
import { MISSION_01, MISSION_02 } from '../data/quests';
import type { Game } from './Game';

/** Озвучка героя (задача 9). Реплики — данные (`src/data/dialogues.json`),
 *  триггеры — только события шины, воспроизведение — одна дорожка на игру.
 *
 *  Правила:
 *   - одновременно звучит не больше одной реплики;
 *   - реплика миссии перебивает idle, но не наоборот;
 *   - на повтор — cooldown из файла реплик (не меньше 6 с);
 *   - музыка приглушается на время реплики (через `voice:started`/`voice:ended`);
 *   - нет файла — субтитры вместо звука (обязательный фолбэк). */

/** Где реплика уместна (задача 17). `any` — везде. */
export type DialoguePlace = 'any' | 'villa' | 'court' | 'stadium';

export interface DialogueLine {
  readonly id: string;
  readonly text: string;
  readonly trigger: string;
  readonly priority: number;
  readonly cooldown: number;
  readonly file: string;
  readonly place?: DialoguePlace;
}

const LINES: readonly DialogueLine[] = dialogues.lines as readonly DialogueLine[];

/** mp3 лежат в src/assets/voice: Vite отдаёт их URL, а при сборке инлайнит в один файл. */
const CLIP_URLS: Record<string, string> = (() => {
  const modules = import.meta.glob('../assets/voice/*.mp3', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>;
  const map: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const name = path.split('/').pop() ?? '';
    map[name] = url;
  }
  return map;
})();

interface Playback {
  readonly line: DialogueLine;
  readonly source: AudioBufferSourceNode | null;
  /** Момент окончания в секундах игрового времени (фолбэк — по длине текста). */
  readonly endsAt: number;
  readonly fallback: boolean;
}

const RULES = {
  /** Между репликами пауза, чтобы не «склеивались». */
  gap: 0.4,
  /** Сколько ждём тишины перед idle-репликой. */
  idleDelay: 15,
  idleJitter: 7,
  /** Очередь короткая: старые реплики не должны догонять игрока. */
  queueLimit: 2,
  /** Фолбэк-субтитры: не меньше 2,2 с и примерно по длине текста. */
  fallbackMin: 2.2,
  fallbackMax: 8,
  fallbackPerChar: 0.072,
} as const;

export class DialogueSystem {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastPlayed = new Map<string, number>();
  private queue: DialogueLine[] = [];
  private current: Playback | null = null;
  private lastVoiceAt = 0;
  private nextIdleAt: number = RULES.idleDelay;
  private idleCursor = 0;
  /** Курсоры вариантов: у одного триггера может быть несколько фраз (голы). */
  private readonly variantCursor = new Map<string, number>();
  private subtitleVisible = false;
  private readonly cleanups: Array<() => void> = [];
  /** Время реплик — реальное: звук играет в реальном масштабе, а dt игрового цикла
   *  под нагрузкой (или под SwiftShader) бывает в разы меньше реального. */
  private get clock(): number {
    return performance.now() / 1000;
  }
  private decoded = false;
  private decoding = false;

  constructor(private readonly game: Game) {
    const bus = game.bus;
    const on = <K extends Parameters<typeof bus.on>[0]>(event: K, handler: Parameters<typeof bus.on<K>>[1]): void => {
      const off = bus.on(event, handler);
      this.cleanups.push(off);
    };

    on('quest:started', (payload) => {
      if (payload.id === MISSION_01.id) this.play('start_mission1');
      else if (payload.id === MISSION_02.id) this.play('to_court');
    });
    on('item:pickup', (payload) => {
      if (payload.item === 'roller') this.play('take_roller');
      else if (payload.item === 'paint') this.play('take_paint');
      else this.play('take_ball');
    });
    on('paint:started', () => this.play('paint_start'));
    on('paint:dry', () => this.play('paint_dry'));
    on('paint:progress', (payload) => {
      if (payload.progress >= 0.5) this.play('paint_half');
    });
    on('paint:completed', () => this.play('wall_done'));
    on('ball:throw', () => this.play('throw'));
    on('ball:scored', (payload) => this.play(payload.goals >= payload.total ? 'goal_second' : 'goal'));
    on('ball:missed', () => this.play('miss'));
    on('quest:completed', (payload) => {
      if (payload.id === MISSION_02.id) this.play('win');
    });
    on('stadium:entered', () => this.play('stadium_enter'));
    on('stadium:ticket', () => this.play('stadium_ticket'));
    on('football:charge', () => this.play('football_charge'));
    on('football:kick', () => {
      // Удар и гол не должны спорить: гол приоритетнее и перебьёт «пошла».
      this.play('football_kick');
    });
    on('football:goal', () => this.playVariant('football:goal'));
    on('state:changed', (payload) => {
      if (payload.to !== 'playing') this.stop();
      if (payload.to === 'playing') this.lastVoiceAt = this.clock;
    });
  }

  /** Где сейчас герой. Отсюда фильтр реплик: на стадионе не звучит дом и кольцо. */
  /** null — мир ещё не собран: тогда место неизвестно и фильтр не мешает. */
  private get place(): DialoguePlace | null {
    const island = this.game.world?.island;
    if (!island) return null;
    const point = this.game.player.position;
    const place = island.placeAt(point.x, point.z);
    return place === 'street' ? 'any' : place;
  }

  /** Звучит ли реплика в этом месте. */
  private fits(line: DialogueLine): boolean {
    const place = line.place ?? 'any';
    if (place === 'any') return true;
    const current = this.place;
    if (current === null) return true;
    // На улице и в других местах звучат только «везде»-реплики.
    return place === current;
  }

  /** Одна из нескольких фраз одного триггера (по кругу), с учётом места.
   *  Нужен для трёх фраз на гол: подряд одна и та же не повторяется. */
  playVariant(trigger: string): boolean {
    const candidates = LINES.filter((line) => line.trigger === trigger && this.fits(line));
    if (candidates.length === 0) return false;
    const cursor = this.variantCursor.get(trigger) ?? 0;
    for (let attempt = 0; attempt < candidates.length; attempt += 1) {
      const line = candidates[(cursor + attempt) % candidates.length];
      const last = this.lastPlayed.get(line.id);
      if (last !== undefined && this.clock - last < Math.max(6, line.cooldown)) continue;
      this.variantCursor.set(trigger, (cursor + attempt + 1) % candidates.length);
      return this.play(line.id);
    }
    return false;
  }

  /** Сколько реплик описано и сколько из них со звуком — для тестов и отладки. */
  get totalLines(): number {
    return LINES.length;
  }

  get voicedLines(): number {
    return LINES.filter((line) => this.buffers.has(line.id)).length;
  }

  get missingVoice(): string[] {
    return LINES.filter((line) => !this.buffers.has(line.id)).map((line) => line.id);
  }

  get currentLineId(): string | null {
    return this.current?.line.id ?? null;
  }

  get isSpeaking(): boolean {
    return this.current !== null;
  }

  get subtitlesOn(): boolean {
    return this.game.settings.get('subtitles');
  }

  /** Текст, который сейчас на экране (для тестов и субтитров). */
  get subtitleText(): string | null {
    return this.subtitleVisible ? (this.current?.line.text ?? null) : null;
  }

  get lastSubtitlesVisible(): boolean {
    return this.subtitleVisible;
  }

  /** Декодировать все доступные файлы. Вызывается после разблокировки звука. */
  async preload(): Promise<void> {
    if (this.decoding) return;
    if (this.decoded && this.buffers.size > 0) return;
    const audio = this.game.audio;
    // До разблокировки звука контекста нет — повторим попытку позже.
    if (!audio.ctx) return;
    this.decoding = true;
    const tasks = LINES.map(async (line) => {
      const name = line.file.split('/').pop() ?? '';
      const url = CLIP_URLS[name];
      if (!url) return;
      const buffer = await audio.decodeVoice(url);
      if (buffer) this.buffers.set(line.id, buffer);
    });
    await Promise.all(tasks);
    // Если ничего не декодировалось (нет файлов/сеть), оставляем флаг снятым:
    // фолбэк-субтитры работают, а звук подхватится при следующей попытке.
    this.decoded = this.buffers.size > 0;
    this.decoding = false;
  }

  /** Герой молчит, пока говорит кассир: две дорожки не спорят (задача 18). */
  pauseIdle(): void {
    this.lastVoiceAt = this.clock;
    this.nextIdleAt = RULES.idleDelay + Math.random() * RULES.idleJitter;
  }

  update(_dt?: number): void {
    if (this.current && this.clock >= this.current.endsAt) this.finish();

    if (this.game.machine.current !== 'playing' || this.current || this.queue.length > 0) return;
    if (this.clock < this.lastVoiceAt + this.nextIdleDelay()) return;
    this.playIdle();
  }

  /** Запустить реплику по id. Возвращает true, если она действительно зазвучала/показалась. */
  play(id: string): boolean {
    const line = LINES.find((item) => item.id === id);
    if (!line) return false;
    // Реплика не про это место — молчим (задача 17: «краска сохнет» на стадионе).
    if (!this.fits(line)) return false;

    const now = this.clock;
    const last = this.lastPlayed.get(id);
    if (last !== undefined && now - last < Math.max(6, line.cooldown)) return false;

    if (this.current) {
      // Важная реплика перебивает текущую сразу — пауза между репликами (gap)
      // защищает только равные и менее важные, иначе гол/победа потеряются.
      if (line.priority > this.current.line.priority) {
        this.finish(true, false);
        this.start(line);
        return true;
      }
      if (now - this.lastVoiceAt < RULES.gap) return false;
      this.enqueue(line);
      return false;
    }

    this.start(line);
    return true;
  }

  /** Остановить текущую реплику (пауза, выход в меню). */
  stop(): void {
    this.queue = [];
    if (!this.current) return;
    this.finish(true);
  }

  /** Настройку субтитров переключили посреди реплики: звук не трогаем, текст — да. */
  refreshSubtitles(): void {
    if (!this.current) return;
    if (this.subtitlesOn) {
      this.subtitleVisible = true;
      this.game.ui.showSubtitle(this.current.line.text);
    } else if (this.subtitleVisible) {
      this.hideSubtitle();
    }
  }

  dispose(): void {
    this.stop();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.buffers.clear();
  }

  // ——— внутреннее ————————————————————————————————————————————

  private start(line: DialogueLine): void {
    const now = this.clock;
    this.lastVoiceAt = now;
    this.nextIdleAt = RULES.idleDelay + Math.random() * RULES.idleJitter;
    this.lastPlayed.set(line.id, now);

    const buffer = this.buffers.get(line.id);
    const ctx = this.game.audio.ctx;
    const output = this.game.audio.voiceOutput;
    const canPlay = Boolean(buffer && ctx && output && ctx.state === 'running');

    if (canPlay && buffer && ctx && output) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      source.onended = () => {
        if (this.current?.line.id === line.id) this.finish();
      };
      source.start();
      // Длительность по звуку + небольшой запас на хвост
      this.current = { line, source, endsAt: now + buffer.duration + 0.08, fallback: false };
      this.showSubtitle(line.text);
      this.game.bus.emit('voice:started', { id: line.id });
      return;
    }

    // Фолбэк: файла нет или звук ещё не готов — честно показываем текст
    const seconds = Math.min(
      RULES.fallbackMax,
      Math.max(RULES.fallbackMin, line.text.length * RULES.fallbackPerChar),
    );
    this.current = { line, source: null, endsAt: now + seconds, fallback: true };
    this.showSubtitle(line.text);
  }

  private finish(interrupted = false, startNext = true): void {
    const playback = this.current;
    if (!playback) return;
    this.current = null;
    if (playback.source) {
      try {
        playback.source.onended = null;
        playback.source.stop();
      } catch {
        // источник уже остановлен — это нормально
      }
      // Снимаем приглушение музыки в любом случае: и по концу, и по перебиванию
      this.game.bus.emit('voice:ended', { id: playback.line.id });
      void interrupted;
    }
    this.hideSubtitle();
    this.lastVoiceAt = this.clock;
    if (!startNext) return;
    const next = this.queue.shift();
    if (next && this.game.machine.current === 'playing') this.start(next);
  }

  private enqueue(line: DialogueLine): void {
    if (this.queue.some((item) => item.id === line.id)) return;
    if (this.queue.length < RULES.queueLimit) {
      this.queue.push(line);
      return;
    }
    // Очередь полна: выбрасываем самую неважную
    let weakest = 0;
    for (let index = 1; index < this.queue.length; index += 1) {
      if ((this.queue[index]?.priority ?? 0) < (this.queue[weakest]?.priority ?? 0)) weakest = index;
    }
    const current = this.queue[weakest];
    if (current && line.priority > current.priority) this.queue[weakest] = line;
  }

  private playIdle(): void {
    const idle = LINES.filter((line) => line.trigger === 'idle' && this.fits(line));
    if (idle.length === 0) return;
    // По кругу, но с учётом cooldown: застрявшие реплики пропускаем
    for (let attempt = 0; attempt < idle.length; attempt += 1) {
      const line = idle[(this.idleCursor + attempt) % idle.length];
      if (!line) continue;
      const last = this.lastPlayed.get(line.id);
      if (last !== undefined && this.clock - last < Math.max(6, line.cooldown)) continue;
      this.idleCursor = (this.idleCursor + attempt + 1) % idle.length;
      this.game.bus.emit('voice:idle', { seconds: this.clock - this.lastVoiceAt });
      this.play(line.id);
      return;
    }
    // Все на cooldown — просто откладываем следующий idle
    this.lastVoiceAt = this.clock;
  }

  private nextIdleDelay(): number {
    return this.nextIdleAt;
  }

  private showSubtitle(text: string): void {
    if (!this.subtitlesOn) {
      this.subtitleVisible = false;
      return;
    }
    this.subtitleVisible = true;
    this.game.ui.showSubtitle(text);
  }

  private hideSubtitle(): void {
    this.subtitleVisible = false;
    this.game.ui.hideSubtitle();
  }
}
