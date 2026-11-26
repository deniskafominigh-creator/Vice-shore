import type { Game } from '../../game/Game';

/** Голос кассира (задача 18). Отдельная дорожка от реплик героя:
 *  свой набор mp3 (`src/assets/npc`), свой тембр, без cooldown'ов.
 *  Одновременно звучит одна реплика; музыка приглушается теми же событиями. */

const CLIP_URLS: Record<string, string> = (() => {
  const modules = import.meta.glob('../../assets/npc/*.mp3', {
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

export class SellerVoice {
  private readonly buffers = new Map<string, AudioBuffer>();
  private source: AudioBufferSourceNode | null = null;
  private decoding = false;
  private speakUntil = 0;
  private clock = 0;

  constructor(private readonly game: Game) {}

  /** Сколько роликов вообще пришло сборкой — для проверок и отладки. */
  get clipCount(): number {
    return Object.keys(CLIP_URLS).length;
  }

  get decodedCount(): number {
    return this.buffers.size;
  }

  get isSpeaking(): boolean {
    return this.source !== null || this.clock < this.speakUntil;
  }

  async preload(): Promise<void> {
    if (this.decoding) return;
    const audio = this.game.audio;
    if (!audio.ctx) return;
    this.decoding = true;
    await Promise.all(
      Object.entries(CLIP_URLS).map(async ([name, url]) => {
        if (this.buffers.has(name)) return;
        const buffer = await audio.decodeVoice(url);
        if (buffer) this.buffers.set(name, buffer);
      }),
    );
    this.decoding = false;
  }

  /** Сказать реплику. false — файла нет (панель всё равно покажет текст). */
  play(file: string): boolean {
    const name = file.split('/').pop() ?? '';
    const buffer = this.buffers.get(name);
    const ctx = this.game.audio.ctx;
    const output = this.game.audio.voiceOutput;
    this.stop();
    if (!buffer || !ctx || !output || ctx.state !== 'running') return false;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.game.bus.emit('voice:ended', { id: name });
    };
    source.start();
    this.source = source;
    this.speakUntil = this.clock + buffer.duration + 0.08;
    this.game.bus.emit('voice:started', { id: name });
    return true;
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    this.speakUntil = 0;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // источник уже остановлен — это нормально
    }
    this.game.bus.emit('voice:ended', { id: 'seller' });
  }

  update(dt: number): void {
    this.clock += dt;
  }
}
