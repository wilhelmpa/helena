import { describe, expect, it } from 'bun:test';
import { SecretGuard, isCredentialField } from './redact';

describe('SecretGuard', () => {
  it('redacts a tracked secret wherever it appears in text', () => {
    const guard = new SecretGuard();
    guard.track('fake-password-4711');
    expect(guard.redact('console error: login failed for fake-password-4711 on submit')).toBe(
      'console error: login failed for [REDACTED] on submit',
    );
  });

  it('redacts every occurrence, not just the first', () => {
    const guard = new SecretGuard();
    guard.track('hunter2');
    expect(guard.redact('hunter2 hunter2 hunter2')).toBe('[REDACTED] [REDACTED] [REDACTED]');
  });

  it('redacts the longest overlapping secret first so no partial residue leaks', () => {
    const guard = new SecretGuard();
    guard.track('123456'); // a TOTP code
    guard.track('pass123456word'); // a password that happens to contain it
    expect(guard.redact('pass123456word')).toBe('[REDACTED]');
  });

  it('leaves text with no tracked secret untouched', () => {
    const guard = new SecretGuard();
    guard.track('a-secret-value');
    expect(guard.redact('nothing sensitive here')).toBe('nothing sensitive here');
  });

  it('stops redacting a secret once forgotten', () => {
    const guard = new SecretGuard();
    guard.track('temp-secret');
    guard.forget('temp-secret');
    expect(guard.redact('temp-secret is here')).toBe('temp-secret is here');
  });

  it('clear() drops every tracked secret at once', () => {
    const guard = new SecretGuard();
    guard.track('a');
    guard.track('bbb');
    guard.clear();
    expect(guard.hasSecrets()).toBe(false);
  });

  it('never tracks a value shorter than the minimum, to avoid mangling unrelated text', () => {
    const guard = new SecretGuard();
    guard.track('ab');
    expect(guard.hasSecrets()).toBe(false);
    expect(guard.redact('ab cd ab')).toBe('ab cd ab');
  });

  it('ignores null/undefined/empty values without throwing', () => {
    const guard = new SecretGuard();
    guard.track(null);
    guard.track(undefined);
    guard.track('');
    expect(guard.hasSecrets()).toBe(false);
  });

  it('redactDeep walks nested objects and arrays, including object keys of nested values', () => {
    const guard = new SecretGuard();
    guard.track('sekret-9000');
    const input = {
      status: 'ok',
      details: { message: 'used sekret-9000 to log in', codes: ['sekret-9000', 'other'] },
    };
    expect(guard.redactDeep(input)).toEqual({
      status: 'ok',
      details: { message: 'used [REDACTED] to log in', codes: ['[REDACTED]', 'other'] },
    });
  });

  it('redactDeep leaves numbers, booleans and null alone', () => {
    const guard = new SecretGuard();
    guard.track('secret-value-here');
    expect(guard.redactDeep({ count: 3, ok: true, missing: null })).toEqual({
      count: 3,
      ok: true,
      missing: null,
    });
  });
});

describe('isCredentialField', () => {
  it('flags a password input', () => {
    expect(isCredentialField({ type: 'password' })).toBe(true);
  });

  it('flags autocomplete current-password / new-password even on a text input', () => {
    expect(isCredentialField({ type: 'text', autocomplete: 'current-password' })).toBe(true);
    expect(isCredentialField({ type: 'text', autocomplete: 'new-password' })).toBe(true);
  });

  it('flags a one-time-code field (2FA)', () => {
    expect(isCredentialField({ type: 'text', autocomplete: 'one-time-code' })).toBe(true);
  });

  it('flags a field named for OTP/TOTP/2FA even without autocomplete hints', () => {
    expect(isCredentialField({ type: 'text', name: 'totp_code' })).toBe(true);
    expect(isCredentialField({ type: 'text', name: 'mfa-input' })).toBe(true);
  });

  it('does not flag an ordinary text field', () => {
    expect(isCredentialField({ type: 'text', name: 'search', autocomplete: 'off' })).toBe(false);
  });
});
