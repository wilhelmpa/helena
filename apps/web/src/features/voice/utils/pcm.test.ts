import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Pcm16Decoder, SampleBatcher } from './pcm';

function pcm(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

describe('Pcm16Decoder', () => {
  it('turns 16-bit samples into floats', () => {
    const samples = new Pcm16Decoder().push(pcm([0, 16384, -32768]));
    assert.deepEqual([...samples], [0, 0.5, -1]);
  });

  it('keeps a sample split across two chunks', () => {
    const bytes = pcm([1000, -2000, 3000]);
    const decoder = new Pcm16Decoder();
    const first = decoder.push(bytes.subarray(0, 3));
    const second = decoder.push(bytes.subarray(3));
    assert.equal(first.length, 1);
    assert.equal(second.length, 2);
    assert.equal(Math.round(second[0]! * 0x8000), -2000);
    assert.equal(Math.round(second[1]! * 0x8000), 3000);
  });
});

describe('SampleBatcher', () => {
  it('hands out batches of at least the minimum and the rest at the end', () => {
    const batcher = new SampleBatcher(4);
    assert.equal(batcher.add(new Float32Array([1, 2])), null);
    assert.deepEqual([...batcher.add(new Float32Array([3, 4, 5]))!], [1, 2, 3, 4, 5]);
    assert.equal(batcher.add(new Float32Array([6])), null);
    assert.deepEqual([...batcher.flush()!], [6]);
    assert.equal(batcher.flush(), null);
  });
});
