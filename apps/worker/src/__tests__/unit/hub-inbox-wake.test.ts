import { describe, expect, it } from 'bun:test';
import { handleHubInboxWake } from '../../hub-inbox-wake';
import type { HubInboxConfig } from '../../hub-inbox-client';

const config: HubInboxConfig = {
  baseUrl: 'http://integration.invalid',
  token: 'inbox-secret',
  teamId: 1,
  accounts: ['team@example.com'],
  syncIntervalMs: 300_000,
  timeoutMs: 30_000,
};

describe('hub inbox private wake endpoint', () => {
  it('accepts only an authenticated, bounded account wake', async () => {
    const response = await handleHubInboxWake(
      wakeRequest(
        { schemaVersion: 1, channel: 'mail', account: 'team@example.com' },
        'inbox-secret',
      ),
      config,
    );
    expect(response.status).toBe(204);
  });

  it('rejects missing auth, unknown accounts, and extra provider data', async () => {
    expect(
      (
        await handleHubInboxWake(
          wakeRequest({ schemaVersion: 1, channel: 'mail', account: 'team@example.com' }),
          config,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleHubInboxWake(
          wakeRequest(
            { schemaVersion: 1, channel: 'mail', account: 'other@example.com' },
            'inbox-secret',
          ),
          config,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleHubInboxWake(
          wakeRequest(
            { schemaVersion: 1, channel: 'mail', account: 'team@example.com', historyId: '10' },
            'inbox-secret',
          ),
          config,
        )
      ).status,
    ).toBe(400);
  });
});

function wakeRequest(body: unknown, token?: string) {
  return new Request('http://worker/internal/inbox/wake', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {},
    body: JSON.stringify(body),
  });
}
