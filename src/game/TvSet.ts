import * as THREE from 'three';
import type { AudioSystem } from '../core/Audio';
import type { InteriorTv } from '../world/island/Interior';

/**
 * Телевизор в гостиной (сборка v18).
 *
 *  Заказчик: «добавь возможность включать телевизор, подойдя к нему. там показывают
 *  футбол, новости (можно переключать каналы), звуки и озвучка должна присутствовать».
 *
 *  Как устроено:
 *   • экран — плоскость в гостиной (`Interior.tv`), картинку рисуем на canvas 512×288
 *     и отдаём в материал как `map` + `emissiveMap`: изображение само светится, как
 *     настоящая панель, и не зависит от освещения в комнате;
 *   • три канала: **ФУТБОЛ** (стадион, игроки, счёт, таймер), **НОВОСТИ** (студия,
 *     ведущий, бегущая строка, часы, прямой эфир) и **ПОГОДА** (солнце, море, прогноз);
 *   • статика канала (трибуны, разметка, студия, небо) рисуется один раз в отдельный
 *     холст, каждый кадр она только копируется — перерисовка 12 раз в секунду стоит
 *     несколько миллисекунд и не трогает GPU-сцену;
 *   • звук: Web Audio — гул стадиона, студийный фон или прибой, плюс голосовые
 *     дорожки из `src/assets/tv/*.mp3`. Громкость падает с расстоянием до экрана;
 *   • от экрана идёт мягкий свет, цвет зависит от канала: зелёный, синий, тёплый.
 */

export type TvChannel = 'football' | 'news' | 'weather';

export const TV_CHANNELS: readonly TvChannel[] = ['football', 'news', 'weather'];

export const TV_LABELS: Record<TvChannel, string> = {
  football: 'ФУТБОЛ',
  news: 'НОВОСТИ',
  weather: 'ПОГОДА',
};

/** Свет, который экран отбрасывает на комнату. */
const CHANNEL_LIGHT: Record<TvChannel, { color: number; intensity: number }> = {
  football: { color: 0xbfe6c4, intensity: 2.6 },
  news: { color: 0x9fc4ff, intensity: 2.1 },
  weather: { color: 0xffd9a0, intensity: 2.3 },
};

const SCREEN_W = 512;
const SCREEN_H = 288;
const FRAME_INTERVAL = 1 / 12;

// ————————————————————————————————————————————————————————————————
//  Голоса телевизора
// ————————————————————————————————————————————————————————————————

const CLIP_URLS: Record<string, string> = (() => {
  // В оффлайн-проверках и в Node `import.meta.glob` нет: тогда роликов просто нет,
  // а на экране остаются субтитры (тот же принцип, что у VoiceBank).
  const glob = (import.meta as unknown as { glob?: (pattern: string, options: unknown) => Record<string, string> }).glob;
  if (typeof glob !== 'function') return {};
  const modules = glob('../assets/tv/*.mp3', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>;
  const map: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const name = (path.split('/').pop() ?? '').replace(/\.mp3$/, '');
    map[name] = url;
  }
  return map;
})();

/** Субтитры на случай, если ролик не попал в сборку или звук ещё не разбужен. */
export const TV_LINES: Record<TvChannel, readonly string[]> = {
  football: [
    'Мяч у Морских Волков, прострел вдоль ворот — и гол! Трибуны встают, счёт 2:1!',
    'Коралловые Короли отвечают: удар с разворота, штанга! Как же близко было.',
    'Игра идёт на встречных курсах: обе команды не отсиживаются в обороне.',
  ],
  news: [
    'Добрый вечер. В VICE SHORE открыли новый участок улицы: белый забор, калитки и латунные номера участков.',
    'На стадионе только что закончился матч: Морские Волки принимают Коралловых Королей.',
  ],
  weather: [
    'Прогноз погоды на завтра. На острове солнечно, двадцать четыре градуса, ветер с моря три метра в секунду.',
  ],
};

class TvVoices {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private loading = false;
  private lastClip = '';

  constructor(private readonly audio: AudioSystem) {
    const ctx = audio.ctx;
    const output = audio.voiceOutput;
    if (ctx && output) {
      this.gain = ctx.createGain();
      this.gain.gain.value = 0.9;
      this.gain.connect(output);
    }
  }

  get clipCount(): number {
    return Object.keys(CLIP_URLS).length;
  }

