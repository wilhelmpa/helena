import { describe, it, expect } from 'bun:test';
import { localOwnerAuthorized } from './local-owner';

const token = 'test-only-local-owner-token-1234567890';
const configured = {
  HELENA_LOCAL_SIGN_IN_MODE: 'single-user',
  LOCAL_SINGLE_USER_TOKEN: token,
  LOCAL_SINGLE_USER_EMAIL: 'owner@example.test',
};
describe('local owner capability', () => {
  it('is disabled without explicit owner and token', () => {
    expect(localOwnerAuthorized(new Headers(), {})).toBe(false);
    expect(
      localOwnerAuthorized(new Headers({ 'x-volition-local-access': token }), {
        LOCAL_SINGLE_USER_TOKEN: token,
      }),
    ).toBe(false);
  });
  it('never interprets a LAN capability as a person in personal or unconfigured mode', () => {
    for (const mode of [undefined, '', 'personal', 'Single-user']) {
      expect(
        localOwnerAuthorized(new Headers({ 'x-volition-local-access': token }), {
          ...configured,
          HELENA_LOCAL_SIGN_IN_MODE: mode,
        }),
      ).toBe(false);
    }
  });
  it('requires the exact strong proxy capability', () => {
    for (const supplied of ['', 'incorrect', 'ö'.repeat(token.length), token + 'x']) {
      expect(
        localOwnerAuthorized(new Headers({ 'x-volition-local-access': supplied }), configured),
      ).toBe(false);
    }
    expect(
      localOwnerAuthorized(new Headers({ 'x-volition-local-access': token }), configured),
    ).toBe(true);
  });
});
