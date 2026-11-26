/** Музыкальный движок: живой секвенсор на Web Audio.
 *
 *  Почему не зацикленные буферы: трек из буфера требует точных loop-точек и всё равно
 *  даёт щелчок на стыке; живой секвенсор играет «вперёд» по сетке, поэтому стыков нет
 *  по построению, а слои (бас, арпеджио, перкуссия) можно плавно вводить и убирать —
 *  именно это нужно для перехода «меню → прогулка → миссия» (GOAL.md §7, задача 3).
 *
 *  Никаких внешних файлов: все инструменты синтезируются. */

export type MusicMood = 'menu' | 'explore' | 'mission';
export type MusicStinger = 'success' | 'fail' | 'quest';

interface LayerMix {
  readonly pad: number;
  readonly bass: number;
  readonly arp: number;
  readonly perc: number;
  readonly lead: number;
}

interface MoodPreset {
  /** Удары в минуту. */
  readonly tempo: number;
  /** MIDI-нота тоники. */
  readonly root: number;
  /** Аккорды: полутоны от тоники, по одному на такт. */
  readonly chords: ReadonlyArray<readonly number[]>;
  readonly mix: LayerMix;
  /** 16 шагов такта: 0 — пауза, 1..4 — ступень аккорда. */
  readonly arpSteps: readonly number[];
  /** 16 шагов: 0 — пауза, 1 — Bass-удар, 2 — акцент. */
  readonly bassSteps: readonly number[];
  /** 16 шагов: 0 — пауза, 1 — хэт, 2 — бочка, 3 — снейр. */
  readonly percSteps: readonly number[];
  /** 16 шагов мелодического мотива (0 — пауза, 1..4 — ступень). */
  readonly leadSteps: readonly number[];
}