  get decodedCount(): number {
    return this.buffers.size;
  }

  get isSpeaking(): boolean {
    return this.source !== null;
  }

  /** Громкость голоса падает вместе с громкостью телевизора. */
  setVolume(value: number): void {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, value));
  }

  async preload(): Promise<void> {
    if (this.loading || this.clipCount === 0) return;
    if (!this.audio.ctx) return;
    this.loading = true;
    await Promise.all(
      Object.entries(CLIP_URLS).map(async ([name, url]) => {
        if (this.buffers.has(name)) return;
        const buffer = await this.audio.decodeVoice(url);
        if (buffer) this.buffers.set(name, buffer);
      }),
    );
    this.loading = false;
  }

  /** Реплика канала: берём ролик по имени вида `tv_football_2`, иначе любой свободный. */
  play(channel: TvChannel, index = 0): boolean {
    this.stop();
    const ctx = this.audio.ctx;
    const output = this.gain ?? this.audio.voiceOutput;
    if (!ctx || !output || ctx.state !== 'running') return false;
    const preferred = `tv_${channel}_${index}`;
    const clip = this.buffers.has(preferred)
      ? preferred
      : [...this.buffers.keys()].find((name) => name.startsWith(`tv_${channel}_`) && name !== this.lastClip) ??
        [...this.buffers.keys()].find((name) => name.startsWith(`tv_${channel}_`));
    if (!clip) return false;
    const buffer = this.buffers.get(clip);
    if (!buffer) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    source.onended = () => {
      if (this.source === source) this.source = null;
    };
    source.start();
    this.source = source;
    this.lastClip = clip;
    return true;
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // уже остановлен
    }
  }

  dispose(): void {
    this.stop();
    this.buffers.clear();
  }
}

// ————————————————————————————————————————————————————————————————
//  Рисование каналов
// ————————————————————————————————————————————————————————————————

