import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { contentSecurityPolicy } from './contentSecurityPolicy';

const envNames = [
  'API_URL',
  'OPENCLAW_URL',
  'TERMINAL_URL',
  'CODE_URL',
  'BROWSER_URL',
  'FILES_URL',
  'PAPERLESS_URL',
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
  it('allows requests to the api origin only, without its path', () => {
    process.env.API_URL = 'https://api.example.com/base/';
    assert.match(contentSecurityPolicy(), /connect-src 'self' https:\/\/api\.example\.com;/);
  });

  it('falls back to same-origin requests when the api url is not absolute', () => {
    process.env.API_URL = 'not a url';
    assert.match(contentSecurityPolicy(), /connect-src 'self';/);
  });

  it('allows only configured workspace origins as external frames', () => {
    process.env.OPENCLAW_URL = 'https://openclaw.example.com/path';
    process.env.CODE_URL = 'https://code.example.com/';
    process.env.PAPERLESS_URL = 'invalid';
    assert.match(
      contentSecurityPolicy(),
      /frame-src https:\/\/openclaw\.example\.com https:\/\/code\.example\.com;/,
    );
  });

  it('disables external frames when no workspace is configured', () => {
    assert.match(contentSecurityPolicy(), /frame-src 'none';/);
  });
});
