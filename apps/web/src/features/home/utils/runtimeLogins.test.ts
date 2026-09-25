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
  // By what the owner has to do, not the access token's countdown (owner, 2026-09-24).
  test('a login to sign in again comes first, a renewed one is simply active', () => {
    const rows = loginRows(
      health([
        login({}),
        login({ provider: 'anthropic', id: 'b2', state: 'invalid', command: 'x' }),
      ]),
    );
    assert.deepEqual(
      rows.map((row) => [row.login.provider, row.condition, row.needsOwner, row.status]),
      [
        ['anthropic', 'relogin', true, 'danger'],
        ['openai-codex', 'active', false, 'success'],
      ],
    );
  });

  test('a renewal that fails for now is amber and needs nobody', () => {
    for (const state of ['error', 'expired'] as const) {
      const [row] = loginRows(health([login({ state })]));
      assert.equal(row?.condition, 'renewFailing', state);
      assert.equal(row?.needsOwner, false, state);
      assert.equal(row?.status, 'waiting', state);
    }
    const [soon] = loginRows(health([login({ state: 'expiring' })]));
    assert.equal(soon?.status, 'success');
  });

  test('a login nothing renews needs the owner once it runs out; a separate one never', () => {
    const [ranOut] = loginRows(health([login({ managed: false, state: 'expired' })]));
    assert.equal(ranOut?.needsOwner, true);
    const [cli] = loginRows(
      health([login({ store: 'codex-cli', managed: false, state: 'expired', note: 'separate' })]),
    );
    assert.equal(cli?.condition, 'separate');
    assert.equal(cli?.needsOwner, false);
    assert.equal(cli?.status, 'idle');
  });

  test('states read in the shared vocabulary', () => {
    assert.equal(loginStatus('active', false), 'success');
    assert.equal(loginStatus('renewFailing', false), 'waiting');
    assert.equal(loginStatus('relogin', false), 'danger');
    assert.equal(loginStatus('active', true), 'idle');
  });

  test('a stale report names nothing to act on but says since when', () => {
    const stale = health([login({ state: 'invalid' })], true);
    const rows = loginRows(stale);
    assert.equal(rows[0]?.needsOwner, false);
    assert.equal(rows[0]?.status, 'idle');
    assert.equal(staleSince(stale), '2026-09-24T19:50:00.000Z');
    assert.equal(staleSince(health([])), null);
    assert.deepEqual(loginRows(undefined), []);
  });
});