function canvasOf(width: number, height: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('[TvSet] нет 2D-контекста');
  return { el, ctx };
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Player {
  readonly x: number;
  readonly z: number;
  dx: number;
  dz: number;
  readonly team: 0 | 1;
  readonly number: number;
}

/** Задник «футбол»: трибуны, трава с полосами, разметка. */
function paintFootballBackdrop(ctx: CanvasRenderingContext2D): void {
  const w = SCREEN_W;
  const h = SCREEN_H;
  // Небо над трибунами
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.32);
  sky.addColorStop(0, '#0d2b3f');
  sky.addColorStop(1, '#1b4a5c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.32);
  // Трибуны с толпой
  ctx.fillStyle = '#101c24';
  ctx.fillRect(0, h * 0.2, w, h * 0.14);
  const random = seeded(90210);
  for (let i = 0; i < 2600; i += 1) {
    const x = random() * w;
    const y = h * 0.205 + random() * h * 0.13;
    const tone = random();
    ctx.fillStyle = tone > 0.66 ? '#ffd479' : tone > 0.33 ? '#7fe3d8' : '#ffb8a1';
    ctx.globalAlpha = 0.35 + random() * 0.5;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;
  // Реклама по кромке поля
  ctx.fillStyle = '#0b1a24';
  ctx.fillRect(0, h * 0.335, w, h * 0.05);
  ctx.fillStyle = '#eaf4f6';
  ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  const ads = ['VICE SHORE', 'КОРАЛЛЫ', 'МОРСКИЕ ВОЛКИ', 'ОСТРОВ', 'VICE SHORE'];
  ads.forEach((text, index) => ctx.fillText(text, 14 + index * 104, h * 0.361));
  // Поле: трапеция с полосами газона
  const top = h * 0.385;
  const bottom = h;
  const perspective = (t: number): { left: number; right: number } => ({
    left: 70 - 60 * t,
    right: w - 70 + 60 * t,
  });
  for (let i = 0; i < 9; i += 1) {
    const t0 = i / 9;
    const t1 = (i + 1) / 9;
    const y0 = top + (bottom - top) * t0;
    const y1 = top + (bottom - top) * t1;
    const p0 = perspective(t0);
    const p1 = perspective(t1);
    ctx.fillStyle = i % 2 === 0 ? '#1f5c33' : '#247038';
    ctx.beginPath();
    ctx.moveTo(p0.left, y0);
    ctx.lineTo(p0.right, y0);
    ctx.lineTo(p1.right, y1);
    ctx.lineTo(p1.left, y1);
    ctx.closePath();
    ctx.fill();
  }
  // Разметка
  ctx.strokeStyle = 'rgba(240,250,245,0.82)';
  ctx.lineWidth = 2;
  const p0 = perspective(0);
  const p1 = perspective(1);
  ctx.beginPath();
  ctx.moveTo(p0.left, top);
  ctx.lineTo(p0.right, top);
  ctx.lineTo(p1.right, bottom);
  ctx.lineTo(p1.left, bottom);
  ctx.closePath();
  ctx.stroke();
  // Средняя линия и круг
  const midT = 0.45;
  const mid = perspective(midT);
  const midY = top + (bottom - top) * midT;
  ctx.beginPath();
  ctx.moveTo(mid.left, midY);
  ctx.lineTo(mid.right, midY);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(w / 2, midY, 62, 20, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Штрафные — намёком, они уходят за кадр
  ctx.beginPath();
  ctx.moveTo(mid.left + 10, midY - 12);
  ctx.lineTo(mid.left + 10, midY + 12);
  ctx.moveTo(mid.right - 10, midY - 12);
  ctx.lineTo(mid.right - 10, midY + 12);
  ctx.stroke();
}

/** Задник «новости»: студия с панорамой острова и логотипом. */
function paintNewsBackdrop(ctx: CanvasRenderingContext2D): void {
  const w = SCREEN_W;
  const h = SCREEN_H;
  const wall = ctx.createLinearGradient(0, 0, w, h);
  wall.addColorStop(0, '#0a2233');
  wall.addColorStop(0.55, '#123448');
  wall.addColorStop(1, '#0a1b26');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  // Панорама за ведущим: море и остров
  ctx.fillStyle = 'rgba(90,180,200,0.18)';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.52);
  ctx.lineTo(w, h * 0.44);
  ctx.lineTo(w, h * 0.62);
  ctx.lineTo(0, h * 0.66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(20,60,45,0.55)';
  ctx.beginPath();
  ctx.ellipse(w * 0.72, h * 0.55, 92, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,212,121,0.5)';
  ctx.beginPath();
  ctx.arc(w * 0.16, h * 0.24, 26, 0, Math.PI * 2);
  ctx.fill();
  // Вертикальные панели студии
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(i * (w / 6), 0, w / 12, h);
  }
  // Стол ведущего
  ctx.fillStyle = '#08121a';
  ctx.beginPath();
  ctx.moveTo(w * 0.12, h * 0.82);
  ctx.lineTo(w * 0.88, h * 0.82);
  ctx.lineTo(w * 0.96, h);
  ctx.lineTo(w * 0.04, h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(w * 0.12, h * 0.82, w * 0.76, 3);
}

/** Задник «погода»: небо, солнце, море и силуэт острова. */
function paintWeatherBackdrop(ctx: CanvasRenderingContext2D): void {
  const w = SCREEN_W;
  const h = SCREEN_H;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.66);
  sky.addColorStop(0, '#1d6f96');
  sky.addColorStop(0.6, '#3fa5bd');
  sky.addColorStop(1, '#bfe6e2');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // Море
  const sea = ctx.createLinearGradient(0, h * 0.62, 0, h);
  sea.addColorStop(0, '#1f7f92');
  sea.addColorStop(1, '#0d3f52');
  ctx.fillStyle = sea;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  // Остров
  ctx.fillStyle = '#1c3a2c';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.615, 168, 26, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#2c5340';
  ctx.beginPath();
  ctx.ellipse(w * 0.42, h * 0.612, 72, 18, 0, Math.PI, 0);
  ctx.fill();
  // Пальмы силуэтом
  ctx.strokeStyle = '#16302300';
  ctx.fillStyle = '#14291f';
  for (const [px, scale] of [
    [w * 0.34, 1],
    [w * 0.63, 0.8],
  ] as const) {
    ctx.fillRect(px, h * 0.6 - 30 * scale, 3 * scale, 30 * scale);
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.ellipse(px + 1.5, h * 0.6 - 30 * scale, 16 * scale, 4 * scale, (i / 4) * Math.PI, 0, Math.PI);
      ctx.fill();
    }
  }
  // Волны у берега
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i += 1) {
    const y = h * 0.72 + i * 14;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      ctx.lineTo(x, y + Math.sin((x / w) * Math.PI * 6 + i) * 2.4);
    }
    ctx.stroke();
  }
}

