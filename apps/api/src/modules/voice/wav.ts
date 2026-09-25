// Reading the header of a WAV recording the chat's dictation or conversation mode uploads.
// Lemonade's transcription endpoint takes WAV only (docs: "Only `wav` audio input is currently
// supported"), so the browser records, decodes and encodes 16 kHz mono PCM itself, and the API
// checks what arrived before it goes on: a RIFF/WAVE file with a PCM format chunk and one data
// chunk, whose length gives the exact duration the limits are measured against.

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  // The bytes of audio in the data chunk.
  dataBytes: number;
  durationMs: number;
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
        dataBytes: size,
        durationMs: Math.round((size / frameBytes / sampleRate) * 1000),
      };
    }
    // Chunks are padded to an even length.
    offset = body + size + (size % 2);
  }
  return null;
}
