import { describe, expect, it } from 'bun:test';
import { hostAllowed, normalizeHost, originAllowed } from './domain';

describe('normalizeHost', () => {
  it('lowercases and drops a leading wildcard label and a trailing dot', () => {
    expect(normalizeHost('*.Example.COM.')).toBe('example.com');
  });

  it('accepts a bare IP literal', () => {
    expect(normalizeHost('10.0.0.1')).toBe('10.0.0.1');
  });

  it('unwraps a bracketed IPv6 literal', () => {
    expect(normalizeHost('[::1]')).toBe('::1');
  });
});

describe('hostAllowed', () => {
  it('allows everything when both lists are empty', () => {
    expect(hostAllowed({ domainBlocklist: [], domainAllowlist: [] }, 'example.com')).toBe(true);
  });

  it('blocks an exact match on the blocklist', () => {
    expect(
      hostAllowed({ domainBlocklist: ['bank.example'], domainAllowlist: [] }, 'bank.example'),
    ).toBe(false);
  });

  it('a blocked domain covers its subdomains', () => {
    expect(
      hostAllowed({ domainBlocklist: ['bank.example'], domainAllowlist: [] }, 'login.bank.example'),
    ).toBe(false);
  });

  it('a non-empty allowlist is exclusive', () => {
    const policy = { domainBlocklist: [], domainAllowlist: ['example.com'] };
    expect(hostAllowed(policy, 'example.com')).toBe(true);
    expect(hostAllowed(policy, 'other.example')).toBe(false);
  });

  it('an allowed domain covers its subdomains too', () => {
    const policy = { domainBlocklist: [], domainAllowlist: ['example.com'] };
    expect(hostAllowed(policy, 'docs.example.com')).toBe(true);
  });

  it('the blocklist still carves a subdomain out of an allowed parent', () => {
    const policy = { domainBlocklist: ['admin.example.com'], domainAllowlist: ['example.com'] };
    expect(hostAllowed(policy, 'example.com')).toBe(true);
    expect(hostAllowed(policy, 'admin.example.com')).toBe(false);
  });
});

describe('originAllowed', () => {
  it('checks the hostname of a full URL', () => {
    expect(
      originAllowed(
        { domainBlocklist: ['bank.example'], domainAllowlist: [] },
        'https://bank.example/login',
      ),
    ).toBe(false);
  });

  it('refuses an unparsable URL rather than throwing', () => {
    expect(originAllowed({ domainBlocklist: [], domainAllowlist: [] }, 'not a url')).toBe(false);
  });
});