interface Actor {
  readonly player: Player;
  px: number;
  pz: number;
}

export interface TvSetOptions {
  readonly tv: InteriorTv;
  readonly audio: AudioSystem;
  readonly scene: THREE.Scene;
}

export class TvSet {
  private readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly backdrops = new Map<TvChannel, HTMLCanvasElement>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly light: THREE.PointLight;
  private readonly voices: TvVoices;

  private readonly players: Actor[] = [];
  private readonly ball = { x: 0.5, z: 0.5, vx: 0.32, vz: 0.18 };

  private on = false;
  private current: TvChannel = 'football';
  private elapsed = 0;
  private accumulator = 0;
  private glitch = 0;
  private matchClock = 0;
  private score: [number, number] = [2, 1];
  private tickerOffset = 0;
  private liveBlink = 0;
  private voiceTimer = 6;
  private voiceIndex = 0;
  private distance = 999;
  private volume = 0;
  private disposed = false;

  constructor(private readonly options: TvSetOptions) {
    const { el, ctx } = canvasOf(SCREEN_W, SCREEN_H);
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(el);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.material = options.tv.mesh.material as THREE.MeshStandardMaterial;
    this.material.map = null;
    this.material.emissiveMap = null;
    this.material.emissive = new THREE.Color(0x000000);
    this.material.color = new THREE.Color(0x05070a);
    this.material.needsUpdate = true;

    this.light = new THREE.PointLight(CHANNEL_LIGHT.football.color, 0, 6.5, 2);
    this.light.position.copy(options.tv.center).addScaledVector(options.tv.facing, 0.85);
    this.light.name = 'tv-glow';
    options.scene.add(this.light);

    this.voices = new TvVoices(options.audio);

    // Задники рисуем один раз: в кадре остаётся только копирование и актёры
    const football = canvasOf(SCREEN_W, SCREEN_H);
    paintFootballBackdrop(football.ctx);
    this.backdrops.set('football', football.el);
    const news = canvasOf(SCREEN_W, SCREEN_H);
    paintNewsBackdrop(news.ctx);
    this.backdrops.set('news', news.el);
    const weather = canvasOf(SCREEN_W, SCREEN_H);
    paintWeatherBackdrop(weather.ctx);
    this.backdrops.set('weather', weather.el);

    // Расстановка игроков: две команды по пять — матч 4×4 плюс вратари
    const random = seeded(4711);
    for (let team = 0; team < 2; team += 1) {
      for (let i = 0; i < 5; i += 1) {
        const baseX = team === 0 ? 0.24 + i * 0.11 : 0.76 - i * 0.11;
        const baseZ = 0.18 + (i % 3) * 0.32;
        this.players.push({
          player: {
            x: baseX,
            z: baseZ,
            dx: 0.05 + random() * 0.08,
            dz: 0.04 + random() * 0.07,
            team: team === 0 ? 0 : 1,
            number: i + 1,
          },
          px: baseX,
          pz: baseZ,
        });
      }
    }

    this.paintOff();
  }

  get isOn(): boolean {
    return this.on;
  }

  get channel(): TvChannel | null {
    return this.on ? this.current : null;
  }

  get channelLabel(): string {
    return TV_LABELS[this.current];
  }

  /** Сколько роликов озвучки попало в сборку (для проверок и отчёта). */
  get clipCount(): number {
    return this.voices.clipCount;
  }

  get decodedClips(): number {
    return this.voices.decodedCount;
  }

  get isSpeaking(): boolean {
    return this.voices.isSpeaking;
  }

  /** Включить/выключить. Возвращает новое состояние. */
  toggle(): boolean {
    if (this.on) {
      this.turnOff();
      return false;
    }
    this.turnOn(this.current);
    return true;
  }

  /** Следующий канал: щёлкаем по кругу, как пультом. */
  next(): TvChannel {
    if (!this.on) {
      this.turnOn(this.current);
      return this.current;
    }
    const index = (TV_CHANNELS.indexOf(this.current) + 1) % TV_CHANNELS.length;
    this.setChannel(TV_CHANNELS[index] ?? 'football');
    return this.current;
  }

  setChannel(channel: TvChannel): void {
    if (channel === this.current && this.on) return;
    this.current = channel;
    this.glitch = 0.32;
    this.matchClock = 0;
    this.tickerOffset = 0;
    this.voiceIndex = 0;
    this.voiceTimer = 1.2;
    this.applyChannelLook();
    if (this.on) {
      void this.voices.preload();
      this.voices.play(channel, 0);
      this.options.audio.startTv(channel);
    }
  }

