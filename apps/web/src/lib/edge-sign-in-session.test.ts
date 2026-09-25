import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { edgeSignInSession } from './edge-sign-in-session';

// The web app's half of the Cloudflare sign-in: it asks the API only for a page load that
// came through the tunnel entry (the entry's proof) with an Access assertion, on one of the
// instance's origins, and hands the session cookie on with a redirect to the page asked for.

const proof = 'test-only-edge-entry-proof-'.padEnd(64, 'x');
const names = ['HELENA_EDGE_ENTRY_TOKEN', 'APP_URL', 'SERVICE_URL_API'] as const;
let previous: (string | undefined)[];
const originalFetch = globalThis.fetch;
let calls: { url: string; headers: Record<string, string> }[] = [];

beforeEach(() => {
  previous = names.map((name) => process.env[name]);
  process.env.HELENA_EDGE_ENTRY_TOKEN = proof;
  process.env.APP_URL = 'https://helena.example.com,https://helena-home.example.com';
  process.env.SERVICE_URL_API = 'http://127.0.0.1:3000';
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    return new Response('{}', {
      headers: {
        'set-cookie':
          '__Secure-better-auth.session_token=new.signature; Path=/; HttpOnly; Secure; SameSite=Lax',
      },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  names.forEach((name, index) => {
    if (previous[index] === undefined) delete process.env[name];
    else process.env[name] = previous[index];
  });
});

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://helena.example.com${path}`, {
    headers: {
      host: 'helena.example.com',
      'x-forwarded-proto': 'https',
      'x-helena-edge-entry': proof,
      'cf-access-jwt-assertion': 'header.payload.signature',
      'x-real-ip': '203.0.113.9',
      'user-agent': 'phone',
      ...headers,
    },
  });
}

describe('the Cloudflare sign-in in the web app', () => {
  it('asks the API with the proof and the assertion and lands on the page asked for', async () => {
    const response = await edgeSignInSession(request('/project/VOL?view=board'));
    assert.equal(response?.status, 303);
    assert.equal(
      response?.headers.get('location'),
      'https://helena.example.com/project/VOL?view=board',
    );
    assert.match(response!.headers.getSetCookie()[0]!, /__Secure-better-auth\.session_token/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'http://127.0.0.1:3000/api/auth/sign-in/edge');
    assert.deepEqual(calls[0]!.headers, {
      'x-helena-edge-entry': proof,
      'x-helena-entry': 'tunnel',
      'cf-access-jwt-assertion': 'header.payload.signature',
      'x-real-ip': '203.0.113.9',
      'user-agent': 'phone',
      origin: 'https://helena.example.com',
    });
  });

  it('never asks without the proof, the assertion or on a foreign origin', async () => {
    const refused: Record<string, string>[] = [
      { 'x-helena-edge-entry': '' },
      { 'x-helena-edge-entry': 'forged-proof-of-the-same-length'.padEnd(64, 'z') },
      { 'cf-access-jwt-assertion': '' },
      { host: 'evil.example.com' },
      { 'x-forwarded-proto': 'http' },
      { origin: 'https://evil.example.com' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of refused) {
      assert.equal(await edgeSignInSession(request('/', headers)), null, JSON.stringify(headers));
    }
    delete process.env.HELENA_EDGE_ENTRY_TOKEN;
    assert.equal(await edgeSignInSession(request('/')), null);
    assert.equal(calls.length, 0);
  });

  it('passes on nothing when the API opens no session', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch;
    assert.equal(await edgeSignInSession(request('/login')), null);
  });
});
