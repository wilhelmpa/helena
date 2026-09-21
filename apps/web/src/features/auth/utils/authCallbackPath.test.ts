import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authCallbackPath } from './authCallbackPath';

describe('authCallbackPath', () => {
  it('keeps a local path and query string', () => {
    assert.equal(authCallbackPath('/project/VERV?view=board'), '/project/VERV?view=board');
  });

  it('falls back to the application root for external and login URLs', () => {
    assert.equal(authCallbackPath('https://example.com'), '/');
    assert.equal(authCallbackPath('//example.com'), '/');
    assert.equal(authCallbackPath('/login?error=failed'), '/');
  });
});