  private turnOn(channel: TvChannel): void {
    this.on = true;
    this.current = channel;
    this.glitch = 0.45;
    this.material.map = this.texture;
    this.material.emissiveMap = this.texture;
    this.audioStart();
    this.applyChannelLook();
    void this.voices.preload().then(() => undefined);
    this.voices.play(channel, 0);
    this.paint();
  }

  private turnOff(): void {
    this.on = false;
    this.voices.stop();
    this.options.audio.stopTv();
    this.material.map = null;
    this.material.emissiveMap = null;
    this.material.emissive = new THREE.Color(0x000000);
    this.material.color = new THREE.Color(0x05070a);
    this.material.needsUpdate = true;
    this.light.intensity = 0;
    this.paintOff();
  }

  private audioStart(): void {
    this.options.audio.startTv(this.current);
  }

  private applyChannelLook(): void {
    const look = CHANNEL_LIGHT[this.current];
    this.light.color.setHex(look.color);
    if (this.on) this.light.intensity = look.intensity * Math.min(1, this.volume + 0.15);
  }

  /** Насколько близко игрок: громкость и сила света зависят от расстояния. */
  setProximity(distance: number): void {
    this.distance = distance;
    const target = distance >= 30 ? 0 : Math.max(0, 1 - Math.max(0, distance - 1.2) / 12);
    this.volume = target;
    this.voices.setVolume(0.35 + target * 0.65);
    if (this.on) {
      const look = CHANNEL_LIGHT[this.current];
      this.light.intensity = look.intensity * (0.25 + target * 0.75);
      this.options.audio.setTvDistance(distance);
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.elapsed += dt;
    if (!this.on) return;
    this.accumulator += dt;
    if (this.accumulator >= FRAME_INTERVAL) {
      this.accumulator = 0;
      this.advance(dt);
      this.paint();
    }
    if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - dt);
    // Голос: первая реплика канала — сразу, дальше по кругу раз в 7–11 с
    this.voiceTimer -= dt;
    if (this.voiceTimer <= 0) {
      this.voiceTimer = 7 + (this.voiceIndex % 3) * 2;
      this.voiceIndex = (this.voiceIndex + 1) % 3;
      this.voices.play(this.current, this.voiceIndex);
    }
  }

  /** Движение актёров, таймер матча и бегущая строка. */
  private advance(dt: number): void {
    if (this.current === 'football') {
      this.matchClock += dt * 4; // ускоренная трансляция: минута за 15 с
      for (const actor of this.players) {
        actor.px += actor.player.dx * dt * 0.35;
        actor.pz += actor.player.dz * dt * 0.35;
        if (actor.px < 0.08 || actor.px > 0.92) actor.player.dx *= -1;
        if (actor.pz < 0.12 || actor.pz > 0.88) actor.player.dz *= -1;
        actor.px = Math.min(0.94, Math.max(0.06, actor.px));
        actor.pz = Math.min(0.9, Math.max(0.1, actor.pz));
      }
      this.ball.x += this.ball.vx * dt * 0.16;
      this.ball.z += this.ball.vz * dt * 0.12;
      if (this.ball.x < 0.06 || this.ball.x > 0.94) this.ball.vx *= -1;
      if (this.ball.z < 0.1 || this.ball.z > 0.9) this.ball.vz *= -1;
      if (Math.random() < dt * 0.08) {
        const index = Math.floor(Math.random() * 2);
        this.score[index] = (this.score[index] ?? 0) + 1;
      }
    } else if (this.current === 'news') {
      this.tickerOffset = (this.tickerOffset + dt * 46) % 1400;
      this.liveBlink += dt;
    }
    this.glitch = Math.max(0, this.glitch - dt);
  }

  /** Экран выключен — тёмное стекло с лёгким отражением. */
  private paintOff(): void {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, SCREEN_W, SCREEN_H);
    gradient.addColorStop(0, '#0a1016');
    gradient.addColorStop(0.6, '#060b10');
    gradient.addColorStop(1, '#0d151c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.fillStyle = 'rgba(120,150,170,0.05)';
    ctx.beginPath();
    ctx.moveTo(0, SCREEN_H * 0.2);
    ctx.lineTo(SCREEN_W * 0.55, 0);
    ctx.lineTo(SCREEN_W * 0.75, 0);
    ctx.lineTo(0, SCREEN_H * 0.42);
    ctx.closePath();
    ctx.fill();
    this.texture.needsUpdate = true;
  }

