import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RuntimeLogin, RuntimeLoginsHealth } from '@/lib/api/endpoints/god';
import { loginRows, loginStatus, staleSince } from './runtimeLogins';

function login(fields: Partial<RuntimeLogin>): RuntimeLogin {
  return {
    store: 'hermes',
    provider: 'openai-codex',
    id: 'a1',
    label: null,
    managed: true,
    state: 'ok',
    expiresAt: '2026-10-01T10:00:00.000Z',
    refreshedAt: null,
    error: null,
    command: null,
    note: null,
    ...fields,
  };
}

function health(logins: RuntimeLogin[], stale = false): RuntimeLoginsHealth {
  return {
    reports: [
      {
        source: 'token-keeper',
        reporter: 'helena-token-keeper',
        checkedAt: '2026-09-24T19:50:00.000Z',
        intervalSeconds: 600,
        stale,
        logins,
        errors: [],
      },
    ],
    problems: 0,
  };
}

describe('runtime logins', () => {
  test('a rejected login is the owners, first', () => {
    const rows = loginRows(
      health([
        login({}),
        login({ provider: 'anthropic', id: 'b2', state: 'invalid', command: 'x' }),
      ]),
    );
    assert.deepEqual(
      rows.map((row) => [row.login.provider, row.needsOwner, row.status]),
      [
        ['anthropic', true, 'danger'],
        ['openai-codex', false, 'success'],
      ],
    );
  });

  test('states read in the shared vocabulary', () => {
    assert.equal(loginStatus({ state: 'expiring', managed: true }, false), 'waiting');
    assert.equal(loginStatus({ state: 'error', managed: true }, false), 'danger');
    assert.equal(loginStatus({ state: 'expired', managed: true }, false), 'danger');
    // A login only reported (the Codex CLI's own) is no problem when it runs out.
    assert.equal(loginStatus({ state: 'expired', managed: false }, false), 'idle');
    assert.equal(loginStatus({ state: 'ok', managed: true }, true), 'idle');
  });

  test('a stale report names nothing to act on but says since when', () => {
    const stale = health([login({ state: 'expired' })], true);
    const rows = loginRows(stale);
    assert.equal(rows[0]?.needsOwner, false);
    assert.equal(rows[0]?.status, 'idle');
    assert.equal(staleSince(stale), '2026-09-24T19:50:00.000Z');
    assert.equal(staleSince(health([])), null);
    assert.deepEqual(loginRows(undefined), []);
  });
});
