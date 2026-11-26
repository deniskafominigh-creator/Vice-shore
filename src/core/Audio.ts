import type { EventBus } from './EventBus';
import type { GameEventMap } from './Events';
import type { SettingsStore } from './Settings';
import { clamp01 } from './MathUtils';
import { MusicEngine, type MusicMood, type MusicStinger } from '../audio/Music';

/** Звуковая система на Web Audio.
 *  Шины: master → (music, sfx, voice, ambience). Сейчас реально звучат:
 *   - окружающая среда (процедурный прибой + ветер) — собственная генерация, файлов не нужно;
 *   - интерфейсные звуки (наведение, клик, возврат) — синтез.
 *  Музыкальные треки — задача 3, голос — задача 9; шины для них уже готовы. */

export type UiSoundKind = 'hover' | 'click' | 'back' | 'confirm';

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private voice: GainNode | null = null;
  private ambience: GainNode | null = null;

  private rollerSource: AudioBufferSourceNode | null = null;
  private rollerGain: GainNode | null = null;

  private ambienceStarted = false;
  private ambienceTarget = 1;
  private suspended = false;

  private musicEngine: MusicEngine | null = null;
  /** Настроение, которое должно играть в текущем состоянии (музыка стартует после клика). */
  private desiredMood: MusicMood = 'menu';
  private moodOverride: MusicMood | null = null;
  private readonly visibilityHandler = (): void => {
    this.musicEngine?.setSuspended(document.hidden);
  };

  constructor(
    private readonly settings: SettingsStore,
    private readonly bus: EventBus<GameEventMap>,
  ) {
    this.bus.on('settings:changed', (payload) => {
      if (payload.key.startsWith('volume')) this.applyVolumes();
    });

    // Музыка следует за состоянием игры, а не за таймером (GOAL.md §7, задача 3).
    this.bus.on('state:changed', (payload) => this.onStateChanged(payload.to));
    this.bus.on('quest:started', () => {
      this.moodOverride = 'mission';
      this.musicEngine?.setMood('mission', 2.2);
      this.musicEngine?.playStinger('quest');
    });
    this.bus.on('quest:completed', () => {
      this.moodOverride = null;
      this.musicEngine?.playStinger('success');
      this.musicEngine?.setMood('explore', 2.5);
    });
    this.bus.on('voice:started', () => this.musicEngine?.setDucked(true));
    this.bus.on('voice:ended', () => this.musicEngine?.setDucked(false));

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  get musicMood(): MusicMood | null {
    return this.musicEngine?.mood ?? null;
  }

  /** Принудительная смена музыкального настроения (отладка, будущие сцены). */
  playMusic(mood: MusicMood): void {
    this.desiredMood = mood;
    this.musicEngine?.setMood(mood, 2);
  }

  playMusicStinger(kind: MusicStinger): void {
    this.musicEngine?.playStinger(kind);
  }

  private onStateChanged(to: string): void {
    switch (to) {
      case 'menu':
        this.desiredMood = 'menu';
        this.musicEngine?.setMood('menu', 2.4);
        this.musicEngine?.setDucked(false);
        break;
      case 'playing':
        this.desiredMood = this.moodOverride ?? 'explore';
        this.musicEngine?.setMood(this.desiredMood, 2);
        this.musicEngine?.setDucked(false);
        break;
      case 'paused':
        // На паузе музыка остаётся, но уходит на второй план.
        this.musicEngine?.setDucked(true);
        break;
      default:
        break;
    }
  }

  get isReady(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /** Контекст и шина голоса — для системы реплик (задача 9). */
  get ctx(): AudioContext | null {
    return this.context;
  }

  get voiceOutput(): GainNode | null {
    return this.voice;
  }

  /** Декодировать файл реплики. null — файла нет или он битый (тогда играют субтитры). */
  async decodeVoice(url: string): Promise<AudioBuffer | null> {
    const ctx = this.context;
    if (!ctx) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.arrayBuffer();
      return await ctx.decodeAudioData(data);
    } catch (error) {
      console.warn('[Audio] реплика не декодировалась:', url, error);
      return null;
    }
  }

  /** Создаётся строго по действию пользователя (политика автовоспроизведения браузеров). */
  async unlock(): Promise<boolean> {
    if (!this.context) {
      const Ctor = window.AudioContext;
      if (!Ctor) {
        console.warn('[Audio] Web Audio API недоступен — игра работает без звука');
        this.bus.emit('audio:unlocked', { ok: false });
        return false;
      }
      this.context = new Ctor({ latencyHint: 'interactive' });
      this.buildGraph(this.context);
      this.applyVolumes(true);
    }

    try {
      if (this.context.state !== 'running') await this.context.resume();
    } catch (error) {
      console.warn('[Audio] не удалось запустить контекст:', error);
    }

    const ok = this.context.state === 'running';
    if (ok) {
      if (!this.musicEngine && this.music) {
        this.musicEngine = new MusicEngine(this.context, this.music);
        this.musicEngine.start(this.moodOverride ?? this.desiredMood);
        this.bus.emit('music:mood', { mood: this.musicEngine.mood ?? this.desiredMood });
      }
      this.bus.emit('audio:unlocked', { ok: true });
    }
    return ok;
  }

  /** Плавное изменение громкости (без щелчков). */
  applyVolumes(immediate = false): void {
    if (!this.context) return;
    const set = (node: GainNode | null, value: number): void => {
      if (!node) return;
      const target = clamp01(value);
      if (immediate) node.gain.value = target;
      else node.gain.setTargetAtTime(target, this.context!.currentTime, 0.06);
    };
    set(this.master, this.settings.get('volumeMaster'));
    set(this.music, this.settings.get('volumeMusic'));
    set(this.sfx, this.settings.get('volumeSfx'));
    set(this.voice, this.settings.get('volumeVoice'));
    set(this.ambience, this.settings.get('volumeAmbience') * this.ambienceTarget);
  }

  /** Уровень окружения зависит от состояния: в меню прибой слышнее, в доме тише. */
  setAmbienceTarget(level: number): void {
    this.ambienceTarget = clamp01(level);
    this.applyVolumes();
  }

  startAmbience(): void {
    if (!this.context || this.ambienceStarted || !this.ambience) return;
    const ctx = this.context;

    const buffer = this.createNoiseBuffer(ctx, 6);
    const surf = ctx.createBufferSource();
    surf.buffer = buffer;
    surf.loop = true;

    const surfFilter = ctx.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 520;
    surfFilter.Q.value = 0.6;

    const surfGain = ctx.createGain();
    surfGain.gain.value = 0.34;

    // Медленная «дыхательная» модуляция — волны накатывают и отходят.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.075;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.16;
    lfo.connect(lfoGain).connect(surfGain.gain);

    surf.connect(surfFilter).connect(surfGain).connect(this.ambience);

    const wind = ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 1150;
    windFilter.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    const windLfo = ctx.createOscillator();
    windLfo.type = 'sine';
    windLfo.frequency.value = 0.043;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.03;
    windLfo.connect(windLfoGain).connect(windGain.gain);
    wind.connect(windFilter).connect(windGain).connect(this.ambience);

    surf.start();
    wind.start();
    lfo.start();
    windLfo.start();
    this.ambienceStarted = true;
  }

  /** Короткие звуки интерфейса: дают мгновенную обратную связь на действие (§6.3). */
  playUi(kind: UiSoundKind): void {
    if (!this.context || !this.sfx || this.context.state !== 'running') return;
    switch (kind) {
      case 'hover':
        this.tone(1150, 1120, 'sine', 0.055, 0.05);
        break;
      case 'click':
        this.tone(560, 360, 'triangle', 0.1, 0.11);
        break;
      case 'back':
        this.tone(360, 220, 'triangle', 0.12, 0.09);
        break;
      case 'confirm':
        this.tone(520, 780, 'triangle', 0.13, 0.1);
        this.tone(780, 1040, 'sine', 0.16, 0.06, 0.06);
        break;
    }
  }

  // ——— звуки ремонта и предметов (задача 7) ————————————————————

  /** Взяли предмет: короткий «чпок» с металлическим призвуком. */
  playPickup(): void {
    this.tone(430, 620, 'triangle', 0.12, 0.1);
    this.tone(880, 1180, 'sine', 0.09, 0.05, 0.05);
  }

  /** Макнуть валик в банку: влажный булькающий звук. */
  playDip(): void {
    this.tone(180, 90, 'sine', 0.22, 0.16);
    this.noiseBurst(0.18, 0.09, 620, 'lowpass');
  }

  /** Капля краски упала на плёнку. */
  playSplat(): void {
    this.noiseBurst(0.09, 0.05, 1400, 'bandpass');
  }

  /** Петля валика по стене: включается в режиме покраски, громкость — по движению. */
  startRoller(): void {
    if (this.rollerSource || !this.context || !this.sfx || this.context.state !== 'running') return;
    const ctx = this.context;
    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 2.4);
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 780;
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    noise.connect(filter).connect(gain).connect(this.sfx);
    noise.start();
    this.rollerSource = noise;
    this.rollerGain = gain;
  }

  /** 0 — валик стоит, 1 — вовсю трёт. */
  setRollerIntensity(value: number): void {
    const gain = this.rollerGain;
    if (!gain || !this.context) return;
    const target = Math.max(0.0001, Math.min(0.16, value * 0.16));
    gain.gain.cancelScheduledValues(this.context.currentTime);
    gain.gain.setTargetAtTime(target, this.context.currentTime, 0.05);
  }

  stopRoller(): void {
    try {
      this.rollerSource?.stop();
    } catch {
      // источник уже остановлен — это нормально
    }
    this.rollerSource = null;
    this.rollerGain = null;
  }

  // ——— звуки мяча и кольца (задача 8) ——————————————————————————

  /** Отскок мяча: чем сильнее удар, тем ниже и громче. */
  playBounce(strength = 1): void {
    const power = Math.max(0.15, Math.min(1, strength));
    this.tone(210 - 70 * power, 96, 'sine', 0.16 * power, 0.075);
    this.noiseBurst(0.08, 0.06 * power, 320, 'lowpass');
  }

  /** Удар в дужку: короткий металлический «дзынь». */
  playRim(): void {
    this.tone(1180, 880, 'triangle', 0.1, 0.06);
    this.tone(1760, 1520, 'sine', 0.05, 0.04, 0.01);
  }

  /** Чистый бросок: шелест сетки. */
  playSwish(): void {
    this.noiseBurst(0.3, 0.075, 3200, 'highpass');
  }

  /** Бросок: короткий выдох-свист. */
  playThrow(power = 1): void {
    this.noiseBurst(0.16, 0.05 + 0.05 * power, 900 + 700 * power, 'bandpass');
  }

  /** Гол: восходящее трезвучие, слышно поверх музыки. */
  playGoal(second = false): void {
    this.tone(523, 523, 'triangle', 0.2, 0.16);
    this.tone(659, 659, 'triangle', 0.2, 0.16, 0.09);
    this.tone(784, 784, 'triangle', 0.22, 0.24, 0.18);
    if (second) this.tone(1046, 1046, 'sine', 0.2, 0.3, 0.28);
  }

  /** Свисток арбитра (задача 22): два тона с дрожанием — слышно на весь стадион. */
  playWhistle(short = true): void {
    const length = short ? 0.2 : 0.42;
    this.tone(2340, 2260, 'sine', 0.13, length);
    this.tone(3120, 3040, 'sine', 0.045, length * 0.85, 0.01);
    this.noiseBurst(length * 1.15, 0.028, 2600, 'bandpass');
  }

  /** Трибуны: шумовая волна, тише при слабом поводе. */
  playCheer(power = 1): void {
    this.noiseBurst(0.85, 0.05 + 0.05 * power, 1400, 'bandpass');
  }

  private noiseBurst(duration: number, peak: number, frequency: number, type: BiquadFilterType): void {
    if (!this.context || !this.sfx) return;
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = this.createNoiseBuffer(ctx, Math.max(0.12, duration));
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    const start = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.sfx);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  suspend(): void {
    if (!this.context || this.suspended) return;
    this.suspended = true;
    void this.context.suspend();
  }

  resume(): void {
    if (!this.context || !this.suspended) return;
    this.suspended = false;
    void this.context.resume();
  }

  dispose(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.stopRoller();
    this.musicEngine?.dispose();
    this.musicEngine = null;
    this.ambienceStarted = false;
    void this.context?.close();
    this.context = null;
  }

  private buildGraph(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);

    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.voice = ctx.createGain();
    this.ambience = ctx.createGain();
    for (const bus of [this.music, this.sfx, this.voice, this.ambience]) bus.connect(this.master);
  }

  private tone(
    frequency: number,
    endFrequency: number,
    type: OscillatorType,
    duration: number,
    peak: number,
    delay = 0,
  ): void {
    if (!this.context || !this.sfx) return;
    const ctx = this.context;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), start + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain).connect(this.sfx);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  /** Бурый шум — основа прибоя и ветра: звучит естественно и не требует файлов. */
  private createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }
}