  private paint(): void {
    if (!this.on) {
      this.paintOff();
      return;
    }
    const ctx = this.ctx;
    const backdrop = this.backdrops.get(this.current);
    if (backdrop) ctx.drawImage(backdrop, 0, 0);
    if (this.current === 'football') this.paintFootball(ctx);
    else if (this.current === 'news') this.paintNews(ctx);
    else this.paintWeather(ctx);
    if (this.glitch > 0) this.paintGlitch(ctx);
    this.texture.needsUpdate = true;
  }

  /** Помехи при переключении канала: так экран «щёлкает», а не мигает белым. */
  private paintGlitch(ctx: CanvasRenderingContext2D): void {
    const strength = Math.min(1, this.glitch / 0.32);
    ctx.fillStyle = `rgba(8,14,18,${0.25 + strength * 0.5})`;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    const random = seeded(Math.floor(this.elapsed * 60));
    const bands = Math.round(6 + strength * 16);
    for (let i = 0; i < bands; i += 1) {
      const y = random() * SCREEN_H;
      const h = 1 + random() * 9 * strength;
      ctx.fillStyle = `rgba(255,255,255,${random() * 0.28 * strength})`;
      ctx.fillRect(0, y, SCREEN_W, h);
      ctx.fillStyle = `rgba(0,0,0,${random() * 0.4 * strength})`;
      ctx.fillRect(0, y + h, SCREEN_W, 2);
    }
  }