const PRESETS: Readonly<Record<MusicMood, MoodPreset>> = {
  // Спокойный чиллвейв: только подложка и тихий бас.
  menu: {
    tempo: 82,
    root: 57, // A3
    chords: [
      [0, 3, 7, 10], // Am7
      [-4, 0, 3, 7], // Fmaj7
      [3, 7, 10, 14], // Cmaj7
      [-2, 2, 5, 9], // G6
    ],
    mix: { pad: 0.42, bass: 0.24, arp: 0.11, perc: 0, lead: 0 },
    arpSteps: [1, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0],
    bassSteps: [1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
    percSteps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    leadSteps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Прогулка: тот же материал, но с ритмом и арпеджио.
  explore: {
    tempo: 96,
    root: 57,
    chords: [
      [0, 3, 7, 10],
      [-4, 0, 3, 7],
      [3, 7, 10, 14],
      [-2, 2, 5, 9],
    ],
    mix: { pad: 0.3, bass: 0.32, arp: 0.16, perc: 0.13, lead: 0 },
    arpSteps: [1, 0, 2, 0, 3, 0, 4, 0, 3, 0, 2, 0, 4, 0, 2, 0],
    bassSteps: [1, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 2, 0, 0],
    percSteps: [1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 1, 3, 0, 1, 1, 0],
    leadSteps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Миссия: тот же гармонический материал, но плотнее и с мотивом.
  mission: {
    tempo: 108,
    root: 57,
    chords: [
      [0, 3, 7, 10],
      [5, 8, 12, 15],
      [-4, 0, 3, 7],
      [2, 5, 9, 12],
    ],
    mix: { pad: 0.32, bass: 0.4, arp: 0.21, perc: 0.21, lead: 0.12 },
    arpSteps: [1, 0, 2, 3, 0, 4, 2, 0, 3, 0, 2, 4, 0, 3, 1, 0],
    bassSteps: [1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 1, 2, 0, 1, 2, 0],
    percSteps: [2, 0, 1, 1, 3, 0, 1, 0, 2, 0, 1, 3, 0, 1, 1, 1],
    leadSteps: [0, 0, 0, 0, 3, 0, 0, 4, 0, 0, 0, 0, 2, 0, 0, 0],
  },
};

const STINGER_NOTES: Readonly<Record<MusicStinger, readonly number[]>> = {
  success: [0, 4, 7, 12, 16],
  fail: [0, -3, -7, -12],
  quest: [0, 7, 12],
};

const midiToFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export class MusicEngine {
  private readonly input: GainNode;
  private readonly output: GainNode;
  private readonly duckGain: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly layers: Record<keyof LayerMix, GainNode>;

  private active: MoodPreset = PRESETS.menu;
  private pending: MoodPreset | null = null;
  private pendingFade = 2;
  private currentMood: MusicMood | null = null;

  private step = 0;
  private bar = 0;
  private chordIndex = 0;
  private nextStepTime = 0;
  private timer: number | null = null;
  private noise: AudioBuffer | null = null;
  private suspended = false;
  private ducked = false;
  private disposed = false;

  private static readonly LOOKAHEAD = 0.25;
  private static readonly TICK_MS = 25;
  private static readonly DUCK_LEVEL = 0.35; // ≈ −9 дБ

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.input = ctx.createGain();
    this.input.gain.value = 1;

    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1;

    this.output = ctx.createGain();
    this.output.gain.value = 0;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.createImpulse(1.9);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.22;

    this.input.connect(this.duckGain);
    this.input.connect(reverbSend);
    reverbSend.connect(this.reverb);
    this.reverb.connect(this.duckGain);
    // Лимитер на выходе: плотный аккорд с арпеджио не должен клиповать.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -14;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 5;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.25;

    this.duckGain.connect(this.output);
    this.output.connect(this.limiter);
    this.limiter.connect(destination);

    this.noise = this.createNoise(1.5);

    const makeLayer = (): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.input);
      return gain;
    };
    this.layers = {
      pad: makeLayer(),
      bass: makeLayer(),
      arp: makeLayer(),
      perc: makeLayer(),
      lead: makeLayer(),
    };
  }

  get mood(): MusicMood | null {
    return this.currentMood;
  }

  get isPlaying(): boolean {
    return this.timer !== null && !this.suspended;
  }

  /** Запуск музыки с нужным настроением (после первого действия пользователя). */
  start(mood: MusicMood): void {
    if (this.disposed) return;
    if (this.currentMood === mood && this.timer !== null) return;
    this.currentMood = mood;
    this.applyPreset(PRESETS[mood], 0.7);
    this.fadeOutput(0.75);
    this.runScheduler();
  }

  /** Смена настроения: громкости слоёв перетекают, темп и гармония — с нового такта. */
  setMood(mood: MusicMood, fadeSeconds = 2): void {
    if (this.disposed) return;
    if (this.currentMood === mood) return;
    this.currentMood = mood;
    this.pending = PRESETS[mood];
    this.pendingFade = fadeSeconds;
    if (this.timer === null) {
      // Музыка ещё не играла — стартуем сразу, без ожидания такта.
      this.applyPreset(this.pending, fadeSeconds);
      this.pending = null;
      this.fadeOutput(0.75);
      this.runScheduler();
    }
  }

  /** Приглушение под реплику героя (−9 дБ) — GOAL.md §7, задача 3, п.3. */
  setDucked(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    const target = ducked ? MusicEngine.DUCK_LEVEL : 1;
    this.duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, ducked ? 0.12 : 0.35);
  }

  /** Короткая музыкальная фраза: успех, провал, новая задача. */
  playStinger(kind: MusicStinger): void {
    if (this.disposed || this.suspended) return;
    const notes = STINGER_NOTES[kind];
    const now = this.ctx.currentTime + 0.02;
    const stepSeconds = 0.11;
    notes.forEach((semitone, index) => {
      this.playPluck(now + index * stepSeconds, midiToFrequency(this.active.root + 12 + semitone), 0.5, 0.5);
    });
  }

  /** Вкладка потеряла фокус: музыка замолкает и не «догоняет» пропущенное время. */
  setSuspended(suspended: boolean): void {
    if (this.disposed || this.suspended === suspended) return;
    this.suspended = suspended;
    if (suspended) {
      this.fadeOutput(0.15);
      this.stopScheduler();
    } else {
      this.nextStepTime = this.ctx.currentTime + 0.08;
      this.fadeOutput(0.6);
      this.runScheduler();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopScheduler();
    this.reverb.buffer = null;
    this.input.disconnect();
    this.duckGain.disconnect();
    this.output.disconnect();
    this.limiter.disconnect();
  }

  // ——— секвенсор ————————————————————————————————————————

  private runScheduler(): void {
    if (this.timer !== null || this.disposed) return;
    if (this.nextStepTime < this.ctx.currentTime) this.nextStepTime = this.ctx.currentTime + 0.07;
    this.timer = window.setInterval(this.tick, MusicEngine.TICK_MS);
    this.tick();
  }

  private stopScheduler(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private readonly tick = (): void => {
    if (this.disposed) return;
    const horizon = this.ctx.currentTime + MusicEngine.LOOKAHEAD;
    let guard = 0;
    while (this.nextStepTime < horizon && guard < 64) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.nextStepTime += 60 / this.active.tempo / 4;
      this.step += 1;
      if (this.step >= 16) {
        this.step = 0;
        this.onBarBoundary();
      }
      guard += 1;
    }
  };

  private onBarBoundary(): void {
    this.bar += 1;
    this.chordIndex = (this.chordIndex + 1) % this.active.chords.length;
    if (this.pending) {
      this.applyPreset(this.pending, this.pendingFade);
      this.pending = null;
    }
  }

  private applyPreset(preset: MoodPreset, fade: number): void {
    this.active = preset;
    const time = this.ctx.currentTime;
    const tau = Math.max(0.05, fade / 3);
    for (const [name, gain] of Object.entries(this.layers) as [keyof LayerMix, GainNode][]) {
      gain.gain.setTargetAtTime(preset.mix[name], time, tau);
    }
    this.chordIndex = this.bar % preset.chords.length;
  }

  private scheduleStep(step: number, time: number): void {
    const preset = this.active;
    const chord = preset.chords[this.chordIndex] ?? preset.chords[0] ?? [];
    if (step === 0) this.playPad(time, chord, preset);

    const bass = preset.bassSteps[step] ?? 0;
    if (bass > 0) {
      const note = preset.root + (chord[0] ?? 0) - 24 + (bass === 2 ? 7 : 0);
      this.playBass(time, midiToFrequency(note), bass === 2 ? 0.5 : 0.34);
    }

    const arp = preset.arpSteps[step] ?? 0;
    if (arp > 0) {
      const note = preset.root + 12 + (chord[(arp - 1) % Math.max(1, chord.length)] ?? 0);
      this.playPluck(time, midiToFrequency(note), 0.24, 0.32);
    }

    const perc = preset.percSteps[step] ?? 0;
    if (perc === 1) this.playHat(time);
    else if (perc === 2) this.playKick(time);
    else if (perc === 3) this.playSnare(time);

    const lead = preset.leadSteps[step] ?? 0;
    if (lead > 0) {
      const note = preset.root + 24 + (chord[(lead - 1) % Math.max(1, chord.length)] ?? 0);
      this.playPluck(time, midiToFrequency(note), 0.2, 0.55);
    }
  }

  // ——— инструменты ————————————————————————————————————————

  private playPad(time: number, chord: readonly number[], preset: MoodPreset): void {
    const duration = (60 / preset.tempo) * 4;
    const level = 0.16;
    for (const semitone of chord) {
      const frequency = midiToFrequency(preset.root + semitone);
      for (const detune of [-6, 6]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = frequency;
        osc.detune.value = detune;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(520, time);
        filter.frequency.linearRampToValueAtTime(1500, time + duration * 0.5);
        filter.frequency.linearRampToValueAtTime(600, time + duration);
        filter.Q.value = 0.7;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.linearRampToValueAtTime(level / chord.length, time + 0.35);
        gain.gain.linearRampToValueAtTime(0.0001, time + duration * 1.05);

        osc.connect(filter).connect(gain).connect(this.layers.pad);
        osc.start(time);
        osc.stop(time + duration * 1.1);
      }
    }
  }

  private playBass(time: number, frequency: number, level: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;

    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = frequency / 2;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, time);
    filter.frequency.exponentialRampToValueAtTime(160, time + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);

    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, time);
    subGain.gain.exponentialRampToValueAtTime(level * 0.5, time + 0.015);
    subGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);

    osc.connect(filter).connect(gain).connect(this.layers.bass);
    sub.connect(subGain).connect(this.layers.bass);
    osc.start(time);
    sub.start(time);
    osc.stop(time + 0.45);
    sub.stop(time + 0.32);
  }

  private playPluck(time: number, frequency: number, level: number, decay: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;

    const shimmer = this.ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = frequency * 2;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, time);
    filter.frequency.exponentialRampToValueAtTime(900, time + decay);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);

    const shimmerGain = this.ctx.createGain();
    shimmerGain.gain.setValueAtTime(0.0001, time);
    shimmerGain.gain.exponentialRampToValueAtTime(level * 0.18, time + 0.01);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, time + decay * 0.6);

    osc.connect(filter).connect(gain).connect(this.layers.arp);
    shimmer.connect(shimmerGain).connect(this.layers.arp);
    osc.start(time);
    shimmer.start(time);
    osc.stop(time + decay + 0.05);
    shimmer.stop(time + decay);
  }

  private playHat(time: number): void {
    if (!this.noise) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 1.6;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.16, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);

    source.connect(filter).connect(gain).connect(this.layers.perc);
    source.start(time);
    source.stop(time + 0.07);
  }

  private playKick(time: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(132, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.16);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.5, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);

    osc.connect(gain).connect(this.layers.perc);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  private playSnare(time: number): void {
    if (!this.noise) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 0.9;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);

    source.connect(filter).connect(gain).connect(this.layers.perc);
    source.start(time);
    source.stop(time + 0.15);
  }

  // ——— вспомогательное ——————————————————————————————————

  private fadeOutput(target: number): void {
    this.output.gain.setTargetAtTime(target, this.ctx.currentTime, 0.35);
  }

  private createImpulse(seconds: number): AudioBuffer {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const decay = (1 - i / length) ** 2.6;
        data[i] = (Math.random() * 2 - 1) * decay * 0.6;
      }
    }
    return buffer;
  }

  private createNoise(seconds: number): AudioBuffer {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
