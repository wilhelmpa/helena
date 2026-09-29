import { describe, it } from 'node:test';
import { strict as expect } from 'node:assert';
import { ApiError } from '@/lib/api/core/client';
import { MicrophoneError } from '../browser/recorder';
import { dictationProblem } from './dictationProblem';

describe('dictation states', () => {
  it('distinguishes permission and missing hardware from server failures', () => {
    expect.equal(dictationProblem('blocked'), 'blocked');
    expect.equal(dictationProblem('failed', new MicrophoneError('missing')), 'missing');
    expect.equal(
      dictationProblem('failed', new ApiError(502, 'Unavailable', 'voice-local-failed')),
      'transcribe-failed',
    );
    expect.equal(dictationProblem('failed', new TypeError('fetch failed')), 'transcribe-failed');
  });

  it('keeps silence, browser network loss and length limit distinct', () => {
    expect.equal(dictationProblem('nothing-heard'), 'nothing-heard');
    expect.equal(dictationProblem('network'), 'recognition-failed');
    expect.equal(dictationProblem('limit'), 'limit');
  });
});
