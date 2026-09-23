import { describe, it, expect } from 'bun:test';
import { HttpError } from '#shared/lib';
import { allowedOrigin, assertTotpSecret, loginOrigins, loginUrlOf } from '../../kinds';

function refused(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch (err) {
    return err instanceof HttpError && err.status === 400;
  }
}

describe('web login fields', () => {
  it('stores an allowed domain as the origin Hermes compares', () => {
    expect(allowedOrigin('GitHub.com')).toBe('https://github.com');
    expect(allowedOrigin('https://github.com:443/')).toBe('https://github.com');
    expect(allowedOrigin('http://localhost:8080')).toBe('http://localhost:8080');
    for (const value of ['*.github.com', 'github.com/login', 'ftp://github.com', 'a b']) {
      expect(refused(() => allowedOrigin(value))).toBe(true);
    }
  });

  it('allows the login URL origin first, once', () => {
    expect(
      loginOrigins('https://github.com/login', ['https://github.com', 'https://gist.github.com']),
    ).toEqual(['https://github.com', 'https://gist.github.com']);
  });

  it('accepts an http(s) login URL without a login in it', () => {
    expect(loginUrlOf(' https://github.com/login ')).toBe('https://github.com/login');
    expect(refused(() => loginUrlOf('javascript:alert(1)'))).toBe(true);
    expect(refused(() => loginUrlOf('https://me:pw@github.com'))).toBe(true);
  });

  it('accepts the authenticator keys Hermes accepts', () => {
    for (const value of [
      'JBSWY3DPEHPK3PXP',
      'jbsw y3dp-ehpk 3pxp',
      'JBSWY3DPEHPK3PXP====',
      'otpauth://totp/GitHub:bot?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256',
    ]) {
      expect(refused(() => assertTotpSecret(value))).toBe(false);
    }
    for (const value of [
      'JBSWY3DPEHPK3PX1',
      'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=9',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5',
      'otpauth://totp/x',
    ]) {
      expect(refused(() => assertTotpSecret(value))).toBe(true);
    }
  });
});
