import { describe, expect, it } from 'bun:test';
import { connectionError } from '../servers';

describe('connectionError', () => {
  it('falls back to the message when a server response is not text', () => {
    expect(
      connectionError({ responseText: { status: 'unavailable' }, message: 'Socket closed' }),
    ).toBe('Socket closed');
    expect(connectionError({ response: 421, message: 'Server unavailable' })).toBe(
      'Server unavailable',
    );
    expect(connectionError({ responseText: '', response: '  Try\n again  ' })).toBe('Try again');
  });

  it('uses a safe fallback for malformed errors without converting objects to text', () => {
    for (const error of [null, undefined, 'failure', 421, { response: {} }, { code: 421 }]) {
      expect(connectionError(error)).toBe('Connection failed');
    }
  });

  it('preserves authentication failures, response priority and the text limit', () => {
    expect(connectionError({ authenticationFailed: true, message: 'details' })).toBe(
      'Authentication failed',
    );
    expect(connectionError({ responseText: 'Rejected', message: 'Socket closed' })).toBe(
      'Rejected',
    );
    expect(connectionError({ message: 'x'.repeat(400) })).toBe('x'.repeat(300));
    expect(connectionError({ code: 'ETIMEDOUT' })).toBe('ETIMEDOUT');
  });
});
