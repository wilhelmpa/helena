import { describe, expect, it, beforeEach } from 'bun:test';
import { auth } from '@repo/auth';
import { apikey, db, setDisplayName } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '#tests/helpers/app';
import { resetDb } from '#tests/helpers/db';
import { signUpTestUser } from '#tests/helpers/auth';
import { patchOps, setupScim } from '#modules/scim/__tests__/helpers';
import pkg from '../../../../../../package.json';

// The MCP endpoint resolves the API key itself instead of going through
// authContext, so the rules that gate a planner route have to hold here too.

async function initialize(apiKey: string) {
  return app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
    }),
  );
}

describe('MCP transport', () => {
  beforeEach(resetDb);

  // Streamable HTTP: a stateless server offers no GET stream and no session to DELETE.
  it('answers GET and DELETE with 405 and Allow: POST', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await app.handle(new Request('http://localhost/mcp', { method }));
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
      expect(await res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 } });
    }
  });

  it('introduces itself as Ava with the release version', async () => {
    const user = await signUpTestUser();
    const created = await auth.api.createApiKey({ body: { userId: user.userId, name: 'mcp' } });
    const response = await initialize(created.key);
    expect(response.status).toBe(200);
    const text = await response.text();
    const message = JSON.parse(text.includes('data:') ? text.split('data: ')[1]! : text);
    expect(message.result.serverInfo).toEqual({
      name: 'helena',
      title: 'Ava',
      version: pkg.version,
    });
  });

  it('introduces itself with the configured product name', async () => {
    const user = await signUpTestUser();
    const created = await auth.api.createApiKey({ body: { userId: user.userId, name: 'mcp' } });
    await setDisplayName('Atlas');
    const response = await initialize(created.key);
    const text = await response.text();
    const message = JSON.parse(text.includes('data:') ? text.split('data: ')[1]! : text);
    expect(message.result.serverInfo.title).toBe('Atlas');
    expect(message.result.instructions).toContain('Atlas');
  });
});

describe('MCP authentication', () => {
  beforeEach(resetDb);

  it('refuses a request with no key', async () => {
    const res = await app.handle(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      }),
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 for a revoked API key', async () => {
    const user = await signUpTestUser();
    const created = await auth.api.createApiKey({
      body: { userId: user.userId, name: 'revoked-mcp' },
    });
    await db.delete(apikey).where(eq(apikey.id, created.id));

    const response = await initialize(created.key);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata');
  });

  it('returns 401 for a malformed branded API key', async () => {
    const response = await initialize('itp_invalid-fixed-test-key');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata');
  });

  it('refuses a key whose account was deactivated over SCIM', async () => {
    const { scim } = await setupScim();
    const member = await signUpTestUser({ email: 'member@example.com' });
    const created = await auth.api.createApiKey({
      body: { userId: member.userId, name: 'mcp' },
    });

    expect((await initialize(created.key)).status).not.toBe(401);

    await scim.scim.v2
      .Users({ id: member.userId })
      .patch(patchOps([{ op: 'replace', path: 'active', value: false }]));

    expect((await initialize(created.key)).status).toBe(401);
  });
});
