// Reading the header of a WAV recording the chat's dictation or conversation mode uploads.
// Lemonade's transcription endpoint takes WAV only (docs: "Only `wav` audio input is currently
// supported"), so the browser records, decodes and encodes 16 kHz mono PCM itself, and the API
// checks the RIFF/WAVE structure and duration, then converts PCM to 16 kHz mono when needed.

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  // Where the audio starts, and how many bytes of it the data chunk holds.
  dataOffset: number;
  dataBytes: number;
  durationMs: number;
}

// The same audio behind the plain 44-byte header every WAV reader knows: other chunks (a
// `LIST`, macOS's `FLLR` padding) and WAVE_FORMAT_EXTENSIBLE are left out, so the model
// server's parser never meets them.
export function canonicalWav(bytes: Uint8Array, info: WavInfo): Uint8Array {
  const out = new Uint8Array(44 + info.dataBytes);
  const view = new DataView(out.buffer);
  const put = (offset: number, text: string) => {
    for (let index = 0; index < 4; index += 1)
      view.setUint8(offset + index, text.charCodeAt(index));
  };
  const frame = info.channels * (info.bitsPerSample / 8);
  put(0, 'RIFF');
  view.setUint32(4, 36 + info.dataBytes, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, info.channels, true);
  view.setUint32(24, info.sampleRate, true);
  view.setUint32(28, info.sampleRate * frame, true);
  view.setUint16(32, frame, true);
  view.setUint16(34, info.bitsPerSample, true);
  put(36, 'data');
  view.setUint32(40, info.dataBytes, true);
  out.set(bytes.subarray(info.dataOffset, info.dataOffset + info.dataBytes), 44);
  return out;
}

export function whisperWav(bytes: Uint8Array, info: WavInfo): Uint8Array {
  if (info.sampleRate === 16_000 && info.channels === 1 && info.bitsPerSample === 16)
    return canonicalWav(bytes, info);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bytesPerSample = info.bitsPerSample / 8;
  const frames = info.dataBytes / (bytesPerSample * info.channels);
  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < info.channels; channel += 1) {
      const offset = info.dataOffset + (frame * info.channels + channel) * bytesPerSample;
      let sample: number;
      switch (info.bitsPerSample) {
        case 8:
          sample = (view.getUint8(offset) - 128) / 128;
          break;
        case 16:
          sample = view.getInt16(offset, true) / 32768;
          break;
        case 24:
          sample =
            ((view.getUint8(offset) |
              (view.getUint8(offset + 1) << 8) |
              (view.getUint8(offset + 2) << 16)) <<
              8) /
            2147483648;
          break;
        default:
          sample = view.getInt32(offset, true) / 2147483648;
      }
      sum += sample;
    }
    mono[frame] = sum / info.channels;
  }

  const targetRate = 16_000;
  const length = Math.round((frames * targetRate) / info.sampleRate);
  const output = new Uint8Array(44 + length * 2);
  const header = new DataView(output.buffer);
  for (const [offset, label] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const)
    for (let index = 0; index < 4; index += 1)
      header.setUint8(offset + index, label.charCodeAt(index));
  header.setUint32(4, 36 + length * 2, true);
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, targetRate, true);
  header.setUint32(28, targetRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  header.setUint32(40, length * 2, true);

  const cutoff = Math.min(1, targetRate / info.sampleRate);
  const radius = 16 / cutoff;
  for (let index = 0; index < length; index += 1) {
    const center = (index * info.sampleRate) / targetRate;
    let weighted = 0;
    let weights = 0;
    for (
      let source = Math.max(0, Math.ceil(center - radius));
      source <= Math.min(frames - 1, Math.floor(center + radius));
      source += 1
    ) {
      const distance = source - center;
      const phase = Math.PI * distance * cutoff;
      const sinc = phase === 0 ? 1 : Math.sin(phase) / phase;
      const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / radius);
      const weight = cutoff * sinc * window;
      weighted += mono[source]! * weight;
      weights += weight;
    }
    const sample = Math.max(-1, Math.min(1, weights ? weighted / weights : 0));
    header.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return output;
}

const PCM = 1;
const EXTENSIBLE = 0xfffe;

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

// The recording's format and length, or null for anything that is not 8/16/24/32-bit integer
// PCM in a well-formed RIFF/WAVE container (a truncated file, a float or compressed format, a
// data chunk longer than the file, a streaming header with an unknown length).
export function readWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tag(view, 0) !== 'RIFF' || tag(view, 8) !== 'WAVE') return null;
  let format: { code: number; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.byteLength) return null;
      let code = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE names the real format in the first two bytes of its sub-format.
      if (code === EXTENSIBLE && size >= 40 && body + 26 <= bytes.byteLength) {
        code = view.getUint16(body + 24, true);
      }
      format = {
        code,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!format || format.code !== PCM) return null;
      if (size === 0xffffffff || body + size > bytes.byteLength) return null;
      const { channels, sampleRate, bits } = format;
      if (channels < 1 || channels > 2) return null;
      if (![8, 16, 24, 32].includes(bits)) return null;
      if (sampleRate < 8000 || sampleRate > 48000) return null;
      const frameBytes = channels * (bits / 8);
      if (size % frameBytes !== 0) return null;
      return {
        sampleRate,
        channels,
        bitsPerSample: bits,
        dataOffset: body,
        dataBytes: size,
        durationMs: Math.round((size / frameBytes / sampleRate) * 1000),
      };
    }
    // Chunks are padded to an even length.
    offset = body + size + (size % 2);
  }
  return null;
}
