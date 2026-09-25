import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentLogin, SharedLogin } from '@/lib/api/endpoints/accessLogins';
import {
  agentLoginStatus,
  agentNeedsOwner,
  orderedAgentLogins,
  orderedSharedLogins,
  planLabel,
  sharedLoginStatus,
  sharedNeedsOwner,
} from './loginsView';

function agent(fields: Partial<AgentLogin>): AgentLogin {
  return {
    agentId: 1,
    name: 'Codex-Test',
    username: 'codex-test',
    runtime: 'codex',
    online: true,
    source: 'own',
    state: 'signedIn',
    account: { method: 'chatgpt', email: 'owner@example.com', plan: 'pro', organization: null },
    refreshedAt: null,
    checkedAt: null,
    credential: null,
    command: 'codex login --device-auth',
    canCheck: true,
    canSignOut: true,
    ...fields,
  };
}

function shared(fields: Partial<SharedLogin>): SharedLogin {
  return {
    key: 'k',
    store: 'hermes',
    provider: 'openai-codex',
    label: null,
    managed: true,
    state: 'ok',
    condition: 'active',
    expiresAt: null,
    refreshedAt: null,
    error: null,
    command: null,
    note: null,
    plan: null,
    stale: false,
    checkedAt: '2026-09-25T10:00:00.000Z',
    ...fields,
  };
}

describe('agent logins', () => {
  test('a login that reaches the runtime is fine, a missing or refused one needs the owner', () => {
    assert.equal(agentLoginStatus(agent({})), 'success');
    assert.equal(agentLoginStatus(agent({ state: 'expired' })), 'danger');
    assert.equal(agentLoginStatus(agent({ state: 'signedOut' })), 'danger');
    assert.equal(agentLoginStatus(agent({ state: 'unknown' })), 'idle');
    assert.equal(agentNeedsOwner(agent({ state: 'expired' })), true);
    assert.equal(agentNeedsOwner(agent({ state: 'unknown' })), false);
  });

  test('lists the ones the owner has to act on first, then by name', () => {
    const rows = orderedAgentLogins([
      agent({ agentId: 1, name: 'Beta' }),
      agent({ agentId: 2, name: 'Alpha' }),
      agent({ agentId: 3, name: 'Zulu', state: 'signedOut' }),
    ]);
    assert.deepEqual(
      rows.map((row) => row.agentId),
      [3, 2, 1],
    );
  });

  test('names a plan the way the plan limits do', () => {
    assert.equal(planLabel('pro'), 'Pro');
    assert.equal(planLabel('self_serve_business_usage_based'), 'Self serve business usage based');
    assert.equal(planLabel(null), null);
  });
});

describe('shared logins', () => {
  test('read as on Start', () => {
    assert.equal(sharedLoginStatus(shared({})), 'success');
    assert.equal(sharedLoginStatus(shared({ condition: 'relogin' })), 'danger');
    assert.equal(sharedLoginStatus(shared({ condition: 'relogin', stale: true })), 'idle');
    assert.equal(sharedNeedsOwner(shared({ condition: 'relogin' })), true);
    assert.equal(sharedNeedsOwner(shared({ condition: 'relogin', stale: true })), false);
  });

  test('list a login to sign in again first', () => {
    const rows = orderedSharedLogins([
      shared({ key: 'a', provider: 'anthropic' }),
      shared({ key: 'b', provider: 'openai-codex', condition: 'relogin' }),
      shared({ key: 'c', provider: 'openai-codex', store: 'codex-cli', managed: false }),
    ]);
    assert.deepEqual(
      rows.map((row) => row.key),
      ['b', 'a', 'c'],
    );
  });
});
