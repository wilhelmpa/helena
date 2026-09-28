import { describe, expect, it } from 'bun:test';
import { wav } from '../fixtures';
import { readWav, whisperWav } from '../../wav';

describe('Whisper WAV input', () => {
  it('downmixes stereo and resamples 48 kHz PCM to 16 kHz mono', () => {
    const source = wav(0.5, { rate: 48_000, channels: 2 });
    const input = new DataView(source.buffer);
    for (let frame = 0; frame < 24_000; frame += 1) {
      const sample = Math.round(12000 * Math.sin((2 * Math.PI * 440 * frame) / 48_000));
      input.setInt16(44 + frame * 4, sample, true);
      input.setInt16(46 + frame * 4, sample / 2, true);
    }
    const info = readWav(source)!;
    const converted = whisperWav(source, info);
    expect(readWav(converted)).toMatchObject({
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16,
      durationMs: 500,
    });
    const output = new DataView(converted.buffer);
    expect(converted.byteLength).toBe(44 + 8000 * 2);
    expect(output.getInt16(44 + 100 * 2, true)).toBeCloseTo(-9000, -2);
    expect(whisperWav(converted, readWav(converted)!)).toEqual(converted);
  });

  it('filters frequencies above the new Nyquist limit', () => {
    const source = wav(0.5, { rate: 48_000 });
    const input = new DataView(source.buffer);
    for (let frame = 0; frame < 24_000; frame += 1)
      input.setInt16(
        44 + frame * 2,
        Math.round(20000 * Math.sin((2 * Math.PI * 12000 * frame) / 48_000)),
        true,
      );
    const result = whisperWav(source, readWav(source)!);
    const output = new DataView(result.buffer);
    let peak = 0;
    for (let frame = 50; frame < 7950; frame += 1)
      peak = Math.max(peak, Math.abs(output.getInt16(44 + frame * 2, true)));
    expect(peak).toBeLessThan(100);
  });

  it('converts the local TTS fixture rate of 24 kHz without changing duration', () => {
    const source = wav(1, { rate: 24_000 });
    const input = new DataView(source.buffer);
    for (let frame = 0; frame < 24_000; frame += 1) input.setInt16(44 + frame * 2, 8192, true);
    const result = whisperWav(source, readWav(source)!);
    expect(readWav(result)).toMatchObject({ sampleRate: 16_000, durationMs: 1000 });
    expect(new DataView(result.buffer).getInt16(44 + 8000 * 2, true)).toBeCloseTo(8192, -1);
  });
});
