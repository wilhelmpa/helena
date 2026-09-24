import { describe, expect, it } from 'bun:test';
import { browserErrorCode } from './browserControl';

describe('browserErrorCode', () => {
  it("knows the router's own messages", () => {
    expect(browserErrorCode(502, 'The browser did not answer')).toBe('unreachable');
    expect(browserErrorCode(503, 'The browser gateway is not running')).toBe('gatewayOff');
    expect(browserErrorCode(404, 'Unknown tab')).toBe('unknownTab');
    expect(browserErrorCode(400, 'Only http and https addresses can be opened')).toBe('badAddress');
  });

  it('falls back on the status, then on a plain failure', () => {
    expect(browserErrorCode(504, undefined)).toBe('unreachable');
    expect(browserErrorCode(503, 'something else')).toBe('gatewayOff');
    expect(browserErrorCode(400, 'Invalid JSON')).toBe('failed');
  });
});
