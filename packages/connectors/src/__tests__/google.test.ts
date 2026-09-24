import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  codeFromRedirect,
  finishGoogleAuth,
  gogAccounts,
  googleAccessToken,
  GoogleAuthError,
  GOOGLE_TOOLS,
  parseClientJson,
  scopesFor,
  servicesCovered,
  setGoogleEndpointsForTests,
  startGoogleAuth,
  clearGoogleTokenCache,
  type GoogleOAuthClient,
} from '../google';
import { annotationsForCategory, connectors, decide, toolCategory } from '..';

const CLIENT_ID = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';

function clientJson(type: 'installed' | 'web' = 'installed') {
  return JSON.stringify({
    [type]: {
      client_id: CLIENT_ID,
      project_id: 'helena-test',
      client_secret: 'GOCSPX-test-secret',
      redirect_uris: ['http://localhost'],
    },
  });
}

describe('client file', () => {
  it('reads a Desktop and a Web client', () => {
    expect(parseClientJson(clientJson())).toMatchObject({
      type: 'installed',
      clientId: CLIENT_ID,
      projectId: 'helena-test',
    });
    expect(parseClientJson(clientJson('web')).type).toBe('web');
  });

  it('refuses a service account key and broken files', () => {
    expect(() => parseClientJson('{"type":"service_account","private_key":"x"}')).toThrow(
      /service account/,
    );
    expect(() => parseClientJson('not json')).toThrow(/not JSON/);
    expect(() => parseClientJson({ installed: { client_id: 'nope', client_secret: 'x' } })).toThrow(
      /client_id/,
    );
  });
});

describe('scopes and services', () => {
  it('asks for the identity scopes and the full Gmail scope for Mail', () => {
    expect(scopesFor(['mail', 'calendar'])).toEqual([
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/calendar',
    ]);
    expect(servicesCovered(['https://mail.google.com/', 'openid'])).toEqual(['mail']);
  });
});

describe('the pasted address', () => {
  it('takes the code of the matching sign-in and refuses others', () => {
    expect(codeFromRedirect('http://127.0.0.1:53682/?state=s1&code=4/abc&scope=x', 's1')).toBe(
      '4/abc',
    );
    expect(() => codeFromRedirect('http://127.0.0.1:53682/?state=other&code=4/abc', 's1')).toThrow(
      /different sign-in/,
    );
    expect(() => codeFromRedirect('http://127.0.0.1:53682/?error=access_denied', 's1')).toThrow(
      /declined/,
    );
    expect(codeFromRedirect('  4/0Abcdefghijk  ', 's1')).toBe('4/0Abcdefghijk');
  });
});

