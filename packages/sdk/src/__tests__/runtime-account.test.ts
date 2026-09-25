import { describe, expect, test } from 'bun:test';
import { REQUEST_CAPABILITY, normalizeRuntimeAccount } from '../index';

const account = {
  signedIn: true,
  method: 'chatgpt',
  email: 'owner@example.com',
  plan: 'pro',
  organization: null,
  refreshedAt: '2026-09-25T08:00:00Z',
  checkedAt: '2026-09-25T10:00:00Z',
  command: 'sudo -u volition-hermes /usr/local/bin/codex login --device-auth',
};

describe('normalizeRuntimeAccount', () => {
  test('keeps the known fields', () => {
    expect(normalizeRuntimeAccount(account)).toEqual({
      ...account,
      refreshedAt: '2026-09-25T08:00:00.000Z',
      checkedAt: '2026-09-25T10:00:00.000Z',
    });
  });

  test('drops fields it does not know, a token among them', () => {
    const normalized = normalizeRuntimeAccount({
      ...account,
      access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
      tokens: { refresh_token: 'rt_abc' },
    });
    expect(Object.keys(normalized ?? {}).sort()).toEqual(
      [
        'checkedAt',
        'command',
        'email',
        'method',
        'organization',
        'plan',
        'refreshedAt',
        'signedIn',
      ].sort(),
    );
    expect(JSON.stringify(normalized)).not.toContain('eyJ');
    expect(JSON.stringify(normalized)).not.toContain('rt_abc');
  });

  test('refuses a token-like value in a word field', () => {
    const normalized = normalizeRuntimeAccount({
      ...account,
      plan: 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789',
      organization: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
      email: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9abcdef@x.y',
    });
    expect(normalized?.plan).toBeNull();
    expect(normalized?.organization).toBeNull();
    expect(normalized?.email).toBeNull();
  });

  test('a login that is gone names no account', () => {
    const normalized = normalizeRuntimeAccount({ ...account, signedIn: false });
    expect(normalized).toMatchObject({
      signedIn: false,
      email: null,
      plan: null,
      refreshedAt: null,
      command: account.command,
    });
  });

  test('refuses a value without a time, and a command over several lines', () => {
    expect(normalizeRuntimeAccount({ signedIn: true })).toBeNull();
    expect(normalizeRuntimeAccount(null)).toBeNull();
    expect(normalizeRuntimeAccount({ ...account, command: 'a\nb' })?.command).toBeNull();
    expect(normalizeRuntimeAccount({ ...account, signedIn: 'yes' })?.signedIn).toBeNull();
  });
});

describe('runtime requests', () => {
  test('the login ops have capabilities', () => {
    expect(REQUEST_CAPABILITY['login.read']).toBe('login');
    expect(REQUEST_CAPABILITY['login.logout']).toBe('logout');
  });
});
