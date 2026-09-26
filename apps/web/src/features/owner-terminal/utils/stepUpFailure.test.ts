import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '@/lib/api/core/client';
import { stepUpFailure } from './stepUpFailure';

test('terminal failures distinguish invalid codes, setup, throttling and technical errors', () => {
  assert.equal(stepUpFailure(new ApiError(400, 'test', 'TERMINAL_INVALID_CODE')), 'wrongCode');
  assert.equal(stepUpFailure(new ApiError(400, 'legacy server')), 'wrongCode');
  assert.equal(
    stepUpFailure(new ApiError(409, 'test', 'TERMINAL_TOTP_NOT_ENABLED')),
    'setupRequired',
  );
  assert.equal(stepUpFailure(new ApiError(429, 'test')), 'rateLimited');
  for (const status of [401, 403, 409, 500, 503])
    assert.equal(stepUpFailure(new ApiError(status, 'test')), 'unavailable');
  assert.equal(stepUpFailure(new TypeError('Network failed')), 'unavailable');
});
