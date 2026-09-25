// Recordings as Helena's transcription takes them: WAV, 16 kHz, mono, 16-bit PCM — what Whisper
// works on and the only input Lemonade's transcription accepts. The conversation mode's voice
// detector already hands over 16 kHz samples; dictation records with the browser's
// MediaRecorder (webm/opus, mp4/aac) and decodes and resamples before the upload
// (browser/recorder.ts). 16 kHz mono PCM is 32 KB per second.

export const WHISPER_RATE = 16_000;

// Float samples (-1…1) as a 16-bit PCM WAV file.
export function encodeWav16(samples: Float32Array, sampleRate = WHISPER_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  put(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

// How loud a recording is: its peak and its RMS level (both 0…1).
export function audioLevel(samples: Float32Array): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index]!);
    if (value > peak) peak = value;
    sum += value * value;
  }
  return { peak, rms: samples.length ? Math.sqrt(sum / samples.length) : 0 };
}

// A recording with nothing in it (a muted or wrong microphone, a click on and off): sending it
// would only give Whisper room to invent words. About -46 dBFS at its loudest.
export function isSilent(samples: Float32Array): boolean {
  return audioLevel(samples).peak < 0.005;
}

export function durationMs(samples: Float32Array, sampleRate = WHISPER_RATE): number {
  return Math.round((samples.length / sampleRate) * 1000);
}