describe('sign-in and tokens against a fake Google', () => {
  let server: ReturnType<typeof Bun.serve>;
  const seen: { path: string; body: string }[] = [];
  let refreshAnswer: { status: number; body: unknown } = {
    status: 200,
    body: { access_token: 'ya29.fresh', expires_in: 3599, token_type: 'Bearer' },
  };
  const client: GoogleOAuthClient = parseClientJson(clientJson());

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.text();
        seen.push({ path: url.pathname, body });
        if (url.pathname === '/token') {
          const params = new URLSearchParams(body);
          if (params.get('grant_type') === 'authorization_code') {
            return Response.json({
              access_token: 'ya29.first',
              refresh_token: '1//refresh-secret',
              expires_in: 3599,
              scope: 'openid https://mail.google.com/',
              token_type: 'Bearer',
            });
          }
          return Response.json(refreshAnswer.body, { status: refreshAnswer.status });
        }
        if (url.pathname === '/tokeninfo') {
          return Response.json({
            email: 'Owner@Example.com',
            scope: 'openid https://www.googleapis.com/auth/userinfo.email https://mail.google.com/',
            expires_in: 3500,
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    setGoogleEndpointsForTests({
      oauth2TokenUrl: `${base}/token`,
      tokenInfoUrl: `${base}/tokeninfo`,
    });
  });

  afterAll(() => {
    setGoogleEndpointsForTests(null);
    server.stop(true);
  });

  it('builds a PKCE sign-in address with offline access and exchanges the code', async () => {
    const start = await startGoogleAuth(client, { services: ['mail'], state: 'state-1' });
    const url = new URL(start.url);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53682/');
    expect(url.searchParams.get('scope')).toContain('https://mail.google.com/');

    const grant = await finishGoogleAuth(client, {
      code: '4/code',
      codeVerifier: start.codeVerifier,
      redirectUri: start.redirectUri,
    });
    expect(grant).toEqual({
      email: 'owner@example.com',
      refreshToken: '1//refresh-secret',
      scopes: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://mail.google.com/',
      ],
    });
    const exchange = new URLSearchParams(seen.find((entry) => entry.path === '/token')!.body);
    expect(exchange.get('code_verifier')).toBe(start.codeVerifier);
  });

  it('refreshes an access token, reuses it, and reports a revoked grant', async () => {
    clearGoogleTokenCache();
    const first = await googleAccessToken(client, '1//refresh-secret', 'account-1');
    expect(first.token).toBe('ya29.fresh');
    const before = seen.length;
    await googleAccessToken(client, '1//refresh-secret', 'account-1');
    expect(seen.length).toBe(before);

    refreshAnswer = { status: 400, body: { error: 'invalid_grant', error_description: 'revoked' } };
    const failed = await googleAccessToken(client, '1//refresh-secret', 'account-2').catch(
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(GoogleAuthError);
    expect((failed as GoogleAuthError).status).toBe('needs_auth');
    expect(String((failed as Error).message)).not.toContain('refresh-secret');
  });
});

describe('gog output', () => {
  it('reads accounts from an array or an object holding one', () => {
    expect(
      gogAccounts([
        { email: 'A@x.com', services: ['gmail', 'calendar'] },
        { account: 'b@y.com', services: 'drive,docs', error: 'token expired' },
        { nothing: true },
      ]),
    ).toEqual([
      { email: 'a@x.com', services: ['gmail', 'calendar'], ok: true, error: null },
      { email: 'b@y.com', services: ['drive', 'docs'], ok: false, error: 'token expired' },
    ]);
    expect(gogAccounts({ accounts: [{ email: 'c@z.com', valid: false }] })[0]!.ok).toBe(false);
  });
});

describe('tools and categories', () => {
  it('gives every tool a category, a service and a schema with the account', () => {
    expect(connectors.get('google')?.tools.length).toBe(GOOGLE_TOOLS.length);
    for (const tool of GOOGLE_TOOLS) {
      expect(tool.name).toMatch(/^google_[a-z_]+$/);
      expect((tool.inputSchema as { required: string[] }).required).toContain('account');
    }
    const create = GOOGLE_TOOLS.find((tool) => tool.name === 'google_calendar_create_event')!;
    expect(toolCategory(create, { attendees: [] })).toBe('write');
    expect(toolCategory(create, { attendees: ['guest@example.com'] })).toBe('send');
    expect(annotationsForCategory('read').readOnlyHint).toBe(true);
    expect(annotationsForCategory('delete').destructiveHint).toBe(true);
  });

  it('takes the strictest policy answer, and a failing evaluator denies', async () => {
    const request = { agent: null, project: null, action: 'send' as const, context: {} };
    const decision = await decide(
      [
        { id: 'a', evaluate: () => ({ effect: 'allow', reason: 'ok' }) },
        { id: 'b', evaluate: () => ({ effect: 'needs-approval', reason: 'ask' }) },
        { id: 'c', evaluate: () => null },
      ],
      request,
    );
    expect(decision).toMatchObject({ effect: 'needs-approval', evaluator: 'b' });
    const broken = await decide(
      [
        {
          id: 'x',
          evaluate: () => {
            throw new Error('boom');
          },
        },
      ],
      request,
    );
    expect(broken.effect).toBe('deny');
  });
});
