import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detector, VAD_TAIL_MS } from './vadListener';

describe('VAD trailing audio', () => {
  it('retains silence after the requested pause before ending a turn', () => {
    assert.equal(VAD_TAIL_MS, 320);
    assert.equal(detector(600).redemptionMs, 920);
    assert.equal(detector(300).redemptionMs, 620);
    assert.equal(detector(600).preSpeechPadMs, 400);
  });
});
