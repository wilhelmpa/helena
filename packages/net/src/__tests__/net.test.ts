import { describe, it, expect } from 'bun:test';
import { isPrivateIp } from '../index';

describe('isPrivateIp', () => {
  it('flags loopback, private, link-local, and CGNAT IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.0.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it('passes public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1']) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });

  it('flags loopback, link-local, and unique-local IPv6', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fd00::1', 'FD00::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it('flags IPv4-mapped and IPv4-compatible IPv6 carrying a private IPv4', () => {
    for (const ip of [
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '::FFFF:A9FE:A9FE',
      '::127.0.0.1',
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it('passes IPv4-mapped IPv6 carrying a public IPv4', () => {
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateIp('::ffff:808:808')).toBe(false);
  });
});

describe('isPrivateIp: gateway and special-purpose ranges (ipaddr.js)', () => {
  it('flags IPv6 forms that carry an IPv4 through a gateway', () => {
    for (const ip of [
      '64:ff9b::7f00:1', // NAT64 (RFC 6052) → 127.0.0.1
      '64:ff9b::a9fe:a9fe', // NAT64 → 169.254.169.254
      '64:ff9b:1::1', // local-use NAT64 (RFC 8215)
      '2002:7f00:1::', // 6to4 → 127.0.0.1
      '2002:0808:0808::1', // 6to4 is refused whatever it carries
      '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
      '::ffff:0:7f00:1', // SIIT (RFC 6145)
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it('flags the whole link-local /10, site-local and the IETF/benchmarking IPv4 ranges', () => {
    for (const ip of [
      'fe90::1',
      'febf::1',
      'fec0::1', // deprecated site-local (RFC 3879)
      '192.0.0.8', // IETF protocol assignments (RFC 6890)
      '198.18.0.1', // benchmarking (RFC 2544)
      '198.19.255.254',
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it('keeps documentation and global unicast addresses reachable outside public-only', () => {
    for (const ip of [
      '203.0.113.10',
      '192.0.2.1',
      '192.0.78.9',
      '198.20.0.1',
      '2606:4700:4700::1111',
      '2a00:1450:4001::200e',
    ]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });

  it('fails closed on something that is not an address', () => {
    expect(isPrivateIp('not-an-ip')).toBe(true);
  });
});
