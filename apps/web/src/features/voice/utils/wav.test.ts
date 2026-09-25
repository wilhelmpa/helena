import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audioLevel, durationMs, encodeWav16, isSilent } from './wav';

describe('encodeWav16', () => {
  it('writes a 16 kHz mono PCM WAV the API reads back exactly', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
    const bytes = encodeWav16(samples);
    const view = new DataView(bytes.buffer);
    const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    assert.equal(bytes.length, 44 + 12);
    assert.equal(text(0), 'RIFF');
    assert.equal(text(8), 'WAVE');
    assert.equal(text(12), 'fmt ');
    assert.equal(view.getUint16(20, true), 1); // PCM
    assert.equal(view.getUint16(22, true), 1); // mono
    assert.equal(view.getUint32(24, true), 16000);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(text(36), 'data');
    assert.equal(view.getUint32(40, true), 12);
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map((index) => view.getInt16(44 + index * 2, true)),
      // Clipped at full scale.
      [0, 16383, -16384, 32767, -32768, 32767],
    );
  });
});

describe('audio level', () => {
  it('tells silence from speech', () => {
    assert.equal(isSilent(new Float32Array(16000)), true);
    assert.equal(isSilent(new Float32Array(16000).fill(0.001)), true);
    const tone = new Float32Array(16000).map((_, index) => 0.3 * Math.sin(index / 5));
    assert.equal(isSilent(tone), false);
    assert.ok(Math.abs(audioLevel(tone).rms - 0.3 / Math.SQRT2) < 0.01);
    assert.equal(durationMs(tone), 1000);
  });
});
