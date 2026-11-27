/** Длительность mp3 по кадрам — без декодера. Общая проверка для реплик
 *  героя и кассира: ловит битые файлы и «пустые» заглушки. */

const BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BR_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES = [44100, 48000, 32000];

export function mp3Duration(data: Buffer): number | null {
  let offset = 0;
  if (data.slice(0, 3).toString('latin1') === 'ID3') {
    const size =
      ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);
    offset = 10 + size;
  }
  let seconds = 0;
  let frames = 0;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const version = (data[offset + 1] >> 3) & 3; // 3 — MPEG1, 2 — MPEG2, 0 — MPEG2.5
    const layer = (data[offset + 1] >> 1) & 3; // 1 — Layer III
    if (layer !== 1 || version === 1) {
      offset += 1;
      continue;
    }
    const table = version === 3 ? BR_V1_L3 : BR_V2_L3;
    const bitrate = table[(data[offset + 2] >> 4) & 0xf] * 1000;
    const sampleRate = SAMPLE_RATES[(data[offset + 2] >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const padding = (data[offset + 2] >> 1) & 1;
    if (!bitrate || !sampleRate) {
      offset += 1;
      continue;
    }
    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
    if (length < 24) {
      offset += 1;
      continue;
    }
    seconds += samples / sampleRate;
    frames += 1;
    offset += length;
  }
  return frames > 2 ? seconds : null;
}
