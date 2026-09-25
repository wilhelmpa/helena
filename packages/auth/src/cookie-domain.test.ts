import { describe, expect, it } from 'bun:test';
import { parentDomain, sessionCookieDomain } from './cookie-domain';

describe('session cookie domain', () => {
  it('stays host-only when the app and the api share a host', () => {
    expect(
      sessionCookieDomain(
        'https://helena.volition.one',
        'https://helena.volition.one/backend',
        undefined,
      ),
    ).toBeUndefined();
    expect(
      sessionCookieDomain(
        'http://kingston-server.local',
        'http://kingston-server.local/backend',
        '',
      ),
    ).toBeUndefined();
  });

  it('shares with the sibling subdomain only when the api lives on one', () => {
    expect(
      sessionCookieDomain('https://app.example.com', 'https://api.example.com', undefined),
    ).toBe('.example.com');
  });

  it('follows an explicit setting', () => {
    expect(
      sessionCookieDomain('https://app.example.com', 'https://api.example.com', 'host-only'),
    ).toBeUndefined();
    expect(
      sessionCookieDomain(
        'https://a.b.example.co.uk',
        'https://a.b.example.co.uk',
        '.example.co.uk',
      ),
    ).toBe('.example.co.uk');
  });

  it('never derives one for localhost, addresses or apex domains', () => {
    expect(parentDomain('http://localhost:3001')).toBeUndefined();
    expect(parentDomain('http://192.168.2.58')).toBeUndefined();
    expect(parentDomain('http://[::1]:3001')).toBeUndefined();
    expect(parentDomain('https://example.com')).toBeUndefined();
  });
});
