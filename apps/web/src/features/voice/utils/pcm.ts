// Raw 16-bit little-endian mono PCM as Helena's local voice streams it (API /voice/speech with a
// server that generates as it goes, e.g. Qwen3-TTS at 24 kHz): the bytes arrive in network
// chunks that may split a sample, and are played as they come (browser/speakers.ts).

export class Pcm16Decoder {
  private carry: number | null = null;

  // The samples in `bytes` (-1…1), with a byte left over from the chunk before put in front.
  push(bytes: Uint8Array): Float32Array {
    let data = bytes;
    if (this.carry !== null) {
      const joined = new Uint8Array(bytes.byteLength + 1);
      joined[0] = this.carry;
      joined.set(bytes, 1);
      data = joined;
      this.carry = null;
    }
    const whole = data.byteLength - (data.byteLength % 2);
    if (whole < data.byteLength) this.carry = data[data.byteLength - 1]!;
    const samples = new Float32Array(whole / 2);
    const view = new DataView(data.buffer, data.byteOffset, whole);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 0x8000;
    }
    return samples;
  }
}

// Samples collected until there are at least `min` of them: a chunk of a few milliseconds is
// not worth a node of its own.
export class SampleBatcher {
  private parts: Float32Array[] = [];
  private size = 0;

  // Changeable: a stream starts with small batches (the first sound soon) and goes on with
  // larger ones.
  constructor(public min: number) {}

  add(samples: Float32Array): Float32Array | null {
    if (samples.length > 0) {
      this.parts.push(samples);
      this.size += samples.length;
    }
    return this.size >= this.min ? this.take() : null;
  }

  // Whatever is left (at the end of the stream).
  flush(): Float32Array | null {
    return this.size > 0 ? this.take() : null;
  }

  private take(): Float32Array {
    const out = new Float32Array(this.size);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    this.parts = [];
    this.size = 0;
    return out;
  }
}
