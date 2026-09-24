import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { browserErrorCode } from './browserControl';

describe('browserErrorCode', () => {
  it("knows the router's own messages", () => {
    assert.equal(browserErrorCode(502, 'The browser did not answer'), 'unreachable');
    assert.equal(browserErrorCode(503, 'The browser gateway is not running'), 'gatewayOff');
    assert.equal(browserErrorCode(404, 'Unknown tab'), 'unknownTab');
    assert.equal(
      browserErrorCode(400, 'Only http and https addresses can be opened'),
      'badAddress',
    );
  });

  it('falls back on the status, then on a plain failure', () => {
    assert.equal(browserErrorCode(504, undefined), 'unreachable');
    assert.equal(browserErrorCode(503, 'something else'), 'gatewayOff');
    assert.equal(browserErrorCode(400, 'Invalid JSON'), 'failed');
  });
});
