import { describe, expect, it } from 'bun:test';
import { hostAllowed, isLocalHost, normalizeHost, originAllowed, resolvesLocally } from './domain';

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

describe('local addresses', () => {
  it('knows local names and private, loopback and link-local literals', () => {
    for (const host of [
      'localhost',
      'app.localhost',
      'kingston-server.local',
      'router.lan',
      'db.internal',
      'nas.home.arpa',
      '127.0.0.1',
      '10.1.2.3',
      '192.168.2.220',
      '172.20.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      '[fe80::1]',
    ]) {
      expect(isLocalHost(host)).toBe(true);
    }
    for (const host of ['example.com', '93.184.215.14', 'local.example.com', '2606:4700::1111']) {
      expect(isLocalHost(host)).toBe(false);
    }
  });

  it('closes them in the policy unless the project opened them', () => {
    const policy = { domainBlocklist: [], domainAllowlist: [] };
    expect(hostAllowed(policy, '127.0.0.1')).toBe(false);
    expect(hostAllowed({ ...policy, allowLocalAddresses: true }, '127.0.0.1')).toBe(true);
    expect(hostAllowed(policy, 'example.com')).toBe(true);
  });

  it('resolves a name to catch a public-looking one that points inside', async () => {
    const lookup = async (host: string) => [
      { address: host === 'inside.example' ? '10.0.0.8' : '93.184.215.14' },
    ];
    expect(await resolvesLocally('inside.example', lookup)).toBe(true);
    expect(await resolvesLocally('example.com', lookup)).toBe(false);
    expect(
      await resolvesLocally('nowhere.example', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).toBe(false);
  });
});
