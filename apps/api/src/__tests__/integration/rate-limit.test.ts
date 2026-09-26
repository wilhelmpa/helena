import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { resetKeyRateLimitForTests } from '@repo/auth';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

// Request limits. An API key over its limit gets 429 with Retry-After, never a 500, and
// gets in again once the window passed. A password guess from the network is limited per
// address; callers without a trusted IP share a bucket. Session reads remain exempt.

afterAll(() => resetKeyRateLimitForTests());

async function agentKey() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Agent',
    username: 'agent',
    kind: 'external',
  });
  return created.data!.apiKey!;
}

const withKey = (apiKey: string) =>
  app.handle(new Request('http://localhost/projects/MKT', { headers: { 'x-api-key': apiKey } }));

describe('API key limit', () => {
  beforeEach(resetDb);

  it('answers 429 with Retry-After over the limit and lets the key in again', async () => {
    const apiKey = await agentKey();
    resetKeyRateLimitForTests(3);
    for (let i = 0; i < 3; i++) expect((await withKey(apiKey)).status).toBe(200);
    const refused = await withKey(apiKey);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('1');
    expect(await refused.json()).toMatchObject({ code: 'RATE_LIMITED' });
    await Bun.sleep(1050);
    expect((await withKey(apiKey)).status).toBe(200);
  });

  it('is counted on the MCP endpoint too', async () => {
    const apiKey = await agentKey();
    resetKeyRateLimitForTests(1);
    const call = () =>
      app.handle(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        }),
      );
    expect((await call()).status).toBe(200);
    const refused = await call();
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('1');
  });
});

describe('sign-in limit', () => {
  beforeEach(resetDb);

  const origin = (process.env.APP_URL ?? '').split(',')[0].trim();
  const guess = (headers: Record<string, string>) =>
    app.handle(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, ...headers },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password-123' }),
      }),
    );

  it('limits both network guesses and callers without a trusted address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await guess({ 'x-real-ip': '203.0.113.7' })).status);
    expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Another trusted address has its own count.
    expect((await guess({ 'x-real-ip': '203.0.113.8' })).status).not.toBe(429);
    const unknown: number[] = [];
    for (let i = 0; i < 11; i++) unknown.push((await guess({})).status);
    expect(unknown[10]).toBe(429);
    // Untrusted proxy headers and empty/malformed trusted headers cannot create buckets.
    const untrusted: Record<string, string>[] = [
      { 'x-forwarded-for': '203.0.113.20' },
      { 'x-real-ip': '' },
      { 'x-real-ip': 'not-an-address' },
    ];
    for (const headers of untrusted) expect((await guess(headers)).status).toBe(429);
    for (let i = 0; i < 12; i++) {
      expect((await app.handle(new Request('http://localhost/api/auth/get-session'))).status).toBe(
        200,
      );
    }
  });
});
