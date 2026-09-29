import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markVoiceOutput, subscribeVoiceOutput, voiceOutputActive } from './voiceOutput';

describe('voice output guard', () => {
  it('keeps wake listening paused until every voice has stopped', () => {
    const first = Symbol('first');
    const second = Symbol('second');
    const states: boolean[] = [];
    const unsubscribe = subscribeVoiceOutput(() => states.push(voiceOutputActive()));
    markVoiceOutput(first, true);
    markVoiceOutput(second, true);
    markVoiceOutput(first, false);
    assert.equal(voiceOutputActive(), true);
    markVoiceOutput(second, false);
    unsubscribe();
    assert.deepEqual(states, [true, false]);
  });
});