  private paintFootball(ctx: CanvasRenderingContext2D): void {
    const top = SCREEN_H * 0.385;
    const bottom = SCREEN_H;
    // Перевод координат поля в экран: ближе к камере (z→1) — шире и ниже
    const project = (x: number, z: number): { sx: number; sy: number; scale: number } => {
      const t = Math.min(1, Math.max(0, z));
      const left = 70 - 60 * (1 - t);
      const right = SCREEN_W - 70 + 60 * (1 - t);
      return {
        sx: left + (right - left) * x,
        sy: top + (bottom - top) * Math.pow(t, 0.82),
        scale: 0.42 + t * 0.95,
      };
    };
    // Тени игроков
    for (const actor of this.players) {
      const spot = project(actor.px, actor.pz);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(spot.sx, spot.sy, 7 * spot.scale, 2.6 * spot.scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Мяч
    const ball = project(this.ball.x, this.ball.z);
    ctx.fillStyle = '#f6fbf8';
    ctx.beginPath();
    ctx.arc(ball.sx, ball.sy, Math.max(2, 3 * ball.scale), 0, Math.PI * 2);
    ctx.fill();
    // Игроки: майка, голова, номер
    for (const actor of this.players) {
      const spot = project(actor.px, actor.pz);
      const height = 13 * spot.scale;
      const width = 6.4 * spot.scale;
      ctx.fillStyle = actor.player.team === 0 ? '#2f6bb0' : '#d1473a';
      ctx.fillRect(spot.sx - width / 2, spot.sy - height, width, height);
      ctx.fillStyle = '#d8b28d';
      ctx.beginPath();
      ctx.arc(spot.sx, spot.sy - height - 2 * spot.scale, 2.6 * spot.scale, 0, Math.PI * 2);
      ctx.fill();
      if (spot.scale > 0.9) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `bold ${Math.round(5.5 * spot.scale)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(String(actor.player.number), spot.sx, spot.sy - height * 0.35);
        ctx.textAlign = 'left';
      }
    }
    // Плашка счёта
    ctx.fillStyle = 'rgba(6,18,26,0.86)';
    ctx.fillRect(14, 12, 210, 34);
    ctx.fillStyle = '#ffd479';
    ctx.fillRect(14, 12, 5, 34);
    ctx.fillStyle = '#eaf4f6';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('МОР. ВОЛКИ', 30, 29);
    ctx.fillText('КОРАЛЛЫ', 30, 45);
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillText(String(this.score[0] ?? 0), 196, 29);
    ctx.fillText(String(this.score[1] ?? 0), 196, 45);
    ctx.textAlign = 'left';
    // Таймер и минута
    const minutes = Math.floor(this.matchClock / 60) % 90;
    ctx.fillStyle = 'rgba(6,18,26,0.86)';
    ctx.fillRect(SCREEN_W - 108, 12, 94, 26);
    ctx.fillStyle = '#7fe3d8';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(minutes).padStart(2, '0')}:${String(Math.floor(this.matchClock) % 60).padStart(2, '0')}`, SCREEN_W - 61, 26);
    ctx.textAlign = 'left';
    // Значок «прямой эфир»
    ctx.fillStyle = Math.floor(this.elapsed * 2) % 2 === 0 ? '#e0453a' : 'rgba(224,69,58,0.35)';
    ctx.beginPath();
    ctx.arc(SCREEN_W - 108 - 16, 25, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eaf4f6';
    ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
    ctx.fillText('LIVE', SCREEN_W - 106 - 44, 25);
  }

  private paintNews(ctx: CanvasRenderingContext2D): void {
    const w = SCREEN_W;
    const h = SCREEN_H;
    // Ведущий: плечи, голова, галстук, микрофон
    const cx = w * 0.5;
    const headY = h * 0.44;
    ctx.fillStyle = '#1e4b63';
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.88, 78, 60, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#f0f4f6';
    ctx.beginPath();
    ctx.moveTo(cx - 14, h * 0.72);
    ctx.lineTo(cx + 14, h * 0.72);
    ctx.lineTo(cx + 6, h * 0.86);
    ctx.lineTo(cx - 6, h * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c0453a';
    ctx.beginPath();
    ctx.moveTo(cx - 6, h * 0.735);
    ctx.lineTo(cx + 6, h * 0.735);
    ctx.lineTo(cx, h * 0.83);
    ctx.closePath();
    ctx.fill();
    // Шея и голова
    ctx.fillStyle = '#d8b28d';
    ctx.fillRect(cx - 9, h * 0.56, 18, 18);
    ctx.beginPath();
    ctx.ellipse(cx, headY, 26, 31, 0, 0, Math.PI * 2);
    ctx.fill();
    // Волосы
    ctx.fillStyle = '#2a2118';
    ctx.beginPath();
    ctx.ellipse(cx, headY - 12, 27, 20, 0, Math.PI, 0);
    ctx.fill();
    // Глаза с морганием
    const blink = Math.sin(this.elapsed * 0.9) > 0.985 ? 0.15 : 1;
    ctx.fillStyle = '#20303a';
    for (const dx of [-9, 9]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx, headY - 2, 3.2, 3.2 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Рот: говорит — значит открывается
    const speaking = this.voices.isSpeaking;
    const mouth = speaking ? 2 + Math.abs(Math.sin(this.elapsed * 13)) * 6 : 2;
    ctx.fillStyle = '#8a4038';
    ctx.beginPath();
    ctx.ellipse(cx, headY + 14, 6, mouth, 0, 0, Math.PI * 2);
    ctx.fill();
    // Логотип канала
    ctx.fillStyle = 'rgba(6,18,26,0.7)';
    ctx.fillRect(w - 148, 12, 134, 30);
    ctx.fillStyle = '#7fe3d8';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('VICE SHORE', w - 138, 27);
    ctx.fillStyle = '#ffd479';
    ctx.fillText('24', w - 34, 27);
    // Прямой эфир
    if (Math.floor(this.liveBlink * 1.6) % 2 === 0) {
      ctx.fillStyle = '#e0453a';
      ctx.fillRect(14, 12, 62, 20);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
      ctx.fillText('ПРЯМОЙ', 20, 22);
      ctx.fillText('ЭФИР', 20, 34);
    }
    // Плашка с заголовком
    const bannerY = h * 0.74;
    ctx.fillStyle = 'rgba(6,18,26,0.9)';
    ctx.fillRect(0, bannerY, w, 34);
    ctx.fillStyle = '#7fe3d8';
    ctx.fillRect(0, bannerY, 6, 34);
    ctx.fillStyle = '#eaf4f6';
    ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
    ctx.fillText('На острове открыли новый участок улицы', 16, bannerY + 17);
    // Бегущая строка
    const tickerY = h - 22;
    ctx.fillStyle = 'rgba(4,12,18,0.94)';
    ctx.fillRect(0, tickerY, w, 22);
    ctx.fillStyle = '#ffb8a1';
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    const ticker =
      'Матч 4×4 на стадионе · Морские Волки — Коралловые Короли · Завтра солнечно, 24° · Новый забор на улице · Касса открыта до 21:30 · Паром в 18:40 · Матч 4×4 на стадионе';
    ctx.fillText(ticker, 10 - this.tickerOffset, tickerY + 15);
    ctx.fillText(ticker, 10 - this.tickerOffset + 1400, tickerY + 15);
    // Часы
    ctx.fillStyle = '#eaf4f6';
    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('19:00', w - 14, tickerY - 10);
    ctx.textAlign = 'left';
  }

  private paintWeather(ctx: CanvasRenderingContext2D): void {
    const w = SCREEN_W;
    const h = SCREEN_H;
    // Солнце с вращающимися лучами
    const sunX = w * 0.78;
    const sunY = h * 0.2;
    ctx.save();
    ctx.translate(sunX, sunY);
    ctx.rotate(this.elapsed * 0.12);
    ctx.fillStyle = 'rgba(255,225,140,0.35)';
    for (let i = 0; i < 12; i += 1) {
      ctx.rotate(Math.PI / 6);
      ctx.fillRect(-2, 26, 4, 22);
    }
    ctx.restore();
    const sun = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 30);
    sun.addColorStop(0, '#fff6d0');
    sun.addColorStop(1, 'rgba(255,212,121,0.15)');
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 30, 0, Math.PI * 2);
    ctx.fill();
    // Облака
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    const cloudShift = (this.elapsed * 6) % (w + 160);
    for (const [baseX, baseY, scale] of [
      [60, h * 0.16, 1],
      [w * 0.42, h * 0.29, 0.75],
    ] as const) {
      const x = ((baseX + cloudShift) % (w + 160)) - 80;
      ctx.beginPath();
      ctx.ellipse(x, baseY, 26 * scale, 12 * scale, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 22 * scale, baseY + 3 * scale, 18 * scale, 9 * scale, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 20 * scale, baseY + 4 * scale, 16 * scale, 8 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Текущая температура
    ctx.fillStyle = 'rgba(6,26,34,0.55)';
    ctx.fillRect(16, 16, 150, 78);
    ctx.fillStyle = '#eaf4f6';
    ctx.font = 'bold 46px "Segoe UI", Arial, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('+24°', 26, 66);
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#bfe6e2';
    ctx.fillText('ветер с моря, 3 м/с', 26, 86);
    // Прогноз на три дня
    const days = [
      { day: 'Сегодня', temp: '+24°', icon: 'sun' },
      { day: 'Завтра', temp: '+26°', icon: 'sun' },
      { day: 'Среда', temp: '+22°', icon: 'cloud' },
    ] as const;
    const cardY = h - 74;
    days.forEach((entry, index) => {
      const x = 16 + index * 164;
      ctx.fillStyle = 'rgba(6,26,34,0.62)';
      ctx.fillRect(x, cardY, 152, 58);
      ctx.fillStyle = index === 0 ? '#ffd479' : '#eaf4f6';
      ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
      ctx.fillText(entry.day, x + 12, cardY + 22);
      ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
      ctx.fillText(entry.temp, x + 12, cardY + 46);
      if (entry.icon === 'sun') {
        ctx.fillStyle = '#ffd479';
        ctx.beginPath();
        ctx.arc(x + 120, cardY + 32, 12, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#dfe9ee';
        ctx.beginPath();
        ctx.ellipse(x + 120, cardY + 34, 16, 9, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 132, cardY + 29, 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // Логотип
    ctx.fillStyle = 'rgba(6,18,26,0.7)';
    ctx.fillRect(w - 148, 12, 134, 30);
    ctx.fillStyle = '#7fe3d8';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('VICE SHORE', w - 138, 27);
    ctx.fillStyle = '#ffd479';
    ctx.fillText('24', w - 34, 27);
    ctx.textBaseline = 'alphabetic';
  }

  /** Текст субтитра текущей реплики — для подсказки в интерфейсе. */
  get subtitle(): string {
    const lines = TV_LINES[this.current];
    return lines[this.voiceIndex % lines.length] ?? '';
  }

  get proximity(): number {
    return this.distance;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.voices.stop();
    this.voices.dispose();
    this.options.audio.stopTv();
    this.options.scene.remove(this.light);
    this.light.dispose();
    this.texture.dispose();
    this.backdrops.clear();
    this.material.map = null;
    this.material.emissiveMap = null;
    this.material.needsUpdate = true;
  }
}
