import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { turnTimings } from './turnTimings';

describe('turnTimings', () => {
  it('splits a turn into parts that add up', () => {
    const timings = turnTimings({
      stoppedAt: 1000,
      heardAt: 1600,
      transcribedAt: 1900,
      sentAt: 1910,
      answerAt: 2500,
      audibleAt: 2800,
    });
    assert.deepEqual(timings, {
      pauseMs: 600,
      transcribeMs: 310,
      answerMs: 590,
      voiceMs: 300,
      totalMs: 1800,
    });
    const { pauseMs, transcribeMs, answerMs, voiceMs, totalMs } = timings;
    assert.equal(pauseMs + transcribeMs + answerMs + voiceMs, totalMs);
  });

  it('never goes backwards when a mark is missing', () => {
    const timings = turnTimings({ stoppedAt: 0, heardAt: 500, audibleAt: 400 });
    assert.equal(timings.transcribeMs, 0);
    assert.equal(timings.voiceMs, 0);
    assert.equal(timings.totalMs, 500);
  });

  it('reports the first bridging sound separately from the real answer', () => {
    const timings = turnTimings({
      stoppedAt: 1000,
      heardAt: 1460,
      firstSoundAt: 1850,
      firstSoundKind: 'bridge',
      transcribedAt: 1900,
      sentAt: 1910,
      answerAt: 2400,
      audibleAt: 2800,
    });
    assert.equal(timings.firstSoundMs, 850);
    assert.equal(timings.firstSoundKind, 'bridge');
    assert.equal(timings.totalMs, 1800);
  });
});
