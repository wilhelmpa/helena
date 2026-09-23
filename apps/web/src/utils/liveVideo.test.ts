import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { avcDescription, fragmentSample } from './liveVideo';

// A top-level MP4 box: a 4-byte big-endian size, the 4-byte ASCII type, then the payload.
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const payload = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    payload.set(part, offset);
    offset += part.length;
  }
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// A length-prefixed NAL unit, as the sample data inside an mdat box carries it.
function nal(type: number, refIdc = 3, extra: number[] = []): Uint8Array {
  const unit = new Uint8Array([(refIdc << 5) | type, ...extra]);
  const out = new Uint8Array(4 + unit.length);
  new DataView(out.buffer).setUint32(0, unit.length);
  out.set(unit, 4);
  return out;
}

describe('avcDescription', () => {
  it('returns an avcC box\'s payload, wherever it sits in the buffer', () => {
    const avcC = box('avcC', new Uint8Array([0x01, 0x64, 0x00, 0x1f, 0xff, 0xe1]));
    const init = concat(box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d])), box('moov', avcC));
    assert.deepEqual([...avcDescription(init)], [0x01, 0x64, 0x00, 0x1f, 0xff, 0xe1]);
  });

  it('throws when the initialization segment has no avcC box', () => {
    assert.throws(() => avcDescription(box('ftyp', new Uint8Array([1, 2, 3]))), /No H.264 configuration/);
  });
});

describe('fragmentSample', () => {
  it('reads the sample after the moof box, from its own declared size', () => {
    const moof = box('moof', new Uint8Array([9, 9, 9]));
    const sample = concat(nal(1), nal(5, 3, [0xaa, 0xbb]));
    const fragment = concat(moof, box('mdat', sample));
    assert.deepEqual([...fragmentSample(fragment)], [...sample]);
  });

  it('throws when the fragment has no mdat box after the moof', () => {
    const moof = box('moof', new Uint8Array([1]));
    assert.throws(() => fragmentSample(concat(moof, box('free'))), /No frame in the fragment/);
  });
});
