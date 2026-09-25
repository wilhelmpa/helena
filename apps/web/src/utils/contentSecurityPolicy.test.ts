import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { contentSecurityPolicy } from './contentSecurityPolicy';

const envNames = [
  'API_URL',
  'TERMINAL_URL',
  'CODE_URL',
  'BROWSER_URL',
  'INBOX_URL',
  'CONNECTIONS_URL',
] as const;
let originalValues: Record<string, string | undefined>;

beforeEach(() => {
  originalValues = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
});

afterEach(() => {
  for (const name of envNames) {
    const value = originalValues[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('contentSecurityPolicy', () => {
  it('lets this origin run the service worker that shows push notifications', () => {
    assert.match(contentSecurityPolicy('abc'), /worker-src 'self';/);
  });

  it('allows requests to the api origin only, without its path', () => {
    process.env.API_URL = 'https://api.example.com/base/';
    assert.match(contentSecurityPolicy(), /connect-src 'self' https:\/\/api\.example\.com;/);
  });

  it('falls back to same-origin requests when the api url is not absolute', () => {
    process.env.API_URL = 'not a url';
    assert.match(contentSecurityPolicy(), /connect-src 'self';/);
  });

  it('allows only configured workspace origins as external frames', () => {
    process.env.TERMINAL_URL = 'https://terminal.example.com/path';
    process.env.CODE_URL = 'https://code.example.com/';
    assert.match(
      contentSecurityPolicy(),
      /frame-src 'self' https:\/\/terminal\.example\.com https:\/\/code\.example\.com;/,
    );
  });

  it('runs scripts by nonce, with fallbacks only old browsers read', () => {
    assert.match(
      contentSecurityPolicy('abc123'),
      /(^|; )script-src 'nonce-abc123' 'strict-dynamic' https: http: 'unsafe-inline' 'wasm-unsafe-eval'(;|$)/,
    );
    assert.match(
      contentSecurityPolicy(),
      /(^|; )script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'(;|$)/,
    );
  });

  it('lets WebAssembly compile but never evaluates JavaScript outside development', () => {
    const policy = contentSecurityPolicy('abc123');
    assert.match(policy, /'wasm-unsafe-eval'/);
    assert.doesNotMatch(policy, /'unsafe-eval'/);
  });

  it('allows same-origin frames only when no workspace is configured', () => {
    assert.match(contentSecurityPolicy(), /frame-src 'self';/);
  });
});
