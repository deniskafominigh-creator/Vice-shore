import type { AudioSystem } from '../core/Audio';

/**
 * Дорожка голосов задачи 22 (герой-рассказчик, уличные жители, катсцена).
 *
 *  Один буфер на файл, один источник одновременно: реплики не наезжают друг на
 *  друга. Файлы лежат в `src/assets/voice22` и попадают в сборку через
 *  `import.meta.glob` — если файла нет, `play` честно вернёт false, и сцена
 *  останется на субтитрах (без звука, но не «сыро»: текст на экране есть).
 */

const CLIP_URLS: Record<string, string> = (() => {
  const modules = import.meta.glob('../assets/voice22/*.mp3', {
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

export interface VoiceLine {
  /** Имя файла без расширения — `hi_man_1`. */
  readonly clip: string;
  /** Текст для субтитров: если звука нет, читать всё равно есть что. */
  readonly text: string;
}

export class VoiceBank {
  private readonly buffers = new Map<string, AudioBuffer>();
  private source: AudioBufferSourceNode | null = null;
  private loading = false;

  constructor(private readonly audio: AudioSystem) {}

  get clipCount(): number {
    return Object.keys(CLIP_URLS).length;
  }

  get decodedCount(): number {
    return this.buffers.size;
  }

  get isSpeaking(): boolean {
    return this.source !== null;
  }

  /** Разогрев: декодируем все ролики, пока игрок ходит по острову. */
  async preload(): Promise<void> {
    if (this.loading) return;
    if (this.clipCount === 0) return;
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

  /** Сказать реплику. false — файла нет или звук ещё не разбужен. */
  play(line: VoiceLine): boolean {
    const buffer = this.buffers.get(line.clip);
    const ctx = this.audio.ctx;
    const output = this.audio.voiceOutput;
    this.stop();
    if (!buffer || !ctx || !output || ctx.state !== 'running') return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    source.onended = () => {
      if (this.source === source) this.source = null;
    };
    source.start();
    this.source = source;
    return true;
  }

  /** Длительность ролика — чтобы субтитр жил ровно столько же. */
  duration(line: VoiceLine): number {
    return this.buffers.get(line.clip)?.duration ?? 0;
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // источник уже остановлен — это нормально
    }
  }
}
